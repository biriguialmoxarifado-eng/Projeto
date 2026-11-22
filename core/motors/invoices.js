'use strict';

const { createHash } = require('node:crypto');
const { StorageOperations } = require('../../database/storage-operations');

const TEST_TABLES = { nf: 'NF_CORE_TESTE', receiving: 'RECEBIMENTO_CORE_TESTE', stock: 'ESTOQUE_CORE_TESTE', itens: 'ITENS_CORE_TESTE', fornecedores: 'FORNECEDORES_CORE_TESTE', categorias: 'CATEGORIAS_CORE_TESTE' };
const HEADERS = ['EVENTO_JSON'];
const hash = value => createHash('sha256').update(value).digest('hex');
const digits = value => String(value ?? '').replace(/\D/g, '');
const fail = code => Object.assign(new Error(code), { code });

function normalize(note) {
  if (!note || typeof note !== 'object' || Array.isArray(note)) throw fail('NF_INVALIDA');
  const numero = digits(note.numero);
  const serie = digits(note.serie) || '0';
  const cnpj = digits(note.cnpj);
  const chave = digits(note.chave);
  const itens = note.listaItens ?? note.itens;
  if (!numero || !Array.isArray(itens) || !itens.length ||
      itens.some(item => !item || typeof item !== 'object' || Array.isArray(item) ||
        !(item.descricao || item.sku || item.codigo))) throw fail('NF_INVALIDA');
  const id = chave.length >= 20 ? 'NFE:' + chave : 'NF:' + numero + '-' + serie + (cnpj ? '-' + cnpj : '');
  const { listaItens, ...fields } = note;
  return { ...fields, numero, serie, cnpj, chave, id, itens };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

class TestInvoiceStore {
  constructor(provider, kind = 'nf') {
    if (!provider.testOnly || !Object.hasOwn(TEST_TABLES, kind)) throw fail('NF_DESTINO_INSEGURO');
    this.table = TEST_TABLES[kind];
    this.kind = kind;
    this.provider = provider;
  }

  async target() {
    const { provider } = this;
    const id = provider.testSpreadsheetId;
    provider.validateId(id, 'ALMOXA_TEST_SHEET_ID');
    if (id === provider.spreadsheetId) throw fail('NF_DESTINO_INSEGURO');
    const metadata = await provider.metadata(id);
    const tab = metadata.sheets?.find(item => item.properties.title === this.table);
    if (metadata.spreadsheetId !== id || metadata.properties?.title !== 'ALMOXA_TESTE_CORE' || !tab) {
      throw fail('NF_DESTINO_INSEGURO');
    }
    return { id, sheetId: tab.properties.sheetId };
  }

  async events() {
    const { id } = await this.target();
    const range = encodeURIComponent("'" + this.table + "'!A:A");
    const { values = [] } = await this.provider.request(id, '/values/' + range + '?valueRenderOption=UNFORMATTED_VALUE');
    if (values[0]?.[0] !== HEADERS[0]) throw fail('NF_SCHEMA_INVALIDO');
    try {
      return values.slice(1).map(row => {
        const event = JSON.parse(row[0]);
        if (!event.id || !event.actor || !event.operation || !event.fingerprint ||
            !Number.isSafeInteger(event.version) || event.version < 1 || event.note?.id !== event.id) {
          throw fail('NF_HISTORICO_INVALIDO');
        }
        return event;
      });
    } catch {
      throw fail('NF_HISTORICO_INVALIDO');
    }
  }

  async hasReceipt(invoiceId) {
    const { id } = await this.target();
    const marker = 'receiving_nf_' + hash(invoiceId);
    const { namedRanges } = await this.provider.request(id, '?fields=namedRanges(namedRangeId)');
    return (namedRanges ?? []).some(range => range.namedRangeId === marker);
  }

  async append(event) {
    const { id, sheetId } = await this.target();
    const encoded = JSON.stringify(event);
    if (encoded.length > 45000) throw fail('NF_LIMITE_DE_TAMANHO');
    const markers = [
      this.kind + '_op_' + hash(event.operation),
      this.kind + '_version_' + hash(event.id + ':' + event.version)
    ];
    if (this.kind === 'nf' && event.version > 1) {
      markers.push('nf_claim_' + hash(event.id + ':' + (event.version - 1)));
    }
    if (this.kind === 'receiving' && event.exclusive) {
      markers.push('nf_claim_' + hash(event.exclusive + ':' + event.nfVersion));
      markers.push('receiving_nf_' + hash(event.exclusive));
    }
    return this.provider.request(id, ':batchUpdate', {
      auth: this.provider.writeAuth,
      data: { requests: [
        ...markers.map(name => ({ addNamedRange: { namedRange: {
          name, namedRangeId: name, range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 }
        } } })),
        { appendCells: {
          sheetId, rows: [{ values: [{ userEnteredValue: { stringValue: encoded } }] }], fields: 'userEnteredValue'
        } }
      ] }
    });
  }
}

function current(events, id) {
  return events.filter(event => event.id === id).sort((a, b) => b.version - a.version)[0];
}

function createInvoiceEngine({ core, storage, coordinate = work => work(), clock = () => new Date() }) {
  const queue = new StorageOperations();
  async function authorize(token, action) {
    await core.authorizeSession(token, 'nf:' + action);
    const session = await core.getSession(token);
    if (!session?.userId) throw fail('SESSION_INVALID');
    return String(session.userId);
  }

  async function write(token, input, restore) {
    const actor = await authorize(token, 'write');
    const { operation, version } = input ?? {};
    if (typeof operation !== 'string' || !/^[\w-]{1,80}$/.test(operation) ||
        !Number.isSafeInteger(version) || version < 0 || version >= Number.MAX_SAFE_INTEGER ||
        (restore && (!Number.isSafeInteger(input.fromVersion) || input.fromVersion < 1 || input.fromVersion >= version))) {
      throw fail('NF_OPERACAO_INVALIDA');
    }
    const proposed = restore ? null : normalize(input.note);
    const id = restore ? input.id : proposed.id;
    if (typeof id !== 'string' || !/^(?:NF|NFE):[\d-]{1,120}$/.test(id)) throw fail('NF_INVALIDA');
    const fingerprint = hash(JSON.stringify(canonical({
      actor, id, version, action: restore ? 'recuperar' : 'salvar', fromVersion: input.fromVersion, note: proposed
    })));
    return queue.mutate(() => coordinate(async () => {
      const replay = events => {
        const found = events.find(event => event.operation === operation);
        if (found && found.fingerprint !== fingerprint) throw fail('NF_CONFLITO_IDEMPOTENCIA');
        return found;
      };
      const before = await storage.events();
      const previous = replay(before);
      if (previous) return previous;
      if ((current(before, id)?.version ?? 0) !== version) throw fail('NF_CONFLITO_VERSAO');
      if (version && await storage.hasReceipt(id)) throw fail('NF_RECEBIDA');
      const note = restore ? before.find(e => e.id === id && e.version === input.fromVersion)?.note : proposed;
      if (!note) throw fail('NF_VERSAO_INEXISTENTE');
      const event = {
        id, operation, fingerprint, version: version + 1,
        action: restore ? 'recuperar' : (version ? 'atualizar' : 'criar'),
        actor, at: clock().toISOString(), note
      };
      let appendError;
      try { await storage.append(event); } catch (error) { appendError = error; }
      const after = await storage.events().catch(error => { throw appendError ?? error; });
      const persisted = replay(after);
      if (persisted) return persisted;
      if ((current(after, id)?.version ?? 0) !== version) throw fail('NF_CONFLITO_VERSAO');
      if (version && await storage.hasReceipt(id)) throw fail('NF_RECEBIDA');
      throw appendError ?? fail('NF_GRAVACAO_NAO_CONFIRMADA');
    }));
  }

  return {
    async consultar(token, id) {
      await authorize(token, 'read');
      return current(await storage.events(), id) ?? null;
    },
    async listar(token) {
      await authorize(token, 'read');
      const events = await storage.events();
      const latest = new Map();
      for (const event of events) {
        if ((latest.get(event.id)?.version ?? 0) < event.version) latest.set(event.id, event);
      }
      return [...latest.values()];
    },
    salvar: (token, input) => write(token, input, false),
    recuperar: (token, input) => write(token, input, true)
  };
}

module.exports = { createInvoiceEngine, TestInvoiceStore };
