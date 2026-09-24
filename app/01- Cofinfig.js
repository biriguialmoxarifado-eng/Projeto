/**
 * ============================================================
 * ALMOXA PRO - CORE MASTER
 * 01 - CONFIGURAÇÃO CENTRAL  (versão otimizada)
 * ============================================================
 * Único ponto de leitura/escrita de configurações do sistema.
 * Nenhum outro módulo deve ler PropertiesService ou hardcodar
 * IDs / nomes de abas diretamente — tudo passa por AP_Config_get().
 *
 * O QUE MUDOU NESTA VERSÃO (nada de assinatura pública foi alterado):
 *  1. A aba CONFIG é lida UMA vez por execução e virada num mapa.
 *     Antes, cada chave lida abria a planilha e varria a aba inteira.
 *  2. O handle da planilha fica memorizado na execução (openById 1x).
 *  3. As Script Properties são lidas de uma vez (getProperties).
 *  4. Chave inexistente também entra no cache negativo — antes ela
 *     batia na planilha em toda chamada, para sempre.
 *  5. O TTL passou a respeitar CACHE_TTL_SECONDS em vez de 60 fixo.
 *  6. AP_Config_set grava as duas células numa única escrita.
 *  7. Contadores de performance expostos em AP_Config_perf().
 *
 * Compatibilidade preservada: AP_SHEETS, AP_DEFAULT_CONFIG,
 * AP_Config_get, AP_Config_set, AP_Config_getSpreadsheet_ e
 * AP_Config_readFromSheet_ continuam existindo com o mesmo
 * comportamento externo.
 */

var AP_SHEETS = {
  CONFIG: 'CONFIG',
  USUARIOS: 'USUARIOS',
  LOG: 'LOG',
  AUDITORIA: 'AUDITORIA',
  EVENTOS: 'EVENTOS',
  SESSOES: 'SESSOES',
  MODULOS: 'MODULOS',
  DIAGNOSTICOS: 'DIAGNOSTICOS',
  BACKUP: 'BACKUP',
  SYNC: 'SYNC'
};

var AP_DEFAULT_CONFIG = {
  SYSTEM_NAME: 'ALMOXA PRO',
  SYSTEM_VERSION: '1.0.1-core',
  SYSTEM_BUILD: 2,
  SPREADSHEET_ID: '', // definir em Configurações do Script (PropertiesService) ou na aba CONFIG
  TIMEZONE: 'America/Sao_Paulo',
  SESSION_TTL_MINUTES: 480,
  CACHE_TTL_SECONDS: 300,
  LOCK_TIMEOUT_MS: 10000,
  DIAG_VERBOSE: true,
  PERFORMANCE_DEBUG: false,
  UI_THEME: 'default',
  UI_PRIMARY_COLOR: '#0B5FFF'
};

/** Chave única do mapa de configuração no cache compartilhado. */
var AP_CONFIG_MAP_KEY = 'AP_CONFIG_MAP_V1';

/**
 * Memória da execução atual. Some quando a execução termina.
 * É aqui que está o maior ganho: numa única chamada do doGet/doPost,
 * o Core costuma ler dezenas de chaves de configuração.
 */
var AP_Config_exec_ = {
  ss: null,          // handle da planilha
  mapa: null,        // { CHAVE: valor } vindo da aba CONFIG
  props: null,       // { CHAVE: valor } vindo do PropertiesService
  resolvidas: {},    // cache por chave já resolvida nesta execução
  perf: {
    leiturasSheet: 0,
    leiturasProps: 0,
    acertosExec: 0,
    acertosCache: 0,
    faltas: 0,
    msSheet: 0,
    msPlanilha: 0
  }
};

/**
 * Retorna um valor de configuração.
 * Ordem de resolução: aba CONFIG (Sheets) > PropertiesService (Script) > AP_DEFAULT_CONFIG.
 * @param {string} key
 * @param {*} fallback valor a retornar se a chave não existir em nenhum lugar
 */
function AP_Config_get(key, fallback) {
  try {
    // 1) já resolvida nesta execução? custo zero.
    if (Object.prototype.hasOwnProperty.call(AP_Config_exec_.resolvidas, key)) {
      AP_Config_exec_.perf.acertosExec++;
      var jaTem = AP_Config_exec_.resolvidas[key];
      return (jaTem === undefined) ? AP_Config_default_(key, fallback) : jaTem;
    }

    var valor;

    // 2) aba CONFIG — mapa carregado uma única vez
    var mapa = AP_Config_mapa_();
    if (Object.prototype.hasOwnProperty.call(mapa, key)) valor = mapa[key];

    // 3) PropertiesService — carregado uma única vez
    if (AP_Config_vazio_(valor)) {
      var props = AP_Config_props_();
      if (Object.prototype.hasOwnProperty.call(props, key)) valor = props[key];
    }

    // 4) default do Core
    if (AP_Config_vazio_(valor)) {
      AP_Config_exec_.resolvidas[key] = undefined; // cache negativo
      return AP_Config_default_(key, fallback);
    }

    AP_Config_exec_.resolvidas[key] = valor;
    return valor;
  } catch (e) {
    // Config nunca deve travar o boot.
    try { AP_Logger_error('AP_Config_get', 'Falha ao ler config ' + key, { error: String(e) }); } catch (e2) {}
    return AP_Config_default_(key, fallback);
  }
}

/**
 * Lê várias chaves de uma vez. Use isto no boot em lugar de
 * chamar AP_Config_get() dez vezes seguidas.
 * @param {Array<string>} chaves
 * @return {Object} { CHAVE: valor }
 */
function AP_Config_getMany(chaves) {
  var out = {};
  var lista = chaves || Object.keys(AP_DEFAULT_CONFIG);
  for (var i = 0; i < lista.length; i++) {
    out[lista[i]] = AP_Config_get(lista[i]);
  }
  return out;
}

/**
 * Define/atualiza um valor de configuração na aba CONFIG.
 * @param {string} key
 * @param {*} value
 */
function AP_Config_set(key, value) {
  var ss = AP_Config_getSpreadsheet_();
  var sheet = ss.getSheetByName(AP_SHEETS.CONFIG);

  if (!sheet) {
    sheet = ss.insertSheet(AP_SHEETS.CONFIG);
    sheet.getRange(1, 1, 1, 3).setValues([['CHAVE', 'VALOR', 'ATUALIZADO_EM']]);
  }

  var now = new Date();
  var ultimaLinha = sheet.getLastRow();

  if (ultimaLinha > 1) {
    // lê somente a coluna das chaves, não a planilha inteira
    var chaves = sheet.getRange(2, 1, ultimaLinha - 1, 1).getValues();
    for (var i = 0; i < chaves.length; i++) {
      if (chaves[i][0] === key) {
        // uma única escrita para as duas células
        sheet.getRange(i + 2, 2, 1, 2).setValues([[value, now]]);
        AP_Config_invalidar_(key, value);
        return AP_Utils_ok({ key: key, value: value }, 'Configuração atualizada.');
      }
    }
  }

  sheet.appendRow([key, value, now]);
  AP_Config_invalidar_(key, value);
  return AP_Utils_ok({ key: key, value: value }, 'Configuração atualizada.');
}

/**
 * Compatibilidade: mantida para quem já chamava esta função.
 * Passou a usar o mapa em memória em vez de varrer a planilha.
 * @param {string} key
 */
function AP_Config_readFromSheet_(key) {
  try {
    var mapa = AP_Config_mapa_();
    return Object.prototype.hasOwnProperty.call(mapa, key) ? mapa[key] : null;
  } catch (e) {
    return null;
  }
}

/**
 * Resolve o Spreadsheet ativo. Prioriza SPREADSHEET_ID configurado em
 * PropertiesService; se ausente, usa a planilha vinculada ao script.
 * O handle fica memorizado: openById() é caro e era chamado a cada leitura.
 */
function AP_Config_getSpreadsheet_() {
  if (AP_Config_exec_.ss) return AP_Config_exec_.ss;

  var t0 = new Date().getTime();
  var props = AP_Config_props_();
  var id = props.SPREADSHEET_ID;

  if (id) {
    AP_Config_exec_.ss = SpreadsheetApp.openById(id);
  } else {
    var active = SpreadsheetApp.getActiveSpreadsheet();
    if (!active) {
      throw new Error('SPREADSHEET_ID não configurado e nenhuma planilha ativa encontrada. ' +
        'Configure em Configurações do Projeto > Propriedades do Script > SPREADSHEET_ID.');
    }
    AP_Config_exec_.ss = active;
  }

  AP_Config_exec_.perf.msPlanilha += (new Date().getTime() - t0);
  return AP_Config_exec_.ss;
}

/* ============================================================
   INTERNOS
   ============================================================ */

/**
 * Carrega a aba CONFIG inteira como mapa, uma vez por execução.
 * Guarda o mapa no cache compartilhado sob uma única chave.
 */
function AP_Config_mapa_() {
  if (AP_Config_exec_.mapa) return AP_Config_exec_.mapa;

  // cache compartilhado (vale entre execuções)
  try {
    var doCache = AP_Cache_get(AP_CONFIG_MAP_KEY);
    if (doCache) {
      var obj = (typeof doCache === 'string') ? JSON.parse(doCache) : doCache;
      if (obj && typeof obj === 'object') {
        AP_Config_exec_.mapa = obj;
        AP_Config_exec_.perf.acertosCache++;
        return obj;
      }
    }
  } catch (e) {}

  AP_Config_exec_.perf.faltas++;
  var mapa = {};

  try {
    var t0 = new Date().getTime();
    var ss = AP_Config_getSpreadsheet_();
    var sheet = ss.getSheetByName(AP_SHEETS.CONFIG);

    if (sheet) {
      var ultima = sheet.getLastRow();
      if (ultima > 1) {
        // só as duas primeiras colunas, sem a coluna de data
        var dados = sheet.getRange(2, 1, ultima - 1, 2).getValues();
        for (var i = 0; i < dados.length; i++) {
          var k = dados[i][0];
          if (k !== '' && k !== null && k !== undefined) mapa[String(k)] = dados[i][1];
        }
      }
    }

    AP_Config_exec_.perf.leiturasSheet++;
    AP_Config_exec_.perf.msSheet += (new Date().getTime() - t0);
  } catch (e) {
    try { AP_Logger_error('AP_Config_mapa_', 'Falha ao carregar aba CONFIG', { error: String(e) }); } catch (e2) {}
  }

  AP_Config_exec_.mapa = mapa;

  // TTL configurável, com default do Core. Nunca usa AP_Config_get aqui
  // para não criar recursão.
  var ttl = Number(mapa.CACHE_TTL_SECONDS || AP_DEFAULT_CONFIG.CACHE_TTL_SECONDS) || 300;
  try { AP_Cache_set(AP_CONFIG_MAP_KEY, JSON.stringify(mapa), ttl); } catch (e3) {}

  return mapa;
}

/** Lê todas as Script Properties de uma vez. */
function AP_Config_props_() {
  if (AP_Config_exec_.props) return AP_Config_exec_.props;
  try {
    AP_Config_exec_.props = PropertiesService.getScriptProperties().getProperties() || {};
    AP_Config_exec_.perf.leiturasProps++;
  } catch (e) {
    AP_Config_exec_.props = {};
  }
  return AP_Config_exec_.props;
}

function AP_Config_vazio_(v) {
  return (v === null || v === undefined || v === '');
}

function AP_Config_default_(key, fallback) {
  return (key in AP_DEFAULT_CONFIG) ? AP_DEFAULT_CONFIG[key] : fallback;
}

/** Invalida o mapa e as chaves antigas por compatibilidade. */
function AP_Config_invalidar_(key, value) {
  AP_Config_exec_.mapa = null;
  AP_Config_exec_.resolvidas = {};
  try { AP_Cache_invalidate(AP_CONFIG_MAP_KEY); } catch (e) {}
  try { AP_Cache_invalidate('AP_CONFIG_' + key); } catch (e) {}
  if (key === 'SPREADSHEET_ID' && value) AP_Config_exec_.ss = null;
}

/**
 * Contadores de performance deste módulo.
 * O Doutor do Sistema pode chamar isto no fim de uma execução.
 */
function AP_Config_perf() {
  var p = AP_Config_exec_.perf;
  return {
    modulo: 'CONFIG',
    leiturasSheet: p.leiturasSheet,
    leiturasProps: p.leiturasProps,
    acertosExec: p.acertosExec,
    acertosCache: p.acertosCache,
    faltasCache: p.faltas,
    msSheet: p.msSheet,
    msAberturaPlanilha: p.msPlanilha,
    chavesResolvidas: Object.keys(AP_Config_exec_.resolvidas).length
  };
}

/**
 * Diagnóstico isolado deste módulo. Roda direto no editor para medir.
 * Não altera nada.
 */
function AP_Config_diagnostico() {
  var t0 = new Date().getTime();
  var chaves = Object.keys(AP_DEFAULT_CONFIG);
  var valores = AP_Config_getMany(chaves);
  var total = new Date().getTime() - t0;

  var perf = AP_Config_perf();
  var nivel = total <= 100 ? 'EXCELENTE'
    : total <= 300 ? 'BOM'
    : total <= 700 ? 'ATENCAO'
    : total <= 1500 ? 'LENTO' : 'CRITICO';

  var r = {
    totalMs: total,
    nivel: nivel,
    chavesLidas: chaves.length,
    perf: perf,
    gargalo: perf.msAberturaPlanilha > perf.msSheet ? 'ABERTURA_DA_PLANILHA' : 'LEITURA_DA_ABA_CONFIG',
    valores: valores
  };
  Logger.log(JSON.stringify(r, null, 2));
  return r;
}
