'use strict';

const { createHash } = require('node:crypto');
const { StorageOperations } = require('../../database/storage-operations');

const fail = code => Object.assign(new Error(code), { code });
const valid = value => typeof value === 'string' && /^[\w-]{1,80}$/.test(value);
const newBalance = () => ({ saldo: 0, reservado: 0 });

function createStockEngine({ core, store, receipts, withdrawals, coordinate = work => work(), epiUsers, clock = () => new Date() }) {
  const queue = new StorageOperations();
  async function authorize(token, access) {
    await core.authorizeSession(token, 'stock:' + access);
    const session = await core.getSession(token);
    if (!session?.userId) throw fail('SESSION_INVALID');
    return String(session.userId);
  }

  async function receivedByLocation(sku, events, withdrawalEvents) {
    const balances = new Map();
    for (const receipt of events ?? await receipts.events()) {
      if (receipt.action !== 'receber' || !valid(receipt.local)) continue;
      for (const item of receipt.movimentos ?? []) {
        if (item.sku !== sku) continue;
        const total = (balances.get(receipt.local) ?? 0) + item.quantidade;
        if (!Number.isSafeInteger(item.quantidade) || item.quantidade <= 0 || !Number.isSafeInteger(total)) {
          throw fail('ESTOQUE_RECEBIMENTO_INVALIDO');
        }
        balances.set(receipt.local, total);
      }
    }
    for (const withdrawal of withdrawalEvents ?? await withdrawals.events()) {
      const movement = withdrawal.retirada;
      if (withdrawal.action !== 'RETIRADA_CONFIRMADA' || movement?.sku !== sku) continue;
      const total = (balances.get(movement.local) ?? 0) - movement.quantidade;
      if (!valid(movement.local) || !Number.isSafeInteger(movement.quantidade) || movement.quantidade <= 0 ||
          !Number.isSafeInteger(total)) throw fail('ESTOQUE_RETIRADA_INVALIDA');
      balances.set(movement.local, total);
    }
    return balances;
  }

  async function movimentar(token, input) {
    const actor = await authorize(token, 'write');
    const { sku, local, destino, action, operation, version, quantidade, original, motivo, epi } = input ?? {};
    if (!valid(sku) || !valid(operation) || !Number.isSafeInteger(version) || version < 0 ||
        version >= Number.MAX_SAFE_INTEGER) throw fail('ESTOQUE_OPERACAO_INVALIDA');
    if (action === 'estorno' ? !valid(original) :
      !valid(local) || !Number.isSafeInteger(quantidade) || quantidade < (action === 'ajuste' ? 0 : 1)) throw fail('ESTOQUE_MOVIMENTO_INVALIDO');
    if (motivo !== undefined && (typeof motivo !== 'string' || !motivo.trim() || motivo.length > 1000)) {
      throw fail('ESTOQUE_MOVIMENTO_INVALIDO');
    }
    if (epi) {
      await core.authorizeSession(token, 'epi:write');
      if (!epiUsers || !['entrega', 'devolucao', 'estorno'].includes(epi.kind) ||
          (epi.kind === 'entrega' ? action !== 'saida' || !valid(epi.usuarioId) :
            !valid(original) || action !== (epi.kind === 'estorno' ? 'estorno' : 'devolucao'))) {
        throw fail('EPI_MOVIMENTO_INVALIDO');
      }
    }
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([actor, sku, local, destino, action, version, quantidade, original, ...(motivo === undefined ? [] : [motivo]), ...(epi ? [epi.kind, epi.usuarioId] : [])])).digest('hex');

    return queue.mutate(() => coordinate(async () => {
      const replay = events => {
        const event = events.find(item => item.operation === operation);
        if (event && event.fingerprint !== fingerprint) throw fail('ESTOQUE_CONFLITO_IDEMPOTENCIA');
        return event;
      };
      const latest = events => events.filter(event => event.id === sku)
        .reduce((prior, event) => event.version > (prior?.version ?? 0) ? event : prior, null);
      const before = await store.events();
      const duplicate = replay(before);
      if (duplicate) return duplicate;
      let epiRecord;
      if (epi?.kind === 'entrega') {
        const user = (await epiUsers.events()).filter(event => event.id === epi.usuarioId)
          .reduce((prior, event) => event.version > (prior?.version ?? 0) ? event : prior, null)?.note;
        if (!user || !user.matricula || user.ativo === false ||
            ['INATIVO', 'BLOQUEADO'].includes(String(user.status || '').toUpperCase())) {
          throw fail('EPI_COLABORADOR_INVALIDO');
        }
        epiRecord = { kind: 'entrega', usuarioId: epi.usuarioId, matricula: String(user.matricula),
          colaborador: String(user.nome || ''), quantidade, local };
      } else if (epi) {
        const source = before.find(event => event.id === sku && event.operation === original && event.epi?.kind === 'entrega');
        if (!source || before.some(event => event.id === sku && event.original === original) ||
            (epi.kind === 'devolucao' && (local !== source.epi.local || quantidade !== source.epi.quantidade))) {
          throw fail('EPI_REVERSAO_INVALIDA');
        }
        epiRecord = { ...source.epi, kind: epi.kind };
      } else if (action === 'estorno' && before.some(event => event.id === sku && event.operation === original && event.epi)) {
        throw fail('EPI_REVERSAO_INVALIDA');
      }
      const previous = latest(before);
      if ((previous?.version ?? 0) !== version) throw fail('ESTOQUE_CONFLITO_VERSAO');
      const balances = new Map(Object.entries(previous?.note.locais ?? {}));
      const received = await receivedByLocation(sku);
      let deltas;
      switch (action) {
        case 'entrada':
        case 'devolucao': deltas = [{ local, saldo: quantidade, reservado: 0 }]; break;
        case 'ajuste': {
          const previousTotal = (balances.get(local)?.saldo ?? 0) + (received.get(local) ?? 0);
          deltas = [{ local, saldo: quantidade - previousTotal, reservado: 0 }];
          break;
        }
        case 'saida': deltas = [{ local, saldo: -quantidade, reservado: 0 }]; break;
        case 'reservar': deltas = [{ local, saldo: 0, reservado: quantidade }]; break;
        case 'liberar': deltas = [{ local, saldo: 0, reservado: -quantidade }]; break;
        case 'retirarReserva': deltas = [{ local, saldo: -quantidade, reservado: -quantidade }]; break;
        case 'transferir':
          if (!valid(destino) || destino === local) throw fail('ESTOQUE_DESTINO_INVALIDO');
          deltas = [{ local, saldo: -quantidade, reservado: 0 }, { local: destino, saldo: quantidade, reservado: 0 }];
          break;
        case 'estorno': {
          const source = before.find(event => event.id === sku && event.operation === original);
          if (!source || source.action === 'estorno' || before.some(event => event.id === sku && event.original === original)) {
            throw fail('ESTOQUE_ESTORNO_INVALIDO');
          }
          deltas = source.deltas.map(delta => ({ local: delta.local, saldo: -delta.saldo, reservado: -delta.reservado }));
          break;
        }
        default: throw fail('ESTOQUE_ACAO_INVALIDA');
      }

      for (const delta of deltas) {
        const prior = balances.get(delta.local) ?? newBalance();
        const saldo = prior.saldo + delta.saldo;
        const reservado = prior.reservado + delta.reservado;
        const total = saldo + (received.get(delta.local) ?? 0);
        if (!Number.isSafeInteger(saldo) || !Number.isSafeInteger(reservado) || !Number.isSafeInteger(total) ||
            total < 0 || reservado < 0 || reservado > total) throw fail('ESTOQUE_SALDO_INSUFICIENTE');
        balances.set(delta.local, { saldo, reservado });
      }

      const event = { id: sku, operation, version: version + 1, fingerprint, action, actor,
        at: clock().toISOString(), ...(motivo === undefined ? {} : { motivo }), original: action === 'estorno' || epi?.kind === 'devolucao' ? original : null, deltas,
        ...(epiRecord ? { epi: epiRecord } : {}),
        note: { id: sku, locais: Object.fromEntries(balances) } };
      let appendError;
      try { await store.append(event); } catch (failure) { appendError = failure; }
      const after = await store.events().catch(failure => { throw appendError ?? failure; });
      const persisted = replay(after);
      if (persisted) return persisted;
      if ((latest(after)?.version ?? 0) !== version) throw fail('ESTOQUE_CONFLITO_VERSAO');
      throw appendError ?? fail('ESTOQUE_GRAVACAO_NAO_CONFIRMADA');
    }));
  }

  return {
    movimentar,
    async historicoEpi(token, usuarioId) {
      await core.authorizeSession(token, 'epi:read');
      if (usuarioId !== undefined && !valid(usuarioId)) throw fail('EPI_COLABORADOR_INVALIDO');
      return (await store.events()).filter(event => event.epi && (usuarioId === undefined || event.epi.usuarioId === usuarioId))
        .map(({ id, operation, original, actor, at, epi }) => ({ sku: id, operation, original, actor, at, ...epi }));
    },
    async movimentacoes(token, { sku, limite = 200, somenteSaidas = false } = {}) {
      await authorize(token, 'read');
      if ((sku !== undefined && !valid(sku)) || !Number.isSafeInteger(limite) || limite < 1 || limite > 200) {
        throw fail('ESTOQUE_OPERACAO_INVALIDA');
      }
      return coordinate(async () => {
        const events = await store.events();
        const movements = events.flatMap(event => (event.deltas ?? []).map(delta => ({
          id: event.operation, data: event.at, sku: event.id, tipo: event.action.toUpperCase(),
          qtd: delta.saldo, local: delta.local, usuario: event.actor,
          ...(event.epi ? { epi: event.epi, original: event.original } : {}), ...(event.motivo ? { observacao: event.motivo } : {})
        })));
        for (const receipt of await receipts.events()) {
          if (receipt.action !== 'receber' || !valid(receipt.local)) continue;
          for (const item of receipt.movimentos ?? []) movements.push({
            id: receipt.operation, data: receipt.at, sku: item.sku, tipo: 'ENTRADA',
            qtd: item.quantidade, local: receipt.local, usuario: receipt.actor, documento: receipt.exclusive
          });
        }
        for (const event of await withdrawals.events()) {
          const movement = event.retirada;
          if (event.action !== 'RETIRADA_CONFIRMADA' || !movement) continue;
          movements.push({ id: event.operation, data: event.at, sku: movement.sku, tipo: 'SAIDA',
            qtd: -movement.quantidade, local: movement.local, usuario: event.actor, documento: event.reserva.protocolo });
        }
        const filtered = movements.filter(movement =>
          (sku === undefined || movement.sku === sku) && (!somenteSaidas || movement.qtd < 0));
        filtered.sort((a, b) => Date.parse(b.data) - Date.parse(a.data));
        return { ok: true, dados: filtered.slice(0, limite) };
      });
    },
    async saldos(token, skus, local) {
      await authorize(token, 'read');
      if (!valid(local) || !Array.isArray(skus) || skus.some(sku => !valid(sku))) throw fail('ESTOQUE_OPERACAO_INVALIDA');
      return coordinate(async () => {
        const [moves, received, delivered] = await Promise.all([store.events(), receipts.events(), withdrawals.events()]);
        const latest = new Map();
        for (const entry of moves) {
          if (entry.version > (latest.get(entry.id)?.version ?? 0)) latest.set(entry.id, entry);
        }
        const result = new Map();
        for (const sku of new Set(skus)) {
          const entry = latest.get(sku);
          const snapshot = entry?.note.locais ?? {};
          const balance = Object.hasOwn(snapshot, local) ? snapshot[local] : newBalance();
          const saldo = balance.saldo + ((await receivedByLocation(sku, received, delivered)).get(local) ?? 0);
          if (!Number.isSafeInteger(saldo) || saldo < balance.reservado) throw fail('ESTOQUE_SALDO_INVALIDO');
          result.set(sku, { saldo, reservado: balance.reservado, version: entry?.version ?? 0 });
        }
        return result;
      });
    },
    async saldo(token, sku, local) {
      await authorize(token, 'read');
      if (!valid(sku) || !valid(local)) throw fail('ESTOQUE_OPERACAO_INVALIDA');
      return coordinate(async () => {
        const latest = (await store.events()).reduce((prior, event) =>
          event.id === sku && event.version > (prior?.version ?? 0) ? event : prior, null);
        const balance = Object.hasOwn(latest?.note.locais ?? {}, local) ? latest.note.locais[local] : newBalance();
        const saldo = balance.saldo + ((await receivedByLocation(sku)).get(local) ?? 0);
        if (!Number.isSafeInteger(saldo) || saldo < balance.reservado) throw fail('ESTOQUE_SALDO_INVALIDO');
        return { saldo, reservado: balance.reservado, disponivel: saldo - balance.reservado, version: latest?.version ?? 0 };
      });
    }
  };
}

module.exports = { createStockEngine };
