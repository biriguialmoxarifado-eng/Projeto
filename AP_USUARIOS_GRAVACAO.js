/**
 * ============================================================================
 * AP_USUARIOS_GRAVACAO.gs
 * ALMOX-PRO · Operação oficial única de gravação de cadastro de usuário
 * ----------------------------------------------------------------------------
 * POR QUE ESTE ARQUIVO EXISTE
 *   O sistema não possui uma operação de ATUALIZAÇÃO. "usuarios.salvar" foi
 *   escrito para CRIAR, e localiza o cadastro pela MATRÍCULA — um dado que o
 *   usuário pode mudar. Isso produz dois defeitos:
 *
 *     a) editar com matrícula  → a checagem de duplicidade compara a matrícula
 *                                contra TODAS as linhas, inclusive a própria,
 *                                e recusa com USUARIO_DUPLICADO;
 *     b) editar sem matrícula  → não encontra ninguém e CRIA outra linha.
 *
 *   Exclusão lógica, bloqueio, troca de matrícula e a importação do RH são
 *   todas atualizações. Por isso nenhuma delas funciona.
 *
 * O QUE ESTE ARQUIVO FAZ
 *   Uma única operação de atualização, com três regras:
 *     1. localiza o cadastro pelo "id" (chave interna estável);
 *        se não achar o id, RECUSA — nunca cria;
 *     2. checa duplicidade SOMENTE nos campos que realmente mudaram, e
 *        NUNCA contra a própria linha;
 *     3. relê a linha na planilha depois de gravar e só então responde ok.
 *
 * O QUE ESTE ARQUIVO NÃO FAZ
 *   Não cria aba, não renomeia aba, não cria coluna, não apaga linha, não
 *   apaga foto, crachá, biometria, permissão ou histórico. Não cria planilha
 *   paralela. Não substitui o módulo de usuários: é o motor de gravação que
 *   o módulo existente passa a chamar. Não valida sessão por conta própria —
 *   quem chama é que valida (veja AP_USR_VALIDAR_SESSAO).
 *
 * FONTE OFICIAL
 *   Aba "USUARIOS" da planilha do ALMOX-PRO. Colunas confirmadas na base:
 *     id, nome, email, senha_hash, perfil, status, criado_em, matricula,
 *     login, cargo, setor, telefone, obra, foto, biometria, facial, cracha,
 *     ultimo_acesso, acesso_desktop, acesso_mobile, crachaFotoId,
 *     crachaFotoUrl, crachaFotoEm
 *   A aba "ALMOXA_USUARIOS" contém só cabeçalhos e NÃO é usada aqui.
 *
 * COMO COMEÇAR
 *   1. Cole este arquivo no projeto do Apps Script.
 *   2. Rode AP_USR_testar(). Ele não grava nada. Leia o relatório.
 *   3. AP_USR_SIMULAR já vem FALSE nesta versão (28/10): o módulo grava
 *      de verdade. Se quiser ensaiar antes, troque para true, teste pela
 *      interface — a resposta dirá o que SERIA gravado — e volte para false.
 *   4. Antes de publicar, faça uma cópia da planilha (Arquivo › Fazer uma
 *      cópia). A partir daqui ele escreve de verdade.
 *   5. Ligue no módulo existente — instruções no fim do arquivo, em
 *      "COMO LIGAR NO SISTEMA EXISTENTE".
 * ============================================================================
 */


/* ============================================================================
 * 1. CONFIGURAÇÃO
 * ========================================================================= */

/** Vazio = usa a planilha vinculada a este projeto do Apps Script.
 *  Preencher só se o projeto não estiver vinculado à planilha certa. */
var AP_USR_PLANILHA_ID = "";

/** A aba oficial dos cadastros. */
var AP_USR_ABA = "USUARIOS";

/** A coluna da chave interna estável. Nunca é alterada por edição. */
var AP_USR_COL_ID = "id";

/** Campos que não podem repetir entre cadastros ATIVOS. */
var AP_USR_UNICOS = ["matricula", "email", "login"];

/** Nunca alterados por uma edição, mesmo que venham no pedido. */
var AP_USR_NUNCA_ALTERAR = ["id", "senha_hash", "criado_em"];

/** Valor de status que representa exclusão lógica. */
var AP_USR_STATUS_EXCLUIDO = "EXCLUIDO";

/** Valor de status que representa cadastro em uso. */
var AP_USR_STATUS_ATIVO = "ATIVO";

/** O INTERRUPTOR DA GRAVAÇÃO.
 *
 *  Com true, o módulo calcula tudo, diz exatamente o que mudaria e
 *  NÃO grava nada. Era assim que este arquivo vinha — um ensaio, para
 *  conferir antes de deixar escrever na planilha de verdade.
 *
 *  28/10: ligado para valer. O ensaio já cumpriu o papel — foi ele que
 *  mostrou, na tela dele, "2 campo(s) seriam alterados na linha 107":
 *  o módulo acha a pessoa e sabe o que fazer. Enquanto esteve true,
 *  NENHUMA alteração de usuário era gravada, nem cadastro nem senha.
 *
 *  Para voltar ao ensaio a qualquer momento, troque false por true
 *  aqui e publique nova versão. Nada mais precisa mudar.
 *
 *  AP_USR_diagnostico() e AP_USR_testar() dizem em que modo ele está.
 */
var AP_USR_SIMULAR = false;

/** Nome da função de validação de sessão que JÁ EXISTE no seu projeto.
 *  Deixe vazio se quem chama este motor já validou a sessão (é o caso
 *  quando o chamador é o roteador almoxaApi). Se preencher, ela é chamada
 *  com o token e precisa devolver algo verdadeiro para a gravação seguir. */
var AP_USR_VALIDAR_SESSAO = "";

/** Abas técnicas onde o registro da operação é anotado. É usada a PRIMEIRA
 *  que existir. Se nenhuma existir, a gravação continua e o aviso aparece
 *  na resposta — a falta de log nunca derruba a operação. */
var AP_USR_ABAS_LOG = [
  "ALMOXA_SERVIDOR_OPERACOES",
  "AUDITORIA",
  "LOG",
  "DIAGNOSTICOS",
  "EVENTOS"
];

/** Segundos de espera pela trava de escrita. */
var AP_USR_TRAVA_MS = 25000;


/* ============================================================================
 * 2. ACESSO À PLANILHA
 * ========================================================================= */

/**
 * Acha uma função do projeto pelo nome, sem eval.
 * No Apps Script toda função global é propriedade do objeto global; é por
 * ali que se procura. O eval fica como último recurso porque em alguns
 * contextos ele resolve no escopo errado e devolve "não existe" para uma
 * função que existe.
 */
function AP_USR_funcaoPorNome_(nome) {
  if (!nome) return null;
  var g = null;
  try { g = (function () { return this; })(); } catch (e) {}
  if (!g) { try { g = globalThis; } catch (e2) {} }
  if (g && typeof g[nome] === "function") return g[nome];
  try {
    var f = eval(nome);
    if (typeof f === "function") return f;
  } catch (e3) {}
  return null;
}

function AP_USR_planilha_() {
  if (AP_USR_PLANILHA_ID) return SpreadsheetApp.openById(AP_USR_PLANILHA_ID);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("PLANILHA_NAO_VINCULADA");
  return ss;
}

function AP_USR_aba_() {
  var aba = AP_USR_planilha_().getSheetByName(AP_USR_ABA);
  if (!aba) throw new Error("ABA_NAO_ENCONTRADA:" + AP_USR_ABA);
  return aba;
}

/** { nomeDaColuna: numeroDaColuna } — 1-based, como o getRange espera. */
function AP_USR_cabecalho_(aba) {
  var largura = aba.getLastColumn();
  if (largura < 1) throw new Error("ABA_SEM_CABECALHO");
  var linha = aba.getRange(1, 1, 1, largura).getValues()[0];
  var mapa = {};
  for (var i = 0; i < linha.length; i++) {
    var nome = String(linha[i] == null ? "" : linha[i]).trim();
    if (nome && mapa[nome] === undefined) mapa[nome] = i + 1;
  }
  return mapa;
}


/* ============================================================================
 * 3. NORMALIZAÇÃO — é o que faz "0408194" e "408194" serem a mesma matrícula
 * ========================================================================= */

function AP_USR_txt_(v) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd");
  return String(v).trim();
}

/** Chave de comparação de matrícula: sem pontuação, sem zeros à esquerda. */
function AP_USR_chaveMat_(v) {
  var s = AP_USR_txt_(v).toUpperCase().replace(/[^A-Z0-9]/g, "");
  s = s.replace(/^0+/, "");
  return s;
}

/** Chave de comparação de e-mail e login. */
function AP_USR_chaveTexto_(v) {
  return AP_USR_txt_(v).toLowerCase();
}

/** A chave de comparação correta para cada campo único. */
function AP_USR_chaveDe_(campo, valor) {
  if (campo === "matricula") return AP_USR_chaveMat_(valor);
  return AP_USR_chaveTexto_(valor);
}

/** Um status conta como excluído? */
function AP_USR_estaExcluido_(status) {
  var s = AP_USR_txt_(status).toUpperCase();
  return s.indexOf("EXCLUIDO") === 0 || s.indexOf("EXCLUÍDO") === 0;
}


/* ============================================================================
 * 4. LOCALIZAR O CADASTRO — pelo id, e só pelo id
 * ========================================================================= */

/**
 * Devolve o número da linha do cadastro, ou 0 se não existir.
 * Lê a coluna "id" inteira de uma vez: 201 linhas é leitura de um bloco.
 */
function AP_USR_linhaDoId_(aba, cab, id) {
  var alvo = AP_USR_txt_(id);
  if (!alvo) return 0;
  var colId = cab[AP_USR_COL_ID];
  if (!colId) throw new Error("COLUNA_ID_NAO_ENCONTRADA:" + AP_USR_COL_ID);
  var ultima = aba.getLastRow();
  if (ultima < 2) return 0;
  var ids = aba.getRange(2, colId, ultima - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (AP_USR_txt_(ids[i][0]) === alvo) return i + 2;
  }
  return 0;
}

/** A linha inteira, como { coluna: valor }. */
function AP_USR_lerLinha_(aba, cab, linha) {
  var largura = aba.getLastColumn();
  var vals = aba.getRange(linha, 1, 1, largura).getValues()[0];
  var reg = {};
  for (var nome in cab) {
    if (!Object.prototype.hasOwnProperty.call(cab, nome)) continue;
    reg[nome] = vals[cab[nome] - 1];
  }
  return reg;
}


/* ============================================================================
 * 5. A CORREÇÃO — a checagem de duplicidade que faltava
 * ========================================================================= */

/**
 * Procura conflito nos campos únicos.
 *
 * DUAS REGRAS, E SÃO ELAS QUE CONSERTAM O SISTEMA:
 *
 *   1. A PRÓPRIA LINHA É IGNORADA. Um cadastro nunca é duplicata de si
 *      mesmo. Sem isso, toda edição de um registro existente é recusada —
 *      é exatamente o USUARIO_DUPLICADO que aparece ao excluir.
 *
 *   2. SÓ CAMPOS QUE MUDARAM SÃO CHECADOS. Se a matrícula enviada é igual
 *      à que já está gravada, não há nada a validar. Isso importa porque a
 *      base tem cadastros repetidos de antes: eles não podem travar uma
 *      operação que não mexe no campo repetido — inclusive a exclusão que
 *      serve para limpá-los.
 *
 * Linhas já excluídas logicamente não geram conflito: a matrícula de um
 * cadastro excluído está livre.
 *
 * @return null, ou { campo, valor, linha, idDoOutro, nomeDoOutro }
 */
function AP_USR_conflito_(aba, cab, pedido, linhaAtual, atual) {
  var checar = [];
  for (var i = 0; i < AP_USR_UNICOS.length; i++) {
    var campo = AP_USR_UNICOS[i];
    if (!cab[campo]) continue;                                  // coluna não existe
    if (!Object.prototype.hasOwnProperty.call(pedido, campo)) continue;  // não veio
    var novo = AP_USR_chaveDe_(campo, pedido[campo]);
    if (!novo) continue;                                        // vazio não é único
    var velho = AP_USR_chaveDe_(campo, atual ? atual[campo] : "");
    if (novo === velho) continue;                               // REGRA 2: não mudou
    checar.push({ campo: campo, chave: novo });
  }
  if (!checar.length) return null;

  var ultima = aba.getLastRow();
  if (ultima < 2) return null;
  var largura = aba.getLastColumn();
  var bloco = aba.getRange(2, 1, ultima - 1, largura).getValues();

  var colStatus = cab["status"] || 0;
  var colId = cab[AP_USR_COL_ID];
  var colNome = cab["nome"] || 0;

  for (var r = 0; r < bloco.length; r++) {
    var linha = r + 2;
    if (linha === linhaAtual) continue;                         // REGRA 1: eu mesmo
    if (colStatus && AP_USR_estaExcluido_(bloco[r][colStatus - 1])) continue;
    for (var c = 0; c < checar.length; c++) {
      var campo = checar[c].campo;
      var valorLinha = AP_USR_chaveDe_(campo, bloco[r][cab[campo] - 1]);
      if (valorLinha && valorLinha === checar[c].chave) {
        return {
          campo: campo,
          valor: AP_USR_txt_(pedido[campo]),
          linha: linha,
          idDoOutro: colId ? AP_USR_txt_(bloco[r][colId - 1]) : "",
          nomeDoOutro: colNome ? AP_USR_txt_(bloco[r][colNome - 1]) : ""
        };
      }
    }
  }
  return null;
}


/* ============================================================================
 * 6. MONTAR AS MUDANÇAS
 * ========================================================================= */

/**
 * Compara o pedido com a linha atual e devolve só o que muda de verdade.
 *
 * Campo vazio NÃO sobrescreve valor preenchido. Isso evita que a tela, ao
 * mandar o cadastro inteiro com um campo que ela não carregou, apague um
 * dado válido. Para limpar um campo de propósito, mande o nome dele em
 * pedido.__limpar (lista).
 *
 * @return [ { campo, coluna, de, para } ]
 */
function AP_USR_mudancas_(cab, pedido, atual) {
  var limpar = {};
  if (pedido && pedido.__limpar && pedido.__limpar.length) {
    for (var l = 0; l < pedido.__limpar.length; l++) limpar[String(pedido.__limpar[l])] = true;
  }
  var fora = {};
  for (var n = 0; n < AP_USR_NUNCA_ALTERAR.length; n++) fora[AP_USR_NUNCA_ALTERAR[n]] = true;

  var lista = [];
  for (var campo in pedido) {
    if (!Object.prototype.hasOwnProperty.call(pedido, campo)) continue;
    if (campo.indexOf("__") === 0) continue;          // controle interno da tela
    if (fora[campo]) continue;                        // id, senha_hash, criado_em
    if (!cab[campo]) continue;                        // coluna não existe na aba
    var para = pedido[campo];
    if (para === null || para === undefined) continue;
    var de = atual[campo];
    var paraTxt = AP_USR_txt_(para), deTxt = AP_USR_txt_(de);
    if (paraTxt === "" && deTxt !== "" && !limpar[campo]) continue;  // não apaga
    if (paraTxt === deTxt) continue;                  // não mudou
    lista.push({ campo: campo, coluna: cab[campo], de: deTxt, para: paraTxt });
  }
  return lista;
}


/* ============================================================================
 * 7. A OPERAÇÃO OFICIAL DE ATUALIZAÇÃO
 * ========================================================================= */

/**
 * Atualiza um cadastro existente. Nunca cria.
 *
 * @param {Object} pedido  precisa de "id". Os demais campos são opcionais e
 *                         só os presentes são alterados.
 * @param {Object} ctx     { quem, origem, motivo, token } — opcional.
 * @return {Object} { ok, etapa, codigo, mensagem, linha, mudou, dados, simulado }
 *
 * ETAPAS, na ordem. A resposta sempre diz em qual delas parou:
 *   validacao → localizacao → duplicidade → gravacao → persistencia_verificada
 */
function AP_USR_atualizar_(pedido, ctx) {
  ctx = ctx || {};
  var inicio = Date.now();

  /* --- sessão: só se o projeto tiver uma função para isso ------------- */
  if (AP_USR_VALIDAR_SESSAO) {
    var validador = AP_USR_funcaoPorNome_(AP_USR_VALIDAR_SESSAO);
    if (typeof validador !== "function") {
      return AP_USR_resposta_(false, "validacao", "VALIDADOR_AUSENTE",
        "AP_USR_VALIDAR_SESSAO aponta para \"" + AP_USR_VALIDAR_SESSAO +
        "\", que não é uma função deste projeto.", null, inicio);
    }
    var okSessao = false;
    try { okSessao = !!validador(ctx.token); } catch (e2) { okSessao = false; }
    if (!okSessao) {
      return AP_USR_resposta_(false, "validacao", "SESSAO_INVALIDA",
        "Sessão não validada para esta operação.", null, inicio);
    }
  }

  /* --- validação ------------------------------------------------------ */
  var id = AP_USR_txt_(pedido && pedido.id);
  if (!id) {
    return AP_USR_resposta_(false, "validacao", "SEM_ID",
      "A atualização exige o id interno do cadastro. " +
      "Sem id não é possível saber qual linha alterar, e criar outra " +
      "seria duplicar a pessoa.", null, inicio);
  }

  var trava = LockService.getScriptLock();
  try {
    if (!trava.tryLock(AP_USR_TRAVA_MS)) {
      return AP_USR_resposta_(false, "gravacao", "OCUPADO",
        "Outra gravação está em andamento. Tente de novo em instantes.",
        null, inicio);
    }
  } catch (e) {
    return AP_USR_resposta_(false, "gravacao", "TRAVA_INDISPONIVEL",
      "Não consegui obter a trava de escrita.", null, inicio);
  }

  try {
    var aba, cab;
    try {
      aba = AP_USR_aba_();
      cab = AP_USR_cabecalho_(aba);
    } catch (eAba) {
      return AP_USR_resposta_(false, "localizacao", String(eAba.message || eAba).split(":")[0],
        "Não consegui abrir a fonte oficial. Detalhe: " + (eAba.message || eAba),
        null, inicio);
    }

    /* --- localização: pelo id, e só pelo id --------------------------- */
    var linha = AP_USR_linhaDoId_(aba, cab, id);
    if (!linha) {
      return AP_USR_resposta_(false, "localizacao", "NAO_ENCONTRADO",
        "Nenhuma linha da aba " + AP_USR_ABA + " tem o id " + id + ". " +
        "A operação foi recusada: criar um cadastro novo aqui seria duplicar " +
        "a pessoa.", { id: id }, inicio);
    }

    var atual = AP_USR_lerLinha_(aba, cab, linha);

    /* --- duplicidade: a correção -------------------------------------- */
    var conf = AP_USR_conflito_(aba, cab, pedido, linha, atual);
    if (conf) {
      return AP_USR_resposta_(false, "duplicidade", "USUARIO_DUPLICADO",
        "O campo " + conf.campo + " = \"" + conf.valor + "\" já está em uso " +
        "pelo cadastro da linha " + conf.linha +
        (conf.nomeDoOutro ? " (" + conf.nomeDoOutro + ")" : "") + ". " +
        "A linha deste cadastro (" + linha + ") foi ignorada na checagem, " +
        "como deve ser: o conflito é com outro registro.",
        { linha: linha, conflito: conf }, inicio);
    }

    /* --- o que muda --------------------------------------------------- */
    var mudancas = AP_USR_mudancas_(cab, pedido, atual);
    if (!mudancas.length) {
      var r0 = AP_USR_resposta_(true, "persistencia_verificada", "SEM_MUDANCA",
        "Nada a alterar: os valores enviados são iguais aos gravados.",
        { linha: linha, mudou: [], dados: AP_USR_limpo_(atual) }, inicio);
      r0.mudou = [];
      r0.dados = AP_USR_limpo_(atual);
      r0.linha = linha;
      return r0;
    }

    /* --- simulação ---------------------------------------------------- */
    if (AP_USR_SIMULAR) {
      var rs = AP_USR_resposta_(false, "gravacao", "SIMULACAO",
        "SIMULAÇÃO: nada foi gravado. " + mudancas.length +
        " campo(s) seriam alterados na linha " + linha + ". " +
        "Para gravar de verdade, mude AP_USR_SIMULAR para false.",
        { linha: linha, mudou: mudancas }, inicio);
      rs.simulado = true;
      rs.linha = linha;
      rs.mudou = mudancas;
      return rs;
    }

    /* --- gravação: célula por célula, só o que mudou ------------------ */
    for (var m = 0; m < mudancas.length; m++) {
      aba.getRange(linha, mudancas[m].coluna).setValue(mudancas[m].para);
    }
    SpreadsheetApp.flush();

    /* --- releitura independente --------------------------------------- */
    var abaConf = AP_USR_planilha_().getSheetByName(AP_USR_ABA);
    var cabConf = AP_USR_cabecalho_(abaConf);
    var linhaConf = AP_USR_linhaDoId_(abaConf, cabConf, id);
    if (linhaConf !== linha) {
      return AP_USR_resposta_(false, "persistencia_verificada", "LINHA_MUDOU",
        "A linha do id " + id + " era " + linha + " e na releitura é " +
        linhaConf + ". A gravação foi feita, mas não posso confirmar sobre " +
        "qual registro. Confira a aba antes de repetir.",
        { linha: linha, linhaReleitura: linhaConf }, inicio);
    }
    var depois = AP_USR_lerLinha_(abaConf, cabConf, linhaConf);

    var naoPersistiu = [];
    for (var v = 0; v < mudancas.length; v++) {
      if (AP_USR_txt_(depois[mudancas[v].campo]) !== mudancas[v].para) {
        naoPersistiu.push({
          campo: mudancas[v].campo,
          esperado: mudancas[v].para,
          encontrado: AP_USR_txt_(depois[mudancas[v].campo])
        });
      }
    }
    if (naoPersistiu.length) {
      AP_USR_log_({ acao: "atualizar", id: id, linha: linha, resultado: "FALHA_PERSISTENCIA",
                    codigo: "NAO_PERSISTIU", ctx: ctx, detalhe: naoPersistiu });
      return AP_USR_resposta_(false, "persistencia_verificada", "NAO_PERSISTIU",
        "Escrevi, mas a releitura não confirma " + naoPersistiu.length +
        " campo(s). Nada é declarado como concluído sem confirmação.",
        { linha: linha, divergencias: naoPersistiu }, inicio);
    }

    AP_USR_log_({ acao: "atualizar", id: id, linha: linha, resultado: "OK",
                  codigo: "", ctx: ctx,
                  detalhe: mudancas.map(function (x) { return x.campo; }).join(",") });

    var r = AP_USR_resposta_(true, "persistencia_verificada", "",
      mudancas.length + " campo(s) alterados e confirmados na linha " + linha + ".",
      null, inicio);
    r.linha = linha;
    r.mudou = mudancas;
    r.dados = AP_USR_limpo_(depois);
    return r;

  } catch (erro) {
    AP_USR_log_({ acao: "atualizar", id: id, linha: 0, resultado: "EXCECAO",
                  codigo: "EXCECAO", ctx: ctx, detalhe: String(erro && erro.message || erro) });
    return AP_USR_resposta_(false, "gravacao", "EXCECAO",
      "Erro na gravação: " + String(erro && erro.message || erro), null, inicio);
  } finally {
    try { trava.releaseLock(); } catch (e) {}
  }
}


/* ============================================================================
 * 8. AS OPERAÇÕES QUE O SISTEMA PRECISA — todas em cima da de cima
 * ========================================================================= */

/** Exclusão lógica: status = EXCLUIDO. A linha fica, o histórico fica. */
function AP_USR_excluirLogico_(pedido, ctx) {
  ctx = ctx || {};
  var id = AP_USR_txt_(pedido && pedido.id);
  if (!id) {
    return AP_USR_resposta_(false, "validacao", "SEM_ID",
      "A exclusão exige o id interno do cadastro.", null, Date.now());
  }
  ctx.motivo = AP_USR_txt_(pedido && (pedido.motivo || pedido.observacao)) || ctx.motivo || "";
  var r = AP_USR_atualizar_({ id: id, status: AP_USR_STATUS_EXCLUIDO }, ctx);
  if (r.codigo === "SEM_MUDANCA") {
    r.mensagem = "Este cadastro já estava excluído.";
  }
  return r;
}

/** Restauração: volta para ATIVO o mesmo registro, com o mesmo id. */
function AP_USR_restaurar_(pedido, ctx) {
  var id = AP_USR_txt_(pedido && pedido.id);
  if (!id) {
    return AP_USR_resposta_(false, "validacao", "SEM_ID",
      "A restauração exige o id interno do cadastro.", null, Date.now());
  }
  var novo = AP_USR_txt_(pedido && pedido.status) || AP_USR_STATUS_ATIVO;
  return AP_USR_atualizar_({ id: id, status: novo }, ctx);
}

/**
 * Troca de matrícula provisória para a oficial.
 * É a MESMA PESSOA: o id não muda, nenhum cadastro novo nasce.
 */
function AP_USR_trocarMatricula_(pedido, ctx) {
  var id = AP_USR_txt_(pedido && pedido.id);
  var nova = AP_USR_txt_(pedido && (pedido.matricula || pedido.matriculaNova));
  if (!id) {
    return AP_USR_resposta_(false, "validacao", "SEM_ID",
      "A troca de matrícula exige o id interno do cadastro. Procurar pela " +
      "matrícula velha é o que faz o sistema criar um cadastro novo.",
      null, Date.now());
  }
  if (!nova) {
    return AP_USR_resposta_(false, "validacao", "SEM_MATRICULA",
      "Informe a matrícula oficial.", null, Date.now());
  }
  ctx = ctx || {};
  ctx.motivo = ctx.motivo || "troca de matrícula";
  /* a matrícula vai como TEXTO: zeros à esquerda fazem parte dela */
  return AP_USR_atualizar_({ id: id, matricula: nova }, ctx);
}


/* ============================================================================
 * 9. RESPOSTA, LIMPEZA E REGISTRO
 * ========================================================================= */

/**
 * A resposta distingue as três coisas que o sistema hoje confunde:
 *   recebido  → a chamada chegou
 *   gravado   → a escrita foi executada
 *   confirmado→ a releitura independente confere
 * ok = true só na terceira.
 */
function AP_USR_resposta_(ok, etapa, codigo, mensagem, extra, inicio) {
  var r = {
    ok: !!ok,
    etapa: etapa,
    codigo: codigo || "",
    mensagem: mensagem || "",
    recebido: true,
    gravado: !!ok || etapa === "persistencia_verificada",
    confirmado: !!ok && etapa === "persistencia_verificada",
    aba: AP_USR_ABA,
    simulado: !!AP_USR_SIMULAR,
    ms: Date.now() - (inicio || Date.now())
  };
  if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) r[k] = extra[k];
  return r;
}

/** Nada sensível sai daqui: senha, hash, biometria e foto ficam na planilha. */
function AP_USR_limpo_(reg) {
  var fora = { senha_hash: 1, senha: 1, biometria: 1, facial: 1, foto: 1, salt: 1, token: 1 };
  var out = {};
  for (var k in reg) {
    if (!Object.prototype.hasOwnProperty.call(reg, k)) continue;
    if (fora[k]) { out[k] = reg[k] ? "[preenchido]" : ""; continue; }
    out[k] = AP_USR_txt_(reg[k]);
  }
  return out;
}

/**
 * Anota a operação na primeira aba técnica que existir, casando pelo NOME
 * do cabeçalho. Não cria aba, não cria coluna, e nunca derruba a gravação.
 * Não registra senha, hash, token nem biometria.
 */
function AP_USR_log_(reg) {
  try {
    var ss = AP_USR_planilha_();
    var aba = null;
    for (var i = 0; i < AP_USR_ABAS_LOG.length && !aba; i++) {
      aba = ss.getSheetByName(AP_USR_ABAS_LOG[i]);
    }
    if (!aba) return false;
    var cab = AP_USR_cabecalho_(aba);
    var ctx = reg.ctx || {};
    var valores = {
      quando: new Date(), data: new Date(), timestamp: new Date(), criado_em: new Date(),
      modulo: "usuarios",
      acao: reg.acao || "",
      operacao: "usuarios." + (reg.acao || ""),
      id: reg.id || "",
      registro: reg.id || "",
      aba: AP_USR_ABA,
      linha: reg.linha || "",
      resultado: reg.resultado || "",
      status: reg.resultado || "",
      codigo: reg.codigo || "",
      erro: reg.codigo || "",
      mensagem: AP_USR_txt_(reg.detalhe).slice(0, 400),
      detalhe: AP_USR_txt_(reg.detalhe).slice(0, 400),
      observacao: AP_USR_txt_(ctx.motivo).slice(0, 400),
      motivo: AP_USR_txt_(ctx.motivo).slice(0, 400),
      usuario: AP_USR_txt_(ctx.quem),
      quem: AP_USR_txt_(ctx.quem),
      origem: AP_USR_txt_(ctx.origem) || "AP_USUARIOS_GRAVACAO",
      duracao: reg.ms || ""
    };
    var largura = aba.getLastColumn();
    var linha = new Array(largura);
    var usou = false;
    for (var nome in cab) {
      if (!Object.prototype.hasOwnProperty.call(cab, nome)) continue;
      var chave = nome.toLowerCase();
      if (valores[chave] !== undefined) { linha[cab[nome] - 1] = valores[chave]; usou = true; }
    }
    if (!usou) return false;
    aba.appendRow(linha);
    return true;
  } catch (e) {
    return false;   /* log é registro, não é requisito da gravação */
  }
}


/* ============================================================================
 * 10. PORTAS DE ENTRADA
 * ========================================================================= */

/**
 * Porta para o roteador (almoxaApi) e para qualquer módulo existente.
 * Quem chama já validou a sessão.
 *
 * @param {Object} req { acao, payload, sessao, perfil, origem }
 *   acao: "atualizar" | "salvar" | "excluir" | "restaurar" | "trocarMatricula"
 */
function AP_USR_rota(req) {
  req = req || {};
  var payload = req.payload || {};
  var ctx = {
    quem: AP_USR_txt_(req.quem || req.usuario || payload.quem),
    origem: AP_USR_txt_(req.origem) || "rota",
    motivo: AP_USR_txt_(payload.motivo || payload.observacao),
    token: req.sessao || req.token || null
  };
  var acao = AP_USR_txt_(req.acao).toLowerCase();

  if (acao === "excluir" || acao === "excluirlogico") return AP_USR_excluirLogico_(payload, ctx);
  if (acao === "restaurar") return AP_USR_restaurar_(payload, ctx);
  if (acao === "trocarmatricula") return AP_USR_trocarMatricula_(payload, ctx);
  if (acao === "atualizar") return AP_USR_atualizar_(payload, ctx);

  if (acao === "salvar") {
    /* "salvar" com id é SEMPRE atualização. Sem id, este motor não cria:
       a criação continua no módulo que já existe, intocado. */
    if (AP_USR_txt_(payload.id)) {
      if (AP_USR_estaExcluido_(payload.status)) return AP_USR_excluirLogico_(payload, ctx);
      return AP_USR_atualizar_(payload, ctx);
    }
    return AP_USR_resposta_(false, "validacao", "SEM_ID_PARA_CRIAR",
      "Pedido sem id: é uma criação, e a criação não é deste motor. " +
      "Encaminhe para a função de cadastro novo que já existe.",
      null, Date.now());
  }

  return AP_USR_resposta_(false, "validacao", "ACAO_DESCONHECIDA",
    "Ação não reconhecida: \"" + AP_USR_txt_(req.acao) + "\".", null, Date.now());
}

/**
 * Porta direta para o navegador, pelo google.script.run.
 * Mesmo formato que o frontend já usa em AP_ADAPT_salvarUsuarioDireto:
 * recebe JSON.stringify({ payload, token }) e devolve texto JSON.
 *
 * ATENÇÃO: NÃO dei a esta função o nome AP_ADAPT_salvarUsuarioDireto de
 * propósito. Duas funções com o mesmo nome em arquivos diferentes do mesmo
 * projeto do Apps Script se sobrescrevem em silêncio, e eu não vi o arquivo
 * onde a sua está. A ligação é a de "COMO LIGAR", no fim deste arquivo.
 */
function AP_USR_salvarDireto(json) {
  var r;
  try {
    var corpo = typeof json === "string" ? JSON.parse(json || "{}") : (json || {});
    r = AP_USR_rota({
      acao: AP_USR_txt_(corpo.acao) || "salvar",
      payload: corpo.payload || {},
      sessao: corpo.token || null,
      origem: "direto"
    });
  } catch (e) {
    r = AP_USR_resposta_(false, "validacao", "PEDIDO_INVALIDO",
      "Não consegui ler o pedido: " + String(e && e.message || e), null, Date.now());
  }
  return JSON.stringify(r);
}


/* ============================================================================
 * 11. A LIGAÇÃO ESTÁ ATIVA? — rode isto e saiba em 10 segundos
 * ========================================================================= */

/**
 * Pergunta ao roteador do sistema (almoxaApi) usando a ação "atualizar",
 * que SÓ este módulo conhece, com um id que não existe em lugar nenhum.
 *
 * NADA É GRAVADO em nenhum dos dois caminhos:
 *   - se a ligação está ativa, este módulo responde NAO_ENCONTRADO e,
 *     por regra, nunca cria;
 *   - se não está, o roteador antigo não conhece "atualizar" e recusa.
 *
 * O que a resposta tem de diferente: só este módulo devolve o campo
 * "etapa". É por ele que dá para saber quem atendeu.
 */
function AP_USR_conferirLigacao() {
  var L = [];
  function diz(s) { L.push(s); }

  diz("CONFERENCIA DA LIGACAO — " +
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm"));
  diz("Nenhuma linha e gravada por esta conferencia.");
  diz("");

  /* --- o módulo está no projeto? --- */
  var temRota = typeof AP_USR_rota === "function";
  diz(temRota
    ? "[ok]   AP_USR_rota existe neste projeto."
    : "[NAO]  AP_USR_rota NAO existe. O arquivo AP_USUARIOS_GRAVACAO.gs nao " +
      "esta neste projeto do Apps Script, ou nao foi salvo.");
  if (!temRota) { Logger.log(L.join("\n")); return L.join("\n"); }

  diz("[  ]   AP_USR_SIMULAR = " + AP_USR_SIMULAR +
      (AP_USR_SIMULAR ? "   <-- enquanto for true, NADA e gravado de verdade" : ""));

  /* --- o roteador existe? --- */
  var roteador = AP_USR_funcaoPorNome_("almoxaApi");
  if (typeof roteador !== "function") {
    diz("[NAO]  A funcao almoxaApi nao foi encontrada neste projeto.");
    diz("");
    diz("Ela e o roteador do sistema e e nela que vai a LIGACAO 1.");
    diz("Se ela esta em outro projeto do Apps Script, a ligacao tem de ser");
    diz("feita la, e e aquele projeto que precisa ser reimplantado.");
    Logger.log(L.join("\n"));
    return L.join("\n");
  }
  diz("[ok]   almoxaApi existe neste projeto.");
  diz("");

  /* --- a pergunta --- */
  var pedido = {
    modulo: "usuarios",
    acao: "atualizar",
    payload: { id: "AP_USR_PING_" + Date.now() },
    sessao: null,
    origem: "conferencia"
  };
  diz("Pergunta enviada ao almoxaApi:");
  diz("  modulo=usuarios  acao=atualizar  payload.id=" + pedido.payload.id);
  diz("");

  var bruto = null, erro = "";
  try {
    bruto = roteador(JSON.stringify(pedido));
  } catch (e1) {
    try { bruto = roteador(pedido); }
    catch (e2) { erro = String(e2 && e2.message || e2); }
  }
  if (erro) {
    diz("[!!]   O roteador levantou excecao: " + erro);
    diz("       Isso costuma ser a LIGACAO 1 colada num ponto onde as");
    diz("       variaveis modulo/acao/req tem outro nome. Confira os nomes");
    diz("       usados na SUA almoxaApi e ajuste o trecho da ligacao.");
    Logger.log(L.join("\n"));
    return L.join("\n");
  }

  var r = bruto;
  if (typeof r === "string") { try { r = JSON.parse(r); } catch (e3) { r = null; } }
  if (!r || typeof r !== "object") {
    diz("[!!]   Resposta que nao da para ler: " + String(bruto).slice(0, 200));
    Logger.log(L.join("\n"));
    return L.join("\n");
  }

  diz("Resposta recebida:");
  diz("  ok       = " + r.ok);
  diz("  codigo   = " + (r.codigo || "(vazio)"));
  diz("  etapa    = " + (r.etapa || "(nao veio)"));
  diz("  aba      = " + (r.aba || "(nao veio)"));
  diz("  mensagem = " + String(r.mensagem || "").slice(0, 160));
  diz("");

  var meu = !!r.etapa && !!r.aba;
  if (meu && r.codigo === "NAO_ENCONTRADO") {
    diz("================================================");
    diz("A LIGACAO ESTA ATIVA.");
    diz("================================================");
    diz("Quem respondeu foi o AP_USUARIOS_GRAVACAO: ele procurou o id,");
    diz("nao achou (era um id inventado) e recusou sem criar nada — que e");
    diz("exatamente o comportamento correto.");
    diz("");
    if (AP_USR_SIMULAR) {
      diz("FALTA UM PASSO: AP_USR_SIMULAR ainda esta true.");
      diz("Mude para false e reimplante, senao toda gravacao volta");
      diz("recusada com o codigo SIMULACAO.");
    } else {
      diz("AP_USR_SIMULAR ja esta false. Pode testar a exclusao na tela.");
    }
  } else if (meu) {
    diz("================================================");
    diz("A LIGACAO ESTA ATIVA, mas a resposta veio diferente do previsto.");
    diz("================================================");
    diz("Era esperado NAO_ENCONTRADO e veio " + (r.codigo || "(vazio)") + ".");
    diz("Me mande este relatorio inteiro.");
  } else {
    diz("================================================");
    diz("A LIGACAO NAO ESTA ATIVA.");
    diz("================================================");
    diz("Quem respondeu foi o modulo ANTIGO de usuarios: a resposta nao");
    diz("trouxe os campos \"etapa\" e \"aba\", que so este modulo devolve.");
    diz("");
    diz("O QUE FAZER:");
    diz("1. Abra o arquivo do Apps Script onde esta a funcao almoxaApi.");
    diz("2. Ache o trecho que trata modulo === \"usuarios\".");
    diz("3. Cole o bloco da LIGACAO 1 ANTES da validacao de campos");
    diz("   obrigatorios e ANTES do tratamento atual de \"salvar\".");
    diz("   Se ele ficar depois da validacao, o modulo antigo recusa");
    diz("   primeiro e a ligacao nunca e alcancada — e e exatamente isso");
    diz("   que o codigo CAMPOS_OBRIGATORIOS indica.");
    diz("4. Salve e REIMPLANTE (Implantar > Gerenciar implantacoes >");
    diz("   editar > Nova versao). Sem reimplantar, a URL /exec continua");
    diz("   servindo o codigo velho.");
    diz("5. Rode AP_USR_conferirLigacao() de novo.");
  }

  var saida = L.join("\n");
  Logger.log(saida);
  return saida;
}


/* ============================================================================
 * 12. TESTE — não grava nada
 * ========================================================================= */

/**
 * Roda contra a planilha real, em leitura. Prova a lógica com dados
 * montados na memória e confere a estrutura da aba oficial.
 * Nenhuma linha é escrita, nem com AP_USR_SIMULAR = false.
 */
function AP_USR_testar() {
  var L = [], ok = 0, falhou = 0;
  function diz(s) { L.push(s); }
  function prova(nome, cond, detalhe) {
    if (cond) { ok++; diz("  ok    " + nome); }
    else { falhou++; diz("  FALHA " + nome + (detalhe ? "  → " + detalhe : "")); }
  }

  diz("AP_USUARIOS_GRAVACAO — teste de " +
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm"));
  diz("SIMULAR = " + AP_USR_SIMULAR + "   (este teste não grava em nenhum caso)");

  /* ---- 1. a fonte oficial ---- */
  diz("");
  diz("1. A FONTE OFICIAL");
  var aba = null, cab = null;
  try {
    aba = AP_USR_aba_();
    cab = AP_USR_cabecalho_(aba);
    prova("a aba " + AP_USR_ABA + " existe", true);
    prova("tem a coluna " + AP_USR_COL_ID, !!cab[AP_USR_COL_ID],
      "colunas: " + Object.keys(cab).join(", "));
    prova("tem a coluna status", !!cab["status"]);
    prova("tem a coluna matricula", !!cab["matricula"]);
    diz("        linhas preenchidas: " + Math.max(0, aba.getLastRow() - 1));
    diz("        colunas: " + Object.keys(cab).join(", "));
  } catch (e) {
    prova("abrir a aba oficial", false, String(e.message || e));
    diz("");
    diz("Sem a aba oficial o resto não roda. Confira AP_USR_ABA e AP_USR_PLANILHA_ID.");
    Logger.log(L.join("\n"));
    return L.join("\n");
  }

  /* ---- 2. normalização ---- */
  diz("");
  diz("2. NORMALIZACAO DE MATRICULA");
  prova("0408194 e 408194 sao a mesma",
    AP_USR_chaveMat_("0408194") === AP_USR_chaveMat_("408194"));
  prova("8600594108 e 8600593908 sao DIFERENTES",
    AP_USR_chaveMat_("8600594108") !== AP_USR_chaveMat_("8600593908"));
  prova("espaco e ponto nao contam",
    AP_USR_chaveMat_(" 408.194 ") === AP_USR_chaveMat_("408194"));
  prova("vazio da vazio", AP_USR_chaveMat_("   ") === "");
  prova("EXCLUIDO e reconhecido", AP_USR_estaExcluido_("EXCLUIDO"));
  prova("EXCLUIDO com motivo tambem", AP_USR_estaExcluido_("EXCLUIDO - duplicado"));
  prova("ATIVO nao e excluido", AP_USR_estaExcluido_("ATIVO") === false);

  /* ---- 3. a correção, com dados montados ---- */
  diz("");
  diz("3. A CORRECAO — duplicidade ignorando a propria linha");
  var cabF = { id: 1, nome: 2, matricula: 3, email: 4, login: 5, status: 6 };
  var abaF = {
    getLastRow: function () { return 4; },
    getLastColumn: function () { return 6; },
    getRange: function (l, c, nl, nc) {
      var dados = [
        ["U1", "ISMAEL DA SILVA", "0408194", "a@x.com", "ismael", "ATIVO"],
        ["U2", "ISMAEL DA SILVA", "700700",  "b@x.com", "ismael2", "ATIVO"],
        ["U3", "MARIA SOUZA",     "500100",  "c@x.com", "maria",  "EXCLUIDO"]
      ];
      var out = [];
      for (var i = 0; i < nl; i++) {
        var fonte = dados[l - 2 + i] || ["", "", "", "", "", ""];
        out.push(fonte.slice(c - 1, c - 1 + nc));
      }
      return { getValues: function () { return out; } };
    }
  };
  var atualU1 = { id: "U1", nome: "ISMAEL DA SILVA", matricula: "0408194",
                  email: "a@x.com", login: "ismael", status: "ATIVO" };

  var c1 = AP_USR_conflito_(abaF, cabF, { id: "U1", status: "EXCLUIDO" }, 2, atualU1);
  prova("excluir U1 nao da conflito (nao mexe em campo unico)", c1 === null,
    c1 ? JSON.stringify(c1) : "");

  var c2 = AP_USR_conflito_(abaF, cabF, { id: "U1", matricula: "0408194" }, 2, atualU1);
  prova("reenviar a MESMA matricula nao da conflito", c2 === null,
    c2 ? JSON.stringify(c2) : "");

  var cZ = AP_USR_conflito_(abaF, cabF, { id: "U1", matricula: "408194" }, 2, atualU1);
  prova("408194 e 0408194 sao a MESMA: nao e mudanca, nao checa", cZ === null,
    cZ ? JSON.stringify(cZ) : "");

  var c3 = AP_USR_conflito_(abaF, cabF, { id: "U1", matricula: "700700" }, 2, atualU1);
  prova("mudar para a matricula de OUTRO da conflito", c3 !== null);
  prova("e aponta a linha do outro, nao a propria", c3 && c3.linha === 3,
    c3 ? "linha " + c3.linha : "");

  var c4 = AP_USR_conflito_(abaF, cabF, { id: "U1", matricula: "500100" }, 2, atualU1);
  prova("matricula de cadastro EXCLUIDO fica livre", c4 === null,
    c4 ? JSON.stringify(c4) : "");

  var c5 = AP_USR_conflito_(abaF, cabF, { id: "U1", matricula: "999999" }, 2, atualU1);
  prova("matricula inedita passa", c5 === null, c5 ? JSON.stringify(c5) : "");

  var c6 = AP_USR_conflito_(abaF, cabF, { id: "U1", matricula: "" }, 2, atualU1);
  prova("matricula vazia nao e tratada como unica", c6 === null);

  /* ---- 4. o que muda ---- */
  diz("");
  diz("4. MONTAGEM DAS MUDANCAS");
  var m1 = AP_USR_mudancas_(cabF, { id: "U1", status: "EXCLUIDO" }, atualU1);
  prova("so o status muda", m1.length === 1 && m1[0].campo === "status",
    JSON.stringify(m1));
  var m2 = AP_USR_mudancas_(cabF, { id: "U1", nome: "" }, atualU1);
  prova("campo vazio NAO apaga valor preenchido", m2.length === 0, JSON.stringify(m2));
  var m3 = AP_USR_mudancas_(cabF, { id: "U1", nome: "", __limpar: ["nome"] }, atualU1);
  prova("com __limpar, apaga de proposito", m3.length === 1, JSON.stringify(m3));
  var m4 = AP_USR_mudancas_(cabF, { id: "OUTRO", nome: "X" }, atualU1);
  prova("o id nunca entra nas mudancas",
    m4.every(function (x) { return x.campo !== "id"; }), JSON.stringify(m4));
  var m5 = AP_USR_mudancas_(cabF, { id: "U1", senha_hash: "novo" }, atualU1);
  prova("senha_hash nunca e alterada por edicao", m5.length === 0);
  var m6 = AP_USR_mudancas_(cabF, { id: "U1", observacao: "duplicado" }, atualU1);
  prova("campo sem coluna na aba e ignorado, nao da erro", m6.length === 0);
  var m7 = AP_USR_mudancas_(cabF, { id: "U1", nome: "ISMAEL DA SILVA" }, atualU1);
  prova("valor igual nao gera gravacao", m7.length === 0);

  /* ---- 5. recusas ---- */
  diz("");
  diz("5. RECUSAS");
  var r1 = AP_USR_atualizar_({ nome: "sem id" }, {});
  prova("sem id: recusa", r1.ok === false && r1.codigo === "SEM_ID", JSON.stringify(r1.codigo));
  prova("sem id: nao declara gravado", r1.confirmado === false);
  var r2 = AP_USR_atualizar_({ id: "ID_QUE_NAO_EXISTE_" + Date.now() }, {});
  prova("id inexistente: NAO_ENCONTRADO", r2.codigo === "NAO_ENCONTRADO",
    JSON.stringify(r2.codigo) + " " + JSON.stringify(r2.mensagem).slice(0, 90));
  prova("id inexistente: nao cria nada", r2.ok === false);
  var r3 = AP_USR_excluirLogico_({}, {});
  prova("excluir sem id: recusa", r3.codigo === "SEM_ID");
  var r4 = AP_USR_trocarMatricula_({ matricula: "408194" }, {});
  prova("trocar matricula sem id: recusa", r4.codigo === "SEM_ID");
  var r5 = AP_USR_rota({ acao: "salvar", payload: { nome: "novo" } });
  prova("salvar sem id nao e criacao deste motor", r5.codigo === "SEM_ID_PARA_CRIAR");
  var r6 = AP_USR_rota({ acao: "inventada", payload: {} });
  prova("acao desconhecida: recusa", r6.codigo === "ACAO_DESCONHECIDA");

  /* ---- 6. resposta ---- */
  diz("");
  diz("6. A RESPOSTA SEPARA RECEBIDO, GRAVADO E CONFIRMADO");
  prova("recebido/gravado/confirmado existem",
    r1.recebido === true && r1.gravado === false && r1.confirmado === false);
  prova("a etapa vem na resposta", !!r1.etapa);
  prova("a aba oficial vem na resposta", r1.aba === AP_USR_ABA);
  var limpo = AP_USR_limpo_({ nome: "X", senha_hash: "abc", biometria: "bin", foto: "data:" });
  prova("senha_hash nao sai em claro", limpo.senha_hash === "[preenchido]");
  prova("biometria nao sai em claro", limpo.biometria === "[preenchido]");
  prova("foto nao sai em claro", limpo.foto === "[preenchido]");
  prova("o nome sai normal", limpo.nome === "X");
  var txt = AP_USR_salvarDireto(JSON.stringify({ payload: { nome: "sem id" } }));
  prova("a porta direta devolve texto JSON", typeof txt === "string" && /"ok":false/.test(txt));
  prova("a porta direta nao estoura com lixo",
    /PEDIDO_INVALIDO|SEM_ID/.test(AP_USR_salvarDireto("{{{")));

  /* ---- 7. a base real ---- */
  diz("");
  diz("7. A BASE REAL (somente leitura)");
  try {
    var ultima = aba.getLastRow();
    var total = Math.max(0, ultima - 1);
    var bloco = total ? aba.getRange(2, 1, total, aba.getLastColumn()).getValues() : [];
    var semId = 0, ativos = 0, excluidos = 0, porMat = {}, repetidas = 0, vistos = {}, idsRepetidos = 0;
    for (var i = 0; i < bloco.length; i++) {
      var id = AP_USR_txt_(bloco[i][cab[AP_USR_COL_ID] - 1]);
      if (!id) semId++;
      else { if (vistos[id]) idsRepetidos++; vistos[id] = true; }
      var st = cab["status"] ? bloco[i][cab["status"] - 1] : "";
      if (AP_USR_estaExcluido_(st)) excluidos++; else ativos++;
      if (cab["matricula"]) {
        var k = AP_USR_chaveMat_(bloco[i][cab["matricula"] - 1]);
        if (k && !AP_USR_estaExcluido_(st)) {
          porMat[k] = (porMat[k] || 0) + 1;
          if (porMat[k] === 2) repetidas++;
        }
      }
    }
    diz("        total de linhas .......... " + total);
    diz("        ativos ................... " + ativos);
    diz("        excluidos logicamente .... " + excluidos);
    diz("        sem id ................... " + semId);
    diz("        ids repetidos ............ " + idsRepetidos);
    diz("        matriculas repetidas ..... " + repetidas);
    prova("todo cadastro tem id", semId === 0,
      semId ? semId + " linha(s) sem id nao podem ser editadas por este motor" : "");
    prova("nenhum id repetido", idsRepetidos === 0,
      idsRepetidos ? idsRepetidos + " id(s) repetidos" : "");
  } catch (e) {
    prova("ler a base real", false, String(e.message || e));
  }

  /* ---- 8. onde o log vai cair ---- */
  diz("");
  diz("8. REGISTRO DA OPERACAO");
  try {
    var ss = AP_USR_planilha_(), achou = "";
    for (var j = 0; j < AP_USR_ABAS_LOG.length && !achou; j++) {
      if (ss.getSheetByName(AP_USR_ABAS_LOG[j])) achou = AP_USR_ABAS_LOG[j];
    }
    diz("        aba de registro: " + (achou || "NENHUMA das configuradas"));
    prova("existe aba para registrar a operacao", !!achou,
      achou ? "" : "as operacoes gravam, mas sem registro; confira AP_USR_ABAS_LOG");
  } catch (e) {
    prova("procurar a aba de registro", false, String(e.message || e));
  }

  diz("");
  diz("================================================");
  diz("passaram: " + ok + "    falharam: " + falhou);
  diz("================================================");
  if (!falhou) {
    diz("A logica esta correta e nada foi gravado.");
    diz("Proximo passo: ligar no sistema (instrucoes no fim do arquivo),");
    diz("testar pela interface com AP_USR_SIMULAR = true, e so depois");
    diz("mudar AP_USR_SIMULAR para false.");
  }
  var saida = L.join("\n");
  Logger.log(saida);
  return saida;
}


/* ============================================================================
 * COMO LIGAR NO SISTEMA EXISTENTE
 * ----------------------------------------------------------------------------
 * Este arquivo não substitui nada por conta própria. São duas ligações, e
 * cada uma é de poucas linhas. Faça a primeira; a segunda é opcional.
 *
 * ---------------------------------------------------------------------------
 * LIGAÇÃO 1 — o roteador (é a que resolve o github.io)
 * ---------------------------------------------------------------------------
 * No arquivo onde está a função almoxaApi, no trecho que trata
 * modulo === "usuarios", acrescente ANTES do tratamento atual de "salvar":
 *
 *     if (modulo === "usuarios" &&
 *         ["salvar","excluir","restaurar","trocarMatricula","atualizar"]
 *           .indexOf(acao) > -1 &&
 *         req.payload && req.payload.id) {
 *       return AP_USR_rota({
 *         acao: acao, payload: req.payload,
 *         sessao: req.sessao, origem: req.origem
 *       });
 *     }
 *
 * Com id, a operação é atualização e vem para cá. Sem id, segue para a
 * criação que já existe, intocada.
 *
 * ---------------------------------------------------------------------------
 * LIGAÇÃO 2 — a porta direta (vale dentro da URL /exec)
 * ---------------------------------------------------------------------------
 * O frontend chama AP_ADAPT_salvarUsuarioDireto. NÃO dei esse nome a nada
 * aqui de propósito: duas funções de mesmo nome em arquivos diferentes do
 * mesmo projeto se sobrescrevem em silêncio. Para ligar, dentro da SUA
 * AP_ADAPT_salvarUsuarioDireto, logo depois da validação do token, insira:
 *
 *     var _c = JSON.parse(json || "{}");
 *     if (_c.payload && _c.payload.id) return AP_USR_salvarDireto(json);
 *
 * O resto da sua função continua respondendo pela criação.
 *
 * ---------------------------------------------------------------------------
 * ORDEM DE IMPLANTAÇÃO
 * ---------------------------------------------------------------------------
 *   1. colar este arquivo
 *   2. rodar AP_USR_testar() e ler o relatório (não grava nada)
 *   3. fazer a LIGAÇÃO 1
 *   4. publicar a implantação do Apps Script
 *   5. testar pela interface com AP_USR_SIMULAR = true:
 *      a resposta diz o que SERIA gravado, sem gravar
 *   6. mudar AP_USR_SIMULAR para false
 *   7. testar de novo: excluir, reabrir, restaurar, trocar matrícula
 *
 * PARA VOLTAR ATRÁS
 *   Remova a LIGAÇÃO 1 (e a 2, se fez). Este arquivo pode ficar no projeto:
 *   sem as ligações, ele não é chamado por ninguém. Nenhuma linha da
 *   planilha foi apagada em momento nenhum, e o que foi excluído
 *   logicamente volta mudando o status para ATIVO.
 * ========================================================================= */
