'use strict';

const { createHash } = require('node:crypto');
const fail = code => Object.assign(new Error(code), { code });
const valid = value => typeof value === 'string' && /^[\w.-]{1,100}$/.test(value);

function latest(events) {
  const records = new Map();
  for (const event of events) if (event.version > (records.get(event.id)?.version ?? 0)) records.set(event.id, event);
  return records;
}

function createInventoryEngine({ core, store, stock, coordinate, clock = () => new Date() }) {
  async function session(token, access) {
    await core.authorizeSession(token, 'inventory:' + access);
    const actor = (await core.getSession(token))?.userId;
    if (!actor) throw fail('SESSION_INVALID');
    return String(actor);
  }

  return async (token, action, input = {}) => {
    if (['listar', 'obter', 'divergencias'].includes(action)) {
      await session(token, 'read');
      const rows = [...latest(await store.events()).values()].map(event => event.note);
      if (action === 'listar') return { ok: true, dados: rows };
      const selected = rows.find(row => row.id === input.id);
      if (!selected) return { ok: false, codigo: 'NAO_ENCONTRADA' };
      return { ok: true, dados: action === 'obter' ? selected : JSON.parse(selected.divergencias) };
    }
    if (!['criar', 'registrarContagem', 'encerrar'].includes(action)) return { ok: false, codigo: 'ACAO_DESCONHECIDA' };
    const actor = await session(token, 'write');
    const operation = input.operacaoId ?? input.operation;
    if (!valid(operation) || !Number.isSafeInteger(input.version) || input.version < 0 ||
        input.version >= Number.MAX_SAFE_INTEGER || (action !== 'criar' && !valid(input.id))) throw fail('INVENTARIO_OPERACAO_INVALIDA');
    const identity = action === 'criar' ? [input.obra, input.local, input.itens?.map?.(item => item?.sku)] :
      [input.id, input.sku, input.quantidade];
    const fingerprint = createHash('sha256').update(JSON.stringify([actor, action, input.version, identity])).digest('hex');
    const replay = events => {
      const prior = events.find(event => event.operation === operation);
      if (prior && prior.fingerprint !== fingerprint) throw fail('INVENTARIO_CONFLITO_IDEMPOTENCIA');
      return prior;
    };
    const existing = replay(await store.events());
    if (existing) return { ok: true, dados: existing.note, repetida: true };
    let openingItems;
    if (action === 'criar') {
      if (input.version !== 0 || !valid(input.obra) || !valid(input.local) ||
          !Array.isArray(input.itens) || !input.itens.length || input.itens.length > 25 ||
          input.itens.some(item => !valid(item?.sku))) throw fail('INVENTARIO_DADOS_INVALIDOS');
      const skus = input.itens.map(item => item.sku);
      if (new Set(skus).size !== skus.length) throw fail('INVENTARIO_DADOS_INVALIDOS');
      openingItems = [];
      for (const sku of skus) {
        const balance = await stock.saldo(token, sku, input.local);
        openingItems.push({ sku, saldo: balance.saldo, versaoEstoque: balance.version, quantidade: null });
      }
    }

    return coordinate(async () => {
      const before = await store.events();
      const duplicate = replay(before);
      if (duplicate) return { ok: true, dados: duplicate.note, repetida: true };
      const records = latest(before);
      const id = action === 'criar' ? 'INV-' + String(records.size + 1).padStart(4, '0') : input.id;
      const previous = records.get(id);
      if (action !== 'criar' && !previous) throw fail('ATIVIDADE_NAO_ENCONTRADA');
      if ((previous?.version ?? 0) !== input.version) throw fail('INVENTARIO_CONFLITO_VERSAO');
      const at = clock().toISOString();
      let note;
      if (action === 'criar') {
        note = { id, data: at, obra: input.obra, local: input.local, responsavel: actor,
          status: 'EM_ANDAMENTO', itens: JSON.stringify(openingItems), divergencias: '[]', encerradoEm: '' };
      } else {
        if (previous.note.status !== 'EM_ANDAMENTO') throw fail('ATIVIDADE_CONFIRMADA');
        if (previous.note.responsavel !== actor) throw fail('ACCESS_DENIED');
        const itens = JSON.parse(previous.note.itens);
        if (action === 'registrarContagem') {
          const item = itens.find(line => line.sku === input.sku);
          if (!item || !Number.isSafeInteger(input.quantidade) || input.quantidade < 0) throw fail('INVENTARIO_CONTAGEM_INVALIDA');
          item.quantidade = input.quantidade;
        } else if (itens.some(item => item.quantidade === null)) throw fail('INVENTARIO_CONTAGEM_PENDENTE');
        const divergencias = itens.filter(item => item.quantidade !== null && item.quantidade !== item.saldo)
          .map(item => ({ sku: item.sku, saldo: item.saldo, quantidade: item.quantidade, diferenca: item.quantidade - item.saldo }));
        note = { ...previous.note, itens: JSON.stringify(itens), divergencias: JSON.stringify(divergencias) };
        if (action === 'encerrar') Object.assign(note, { status: 'CONFIRMADA', encerradoEm: at });
      }
      const event = { id, operation, fingerprint, actor, version: input.version + 1, at, action, note };
      let writeError;
      try { await store.append(event); } catch (error) { writeError = error; }
      const after = await store.events().catch(error => { throw writeError ?? error; });
      const persisted = replay(after);
      if (persisted) return { ok: true, dados: persisted.note };
      throw writeError ?? fail('INVENTARIO_NAO_CONFIRMADO');
    });
  };
}

module.exports = { createInventoryEngine };
