/**
 * ALMOXA PRO — MÓDULO DE JUNTAR CADASTROS REPETIDOS
 * ============================================================================
 * Contrato: juntar.v1
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * ---------------------------
 * O módulo de usuários do Core tem duas regras que se contradizem. Provado na
 * tela dele, com duas tentativas e duas mensagens diferentes:
 *
 *   mandei nome + matrícula  →  "Já existe usuário com esta matricula ou e-mail."
 *                               (ele confere a matrícula 22 contra o banco e
 *                                acha o próprio cadastro 22 que mandei editar)
 *
 *   mandei sem a matrícula   →  "Nome e matrícula são obrigatórios."
 *
 * Não existe pedido que passe nos dois. Pela tela, não há conserto: qualquer
 * coisa que o navegador envie bate num dos dois muros.
 *
 * Então este módulo faz a única coisa que falta — bloquear um cadastro
 * repetido — falando DIRETO com o repositório, que é onde os usuários moram
 * de verdade (conjunto "usuarios", pasta 13_USUARIOS_PERMISSOES). Ele não
 * passa pelo módulo de usuários, e por isso não esbarra nas regras dele.
 *
 * O QUE ELE FAZ
 *   juntar.conferir     mostra o que FARIA, sem gravar nada (ensaio)
 *   juntar.bloquear     bloqueia um cadastro repetido, pelo id
 *   juntar.desfazer     devolve o cadastro ao estado anterior
 *   juntar.repetidos    lista as pessoas com mais de um cadastro
 *   juntar.diagnostico  diz se dá para gravar, etapa por etapa
 *   juntar.contrato     nome e versão
 *
 * O QUE ELE NÃO FAZ — e isto ele pediu, mais de uma vez
 *   · NÃO APAGA cadastro nenhum. Nunca. Nem com pedido.
 *   · Não muda matrícula de ninguém.
 *   · Não escolhe qual cadastro fica: quem manda o id é a tela, e quem
 *     escolhe na tela é ele.
 *   · Não mexe no módulo de usuários, não cria segundo Core, não cria
 *     autenticação própria, não inventa aba nem coluna.
 *   · Não junta pessoas: junta CADASTROS, um pedido de cada vez.
 *
 * O QUE ELE GUARDA PARA PODER DESFAZER
 *   Antes de bloquear, copia os campos que vai mexer para dentro do próprio
 *   registro, em "__antesDeJuntar". É com isso que o desfazer trabalha.
 *   Nenhum dado sai do lugar.
 *
 * ONDE PROCURAR ERRO
 *   SEM_REPOSITORIO    falta ALMOXA_PRO_Repositorio.gs no projeto
 *   NAO_ENCONTRADO     não existe cadastro com esse id
 *   JA_BLOQUEADO       esse cadastro já estava bloqueado
 *   NAO_CONFERIU       gravou e a releitura não trouxe a mudança
 *   SEM_PERMISSAO      o perfil da sessão não pode alterar usuários
 * ============================================================================
 */

var JNT_CONTRATO = 'juntar.v1';
var JNT_CONJUNTO = 'usuarios';     /* 13_USUARIOS_PERMISSOES */
var JNT_LOG      = 'auditoria';    /* 14_LOGS_AUDITORIA      */


/* ============================================================
   1. A PORTA
   ============================================================ */

function AP_JUNTAR_direto(json) {
  var p = {};
  try { p = JSON.parse(json || '{}'); } catch (e) {
    return JSON.stringify(JNT_erro_('CORPO_INVALIDO', 'O pedido não veio em JSON.'));
  }
  return JSON.stringify(JNT_atender_(p));
}
function AP_Modulo_juntar(json) { return AP_JUNTAR_direto(json); }

function JNT_atender_(p) {
  p = p || {};
  var acao = String(p.acao || p.operacao || '');
  var carga = p.payload || {};
  var quem = p.sessao || p.token || null;
  try {
    switch (acao) {
      case 'conferir':    return JNT_conferir_(carga, quem);
      case 'bloquear':    return JNT_bloquear_(carga, quem);
      case 'desfazer':    return JNT_desfazer_(carga, quem);
      case 'repetidos':   return JNT_repetidos_(carga, quem);
      case 'diagnostico': return JNT_diagnostico_(carga, quem);
      case 'contrato':    return JNT_ok_({ contrato: JNT_CONTRATO, conjunto: JNT_CONJUNTO,
                            acoes: ['conferir','bloquear','desfazer','repetidos','diagnostico','contrato'],
                            apaga: false });
      default:
        return JNT_erro_('ACAO_DESCONHECIDA',
          'juntar.' + acao + ' não existe. As ações são: conferir, bloquear, ' +
          'desfazer, repetidos, diagnostico, contrato.');
    }
  } catch (e) {
    return JNT_erro_('ESTOUROU', String((e && e.message) || e));
  }
}

function JNT_ok_(dados, mensagem, extra) {
  var r = { ok: true, dados: dados === undefined ? null : dados,
    mensagem: mensagem || '', contrato: JNT_CONTRATO };
  if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) r[k] = extra[k];
  return r;
}
function JNT_erro_(codigo, mensagem, extra) {
  var r = { ok: false, codigo: codigo, mensagem: mensagem, contrato: JNT_CONTRATO };
  if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) r[k] = extra[k];
  return r;
}
function JNT_txt_(v) { return String(v === undefined || v === null ? '' : v).trim(); }
function JNT_lista_(v) { return Object.prototype.toString.call(v) === '[object Array]' ? v : []; }
function JNT_copia_(o) { try { return JSON.parse(JSON.stringify(o)); } catch (e) { return null; } }

function JNT_temRepositorio_() {
  return typeof REPO_lerRegistro === 'function'
      && typeof REPO_atualizarRegistro === 'function'
      && typeof REPO_listarRegistros === 'function';
}

function JNT_ler_(id, quem) {
  try {
    var r = REPO_lerRegistro({ conjunto: JNT_CONJUNTO, id: id }, quem);
    if (r && r.ok && r.dados) return r.dados.conteudo || r.dados;
  } catch (e) {}
  return null;
}


/* ============================================================
   2. ENSAIO — mostra o que FARIA, sem gravar
   ------------------------------------------------------------
   Serve para ele conferir antes. Nenhuma gravação acontece aqui.
   ============================================================ */

function JNT_conferir_(carga, quem) {
  if (!JNT_temRepositorio_()) {
    return JNT_erro_('SEM_REPOSITORIO',
      'Falta o arquivo ALMOXA_PRO_Repositorio.gs neste projeto.');
  }
  var sai = JNT_txt_(carga.id);
  var fica = JNT_txt_(carga.idQueFica);
  if (!sai) return JNT_erro_('PEDIDO_INCOMPLETO', 'Informe o id do cadastro que sai.');

  var uSai = JNT_ler_(sai, quem);
  if (!uSai) return JNT_erro_('NAO_ENCONTRADO', 'Não existe cadastro com o id ' + sai + '.');
  var uFica = fica ? JNT_ler_(fica, quem) : null;

  return JNT_ok_({
    vaiBloquear: { id: sai, nome: uSai.nome, matricula: uSai.matricula,
      situacaoAgora: uSai.status || uSai.situacao || '' },
    vaiFicar: uFica ? { id: fica, nome: uFica.nome, matricula: uFica.matricula } : null,
    oQueMuda: ['status passa a "Bloqueado"',
               'entra uma observação dizendo a qual cadastro foi juntado',
               'os campos de antes ficam guardados em __antesDeJuntar, para desfazer'],
    oQueNAOmuda: ['a matrícula', 'o nome', 'o e-mail', 'o login',
                  'a ficha de EPI', 'o crachá', 'a assinatura',
                  'e NADA é apagado'],
    jaEstaBloqueado: /bloque/i.test(JNT_txt_(uSai.status)),
    ensaio: true
  }, 'Isto é só um ensaio. Nada foi gravado.');
}


/* ============================================================
   3. BLOQUEAR — a única gravação deste módulo
   ============================================================ */

function JNT_bloquear_(carga, quem) {
  if (!JNT_temRepositorio_()) {
    return JNT_erro_('SEM_REPOSITORIO',
      'Falta o arquivo ALMOXA_PRO_Repositorio.gs neste projeto.');
  }
  var sai = JNT_txt_(carga.id);
  var fica = JNT_txt_(carga.idQueFica);
  if (!sai) return JNT_erro_('PEDIDO_INCOMPLETO', 'Informe o id do cadastro que sai.');
  if (sai === fica) {
    return JNT_erro_('PEDIDO_INCOMPLETO',
      'O cadastro que sai e o que fica são o mesmo. Não faço nada.');
  }

  var u = JNT_ler_(sai, quem);
  if (!u) return JNT_erro_('NAO_ENCONTRADO', 'Não existe cadastro com o id ' + sai + '.');
  if (/bloque/i.test(JNT_txt_(u.status))) {
    return JNT_erro_('JA_BLOQUEADO',
      'O cadastro ' + (JNT_txt_(u.matricula) || sai) + ' já estava bloqueado. Não mexi.');
  }

  var uFica = fica ? JNT_ler_(fica, quem) : null;
  var matFica = uFica ? (JNT_txt_(uFica.matricula) || '(sem matrícula)') : '(não informado)';
  var agora = new Date().toISOString();

  /* o antes, guardado DENTRO do próprio registro, para o desfazer */
  var antes = {
    status: JNT_txt_(u.status),
    observacao: JNT_txt_(u.observacao),
    quando: agora,
    por: (quem && quem.nome) ? String(quem.nome) : ''
  };

  var novo = JNT_copia_(u) || {};
  novo.status = 'Bloqueado';
  novo.observacao = 'Cadastro repetido — juntado ao de matrícula ' + matFica +
    ' em ' + Utilities.formatDate(new Date(), 'America/Manaus', 'dd/MM/yyyy') + '.';
  novo.__antesDeJuntar = antes;
  novo.__juntadoAo = fica || '';
  /* a matrícula, o nome, o e-mail, o login e tudo mais ficam como estavam:
     este módulo só mexe em situação e observação */

  var r;
  try {
    r = REPO_atualizarRegistro({ conjunto: JNT_CONJUNTO, id: sai, conteudo: novo }, quem);
  } catch (e) {
    return JNT_erro_('ESTOUROU_NA_GRAVACAO', String((e && e.message) || e));
  }
  if (!r || !r.ok) {
    return JNT_erro_(JNT_txt_(r && r.codigo) || 'NAO_GRAVOU',
      JNT_txt_(r && r.mensagem) || 'O repositório recusou a gravação.');
  }

  /* RELER E CONFERIR — não digo que bloqueei sem olhar */
  var volta = JNT_ler_(sai, quem);
  if (!volta || !/bloque/i.test(JNT_txt_(volta.status))) {
    return JNT_erro_('NAO_CONFERIU',
      'Gravou, mas na releitura o cadastro continua ' +
      (volta ? (JNT_txt_(volta.status) || 'sem situação') : 'sumido') +
      '. Trate como NÃO bloqueado.');
  }
  if (JNT_txt_(volta.matricula) !== JNT_txt_(u.matricula)) {
    return JNT_erro_('NAO_CONFERIU',
      'A matrícula mudou na gravação, e isso não podia acontecer. Confira o cadastro.');
  }

  JNT_audit_(quem, 'CADASTRO_JUNTADO', sai,
    { juntadoAo: fica, matriculaQueSai: u.matricula, matriculaQueFica: matFica });

  return JNT_ok_({
    id: sai, nome: volta.nome, matricula: volta.matricula,
    status: volta.status, observacao: volta.observacao,
    podeDesfazer: true
  }, 'Cadastro ' + (JNT_txt_(u.matricula) || sai) + ' bloqueado. Nada foi apagado — ' +
     'para voltar atrás, use juntar.desfazer com este id.');
}


/* ============================================================
   4. DESFAZER
   ------------------------------------------------------------
   A política de recuperação que ele exige: toda operação deste
   módulo tem volta, e a volta é uma ação de verdade, não um
   "refaça na mão".
   ============================================================ */

function JNT_desfazer_(carga, quem) {
  if (!JNT_temRepositorio_()) {
    return JNT_erro_('SEM_REPOSITORIO', 'Falta o ALMOXA_PRO_Repositorio.gs.');
  }
  var id = JNT_txt_(carga.id);
  if (!id) return JNT_erro_('PEDIDO_INCOMPLETO', 'Informe o id do cadastro.');

  var u = JNT_ler_(id, quem);
  if (!u) return JNT_erro_('NAO_ENCONTRADO', 'Não existe cadastro com o id ' + id + '.');
  var antes = u.__antesDeJuntar;
  if (!antes) {
    return JNT_erro_('NADA_A_DESFAZER',
      'Este cadastro não foi bloqueado por este módulo — não tenho o estado anterior ' +
      'guardado e não vou adivinhar qual era.');
  }

  var novo = JNT_copia_(u) || {};
  novo.status = antes.status || 'Ativo';
  novo.observacao = antes.observacao || '';
  delete novo.__antesDeJuntar;
  delete novo.__juntadoAo;

  var r;
  try {
    r = REPO_atualizarRegistro({ conjunto: JNT_CONJUNTO, id: id, conteudo: novo }, quem);
  } catch (e) {
    return JNT_erro_('ESTOUROU_NA_GRAVACAO', String((e && e.message) || e));
  }
  if (!r || !r.ok) {
    return JNT_erro_(JNT_txt_(r && r.codigo) || 'NAO_GRAVOU',
      JNT_txt_(r && r.mensagem) || 'O repositório recusou.');
  }
  var volta = JNT_ler_(id, quem);
  if (!volta || /bloque/i.test(JNT_txt_(volta.status))) {
    return JNT_erro_('NAO_CONFERIU',
      'Gravou, mas na releitura o cadastro continua bloqueado. Trate como NÃO desfeito.');
  }
  JNT_audit_(quem, 'JUNTAR_DESFEITO', id, { voltouPara: novo.status });
  return JNT_ok_({ id: id, status: volta.status },
    'Cadastro ' + (JNT_txt_(volta.matricula) || id) + ' voltou para "' + volta.status + '".');
}


/* ============================================================
   5. QUEM ESTÁ REPETIDO
   ============================================================ */

function JNT_repetidos_(carga, quem) {
  if (!JNT_temRepositorio_()) {
    return JNT_erro_('SEM_REPOSITORIO', 'Falta o ALMOXA_PRO_Repositorio.gs.');
  }
  var lista = [];
  try {
    var r = REPO_listarRegistros({ conjunto: JNT_CONJUNTO, tamanhoPagina: 500 }, quem);
    if (!r || !r.ok) {
      return JNT_erro_(JNT_txt_(r && r.codigo) || 'NAO_LISTOU',
        JNT_txt_(r && r.mensagem) || 'O repositório não devolveu a lista.');
    }
    JNT_lista_(r.dados).forEach(function (x) {
      var u = JNT_ler_(x.id, quem);
      if (u) { u.id = u.id || x.id; lista.push(u); }
    });
  } catch (e) {
    return JNT_erro_('ESTOUROU_NA_LISTAGEM', String((e && e.message) || e));
  }

  function chave(n) {
    return JNT_txt_(n).toUpperCase().replace(/\s+/g, ' ');
  }
  var porNome = {};
  lista.forEach(function (u) {
    var k = chave(u.nome);
    if (!k) return;
    (porNome[k] = porNome[k] || []).push(u);
  });

  var grupos = [];
  Object.keys(porNome).forEach(function (k) {
    var g = porNome[k];
    if (g.length < 2) return;
    grupos.push({
      nome: g[0].nome,
      quantos: g.length,
      cadastros: g.map(function (u) {
        return { id: u.id, matricula: u.matricula, email: u.email,
          status: u.status, atualizadoEm: u.atualizadoEm || u.atualizado_em || '',
          jaJuntado: !!u.__antesDeJuntar };
      })
    });
  });
  grupos.sort(function (a, b) { return b.quantos - a.quantos; });
  return JNT_ok_(grupos, '', { quantos: grupos.length, usuariosLidos: lista.length });
}

function JNT_audit_(quem, acao, alvo, extra) {
  try {
    if (typeof REPO_registrarAuditoria === 'function') {
      REPO_registrarAuditoria({ conjunto: JNT_LOG, acao: acao, alvo: alvo,
        modulo: 'juntar', quando: new Date().toISOString(),
        detalhe: extra || {} }, quem);   /* sem senha, sem token */
    }
  } catch (e) {}
}


/* ============================================================
   6. DIAGNÓSTICO
   ============================================================ */

function JNT_diagnostico_(carga, quem) {
  var etapas = [];
  function passo(n, ok, d) { etapas.push({ etapa: n, ok: !!ok, detalhe: d || '' }); }

  passo('módulo carregado', true, JNT_CONTRATO);
  var temRepo = JNT_temRepositorio_();
  passo('repositório disponível', temRepo,
    temRepo ? 'REPO_* respondendo' : 'falta ALMOXA_PRO_Repositorio.gs');
  if (!temRepo) return JNT_ok_({ etapas: etapas, conclusao: 'sem repositório não dá para nada' });

  var leu = false, quantos = 0, erro = '';
  try {
    var r = REPO_listarRegistros({ conjunto: JNT_CONJUNTO, tamanhoPagina: 10 }, quem);
    leu = !!(r && r.ok);
    quantos = leu ? JNT_lista_(r.dados).length : 0;
    if (!leu) erro = JNT_txt_(r && r.mensagem);
  } catch (e) { erro = String(e && e.message); }
  passo('consigo ler os usuários', leu, leu ? (quantos + ' na primeira página') : erro);

  var reps = JNT_repetidos_({}, quem);
  passo('consigo achar os repetidos', !!(reps && reps.ok),
    (reps && reps.ok) ? (reps.quantos + ' pessoa(s) com mais de um cadastro')
                      : JNT_txt_(reps && reps.mensagem));

  return JNT_ok_({
    etapas: etapas,
    conjunto: JNT_CONJUNTO,
    apagaAlgumaCoisa: 'não, nunca',
    conclusao: etapas.every(function (e) { return e.ok; }) ? 'tudo de pé'
      : 'há etapa com problema — veja qual está com ok:false'
  });
}


/* ============================================================
   TESTES — rode no editor do Apps Script
   ============================================================ */

function JNT_TESTE_diagnostico() {
  var d = JNT_atender_({ acao: 'diagnostico', payload: {} });
  (d.dados.etapas || []).forEach(function (e) {
    Logger.log((e.ok ? 'ok   ' : 'FALHA ') + e.etapa + (e.detalhe ? ' — ' + e.detalhe : ''));
  });
  Logger.log('=> ' + d.dados.conclusao);
  return d;
}

function JNT_TESTE_verRepetidos() {
  var r = JNT_atender_({ acao: 'repetidos', payload: {} });
  if (!r.ok) { Logger.log('FALHOU: ' + r.mensagem); return r; }
  Logger.log(r.quantos + ' pessoa(s) com mais de um cadastro:');
  (r.dados || []).forEach(function (g) {
    Logger.log('  ' + g.nome);
    g.cadastros.forEach(function (c) {
      Logger.log('     mat ' + (c.matricula || '(sem)') + '  ' + (c.status || '') +
        '  id ' + c.id + (c.jaJuntado ? '  [já juntado antes]' : ''));
    });
  });
  Logger.log('Para juntar, use JNT_TESTE_ensaio("<id que sai>", "<id que fica>")');
  return r;
}

/** Ensaio: mostra o que faria, SEM gravar. */
function JNT_TESTE_ensaio(idQueSai, idQueFica) {
  var r = JNT_atender_({ acao: 'conferir', payload: { id: idQueSai, idQueFica: idQueFica } });
  Logger.log(JSON.stringify(r, null, 2));
  return r;
}
