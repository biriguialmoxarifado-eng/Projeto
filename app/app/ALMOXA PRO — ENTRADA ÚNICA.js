/**
 * ============================================================
 * ALMOXA PRO — ENTRADA ÚNICA
 * Versão 2.0.0 · corrige o CONFLITO DE doGet
 * ------------------------------------------------------------
 * O QUE ESTAVA ERRADO (assumido tecnicamente)
 *
 * A versão 1.0.0 deste arquivo declarava:
 *
 *     function doGet(e) { ... }
 *
 * O Core Master também declara o dele:
 *
 *     function doGet(e) {
 *       AP_Core_boot();
 *       HtmlService.createTemplateFromFile('Index');
 *     }
 *
 * No Apps Script, os arquivos .gs compartilham UM escopo global.
 * Duas funções com o mesmo nome não convivem: a última carregada
 * sobrescreve a anterior, e a ordem depende da posição dos
 * arquivos no projeto. Resultado: ora abria um, ora o outro.
 * Quando vencia o doGet do Core, ele procurava 'Index' — que
 * pode nem existir — e a tela ficava em erro.
 *
 * Isso foi um defeito de arquitetura introduzido por mim, não
 * um erro do usuário, da planilha, do navegador nem do Google.
 *
 * O QUE MUDOU
 *
 * Este arquivo NÃO declara mais doGet. Ele expõe:
 *
 *     AP_ENTRADA_servir(e)
 *
 * O único doGet do projeto passa a ser o do Core Master, e ele
 * chama esta função. Um ponto de entrada, sem disputa.
 *
 * COMO LIGAR (uma linha no Core Master)
 *
 *     function doGet(e) {
 *       return AP_ENTRADA_servir(e);   // faz boot, registra módulos e serve o HTML
 *     }
 *
 * Se o Core não tiver doGet, crie um arquivo com essas 3 linhas.
 * ============================================================
 */

var AP_ENTRADA = {
  versao: '2.0.0',

  /** Candidatos a frontend, na ordem de preferência.
   *  A entrada usa o PRIMEIRO que existir de verdade no projeto. */
  htmlCandidatos: ['ALMOXA_PRO_DESKTOP', 'Index', 'index', 'ALMOXA_PRO', 'Frontend'],

  titulo: 'ALMOXA PRO · Gestão Inteligente para Obras'
};

/* ------------------------------------------------------------
   1. DESCOBERTA DO FRONTEND — sem adivinhação
   ------------------------------------------------------------ */

/** Testa quais arquivos HTML existem mesmo no projeto */
function AP_ENTRADA_htmlDisponiveis_() {
  var achados = [], ausentes = [];
  AP_ENTRADA.htmlCandidatos.forEach(function (nome) {
    try {
      HtmlService.createHtmlOutputFromFile(nome);
      achados.push(nome);
    } catch (e) {
      ausentes.push(nome);
    }
  });
  return { achados: achados, ausentes: ausentes };
}

function AP_ENTRADA_htmlOficial_() {
  var r = AP_ENTRADA_htmlDisponiveis_();
  return r.achados.length ? r.achados[0] : null;
}

/* ------------------------------------------------------------
   2. BOOT DO CORE
   ------------------------------------------------------------ */
/**
 * Boot do Core.
 *
 * O boot completo cria abas, testa cache e lock, registra o módulo e
 * grava diagnóstico — várias escritas na planilha. Fazer isso a CADA
 * abertura deixava a entrada lenta. Agora o boot completo roda uma vez
 * por dia; nas demais aberturas só confirma que a planilha responde.
 */
function AP_ENTRADA_boot_() {
  var candidatos = ['AP_Core_boot', 'AP_CORE_boot', 'AP_boot', 'Core_boot'];
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;

  /* verificação leve quando o boot completo já rodou hoje */
  try {
    var hoje = new Date().toISOString().slice(0, 10);
    var ultimo = AP_Config_get('ULTIMO_BOOT_COMPLETO', null);
    if (String(ultimo) === hoje) {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      if (ss) {
        ss.getName();   // confirma acesso sem escrever nada
        return { encontrado: true, ok: true, via: 'boot-do-dia (verificação leve)', leve: true };
      }
    }
  } catch (eLeve) { /* na dúvida, faz o boot completo */ }

  for (var i = 0; i < candidatos.length; i++) {
    var nome = candidatos[i];
    if (typeof g[nome] !== 'function') continue;
    try {
      var retorno = g[nome]();
      try { AP_Config_set('ULTIMO_BOOT_COMPLETO', new Date().toISOString().slice(0, 10)); } catch (e2) { }
      return { encontrado: true, ok: true, via: nome, retorno: retorno };
    } catch (e) {
      return {
        encontrado: true, ok: false, via: nome,
        erro: e.message,
        linha: (e.stack ? String(e.stack).split('\n')[0] : null)
      };
    }
  }
  return {
    encontrado: false, ok: true, via: null,
    aviso: 'Nenhuma função de boot encontrada. O sistema abre, mas o Core pode não estar inicializado.'
  };
}

/* ------------------------------------------------------------
   3. REGISTRO DE MÓDULOS — só o que existe de fato
   ------------------------------------------------------------ */
var AP_ENTRADA_MODULOS = [
  { nome: 'usuarios', descricao: 'Cadastro, login e perfis' },
  { nome: 'auth', descricao: 'Autenticação e sessão' },
  { nome: 'permissoes', descricao: 'Matriz de perfis e alçadas' },
  { nome: 'itens', descricao: 'Cadastro central de itens' },
  { nome: 'fornecedores', descricao: 'Fornecedores' },
  { nome: 'config', descricao: 'Parâmetros do sistema' },
  { nome: 'estoque', descricao: 'Saldos e movimentações' },
  { nome: 'reservas', descricao: 'Reservas e aprovações' },
  { nome: 'lojinha', descricao: 'Catálogo da loja' },
  { nome: 'epi', descricao: 'EPI, fichas e kits' },
  { nome: 'ferramentas', descricao: 'Ferramentaria e patrimônio' },
  { nome: 'nf', descricao: 'Notas fiscais e conferência' },
  { nome: 'compras', descricao: 'Compras e pré-compras' },
  { nome: 'ocorrencias', descricao: 'Ocorrências e entrega futura' },
  { nome: 'projetos', descricao: 'Projetos e materiais' },
  { nome: 'inventario', descricao: 'Inventário e divergências' },
  { nome: 'relatorios', descricao: 'Relatórios e documentos' },
  { nome: 'painel', descricao: 'Mural / painel interativo' },
  { nome: 'mural', descricao: 'Publicações e fotos' },
  { nome: 'aprovacoes', descricao: 'Fila de aprovação' },
  { nome: 'categorias', descricao: 'Categorias do catálogo' },
  { nome: 'obras', descricao: 'Obras e almoxarifados' },
  { nome: 'ocr', descricao: 'Leitura de PDF e imagem' },
  { nome: 'manutencao', descricao: 'Manutenção, versões e backup' },
  { nome: 'kits', descricao: 'Kits de itens por função' },
  { nome: 'calendario', descricao: 'Calendário operacional' },
  { nome: 'centros', descricao: 'Centros de custo' },
  { nome: 'solicitacoes', descricao: 'Solicitações da loja' },
  { nome: 'retiradas', descricao: 'Retirada de reserva' },
  { nome: 'saidas', descricao: 'Saídas de estoque' },
  { nome: 'notificacoes', descricao: 'Avisos por perfil' },
  { nome: 'automacao', descricao: 'Regras de automação' },
  { nome: 'auditoria', descricao: 'Trilha de auditoria' },
  { nome: 'biometria', descricao: 'Credenciais biométricas' },
  { nome: 'inteligencia', descricao: 'Motor de inteligência de projetos' },
  { nome: 'backup', descricao: 'Backup e exportação de dados' },
  { nome: 'doutor', descricao: 'Diagnóstico do sistema' },
  { nome: 'permissoes', descricao: 'Perfis, permissões e alçadas' },
  { nome: 'nfmotor', descricao: 'Motor de leitura de notas fiscais' },
  { nome: 'loja', descricao: 'Motor de compatibilidade e montagem' },
  { nome: 'imagens', descricao: 'Motor de imagens sob demanda' },
  { nome: 'backupauto', descricao: 'Backup automático diário' },
  { nome: 'documentos', descricao: 'Document Engine e links de aprovação' },
  { nome: 'localizacao', descricao: 'Estrutura física do almoxarifado' },
  { nome: 'locais', descricao: 'Cadastro de localizações' },
  { nome: 'patrimonio', descricao: 'Patrimônio e etiquetas com QR Code' }
];

function AP_ENTRADA_registrarModulos_() {
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  var candidatosRegistro = ['AP_Core_registrarModulo', 'AP_Core_register',
    'AP_Modules_register', 'AP_Core_addModulo'];

  var fnRegistro = null, nomeRegistro = null;
  for (var i = 0; i < candidatosRegistro.length; i++) {
    if (typeof g[candidatosRegistro[i]] === 'function') {
      fnRegistro = g[candidatosRegistro[i]];
      nomeRegistro = candidatosRegistro[i];
      break;
    }
  }

  var registrados = [], ausentes = [], erros = [];

  AP_ENTRADA_MODULOS.forEach(function (m) {
    var handler = 'AP_Modulo_' + m.nome;
    if (typeof g[handler] !== 'function') {
      ausentes.push({ modulo: m.nome, handlerEsperado: handler, descricao: m.descricao });
      return;
    }
    if (!fnRegistro) {
      /* handler existe, mas o Core não expõe registro:
         o despacho acontece pela ponte, e isso fica declarado */
      registrados.push({ modulo: m.nome, handler: handler, viaRegistroDoCore: false });
      return;
    }
    try {
      fnRegistro(m.nome, g[handler], { descricao: m.descricao, origem: 'ALMOXA PRO' });
      registrados.push({ modulo: m.nome, handler: handler, viaRegistroDoCore: true });
    } catch (e) {
      erros.push({ modulo: m.nome, erro: e.message });
    }
  });

  return {
    funcaoDeRegistro: nomeRegistro,
    registrados: registrados,
    quantidade: registrados.length,
    ausentes: ausentes,
    erros: erros
  };
}

/* ------------------------------------------------------------
   4. PONTO ÚNICO — chamado pelo doGet do Core
   ------------------------------------------------------------ */
function AP_ENTRADA_servir(e) {
  var params = (e && e.parameter) ? e.parameter : {};

  /**
   * Link de aprovação: abre uma página própria, sem login.
   *
   * Vem antes de tudo porque o responsável que recebe o link pelo
   * WhatsApp não deve entrar no sistema — ele só decide.
   */
  if (params.aprovar) {
    return AP_ENTRADA_paginaAprovacao_(params.aprovar, params);
  }

  /**
   * MÓDULO 3D — servido pelo próprio Apps Script.
   *
   * O arquivo ALMOXA_3D é um HTML separado dentro do projeto.
   * Assim o mapa abre pelo mesmo endereço do sistema, sem precisar
   * hospedar nada fora — e continua isolado: a biblioteca 3D só
   * carrega quando alguém pede esta página.
   */
  if (params.p === '3d' || params.pagina === '3d') {
    return AP_ENTRADA_servirModulo3D_(params);
  }

  /**
   * ETIQUETA DE PATRIMÔNIO
   *
   * Quem lê o QR Code colado no equipamento chega aqui. Abre no
   * celular, sem login, e mostra a ficha — menos valor, fornecedor
   * e nota fiscal, que a etiqueta fica à vista de qualquer um.
   */
  /**
   * ROTA DA FICHA DO PATRIMÔNIO
   *
   * O QR manda o código, isto acha o PDF no Drive e manda o
   * navegador direto para lá. Ninguém procura arquivo.
   *
   * Aceita todas as formas que já circularam em etiquetas
   * impressas: ?f=, ?pat=, ?ficha=, ?p= e ?q=. Uma etiqueta colada
   * numa ferramenta vai durar anos — o sistema é que se adapta a
   * ela, não o contrário.
   *
   * Se não houver PDF, cai na ficha em tela. Melhor que uma
   * mensagem de erro na frente de quem está no campo.
   */
  var codigoFicha = params.f || params.ficha || params.pat ||
    params.q || params.patrimonio || '';

  /* ?p= é usado pelo módulo 3D; só vale como ficha se não for "3d" */
  if (!codigoFicha && params.p && params.p !== '3d') codigoFicha = params.p;

  if (codigoFicha) {
    return AP_ENTRADA_abrirFicha_(codigoFicha);
  }

  var boot = AP_ENTRADA_boot_();

  /* Correção de cadastro: no máximo UMA VEZ POR DIA.
     Na versão anterior ela rodava a cada abertura, lendo e gravando
     na planilha toda vez — era isso que deixava a entrada lenta. */
  try { AP_ENTRADA_corrigirCadastroSeNecessario_(); } catch (erroCorrecao) { }
  var registro = AP_ENTRADA_registrarModulos_();
  var html = AP_ENTRADA_htmlOficial_();

  if (params.modo === 'diagnostico') {
    return ContentService
      .createTextOutput(JSON.stringify(AP_ENTRADA_diagnostico_(boot, registro, html), null, 2))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (params.modo === 'modulos') {
    return ContentService
      .createTextOutput(JSON.stringify(registro, null, 2))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (boot.encontrado && !boot.ok) {
    return AP_ENTRADA_telaErro_({
      titulo: 'Erro de inicialização do Core',
      funcao: boot.via,
      arquivo: 'Core Master',
      linha: boot.linha,
      erro: boot.erro,
      dependencia: 'AP_Core_boot',
      sugestao: 'Rode a função de boot direto no editor para ver a falha completa. ' +
        'O ALMOXA PRO não foi aberto para não mascarar o problema.'
    });
  }

  if (!html) {
    var disp = AP_ENTRADA_htmlDisponiveis_();
    return AP_ENTRADA_telaErro_({
      titulo: 'Frontend não encontrado',
      funcao: 'AP_ENTRADA_servir',
      arquivo: 'ALMOXA_PRO_Entrada.gs',
      erro: 'Nenhum dos arquivos HTML esperados existe no projeto.',
      dependencia: 'Arquivo HTML: ' + AP_ENTRADA.htmlCandidatos.join(', '),
      sugestao: 'Adicione o arquivo ALMOXA_PRO_DESKTOP (o Apps Script acrescenta o .html sozinho). ' +
        'Procurados e não encontrados: ' + disp.ausentes.join(', ')
    });
  }

  try {
    return HtmlService.createHtmlOutputFromFile(html)
      .setTitle(AP_ENTRADA.titulo)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err) {
    return AP_ENTRADA_telaErro_({
      titulo: 'Falha ao carregar o frontend',
      funcao: 'HtmlService.createHtmlOutputFromFile',
      arquivo: html,
      erro: err.message,
      dependencia: 'HtmlService',
      sugestao: 'Confira se o arquivo ' + html + ' está íntegro no projeto.'
    });
  }
}

/**
 * Roda a correção de cadastro só quando vale a pena.
 * Guarda a data da última execução na CONFIG do Core.
 */
function AP_ENTRADA_corrigirCadastroSeNecessario_() {
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  if (typeof g.AP_Modulo_usuarios !== 'function') return;

  var hoje = new Date().toISOString().slice(0, 10);
  var ultima = null;
  try { ultima = AP_Config_get('ULTIMA_CORRECAO_CADASTRO', null); } catch (e) { ultima = null; }
  if (String(ultima) === hoje) return;          // já rodou hoje

  var r = g.AP_Modulo_usuarios('corrigirCadastro', {}, { usuario: 'boot' });
  try { AP_Config_set('ULTIMA_CORRECAO_CADASTRO', hoje); } catch (e) { }
  return r;
}

/** Tela de erro padronizada — nunca fica em branco (item 12 da auditoria) */
function AP_ENTRADA_telaErro_(d) {
  function esc(t) {
    return String(t === undefined || t === null ? '—' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  return HtmlService.createHtmlOutput(
    '<html><head><meta charset="utf-8"><title>ALMOXA PRO</title></head>' +
    '<body style="font-family:Arial,Helvetica,sans-serif;margin:0;padding:36px;color:#16213D;background:#F5F7FA">' +
    '<div style="max-width:760px;margin:0 auto;background:#fff;border:1px solid #E3E8EF;border-radius:12px;padding:28px">' +
    '<div style="font-size:19px;font-weight:800;letter-spacing:.5px;color:#0B2A55;margin-bottom:4px">' +
    'ALMOXA <span style="color:#FF7A00">PRO</span></div>' +
    '<h2 style="color:#DC2626;font-size:18px;margin:14px 0 18px">' + esc(d.titulo) + '</h2>' +
    '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
    ['Função:' + d.funcao, 'Arquivo:' + d.arquivo, 'Linha:' + (d.linha || '—'),
     'Erro:' + d.erro, 'Dependência:' + d.dependencia].map(function (l) {
      var p = l.split(':');
      return '<tr><td style="padding:7px 0;color:#5F6B7A;width:130px;vertical-align:top">' + p[0] + ':</td>' +
        '<td style="padding:7px 0;font-weight:600">' + esc(l.slice(p[0].length + 1)) + '</td></tr>';
    }).join('') + '</table>' +
    '<div style="margin-top:18px;padding:12px 14px;background:#EAF1FE;border:1px solid #C7DBFB;border-radius:8px;font-size:13px">' +
    '<b>Sugestão</b><br>' + esc(d.sugestao) + '</div>' +
    '<p style="margin-top:18px;font-size:12px;color:#93A0B0">' +
    'Diagnóstico completo em <code>?modo=diagnostico</code> · Entrada v' + AP_ENTRADA.versao + '</p>' +
    '</div></body></html>'
  );
}

/* ------------------------------------------------------------
   5. DIAGNÓSTICO
   ------------------------------------------------------------ */
function AP_ENTRADA_diagnostico_(boot, registro, html) {
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;

  var planilha;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    planilha = ss ? 'ONLINE: ' + ss.getName() : 'SEM PLANILHA VINCULADA';
  } catch (e) {
    planilha = 'ERRO: ' + e.message;
  }

  var cache;
  try { CacheService.getScriptCache().put('_ap_ping', '1', 30); cache = 'ONLINE'; }
  catch (e) { cache = 'ERRO: ' + e.message; }

  var htmls = AP_ENTRADA_htmlDisponiveis_();

  return {
    ok: true,
    sistema: 'ALMOXA PRO',
    entrada: AP_ENTRADA.versao,
    quando: new Date().toISOString(),
    pontoDeEntrada: AP_ENTRADA_inspecionarDoGet_(),
    core_status: boot.encontrado ? (boot.ok ? 'ONLINE' : 'ERRO') : 'NAO_ENCONTRADO',
    core_via: boot.via,
    core_erro: boot.erro || null,
    spreadsheet: planilha,
    cache: cache,
    html_oficial: html,
    html_encontrados: htmls.achados,
    html_nao_encontrados: htmls.ausentes,
    modulos_registrados: registro.quantidade,
    modulos: registro.registrados.map(function (r) { return r.modulo; }),
    modulos_ausentes: registro.ausentes,
    funcao_de_registro: registro.funcaoDeRegistro,
    api: typeof g.almoxaApi === 'function' ? 'almoxaApi ONLINE' : 'almoxaApi AUSENTE',
    ponte: typeof g.AP_BRIDGE_CONFIG === 'object' ? AP_BRIDGE_CONFIG.versao : 'ponte não instalada',
    permissao: typeof g.AP_Perm_check === 'function' ? 'AP_Perm_check ONLINE' : 'AUSENTE'
  };
}

/**
 * Inspeciona o doGet ativo: qual é e de onde parece vir.
 * É assim que se detecta conflito de ponto de entrada.
 */
function AP_ENTRADA_inspecionarDoGet_() {
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  if (typeof g.doGet !== 'function') {
    return {
      existe: false,
      alerta: 'Nenhum doGet no projeto. O Web App não abre. ' +
        'Crie: function doGet(e) { return AP_ENTRADA_servir(e); }'
    };
  }
  /* lê o código INTEIRO para analisar; só o trecho exibido é truncado */
  var fonte = '';
  try { fonte = String(g.doGet.toString()); } catch (e) { fonte = '(não foi possível ler)'; }

  var chamaEntrada = /AP_ENTRADA_servir/.test(fonte);
  var chamaIndex = /createTemplateFromFile\s*\(\s*['"]Index/.test(fonte) ||
    /createHtmlOutputFromFile\s*\(\s*['"]Index/.test(fonte);

  return {
    existe: true,
    chamaEntradaUnica: chamaEntrada,
    pareceDoCoreAntigo: chamaIndex,
    fonte: fonte.slice(0, 400),
    alerta: chamaEntrada ? null
      : (chamaIndex
        ? 'O doGet ativo abre "Index" diretamente. Troque o corpo por: return AP_ENTRADA_servir(e);'
        : 'O doGet ativo não chama AP_ENTRADA_servir. Verifique se há mais de um doGet no projeto.')
  };
}

/** Rode no editor para ver tudo sem abrir o navegador */
function AP_ENTRADA_testar() {
  var boot = AP_ENTRADA_boot_();
  var reg = AP_ENTRADA_registrarModulos_();
  var d = AP_ENTRADA_diagnostico_(boot, reg, AP_ENTRADA_htmlOficial_());
  Logger.log(JSON.stringify(d, null, 2));
  return d;
}


/* ============================================================
   LOCALIZADOR DO doGet ATIVO
   Rode esta função no editor do Apps Script. Ela mostra o código
   do doGet que está valendo agora e diz o que fazer.
   ============================================================ */
function AP_ONDE_ESTA_O_DOGET() {
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  var linhas = [];

  linhas.push('===== LOCALIZADOR DO doGet ATIVO =====');

  if (typeof g.doGet !== 'function') {
    linhas.push('RESULTADO: nenhum doGet existe no projeto.');
    linhas.push('O Web App não abre. Crie um arquivo com:');
    linhas.push('  function doGet(e) { return AP_ENTRADA_servir(e); }');
    Logger.log(linhas.join('\n'));
    return linhas.join('\n');
  }

  var fonte = '';
  try { fonte = String(g.doGet.toString()); } catch (e) { fonte = '(não foi possível ler o código)'; }

  linhas.push('');
  linhas.push('--- CÓDIGO DO doGet QUE ESTÁ VALENDO ---');
  linhas.push(fonte.slice(0, 1200));
  linhas.push('--- FIM DO CÓDIGO ---');
  linhas.push('');

  var chamaEntrada = /AP_ENTRADA_servir/.test(fonte);
  var devolveJson = /ContentService/.test(fonte);
  var abreIndex = /['"]Index['"]/.test(fonte);

  if (chamaEntrada) {
    linhas.push('RESULTADO: correto. O doGet ativo chama AP_ENTRADA_servir.');
    linhas.push('Se o navegador ainda mostra o conteúdo antigo, o problema é a IMPLANTAÇÃO:');
    linhas.push('  Implantar > Gerenciar implantações > lápis > Versão: Nova versão > Implantar.');
  } else if (devolveJson) {
    linhas.push('RESULTADO: o doGet ativo devolve JSON (ContentService), por isso a tela');
    linhas.push('mostra texto em vez do sistema. Ele NÃO é o da Entrada Única.');
    linhas.push('');
    linhas.push('COMO CORRIGIR:');
    linhas.push('1. Procure no projeto o arquivo que contém o código acima.');
    linhas.push('2. Renomeie a função dele: function doGet(e)  ->  function AP_Core_doGet_diagnostico(e)');
    linhas.push('3. Garanta que exista UM único doGet no projeto, com este corpo:');
    linhas.push('     function doGet(e) { return AP_ENTRADA_servir(e); }');
    linhas.push('4. Publique NOVA VERSÃO da implantação.');
  } else if (abreIndex) {
    linhas.push('RESULTADO: o doGet ativo abre o arquivo "Index" diretamente.');
    linhas.push('Troque o corpo dele por: return AP_ENTRADA_servir(e);');
  } else {
    linhas.push('RESULTADO: existe um doGet, mas ele não chama a Entrada Única.');
    linhas.push('Localize o arquivo com o código acima e aponte-o para AP_ENTRADA_servir(e).');
  }

  linhas.push('');
  linhas.push('--- CONFERÊNCIA RÁPIDA ---');
  linhas.push('Entrada instalada: ' + (typeof g.AP_ENTRADA_servir === 'function' ? 'SIM' : 'NÃO'));
  linhas.push('Ponte instalada: ' + (typeof g.almoxaApi === 'function' ? 'SIM' : 'NÃO'));
  var mods = [];
  try {
    Object.keys(g).forEach(function (k) {
      if (/^AP_Modulo_/.test(k) && typeof g[k] === 'function') mods.push(k.replace('AP_Modulo_', ''));
    });
  } catch (e) { }
  linhas.push('Módulos presentes (' + mods.length + '): ' + (mods.join(', ') || 'nenhum'));
  linhas.push('HTML encontrado: ' + (AP_ENTRADA_htmlOficial_() || 'NENHUM'));

  Logger.log(linhas.join('\n'));
  return linhas.join('\n');
}


/* ============================================================
   PÁGINA EXTERNA DE APROVAÇÃO
   ------------------------------------------------------------
   Quem recebe o link pelo WhatsApp abre esta página. Ela é
   independente do sistema: não pede senha, não carrega o app.
   
   A decisão é validada e gravada pelo Core — a página só
   transporta a intenção.
   ============================================================ */

function AP_ENTRADA_paginaAprovacao_(token, params) {
  var r;
  try {
    r = AP_DOC_abrirLink(token);
  } catch (e) {
    r = { ok: false, mensagem: 'Não foi possível abrir este link: ' + e.message };
  }

  var html = AP_ENTRADA_htmlAprovacao_(token, r);

  return HtmlService.createHtmlOutput(html)
    .setTitle('Aprovação — ALMOXA PRO')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function AP_ENTRADA_htmlAprovacao_(token, r) {
  function esc(t) {
    return String(t === null || t === undefined ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function moeda(v) {
    var n = Number(v) || 0;
    return 'R$ ' + n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  var estilo = '<style>' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
    'background:#F4F7FB;color:#1A2634;padding:0 0 40px;line-height:1.5}' +
    '.topo{background:#0B2A55;color:#fff;padding:18px 20px}' +
    '.logo{font-size:19px;font-weight:800;letter-spacing:-.4px}' +
    '.logo b{color:#FF7A00}' +
    '.logo small{display:block;font-size:11px;font-weight:400;opacity:.75;margin-top:2px}' +
    '.env{max-width:640px;margin:0 auto;padding:18px 16px}' +
    '.cartao{background:#fff;border:1px solid #E3E9F0;border-radius:14px;padding:18px;margin-bottom:14px}' +
    'h1{font-size:19px;color:#0B2A55;margin-bottom:4px}' +
    '.sub{font-size:13px;color:#6B7684;margin-bottom:16px}' +
    '.linha{display:flex;justify-content:space-between;padding:9px 0;' +
    'border-bottom:1px solid #F0F4F8;font-size:14px;gap:12px}' +
    '.linha:last-child{border:0}' +
    '.linha span{color:#6B7684}' +
    '.linha b{text-align:right}' +
    'table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}' +
    'th{text-align:left;color:#6B7684;font-size:11px;text-transform:uppercase;' +
    'padding:6px 4px;border-bottom:1px solid #E3E9F0}' +
    'td{padding:9px 4px;border-bottom:1px solid #F0F4F8}' +
    '.num{text-align:right}' +
    '.total{background:#F4F7FB;border-radius:10px;padding:14px;margin-top:12px;' +
    'display:flex;justify-content:space-between;align-items:center}' +
    '.total b{font-size:20px;color:#0B2A55}' +
    '.btn{display:block;width:100%;padding:15px;border-radius:12px;border:0;' +
    'font-size:16px;font-weight:700;cursor:pointer;margin-bottom:10px;font-family:inherit}' +
    '.btn-ok{background:#1E9E5A;color:#fff}' +
    '.btn-nao{background:#fff;color:#C0392B;border:2px solid #C0392B}' +
    '.btn-doc{background:#0B2A55;color:#fff}' +
    '.btn:disabled{opacity:.55}' +
    '.aviso{border-radius:12px;padding:15px;margin-bottom:14px;font-size:14px}' +
    '.aviso.ok{background:#E9F7EF;color:#14603A;border-left:4px solid #1E9E5A}' +
    '.aviso.nao{background:#FDEDEC;color:#8B2A22;border-left:4px solid #C0392B}' +
    '.aviso.at{background:#FEF6E7;color:#8A5A00;border-left:4px solid #FF9F1C}' +
    '.aviso b{display:block;margin-bottom:3px;font-size:15px}' +
    'textarea{width:100%;border:1px solid #D8E0E9;border-radius:10px;padding:12px;' +
    'font-family:inherit;font-size:15px;min-height:90px;resize:vertical}' +
    '.rodape{text-align:center;font-size:11px;color:#9AA5B1;margin-top:20px;padding:0 16px}' +
    '.oculto{display:none}' +
    '.carregando{text-align:center;padding:30px;color:#6B7684}' +
    '</style>';

  var topo = '<div class="topo"><div class="env" style="padding:0">' +
    '<div class="logo">ALMOXA <b>PRO</b><small>Aprovação de solicitação</small></div>' +
    '</div></div>';

  /* --- link inválido ou expirado --- */
  if (!r.ok) {
    return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">' + estilo +
      '</head><body>' + topo + '<div class="env"><div class="cartao">' +
      '<div class="aviso nao"><b>Não foi possível abrir</b>' + esc(r.mensagem) + '</div>' +
      '<p class="sub">Se você recebeu este link e ele não funciona, ' +
      'peça um novo a quem enviou.</p>' +
      '</div></div></body></html>';
  }

  var d = r.dados;

  /* --- já decidido --- */
  if (d.situacao === 'JA_DECIDIDO') {
    var classe = d.decisao === 'APROVADA' ? 'ok' : 'nao';
    return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">' + estilo +
      '</head><body>' + topo + '<div class="env"><div class="cartao">' +
      '<div class="aviso ' + classe + '"><b>' +
      (d.decisao === 'APROVADA' ? 'Já aprovada' : 'Já reprovada') + '</b>' +
      esc(d.mensagem) + '</div>' +
      '<div class="linha"><span>Solicitação</span><b>' + esc(d.registro) + '</b></div>' +
      '<div class="linha"><span>Decidido por</span><b>' + esc(d.decididoPor || '—') + '</b></div>' +
      (d.motivo ? '<div class="linha"><span>Motivo</span><b>' + esc(d.motivo) + '</b></div>' : '') +
      '</div><div class="rodape">Esta decisão já foi registrada. ' +
      'Não é possível decidir de novo pelo mesmo link.</div></div></body></html>';
  }

  /* --- pendente: mostra e deixa decidir --- */
  var s = d.solicitacao || {};
  var itens = s.itens || [];
  var total = itens.reduce(function (acc, i) {
    return acc + (Number(i.qtd) || 0) * (Number(i.preco) || 0);
  }, 0);

  return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">' + estilo +
    '</head><body>' + topo +
    '<div class="env" id="tela">' +

    '<div class="cartao">' +
    '<h1>Solicitação ' + esc(d.registro) + '</h1>' +
    '<p class="sub">Confira os dados e decida abaixo</p>' +
    (s.solicitante ? '<div class="linha"><span>Solicitante</span><b>' + esc(s.solicitante) + '</b></div>' : '') +
    (s.obra ? '<div class="linha"><span>Obra</span><b>' + esc(s.obra) + '</b></div>' : '') +
    (s.criadoEm ? '<div class="linha"><span>Aberta em</span><b>' + esc(s.criadoEm) + '</b></div>' : '') +
    '<div class="linha"><span>Link válido até</span><b>' + esc(d.expiraEm) + '</b></div>' +
    '</div>' +

    (itens.length
      ? '<div class="cartao"><h1 style="font-size:16px">Itens (' + itens.length + ')</h1>' +
        '<table><thead><tr><th>Item</th><th class="num">Qtd</th><th class="num">Total</th></tr></thead><tbody>' +
        itens.map(function (i) {
          var q = Number(i.qtd) || 0, pr = Number(i.preco) || 0;
          return '<tr><td>' + esc(i.nome || i.descricao) + '</td>' +
            '<td class="num">' + q + '</td>' +
            '<td class="num">' + moeda(q * pr) + '</td></tr>';
        }).join('') +
        '</tbody></table>' +
        '<div class="total"><span>Valor estimado</span><b>' + moeda(total) + '</b></div>' +
        '</div>'
      : '') +

    (d.documento
      ? '<div class="cartao">' +
        '<button class="btn btn-doc" onclick="window.open(\'' +
        esc(d.documento.url) + '\',\'_blank\')">Ver documento em PDF</button>' +
        '<p class="sub" style="margin:0;text-align:center">' +
        esc(d.documento.arquivo) + '</p></div>'
      : '') +

    '<div class="cartao" id="acoes">' +
    '<button class="btn btn-ok" id="btnAprovar">Aprovar solicitação</button>' +
    '<button class="btn btn-nao" id="btnReprovar">Reprovar</button>' +
    '</div>' +

    '<div class="cartao oculto" id="caixaMotivo">' +
    '<h1 style="font-size:16px">Motivo da reprovação</h1>' +
    '<p class="sub">Escreva o que precisa ser corrigido — é o que o solicitante vai ler.</p>' +
    '<textarea id="motivo" placeholder="Ex.: quantidade acima do necessário para esta etapa"></textarea>' +
    '<button class="btn btn-nao" style="margin-top:12px" id="btnConfirmarReprovar">Confirmar reprovação</button>' +
    '<button class="btn" style="background:#F0F4F8;color:#6B7684" id="btnVoltar">Voltar</button>' +
    '</div>' +

    '<div id="resultado"></div>' +
    '<div class="rodape">ALMOXA PRO · a decisão é registrada no sistema com data e hora</div>' +
    '</div>' +

    '<script>' +
    'var TOKEN=' + JSON.stringify(token) + ';' +

    'function decidir(decisao, motivo){' +
    '  var acoes=document.getElementById("acoes");' +
    '  var caixa=document.getElementById("caixaMotivo");' +
    '  acoes.classList.add("oculto"); caixa.classList.add("oculto");' +
    '  document.getElementById("resultado").innerHTML=' +
    '    \'<div class="cartao carregando">Registrando a decisão…</div>\';' +

    '  google.script.run' +
    '    .withSuccessHandler(function(res){' +
    '      var r=document.getElementById("resultado");' +
    '      if(res && res.ok){' +
    '        r.innerHTML=\'<div class="cartao"><div class="aviso \'+' +
    '          (decisao==="APROVADA"?"ok":"nao")+\'"><b>\'+' +
    '          (decisao==="APROVADA"?"Solicitação aprovada":"Solicitação reprovada")+' +
    '          \'</b>Registrado em \'+res.dados.decidiuEm+\'. \'+' +
    '          \'O solicitante foi avisado.</div></div>\';' +
    '      } else {' +
    '        r.innerHTML=\'<div class="cartao"><div class="aviso nao"><b>Não foi registrado</b>\'+' +
    '          ((res&&res.mensagem)||"Tente de novo.")+\'</div></div>\';' +
    '        acoes.classList.remove("oculto");' +
    '      }' +
    '    })' +
    '    .withFailureHandler(function(err){' +
    '      document.getElementById("resultado").innerHTML=' +
    '        \'<div class="cartao"><div class="aviso nao"><b>Falha de conexão</b>\'+' +
    '        (err.message||"")+\' Nada foi alterado.</div></div>\';' +
    '      acoes.classList.remove("oculto");' +
    '    })' +
    '    .AP_ENTRADA_decidirLink(TOKEN, decisao, motivo||"");' +
    '}' +

    'document.getElementById("btnAprovar").onclick=function(){' +
    '  if(confirm("Confirma a aprovação desta solicitação?")) decidir("APROVADA","");' +
    '};' +
    'document.getElementById("btnReprovar").onclick=function(){' +
    '  document.getElementById("acoes").classList.add("oculto");' +
    '  document.getElementById("caixaMotivo").classList.remove("oculto");' +
    '};' +
    'document.getElementById("btnVoltar").onclick=function(){' +
    '  document.getElementById("caixaMotivo").classList.add("oculto");' +
    '  document.getElementById("acoes").classList.remove("oculto");' +
    '};' +
    'document.getElementById("btnConfirmarReprovar").onclick=function(){' +
    '  var m=document.getElementById("motivo").value.trim();' +
    '  if(!m){ alert("Escreva o motivo da reprovação."); return; }' +
    '  decidir("REPROVADA", m);' +
    '};' +
    '</script></body></html>';
}

/** Chamada pela página externa. A validação acontece no Core. */
function AP_ENTRADA_decidirLink(token, decisao, motivo) {
  try {
    return AP_DOC_decidir(token, decisao, { motivo: motivo, quem: 'aprovador externo' });
  } catch (e) {
    return { ok: false, mensagem: e.message };
  }
}


/* ============================================================
   MÓDULO 3D
   ------------------------------------------------------------
   Servido só quando pedido. O sistema principal continua leve.
   ============================================================ */

function AP_ENTRADA_servirModulo3D_(params) {
  params = params || {};

  /**
   * Nomes aceitos.
   *
   * O Apps Script acrescenta ".html" sozinho: quem digita
   * "ALMOXA_3D.html" acaba com "ALMOXA_3D.html.html". É um erro
   * fácil de cometer e chato de descobrir.
   */
  var nomes = [
    'ALMOXA_3D', 'ALMOXA_3D.html', 'ALMOXA_3D.html.html',
    'ALMOXA3D', 'ALMOXA3D.html',
    'almoxa_3d', 'ALMOXA_PRO_3D', 'MAPA_3D', 'mapa3d'
  ];

  var conteudo = null;
  var achado = '';

  for (var i = 0; i < nomes.length; i++) {
    try {
      conteudo = HtmlService.createHtmlOutputFromFile(nomes[i]).getContent();
      achado = nomes[i];
      break;
    } catch (e) { /* tenta o próximo */ }
  }

  if (!conteudo) return AP_ENTRADA_ajuda3D_();

  /**
   * O MÓDULO NASCE CONECTADO.
   *
   * Em vez de pedir ao usuário que cole o endereço do sistema, o
   * próprio sistema o entrega aqui. O módulo abre já lendo o
   * almoxarifado de verdade — sem demonstração, sem configuração.
   */
  var endereco = '';
  try { endereco = ScriptApp.getService().getUrl(); } catch (e) { endereco = ''; }

  var config = {
    urlCore: endereco,
    sessao: params.s || '',
    ligadoPeloSistema: true,
    versao: AP_Config_get('SYSTEM_VERSION', '')
  };

  var injecao = '<script>window.AP3D_CONFIG=' + JSON.stringify(config) + ';</script>';

  /* entra logo no início, antes de qualquer script do módulo */
  var comConfig = conteudo.indexOf('<head>') > -1
    ? conteudo.replace('<head>', '<head>' + injecao)
    : injecao + conteudo;

  return HtmlService.createHtmlOutput(comConfig)
    .setTitle('ALMOXA PRO · Estoque 3D')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Página de ajuda quando o arquivo do módulo não está no projeto */
function AP_ENTRADA_ajuda3D_() {
  return HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<style>' +
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
    'background:#F4F7FB;color:#1A2634;padding:0;margin:0}' +
    '.topo{background:#0B2A55;color:#fff;padding:16px 20px;font-size:17px;font-weight:700}' +
    '.topo i{color:#FF7A00;font-style:normal}' +
    '.env{max-width:560px;margin:0 auto;padding:22px 18px}' +
    '.cartao{background:#fff;border:1px solid #E3E9F0;border-radius:14px;padding:20px}' +
    '.aviso{background:#FEF6E7;border-left:4px solid #FF9F1C;border-radius:9px;' +
    'padding:14px;margin-bottom:16px}' +
    'ol{padding-left:20px;line-height:2;font-size:14px;color:#4A5866}' +
    'b{color:#0B2A55}' +
    '</style></head><body>' +
    '<div class="topo">ALMOXA <i>PRO</i> · Estoque 3D</div>' +
    '<div class="env"><div class="cartao">' +
    '<div class="aviso"><b>O arquivo do módulo 3D não está neste projeto</b><br>' +
    'Ele precisa ser criado como HTML dentro do Apps Script.</div>' +
    '<b>Como instalar</b>' +
    '<ol>' +
    '<li>No editor, clique no <b>+</b> ao lado de "Arquivos"</li>' +
    '<li>Escolha <b>HTML</b> — não Script</li>' +
    '<li>Nome: <b>ALMOXA_3D</b> — <u>sem</u> escrever .html</li>' +
    '<li>Apague o conteúdo que vem e cole todo o ALMOXA_3D.html</li>' +
    '<li><b>Implantar → Nova versão</b></li>' +
    '</ol>' +
    '<p style="font-size:13px;color:#8A96A3;margin-top:14px">' +
    'Se você escrever ".html" no nome, o arquivo vira "ALMOXA_3D.html.html" — ' +
    'o sistema aceita isso também, mas é melhor deixar só ALMOXA_3D.</p>' +
    '</div></div></body></html>')
    .setTitle('Módulo 3D não instalado')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}



/* ============================================================
   PÁGINA DA ETIQUETA DE PATRIMÔNIO
   ============================================================ */

function AP_ENTRADA_paginaPatrimonio_(token) {
  var r;
  try {
    r = AP_Modulo_patrimonio('porToken', { token: token }, null);
  } catch (e) {
    r = { ok: false, mensagem: 'Não foi possível abrir: ' + e.message };
  }

  return HtmlService.createHtmlOutput(AP_ENTRADA_htmlPatrimonio_(r))
    .setTitle('Patrimônio · ALMOXA PRO')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function AP_ENTRADA_htmlPatrimonio_(r) {
  function esc(t) {
    return String(t === null || t === undefined ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function moeda(v) {
    var n = Number(v) || 0;
    return 'R$ ' + n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  function data(d) {
    if (!d) return '—';
    try {
      var x = new Date(d);
      if (isNaN(x.getTime())) return String(d).slice(0, 10);
      return ('0' + x.getDate()).slice(-2) + '/' +
        ('0' + (x.getMonth() + 1)).slice(-2) + '/' + x.getFullYear();
    } catch (e) { return String(d); }
  }

  var EMPRESA = AP_Config_get('EMPRESA_NOME', 'COESA');
  var DESDE = AP_Config_get('EMPRESA_DESDE', 'Desde 1954');

  var estilo = '<style>' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;' +
    'background:#F4F7FB;color:#1A2634;line-height:1.5;padding-bottom:60px}' +

    /* faixa da empresa, no padrão do material impresso */
    '.faixa{background:#0B2A55;color:#fff;padding:12px 0;position:sticky;top:0;z-index:10}' +
    '.faixa-env{max-width:680px;margin:0 auto;padding:0 16px;display:flex;' +
    'align-items:center;gap:12px}' +
    '.fx-marca{display:flex;align-items:center;gap:8px;flex-shrink:0}' +
    '.fx-c{width:30px;height:30px;border-radius:50%;background:#fff;color:#0B5FFF;' +
    'font-family:Georgia,serif;font-size:19px;font-weight:900;display:grid;' +
    'place-items:center;line-height:1;flex-shrink:0}' +
    '.fx-nome{font-size:15px;font-weight:800;letter-spacing:.08em;line-height:1.1}' +
    '.fx-nome small{display:block;font-size:8.5px;font-weight:400;opacity:.65;' +
    'letter-spacing:.02em}' +
    '.fx-div{width:1px;height:26px;background:rgba(255,255,255,.25);flex-shrink:0}' +
    '.fx-sistema{font-size:12.5px;font-weight:700;letter-spacing:.04em;line-height:1.15;' +
    'flex:1;min-width:0}' +
    '.fx-sistema b{color:#FF7A00}' +
    '.fx-sistema small{display:block;font-size:8.5px;font-weight:400;opacity:.6}' +
    '.fx-acoes{display:flex;gap:6px;flex-shrink:0}' +
    '.tb{background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.2);' +
    'color:#fff;border-radius:8px;padding:7px 12px;font-size:12px;font-family:inherit;' +
    'cursor:pointer;font-weight:600;white-space:nowrap}' +
    '.tb:hover{background:rgba(255,255,255,.24)}' +
    '.tb.principal{background:#FF7A00;border-color:#FF7A00}' +

    /* título da ficha */
    '.titulo-ficha{background:#123A6E;color:#fff;border-radius:12px;padding:14px 16px;' +
    'margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:12px}' +
    '.tf-txt h2{font-size:15px;font-weight:800;letter-spacing:.02em;line-height:1.2}' +
    '.tf-txt small{font-size:10.5px;opacity:.7}' +
    '.tf-pat{text-align:right;flex-shrink:0}' +
    '.tf-pat small{display:block;font-size:9px;opacity:.7;letter-spacing:.08em}' +
    '.tf-pat b{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:17px;' +
    'letter-spacing:.04em}' +

    /* indicadores */
    '.indicadores{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px}' +
    '.ind{background:#F7F9FC;border:1px solid #E3E9F0;border-radius:10px;padding:10px 6px;' +
    'text-align:center}' +
    '.ind b{display:block;font-size:19px;line-height:1.1;font-weight:800}' +
    '.ind span{font-size:9.5px;color:#8A96A3;display:block;margin-top:2px}' +
    '.ind.saidas b{color:#0B5FFF}.ind.devol b{color:#1E9E5A}' +
    '.ind.manut b{color:#FF9F1C}.ind.ocor b{color:#C0392B}' +

    /* última movimentação */
    '.ultima{background:#F7F9FC;border:1px solid #E3E9F0;border-radius:10px;' +
    'padding:12px 14px;margin-top:12px}' +
    '.ult-topo{display:flex;align-items:center;gap:8px;margin-bottom:6px}' +
    '.ult-selo{font-size:10px;font-weight:700;padding:2px 8px;border-radius:9px;color:#fff}' +
    '.ult-data{font-size:12.5px;color:#4A5866;font-weight:600}' +
    '.ult-det{font-size:12px;color:#6B7684}' +

    '.env{max-width:680px;margin:0 auto;padding:14px}' +
    '.cartao{background:#fff;border:1px solid #E3E9F0;border-radius:14px;' +
    'padding:16px;margin-bottom:12px}' +

    '.cabeca{display:flex;gap:14px;align-items:flex-start}' +
    /**
     * A FOTO TEM ÁREA PRÓPRIA
     *
     * object-fit: contain, não cover. Com cover a imagem enche o
     * quadrado cortando as bordas — e numa foto de ferramenta o
     * que sobra é o meio do cabo. Com contain a peça aparece
     * inteira, e o fundo claro completa o espaço.
     */
    '.foto{width:104px;height:104px;border-radius:12px;background:#F7F9FC;' +
    'display:flex;align-items:center;justify-content:center;font-size:38px;' +
    'flex-shrink:0;overflow:hidden;border:1px solid #E3E9F0;padding:6px}' +
    '.foto img{max-width:100%;max-height:100%;width:auto;height:auto;' +
    'object-fit:contain;display:block}' +
    '.foto-grande{width:100%;max-width:300px;height:210px;margin:0 auto 14px;' +
    'border-radius:12px;background:#F7F9FC;border:1px solid #E3E9F0;padding:10px;' +
    'display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:zoom-in}' +
    '.foto-grande img{max-width:100%;max-height:100%;width:auto;height:auto;' +
    'object-fit:contain;display:block}' +
    'h1{font-size:20px;color:#0B2A55;line-height:1.25;word-break:break-word}' +
    '.pat{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:15px;' +
    'color:#FF7A00;font-weight:800;margin:3px 0 8px;letter-spacing:.5px}' +
    '.cod-ficha{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10.5px;' +
    'color:#9AA5B1;margin-top:7px;letter-spacing:.4px}' +

    '.destaque{background:#F7F9FC;border:1px solid #E3E9F0;border-radius:11px;' +
    'padding:13px 15px;margin-bottom:10px}' +
    '.d-valor{font-size:22px;font-weight:800;color:#0B2A55;line-height:1.1}' +
    '.d-linha{display:flex;gap:16px;flex-wrap:wrap;margin-top:7px;font-size:13px;' +
    'color:#4A5866}' +
    '.d-linha b{color:#8A96A3;font-weight:600;font-size:11px;text-transform:uppercase;' +
    'letter-spacing:.4px}' +
    '.d-forn{font-size:12.5px;color:#6B7684;margin-top:5px}' +

    '.selo{display:inline-block;padding:4px 12px;border-radius:14px;' +
    'font-size:11.5px;font-weight:700;color:#fff;letter-spacing:.3px}' +
    '.s-ativo{background:#1E9E5A}.s-manut{background:#FF9F1C}' +
    '.s-baixado{background:#8E969F}.s-emprestado{background:#0B5FFF}' +
    '.s-extraviado{background:#C0392B}' +

    '.abas{display:flex;gap:6px;margin-bottom:12px;overflow-x:auto;' +
    'padding-bottom:3px;-webkit-overflow-scrolling:touch}' +
    '.abas button{padding:9px 15px;border-radius:20px;border:1px solid #E3E9F0;' +
    'background:#fff;font-family:inherit;font-size:13px;font-weight:600;' +
    'color:#4A5866;cursor:pointer;white-space:nowrap;flex-shrink:0}' +
    '.abas button.on{background:#0B2A55;color:#fff;border-color:#0B2A55}' +
    '.painel{display:none}.painel.on{display:block}' +

    '.linha{display:flex;justify-content:space-between;padding:9px 0;' +
    'border-bottom:1px solid #F0F4F8;font-size:14px;gap:14px}' +
    '.linha:last-child{border:0}' +
    '.linha span{color:#6B7684;flex-shrink:0}' +
    '.linha b{text-align:right;font-weight:600;word-break:break-word}' +

    'h3{font-size:11.5px;text-transform:uppercase;letter-spacing:.8px;' +
    'color:#8A96A3;margin-bottom:9px;font-weight:700}' +
    'h3:not(:first-child){margin-top:18px}' +

    '.item{padding:11px 0;border-bottom:1px solid #F0F4F8}' +
    '.item:last-child{border:0}' +
    '.item b{display:block;font-size:13.5px}' +
    '.item small{color:#8A96A3;font-size:11.5px;display:block}' +

    '.pessoa{display:flex;align-items:center;gap:11px;padding:10px 0;' +
    'border-bottom:1px solid #F0F4F8}' +
    '.pessoa:last-child{border:0}' +
    '.av{width:36px;height:36px;border-radius:50%;background:#0B2A55;color:#fff;' +
    'display:grid;place-items:center;font-size:13px;font-weight:700;flex-shrink:0}' +
    '.pessoa .n{flex:1;font-size:13.5px;font-weight:600}' +
    '.pessoa .v{font-size:12.5px;color:#6B7684}' +

    '.barra{height:9px;background:#E9EEF4;border-radius:5px;overflow:hidden;margin:9px 0}' +
    '.barra i{display:block;height:100%;border-radius:5px}' +
    '.rot-num{font-size:26px;font-weight:800;color:#0B2A55;line-height:1.1}' +
    '.rot-num small{font-size:14px;color:#8A96A3;font-weight:400}' +

    '.lacre{display:flex;align-items:center;gap:11px}' +
    '.bola{width:34px;height:34px;border-radius:50%;border:2px solid #fff;' +
    'box-shadow:0 0 0 1px #D8E0E9;flex-shrink:0}' +

    '.aviso{border-radius:10px;padding:12px 14px;font-size:13px;margin-bottom:12px}' +
    '.a-amarelo{background:#FEF6E7;color:#8A5A00;border-left:4px solid #FF9F1C}' +
    '.a-vermelho{background:#FDEDEC;color:#8B2A22;border-left:4px solid #C0392B}' +
    '.a-azul{background:#EAF2FF;color:#0B3D91;border-left:4px solid #0B5FFF}' +
    '.a-verde{background:#E9F7EF;color:#14603A;border-left:4px solid #1E9E5A}' +

    '.vazio{text-align:center;padding:26px;color:#8A96A3;font-size:13px}' +

    /* galeria: as fotos aparecem inteiras, nunca cortadas */
    '.galeria{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px}' +
    '.g-item{margin:0;cursor:zoom-in}' +
    '.g-item img{width:100%;height:110px;object-fit:contain;background:#F7F9FC;' +
    'border:1px solid #E3E9F0;border-radius:10px;padding:5px;display:block}' +
    '.g-item figcaption{font-size:11px;color:#6B7684;margin-top:5px;text-align:center;' +
    'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +

    '.lupa{position:fixed;inset:0;background:rgba(11,26,42,.92);z-index:100;' +
    'display:none;align-items:center;justify-content:center;flex-direction:column;' +
    'padding:20px;cursor:zoom-out}' +
    '.lupa.on{display:flex}' +
    '.lupa img{max-width:100%;max-height:78vh;object-fit:contain;border-radius:8px}' +
    '.lupa .leg{color:#fff;font-size:14px;margin-top:14px;text-align:center}' +
    '.lupa .nav{position:absolute;top:50%;transform:translateY(-50%);background:rgba(255,255,255,.15);' +
    'color:#fff;border:0;width:46px;height:46px;border-radius:50%;font-size:22px;cursor:pointer}' +
    '.lupa .nav.esq{left:14px}.lupa .nav.dir{right:14px}' +
    '.lupa .fechar{position:absolute;top:16px;right:16px;background:rgba(255,255,255,.15);' +
    'color:#fff;border:0;width:40px;height:40px;border-radius:50%;font-size:20px;cursor:pointer}' +
    '.doc-cartao{border:1px solid #E3E9F0;border-radius:11px;padding:13px 15px;' +
    'margin-bottom:10px;background:#FCFDFE}' +
    '.doc-cartao:last-child{margin-bottom:0}' +
    '.dc-topo{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}' +
    '.dc-topo b{font-size:14.5px;color:#0B2A55;display:block}' +
    '.dc-topo small{font-size:12px;color:#6B7684;display:block;margin-top:2px}' +
    '.dc-valor{font-size:15px;font-weight:800;color:#1E9E5A;white-space:nowrap}' +
    '.dc-linha{display:flex;gap:14px;flex-wrap:wrap;margin-top:8px;font-size:12px;' +
    'color:#8A96A3}' +
    '.dc-obs{font-size:12.5px;color:#4A5866;margin-top:8px}' +
    '.dc-abrir{display:inline-block;margin-top:10px;font-size:13px;color:#0B5FFF;' +
    'text-decoration:none;font-weight:600}' +

    '.doc{display:flex;align-items:center;gap:10px;padding:11px 0;' +
    'border-bottom:1px solid #F0F4F8;text-decoration:none;color:inherit}' +
    '.doc:last-child{border:0}' +
    '.doc-ico{width:34px;height:34px;border-radius:8px;background:#EAF2FF;' +
    'display:grid;place-items:center;font-size:15px;flex-shrink:0}' +

    '.rodape{text-align:center;font-size:11px;color:#9AA5B1;margin-top:16px;padding:0 16px}' +

    /* impressão: tudo numa folha, sem botões nem abas */
    '@media print{' +
    'body{background:#fff;padding:0}' +
    '.topo{position:static;background:#fff;color:#0B2A55;' +
    'border-bottom:2px solid #0B2A55;padding:10px 0}' +
    '.topo-bts,.abas{display:none}' +
    '.painel{display:block !important;page-break-inside:avoid}' +
    '.cartao{border:1px solid #ccc;box-shadow:none;margin-bottom:8px;' +
    'page-break-inside:avoid}' +
    '.env{max-width:none;padding:0}' +
    '@page{size:A4;margin:12mm}' +
    '}' +
    '</style>';

  /**
   * O CABEÇALHO
   *
   * Faixa azul com a marca à esquerda e a assinatura à direita,
   * como no material impresso da empresa. Quem abre pelo QR vê
   * de quem é a ficha antes de qualquer outra coisa.
   */
  var topo = '<div class="faixa">' +
    '<div class="faixa-env">' +
    '<div class="fx-marca">' +
    '<span class="fx-c">C</span>' +
    '<span class="fx-nome">' + esc(EMPRESA) +
    '<small>' + esc(DESDE) + '</small></span>' +
    '</div>' +
    '<div class="fx-div"></div>' +
    '<div class="fx-sistema">ALMOXA <b>PRO</b>' +
    '<small>Gestão de patrimônio</small></div>' +
    '<div class="fx-acoes">' +
    '<button class="tb" onclick="window.print()">Imprimir</button>' +
    '<button class="tb principal" onclick="window.print()">Baixar PDF</button>' +
    '</div></div></div>';

  if (!r.ok) {
    return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' + estilo +
      '</head><body>' + topo + '<div class="env"><div class="cartao">' +
      '<div class="aviso a-vermelho"><b>Etiqueta não reconhecida</b><br>' +
      esc(r.mensagem || 'Este código não corresponde a nenhum equipamento.') + '</div>' +
      '<p style="font-size:13px;color:#6B7684">Confira se a etiqueta está legível ' +
      'ou procure o almoxarifado.</p></div></div></body></html>';
  }

  var d = r.dados;
  var p = d.patrimonio;
  var c = d.calculado;
  var rot = d.rotatividade || {};

  var selos = {
    ATIVO: 's-ativo', EM_MANUTENCAO: 's-manut', BAIXADO: 's-baixado',
    EMPRESTADO: 's-emprestado', EXTRAVIADO: 's-extraviado'
  };
  var rotSituacao = {
    ATIVO: 'ATIVO', EM_MANUTENCAO: 'EM MANUTENÇÃO', BAIXADO: 'BAIXADO',
    EMPRESTADO: 'EMPRESTADO', EXTRAVIADO: 'EXTRAVIADO'
  };

  function linha(rotulo, valor) {
    if (valor === undefined || valor === null || valor === '' || valor === '—') return '';
    return '<div class="linha"><span>' + rotulo + '</span><b>' + esc(valor) + '</b></div>';
  }

  function iniciais(nome) {
    var partes = String(nome || '?').trim().split(/\s+/);
    return ((partes[0] || '?')[0] + (partes.length > 1 ? partes[partes.length-1][0] : ''))
      .toUpperCase();
  }

  var corRotatividade = rot.situacao === 'MANUTENCAO_PROGRAMADA' ? '#C0392B'
    : (rot.situacao === 'PROXIMO_LIMITE' ? '#FF9F1C' : '#1E9E5A');

  return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + esc(p.patrimonio) + ' · ' + esc(p.descricao) + '</title>' +
    estilo + '</head><body>' + topo +
    '<div class="env">' +

    (c.manutencaoVencida
      ? '<div class="aviso a-amarelo"><b>Manutenção vencida</b><br>' +
        'Estava prevista para ' + data(p.proximaManutencao) + '.</div>' : '') +

    (rot.aviso
      ? '<div class="aviso ' + (rot.situacao === 'MANUTENCAO_PROGRAMADA' ? 'a-vermelho' : 'a-amarelo') +
        '"><b>Rotatividade</b><br>' + esc(rot.aviso) + '</div>' : '') +

    (p.situacao === 'BAIXADO'
      ? '<div class="aviso a-vermelho"><b>Equipamento baixado</b><br>' +
        'Não deve estar em uso.</div>' : '') +

    (p.situacao === 'EM_MANUTENCAO'
      ? '<div class="aviso a-amarelo"><b>Em manutenção</b><br>' +
        'Não disponível para retirada.</div>' : '') +

    '<div class="titulo-ficha">' +
    '<div class="tf-txt"><h2>FICHA TÉCNICA DO PATRIMÔNIO</h2>' +
    '<small>Identificação, rastreabilidade, fotos e documentos</small></div>' +
    '<div class="tf-pat"><small>Nº PATRIMÔNIO</small>' +
    '<b>' + esc(p.patrimonio) + '</b></div>' +
    '</div>' +

    '<div class="cartao"><div class="cabeca">' +
    '<div class="foto">' + (p.foto ? '<img src="' + esc(p.foto) + '" alt="">' : '🔧') + '</div>' +
    '<div style="flex:1;min-width:0">' +
    '<h1>' + esc(p.descricao) + '</h1>' +
    '<div class="pat">' + esc(p.patrimonio) + '</div>' +
    '<span class="selo ' + (selos[p.situacao] || 's-ativo') + '">' +
    (rotSituacao[p.situacao] || p.situacao) + '</span>' +
    (p.codigoFicha
      ? '<div class="cod-ficha">' + esc(p.codigoFicha) + '</div>' : '') +
    '</div></div>' +
    linha('Marca', p.marca) + linha('Modelo', p.modelo) +
    linha('Nº de série', p.numeroSerie) + linha('Categoria', p.categoria) +

    /* os números que resumem a vida do equipamento */
    '<div class="indicadores">' +
    '<div class="ind saidas"><b>' + (rot.totalSaidas || 0) + '</b><span>Saídas</span></div>' +
    '<div class="ind devol"><b>' + (rot.totalDevolucoes || 0) + '</b><span>Devoluções</span></div>' +
    '<div class="ind manut"><b>' + (c.totalManutencoes || 0) + '</b><span>Manutenções</span></div>' +
    '<div class="ind ocor"><b>' + (d.fotos ? d.fotos.length : 0) + '</b><span>Fotos</span></div>' +
    '</div>' +

    /* a última movimentação, que é a pergunta mais comum */
    (d.movimentos && d.movimentos.length
      ? '<div class="ultima">' +
        '<div class="ult-topo">' +
        '<span class="ult-selo" style="background:' +
        (String(d.movimentos[0].tipo).indexOf('RETIRADA') > -1 ||
         String(d.movimentos[0].tipo).indexOf('SAIDA') > -1 ? '#C0392B' : '#1E9E5A') + '">' +
        esc(String(d.movimentos[0].tipo).replace(/_/g, ' ')) + '</span>' +
        '<span class="ult-data">' + data(d.movimentos[0].quando) + '</span>' +
        '</div>' +
        '<div class="ult-det">' +
        (d.movimentos[0].usuario ? 'Por ' + esc(d.movimentos[0].usuario) : '') +
        (d.movimentos[0].para ? ' · Destino: ' + esc(d.movimentos[0].para) : '') +
        '</div></div>'
      : '') +
    '</div>' +

    '<div class="abas">' +
    '<button class="on" data-aba="pInfo">Informações</button>' +
    '<button data-aba="pFotos">Fotos' +
    (d.fotos && d.fotos.length ? ' (' + d.fotos.length + ')' : '') + '</button>' +
    '<button data-aba="pNF">Notas Fiscais' +
    (d.notasFiscais && d.notasFiscais.length ? ' (' + d.notasFiscais.length + ')' : '') +
    '</button>' +
    '<button data-aba="pPed">Pedidos' +
    (d.pedidos && d.pedidos.length ? ' (' + d.pedidos.length + ')' : '') + '</button>' +
    '<button data-aba="pHist">Movimentações</button>' +
    '<button data-aba="pPessoas">Quem usou</button>' +
    '<button data-aba="pRot">Rotatividade</button>' +
    '<button data-aba="pManut">Manutenção</button>' +
    '<button data-aba="pLacre">Lacre</button>' +
    '<button data-aba="pDocs">Documentos</button>' +
    '<button data-aba="pInfos">Informações adicionais' +
    (d.infosAdicionais && d.infosAdicionais.lista.length
      ? ' (' + d.infosAdicionais.lista.length + ')' : '') + '</button>' +
    '</div>' +

    /* ---- INFORMAÇÕES ---- */
    '<div class="painel on" id="pInfo"><div class="cartao">' +
    '<h3>Onde está</h3>' +
    linha('Localização', p.localizacao) + linha('Obra', p.obra) +
    linha('Responsável', p.responsavel) +

    '<h3>Situação</h3>' +
    linha('Estado', p.estado) +
    linha('Aquisição', data(p.dataAquisicao)) +
    (c.idadeMeses !== null ? linha('Idade', c.idadeMeses + ' meses') : '') +
    (p.garantiaAte
      ? linha('Garantia', data(p.garantiaAte) + (c.naGarantia ? ' · na garantia' : ' · vencida'))
      : '') +
    (p.vidaUtilMeses ? linha('Vida útil', p.vidaUtilMeses + ' meses') : '') +
    linha('Última manutenção', data(p.ultimaManutencao)) +
    linha('Próxima manutenção', data(p.proximaManutencao)) +

    /* a aquisição fica em destaque: é o que se procura numa
       auditoria ou quando alguém pergunta de onde veio */
    (p.valorAquisicao !== undefined
      ? '<h3>Aquisição</h3>' +
        '<div class="destaque">' +
        '<div class="d-valor">' + moeda(p.valorAquisicao) + '</div>' +
        '<div class="d-linha">' +
        (p.notaFiscal ? '<span><b>NF</b> ' + esc(p.notaFiscal) + '</span>' : '') +
        (p.pedido ? '<span><b>Pedido</b> ' + esc(p.pedido) + '</span>' : '') +
        '</div>' +
        (p.fornecedor ? '<div class="d-forn">' + esc(p.fornecedor) + '</div>' : '') +
        '</div>' +
        linha('Data da compra', data(p.dataAquisicao)) +
        (c.custoManutencoes ? linha('Gasto em manutenção', moeda(c.custoManutencoes)) : '')
      : '') +

    (p.observacao ? '<h3>Observação</h3><p style="font-size:13.5px;color:#4A5866">' +
      esc(p.observacao) + '</p>' : '') +
    '</div></div>' +

    /* ---- FOTOS ---- */
    '<div class="painel" id="pFotos"><div class="cartao">' +
    '<h3>Fotos do equipamento</h3>' +
    (d.fotos && d.fotos.length
      ? '<div class="galeria">' +
        d.fotos.map(function (f, i) {
          return '<figure class="g-item" data-foto="' + i + '">' +
            '<img src="' + esc(f.imagem) + '" alt="' + esc(f.rotulo) + '" loading="lazy">' +
            '<figcaption>' + esc(f.legenda || f.rotulo) + '</figcaption>' +
            '</figure>';
        }).join('') +
        '</div>' +
        '<p class="small" style="font-size:11.5px;color:#8A96A3;margin-top:10px">' +
        'Toque numa foto para ampliar.</p>'
      : '<div class="vazio">Nenhuma foto registrada.<br>' +
        '<span style="font-size:12px">Fotos do equipamento na chegada ajudam a ' +
        'comprovar o estado e o que veio na caixa.</span></div>') +
    '</div></div>' +

    /* ---- HISTÓRICO ---- */
    '<div class="painel" id="pHist"><div class="cartao">' +
    '<h3>Movimentações (' + c.totalMovimentos + ')</h3>' +
    (d.movimentos.length
      ? d.movimentos.map(function (m) {
          return '<div class="item"><b>' + esc(m.tipo.replace(/_/g, ' ')) +
            (m.para ? ' → ' + esc(m.para) : '') + '</b>' +
            '<small>' + data(m.quando) + (m.de ? ' · de ' + esc(m.de) : '') +
            (m.usuario ? ' · ' + esc(m.usuario) : '') + '</small>' +
            (m.motivo ? '<small>' + esc(m.motivo) + '</small>' : '') + '</div>';
        }).join('')
      : '<div class="vazio">Nenhuma movimentação registrada.</div>') +
    '</div></div>' +

    /* ---- NOTAS FISCAIS ---- */
    '<div class="painel" id="pNF"><div class="cartao">' +
    '<h3>Notas fiscais</h3>' +
    (d.notasFiscais && d.notasFiscais.length
      ? d.notasFiscais.map(function (n) {
          return '<div class="doc-cartao">' +
            '<div class="dc-topo">' +
            '<div><b>NF ' + esc(n.numero) + (n.serie ? ' · série ' + esc(n.serie) : '') + '</b>' +
            (n.fornecedor ? '<small>' + esc(n.fornecedor) + '</small>' : '') + '</div>' +
            (n.valor ? '<div class="dc-valor">' + moeda(n.valor) + '</div>' : '') +
            '</div>' +
            '<div class="dc-linha">' +
            (n.emissao ? '<span>Emissão ' + data(n.emissao) + '</span>' : '') +
            (n.cnpj ? '<span>CNPJ ' + esc(n.cnpj) + '</span>' : '') +
            '</div>' +
            (n.observacao ? '<div class="dc-obs">' + esc(n.observacao) + '</div>' : '') +
            (n.documentoUrl
              ? '<a class="dc-abrir" href="' + esc(n.documentoUrl) + '" target="_blank" ' +
                'rel="noopener">Abrir a nota</a>' : '') +
            '</div>';
        }).join('')
      : '<div class="vazio">Nenhuma nota fiscal vinculada.</div>') +
    '</div></div>' +

    /* ---- PEDIDOS ---- */
    '<div class="painel" id="pPed"><div class="cartao">' +
    '<h3>Pedidos e ordens de compra</h3>' +
    (d.pedidos && d.pedidos.length
      ? d.pedidos.map(function (n) {
          return '<div class="doc-cartao">' +
            '<div class="dc-topo">' +
            '<div><b>' + esc(n.numero) + '</b>' +
            (n.fornecedor ? '<small>' + esc(n.fornecedor) + '</small>' : '') + '</div>' +
            (n.valor ? '<div class="dc-valor">' + moeda(n.valor) + '</div>' : '') +
            '</div>' +
            (n.emissao ? '<div class="dc-linha"><span>Data ' + data(n.emissao) +
              '</span></div>' : '') +
            (n.observacao ? '<div class="dc-obs">' + esc(n.observacao) + '</div>' : '') +
            (n.documentoUrl
              ? '<a class="dc-abrir" href="' + esc(n.documentoUrl) + '" target="_blank" ' +
                'rel="noopener">Abrir o pedido</a>' : '') +
            '</div>';
        }).join('')
      : '<div class="vazio">Nenhum pedido vinculado.</div>') +
    '</div></div>' +

    /* ---- INFORMAÇÕES ADICIONAIS ---- */
    '<div class="painel" id="pInfos"><div class="cartao">' +
    (d.infosAdicionais && d.infosAdicionais.grupos.length
      ? d.infosAdicionais.grupos.map(function (g) {
          return '<h3>' + esc(g.grupo) + '</h3>' +
            g.itens.map(function (i) {
              return '<div class="linha"><span>' + esc(i.rotulo) + '</span><b>' +
                esc(i.valor || '—') + '</b></div>';
            }).join('');
        }).join('')
      : '<div class="vazio">Nenhuma informação adicional.<br>' +
        '<span style="font-size:12px">Tensão, peso, acessórios que vieram na maleta — ' +
        'o que não cabe nos campos padrão.</span></div>') +
    '</div></div>' +

    /* ---- QUEM USOU ---- */
    '<div class="painel" id="pPessoas"><div class="cartao">' +
    '<h3>Pessoas que já utilizaram</h3>' +
    (d.quemUsou && d.quemUsou.length
      ? d.quemUsou.map(function (q) {
          return '<div class="pessoa">' +
            '<div class="av">' + esc(iniciais(q.nome)) + '</div>' +
            '<div class="n">' + esc(q.nome) +
            '<small style="display:block;color:#8A96A3;font-weight:400;font-size:11.5px">' +
            'última vez em ' + data(q.ultima) + '</small></div>' +
            '<div class="v">' + q.vezes + ' vez' + (q.vezes > 1 ? 'es' : '') + '</div>' +
            '</div>';
        }).join('')
      : '<div class="vazio">Ninguém registrado ainda.</div>') +
    '</div></div>' +

    /* ---- ROTATIVIDADE ---- */
    '<div class="painel" id="pRot"><div class="cartao">' +
    '<h3>Rotatividade</h3>' +
    (rot.limite
      ? '<div class="rot-num">' + rot.desdeUltimaManutencao +
        ' <small>/ ' + rot.limite + ' utilizações</small></div>' +
        '<div class="barra"><i style="width:' + rot.percentual + '%;background:' +
        corRotatividade + '"></i></div>' +
        '<p style="font-size:12.5px;color:#6B7684">' +
        (rot.situacao === 'MANUTENCAO_PROGRAMADA' ? 'Manutenção programada'
          : (rot.situacao === 'PROXIMO_LIMITE' ? 'Próximo da manutenção' : 'Dentro do limite')) +
        '</p>'
      : '<div class="rot-num">' + rot.totalSaidas + ' <small>utilizações</small></div>' +
        '<p style="font-size:12.5px;color:#6B7684">Sem limite configurado ' +
        'para manutenção preventiva.</p>') +

    '<h3>Números</h3>' +
    linha('Total de saídas', String(rot.totalSaidas || 0)) +
    linha('Total de devoluções', String(rot.totalDevolucoes || 0)) +
    linha('Desde a última manutenção', String(rot.desdeUltimaManutencao || 0)) +
    '</div></div>' +

    /* ---- MANUTENÇÃO ---- */
    '<div class="painel" id="pManut"><div class="cartao">' +
    '<h3>Manutenções (' + c.totalManutencoes + ')</h3>' +
    (d.manutencoes.length
      ? d.manutencoes.map(function (m) {
          return '<div class="item"><b>' + esc(m.tipo) + '</b>' +
            '<small>' + data(m.quando) +
            (m.executadaPor ? ' · ' + esc(m.executadaPor) : '') + '</small>' +
            '<small style="color:#4A5866">' + esc(m.descricao) + '</small>' +
            (m.proximaEm ? '<small>próxima: ' + data(m.proximaEm) + '</small>' : '') +
            '</div>';
        }).join('')
      : '<div class="vazio">Nenhuma manutenção registrada.</div>') +
    '</div></div>' +

    /* ---- LACRE ---- */
    '<div class="painel" id="pLacre"><div class="cartao">' +
    '<h3>Lacre atual</h3>' +
    (d.lacreAtual
      ? '<div class="lacre">' +
        '<div class="bola" style="background:' + esc(corDoLacre_(d.lacreAtual.cor)) + '"></div>' +
        '<div><b style="font-size:15px">' + esc(d.lacreAtual.codigo) + '</b>' +
        '<small style="display:block;color:#8A96A3;font-size:12px">' +
        (d.lacreAtual.cor ? esc(d.lacreAtual.cor) + ' · ' : '') +
        'instalado em ' + data(d.lacreAtual.instaladoEm) + '</small></div></div>' +
        (d.lacreAtual.motivo
          ? '<p style="font-size:12.5px;color:#6B7684;margin-top:10px">' +
            esc(d.lacreAtual.motivo) + '</p>' : '')
      : '<div class="vazio">Nenhum lacre registrado.</div>') +

    (d.lacres && d.lacres.length > 1
      ? '<h3>Trocas anteriores</h3>' +
        d.lacres.slice(1).map(function (l) {
          return '<div class="item"><b>' + esc(l.codigo) +
            (l.cor ? ' · ' + esc(l.cor) : '') + '</b>' +
            '<small>' + data(l.instaladoEm) +
            (l.instaladoPor ? ' · ' + esc(l.instaladoPor) : '') + '</small>' +
            (l.motivo ? '<small>' + esc(l.motivo) + '</small>' : '') + '</div>';
        }).join('')
      : '') +
    '</div></div>' +

    /* ---- DOCUMENTOS ---- */
    '<div class="painel" id="pDocs"><div class="cartao">' +
    '<h3>Documentos</h3>' +
    (d.documentos && d.documentos.length
      ? d.documentos.map(function (doc) {
          return '<a class="doc" href="' + esc(doc.url) + '" target="_blank" rel="noopener">' +
            '<div class="doc-ico">📄</div>' +
            '<div style="flex:1"><b style="font-size:13.5px">' + esc(doc.nome) + '</b>' +
            '<small style="color:#8A96A3;font-size:11.5px">' + esc(doc.tipo) +
            ' · ' + data(doc.enviadoEm) + '</small></div>' +
            '<span style="color:#0B5FFF;font-size:12.5px">abrir</span></a>';
        }).join('')
      : '<div class="vazio">Nenhum documento anexado.</div>') +
    '</div></div>' +

    (d.publica
      ? '<div class="aviso a-azul">Valor, fornecedor, nota fiscal e pedido só aparecem ' +
        'para quem entra no sistema.</div>' : '') +

    '<div class="rodape">' + esc(EMPRESA) + ' · ALMOXA PRO<br>' +
    'Ficha consultada em ' + esc(AP_ENTRADA_agoraTexto_()) + '</div>' +
    '</div>' +

    /* visualizador de fotos em tela cheia */
    (d.fotos && d.fotos.length
      ? '<div class="lupa" id="lupa">' +
        '<button class="fechar" onclick="fecharLupa()">×</button>' +
        (d.fotos.length > 1
          ? '<button class="nav esq" onclick="event.stopPropagation();navegar(-1)">‹</button>' +
            '<button class="nav dir" onclick="event.stopPropagation();navegar(1)">›</button>'
          : '') +
        '<img id="lupaImg" src="" alt="">' +
        '<div class="leg" id="lupaLeg"></div></div>'
      : '') +

    '<script>' +
    (d.fotos && d.fotos.length
      ? 'var FOTOS=' + JSON.stringify(d.fotos.map(function (f) {
          return { i: f.imagem, l: f.legenda || f.rotulo };
        })) + ';' +
        'var atual=0;' +
        'function abrirLupa(n){atual=n;' +
        ' document.getElementById("lupaImg").src=FOTOS[n].i;' +
        ' document.getElementById("lupaLeg").textContent=FOTOS[n].l+' +
        '  (FOTOS.length>1?"  ("+(n+1)+" de "+FOTOS.length+")":"");' +
        ' document.getElementById("lupa").classList.add("on");}' +
        'function fecharLupa(){document.getElementById("lupa").classList.remove("on");}' +
        'function navegar(d){abrirLupa((atual+d+FOTOS.length)%FOTOS.length);}' +
        'document.querySelectorAll("[data-foto]").forEach(function(f){' +
        ' f.onclick=function(){abrirLupa(Number(f.getAttribute("data-foto")));};});' +
        'document.getElementById("lupa").onclick=fecharLupa;' +
        /* as setas do teclado, para quem está no computador */
        'document.addEventListener("keydown",function(e){' +
        ' if(!document.getElementById("lupa").classList.contains("on"))return;' +
        ' if(e.key==="Escape")fecharLupa();' +
        ' if(e.key==="ArrowLeft")navegar(-1);' +
        ' if(e.key==="ArrowRight")navegar(1);});'
      : '') +
    'document.querySelectorAll("[data-aba]").forEach(function(b){' +
    ' b.onclick=function(){' +
    '  document.querySelectorAll("[data-aba]").forEach(function(x){x.classList.remove("on")});' +
    '  document.querySelectorAll(".painel").forEach(function(x){x.classList.remove("on")});' +
    '  b.classList.add("on");' +
    '  var alvo=document.getElementById(b.getAttribute("data-aba"));' +
    '  if(alvo) alvo.classList.add("on");' +
    ' };' +
    '});' +
    '</script></body></html>';
}

/** Cor do lacre em código, para desenhar a bolinha */
function corDoLacre_(nome) {
  var cores = {
    'AZUL': '#0B5FFF', 'AMARELO': '#FFC300', 'VERMELHO': '#C0392B',
    'VERDE': '#1E9E5A', 'BRANCO': '#F0F4F8', 'PRETO': '#2A3542',
    'LARANJA': '#FF7A00', 'ROXO': '#7B4FBF', 'CINZA': '#8E969F'
  };
  return cores[String(nome || '').toUpperCase().trim()] || '#C9D6E4';
}

function AP_ENTRADA_agoraTexto_() {
  try {
    return Utilities.formatDate(new Date(),
      AP_Config_get('TIMEZONE', 'America/Sao_Paulo'), 'dd/MM/yyyy HH:mm');
  } catch (e) {
    return new Date().toLocaleString('pt-BR');
  }
}


/* ============================================================
   ABRIR A FICHA EM PDF PELO CÓDIGO DO QR
   ============================================================ */

function AP_ENTRADA_abrirFicha_(codigo) {
  var r;
  try {
    r = AP_Modulo_patrimonio('localizarFicha', { codigo: codigo }, null);
  } catch (e) {
    r = { ok: false, mensagem: e.message };
  }

  /* achou o PDF: manda o navegador para ele */
  if (r.ok && r.dados && r.dados.url) {
    return HtmlService.createHtmlOutput(
      '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + AP_ENTRADA_esc_(r.dados.patrimonio) + '</title>' +
      '<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      'background:#F4F7FB;display:flex;align-items:center;justify-content:center;' +
      'height:100vh;margin:0;text-align:center;padding:20px}' +
      '.cx{background:#fff;border-radius:14px;padding:28px 24px;max-width:340px;' +
      'border:1px solid #E3E9F0}' +
      '.pat{font-family:monospace;font-size:19px;font-weight:800;color:#FF7A00;margin:8px 0}' +
      'h1{font-size:17px;color:#0B2A55;margin-bottom:4px}' +
      'p{font-size:13px;color:#6B7684;margin-top:10px}' +
      'a{display:block;margin-top:16px;background:#0B2A55;color:#fff;padding:12px;' +
      'border-radius:9px;text-decoration:none;font-weight:600;font-size:14px}' +
      '</style>' +
      /* vai direto; o botão é para quem tiver o redirecionamento bloqueado */
      '<script>setTimeout(function(){window.location.replace(' +
      JSON.stringify(r.dados.url) + ');}, 300);</script>' +
      '</head><body><div class="cx">' +
      '<h1>' + AP_ENTRADA_esc_(r.dados.descricao || 'Patrimônio') + '</h1>' +
      '<div class="pat">' + AP_ENTRADA_esc_(r.dados.patrimonio) + '</div>' +
      '<p>Abrindo a ficha…</p>' +
      '<a href="' + AP_ENTRADA_esc_(r.dados.url) + '">Abrir a ficha em PDF</a>' +
      '</div></body></html>')
      .setTitle('Ficha ' + r.dados.patrimonio)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  /* sem PDF, mas o patrimônio existe: mostra a ficha em tela */
  if (r.codigo === 'SEM_FICHA' || r.codigo === 'ARQUIVO_SUMIU') {
    return AP_ENTRADA_paginaPatrimonio_(codigo);
  }

  /* código não reconhecido */
  return AP_ENTRADA_paginaPatrimonio_(codigo);
}

function AP_ENTRADA_esc_(t) {
  return String(t === null || t === undefined ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
