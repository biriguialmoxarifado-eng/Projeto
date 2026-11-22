'use strict';

const { createHash } = require('node:crypto');
const { StorageOperations } = require('../../database/storage-operations');

const error = code => Object.assign(new Error(code), { code });
const identifier = value => typeof value === 'string' && /^[\w-]{1,80}$/.test(value);
const quantity = value => Number.isSafeInteger(value) && value > 0;
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
};

function lines(items) {
  if (!Array.isArray(items) || !items.length || items.length > 100) throw error('RECEBIMENTO_ITENS_INVALIDOS');
  const result = new Map();
  for (const item of items) {
    if (!identifier(item?.sku) || !quantity(item.quantidade) || result.has(item.sku)) {
      throw error('RECEBIMENTO_ITENS_INVALIDOS');
    }
    result.set(item.sku, item.quantidade);
  }
  return result;
}

function createReceivingEngine({ core, store, invoices, coordinate = work => work(), clock = () => new Date() }) {
  const operations = new StorageOperations();
  async function actor(token, action) {
    await core.authorizeSession(token, 'receiving:' + action);
    const session = await core.getSession(token);
    if (!session?.userId) throw error('SESSION_INVALID');
    return String(session.userId);
  }

  async function change(token, action, input) {
    const author = await actor(token, 'write');
    const request = structuredClone(input);
    if (!identifier(request?.id) || !identifier(request.operation) ||
        !Number.isSafeInteger(request.version) || request.version < 0 || request.version >= Number.MAX_SAFE_INTEGER) {
      throw error('RECEBIMENTO_OPERACAO_INVALIDA');
    }

    const { id, operation, version } = request;
    const fingerprint = createHash('sha256').update(JSON.stringify(canonical({ action, author, request }))).digest('hex');
    return operations.mutate(() => coordinate(async () => {
      const replay = events => {
        const prior = events.find(event => event.operation === operation);
        if (prior && prior.fingerprint !== fingerprint) throw error('RECEBIMENTO_CONFLITO_IDEMPOTENCIA');
        return prior;
      };
      const latest = events => events.reduce((prior, event) =>
        event.id === id && event.version > (prior?.version ?? 0) ? event : prior, null);
      const before = await store.events();
      const duplicate = replay(before);
      if (duplicate) return duplicate;
      const prior = latest(before);
      if ((prior?.version ?? 0) !== version) throw error('RECEBIMENTO_CONFLITO_VERSAO');

      let note;
      let exclusive;
      if (action === 'requisitar') {
        if (prior || !identifier(request.numero) || !identifier(request.solicitante)) {
          throw error('REQUISICAO_INVALIDA');
        }
        const requested = lines(request.itens);
        note = { id, numero: request.numero, solicitante: request.solicitante, status: 'REQUISITADA',
          itens: [...requested].map(([sku, quantidade]) => ({ sku, quantidade, recebida: 0, pendente: quantidade })) };
      } else if (action === 'comprar') {
        if (prior?.note.status !== 'REQUISITADA' || !identifier(request.compra)) throw error('COMPRA_INVALIDA');
        note = { ...prior.note, compra: request.compra, status: 'COMPRADA' };
      } else {
        if (!['COMPRADA', 'PARCIAL'].includes(prior?.note.status) || request.conferencia !== true ||
            typeof request.nfId !== 'string' || !quantity(request.nfVersion)) throw error('CONFERENCIA_INVALIDA');
        exclusive = request.nfId;
        if (before.some(event => event.exclusive === exclusive)) throw error('NF_JA_VINCULADA');
        const received = lines(request.itens);
        const invoice = await invoices.consultar(token, request.nfId);
        if (!invoice || invoice.version !== request.nfVersion) throw error('NF_VERSAO_INVALIDA');
        const invoiceItems = new Map();
        for (const item of invoice.note.itens) {
          const sku = item.sku ?? item.codigo;
          const count = item.quantidade ?? item.qtd;
          if (!identifier(sku) || !quantity(count)) throw error('NF_ITEM_INVALIDO');
          const total = (invoiceItems.get(sku) ?? 0) + count;
          if (!quantity(total)) throw error('NF_ITEM_INVALIDO');
          invoiceItems.set(sku, total);
        }
        const requested = new Map(prior.note.itens.map(item => [item.sku, item]));
        if (invoiceItems.size !== received.size || [...received].some(([sku, count]) => {
          const item = requested.get(sku);
          return !item || count !== invoiceItems.get(sku) || count > item.quantidade - item.recebida;
        })) throw error('CONFERENCIA_DIVERGENTE');

        const itens = prior.note.itens.map(item => ({
          ...item, recebida: item.recebida + (received.get(item.sku) ?? 0), pendente: item.pendente - (received.get(item.sku) ?? 0)
        }));
        note = { ...prior.note, itens, status: itens.every(item => item.recebida === item.quantidade) ? 'RECEBIDA' : 'PARCIAL' };
      }

      const event = { id, operation, fingerprint, action, actor: author, version: version + 1, at: clock().toISOString(), note };
      if (exclusive) {
        event.exclusive = exclusive;
        event.nfVersion = request.nfVersion;
        event.movimentos = request.itens.map(({ sku, quantidade }) => ({ sku, quantidade }));
        event.notificacao = { id: operation, solicitante: note.solicitante, requisicao: note.numero, status: 'PENDENTE' };
      }

      let appendError;
      try { await store.append(event); } catch (failure) { appendError = failure; }
      const after = await store.events().catch(failure => { throw appendError ?? failure; });
      const persisted = replay(after);
      if (persisted) return persisted;
      if (exclusive && after.some(item => item.exclusive === exclusive)) throw error('NF_JA_VINCULADA');
      if ((latest(after)?.version ?? 0) !== version) throw error('RECEBIMENTO_CONFLITO_VERSAO');
      if (exclusive && (await invoices.consultar(token, exclusive))?.version !== request.nfVersion) {
        throw error('NF_VERSAO_INVALIDA');
      }
      throw appendError ?? error('RECEBIMENTO_NAO_CONFIRMADO');
    }));
  }

  return {
    requisitar: (token, input) => change(token, 'requisitar', input),
    comprar: (token, input) => change(token, 'comprar', input),
    receber: (token, input) => change(token, 'receber', input),
    async consultar(token, id) {
      await actor(token, 'read');
      return (await store.events()).filter(event => event.id === id)
        .reduce((latest, event) => event.version > (latest?.version ?? 0) ? event : latest, null);
    },
    async entradas(token, sku) {
      await actor(token, 'read');
      return (await store.events()).flatMap(event => event.movimentos ?? [])
        .filter(movement => movement.sku === sku).reduce((sum, movement) => sum + movement.quantidade, 0);
    }
  };
}

module.exports = { createReceivingEngine };
