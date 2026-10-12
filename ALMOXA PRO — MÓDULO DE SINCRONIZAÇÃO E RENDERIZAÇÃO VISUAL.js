/* ============================================================================
 * ALMOXA PRO — MÓDULO DE SINCRONIZAÇÃO E RENDERIZAÇÃO VISUAL
 * ============================================================================
 * Arquivo próprio. Vai ao lado do index.html, no mesmo lugar, e o index.html
 * o carrega com <script src="ALMOXA_PRO_Sincronizacao_Visual.js"></script>.
 * Se este arquivo faltar, o sistema continua funcionando como antes — só sem
 * a proteção que ele dá.
 *
 * Contrato: sincvisual.v1
 *
 * ----------------------------------------------------------------------------
 * A CAUSA, ACHADA E MEDIDA ANTES DE ESCREVER UMA LINHA
 * ----------------------------------------------------------------------------
 * "A publicação aparece, some depois de uma lentidão do Core, e a tela volta
 * para a versão antiga."
 *
 * A culpa era de uma linha só, na leitura da configuração:
 *
 *     painelCfg.publico = r.config || null;
 *
 * Quando o Core respondia ok:true mas com a configuração incompleta — que é o
 * que ele faz sob carga, ou quando devolve um padrão —, "r.config" vinha vazio
 * e essa linha APAGAVA DA MEMÓRIA a publicação que estava no ar. Logo em
 * seguida outro trecho preenchia o buraco com a configuração de fábrica, e
 * aí a tela voltava ao visual antigo parecendo que era o certo.
 *
 * Medido, com o Core respondendo de quatro jeitos diferentes:
 *
 *   Core respondendo        versão antes    versão depois   cores
 *   ----------------------  -------------   -------------   -----------------
 *   {} (vazio)              1               0               ficaram (por sorte)
 *   configuração parcial    1               0               APAGADAS
 *   campo com lixo          1               0               ficaram (por sorte)
 *   ok:false (recusa)       1               1               ficaram  <- este já
 *                                                                      estava certo
 *
 * Repare na última linha: quando o Core RECUSA, o sistema já segurava. O
 * problema era justamente o Core responder "sim" com a resposta pela metade —
 * e esse caso ninguém estava conferindo.
 *
 * ----------------------------------------------------------------------------
 * A REGRA QUE ESTE MÓDULO IMPÕE
 * ----------------------------------------------------------------------------
 * Uma resposta do servidor só substitui o que está na tela quando ela é
 * VÁLIDA e NÃO É MAIS VELHA do que a que já está confirmada. Fora disso, o
 * que está confirmado FICA, e o módulo diz por quê.
 *
 * O cache aqui é cópia de apoio, nunca a fonte oficial: ele serve para a tela
 * não piscar nem esvaziar enquanto o servidor não responde, e some assim que
 * chega uma resposta boa.
 *
 * ----------------------------------------------------------------------------
 * OS SEIS COMPONENTES (seção 2 do pedido)
 * ----------------------------------------------------------------------------
 *   1. VisualVersionManager   SV.versao    compara versões e revisões
 *   2. VisualCacheManager     SV.cache     guarda a última versão confirmada
 *   3. VisualRenderService    SV.render    redesenha só o que mudou
 *   4. VisualRecoveryService  SV.recupera  devolve o estado confirmado
 *   5. VisualDiagnostics      SV.diag      estados, etapas e erros
 *   6. VisualSyncModule       SV           coordena os cinco acima
 *
 * ----------------------------------------------------------------------------
 * ONDE PROCURAR ERRO
 *   SINCVISUAL.diagnostico()    estado, versão confirmada, por que recusou
 *   SINCVISUAL.historico()      as últimas 40 decisões, com motivo
 *   SINCVISUAL.sincronizar()    força uma conferência agora
 * ============================================================================ */
(function moduloDeSincronizacaoVisual() {
  "use strict";

  var CONTRATO = "sincvisual.v1";

  /* o módulo só entra se o sistema estiver carregado; senão ele espera */
  function pronto() {
    return typeof window !== "undefined"
        && typeof window.painelCfg !== "undefined"
        && typeof window.VITRINE !== "undefined";
  }

  function iniciar() {

    /* ========================================================================
       ESTADOS (seção 5 do pedido) — cada um com nome, para o diagnóstico
       não dizer só "erro"
       ======================================================================== */
    var ESTADO = {
      NAO_CARREGADO: "ainda não carregado",
      ATUALIZANDO:   "atualização em andamento",
      CONFIRMADO:    "atualizado e confirmado",
      FALHA_REDE:    "falha temporária de conexão",
      RESPOSTA_MA:   "resposta inválida — mantive a confirmada",
      DESATUALIZADO: "resposta mais velha que a confirmada — descartada"
    };

    var SV = {
      contrato: CONTRATO,
      estado: ESTADO.NAO_CARREGADO,
      desde: "",
      confirmada: null,        /* a última versão BOA, inteira */
      versaoConfirmada: 0,
      confirmadaEm: "",
      recusas: { vazia: 0, invalida: 0, velha: 0, rede: 0 },
      aceitas: 0,
      eventos: [],
      sequencia: 0,
      ultimaAplicada: 0
    };
    try { window.SINCVISUAL = SV; } catch (e) {}

    function lp(v) { return String(v === undefined || v === null ? "" : v).trim(); }
    function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
    function copia(o) { try { return JSON.parse(JSON.stringify(o)); } catch (e) { return null; } }
    function agora() { return new Date().toISOString(); }
    function lista(v) { return Object.prototype.toString.call(v) === "[object Array]" ? v : []; }

    function anotar(oque, porque, extra) {
      SV.eventos.unshift({ quando: agora(), o_que: oque, por_que: porque,
        detalhe: extra || null });
      if (SV.eventos.length > 40) SV.eventos.length = 40;
    }
    function mudarEstado(novo, porque) {
      if (SV.estado !== novo) { SV.estado = novo; SV.desde = agora(); }
      if (porque) anotar(novo, porque);
    }

    /* ========================================================================
       1. VisualVersionManager — qual é mais nova
       ------------------------------------------------------------------------
       Primeiro a versão, que só cresce. Empate (ou sem versão), a data da
       publicação. Sem nenhum dos dois, não dá para comparar e eu digo isso
       em vez de chutar.
       ======================================================================== */
    var versao = {
      numeroDe: function (c) { return num(c && c.versao); },
      dataDe: function (c) { return Date.parse((c && c.publicadoEm) || "") || 0; },

      /** > 0 se A é mais nova, < 0 se é mais velha, 0 se é a mesma */
      comparar: function (a, b) {
        var va = versao.numeroDe(a), vb = versao.numeroDe(b);
        if (va || vb) return va - vb;
        var da = versao.dataDe(a), db = versao.dataDe(b);
        if (da || db) return da === db ? 0 : (da > db ? 1 : -1);
        return 0;
      },

      /** a impressão digital do conteúdo, sem as marcas de tempo */
      marcas: ["versao", "publicadoEm", "publicadoPor", "salvoEm", "salvoPor", "em"],
      revisao: function (c) {
        function limpar(v) {
          if (v === null || v === undefined) return null;
          if (Object.prototype.toString.call(v) === "[object Array]") return v.map(limpar);
          if (typeof v !== "object") return v;
          var saida = {}, ks = Object.keys(v).sort();
          for (var i = 0; i < ks.length; i++) {
            if (versao.marcas.indexOf(ks[i]) > -1) continue;
            saida[ks[i]] = limpar(v[ks[i]]);
          }
          return saida;
        }
        try {
          var s = JSON.stringify(limpar(c)), h = 5381;
          for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
          return h.toString(36) + "." + s.length;
        } catch (e) { return ""; }
      }
    };
    SV.versao = versao;

    /* ========================================================================
       2. VisualCacheManager — a última versão confirmada
       ------------------------------------------------------------------------
       Mora na memória desta aba. NÃO vai para o navegador: cópia local que
       sobrevive ao fechamento vira fonte concorrente, e aí volta o problema
       das duas verdades. Aqui ela só existe enquanto a página está aberta, e
       serve para um único fim: não deixar a tela esvaziar quando o servidor
       responde mal.
       ======================================================================== */
    var cache = {
      guardar: function (c) {
        if (!c) return false;
        SV.confirmada = copia(c);
        SV.versaoConfirmada = versao.numeroDe(c);
        SV.confirmadaEm = agora();
        SV.revisaoConfirmada = versao.revisao(c);
        return true;
      },
      tem: function () { return !!SV.confirmada; },
      pegar: function () { return SV.confirmada ? copia(SV.confirmada) : null; },
      limpar: function () {
        SV.confirmada = null; SV.versaoConfirmada = 0; SV.confirmadaEm = "";
      }
    };
    SV.cache = cache;

    /* ========================================================================
       VALIDAÇÃO — o que conta como resposta boa
       ------------------------------------------------------------------------
       Não basta "ok:true". Uma configuração de tela tem forma: ou ela traz o
       destaque e a lista de visíveis, ou não é uma configuração de tela.
       ======================================================================== */
    function validar(c) {
      var erros = [];
      if (!c || typeof c !== "object") { return { ok: false, erros: ["não veio nada"] }; }
      if (Object.prototype.toString.call(c) === "[object Array]") {
        return { ok: false, erros: ["veio uma lista onde devia vir a configuração"] };
      }
      /* uma configuração publicada sempre tem data ou versão: é o que
         distingue "publicado" de "um objeto vazio com cara de configuração" */
      if (!lp(c.publicadoEm) && !num(c.versao)) {
        erros.push("sem data de publicação e sem número de versão");
      }
      if (c.destaque !== undefined && (typeof c.destaque !== "object" || c.destaque === null)) {
        erros.push("o destaque não é um objeto");
      }
      if (c.visiveis !== undefined &&
          Object.prototype.toString.call(c.visiveis) !== "[object Array]") {
        erros.push("a lista de visíveis não é uma lista");
      }
      if (c.cores !== undefined && (typeof c.cores !== "object" || c.cores === null)) {
        erros.push("as cores não são um objeto");
      }
      return { ok: erros.length === 0, erros: erros };
    }
    SV.validar = validar;

    /* ========================================================================
       3. VisualRenderService — redesenhar só o necessário
       ------------------------------------------------------------------------
       Antes de mandar redesenhar, compara a revisão. Se o conteúdo é o mesmo,
       não mexe em nada: redesenhar a tela da entrada a cada conferência faz o
       carrossel pular e o vídeo recomeçar, e a pessoa na obra vê a tela
       "piscando" de três em três minutos sem motivo.
       ======================================================================== */
    var render = {
      ultimaRevisao: "",
      redesenhos: 0,
      pulados: 0,

      aplicar: function (c, forcar) {
        var rev = versao.revisao(c);
        if (!forcar && rev && rev === render.ultimaRevisao) {
          render.pulados++;
          return { redesenhou: false, porque: "nada mudou no conteúdo" };
        }
        render.ultimaRevisao = rev;
        render.redesenhos++;

        var oque = [];
        /* as cores primeiro: elas valem para a tela inteira */
        try {
          if (window.MOTORTELA && typeof MOTORTELA.aplicar === "function") {
            MOTORTELA.aplicar(); oque.push("cores");
          } else if (window.VITRINE && typeof VITRINE.aplicarCores === "function") {
            VITRINE.aplicarCores(); oque.push("cores");
          }
        } catch (e) {}
        /* a paleta tirada da imagem, quando existe */
        try {
          if (window.PALETA && typeof PALETA.doPublicado === "function") {
            PALETA.doPublicado(); oque.push("paleta");
          }
        } catch (e) {}
        /* a tela de login, só se ela estiver à vista */
        try {
          var l = document.getElementById("loginScreen");
          if (l && !l.classList.contains("hidden") &&
              window.VITRINE && typeof VITRINE.pintarLogin === "function") {
            VITRINE.pintarLogin(); oque.push("login");
          }
        } catch (e) {}
        /* a tela da entrada, só se ela estiver à vista */
        try {
          var k = document.getElementById("kioskScreen");
          if (k && !k.classList.contains("hidden") &&
              window.KIOSK && typeof KIOSK.montar === "function") {
            KIOSK.montar(); oque.push("tela da entrada");
          }
        } catch (e) {}

        return { redesenhou: true, partes: oque };
      }
    };
    SV.render = render;

    /* ========================================================================
       4. VisualRecoveryService — devolver o que estava confirmado
       ======================================================================== */
    var recupera = {
      vezes: 0,
      paraAConfirmada: function (porque) {
        if (!cache.tem()) return false;
        recupera.vezes++;
        try {
          window.painelCfg.publico = cache.pegar();
          anotar("recuperei a versão confirmada", porque,
            { versao: SV.versaoConfirmada });
          return true;
        } catch (e) { return false; }
      }
    };
    SV.recupera = recupera;

    /* ========================================================================
       5. O CORAÇÃO — a porta por onde toda leitura passa
       ------------------------------------------------------------------------
       Eu embrulho PAINEL_vitrineLer_, que é exatamente o ponto onde a
       configuração lida substitui a que está na memória. Era ali que a
       publicação sumia.
       ======================================================================== */
    var lerOriginal = window.PAINEL_vitrineLer_;

    window.PAINEL_vitrineLer_ = function (dados) {
      var meu = ++SV.sequencia;
      mudarEstado(ESTADO.ATUALIZANDO);

      /* deixo a leitura de sempre fazer o trabalho dela */
      var origem = "nada";
      try {
        origem = lerOriginal ? lerOriginal.apply(this, arguments) : "nada";
      } catch (e) {
        anotar("a leitura estourou", lp(e && e.message));
      }

      var veio = window.painelCfg ? window.painelCfg.publico : null;
      var v = validar(veio);

      /* ---- resposta ruim: o confirmado FICA ---- */
      if (!v.ok) {
        if (cache.tem()) {
          recupera.paraAConfirmada("o servidor respondeu, mas " + v.erros.join("; "));
          SV.recusas[veio ? "invalida" : "vazia"]++;
          mudarEstado(ESTADO.RESPOSTA_MA,
            "mantive a versão " + SV.versaoConfirmada + ": " + v.erros.join("; "));
          return SV.origemConfirmada || origem;
        }
        /* nada confirmado ainda: não há o que segurar, e dizer isso é
           melhor do que fingir que existe publicação */
        SV.recusas.vazia++;
        mudarEstado(ESTADO.NAO_CARREGADO, "nunca recebi uma versão boa: " + v.erros.join("; "));
        return origem;
      }

      /* ---- resposta boa, mas mais velha: descartada ---- */
      if (cache.tem() && versao.comparar(veio, SV.confirmada) < 0) {
        recupera.paraAConfirmada("chegou a versão " + versao.numeroDe(veio) +
          ", mais velha que a confirmada " + SV.versaoConfirmada);
        SV.recusas.velha++;
        mudarEstado(ESTADO.DESATUALIZADO,
          "descartei a versão " + versao.numeroDe(veio) + "; fiquei na " + SV.versaoConfirmada);
        return SV.origemConfirmada || origem;
      }

      /* ---- resposta boa e atual: vira a confirmada ---- */
      /* corrida: uma leitura começada antes não manda numa já aplicada */
      if (meu < SV.ultimaAplicada) {
        SV.recusas.velha++;
        recupera.paraAConfirmada("resposta atrasada (pedido " + meu +
          ", já apliquei o " + SV.ultimaAplicada + ")");
        mudarEstado(ESTADO.DESATUALIZADO, "resposta chegou fora de ordem");
        return SV.origemConfirmada || origem;
      }
      SV.ultimaAplicada = meu;
      cache.guardar(veio);
      SV.origemConfirmada = origem;
      SV.aceitas++;
      mudarEstado(ESTADO.CONFIRMADO,
        "versão " + SV.versaoConfirmada + " confirmada (veio de: " + origem + ")");
      return origem;
    };

    /* ========================================================================
       6. VisualSyncModule — a coordenação
       ------------------------------------------------------------------------
       Consome o serviço oficial: MOTORPUB.carregar() quando existe (que por
       sua vez fala com o módulo de Publicação e Comunicação quando ele está
       instalado), e VITRINE.recarregar() como caminho de sempre. Este módulo
       NÃO busca nada por conta própria: ele não cria rota, não grava, não
       autentica. Ele decide o que fazer com o que chegou.
       ======================================================================== */
    SV.sincronizar = function (porque) {
      anotar("sincronizando", porque || "pedido");
      /* o estado vira ATUALIZANDO aqui, ANTES de sair o pedido — e não
         quando a resposta chega. Era o furo: durante uma lentidão de três
         segundos o módulo ainda dizia "confirmado", e quem olhasse o
         diagnóstico no meio da espera não tinha como saber que havia uma
         conferência em curso. O pedido dele separa "em andamento" de
         "confirmado" justamente para esse momento. */
      if (SV.estado !== ESTADO.ATUALIZANDO) {
        mudarEstado(ESTADO.ATUALIZANDO, porque || "conferindo com o servidor");
      }
      var p;
      try {
        if (window.MOTORPUB && typeof MOTORPUB.carregar === "function") {
          p = MOTORPUB.carregar(false);
        } else if (window.VITRINE && typeof VITRINE.recarregar === "function") {
          p = VITRINE.recarregar();
        } else {
          p = Promise.resolve(null);
        }
      } catch (e) { p = Promise.resolve(null); }

      return Promise.resolve(p).then(function () {
        if (SV.estado === ESTADO.CONFIRMADO) render.aplicar(SV.confirmada);
        return SV.estado;
      }).catch(function (e) {
        SV.recusas.rede++;
        if (cache.tem()) {
          recupera.paraAConfirmada("não consegui falar com o servidor");
          mudarEstado(ESTADO.FALHA_REDE,
            "mantive a versão " + SV.versaoConfirmada + " no ar: " + (lp(e && e.message) || "sem resposta"));
        } else {
          mudarEstado(ESTADO.FALHA_REDE, lp(e && e.message) || "sem resposta");
        }
        return SV.estado;
      });
    };

    /* ao voltar a conexão, conferir de novo com a fonte oficial (regra 8) */
    try {
      window.addEventListener("online", function () {
        SV.sincronizar("a internet voltou");
      });
      window.addEventListener("offline", function () {
        if (cache.tem()) {
          mudarEstado(ESTADO.FALHA_REDE,
            "sem internet; a versão " + SV.versaoConfirmada + " continua na tela");
        }
      });
    } catch (e) {}

    /* ========================================================================
       VisualDiagnostics
       ======================================================================== */
    SV.diagnostico = function () {
      return {
        contrato: CONTRATO,
        estado: SV.estado,
        desde: SV.desde || "—",
        versaoConfirmada: SV.versaoConfirmada || "(nenhuma ainda)",
        confirmadaEm: SV.confirmadaEm || "—",
        temCopiaDeApoio: cache.tem() ? "sim, na memória desta aba" : "não",
        respostasAceitas: SV.aceitas,
        recusadasPorVirVazia: SV.recusas.vazia,
        recusadasPorSerInvalida: SV.recusas.invalida,
        recusadasPorSeremVelhas: SV.recusas.velha,
        quedasDeRede: SV.recusas.rede,
        vezesQueRecuperei: recupera.vezes,
        redesenhos: render.redesenhos,
        redesenhosEvitados: render.pulados,
        ultimoMotivo: SV.eventos.length ? SV.eventos[0].por_que : "—"
      };
    };
    SV.historico = function () { return SV.eventos.slice(); };

    /* a primeira sincronização, depois que o resto do sistema acordou */
    setTimeout(function () { SV.sincronizar("arranque"); }, 1500);

    try {
      if (window.console && console.info) {
        console.info("[ALMOXA] módulo de sincronização visual " + CONTRATO + " no ar");
      }
    } catch (e) {}
  }

  /* o arquivo pode carregar antes do sistema; espero até ele existir,
     por no máximo 20 segundos, e desisto em silêncio se não vier */
  if (pronto()) { iniciar(); }
  else {
    var tentativas = 0;
    var relogio = setInterval(function () {
      if (pronto()) { clearInterval(relogio); iniciar(); }
      else if (++tentativas > 200) { clearInterval(relogio); }
    }, 100);
  }
})();
