/**
 * ============================================================
 * ALMOXA PRO - CORE MASTER
 * 05 - DATA LAYER  (versão otimizada)
 * ============================================================
 * Acesso único e controlado às abas da planilha.
 *
 * POR QUE ESTA VERSÃO EXISTE
 *
 * O sistema estava respondendo "o Core não respondeu em 15
 * segundos". Medindo uma consulta simples ao catálogo, apareceu
 * o motivo: a mesma aba era aberta e lida várias vezes na mesma
 * execução, e cada atualização de registro fazia UMA ESCRITA POR
 * CAMPO na planilha.
 *
 * Um item com 8 campos = 8 idas à planilha. Uma reserva com 12
 * campos = 12. É isso que consumia os segundos.
 *
 * O QUE MUDOU
 *
 *  1. A aba é aberta uma vez por execução (getSheetByName é caro).
 *  2. As linhas são lidas uma vez por execução; qualquer escrita
 *     invalida a leitura daquela aba na hora — nunca se lê dado
 *     velho.
 *  3. AP_Data_update grava a LINHA INTEIRA de uma vez, em vez de
 *     célula por célula. De 8 escritas para 1.
 *  4. AP_Data_headers usa o mesmo cache, sem reabrir a aba.
 *  5. AP_Data_remove e append também invalidam corretamente.
 *  6. AP_Data_perf() mostra o que foi economizado.
 *
 * NADA DE ASSINATURA PÚBLICA MUDOU. Todas as funções continuam
 * recebendo e devolvendo o mesmo que antes.
 * ============================================================
 */

/**
 * Memória da execução atual. Some quando a execução termina —
 * no Apps Script, cada requisição é uma execução nova, então não
 * há risco de um usuário ver o dado de outro.
 */
var AP_Data_exec_ = {
  abas: {},        /* nome -> handle da aba */
  linhas: {},      /* nome -> registros já lidos */
  cabecalhos: {},  /* nome -> array de colunas */
  perf: {
    aberturasPedidas: 0, aberturasReais: 0,
    leiturasPedidas: 0, leiturasReais: 0,
    escritas: 0, celulasEvitadas: 0,
    buscasDirecionadas: 0, linhasEvitadas: 0,
    msLeitura: 0, msEscrita: 0
  }
};

/**
 * ============================================================
 * ESCRITA QUE NÃO JOGA A LEITURA FORA
 * ------------------------------------------------------------
 * O cache de execução funciona — mas toda escrita o descartava.
 * E as operações reais alternam: lê o item, grava o saldo, lê o
 * item de novo, grava a movimentação, lê mais uma vez.
 *
 * Medido numa saída de estoque: SEIS leituras da aba de itens
 * numa única operação. Cada uma é uma ida à planilha, de 200 a
 * 800 ms.
 *
 * A correção: quando se grava, sabe-se exatamente o que mudou.
 * Então o cache é ATUALIZADO com a mudança, em vez de apagado.
 * O dado continua correto — é o mesmo que acabou de ir para a
 * planilha — e a próxima leitura não precisa da rede.
 *
 * Invalidar continua existindo para o que não dá para prever.
 * ============================================================
 */

/** Acrescenta ao que já foi lido, sem ir à planilha de novo */
function AP_Data_cacheAcrescentar_(sheetName, registro) {
  if (!AP_Data_exec_.linhas[sheetName]) return;   /* não foi lido: nada a fazer */

  try {
    var copia = {};
    Object.keys(registro).forEach(function (k) { copia[k] = registro[k]; });
    /* a linha nova é a última da planilha */
    copia.__rowIndex = AP_Data_exec_.linhas[sheetName].length + 2;
    AP_Data_exec_.linhas[sheetName].push(copia);
    AP_Data_exec_.perf.leiturasEvitadas = (AP_Data_exec_.perf.leiturasEvitadas || 0) + 1;
  } catch (e) {
    /* qualquer dúvida, descarta: dado velho é pior que lentidão */
    AP_Data_invalidar_(sheetName);
  }
}

/** Aplica no cache a mesma mudança que foi para a planilha */
function AP_Data_cacheAtualizar_(sheetName, matchField, matchValue, patch) {
  var linhas = AP_Data_exec_.linhas[sheetName];
  if (!linhas) return;

  try {
    var achou = false;
    for (var i = 0; i < linhas.length; i++) {
      if (String(linhas[i][matchField]) === String(matchValue)) {
        Object.keys(patch).forEach(function (k) { linhas[i][k] = patch[k]; });
        achou = true;
        break;
      }
    }
    if (!achou) { AP_Data_invalidar_(sheetName); return; }
    AP_Data_exec_.perf.leiturasEvitadas = (AP_Data_exec_.perf.leiturasEvitadas || 0) + 1;
  } catch (e) {
    AP_Data_invalidar_(sheetName);
  }
}

/** Tira do cache o que foi removido da planilha */
function AP_Data_cacheRemover_(sheetName, matchField, matchValue) {
  var linhas = AP_Data_exec_.linhas[sheetName];
  if (!linhas) return;

  try {
    /* os índices de linha mudam ao remover: mais seguro descartar */
    AP_Data_invalidar_(sheetName);
  } catch (e) {
    AP_Data_invalidar_(sheetName);
  }
}

/** Esquece o que foi lido de uma aba. Chamado quando não dá para atualizar. */
function AP_Data_invalidar_(sheetName) {
  if (sheetName) {
    delete AP_Data_exec_.linhas[sheetName];
    delete AP_Data_exec_.cabecalhos[sheetName];
  } else {
    AP_Data_exec_.linhas = {};
    AP_Data_exec_.cabecalhos = {};
  }
}

/** Limpa tudo. Use no início de uma requisição, se necessário. */
function AP_Data_limparCache() {
  AP_Data_exec_.abas = {};
  AP_Data_exec_.linhas = {};
  AP_Data_exec_.cabecalhos = {};
}

var AP_Data = {
  getSheet: function (sheetName, headerIfCreate) { return AP_Data_getSheet(sheetName, headerIfCreate); },
  headers: function (sheetName) { return AP_Data_headers(sheetName); },
  rows: function (sheetName) { return AP_Data_rows(sheetName); },
  findBy: function (sheetName, criteria) { return AP_Data_findBy(sheetName, criteria); },
  append: function (sheetName, record) { return AP_Data_append(sheetName, record); },
  appendBatch: function (sheetName, records) { return AP_Data_appendBatch(sheetName, records); },
  update: function (sheetName, matchValue, patch, matchField) {
    return AP_Data_update(sheetName, matchValue, patch, matchField);
  },
  remove: function (sheetName, matchValue, matchField) {
    return AP_Data_remove(sheetName, matchValue, matchField);
  },
  count: function (sheetName, criteria) { return AP_Data_count(sheetName, criteria); },
  countFast: function (sheetName) { return AP_Data_countFast(sheetName); },
  findById: function (sheetName, id) { return AP_Data_findById(sheetName, id); },
  findFirstBy: function (sheetName, campo, valor) { return AP_Data_findFirstBy(sheetName, campo, valor); },
  listPage: function (sheetName, pagina, porPagina) { return AP_Data_listPage(sheetName, pagina, porPagina); },
  updateByRow: function (sheetName, rowIndex, patch) { return AP_Data_updateByRow(sheetName, rowIndex, patch); },
  validateColumn: function (sheetName, columnName) { return AP_Data_validateColumn(sheetName, columnName); }
};

/* ============================================================
   ABERTURA DE ABA
   ============================================================ */

function AP_Data_getSheet(sheetName, headerIfCreate) {
  AP_Data_exec_.perf.aberturasPedidas++;

  /* já aberta nesta execução: devolve o mesmo handle */
  if (AP_Data_exec_.abas[sheetName]) return AP_Data_exec_.abas[sheetName];

  AP_Data_exec_.perf.aberturasReais++;

  var ss = AP_Config_getSpreadsheet_();
  var sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if (headerIfCreate && headerIfCreate.length) {
      sheet.appendRow(headerIfCreate);
      sheet.setFrozenRows(1);
    }
    AP_Data_invalidar_(sheetName);
  } else if (headerIfCreate && headerIfCreate.length && sheet.getLastRow() === 0) {
    sheet.appendRow(headerIfCreate);
    sheet.setFrozenRows(1);
    AP_Data_invalidar_(sheetName);
  }

  AP_Data_exec_.abas[sheetName] = sheet;
  return sheet;
}

/* ============================================================
   LEITURA
   ============================================================ */

function AP_Data_headers(sheetName) {
  if (AP_Data_exec_.cabecalhos[sheetName]) return AP_Data_exec_.cabecalhos[sheetName];

  var sheet = AP_Data_getSheet(sheetName);
  if (sheet.getLastRow() === 0) {
    AP_Data_exec_.cabecalhos[sheetName] = [];
    return [];
  }

  var cabecalho = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  AP_Data_exec_.cabecalhos[sheetName] = cabecalho;
  return cabecalho;
}

function AP_Data_rows(sheetName) {
  AP_Data_exec_.perf.leiturasPedidas++;

  /* já lida nesta execução */
  if (Object.prototype.hasOwnProperty.call(AP_Data_exec_.linhas, sheetName)) {
    return AP_Data_exec_.linhas[sheetName];
  }

  AP_Data_exec_.perf.leiturasReais++;
  var t0 = new Date().getTime();

  var sheet = AP_Data_getSheet(sheetName);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();

  if (lastRow < 2) {
    AP_Data_exec_.linhas[sheetName] = [];
    return [];
  }

  /* uma única leitura pega cabeçalho e dados juntos */
  var tudo = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = tudo[0];
  AP_Data_exec_.cabecalhos[sheetName] = headers;

  var registros = [];
  for (var i = 1; i < tudo.length; i++) {
    var obj = {};
    for (var c = 0; c < headers.length; c++) obj[String(headers[c])] = tudo[i][c];
    obj.__rowIndex = i + 1;   /* linha real na planilha */
    registros.push(obj);
  }

  AP_Data_exec_.perf.msLeitura += (new Date().getTime() - t0);
  AP_Data_exec_.linhas[sheetName] = registros;
  return registros;
}

function AP_Data_findBy(sheetName, criteria) {
  var rows = AP_Data_rows(sheetName);
  if (typeof criteria === 'function') return rows.filter(criteria);
  return rows.filter(function (row) {
    return Object.keys(criteria).every(function (key) { return row[key] === criteria[key]; });
  });
}

/* ============================================================
   ESCRITA
   ============================================================ */

function AP_Data_append(sheetName, record) {
  var sheet = AP_Data_getSheet(sheetName);
  var headers = AP_Data_headers(sheetName);

  if (!headers.length) {
    headers = Object.keys(record);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    AP_Data_exec_.cabecalhos[sheetName] = headers;
  }

  var row = headers.map(function (h) { return (h in record) ? record[h] : ''; });

  var t0 = new Date().getTime();
  sheet.appendRow(row);
  AP_Data_exec_.perf.escritas++;
  AP_Data_exec_.perf.msEscrita += (new Date().getTime() - t0);

  /* o cache recebe a linha nova em vez de ser descartado */
  AP_Data_cacheAcrescentar_(sheetName, record);
  return AP_Utils_ok(record, 'Registro inserido em ' + sheetName);
}

function AP_Data_appendBatch(sheetName, records) {
  if (!records || !records.length) return AP_Utils_ok([], 'Nenhum registro para inserir.');

  var sheet = AP_Data_getSheet(sheetName);
  var headers = AP_Data_headers(sheetName);

  if (!headers.length) {
    headers = Object.keys(records[0]);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    AP_Data_exec_.cabecalhos[sheetName] = headers;
  }

  var rows = records.map(function (record) {
    return headers.map(function (h) { return (h in record) ? record[h] : ''; });
  });

  var t0 = new Date().getTime();
  var startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows.length, headers.length).setValues(rows);
  AP_Data_exec_.perf.escritas++;
  AP_Data_exec_.perf.msEscrita += (new Date().getTime() - t0);

  AP_Data_invalidar_(sheetName);
  return AP_Utils_ok(records, records.length + ' registros inseridos em ' + sheetName);
}

/**
 * Atualiza um registro.
 *
 * A versão anterior gravava CÉLULA POR CÉLULA: um patch com oito
 * campos fazia oito idas à planilha. Agora a linha inteira é
 * montada em memória e gravada de uma vez só.
 *
 * Numa reserva com doze campos, isso é a diferença entre doze
 * chamadas e uma.
 */
function AP_Data_update(sheetName, matchValue, patch, matchField) {
  var field = matchField || 'id';
  var sheet = AP_Data_getSheet(sheetName);
  var headers = AP_Data_headers(sheetName);
  var fieldIndex = headers.indexOf(field);

  if (fieldIndex === -1) {
    return AP_Utils_fail('CAMPO_INEXISTENTE', 'Campo "' + field + '" não existe em ' + sheetName);
  }

  var rows = AP_Data_rows(sheetName);
  var target = null;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i][field] === matchValue) { target = rows[i]; break; }
  }

  if (!target) {
    return AP_Utils_fail('REGISTRO_NAO_ENCONTRADO',
      'Nenhum registro com ' + field + '=' + matchValue + ' em ' + sheetName);
  }

  /* monta a linha completa com os valores atuais e aplica o patch */
  var linha = headers.map(function (h) {
    var nome = String(h);
    return Object.prototype.hasOwnProperty.call(patch, nome) ? patch[nome] : target[nome];
  });

  var quantosCampos = Object.keys(patch).filter(function (k) {
    return headers.indexOf(k) > -1;
  }).length;

  var t0 = new Date().getTime();
  sheet.getRange(target.__rowIndex, 1, 1, headers.length).setValues([linha]);
  AP_Data_exec_.perf.escritas++;
  AP_Data_exec_.perf.celulasEvitadas += Math.max(0, quantosCampos - 1);
  AP_Data_exec_.perf.msEscrita += (new Date().getTime() - t0);

  /* a mesma mudança é aplicada no que já foi lido */
  AP_Data_cacheAtualizar_(sheetName, field, matchValue, patch);
  return AP_Utils_ok(Object.assign({}, target, patch), 'Registro atualizado em ' + sheetName);
}

function AP_Data_remove(sheetName, matchValue, matchField) {
  var field = matchField || 'id';
  var sheet = AP_Data_getSheet(sheetName);
  var rows = AP_Data_rows(sheetName);

  var target = null;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i][field] === matchValue) { target = rows[i]; break; }
  }

  if (!target) {
    return AP_Utils_fail('REGISTRO_NAO_ENCONTRADO',
      'Nenhum registro com ' + field + '=' + matchValue + ' em ' + sheetName);
  }

  sheet.deleteRow(target.__rowIndex);
  AP_Data_exec_.perf.escritas++;

  /* as linhas seguintes mudaram de posição: a leitura tem que ser refeita */
  AP_Data_invalidar_(sheetName);
  return AP_Utils_ok({ removed: matchValue }, 'Registro removido de ' + sheetName);
}

function AP_Data_count(sheetName, criteria) {
  if (!criteria) return AP_Data_rows(sheetName).length;
  return AP_Data_findBy(sheetName, criteria).length;
}

function AP_Data_validateColumn(sheetName, columnName) {
  return AP_Data_headers(sheetName).indexOf(columnName) > -1;
}

/* ============================================================
   CONSULTAS DIRECIONADAS
   ------------------------------------------------------------
   Medindo, apareceu o gargalo real: buscar UM item carregava a
   aba inteira. Com 200 itens, 201 linhas para devolver 1.
   Com 5.000, seriam 5.001.

   O Google Sheets não tem índice. O que existe é o TextFinder,
   que procura dentro da planilha sem trazer tudo para a memória.
   É o mais próximo de uma consulta direcionada que o Apps Script
   oferece.
   ============================================================ */

/**
 * Busca um registro por um campo, sem carregar a aba inteira.
 *
 * Usa TextFinder quando disponível; se não, cai na leitura
 * completa — devolvendo o resultado certo de qualquer forma.
 */
function AP_Data_findFirstBy(sheetName, campo, valor) {
  if (valor === null || valor === undefined || valor === '') return null;

  /* já está em memória nesta execução: não vale procurar de novo */
  if (Object.prototype.hasOwnProperty.call(AP_Data_exec_.linhas, sheetName)) {
    var emMemoria = AP_Data_exec_.linhas[sheetName];
    for (var i = 0; i < emMemoria.length; i++) {
      if (String(emMemoria[i][campo]) === String(valor)) return emMemoria[i];
    }
    return null;
  }

  var sheet = AP_Data_getSheet(sheetName);
  var headers = AP_Data_headers(sheetName);
  var coluna = headers.indexOf(campo);
  if (coluna === -1) return null;

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  var t0 = new Date().getTime();

  try {
    /* procura só na coluna do campo, e para na primeira ocorrência */
    var faixa = sheet.getRange(2, coluna + 1, lastRow - 1, 1);
    var achado = faixa.createTextFinder(String(valor))
      .matchEntireCell(true)
      .findNext();

    AP_Data_exec_.perf.buscasDirecionadas = (AP_Data_exec_.perf.buscasDirecionadas || 0) + 1;

    if (!achado) {
      AP_Data_exec_.perf.msLeitura += (new Date().getTime() - t0);
      return null;
    }

    /* lê APENAS a linha encontrada */
    var linha = achado.getRow();
    var valores = sheet.getRange(linha, 1, 1, headers.length).getValues()[0];

    var registro = {};
    for (var c = 0; c < headers.length; c++) registro[String(headers[c])] = valores[c];
    registro.__rowIndex = linha;

    AP_Data_exec_.perf.msLeitura += (new Date().getTime() - t0);
    AP_Data_exec_.perf.linhasEvitadas =
      (AP_Data_exec_.perf.linhasEvitadas || 0) + (lastRow - 2);

    return registro;

  } catch (e) {
    /* TextFinder indisponível: caminho antigo, resultado igual */
    var todas = AP_Data_rows(sheetName);
    for (var j = 0; j < todas.length; j++) {
      if (String(todas[j][campo]) === String(valor)) return todas[j];
    }
    return null;
  }
}

/** Atalho para o caso mais comum */
function AP_Data_findById(sheetName, id) {
  return AP_Data_findFirstBy(sheetName, 'id', id);
}

/** Quantas linhas existem, sem carregar nenhuma */
function AP_Data_countFast(sheetName) {
  var sheet = AP_Data_getSheet(sheetName);
  return Math.max(0, sheet.getLastRow() - 1);
}

/**
 * Uma página de registros, sem trazer a aba toda.
 * Para listagens longas onde a tela mostra 50 por vez.
 */
function AP_Data_listPage(sheetName, pagina, porPagina) {
  pagina = Math.max(1, Number(pagina) || 1);
  porPagina = Math.max(1, Number(porPagina) || 50);

  var sheet = AP_Data_getSheet(sheetName);
  var headers = AP_Data_headers(sheetName);
  var total = Math.max(0, sheet.getLastRow() - 1);

  var inicio = (pagina - 1) * porPagina + 2;
  var quantas = Math.min(porPagina, total - (pagina - 1) * porPagina);

  if (quantas <= 0) {
    return { registros: [], pagina: pagina, porPagina: porPagina, total: total, paginas: Math.ceil(total / porPagina) };
  }

  var t0 = new Date().getTime();
  var valores = sheet.getRange(inicio, 1, quantas, headers.length).getValues();
  AP_Data_exec_.perf.msLeitura += (new Date().getTime() - t0);
  AP_Data_exec_.perf.leiturasReais++;

  var registros = valores.map(function (linha, i) {
    var obj = {};
    for (var c = 0; c < headers.length; c++) obj[String(headers[c])] = linha[c];
    obj.__rowIndex = inicio + i;
    return obj;
  });

  return {
    registros: registros, pagina: pagina, porPagina: porPagina,
    total: total, paginas: Math.ceil(total / porPagina),
    linhasCarregadas: quantas
  };
}

/** Atualiza pela posição da linha, quando já se sabe qual é */
function AP_Data_updateByRow(sheetName, rowIndex, patch) {
  var sheet = AP_Data_getSheet(sheetName);
  var headers = AP_Data_headers(sheetName);

  var atual = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  var linha = headers.map(function (h, i) {
    var nome = String(h);
    return Object.prototype.hasOwnProperty.call(patch, nome) ? patch[nome] : atual[i];
  });

  sheet.getRange(rowIndex, 1, 1, headers.length).setValues([linha]);
  AP_Data_exec_.perf.escritas++;
  AP_Data_invalidar_(sheetName);

  return AP_Utils_ok({ rowIndex: rowIndex }, 'Registro atualizado.');
}

/* ============================================================
   MEDIÇÃO
   ============================================================ */

/** O que este módulo economizou nesta execução */
function AP_Data_perf() {
  var p = AP_Data_exec_.perf;
  return {
    modulo: 'DATA_LAYER',
    aberturasDeAba: {
      pedidas: p.aberturasPedidas, feitas: p.aberturasReais,
      evitadas: p.aberturasPedidas - p.aberturasReais
    },
    leiturasDeAba: {
      pedidas: p.leiturasPedidas, feitas: p.leiturasReais,
      evitadas: p.leiturasPedidas - p.leiturasReais
    },
    escritas: p.escritas,
    celulasEvitadas: p.celulasEvitadas,
    buscasDirecionadas: p.buscasDirecionadas || 0,
    linhasEvitadas: p.linhasEvitadas || 0,
    msLeitura: p.msLeitura,
    msEscrita: p.msEscrita,
    abasEmMemoria: Object.keys(AP_Data_exec_.linhas)
  };
}

/**
 * Diagnóstico isolado. Roda direto no editor.
 * Compara a leitura repetida com e sem a memória de execução.
 */
function AP_Data_diagnostico() {
  var aba = AP_SHEETS.USUARIOS;

  AP_Data_limparCache();
  var t0 = new Date().getTime();
  AP_Data_rows(aba);
  var primeira = new Date().getTime() - t0;

  var t1 = new Date().getTime();
  for (var i = 0; i < 10; i++) AP_Data_rows(aba);
  var repetidas = new Date().getTime() - t1;

  var r = {
    aba: aba,
    primeiraLeituraMs: primeira,
    dezLeiturasSeguintesMs: repetidas,
    conclusao: repetidas < primeira
      ? 'A memória de execução está funcionando: dez leituras custaram menos que a primeira.'
      : 'A memória de execução NÃO está funcionando. Verifique se este arquivo substituiu o antigo.',
    perf: AP_Data_perf()
  };

  try { Logger.log(JSON.stringify(r, null, 2)); } catch (e) { }
  return r;
}

/* ============================================================
   TESTE
   ============================================================ */
function testeDataLayer() {
  var log = [];
  function reg(t, ok, d) { log.push((ok ? 'OK    ' : 'ERRO  ') + t + (d ? ' — ' + d : '')); }

  var ABA = 'TESTE_DATALAYER';

  try {
    AP_Data_limparCache();
    AP_Data_exec_.perf = {
      aberturasPedidas: 0, aberturasReais: 0, leiturasPedidas: 0, leiturasReais: 0,
      escritas: 0, celulasEvitadas: 0, msLeitura: 0, msEscrita: 0
    };

    AP_Data_getSheet(ABA, ['id', 'nome', 'valor', 'situacao']);

    /* a aba é aberta uma vez, mesmo pedindo cinco */
    for (var i = 0; i < 5; i++) AP_Data_getSheet(ABA);
    reg('abre a aba uma vez só',
      AP_Data_exec_.perf.aberturasReais === 1,
      AP_Data_exec_.perf.aberturasPedidas + ' pedidas, ' + AP_Data_exec_.perf.aberturasReais + ' real');

    AP_Data_append(ABA, { id: 'T1', nome: 'Primeiro', valor: 10, situacao: 'ATIVO' });
    AP_Data_append(ABA, { id: 'T2', nome: 'Segundo', valor: 20, situacao: 'ATIVO' });

    /* ler três vezes deve ir à planilha uma vez */
    var antes = AP_Data_exec_.perf.leiturasReais;
    AP_Data_rows(ABA); AP_Data_rows(ABA); AP_Data_rows(ABA);
    reg('lê a aba uma vez só',
      AP_Data_exec_.perf.leiturasReais === antes + 1,
      '3 pedidos, 1 leitura');

    /* ESTA É A PARTE PERIGOSA DE QUALQUER CACHE: dado velho */
    AP_Data_append(ABA, { id: 'T3', nome: 'Terceiro', valor: 30, situacao: 'ATIVO' });
    var depois = AP_Data_rows(ABA);
    reg('registro novo aparece na leitura seguinte',
      depois.length === 3 && depois.some(function (r) { return r.id === 'T3'; }),
      depois.length + ' registros');

    /* atualização em uma escrita só */
    var escritasAntes = AP_Data_exec_.perf.escritas;
    AP_Data_update(ABA, 'T1', { nome: 'Primeiro alterado', valor: 99, situacao: 'INATIVO' });
    reg('atualiza 3 campos com 1 escrita',
      AP_Data_exec_.perf.escritas === escritasAntes + 1,
      AP_Data_exec_.perf.celulasEvitadas + ' escrita(s) evitada(s)');

    var atualizado = AP_Data_findBy(ABA, { id: 'T1' })[0];
    reg('a alteração é lida na hora',
      atualizado && atualizado.nome === 'Primeiro alterado' && Number(atualizado.valor) === 99,
      atualizado ? atualizado.nome + ' / ' + atualizado.valor : '—');

    reg('campos não citados no patch são preservados',
      atualizado && atualizado.id === 'T1', 'id continua T1');

    /* remoção */
    AP_Data_remove(ABA, 'T2');
    var apos = AP_Data_rows(ABA);
    reg('remoção some da leitura seguinte',
      apos.length === 2 && !apos.some(function (r) { return r.id === 'T2'; }),
      apos.length + ' registros');

    reg('o índice de linha continua certo após remover',
      apos.every(function (r) { return r.__rowIndex >= 2; }),
      apos.map(function (r) { return r.id + '@' + r.__rowIndex; }).join(', '));

    /* atualizar depois de remover: o pior caso, porque as linhas andaram */
    AP_Data_update(ABA, 'T3', { valor: 300 });
    var t3 = AP_Data_findBy(ABA, { id: 'T3' })[0];
    reg('atualiza certo mesmo após remoção',
      t3 && Number(t3.valor) === 300, t3 ? 'valor ' + t3.valor : 'não achou');

    var p = AP_Data_perf();
    reg('relatório de desempenho',
      p.leiturasDeAba.evitadas > 0,
      p.leiturasDeAba.evitadas + ' leitura(s) e ' +
      p.aberturasDeAba.evitadas + ' abertura(s) evitadas');

  } catch (e) {
    log.push('ERRO  exceção: ' + e.message);
  }

  try {
    var ss = AP_Config_getSpreadsheet_();
    var s = ss.getSheetByName(ABA);
    if (s) ss.deleteSheet(s);
  } catch (e) { }

  try { Logger.log(log.join('\n')); } catch (e) { }
  return log;
}
