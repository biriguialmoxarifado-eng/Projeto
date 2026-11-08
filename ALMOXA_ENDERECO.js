/**
 * ============================================================
 *  ALMOXA_ENDERECO  ·  08/11/2026  ·  busca: [ENDERECO]
 * ------------------------------------------------------------
 *  O GUARDIÃO DO ENDEREÇAMENTO.
 *
 *  Decisão do Ismael em 08/11: o almoxarifado usa OS DOIS níveis
 *  de endereço, conforme o caso —
 *
 *      A-A01-1-A    rua · estante · prateleira · POSIÇÃO
 *      A-A01-1      rua · estante · PRATELEIRA
 *
 *  Posição onde precisa de precisão; prateleira onde a prateleira
 *  inteira é um endereço só. Faz sentido: colar etiqueta em cada
 *  posição de uma prateleira de parafuso é trabalho perdido.
 *
 * ------------------------------------------------------------
 *  A REGRA QUE ESTE ARQUIVO EXISTE PARA GUARDAR
 *
 *      Uma prateleira e as posições dela NUNCA são endereços ao
 *      mesmo tempo.
 *
 *  Sem essa regra, os dois níveis se atropelam. Se A-A01-1 e
 *  A-A01-1-A existem juntos e alguém guarda material na posição:
 *
 *    · a prateleira aparece vazia, porque a ocupação está presa
 *      ao código da posição; ou
 *    · algum relatório soma os dois e o saldo aparece em dobro.
 *
 *  A seção 6 da especificação diz "Não duplicar saldos". É
 *  exatamente isto. E no Digital Twin é pior: o mapa pintaria de
 *  cinza uma prateleira cheia, e o Ismael acreditaria nele.
 *
 *  Já existe um caso na planilha hoje: a ocupação do dia 13/09
 *  aponta para A-A01-1, e a localização cadastrada é A-A01-1-A.
 *  Aquela bota não conta para lugar nenhum.
 *
 * ------------------------------------------------------------
 *  O QUE ELE FAZ
 *
 *    ENDERECO_CONFERIR()   lê tudo e aponta os problemas. Só lê.
 *    ENDERECO_validar_()   diz se um endereço novo pode entrar.
 *    ENDERECO_chaveQR_()   a chave permanente da etiqueta.
 *
 *  NÃO grava, NÃO apaga, NÃO corrige sozinho. Conserto de
 *  endereço mexe em onde o material está guardado — isso se faz
 *  com o almoxarife olhando a prateleira, não com script.
 * ============================================================
 */

var ENDERECO_ABA_LOCAIS = 'ALMOXA_LOCALIZACOES';
var ENDERECO_ABA_OCUPACAO = 'ALMOXA_OCUPACAO';

/* ============================================================
   FERRAMENTAS
   ============================================================ */
function ENDERECO_lp_(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }

function ENDERECO_cima_(v) { return ENDERECO_lp_(v).toUpperCase(); }

function ENDERECO_aba_(nome) {
  var pl = SpreadsheetApp.getActiveSpreadsheet();
  var a = pl.getSheetByName(nome);
  if (!a) throw new Error('Não achei a aba "' + nome + '".');
  return a;
}

/** lê uma aba como lista de objetos, pelo cabeçalho */
function ENDERECO_linhas_(nome) {
  var aba = ENDERECO_aba_(nome);
  var alt = aba.getLastRow(), larg = aba.getLastColumn();
  if (alt < 2 || larg < 1) return [];
  var tudo = aba.getRange(1, 1, alt, larg).getValues();
  var cab = tudo[0].map(function (x) { return ENDERECO_lp_(x); });
  var saida = [];
  for (var i = 1; i < tudo.length; i++) {
    var o = { __linha: i + 1 };
    for (var c = 0; c < cab.length; c++) if (cab[c]) o[cab[c]] = tudo[i][c];
    saida.push(o);
  }
  return saida;
}

/* ------------------------------------------------------------
   O NÍVEL DE UM ENDEREÇO
   ------------------------------------------------------------
   Não precisei criar coluna nova: a aba já distingue sozinha.
   Posição preenchida = endereço de POSIÇÃO. Posição vazia =
   endereço de PRATELEIRA. A estrutura que já existia aguenta os
   dois níveis — faltava só alguém dizer a regra em voz alta.
   ------------------------------------------------------------ */
function ENDERECO_nivelDe_(loc) {
  if (!loc) return '';
  if (ENDERECO_lp_(loc.posicao)) return 'POSICAO';
  if (ENDERECO_lp_(loc.prateleira)) return 'PRATELEIRA';
  if (ENDERECO_lp_(loc.estante)) return 'ESTANTE';
  if (ENDERECO_lp_(loc.rua)) return 'RUA';
  return '';
}

/** o prefixo até a prateleira: é por ele que os dois níveis se encontram */
function ENDERECO_atePrateleira_(loc) {
  var p = [ENDERECO_cima_(loc.rua), ENDERECO_cima_(loc.estante),
           ENDERECO_cima_(loc.prateleira)].filter(function (x) { return x; });
  return p.join('-');
}

/** o código completo, do jeito que o Core já monta */
function ENDERECO_codigoDe_(loc) {
  var p = [ENDERECO_cima_(loc.rua), ENDERECO_cima_(loc.estante),
           ENDERECO_cima_(loc.prateleira), ENDERECO_cima_(loc.posicao)]
          .filter(function (x) { return x; });
  return p.join('-');
}

/**
 * A chave permanente que vai no QR Code.
 *
 * É o próprio código da localização — não invento identificador
 * novo, como manda a seção 7. E o QR NÃO leva quantidade: leva
 * só o endereço, e quem lê consulta o saldo na hora.
 */
function ENDERECO_chaveQR_(loc) {
  return 'ALMOXA:LOC:' + ENDERECO_codigoDe_(loc);
}

/* ============================================================
   O GUARDIÃO — diz se um endereço novo pode entrar
   ============================================================ */
/**
 * Devolve { pode: true } ou { pode: false, motivo: '...' }.
 *
 * Recusa quando o novo endereço brigaria com um que já existe:
 *   · mesmo código já cadastrado;
 *   · a prateleira dele já é endereço (e ele é posição);
 *   · ou já existem posições nessa prateleira (e ele é prateleira).
 */
function ENDERECO_validar_(novo, jaCadastrados) {
  var codigo = ENDERECO_codigoDe_(novo);
  var nivel = ENDERECO_nivelDe_(novo);
  var prefixo = ENDERECO_atePrateleira_(novo);

  if (!codigo) return { pode: false, motivo: 'Endereço sem rua: não dá para cadastrar.' };

  var lista = jaCadastrados || ENDERECO_linhas_(ENDERECO_ABA_LOCAIS);

  for (var i = 0; i < lista.length; i++) {
    var l = lista[i];
    var cl = ENDERECO_cima_(l.codigo) || ENDERECO_codigoDe_(l);
    if (cl === codigo) {
      return { pode: false, motivo: 'A localização ' + codigo + ' já está cadastrada.' };
    }
  }

  if (nivel === 'POSICAO') {
    /* a prateleira inteira já é um endereço? então a posição não pode ser */
    for (var j = 0; j < lista.length; j++) {
      var p = lista[j];
      if (ENDERECO_nivelDe_(p) === 'PRATELEIRA' && ENDERECO_atePrateleira_(p) === prefixo) {
        return {
          pode: false, conflito: ENDERECO_cima_(p.codigo),
          motivo: 'A prateleira ' + prefixo + ' já é um endereço inteiro. ' +
            'Ou ela é um endereço, ou as posições dela são — nunca os dois, ' +
            'senão o material guardado some de um dos dois lados.'
        };
      }
    }
  }

  if (nivel === 'PRATELEIRA') {
    /* já existem posições dentro dela? */
    var dentro = [];
    for (var k = 0; k < lista.length; k++) {
      var q = lista[k];
      if (ENDERECO_nivelDe_(q) === 'POSICAO' && ENDERECO_atePrateleira_(q) === prefixo) {
        dentro.push(ENDERECO_cima_(q.codigo));
      }
    }
    if (dentro.length) {
      return {
        pode: false, conflito: dentro.slice(0, 5).join(', '),
        motivo: 'Esta prateleira já tem ' + dentro.length + ' posição(ões) cadastrada(s) (' +
          dentro.slice(0, 3).join(', ') + (dentro.length > 3 ? '…' : '') + '). ' +
          'Não dá para ela virar um endereço só sem antes retirar as posições.'
      };
    }
  }

  return { pode: true, codigo: codigo, nivel: nivel };
}

/* ============================================================
   CONFERIR — o raio-X do endereçamento. Só leitura.
   ============================================================ */
function ENDERECO_CONFERIR() {
  var L = [];
  function diz(x) { L.push(x === undefined ? '' : String(x)); }

  diz('CONFERÊNCIA DO ENDEREÇAMENTO  ·  ' + new Date().toLocaleString('pt-BR'));
  diz('(nada foi alterado)');
  diz('');

  var locais, ocupacoes;
  try { locais = ENDERECO_linhas_(ENDERECO_ABA_LOCAIS); }
  catch (e) { diz('!! ' + String(e.message || e)); Logger.log(L.join('\n')); return L.join('\n'); }
  try { ocupacoes = ENDERECO_linhas_(ENDERECO_ABA_OCUPACAO); } catch (e) { ocupacoes = []; }

  diz('localizações cadastradas: ' + locais.length);
  diz('registros de ocupação:    ' + ocupacoes.length);
  diz('');

  /* ---- 1 · por nível ---- */
  var porNivel = {}, porCodigo = {}, prefixos = {};
  for (var i = 0; i < locais.length; i++) {
    var l = locais[i];
    var n = ENDERECO_nivelDe_(l) || '(indefinido)';
    porNivel[n] = (porNivel[n] || 0) + 1;
    var cod = ENDERECO_cima_(l.codigo) || ENDERECO_codigoDe_(l);
    (porCodigo[cod] = porCodigo[cod] || []).push(l.__linha);
    var pre = ENDERECO_atePrateleira_(l);
    if (pre) {
      prefixos[pre] = prefixos[pre] || { prateleira: [], posicao: [] };
      if (n === 'PRATELEIRA') prefixos[pre].prateleira.push(cod);
      if (n === 'POSICAO') prefixos[pre].posicao.push(cod);
    }
  }
  diz('1 · POR NÍVEL DE ENDEREÇO');
  for (var nv in porNivel) diz('   ' + nv + ': ' + porNivel[nv]);
  if (!locais.length) diz('   (nenhuma localização cadastrada ainda)');

  /* ---- 2 · a regra: prateleira x posições ---- */
  diz('');
  diz('2 · PRATELEIRA E POSIÇÃO DISPUTANDO O MESMO LUGAR');
  var brigas = 0;
  for (var pre2 in prefixos) {
    var p = prefixos[pre2];
    if (p.prateleira.length && p.posicao.length) {
      brigas++;
      diz('   !! ' + pre2 + ' está cadastrada como prateleira (' + p.prateleira.join(', ') +
          ') E tem ' + p.posicao.length + ' posição(ões) dentro.');
      diz('      Material guardado num dos lados não aparece no outro.');
    }
  }
  if (!brigas) diz('   nenhuma. Cada lugar tem um nível só — é como tem que ser.');

  /* ---- 3 · código repetido ---- */
  diz('');
  diz('3 · CÓDIGO REPETIDO');
  var repetidos = 0;
  for (var cd in porCodigo) {
    if (porCodigo[cd].length > 1) {
      repetidos++;
      diz('   !! ' + cd + ' aparece nas linhas ' + porCodigo[cd].join(', '));
    }
  }
  if (!repetidos) diz('   nenhum.');

  /* ---- 4 · ocupação órfã: o caso da bota ---- */
  diz('');
  diz('4 · OCUPAÇÃO APONTANDO PARA ENDEREÇO QUE NÃO EXISTE');
  var orfas = [];
  for (var o = 0; o < ocupacoes.length; o++) {
    var oc = ocupacoes[o];
    var alvo = ENDERECO_cima_(oc.localizacao);
    if (!alvo) continue;
    if (!porCodigo[alvo]) {
      /* o endereço existe num nível mais fundo? é o sintoma do formato trocado */
      var maisFundo = [];
      for (var cc in porCodigo) if (cc.indexOf(alvo + '-') === 0) maisFundo.push(cc);
      orfas.push({
        linha: oc.__linha, local: alvo,
        sku: ENDERECO_lp_(oc.sku), desc: ENDERECO_lp_(oc.descricao),
        qtd: ENDERECO_lp_(oc.quantidade),
        candidatos: maisFundo.slice(0, 5)
      });
    }
  }
  if (!orfas.length) diz('   nenhuma. Toda ocupação aponta para um endereço cadastrado.');
  for (var f = 0; f < orfas.length; f++) {
    var r = orfas[f];
    diz('   !! linha ' + r.linha + ': ' + r.sku + ' (' + r.desc + ') qtd=' + r.qtd);
    diz('      guardado em "' + r.local + '", que NÃO está cadastrado.');
    if (r.candidatos.length) {
      diz('      existem endereços mais específicos começando com ele: ' +
          r.candidatos.join(', '));
      diz('      => é o formato do código que mudou. Confira na prateleira ' +
          'onde o material está de verdade antes de corrigir.');
    }
  }

  /* ---- 5 · endereço sem código ---- */
  diz('');
  diz('5 · LOCALIZAÇÃO SEM CÓDIGO GRAVADO');
  var semCod = 0;
  for (var s = 0; s < locais.length; s++) {
    if (!ENDERECO_lp_(locais[s].codigo)) {
      semCod++;
      diz('   !! linha ' + locais[s].__linha + ' — o código seria "' +
          ENDERECO_codigoDe_(locais[s]) + '"');
    }
  }
  if (!semCod) diz('   nenhuma.');

  /* ---- resumo ---- */
  var problemas = brigas + repetidos + orfas.length + semCod;
  diz('');
  diz('==========================================');
  diz(problemas ? problemas + ' ponto(s) para resolver antes do mapa 3D.'
                : 'Endereçamento consistente. Pode seguir para o mapa.');
  if (orfas.length) {
    diz('');
    diz('Os órfãos eu NÃO corrijo sozinho: mexer em ocupação é dizer');
    diz('onde o material está. Isso se confere na prateleira.');
  }

  var t = L.join('\n');
  Logger.log(t);
  return t;
}

/* ============================================================
   SIMULAR — testar um endereço novo sem cadastrar
   ------------------------------------------------------------
   Troque os valores e rode. Ele diz se entraria e por quê não.
   ============================================================ */
var ENDERECO_TESTE = { rua: 'A', estante: 'A01', prateleira: '1', posicao: 'B' };

function ENDERECO_SIMULAR() {
  var r = ENDERECO_validar_(ENDERECO_TESTE);
  var L = ['SIMULANDO UM ENDEREÇO NOVO (nada foi cadastrado)', ''];
  L.push('   rua=' + ENDERECO_TESTE.rua + ' estante=' + ENDERECO_TESTE.estante +
         ' prateleira=' + ENDERECO_TESTE.prateleira + ' posicao=' + ENDERECO_TESTE.posicao);
  L.push('   código: ' + ENDERECO_codigoDe_(ENDERECO_TESTE));
  L.push('   nível:  ' + ENDERECO_nivelDe_(ENDERECO_TESTE));
  L.push('   QR:     ' + ENDERECO_chaveQR_(ENDERECO_TESTE));
  L.push('');
  L.push(r.pode ? 'PODE cadastrar.' : 'NÃO pode: ' + r.motivo);
  var t = L.join('\n');
  Logger.log(t);
  return t;
}
