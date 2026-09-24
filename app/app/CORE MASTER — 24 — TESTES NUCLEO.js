/**
 * ============================================================
 * CORE MASTER — 24 — TESTES
 * ============================================================
 * Execute CORE_MASTER_boot() antes de rodar estes testes.
 * Cada teste retorna { ok, test, message, details }.
 */

function AP_TestMaster_result_(name, ok, message, details) {
  return { ok: ok, test: name, message: message, details: details || {} };
}

function TEST_MASTER_BOOT() {
  try {
    var r = CORE_MASTER_boot();
    return AP_TestMaster_result_('TEST_MASTER_BOOT', r.ok, r.message, r.data || r.details);
  } catch (e) { return AP_TestMaster_result_('TEST_MASTER_BOOT', false, e.message); }
}

function TEST_MASTER_HEALTH() {
  try {
    var r = CORE_MASTER.health({ appId: 'TEST', platform: 'DESKTOP', appVersion: '0.0.1' });
    return AP_TestMaster_result_('TEST_MASTER_HEALTH', r.ok, r.message, r.data);
  } catch (e) { return AP_TestMaster_result_('TEST_MASTER_HEALTH', false, e.message); }
}

function TEST_MASTER_MODULES() {
  try {
    var r = CORE_MASTER.modules({ platform: 'DESKTOP' });
    var ok = r.ok && r.data.partes_core && r.data.partes_core.length === AP_CORE_PARTS_MANIFEST.length;
    return AP_TestMaster_result_('TEST_MASTER_MODULES', ok, ok ? 'Todas as 21 partes presentes no manifesto.' : 'Divergência na contagem de partes.', { total: r.data && r.data.partes_core.length });
  } catch (e) { return AP_TestMaster_result_('TEST_MASTER_MODULES', false, e.message); }
}

function TEST_MASTER_IDENTIFY_MOBILE() {
  try {
    var r = CORE_MASTER.identify({ appId: 'MOBILE', platform: 'MOBILE', appVersion: '1.0.0' });
    var ok = r.ok && r.platform === 'MOBILE';
    return AP_TestMaster_result_('TEST_MASTER_IDENTIFY_MOBILE', ok, r.data && r.data.mensagem, r);
  } catch (e) { return AP_TestMaster_result_('TEST_MASTER_IDENTIFY_MOBILE', false, e.message); }
}

function TEST_MASTER_IDENTIFY_DESKTOP() {
  try {
    var r = CORE_MASTER.identify({ appId: 'DESKTOP', platform: 'DESKTOP', appVersion: '1.0.0' });
    var ok = r.ok && r.platform === 'DESKTOP';
    return AP_TestMaster_result_('TEST_MASTER_IDENTIFY_DESKTOP', ok, r.data && r.data.mensagem, r);
  } catch (e) { return AP_TestMaster_result_('TEST_MASTER_IDENTIFY_DESKTOP', false, e.message); }
}

/** Cria um usuário de teste (idempotente) para os testes de auth/sessão/plataforma. */
function AP_TestMaster_ensureTestUser_() {
  var email = 'teste.master@almoxapro.local';
  if (!AP_Auth_getUserByEmail_(email)) {
    AP_Auth_createUser('Usuário Teste Master', email, 'Senha@123', 'OPERADOR');
  }
  AP_CoreMaster_setPlatformAccess(email, true, false); // mobile: sim, desktop: não
  return email;
}

function TEST_MASTER_AUTH() {
  try {
    var email = AP_TestMaster_ensureTestUser_();
    var okMobile = CORE_MASTER.authenticate(email, 'Senha@123', { appId: 'MOBILE', platform: 'MOBILE', appVersion: '1.0.0' });
    var deniedDesktop = CORE_MASTER.authenticate(email, 'Senha@123', { appId: 'DESKTOP', platform: 'DESKTOP', appVersion: '1.0.0' });
    var ok = okMobile.ok === true && deniedDesktop.ok === false && deniedDesktop.code === 'PLATAFORMA_NAO_AUTORIZADA';
    return AP_TestMaster_result_('TEST_MASTER_AUTH', ok, ok ? 'Login respeitou controle de plataforma.' : 'Falha no controle de acesso por plataforma.', { okMobile: okMobile, deniedDesktop: deniedDesktop });
  } catch (e) { return AP_TestMaster_result_('TEST_MASTER_AUTH', false, e.message); }
}

function TEST_MASTER_SESSION() {
  try {
    var email = AP_TestMaster_ensureTestUser_();
    var login = CORE_MASTER.authenticate(email, 'Senha@123', { appId: 'MOBILE', platform: 'MOBILE', appVersion: '1.0.0' });
    if (!login.ok) return AP_TestMaster_result_('TEST_MASTER_SESSION', false, 'Não foi possível logar para testar sessão.', login);
    var session = CORE_MASTER.validateSession(login.data.token, { platform: 'MOBILE' });
    return AP_TestMaster_result_('TEST_MASTER_SESSION', session.ok, session.message, session.data);
  } catch (e) { return AP_TestMaster_result_('TEST_MASTER_SESSION', false, e.message); }
}

function TEST_MASTER_PLATFORM_ACCESS() {
  return TEST_PLATFORM_ACCESS();
}

function TEST_PLATFORM_ACCESS() {
  try {
    var email = AP_TestMaster_ensureTestUser_(); // mobile=true, desktop=false
    var login = CORE_MASTER.authenticate(email, 'Senha@123', { platform: 'MOBILE' });
    if (!login.ok) return AP_TestMaster_result_('TEST_PLATFORM_ACCESS', false, 'Falha ao logar para teste de plataforma.', login);

    var mobileOk = CORE_MASTER.authorizePlatform(login.data.token, { platform: 'MOBILE' });
    var desktopDenied = CORE_MASTER.authorizePlatform(login.data.token, { platform: 'DESKTOP' });

    AP_CoreMaster_setPlatformAccess(email, false, true); // inverte: agora só desktop
    var login2 = CORE_MASTER.authenticate(email, 'Senha@123', { platform: 'DESKTOP' });
    var desktopOk = login2.ok ? CORE_MASTER.authorizePlatform(login2.data.token, { platform: 'DESKTOP' }) : { ok: false };

    // Restaura estado padrão do usuário de teste
    AP_CoreMaster_setPlatformAccess(email, true, false);

    var ok = mobileOk.ok === true && desktopDenied.ok === false && desktopOk.ok === true;
    return AP_TestMaster_result_('TEST_PLATFORM_ACCESS', ok, ok ? 'Controle de acesso por plataforma validado nos dois sentidos.' : 'Falha no controle de acesso por plataforma.',
      { mobileOk: mobileOk.ok, desktopDenied: desktopDenied.ok, desktopOk: desktopOk.ok });
  } catch (e) { return AP_TestMaster_result_('TEST_PLATFORM_ACCESS', false, e.message); }
}

function TEST_MASTER_DISPATCH() {
  try {
    var r = CORE_MASTER.dispatch({ module: 'CORE', action: 'health', payload: {}, context: { platform: 'DESKTOP', appId: 'TEST' } });
    var ok = r.ok === true;
    var r2 = CORE_MASTER.dispatch({ module: 'MODULO_INEXISTENTE', action: 'x', payload: {}, context: { platform: 'DESKTOP' } });
    var ok2 = r2.ok === false && r2.code === 'MODULO_NAO_IMPLEMENTADO';
    return AP_TestMaster_result_('TEST_MASTER_DISPATCH', ok && ok2, (ok && ok2) ? 'Dispatch executou módulo existente e rejeitou módulo inexistente.' : 'Falha no dispatch.', { r: r, r2: r2 });
  } catch (e) { return AP_TestMaster_result_('TEST_MASTER_DISPATCH', false, e.message); }
}

function TEST_MASTER_EVENT() {
  try {
    var r = CORE_MASTER.emit('CORE_MASTER.TESTE_EVENTO', { x: 1 }, { appId: 'TEST', platform: 'DESKTOP' });
    return AP_TestMaster_result_('TEST_MASTER_EVENT', r.ok, r.message, r.data);
  } catch (e) { return AP_TestMaster_result_('TEST_MASTER_EVENT', false, e.message); }
}

function TEST_MASTER_ERROR() {
  try {
    // Força um erro de dispatch para validar que o Master nunca retorna "tela branca"
    var r = CORE_MASTER.dispatch({ module: 'CORE', action: 'acao_que_nao_existe', context: { platform: 'DESKTOP' } });
    var ok = r.ok === false && !!r.code && !!r.message;
    return AP_TestMaster_result_('TEST_MASTER_ERROR', ok, ok ? 'Erro tratado com resposta estruturada.' : 'Resposta de erro fora do padrão.', r);
  } catch (e) { return AP_TestMaster_result_('TEST_MASTER_ERROR', false, e.message); }
}

function TEST_MASTER_VERSION() {
  try {
    var r = CORE_MASTER.version();
    var ok = r.ok && !!r.data.coreVersion && !!r.data.masterVersion;
    return AP_TestMaster_result_('TEST_MASTER_VERSION', ok, ok ? 'Versões reportadas corretamente.' : 'Faltam informações de versão.', r.data);
  } catch (e) { return AP_TestMaster_result_('TEST_MASTER_VERSION', false, e.message); }
}

/** Executa todos os testes possíveis do Master e apresenta TOTAL/PASS/WARNING/ERROR. */
function TEST_MASTER_FULL() {
  var tests = [
    TEST_MASTER_BOOT, TEST_MASTER_HEALTH, TEST_MASTER_MODULES,
    TEST_MASTER_IDENTIFY_MOBILE, TEST_MASTER_IDENTIFY_DESKTOP,
    TEST_MASTER_AUTH, TEST_MASTER_SESSION, TEST_MASTER_PLATFORM_ACCESS,
    TEST_MASTER_DISPATCH, TEST_MASTER_EVENT, TEST_MASTER_ERROR, TEST_MASTER_VERSION
  ];
  var results = tests.map(function (fn) {
    try { return fn(); } catch (e) { return AP_TestMaster_result_(fn.name, false, e.message); }
  });
  var pass = results.filter(function (r) { return r.ok; }).length;
  var summary = {
    total: results.length,
    pass: pass,
    warning: 0,
    error: results.length - pass,
    status_geral: pass === results.length ? '🟢 ONLINE' : '🔴 ERROR',
    resultados: results
  };
  Logger.log(JSON.stringify(summary, null, 2));
  return summary;
}
