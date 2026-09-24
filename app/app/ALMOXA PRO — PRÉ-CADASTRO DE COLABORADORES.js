/* ============================================================
   ALMOXA PRO — PRÉ-CADASTRO DE COLABORADORES
   ------------------------------------------------------------
   Quem entra na obra não aparece no sistema sozinho. O caminho é:

     1. O técnico de segurança (ou o RH da frente de obra) faz o
        PRÉ-CADASTRO: nome, matrícula, CPF, cargo, obra, setor,
        admissão, contato. É só ficha de pessoa — nenhum acesso.

     2. Esse pré-cadastro SOBE para o administrador, que decide o
        TIPO DE ACESSO:
          PUBLICO  — a pessoa existe no sistema, recebe EPI, assina
                     ficha, mas não entra com login nenhum;
          LOGIN    — a pessoa entra no sistema, e aí o administrador
                     escolhe o perfil (colaborador, almoxarife,
                     técnico, gestor, administrador).

     3. Validado, o colaborador passa a existir de verdade — e só
        então a ficha de EPI pode ser vinculada a ele.

   Regras que o módulo não abre mão:
     · pré-cadastro NÃO cria acesso; quem cria acesso é a validação
       do administrador, e ela fica registrada com nome e data;
     · matrícula e CPF são únicos — não se cria duas fichas para a
       mesma pessoa, nem se atropela um usuário que já existe;
     · recusar exige motivo, e o registro recusado não é apagado:
       fica no histórico com quem recusou e por quê;
     · o pré-cadastro só vira usuário com login se o administrador
       disser explicitamente que é para ter login.

   Rode AP_PRECAD_testes() para conferir a lógica sem tocar em dado.
   ============================================================ */

var AP_PRECAD_CFG = {
  versao: '1.0.0',

  aba: 'ALMOXA_PRECADASTROS',

  colunas: ['id', 'data', 'nome', 'cpf', 'matricula', 'rg', 'nascimento',
    'cargo', 'funcao', 'setor', 'obra', 'empresa', 'admissao', 'telefone',
    'email', 'tamanhoCamisa', 'tamanhoCalca', 'numeroCalcado', 'observacao',
    'status', 'solicitante', 'tipoAcesso', 'perfil', 'validadoPor',
    'validadoEm', 'motivoRecusa', 'usuarioCriado', 'atualizadoEm', 'atualizadoPor'],

  status: {
    AGUARDANDO: 'AGUARDANDO_VALIDACAO',
    VALIDADO: 'VALIDADO',
    RECUSADO: 'RECUSADO'
  },

  /* o que o administrador pode decidir */
  tiposAcesso: {
    PUBLICO: 'PUBLICO',   /* existe, recebe EPI, não entra no sistema */
    LOGIN: 'LOGIN'        /* entra no sistema com um perfil */
  },

  /* campos que o técnico precisa preencher para o pré-cadastro subir */
  obrigatorios: ['nome', 'cpf', 'cargo', 'obra']
};


/* ============================================================
   ENTRADA DO MÓDULO
   ============================================================ */

function AP_Modulo_precadastro(acao, payload, sessao) {
  payload = payload || {};
  try {
    switch (acao) {
      case 'criar': return AP_PRECAD_criar_(payload, sessao);
      case 'listar': return { ok: true, dados: AP_PRECAD_listar_(payload) };
      case 'obter': return AP_PRECAD_obter_(payload);
      case 'corrigir': return AP_PRECAD_corrigir_(payload, sessao);
      case 'validar': return AP_PRECAD_validar_(payload, sessao);
      case 'recusar': return AP_PRECAD_recusar_(payload, sessao);
      case 'pendentes': return { ok: true, dados: AP_PRECAD_listar_({ status: AP_PRECAD_CFG.status.AGUARDANDO }) };
      case 'paraFicha': return AP_PRECAD_paraFicha_(payload);
    }
    return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'precadastro.' + acao + ' não existe.' };
  } catch (e) {
    try { console.error('[PRECAD] ' + acao + ': ' + e.message); } catch (x) { }
    return { ok: false, codigo: 'PRECAD_ERRO', mensagem: e.message };
  }
}


/* ============================================================
   APOIO
   ============================================================ */

function AP_PRECAD_linhas_() {
  try { return AP_Data_rows(AP_PRECAD_CFG.aba) || []; }
  catch (e) { return []; }
}

function AP_PRECAD_aba_() {
  try { AP_Data_getSheet(AP_PRECAD_CFG.aba, AP_PRECAD_CFG.colunas); } catch (e) { }
}

function AP_PRECAD_agora_() { return new Date().toISOString(); }

function AP_PRECAD_quem_(sessao) {
  return (sessao && (sessao.nome || sessao.usuario || sessao.email)) || 'sistema';
}

function AP_PRECAD_id_() {
  var n = 'PC-' + Date.now().toString(36).toUpperCase();
  try { n = 'PC-' + Utilities.getUuid().slice(0, 8).toUpperCase(); } catch (e) { }
  return n;
}

/** Só os dígitos — é assim que CPF e matrícula se comparam sem susto */
function AP_PRECAD_so_(v) { return String(v == null ? '' : v).replace(/\D+/g, ''); }

/** Confere o CPF de verdade, pelos dígitos verificadores */
function AP_PRECAD_cpfValido_(cpf) {
  var d = AP_PRECAD_so_(cpf);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;
  var soma = 0, i;
  for (i = 0; i < 9; i++) soma += Number(d.charAt(i)) * (10 - i);
  var v1 = (soma * 10) % 11; if (v1 === 10) v1 = 0;
  if (v1 !== Number(d.charAt(9))) return false;
  soma = 0;
  for (i = 0; i < 10; i++) soma += Number(d.charAt(i)) * (11 - i);
  var v2 = (soma * 10) % 11; if (v2 === 10) v2 = 0;
  return v2 === Number(d.charAt(10));
}

function AP_PRECAD_formatarCpf_(cpf) {
  var d = AP_PRECAD_so_(cpf);
  if (d.length !== 11) return String(cpf || '');
  return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
}

/** Os usuários que já existem, para não duplicar gente */
function AP_PRECAD_usuarios_() {
  try {
    var r = AP_Modulo_usuarios('listar', {}, {});
    if (r && r.ok) return r.dados || [];
  } catch (e) { }
  return [];
}

/**
 * Já existe essa pessoa? Procura por CPF e por matrícula, tanto nos
 * pré-cadastros quanto entre os usuários do sistema.
 */
function AP_PRECAD_jaExiste_(cpf, matricula, ignorarId) {
  var c = AP_PRECAD_so_(cpf), m = AP_PRECAD_so_(matricula);

  var noPre = AP_PRECAD_linhas_().filter(function (p) {
    if (ignorarId && String(p.id) === String(ignorarId)) return false;
    if (String(p.status || '').toUpperCase() === AP_PRECAD_CFG.status.RECUSADO) return false;
    if (c && AP_PRECAD_so_(p.cpf) === c) return true;
    return !!(m && AP_PRECAD_so_(p.matricula) === m);
  })[0];
  if (noPre) {
    return {
      onde: 'PRE_CADASTRO', nome: noPre.nome, id: noPre.id,
      status: noPre.status,
      por: AP_PRECAD_so_(noPre.cpf) === c ? 'CPF' : 'matrícula'
    };
  }

  var noSistema = AP_PRECAD_usuarios_().filter(function (u) {
    if (c && AP_PRECAD_so_(u.cpf) === c) return true;
    return !!(m && AP_PRECAD_so_(u.matricula) === m);
  })[0];
  if (noSistema) {
    return {
      onde: 'USUARIOS', nome: noSistema.nome, id: noSistema.id,
      status: noSistema.status,
      por: (c && AP_PRECAD_so_(noSistema.cpf) === c) ? 'CPF' : 'matrícula'
    };
  }
  return null;
}

function AP_PRECAD_auditar_(quem, acao, alvo, dados) {
  try {
    AP_Modulo_auditoria('registrar', {
      usuario: quem, acao: acao, alvo: alvo,
      detalhes: JSON.stringify(dados || {}), data: AP_PRECAD_agora_()
    }, {});
  } catch (e) { }
}

/** A ficha do jeito que a tela lê */
function AP_PRECAD_montar_(p) {
  var status = String(p.status || '').toUpperCase();
  return {
    id: p.id, data: p.data,
    nome: p.nome, cpf: AP_PRECAD_formatarCpf_(p.cpf), rg: p.rg || '',
    matricula: p.matricula || '', nascimento: p.nascimento || '',
    cargo: p.cargo, funcao: p.funcao || p.cargo, setor: p.setor || '',
    obra: p.obra, empresa: p.empresa || '', admissao: p.admissao || '',
    telefone: p.telefone || '', email: p.email || '',
    tamanhos: {
      camisa: p.tamanhoCamisa || '', calca: p.tamanhoCalca || '',
      calcado: p.numeroCalcado || ''
    },
    observacao: p.observacao || '',
    status: status,
    solicitante: p.solicitante || '',
    tipoAcesso: p.tipoAcesso || '',
    perfil: p.perfil || '',
    validadoPor: p.validadoPor || '', validadoEm: p.validadoEm || '',
    motivoRecusa: p.motivoRecusa || '',
    usuarioCriado: p.usuarioCriado || '',
    aguardando: status === AP_PRECAD_CFG.status.AGUARDANDO,
    validado: status === AP_PRECAD_CFG.status.VALIDADO,
    recusado: status === AP_PRECAD_CFG.status.RECUSADO,
    podeReceberEPI: status === AP_PRECAD_CFG.status.VALIDADO
  };
}


/* ============================================================
   1. O TÉCNICO PRÉ-CADASTRA
   ============================================================ */

function AP_PRECAD_criar_(payload, sessao) {
  var faltando = AP_PRECAD_CFG.obrigatorios.filter(function (c) {
    return !String(payload[c] || '').trim();
  });
  if (faltando.length) {
    return {
      ok: false, codigo: 'CAMPOS_OBRIGATORIOS',
      mensagem: 'Faltou preencher: ' + faltando.join(', ') + '.',
      dados: { faltando: faltando }
    };
  }

  if (!AP_PRECAD_cpfValido_(payload.cpf)) {
    return {
      ok: false, codigo: 'CPF_INVALIDO',
      mensagem: 'O CPF informado não é válido. Confira os números antes de enviar.'
    };
  }

  var repetido = AP_PRECAD_jaExiste_(payload.cpf, payload.matricula);
  if (repetido) {
    return {
      ok: false, codigo: 'JA_CADASTRADO',
      mensagem: repetido.nome + ' já está ' +
        (repetido.onde === 'USUARIOS' ? 'cadastrado no sistema' : 'em pré-cadastro') +
        ' com o mesmo ' + repetido.por + '.',
      dados: { existente: repetido }
    };
  }

  AP_PRECAD_aba_();
  var id = AP_PRECAD_id_();
  var quem = AP_PRECAD_quem_(sessao);
  var agora = AP_PRECAD_agora_();

  AP_Data_append(AP_PRECAD_CFG.aba, {
    id: id, data: agora,
    nome: String(payload.nome).trim(),
    cpf: AP_PRECAD_formatarCpf_(payload.cpf),
    matricula: payload.matricula || '',
    rg: payload.rg || '', nascimento: payload.nascimento || '',
    cargo: payload.cargo, funcao: payload.funcao || payload.cargo,
    setor: payload.setor || '', obra: payload.obra,
    empresa: payload.empresa || '', admissao: payload.admissao || '',
    telefone: payload.telefone || '', email: payload.email || '',
    tamanhoCamisa: payload.tamanhoCamisa || '',
    tamanhoCalca: payload.tamanhoCalca || '',
    numeroCalcado: payload.numeroCalcado || '',
    observacao: payload.observacao || '',
    /* o técnico NÃO decide acesso: sobe em branco, para o administrador */
    status: AP_PRECAD_CFG.status.AGUARDANDO,
    solicitante: quem,
    tipoAcesso: '', perfil: '',
    validadoPor: '', validadoEm: '', motivoRecusa: '', usuarioCriado: '',
    atualizadoEm: agora, atualizadoPor: quem
  });

  AP_PRECAD_auditar_(quem, 'PRECADASTRO_CRIADO', id, { nome: payload.nome, obra: payload.obra });

  return {
    ok: true,
    dados: {
      id: id, status: AP_PRECAD_CFG.status.AGUARDANDO,
      mensagem: 'Pré-cadastro de ' + payload.nome + ' enviado. O administrador vai definir ' +
        'o tipo de acesso — até lá, nenhum login é criado e a ficha de EPI ainda não pode ser vinculada.'
    }
  };
}

function AP_PRECAD_corrigir_(payload, sessao) {
  var p = AP_PRECAD_linhas_().filter(function (x) { return String(x.id) === String(payload.id); })[0];
  if (!p) return { ok: false, codigo: 'NAO_ENCONTRADO', mensagem: 'Pré-cadastro não localizado.' };

  var status = String(p.status || '').toUpperCase();
  if (status === AP_PRECAD_CFG.status.VALIDADO) {
    return {
      ok: false, codigo: 'JA_VALIDADO',
      mensagem: 'Este pré-cadastro já virou colaborador. Edite pelo cadastro de usuários.'
    };
  }

  if (payload.cpf && !AP_PRECAD_cpfValido_(payload.cpf)) {
    return { ok: false, codigo: 'CPF_INVALIDO', mensagem: 'O CPF informado não é válido.' };
  }
  if (payload.cpf || payload.matricula) {
    var rep = AP_PRECAD_jaExiste_(payload.cpf || p.cpf, payload.matricula || p.matricula, p.id);
    if (rep) {
      return {
        ok: false, codigo: 'JA_CADASTRADO',
        mensagem: rep.nome + ' já usa esse ' + rep.por + '.', dados: { existente: rep }
      };
    }
  }

  var quem = AP_PRECAD_quem_(sessao);
  var campos = { atualizadoEm: AP_PRECAD_agora_(), atualizadoPor: quem };
  ['nome', 'matricula', 'rg', 'nascimento', 'cargo', 'funcao', 'setor', 'obra',
    'empresa', 'admissao', 'telefone', 'email', 'tamanhoCamisa', 'tamanhoCalca',
    'numeroCalcado', 'observacao'].forEach(function (c) {
      if (payload[c] !== undefined) campos[c] = payload[c];
    });
  if (payload.cpf) campos.cpf = AP_PRECAD_formatarCpf_(payload.cpf);

  /* corrigido depois de recusado, volta para a fila do administrador */
  if (status === AP_PRECAD_CFG.status.RECUSADO) {
    campos.status = AP_PRECAD_CFG.status.AGUARDANDO;
    campos.motivoRecusa = '';
  }

  AP_Data_update(AP_PRECAD_CFG.aba, p.id, campos, 'id');
  AP_PRECAD_auditar_(quem, 'PRECADASTRO_CORRIGIDO', p.id, campos);

  return {
    ok: true,
    dados: {
      id: p.id, status: campos.status || status,
      mensagem: status === AP_PRECAD_CFG.status.RECUSADO
        ? 'Dados corrigidos — o pré-cadastro voltou para a fila do administrador.'
        : 'Dados atualizados.'
    }
  };
}


/* ============================================================
   2. O ADMINISTRADOR VALIDA O TIPO DE ACESSO
   ------------------------------------------------------------
   Aqui, e só aqui, nasce o acesso. Sem esta decisão, o
   pré-cadastro é papel: existe, mas não abre porta nenhuma.
   ============================================================ */

function AP_PRECAD_validar_(payload, sessao) {
  var p = AP_PRECAD_linhas_().filter(function (x) { return String(x.id) === String(payload.id); })[0];
  if (!p) return { ok: false, codigo: 'NAO_ENCONTRADO', mensagem: 'Pré-cadastro não localizado.' };

  var status = String(p.status || '').toUpperCase();
  if (status === AP_PRECAD_CFG.status.VALIDADO) {
    return {
      ok: false, codigo: 'JA_VALIDADO',
      mensagem: 'Já validado em ' + (p.validadoEm || '') + ' por ' + (p.validadoPor || '') + '.'
    };
  }

  var tipo = String(payload.tipoAcesso || '').toUpperCase();
  if (tipo !== AP_PRECAD_CFG.tiposAcesso.PUBLICO && tipo !== AP_PRECAD_CFG.tiposAcesso.LOGIN) {
    return {
      ok: false, codigo: 'TIPO_ACESSO_INVALIDO',
      mensagem: 'Escolha o tipo de acesso: PUBLICO (recebe EPI, não entra no sistema) ' +
        'ou LOGIN (entra no sistema com um perfil).'
    };
  }

  var perfil = String(payload.perfil || '').trim();
  if (tipo === AP_PRECAD_CFG.tiposAcesso.LOGIN && !perfil) {
    return {
      ok: false, codigo: 'SEM_PERFIL',
      mensagem: 'Para dar login é preciso dizer qual perfil essa pessoa terá.'
    };
  }
  if (tipo === AP_PRECAD_CFG.tiposAcesso.LOGIN && !String(payload.senha || '').trim() &&
    !String(p.email || payload.email || '').trim()) {
    return {
      ok: false, codigo: 'SEM_ACESSO_DEFINIDO',
      mensagem: 'Para dar login, informe uma senha inicial ou um e-mail para o primeiro acesso.'
    };
  }

  var quem = AP_PRECAD_quem_(sessao);
  var agora = AP_PRECAD_agora_();
  var matricula = payload.matricula || p.matricula || AP_PRECAD_so_(p.cpf).slice(-6);

  /* cria o colaborador no cadastro de usuários. Em PUBLICO ele
     existe e recebe EPI, mas não tem login nem perfil de acesso. */
  var novoUsuario = {
    nome: p.nome, matricula: matricula, cpf: p.cpf,
    email: payload.email || p.email || '',
    cargo: p.cargo, setor: p.setor, obra: p.obra, empresa: p.empresa,
    admissao: p.admissao, telefone: p.telefone,
    perfil: (tipo === AP_PRECAD_CFG.tiposAcesso.LOGIN) ? perfil : 'colaborador',
    acesso: tipo,
    status: 'Ativo',
    origem: 'PRE_CADASTRO', origemId: p.id
  };
  if (tipo === AP_PRECAD_CFG.tiposAcesso.LOGIN) {
    novoUsuario.login = payload.login || matricula;
    if (payload.senha) novoUsuario.senha = payload.senha;
  } else {
    /* sem login: fica explícito na ficha, para ninguém achar que
       esqueceram de dar senha */
    novoUsuario.login = '';
    novoUsuario.semAcesso = true;
  }

  var idUsuario = '';
  var avisoUsuario = '';
  try {
    var r = AP_Modulo_usuarios('salvar', novoUsuario, sessao);
    if (r && r.ok) idUsuario = (r.dados && (r.dados.id || r.dados.matricula)) || matricula;
    else avisoUsuario = (r && r.mensagem) || 'o cadastro de usuários não respondeu';
  } catch (e) { avisoUsuario = e.message; }

  if (!idUsuario && avisoUsuario) {
    /* não marca como validado o que não virou colaborador: seria
       dizer que a pessoa existe quando ela não existe */
    return {
      ok: false, codigo: 'FALHA_AO_CRIAR_USUARIO',
      mensagem: 'A validação não foi concluída porque o colaborador não pôde ser criado: ' +
        avisoUsuario + '. O pré-cadastro continua na fila, nada foi perdido.'
    };
  }

  AP_Data_update(AP_PRECAD_CFG.aba, p.id, {
    status: AP_PRECAD_CFG.status.VALIDADO,
    tipoAcesso: tipo, perfil: novoUsuario.perfil,
    matricula: matricula,
    email: novoUsuario.email,
    validadoPor: quem, validadoEm: agora,
    usuarioCriado: idUsuario,
    motivoRecusa: '',
    atualizadoEm: agora, atualizadoPor: quem
  }, 'id');

  AP_PRECAD_auditar_(quem, 'PRECADASTRO_VALIDADO', p.id, {
    nome: p.nome, tipoAcesso: tipo, perfil: novoUsuario.perfil, usuario: idUsuario
  });

  return {
    ok: true,
    dados: {
      id: p.id, usuario: idUsuario, matricula: matricula,
      tipoAcesso: tipo, perfil: novoUsuario.perfil,
      mensagem: p.nome + ' foi validado como ' +
        (tipo === AP_PRECAD_CFG.tiposAcesso.LOGIN
          ? 'usuário com login (perfil ' + novoUsuario.perfil + '), matrícula ' + matricula
          : 'usuário público — recebe e assina EPI, mas não entra no sistema') +
        '. A ficha de EPI já pode ser vinculada.'
    }
  };
}

function AP_PRECAD_recusar_(payload, sessao) {
  if (!String(payload.motivo || '').trim()) {
    return {
      ok: false, codigo: 'SEM_MOTIVO',
      mensagem: 'Diga por que está recusando — é o que o técnico vai ler para corrigir.'
    };
  }

  var p = AP_PRECAD_linhas_().filter(function (x) { return String(x.id) === String(payload.id); })[0];
  if (!p) return { ok: false, codigo: 'NAO_ENCONTRADO', mensagem: 'Pré-cadastro não localizado.' };

  var status = String(p.status || '').toUpperCase();
  if (status === AP_PRECAD_CFG.status.VALIDADO) {
    return {
      ok: false, codigo: 'JA_VALIDADO',
      mensagem: 'Já validado — para tirar o acesso, bloqueie o usuário no cadastro.'
    };
  }

  var quem = AP_PRECAD_quem_(sessao);
  AP_Data_update(AP_PRECAD_CFG.aba, p.id, {
    status: AP_PRECAD_CFG.status.RECUSADO,
    motivoRecusa: payload.motivo,
    atualizadoEm: AP_PRECAD_agora_(), atualizadoPor: quem
  }, 'id');

  AP_PRECAD_auditar_(quem, 'PRECADASTRO_RECUSADO', p.id, { motivo: payload.motivo });

  return {
    ok: true,
    dados: {
      id: p.id,
      mensagem: 'Pré-cadastro recusado. O registro fica no histórico com o motivo — ' +
        'o técnico pode corrigir e reenviar.'
    }
  };
}


/* ============================================================
   3. CONSULTAS
   ============================================================ */

function AP_PRECAD_listar_(filtro) {
  filtro = filtro || {};
  var lista = AP_PRECAD_linhas_().map(AP_PRECAD_montar_);

  if (filtro.status) {
    var alvo = String(filtro.status).toUpperCase();
    lista = lista.filter(function (p) { return p.status === alvo; });
  }
  if (filtro.obra) lista = lista.filter(function (p) { return String(p.obra) === String(filtro.obra); });
  if (filtro.busca) {
    var b = String(filtro.busca).toLowerCase();
    lista = lista.filter(function (p) {
      return (p.nome + ' ' + p.cpf + ' ' + p.matricula + ' ' + p.cargo).toLowerCase().indexOf(b) > -1;
    });
  }

  lista.sort(function (a, b) { return new Date(b.data) - new Date(a.data); });

  var conta = function (s) { return lista.filter(function (p) { return p.status === s; }).length; };
  return {
    precadastros: lista,
    totais: {
      todos: lista.length,
      aguardando: conta(AP_PRECAD_CFG.status.AGUARDANDO),
      validados: conta(AP_PRECAD_CFG.status.VALIDADO),
      recusados: conta(AP_PRECAD_CFG.status.RECUSADO),
      comLogin: lista.filter(function (p) { return p.tipoAcesso === 'LOGIN'; }).length,
      publicos: lista.filter(function (p) { return p.tipoAcesso === 'PUBLICO'; }).length
    }
  };
}

function AP_PRECAD_obter_(payload) {
  var p = AP_PRECAD_linhas_().filter(function (x) { return String(x.id) === String(payload.id); })[0];
  if (!p) return { ok: false, codigo: 'NAO_ENCONTRADO', mensagem: 'Pré-cadastro não localizado.' };
  return { ok: true, dados: AP_PRECAD_montar_(p) };
}

/**
 * Os dados prontos para abrir a ficha de EPI. Só entrega quem já
 * foi validado — é esse o portão entre "o técnico anotou" e "a
 * pessoa pode receber material".
 */
function AP_PRECAD_paraFicha_(payload) {
  var r = AP_PRECAD_obter_(payload);
  if (!r.ok) return r;
  var p = r.dados;

  if (!p.validado) {
    return {
      ok: false, codigo: 'NAO_VALIDADO',
      mensagem: p.recusado
        ? 'Este pré-cadastro foi recusado (' + p.motivoRecusa + ') — corrija e reenvie antes de abrir a ficha.'
        : 'O administrador ainda não validou o tipo de acesso. A ficha de EPI só abre depois disso.',
      dados: { status: p.status }
    };
  }

  return {
    ok: true,
    dados: {
      codigoColaborador: p.usuarioCriado, matricula: p.matricula,
      colaborador: p.nome, cpf: p.cpf, cargo: p.cargo, funcao: p.funcao,
      setor: p.setor, obra: p.obra, empresa: p.empresa, admissao: p.admissao,
      tamanhos: p.tamanhos, tipoAcesso: p.tipoAcesso, perfil: p.perfil,
      mensagem: 'Ficha liberada para ' + p.nome + '.'
    }
  };
}


/* ============================================================
   TESTES — não tocam na planilha
   ============================================================ */

function AP_PRECAD_testes() {
  var log = [], falhas = 0;
  function ok(nome, cond, detalhe) {
    log.push((cond ? 'PASSOU  ' : 'FALHOU  ') + nome + (detalhe ? '  [' + detalhe + ']' : ''));
    if (!cond) falhas++;
  }

  var tabela = [];
  var usuarios = [{ id: 'U9', nome: 'Alguém Que Já Existe', matricula: '000123', cpf: '529.982.247-25', status: 'Ativo' }];

  var orig = {
    get: (typeof AP_Data_getSheet === 'function') ? AP_Data_getSheet : null,
    rows: (typeof AP_Data_rows === 'function') ? AP_Data_rows : null,
    app: (typeof AP_Data_append === 'function') ? AP_Data_append : null,
    upd: (typeof AP_Data_update === 'function') ? AP_Data_update : null,
    usr: (typeof AP_Modulo_usuarios === 'function') ? AP_Modulo_usuarios : null
  };

  try {
    AP_Data_getSheet = function () { return {}; };
    AP_Data_rows = function () { return tabela; };
    AP_Data_append = function (aba, reg) { tabela.push(reg); };
    AP_Data_update = function (aba, id, patch, campo) {
      tabela.forEach(function (r) {
        if (String(r[campo || 'id']) === String(id)) { for (var k in patch) r[k] = patch[k]; }
      });
    };
    AP_Modulo_usuarios = function (acao, p) {
      if (acao === 'listar') return { ok: true, dados: usuarios };
      if (acao === 'salvar') {
        var novo = JSON.parse(JSON.stringify(p));
        novo.id = 'U' + (usuarios.length + 1);
        usuarios.push(novo);
        return { ok: true, dados: novo };
      }
      return { ok: false };
    };

    /* ---------- 1. O TÉCNICO PRÉ-CADASTRA ---------- */
    var criado = AP_Modulo_precadastro('criar', {
      nome: 'João Pereira da Mata', cpf: '111.444.777-35',
      cargo: 'Servente', obra: 'OB02', setor: 'Civil',
      admissao: '2026-09-23', tamanhoCamisa: 'G', numeroCalcado: '42'
    }, { nome: 'Lara (Téc. Segurança)' });
    ok('pré-cadastro criado pelo técnico', criado.ok, criado.ok ? criado.dados.id : criado.mensagem);

    var id = criado.ok ? criado.dados.id : '';
    var f = AP_Modulo_precadastro('obter', { id: id }).dados;
    ok('sobe AGUARDANDO VALIDAÇÃO', f.status === 'AGUARDANDO_VALIDACAO', f.status);
    ok('O TÉCNICO NÃO DEFINE ACESSO', !f.tipoAcesso && !f.perfil,
      'tipoAcesso "' + f.tipoAcesso + '", perfil "' + f.perfil + '"');
    ok('e nenhum usuário foi criado ainda', usuarios.length === 1,
      usuarios.length + ' usuário(s) no sistema');
    ok('quem pré-cadastrou fica registrado', f.solicitante === 'Lara (Téc. Segurança)', f.solicitante);

    /* ---------- 2. O QUE O PRÉ-CADASTRO RECUSA ---------- */
    ok('campo obrigatório em falta é recusado',
      AP_Modulo_precadastro('criar', { nome: 'X' }).codigo === 'CAMPOS_OBRIGATORIOS');
    ok('CPF inválido é recusado',
      AP_Modulo_precadastro('criar', {
        nome: 'Y', cpf: '111.111.111-11', cargo: 'Pedreiro', obra: 'OB02'
      }).codigo === 'CPF_INVALIDO');
    ok('mesma pessoa duas vezes é recusada',
      AP_Modulo_precadastro('criar', {
        nome: 'João de novo', cpf: '111.444.777-35', cargo: 'Servente', obra: 'OB02'
      }).codigo === 'JA_CADASTRADO');
    ok('quem já é usuário do sistema é recusado',
      AP_Modulo_precadastro('criar', {
        nome: 'Outro nome', cpf: '529.982.247-25', cargo: 'Pedreiro', obra: 'OB02'
      }).codigo === 'JA_CADASTRADO');
    ok('as recusas não sujaram a tabela', tabela.length === 1, tabela.length + ' registro(s)');

    /* ---------- 3. A FICHA DE EPI SÓ ABRE DEPOIS DA VALIDAÇÃO ---------- */
    var cedo = AP_Modulo_precadastro('paraFicha', { id: id });
    ok('FICHA DE EPI NÃO ABRE ANTES DE VALIDAR', cedo.codigo === 'NAO_VALIDADO', cedo.codigo);

    /* ---------- 4. O ADMINISTRADOR VALIDA ---------- */
    ok('validar sem dizer o tipo de acesso é recusado',
      AP_Modulo_precadastro('validar', { id: id }).codigo === 'TIPO_ACESSO_INVALIDO');
    ok('dar login sem perfil é recusado',
      AP_Modulo_precadastro('validar', { id: id, tipoAcesso: 'LOGIN' }).codigo === 'SEM_PERFIL');
    ok('dar login sem senha nem e-mail é recusado',
      AP_Modulo_precadastro('validar', {
        id: id, tipoAcesso: 'LOGIN', perfil: 'almoxarife'
      }).codigo === 'SEM_ACESSO_DEFINIDO');

    var val = AP_Modulo_precadastro('validar', {
      id: id, tipoAcesso: 'PUBLICO', matricula: '000891'
    }, { nome: 'Ismael (Admin)' });
    ok('validado como usuário público', val.ok, val.ok ? val.dados.mensagem : val.mensagem);
    ok('virou colaborador no cadastro', usuarios.length === 2, usuarios.length + ' usuário(s)');
    ok('USUÁRIO PÚBLICO NÃO GANHA LOGIN',
      usuarios[1].login === '' && usuarios[1].acesso === 'PUBLICO',
      'login "' + usuarios[1].login + '", acesso ' + usuarios[1].acesso);
    ok('quem validou fica registrado',
      AP_Modulo_precadastro('obter', { id: id }).dados.validadoPor === 'Ismael (Admin)');
    ok('validar duas vezes é impedido',
      AP_Modulo_precadastro('validar', { id: id, tipoAcesso: 'LOGIN', perfil: 'gestor' }).codigo === 'JA_VALIDADO');

    /* ---------- 5. AGORA A FICHA ABRE ---------- */
    var ficha = AP_Modulo_precadastro('paraFicha', { id: id });
    ok('FICHA DE EPI ABRE DEPOIS DE VALIDADO', ficha.ok, ficha.ok ? ficha.dados.mensagem : ficha.mensagem);
    ok('e traz os dados que a ficha precisa',
      ficha.ok && ficha.dados.colaborador === 'João Pereira da Mata' &&
      ficha.dados.matricula === '000891' && ficha.dados.tamanhos.calcado === '42',
      ficha.ok ? ficha.dados.colaborador + ' · mat ' + ficha.dados.matricula +
        ' · calçado ' + ficha.dados.tamanhos.calcado : '');

    /* ---------- 6. LOGIN COM PERFIL ---------- */
    var c2 = AP_Modulo_precadastro('criar', {
      nome: 'Marcos Almoxarife', cpf: '390.533.447-05', matricula: '000902',
      cargo: 'Almoxarife', obra: 'OB02', email: 'marcos@coesa.com.br'
    }, { nome: 'Lara (Téc. Segurança)' });
    var v2 = AP_Modulo_precadastro('validar', {
      id: c2.dados.id, tipoAcesso: 'LOGIN', perfil: 'almoxarife', senha: 'primeiro-acesso'
    }, { nome: 'Ismael (Admin)' });
    ok('validado com login e perfil', v2.ok && v2.dados.perfil === 'almoxarife',
      v2.ok ? v2.dados.mensagem : v2.mensagem);
    ok('o login virou a matrícula', usuarios[2].login === '000902', usuarios[2].login);

    /* ---------- 7. RECUSA E CORREÇÃO ---------- */
    var c3 = AP_Modulo_precadastro('criar', {
      nome: 'Nome Incompleto', cpf: '457.703.658-46', cargo: 'Ajudante', obra: 'OB02'
    }, { nome: 'Lara (Téc. Segurança)' });
    ok('recusar sem motivo é impedido',
      AP_Modulo_precadastro('recusar', { id: c3.dados.id }).codigo === 'SEM_MOTIVO');
    var rec = AP_Modulo_precadastro('recusar', {
      id: c3.dados.id, motivo: 'Falta o nome completo e a data de admissão'
    }, { nome: 'Ismael (Admin)' });
    ok('recusa com motivo funciona', rec.ok);

    var depois = AP_Modulo_precadastro('obter', { id: c3.dados.id }).dados;
    ok('O REGISTRO RECUSADO NÃO É APAGADO', tabela.length === 3 && depois.recusado,
      tabela.length + ' registro(s), este ' + depois.status);
    ok('o motivo fica guardado', /nome completo/.test(depois.motivoRecusa), depois.motivoRecusa);
    ok('recusado não gera usuário', usuarios.length === 3, usuarios.length + ' usuário(s)');

    var corr = AP_Modulo_precadastro('corrigir', {
      id: c3.dados.id, nome: 'Antônio Carlos Ferreira', admissao: '2026-10-01'
    }, { nome: 'Lara (Téc. Segurança)' });
    ok('corrigir devolve para a fila do administrador',
      corr.ok && AP_Modulo_precadastro('obter', { id: c3.dados.id }).dados.aguardando,
      corr.ok ? corr.dados.mensagem : corr.mensagem);
    ok('validado não se edita por aqui',
      AP_Modulo_precadastro('corrigir', { id: id, nome: 'Outro' }).codigo === 'JA_VALIDADO');

    /* ---------- 8. A FILA DO ADMINISTRADOR ---------- */
    var pend = AP_Modulo_precadastro('pendentes', {}).dados;
    ok('a fila mostra só o que espera decisão',
      pend.precadastros.length === 1 && pend.precadastros[0].nome === 'Antônio Carlos Ferreira',
      pend.precadastros.length + ' aguardando');
    var todos = AP_Modulo_precadastro('listar', {}).dados;
    ok('os totais batem',
      todos.totais.todos === 3 && todos.totais.validados === 2 && todos.totais.aguardando === 1,
      todos.totais.todos + ' total · ' + todos.totais.validados + ' validados · ' +
      todos.totais.aguardando + ' aguardando · ' + todos.totais.publicos + ' público(s) · ' +
      todos.totais.comLogin + ' com login');

  } finally {
    if (orig.get) AP_Data_getSheet = orig.get;
    if (orig.rows) AP_Data_rows = orig.rows;
    if (orig.app) AP_Data_append = orig.app;
    if (orig.upd) AP_Data_update = orig.upd;
    if (orig.usr) AP_Modulo_usuarios = orig.usr;
  }

  log.push('');
  log.push(falhas ? falhas + ' teste(s) FALHARAM' : 'todos os testes passaram');
  log.push('');
  log.push('O que foi verificado: o técnico pré-cadastra mas não define acesso,');
  log.push('o pré-cadastro não cria login sozinho, a ficha de EPI só abre depois');
  log.push('da validação do administrador, usuário público não ganha senha,');
  log.push('não se cadastra a mesma pessoa duas vezes e o registro recusado');
  log.push('nunca é apagado. Nada foi lido nem gravado na planilha.');

  try { Logger.log(log.join('\n')); } catch (e) { }
  return log;
}
