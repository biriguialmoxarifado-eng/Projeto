/**
 * ============================================================
 * ALMOXA PRO — MÓDULOS COMPLEMENTARES
 * Versão 1.0.0 · fecha a diferença entre frontend e Core
 * ------------------------------------------------------------
 * POR QUE ESTE ARQUIVO EXISTE
 *
 * Uma auditoria comparou o que a tela chama com o que o Core
 * atende. Resultado: 44 rotas eram usadas pelo frontend e o
 * backend não conhecia. Nessas rotas a regra vivia SÓ na tela —
 * ou seja, cada lado tinha a sua verdade. É exatamente o que a
 * harmonização proíbe.
 *
 * Aqui elas ganham backend, na mesma fonte de dados, com a mesma
 * auditoria. Nada de banco novo, nada de Core novo.
 *
 * Duas partes:
 *   1. Módulos que não existiam (kits, calendário, centros de
 *      custo, solicitações, retiradas, saídas, notificações,
 *      automação, auditoria).
 *   2. Ações que faltavam em módulos existentes — acrescentadas
 *      POR EXTENSÃO, sem reescrever o handler original.
 * ============================================================
 */

var AP_COMP_CFG = {
  versao: '1.0.0',
  abas: {
    kits: 'ALMOXA_KITS',
    calendario: 'ALMOXA_CALENDARIO',
    centros: 'ALMOXA_CENTROS',
    solicitacoes: 'ALMOXA_SOLICITACOES',
    notificacoes: 'ALMOXA_NOTIFICACOES',
    automacao: 'ALMOXA_AUTOMACAO',
    divergencias: 'ALMOXA_DIVERGENCIAS'
  },
  colunas: {
    kits: ['id', 'codigo', 'nome', 'descricao', 'cargo', 'setor', 'itens', 'status', 'criadoEm', 'criadoPor'],
    calendario: ['id', 'titulo', 'tipo', 'data', 'hora', 'responsavel', 'projeto', 'prioridade', 'status', 'obs', 'criadoPor'],
    centros: ['codigo', 'nome', 'obra', 'resp', 'orcamento', 'criadoEm'],
    solicitacoes: ['id', 'data', 'solicitante', 'matricula', 'obra', 'itens', 'valor', 'status', 'observacao'],
    notificacoes: ['id', 'quando', 'evento', 'titulo', 'texto', 'rota', 'perfis', 'lida', 'destinatario'],
    automacao: ['id', 'nome', 'evento', 'condicao', 'acao', 'canais', 'ativa', 'criadoEm'],
    divergencias: ['id', 'nota', 'fornecedor', 'sku', 'item', 'naNota', 'recebido', 'diferenca',
      'valorUnitario', 'valor', 'quando', 'conferente', 'status', 'decididoPor', 'decididoEm', 'observacao']
  }
};

function AP_COMP_aba_(chave) {
  return AP_Data_getSheet(AP_COMP_CFG.abas[chave], AP_COMP_CFG.colunas[chave]);
}

function AP_COMP_rows_(chave) {
  AP_COMP_aba_(chave);
  return AP_Data_rows(AP_COMP_CFG.abas[chave]);
}

function AP_COMP_usuario_(sessao) {
  return (sessao && (sessao.usuario || sessao.userId)) || 'sistema';
}

function AP_COMP_json_(v, padrao) {
  if (!v) return padrao;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch (e) { return padrao; }
}

/* ============================================================
   1. KITS — mesma definição usada na loja e na entrega de EPI
   ============================================================ */
function AP_Modulo_kits(acao, payload, sessao) {
  payload = payload || {};
  try {
    switch (acao) {

      case 'listar':
        return {
          ok: true,
          dados: AP_COMP_rows_('kits').map(function (k) { k.itens = AP_COMP_json_(k.itens, []); return k; })
        };

      case 'obter': {
        var k = AP_COMP_rows_('kits').filter(function (x) {
          return x.id === payload.id || x.codigo === payload.codigo;
        })[0];
        if (!k) return { ok: false, codigo: 'NAO_ENCONTRADO', mensagem: 'Kit não localizado.' };
        k.itens = AP_COMP_json_(k.itens, []);
        return { ok: true, dados: k };
      }

      /** Kit por função — é o que a loja usa para limitar o que cada perfil vê */
      case 'doPerfil': {
        var perfil = String(payload.perfil || '').toLowerCase();
        var achado = AP_COMP_rows_('kits').filter(function (x) {
          return String(x.cargo || '').toLowerCase() === perfil ||
            String(x.setor || '').toLowerCase() === perfil;
        })[0];
        if (!achado) return { ok: true, dados: null };
        achado.itens = AP_COMP_json_(achado.itens, []);
        return { ok: true, dados: achado };
      }

      case 'salvar': {
        if (!payload.nome) return { ok: false, codigo: 'CAMPO_OBRIGATORIO', mensagem: 'Informe o nome do kit.' };
        var itens = AP_COMP_json_(payload.itens, []);
        if (!itens.length) return { ok: false, codigo: 'KIT_SEM_ITENS', mensagem: 'O kit precisa de pelo menos um item.' };

        var todos = AP_COMP_rows_('kits');

        if (payload.id) {
          AP_Data_update(AP_COMP_CFG.abas.kits, payload.id, {
            nome: payload.nome, descricao: payload.descricao || '',
            cargo: payload.cargo || '', setor: payload.setor || '',
            itens: JSON.stringify(itens), status: payload.status || 'Ativo'
          });
          return { ok: true, dados: payload, atualizado: true };
        }

        var dup = todos.filter(function (x) {
          return String(x.nome).toLowerCase() === String(payload.nome).toLowerCase();
        })[0];
        if (dup) return { ok: false, codigo: 'KIT_DUPLICADO', mensagem: 'Já existe o kit "' + dup.nome + '".' };

        var novo = {
          id: AP_Utils_generateId('KIT'),
          codigo: payload.codigo || ('KIT-' + String(todos.length + 1).padStart(3, '0')),
          nome: payload.nome, descricao: payload.descricao || '',
          cargo: payload.cargo || '', setor: payload.setor || '',
          itens: JSON.stringify(itens), status: payload.status || 'Ativo',
          criadoEm: AP_Utils_now(), criadoPor: AP_COMP_usuario_(sessao)
        };
        AP_Data_append(AP_COMP_CFG.abas.kits, novo);
        AP_Audit_log(novo.criadoPor, 'KIT_CRIADO', 'KITS', novo.id, { itens: itens.length });
        return { ok: true, dados: novo, criado: true };
      }

      case 'excluir':
        AP_Data_remove(AP_COMP_CFG.abas.kits, payload.id);
        return { ok: true, dados: { id: payload.id, excluido: true } };

      default:
        return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'kits.' + acao + ' não existe.' };
    }
  } catch (e) {
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'kits', acao: acao, mensagem: e.message };
  }
}

/* ============================================================
   2. CALENDÁRIO
   ============================================================ */
function AP_Modulo_calendario(acao, payload, sessao) {
  payload = payload || {};
  try {
    if (acao === 'listar') return { ok: true, dados: AP_COMP_rows_('calendario') };
    if (acao === 'criar' || acao === 'salvar') {
      if (!payload.titulo || !payload.data) {
        return { ok: false, codigo: 'CAMPO_OBRIGATORIO', mensagem: 'Informe o título e a data do evento.' };
      }
      var ev = {
        id: AP_Utils_generateId('EV'), titulo: payload.titulo, tipo: payload.tipo || 'Atividade',
        data: payload.data, hora: payload.hora || '', responsavel: payload.responsavel || '',
        projeto: payload.projeto || '', prioridade: payload.prioridade || 'Média',
        status: 'PROGRAMADO', obs: payload.obs || '', criadoPor: AP_COMP_usuario_(sessao)
      };
      AP_COMP_aba_('calendario');
      AP_Data_append(AP_COMP_CFG.abas.calendario, ev);
      return { ok: true, dados: ev, criado: true };
    }
    if (acao === 'excluir') {
      AP_Data_remove(AP_COMP_CFG.abas.calendario, payload.id);
      return { ok: true, dados: { id: payload.id, excluido: true } };
    }
    return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'calendario.' + acao + ' não existe.' };
  } catch (e) {
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'calendario', acao: acao, mensagem: e.message };
  }
}

/* ============================================================
   3. CENTROS DE CUSTO
   ============================================================ */
function AP_Modulo_centros(acao, payload, sessao) {
  payload = payload || {};
  try {
    if (acao === 'listar') return { ok: true, dados: AP_COMP_rows_('centros') };
    if (acao === 'salvar') {
      if (!payload.codigo || !payload.nome) {
        return { ok: false, codigo: 'CAMPO_OBRIGATORIO', mensagem: 'Código e frente de serviço são obrigatórios.' };
      }
      var todos = AP_COMP_rows_('centros');
      var existente = todos.filter(function (c) { return c.codigo === payload.codigo; })[0];
      if (existente && !payload.editando) {
        return { ok: false, codigo: 'CENTRO_DUPLICADO', mensagem: 'Já existe centro com o código ' + payload.codigo + '.' };
      }
      if (existente) {
        AP_Data_update(AP_COMP_CFG.abas.centros, payload.codigo, payload, 'codigo');
        return { ok: true, dados: payload, atualizado: true };
      }
      var novo = {
        codigo: payload.codigo, nome: payload.nome, obra: payload.obra || '',
        resp: payload.resp || '', orcamento: Number(payload.orcamento) || 0,
        criadoEm: AP_Utils_now()
      };
      AP_COMP_aba_('centros');
      AP_Data_append(AP_COMP_CFG.abas.centros, novo);
      return { ok: true, dados: novo, criado: true };
    }
    if (acao === 'excluir') {
      AP_Data_remove(AP_COMP_CFG.abas.centros, payload.codigo, 'codigo');
      return { ok: true, dados: { codigo: payload.codigo, excluido: true } };
    }
    return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'centros.' + acao + ' não existe.' };
  } catch (e) {
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'centros', acao: acao, mensagem: e.message };
  }
}

/* ============================================================
   4. SOLICITAÇÕES — o pedido antes de virar reserva
   ============================================================ */
function AP_Modulo_solicitacoes(acao, payload, sessao) {
  payload = payload || {};
  try {
    if (acao === 'listar') {
      return {
        ok: true,
        dados: AP_COMP_rows_('solicitacoes').map(function (s) { s.itens = AP_COMP_json_(s.itens, []); return s; })
      };
    }
    if (acao === 'criar') {
      var itens = AP_COMP_json_(payload.itens, []);
      if (!itens.length) return { ok: false, codigo: 'SEM_ITENS', mensagem: 'A solicitação precisa de itens.' };

      var reg = {
        id: '#SOL-' + String(AP_COMP_rows_('solicitacoes').length + 1).padStart(6, '0'),
        data: AP_Utils_now(), solicitante: payload.solicitante || AP_COMP_usuario_(sessao),
        matricula: payload.matricula || '', obra: payload.obra || '',
        itens: JSON.stringify(itens),
        valor: itens.reduce(function (s, i) { return s + (i.qtd * (i.preco || i.valorUnitario || 0)); }, 0),
        status: 'ABERTA', observacao: payload.observacao || ''
      };
      AP_COMP_aba_('solicitacoes');
      AP_Data_append(AP_COMP_CFG.abas.solicitacoes, reg);

      /* a solicitação vira reserva pelo módulo de reservas — sem regra paralela */
      var reserva = AP_Modulo_reservas('criar', {
        solicitante: reg.solicitante, matricula: reg.matricula, obra: reg.obra,
        motivo: 'Solicitação ' + reg.id, itens: itens
      }, sessao);

      if (reserva.ok) {
        AP_Data_update(AP_COMP_CFG.abas.solicitacoes, reg.id, {
          status: 'CONVERTIDA', observacao: 'Reserva ' + reserva.dados.protocolo
        });
        reg.reserva = reserva.dados.protocolo;
      }
      return { ok: true, dados: reg, reserva: reserva.ok ? reserva.dados : null };
    }
    return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'solicitacoes.' + acao + ' não existe.' };
  } catch (e) {
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'solicitacoes', acao: acao, mensagem: e.message };
  }
}

/* ============================================================
   5. RETIRADAS E SAÍDAS — leem das reservas, não guardam cópia
   ============================================================ */
function AP_Modulo_retiradas(acao, payload, sessao) {
  payload = payload || {};
  try {
    if (acao === 'itensLiberados') {
      var r = AP_Modulo_reservas('obter', { protocolo: payload.protocolo }, sessao);
      if (!r.ok) return r;
      var itens = AP_COMP_json_(r.dados.itens, []);
      var aprovada = ['APROVADA', 'DISPONIBILIZADA'].indexOf(r.dados.status) > -1;
      return {
        ok: true,
        dados: {
          liberados: aprovada ? itens : [],
          bloqueados: aprovada ? [] : itens,
          pendentes: [],
          motivo: aprovada ? null : 'Reserva em ' + r.dados.status
        }
      };
    }
    if (acao === 'confirmar') {
      return AP_Modulo_reservas('retirar', payload, sessao);
    }
    return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'retiradas.' + acao + ' não existe.' };
  } catch (e) {
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'retiradas', acao: acao, mensagem: e.message };
  }
}

function AP_Modulo_saidas(acao, payload, sessao) {
  try {
    if (acao === 'listar') {
      var movs = AP_Modulo_estoque('movimentacoes', {}, sessao);
      if (!movs.ok) return movs;
      return { ok: true, dados: movs.dados.filter(function (m) { return Number(m.qtd) < 0; }) };
    }
    return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'saidas.' + acao + ' não existe.' };
  } catch (e) {
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'saidas', acao: acao, mensagem: e.message };
  }
}

/* ============================================================
   6. NOTIFICAÇÕES, AUTOMAÇÃO E AUDITORIA
   ============================================================ */
function AP_Modulo_notificacoes(acao, payload, sessao) {
  payload = payload || {};
  try {
    if (acao === 'listar') {
      var todas = AP_COMP_rows_('notificacoes');
      var perfil = (sessao && sessao.perfil) || '';
      return {
        ok: true,
        dados: todas.filter(function (n) {
          if (!n.perfis) return true;
          return String(n.perfis).indexOf(perfil) > -1 || perfil === 'ADMINISTRADOR';
        })
      };
    }
    if (acao === 'criar') {
      var nova = {
        id: AP_Utils_generateId('NOT'), quando: AP_Utils_now(),
        evento: payload.evento || '', titulo: payload.titulo || '', texto: payload.texto || '',
        rota: payload.rota || '', perfis: (payload.perfis || []).join(','), lida: false,
        destinatario: payload.destinatario || ''
      };
      AP_COMP_aba_('notificacoes');
      AP_Data_append(AP_COMP_CFG.abas.notificacoes, nova);
      return { ok: true, dados: nova };
    }
    if (acao === 'marcarLida') {
      AP_Data_update(AP_COMP_CFG.abas.notificacoes, payload.id, { lida: true });
      return { ok: true, dados: { id: payload.id, lida: true } };
    }
    return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'notificacoes.' + acao + ' não existe.' };
  } catch (e) {
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'notificacoes', acao: acao, mensagem: e.message };
  }
}

function AP_Modulo_automacao(acao, payload, sessao) {
  payload = payload || {};
  try {
    if (acao === 'regras') return { ok: true, dados: AP_COMP_rows_('automacao') };
    if (acao === 'alternar') {
      var r = AP_COMP_rows_('automacao').filter(function (x) { return x.id === payload.id; })[0];
      if (!r) return { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Regra não localizada.' };
      var novo = !(r.ativa === true || r.ativa === 'TRUE');
      AP_Data_update(AP_COMP_CFG.abas.automacao, payload.id, { ativa: novo });
      AP_Audit_log(AP_COMP_usuario_(sessao), 'AUTOMACAO_ALTERADA', 'AUTOMACAO', payload.id, { ativa: novo });
      return { ok: true, dados: { id: payload.id, ativa: novo } };
    }
    if (acao === 'salvar') {
      var nova = {
        id: AP_Utils_generateId('AUT'), nome: payload.nome || '', evento: payload.evento || '',
        condicao: payload.condicao || '', acao: payload.acaoRegra || '',
        canais: (payload.canais || []).join(','), ativa: payload.ativa !== false,
        criadoEm: AP_Utils_now()
      };
      AP_COMP_aba_('automacao');
      AP_Data_append(AP_COMP_CFG.abas.automacao, nova);
      return { ok: true, dados: nova };
    }
    return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'automacao.' + acao + ' não existe.' };
  } catch (e) {
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'automacao', acao: acao, mensagem: e.message };
  }
}

/** A auditoria é a do Core — este módulo só a expõe para a tela */
function AP_Modulo_auditoria(acao, payload, sessao) {
  payload = payload || {};
  try {
    if (acao === 'listar') {
      var linhas = AP_Data_rows(AP_SHEETS.AUDITORIA) || [];
      if (payload.modulo) linhas = linhas.filter(function (l) { return l.modulo === payload.modulo; });
      if (payload.usuario) linhas = linhas.filter(function (l) { return l.usuario === payload.usuario; });
      linhas.sort(function (a, b) { return new Date(b.data || b.quando) - new Date(a.data || a.quando); });
      return { ok: true, dados: linhas.slice(0, payload.limite || 300) };
    }
    return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'auditoria.' + acao + ' não existe.' };
  } catch (e) {
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'auditoria', acao: acao, mensagem: e.message };
  }
}

/* ============================================================
   7. AÇÕES QUE FALTAVAM EM MÓDULOS EXISTENTES
   ------------------------------------------------------------
   Acrescentadas por EXTENSÃO: o handler original continua
   respondendo o que já respondia; só o que faltava é atendido
   aqui. Nada é reescrito, nada é duplicado.
   ============================================================ */

function AP_COMP_estender_(nomeModulo, acoesNovas) {
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  var chave = 'AP_Modulo_' + nomeModulo;
  var original = g[chave];
  if (typeof original !== 'function') return false;
  if (original.__estendido) return true;

  var novo = function (acao, payload, sessao) {
    if (acoesNovas[acao]) return acoesNovas[acao](payload || {}, sessao, original);
    return original(acao, payload, sessao);
  };
  novo.__estendido = true;
  novo.__original = original;
  g[chave] = novo;
  return true;
}

function AP_COMP_instalarExtensoes() {
  var instaladas = [];

  /* ---- RESERVAS ---- */
  if (AP_COMP_estender_('reservas', {
    detalhe: function (p, s, orig) { return orig('obter', p, s); },
    aprovar: function (p, s, orig) { return orig('decidir', { protocolo: p.protocolo, decisao: 'APROVADA', observacao: p.observacao }, s); },
    recusar: function (p, s, orig) { return orig('decidir', { protocolo: p.protocolo, decisao: 'RECUSADA', observacao: p.observacao }, s); },
    disponibilizar: function (p, s, orig) {
      var r = orig('obter', p, s);
      if (!r.ok) return r;
      if (r.dados.status !== 'APROVADA') {
        return { ok: false, codigo: 'RESERVA_NAO_APROVADA', mensagem: 'Só reserva aprovada pode ser disponibilizada.' };
      }
      AP_Data_update(AP_FLUXO_CFG.abas.reservas, p.protocolo, { status: 'DISPONIBILIZADA' }, 'protocolo');
      return { ok: true, dados: { protocolo: p.protocolo, status: 'DISPONIBILIZADA' } };
    },
    lembrete: function (p, s) {
      AP_Modulo_notificacoes('criar', {
        evento: 'RESERVA_LEMBRETE', titulo: 'Reserva ' + p.protocolo + ' aguardando retirada',
        texto: 'Passe no almoxarifado para retirar.', rota: '#/reservas', perfis: ['OPERADOR']
      }, s);
      return { ok: true, dados: { protocolo: p.protocolo, lembrete: true } };
    }
  })) instaladas.push('reservas');

  /* APROVAÇÕES: porPerfil agora vive no próprio módulo, com as
     alçadas. Não é mais estendido aqui para não haver duas versões. */

  /* ---- NOTA FISCAL: divergências ---- */
  if (AP_COMP_estender_('nf', {
    divergencias: function () {
      return { ok: true, dados: AP_COMP_rows_('divergencias') };
    },
    registrarDivergencia: function (p, s) {
      var d = {
        id: AP_Utils_generateId('DIV'), nota: p.nota, fornecedor: p.fornecedor || '',
        sku: p.sku, item: p.item, naNota: Number(p.naNota) || 0, recebido: Number(p.recebido) || 0,
        diferenca: (Number(p.recebido) || 0) - (Number(p.naNota) || 0),
        valorUnitario: Number(p.valorUnitario) || 0,
        valor: Math.abs((Number(p.recebido) || 0) - (Number(p.naNota) || 0)) * (Number(p.valorUnitario) || 0),
        quando: AP_Utils_now(), conferente: AP_COMP_usuario_(s),
        status: 'AGUARDANDO_APROVACAO', decididoPor: '', decididoEm: '', observacao: ''
      };
      AP_COMP_aba_('divergencias');
      AP_Data_append(AP_COMP_CFG.abas.divergencias, d);
      AP_Audit_log(d.conferente, 'DIVERGENCIA_REGISTRADA', 'NF', p.nota,
        { item: p.item, diferenca: d.diferenca });
      AP_Modulo_notificacoes('criar', {
        evento: 'NF_DIVERGENCIA', titulo: 'Divergência na NF ' + p.nota,
        texto: p.item + ': nota ' + d.naNota + ', recebido ' + d.recebido,
        rota: '#/nf-divergencias', perfis: ['ADMINISTRADOR', 'GESTOR', 'ALMOXARIFE']
      }, s);
      return { ok: true, dados: d };
    },
    decidirDivergencia: function (p, s) {
      var d = AP_Data_findBy(AP_COMP_CFG.abas.divergencias, { id: p.id })[0];
      if (!d) return { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Divergência não localizada.' };
      var novoStatus = p.decisao === 'ACEITAR' ? 'ACEITA' : 'RECUSADA';
      AP_Data_update(AP_COMP_CFG.abas.divergencias, p.id, {
        status: novoStatus, decididoPor: AP_COMP_usuario_(s),
        decididoEm: AP_Utils_now(), observacao: p.observacao || ''
      });
      AP_Audit_log(AP_COMP_usuario_(s), 'DIVERGENCIA_' + novoStatus, 'NF', d.nota, {});
      return { ok: true, dados: { id: p.id, status: novoStatus } };
    },
    importarXml: function () {
      return {
        ok: false, codigo: 'LEITURA_XML_NO_NAVEGADOR',
        mensagem: 'O XML é lido no próprio navegador, sem passar pelo servidor. Use a importação de arquivo.'
      };
    }
  })) instaladas.push('nf');

  /* ---- OCORRÊNCIAS ---- */
  if (AP_COMP_estender_('ocorrencias', {
    detalhe: function (p, s, orig) { return orig('obter', p, s); },
    necessidade: function (p, s, orig) {
      var oc = orig('obter', { id: p.id }, s);
      if (!oc.ok) return oc;
      var criadas = [], atualizadas = [];
      (p.itens || []).forEach(function (i) {
        var r = AP_Modulo_compras('precompra', {
          sku: i.codigo || i.sku, qtd: i.qtd, origem: 'OCORRENCIA ' + p.id
        }, s);
        if (r.ok) (r.dados.reforcada ? atualizadas : criadas).push(r.dados.id || '');
      });
      AP_Data_update(AP_FLUXO_CFG.abas.ocorrencias, p.id, {
        status: 'AGUARDANDO_MATERIAL',
        protocoloNecessidade: 'NEC-' + String(p.id).replace(/\D/g, '')
      }, 'id');
      return { ok: true, dados: { criadas: criadas, atualizadas: atualizadas } };
    },
    abastecer: function (p, s) {
      /* o recebimento de NF alimenta as ocorrências que esperavam o material */
      var atendidas = [];
      AP_FLUXO_ler_('ocorrencias').forEach(function (o) {
        if (o.status === 'RESOLVIDA') return;
        var materiais = AP_COMP_json_(o.materiais, []);
        var mudou = false;
        materiais.forEach(function (m) {
          (p.itens || []).forEach(function (i) {
            if (m.codigo !== i.codigo && m.sku !== i.codigo) return;
            var falta = (m.qtd || 0) - (m.recebido || 0);
            var usar = Math.min(falta, i.qtd);
            if (usar <= 0) return;
            m.recebido = (m.recebido || 0) + usar;
            m.situacao = m.recebido >= m.qtd ? 'RECEBIDO' : 'PARCIAL';
            mudou = true;
            atendidas.push({ ocorrencia: o.id, item: m.nome || m.codigo, qtd: usar });
          });
        });
        if (mudou) {
          AP_Data_update(AP_FLUXO_CFG.abas.ocorrencias, o.id, {
            materiais: JSON.stringify(materiais),
            status: materiais.every(function (m) { return m.situacao === 'RECEBIDO'; })
              ? 'MATERIAL_DISPONIVEL' : o.status
          }, 'id');
        }
      });
      return { ok: true, dados: atendidas };
    },
    vincularReserva: function (p, s) {
      AP_Data_update(AP_FLUXO_CFG.abas.ocorrencias, p.id, { protocoloNecessidade: p.protocolo }, 'id');
      return { ok: true, dados: { id: p.id, reserva: p.protocolo } };
    }
  })) instaladas.push('ocorrencias');

  /* ---- EPI ---- */
  if (AP_COMP_estender_('epi', {
    periodos: function () {
      var cfg = AP_Config_get('EPI_PERIODOS', null);
      if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg); } catch (e) { cfg = null; } }
      return { ok: true, dados: cfg || {} };
    },
    restricoes: function (p, s, orig) {
      /* quanto o colaborador já retirou de cada EPI no período */
      var fichas = orig('listar', {}, s);
      if (!fichas.ok) return fichas;
      var doColaborador = fichas.dados.filter(function (f) {
        return String(f.matricula) === String(p.matricula);
      });
      return { ok: true, dados: { entregas: doColaborador } };
    }
  })) instaladas.push('epi');

  /* ---- FERRAMENTAS ---- */
  if (AP_COMP_estender_('ferramentas', {
    movimentar: function (p, s, orig) {
      var f = orig('obter', { patrimonio: p.patrimonio }, s);
      if (!f.ok) return f;
      var novo = {
        status: p.tipo === 'RETIRADA' ? 'EM_POSSE' : (p.tipo === 'MANUTENCAO' ? 'MANUTENCAO' : 'DISPONIVEL'),
        com: p.tipo === 'RETIRADA' ? (p.com || '') : '',
        desde: p.tipo === 'RETIRADA' ? AP_Utils_now() : '',
        obra: p.obra || f.dados.obra || ''
      };
      AP_Data_update(AP_FLUXO_CFG.abas.ferramentas, p.patrimonio, novo, 'patrimonio');
      AP_Audit_log(AP_COMP_usuario_(s), 'FERRAMENTA_' + (p.tipo || 'MOVIMENTO'),
        'FERRAMENTAS', p.patrimonio, { com: novo.com });
      return { ok: true, dados: { patrimonio: p.patrimonio, status: novo.status } };
    },
    historico: function (p, s) {
      var linhas = AP_Data_rows(AP_SHEETS.AUDITORIA) || [];
      return {
        ok: true,
        dados: linhas.filter(function (l) {
          return l.modulo === 'FERRAMENTAS' && (!p.patrimonio || l.alvo === p.patrimonio);
        })
      };
    }
  })) instaladas.push('ferramentas');

  /* ---- INVENTÁRIO ---- */
  if (AP_COMP_estender_('inventario', {
    contar: function (p, s) {
      if (!p.codigo) return { ok: false, codigo: 'CAMPO_OBRIGATORIO', mensagem: 'Informe o item contado.' };
      var contagens = AP_Config_get('INVENTARIO_CONTAGEM', null);
      if (typeof contagens === 'string') { try { contagens = JSON.parse(contagens); } catch (e) { contagens = null; } }
      contagens = contagens || {};
      contagens[p.codigo] = {
        qtd: Number(p.qtd) || 0, quando: AP_Utils_now(), por: AP_COMP_usuario_(s)
      };
      AP_Config_set('INVENTARIO_CONTAGEM', JSON.stringify(contagens));
      return { ok: true, dados: contagens[p.codigo] };
    }
  })) instaladas.push('inventario');

  /* ---- COMPRAS ---- */
  if (AP_COMP_estender_('compras', {
    aprovarPrecompra: function (p, s, orig) {
      return orig('alterarStatus', { id: p.id, status: 'APROVADA' }, s);
    },
    orcamentos: function (p, s, orig) {
      var r = orig('listar', { tipo: 'ORCAMENTO' }, s);
      return r.ok ? r : { ok: true, dados: [] };
    },
    historicoPrecos: function (p, s, orig) {
      var r = orig('listar', {}, s);
      if (!r.ok) return r;
      var porItem = {};
      r.dados.forEach(function (c) {
        if (!c.sku) return;
        (porItem[c.sku] = porItem[c.sku] || []).push({
          data: c.data, valor: Number(c.valorEstimado) / (Number(c.qtd) || 1),
          fornecedor: c.fornecedor
        });
      });
      return { ok: true, dados: porItem };
    }
  })) instaladas.push('compras');

  /* ---- PROJETOS ---- */
  if (AP_COMP_estender_('projetos', {
    comentar: function (p, s, orig) {
      var pr = orig('obter', { id: p.id }, s);
      if (!pr.ok) return pr;
      var obs = AP_COMP_json_(pr.dados.observacoes, []);
      if (p.observacao) {
        obs.unshift({
          id: AP_Utils_generateId('OB'), autor: AP_COMP_usuario_(s),
          quando: AP_Utils_now(), tipo: p.tipo || 'nota', texto: p.texto, respostas: []
        });
      } else {
        var alvo = obs.filter(function (o) { return o.id === p.observacaoId; })[0];
        if (alvo) alvo.respostas.push({ autor: AP_COMP_usuario_(s), quando: AP_Utils_now(), texto: p.texto });
      }
      AP_Data_update(AP_FLUXO_CFG.abas.projetos, p.id, { observacoes: JSON.stringify(obs) }, 'id');
      return { ok: true, dados: { id: p.id, observacoes: obs.length } };
    }
  })) instaladas.push('projetos');

  /* ---- RELATÓRIOS ---- */
  if (AP_COMP_estender_('relatorios', {
    tipos: function () {
      return {
        ok: true,
        dados: [
          { id: 'estoque', nome: 'Posição de estoque', modulo: 'estoque' },
          { id: 'movimentacoes', nome: 'Movimentações', modulo: 'estoque' },
          { id: 'consumo', nome: 'Consumo por centro de custo', modulo: 'centros' },
          { id: 'epi', nome: 'EPI por colaborador', modulo: 'epi' },
          { id: 'nf', nome: 'Notas fiscais e divergências', modulo: 'nf' },
          { id: 'compras', nome: 'Compras e pré-compras', modulo: 'compras' },
          { id: 'inventario', nome: 'Inventário e acuracidade', modulo: 'inventario' },
          { id: 'auditoria', nome: 'Trilha de auditoria', modulo: 'auditoria' }
        ]
      };
    }
  })) instaladas.push('relatorios');

  /* ---- AUTH ---- */
  if (AP_COMP_estender_('auth', {
    perfis: function () {
      return {
        ok: true,
        dados: Object.keys(AP_PERMISSION_MATRIX || {}).map(function (p) {
          return { id: p, nome: p, modulos: Object.keys(AP_PERMISSION_MATRIX[p] || {}) };
        })
      };
    }
  })) instaladas.push('auth');

  return instaladas;
}

/* as extensões entram assim que o arquivo é carregado */
AP_COMP_instalarExtensoes();

/* ============================================================
   TESTE
   ============================================================ */
function testeModulosComplementares() {
  var log = [];
  function reg(t, ok, d) { log.push((ok ? 'OK    ' : 'ERRO  ') + t + (d ? ' — ' + d : '')); }

  try {
    AP_COMP_instalarExtensoes();

    AP_Modulo_categorias('salvar', { nome: 'Materiais' });
    var item = AP_Modulo_itens('salvar', { descricao: 'Cimento CP-II', categoria: 'Materiais', unidade: 'sc', valorUnitario: 32.5, estoqueMinimo: 10 });
    var sku = item.dados.sku;
    AP_Modulo_estoque('entrada', { sku: sku, qtd: 100, documento: 'INICIAL' });

    var kit = AP_Modulo_kits('salvar', { nome: 'Kit Pedreiro', cargo: 'Pedreiro', itens: [{ sku: sku, descricao: 'Cimento', qtd: 2 }] });
    reg('kits.salvar', kit.ok, kit.ok ? kit.dados.codigo : kit.mensagem);
    reg('kits.doPerfil', AP_Modulo_kits('doPerfil', { perfil: 'Pedreiro' }).dados !== null, '');
    reg('kits recusa kit sem itens', AP_Modulo_kits('salvar', { nome: 'Vazio', itens: [] }).ok === false, '');

    var ev = AP_Modulo_calendario('criar', { titulo: 'Concretagem', data: '2026-09-10' });
    reg('calendario.criar', ev.ok, ev.ok ? ev.dados.id : ev.mensagem);

    var cc = AP_Modulo_centros('salvar', { codigo: 'CC-001', nome: 'Hidráulica' });
    reg('centros.salvar', cc.ok, '');
    reg('centros recusa código repetido', AP_Modulo_centros('salvar', { codigo: 'CC-001', nome: 'X' }).ok === false, '');

    var sol = AP_Modulo_solicitacoes('criar', {
      solicitante: 'João', itens: [{ sku: sku, nome: 'Cimento', qtd: 5, preco: 32.5 }]
    });
    reg('solicitacoes.criar vira reserva', sol.ok && !!sol.reserva, sol.reserva ? sol.reserva.protocolo : '');

    var lib = AP_Modulo_retiradas('itensLiberados', { protocolo: sol.reserva.protocolo });
    reg('retiradas.itensLiberados bloqueia sem aprovação', lib.ok && lib.dados.liberados.length === 0, lib.dados.motivo || '');

    AP_Modulo_reservas('aprovar', { protocolo: sol.reserva.protocolo });
    var lib2 = AP_Modulo_retiradas('itensLiberados', { protocolo: sol.reserva.protocolo });
    reg('reservas.aprovar libera a retirada', lib2.dados.liberados.length === 1, '');

    var disp = AP_Modulo_reservas('disponibilizar', { protocolo: sol.reserva.protocolo });
    reg('reservas.disponibilizar', disp.ok, disp.ok ? disp.dados.status : disp.mensagem);

    var div = AP_Modulo_nf('registrarDivergencia', {
      nota: '01', sku: sku, item: 'Cimento', naNota: 25, recebido: 20, valorUnitario: 32.5
    });
    reg('nf.registrarDivergencia', div.ok && div.dados.diferenca === -5, 'diferença ' + div.dados.diferenca);
    reg('nf.divergencias lista', AP_Modulo_nf('divergencias', {}).dados.length === 1, '');
    var dec = AP_Modulo_nf('decidirDivergencia', { id: div.dados.id, decisao: 'ACEITAR' });
    reg('nf.decidirDivergencia', dec.ok && dec.dados.status === 'ACEITA', '');

    reg('notificacoes.listar', AP_Modulo_notificacoes('listar', {}, { perfil: 'ADMINISTRADOR' }).ok, '');
    reg('auditoria.listar', AP_Modulo_auditoria('listar', {}).ok,
      AP_Modulo_auditoria('listar', {}).dados.length + ' registro(s)');
    reg('saidas.listar', AP_Modulo_saidas('listar', {}).ok, '');
    reg('relatorios.tipos', AP_Modulo_relatorios('tipos', {}).dados.length === 8, '');
    reg('auth.perfis', AP_Modulo_auth('perfis', {}).ok, '');
    reg('inventario.contar', AP_Modulo_inventario('contar', { codigo: sku, qtd: 95 }).ok, '');

    /* extensão não pode quebrar o que já existia */
    reg('handler original preservado', AP_Modulo_reservas('listar', {}).ok, '');
    reg('estoque continua respondendo', AP_Modulo_estoque('listar', {}).ok, '');

  } catch (e) {
    log.push('ERRO  exceção: ' + e.message);
  }

  try { Logger.log(log.join('\n')); } catch (e) { }
  return log;
}

