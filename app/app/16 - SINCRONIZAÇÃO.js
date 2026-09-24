/**
 * ============================================================
 * 21 - SINCRONIZAÇÃO
 * ============================================================
 * Fila central de sincronização para integrações futuras (SAP, NF,
 * WhatsApp, etc). Aba SYNC: id | data | tipo | status | payload | erro
 * Estados: PENDING, PROCESSING, SUCCESS, ERROR
 */

var AP_SYNC_STATUS = { PENDING: 'PENDING', PROCESSING: 'PROCESSING', SUCCESS: 'SUCCESS', ERROR: 'ERROR' };

var AP_Sync = {
  enqueue: function (tipo, payload) { return AP_Sync_enqueue_(tipo, payload); },
  markProcessing: function (id) { return AP_Data_update(AP_SHEETS.SYNC, id, { status: AP_SYNC_STATUS.PROCESSING }); },
  markSuccess: function (id) { return AP_Data_update(AP_SHEETS.SYNC, id, { status: AP_SYNC_STATUS.SUCCESS, erro: '' }); },
  markError: function (id, erro) { return AP_Data_update(AP_SHEETS.SYNC, id, { status: AP_SYNC_STATUS.ERROR, erro: erro }); },
  pending: function () { return AP_Data_findBy(AP_SHEETS.SYNC, { status: AP_SYNC_STATUS.PENDING }); }
};

function AP_Sync_enqueue_(tipo, payload) {
  AP_Data_getSheet(AP_SHEETS.SYNC, ['id', 'data', 'tipo', 'status', 'payload', 'erro']);
  var record = {
    id: AP_Utils_generateId('SYNC'),
    data: AP_Utils_now(),
    tipo: tipo,
    status: AP_SYNC_STATUS.PENDING,
    payload: JSON.stringify(payload || {}),
    erro: ''
  };
  AP_Data_append(AP_SHEETS.SYNC, record);
  return AP_Utils_ok(record, 'Item adicionado à fila de sincronização.');
}

