/**
 * ============================================================
 * 02 - UTILS / PADRÃO DE RETORNO / IDs
 * ============================================================
 * Funções puras e reutilizáveis. Sem regra de negócio.
 */

/** Padrão de retorno de SUCESSO usado por toda função pública do Core. */
function AP_Utils_ok(data, message) {
  return { ok: true, data: (data === undefined ? {} : data), message: message || '' };
}

/** Padrão de retorno de ERRO usado por toda função pública do Core. */
function AP_Utils_fail(code, message, details) {
  return { ok: false, code: code || 'ERRO_DESCONHECIDO', message: message || 'Erro não especificado.', details: details || {} };
}

/** Gera um ID único (uso geral: registros, sessões, eventos, backups...). */
function AP_Utils_generateId(prefix) {
  var rand = Utilities.getUuid().split('-')[0];
  var ts = new Date().getTime().toString(36);
  return (prefix ? prefix + '_' : '') + ts + rand;
}

/** Retorna timestamp atual no timezone configurado do sistema. */
function AP_Utils_now() {
  return new Date();
}

function AP_Utils_formatDate(date, pattern) {
  var tz = AP_Config_get('TIMEZONE', 'America/Sao_Paulo');
  return Utilities.formatDate(date || new Date(), tz, pattern || "yyyy-MM-dd'T'HH:mm:ss");
}

/**
 * Aplica o "carimbo" padrão de metadados de registro (seção 6 do prompt):
 * ID, criação, autor, alteração, autor da alteração, status.
 * @param {Object} record objeto de dados de negócio (sem regra de negócio aqui)
 * @param {string} userEmail usuário responsável pela operação
 * @param {boolean} isNew se true, define ID/criação; caso contrário, apenas atualiza
 */
function AP_Utils_stampRecord(record, userEmail, isNew) {
  var now = AP_Utils_now();
  var out = Object.assign({}, record);
  if (isNew) {
    out.id = out.id || AP_Utils_generateId('REC');
    out.criado_em = now;
    out.criado_por = userEmail || 'sistema';
    out.status = out.status || 'ATIVO';
  }
  out.alterado_em = now;
  out.alterado_por = userEmail || 'sistema';
  return out;
}

/** Verifica se uma string é vazia/nula/indefinida. */
function AP_Utils_isEmpty(v) {
  return v === null || v === undefined || v === '';
}

/** Envolve execução de função com padrão de erro seguro (usado pela API central). */
function AP_Utils_safeRun(fnName, fn) {
  try {
    return fn();
  } catch (e) {
    AP_ErrorHandler_capture(fnName, e);
    return AP_Utils_fail('ERRO_EXECUCAO', 'Erro ao executar ' + fnName + ': ' + e.message, { stack: e.stack });
  }
}
