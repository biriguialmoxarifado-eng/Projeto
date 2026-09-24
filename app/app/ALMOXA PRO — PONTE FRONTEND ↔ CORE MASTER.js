/**
 * ============================================================
 * ALMOXA PRO — PONTE / ADAPTER
 * Versão 4.0.0 · alinhada ao CORE MASTER REAL
 * ------------------------------------------------------------
 * O QUE MUDOU NESTA VERSÃO (e por que as anteriores erravam)
 *
 * Até a v3 eu não tinha visto o Core. A ponte procurava funções
 * por nomes SUPOSTOS, e quase todos estavam errados:
 *
 *   eu procurava              o Core realmente tem
 *   ----------------------   --------------------------------
 *   CoreMaster (objeto)      CORE_MASTER  (maiúsculas)
 *   AP_Session_validar       AP_Session_validate
 *   AP_Auth_login            AP_Auth.login / AP_Auth_login_
 *   AP_Perm_check            AP_Permissions_can_ / _guard
 *   AP_Core_executar         CORE_MASTER.dispatch
 *   AP_Audit_registrar       AP_Audit_log
 *   AP_Data_listar/salvar    AP_Data_rows / AP_Data_append
 *   AP_Core_registrarModulo  AP_ModuleRegistry.register
 *
 * Agora o mapa usa os nomes REAIS, verificados nos 24 arquivos.
 *
 * A ponte também não serve HTML e não declara doGet — isso é da
 * Entrada Única. Aqui só se traduz frontend <-> Core.
 * ============================================================
 */

var AP_BRIDGE_CONFIG = {
  versao: '4.0.0',

  /**
   * Mapa de capacidades -> nomes REAIS do Core Master.
   * A ponte usa o primeiro que existir. Os nomes abaixo foram
   * conferidos nos arquivos 01 a 24 do Core.
   */
  mapa: {
    boot:          ['AP_Core_boot'],
    versao:        ['CORE_MASTER.version'],
    configGet:     ['AP_Config_get'],
    configSet:     ['AP_Config_set'],
    autenticar:    ['AP_Auth_login_'],
    validarSessao: ['AP_Session_validate'],
    criarSessao:   ['AP_Session_create'],
    encerrarSessao:['AP_Session_destroy'],
    permissao:     ['AP_Permissions_can_'],
    executar:      ['CORE_MASTER.dispatch'],
    auditoria:     ['AP_Audit_log'],
    log:           ['AP_Logger_info'],
    erro:          ['AP_ErrorHandler_capture'],
    dadosListar:   ['AP_Data_rows'],
    dadosBuscar:   ['AP_Data_findBy'],
    dadosSalvar:   ['AP_Data_append'],
    dadosAtualizar:['AP_Data_update'],
    registrarModulo:['AP_ModuleRegistry_register_'],
    evento:        ['AP_EventBus_emit_'],
    doutor:        ['AP_Doctor_run_'],
    lock:          ['AP_Core_withLock']
  },

  /**
   * Perfis: o Core usa MAIÚSCULAS (ADMINISTRADOR, GESTOR,
   * ALMOXARIFE, OPERADOR). O frontend usa minúsculas.
   * Esta tabela concilia os dois sem duplicar cadastro.
   */
  perfis: {
    ADMINISTRADOR: 'admin',
    GESTOR: 'gestor',
    ALMOXARIFE: 'almoxarife',
    OPERADOR: 'colaborador'
  },

  /** Ação do frontend -> ação RBAC do Core (AP_ACTIONS) */
  acoes: {
    listar: 'READ', obter: 'READ', catalogo: 'READ', consultar: 'READ',
    detalhe: 'READ', ping: 'READ', diagnostico: 'READ', contar: 'READ',
    salvar: 'CREATE', criar: 'CREATE', comentar: 'CREATE',
    atualizar: 'UPDATE', editar: 'UPDATE', alterarStatus: 'UPDATE',
    excluir: 'DELETE', remover: 'DELETE',
    aprovar: 'APPROVE', decidir: 'APPROVE',
    movimentar: 'MOVEMENT', ajustar: 'MOVEMENT', retirar: 'MOVEMENT',
    contar_inventario: 'INVENTORY', inventariar: 'INVENTORY',
    exportar: 'EXPORT', ler: 'SCAN'
  }
};

/* ============================================================
   1. RESOLUÇÃO DAS FUNÇÕES DO CORE
   ============================================================ */

function AP_BRIDGE_escopo_() {
  return (typeof globalThis !== 'undefined') ? globalThis : this;
}

function AP_BRIDGE_resolver_(capacidade) {
  var nomes = AP_BRIDGE_CONFIG.mapa[capacidade] || [];
  var g = AP_BRIDGE_escopo_();

  for (var i = 0; i < nomes.length; i++) {
    var nome = nomes[i];
    if (nome.indexOf('.') > -1) {
      var p = nome.split('.');
      var alvo = g[p[0]];
      if (alvo && typeof alvo[p[1]] === 'function') {
        return { capacidade: capacidade, nome: nome, fn: alvo[p[1]].bind(alvo) };
      }
    } else if (typeof g[nome] === 'function') {
      return { capacidade: capacidade, nome: nome, fn: g[nome] };
    }
  }
  return null;
}

function AP_BRIDGE_chamar_(capacidade, args, contexto) {
  var alvo = AP_BRIDGE_resolver_(capacidade);
  if (!alvo) {
    return {
      ok: false, codigo: 'CORE_CAPACIDADE_AUSENTE', capacidade: capacidade,
      procurados: AP_BRIDGE_CONFIG.mapa[capacidade] || [],
      mensagem: 'O Core não expõe função para "' + capacidade + '".',
      modulo: (contexto || {}).modulo || null, acao: (contexto || {}).acao || null,
      timestamp: new Date().toISOString(), ausente: true
    };
  }
  try {
    return { ok: true, dados: alvo.fn.apply(null, args || []), via: alvo.nome };
  } catch (e) {
    return {
      ok: false, codigo: 'CORE_ERROR', capacidade: capacidade, via: alvo.nome,
      mensagem: e && e.message ? e.message : String(e),
      modulo: (contexto || {}).modulo || null, acao: (contexto || {}).acao || null,
      timestamp: new Date().toISOString()
    };
  }
}

function AP_BRIDGE_capacidades_() {
  var r = { encontradas: {}, ausentes: [] };
  Object.keys(AP_BRIDGE_CONFIG.mapa).forEach(function (cap) {
    var alvo = AP_BRIDGE_resolver_(cap);
    if (alvo) r.encontradas[cap] = alvo.nome;
    else r.ausentes.push({ capacidade: cap, procurados: AP_BRIDGE_CONFIG.mapa[cap] });
  });
  return r;
}

function AP_BRIDGE_diagnostico() {
  var caps = AP_BRIDGE_capacidades_();
  var rel = {
    ponte: AP_BRIDGE_CONFIG.versao,
    quando: new Date().toISOString(),
    coreMaster: (typeof CORE_MASTER === 'object') ? 'CORE_MASTER presente' : 'CORE_MASTER ausente',
    capacidadesEncontradas: caps.encontradas,
    capacidadesAusentes: caps.ausentes.map(function (a) { return a.capacidade; }),
    modulosLocais: AP_BRIDGE_modulosLocais_(),
    handlersNoDispatch: AP_BRIDGE_handlersRegistrados_()
  };
  try { Logger.log(JSON.stringify(rel, null, 2)); } catch (e) { }
  return rel;
}

/* ============================================================
   2. MÓDULOS — registrados NA WHITELIST DO PRÓPRIO CORE
   ------------------------------------------------------------
   O CORE_MASTER.dispatch só executa o que estiver em
   AP_CoreMaster_HANDLERS_. Em vez de criar despacho paralelo,
   a ponte registra os handlers do ALMOXA PRO lá dentro.
   ============================================================ */

function AP_BRIDGE_handlerLocal_(modulo) {
  var g = AP_BRIDGE_escopo_();
  var nome = 'AP_Modulo_' + modulo;
  return (typeof g[nome] === 'function') ? { nome: nome, fn: g[nome] } : null;
}

function AP_BRIDGE_modulosLocais_() {
  var g = AP_BRIDGE_escopo_();
  var achados = [];
  try {
    Object.keys(g).forEach(function (k) {
      if (/^AP_Modulo_/.test(k) && typeof g[k] === 'function') {
        achados.push({ modulo: k.replace('AP_Modulo_', ''), handler: k });
      }
    });
  } catch (e) { }
  return achados;
}

function AP_BRIDGE_handlersRegistrados_() {
  var g = AP_BRIDGE_escopo_();
  if (typeof g.AP_CoreMaster_HANDLERS_ !== 'object') return [];
  return Object.keys(g.AP_CoreMaster_HANDLERS_);
}

/**
 * Publica os módulos do ALMOXA PRO na whitelist do Core Master.
 * Usa a estrutura do próprio Core — nada paralelo.
 */
function AP_BRIDGE_publicarHandlers() {
  var g = AP_BRIDGE_escopo_();
  if (typeof g.AP_CoreMaster_HANDLERS_ !== 'object') {
    return { ok: false, codigo: 'DISPATCH_AUSENTE', mensagem: 'AP_CoreMaster_HANDLERS_ não existe (arquivo 23_CoreMaster.gs).' };
  }

  var publicados = [];
  AP_BRIDGE_modulosLocais_().forEach(function (m) {
    var handler = g[m.handler];
    var acoes = {};
    /* uma entrada genérica por módulo: o dispatch passa a ação adiante */
    ['listar', 'obter', 'salvar', 'criar', 'excluir', 'contar', 'proximoSku', 'verificarSku',
      'buscarSemelhante', 'porCnpj', 'login', 'validarSessao', 'definirSenha',
      'identificar', 'logout', 'matriz', 'verificar', 'catalogo',
      /* operação */
      'mural', 'resumo', 'item', 'movimentacoes', 'movimentar', 'ajustar',
      'entrada', 'saida', 'criticos', 'acessoPlataforma', 'alterarStatus',
      /* fluxo */
      'decidir', 'retirar', 'pendentes', 'lancar', 'precompra', 'precompras',
      'pedido', 'pedidos', 'sugerir', 'sugestoes', 'divergencias', 'fichas',
      'detalhe', 'abastecer', 'gerados', 'registrar', 'carregar', 'ler',
      'disponivel', 'necessidade', 'comentar',
      /* manutenção */
      'status', 'ativar', 'desativar', 'versoes', 'registrarVersao',
      'historico', 'backup', 'restaurar', 'verificar',
      /* complementares */
      'doPerfil', 'porPerfil', 'perfis', 'aprovar', 'recusar', 'disponibilizar',
      'lembrete', 'divergencias', 'registrarDivergencia', 'decidirDivergencia',
      'importarXml', 'vincularReserva', 'periodos', 'restricoes', 'movimentar',
      'contar', 'aprovarPrecompra', 'orcamentos', 'historicoPrecos', 'tipos',
      'regras', 'alternar', 'marcarLida', 'itensLiberados', 'confirmar',
      'alterarStatus',
      /* biometria */
      'registrar', 'registrarTemplate', 'identificar', 'revogar',
      'limparFantasmas', 'daPessoa', 'indice', 'resultadoMotor', 'limites',
      'definirLimites', 'homologacao', 'desafio', 'autenticar',
      /* motor de inteligência de projetos */
      'interpretar', 'procurar', 'processarLegenda', 'confirmarEquivalencia',
      'equivalencias', 'removerEquivalencia', 'comparar', 'versao',
      'exportar',
      /* doutor do sistema */
      'performance', 'planilha', 'modulos', 'completo', 'pesoAba',
      /* perfis e permissões dinâmicos */
      'perfis', 'doPerfil', 'criarPerfil', 'alterarPerfil', 'definir',
      'excecao', 'excecoes', 'alcadas', 'criarAlcada', 'alcadaPara',
      'acoes', 'instalar',
      /* motor de notas fiscais */
      'lerXML', 'interpretar', 'validar', 'duplicidade', 'relacionar',
      /* motor da loja */
      'compatibilidade', 'montar', 'disponibilidade', 'analisarCarrinho',
      /* motor de imagens */
      'buscar', 'uma', 'quemTem',
      /* backup automático */
      'configurar', 'agora', 'agendamentos',
      /* document engine */
      'gerar', 'criarLink', 'abrirLink', 'decidir', 'links', 'modelos',
      /* localização física */
      'estrutura', 'criarRua', 'ajustarRua', 'conteudo', 'armazenar',
      'ondeEsta', 'partes', 'criarFaixa', 'semLocalizacao',
      'vincular', 'desvincular',
      /* patrimônio */
      'ficha', 'porToken', 'movimentar', 'manutencao', 'etiquetas',
      'tamanhos', 'proximoNumero', 'gerarFicha', 'localizarFicha',
      'novoCodigoFicha', 'itensDisponiveis', 'dadosDoItem',
      'lacre', 'documento', 'adicionarFoto', 'removerFoto',
      'fotos', 'tiposFoto',
      /* itens da nota fiscal */
      'itens', 'notasDoItem', 'conferir',
      /* notas, pedidos e informações do patrimônio */
      'vincularNota', 'desvincularNota', 'notas',
      'adicionarInfo', 'removerInfo', 'infos',
      /* documentos enviados do computador */
      'enviarDocumento', 'removerDocumento', 'documentos',
      'garantirFicha', 'criarSerie'].forEach(function (acao) {
        acoes[acao] = function (payload, context) {
          return handler(acao, payload, context);
        };
      });
    g.AP_CoreMaster_HANDLERS_[m.modulo] = acoes;
    publicados.push(m.modulo);
  });

  return { ok: true, dados: { publicados: publicados } };
}

/** Despacho: Core Master primeiro; handler local como caminho direto. */
function AP_BRIDGE_despachar_(modulo, acao, payload, sessao) {
  var g = AP_BRIDGE_escopo_();

  /* 1) CORE_MASTER.dispatch, se o módulo estiver publicado nele */
  if (typeof g.CORE_MASTER === 'object' && typeof g.CORE_MASTER.dispatch === 'function' &&
    typeof g.AP_CoreMaster_HANDLERS_ === 'object' && g.AP_CoreMaster_HANDLERS_[modulo]) {
    try {
      var r = g.CORE_MASTER.dispatch({
        module: modulo, action: acao, payload: payload,
        context: {
          appId: 'ALMOXA_PRO_DESKTOP', platform: 'DESKTOP',
          sessionId: (sessao && (sessao.token || sessao.sessionId)) || null,
          userId: (sessao && (sessao.usuario || sessao.userId)) || ''
        }
      });
      var recusou = r && r.ok === false &&
        /MODULO_NAO_IMPLEMENTADO|REQUISICAO_INVALIDA/.test(String(r.code || ''));
      if (!recusou) return { ok: true, dados: r, via: 'CORE_MASTER.dispatch' };
    } catch (e) {
      return {
        ok: false, codigo: 'CORE_ERROR', modulo: modulo, acao: acao,
        via: 'CORE_MASTER.dispatch', mensagem: e.message, timestamp: new Date().toISOString()
      };
    }
  }

  /* 2) handler real do projeto */
  var local = AP_BRIDGE_handlerLocal_(modulo);
  if (local) {
    try {
      return { ok: true, dados: local.fn(acao, payload, sessao), via: local.nome };
    } catch (e2) {
      return {
        ok: false, codigo: 'MODULO_ERRO', modulo: modulo, acao: acao, via: local.nome,
        etapa: 'execução do handler', mensagem: e2.message, timestamp: new Date().toISOString()
      };
    }
  }

  return {
    ok: false, codigo: 'MODULO_AUSENTE', modulo: modulo, acao: acao,
    handlerEsperado: 'AP_Modulo_' + modulo,
    mensagem: 'Nenhum módulo atende "' + modulo + '". Instale o arquivo com AP_Modulo_' + modulo + '.',
    etapa: 'despacho', timestamp: new Date().toISOString()
  };
}

/* ============================================================
   3. API ÚNICA — almoxaApi()
   ============================================================ */

function almoxaApi(requisicaoJson) {
  var req = null;
  try {
    req = (typeof requisicaoJson === 'string') ? JSON.parse(requisicaoJson) : requisicaoJson;
  } catch (e) {
    return AP_BRIDGE_resposta_({ ok: false, codigo: 'REQUISICAO_INVALIDA', mensagem: 'JSON inválido.' });
  }
  if (!req || !req.modulo || !req.acao) {
    return AP_BRIDGE_resposta_({ ok: false, codigo: 'REQUISICAO_INCOMPLETA', mensagem: 'Informe "modulo" e "acao".' });
  }

  var ctx = { modulo: req.modulo, acao: req.acao };

  try {
    /* rotas da ponte — sem sessão */
    if (req.modulo === 'ponte') {
      if (req.acao === 'diagnostico') return AP_BRIDGE_resposta_({ ok: true, dados: AP_BRIDGE_diagnostico() });
      if (req.acao === 'capacidades') return AP_BRIDGE_resposta_({ ok: true, dados: AP_BRIDGE_capacidades_() });
      if (req.acao === 'publicar') return AP_BRIDGE_resposta_(AP_BRIDGE_publicarHandlers());
    }

    if (req.modulo === 'doutor' && req.acao === 'ping') {
      var v = AP_BRIDGE_chamar_('versao', [], ctx);
      return AP_BRIDGE_resposta_({
        ok: true,
        dados: {
          core: (typeof CORE_MASTER === 'object') ? 'Core Master conectado' : 'Core sem CORE_MASTER',
          versaoCore: v.ok ? v.dados : null,
          ponte: AP_BRIDGE_CONFIG.versao,
          capacidades: AP_BRIDGE_capacidades_().encontradas
        }
      });
    }

    if (req.modulo === 'doutor' && req.acao === 'diagnostico') {
      var d = AP_BRIDGE_chamar_('doutor', [], ctx);
      return AP_BRIDGE_resposta_(AP_BRIDGE_diagnosticoDoutor_(d));
    }

    /* Existe algum usuário? A tela de entrada precisa saber ANTES do login,
       para não dizer "nenhum usuário cadastrado" quando já existe.
       Devolve só a contagem — nenhum dado pessoal. */
    if (req.modulo === 'usuarios' && req.acao === 'contar') {
      var cont = AP_BRIDGE_despachar_('usuarios', 'contar', {}, null);
      if (cont.ok) {
        var d = (cont.dados && cont.dados.dados) ? cont.dados.dados : cont.dados;
        return AP_BRIDGE_resposta_({ ok: true, dados: { total: (d && d.total) || 0 } });
      }
      return AP_BRIDGE_resposta_(cont);
    }

    /* primeiro administrador */
    if (req.modulo === 'usuarios' && req.acao === 'salvar' && req.payload && req.payload.primeiroAcesso) {
      return AP_BRIDGE_resposta_(AP_BRIDGE_primeiroUsuario_(req.payload, ctx));
    }

    /* autenticação */
    if (req.modulo === 'auth') {
      var authLocal = AP_BRIDGE_despachar_(req.modulo, req.acao, req.payload, null);
      if (authLocal.ok) {
        var saidaAuth = authLocal.dados;
        AP_BRIDGE_auditar_(req, req.acao.toUpperCase(), 'SUCESSO');
        return AP_BRIDGE_resposta_(
          (saidaAuth && saidaAuth.ok !== undefined) ? saidaAuth : { ok: true, dados: saidaAuth, via: authLocal.via });
      }
      return AP_BRIDGE_resposta_(authLocal);
    }

    /**
     * MODO ABERTO — consulta sem login.
     *
     * O colaborador consegue ver a loja, o catálogo e o saldo de um item
     * sem entrar no sistema. Antes o backend recusava tudo com "Token de
     * sessão não informado", e a loja pública não abria.
     *
     * Aqui só entram LEITURAS de catálogo. Nada que grave, nada que
     * exponha pessoa, custo, documento ou movimentação.
     */
    if (!req.sessao && AP_BRIDGE_leituraPublica_(req.modulo, req.acao)) {
      var pub = AP_BRIDGE_despachar_(req.modulo, req.acao, req.payload, { perfil: 'PUBLICO', usuario: 'publico' });
      if (pub.ok) {
        var saidaPub = (pub.dados && pub.dados.ok !== undefined) ? pub.dados : { ok: true, dados: pub.dados };
        return AP_BRIDGE_resposta_(AP_BRIDGE_limparParaPublico_(saidaPub, req.modulo));
      }
      return AP_BRIDGE_resposta_(pub);
    }

    /* sessão obrigatória */
    var sessao = AP_BRIDGE_chamar_('validarSessao', [req.sessao], ctx);
    if (!sessao.ok) {
      if (sessao.ausente) return AP_BRIDGE_resposta_(sessao);
      return AP_BRIDGE_resposta_({
        ok: false, codigo: 'SESSAO_INVALIDA', mensagem: sessao.mensagem || 'Sessão inválida.',
        modulo: req.modulo, acao: req.acao, timestamp: new Date().toISOString()
      });
    }

    /* o Core devolve {ok, data:{usuario, perfil}} */
    var respostaSessao = sessao.dados;
    if (!respostaSessao || respostaSessao.ok === false) {
      return AP_BRIDGE_resposta_({
        ok: false,
        codigo: (respostaSessao && respostaSessao.code) || 'SESSAO_EXPIRADA',
        mensagem: (respostaSessao && respostaSessao.message) || 'Sessão expirada. Entre novamente.',
        modulo: req.modulo, acao: req.acao, timestamp: new Date().toISOString()
      });
    }
    var dadosSessao = respostaSessao.data || respostaSessao;
    dadosSessao.token = req.sessao;

    /* permissão — RBAC do Core, com tradução de perfil e ação */
    var perfilCore = AP_BRIDGE_perfilParaCore_(dadosSessao.perfil);
    var acaoCore = AP_BRIDGE_CONFIG.acoes[req.acao] || 'READ';
    var perm = AP_BRIDGE_permissaoCache_(perfilCore, req.modulo, acaoCore, ctx);

    if (perm.ok && perm.dados === false) {
      AP_BRIDGE_auditar_(req, 'ACESSO_NEGADO', 'FALHA');
      return AP_BRIDGE_resposta_({
        ok: false, codigo: 'SEM_PERMISSAO',
        mensagem: 'Perfil "' + perfilCore + '" não tem permissão "' + acaoCore + '" em "' + req.modulo + '".',
        modulo: req.modulo, acao: req.acao, timestamp: new Date().toISOString()
      });
    }
    if (!perm.ok && perm.ausente) {
      return AP_BRIDGE_resposta_({
        ok: false, codigo: 'PERMISSAO_NAO_VERIFICAVEL',
        mensagem: 'O Core não expõe verificação de permissão. Operação recusada por segurança.',
        modulo: req.modulo, acao: req.acao, timestamp: new Date().toISOString()
      });
    }

    /* despacho */
    /* Modo de manutenção: consulta continua funcionando, gravação espera.
       Assim dá para atualizar o sistema sem tirar a obra do ar. */
    if (typeof AP_MANUT_ativo === 'function' && AP_MANUT_ativo() &&
      !AP_BRIDGE_ACOES_LEITURA.test(String(req.acao || '')) &&
      req.modulo !== 'manutencao') {
      var stManut = AP_MANUT_status();
      AP_BRIDGE_auditar_(req, 'BLOQUEADO_MANUTENCAO', 'FALHA');
      return AP_BRIDGE_resposta_({
        ok: false, codigo: 'EM_MANUTENCAO',
        mensagem: stManut.mensagem || 'Sistema em manutenção. As gravações estão suspensas.',
        desde: stManut.desde || null, por: stManut.por || null,
        modulo: req.modulo, acao: req.acao, timestamp: new Date().toISOString()
      });
    }

    var exec = AP_BRIDGE_despachar_(req.modulo, req.acao, req.payload, dadosSessao);
    if (!exec.ok) return AP_BRIDGE_resposta_(exec);

    AP_BRIDGE_auditar_(req, (req.modulo + '.' + req.acao).toUpperCase(), 'SUCESSO');

    var saida = exec.dados;
    if (saida && typeof saida === 'object' && saida.ok !== undefined) return AP_BRIDGE_resposta_(saida);
    return AP_BRIDGE_resposta_({ ok: true, dados: saida, via: exec.via });

  } catch (erro) {
    AP_BRIDGE_chamar_('erro', ['almoxaApi', erro], ctx);
    return AP_BRIDGE_resposta_({
      ok: false, codigo: 'PONTE_ERROR', mensagem: erro && erro.message ? erro.message : String(erro),
      modulo: req.modulo, acao: req.acao, timestamp: new Date().toISOString()
    });
  }
}

/* memória da execução: o mesmo perfil/módulo/ação não é reavaliado */
var AP_BRIDGE_permCache_ = {};

function AP_BRIDGE_permissaoCache_(perfil, modulo, acao, ctx) {
  var chave = perfil + '|' + modulo + '|' + acao;
  if (AP_BRIDGE_permCache_[chave] !== undefined) return AP_BRIDGE_permCache_[chave];
  var r = AP_BRIDGE_chamar_('permissao', [perfil, modulo, acao], ctx);
  AP_BRIDGE_permCache_[chave] = r;
  return r;
}

/** O que pode ser consultado sem login — só leitura de catálogo */
var AP_BRIDGE_PUBLICO = {
  'lojinha': ['catalogo'],
  'itens': ['listar', 'obter'],
  'categorias': ['listar'],
  'estoque': ['listar', 'item'],
  'epi': ['catalogo'],
  'obras': ['listar'],
  'mural': ['listar'],
  'doutor': ['ping', 'diagnostico']
};

function AP_BRIDGE_leituraPublica_(modulo, acao) {
  var permitidas = AP_BRIDGE_PUBLICO[modulo];
  return !!permitidas && permitidas.indexOf(acao) > -1;
}

/**
 * Tira da resposta pública o que não é da conta de quem não entrou:
 * custo, fornecedor, localização e qualquer dado de pessoa.
 */
function AP_BRIDGE_limparParaPublico_(resposta, modulo) {
  if (!resposta || !resposta.ok) return resposta;

  var sensiveis = ['valorUnitario', 'valor', 'valorTotal', 'preco', 'precoMedio', 'custo',
    'fornecedor', 'cnpj', 'localizacao', 'localId', 'local', 'criadoPor',
    'observacao', 'obs', 'matricula', 'email', 'telefone'];

  function limpar(item) {
    if (!item || typeof item !== 'object') return item;
    var copia = {};
    Object.keys(item).forEach(function (k) {
      if (sensiveis.indexOf(k) > -1) return;
      copia[k] = item[k];
    });
    return copia;
  }

  var d = resposta.dados;
  if (Array.isArray(d)) resposta.dados = d.map(limpar);
  else if (d && typeof d === 'object') {
    if (Array.isArray(d.dados)) d.dados = d.dados.map(limpar);
    else resposta.dados = limpar(d);
  }

  resposta.modoAberto = true;
  return resposta;
}

function AP_BRIDGE_resposta_(obj) {
  if (!obj.timestamp) obj.timestamp = new Date().toISOString();
  return JSON.stringify(obj);
}

/** Perfil do frontend (minúsculo) -> perfil do Core (maiúsculo) */
function AP_BRIDGE_perfilParaCore_(perfil) {
  if (!perfil) return '';
  var p = String(perfil).toUpperCase();
  if (AP_BRIDGE_CONFIG.perfis[p]) return p;              // já é do Core
  var achado = null;
  Object.keys(AP_BRIDGE_CONFIG.perfis).forEach(function (k) {
    if (AP_BRIDGE_CONFIG.perfis[k] === String(perfil).toLowerCase()) achado = k;
  });
  return achado || p;
}

/** Perfil do Core -> perfil do frontend */
function AP_BRIDGE_perfilParaFrontend_(perfil) {
  var p = String(perfil || '').toUpperCase();
  return AP_BRIDGE_CONFIG.perfis[p] || String(perfil || '').toLowerCase();
}

/* Ações que só leem não vão para a auditoria: gravar uma linha por
   consulta enchia a planilha e deixava cada tela mais lenta. */
var AP_BRIDGE_ACOES_LEITURA = /^(listar|obter|catalogo|consultar|detalhe|ping|diagnostico|contar|resumo|mural|item|movimentacoes|criticos|matriz|verificar|capacidades|fichas|pendentes|precompras|pedidos|sugestoes|divergencias|gerados|carregar|disponivel|credenciais|proximoSku|verificarSku|buscarSemelhante|porCnpj)$/i;

function AP_BRIDGE_auditar_(req, acao, resultado) {
  if (resultado === 'SUCESSO' && AP_BRIDGE_ACOES_LEITURA.test(String(req.acao || ''))) return;
  AP_BRIDGE_chamar_('auditoria', [
    (req.perfil || 'sistema'), acao, req.modulo, (req.payload && req.payload.id) || '',
    { origem: req.origem || 'DESKTOP', resultado: resultado }
  ], { modulo: req.modulo, acao: acao });
}

/* ============================================================
   4. PRIMEIRO ADMINISTRADOR
   ============================================================ */

function AP_BRIDGE_primeiroUsuario_(payload, ctx) {
  var existentes = AP_BRIDGE_despachar_('usuarios', 'listar', {}, null);

  if (existentes.ok) {
    var bruto = existentes.dados;
    var lista = (bruto && bruto.dados) ? bruto.dados : (bruto && bruto.data ? bruto.data : bruto);
    if (lista && lista.length) {
      return { ok: false, codigo: 'JA_EXISTE_USUARIO', mensagem: 'Já existem usuários cadastrados. Use a tela de login.' };
    }
    var criado = AP_BRIDGE_despachar_('usuarios', 'salvar', payload, null);
    if (!criado.ok) return criado;
    if (criado.dados && criado.dados.ok === false) return criado.dados;

    if (criado.dados && criado.dados.sessao) {
      AP_BRIDGE_auditar_({ modulo: 'usuarios', acao: 'salvar', payload: payload }, 'PRIMEIRO_ACESSO', 'SUCESSO');
      return { ok: true, dados: criado.dados.dados || criado.dados, sessao: criado.dados.sessao, via: criado.via };
    }
    return criado.dados;
  }

  return {
    ok: false, codigo: 'MODULO_USUARIOS_AUSENTE',
    mensagem: 'O módulo de usuários não respondeu. O cadastro NÃO foi gravado.',
    handlerEsperado: 'AP_Modulo_usuarios', detalheCore: existentes.mensagem || null,
    modulo: 'usuarios', acao: 'salvar'
  };
}

/* ============================================================
   5. DOUTOR
   ============================================================ */

function AP_BRIDGE_diagnosticoDoutor_(doutorCore) {
  var caps = AP_BRIDGE_capacidades_();
  var componentes = [];

  componentes.push({
    componente: 'Ponte / API', status: 'OK', ms: 1,
    detalhe: 'almoxaApi v' + AP_BRIDGE_CONFIG.versao
  });

  if (doutorCore && doutorCore.ok && doutorCore.dados && doutorCore.dados.data) {
    (doutorCore.dados.data.itens || []).forEach(function (i) {
      componentes.push({
        componente: i.modulo + (i.funcao ? ' · ' + i.funcao : ''),
        status: i.status === 'ONLINE' ? 'OK' : (i.status === 'WARNING' ? 'ATENCAO' : 'ERRO'),
        ms: 0, detalhe: i.erro || i.detalhe || ''
      });
    });
  }

  Object.keys(caps.encontradas).forEach(function (cap) {
    componentes.push({ componente: 'Capacidade: ' + cap, status: 'OK', ms: 0, detalhe: 'ligada a ' + caps.encontradas[cap] });
  });
  caps.ausentes.forEach(function (a) {
    componentes.push({
      componente: 'Capacidade: ' + a.capacidade, status: 'ATENCAO', ms: 0,
      detalhe: 'não encontrada — procurados: ' + a.procurados.join(', ')
    });
  });
  AP_BRIDGE_modulosLocais_().forEach(function (m) {
    componentes.push({ componente: 'Módulo: ' + m.modulo, status: 'OK', ms: 0, detalhe: 'handler ' + m.handler });
  });

  return { ok: true, dados: componentes, capacidades: caps.encontradas, ausentes: caps.ausentes };
}

/* ============================================================
   6. TESTES
   ============================================================ */

function AP_BRIDGE_res_(nome, ok, detalhe) {
  try { Logger.log((ok ? 'OK    ' : 'ERRO  ') + nome + (detalhe ? ' — ' + detalhe : '')); } catch (e) { }
  return { teste: nome, resultado: ok ? 'OK' : 'ERRO', detalhe: detalhe || '' };
}

function testeCore() {
  var r = AP_BRIDGE_chamar_('boot', []);
  return AP_BRIDGE_res_('testeCore', r.ok, r.ok ? 'via ' + r.via : r.mensagem);
}

function testeApi() {
  var r = JSON.parse(almoxaApi(JSON.stringify({ modulo: 'doutor', acao: 'ping' })));
  return AP_BRIDGE_res_('testeApi', r.ok === true, r.ok ? 'ping respondido' : r.mensagem);
}

function testeSessao() {
  var r = JSON.parse(almoxaApi(JSON.stringify({ modulo: 'estoque', acao: 'listar', sessao: 'TOKEN_FALSO' })));
  return AP_BRIDGE_res_('testeSessao', r.ok === false, 'recusou token falso (' + r.codigo + ')');
}

function testePermissao() {
  var alvo = AP_BRIDGE_resolver_('permissao');
  return AP_BRIDGE_res_('testePermissao', !!alvo, alvo ? 'ligada a ' + alvo.nome : 'Core sem verificação de permissão');
}

function testeMapaDoCore() {
  var caps = AP_BRIDGE_capacidades_();
  var faltam = caps.ausentes.map(function (a) { return a.capacidade; });
  return AP_BRIDGE_res_('testeMapaDoCore', faltam.length === 0,
    Object.keys(caps.encontradas).length + ' capacidade(s) ligada(s)' +
    (faltam.length ? ' · faltam: ' + faltam.join(', ') : ''));
}

function AP_BRIDGE_testarTudo() {
  var r = [testeCore(), testeMapaDoCore(), testeApi(), testeSessao(), testePermissao()];
  var falhas = r.filter(function (x) { return x.resultado === 'ERRO'; });
  try { Logger.log('===== RESUMO: ' + (r.length - falhas.length) + '/' + r.length + ' OK ====='); } catch (e) { }
  return { testes: r, falhas: falhas.length };
}
