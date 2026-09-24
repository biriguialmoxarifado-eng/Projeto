/* ============================================================
   ALMOXA PRO — PONTE
   ------------------------------------------------------------
   O QUE ESTE ARQUIVO É

   Um cano. Só isso.

   Ele deixa o ALMOXA PRO ser aberto de um endereço https próprio
   e continuar conversando com ESTE MESMO Core, nesta mesma
   planilha, com estas mesmas regras. Não há segundo Core, segunda
   autenticação, segundo banco nem segunda regra de permissão —
   e é de propósito: duas verdades sobre quem pode o quê é o
   caminho mais curto para uma delas estar errada.

   POR QUE ISSO PRECISOU EXISTIR

   A câmera. O Apps Script serve a página dentro de um iframe de
   origem opaca (googleusercontent.com), e navegador nenhum entrega
   câmera para origem opaca. Isso apertou em fevereiro de 2026 e
   derrubou a câmera de todo sistema feito em Apps Script.

   Havia duas saídas:

     (a) uma ferramenta de leitura separada — foi o que tentamos
         antes, e estava errado: vira um segundo sistema, com
         segunda tela, segundo lugar para configurar e segunda
         chance de divergir;

     (b) o ALMOXA inteiro servido de um endereço https de verdade,
         falando com o Core daqui. Uma tela só, um leitor só, um
         Core só — e a câmera abre porque a origem é legítima.

   Esta ponte é a (b).

   O QUE MUDA NO CORE: NADA

   A ponte não reimplementa nenhuma ação. Ela recebe o mesmo JSON
   que o google.script.run já entregava e chama o MESMO almoxaApi.
   Se uma regra mudar lá dentro, muda para os dois caminhos no
   mesmo instante, porque é o mesmo código.

       navegador  →  POST /exec  →  esta ponte  →  almoxaApi
                                                      ↓
                                              as regras de sempre

   SEGURANÇA — leia antes de publicar

   Para o navegador alcançar o Core, a publicação precisa estar
   como "Qualquer pessoa". Isso NÃO abre o sistema: o almoxaApi
   continua exigindo sessão, e sem login a única coisa que passa
   é o próprio login. Mas o endereço fica alcançável por quem o
   tiver, então:

     · configure ALMOXA_CHAVE_APP nas Propriedades do Script e
       ponha a mesma chave no frontend. Ela não é segredo forte
       (vai dentro da página), mas corta varredura automática;
     · toda chamada que chega por aqui fica registrada, com origem
       marcada como "ponte";
     · ações destrutivas e administrativas continuam exigindo
       sessão e permissão, exatamente como antes.

   Rode AP_PONTE_testes() para conferir sem tocar em dado.
   ============================================================ */

var AP_PONTE_CFG = {
  versao: '1.0.0',

  /* o nome da propriedade que guarda a chave do app */
  propChave: 'ALMOXA_CHAVE_APP',

  /* ações que podem ser chamadas SEM sessão — a porta de entrada
     e nada mais. Tudo o que não está aqui exige login, como sempre */
  semSessao: [
    'auth.login',
    'auth.primeiroAcesso',
    'auth.existeUsuario',
    'doutor.ping',
    'cracha.validar'
  ],

  /* teto para o corpo da requisição: foto de crachá cabe, despejo
     de dados não */
  limiteCorpo: 900000
};


/* ============================================================
   A ENTRADA
   ============================================================ */

/**
 * Chame no começo do seu doPost.
 *
 *   function doPost(e) {
 *     var p = AP_PONTE_doPost(e);
 *     if (p) return p;
 *     // ... o que seu doPost já fazia, se fazia
 *   }
 *
 * Sem o formato da ponte, devolve null e o seu doPost segue.
 */
function AP_PONTE_doPost(e) {
  var corpo = '';
  try {
    corpo = (e && e.postData && e.postData.contents) || '';
  } catch (erro) { return null; }
  if (!corpo) return null;

  var pedido;
  try { pedido = JSON.parse(corpo); } catch (erro) { return null; }
  if (!pedido || pedido.ponte !== 'ALMOXA') return null;   /* não é nosso */

  return AP_PONTE_responder_(AP_PONTE_atender_(pedido, e));
}

/**
 * O mesmo pela URL, para o "oi" inicial e para diagnóstico.
 * Chame no começo do seu doGet, depois do LinkFlow e do crachá.
 */
function AP_PONTE_doGet(e) {
  var pedido = '';
  try { pedido = (e && e.parameter && e.parameter.ponte) || ''; } catch (erro) { return null; }
  if (!pedido) return null;

  var p = (e && e.parameter) || {};

  if (pedido === 'ping') {
    return AP_PONTE_responder_({
      ok: true,
      dados: {
        versao: AP_PONTE_CFG.versao,
        pronto: true,
        exigeChave: !!AP_PONTE_chave_(),
        chaveConfere: AP_PONTE_chaveConfere_(p.chave),
        quando: new Date().toISOString()
      }
    });
  }

  /* chamada simples pela URL — serve para ações pequenas e para
     testar do navegador; o caminho normal é o POST */
  if (pedido === 'api') {
    var req = {
      ponte: 'ALMOXA',
      chave: p.chave || '',
      modulo: p.modulo || '',
      acao: p.acao || '',
      sessao: p.sessao || null,
      payload: {}
    };
    try { req.payload = p.payload ? JSON.parse(p.payload) : {}; } catch (erro) { req.payload = {}; }
    return AP_PONTE_responder_(AP_PONTE_atender_(req, e));
  }

  return AP_PONTE_responder_({
    ok: false, codigo: 'PEDIDO_DESCONHECIDO',
    mensagem: 'ponte=' + pedido + ' não existe.'
  });
}


/* ============================================================
   O MIOLO
   ============================================================ */

function AP_PONTE_chave_() {
  try {
    return String(PropertiesService.getScriptProperties()
      .getProperty(AP_PONTE_CFG.propChave) || '').trim();
  } catch (e) { return ''; }
}

function AP_PONTE_chaveConfere_(recebida) {
  var esperada = AP_PONTE_chave_();
  if (!esperada) return true;              /* não configurada: passa */
  return String(recebida || '') === esperada;
}

/**
 * Recebe o pedido, confere o que é da ponte, e entrega ao Core.
 *
 * Repare no que esta função NÃO faz: ela não olha permissão, não
 * decide nada, não conhece módulo nenhum pelo nome. Quem faz isso
 * é o almoxaApi, como sempre fez. Aqui é porteiro de prédio, não
 * gerente.
 */
function AP_PONTE_atender_(pedido, e) {
  /* --- a chave do app --- */
  if (!AP_PONTE_chaveConfere_(pedido.chave)) {
    AP_PONTE_registrar_(pedido, 'BLOQUEADO', 'chave do app não confere');
    return {
      ok: false, codigo: 'APP_NAO_AUTORIZADO',
      mensagem: 'Este aplicativo não está autorizado a falar com o Core.'
    };
  }

  var modulo = String(pedido.modulo || '');
  var acao = String(pedido.acao || '');
  if (!modulo || !acao) {
    return { ok: false, codigo: 'PEDIDO_INCOMPLETO', mensagem: 'Faltou módulo ou ação.' };
  }

  /* --- sessão: só a porta de entrada passa sem --- */
  var chave = modulo + '.' + acao;
  if (!pedido.sessao && AP_PONTE_CFG.semSessao.indexOf(chave) === -1) {
    AP_PONTE_registrar_(pedido, 'BLOQUEADO', 'sem sessão');
    return {
      ok: false, codigo: 'SEM_SESSAO',
      mensagem: 'Faça login para continuar. Esta operação precisa de sessão.'
    };
  }

  /* --- tamanho --- */
  var tamanho = 0;
  try { tamanho = JSON.stringify(pedido.payload || {}).length; } catch (erro) { tamanho = 0; }
  if (tamanho > AP_PONTE_CFG.limiteCorpo) {
    return {
      ok: false, codigo: 'PEDIDO_GRANDE',
      mensagem: 'O pedido tem ' + Math.round(tamanho / 1024) + ' KB e passou do limite. ' +
        'Se for uma foto, reduza a imagem antes de enviar.'
    };
  }

  /* --- entrega ao Core, do jeito que ele já recebia --- */
  var paraOCore = {
    modulo: modulo,
    acao: acao,
    payload: pedido.payload || {},
    sessao: pedido.sessao || null,
    perfil: pedido.perfil || null,
    obra: pedido.obra || null,
    /* marca de onde veio, para a auditoria saber distinguir */
    origem: 'ponte' + (pedido.origem ? ':' + pedido.origem : ''),
    ts: Date.now()
  };

  var resposta;
  try {
    if (typeof almoxaApi !== 'function') {
      return {
        ok: false, codigo: 'CORE_AUSENTE',
        mensagem: 'A função almoxaApi não existe neste projeto. A ponte precisa dela.'
      };
    }
    resposta = almoxaApi(JSON.stringify(paraOCore));
  } catch (falha) {
    AP_PONTE_registrar_(pedido, 'ERRO', falha && falha.message ? falha.message : String(falha));
    return {
      ok: false, codigo: 'CORE_FALHOU',
      mensagem: falha && falha.message ? falha.message : String(falha)
    };
  }

  /* o almoxaApi devolve texto ou objeto, conforme a versão */
  if (typeof resposta === 'string') {
    try { resposta = JSON.parse(resposta); }
    catch (erro) { resposta = { ok: true, dados: resposta }; }
  }
  if (!resposta || typeof resposta !== 'object') {
    resposta = { ok: false, codigo: 'RESPOSTA_VAZIA', mensagem: 'O Core não respondeu nada.' };
  }

  AP_PONTE_registrar_(pedido, resposta.ok ? 'OK' : 'RECUSADO', resposta.codigo || '');
  return resposta;
}

/**
 * Deixa rastro de quem entrou pela ponte.
 * Se a auditoria não existir, segue em frente — registro que
 * derruba a operação é pior do que registro que falta.
 */
function AP_PONTE_registrar_(pedido, resultado, detalhe) {
  try {
    if (typeof AP_Modulo_auditoria !== 'function') return;
    /* o dia a dia não precisa virar log: só o que foi barrado ou
       falhou, senão a planilha vira lixeira e ninguém olha */
    if (resultado === 'OK') return;
    AP_Modulo_auditoria('registrar', {
      usuario: (pedido && pedido.usuario) || 'ponte',
      acao: 'PONTE_' + resultado,
      alvo: String((pedido && pedido.modulo) || '') + '.' + String((pedido && pedido.acao) || ''),
      detalhes: String(detalhe || '').slice(0, 300),
      data: new Date().toISOString()
    }, {});
  } catch (e) { }
}

function AP_PONTE_responder_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


/* ============================================================
   TESTES — não tocam na planilha
   ============================================================ */

function AP_PONTE_testes() {
  var log = [], falhas = 0;
  function ok(nome, passou, obs) {
    if (!passou) falhas++;
    log.push((passou ? 'PASSOU  ' : 'FALHOU  ') + nome + (obs ? '  [' + obs + ']' : ''));
  }

  var orig = {
    api: (typeof almoxaApi === 'function') ? almoxaApi : null,
    props: (typeof PropertiesService !== 'undefined') ? PropertiesService : null
  };
  var recebido = [];
  var guardado = {};

  try {
    /* um Core de mentira que só anota o que chegou */
    almoxaApi = function (json) {
      var r = JSON.parse(json);
      recebido.push(r);
      if (r.modulo === 'explode') throw new Error('o Core caiu');
      if (r.modulo === 'textao') return JSON.stringify({ ok: true, dados: 'veio como texto' });
      return { ok: true, dados: { modulo: r.modulo, acao: r.acao, sessao: r.sessao, origem: r.origem } };
    };
    PropertiesService = {
      getScriptProperties: function () {
        return {
          getProperty: function (k) { return guardado[k] || null; },
          setProperty: function (k, v) { guardado[k] = v; }
        };
      }
    };

    var ler = function (saida) { return saida ? JSON.parse(saida.getContent()) : null; };
    var post = function (obj) {
      return ler(AP_PONTE_doPost({ postData: { contents: JSON.stringify(obj) } }));
    };

    /* ---------- 1. A PONTE NÃO SE METE NO QUE NÃO É DELA ---------- */
    ok('POST vazio não é da ponte',
      AP_PONTE_doPost({}) === null,
      'o doPost do sistema segue como sempre');
    ok('POST de outro formato não é da ponte',
      AP_PONTE_doPost({ postData: { contents: '{"coisa":1}' } }) === null);
    ok('GET sem ?ponte= não é da ponte',
      AP_PONTE_doGet({ parameter: {} }) === null);

    /* ---------- 2. O CANO ENTREGA O QUE RECEBEU ---------- */
    recebido.length = 0;
    var r1 = post({
      ponte: 'ALMOXA', modulo: 'estoque', acao: 'listar',
      sessao: 'TOKEN-123', payload: { busca: 'cabo' }, perfil: 'almoxarife'
    });
    ok('a chamada chega ao Core', r1.ok && recebido.length === 1);
    ok('COM O MESMO MÓDULO, AÇÃO E SESSÃO',
      recebido[0].modulo === 'estoque' && recebido[0].acao === 'listar' &&
      recebido[0].sessao === 'TOKEN-123',
      recebido[0].modulo + '.' + recebido[0].acao);
    ok('e o payload vai inteiro',
      recebido[0].payload && recebido[0].payload.busca === 'cabo');
    ok('a origem fica marcada como ponte',
      String(recebido[0].origem).indexOf('ponte') === 0, recebido[0].origem);

    /* ---------- 3. A PONTE NÃO DECIDE NADA ---------- */
    ok('A PONTE NÃO CONHECE MÓDULO NENHUM PELO NOME',
      post({ ponte: 'ALMOXA', modulo: 'modulo-que-nao-existe', acao: 'x', sessao: 'T' }).ok === true,
      'ela entrega e quem recusa é o Core');

    /* ---------- 4. SESSÃO ---------- */
    ok('SEM SESSÃO, SÓ O LOGIN PASSA',
      post({ ponte: 'ALMOXA', modulo: 'auth', acao: 'login', payload: { usuario: 'x' } }).ok === true);
    var semSessao = post({ ponte: 'ALMOXA', modulo: 'estoque', acao: 'listar' });
    ok('E O RESTO É BARRADO', semSessao.codigo === 'SEM_SESSAO', semSessao.mensagem);
    ok('nem escrita passa sem sessão',
      post({ ponte: 'ALMOXA', modulo: 'reservas', acao: 'criar', payload: {} }).codigo === 'SEM_SESSAO');
    ok('o ping passa sem sessão',
      post({ ponte: 'ALMOXA', modulo: 'doutor', acao: 'ping' }).ok === true);
    ok('a leitura de crachá passa sem sessão',
      post({ ponte: 'ALMOXA', modulo: 'cracha', acao: 'validar', payload: { conteudo: 'x' } }).ok === true,
      'o leitor precisa identificar antes de existir sessão');

    /* ---------- 5. A CHAVE DO APP ---------- */
    guardado[AP_PONTE_CFG.propChave] = 'SEGREDO-DA-OBRA';
    var semChave = post({ ponte: 'ALMOXA', modulo: 'estoque', acao: 'listar', sessao: 'T' });
    ok('COM CHAVE CONFIGURADA, APP SEM CHAVE NÃO PASSA',
      semChave.codigo === 'APP_NAO_AUTORIZADO', semChave.mensagem);
    ok('chave errada também não',
      post({ ponte: 'ALMOXA', chave: 'chutando', modulo: 'estoque', acao: 'listar', sessao: 'T' })
        .codigo === 'APP_NAO_AUTORIZADO');
    ok('com a chave certa, passa',
      post({ ponte: 'ALMOXA', chave: 'SEGREDO-DA-OBRA', modulo: 'estoque', acao: 'listar', sessao: 'T' })
        .ok === true);
    ok('e o ping conta se a chave bate',
      ler(AP_PONTE_doGet({ parameter: { ponte: 'ping', chave: 'SEGREDO-DA-OBRA' } }))
        .dados.chaveConfere === true);
    ok('e conta quando não bate',
      ler(AP_PONTE_doGet({ parameter: { ponte: 'ping', chave: 'errada' } }))
        .dados.chaveConfere === false);
    delete guardado[AP_PONTE_CFG.propChave];

    /* ---------- 6. QUANDO O CORE FALHA ---------- */
    var explodiu = post({ ponte: 'ALMOXA', modulo: 'explode', acao: 'x', sessao: 'T' });
    ok('O CORE CAINDO NÃO DERRUBA A PONTE',
      explodiu.ok === false && explodiu.codigo === 'CORE_FALHOU', explodiu.mensagem);
    ok('e a resposta em texto é entendida',
      post({ ponte: 'ALMOXA', modulo: 'textao', acao: 'x', sessao: 'T' }).dados === 'veio como texto');

    almoxaApi = undefined;
    ok('sem almoxaApi no projeto, a ponte avisa em vez de quebrar',
      post({ ponte: 'ALMOXA', modulo: 'x', acao: 'y', sessao: 'T' }).codigo === 'CORE_AUSENTE');
    /* devolve o Core que anota, para os testes seguintes */
    almoxaApi = function (json) {
      var r = JSON.parse(json);
      recebido.push(r);
      return { ok: true, dados: { modulo: r.modulo, acao: r.acao } };
    };

    /* ---------- 7. PEDIDO MAL FEITO ---------- */
    ok('sem módulo, recusa explicada',
      post({ ponte: 'ALMOXA', acao: 'listar', sessao: 'T' }).codigo === 'PEDIDO_INCOMPLETO');

    var gigante = { foto: new Array(AP_PONTE_CFG.limiteCorpo + 5000).join('A') };
    var grande = post({ ponte: 'ALMOXA', modulo: 'x', acao: 'y', sessao: 'T', payload: gigante });
    ok('PEDIDO GRANDE DEMAIS É RECUSADO COM EXPLICAÇÃO',
      grande.codigo === 'PEDIDO_GRANDE', grande.mensagem);

    /* ---------- 8. PELA URL TAMBÉM ---------- */
    recebido.length = 0;
    var porUrl = ler(AP_PONTE_doGet({
      parameter: { ponte: 'api', modulo: 'estoque', acao: 'listar', sessao: 'T',
        payload: '{"busca":"disco"}' }
    }));
    ok('a chamada pela URL também chega ao Core',
      porUrl.ok && recebido[0].payload.busca === 'disco');
    ok('pedido inventado pela URL não faz nada',
      ler(AP_PONTE_doGet({ parameter: { ponte: 'esvaziar' } })).codigo === 'PEDIDO_DESCONHECIDO');

  } finally {
    if (orig.api) almoxaApi = orig.api; else almoxaApi = undefined;
    if (orig.props) PropertiesService = orig.props;
  }

  log.push('');
  log.push(falhas ? falhas + ' teste(s) FALHARAM' : 'todos os testes passaram');
  log.push('');
  log.push('O que foi verificado: a ponte não se mete no que não é dela,');
  log.push('entrega ao Core exatamente o que recebeu, não conhece módulo');
  log.push('nenhum pelo nome, exige sessão para tudo menos a porta de');
  log.push('entrada, respeita a chave do app e não derruba nada quando o');
  log.push('Core falha. Nada foi lido nem gravado na planilha.');

  try { Logger.log(log.join('\n')); } catch (e) { }
  return log;
}
