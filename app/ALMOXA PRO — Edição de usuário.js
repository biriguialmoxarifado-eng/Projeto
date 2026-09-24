/**
 * ALMOXA PRO — Edição de usuário
 *
 * O AP_Modulo_usuarios só sabia CRIAR. Ao salvar alguém que já existe,
 * ele caía na checagem de duplicidade e recusava com USUARIO_DUPLICADO.
 * Este arquivo acrescenta o caminho de EDIÇÃO, usando a mesma aba
 * USUARIOS do Core. Não cria tabela nova, não duplica cadastro.
 *
 * INSTALAÇÃO
 *  1. Crie um arquivo novo no Apps Script e cole isto.
 *  2. Salve e publique uma nova versão.
 *
 * Só isso. A tela chama AP_ADAPT_salvarUsuarioDireto por fora do
 * roteador, então nenhum arquivo existente precisa ser alterado.
 * Se o pedido não for de edição, nada muda: o cadastro de usuário
 * novo continua indo pelo caminho de sempre.
 */

function AP_ADAPT_editarUsuario_(payload, sessao) {
  payload = payload || {};

  /* só é edição quando o pedido aponta para alguém que já existe */
  var atual = AP_ADAPT_acharAlvo_(payload);
  if (!atual) return null;

  if (!sessao) {
    return { ok: false, codigo: 'SEM_SESSAO', mensagem: 'É necessário estar autenticado para editar usuários.' };
  }
  if (!payload.nome || !payload.matricula) {
    return { ok: false, codigo: 'CAMPOS_OBRIGATORIOS', mensagem: 'Nome e matrícula são obrigatórios.' };
  }

  /* a matrícula pode continuar a mesma; só não pode ser de outra pessoa */
  var porMatricula = AP_ADAPT_localizar_(payload.matricula);
  if (porMatricula && !AP_ADAPT_mesmaPessoa_(porMatricula, atual)) {
    return {
      ok: false, codigo: 'USUARIO_DUPLICADO',
      mensagem: 'A matrícula ' + payload.matricula + ' já é de ' + (porMatricula.nome || 'outro usuário') + '.'
    };
  }

  var emailNovo = String(payload.email || '').trim() || atual.email;
  if (emailNovo !== atual.email) {
    var porEmail = AP_ADAPT_localizar_(emailNovo);
    if (porEmail && !AP_ADAPT_mesmaPessoa_(porEmail, atual)) {
      return {
        ok: false, codigo: 'USUARIO_DUPLICADO',
        mensagem: 'O e-mail ' + emailNovo + ' já é de ' + (porEmail.nome || 'outro usuário') + '.'
      };
    }
  }

  if (payload.senha && String(payload.senha).length < 6) {
    return { ok: false, codigo: 'SENHA_FRACA', mensagem: 'A senha precisa ter pelo menos 6 caracteres.' };
  }

  var patch = {
    nome: String(payload.nome).trim(),
    matricula: String(payload.matricula).trim(),
    login: String(payload.login || payload.matricula).trim(),
    perfil: payload.perfil ? AP_ADAPT_perfilCore_(payload.perfil) : atual.perfil
  };
  if (emailNovo !== atual.email) patch.email = emailNovo;
  if (payload.cargo !== undefined) patch.cargo = payload.cargo || '';
  if (payload.setor !== undefined) patch.setor = payload.setor || '';
  if (payload.telefone !== undefined) patch.telefone = payload.telefone || '';
  if (payload.obra !== undefined) patch.obra = payload.obra || '';
  if (payload.foto) patch.foto = payload.foto;
  if (payload.status) patch.status = AP_ADAPT_status_(payload.status);
  if (payload.acessoDesktop !== undefined) patch.acesso_desktop = !!payload.acessoDesktop;
  if (payload.acessoMobile !== undefined) patch.acesso_mobile = !!payload.acessoMobile;
  /* crachá e biometria só mudam pelo vincularCredencial — aqui ficam intactos */

  AP_Data_update(AP_SHEETS.USUARIOS, atual.email, patch, 'email');

  if (payload.senha) {
    AP_Data_update(AP_SHEETS.USUARIOS, emailNovo, { senha_hash: AP_Auth_hash_(payload.senha) }, 'email');
  }

  var salvo = AP_ADAPT_localizar_(emailNovo);
  try {
    AP_Audit_log(AP_FLUXO_usuarioSeguro_(sessao), 'USUARIO_ATUALIZADO', 'USUARIOS', salvo ? salvo.id : '', {
      alvo: patch.matricula,
      perfil: patch.perfil,
      status: patch.status || atual.status,
      trocouSenha: !!payload.senha
    });
  } catch (e) {}

  return { ok: true, dados: AP_ADAPT_publico_(salvo), atualizado: true };
}

/**
 * Porta de entrada da tela: recebe e devolve texto JSON.
 * Exige sessão válida — quem não está logado não edita ninguém.
 */
function AP_ADAPT_salvarUsuarioDireto(json) {
  var pedido = {};
  try { pedido = JSON.parse(json || '{}'); } catch (e) { pedido = {}; }

  var sessao = null;
  var token = pedido.token || (pedido.sessao && pedido.sessao.token) || pedido.sessao;
  if (token) {
    var v = AP_Session_validate(String(token));
    if (v && v.ok) sessao = { usuario: v.data.usuario, perfil: v.data.perfil, token: token };
  }
  if (!sessao) {
    return JSON.stringify({ ok: false, codigo: 'SEM_SESSAO', mensagem: 'Faça login de novo para editar usuários.' });
  }

  var r = AP_ADAPT_editarUsuario_(pedido.payload || pedido, sessao);
  if (!r) {
    /* não é edição: manda pelo caminho normal do Core */
    r = AP_Modulo_usuarios('salvar', pedido.payload || pedido, sessao);
  }
  return JSON.stringify(r);
}

/** Acha quem o pedido quer editar. Sem id e sem alvo conhecido, é cadastro novo. */
function AP_ADAPT_acharAlvo_(payload) {
  var id = payload.id || payload.usuarioId || '';
  if (id) {
    var porId = AP_Data_rows(AP_SHEETS.USUARIOS).filter(function (u) {
      return String(u.id) === String(id);
    })[0];
    if (porId) return porId;
    /* algumas telas mandam o e-mail no lugar do id */
    var porOutro = AP_ADAPT_localizar_(id);
    if (porOutro) return porOutro;
  }
  if (payload.editando === true) {
    return AP_ADAPT_localizar_(payload.email || payload.matricula) || null;
  }
  return null;
}

function AP_ADAPT_mesmaPessoa_(a, b) {
  if (!a || !b) return false;
  if (a.id && b.id) return String(a.id) === String(b.id);
  return String(a.email || '').toLowerCase() === String(b.email || '').toLowerCase();
}

/** "Ativo" da tela vira "ATIVO" do Core; "Bloqueado" vira "BLOQUEADO". */
function AP_ADAPT_status_(v) {
  var s = String(v || '').trim().toUpperCase();
  if (s === 'ATIVO' || s === 'ACTIVE') return 'ATIVO';
  if (s === 'BLOQUEADO' || s === 'INATIVO' || s === 'BLOCKED') return 'BLOQUEADO';
  return s || 'ATIVO';
}

/** Teste pelo editor: mostra o que aconteceria ao editar alguém. */
function ALMOXA_testarEdicao() {
  var IDENTIFICADOR = '2';        // matrícula, login ou e-mail
  var u = AP_ADAPT_localizar_(IDENTIFICADOR);
  if (!u) { Logger.log('Não achei o usuário ' + IDENTIFICADOR); return; }
  Logger.log('Achei: ' + u.nome + ' · id ' + u.id + ' · perfil ' + u.perfil + ' · status ' + u.status);
  Logger.log('Para editar de verdade, use a tela do sistema.');
}
