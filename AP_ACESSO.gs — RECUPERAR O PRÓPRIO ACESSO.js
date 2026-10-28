/**
 * AP_ACESSO.gs — RECUPERAR O PRÓPRIO ACESSO, PELO APPS SCRIPT
 * ============================================================
 * POR QUE ESTE ARQUIVO EXISTE
 *   Ele apagou o próprio usuário e ficou de fora do sistema. A saída
 *   NÃO pode ser um atalho no HTML: aquele arquivo é público, e
 *   qualquer senha ou botão escondido nele vale para quem abrir o
 *   código. Foi ele mesmo quem escreveu essa regra.
 *
 *   Aqui a autenticação é outra, e é forte: este arquivo roda DENTRO
 *   do Apps Script, e só faz alguma coisa para quem é DONO DA
 *   PLANILHA. Quem executa é identificado pela conta Google, pelo
 *   próprio Google — não por senha nenhuma guardada em lugar algum.
 *
 * COMO USAR
 *   1. Cole este arquivo no projeto do Apps Script.
 *   2. Rode  AP_AC_diagnostico()  e leia o registro de execução.
 *      Ele diz o que há na sua linha e qual é o caso.
 *   3. Conforme o caso:
 *        AP_AC_restaurar("<sua matrícula>")
 *        AP_AC_definirSenha("<sua matrícula>", "<senha nova>")
 *
 * O QUE ELE NUNCA FAZ
 *   - Não imprime senha, hash, token ou e-mail de ninguém.
 *     Do hash ele mostra só o COMPRIMENTO e o tipo de caractere —
 *     o bastante para eu saber o formato, nada para abrir a conta.
 *   - Não apaga linha nem coluna. Não cria aba. Não mexe em quem
 *     não foi pedido, uma linha por vez.
 *   - Não grava senha em formato que ele não reconheceu: se não
 *     souber como o Core guarda, ele PARA e diz o que viu.
 *   - Não dá acesso a quem não é dono da planilha.
 *
 * ONDE PROCURAR ERRO
 *   AP_AC_diagnostico()   o retrato, sem gravar nada
 *   AP_AC_restaurar()     devolve a situação para ATIVO
 *   AP_AC_definirSenha()  grava a senha nova, no formato detectado
 */

/* ------------------------------------------------------------------
   CONFIGURAÇÃO — só mexa se a sua planilha fugir do padrão
   ------------------------------------------------------------------ */
var AP_AC_PLANILHA_ID = "";          /* vazio = a planilha deste projeto */
var AP_AC_ABA = "USUARIOS";
var AP_AC_COL_MATRICULA = "matricula";
var AP_AC_COL_STATUS = ["status", "situacao", "situação", "estado"];
var AP_AC_COL_SENHA = ["senha_hash", "senhahash", "senha", "hash"];
var AP_AC_COL_EMAIL = ["email", "e-mail"];
var AP_AC_COL_NOME = ["nome", "colaborador"];
var AP_AC_COL_PERFIL = ["perfil", "papel", "nivel", "nível"];
var AP_AC_ATIVO = "ATIVO";

/* ==================================================================
   1. QUEM ESTÁ RODANDO, E SE PODE
   ================================================================== */
function AP_AC_conta_() {
  try {
    var e = Session.getActiveUser().getEmail();
    return String(e == null ? "" : e).trim();
  } catch (x) { return ""; }
}

function AP_AC_planilha_() {
  if (AP_AC_PLANILHA_ID) return SpreadsheetApp.openById(AP_AC_PLANILHA_ID);
  return SpreadsheetApp.getActiveSpreadsheet();
}

/** Só o dono da planilha. Falha fechada: na dúvida, não libera. */
function AP_AC_podeOperar_() {
  var conta = AP_AC_conta_();
  if (!conta) {
    return { ok: false, codigo: "SEM_CONTA",
      mensagem: "O Google não me disse qual conta está executando. Rode pelo " +
        "editor do Apps Script, logado com a conta dona da planilha." };
  }
  var dono = "";
  try {
    var d = AP_AC_planilha_().getOwner();
    dono = d ? String(d.getEmail() || "").trim() : "";
  } catch (x) {
    return { ok: false, codigo: "SEM_DONO",
      mensagem: "Não consegui ler quem é o dono da planilha (" +
        String(x && x.message) + ")." };
  }
  if (!dono) {
    return { ok: false, codigo: "SEM_DONO",
      mensagem: "A planilha não declarou dono. Não libero sem saber." };
  }
  if (dono.toLowerCase() !== conta.toLowerCase()) {
    return { ok: false, codigo: "NAO_E_O_DONO",
      mensagem: "Quem está executando não é o dono desta planilha. " +
        "Este arquivo só opera para o dono." };
  }
  return { ok: true, conta: conta };
}

/* ==================================================================
   2. LER A ABA
   ================================================================== */
function AP_AC_norm_(v) {
  return String(v == null ? "" : v).toUpperCase()
    .replace(/[^A-Z0-9]/g, "").replace(/^0+/, "");
}

function AP_AC_acharColuna_(cab, candidatas) {
  for (var i = 0; i < candidatas.length; i++) {
    for (var j = 0; j < cab.length; j++) {
      if (String(cab[j]).trim().toLowerCase() === String(candidatas[i]).toLowerCase()) {
        return { nome: String(cab[j]).trim(), indice: j };
      }
    }
  }
  return null;
}

function AP_AC_base_() {
  var pl = AP_AC_planilha_();
  var aba = pl.getSheetByName(AP_AC_ABA);
  if (!aba) {
    return { ok: false, codigo: "ABA_AUSENTE",
      mensagem: "não achei a aba " + AP_AC_ABA + " nesta planilha" };
  }
  var ultima = aba.getLastRow();
  var colunas = aba.getLastColumn();
  if (ultima < 2) {
    return { ok: false, codigo: "ABA_VAZIA",
      mensagem: "a aba " + AP_AC_ABA + " não tem nenhuma linha de dados" };
  }
  var grade = aba.getRange(1, 1, ultima, colunas).getValues();
  var cab = grade[0].map(function (c) { return String(c == null ? "" : c).trim(); });
  return { ok: true, aba: aba, cab: cab, grade: grade,
           col: {
             matricula: AP_AC_acharColuna_(cab, [AP_AC_COL_MATRICULA]),
             status: AP_AC_acharColuna_(cab, AP_AC_COL_STATUS),
             senha: AP_AC_acharColuna_(cab, AP_AC_COL_SENHA),
             email: AP_AC_acharColuna_(cab, AP_AC_COL_EMAIL),
             nome: AP_AC_acharColuna_(cab, AP_AC_COL_NOME),
             perfil: AP_AC_acharColuna_(cab, AP_AC_COL_PERFIL)
           } };
}

/** O FORMATO do segredo, sem o segredo. */
function AP_AC_formatoDoHash_(v) {
  var s = String(v == null ? "" : v);
  if (!s) return { tipo: "VAZIO", tamanho: 0, descricao: "a célula está vazia" };
  var t = s.length;
  /* "abcd" é hexadecimal válido, mas nenhum hash tem 4 caracteres.
     Abaixo de 16 isto é senha curta, não hash. */
  if (/^[0-9a-f]+$/i.test(s) && t >= 16) {
    if (t === 64) return { tipo: "HEX64", tamanho: t,
      descricao: "64 caracteres hexadecimais — cara de SHA-256 em hex" };
    if (t === 40) return { tipo: "HEX40", tamanho: t,
      descricao: "40 caracteres hexadecimais — cara de SHA-1 em hex" };
    if (t === 32) return { tipo: "HEX32", tamanho: t,
      descricao: "32 caracteres hexadecimais — cara de MD5 em hex" };
    return { tipo: "HEX", tamanho: t, descricao: t + " caracteres hexadecimais" };
  }
  if (/^\$2[aby]\$/.test(s)) return { tipo: "BCRYPT", tamanho: t,
    descricao: "começa com $2 — bcrypt" };
  /* base64 só quando o TAMANHO é de digest: 24 (SHA-1 sem padding não
     casa), 28 (SHA-1), 44 (SHA-256), 88 (SHA-512), ou quando termina
     em "=". Sem isto, uma senha curta como "senha123" — 8 caracteres,
     múltiplo de 4 — era lida como base64, e eu gravaria um hash onde
     o Core espera outra coisa. Errar aqui tranca a pessoa de vez. */
  var TAMANHOS_DE_DIGEST = { 24: 1, 28: 1, 44: 1, 64: 1, 88: 1 };
  if (/^[A-Za-z0-9+/]+=*$/.test(s) &&
      (s.charAt(t - 1) === "=" || (t % 4 === 0 && TAMANHOS_DE_DIGEST[t]))) {
    return { tipo: "BASE64", tamanho: t, descricao: t + " caracteres, cara de base64" };
  }
  if (s.indexOf(":") > -1 || s.indexOf("$") > -1) {
    return { tipo: "COMPOSTO", tamanho: t,
      descricao: t + " caracteres com separador — hash com sal embutido" };
  }
  return { tipo: "TEXTO", tamanho: t,
    descricao: t + " caracteres comuns — pode ser senha em texto puro, " +
      "o que seria um problema de segurança por si só" };
}

function AP_AC_acharLinha_(b, matricula) {
  if (!b.col.matricula) return null;
  var alvo = AP_AC_norm_(matricula);
  if (!alvo) return null;
  for (var i = 1; i < b.grade.length; i++) {
    if (AP_AC_norm_(b.grade[i][b.col.matricula.indice]) === alvo) {
      return { linha: i + 1, dados: b.grade[i] };
    }
  }
  return null;
}

/* ==================================================================
   3. O DIAGNÓSTICO — não grava nada
   ================================================================== */
function AP_AC_diagnostico(matricula) {
  var saida = [];
  function diz(s) { saida.push(s); Logger.log(s); }

  diz("=== AP_ACESSO · DIAGNÓSTICO ===");
  var pode = AP_AC_podeOperar_();
  diz("conta que está executando: " + (AP_AC_conta_() ? "identificada" : "NÃO identificada"));
  diz("é o dono da planilha: " + (pode.ok ? "SIM" : "NÃO — " + pode.mensagem));
  if (!pode.ok) {
    diz("");
    diz("Sem ser o dono eu não leio nem gravo nada aqui.");
    return saida.join("\n");
  }

  var b = AP_AC_base_();
  if (!b.ok) { diz("ERRO: " + b.mensagem); return saida.join("\n"); }

  diz("aba: " + AP_AC_ABA + " · linhas de dados: " + (b.grade.length - 1));
  ["matricula", "status", "senha", "email", "nome", "perfil"].forEach(function (k) {
    diz("coluna " + k + ": " + (b.col[k] ? b.col[k].nome : "NÃO EXISTE nesta aba"));
  });

  /* quantos administradores ativos ainda existem */
  if (b.col.status) {
    var ativos = 0, excluidos = 0, admins = 0;
    for (var i = 1; i < b.grade.length; i++) {
      var st = String(b.grade[i][b.col.status.indice] || "").toUpperCase();
      if (st.indexOf("EXCLU") === 0) { excluidos++; continue; }
      ativos++;
      if (b.col.perfil) {
        var pf = String(b.grade[i][b.col.perfil.indice] || "").toUpperCase();
        if (pf.indexOf("ADMIN") > -1) admins++;
      }
    }
    diz("");
    diz("situação geral: " + ativos + " ativo(s), " + excluidos + " excluído(s)" +
        (b.col.perfil ? ", " + admins + " com perfil de administrador" : ""));
    if (b.col.perfil && admins === 0) {
      diz("ATENÇÃO: nenhum administrador ativo. É por isso que ninguém entra.");
    }
  }

  /* o formato do segredo, olhando quem ainda tem senha */
  if (b.col.senha) {
    var formatos = {};
    var comSenha = 0;
    for (var j = 1; j < b.grade.length; j++) {
      var f = AP_AC_formatoDoHash_(b.grade[j][b.col.senha.indice]);
      if (f.tipo === "VAZIO") continue;
      comSenha++;
      formatos[f.tipo] = (formatos[f.tipo] || 0) + 1;
      if (!formatos.__exemplo) formatos.__exemplo = f.descricao;
    }
    diz("");
    diz("senhas gravadas: " + comSenha + " linha(s) com conteúdo na coluna " +
        b.col.senha.nome);
    var tipos = [];
    for (var t in formatos) { if (t !== "__exemplo") tipos.push(t + "×" + formatos[t]); }
    diz("formato(s) encontrado(s): " + (tipos.join(", ") || "nenhum"));
    if (formatos.__exemplo) diz("o que isso quer dizer: " + formatos.__exemplo);
    diz("(não imprimi nenhum hash — só o formato)");
  }

  /* a linha pedida */
  if (matricula) {
    diz("");
    diz("--- a matrícula " + matricula + " ---");
    var achada = AP_AC_acharLinha_(b, matricula);
    if (!achada) {
      diz("NÃO achei nenhuma linha com essa matrícula na aba " + AP_AC_ABA + ".");
      diz("Confira se a matrícula está escrita como está na planilha.");
    } else {
      diz("linha na planilha: " + achada.linha);
      if (b.col.nome) diz("nome: " + String(achada.dados[b.col.nome.indice] || "(vazio)"));
      if (b.col.status) {
        var st2 = String(achada.dados[b.col.status.indice] || "(vazio)");
        diz("situação: " + st2);
        if (String(st2).toUpperCase().indexOf("EXCLU") === 0) {
          diz(">>> É ISTO. O cadastro está EXCLUIDO, e o login recusa por isso,");
          diz(">>> não pela senha. Rode: AP_AC_restaurar(\"" + matricula + "\")");
        }
      }
      if (b.col.perfil) diz("perfil: " + String(achada.dados[b.col.perfil.indice] || "(vazio)"));
      if (b.col.senha) {
        var fs2 = AP_AC_formatoDoHash_(achada.dados[b.col.senha.indice]);
        diz("senha: " + fs2.descricao);
        if (fs2.tipo === "VAZIO") {
          diz(">>> A senha está vazia. Rode:");
          diz(">>> AP_AC_definirSenha(\"" + matricula + "\", \"a senha que você quiser\")");
        }
      }
      if (b.col.email) {
        var em = String(achada.dados[b.col.email.indice] || "");
        diz("e-mail: " + (em ? "preenchido" : "vazio") + " (não imprimo o endereço)");
      }
    }
  } else {
    diz("");
    diz("Rode de novo com a sua matrícula para ver a sua linha:");
    diz("AP_AC_diagnostico(\"000458\")");
  }
  return saida.join("\n");
}

/* ==================================================================
   4. RESTAURAR A SITUAÇÃO
   ================================================================== */
function AP_AC_restaurar(matricula) {
  var pode = AP_AC_podeOperar_();
  if (!pode.ok) { Logger.log("RECUSADO: " + pode.mensagem); return pode; }

  var b = AP_AC_base_();
  if (!b.ok) { Logger.log("ERRO: " + b.mensagem); return b; }
  if (!b.col.status) {
    var r1 = { ok: false, codigo: "SEM_COLUNA_STATUS",
      mensagem: "esta aba não tem coluna de situação; não há o que restaurar" };
    Logger.log(r1.mensagem); return r1;
  }
  var achada = AP_AC_acharLinha_(b, matricula);
  if (!achada) {
    var r2 = { ok: false, codigo: "NAO_ACHEI",
      mensagem: "não achei a matrícula " + matricula + " na aba " + AP_AC_ABA };
    Logger.log(r2.mensagem); return r2;
  }
  var antes = String(achada.dados[b.col.status.indice] || "");
  if (antes.toUpperCase() === AP_AC_ATIVO) {
    var r3 = { ok: true, mudou: false, linha: achada.linha,
      mensagem: "a situação já era " + AP_AC_ATIVO + ": não mexi em nada. " +
        "Se o login ainda recusa, o caso é a senha." };
    Logger.log(r3.mensagem); return r3;
  }

  var trava = LockService.getScriptLock();
  if (!trava.tryLock(20000)) {
    var r4 = { ok: false, codigo: "OCUPADO", mensagem: "a planilha está ocupada" };
    Logger.log(r4.mensagem); return r4;
  }
  try {
    b.aba.getRange(achada.linha, b.col.status.indice + 1).setValue(AP_AC_ATIVO);
    SpreadsheetApp.flush();
    /* confere relendo: gravar não é o mesmo que ter gravado */
    var depois = String(b.aba.getRange(achada.linha, b.col.status.indice + 1)
      .getValues()[0][0] || "");
    var ok = depois.toUpperCase() === AP_AC_ATIVO;
    var r5 = { ok: ok, mudou: ok, linha: achada.linha, antes: antes, depois: depois,
      mensagem: ok
        ? "linha " + achada.linha + ": situação passou de \"" + antes + "\" para " +
          AP_AC_ATIVO + ". Confirmado relendo. Tente entrar no sistema."
        : "gravei, mas ao reler a situação está \"" + depois + "\". Não passou." };
    Logger.log(r5.mensagem);
    return r5;
  } finally {
    trava.releaseLock();
  }
}

/* ==================================================================
   5. DEFINIR A SENHA — só no formato que eu reconheci
   ================================================================== */
function AP_AC_hashDe_(senha, tipo) {
  if (tipo === "HEX64") {
    var bytes = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256, senha, Utilities.Charset.UTF_8);
    return bytes.map(function (b) {
      var v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? "0" + v : v;
    }).join("");
  }
  if (tipo === "HEX40") {
    var b1 = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_1, senha, Utilities.Charset.UTF_8);
    return b1.map(function (b) {
      var v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? "0" + v : v;
    }).join("");
  }
  if (tipo === "HEX32") {
    var b2 = Utilities.computeDigest(
      Utilities.DigestAlgorithm.MD5, senha, Utilities.Charset.UTF_8);
    return b2.map(function (b) {
      var v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? "0" + v : v;
    }).join("");
  }
  if (tipo === "BASE64") {
    return Utilities.base64Encode(Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256, senha, Utilities.Charset.UTF_8));
  }
  return null;
}

function AP_AC_definirSenha(matricula, novaSenha) {
  var pode = AP_AC_podeOperar_();
  if (!pode.ok) { Logger.log("RECUSADO: " + pode.mensagem); return pode; }

  var senha = String(novaSenha == null ? "" : novaSenha);
  if (senha.length < 6) {
    var r0 = { ok: false, codigo: "SENHA_CURTA",
      mensagem: "escolha uma senha de pelo menos 6 caracteres" };
    Logger.log(r0.mensagem); return r0;
  }

  var b = AP_AC_base_();
  if (!b.ok) { Logger.log("ERRO: " + b.mensagem); return b; }
  if (!b.col.senha) {
    var r1 = { ok: false, codigo: "SEM_COLUNA_SENHA",
      mensagem: "esta aba não tem coluna de senha. Não vou criar coluna nenhuma." };
    Logger.log(r1.mensagem); return r1;
  }
  var achada = AP_AC_acharLinha_(b, matricula);
  if (!achada) {
    var r2 = { ok: false, codigo: "NAO_ACHEI",
      mensagem: "não achei a matrícula " + matricula + " na aba " + AP_AC_ABA };
    Logger.log(r2.mensagem); return r2;
  }

  /* qual formato o Core usa? Olho as OUTRAS linhas, não a dele —
     a dele pode estar vazia, que é justamente o problema. */
  var contagem = {};
  for (var i = 1; i < b.grade.length; i++) {
    if (i + 1 === achada.linha) continue;
    var f = AP_AC_formatoDoHash_(b.grade[i][b.col.senha.indice]);
    if (f.tipo === "VAZIO") continue;
    contagem[f.tipo] = (contagem[f.tipo] || 0) + 1;
  }
  var tipo = "", quantos = 0;
  for (var t in contagem) { if (contagem[t] > quantos) { tipo = t; quantos = contagem[t]; } }

  if (!tipo) {
    var r3 = { ok: false, codigo: "FORMATO_DESCONHECIDO",
      mensagem: "nenhuma outra linha tem senha gravada, então não sei em que " +
        "formato o Core guarda. NÃO vou escrever um palpite aqui: isso deixaria " +
        "você sem entrar do mesmo jeito. Rode AP_AC_diagnostico() e me mande o " +
        "que ele disser sobre o formato." };
    Logger.log(r3.mensagem); return r3;
  }
  var valor = AP_AC_hashDe_(senha, tipo);
  if (!valor) {
    var r4 = { ok: false, codigo: "FORMATO_NAO_SUPORTADO", formato: tipo,
      mensagem: "as senhas desta planilha estão no formato " + tipo + ", que eu não " +
        "sei reproduzir com segurança daqui (bcrypt e hash com sal precisam da " +
        "mesma rotina do Core). Não vou gravar um valor que não vai conferir. " +
        "Me diga que o formato é " + tipo + " e eu escrevo a função certa." };
    Logger.log(r4.mensagem); return r4;
  }

  var trava = LockService.getScriptLock();
  if (!trava.tryLock(20000)) {
    var r5 = { ok: false, codigo: "OCUPADO", mensagem: "a planilha está ocupada" };
    Logger.log(r5.mensagem); return r5;
  }
  try {
    b.aba.getRange(achada.linha, b.col.senha.indice + 1).setValue(valor);
    /* se estava excluído, a senha sozinha não resolve */
    var tambem = "";
    if (b.col.status) {
      var st = String(achada.dados[b.col.status.indice] || "");
      if (st.toUpperCase().indexOf("EXCLU") === 0) {
        b.aba.getRange(achada.linha, b.col.status.indice + 1).setValue(AP_AC_ATIVO);
        tambem = " A situação também voltou para " + AP_AC_ATIVO + ".";
      }
    }
    SpreadsheetApp.flush();
    var lido = String(b.aba.getRange(achada.linha, b.col.senha.indice + 1)
      .getValues()[0][0] || "");
    var ok = lido === valor;
    var r6 = { ok: ok, linha: achada.linha, formato: tipo,
      mensagem: ok
        ? "senha gravada na linha " + achada.linha + " no formato " + tipo +
          " e conferida relendo." + tambem +
          " Entre com a matrícula " + matricula + " e a senha que você escolheu." +
          " Troque-a depois pela tela do sistema."
        : "gravei e ao reler o valor não confere. Não considere feito." };
    Logger.log(r6.mensagem);
    return r6;
  } finally {
    trava.releaseLock();
  }
}

/* ==================================================================
   6. TESTE DE MESA — não toca na planilha de produção
   ================================================================== */
function AP_AC_testar() {
  var saida = [];
  function diz(s) { saida.push(s); Logger.log(s); }
  diz("=== AP_ACESSO · teste de mesa ===");
  var casos = [
    ["", "VAZIO"],
    ["a3f5c9d2b1e4a7f8c0d3e6b9a2f5c8d1e4b7a0f3c6d9e2b5a8f1c4d7e0b3a6f9", "HEX64"],
    ["$2a$10$abcdefghijklmnopqrstuv", "BCRYPT"],
    ["senha123", "TEXTO"]
  ];
  var erros = 0;
  casos.forEach(function (c) {
    var f = AP_AC_formatoDoHash_(c[0]);
    var ok = f.tipo === c[1];
    if (!ok) erros++;
    diz((ok ? "ok    " : "FALHA ") + "formato de " + (c[0] ? c[0].length : 0) +
        " caractere(s): esperava " + c[1] + ", veio " + f.tipo);
  });
  diz(erros ? erros + " falha(s)" : "formatos reconhecidos corretamente");
  diz("nenhum segredo foi impresso neste teste.");
  return saida.join("\n");
}

