'use strict';

const { createHash } = require('node:crypto');
const { createComplementaryMethods } = require('./complementary');
const { createWorkflowMethods } = require('./workflows');
const invalid = code => Object.assign(new Error(code), { code });
const key = value => typeof value === 'string' && /^[\w.-]{1,100}$/.test(value);
const obraFields = ['nome', 'codigo', 'cliente', 'local', 'almoxarifado', 'responsavel', 'status', 'inicio', 'previsao'];

function textFields(input, fields) {
  return Object.fromEntries(fields.filter(field => Object.hasOwn(input, field)).map(field => {
    if (typeof input[field] !== 'string' || input[field].length > 2000) throw invalid('ADMIN_DADOS_INVALIDOS');
    return [field, input[field]];
  }));
}

function latest(events) {
  const records = new Map();
  for (const event of events) {
    if (event.version > (records.get(event.id)?.version ?? 0)) records.set(event.id, event);
  }
  return records;
}

function createAdministrationEngine({ core, stores, coordinate, clock = () => new Date() }) {
  async function authorize(token, module, access) {
    await core.authorizeSession(token, module + ':' + access);
    const session = await core.getSession(token);
    if (!session?.userId) throw invalid('SESSION_INVALID');
    return String(session.userId);
  }

  async function save(token, module, input, prepare) {
    const actor = await authorize(token, module, 'write');
    const { operation, version } = input ?? {};
    if (!key(operation) || !Number.isSafeInteger(version) || version < 0 || version >= Number.MAX_SAFE_INTEGER) {
      throw invalid('ADMIN_OPERACAO_INVALIDA');
    }
    const fingerprint = createHash('sha256').update(JSON.stringify([actor, input])).digest('hex');
    const store = stores[module];
    return coordinate(async () => {
      const replay = events => {
        const event = events.find(item => item.operation === operation);
        if (event && event.fingerprint !== fingerprint) throw invalid('ADMIN_CONFLITO_IDEMPOTENCIA');
        return event;
      };
      const before = await store.events();
      const duplicate = replay(before);
      if (duplicate) return duplicate.response;
      const at = clock().toISOString();
      const { id, current, note, response } = prepare(latest(before), at, actor);
      if ((current?.version ?? 0) !== version) throw invalid('ADMIN_CONFLITO_VERSAO');
      const event = { id, operation, version: version + 1, fingerprint, actor, at,
        action: input.action ?? (version ? 'atualizar' : 'criar'), note, response };
      let writeError;
      try { await store.append(event); } catch (error) { writeError = error; }
      const after = await store.events().catch(error => { throw writeError ?? error; });
      const persisted = replay(after);
      if (persisted) return persisted.response;
      if ((latest(after).get(id)?.version ?? 0) !== version) throw invalid('ADMIN_CONFLITO_VERSAO');
      throw writeError ?? invalid('ADMIN_NAO_CONFIRMADO');
    });
  }

  return {
    ...createComplementaryMethods({ save, authorize, getRecords: async kind => latest(await stores[kind].events()) }),
    ...createWorkflowMethods({ save, authorize, getRecords: async kind => latest(await stores[kind].events()) }),
    async epi(token, action, input = {}) {
      if (['listar', 'fichas', 'obter'].includes(action)) {
        await authorize(token, 'epi', 'read');
        const records = latest(await stores.epi.events());
        if (action === 'obter') {
          const record = records.get(input.id)?.note;
          return record ? { ok: true, dados: record } : { ok: false, codigo: 'NAO_ENCONTRADA' };
        }
        return { ok: true, dados: [...records.values()].map(event => event.note)
          .filter(note => !input.status || note.status === input.status) };
      }
      if (!['salvar', 'criar'].includes(action)) return { ok: false, codigo: 'ACAO_DESCONHECIDA' };
      const { operation, version, id: requestedId } = input;
      const values = textFields(input,
        ['colaborador', 'matricula', 'cargo', 'setor', 'sku', 'item', 'ca', 'entrega', 'validade', 'status']);
      if (input.assinatura) throw invalid('EPI_ASSINATURA_FORA_DO_ENSAIO');
      if (input.qtd !== undefined) {
        const amount = Number(input.qtd);
        if (!Number.isSafeInteger(amount) || amount <= 0) throw invalid('EPI_QUANTIDADE_INVALIDA');
        values.qtd = amount;
      }
      if (requestedId !== undefined && !key(requestedId)) throw invalid('ADMIN_DADOS_INVALIDOS');
      return save(token, 'epi', { operation, version, requestedId, values }, (records, at, actor) => {
        const id = requestedId ?? 'EPI' + String(records.size + 1).padStart(5, '0');
        const current = records.get(id);
        if (requestedId && !current) throw invalid('EPI_FICHA_NAO_ENCONTRADA');
        const note = current ? { ...current.note, ...values } : {
          id, colaborador: '', matricula: '', cargo: '', setor: '', sku: '', item: '', qtd: 1, ca: '',
          entrega: at, validade: '', status: 'ENTREGUE', entreguePor: actor, assinatura: '', ...values
        };
        if (!note.matricula || !note.sku) throw invalid('EPI_IDENTIDADE_INVALIDA');
        return { id, current, note, response: current ? { ok: true, dados: { id, ...values }, atualizado: true } :
          { ok: true, dados: note, criado: true } };
      });
    },

    async ferramentas(token, action, payload = {}) {
      if (['listar', 'obter', 'historico'].includes(action)) {
        await authorize(token, 'ferramentas', 'read');
        const events = await stores.ferramentas.events();
        if (action === 'historico') return { ok: true, dados: events.filter(event => event.id === payload.patrimonio)
          .map(({ action: evento, actor, at, note }) => ({ evento, actor, at, status: note.status })) };
        const records = latest(events);
        if (action === 'listar') return { ok: true, dados: [...records.values()].map(event => event.note)
          .filter(note => !payload.status || payload.status === note.status) };
        const entry = records.get(payload.patrimonio);
        return entry ? { ok: true, dados: entry.note } :
          { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Patrimônio não localizado.' };
      }
      if (!['salvar', 'retirar', 'devolver', 'retornarManutencao'].includes(action)) {
        return { ok: false, codigo: 'ACAO_DESCONHECIDA' };
      }
      const { patrimonio: id, operation, version } = payload;
      if (!key(id)) return { ok: false, codigo: 'SEM_PATRIMONIO', mensagem: 'Informe o patrimônio.' };
      const fields = action === 'salvar'
        ? textFields(payload, ['sku', 'nome', 'categoria', 'marca', 'modelo', 'serie', 'obra', 'local', 'observacao'])
        : textFields(payload, ['condicao', 'observacao']);
      const damaged = action === 'devolver' && (payload.avaria === true || ['AVARIA', 'DANIFICADA'].includes(fields.condicao?.toUpperCase()));
      if (damaged && !fields.observacao?.trim()) throw invalid('SEM_DESCRICAO_DA_AVARIA');
      return save(token, 'ferramentas', { id, operation, version, action, fields, damaged }, (records, at, actor) => {
        const current = records.get(id);
        let note;
        if (action === 'salvar') {
          note = { id, patrimonio: id, status: 'DISPONIVEL', com: '', matricula: '', desde: '',
            ...current?.note, ...fields, atualizadoEm: at, atualizadoPor: actor };
        } else {
          if (!current) throw invalid('FERRAMENTA_NAO_ENCONTRADA');
          const state = current.note;
          if (action === 'retirar') {
            if (state.status !== 'DISPONIVEL') throw invalid(state.status === 'EM_POSSE' ? 'JA_EM_POSSE' : 'FERRAMENTA_INDISPONIVEL');
            note = { ...state, status: 'EM_POSSE', com: actor, matricula: actor, desde: at };
          } else if (action === 'devolver') {
            if (state.status !== 'EM_POSSE') throw invalid('NAO_ESTA_EM_POSSE');
            if (state.com !== actor) throw invalid('ACCESS_DENIED');
            note = { ...state, status: damaged ? 'MANUTENCAO' : 'DISPONIVEL', com: '', matricula: '', desde: '',
              motivo: damaged ? fields.observacao : '' };
          } else {
            if (state.status !== 'MANUTENCAO') throw invalid('FERRAMENTA_FORA_MANUTENCAO');
            note = { ...state, status: 'DISPONIVEL', motivo: '' };
          }
          Object.assign(note, { atualizadoEm: at, atualizadoPor: actor });
        }
        return { id, current, note, response: { ok: true, dados: note } };
      });
    },

    async painel(token, action, payload = {}) {
      if (action === 'carregar') {
        await authorize(token, 'painel', 'read');
        const value = latest(await stores.painel.events()).get('PAINEL_CONFIG')?.note.valor;
        try { return { ok: true, dados: value === undefined ? null : JSON.parse(value) }; }
        catch { return { ok: true, dados: null }; }
      }
      if (action !== 'salvar') return { ok: false, codigo: 'ACAO_DESCONHECIDA' };
      const config = payload.config ?? {};
      if (!config || typeof config !== 'object' || Array.isArray(config)) throw invalid('ADMIN_DADOS_INVALIDOS');
      const valor = JSON.stringify(config);
      if (valor.length > 12000) throw invalid('ADMIN_DADOS_INVALIDOS');
      const id = 'PAINEL_CONFIG';
      return save(token, 'painel', { operation: payload.operation, version: payload.version, valor,
        action: 'PAINEL_CONFIGURADO' }, (records, at) => ({
        id, current: records.get(id), note: { id, chave: id, valor, atualizadoEm: at },
        response: { ok: true, dados: config }
      }));
    },

    async automacao(token, action, payload = {}) {
      if (action === 'regras') {
        await authorize(token, 'automacao', 'read');
        return { ok: true, dados: [...latest(await stores.automacao.events()).values()].map(event => event.note) };
      }
      const { operation, version } = payload;
      if (action === 'alternar') {
        const { id } = payload;
        if (!key(id)) throw invalid('ADMIN_DADOS_INVALIDOS');
        return save(token, 'automacao', { operation, version, id, action: 'AUTOMACAO_ALTERADA' }, records => {
          const current = records.get(id);
          if (!current) throw invalid('REGRA_NAO_ENCONTRADA');
          const ativa = !(current.note.ativa === true || current.note.ativa === 'TRUE');
          return { id, current, note: { ...current.note, ativa }, response: { ok: true, dados: { id, ativa } } };
        });
      }
      if (action !== 'salvar') return { ok: false, codigo: 'ACAO_DESCONHECIDA' };
      const fields = textFields(payload, ['nome', 'evento', 'condicao', 'acaoRegra']);
      const canais = payload.canais ?? [];
      if (!Array.isArray(canais) || canais.length > 32 || canais.some(channel => !key(channel)) ||
          (payload.ativa !== undefined && typeof payload.ativa !== 'boolean')) throw invalid('ADMIN_DADOS_INVALIDOS');
      const ativa = payload.ativa !== false;
      const id = 'AUT-' + createHash('sha256').update(String(operation)).digest('hex').slice(0, 24);
      return save(token, 'automacao', { operation, version, fields, canais, ativa, action: 'AUTOMACAO_CRIADA' }, (records, at) => {
        const { nome = '', evento = '', condicao = '', acaoRegra = '' } = fields;
        const note = { id, nome, evento, condicao, acao: acaoRegra, canais: canais.join(','), ativa, criadoEm: at };
        return { id, current: records.get(id), note, response: { ok: true, dados: note } };
      });
    },

    async config(token, action, input = {}) {
      if (!['obter', 'salvar'].includes(action)) return { ok: false, codigo: 'ACAO_DESCONHECIDA' };
      const { chave, valor } = input;
      if (!key(chave) || chave === 'sku') throw invalid('CONFIG_CHAVE_NAO_SUPORTADA');
      if (action === 'obter') {
        await authorize(token, 'config', 'read');
        const note = latest(await stores.config.events()).get(chave)?.note;
        if (!note) return { ok: true, dados: null };
        try { return { ok: true, dados: JSON.parse(note.valor) }; }
        catch { return { ok: true, dados: note.valor }; }
      }
      if (valor === undefined || typeof valor === 'number' && !Number.isFinite(valor)) throw invalid('CONFIG_VALOR_INVALIDO');
      const text = typeof valor === 'object' ? JSON.stringify(valor) : String(valor);
      if (typeof text !== 'string' || text.length > 12000) throw invalid('CONFIG_VALOR_INVALIDO');
      return save(token, 'config', { operation: input.operation, version: input.version, chave, valor }, (records, at) => ({
        id: chave, current: records.get(chave), note: { id: chave, chave, valor: text, atualizadoEm: at },
        response: { ok: true, dados: valor }
      }));
    },

    async notificacoes(token, action, input = {}) {
      const actor = await authorize(token, 'notificacoes', 'read');
      const session = await core.getSession(token);
      const visible = note => {
        if (note.destinatario && note.destinatario !== actor) return false;
        return !note.perfis || note.perfis.split(',').includes(String(session.role).toUpperCase());
      };
      if (action === 'listar') {
        return { ok: true, dados: [...latest(await stores.notificacoes.events()).values()]
          .filter(event => visible(event.note)).map(event => event.note) };
      }
      if (action === 'criar') {
        const fields = textFields(input, ['evento', 'titulo', 'texto', 'rota', 'destinatario']);
        const roles = input.perfis ?? [];
        if (!Array.isArray(roles) || roles.some(role => !key(role))) throw invalid('NOTIFICACAO_DADOS_INVALIDOS');
        const id = 'NOT-' + createHash('sha256').update(String(input.operation)).digest('hex').slice(0, 24);
        return save(token, 'notificacoes', { operation: input.operation, version: input.version, fields, roles },
          (records, at) => {
            const note = { id, quando: at, evento: '', titulo: '', texto: '', rota: '', destinatario: '',
              ...fields, perfis: roles.map(role => role.toUpperCase()).join(','), lida: false };
            return { id, current: records.get(id), note, response: { ok: true, dados: note } };
          });
      }
      if (action === 'marcarLida') {
        const { id, operation, version } = input;
        return save(token, 'notificacoes', { id, operation, version }, records => {
          const current = records.get(id);
          if (!current || !visible(current.note)) throw invalid('NOTIFICACAO_NAO_ENCONTRADA');
          const note = { ...current.note, lida: true };
          return { id, current, note, response: { ok: true, dados: { id, lida: true } } };
        });
      }
      return { ok: false, codigo: 'ACAO_DESCONHECIDA' };
    },

    async ocorrencias(token, action, input = {}) {
      if (['listar', 'obter'].includes(action)) {
        await authorize(token, 'ocorrencias', 'read');
        const records = latest(await stores.ocorrencias.events());
        if (action === 'listar') {
          return { ok: true, dados: [...records.values()].map(event => event.note)
            .filter(note => !input.status || input.status === note.status) };
        }
        const found = records.get(input.id);
        return found ? { ok: true, dados: found.note } :
          { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Ocorrência não localizado.' };
      }
      if (!['criar', 'salvar'].includes(action)) return { ok: false, codigo: 'ACAO_DESCONHECIDA' };
      const fields = textFields(input, ['titulo', 'categoria', 'prioridade', 'obra', 'local', 'responsavel', 'status', 'descricao']);
      if (input.materiais !== undefined) {
        let materials;
        try { materials = typeof input.materiais === 'string' ? JSON.parse(input.materiais) : input.materiais; }
        catch { throw invalid('OCORRENCIA_MATERIAIS_INVALIDOS'); }
        if (!Array.isArray(materials) || JSON.stringify(materials).length > 8000) throw invalid('OCORRENCIA_MATERIAIS_INVALIDOS');
        fields.materiais = JSON.stringify(materials);
      }
      const { id: requestedId, version, operation } = input;
      return save(token, 'ocorrencias', { requestedId, version, operation, fields }, (records, at, actor) => {
        const id = requestedId ?? '#OC-' + String(records.size + 1).padStart(6, '0');
        const current = records.get(id);
        if (requestedId !== undefined && !current) throw invalid('OCORRENCIA_NAO_ENCONTRADA');
        const note = current ? { ...current.note, ...fields } : {
          id, data: at, titulo: '', categoria: 'Geral', prioridade: 'Média', obra: '', local: '',
          responsavel: '', autor: actor, status: 'ABERTA', descricao: '', materiais: '[]',
          protocoloNecessidade: '', historico: '[]', ...fields
        };
        const response = current ? { ok: true, dados: { id, ...fields }, atualizado: true } :
          { ok: true, dados: note, criado: true };
        return { id, current, note, response };
      });
    },

    async usuarios(token, action, input = {}) {
      if (!['listar', 'contar', 'obter'].includes(action)) return { ok: false, codigo: 'ACAO_DESCONHECIDA' };
      await authorize(token, 'usuarios', 'read');
      const rows = [...latest(await stores.usuarios.events()).values()].map(event => event.note);
      if (action === 'contar') return { ok: true, dados: { total: rows.length } };
      const publicUser = record => {
        const keys = ['id', 'nome', 'email', 'login', 'matricula', 'obra', 'status', 'ativo'];
        const output = Object.fromEntries(keys.filter(field => Object.hasOwn(record, field)).map(field => [field, record[field]]));
        const perfilCore = String(record.perfil || '');
        const map = { ADMINISTRADOR: 'admin', GESTOR: 'gestor', ALMOXARIFE: 'almoxarife', OPERADOR: 'colaborador' };
        return { ...output, perfilCore, perfil: map[perfilCore.toUpperCase()] ?? perfilCore.toLowerCase(),
          biometria: Boolean(record.biometria), facial: Boolean(record.facial) };
      };
      if (action === 'listar') return { ok: true, dados: rows.map(publicUser) };
      const value = String(input.id || input.matricula || input.email || '').trim().toLowerCase();
      if (!value) return { ok: true, dados: null };
      const normalize = item => String(item ?? '').trim().toLowerCase().replace(/^0+(?=\d+$)/, '');
      const matches = rows.filter(row => [row.id, row.email, row.matricula, row.login]
        .some(field => normalize(field) === normalize(value)));
      const selected = matches.length ? matches : rows.filter(row =>
        String(row.email ?? '').split('@')[0].trim().toLowerCase() === value);
      if (selected.length > 1) return { ok: false, codigo: 'USUARIO_IDENTIDADE_AMBIGUA' };
      return { ok: true, dados: selected.length ? publicUser(selected[0]) : null };
    },


    async obras(token, action, input = {}) {
      if (action === 'listar') {
        await authorize(token, 'obras', 'read');
        return { ok: true, dados: [...latest(await stores.obras.events()).values()].map(event => event.note) };
      }
      if (!['salvar', 'criar'].includes(action)) return { ok: false, codigo: 'ACAO_DESCONHECIDA' };
      if (typeof input.nome !== 'string' || !input.nome.trim()) {
        return { ok: false, codigo: 'CAMPO_OBRIGATORIO', mensagem: 'Informe o nome da obra.' };
      }
      const fields = Object.fromEntries(obraFields.filter(field => Object.hasOwn(input, field)).map(field => {
        if (typeof input[field] !== 'string' || input[field].length > 250) throw invalid('OBRA_DADOS_INVALIDOS');
        return [field, input[field]];
      }));
      if (input.id !== undefined && !key(input.id)) throw invalid('OBRA_DADOS_INVALIDOS');
      if (input.avanco !== undefined) {
        if (!Number.isFinite(input.avanco) || input.avanco < 0 || input.avanco > 100) throw invalid('OBRA_DADOS_INVALIDOS');
        fields.avanco = input.avanco;
      }
      return save(token, 'obras', { operation: input.operation, version: input.version, id: input.id, fields }, (records, at) => {
        const id = input.id ?? 'OB' + String(records.size + 1).padStart(2, '0');
        const current = records.get(id);
        if (input.id !== undefined && !current) throw invalid('OBRA_NAO_ENCONTRADA');
        const note = current ? { ...current.note, ...fields } : {
          ...Object.fromEntries(obraFields.map(field => [field, ''])), ...fields,
          status: fields.status || 'Mobilização', id, avanco: 0, criadoEm: at
        };
        const response = current ? { ok: true, dados: { id, ...fields }, atualizado: true }
          : { ok: true, dados: note, criado: true };
        return { id, current, note, response };
      });
    }
  };
}

module.exports = { createAdministrationEngine };
