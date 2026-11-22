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

function createAdministrationEngine({ core, stores, catalog, backupSources, stockForWithdrawal, receiptNotifications, coordinate, clock = () => new Date() }) {
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
      const { id, current, note, response, reserva, retirada } = await prepare(latest(before), at, actor);
      if ((current?.version ?? 0) !== version) throw invalid('ADMIN_CONFLITO_VERSAO');
      const event = { id, operation, version: version + 1, fingerprint, actor, at,
        action: input.action ?? (version ? 'atualizar' : 'criar'), note, response, ...(reserva ? { reserva } : {}), ...(retirada ? { retirada } : {}) };
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
    async biometria(token, action, input = {}) {
      const actor = await authorize(token, 'biometria', 'read');
      const { colaboradorId } = input;
      if (!key(colaboradorId)) throw invalid('BIOMETRIA_IDENTIDADE_INVALIDA');
      const identify = async () => {
        const user = latest(await stores.usuarios.events()).get(colaboradorId)?.note;
        if (!user || user.ativo === false || ['INATIVO', 'BLOQUEADO'].includes(String(user.status || '').toUpperCase())) {
          throw invalid('BIOMETRIA_IDENTIDADE_INVALIDA');
        }
      };
      if (action === 'status') {
        await identify();
        const entry = latest(await stores.biometria.events()).get(colaboradorId);
        return { ok: true, dados: { colaboradorId, vinculada: Boolean(entry?.note.credencialRef),
          leitorIntegrado: false } };
      }
      if (action !== 'vincular') return { ok: false, codigo: 'ACAO_DESCONHECIDA' };
      const { operation, version, credencialRef } = input;
      // A referência é opaca. A comprovação do leitor ou do cadastro será feita por um serviço confiável.
      if (typeof credencialRef !== 'string' || !/^cred-[a-z0-9-]{8,64}$/.test(credencialRef)) {
        throw invalid('BIOMETRIA_REFERENCIA_INVALIDA');
      }
      return save(token, 'biometria', { colaboradorId, operation, version, credencialRef,
        action: 'BIOMETRIA_REFERENCIA_VINCULADA' }, async (records, at) => {
        await identify();
        if ([...records.values()].some(event => event.id !== colaboradorId && event.note.credencialRef === credencialRef)) {
          throw invalid('BIOMETRIA_REFERENCIA_JA_VINCULADA');
        }
        return { id: colaboradorId, current: records.get(colaboradorId),
          note: { id: colaboradorId, credencialRef, vinculadoEm: at, vinculadoPor: actor },
          response: { ok: true, dados: { colaboradorId, vinculada: true, leitorIntegrado: false } } };
      });
    },

    async manutencao(token, action, input = {}) {
      if (['status', 'versoes', 'backups'].includes(action)) {
        await authorize(token, 'manutencao', 'read');
        const records = [...latest(await stores.manutencao.events()).values()];
        const versoes = records.filter(event => event.note.tipo === 'versao').map(event => event.note);
        if (action === 'versoes') return { ok: true, dados: { versoes, modulos: Object.keys(backupSources) } };
        if (action === 'backups') return { ok: true, dados: records.filter(event => event.note.tipo === 'snapshot')
          .map(({ note: { copia, ...summary } }) => summary) };
        const mode = records.find(event => event.id === 'MODO_MANUTENCAO')?.note;
        return { ok: true, dados: { ativo: mode?.ativo ?? false, mensagem: mode?.mensagem ?? '',
          desde: mode?.desde ?? null, por: mode?.por ?? null, versoes, modulos: Object.keys(backupSources) } };
      }
      if (!['ativar', 'desativar', 'registrarVersao', 'snapshot'].includes(action)) {
        return { ok: false, codigo: 'ACAO_DESCONHECIDA' };
      }
      const { operation, version } = input;
      const fields = textFields(input, ['mensagem', 'descricao', 'versao']);
      const id = ['ativar', 'desativar'].includes(action) ? 'MODO_MANUTENCAO' :
        (action === 'snapshot' ? 'SNP-' : 'VER-') + createHash('sha256').update(String(operation)).digest('hex').slice(0, 24);
      return save(token, 'manutencao', { action, operation, version, fields }, async (records, at, actor) => {
        let note;
        let result;
        if (action === 'snapshot') {
          const copia = {};
          for (const [kind, source] of Object.entries(backupSources)) copia[kind] = await source.events();
          if (JSON.stringify(copia).length > 20000) throw invalid('SNAPSHOT_LIMITE');
          const linhas = Object.values(copia).reduce((sum, rows) => sum + rows.length, 0);
          const summary = { id, tipo: 'snapshot', quando: at, autor: actor,
            descricao: fields.descricao || '', abas: Object.keys(copia), linhas };
          note = { ...summary, copia };
          result = summary;
        } else if (action === 'registrarVersao') {
          if (!fields.versao?.trim()) throw invalid('VERSAO_OBRIGATORIA');
          note = { id, tipo: 'versao', quando: at, autor: actor, versao: fields.versao,
            descricao: fields.descricao || '', situacao: 'TESTE' };
          result = note;
        } else {
          const ativo = action === 'ativar';
          note = { id, tipo: 'estado', ativo, mensagem: ativo ? fields.mensagem || 'Sistema em manutenção.' : '',
            desde: at, por: actor };
          result = { ativo };
        }
        return { id, current: records.get(id), note, response: { ok: true, dados: result } };
      });
    },

    async retiradas(token, action, input = {}) {
      await authorize(token, 'retiradas', 'read');
      const { protocolo } = input;
      if (typeof protocolo !== 'string' || !/^#?RES-\d+$/.test(protocolo)) throw invalid('RETIRADA_INVALIDA');
      const normalized = protocolo.startsWith('#') ? protocolo : '#' + protocolo;
      const find = records => [...records.values()].find(row => row.reserva?.protocolo === normalized);
      const approved = reserva => ['APROVADA', 'DISPONIBILIZADA', 'PARCIALMENTE_RETIRADA'].includes(reserva.status);
      if (action === 'itensLiberados') {
        const current = find(latest(await stores.retiradas.events()));
        if (!current) return { ok: false, codigo: 'NAO_ENCONTRADA' };
        const { reserva } = current;
        const itens = JSON.parse(reserva.itens);
        const liberados = approved(reserva) ? itens.filter(item => item.decisao === 'APROVADO' && item.qtd > (item.retirada ?? 0)) : [];
        return { ok: true, dados: { liberados, bloqueados: itens.filter(item => !liberados.includes(item)),
          pendentes: [], motivo: approved(reserva) ? null : 'Reserva em ' + reserva.status } };
      }
      if (action !== 'confirmar') return { ok: false, codigo: 'ACAO_DESCONHECIDA' };
      const { version, operation, sku, qtd } = input;
      if (!key(sku) || !Number.isSafeInteger(qtd) || qtd <= 0) throw invalid('RETIRADA_INVALIDA');
      return save(token, 'retiradas', { protocolo: normalized, version, operation, sku, qtd,
        action: 'RETIRADA_CONFIRMADA' }, async (records, at, actor) => {
        const current = find(records);
        if (!current) throw invalid('RESERVA_NAO_ENCONTRADA');
        const { reserva } = current;
        if (!approved(reserva)) throw invalid('RESERVA_NAO_APROVADA');
        if (!key(reserva.local)) throw invalid('RETIRADA_LOCAL_NAO_INFORMADO');
        const itens = JSON.parse(reserva.itens);
        const matching = itens.filter(item => item.sku === sku && item.decisao === 'APROVADO');
        if (matching.length !== 1) throw invalid('RETIRADA_ITEM_AMBIGUO');
        const item = matching[0];
        if ((item.retirada ?? 0) + qtd > item.qtd) throw invalid('RETIRADA_ACIMA_DO_PENDENTE');
        const saldo = (await stockForWithdrawal.saldos(token, [sku], reserva.local)).get(sku);
        if (saldo.saldo - saldo.reservado < qtd) throw invalid('ESTOQUE_SALDO_INSUFICIENTE');
        item.retirada = (item.retirada ?? 0) + qtd;
        const status = itens.every(row => row.decisao !== 'APROVADO' || row.qtd === row.retirada)
          ? 'RETIRADA' : 'PARCIALMENTE_RETIRADA';
        return { id: current.id, current, note: current.note,
          reserva: { ...reserva, itens: JSON.stringify(itens), status, retiradoPor: actor, retiradoEm: at },
          retirada: { sku, local: reserva.local, quantidade: qtd },
          response: { ok: true, dados: { protocolo: normalized, status, sku, qtd } } };
      });
    },

    async aprovacoes(token, action, input = {}) {
      const actor = await authorize(token, 'aprovacoes', 'read');
      const { approvalProfile } = await core.getSession(token);
      const groups = {
        seguranca: { nome: 'EPI e segurança', perfis: ['SEGURANCA', 'ADMINISTRADOR', 'GESTOR'] },
        material: { nome: 'Material e ferramentas', perfis: ['MESTRE', 'ALMOXARIFE', 'ADMINISTRADOR', 'GESTOR', 'COMPRADOR'] }
      };
      const allowed = group => groups[group].perfis.includes(approvalProfile);
      if (!Object.keys(groups).some(allowed)) throw invalid('ACCESS_DENIED');
      const classify = async items => {
        const categories = new Map();
        for (const item of items) {
          if (!categories.has(item.sku)) categories.set(item.sku,
            (await catalog.obter(token, 'itens', item.sku))?.note.categoria ?? '');
        }
        return items.map(item => ({ item, category: categories.get(item.sku), group:
          /epi|seguran|uniform/i.test(categories.get(item.sku)) ? 'seguranca' : 'material' }));
      };
      if (['listar', 'pendentes', 'porPerfil'].includes(action)) {
        const rows = [];
        for (const event of latest(await stores.aprovacoes.events()).values()) {
          if (event.reserva?.status !== 'PENDENTE_APROVACAO') continue;
          const reserva = { ...event.reserva, itens: JSON.parse(event.reserva.itens) };
          const classification = (await classify(reserva.itens)).filter(entry =>
            allowed(entry.group) && (!entry.item.decisao || entry.item.decisao === 'PENDENTE'));
          if (!classification.length) continue;
          if (action !== 'porPerfil') {
            rows.push({ ...reserva, itens: classification.map(entry => entry.item) });
            continue;
          }
          for (const group of Object.keys(groups).filter(allowed)) {
            const scoped = classification.filter(entry => entry.group === group);
            if (!scoped.length) continue;
            const itens = scoped.map(entry => entry.item);
            rows.push({ tipo: 'RESERVA', reserva: { ...reserva, itens }, alcada: group,
              grupo: { nome: groups[group].nome, itens, categorias: [...new Set(scoped.map(entry => entry.category || 'Sem categoria'))],
                valor: itens.reduce((sum, item) => sum + item.qtd * item.preco, 0) } });
          }
        }
        return { ok: true, dados: rows };
      }
      if (action !== 'decidirItens') return { ok: false, codigo: 'ACAO_DESCONHECIDA' };
      const { protocolo, itens, decisao, version, operation } = input;
      if (typeof protocolo !== 'string' || !/^#?RES-\d+$/.test(protocolo) ||
          !Array.isArray(itens) || !itens.length || itens.some(item => !key(item)) ||
          !['APROVADA', 'CANCELADA'].includes(decisao)) throw invalid('APROVACAO_INVALIDA');
      const normalized = protocolo.startsWith('#') ? protocolo : '#' + protocolo;
      return save(token, 'aprovacoes', { protocolo: normalized, itens, decisao, version, operation,
        action: 'APROVACAO_ITENS' }, async (records, at) => {
        const current = [...records.values()].find(row => row.reserva?.protocolo === normalized);
        if (!current) throw invalid('RESERVA_NAO_ENCONTRADA');
        if (current.reserva.status !== 'PENDENTE_APROVACAO') throw invalid('RESERVA_JA_DECIDIDA');
        const list = JSON.parse(current.reserva.itens);
        const selected = (await classify(list)).filter(entry => itens.includes(entry.item.sku));
        if (new Set(selected.map(entry => entry.item.sku)).size !== new Set(itens).size ||
            selected.some(entry => !allowed(entry.group))) throw invalid('ACCESS_DENIED');
        if (selected.some(entry => entry.item.decisao && entry.item.decisao !== 'PENDENTE')) throw invalid('ITEM_JA_DECIDIDO');
        for (const entry of selected) Object.assign(entry.item, {
          decisao: decisao === 'APROVADA' ? 'APROVADO' : 'RECUSADO', decididoPor: actor, decididoEm: at
        });
        const pendentes = list.filter(item => !item.decisao || item.decisao === 'PENDENTE').length;
        const status = pendentes ? 'PENDENTE_APROVACAO' : list.some(item => item.decisao === 'APROVADO') ? 'APROVADA' : 'CANCELADA';
        const reserva = { ...current.reserva, itens: JSON.stringify(list), status, aprovador: actor, aprovadoEm: at };
        return { id: current.id, current, note: current.note, reserva,
          response: { ok: true, dados: { protocolo: normalized, decididos: selected.length, status, pendentes } } };
      });
    },

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
        return entry ? { ok: true, dados: entry.note, versaoCore: entry.version } :
          { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Patrimônio não localizado.' };
      }
      if (!['salvar', 'retirar', 'devolver', 'retornarManutencao'].includes(action)) {
        return { ok: false, codigo: 'ACAO_DESCONHECIDA' };
      }
      const { patrimonio: id, operation, version } = payload;
      await authorize(token, 'ferramentas', 'write');
      if (!key(id)) throw invalid('SEM_PATRIMONIO');
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

    async auditoria(token, action, input = {}) {
      if (action !== 'listar') return { ok: false, codigo: 'ACAO_DESCONHECIDA' };
      await authorize(token, 'auditoria', 'read');
      const { modulo } = input;
      const supported = ['config', 'obras'];
      if (modulo !== undefined && !supported.includes(modulo)) {
        return { ok: false, codigo: 'MODULO_FORA_DA_HOMOLOGACAO' };
      }
      const modules = modulo === undefined ? supported : [modulo];
      const groups = await Promise.all(modules.map(async name =>
        (await stores[name].events()).slice(-100).reverse().map(event => ({
          modulo: name, id: event.id, acao: event.action, autor: event.actor, quando: event.at, versao: event.version
        }))));
      const events = groups.flat().sort((a, b) => (Date.parse(b.quando) || 0) - (Date.parse(a.quando) || 0));
      return { ok: true, dados: events.slice(0, 100) };
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
      async function fromReceipts() {
        if (!receiptNotifications) return [];
        return (await receiptNotifications.events()).filter(event =>
          event.action === 'receber' && event.notificacao?.solicitante === actor &&
          ['PARCIAL', 'RECEBIDA'].includes(event.note.status)).map(event => ({
          id: 'REC-' + createHash('sha256').update(event.operation).digest('hex').slice(0, 24),
          quando: event.at, evento: 'RECEBIMENTO_NF', titulo: 'Recebimento de compra',
          texto: event.notificacao.requisicao + ': ' + event.note.status,
          rota: '', destinatario: actor, perfis: '', lida: false, versaoCore: 0
        }));
      }
      if (action === 'listar') {
        const records = latest(await stores.notificacoes.events());
        const projected = await fromReceipts();
        return { ok: true, dados: [...records.values()].filter(event => visible(event.note)).map(event => event.note)
          .concat(projected.filter(note => !records.has(note.id))) };
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
        return save(token, 'notificacoes', { id, operation, version }, async records => {
          const current = records.get(id);
          const base = current?.note ?? (String(id).startsWith('REC-') ? (await fromReceipts()).find(note => note.id === id) : undefined);
          if (!base || !visible(base)) throw invalid('NOTIFICACAO_NAO_ENCONTRADA');
          const note = { ...base, lida: true, ...(base.versaoCore !== undefined ? { versaoCore: version + 1 } : {}) };
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
