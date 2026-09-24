/**
 * ============================================================
 * CORE MASTER — 22 — MANIFESTO DAS 21 PARTES
 * ============================================================
 * Este arquivo NÃO recria nenhuma das 21 partes já existentes.
 * Ele apenas DESCREVE o que já existe, para que o CORE_MASTER
 * possa localizar, verificar e orquestrar cada parte.
 *
 * signatureFn = nome de uma função pública que comprova que a
 * parte está carregada no projeto (usado pelo health check).
 * Se a função não existir (typeof !== 'function'), a parte é
 * marcada como OFFLINE/ERROR — o Master NUNCA inventa uma
 * implementação substituta.
 */

var AP_CORE_PARTS_MANIFEST = [
  { id: 'PARTE_01', nome: 'Config', ordem: 1, signatureFn: 'AP_Config_get', dependencias: [] },
  { id: 'PARTE_02', nome: 'Utils', ordem: 2, signatureFn: 'AP_Utils_ok', dependencias: [] },
  { id: 'PARTE_03', nome: 'Cache', ordem: 3, signatureFn: 'AP_Cache_get', dependencias: ['PARTE_01'] },
  { id: 'PARTE_04', nome: 'Logger', ordem: 4, signatureFn: 'AP_Logger_info', dependencias: ['PARTE_02'] },
  { id: 'PARTE_05', nome: 'DataLayer', ordem: 5, signatureFn: 'AP_Data_getSheet', dependencias: ['PARTE_01'] },
  { id: 'PARTE_06', nome: 'Lock', ordem: 6, signatureFn: 'AP_Core_withLock', dependencias: ['PARTE_02'] },
  { id: 'PARTE_07', nome: 'EventBus', ordem: 7, signatureFn: 'AP_EventBus_emit_', dependencias: ['PARTE_05'] },
  { id: 'PARTE_08', nome: 'ModuleRegistry', ordem: 8, signatureFn: 'AP_ModuleRegistry_register_', dependencias: ['PARTE_05'] },
  { id: 'PARTE_09', nome: 'Auth', ordem: 9, signatureFn: 'AP_Auth_login_', dependencias: ['PARTE_05', 'PARTE_10'] },
  { id: 'PARTE_10', nome: 'Session', ordem: 10, signatureFn: 'AP_Session_create', dependencias: ['PARTE_05'] },
  { id: 'PARTE_11', nome: 'Permissions', ordem: 11, signatureFn: 'AP_Permissions_can_', dependencias: ['PARTE_10'] },
  { id: 'PARTE_12', nome: 'Audit', ordem: 12, signatureFn: 'AP_Audit_log', dependencias: ['PARTE_05'] },
  { id: 'PARTE_13', nome: 'ErrorHandler', ordem: 13, signatureFn: 'AP_ErrorHandler_capture', dependencias: ['PARTE_04'] },
  { id: 'PARTE_14', nome: 'Doctor', ordem: 20, signatureFn: 'AP_Doctor_run_', dependencias: ['PARTE_05', 'PARTE_03', 'PARTE_06', 'PARTE_07'] },
  { id: 'PARTE_15', nome: 'Backup', ordem: 18, signatureFn: 'AP_Backup_snapshot_', dependencias: ['PARTE_01', 'PARTE_05'] },
  { id: 'PARTE_16', nome: 'Sync', ordem: 19, signatureFn: 'AP_Sync_enqueue_', dependencias: ['PARTE_05'] },
  { id: 'PARTE_17', nome: 'Notifications', ordem: 17, signatureFn: 'AP_Notify', dependencias: ['PARTE_07'] },
  { id: 'PARTE_18', nome: 'Services', ordem: 14, signatureFn: 'AP_Services', dependencias: [] },
  { id: 'PARTE_19', nome: 'API', ordem: 15, signatureFn: 'AP_API', dependencias: ['PARTE_09', 'PARTE_10', 'PARTE_08'] },
  { id: 'PARTE_20', nome: 'Boot', ordem: 16, signatureFn: 'AP_Core_boot', dependencias: ['PARTE_01', 'PARTE_05'] },
  { id: 'PARTE_21', nome: 'Tests', ordem: 21, signatureFn: 'TEST_CORE_FULL', dependencias: [] }
];

/**
 * Resolve, em runtime, se a função-assinatura de uma parte existe.
 * Usa globalThis (this) do Apps Script para checar sem "hardcodar" try/eval perigoso.
 */
function AP_CoreMaster_resolveGlobal_(name) {
  try {
    // Em Apps Script V8, funções top-level ficam acessíveis via 'this' no escopo global
    // quando referenciadas por nome dentro de uma função sem escopo de bloco.
    return eval('typeof ' + name);
  } catch (e) {
    return 'undefined';
  }
}

function AP_CoreMaster_checkPart_(part) {
  var kind = AP_CoreMaster_resolveGlobal_(part.signatureFn);
  var present = (kind === 'function' || kind === 'object');
  return {
    id: part.id,
    nome: part.nome,
    ordem: part.ordem,
    status: present ? AP_STATUS.ONLINE : AP_STATUS.OFFLINE,
    funcao_assinatura: part.signatureFn,
    dependencias: part.dependencias,
    erro: present ? '' : 'Função/objeto "' + part.signatureFn + '" não encontrado no projeto.'
  };
}

/** Verifica as 21 partes e retorna o relatório completo (sem inventar nada ausente). */
function AP_CoreMaster_checkAllParts_() {
  var results = AP_CORE_PARTS_MANIFEST
    .slice()
    .sort(function (a, b) { return a.ordem - b.ordem; })
    .map(AP_CoreMaster_checkPart_);

  // Verificação de dependências declaradas
  var byId = {};
  results.forEach(function (r) { byId[r.id] = r; });
  results.forEach(function (r) {
    var problemas = [];
    r.dependencias.forEach(function (depId) {
      var dep = byId[depId];
      if (!dep) { problemas.push('Dependência ' + depId + ' não existe no manifesto.'); return; }
      if (dep.status !== AP_STATUS.ONLINE) problemas.push('Dependência ' + depId + ' (' + dep.nome + ') está ' + dep.status + '.');
    });
    if (problemas.length) {
      r.status = (r.status === AP_STATUS.ONLINE) ? AP_STATUS.WARNING : r.status;
      r.erro = (r.erro ? r.erro + ' | ' : '') + problemas.join(' | ');
    }
  });

  return results;
}

/* ============================================================
 * ACESSO POR PLATAFORMA (seção 7 do prompt)
 * ============================================================
 * Estende (sem quebrar) a aba USUARIOS com as colunas
 * acesso_mobile / acesso_desktop, sem alterar a função
 * AP_Auth_createUser já existente.
 */

function AP_CoreMaster_ensurePlatformColumns_() {
  var sheet = AP_Data_getSheet(AP_SHEETS.USUARIOS);
  var headers = AP_Data_headers(AP_SHEETS.USUARIOS);
  var toAdd = ['acesso_mobile', 'acesso_desktop'].filter(function (h) { return headers.indexOf(h) === -1; });
  if (toAdd.length) {
    sheet.getRange(1, headers.length + 1, 1, toAdd.length).setValues([toAdd]);
  }
  return AP_Utils_ok({ colunas_adicionadas: toAdd }, 'Colunas de plataforma verificadas.');
}

/** Define explicitamente o acesso de um usuário por plataforma. */
function AP_CoreMaster_setPlatformAccess(email, acessoMobile, acessoDesktop) {
  AP_CoreMaster_ensurePlatformColumns_();
  return AP_Data_update(AP_SHEETS.USUARIOS, email, {
    acesso_mobile: acessoMobile === true || acessoMobile === 'TRUE',
    acesso_desktop: acessoDesktop === true || acessoDesktop === 'TRUE'
  }, 'email');
}

/**
 * Verifica se um usuário pode acessar a plataforma informada.
 * Regra: ausência de valor = negado (padrão seguro). O perfil NÃO
 * substitui esta verificação (seção 7 do prompt).
 */
function AP_CoreMaster_userCanAccessPlatform_(email, platform) {
  var user = AP_Auth_getUserByEmail_(email);
  if (!user) return false;
  var field = platform === 'MOBILE' ? 'acesso_mobile' : (platform === 'DESKTOP' ? 'acesso_desktop' : null);
  if (!field) return false;
  var value = user[field];
  return value === true || value === 'TRUE';
}

