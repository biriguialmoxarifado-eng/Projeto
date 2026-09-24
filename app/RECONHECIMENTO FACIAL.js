/**
 * ============================================================
 * ALMOXA PRO — CORE
 * 04 · RECONHECIMENTO FACIAL
 * ============================================================
 * Trata a captura de ROSTO feita pela câmera.
 * Depende do 02_BIOMETRIA_BASE.
 *
 * O QUE CHEGA DO APLICATIVO
 *   imagem      foto em base64, usada só para conferir agora
 *   assinatura  64 bits que descrevem o padrão de claro e escuro
 *   qualidade   nota de 0 a 100
 *   medidas     luz, nitidez, contraste, bordas, centro do rosto
 *   rostos      quantos rostos o navegador encontrou
 *
 * O QUE É GRAVADO
 *   assinatura, qualidade e o resumo. A foto NÃO é gravada.
 *
 * ------------------------------------------------------------
 * O QUE ESTE MÓDULO É, E O QUE NÃO É
 *
 * A assinatura é uma impressão da IMAGEM, não do ROSTO.
 * Ela reconhece a mesma foto e fotos muito parecidas, tiradas
 * no mesmo lugar e com a mesma luz.
 *
 * Ela NÃO é reconhecimento facial de verdade. Mudou o cabelo,
 * a barba, a luz ou o fundo, a assinatura muda. Duas pessoas
 * diferentes no mesmo fundo podem ficar parecidas.
 *
 * Serve bem para: confirmar que houve captura de rosto real,
 * registrar quem recebeu, e travar cadastro duplicado.
 *
 * Não serve para: identificar alguém entre muitos, ou como
 * única barreira de segurança.
 *
 * Para reconhecimento facial de verdade, o caminho é um serviço
 * externo. A seção no fim explica onde encaixar.
 * ============================================================
 */

/* Distância de Hamming aceita. Quanto menor, mais rígido. */
var AP_FACIAL_TOLERANCIA_CADASTRO = 6;    /* duplicado */
var AP_FACIAL_TOLERANCIA_LOGIN = 10;      /* conferência */
var AP_FACIAL_QUALIDADE_MINIMA = 70;

/**
 * usuarios.vincularCredencial com tipo facial.
 * Chamado pela base.
 */
function AP_Facial_cadastrar(p) {
  p = p || {};
  var l = p.leitura || {};

  var assinatura = String(p.assinaturaFacial || l.assinatura || '').trim();
  var qualidade = Number(p.qualidade || l.qualidade || 0);
  var rostos = (l.rostosDetectados === undefined) ? null : l.rostosDetectados;
  var medidas = l.medidas || {};

  /* ---- a captura aconteceu? ---- */
  if (!p.imagem && !assinatura) {
    return AP_Utils_erro('SEM_LEITURA',
      'Nenhuma captura foi enviada. Abra a câmera e capture o rosto.');
  }
  if (!assinatura || assinatura.length < 32) {
    return AP_Utils_erro('LEITURA_SEM_ANALISE',
      'A captura veio sem a análise do rosto. Atualize o aplicativo.');
  }

  /* ---- a captura presta? ---- */
  if (rostos === 0) {
    return AP_Utils_erro('SEM_ROSTO', 'Nenhum rosto foi encontrado na foto.');
  }
  if (rostos > 1) {
    return AP_Utils_erro('VARIOS_ROSTOS',
      'Mais de um rosto na foto. Enquadre apenas o colaborador.');
  }
  if (qualidade && qualidade < AP_FACIAL_QUALIDADE_MINIMA) {
    return AP_Utils_erro('QUALIDADE_BAIXA',
      'A foto ficou com qualidade ' + qualidade + '. O mínimo é ' +
      AP_FACIAL_QUALIDADE_MINIMA + '. Melhore a luz, centralize e evite tremer.');
  }

  var corte = AP_Facial_conferirEnquadramento_(medidas);
  if (!corte.ok) return AP_Utils_erro(corte.codigo, corte.mensagem);

  /* ---- este rosto já é de outra pessoa? ---- */
  var conflito = AP_Facial_procurar_(assinatura, p.matricula, AP_FACIAL_TOLERANCIA_CADASTRO);
  if (conflito) {
    return AP_Utils_erro('ROSTO_DE_OUTRO',
      'Esta captura é muito parecida com a de ' + conflito.nome +
      ', matrícula ' + conflito.matricula + '.');
  }

  var r = AP_Bio_gravar_({
    matricula: p.matricula, nome: p.nome, tipo: 'facial',
    credencial: 'FACE-' + assinatura.slice(0, 16),
    aparelho: p.aparelho, apelido: p.apelido,
    qualidade: qualidade || '', assinatura: assinatura,
    origem: p.origem,
    observacao: 'Câmera · ' +
      (l.detectorNativo ? 'detector do navegador' : 'análise da imagem') +
      (rostos !== null ? ' · ' + rostos + ' rosto' : '') +
      (medidas.brilho ? ' · luz ' + medidas.brilho : '') +
      (medidas.nitidez ? ' · nitidez ' + medidas.nitidez : '')
  });

  return AP_Utils_ok({
    id: r.id, tipo: 'facial', qualidade: qualidade,
    status: 'Ativa', criadoEm: r.criadoEm.toISOString(),
    comparacao: 'assinatura de imagem'
  }, 'Rosto cadastrado.');
}

/** Confere se o rosto está cortado ou fora do centro. */
function AP_Facial_conferirEnquadramento_(m) {
  var b = m.bordas || null;
  var c = m.centro || null;

  if (b) {
    var cortado = [];
    if (b.topo > 45) cortado.push('em cima');
    if (b.base > 45) cortado.push('embaixo');
    if (b.esquerda > 45) cortado.push('à esquerda');
    if (b.direita > 45) cortado.push('à direita');
    if (cortado.length) {
      return { ok: false, codigo: 'ROSTO_CORTADO',
        mensagem: 'O rosto está cortado ' + cortado.join(' e ') +
                  '. Afaste o celular e capture de novo.' };
    }
  }

  if (c) {
    if (Math.abs(c.y - 50) > 22) {
      return { ok: false, codigo: 'FORA_DE_CENTRO',
        mensagem: c.y < 50 ? 'O rosto ficou alto demais no quadro.'
                           : 'O rosto ficou baixo demais no quadro.' };
    }
    if (Math.abs(c.x - 50) > 22) {
      return { ok: false, codigo: 'FORA_DE_CENTRO',
        mensagem: 'O rosto ficou para o lado. Centralize no círculo.' };
    }
  }

  return { ok: true };
}

/**
 * Procura uma assinatura parecida.
 * @param ignorarMatricula quando informada, pula essa pessoa
 */
function AP_Facial_procurar_(assinatura, ignorarMatricula, tolerancia) {
  var atual = String(ignorarMatricula || '').replace(/^0+/, '');
  var achado = null;
  var menorDiferenca = 999;

  AP_Bio_ativas_().forEach(function (c) {
    if (c.tipo !== 'facial' || !c.assinatura) return;
    if (c.assinatura.length !== assinatura.length) return;
    if (atual && String(c.matricula).replace(/^0+/, '') === atual) return;

    var difere = 0;
    for (var i = 0; i < assinatura.length; i++) {
      if (c.assinatura[i] !== assinatura[i]) difere++;
    }
    if (difere <= tolerancia && difere < menorDiferenca) {
      menorDiferenca = difere;
      achado = { matricula: c.matricula, nome: c.nome, id: c.id,
                 linha: c.linha, diferenca: difere };
    }
  });

  return achado;
}

/**
 * auth.verificarFacial
 * Confere uma captura contra os rostos cadastrados.
 */
function AP_Facial_verificar(p) {
  p = p || {};
  var l = p.leitura || {};
  var assinatura = String(p.assinaturaFacial || l.assinatura || p.assinatura || '').trim();

  if (!assinatura || assinatura.length < 32) {
    return AP_Utils_erro('SEM_LEITURA',
      'Nenhuma captura analisada foi enviada.');
  }

  var qualidade = Number(p.qualidade || l.qualidade || 0);
  if (qualidade && qualidade < 55) {
    return AP_Utils_erro('QUALIDADE_BAIXA',
      'A captura ficou com qualidade ' + qualidade + '. Tente num lugar mais claro.');
  }

  var achado = AP_Facial_procurar_(assinatura, null, AP_FACIAL_TOLERANCIA_LOGIN);

  if (!achado) {
    return AP_Utils_erro('NAO_RECONHECIDO',
      'Nenhum rosto cadastrado corresponde a esta captura.');
  }

  /* quando o app diz de quem deveria ser, confira */
  if (p.matricula) {
    var esperada = String(p.matricula).replace(/^0+/, '');
    var veio = String(achado.matricula).replace(/^0+/, '');
    if (esperada !== veio) {
      return AP_Utils_erro('ROSTO_DE_OUTRO',
        'Este rosto está cadastrado para outra matrícula.');
    }
  }

  AP_Bio_marcarUso_(achado.linha);

  return AP_Utils_ok({
    matricula: achado.matricula,
    nome: achado.nome,
    tipo: 'facial',
    credencial: achado.id,
    diferenca: achado.diferenca,
    confianca: Math.max(0, Math.round((1 - achado.diferenca / 64) * 100)),
    comparacao: 'assinatura de imagem',
    aviso: 'Comparação por padrão de imagem, não por reconhecimento facial.'
  }, 'Identificado: ' + achado.nome + '.');
}

/**
 * ONDE ENCAIXAR RECONHECIMENTO FACIAL DE VERDADE
 *
 * Quando quiser trocar a comparação por assinatura de imagem por
 * reconhecimento facial de verdade, o ponto é esta função.
 *
 * O caminho é chamar um serviço externo com UrlFetchApp,
 * mandando a foto, e receber um vetor de características do
 * rosto. Aí a comparação passa a ser por distância entre vetores,
 * que sobrevive a mudança de luz, cabelo e barba.
 *
 * Serviços que fazem isso: AWS Rekognition, Azure Face,
 * Google Cloud Vision. Todos são pagos e exigem chave.
 *
 * A chave NÃO pode ficar no HTML do aplicativo. Ela fica aqui,
 * nas Propriedades do Script, e só o Core a usa.
 *
 * Duas coisas a decidir antes:
 *   · guardar rosto em serviço externo é tratamento de dado
 *     biométrico, e a LGPD exige consentimento por escrito
 *   · custo por chamada, que num canteiro com muitas retiradas
 *     por dia deixa de ser desprezível
 */
function AP_Facial_reconhecerExterno_(imagemBase64) {
  return { ok: false, motivo: 'NAO_CONFIGURADO',
    mensagem: 'Nenhum serviço de reconhecimento facial foi configurado.' };
}

/** Confere o módulo. Rode no editor. */
function AP_Facial_diagnostico() {
  var r = {
    base: (typeof AP_Bio_ativas_ === 'function'),
    rostosCadastrados: 0,
    qualidadeMedia: 0,
    servicoExterno: false,
    avisos: []
  };

  if (!r.base) {
    r.avisos.push('Instale o 02_BIOMETRIA_BASE primeiro.');
    Logger.log(JSON.stringify(r, null, 2));
    return r;
  }

  var faciais = AP_Bio_ativas_().filter(function (c) { return c.tipo === 'facial'; });
  r.rostosCadastrados = faciais.length;

  if (faciais.length) {
    var soma = faciais.reduce(function (s, c) { return s + (Number(c.qualidade) || 0); }, 0);
    r.qualidadeMedia = Math.round(soma / faciais.length);
  }

  r.avisos.push('A comparação é por assinatura de imagem, não por reconhecimento facial.');
  r.avisos.push('Tolerância de cadastro: ' + AP_FACIAL_TOLERANCIA_CADASTRO +
                ' bits · de conferência: ' + AP_FACIAL_TOLERANCIA_LOGIN + ' bits.');

  Logger.log(JSON.stringify(r, null, 2));
  return r;
}

/* ============================================================
   REGISTRO NO ROTEADOR

     'auth.verificarFacial' : AP_Facial_verificar

   O cadastro entra pelo usuarios.vincularCredencial da base.
   ============================================================ */
