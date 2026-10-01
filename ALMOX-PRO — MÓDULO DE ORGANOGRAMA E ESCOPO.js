/**
 * ALMOX-PRO — MÓDULO DE ORGANOGRAMA E ESCOPO   ·  busca: [ORG-GS]
 * ETAPA 3 do projeto — organograma, equipes, escopo, limites,
 * roteamento de aprovações e validação no backend.
 *
 * O QUE FAZ
 *   Diz ONDE cada pessoa pode atuar, e QUEM aprova o quê.
 *
 *     EMPRESA → OBRA → SETOR → EQUIPE → FUNÇÃO → PESSOA
 *
 *   Guarda a estrutura, guarda os vínculos de cada usuário (um
 *   usuário pode ter mais de um), confere o escopo no servidor e
 *   determina o aprovador de uma operação a partir das regras
 *   cadastradas — nunca de uma pessoa fixa no código.
 *
 * O QUE NÃO FAZ, DE PROPÓSITO
 *   Não decide PERMISSÃO: quem decide é AP_PERMISSOES_verificar,
 *   do módulo de permissões. Aqui se decide ESCOPO, que é outra
 *   pergunta:
 *
 *     permissão → "esse perfil pode aprovar compra?"
 *     escopo    → "pode aprovar ESTA compra, DESTA obra?"
 *
 *   Não recria alçadas: as faixas de valor já moram em
 *   ALMOXA_ALCADAS, do módulo de permissões, e são consultadas
 *   pela porta pública dele. Faixa de valor escrita em dois
 *   lugares é faixa que um dia diverge.
 *
 *   Não cria usuário, sessão, login, Core, ponte nem banco.
 *   Não renomeia coluna e não apaga registro: arquiva.
 *
 * ABAS QUE CRIA (e só estas)
 *   ALMOXA_EMPRESAS    uma empresa por linha
 *   ALMOXA_OBRAS       uma obra/projeto por linha
 *   ALMOXA_SETORES     um setor por linha
 *   ALMOXA_EQUIPES     uma equipe por linha
 *   ALMOXA_VINCULOS    o escopo de cada pessoa — vários por pessoa
 *   ALMOXA_AUDITORIA   o que foi tentado, por quem, e o que deu
 *
 * INSTALAÇÃO
 *   1. Cole num arquivo novo do Apps Script.
 *   2. Rode AP_ORG_instalar.
 *   3. Publique nova versão.
 *
 * FASE DE TRANSIÇÃO — igual à do módulo de permissões
 *   Enquanto AP_ORG_estaValendo() for false, o escopo é
 *   CONFERIDO e REGISTRADO, mas não bloqueia ninguém. Você
 *   cadastra o organograma com o sistema rodando, vê na auditoria
 *   quem seria barrado, conserta o que estiver faltando, e só
 *   então roda AP_ORG_VALER(). Para voltar: AP_ORG_SOMBRA().
 *
 *   Ligar escopo de uma vez num sistema em uso tranca gente do
 *   lado de fora no meio do expediente. A sombra existe para isso.
 *
 * ONDE PROCURAR ERRO
 *   SEM_PLANILHA        não achou a planilha do sistema
 *   SEM_ABA             rode AP_ORG_instalar
 *   SEM_VINCULO         a pessoa não tem escopo cadastrado
 *   FORA_DO_ESCOPO      a pessoa existe, mas não atua ali
 *   SEM_PERMISSAO       o perfil não pode fazer isso (veio do PERM)
 *   ACIMA_DO_LIMITE     passou do teto e precisa de aprovação
 *   SEM_APROVADOR       a regra pede um perfil que ninguém ocupa
 *   PAI_NAO_EXISTE      obra sem empresa, setor sem obra, etc.
 *   EM_USO              não dá para arquivar: tem gente vinculada
 *
 * Todos os nomes começam com AORG_ ou AP_ORG_, para não colidir
 * com o Core nem com o módulo de permissões.
 */

var AORG_ABAS = {
  empresas:  'ALMOXA_EMPRESAS',
  obras:     'ALMOXA_OBRAS',
  setores:   'ALMOXA_SETORES',
  equipes:   'ALMOXA_EQUIPES',
  vinculos:  'ALMOXA_VINCULOS',
  auditoria: 'ALMOXA_AUDITORIA'
};

var AORG_COLUNAS = {
  empresas: ['id', 'nome', 'apelido', 'cnpj', 'ativo', 'observacao',
             'criadoEm', 'criadoPor', 'atualizadoEm'],

  obras: ['id', 'nome', 'codigo', 'empresa', 'endereco', 'responsavel',
          'ativo', 'observacao', 'criadoEm', 'criadoPor', 'atualizadoEm'],

  /* um setor vive dentro de uma obra. Setor de escritório, que
     atende a empresa toda, fica com obra em branco. */
  setores: ['id', 'nome', 'empresa', 'obra', 'responsavel',
            'ativo', 'observacao', 'criadoEm', 'criadoPor', 'atualizadoEm'],

  equipes: ['id', 'nome', 'empresa', 'obra', 'setor', 'lider',
            'ativo', 'observacao', 'criadoEm', 'criadoPor', 'atualizadoEm'],

  /* O ESCOPO DE CADA PESSOA.
     Uma linha por vínculo, e uma pessoa pode ter vários: quem
     roda duas obras tem duas linhas. Vínculo vazio em empresa
     significa "todas" — é assim que se representa a diretoria
     sem inventar um perfil especial. */
  vinculos: ['id', 'usuario', 'matricula', 'empresa', 'obra', 'setor',
             'equipe', 'funcao', 'nivel', 'principal', 'ativo',
             'inicio', 'fim', 'observacao', 'criadoEm', 'criadoPor'],

  /* Os campos são os do documento, nesta ordem. Sem senha,
     sem token, sem segredo — auditoria que guarda segredo vira
     o lugar mais perigoso do sistema. */
  auditoria: ['id', 'dataHora', 'usuario', 'sessao', 'empresa', 'obra',
              'setor', 'operacao', 'modulo', 'registro', 'valor',
              'resultado', 'motivo', 'aprovador', 'status', 'origem']
};

var AORG_PROP_MODO = 'ALMOXA_ORGANOGRAMA_MODO';

/** Perfis que atravessam qualquer escopo — a porta de emergência,
    a mesma ideia do APERM_SEMPRE_TOTAL. */
var AORG_SEMPRE_TOTAL = ['ti'];

/** Quanto maior, mais alto na hierarquia. Usado para subir a
    escada procurando aprovador. */
var AORG_NIVEIS = ['Auxiliar', 'Operacional', 'Técnico', 'Supervisão', 'Gestão', 'Direção'];


/* ============================================================
   1. PLANILHA E ABAS
   ------------------------------------------------------------
   Mesma planilha do Core, mesma forma de abrir que o módulo de
   permissões usa. Se o Core estiver presente, é ele quem diz
   qual é a planilha.
   ============================================================ */

function AORG_planilha_() {
  try {
    if (typeof AP_Config_getSpreadsheet_ === 'function') {
      var doCore = AP_Config_getSpreadsheet_();
      if (doCore) return doCore;
    }
  } catch (e) { }
  try {
    var ativa = SpreadsheetApp.getActiveSpreadsheet();
    if (ativa) return ativa;
  } catch (e2) { }
  return null;
}

function AORG_aba_(qual, criarSeFaltar) {
  var nome = AORG_ABAS[qual];
  if (!nome) return null;
  var pl = AORG_planilha_();
  if (!pl) return null;

  var aba = pl.getSheetByName(nome);
  if (!aba && criarSeFaltar) {
    aba = pl.insertSheet(nome);
    var colunas = AORG_COLUNAS[qual];
    aba.getRange(1, 1, 1, colunas.length).setValues([colunas]);
    try {
      aba.getRange(1, 1, 1, colunas.length).setFontWeight('bold');
      aba.setFrozenRows(1);
    } catch (e) { }
  }
  return aba || null;
}

/**
 * Cabeçalho que falta entra NO FIM. Coluna existente não é
 * renomeada nem movida: embaixo dela há dados, e mover cabeçalho
 * sem mover dado é a forma mais rápida de um sistema passar a
 * mentir.
 */
function AORG_conferirCabecalho_(qual) {
  var aba = AORG_aba_(qual, true);
  if (!aba) return { ok: false, acrescentadas: [] };

  var esperadas = AORG_COLUNAS[qual];
  var largura = aba.getLastColumn();
  var atuais = largura > 0
    ? aba.getRange(1, 1, 1, largura).getValues()[0].map(AORG_texto_)
    : [];
  while (atuais.length && atuais[atuais.length - 1] === '') atuais.pop();

  if (!atuais.length) {
    aba.getRange(1, 1, 1, esperadas.length).setValues([esperadas]);
    return { ok: true, acrescentadas: esperadas.slice() };
  }

  var faltando = esperadas.filter(function (c) { return atuais.indexOf(c) === -1; });
  if (faltando.length) {
    aba.getRange(1, atuais.length + 1, 1, faltando.length).setValues([faltando]);
  }
  return { ok: true, acrescentadas: faltando };
}

/** Devolve as linhas como objetos. null quer dizer "aba não existe". */
function AORG_linhas_(qual) {
  var aba = AORG_aba_(qual, false);
  if (!aba) return null;
  if (aba.getLastRow() < 2) return [];

  var largura = aba.getLastColumn();
  var tudo = aba.getRange(1, 1, aba.getLastRow(), largura).getValues();
  var cabecalho = tudo[0].map(AORG_texto_);

  var saida = [];
  for (var i = 1; i < tudo.length; i++) {
    var vazia = true;
    var o = { __linha: i + 1 };
    for (var c = 0; c < cabecalho.length; c++) {
      if (!cabecalho[c]) continue;
      o[cabecalho[c]] = tudo[i][c];
      if (AORG_texto_(tudo[i][c]) !== '') vazia = false;
    }
    if (!vazia) saida.push(o);
  }
  return saida;
}

function AORG_escrever_(qual, registro) {
  var aba = AORG_aba_(qual, true);
  if (!aba) return null;
  var cabecalho = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0].map(AORG_texto_);
  var linha = cabecalho.map(function (c) {
    return registro[c] === undefined || registro[c] === null ? '' : registro[c];
  });
  aba.appendRow(linha);
  return registro;
}

/** Altera uma linha inteira de uma vez: ou entra tudo, ou nada. */
function AORG_atualizar_(qual, id, mudancas) {
  var aba = AORG_aba_(qual, false);
  if (!aba) return null;
  var linhas = AORG_linhas_(qual);
  if (!linhas) return null;

  var alvo = linhas.filter(function (x) { return AORG_texto_(x.id) === AORG_texto_(id); })[0];
  if (!alvo) return null;

  var cabecalho = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0].map(AORG_texto_);
  var atual = aba.getRange(alvo.__linha, 1, 1, cabecalho.length).getValues()[0];

  for (var campo in mudancas) {
    if (!mudancas.hasOwnProperty(campo)) continue;
    var i = cabecalho.indexOf(campo);
    if (i > -1) atual[i] = mudancas[campo];
  }
  var iAtualizado = cabecalho.indexOf('atualizadoEm');
  if (iAtualizado > -1) atual[iAtualizado] = AORG_agora_();

  aba.getRange(alvo.__linha, 1, 1, cabecalho.length).setValues([atual]);
  return true;
}


/* ============================================================
   2. PEÇAS PEQUENAS
   ============================================================ */

function AORG_texto_(v) {
  return String(v === undefined || v === null ? '' : v).trim();
}

function AORG_sim_(v) {
  var t = AORG_texto_(v).toLowerCase();
  return t === 'sim' || t === 'true' || t === '1' || t === 'x' || t === 's' || v === true;
}

function AORG_agora_() {
  var fuso = 'America/Manaus';
  try { fuso = Session.getScriptTimeZone() || fuso; } catch (e) { }
  return Utilities.formatDate(new Date(), fuso, 'yyyy-MM-dd HH:mm:ss');
}

/** Data que volta do Sheets às vezes é Date, às vezes texto.
    Comparar os dois formatos como texto dá resposta errada sem
    avisar, então tudo passa por aqui antes de comparar. */
function AORG_quando_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return '';
    var fuso = 'America/Manaus';
    try { fuso = Session.getScriptTimeZone() || fuso; } catch (e) { }
    return Utilities.formatDate(v, fuso, 'yyyy-MM-dd HH:mm:ss');
  }
  return AORG_texto_(v);
}

var AORG_CONTADOR = 0;
function AORG_id_(prefixo) {
  AORG_CONTADOR = (AORG_CONTADOR + 1) % 46656;
  var t = new Date().getTime().toString(36).toUpperCase();
  var c = AORG_CONTADOR.toString(36).toUpperCase();
  while (c.length < 3) c = '0' + c;
  var r = Math.floor(Math.random() * 46656).toString(36).toUpperCase();
  while (r.length < 3) r = '0' + r;
  return (prefixo || 'ID') + '-' + t + '-' + c + r;
}

function AORG_quemSou_() {
  try { return Session.getActiveUser().getEmail() || 'sistema'; } catch (e) { return 'sistema'; }
}

function AORG_ok_(dados, mensagem) {
  return { ok: true, codigo: 'OK', mensagem: mensagem || '', dados: dados === undefined ? null : dados };
}

function AORG_erro_(codigo, mensagem, extra) {
  var r = { ok: false, codigo: codigo, mensagem: mensagem, dados: null };
  if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) r[k] = extra[k];
  return r;
}

function AORG_nivelDe_(nome) {
  var i = AORG_NIVEIS.indexOf(AORG_texto_(nome));
  return i < 0 ? 0 : i;
}


/* ============================================================
   3. INSTALAÇÃO
   ============================================================ */

function AP_ORG_instalar() {
  var pl = AORG_planilha_();
  if (!pl) {
    return AORG_erro_('SEM_PLANILHA',
      'Não achei a planilha do sistema. Abra o editor pela planilha do ALMOX.');
  }

  var criadas = [], conferidas = [], acrescentadas = [];
  for (var qual in AORG_ABAS) {
    if (!AORG_ABAS.hasOwnProperty(qual)) continue;
    var existia = !!pl.getSheetByName(AORG_ABAS[qual]);
    var r = AORG_conferirCabecalho_(qual);
    if (existia) {
      conferidas.push(AORG_ABAS[qual]);
      if (r.acrescentadas.length) {
        acrescentadas.push(AORG_ABAS[qual] + ': ' + r.acrescentadas.join(', '));
      }
    } else {
      criadas.push(AORG_ABAS[qual]);
    }
  }

  /* modo sombra de fábrica: ninguém é barrado enquanto o
     organograma não estiver cadastrado */
  try {
    var props = PropertiesService.getScriptProperties();
    if (!props.getProperty(AORG_PROP_MODO)) props.setProperty(AORG_PROP_MODO, 'SOMBRA');
  } catch (e) { }

  var temPermissoes = (typeof AP_PERMISSOES_verificar === 'function');

  return AORG_ok_({
    criadas: criadas,
    conferidas: conferidas,
    colunasAcrescentadas: acrescentadas,
    modo: AORG_modo_(),
    moduloDePermissoes: temPermissoes ? 'presente' : 'AUSENTE'
  }, criadas.length
      ? criadas.length + ' aba(s) criada(s). O escopo está em modo SOMBRA: confere e registra, mas não bloqueia.'
      : 'Tudo já existia. Nada foi recriado.');
}

function AORG_modo_() {
  try {
    return PropertiesService.getScriptProperties().getProperty(AORG_PROP_MODO) || 'SOMBRA';
  } catch (e) { return 'SOMBRA'; }
}

function AP_ORG_estaValendo() { return AORG_modo_() === 'VALENDO'; }

function AP_ORG_VALER() {
  /* não deixa ligar com a casa vazia: ligar escopo sem vínculo
     cadastrado tranca todo mundo para fora de uma vez */
  var vinculos = AORG_linhas_('vinculos');
  if (vinculos === null) {
    return AORG_erro_('SEM_ABA', 'Rode AP_ORG_instalar antes.');
  }
  var ativos = vinculos.filter(function (v) { return AORG_sim_(v.ativo); });
  if (!ativos.length) {
    return AORG_erro_('SEM_VINCULO',
      'Não há nenhum vínculo ativo cadastrado. Ligar o escopo agora deixaria ' +
      'todo mundo sem poder operar. Cadastre o organograma primeiro.');
  }
  try { PropertiesService.getScriptProperties().setProperty(AORG_PROP_MODO, 'VALENDO'); } catch (e) { }
  return AORG_ok_({ modo: 'VALENDO', vinculosAtivos: ativos.length },
    'O escopo passou a valer. Quem estiver fora do escopo será barrado a partir de agora.');
}

function AP_ORG_SOMBRA() {
  try { PropertiesService.getScriptProperties().setProperty(AORG_PROP_MODO, 'SOMBRA'); } catch (e) { }
  return AORG_ok_({ modo: 'SOMBRA' },
    'Voltou para sombra: o escopo continua sendo conferido e registrado, mas não bloqueia.');
}


/* ============================================================
   4. O ORGANOGRAMA — empresa, obra, setor, equipe
   ------------------------------------------------------------
   Regras que valem para os quatro:
     · nada nasce órfão: obra exige empresa que existe, setor
       exige obra ou empresa, equipe exige setor;
     · nada é apagado: é arquivado (ativo = Nao);
     · nada é arquivado com gente dentro — isso deixaria vínculo
       apontando para o nada, que é como auditoria fica furada.
   ============================================================ */

function AORG_empresaPublica_(e) {
  return {
    id: AORG_texto_(e.id), nome: AORG_texto_(e.nome),
    apelido: AORG_texto_(e.apelido), cnpj: AORG_texto_(e.cnpj),
    ativo: AORG_sim_(e.ativo), observacao: AORG_texto_(e.observacao)
  };
}

function AORG_obraPublica_(o) {
  return {
    id: AORG_texto_(o.id), nome: AORG_texto_(o.nome), codigo: AORG_texto_(o.codigo),
    empresa: AORG_texto_(o.empresa), endereco: AORG_texto_(o.endereco),
    responsavel: AORG_texto_(o.responsavel), ativo: AORG_sim_(o.ativo),
    observacao: AORG_texto_(o.observacao)
  };
}

function AORG_setorPublico_(s) {
  return {
    id: AORG_texto_(s.id), nome: AORG_texto_(s.nome),
    empresa: AORG_texto_(s.empresa), obra: AORG_texto_(s.obra),
    responsavel: AORG_texto_(s.responsavel), ativo: AORG_sim_(s.ativo),
    observacao: AORG_texto_(s.observacao)
  };
}

function AORG_equipePublica_(q) {
  return {
    id: AORG_texto_(q.id), nome: AORG_texto_(q.nome),
    empresa: AORG_texto_(q.empresa), obra: AORG_texto_(q.obra),
    setor: AORG_texto_(q.setor), lider: AORG_texto_(q.lider),
    ativo: AORG_sim_(q.ativo), observacao: AORG_texto_(q.observacao)
  };
}

function AORG_acharAtivo_(qual, id) {
  var linhas = AORG_linhas_(qual);
  if (!linhas) return null;
  return linhas.filter(function (x) {
    return AORG_texto_(x.id) === AORG_texto_(id) && AORG_sim_(x.ativo);
  })[0] || null;
}

function AORG_listar_(qual, publica, filtro) {
  var linhas = AORG_linhas_(qual);
  if (linhas === null) return AORG_erro_('SEM_ABA', 'Rode AP_ORG_instalar no Apps Script.');
  filtro = filtro || {};

  var saida = linhas.map(publica).filter(function (x) {
    if (!filtro.incluirArquivados && !x.ativo) return false;
    if (filtro.empresa && AORG_texto_(x.empresa) !== AORG_texto_(filtro.empresa)) return false;
    if (filtro.obra && AORG_texto_(x.obra) !== AORG_texto_(filtro.obra)) return false;
    if (filtro.setor && AORG_texto_(x.setor) !== AORG_texto_(filtro.setor)) return false;
    return true;
  });
  return AORG_ok_(saida);
}

/* ---------- salvar (cria ou altera) ---------- */

function AORG_salvarEmpresa_(p, quem) {
  p = p || {};
  var nome = AORG_texto_(p.nome);
  if (!nome) return AORG_erro_('FALTA_NOME', 'A empresa precisa de um nome.');

  if (AORG_texto_(p.id)) {
    var ok = AORG_atualizar_('empresas', p.id, {
      nome: nome, apelido: AORG_texto_(p.apelido), cnpj: AORG_texto_(p.cnpj),
      observacao: AORG_texto_(p.observacao)
    });
    if (!ok) return AORG_erro_('NAO_ENCONTRADO', 'Não achei a empresa ' + p.id + '.');
    return AORG_ok_({ id: AORG_texto_(p.id), criado: false });
  }

  var iguais = (AORG_linhas_('empresas') || []).filter(function (e) {
    return AORG_texto_(e.nome).toLowerCase() === nome.toLowerCase() && AORG_sim_(e.ativo);
  });
  if (iguais.length) {
    return AORG_erro_('JA_EXISTE', 'Já existe uma empresa ativa chamada "' + nome + '".');
  }

  var id = AORG_id_('EMP');
  AORG_escrever_('empresas', {
    id: id, nome: nome, apelido: AORG_texto_(p.apelido), cnpj: AORG_texto_(p.cnpj),
    ativo: 'Sim', observacao: AORG_texto_(p.observacao),
    criadoEm: AORG_agora_(), criadoPor: quem || AORG_quemSou_(), atualizadoEm: AORG_agora_()
  });
  return AORG_ok_({ id: id, criado: true });
}

function AORG_salvarObra_(p, quem) {
  p = p || {};
  var nome = AORG_texto_(p.nome);
  var empresa = AORG_texto_(p.empresa);
  if (!nome) return AORG_erro_('FALTA_NOME', 'A obra precisa de um nome.');
  if (!empresa) return AORG_erro_('FALTA_EMPRESA', 'A obra precisa estar numa empresa.');
  if (!AORG_acharAtivo_('empresas', empresa)) {
    return AORG_erro_('PAI_NAO_EXISTE', 'A empresa ' + empresa + ' não existe ou está arquivada.');
  }

  if (AORG_texto_(p.id)) {
    var ok = AORG_atualizar_('obras', p.id, {
      nome: nome, codigo: AORG_texto_(p.codigo), empresa: empresa,
      endereco: AORG_texto_(p.endereco), responsavel: AORG_texto_(p.responsavel),
      observacao: AORG_texto_(p.observacao)
    });
    if (!ok) return AORG_erro_('NAO_ENCONTRADO', 'Não achei a obra ' + p.id + '.');
    return AORG_ok_({ id: AORG_texto_(p.id), criado: false });
  }

  var codigo = AORG_texto_(p.codigo);
  if (codigo) {
    var repetido = (AORG_linhas_('obras') || []).filter(function (o) {
      return AORG_texto_(o.codigo).toLowerCase() === codigo.toLowerCase() && AORG_sim_(o.ativo);
    });
    if (repetido.length) {
      return AORG_erro_('JA_EXISTE', 'Já existe uma obra ativa com o código "' + codigo + '".');
    }
  }

  var id = AORG_id_('OBR');
  AORG_escrever_('obras', {
    id: id, nome: nome, codigo: codigo, empresa: empresa,
    endereco: AORG_texto_(p.endereco), responsavel: AORG_texto_(p.responsavel),
    ativo: 'Sim', observacao: AORG_texto_(p.observacao),
    criadoEm: AORG_agora_(), criadoPor: quem || AORG_quemSou_(), atualizadoEm: AORG_agora_()
  });
  return AORG_ok_({ id: id, criado: true });
}

function AORG_salvarSetor_(p, quem) {
  p = p || {};
  var nome = AORG_texto_(p.nome);
  var empresa = AORG_texto_(p.empresa);
  var obra = AORG_texto_(p.obra);
  if (!nome) return AORG_erro_('FALTA_NOME', 'O setor precisa de um nome.');
  if (!empresa && !obra) {
    return AORG_erro_('FALTA_PAI', 'O setor precisa estar numa obra, ou numa empresa quando for de escritório.');
  }
  if (obra) {
    var o = AORG_acharAtivo_('obras', obra);
    if (!o) return AORG_erro_('PAI_NAO_EXISTE', 'A obra ' + obra + ' não existe ou está arquivada.');
    empresa = empresa || AORG_texto_(o.empresa);
  } else if (!AORG_acharAtivo_('empresas', empresa)) {
    return AORG_erro_('PAI_NAO_EXISTE', 'A empresa ' + empresa + ' não existe ou está arquivada.');
  }

  if (AORG_texto_(p.id)) {
    var ok = AORG_atualizar_('setores', p.id, {
      nome: nome, empresa: empresa, obra: obra,
      responsavel: AORG_texto_(p.responsavel), observacao: AORG_texto_(p.observacao)
    });
    if (!ok) return AORG_erro_('NAO_ENCONTRADO', 'Não achei o setor ' + p.id + '.');
    return AORG_ok_({ id: AORG_texto_(p.id), criado: false });
  }

  var id = AORG_id_('SET');
  AORG_escrever_('setores', {
    id: id, nome: nome, empresa: empresa, obra: obra,
    responsavel: AORG_texto_(p.responsavel), ativo: 'Sim',
    observacao: AORG_texto_(p.observacao),
    criadoEm: AORG_agora_(), criadoPor: quem || AORG_quemSou_(), atualizadoEm: AORG_agora_()
  });
  return AORG_ok_({ id: id, criado: true });
}

function AORG_salvarEquipe_(p, quem) {
  p = p || {};
  var nome = AORG_texto_(p.nome);
  var setor = AORG_texto_(p.setor);
  if (!nome) return AORG_erro_('FALTA_NOME', 'A equipe precisa de um nome.');
  if (!setor) return AORG_erro_('FALTA_SETOR', 'A equipe precisa estar num setor.');

  var s = AORG_acharAtivo_('setores', setor);
  if (!s) return AORG_erro_('PAI_NAO_EXISTE', 'O setor ' + setor + ' não existe ou está arquivado.');

  if (AORG_texto_(p.id)) {
    var ok = AORG_atualizar_('equipes', p.id, {
      nome: nome, setor: setor, empresa: AORG_texto_(s.empresa), obra: AORG_texto_(s.obra),
      lider: AORG_texto_(p.lider), observacao: AORG_texto_(p.observacao)
    });
    if (!ok) return AORG_erro_('NAO_ENCONTRADO', 'Não achei a equipe ' + p.id + '.');
    return AORG_ok_({ id: AORG_texto_(p.id), criado: false });
  }

  var id = AORG_id_('EQP');
  AORG_escrever_('equipes', {
    id: id, nome: nome, empresa: AORG_texto_(s.empresa), obra: AORG_texto_(s.obra),
    setor: setor, lider: AORG_texto_(p.lider), ativo: 'Sim',
    observacao: AORG_texto_(p.observacao),
    criadoEm: AORG_agora_(), criadoPor: quem || AORG_quemSou_(), atualizadoEm: AORG_agora_()
  });
  return AORG_ok_({ id: id, criado: true });
}

/* ---------- arquivar: nunca apagar ---------- */

function AORG_quemDepende_(qual, id) {
  var presos = [];
  function conta(outra, campo, rotulo) {
    var linhas = AORG_linhas_(outra) || [];
    var n = linhas.filter(function (x) {
      return AORG_texto_(x[campo]) === AORG_texto_(id) && AORG_sim_(x.ativo);
    }).length;
    if (n) presos.push(n + ' ' + rotulo);
  }
  if (qual === 'empresas') { conta('obras', 'empresa', 'obra(s)'); conta('setores', 'empresa', 'setor(es)'); }
  if (qual === 'obras')    { conta('setores', 'obra', 'setor(es)'); conta('equipes', 'obra', 'equipe(s)'); }
  if (qual === 'setores')  { conta('equipes', 'setor', 'equipe(s)'); }

  var campoNoVinculo = { empresas: 'empresa', obras: 'obra', setores: 'setor', equipes: 'equipe' }[qual];
  if (campoNoVinculo) {
    var v = (AORG_linhas_('vinculos') || []).filter(function (x) {
      return AORG_texto_(x[campoNoVinculo]) === AORG_texto_(id) && AORG_sim_(x.ativo);
    }).length;
    if (v) presos.push(v + ' pessoa(s) vinculada(s)');
  }
  return presos;
}

function AORG_arquivar_(qual, p) {
  p = p || {};
  var id = AORG_texto_(p.id);
  if (!id) return AORG_erro_('FALTA_ID', 'Diga o que arquivar.');

  var linhas = AORG_linhas_(qual);
  if (linhas === null) return AORG_erro_('SEM_ABA', 'Rode AP_ORG_instalar no Apps Script.');
  var alvo = linhas.filter(function (x) { return AORG_texto_(x.id) === id; })[0];
  if (!alvo) return AORG_erro_('NAO_ENCONTRADO', 'Não achei ' + id + '.');

  var presos = AORG_quemDepende_(qual, id);
  if (presos.length && !p.forcar) {
    return AORG_erro_('EM_USO',
      'Não dá para arquivar: ainda tem ' + presos.join(', ') + ' aqui dentro. ' +
      'Mova ou arquive isso primeiro — senão fica registro apontando para o nada.');
  }

  AORG_atualizar_(qual, id, { ativo: 'Nao' });
  return AORG_ok_({ id: id, arquivado: true },
    'Arquivado. O histórico continua: nada foi apagado.');
}


/* ============================================================
   5. VÍNCULOS — o escopo de cada pessoa
   ------------------------------------------------------------
   Uma pessoa pode ter vários. Quem toca duas obras tem duas
   linhas; ninguém precisa de um perfil inventado para isso.

   Campo em branco quer dizer "toda a camada de cima": vínculo
   com empresa e obra em branco é alguém da diretoria, que
   enxerga a empresa inteira. Isso é decisão, não descuido — e
   está escrito aqui para ninguém depois achar que é bug.
   ============================================================ */

function AORG_vinculoPublico_(v) {
  return {
    id: AORG_texto_(v.id), usuario: AORG_texto_(v.usuario),
    matricula: AORG_texto_(v.matricula), empresa: AORG_texto_(v.empresa),
    obra: AORG_texto_(v.obra), setor: AORG_texto_(v.setor),
    equipe: AORG_texto_(v.equipe), funcao: AORG_texto_(v.funcao),
    nivel: AORG_texto_(v.nivel), principal: AORG_sim_(v.principal),
    ativo: AORG_sim_(v.ativo), inicio: AORG_quando_(v.inicio),
    fim: AORG_quando_(v.fim), observacao: AORG_texto_(v.observacao)
  };
}

/** Vínculo vencido não vale, mesmo marcado como ativo. */
function AORG_vinculoVale_(v) {
  if (!v.ativo) return false;
  var fim = AORG_texto_(v.fim);
  if (fim && fim < AORG_agora_().substring(0, 10)) return false;
  var inicio = AORG_texto_(v.inicio);
  if (inicio && inicio > AORG_agora_().substring(0, 10)) return false;
  return true;
}

function AORG_vincular_(p, quem) {
  p = p || {};
  var usuario = AORG_texto_(p.usuario);
  if (!usuario) return AORG_erro_('FALTA_USUARIO', 'Diga de quem é o vínculo.');

  var empresa = AORG_texto_(p.empresa);
  var obra = AORG_texto_(p.obra);
  var setor = AORG_texto_(p.setor);
  var equipe = AORG_texto_(p.equipe);

  /* cada pedaço citado tem que existir de verdade */
  if (equipe) {
    var q = AORG_acharAtivo_('equipes', equipe);
    if (!q) return AORG_erro_('PAI_NAO_EXISTE', 'A equipe ' + equipe + ' não existe ou está arquivada.');
    setor = setor || AORG_texto_(q.setor);
    obra = obra || AORG_texto_(q.obra);
    empresa = empresa || AORG_texto_(q.empresa);
  }
  if (setor) {
    var s = AORG_acharAtivo_('setores', setor);
    if (!s) return AORG_erro_('PAI_NAO_EXISTE', 'O setor ' + setor + ' não existe ou está arquivado.');
    obra = obra || AORG_texto_(s.obra);
    empresa = empresa || AORG_texto_(s.empresa);
  }
  if (obra) {
    var o = AORG_acharAtivo_('obras', obra);
    if (!o) return AORG_erro_('PAI_NAO_EXISTE', 'A obra ' + obra + ' não existe ou está arquivada.');
    empresa = empresa || AORG_texto_(o.empresa);
  }
  if (empresa && !AORG_acharAtivo_('empresas', empresa)) {
    return AORG_erro_('PAI_NAO_EXISTE', 'A empresa ' + empresa + ' não existe ou está arquivada.');
  }

  if (AORG_texto_(p.id)) {
    var ok = AORG_atualizar_('vinculos', p.id, {
      empresa: empresa, obra: obra, setor: setor, equipe: equipe,
      funcao: AORG_texto_(p.funcao), nivel: AORG_texto_(p.nivel),
      principal: p.principal ? 'Sim' : 'Nao',
      inicio: AORG_texto_(p.inicio), fim: AORG_texto_(p.fim),
      observacao: AORG_texto_(p.observacao)
    });
    if (!ok) return AORG_erro_('NAO_ENCONTRADO', 'Não achei o vínculo ' + p.id + '.');
    return AORG_ok_({ id: AORG_texto_(p.id), criado: false });
  }

  /* vínculo repetido não é erro de quem cadastra: é ruído que
     depois vira contagem errada em relatório */
  var repetido = (AORG_linhas_('vinculos') || []).filter(function (v) {
    return AORG_sim_(v.ativo)
      && AORG_texto_(v.usuario) === usuario
      && AORG_texto_(v.empresa) === empresa
      && AORG_texto_(v.obra) === obra
      && AORG_texto_(v.setor) === setor
      && AORG_texto_(v.equipe) === equipe;
  });
  if (repetido.length) {
    return AORG_erro_('JA_EXISTE', 'Essa pessoa já tem exatamente esse vínculo.');
  }

  var id = AORG_id_('VIN');
  AORG_escrever_('vinculos', {
    id: id, usuario: usuario, matricula: AORG_texto_(p.matricula),
    empresa: empresa, obra: obra, setor: setor, equipe: equipe,
    funcao: AORG_texto_(p.funcao), nivel: AORG_texto_(p.nivel),
    principal: p.principal ? 'Sim' : 'Nao', ativo: 'Sim',
    inicio: AORG_texto_(p.inicio), fim: AORG_texto_(p.fim),
    observacao: AORG_texto_(p.observacao),
    criadoEm: AORG_agora_(), criadoPor: quem || AORG_quemSou_()
  });
  return AORG_ok_({ id: id, criado: true });
}

function AORG_desvincular_(p) {
  p = p || {};
  var id = AORG_texto_(p.id);
  if (!id) return AORG_erro_('FALTA_ID', 'Diga qual vínculo encerrar.');
  var ok = AORG_atualizar_('vinculos', id, {
    ativo: 'Nao', fim: AORG_texto_(p.fim) || AORG_agora_().substring(0, 10)
  });
  if (!ok) return AORG_erro_('NAO_ENCONTRADO', 'Não achei o vínculo ' + id + '.');
  return AORG_ok_({ id: id },
    'Vínculo encerrado. A linha continua no histórico, com a data do fim.');
}

/** Todos os vínculos que valem hoje para uma pessoa. */
function AP_ORG_escopoDe(usuario) {
  var linhas = AORG_linhas_('vinculos');
  if (linhas === null) return null;
  var u = AORG_texto_(usuario);
  return linhas.map(AORG_vinculoPublico_).filter(function (v) {
    return (v.usuario === u || (v.matricula && v.matricula === u)) && AORG_vinculoVale_(v);
  });
}

function AORG_escopoPara_(p) {
  var usuario = AORG_texto_((p || {}).usuario);
  if (!usuario) return AORG_erro_('FALTA_USUARIO', 'Diga de quem é o escopo.');
  var v = AP_ORG_escopoDe(usuario);
  if (v === null) return AORG_erro_('SEM_ABA', 'Rode AP_ORG_instalar no Apps Script.');
  return AORG_ok_({ usuario: usuario, vinculos: v, quantos: v.length });
}


/* ============================================================
   6. O ESCOPO VALE PARA ESTE REGISTRO?
   ------------------------------------------------------------
   A pergunta não é "esse perfil pode aprovar compra" — isso é
   permissão, e quem responde é o módulo de permissões. A
   pergunta aqui é: "pode mexer NESTE registro, DESTA obra?"
   ============================================================ */

function AORG_vinculoCobre_(v, alvo) {
  /* campo em branco no vínculo = vale para toda a camada abaixo */
  if (v.empresa && alvo.empresa && v.empresa !== alvo.empresa) return false;
  if (v.obra && alvo.obra && v.obra !== alvo.obra) return false;
  if (v.setor && alvo.setor && v.setor !== alvo.setor) return false;
  if (v.equipe && alvo.equipe && v.equipe !== alvo.equipe) return false;

  /* o contrário também vale: vínculo preso a uma obra não cobre
     registro que não diz de que obra é */
  if (v.obra && !alvo.obra && alvo.exigeObra) return false;
  return true;
}

function AP_ORG_dentroDoEscopo(usuario, alvo, perfil) {
  alvo = alvo || {};
  if (AORG_SEMPRE_TOTAL.indexOf(AORG_texto_(perfil)) > -1) {
    return { ok: true, dentro: true, motivo: 'perfil de emergência', vinculo: null };
  }

  var vinculos = AP_ORG_escopoDe(usuario);
  if (vinculos === null) {
    return { ok: false, dentro: false, motivo: 'O módulo de organograma não está instalado.' };
  }
  if (!vinculos.length) {
    return {
      ok: false, dentro: false, codigo: 'SEM_VINCULO',
      motivo: 'Esta pessoa não tem vínculo cadastrado no organograma. ' +
        'Sem vínculo o sistema não sabe onde ela pode atuar.'
    };
  }

  for (var i = 0; i < vinculos.length; i++) {
    if (AORG_vinculoCobre_(vinculos[i], alvo)) {
      return { ok: true, dentro: true, vinculo: vinculos[i], motivo: '' };
    }
  }

  var onde = [];
  if (alvo.obra) onde.push('obra ' + alvo.obra);
  if (alvo.setor) onde.push('setor ' + alvo.setor);
  return {
    ok: false, dentro: false, codigo: 'FORA_DO_ESCOPO',
    motivo: 'Esta pessoa não atua ' + (onde.length ? 'na ' + onde.join(', ') : 'nesse lugar') + '.',
    vinculo: null
  };
}


/* ============================================================
   7. LIMITES E ROTEAMENTO
   ------------------------------------------------------------
   As faixas de valor moram em ALMOXA_ALCADAS, do módulo de
   permissões. Aqui não se recria faixa nenhuma: pergunta-se a
   ele. O que esta etapa acrescenta é transformar o PERFIL que a
   alçada devolve em PESSOA, usando o organograma — e é isso que
   faltava para a aprovação não ir sempre para o mesmo fulano
   escrito no código.
   ============================================================ */

function AORG_alcadaDoPermissoes_(pedido) {
  if (typeof APERM_alcadaPara_ !== 'function') {
    return { ok: false, codigo: 'SEM_PERMISSOES',
      mensagem: 'O módulo de permissões não está instalado: sem ele não há faixa de alçada.' };
  }
  return APERM_alcadaPara_({
    valor: pedido.valor, categoria: pedido.categoria,
    obra: pedido.obra, modulo: pedido.modulo
  });
}

/**
 * Quem, de carne e osso, aprova isto.
 *
 * Sobe a escada: primeiro alguém do setor, depois da obra, depois
 * da empresa. Quem está mais perto do trabalho decide primeiro —
 * e só sobe quando lá embaixo não tem ninguém com aquele perfil.
 */
function AORG_pessoasComPerfil_(perfilAprovador, alvo) {
  var vinculos = AORG_linhas_('vinculos');
  if (vinculos === null) return [];
  var perfilAlvo = AORG_texto_(perfilAprovador).toLowerCase();

  var candidatos = vinculos.map(AORG_vinculoPublico_).filter(AORG_vinculoVale_);

  /* o perfil da pessoa não mora no vínculo, e sim no cadastro de
     usuários do Core. Quando o Core está presente, é dele que
     vem; quando não, cai para a função do vínculo — que é o que
     existe aqui dentro. */
  function perfilDe(v) {
    try {
      if (typeof AP_ORG_perfilDoUsuario === 'function') {
        var p = AP_ORG_perfilDoUsuario(v.usuario);
        if (p) return String(p).toLowerCase();
      }
    } catch (e) { }
    return AORG_texto_(v.funcao).toLowerCase();
  }

  var doSetor = [], daObra = [], daEmpresa = [];
  for (var i = 0; i < candidatos.length; i++) {
    var v = candidatos[i];
    if (perfilDe(v) !== perfilAlvo) continue;

    if (alvo.setor && v.setor === alvo.setor) doSetor.push(v);
    else if (alvo.obra && v.obra === alvo.obra) daObra.push(v);
    else if (alvo.empresa && (!v.empresa || v.empresa === alvo.empresa)) daEmpresa.push(v);
  }

  function porNivel(a, b) { return AORG_nivelDe_(b.nivel) - AORG_nivelDe_(a.nivel); }
  doSetor.sort(porNivel); daObra.sort(porNivel); daEmpresa.sort(porNivel);

  return doSetor.concat(daObra).concat(daEmpresa);
}

function AP_ORG_aprovadorPara(pedido) {
  pedido = pedido || {};
  var alvo = {
    empresa: AORG_texto_(pedido.empresa),
    obra: AORG_texto_(pedido.obra),
    setor: AORG_texto_(pedido.setor)
  };

  var alcada = AORG_alcadaDoPermissoes_(pedido);
  if (!alcada.ok) {
    return AORG_erro_(alcada.codigo || 'SEM_REGRA',
      alcada.mensagem || 'Nenhuma regra de alçada cobre este valor.');
  }

  var regra = alcada.dados;
  var pessoas = AORG_pessoasComPerfil_(regra.perfilAprovador, alvo);

  if (!pessoas.length) {
    return AORG_erro_('SEM_APROVADOR',
      'A regra "' + regra.nome + '" manda aprovar com o perfil "' + regra.perfilAprovador +
      '", mas não há ninguém com esse perfil nesta obra nem acima dela. ' +
      'Cadastre o responsável no organograma, ou ajuste a regra.',
      { regra: regra });
  }

  var quantos = Math.max(1, Number(regra.aprovadores) || 1);
  var escolhidos = pessoas.slice(0, quantos);

  return AORG_ok_({
    regra: regra.nome,
    faixa: regra.faixa,
    perfilAprovador: regra.perfilAprovador,
    aprovadoresNecessarios: quantos,
    aprovadores: escolhidos.map(function (v) {
      return {
        usuario: v.usuario, matricula: v.matricula, funcao: v.funcao,
        nivel: v.nivel, obra: v.obra, setor: v.setor,
        deOnde: (alvo.setor && v.setor === alvo.setor) ? 'do setor'
              : (alvo.obra && v.obra === alvo.obra) ? 'da obra' : 'da empresa'
      };
    }),
    suplentes: Math.max(0, pessoas.length - quantos)
  }, quantos > escolhidos.length
      ? 'A regra pede ' + quantos + ' aprovadores e só há ' + escolhidos.length + '.'
      : '');
}


/* ============================================================
   8. A VALIDAÇÃO NO BACKEND
   ------------------------------------------------------------
   É aqui que o pedido para de ser pedido e vira autorização —
   ou recusa. O frontend pode mostrar as regras; ele não decide.
   Se alguém mexer no navegador e mandar direto, cai aqui do
   mesmo jeito.

   A ordem importa: primeiro quem é, depois se está ativo, depois
   se o perfil pode, depois se o lugar é dele, e só então o valor.
   Assim a mensagem que a pessoa recebe fala do primeiro problema
   de verdade, não do último.
   ============================================================ */

function AP_ORG_validarOperacao(pedido) {
  pedido = pedido || {};
  var comecou = new Date().getTime();

  var usuario = AORG_texto_(pedido.usuario);
  var perfil = AORG_texto_(pedido.perfil);
  var modulo = AORG_texto_(pedido.modulo);
  var acao = AORG_texto_(pedido.acao);
  var valor = Number(pedido.valor) || 0;

  var alvo = {
    empresa: AORG_texto_(pedido.empresa),
    obra: AORG_texto_(pedido.obra),
    setor: AORG_texto_(pedido.setor),
    equipe: AORG_texto_(pedido.equipe),
    exigeObra: !!pedido.exigeObra
  };

  function responder(r) {
    AORG_auditar_({
      usuario: usuario, sessao: AORG_texto_(pedido.sessao),
      empresa: alvo.empresa, obra: alvo.obra, setor: alvo.setor,
      operacao: acao, modulo: modulo,
      registro: AORG_texto_(pedido.registro), valor: valor,
      resultado: r.ok ? 'AUTORIZADO' : 'NEGADO',
      motivo: r.ok ? (r.dados && r.dados.observacao) || '' : r.mensagem,
      aprovador: (r.dados && r.dados.aprovadores && r.dados.aprovadores[0])
        ? r.dados.aprovadores[0].usuario : '',
      status: (r.dados && r.dados.precisaAprovacao) ? 'AGUARDANDO_APROVACAO'
        : (r.ok ? 'LIBERADO' : 'BLOQUEADO'),
      origem: AORG_texto_(pedido.origem) || 'backend'
    });
    r.ms = new Date().getTime() - comecou;
    return r;
  }

  /* ---- 1. identidade ---- */
  if (!usuario) {
    return responder(AORG_erro_('SEM_USUARIO', 'O pedido chegou sem dizer quem está fazendo.'));
  }
  if (!acao || !modulo) {
    return responder(AORG_erro_('PEDIDO_INCOMPLETO', 'O pedido precisa dizer o módulo e a ação.'));
  }

  /* ---- 2. sessão ---- */
  if (pedido.exigeSessao && !AORG_texto_(pedido.sessao)) {
    return responder(AORG_erro_('SEM_SESSAO', 'Esta operação exige login.'));
  }

  /* ---- 3. permissão: quem responde é o módulo de permissões ---- */
  var permissao = { ok: true, permitido: true, escopo: 'TODOS', limite: '' };
  if (typeof AP_PERMISSOES_verificar === 'function') {
    permissao = AP_PERMISSOES_verificar(perfil, modulo, acao, { tela: AORG_texto_(pedido.tela) });
    if (!permissao.permitido) {
      return responder(AORG_erro_('SEM_PERMISSAO', permissao.motivo || 'Perfil sem autorização.'));
    }
  }

  /* ---- 4. escopo ---- */
  var escopo = AP_ORG_dentroDoEscopo(usuario, alvo, perfil);
  var valendo = AP_ORG_estaValendo();

  if (!escopo.dentro && valendo) {
    return responder(AORG_erro_(escopo.codigo || 'FORA_DO_ESCOPO', escopo.motivo));
  }

  /* ---- 5. limite ---- */
  var teto = AORG_texto_(permissao.limite);
  var precisaAprovacao = false;
  var roteamento = null;

  if (teto !== '' && valor > Number(teto)) {
    precisaAprovacao = true;
  }
  if (pedido.sempreAprovar) precisaAprovacao = true;

  if (precisaAprovacao) {
    roteamento = AP_ORG_aprovadorPara({
      valor: valor, categoria: AORG_texto_(pedido.categoria),
      obra: alvo.obra, setor: alvo.setor, empresa: alvo.empresa, modulo: modulo
    });
    if (!roteamento.ok) {
      return responder(AORG_erro_(roteamento.codigo,
        'Esta operação passa do limite de ' + teto + ' e precisa de aprovação, mas: ' +
        roteamento.mensagem));
    }
  }

  var observacao = '';
  if (!escopo.dentro && !valendo) {
    observacao = 'MODO SOMBRA: seria barrado por escopo (' + escopo.motivo + '), mas passou.';
  }

  return responder(AORG_ok_({
    autorizado: true,
    precisaAprovacao: precisaAprovacao,
    limite: teto === '' ? null : Number(teto),
    valor: valor,
    escopo: escopo.dentro ? 'dentro' : 'fora (sombra)',
    vinculo: escopo.vinculo,
    aprovadores: roteamento ? roteamento.dados.aprovadores : [],
    regraDeAprovacao: roteamento ? roteamento.dados.regra : '',
    observacao: observacao
  }, precisaAprovacao
      ? 'Autorizado, mas segue para aprovação: passou do limite.'
      : 'Autorizado.'));
}


/* ============================================================
   9. AUDITORIA
   ------------------------------------------------------------
   Registra tentativa, não só sucesso. Auditoria que só guarda o
   que deu certo não serve para investigar nada.
   ============================================================ */

function AORG_auditar_(d) {
  try {
    d = d || {};
    AORG_escrever_('auditoria', {
      id: AORG_id_('AUD'),
      dataHora: AORG_agora_(),
      usuario: AORG_texto_(d.usuario),
      sessao: AORG_texto_(d.sessao),
      empresa: AORG_texto_(d.empresa),
      obra: AORG_texto_(d.obra),
      setor: AORG_texto_(d.setor),
      operacao: AORG_texto_(d.operacao),
      modulo: AORG_texto_(d.modulo),
      registro: AORG_texto_(d.registro),
      valor: Number(d.valor) || 0,
      resultado: AORG_texto_(d.resultado),
      motivo: AORG_texto_(d.motivo),
      aprovador: AORG_texto_(d.aprovador),
      status: AORG_texto_(d.status),
      origem: AORG_texto_(d.origem)
    });
    return true;
  } catch (e) {
    /* auditoria que derruba a operação seria pior que auditoria
       nenhuma: a obra pararia por causa do caderno de anotação */
    return false;
  }
}

function AORG_auditoria_(p) {
  p = p || {};
  var linhas = AORG_linhas_('auditoria');
  if (linhas === null) return AORG_erro_('SEM_ABA', 'Rode AP_ORG_instalar no Apps Script.');

  var quantas = Math.min(Number(p.quantas) || 100, 500);
  var filtradas = linhas.filter(function (l) {
    if (p.usuario && AORG_texto_(l.usuario) !== AORG_texto_(p.usuario)) return false;
    if (p.obra && AORG_texto_(l.obra) !== AORG_texto_(p.obra)) return false;
    if (p.resultado && AORG_texto_(l.resultado) !== AORG_texto_(p.resultado)) return false;
    return true;
  });

  return AORG_ok_(filtradas.slice(-quantas).reverse().map(function (l) {
    return {
      dataHora: AORG_quando_(l.dataHora), usuario: AORG_texto_(l.usuario),
      empresa: AORG_texto_(l.empresa), obra: AORG_texto_(l.obra),
      setor: AORG_texto_(l.setor), operacao: AORG_texto_(l.operacao),
      modulo: AORG_texto_(l.modulo), registro: AORG_texto_(l.registro),
      valor: Number(l.valor) || 0, resultado: AORG_texto_(l.resultado),
      motivo: AORG_texto_(l.motivo), aprovador: AORG_texto_(l.aprovador),
      status: AORG_texto_(l.status)
    };
  }));
}


/* ============================================================
   10. O ORGANOGRAMA INTEIRO, EM ÁRVORE
   Para a tela desenhar sem fazer seis chamadas.
   ============================================================ */

function AORG_arvore_(p) {
  p = p || {};
  var empresas = AORG_linhas_('empresas');
  if (empresas === null) return AORG_erro_('SEM_ABA', 'Rode AP_ORG_instalar no Apps Script.');

  var obras = AORG_linhas_('obras') || [];
  var setores = AORG_linhas_('setores') || [];
  var equipes = AORG_linhas_('equipes') || [];
  var vinculos = (AORG_linhas_('vinculos') || []).map(AORG_vinculoPublico_).filter(AORG_vinculoVale_);

  function gente(campo, id) {
    return vinculos.filter(function (v) { return v[campo] === id; }).length;
  }

  var arvore = empresas.map(AORG_empresaPublica_)
    .filter(function (e) { return p.incluirArquivados || e.ativo; })
    .map(function (e) {
      e.obras = obras.map(AORG_obraPublica_)
        .filter(function (o) { return o.empresa === e.id && (p.incluirArquivados || o.ativo); })
        .map(function (o) {
          o.setores = setores.map(AORG_setorPublico_)
            .filter(function (s) { return s.obra === o.id && (p.incluirArquivados || s.ativo); })
            .map(function (s) {
              s.equipes = equipes.map(AORG_equipePublica_)
                .filter(function (q) { return q.setor === s.id && (p.incluirArquivados || q.ativo); })
                .map(function (q) { q.pessoas = gente('equipe', q.id); return q; });
              s.pessoas = gente('setor', s.id);
              return s;
            });
          o.pessoas = gente('obra', o.id);
          return o;
        });
      /* setor de escritório: pendurado na empresa, sem obra */
      e.setoresDaEmpresa = setores.map(AORG_setorPublico_)
        .filter(function (s) { return s.empresa === e.id && !s.obra && (p.incluirArquivados || s.ativo); });
      e.pessoas = gente('empresa', e.id);
      return e;
    });

  /* Os vínculos JÁ foram lidos acima para contar gente em cada nó.
     Devolvê-los custa zero leitura a mais e é o que permite a tela
     mostrar QUEM está em cada setor, e não só quantos — sem uma
     consulta por pessoa. O teto existe para a resposta não crescer
     sem limite numa obra grande; passando dele, a tela mostra as
     contagens e vai buscar nome por nome quando precisar. */
  var TETO_VINCULOS = 3000;
  var enxutos = vinculos.slice(0, TETO_VINCULOS).map(function (v) {
    return {
      id: v.id, usuario: v.usuario, matricula: v.matricula,
      empresa: v.empresa, obra: v.obra, setor: v.setor, equipe: v.equipe,
      funcao: v.funcao, nivel: v.nivel, principal: v.principal
    };
  });

  return AORG_ok_({
    empresas: arvore,
    vinculos: enxutos,
    vinculosCortados: vinculos.length > TETO_VINCULOS ? vinculos.length - TETO_VINCULOS : 0,
    totais: {
      empresas: arvore.length,
      obras: obras.filter(function (o) { return AORG_sim_(o.ativo); }).length,
      setores: setores.filter(function (s) { return AORG_sim_(s.ativo); }).length,
      equipes: equipes.filter(function (q) { return AORG_sim_(q.ativo); }).length,
      pessoasVinculadas: vinculos.length
    },
    modo: AORG_modo_()
  });
}

/** O que está pela metade — para saber se dá para ligar o escopo. */
function AORG_pendencias_() {
  var problemas = [];
  var obras = AORG_linhas_('obras');
  if (obras === null) return AORG_erro_('SEM_ABA', 'Rode AP_ORG_instalar no Apps Script.');

  var empresas = (AORG_linhas_('empresas') || []).filter(function (e) { return AORG_sim_(e.ativo); });
  if (!empresas.length) problemas.push({ o_que: 'Nenhuma empresa cadastrada', gravidade: 'ALTA' });

  obras.filter(function (o) { return AORG_sim_(o.ativo); }).forEach(function (o) {
    if (!AORG_acharAtivo_('empresas', o.empresa)) {
      problemas.push({ o_que: 'A obra "' + AORG_texto_(o.nome) + '" aponta para empresa que não existe',
        gravidade: 'ALTA' });
    }
    if (!AORG_texto_(o.responsavel)) {
      problemas.push({ o_que: 'A obra "' + AORG_texto_(o.nome) + '" está sem responsável',
        gravidade: 'MEDIA' });
    }
  });

  (AORG_linhas_('setores') || []).filter(function (s) { return AORG_sim_(s.ativo); }).forEach(function (s) {
    if (AORG_texto_(s.obra) && !AORG_acharAtivo_('obras', s.obra)) {
      problemas.push({ o_que: 'O setor "' + AORG_texto_(s.nome) + '" aponta para obra que não existe',
        gravidade: 'ALTA' });
    }
  });

  var vinculos = (AORG_linhas_('vinculos') || []).map(AORG_vinculoPublico_).filter(AORG_vinculoVale_);
  if (!vinculos.length) {
    problemas.push({ o_que: 'Ninguém tem vínculo: ligar o escopo agora barraria todo mundo',
      gravidade: 'ALTA' });
  }
  vinculos.forEach(function (v) {
    if (v.obra && !AORG_acharAtivo_('obras', v.obra)) {
      problemas.push({ o_que: 'O vínculo de ' + v.usuario + ' aponta para obra que não existe',
        gravidade: 'ALTA' });
    }
  });

  return AORG_ok_({
    modo: AORG_modo_(),
    podeLigarOEscopo: problemas.filter(function (p) { return p.gravidade === 'ALTA'; }).length === 0,
    problemas: problemas
  }, problemas.length ? problemas.length + ' pendência(s).' : 'Organograma completo.');
}


/* ============================================================
   11. AS PORTAS — mesma convenção do módulo de permissões
   ============================================================ */

function AORG_atender_(acao, payload, quem) {
  payload = payload || {};
  switch (String(acao || '')) {
    case 'arvore':        return AORG_arvore_(payload);
    case 'pendencias':    return AORG_pendencias_();

    case 'empresas':      return AORG_listar_('empresas', AORG_empresaPublica_, payload);
    case 'salvarEmpresa': return AORG_salvarEmpresa_(payload, quem);
    case 'arquivarEmpresa': return AORG_arquivar_('empresas', payload);

    case 'obras':         return AORG_listar_('obras', AORG_obraPublica_, payload);
    case 'salvarObra':    return AORG_salvarObra_(payload, quem);
    case 'arquivarObra':  return AORG_arquivar_('obras', payload);

    case 'setores':       return AORG_listar_('setores', AORG_setorPublico_, payload);
    case 'salvarSetor':   return AORG_salvarSetor_(payload, quem);
    case 'arquivarSetor': return AORG_arquivar_('setores', payload);

    case 'equipes':       return AORG_listar_('equipes', AORG_equipePublica_, payload);
    case 'salvarEquipe':  return AORG_salvarEquipe_(payload, quem);
    case 'arquivarEquipe':return AORG_arquivar_('equipes', payload);

    case 'vinculos':      return AORG_escopoPara_(payload);
    case 'vincular':      return AORG_vincular_(payload, quem);
    case 'desvincular':   return AORG_desvincular_(payload);

    case 'aprovadorPara': return AP_ORG_aprovadorPara(payload);
    case 'validar':       return AP_ORG_validarOperacao(payload);
    case 'auditoria':     return AORG_auditoria_(payload);
    case 'modo':          return AORG_ok_({ modo: AORG_modo_(), valendo: AP_ORG_estaValendo() });

    default:
      return AORG_erro_('ACAO_DESCONHECIDA',
        'O módulo de organograma não conhece a ação "' + acao + '".');
  }
}

/** Nome por convenção do roteador do Core. */
function AP_Modulo_organograma(req) {
  req = req || {};
  if (typeof req === 'string') {
    try { req = JSON.parse(req); } catch (e) { req = {}; }
  }
  return AORG_atender_(req.acao, req.payload, req.sessao || req.token || '');
}

/** Porta direta, para o frontend chamar sem passar pelo roteador. */
function AP_ORG_direto(json) {
  var c = {};
  try { c = JSON.parse(json || '{}'); } catch (e) { c = {}; }
  try {
    return JSON.stringify(AORG_atender_(c.acao, c.payload, c.token || ''));
  } catch (err) {
    return JSON.stringify(AORG_erro_('ORGANOGRAMA_ERRO', String((err && err.message) || err)));
  }
}


/* ============================================================
   12. AP_ORG_testes()  —  A PROVA DA ETAPA 3
   ------------------------------------------------------------
   Roda contra uma planilha de MENTIRA. Nenhuma aba sua é criada,
   lida ou alterada: SpreadsheetApp é trocado no começo e
   devolvido no finally, aconteça o que acontecer.

   O que está sendo provado, e por quê:

   · nada nasce órfão — obra sem empresa, setor sem obra e equipe
     sem setor são recusados, porque registro apontando para o
     nada é auditoria furada depois;
   · nada é apagado com gente dentro;
   · uma pessoa pode ter dois vínculos e operar nas duas obras;
   · quem é de uma obra NÃO mexe na outra — e a mensagem diz isso
     sem revelar o que tem do outro lado;
   · em modo sombra ninguém é barrado, mas a auditoria registra
     quem SERIA — é assim que se liga escopo sem parar a obra;
   · o aprovador sai da regra e do organograma, nunca de um nome
     escrito no código;
   · a aprovação sobe a escada: setor, depois obra, depois empresa;
   · operação acima do limite não é negada em silêncio: vira
     pedido de aprovação com nome de gente;
   · toda tentativa vira linha de auditoria, inclusive as negadas.
   ============================================================ */
function AP_ORG_testes() {
  var log = [], falhas = 0;
  function ok(nome, passou, obs) {
    if (!passou) falhas++;
    log.push((passou ? 'PASSOU  ' : 'FALHOU  ') + nome + (obs ? '  [' + obs + ']' : ''));
  }

  var guardado = {
    Planilhas: (typeof SpreadsheetApp !== 'undefined') ? SpreadsheetApp : null,
    Props: (typeof PropertiesService !== 'undefined') ? PropertiesService : null,
    Utils: (typeof Utilities !== 'undefined') ? Utilities : null,
    Sessao: (typeof Session !== 'undefined') ? Session : null,
    verificar: (typeof AP_PERMISSOES_verificar === 'function') ? AP_PERMISSOES_verificar : null,
    alcada: (typeof APERM_alcadaPara_ === 'function') ? APERM_alcadaPara_ : null,
    perfilDo: (typeof AP_ORG_perfilDoUsuario === 'function') ? AP_ORG_perfilDoUsuario : null
  };

  try {
    /* ---------------- a planilha de mentira ---------------- */
    function novaAba(nome) {
      var dados = [];
      function garantir(l, c) {
        while (dados.length < l) dados.push([]);
        for (var i = 0; i < dados.length; i++) while (dados[i].length < c) dados[i].push('');
      }
      var eu = {
        __nome: nome, __dados: dados,
        getName: function () { return nome; },
        getLastRow: function () {
          var u = 0;
          for (var i = 0; i < dados.length; i++) {
            for (var j = 0; j < dados[i].length; j++) {
              if (String(dados[i][j] || '') !== '') { u = i + 1; break; }
            }
          }
          return u;
        },
        getLastColumn: function () {
          var u = 0;
          for (var i = 0; i < dados.length; i++) {
            for (var j = 0; j < dados[i].length; j++) {
              if (String(dados[i][j] || '') !== '' && j + 1 > u) u = j + 1;
            }
          }
          return u;
        },
        appendRow: function (l) { dados.push(l.slice()); return eu; },
        setFrozenRows: function () { return eu; },
        getRange: function (l, c, nl, nc) {
          nl = nl || 1; nc = nc || 1;
          return {
            getValues: function () {
              garantir(l + nl - 1, c + nc - 1);
              var s = [];
              for (var i = 0; i < nl; i++) s.push(dados[l - 1 + i].slice(c - 1, c - 1 + nc));
              return s;
            },
            setValues: function (v) {
              garantir(l + nl - 1, c + nc - 1);
              for (var i = 0; i < v.length; i++) {
                for (var j = 0; j < v[i].length; j++) dados[l - 1 + i][c - 1 + j] = v[i][j];
              }
              return this;
            },
            setFontWeight: function () { return this; }
          };
        }
      };
      return eu;
    }

    var ABAS = {};
    var planilhaFalsa = {
      getSheetByName: function (n) { return ABAS[n] || null; },
      insertSheet: function (n) { ABAS[n] = novaAba(n); return ABAS[n]; }
    };
    SpreadsheetApp = { getActiveSpreadsheet: function () { return planilhaFalsa; } };

    var props = {};
    PropertiesService = {
      getScriptProperties: function () {
        return {
          getProperty: function (k) { return props[k] === undefined ? null : props[k]; },
          setProperty: function (k, v) { props[k] = String(v); }
        };
      }
    };
    Utilities = {
      formatDate: function (d) {
        function dd(n) { return (n < 10 ? '0' : '') + n; }
        return d.getFullYear() + '-' + dd(d.getMonth() + 1) + '-' + dd(d.getDate()) +
          ' ' + dd(d.getHours()) + ':' + dd(d.getMinutes()) + ':' + dd(d.getSeconds());
      }
    };
    Session = {
      getActiveUser: function () { return { getEmail: function () { return 'teste@coesa'; } }; },
      getScriptTimeZone: function () { return 'America/Manaus'; }
    };

    function linhasDe(qual) { return AORG_linhas_(qual) || []; }

    /* ============================================================
       1. INSTALAÇÃO
       ============================================================ */
    var inst = AP_ORG_instalar();
    ok('a instalação cria as seis abas',
      inst.ok && inst.dados.criadas.length === 6, (inst.dados && inst.dados.criadas || []).join(', '));
    ok('nasce em modo SOMBRA, sem barrar ninguém', AORG_modo_() === 'SOMBRA');

    var deNovo = AP_ORG_instalar();
    ok('instalar de novo não recria nada',
      deNovo.ok && deNovo.dados.criadas.length === 0 && deNovo.dados.conferidas.length === 6);

    /* ============================================================
       2. NADA NASCE ÓRFÃO
       ============================================================ */
    var semEmpresa = AORG_salvarObra_({ nome: 'Obra sem dono' });
    ok('obra sem empresa é recusada',
      !semEmpresa.ok && semEmpresa.codigo === 'FALTA_EMPRESA', semEmpresa.codigo);

    var empresaInventada = AORG_salvarObra_({ nome: 'Obra X', empresa: 'EMP-NAO-EXISTE' });
    ok('obra apontando para empresa inexistente é recusada',
      !empresaInventada.ok && empresaInventada.codigo === 'PAI_NAO_EXISTE');

    var emp = AORG_salvarEmpresa_({ nome: 'COESA ENGENHARIA', cnpj: '11.111.111/0001-11' }, 'ismael');
    ok('a empresa é criada', emp.ok && /^EMP-/.test(emp.dados.id), emp.mensagem);
    ok('empresa repetida é barrada',
      !AORG_salvarEmpresa_({ nome: 'coesa engenharia' }).ok);

    var obraA = AORG_salvarObra_({ nome: 'Obra Ponte', codigo: 'PON', empresa: emp.dados.id,
      responsavel: 'joao' }, 'ismael');
    var obraB = AORG_salvarObra_({ nome: 'Obra Viaduto', codigo: 'VIA', empresa: emp.dados.id,
      responsavel: 'maria' }, 'ismael');
    ok('as duas obras são criadas', obraA.ok && obraB.ok);
    ok('código de obra repetido é barrado',
      !AORG_salvarObra_({ nome: 'Outra', codigo: 'pon', empresa: emp.dados.id }).ok);

    var setorA = AORG_salvarSetor_({ nome: 'Almoxarifado', obra: obraA.dados.id, responsavel: 'ismael' });
    var setorB = AORG_salvarSetor_({ nome: 'Almoxarifado', obra: obraB.dados.id, responsavel: 'maria' });
    ok('os setores são criados', setorA.ok && setorB.ok, setorA.mensagem || '');

    var setorDaObra = linhasDe('setores').filter(function (s) {
      return AORG_texto_(s.id) === setorA.dados.id;
    })[0];
    ok('o setor herda a empresa da obra, sem ninguém digitar',
      AORG_texto_(setorDaObra.empresa) === emp.dados.id);

    var escritorio = AORG_salvarSetor_({ nome: 'Compras', empresa: emp.dados.id });
    ok('setor de escritório pode existir sem obra', escritorio.ok);

    var equipeA = AORG_salvarEquipe_({ nome: 'Equipe Manhã', setor: setorA.dados.id, lider: 'ismael' });
    ok('a equipe é criada e herda obra e empresa do setor',
      equipeA.ok &&
      AORG_texto_(linhasDe('equipes')[0].obra) === obraA.dados.id &&
      AORG_texto_(linhasDe('equipes')[0].empresa) === emp.dados.id);
    ok('equipe sem setor é recusada', !AORG_salvarEquipe_({ nome: 'Solta' }).ok);

    /* ============================================================
       3. NADA É APAGADO — E NADA É ARQUIVADO COM GENTE DENTRO
       ============================================================ */
    var tentouEmpresa = AORG_arquivar_('empresas', { id: emp.dados.id });
    ok('não arquiva empresa com obra dentro',
      !tentouEmpresa.ok && tentouEmpresa.codigo === 'EM_USO', tentouEmpresa.mensagem);
    ok('e a mensagem diz o que está segurando',
      tentouEmpresa.mensagem.indexOf('obra') > -1);

    var linhasAntes = linhasDe('equipes').length;
    var arq = AORG_arquivar_('equipes', { id: equipeA.dados.id });
    ok('a equipe é arquivada, não apagada',
      arq.ok && linhasDe('equipes').length === linhasAntes);
    ok('e some da listagem normal',
      AORG_listar_('equipes', AORG_equipePublica_, {}).dados.length === 0);
    ok('mas aparece quando se pede os arquivados',
      AORG_listar_('equipes', AORG_equipePublica_, { incluirArquivados: true }).dados.length === 1);

    /* devolve a equipe para os testes seguintes */
    AORG_atualizar_('equipes', equipeA.dados.id, { ativo: 'Sim' });

    /* ============================================================
       4. O ESCOPO DE CADA PESSOA
       ============================================================ */
    var v1 = AORG_vincular_({ usuario: 'ismael', matricula: '12345', setor: setorA.dados.id,
      funcao: 'almoxarife', nivel: 'Operacional', principal: true }, 'ti');
    ok('o vínculo é criado', v1.ok, v1.mensagem);

    var vinculoGravado = linhasDe('vinculos')[0];
    ok('o vínculo herda obra e empresa do setor',
      AORG_texto_(vinculoGravado.obra) === obraA.dados.id &&
      AORG_texto_(vinculoGravado.empresa) === emp.dados.id);

    ok('vínculo repetido é barrado',
      !AORG_vincular_({ usuario: 'ismael', setor: setorA.dados.id }).ok);

    ok('vínculo com setor inventado é barrado',
      !AORG_vincular_({ usuario: 'ismael', setor: 'SET-NAO-EXISTE' }).ok);

    var escopoIsmael = AP_ORG_escopoDe('ismael');
    ok('o escopo é encontrado pelo usuário', escopoIsmael.length === 1);
    ok('e também pela matrícula', AP_ORG_escopoDe('12345').length === 1);

    /* ============================================================
       5. UMA PESSOA, DUAS OBRAS
       ============================================================ */
    AORG_vincular_({ usuario: 'ismael', setor: setorB.dados.id, funcao: 'almoxarife',
      nivel: 'Operacional' }, 'ti');
    ok('a mesma pessoa pode ter dois vínculos', AP_ORG_escopoDe('ismael').length === 2);

    var naObraA = AP_ORG_dentroDoEscopo('ismael', { obra: obraA.dados.id }, 'almoxarife');
    var naObraB = AP_ORG_dentroDoEscopo('ismael', { obra: obraB.dados.id }, 'almoxarife');
    ok('e opera nas duas', naObraA.dentro && naObraB.dentro);

    /* ============================================================
       6. QUEM É DE UMA OBRA NÃO MEXE NA OUTRA
       ============================================================ */
    AORG_vincular_({ usuario: 'carlos', matricula: '999', setor: setorB.dados.id,
      funcao: 'almoxarife', nivel: 'Operacional' }, 'ti');

    var carlosNaA = AP_ORG_dentroDoEscopo('carlos', { obra: obraA.dados.id }, 'almoxarife');
    ok('Carlos é barrado na obra que não é dele',
      !carlosNaA.dentro && carlosNaA.codigo === 'FORA_DO_ESCOPO', carlosNaA.motivo);

    var semVinculo = AP_ORG_dentroDoEscopo('fantasma', { obra: obraA.dados.id }, 'almoxarife');
    ok('quem não tem vínculo nenhum é barrado com outro motivo',
      !semVinculo.dentro && semVinculo.codigo === 'SEM_VINCULO');

    var oTi = AP_ORG_dentroDoEscopo('suporte', { obra: obraA.dados.id }, 'ti');
    ok('o perfil de emergência atravessa qualquer escopo', oTi.dentro);

    /* ============================================================
       7. LIGAR O ESCOPO É DECISÃO, NÃO ACIDENTE
       ============================================================ */
    ok('o organograma sabe dizer se dá para ligar',
      AORG_pendencias_().dados.podeLigarOEscopo === true,
      JSON.stringify(AORG_pendencias_().dados.problemas));

    /* ============================================================
       8. MODO SOMBRA — confere, registra, e não barra
       ============================================================ */
    AP_PERMISSOES_verificar = function () {
      return { ok: true, permitido: true, escopo: 'TODOS', limite: '' };
    };

    var naSombra = AP_ORG_validarOperacao({
      usuario: 'carlos', perfil: 'almoxarife', modulo: 'estoque', acao: 'retirar',
      obra: obraA.dados.id, valor: 10
    });
    ok('na sombra, quem está fora do escopo NÃO é barrado', naSombra.ok === true);
    ok('mas o relatório diz que seria',
      String(naSombra.dados.observacao).indexOf('MODO SOMBRA') > -1, naSombra.dados.observacao);

    var auditoriaSombra = linhasDe('auditoria');
    ok('e a tentativa vira linha de auditoria', auditoriaSombra.length > 0);

    /* ============================================================
       9. COM O ESCOPO VALENDO
       ============================================================ */
    var ligou = AP_ORG_VALER();
    ok('o escopo pode ser ligado quando há vínculo', ligou.ok, ligou.mensagem);

    var barrado = AP_ORG_validarOperacao({
      usuario: 'carlos', perfil: 'almoxarife', modulo: 'estoque', acao: 'retirar',
      obra: obraA.dados.id, valor: 10
    });
    ok('agora Carlos é barrado de verdade',
      !barrado.ok && barrado.codigo === 'FORA_DO_ESCOPO', barrado.codigo);
    ok('a mensagem não conta o que tem do outro lado',
      barrado.mensagem.indexOf('Obra Ponte') === -1 &&
      barrado.mensagem.indexOf(obraB.dados.id) === -1);

    var passou = AP_ORG_validarOperacao({
      usuario: 'ismael', perfil: 'almoxarife', modulo: 'estoque', acao: 'retirar',
      obra: obraA.dados.id, valor: 10
    });
    ok('e Ismael passa na obra dele', passou.ok === true, passou.mensagem);

    /* o vazio nunca é permissão */
    var semUsuario = AP_ORG_validarOperacao({ modulo: 'estoque', acao: 'retirar' });
    ok('pedido sem usuário é recusado',
      !semUsuario.ok && semUsuario.codigo === 'SEM_USUARIO');

    AP_PERMISSOES_verificar = function () {
      return { ok: false, permitido: false, motivo: 'O perfil Ajudante não pode aprovar.' };
    };
    var semPermissao = AP_ORG_validarOperacao({
      usuario: 'ismael', perfil: 'ajudante', modulo: 'compras', acao: 'aprovar',
      obra: obraA.dados.id, valor: 10
    });
    ok('permissão negada vem do módulo de permissões, não daqui',
      !semPermissao.ok && semPermissao.codigo === 'SEM_PERMISSAO' &&
      semPermissao.mensagem.indexOf('Ajudante') > -1);

    /* ============================================================
       10. LIMITE E ROTEAMENTO — o aprovador sai das regras
       ============================================================ */
    AP_PERMISSOES_verificar = function () {
      return { ok: true, permitido: true, escopo: 'OBRA', limite: '1000' };
    };
    APERM_alcadaPara_ = function (p) {
      if ((Number(p.valor) || 0) <= 5000) {
        return { ok: true, dados: { id: 'ALC-1', nome: 'Até 5 mil', perfilAprovador: 'encarregado',
          aprovadores: 1, faixa: 'R$ 0,00 até R$ 5.000,00' } };
      }
      return { ok: true, dados: { id: 'ALC-2', nome: 'Acima de 5 mil', perfilAprovador: 'gerente',
        aprovadores: 1, faixa: 'R$ 5.000,01 até sem limite' } };
    };

    /* o encarregado do setor A, e um gerente que só existe na empresa */
    AORG_vincular_({ usuario: 'joao', setor: setorA.dados.id, funcao: 'encarregado',
      nivel: 'Supervisão' }, 'ti');
    AORG_vincular_({ usuario: 'diretor', empresa: emp.dados.id, funcao: 'gerente',
      nivel: 'Direção' }, 'ti');

    var abaixoDoLimite = AP_ORG_validarOperacao({
      usuario: 'ismael', perfil: 'almoxarife', modulo: 'compras', acao: 'criar',
      obra: obraA.dados.id, setor: setorA.dados.id, valor: 500
    });
    ok('abaixo do limite não pede aprovação',
      abaixoDoLimite.ok && abaixoDoLimite.dados.precisaAprovacao === false);

    var acimaDoLimite = AP_ORG_validarOperacao({
      usuario: 'ismael', perfil: 'almoxarife', modulo: 'compras', acao: 'criar',
      obra: obraA.dados.id, setor: setorA.dados.id, valor: 3000
    });
    ok('acima do limite não é negado: vira pedido de aprovação',
      acimaDoLimite.ok && acimaDoLimite.dados.precisaAprovacao === true, acimaDoLimite.mensagem);
    ok('e o aprovador tem nome de gente, vindo do organograma',
      acimaDoLimite.dados.aprovadores.length === 1 &&
      acimaDoLimite.dados.aprovadores[0].usuario === 'joao',
      JSON.stringify(acimaDoLimite.dados.aprovadores));
    ok('o aprovador escolhido é o do setor, o mais perto do trabalho',
      acimaDoLimite.dados.aprovadores[0].deOnde === 'do setor');

    var valorAlto = AP_ORG_aprovadorPara({
      valor: 90000, obra: obraA.dados.id, setor: setorA.dados.id,
      empresa: emp.dados.id, modulo: 'compras'
    });
    ok('valor alto muda a regra e o aprovador',
      valorAlto.ok && valorAlto.dados.aprovadores[0].usuario === 'diretor',
      valorAlto.ok ? valorAlto.dados.regra : valorAlto.mensagem);
    ok('e o sistema diz que ele veio de cima, não do setor',
      valorAlto.dados.aprovadores[0].deOnde === 'da empresa');

    APERM_alcadaPara_ = function () {
      return { ok: true, dados: { id: 'ALC-9', nome: 'Diretoria', perfilAprovador: 'presidente',
        aprovadores: 1, faixa: 'qualquer' } };
    };
    var ninguem = AP_ORG_aprovadorPara({ valor: 10, obra: obraA.dados.id, empresa: emp.dados.id });
    ok('perfil que ninguém ocupa não vira aprovação fantasma',
      !ninguem.ok && ninguem.codigo === 'SEM_APROVADOR', ninguem.mensagem);
    ok('e a mensagem diz o que fazer',
      ninguem.mensagem.indexOf('Cadastre o responsável') > -1);

    APERM_alcadaPara_ = function () {
      return { ok: false, codigo: 'SEM_REGRA', mensagem: 'Nenhuma regra cobre esse valor.' };
    };
    AP_PERMISSOES_verificar = function () {
      return { ok: true, permitido: true, escopo: 'OBRA', limite: '100' };
    };
    var semRegra = AP_ORG_validarOperacao({
      usuario: 'ismael', perfil: 'almoxarife', modulo: 'compras', acao: 'criar',
      obra: obraA.dados.id, setor: setorA.dados.id, valor: 9000
    });
    ok('sem regra de alçada a operação é recusada, não liberada no escuro',
      !semRegra.ok && semRegra.codigo === 'SEM_REGRA', semRegra.codigo);

    /* ============================================================
       11. AUDITORIA
       ============================================================ */
    var auditoria = AORG_auditoria_({ quantas: 100 }).dados;
    ok('a auditoria guardou as tentativas', auditoria.length >= 5, auditoria.length + ' linhas');

    var negadas = auditoria.filter(function (a) { return a.resultado === 'NEGADO'; });
    ok('inclusive as NEGADAS', negadas.length > 0, negadas.length + ' negadas');

    var umaLinha = auditoria[0];
    var camposDoDocumento = ['usuario', 'empresa', 'obra', 'setor', 'operacao',
      'registro', 'valor', 'dataHora', 'resultado', 'motivo', 'aprovador', 'status'];
    var faltando = camposDoDocumento.filter(function (c) { return !(c in umaLinha); });
    ok('a auditoria tem todos os campos que o documento pede',
      faltando.length === 0, faltando.join(', '));

    var tudo = JSON.stringify(linhasDe('auditoria'));
    ok('a auditoria não guarda senha nem token',
      tudo.toLowerCase().indexOf('senha') === -1 && tudo.toLowerCase().indexOf('token') === -1);

    var comAprovador = auditoria.filter(function (a) { return a.aprovador; });
    ok('quando houve aprovador, ele ficou registrado', comAprovador.length > 0);

    /* auditoria não pode derrubar a operação */
    var abaAuditoria = ABAS[AORG_ABAS.auditoria];
    var appendOriginal = abaAuditoria.appendRow;
    abaAuditoria.appendRow = function () { throw new Error('planilha cheia'); };
    var mesmoAssim = AP_ORG_validarOperacao({
      usuario: 'ismael', perfil: 'almoxarife', modulo: 'estoque', acao: 'retirar',
      obra: obraA.dados.id, valor: 1
    });
    ok('auditoria quebrada NÃO derruba a operação', mesmoAssim.ok === true);
    abaAuditoria.appendRow = appendOriginal;

    /* ============================================================
       12. A ÁRVORE E O DESLIGAMENTO
       ============================================================ */
    var arvore = AORG_arvore_({}).dados;
    ok('a árvore monta empresa → obra → setor → equipe',
      arvore.empresas.length === 1 &&
      arvore.empresas[0].obras.length === 2 &&
      arvore.empresas[0].obras[0].setores.length === 1 &&
      arvore.empresas[0].obras[0].setores[0].equipes.length === 1);
    ok('e conta as pessoas de cada nível',
      arvore.totais.pessoasVinculadas >= 4, JSON.stringify(arvore.totais));
    ok('o setor de escritório aparece pendurado na empresa',
      arvore.empresas[0].setoresDaEmpresa.length === 1);

    var quantosAntes = AP_ORG_escopoDe('carlos').length;
    var fim = AORG_desvincular_({ id: linhasDe('vinculos').filter(function (v) {
      return AORG_texto_(v.usuario) === 'carlos';
    })[0].id });
    ok('desvincular encerra sem apagar a linha',
      fim.ok && linhasDe('vinculos').filter(function (v) {
        return AORG_texto_(v.usuario) === 'carlos';
      }).length === 1);
    ok('e a pessoa perde o escopo na hora',
      quantosAntes === 1 && AP_ORG_escopoDe('carlos').length === 0);

    /* ============================================================
       13. AS PORTAS
       ============================================================ */
    var pelaPorta = AP_Modulo_organograma({ acao: 'empresas', payload: {} });
    ok('a porta do roteador responde', pelaPorta.ok && pelaPorta.dados.length === 1);

    var comoTexto = AP_ORG_direto(JSON.stringify({ acao: 'modo' }));
    ok('a porta direta devolve texto', typeof comoTexto === 'string' &&
      JSON.parse(comoTexto).dados.valendo === true);

    var inventada = AP_Modulo_organograma({ acao: 'dançar' });
    ok('ação inventada é recusada com mensagem clara',
      !inventada.ok && inventada.codigo === 'ACAO_DESCONHECIDA');

  } catch (explodiu) {
    falhas++;
    log.push('FALHOU  o teste explodiu: ' + ((explodiu && explodiu.stack) || explodiu));
  } finally {
    if (guardado.Planilhas) SpreadsheetApp = guardado.Planilhas;
    if (guardado.Props) PropertiesService = guardado.Props;
    if (guardado.Utils) Utilities = guardado.Utils;
    if (guardado.Sessao) Session = guardado.Sessao;
    if (guardado.verificar) AP_PERMISSOES_verificar = guardado.verificar;
    if (guardado.alcada) APERM_alcadaPara_ = guardado.alcada;
    if (guardado.perfilDo) AP_ORG_perfilDoUsuario = guardado.perfilDo;
  }

  var texto = '=== ETAPA 3 — ORGANOGRAMA, ESCOPO, LIMITES E ROTEAMENTO — ' +
    (falhas ? falhas + ' FALHA(S) DE ' + log.length : 'TODOS OS ' + log.length + ' TESTES PASSARAM') +
    ' ===\n' + log.join('\n');
  try { Logger.log(texto); } catch (e) { }
  return { ok: falhas === 0, total: log.length, falhas: falhas, texto: texto };
}
