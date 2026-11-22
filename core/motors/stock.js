'use strict';

const { createHash } = require('node:crypto');
const { StorageOperations } = require('../../database/storage-operations');

const fail = code => Object.assign(new Error(code), { code });
const valid = value => typeof value === 'string' && /^[\w-]{1,80}$/.test(value);
const newBalance = () => ({ saldo: 0, reservado: 0 });

function createStockEngine({ core, store, coordinate = work => work(), clock = () => new Date() }) {
  const queue = new StorageOperations();
  async function authorize(token, access) {
    await core.authorizeSession(token, 'stock:' + access);
    const session = await core.getSession(token);
    if (!session?.userId) throw fail('SESSION_INVALID');
    return String(session.userId);
  }

  async function movimentar(token, input) {
    const actor = await authorize(token, 'write');
    const { sku, local, destino, action, operation, version, quantidade, original } = input ?? {};
    if (!valid(sku) || !valid(operation) || !Number.isSafeInteger(version) || version < 0 ||
        version >= Number.MAX_SAFE_INTEGER) throw fail('ESTOQUE_OPERACAO_INVALIDA');
    if (action === 'estorno' ? !valid(original) :
      !valid(local) || !Number.isSafeInteger(quantidade) || quantidade <= 0) throw fail('ESTOQUE_MOVIMENTO_INVALIDO');
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([actor, sku, local, destino, action, version, quantidade, original])).digest('hex');

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
      const previous = latest(before);
      if ((previous?.version ?? 0) !== version) throw fail('ESTOQUE_CONFLITO_VERSAO');
      const balances = new Map(Object.entries(previous?.note.locais ?? {}));
      let deltas;
      switch (action) {
        case 'entrada':
        case 'devolucao': deltas = [{ local, saldo: quantidade, reservado: 0 }]; break;
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
        if (!Number.isSafeInteger(saldo) || !Number.isSafeInteger(reservado) ||
            saldo < 0 || reservado < 0 || reservado > saldo) throw fail('ESTOQUE_SALDO_INSUFICIENTE');
        balances.set(delta.local, { saldo, reservado });
      }

      const event = { id: sku, operation, version: version + 1, fingerprint, action, actor,
        at: clock().toISOString(), original: action === 'estorno' ? original : null, deltas,
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
    async saldo(token, sku, local) {
      await authorize(token, 'read');
      if (!valid(sku) || !valid(local)) throw fail('ESTOQUE_OPERACAO_INVALIDA');
      const latest = (await store.events()).reduce((prior, event) =>
        event.id === sku && event.version > (prior?.version ?? 0) ? event : prior, null);
      const balance = Object.hasOwn(latest?.note.locais ?? {}, local) ? latest.note.locais[local] : newBalance();
      return { ...balance, disponivel: balance.saldo - balance.reservado, version: latest?.version ?? 0 };
    }
  };
}

module.exports = { createStockEngine };
