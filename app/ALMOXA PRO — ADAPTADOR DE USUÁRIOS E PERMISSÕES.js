/**
 * ============================================================
 * ALMOXA PRO — ADAPTADOR DE USUÁRIOS E PERMISSÕES
 * Versão 1.0.0 · FONTE ÚNICA: a aba USUARIOS do Core
 * ------------------------------------------------------------
 * SUBSTITUI os arquivos:
 *   - ALMOXA_PRO_Modulo_Usuarios.gs   (REMOVER do projeto)
 *   - ALMOXA_PRO_Modulo_Permissoes.gs (REMOVER do projeto)
 *
 * POR QUÊ
 * Aqueles dois criavam abas próprias (ALMOXA_USUARIOS,
 * ALMOXA_SESSOES, ALMOXA_PERMISSOES) enquanto o Core já tem
 * USUARIOS, SESSOES e AP_PERMISSION_MATRIX. Eram dois cadastros
 * de usuário e dois RBAC no mesmo sistema — exatamente a
 * duplicidade que o projeto proíbe. Erro meu, corrigido aqui.
 *
 * COMO FUNCIONA AGORA
 * Este adaptador NÃO guarda nada por conta própria. Ele traduz:
 *
 *   frontend (matrícula, perfis minúsculos)
 *        ↕
 *   Core (AP_Auth, AP_Session, AP_Permissions, aba USUARIOS)
 *
 * Colunas extras que o ALMOXA PRO precisa (matricula, cargo,
 * setor, telefone, foto, biometria) são acrescentadas NA MESMA
 * aba USUARIOS, sem criar tabela paralela.
 * ============================================================
 */

var AP_ADAPT_CFG = {
  versao: '1.0.0',
  /* colunas do Core + as que o ALMOXA PRO acrescenta */
  colunasCore: ['id', 'nome', 'email', 'senha_hash', 'perfil', 'status', 'criado_em'],
  /* acesso_desktop / acesso_mobile são exigidos pelo Core
     (AP_CoreMaster_userCanAccessPlatform_ em 22_CoreMaster_Manifest.gs).
     Sem eles, o dispatch recusa com PLATAFORMA_NAO_AUTORIZADA. */
  colunasExtras: ['matricula', 'login', 'cargo', 'setor', 'telefone', 'obra',
    'foto', 'biometria', 'facial', 'cracha', 'ultimo_acesso',
    'acesso_desktop', 'acesso_mobile',
    /* a foto do crachá físico, guardada no Drive — o campo "cracha"
       acima é só o código; isto é a imagem do documento */
    'crachaFotoId', 'crachaFotoUrl', 'crachaFotoEm']
};

/** Garante que a aba USUARIOS do Core tenha as colunas do ALMOXA PRO */
function AP_ADAPT_garantirColunas_() {
  var sheet = AP_Data_getSheet(AP_SHEETS.USUARIOS, AP_ADAPT_CFG.colunasCore);
  var headers = AP_Data_headers(AP_SHEETS.USUARIOS);
  var faltando = AP_ADAPT_CFG.colunasExtras.filter(function (c) { return headers.indexOf(c) === -1; });
  if (faltando.length) {
    var inicio = headers.length + 1;
    sheet.getRange(1, inicio, 1, faltando.length).setValues([faltando]);
  }
  return sheet;
}

function AP_FLUXO_usuarioSeguro_(sessao) {
  return (sessao && (sessao.usuario || sessao.userId)) || 'sistema';
}

/** Perfil do Core (ADMINISTRADOR) -> perfil do frontend (admin) */
function AP_ADAPT_perfilFrontend_(perfil) {
  var mapa = { ADMINISTRADOR: 'admin', GESTOR: 'gestor', ALMOXARIFE: 'almoxarife', OPERADOR: 'colaborador' };
  return mapa[String(perfil || '').toUpperCase()] || String(perfil || '').toLowerCase();
}

/** Perfil do frontend -> perfil do Core */
function AP_ADAPT_perfilCore_(perfil) {
  var mapa = {
    admin: 'ADMINISTRADOR', ti: 'ADMINISTRADOR', gestor: 'GESTOR',
    almoxarife: 'ALMOXARIFE', mestre: 'GESTOR', seguranca: 'GESTOR',
    colaborador: 'OPERADOR', auditor: 'GESTOR', comprador: 'ALMOXARIFE'
  };
  var p = String(perfil || '').toLowerCase();
  return mapa[p] || String(perfil || 'OPERADOR').toUpperCase();
}

/** Remove campos sensíveis e traduz o perfil para o frontend */
function AP_ADAPT_publico_(u) {
  if (!u) return null;
  var out = {};
  Object.keys(u).forEach(function (k) {
    if (k === 'senha_hash' || k === '__rowIndex') return;
    out[k] = u[k];
  });
  out.perfilCore = u.perfil;
  out.perfil = AP_ADAPT_perfilFrontend_(u.perfil);
  out.biometria = !!u.biometria;
  out.facial = !!u.facial;
  return out;
}

/** Matrícula sem zeros à esquerda e sem espaços — "0001" e 1 são a mesma pessoa */
function AP_ADAPT_norm_(v) {
  var t = String(v === undefined || v === null ? '' : v).trim().toLowerCase();
  if (!t) return '';
  if (/^\d+$/.test(t)) return String(Number(t));   // 0001 -> 1
  return t;
}

/**
 * Localiza o usuário por matrícula, login, e-mail ou início do e-mail.
 *
 * POR QUE ASSIM
 * O app dizia "Usuário não localizado" para quem existia na planilha.
 * Dois motivos, os dois reais:
 *  - usuário criado direto pelo Core tem só e-mail: a coluna matricula
 *    fica vazia, e a busca por "0001" não achava nada;
 *  - a planilha guarda 0001 como número 1, e "0001" nunca batia.
 */
function AP_ADAPT_localizar_(identificador) {
  AP_ADAPT_garantirColunas_();
  var bruto = String(identificador || '').trim().toLowerCase();
  if (!bruto) return null;
  var id = AP_ADAPT_norm_(bruto);
  var todos = AP_Data_rows(AP_SHEETS.USUARIOS);

  /* 1) correspondência exata nos campos de identificação */
  var achado = todos.filter(function (u) {
    return String(u.email || '').trim().toLowerCase() === bruto ||
      AP_ADAPT_norm_(u.matricula) === id ||
      AP_ADAPT_norm_(u.login) === id;
  })[0];
  if (achado) return achado;

  /* 2) parte do e-mail antes do @ — quem entra com "ismael3666" */
  achado = todos.filter(function (u) {
    return String(u.email || '').split('@')[0].trim().toLowerCase() === bruto;
  })[0];
  if (achado) return achado;

  /* 3) e-mail interno gerado a partir da matrícula (matricula@almoxa.local) */
  achado = todos.filter(function (u) {
    var local = String(u.email || '').split('@')[0];
    return AP_ADAPT_norm_(local) === id;
  })[0];

  return achado || null;
}

/* ============================================================
   MÓDULO USUARIOS — grava na aba USUARIOS do Core
   ============================================================ */
function AP_Modulo_usuarios(acao, payload, sessao) {
  payload = payload || {};
  try {
    switch (acao) {

      case 'listar': {
        AP_ADAPT_garantirColunas_();
        return { ok: true, dados: AP_Data_rows(AP_SHEETS.USUARIOS).map(AP_ADAPT_publico_) };
      }

      case 'contar': {
        AP_ADAPT_garantirColunas_();
        return { ok: true, dados: { total: AP_Data_rows(AP_SHEETS.USUARIOS).length } };
      }

      case 'obter': {
        return { ok: true, dados: AP_ADAPT_publico_(AP_ADAPT_localizar_(payload.id || payload.matricula || payload.email)) };
      }

      case 'salvar': {
        AP_ADAPT_garantirColunas_();
        var todos = AP_Data_rows(AP_SHEETS.USUARIOS);
        var primeiro = todos.length === 0;

        if (!primeiro && !sessao) {
          return { ok: false, codigo: 'SEM_SESSAO', mensagem: 'É necessário estar autenticado para cadastrar usuários.' };
        }
        if (!payload.nome || !payload.matricula) {
          return { ok: false, codigo: 'CAMPOS_OBRIGATORIOS', mensagem: 'Nome e matrícula são obrigatórios.' };
        }
        if (primeiro && (!payload.senha || String(payload.senha).length < 6)) {
          return { ok: false, codigo: 'SENHA_FRACA', mensagem: 'A senha precisa ter pelo menos 6 caracteres.' };
        }

        /* o Core usa e-mail como chave; sem e-mail, geramos um interno estável */
        var email = String(payload.email || '').trim() ||
          (String(payload.matricula).trim() + '@almoxa.local');

        if (AP_ADAPT_localizar_(email) || AP_ADAPT_localizar_(payload.matricula)) {
          return { ok: false, codigo: 'USUARIO_DUPLICADO', mensagem: 'Já existe usuário com esta matrícula ou e-mail.' };
        }

        var perfilCore = primeiro ? 'ADMINISTRADOR' : AP_ADAPT_perfilCore_(payload.perfil);

        /* a criação passa pelo Core (hash e auditoria são dele).
           Sem senha informada, o campo fica VAZIO — e não com o hash de "".
           Era isso que impedia o login: o usuário digitava a senha e o hash
           nunca batia com o hash de string vazia. */
        var criado = AP_Auth_createUser(payload.nome, email, payload.senha || '', perfilCore);
        if (!criado.ok) return { ok: false, codigo: criado.code, mensagem: criado.message };
        if (!payload.senha) {
          AP_Data_update(AP_SHEETS.USUARIOS, email, { senha_hash: '' }, 'email');
        }

        /* complementa as colunas do ALMOXA PRO na MESMA linha */
        AP_Data_update(AP_SHEETS.USUARIOS, email, {
          matricula: String(payload.matricula),
          login: payload.login || String(payload.matricula),
          cargo: payload.cargo || '', setor: payload.setor || '',
          telefone: payload.telefone || '', obra: payload.obra || '',
          foto: payload.foto || '', biometria: false, facial: false, cracha: '',
          /* libera a plataforma, senão o Core recusa com PLATAFORMA_NAO_AUTORIZADA */
          acesso_desktop: payload.acessoDesktop === false ? false : true,
          acesso_mobile: payload.acessoMobile === false ? false : true
        }, 'email');

        var usuario = AP_ADAPT_localizar_(email);
        var resposta = { ok: true, dados: AP_ADAPT_publico_(usuario) };

        if (primeiro || payload.primeiroAcesso) {
          var s = AP_Session_create(email, perfilCore);
          if (s.ok) {
            resposta.sessao = { token: s.data.token, inicio: new Date().getTime(), expira: new Date(s.data.expira_em).getTime() };
            resposta.primeiroAcesso = true;
          }
        }
        AP_Audit_log(email, 'USUARIO_CRIADO', 'USUARIOS', usuario ? usuario.id : '', { perfil: perfilCore });
        return resposta;
      }

      /** Vincula/remove credenciais de identificação do usuário.
       *  Só o STATUS fica na planilha; nenhum dado biométrico bruto é gravado. */
      /** Diagnóstico de login — ajuda a descobrir por que alguém não entra */
      case 'diagnosticoLogin': {
        AP_ADAPT_garantirColunas_();
        var todosD = AP_Data_rows(AP_SHEETS.USUARIOS);
        return {
          ok: true,
          dados: {
            total: todosD.length,
            usuarios: todosD.map(function (u) {
              return {
                nome: u.nome || '(sem nome)',
                email: u.email || '(sem e-mail)',
                matricula: (u.matricula === '' || u.matricula === undefined) ? '(vazia)' : String(u.matricula),
                login: u.login || '(vazio)',
                status: u.status || '(sem status)',
                temSenha: !!u.senha_hash,
                acessoDesktop: u.acesso_desktop === true || u.acesso_desktop === 'TRUE',
                acessoMobile: u.acesso_mobile === true || u.acesso_mobile === 'TRUE'
              };
            }),
            comoEntrar: 'Use qualquer um destes: matrícula, login, e-mail ou a parte antes do @.'
          }
        };
      }

      /** Preenche matrícula/login de quem foi criado direto pelo Core */
      case 'corrigirCadastro': {
        AP_ADAPT_garantirColunas_();
        var corrigidos = [];
        AP_Data_rows(AP_SHEETS.USUARIOS).forEach(function (u) {
          var patch = {};
          if (!u.matricula && u.email) patch.matricula = String(u.email).split('@')[0];
          if (!u.login && u.email) patch.login = String(u.email).split('@')[0];
          if (u.acesso_desktop !== true && u.acesso_desktop !== 'TRUE') patch.acesso_desktop = true;
          if (u.acesso_mobile !== true && u.acesso_mobile !== 'TRUE') patch.acesso_mobile = true;
          if (Object.keys(patch).length) {
            AP_Data_update(AP_SHEETS.USUARIOS, u.email, patch, 'email');
            corrigidos.push({ email: u.email, ajustes: Object.keys(patch) });
          }
        });
        AP_Audit_log(AP_FLUXO_usuarioSeguro_(sessao), 'CADASTRO_CORRIGIDO', 'USUARIOS', '',
          { corrigidos: corrigidos.length });
        return { ok: true, dados: { corrigidos: corrigidos } };
      }

      case 'credenciais': {
        var u2 = AP_ADAPT_localizar_(payload.id || payload.matricula || payload.email);
        if (!u2) return { ok: false, codigo: 'NAO_ENCONTRADO', mensagem: 'Usuário não localizado.' };
        return {
          ok: true,
          dados: {
            usuario: AP_ADAPT_publico_(u2),
            metodos: [
              { tipo: 'senha', nome: 'Senha do sistema', status: u2.senha_hash ? 'ATIVO' : 'PENDENTE', sempre: true },
              { tipo: 'cracha', nome: 'Crachá / QR Code', status: u2.cracha ? 'ATIVO' : 'NAO_CADASTRADO', valor: u2.cracha || '' },
              { tipo: 'digital', nome: 'Biometria digital', status: u2.biometria ? 'ATIVO' : 'NAO_CADASTRADO' },
              { tipo: 'facial', nome: 'Reconhecimento facial', status: u2.facial ? 'ATIVO' : 'NAO_CADASTRADO' }
            ]
          }
        };
      }

      case 'vincularCredencial': {
        if (!sessao) return { ok: false, codigo: 'SEM_SESSAO', mensagem: 'Operação exige autenticação.' };
        var u3 = AP_ADAPT_localizar_(payload.id || payload.matricula || payload.email);
        if (!u3) return { ok: false, codigo: 'NAO_ENCONTRADO', mensagem: 'Usuário não localizado.' };

        var patch = {};
        if (payload.tipo === 'cracha') {
          if (!payload.valor) return { ok: false, codigo: 'CAMPO_OBRIGATORIO', mensagem: 'Informe o número do crachá.' };
          var duplicado = AP_Data_rows(AP_SHEETS.USUARIOS).filter(function (x) {
            return String(x.cracha) === String(payload.valor) && x.email !== u3.email;
          })[0];
          if (duplicado) {
            return { ok: false, codigo: 'CRACHA_DUPLICADO', mensagem: 'Este crachá já está vinculado a ' + duplicado.nome + '.' };
          }
          patch.cracha = payload.valor;

          /**
           * A FOTO DO CRACHÁ FÍSICO
           *
           * Opcional: quem vincula pode anexar uma foto do documento
           * (frente do crachá, por exemplo) além do número. Vai para
           * o Drive do usuário, numa pasta própria — não misturada
           * com fotos de patrimônio ou de equipamento.
           */
          if (payload.foto) {
            var salvouFoto = AP_ADAPT_salvarFotoCracha_(u3, payload.foto, sessao);
            if (!salvouFoto.ok) {
              return salvouFoto;   /* a foto falhou: não vincula o número sozinho
                                       sem dizer por quê — a pessoa reenvia os dois juntos */
            }
            patch.crachaFotoId = salvouFoto.dados.arquivoId;
            patch.crachaFotoUrl = salvouFoto.dados.url;
            patch.crachaFotoEm = AP_Utils_now();
          }

        } else if (payload.tipo === 'digital' || payload.tipo === 'facial') {
          /* só grava referência quando houve captura real do dispositivo */
          if (!payload.referencia) {
            return {
              ok: false, codigo: 'CAPTURA_AUSENTE',
              mensagem: 'Nenhuma captura recebida. A credencial só é vinculada com leitura real do dispositivo.'
            };
          }
          patch[payload.tipo === 'digital' ? 'biometria' : 'facial'] = true;

        } else {
          return { ok: false, codigo: 'TIPO_INVALIDO', mensagem: 'Tipo de credencial inválido.' };
        }

        AP_Data_update(AP_SHEETS.USUARIOS, u3.email, patch, 'email');
        AP_Audit_log(AP_FLUXO_usuarioSeguro_(sessao), 'CREDENCIAL_VINCULADA', 'USUARIOS', u3.id,
          { tipo: payload.tipo, alvo: u3.matricula });
        return { ok: true, dados: { tipo: payload.tipo, status: 'ATIVO' } };
      }

      case 'removerCredencial': {
        if (!sessao) return { ok: false, codigo: 'SEM_SESSAO', mensagem: 'Operação exige autenticação.' };
        var u4 = AP_ADAPT_localizar_(payload.id || payload.matricula || payload.email);
        if (!u4) return { ok: false, codigo: 'NAO_ENCONTRADO', mensagem: 'Usuário não localizado.' };
        var campo = { cracha: 'cracha', digital: 'biometria', facial: 'facial' }[payload.tipo];
        if (!campo) return { ok: false, codigo: 'TIPO_INVALIDO', mensagem: 'Tipo de credencial inválido.' };
        var limpar = {}; limpar[campo] = (campo === 'cracha') ? '' : false;
        AP_Data_update(AP_SHEETS.USUARIOS, u4.email, limpar, 'email');
        AP_Audit_log(AP_FLUXO_usuarioSeguro_(sessao), 'CREDENCIAL_REMOVIDA', 'USUARIOS', u4.id, { tipo: payload.tipo });
        return { ok: true, dados: { tipo: payload.tipo, status: 'NAO_CADASTRADO' } };
      }

      case 'acessoPlataforma': {
        if (!sessao) return { ok: false, codigo: 'SEM_SESSAO', mensagem: 'Operação exige autenticação.' };
        var alvoP = AP_ADAPT_localizar_(payload.id || payload.matricula || payload.email);
        if (!alvoP) return { ok: false, codigo: 'NAO_ENCONTRADO', mensagem: 'Usuário não localizado.' };
        AP_Data_update(AP_SHEETS.USUARIOS, alvoP.email, {
          acesso_desktop: !!payload.desktop, acesso_mobile: !!payload.mobile
        }, 'email');
        AP_Audit_log(alvoP.email, 'ACESSO_PLATAFORMA', 'USUARIOS', alvoP.id,
          { desktop: !!payload.desktop, mobile: !!payload.mobile });
        return { ok: true, dados: { id: alvoP.id, desktop: !!payload.desktop, mobile: !!payload.mobile } };
      }

      case 'alterarStatus': {
        var alvo = AP_ADAPT_localizar_(payload.id || payload.matricula || payload.email);
        if (!alvo) return { ok: false, codigo: 'NAO_ENCONTRADO', mensagem: 'Usuário não localizado.' };
        AP_Data_update(AP_SHEETS.USUARIOS, alvo.email, { status: payload.status }, 'email');
        return { ok: true, dados: { id: alvo.id, status: payload.status } };
      }

      case 'definirSenha': {
        if (!payload.senha || String(payload.senha).length < 6) {
          return { ok: false, codigo: 'SENHA_FRACA', mensagem: 'A senha precisa ter pelo menos 6 caracteres.' };
        }
        var u = AP_ADAPT_localizar_(payload.id || payload.matricula || payload.email);
        if (!u) return { ok: false, codigo: 'NAO_ENCONTRADO', mensagem: 'Usuário não localizado.' };
        AP_Data_update(AP_SHEETS.USUARIOS, u.email, { senha_hash: AP_Auth_hash_(payload.senha) }, 'email');
        AP_Audit_log(u.email, 'SENHA_DEFINIDA', 'USUARIOS', u.id, {});
        return { ok: true, dados: { id: u.id, definida: true } };
      }

      default:
        return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'usuarios.' + acao + ' não existe.' };
    }
  } catch (e) {
    AP_ErrorHandler_capture('AP_Modulo_usuarios:' + acao, e);
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'usuarios', acao: acao, mensagem: e.message };
  }
}

/* ============================================================
   MÓDULO AUTH — usa AP_Auth e AP_Session do Core
   ============================================================ */
function AP_Modulo_auth(acao, payload, sessao) {
  payload = payload || {};
  try {
    switch (acao) {

      case 'login': {
        var identificador = String(payload.usuario || payload.login || payload.matricula || payload.email || '');
        if (!identificador) {
          return { ok: false, codigo: 'CREDENCIAL_INVALIDA', mensagem: 'Informe a matrícula ou o e-mail.' };
        }

        var u = AP_ADAPT_localizar_(identificador);
        if (!u) {
          var quantos = AP_Data_rows(AP_SHEETS.USUARIOS).length;
          return {
            ok: false, codigo: 'CREDENCIAL_INVALIDA',
            mensagem: quantos
              ? 'Usuário não localizado. Tente com o e-mail cadastrado — há ' + quantos + ' usuário(s) na base.'
              : 'Nenhum usuário cadastrado nesta planilha.',
            usuariosNaBase: quantos
          };
        }
        if (String(u.status) !== 'ATIVO') {
          return { ok: false, codigo: 'USUARIO_BLOQUEADO', mensagem: 'Usuário inativo. Procure o administrador.' };
        }

        /* usuário sem senha gravada: entra e é obrigado a definir */
        if (!u.senha_hash) {
          var sNova = AP_Session_create(u.email, u.perfil);
          return {
            ok: true, exigeNovaSenha: true,
            dados: {
              usuario: AP_ADAPT_publico_(u), obra: null, exigeNovaSenha: true,
              sessao: { token: sNova.data.token, inicio: new Date().getTime(), expira: new Date(sNova.data.expira_em).getTime() }
            }
          };
        }

        /* login pelo Core, usando o e-mail que ele conhece */
        var r = AP_Auth_login_(u.email, payload.senha || '');
        if (!r.ok) {
          return { ok: false, codigo: r.code || 'CREDENCIAL_INVALIDA', mensagem: r.message };
        }

        AP_Data_update(AP_SHEETS.USUARIOS, u.email, { ultimo_acesso: AP_Utils_now() }, 'email');

        return {
          ok: true,
          dados: {
            usuario: AP_ADAPT_publico_(AP_ADAPT_localizar_(u.email)),
            obra: null,
            sessao: { token: r.data.token, inicio: new Date().getTime() }
          }
        };
      }

      case 'validarSessao': {
        var v = AP_Session_validate(payload.token || payload);
        if (!v.ok) return { ok: false, codigo: v.code, mensagem: v.message };
        var usuario = AP_ADAPT_localizar_(v.data.usuario);
        return {
          ok: true,
          dados: { usuario: AP_ADAPT_publico_(usuario), perfil: AP_ADAPT_perfilFrontend_(v.data.perfil), valida: true }
        };
      }

      case 'identificar': {
        if (payload.metodo === 'cracha') {
          var porCracha = AP_Data_rows(AP_SHEETS.USUARIOS).filter(function (x) {
            return String(x.cracha) === String(payload.cracha || payload.matricula);
          })[0];
          if (!porCracha) return { ok: false, codigo: 'CRACHA_NAO_VINCULADO', mensagem: 'Crachá não vinculado a nenhum usuário.' };
          return { ok: true, dados: { usuario: AP_ADAPT_publico_(porCracha), metodo: 'cracha' } };
        }
        var achado = AP_ADAPT_localizar_(payload.matricula || payload.usuario);
        if (!achado) return { ok: false, codigo: 'NAO_IDENTIFICADO', mensagem: 'Matrícula não localizada.' };
        if (String(achado.status) !== 'ATIVO') {
          return { ok: false, codigo: 'USUARIO_BLOQUEADO', mensagem: 'Colaborador bloqueado.' };
        }
        if ((payload.metodo === 'digital' && !achado.biometria) ||
          (payload.metodo === 'facial' && !achado.facial)) {
          return {
            ok: false, codigo: 'BIOMETRIA_NAO_CADASTRADA',
            mensagem: 'Este colaborador não tem ' + payload.metodo + ' cadastrada. Use matrícula ou senha.'
          };
        }
        return { ok: true, dados: { usuario: AP_ADAPT_publico_(achado), metodo: payload.metodo || 'matricula' } };
      }

      case 'logout': {
        var token = payload.token || (sessao && sessao.token);
        if (!token) return { ok: true, dados: { encerrada: false } };
        var d = AP_Session_destroy(token);
        return { ok: true, dados: { encerrada: d.ok } };
      }

      default:
        return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'auth.' + acao + ' não existe.' };
    }
  } catch (e) {
    AP_ErrorHandler_capture('AP_Modulo_auth:' + acao, e);
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'auth', acao: acao, mensagem: e.message };
  }
}

/* ============================================================
   MÓDULO PERMISSOES — lê o RBAC do Core, não cria outro
   ============================================================ */
function AP_Modulo_permissoes(acao, payload, sessao) {
  payload = payload || {};
  try {
    switch (acao) {
      case 'matriz':
        return { ok: true, dados: AP_Permissions.matrix(), origem: 'AP_PERMISSION_MATRIX (Core)' };

      case 'verificar': {
        var perfil = payload.perfil || (sessao && sessao.perfil) || '';
        return {
          ok: true,
          dados: { permitido: AP_Permissions_can_(AP_ADAPT_perfilCore_(perfil), payload.modulo, payload.acao) }
        };
      }

      case 'salvar': {
        if (!sessao) return { ok: false, codigo: 'SEM_SESSAO', mensagem: 'Operação exige autenticação.' };
        AP_Permissions.extend(AP_ADAPT_perfilCore_(payload.perfil), payload.modulo, payload.acoes || []);
        AP_Audit_log((sessao && sessao.usuario) || 'sistema', 'PERMISSAO_ALTERADA', 'PERMISSOES', payload.perfil, payload);
        return { ok: true, dados: { perfil: payload.perfil, modulo: payload.modulo, acoes: payload.acoes } };
      }

      default:
        return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'permissoes.' + acao + ' não existe.' };
    }
  } catch (e) {
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'permissoes', acao: acao, mensagem: e.message };
  }
}

/* ============================================================
   TESTE
   ============================================================ */
function testeAdaptadorUsuarios() {
  var log = [];
  function reg(t, ok, d) { log.push((ok ? 'OK    ' : 'ERRO  ') + t + (d ? ' — ' + d : '')); }

  try {
    var abasAntes = SpreadsheetApp.getActiveSpreadsheet().getSheets().map(function (s) { return s.getName(); });
    reg('não cria aba paralela de usuários', abasAntes.indexOf('ALMOXA_USUARIOS') === -1,
      'usa a aba ' + AP_SHEETS.USUARIOS + ' do Core');

    var lista = AP_Modulo_usuarios('listar', {});
    reg('listar usuários do Core', lista.ok, lista.dados.length + ' usuário(s)');

    var fraca = AP_Modulo_usuarios('salvar', { nome: 'Teste', matricula: '900', senha: '123' });
    reg('recusa senha curta no primeiro acesso', fraca.ok === false, fraca.codigo);

    var v = AP_Session_validate('TOKEN_FALSO');
    reg('Core recusa token falso', v.ok === false, v.code);

    reg('admin tem permissão no Core',
      AP_Permissions_can_('ADMINISTRADOR', 'estoque', 'READ') === true, '');
    reg('operador não cria no Core',
      AP_Permissions_can_('OPERADOR', 'estoque', 'CREATE') === false, '');

    var headers = AP_Data_headers(AP_SHEETS.USUARIOS);
    reg('colunas de plataforma existem na aba USUARIOS',
      headers.indexOf('acesso_desktop') > -1 && headers.indexOf('acesso_mobile') > -1,
      'exigidas por AP_CoreMaster_userCanAccessPlatform_');

  } catch (e) {
    log.push('ERRO  exceção: ' + e.message);
  }

  try { Logger.log(log.join('\n')); } catch (e) { }
  return log;
}


/* ============================================================
   FERRAMENTAS DE MANUTENÇÃO — rode direto no editor
   ------------------------------------------------------------
   Abra o editor do Apps Script, escolha a função no topo e
   clique em Executar. O resultado aparece em Ver → Registros.
   ============================================================ */

/**
 * Mostra como cada usuário está gravado e com o que dá para entrar.
 * Não expõe senha — só diz se existe.
 */
function ALMOXA_verUsuarios() {
  var r = AP_Modulo_usuarios('diagnosticoLogin', {});
  var linhas = ['===== USUÁRIOS NA PLANILHA ====='];

  (r.dados.usuarios || []).forEach(function (u) {
    var formas = [];
    if (u.matricula && u.matricula !== '(vazia)') formas.push(u.matricula);
    if (u.login && u.login !== '(vazio)') formas.push(u.login);
    if (u.email && u.email !== '(sem e-mail)') {
      formas.push(String(u.email).split('@')[0]);
      formas.push(u.email);
    }
    linhas.push('');
    linhas.push('NOME: ' + u.nome);
    linhas.push('  entrar com: ' + formas.join('  ou  '));
    linhas.push('  senha definida: ' + (u.temSenha ? 'SIM' : 'NÃO — use ALMOXA_redefinirSenha'));
    linhas.push('  status: ' + u.status);
    linhas.push('  acesso desktop: ' + (u.acessoDesktop ? 'liberado' : 'BLOQUEADO'));
    linhas.push('  acesso celular: ' + (u.acessoMobile ? 'liberado' : 'BLOQUEADO — use ALMOXA_corrigirCadastros'));
  });

  if (!(r.dados.usuarios || []).length) linhas.push('Nenhum usuário cadastrado.');

  var texto = linhas.join('\n');
  Logger.log(texto);
  return texto;
}

/**
 * Define uma nova senha para um usuário.
 *
 * COMO USAR: troque os valores abaixo e execute esta função.
 * Depois de entrar no sistema, troque a senha pelo seu perfil.
 */
function ALMOXA_redefinirSenha() {
  var IDENTIFICADOR = '1';          // matrícula, login ou e-mail
  var NOVA_SENHA = 'senha12';       // mínimo 6 caracteres

  var u = AP_ADAPT_localizar_(IDENTIFICADOR);
  if (!u) {
    var msg = 'Usuário "' + IDENTIFICADOR + '" não encontrado. Rode ALMOXA_verUsuarios para ver os cadastrados.';
    Logger.log(msg);
    return msg;
  }

  var r = AP_Modulo_usuarios('definirSenha', { matricula: u.matricula, email: u.email, senha: NOVA_SENHA });
  var texto = r.ok
    ? 'Senha redefinida para ' + u.nome + '.\n' +
      'Entre com: ' + (u.matricula || u.login || u.email) + '\n' +
      'Senha: ' + NOVA_SENHA
    : 'Não foi possível: ' + r.mensagem;

  Logger.log(texto);
  return texto;
}

/** Completa matrícula/login e libera desktop e celular de todos */
function ALMOXA_corrigirCadastros() {
  var r = AP_Modulo_usuarios('corrigirCadastro', {}, { usuario: 'manutencao' });
  var texto = r.ok
    ? r.dados.corrigidos.length + ' cadastro(s) ajustado(s).'
    : 'Falhou: ' + r.mensagem;
  Logger.log(texto);
  Logger.log(ALMOXA_verUsuarios());
  return texto;
}

/** Confere se uma senha bate, sem alterar nada */
function ALMOXA_testarSenha() {
  var IDENTIFICADOR = '1';
  var SENHA = 'senha12';

  var r = AP_Modulo_auth('login', { usuario: IDENTIFICADOR, senha: SENHA });
  var texto = r.ok
    ? 'A senha CONFERE. O login funciona com "' + IDENTIFICADOR + '".'
    : 'Não entrou: ' + (r.mensagem || r.codigo) +
      '\nSe o usuário existe, a senha gravada é outra — use ALMOXA_redefinirSenha.';
  Logger.log(texto);
  return texto;
}


/* ============================================================
   FOTO DO CRACHÁ
   ------------------------------------------------------------
   O mesmo tratamento que uma nota fiscal recebe: reduz, guarda
   no Drive numa pasta por usuário, confere que chegou inteira.
   ============================================================ */

var AP_ADAPT_PASTA_CRACHAS = 'ALMOXA PRO — Fotos de Crachá';

function AP_ADAPT_pastaCrachas_() {
  var nome = AP_Config_get('CRACHA_PASTA_FOTOS', AP_ADAPT_PASTA_CRACHAS);
  var pastas = DriveApp.getFoldersByName(nome);
  return pastas.hasNext() ? pastas.next() : DriveApp.createFolder(nome);
}

function AP_ADAPT_salvarFotoCracha_(usuario, base64, sessao) {
  var dados = String(base64);
  var tipo = 'image/jpeg';

  var virgula = dados.indexOf(',');
  if (dados.indexOf('data:') === 0 && virgula > -1) {
    var cabecalho = dados.slice(5, virgula);
    if (cabecalho.indexOf(';') > -1) tipo = cabecalho.split(';')[0];
    dados = dados.slice(virgula + 1);
  }

  if (Math.round(dados.length * 0.75) > 2 * 1024 * 1024) {
    return {
      ok: false, codigo: 'FOTO_GRANDE',
      mensagem: 'A foto está grande demais. A tela já reduz antes de enviar — ' +
        'tente selecionar de novo.'
    };
  }

  try {
    var bytes;
    try { bytes = Utilities.base64Decode(dados); }
    catch (e) {
      return { ok: false, codigo: 'FOTO_ILEGIVEL', mensagem: 'Não consegui ler a imagem enviada.' };
    }

    var pasta = AP_ADAPT_pastaCrachas_();
    var nomeArquivo = 'Crachá ' + (usuario.matricula || usuario.nome || 'usuario') +
      ' — ' + Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd HHmmss') + '.jpg';

    /* a foto anterior sai de circulação: uma pessoa tem um crachá por vez */
    if (usuario.crachaFotoId) {
      try { DriveApp.getFileById(usuario.crachaFotoId).setTrashed(true); } catch (e) { }
    }

    var arquivo = pasta.createFile(Utilities.newBlob(bytes, tipo, nomeArquivo));

    try {
      arquivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (e) { }

    var conferido;
    try { conferido = DriveApp.getFileById(arquivo.getId()).getSize(); }
    catch (e) {
      return { ok: false, codigo: 'NAO_CONFERIDO', mensagem: 'A foto não pôde ser lida de volta do Drive.' };
    }

    if (!conferido || conferido < 10) {
      return { ok: false, codigo: 'FOTO_VAZIA', mensagem: 'A foto chegou vazia ao Drive.' };
    }

    return {
      ok: true,
      dados: {
        arquivoId: arquivo.getId(),
        url: 'https://drive.google.com/file/d/' + arquivo.getId() + '/view',
        urlVisualizar: 'https://drive.google.com/file/d/' + arquivo.getId() + '/preview',
        tamanhoBytes: conferido
      }
    };
  } catch (e) {
    AP_ErrorHandler_capture('AP_ADAPT_salvarFotoCracha_', e);
    return { ok: false, codigo: 'FALHA_ENVIO', mensagem: e.message };
  }
}
