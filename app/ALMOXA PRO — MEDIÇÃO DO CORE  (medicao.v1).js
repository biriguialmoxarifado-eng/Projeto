/**
 * ============================================================
 * ALMOXA PRO — MEDIÇÃO DO CORE  (medicao.v1)
 * ============================================================
 * ESTE ARQUIVO SÓ LÊ. Não grava célula, não cria aba, não apaga
 * nada, não muda configuração. Pode rodar com o sistema em uso.
 *
 * Para que serve: as contas que eu fiz foram numa planilha de
 * mentira. Esta função mede na SUA planilha, com os seus dados,
 * e diz se o que eu encontrei acontece aí também.
 *
 * Como usar: cole num arquivo novo do projeto, abra o editor,
 * escolha ALMOXA_MEDIR_CORE e rode. O resultado sai no Log
 * (Ctrl+Enter) e também é devolvido pela função.
 *
 * Nenhum outro arquivo precisa ser alterado para isto rodar.
 * Se depois você quiser, é só apagar este arquivo.
 * ============================================================
 */

function ALMOXA_MEDIR_CORE() {
  var r = {
    quando: new Date().toISOString(),
    planilha: {},
    abas: [],
    buscaDirecionada: [],
    cache: {},
    avisos: [],
    conclusao: []
  };

  /* ---------- 1. abrir a planilha ---------- */
  var t0 = new Date().getTime();
  var ss;
  try {
    ss = AP_Config_getSpreadsheet_();
  } catch (e) {
    r.avisos.push('Não consegui abrir a planilha: ' + e.message);
    Logger.log(JSON.stringify(r, null, 2));
    return r;
  }
  r.planilha.msParaAbrir = new Date().getTime() - t0;
  r.planilha.nome = ss.getName();

  /* ---------- 2. a aba CONFIG ---------- */
  var t1 = new Date().getTime();
  try { AP_Config_get('SYSTEM_NAME'); } catch (e) {}
  r.planilha.msPrimeiraConfig = new Date().getTime() - t1;

  var t2 = new Date().getTime();
  for (var i = 0; i < 20; i++) { try { AP_Config_get('TIMEZONE'); } catch (e) {} }
  r.planilha.ms20ConfigsSeguintes = new Date().getTime() - t2;

  /* ---------- 3. cada aba: tamanho e tempo de leitura ---------- */
  /* IMPORTANTE: uso getSheetByName direto, NÃO AP_Data_getSheet,
     porque AP_Data_getSheet cria a aba quando ela não existe. */
  var nomes = [];
  try {
    ss.getSheets().forEach(function (s) { nomes.push(s.getName()); });
  } catch (e) {
    nomes = Object.keys(AP_SHEETS).map(function (k) { return AP_SHEETS[k]; });
  }

  nomes.forEach(function (nome) {
    var aba = ss.getSheetByName(nome);
    if (!aba) return;

    var linhas = aba.getLastRow();
    var colunas = aba.getLastColumn();
    var info = {
      aba: nome,
      linhas: Math.max(0, linhas - 1),
      colunas: colunas,
      celulas: Math.max(0, linhas - 1) * colunas
    };

    if (linhas > 1 && colunas > 0) {
      var tl = new Date().getTime();
      var dados = aba.getRange(1, 1, linhas, colunas).getValues();
      info.msLeituraDireta = new Date().getTime() - tl;

      /* quanto ocuparia no CacheService, que tem teto de 100 KB */
      try {
        var tam = JSON.stringify(dados).length;
        info.kbSeFosseAoCache = Math.round(tam / 1024);
        info.cabeNoCache = tam <= 100 * 1024;
      } catch (e) { info.kbSeFosseAoCache = 'não deu para medir'; }
    }
    r.abas.push(info);
  });

  r.abas.sort(function (a, b) { return (b.celulas || 0) - (a.celulas || 0); });

  /* ---------- 4. os dois caminhos de findFirstBy concordam? ---------- */
  /* Para cada aba com dados, pego um valor REAL de cada uma das
     primeiras colunas e procuro das duas maneiras. Nada é gravado. */
  r.abas.slice(0, 6).forEach(function (info) {
    if (!info.linhas) return;
    var aba = ss.getSheetByName(info.aba);
    var cab = aba.getRange(1, 1, 1, info.colunas).getValues()[0];
    var amostra = aba.getRange(2, 1, 1, info.colunas).getValues()[0];

    for (var c = 0; c < Math.min(cab.length, 6); c++) {
      var campo = String(cab[c]);
      var valor = amostra[c];
      if (campo === '' || valor === '' || valor === null) continue;

      /* caminho A: aba ainda NÃO lida nesta execução → TextFinder */
      AP_Data_limparCache();
      var porFinder = null;
      try { porFinder = AP_Data_findFirstBy(info.aba, campo, valor); } catch (e) {}

      /* caminho B: aba JÁ lida → comparação String === String */
      AP_Data_limparCache();
      var porMemoria = null;
      try {
        AP_Data_rows(info.aba);
        porMemoria = AP_Data_findFirstBy(info.aba, campo, valor);
      } catch (e) {}

      var a = !!porFinder, bb = !!porMemoria;
      if (a !== bb) {
        r.buscaDirecionada.push({
          aba: info.aba,
          campo: campo,
          tipoDoValor: (valor instanceof Date) ? 'data' : typeof valor,
          formatoDaCelula: (function () {
            try { return aba.getRange(2, c + 1).getNumberFormat(); } catch (e) { return '?'; }
          })(),
          semLerAntes: a ? 'achou' : 'NÃO achou',
          lendoAntes: bb ? 'achou' : 'NÃO achou',
          risco: (!a && bb)
            ? 'GRAVE: quem chamar sem ter lido a aba conclui que o registro não existe'
            : 'os dois caminhos divergem'
        });
      }
    }
  });
  AP_Data_limparCache();

  /* ---------- 5. o mapa de configuração no cache ---------- */
  try {
    var cru = CacheService.getScriptCache().get(AP_CONFIG_MAP_KEY);
    if (cru === null) {
      r.cache.mapaDeConfig = 'não está no cache agora';
    } else {
      var umaVez = JSON.parse(cru);
      r.cache.mapaDeConfig = (typeof umaVez === 'string')
        ? 'guardado com DUAS serializações (ver ponto 6 do relatório)'
        : 'guardado uma vez só';
      var mapa = (typeof umaVez === 'string') ? JSON.parse(umaVez) : umaVez;
      r.cache.chavesNoMapa = Object.keys(mapa).length;
      if (Object.keys(mapa).length === 0) {
        r.avisos.push('O mapa de CONFIG está no cache e está VAZIO. ' +
          'O sistema está rodando nos valores default. Ver ponto 4 do relatório.');
      }
    }
  } catch (e) { r.cache.mapaDeConfig = 'não deu para ler: ' + e.message; }

  /* ---------- 6. abas previstas que não existem ---------- */
  /* se um módulo pedir uma destas, AP_Data_getSheet CRIA a aba */
  var previstas = [];
  Object.keys(AP_SHEETS).forEach(function (k) {
    if (!ss.getSheetByName(AP_SHEETS[k])) previstas.push(AP_SHEETS[k]);
  });
  if (previstas.length) {
    r.avisos.push('Abas que o Core espera e que não existem: ' + previstas.join(', ') +
      '. Na primeira vez que um módulo pedir uma delas, ela será CRIADA ' +
      'automaticamente e vazia, sem avisar.');
  }

  /* ---------- conclusão em português ---------- */
  var maior = r.abas[0];
  if (maior && maior.msLeituraDireta !== undefined) {
    r.conclusao.push('A maior aba é ' + maior.aba + ', com ' + maior.linhas +
      ' linhas, e leva ' + maior.msLeituraDireta + ' ms para ser lida inteira. ' +
      'Esse custo é pago de novo em CADA requisição que precisar dela, ' +
      'porque a memória de execução morre no fim da requisição.');
  }
  var naoCabem = r.abas.filter(function (a) { return a.cabeNoCache === false; });
  if (naoCabem.length) {
    r.conclusao.push('Estas abas NÃO cabem numa chave do CacheService (teto de 100 KB): ' +
      naoCabem.map(function (a) { return a.aba + ' (' + a.kbSeFosseAoCache + ' KB)'; }).join(', ') +
      '. Guardá-las no cache exige partir em pedaços — não dá para fazer direto.');
  }
  if (r.buscaDirecionada.length) {
    r.conclusao.push('findFirstBy devolve respostas diferentes conforme a ordem das ' +
      'chamadas em ' + r.buscaDirecionada.length + ' campo(s). Detalhe em buscaDirecionada.');
  } else {
    r.conclusao.push('findFirstBy concordou nos campos testados. Bom sinal, ' +
      'mas foram só as primeiras colunas das maiores abas.');
  }
  r.conclusao.push('Esta medição não gravou nada.');

  Logger.log(JSON.stringify(r, null, 2));
  return r;
}
