/**
 * ALMOXA PRO — Login por crachá
 *
 * Transforma a leitura do crachá numa sessão de verdade, do mesmo jeito
 * que o login por senha faz hoje: mesmo AP_Session_create, mesma aba
 * SESSOES, mesmo usuário, mesmo perfil, mesma auditoria.
 *
 * Não cria usuário, não cria cadastro, não cria sessão paralela.
 * Quem diz se o crachá vale continua sendo o módulo do crachá.
 *
 * INSTALAÇÃO
 *  1. Crie um arquivo novo no projeto do Apps Script e cole isto.
 *  2. Implantar > Gerenciar implantações > editar > Versão: Nova versão.
 *  3. Pronto. Não precisa mexer em nenhum arquivo que já existe: a tela
 *     chama AP_CRACHA_loginDireto por fora do roteador.
 *
 *     (Se um dia quiser que a ação também exista no roteador, basta
 *      colar DENTRO do switch da AP_Modulo_auth, junto dos outros case:
 *          case 'loginCracha': return AP_CRACHA_login(payload);
 *      Fora do switch dá erro de sintaxe.)
 *
 * PARA A PESSOA ENTRAR, o crachá precisa estar ligado a um usuário:
 * na aba USUARIOS, a coluna "cracha" com o código do crachá, ou a
 * coluna "matricula" igual à matrícula do crachá. Sem isso ela continua
 * podendo solicitar e retirar, mas não abre o painel.
 */

function AP_CRACHA_login(payload) {
  payload = payload || {};
  try {
    var conteudo = String(payload.conteudo || payload.codigo || '').trim();
    if (!conteudo) {
      return { ok: false, codigo: 'SEM_CONTEUDO', mensagem: 'Leia o crachá na câmera ou passe no leitor.' };
    }

    /* 1. o módulo do crachá é quem valida: código, chave, validade, bloqueio */
    var v = AP_CRACHA_login_validar_(conteudo, payload);
    if (!v.ok) return v;
    var d = v.dados || {};

    /* 2. usuário do painel ligado a este crachá — cadastro oficial, nada novo */
    var u = AP_CRACHA_login_usuario_(d);
    if (!u) {
      return {
        ok: false, codigo: 'SEM_USUARIO',
        mensagem: (d.colaborador || 'Esta pessoa') + ' não tem usuário no painel. ' +
          'O crachá continua valendo para solicitar e retirar.'
      };
    }
    if (String(u.status).toUpperCase() !== 'ATIVO') {
      return { ok: false, codigo: 'USUARIO_BLOQUEADO', mensagem: 'Usuário inativo. Procure o administrador.' };
    }

    /* 3. sessão no mesmo formato do login por senha */
    var s = AP_Session_create(u.email, u.perfil);
    if (!s || !s.ok || !s.data || !s.data.token) {
      return { ok: false, codigo: 'SESSAO_NAO_CRIADA', mensagem: 'Não consegui abrir a sessão para este usuário.' };
    }

    try { AP_Data_update(AP_SHEETS.USUARIOS, u.email, { ultimo_acesso: AP_Utils_now() }, 'email'); } catch (e) {}
    try {
      AP_Audit_log(u.email, 'LOGIN', 'USUARIOS', u.email, {
        metodo: 'cracha', cracha: d.codigo || '', matricula: d.matricula || '',
        via: payload.via || '', dispositivo: String(payload.dispositivo || '').slice(0, 120)
      });
    } catch (e) {}
    try { AP_EventBus.emit('USUARIO.LOGIN', { email: u.email, perfil: u.perfil, metodo: 'cracha' }, u.email); } catch (e) {}

    return {
      ok: true,
      dados: {
        usuario: AP_ADAPT_publico_(u),
        obra: null,
        metodo: 'cracha',
        cracha: {
          codigo: d.codigo || '', matricula: d.matricula || '', colaborador: d.colaborador || '',
          nivel: d.nivel || '', nomeNivel: d.nomeNivel || '',
          acoesPermitidas: d.acoesPermitidas || [], foto: d.foto || ''
        },
        sessao: {
          token: s.data.token,
          metodo: 'cracha',
          inicio: new Date().getTime(),
          expira: s.data.expira_em ? new Date(s.data.expira_em).getTime() : null
        }
      }
    };
  } catch (e) {
    try { AP_ErrorHandler_capture('AP_CRACHA_login', e); } catch (x) {}
    return { ok: false, codigo: 'MODULO_ERRO', mensagem: e.message };
  }
}

/** Pergunta ao módulo do crachá se esta leitura vale. */
function AP_CRACHA_login_validar_(conteudo, payload) {
  var bruto;
  try {
    bruto = AP_CRACHA_direto(JSON.stringify({
      acao: 'validar',
      payload: {
        conteudo: conteudo,
        acao: 'identificar',
        origem: 'login',
        dispositivo: String(payload.dispositivo || payload.via || 'login').slice(0, 120)
      }
    }));
  } catch (e) {
    return { ok: false, codigo: 'CRACHA_NAO_INSTALADO', mensagem: 'O módulo do crachá não respondeu: ' + e.message };
  }
  var r = bruto;
  if (typeof bruto === 'string') {
    try { r = JSON.parse(bruto); } catch (x) { r = null; }
  }
  if (!r) return { ok: false, codigo: 'CRACHA_RESPOSTA', mensagem: 'O módulo do crachá respondeu num formato inesperado.' };
  if (!r.ok || r.liberado === false) {
    return { ok: false, codigo: r.codigo || r.erro || 'CRACHA_RECUSADO', mensagem: r.mensagem || 'Crachá recusado.' };
  }
  return { ok: true, dados: r.dados || {} };
}

/** Acha o usuário pelo código do crachá e, se não achar, pela matrícula. */
function AP_CRACHA_login_usuario_(d) {
  var codigo = String(d.codigo || '').trim().toUpperCase();
  var matricula = String(d.matricula || '').trim();
  var linhas = [];
  try { linhas = AP_Data_rows(AP_SHEETS.USUARIOS) || []; } catch (e) { linhas = []; }

  var achado = null;
  if (codigo) {
    achado = linhas.filter(function (x) {
      return String(x.cracha || '').trim().toUpperCase() === codigo;
    })[0] || null;
  }
  if (!achado && matricula) {
    achado = linhas.filter(function (x) {
      return String(x.matricula || '').trim() === matricula;
    })[0] || null;
  }
  if (!achado && matricula) {
    try { achado = AP_ADAPT_localizar_(matricula) || null; } catch (e) {}
  }
  return achado;
}

/**
 * Porta de entrada da tela: recebe e devolve texto JSON.
 * É esta função que o ALMOXA chama, sem passar pelo roteador.
 */
function AP_CRACHA_loginDireto(json) {
  var payload = {};
  try { payload = JSON.parse(json || '{}'); } catch (e) { payload = {}; }
  return JSON.stringify(AP_CRACHA_login(payload));
}

/** Teste pelo editor: cole o conteúdo de um QR de crachá e execute. */
function AP_CRACHA_login_teste() {
  var conteudo = 'COLE_AQUI_O_CONTEUDO_DO_QR';
  Logger.log(JSON.stringify(AP_CRACHA_login({ conteudo: conteudo, via: 'TESTE' }), null, 2));
}
