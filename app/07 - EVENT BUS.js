/**
 * ============================================================
 * 07 - EVENT BUS
 * ============================================================
 * Mecanismo central de comunicação entre módulos. O Core apenas
 * transporta e registra o evento (aba EVENTOS) — a regra de negócio
 * de quem reage ao evento pertence sempre ao módulo assinante.
 *
 * Handlers assinados em runtime (AP_EventBus.on) só duram a execução
 * atual do script (Apps Script não mantém estado entre execuções);
 * por isso todo evento é também persistido na aba EVENTOS, permitindo
 * que módulos consultem/processem eventos de execuções anteriores
 * (ex.: fila de sincronização, processamento assíncrono via trigger).
 */

var AP_EventBus_handlers_ = {};

var AP_EventBus = {
  /**
   * Emite um evento. Persiste na aba EVENTOS e notifica assinantes
   * registrados na execução atual.
   * @param {string} eventName ex: "ESTOQUE.ITEM_MOVIMENTADO"
   * @param {Object} payload dados do evento (serializáveis)
   * @param {string} userEmail usuário que originou o evento (opcional)
   */
  emit: function (eventName, payload, userEmail) {
    return AP_EventBus_emit_(eventName, payload, userEmail);
  },

  /** Assina um evento para a execução atual (não persiste entre execuções). */
  on: function (eventName, handlerFn) {
    if (!AP_EventBus_handlers_[eventName]) AP_EventBus_handlers_[eventName] = [];
    AP_EventBus_handlers_[eventName].push(handlerFn);
  },

  /** Lista eventos recentes persistidos (uso de diagnóstico/sincronização). */
  recent: function (limit) {
    var rows = AP_Data_rows(AP_SHEETS.EVENTOS);
    return rows.slice(Math.max(0, rows.length - (limit || 50)));
  }
};

function AP_EventBus_emit_(eventName, payload, userEmail) {
  var id = AP_Utils_generateId('EVT');
  try {
    AP_Data_getSheet(AP_SHEETS.EVENTOS, ['id', 'evento', 'payload', 'usuario', 'data']);
    AP_Data_append(AP_SHEETS.EVENTOS, {
      id: id,
      evento: eventName,
      payload: JSON.stringify(payload || {}),
      usuario: userEmail || 'sistema',
      data: AP_Utils_now()
    });
  } catch (e) {
    AP_Logger_error('AP_EventBus.emit', 'Falha ao persistir evento ' + eventName, { error: String(e) });
  }

  var handlers = AP_EventBus_handlers_[eventName] || [];
  handlers.forEach(function (handler) {
    try { handler(payload, eventName); }
    catch (e) { AP_Logger_error('AP_EventBus.handler', 'Handler falhou para ' + eventName, { error: String(e) }); }
  });

  return AP_Utils_ok({ id: id, evento: eventName }, 'Evento emitido.');
}
