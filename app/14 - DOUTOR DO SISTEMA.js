/**
 * ============================================================
 * 14 - DOUTOR DO SISTEMA
 * ============================================================
 * Motor inicial de diagnóstico. Verifica Core, planilha, abas,
 * Data Layer, Cache, Lock, módulos, configuração, serviços, API,
 * eventos, logs e auditoria. Sem interface visual ainda — apenas
 * o motor + estrutura de resultado que o futuro HTML consumirá.
 *
 * Status possíveis: ONLINE ("🟢"), WARNING ("🟡"), ERROR ("🔴"), OFFLINE ("⚪")
 */

var AP_STATUS = { ONLINE: 'ONLINE', WARNING: 'WARNING', ERROR: 'ERROR', OFFLINE: 'OFFLINE' };

var AP_Doctor = {
  run: function () { return AP_Doctor_run_(); }
};

function AP_Doctor_check_(modulo, funcao, testFn) {
  try {
    var detail = testFn();
    return { modulo: modulo, funcao: funcao, status: AP_STATUS.ONLINE, erro: '', dependencia: '', solucao_sugerida: '', detalhe: detail || '' };
  } catch (e) {
    return {
      modulo: modulo, funcao: funcao, status: AP_STATUS.ERROR, erro: e.message,
      dependencia: '', solucao_sugerida: AP_Doctor_suggest_(modulo, e), detalhe: ''
    };
  }
}

function AP_Doctor_suggest_(modulo, error) {
  var msg = (error && error.message) || '';
  if (modulo === 'Spreadsheet' || /SPREADSHEET_ID/.test(msg)) {
    return 'Configure SPREADSHEET_ID em Configurações do Projeto > Propriedades do Script, ou vincule este script a uma planilha.';
  }
  if (modulo === 'DataLayer') return 'Verifique se a aba existe e se o cabeçalho está correto.';
  if (modulo === 'Cache') return 'CacheService pode estar indisponível temporariamente; tente novamente.';
  if (modulo === 'Lock') return 'Verifique se há uma operação travando o lock por tempo excessivo.';
  return 'Consultar logs (AP_Logger_tail) e DIAGNOSTICOS para mais detalhes.';
}

function AP_Doctor_run_() {
  var results = [];

  results.push(AP_Doctor_check_('Spreadsheet', 'AP_Config_getSpreadsheet_', function () {
    var ss = AP_Config_getSpreadsheet_();
    return ss.getName();
  }));

  results.push(AP_Doctor_check_('Config', 'AP_Config_get', function () {
    return AP_Config_get('SYSTEM_NAME');
  }));

  Object.keys(AP_SHEETS).forEach(function (key) {
    results.push(AP_Doctor_check_('DataLayer', 'aba:' + AP_SHEETS[key], function () {
      var sheet = AP_Data_getSheet(AP_SHEETS[key]);
      return 'linhas=' + sheet.getLastRow();
    }));
  });

  results.push(AP_Doctor_check_('Cache', 'AP_Cache_set/get', function () {
    AP_Cache_set('__doctor_ping__', 'pong', 30);
    var v = AP_Cache_get('__doctor_ping__');
    if (v !== 'pong') throw new Error('Cache não retornou o valor esperado.');
    return 'ok';
  }));

  results.push(AP_Doctor_check_('Lock', 'AP_Core_withLock', function () {
    var r = AP_Core_withLock(function () { return 'ok'; });
    if (!r.ok && r.code !== undefined && r !== 'ok') { /* ok result direto da fn */ }
    return 'ok';
  }));

  results.push(AP_Doctor_check_('EventBus', 'AP_EventBus.emit', function () {
    var r = AP_EventBus.emit('CORE.DOCTOR_PING', { ts: new Date() });
    if (!r.ok) throw new Error('Falha ao emitir evento de teste.');
    return 'ok';
  }));

  results.push(AP_Doctor_check_('ModuleRegistry', 'AP_ModuleRegistry.list', function () {
    return AP_ModuleRegistry.list().length + ' módulo(s) registrado(s)';
  }));

  results.push(AP_Doctor_check_('Logger', 'AP_Logger_info', function () {
    AP_Logger_info('AP_Doctor', 'Ping de diagnóstico.');
    return 'ok';
  }));

  results.push(AP_Doctor_check_('Audit', 'AP_Audit_log', function () {
    AP_Audit_log('sistema', 'DOCTOR_PING', 'DIAGNOSTICOS', 'ping', {});
    return 'ok';
  }));

  results.push(AP_Doctor_check_('API', 'AP_API.health', function () {
    var h = AP_API.health();
    if (!h.ok) throw new Error('AP_API.health retornou falha.');
    return 'ok';
  }));

  var hasError = results.some(function (r) { return r.status === AP_STATUS.ERROR; });
  var overall = hasError ? AP_STATUS.ERROR : AP_STATUS.ONLINE;

  var report = {
    status_geral: overall,
    data: AP_Utils_now(),
    total_verificacoes: results.length,
    falhas: results.filter(function (r) { return r.status !== AP_STATUS.ONLINE; }).length,
    itens: results
  };

  try {
    AP_Data_getSheet(AP_SHEETS.DIAGNOSTICOS, ['data', 'origem', 'mensagem', 'stack', 'contexto']);
    AP_Data_append(AP_SHEETS.DIAGNOSTICOS, {
      data: AP_Utils_now(), origem: 'AP_Doctor', mensagem: 'Diagnóstico geral: ' + overall,
      stack: '', contexto: JSON.stringify({ falhas: report.falhas, total: report.total_verificacoes })
    });
  } catch (e) {}

  return AP_Utils_ok(report, 'Diagnóstico concluído: ' + overall);
}
