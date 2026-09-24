/**
 * ============================================================
 * 12 - AUDITORIA
 * ============================================================
 * Registra quem fez, o que fez, quando fez, em qual registro e
 * em qual contexto. Aba AUDITORIA:
 * data | usuario | acao | entidade | id | alteracao | detalhes
 */

var AP_Audit = {
  log: function (usuario, acao, entidade, id, detalhes) {
    return AP_Audit_log(usuario, acao, entidade, id, detalhes);
  },
  history: function (entidade, id) {
    return AP_Data_findBy(AP_SHEETS.AUDITORIA, function (row) {
      return (!entidade || row.entidade === entidade) && (!id || row.id === id);
    });
  }
};

function AP_Audit_log(usuario, acao, entidade, id, detalhes) {
  try {
    AP_Data_getSheet(AP_SHEETS.AUDITORIA, ['data', 'usuario', 'acao', 'entidade', 'id', 'detalhes']);
    AP_Data_append(AP_SHEETS.AUDITORIA, {
      data: AP_Utils_now(),
      usuario: usuario || 'sistema',
      acao: acao || '',
      entidade: entidade || '',
      id: id || '',
      detalhes: detalhes ? JSON.stringify(detalhes) : ''
    });
    return AP_Utils_ok({}, 'Auditoria registrada.');
  } catch (e) {
    AP_Logger_error('AP_Audit_log', 'Falha ao registrar auditoria', { error: String(e) });
    return AP_Utils_fail('ERRO_AUDITORIA', 'Falha ao registrar auditoria: ' + e.message);
  }
}
