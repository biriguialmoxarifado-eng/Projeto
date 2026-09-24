/**
 * ============================================================
 * 25 - TESTES
 * ============================================================
 * Rode TEST_CORE_FULL() pelo editor do Apps Script (selecione a
 * função no dropdown e clique em Executar) depois de AP_Core_boot().
 * Cada teste retorna { ok, test, message, details }.
 */

function AP_Test_result_(name, ok, message, details) {
  return { ok: ok, test: name, message: message, details: details || {} };
}

function TEST_CORE() {
  try {
    var boot = AP_Core_boot();
    return AP_Test_result_('TEST_CORE', boot.ok, boot.message, boot.data || boot.details);
  } catch (e) {
    return AP_Test_result_('TEST_CORE', false, e.message, { stack: e.stack });
  }
}

function TEST_CORE_HEALTH() {
  try {
    var r = AP_API.health();
    return AP_Test_result_('TEST_CORE_HEALTH', r.ok, r.message, r.data);
  } catch (e) {
    return AP_Test_result_('TEST_CORE_HEALTH', false, e.message);
  }
}

function TEST_CORE_CONFIG() {
  try {
    AP_Config_set('TESTE_CORE_CONFIG', 'valor_' + new Date().getTime());
    var v = AP_Config_get('TESTE_CORE_CONFIG');
    var ok = !!v;
    return AP_Test_result_('TEST_CORE_CONFIG', ok, ok ? 'Config lida/gravada com sucesso.' : 'Falha ao ler config gravada.', { valor: v });
  } catch (e) {
    return AP_Test_result_('TEST_CORE_CONFIG', false, e.message);
  }
}

function TEST_CORE_MODULES() {
  try {
    AP_ModuleRegistry.register({ id: 'TESTE_MODULO', nome: 'Módulo de Teste', versao: '0.0.1', funcoes: ['ping'] });
    var list = AP_ModuleRegistry.list();
    var found = list.some(function (m) { return m.id === 'TESTE_MODULO'; });
    return AP_Test_result_('TEST_CORE_MODULES', found, found ? 'Módulo registrado e listado com sucesso.' : 'Módulo de teste não encontrado.', { total: list.length });
  } catch (e) {
    return AP_Test_result_('TEST_CORE_MODULES', false, e.message);
  }
}

function TEST_CORE_EVENT() {
  try {
    var r = AP_EventBus.emit('CORE.TESTE_EVENTO', { origem: 'TEST_CORE_EVENT' });
    return AP_Test_result_('TEST_CORE_EVENT', r.ok, r.message, r.data);
  } catch (e) {
    return AP_Test_result_('TEST_CORE_EVENT', false, e.message);
  }
}

function TEST_CORE_CACHE() {
  try {
    AP_Cache_set('TESTE_CORE_CACHE', { x: 1 }, 30);
    var v = AP_Cache_get('TESTE_CORE_CACHE');
    var ok = v && v.x === 1;
    return AP_Test_result_('TEST_CORE_CACHE', ok, ok ? 'Cache funcionando.' : 'Cache não retornou o valor esperado.', { valor: v });
  } catch (e) {
    return AP_Test_result_('TEST_CORE_CACHE', false, e.message);
  }
}

function TEST_CORE_LOCK() {
  try {
    var result = AP_Core_withLock(function () { return 'executado_sob_lock'; });
    var ok = result === 'executado_sob_lock';
    return AP_Test_result_('TEST_CORE_LOCK', ok, ok ? 'Lock funcionando.' : 'Lock não executou a função corretamente.', { result: result });
  } catch (e) {
    return AP_Test_result_('TEST_CORE_LOCK', false, e.message);
  }
}

function TEST_CORE_DATA() {
  try {
    var sheetName = 'TESTE_DATA_LAYER';
    AP_Data.getSheet(sheetName, ['id', 'nome']);
    var record = { id: AP_Utils_generateId('T'), nome: 'Registro de Teste' };
    AP_Data.append(sheetName, record);
    var found = AP_Data.findBy(sheetName, { id: record.id });
    var ok = found.length === 1;
    return AP_Test_result_('TEST_CORE_DATA', ok, ok ? 'Data Layer inserindo/buscando corretamente.' : 'Registro não encontrado após inserção.', { encontrados: found.length });
  } catch (e) {
    return AP_Test_result_('TEST_CORE_DATA', false, e.message);
  }
}

function TEST_CORE_BACKUP() {
  try {
    var r = AP_Backup.snapshot('Teste automatizado TEST_CORE_BACKUP');
    return AP_Test_result_('TEST_CORE_BACKUP', r.ok, r.message, r.data || r.details);
  } catch (e) {
    return AP_Test_result_('TEST_CORE_BACKUP', false, e.message);
  }
}

/** Executa todos os testes compatíveis e gera um resumo consolidado. */
function TEST_CORE_FULL() {
  var tests = [
    TEST_CORE, TEST_CORE_HEALTH, TEST_CORE_CONFIG, TEST_CORE_MODULES,
    TEST_CORE_EVENT, TEST_CORE_CACHE, TEST_CORE_LOCK, TEST_CORE_DATA, TEST_CORE_BACKUP
  ];
  var results = tests.map(function (fn) { return fn(); });
  var passed = results.filter(function (r) { return r.ok; }).length;
  var summary = {
    total: results.length,
    aprovados: passed,
    reprovados: results.length - passed,
    status_geral: passed === results.length ? '🟢 ONLINE' : '🔴 ERROR',
    resultados: results
  };
  Logger.log(JSON.stringify(summary, null, 2));
  return summary;
}
