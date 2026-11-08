/* ============================================================
   ALMOXA 3D · adaptador.js  ·  08/11/2026
   ------------------------------------------------------------
   O ADAPTADOR MULTIAMBIENTE · seção 5 do adendo.

   Uma aplicação só, dois lugares para rodar:

     · servida pelo Apps Script (/exec) → google.script.run
     · servida pelo GitHub Pages       → HTTPS no /exec

   O resto do módulo 3D não sabe em qual dos dois está. Ele
   chama API3D.chamar('locais','listar') e pronto. É assim que
   a regra de negócio não se duplica entre ambientes, que é o
   que a seção 5 pede.

   O CONTRATO é o mesmo que o ALMOX PRO já usa hoje — eu não
   inventei endpoint nenhum:

       { ponte:'ALMOXA', chave:'', modulo, acao, payload,
         sessao, perfil, obra, origem }

   SEGURANÇA. Seção 3: "não colocar senhas, tokens privados ou
   credenciais dentro do código público". Este arquivo vai para
   o GitHub, então ele NÃO guarda chave nenhuma. A URL do /exec
   não é segredo — ela é endereço, e quem decide o que pode ser
   feito é o Core, do lado de lá. Identidade e permissão
   continuam sendo decisão do Core, nunca do navegador.
   ============================================================ */
(function (raiz) {
  'use strict';

  var A = {
    nome: 'API3D',
    versao: '08/11',
    url: '',              /* a do /exec, quando rodando fora do Apps Script */
    sessao: null,
    tempoLimite: 20000,
    chamadas: 0,
    falhas: 0,
    ultima: null
  };

  /* ----------------------------------------------------------
     ONDE ESTOU
     ------------------------------------------------------------
     google.script.run só existe quando a página foi servida
     pelo próprio Apps Script. É a prova mais honesta de
     ambiente que existe: ou o objeto está lá, ou não está.
     ---------------------------------------------------------- */
  A.ambiente = function () {
    try {
      if (typeof google !== 'undefined' && google.script && google.script.run) {
        return 'APPS_SCRIPT';
      }
    } catch (e) { }
    try {
      if (typeof location !== 'undefined' && /github\.io$/i.test(location.hostname)) {
        return 'GITHUB_PAGES';
      }
    } catch (e) { }
    return 'NAVEGADOR';
  };

  A.configurar = function (opcoes) {
    opcoes = opcoes || {};
    if (opcoes.url !== undefined) A.url = String(opcoes.url || '').trim();
    if (opcoes.sessao !== undefined) A.sessao = opcoes.sessao;
    if (opcoes.tempoLimite) A.tempoLimite = Number(opcoes.tempoLimite) || A.tempoLimite;
    return A.estado();
  };

  A.estado = function () {
    return {
      ambiente: A.ambiente(),
      temUrl: !!A.url,
      pronto: A.pronto(),
      chamadas: A.chamadas,
      falhas: A.falhas
    };
  };

  /** dá para falar com o Core daqui? */
  A.pronto = function () {
    var amb = A.ambiente();
    if (amb === 'APPS_SCRIPT') return true;
    return !!A.url;
  };

  function envelope(modulo, acao, payload) {
    return {
      ponte: 'ALMOXA',
      chave: '',                    /* nunca vai chave neste arquivo */
      modulo: modulo,
      acao: acao,
      payload: payload || {},
      sessao: A.sessao || null,
      origem: 'ALMOXA_3D'
    };
  }

  /* ----------------------------------------------------------
     A CHAMADA
     ---------------------------------------------------------- */
  A.chamar = function (modulo, acao, payload, opcoes) {
    opcoes = opcoes || {};
    var amb = A.ambiente();
    A.chamadas++;
    var comecou = Date.now();

    function fim(r) {
      A.ultima = { modulo: modulo, acao: acao, ambiente: amb,
                   ms: Date.now() - comecou, ok: !!(r && r.ok) };
      if (!r || !r.ok) A.falhas++;
      return r;
    }

    if (amb === 'APPS_SCRIPT') {
      return new Promise(function (resolve) {
        var respondeu = false;
        var relogio = setTimeout(function () {
          if (respondeu) return;
          respondeu = true;
          resolve(fim({ ok: false, codigo: 'TEMPO',
            mensagem: 'O Core não respondeu em ' +
              Math.round((opcoes.tempoLimite || A.tempoLimite) / 1000) +
              ' segundos (' + modulo + '.' + acao + ').' }));
        }, opcoes.tempoLimite || A.tempoLimite);

        try {
          google.script.run
            .withSuccessHandler(function (t) {
              if (respondeu) return; respondeu = true; clearTimeout(relogio);
              resolve(fim(A.entender(t)));
            })
            .withFailureHandler(function (e) {
              if (respondeu) return; respondeu = true; clearTimeout(relogio);
              resolve(fim({ ok: false, codigo: 'ERRO_GAS',
                mensagem: (e && e.message) || 'o Apps Script recusou a chamada' }));
            })
            .APIX_atender_(JSON.stringify(envelope(modulo, acao, payload)));
        } catch (e) {
          respondeu = true; clearTimeout(relogio);
          resolve(fim({ ok: false, codigo: 'ERRO_GAS', mensagem: String(e && e.message) }));
        }
      });
    }

    /* fora do Apps Script: HTTPS no mesmo /exec */
    if (!A.url) {
      return Promise.resolve(fim({ ok: false, codigo: 'SEM_URL',
        mensagem: 'O endereço do Core não foi configurado. ' +
          'Chame API3D.configurar({ url: "...". }) antes de usar.' }));
    }

    var corta = null;
    var prazo = new Promise(function (resolve) {
      corta = setTimeout(function () {
        resolve(fim({ ok: false, codigo: 'TEMPO',
          mensagem: 'O Core não respondeu em ' +
            Math.round((opcoes.tempoLimite || A.tempoLimite) / 1000) + ' segundos.' }));
      }, opcoes.tempoLimite || A.tempoLimite);
    });

    var ida = fetch(A.url, {
      method: 'POST',
      /* text/plain evita o pedido de verificação prévia do CORS,
         que o Apps Script não responde. É o mesmo caminho que o
         ALMOX PRO já usa hoje no GitHub Pages. */
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(envelope(modulo, acao, payload))
    }).then(function (res) {
      return res.text();
    }).then(function (txt) {
      clearTimeout(corta);
      return fim(A.entender(txt));
    }).catch(function (e) {
      clearTimeout(corta);
      return fim({ ok: false, codigo: 'REDE',
        mensagem: (e && e.message) || 'não consegui falar com o Core' });
    });

    return Promise.race([ida, prazo]);
  };

  /** a resposta pode vir como texto ou como objeto; entendo as duas */
  A.entender = function (t) {
    if (t === null || t === undefined) {
      return { ok: false, codigo: 'VAZIO', mensagem: 'o Core respondeu nada' };
    }
    if (typeof t === 'object') return t;
    try {
      var o = JSON.parse(t);
      return (o && typeof o === 'object') ? o
        : { ok: false, codigo: 'FORMATO', mensagem: 'resposta em formato inesperado' };
    } catch (e) {
      return { ok: false, codigo: 'FORMATO',
        mensagem: 'não entendi a resposta do Core',
        bruto: String(t).slice(0, 300) };
    }
  };

  /* ----------------------------------------------------------
     OS PEDIDOS QUE O 3D FAZ
     ------------------------------------------------------------
     Só ações que eu confirmei existirem no Core em 08/11, lendo
     o código do AP_Modulo_locais. Não invento ação.
     ---------------------------------------------------------- */
  A.localizacoes = function () { return A.chamar('locais', 'listar'); };
  A.semLocalizacao = function () { return A.chamar('locais', 'semLocalizacao'); };
  A.vincular = function (sku, codigo) {
    return A.chamar('locais', 'vincular', { sku: sku, codigo: codigo });
  };
  A.criarFaixa = function (d) { return A.chamar('locais', 'criarFaixa', d); };
  A.item = function (sku) { return A.chamar('itens', 'obter', { sku: sku }); };
  A.estoqueDoItem = function (sku) { return A.chamar('estoque', 'item', { sku: sku }); };

  raiz.API3D = A;
  if (typeof module !== 'undefined' && module.exports) module.exports = A;

})(typeof window !== 'undefined' ? window : globalThis);
