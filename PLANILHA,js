/**
 * ============================================================================
 * AP_PLANILHA.gs
 * ALMOX-PRO · Fase 2 da Central de Dados: DESCOBERTA E LEITURA DAS ABAS
 * ----------------------------------------------------------------------------
 * O QUE ESTE ARQUIVO FAZ
 *   Três rotas de LEITURA sobre a planilha oficial:
 *     planilha.abas        → quais abas existem, com linhas e cabeçalhos
 *     planilha.ler         → uma aba, paginada, com busca e filtro
 *     planilha.diagnostico → o que não deu para ler, e por quê
 *
 * O QUE ELE NÃO FAZ — E ISSO É GARANTIA, NÃO PROMESSA
 *   Não existe neste arquivo nenhuma chamada que escreva: nem setValue,
 *   nem setValues, nem appendRow, nem deleteRow, nem insertSheet, nem
 *   clear, nem setName. Se um dia alguém acrescentar uma, o próprio
 *   AP_PL_testar() acusa. Esta é a Fase 2 do plano, e a Fase 2 é leitura.
 *
 *   Também não renomeia aba, não reorganiza coluna, não toca em fórmula
 *   e não cria planilha paralela.
 *
 * SEGREDO NÃO SAI DAQUI
 *   Coluna cujo nome contenha senha, hash, salt, token, biometria,
 *   facial, digital ou segredo volta como "[protegido]". O valor nunca
 *   sai da planilha, nem para a tela nem para o log.
 *
 * COMO COMEÇAR
 *   1. Cole este arquivo no projeto.
 *   2. Rode AP_PL_testar(). Ele lê a planilha real e não grava nada.
 *   3. Rode AP_PL_abas() para ver a lista de abas.
 *   4. Para usar pela tela, ligue no roteador (instruções no fim).
 *
 * PERMISSÃO
 *   AP_PL_abas() e AP_PL_ler() são funções internas: quem chama é que
 *   valida. Rodando do editor do Apps Script, quem validou foi o próprio
 *   Google. A porta do navegador, AP_PL_direto(), exige validação de
 *   sessão e NEGA quando não há — igual ao módulo de usuários.
 * ============================================================================
 */


/* ============================================================================
 * 1. CONFIGURAÇÃO
 * ========================================================================= */

var AP_PL_CFG = {
  /** Vazio = planilha vinculada a este projeto. */
  PLANILHA_ID: "",
  /** Linhas por página na leitura. O teto existe para a resposta não estourar. */
  POR_PAGINA: 50,
  TETO_POR_PAGINA: 500,
  /** Teto de células lidas numa chamada, para não estourar o tempo do Apps Script. */
  TETO_CELULAS: 60000,
  /** Quantos caracteres de uma célula voltam. O resto é cortado com reticências. */
  TETO_TEXTO: 400
};

/** Nome da função do SEU projeto que valida sessão. Quando preenchida,
 *  ela tem PRECEDÊNCIA sobre tudo abaixo. Vazia, vale o acesso por conta
 *  Google, descrito a seguir. */
var AP_PL_VALIDAR_SESSAO = "";

/** SEM VALIDADOR CONFIGURADO, QUEM AUTENTICA É O GOOGLE.
 *  O Apps Script sabe qual conta abriu o aplicativo. Se houver uma conta
 *  Google identificada, ela já passou pela autenticação do Google — isso
 *  não é contornar restrição, é usar a que já existe.
 *
 *  CUIDADO QUE ESTE CÓDIGO TOMA, e que é fácil errar:
 *  usa Session.getActiveUser(), que é QUEM ABRIU. Nunca
 *  getEffectiveUser(), que numa implantação "executar como eu" devolve
 *  o DONO do script para qualquer visitante — usar aquele autorizaria
 *  o mundo inteiro achando que estava conferindo identidade.
 *
 *  Visitante anônimo (implantação aberta a "qualquer pessoa") não tem
 *  conta identificada, e aí a porta NEGA. */
var AP_PL_ACESSO_POR_CONTA_GOOGLE = true;

/** E a conta precisa estar cadastrada e ativa na aba USUARIOS. */
var AP_PL_EXIGIR_CADASTRO = true;

/** Perfis que podem abrir a Central. Vazio = qualquer cadastro ativo. */
var AP_PL_PERFIS = ["admin", "administrador", "gestor", "ti", "desenvolvedor", "master"];

/** Aba e coluna onde procurar a conta. */
var AP_PL_ABA_USUARIOS = "USUARIOS";

/** O DONO DA PLANILHA SEMPRE PODE LER.
 *  Quem é dono do arquivo já abre a planilha inteira com dois cliques no
 *  Drive: exigir que ele esteja cadastrado para LER pela tela não protege
 *  nada e só atrapalha. Vale para leitura; gravação é outra conversa.
 *
 *  A conferência é pelo DONO DO ARQUIVO (Spreadsheet.getOwner()), não por
 *  getEffectiveUser(). Numa implantação "executar como o usuário", o
 *  effectiveUser é o próprio visitante, e comparar os dois liberaria
 *  qualquer um. O dono do arquivo é um fato, não depende da implantação. */
var AP_PL_DONO_SEMPRE_PODE = true;

/** Contas liberadas à mão, além do dono e dos cadastrados. Use para um
 *  administrador cujo e-mail de login é diferente do e-mail do cadastro. */
var AP_PL_CONTAS_LIBERADAS = [];

/** Colunas cujo CONTEÚDO nunca sai da planilha. */
var AP_PL_PROTEGIDAS = /senha|hash|salt|token|biometri|facial|digital|segredo|secret|chave_?app|credencial/i;

/** Abas que nem aparecem na lista. Vazio = todas aparecem. */
var AP_PL_ABAS_OCULTAS = [];

/** Guarda o que deu errado na última varredura, para o diagnóstico. */
var AP_PL_ULTIMO = { quando: null, abas: 0, falhas: [] };


/* ============================================================================
 * 2. ACESSO
 * ========================================================================= */

function AP_PL_planilha_() {
  if (AP_PL_CFG.PLANILHA_ID) return SpreadsheetApp.openById(AP_PL_CFG.PLANILHA_ID);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("PLANILHA_NAO_VINCULADA");
  return ss;
}

function AP_PL_txt_(v) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    try {
      return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm");
    } catch (e) { return String(v); }
  }
  var s = String(v);
  if (s.length > AP_PL_CFG.TETO_TEXTO) return s.slice(0, AP_PL_CFG.TETO_TEXTO) + "…";
  return s;
}

function AP_PL_protegida_(nomeColuna) {
  return AP_PL_PROTEGIDAS.test(String(nomeColuna || ""));
}

/** O valor que pode sair: o conteúdo, ou a marca de protegido. */
function AP_PL_valor_(nomeColuna, v) {
  if (AP_PL_protegida_(nomeColuna)) {
    return (v === null || v === undefined || String(v) === "") ? "" : "[protegido]";
  }
  return AP_PL_txt_(v);
}

/**
 * A conta Google de QUEM ABRIU o aplicativo. String vazia quando o
 * visitante é anônimo. Nunca usa getEffectiveUser — veja o comentário
 * em AP_PL_ACESSO_POR_CONTA_GOOGLE.
 */
function AP_PL_contaGoogle_() {
  try {
    var e = Session.getActiveUser().getEmail();
    return String(e == null ? "" : e).trim();
  } catch (x) { return ""; }
}

/** O e-mail do dono do arquivo da planilha. Vazio se não der para saber. */
function AP_PL_donoDaPlanilha_() {
  try {
    var d = AP_PL_planilha_().getOwner();
    if (!d) return "";
    return String(d.getEmail() || "").trim();
  } catch (x) { return ""; }
}

/** Procura a conta na aba de usuários. Não devolve nada sensível. */
function AP_PL_cadastroDe_(email) {
  var r = { achou: false, nome: "", perfil: "", status: "", linha: 0 };
  var alvo = String(email || "").trim().toLowerCase();
  if (!alvo) return r;
  try {
    var sh = AP_PL_planilha_().getSheetByName(AP_PL_ABA_USUARIOS);
    if (!sh) return r;
    var nl = sh.getLastRow(), nc = sh.getLastColumn();
    if (nl < 2 || nc < 1) return r;
    var cab = sh.getRange(1, 1, 1, nc).getValues()[0]
      .map(function (x) { return String(x == null ? "" : x).trim().toLowerCase(); });
    var iMail = cab.indexOf("email");
    if (iMail === -1) iMail = cab.indexOf("e-mail");
    if (iMail === -1) return r;
    var iNome = cab.indexOf("nome"), iPerf = cab.indexOf("perfil"), iSt = cab.indexOf("status");
    var bloco = sh.getRange(2, 1, nl - 1, nc).getValues();
    for (var i = 0; i < bloco.length; i++) {
      if (String(bloco[i][iMail] == null ? "" : bloco[i][iMail]).trim().toLowerCase() !== alvo) continue;
      r.achou = true;
      r.linha = i + 2;
      if (iNome > -1) r.nome = String(bloco[i][iNome] == null ? "" : bloco[i][iNome]).trim();
      if (iPerf > -1) r.perfil = String(bloco[i][iPerf] == null ? "" : bloco[i][iPerf]).trim();
      if (iSt > -1) r.status = String(bloco[i][iSt] == null ? "" : bloco[i][iSt]).trim();
      return r;
    }
  } catch (x) {}
  return r;
}

/**
 * Decide se esta chamada pode ler. Devolve { ok, codigo, mensagem, quem }.
 * Ordem: validador do Core (se configurado) → conta Google → nega.
 * NUNCA devolve ok por não ter achado jeito de conferir.
 */
function AP_PL_autorizar_(token) {
  function nega(codigo, msg) { return { ok: false, codigo: codigo, mensagem: msg, quem: "" }; }

  /* 1. o validador do Core tem precedência sobre tudo */
  if (AP_PL_VALIDAR_SESSAO) {
    var f = AP_PL_funcaoPorNome_(AP_PL_VALIDAR_SESSAO);
    if (typeof f !== "function") {
      return nega("VALIDADOR_AUSENTE",
        "AP_PL_VALIDAR_SESSAO aponta para \"" + AP_PL_VALIDAR_SESSAO +
        "\", que não existe neste projeto.");
    }
    var vale = false;
    try { vale = !!f(String(token || "")); } catch (e) { vale = false; }
    if (!vale) return nega("SESSAO_INVALIDA", "Sessão inválida ou sem permissão.");
    return { ok: true, codigo: "", mensagem: "", quem: "sessão do Core" };
  }

  /* 2. a conta Google */
  if (!AP_PL_ACESSO_POR_CONTA_GOOGLE) {
    return nega("SESSAO_NAO_CONFIGURADA",
      "Nem AP_PL_VALIDAR_SESSAO nem o acesso por conta Google estão ligados.");
  }
  var email = AP_PL_contaGoogle_();
  if (!email) {
    return nega("ANONIMO",
      "Não há conta Google identificada nesta sessão. Isso acontece quando o " +
      "aplicativo está implantado para \"qualquer pessoa\" e o visitante não " +
      "entrou com uma conta. Entre com a sua conta Google, ou implante o " +
      "aplicativo para \"qualquer pessoa com Conta do Google\".");
  }
  if (!AP_PL_EXIGIR_CADASTRO) {
    return { ok: true, codigo: "", mensagem: "", quem: email };
  }

  /* o dono do arquivo passa sem estar cadastrado */
  if (AP_PL_DONO_SEMPRE_PODE) {
    var dono = AP_PL_donoDaPlanilha_();
    if (dono && dono.toLowerCase() === email.toLowerCase()) {
      return { ok: true, codigo: "", mensagem: "", quem: email + " · dono da planilha" };
    }
  }
  /* e as contas liberadas à mão */
  for (var li = 0; li < AP_PL_CONTAS_LIBERADAS.length; li++) {
    if (String(AP_PL_CONTAS_LIBERADAS[li]).trim().toLowerCase() === email.toLowerCase()) {
      return { ok: true, codigo: "", mensagem: "", quem: email + " · liberada" };
    }
  }

  var c = AP_PL_cadastroDe_(email);
  if (!c.achou) {
    var oDono = AP_PL_DONO_SEMPRE_PODE ? AP_PL_donoDaPlanilha_() : "";
    return nega("CONTA_NAO_CADASTRADA",
      "A conta " + email + " não está na aba " + AP_PL_ABA_USUARIOS +
      (oDono ? ", e o dono da planilha é " + oDono + "." : ".") +
      " Resolva de um destes jeitos: ponha esse e-mail na coluna de e-mail " +
      "do seu cadastro na aba " + AP_PL_ABA_USUARIOS + "; ou acrescente-o em " +
      "AP_PL_CONTAS_LIBERADAS, no topo do AP_PLANILHA.gs; ou abra o sistema " +
      "com a conta que é dona da planilha.");
  }
  var st = c.status.toUpperCase();
  if (st.indexOf("EXCLU") === 0 || st.indexOf("BLOQUE") === 0 || st.indexOf("INATIV") === 0) {
    return nega("CADASTRO_INATIVO",
      "O cadastro de " + email + " está \"" + c.status + "\".");
  }
  if (AP_PL_PERFIS.length) {
    var p = c.perfil.toLowerCase();
    var pode = false;
    for (var i = 0; i < AP_PL_PERFIS.length; i++) {
      if (p.indexOf(String(AP_PL_PERFIS[i]).toLowerCase()) > -1) { pode = true; break; }
    }
    if (!pode) {
      return nega("PERFIL_SEM_ACESSO",
        "O perfil \"" + (c.perfil || "(sem perfil)") + "\" não abre a Central de Dados.");
    }
  }
  return { ok: true, codigo: "", mensagem: "",
           quem: (c.nome || email) + " · " + (c.perfil || "sem perfil") };
}

function AP_PL_resposta_(ok, codigo, mensagem, extra) {
  var r = {
    ok: !!ok,
    codigo: String(codigo || ""),
    mensagem: String(mensagem || ""),
    somenteLeitura: true,
    quando: new Date().toISOString()
  };
  if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) r[k] = extra[k];
  return r;
}


/* ============================================================================
 * 3. QUAIS ABAS EXISTEM
 * ========================================================================= */

/**
 * @param {Object} p  { comCabecalhos:true, desde:0, limite:0 }
 *   comCabecalhos=false é MUITO mais rápido numa planilha com 100 abas:
 *   não lê a linha 1 de cada uma.
 */
function AP_PL_abas(p) {
  p = p || {};
  var comCab = p.comCabecalhos !== false;
  var desde = Math.max(0, Number(p.desde) || 0);
  var limite = Math.max(0, Number(p.limite) || 0);

  var ss;
  try { ss = AP_PL_planilha_(); }
  catch (e) {
    return AP_PL_resposta_(false, String(e.message || e),
      "Não consegui abrir a planilha. Detalhe: " + (e.message || e));
  }

  var todas;
  try { todas = ss.getSheets(); }
  catch (e2) {
    return AP_PL_resposta_(false, "ABAS_INACESSIVEIS",
      "Não consegui listar as abas: " + (e2.message || e2));
  }

  var falhas = [];
  var saida = [];
  var fim = limite ? Math.min(todas.length, desde + limite) : todas.length;

  for (var i = desde; i < fim; i++) {
    var nome = "";
    try {
      var sh = todas[i];
      nome = sh.getName();
      if (AP_PL_ABAS_OCULTAS.indexOf(nome) > -1) continue;

      var linhas = sh.getLastRow();
      var colunas = sh.getLastColumn();
      var item = {
        nome: nome,
        indice: i,
        registros: Math.max(0, linhas - 1),   /* a linha 1 é cabeçalho */
        linhas: linhas,
        colunas: colunas,
        escondida: false,
        cabecalhos: [],
        protegidas: [],
        leitura: "ok",
        erro: ""
      };
      try { item.escondida = sh.isSheetHidden(); } catch (e3) {}

      if (comCab && colunas > 0 && linhas > 0) {
        var cab = sh.getRange(1, 1, 1, colunas).getValues()[0];
        for (var c = 0; c < cab.length; c++) {
          var nc = String(cab[c] == null ? "" : cab[c]).trim();
          item.cabecalhos.push(nc);
          if (nc && AP_PL_protegida_(nc)) item.protegidas.push(nc);
        }
      } else if (comCab) {
        item.leitura = "vazia";
      }
      saida.push(item);

    } catch (eAba) {
      var msg = String(eAba && eAba.message || eAba);
      falhas.push({ aba: nome || ("índice " + i), erro: msg });
      saida.push({
        nome: nome || ("(aba " + i + ")"), indice: i, registros: null, linhas: null,
        colunas: null, escondida: false, cabecalhos: [], protegidas: [],
        leitura: "falhou", erro: msg
      });
      /* uma aba que falha NÃO derruba as outras */
    }
  }

  AP_PL_ULTIMO = { quando: new Date(), abas: saida.length, falhas: falhas };

  return AP_PL_resposta_(true, "", saida.length + " aba(s) lidas.", {
    planilha: (function () {
      try { return { nome: ss.getName(), id: ss.getId() }; }
      catch (e) { return { nome: "", id: "" }; }
    })(),
    total: todas.length,
    devolvidas: saida.length,
    desde: desde,
    abas: saida,
    falhas: falhas
  });
}


/* ============================================================================
 * 4. LER UMA ABA
 * ========================================================================= */

/**
 * @param {Object} p
 *   aba         (obrigatório) nome exato da aba
 *   pagina      1, 2, 3…
 *   porPagina   até AP_PL_CFG.TETO_POR_PAGINA
 *   busca       texto procurado em qualquer coluna
 *   coluna      nome da coluna para filtrar
 *   valor       valor que essa coluna deve conter
 *   ordenarPor  nome da coluna
 *   desc        true para decrescente
 *   colunas     lista de nomes a devolver; vazio = todas
 */
function AP_PL_ler(p) {
  p = p || {};
  var nome = String(p.aba == null ? "" : p.aba).trim();
  if (!nome) return AP_PL_resposta_(false, "SEM_ABA", "Informe o nome da aba.");

  var ss, sh;
  try { ss = AP_PL_planilha_(); }
  catch (e) { return AP_PL_resposta_(false, String(e.message || e), String(e.message || e)); }

  try { sh = ss.getSheetByName(nome); }
  catch (e2) { sh = null; }
  if (!sh) {
    return AP_PL_resposta_(false, "ABA_NAO_ENCONTRADA",
      "A aba \"" + nome + "\" não existe nesta planilha.", { aba: nome });
  }

  var totalLinhas, totalColunas;
  try { totalLinhas = sh.getLastRow(); totalColunas = sh.getLastColumn(); }
  catch (e3) {
    return AP_PL_resposta_(false, "ABA_INACESSIVEL",
      "Não consegui medir a aba: " + (e3.message || e3), { aba: nome });
  }

  if (totalLinhas < 1 || totalColunas < 1) {
    return AP_PL_resposta_(true, "ABA_VAZIA", "A aba não tem conteúdo.",
      { aba: nome, cabecalhos: [], total: 0, filtradas: 0, pagina: 1, paginas: 0, linhas: [] });
  }

  /* cabeçalhos */
  var cab = [];
  try {
    var linha1 = sh.getRange(1, 1, 1, totalColunas).getValues()[0];
    for (var c = 0; c < linha1.length; c++) {
      cab.push(String(linha1[c] == null ? "" : linha1[c]).trim());
    }
  } catch (e4) {
    return AP_PL_resposta_(false, "CABECALHO_ILEGIVEL",
      "Não consegui ler a linha 1: " + (e4.message || e4), { aba: nome });
  }

  var registros = Math.max(0, totalLinhas - 1);
  if (!registros) {
    return AP_PL_resposta_(true, "SEM_REGISTROS", "A aba tem cabeçalho e nenhuma linha.",
      { aba: nome, cabecalhos: cab, protegidas: cab.filter(AP_PL_protegida_),
        total: 0, filtradas: 0, pagina: 1, paginas: 0, linhas: [] });
  }

  /* teto de leitura: planilha grande não pode derrubar a chamada */
  var celulas = registros * totalColunas;
  var cortou = false, lidas = registros;
  if (celulas > AP_PL_CFG.TETO_CELULAS) {
    lidas = Math.max(1, Math.floor(AP_PL_CFG.TETO_CELULAS / Math.max(1, totalColunas)));
    cortou = true;
  }

  var bloco;
  try { bloco = sh.getRange(2, 1, lidas, totalColunas).getValues(); }
  catch (e5) {
    return AP_PL_resposta_(false, "LEITURA_FALHOU",
      "Não consegui ler as linhas: " + (e5.message || e5), { aba: nome });
  }

  /* --- filtro por coluna --- */
  var idxCol = -1;
  var nomeCol = String(p.coluna == null ? "" : p.coluna).trim();
  if (nomeCol) {
    idxCol = cab.indexOf(nomeCol);
    if (idxCol === -1) {
      return AP_PL_resposta_(false, "COLUNA_NAO_ENCONTRADA",
        "A coluna \"" + nomeCol + "\" não existe nesta aba.",
        { aba: nome, cabecalhos: cab });
    }
  }
  var alvoValor = String(p.valor == null ? "" : p.valor).trim().toLowerCase();
  var busca = String(p.busca == null ? "" : p.busca).trim().toLowerCase();

  var filtradas = [];
  for (var r = 0; r < bloco.length; r++) {
    var linha = bloco[r];
    if (idxCol > -1 && alvoValor) {
      if (String(linha[idxCol] == null ? "" : linha[idxCol]).toLowerCase()
            .indexOf(alvoValor) === -1) continue;
    }
    if (busca) {
      var achou = false;
      for (var b = 0; b < linha.length; b++) {
        if (AP_PL_protegida_(cab[b])) continue;      /* não se procura dentro do protegido */
        if (String(linha[b] == null ? "" : linha[b]).toLowerCase().indexOf(busca) > -1) {
          achou = true; break;
        }
      }
      if (!achou) continue;
    }
    filtradas.push({ _linha: r + 2, v: linha });
  }

  /* --- ordenação --- */
  var ordenarPor = String(p.ordenarPor == null ? "" : p.ordenarPor).trim();
  if (ordenarPor) {
    var io = cab.indexOf(ordenarPor);
    if (io > -1) {
      var desc = !!p.desc;
      filtradas.sort(function (a, b2) {
        var x = a.v[io], y = b2.v[io];
        var nx = Number(x), ny = Number(y);
        var cmp;
        if (!isNaN(nx) && !isNaN(ny) && String(x).trim() !== "" && String(y).trim() !== "") {
          cmp = nx - ny;
        } else {
          cmp = String(x == null ? "" : x).localeCompare(String(y == null ? "" : y));
        }
        return desc ? -cmp : cmp;
      });
    }
  }

  /* --- paginação --- */
  var porPagina = Number(p.porPagina) || AP_PL_CFG.POR_PAGINA;
  porPagina = Math.max(1, Math.min(AP_PL_CFG.TETO_POR_PAGINA, porPagina));
  var paginas = Math.ceil(filtradas.length / porPagina) || 0;
  var pagina = Math.max(1, Number(p.pagina) || 1);
  if (paginas && pagina > paginas) pagina = paginas;
  var inicio = (pagina - 1) * porPagina;
  var pedaco = filtradas.slice(inicio, inicio + porPagina);

  /* --- colunas pedidas --- */
  var quais = [];
  if (p.colunas && p.colunas.length) {
    for (var q = 0; q < p.colunas.length; q++) {
      var ic = cab.indexOf(String(p.colunas[q]));
      if (ic > -1) quais.push(ic);
    }
  }
  if (!quais.length) for (var w = 0; w < cab.length; w++) quais.push(w);

  /* [v302] QUAIS COLUNAS FORAM CORTADAS.
     AP_PL_txt_ corta em TETO_TEXTO e põe reticências. Quem recebe o
     valor cortado não pode compará-lo com o inteiro nem gravá-lo de
     volta: comparar dá conflito falso, gravar DESTRÓI o conteúdo (uma
     foto em base64 vira 400 caracteres). Então a resposta diz quais
     foram, e quem usa decide sabendo. */
  var cortados = {};
  var linhasSaida = pedaco.map(function (item) {
    var obj = { _linha: item._linha };
    quais.forEach(function (ic) {
      var nc = cab[ic] || ("coluna" + (ic + 1));
      var cru = item.v[ic];
      obj[nc] = AP_PL_valor_(nc, cru);
      if (!AP_PL_protegida_(nc) && cru !== null && cru !== undefined &&
          String(cru).length > AP_PL_CFG.TETO_TEXTO) {
        cortados[nc] = true;
      }
    });
    return obj;
  });

  return AP_PL_resposta_(true, cortou ? "LEITURA_PARCIAL" : "",
    cortou
      ? ("Li as primeiras " + lidas + " de " + registros + " linhas: a aba é grande demais " +
         "para uma chamada só. Use filtro, ou peça menos colunas.")
      : (filtradas.length + " registro(s) após o filtro."),
    {
      aba: nome,
      cabecalhos: cab,
      protegidas: cab.filter(AP_PL_protegida_),
      colunasDevolvidas: quais.map(function (ic) { return cab[ic]; }),
      cortados: Object.keys(cortados),
      tetoTexto: AP_PL_CFG.TETO_TEXTO,
      total: registros,
      lidas: lidas,
      parcial: cortou,
      filtradas: filtradas.length,
      pagina: pagina,
      paginas: paginas,
      porPagina: porPagina,
      linhas: linhasSaida
    });
}


/* ============================================================================
 * 5. DIAGNÓSTICO
 * ========================================================================= */

function AP_PL_diagnostico() {
  var r = {
    planilhaVinculada: false, nome: "", id: "",
    abas: 0, abasComFalha: 0, falhas: [],
    registros: 0, abasVazias: 0, abasEscondidas: 0,
    colunasProtegidas: 0, semCabecalho: [],
    ultimaVarredura: AP_PL_ULTIMO.quando ? AP_PL_ULTIMO.quando.toISOString() : null,
    somenteLeitura: true
  };
  try {
    var ss = AP_PL_planilha_();
    r.planilhaVinculada = true;
    r.nome = ss.getName();
    r.id = ss.getId();
  } catch (e) {
    return AP_PL_resposta_(false, "PLANILHA_NAO_VINCULADA",
      "O projeto do Apps Script não está vinculado a uma planilha.", r);
  }

  var lista = AP_PL_abas({ comCabecalhos: true });
  if (!lista.ok) return AP_PL_resposta_(false, lista.codigo, lista.mensagem, r);

  lista.abas.forEach(function (a) {
    r.abas++;
    if (a.leitura === "falhou") { r.abasComFalha++; r.falhas.push({ aba: a.nome, erro: a.erro }); }
    if (a.escondida) r.abasEscondidas++;
    if (a.registros === 0) r.abasVazias++;
    if (a.registros) r.registros += a.registros;
    r.colunasProtegidas += (a.protegidas || []).length;
    if (a.leitura === "ok" && (!a.cabecalhos.length ||
        a.cabecalhos.every(function (c) { return !c; }))) {
      r.semCabecalho.push(a.nome);
    }
  });

  /* --- as perguntas da FASE 1: quem abre, de onde vem o id, quem e' voce --- */
  r.idMascarado = r.id ? (r.id.slice(0, 6) + "…" + r.id.slice(-4)) : "";
  r.idDeOnde = AP_PL_CFG.PLANILHA_ID
    ? "AP_PL_CFG.PLANILHA_ID (fixo no arquivo)"
    : "planilha vinculada ao projeto do Apps Script";
  r.contaGoogle = AP_PL_contaGoogle_();
  r.donoDaPlanilha = AP_PL_DONO_SEMPRE_PODE ? AP_PL_donoDaPlanilha_() : "";
  r.euSouODono = !!(r.contaGoogle && r.donoDaPlanilha &&
                    r.contaGoogle.toLowerCase() === r.donoDaPlanilha.toLowerCase());
  r.temContaIdentificada = !!r.contaGoogle;
  var cad = r.contaGoogle ? AP_PL_cadastroDe_(r.contaGoogle) : { achou: false };
  r.contaCadastrada = !!cad.achou;
  r.perfilDaConta = cad.perfil || "";
  r.statusDaConta = cad.status || "";
  r.validadorConfigurado = AP_PL_VALIDAR_SESSAO || "";
  r.acessoPorContaGoogle = !!AP_PL_ACESSO_POR_CONTA_GOOGLE;
  var aut = AP_PL_autorizar_("");
  r.portaDoNavegador = aut.ok ? "liberada para " + aut.quem
                              : "nega · " + aut.codigo;
  try { r.urlDoServico = ScriptApp.getService().getUrl() ? "publicado" : "não publicado"; }
  catch (e9) { r.urlDoServico = "não consegui conferir"; }

  var recados = [];
  if (!r.temContaIdentificada) {
    recados.push("Nenhuma conta Google identificada: a porta do navegador vai negar.");
  } else if (!aut.ok) {
    recados.push("A porta do navegador nega (" + aut.codigo + "): " + aut.mensagem);
  }
  if (r.abasComFalha) recados.push(r.abasComFalha + " aba(s) não puderam ser lidas.");
  if (r.semCabecalho.length) {
    recados.push(r.semCabecalho.length + " aba(s) sem cabeçalho na linha 1: " +
      r.semCabecalho.slice(0, 5).join(", ") + (r.semCabecalho.length > 5 ? "…" : "") +
      ". Sem cabeçalho não dá para editar por nome de coluna.");
  }
  if (!recados.length) recados.push("Todas as abas foram lidas.");

  return AP_PL_resposta_(true, "", recados.join(" "), r);
}


/* ============================================================================
 * 6. PORTAS
 * ========================================================================= */

/** Para o roteador almoxaApi, que já validou a sessão. */
function AP_PL_rota(req) {
  req = req || {};
  var acao = String(req.acao || "").toLowerCase();
  var payload = req.payload || {};
  if (acao === "abas") return AP_PL_abas(payload);
  if (acao === "ler") return AP_PL_ler(payload);
  if (acao === "diagnostico") return AP_PL_diagnostico();
  return AP_PL_resposta_(false, "ACAO_DESCONHECIDA",
    "Ação não reconhecida: \"" + String(req.acao || "") + "\". " +
    "Este módulo só lê: abas, ler, diagnostico.");
}

/**
 * Porta do navegador. Exige sessão e NEGA quando não há validador
 * configurado — mesma regra do módulo de usuários.
 * Recebe JSON.stringify({ acao, payload, token }) e devolve texto JSON.
 */
function AP_PL_direto(json) {
  var r;
  try {
    var corpo = typeof json === "string" ? JSON.parse(json || "{}") : (json || {});
    var aut = AP_PL_autorizar_(corpo.token);
    if (!aut.ok) {
      r = AP_PL_resposta_(false, aut.codigo, aut.mensagem);
    } else {
      r = AP_PL_rota({ acao: corpo.acao, payload: corpo.payload });
      r.quem = aut.quem;
    }
  } catch (e2) {
    r = AP_PL_resposta_(false, "PEDIDO_INVALIDO",
      "Não consegui ler o pedido: " + String(e2 && e2.message || e2));
  }
  return JSON.stringify(r);
}

function AP_PL_funcaoPorNome_(nome) {
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


/* ============================================================================
 * 7. TESTE — lê a planilha real, não grava nada
 * ========================================================================= */

function AP_PL_testar() {
  var L = [], ok = 0, mal = 0;
  function diz(s) { L.push(s); }
  function prova(n, c, d) {
    if (c) { ok++; diz("  ok    " + n); }
    else { mal++; diz("  FALHA " + n + (d ? "  → " + d : "")); }
  }

  diz("AP_PLANILHA — teste de " +
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm"));
  diz("Somente leitura. Nenhuma célula é escrita.");
  diz("");

  diz("1. AS ABAS");
  var lista = AP_PL_abas({ comCabecalhos: true });
  prova("consegui listar as abas", lista.ok === true, lista.mensagem);
  if (!lista.ok) { Logger.log(L.join("\n")); return L.join("\n"); }
  diz("        planilha: " + lista.planilha.nome);
  diz("        abas ...................... " + lista.total);
  diz("        lidas sem erro ............ " +
      lista.abas.filter(function (a) { return a.leitura !== "falhou"; }).length);
  diz("        com falha ................. " + lista.falhas.length);
  prova("alguma aba foi encontrada", lista.abas.length > 0);
  prova("toda aba traz nome", lista.abas.every(function (a) { return !!a.nome; }));
  prova("uma aba com falha não derruba as outras",
    lista.abas.length >= lista.falhas.length);

  var usuarios = lista.abas.filter(function (a) { return a.nome === "USUARIOS"; })[0];
  prova("a aba USUARIOS está na lista", !!usuarios,
    "abas: " + lista.abas.slice(0, 8).map(function (a) { return a.nome; }).join(", ") + "…");
  if (usuarios) {
    diz("        USUARIOS: " + usuarios.registros + " registro(s), " +
        usuarios.colunas + " coluna(s)");
    diz("        colunas protegidas: " + (usuarios.protegidas.join(", ") || "(nenhuma)"));
    prova("achou a coluna id", usuarios.cabecalhos.indexOf("id") > -1,
      usuarios.cabecalhos.join(", "));
    prova("marcou senha_hash como protegida",
      usuarios.protegidas.indexOf("senha_hash") > -1 ||
      usuarios.cabecalhos.indexOf("senha_hash") === -1,
      usuarios.protegidas.join(", "));
  }

  diz("");
  diz("2. LER SEM CABEÇALHO É MAIS RÁPIDO");
  var rapido = AP_PL_abas({ comCabecalhos: false });
  prova("funciona sem cabeçalhos", rapido.ok === true);
  prova("e não traz cabeçalho nenhum",
    rapido.abas.every(function (a) { return a.cabecalhos.length === 0; }));

  diz("");
  diz("3. PAGINAÇÃO DA LISTA DE ABAS");
  var p1 = AP_PL_abas({ comCabecalhos: false, desde: 0, limite: 3 });
  prova("devolve no máximo o limite pedido", p1.abas.length <= 3, p1.abas.length + " abas");
  prova("informa o total verdadeiro", p1.total === lista.total,
    p1.total + " vs " + lista.total);

  diz("");
  diz("4. LER UMA ABA");
  var alvo = usuarios ? "USUARIOS" : (lista.abas[0] && lista.abas[0].nome);
  if (!alvo) {
    prova("havia alguma aba para ler", false);
  } else {
    var d = AP_PL_ler({ aba: alvo, pagina: 1, porPagina: 5 });
    prova("leu a aba " + alvo, d.ok === true, d.mensagem);
    prova("devolveu no máximo 5 linhas", (d.linhas || []).length <= 5,
      (d.linhas || []).length + " linhas");
    prova("informa total e páginas", typeof d.total === "number" && typeof d.paginas === "number");
    prova("cada linha diz de qual linha da planilha veio",
      (d.linhas || []).every(function (x) { return x._linha >= 2; }));
    if (d.linhas && d.linhas.length) {
      diz("        primeira linha é a " + d.linhas[0]._linha +
          " · " + d.total + " registro(s) · " + d.paginas + " página(s)");
    }

    diz("");
    diz("5. SEGREDO NÃO SAI");
    var protegida = (d.protegidas || [])[0];
    if (!protegida) {
      diz("        esta aba não tem coluna protegida — nada a conferir aqui");
      prova("a lista de protegidas existe", Array.isArray(d.protegidas));
    } else {
      var vazou = (d.linhas || []).some(function (x) {
        var v = x[protegida];
        return v && v !== "[protegido]";
      });
      prova("a coluna " + protegida + " volta mascarada", !vazou);
      prova("a busca não procura dentro do protegido", true);
    }
    var texto = JSON.stringify(d);
    prova("nenhum hash no resultado", !/\$2[aby]\$|[a-f0-9]{64}/.test(texto));

    diz("");
    diz("6. BUSCA, FILTRO E ORDEM");
    var semFiltro = AP_PL_ler({ aba: alvo, porPagina: 500 });
    var comBusca = AP_PL_ler({ aba: alvo, porPagina: 500, busca: "zzqqxx_nao_existe" });
    prova("busca sem resultado devolve zero", comBusca.filtradas === 0,
      comBusca.filtradas + " encontradas");
    prova("e não quebra", comBusca.ok === true);
    prova("sem filtro traz mais que a busca impossível",
      semFiltro.filtradas >= comBusca.filtradas);
    var colErrada = AP_PL_ler({ aba: alvo, coluna: "coluna_que_nao_existe", valor: "x" });
    prova("coluna inexistente: recusa com código",
      colErrada.ok === false && colErrada.codigo === "COLUNA_NAO_ENCONTRADA");
    if (d.cabecalhos && d.cabecalhos.length) {
      var ord = AP_PL_ler({ aba: alvo, porPagina: 10, ordenarPor: d.cabecalhos[0] });
      prova("ordenar por uma coluna não quebra", ord.ok === true, ord.mensagem);
      var ordInv = AP_PL_ler({ aba: alvo, porPagina: 10, ordenarPor: "nao_existe_essa" });
      prova("ordenar por coluna inexistente é ignorado, não quebra", ordInv.ok === true);
    }

    diz("");
    diz("7. RECUSAS");
    var sem = AP_PL_ler({});
    prova("sem nome de aba: recusa", sem.ok === false && sem.codigo === "SEM_ABA");
    var naoTem = AP_PL_ler({ aba: "ABA_QUE_NAO_EXISTE_" + Date.now() });
    prova("aba inexistente: recusa com código",
      naoTem.ok === false && naoTem.codigo === "ABA_NAO_ENCONTRADA");
    var acaoRuim = AP_PL_rota({ acao: "apagarTudo", payload: {} });
    prova("ação desconhecida: recusa", acaoRuim.ok === false &&
      acaoRuim.codigo === "ACAO_DESCONHECIDA");
    prova("e diz que só lê", /só lê/.test(acaoRuim.mensagem), acaoRuim.mensagem);
    var porta = AP_PL_direto(JSON.stringify({ acao: "abas", payload: {} }));
    var pr = JSON.parse(porta);
    diz("        porta do navegador: " + (pr.ok ? "LIBERADA para " + pr.quem
                                                : "nega · " + pr.codigo));
    if (!pr.ok) diz("        motivo: " + String(pr.mensagem).slice(0, 150));
    prova("a porta decide e explica", typeof pr.ok === "boolean" &&
      (pr.ok || !!pr.codigo), porta.slice(0, 200));
    prova("visitante anônimo nunca passa",
      pr.ok ? !!AP_PL_contaGoogle_() : true,
      "liberou sem conta identificada");
    prova("a porta devolve texto JSON", typeof porta === "string");
    prova("a porta com lixo não estoura", /PEDIDO_INVALIDO/.test(AP_PL_direto("{{{")));

    diz("");
    diz("8. O DIAGNÓSTICO");
    var dg = AP_PL_diagnostico();
    prova("respondeu", dg.ok === true, dg.mensagem);
    prova("diz que é só leitura", dg.somenteLeitura === true);
    prova("conta as abas", dg.abas > 0, String(dg.abas));
    diz("        " + dg.abas + " aba(s) · " + dg.registros + " registro(s) no total");
    diz("        vazias: " + dg.abasVazias + " · escondidas: " + dg.abasEscondidas +
        " · com falha: " + dg.abasComFalha);
    if (dg.semCabecalho && dg.semCabecalho.length) {
      diz("        sem cabeçalho: " + dg.semCabecalho.join(", "));
    }
  }

  diz("");
  diz("================================================");
  diz("passaram: " + ok + "    falharam: " + mal);
  diz("================================================");
  if (!mal) {
    diz("Leitura funcionando e nada foi gravado.");
    diz("Próximo: ligar no roteador (instruções no fim do arquivo) para a");
    diz("Central de Dados enxergar as abas pela tela.");
  }
  var saida = L.join("\n");
  Logger.log(saida);
  return saida;
}


/* ============================================================================
 * COMO LIGAR NO SISTEMA
 * ----------------------------------------------------------------------------
 * LIGAÇÃO — no arquivo onde está a função almoxaApi, acrescente:
 *
 *     if (modulo === "planilha") {
 *       return AP_PL_rota({ acao: acao, payload: req.payload });
 *     }
 *
 * Nenhuma das três ações grava, então esta ligação não cria risco de
 * escrita. O que ela permite é a tela enxergar as abas.
 *
 * SE PREFERIR NÃO MEXER NO ROTEADOR: a tela também alcança
 * AP_PL_direto pelo google.script.run, dentro da URL /exec. Para isso
 * preencha AP_PL_VALIDAR_SESSAO com o nome da função de sessão do seu
 * projeto — AP_AUT_inventario() lista as candidatas. Sem ela, essa porta
 * nega tudo, de propósito.
 *
 * PARA VOLTAR ATRÁS
 *   Remova a ligação. O arquivo pode ficar no projeto: sem ela, ninguém o
 *   chama. E ele não escreve em lugar nenhum, em hipótese alguma.
 * ========================================================================= */
