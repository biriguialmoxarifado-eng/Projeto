/* ============================================================================
 * ALMOX-PRO — MOTOR DE LEITURA DE NOTA FISCAL
 * Arquivo próprio. Sobe na mesma pasta do index.html.
 * Contrato: motornf.v1
 * ============================================================================
 *
 * O QUE ACONTECEU, E POR QUE ESTE ARQUIVO EXISTE
 * ----------------------------------------------
 * A tela dele mostrou os dois números que explicam tudo:
 *
 *     "512 × 161 px da nota"      e      "não respondeu em 15 segundos"
 *
 * 512 × 161 px era a tabela INTEIRA de produtos: 11 linhas, 13 colunas.
 * Isso dá 14,6 px por linha, e letra de uns 9 px de altura. Nenhum motor
 * de OCR lê 9 px: o Google precisa de uns 16, o Tesseract de uns 20, e
 * para tabela com coluna estreita o seguro são 25. Não é o OCR que está
 * ruim — é que o traço da letra não existe na imagem. Ampliar depois não
 * devolve o que não foi capturado: ampliar 3× uma letra de 9 px dá uma
 * letra de 27 px BORRADA, não uma letra de 27 px.
 *
 * E os 15 segundos eram do sistema, não do OCR: toda chamada de leitura
 * do ALMOX-PRO desiste em 15s. OCR de imagem grande passa disso com
 * facilidade. Então, mesmo quando dava para ler, o sistema desistia antes.
 *
 * O QUE ESTE MOTOR FAZ — nesta ordem, que é a ordem que importa
 *
 *   1. MEDE ANTES DE MANDAR. Calcula a altura da linha e diz, na hora, se
 *      aquela região tem pixel suficiente. Se não tiver, ele NÃO gasta
 *      90 segundos para devolver lixo: ele diz quanto falta e o que fazer.
 *
 *   2. QUEBRA A TABELA EM BLOCOS de poucas linhas, levando o CABEÇALHO
 *      das colunas junto em cada bloco — senão o OCR lê números soltos
 *      sem saber de que coluna são. Os blocos se sobrepõem de propósito,
 *      e a sobreposição é desduplicada depois, para nenhuma linha se
 *      perder no corte nem aparecer duas vezes.
 *
 *   3. TRATA cada bloco numa cópia (cinza, contraste, nitidez, e
 *      binarização quando ajuda), ampliando por reamostragem. O original
 *      nunca é tocado.
 *
 *   4. LÊ EM ETAPAS, com progresso: lê tudo, vê o que saiu fraco,
 *      reprocessa SÓ o que saiu fraco com mais resolução, e junta. Uma
 *      tentativa extra por bloco — não fica tentando para sempre.
 *
 *   5. GUARDA A PROCEDÊNCIA de cada campo: de qual bloco veio, em que
 *      resolução, por qual método, e a confiança QUE O SERVIÇO DEU.
 *      Quando o serviço não dá confiança, fica escrito "não informada" —
 *      nunca um número inventado.
 *
 *   6. CONFERE o que dá para conferir sozinho (formato de CNPJ, de chave,
 *      de data, e se quantidade × unitário bate com o total) e MARCA o
 *      que não fecha. Nunca corrige valor fiscal para a conta fechar.
 *
 * O QUE ELE NÃO FAZ
 *   · Não é um segundo leitor: é chamado pelo leitor que já existe.
 *   · Não tem OCR próprio. Usa o módulo "ocr" do Core, o mesmo de sempre.
 *   · Não lança nada no estoque. Entrega para a conferência de sempre.
 *   · Não cria banco, nem segunda estrutura de notas.
 *   · Não inventa confiança, não inventa coordenada, não conserta valor.
 *   · Não trava a tela: tudo é por etapa, com progresso e com desistência.
 *
 * ONDE PROCURAR ERRO (console do navegador)
 *   MOTORNF.diagnostico()   a última leitura, etapa por etapa
 *   MOTORNF.medir(...)      o pré-voo isolado
 * ============================================================================ */
(function motorDeNotaFiscal() {
  "use strict";
  if (typeof window === "undefined" || window.MOTORNF) return;

  var CONTRATO = "motornf.v1";

  /* ------------------------------------------------------------------
     O QUE CADA OCR PRECISA, EM PIXELS DE ALTURA DE LETRA.
     Não é opinião: é o piso abaixo do qual o reconhecimento desaba.
     ------------------------------------------------------------------ */
  var LETRA_MINIMA = 16;     /* abaixo disto, não adianta mandar */
  var LETRA_BOA    = 25;     /* daqui para cima, tabela sai confiável */
  var PARTE_DA_LINHA_QUE_E_LETRA = 0.62;

  var PADRAO = {
    linhasPorBloco: 6,       /* blocos pequenos leem melhor que a tabela inteira */
    sobreposicao: 1,         /* uma linha repetida entre blocos, para não perder
                                a que cair exatamente no corte */
    larguraAlvo: 2200,       /* para onde ampliar cada bloco */
    larguraAlvoReforco: 3200,/* na segunda tentativa, só do que saiu fraco */
    larguraMaxima: 3600,     /* acima disto o pedido fica pesado demais */
    limiteMs: 90000,         /* o OCR precisa de mais que os 15s do sistema */
    qualidadeJPEG: 0.95,
    tratar: true,
    binarizar: false         /* só quando o papel está sujo; cuidado, come traço fino */
  };

  var M = {
    contrato: CONTRATO,
    padrao: PADRAO,
    ultima: null,
    cancelado: false
  };
  window.MOTORNF = M;

  function lp(v) { return String(v === undefined || v === null ? "" : v).trim(); }
  function num(v) {
    if (typeof v === "number") return v;
    var s = lp(v).replace(/\s/g, "");
    if (!s) return 0;
    /* 1.234,56 e 1234.56 são o mesmo número em idiomas diferentes */
    if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
    var n = parseFloat(s.replace(/[^0-9.\-]/g, ""));
    return isFinite(n) ? n : 0;
  }
  function agora() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  /* ============================================================
     1 · O PRÉ-VOO — medir antes de mandar
     ------------------------------------------------------------
     Esta é a parte que faltava. Com ela, a resposta para "por que
     não leu?" deixa de ser "o OCR falhou" e passa a ser um número.
     ============================================================ */
  M.medir = function (regiao, quantasLinhas, imagem) {
    var r = regiao || {};
    var deOnde = "informado por quem chamou";
    var linhas = Number(quantasLinhas) || 0;
    var fundidas = false;
    if (!linhas && imagem) {
      var contagem = contarLinhasNaImagem(imagem, r);
      if (contagem === -1) {
        fundidas = true;
        deOnde = "não deu para contar: as linhas estão coladas umas nas outras";
      } else if (contagem > 0) {
        linhas = contagem;
        deOnde = "contado na imagem (" + contagem + " faixas de texto)";
      }
    }
    if (!linhas) {
      linhas = estimarLinhas(r);
      if (!fundidas) deOnde = "estimado pela altura (não deu para contar)";
    }
    linhas = Math.max(1, linhas);
    var alturaLinha = r.h / linhas;
    var letra = alturaLinha * PARTE_DA_LINHA_QUE_E_LETRA;
    var faltaPara = function (alvo) { return letra > 0 ? alvo / letra : 99; };
    var veredicto, oQueFazer;
    /* linhas coladas é veredicto por si só: não importa a conta que o
       tamanho sugere, se não há papel entre as linhas o OCR não tem
       onde separar um produto do outro */
    if (fundidas) {
      return {
        regiao: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) },
        linhasEstimadas: linhas, comoContei: deOnde, linhasColadas: true,
        alturaDaLinha: Math.round(alturaLinha * 10) / 10,
        alturaDaLetra: Math.round(letra * 10) / 10,
        minimoDoOcr: LETRA_MINIMA, bomParaTabela: LETRA_BOA,
        veredicto: "pouco pixel", daParaMandar: false,
        precisaDeQuantasVezesMais: 3,
        oQueFazer: "nesta imagem as linhas da tabela estão coladas umas nas outras — " +
          "não sobrou papel entre elas. Isso acontece quando a folha foi reduzida " +
          "demais, e nenhum leitor consegue separar um produto do outro assim. " +
          "Precisa do PDF original da nota, ou de uma foto só da tabela, de perto."
      };
    }
    if (letra >= LETRA_BOA) {
      veredicto = "boa";
      oQueFazer = "dá para ler direto.";
    } else if (letra >= LETRA_MINIMA) {
      veredicto = "no limite";
      oQueFazer = "dá para tentar, mas a tabela pode sair com erro em coluna " +
        "estreita. Selecionar menos linhas de cada vez ajuda.";
    } else {
      veredicto = "pouco pixel";
      oQueFazer = "esta região tem letra de " + letra.toFixed(0) + " px. Nenhum OCR " +
        "lê abaixo de " + LETRA_MINIMA + " px, e ampliar depois não devolve traço que " +
        "não foi capturado. Precisa de uma imagem " + faltaPara(LETRA_MINIMA).toFixed(1) +
        "× maior: o PDF original da nota, ou uma foto mais perto, só da tabela.";
    }
    return {
      regiao: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) },
      linhasEstimadas: linhas,
      comoContei: deOnde,
      alturaDaLinha: Math.round(alturaLinha * 10) / 10,
      alturaDaLetra: Math.round(letra * 10) / 10,
      minimoDoOcr: LETRA_MINIMA,
      bomParaTabela: LETRA_BOA,
      veredicto: veredicto,
      daParaMandar: letra >= LETRA_MINIMA,
      precisaDeQuantasVezesMais: Math.round(faltaPara(LETRA_MINIMA) * 10) / 10,
      oQueFazer: oQueFazer
    };
  };

  /* QUANTAS LINHAS HÁ NA REGIÃO — medindo, não chutando.
     ------------------------------------------------------------
     A primeira versão disto dividia a altura por 20 px e devolvia o
     resultado. Parece inofensivo e é um erro grosseiro: dividir por
     20 e depois multiplicar de volta dá SEMPRE 20 px por linha, em
     qualquer resolução. Com isso o motor declarava "pouco pixel"
     até numa folha de 300 dpi — recusaria leitura boa.
     Agora eu olho a imagem: linha de texto deixa uma faixa escura, e
     faixa escura dá para contar. É a mesma conta que o olho faz ao
     ver as listras de uma tabela de longe. */
  var CACHE_LINHAS = {};

  function contarLinhasNaImagem(imagem, r) {
    if (!imagem || !r || !(r.h > 2)) return 0;
    var chave = [imagem.src ? imagem.src.length : 0, Math.round(r.x), Math.round(r.y),
      Math.round(r.w), Math.round(r.h)].join(":");
    if (CACHE_LINHAS[chave] !== undefined) return CACHE_LINHAS[chave];
    var contado = 0;
    try {
      /* trabalho numa cópia pequena: contar faixa não precisa de
         resolução, precisa de proporção. E assim dá para medir
         enquanto a pessoa arrasta, sem travar nada. */
      var larg = Math.min(420, Math.max(40, Math.round(r.w)));
      var esc = larg / r.w;
      var altu = Math.max(4, Math.round(r.h * esc));
      var c = document.createElement("canvas");
      c.width = larg; c.height = altu;
      var ctx = c.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(imagem, r.x, r.y, r.w, r.h, 0, 0, larg, altu);
      var d = ctx.getImageData(0, 0, larg, altu).data;

      /* escuridão média de cada fileira de pixels */
      var perfil = new Array(altu), menor = 255, maior = 0, y, x, i;
      for (y = 0; y < altu; y++) {
        var soma = 0;
        for (x = 0; x < larg; x++) {
          i = (y * larg + x) * 4;
          soma += (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
        }
        var m = soma / larg;
        perfil[y] = m;
        if (m < menor) menor = m;
        if (m > maior) maior = m;
      }
      if (maior - menor < 8) { CACHE_LINHAS[chave] = 0; return 0; }  /* área lisa */

      /* uma fileira é "de texto" quando está mais escura que o meio
         do caminho entre o papel e a linha mais preta */
      var corte = maior - (maior - menor) * 0.35;
      var dentro = false, faixas = 0, alturaDaFaixa = 0, somaAlturas = 0;
      for (y = 0; y < altu; y++) {
        if (perfil[y] < corte) {
          if (!dentro) { dentro = true; alturaDaFaixa = 0; }
          alturaDaFaixa++;
        } else if (dentro) {
          dentro = false;
          /* faixa de 1 pixel costuma ser a borda da tabela, não texto */
          if (alturaDaFaixa >= 2) { faixas++; somaAlturas += alturaDaFaixa; }
        }
      }
      if (dentro && alturaDaFaixa >= 2) { faixas++; somaAlturas += alturaDaFaixa; }

      /* AS LINHAS FUNDIDAS — o caso que me enganou e que é justamente
         o dele. Quando a resolução é baixa demais, as fileiras de texto
         deixam de ter papel entre elas: o perfil vira UM borrão escuro
         só. Contar faixas aí devolve "1 linha", e uma linha de 79 px
         pareceria ótima — a conclusão mais errada possível, com a cara
         mais certa possível.
         Então eu olho o espaço CLARO: numa tabela legível há papel
         entre as linhas. Sem papel entre elas, elas se fundiram, e
         isso por si só já é prova de que falta pixel. */
      var claras = 0;
      for (y = 0; y < altu; y++) if (perfil[y] >= corte) claras++;
      var proporcaoClara = claras / altu;
      var ocupacaoDaMaiorFaixa = faixas ? (somaAlturas / faixas) / altu : 1;
      var fundidas = (faixas <= 2 && altu >= 12) ||
                     (proporcaoClara < 0.18) ||
                     (ocupacaoDaMaiorFaixa > 0.6);

      contado = fundidas ? -1 : faixas;   /* -1 = não dá para contar, e sei por quê */
    } catch (e) { contado = 0; }
    CACHE_LINHAS[chave] = contado;
    return contado;
  }

  /* o chute só entra quando não houve imagem para medir, e aí ele é
     declarado como chute no resultado */
  function estimarLinhas(r) {
    return Math.max(1, Math.round((r.h || 0) / 20));
  }

  /* ============================================================
     2 · OS BLOCOS — tabela grande vira pedaços legíveis
     ------------------------------------------------------------
     Com o CABEÇALHO junto, senão o OCR devolve números sem coluna.
     Com SOBREPOSIÇÃO, senão a linha do corte some.
     ============================================================ */
  M.blocos = function (tabela, opcoes) {
    var o = Object.assign({}, PADRAO, opcoes || {});
    var linhas = Number(o.linhas) || 0;
    if (!linhas && o.imagem) linhas = contarLinhasNaImagem(o.imagem, tabela);
    if (!linhas) linhas = estimarLinhas(tabela);
    linhas = Math.max(1, linhas);
    var alturaLinha = tabela.h / linhas;
    var porBloco = Math.max(2, Number(o.linhasPorBloco) || PADRAO.linhasPorBloco);
    var sobrepor = Math.max(0, Number(o.sobreposicao) || 0);

    /* o cabeçalho é a faixa logo ACIMA da tabela, quando ela existir na
       folha. Sem cabeçalho de verdade, não invento: mando sem. */
    var cab = null;
    if (o.cabecalho && o.cabecalho.h > 0) cab = o.cabecalho;

    var saida = [];
    var inicio = 0, n = 0;
    while (inicio < linhas) {
      var fim = Math.min(linhas, inicio + porBloco);
      var y1 = tabela.y + inicio * alturaLinha;
      var y2 = tabela.y + fim * alturaLinha;
      saida.push({
        indice: n++,
        daLinha: inicio + 1, ateALinha: fim,
        regiao: { x: tabela.x, y: y1, w: tabela.w, h: y2 - y1 },
        cabecalho: cab,
        linhas: fim - inicio
      });
      if (fim >= linhas) break;
      inicio = fim - sobrepor;        /* volta um pouco: a sobreposição */
      if (inicio < 0) inicio = 0;
    }
    return saida;
  };

  /* ============================================================
     3 · RENDERIZAR UM BLOCO — do ORIGINAL, ampliando por reamostragem
     ------------------------------------------------------------
     Nunca da tela. O zoom da tela não é resolução: é tamanho de
     exibição. Quem manda aqui é o pixel do arquivo.
     ============================================================ */
  M.renderizar = function (imagem, bloco, opcoes) {
    var o = Object.assign({}, PADRAO, opcoes || {});
    var r = bloco.regiao;
    var cab = bloco.cabecalho;

    var fator = Math.min(6, Math.max(1, (o.larguraAlvo || 2200) / Math.max(1, r.w)));
    var lw = Math.min(o.larguraMaxima || 3600, Math.round(r.w * fator));
    var escala = lw / r.w;
    var alturaCab = cab ? Math.round(cab.h * escala) : 0;
    var lh = Math.round(r.h * escala) + alturaCab;

    var c = document.createElement("canvas");
    c.width = lw; c.height = lh;
    var ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, lw, lh);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    /* o cabeçalho das colunas vai em cima, colado */
    if (cab) {
      ctx.drawImage(imagem, cab.x, cab.y, cab.w, cab.h, 0, 0, lw, alturaCab);
    }
    ctx.drawImage(imagem, r.x, r.y, r.w, r.h, 0, alturaCab, lw, lh - alturaCab);

    if (o.tratar) tratarCanvas(ctx, lw, lh, o);

    return {
      dataURL: c.toDataURL("image/jpeg", o.qualidadeJPEG || 0.95),
      largura: lw, altura: lh,
      escala: Math.round(escala * 100) / 100,
      comCabecalho: !!cab,
      alturaDoCabecalho: alturaCab,
      regiao: r
    };
  };

  /* cinza + contraste + nitidez moderada; binarização só se pedirem.
     Isto ajuda o OCR a separar traço de fundo. NÃO cria caractere:
     nenhum filtro faz isso, e eu não vou dizer que faz. */
  function tratarCanvas(ctx, w, h, o) {
    var d;
    try { d = ctx.getImageData(0, 0, w, h); } catch (e) { return; }
    var p = d.data;
    var i;
    /* cinza + contraste */
    var k = 1.4;
    for (i = 0; i < p.length; i += 4) {
      var g = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
      g = (g - 128) * k + 128;
      p[i] = p[i + 1] = p[i + 2] = g < 0 ? 0 : (g > 255 ? 255 : g);
    }
    /* nitidez: máscara de desfoque de 4 vizinhos */
    var copia = new Uint8ClampedArray(p);
    var n = 0.55;
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        i = (y * w + x) * 4;
        var centro = copia[i];
        var volta = (copia[i - 4] + copia[i + 4] + copia[i - w * 4] + copia[i + w * 4]) / 4;
        var v = centro + (centro - volta) * n;
        p[i] = p[i + 1] = p[i + 2] = v < 0 ? 0 : (v > 255 ? 255 : v);
      }
    }
    /* binarização: só quando pedida. Em letra fina ela COME o traço,
       por isso não é o padrão. O corte é por média local grosseira. */
    if (o.binarizar) {
      var soma = 0;
      for (i = 0; i < p.length; i += 4) soma += p[i];
      var media = soma / (p.length / 4);
      var corte = media * 0.82;
      for (i = 0; i < p.length; i += 4) {
        var b = p[i] < corte ? 0 : 255;
        p[i] = p[i + 1] = p[i + 2] = b;
      }
    }
    try { ctx.putImageData(d, 0, 0); } catch (e) {}
  }

  /* ============================================================
     4 · FALAR COM O OCR — com prazo próprio
     ------------------------------------------------------------
     O sistema desiste de qualquer leitura em 15 segundos. OCR de
     imagem grande passa disso sem estar com defeito nenhum. Aqui o
     prazo é do motor, e é configurável.
     ============================================================ */
  function pedirAoOcr(render, o) {
    var comecou = agora();
    return new Promise(function (pronto) {
      var acabou = false;
      var relogio = setTimeout(function () {
        if (acabou) return;
        acabou = true;
        pronto({ ok: false, codigo: "DEMOROU",
          mensagem: "o OCR não respondeu em " + Math.round((o.limiteMs || 90000) / 1000) + "s",
          ms: agora() - comecou });
      }, o.limiteMs || PADRAO.limiteMs);

      var pedido;
      try {
        pedido = Promise.resolve(API.call("ocr", "ler", {
          paginas: [{
            nome: "bloco-" + (render.indice || 0) + ".jpg",
            tipo: "image/jpeg",
            base64: String(render.dataURL).split(",")[1] || ""
          }]
        }, { limite: o.limiteMs || PADRAO.limiteMs }));
      } catch (e) {
        clearTimeout(relogio);
        return pronto({ ok: false, codigo: "ESTOUROU", mensagem: lp(e && e.message) });
      }

      pedido.then(function (r) {
        if (acabou) return;
        acabou = true; clearTimeout(relogio);
        if (r) r.ms = agora() - comecou;
        pronto(r || { ok: false, codigo: "SEM_RESPOSTA", mensagem: "o OCR não respondeu" });
      })["catch"](function (e) {
        if (acabou) return;
        acabou = true; clearTimeout(relogio);
        pronto({ ok: false, codigo: "ERRO", mensagem: lp(e && e.message), ms: agora() - comecou });
      });
    });
  }

  /* ============================================================
     5 · PROCEDÊNCIA — de onde cada linha veio
     ------------------------------------------------------------
     §6 do pedido. O que o serviço não informa fica escrito como não
     informado; nada é preenchido por educação.
     ============================================================ */
  function carimbar(item, bloco, render, metodo, tentativa) {
    item.__origem = {
      bloco: bloco.indice,
      linhasDoBloco: bloco.daLinha + "–" + bloco.ateALinha,
      regiaoNaNota: {
        x: Math.round(bloco.regiao.x), y: Math.round(bloco.regiao.y),
        w: Math.round(bloco.regiao.w), h: Math.round(bloco.regiao.h)
      },
      resolucaoEnviada: render.largura + " × " + render.altura + " px",
      ampliacao: render.escala + "×",
      comCabecalhoDasColunas: render.comCabecalho,
      metodo: metodo,
      tentativa: tentativa,
      confiancaDoServico: (item.confianca === undefined || item.confianca === null)
        ? "não informada" : item.confianca,
      corrigidoAMao: false,
      validacao: "pendente"
    };
    return item;
  }

  /* ============================================================
     6 · JUNTAR SEM DUPLICAR
     ------------------------------------------------------------
     A sobreposição entre blocos existe para não perder linha. Ela
     cria repetição de propósito, e é aqui que a repetição morre.
     Duas linhas são a MESMA quando descrição, quantidade e valores
     batem — não só a descrição, porque uma nota pode ter o mesmo
     produto duas vezes de verdade, em quantidades diferentes.
     ============================================================ */
  function chaveDaLinha(i) {
    return [
      lp(i.descricao).toUpperCase().replace(/\s+/g, " "),
      num(i.qtd), num(i.valorUnitario), num(i.valorTotal)
    ].join("|");
  }

  /* ------------------------------------------------------------
     POR QUE ISTO MUDOU — e é uma correção séria
     ------------------------------------------------------------
     "Existe uma trena de fibra e uma trena de bolha; ele pulou, acho
      que por conta do mesmo nome. São produtos diferentes."

     Ele está certo e a culpa era minha. A primeira versão comparava
     QUALQUER linha com QUALQUER outra: duas linhas com texto parecido
     e os mesmos números viravam uma só, mesmo vindo de lugares
     distantes da tabela. Numa nota de material isso é comum —
     ferramentas parecidas, mesma quantidade, mesmo preço — e o
     resultado é um produto sumindo sem ninguém ver.

     A repetição que eu preciso apagar NÃO é "linha parecida": é a
     linha que eu mesmo mandei ler duas vezes, porque os blocos se
     sobrepõem de propósito. Essa eu sei exatamente onde está: é o
     FIM de um bloco contra o COMEÇO do bloco seguinte.

     Então agora: só as linhas da emenda são candidatas, e mesmo elas
     só somem quando são idênticas. Parecidas ficam as duas, marcadas
     para conferência. Sobrar uma linha repetida é um aborrecimento;
     sumir um produto da nota é um erro de estoque.
     ------------------------------------------------------------ */
  function consolidar(lista, blocos) {
    var saida = [], repetidas = 0, suspeitas = 0;
    var porBloco = {};
    lista.forEach(function (i) {
      if (!lp(i.descricao) && !num(i.valorTotal)) return;   /* linha vazia não entra */
      var b = (i.__origem && i.__origem.bloco !== undefined) ? i.__origem.bloco : 0;
      (porBloco[b] = porBloco[b] || []).push(i);
    });

    var ordem = Object.keys(porBloco).map(Number).sort(function (a, b) { return a - b; });
    ordem.forEach(function (b, posicao) {
      var doBloco = porBloco[b];
      if (!posicao) { saida = saida.concat(doBloco); return; }

      /* quantas linhas se repetem entre este bloco e o anterior */
      var quantasNaEmenda = 1;
      try {
        var cfg = (blocos || []).filter(function (x) { return x.indice === b; })[0];
        var ant = (blocos || []).filter(function (x) { return x.indice === ordem[posicao - 1]; })[0];
        if (cfg && ant) {
          var sobrepos = ant.ateALinha - (cfg.daLinha - 1);
          quantasNaEmenda = Math.max(0, Math.min(3, sobrepos));
        }
      } catch (e) {}

      var inicio = 0;
      for (var k = 0; k < quantasNaEmenda && k < doBloco.length; k++) {
        var candidata = doBloco[k];
        /* ela só pode ser igual a uma das ÚLTIMAS linhas já aceitas */
        var janela = saida.slice(Math.max(0, saida.length - quantasNaEmenda - 1));
        var igual = null;
        janela.forEach(function (j) {
          if (chaveDaLinha(j) === chaveDaLinha(candidata)) igual = j;
        });
        if (igual) {
          repetidas++;
          /* fica a de maior confiança informada */
          var cA = Number(igual.confianca), cB = Number(candidata.confianca);
          if (isFinite(cB) && (!isFinite(cA) || cB > cA)) {
            var onde = saida.indexOf(igual);
            if (onde > -1) saida[onde] = candidata;
          }
          inicio = k + 1;
          continue;
        }
        /* parecida mas NÃO idêntica: as duas ficam, e a tela avisa.
           É aqui que a trena de fibra e a trena de bolha se salvam. */
        var parecida = null;
        janela.forEach(function (j) {
          var a = lp(j.descricao).toUpperCase(), bb = lp(candidata.descricao).toUpperCase();
          if (!a || !bb) return;
          var menor = Math.min(a.length, bb.length);
          if (menor >= 6 && a.slice(0, Math.min(10, menor)) === bb.slice(0, Math.min(10, menor))) {
            parecida = j;
          }
        });
        if (parecida) {
          suspeitas++;
          candidata.possivelRepeticao = true;
          candidata.porqueSuspeita = "começa igual a \"" + lp(parecida.descricao).slice(0, 28) +
            "\", mas os dados não são os mesmos. Mantive as duas — confira na nota.";
        }
        inicio = k;
        break;
      }
      saida = saida.concat(doBloco.slice(inicio));
    });

    return { itens: saida, repetidasRemovidas: repetidas, suspeitasDeRepeticao: suspeitas };
  }

  /* ============================================================
     JUNTAR PÁGINAS — a nota com mais de uma folha
     ------------------------------------------------------------
     O leitor chamava NFPONTE.juntarItens, que NUNCA EXISTIU neste
     sistema. Como a função não existia, caía no "else" e os itens da
     página nova SUBSTITUÍAM os da anterior: ler a folha 2 apagava a
     folha 1, calado.

     Aqui a regra é simples e explícita:
       · item de outra página: fica como está;
       · reler a MESMA página: troca só os daquela página, não duplica;
       · página nova: entra no fim, na ordem das folhas.
     ============================================================ */
  M.juntarPaginas = function (itensAtuais, novos, pagina) {
    var p = Number(pagina) || 1;
    var fora = (Array.isArray(itensAtuais) ? itensAtuais : []).filter(function (i) {
      return (Number(i.pagina) || 1) !== p;
    });
    (novos || []).forEach(function (i) { i.pagina = p; });
    var juntos = fora.concat(novos || []);
    juntos.sort(function (a, b) { return (Number(a.pagina) || 1) - (Number(b.pagina) || 1); });
    return juntos;
  };

  /* ============================================================
     7 · CONFERIR O QUE DÁ PARA CONFERIR SOZINHO
     ------------------------------------------------------------
     Formato e aritmética. NUNCA corrigir: marcar.
     ============================================================ */
  M.validar = function (leitura) {
    var d = leitura || {};
    var c = d.campos || {};
    var avisos = [];

    function marcar(campo, ok, porque) {
      d.validacao = d.validacao || {};
      d.validacao[campo] = { ok: ok, porque: porque || "" };
      if (!ok && porque) avisos.push(porque);
    }

    var chave = lp(c.chave).replace(/\D/g, "");
    if (chave) marcar("chave", chave.length === 44,
      chave.length === 44 ? "" : "a chave de acesso tem " + chave.length +
        " dígitos; a chave da NF-e tem 44. Confira na imagem.");

    var cnpj = lp(c.cnpj).replace(/\D/g, "");
    if (cnpj) marcar("cnpj", cnpj.length === 14,
      cnpj.length === 14 ? "" : "o CNPJ lido tem " + cnpj.length + " dígitos; o CNPJ tem 14.");

    if (lp(c.emissao)) {
      var data = lp(c.emissao).match(/(\d{2})[\/\-.](\d{2})[\/\-.](\d{2,4})/);
      marcar("emissao", !!data, data ? "" : "a data de emissão não saiu num formato de data.");
    }

    /* aritmética linha a linha — marcar, não consertar */
    var itens = Array.isArray(d.itens) ? d.itens : [];
    var naoFecham = 0, somaItens = 0;
    itens.forEach(function (i) {
      var q = num(i.qtd), u = num(i.valorUnitario), t = num(i.valorTotal);
      somaItens += t;
      if (q && u && t) {
        var esperado = q * u;
        var difere = Math.abs(esperado - t) > Math.max(0.02, t * 0.01);
        i.contaNaoFecha = difere;
        if (i.__origem) i.__origem.validacao = difere ? "quantidade × unitário não bate" : "confere";
        if (difere) naoFecham++;
      } else if (i.__origem) {
        i.__origem.validacao = "faltou número para conferir";
      }
    });
    if (naoFecham) {
      avisos.push(naoFecham + " linha(s) com quantidade × unitário diferente do total. " +
        "Nenhum valor foi alterado — confira na imagem antes de importar.");
    }

    var totalDeclarado = num(c.valor) || num((d.valores || {}).total);
    if (totalDeclarado && somaItens) {
      var fecha = Math.abs(totalDeclarado - somaItens) <= Math.max(0.05, totalDeclarado * 0.02);
      marcar("total", fecha, fecha ? "" :
        "a soma dos itens dá " + somaItens.toFixed(2) + " e a nota declara " +
        totalDeclarado.toFixed(2) + ". Pode ser frete, desconto ou item que não foi lido.");
    }

    d.avisos = (Array.isArray(d.avisos) ? d.avisos : []).concat(avisos);
    return d;
  };

  /* ============================================================
     8 · A LEITURA COMPLETA, EM ETAPAS
     ============================================================ */
  M.cancelar = function () { M.cancelado = true; };

  M.ler = function (imagem, tabela, opcoes, aoProgresso) {
    var o = Object.assign({}, PADRAO, opcoes || {});
    var avisar = typeof aoProgresso === "function" ? aoProgresso : function () {};
    M.cancelado = false;

    var relato = {
      contrato: CONTRATO,
      comecou: new Date().toISOString(),
      arquivo: o.nomeDoArquivo || "(sem nome)",
      pagina: o.pagina || 1,
      resolucaoOriginal: imagem ? (imagem.naturalWidth + " × " + imagem.naturalHeight + " px") : "—",
      regiao: tabela,
      etapas: [], blocos: [], erros: [],
      msTotal: 0
    };
    M.ultima = relato;
    var t0 = agora();

    /* ETAPA 0 — o pré-voo */
    var medida = M.medir(tabela, o.linhas, imagem);
    relato.medida = medida;
    relato.etapas.push({ etapa: "medir", veredicto: medida.veredicto,
      alturaDaLetra: medida.alturaDaLetra + " px", ms: Math.round(agora() - t0) });
    avisar({ etapa: "medir", texto: "Medindo a região…", medida: medida });

    if (!medida.daParaMandar && !o.mandarMesmoAssim) {
      relato.msTotal = Math.round(agora() - t0);
      relato.conclusao = "nao_mandei";
      return Promise.resolve({
        ok: false, codigo: "POUCO_PIXEL",
        mensagem: medida.oQueFazer,
        medida: medida, diagnostico: relato
      });
    }

    /* ETAPA 1 — blocos */
    var blocos = M.blocos(tabela, Object.assign({}, o,
      { linhas: o.linhas || medida.linhasEstimadas, imagem: imagem }));
    relato.etapas.push({ etapa: "dividir", blocos: blocos.length,
      linhasPorBloco: o.linhasPorBloco, sobreposicao: o.sobreposicao });
    avisar({ etapa: "dividir", texto: "Dividindo a tabela em " + blocos.length + " bloco(s)…",
      blocos: blocos.length });

    var achados = [];
    var fracos = [];

    function umBloco(k, larguraAlvo, tentativa) {
      if (M.cancelado) return Promise.resolve(null);
      var bloco = blocos[k];
      var tr = agora();
      var render = M.renderizar(imagem, bloco, Object.assign({}, o, { larguraAlvo: larguraAlvo }));
      render.indice = bloco.indice;
      var msRender = agora() - tr;
      avisar({ etapa: "ler", texto: "Lendo bloco " + (k + 1) + " de " + blocos.length +
        (tentativa > 1 ? " (2ª tentativa, mais resolução)" : "") + "…",
        bloco: k + 1, de: blocos.length, tentativa: tentativa });

      return pedirAoOcr(render, o).then(function (r) {
        var registro = {
          bloco: bloco.indice, linhas: bloco.daLinha + "–" + bloco.ateALinha,
          enviado: render.largura + " × " + render.altura + " px",
          ampliacao: render.escala + "×",
          msRender: Math.round(msRender), msOcr: Math.round(r && r.ms || 0),
          tentativa: tentativa, ok: !!(r && r.ok),
          erro: (r && r.ok) ? null : lp(r && (r.mensagem || r.codigo))
        };
        if (!r || !r.ok || !r.dados) {
          registro.itens = 0;
          relato.blocos.push(registro);
          relato.erros.push("bloco " + (k + 1) + ": " + registro.erro);
          if (tentativa === 1) fracos.push(k);
          return null;
        }
        var itens = Array.isArray(r.dados.itens) ? r.dados.itens : [];
        itens.forEach(function (i) {
          carimbar(i, bloco, render, "ocr.ler", tentativa);
          achados.push(i);
        });
        registro.itens = itens.length;
        /* bloco fraco: não veio item, ou veio com confiança baixa informada */
        var baixa = itens.filter(function (i) {
          return isFinite(Number(i.confianca)) && Number(i.confianca) < 0.7;
        }).length;
        registro.comConfiancaBaixa = baixa;
        relato.blocos.push(registro);
        if (tentativa === 1 && (!itens.length || baixa > 0)) fracos.push(k);
        /* o cabeçalho da nota só interessa do primeiro bloco que trouxer */
        if (!relato.cabecalhoDaNota && r.dados.campos) {
          relato.cabecalhoDaNota = r.dados.campos;
          relato.camposPosicao = r.dados.camposPosicao || null;
          relato.valores = r.dados.valores || null;
        }
        return r;
      });
    }

    function emFila(indices, largura, tentativa) {
      var p = Promise.resolve();
      indices.forEach(function (k) {
        p = p.then(function () { return umBloco(k, largura, tentativa); });
      });
      return p;
    }

    var todos = blocos.map(function (_, k) { return k; });

    return emFila(todos, o.larguraAlvo, 1).then(function () {
      relato.etapas.push({ etapa: "primeira leitura", itens: achados.length,
        blocosFracos: fracos.length, ms: Math.round(agora() - t0) });

      if (!fracos.length || M.cancelado || o.semReforco) return null;

      /* ETAPA 2 — só o que saiu fraco, com mais resolução. UMA vez. */
      avisar({ etapa: "reforco", texto: fracos.length +
        " bloco(s) saíram fracos; relendo só eles com mais resolução…" });
      var quais = fracos.slice();
      fracos = [];
      return emFila(quais, o.larguraAlvoReforco, 2);
    }).then(function () {
      /* ETAPA 3 — juntar sem duplicar */
      var junto = consolidar(achados, blocos);
      relato.etapas.push({ etapa: "consolidar", itens: junto.itens.length,
        repetidasRemovidas: junto.repetidasRemovidas,
        suspeitasDeRepeticao: junto.suspeitasDeRepeticao, ms: Math.round(agora() - t0) });
      avisar({ etapa: "consolidar", texto: "Juntando os blocos…",
        itens: junto.itens.length });

      var leitura = {
        itens: junto.itens,
        campos: relato.cabecalhoDaNota || {},
        camposPosicao: relato.camposPosicao || null,
        valores: relato.valores || null,
        avisos: [],
        __motor: CONTRATO
      };

      /* ETAPA 4 — conferir */
      M.validar(leitura);
      relato.etapas.push({ etapa: "validar", avisos: leitura.avisos.length,
        ms: Math.round(agora() - t0) });

      relato.msTotal = Math.round(agora() - t0);
      relato.itens = leitura.itens.length;
      relato.repetidasRemovidas = junto.repetidasRemovidas;
      relato.suspeitasDeRepeticao = junto.suspeitasDeRepeticao;
      if (junto.suspeitasDeRepeticao) {
        leitura.avisos.push(junto.suspeitasDeRepeticao + " linha(s) começam igual a outra " +
          "e foram MANTIDAS as duas, porque os dados não batem. Confira na imagem: " +
          "produtos diferentes costumam ter o começo do nome parecido.");
      }
      relato.conclusao = leitura.itens.length ? "leu" : "nada_lido";

      if (!leitura.itens.length) {
        return { ok: false, codigo: "NADA_LIDO",
          mensagem: relato.erros.length
            ? "o OCR não devolveu item nenhum. " + relato.erros[0]
            : "o OCR respondeu, mas não achou linha de produto nesta região.",
          medida: medida, diagnostico: relato, dados: leitura };
      }
      return { ok: true, dados: leitura, medida: medida, diagnostico: relato };
    })["catch"](function (e) {
      relato.msTotal = Math.round(agora() - t0);
      relato.conclusao = "estourou";
      relato.erros.push(lp(e && e.message));
      return { ok: false, codigo: "ESTOUROU", mensagem: lp(e && e.message) || "falhou",
        diagnostico: relato };
    });
  };

  /* ============================================================
     9 · DIAGNÓSTICO VISÍVEL — sem dado fiscal dentro
     ------------------------------------------------------------
     §9 pede o retrato técnico e proíbe expor dado fiscal. Então
     aqui não entra descrição de produto, CNPJ, chave nem valor:
     só tamanho, tempo, contagem e erro.
     ============================================================ */
  M.contarLinhas = contarLinhasNaImagem;

  M.diagnostico = function () {
    var r = M.ultima;
    if (!r) return { contrato: CONTRATO, estado: "nenhuma leitura ainda" };
    return {
      contrato: CONTRATO,
      arquivo: r.arquivo, pagina: r.pagina,
      resolucaoOriginal: r.resolucaoOriginal,
      regiaoPedida: r.regiao ? (Math.round(r.regiao.w) + " × " + Math.round(r.regiao.h) + " px") : "—",
      medida: r.medida,
      blocos: r.blocos.map(function (b) {
        return { bloco: b.bloco + 1, linhas: b.linhas, enviado: b.enviado,
          ampliacao: b.ampliacao, tentativa: b.tentativa,
          itens: b.itens, confiancaBaixa: b.comConfiancaBaixa,
          renderMs: b.msRender, ocrMs: b.msOcr, erro: b.erro };
      }),
      etapas: r.etapas,
      itensReconhecidos: r.itens || 0,
      repetidasRemovidas: r.repetidasRemovidas || 0,
      erros: r.erros,
      tempoTotal: r.msTotal + "ms",
      conclusao: r.conclusao
    };
  };
})();
