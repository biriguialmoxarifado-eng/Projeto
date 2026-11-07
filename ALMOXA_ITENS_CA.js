/**
 * ============================================================
 *  ALMOXA_ITENS_CA  ·  07/11/2026  ·  busca: [ITENSCA]
 * ------------------------------------------------------------
 *  GRAVA O CA E A VALIDADE DO CA NA ABA DE ITENS.
 *
 *  POR QUE ESTE ARQUIVO EXISTE
 *
 *  O módulo "itens" do Core GRAVA A LINHA POR POSIÇÃO: ele monta
 *  a sequência de valores na ordem antiga das colunas e despeja
 *  de uma vez. Foi o que embaralhou a linha do óculos quando a
 *  coluna do CA foi acrescentada no meio da aba — o valor de
 *  "categoria" caiu na casa do CA e tudo andou uma casa.
 *
 *  Este arquivo faz o contrário, e é essa a diferença inteira:
 *
 *    1. acha a coluna PELO NOME do cabeçalho, nunca pela posição;
 *    2. escreve UMA CÉLULA de cada vez — nunca a linha toda;
 *    3. não encosta em nenhuma outra coluna.
 *
 *  Por isso ele funciona com a coluna em qualquer lugar da aba,
 *  e nunca desalinha nada.
 *
 * ------------------------------------------------------------
 *  O QUE ELE NÃO FAZ, DE PROPÓSITO
 *
 *  - não altera o seu módulo "itens". Nada aqui sobrescreve o que
 *    já existe: são funções com nome próprio, num arquivo próprio;
 *  - não cria coluna sozinho. Criar coluna é mudar a estrutura da
 *    planilha, e isso é decisão sua: existe uma função separada,
 *    AP_ITENSCA_criarColunas(), que você roda quando quiser, e ela
 *    põe as colunas NO FIM da aba, onde não empurram nada;
 *  - não apaga nem reescreve linha nenhuma;
 *  - não inventa item. SKU que não existe na aba é recusado;
 *  - SKU repetido é recusado também: não escolho entre dois.
 *
 * ------------------------------------------------------------
 *  COMO INSTALAR
 *
 *  1. Planilha → Extensões → Apps Script
 *  2. Arquivo novo (+ ao lado de "Arquivos") → Script → nome:
 *     ALMOXA_ITENS_CA
 *  3. Cole este conteúdo inteiro e salve
 *  4. Rode UMA VEZ a função AP_ITENSCA_conferir() e leia o
 *     registro (Ver → Registro de execução). Ela não grava nada:
 *     só diz o que achou.
 *
 *  Depois disso, para gravar:
 *     AP_ITENSCA_gravar('ALM-GER-000036', '39459', '16/09/2031')
 *
 * ============================================================
 */

/** O nome da aba dos itens. Mude aqui se um dia ela for renomeada. */
var AP_ITENSCA_ABA = 'ALMOXA_ITENS';

/** Os nomes de cabeçalho aceitos para cada campo, em ordem de preferência.
 *  A comparação ignora maiúsculas, acentos, espaços e sublinhados — então
 *  "CA", "ca", "Ca" e "C.A." caem todos no mesmo lugar. */
var AP_ITENSCA_NOMES = {
  sku:       ['sku', 'codigo', 'codigointerno', 'item'],
  ca:        ['ca', 'numeroca', 'canumero', 'certificadoaprovacao'],
  validade:  ['cavalidade', 'validadeca', 'cavencimento', 'validadedoca',
              'vencimentoca']
};

/* ============================================================
   1. FERRAMENTAS PEQUENAS
   ============================================================ */

function AP_ITENSCA_lp_(v) {
  return (v === null || v === undefined) ? '' : String(v).trim();
}

/** tira acento, espaço, pontuação e caixa: é assim que eu comparo
 *  cabeçalho, para "Validade do CA" bater com "cavalidade". */
function AP_ITENSCA_chave_(v) {
  var s = AP_ITENSCA_lp_(v).toLowerCase();
  s = s.replace(/[áàâãä]/g, 'a').replace(/[éèêë]/g, 'e')
       .replace(/[íìîï]/g, 'i').replace(/[óòôõö]/g, 'o')
       .replace(/[úùûü]/g, 'u').replace(/[ç]/g, 'c');
  return s.replace(/[^a-z0-9]/g, '');
}

function AP_ITENSCA_aba_() {
  var pl = SpreadsheetApp.getActiveSpreadsheet();
  if (!pl) throw new Error('Não achei a planilha ativa.');
  var aba = pl.getSheetByName(AP_ITENSCA_ABA);
  if (!aba) {
    var nomes = pl.getSheets().map(function (s) { return s.getName(); });
    throw new Error('Não achei a aba "' + AP_ITENSCA_ABA + '". ' +
      'As abas desta planilha são: ' + nomes.join(', ') + '. ' +
      'Se o nome for outro, mude a linha AP_ITENSCA_ABA lá em cima.');
  }
  return aba;
}

/** Lê a linha 1 e devolve, para cada campo, em qual coluna ele está.
 *  Coluna 0 quer dizer: não existe. */
function AP_ITENSCA_colunas_(aba) {
  var larg = aba.getLastColumn();
  if (larg < 1) throw new Error('A aba "' + AP_ITENSCA_ABA + '" está vazia.');
  var cab = aba.getRange(1, 1, 1, larg).getValues()[0];

  var mapa = {};
  for (var c = 0; c < cab.length; c++) {
    var k = AP_ITENSCA_chave_(cab[c]);
    if (k && mapa[k] === undefined) mapa[k] = c + 1;   /* 1ª ocorrência manda */
  }

  function achar(lista) {
    for (var i = 0; i < lista.length; i++) {
      if (mapa[lista[i]]) return mapa[lista[i]];
    }
    return 0;
  }

  return {
    sku: achar(AP_ITENSCA_NOMES.sku),
    ca: achar(AP_ITENSCA_NOMES.ca),
    validade: achar(AP_ITENSCA_NOMES.validade),
    largura: larg,
    cabecalhos: cab.map(function (x) { return AP_ITENSCA_lp_(x); })
  };
}

/** Acha a linha do SKU. Devolve 0 se não existe, -1 se existe mais de uma. */
function AP_ITENSCA_linhaDo_(aba, col, sku) {
  var alvo = AP_ITENSCA_chave_(sku);
  if (!alvo) return 0;
  var ult = aba.getLastRow();
  if (ult < 2) return 0;
  var vals = aba.getRange(2, col.sku, ult - 1, 1).getValues();
  var achada = 0;
  for (var i = 0; i < vals.length; i++) {
    if (AP_ITENSCA_chave_(vals[i][0]) === alvo) {
      if (achada) return -1;            /* duas linhas com o mesmo SKU */
      achada = i + 2;
    }
  }
  return achada;
}

/** A data como texto dd/mm/aaaa, aceitando o que vier. */
function AP_ITENSCA_data_(v) {
  var s = AP_ITENSCA_lp_(v);
  if (!s) return '';
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);            /* 2031-09-16 */
  if (m) return m[3] + '/' + m[2] + '/' + m[1];
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;         /* 16/09/2031 */
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    function dd(n) { return (n < 10 ? '0' : '') + n; }
    return dd(v.getDate()) + '/' + dd(v.getMonth() + 1) + '/' + v.getFullYear();
  }
  return s;                                              /* não entendi: devolvo como veio */
}

/* ============================================================
   2. CONFERIR — não grava nada, só conta o que achou
   ============================================================ */
/**
 * Rode esta primeiro. Ela diz, no registro de execução:
 *   - se achou a aba
 *   - em que coluna está o SKU, o CA e a validade
 *   - se as colunas do CA estão no FIM da aba (que é onde devem ficar)
 *   - quantas linhas parecem DESALINHADAS, com exemplos
 */
function AP_ITENSCA_conferir() {
  var r = AP_ITENSCA_conferirDados_();
  Logger.log(JSON.stringify(r, null, 2));
  return r;
}

function AP_ITENSCA_conferirDados_() {
  var saida = { ok: false, aba: AP_ITENSCA_ABA };
  var aba;
  try { aba = AP_ITENSCA_aba_(); }
  catch (e) { saida.erro = String(e.message || e); return saida; }

  var col = AP_ITENSCA_colunas_(aba);
  saida.cabecalhos = col.cabecalhos;
  saida.colunaSku = col.sku;
  saida.colunaCa = col.ca;
  saida.colunaValidade = col.validade;
  saida.linhas = Math.max(0, aba.getLastRow() - 1);

  if (!col.sku) {
    saida.erro = 'Não achei a coluna do SKU. Cabeçalhos: ' + col.cabecalhos.join(', ');
    return saida;
  }
  if (!col.ca) {
    saida.falta = 'A coluna do CA não existe. Rode AP_ITENSCA_criarColunas() ' +
                  'para criá-la no FIM da aba.';
    return saida;
  }

  saida.caNoFim = (col.ca >= col.largura - 1);
  if (!saida.caNoFim) {
    saida.aviso = 'A coluna do CA está na posição ' + col.ca + ' de ' + col.largura +
      ' — ou seja, NO MEIO da aba. O módulo itens do Core grava a linha POR ' +
      'POSIÇÃO, então toda vez que ele salvar um item essa linha vai desalinhar. ' +
      'O certo é a coluna do CA ficar no fim. Este arquivo funciona dos dois ' +
      'jeitos, mas o Core não.';
  }
  if (!col.validade) {
    saida.avisoValidade = 'A coluna da validade do CA não existe. ' +
      'AP_ITENSCA_criarColunas() cria as duas.';
  }

  /* linhas suspeitas: CA preenchido com coisa que não é número de CA */
  var tortas = [];
  var ult = aba.getLastRow();
  if (ult >= 2) {
    var dados = aba.getRange(2, 1, ult - 1, col.largura).getValues();
    for (var i = 0; i < dados.length && tortas.length < 20; i++) {
      var vCa = AP_ITENSCA_lp_(dados[i][col.ca - 1]);
      if (!vCa) continue;
      if (/^[0-9]{3,7}$/.test(vCa)) continue;            /* CA de verdade */
      tortas.push({ linha: i + 2,
                    sku: AP_ITENSCA_lp_(dados[i][col.sku - 1]),
                    caTem: vCa });
    }
  }
  saida.suspeitas = tortas;
  if (tortas.length) {
    saida.avisoSuspeitas = tortas.length + ' linha(s) com algo na coluna do CA que ' +
      'não parece número de CA. Confira: pode ser valor de outra coluna que caiu ali.';
  }

  saida.ok = true;
  return saida;
}

/* ============================================================
   2-B. BACKUP — antes de qualquer coisa
   ------------------------------------------------------------
   Copia a aba de itens inteira para uma aba nova, com a data e a
   hora no nome. Não altera a original, não apaga nada, não
   sobrescreve backup anterior.

   Rode antes de consertar linha torta. Linha torta consertada
   errado é pior que linha torta.
   ============================================================ */
function AP_ITENSCA_backup() {
  var pl = SpreadsheetApp.getActiveSpreadsheet();
  var aba = AP_ITENSCA_aba_();
  var agora = new Date();
  function dd(n) { return (n < 10 ? '0' : '') + n; }
  var carimbo = agora.getFullYear() + dd(agora.getMonth() + 1) + dd(agora.getDate()) +
                '_' + dd(agora.getHours()) + dd(agora.getMinutes());
  var nome = 'BKP_' + AP_ITENSCA_ABA + '_' + carimbo;

  /* nunca sobrescrevo um backup: se já existe, ponho um sufixo */
  var tentativa = nome, n = 2;
  while (pl.getSheetByName(tentativa)) { tentativa = nome + '_' + n; n++; }

  var copia = aba.copyTo(pl);
  copia.setName(tentativa);

  var r = { ok: true, backup: tentativa,
            linhas: Math.max(0, aba.getLastRow() - 1),
            colunas: aba.getLastColumn(),
            recado: 'Cópia feita. A aba original não foi tocada. ' +
                    'Para descartar o backup depois, apague a aba "' + tentativa + '" na mão.' };
  Logger.log(JSON.stringify(r, null, 2));
  return r;
}

/* ============================================================
   2-C. RELATÓRIO DE DESALINHAMENTO
   ------------------------------------------------------------
   Responde à pergunta "quantos registros podem estar
   comprometidos", que é a que importa antes de mexer em
   qualquer coisa.

   COMO EU SEI QUE UMA LINHA ESTÁ TORTA. O desalinhamento tem uma
   assinatura que não acontece por acaso: o valor da coluna do CA
   é igual, letra por letra, ao valor que DEVERIA estar na coluna
   seguinte — porque a gravação por posição empurrou tudo uma casa.
   Então eu procuro duas marcas juntas:

     1. a coluna do CA tem algo que não é número de CA;
     2. e esse algo bate com o conteúdo típico da coluna vizinha
        (categoria), ou a vizinha ficou vazia.

   Uma marca sozinha é suspeita. As duas juntas é desalinhamento.

   NÃO CONSERTA NADA. Só conta e lista, como você pediu.
   ============================================================ */
function AP_ITENSCA_relatorioDesalinhamento() {
  var r = AP_ITENSCA_relatorioDados_();
  Logger.log(JSON.stringify(r, null, 2));
  return r;
}

function AP_ITENSCA_relatorioDados_() {
  var saida = { ok: false, aba: AP_ITENSCA_ABA };
  var aba;
  try { aba = AP_ITENSCA_aba_(); }
  catch (e) { saida.erro = String(e.message || e); return saida; }

  var col = AP_ITENSCA_colunas_(aba);
  saida.cabecalhosReais = [];
  for (var c = 0; c < col.cabecalhos.length; c++) {
    saida.cabecalhosReais.push({ coluna: c + 1, nome: col.cabecalhos[c] });
  }
  saida.posicaoDoCa = col.ca || null;
  saida.posicaoDaValidade = col.validade || null;
  saida.totalDeColunas = col.largura;

  if (!col.sku) { saida.erro = 'Não achei a coluna do SKU.'; return saida; }
  if (!col.ca) {
    saida.recado = 'A coluna do CA não existe: não há como estar desalinhada.';
    saida.ok = true; saida.tortas = []; saida.quantas = 0;
    return saida;
  }

  /* a coluna logo depois do CA é a que foi empurrada */
  var vizinha = (col.ca + 1 <= col.largura) ? col.ca + 1 : 0;
  saida.colunaVizinha = vizinha ? col.cabecalhos[vizinha - 1] : null;

  var ult = aba.getLastRow();
  var tortas = [], suspeitas = [], total = 0;
  if (ult >= 2) {
    var dados = aba.getRange(2, 1, ult - 1, col.largura).getValues();
    for (var i = 0; i < dados.length; i++) {
      total++;
      var vCa = AP_ITENSCA_lp_(dados[i][col.ca - 1]);
      if (!vCa) continue;
      if (/^[0-9]{3,7}$/.test(vCa)) continue;          /* CA de verdade: tudo bem */

      var vViz = vizinha ? AP_ITENSCA_lp_(dados[i][vizinha - 1]) : '';
      var achado = { linha: i + 2,
                     sku: AP_ITENSCA_lp_(dados[i][col.sku - 1]),
                     noCa: vCa,
                     naVizinha: vViz,
                     vizinhaVazia: !vViz };
      /* as duas marcas juntas = desalinhamento */
      if (!vViz || AP_ITENSCA_chave_(vViz) === AP_ITENSCA_chave_(vCa)) tortas.push(achado);
      else suspeitas.push(achado);
    }
  }

  saida.linhasLidas = total;
  saida.quantas = tortas.length;
  saida.tortas = tortas.slice(0, 50);
  saida.suspeitas = suspeitas.slice(0, 50);
  saida.resumo = tortas.length
    ? tortas.length + ' linha(s) com assinatura de DESALINHAMENTO: a coluna do CA ' +
      'contém o valor que deveria estar em "' + (saida.colunaVizinha || '?') + '". ' +
      'Rode AP_ITENSCA_backup() antes de consertar qualquer uma.'
    : 'Nenhuma linha com assinatura de desalinhamento.' +
      (suspeitas.length ? ' Mas há ' + suspeitas.length +
        ' com algo estranho na coluna do CA — confira na mão.' : '');
  saida.ok = true;
  return saida;
}

/* ============================================================
   3. CRIAR AS COLUNAS — você roda, de propósito, uma vez só
   ============================================================ */
/**
 * Cria as colunas "ca" e "caValidade" NO FIM da aba.
 *
 * No fim, e não no meio, por um motivo concreto: o módulo itens do
 * Core grava a linha por posição. Coluna acrescentada no meio empurra
 * todas as seguintes e faz o Core escrever cada valor uma casa fora
 * do lugar. No fim da aba ela fica fora do alcance dessa gravação.
 *
 * Não mexe em nenhuma coluna existente e não repete coluna que já
 * exista.
 */
function AP_ITENSCA_criarColunas() {
  var aba = AP_ITENSCA_aba_();
  var col = AP_ITENSCA_colunas_(aba);
  var criadas = [];

  if (!col.ca) {
    var c1 = aba.getLastColumn() + 1;
    aba.getRange(1, c1).setValue('ca');
    criadas.push({ nome: 'ca', coluna: c1 });
  }
  col = AP_ITENSCA_colunas_(aba);
  if (!col.validade) {
    var c2 = aba.getLastColumn() + 1;
    aba.getRange(1, c2).setValue('caValidade');
    criadas.push({ nome: 'caValidade', coluna: c2 });
  }

  var r = { ok: true, criadas: criadas,
            jaExistiam: criadas.length === 0,
            recado: criadas.length
              ? 'Criei no fim da aba. Nenhuma coluna existente foi movida.'
              : 'As duas colunas já existiam. Não mexi em nada.' };
  Logger.log(JSON.stringify(r, null, 2));
  return r;
}

/* ============================================================
   4. GRAVAR — o motivo de tudo isto
   ============================================================ */
/**
 * Grava o CA (e, se vier, a validade) de UM item.
 *
 *   AP_ITENSCA_gravar('ALM-GER-000036', '39459', '16/09/2031')
 *
 * Escreve só as células do CA e da validade daquela linha. Não
 * reescreve a linha, não encosta nas outras colunas, e devolve o
 * que estava lá antes — para dar para voltar atrás se preciso.
 *
 * Para APAGAR o CA de um item, passe string vazia no lugar do
 * número. É a única forma de limpar, e ela é explícita.
 */
function AP_ITENSCA_gravar(sku, ca, validade) {
  var r = { ok: false, sku: AP_ITENSCA_lp_(sku) };
  var aba;
  try { aba = AP_ITENSCA_aba_(); }
  catch (e) { r.mensagem = String(e.message || e); return r; }

  var col = AP_ITENSCA_colunas_(aba);
  if (!col.sku) { r.mensagem = 'Não achei a coluna do SKU na aba.'; return r; }
  if (!col.ca) {
    r.mensagem = 'A coluna do CA não existe na aba "' + AP_ITENSCA_ABA +
      '". Rode AP_ITENSCA_criarColunas() uma vez.';
    r.faltaColuna = true;
    return r;
  }

  var linha = AP_ITENSCA_linhaDo_(aba, col, sku);
  if (linha === 0) {
    r.mensagem = 'Não achei o SKU "' + r.sku + '" na aba. Não crio item novo aqui.';
    return r;
  }
  if (linha === -1) {
    r.mensagem = 'Existe mais de uma linha com o SKU "' + r.sku +
      '". Não escolho entre duas — conserte a duplicidade na planilha primeiro.';
    return r;
  }

  var novoCa = AP_ITENSCA_lp_(ca);
  var novaVal = AP_ITENSCA_data_(validade);

  r.linha = linha;
  r.antes = {
    ca: AP_ITENSCA_lp_(aba.getRange(linha, col.ca).getValue()),
    validade: col.validade
      ? AP_ITENSCA_lp_(aba.getRange(linha, col.validade).getValue()) : null
  };

  /* uma célula por vez. Nunca a linha. */
  aba.getRange(linha, col.ca).setValue(novoCa);
  r.gravouCa = true;

  if (novaVal) {
    if (col.validade) {
      aba.getRange(linha, col.validade).setValue(novaVal);
      r.gravouValidade = true;
    } else {
      r.avisoValidade = 'Gravei o CA, mas a coluna da validade não existe — ' +
        'a data não foi guardada. Rode AP_ITENSCA_criarColunas().';
    }
  }

  SpreadsheetApp.flush();

  /* RELER E CONFERIR. Só digo que gravei depois de ver de volta. */
  r.depois = {
    ca: AP_ITENSCA_lp_(aba.getRange(linha, col.ca).getValue()),
    validade: col.validade
      ? AP_ITENSCA_lp_(aba.getRange(linha, col.validade).getValue()) : null
  };
  if (AP_ITENSCA_chave_(r.depois.ca) !== AP_ITENSCA_chave_(novoCa)) {
    r.mensagem = 'Escrevi, mas a releitura trouxe "' + r.depois.ca +
      '" em vez de "' + novoCa + '". Pode haver proteção ou validação nessa célula.';
    return r;
  }

  r.ok = true;
  r.mensagem = 'CA gravado na linha ' + linha + ', coluna ' + col.ca +
    (r.gravouValidade ? ' · validade gravada na coluna ' + col.validade : '');
  return r;
}

/**
 * O mesmo, para vários itens de uma vez — é o "Aplicar este CA a
 * outros itens" da tela.
 *   AP_ITENSCA_gravarVarios(['SKU-1','SKU-2'], '39459', '16/09/2031')
 */
function AP_ITENSCA_gravarVarios(skus, ca, validade) {
  var lista = [];
  if (Object.prototype.toString.call(skus) === '[object Array]') lista = skus;
  else if (AP_ITENSCA_lp_(skus)) lista = [skus];

  var feitos = [], falhas = [];
  for (var i = 0; i < lista.length; i++) {
    var um = AP_ITENSCA_gravar(lista[i], ca, validade);
    if (um.ok) feitos.push(um.sku);
    else falhas.push({ sku: um.sku, motivo: um.mensagem });
  }
  return { ok: falhas.length === 0, feitos: feitos, falhas: falhas,
           mensagem: feitos.length + ' gravado(s)' +
                     (falhas.length ? ', ' + falhas.length + ' com problema' : '') };
}

/** Lê o CA de um item, sem gravar. Serve para conferir. */
function AP_ITENSCA_ler(sku) {
  var aba = AP_ITENSCA_aba_();
  var col = AP_ITENSCA_colunas_(aba);
  if (!col.sku || !col.ca) return { ok: false, mensagem: 'faltam colunas (sku ou ca)' };
  var linha = AP_ITENSCA_linhaDo_(aba, col, sku);
  if (linha <= 0) return { ok: false, mensagem: linha === -1 ? 'SKU repetido' : 'SKU não existe' };
  return { ok: true, sku: AP_ITENSCA_lp_(sku), linha: linha,
    ca: AP_ITENSCA_lp_(aba.getRange(linha, col.ca).getValue()),
    validade: col.validade
      ? AP_ITENSCA_lp_(aba.getRange(linha, col.validade).getValue()) : null };
}

/* ============================================================
   5. A PORTA DA TELA
   ------------------------------------------------------------
   O ALMOX-PRO chama esta função quando é servido pelo /exec:
     google.script.run.AP_ITENSCA_pelaTela(json)

   Ações: gravar | gravarVarios | ler | conferir | criarColunas
   Devolve sempre JSON em texto, porque é assim que o google.script.run
   entrega sem se perder no caminho.
   ============================================================ */
function AP_ITENSCA_pelaTela(json) {
  var o = {};
  try { o = JSON.parse(json || '{}'); } catch (e) { o = {}; }
  var r;
  try {
    if (o.acao === 'gravar') {
      r = AP_ITENSCA_gravar(o.sku, o.ca, o.validade);
    } else if (o.acao === 'gravarVarios') {
      r = AP_ITENSCA_gravarVarios(o.skus || [], o.ca, o.validade);
    } else if (o.acao === 'ler') {
      r = AP_ITENSCA_ler(o.sku);
    } else if (o.acao === 'criarColunas') {
      r = AP_ITENSCA_criarColunas();
    } else if (o.acao === 'conferir') {
      r = AP_ITENSCA_conferirDados_();
    } else if (o.acao === 'relatorio') {
      r = AP_ITENSCA_relatorioDados_();
    } else if (o.acao === 'backup') {
      r = AP_ITENSCA_backup();
    } else {
      r = { ok: false, mensagem: 'ação desconhecida: ' + AP_ITENSCA_lp_(o.acao) };
    }
  } catch (e) {
    r = { ok: false, mensagem: String((e && e.message) || e) };
  }
  return JSON.stringify(r);
}

/* ============================================================
   6. UM MENU NA PLANILHA
   ------------------------------------------------------------
   Para você poder conferir e criar as colunas sem abrir o editor
   de script. Se a sua planilha já tiver um onOpen em outro
   arquivo, os dois convivem: o Apps Script roda todos.
   ============================================================ */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('CA dos itens')
      .addItem('Conferir as colunas do CA', 'AP_ITENSCA_conferir')
      .addItem('Relatório de desalinhamento', 'AP_ITENSCA_relatorioDesalinhamento')
      .addSeparator()
      .addItem('Fazer backup da aba de itens', 'AP_ITENSCA_backup')
      .addItem('Criar as colunas no fim da aba', 'AP_ITENSCA_criarColunas')
      .addToUi();
  } catch (e) { /* sem interface (execução automática): tudo bem */ }
}
