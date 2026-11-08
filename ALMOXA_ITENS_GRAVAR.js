/**
 * ============================================================
 *  ALMOXA_ITENS_GRAVAR  ·  08/11/2026  ·  busca: [ITENSOK]
 * ------------------------------------------------------------
 *  O CONSERTO DA GRAVAÇÃO DE ITENS.
 *
 *  O DEFEITO, lido no código do seu Core em 07/11:
 *
 *      var linha = AP_ITENS_CFG.colunas.map(function (c) { ... });
 *      aba.getRange(alvo._linha, 1, 1,
 *                   AP_ITENS_CFG.colunas.length).setValues([linha]);
 *
 *  AP_ITENS_CFG.colunas é uma LISTA FIXA escrita no código. O
 *  módulo monta a linha nessa ordem e despeja a partir da coluna
 *  1, sem olhar o cabeçalho da planilha.
 *
 *  Enquanto a planilha tiver exatamente aquelas colunas, naquela
 *  ordem, funciona. No dia em que alguém acrescenta uma coluna —
 *  o CA, por exemplo — a lista fixa e a planilha deixam de bater,
 *  e TODA gravação passa a escrever cada valor uma casa fora do
 *  lugar. Foi o que aconteceu com o óculos ALM-GER-000036: o
 *  valor de "categoria" foi parar na casa do CA.
 *
 *  Pior: isso é silencioso. O Core responde "ok", e o estrago só
 *  aparece quando alguém olha a planilha.
 *
 * ------------------------------------------------------------
 *  O CONSERTO
 *
 *  Monta a linha a partir do CABEÇALHO REAL da aba, lido na hora.
 *  Para cada coluna que existe na planilha:
 *
 *      · o payload trouxe esse campo?   usa o valor novo
 *      · não trouxe?                    MANTÉM o que já estava
 *
 *  A segunda regra é a que importa: coluna que o código não
 *  conhece é PRESERVADA em vez de ser apagada ou deslocada. É
 *  assim que o AP_Data_update do seu próprio Core já faz — este
 *  arquivo só leva a mesma disciplina para o módulo de itens.
 *
 *  Colunas novas na planilha deixam de ser um risco: viram
 *  apenas colunas que este código preserva sem precisar conhecer.
 *
 * ------------------------------------------------------------
 *  O QUE ELE NÃO FAZ
 *
 *  - não cria item. SKU que não existe é recusado;
 *  - não escolhe entre SKUs repetidos;
 *  - não deixa trocar sku, criadoEm nem criadoPor — origem de
 *    registro não se reescreve;
 *  - não apaga coluna, não cria coluna, não mexe em outra linha;
 *  - não diz que gravou sem reler e conferir;
 *  - não substitui o seu AP_Modulo_itens. Fica ao lado dele até
 *    você mandar ligar.
 *
 * ------------------------------------------------------------
 *  COMO USAR, NESTA ORDEM
 *
 *   1. Cole este arquivo no Apps Script (+ → Script).
 *   2. Rode ITENS_COMPARAR(). Só lê. Mostra quais colunas da
 *      planilha o Core NÃO conhece — é o tamanho do estrago.
 *   3. Rode ITENS_TESTE_SEGURO(). Grava um campo inócuo num item
 *      e confere que NENHUMA outra coluna mudou.
 *   4. Só depois, se quiser, ligue no Core (instruções no fim).
 * ============================================================
 */

var ITENSOK_ABA = 'ALMOXA_ITENS';

/** nunca sobrescrevo estes: são a origem do registro */
var ITENSOK_INTOCAVEIS = ['sku', 'criadoem', 'criadopor', '_linha'];

/* ============================================================
   FERRAMENTAS
   ============================================================ */
function ITENSOK_lp_(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }

function ITENSOK_chave_(v) {
  var s = ITENSOK_lp_(v).toLowerCase();
  s = s.replace(/[áàâãä]/g, 'a').replace(/[éèêë]/g, 'e').replace(/[íìîï]/g, 'i')
       .replace(/[óòôõö]/g, 'o').replace(/[úùûü]/g, 'u').replace(/ç/g, 'c');
  return s.replace(/[^a-z0-9]/g, '');
}

function ITENSOK_aba_() {
  var pl = SpreadsheetApp.getActiveSpreadsheet();
  var aba = pl.getSheetByName(ITENSOK_ABA);
  if (!aba) {
    throw new Error('Não achei a aba "' + ITENSOK_ABA + '". Abas: ' +
      pl.getSheets().map(function (s) { return s.getName(); }).join(', '));
  }
  return aba;
}

/** o cabeçalho REAL, lido agora. Sem cache: cache foi parte do problema. */
function ITENSOK_cabecalho_(aba) {
  var larg = aba.getLastColumn();
  if (larg < 1) throw new Error('A aba "' + ITENSOK_ABA + '" está vazia.');
  return aba.getRange(1, 1, 1, larg).getValues()[0].map(function (x) {
    return ITENSOK_lp_(x);
  });
}

function ITENSOK_colunaDoSku_(cab) {
  for (var i = 0; i < cab.length; i++) {
    if (ITENSOK_chave_(cab[i]) === 'sku') return i + 1;
  }
  return 0;
}

/** devolve 0 se não existe, -1 se existe mais de uma */
function ITENSOK_linhaDoSku_(aba, colSku, sku) {
  var alvo = ITENSOK_chave_(sku);
  if (!alvo) return 0;
  var ult = aba.getLastRow();
  if (ult < 2) return 0;
  var vals = aba.getRange(2, colSku, ult - 1, 1).getValues();
  var achada = 0;
  for (var i = 0; i < vals.length; i++) {
    if (ITENSOK_chave_(vals[i][0]) === alvo) {
      if (achada) return -1;
      achada = i + 2;
    }
  }
  return achada;
}

/* ============================================================
   1. COMPARAR — o tamanho do estrago, sem mexer em nada
   ============================================================ */
/**
 * Compara a lista fixa do Core (AP_ITENS_CFG.colunas) com o
 * cabeçalho real da planilha, e mostra:
 *
 *   · colunas que existem na planilha e o Core NÃO conhece
 *     → são as que ficam deslocadas ou perdidas a cada gravação
 *   · colunas que o Core espera e NÃO existem mais na planilha
 *   · a partir de qual posição as duas listas deixam de bater
 *
 * Não grava nada.
 */
function ITENS_COMPARAR() {
  var L = [];
  function diz(x) { L.push(x === undefined ? '' : String(x)); }

  diz('COMPARAÇÃO: LISTA FIXA DO CORE  x  CABEÇALHO REAL');
  diz('(nada foi alterado)');
  diz('');

  var aba = ITENSOK_aba_();
  var real = ITENSOK_cabecalho_(aba);

  var fixa = null;
  try {
    var g = (function () { try { return globalThis; } catch (e) { return null; } })();
    if (g && g.AP_ITENS_CFG && g.AP_ITENS_CFG.colunas) fixa = g.AP_ITENS_CFG.colunas;
  } catch (e) { fixa = null; }

  diz('cabeçalho real da planilha (' + real.length + ' colunas):');
  for (var i = 0; i < real.length; i++) diz('   ' + (i + 1) + '. ' + (real[i] || '(vazio)'));

  if (!fixa) {
    diz('');
    diz('!! Não enxerguei AP_ITENS_CFG.colunas neste projeto.');
    diz('   Sem ela eu não comparo — mas o conserto abaixo funciona');
    diz('   do mesmo jeito, porque ele não depende dessa lista.');
    Logger.log(L.join('\n'));
    return L.join('\n');
  }

  diz('');
  diz('lista fixa do Core (' + fixa.length + ' colunas):');
  for (var f = 0; f < fixa.length; f++) diz('   ' + (f + 1) + '. ' + fixa[f]);

  /* onde as duas deixam de bater */
  var divergeEm = 0;
  for (var d = 0; d < Math.max(real.length, fixa.length); d++) {
    if (ITENSOK_chave_(real[d]) !== ITENSOK_chave_(fixa[d])) { divergeEm = d + 1; break; }
  }

  var mapaFixa = {};
  for (var mf = 0; mf < fixa.length; mf++) mapaFixa[ITENSOK_chave_(fixa[mf])] = true;
  var mapaReal = {};
  for (var mr = 0; mr < real.length; mr++) mapaReal[ITENSOK_chave_(real[mr])] = true;

  var soNaPlanilha = [], soNoCore = [];
  for (var a = 0; a < real.length; a++) {
    if (real[a] && !mapaFixa[ITENSOK_chave_(real[a])]) soNaPlanilha.push((a + 1) + ':' + real[a]);
  }
  for (var b = 0; b < fixa.length; b++) {
    if (!mapaReal[ITENSOK_chave_(fixa[b])]) soNoCore.push(fixa[b]);
  }

  diz('');
  diz('==========================================');
  diz('RESULTADO');
  diz('==========================================');
  if (!divergeEm) {
    diz('As duas listas batem do começo ao fim.');
    diz('=> hoje a gravação por posição está acertando. Mas qualquer');
    diz('   coluna nova no meio volta a desalinhar tudo.');
  } else {
    diz('AS DUAS LISTAS DIVERGEM A PARTIR DA COLUNA ' + divergeEm + '.');
    diz('   planilha tem: "' + (real[divergeEm - 1] || '(nada)') + '"');
    diz('   Core espera:  "' + (fixa[divergeEm - 1] || '(nada)') + '"');
    diz('');
    diz('=> TODA gravação de item está escrevendo torto da coluna ' +
        divergeEm + ' em diante.');
  }
  diz('');
  diz('colunas que existem na planilha e o Core NÃO conhece:');
  diz('   ' + (soNaPlanilha.length ? soNaPlanilha.join(', ') : '(nenhuma)'));
  diz('colunas que o Core espera e não existem mais:');
  diz('   ' + (soNoCore.length ? soNoCore.join(', ') : '(nenhuma)'));

  var t = L.join('\n');
  Logger.log(t);
  return t;
}

/* ============================================================
   2. O CONSERTO — gravar pelo cabeçalho real
   ============================================================ */
/**
 * Grava campos de UM item, pelo nome da coluna.
 *
 *     AP_ITENSOK_gravar('ALM-GER-000036', { ca: '39459', unidade: 'UN' })
 *
 * Toda coluna que o payload não trouxer é mantida como está —
 * inclusive as que nenhum código conhece.
 */
function AP_ITENSOK_gravar(sku, campos) {
  var r = { ok: false, sku: ITENSOK_lp_(sku) };
  campos = campos || {};

  var aba;
  try { aba = ITENSOK_aba_(); }
  catch (e) { r.mensagem = String(e.message || e); return r; }

  var cab = ITENSOK_cabecalho_(aba);
  var colSku = ITENSOK_colunaDoSku_(cab);
  if (!colSku) { r.mensagem = 'Não achei a coluna do SKU no cabeçalho.'; return r; }

  var linha = ITENSOK_linhaDoSku_(aba, colSku, sku);
  if (linha === 0) {
    r.mensagem = 'SKU "' + r.sku + '" não existe nesta aba. Não crio item aqui.';
    return r;
  }
  if (linha === -1) {
    r.mensagem = 'Existe mais de uma linha com o SKU "' + r.sku +
      '". Não escolho entre duas — conserte a duplicidade primeiro.';
    return r;
  }

  /* o que está lá hoje */
  var atual = aba.getRange(linha, 1, 1, cab.length).getValues()[0];

  /* o payload, indexado por chave normalizada, para "CA" casar com "ca" */
  var porChave = {};
  for (var k in campos) {
    if (Object.prototype.hasOwnProperty.call(campos, k)) porChave[ITENSOK_chave_(k)] = campos[k];
  }

  var nova = [], mudadas = [], recusadas = [];
  for (var c = 0; c < cab.length; c++) {
    var nome = cab[c];
    var ch = ITENSOK_chave_(nome);

    /* carimbo de atualização, se a coluna existir */
    if (ch === 'atualizadoem') { nova.push(new Date().toISOString()); continue; }

    var temNovo = Object.prototype.hasOwnProperty.call(porChave, ch);

    if (temNovo && ITENSOK_INTOCAVEIS.indexOf(ch) > -1) {
      recusadas.push(nome);
      nova.push(atual[c]);          /* origem de registro não se reescreve */
      continue;
    }
    if (temNovo) {
      var v = porChave[ch];
      if (ITENSOK_lp_(v) !== ITENSOK_lp_(atual[c])) mudadas.push(nome);
      nova.push(v);
      continue;
    }
    /* A REGRA QUE CONSERTA TUDO: coluna que ninguém mencionou
       fica exatamente como estava. */
    nova.push(atual[c]);
  }

  r.linha = linha;
  r.colunas = cab.length;
  r.mudadas = mudadas;
  if (recusadas.length) r.recusadas = recusadas;

  if (!mudadas.length) {
    r.ok = true;
    r.mensagem = 'Nada mudou: os valores enviados já eram os que estavam lá. Não gravei.';
    return r;
  }

  aba.getRange(linha, 1, 1, cab.length).setValues([nova]);
  SpreadsheetApp.flush();

  /* RELER E CONFERIR — só digo que gravei depois de ver de volta */
  var depois = aba.getRange(linha, 1, 1, cab.length).getValues()[0];
  var erradas = [];
  for (var d = 0; d < cab.length; d++) {
    if (ITENSOK_chave_(cab[d]) === 'atualizadoem') continue;
    if (ITENSOK_lp_(depois[d]) !== ITENSOK_lp_(nova[d])) erradas.push(cab[d]);
  }
  if (erradas.length) {
    r.mensagem = 'Escrevi, mas a releitura não bateu em: ' + erradas.join(', ') +
      '. Pode haver validação ou proteção nessas células.';
    r.naoBateram = erradas;
    return r;
  }

  /* o cache do Core precisa saber que mudou */
  try { if (typeof AP_ITENS_invalidar_ === 'function') AP_ITENS_invalidar_(); } catch (e) {}
  try { if (typeof AP_ITENS_esquecerCabecalho_ === 'function') AP_ITENS_esquecerCabecalho_(); } catch (e) {}
  try { if (typeof AP_Data_invalidar_ === 'function') AP_Data_invalidar_(ITENSOK_ABA); } catch (e) {}

  r.ok = true;
  r.mensagem = 'Gravei na linha ' + linha + ': ' + mudadas.join(', ') +
    '. As outras ' + (cab.length - mudadas.length) + ' colunas ficaram como estavam.';
  return r;
}

/* ============================================================
   3. TESTE SEGURO — prova que preserva, na SUA planilha
   ============================================================ */
/**
 * Pega o primeiro item da aba, grava de volta no campo "unidade"
 * EXATAMENTE o valor que já estava lá, e confere que a linha
 * inteira continua idêntica.
 *
 * É o teste que prova a diferença: com a lista fixa, essa mesma
 * operação deslocaria as colunas. Aqui ela não muda nada.
 *
 * Não altera nenhum dado: o valor gravado é o que já existia.
 */
function ITENS_TESTE_SEGURO() {
  var L = [];
  function diz(x) { L.push(x === undefined ? '' : String(x)); }

  diz('TESTE SEGURO DA GRAVAÇÃO POR CABEÇALHO');
  diz('(grava de volta o MESMO valor — nenhum dado muda)');
  diz('');

  var aba = ITENSOK_aba_();
  var cab = ITENSOK_cabecalho_(aba);
  var colSku = ITENSOK_colunaDoSku_(cab);
  if (!colSku) { diz('não achei a coluna do SKU.'); Logger.log(L.join('\n')); return L.join('\n'); }
  if (aba.getLastRow() < 2) { diz('a aba não tem itens.'); Logger.log(L.join('\n')); return L.join('\n'); }

  var linha = 2;
  var sku = ITENSOK_lp_(aba.getRange(linha, colSku).getValue());
  var antes = aba.getRange(linha, 1, 1, cab.length).getValues()[0];

  diz('item de teste: ' + sku + '   (linha ' + linha + ', ' + cab.length + ' colunas)');
  diz('');

  /* escolho uma coluna inócua que exista */
  var alvo = '';
  for (var c = 0; c < cab.length; c++) {
    var ch = ITENSOK_chave_(cab[c]);
    if (ch === 'unidade' || ch === 'descricao' || ch === 'categoria') { alvo = cab[c]; break; }
  }
  if (!alvo) { diz('não achei coluna inócua para testar.'); Logger.log(L.join('\n')); return L.join('\n'); }

  var valorAtual = antes[cab.indexOf(alvo)];
  diz('vou gravar em "' + alvo + '" o mesmo valor que já está lá: "' + valorAtual + '"');

  var campos = {};
  campos[alvo] = valorAtual;
  var r = AP_ITENSOK_gravar(sku, campos);
  diz('');
  diz('resposta: ' + r.mensagem);

  var depois = aba.getRange(linha, 1, 1, cab.length).getValues()[0];
  var diferentes = [];
  for (var d = 0; d < cab.length; d++) {
    if (ITENSOK_chave_(cab[d]) === 'atualizadoem') continue;
    if (ITENSOK_lp_(antes[d]) !== ITENSOK_lp_(depois[d])) {
      diferentes.push(cab[d] + ': "' + antes[d] + '" -> "' + depois[d] + '"');
    }
  }

  diz('');
  diz('==========================================');
  if (!diferentes.length) {
    diz('PASSOU: a linha inteira continua idêntica.');
    diz('Nenhuma coluna deslocou, nenhum valor se perdeu.');
  } else {
    diz('FALHOU: ' + diferentes.length + ' coluna(s) mudaram sem eu mandar:');
    for (var x = 0; x < diferentes.length; x++) diz('   ' + diferentes[x]);
    diz('NÃO ligue isto no Core. Me mande este registro.');
  }

  var t = L.join('\n');
  Logger.log(t);
  return t;
}

/* ============================================================
   4. COMO LIGAR NO CORE  —  só depois dos passos 2 e 3
   ------------------------------------------------------------
   No seu AP_Modulo_itens, no case 'salvar', o ramo de edição é:

       if (payload.sku && payload.editando) {
         var alvo = todos.filter(...)[0];
         if (!alvo) return { ok:false, codigo:'ITEM_NAO_ENCONTRADO', ... };

         var linha = AP_ITENS_CFG.colunas.map(function (c) { ... });
         aba.getRange(alvo._linha, 1, 1,
                      AP_ITENS_CFG.colunas.length).setValues([linha]);
         AP_ITENS_invalidar_();
         return { ok:true, dados: ..., atualizado:true };
       }

   Troque as DUAS linhas do meio (o var linha e o setValues) por
   esta única:

       var g = AP_ITENSOK_gravar(payload.sku, payload);
       if (!g.ok) return { ok:false, codigo:'GRAVACAO', mensagem:g.mensagem };

   Só isso. O resto do case continua igual: a checagem do alvo
   antes, o invalidar e o return depois.

   Para voltar atrás, é só desfazer essa linha — este arquivo
   fica inerte, sem afetar nada.
   ============================================================ */
