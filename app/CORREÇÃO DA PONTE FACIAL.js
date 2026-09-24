/**
 * ============================================================
 * ALMOXA PRO — CORE
 * 06 · CORREÇÃO DA PONTE FACIAL
 * ============================================================
 * PROBLEMA QUE ISTO RESOLVE
 *
 * O módulo central trabalha com o campo credencialId.
 * A ponte AP_BIO_instalarPonte monta:
 *
 *     credencialId: payload.referencia || payload.credencialId || ''
 *
 * A digital funciona porque o WebAuthn devolve referencia.
 * O facial chegava sem nenhum dos dois, credencialId ficava
 * vazio, e o Core respondia SEM_LEITURA. Corretamente.
 *
 * DUAS CORREÇÕES, UMA DE CADA LADO
 *
 *   No aplicativo (já feito): o facial passou a enviar
 *   credencialId derivado do modelo do rosto alinhado.
 *
 *   Aqui: a ponte passa a aceitar também payload.credencial
 *   e normaliza tudo para credencialId antes de registrar.
 *
 * O QUE NÃO MUDA
 *   A validação SEM_LEITURA continua existindo.
 *   A digital não é tocada.
 *   Não existe segunda tabela para facial.
 *   Nada retorna sucesso artificial.
 * ============================================================
 */

/**
 * Normaliza o identificador da credencial, venha de onde vier.
 * Esta é a correção do item 8 do diagnóstico.
 */
function AP_Bio_normalizarCredencialId(payload) {
  payload = payload || {};
  return String(
    payload.credencialId ||
    payload.referencia ||
    payload.credencial ||
    ''
  ).trim();
}

/**
 * Ponte corrigida. Substitui o corpo do handler de
 * usuarios.vincularCredencial.
 *
 * Se o seu Core já tem AP_BIO_instalarPonte, troque apenas o
 * trecho que monta credencialId pelo AP_Bio_normalizarCredencialId
 * acima. Esta função é a versão inteira, para quem preferir.
 */
function AP_Bio_ponteVincular(payload, sessao) {
  payload = payload || {};

  var tipo = String(payload.tipo || 'digital').toLowerCase();
  var matricula = String(payload.matricula || '').trim();

  if (!matricula) {
    return AP_Utils_erro('SEM_MATRICULA', 'Informe a matrícula do usuário.');
  }

  var credencialId = AP_Bio_normalizarCredencialId(payload);

  /* Não aceitar silêncio: se chegou vazio, dizer onde parou. */
  if (!credencialId) {
    return AP_Utils_erro('SEM_LEITURA',
      'Credencial ' + tipo + ' não chegou ao Core. ' +
      'O aplicativo precisa enviar credencialId, referencia ou credencial.');
  }

  /* O facial tem exigências próprias antes de virar credencial. */
  if (tipo === 'facial') {
    var conferencia = AP_Bio_conferirFacial_(payload);
    if (!conferencia.ok) return AP_Utils_erro(conferencia.codigo, conferencia.mensagem);
  }

  return AP_Modulo_biometria('registrar', {
    matricula: matricula,
    nome: String(payload.nome || ''),
    tipo: tipo,
    credencialId: credencialId,
    chavePublica: String(payload.chavePublica || ''),
    template: String(payload.template || ''),
    aparelho: String(payload.dispositivo || payload.aparelho || ''),
    plataforma: String(payload.plataforma || ''),
    origem: String(payload.origem || 'SISTEMA'),
    observacao: String(payload.observacao || AP_Bio_resumoLeitura_(payload))
  }, sessao);
}

/**
 * Confere a captura facial antes de virar credencial.
 * Item 11 do diagnóstico: se alguma etapa falhar, não grava.
 */
function AP_Bio_conferirFacial_(p) {
  var l = p.leitura || {};
  var qualidade = Number(p.qualidade || l.qualidade || 0);
  var rostos = (l.rostosDetectados === undefined) ? null : l.rostosDetectados;
  var assinatura = String(p.assinaturaFacial || l.assinatura || '');
  var medidas = l.medidas || {};

  if (!p.imagem && !p.template && !assinatura) {
    return { ok: false, codigo: 'SEM_LEITURA',
      mensagem: 'Nenhuma captura foi enviada.' };
  }
  if (!p.template && (!assinatura || assinatura.length < 32)) {
    return { ok: false, codigo: 'LEITURA_SEM_ANALISE',
      mensagem: 'A captura veio sem a análise do rosto. Atualize o aplicativo.' };
  }
  if (rostos === 0) {
    return { ok: false, codigo: 'SEM_ROSTO', mensagem: 'Nenhum rosto na imagem.' };
  }
  if (rostos > 1) {
    return { ok: false, codigo: 'VARIOS_ROSTOS',
      mensagem: 'Mais de um rosto. Enquadre apenas o colaborador.' };
  }
  if (qualidade && qualidade < 70) {
    return { ok: false, codigo: 'QUALIDADE_BAIXA',
      mensagem: 'Qualidade ' + qualidade + '. O mínimo é 70.' };
  }

  var b = medidas.bordas;
  if (b) {
    var cortado = [];
    if (b.topo > 78) cortado.push('em cima');
    if (b.base > 78) cortado.push('embaixo');
    if (b.esquerda > 78) cortado.push('à esquerda');
    if (b.direita > 78) cortado.push('à direita');
    if (cortado.length) {
      return { ok: false, codigo: 'ROSTO_CORTADO',
        mensagem: 'Rosto cortado ' + cortado.join(' e ') + '.' };
    }
  }

  var c = medidas.centro;
  if (c && (Math.abs(c.y - 50) > 30 || Math.abs(c.x - 50) > 30)) {
    return { ok: false, codigo: 'FORA_DE_CENTRO',
      mensagem: 'O rosto ficou fora do centro do quadro.' };
  }

  return { ok: true };
}

/** Resumo da leitura, sem imagem e sem dado biométrico completo. */
function AP_Bio_resumoLeitura_(p) {
  var l = p.leitura || {};
  var partes = [];
  if (l.motorFacial) partes.push('motor ' + l.motorFacial);
  if (l.rostosDetectados !== undefined && l.rostosDetectados !== null) {
    partes.push(l.rostosDetectados + ' rosto');
  }
  if (l.qualidade) partes.push('qualidade ' + l.qualidade);
  if (p.provaDeVida && p.provaDeVida.ok) partes.push('prova de vida confirmada');
  return partes.join(' · ');
}

/**
 * AP_Facial_diagnosticoCompleto
 * Item 14 do diagnóstico. Rode no editor, sem foto nenhuma.
 * Ele testa o CONTRATO, não a captura.
 */
function AP_Facial_diagnosticoCompleto() {
  var r = {
    ok: false,
    contrato: false,
    credencialId: false,
    core: false,
    armazenamento: false,
    moduloCentral: false,
    faceEngine: false,
    reconhecimentoReal: false,
    erros: [],
    etapas: []
  };

  function etapa(nome, ok, detalhe) {
    r.etapas.push((ok ? '🟢 ' : '🔴 ') + nome + (detalhe ? ' — ' + detalhe : ''));
    if (!ok && detalhe) r.erros.push(nome + ': ' + detalhe);
    return ok;
  }

  /* 1. o módulo central existe? */
  r.moduloCentral = (typeof AP_Modulo_biometria === 'function');
  etapa('MÓDULO CENTRAL', r.moduloCentral,
    r.moduloCentral ? '' : 'AP_Modulo_biometria não encontrado');

  /* 2. a normalização está instalada? */
  r.contrato = (typeof AP_Bio_normalizarCredencialId === 'function');
  etapa('CONTRATO', r.contrato, r.contrato ? '' : 'normalização não instalada');

  /* 3. a normalização pega os três nomes? */
  if (r.contrato) {
    var testes = [
      { credencialId: 'X1' }, { referencia: 'X2' }, { credencial: 'X3' }
    ];
    var todosOk = testes.every(function (t) {
      return AP_Bio_normalizarCredencialId(t).length > 0;
    });
    r.credencialId = todosOk;
    etapa('CREDENCIAL_ID', todosOk,
      todosOk ? 'aceita credencialId, referencia e credencial'
              : 'algum dos três nomes não é reconhecido');

    /* e recusa vazio? */
    var recusaVazio = AP_Bio_normalizarCredencialId({}) === '';
    etapa('RECUSA VAZIO', recusaVazio,
      recusaVazio ? 'payload sem identificador devolve vazio, e a ponte barra'
                  : 'ATENÇÃO: payload vazio não está sendo barrado');
  }

  /* 4. a aba de armazenamento existe? */
  try {
    var ss = AP_Config_getSpreadsheet_();
    var nomes = ['ALMOXA_BIOMETRIA', 'CREDENCIAIS', 'BIOMETRIA'];
    var achada = null;
    nomes.forEach(function (n) { if (!achada && ss.getSheetByName(n)) achada = n; });
    r.armazenamento = !!achada;
    etapa('ARMAZENAMENTO', r.armazenamento,
      achada ? 'aba ' + achada : 'nenhuma aba de biometria encontrada');
  } catch (e) {
    etapa('ARMAZENAMENTO', false, String(e));
  }

  /* 5. o Core responde? */
  try {
    r.core = (typeof AP_Utils_ok === 'function' && typeof AP_Utils_erro === 'function');
    etapa('CORE', r.core, r.core ? '' : 'AP_Utils_ok/erro não encontrados');
  } catch (e) {
    etapa('CORE', false, String(e));
  }

  /* 6. serviço facial externo */
  r.faceEngine = (typeof AP_Face_capacidades === 'function');
  if (r.faceEngine) {
    try {
      var cap = AP_Face_capacidades();
      var d = (cap && cap.dados) || {};
      r.reconhecimentoReal = !!d.reconhece;
      etapa('FACE ENGINE', !!d.detecta,
        d.detecta ? (d.servico || 'configurado') : 'nenhum serviço configurado');
      etapa('RECONHECIMENTO REAL', r.reconhecimentoReal,
        r.reconhecimentoReal ? '' : 'não configurado — o app usa o motor local');
    } catch (e) {
      etapa('FACE ENGINE', false, String(e));
    }
  } else {
    etapa('FACE ENGINE', false, '05_FACE_SERVICE não instalado');
    etapa('RECONHECIMENTO REAL', false, 'depende do FACE ENGINE');
  }

  /* 7. simulação do contrato, sem gravar nada */
  if (r.contrato && r.moduloCentral) {
    var falso = {
      matricula: '__TESTE__', tipo: 'facial',
      credencialId: 'FACE-teste0000000000',
      template: '[]', qualidade: 90,
      leitura: { rostosDetectados: 1, qualidade: 90,
                 assinatura: '0'.repeat(64),
                 medidas: { bordas:{topo:20,base:20,esquerda:20,direita:20},
                            centro:{x:50,y:50} } }
    };
    var conf = AP_Bio_conferirFacial_(falso);
    etapa('VALIDAÇÃO FACIAL', conf.ok,
      conf.ok ? 'um payload completo passa nas regras'
              : 'payload completo foi recusado: ' + conf.codigo);
  }

  r.ok = r.contrato && r.credencialId && r.moduloCentral && r.armazenamento && r.core;

  Logger.log('================================');
  Logger.log('DIAGNÓSTICO FACIAL — CONTRATO');
  Logger.log('================================');
  r.etapas.forEach(function (e) { Logger.log(e); });
  Logger.log('');
  Logger.log(r.ok ? '>>> CONTRATO OK. O facial pode chegar ao Core.'
                  : '>>> AJUSTAR: ' + r.erros.join(' | '));
  return r;
}

/* ============================================================
   COMO APLICAR A CORREÇÃO MÍNIMA

   Se o seu Core já tem AP_BIO_instalarPonte, NÃO troque a ponte
   inteira. Procure a linha que monta credencialId:

       credencialId: payload.referencia || payload.credencialId || ''

   e troque por:

       credencialId: AP_Bio_normalizarCredencialId(payload)

   É uma linha. O resto deste arquivo é a versão completa e o
   diagnóstico, para quem quiser.

   Depois rode AP_Facial_diagnosticoCompleto() no editor.
   ============================================================ */
