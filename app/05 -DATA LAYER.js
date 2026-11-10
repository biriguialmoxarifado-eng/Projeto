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
  validateColumn: function (sheetName, columnName) { return AP_Data_validateColumn(sheetName, columnName); },
  conferirCabecalho: function (sheetName) { return AP_Data_conferirCabecalho(sheetName); }
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

/**
 * [gravar.v1] A RÉGUA ÚNICA DE COMPARAÇÃO DESTE ARQUIVO.
 *
 * O que estava errado: AP_Data_update, AP_Data_remove e
 * AP_Data_findBy comparavam com ===, enquanto AP_Data_findFirstBy
 * comparava com String(a) === String(b).
 *
 * A planilha guarda matrícula, número de nota e código como
 * NÚMERO. O navegador manda tudo como TEXTO, porque é assim que
 * JSON funciona. Então 4147 === '4147' dava falso, e a gravação
 * voltava REGISTRO_NAO_ENCONTRADO para um registro que o próprio
 * sistema tinha achado e mostrado na tela.
 *
 * É a causa de "não deixa gravar" em toda parte do sistema:
 * salvar a senha de um usuário, acrescentar item numa nota,
 * qualquer edição cujo registro seja localizado por campo
 * numérico.
 *
 * Agora as quatro funções usam esta régua. Uma só.
 */
function AP_Data_mesmoValor_(naPlanilha, procurado) {
  if (naPlanilha === procurado) return true;
  if (naPlanilha === null || naPlanilha === undefined) return false;
  if (procurado === null || procurado === undefined) return false;
  return String(naPlanilha) === String(procurado);
}

function AP_Data_findBy(sheetName, criteria) {
  var rows = AP_Data_rows(sheetName);
  if (typeof criteria === 'function') return rows.filter(criteria);
  return rows.filter(function (row) {
    return Object.keys(criteria).every(function (key) {
      return AP_Data_mesmoValor_(row[key], criteria[key]);
    });
  });
}

/* ============================================================
   ESCRITA
   ============================================================ */

function AP_Data_append(sheetName, record) {
  var sheet = AP_Data_getSheet(sheetName);
  var headers = AP_Data_headers(sheetName);

  if (!headers.length) {
    /* [gravar.v2] aba SEM cabeçalho mas COM linhas é aba quebrada:
       escrever os nomes dos campos ali passaria por cima de dados
       de verdade. É assim que um cabeçalho vira lixo. */
    if (sheet.getLastRow() > 0) {
      return AP_Utils_fail('CABECALHO_AUSENTE',
        'A aba ' + sheetName + ' tem ' + sheet.getLastRow() +
        ' linha(s) mas a primeira está vazia. Não vou escrever cabeçalho' +
        ' por cima de dados. Corrija a linha 1 antes de gravar.');
    }
    headers = Object.keys(record);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    AP_Data_exec_.cabecalhos[sheetName] = headers;
  }

  var confA = AP_Data_conferirCabecalho_(headers);
  if (confA.vazios.length === headers.length && headers.length > 0) {
    return AP_Utils_fail('CABECALHO_AUSENTE',
      'A linha 1 da aba ' + sheetName + ' está em branco — não há cabeçalho. ' +
      'Não vou escrever cabeçalho por cima de dados. Corrija a linha 1 antes de gravar.');
  }
  if (!confA.ok) {
    return AP_Utils_fail('CABECALHO_INVALIDO',
      'A aba ' + sheetName + ' não pode receber gravação: ' +
      (confA.duplicados.length ? 'cabeçalho repetido em ' + confA.duplicados.join(', ') + '. ' : '') +
      (confA.vazios.length ? 'coluna sem nome na posição ' + confA.vazios.join(', ') + '. ' : ''));
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

/* ============================================================
   [gravar.v2] 10/11/2026 — POR QUE GRAVAR ESTRAGAVA
   ------------------------------------------------------------
   AP_Data_update montava a linha inteira a partir de "target",
   que é o objeto lido e convertido em memória, e escrevia as
   24 colunas de uma vez. Para gravar UM campo — a senha — ele
   regravava nome, e-mail, perfil, status, matrícula e datas.

   Três consequências, todas vistas na planilha de produção:

   1. Qualquer valor que mudou de tipo na leitura voltava
      estragado. Matrícula com zero à esquerda, data, número
      guardado como texto.
   2. Se dois cabeçalhos tiverem o mesmo nome, duas colunas
      viram uma chave só e TODO o resto da linha anda de lugar.
   3. Cabeçalho vazio no meio vira a chave "", e a coluna
      seguinte é gravada por cima.

   É assim que o nome da coluna 8 da aba USUARIOS virou um
   número de telefone.

   A correção não muda assinatura nenhuma:

   · a linha é relida CRUA da planilha no instante da escrita,
     e só as colunas do patch são trocadas — o resto volta
     exatamente como estava, sem passar por conversão;
   · o cabeçalho é conferido antes; se estiver duplicado ou
     furado, a gravação é RECUSADA com erro claro em vez de
     embaralhar a linha;
   · a chave é reconferida na linha antes de escrever, porque
     entre a leitura e a escrita a linha pode ter andado;
   · depois de escrever, lê de volta e confere. Só responde
     "ok" se o dado estiver lá — a regra dele: não informar
     que salvou sem confirmação real;
   · a escrita acontece dentro de uma trava, para duas
     gravações ao mesmo tempo não se perderem.
   ============================================================ */

/** Cabeçalho utilizável? Duplicado ou furado embaralha a linha. */
function AP_Data_conferirCabecalho_(headers) {
  var vistos = {}, duplicados = [], vazios = [];
  for (var i = 0; i < headers.length; i++) {
    var nome = String(headers[i] === null || headers[i] === undefined ? '' : headers[i]).trim();
    if (nome === '') { vazios.push(i + 1); continue; }
    if (Object.prototype.hasOwnProperty.call(vistos, nome)) {
      duplicados.push(nome + ' (colunas ' + vistos[nome] + ' e ' + (i + 1) + ')');
    } else {
      vistos[nome] = i + 1;
    }
  }
  return {
    ok: (duplicados.length === 0 && vazios.length === 0),
    duplicados: duplicados,
    vazios: vazios
  };
}

/** Quais colunas o patch realmente altera, em ordem. */
function AP_Data_colunasDoPatch_(headers, patch) {
  var alvos = [];
  for (var i = 0; i < headers.length; i++) {
    if (Object.prototype.hasOwnProperty.call(patch, String(headers[i]))) alvos.push(i);
  }
  return alvos;
}

/** Junta colunas vizinhas num bloco só, para escrever de uma vez. */
function AP_Data_blocos_(alvos) {
  var blocos = [];
  for (var i = 0; i < alvos.length; i++) {
    var ultimo = blocos[blocos.length - 1];
    if (ultimo && alvos[i] === ultimo.inicio + ultimo.quantas) { ultimo.quantas++; continue; }
    blocos.push({ inicio: alvos[i], quantas: 1 });
  }
  return blocos;
}

/** A trava da gravação. Documento quando há; senão, do script. */
function AP_Data_travar_() {
  var ms = 10000;
  try { ms = Number(AP_Config_get('LOCK_TIMEOUT_MS', 10000)) || 10000; } catch (e) {}
  var trava = null;
  try { trava = LockService.getDocumentLock(); } catch (e) { trava = null; }
  if (!trava) { try { trava = LockService.getScriptLock(); } catch (e2) { trava = null; } }
  if (!trava) return null;
  try { trava.waitLock(ms); } catch (e3) { return false; }
  return trava;
}

/** O que foi gravado é o que se pediu? Compara sem implicância. */
function AP_Data_gravouIgual_(naPlanilha, pedido) {
  if (AP_Data_mesmoValor_(naPlanilha, pedido)) return true;
  /* a planilha converte: '99' vira 99, '2026-11-10' vira Date */
  var a = Number(naPlanilha), b = Number(pedido);
  if (!isNaN(a) && !isNaN(b) && String(naPlanilha).trim() !== '' &&
      String(pedido).trim() !== '' && a === b) return true;
  try {
    if (naPlanilha instanceof Date && pedido instanceof Date) {
      return naPlanilha.getTime() === pedido.getTime();
    }
    if (naPlanilha instanceof Date && pedido) {
      var d = new Date(pedido);
      if (!isNaN(d.getTime())) return naPlanilha.getTime() === d.getTime();
    }
  } catch (e) {}
  return false;
}

/**
 * Conferência de cabeçalho para quem precisa olhar sem gravar.
 * Não altera nada. Use quando uma aba começar a gravar torto.
 */
function AP_Data_conferirCabecalho(sheetName) {
  var headers = AP_Data_headers(sheetName);
  var r = AP_Data_conferirCabecalho_(headers);
  r.aba = sheetName;
  r.colunas = headers.length;
  r.cabecalho = headers.map(function (h) { return String(h); });
  r.suspeitos = r.cabecalho.filter(function (n) { return /^[0-9]+$/.test(n.trim()); });
  try { Logger.log(JSON.stringify(r, null, 2)); } catch (e) {}
  return r;
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

  /* [gravar.v1] chave vazia não é "o primeiro registro em branco":
     é chamada errada. Sem esta recusa, um matchValue vazio casaria
     com a primeira linha de campo vazio e gravaria por cima dela. */
  if (matchValue === null || matchValue === undefined || matchValue === '') {
    return AP_Utils_fail('CHAVE_VAZIA',
      'Tentou atualizar em ' + sheetName + ' sem informar o valor de "' + field + '".');
  }

  var sheet = AP_Data_getSheet(sheetName);
  var headers = AP_Data_headers(sheetName);
  var fieldIndex = headers.indexOf(field);

  if (fieldIndex === -1) {
    return AP_Utils_fail('CAMPO_INEXISTENTE', 'Campo "' + field + '" não existe em ' + sheetName);
  }

  /* [gravar.v2] cabeçalho furado embaralha a linha inteira na
     escrita. Recusar é melhor que gravar torto. */
  var conf = AP_Data_conferirCabecalho_(headers);
  if (conf.vazios.length === headers.length && headers.length > 0) {
    return AP_Utils_fail('CABECALHO_AUSENTE',
      'A linha 1 da aba ' + sheetName + ' está em branco — não há cabeçalho. ' +
      'Não vou escrever cabeçalho por cima de dados. Corrija a linha 1 antes de gravar.');
  }
  if (!conf.ok) {
    return AP_Utils_fail('CABECALHO_INVALIDO',
      'A aba ' + sheetName + ' não pode receber gravação: ' +
      (conf.duplicados.length ? 'cabeçalho repetido em ' + conf.duplicados.join(', ') + '. ' : '') +
      (conf.vazios.length ? 'coluna sem nome na posição ' + conf.vazios.join(', ') + '. ' : '') +
      'Corrija o cabeçalho antes de gravar — gravar assim embaralharia a linha.');
  }

  /* [gravar.v2] a trava: duas gravações ao mesmo tempo na mesma
     linha faziam a segunda apagar a primeira sem ninguém ver. */
  var trava = AP_Data_travar_();
  if (trava === false) {
    return AP_Utils_fail('OCUPADO',
      'Outra gravação está em andamento em ' + sheetName + '. Tente de novo em instantes.');
  }

  try {
    var rows = AP_Data_rows(sheetName);
    var target = null;
    for (var i = 0; i < rows.length; i++) {
      if (AP_Data_mesmoValor_(rows[i][field], matchValue)) { target = rows[i]; break; }
    }

    if (!target) {
      /* a mensagem diz o que foi procurado e de que tipo. Antes dizia
         só "não encontrado", e quem lia o log não tinha como saber
         que o problema era texto contra número. */
      return AP_Utils_fail('REGISTRO_NAO_ENCONTRADO',
        'Nenhum registro com ' + field + '=' + matchValue +
        ' (' + (typeof matchValue) + ') em ' + sheetName + '. ' +
        'A aba tem ' + rows.length + ' registro(s).');
    }

    var linhaNaPlanilha = target.__rowIndex;

    /* [gravar.v2] A MUDANÇA QUE IMPORTA.
       A linha é relida CRUA da planilha agora, no instante da
       escrita. As colunas que o patch não cita voltam exatamente
       como estavam — sem passar pela conversão da leitura, que é
       onde matrícula com zero à esquerda, data e número guardado
       como texto se perdiam. */
    var cruas = sheet.getRange(linhaNaPlanilha, 1, 1, headers.length).getValues()[0];

    /* entre a leitura e a escrita a linha pode ter andado: alguém
       removeu um registro acima, ou a aba foi ordenada. Gravar sem
       conferir escreveria por cima de outra pessoa. */
    if (!AP_Data_mesmoValor_(cruas[fieldIndex], matchValue)) {
      AP_Data_invalidar_(sheetName);
      return AP_Utils_fail('LINHA_MUDOU',
        'A linha ' + linhaNaPlanilha + ' de ' + sheetName + ' não é mais a do ' +
        field + '=' + matchValue + '. Nada foi gravado. Tente de novo.');
    }

    /* [gravar.v2] SÓ AS COLUNAS DO PATCH SÃO ESCRITAS.
       Reescrever a linha inteira não tinha como dar certo: ao
       devolver uma matrícula "0408215" para a célula, a planilha
       converte de novo para o número 408215. O zero à esquerda,
       a data e o número guardado como texto se perdiam SEM
       ninguém ter pedido para mudá-los.

       Agora as colunas que o patch não cita nunca são tocadas —
       e o que não é escrito não tem como estragar.

       As colunas vizinhas vão juntas numa escrita só, para não
       perder o ganho de desempenho: um patch de um campo é UMA
       escrita, menos que a linha inteira de antes. */
    var alvos = AP_Data_colunasDoPatch_(headers, patch);

    if (!alvos.length) {
      return AP_Utils_fail('PATCH_SEM_CAMPO_CONHECIDO',
        'Nenhum campo do patch existe em ' + sheetName + '. ' +
        'Enviados: ' + Object.keys(patch).join(', ') + '. ' +
        'A aba tem: ' + headers.map(function (h) { return String(h); }).join(', ') + '.');
    }

    var t0 = new Date().getTime();
    var blocos = AP_Data_blocos_(alvos);
    for (var b = 0; b < blocos.length; b++) {
      var bl = blocos[b];
      var valores = [];
      for (var k = 0; k < bl.quantas; k++) {
        var nomeCol = String(headers[bl.inicio + k]);
        valores.push(Object.prototype.hasOwnProperty.call(patch, nomeCol)
          ? patch[nomeCol] : cruas[bl.inicio + k]);
      }
      sheet.getRange(linhaNaPlanilha, bl.inicio + 1, 1, bl.quantas).setValues([valores]);
    }
    try { SpreadsheetApp.flush(); } catch (eF) {}

    /* [gravar.v2] lê de volta e confere. "Não informar que salvou
       sem confirmação real" é regra da casa. */
    var depois = sheet.getRange(linhaNaPlanilha, 1, 1, headers.length).getValues()[0];
    var naoGravou = [];
    for (var c = 0; c < alvos.length; c++) {
      var campo = String(headers[alvos[c]]);
      if (!AP_Data_gravouIgual_(depois[alvos[c]], patch[campo])) naoGravou.push(campo);
    }
    if (naoGravou.length) {
      AP_Data_invalidar_(sheetName);
      return AP_Utils_fail('GRAVACAO_NAO_CONFIRMADA',
        'Escrevi em ' + sheetName + ' linha ' + linhaNaPlanilha +
        ' mas ao reler o campo não bateu: ' + naoGravou.join(', ') + '. ' +
        'Nada foi dado como salvo.');
    }

    AP_Data_exec_.perf.escritas += blocos.length;
    AP_Data_exec_.perf.celulasEvitadas += Math.max(0, headers.length - alvos.length);
    AP_Data_exec_.perf.msEscrita += (new Date().getTime() - t0);

    /* a mesma mudança é aplicada no que já foi lido */
    AP_Data_cacheAtualizar_(sheetName, field, matchValue, patch);
    return AP_Utils_ok(Object.assign({}, target, patch), 'Registro atualizado em ' + sheetName);

  } finally {
    try { if (trava) trava.releaseLock(); } catch (eL) {}
  }
}

function AP_Data_remove(sheetName, matchValue, matchField) {
  var field = matchField || 'id';

  /* [gravar.v1] remover com chave vazia apagaria a primeira linha
     de campo em branco. Isso nunca é o que se quis pedir. */
  if (matchValue === null || matchValue === undefined || matchValue === '') {
    return AP_Utils_fail('CHAVE_VAZIA',
      'Tentou remover de ' + sheetName + ' sem informar o valor de "' + field + '".');
  }

  var sheet = AP_Data_getSheet(sheetName);
  var rows = AP_Data_rows(sheetName);

  var target = null;
  for (var i = 0; i < rows.length; i++) {
    if (AP_Data_mesmoValor_(rows[i][field], matchValue)) { target = rows[i]; break; }
  }

  if (!target) {
    return AP_Utils_fail('REGISTRO_NAO_ENCONTRADO',
      'Nenhum registro com ' + field + '=' + matchValue +
      ' (' + (typeof matchValue) + ') em ' + sheetName + '.');
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

  /* A REGRA DA CASA — AP_Data_mesmoValor_, a mesma que update,
     remove e findBy passaram a usar. */
  function AP_Data_ehAProcurada_(registro) {
    return !!registro && AP_Data_mesmoValor_(registro[campo], valor);
  }

  /* ---------- caminho 1: a aba já está na memória da execução ---------- */
  if (Object.prototype.hasOwnProperty.call(AP_Data_exec_.linhas, sheetName)) {
    var emMemoria = AP_Data_exec_.linhas[sheetName];
    for (var i = 0; i < emMemoria.length; i++) {
      if (AP_Data_ehAProcurada_(emMemoria[i])) return emMemoria[i];
    }
    return null;
  }

  var sheet = AP_Data_getSheet(sheetName);
  var headers = AP_Data_headers(sheetName);
  var coluna = headers.indexOf(campo);

  if (coluna === -1) {
    /* campo que não existe não é "registro não encontrado": é erro de
       quem chamou. Fica registrado para não virar cadastro duplicado
       silencioso. O devolvido continua null, para não quebrar ninguém. */
    try {
      AP_Logger_error('AP_Data_findFirstBy',
        'Campo "' + campo + '" não existe na aba ' + sheetName, {});
    } catch (e) {}
    return null;
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  var t0 = new Date().getTime();

  /* ---------- caminho 2: o atalho, sempre conferido ---------- */
  /* Data não entra aqui: a célula exibe 19/10/2026 e String(Date)
     devolve "Mon Oct 19 2026 ...". Tentar seria gastar uma ida ao
     Google para errar. */
  if (!(valor instanceof Date)) {
    try {
      var faixa = sheet.getRange(2, coluna + 1, lastRow - 1, 1);
      var achado = faixa.createTextFinder(String(valor))
        .matchEntireCell(true)
        .findNext();

      if (achado) {
        var linha = achado.getRow();
        var valores = sheet.getRange(linha, 1, 1, headers.length).getValues()[0];

        var registro = {};
        for (var c = 0; c < headers.length; c++) registro[String(headers[c])] = valores[c];
        registro.__rowIndex = linha;

        if (AP_Data_ehAProcurada_(registro)) {
          AP_Data_exec_.perf.msLeitura += (new Date().getTime() - t0);
          AP_Data_exec_.perf.buscasDirecionadas =
            (AP_Data_exec_.perf.buscasDirecionadas || 0) + 1;
          AP_Data_exec_.perf.linhasEvitadas =
            (AP_Data_exec_.perf.linhasEvitadas || 0) + (lastRow - 2);
          return registro;
        }
        /* o atalho trouxe outra linha — por exemplo porque o TextFinder
           ignora maiúsculas. Não serve: segue para a leitura. */
      }
    } catch (e) {
      /* TextFinder indisponível nesta conta: segue para a leitura */
    }
  }

  /* ---------- caminho 3: lê a aba e responde pela regra ---------- */
  /* ERA AQUI QUE SAÍA O "return null" QUE CAUSAVA O PROBLEMA.
     O atalho não ter achado não é prova de que não existe. */
  AP_Data_exec_.perf.msLeitura += (new Date().getTime() - t0);
  AP_Data_exec_.perf.atalhosSemResposta =
    (AP_Data_exec_.perf.atalhosSemResposta || 0) + 1;

  var todas = AP_Data_rows(sheetName);
  for (var j = 0; j < todas.length; j++) {
    if (AP_Data_ehAProcurada_(todas[j])) return todas[j];
  }
  return null;
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

  /* [gravar.v2] as mesmas proteções do AP_Data_update. Esta função
     grava pela POSIÇÃO, que é ainda mais arriscado: se a linha
     andou, ela escreve na pessoa errada sem nem perceber. */
  var conf = AP_Data_conferirCabecalho_(headers);
  if (!conf.ok) {
    return AP_Utils_fail('CABECALHO_INVALIDO',
      'A aba ' + sheetName + ' não pode receber gravação: ' +
      (conf.duplicados.length ? 'cabeçalho repetido em ' + conf.duplicados.join(', ') + '. ' : '') +
      (conf.vazios.length ? 'coluna sem nome na posição ' + conf.vazios.join(', ') + '. ' : ''));
  }

  var linhaNum = Number(rowIndex);
  if (!linhaNum || linhaNum < 2) {
    return AP_Utils_fail('LINHA_INVALIDA',
      'Linha ' + rowIndex + ' não é uma linha de dados de ' + sheetName +
      ' (a 1 é o cabeçalho).');
  }
  if (linhaNum > sheet.getLastRow()) {
    return AP_Utils_fail('LINHA_INVALIDA',
      'A aba ' + sheetName + ' tem ' + sheet.getLastRow() +
      ' linha(s); pediram para gravar na ' + linhaNum + '.');
  }

  var trava = AP_Data_travar_();
  if (trava === false) {
    return AP_Utils_fail('OCUPADO',
      'Outra gravação está em andamento em ' + sheetName + '. Tente de novo em instantes.');
  }

  try {
    var atual = sheet.getRange(linhaNum, 1, 1, headers.length).getValues()[0];

    var alvos = AP_Data_colunasDoPatch_(headers, patch);
    if (!alvos.length) {
      return AP_Utils_fail('PATCH_SEM_CAMPO_CONHECIDO',
        'Nenhum campo do patch existe em ' + sheetName + '. ' +
        'Enviados: ' + Object.keys(patch).join(', ') + '.');
    }

    /* [gravar.v2] só as colunas do patch, como no AP_Data_update */
    var blocos = AP_Data_blocos_(alvos);
    for (var b = 0; b < blocos.length; b++) {
      var bl = blocos[b];
      var valores = [];
      for (var k = 0; k < bl.quantas; k++) {
        var nomeCol = String(headers[bl.inicio + k]);
        valores.push(Object.prototype.hasOwnProperty.call(patch, nomeCol)
          ? patch[nomeCol] : atual[bl.inicio + k]);
      }
      sheet.getRange(linhaNum, bl.inicio + 1, 1, bl.quantas).setValues([valores]);
    }
    try { SpreadsheetApp.flush(); } catch (eF) {}

    var depois = sheet.getRange(linhaNum, 1, 1, headers.length).getValues()[0];
    var naoGravou = [];
    for (var c = 0; c < alvos.length; c++) {
      var campo = String(headers[alvos[c]]);
      if (!AP_Data_gravouIgual_(depois[alvos[c]], patch[campo])) naoGravou.push(campo);
    }
    AP_Data_invalidar_(sheetName);
    if (naoGravou.length) {
      return AP_Utils_fail('GRAVACAO_NAO_CONFIRMADA',
        'Escrevi em ' + sheetName + ' linha ' + linhaNum +
        ' mas ao reler o campo não bateu: ' + naoGravou.join(', ') + '.');
    }

    AP_Data_exec_.perf.escritas++;
    return AP_Utils_ok({ rowIndex: linhaNum }, 'Registro atualizado.');

  } finally {
    try { if (trava) trava.releaseLock(); } catch (eL) {}
  }
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