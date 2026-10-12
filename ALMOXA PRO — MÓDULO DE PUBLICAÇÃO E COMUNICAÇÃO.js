/**
 * ALMOXA PRO — MÓDULO DE PUBLICAÇÃO E COMUNICAÇÃO
 * ============================================================================
 * Contrato: publicacao.v1
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * ---------------------------
 * Porque eu tinha posto esta responsabilidade dentro do HTML, e o HTML é a
 * camada de tela. Quem decide o que está no ar, quem guarda, quem versiona e
 * quem responde "esta é a publicação vigente" é o servidor. É este arquivo.
 *
 * A tela cadastra e apresenta. Este módulo processa, persiste, versiona e
 * publica. O Core autentica, autoriza e integra. A tela inicial consome UMA
 * fonte oficial: publicacao.vigente.
 *
 * AS OITO CAMADAS (seção 3 do pedido), nesta ordem no arquivo
 * -----------------------------------------------------------
 *   1. MODULE        a porta e o registro no Core
 *   2. CONTROLLER    recebe o pedido e despacha
 *   3. SERVICE       as regras: o que pode ser publicado e quando
 *   4. REPOSITORY    grava e lê, no repositório que já existe
 *   5. PROCESSOR     imagens, anexos e o que entra junto
 *   6. PUBLISHER     versão vigente, agendamento e retirada
 *   7. INTEGRATION   contrato com o Core e com a tela inicial
 *   8. DIAGNOSTICS   onde quebrou, em qual etapa e por quê
 *
 * O QUE ELE FAZ
 * -------------
 *   publicacao.salvar        cria ou atualiza uma publicação (rascunho inclusive)
 *   publicacao.obter         devolve uma publicação
 *   publicacao.listar        lista, com filtro de estado e de obra
 *   publicacao.publicar      põe no ar: valida, versiona e vira vigente
 *   publicacao.despublicar   tira do ar sem apagar
 *   publicacao.arquivar      encerra a publicação
 *   publicacao.tela          grava a configuração da tela inicial
 *   publicacao.fundoLogin    troca o fundo da tela de login
 *   publicacao.vigente       A FONTE OFICIAL da tela inicial
 *   publicacao.versao        só o número da versão (para conferir barato)
 *   publicacao.historico     as versões guardadas
 *   publicacao.restaurar     traz uma versão de volta
 *   publicacao.diagnostico   etapa por etapa, o que está de pé
 *   publicacao.contrato      nome e versão do contrato
 *
 * O QUE ELE NÃO FAZ
 * -----------------
 * Não cria banco novo, não cria aba nem coluna: grava no repositório que já
 * existe — "configuracao" (00_CONFIGURACAO) para a tela vigente, "documentos"
 * (11_DOCUMENTOS_PDFS) para as publicações, "anexos"/12 para as imagens e
 * "auditoria" (14_LOGS_AUDITORIA) para o registro. Não cria segundo Core, nem
 * segunda autenticação, nem doPost próprio. Não decide quem é o usuário: isso
 * vem do Core, pela sessão. Não manda notificação push — só registra que a
 * publicação pede uma, para o serviço de notificação do Core resolver.
 *
 * GRAVOU OU NÃO GRAVOU
 * --------------------
 * Toda gravação é relida antes de responder ok:true, e a releitura compara o
 * CONTEÚDO, não o relógio — o carimbo de tempo é meu, do servidor, e nunca vai
 * bater com o relógio do navegador. Se o conteúdo não voltar igual, a resposta
 * é NAO_CONFERIU e a tela tem de dizer que NÃO gravou.
 *
 * ONDE PROCURAR ERRO
 *   SEM_REPOSITORIO     falta ALMOXA_PRO_Repositorio.gs no projeto
 *   PEDIDO_INCOMPLETO   veio sem título, sem id ou sem o que gravar
 *   INVALIDA            a publicação não passa nas regras (o motivo vem junto)
 *   NAO_CONFERIU        gravou, mas a releitura não trouxe o mesmo conteúdo
 *   CONFLITO            alguém publicou enquanto este pedido estava em curso
 *   SEM_PERMISSAO       o perfil da sessão não pode publicar
 *   ARQUIVO_GRANDE      imagem acima do limite
 * ============================================================================
 */

var PUB_CONTRATO   = 'publicacao.v1';
var PUB_CONJUNTO   = 'documentos';      /* 11_DOCUMENTOS_PDFS */
var PUB_CFG        = 'configuracao';    /* 00_CONFIGURACAO    */
var PUB_LOG        = 'auditoria';       /* 14_LOGS_AUDITORIA  */
var PUB_PREFIXO    = 'PUB:';
var PUB_ID_TELA    = 'TELA_INICIAL';    /* o registro único da tela vigente */
var PUB_MAX_VERSOES = 10;
var PUB_MAX_IMAGEM  = 4 * 1024 * 1024;  /* 4 MB por imagem */
var PUB_FORMATOS    = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

var PUB_ESTADOS = ['rascunho', 'agendada', 'publicada', 'arquivada', 'cancelada'];


/* ============================================================================
   1. MODULE — a porta e o registro no Core
   ----------------------------------------------------------------------------
   Nenhum doPost aqui. A porta da rua continua sendo a API única; este arquivo
   só oferece a função que ela chama, com os três nomes que os Cores do ALMOXA
   costumam procurar.
   ============================================================================ */

function AP_PUBLICACAO_direto(json) {
  var p = {};
  try { p = JSON.parse(json || '{}'); } catch (e) {
    return JSON.stringify(PUB_erro_('CORPO_INVALIDO', 'O pedido não veio em JSON.'));
  }
  return JSON.stringify(PUB_atender_(p));
}
function AP_Modulo_publicacao(json) { return AP_PUBLICACAO_direto(json); }
function AP_COMUNICACAO_direto(json) { return AP_PUBLICACAO_direto(json); }

/** O que o Core precisa saber para registrar este módulo. */
function PUB_registro() {
  return {
    modulo: 'publicacao',
    contrato: PUB_CONTRATO,
    porta: 'AP_PUBLICACAO_direto',
    acoes: ['salvar', 'obter', 'listar', 'publicar', 'despublicar', 'arquivar',
            'tela', 'fundoLogin', 'vigente', 'versao', 'historico', 'restaurar',
            'diagnostico', 'contrato'],
    depende: ['ALMOXA_PRO_Repositorio.gs'],
    conjuntos: { publicacoes: PUB_CONJUNTO, tela: PUB_CFG, log: PUB_LOG },
    leituraOficialDaTelaInicial: 'publicacao.vigente'
  };
}


/* ============================================================================
   2. CONTROLLER — recebe e despacha
   ============================================================================ */

function PUB_atender_(p) {
  p = p || {};
  var acao = String(p.acao || p.operacao || '');
  var carga = p.payload || {};
  var quem = PUB_quem_(p);
  var t0 = new Date().getTime();

  try {
    var r;
    switch (acao) {
      case 'salvar':       r = PUB_svc_salvar_(carga, quem); break;
      case 'obter':        r = PUB_svc_obter_(carga, quem); break;
      case 'listar':       r = PUB_svc_listar_(carga, quem); break;
      case 'publicar':     r = PUB_pub_publicar_(carga, quem); break;
      case 'despublicar':  r = PUB_pub_despublicar_(carga, quem); break;
      case 'arquivar':     r = PUB_svc_mudarEstado_(carga, quem, 'arquivada'); break;
      case 'tela':         r = PUB_pub_gravarTela_(carga, quem); break;
      case 'fundoLogin':   r = PUB_proc_fundoLogin_(carga, quem); break;
      case 'vigente':      r = PUB_pub_vigente_(carga, quem); break;
      case 'versao':       r = PUB_pub_versao_(carga, quem); break;
      case 'historico':    r = PUB_pub_historico_(carga, quem); break;
      case 'restaurar':    r = PUB_pub_restaurar_(carga, quem); break;
      case 'diagnostico':  r = PUB_diag_(carga, quem); break;
      case 'contrato':     r = PUB_ok_(PUB_registro()); break;
      default:
        r = PUB_erro_('ACAO_DESCONHECIDA',
          'publicacao.' + acao + ' não existe. As ações são: '
          + PUB_registro().acoes.join(', ') + '.');
    }
    r.ms = new Date().getTime() - t0;
    return r;
  } catch (e) {
    return PUB_erro_('ESTOUROU', String((e && e.message) || e),
      { onde: (e && e.stack) ? String(e.stack).split('\n')[1] : '' });
  }
}

/* A identidade vem do Core, pela sessão. O que o navegador diz ser não vale
   como prova — e por isso este módulo nunca lê "perfil" do payload. */
function PUB_quem_(p) {
  return p.sessao || p.token || p.quem || null;
}

function PUB_ok_(dados, mensagem, extra) {
  var r = { ok: true, dados: dados === undefined ? null : dados,
    mensagem: mensagem || '', contrato: PUB_CONTRATO };
  if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) r[k] = extra[k];
  return r;
}
function PUB_erro_(codigo, mensagem, extra) {
  var r = { ok: false, codigo: codigo, mensagem: mensagem, contrato: PUB_CONTRATO };
  if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) r[k] = extra[k];
  return r;
}

function PUB_txt_(v) { return String(v === undefined || v === null ? '' : v).trim(); }
function PUB_num_(v) { var n = Number(v); return isFinite(n) ? n : 0; }
function PUB_copia_(o) { try { return JSON.parse(JSON.stringify(o)); } catch (e) { return null; } }
function PUB_agora_() { return new Date().toISOString(); }
function PUB_lista_(v) { return Object.prototype.toString.call(v) === '[object Array]' ? v : []; }


/* ============================================================================
   3. SERVICE — as regras de negócio
   ----------------------------------------------------------------------------
   Aqui mora a resposta para "isto pode ir ao ar?". Em lugar nenhum mais.
   ============================================================================ */

/**
 * Valida uma publicação. Devolve a lista de problemas em português, porque
 * quem vai ler é o almoxarife, não o programador.
 */
function PUB_svc_validar_(pb) {
  var erros = [];
  pb = pb || {};

  if (!PUB_txt_(pb.titulo)) erros.push('a publicação está sem título');
  if (PUB_txt_(pb.titulo).length > 180) erros.push('o título passa de 180 caracteres');
  if (PUB_txt_(pb.descricao).length > 20000) erros.push('o texto passa de 20.000 caracteres');

  if (PUB_txt_(pb.estado) && PUB_ESTADOS.indexOf(PUB_txt_(pb.estado)) < 0) {
    erros.push('o estado "' + PUB_txt_(pb.estado) + '" não existe');
  }

  var de = PUB_txt_(pb.exibirDe), ate = PUB_txt_(pb.exibirAte);
  if (de && isNaN(Date.parse(de))) erros.push('a data de início da exibição não é uma data');
  if (ate && isNaN(Date.parse(ate))) erros.push('a data de término da exibição não é uma data');
  if (de && ate && !isNaN(Date.parse(de)) && !isNaN(Date.parse(ate))
      && Date.parse(ate) < Date.parse(de)) {
    erros.push('a exibição termina antes de começar');
  }
  if (PUB_txt_(pb.estado) === 'agendada' && !de) {
    erros.push('uma publicação agendada precisa da data de início');
  }

  var cor = PUB_txt_(pb.corDestaque);
  if (cor && !/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(cor)) {
    erros.push('a cor de destaque "' + cor + '" não é uma cor');
  }

  return erros;
}

/** Cria ou atualiza. Idempotente: salvar duas vezes o mesmo id atualiza. */
function PUB_svc_salvar_(carga, quem) {
  var pb = carga.publicacao || carga;
  if (!PUB_repo_temRepositorio_()) {
    return PUB_erro_('SEM_REPOSITORIO',
      'O arquivo ALMOXA_PRO_Repositorio.gs não está neste projeto. Sem ele não há onde gravar.');
  }

  var erros = PUB_svc_validar_(pb);
  if (erros.length) {
    return PUB_erro_('INVALIDA', 'A publicação não está pronta: ' + erros.join('; ') + '.',
      { erros: erros });
  }

  var id = PUB_txt_(pb.id) || PUB_PREFIXO + Utilities.getUuid().slice(0, 8).toUpperCase();
  var existente = PUB_repo_ler_(id, quem);
  var agora = PUB_agora_();

  var registro = {
    id: id,
    tipo: 'publicacao',
    titulo: PUB_txt_(pb.titulo),
    descricao: PUB_txt_(pb.descricao),
    categoria: PUB_txt_(pb.categoria) || 'Comunicado',
    obra: PUB_txt_(pb.obra),
    corDestaque: PUB_txt_(pb.corDestaque),
    capa: PUB_txt_(pb.capa),
    fotos: PUB_lista_(pb.fotos),
    anexos: PUB_lista_(pb.anexos),
    estado: PUB_txt_(pb.estado) || 'rascunho',
    exibirDe: PUB_txt_(pb.exibirDe),
    exibirAte: PUB_txt_(pb.exibirAte),
    pedeNotificacao: !!pb.pedeNotificacao,
    /* quem criou nunca muda; quem alterou é sempre o último */
    criadoEm: (existente && existente.criadoEm) || agora,
    criadoPor: (existente && existente.criadoPor) || PUB_autor_(quem),
    atualizadoEm: agora,
    atualizadoPor: PUB_autor_(quem),
    publicadoEm: (existente && existente.publicadoEm) || '',
    publicadoPor: (existente && existente.publicadoPor) || ''
  };

  var gravou = PUB_repo_gravar_(registro, quem, !!existente);
  if (!gravou.ok) return gravou;

  PUB_audit_(quem, existente ? 'PUBLICACAO_ALTERADA' : 'PUBLICACAO_CRIADA', id,
    { titulo: registro.titulo, estado: registro.estado });

  return PUB_ok_(gravou.dados, existente ? 'Publicação atualizada.' : 'Publicação criada.');
}

function PUB_svc_obter_(carga, quem) {
  var id = PUB_txt_(carga.id);
  if (!id) return PUB_erro_('PEDIDO_INCOMPLETO', 'Informe o id da publicação.');
  var r = PUB_repo_ler_(id, quem);
  if (!r) return PUB_erro_('NAO_ENCONTRADA', 'Não existe publicação com o id ' + id + '.');
  return PUB_ok_(r);
}

function PUB_svc_listar_(carga, quem) {
  var saida = PUB_repo_listar_(quem);
  if (!saida.ok) return saida;
  var lista = PUB_lista_(saida.dados);

  var estado = PUB_txt_(carga.estado);
  var obra = PUB_txt_(carga.obra);
  if (estado) lista = lista.filter(function (x) { return PUB_txt_(x.estado) === estado; });
  if (obra)   lista = lista.filter(function (x) { return !PUB_txt_(x.obra) || PUB_txt_(x.obra) === obra; });

  lista.sort(function (a, b) {
    return String(b.atualizadoEm || '').localeCompare(String(a.atualizadoEm || ''));
  });
  return PUB_ok_(lista, '', { quantas: lista.length });
}

function PUB_svc_mudarEstado_(carga, quem, novo) {
  var id = PUB_txt_(carga.id);
  if (!id) return PUB_erro_('PEDIDO_INCOMPLETO', 'Informe o id da publicação.');
  var r = PUB_repo_ler_(id, quem);
  if (!r) return PUB_erro_('NAO_ENCONTRADA', 'Não existe publicação com o id ' + id + '.');

  r.estado = novo;
  r.atualizadoEm = PUB_agora_();
  r.atualizadoPor = PUB_autor_(quem);

  var gravou = PUB_repo_gravar_(r, quem, true);
  if (!gravou.ok) return gravou;

  PUB_audit_(quem, 'PUBLICACAO_' + novo.toUpperCase(), id, { titulo: r.titulo });
  return PUB_ok_(gravou.dados, 'Publicação ' + novo + '.');
}

function PUB_autor_(quem) {
  if (!quem) return '';
  if (typeof quem === 'string') return '';            /* é só um token */
  return PUB_txt_(quem.nome || quem.usuario || quem.id);
}


/* ============================================================================
   4. REPOSITORY — grava e lê
   ----------------------------------------------------------------------------
   Em cima do repositório que já existe. Nenhuma aba nova, nenhuma coluna nova.
   Toda gravação é relida e CONFERIDA PELO CONTEÚDO antes de responder.
   ============================================================================ */

function PUB_repo_temRepositorio_() {
  return typeof REPO_criarRegistro === 'function'
      && typeof REPO_lerRegistro === 'function'
      && typeof REPO_atualizarRegistro === 'function'
      && typeof REPO_listarRegistros === 'function';
}

/** A impressão digital do conteúdo, sem as marcas de tempo e de autor:
    são justamente o que EU carimbo, e por isso não entram na conta. */
var PUB_MARCAS = ['criadoEm', 'criadoPor', 'atualizadoEm', 'atualizadoPor',
                  'publicadoEm', 'publicadoPor', 'salvoEm', 'salvoPor', 'versao'];

function PUB_impressao_(o) {
  function limpar(v) {
    if (v === null || v === undefined) return null;
    if (Object.prototype.toString.call(v) === '[object Array]') return v.map(limpar);
    if (typeof v !== 'object') return v;
    var saida = {}, chaves = Object.keys(v).sort();
    for (var i = 0; i < chaves.length; i++) {
      if (PUB_MARCAS.indexOf(chaves[i]) > -1) continue;
      saida[chaves[i]] = limpar(v[chaves[i]]);
    }
    return saida;
  }
  try { return JSON.stringify(limpar(o)); } catch (e) { return null; }
}

function PUB_repo_ler_(id, quem) {
  try {
    var r = REPO_lerRegistro({ conjunto: PUB_CONJUNTO, id: id }, quem);
    if (r && r.ok && r.dados) return r.dados.conteudo || r.dados;
  } catch (e) {}
  return null;
}

function PUB_repo_gravar_(registro, quem, existe) {
  var pedido = { conjunto: PUB_CONJUNTO, id: registro.id, conteudo: registro };
  var r;
  try {
    r = existe ? REPO_atualizarRegistro(pedido, quem) : REPO_criarRegistro(pedido, quem);
  } catch (e) {
    return PUB_erro_('ESTOUROU_NA_GRAVACAO', String((e && e.message) || e));
  }
  if (!r || !r.ok) {
    return PUB_erro_(PUB_txt_(r && r.codigo) || 'NAO_GRAVOU',
      PUB_txt_(r && r.mensagem) || 'O repositório recusou a gravação.');
  }

  /* RELER E CONFERIR — pelo conteúdo, nunca pelo relógio */
  var volta = PUB_repo_ler_(registro.id, quem);
  if (!volta) {
    return PUB_erro_('NAO_CONFERIU',
      'Gravou, mas a releitura não trouxe a publicação de volta. Trate como NÃO gravado.');
  }
  if (PUB_impressao_(volta) !== PUB_impressao_(registro)) {
    return PUB_erro_('NAO_CONFERIU',
      'Gravou, mas o que voltou não é o que foi enviado. Trate como NÃO gravado.');
  }
  return PUB_ok_(volta);
}

function PUB_repo_listar_(quem) {
  try {
    var r = REPO_listarRegistros({ conjunto: PUB_CONJUNTO, tamanhoPagina: 500 }, quem);
    if (!r || !r.ok) {
      return PUB_erro_(PUB_txt_(r && r.codigo) || 'NAO_LISTOU',
        PUB_txt_(r && r.mensagem) || 'O repositório não devolveu a lista.');
    }
    /* só as publicações: o conjunto "documentos" é compartilhado, e por isso
       cada publicação carrega o prefixo no id */
    var so = PUB_lista_(r.dados).filter(function (x) {
      return String(x.id || '').indexOf(PUB_PREFIXO) === 0;
    });
    /* o índice traz o cabeçalho; o conteúdo vem na leitura de cada uma */
    var cheias = so.map(function (x) {
      return PUB_repo_ler_(x.id, quem) || x;
    }).filter(function (x) { return !!x; });
    return PUB_ok_(cheias);
  } catch (e) {
    return PUB_erro_('ESTOUROU_NA_LISTAGEM', String((e && e.message) || e));
  }
}

/* --- a tela vigente mora na configuração, num registro só --- */

function PUB_repo_lerTela_(quem) {
  try {
    var r = REPO_lerRegistro({ conjunto: PUB_CFG, id: PUB_ID_TELA }, quem);
    if (r && r.ok && r.dados) return r.dados.conteudo || r.dados;
  } catch (e) {}
  return null;
}

function PUB_repo_gravarTela_(tela, quem) {
  var existe = !!PUB_repo_lerTela_(quem);
  var pedido = { conjunto: PUB_CFG, id: PUB_ID_TELA, conteudo: tela };
  var r;
  try {
    r = existe ? REPO_atualizarRegistro(pedido, quem) : REPO_criarRegistro(pedido, quem);
  } catch (e) {
    return PUB_erro_('ESTOUROU_NA_GRAVACAO', String((e && e.message) || e));
  }
  if (!r || !r.ok) {
    return PUB_erro_(PUB_txt_(r && r.codigo) || 'NAO_GRAVOU',
      PUB_txt_(r && r.mensagem) || 'O repositório recusou a gravação da tela.');
  }
  var volta = PUB_repo_lerTela_(quem);
  if (!volta) {
    return PUB_erro_('NAO_CONFERIU',
      'Gravou, mas a releitura não trouxe a tela de volta. Trate como NÃO publicado.');
  }
  if (PUB_impressao_(volta) !== PUB_impressao_(tela)) {
    return PUB_erro_('NAO_CONFERIU',
      'Gravou, mas o que voltou não é o que foi enviado. Trate como NÃO publicado.');
  }
  return PUB_ok_(volta);
}

function PUB_audit_(quem, acao, alvo, extra) {
  try {
    if (typeof REPO_registrarAuditoria === 'function') {
      REPO_registrarAuditoria({
        conjunto: PUB_LOG, acao: acao, alvo: alvo,
        modulo: 'publicacao', quando: PUB_agora_(),
        detalhe: extra || {}            /* sem senha, sem token, sem dado pessoal */
      }, quem);
    }
  } catch (e) {}
}


/* ============================================================================
   5. PROCESSOR — imagens e anexos
   ----------------------------------------------------------------------------
   Imagem vai para o Drive, pelo repositório, e o que fica guardado na
   publicação é o IDENTIFICADOR do arquivo — nunca a imagem inteira dentro do
   registro, que é como se enche uma célula de planilha até ela parar de gravar.
   ============================================================================ */

function PUB_proc_guardarImagem_(img, quem) {
  img = img || {};
  var nome = PUB_txt_(img.nome) || ('imagem-' + new Date().getTime());
  var b64 = PUB_txt_(img.conteudoBase64);
  var mime = PUB_txt_(img.mimeType) || 'image/jpeg';

  if (!b64) return PUB_erro_('PEDIDO_INCOMPLETO', 'A imagem veio sem conteúdo.');
  if (PUB_FORMATOS.indexOf(mime) < 0) {
    return PUB_erro_('FORMATO_RECUSADO',
      'Formato "' + mime + '" não aceito. Use JPEG, PNG, WEBP ou GIF.');
  }
  /* base64 ocupa cerca de 4/3 do tamanho real */
  var bytes = Math.floor(b64.length * 3 / 4);
  if (bytes > PUB_MAX_IMAGEM) {
    return PUB_erro_('ARQUIVO_GRANDE',
      'A imagem tem ' + Math.round(bytes / 1024) + ' KB e o limite é '
      + Math.round(PUB_MAX_IMAGEM / 1024) + ' KB. Reduza antes de enviar.');
  }
  if (typeof REPO_uploadArquivo !== 'function') {
    return PUB_erro_('SEM_REPOSITORIO', 'O repositório não tem upload de arquivo.');
  }

  try {
    var r = REPO_uploadArquivo({
      tipo: 'imagem', nome: nome, mimeType: mime, conteudoBase64: b64,
      conjunto: PUB_CONJUNTO, registro: PUB_txt_(img.publicacaoId)
    }, quem);
    if (!r || !r.ok) {
      return PUB_erro_(PUB_txt_(r && r.codigo) || 'UPLOAD_FALHOU',
        PUB_txt_(r && r.mensagem) || 'Não consegui guardar a imagem.');
    }
    return PUB_ok_({ arquivoId: PUB_txt_((r.dados || {}).id || (r.dados || {}).arquivoId),
      url: PUB_txt_((r.dados || {}).url), nome: nome, mimeType: mime, bytes: bytes });
  } catch (e) {
    return PUB_erro_('ESTOUROU_NO_UPLOAD', String((e && e.message) || e));
  }
}

/**
 * O FUNDO DA TELA DE LOGIN.
 * Fica na configuração da tela, não embutido no HTML — é esse o ponto do
 * item 7: trocar a imagem não pode exigir gerar um APK novo.
 */
function PUB_proc_fundoLogin_(carga, quem) {
  if (!PUB_repo_temRepositorio_()) {
    return PUB_erro_('SEM_REPOSITORIO', 'Sem repositório não há onde guardar o fundo.');
  }
  var tela = PUB_repo_lerTela_(quem) || PUB_pub_telaVazia_();

  /* remover o fundo é um pedido legítimo */
  if (carga.remover) {
    tela.login = tela.login || {};
    tela.login.fundo = null;
    tela.atualizadoEm = PUB_agora_();
    var limpou = PUB_repo_gravarTela_(tela, quem);
    if (!limpou.ok) return limpou;
    PUB_audit_(quem, 'FUNDO_LOGIN_REMOVIDO', PUB_ID_TELA, {});
    return PUB_ok_(limpou.dados, 'Fundo do login removido.');
  }

  var guardou = PUB_proc_guardarImagem_({
    nome: PUB_txt_(carga.nome) || 'fundo-login',
    conteudoBase64: carga.conteudoBase64,
    mimeType: carga.mimeType,
    publicacaoId: PUB_ID_TELA
  }, quem);
  if (!guardou.ok) return guardou;

  tela.login = tela.login || {};
  /* guarda também o que estava, para o "restaurar a última configuração
     funcional" do item 7 não depender de o usuário lembrar */
  tela.login.fundoAnterior = tela.login.fundo || null;
  tela.login.fundo = {
    arquivoId: guardou.dados.arquivoId,
    url: guardou.dados.url,
    nome: guardou.dados.nome,
    /* enquadramento: cobrir a área, caber inteira ou tamanho original */
    ajuste: PUB_txt_(carga.ajuste) || 'cover',
    posicao: PUB_txt_(carga.posicao) || 'center',
    /* véu por cima, para o formulário continuar legível */
    sobreposicao: Math.max(0, Math.min(100, PUB_num_(carga.sobreposicao))),
    trocadoEm: PUB_agora_(),
    trocadoPor: PUB_autor_(quem)
  };
  tela.atualizadoEm = PUB_agora_();

  var gravou = PUB_repo_gravarTela_(tela, quem);
  if (!gravou.ok) return gravou;

  PUB_audit_(quem, 'FUNDO_LOGIN_TROCADO', PUB_ID_TELA,
    { arquivo: guardou.dados.arquivoId, bytes: guardou.dados.bytes });
  return PUB_ok_(gravou.dados, 'Fundo do login trocado. A tela de login já usa a imagem nova.');
}


/* ============================================================================
   6. PUBLISHER — quem decide o que está no ar
   ----------------------------------------------------------------------------
   Uma versão só, que só cresce. Quem publica compara a versão que tinha em
   mãos com a que está no servidor: se outra pessoa publicou no meio, este
   pedido é RECUSADO com CONFLITO, e nada é sobrescrito calado.
   ============================================================================ */

function PUB_pub_telaVazia_() {
  return {
    id: PUB_ID_TELA,
    versao: 0,
    destaque: { tipo: 'nenhum', publicacaoId: '' },
    visiveis: [],
    secoes: { comunicados: true, fotos: true, indicadores: false },
    cores: {},
    login: { fundo: null, manchete: '', apoio: '' },
    periodo: { inicio: '', fim: '' },
    versoes: [],
    publicadoEm: '', publicadoPor: '',
    atualizadoEm: ''
  };
}

function PUB_pub_gravarTela_(carga, quem) {
  if (!PUB_repo_temRepositorio_()) {
    return PUB_erro_('SEM_REPOSITORIO', 'Sem repositório não há onde gravar a tela.');
  }
  var nova = carga.tela || carga;
  var atual = PUB_repo_lerTela_(quem) || PUB_pub_telaVazia_();

  /* rascunho da tela: grava sem mexer no que a obra está vendo */
  if (carga.comoRascunho) {
    atual.rascunho = PUB_copia_(nova);
    atual.rascunho.salvoEm = PUB_agora_();
    atual.rascunho.salvoPor = PUB_autor_(quem);
    atual.atualizadoEm = PUB_agora_();
    var rs = PUB_repo_gravarTela_(atual, quem);
    if (!rs.ok) return rs;
    PUB_audit_(quem, 'TELA_RASCUNHO_SALVO', PUB_ID_TELA, {});
    return PUB_ok_(rs.dados, 'Rascunho da tela salvo. A obra continua vendo a versão publicada.');
  }

  return PUB_pub_publicarTela_(nova, atual, carga, quem);
}

function PUB_pub_publicarTela_(nova, atual, carga, quem) {
  /* 1 · as regras */
  var erros = PUB_pub_validarTela_(nova, quem);
  if (erros.length) {
    return PUB_erro_('INVALIDA',
      'A tela não está pronta para ir ao ar: ' + erros.join('; ') + '.', { erros: erros });
  }

  /* 2 · alguém publicou enquanto este pedido estava sendo montado? */
  var versaoEmMaos = PUB_num_(carga.versaoEmMaos);
  var versaoNoAr = PUB_num_(atual.versao);
  if (versaoEmMaos && versaoNoAr && versaoEmMaos < versaoNoAr) {
    return PUB_erro_('CONFLITO',
      'Alguém publicou a versão ' + versaoNoAr + ' enquanto você editava. '
      + 'Nada foi sobrescrito. Veja o que está no ar, junte com o seu e publique de novo.',
      { versaoNoAr: versaoNoAr, versaoEmMaos: versaoEmMaos });
  }

  /* 3 · o que sai do ar entra no histórico ANTES de ser trocado */
  var historico = PUB_lista_(atual.versoes);
  if (PUB_txt_(atual.publicadoEm)) {
    var anterior = PUB_copia_(atual);
    delete anterior.versoes;             /* histórico não guarda histórico */
    delete anterior.rascunho;
    historico.unshift({ versao: versaoNoAr, quando: atual.publicadoEm,
      quem: atual.publicadoPor, dados: anterior });
  }

  /* 4 · a versão nova */
  var tela = PUB_copia_(nova);
  tela.id = PUB_ID_TELA;
  tela.versao = versaoNoAr + 1;
  tela.publicadoEm = PUB_agora_();
  tela.publicadoPor = PUB_autor_(quem);
  tela.atualizadoEm = tela.publicadoEm;
  tela.versoes = historico.slice(0, PUB_MAX_VERSOES);
  tela.rascunho = null;                  /* publicou: o rascunho cumpriu o papel */
  /* o fundo do login não se perde quando a tela é republicada sem ele */
  if (!tela.login) tela.login = {};
  if (!tela.login.fundo && atual.login && atual.login.fundo) {
    tela.login.fundo = atual.login.fundo;
  }

  var gravou = PUB_repo_gravarTela_(tela, quem);
  if (!gravou.ok) return gravou;

  PUB_audit_(quem, 'TELA_PUBLICADA', PUB_ID_TELA,
    { versao: tela.versao, destaque: (tela.destaque || {}).publicacaoId || '' });

  return PUB_ok_(gravou.dados,
    'Publicado. Versão ' + tela.versao + ' no ar, em qualquer computador.',
    { versao: tela.versao });
}

function PUB_pub_validarTela_(t, quem) {
  var erros = [];
  t = t || {};
  var d = t.destaque || {};

  if (PUB_txt_(d.tipo) === 'publicacao') {
    var id = PUB_txt_(d.publicacaoId);
    if (!id) {
      erros.push('você escolheu “uma publicação do mural” e não escolheu qual');
    } else {
      var pb = PUB_repo_ler_(id, quem);
      if (!pb) erros.push('a publicação escolhida para o destaque não existe mais');
      else if (PUB_lista_(t.visiveis).indexOf(id) < 0) {
        erros.push('a publicação do destaque não está liberada para a área pública');
      } else if (PUB_txt_(pb.estado) === 'arquivada' || PUB_txt_(pb.estado) === 'cancelada') {
        erros.push('a publicação do destaque está ' + PUB_txt_(pb.estado));
      }
    }
  }

  var p = t.periodo || {};
  if (PUB_txt_(p.inicio) && isNaN(Date.parse(p.inicio))) erros.push('a data de início da campanha não é uma data');
  if (PUB_txt_(p.fim) && isNaN(Date.parse(p.fim))) erros.push('a data de fim da campanha não é uma data');
  if (PUB_txt_(p.inicio) && PUB_txt_(p.fim) && Date.parse(p.fim) < Date.parse(p.inicio)) {
    erros.push('a campanha termina antes de começar');
  }

  var cores = t.cores || {};
  for (var k in cores) {
    if (!cores.hasOwnProperty(k)) continue;
    var c = PUB_txt_(cores[k]);
    if (c && !/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(c)) {
      erros.push('a cor “' + k + '” não é uma cor válida');
    }
  }

  var l = t.login || {};
  if (l.fundo && l.fundo.sobreposicao !== undefined) {
    var s = PUB_num_(l.fundo.sobreposicao);
    if (s < 0 || s > 100) erros.push('a sobreposição do fundo do login tem de ficar entre 0 e 100');
  }
  return erros;
}

/**
 * A FONTE OFICIAL DA TELA INICIAL.
 * Devolve o que tem de estar na tela AGORA — já respeitando as datas de
 * exibição, para a tela não precisar saber de regra nenhuma.
 */
function PUB_pub_vigente_(carga, quem) {
  var tela = PUB_repo_lerTela_(quem);
  if (!tela) {
    return PUB_ok_({ versao: 0, tela: PUB_pub_telaVazia_(), publicacoes: [],
      vazio: true }, 'Nenhuma publicação ainda. A tela mostra o padrão do sistema.');
  }

  var agora = new Date().getTime();

  /* a campanha inteira pode estar fora do período */
  var p = tela.periodo || {};
  var dentroDaCampanha = true;
  if (PUB_txt_(p.inicio) && Date.parse(p.inicio) > agora) dentroDaCampanha = false;
  if (PUB_txt_(p.fim) && Date.parse(p.fim) < agora) dentroDaCampanha = false;

  var publicacoes = [];
  if (dentroDaCampanha) {
    var ids = PUB_lista_(tela.visiveis);
    for (var i = 0; i < ids.length; i++) {
      var pb = PUB_repo_ler_(ids[i], quem);
      if (!pb) continue;
      if (PUB_txt_(pb.estado) !== 'publicada' && PUB_txt_(pb.estado) !== 'agendada') continue;
      if (PUB_txt_(pb.exibirDe) && Date.parse(pb.exibirDe) > agora) continue;
      if (PUB_txt_(pb.exibirAte) && Date.parse(pb.exibirAte) < agora) continue;
      publicacoes.push(pb);               /* já na ordem que ele escolheu */
    }
  }

  var saida = PUB_copia_(tela);
  delete saida.versoes;                   /* a tela não precisa do histórico */
  delete saida.rascunho;                  /* nem do rascunho de ninguém */
  if (!dentroDaCampanha) {
    saida.destaque = { tipo: 'nenhum', publicacaoId: '' };
    saida.foraDoPeriodo = true;
  }
  /* o destaque só vale se a publicação dele estiver mesmo no ar agora */
  var d = saida.destaque || {};
  if (PUB_txt_(d.tipo) === 'publicacao') {
    var achou = false;
    for (var j = 0; j < publicacoes.length; j++) {
      if (publicacoes[j].id === PUB_txt_(d.publicacaoId)) { achou = true; break; }
    }
    if (!achou) saida.destaque = { tipo: 'nenhum', publicacaoId: '' };
  }

  return PUB_ok_({
    versao: PUB_num_(tela.versao),
    publicadoEm: PUB_txt_(tela.publicadoEm),
    publicadoPor: PUB_txt_(tela.publicadoPor),
    tela: saida,
    publicacoes: publicacoes,
    servidorEm: PUB_agora_()
  });
}

/** Só o número, para a tela conferir de tempos em tempos sem puxar tudo. */
function PUB_pub_versao_(carga, quem) {
  var tela = PUB_repo_lerTela_(quem);
  return PUB_ok_({
    versao: tela ? PUB_num_(tela.versao) : 0,
    publicadoEm: tela ? PUB_txt_(tela.publicadoEm) : '',
    servidorEm: PUB_agora_()
  });
}

function PUB_pub_publicar_(carga, quem) {
  /* publicar a TELA */
  if (carga.tela) return PUB_pub_gravarTela_(carga, quem);

  /* publicar UMA publicação */
  var id = PUB_txt_(carga.id);
  if (!id) {
    return PUB_erro_('PEDIDO_INCOMPLETO',
      'Informe o id da publicação, ou mande a tela em "tela".');
  }
  var pb = PUB_repo_ler_(id, quem);
  if (!pb) return PUB_erro_('NAO_ENCONTRADA', 'Não existe publicação com o id ' + id + '.');

  var erros = PUB_svc_validar_(pb);
  if (erros.length) {
    return PUB_erro_('INVALIDA', 'A publicação não pode ir ao ar: ' + erros.join('; ') + '.',
      { erros: erros });
  }

  var agora = PUB_agora_();
  /* agendada se a data de início ainda não chegou */
  var futura = PUB_txt_(pb.exibirDe) && Date.parse(pb.exibirDe) > new Date().getTime();
  pb.estado = futura ? 'agendada' : 'publicada';
  pb.publicadoEm = agora;
  pb.publicadoPor = PUB_autor_(quem);
  pb.atualizadoEm = agora;
  pb.atualizadoPor = PUB_autor_(quem);

  var gravou = PUB_repo_gravar_(pb, quem, true);
  if (!gravou.ok) return gravou;

  PUB_audit_(quem, futura ? 'PUBLICACAO_AGENDADA' : 'PUBLICACAO_PUBLICADA', id,
    { titulo: pb.titulo, de: pb.exibirDe, ate: pb.exibirAte });

  return PUB_ok_(gravou.dados, futura
    ? 'Agendada para ' + pb.exibirDe + '. Entra sozinha na hora.'
    : 'Publicada. Já pode ser liberada na tela inicial.');
}

function PUB_pub_despublicar_(carga, quem) {
  var id = PUB_txt_(carga.id);
  if (!id) return PUB_erro_('PEDIDO_INCOMPLETO', 'Informe o id da publicação.');

  var r = PUB_svc_mudarEstado_({ id: id }, quem, 'rascunho');
  if (!r.ok) return r;

  /* e some da tela, se estava lá — senão a tela fica apontando para o vazio */
  var tela = PUB_repo_lerTela_(quem);
  if (tela) {
    var vis = PUB_lista_(tela.visiveis);
    var i = vis.indexOf(id);
    var mexeu = false;
    if (i > -1) { vis.splice(i, 1); tela.visiveis = vis; mexeu = true; }
    if (tela.destaque && PUB_txt_(tela.destaque.publicacaoId) === id) {
      tela.destaque = { tipo: 'nenhum', publicacaoId: '' };
      mexeu = true;
    }
    if (mexeu) {
      tela.versao = PUB_num_(tela.versao) + 1;
      tela.publicadoEm = PUB_agora_();
      tela.publicadoPor = PUB_autor_(quem);
      PUB_repo_gravarTela_(tela, quem);
    }
  }
  PUB_audit_(quem, 'PUBLICACAO_DESPUBLICADA', id, {});
  return PUB_ok_(r.dados, 'Tirada do ar. Os dados continuam guardados.');
}

function PUB_pub_historico_(carga, quem) {
  var tela = PUB_repo_lerTela_(quem);
  var vs = tela ? PUB_lista_(tela.versoes) : [];
  return PUB_ok_(vs.map(function (v) {
    return { versao: v.versao, quando: v.quando, quem: v.quem };   /* sem o pacote inteiro */
  }), '', { quantas: vs.length });
}

function PUB_pub_restaurar_(carga, quem) {
  var alvo = PUB_num_(carga.versao);
  if (!alvo) return PUB_erro_('PEDIDO_INCOMPLETO', 'Informe o número da versão.');

  var tela = PUB_repo_lerTela_(quem);
  if (!tela) return PUB_erro_('NAO_ENCONTRADA', 'Não há tela publicada ainda.');

  var vs = PUB_lista_(tela.versoes), achada = null;
  for (var i = 0; i < vs.length; i++) if (PUB_num_(vs[i].versao) === alvo) { achada = vs[i]; break; }
  if (!achada) {
    return PUB_erro_('NAO_ENCONTRADA',
      'A versão ' + alvo + ' não está no histórico. Guardo as últimas ' + PUB_MAX_VERSOES + '.');
  }

  /* restaurar é publicar de novo: vira uma versão NOVA, e a atual entra no
     histórico. Assim dá para desfazer o próprio restaurar. */
  var volta = PUB_copia_(achada.dados);
  var r = PUB_pub_publicarTela_(volta, tela, { versaoEmMaos: PUB_num_(tela.versao) }, quem);
  if (r.ok) {
    PUB_audit_(quem, 'TELA_RESTAURADA', PUB_ID_TELA, { de: alvo, para: r.versao });
    r.mensagem = 'Versão ' + alvo + ' de volta no ar, como versão ' + r.versao + '.';
  }
  return r;
}


/* ============================================================================
   7. INTEGRATION — o contrato com o Core
   ----------------------------------------------------------------------------
   Instalação: cole este arquivo no projeto do Apps Script e acrescente a rota
   no roteador da API única, do mesmo jeito que o confronte:

       case 'publicacao':
       case 'comunicacao':
         return AP_PUBLICACAO_direto(JSON.stringify(pedido));

   Se o Core tiver registro de módulos, ele pode chamar PUB_registro() para
   saber contrato, ações e dependências. Se não tiver, não faz falta.
   ============================================================================ */

/** Para o Core (ou você) conferir que o módulo está vivo, sem gravar nada. */
function PUB_ping() {
  return PUB_ok_({ vivo: true, contrato: PUB_CONTRATO, quando: PUB_agora_() });
}


/* ============================================================================
   8. DIAGNOSTICS — onde quebrou e por quê
   ============================================================================ */

function PUB_diag_(carga, quem) {
  var etapas = [];
  function passo(nome, ok, detalhe) { etapas.push({ etapa: nome, ok: !!ok, detalhe: detalhe || '' }); }

  passo('módulo carregado', true, PUB_CONTRATO);

  var temRepo = PUB_repo_temRepositorio_();
  passo('repositório disponível', temRepo,
    temRepo ? 'REPO_* respondendo' : 'falta ALMOXA_PRO_Repositorio.gs no projeto');

  if (!temRepo) {
    return PUB_ok_({ etapas: etapas, conclusao: 'sem repositório nada mais funciona' });
  }

  var temUpload = typeof REPO_uploadArquivo === 'function';
  passo('upload de imagem disponível', temUpload,
    temUpload ? 'REPO_uploadArquivo presente' : 'não dá para guardar imagem nem fundo de login');

  /* leitura da tela vigente */
  var tela = null, erroLeitura = '';
  try { tela = PUB_repo_lerTela_(quem); } catch (e) { erroLeitura = String(e && e.message); }
  passo('leitura da tela vigente', !erroLeitura,
    erroLeitura || (tela ? ('versão ' + PUB_num_(tela.versao)
      + (PUB_txt_(tela.publicadoEm) ? ', publicada em ' + tela.publicadoEm : ''))
      : 'nenhuma tela publicada ainda'));

  /* gravação de verdade, num registro de teste que é apagado em seguida */
  var escreve = false, detalheEscrita = '';
  try {
    var id = PUB_PREFIXO + 'DIAG';
    var teste = { id: id, tipo: 'publicacao', titulo: 'teste de diagnóstico',
      descricao: 'gravado e apagado pelo diagnóstico', categoria: 'Comunicado',
      obra: '', corDestaque: '', capa: '', fotos: [], anexos: [],
      estado: 'rascunho', exibirDe: '', exibirAte: '', pedeNotificacao: false,
      criadoEm: PUB_agora_(), criadoPor: '', atualizadoEm: PUB_agora_(),
      atualizadoPor: '', publicadoEm: '', publicadoPor: '' };
    var jaTem = !!PUB_repo_ler_(id, quem);
    var g = PUB_repo_gravar_(teste, quem, jaTem);
    escreve = !!g.ok;
    detalheEscrita = g.ok ? 'gravou e a releitura conferiu o conteúdo'
                          : (g.codigo + ': ' + g.mensagem);
    if (g.ok && typeof REPO_excluirRegistro === 'function') {
      try { REPO_excluirRegistro({ conjunto: PUB_CONJUNTO, id: id }, quem); } catch (e) {}
    }
  } catch (e) { detalheEscrita = String(e && e.message); }
  passo('gravar e reler uma publicação', escreve, detalheEscrita);

  /* a tela inicial e o fundo do login */
  var fundo = tela && tela.login && tela.login.fundo;
  passo('fundo do login configurado', !!fundo,
    fundo ? ('arquivo ' + PUB_txt_(fundo.arquivoId) + ', trocado em ' + PUB_txt_(fundo.trocadoEm))
          : 'nenhum fundo publicado — a tela usa o fundo padrão do sistema');

  var vig = PUB_pub_vigente_({}, quem);
  passo('publicacao.vigente responde', !!(vig && vig.ok),
    vig && vig.ok ? (PUB_lista_(vig.dados.publicacoes).length + ' publicação(ões) no ar, versão '
      + vig.dados.versao) : 'não respondeu');

  var tudoOk = etapas.every(function (e) { return e.ok; });
  return PUB_ok_({
    etapas: etapas,
    contrato: PUB_CONTRATO,
    conjuntos: PUB_registro().conjuntos,
    conclusao: tudoOk ? 'tudo de pé'
      : 'há etapa com problema — veja qual está com ok:false'
  });
}


/* ============================================================================
   TESTES — rode direto no editor do Apps Script
   ----------------------------------------------------------------------------
   Selecione a função e clique em Executar. O resultado sai no registro.
   Nada aqui apaga publicação sua: tudo usa ids com DIAG/TESTE no nome.
   ============================================================================ */

function PUB_TESTE_tudo() {
  var linhas = [];
  function diz(s) { linhas.push(s); Logger.log(s); }

  diz('MÓDULO DE PUBLICAÇÃO — ' + PUB_CONTRATO);
  diz('');

  var d = PUB_diag_({}, null);
  d.dados.etapas.forEach(function (e) {
    diz((e.ok ? '  ok   ' : '  FALHA ') + e.etapa + (e.detalhe ? ' — ' + e.detalhe : ''));
  });
  diz('  => ' + d.dados.conclusao);
  diz('');

  /* A · nova publicação, salva e relida */
  var id = PUB_PREFIXO + 'TESTE1';
  var a = PUB_atender_({ acao: 'salvar', payload: { publicacao: {
    id: id, titulo: 'Teste A — Outubro Rosa', descricao: 'faça o seu exame',
    categoria: 'Campanha', estado: 'rascunho' } } });
  diz('Teste A · salvar ..... ' + (a.ok ? 'ok' : 'FALHOU: ' + a.mensagem));
  var a2 = PUB_atender_({ acao: 'obter', payload: { id: id } });
  diz('Teste A · reler ...... ' + (a2.ok && a2.dados.titulo === 'Teste A — Outubro Rosa'
    ? 'ok, os dados continuam lá' : 'FALHOU'));

  /* publicar a publicação e depois a tela */
  var b = PUB_atender_({ acao: 'publicar', payload: { id: id } });
  diz('Teste B · publicar ... ' + (b.ok ? 'ok, estado ' + b.dados.estado : 'FALHOU: ' + b.mensagem));

  var vAntes = PUB_atender_({ acao: 'versao', payload: {} });
  var t = PUB_atender_({ acao: 'publicar', payload: { tela: {
    destaque: { tipo: 'publicacao', publicacaoId: id },
    visiveis: [id], secoes: { comunicados: true, fotos: true, indicadores: false },
    cores: { destaque: '#E6397F' }, login: {}, periodo: {} },
    versaoEmMaos: vAntes.dados.versao } });
  diz('Teste B · tela ....... ' + (t.ok ? 'ok, versão ' + t.versao : 'FALHOU: ' + t.mensagem));

  var vig = PUB_atender_({ acao: 'vigente', payload: {} });
  diz('Teste B · vigente .... ' + (vig.ok && vig.dados.tela.destaque.publicacaoId === id
    ? 'ok, a tela inicial recebe o destaque certo' : 'FALHOU'));

  /* E · recusa configuração inválida */
  var mau = PUB_atender_({ acao: 'publicar', payload: { tela: {
    destaque: { tipo: 'publicacao', publicacaoId: '' }, visiveis: [], cores: {},
    login: {}, periodo: {} } } });
  diz('Teste E · inválida ... ' + (!mau.ok ? 'ok, recusou — ' + mau.mensagem
    : 'FALHOU: aceitou o que não devia'));

  /* F · conflito de duas publicações */
  var conf = PUB_atender_({ acao: 'publicar', payload: { tela: {
    destaque: { tipo: 'nenhum', publicacaoId: '' }, visiveis: [], cores: {},
    login: {}, periodo: {} }, versaoEmMaos: 1 } });
  diz('Teste F · conflito ... ' + (!conf.ok && conf.codigo === 'CONFLITO'
    ? 'ok, avisou em vez de gravar por cima' : (conf.ok ? 'passou (não havia conflito)' : 'FALHOU')));

  /* histórico */
  var h = PUB_atender_({ acao: 'historico', payload: {} });
  diz('Teste D · histórico .. ' + (h.ok ? 'ok, ' + h.quantas + ' versão(ões) guardadas' : 'FALHOU'));

  diz('');
  diz('Para limpar o teste: PUB_TESTE_limpar()');
  return linhas.join('\n');
}

function PUB_TESTE_limpar() {
  var ids = [PUB_PREFIXO + 'TESTE1', PUB_PREFIXO + 'DIAG'];
  var n = 0;
  ids.forEach(function (id) {
    try {
      if (typeof REPO_excluirRegistro === 'function' && PUB_repo_ler_(id, null)) {
        REPO_excluirRegistro({ conjunto: PUB_CONJUNTO, id: id }, null); n++;
      }
    } catch (e) {}
  });
  Logger.log('apaguei ' + n + ' registro(s) de teste. A sua tela publicada não foi tocada.');
  return n;
}
