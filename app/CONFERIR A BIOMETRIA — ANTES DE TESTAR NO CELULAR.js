/* ============================================================
   CONFERIR A BIOMETRIA — ANTES DE TESTAR NO CELULAR
   ============================================================
   SÓ LÊ. Não cria aba, não apaga nada, não grava nada.
   A única coisa que ele faz é perguntar ao seu próprio Core se a
   biometria está no caminho, e dizer em português o que falta.

   COMO USAR
     1. Cole este arquivo no projeto do Apps Script.
     2. Escolha a função CONFERIR_BIOMETRIA e clique em Executar.
     3. Abra o Registro de execução e me mande o que apareceu.

   O que ele NÃO faz: ele não lê digital nenhuma. Digital só o
   aparelho lê, no navegador, pelo endereço https.
   ============================================================ */

var AP_CBIO_V = '1.0.0';

function CONFERIR_BIOMETRIA() {
  var L = [];
  function diz(t) { L.push(t); }
  function titulo(t) { diz(''); diz('=== ' + t + ' ==='); }

  var problemas = [];
  function falta(o_que, o_que_fazer) {
    problemas.push({ o_que: o_que, fazer: o_que_fazer });
  }

  diz('CONFERIDOR DA BIOMETRIA v' + AP_CBIO_V);
  diz('projeto: ' + AP_CBIO_nomeDoProjeto_());
  diz('fuso do projeto: ' + AP_CBIO_fuso_());

  /* ---------- 1. o módulo está no projeto? ---------- */
  titulo('1. O ARQUIVO DA BIOMETRIA');
  var temModulo = (typeof AP_Modulo_biometria === 'function');
  diz('AP_Modulo_biometria existe: ' + (temModulo ? 'SIM' : 'NÃO'));
  if (!temModulo) {
    diz('  -> o arquivo ALMOX_PRO_Modulo_Biometria não está colado neste projeto.');
    falta('o módulo da biometria não está no projeto',
      'cole o arquivo ALMOX_PRO_Modulo_Biometria.gs e salve');
    AP_CBIO_fim_(L, problemas);
    return;
  }

  var v = null;
  try {
    v = AP_Modulo_biometria('versao', {}, null);
    diz('versão do módulo: ' + ((v && v.dados && v.dados.versao) || '?'));
    diz('ações que ele aceita: ' + ((v && v.dados && (v.dados.acoes || []).join(', ')) || '?'));
    diz('guarda a digital no servidor: ' +
      ((v && v.dados && v.dados.guardaDigital) ? 'SIM (ERRADO!)' : 'não — correto'));
    diz('o servidor verifica a assinatura do dedo: ' +
      ((v && v.dados && v.dados.verificaAssinaturaNoServidor) ? 'sim' : 'não'));
    diz('  (não verificar é o esperado: quem confere o dedo é o aparelho,');
    diz('   igual ao crachá. Está escrito assim no comprovante.)');
  } catch (e) {
    diz('ERRO ao chamar o módulo: ' + e.message);
    falta('o módulo está no projeto mas quebra ao ser chamado: ' + e.message,
      'me mande esta mensagem inteira');
  }

  /* ---------- 2. a camada de dados responde? ---------- */
  titulo('2. A CAMADA DE DADOS (AP_Data_*)');
  ['AP_Data_getSheet', 'AP_Data_rows', 'AP_Data_append', 'AP_Data_update'].forEach(function (f) {
    var tem = (typeof this[f] === 'function');
    diz(f + ': ' + (tem ? 'SIM' : 'NÃO'));
    if (!tem) falta('falta a função ' + f,
      'a biometria usa a mesma camada de dados do resto do sistema — ' +
      'confira se o arquivo dela está no projeto');
  }, this);

  /* ---------- 3. as abas ---------- */
  titulo('3. AS ABAS (só olhando, não cria nenhuma)');
  var abas = AP_CBIO_abas_();
  if (abas === null) {
    diz('não consegui abrir a planilha para olhar as abas.');
  } else {
    ['ALMOXA_BIOMETRIAS', 'ALMOXA_BIOMETRIA_PROVAS'].forEach(function (nome) {
      var existe = abas.indexOf(nome) > -1;
      diz(nome + ': ' + (existe ? 'já existe' : 'ainda não existe'));
      if (!existe) diz('  -> normal. Ela nasce sozinha no primeiro cadastro.');
    });
  }

  /* ---------- 4. o roteador do Core conhece "biometria"? ---------- */
  titulo('4. O CAMINHO ATÉ O MÓDULO (o que mais costuma faltar)');
  var temApi = (typeof almoxaApi === 'function');
  diz('almoxaApi existe: ' + (temApi ? 'SIM' : 'NÃO'));
  if (!temApi) {
    falta('não achei a função almoxaApi neste projeto',
      'ela é a porta do sistema. Confira se você colou este conferidor no ' +
      'projeto certo do Apps Script');
  } else {
    var resposta = null, cru = '';
    try {
      cru = almoxaApi(JSON.stringify({
        modulo: 'biometria', acao: 'versao', payload: {}, sessao: null
      }));
      resposta = (typeof cru === 'string') ? JSON.parse(cru) : cru;
    } catch (e) {
      diz('almoxaApi quebrou: ' + e.message);
      falta('o roteador quebrou ao receber o módulo biometria: ' + e.message,
        'me mande esta mensagem');
    }
    if (resposta) {
      diz('resposta do roteador: ok=' + resposta.ok +
        ' codigo=' + (resposta.codigo || '—') +
        ' mensagem=' + (resposta.mensagem || '—'));
      var chegou = resposta.ok === true ||
        (resposta.dados && resposta.dados.versao);
      var naoConhece = /MODULO|DESCONHECID|NAO_ENCONTRAD|INVALID/i
        .test(String(resposta.codigo || '') + ' ' + String(resposta.mensagem || ''));
      var pediuLogin = /SESSAO|LOGIN|AUTENTIC/i
        .test(String(resposta.codigo || '') + ' ' + String(resposta.mensagem || ''));
      if (chegou) {
        diz('  -> O PEDIDO CHEGOU NO MÓDULO. Este caminho está pronto.');
      } else if (pediuLogin) {
        diz('  -> o roteador conhece o módulo e pediu login. Isso é normal aqui:');
        diz('     esta execução não tem sessão. Este caminho está pronto.');
      } else if (naoConhece) {
        diz('  -> O ROTEADOR NÃO CONHECE O MÓDULO "biometria".');
        falta('o almoxaApi não encaminha o módulo biometria',
          'no arquivo onde está o almoxaApi, ache a lista (ou o switch) de ' +
          'módulos e acrescente uma linha para "biometria" apontando para ' +
          'AP_Modulo_biometria — do mesmo jeito que está feito para epigestao. ' +
          'Me mande esse trecho e eu escrevo a linha exata.');
      } else {
        diz('  -> não deu para concluir pela resposta. Me mande a linha acima.');
        falta('resposta do roteador que eu não sei ler: ' +
          (resposta.codigo || resposta.mensagem || cru),
          'me mande esta linha');
      }
    }
  }

  /* ---------- 5. a ponte deixa entrar pela digital? ---------- */
  titulo('5. ENTRAR NO SISTEMA PELA DIGITAL');
  if (typeof AP_PONTE_CFG === 'undefined') {
    diz('a ponte (AP_PONTE_CFG) não está neste projeto.');
    diz('  -> se o GitHub fala com o Core por uma porta SUA, é nela que');
    diz('     "biometria.entrar" precisa poder passar sem sessão.');
    falta('não achei a ponte para conferir a liberação do biometria.entrar',
      'me diga o nome do arquivo que recebe os pedidos do GitHub, ou ' +
      'instale o ALMOXA_PRO_Modulo_Ponte');
  } else {
    var lista = (AP_PONTE_CFG.semSessao || []);
    diz('ações liberadas sem sessão: ' + lista.join(', '));
    var liberado = lista.indexOf('biometria.entrar') > -1;
    diz('biometria.entrar liberado: ' + (liberado ? 'SIM' : 'NÃO'));
    if (!liberado) {
      falta('biometria.entrar não está liberado sem sessão',
        'entrar pela digital acontece ANTES de existir sessão. Atualize o ' +
        'arquivo da ponte com a versão nova, que já traz essa linha');
    } else {
      diz('  -> e só o "entrar". Cadastrar, revogar e confirmar continuam');
      diz('     exigindo login, como tem que ser.');
    }
  }

  AP_CBIO_fim_(L, problemas);
}

/* ---------- impressão ---------- */
function AP_CBIO_fim_(L, problemas) {
  L.push('');
  L.push('============================================================');
  if (!problemas.length) {
    L.push('NADA FALTANDO NO LADO DO GOOGLE.');
    L.push('');
    L.push('O que falta agora é do lado do navegador, e eu não consigo');
    L.push('conferir daqui:');
    L.push('  - abrir o sistema pelo endereço https (GitHub Pages).');
    L.push('    No arquivo baixado e dentro do quadro do Apps Script o');
    L.push('    navegador não libera o leitor de digital.');
    L.push('  - o aparelho precisa ter leitor (Windows Hello, Touch ID,');
    L.push('    digital do celular) já configurado no próprio aparelho.');
  } else {
    L.push('FALTA ' + problemas.length + ' COISA(S):');
    problemas.forEach(function (p, i) {
      L.push('');
      L.push((i + 1) + ') ' + p.o_que);
      L.push('   o que fazer: ' + p.fazer);
    });
  }
  L.push('============================================================');
  var texto = L.join('\n');
  try { console.log(texto); } catch (e) { }
  return texto;
}

/* ---------- apoio, tudo só leitura ---------- */
function AP_CBIO_nomeDoProjeto_() {
  try { return SpreadsheetApp.getActive().getName(); } catch (e) { return '(não deu para ler)'; }
}
function AP_CBIO_fuso_() {
  try { return Session.getScriptTimeZone(); } catch (e) { return '(não deu para ler)'; }
}
function AP_CBIO_abas_() {
  try {
    return SpreadsheetApp.getActive().getSheets().map(function (s) { return s.getName(); });
  } catch (e) { return null; }
}
