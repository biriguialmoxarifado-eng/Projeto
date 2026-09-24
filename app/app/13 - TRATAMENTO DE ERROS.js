/**
 * ============================================================
 * 13 - TRATAMENTO DE ERROS
 * ============================================================
 * Nenhum erro deve resultar em "tela branca". Toda exceção capturada
 * pelo Core passa por aqui: é logada, auditada quando fizer sentido,
 * e transformada no formato padrão { ok:false, code, message, details }.
 */

function AP_ErrorHandler_capture(origin, error, context) {
  var payload = {
    origem: origin,
    mensagem: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : '',
    contexto: context || {}
  };
  try { AP_Logger_error(origin, payload.mensagem, payload); } catch (e) {}
  try {
    AP_Data_getSheet(AP_SHEETS.DIAGNOSTICOS, ['data', 'origem', 'mensagem', 'stack', 'contexto']);
    AP_Data_append(AP_SHEETS.DIAGNOSTICOS, {
      data: AP_Utils_now(),
      origem: origin,
      mensagem: payload.mensagem,
      stack: payload.stack,
      contexto: JSON.stringify(payload.contexto)
    });
  } catch (e) {}
  return payload;
}

/** Constrói um objeto de erro padronizado (ver seção 28 do prompt). */
function AP_ErrorHandler_standardize(code, message, details) {
  return AP_Utils_fail(code, message, details);
}
