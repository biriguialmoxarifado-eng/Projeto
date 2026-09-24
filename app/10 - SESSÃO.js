/**
 * ============================================================
 * 10 - SESSÃO
 * ============================================================
 * Sessões vivem na aba SESSOES:
 * token | usuario | perfil | criado_em | expira_em | status
 * Preparado para ser consumido pelo futuro HTML (token enviado
 * pelo cliente em cada chamada à API).
 */

function AP_Session_ensureSheet_() {
  AP_Data_getSheet(AP_SHEETS.SESSOES, ['token', 'usuario', 'perfil', 'criado_em', 'expira_em', 'status']);
}

function AP_Session_create(userEmail, perfil) {
  AP_Session_ensureSheet_();
  var ttlMinutes = Number(AP_Config_get('SESSION_TTL_MINUTES', 480));
  var now = AP_Utils_now();
  var expira = new Date(now.getTime() + ttlMinutes * 60000);
  var token = AP_Utils_generateId('SESS');
  var record = {
    token: token,
    usuario: userEmail,
    perfil: perfil || '',
    criado_em: now,
    expira_em: expira,
    status: 'ATIVA'
  };
  AP_Data_append(AP_SHEETS.SESSOES, record);
  return AP_Utils_ok(record, 'Sessão criada.');
}

function AP_Session_validate(token) {
  AP_Session_ensureSheet_();
  if (AP_Utils_isEmpty(token)) return AP_Utils_fail('TOKEN_AUSENTE', 'Token de sessão não informado.');

  var rows = AP_Data_findBy(AP_SHEETS.SESSOES, { token: token });
  if (!rows.length) return AP_Utils_fail('SESSAO_NAO_ENCONTRADA', 'Sessão inválida.');

  var session = rows[0];
  if (session.status !== 'ATIVA') return AP_Utils_fail('SESSAO_ENCERRADA', 'Sessão encerrada.');

  var now = AP_Utils_now();
  var expira = new Date(session.expira_em);
  if (now.getTime() > expira.getTime()) {
    AP_Data_update(AP_SHEETS.SESSOES, token, { status: 'EXPIRADA' }, 'token');
    return AP_Utils_fail('SESSAO_EXPIRADA', 'Sessão expirada. Faça login novamente.');
  }

  return AP_Utils_ok({ usuario: session.usuario, perfil: session.perfil, expira_em: session.expira_em }, 'Sessão válida.');
}

function AP_Session_destroy(token) {
  AP_Session_ensureSheet_();
  var result = AP_Data_update(AP_SHEETS.SESSOES, token, { status: 'ENCERRADA' }, 'token');
  if (result.ok) AP_EventBus.emit('USUARIO.LOGOUT', { token: token });
  return result;
}

