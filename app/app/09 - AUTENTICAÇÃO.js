/**
 * ============================================================
 * 09 - AUTENTICAÇÃO
 * ============================================================
 * Apenas o cérebro funcional. Nenhuma tela de login ainda.
 * Usuários vivem na aba USUARIOS:
 * id | nome | email | senha_hash | perfil | status | criado_em
 *
 * Observação de segurança: nesta fase o hash é feito com SHA-256
 * (Utilities.computeDigest). Não é armazenada senha em texto puro.
 */

var AP_Auth = {
  login: function (email, senha) { return AP_Auth_login_(email, senha); },
  logout: function (token) { return AP_Session_destroy(token); },
  isActive: function (email) { return AP_Auth_isActive_(email); },
  getUser: function (email) { return AP_Auth_getUserByEmail_(email); }
};

function AP_Auth_ensureSheet_() {
  AP_Data_getSheet(AP_SHEETS.USUARIOS, [
    'id', 'nome', 'email', 'senha_hash', 'perfil', 'status', 'criado_em'
  ]);
}

function AP_Auth_hash_(text) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return digest.map(function (b) { return (b < 0 ? b + 256 : b).toString(16).padStart(2, '0'); }).join('');
}

function AP_Auth_getUserByEmail_(email) {
  AP_Auth_ensureSheet_();
  var rows = AP_Data_findBy(AP_SHEETS.USUARIOS, { email: email });
  return rows.length ? rows[0] : null;
}

function AP_Auth_isActive_(email) {
  var user = AP_Auth_getUserByEmail_(email);
  return !!(user && user.status === 'ATIVO');
}

function AP_Auth_login_(email, senha) {
  AP_Auth_ensureSheet_();
  if (AP_Utils_isEmpty(email) || AP_Utils_isEmpty(senha)) {
    return AP_Utils_fail('CREDENCIAIS_INVALIDAS', 'Informe e-mail e senha.');
  }
  var user = AP_Auth_getUserByEmail_(email);
  if (!user) {
    AP_Audit_log('sistema', 'LOGIN_FALHOU', 'USUARIOS', email, { motivo: 'usuario_nao_encontrado' });
    return AP_Utils_fail('USUARIO_NAO_ENCONTRADO', 'Usuário ou senha inválidos.');
  }
  if (user.status !== 'ATIVO') {
    AP_Audit_log(email, 'LOGIN_FALHOU', 'USUARIOS', email, { motivo: 'usuario_inativo' });
    return AP_Utils_fail('USUARIO_INATIVO', 'Usuário está inativo. Contate o administrador.');
  }
  var hash = AP_Auth_hash_(senha);
  if (hash !== user.senha_hash) {
    AP_Audit_log(email, 'LOGIN_FALHOU', 'USUARIOS', email, { motivo: 'senha_incorreta' });
    return AP_Utils_fail('SENHA_INCORRETA', 'Usuário ou senha inválidos.');
  }

  var session = AP_Session_create(user.email, user.perfil);
  AP_Audit_log(email, 'LOGIN', 'USUARIOS', email, {});
  AP_EventBus.emit('USUARIO.LOGIN', { email: email, perfil: user.perfil }, email);
  return AP_Utils_ok({ token: session.data.token, usuario: { email: user.email, nome: user.nome, perfil: user.perfil } }, 'Login realizado com sucesso.');
}

/** Cria um usuário. Uso administrativo (chamar via API/console autorizado). */
function AP_Auth_createUser(nome, email, senha, perfil) {
  AP_Auth_ensureSheet_();
  if (AP_Auth_getUserByEmail_(email)) {
    return AP_Utils_fail('USUARIO_EXISTENTE', 'Já existe um usuário com este e-mail.');
  }
  var record = {
    id: AP_Utils_generateId('USR'),
    nome: nome,
    email: email,
    senha_hash: AP_Auth_hash_(senha),
    perfil: perfil || 'OPERADOR',
    status: 'ATIVO',
    criado_em: AP_Utils_now()
  };
  var result = AP_Data_append(AP_SHEETS.USUARIOS, record);
  AP_Audit_log('sistema', 'CRIACAO_USUARIO', 'USUARIOS', record.id, { email: email, perfil: record.perfil });
  return result;
}
