/* ============================================================================
 * ALMOX-PRO — BOOTSYNC
 * Arquivo próprio. Sobe na mesma pasta do index.html.
 * Contrato: bootsync.v1   ·   fala com o módulo versao.v1 do servidor
 * ============================================================================
 *
 * O PROBLEMA, NAS PALAVRAS DELE
 *   "O sistema volta para a tela azul antiga depois que eu fecho, atualizo
 *    ou abro outra aba."
 *
 * A CAUSA, EM UMA FRASE
 *   O mesmo sistema é servido de mais de um endereço, e cada endereço
 *   entrega a cópia que tem. Uma delas é velha. O navegador não tem como
 *   saber disso: ele abre o que o endereço mandou e pronto.
 *
 * O QUE ESTE ARQUIVO FAZ
 *   Roda na abertura, ANTES de liberar o Dashboard, e responde três
 *   perguntas que ninguém estava fazendo:
 *     1. de ONDE esta página veio?
 *     2. QUAL versão ela é?
 *     3. qual é a versão OFICIAL, segundo o servidor?
 *   Se a daqui for mais velha, ele avisa e oferece a atualização. Se o
 *   servidor não responder, ele NÃO troca nada: segue com o que está
 *   carregado e diz que não deu para confirmar.
 *
 * O QUE ELE NÃO FAZ — e isto é a parte importante
 *   · NÃO troca o Dashboard por tela nenhuma. Nem de fallback, nem de erro.
 *     Falha de rede não pode virar "tela antiga".
 *   · NÃO deixa uma cópia local antiga valer mais que uma publicação nova.
 *     O local serve para SOBREVIVER à queda, nunca para vencer a oficial.
 *   · NÃO apaga dado de negócio para atualizar arquivo visual. Ele só
 *     escreve DUAS chaves no navegador, as duas sobre versão.
 *   · NÃO baixa nem executa arquivo achado em lugar nenhum. Ele compara
 *     textos e, no máximo, recarrega a própria página pelo endereço oficial.
 *   · NÃO decide hospedagem, NÃO mexe no doGet, NÃO cria outro Core.
 *   · NÃO mexe na configuração visual: aparência é do módulo de
 *     sincronização visual, e versão é deste aqui. Separados de propósito,
 *     porque publicar uma cor não é publicar um sistema.
 *
 * ONDE PROCURAR ERRO (no console do navegador)
 *   BOOTSYNC.diagnostico()   o retrato inteiro
 *   BOOTSYNC.estado          EM_DIA · ATRASADO · ADIANTADO · SEM_MANIFESTO
 *                            · SEM_RESPOSTA · DESLIGADO
 * ============================================================================ */
(function bootSync() {
  "use strict";

  if (typeof window === "undefined") return;
  if (window.BOOTSYNC) return;          /* nunca dois */

  var CONTRATO = "bootsync.v1";

  /* as DUAS únicas coisas que ele guarda no navegador. Nenhuma delas é
     fonte oficial de nada: são lembrança, para sobreviver a uma queda de
     rede e para não repetir aviso que ele já deu. */
  var CH_ULTIMA = "almoxa_bootsync_ultima";   /* último manifesto confirmado */
  var CH_AVISO  = "almoxa_bootsync_aviso";    /* versão sobre a qual já avisei */

  var PRAZO = 6000;        /* o servidor tem 6s. Depois disso o sistema abre
                              assim mesmo: foto e versão nunca prendem tela. */

  var B = {
    contrato: CONTRATO,
    estado: "DESLIGADO",
    versaoLocal: "",
    versaoOficial: "",
    numeroLocal: 0,
    numeroOficial: 0,
    origem: "",
    tipoDeOrigem: "",
    enderecoOficial: "",
    confirmadoEm: "",
    ultimaConfirmada: null,
    erro: null,
    ms: 0,
    avisou: false
  };
  window.BOOTSYNC = B;

  /* ------------------------------------------------------------------
     peças pequenas
     ------------------------------------------------------------------ */
  function lp(v) { return String(v === undefined || v === null ? "" : v).trim(); }

  function numeroDe(versao) {
    var m = lp(versao).match(/(\d{1,6})/);
    return m ? Number(m[1]) : 0;
  }

  function guardar(chave, valor) {
    try { window.localStorage.setItem(chave, JSON.stringify(valor)); } catch (e) {}
  }
  function lembrar(chave) {
    try {
      var t = window.localStorage.getItem(chave);
      return t ? JSON.parse(t) : null;
    } catch (e) { return null; }
  }

  /* DE ONDE ESTA PÁGINA VEIO.
     É a pergunta que ninguém estava fazendo, e é a que explica a tela
     antiga: /exec é o Apps Script devolvendo HTML; github.io é a
     hospedagem do front; file:// é uma cópia solta no computador; e o
     APK aparece como webview do Android. */
  function deOndeViemos() {
    var href = "", prot = "", host = "";
    try { href = lp(location.href); prot = lp(location.protocol); host = lp(location.hostname); } catch (e) {}
    var tipo = "desconhecida";
    if (/^file:/i.test(prot)) tipo = "arquivo solto no computador";
    else if (/script\.google\.com/i.test(host)) tipo = "/exec do Apps Script (o servidor devolvendo HTML)";
    else if (/googleusercontent\.com/i.test(host)) tipo = "quadro interno do Apps Script";
    else if (/github\.io$/i.test(host)) tipo = "hospedagem do front-end (GitHub Pages)";
    else if (/^localhost$|^127\./i.test(host)) tipo = "cópia local de teste";
    else if (prot) tipo = "hospedagem " + host;
    var apk = false;
    try { apk = / wv\)|\bwv\b/.test(navigator.userAgent || "") || !!window.AndroidALMOXA; } catch (e) {}
    if (apk) tipo += " · dentro do aplicativo";
    /* o endereço vai para o relatório sem a parte depois do "?": ali pode
       haver token de link direto, e token não entra em registro */
    var limpo = href.split("?")[0].split("#")[0];
    return { endereco: limpo, tipo: tipo, apk: apk, host: host, protocolo: prot };
  }

  function perguntarAoServidor() {
    /* uso a API que já existe. Não abro conexão própria, não invento
       endereço e não falo com o Drive. */
    if (typeof API === "undefined" || !API || typeof API.call !== "function") {
      return Promise.resolve({ ok: false, codigo: "SEM_API",
        mensagem: "a API do sistema ainda não estava pronta" });
    }
    var pedido;
    try { pedido = Promise.resolve(API.call("versao", "manifesto", {})); }
    catch (e) {
      return Promise.resolve({ ok: false, codigo: "ESTOUROU", mensagem: lp(e && e.message) });
    }
    /* prazo: o sistema não espera o servidor para abrir */
    return new Promise(function (pronto) {
      var acabou = false;
      var relogio = setTimeout(function () {
        if (acabou) return;
        acabou = true;
        pronto({ ok: false, codigo: "DEMOROU",
          mensagem: "o servidor não respondeu em " + PRAZO + "ms" });
      }, PRAZO);
      pedido.then(function (r) {
        if (acabou) return;
        acabou = true; clearTimeout(relogio); pronto(r);
      })["catch"](function (e) {
        if (acabou) return;
        acabou = true; clearTimeout(relogio);
        pronto({ ok: false, codigo: "SEM_RESPOSTA", mensagem: lp(e && e.message) });
      });
    });
  }

  function contarAoServidor(resultado) {
    try {
      if (typeof API === "undefined" || !API.call) return;
      API.call("versao", "registrar", {
        versaoLocal: B.versaoLocal, versaoOficial: B.versaoOficial,
        origem: B.origem, resultado: resultado, erro: lp(B.erro)
      });
    } catch (e) {}
  }

  /* ------------------------------------------------------------------
     A BARRA DE AVISO
     ------------------------------------------------------------------
     Aparece só quando a página carregada é mais VELHA que a oficial, e
     uma vez por versão: aviso que volta toda hora vira paisagem.
     Ela não cobre a tela, não bloqueia nada e sai com um clique.
     ------------------------------------------------------------------ */
  function mostrarBarra() {
    if (document.getElementById("bootsyncBarra")) return;
    var d = document.createElement("div");
    d.id = "bootsyncBarra";
    d.setAttribute("role", "status");
    d.style.cssText = "position:fixed;left:0;right:0;top:0;z-index:4000;" +
      "background:#0B2A55;color:#fff;font:14px/1.45 Segoe UI,system-ui,sans-serif;" +
      "padding:10px 14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;" +
      "box-shadow:0 2px 14px rgba(0,0,0,.25)";
    var oficial = B.versaoOficial || "a oficial";
    d.innerHTML =
      '<b style="font-weight:700">Esta tela é de uma versão antiga</b>' +
      '<span style="opacity:.9">carregada: ' + escapar(B.versaoLocal || "sem versão") +
      " · oficial: " + escapar(oficial) + "</span>" +
      '<span style="flex:1 1 auto"></span>' +
      '<button id="bootsyncAtualizar" style="background:#F08A1C;color:#fff;border:0;' +
      'border-radius:8px;padding:9px 16px;font-weight:700;cursor:pointer">Atualizar agora</button>' +
      '<button id="bootsyncDepois" style="background:none;border:1px solid rgba(255,255,255,.4);' +
      'color:#fff;border-radius:8px;padding:9px 14px;cursor:pointer">Depois</button>';
    document.body.appendChild(d);
    /* a barra não pode tapar o topo do sistema */
    try {
      var alt = d.getBoundingClientRect().height;
      document.body.style.paddingTop = alt + "px";
    } catch (e) {}
    document.getElementById("bootsyncDepois").addEventListener("click", function () {
      guardar(CH_AVISO, B.versaoOficial);
      tirarBarra();
    });
    document.getElementById("bootsyncAtualizar").addEventListener("click", function () {
      B.atualizar();
    });
  }

  function tirarBarra() {
    var d = document.getElementById("bootsyncBarra");
    if (d && d.parentNode) d.parentNode.removeChild(d);
    try { document.body.style.paddingTop = ""; } catch (e) {}
  }

  function escapar(s) {
    return lp(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /* ATUALIZAR = buscar de novo, sem cache, no endereço OFICIAL.
     Se esta página veio de outro endereço, ir para o oficial é a correção
     de verdade — recarregar o endereço errado só traz a cópia velha de
     novo. Nenhum arquivo é baixado por fora: quem busca é o navegador,
     pelo endereço que o servidor registrou. */
  B.atualizar = function () {
    var destino = "";
    try {
      var oficial = lp(B.enderecoOficial);
      var aqui = lp(location.href).split("?")[0].split("#")[0];
      var mesmoLugar = oficial && aqui.indexOf(oficial.replace(/\/+$/, "")) === 0;
      destino = (oficial && !mesmoLugar) ? oficial : aqui;
      var sep = destino.indexOf("?") > -1 ? "&" : "?";
      destino += sep + "v=" + encodeURIComponent(B.versaoOficial || String(Date.now()));
    } catch (e) { destino = ""; }
    try {
      if (destino) location.replace(destino);
      else location.reload(true);
    } catch (e) {
      try { location.reload(); } catch (x) {}
    }
  };

  /* ------------------------------------------------------------------
     A CONFERÊNCIA
     ------------------------------------------------------------------ */
  B.iniciar = function (opcoes) {
    opcoes = opcoes || {};
    var comecou = Date.now();

    var de = deOndeViemos();
    B.origem = de.endereco;
    B.tipoDeOrigem = de.tipo;
    B.versaoLocal = lp(window.ALMOXA_VERSAO);
    B.numeroLocal = numeroDe(B.versaoLocal);
    B.ultimaConfirmada = lembrar(CH_ULTIMA);

    return perguntarAoServidor().then(function (r) {
      B.ms = Date.now() - comecou;

      /* 1 · SEM RESPOSTA — e aqui mora a regra mais importante dele:
         nada acontece. O sistema segue com o que está carregado, e eu
         digo que não deu para confirmar. Falha de rede nunca pode virar
         troca de tela. */
      if (!r || r.ok !== true) {
        B.estado = (r && r.codigo === "NADA_PUBLICADO") ? "SEM_MANIFESTO" : "SEM_RESPOSTA";
        B.erro = lp(r && (r.mensagem || r.codigo)) || "o servidor não respondeu";
        if (B.ultimaConfirmada) {
          /* a última confirmada serve para DIZER o que se sabia, não para
             mandar em nada */
          B.versaoOficial = lp(B.ultimaConfirmada.versao);
          B.numeroOficial = Number(B.ultimaConfirmada.numero) || 0;
          B.enderecoOficial = lp(B.ultimaConfirmada.enderecoOficial);
        }
        return B;
      }

      var m = r.dados || {};
      B.versaoOficial = lp(m.versao);
      B.numeroOficial = Number(m.numero) || numeroDe(m.versao);
      B.enderecoOficial = lp(m.enderecoOficial);
      B.confirmadoEm = new Date().toISOString();
      B.erro = null;

      /* 2 · guardar a última confirmada. É cópia de SOBREVIVÊNCIA: só
         vale quando o servidor está fora, e nunca vence uma resposta. */
      guardar(CH_ULTIMA, {
        versao: B.versaoOficial, numero: B.numeroOficial,
        enderecoOficial: B.enderecoOficial, selo: lp(m.selo),
        confirmadoEm: B.confirmadoEm
      });

      /* 3 · comparar idades */
      if (!B.numeroLocal || !B.numeroOficial) {
        B.estado = (lp(B.versaoLocal) === lp(B.versaoOficial)) ? "EM_DIA" : "SEM_MANIFESTO";
      } else if (B.numeroLocal === B.numeroOficial) {
        B.estado = "EM_DIA";
      } else if (B.numeroLocal < B.numeroOficial) {
        B.estado = "ATRASADO";
      } else {
        /* a página é MAIS NOVA que o manifesto. Acontece quando alguém
           publica o arquivo e esquece de registrar a versão. Não é erro
           da página — e principalmente: NÃO é motivo para trocar nada
           por uma cópia antiga. */
        B.estado = "ADIANTADO";
      }

      if (B.estado === "ATRASADO" && !opcoes.calado) {
        var jaAvisei = lp(lembrar(CH_AVISO));
        if (jaAvisei !== B.versaoOficial) {
          B.avisou = true;
          try { mostrarBarra(); } catch (e) {}
        }
      }

      contarAoServidor(B.estado);
      return B;
    })["catch"](function (e) {
      B.estado = "SEM_RESPOSTA";
      B.erro = lp(e && e.message) || "falhou sem dizer por quê";
      B.ms = Date.now() - comecou;
      return B;
    });
  };

  /* ------------------------------------------------------------------
     O DIAGNÓSTICO (§8) — restrito: só aparece para quem está dentro
     ------------------------------------------------------------------ */
  B.diagnostico = function () {
    return {
      contrato: CONTRATO,
      estado: B.estado,
      oQueIssoQuerDizer: {
        EM_DIA: "esta tela é a versão oficial",
        ATRASADO: "esta tela é mais velha que a oficial — é a tela antiga voltando",
        ADIANTADO: "esta tela é mais nova que a registrada; falta registrar a versão",
        SEM_MANIFESTO: "o servidor não tem versão oficial registrada",
        SEM_RESPOSTA: "não deu para confirmar; segui com o que estava carregado",
        DESLIGADO: "a conferência ainda não rodou"
      }[B.estado] || "",
      versaoLocal: B.versaoLocal || "(a página não diz qual versão é)",
      versaoOficial: B.versaoOficial || "(não sei)",
      origem: B.origem,
      tipoDeOrigem: B.tipoDeOrigem,
      enderecoOficial: B.enderecoOficial || "(não registrado)",
      ultimaSincronizacaoConfirmada: B.confirmadoEm ||
        (B.ultimaConfirmada && B.ultimaConfirmada.confirmadoEm) || "nenhuma",
      guardadoNesteNavegador: B.ultimaConfirmada || "nada",
      demorou: B.ms + "ms",
      erro: B.erro,
      avisouNaTela: B.avisou
    };
  };

  /* texto pronto para a tela do Doutor do Sistema */
  B.resumo = function () {
    var d = B.diagnostico();
    return [
      "Versão carregada : " + d.versaoLocal,
      "Versão oficial   : " + d.versaoOficial,
      "Situação         : " + d.estado + " — " + d.oQueIssoQuerDizer,
      "Esta página veio : " + d.tipoDeOrigem,
      "                   " + d.origem,
      "Endereço oficial : " + d.enderecoOficial,
      "Última confirmada: " + d.ultimaSincronizacaoConfirmada,
      d.erro ? "Erro             : " + d.erro : ""
    ].filter(Boolean).join("\n");
  };

  /* esquecer a lembrança local — não apaga nada de negócio */
  B.esquecer = function () {
    try {
      window.localStorage.removeItem(CH_ULTIMA);
      window.localStorage.removeItem(CH_AVISO);
    } catch (e) {}
    B.ultimaConfirmada = null;
    return "a lembrança de versão deste navegador foi apagada. Nenhum dado do sistema foi tocado.";
  };
})();
