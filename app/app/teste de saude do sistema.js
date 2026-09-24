/* ============================================================
   ALMOXA PRO — DIAGNÓSTICO DE PERFORMANCE
   ------------------------------------------------------------
   MODO SOMENTE LEITURA.

   Este arquivo NÃO altera, não apaga e não limpa nada. Mais do
   que prometer isso, ele impede: durante a medição, todas as
   funções de escrita do Core (append, update, remove, batch,
   auditoria, eventos) são substituídas por um registrador que
   anota a tentativa e devolve sem tocar na planilha.

   Se alguma ação tentar gravar, isso aparece no relatório como
   "ESCRITA BLOQUEADA" — é informação útil: significa que uma
   ação de leitura está gravando alguma coisa.

   COMO USAR
   ---------
   1. Cole este arquivo como um novo .gs no projeto do Core.
   2. No editor, rode AP_DIAG_executar.
   3. Veja o relatório em Execuções > Registros (Ctrl+Enter).
      Para receber por e-mail: AP_DIAG_enviarPorEmail().

   Funções disponíveis:
     AP_DIAG_executar()        diagnóstico completo
     AP_DIAG_rapido()          só o inventário das abas (segundos)
     AP_DIAG_enviarPorEmail()  completo + envia o texto por e-mail
     AP_DIAG_modulo('estoque') mede um módulo só

   Observação: o arquivo do Core (AP_Data_*, AP_Core_*) não foi
   analisado junto deste script. Por isso tudo aqui é defensivo:
   o que não existir no projeto é registrado como ausente, não
   quebra a execução.
   ============================================================ */


var AP_DIAG_CFG = {
  versao: '1.0.0',

  /* corta a execução antes do limite do Apps Script (360s) para
     o relatório sempre ser emitido, mesmo incompleto */
  limiteSegundos: 240,

  /* acima disto a ação é considerada lenta */
  alertaMs: 1000,
  criticoMs: 2500,

  /* leitura completa de aba acima disto vira apontamento */
  linhasGrandes: 500,

  /* payload de resposta acima disto vira apontamento */
  respostaGrandeKb: 250,

  /* abas conhecidas do sistema — usadas no inventário */
  abas: [
    'ALMOXA_ITENS', 'ALMOXA_CATEGORIAS', 'ALMOXA_MOVIMENTACOES',
    'ALMOXA_RESERVAS', 'ALMOXA_NOTAS', 'ALMOXA_NF_ITENS',
    'ALMOXA_COMPRAS', 'ALMOXA_EPI_FICHAS', 'ALMOXA_FERRAMENTAS',
    'ALMOXA_OCORRENCIAS', 'ALMOXA_INVENTARIOS', 'ALMOXA_PROJETOS',
    'ALMOXA_RELATORIOS', 'ALMOXA_MURAL', 'ALMOXA_OBRAS',
    'ALMOXA_USUARIOS', 'ALMOXA_AUDITORIA', 'ALMOXA_PATRIMONIO',
    'ALMOXA_FORNECEDORES', 'ALMOXA_CONFIG'
  ],

  /* ações de LEITURA que serão medidas.
     Nada aqui grava — e o bloqueio de escrita garante isso. */
  probes: [
    { modulo: 'estoque', acao: 'listar', payload: {} },
    { modulo: 'estoque', acao: 'resumo', payload: {} },
    { modulo: 'estoque', acao: 'movimentacoes', payload: {} },
    { modulo: 'estoque', acao: 'movimentacoes', payload: { limite: 20 } },
    { modulo: 'itens', acao: 'listar', payload: {} },
    { modulo: 'categorias', acao: 'listar', payload: {} },
    { modulo: 'lojinha', acao: 'catalogo', payload: {} },
    { modulo: 'dashboard', acao: 'mural', payload: {} },
    { modulo: 'painel', acao: 'resumo', payload: {} },
    { modulo: 'nf', acao: 'listar', payload: {} },
    { modulo: 'reservas', acao: 'listar', payload: {} },
    { modulo: 'compras', acao: 'listar', payload: {} },
    { modulo: 'obras', acao: 'listar', payload: {} },
    { modulo: 'projetos', acao: 'listar', payload: {} },
    { modulo: 'ocorrencias', acao: 'listar', payload: {} },
    { modulo: 'inventario', acao: 'listar', payload: {} },
    { modulo: 'epi', acao: 'listar', payload: {} },
    { modulo: 'ferramentas', acao: 'listar', payload: {} },
    { modulo: 'fornecedores', acao: 'listar', payload: {} },
    { modulo: 'aprovacoes', acao: 'listar', payload: {} }
  ],

  /* funções do Core instrumentadas (tempo + contagem) */
  instrumentar: [
    'AP_Data_rows', 'AP_Data_getSheet', 'AP_Data_find',
    'AP_Core_withLock', 'AP_Config_get',
    'AP_OPER_itens_', 'AP_OPER_item_', 'AP_OPER_situacao_',
    'AP_FLUXO_ler_', 'AP_FLUXO_aba_', 'AP_FLUXO_json_',
    'AP_ITENS_listar_', 'AP_CAT_ler_'
  ],

  /* funções de ESCRITA: bloqueadas durante a medição */
  bloquear: [
    'AP_Data_append', 'AP_Data_appendBatch', 'AP_Data_update',
    'AP_Data_remove', 'AP_Data_clear', 'AP_Data_write',
    'AP_Audit_log', 'AP_OPER_invalidar_', 'AP_ITENS_invalidar_'
  ]
};


/* ============================================================
   ESTADO DA MEDIÇÃO
   ============================================================ */

var AP_DIAG = null;

function AP_DIAG_novoEstado_() {
  return {
    inicio: Date.now(),
    probeAtual: null,
    chamadas: [],        // toda chamada instrumentada
    porFuncao: {},       // agregado por função
    leiturasAba: {},     // aba -> { vezes, linhas, ms }
    escritasBloqueadas: [],
    erros: [],
    interrompido: false
  };
}

function AP_DIAG_tempoRestante_() {
  return AP_DIAG_CFG.limiteSegundos - (Date.now() - AP_DIAG.inicio) / 1000;
}


/* ============================================================
   INSTRUMENTAÇÃO
   ------------------------------------------------------------
   No Apps Script, as funções globais vivem em `this`. Trocar
   this['AP_Data_rows'] por uma versão cronometrada intercepta
   TODAS as chamadas, venham de onde vierem — sem editar uma
   linha sequer do Core.

   Tudo é restaurado no finally, mesmo se der erro no meio.
   ============================================================ */

var AP_DIAG_ORIGINAIS_ = {};

function AP_DIAG_instrumentar_() {
  var esc = this;

  AP_DIAG_CFG.instrumentar.forEach(function (nome) {
    if (typeof esc[nome] !== 'function') return;
    AP_DIAG_ORIGINAIS_[nome] = esc[nome];

    esc[nome] = function () {
      var args = Array.prototype.slice.call(arguments);
      var t0 = Date.now();
      var erro = null, saida = null;

      try {
        saida = AP_DIAG_ORIGINAIS_[nome].apply(this, args);
        return saida;
      } catch (e) {
        erro = e.message;
        throw e;
      } finally {
        AP_DIAG_anotar_(nome, args, Date.now() - t0, saida, erro);
      }
    };
  });

  /* escrita: registra a tentativa e não executa */
  AP_DIAG_CFG.bloquear.forEach(function (nome) {
    if (typeof esc[nome] !== 'function') return;
    AP_DIAG_ORIGINAIS_[nome] = esc[nome];

    esc[nome] = function () {
      AP_DIAG.escritasBloqueadas.push({
        funcao: nome,
        probe: AP_DIAG.probeAtual,
        alvo: AP_DIAG_resumirArgs_(Array.prototype.slice.call(arguments))
      });
      /* devolve algo inofensivo e plausível para o chamador seguir */
      return { ok: true, diagnostico: 'ESCRITA_BLOQUEADA_MODO_LEITURA' };
    };
  });

  /* AP_Data_getSheet cria a aba quando ela não existe — isso é
     escrita. Aqui ele só lê; aba ausente vira erro controlado. */
  if (typeof esc.AP_Data_getSheet === 'function') {
    var getSheetInstrumentado = esc.AP_Data_getSheet;
    esc.AP_Data_getSheet = function (nome, colunas) {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var aba = ss.getSheetByName(nome);
      if (!aba) {
        AP_DIAG.erros.push({
          probe: AP_DIAG.probeAtual,
          onde: 'AP_Data_getSheet',
          mensagem: 'aba ausente: ' + nome + ' (não foi criada — modo leitura)'
        });
        throw new Error('DIAG_ABA_AUSENTE: ' + nome);
      }
      return getSheetInstrumentado.call(this, nome, colunas);
    };
  }
}

function AP_DIAG_restaurar_() {
  var esc = this;
  Object.keys(AP_DIAG_ORIGINAIS_).forEach(function (nome) {
    esc[nome] = AP_DIAG_ORIGINAIS_[nome];
  });
  AP_DIAG_ORIGINAIS_ = {};
}

/** Uma assinatura curta dos argumentos — serve para achar chamadas repetidas */
function AP_DIAG_resumirArgs_(args) {
  try {
    return args.map(function (a) {
      if (a === null || a === undefined) return '-';
      if (typeof a === 'function') return 'fn';
      if (typeof a === 'object') {
        var s = JSON.stringify(a);
        return s.length > 80 ? s.slice(0, 80) + '…' : s;
      }
      return String(a);
    }).join(' | ');
  } catch (e) {
    return '(args não serializáveis)';
  }
}

function AP_DIAG_anotar_(nome, args, ms, saida, erro) {
  var assinatura = nome + '(' + AP_DIAG_resumirArgs_(args) + ')';
  var linhas = (saida && saida.length !== undefined && typeof saida !== 'string')
    ? saida.length : null;

  AP_DIAG.chamadas.push({
    probe: AP_DIAG.probeAtual, funcao: nome,
    assinatura: assinatura, ms: ms, linhas: linhas, erro: erro
  });

  var ag = AP_DIAG.porFuncao[nome] || (AP_DIAG.porFuncao[nome] = {
    funcao: nome, vezes: 0, ms: 0, pior: 0, linhas: 0, erros: 0
  });
  ag.vezes++; ag.ms += ms;
  if (ms > ag.pior) ag.pior = ms;
  if (linhas) ag.linhas += linhas;
  if (erro) ag.erros++;

  /* leitura de aba inteira: AP_Data_rows(nomeDaAba) */
  if (nome === 'AP_Data_rows' && typeof args[0] === 'string') {
    var a = AP_DIAG.leiturasAba[args[0]] || (AP_DIAG.leiturasAba[args[0]] = {
      aba: args[0], vezes: 0, linhas: 0, ms: 0, porProbe: {}
    });
    a.vezes++; a.ms += ms;
    if (linhas) a.linhas += linhas;
    var p = AP_DIAG.probeAtual || '(fora de probe)';
    a.porProbe[p] = (a.porProbe[p] || 0) + 1;
  }
}


/* ============================================================
   1. INVENTÁRIO DAS ABAS — quanto dado existe de verdade
   ------------------------------------------------------------
   getLastRow é barato. A leitura completa é medida uma vez por
   aba para saber quanto custa cada varredura que o Core faz.
   ============================================================ */

function AP_DIAG_inventario_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var existentes = {};
  ss.getSheets().forEach(function (s) { existentes[s.getName()] = s; });

  /* abas conhecidas + qualquer outra ALMOXA_ que apareça */
  var nomes = AP_DIAG_CFG.abas.slice();
  Object.keys(existentes).forEach(function (n) {
    if (nomes.indexOf(n) === -1 && n.indexOf('ALMOXA') === 0) nomes.push(n);
  });

  return nomes.map(function (nome) {
    var s = existentes[nome];
    if (!s) return { aba: nome, existe: false, linhas: 0, colunas: 0, celulas: 0, msLeitura: null };

    var linhas = s.getLastRow(), colunas = s.getLastColumn();
    var msLeitura = null;

    if (linhas > 0 && AP_DIAG_tempoRestante_() > 20) {
      var t0 = Date.now();
      s.getRange(1, 1, linhas, Math.max(colunas, 1)).getValues();
      msLeitura = Date.now() - t0;
    }

    return {
      aba: nome, existe: true,
      linhas: Math.max(0, linhas - 1),          // menos o cabeçalho
      colunas: colunas,
      celulas: Math.max(0, linhas) * Math.max(0, colunas),
      msLeitura: msLeitura
    };
  });
}


/* ============================================================
   2. MEDIÇÃO DAS AÇÕES DOS MÓDULOS
   ============================================================ */

function AP_DIAG_medirProbe_(probe) {
  var fn = this['AP_Modulo_' + probe.modulo];
  var nome = probe.modulo + '.' + probe.acao;

  if (typeof fn !== 'function') {
    return {
      nome: nome, modulo: probe.modulo, acao: probe.acao,
      ausente: true, ms: 0, registros: 0
    };
  }

  AP_DIAG.probeAtual = nome;
  var marcaChamadas = AP_DIAG.chamadas.length;
  var marcaEscritas = AP_DIAG.escritasBloqueadas.length;

  var t0 = Date.now(), resposta = null, erro = null;
  try {
    resposta = fn(probe.acao, JSON.parse(JSON.stringify(probe.payload || {})),
      { usuario: 'DIAGNOSTICO', userId: 'DIAG', perfil: 'admin' });
  } catch (e) {
    erro = e.message;
    AP_DIAG.erros.push({ probe: nome, onde: 'AP_Modulo_' + probe.modulo, mensagem: e.message });
  }
  var ms = Date.now() - t0;
  AP_DIAG.probeAtual = null;

  var doProbe = AP_DIAG.chamadas.slice(marcaChamadas);
  var registros = 0, tamanhoKb = 0;

  if (resposta && resposta.dados) {
    registros = (resposta.dados.length !== undefined && typeof resposta.dados !== 'string')
      ? resposta.dados.length : 1;
    try { tamanhoKb = Math.round(JSON.stringify(resposta.dados).length / 1024); } catch (e) { }
  }

  /* chamadas repetidas com os MESMOS argumentos dentro da mesma ação */
  var contagem = {};
  doProbe.forEach(function (c) { contagem[c.assinatura] = (contagem[c.assinatura] || 0) + 1; });
  var duplicadas = Object.keys(contagem)
    .filter(function (k) { return contagem[k] > 1; })
    .map(function (k) { return { assinatura: k, vezes: contagem[k] }; })
    .sort(function (a, b) { return b.vezes - a.vezes; });

  /* abas lidas por inteiro nesta ação */
  var abasLidas = {};
  var linhasLidas = 0;
  doProbe.forEach(function (c) {
    if (c.funcao !== 'AP_Data_rows') return;
    var aba = c.assinatura.replace(/^AP_Data_rows\(/, '').split(' | ')[0].replace(/\)$/, '');
    abasLidas[aba] = (abasLidas[aba] || 0) + 1;
    linhasLidas += c.linhas || 0;
  });

  /* onde o tempo foi gasto dentro da ação */
  var porFuncao = {};
  doProbe.forEach(function (c) {
    var f = porFuncao[c.funcao] || (porFuncao[c.funcao] = { funcao: c.funcao, vezes: 0, ms: 0 });
    f.vezes++; f.ms += c.ms;
  });
  var maisCara = Object.keys(porFuncao).map(function (k) { return porFuncao[k]; })
    .sort(function (a, b) { return b.ms - a.ms; })[0] || null;

  return {
    nome: nome, modulo: probe.modulo, acao: probe.acao,
    ms: ms, ok: !!(resposta && resposta.ok), erro: erro,
    codigo: resposta && resposta.codigo,
    registros: registros, tamanhoKb: tamanhoKb,
    chamadas: doProbe.length,
    linhasLidas: linhasLidas,
    abasLidas: abasLidas,
    duplicadas: duplicadas,
    maisCara: maisCara,
    escritasBloqueadas: AP_DIAG.escritasBloqueadas.length - marcaEscritas
  };
}


/* ============================================================
   3. TEMPO DE RESPOSTA DO CORE (a porta de entrada real)
   ------------------------------------------------------------
   O front chama almoxaApi(JSON). Medir o módulo direto esconde
   o custo do roteador, da sessão e do JSON de ida e volta.
   ============================================================ */

function AP_DIAG_medirCore_() {
  if (typeof this.almoxaApi !== 'function') {
    return { disponivel: false, nota: 'almoxaApi não existe neste projeto' };
  }

  var amostras = [
    { modulo: 'estoque', acao: 'listar', payload: {} },
    { modulo: 'categorias', acao: 'listar', payload: {} },
    { modulo: 'dashboard', acao: 'mural', payload: {} }
  ];

  var medidas = amostras.map(function (req) {
    if (AP_DIAG_tempoRestante_() < 30) return null;
    var corpo = JSON.stringify({
      modulo: req.modulo, acao: req.acao, payload: req.payload,
      sessao: null, perfil: 'admin', origem: 'DIAGNOSTICO', ts: Date.now()
    });

    var t0 = Date.now(), bruto = null, erro = null;
    try { bruto = this.almoxaApi(corpo); } catch (e) { erro = e.message; }
    var ms = Date.now() - t0;

    return {
      rota: req.modulo + '.' + req.acao, ms: ms, erro: erro,
      respostaKb: bruto ? Math.round(String(bruto).length / 1024) : 0
    };
  }, this).filter(function (m) { return !!m; });

  /* o custo do próprio empacotamento, isolado */
  var t0 = Date.now();
  for (var i = 0; i < 200; i++) JSON.parse(JSON.stringify({ a: 1, b: 'x', c: [1, 2, 3] }));
  var msSerializacao = Date.now() - t0;

  return { disponivel: true, medidas: medidas, msSerializacao200x: msSerializacao };
}


/* ============================================================
   4. DIAGNÓSTICO — transforma número em apontamento
   ============================================================ */

function AP_DIAG_avaliar_(p, inventarioPorAba) {
  var achados = [];

  function add(gravidade, problema, sugestao) {
    achados.push({ gravidade: gravidade, problema: problema, sugestao: sugestao });
  }

  if (p.ausente) {
    return [{
      gravidade: 'INFO',
      problema: 'módulo não existe neste projeto',
      sugestao: 'Ignore, ou confirme se o arquivo do módulo foi publicado no Core.'
    }];
  }

  if (p.erro) {
    add('CRÍTICO', 'a ação lançou exceção: ' + p.erro,
      'Corrija antes de medir o resto — a tela que usa esta ação está quebrada ou ' +
      'vive de timeout no navegador.');
  } else if (!p.ok) {
    add('ALTO', 'a ação respondeu ok:false' + (p.codigo ? ' (' + p.codigo + ')' : ''),
      'Veja se é recusa legítima (falta payload) ou falha real.');
  }

  if (p.ms >= AP_DIAG_CFG.criticoMs) {
    add('CRÍTICO', 'tempo de ' + p.ms + ' ms',
      'Acima de 2,5 s o usuário acha que travou. ' +
      (p.maisCara ? 'O peso está em ' + p.maisCara.funcao + ' (' + p.maisCara.ms + ' ms em ' +
        p.maisCara.vezes + ' chamada(s)). ' : '') +
      'Comece por aí.');
  } else if (p.ms >= AP_DIAG_CFG.alertaMs) {
    add('MÉDIO', 'tempo de ' + p.ms + ' ms',
      'Aceitável hoje, mas cresce junto com a planilha. Reveja se o volume aumentar.');
  }

  /* leitura de aba inteira repetida na mesma ação */
  Object.keys(p.abasLidas || {}).forEach(function (aba) {
    var vezes = p.abasLidas[aba];
    var inv = inventarioPorAba[aba];
    if (vezes > 1) {
      add('ALTO', aba + ' foi lida por inteiro ' + vezes + ' vezes na MESMA ação',
        'Leia uma vez no começo da ação e passe o resultado adiante, ou guarde num cache ' +
        'de execução (como AP_OPER_ITENS_CACHE_ já faz com os itens). ' +
        'Cada leitura repetida é uma ida à planilha que não devolve nada novo.');
    }
    if (inv && inv.linhas >= AP_DIAG_CFG.linhasGrandes && p.registros && p.registros < inv.linhas * 0.2) {
      add('ALTO', 'leu ' + inv.linhas + ' linhas de ' + aba + ' para devolver ' + p.registros + ' registro(s)',
        'Filtrar depois de ler tudo é o gargalo clássico aqui. Use ' +
        'TextFinder/createTextFinder para localizar a linha, ou mantenha uma aba de ' +
        'índice (chave → linha). Para listagens, pagine no servidor em vez de mandar tudo.');
    }
  });

  if (p.duplicadas && p.duplicadas.length) {
    var d = p.duplicadas[0];
    add('MÉDIO', p.duplicadas.length + ' chamada(s) repetida(s) com os mesmos argumentos; a pior: ' +
      d.assinatura + ' × ' + d.vezes,
      'Mesma pergunta, mesma resposta: guarde o retorno numa variável. ' +
      'Repetição dentro de um laço costuma ser o motivo.');
  }

  if (p.tamanhoKb >= AP_DIAG_CFG.respostaGrandeKb) {
    add('MÉDIO', 'resposta de ' + p.tamanhoKb + ' KB',
      'Payload grande demora a serializar, trafegar e renderizar. Devolva só as colunas ' +
      'que a tela usa e pagine (limite + offset).');
  }

  if (p.escritasBloqueadas) {
    add('ALTO', p.escritasBloqueadas + ' tentativa(s) de ESCRITA numa ação de leitura',
      'Uma listagem que grava (auditoria, cache em planilha, criação de aba) paga o preço ' +
      'de uma escrita a cada abertura de tela. Mova isso para as ações que realmente alteram dados.');
  }

  if (!achados.length) {
    achados.push({ gravidade: 'OK', problema: '—', sugestao: 'Dentro do esperado.' });
  }
  return achados;
}


/* ============================================================
   5. EXECUÇÃO
   ============================================================ */

function AP_DIAG_executar(opcoes) {
  opcoes = opcoes || {};
  AP_DIAG = AP_DIAG_novoEstado_();

  var relatorio = {
    versao: AP_DIAG_CFG.versao,
    quando: new Date(),
    planilha: null,
    inventario: [],
    core: null,
    probes: [],
    porFuncao: [],
    leiturasAba: [],
    escritasBloqueadas: [],
    erros: [],
    interrompido: false
  };

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    relatorio.planilha = { nome: ss.getName(), id: ss.getId(), abas: ss.getSheets().length };
  } catch (e) {
    relatorio.erros.push({ onde: 'abrir planilha', mensagem: e.message });
    return AP_DIAG_finalizar_(relatorio);
  }

  /* inventário antes de instrumentar: são leituras nossas, não do Core */
  relatorio.inventario = AP_DIAG_inventario_();
  var porAba = {};
  relatorio.inventario.forEach(function (i) { porAba[i.aba] = i; });

  if (opcoes.somenteInventario) return AP_DIAG_finalizar_(relatorio);

  AP_DIAG_instrumentar_();
  try {
    var probes = opcoes.probes || AP_DIAG_CFG.probes;

    probes.forEach(function (probe) {
      if (AP_DIAG_tempoRestante_() < 25) {
        AP_DIAG.interrompido = true;
        relatorio.probes.push({
          nome: probe.modulo + '.' + probe.acao, modulo: probe.modulo, acao: probe.acao,
          naoMedido: true, ms: 0, registros: 0,
          achados: [{
            gravidade: 'INFO', problema: 'não medido (limite de tempo da execução)',
            sugestao: 'Rode AP_DIAG_modulo(\'' + probe.modulo + '\') separadamente.'
          }]
        });
        return;
      }

      var p = AP_DIAG_medirProbe_(probe);
      p.achados = AP_DIAG_avaliar_(p, porAba);
      relatorio.probes.push(p);
    });

    if (!opcoes.pularCore && AP_DIAG_tempoRestante_() > 40) {
      relatorio.core = AP_DIAG_medirCore_();
    }
  } finally {
    /* aconteça o que acontecer, o Core volta ao normal */
    AP_DIAG_restaurar_();
  }

  relatorio.porFuncao = Object.keys(AP_DIAG.porFuncao)
    .map(function (k) {
      var f = AP_DIAG.porFuncao[k];
      f.media = Math.round(f.ms / Math.max(1, f.vezes));
      return f;
    })
    .sort(function (a, b) { return b.ms - a.ms; });

  relatorio.leiturasAba = Object.keys(AP_DIAG.leiturasAba)
    .map(function (k) { return AP_DIAG.leiturasAba[k]; })
    .sort(function (a, b) { return b.ms - a.ms; });

  relatorio.escritasBloqueadas = AP_DIAG.escritasBloqueadas;
  relatorio.erros = relatorio.erros.concat(AP_DIAG.erros);
  relatorio.interrompido = AP_DIAG.interrompido;

  return AP_DIAG_finalizar_(relatorio);
}

function AP_DIAG_finalizar_(relatorio) {
  relatorio.duracaoTotalMs = Date.now() - AP_DIAG.inicio;
  var texto = AP_DIAG_formatar(relatorio);
  relatorio.texto = texto;
  try { Logger.log(texto); } catch (e) { }
  return relatorio;
}

/** Só o inventário — roda em segundos, bom para uma primeira olhada */
function AP_DIAG_rapido() {
  return AP_DIAG_executar({ somenteInventario: true });
}

/** Mede um módulo só, quando a execução completa não cabe no tempo */
function AP_DIAG_modulo(modulo) {
  var probes = AP_DIAG_CFG.probes.filter(function (p) { return p.modulo === modulo; });
  if (!probes.length) probes = [{ modulo: modulo, acao: 'listar', payload: {} }];
  return AP_DIAG_executar({ probes: probes, pularCore: true });
}

/** O relatório no e-mail de quem rodou (não grava nada na planilha) */
function AP_DIAG_enviarPorEmail(destinatario) {
  var r = AP_DIAG_executar();
  var para = destinatario || Session.getEffectiveUser().getEmail();
  MailApp.sendEmail(para,
    'ALMOXA PRO — diagnóstico de performance ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM HH:mm'),
    r.texto);
  return 'Relatório enviado para ' + para;
}


/* ============================================================
   6. RELATÓRIO
   ============================================================ */

function AP_DIAG_formatar(r) {
  var L = [];
  function linha(c) { L.push(c === undefined ? '' : c); }
  function titulo(t) { linha(''); linha('=== ' + t + ' '.repeat(Math.max(0, 60 - t.length)).replace(/ /g, '=')); }
  function pad(v, n) { v = String(v === null || v === undefined ? '—' : v); return v.length >= n ? v.slice(0, n) : v + ' '.repeat(n - v.length); }
  function padE(v, n) { v = String(v === null || v === undefined ? '—' : v); return v.length >= n ? v : ' '.repeat(n - v.length) + v; }

  linha('ALMOXA PRO — DIAGNÓSTICO DE PERFORMANCE (somente leitura)');
  linha('gerado em ' + Utilities.formatDate(r.quando, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss'));
  if (r.planilha) linha('planilha: ' + r.planilha.nome + ' · ' + r.planilha.abas + ' abas');
  linha('duração do diagnóstico: ' + Math.round((r.duracaoTotalMs || 0) / 1000) + ' s');
  if (r.interrompido) linha('ATENÇÃO: o diagnóstico parou no limite de tempo. Parte das ações não foi medida.');

  /* --- resumo executivo --- */
  var medidos = (r.probes || []).filter(function (p) { return !p.ausente && !p.naoMedido; });
  var criticos = medidos.filter(function (p) {
    return p.achados.some(function (a) { return a.gravidade === 'CRÍTICO'; });
  });
  var lentos = medidos.slice().sort(function (a, b) { return b.ms - a.ms; }).slice(0, 5);

  titulo('RESUMO');
  linha('ações medidas: ' + medidos.length + ' · com apontamento crítico: ' + criticos.length);
  linha('registros processados no total: ' +
    medidos.reduce(function (s, p) { return s + (p.registros || 0); }, 0));
  linha('linhas lidas de planilha durante o teste: ' +
    medidos.reduce(function (s, p) { return s + (p.linhasLidas || 0); }, 0));
  linha('tentativas de escrita bloqueadas: ' + (r.escritasBloqueadas || []).length);
  linha('erros capturados: ' + (r.erros || []).length);
  linha('');
  linha('AS 5 AÇÕES MAIS LENTAS');
  lentos.forEach(function (p, i) {
    linha('  ' + (i + 1) + '. ' + pad(p.nome, 28) + padE(p.ms + ' ms', 10) +
      '   ' + p.registros + ' registro(s)');
  });

  /* --- tabela principal --- */
  titulo('POR AÇÃO — FUNÇÃO · MÓDULO · TEMPO · PROBLEMA · SUGESTÃO');
  (r.probes || []).forEach(function (p) {
    linha('');
    linha('▸ ' + p.nome.toUpperCase() +
      (p.ausente ? '   [módulo ausente]' : '') +
      (p.naoMedido ? '   [não medido]' : ''));
    if (!p.ausente && !p.naoMedido) {
      linha('  módulo: ' + p.modulo + ' · função: AP_Modulo_' + p.modulo + "('" + p.acao + "')");
      linha('  tempo: ' + p.ms + ' ms · registros devolvidos: ' + p.registros +
        ' · resposta: ' + p.tamanhoKb + ' KB');
      linha('  chamadas internas: ' + p.chamadas + ' · linhas lidas: ' + p.linhasLidas +
        (p.maisCara ? ' · mais cara: ' + p.maisCara.funcao + ' (' + p.maisCara.ms + ' ms)' : ''));
      var abas = Object.keys(p.abasLidas || {});
      if (abas.length) {
        linha('  abas lidas por inteiro: ' + abas.map(function (a) {
          return a + ' ×' + p.abasLidas[a];
        }).join(', '));
      }
    }
    (p.achados || []).forEach(function (a) {
      if (a.gravidade === 'OK') { linha('  ✓ sem apontamentos'); return; }
      linha('  [' + a.gravidade + '] ' + a.problema);
      linha('     → ' + a.sugestao);
    });
  });

  /* --- funções --- */
  titulo('FUNÇÕES DO CORE — ONDE O TEMPO FOI GASTO');
  linha(pad('função', 26) + padE('vezes', 7) + padE('total ms', 11) + padE('média', 8) + padE('pior', 8) + padE('linhas', 9) + padE('erros', 7));
  (r.porFuncao || []).forEach(function (f) {
    linha(pad(f.funcao, 26) + padE(f.vezes, 7) + padE(f.ms, 11) + padE(f.media, 8) +
      padE(f.pior, 8) + padE(f.linhas || '—', 9) + padE(f.erros, 7));
  });
  if (!(r.porFuncao || []).length) {
    linha('(nenhuma função instrumentada foi chamada — confira os nomes em AP_DIAG_CFG.instrumentar)');
  }

  /* --- leitura de planilha --- */
  titulo('CONSULTAS QUE LEEM PLANILHA INTEIRA');
  if (!(r.leiturasAba || []).length) {
    linha('(nenhuma leitura completa registrada via AP_Data_rows)');
  }
  (r.leiturasAba || []).forEach(function (a) {
    linha('');
    linha('▸ ' + a.aba + ' — ' + a.vezes + ' leitura(s) completa(s), ' + a.ms + ' ms, ' + a.linhas + ' linha(s) trafegadas');
    var repetidas = Object.keys(a.porProbe).filter(function (k) { return a.porProbe[k] > 1; });
    if (repetidas.length) {
      linha('  releituras na mesma ação: ' + repetidas.map(function (k) {
        return k + ' ×' + a.porProbe[k];
      }).join(', '));
      linha('     → cache de execução resolve: leia uma vez, reaproveite.');
    }
  });

  /* --- inventário --- */
  titulo('VOLUME DE DADOS POR ABA');
  linha(pad('aba', 26) + padE('linhas', 9) + padE('colunas', 9) + padE('células', 10) + padE('ms p/ ler tudo', 16));
  (r.inventario || []).forEach(function (i) {
    if (!i.existe) { linha(pad(i.aba, 26) + '  (não existe)'); return; }
    linha(pad(i.aba, 26) + padE(i.linhas, 9) + padE(i.colunas, 9) + padE(i.celulas, 10) +
      padE(i.msLeitura === null ? '—' : i.msLeitura, 16));
  });
  linha('');
  linha('Regra prática: acima de ~5.000 linhas, cada varredura completa passa de 1 s.');
  linha('É nessas abas que vale trocar "ler tudo e filtrar" por busca direta ou índice.');

  /* --- core --- */
  titulo('TEMPO DE RESPOSTA DO CORE (almoxaApi)');
  if (!r.core) {
    linha('(não medido)');
  } else if (!r.core.disponivel) {
    linha(r.core.nota);
  } else {
    linha(pad('rota', 26) + padE('ms', 9) + padE('resposta KB', 14));
    r.core.medidas.forEach(function (m) {
      linha(pad(m.rota, 26) + padE(m.ms, 9) + padE(m.respostaKb, 14) + (m.erro ? '  ERRO: ' + m.erro : ''));
    });
    linha('');
    linha('custo de serialização (200 ciclos JSON): ' + r.core.msSerializacao200x + ' ms');
    linha('Diferença entre a rota e a ação do módulo = custo do roteador, sessão e JSON.');
    linha('Se essa diferença passar de ~300 ms, o gargalo está na porta de entrada, não no módulo.');
  }

  /* --- escritas --- */
  titulo('ESCRITAS BLOQUEADAS DURANTE A MEDIÇÃO');
  if (!(r.escritasBloqueadas || []).length) {
    linha('Nenhuma. As ações de leitura não tentaram gravar nada — como esperado.');
  } else {
    linha('Estas chamadas foram interceptadas e NÃO executadas:');
    (r.escritasBloqueadas || []).forEach(function (e) {
      linha('  · ' + e.funcao + '  em ' + (e.probe || '(fora de ação)') + '  → ' + e.alvo);
    });
    linha('');
    linha('→ Ação de leitura que grava paga preço de escrita a cada abertura de tela.');
  }

  /* --- erros --- */
  titulo('ERROS E GARGALOS DE CARREGAMENTO');
  if (!(r.erros || []).length) {
    linha('Nenhum erro capturado.');
  } else {
    (r.erros || []).forEach(function (e) {
      linha('  · ' + (e.probe || '—') + ' | ' + e.onde + ' | ' + e.mensagem);
    });
  }

  titulo('FIM');
  linha('Nenhum dado foi alterado, excluído ou limpo nesta execução.');
  return L.join('\n');
}
