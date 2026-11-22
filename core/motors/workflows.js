'use strict';

const { createHash } = require('node:crypto');
const fail = code => Object.assign(new Error(code), { code });
const modes = {
  projetos: {
    fields: ['nome', 'obra', 'responsavel', 'status', 'inicio', 'previsao', 'centro', 'descricao'],
    json: { materiais: [], observacoes: [] },
    defaults: { nome: '', obra: '', responsavel: '', status: 'EM_ANDAMENTO', progresso: 0, inicio: '', previsao: '', centro: '', descricao: '' },
    aliases: { detalhe: 'obter' },
    id: count => 'PRJ-' + String(count).padStart(3, '0')
  },
  relatorios: {
    fields: ['nome', 'tipo', 'formato'], json: { parametros: {} },
    defaults: { nome: 'Relatório', tipo: 'Geral', formato: 'PDF' },
    aliases: { gerados: 'listar', registrar: 'salvar' },
    id: count => 'REL' + String(count).padStart(5, '0')
  },
  mural: {
    fields: ['titulo', 'categoria', 'data', 'obra', 'atividade', 'responsavel', 'descricao'], json: { fotos: [] },
    defaults: { titulo: '', categoria: 'Comunicado', obra: '', atividade: '', responsavel: '', descricao: '' },
    aliases: {},
    id: (_count, operation) => 'PUB-' + createHash('sha256').update(String(operation)).digest('hex').slice(0, 24)
  }
};

function createWorkflowMethods({ save, authorize, getRecords }) {
  async function call(kind, token, action, payload = {}) {
    const spec = modes[kind];
    action = Object.hasOwn(spec.aliases, action) ? spec.aliases[action] : action;
    if (action === 'listar' || action === 'obter') {
      await authorize(token, kind, 'read');
      const records = [...(await getRecords(kind)).values()].filter(event => !event.note.excluido);
      if (action === 'obter') {
        const event = records.find(row => row.id === payload.id);
        return event ? { ok: true, dados: event.note } : { ok: false, codigo: 'NAO_ENCONTRADA' };
      }
      const filtered = records.map(event => event.note).filter(note =>
        kind === 'mural' || !payload.status || note.status === payload.status);
      return { ok: true, dados: kind === 'mural' ? filtered.map(note => ({ ...note, fotos: JSON.parse(note.fotos) })) : filtered };
    }
    if (!['criar', 'salvar', 'excluir'].includes(action)) return { ok: false, codigo: 'ACAO_DESCONHECIDA' };
    const { id: requested, operation, version } = payload;
    if ((requested !== undefined || action === 'excluir') &&
        (typeof requested !== 'string' || !/^[\w-]{1,100}$/.test(requested))) throw fail('ADMIN_DADOS_INVALIDOS');
    const values = Object.fromEntries(spec.fields.filter(field => Object.hasOwn(payload, field)).map(field => {
      if (typeof payload[field] !== 'string' || payload[field].length > 2000) throw fail('ADMIN_DADOS_INVALIDOS');
      return [field, payload[field]];
    }));
    if (kind === 'projetos' && payload.progresso !== undefined) {
      if (!Number.isFinite(payload.progresso) || payload.progresso < 0 || payload.progresso > 100) throw fail('ADMIN_DADOS_INVALIDOS');
      values.progresso = payload.progresso;
    }
    for (const [field, fallback] of Object.entries(spec.json)) {
      if (!Object.hasOwn(payload, field)) continue;
      let value;
      try { value = typeof payload[field] === 'string' ? JSON.parse(payload[field]) : payload[field]; }
      catch { throw fail('ADMIN_DADOS_INVALIDOS'); }
      if (!value || typeof value !== 'object' || Array.isArray(value) !== Array.isArray(fallback)) throw fail('ADMIN_DADOS_INVALIDOS');
      values[field] = JSON.stringify(value);
      if (values[field].length > 12000) throw fail('ADMIN_DADOS_INVALIDOS');
    }
    return save(token, kind, { requested, operation, version, action, values }, (records, at, actor) => {
      const id = requested ?? spec.id(records.size + 1, operation);
      const current = records.get(id);
      if ((requested && !current) || current?.note.excluido) throw fail('REGISTRO_NAO_ENCONTRADO');
      if (action === 'excluir') return { id, current, note: { ...current.note, excluido: true },
        response: { ok: true, dados: kind === 'mural' ? { id, excluido: true } : { excluido: true } } };
      const defaults = Object.fromEntries(Object.entries(spec.json).map(([field, value]) => [field, JSON.stringify(value)]));
      const provenance = kind === 'projetos' ? {} : { data: at, autor: actor };
      if (kind === 'mural') provenance.criadoEm = at;
      const note = current ? { ...current.note, ...values } : { id, ...spec.defaults, ...defaults, ...provenance, ...values };
      return { id, current, note, response: current ? { ok: true, dados: { id, ...values }, atualizado: true } :
        { ok: true, dados: note, criado: true } };
    });
  }
  return Object.fromEntries(Object.keys(modes).map(kind => [kind,
    (token, action, payload) => call(kind, token, action, payload)]));
}

module.exports = { createWorkflowMethods };
