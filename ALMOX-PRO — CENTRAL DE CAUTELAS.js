/* ============================================================
   ALMOX-PRO — CENTRAL DE CAUTELAS (modelos e regras por produto)
   ------------------------------------------------------------
   PARA QUE SERVE

   O item 8 do projeto diz: "Não codificar essas regras diretamente
   em vários módulos. A Central de Cautelas deverá ser a fonte
   oficial das configurações."

   Este arquivo é essa fonte. Ele guarda:

     - os MODELOS de cautela (padrão da empresa, TI, EPI, e os que
       você criar depois);
     - as REGRAS que dizem qual produto ou categoria usa qual modelo
       e o que cada um exige.

   Quem responde "este notebook exige patrimônio, cautela de TI e
   assinatura?" é a ação  cautelacfg.resolver  — e é ela que a nota
   fiscal, a solicitação, a cautela e a entrega vão perguntar.

   ------------------------------------------------------------
   O QUE ELE NÃO FAZ, DE PROPÓSITO

   - Não cria cadastro de produto. As regras APONTAM para o SKU ou
     para a categoria do catálogo que já existe.
   - Não apaga modelo nem regra. Desativar e excluir trocam o
     status; a linha fica, com quem mexeu, quando e por quê.
   - Alterar um modelo NÃO perde os documentos anteriores: a versão
     velha é guardada inteira numa aba de histórico antes de a nova
     entrar. (Teste obrigatório 15 do projeto.)
   - Não inventa regra. Produto sem regra cai no padrão da empresa,
     e o resolver DIZ que caiu no padrão.

   ------------------------------------------------------------
   COMO INSTALAR

   1. Planilha  Base Dado almoxarifado  →  Extensões  →  Apps Script.
   2. No  +  ao lado de "Arquivos" → Script. Nome:
      ALMOXA_PRO_Modulo_CautelaConfig
   3. Apague o que vier e cole TODO este arquivo. Salve.
   4. Rode uma vez  AP_CCFG_ENSAIO  (só leitura) e me mande a foto.
   5. Se quiser começar com os três modelos do projeto já prontos,
      rode  AP_CCFG_SEMEAR  — ela cria apenas os modelos que ainda
      não existirem e NÃO mexe nos que já estiverem lá.
   6. Implantar → Gerenciar implantações → editar → Nova versão.
   ============================================================ */


var AP_CCFG_CFG = {
  abaModelos: 'ALMOXA_CAUTELA_MODELOS',
  abaRegras: 'ALMOXA_CAUTELA_REGRAS',
  abaHistorico: 'ALMOXA_CAUTELA_MODELOS_HIST',
  caminhos: ['', '01_BANCO_DADOS/'],

  /* OS INTERRUPTORES — os mesmos oito do item 8 do projeto e os
     mesmos oito da tela. Mexer aqui tem de mexer lá também. */
  chaves: [
    'exigePatrimonio', 'exigeCautela', 'exigeAssinatura', 'exigeSerie',
    'exigeIdentificacao', 'exigeDevolucao', 'permitePermanente', 'validaEntregaFisica'
  ],

  colunasModelo: [
    'ID', 'CODIGO', 'NOME', 'DESCRICAO', 'VERSAO', 'ATIVO',
    'EXIGE_PATRIMONIO', 'EXIGE_CAUTELA', 'EXIGE_ASSINATURA', 'EXIGE_SERIE',
    'EXIGE_IDENTIFICACAO', 'EXIGE_DEVOLUCAO', 'PERMITE_PERMANENTE', 'VALIDA_ENTREGA_FISICA',
    'STATUS', 'CRIADO_EM', 'CRIADO_POR', 'ALTERADO_EM', 'ALTERADO_POR', 'MOTIVO'
  ],

  colunasRegra: [
    'ID', 'TIPO', 'ALVO', 'ID_MODELO', 'ATIVO',
    'EXIGE_PATRIMONIO', 'EXIGE_CAUTELA', 'EXIGE_ASSINATURA', 'EXIGE_SERIE',
    'EXIGE_IDENTIFICACAO', 'EXIGE_DEVOLUCAO', 'PERMITE_PERMANENTE', 'VALIDA_ENTREGA_FISICA',
    'STATUS', 'CRIADO_EM', 'CRIADO_POR', 'ALTERADO_EM', 'ALTERADO_POR', 'MOTIVO'
  ],

  colunasHistorico: [
    'ID_HIST', 'ID_MODELO', 'VERSAO', 'QUANDO', 'QUEM', 'MOTIVO', 'CONTEUDO'
  ]
};

/** O nome da coluna de cada interruptor. */
function AP_CCFG_coluna_(chave) {
  return chave
    .replace(/([A-Z])/g, '_$1')
    .toUpperCase();
}


/* ============================================================
   A PORTA DO ROTEADOR
   ============================================================ */
function AP_Modulo_cautelacfg(acao, payload, sessao) {
  payload = payload || {};
  sessao = sessao || {};
  try {
    switch (String(acao || '').trim()) {
      case 'modelos':          return { ok: true, dados: AP_CCFG_modelos_(payload) };
      case 'regras':           return { ok: true, dados: AP_CCFG_regras_(payload) };
      case 'garantirModelosDoSistema': return AP_CCFG_garantirDoSistema_(payload, sessao);
      case 'salvarModelo':     return AP_CCFG_salvarModelo_(payload, sessao);
      case 'atualizarModelo':  return AP_CCFG_atualizarModelo_(payload, sessao);
      case 'salvarRegra':      return AP_CCFG_salvarRegra_(payload, sessao);
      case 'excluirRegra':     return AP_CCFG_excluirRegra_(payload, sessao);
      case 'resolver':         return AP_CCFG_resolver_(payload);
      case 'historico':        return { ok: true, dados: AP_CCFG_historico_(payload) };
      case 'diagnostico':      return { ok: true, dados: AP_CCFG_ensaio_() };
      default:
        return { ok: false, codigo: 'ACAO_DESCONHECIDA',
          mensagem: 'A Central de Cautelas não conhece a ação "' + acao + '". Conhece: ' +
            'modelos, regras, garantirModelosDoSistema, salvarModelo, atualizarModelo, salvarRegra, excluirRegra, ' +
            'resolver, historico, diagnostico.' };
    }
  } catch (e) {
    return { ok: false, codigo: 'ERRO', mensagem: e.message, onde: String(e.stack || '').slice(0, 400) };
  }
}


/* ============================================================
   ABAS
   ============================================================ */
function AP_CCFG_abaViva_(aba) {
  if (!aba) return false;
  try { aba.getLastColumn(); return true; } catch (e) { return false; }
}

function AP_CCFG_procurar_(nome) {
  var tentativas = [];
  if (typeof AP_SRV_aba_ === 'function') {
    for (var i = 0; i < AP_CCFG_CFG.caminhos.length; i++) {
      var caminho = AP_CCFG_CFG.caminhos[i] + nome;
      var achada = null;
      try { achada = AP_SRV_aba_(caminho); }
      catch (e) { tentativas.push('AP_SRV_aba_("' + caminho + '"): ' + e.message); continue; }
      if (achada && AP_CCFG_abaViva_(achada)) return { aba: achada, via: 'AP_SRV_aba_("' + caminho + '")' };
      tentativas.push('AP_SRV_aba_("' + caminho + '") não serviu');
    }
  } else {
    tentativas.push('AP_SRV_aba_ não existe neste projeto');
  }
  try {
    var ss = SpreadsheetApp.getActive();
    if (ss) {
      var d = ss.getSheetByName(nome);
      if (d && AP_CCFG_abaViva_(d)) return { aba: d, via: 'aba "' + nome + '" na planilha ativa' };
      tentativas.push(d ? 'a aba "' + nome + '" existe mas não abre' : 'não há aba "' + nome + '"');
    } else {
      tentativas.push('não há planilha ativa');
    }
  } catch (e) { tentativas.push('planilha ativa: ' + e.message); }
  return { aba: null, via: null, tentativas: tentativas };
}

function AP_CCFG_abrir_(nome, colunas) {
  var achada = AP_CCFG_procurar_(nome);
  if (achada.aba) { AP_CCFG_cabecalho_(achada.aba, colunas); return achada.aba; }
  var ss = SpreadsheetApp.getActive();
  if (!ss) throw new Error('Não há planilha ativa para criar a aba "' + nome + '".');
  var jaTem = ss.getSheetByName(nome);
  if (jaTem) return jaTem;
  var nova = ss.insertSheet(nome);
  nova.getRange(1, 1, 1, colunas.length).setValues([colunas]);
  nova.setFrozenRows(1);
  nova.getRange(1, 1, 1, colunas.length).setFontWeight('bold');
  return nova;
}

/** Acrescenta no fim o que faltar. Nunca renomeia nem reordena. */
function AP_CCFG_cabecalho_(aba, colunas) {
  var largura = aba.getLastColumn();
  var atuais = largura
    ? aba.getRange(1, 1, 1, largura).getValues()[0].map(function (c) {
        return String(c === null || c === undefined ? '' : c).trim().toUpperCase();
      })
    : [];
  var faltando = colunas.filter(function (c) { return atuais.indexOf(String(c).toUpperCase()) < 0; });
  if (!faltando.length) return;
  aba.getRange(1, largura + 1, 1, faltando.length).setValues([faltando]);
  aba.getRange(1, largura + 1, 1, faltando.length).setFontWeight('bold');
}

function AP_CCFG_abaModelos_()   { return AP_CCFG_abrir_(AP_CCFG_CFG.abaModelos, AP_CCFG_CFG.colunasModelo); }
function AP_CCFG_abaRegras_()    { return AP_CCFG_abrir_(AP_CCFG_CFG.abaRegras, AP_CCFG_CFG.colunasRegra); }
function AP_CCFG_abaHistorico_() { return AP_CCFG_abrir_(AP_CCFG_CFG.abaHistorico, AP_CCFG_CFG.colunasHistorico); }


/* ============================================================
   LER E ESCREVER PELO NOME DA COLUNA
   ============================================================ */
function AP_CCFG_indice_(aba) {
  var largura = aba.getLastColumn();
  var porNome = {};
  if (!largura) return porNome;
  aba.getRange(1, 1, 1, largura).getValues()[0].forEach(function (c, i) {
    var k = String(c === null || c === undefined ? '' : c).trim().toUpperCase();
    if (k && porNome[k] === undefined) porNome[k] = i;
  });
  return porNome;
}

function AP_CCFG_linhas_(aba) {
  var ultima = aba.getLastRow();
  if (ultima < 2) return [];
  return aba.getRange(2, 1, ultima - 1, aba.getLastColumn()).getValues();
}

function AP_CCFG_pegar_(linha, idx, coluna) {
  var i = idx[String(coluna).toUpperCase()];
  if (i === undefined) return '';
  var v = linha[i];
  return v === null || v === undefined ? '' : v;
}

function AP_CCFG_montar_(idx, largura, valores) {
  var linha = [];
  for (var i = 0; i < largura; i++) linha.push('');
  Object.keys(valores).forEach(function (nome) {
    var i = idx[String(nome).toUpperCase()];
    if (i !== undefined && i < largura) linha[i] = valores[nome];
  });
  return linha;
}

function AP_CCFG_txt_(v) { return String(v === null || v === undefined ? '' : v).trim(); }

/** SIM/NAO/vazio da planilha vira true/false/null sem adivinhação. */
function AP_CCFG_bool_(v) {
  var s = AP_CCFG_txt_(v).toUpperCase();
  if (s === '') return null;
  if (s === 'SIM' || s === 'TRUE' || s === 'VERDADEIRO' || s === '1' || s === 'X') return true;
  if (s === 'NAO' || s === 'NÃO' || s === 'FALSE' || s === 'FALSO' || s === '0') return false;
  return null;
}

function AP_CCFG_deBool_(v) {
  if (v === true) return 'SIM';
  if (v === false) return 'NAO';
  return '';
}

function AP_CCFG_agora_() {
  return Utilities.formatDate(new Date(), 'America/Manaus', "yyyy-MM-dd'T'HH:mm:ss");
}

function AP_CCFG_quem_(sessao) {
  return AP_CCFG_txt_(sessao && (sessao.nome || sessao.usuario || sessao.matricula)) || 'sistema';
}


/* ============================================================
   LER MODELOS E REGRAS
   ============================================================ */
function AP_CCFG_modelos_(payload) {
  var aba = AP_CCFG_abaModelos_();
  var idx = AP_CCFG_indice_(aba);
  var incluirExcluidos = !!(payload && payload.incluirExcluidos);
  var saida = [];
  AP_CCFG_linhas_(aba).forEach(function (l) {
    var m = AP_CCFG_modeloEmObjeto_(l, idx);
    if (!m.id) return;
    if (!incluirExcluidos && String(m.status).toUpperCase() === 'EXCLUIDO') return;
    saida.push(m);
  });
  return saida;
}

function AP_CCFG_modeloEmObjeto_(l, idx) {
  var m = {
    id: AP_CCFG_txt_(AP_CCFG_pegar_(l, idx, 'ID')),
    codigo: AP_CCFG_txt_(AP_CCFG_pegar_(l, idx, 'CODIGO')),
    nome: AP_CCFG_txt_(AP_CCFG_pegar_(l, idx, 'NOME')),
    descricao: AP_CCFG_txt_(AP_CCFG_pegar_(l, idx, 'DESCRICAO')),
    versao: Number(AP_CCFG_pegar_(l, idx, 'VERSAO')) || 1,
    ativo: AP_CCFG_bool_(AP_CCFG_pegar_(l, idx, 'ATIVO')) !== false,
    status: AP_CCFG_txt_(AP_CCFG_pegar_(l, idx, 'STATUS')) || 'ATIVO',
    criadoEm: AP_CCFG_txt_(AP_CCFG_pegar_(l, idx, 'CRIADO_EM')),
    criadoPor: AP_CCFG_txt_(AP_CCFG_pegar_(l, idx, 'CRIADO_POR')),
    alteradoEm: AP_CCFG_txt_(AP_CCFG_pegar_(l, idx, 'ALTERADO_EM')),
    alteradoPor: AP_CCFG_txt_(AP_CCFG_pegar_(l, idx, 'ALTERADO_POR')),
    motivo: AP_CCFG_txt_(AP_CCFG_pegar_(l, idx, 'MOTIVO'))
  };
  AP_CCFG_CFG.chaves.forEach(function (k) {
    m[k] = AP_CCFG_bool_(AP_CCFG_pegar_(l, idx, AP_CCFG_coluna_(k))) === true;
  });
  return m;
}

function AP_CCFG_regras_(payload) {
  var aba = AP_CCFG_abaRegras_();
  var idx = AP_CCFG_indice_(aba);
  var incluirExcluidas = !!(payload && payload.incluirExcluidas);
  var saida = [];
  AP_CCFG_linhas_(aba).forEach(function (l) {
    var r = AP_CCFG_regraEmObjeto_(l, idx);
    if (!r.id) return;
    if (!incluirExcluidas && String(r.status).toUpperCase() === 'EXCLUIDA') return;
    saida.push(r);
  });
  return saida;
}

function AP_CCFG_regraEmObjeto_(l, idx) {
  var r = {
    id: AP_CCFG_txt_(AP_CCFG_pegar_(l, idx, 'ID')),
    tipo: AP_CCFG_txt_(AP_CCFG_pegar_(l, idx, 'TIPO')).toUpperCase() || 'SKU',
    alvo: AP_CCFG_txt_(AP_CCFG_pegar_(l, idx, 'ALVO')),
    modeloId: AP_CCFG_txt_(AP_CCFG_pegar_(l, idx, 'ID_MODELO')),
    ativo: AP_CCFG_bool_(AP_CCFG_pegar_(l, idx, 'ATIVO')) !== false,
    status: AP_CCFG_txt_(AP_CCFG_pegar_(l, idx, 'STATUS')) || 'ATIVA',
    criadoEm: AP_CCFG_txt_(AP_CCFG_pegar_(l, idx, 'CRIADO_EM')),
    criadoPor: AP_CCFG_txt_(AP_CCFG_pegar_(l, idx, 'CRIADO_POR')),
    alteradoEm: AP_CCFG_txt_(AP_CCFG_pegar_(l, idx, 'ALTERADO_EM')),
    alteradoPor: AP_CCFG_txt_(AP_CCFG_pegar_(l, idx, 'ALTERADO_POR')),
    motivo: AP_CCFG_txt_(AP_CCFG_pegar_(l, idx, 'MOTIVO'))
  };
  /* aqui vazio quer dizer HERDAR DO MODELO — por isso null é um
     valor de verdade e não pode virar false. */
  AP_CCFG_CFG.chaves.forEach(function (k) {
    r[k] = AP_CCFG_bool_(AP_CCFG_pegar_(l, idx, AP_CCFG_coluna_(k)));
  });
  return r;
}


/* ============================================================
   O RESOLVEDOR — A FONTE OFICIAL
   A MESMA ordem da tela: SKU, depois categoria, depois o padrão.
   Se a tela e o servidor divergirem aqui, o sistema mente.
   ============================================================ */
function AP_CCFG_PADRAO() {
  var p = { origem: 'PADRÃO DA EMPRESA', modeloId: '', modeloNome: '', modeloVersao: 0 };
  AP_CCFG_CFG.chaves.forEach(function (k) { p[k] = false; });
  p.porQue = 'Este produto não tem regra cadastrada. Vale o padrão da empresa: ' +
    'fluxo normal de estoque, sem patrimônio e sem cautela.';
  return p;
}

function AP_CCFG_resolver_(payload) {
  var sku = AP_CCFG_txt_(payload && (payload.sku || payload.codigo)).toUpperCase();
  var categoria = AP_CCFG_txt_(payload && payload.categoria).toUpperCase();

  if (!sku && !categoria) {
    return { ok: false, codigo: 'SEM_PRODUTO',
      mensagem: 'Informe o SKU ou a categoria do produto para eu dizer a regra.' };
  }

  var regras = AP_CCFG_regras_({});
  var daSku = null, daCategoria = null;
  regras.forEach(function (r) {
    if (!r.ativo) return;
    var alvo = AP_CCFG_txt_(r.alvo).toUpperCase();
    if (!alvo) return;
    if (r.tipo === 'SKU' && alvo === sku && !daSku) daSku = r;
    if (r.tipo === 'CATEGORIA' && alvo === categoria && !daCategoria) daCategoria = r;
  });

  var escolhida = daSku || daCategoria;
  if (!escolhida) return { ok: true, dados: AP_CCFG_PADRAO() };

  var modelos = AP_CCFG_modelos_({});
  var modelo = null;
  modelos.forEach(function (m) { if (m.id === escolhida.modeloId) modelo = m; });

  var saida = {
    origem: escolhida.tipo === 'SKU'
      ? 'REGRA DO PRODUTO ' + escolhida.alvo
      : 'REGRA DA CATEGORIA ' + escolhida.alvo,
    regraId: escolhida.id,
    modeloId: escolhida.modeloId,
    modeloNome: modelo ? modelo.nome : '',
    modeloVersao: modelo ? modelo.versao : 0,
    modeloAtivo: modelo ? modelo.ativo : false
  };

  AP_CCFG_CFG.chaves.forEach(function (k) {
    var daRegra = escolhida[k];
    saida[k] = (daRegra === null || daRegra === undefined)
      ? !!(modelo && modelo[k])
      : !!daRegra;
  });

  if (modelo && !modelo.ativo) {
    saida.aviso = 'O modelo "' + modelo.nome + '" está DESATIVADO. As cautelas já ' +
      'emitidas continuam valendo, mas novas não devem usar este modelo.';
  }
  if (!modelo && escolhida.modeloId) {
    saida.aviso = 'A regra aponta para um modelo que não existe mais (' +
      escolhida.modeloId + '). Corrija a regra antes de usar.';
  }
  saida.porQue = 'Veio da ' + saida.origem.toLowerCase() +
    (modelo ? ', modelo "' + modelo.nome + '" versão ' + modelo.versao : '') + '.';

  return { ok: true, dados: saida };
}


/* ============================================================
   GRAVAR MODELO
   ============================================================ */
function AP_CCFG_salvarModelo_(payload, sessao) {
  var nome = AP_CCFG_txt_(payload && payload.nome);
  if (!nome) return { ok: false, codigo: 'SEM_NOME', mensagem: 'Dê um nome ao modelo.' };

  var aba = AP_CCFG_abaModelos_();
  var idx = AP_CCFG_indice_(aba);
  var largura = aba.getLastColumn();

  var codigo = AP_CCFG_txt_(payload.codigo).toUpperCase();
  var jaTem = null;
  AP_CCFG_modelos_({}).forEach(function (m) {
    if (codigo && AP_CCFG_txt_(m.codigo).toUpperCase() === codigo) jaTem = m;
    if (AP_CCFG_txt_(m.nome).toUpperCase() === nome.toUpperCase() && !jaTem) jaTem = m;
  });
  if (jaTem) {
    return { ok: false, codigo: 'MODELO_REPETIDO',
      mensagem: 'Já existe o modelo "' + jaTem.nome + '" (código ' + (jaTem.codigo || '—') +
        '). Edite aquele em vez de criar outro igual.' };
  }

  var agora = AP_CCFG_agora_();
  var quem = AP_CCFG_quem_(sessao);
  var id = 'MOD' + new Date().getTime();

  var valores = {
    ID: id, CODIGO: codigo, NOME: nome,
    DESCRICAO: AP_CCFG_txt_(payload.descricao),
    VERSAO: 1,
    ATIVO: AP_CCFG_deBool_(payload.ativo !== false),
    STATUS: 'ATIVO', CRIADO_EM: agora, CRIADO_POR: quem
  };
  AP_CCFG_CFG.chaves.forEach(function (k) {
    valores[AP_CCFG_coluna_(k)] = AP_CCFG_deBool_(payload[k] === true);
  });

  aba.appendRow(AP_CCFG_montar_(idx, largura, valores));

  var conferencia = null;
  AP_CCFG_modelos_({}).forEach(function (m) { if (m.id === id) conferencia = m; });
  if (!conferencia) {
    return { ok: false, codigo: 'NAO_CONFIRMOU',
      mensagem: 'A linha foi enviada mas eu não consegui reler o modelo na planilha. ' +
        'NÃO considere gravado — confira a aba ' + AP_CCFG_CFG.abaModelos + '.' };
  }
  return { ok: true, dados: conferencia, mensagem: 'Modelo "' + nome + '" criado na versão 1.' };
}


/* ============================================================
   ALTERAR MODELO — guarda a versão velha ANTES de mexer
   ============================================================ */
function AP_CCFG_atualizarModelo_(payload, sessao) {
  var id = AP_CCFG_txt_(payload && payload.id);
  if (!id) return { ok: false, codigo: 'SEM_ID', mensagem: 'Informe qual modelo está sendo alterado.' };
  var motivo = AP_CCFG_txt_(payload.motivo);
  if (!motivo) {
    return { ok: false, codigo: 'SEM_MOTIVO',
      mensagem: 'Diga por que o modelo está mudando. Fica no histórico junto com a versão anterior.' };
  }

  var trava = LockService.getScriptLock();
  try { trava.waitLock(20000); }
  catch (e) { return { ok: false, codigo: 'OCUPADO', mensagem: 'Outra gravação está em andamento.' }; }

  try {
    var aba = AP_CCFG_abaModelos_();
    var idx = AP_CCFG_indice_(aba);
    var largura = aba.getLastColumn();
    var linhas = AP_CCFG_linhas_(aba);

    var alvo = -1;
    for (var i = 0; i < linhas.length; i++) {
      if (AP_CCFG_txt_(AP_CCFG_pegar_(linhas[i], idx, 'ID')) === id) { alvo = i; break; }
    }
    if (alvo < 0) return { ok: false, codigo: 'NAO_ENCONTRADO', mensagem: 'Modelo ' + id + ' não existe.' };

    var antigo = AP_CCFG_modeloEmObjeto_(linhas[alvo], idx);
    var agora = AP_CCFG_agora_();
    var quem = AP_CCFG_quem_(sessao);

    /* O HISTÓRICO VEM PRIMEIRO.
       Se a gravação da versão nova falhar, a velha já está guardada.
       Ao contrário, perderia-se o documento anterior — que é
       exatamente o que o teste 15 do projeto proíbe. */
    var abaH = AP_CCFG_abaHistorico_();
    var idxH = AP_CCFG_indice_(abaH);
    abaH.appendRow(AP_CCFG_montar_(idxH, abaH.getLastColumn(), {
      ID_HIST: 'H' + new Date().getTime(),
      ID_MODELO: id,
      VERSAO: antigo.versao,
      QUANDO: agora,
      QUEM: quem,
      MOTIVO: motivo,
      CONTEUDO: JSON.stringify(antigo)
    }));

    var valores = {
      ID: id,
      CODIGO: antigo.codigo,                       /* o código não muda: regras apontam para ele */
      NOME: AP_CCFG_txt_(payload.nome) || antigo.nome,
      DESCRICAO: AP_CCFG_txt_(payload.descricao),
      VERSAO: antigo.versao + 1,
      ATIVO: AP_CCFG_deBool_(payload.ativo !== false),
      STATUS: antigo.status || 'ATIVO',
      CRIADO_EM: antigo.criadoEm, CRIADO_POR: antigo.criadoPor,
      ALTERADO_EM: agora, ALTERADO_POR: quem, MOTIVO: motivo
    };
    AP_CCFG_CFG.chaves.forEach(function (k) {
      valores[AP_CCFG_coluna_(k)] = AP_CCFG_deBool_(payload[k] === true);
    });

    aba.getRange(alvo + 2, 1, 1, largura).setValues([AP_CCFG_montar_(idx, largura, valores)]);

    var conferencia = null;
    AP_CCFG_modelos_({}).forEach(function (m) { if (m.id === id) conferencia = m; });
    if (!conferencia || conferencia.versao !== antigo.versao + 1) {
      return { ok: false, codigo: 'NAO_CONFIRMOU',
        mensagem: 'A alteração foi enviada mas a releitura não bateu. NÃO considere gravada. ' +
          'A versão ' + antigo.versao + ' está guardada na aba ' + AP_CCFG_CFG.abaHistorico + '.' };
    }
    return { ok: true, dados: conferencia,
      mensagem: 'Modelo "' + conferencia.nome + '" agora na versão ' + conferencia.versao +
        '. A versão ' + antigo.versao + ' ficou guardada no histórico.' };
  } finally {
    try { trava.releaseLock(); } catch (e) {}
  }
}


/* ============================================================
   GRAVAR REGRA
   ============================================================ */
function AP_CCFG_salvarRegra_(payload, sessao) {
  var tipo = AP_CCFG_txt_(payload && payload.tipo).toUpperCase() || 'SKU';
  var alvo = AP_CCFG_txt_(payload && payload.alvo);
  if (!alvo) return { ok: false, codigo: 'SEM_ALVO', mensagem: 'Diga a qual produto ou categoria a regra se aplica.' };
  if (tipo !== 'SKU' && tipo !== 'CATEGORIA') {
    return { ok: false, codigo: 'TIPO_INVALIDO', mensagem: 'A regra é por SKU ou por CATEGORIA.' };
  }

  /* exige cautela sem modelo é regra quebrada: a solicitação não
     teria documento nenhum para montar. */
  if (payload.exigeCautela === true && !AP_CCFG_txt_(payload.modeloId)) {
    return { ok: false, codigo: 'SEM_MODELO',
      mensagem: 'Esta regra exige cautela mas não diz qual modelo usar.' };
  }
  if (AP_CCFG_txt_(payload.modeloId)) {
    var existe = false;
    AP_CCFG_modelos_({}).forEach(function (m) { if (m.id === AP_CCFG_txt_(payload.modeloId)) existe = true; });
    if (!existe) {
      return { ok: false, codigo: 'MODELO_NAO_EXISTE',
        mensagem: 'O modelo ' + AP_CCFG_txt_(payload.modeloId) + ' não existe.' };
    }
  }

  var aba = AP_CCFG_abaRegras_();
  var idx = AP_CCFG_indice_(aba);
  var largura = aba.getLastColumn();
  var linhas = AP_CCFG_linhas_(aba);
  var agora = AP_CCFG_agora_();
  var quem = AP_CCFG_quem_(sessao);
  var id = AP_CCFG_txt_(payload.id);

  /* duas regras ativas para o mesmo alvo seria sorteio: a resposta
     mudaria conforme a ordem das linhas. */
  var conflito = null;
  linhas.forEach(function (l) {
    var r = AP_CCFG_regraEmObjeto_(l, idx);
    if (r.id === id) return;
    if (String(r.status).toUpperCase() === 'EXCLUIDA') return;
    if (r.tipo === tipo && AP_CCFG_txt_(r.alvo).toUpperCase() === alvo.toUpperCase()) conflito = r;
  });
  if (conflito) {
    return { ok: false, codigo: 'REGRA_REPETIDA',
      mensagem: 'Já existe uma regra de ' + tipo.toLowerCase() + ' para "' + conflito.alvo +
        '". Edite aquela — duas regras para o mesmo alvo deixariam a resposta no sorteio.' };
  }

  var valores = {
    TIPO: tipo, ALVO: alvo,
    ID_MODELO: AP_CCFG_txt_(payload.modeloId),
    ATIVO: AP_CCFG_deBool_(payload.ativo !== false),
    STATUS: 'ATIVA'
  };
  AP_CCFG_CFG.chaves.forEach(function (k) {
    /* null = herdar do modelo. Grava vazio, de propósito. */
    valores[AP_CCFG_coluna_(k)] = AP_CCFG_deBool_(
      payload[k] === null || payload[k] === undefined ? null : !!payload[k]);
  });

  if (id) {
    var alvoLinha = -1;
    for (var i = 0; i < linhas.length; i++) {
      if (AP_CCFG_txt_(AP_CCFG_pegar_(linhas[i], idx, 'ID')) === id) { alvoLinha = i; break; }
    }
    if (alvoLinha < 0) return { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Regra ' + id + ' não existe.' };
    var antiga = AP_CCFG_regraEmObjeto_(linhas[alvoLinha], idx);
    valores.ID = id;
    valores.CRIADO_EM = antiga.criadoEm;
    valores.CRIADO_POR = antiga.criadoPor;
    valores.ALTERADO_EM = agora;
    valores.ALTERADO_POR = quem;
    valores.MOTIVO = AP_CCFG_txt_(payload.motivo);
    aba.getRange(alvoLinha + 2, 1, 1, largura).setValues([AP_CCFG_montar_(idx, largura, valores)]);
  } else {
    id = 'REG' + new Date().getTime();
    valores.ID = id;
    valores.CRIADO_EM = agora;
    valores.CRIADO_POR = quem;
    aba.appendRow(AP_CCFG_montar_(idx, largura, valores));
  }

  var conferencia = null;
  AP_CCFG_regras_({}).forEach(function (r) { if (r.id === id) conferencia = r; });
  if (!conferencia) {
    return { ok: false, codigo: 'NAO_CONFIRMOU',
      mensagem: 'A regra foi enviada mas eu não consegui reler na planilha. NÃO considere gravada.' };
  }
  return { ok: true, dados: conferencia, mensagem: 'Regra de ' + tipo.toLowerCase() + ' para "' + alvo + '" gravada.' };
}


/* ============================================================
   EXCLUIR REGRA — status, nunca apagar linha
   ============================================================ */
function AP_CCFG_excluirRegra_(payload, sessao) {
  var id = AP_CCFG_txt_(payload && payload.id);
  if (!id) return { ok: false, codigo: 'SEM_ID', mensagem: 'Informe qual regra excluir.' };

  var aba = AP_CCFG_abaRegras_();
  var idx = AP_CCFG_indice_(aba);
  var linhas = AP_CCFG_linhas_(aba);
  var agora = AP_CCFG_agora_();
  var quem = AP_CCFG_quem_(sessao);

  for (var i = 0; i < linhas.length; i++) {
    if (AP_CCFG_txt_(AP_CCFG_pegar_(linhas[i], idx, 'ID')) !== id) continue;
    if (idx['STATUS'] !== undefined) aba.getRange(i + 2, idx['STATUS'] + 1).setValue('EXCLUIDA');
    if (idx['ATIVO'] !== undefined) aba.getRange(i + 2, idx['ATIVO'] + 1).setValue('NAO');
    if (idx['ALTERADO_EM'] !== undefined) aba.getRange(i + 2, idx['ALTERADO_EM'] + 1).setValue(agora);
    if (idx['ALTERADO_POR'] !== undefined) aba.getRange(i + 2, idx['ALTERADO_POR'] + 1).setValue(quem);
    if (idx['MOTIVO'] !== undefined) {
      aba.getRange(i + 2, idx['MOTIVO'] + 1).setValue(AP_CCFG_txt_(payload.motivo) || 'excluída');
    }
    return { ok: true, dados: { id: id },
      mensagem: 'Regra marcada como EXCLUIDA. A linha continua na planilha — o histórico ficou.' };
  }
  return { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Regra ' + id + ' não existe.' };
}


/* ============================================================
   HISTÓRICO DE UM MODELO
   ============================================================ */
function AP_CCFG_historico_(payload) {
  var id = AP_CCFG_txt_(payload && payload.id);
  var aba = AP_CCFG_abaHistorico_();
  var idx = AP_CCFG_indice_(aba);
  var saida = [];
  AP_CCFG_linhas_(aba).forEach(function (l) {
    var m = AP_CCFG_txt_(AP_CCFG_pegar_(l, idx, 'ID_MODELO'));
    if (id && m !== id) return;
    var conteudo = null;
    try { conteudo = JSON.parse(AP_CCFG_txt_(AP_CCFG_pegar_(l, idx, 'CONTEUDO'))); } catch (e) {}
    saida.push({
      id: AP_CCFG_txt_(AP_CCFG_pegar_(l, idx, 'ID_HIST')),
      modeloId: m,
      versao: Number(AP_CCFG_pegar_(l, idx, 'VERSAO')) || 0,
      quando: AP_CCFG_txt_(AP_CCFG_pegar_(l, idx, 'QUANDO')),
      quem: AP_CCFG_txt_(AP_CCFG_pegar_(l, idx, 'QUEM')),
      motivo: AP_CCFG_txt_(AP_CCFG_pegar_(l, idx, 'MOTIVO')),
      conteudo: conteudo
    });
  });
  saida.sort(function (a, b) { return b.versao - a.versao; });
  return saida;
}


/* ============================================================
   SEMEAR — os três modelos que o projeto cita (item 7)
   Só cria o que NÃO existe. Não mexe no que já estiver lá.
   ============================================================ */
function AP_CCFG_SEMEAR() {
  var prontos = [
    { codigo: 'PADRAO', nome: 'Cautela padrão da empresa',
      descricao: 'Modelo geral para equipamentos sob responsabilidade do colaborador.',
      exigePatrimonio: true, exigeCautela: true, exigeAssinatura: true,
      exigeSerie: false, exigeIdentificacao: true, exigeDevolucao: true,
      permitePermanente: false, validaEntregaFisica: true },
    { codigo: 'TI', nome: 'Cautela de TI',
      descricao: 'Notebooks, computadores e equipamentos de informática.',
      exigePatrimonio: true, exigeCautela: true, exigeAssinatura: true,
      exigeSerie: true, exigeIdentificacao: true, exigeDevolucao: true,
      permitePermanente: false, validaEntregaFisica: true },
    { codigo: 'EPI', nome: 'Cautela de EPI',
      descricao: 'Itens de proteção que exigem registro individual de entrega.',
      exigePatrimonio: false, exigeCautela: true, exigeAssinatura: true,
      exigeSerie: false, exigeIdentificacao: false, exigeDevolucao: true,
      permitePermanente: false, validaEntregaFisica: false }
  ];

  var jaTem = {};
  AP_CCFG_modelos_({}).forEach(function (m) {
    jaTem[AP_CCFG_txt_(m.codigo).toUpperCase()] = m;
  });

  var criados = [], pulados = [];
  prontos.forEach(function (p) {
    if (jaTem[p.codigo]) {
      pulados.push(p.nome + ' (já existe, versão ' + jaTem[p.codigo].versao + ' — NÃO toquei)');
      return;
    }
    var r = AP_CCFG_salvarModelo_(p, { nome: 'semeadura' });
    criados.push(p.nome + (r.ok ? ' — criado' : ' — FALHOU: ' + r.mensagem));
  });

  var texto = 'SEMEADURA DOS MODELOS\n\nCRIADOS:\n  ' +
    (criados.length ? criados.join('\n  ') : '(nenhum)') +
    '\n\nPULADOS:\n  ' + (pulados.length ? pulados.join('\n  ') : '(nenhum)') +
    '\n\nNenhuma regra por produto foi criada: isso é decisão sua, na tela Central de Cautelas.';
  Logger.log(texto);
  return texto;
}


/* ============================================================
   ENSAIO — SÓ LEITURA. NÃO GRAVA NADA.
   ============================================================ */
function AP_CCFG_ENSAIO() {
  var r = AP_CCFG_ensaio_();
  Logger.log(r.texto);
  return r.texto;
}

function AP_CCFG_ensaio_() {
  var L = [];
  function diz(t) { L.push(t); }
  function titulo(t) {
    diz(''); diz('============================================================');
    diz('  ' + t); diz('============================================================');
  }

  diz('ENSAIO DA CENTRAL DE CAUTELAS — ALMOX-PRO');
  diz('gerado em ' + new Date().toISOString());
  diz('ESTE RELATÓRIO É SÓ DE LEITURA. NADA FOI GRAVADO.');

  titulo('1. AS ABAS');
  [[AP_CCFG_CFG.abaModelos, AP_CCFG_CFG.colunasModelo],
   [AP_CCFG_CFG.abaRegras, AP_CCFG_CFG.colunasRegra],
   [AP_CCFG_CFG.abaHistorico, AP_CCFG_CFG.colunasHistorico]].forEach(function (par) {
    var achada = AP_CCFG_procurar_(par[0]);
    if (achada.aba) {
      var largura = achada.aba.getLastColumn();
      diz('  ' + par[0] + ': JÁ EXISTE — ' + achada.via);
      diz('     linhas: ' + Math.max(0, achada.aba.getLastRow() - 1));
      diz('     colunas: ' + (largura ? achada.aba.getRange(1, 1, 1, largura).getValues()[0].join(', ') : ''));
    } else {
      diz('  ' + par[0] + ': ainda não existe. Será criada no primeiro uso.');
      diz('     colunas que terá: ' + par[1].join(', '));
    }
  });

  titulo('2. OS MODELOS');
  try {
    var ms = AP_CCFG_modelos_({});
    diz('  ' + ms.length + ' modelo(s)');
    ms.forEach(function (m) {
      var liga = AP_CCFG_CFG.chaves.filter(function (k) { return m[k]; });
      diz('    ' + (m.codigo || '—') + ' · ' + m.nome + ' · v' + m.versao +
        ' · ' + (m.ativo ? 'ativo' : 'DESATIVADO'));
      diz('       exige: ' + (liga.length ? liga.join(', ') : 'nada'));
    });
    if (!ms.length) diz('    >> rode AP_CCFG_SEMEAR para criar os três do projeto.');
  } catch (e) { diz('  ERRO: ' + e.message); }

  titulo('3. AS REGRAS');
  try {
    var rs = AP_CCFG_regras_({});
    diz('  ' + rs.length + ' regra(s)');
    rs.slice(0, 20).forEach(function (r) {
      var ajustes = AP_CCFG_CFG.chaves.filter(function (k) { return r[k] !== null; });
      diz('    ' + r.tipo + ' ' + r.alvo + ' -> modelo ' + (r.modeloId || '(nenhum)') +
        (r.ativo ? '' : ' [INATIVA]') +
        (ajustes.length ? ' · ajusta: ' + ajustes.join(', ') : ' · tudo do modelo'));
    });
    if (rs.length > 20) diz('    … e mais ' + (rs.length - 20));
  } catch (e) { diz('  ERRO: ' + e.message); }

  titulo('4. TESTE DO RESOLVEDOR');
  try {
    var teste = AP_CCFG_resolver_({ sku: 'TESTE-QUE-NAO-EXISTE', categoria: 'NADA' });
    diz('  produto sem regra -> ' + JSON.stringify(teste.dados).slice(0, 400));
  } catch (e) { diz('  ERRO: ' + e.message); }

  titulo('FIM — NADA FOI GRAVADO');
  return { texto: L.join('\n'), linhas: L };
}


/* ============================================================
   OS MODELOS QUE O SISTEMA JA TEM        [CCFG_DO_SISTEMA]
   ------------------------------------------------------------
   O PROBLEMA (29/10, tela dele):
     "A regra NAO foi gravada. O modelo SISTEMA-TERMO-TI nao existe."

   O ALMOX-PRO tem dois modelos que imprimem documento todo dia —
   a Cautela de Equipamentos e o Termo de Responsabilidade da TI —
   mas nenhum dos dois estava na aba de modelos. A tela passou a
   mostra-los; o servidor, que valida a regra contra a aba, recusou.
   Com razao: ele nao pode aceitar um modelo que nao existe.

   ENTAO O LUGAR DE CONSERTAR E AQUI, e nao afrouxando a validacao.
   Esta acao grava os dois na aba, com id fixo, UMA vez.

   POR QUE ID FIXO
     salvarModelo cria id novo a cada chamada (MOD + tempo). Se os
     dois nascessem assim, cada reinstalacao criaria outro par e as
     regras antigas apontariam para modelos mortos. Com id fixo,
     rodar de novo nao duplica: quem ja existe e PULADO, nao
     reescrito — a personalizacao que ele tiver feito fica de pe.

   O QUE ELA NAO FAZ
     Nao apaga, nao sobrescreve, nao mexe em regra nenhuma e nao
     toca no texto de documento nenhum. So acrescenta a linha que
     falta na aba de modelos.
   ============================================================ */
var AP_CCFG_DO_SISTEMA = [
  {
    id: 'SISTEMA-CAUTELA',
    codigo: 'CAUTELA',
    nome: 'Cautela de Equipamentos',
    descricao: 'O modelo COESA de cautela. Sai com os dados do colaborador, ' +
               'os equipamentos e o campo de assinatura.',
    exigeCautela: true,
    exigeAssinatura: true,
    exigePatrimonio: false,
    exigeSerie: false,
    exigeIdentificacao: false,
    exigeDevolucao: false,
    permitePermanente: false,
    validaEntregaFisica: false
  },
  {
    id: 'SISTEMA-TERMO-TI',
    codigo: 'TI',
    nome: 'Termo de Responsabilidade \u2014 TI',
    descricao: 'O formulario oficial da COESA para equipamentos de tecnologia ' +
               'da informacao. O texto e o aprovado pela empresa.',
    /* cada uma sai de uma linha do proprio formulario: PATRIMONIO,
       NUMERO DE SERIE, a clausula de devolucao e a assinatura */
    exigeCautela: true,
    exigeAssinatura: true,
    exigePatrimonio: true,
    exigeSerie: true,
    exigeIdentificacao: false,
    exigeDevolucao: true,
    permitePermanente: false,
    validaEntregaFisica: false
  }
];

function AP_CCFG_garantirDoSistema_(payload, sessao) {
  var aba = AP_CCFG_abaModelos_();
  var idx = AP_CCFG_indice_(aba);
  var largura = aba.getLastColumn();
  var agora = AP_CCFG_agora_();
  var quem = AP_CCFG_quem_(sessao);

  var existentes = {};
  AP_CCFG_modelos_({}).forEach(function (m) {
    existentes[AP_CCFG_txt_(m.id).toUpperCase()] = m;
  });

  var criados = [], jaTinha = [];

  AP_CCFG_DO_SISTEMA.forEach(function (d) {
    if (existentes[d.id.toUpperCase()]) { jaTinha.push(d.id); return; }
    var valores = {
      ID: d.id,
      CODIGO: d.codigo,
      NOME: d.nome,
      DESCRICAO: d.descricao,
      VERSAO: 1,
      ATIVO: AP_CCFG_deBool_(true),
      STATUS: 'ATIVO',
      CRIADO_EM: agora,
      CRIADO_POR: quem,
      MOTIVO: 'modelo do sistema, gravado por garantirModelosDoSistema'
    };
    AP_CCFG_CFG.chaves.forEach(function (k) {
      valores[AP_CCFG_coluna_(k)] = AP_CCFG_deBool_(d[k] === true);
    });
    aba.appendRow(AP_CCFG_montar_(idx, largura, valores));
    criados.push(d.id);
  });

  /* RELER ANTES DE DIZER QUE GRAVOU. Linha enviada nao e linha
     gravada, e o pedido dele e explicito sobre isso. */
  var agoraTem = {};
  AP_CCFG_modelos_({}).forEach(function (m) {
    agoraTem[AP_CCFG_txt_(m.id).toUpperCase()] = m;
  });
  var faltando = [];
  AP_CCFG_DO_SISTEMA.forEach(function (d) {
    if (!agoraTem[d.id.toUpperCase()]) faltando.push(d.id);
  });
  if (faltando.length) {
    return { ok: false, codigo: 'NAO_CONFIRMOU',
      mensagem: 'Mandei a linha mas nao consegui reler ' + faltando.join(', ') +
        ' na aba ' + AP_CCFG_CFG.abaModelos + '. NAO considere gravado.' };
  }

  return { ok: true,
    dados: { criados: criados, jaTinha: jaTinha },
    mensagem: criados.length
      ? (criados.length + ' modelo(s) do sistema gravado(s): ' + criados.join(', ') +
         (jaTinha.length ? '. Ja existiam: ' + jaTinha.join(', ') + '.' : '.'))
      : 'Os modelos do sistema ja estavam gravados. Nada foi alterado.' };
}
