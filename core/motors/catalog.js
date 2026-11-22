'use strict';

const { createHash } = require('node:crypto');

const fail = code => Object.assign(new Error(code), { code });
const validKey = id => typeof id === 'string' && /^[\w.-]{1,80}$/.test(id);
const fields = {
  categorias: ['nome', 'icone', 'cor', 'visivel'],
  itens: ['sku', 'descricao', 'codigoBarras', 'categoria', 'subcategoria', 'marca', 'modelo', 'unidade', 'ncm', 'status', 'valorUnitario', 'fornecedor'],
  fornecedores: ['cnpj', 'razaoSocial', 'nomeFantasia', 'email', 'telefone', 'contato', 'categoria', 'prazoEntrega', 'status']
};

function createCatalogEngine({ core, stores, coordinate, clock = () => new Date() }) {
  function select(kind) {
    if (!Object.hasOwn(fields, kind)) throw fail('CADASTRO_INVALIDO');
    return stores[kind];
  }

  async function session(token, mode) {
    await core.authorizeSession(token, 'catalog:' + mode);
    const session = await core.getSession(token);
    if (!session?.userId) throw fail('SESSION_INVALID');
    return String(session.userId);
  }

  function current(events, id) {
    return events.reduce((latest, event) =>
      event.id === id && event.version > (latest?.version ?? 0) ? event : latest, null);
  }

  return {
    async salvar(token, kind, input) {
      const store = select(kind);
      const actor = await session(token, 'write');
      const { operation, version, data } = input ?? {};
      if (!validKey(operation) || !Number.isSafeInteger(version) || version < 0 ||
          version >= Number.MAX_SAFE_INTEGER || !data || typeof data !== 'object' || Array.isArray(data)) {
        throw fail('CADASTRO_OPERACAO_INVALIDA');
      }
      const id = kind === 'categorias' ? (data.id ?? 'CAT-' + createHash('sha256').update(operation).digest('hex').slice(0, 24))
        : kind === 'itens' ? data.sku : String(data.cnpj ?? '').replace(/\D/g, '');
      const name = kind === 'categorias' ? data.nome : kind === 'itens' ? data.descricao : data.razaoSocial;
      if (!validKey(id) || (kind === 'fornecedores' && id.length !== 14) ||
          typeof name !== 'string' || !name.trim()) throw fail('CADASTRO_DADOS_INVALIDOS');
      const changes = Object.fromEntries(fields[kind].filter(key => Object.hasOwn(data, key))
        .map(key => {
          if (key === 'visivel' ? typeof data[key] !== 'boolean' :
            typeof data[key] !== 'string' && !Number.isFinite(data[key])) throw fail('CADASTRO_DADOS_INVALIDOS');
          return [key, data[key]];
        }));
      if (kind === 'fornecedores') changes.cnpj = id;
      const fingerprint = createHash('sha256').update(JSON.stringify([actor, id, version, changes])).digest('hex');
      return coordinate(async () => {
        const replay = events => {
          const event = events.find(item => item.operation === operation);
          if (event && event.fingerprint !== fingerprint) throw fail('CADASTRO_CONFLITO_IDEMPOTENCIA');
          return event;
        };
        const before = await store.events();
        const duplicate = replay(before);
        if (duplicate) return duplicate;
        const previous = current(before, id);
        if ((previous?.version ?? 0) !== version) throw fail('CADASTRO_CONFLITO_VERSAO');
        const at = clock().toISOString();
        if (kind === 'categorias') {
          const sameName = before.some(event => event.id !== id &&
            event === current(before, event.id) && String(event.note.nome).toLowerCase() === name.toLowerCase());
          if (sameName) throw fail('CATEGORIA_DUPLICADA');
          if (!previous) {
            changes.icone ||= 'caixa';
            changes.cor ||= 'ico-navy';
            changes.visivel ??= true;
            changes.criadoEm = at;
          }
        }
        const event = { id, operation, version: version + 1, fingerprint, actor, at,
          action: version ? 'atualizar' : 'criar', note: { ...previous?.note, ...changes, id } };
        let writeError;
        try { await store.append(event); } catch (error) { writeError = error; }
        const after = await store.events().catch(error => { throw writeError ?? error; });
        const persisted = replay(after);
        if (persisted) return persisted;
        if ((current(after, id)?.version ?? 0) !== version) throw fail('CADASTRO_CONFLITO_VERSAO');
        throw writeError ?? fail('CADASTRO_NAO_CONFIRMADO');
      });
    },
    async obter(token, kind, key) {
      await session(token, 'read');
      const store = select(kind);
      const id = kind === 'fornecedores' ? String(key ?? '').replace(/\D/g, '') : key;
      if (!validKey(id) || (kind === 'fornecedores' && id.length !== 14)) throw fail('CADASTRO_DADOS_INVALIDOS');
      return current(await store.events(), id);
    },
    async consultarLegado(token, kind, action, payload = {}) {
      select(kind);
      if (action === 'listar') {
        return { ok: true, dados: (await this.listar(token, kind)).map(event => event.note) };
      }
      if (kind === 'itens' && action === 'obter') {
        const event = await this.obter(token, kind, payload.sku ?? payload.id);
        return event ? { ok: true, dados: event.note } : { ok: false, codigo: 'ITEM_NAO_ENCONTRADO' };
      }
      if (kind === 'fornecedores' && action === 'porCnpj') {
        const event = await this.obter(token, kind, payload.cnpj);
        return event ? { ok: true, dados: event.note, cadastrado: true } : {
          ok: true, dados: null, cadastrado: false, mensagem: 'Fornecedor não cadastrado.', cnpj: payload.cnpj
        };
      }
      return { ok: false, codigo: 'ACAO_DESCONHECIDA' };
    },
    async listar(token, kind) {
      await session(token, 'read');
      const latest = new Map();
      for (const event of await select(kind).events()) {
        if (event.version > (latest.get(event.id)?.version ?? 0)) latest.set(event.id, event);
      }
      return [...latest.values()];
    }
  };
}

module.exports = { createCatalogEngine };
