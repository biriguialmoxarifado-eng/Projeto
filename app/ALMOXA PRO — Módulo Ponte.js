/**
 * ALMOXA PRO — Módulo Ponte
 *
 * Deixa o ALMOXA hospedado fora do Google (ex.: GitHub Pages) conversar com
 * este Core. Hospedado assim, a página deixa de ficar na moldura do Google e
 * a câmera do notebook passa a abrir (leitura de QR e foto do crachá).
 *
 * Não muda nenhuma regra: tudo é encaminhado para as mesmas funções que o
 * google.script.run já chama hoje (almoxaApi e AP_CRACHA_direto).
 *
 * INSTALAÇÃO
 *  1. Crie um arquivo novo no projeto do Apps Script e cole isto.
 *     (Se já existir "function doPost" em outro arquivo, NÃO cole — avise antes.)
 *  2. No início da sua função doGet(e), cole estas duas linhas:
 *        var ponte = PONTE_tratarGet(e);
 *        if (ponte) return ponte;
 *  3. Selecione PONTE_definirChave no menu de funções e clique em Executar.
 *     A chave aparece em "Registro de execução". Guarde-a.
 *  4. Implantar > Gerenciar implantações > editar > Versão: Nova versão.
 *     Executar como: Eu. Quem pode acessar: Qualquer pessoa.
 */

var PONTE_CRACHA_SEM_SESSAO = ['validar', 'autorizar', 'niveis'];

function doPost(e) {
  var resposta;
  try {
    var corpo = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (corpo.ponte !== 'ALMOXA') {
      resposta = { ok: false, codigo: 'NAO_E_PONTE', mensagem: 'Pedido fora do formato da ponte.' };
    } else if (!PONTE_chaveConfere_(corpo.chave)) {
      resposta = { ok: false, codigo: 'CHAVE_INVALIDA', mensagem: 'A chave do aplicativo não confere.' };
    } else {
      resposta = PONTE_encaminhar_(corpo);
    }
  } catch (err) {
    resposta = { ok: false, codigo: 'PONTE_ERRO', mensagem: String((err && err.message) || err) };
  }
  return PONTE_json_(resposta);
}

/** Responde ao teste de conexão (?ponte=ping). Devolve null para qualquer outro GET. */
function PONTE_tratarGet(e) {
  var p = (e && e.parameter) || {};
  if (p.ponte !== 'ping') return null;
  return PONTE_json_({
    ok: true,
    dados: {
      sistema: 'ALMOXA PRO',
      exigeChave: true,
      chaveConfere: PONTE_chaveConfere_(p.chave)
    }
  });
}

function PONTE_encaminhar_(c) {
  var req = {
    modulo: c.modulo,
    acao: c.acao,
    payload: c.payload || {},
    sessao: c.sessao || null,
    perfil: c.perfil || null,
    obra: c.obra || null,
    origem: c.origem || 'ponte',
    ts: Date.now()
  };
  var bruto;
  // Mesmo desvio que a tela faz: leitura de crachá sem sessão vai direto ao módulo do crachá.
  if (req.modulo === 'cracha' && PONTE_CRACHA_SEM_SESSAO.indexOf(req.acao) > -1 && !req.sessao) {
    bruto = AP_CRACHA_direto(JSON.stringify({ acao: req.acao, payload: req.payload }));
  } else {
    bruto = almoxaApi(JSON.stringify(req));
  }
  if (typeof bruto === 'string') {
    try { return JSON.parse(bruto); } catch (x) { return { ok: true, dados: bruto }; }
  }
  return bruto;
}

function PONTE_chaveConfere_(chave) {
  var guardada = PropertiesService.getScriptProperties().getProperty('PONTE_CHAVE') || '';
  // Sem chave definida, a ponte fica fechada.
  return !!guardada && String(chave || '') === guardada;
}

function PONTE_json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Rode uma vez pelo editor. Gera a chave e mostra no registro de execução. */
function PONTE_definirChave() {
  var chave = Utilities.getUuid().replace(/-/g, '').slice(0, 20);
  PropertiesService.getScriptProperties().setProperty('PONTE_CHAVE', chave);
  Logger.log('Chave da ponte: ' + chave);
}
