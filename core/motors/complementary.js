'use strict';

const { createHash } = require('node:crypto');

const fail = code => Object.assign(new Error(code), { code });
const key = value => typeof value === 'string' && /^[\w.-]{1,100}$/.test(value);
const identifier = (prefix, operation) =>
  prefix + '-' + createHash('sha256').update(String(operation)).digest('hex').slice(0, 24);
const error = (codigo, mensagem) => ({ ok: false, codigo, mensagem });

function fields(input, names) {
  return Object.fromEntries(names.filter(name => Object.hasOwn(input, name)).map(name => {
    if (typeof input[name] !== 'string' || input[name].length > 1000) throw fail('ADMIN_DADOS_INVALIDOS');
    return [name, input[name]];
  }));
}

function active(records) {
  return [...records.values()].filter(event => !event.note.excluido);
}

function createComplementaryMethods({ save, authorize, getRecords }) {
  function remove(token, kind, input, id, field = 'id') {
    if (!key(id)) throw fail('ADMIN_DADOS_INVALIDOS');
    return save(token, kind, { operation: input.operation, version: input.version, id, action: 'excluir' }, records => {
      const current = records.get(id);
      if (!current || current.note.excluido) throw fail('REGISTRO_NAO_ENCONTRADO');
      return { id, current, note: { ...current.note, excluido: true },
        response: { ok: true, dados: { [field]: id, excluido: true } } };
    });
  }

  return {
    async calendario(token, action, data = {}) {
      if (action === 'listar') {
        await authorize(token, 'calendario', 'read');
        return { ok: true, dados: active(await getRecords('calendario')).map(event => event.note) };
      }
      if (action === 'excluir') return remove(token, 'calendario', data, data.id);
      if (!['criar', 'salvar'].includes(action)) return error('ACAO_DESCONHECIDA');
      const input = fields(data, ['titulo', 'tipo', 'data', 'hora', 'responsavel', 'projeto', 'prioridade', 'obs']);
      if (!input.titulo?.trim() || !input.data) return error('CAMPO_OBRIGATORIO', 'Informe o título e a data do evento.');
      const { operation, version } = data;
      const id = identifier('EV', operation);
      return save(token, 'calendario', { operation, version, input }, (records, _at, actor) => {
        const note = { id, tipo: 'Atividade', hora: '', responsavel: '', projeto: '', prioridade: 'Média', obs: '',
          ...input, status: 'PROGRAMADO', criadoPor: actor };
        return { id, current: records.get(id), note, response: { ok: true, dados: note, criado: true } };
      });
    },

    async centros(token, action, data = {}) {
      const publicRow = ({ id, ...note }) => note;
      if (action === 'listar') {
        await authorize(token, 'centros', 'read');
        return { ok: true, dados: active(await getRecords('centros')).map(event => publicRow(event.note)) };
      }
      if (action === 'excluir') return remove(token, 'centros', data, data.codigo, 'codigo');
      if (action !== 'salvar') return error('ACAO_DESCONHECIDA');
      const input = fields(data, ['codigo', 'nome', 'obra', 'resp']);
      if (!key(input.codigo) || !input.nome?.trim()) return error('CAMPO_OBRIGATORIO', 'Código e frente de serviço são obrigatórios.');
      if (data.orcamento !== undefined) {
        const amount = Number(data.orcamento);
        if (!Number.isFinite(amount)) throw fail('ADMIN_DADOS_INVALIDOS');
        input.orcamento = amount;
      }
      const id = input.codigo;
      const { operation, version } = data;
      const editing = data.editando === true;
      return save(token, 'centros', { operation, version, input, editing }, (records, at) => {
        const current = records.get(id);
        if (current?.note.excluido) throw fail('CENTRO_INATIVO');
        if (current && !editing) throw fail('CENTRO_DUPLICADO');
        if (!current && editing) throw fail('REGISTRO_NAO_ENCONTRADO');
        const note = current ? { ...current.note, ...input } :
          { id, obra: '', resp: '', orcamento: 0, ...input, criadoEm: at };
        return { id, current, note, response: { ok: true, dados: current ? input : publicRow(note),
          ...(current ? { atualizado: true } : { criado: true }) } };
      });
    },

    async kits(token, action, data = {}) {
      if (['listar', 'obter', 'doPerfil'].includes(action)) {
        await authorize(token, 'kits', 'read');
        const rows = active(await getRecords('kits')).map(event => ({ ...event.note, itens: JSON.parse(event.note.itens) }));
        if (action === 'listar') return { ok: true, dados: rows };
        if (action === 'obter') {
          const found = rows.find(note => (data.id && note.id === data.id) || (data.codigo && note.codigo === data.codigo));
          return found ? { ok: true, dados: found } : error('NAO_ENCONTRADO', 'Kit não localizado.');
        }
        const profile = String(data.perfil ?? '').trim().toLowerCase();
        return { ok: true, dados: profile ? rows.find(note =>
          [note.cargo, note.setor].some(value => value.toLowerCase() === profile)) ?? null : null };
      }
      if (action === 'excluir') return remove(token, 'kits', data, data.id);
      if (action !== 'salvar') return error('ACAO_DESCONHECIDA');
      const input = fields(data, ['nome', 'descricao', 'cargo', 'setor', 'status']);
      if (!input.nome?.trim()) return error('CAMPO_OBRIGATORIO', 'Informe o nome do kit.');
      let items;
      try { items = typeof data.itens === 'string' ? JSON.parse(data.itens) : data.itens; }
      catch { throw fail('KIT_ITENS_INVALIDOS'); }
      if (!Array.isArray(items) || !items.length) return error('KIT_SEM_ITENS', 'O kit precisa de pelo menos um item.');
      if (items.some(item => !item || typeof item !== 'object' || Array.isArray(item))) throw fail('KIT_ITENS_INVALIDOS');
      input.itens = JSON.stringify(items);
      if (input.itens.length > 12000) throw fail('KIT_ITENS_INVALIDOS');
      const { operation, version, codigo } = data;
      if ((data.id !== undefined && !key(data.id)) || (codigo !== undefined && !key(codigo))) throw fail('ADMIN_DADOS_INVALIDOS');
      const id = data.id ?? identifier('KIT', operation);
      return save(token, 'kits', { operation, version, id, input, codigo }, (records, at, actor) => {
        const current = records.get(id);
        if ((data.id && !current) || current?.note.excluido) throw fail('REGISTRO_NAO_ENCONTRADO');
        const nextCode = current?.note.codigo ?? codigo ?? 'KIT-' + String(records.size + 1).padStart(3, '0');
        if (active(records).some(event => event.id !== id && (event.note.codigo === nextCode ||
          event.note.nome.toLowerCase() === input.nome.toLowerCase()))) throw fail('KIT_DUPLICADO');
        const values = { descricao: '', cargo: '', setor: '', status: 'Ativo', ...input };
        const note = current ? { ...current.note, ...values } :
          { id, codigo: nextCode, criadoEm: at, criadoPor: actor, ...values };
        return { id, current, note, response: current ?
          { ok: true, dados: { ...values, id, itens: items }, atualizado: true } :
          { ok: true, dados: note, criado: true } };
      });
    }
  };
}

module.exports = { createComplementaryMethods };
