/* ============================================================
   ALMOXA 3D · app.js  ·  08/11/2026
   ------------------------------------------------------------
   A AMARRAÇÃO. Pega o dado pelo adaptador, passa pelo layout,
   entrega ao motor e cuida do painel.

   Nenhuma regra de negócio mora aqui — é só costura. Quem
   decide cor é o layout3d, quem decide permissão é o Core.
   ============================================================ */
(function (raiz) {
  'use strict';

  var APP = {
    versao: '08/11',
    montagem: null,
    locais: [],
    carregando: false,
    modoDemo: false
  };

  function $(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ----------------------------------------------------------
     O PAINEL
     ---------------------------------------------------------- */
  var ROTULO = {
    /* o cinza da BOLINHA do mapa é claro de propósito, para a
       posição vazia não competir com o material. Mas na ETIQUETA
       do painel ele leva texto branco em cima — e branco sobre
       #9AA3AE é ilegível. Então a etiqueta usa um cinza escuro:
       mesma leitura, contraste de verdade. */
    VAZIA:      { txt: 'Vazia',     cor: '#6B7482' },
    OCUPADA:    { txt: 'Ocupada',   cor: 'var(--verde)' },
    LOTADA:     { txt: 'Lotada',    cor: 'var(--amarelo)' },
    BLOQUEADA:  { txt: 'Bloqueada', cor: 'var(--vermelho)' }
  };

  APP.pintarResumo = function () {
    var r = raiz.LAYOUT3D.resumo(APP.montagem);
    var amb = raiz.API3D ? raiz.API3D.ambiente() : 'NAVEGADOR';
    var nomeAmb = { APPS_SCRIPT: 'Apps Script', GITHUB_PAGES: 'GitHub Pages' }[amb] || 'navegador';

    var html = '';
    if (APP.modoDemo) {
      html += '<div class="aviso"><b>Galpão de demonstração.</b> ' +
        'O endereço do Core não foi configurado, então estou desenhando um ' +
        'galpão de exemplo para você ver o motor funcionando. ' +
        'Nenhum dado seu foi lido.</div>';
    }

    html +=
      '<div class="numeros">' +
        cartao(r.total, 'posições') +
        cartao(r.ocupadas + r.lotadas, 'com material') +
        cartao(r.vazias, 'vazias') +
        cartao(r.bloqueadas, 'bloqueadas') +
      '</div>' +
      '<div class="linha"><span>Ocupação do galpão</span><b>' + r.ocupacaoPct + '%</b></div>' +
      '<div class="barraOcup"><i style="width:' + r.ocupacaoPct + '%"></i></div>' +
      '<div class="linha"><span>Ruas</span><b>' + APP.montagem.contagem.ruas + '</b></div>' +
      '<div class="linha"><span>Estantes</span><b>' + APP.montagem.contagem.estantes + '</b></div>' +
      '<div class="linha"><span>Prateleiras</span><b>' + APP.montagem.contagem.prateleiras + '</b></div>' +
      '<div class="linha"><span>Medidas do galpão</span><b>' +
        APP.montagem.galpao.largura.toFixed(1) + ' × ' +
        APP.montagem.galpao.profundidade.toFixed(1) + ' m</b></div>' +
      '<div class="linha"><span>Ambiente</span><b>' + nomeAmb + '</b></div>' +
      '<div class="vazio">Clique numa posição do galpão<br>para ver o que está guardado nela.</div>';

    $('corpoPainel').innerHTML = html;
    $('tituloPainel').textContent = 'O galpão';
  };

  function cartao(n, rot) {
    return '<div class="cartao"><b>' + n + '</b><span>' + rot + '</span></div>';
  }

  APP.pintarPosicao = function (p) {
    if (!p) { APP.pintarResumo(); return; }
    var rot = ROTULO[p.situacao] || ROTULO.VAZIA;
    var d = p.dado || {};

    var html =
      '<div class="linha"><span>Endereço</span><b>' + esc(p.codigo || '—') + '</b></div>' +
      '<div class="linha"><span>Situação</span><b><span class="chip" style="background:' +
        rot.cor + '">' + rot.txt + '</span></b></div>' +
      '<div class="linha"><span>Rua</span><b>' + esc(p.rua) + '</b></div>' +
      '<div class="linha"><span>Estante</span><b>' + esc(p.estante) + '</b></div>' +
      '<div class="linha"><span>Prateleira</span><b>' + esc(p.prateleira) + '</b></div>' +
      '<div class="linha"><span>Posição</span><b>' + esc(p.posicao || '(a prateleira inteira)') + '</b></div>' +
      '<div class="linha"><span>Materiais guardados</span><b>' + p.itens + '</b></div>' +
      '<div class="linha"><span>Capacidade</span><b>' +
        (p.capacidade ? p.capacidade : 'não informada') + '</b></div>';

    if (d.observacao) {
      html += '<div class="linha"><span>Observação</span><b>' + esc(d.observacao) + '</b></div>';
    }
    html += '<div class="linha"><span>Chave do QR Code</span><b>ALMOXA:LOC:' +
      esc(p.codigo) + '</b></div>';

    if (p.itens > 0) {
      html += '<div class="vazio">A lista do que está guardado aqui vem do módulo ' +
        'de estoque. Ainda não liguei essa consulta — é o próximo passo.</div>';
    }

    $('corpoPainel').innerHTML = html;
    $('tituloPainel').textContent = 'Posição selecionada';
  };

  /* ----------------------------------------------------------
     CARREGAR
     ---------------------------------------------------------- */
  APP.carregar = function () {
    if (APP.carregando) return Promise.resolve();
    APP.carregando = true;
    $('corpoPainel').innerHTML = '<div class="vazio">Consultando o Core…</div>';

    var api = raiz.API3D;
    var pedido;

    if (api && api.pronto()) {
      APP.modoDemo = false;
      pedido = api.localizacoes();
    } else {
      /* sem Core configurado: desenho um galpão de exemplo em vez de
         deixar a tela preta. E DIGO que é exemplo, no painel. */
      APP.modoDemo = true;
      pedido = Promise.resolve({ ok: true, dados: APP.galpaoDeDemonstracao() });
    }

    return pedido.then(function (r) {
      APP.carregando = false;
      if (!r || !r.ok) {
        $('corpoPainel').innerHTML = '<div class="aviso erro"><b>Não consegui carregar.</b><br>' +
          esc((r && r.mensagem) || 'o Core não respondeu') + '</div>';
        return;
      }
      APP.locais = r.dados || [];
      APP.desenhar();
    });
  };

  APP.desenhar = function () {
    APP.montagem = raiz.LAYOUT3D.montar(APP.locais);
    raiz.MOTOR3D.desenhar(APP.montagem);
    APP.pintarResumo();
  };

  /* um galpão pequeno, só para o motor ter o que mostrar */
  APP.galpaoDeDemonstracao = function () {
    var fora = [], ruas = ['A', 'B', 'C'];
    for (var r = 0; r < ruas.length; r++) {
      for (var e = 1; e <= 2; e++) {
        for (var p = 1; p <= 4; p++) {
          for (var o = 0; o < 6; o++) {
            var itens = (r * 7 + e * 3 + p * 2 + o) % 5;
            var cap = 4;
            var st = (r === 2 && p === 1 && o < 2) ? 'BLOQUEADA' : 'DISPONIVEL';
            var est = ruas[r] + '0' + e;
            var pos = String.fromCharCode(65 + o);
            fora.push({
              id: 'DEMO' + r + e + p + o,
              rua: ruas[r], estante: est, prateleira: String(p), posicao: pos,
              codigo: [ruas[r], est, String(p), pos].join('-'),
              capacidade: cap, itens: itens > cap ? cap : itens,
              ocupacao: itens, status: st
            });
          }
        }
      }
    }
    return fora;
  };

  /* ----------------------------------------------------------
     LIGAR TUDO
     ---------------------------------------------------------- */
  APP.iniciar = function (opcoes) {
    opcoes = opcoes || {};
    try {
      raiz.MOTOR3D.iniciar($('tela3d'), { fundo: opcoes.fundo });
    } catch (err) {
      $('corpoPainel').innerHTML = '<div class="aviso erro"><b>O 3D não iniciou.</b><br>' +
        esc(err.message) + '</div>';
      return;
    }

    raiz.MOTOR3D.aoSelecionar = function (p) { APP.pintarPosicao(p); };

    /* os botões de visão */
    var visoes = ['perspectiva', 'superior', 'frontal', 'lateral'];
    visoes.forEach(function (v) {
      var b = $('v_' + v);
      if (!b) return;
      b.addEventListener('click', function () {
        raiz.MOTOR3D.visao(v, APP.montagem && APP.montagem.galpao);
        visoes.forEach(function (o) {
          var bo = $('v_' + o);
          if (bo) bo.setAttribute('aria-pressed', o === v ? 'true' : 'false');
        });
      });
    });
    var rec = $('v_recarregar');
    if (rec) rec.addEventListener('click', function () { APP.carregar(); });

    return APP.carregar();
  };

  raiz.APP3D = APP;
  if (typeof module !== 'undefined' && module.exports) module.exports = APP;

})(typeof window !== 'undefined' ? window : globalThis);
