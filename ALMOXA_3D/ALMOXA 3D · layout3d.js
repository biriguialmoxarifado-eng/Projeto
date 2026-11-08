/* ============================================================
   ALMOXA 3D · layout3d.js  ·  08/11/2026
   ------------------------------------------------------------
   A MATEMÁTICA DO GALPÃO. Aqui não entra Babylon.

   Esta camada pega as localizações do ALMOX PRO — as mesmas da
   aba ALMOXA_LOCALIZACOES, com rua, estante, prateleira e
   posição — e devolve uma lista de PEÇAS com medida e lugar em
   metros:

       { tipo:'montante', x, y, z, lx, ly, lz, cor, ... }

   O motor 3D só traduz essa lista em malhas. Separar assim tem
   dois motivos concretos:

     1. a conta pode ser testada sem placa de vídeo e sem CDN —
        e foi: a suíte prova_layout3d.js roda em Node;
     2. no dia em que o Babylon for trocado, ou aparecer uma
        visão 2D de impressão, a geometria continua valendo.

   AS MEDIDAS SÃO DE ESTANTE DE VERDADE, em metros. Não é
   quadradinho em tela: é uma estante porta-palete com montante,
   longarina, prateleira e vão de corredor por onde cabe gente.
   ============================================================ */
(function (raiz) {
  'use strict';

  /* ----------------------------------------------------------
     MEDIDAS PADRÃO · metros
     Vieram de estante de almoxarifado comum. Dá para trocar
     passando outras em LAYOUT.montar(locais, { medidas }).
     ---------------------------------------------------------- */
  var MEDIDAS = {
    larguraPosicao: 1.00,   /* frente de uma posição */
    alturaNivel: 0.55,      /* de uma prateleira à outra */
    profundidade: 0.60,     /* o quanto a estante entra */
    montante: 0.06,         /* a coluna de ferro */
    longarina: 0.05,        /* a viga horizontal */
    prateleira: 0.03,       /* a chapa onde o material apoia */
    corredor: 2.40,         /* entre uma rua e outra: cabe empilhadeira */
    vaoEstantes: 0.30,      /* respiro entre estantes da mesma rua */
    peDireito: 0.00,        /* altura livre do chão até a 1ª prateleira */
    folgaPiso: 2.00         /* sobra do piso além das estantes */
  };

  /* ----------------------------------------------------------
     AS CORES · seção 8 da especificação
     Elas NÃO são escolha de gosto: saem do dado oficial. Quem
     pinta de verde é a ocupação, não o programador.
     ---------------------------------------------------------- */
  var CORES = {
    vazia:       '#9AA3AE',   /* cinza  · posição livre */
    ocupada:     '#2E9E5B',   /* verde  · tem material */
    atencao:     '#E8A33D',   /* amarelo· cheia ou quase */
    problema:    '#D2443B',   /* vermelho· bloqueada ou divergente */
    selecionada: '#2F7BE8',   /* azul   · o que o usuário clicou */
    estrutura:   '#5A6472',   /* o ferro da estante */
    piso:        '#E7E9EC',
    faixa:       '#C9CDD3'    /* a pintura do corredor */
  };

  function lp(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }
  function cima(v) { return lp(v).toUpperCase(); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  /* ----------------------------------------------------------
     A COR DE UMA POSIÇÃO
     ------------------------------------------------------------
     Ordem importa: bloqueio manda sobre lotação, que manda sobre
     ocupação. Uma posição bloqueada com material continua
     vermelha — senão o vermelho some justamente onde ele serve.
     ---------------------------------------------------------- */
  function corDaPosicao(loc) {
    var st = cima(loc && loc.status);
    if (st === 'BLOQUEADA' || st === 'BLOQUEADO' || st === 'DIVERGENCIA' ||
        st === 'DIVERGÊNCIA' || st === 'INTERDITADA') return CORES.problema;

    var cap = num(loc && loc.capacidade);
    var itens = num(loc && (loc.itens !== undefined ? loc.itens : loc.ocupacao));

    if (itens <= 0) return CORES.vazia;
    if (cap > 0 && itens >= cap) return CORES.atencao;   /* lotada: atenção */
    return CORES.ocupada;
  }

  function situacaoDaPosicao(loc) {
    var c = corDaPosicao(loc);
    if (c === CORES.problema) return 'BLOQUEADA';
    if (c === CORES.atencao) return 'LOTADA';
    if (c === CORES.ocupada) return 'OCUPADA';
    return 'VAZIA';
  }

  /* ----------------------------------------------------------
     ORGANIZAR: a lista plana vira árvore rua → estante →
     prateleira → posição. Ordenada, para o galpão não mudar de
     forma a cada carregamento.
     ---------------------------------------------------------- */
  function organizar(locais) {
    var ruas = {};
    var lista = Object.prototype.toString.call(locais) === '[object Array]' ? locais : [];

    for (var i = 0; i < lista.length; i++) {
      var l = lista[i];
      if (!l) continue;
      var nRua = cima(l.rua);
      if (!nRua) continue;
      var nEst = cima(l.estante) || '(sem estante)';
      var nPra = cima(l.prateleira) || '(sem prateleira)';

      if (!ruas[nRua]) ruas[nRua] = { nome: nRua, estantes: {} };
      var R = ruas[nRua];
      if (!R.estantes[nEst]) R.estantes[nEst] = { nome: nEst, prateleiras: {} };
      var E = R.estantes[nEst];
      if (!E.prateleiras[nPra]) E.prateleiras[nPra] = { nome: nPra, posicoes: [] };
      E.prateleiras[nPra].posicoes.push(l);
    }

    function chaves(o) { var a = []; for (var k in o) if (o.hasOwnProperty(k)) a.push(k); a.sort(); return a; }

    return chaves(ruas).map(function (nr) {
      var R = ruas[nr];
      return {
        nome: R.nome,
        estantes: chaves(R.estantes).map(function (ne) {
          var E = R.estantes[ne];
          return {
            nome: E.nome,
            prateleiras: chaves(E.prateleiras).map(function (np) {
              var P = E.prateleiras[np];
              P.posicoes.sort(function (a, b) {
                return cima(a.posicao) < cima(b.posicao) ? -1 : 1;
              });
              return P;
            })
          };
        })
      };
    });
  }

  /* ----------------------------------------------------------
     MONTAR: a árvore vira peças com medida e lugar
     ---------------------------------------------------------- */
  function montar(locais, opcoes) {
    opcoes = opcoes || {};
    var M = {};
    for (var k in MEDIDAS) M[k] = MEDIDAS[k];
    if (opcoes.medidas) for (var k2 in opcoes.medidas) M[k2] = opcoes.medidas[k2];

    var ruas = organizar(locais);
    var pecas = [];
    var indice = {};          /* codigo -> peça da posição, para o clique achar */
    var contagem = { ruas: 0, estantes: 0, prateleiras: 0, posicoes: 0 };
    var maxX = 0, maxZ = 0, maxY = 0;

    var x = M.folgaPiso;      /* caminha pelo eixo X, uma rua depois da outra */

    for (var r = 0; r < ruas.length; r++) {
      var rua = ruas[r];
      contagem.ruas++;
      var xRua = x;
      var larguraRua = M.profundidade;
      var z = M.folgaPiso;    /* dentro da rua, as estantes caminham no Z */

      for (var e = 0; e < rua.estantes.length; e++) {
        var est = rua.estantes[e];
        contagem.estantes++;

        /* quantas posições tem a prateleira mais larga manda na estante */
        var maiorLinha = 1;
        for (var p0 = 0; p0 < est.prateleiras.length; p0++) {
          maiorLinha = Math.max(maiorLinha, est.prateleiras[p0].posicoes.length);
        }
        var compEstante = maiorLinha * M.larguraPosicao;
        var niveis = est.prateleiras.length;
        var alturaEstante = M.peDireito + niveis * M.alturaNivel + M.alturaNivel * 0.4;

        /* --- os montantes: quatro colunas de ferro --- */
        var cantos = [
          [xRua, z], [xRua + M.profundidade, z],
          [xRua, z + compEstante], [xRua + M.profundidade, z + compEstante]
        ];
        for (var c = 0; c < cantos.length; c++) {
          pecas.push({
            tipo: 'montante', id: 'MONT-' + rua.nome + '-' + est.nome + '-' + c,
            x: cantos[c][0], y: alturaEstante / 2, z: cantos[c][1],
            lx: M.montante, ly: alturaEstante, lz: M.montante,
            cor: CORES.estrutura, clicavel: false
          });
        }

        /* --- cada prateleira: chapa + longarinas + posições --- */
        for (var pr = 0; pr < est.prateleiras.length; pr++) {
          var prat = est.prateleiras[pr];
          contagem.prateleiras++;
          var yNivel = M.peDireito + (pr + 1) * M.alturaNivel;

          pecas.push({
            tipo: 'prateleira', id: 'PRAT-' + rua.nome + '-' + est.nome + '-' + prat.nome,
            rotulo: prat.nome,
            x: xRua + M.profundidade / 2, y: yNivel, z: z + compEstante / 2,
            lx: M.profundidade, ly: M.prateleira, lz: compEstante,
            cor: CORES.estrutura, clicavel: false
          });

          /* as duas longarinas da frente e do fundo */
          pecas.push({
            tipo: 'longarina', id: 'LONG-' + rua.nome + '-' + est.nome + '-' + prat.nome + '-F',
            x: xRua, y: yNivel - M.prateleira, z: z + compEstante / 2,
            lx: M.longarina, ly: M.longarina, lz: compEstante,
            cor: CORES.estrutura, clicavel: false
          });
          pecas.push({
            tipo: 'longarina', id: 'LONG-' + rua.nome + '-' + est.nome + '-' + prat.nome + '-T',
            x: xRua + M.profundidade, y: yNivel - M.prateleira, z: z + compEstante / 2,
            lx: M.longarina, ly: M.longarina, lz: compEstante,
            cor: CORES.estrutura, clicavel: false
          });

          /* --- as posições: o que o usuário clica --- */
          for (var po = 0; po < prat.posicoes.length; po++) {
            var loc = prat.posicoes[po];
            contagem.posicoes++;
            var zPos = z + po * M.larguraPosicao + M.larguraPosicao / 2;
            var alturaCaixa = M.alturaNivel * 0.66;

            var peca = {
              tipo: 'posicao',
              id: lp(loc.codigo) || (rua.nome + '-' + est.nome + '-' + prat.nome + '-' + cima(loc.posicao)),
              codigo: lp(loc.codigo),
              rua: rua.nome, estante: est.nome,
              prateleira: prat.nome, posicao: cima(loc.posicao),
              x: xRua + M.profundidade / 2,
              y: yNivel + alturaCaixa / 2 + M.prateleira,
              z: zPos,
              lx: M.profundidade * 0.86,
              ly: alturaCaixa,
              lz: M.larguraPosicao * 0.88,
              cor: corDaPosicao(loc),
              situacao: situacaoDaPosicao(loc),
              capacidade: num(loc.capacidade),
              itens: num(loc.itens !== undefined ? loc.itens : loc.ocupacao),
              status: lp(loc.status),
              clicavel: true,
              dado: loc
            };
            pecas.push(peca);
            if (peca.codigo) indice[peca.codigo] = peca;
            maxY = Math.max(maxY, peca.y + peca.ly);
          }
        }

        maxY = Math.max(maxY, alturaEstante);
        z += compEstante + M.vaoEstantes;
      }

      /* a plaquinha da rua, no começo dela */
      pecas.push({
        tipo: 'placaRua', id: 'RUA-' + rua.nome, rotulo: rua.nome,
        x: xRua + M.profundidade / 2, y: 2.4, z: M.folgaPiso / 2,
        lx: 0.6, ly: 0.35, lz: 0.04, cor: CORES.faixa, clicavel: false
      });

      maxZ = Math.max(maxZ, z);
      x += larguraRua + M.corredor;
      maxX = Math.max(maxX, x);
    }

    /* o piso, dimensionado pelo que foi montado */
    var compX = Math.max(6, maxX - M.corredor + M.folgaPiso);
    var compZ = Math.max(6, maxZ + M.folgaPiso);
    pecas.unshift({
      tipo: 'piso', id: 'PISO',
      x: compX / 2, y: 0, z: compZ / 2,
      lx: compX, ly: 0.02, lz: compZ,
      cor: CORES.piso, clicavel: false
    });

    return {
      pecas: pecas,
      indice: indice,
      contagem: contagem,
      galpao: { largura: compX, profundidade: compZ, altura: Math.max(3, maxY + 0.8) },
      medidas: M,
      cores: CORES
    };
  }

  /* ----------------------------------------------------------
     RESUMO: os números do painel, calculados do mesmo dado que
     pinta as cores — para o texto nunca discordar da imagem.
     ---------------------------------------------------------- */
  function resumo(montagem) {
    var r = { total: 0, vazias: 0, ocupadas: 0, lotadas: 0, bloqueadas: 0, ocupacaoPct: 0 };
    if (!montagem || !montagem.pecas) return r;
    for (var i = 0; i < montagem.pecas.length; i++) {
      var p = montagem.pecas[i];
      if (p.tipo !== 'posicao') continue;
      r.total++;
      if (p.situacao === 'VAZIA') r.vazias++;
      else if (p.situacao === 'OCUPADA') r.ocupadas++;
      else if (p.situacao === 'LOTADA') r.lotadas++;
      else if (p.situacao === 'BLOQUEADA') r.bloqueadas++;
    }
    var usadas = r.ocupadas + r.lotadas;
    r.ocupacaoPct = r.total ? Math.round(usadas / r.total * 100) : 0;
    return r;
  }

  raiz.LAYOUT3D = {
    MEDIDAS: MEDIDAS,
    CORES: CORES,
    organizar: organizar,
    montar: montar,
    resumo: resumo,
    corDaPosicao: corDaPosicao,
    situacaoDaPosicao: situacaoDaPosicao
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = raiz.LAYOUT3D;

})(typeof window !== 'undefined' ? window : globalThis);
