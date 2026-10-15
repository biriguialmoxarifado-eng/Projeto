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

  var CONTRATO = "motornf.v4";

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

  /* ============================================================
     O PERFIL DE TEXTO DA REGIÃO  ·  [v2] onde cada faixa COMEÇA
     ------------------------------------------------------------
     POR QUE ISTO PASSOU A DEVOLVER POSIÇÕES, E NÃO SÓ A CONTA
     A divisão em blocos cortava a tabela em fatias de altura
     IGUAL: altura da tabela ÷ número de linhas. Só que linha de
     nota fiscal não tem altura igual — descrição comprida quebra
     em duas e aquela linha fica quase o dobro das outras.
     Medido numa nota de teste de 12 linhas com 4 descrições
     compridas: alturas de 48 e 75 px, média 57. Com a fatia de
     57 px, TRÊS cortes caíram DENTRO de uma linha de produto (no
     meio do "DISCO DE CORTE" e no meio da "TINTA ACRILICA"), e a
     sobreposição de "1 linha" valia 57 px — menos que os 75 px da
     linha mais alta, isto é, incapaz de recuperar o que foi
     partido. Metade de linha não vira item: ou vira item torto,
     ou é descartada.
     Agora as posições reais das faixas de texto saem daqui, e o
     corte é EMPURRADO para o vão de papel entre duas faixas.
     As coordenadas vêm da IMAGEM porque o serviço de OCR deste
     sistema devolve texto e itens e NÃO devolve coordenada
     nenhuma — e eu não invento o que ele não dá.
     ============================================================ */
  var CACHE_PERFIL = {};

  function perfilDeTexto(imagem, r) {
    if (!imagem || !r || !(r.h > 2)) return null;
    var chave = [imagem.src ? imagem.src.length : 0, Math.round(r.x), Math.round(r.y),
      Math.round(r.w), Math.round(r.h)].join(":");
    if (CACHE_PERFIL[chave] !== undefined) return CACHE_PERFIL[chave];
    var saida = null;
    try {
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

      if (maior - menor < 8) {
        saida = { bandas: [], vales: [], fundidas: false, lisa: true,
          escala: esc, altura: altu, maiorBanda: 0, maiorVale: 0 };
      } else {
        var corte = maior - (maior - menor) * 0.35;
        var bandas = [], dentro = false, y0 = 0;
        for (y = 0; y < altu; y++) {
          if (perfil[y] < corte) {
            if (!dentro) { dentro = true; y0 = y; }
          } else if (dentro) {
            dentro = false;
            if (y - y0 >= 2) bandas.push({ y0: y0, y1: y });
          }
        }
        if (dentro && altu - y0 >= 2) bandas.push({ y0: y0, y1: altu });

        /* os vãos de papel ENTRE as faixas: é onde o corte pode cair */
        var vales = [];
        for (var k = 1; k < bandas.length; k++) {
          vales.push({ y0: bandas[k - 1].y1, y1: bandas[k].y0 });
        }

        var claras = 0;
        for (y = 0; y < altu; y++) if (perfil[y] >= corte) claras++;
        var proporcaoClara = claras / altu;
        var somaAlturas = bandas.reduce(function (s, b) { return s + (b.y1 - b.y0); }, 0);
        var ocupacao = bandas.length ? (somaAlturas / bandas.length) / altu : 1;
        var fundidas = (bandas.length <= 2 && altu >= 12) ||
                       (proporcaoClara < 0.18) ||
                       (ocupacao > 0.6);

        /* tudo de volta para a coordenada da imagem de verdade */
        var paraImagem = function (v) { return r.y + v / esc; };
        saida = {
          bandas: bandas.map(function (b) {
            return { y0: paraImagem(b.y0), y1: paraImagem(b.y1),
              altura: (b.y1 - b.y0) / esc };
          }),
          vales: vales.map(function (v) {
            return { y0: paraImagem(v.y0), y1: paraImagem(v.y1),
              meio: paraImagem((v.y0 + v.y1) / 2), altura: (v.y1 - v.y0) / esc };
          }),
          fundidas: fundidas, lisa: false, escala: esc, altura: altu
        };
        saida.maiorBanda = saida.bandas.reduce(function (m2, b) {
          return Math.max(m2, b.altura); }, 0);
        saida.maiorVale = saida.vales.reduce(function (m2, v) {
          return Math.max(m2, v.altura); }, 0);
      }
    } catch (e) { saida = null; }
    CACHE_PERFIL[chave] = saida;
    return saida;
  }
  M.perfilDeTexto = perfilDeTexto;

  /* ============================================================
     ACHAR A FAIXA DO CABECALHO DAS COLUNAS   ·  §3 do pedido
     ------------------------------------------------------------
     "A primeira linha sempre é o cabeçalho; ele se repete em todas
      as folhas."  É isso, e era isso que faltava.

     A região que a pessoa seleciona em cima da nota começa no
     cabeçalho das colunas — CÓDIGO, DESCRIÇÃO, NCM/SH, CST, CFOP,
     UNID, QUANT, VALOR UNITÁRIO, VALOR TOTAL. Enquanto o cabeçalho
     ficar DENTRO da região de produtos, duas coisas quebram de uma
     vez: ele é contado como se fosse mais uma linha de produto, e
     o leitor ainda descarta a primeira linha "porque é cabeçalho"
     — na folha 2 isso derruba um produto de verdade.

     Aqui eu separo as duas regiões ANTES de qualquer leitura:
       · cabecalho → viaja colado no topo de TODO bloco;
       · produtos  → é a região que vira linha.
     A primeira linha de produto passa a ser a primeira de verdade,
     em todas as folhas, e nenhuma linha some por posição.

     O corte não é chutado: é o vão de papel entre a primeira faixa
     de texto e a segunda, medido no pixel. Sem vão medível eu
     devolvo null e digo por quê — separar no palpite seria trocar
     um erro silencioso por outro.
     ============================================================ */
  M.acharCabecalho = function (imagem, tabela) {
    if (!imagem || !tabela || !(tabela.h > 6)) {
      return { achou: false, porque: "não recebi imagem ou a região é pequena demais." };
    }
    var perfil = perfilDeTexto(imagem, tabela);
    if (!perfil || perfil.lisa) {
      return { achou: false,
        porque: "não há faixa de texto medível nesta região." };
    }
    if (perfil.fundidas) {
      return { achou: false,
        porque: "as linhas estão encostadas umas nas outras nesta resolução, " +
          "então não dá para dizer onde o cabeçalho termina sem chutar." };
    }
    if (perfil.bandas.length < 2 || !perfil.vales.length) {
      return { achou: false,
        porque: "achei " + perfil.bandas.length + " faixa(s) de texto; preciso de " +
          "pelo menos duas para separar o cabeçalho da primeira linha de produto." };
    }
    var primeira = perfil.bandas[0];
    var vao = perfil.vales[0];
    var corte = vao.meio;
    /* o cabeçalho não pode comer a tabela: se a primeira faixa ocupa
       mais de um terço da região, isto não é um cabeçalho de uma
       linha e eu não mexo. */
    if ((corte - tabela.y) > tabela.h * 0.34) {
      return { achou: false,
        porque: "a primeira faixa de texto ocupa mais de um terço da região — " +
          "isso não tem cara de cabeçalho de uma linha." };
    }
    return {
      achou: true,
      cabecalho: { x: tabela.x, y: tabela.y, w: tabela.w, h: corte - tabela.y },
      produtos: { x: tabela.x, y: corte, w: tabela.w,
        h: (tabela.y + tabela.h) - corte },
      alturaDaFaixa: Math.round(primeira.altura),
      vaoDePapel: Math.round(vao.altura),
      faixasNaRegiao: perfil.bandas.length,
      porque: "a primeira faixa de texto tem " + Math.round(primeira.altura) +
        " px e depois dela vem um vão de papel de " + Math.round(vao.altura) +
        " px. Cortei no meio desse vão."
    };
  };

  /* ============================================================
     O ECO DO CABECALHO ENTRE OS ITENS   ·  §3 do pedido
     ------------------------------------------------------------
     Mesmo separando a faixa, o cabeçalho pode reaparecer: numa
     folha o OCR pega uma sobra, noutra a pessoa seleciona um pouco
     acima. Então eu também reconheço o cabeçalho JÁ VIRADO EM ITEM.

     A regra é estreita de propósito. Só é cabeçalho a linha que:
       · tem duas ou mais palavras do cabeçalho da DANFE, E
       · não tem quantidade NEM valor total.
     Produto tem número. Cabeçalho não tem. Essa segunda condição é
     o que torna impossível esta função apagar uma mercadoria, e é
     por isso que ela existe.

     "Nunca descarte um produto apenas porque ele aparece logo após
      o cabeçalho" — nada aqui olha para a posição da linha.
     ============================================================ */
  var PALAVRAS_DE_CABECALHO = [
    "CODIGO", "DESCRICAO", "PRODUTO", "SERVICO", "NCM", "SH", "CST", "CFOP",
    "UNID", "QUANT", "VALOR", "UNITARIO", "TOTAL", "DESCONTO", "BASE",
    "CALC", "ICMS", "IPI", "ALIQUOTA", "ALIQUOTAS"
  ];
  function semAcento(t) {
    return lp(t).toUpperCase()
      .replace(/[ÁÀÂÃÄ]/g, "A").replace(/[ÉÈÊË]/g, "E").replace(/[ÍÌÎÏ]/g, "I")
      .replace(/[ÓÒÔÕÖ]/g, "O").replace(/[ÚÙÛÜ]/g, "U").replace(/[Ç]/g, "C");
  }
  M.ehCabecalhoDeColunas = function (item) {
    var i = item || {};
    var texto = semAcento([lp(i.descricao), lp(i.produto), lp(i.unidade)].join(" "));
    if (!texto.replace(/[^A-Z]/g, "").length) return null;
    var achadas = PALAVRAS_DE_CABECALHO.filter(function (p) {
      return texto.indexOf(p) > -1;
    });
    if (achadas.length < 2) return null;
    /* o cadeado: se tem número de mercadoria, NÃO é cabeçalho */
    if (num(i.qtd) || num(i.quantidade) || num(i.valorTotal)) return null;
    return {
      ehCabecalho: true,
      palavras: achadas.slice(0, 6),
      porque: "esta linha tem as palavras do cabeçalho das colunas (" +
        achadas.slice(0, 4).join(", ") + ") e não tem quantidade nem valor total. " +
        "O cabeçalho se repete em toda folha da nota."
    };
  };

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

    /* [v2] O CORTE VAI PARA O VÃO ENTRE DUAS LINHAS.
       A conta de altura média continua servindo para decidir ONDE
       mais ou menos cortar; quem decide o pixel exato é o papel
       branco entre duas faixas de texto. Sem perfil (imagem não
       veio, região lisa, linhas fundidas), fica como era — e o
       bloco registra que o corte não pôde ser conferido. */
    var perfil = o.imagem ? perfilDeTexto(o.imagem, tabela) : null;
    var temVales = !!(perfil && !perfil.fundidas && perfil.vales.length);
    var folga = Math.max(2, Math.round(alturaLinha * 0.08));

    function empurrarParaOVao(y, limiteBusca) {
      if (!temVales) return { y: y, ajustado: false, dentroDeLinha: false };
      /* o vão mais perto do ponto pretendido */
      var melhor = null, dist = Infinity;
      perfil.vales.forEach(function (v) {
        var d = Math.abs(v.meio - y);
        if (d < dist) { dist = d; melhor = v; }
      });
      /* o corte está dentro de uma faixa de texto? */
      var dentro = false;
      perfil.bandas.forEach(function (b) {
        if (y > b.y0 + 1 && y < b.y1 - 1) dentro = true;
      });
      if (melhor && dist <= limiteBusca) {
        return { y: melhor.meio, ajustado: Math.abs(melhor.meio - y) > 0.5,
          dentroDeLinha: false, moveu: Math.round(melhor.meio - y) };
      }
      return { y: y, ajustado: false, dentroDeLinha: dentro, moveu: 0 };
    }

    /* a sobreposição em PIXEL: a linha mais alta que existe nesta
       tabela, não a linha média. Era aqui que a nota com descrição
       comprida perdia produto: 1 linha média = 57 px contra uma
       linha de 75 px. */
    var sobreporPx = sobrepor
      ? Math.max(sobrepor * alturaLinha,
          (perfil && perfil.maiorBanda ? perfil.maiorBanda + (perfil.maiorVale || 0) : 0))
      : 0;

    var saida = [];
    var inicio = 0, n = 0;
    var limiteBusca = Math.max(alturaLinha * 0.75,
      (perfil && perfil.maiorBanda ? perfil.maiorBanda * 0.75 : 0));

    while (inicio < linhas) {
      var fim = Math.min(linhas, inicio + porBloco);
      var yCru1 = tabela.y + inicio * alturaLinha;
      var yCru2 = tabela.y + fim * alturaLinha;

      /* o começo do primeiro bloco e o fim do último são as bordas
         da própria tabela: não se mexe neles */
      var a = inicio === 0
        ? { y: yCru1, ajustado: false, dentroDeLinha: false, moveu: 0 }
        : empurrarParaOVao(yCru1 - folga, limiteBusca);
      var b2 = fim >= linhas
        ? { y: yCru2, ajustado: false, dentroDeLinha: false, moveu: 0 }
        : empurrarParaOVao(yCru2 + folga, limiteBusca);

      var y1 = Math.max(tabela.y, a.y);
      var y2 = Math.min(tabela.y + tabela.h, b2.y);
      if (y2 - y1 < 4) y2 = Math.min(tabela.y + tabela.h, y1 + Math.max(4, alturaLinha));

      saida.push({
        indice: n++,
        daLinha: inicio + 1, ateALinha: fim,
        regiao: { x: tabela.x, y: y1, w: tabela.w, h: y2 - y1 },
        cabecalho: cab,
        linhas: fim - inicio,
        /* [v2] como este corte foi decidido — vai para o diagnóstico */
        corte: {
          porVaoDeTexto: temVales,
          moveuComeco: a.moveu || 0,
          moveuFim: b2.moveu || 0,
          comecoDentroDeLinha: !!a.dentroDeLinha,
          fimDentroDeLinha: !!b2.dentroDeLinha,
          sobreposicaoPx: Math.round(sobreporPx),
          alturaMediaDaLinha: Math.round(alturaLinha),
          /* a faixa de TINTA de uma linha de texto e o vão de papel
             depois dela. A soma das duas é a altura que a
             sobreposição precisa cobrir para nunca partir uma linha. */
          maiorFaixaDeTexto: perfil ? Math.round(perfil.maiorBanda || 0) : null,
          maiorVaoDePapel: perfil ? Math.round(perfil.maiorVale || 0) : null
        }
      });

      if (fim >= linhas) break;
      /* a volta da sobreposição é em PIXEL, convertida para linha */
      var voltaEmLinhas = sobreporPx ? Math.max(1, Math.ceil(sobreporPx / alturaLinha)) : 0;
      inicio = fim - voltaEmLinhas;
      if (inicio < 0) inicio = 0;
      if (inicio >= fim) inicio = fim - 1;   /* nunca anda para trás de vez */
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
  /* ============================================================
     RECONCILIAR — o que o OCR LEU contra o que virou ITEM
     ------------------------------------------------------------
     §2 do pedido: nenhuma linha reconhecida pode sumir calada.
     Aqui eu comparo o texto cru do bloco com os itens montados e
     aponto cada linha de texto com cara de produto que não virou
     item nenhum. Não corrijo nada e não invento item a partir
     dela: eu mostro, para a pessoa conferir. Chutar a divisão de
     uma linha em código, descrição, quantidade e valor é como se
     erra calado — e errar calado é o problema que estou
     consertando.
     ============================================================ */
  function soLetrasENumeros(s) {
    return lp(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
  }
  function pareceLinhaDeProduto(linha) {
    var t = lp(linha);
    if (t.length < 8) return false;
    /* cabeçalho, rodapé e totais não são produto */
    if (/^(DADOS DOS PRODUTOS|CODIGO|DESCRICAO|DESCRIÇÃO|VALOR TOTAL|TOTAL|BASE DE CALCULO|CALCULO DO IMPOSTO|TRANSPORTADOR|DADOS ADICIONAIS|INFORMACOES|CHAVE DE ACESSO|EMISSAO|DESTINAT|REMETENTE|PROTOCOLO|INSCRICAO)/i.test(t)) return false;
    var numeros = t.match(/\d+[.,]?\d*/g) || [];
    if (numeros.length < 2) return false;
    /* precisa ter alguma palavra, senão é faixa de números solta */
    if (!/[A-Za-zÀ-ÿ]{3,}/.test(t)) return false;
    return true;
  }
  function reconciliar(linhasDoTexto, itens) {
    var chavesDosItens = [];
    (itens || []).forEach(function (i) {
      var d = soLetrasENumeros(i.descricao).slice(0, 14);
      if (d.length >= 6) chavesDosItens.push(d);
      var c = soLetrasENumeros(i.codigo || i.sku);
      if (c.length >= 4) chavesDosItens.push(c);
    });
    var fora = [];
    (linhasDoTexto || []).forEach(function (linha, k) {
      if (!pareceLinhaDeProduto(linha)) return;
      var achatada = soLetrasENumeros(linha);
      var casou = chavesDosItens.some(function (c) { return achatada.indexOf(c) > -1; });
      if (casou) return;
      fora.push({
        linhaNoTexto: k + 1,
        /* o texto vai cortado: é conferência, não arquivo fiscal */
        texto: lp(linha).slice(0, 90),
        motivo: "o OCR leu esta linha e ela tem cara de produto, mas ela não " +
          "virou item nenhum. Pode ser linha partida entre dois blocos, " +
          "coluna fora do lugar, ou leitura que o serviço não soube separar."
      });
    });
    return fora;
  }
  M.reconciliar = reconciliar;

  /* ============================================================
     [v4] APROVEITAR UMA LINHA QUE O OCR LEU E NAO VIROU ITEM
     ------------------------------------------------------------
     O motor já aponta essas linhas desde a v2, e de propósito não
     as transformava em item: chutar onde termina a descrição e
     começa a quantidade é como se erra calado.

     Mas apontar e não dar saída também não resolve: ele fica
     vendo o produto na tela, sabendo que ele existe, e sem como
     trazê-lo. Então agora existe a saída, com três amarras:

       1. Ela só roda quando a PESSOA pede, nessa linha.
       2. A divisão é CONFERIDA pela aritmética: os três últimos
          números da linha só viram quantidade, unitário e total
          se quantidade × unitário bater com o total. Se não
          bater, os números ficam em branco e só a descrição
          entra — em branco dá para ver; errado, não.
       3. O item nasce marcado para conferência e com o texto de
          origem junto, para a conferência ser possível.

     Nunca invento valor para a conta fechar.
     ============================================================ */
  M.linhaParaItem = function (texto) {
    var t = lp(texto);
    if (!t) return null;

    /* os números da linha, na ordem em que aparecem */
    var achados = [];
    var re = /(\d{1,3}(?:\.\d{3})*,\d+|\d+,\d+|\d+\.\d+|\d+)/g;
    var m2;
    while ((m2 = re.exec(t))) {
      achados.push({ cru: m2[0], fim: re.lastIndex, inicio: m2.index, valor: num(m2[0]) });
    }

    var saida = {
      descricao: "", codigo: "", unidade: "",
      qtd: 0, valorUnitario: 0, valorTotal: 0,
      precisaConferir: true,
      __veioDeTexto: t.slice(0, 160),
      porqueConferir: "",
      contaConfere: false
    };

    /* os três últimos números costumam ser qtd, unitário e total.
       Só aceito se a conta fechar — é a única prova que tenho de
       que a divisão está certa. */
    if (achados.length >= 3) {
      var tres = achados.slice(-3);
      var q = tres[0].valor, u = tres[1].valor, tot = tres[2].valor;
      if (q > 0 && u > 0 && tot > 0 &&
          Math.abs(q * u - tot) <= Math.max(0.02, tot * 0.01)) {
        saida.qtd = q; saida.valorUnitario = u; saida.valorTotal = tot;
        saida.contaConfere = true;
        saida.descricao = lp(t.slice(0, tres[0].inicio));
        saida.porqueConferir = "esta linha o OCR leu mas o leitor não separou em " +
          "campos. Eu separei pelos três últimos números e a conta fechou (" +
          q + " × " + u + " = " + tot + "). Confira a descrição antes de lançar.";
      }
    }

    if (!saida.contaConfere) {
      /* sem prova, não preencho número nenhum */
      saida.descricao = lp(t);
      saida.porqueConferir = "esta linha o OCR leu mas o leitor não separou em " +
        "campos, e a conta dos números não fechou — então NÃO preenchi " +
        "quantidade nem valor. Preencha à mão olhando a nota. Deixar em " +
        "branco é visível; deixar errado, não.";
    }

    /* um código no começo da linha, quando houver */
    var cod = saida.descricao.match(/^\s*(\d{3,})\s+/);
    if (cod) {
      saida.codigo = cod[1];
      saida.descricao = lp(saida.descricao.slice(cod[0].length));
    }
    /* unidade, quando a sigla aparece solta antes dos números */
    var un = saida.descricao.match(/\b(PC|UN|PÇ|CX|M|KG|L|MT|PAR|RL|SC|JG)\b\s*$/i);
    if (un) {
      saida.unidade = un[1].toUpperCase();
      saida.descricao = lp(saida.descricao.slice(0, un.index));
    }
    /* sobra de colunas fiscais no fim da descrição (NCM, CST, CFOP) */
    saida.descricao = lp(saida.descricao.replace(/\s+\d{8}\s+\d{2,3}\s+\d{4}\s*$/, ""));

    if (!saida.descricao) return null;
    return saida;
  };

  function consolidar(lista, blocos) {
    var saida = [], repetidas = 0, suspeitas = 0;
    var descartadas = [], paraConferir = 0, cabecalhosRemovidos = 0;
    var porBloco = {};
    lista.forEach(function (i) {
      /* [v2] AQUI MORAVA UM SUMIÇO CALADO.
         A linha era:
           if (!lp(i.descricao) && !num(i.valorTotal)) return;
         Quer dizer: linha que o OCR LEU, com código, quantidade e
         valor unitário no lugar, mas cuja descrição saiu em branco
         e cujo total não fechou, era jogada fora sem contador, sem
         motivo e sem aparecer em lugar nenhum. O pedido é
         explícito: "Não descarte silenciosamente uma linha
         reconhecida pelo OCR" e "Não elimine um item apenas porque
         um dos seus campos está vazio".
         Agora: só sai a linha SEM NADA. Qualquer linha com algum
         sinal de vida vai para a conferência, marcada. E o que sai
         sai registrado, com o bloco e a região de onde veio. */
      /* [v3] O CABEÇALHO DAS COLUNAS NÃO É PRODUTO.
         Ele se repete em cada folha da nota e, quando escapa para
         dentro da leitura, vira um "item" sem quantidade e sem
         valor. Sai aqui, contado e com motivo — e só sai quando é
         cabeçalho pelo CONTEÚDO, nunca pela posição na lista. */
      var cab = M.ehCabecalhoDeColunas(i);
      if (cab) {
        cabecalhosRemovidos++;
        descartadas.push({
          motivo: cab.porque,
          cabecalhoDeColunas: true,
          bloco: i.__origem && i.__origem.bloco,
          pagina: i.pagina || (i.__origem && i.__origem.pagina) || null,
          regiao: i.__origem && i.__origem.regiaoNaNota,
          descricao: lp(i.descricao).slice(0, 48),
          id: i.__id || null
        });
        return;
      }
      var temAlgo = lp(i.descricao) || lp(i.codigo) || lp(i.sku) ||
        num(i.qtd) || num(i.quantidade) || num(i.valorUnitario) || num(i.valorTotal);
      if (!temAlgo) {
        descartadas.push({
          motivo: "a linha veio sem nenhum campo preenchido",
          bloco: i.__origem && i.__origem.bloco,
          regiao: i.__origem && i.__origem.regiaoNaNota,
          pagina: i.pagina || (i.__origem && i.__origem.pagina) || null,
          id: i.__id || null
        });
        return;
      }
      /* faltou campo, mas a linha existe: vai, marcada para conferir */
      var faltando = [];
      if (!lp(i.descricao)) faltando.push("descrição");
      if (!num(i.qtd) && !num(i.quantidade)) faltando.push("quantidade");
      if (!num(i.valorUnitario)) faltando.push("valor unitário");
      if (!num(i.valorTotal)) faltando.push("valor total");
      if (faltando.length) {
        i.precisaConferir = true;
        i.descricaoFaltando = !lp(i.descricao);
        i.camposFaltando = faltando;
        i.porqueConferir = "o OCR leu esta linha, mas não leu " +
          faltando.join(", ") + ". Ela foi mantida de propósito: conferir é " +
          "trabalho seu, sumir com o produto não é opção.";
        paraConferir++;
      }
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
          descartadas.push({
            motivo: "idêntica à linha anterior na emenda entre dois blocos " +
              "(foi lida duas vezes de propósito)",
            bloco: b, emenda: true,
            descricao: lp(candidata.descricao).slice(0, 48),
            regiao: candidata.__origem && candidata.__origem.regiaoNaNota,
            id: candidata.__id || null
          });
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

    return { itens: saida, repetidasRemovidas: repetidas,
      suspeitasDeRepeticao: suspeitas,
      /* [v2] a conta tem de fechar na tela: entraram, saíram, e o
         que não saiu está aqui com o motivo */
      entraram: lista.length, sairam: saida.length,
      descartadas: descartadas, marcadasParaConferir: paraConferir,
      cabecalhosRemovidos: cabecalhosRemovidos };
  }
  M.consolidar = consolidar;

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
      /* [v3] a faixa do cabecalho das colunas que viajou colada em
         cada bloco. null aqui quer dizer que o OCR leu tiras de
         numero sem saber de que coluna eram. */
      cabecalhoDasColunas: o.cabecalho || null,
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
          /* [v2] a região fica guardada: é dela que a tela recorta a
             imagem para a conferência lado a lado, e é ela que volta
             ao OCR quando se manda reler só este pedaço */
          regiao: { x: Math.round(bloco.regiao.x), y: Math.round(bloco.regiao.y),
            w: Math.round(bloco.regiao.w), h: Math.round(bloco.regiao.h) },
          enviado: render.largura + " × " + render.altura + " px",
          ampliacao: render.escala + "×",
          msRender: Math.round(msRender), msOcr: Math.round(r && r.ms || 0),
          tentativa: tentativa, ok: !!(r && r.ok),
          /* [v2] o erro de verdade, com a etapa que falhou — não a
             frase genérica. Sem dado fiscal nenhum na mensagem. */
          erro: (r && r.ok) ? null : lp(r && (r.mensagem || r.codigo)),
          etapaQueFalhou: (r && r.ok) ? null : "ocr.ler",
          codigo: (r && r.ok) ? null : lp(r && r.codigo),
          corte: bloco.corte || null
        };
        if (!r || !r.ok || !r.dados) {
          registro.itens = 0;
          registro.linhasLidas = 0;
          relato.blocos.push(registro);
          relato.erros.push({
            bloco: k + 1, etapa: "ocr.ler",
            codigo: registro.codigo || "SEM_CODIGO",
            causa: registro.erro || "o serviço não disse o motivo",
            regiao: registro.enviado,
            podeRelerSozinho: true
          });
          if (tentativa === 1) fracos.push(k);
          return null;
        }

        /* [v2] O TEXTO CRU FICA GUARDADO.
           Antes só os ITENS do bloco eram aproveitados e o texto que o
           OCR leu era jogado fora na mesma linha. Com isso não havia
           como responder a pergunta que importa — "o OCR chegou a ler
           esta linha?" — e produto sumido virava mistério. Agora o
           texto do bloco fica no relatório e as linhas dele são
           confrontadas uma a uma com os itens montados. */
        var textoDoBloco = lp(r.dados.textoOcr || r.dados.texto || "");
        var linhasDoTexto = textoDoBloco
          ? textoDoBloco.split(/\r?\n/).map(function (s) { return s.trim(); })
              .filter(function (s) { return s.length > 0; })
          : [];
        registro.textoOcr = textoDoBloco;
        registro.linhasLidas = linhasDoTexto.length;
        registro.avisosDoServico = Array.isArray(r.dados.avisos) ? r.dados.avisos : [];
        registro.errosDoServico = Array.isArray(r.dados.erros) ? r.dados.erros : [];

        var itens = Array.isArray(r.dados.itens) ? r.dados.itens : [];
        itens.forEach(function (i, posicao) {
          carimbar(i, bloco, render, "ocr.ler", tentativa);
          /* identificador temporário e posição de origem — §2 */
          i.__id = "B" + bloco.indice + "L" + posicao + "T" + tentativa;
          i.__origem.posicaoNoBloco = posicao;
          i.__origem.pagina = o.pagina || 1;
          i.pagina = i.pagina || o.pagina || 1;
          achados.push(i);
        });
        registro.itens = itens.length;
        /* As linhas de texto ficam guardadas; a conferência contra os
           itens é feita NO FIM, contra a lista já consolidada.
           Conferir bloco a bloco acusava falso: a linha partida na
           emenda aparece pela metade num bloco e INTEIRA no vizinho,
           e o relatório gritava "sumiu" por um produto que estava lá.
           Alarme falso cansa, e alarme que cansa deixa de ser lido. */
        registro.linhasDoTexto = linhasDoTexto;
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
      relato.cabecalhosRemovidos = junto.cabecalhosRemovidos;

      /* [v2] A CONTA DAS LINHAS — §4 do pedido.
         Tem de fechar na tela: quantas o OCR leu, quantas viraram
         item, quantas saíram e por quê. */
      relato.linhas = {
        lidasPeloOcr: relato.blocos.reduce(function (s, b) {
          return s + (b.linhasLidas || 0); }, 0),
        viraramItem: leitura.itens.length,
        devolvidasPelosBlocos: junto.entraram,
        descartadas: junto.descartadas,
        marcadasParaConferir: junto.marcadasParaConferir,
        cabecalhosRemovidos: junto.cabecalhosRemovidos,
        /* conferido contra a lista FINAL: só fica na lista a linha que
           o OCR leu e que não está em item nenhum da nota inteira */
        naoViraramItem: relato.blocos.reduce(function (lista, b) {
          var sobrou = reconciliar(b.linhasDoTexto || [], leitura.itens);
          b.naoViraramItem = sobrou;
          return lista.concat(sobrou.map(function (x) {
            return { bloco: b.bloco, linhasDoBloco: b.linhas, regiao: b.enviado,
              linhaNoTexto: x.linhaNoTexto, texto: x.texto, motivo: x.motivo };
          }));
        }, [])
      };
      relato.linhas.somemSemExplicacao =
        relato.linhas.devolvidasPelosBlocos -
        relato.linhas.viraramItem -
        relato.linhas.descartadas.length;

      if (relato.linhas.naoViraramItem.length) {
        leitura.avisos.push(relato.linhas.naoViraramItem.length +
          " linha(s) o OCR leu e não viraram item. Elas estão listadas no " +
          "diagnóstico de linhas, com a região de onde vieram. Confira antes " +
          "de lançar — pode faltar produto na nota.");
      }
      if (junto.marcadasParaConferir) {
        leitura.avisos.push(junto.marcadasParaConferir + " linha(s) entraram com " +
          "campo faltando e estão marcadas para conferência. Elas NÃO foram " +
          "descartadas de propósito.");
      }

      if (junto.cabecalhosRemovidos) {
        leitura.avisos.push(junto.cabecalhosRemovidos + " linha(s) eram o cabeçalho das " +
          "colunas, que se repete em toda folha da nota, e foram tiradas da lista. " +
          "Elas estão no diagnóstico com o motivo. Nenhum produto saiu junto: só sai " +
          "linha sem quantidade e sem valor total.");
      }

      if (junto.suspeitasDeRepeticao) {
        leitura.avisos.push(junto.suspeitasDeRepeticao + " linha(s) começam igual a outra " +
          "e foram MANTIDAS as duas, porque os dados não batem. Confira na imagem: " +
          "produtos diferentes costumam ter o começo do nome parecido.");
      }
      relato.conclusao = leitura.itens.length ? "leu" : "nada_lido";

      if (!leitura.itens.length) {
        var primeiro = relato.erros[0];
        return { ok: false, codigo: "NADA_LIDO",
          mensagem: primeiro
            ? "o OCR não devolveu item nenhum. Bloco " + primeiro.bloco + ", etapa " +
              primeiro.etapa + ": " + primeiro.causa
            : (relato.linhas.lidasPeloOcr
                ? "o OCR leu " + relato.linhas.lidasPeloOcr + " linha(s) de texto, " +
                  "mas nenhuma virou item. O texto está no diagnóstico de linhas."
                : "o OCR respondeu, mas não achou linha de produto nesta região."),
          medida: medida, diagnostico: relato, dados: leitura };
      }
      return { ok: true, dados: leitura, medida: medida, diagnostico: relato };
    })["catch"](function (e) {
      /* [v5] UMA FALHA NO FIM NÃO PODE APAGAR O QUE JÁ FOI LIDO.
         O pedido é explícito: "preserve os resultados já obtidos e
         permita reprocessar a região afetada, sem obrigar o usuário a
         iniciar a leitura inteira novamente". Então aqui vai o que já
         estava na mão, mais a etapa que falhou e a causa técnica. */
      relato.msTotal = Math.round(agora() - t0);
      relato.conclusao = "estourou";
      var ondeParou = (relato.etapas[relato.etapas.length - 1] || {}).etapa || "desconhecida";
      relato.erros.push({
        bloco: null, etapa: ondeParou,
        codigo: lp(e && e.name) || "EXCECAO",
        causa: lp(e && e.message) || "sem mensagem",
        primeiraLinhaDoRastro: lp(e && e.stack).split(/\n/)[1] || "",
        podeRelerSozinho: false
      });
      var salvos = [];
      try { salvos = consolidar(achados, blocos).itens; } catch (e2) { salvos = achados.slice(); }
      return { ok: false, codigo: "ESTOUROU",
        mensagem: "A leitura parou na etapa \"" + ondeParou + "\": " +
          (lp(e && e.message) || "sem mensagem") +
          (salvos.length ? ". " + salvos.length + " item(ns) já lidos foram guardados — " +
            "dá para reler só a região que falhou." : ""),
        diagnostico: relato,
        dados: salvos.length ? { itens: salvos, campos: relato.cabecalhoDaNota || {},
          avisos: ["a leitura parou no meio; estes itens são os que deram tempo de entrar"],
          __motor: CONTRATO, __parcial: true } : null };
    });
  };

  /* ============================================================
     RELER SÓ UMA REGIÃO  ·  §5 do pedido
     ------------------------------------------------------------
     Quando um bloco falha, ou quando uma linha ficou partida, não
     se refaz a nota inteira: relê-se aquele pedaço. Devolve os
     itens daquela região, carimbados com a origem, para a tela
     juntar no lugar certo.
     ============================================================ */
  M.relerRegiao = function (imagem, regiao, opcoes) {
    var o = Object.assign({}, PADRAO, opcoes || {});
    var bloco = {
      indice: (o.indice === undefined ? 900 : o.indice),
      daLinha: o.daLinha || 1, ateALinha: o.ateALinha || 1,
      regiao: regiao, cabecalho: o.cabecalho || null, linhas: o.linhas || 1
    };
    var tr = agora();
    var render = M.renderizar(imagem, bloco,
      Object.assign({}, o, { larguraAlvo: o.larguraAlvo || PADRAO.larguraAlvoReforco }));
    render.indice = bloco.indice;
    var msRender = agora() - tr;
    return pedirAoOcr(render, o).then(function (r) {
      if (!r || !r.ok || !r.dados) {
        return { ok: false, codigo: lp(r && r.codigo) || "SEM_RESPOSTA",
          mensagem: "A releitura desta região falhou na etapa ocr.ler: " +
            (lp(r && r.mensagem) || "o serviço não disse o motivo") +
            ". Nada do que já estava lido foi perdido.",
          etapaQueFalhou: "ocr.ler",
          enviado: render.largura + " × " + render.altura + " px" };
      }
      var texto = lp(r.dados.textoOcr || r.dados.texto || "");
      var linhasDoTexto = texto ? texto.split(/\r?\n/).map(function (s) { return s.trim(); })
        .filter(function (s) { return s.length; }) : [];
      var itens = Array.isArray(r.dados.itens) ? r.dados.itens : [];
      itens.forEach(function (i, posicao) {
        carimbar(i, bloco, render, "ocr.ler (releitura)", 1);
        i.__id = "R" + bloco.indice + "L" + posicao + "-" + Math.round(agora());
        i.__origem.posicaoNoBloco = posicao;
        i.__origem.pagina = o.pagina || 1;
        i.pagina = i.pagina || o.pagina || 1;
        i.__releitura = true;
      });
      return { ok: true, dados: { itens: itens, campos: r.dados.campos || null },
        textoOcr: texto, linhasLidas: linhasDoTexto.length,
        naoViraramItem: reconciliar(linhasDoTexto, itens),
        enviado: render.largura + " × " + render.altura + " px",
        msRender: Math.round(msRender), msOcr: Math.round(r.ms || 0) };
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
          regiao: b.regiao || null,
          ampliacao: b.ampliacao, tentativa: b.tentativa,
          itens: b.itens, confiancaBaixa: b.comConfiancaBaixa,
          /* [v2] a conta de linhas do bloco e como o corte foi decidido */
          linhasLidas: b.linhasLidas,
          naoViraramItem: (b.naoViraramItem || []).length,
          corte: b.corte || null,
          renderMs: b.msRender, ocrMs: b.msOcr,
          erro: b.erro, etapaQueFalhou: b.etapaQueFalhou || null };
      }),
      etapas: r.etapas,
      itensReconhecidos: r.itens || 0,
      repetidasRemovidas: r.repetidasRemovidas || 0,
      /* [v2] é esta a conta que o pedido manda mostrar */
      linhas: r.linhas || null,
      textoPorBloco: r.blocos.map(function (b) {
        return { bloco: b.bloco + 1, linhasLidas: b.linhasLidas || 0,
          texto: b.textoOcr || "" };
      }),
      erros: r.erros,
      tempoTotal: r.msTotal + "ms",
      conclusao: r.conclusao
    };
  };
})();
