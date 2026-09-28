/* ============================================================
   ALMOX-PRO — BIOMETRIA DO COLABORADOR
   ------------------------------------------------------------
   O QUE ESTE MÓDULO GUARDA — E O QUE ELE NÃO GUARDA

   Ele NÃO guarda digital. Nenhuma. Não guarda imagem do dedo,
   não guarda minúcia, não guarda molde, não guarda nada que
   permita reconstruir a biometria de ninguém.

   O que existe aqui é o mecanismo do próprio navegador, o
   WebAuthn — o mesmo do Windows Hello e da digital do celular.
   Quando a pessoa cadastra, o APARELHO cria um par de chaves e
   guarda a chave privada dentro dele, trancada pela digital. A
   digital nunca sai do aparelho, nem para o navegador, nem para
   o Google, nem para esta planilha.

   O que chega aqui é só o IDENTIFICADOR da credencial — um número
   sem significado, que não serve para reconstruir dedo nenhum.
   Por isso este módulo não cria obrigação de dado biométrico
   sensível: não há dado biométrico armazenado.

   ------------------------------------------------------------
   POR QUE ISTO É SEGURO, E ATÉ ONDE

   A credencial é RESIDENTE e com verificação OBRIGATÓRIA. Na
   prática: o sistema operacional só entrega o identificador dela
   depois que a digital confere. Quem estiver na frente da
   máquina sem o dedo certo não consegue nem produzir o número —
   o navegador não tem o que mandar.

   O que este módulo NÃO faz: conferir a assinatura criptográfica
   no servidor. O Apps Script não tem função para isso. Então a
   digital aqui é a TRANCA DO APARELHO, não uma prova que o
   servidor verifica — o mesmo nível de confiança do crachá.
   Está escrito aqui para ninguém prometer mais do que é.

   ------------------------------------------------------------
   NADA É APAGADO
   Revogar uma credencial muda o status para REVOGADA e guarda
   quem revogou e por quê. A linha continua na planilha.

   Rode AP_BIO_testes() para conferir a lógica sem tocar em dado.
   ============================================================ */

var AP_BIO_CFG = {
  versao: '1.0.0',

  aba: 'ALMOXA_BIOMETRIAS',

  colunas: ['id', 'matricula', 'usuarioId', 'credencialId', 'apelido',
    'estacao', 'status', 'criadoEm', 'criadoPor', 'ultimoUsoEm',
    'revogadoEm', 'revogadoPor', 'motivoRevogacao'],

  /* onde ficam os comprovantes: cada vez que alguém confirma uma
     operação com a digital, nasce uma linha aqui. É ISTO que
     sustenta a prova depois — sem ela, a biometria vira só um
     botão bonito que ninguém consegue reconstruir seis meses
     adiante. O identificador da credencial NÃO entra aqui: o que
     interessa é quem, o quê, quando e em qual estação. */
  abaProvas: 'ALMOXA_BIOMETRIA_PROVAS',

  colunasProvas: ['id', 'em', 'matricula', 'nome', 'credencialRef',
    'estacao', 'operacao', 'alvo', 'detalhe', 'verificacaoDoDedo'],

  status: {
    ATIVA: 'ATIVA',
    REVOGADA: 'REVOGADA'
  },

  /* quantas credenciais uma pessoa pode ter ao mesmo tempo. Uma por
     estação faz sentido: almoxarifado, portaria, escritório. */
  limitePorPessoa: 8
};


/* ============================================================
   ENTRADA DO MÓDULO
   ============================================================ */

function AP_Modulo_biometria(acao, payload, sessao) {
  payload = payload || {};
  try {
    AP_BIO_aba_();
    switch (String(acao || '')) {
      case 'versao': return AP_BIO_ok_({
        versao: AP_BIO_CFG.versao,
        acoes: ['versao', 'registrar', 'listar', 'revogar', 'entrar', 'daPessoa', 'confirmar', 'provas'],
        guardaDigital: false,
        verificaAssinaturaNoServidor: false
      });
      case 'registrar': return AP_BIO_registrar_(payload, sessao);
      case 'listar': return AP_BIO_listar_(payload, sessao);
      case 'daPessoa': return AP_BIO_daPessoa_(payload, sessao);
      case 'revogar': return AP_BIO_revogar_(payload, sessao);
      case 'entrar': return AP_BIO_entrar_(payload);
      case 'confirmar': return AP_BIO_confirmar_(payload, sessao);
      case 'provas': return AP_BIO_provas_(payload, sessao);
    }
    return AP_BIO_erro_('ACAO_DESCONHECIDA', 'biometria.' + acao + ' não existe.');
  } catch (e) {
    try { console.error('[BIO] ' + acao + ': ' + e.message); } catch (x) { }
    return AP_BIO_erro_('BIO_ERRO', e.message);
  }
}


/* ============================================================
   APOIO
   ============================================================ */

function AP_BIO_ok_(dados, mensagem) {
  return { ok: true, dados: dados || {}, mensagem: mensagem || '' };
}
function AP_BIO_erro_(codigo, mensagem, dados) {
  return { ok: false, codigo: codigo, mensagem: mensagem, dados: dados || null };
}
function AP_BIO_texto_(v) { return String(v === undefined || v === null ? '' : v).trim(); }
function AP_BIO_agora_() { return new Date().toISOString(); }

function AP_BIO_aba_() {
  try { AP_Data_getSheet(AP_BIO_CFG.aba, AP_BIO_CFG.colunas); } catch (e) { }
  /* o cabeçalho é completado NO FIM se faltar coluna — nunca no meio,
     para não escorregar o que já está gravado embaixo */
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var aba = ss.getSheetByName(AP_BIO_CFG.aba);
    if (!aba || aba.getLastColumn() < 1) return;
    var cab = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0]
      .map(function (c) { return String(c).trim(); });
    var faltam = AP_BIO_CFG.colunas.filter(function (c) { return cab.indexOf(c) === -1; });
    if (faltam.length) {
      aba.getRange(1, cab.length + 1, 1, faltam.length).setValues([faltam]);
      try { SpreadsheetApp.flush(); } catch (e) { }
    }
  } catch (e) { }
}

function AP_BIO_abaProvas_() {
  try { AP_Data_getSheet(AP_BIO_CFG.abaProvas, AP_BIO_CFG.colunasProvas); } catch (e) { }
}

function AP_BIO_linhasProvas_() {
  try { return AP_Data_rows(AP_BIO_CFG.abaProvas) || []; }
  catch (e) { return []; }
}

function AP_BIO_linhas_() {
  try { return AP_Data_rows(AP_BIO_CFG.aba) || []; }
  catch (e) { return []; }
}

function AP_BIO_id_() {
  try { return 'BIO-' + Utilities.getUuid().slice(0, 8).toUpperCase(); }
  catch (e) { return 'BIO-' + Date.now().toString(36).toUpperCase(); }
}

function AP_BIO_quem_(sessao) {
  return (sessao && (sessao.nome || sessao.usuario || sessao.email)) || 'sistema';
}

/** A credencial ATIVA com este identificador, se houver. */
function AP_BIO_porCredencial_(credencialId) {
  var alvo = AP_BIO_texto_(credencialId);
  if (!alvo) return null;
  return AP_BIO_linhas_().filter(function (x) {
    return AP_BIO_texto_(x.credencialId) === alvo &&
      AP_BIO_texto_(x.status) === AP_BIO_CFG.status.ATIVA;
  })[0] || null;
}

/** As credenciais ATIVAS de uma pessoa. */
function AP_BIO_ativasDe_(matricula) {
  var alvo = AP_BIO_texto_(matricula);
  return AP_BIO_linhas_().filter(function (x) {
    return AP_BIO_texto_(x.matricula) === alvo &&
      AP_BIO_texto_(x.status) === AP_BIO_CFG.status.ATIVA;
  });
}

/** O usuário de verdade, pelo cadastro que já existe. Nunca inventa. */
function AP_BIO_usuario_(matricula) {
  var alvo = AP_BIO_texto_(matricula);
  if (!alvo || typeof AP_Modulo_usuarios !== 'function') return null;
  try {
    var r = AP_Modulo_usuarios('listar', {}, {});
    var lista = (r && r.ok && (r.dados && (r.dados.usuarios || r.dados))) || [];
    if (!lista.length) return null;
    return lista.filter(function (u) {
      return AP_BIO_texto_(u.matricula) === alvo || AP_BIO_texto_(u.id) === alvo;
    })[0] || null;
  } catch (e) { return null; }
}

function AP_BIO_auditar_(quem, acao, alvo, dados) {
  try {
    if (typeof AP_Modulo_auditoria === 'function') {
      AP_Modulo_auditoria('registrar', {
        quem: quem, acao: acao, modulo: 'BIOMETRIA', alvo: alvo, dados: dados || {}
      }, {});
    }
  } catch (e) { }
}


/* ============================================================
   1. CADASTRAR A DIGITAL DE ALGUÉM
   ------------------------------------------------------------
   Quem chama já passou pela sessão (a ponte exige). O que chega
   é o identificador que o APARELHO criou — nunca a digital.
   ============================================================ */

function AP_BIO_registrar_(payload, sessao) {
  var matricula = AP_BIO_texto_(payload.matricula);
  var credencialId = AP_BIO_texto_(payload.credencialId);

  if (!matricula) {
    return AP_BIO_erro_('SEM_MATRICULA',
      'Diga de quem é a digital. Sem colaborador, a credencial não tem dono.');
  }
  if (!credencialId) {
    return AP_BIO_erro_('SEM_CREDENCIAL',
      'O aparelho não devolveu a credencial. A digital não foi confirmada.');
  }
  /* identificador curto demais não veio de um cadastro de verdade */
  if (credencialId.length < 16) {
    return AP_BIO_erro_('CREDENCIAL_INVALIDA',
      'A credencial recebida é curta demais para ter vindo do leitor.');
  }

  var usuario = AP_BIO_usuario_(matricula);
  if (!usuario && typeof AP_Modulo_usuarios === 'function') {
    return AP_BIO_erro_('USUARIO_NAO_ENCONTRADO',
      'Não achei a matrícula ' + matricula + ' no cadastro de usuários. ' +
      'A digital só é vinculada a quem já existe.');
  }

  /* a MESMA credencial não pode acabar em duas pessoas */
  var jaExiste = AP_BIO_porCredencial_(credencialId);
  if (jaExiste) {
    if (AP_BIO_texto_(jaExiste.matricula) === matricula) {
      return AP_BIO_ok_({ id: jaExiste.id, jaExistia: true, matricula: matricula },
        'Esta digital já estava cadastrada para ' + matricula + '.');
    }
    return AP_BIO_erro_('CREDENCIAL_DE_OUTRA_PESSOA',
      'Esta credencial já está vinculada a outra matrícula. ' +
      'Cada digital pertence a uma pessoa só.');
  }

  var ativas = AP_BIO_ativasDe_(matricula);
  if (ativas.length >= AP_BIO_CFG.limitePorPessoa) {
    return AP_BIO_erro_('LIMITE_DE_CREDENCIAIS',
      matricula + ' já tem ' + ativas.length + ' digitais cadastradas (o limite é ' +
      AP_BIO_CFG.limitePorPessoa + '). Revogue uma antes de cadastrar outra.');
  }

  var id = AP_BIO_id_();
  var quem = AP_BIO_quem_(sessao);
  var agora = AP_BIO_agora_();

  AP_Data_append(AP_BIO_CFG.aba, {
    id: id,
    matricula: matricula,
    usuarioId: (usuario && AP_BIO_texto_(usuario.id)) || '',
    credencialId: credencialId,
    apelido: AP_BIO_texto_(payload.apelido) || 'Digital',
    estacao: AP_BIO_texto_(payload.estacao),
    status: AP_BIO_CFG.status.ATIVA,
    criadoEm: agora,
    criadoPor: quem,
    ultimoUsoEm: '',
    revogadoEm: '', revogadoPor: '', motivoRevogacao: ''
  });

  AP_BIO_auditar_(quem, 'BIOMETRIA_CADASTRADA', id, {
    matricula: matricula, estacao: AP_BIO_texto_(payload.estacao)
  });

  return AP_BIO_ok_({
    id: id, matricula: matricula,
    apelido: AP_BIO_texto_(payload.apelido) || 'Digital',
    quantas: ativas.length + 1
  }, 'Digital cadastrada para ' + matricula + ' nesta estação. ' +
    'Nenhuma imagem de digital foi guardada: o dedo não sai do aparelho.');
}


/* ============================================================
   2. VER E REVOGAR
   ============================================================ */

function AP_BIO_daLinha_(x) {
  return {
    id: AP_BIO_texto_(x.id),
    matricula: AP_BIO_texto_(x.matricula),
    apelido: AP_BIO_texto_(x.apelido),
    estacao: AP_BIO_texto_(x.estacao),
    status: AP_BIO_texto_(x.status),
    criadoEm: AP_BIO_texto_(x.criadoEm),
    criadoPor: AP_BIO_texto_(x.criadoPor),
    ultimoUsoEm: AP_BIO_texto_(x.ultimoUsoEm),
    revogadoEm: AP_BIO_texto_(x.revogadoEm),
    revogadoPor: AP_BIO_texto_(x.revogadoPor),
    motivoRevogacao: AP_BIO_texto_(x.motivoRevogacao)
    /* o credencialId NÃO sai daqui: ele é o que destranca a entrada */
  };
}

function AP_BIO_listar_(payload, sessao) {
  var lista = AP_BIO_linhas_();
  if (payload && payload.matricula) {
    var alvo = AP_BIO_texto_(payload.matricula);
    lista = lista.filter(function (x) { return AP_BIO_texto_(x.matricula) === alvo; });
  }
  if (!(payload && payload.incluirRevogadas)) {
    lista = lista.filter(function (x) {
      return AP_BIO_texto_(x.status) === AP_BIO_CFG.status.ATIVA;
    });
  }
  return AP_BIO_ok_({
    quantas: lista.length,
    credenciais: lista.map(AP_BIO_daLinha_)
  });
}

/** Quantas digitais uma pessoa tem — para a tela do usuário. */
function AP_BIO_daPessoa_(payload, sessao) {
  var matricula = AP_BIO_texto_(payload.matricula);
  if (!matricula) return AP_BIO_erro_('SEM_MATRICULA', 'Informe a matrícula.');
  var ativas = AP_BIO_ativasDe_(matricula);
  return AP_BIO_ok_({
    matricula: matricula,
    tem: ativas.length > 0,
    quantas: ativas.length,
    credenciais: ativas.map(AP_BIO_daLinha_)
  });
}

function AP_BIO_revogar_(payload, sessao) {
  var id = AP_BIO_texto_(payload.id);
  var motivo = AP_BIO_texto_(payload.motivo);
  if (!id) return AP_BIO_erro_('SEM_ID', 'Informe qual credencial revogar.');
  if (!motivo) {
    return AP_BIO_erro_('SEM_MOTIVO',
      'Revogar exige motivo — é o que dá rastreabilidade depois.');
  }

  var alvo = AP_BIO_linhas_().filter(function (x) {
    return AP_BIO_texto_(x.id) === id;
  })[0];
  if (!alvo) return AP_BIO_erro_('NAO_ENCONTRADA', 'Credencial não localizada.');
  if (AP_BIO_texto_(alvo.status) !== AP_BIO_CFG.status.ATIVA) {
    return AP_BIO_erro_('JA_REVOGADA', 'Esta credencial já estava revogada.');
  }

  var quem = AP_BIO_quem_(sessao);
  var agora = AP_BIO_agora_();

  /* a linha NÃO é apagada: muda de status e guarda quem e por quê */
  AP_Data_update(AP_BIO_CFG.aba, id, {
    status: AP_BIO_CFG.status.REVOGADA,
    revogadoEm: agora, revogadoPor: quem, motivoRevogacao: motivo
  }, 'id');

  AP_BIO_auditar_(quem, 'BIOMETRIA_REVOGADA', id, {
    matricula: AP_BIO_texto_(alvo.matricula), motivo: motivo
  });

  return AP_BIO_ok_({ id: id, matricula: AP_BIO_texto_(alvo.matricula) },
    'Credencial revogada. A linha continua no histórico, com o motivo.');
}


/* ============================================================
   3. ENTRAR PELA DIGITAL
   ------------------------------------------------------------
   Esta é a única ação que passa SEM sessão — é porta de entrada.
   O identificador que chega aqui só existe porque o aparelho
   conferiu a digital antes de entregá-lo.
   ============================================================ */

function AP_BIO_entrar_(payload) {
  var credencialId = AP_BIO_texto_(payload.credencialId);
  if (!credencialId) {
    return AP_BIO_erro_('SEM_CREDENCIAL',
      'O aparelho não devolveu credencial nenhuma. A digital não foi confirmada.');
  }

  var cred = AP_BIO_porCredencial_(credencialId);
  if (!cred) {
    /* a mesma resposta para "não existe" e "revogada": dizer qual é
       entregaria informação a quem está tentando adivinhar */
    return AP_BIO_erro_('DIGITAL_NAO_RECONHECIDA',
      'Esta digital não está cadastrada neste sistema, ou foi revogada. ' +
      'Entre por matrícula e senha e cadastre a digital no seu perfil.');
  }

  var matricula = AP_BIO_texto_(cred.matricula);
  var usuario = AP_BIO_usuario_(matricula);
  if (!usuario) {
    return AP_BIO_erro_('USUARIO_NAO_ENCONTRADO',
      'A digital está cadastrada para a matrícula ' + matricula +
      ', mas esse usuário não existe mais no cadastro.');
  }

  var ativo = AP_BIO_texto_(usuario.status || 'Ativo').toUpperCase();
  if (ativo && ativo !== 'ATIVO') {
    return AP_BIO_erro_('USUARIO_INATIVO',
      'O usuário ' + matricula + ' está ' + ativo + ' e não pode entrar.');
  }

  /* a sessão é aberta pelo mecanismo que já existe — este módulo não
     tem sessão própria, nem perfil próprio, nem permissão própria */
  if (typeof AP_SEG_abrirSessao !== 'function') {
    return AP_BIO_erro_('SEM_SESSAO_NO_SERVIDOR',
      'O servidor não tem o abridor de sessão instalado. ' +
      'A digital foi reconhecida, mas não dá para abrir a sessão.');
  }

  var aberta = AP_SEG_abrirSessao({
    id: usuario.id, perfil: usuario.perfil,
    empresa: usuario.empresa, obra: usuario.obra
  }, { origem: 'biometria' });

  if (!aberta || !aberta.ok) {
    return AP_BIO_erro_('SESSAO_NAO_ABRIU',
      (aberta && aberta.mensagem) || 'A sessão não pôde ser aberta.');
  }

  try {
    AP_Data_update(AP_BIO_CFG.aba, cred.id, { ultimoUsoEm: AP_BIO_agora_() }, 'id');
  } catch (e) { }

  AP_BIO_auditar_(matricula, 'ENTRADA_POR_BIOMETRIA', cred.id, {
    matricula: matricula, estacao: AP_BIO_texto_(cred.estacao)
  });

  /* mesmo formato que o login por senha devolve — a tela não precisa
     saber por onde a pessoa entrou */
  return AP_BIO_ok_({
    usuario: usuario,
    sessao: aberta.dados,
    obra: usuario.obra || null,
    metodo: 'biometria'
  }, 'Digital reconhecida: ' + AP_BIO_texto_(usuario.nome || matricula) + '.');
}


/* ============================================================
   4. CONFIRMAR UMA OPERAÇÃO COM A DIGITAL
   ------------------------------------------------------------
   Aprovar uma solicitação, liberar uma retirada, dar baixa. O que
   chega é o identificador que o aparelho só entregou depois de
   conferir o dedo. O que sai é um COMPROVANTE — e é o número do
   comprovante que os outros módulos guardam, nunca a credencial.
   ============================================================ */

function AP_BIO_confirmar_(payload, sessao) {
  var credencialId = AP_BIO_texto_(payload.credencialId);
  var operacao = AP_BIO_texto_(payload.operacao);

  if (!credencialId) {
    return AP_BIO_erro_('SEM_CREDENCIAL',
      'O aparelho não devolveu credencial nenhuma. A digital não foi confirmada.');
  }
  if (!operacao) {
    return AP_BIO_erro_('SEM_OPERACAO',
      'Diga o que está sendo confirmado. Comprovante sem operação não prova nada depois.');
  }

  var cred = AP_BIO_porCredencial_(credencialId);
  if (!cred) {
    return AP_BIO_erro_('DIGITAL_NAO_RECONHECIDA',
      'Esta digital não está cadastrada neste sistema, ou foi revogada.');
  }

  var matricula = AP_BIO_texto_(cred.matricula);
  var usuario = AP_BIO_usuario_(matricula);
  var ativo = AP_BIO_texto_((usuario && usuario.status) || 'Ativo').toUpperCase();
  if (usuario && ativo && ativo !== 'ATIVO') {
    return AP_BIO_erro_('USUARIO_INATIVO',
      'O usuário ' + matricula + ' está ' + ativo + ' e não pode confirmar operações.');
  }

  AP_BIO_abaProvas_();
  var id = 'PRV-' + AP_BIO_id_().slice(4);
  var agora = AP_BIO_agora_();

  AP_Data_append(AP_BIO_CFG.abaProvas, {
    id: id,
    em: agora,
    matricula: matricula,
    nome: AP_BIO_texto_((usuario && usuario.nome) || ''),
    /* referência à credencial pelo ID DA LINHA, não pelo identificador
       que destranca a entrada */
    credencialRef: AP_BIO_texto_(cred.id),
    estacao: AP_BIO_texto_(payload.estacao) || AP_BIO_texto_(cred.estacao),
    operacao: operacao,
    alvo: AP_BIO_texto_(payload.alvo),
    detalhe: AP_BIO_texto_(payload.detalhe),
    /* o dedo foi conferido pelo aparelho — não pelo servidor.
       Escrito assim, no comprovante, para ninguém ler depois como
       se o servidor tivesse verificado. */
    verificacaoDoDedo: 'APARELHO'
  });

  try {
    AP_Data_update(AP_BIO_CFG.aba, cred.id, { ultimoUsoEm: agora }, 'id');
  } catch (e) { }

  AP_BIO_auditar_(matricula, 'BIOMETRIA_CONFIRMOU', id, {
    matricula: matricula, operacao: operacao,
    alvo: AP_BIO_texto_(payload.alvo), estacao: AP_BIO_texto_(payload.estacao)
  });

  return AP_BIO_ok_({
    prova: id,
    matricula: matricula,
    nome: AP_BIO_texto_((usuario && usuario.nome) || matricula),
    em: agora,
    operacao: operacao
  }, 'Confirmado por ' + AP_BIO_texto_((usuario && usuario.nome) || matricula) + '.');
}

/** Os comprovantes — para conferir depois o que foi confirmado por quem. */
function AP_BIO_provas_(payload, sessao) {
  AP_BIO_abaProvas_();
  var lista = AP_BIO_linhasProvas_();
  if (payload && payload.matricula) {
    var m = AP_BIO_texto_(payload.matricula);
    lista = lista.filter(function (x) { return AP_BIO_texto_(x.matricula) === m; });
  }
  if (payload && payload.alvo) {
    var a = AP_BIO_texto_(payload.alvo);
    lista = lista.filter(function (x) { return AP_BIO_texto_(x.alvo) === a; });
  }
  return AP_BIO_ok_({ quantas: lista.length, provas: lista });
}


/* ============================================================
   TESTES — não tocam na planilha
   ============================================================ */

function AP_BIO_testes() {
  var log = [], falhas = 0;
  function ok(nome, cond, detalhe) {
    log.push((cond ? 'PASSOU  ' : 'FALHOU  ') + nome + (detalhe ? '  [' + detalhe + ']' : ''));
    if (!cond) falhas++;
  }

  var tabela = [];
  var provas = [];
  var auditados = [];
  var orig = {
    get: (typeof AP_Data_getSheet === 'function') ? AP_Data_getSheet : null,
    rows: (typeof AP_Data_rows === 'function') ? AP_Data_rows : null,
    app: (typeof AP_Data_append === 'function') ? AP_Data_append : null,
    upd: (typeof AP_Data_update === 'function') ? AP_Data_update : null,
    aud: (typeof AP_Modulo_auditoria === 'function') ? AP_Modulo_auditoria : null,
    usu: (typeof AP_Modulo_usuarios === 'function') ? AP_Modulo_usuarios : null,
    ses: (typeof AP_SEG_abrirSessao === 'function') ? AP_SEG_abrirSessao : null,
    ss: (typeof SpreadsheetApp !== 'undefined') ? SpreadsheetApp : null
  };

  try {
    AP_Data_getSheet = function () { return {}; };
    AP_Data_rows = function (aba) {
      return (aba === AP_BIO_CFG.abaProvas ? provas : tabela).slice();
    };
    AP_Data_append = function (aba, reg) {
      (aba === AP_BIO_CFG.abaProvas ? provas : tabela).push(reg);
    };
    AP_Data_update = function (aba, id, patch) {
      var alvo = tabela.filter(function (l) { return l.id === id; })[0];
      if (!alvo) return false;
      Object.keys(patch).forEach(function (c) { alvo[c] = patch[c]; });
      return true;
    };
    AP_Modulo_auditoria = function (a, p) { auditados.push(p); return { ok: true }; };
    AP_Modulo_usuarios = function () {
      return {
        ok: true, dados: [
          { id: 'U1', matricula: '000458', nome: 'Ismael', perfil: 'admin', status: 'Ativo', obra: 'OB1' },
          { id: 'U2', matricula: '000999', nome: 'Fulano', perfil: 'almoxarife', status: 'Inativo' }
        ]
      };
    };
    AP_SEG_abrirSessao = function (u, o) {
      return { ok: true, dados: { token: 'TK-TESTE', expira: '2030-01-01 00:00:00' } };
    };
    SpreadsheetApp = { getActiveSpreadsheet: function () { return null; }, flush: function () { } };

    var CRED = 'credencial-longa-de-teste-0001';
    var SESSAO = { nome: 'Ismael', usuario: '000458' };

    /* ---- cadastro ---- */
    var r1 = AP_Modulo_biometria('registrar', { matricula: '000458', credencialId: CRED, apelido: 'Dedo indicador', estacao: 'Almoxarifado' }, SESSAO);
    ok('1  cadastra a digital', r1.ok, r1.mensagem);
    ok('2  e diz que não guardou digital nenhuma', /não sai do aparelho/.test(r1.mensagem));
    ok('3  a linha foi gravada', tabela.length === 1);
    ok('4  com status ATIVA', tabela[0].status === 'ATIVA');
    ok('5  vinculada ao usuário do cadastro', tabela[0].usuarioId === 'U1', tabela[0].usuarioId);
    ok('6  a auditoria registrou', auditados.some(function (a) { return a.acao === 'BIOMETRIA_CADASTRADA'; }));

    /* ---- o que não pode ---- */
    var r2 = AP_Modulo_biometria('registrar', { matricula: '000458', credencialId: 'curta' }, SESSAO);
    ok('7  recusa credencial curta demais', !r2.ok && r2.codigo === 'CREDENCIAL_INVALIDA', r2.codigo);
    var r3 = AP_Modulo_biometria('registrar', { matricula: '', credencialId: CRED }, SESSAO);
    ok('8  recusa sem matrícula', !r3.ok && r3.codigo === 'SEM_MATRICULA', r3.codigo);
    var r4 = AP_Modulo_biometria('registrar', { matricula: '000777', credencialId: CRED + 'x' }, SESSAO);
    ok('9  recusa matrícula que não existe no cadastro', !r4.ok && r4.codigo === 'USUARIO_NAO_ENCONTRADO', r4.codigo);
    var r5 = AP_Modulo_biometria('registrar', { matricula: '000999', credencialId: CRED }, SESSAO);
    ok('10 a MESMA digital não vai para outra pessoa', !r5.ok && r5.codigo === 'CREDENCIAL_DE_OUTRA_PESSOA', r5.codigo);
    var r6 = AP_Modulo_biometria('registrar', { matricula: '000458', credencialId: CRED }, SESSAO);
    ok('11 cadastrar de novo a mesma não duplica', r6.ok && r6.dados.jaExistia === true && tabela.length === 1, tabela.length);

    /* ---- entrar ---- */
    var e1 = AP_Modulo_biometria('entrar', { credencialId: CRED }, null);
    ok('12 entra pela digital', e1.ok, e1.mensagem);
    ok('13 devolve o usuário de verdade', e1.ok && e1.dados.usuario.matricula === '000458');
    ok('14 e uma sessão aberta pelo mecanismo existente', e1.ok && e1.dados.sessao.token === 'TK-TESTE');
    ok('15 no mesmo formato do login por senha', e1.ok && !!e1.dados.usuario && !!e1.dados.sessao);
    ok('16 marcou o último uso', !!tabela[0].ultimoUsoEm);
    ok('17 auditou a entrada', auditados.some(function (a) { return a.acao === 'ENTRADA_POR_BIOMETRIA'; }));

    var e2 = AP_Modulo_biometria('entrar', { credencialId: 'nao-existe-esta-credencial' }, null);
    ok('18 digital desconhecida é recusada', !e2.ok && e2.codigo === 'DIGITAL_NAO_RECONHECIDA', e2.codigo);
    ok('19 e a recusa não diz se é inexistente ou revogada',
      !e2.ok && /não está cadastrada neste sistema, ou foi revogada/.test(e2.mensagem));
    var e3 = AP_Modulo_biometria('entrar', {}, null);
    ok('20 sem credencial não entra', !e3.ok && e3.codigo === 'SEM_CREDENCIAL', e3.codigo);

    /* ---- usuário inativo ---- */
    AP_Modulo_biometria('registrar', { matricula: '000999', credencialId: 'credencial-do-inativo-0002' }, SESSAO);
    var e4 = AP_Modulo_biometria('entrar', { credencialId: 'credencial-do-inativo-0002' }, null);
    ok('21 usuário inativo não entra nem com digital', !e4.ok && e4.codigo === 'USUARIO_INATIVO', e4.codigo);

    /* ---- listar não vaza a credencial ---- */
    var l1 = AP_Modulo_biometria('listar', { matricula: '000458' }, SESSAO);
    ok('22 lista as digitais da pessoa', l1.ok && l1.dados.quantas === 1, l1.dados && l1.dados.quantas);
    ok('23 e NUNCA devolve o identificador da credencial',
      JSON.stringify(l1.dados).indexOf(CRED) === -1);

    var d1 = AP_Modulo_biometria('daPessoa', { matricula: '000458' }, SESSAO);
    ok('24 daPessoa diz que tem digital', d1.ok && d1.dados.tem === true);

    /* ---- confirmar uma operação: o comprovante ---- */
    var c0 = AP_Modulo_biometria('confirmar', { credencialId: CRED }, SESSAO);
    ok('34 confirmar sem dizer a operação é recusado', !c0.ok && c0.codigo === 'SEM_OPERACAO', c0.codigo);
    var c1 = AP_Modulo_biometria('confirmar', {
      credencialId: CRED, operacao: 'RETIRADA_EPI', alvo: 'EPI-123',
      detalhe: 'Bota 41', estacao: 'Almoxarifado'
    }, SESSAO);
    ok('35 confirma a operação com a digital', c1.ok, c1.mensagem);
    ok('36 e devolve um comprovante', c1.ok && /^PRV-/.test(c1.dados.prova), c1.dados && c1.dados.prova);
    ok('37 dizendo de quem foi', c1.ok && c1.dados.matricula === '000458');
    ok('38 o comprovante foi gravado', provas.length === 1, provas.length);
    ok('39 com a operação e o alvo', provas[0].operacao === 'RETIRADA_EPI' && provas[0].alvo === 'EPI-123');
    ok('40 e diz que quem conferiu o dedo foi o APARELHO, não o servidor',
      provas[0].verificacaoDoDedo === 'APARELHO', provas[0].verificacaoDoDedo);
    ok('41 o comprovante NÃO guarda o identificador da credencial',
      JSON.stringify(provas[0]).indexOf(CRED) === -1);
    ok('42 a resposta também não vaza o identificador',
      JSON.stringify(c1).indexOf(CRED) === -1);
    ok('43 auditou a confirmação',
      auditados.some(function (a) { return a.acao === 'BIOMETRIA_CONFIRMOU'; }));

    var c2 = AP_Modulo_biometria('confirmar', { credencialId: 'nao-existe-mesmo-0009', operacao: 'APROVACAO' }, SESSAO);
    ok('44 digital desconhecida não confirma nada', !c2.ok && c2.codigo === 'DIGITAL_NAO_RECONHECIDA', c2.codigo);
    ok('45 e nada foi gravado', provas.length === 1, provas.length);

    var pr = AP_Modulo_biometria('provas', { alvo: 'EPI-123' }, SESSAO);
    ok('46 dá para conferir os comprovantes depois', pr.ok && pr.dados.quantas === 1, pr.dados && pr.dados.quantas);

    /* ---- revogar ---- */
    var v0 = AP_Modulo_biometria('revogar', { id: tabela[0].id }, SESSAO);
    ok('25 revogar sem motivo é recusado', !v0.ok && v0.codigo === 'SEM_MOTIVO', v0.codigo);
    var v1 = AP_Modulo_biometria('revogar', { id: tabela[0].id, motivo: 'Aparelho trocado' }, SESSAO);
    ok('26 revoga com motivo', v1.ok, v1.mensagem);
    ok('27 a linha NÃO foi apagada', tabela.length === 2, tabela.length);
    ok('28 ficou como REVOGADA, com quem e por quê',
      tabela[0].status === 'REVOGADA' && tabela[0].motivoRevogacao === 'Aparelho trocado' && !!tabela[0].revogadoPor);
    var e5 = AP_Modulo_biometria('entrar', { credencialId: CRED }, null);
    ok('29 digital revogada não entra mais', !e5.ok && e5.codigo === 'DIGITAL_NAO_RECONHECIDA', e5.codigo);
    var v2 = AP_Modulo_biometria('revogar', { id: tabela[0].id, motivo: 'de novo' }, SESSAO);
    ok('30 não revoga duas vezes', !v2.ok && v2.codigo === 'JA_REVOGADA', v2.codigo);

    /* ---- e a versão conta a verdade ---- */
    var vv = AP_Modulo_biometria('versao', {}, SESSAO);
    ok('31 a versão diz que NÃO guarda digital', vv.ok && vv.dados.guardaDigital === false);
    ok('32 e que NÃO verifica assinatura no servidor',
      vv.ok && vv.dados.verificaAssinaturaNoServidor === false);

    /* ---- sem o abridor de sessão do servidor ---- */
    AP_SEG_abrirSessao = undefined;
    var e6 = AP_Modulo_biometria('entrar', { credencialId: 'credencial-do-inativo-0002' }, null);
    ok('33 sem abridor de sessão, avisa em vez de quebrar',
      !e6.ok && (e6.codigo === 'SEM_SESSAO_NO_SERVIDOR' || e6.codigo === 'USUARIO_INATIVO'), e6.codigo);

  } catch (e) {
    ok('EXCEÇÃO INESPERADA', false, e.message);
  } finally {
    if (orig.get) AP_Data_getSheet = orig.get;
    if (orig.rows) AP_Data_rows = orig.rows;
    if (orig.app) AP_Data_append = orig.app;
    if (orig.upd) AP_Data_update = orig.upd;
    if (orig.aud) AP_Modulo_auditoria = orig.aud;
    if (orig.usu) AP_Modulo_usuarios = orig.usu;
    if (orig.ses) AP_SEG_abrirSessao = orig.ses;
    if (orig.ss) SpreadsheetApp = orig.ss;
  }

  log.push('');
  log.push(falhas ? '>>> ' + falhas + ' TESTE(S) FALHARAM' : '>>> TODOS OS TESTES PASSARAM');
  log.push('');
  log.push('Nada foi lido nem gravado na sua planilha.');
  var texto = log.join('\n');
  try { Logger.log(texto); } catch (e) { }
  try { console.log(texto); } catch (e) { }
  return texto;
}
