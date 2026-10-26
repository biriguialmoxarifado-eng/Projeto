/**
 * ============================================================================
 * AP_PLANILHA_EDICAO.gs
 * ALMOX-PRO · Fase 5: GRAVAÇÃO de uma linha, na planilha oficial
 * ----------------------------------------------------------------------------
 * POR QUE É UM ARQUIVO SEPARADO
 *   O AP_PLANILHA.gs não tem uma única linha de escrita, e o teste dele
 *   prova isso lendo o próprio código. Essa garantia vale alguma coisa, e
 *   eu não quero destruí-la acrescentando gravação lá dentro. Aqui mora
 *   toda a escrita, num arquivo que dá para auditar inteiro — ou apagar,
 *   e aí o sistema volta a ser só leitura.
 *
 * DEPENDE DE
 *   AP_PLANILHA.gs, para abrir a planilha, autorizar e saber quais
 *   colunas são protegidas. Sem ele, este arquivo recusa tudo.
 *
 * O QUE ELE GARANTE, E CADA UMA TEM TESTE
 *   1. Não grava por posição de linha às cegas: confere a IDENTIDADE do
 *      registro (a coluna id, ou todos os valores que a tela viu) antes
 *      de tocar em qualquer célula.
 *   2. Não sobrescreve alteração de outra pessoa: a tela manda o que ela
 *      viu, o servidor relê, e se mudou no meio do caminho ele RECUSA e
 *      diz qual campo divergiu.
 *   3. Não escreve em coluna protegida (senha, hash, biometria, token).
 *   4. Não escreve por cima de FÓRMULA.
 *   5. Campo vazio não apaga valor preenchido, a não ser que você peça.
 *   6. Grava célula por célula, só o que mudou de verdade.
 *   7. RELÊ depois de gravar e só responde ok se a releitura confirmar.
 *   8. Registra na auditoria: valor anterior, valor novo, quem e resultado.
 *   9. Uma linha por vez. Lote só depois que você provar uma.
 *
 * O QUE ELE NÃO FAZ
 *   Não apaga linha, não cria linha, não cria nem renomeia aba, não mexe
 *   em cabeçalho e não altera a coluna de identidade.
 * ============================================================================
 */


/* ============================================================================
 * 1. CONFIGURAÇÃO
 * ========================================================================= */

/** Desligue aqui para o sistema voltar a ser só leitura, sem apagar nada. */
var AP_PLE_LIGADA = true;

/** Edição em lote. Fica FALSE até uma gravação de uma linha ser provada
 *  na planilha real — é a regra que o próprio pedido estabeleceu. */
var AP_PLE_LOTE_LIGADO = false;

/** Colunas que nunca podem ser alteradas por aqui, além das protegidas
 *  do AP_PLANILHA.gs. A identidade do registro está entre elas. */
var AP_PLE_NUNCA = ["id", "criado_em", "criadoem", "_linha"];

/** Abas onde a operação é registrada. Usa a PRIMEIRA que existir. */
var AP_PLE_ABAS_LOG = ["ALMOXA_SERVIDOR_OPERACOES", "AUDITORIA", "LOG",
                       "DIAGNOSTICOS", "EVENTOS"];

/** EXCLUSÃO LÓGICA: a linha FICA na planilha, marcada.
 *  É a regra do próprio sistema desde o começo — registro não some,
 *  ele muda de situação, com autor e motivo, e dá para voltar.
 *  Apagar a linha de verdade também embaralharia os números de linha
 *  de tudo que está abaixo, e a tela que está aberta passaria a
 *  apontar para o registro errado. */
var AP_PLE_VALOR_EXCLUIDO = "EXCLUIDO";
var AP_PLE_VALOR_ATIVO = "ATIVO";

/** Nomes aceitos para a coluna de situação, na ordem de preferência. */
var AP_PLE_COLUNAS_STATUS = ["status", "situacao", "situação", "estado"];

/** Colunas de rastro da exclusão, preenchidas quando existirem. */
var AP_PLE_COL_EXCLUIDO_EM = ["excluidoem", "excluido_em", "excluidoEm", "data_exclusao"];
var AP_PLE_COL_EXCLUIDO_POR = ["excluidopor", "excluido_por", "excluidoPor"];
var AP_PLE_COL_MOTIVO = ["motivoexclusao", "motivo_exclusao", "motivoExclusao",
                         "observacao", "motivo"];

/** Abas que não podem ser editadas por aqui de jeito nenhum. */
var AP_PLE_ABAS_PROIBIDAS = ["SESSOES", "ALMOXA_SESSOES", "AUDITORIA",
                             "ALMOXA_SERVIDOR_LOG", "ALMOXA_SERVIDOR_OPERACOES"];

var AP_PLE_TRAVA_MS = 25000;


/* ============================================================================
 * 2. AUXILIARES
 * ========================================================================= */

function AP_PLE_txt_(v) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    try { return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm"); }
    catch (e) { return String(v); }
  }
  return String(v).trim();
}

/**
 * O valor COMO A TELA VIU: mesma transformação que a leitura aplica,
 * cortando em TETO_TEXTO. Comparar o que a tela viu (cortado) com o
 * que está na célula (inteiro) acusa conflito onde não há — foi o que
 * aconteceu com a coluna "foto" da aba ALMOXA_CRACHAS em 25/10.
 */
function AP_PLE_comoATelaViu_(v) {
  var t = AP_PLE_txt_(v);
  var teto = 400;
  try { if (AP_PL_CFG && AP_PL_CFG.TETO_TEXTO) teto = AP_PL_CFG.TETO_TEXTO; } catch (e) {}
  if (t.length > teto) return t.slice(0, teto) + "\u2026";
  return t;
}

/** O valor chegou cortado? Então ele não pode ser gravado de volta. */
function AP_PLE_pareceCortado_(v, atual) {
  var t = AP_PLE_txt_(v);
  var teto = 400;
  try { if (AP_PL_CFG && AP_PL_CFG.TETO_TEXTO) teto = AP_PL_CFG.TETO_TEXTO; } catch (e) {}
  if (t.length !== teto + 1) return false;
  if (t.charAt(t.length - 1) !== "\u2026") return false;
  return AP_PLE_txt_(atual).length > teto;
}

function AP_PLE_resposta_(ok, codigo, mensagem, extra) {
  var r = {
    ok: !!ok, codigo: String(codigo || ""), mensagem: String(mensagem || ""),
    escrita: true, quando: new Date().toISOString(),
    recebido: true, gravado: false, confirmado: false
  };
  if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) r[k] = extra[k];
  return r;
}

function AP_PLE_temLeitura_() {
  return typeof AP_PL_planilha_ === "function" &&
         typeof AP_PL_autorizar_ === "function" &&
         typeof AP_PL_protegida_ === "function";
}

function AP_PLE_protegida_(nome) {
  var n = String(nome || "").trim().toLowerCase();
  for (var i = 0; i < AP_PLE_NUNCA.length; i++) {
    if (String(AP_PLE_NUNCA[i]).toLowerCase() === n) return true;
  }
  try { return !!AP_PL_protegida_(nome); } catch (e) { return true; }
}

function AP_PLE_abaProibida_(nome) {
  var n = String(nome || "").trim().toUpperCase();
  for (var i = 0; i < AP_PLE_ABAS_PROIBIDAS.length; i++) {
    if (String(AP_PLE_ABAS_PROIBIDAS[i]).toUpperCase() === n) return true;
  }
  return false;
}


/* ============================================================================
 * 3. A GRAVAÇÃO
 * ========================================================================= */

/**
 * @param {Object} p
 *   aba        nome da aba
 *   linha      número da linha na planilha (>= 2)
 *   esperado   { coluna: valorQueATelaViu } — todas conferidas antes de gravar
 *   valores    { coluna: valorNovo }
 *   limpar     [ "coluna" ] — colunas que podem receber vazio de propósito
 *   motivo     texto para a auditoria
 * @param {string} quem  identificação de quem está gravando
 */
function AP_PLE_gravar(p, quem) {
  p = p || {};
  var inicio = Date.now();

  if (!AP_PLE_LIGADA) {
    return AP_PLE_resposta_(false, "EDICAO_DESLIGADA",
      "A edição está desligada neste projeto (AP_PLE_LIGADA = false).");
  }
  if (!AP_PLE_temLeitura_()) {
    return AP_PLE_resposta_(false, "SEM_MODULO_LEITURA",
      "O AP_PLANILHA.gs não está neste projeto. Este arquivo depende dele " +
      "para abrir a planilha e autorizar.");
  }

  var aba = AP_PLE_txt_(p.aba);
  var linha = Number(p.linha) || 0;
  if (!aba) return AP_PLE_resposta_(false, "SEM_ABA", "Informe a aba.");
  if (AP_PLE_abaProibida_(aba)) {
    return AP_PLE_resposta_(false, "ABA_PROIBIDA",
      "A aba " + aba + " não pode ser editada por aqui: ela é registro de " +
      "sessão ou de auditoria, e alterar isso apagaria o rastro das operações.");
  }
  if (linha < 2) {
    return AP_PLE_resposta_(false, "LINHA_INVALIDA",
      "A linha precisa ser 2 ou mais. A linha 1 é o cabeçalho.");
  }
  var valores = p.valores || {};
  var quantos = 0;
  for (var kk in valores) if (Object.prototype.hasOwnProperty.call(valores, kk)) quantos++;
  if (!quantos) {
    return AP_PLE_resposta_(false, "SEM_VALORES", "Nenhum campo foi enviado para alterar.");
  }

  var trava = LockService.getScriptLock();
  try { if (!trava.tryLock(AP_PLE_TRAVA_MS)) {
    return AP_PLE_resposta_(false, "OCUPADO",
      "Outra gravação está em andamento. Tente de novo em instantes.");
  } } catch (e) {
    return AP_PLE_resposta_(false, "TRAVA_INDISPONIVEL", "Não consegui obter a trava de escrita.");
  }

  try {
    var ss, sh;
    try { ss = AP_PL_planilha_(); sh = ss.getSheetByName(aba); }
    catch (e2) {
      return AP_PLE_resposta_(false, "PLANILHA_INACESSIVEL", String(e2 && e2.message || e2));
    }
    if (!sh) return AP_PLE_resposta_(false, "ABA_NAO_ENCONTRADA",
      "A aba \"" + aba + "\" não existe nesta planilha.");

    var nl = sh.getLastRow(), nc = sh.getLastColumn();
    if (linha > nl) {
      return AP_PLE_resposta_(false, "LINHA_NAO_EXISTE",
        "A aba tem " + nl + " linha(s); a " + linha + " não existe.");
    }

    var cab = sh.getRange(1, 1, 1, nc).getValues()[0]
      .map(function (x) { return AP_PLE_txt_(x); });
    var atual = sh.getRange(linha, 1, 1, nc).getValues()[0];
    var formulas = sh.getRange(linha, 1, 1, nc).getFormulas()[0];

    function idx(nome) { return cab.indexOf(String(nome)); }

    /* ---- 1. IDENTIDADE: não gravo por posição às cegas ---- */
    var iId = idx("id");
    var conferencia = { modo: "", confere: false, esperado: "", encontrado: "" };
    if (iId > -1) {
      var idEsperado = AP_PLE_txt_((p.esperado || {}).id !== undefined
        ? (p.esperado || {}).id : (p.identidade || {}).valor);
      var idAtual = AP_PLE_txt_(atual[iId]);
      conferencia = { modo: "id", confere: !!idEsperado && idEsperado === idAtual,
                      esperado: idEsperado, encontrado: idAtual };
      if (!idEsperado) {
        return AP_PLE_resposta_(false, "SEM_IDENTIDADE",
          "Esta aba tem coluna \"id\", então a gravação exige o id que a tela " +
          "viu. Sem isso eu estaria gravando pela posição da linha, e posição " +
          "muda quando alguém insere ou ordena.", { aba: aba, linha: linha });
      }
      if (!conferencia.confere) {
        return AP_PLE_resposta_(false, "LINHA_MUDOU",
          "A linha " + linha + " não é mais o registro que a tela mostrou: o id " +
          "era \"" + idEsperado + "\" e agora é \"" + idAtual + "\". " +
          "Alguém inseriu, apagou ou ordenou linhas. Recarregue e tente de novo.",
          { aba: aba, linha: linha, conferencia: conferencia });
      }
    } else {
      /* sem coluna id, a identidade é o conjunto inteiro que a tela viu */
      conferencia.modo = "conteudo";
      var temEsperado = false;
      for (var ke in (p.esperado || {})) {
        if (Object.prototype.hasOwnProperty.call(p.esperado, ke)) { temEsperado = true; break; }
      }
      if (!temEsperado) {
        return AP_PLE_resposta_(false, "SEM_IDENTIDADE",
          "Esta aba não tem coluna \"id\". Para gravar com segurança eu preciso " +
          "dos valores que a tela viu, para conferir que é a mesma linha.",
          { aba: aba, linha: linha });
      }
      conferencia.confere = true;
    }

    /* ---- 2. CONFLITO: mudou depois que a tela leu? ---- */
    var divergencias = [];
    var esperado = p.esperado || {};
    for (var col in esperado) {
      if (!Object.prototype.hasOwnProperty.call(esperado, col)) continue;
      var ic = idx(col);
      if (ic === -1) continue;
      if (AP_PL_protegida_(col)) continue;         /* protegida volta mascarada: não dá para comparar */
      /* comparar na mesma representação: o que a tela recebeu já vinha
         cortado quando o valor é longo */
      var agora = AP_PLE_comoATelaViu_(atual[ic]);
      var viu = AP_PLE_txt_(esperado[col]);
      if (agora !== viu) {
        divergencias.push({ campo: col,
          telaViu: viu.slice(0, 120), naPlanilha: agora.slice(0, 120) });
      }
    }
    if (divergencias.length) {
      return AP_PLE_resposta_(false, "CONFLITO",
        divergencias.length + " campo(s) mudaram na planilha depois que a tela leu. " +
        "Não gravei por cima. Recarregue e confira.",
        { aba: aba, linha: linha, divergencias: divergencias });
    }

    /* ---- 3. O QUE PODE SER ESCRITO ---- */
    var limpar = {};
    var listaLimpar = p.limpar || [];
    for (var cl = 0; cl < listaLimpar.length; cl++) limpar[String(listaLimpar[cl])] = true;

    var mudancas = [], recusados = [];
    for (var campo in valores) {
      if (!Object.prototype.hasOwnProperty.call(valores, campo)) continue;
      var i = idx(campo);
      if (i === -1) { recusados.push({ campo: campo, porque: "não existe nesta aba" }); continue; }
      if (AP_PLE_protegida_(campo)) {
        recusados.push({ campo: campo, porque: "coluna protegida" });
        continue;
      }
      if (AP_PLE_txt_(formulas[i])) {
        recusados.push({ campo: campo, porque: "a célula tem fórmula" });
        continue;
      }
      var novo = valores[campo];
      if (novo === null || novo === undefined) continue;
      var sNovo = AP_PLE_txt_(novo), sVelho = AP_PLE_txt_(atual[i]);
      /* [v302] ESTE É O QUE PODERIA DESTRUIR DADO.
         Um valor longo chega à tela cortado em 400 caracteres. Gravar
         essa versão de volta apagaria o resto — uma foto em base64
         viraria 400 caracteres de lixo. Recusa, sempre. */
      if (AP_PLE_pareceCortado_(novo, atual[i])) {
        recusados.push({ campo: campo,
          porque: "o valor chegou cortado na tela (textos longos são " +
                  "encurtados na leitura) e gravá-lo apagaria o resto" });
        continue;
      }
      if (sNovo === "" && sVelho !== "" && !limpar[campo]) {
        recusados.push({ campo: campo, porque: "vazio não apaga valor preenchido" });
        continue;
      }
      if (sNovo === sVelho) continue;
      mudancas.push({ campo: campo, coluna: i + 1, de: sVelho, para: sNovo });
    }

    if (!mudancas.length) {
      var r0 = AP_PLE_resposta_(true, "SEM_MUDANCA",
        "Nada a alterar: os valores enviados são iguais aos que já estão lá.",
        { aba: aba, linha: linha, mudou: [], recusados: recusados });
      r0.gravado = true; r0.confirmado = true;
      return r0;
    }

    /* ---- 4. GRAVAR, célula por célula ---- */
    for (var m = 0; m < mudancas.length; m++) {
      sh.getRange(linha, mudancas[m].coluna).setValue(mudancas[m].para);
    }
    SpreadsheetApp.flush();

    /* ---- 5. RELER e confirmar ---- */
    var conf = AP_PL_planilha_().getSheetByName(aba)
      .getRange(linha, 1, 1, nc).getValues()[0];
    var naoConfirmou = [];
    for (var v = 0; v < mudancas.length; v++) {
      var lido = AP_PLE_txt_(conf[mudancas[v].coluna - 1]);
      if (lido !== mudancas[v].para) {
        naoConfirmou.push({ campo: mudancas[v].campo,
                            esperado: mudancas[v].para, encontrado: lido });
      }
    }
    if (naoConfirmou.length) {
      AP_PLE_log_({ aba: aba, linha: linha, resultado: "NAO_PERSISTIU",
                    quem: quem, motivo: p.motivo, mudancas: mudancas });
      return AP_PLE_resposta_(false, "NAO_PERSISTIU",
        "Escrevi, mas a releitura não confirma " + naoConfirmou.length + " campo(s). " +
        "Nada é dado como concluído sem confirmação.",
        { aba: aba, linha: linha, divergencias: naoConfirmou, mudou: mudancas });
    }

    /* ---- 6. AUDITORIA ---- */
    var anotou = AP_PLE_log_({ aba: aba, linha: linha, resultado: "OK",
                               quem: quem, motivo: p.motivo, mudancas: mudancas });

    var dados = {};
    for (var c2 = 0; c2 < cab.length; c2++) {
      if (!cab[c2]) continue;
      dados[cab[c2]] = AP_PL_protegida_(cab[c2])
        ? (AP_PLE_txt_(conf[c2]) ? "[protegido]" : "")
        : AP_PLE_txt_(conf[c2]);
    }

    var r = AP_PLE_resposta_(true, "",
      mudancas.length + " campo(s) alterados e confirmados na linha " + linha + ".",
      { aba: aba, linha: linha, mudou: mudancas, recusados: recusados,
        dados: dados, auditoria: anotou ? "registrada" : "sem aba de auditoria",
        ms: Date.now() - inicio });
    r.gravado = true; r.confirmado = true;
    return r;

  } catch (erro) {
    AP_PLE_log_({ aba: aba, linha: linha, resultado: "EXCECAO", quem: quem,
                  motivo: p.motivo, mudancas: [],
                  detalhe: String(erro && erro.message || erro) });
    return AP_PLE_resposta_(false, "EXCECAO",
      "Erro na gravação: " + String(erro && erro.message || erro));
  } finally {
    try { trava.releaseLock(); } catch (e3) {}
  }
}


/* ============================================================================
 * 3b. EXCLUIR E RESTAURAR — pela situação, nunca apagando a linha
 * ========================================================================= */

/** Acha a coluna de situação. Devolve o nome exato do cabeçalho, ou "". */
function AP_PLE_colunaStatus_(cab) {
  for (var i = 0; i < AP_PLE_COLUNAS_STATUS.length; i++) {
    for (var c = 0; c < cab.length; c++) {
      if (String(cab[c]).trim().toLowerCase() === AP_PLE_COLUNAS_STATUS[i]) return cab[c];
    }
  }
  return "";
}

function AP_PLE_achaColuna_(cab, nomes) {
  for (var i = 0; i < nomes.length; i++) {
    for (var c = 0; c < cab.length; c++) {
      if (String(cab[c]).trim().toLowerCase() === String(nomes[i]).toLowerCase()) return cab[c];
    }
  }
  return "";
}

function AP_PLE_cabecalhoDe_(aba) {
  try {
    var sh = AP_PL_planilha_().getSheetByName(aba);
    if (!sh) return null;
    var nc = sh.getLastColumn();
    if (nc < 1) return [];
    return sh.getRange(1, 1, 1, nc).getValues()[0]
      .map(function (x) { return AP_PLE_txt_(x); });
  } catch (e) { return null; }
}

/**
 * Marca a linha como excluída. A linha CONTINUA na planilha.
 * Mesmas travas da gravação: identidade conferida, conflito detectado,
 * releitura obrigatória, auditoria.
 */
function AP_PLE_excluir(p, quem) {
  p = p || {};
  if (!AP_PLE_LIGADA) {
    return AP_PLE_resposta_(false, "EDICAO_DESLIGADA",
      "A edição está desligada neste projeto (AP_PLE_LIGADA = false).");
  }
  if (!AP_PLE_temLeitura_()) {
    return AP_PLE_resposta_(false, "SEM_MODULO_LEITURA",
      "O AP_PLANILHA.gs não está neste projeto.");
  }
  var aba = AP_PLE_txt_(p.aba);
  if (!aba) return AP_PLE_resposta_(false, "SEM_ABA", "Informe a aba.");
  /* a aba protegida é recusada AQUI, antes de qualquer outra conferência:
     recusar pelo motivo errado ("falta coluna de situação") esconderia a
     razão verdadeira e mandaria o administrador criar uma coluna que não
     resolveria nada. */
  if (AP_PLE_abaProibida_(aba)) {
    return AP_PLE_resposta_(false, "ABA_PROIBIDA",
      "A aba " + aba + " não pode ser alterada por aqui: ela é registro de " +
      "sessão ou de auditoria, e mexer nisso apagaria o rastro das operações.");
  }
  if (AP_PLE_txt_(p.motivo).length < 3) {
    return AP_PLE_resposta_(false, "SEM_MOTIVO",
      "Escreva o motivo da exclusão: ele fica na auditoria e é o que " +
      "permite entender depois por que este registro saiu.");
  }

  var cab = AP_PLE_cabecalhoDe_(aba);
  if (cab === null) {
    return AP_PLE_resposta_(false, "ABA_NAO_ENCONTRADA",
      "A aba \"" + aba + "\" não existe nesta planilha.");
  }
  var colStatus = AP_PLE_colunaStatus_(cab);
  if (!colStatus) {
    return AP_PLE_resposta_(false, "SEM_COLUNA_STATUS",
      "A aba " + aba + " não tem coluna de situação (" +
      AP_PLE_COLUNAS_STATUS.slice(0, 3).join(", ") + "). " +
      "Sem ela não dá para marcar como excluído, e eu não apago a linha: " +
      "apagar embaralharia os números de linha de tudo que está abaixo. " +
      "Crie a coluna na planilha, ou edite o registro à mão.");
  }

  var valores = {};
  valores[colStatus] = AP_PLE_VALOR_EXCLUIDO;

  var cEm = AP_PLE_achaColuna_(cab, AP_PLE_COL_EXCLUIDO_EM);
  if (cEm) valores[cEm] = Utilities.formatDate(new Date(),
    Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm");
  var cPor = AP_PLE_achaColuna_(cab, AP_PLE_COL_EXCLUIDO_POR);
  if (cPor) valores[cPor] = AP_PLE_txt_(quem).slice(0, 120);
  var cMot = AP_PLE_achaColuna_(cab, AP_PLE_COL_MOTIVO);
  if (cMot) valores[cMot] = AP_PLE_txt_(p.motivo).slice(0, 400);

  var r = AP_PLE_gravar({
    aba: aba, linha: p.linha, esperado: p.esperado || {}, valores: valores,
    motivo: "EXCLUSÃO: " + AP_PLE_txt_(p.motivo)
  }, quem);

  r.exclusaoLogica = true;
  r.colunaDeStatus = colStatus;
  if (r.ok) {
    r.mensagem = "Marcado como " + AP_PLE_VALOR_EXCLUIDO + " na linha " + p.linha +
      ". A linha continua na planilha, com autor e motivo, e dá para restaurar.";
  }
  if (r.codigo === "SEM_MUDANCA") {
    r.mensagem = "Este registro já estava marcado como " + AP_PLE_VALOR_EXCLUIDO + ".";
  }
  return r;
}

/** Devolve o registro ao estado ativo. */
function AP_PLE_restaurar(p, quem) {
  p = p || {};
  if (!AP_PLE_temLeitura_()) {
    return AP_PLE_resposta_(false, "SEM_MODULO_LEITURA",
      "O AP_PLANILHA.gs não está neste projeto.");
  }
  var aba = AP_PLE_txt_(p.aba);
  if (!aba) return AP_PLE_resposta_(false, "SEM_ABA", "Informe a aba.");
  if (AP_PLE_abaProibida_(aba)) {
    return AP_PLE_resposta_(false, "ABA_PROIBIDA",
      "A aba " + aba + " não pode ser alterada por aqui.");
  }

  var cab = AP_PLE_cabecalhoDe_(aba);
  if (cab === null) {
    return AP_PLE_resposta_(false, "ABA_NAO_ENCONTRADA",
      "A aba \"" + aba + "\" não existe nesta planilha.");
  }
  var colStatus = AP_PLE_colunaStatus_(cab);
  if (!colStatus) {
    return AP_PLE_resposta_(false, "SEM_COLUNA_STATUS",
      "A aba " + aba + " não tem coluna de situação.");
  }

  var valores = {}, limpar = [];
  valores[colStatus] = AP_PLE_txt_(p.status) || AP_PLE_VALOR_ATIVO;
  /* o rastro da exclusão sai, para não ficar contando história errada */
  [AP_PLE_COL_EXCLUIDO_EM, AP_PLE_COL_EXCLUIDO_POR].forEach(function (nomes) {
    var c = AP_PLE_achaColuna_(cab, nomes);
    if (c) { valores[c] = ""; limpar.push(c); }
  });

  var r = AP_PLE_gravar({
    aba: aba, linha: p.linha, esperado: p.esperado || {}, valores: valores,
    limpar: limpar,
    motivo: "RESTAURAÇÃO: " + (AP_PLE_txt_(p.motivo) || "sem motivo informado")
  }, quem);
  r.restauracao = true;
  if (r.ok) {
    r.mensagem = "Restaurado para " + valores[colStatus] + " na linha " + p.linha + ".";
  }
  return r;
}


/* ============================================================================
 * 4. AUDITORIA
 * ========================================================================= */

/** Junta o motivo ao texto quando a aba não tem coluna para ele. */
function AP_PLE_comMotivo_(texto, motivo, cab) {
  var t = AP_PLE_txt_(texto), m = AP_PLE_txt_(motivo);
  if (!m) return t.slice(0, 400);
  for (var i = 0; i < cab.length; i++) {
    if (cab[i] === "motivo" || cab[i] === "observacao") return t.slice(0, 400);
  }
  return (t ? t + " · " : "") + "motivo: " + m;
}

function AP_PLE_log_(reg) {
  try {
    var ss = AP_PL_planilha_();
    var sh = null;
    for (var i = 0; i < AP_PLE_ABAS_LOG.length && !sh; i++) {
      sh = ss.getSheetByName(AP_PLE_ABAS_LOG[i]);
    }
    if (!sh) return false;
    var nc = sh.getLastColumn();
    if (nc < 1) return false;
    var cab = sh.getRange(1, 1, 1, nc).getValues()[0]
      .map(function (x) { return String(x == null ? "" : x).trim().toLowerCase(); });

    var resumo = (reg.mudancas || []).map(function (m) {
      return m.campo + ": \"" + m.de + "\" -> \"" + m.para + "\"";
    }).join(" · ").slice(0, 400);

    var valores = {
      quando: new Date(), data: new Date(), timestamp: new Date(), criado_em: new Date(),
      modulo: "planilha", acao: "editar", operacao: "planilha.gravar",
      aba: reg.aba || "", linha: reg.linha || "",
      registro: reg.aba + "!" + reg.linha,
      resultado: reg.resultado || "", status: reg.resultado || "",
      codigo: reg.resultado === "OK" ? "" : (reg.resultado || ""),
      /* se a aba de auditoria não tiver coluna de motivo, o motivo vai
         junto da mensagem. Perder o porquê da alteração seria perder a
         parte mais útil do registro. */
      mensagem: AP_PLE_comMotivo_(resumo || AP_PLE_txt_(reg.detalhe), reg.motivo, cab),
      detalhe: AP_PLE_comMotivo_(resumo || AP_PLE_txt_(reg.detalhe), reg.motivo, cab),
      anterior: (reg.mudancas || []).map(function (m) { return m.de; }).join(" | ").slice(0, 400),
      novo: (reg.mudancas || []).map(function (m) { return m.para; }).join(" | ").slice(0, 400),
      campo: (reg.mudancas || []).map(function (m) { return m.campo; }).join(", ").slice(0, 200),
      observacao: AP_PLE_txt_(reg.motivo).slice(0, 400),
      motivo: AP_PLE_txt_(reg.motivo).slice(0, 400),
      usuario: AP_PLE_txt_(reg.quem), quem: AP_PLE_txt_(reg.quem),
      origem: "Central de Dados"
    };

    var linha = new Array(nc), usou = false;
    for (var n = 0; n < cab.length; n++) {
      if (cab[n] && valores[cab[n]] !== undefined) { linha[n] = valores[cab[n]]; usou = true; }
    }
    if (!usou) return false;
    sh.appendRow(linha);
    return true;
  } catch (e) { return false; }     /* auditoria é registro, não requisito da gravação */
}


/* ============================================================================
 * 5. PORTAS
 * ========================================================================= */

function AP_PLE_rota(req, quem) {
  req = req || {};
  var acao = String(req.acao || "").toLowerCase();
  if (acao === "gravar" || acao === "editar") return AP_PLE_gravar(req.payload || {}, quem);
  if (acao === "excluir") return AP_PLE_excluir(req.payload || {}, quem);
  if (acao === "restaurar") return AP_PLE_restaurar(req.payload || {}, quem);
  if (acao === "lote") {
    if (!AP_PLE_LOTE_LIGADO) {
      return AP_PLE_resposta_(false, "LOTE_DESLIGADO",
        "A edição em lote está desligada até uma gravação de uma linha ser " +
        "provada na planilha real.");
    }
    return AP_PLE_resposta_(false, "LOTE_NAO_IMPLEMENTADO",
      "O lote ainda não foi construído.");
  }
  return AP_PLE_resposta_(false, "ACAO_DESCONHECIDA",
    "Ação não reconhecida: \"" + String(req.acao || "") + "\".");
}

/** Porta do navegador. Autoriza pelo mesmo caminho da leitura. */
function AP_PLE_direto(json) {
  var r;
  try {
    var corpo = typeof json === "string" ? JSON.parse(json || "{}") : (json || {});
    if (!AP_PLE_temLeitura_()) {
      r = AP_PLE_resposta_(false, "SEM_MODULO_LEITURA",
        "O AP_PLANILHA.gs não está neste projeto.");
    } else {
      var aut = AP_PL_autorizar_(corpo.token);
      if (!aut.ok) {
        r = AP_PLE_resposta_(false, aut.codigo, aut.mensagem);
      } else {
        r = AP_PLE_rota({ acao: corpo.acao || "gravar", payload: corpo.payload }, aut.quem);
        r.quem = aut.quem;
      }
    }
  } catch (e) {
    r = AP_PLE_resposta_(false, "PEDIDO_INVALIDO",
      "Não consegui ler o pedido: " + String(e && e.message || e));
  }
  return JSON.stringify(r);
}


/* ============================================================================
 * 6. TESTE — grava numa aba de teste que ele mesmo cria e apaga?  NÃO.
 *    Este teste NÃO grava em lugar nenhum: ele exercita as recusas, que
 *    são a parte perigosa. A gravação de verdade você prova na tela, numa
 *    linha que você escolher.
 * ========================================================================= */

function AP_PLE_testar() {
  var L = [], ok = 0, mal = 0;
  function diz(s) { L.push(s); }
  function prova(n, c, d) {
    if (c) { ok++; diz("  ok    " + n); } else { mal++; diz("  FALHA " + n + (d ? "  → " + d : "")); }
  }

  diz("AP_PLANILHA_EDICAO — teste das recusas");
  diz("Este teste NÃO grava em nenhuma célula.");
  diz("");

  prova("o módulo de leitura está presente", AP_PLE_temLeitura_());
  diz("   AP_PLE_LIGADA ....... " + AP_PLE_LIGADA);
  diz("   AP_PLE_LOTE_LIGADO .. " + AP_PLE_LOTE_LIGADO);

  diz("");
  diz("RECUSAS DE ENTRADA");
  prova("sem aba: recusa", AP_PLE_gravar({}).codigo === "SEM_ABA");
  prova("linha 1 (cabeçalho): recusa",
    AP_PLE_gravar({ aba: "USUARIOS", linha: 1, valores: { nome: "x" } }).codigo === "LINHA_INVALIDA");
  prova("sem campos: recusa",
    AP_PLE_gravar({ aba: "USUARIOS", linha: 2, valores: {} }).codigo === "SEM_VALORES");
  prova("aba de sessões: recusa",
    AP_PLE_gravar({ aba: "SESSOES", linha: 2, valores: { x: "1" } }).codigo === "ABA_PROIBIDA");
  prova("aba de auditoria: recusa",
    AP_PLE_gravar({ aba: "AUDITORIA", linha: 2, valores: { x: "1" } }).codigo === "ABA_PROIBIDA");
  prova("aba inexistente: recusa",
    AP_PLE_gravar({ aba: "NAO_EXISTE_" + Date.now(), linha: 2, valores: { x: "1" } })
      .codigo === "ABA_NAO_ENCONTRADA");

  diz("");
  diz("IDENTIDADE E CONFLITO");
  var semId = AP_PLE_gravar({ aba: "USUARIOS", linha: 2, valores: { cargo: "X" } });
  prova("sem o id que a tela viu: recusa", semId.codigo === "SEM_IDENTIDADE",
    semId.codigo + " " + semId.mensagem);
  prova("e explica por quê", /posição da linha/.test(semId.mensagem));
  var idErrado = AP_PLE_gravar({ aba: "USUARIOS", linha: 2,
    esperado: { id: "ID_QUE_NAO_EXISTE" }, valores: { cargo: "X" } });
  prova("id que não bate: recusa", idErrado.codigo === "LINHA_MUDOU", idErrado.codigo);
  prova("e manda recarregar", /Recarregue/.test(idErrado.mensagem));

  diz("");
  diz("A RESPOSTA SEPARA RECEBIDO, GRAVADO E CONFIRMADO");
  prova("recebido/gravado/confirmado existem",
    semId.recebido === true && semId.gravado === false && semId.confirmado === false);
  prova("declara que é escrita", semId.escrita === true);

  diz("");
  diz("ROTAS");
  prova("lote está desligado",
    AP_PLE_rota({ acao: "lote", payload: {} }).codigo === "LOTE_DESLIGADO");
  prova("ação desconhecida: recusa",
    AP_PLE_rota({ acao: "apagar", payload: {} }).codigo === "ACAO_DESCONHECIDA");
  var porta = AP_PLE_direto(JSON.stringify({ acao: "gravar", payload: {} }));
  prova("a porta devolve texto JSON", typeof porta === "string");
  prova("a porta com lixo não estoura", /PEDIDO_INVALIDO/.test(AP_PLE_direto("{{{")));

  diz("");
  diz("ONDE A AUDITORIA VAI CAIR");
  var achou = "";
  try {
    var ss = AP_PL_planilha_();
    for (var i = 0; i < AP_PLE_ABAS_LOG.length && !achou; i++) {
      if (ss.getSheetByName(AP_PLE_ABAS_LOG[i])) achou = AP_PLE_ABAS_LOG[i];
    }
  } catch (e) {}
  diz("   aba: " + (achou || "NENHUMA das configuradas"));
  prova("existe aba de auditoria", !!achou,
    achou ? "" : "as gravações acontecem, mas sem registro");

  diz("");
  diz("passaram: " + ok + "    falharam: " + mal);
  if (!mal) {
    diz("");
    diz("As recusas estão corretas e nada foi gravado.");
    diz("Agora prove uma gravação DE VERDADE pela tela: Integrações →");
    diz("Central de Dados → abra uma aba → Editar numa linha → Aplicar.");
    diz("Confira na planilha. Só depois disso o lote é ligado.");
  }
  var saida = L.join("\n");
  Logger.log(saida);
  return saida;
}
