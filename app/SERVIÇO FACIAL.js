/**
 * ============================================================
 * ALMOXA PRO — CORE
 * 05 · SERVIÇO FACIAL
 * ============================================================
 * Este é o componente que o diagnóstico do aplicativo aponta
 * como faltando: o motor que DETECTA rosto de verdade.
 *
 * O que este arquivo entrega:
 *
 *   biometria.capacidades   diz ao app o que existe configurado
 *   biometria.detectar      detecta rosto com serviço de visão
 *   biometria.reconhecer    comparação 1:1, se configurada
 *
 * ------------------------------------------------------------
 * O QUE ESTÁ IMPLEMENTADO E O QUE NÃO ESTÁ
 *
 * DETECÇÃO — implementada com Google Cloud Vision.
 *   Funciona com chave de API simples. Devolve quantos rostos,
 *   posição, ângulo, e os indicadores de qualidade do próprio
 *   Google. É o que fecha a etapa DETECÇÃO da cadeia.
 *
 * RECONHECIMENTO — NÃO implementado.
 *   O Cloud Vision detecta rosto mas não diz de quem é.
 *   Para comparar identidades seria preciso AWS Rekognition,
 *   que exige assinatura SigV4, ou Azure Face, que exige
 *   aprovação de acesso da Microsoft.
 *
 *   Não implementei porque não conseguiria testar aqui, e
 *   entregar assinatura de requisição sem teste é entregar
 *   algo que falha em produção. A seção 3 explica o caminho.
 *
 * ------------------------------------------------------------
 * ANTES DE LIGAR, DECIDA DUAS COISAS
 *
 * LGPD. Mandar rosto para serviço externo é tratamento de dado
 * biométrico, que a lei trata como sensível. Exige consentimento
 * específico e por escrito de cada colaborador. Não é detalhe
 * burocrático: é o que separa o sistema de um problema jurídico.
 *
 * CUSTO. O Cloud Vision cobra por imagem analisada. As primeiras
 * 1.000 por mês são gratuitas. Num canteiro com muitas retiradas
 * por dia, some rápido. Faça a conta antes.
 * ============================================================
 */

/* ============================================================
   CONFIGURAÇÃO
   A chave vai nas Propriedades do Script, nunca no código
   e nunca no HTML do aplicativo.

   Apps Script > Configurações do projeto > Propriedades do script
     GOOGLE_VISION_API_KEY = sua chave
   ============================================================ */

function AP_Face_chave_() {
  try {
    return PropertiesService.getScriptProperties()
      .getProperty('GOOGLE_VISION_API_KEY') || '';
  } catch (e) { return ''; }
}

function AP_Face_configurado_() {
  return !!AP_Face_chave_();
}

/**
 * biometria.capacidades
 * O aplicativo pergunta isto antes de capturar, para saber
 * o que pode prometer ao usuário.
 */
function AP_Face_capacidades() {
  var temChave = AP_Face_configurado_();

  return AP_Utils_ok({
    detecta: temChave,
    reconhece: false,          /* veja a seção 3 */
    provaDeVida: false,
    servico: temChave ? 'Google Cloud Vision' : null,
    componenteFaltando: temChave
      ? 'serviço de reconhecimento 1:1 — veja a seção 3 do 05_FACE_SERVICE'
      : 'chave do Google Cloud Vision em GOOGLE_VISION_API_KEY',
    custoPorImagem: temChave ? 'primeiras 1.000/mês gratuitas' : null
  }, temChave ? 'Detecção facial disponível.' : 'Nenhum serviço facial configurado.');
}

/**
 * biometria.detectar
 * Detecta rostos na imagem. Esta é a etapa DETECÇÃO.
 *
 * @param p.imagem base64, com ou sem o prefixo data:
 */
function AP_Face_detectar(p) {
  p = p || {};

  var chave = AP_Face_chave_();
  if (!chave) {
    return AP_Utils_erro('SERVICO_NAO_CONFIGURADO',
      'Nenhum serviço de detecção facial está configurado. ' +
      'Cadastre GOOGLE_VISION_API_KEY nas Propriedades do Script.');
  }

  var imagem = String(p.imagem || '');
  if (!imagem) return AP_Utils_erro('SEM_IMAGEM', 'Nenhuma imagem foi enviada.');

  /* tira o prefixo data:image/jpeg;base64, se vier */
  var base64 = imagem.indexOf(',') > -1 ? imagem.split(',')[1] : imagem;
  if (base64.length < 100) {
    return AP_Utils_erro('IMAGEM_INVALIDA', 'A imagem recebida é pequena demais.');
  }

  var corpo = {
    requests: [{
      image: { content: base64 },
      features: [{ type: 'FACE_DETECTION', maxResults: 5 }]
    }]
  };

  var resposta;
  try {
    resposta = UrlFetchApp.fetch(
      'https://vision.googleapis.com/v1/images:annotate?key=' + encodeURIComponent(chave),
      {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(corpo),
        muteHttpExceptions: true
      });
  } catch (e) {
    return AP_Utils_erro('FALHA_NA_CHAMADA',
      'Não foi possível falar com o serviço de visão: ' + e);
  }

  var codigo = resposta.getResponseCode();
  var texto = resposta.getContentText();

  if (codigo !== 200) {
    var detalhe = '';
    try { detalhe = JSON.parse(texto).error.message || ''; } catch (e) {}
    return AP_Utils_erro('SERVICO_RECUSOU',
      'O serviço de visão respondeu ' + codigo + '. ' + detalhe);
  }

  var dados;
  try { dados = JSON.parse(texto); }
  catch (e) { return AP_Utils_erro('RESPOSTA_INVALIDA', 'A resposta do serviço não é JSON.'); }

  var r = (dados.responses && dados.responses[0]) || {};
  if (r.error) {
    return AP_Utils_erro('SERVICO_RECUSOU', r.error.message || 'Erro do serviço.');
  }

  var rostos = r.faceAnnotations || [];

  /* o Google devolve confiança e indicadores úteis */
  var detalhes = rostos.map(function (f) {
    return {
      confianca: Math.round((f.detectionConfidence || 0) * 100),
      inclinacaoLateral: Math.round(f.panAngle || 0),
      inclinacaoVertical: Math.round(f.tiltAngle || 0),
      rotacao: Math.round(f.rollAngle || 0),
      /* VERY_UNLIKELY até VERY_LIKELY */
      borrado: f.blurredLikelihood || 'UNKNOWN',
      subexposto: f.underExposedLikelihood || 'UNKNOWN',
      chapeu: f.headwearLikelihood || 'UNKNOWN',
      caixa: f.boundingPoly ? f.boundingPoly.vertices : null
    };
  });

  /* avisos com base no que o serviço viu */
  var avisos = [];
  if (rostos.length === 0) avisos.push('Nenhum rosto encontrado.');
  if (rostos.length > 1) avisos.push('Mais de um rosto na imagem.');

  if (rostos.length === 1) {
    var f = detalhes[0];
    if (f.confianca < 70) avisos.push('Confiança baixa na detecção: ' + f.confianca + '%.');
    if (Math.abs(f.inclinacaoLateral) > 25) avisos.push('Rosto virado para o lado.');
    if (Math.abs(f.inclinacaoVertical) > 25) avisos.push('Rosto inclinado para cima ou baixo.');
    if (f.borrado === 'LIKELY' || f.borrado === 'VERY_LIKELY') avisos.push('Imagem borrada.');
    if (f.subexposto === 'LIKELY' || f.subexposto === 'VERY_LIKELY') avisos.push('Imagem escura.');
    if (f.chapeu === 'LIKELY' || f.chapeu === 'VERY_LIKELY') avisos.push('Parece haver boné ou capacete.');
  }

  return AP_Utils_ok({
    rostos: rostos.length,
    quantidade: rostos.length,
    detalhes: detalhes,
    avisos: avisos,
    servico: 'Google Cloud Vision',
    etapa: rostos.length > 0 ? 'ROSTO_DETECTADO' : 'SEM_ROSTO'
  }, rostos.length === 1 ? 'Um rosto detectado.'
    : rostos.length === 0 ? 'Nenhum rosto encontrado.'
    : rostos.length + ' rostos encontrados.');
}

/**
 * biometria.reconhecer
 * NÃO IMPLEMENTADO. Devolve isso claramente, sem inventar.
 */
function AP_Face_reconhecer(p) {
  return AP_Utils_erro('RECONHECIMENTO_NAO_CONFIGURADO',
    'A detecção está disponível, mas a comparação de identidade não. ' +
    'O Cloud Vision encontra rostos, não diz de quem são. ' +
    'Veja a seção 3 do arquivo 05_FACE_SERVICE.');
}

/* ============================================================
   SEÇÃO 3 — O QUE FALTA PARA RECONHECIMENTO DE VERDADE
   ============================================================

   O Cloud Vision responde "há um rosto aqui". Ele não responde
   "este rosto é do Ismael". São problemas diferentes.

   Para comparar identidades, os caminhos são:

   AWS REKOGNITION
     CompareFaces compara duas fotos e devolve semelhança.
     IndexFaces + SearchFacesByImage faz busca 1:N numa coleção.
     Obstáculo: a AWS exige assinatura SigV4 em cada requisição,
     que é HMAC-SHA256 encadeado sobre cabeçalhos canônicos.
     Dá para fazer no Apps Script com Utilities.computeHmacSha256Signature,
     mas errar um byte devolve 403 sem explicar onde.

   AZURE FACE
     Verify e Identify resolvem direto, com chave simples no
     cabeçalho, sem assinatura. Mais fácil de implementar.
     Obstáculo: a Microsoft restringiu o acesso ao reconhecimento
     facial. É preciso pedir aprovação e justificar o uso.

   ML KIT NO APK
     Roda no próprio aparelho, sem custo por imagem e sem mandar
     rosto para fora — o que resolve boa parte da questão da LGPD.
     Obstáculo: só funciona no aplicativo nativo, não no navegador.
     A face detection é gratuita; para comparação é preciso
     embutir um modelo de embeddings.

   RECOMENDAÇÃO
     Para o uso do ALMOXA, que é registrar quem retirou material,
     DETECÇÃO mais a foto anexada na ficha já resolve e já é
     prova suficiente. Reconhecimento 1:N faz sentido quando
     houver catraca ou acesso sem operador presente.

   ============================================================ */

/**
 * Teste a configuração. Rode no editor.
 * Não gasta chamada paga: só confere a chave e a conexão.
 */
function AP_Face_diagnostico() {
  var r = {
    chaveConfigurada: AP_Face_configurado_(),
    servico: 'Google Cloud Vision',
    detecta: false,
    reconhece: false,
    avisos: []
  };

  if (!r.chaveConfigurada) {
    r.avisos.push('Cadastre GOOGLE_VISION_API_KEY nas Propriedades do Script.');
    r.avisos.push('Console do Google Cloud > APIs > Cloud Vision API > Ativar > Credenciais.');
    Logger.log(JSON.stringify(r, null, 2));
    Logger.log('>>> FALTA A CHAVE');
    return r;
  }

  /* imagem mínima válida, 1x1 pixel, só para testar a conexão */
  var teste = AP_Face_detectar({
    imagem: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  });

  r.detecta = !!(teste && teste.ok);
  if (!r.detecta) {
    r.avisos.push('A chave existe mas a chamada falhou: ' +
      ((teste && teste.mensagem) || 'sem detalhe'));
    r.avisos.push('Confira se a Cloud Vision API está ativada no projeto da chave.');
  } else {
    r.avisos.push('Detecção funcionando. Reconhecimento 1:1 não está configurado.');
  }

  Logger.log(JSON.stringify(r, null, 2));
  Logger.log(r.detecta ? '>>> DETECÇÃO PRONTA' : '>>> AJUSTAR');
  return r;
}

/* ============================================================
   REGISTRO NO ROTEADOR

     'biometria.capacidades' : AP_Face_capacidades,
     'biometria.detectar'    : AP_Face_detectar,
     'biometria.reconhecer'  : AP_Face_reconhecer

   Depois de registrar e publicar, abra o aplicativo em
   Biometria > Ver a cadeia do reconhecimento facial.
   A linha "Motor facial" deve passar de cinza para verde.
   ============================================================ */
