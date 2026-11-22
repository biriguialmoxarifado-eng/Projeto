'use strict';

const { createHash } = require('node:crypto');
const fail = code => Object.assign(new Error(code), { code });
const valid = value => typeof value === 'string' && /^[\w.-]{1,80}$/.test(value);

function createRequestEngine({ core, store, stock, coordinate, clock = () => new Date() }) {
  async function authorize(token, mode) {
    await core.authorizeSession(token, 'requests:' + mode);
    const session = await core.getSession(token);
    if (!session?.userId) throw fail('SESSION_INVALID');
    return String(session.userId);
  }

  return {
    async listar(token) {
      await authorize(token, 'read');
      return { ok: true, dados: (await store.events()).map(event => ({
        ...event.note, itens: JSON.parse(event.note.itens)
      })) };
    },

    async criar(token, payload) {
      const actor = await authorize(token, 'write');
      const { operation, local, solicitante = actor, matricula = '', obra = '', observacao = '' } = payload ?? {};
      if (!valid(operation) || !valid(local) || [solicitante, matricula, obra, observacao].some(value =>
        typeof value !== 'string' || value.length > 250) || !solicitante.trim()) throw fail('SOLICITACAO_INVALIDA');
      let itens = payload.itens;
      if (typeof itens === 'string') {
        try { itens = JSON.parse(itens); } catch { throw fail('SOLICITACAO_ITENS_INVALIDOS'); }
      }
      if (!Array.isArray(itens) || !itens.length) return { ok: false, codigo: 'SEM_ITENS', mensagem: 'A solicitação precisa de itens.' };
      if (itens.length > 50) throw fail('SOLICITACAO_ITENS_INVALIDOS');
      itens = itens.map(item => {
        const sku = item?.sku || item?.codigo, qtd = Number(item?.qtd), preco = Number(item?.preco || item?.valorUnitario || 0);
        if (!valid(sku) || !Number.isSafeInteger(qtd) || qtd <= 0 || !Number.isFinite(preco) || preco < 0 ||
            (item.nome !== undefined && (typeof item.nome !== 'string' || item.nome.length > 250))) {
          throw fail('SOLICITACAO_ITENS_INVALIDOS');
        }
        return { sku, qtd, preco, nome: item.nome ?? sku };
      });
      const fingerprint = createHash('sha256').update(JSON.stringify([actor, local, solicitante, matricula, obra, observacao, itens])).digest('hex');
      const replay = events => {
        const prior = events.find(event => event.operation === operation);
        if (prior && prior.fingerprint !== fingerprint) throw fail('SOLICITACAO_CONFLITO_IDEMPOTENCIA');
        return prior;
      };
      const prior = replay(await store.events());
      if (prior) return prior.response;
      const semSaldo = [];
      const totals = new Map();
      for (const item of itens) {
        const total = (totals.get(item.sku) ?? 0) + item.qtd;
        if (!Number.isSafeInteger(total)) throw fail('SOLICITACAO_ITENS_INVALIDOS');
        totals.set(item.sku, total);
      }
      for (const [sku, qtd] of totals) {
        const { disponivel } = await stock.saldo(token, sku, local);
        if (disponivel < qtd) semSaldo.push(sku + ' — há ' + disponivel + ', pedido ' + qtd);
      }

      return coordinate(async () => {
        const before = await store.events();
        const duplicate = replay(before);
        if (duplicate) return duplicate.response;
        const number = String(before.length + 1).padStart(6, '0');
        const id = '#SOL-' + number, protocolo = '#RES-' + number, at = clock().toISOString();
        const valor = itens.reduce((sum, item) => sum + item.qtd * item.preco, 0);
        if (!Number.isFinite(valor)) throw fail('SOLICITACAO_ITENS_INVALIDOS');
        const common = { data: at, solicitante, matricula, obra, itens: JSON.stringify(itens), valor };
        const reserva = { ...common, protocolo, centro: '', projeto: '', motivo: 'Solicitação ' + id,
          status: 'PENDENTE_APROVACAO', aprovadoPor: '', aprovadoEm: '', retiradoPor: '', retiradoEm: '',
          observacao: semSaldo.length ? 'Sem saldo: ' + semSaldo.join(' | ') : '' };
        const note = { ...common, id, status: 'CONVERTIDA', observacao: 'Reserva ' + protocolo, reserva: protocolo };
        const response = { ok: true, dados: { ...common, id, status: 'ABERTA', observacao, reserva: protocolo },
          reserva: { protocolo, semSaldo, reserva } };
        const event = { id, version: 1, actor, at, operation, fingerprint,
          action: 'solicitacaoCriada', note, reserva, response };
        let writeError;
        try { await store.append(event); } catch (error) { writeError = error; }
        const after = await store.events().catch(error => { throw writeError ?? error; });
        const persisted = replay(after);
        if (persisted) return persisted.response;
        throw writeError ?? fail('SOLICITACAO_NAO_CONFIRMADA');
      });
    }
  };
}

module.exports = { createRequestEngine };
