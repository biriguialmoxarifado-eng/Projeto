/**
 * ============================================================
 * 08 - REGISTRO DE MÓDULOS
 * ============================================================
 * Todo módulo de negócio (Estoque, Compras, Inventário, etc.) deverá,
 * ao carregar, chamar AP_ModuleRegistry.register() para se anunciar
 * ao Core. Isso permite ao Doutor do Sistema e ao Health Check saber
 * o que está instalado e funcionando.
 */

var AP_ModuleRegistry = {
  /**
   * @param {Object} moduleInfo { id, nome, versao, dependencias[], healthCheckFn (opcional), funcoes[] }
   */
  register: function (moduleInfo) {
    return AP_ModuleRegistry_register_(moduleInfo);
  },

  list: function () {
    return AP_Data_rows(AP_SHEETS.MODULOS);
  },

  get: function (moduleId) {
    var rows = AP_Data_findBy(AP_SHEETS.MODULOS, { id: moduleId });
    return rows.length ? rows[0] : null;
  }
};

// Guarda referências de função de health-check em memória (por execução).
var AP_ModuleRegistry_healthFns_ = {};

function AP_ModuleRegistry_register_(moduleInfo) {
  if (!moduleInfo || !moduleInfo.id) {
    return AP_Utils_fail('MODULO_INVALIDO', 'moduleInfo.id é obrigatório para registrar um módulo.');
  }

  AP_Data_getSheet(AP_SHEETS.MODULOS, [
    'id', 'nome', 'versao', 'status', 'dependencias', 'data_registro', 'funcoes'
  ]);

  var existing = AP_ModuleRegistry.get(moduleInfo.id);
  var record = {
    id: moduleInfo.id,
    nome: moduleInfo.nome || moduleInfo.id,
    versao: moduleInfo.versao || '1.0.0',
    status: 'ATIVO',
    dependencias: (moduleInfo.dependencias || []).join(','),
    data_registro: AP_Utils_now(),
    funcoes: (moduleInfo.funcoes || []).join(',')
  };

  if (moduleInfo.healthCheckFn && typeof moduleInfo.healthCheckFn === 'function') {
    AP_ModuleRegistry_healthFns_[moduleInfo.id] = moduleInfo.healthCheckFn;
  }

  var result = existing
    ? AP_Data_update(AP_SHEETS.MODULOS, moduleInfo.id, record)
    : AP_Data_append(AP_SHEETS.MODULOS, record);

  AP_EventBus.emit('CORE.MODULO_REGISTRADO', { id: moduleInfo.id, versao: record.versao });
  AP_Logger_info('AP_ModuleRegistry', 'Módulo registrado: ' + moduleInfo.id, record);
  return result;
}

/** Executa o health check de um módulo, se ele tiver fornecido um. */
function AP_ModuleRegistry_runHealthCheck(moduleId) {
  var fn = AP_ModuleRegistry_healthFns_[moduleId];
  if (!fn) return { id: moduleId, status: 'DESCONHECIDO', message: 'Sem função de health check registrada nesta execução.' };
  try {
    return { id: moduleId, status: 'ONLINE', result: fn() };
  } catch (e) {
    return { id: moduleId, status: 'ERROR', message: e.message };
  }
}
