/**
 * ============================================================
 * 04 - LOGS
 * ============================================================
 * Logger central. Grava na aba LOG e também no Logger nativo do Apps
 * Script (Stackdriver/Execution log) para depuração em tempo real.
 */

var AP_LOG_LEVELS = { DEBUG: 'DEBUG', INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' };

function AP_Logger_debug(origin, message, data) { AP_Logger_write_(AP_LOG_LEVELS.DEBUG, origin, message, data); }
function AP_Logger_info(origin, message, data) { AP_Logger_write_(AP_LOG_LEVELS.INFO, origin, message, data); }
function AP_Logger_warn(origin, message, data) { AP_Logger_write_(AP_LOG_LEVELS.WARN, origin, message, data); }
function AP_Logger_error(origin, message, data) { AP_Logger_write_(AP_LOG_LEVELS.ERROR, origin, message, data); }

function AP_Logger_write_(level, origin, message, data) {
  // Sempre escreve no console de execução — nunca deve lançar exceção.
  try { console.log('[' + level + '] ' + origin + ': ' + message); } catch (e) {}

  try {
    var sheet = AP_Data_getSheet(AP_SHEETS.LOG, ['DATA', 'NIVEL', 'ORIGEM', 'MENSAGEM', 'DADOS']);
    sheet.appendRow([
      AP_Utils_now(),
      level,
      origin || '',
      message || '',
      data ? JSON.stringify(data) : ''
    ]);
  } catch (e) {
    // Se nem o log puder ser gravado na planilha, apenas registra no console.
    try { console.error('AP_Logger falhou ao gravar na planilha: ' + e); } catch (e2) {}
  }
}

/** Retorna os últimos N registros de log (uso do Doutor / diagnóstico). */
function AP_Logger_tail(n) {
  try {
    var sheet = AP_Data_getSheet(AP_SHEETS.LOG, ['DATA', 'NIVEL', 'ORIGEM', 'MENSAGEM', 'DADOS']);
    var rows = AP_Data_rows(AP_SHEETS.LOG);
    var limit = n || 20;
    return rows.slice(Math.max(0, rows.length - limit));
  } catch (e) {
    return [];
  }
}
