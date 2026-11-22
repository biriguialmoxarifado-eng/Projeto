'use strict';

const { createHash } = require('node:crypto');

const fail = code => Object.assign(new Error(code), { code });
const idValid = value => typeof value === 'string' && /^[\w.-]{1,80}$/.test(value);
const open = status => ['AGUARDANDO_APROVACAO', 'EM_COTACAO'].includes(status);
const converted = 'CONVERTIDA_EM_PEDIDO';

function latest(events) {
  const result = new Map();
  for (const event of events) {
    for (const entry of [event, ...(event.changes ?? [])]) {
      if (entry.version > (result.get(entry.id)?.version ?? 0)) result.set(entry.id, entry);
    }
  }
  return result;
}

function createPurchaseEngine({ core, store, catalog, coordinate, clock = () => new Date() }) {
  async function authorize(token, access) {
    await core.authorizeSession(token, 'purchases:' + access);
    const session = await core.getSession(token);
    if (!session?.userId) throw fail('SESSION_INVALID');
    return String(session.userId);
  }

  return {
    async consultarLegado(token, action, filter = {}) {
      await authorize(token, 'read');
      if (!['listar', 'precompras', 'pedidos'].includes(action)) return { ok: false, codigo: 'ACAO_DESCONHECIDA' };
      const tipo = action === 'precompras' ? 'PRE_COMPRA' : action === 'pedidos' ? 'PEDIDO' : filter.tipo;
      return { ok: true, dados: [...latest(await store.events()).values()].map(event => ({ ...event.note, versaoCore: event.version }))
        .filter(note => (!tipo || note.tipo === tipo) && (action !== 'listar' || !filter.status || note.status === filter.status)) };
    },

    async pedido(token, input = {}) {
      const actor = await authorize(token, 'write');
      const { operation, precompra = null, version, fornecedor = '', previsao = '', observacao = '' } = input;
      const items = input.itens ?? [{ sku: input.sku, qtd: input.qtd, valorUnitario: input.valorUnitario }];
      if (!idValid(operation) || !Array.isArray(items) || !items.length || items.length > 20 ||
          [fornecedor, previsao, observacao].some(value => typeof value !== 'string' || value.length > 160) ||
          (precompra !== null && (typeof precompra !== 'string' || !/^#PC-\d+$/.test(precompra) ||
            !Number.isSafeInteger(version) || version < 1 || version >= Number.MAX_SAFE_INTEGER))) {
        throw fail('COMPRA_DADOS_INVALIDOS');
      }
      const lines = items.map(item => {
        const valorUnitario = item?.valorUnitario ?? input.valorUnitario ?? null;
        if (!idValid(item?.sku) || !Number.isSafeInteger(item.qtd) || item.qtd <= 0 ||
            (valorUnitario !== null && (!Number.isFinite(valorUnitario) || valorUnitario < 0))) {
          throw fail('COMPRA_DADOS_INVALIDOS');
        }
        return { sku: item.sku, qtd: item.qtd, valorUnitario };
      });
      const fingerprint = createHash('sha256').update(JSON.stringify([
        'pedido', actor, precompra, version, fornecedor, previsao, observacao, lines
      ])).digest('hex');
      return coordinate(async () => {
        const replay = events => {
          const event = events.find(candidate => candidate.operation === operation);
          if (event && event.fingerprint !== fingerprint) throw fail('COMPRA_CONFLITO_IDEMPOTENCIA');
          return event;
        };
        const response = event => {
          const pedidos = [event, ...event.changes].filter(entry => entry.note.tipo === 'PEDIDO').map(entry => entry.note);
          return { ok: true, dados: { pedidos, quantidade: pedidos.length } };
        };
        const before = await store.events();
        const duplicate = replay(before);
        if (duplicate) return response(duplicate);
        const records = latest(before);
        const source = precompra && records.get(precompra);
        if (precompra && !source) throw fail('PRECOMPRA_NAO_ENCONTRADA');
        if (source && source.version !== version) throw fail('COMPRA_CONFLITO_VERSAO');
        if (source && (!open(source.note.status) || !lines.some(line => line.sku === source.note.sku))) {
          throw fail('PRECOMPRA_INCOMPATIVEL');
        }
        const at = clock().toISOString();
        const changes = [];
        let sequence = records.size;
        for (const line of lines) {
          const item = await catalog.obter(token, 'itens', line.sku);
          if (!item) throw fail('ITEM_NAO_ENCONTRADO');
          let id;
          do { id = '#CP-' + String(++sequence).padStart(6, '0'); } while (records.has(id));
          const valorEstimado = line.qtd * (line.valorUnitario ?? (Number(item.note.valorUnitario) || 0));
          if (!Number.isFinite(valorEstimado)) throw fail('COMPRA_DADOS_INVALIDOS');
          const note = { id, data: at, tipo: 'PEDIDO', sku: line.sku, descricao: item.note.descricao, qtd: line.qtd,
            valorEstimado, valor: valorEstimado, fornecedor: fornecedor || item.note.fornecedor || '', status: 'EMITIDO',
            previsao, observacao, origem: precompra || 'MANUAL', precompra, solicitante: actor, aprovadoPor: '',
            historico: JSON.stringify([{ quando: at, texto: 'Pedido emitido' }]) };
          changes.push({ id, version: 1, note });
        }
        const [first, ...rest] = changes;
        if (source) {
          const history = JSON.parse(source.note.historico);
          history.push({ quando: at, texto: 'Convertida em pedido: ' + changes.map(entry => entry.id).join(', ') });
          rest.push({ id: source.id, version: source.version + 1, note: { ...source.note, status: converted,
            historico: JSON.stringify(history) } });
        }
        const event = { ...first, operation, fingerprint, actor, at, action: 'pedido', changes: rest };
        let writeError;
        try { await store.append(event); } catch (error) { writeError = error; }
        const after = await store.events().catch(error => { throw writeError ?? error; });
        const persisted = replay(after);
        if (persisted) return response(persisted);
        throw writeError ?? fail('COMPRA_NAO_CONFIRMADA');
      });
    },

    async alterarStatus(token, input) {
      const actor = await authorize(token, 'write');
      const { id, operation, version, status, previsao, fornecedor } = input ?? {};
      if (typeof id !== 'string' || !/^#(?:PC|CP)-\d+$/.test(id) || !idValid(operation) ||
          !Number.isSafeInteger(version) || version < 1 || version >= Number.MAX_SAFE_INTEGER ||
          !idValid(status) || [previsao, fornecedor].some(value =>
            value !== undefined && (typeof value !== 'string' || value.length > 160))) {
        throw fail('COMPRA_DADOS_INVALIDOS');
      }
      const fingerprint = createHash('sha256')
        .update(JSON.stringify(['alterarStatus', actor, id, version, status, previsao, fornecedor])).digest('hex');
      return coordinate(async () => {
        const replay = events => {
          const prior = events.find(event => event.operation === operation);
          if (prior && prior.fingerprint !== fingerprint) throw fail('COMPRA_CONFLITO_IDEMPOTENCIA');
          return prior;
        };
        const before = await store.events();
        const duplicate = replay(before);
        if (duplicate) return duplicate.response;
        const current = latest(before).get(id);
        if (!current) return { ok: false, codigo: 'NAO_ENCONTRADO', mensagem: 'Registro de compra não localizado.' };
        if (current.version !== version) throw fail('COMPRA_CONFLITO_VERSAO');
        if (current.note.status === converted || status === converted) throw fail('PRECOMPRA_INCOMPATIVEL');
        const at = clock().toISOString();
        const history = JSON.parse(current.note.historico);
        history.push({ quando: at, texto: 'Status: ' + current.note.status + ' → ' + status });
        const note = { ...current.note, status, previsao: previsao || current.note.previsao,
          fornecedor: fornecedor || current.note.fornecedor, historico: JSON.stringify(history) };
        const response = { ok: true, dados: { id, status } };
        const event = { id, operation, fingerprint, actor, at, action: 'alterarStatus',
          version: version + 1, note, response };
        let writeError;
        try { await store.append(event); } catch (error) { writeError = error; }
        const after = await store.events().catch(error => { throw writeError ?? error; });
        const persisted = replay(after);
        if (persisted) return persisted.response;
        throw writeError ?? fail('COMPRA_NAO_CONFIRMADA');
      });
    },

    async precompra(token, input) {
      const actor = await authorize(token, 'write');
      const { operation, sku, qtd, origem = 'ESTOQUE_MINIMO' } = input ?? {};
      if (!idValid(operation) || !idValid(sku) || !Number.isSafeInteger(qtd) || qtd <= 0 ||
          typeof origem !== 'string' || origem.length > 80) throw fail('COMPRA_DADOS_INVALIDOS');
      const fingerprint = createHash('sha256').update(JSON.stringify([actor, sku, qtd, origem])).digest('hex');
      return coordinate(async () => {
        const replay = events => {
          const event = events.find(candidate => candidate.operation === operation);
          if (event && event.fingerprint !== fingerprint) throw fail('COMPRA_CONFLITO_IDEMPOTENCIA');
          return event;
        };
        const before = await store.events();
        const duplicate = replay(before);
        if (duplicate) return duplicate.response;
        const item = await catalog.obter(token, 'itens', sku);
        if (!item) return { ok: false, codigo: 'ITEM_NAO_ENCONTRADO', mensagem: 'Item não localizado no cadastro.' };
        const records = latest(before);
        const existing = [...records.values()].find(event =>
          event.note.tipo === 'PRE_COMPRA' && event.note.sku === sku && open(event.note.status));
        const id = existing?.id ?? '#PC-' + String(records.size + 1).padStart(6, '0');
        const at = clock().toISOString();
        const record = existing ? {
          ...existing.note, qtd: Math.max(existing.note.qtd, qtd),
          historico: JSON.stringify([...JSON.parse(existing.note.historico),
            { quando: at, texto: 'Necessidade reforçada: ' + qtd + ' un.' }])
        } : {
          id, data: at, tipo: 'PRE_COMPRA', sku, descricao: item.note.descricao, qtd,
          valorEstimado: qtd * (Number(item.note.valorUnitario) || 0),
          fornecedor: item.note.fornecedor || '', status: 'AGUARDANDO_APROVACAO', previsao: '',
          origem, solicitante: actor, aprovadoPor: '',
          historico: JSON.stringify([{ quando: at, texto: 'Pré-compra aberta' }])
        };
        const response = existing ? {
          ok: true, dados: { id, reforcada: true }, mensagem: 'Pré-compra existente reforçada — nada foi duplicado.'
        } : { ok: true, dados: record, criado: true };
        const event = { id, operation, fingerprint, actor, at, action: 'precompra',
          version: (existing?.version ?? 0) + 1, note: record, response };
        let writeError;
        try { await store.append(event); } catch (error) { writeError = error; }
        const after = await store.events().catch(error => { throw writeError ?? error; });
        const persisted = replay(after);
        if (persisted) return persisted.response;
        throw writeError ?? fail('COMPRA_NAO_CONFIRMADA');
      });
    }
  };
}

module.exports = { createPurchaseEngine };
