/**
 * ============================================================
 * ALMOX-PRO — LIXEIRA
 * ============================================================
 * A IDEIA, NAS PALAVRAS DELE
 *
 *   "Ao apertar excluir ele vai ficar numa outra aba, uma outra
 *   tabela, e quando chegar no final ele vai excluir
 *   automaticamente."
 *
 * OS TRÊS ESTÁGIOS
 *
 *   1. MARCAR    alguém escreve EXCLUIDO na coluna de situação.
 *                Isso já acontece hoje — pelo sistema ou pelo
 *                AP_Reparo_duplicados. Este arquivo não marca.
 *
 *   2. MOVER     este arquivo tira a linha da aba oficial e põe
 *                numa aba LIXEIRA_<nome>, com a data e de onde
 *                veio. A linha sai da lista do sistema sem
 *                depender do Core.
 *
 *   3. PURGAR    depois de AP_LIX_DIAS dias na lixeira, a linha
 *                é apagada de verdade.
 *
 * POR QUE NA PLANILHA E NÃO PELO SISTEMA
 *   Porque hoje a exclusão pelo sistema escreve no repositório do
 *   Drive e a lista lê da planilha — a linha nunca sai. Este
 *   arquivo trabalha direto na fonte que a lista lê.
 *
 * O QUE ELE NUNCA FAZ
 *   · Não apaga nada que não tenha passado pela lixeira e
 *     cumprido o prazo. Não existe atalho.
 *   · Não toca em NOTA FISCAL. Documento fiscal tem guarda legal;
 *     nota editada guarda versão, não vira lixo. As abas de NF
 *     estão numa lista de proibidas, e ligar a purga nelas é
 *     recusado pelo código, não só desaconselhado.
 *   · Não move linha sem coluna de situação — sem ela não há como
 *     saber o que foi excluído.
 *   · Antes de qualquer movimento, copia a aba inteira.
 *
 * COMO USAR
 *   1. Cole no editor e rode AP_Lixeira. Ele mostra e para.
 *   2. Para mover: AP_LIX_MOVER = true.
 *   3. Para purgar o que venceu: AP_LIX_PURGAR = true.
 *   4. Para rodar sozinho todo dia: rode AP_Lixeira_agendar uma vez.
 * ============================================================ */

/* abas que a lixeira cuida. Vazio = ela procura sozinha quem tem
   linha marcada EXCLUIDO e mostra, sem mover nada. */
var AP_LIX_ABAS = [];

var AP_LIX_DIAS   = 30;     /* dias na lixeira antes de sumir de vez */
var AP_LIX_MOVER  = false;  /* estágio 2 */
var AP_LIX_PURGAR = false;  /* estágio 3 */

/* nunca entram na lixeira automática, por guarda legal */
var AP_LIX_PROIBIDAS = ["NF", "NOTA", "NOTAS", "FISCAL", "NFE", "DANFE",
                        "LANCAMENTO", "LANCAMENTOS", "AUDITORIA", "SESSOES"];

var AP_LIX_MARCAS = ["EXCLUIDO", "EXCLUÍDO", "EXCLUIDA", "EXCLUÍDA", "DELETADO", "REMOVIDO"];

function AP_Lixeira() {
  var L = [];
  function diz(t) { L.push(t); Logger.log(t); }
  function pad(t, n) { t = String(t); while (t.length < n) t += " "; return t; }
  function dir(t, n) { t = String(t); while (t.length < n) t = " " + t; return t; }
  function lim(v) { return String(v === null || v === undefined ? "" : v).trim(); }

  diz("================================================");
  diz("LIXEIRA · " + new Date().toLocaleString("pt-BR"));
  diz("================================================");
  diz("prazo na lixeira: " + AP_LIX_DIAS + " dia(s)");
  diz("");

  var ss;
  try {
    ss = (typeof AP_Config_getSpreadsheet_ === "function")
      ? AP_Config_getSpreadsheet_() : SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) { diz("não abri a planilha: " + e); return L.join("\n"); }

  function proibida(nome) {
    var n = lim(nome).toUpperCase();
    if (n.indexOf("LIXEIRA_") === 0) return false;
    for (var i = 0; i < AP_LIX_PROIBIDAS.length; i++) {
      var p = AP_LIX_PROIBIDAS[i];
      if (n === p || n.indexOf("_" + p) > -1 || n.indexOf(p + "_") === 0) return true;
    }
    return false;
  }
  function cab(aba) {
    if (!aba || aba.getLastRow() < 1 || aba.getLastColumn() < 1) return [];
    return aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0].map(lim);
  }
  function colSituacao(c) {
    for (var i = 0; i < c.length; i++) {
      if (["STATUS", "SITUACAO", "SITUAÇÃO", "ATIVO"].indexOf(c[i].toUpperCase()) > -1) return i;
    }
    return -1;
  }
  function estaExcluida(v) {
    var s = lim(v).toUpperCase();
    if (!s) return false;
    for (var i = 0; i < AP_LIX_MARCAS.length; i++) {
      if (s.indexOf(AP_LIX_MARCAS[i]) === 0) return true;
    }
    return false;
  }

  /* ---------- 1. onde há coisa marcada ---------- */
  diz("1. O QUE ESTÁ MARCADO COMO EXCLUÍDO");
  diz("   " + pad("aba", 30) + dir("linhas", 8) + dir("marcadas", 10) + "  coluna");
  var alvos = [];
  ss.getSheets().forEach(function (aba) {
    var nome = aba.getName();
    if (nome.indexOf("LIXEIRA_") === 0) return;
    if (nome.indexOf("_ANTES_") > -1) return;          /* cópias de segurança */
    var n = Math.max(0, aba.getLastRow() - 1);
    if (!n) return;
    var c = cab(aba), ix = colSituacao(c);
    if (ix < 0) return;
    var dados = aba.getRange(2, 1, n, aba.getLastColumn()).getValues();
    var marcadas = [];
    dados.forEach(function (l, i) { if (estaExcluida(l[ix])) marcadas.push(i + 2); });
    if (!marcadas.length) return;
    alvos.push({ aba: aba, nome: nome, n: n, ix: ix, cab: c,
                 marcadas: marcadas, proibida: proibida(nome) });
    diz("   " + pad(nome, 30) + dir(n, 8) + dir(marcadas.length, 10) + "  " + c[ix] +
        (proibida(nome) ? "   <<< PROTEGIDA" : ""));
  });
  if (!alvos.length) {
    diz("   nenhuma linha marcada como excluída em nenhuma aba");
    diz("");
    diz("   >>> Se você esperava ver alguma, confira se a coluna de");
    diz("   >>> situação se chama STATUS, SITUACAO ou ATIVO, e se o");
    diz("   >>> valor começa com EXCLUIDO.");
    /* NÃO retorno aqui. Já retornei uma vez, e com isso a purga nunca
       rodava: no dia a dia é normal não haver nada novo marcado, e o
       gatilho diário existe justamente para esvaziar a lixeira velha.
       Só paro se não houver NEM marcada NEM lixeira. */
  }
  diz("");

  var protegidas = alvos.filter(function (a) { return a.proibida; });
  if (protegidas.length) {
    diz("   >>> ABAS PROTEGIDAS, e isto não é configurável à toa:");
    protegidas.forEach(function (a) { diz("   >>>    " + a.nome); });
    diz("   >>> Documento fiscal tem guarda legal. Nota editada guarda");
    diz("   >>> VERSÃO, não vira lixo. A trilha de auditoria também não");
    diz("   >>> se purga: ela existe para ser consultada depois.");
    diz("   >>> Estas abas aparecem no relatório e NUNCA são movidas");
    diz("   >>> nem purgadas por este arquivo.");
    diz("");
  }

  var cuidar = alvos.filter(function (a) { return !a.proibida; });
  if (AP_LIX_ABAS.length) {
    cuidar = cuidar.filter(function (a) { return AP_LIX_ABAS.indexOf(a.nome) > -1; });
    diz("   (limitado às abas de AP_LIX_ABAS: " + AP_LIX_ABAS.join(", ") + ")");
    diz("");
  }

  /* ---------- 2. o que já está na lixeira ---------- */
  diz("2. O QUE JÁ ESTÁ NA LIXEIRA");
  var agora = new Date().getTime();
  var lixeiras = [];
  ss.getSheets().forEach(function (aba) {
    var nome = aba.getName();
    if (nome.indexOf("LIXEIRA_") !== 0) return;
    var n = Math.max(0, aba.getLastRow() - 1);
    var c = cab(aba);
    var ixQuando = -1;
    c.forEach(function (x, i) { if (ixQuando < 0 && x === "__naLixeiraDesde") ixQuando = i; });
    var vencidas = [];
    if (n && ixQuando >= 0) {
      aba.getRange(2, 1, n, aba.getLastColumn()).getValues().forEach(function (l, i) {
        var t = Date.parse(lim(l[ixQuando]));
        if (!t) return;
        var dias = Math.floor((agora - t) / 86400000);
        if (dias >= AP_LIX_DIAS) vencidas.push({ linha: i + 2, dias: dias });
      });
    }
    lixeiras.push({ aba: aba, nome: nome, n: n, ixQuando: ixQuando, vencidas: vencidas });
    diz("   " + pad(nome, 30) + dir(n, 8) + " linha(s), " + vencidas.length + " vencida(s)" +
        (ixQuando < 0 ? "   <<< sem coluna de data; não purgo" : ""));
  });
  if (!lixeiras.length) diz("   nenhuma lixeira criada ainda");
  diz("");

  if (!alvos.length && !lixeiras.length) {
    diz("Não há nada marcado e não existe lixeira. Nada a fazer.");
    return L.join("\n");
  }

  var totalMover = cuidar.reduce(function (s, a) { return s + a.marcadas.length; }, 0);
  var totalPurgar = lixeiras.reduce(function (s, l) { return s + l.vencidas.length; }, 0);

  diz("3. O PLANO");
  diz("   linhas que iriam para a lixeira ..... " + totalMover);
  diz("   linhas vencidas, a purgar ........... " + totalPurgar);
  diz("   abas protegidas, intocadas .......... " + protegidas.length);
  diz("");

  if (!AP_LIX_MOVER && !AP_LIX_PURGAR) {
    diz("================================================");
    diz("PAREI AQUI. Nada foi movido nem apagado.");
    diz("================================================");
    diz("Para mover o que está marcado:   AP_LIX_MOVER = true");
    diz("Para purgar o que venceu:        AP_LIX_PURGAR = true");
    diz("");
    diz("Faça um de cada vez, na primeira. Mover é reversível — a");
    diz("linha fica inteira na lixeira. Purgar não é.");
    return L.join("\n");
  }

  /* ---------- 4. mover ---------- */
  if (AP_LIX_MOVER && cuidar.length) {
    diz("4. MOVENDO PARA A LIXEIRA");
    var carimbo = Utilities.formatDate(new Date(), "GMT-3", "yyyyMMdd-HHmm");
    cuidar.forEach(function (a) {
      try { a.aba.copyTo(ss).setName(a.nome + "_ANTES_" + carimbo); }
      catch (e) { diz("   >>> " + a.nome + ": não consegui copiar (" + e + "). Pulei."); return; }

      var nomeLix = "LIXEIRA_" + a.nome;
      var lix = ss.getSheetByName(nomeLix);
      var cabLix = a.cab.concat(["__naLixeiraDesde", "__vinhaDaAba", "__linhaOriginal"]);
      if (!lix) {
        lix = ss.insertSheet(nomeLix);
        lix.getRange(1, 1, 1, cabLix.length).setValues([cabLix]);
      }
      var largura = Math.max(lix.getLastColumn(), cabLix.length);
      var quando = new Date().toISOString();
      var linhas = a.marcadas.map(function (ln) {
        var v = a.aba.getRange(ln, 1, 1, a.aba.getLastColumn()).getValues()[0];
        var saida = v.concat([quando, a.nome, ln]);
        while (saida.length < largura) saida.push("");
        return saida;
      });
      if (linhas.length) {
        lix.getRange(lix.getLastRow() + 1, 1, linhas.length, largura).setValues(linhas);
      }
      /* apaga de baixo para cima, senão os números de linha andam */
      a.marcadas.slice().sort(function (x, y) { return y - x; })
        .forEach(function (ln) { a.aba.deleteRow(ln); });
      diz("   " + pad(a.nome, 30) + a.marcadas.length + " linha(s) -> " + nomeLix);
    });
    SpreadsheetApp.flush();
    diz("");
  }

  /* ---------- 5. purgar ---------- */
  if (AP_LIX_PURGAR) {
    diz("5. PURGANDO O QUE VENCEU");
    var apagadas = 0;
    lixeiras.forEach(function (l) {
      if (l.ixQuando < 0 || !l.vencidas.length) return;
      if (proibida(l.nome.replace("LIXEIRA_", ""))) {
        diz("   " + pad(l.nome, 30) + "PROTEGIDA — não purgo");
        return;
      }
      l.vencidas.slice().sort(function (a, b) { return b.linha - a.linha; })
        .forEach(function (v) { l.aba.deleteRow(v.linha); apagadas++; });
      diz("   " + pad(l.nome, 30) + l.vencidas.length + " linha(s) apagada(s)" +
          "  (mais de " + AP_LIX_DIAS + " dias)");
    });
    if (!apagadas) diz("   nada vencido para apagar");
    SpreadsheetApp.flush();
    diz("");
  }

  try {
    if (typeof AP_Auditoria_registrar === "function") {
      AP_Auditoria_registrar({
        acao: "Lixeira", modulo: "Lixeira",
        registro: "movidas: " + (AP_LIX_MOVER ? totalMover : 0) +
                  " · purgadas: " + (AP_LIX_PURGAR ? totalPurgar : 0),
        usuario: "EDITOR", resultado: "OK"
      });
    }
  } catch (e) {}

  diz("================================================");
  diz("PARA DESFAZER");
  diz("================================================");
  diz("O que foi MOVIDO está inteiro nas abas LIXEIRA_*, com a data");
  diz("e a linha de onde veio. Para voltar, recorte de lá e cole na");
  diz("aba original. As cópias _ANTES_ têm o estado de antes.");
  diz("");
  diz("O que foi PURGADO não volta. Só as cópias _ANTES_ de execuções");
  diz("anteriores e o histórico de versões do Google ainda têm.");
  return L.join("\n");
}

/* ============================================================
   RODAR SOZINHO TODO DIA
   ------------------------------------------------------------
   Cria um gatilho diário. Ele roda com MOVER e PURGAR nos valores
   que estiverem no arquivo — então só agende DEPOIS de ter rodado
   na mão e conferido o resultado.
   ============================================================ */
function AP_Lixeira_agendar() {
  var L = [];
  function diz(t) { L.push(t); Logger.log(t); }
  var jaTem = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "AP_Lixeira") { jaTem++; }
  });
  if (jaTem) {
    diz("já existe " + jaTem + " gatilho para AP_Lixeira. Não criei outro.");
    return L.join("\n");
  }
  ScriptApp.newTrigger("AP_Lixeira").timeBased().everyDays(1).atHour(3).create();
  diz("gatilho diário criado: AP_Lixeira, por volta das 3h.");
  diz("");
  diz(">>> ATENÇÃO: ele vai rodar com AP_LIX_MOVER e AP_LIX_PURGAR");
  diz(">>> como estiverem escritos no arquivo. Se os dois estiverem");
  diz(">>> false, o gatilho só vai gerar relatório — que é um bom");
  diz(">>> jeito de começar.");
  return L.join("\n");
}

function AP_Lixeira_desagendar() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "AP_Lixeira") { ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log(n + " gatilho(s) removido(s).");
  return n + " gatilho(s) removido(s).";
}
