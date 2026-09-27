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

  /* Campos que o pré-cadastro exige para subir.
     Vazio de propósito: nada é obrigatório. Quem lança a ficha
     preenche o que tem na mão, e o que faltar entra depois — pelo
     próprio RH ou pela Segurança. Se um dia a obra quiser exigir
     alguma coisa, é só pôr o nome do campo aqui dentro. */
  obrigatorios: []
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

    /* As ações da etapa de Segurança do Trabalho moram no acréscimo
       lá embaixo. Nenhuma ação acima foi tocada: só se pergunta ao
       acréscimo depois que todas as antigas já disseram que não é
       com elas. Se o acréscimo não estiver no arquivo, a resposta
       continua sendo a de sempre. */
    if (typeof AP_PRECAD_SEG_atender_ === 'function') {
      var daSeguranca = AP_PRECAD_SEG_atender_(acao, payload, sessao);
      if (daSeguranca) return daSeguranca;
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
  /* A aba pode já existir com o cabeçalho ANTIGO — 29 colunas, de
     antes de token/etapa/identificacao existirem. Nesse caso o
     AP_Data_append grava os campos novos em colunas que não estão
     no cabeçalho e eles se perdem em silêncio: a ficha salva, a
     resposta traz o token, e ao reler a linha não há token nenhum.
     Era esse o motivo de "Ainda não tem token" e da fila vazia.
     Aqui o cabeçalho é conferido e completado NO FIM, uma vez por
     execução, antes de qualquer gravação. */
  if (typeof AP_PRECAD_SEG_garantirColunas_ === 'function') AP_PRECAD_SEG_garantirColunas_();
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
    podeReceberEPI: status === AP_PRECAD_CFG.status.VALIDADO,
    /* acrescentado na etapa de Segurança: a caminhada do processo.
       Registro antigo, sem a coluna, aparece como 'RH' — que é
       exatamente onde ele está. */
    etapa: String(p.etapa || 'RH'),
    etapaEm: p.etapaEm || '', etapaPor: p.etapaPor || '',
    temToken: !!String(p.token || ''),
    token: String(p.token || ''),
    tokenEstado: String(p.tokenEstado || ''),
    identificacao: String(p.identificacao || ''),
    validadoSegPor: String(p.validadoSegPor || ''),
    validadoSegEmail: String(p.validadoSegEmail || ''),
    validadoSegEm: String(p.validadoSegEm || ''),
    devolvidoMotivo: p.devolvidoMotivo || '',
    crachaCodigo: p.crachaCodigo || ''
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

  /* O CPF NÃO TRANCA NADA.
     Em branco passa, escrito errado passa, meio digitado passa.
     A conferência dos dígitos continua existindo, mas só para
     AVISAR — porque barrar aqui já parou a obra uma vez, e o CPF
     é dado que o RH completa depois, na entrevista ou no papel
     que o colaborador traz. */
  var cpfSuspeito = !!(AP_PRECAD_so_(payload.cpf) && !AP_PRECAD_cpfValido_(payload.cpf));

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
    atualizadoEm: agora, atualizadoPor: quem,
    /* O TOKEN NASCE AQUI, junto da ficha. Não espera o
       encaminhamento, não espera a Segurança, não depende de
       nenhum outro módulo estar de pé. É o número que o
       colaborador leva para retirar o EPI, e ele existe desde o
       momento em que a pessoa entra no sistema. */
    token: AP_PRECAD_SEG_numeroToken_(),
    tokenChave: AP_PRECAD_SEG_chave_(),
    tokenEstado: AP_PRECAD_SEG.estadosToken.GERADO,
    tokenEm: agora,
    identificacao: AP_PRECAD_SEG_identificacao_(),
    etapa: 'RH', etapaEm: agora, etapaPor: quem
  });

  AP_PRECAD_auditar_(quem, 'PRECADASTRO_CRIADO', id, { nome: payload.nome, obra: payload.obra });

  /* FINALIZAR E ENVIAR NA MESMA CHAMADA.
     Antes eram duas idas ao Core: criar e depois encaminhar. Cada
     ida pode demorar, e se a segunda falhasse a ficha ficava
     órfã, sem token e fora da fila da Segurança. Com o pedido
     junto, ou vai tudo, ou a ficha fica no RH com o token já no
     lugar — e dá para reenviar sem refazer nada. */
  if (payload.encaminharAgora && typeof AP_PRECAD_SEG_encaminhar_ === 'function') {
    var enc = AP_PRECAD_SEG_encaminhar_({
      id: id, itens: payload.itens, kit: payload.kit,
      foto: payload.foto, endereco: payload.endereco
    }, sessao);
    if (enc && enc.ok) {
      enc.dados.id = id;
      enc.dados.criado = true;
      enc.dados.cpfSuspeito = cpfSuspeito;
      if (cpfSuspeito) {
        enc.mensagem = (enc.mensagem || '') +
          ' O CPF digitado não fecha nos dígitos — confira depois com calma.';
      }
      return enc;
    }
    /* não encaminhou: a ficha existe, com token, e a resposta diz
       por que parou — em vez de sumir com o registro */
    return {
      ok: true,
      dados: {
        id: id, status: AP_PRECAD_CFG.status.AGUARDANDO,
        etapa: 'RH', criado: true,
        naoEncaminhou: (enc && enc.mensagem) || 'O encaminhamento não respondeu.',
        codigoEncaminhar: (enc && enc.codigo) || 'SEM_RESPOSTA',
        mensagem: 'Ficha de ' + AP_PRECAD_SEG_texto_(payload.nome) + ' salva com o token, ' +
          'mas não foi para a fila da Segurança: ' +
          ((enc && enc.mensagem) || 'sem resposta') + ' Use Encaminhar no cartão.'
      }
    };
  }

  return {
    ok: true,
    dados: {
      id: id, status: AP_PRECAD_CFG.status.AGUARDANDO,
      cpfSuspeito: cpfSuspeito,
      mensagem: 'Pré-cadastro de ' + AP_PRECAD_SEG_texto_(payload.nome) + ' salvo. ' +
        'O token do processo já foi gerado.' +
        (cpfSuspeito ? ' O CPF digitado não fecha nos dígitos — confira depois com calma.' : '')
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

  /* CPF escrito errado também não tranca a correção */
  var cpfSuspeitoAqui = !!(payload.cpf && !AP_PRECAD_cpfValido_(payload.cpf));
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
    /* estas quatro gravam de verdade; a tabela de mentira volta ao
       tamanho de antes para não bagunçar as contas lá embaixo */
    var antesDosOpcionais = tabela.length;
    ok('ficha com pouca coisa preenchida sobe do mesmo jeito',
      AP_Modulo_precadastro('criar', { nome: 'X' }).ok === true);
    ok('ficha sem nome nenhum também sobe — nada é obrigatório',
      AP_Modulo_precadastro('criar', {}).ok === true);
    ok('CPF em branco passa',
      AP_Modulo_precadastro('criar', { nome: 'Sem CPF' }).ok === true);
    /* estas duas também gravam; a tabela de mentira volta ao
       tamanho de antes para não bagunçar as contas lá embaixo */
    var antesDoCpf = tabela.length;
    ok('CPF escrito errado NÃO tranca — entra e avisa',
      (function () {
        var r = AP_Modulo_precadastro('criar', { nome: 'Y', cpf: '111.111.111-11' });
        return r.ok === true && r.dados.cpfSuspeito === true;
      })());
    ok('CPF com poucos dígitos também entra',
      AP_Modulo_precadastro('criar', { nome: 'Z', cpf: '0000000000' }).ok === true);
    tabela.length = antesDoCpf;
    tabela.length = antesDosOpcionais;
    /* era 'CPF inválido é recusado'. Hoje o CPF não tranca nada:
       entra e o sistema avisa. A tabela volta ao tamanho de antes. */
    var antesDoCpfRuim = tabela.length;
    ok('CPF inválido entra e só avisa',
      (function () {
        var r = AP_Modulo_precadastro('criar', {
          nome: 'Y', cpf: '111.111.111-11', cargo: 'Pedreiro', obra: 'OB02'
        });
        return r.ok === true && r.dados.cpfSuspeito === true;
      })());
    tabela.length = antesDoCpfRuim;
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


/* ############################################################
   ============================================================
   ETAPA DE SEGURANÇA DO TRABALHO  —  acréscimo, não substituição
   ------------------------------------------------------------
   Tudo o que está acima desta linha continua como estava. Nenhuma
   função antiga foi alterada, nenhuma coluna antiga mudou de nome
   ou de lugar. O que vem aqui é o caminho que faltava:

     RH pré-cadastra  →  escolhe o que a Segurança vai ver  →
     encaminha  →  nasce o TOKEN e o QR  →  a Segurança acha a
     pessoa (por nome, ID, matrícula, CPF, QR ou token)  →  os
     dados do RH já aparecem preenchidos  →  a Segurança completa
     o que é dela (riscos, EPI, NRs, treinamentos, ASO, tipo
     sanguíneo)  →  valida  →  libera  →  o crachá é emitido pelo
     módulo de crachá que já existe.

   DECISÕES QUE VALE A PENA SABEREM POR QUÊ

   · O STATUS ANTIGO NÃO FOI MEXIDO. 'status' continua querendo
     dizer o que sempre quis: se o ADMINISTRADOR já decidiu o tipo
     de acesso da pessoa. A caminhada pela Segurança é outra coisa,
     e por isso mora numa coluna própria, 'etapa'. Misturar as duas
     numa coluna só pareceria mais simples hoje e quebraria as
     telas que já leem 'status' amanhã.

   · O QR NÃO LIBERA NADA. Ele carrega ID e token, e só. Quem
     libera é a sessão de quem está lendo, conferida contra
     permissão e escopo. Um QR fotografado no vestiário não vira
     acesso na mão de ninguém.

   · O QR NÃO LEVA CPF, nome, nem nada de pessoa — mesma regra do
     crachá, e pelo mesmo motivo.

   · O GERADOR DA CHAVE É O DO CRACHÁ (AP_CR_chave_). Não inventei
     outro. Se um dia o alfabeto ou o tamanho mudar lá, muda aqui
     junto, que é como tem que ser.

   · O QUE O RH MANDA É ESCOLHA DO RH, não regra escrita no código.
     A lista fica na configuração do Core (AP_Modulo_config), e o
     que foi efetivamente autorizado é congelado no registro no
     momento do encaminhamento — assim, se alguém mudar a
     configuração depois, o que a Segurança recebeu naquele dia
     continua sendo o que ela recebeu.

   · NADA É APAGADO. Recusar, corrigir, devolver: tudo vira
     histórico com autor e data.
   ============================================================
   ############################################################ */

/* ------------------------------------------------------------
   CONFIGURAÇÃO DO ACRÉSCIMO
   Fica separada de propósito: dá para ler o que é novo sem
   procurar no meio do que já existia.
   ------------------------------------------------------------ */

var AP_PRECAD_SEG = {
  versao: '1.3.0-fluxo-plus',

  /* colunas NOVAS — entram no fim da aba, nunca no meio */
  colunas: [
    'etapa', 'etapaEm', 'etapaPor',
    'token', 'tokenEm', 'tokenUsadoEm', 'tokenUsadoPor',
    'foto', 'endereco',
    'camposEnviados',
    'riscos', 'episObrigatorios', 'treinamentos', 'aso',
    'tipoSanguineo', 'observacaoSeguranca',
    'validadoSegPor', 'validadoSegEm', 'devolvidoMotivo',
    'assinatura', 'assinaturaEm', 'assinaturaPor',
    'biometriaId',
    'tokenChave', 'tokenEstado', 'tokenConsumidoEm', 'tokenConsumidoPor',
    'validadoSegEmail', 'identificacao',
    'itensSelecionados', 'kitSelecionado',
    'reservaProtocolo', 'reservaEm', 'reservaErro',
    'crachaCodigo', 'crachaEm'
  ],

  /* a caminhada do processo. Nomes novos porque não havia nenhum
     equivalente: os três status antigos falam de ACESSO, não de
     etapa do processo. */
  etapas: {
    RH: 'RH',
    SEGURANCA: 'AGUARDANDO_SEGURANCA',
    ANALISE: 'EM_ANALISE',
    TREINAMENTO: 'AGUARDANDO_TREINAMENTO',
    ASO: 'AGUARDANDO_ASO',
    VALIDACAO: 'AGUARDANDO_VALIDACAO_SEGURANCA',
    VALIDADO: 'VALIDADO_SEGURANCA',
    LIBERADO: 'LIBERADO',
    CRACHA: 'CRACHA_EMITIDO'
  },

  /* o QR do pré-cadastro. Mesmo desenho do crachá, outra letra:
     CR é crachá de gente que já entrou; PC é processo de entrada. */
  prefixoQR: 'ALMOXA:PC',

  /* O NÚMERO DO TOKEN — TK-2026-000256.
     É o que a pessoa leva anotado e digita no balcão, então tem
     que ser legível e curto. A chave aleatória continua existindo
     por baixo, dentro do QR: o número identifica, a chave prova.
     Quem só tem o número não consegue forjar o QR. */
  prefixoToken: 'TK',
  chaveContador: 'ALMOXA_PRECAD_SEQ_TOKEN',

  /* a vida do token, do nascimento ao consumo */
  estadosToken: {
    GERADO: 'GERADO',
    AGUARDANDO: 'AGUARDANDO_VALIDACAO',
    ATIVO: 'ATIVO_PARA_ENTREGA',
    CONSUMIDO: 'CONSUMIDO'
  },

  /* a identificação provisória, até a matrícula oficial chegar */
  prefixoIdentificacao: 'COL',

  /* onde a escolha do RH fica guardada, no config que já existe */
  chaveConfig: 'precadastro.camposSeguranca',

  /* o que vai para a Segurança quando ninguém configurou nada.
     É ponto de partida, não regra: o RH muda tudo pela tela.

     Nenhum campo nasce obrigatório. Quem decide o que é obrigatório
     é o RH, campo a campo — e pode não marcar nenhum. Marcar como
     obrigatório só faz o sistema recusar o encaminhamento enquanto
     aquele campo estiver em branco. */
  camposPadrao: [
    { campo: 'foto', rotulo: 'Foto', enviar: true, obrigatorio: false },
    { campo: 'nome', rotulo: 'Nome', enviar: true, obrigatorio: false },
    { campo: 'cpf', rotulo: 'CPF', enviar: true, obrigatorio: false },
    { campo: 'matricula', rotulo: 'Matrícula', enviar: true, obrigatorio: false },
    { campo: 'rg', rotulo: 'RG', enviar: false, obrigatorio: false },
    { campo: 'nascimento', rotulo: 'Nascimento', enviar: false, obrigatorio: false },
    { campo: 'endereco', rotulo: 'Endereço', enviar: false, obrigatorio: false },
    { campo: 'telefone', rotulo: 'Telefone', enviar: true, obrigatorio: false },
    { campo: 'email', rotulo: 'E-mail', enviar: false, obrigatorio: false },
    { campo: 'empresa', rotulo: 'Empresa', enviar: true, obrigatorio: false },
    { campo: 'obra', rotulo: 'Obra', enviar: true, obrigatorio: false },
    { campo: 'setor', rotulo: 'Setor', enviar: true, obrigatorio: false },
    { campo: 'cargo', rotulo: 'Cargo', enviar: true, obrigatorio: false },
    { campo: 'funcao', rotulo: 'Função', enviar: true, obrigatorio: false },
    { campo: 'admissao', rotulo: 'Admissão', enviar: true, obrigatorio: false },
    { campo: 'tamanhoCamisa', rotulo: 'Tamanho de camisa', enviar: true, obrigatorio: false },
    { campo: 'tamanhoCalca', rotulo: 'Tamanho de calça', enviar: true, obrigatorio: false },
    { campo: 'numeroCalcado', rotulo: 'Número do calçado', enviar: true, obrigatorio: false },
    { campo: 'observacao', rotulo: 'Observação do RH', enviar: true, obrigatorio: false }
  ],

  /* o que a Segurança precisa ter preenchido para poder validar */
  exigidoParaValidar: ['treinamentos', 'aso'],

  /* status dos treinamentos — os mesmos nomes que o seu texto usa */
  statusTreinamento: ['NAO_INICIADO', 'AGENDADO', 'EM_ANDAMENTO', 'CONCLUIDO', 'REPROVADO', 'VENCIDO']
};

/* as colunas novas entram na lista oficial do módulo, no fim */
(function () {
  AP_PRECAD_SEG.colunas.forEach(function (c) {
    if (AP_PRECAD_CFG.colunas.indexOf(c) === -1) AP_PRECAD_CFG.colunas.push(c);
  });
})();


/* ------------------------------------------------------------
   APOIO
   ------------------------------------------------------------ */

function AP_PRECAD_SEG_erro_(codigo, mensagem, dados) {
  return { ok: false, codigo: codigo, mensagem: mensagem, dados: dados || null };
}

function AP_PRECAD_SEG_ok_(dados, mensagem) {
  return { ok: true, codigo: 'OK', mensagem: mensagem || '', dados: dados || {} };
}

function AP_PRECAD_SEG_texto_(v) {
  return String(v == null ? '' : v).trim();
}

/** Lê um campo que guardamos como JSON sem deixar a linha quebrar a tela. */
function AP_PRECAD_SEG_json_(v, seVazio) {
  var t = AP_PRECAD_SEG_texto_(v);
  if (!t) return seVazio;
  try {
    var d = JSON.parse(t);
    return d == null ? seVazio : d;
  } catch (e) { return seVazio; }
}

/**
 * A chave do token.
 *
 * Primeiro tenta a do crachá, que é a que este sistema já usa —
 * mesmo alfabeto, mesmo tamanho, mesma qualidade. Se ela não
 * responder, gera aqui, com o mesmo alfabeto e o mesmo tamanho.
 *
 * Antes, quando o crachá não respondia, o processo PARAVA sem
 * token. Isso estava errado: o token é o que faz o colaborador
 * conseguir retirar o EPI, e ele não pode depender de outro
 * módulo estar de pé. Reaproveitar é bom; ficar refém não é.
 */
function AP_PRECAD_SEG_chave_() {
  if (typeof AP_CR_chave_ === 'function') {
    try {
      var doCracha = String(AP_CR_chave_() || '').trim();
      if (doCracha) return doCracha;
    } catch (e) { }
  }
  /* o mesmo alfabeto do crachá: sem O, I, 0 e 1, que se confundem
     quando alguém lê de um papel e digita no balcão */
  var alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var chave = '';
  for (var i = 0; i < 8; i++) {
    chave += alfabeto.charAt(Math.floor(Math.random() * alfabeto.length));
  }
  return chave;
}

/**
 * O NÚMERO DO TOKEN, sequencial por ano: TK-2026-000256.
 *
 * O contador mora nas propriedades do script, com trava, porque
 * duas pessoas finalizando ao mesmo tempo não podem receber o
 * mesmo número. Se as propriedades não estiverem disponíveis,
 * cai para a contagem das linhas — pior, mas nunca fica sem
 * número.
 */
function AP_PRECAD_SEG_numeroToken_() {
  var ano = new Date().getFullYear();
  var seq = 0;
  var trava = null;

  try {
    trava = LockService.getScriptLock();
    trava.waitLock(8000);
  } catch (e) { trava = null; }

  try {
    var props = PropertiesService.getScriptProperties();
    var chave = AP_PRECAD_SEG.chaveContador + '_' + ano;
    seq = Number(props.getProperty(chave) || 0) + 1;
    props.setProperty(chave, String(seq));
  } catch (e) {
    /* sem propriedades: conta o que já existe neste ano */
    try {
      var marca = AP_PRECAD_SEG.prefixoToken + '-' + ano + '-';
      seq = (AP_PRECAD_linhas_() || []).filter(function (l) {
        return String(l.token || '').indexOf(marca) === 0;
      }).length + 1;
    } catch (e2) { seq = Math.floor(Math.random() * 900000) + 1; }
  } finally {
    if (trava) { try { trava.releaseLock(); } catch (e) { } }
  }

  var texto = String(seq);
  while (texto.length < 6) texto = '0' + texto;
  return AP_PRECAD_SEG.prefixoToken + '-' + ano + '-' + texto;
}

/** A identificação provisória do colaborador: COL-000123. */
function AP_PRECAD_SEG_identificacao_() {
  var quantos = 0;
  try {
    quantos = (AP_PRECAD_linhas_() || []).filter(function (l) {
      return String(l.identificacao || '').indexOf(AP_PRECAD_SEG.prefixoIdentificacao) === 0;
    }).length;
  } catch (e) { }
  var texto = String(quantos + 1);
  while (texto.length < 6) texto = '0' + texto;
  return AP_PRECAD_SEG.prefixoIdentificacao + '-' + texto;
}

/** O conteúdo do QR: prefixo, ID e a chave secreta. Nada de pessoa aqui. */
function AP_PRECAD_SEG_conteudoQR_(id, chave) {
  return AP_PRECAD_SEG.prefixoQR + ':' + id + ':' + chave;
}

/** Lê o que veio da câmera. Aceita o QR inteiro e também só o ID. */
function AP_PRECAD_SEG_lerQR_(conteudo) {
  var t = AP_PRECAD_SEG_texto_(conteudo);
  if (!t) return { id: '', token: '', completo: false };
  var partes = t.split(':');
  if (partes.length >= 4 && (partes[0] + ':' + partes[1]) === AP_PRECAD_SEG.prefixoQR) {
    return { id: partes[2], token: partes[3], completo: true };
  }
  if (/^PC-[\w-]+$/i.test(t)) return { id: t.toUpperCase(), token: '', completo: false };
  return { id: '', token: '', completo: false };
}

/** A linha crua, pelo ID. */
function AP_PRECAD_SEG_linha_(id) {
  var alvo = AP_PRECAD_SEG_texto_(id);
  if (!alvo) return null;
  return AP_PRECAD_linhas_().filter(function (x) {
    return AP_PRECAD_SEG_texto_(x.id) === alvo;
  })[0] || null;
}

/** Em que etapa o processo está — registro velho, sem coluna, é RH. */
function AP_PRECAD_SEG_etapaDe_(p) {
  return AP_PRECAD_SEG_texto_(p && p.etapa) || AP_PRECAD_SEG.etapas.RH;
}

/**
 * PERMISSÃO — não é lógica nova. Pergunta ao módulo de permissões
 * que já manda no sistema e, quando o organograma estiver
 * instalado, confere também o escopo da obra.
 *
 * Se o módulo de permissões não estiver no projeto, a operação
 * passa e fica registrada na auditoria como não verificada. Travar
 * tudo por falta de um arquivo pararia a obra; passar calado
 * esconderia o problema. O meio do caminho é passar e deixar
 * rastro.
 */
function AP_PRECAD_SEG_pode_(sessao, acao, alvo) {
  var perfil = AP_PRECAD_SEG_texto_(sessao && (sessao.perfil || sessao.tipo)) || '';
  var resposta = { permitido: true, verificado: false, motivo: '' };

  if (typeof AP_PERMISSOES_verificar === 'function') {
    try {
      var r = AP_PERMISSOES_verificar(perfil, 'precadastro', acao, {
        obra: alvo && alvo.obra, empresa: alvo && alvo.empresa, setor: alvo && alvo.setor
      });
      resposta.verificado = true;
      if (r && r.permitido === false) {
        resposta.permitido = false;
        resposta.motivo = 'O perfil ' + (perfil || '—') + ' não tem permissão para ' + acao +
          ' no pré-cadastro.';
        return resposta;
      }
    } catch (e) { resposta.motivo = 'permissões não responderam: ' + e.message; }
  }

  /* escopo: só quando o organograma existir. Sem ele, não há o que
     conferir — e inventar um escopo aqui seria criar uma segunda
     regra de alcance, que é justamente o que não se quer. */
  if (typeof AP_ORG_validarOperacao === 'function' && alvo && alvo.obra) {
    try {
      var e2 = AP_ORG_validarOperacao({
        usuario: AP_PRECAD_SEG_texto_(sessao && (sessao.matricula || sessao.usuario || sessao.nome)),
        perfil: perfil, modulo: 'precadastro', acao: acao,
        alvo: { obra: alvo.obra, empresa: alvo.empresa, setor: alvo.setor }
      });
      if (e2 && e2.ok === false) {
        resposta.permitido = false;
        resposta.motivo = e2.mensagem || 'Este pré-cadastro é de outra obra.';
        return resposta;
      }
    } catch (e) { }
  }

  return resposta;
}

/**
 * AVISO PARA A EQUIPE — usa o módulo de notificações que já existe.
 * Como o nome da ação pode variar, tenta as convenções conhecidas e
 * devolve qual funcionou. Nunca derruba a operação principal: um
 * aviso que não saiu não pode impedir um colaborador de entrar.
 */
function AP_PRECAD_SEG_avisar_(assunto, texto, destino, referencia) {
  if (typeof AP_Modulo_notificacoes !== 'function') return { enviado: false, por: '' };
  var tentativas = ['criar', 'registrar', 'nova', 'enviar', 'notificar'];
  for (var i = 0; i < tentativas.length; i++) {
    try {
      var r = AP_Modulo_notificacoes(tentativas[i], {
        titulo: assunto, texto: texto, mensagem: texto,
        perfil: destino, destino: destino, para: destino,
        referencia: referencia, rota: '#/precadastros/' + referencia,
        data: AP_PRECAD_agora_()
      }, {});
      if (r && r.ok) return { enviado: true, por: tentativas[i] };
    } catch (e) { }
  }
  return { enviado: false, por: '' };
}

/** A configuração do RH — do Core quando ele responde, padrão quando não. */
function AP_PRECAD_SEG_campos_() {
  var guardado = null;
  if (typeof AP_Modulo_config === 'function') {
    try {
      var r = AP_Modulo_config('obter', { chave: AP_PRECAD_SEG.chaveConfig }, {});
      if (r && r.ok && r.dados) {
        guardado = (typeof r.dados === 'string') ? AP_PRECAD_SEG_json_(r.dados, null) : r.dados;
      }
    } catch (e) { }
  }

  var lista = [];
  var vistos = {};
  (guardado && guardado.campos ? guardado.campos : (Array.isArray(guardado) ? guardado : []))
    .forEach(function (c) {
      var nome = AP_PRECAD_SEG_texto_(c && c.campo);
      if (!nome || vistos[nome]) return;
      vistos[nome] = true;
      lista.push({
        campo: nome,
        rotulo: AP_PRECAD_SEG_texto_(c.rotulo) || nome,
        enviar: c.enviar !== false,
        obrigatorio: c.obrigatorio === true
      });
    });

  /* campo que o sistema passou a conhecer entra no fim, com o
     padrão de fábrica — a configuração antiga não some por isso */
  AP_PRECAD_SEG.camposPadrao.forEach(function (c) {
    if (vistos[c.campo]) return;
    vistos[c.campo] = true;
    lista.push({ campo: c.campo, rotulo: c.rotulo, enviar: c.enviar, obrigatorio: c.obrigatorio });
  });

  return { campos: lista, configurado: !!guardado };
}

function AP_PRECAD_SEG_salvarCampos_(payload, sessao) {
  var quem = AP_PRECAD_quem_(sessao);
  var pode = AP_PRECAD_SEG_pode_(sessao, 'configurar', null);
  if (!pode.permitido) return AP_PRECAD_SEG_erro_('SEM_PERMISSAO', pode.motivo);

  var entrada = (payload && payload.campos) || [];
  if (!entrada.length) {
    return AP_PRECAD_SEG_erro_('SEM_CAMPOS', 'Diga quais campos vão para a Segurança.');
  }

  var conhecidos = {};
  AP_PRECAD_SEG.camposPadrao.forEach(function (c) { conhecidos[c.campo] = c.rotulo; });

  var limpos = [];
  entrada.forEach(function (c) {
    var nome = AP_PRECAD_SEG_texto_(c && c.campo);
    if (!nome) return;
    limpos.push({
      campo: nome,
      rotulo: AP_PRECAD_SEG_texto_(c.rotulo) || conhecidos[nome] || nome,
      enviar: c.enviar !== false,
      obrigatorio: c.obrigatorio === true
    });
  });

  /* Nenhum campo é forçado aqui. A escolha é do RH, inteira —
     inclusive a de não mandar nada. Se a Segurança ficar sem
     informação para trabalhar, quem resolve é a configuração, não
     uma regra escondida no código. */

  /* A lista guardada é SEMPRE completa. Campo que a tela não mandou
     entra aqui como "não enviar", e não como o padrão de fábrica.
     Sem isto, o RH tira um campo da lista achando que escondeu, e
     ele volta sozinho na próxima leitura porque o padrão diz que
     ele vai — um vazamento silencioso, do tipo que ninguém vê até
     alguém ver o que não devia. */
  var jaTem = {};
  limpos.forEach(function (c) { jaTem[c.campo] = true; });
  AP_PRECAD_SEG.camposPadrao.forEach(function (c) {
    if (jaTem[c.campo]) return;
    limpos.push({ campo: c.campo, rotulo: c.rotulo, enviar: false, obrigatorio: false });
  });

  var valor = { campos: limpos, salvoPor: quem, salvoEm: AP_PRECAD_agora_() };

  if (typeof AP_Modulo_config !== 'function') {
    return AP_PRECAD_SEG_erro_('SEM_CONFIG',
      'O módulo de configuração do Core não está instalado, então não há onde guardar essa escolha.');
  }
  try {
    var r = AP_Modulo_config('salvar', { chave: AP_PRECAD_SEG.chaveConfig, valor: valor }, sessao);
    if (r && r.ok === false) {
      return AP_PRECAD_SEG_erro_('CONFIG_RECUSOU', r.mensagem || 'A configuração não foi salva.');
    }
  } catch (e) {
    return AP_PRECAD_SEG_erro_('CONFIG_FALHOU', 'Não consegui salvar: ' + e.message);
  }

  AP_PRECAD_auditar_(quem, 'PRECADASTRO_CAMPOS_CONFIGURADOS', AP_PRECAD_SEG.chaveConfig,
    { quantos: limpos.length, enviados: limpos.filter(function (c) { return c.enviar; }).length });

  return AP_PRECAD_SEG_ok_({ campos: limpos },
    limpos.filter(function (c) { return c.enviar; }).length + ' campo(s) vão para a Segurança.');
}


/* ------------------------------------------------------------
   1. O RH ENCAMINHA — é aqui que nasce o token e o QR
   ------------------------------------------------------------ */

function AP_PRECAD_SEG_encaminhar_(payload, sessao) {
  var p = AP_PRECAD_SEG_linha_(payload && payload.id);
  if (!p) return AP_PRECAD_SEG_erro_('NAO_ENCONTRADO', 'Pré-cadastro não localizado.');

  var pode = AP_PRECAD_SEG_pode_(sessao, 'encaminhar', p);
  if (!pode.permitido) return AP_PRECAD_SEG_erro_('SEM_PERMISSAO', pode.motivo);

  var etapa = AP_PRECAD_SEG_etapaDe_(p);
  if (etapa !== AP_PRECAD_SEG.etapas.RH) {
    return AP_PRECAD_SEG_erro_('JA_ENCAMINHADO',
      'Este processo já está com a Segurança (etapa ' + etapa + '). ' +
      'Para mandar de novo, a Segurança precisa devolver primeiro.',
      { etapa: etapa });
  }

  /* o RH pode completar foto e endereço na hora de encaminhar —
     são os dois campos que faltavam na ficha e que a Segurança
     precisa ver */
  var completar = {};
  ['foto', 'endereco'].forEach(function (c) {
    if (payload[c] !== undefined) completar[c] = AP_PRECAD_SEG_texto_(payload[c]);
  });

  /* o RH pode mandar a lista de EPI junto do encaminhamento, em vez
     de salvar antes. Um caminho só, dois jeitos de chegar nele. */
  if (payload.itens !== undefined) {
    completar.itensSelecionados =
      JSON.stringify(AP_PRECAD_SEG_juntarPorSku_(AP_PRECAD_SEG_limparItens_(payload.itens)));
  }
  if (payload.kit !== undefined) completar.kitSelecionado = AP_PRECAD_SEG_texto_(payload.kit);

  var cfg = AP_PRECAD_SEG_campos_();
  var autorizados = cfg.campos.filter(function (c) { return c.enviar; });

  /* faltou campo que o próprio RH marcou como obrigatório? */
  var juntos = {};
  AP_PRECAD_CFG.colunas.forEach(function (c) { juntos[c] = p[c]; });
  Object.keys(completar).forEach(function (c) { juntos[c] = completar[c]; });

  /* O que o RH marcou como obrigatório vira AVISO, não tranca.
     Antes isto recusava o encaminhamento, e o resultado prático era
     a ficha ficar presa no RH, sem token, sem credencial — por um
     campo em branco que ninguém era obrigado a preencher. A
     marcação continua servindo para quem confere lembrar do que
     falta; quem decide se manda assim mesmo é quem está lançando. */
  var faltando = autorizados.filter(function (c) {
    return c.obrigatorio && !AP_PRECAD_SEG_texto_(juntos[c.campo]);
  }).map(function (c) { return c.rotulo; });

  /* o token ou já nasceu no pré-cadastro, ou nasce agora. Nunca
     falta: nada aqui pode impedir o processo de ter um. */
  var token = AP_PRECAD_SEG_texto_(p.token) || AP_PRECAD_SEG_numeroToken_();
  var chave = AP_PRECAD_SEG_texto_(p.tokenChave) || AP_PRECAD_SEG_chave_();

  var quem = AP_PRECAD_quem_(sessao);
  var agora = AP_PRECAD_agora_();

  var campos = {
    etapa: AP_PRECAD_SEG.etapas.SEGURANCA,
    etapaEm: agora, etapaPor: quem,
    token: token,
    tokenChave: chave,
    tokenEstado: AP_PRECAD_SEG.estadosToken.AGUARDANDO,
    tokenEm: AP_PRECAD_SEG_texto_(p.tokenEm) || agora,
    identificacao: AP_PRECAD_SEG_texto_(p.identificacao) || AP_PRECAD_SEG_identificacao_(),
    /* congela o que foi autorizado HOJE: mudar a configuração
       amanhã não reescreve o que a Segurança recebeu */
    camposEnviados: JSON.stringify(autorizados.map(function (c) { return c.campo; })),
    devolvidoMotivo: ''
  };
  Object.keys(completar).forEach(function (c) { campos[c] = completar[c]; });

  AP_Data_update(AP_PRECAD_CFG.aba, p.id, campos, 'id');

  AP_PRECAD_auditar_(quem, 'PRECADASTRO_ENCAMINHADO_SEGURANCA', p.id, {
    nome: p.nome, obra: p.obra, campos: autorizados.length,
    permissaoVerificada: pode.verificado
  });

  var aviso = AP_PRECAD_SEG_avisar_(
    'Novo colaborador aguardando validação',
    AP_PRECAD_SEG_texto_(p.nome) + ' · ' + AP_PRECAD_SEG_texto_(p.obra) +
    ' · ' + AP_PRECAD_SEG_texto_(p.funcao || p.cargo) + ' · Pré-cadastro ' + p.id,
    'seguranca', p.id);

  return AP_PRECAD_SEG_ok_({
    id: p.id,
    etapa: AP_PRECAD_SEG.etapas.SEGURANCA,
    token: token,
    tokenEstado: AP_PRECAD_SEG.estadosToken.AGUARDANDO,
    conteudoQR: AP_PRECAD_SEG_conteudoQR_(p.id, chave),
    camposEnviados: autorizados.length,
    notificado: aviso.enviado,
    /* campos em branco que alguém marcou como obrigatórios: a
       Segurança vê e cobra, mas o processo não ficou parado */
    emBranco: faltando
  }, 'Encaminhado para a Segurança do Trabalho. ' +
    (aviso.enviado ? 'A equipe foi avisada.' : 'O aviso automático não saiu — a fila mostra assim mesmo.') +
    (faltando.length ? ' Ficaram em branco: ' + faltando.join(', ') + '.' : ''));
}

/** A credencial do processo: ID, token e o conteúdo do QR para imprimir. */
function AP_PRECAD_SEG_credencial_(payload, sessao) {
  var p = AP_PRECAD_SEG_linha_(payload && payload.id);
  if (!p) return AP_PRECAD_SEG_erro_('NAO_ENCONTRADO', 'Pré-cadastro não localizado.');

  var pode = AP_PRECAD_SEG_pode_(sessao, 'credencial', p);
  if (!pode.permitido) return AP_PRECAD_SEG_erro_('SEM_PERMISSAO', pode.motivo);

  var token = AP_PRECAD_SEG_texto_(p.token);
  if (!token) {
    return AP_PRECAD_SEG_erro_('SEM_TOKEN',
      'Este processo ainda não foi encaminhado para a Segurança, então não tem token nem QR.');
  }

  return AP_PRECAD_SEG_ok_({
    id: p.id, nome: p.nome, obra: p.obra,
    empresa: AP_PRECAD_SEG_texto_(p.empresa),
    funcao: AP_PRECAD_SEG_texto_(p.funcao || p.cargo),
    token: token,
    tokenEstado: AP_PRECAD_SEG_texto_(p.tokenEstado) || AP_PRECAD_SEG.estadosToken.GERADO,
    identificacao: AP_PRECAD_SEG_texto_(p.identificacao),
    conteudoQR: AP_PRECAD_SEG_conteudoQR_(p.id, AP_PRECAD_SEG_texto_(p.tokenChave) || token),
    etapa: AP_PRECAD_SEG_etapaDe_(p),
    criadoEm: AP_PRECAD_SEG_texto_(p.data),
    criadoPor: AP_PRECAD_SEG_texto_(p.solicitante),
    email: AP_PRECAD_SEG_texto_(p.email),
    usadoEm: AP_PRECAD_SEG_texto_(p.tokenUsadoEm),
    usadoPor: AP_PRECAD_SEG_texto_(p.tokenUsadoPor)
  });
}


/* ------------------------------------------------------------
   2. A SEGURANÇA ACHA A PESSOA
   Por nome, ID, matrícula, CPF, QR ou token — o que estiver à mão.
   ------------------------------------------------------------ */

function AP_PRECAD_SEG_localizar_(payload, sessao) {
  payload = payload || {};
  var termo = AP_PRECAD_SEG_texto_(payload.busca || payload.termo);
  var doQR = AP_PRECAD_SEG_lerQR_(payload.qr || payload.conteudo);
  var token = AP_PRECAD_SEG_texto_(payload.token) || doQR.token;

  var linhas = AP_PRECAD_linhas_();
  var achados = [];

  if (doQR.id || token) {
    achados = linhas.filter(function (x) {
      if (doQR.id && AP_PRECAD_SEG_texto_(x.id).toUpperCase() !== doQR.id.toUpperCase()) return false;
      /* o QR carrega a CHAVE; o número do token também é aceito,
         para quem digitou em vez de ler */
      if (token && AP_PRECAD_SEG_texto_(x.tokenChave) !== token &&
          AP_PRECAD_SEG_texto_(x.token) !== token) return false;
      return true;
    });

    /* QR que aponta para um processo que não existe, ou token que
       não bate: não se diz qual dos dois errou. */
    if (!achados.length) {
      return AP_PRECAD_SEG_erro_('QR_INVALIDO',
        'Este QR não corresponde a nenhum pré-cadastro em aberto.');
    }

    var achado = achados[0];
    var podeQR = AP_PRECAD_SEG_pode_(sessao, 'abrir', achado);
    if (!podeQR.permitido) {
      AP_PRECAD_auditar_(AP_PRECAD_quem_(sessao), 'PRECADASTRO_QR_BARRADO', achado.id,
        { motivo: podeQR.motivo });
      return AP_PRECAD_SEG_erro_('SEM_PERMISSAO', podeQR.motivo);
    }

    /* o QR localizou: fica o rastro de quem leu e quando */
    try {
      AP_Data_update(AP_PRECAD_CFG.aba, achado.id, {
        tokenUsadoEm: AP_PRECAD_agora_(),
        tokenUsadoPor: AP_PRECAD_quem_(sessao)
      }, 'id');
    } catch (e) { }
    AP_PRECAD_auditar_(AP_PRECAD_quem_(sessao), 'PRECADASTRO_QR_LIDO', achado.id, {});

  } else if (termo) {
    var b = termo.toLowerCase();
    var digitos = AP_PRECAD_so_(termo);
    achados = linhas.filter(function (x) {
      var texto = [x.nome, x.id, x.matricula, x.cargo, x.funcao, x.obra].join(' ').toLowerCase();
      if (texto.indexOf(b) > -1) return true;
      return !!(digitos && digitos.length >= 3 &&
        (AP_PRECAD_so_(x.cpf).indexOf(digitos) > -1 || AP_PRECAD_so_(x.matricula) === digitos));
    });
  } else {
    return AP_PRECAD_SEG_erro_('SEM_BUSCA', 'Diga um nome, um ID, uma matrícula ou passe o QR.');
  }

  if (payload.etapa) {
    achados = achados.filter(function (x) {
      return AP_PRECAD_SEG_etapaDe_(x) === String(payload.etapa).toUpperCase();
    });
  }

  /* a lista é enxuta de propósito: quem procura ainda não abriu o
     processo, e não precisa ver o conteúdo para saber que achou */
  return AP_PRECAD_SEG_ok_({
    quantos: achados.length,
    resultados: achados.slice(0, 25).map(AP_PRECAD_SEG_daFila_)
  }, achados.length ? '' : 'Nada encontrado com esse termo.');
}

/** Uma linha do jeito que a fila da Segurança mostra. */
function AP_PRECAD_SEG_daFila_(x) {
  return {
    id: x.id, nome: AP_PRECAD_SEG_texto_(x.nome),
    obra: AP_PRECAD_SEG_texto_(x.obra),
    empresa: AP_PRECAD_SEG_texto_(x.empresa),
    setor: AP_PRECAD_SEG_texto_(x.setor),
    funcao: AP_PRECAD_SEG_texto_(x.funcao || x.cargo),
    foto: AP_PRECAD_SEG_texto_(x.foto),
    token: AP_PRECAD_SEG_texto_(x.token),
    tokenEstado: AP_PRECAD_SEG_texto_(x.tokenEstado) || AP_PRECAD_SEG.estadosToken.GERADO,
    identificacao: AP_PRECAD_SEG_texto_(x.identificacao),
    etapa: AP_PRECAD_SEG_etapaDe_(x),
    validadoPor: AP_PRECAD_SEG_texto_(x.validadoSegPor),
    validadoEmail: AP_PRECAD_SEG_texto_(x.validadoSegEmail),
    validadoEm: AP_PRECAD_SEG_texto_(x.validadoSegEm),
    desde: AP_PRECAD_SEG_texto_(x.etapaEm) || AP_PRECAD_SEG_texto_(x.data),
    /* para o cartão do validado mostrar a reserva sem abrir o processo */
    reservaProtocolo: AP_PRECAD_SEG_texto_(x.reservaProtocolo),
    reservaErro: AP_PRECAD_SEG_texto_(x.reservaErro)
  };
}

/** A fila da Segurança. */
function AP_PRECAD_SEG_pendentes_(payload, sessao) {
  var emAberto = [AP_PRECAD_SEG.etapas.SEGURANCA, AP_PRECAD_SEG.etapas.ANALISE,
    AP_PRECAD_SEG.etapas.TREINAMENTO, AP_PRECAD_SEG.etapas.ASO, AP_PRECAD_SEG.etapas.VALIDACAO];

  var lista = AP_PRECAD_linhas_().filter(function (x) {
    return emAberto.indexOf(AP_PRECAD_SEG_etapaDe_(x)) > -1;
  });

  if (payload && payload.obra) {
    lista = lista.filter(function (x) { return String(x.obra) === String(payload.obra); });
  }

  return AP_PRECAD_SEG_ok_({
    quantos: lista.length,
    porEtapa: emAberto.reduce(function (acc, e) {
      acc[e] = lista.filter(function (x) { return AP_PRECAD_SEG_etapaDe_(x) === e; }).length;
      return acc;
    }, {}),
    processos: lista.map(AP_PRECAD_SEG_daFila_),
    /* os já validados, para a outra aba da tela */
    validados: AP_PRECAD_linhas_().filter(function (x) {
      var e = AP_PRECAD_SEG_etapaDe_(x);
      return e === AP_PRECAD_SEG.etapas.VALIDADO || e === AP_PRECAD_SEG.etapas.LIBERADO ||
        e === AP_PRECAD_SEG.etapas.CRACHA;
    }).filter(function (x) {
      return !(payload && payload.obra) || String(x.obra) === String(payload.obra);
    }).map(AP_PRECAD_SEG_daFila_)
  });
}


/* ------------------------------------------------------------
   3. A SEGURANÇA ABRE O PROCESSO
   Os dados do RH vêm preenchidos e marcados como vindos do RH.
   ------------------------------------------------------------ */

function AP_PRECAD_SEG_abrir_(payload, sessao) {
  var p = AP_PRECAD_SEG_linha_(payload && payload.id);
  if (!p) return AP_PRECAD_SEG_erro_('NAO_ENCONTRADO', 'Pré-cadastro não localizado.');

  var pode = AP_PRECAD_SEG_pode_(sessao, 'abrir', p);
  if (!pode.permitido) return AP_PRECAD_SEG_erro_('SEM_PERMISSAO', pode.motivo);

  var etapa = AP_PRECAD_SEG_etapaDe_(p);
  if (etapa === AP_PRECAD_SEG.etapas.RH) {
    return AP_PRECAD_SEG_erro_('NAO_ENCAMINHADO',
      'O RH ainda não encaminhou este pré-cadastro para a Segurança.', { etapa: etapa });
  }

  var autorizados = AP_PRECAD_SEG_json_(p.camposEnviados, null);
  var cfg = AP_PRECAD_SEG_campos_();
  if (!autorizados) {
    /* processo encaminhado antes desta versão: vale a configuração de agora */
    autorizados = cfg.campos.filter(function (c) { return c.enviar; })
      .map(function (c) { return c.campo; });
  }
  var rotulos = {};
  cfg.campos.forEach(function (c) { rotulos[c.campo] = c.rotulo; });

  var doRH = {};
  autorizados.forEach(function (campo) {
    doRH[campo] = {
      rotulo: rotulos[campo] || campo,
      valor: AP_PRECAD_SEG_texto_(p[campo]),
      origem: 'RH'
    };
  });

  return AP_PRECAD_SEG_ok_({
    id: p.id,
    etapa: etapa,
    status: AP_PRECAD_SEG_texto_(p.status),
    /* o cabeçalho da ficha: quem lançou, quando, e a foto.
       A foto vem por fora da configuração de campos porque a
       Segurança pode acrescentar ou trocar — e continua sendo o
       mesmo registro, não outro cadastro de pessoa. */
    cabecalho: {
      criadoEm: AP_PRECAD_SEG_texto_(p.data),
      criadoPor: AP_PRECAD_SEG_texto_(p.solicitante),
      encaminhadoEm: AP_PRECAD_SEG_texto_(p.etapaEm),
      encaminhadoPor: AP_PRECAD_SEG_texto_(p.etapaPor),
      validadoSegPor: AP_PRECAD_SEG_texto_(p.validadoSegPor),
      validadoSegEm: AP_PRECAD_SEG_texto_(p.validadoSegEm),
      validadoSegEmail: AP_PRECAD_SEG_texto_(p.validadoSegEmail),
      obra: AP_PRECAD_SEG_texto_(p.obra),
      setor: AP_PRECAD_SEG_texto_(p.setor),
      empresa: AP_PRECAD_SEG_texto_(p.empresa)
    },
    fotoAtual: AP_PRECAD_SEG_texto_(p.foto),
    token: {
      tem: !!AP_PRECAD_SEG_texto_(p.token),
      numero: AP_PRECAD_SEG_texto_(p.token),
      estado: AP_PRECAD_SEG_texto_(p.tokenEstado) || AP_PRECAD_SEG.estadosToken.GERADO,
      situacao: AP_PRECAD_SEG_texto_(p.token)
        ? (etapa === AP_PRECAD_SEG.etapas.VALIDADO || etapa === AP_PRECAD_SEG.etapas.LIBERADO ||
           etapa === AP_PRECAD_SEG.etapas.CRACHA ? 'ATIVO' : 'AGUARDANDO_VALIDACAO')
        : 'SEM_TOKEN'
    },
    identificacao: AP_PRECAD_SEG_texto_(p.identificacao),
    /* o que veio do RH, campo a campo, cada um dizendo de onde veio */
    doRH: doRH,
    camposOcultos: cfg.campos.filter(function (c) {
      return autorizados.indexOf(c.campo) === -1;
    }).map(function (c) { return c.rotulo; }),
    /* o que é da Segurança */
    seguranca: {
      riscos: AP_PRECAD_SEG_json_(p.riscos, []),
      episObrigatorios: AP_PRECAD_SEG_json_(p.episObrigatorios, []),
      treinamentos: AP_PRECAD_SEG_json_(p.treinamentos, []),
      aso: AP_PRECAD_SEG_json_(p.aso, {}),
      tipoSanguineo: AP_PRECAD_SEG_texto_(p.tipoSanguineo),
      observacao: AP_PRECAD_SEG_texto_(p.observacaoSeguranca)
    },
    /* o que o RH separou no estoque — a Segurança confere, não redigita */
    itens: AP_PRECAD_SEG_json_(p.itensSelecionados, []),
    kit: AP_PRECAD_SEG_texto_(p.kitSelecionado),
    assinatura: {
      tem: !!AP_PRECAD_SEG_texto_(p.assinatura),
      em: AP_PRECAD_SEG_texto_(p.assinaturaEm),
      por: AP_PRECAD_SEG_texto_(p.assinaturaPor)
    },
    biometriaId: AP_PRECAD_SEG_texto_(p.biometriaId),
    /* a reserva de EPI deste processo: o protocolo quando saiu, o
       motivo quando não saiu. A tela mostra os dois — esconder o
       motivo foi o que fez a reserva "desaparecer" sem explicação. */
    reserva: {
      protocolo: AP_PRECAD_SEG_texto_(p.reservaProtocolo),
      em: AP_PRECAD_SEG_texto_(p.reservaEm),
      erro: AP_PRECAD_SEG_texto_(p.reservaErro)
    },
    cracha: {
      codigo: AP_PRECAD_SEG_texto_(p.crachaCodigo),
      em: AP_PRECAD_SEG_texto_(p.crachaEm)
    },
    pendencias: AP_PRECAD_SEG_pendencias_(p)
  });
}

/** O que ainda falta para este processo poder ser validado. */
function AP_PRECAD_SEG_pendencias_(p) {
  var falta = [];

  var treinos = AP_PRECAD_SEG_json_(p.treinamentos, []);
  if (!treinos.length) falta.push({ o_que: 'Nenhum treinamento/NR lançado', onde: 'treinamentos' });
  else {
    var abertos = treinos.filter(function (t) {
      var s = String(t.status || '').toUpperCase();
      return s !== 'CONCLUIDO';
    });
    if (abertos.length) {
      falta.push({
        o_que: abertos.length + ' treinamento(s) ainda não concluído(s)',
        onde: 'treinamentos',
        quais: abertos.map(function (t) { return t.nr || t.nome; })
      });
    }
  }

  var aso = AP_PRECAD_SEG_json_(p.aso, {});
  if (!aso || !AP_PRECAD_SEG_texto_(aso.situacao)) {
    falta.push({ o_que: 'ASO não lançado', onde: 'aso' });
  } else if (String(aso.situacao).toUpperCase() !== 'APTO') {
    falta.push({ o_que: 'ASO consta como ' + aso.situacao, onde: 'aso' });
  }

  return falta;
}


/* ------------------------------------------------------------
   4. A SEGURANÇA COMPLETA O QUE É DELA
   ------------------------------------------------------------ */

function AP_PRECAD_SEG_complementar_(payload, sessao) {
  var p = AP_PRECAD_SEG_linha_(payload && payload.id);
  if (!p) return AP_PRECAD_SEG_erro_('NAO_ENCONTRADO', 'Pré-cadastro não localizado.');

  var pode = AP_PRECAD_SEG_pode_(sessao, 'complementar', p);
  if (!pode.permitido) return AP_PRECAD_SEG_erro_('SEM_PERMISSAO', pode.motivo);

  var etapa = AP_PRECAD_SEG_etapaDe_(p);
  if (etapa === AP_PRECAD_SEG.etapas.RH) {
    return AP_PRECAD_SEG_erro_('NAO_ENCAMINHADO', 'O RH ainda não encaminhou este processo.');
  }
  if (etapa === AP_PRECAD_SEG.etapas.CRACHA) {
    return AP_PRECAD_SEG_erro_('JA_EMITIDO',
      'O crachá deste colaborador já foi emitido. Alterações agora são pelo cadastro dele.');
  }

  var quem = AP_PRECAD_quem_(sessao);
  var agora = AP_PRECAD_agora_();
  var campos = { etapaEm: agora, etapaPor: quem };
  var mexeu = [];

  if (payload.riscos !== undefined) {
    campos.riscos = JSON.stringify(payload.riscos || []);
    mexeu.push('riscos');
  }
  if (payload.episObrigatorios !== undefined) {
    campos.episObrigatorios = JSON.stringify(payload.episObrigatorios || []);
    mexeu.push('EPIs obrigatórios');
  }
  if (payload.treinamentos !== undefined) {
    campos.treinamentos = JSON.stringify(AP_PRECAD_SEG_limparTreinos_(payload.treinamentos));
    mexeu.push('treinamentos');
  }
  if (payload.aso !== undefined) {
    campos.aso = JSON.stringify(AP_PRECAD_SEG_limparAso_(payload.aso));
    mexeu.push('ASO');
  }
  if (payload.tipoSanguineo !== undefined) {
    campos.tipoSanguineo = AP_PRECAD_SEG_texto_(payload.tipoSanguineo);
    mexeu.push('tipo sanguíneo');
  }
  if (payload.observacao !== undefined) {
    campos.observacaoSeguranca = AP_PRECAD_SEG_texto_(payload.observacao);
    mexeu.push('observação');
  }

  if (!mexeu.length) {
    return AP_PRECAD_SEG_erro_('NADA_A_SALVAR', 'Nenhuma informação da Segurança foi enviada.');
  }

  /* a etapa anda sozinha conforme o que já foi preenchido — quem
     usa não precisa escolher etapa num menu, e a fila fica honesta */
  var depois = {};
  AP_PRECAD_CFG.colunas.forEach(function (c) { depois[c] = p[c]; });
  Object.keys(campos).forEach(function (c) { depois[c] = campos[c]; });

  var falta = AP_PRECAD_SEG_pendencias_(depois);
  var faltaTreino = falta.filter(function (f) { return f.onde === 'treinamentos'; }).length > 0;
  var faltaAso = falta.filter(function (f) { return f.onde === 'aso'; }).length > 0;

  if (etapa !== AP_PRECAD_SEG.etapas.VALIDADO && etapa !== AP_PRECAD_SEG.etapas.LIBERADO) {
    campos.etapa = faltaTreino ? AP_PRECAD_SEG.etapas.TREINAMENTO
      : faltaAso ? AP_PRECAD_SEG.etapas.ASO
        : AP_PRECAD_SEG.etapas.VALIDACAO;
  }

  AP_Data_update(AP_PRECAD_CFG.aba, p.id, campos, 'id');
  AP_PRECAD_auditar_(quem, 'PRECADASTRO_COMPLEMENTADO_SEGURANCA', p.id, {
    alterou: mexeu, etapa: campos.etapa || etapa
  });

  return AP_PRECAD_SEG_ok_({
    id: p.id, etapa: campos.etapa || etapa, alterou: mexeu, pendencias: falta
  }, 'Salvo: ' + mexeu.join(', ') + '.' +
    (falta.length ? ' Ainda falta: ' + falta.map(function (f) { return f.o_que; }).join('; ') + '.'
      : ' Não falta mais nada para validar.'));
}

/** Treinamento vem da tela; aqui ele é conferido antes de virar linha. */
function AP_PRECAD_SEG_limparTreinos_(lista) {
  return (lista || []).map(function (t) {
    var status = String((t && t.status) || 'NAO_INICIADO').toUpperCase();
    if (AP_PRECAD_SEG.statusTreinamento.indexOf(status) === -1) status = 'NAO_INICIADO';
    return {
      nr: AP_PRECAD_SEG_texto_(t.nr),
      nome: AP_PRECAD_SEG_texto_(t.nome || t.treinamento),
      status: status,
      data: AP_PRECAD_SEG_texto_(t.data),
      validade: AP_PRECAD_SEG_texto_(t.validade),
      instrutor: AP_PRECAD_SEG_texto_(t.instrutor),
      comprovante: AP_PRECAD_SEG_texto_(t.comprovante)
    };
  }).filter(function (t) { return t.nr || t.nome; });
}

function AP_PRECAD_SEG_limparAso_(aso) {
  aso = aso || {};
  return {
    situacao: AP_PRECAD_SEG_texto_(aso.situacao).toUpperCase(),
    tipo: AP_PRECAD_SEG_texto_(aso.tipo),
    data: AP_PRECAD_SEG_texto_(aso.data),
    validade: AP_PRECAD_SEG_texto_(aso.validade),
    medico: AP_PRECAD_SEG_texto_(aso.medico),
    comprovante: AP_PRECAD_SEG_texto_(aso.comprovante)
  };
}

/**
 * As NRs e treinamentos que a função pede — da lista que o crachá
 * já mantém. Não é um cadastro novo de treinamento: é a mesma
 * lista, oferecida aqui para a Segurança marcar o que se aplica.
 */
function AP_PRECAD_SEG_nrsDisponiveis_() {
  var lista = [];
  try {
    if (typeof AP_CR_CFG !== 'undefined' && AP_CR_CFG && AP_CR_CFG.nrs) {
      lista = [].concat(AP_CR_CFG.nrs);
    }
  } catch (e) { }
  if (!lista.length) {
    /* as mesmas que o verso do crachá imprime hoje */
    lista = ['NR 01', 'NR 01 FH', 'NR 01+18', 'NR 06', 'NR 07', 'NR 10',
      'NR 11', 'NR 12', 'NR 20', 'NR 23', 'NR 26', 'NR 35'];
  }
  return lista.map(function (n) { return { nr: n, nome: n }; });
}


/**
 * A FOTO — acrescentada ou trocada pela Segurança quando o RH não
 * mandou. Grava no mesmo registro: não nasce cadastro de pessoa
 * nenhum só para guardar uma imagem. A mesma foto serve depois
 * para o crachá, a ficha de EPI e o histórico.
 */
function AP_PRECAD_SEG_salvarFoto_(payload, sessao) {
  var p = AP_PRECAD_SEG_linha_(payload && payload.id);
  if (!p) return AP_PRECAD_SEG_erro_('NAO_ENCONTRADO', 'Pré-cadastro não localizado.');

  var pode = AP_PRECAD_SEG_pode_(sessao, 'foto', p);
  if (!pode.permitido) return AP_PRECAD_SEG_erro_('SEM_PERMISSAO', pode.motivo);

  var foto = AP_PRECAD_SEG_texto_(payload.foto);
  if (!foto) return AP_PRECAD_SEG_erro_('SEM_FOTO', 'Não veio nenhuma foto.');
  if (foto.indexOf('data:image/') !== 0) {
    return AP_PRECAD_SEG_erro_('FOTO_INVALIDA', 'O que chegou não é uma imagem.');
  }
  if (foto.length > 45000) {
    return AP_PRECAD_SEG_erro_('FOTO_GRANDE',
      'A foto ficou grande demais para guardar (' + foto.length + ' caracteres). ' +
      'Reduza antes de enviar.');
  }

  var quem = AP_PRECAD_quem_(sessao);
  var tinha = !!AP_PRECAD_SEG_texto_(p.foto);
  AP_Data_update(AP_PRECAD_CFG.aba, p.id, {
    foto: foto, atualizadoEm: AP_PRECAD_agora_(), atualizadoPor: quem
  }, 'id');

  AP_PRECAD_auditar_(quem, tinha ? 'PRECADASTRO_FOTO_TROCADA' : 'PRECADASTRO_FOTO_ACRESCENTADA',
    p.id, { tamanho: foto.length });

  return AP_PRECAD_SEG_ok_({ id: p.id, trocada: tinha },
    tinha ? 'Foto trocada.' : 'Foto acrescentada ao mesmo registro do colaborador.');
}


/* ------------------------------------------------------------
   5. ASSINATURA — registro do processo, nunca autenticação
   ------------------------------------------------------------ */

function AP_PRECAD_SEG_assinar_(payload, sessao) {
  var p = AP_PRECAD_SEG_linha_(payload && payload.id);
  if (!p) return AP_PRECAD_SEG_erro_('NAO_ENCONTRADO', 'Pré-cadastro não localizado.');

  var pode = AP_PRECAD_SEG_pode_(sessao, 'assinar', p);
  if (!pode.permitido) return AP_PRECAD_SEG_erro_('SEM_PERMISSAO', pode.motivo);

  var desenho = AP_PRECAD_SEG_texto_(payload.assinatura);
  if (!desenho) return AP_PRECAD_SEG_erro_('SEM_ASSINATURA', 'Não veio nenhuma assinatura.');
  if (desenho.indexOf('data:image/') !== 0) {
    return AP_PRECAD_SEG_erro_('ASSINATURA_INVALIDA',
      'A assinatura precisa vir como imagem. O que chegou não é uma.');
  }
  /* célula de planilha aguenta 50.000 caracteres; acima disso a
     gravação falharia no meio e ninguém saberia por quê */
  if (desenho.length > 45000) {
    return AP_PRECAD_SEG_erro_('ASSINATURA_GRANDE',
      'A assinatura ficou grande demais para guardar (' + desenho.length + ' caracteres). ' +
      'Reduza a área de desenho ou a qualidade.');
  }

  var quem = AP_PRECAD_quem_(sessao);
  AP_Data_update(AP_PRECAD_CFG.aba, p.id, {
    assinatura: desenho,
    assinaturaEm: AP_PRECAD_agora_(),
    assinaturaPor: AP_PRECAD_SEG_texto_(payload.assinadoPor) || AP_PRECAD_SEG_texto_(p.nome)
  }, 'id');

  AP_PRECAD_auditar_(quem, 'PRECADASTRO_ASSINADO', p.id, { tamanho: desenho.length });

  return AP_PRECAD_SEG_ok_({ id: p.id },
    'Assinatura registrada. Ela fica no processo e pode ser consultada depois — ' +
    'e não substitui login, crachá nem biometria.');
}

/** A assinatura de volta, para quem tiver permissão de ver. */
function AP_PRECAD_SEG_verAssinatura_(payload, sessao) {
  var p = AP_PRECAD_SEG_linha_(payload && payload.id);
  if (!p) return AP_PRECAD_SEG_erro_('NAO_ENCONTRADO', 'Pré-cadastro não localizado.');

  var pode = AP_PRECAD_SEG_pode_(sessao, 'abrir', p);
  if (!pode.permitido) return AP_PRECAD_SEG_erro_('SEM_PERMISSAO', pode.motivo);

  var desenho = AP_PRECAD_SEG_texto_(p.assinatura);
  if (!desenho) return AP_PRECAD_SEG_erro_('SEM_ASSINATURA', 'Este processo não tem assinatura.');

  return AP_PRECAD_SEG_ok_({
    id: p.id, assinatura: desenho,
    em: AP_PRECAD_SEG_texto_(p.assinaturaEm),
    por: AP_PRECAD_SEG_texto_(p.assinaturaPor)
  });
}


/* ------------------------------------------------------------
   6. VALIDAR, DEVOLVER, LIBERAR
   ------------------------------------------------------------ */

function AP_PRECAD_SEG_validar_(payload, sessao) {
  var p = AP_PRECAD_SEG_linha_(payload && payload.id);
  if (!p) return AP_PRECAD_SEG_erro_('NAO_ENCONTRADO', 'Pré-cadastro não localizado.');

  var pode = AP_PRECAD_SEG_pode_(sessao, 'validarSeguranca', p);
  if (!pode.permitido) return AP_PRECAD_SEG_erro_('SEM_PERMISSAO', pode.motivo);

  var etapa = AP_PRECAD_SEG_etapaDe_(p);
  if (etapa === AP_PRECAD_SEG.etapas.RH) {
    return AP_PRECAD_SEG_erro_('NAO_ENCAMINHADO', 'O RH ainda não encaminhou este processo.');
  }
  if (etapa === AP_PRECAD_SEG.etapas.VALIDADO || etapa === AP_PRECAD_SEG.etapas.LIBERADO ||
    etapa === AP_PRECAD_SEG.etapas.CRACHA) {
    return AP_PRECAD_SEG_erro_('JA_VALIDADO',
      'A Segurança já validou este processo em ' + AP_PRECAD_SEG_texto_(p.validadoSegEm) + '.',
      { etapa: etapa });
  }

  var falta = AP_PRECAD_SEG_pendencias_(p);
  if (falta.length && !payload.mesmoAssim) {
    return AP_PRECAD_SEG_erro_('FALTA_COMPLETAR',
      'Não dá para validar ainda: ' + falta.map(function (f) { return f.o_que; }).join('; ') + '.',
      { pendencias: falta });
  }

  var quem = AP_PRECAD_quem_(sessao);
  var agora = AP_PRECAD_agora_();

  /* O E-MAIL DE QUEM VALIDOU sai da sessão ou da conta do Google —
     nunca de um campo digitado. Quem valida responde pelo que
     validou, e isso não pode ser escrito à mão por outra pessoa. */
  var email = AP_PRECAD_SEG_texto_(sessao && (sessao.email || sessao.usuarioEmail));
  if (!email) {
    try { email = AP_PRECAD_SEG_texto_(Session.getActiveUser().getEmail()); } catch (e) { }
  }

  /* validado pela Segurança E com o acesso decidido pelo
     administrador = liberado. Só um dos dois não basta. */
  var acessoDecidido = String(p.status || '').toUpperCase() === AP_PRECAD_CFG.status.VALIDADO;
  var etapaNova = acessoDecidido ? AP_PRECAD_SEG.etapas.LIBERADO : AP_PRECAD_SEG.etapas.VALIDADO;

  AP_Data_update(AP_PRECAD_CFG.aba, p.id, {
    etapa: etapaNova, etapaEm: agora, etapaPor: quem,
    validadoSegPor: quem, validadoSegEm: agora,
    validadoSegEmail: email,
    /* o token passa a valer para a retirada. É o MESMO token:
       muda de estado, não de número. */
    tokenEstado: AP_PRECAD_SEG.estadosToken.ATIVO,
    identificacao: AP_PRECAD_SEG_texto_(p.identificacao) || AP_PRECAD_SEG_identificacao_(),
    devolvidoMotivo: ''
  }, 'id');

  AP_PRECAD_auditar_(quem, 'PRECADASTRO_VALIDADO_SEGURANCA', p.id, {
    nome: p.nome, empresa: p.empresa, obra: p.obra,
    etapa: etapaNova, validadoPor: quem, email: email,
    comPendencia: falta.length ? falta.map(function (f) { return f.o_que; }) : [],
    permissaoVerificada: pode.verificado
  });

  /* o RH fica sabendo — pelo mesmo mecanismo de notificações */
  AP_PRECAD_SEG_avisar_('Validação concluída',
    AP_PRECAD_SEG_texto_(p.nome) + ' foi validado pela Segurança. Validado por: ' + quem + '.',
    'rh', p.id);

  /* A RESERVA DE EPI SAI AGORA.
     Depois de gravar a validação, nunca antes: se a reserva falhar,
     a validação continua valendo. O motivo vai na resposta e fica
     gravado, para a tela mostrar em vez de esconder. */
  var reserva = null, reservaErro = null;
  try {
    var rr = AP_PRECAD_SEG_gerarReserva_(
      AP_PRECAD_SEG_linha_(p.id) || p, sessao, false);
    if (rr && rr.ok) reserva = rr.dados;
    else reservaErro = { codigo: (rr && rr.codigo) || 'SEM_RESPOSTA', mensagem: (rr && rr.mensagem) || '' };
  } catch (e) {
    reservaErro = { codigo: 'FALHOU', mensagem: e.message };
  }

  var base = etapaNova === AP_PRECAD_SEG.etapas.LIBERADO
    ? 'Validado e liberado. O crachá já pode ser emitido.'
    : 'Validado pela Segurança. Falta o administrador definir o tipo de acesso para liberar o crachá.';

  return AP_PRECAD_SEG_ok_({
    id: p.id, etapa: etapaNova,
    liberado: etapaNova === AP_PRECAD_SEG.etapas.LIBERADO,
    validadoPor: quem, validadoEmail: email, validadoEm: agora,
    tokenEstado: AP_PRECAD_SEG.estadosToken.ATIVO,
    identificacao: AP_PRECAD_SEG_texto_(p.identificacao),
    pendencias: falta,
    reserva: reserva,
    reservaErro: reservaErro
  }, base + (reserva
    ? ' Reserva de EPI ' + reserva.protocolo + ' criada com ' + reserva.itens +
      ' item(ns) — o estoque só baixa na entrega.'
    : reservaErro
      ? ' A reserva de EPI NÃO saiu: ' + reservaErro.mensagem
      : ''));
}

/** Devolver para o RH — com motivo, sempre. */
function AP_PRECAD_SEG_devolver_(payload, sessao) {
  var p = AP_PRECAD_SEG_linha_(payload && payload.id);
  if (!p) return AP_PRECAD_SEG_erro_('NAO_ENCONTRADO', 'Pré-cadastro não localizado.');

  var pode = AP_PRECAD_SEG_pode_(sessao, 'devolver', p);
  if (!pode.permitido) return AP_PRECAD_SEG_erro_('SEM_PERMISSAO', pode.motivo);

  var motivo = AP_PRECAD_SEG_texto_(payload.motivo);
  if (!motivo) {
    return AP_PRECAD_SEG_erro_('SEM_MOTIVO',
      'Diga o que está errado ou faltando. Devolver sem motivo faz o RH adivinhar.');
  }

  var etapa = AP_PRECAD_SEG_etapaDe_(p);
  if (etapa === AP_PRECAD_SEG.etapas.RH) {
    return AP_PRECAD_SEG_erro_('JA_NO_RH', 'Este processo já está com o RH.');
  }
  if (etapa === AP_PRECAD_SEG.etapas.CRACHA) {
    return AP_PRECAD_SEG_erro_('JA_EMITIDO', 'O crachá já foi emitido; não dá para devolver.');
  }

  var quem = AP_PRECAD_quem_(sessao);
  AP_Data_update(AP_PRECAD_CFG.aba, p.id, {
    etapa: AP_PRECAD_SEG.etapas.RH,
    etapaEm: AP_PRECAD_agora_(), etapaPor: quem,
    devolvidoMotivo: motivo
  }, 'id');

  AP_PRECAD_auditar_(quem, 'PRECADASTRO_DEVOLVIDO_AO_RH', p.id, { motivo: motivo });
  AP_PRECAD_SEG_avisar_('Pré-cadastro devolvido pela Segurança',
    AP_PRECAD_SEG_texto_(p.nome) + ' · ' + motivo, 'rh', p.id);

  return AP_PRECAD_SEG_ok_({ id: p.id, etapa: AP_PRECAD_SEG.etapas.RH },
    'Devolvido ao RH. Nada foi apagado: o motivo fica no registro e no histórico.');
}


/* ------------------------------------------------------------
   7. O CRACHÁ — o módulo que já existe é quem emite
   ------------------------------------------------------------ */

function AP_PRECAD_SEG_paraCracha_(payload, sessao) {
  var p = AP_PRECAD_SEG_linha_(payload && payload.id);
  if (!p) return AP_PRECAD_SEG_erro_('NAO_ENCONTRADO', 'Pré-cadastro não localizado.');

  var pode = AP_PRECAD_SEG_pode_(sessao, 'emitirCracha', p);
  if (!pode.permitido) return AP_PRECAD_SEG_erro_('SEM_PERMISSAO', pode.motivo);

  var etapa = AP_PRECAD_SEG_etapaDe_(p);
  if (etapa === AP_PRECAD_SEG.etapas.CRACHA) {
    return AP_PRECAD_SEG_erro_('JA_EMITIDO',
      'O crachá ' + AP_PRECAD_SEG_texto_(p.crachaCodigo) + ' já foi emitido para esta pessoa.',
      { codigo: AP_PRECAD_SEG_texto_(p.crachaCodigo) });
  }
  if (etapa !== AP_PRECAD_SEG.etapas.LIBERADO) {
    return AP_PRECAD_SEG_erro_('NAO_LIBERADO',
      'O crachá só sai depois que a Segurança valida E o administrador define o acesso. ' +
      'Hoje este processo está em ' + etapa + '.',
      { etapa: etapa, pendencias: AP_PRECAD_SEG_pendencias_(p) });
  }

  /* o payload que o AP_Modulo_cracha('emitir') espera — os mesmos
     nomes de campo que a tela de crachás já manda hoje */
  return AP_PRECAD_SEG_ok_({
    id: p.id,
    emitir: {
      colaborador: AP_PRECAD_SEG_texto_(p.nome),
      matricula: AP_PRECAD_SEG_texto_(p.matricula),
      cpf: AP_PRECAD_SEG_texto_(p.cpf),
      funcao: AP_PRECAD_SEG_texto_(p.funcao || p.cargo),
      setor: AP_PRECAD_SEG_texto_(p.setor),
      obra: AP_PRECAD_SEG_texto_(p.obra),
      unidade: AP_PRECAD_SEG_texto_(p.empresa),
      foto: AP_PRECAD_SEG_texto_(p.foto),
      nivel: 'SOLICITAR'
    },
    /* o que foi separado, para quem for montar a reserva depois */
    itens: AP_PRECAD_SEG_json_(p.itensSelecionados, []),
    kit: AP_PRECAD_SEG_texto_(p.kitSelecionado),
    /* o que a Segurança apurou, para o verso do crachá */
    verso: {
      tipoSanguineo: AP_PRECAD_SEG_texto_(p.tipoSanguineo),
      treinamentos: AP_PRECAD_SEG_json_(p.treinamentos, []),
      aso: AP_PRECAD_SEG_json_(p.aso, {})
    }
  }, 'Dados conferidos e liberados para o módulo de crachá.');
}

/** O módulo de crachá emitiu: o processo registra e fecha. */
function AP_PRECAD_SEG_crachaEmitido_(payload, sessao) {
  var p = AP_PRECAD_SEG_linha_(payload && payload.id);
  if (!p) return AP_PRECAD_SEG_erro_('NAO_ENCONTRADO', 'Pré-cadastro não localizado.');

  var codigo = AP_PRECAD_SEG_texto_(payload.codigo);
  if (!codigo) return AP_PRECAD_SEG_erro_('SEM_CODIGO', 'Diga qual crachá foi emitido.');

  var quem = AP_PRECAD_quem_(sessao);
  AP_Data_update(AP_PRECAD_CFG.aba, p.id, {
    etapa: AP_PRECAD_SEG.etapas.CRACHA,
    etapaEm: AP_PRECAD_agora_(), etapaPor: quem,
    crachaCodigo: codigo, crachaEm: AP_PRECAD_agora_(),
    /* o token do processo morre aqui: ele servia para achar a
       pessoa durante a entrada, e a entrada acabou */
    tokenUsadoEm: AP_PRECAD_agora_(), tokenUsadoPor: quem
  }, 'id');

  AP_PRECAD_auditar_(quem, 'PRECADASTRO_CRACHA_EMITIDO', p.id, { codigo: codigo });

  return AP_PRECAD_SEG_ok_({ id: p.id, codigo: codigo, etapa: AP_PRECAD_SEG.etapas.CRACHA },
    'Processo encerrado: ' + AP_PRECAD_SEG_texto_(p.nome) + ' está liberado para a operação.');
}


/* ------------------------------------------------------------
   8. INSTALAR — só garante a aba e as colunas novas
   ------------------------------------------------------------ */

/* Uma vez por execução. Conferir cabeçalho custa uma leitura, e
   AP_PRECAD_aba_() é chamada em todo caminho de gravação. */
var AP_PRECAD_SEG_COLUNAS_CONFERIDAS = false;

/**
 * Confere o cabeçalho REAL da aba e acrescenta no FIM as colunas
 * que faltarem. Nunca reordena, nunca apaga, nunca cria outra aba.
 * Devolve o que encontrou, para o diagnóstico poder mostrar.
 */
function AP_PRECAD_SEG_garantirColunas_(forcar) {
  var conferencia = {
    aba: AP_PRECAD_CFG.aba,
    esperadas: AP_PRECAD_CFG.colunas.length,
    noCabecalho: 0,
    faltando: [],
    acrescentadas: [],
    jaConferida: false
  };
  if (AP_PRECAD_SEG_COLUNAS_CONFERIDAS && !forcar) {
    conferencia.jaConferida = true;
    return conferencia;
  }
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var aba = ss.getSheetByName(AP_PRECAD_CFG.aba);
    if (!aba) { conferencia.erro = 'A aba não existe ainda.'; return conferencia; }
    var ultima = aba.getLastColumn();
    if (ultima < 1) { conferencia.erro = 'A aba está sem cabeçalho.'; return conferencia; }

    var cab = aba.getRange(1, 1, 1, ultima).getValues()[0].map(function (c) {
      return String(c).trim();
    });
    conferencia.noCabecalho = cab.filter(function (c) { return c; }).length;

    var faltando = AP_PRECAD_CFG.colunas.filter(function (c) {
      return cab.indexOf(c) === -1;
    });
    conferencia.faltando = faltando.slice();

    /* coluna nova entra no FIM. Nunca no meio: o que já está
       gravado embaixo não pode escorregar de lugar. */
    if (faltando.length) {
      aba.getRange(1, cab.length + 1, 1, faltando.length).setValues([faltando]);
      try { SpreadsheetApp.flush(); } catch (e) { }
      conferencia.acrescentadas = faltando.slice();
      conferencia.faltando = [];
    }
    AP_PRECAD_SEG_COLUNAS_CONFERIDAS = true;
  } catch (e) {
    conferencia.erro = e.message;
  }
  return conferencia;
}

/**
 * Só leitura. Não cria a aba, não escreve cabeçalho, não grava nada.
 * Responde o que está lá para a tela poder mostrar.
 */
function AP_PRECAD_SEG_conferirAba_() {
  var r = {
    aba: AP_PRECAD_CFG.aba,
    existe: false,
    noCabecalho: 0,
    esperadas: AP_PRECAD_CFG.colunas.length,
    faltando: [],
    linhas: null
  };
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var aba = ss.getSheetByName(AP_PRECAD_CFG.aba);
    if (!aba) {
      return AP_PRECAD_SEG_ok_(r, 'A aba ' + AP_PRECAD_CFG.aba + ' ainda não existe. ' +
        'Ela é criada no primeiro pré-cadastro.');
    }
    r.existe = true;
    r.linhas = Math.max(0, aba.getLastRow() - 1);
    var ultima = aba.getLastColumn();
    if (ultima > 0) {
      var cab = aba.getRange(1, 1, 1, ultima).getValues()[0].map(function (c) {
        return String(c).trim();
      });
      r.noCabecalho = cab.filter(function (c) { return c; }).length;
      r.faltando = AP_PRECAD_CFG.colunas.filter(function (c) { return cab.indexOf(c) === -1; });
    }
  } catch (e) {
    r.erro = e.message;
    return AP_PRECAD_SEG_erro_('FALHOU_LER_ABA', 'Não consegui ler o cabeçalho: ' + e.message, r);
  }
  return AP_PRECAD_SEG_ok_(r, r.faltando.length
    ? ('Faltam ' + r.faltando.length + ' coluna(s) no cabeçalho: ' + r.faltando.join(', ') +
      '. Enquanto elas não existirem, o token e a etapa não ficam gravados. ' +
      'O próximo pré-cadastro acrescenta essas colunas no fim, sozinho.')
    : 'O cabeçalho está completo: ' + r.noCabecalho + ' coluna(s).');
}

function AP_PRECAD_SEG_instalar_() {
  AP_PRECAD_aba_();
  var conferencia = AP_PRECAD_SEG_garantirColunas_(true);
  conferencia.colunas = AP_PRECAD_CFG.colunas.length;
  return AP_PRECAD_SEG_ok_(conferencia,
    'Aba conferida. ' + (conferencia.acrescentadas.length
      ? (conferencia.acrescentadas.length + ' coluna(s) acrescentada(s) no fim: ' +
        conferencia.acrescentadas.join(', ') + '.')
      : 'Nenhuma coluna faltando.'));
}


/* ------------------------------------------------------------
   9. OS EPIs E KITS QUE O RH SEPAROU
   ------------------------------------------------------------
   Nada de catálogo próprio aqui. O que entra é o que o cadastro
   de itens e o de kits já têm — cada linha guarda o SKU, e é o
   SKU que diferencia BOTA 40 de BOTA 41. Agrupar pela descrição
   seria o mesmo que entregar o número errado no dia da retirada.
   ------------------------------------------------------------ */

function AP_PRECAD_SEG_limparItens_(lista) {
  return (lista || []).map(function (i) {
    var qtd = Number(i && i.qtd);
    if (!(qtd > 0)) qtd = 1;
    return {
      sku: AP_PRECAD_SEG_texto_(i.sku || i.codigo || i.id),
      nome: AP_PRECAD_SEG_texto_(i.nome || i.descricao),
      tamanho: AP_PRECAD_SEG_texto_(i.tamanho),
      unidade: AP_PRECAD_SEG_texto_(i.unidade) || 'un',
      categoria: AP_PRECAD_SEG_texto_(i.categoria),
      qtd: qtd,
      /* de onde veio: item avulso ou dentro de um kit. Some junto
         com o kit se o kit for trocado, e é por isso que precisa
         estar escrito. */
      kit: AP_PRECAD_SEG_texto_(i.kit)
    };
  }).filter(function (i) { return i.sku && i.nome; });
}

/** Junta as linhas do mesmo SKU, somando — sem misturar tamanhos. */
function AP_PRECAD_SEG_juntarPorSku_(lista) {
  var mapa = {}, ordem = [];
  lista.forEach(function (i) {
    var chave = i.sku + '|' + i.kit;
    if (!mapa[chave]) { mapa[chave] = i; ordem.push(chave); return; }
    mapa[chave].qtd += i.qtd;
  });
  return ordem.map(function (k) { return mapa[k]; });
}

function AP_PRECAD_SEG_salvarItens_(payload, sessao) {
  var p = AP_PRECAD_SEG_linha_(payload && payload.id);
  if (!p) return AP_PRECAD_SEG_erro_('NAO_ENCONTRADO', 'Pré-cadastro não localizado.');

  var pode = AP_PRECAD_SEG_pode_(sessao, 'separarItens', p);
  if (!pode.permitido) return AP_PRECAD_SEG_erro_('SEM_PERMISSAO', pode.motivo);

  var etapa = AP_PRECAD_SEG_etapaDe_(p);
  if (etapa === AP_PRECAD_SEG.etapas.CRACHA) {
    return AP_PRECAD_SEG_erro_('JA_EMITIDO',
      'O processo já foi encerrado; a entrega de EPI agora é pela ficha do colaborador.');
  }

  var itens = AP_PRECAD_SEG_juntarPorSku_(AP_PRECAD_SEG_limparItens_(payload.itens));
  var quem = AP_PRECAD_quem_(sessao);

  AP_Data_update(AP_PRECAD_CFG.aba, p.id, {
    itensSelecionados: JSON.stringify(itens),
    kitSelecionado: AP_PRECAD_SEG_texto_(payload.kit),
    atualizadoEm: AP_PRECAD_agora_(), atualizadoPor: quem
  }, 'id');

  AP_PRECAD_auditar_(quem, 'PRECADASTRO_ITENS_SEPARADOS', p.id, {
    quantos: itens.length,
    kit: AP_PRECAD_SEG_texto_(payload.kit),
    skus: itens.map(function (i) { return i.sku + ' x' + i.qtd; })
  });

  return AP_PRECAD_SEG_ok_({
    id: p.id, itens: itens, kit: AP_PRECAD_SEG_texto_(payload.kit),
    total: itens.reduce(function (t, i) { return t + i.qtd; }, 0)
  }, itens.length ? itens.length + ' item(ns) separado(s).' : 'Lista de itens limpa.');
}

function AP_PRECAD_SEG_itens_(payload, sessao) {
  var p = AP_PRECAD_SEG_linha_(payload && payload.id);
  if (!p) return AP_PRECAD_SEG_erro_('NAO_ENCONTRADO', 'Pré-cadastro não localizado.');
  var itens = AP_PRECAD_SEG_json_(p.itensSelecionados, []);
  return AP_PRECAD_SEG_ok_({
    id: p.id, itens: itens,
    kit: AP_PRECAD_SEG_texto_(p.kitSelecionado),
    total: itens.reduce(function (t, i) { return t + (Number(i.qtd) || 0); }, 0)
  });
}


/* ============================================================
   A RESERVA DE EPI NASCE NA VALIDAÇÃO
   ------------------------------------------------------------
   O RH separa os EPIs no pré-cadastro, a Segurança valida, e é
   nesse instante que o material tem que ficar guardado no nome da
   pessoa. Antes não ficava: os itens dormiam na coluna
   itensSelecionados e o almoxarifado não tinha o que entregar.

   NÃO existe reserva nova aqui. Quem cria é o AP_EPI_criarReserva_
   do módulo de EPI, pela porta AP_Modulo_epigestao('criarReserva'),
   a mesma que a tela usa. No almoxarifado deste sistema uma reserva
   de EPI É a "ficha" — o modalBaixaEPI procura o protocolo na
   listarReservas e chama isso de ficha. Então é um pedido só que
   resolve a ficha e a reserva.

   Três regras que isto respeita:
     · o estoque NÃO é baixado — a baixa é na entrega, no balcão,
       contra o token;
     · uma validação gera UMA reserva: se já houver protocolo
       gravado, não cria outra;
     · se a reserva não puder sair (EPI não cadastrado, saldo
       insuficiente, módulo de EPI ausente), a validação continua
       valendo e o motivo fica GRAVADO e visível — validar é decisão
       de segurança, não de estoque.
   ============================================================ */

function AP_PRECAD_SEG_gerarReserva_(p, sessao, forcar) {
  if (!p) return AP_PRECAD_SEG_erro_('NAO_ENCONTRADO', 'Pré-cadastro não localizado.');

  var jaTem = AP_PRECAD_SEG_texto_(p.reservaProtocolo);
  if (jaTem && !forcar) {
    return AP_PRECAD_SEG_ok_({ protocolo: jaTem, jaExistia: true },
      'A reserva ' + jaTem + ' já existe para este processo.');
  }

  var itens = AP_PRECAD_SEG_json_(p.itensSelecionados, []);
  if (!itens.length) {
    return AP_PRECAD_SEG_erro_('SEM_ITENS',
      'O RH não separou nenhum EPI neste pré-cadastro, então não há o que reservar. ' +
      'Abra a aba "EPIs e kits" e escolha os itens.');
  }

  if (typeof AP_Modulo_epigestao !== 'function') {
    return AP_PRECAD_SEG_erro_('SEM_MODULO_EPI',
      'O módulo de gestão de EPI não está instalado neste projeto do Apps Script, ' +
      'então a reserva não pode ser criada. Instale o ALMOXA_PRO_Modulo_EPI.gs.');
  }

  /* o colaborador ainda pode não ter matrícula: a identificação
     provisória (COL-…) é o que segura a reserva até a matrícula
     oficial chegar */
  var identificacao = AP_PRECAD_SEG_texto_(p.identificacao) || AP_PRECAD_SEG_texto_(p.id);
  var token = AP_PRECAD_SEG_texto_(p.token);

  var pedido = {
    codigoColaborador: identificacao,
    matricula: AP_PRECAD_SEG_texto_(p.matricula),
    colaborador: AP_PRECAD_SEG_texto_(p.nome),
    empresa: AP_PRECAD_SEG_texto_(p.empresa),
    obra: AP_PRECAD_SEG_texto_(p.obra),
    setor: AP_PRECAD_SEG_texto_(p.setor),
    funcao: AP_PRECAD_SEG_texto_(p.funcao) || AP_PRECAD_SEG_texto_(p.cargo),
    solicitante: AP_PRECAD_quem_(sessao),
    /* de onde a reserva veio: o processo de entrada. É por este
       campo que a ficha volta a apontar para o pré-cadastro. */
    fichaOrigem: AP_PRECAD_SEG_texto_(p.id),
    tipo: 'ENTREGA',
    observacao: 'Entrada de novo colaborador. Processo ' + AP_PRECAD_SEG_texto_(p.id) +
      (token ? ' · Token ' + token : '') +
      (AP_PRECAD_SEG_texto_(p.kitSelecionado) ? ' · Kit ' + AP_PRECAD_SEG_texto_(p.kitSelecionado) : ''),
    itens: itens.map(function (i) {
      return {
        sku: AP_PRECAD_SEG_texto_(i.sku),
        descricao: AP_PRECAD_SEG_texto_(i.nome || i.descricao),
        tamanho: AP_PRECAD_SEG_texto_(i.tamanho),
        qtd: Number(i.qtd) || 1
      };
    })
  };

  var r;
  try {
    r = AP_Modulo_epigestao('criarReserva', pedido, sessao);
  } catch (e) {
    r = { ok: false, codigo: 'FALHOU', mensagem: e.message };
  }

  var agora = AP_PRECAD_agora_();

  if (!r || !r.ok) {
    var motivo = (r && r.mensagem) || 'O módulo de EPI não respondeu.';
    var detalhe = (r && r.dados && r.dados.recusados) || null;
    if (detalhe) {
      motivo += ' ' + detalhe.map(function (x) {
        return AP_PRECAD_SEG_texto_(x.sku) + ': ' + AP_PRECAD_SEG_texto_(x.motivo);
      }).join('; ') + '.';
    }
    /* fica gravado para aparecer na tela em vez de sumir */
    try {
      AP_Data_update(AP_PRECAD_CFG.aba, p.id, {
        reservaErro: motivo, reservaEm: agora
      }, 'id');
    } catch (e) { }
    AP_PRECAD_auditar_(AP_PRECAD_quem_(sessao), 'PRECADASTRO_RESERVA_RECUSADA', p.id, {
      nome: p.nome, codigo: (r && r.codigo) || 'SEM_RESPOSTA', motivo: motivo
    });
    return AP_PRECAD_SEG_erro_((r && r.codigo) || 'RESERVA_RECUSADA', motivo,
      { recusados: detalhe, itens: pedido.itens.length });
  }

  var protocolo = AP_PRECAD_SEG_texto_(r.dados && r.dados.protocolo);

  /* A reserva nasce SOLICITADA, e o balcão só entrega de APROVADA
     em diante. Pedir uma segunda aprovação aqui não faz sentido: a
     Segurança do Trabalho acabou de validar a pessoa E a lista de
     EPI, e é essa a aprovação. Então avança um passo — pela porta do
     próprio módulo, que registra a mudança na auditoria, nunca
     escrevendo o status na planilha por fora.

     Vai para APROVADA e NÃO para PRONTA_PARA_RETIRADA: separar o
     material continua sendo trabalho do almoxarife, e dizer que
     está pronta sem ninguém ter separado seria mentira na tela. */
  var statusFinal = (r.dados && r.dados.status) || '';
  try {
    var mv = AP_Modulo_epigestao('mudarStatus', {
      protocolo: protocolo, status: 'APROVADA'
    }, sessao);
    if (mv && mv.ok) statusFinal = 'APROVADA';
  } catch (e) { }

  AP_Data_update(AP_PRECAD_CFG.aba, p.id, {
    reservaProtocolo: protocolo, reservaEm: agora, reservaErro: ''
  }, 'id');

  AP_PRECAD_auditar_(AP_PRECAD_quem_(sessao), 'PRECADASTRO_RESERVA_CRIADA', p.id, {
    nome: p.nome, protocolo: protocolo, itens: pedido.itens.length
  });

  return AP_PRECAD_SEG_ok_({
    protocolo: protocolo,
    status: statusFinal,
    validade: (r.dados && r.dados.validade) || '',
    itens: pedido.itens.length,
    token: token
  }, 'Reserva ' + protocolo + ' criada com ' + pedido.itens.length + ' item(ns) no nome de ' +
    AP_PRECAD_SEG_texto_(p.nome) + '. O estoque NÃO foi baixado: a baixa acontece na entrega, ' +
    'no balcão, contra o token' + (token ? ' ' + token : '') + '.');
}

/** Porta para a tela: refazer a reserva que não saiu. */
function AP_PRECAD_SEG_reserva_(payload, sessao) {
  var p = AP_PRECAD_SEG_linha_(payload && payload.id);
  if (!p) return AP_PRECAD_SEG_erro_('NAO_ENCONTRADO', 'Pré-cadastro não localizado.');
  var pode = AP_PRECAD_SEG_pode_(sessao, 'validarSeguranca', p);
  if (!pode.permitido) return AP_PRECAD_SEG_erro_('SEM_PERMISSAO', pode.motivo);
  return AP_PRECAD_SEG_gerarReserva_(p, sessao, false);
}


/* ============================================================
   AS PORTAS NOVAS
   ------------------------------------------------------------
   O AP_Modulo_precadastro original continua inteiro. Esta função
   atende só o que ele não conhecia, e é chamada por ele depois de
   todas as ações antigas — nenhuma foi tocada.
   ============================================================ */

function AP_PRECAD_SEG_atender_(acao, payload, sessao) {
  payload = payload || {};
  switch (String(acao || '')) {
    case 'versao': return AP_PRECAD_SEG_ok_({
      versao: AP_PRECAD_SEG.versao,
      /* a lista do que este arquivo sabe fazer. A tela compara com
         o que ela precisa e avisa se o arquivo estiver velho — em
         vez de deixar o erro aparecer três telas adiante. */
      acoes: ['versao', 'instalarSeguranca', 'conferirAba', 'gerarReserva', 'campos', 'salvarCampos', 'encaminhar',
        'credencial', 'localizar', 'pendentesSeguranca', 'abrirSeguranca', 'itens',
        'salvarItens', 'complementar', 'nrs', 'salvarFoto', 'assinar', 'assinatura',
        'validarSeguranca', 'devolver', 'paraCracha', 'crachaEmitido'],
      /* o que mudou de comportamento e a tela precisa saber */
      cpfNaoTranca: true,
      tokenNoCriar: true,
      criarEncaminhaJunto: true,
      /* o cabeçalho da aba é conferido e completado sozinho antes de
         cada gravação: sem isso o token era gravado numa coluna que
         não existia e se perdia em silêncio */
      colunasAutoReparo: true,
      /* a reserva de EPI nasce quando a Segurança valida */
      reservaNaValidacao: true,
      formatoToken: AP_PRECAD_SEG.prefixoToken + '-ANO-NNNNNN'
    });

    case 'instalarSeguranca': return AP_PRECAD_SEG_instalar_();

    /* SÓ LEITURA: diz o que existe no cabeçalho da aba, sem escrever
       nada. Serve para a tela provar de onde vem o token faltando,
       em vez de acusar o arquivo errado. */
    case 'conferirAba': return AP_PRECAD_SEG_conferirAba_();

    /* refazer a reserva de EPI que não saiu na validação */
    case 'gerarReserva': return AP_PRECAD_SEG_reserva_(payload, sessao);

    case 'campos': return AP_PRECAD_SEG_ok_(AP_PRECAD_SEG_campos_());
    case 'salvarCampos': return AP_PRECAD_SEG_salvarCampos_(payload, sessao);

    case 'encaminhar': return AP_PRECAD_SEG_encaminhar_(payload, sessao);
    case 'credencial': return AP_PRECAD_SEG_credencial_(payload, sessao);

    case 'localizar': return AP_PRECAD_SEG_localizar_(payload, sessao);
    case 'pendentesSeguranca': return AP_PRECAD_SEG_pendentes_(payload, sessao);
    case 'abrirSeguranca': return AP_PRECAD_SEG_abrir_(payload, sessao);

    case 'itens': return AP_PRECAD_SEG_itens_(payload, sessao);
    case 'salvarItens': return AP_PRECAD_SEG_salvarItens_(payload, sessao);

    case 'complementar': return AP_PRECAD_SEG_complementar_(payload, sessao);
    case 'nrs': return AP_PRECAD_SEG_ok_({ nrs: AP_PRECAD_SEG_nrsDisponiveis_() });

    case 'salvarFoto': return AP_PRECAD_SEG_salvarFoto_(payload, sessao);

    case 'assinar': return AP_PRECAD_SEG_assinar_(payload, sessao);
    case 'assinatura': return AP_PRECAD_SEG_verAssinatura_(payload, sessao);

    case 'validarSeguranca': return AP_PRECAD_SEG_validar_(payload, sessao);
    case 'devolver': return AP_PRECAD_SEG_devolver_(payload, sessao);

    case 'paraCracha': return AP_PRECAD_SEG_paraCracha_(payload, sessao);
    case 'crachaEmitido': return AP_PRECAD_SEG_crachaEmitido_(payload, sessao);
  }
  return null; /* não é ação desta etapa */
}


/* ============================================================
   AP_PRECAD_SEG_testes()  —  A PROVA DA ETAPA DE SEGURANÇA
   ------------------------------------------------------------
   Roda contra uma planilha de MENTIRA. Nenhuma aba sua é criada,
   lida ou alterada: a camada de dados é trocada no começo e
   devolvida no finally, aconteça o que acontecer.

   O que está sendo provado, e por quê:

   · o QR leva ID e token e mais nada — um QR fotografado não
     entrega o CPF de ninguém;
   · QR com token errado não abre processo, e a recusa não conta
     qual metade errou, que é o que ensinaria a tentar de novo;
   · o QR localiza, mas quem libera é a permissão de quem está
     lendo: o mesmo QR na mão errada é barrado, e a barrada fica
     na auditoria;
   · o que o RH escondeu não chega na Segurança, e o que o RH
     autorizou chega preenchido — ninguém redigita;
   · nenhum campo é obrigatório por decisão do código: o RH marca
     o que quiser, inclusive nada, e a marcação dele é respeitada;
   · mudar a configuração depois não reescreve o que já foi
     entregue, mas vale para o próximo processo;
   · a etapa anda sozinha conforme o que foi preenchido, para a
     fila não mentir;
   · ASO ausente e ASO INAPTO são coisas diferentes, e as duas
     seguram a validação;
   · o crachá não sai sem a Segurança validar E o administrador
     decidir o acesso — um só dos dois não basta;
   · nada é apagado: devolver guarda o motivo e o registro fica.

   Rode e leia o Registro de execução.
   ============================================================ */

function AP_PRECAD_SEG_testes() {
  var log = [], falhas = 0;
  function ok(nome, cond, detalhe) {
    log.push((cond ? 'PASSOU  ' : 'FALHOU  ') + nome + (detalhe ? '   [' + detalhe + ']' : ''));
    if (!cond) falhas++;
  }

  var tabela = [], auditoria = [], avisos = [], configGuardada = null, seq = 0;

  var orig = {
    get: (typeof AP_Data_getSheet === 'function') ? AP_Data_getSheet : null,
    rows: (typeof AP_Data_rows === 'function') ? AP_Data_rows : null,
    app: (typeof AP_Data_append === 'function') ? AP_Data_append : null,
    upd: (typeof AP_Data_update === 'function') ? AP_Data_update : null,
    aud: (typeof AP_Modulo_auditoria === 'function') ? AP_Modulo_auditoria : null,
    cfg: (typeof AP_Modulo_config === 'function') ? AP_Modulo_config : null,
    not: (typeof AP_Modulo_notificacoes === 'function') ? AP_Modulo_notificacoes : null,
    perm: (typeof AP_PERMISSOES_verificar === 'function') ? AP_PERMISSOES_verificar : null,
    esc: (typeof AP_ORG_validarOperacao === 'function') ? AP_ORG_validarOperacao : null,
    id: AP_PRECAD_id_
  };

  var RH = { nome: 'RH de teste', perfil: 'rh' };
  var SEG = { nome: 'Segurança de teste', perfil: 'seguranca', matricula: '000900' };

  function limpar() {
    tabela = []; auditoria = []; avisos = []; configGuardada = null;
  }
  function chamar(acao, payload, sessao) {
    return AP_Modulo_precadastro(acao, payload || {}, sessao || SEG);
  }
  function novo(extra) {
    var p = {
      nome: 'João da Silva', cpf: '529.982.247-25', cargo: 'Pedreiro',
      obra: 'OBR1', empresa: 'Construtora Teste', matricula: '000777'
    };
    for (var k in (extra || {})) p[k] = extra[k];
    var r = chamar('criar', p, RH);
    return r.dados && r.dados.id;
  }
  function contarAuditoria(acao) {
    return auditoria.filter(function (a) { return a.acao === acao; }).length;
  }

  try {
    AP_PRECAD_id_ = function () { return 'PC-TESTE' + (++seq); };
    AP_Data_getSheet = function () { return {}; };
    AP_Data_rows = function () {
      return tabela.map(function (r) {
        var c = {}; for (var k in r) c[k] = r[k]; return c;
      });
    };
    AP_Data_append = function (aba, reg) {
      var c = {}; for (var k in reg) c[k] = reg[k]; tabela.push(c);
    };
    AP_Data_update = function (aba, id, patch, campo) {
      var alvo = tabela.filter(function (r) {
        return String(r[campo || 'id']) === String(id);
      })[0];
      if (alvo) for (var k in patch) alvo[k] = patch[k];
      return !!alvo;
    };
    AP_Modulo_auditoria = function (acao, p) { auditoria.push(p); return { ok: true }; };
    AP_Modulo_config = function (acao, p) {
      if (acao === 'obter') return { ok: true, dados: configGuardada };
      if (acao === 'salvar') { configGuardada = p.valor; return { ok: true }; }
      return { ok: false };
    };
    AP_Modulo_notificacoes = function (acao, p) {
      if (acao !== 'criar') return { ok: false };
      avisos.push(p); return { ok: true };
    };

    /* ---------- o que já existia continua de pé ---------- */
    limpar();
    var id = novo();
    ok('1  o pré-cadastro antigo continua criando', !!id, id);
    ok('2  listar continua respondendo',
      chamar('listar', {}, RH).dados.totais.aguardando === 1);
    var fichaVelha = chamar('obter', { id }, RH);
    ok('3  obter continua respondendo', fichaVelha.ok && fichaVelha.dados.nome === 'João da Silva');
    ok('4  a ficha agora diz a etapa', fichaVelha.dados.etapa === 'RH', fichaVelha.dados.etapa);
    ok('5  ação desconhecida continua recusada',
      chamar('naoExisteIsso', {}, RH).codigo === 'ACAO_DESCONHECIDA');
    ok('6  a ficha de EPI continua barrada antes da validação',
      chamar('paraFicha', { id }, RH).codigo === 'NAO_VALIDADO');

    /* ---------- o token e o QR ---------- */
    var enc = chamar('encaminhar', { id: id }, RH);
    ok('7  o RH encaminha para a Segurança', enc.ok, enc.mensagem);
    ok('8  nasce um token', !!enc.dados.token, enc.dados.token);
    ok('9  o QR é prefixo + ID + a chave secreta — não o número do token',
      enc.dados.conteudoQR.indexOf(AP_PRECAD_SEG.prefixoQR + ':' + id + ':') === 0 &&
      enc.dados.conteudoQR.indexOf(enc.dados.token) === -1,
      enc.dados.conteudoQR + '  (token ' + enc.dados.token + ')');
    ok('10 o QR NÃO leva CPF nem nome',
      enc.dados.conteudoQR.indexOf('529') === -1 &&
      enc.dados.conteudoQR.toLowerCase().indexOf('silva') === -1);
    ok('11 a etapa virou AGUARDANDO_SEGURANCA',
      enc.dados.etapa === AP_PRECAD_SEG.etapas.SEGURANCA);
    ok('12 a equipe da Segurança foi avisada', enc.dados.notificado === true);
    ok('13 o aviso diz quem, onde e qual processo',
      avisos.length === 1 && avisos[0].texto.indexOf(id) > -1);
    ok('14 não encaminha duas vezes',
      chamar('encaminhar', { id: id }, RH).codigo === 'JA_ENCAMINHADO');
    ok('15 cada processo tem o seu token',
      (function () {
        var outro = novo({ nome: 'Maria Souza', cpf: '390.533.447-05', matricula: '000888' });
        return chamar('encaminhar', { id: outro }, RH).dados.token !== enc.dados.token;
      })());

    /* ---------- achar a pessoa ---------- */
    ok('16 acha pelo nome', chamar('localizar', { busca: 'joão' }, SEG).dados.quantos === 1);
    ok('17 acha pelo ID', chamar('localizar', { busca: id }, SEG).dados.quantos === 1);
    ok('18 acha pela matrícula', chamar('localizar', { busca: '000777' }, SEG).dados.quantos === 1);
    ok('19 acha pelo CPF', chamar('localizar', { busca: '529982' }, SEG).dados.quantos === 1);
    var porQR = chamar('localizar', { qr: enc.dados.conteudoQR }, SEG);
    ok('20 acha pelo QR', porQR.ok && porQR.dados.resultados[0].id === id);
    ok('21 a busca não devolve CPF', porQR.dados.resultados[0].cpf === undefined);
    ok('22 a leitura do QR fica na auditoria', contarAuditoria('PRECADASTRO_QR_LIDO') === 1);
    var qrErrado = chamar('localizar', { qr: AP_PRECAD_SEG.prefixoQR + ':' + id + ':ERRADA' }, SEG);
    ok('23 QR com token errado é recusado', qrErrado.codigo === 'QR_INVALIDO');
    ok('24 e a recusa não conta qual parte errou',
      qrErrado.mensagem.toLowerCase().indexOf('token') === -1, qrErrado.mensagem);
    ok('25 busca vazia é recusada', chamar('localizar', {}, SEG).codigo === 'SEM_BUSCA');

    /* ---------- o QR não libera sozinho ---------- */
    AP_PERMISSOES_verificar = function (perfil, mod, acao) {
      return { permitido: acao === 'abrir' ? perfil === 'seguranca' : true };
    };
    ok('26 com o QR na mão errada, barra',
      !chamar('localizar', { qr: enc.dados.conteudoQR }, RH).ok);
    ok('27 e a barrada fica registrada', contarAuditoria('PRECADASTRO_QR_BARRADO') === 1);
    ok('28 na mão certa, passa', chamar('localizar', { qr: enc.dados.conteudoQR }, SEG).ok);
    AP_PERMISSOES_verificar = orig.perm || undefined;

    /* ---------- o RH escolhe o que enviar ---------- */
    limpar();
    var padrao = chamar('campos', {}, RH);
    ok('29 os campos vêm com um padrão', padrao.ok && padrao.dados.campos.length >= 18);
    ok('30 e o padrão avisa que ninguém configurou ainda', padrao.dados.configurado === false);

    var salvo = chamar('salvarCampos', {
      campos: [
        { campo: 'nome', enviar: true }, { campo: 'obra', enviar: true },
        { campo: 'cpf', enviar: false }, { campo: 'telefone', enviar: false },
        { campo: 'funcao', enviar: true }, { campo: 'cargo', enviar: true },
        { campo: 'empresa', enviar: true }, { campo: 'tamanhoCamisa', enviar: true },
        { campo: 'numeroCalcado', enviar: true }
      ]
    }, RH);
    ok('31 o RH salva a escolha', salvo.ok, salvo.mensagem);
    ok('32 a escolha foi para o config do Core', !!configGuardada && !!configGuardada.campos);
    ok('33 a lista guardada é completa — campo omitido fica como "não enviar"',
      configGuardada.campos.length === AP_PRECAD_SEG.camposPadrao.length,
      configGuardada.campos.length + ' de ' + AP_PRECAD_SEG.camposPadrao.length);

    var id2 = novo();
    chamar('encaminhar', { id: id2 }, RH);
    var aberto = chamar('abrirSeguranca', { id: id2 }, SEG);
    ok('34 a Segurança recebe o que o RH autorizou', aberto.ok && !!aberto.dados.doRH.nome);
    ok('35 e NÃO recebe o que o RH escondeu', aberto.dados.doRH.cpf === undefined);
    ok('36 a tela sabe dizer o que ficou oculto',
      aberto.dados.camposOcultos.length > 0, aberto.dados.camposOcultos.join(', '));
    ok('37 cada campo diz que veio do RH', aberto.dados.doRH.nome.origem === 'RH');
    ok('38 e vem preenchido — a Segurança não redigita',
      aberto.dados.doRH.nome.valor === 'João da Silva');

    chamar('salvarCampos', {
      campos: [{ campo: 'nome', enviar: true }, { campo: 'obra', enviar: true },
        { campo: 'funcao', enviar: false }]
    }, RH);
    ok('39 mudar a configuração não reescreve o que já foi entregue',
      !!chamar('abrirSeguranca', { id: id2 }, SEG).dados.doRH.funcao);
    var id3 = novo({ nome: 'Pedro Lima', cpf: '390.533.447-05', matricula: '000999' });
    chamar('encaminhar', { id: id3 }, RH);
    ok('40 mas o processo novo já sai com a configuração nova',
      chamar('abrirSeguranca', { id: id3 }, SEG).dados.doRH.funcao === undefined);
    ok('41 o RH pode mandar só um campo, se for isso que ele quer',
      (function () {
        chamar('salvarCampos', { campos: [{ campo: 'cpf', enviar: true }] }, RH);
        var enviados = configGuardada.campos.filter(function (c) { return c.enviar; });
        return enviados.length === 1 && enviados[0].campo === 'cpf';
      })());
    ok('42 e nenhum campo nasce obrigatório — quem marca é o RH',
      AP_PRECAD_SEG.camposPadrao.filter(function (c) { return c.obrigatorio; }).length === 0);
    ok('43 campo marcado como obrigatório NÃO tranca o encaminhamento',
      (function () {
        chamar('salvarCampos', { campos: [
          { campo: 'nome', enviar: true }, { campo: 'obra', enviar: true },
          { campo: 'cpf', enviar: true, obrigatorio: true },
          { campo: 'foto', enviar: true, obrigatorio: true }
        ] }, RH);
        var semNada = novo({ nome: 'Sem CPF nem foto', cpf: '', matricula: '000555' });
        var r = chamar('encaminhar', { id: semNada }, RH);
        return r.ok === true && !!r.dados.token;
      })());
    ok('44 mas a resposta diz o que ficou em branco, para a Segurança cobrar',
      (function () {
        var outro = novo({ nome: 'Outro sem CPF', cpf: '', matricula: '000556' });
        var r = chamar('encaminhar', { id: outro }, RH);
        return r.ok && r.dados.emBranco.length >= 1 && /em branco/i.test(r.mensagem);
      })());

    /* ---------- complementar, NRs, ASO ---------- */
    limpar();
    var id4 = novo();
    chamar('encaminhar', { id: id4 }, RH);
    ok('42 complementar sem nada é recusado',
      chamar('complementar', { id: id4 }, SEG).codigo === 'NADA_A_SALVAR');
    var t1 = chamar('complementar', {
      id: id4, treinamentos: [{ nr: 'NR 35', status: 'AGENDADO', data: '2026-10-01' }]
    }, SEG);
    ok('43 treinamento lançado, etapa anda para AGUARDANDO_TREINAMENTO',
      t1.ok && t1.dados.etapa === AP_PRECAD_SEG.etapas.TREINAMENTO, t1.dados.etapa);
    var t2 = chamar('complementar', {
      id: id4, treinamentos: [{ nr: 'NR 35', status: 'CONCLUIDO', validade: '2028-10-01' }]
    }, SEG);
    ok('44 concluído, a etapa vai para o ASO',
      t2.dados.etapa === AP_PRECAD_SEG.etapas.ASO, t2.dados.etapa);
    ok('45 status de treinamento inventado vira NAO_INICIADO',
      (function () {
        chamar('complementar', { id: id4, treinamentos: [{ nr: 'NR 06', status: 'XPTO' }] }, SEG);
        return AP_PRECAD_SEG_json_(tabela[0].treinamentos, [])[0].status === 'NAO_INICIADO';
      })());

    chamar('complementar', {
      id: id4, treinamentos: [{ nr: 'NR 35', status: 'CONCLUIDO' }],
      aso: { situacao: 'INAPTO', data: '2026-09-01' }, tipoSanguineo: 'O+'
    }, SEG);
    var inapto = chamar('validarSeguranca', { id: id4 }, SEG);
    ok('46 ASO INAPTO barra a validação — não é o mesmo que ASO em branco',
      inapto.codigo === 'FALTA_COMPLETAR', inapto.mensagem);

    var t3 = chamar('complementar', {
      id: id4, aso: { situacao: 'APTO', validade: '2027-09-20', medico: 'Dra. Ana' },
      riscos: ['altura'], episObrigatorios: ['cinto', 'capacete']
    }, SEG);
    ok('47 com ASO apto, a etapa vai para validação',
      t3.dados.etapa === AP_PRECAD_SEG.etapas.VALIDACAO, t3.dados.etapa);
    ok('48 e não falta mais nada', t3.dados.pendencias.length === 0);

    /* ---------- validar e liberar ---------- */
    var val = chamar('validarSeguranca', { id: id4 }, SEG);
    ok('49 a Segurança valida', val.ok, val.mensagem);
    ok('50 mas NÃO libera: o administrador ainda não decidiu o acesso',
      val.dados.etapa === AP_PRECAD_SEG.etapas.VALIDADO && val.dados.liberado === false);
    ok('51 e o crachá não sai', chamar('paraCracha', { id: id4 }, SEG).codigo === 'NAO_LIBERADO');

    tabela[0].status = AP_PRECAD_CFG.status.VALIDADO;
    tabela[0].etapa = AP_PRECAD_SEG.etapas.VALIDACAO;
    tabela[0].validadoSegEm = '';
    var val2 = chamar('validarSeguranca', { id: id4 }, SEG);
    ok('52 com o acesso decidido, validar libera',
      val2.dados.etapa === AP_PRECAD_SEG.etapas.LIBERADO && val2.dados.liberado);

    var paraCr = chamar('paraCracha', { id: id4 }, SEG);
    ok('53 o crachá sai com os dados oficiais',
      paraCr.ok && paraCr.dados.emitir.colaborador === 'João da Silva' &&
      paraCr.dados.emitir.obra === 'OBR1');
    ok('54 levando o que a Segurança apurou para o verso',
      paraCr.dados.verso.tipoSanguineo === 'O+' && paraCr.dados.verso.treinamentos.length === 1);
    var emitido = chamar('crachaEmitido', { id: id4, codigo: 'CR-0042' }, SEG);
    ok('55 emitido, o processo fecha',
      emitido.ok && emitido.dados.etapa === AP_PRECAD_SEG.etapas.CRACHA);
    ok('56 o token morre junto', !!tabela[0].tokenUsadoEm);
    ok('57 não emite duas vezes', chamar('paraCracha', { id: id4 }, SEG).codigo === 'JA_EMITIDO');
    ok('58 nem complementa depois',
      chamar('complementar', { id: id4, tipoSanguineo: 'A-' }, SEG).codigo === 'JA_EMITIDO');
    ok('59 a validação ficou na auditoria',
      contarAuditoria('PRECADASTRO_VALIDADO_SEGURANCA') === 2);

    /* ---------- devolver ---------- */
    limpar();
    var id5 = novo();
    var enc5 = chamar('encaminhar', { id: id5 }, RH);
    ok('60 devolver sem motivo é recusado',
      chamar('devolver', { id: id5 }, SEG).codigo === 'SEM_MOTIVO');
    var dev = chamar('devolver', { id: id5, motivo: 'A foto está ilegível' }, SEG);
    ok('61 devolve com motivo', dev.ok && dev.dados.etapa === AP_PRECAD_SEG.etapas.RH);
    ok('62 o motivo fica no registro', tabela[0].devolvidoMotivo === 'A foto está ilegível');
    ok('63 nada foi apagado', !!tabela[0].nome && !!tabela[0].token);
    var re = chamar('encaminhar', { id: id5 }, RH);
    ok('64 o RH reenvia depois de corrigir', re.ok);
    ok('65 e o token continua o mesmo — é o mesmo processo',
      re.dados.token === enc5.dados.token);

    /* ---------- assinatura ---------- */
    ok('66 assinatura vazia é recusada',
      chamar('assinar', { id: id5 }, SEG).codigo === 'SEM_ASSINATURA');
    ok('67 texto qualquer não passa por assinatura',
      chamar('assinar', { id: id5, assinatura: 'joão da silva' }, SEG).codigo === 'ASSINATURA_INVALIDA');
    ok('68 assinatura grande demais é recusada ANTES de gravar',
      chamar('assinar', {
        id: id5, assinatura: 'data:image/png;base64,' + new Array(46001).join('A')
      }, SEG).codigo === 'ASSINATURA_GRANDE');
    ok('69 assinatura válida é registrada',
      chamar('assinar', { id: id5, assinatura: 'data:image/png;base64,AAAA' }, SEG).ok);
    ok('70 e pode ser recuperada depois',
      chamar('assinatura', { id: id5 }, SEG).dados.assinatura === 'data:image/png;base64,AAAA');
    ok('71 o campo da biometria futura existe e está vazio',
      chamar('abrirSeguranca', { id: id5 }, SEG).dados.biometriaId === '');

    /* ---------- fila ---------- */
    limpar();
    var a = novo();
    var b = novo({ nome: 'Maria Souza', cpf: '390.533.447-05', matricula: '000888', obra: 'OBR2' });
    chamar('encaminhar', { id: a }, RH);
    chamar('encaminhar', { id: b }, RH);
    var fila = chamar('pendentesSeguranca', {}, SEG);
    ok('72 a fila mostra os dois', fila.dados.quantos === 2);
    ok('73 a fila separa por etapa',
      fila.dados.porEtapa[AP_PRECAD_SEG.etapas.SEGURANCA] === 2);
    ok('74 a fila filtra por obra',
      chamar('pendentesSeguranca', { obra: 'OBR2' }, SEG).dados.quantos === 1);

    /* ---------- escopo do organograma ---------- */
    AP_ORG_validarOperacao = function (p) {
      return p.alvo.obra === 'OBR1' ? { ok: true } : { ok: false, mensagem: 'Outra obra.' };
    };
    ok('75 dentro do escopo, abre', chamar('abrirSeguranca', { id: a }, SEG).ok);
    ok('76 fora do escopo, barra', !chamar('abrirSeguranca', { id: b }, SEG).ok);
    AP_ORG_validarOperacao = orig.esc || undefined;
    ok('77 sem o organograma instalado, o processo não trava',
      chamar('abrirSeguranca', { id: b }, SEG).ok);

    /* ---------- processo que não existe ---------- */
    var portas = ['encaminhar', 'credencial', 'abrirSeguranca', 'complementar',
      'validarSeguranca', 'devolver', 'paraCracha', 'assinar', 'assinatura'];
    var todasRecusaram = true;
    portas.forEach(function (acao) {
      var r = chamar(acao, { id: 'PC-NAOEXISTE' }, SEG);
      if (!r || r.ok || r.codigo !== 'NAO_ENCONTRADO') todasRecusaram = false;
    });
    ok('78 processo inexistente é recusado em todas as portas, sem explodir', todasRecusaram);

    /* ---------- o número do token, os estados e a validação ---------- */
    limpar();
    var idN = novo();
    var numero = tabela[0].token;
    ok('79l o token tem número legível: TK-ano-sequencial',
      /^TK-\d{4}-\d{6}$/.test(numero), numero);
    ok('79m com a chave secreta separada do número',
      !!tabela[0].tokenChave && tabela[0].tokenChave !== numero, tabela[0].tokenChave);
    ok('79n e nasce no estado GERADO',
      tabela[0].tokenEstado === AP_PRECAD_SEG.estadosToken.GERADO, tabela[0].tokenEstado);
    ok('79o a identificação provisória também nasce: COL-xxxxxx',
      /^COL-\d{6}$/.test(tabela[0].identificacao), tabela[0].identificacao);

    var outroN = novo({ nome: 'Segundo', cpf: '', matricula: '000801' });
    ok('79p dois processos, dois números diferentes',
      tabela[1].token !== numero, numero + ' ≠ ' + tabela[1].token);

    var encN = chamar('encaminhar', { id: idN }, RH);
    ok('79q encaminhado, o token passa a AGUARDANDO_VALIDACAO',
      tabela[0].tokenEstado === AP_PRECAD_SEG.estadosToken.AGUARDANDO, tabela[0].tokenEstado);
    ok('79r e o número NÃO mudou', tabela[0].token === numero, numero);
    ok('79s o QR leva a CHAVE, nunca o número que a pessoa digita',
      encN.dados.conteudoQR.indexOf(tabela[0].tokenChave) > -1 &&
      encN.dados.conteudoQR.indexOf(numero) === -1, encN.dados.conteudoQR);

    chamar('complementar', {
      id: idN, treinamentos: [{ nr: 'NR 35', status: 'CONCLUIDO' }], aso: { situacao: 'APTO' }
    }, SEG);
    var valN = chamar('validarSeguranca', { id: idN }, { nome: 'Carlos Alberto Lima',
      perfil: 'seguranca', email: 'carlos.lima@empresa.com' });
    ok('79t validado, o token vira ATIVO_PARA_ENTREGA',
      tabela[0].tokenEstado === AP_PRECAD_SEG.estadosToken.ATIVO, tabela[0].tokenEstado);
    ok('79u e continua sendo o MESMO número', tabela[0].token === numero, numero);
    ok('79v a validação grava quem validou', valN.dados.validadoPor === 'Carlos Alberto Lima');
    ok('79w com o e-mail do usuário autenticado, não digitado',
      valN.dados.validadoEmail === 'carlos.lima@empresa.com' &&
      tabela[0].validadoSegEmail === 'carlos.lima@empresa.com', tabela[0].validadoSegEmail);
    ok('79x e com data e hora', !!valN.dados.validadoEm);
    ok('79y o RH é avisado da validação',
      avisos.filter(function (a) { return /concluída/i.test(a.titulo); }).length === 1,
      avisos.map(function (a) { return a.titulo; }).join(' | '));
    ok('79z o pré-cadastro do RH passa a mostrar quem validou',
      chamar('obter', { id: idN }, RH).dados.validadoSegEmail === 'carlos.lima@empresa.com');

    var fila = chamar('pendentesSeguranca', {}, SEG);
    ok('79aa a fila separa aguardando de validados',
      fila.dados.quantos === 0 && fila.dados.validados.length === 1,
      fila.dados.quantos + ' aguardando · ' + fila.dados.validados.length + ' validado(s)');
    ok('79ab e o validado leva o token e quem validou',
      fila.dados.validados[0].token === numero &&
      fila.dados.validados[0].validadoEmail === 'carlos.lima@empresa.com');

    /* ---------- a foto e o cabeçalho da ficha ---------- */
    limpar();
    var idF = novo();
    chamar('encaminhar', { id: idF }, RH);
    var fichaSemFoto = chamar('abrirSeguranca', { id: idF }, SEG);
    ok('80 a ficha traz o cabeçalho: quem lançou e quando',
      fichaSemFoto.dados.cabecalho.criadoPor === 'RH de teste' &&
      !!fichaSemFoto.dados.cabecalho.criadoEm,
      JSON.stringify(fichaSemFoto.dados.cabecalho.criadoPor));
    ok('81 e diz que o token está aguardando validação',
      fichaSemFoto.dados.token.tem === true &&
      fichaSemFoto.dados.token.situacao === 'AGUARDANDO_VALIDACAO',
      fichaSemFoto.dados.token.situacao);
    ok('82 a ficha começa sem foto', fichaSemFoto.dados.fotoAtual === '');

    ok('83 texto no lugar de foto é recusado',
      chamar('salvarFoto', { id: idF, foto: 'foto do joão' }, SEG).codigo === 'FOTO_INVALIDA');
    ok('84 foto grande demais é recusada ANTES de gravar',
      chamar('salvarFoto', {
        id: idF, foto: 'data:image/jpeg;base64,' + new Array(46001).join('A')
      }, SEG).codigo === 'FOTO_GRANDE');
    var posta = chamar('salvarFoto', { id: idF, foto: 'data:image/jpeg;base64,AAAA' }, SEG);
    ok('85 a Segurança acrescenta a foto que faltava', posta.ok && posta.dados.trocada === false);
    ok('86 e ela entra no MESMO registro — nenhum cadastro novo',
      tabela.length === 1 && tabela[0].foto === 'data:image/jpeg;base64,AAAA', tabela.length + ' linha(s)');
    ok('87 a ficha passa a mostrar a foto',
      chamar('abrirSeguranca', { id: idF }, SEG).dados.fotoAtual === 'data:image/jpeg;base64,AAAA');
    ok('88 trocar a foto depois é reconhecido como troca',
      chamar('salvarFoto', { id: idF, foto: 'data:image/png;base64,BBBB' }, SEG).dados.trocada === true);
    ok('89 e fica registrado na auditoria',
      contarAuditoria('PRECADASTRO_FOTO_ACRESCENTADA') === 1 &&
      contarAuditoria('PRECADASTRO_FOTO_TROCADA') === 1);

    chamar('complementar', {
      id: idF, treinamentos: [{ nr: 'NR 35', status: 'CONCLUIDO' }],
      aso: { situacao: 'APTO' }
    }, SEG);
    chamar('validarSeguranca', { id: idF }, SEG);
    ok('90 depois de validado, o token vira ATIVO — o mesmo token',
      chamar('abrirSeguranca', { id: idF }, SEG).dados.token.situacao === 'ATIVO');
    ok('91 e o token não foi trocado no caminho',
      chamar('credencial', { id: idF }, SEG).dados.token === tabela[0].token);

    /* ---------- os EPIs e kits que o RH separou ---------- */
    limpar();
    var idI = novo();
    var comItens = chamar('salvarItens', {
      id: idI,
      kit: 'KIT INTEGRACAO',
      itens: [
        { sku: 'BOT-41', nome: 'Bota de segurança', tamanho: '41', unidade: 'par', categoria: 'EPI', qtd: 1, kit: 'KIT INTEGRACAO' },
        { sku: 'CAM-M', nome: 'Camiseta', tamanho: 'M', unidade: 'un', categoria: 'Uniforme', qtd: 2, kit: 'KIT INTEGRACAO' },
        { sku: 'CAP-01', nome: 'Capacete', unidade: 'un', categoria: 'EPI', qtd: 1 }
      ]
    }, RH);
    ok('80 o RH separa os EPIs e o kit', comItens.ok, comItens.mensagem);
    ok('81 cada item guarda o próprio SKU',
      comItens.dados.itens.map(function (i) { return i.sku; }).join(',') === 'BOT-41,CAM-M,CAP-01',
      comItens.dados.itens.map(function (i) { return i.sku; }).join(','));
    ok('82 e de qual kit veio', comItens.dados.itens[0].kit === 'KIT INTEGRACAO');
    ok('83 o total soma as quantidades', comItens.dados.total === 4, comItens.dados.total);

    var doisTamanhos = chamar('salvarItens', {
      id: idI,
      itens: [
        { sku: 'BOT-40', nome: 'Bota de segurança', tamanho: '40', qtd: 1 },
        { sku: 'BOT-41', nome: 'Bota de segurança', tamanho: '41', qtd: 1 }
      ]
    }, RH);
    ok('84 BOTA 40 e BOTA 41 continuam sendo duas coisas',
      doisTamanhos.dados.itens.length === 2,
      doisTamanhos.dados.itens.map(function (i) { return i.sku; }).join(','));

    var repetido = chamar('salvarItens', {
      id: idI,
      itens: [
        { sku: 'CAP-01', nome: 'Capacete', qtd: 1 },
        { sku: 'CAP-01', nome: 'Capacete', qtd: 2 }
      ]
    }, RH);
    ok('85 o mesmo SKU duas vezes vira uma linha com a soma',
      repetido.dados.itens.length === 1 && repetido.dados.itens[0].qtd === 3,
      JSON.stringify(repetido.dados.itens));

    var semSku = chamar('salvarItens', {
      id: idI, itens: [{ nome: 'Coisa sem código', qtd: 1 }]
    }, RH);
    ok('86 item sem SKU não entra — não existe no estoque',
      semSku.ok && semSku.dados.itens.length === 0);

    var qtdRuim = chamar('salvarItens', {
      id: idI, itens: [{ sku: 'CAP-01', nome: 'Capacete', qtd: 0 }]
    }, RH);
    ok('87 quantidade zero ou vazia vira 1, em vez de sumir',
      qtdRuim.dados.itens.length === 1 && qtdRuim.dados.itens[0].qtd === 1);

    chamar('salvarItens', {
      id: idI, kit: 'KIT OBRA',
      itens: [{ sku: 'CAP-01', nome: 'Capacete', qtd: 1, kit: 'KIT OBRA' }]
    }, RH);
    chamar('encaminhar', { id: idI }, RH);
    var vistoPelaSeg = chamar('abrirSeguranca', { id: idI }, SEG);
    ok('88 a Segurança vê o que o RH separou',
      vistoPelaSeg.ok && vistoPelaSeg.dados.itens.length === 1 &&
      vistoPelaSeg.dados.itens[0].sku === 'CAP-01');
    ok('89 e vê de qual kit', vistoPelaSeg.dados.kit === 'KIT OBRA', vistoPelaSeg.dados.kit);

    var lidos = chamar('itens', { id: idI }, SEG);
    ok('90 a lista pode ser lida sozinha', lidos.ok && lidos.dados.total === 1);

    /* mandar itens junto do encaminhamento, sem salvar antes */
    var idJ = novo({ nome: 'Direto', cpf: '111.444.777-35', matricula: '000666' });
    var encComItens = chamar('encaminhar', {
      id: idJ, kit: 'KIT INTEGRACAO',
      itens: [{ sku: 'LUV-P', nome: 'Luva', tamanho: 'P', qtd: 1 }]
    }, RH);
    ok('91 dá para mandar a lista junto do encaminhamento', encComItens.ok);
    ok('92 e ela chega lá',
      chamar('abrirSeguranca', { id: idJ }, SEG).dados.itens[0].sku === 'LUV-P');

    /* ---------- o token não depende de mais ninguém ---------- */
    limpar();
    var guardaChave = (typeof AP_CR_chave_ === 'function') ? AP_CR_chave_ : null;
    try {
      AP_CR_chave_ = undefined;
      var idSem = novo();
      ok('79 sem o módulo de crachá, o token nasce do mesmo jeito',
        !!AP_PRECAD_SEG_texto_(tabela[0].token), tabela[0].token);
      var encSem = chamar('encaminhar', { id: idSem }, RH);
      ok('79b e o encaminhamento não para por causa disso', encSem.ok, encSem.mensagem);
      ok('79c a chave do QR tem 8 caracteres, sem letra que se confunde com número',
        /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(tabela[0].tokenChave), tabela[0].tokenChave);
    } finally {
      if (guardaChave) AP_CR_chave_ = guardaChave;
    }

    /* ---------- o token nasce com a ficha, antes de encaminhar ---------- */
    limpar();
    var idT = novo();
    ok('79d o token existe assim que a ficha é criada',
      !!AP_PRECAD_SEG_texto_(tabela[0].token), tabela[0].token);
    ok('79e e a etapa já nasce marcada como RH', tabela[0].etapa === 'RH');
    var tokenDoNascimento = tabela[0].token;
    chamar('encaminhar', { id: idT }, RH);
    ok('79f encaminhar NÃO troca o token — é o mesmo do começo ao fim',
      tabela[0].token === tokenDoNascimento, tokenDoNascimento + ' → ' + tabela[0].token);

    /* ---------- criar e encaminhar numa chamada só ---------- */
    limpar();
    var juntos = chamar('criar', {
      nome: 'Tudo de uma vez', cpf: '', cargo: '', obra: '',
      encaminharAgora: true,
      itens: [{ sku: 'CAP-01', nome: 'Capacete', qtd: 1 }],
      kit: 'KIT OBRA'
    }, RH);
    ok('79g uma chamada só cria, gera o token e encaminha',
      juntos.ok && juntos.dados.criado === true && !!juntos.dados.token, juntos.dados.token);
    ok('79h a etapa já sai como AGUARDANDO_SEGURANCA',
      juntos.dados.etapa === AP_PRECAD_SEG.etapas.SEGURANCA, juntos.dados.etapa);
    ok('79i e o QR já vem montado, com a chave',
      juntos.dados.conteudoQR.indexOf(AP_PRECAD_SEG.prefixoQR + ':' + juntos.dados.id + ':') === 0,
      juntos.dados.conteudoQR);
    ok('79i2 e o número do token está no formato legível',
      /^TK-\d{4}-\d{6}$/.test(juntos.dados.token), juntos.dados.token);
    ok('79j os EPIs foram junto na mesma chamada',
      chamar('itens', { id: juntos.dados.id }, RH).dados.itens.length === 1);
    ok('79k e a ficha aparece na fila da Segurança',
      chamar('pendentesSeguranca', {}, SEG).dados.quantos === 1);

  } finally {
    AP_PRECAD_id_ = orig.id;
    if (orig.get) AP_Data_getSheet = orig.get;
    if (orig.rows) AP_Data_rows = orig.rows;
    if (orig.app) AP_Data_append = orig.app;
    if (orig.upd) AP_Data_update = orig.upd;
    if (orig.aud) AP_Modulo_auditoria = orig.aud;
    if (orig.cfg) AP_Modulo_config = orig.cfg;
    if (orig.not) AP_Modulo_notificacoes = orig.not;
    if (orig.perm) AP_PERMISSOES_verificar = orig.perm;
    if (orig.esc) AP_ORG_validarOperacao = orig.esc;
  }

  log.push('');
  log.push(falhas ? '>>> ' + falhas + ' TESTE(S) FALHARAM' : '>>> TODOS OS TESTES PASSARAM');
  log.push('');
  log.push('Nada foi lido nem gravado na sua planilha: a camada de dados');
  log.push('foi trocada por uma de mentira e devolvida no fim.');

  var texto = log.join('\n');
  try { Logger.log(texto); } catch (e) { }
  try { console.log(texto); } catch (e) { }
  return texto;
}


/* ============================================================
   TESTE PONTA A PONTA — NA PLANILHA DE VERDADE
   ------------------------------------------------------------
   AP_PRECAD_testes() e AP_PRECAD_SEG_testes() não tocam na
   planilha: trocam a camada de dados por uma de mentira. Isso
   prova a LÓGICA e não prova a GRAVAÇÃO — e o problema estava
   justamente na gravação.

   Esta função roda no dado real. Ela cria uma ficha de teste,
   finaliza como o RH finaliza, RELÊ A LINHA DA PLANILHA, e responde
   uma por uma as treze perguntas da lista. No fim, arquiva a ficha
   de teste (status EXCLUIDO, etapa EXCLUIDO) — não apaga linha
   nenhuma, o histórico fica.

   Rode direto no editor do Apps Script: escolha
   AP_PRECAD_PONTA_A_PONTA e clique em Executar. O resultado sai no
   Registro de execução.
   ============================================================ */

function AP_PRECAD_PONTA_A_PONTA() {
  var log = [];
  var marcas = [];
  function d(t) { log.push(t); }
  function item(rotulo, passou, detalhe) {
    marcas.push(!!passou);
    d((passou ? '[ok]   ' : '[FALHA]') + ' ' + rotulo + (detalhe ? '  ->  ' + detalhe : ''));
  }

  d('============================================================');
  d('PONTA A PONTA  ·  PRE-CADASTRO -> TOKEN -> FILA DA SEGURANCA');
  d('modulo ' + AP_PRECAD_CFG.versao + '  /  fluxo ' + AP_PRECAD_SEG.versao);
  d('============================================================');
  d('');

  /* ---------- 0. O CABEÇALHO DA ABA ----------
     Antes de qualquer coisa: as colunas novas existem na planilha?
     Se não existirem, o append grava no vazio e o token se perde. */
  d('--- 0. CABECALHO DA ABA ' + AP_PRECAD_CFG.aba + ' ---');
  var cabAntes = [];
  try {
    var ss0 = SpreadsheetApp.getActiveSpreadsheet();
    var ab0 = ss0.getSheetByName(AP_PRECAD_CFG.aba);
    if (ab0 && ab0.getLastColumn() > 0) {
      cabAntes = ab0.getRange(1, 1, 1, ab0.getLastColumn()).getValues()[0]
        .map(function (c) { return String(c).trim(); });
    }
  } catch (e) { d('nao consegui ler o cabecalho: ' + e.message); }

  var faltavam = AP_PRECAD_CFG.colunas.filter(function (c) { return cabAntes.indexOf(c) === -1; });
  d('colunas no cabecalho ANTES: ' + cabAntes.length);
  d('colunas que o modulo espera: ' + AP_PRECAD_CFG.colunas.length);
  if (!cabAntes.length) {
    d('a aba nao existe ou esta sem cabecalho — vai ser criada agora.');
  } else if (faltavam.length) {
    d('FALTAVAM ' + faltavam.length + ' coluna(s): ' + faltavam.join(', '));
    d('>>> ESTA ERA A QUEBRA: o AP_Data_append gravava esses campos em');
    d('>>> colunas que nao existiam no cabecalho, e eles se perdiam em');
    d('>>> silencio. A ficha salvava, a resposta trazia o token, e ao');
    d('>>> reler a linha nao havia token nenhum.');
  } else {
    d('nenhuma coluna faltando — o cabecalho ja estava completo.');
  }

  var rep = AP_PRECAD_SEG_garantirColunas_(true);
  if (rep.erro) d('reparo: ' + rep.erro);
  d('reparo: ' + rep.acrescentadas.length + ' coluna(s) acrescentada(s) no fim.');
  if (rep.acrescentadas.length) d('  ' + rep.acrescentadas.join(', '));
  d('');

  /* ---------- 1. CRIAR + FINALIZAR, do jeito que a tela faz ---------- */
  var marcaTeste = 'ZZ TESTE PONTA A PONTA ' + new Date().getTime();
  var sessao = { nome: 'Teste ponta a ponta', usuario: 'teste', email: '', perfil: 'admin' };

  d('--- 1. RH FINALIZA (criar com encaminharAgora, uma chamada) ---');
  d('nome da ficha de teste: ' + marcaTeste);

  var resposta;
  try {
    resposta = AP_Modulo_precadastro('criar', {
      nome: marcaTeste,
      cargo: 'Teste',
      funcao: 'Teste',
      obra: '',
      cpf: '',
      rg: '',
      encaminharAgora: true,
      itens: [{ sku: 'TESTE-SKU-1', nome: 'Bota de seguranca', tamanho: '41', qtd: 1, unidade: 'par' }]
    }, sessao);
  } catch (e) {
    resposta = { ok: false, codigo: 'EXCECAO', mensagem: e.message };
    d('EXCECAO ao criar: ' + e.message);
  }

  d('resposta.ok = ' + (resposta && resposta.ok));
  d('resposta.codigo = ' + (resposta && resposta.codigo || '-'));
  d('resposta.mensagem = ' + String((resposta && resposta.mensagem) || '-').slice(0, 200));
  var dd = (resposta && resposta.dados) || {};
  d('resposta.dados.id = ' + (dd.id || '-'));
  d('resposta.dados.token = ' + (dd.token || '-'));
  d('resposta.dados.etapa = ' + (dd.etapa || '-'));
  if (dd.naoEncaminhou) d('NAO ENCAMINHOU: ' + dd.naoEncaminhou + ' [' + dd.codigoEncaminhar + ']');
  d('');

  if (!resposta || !resposta.ok || !dd.id) {
    d('--- PAREI AQUI ---');
    d('A criacao nao concluiu, entao nao ha o que conferir adiante.');
    d('Conserte este ponto antes de olhar qualquer tela.');
    return AP_PRECAD_PONTA_A_PONTA_fim_(log, marcas);
  }

  var id = dd.id;
  var tokenRespondido = String(dd.token || '');

  /* ---------- 2. RELER A LINHA DA PLANILHA ---------- */
  d('--- 2. RELENDO A LINHA GRAVADA (nao a resposta) ---');
  var linha = null;
  try { linha = AP_PRECAD_SEG_linha_(id); } catch (e) { d('EXCECAO ao reler: ' + e.message); }
  if (!linha) {
    d('a linha nao foi encontrada na planilha depois de gravada.');
  } else {
    ['id', 'nome', 'status', 'etapa', 'token', 'tokenEstado', 'tokenChave',
      'identificacao', 'itensSelecionados'].forEach(function (c) {
        d('  ' + c + ' = ' + String(linha[c] === undefined ? '(coluna ausente)' : linha[c]).slice(0, 90));
      });
  }
  d('');

  /* ---------- 3. A FILA DA SEGURANCA ---------- */
  d('--- 3. A FILA DA SEGURANCA ---');
  var fila = null;
  try { fila = AP_Modulo_precadastro('pendentesSeguranca', {}, sessao); }
  catch (e) { d('EXCECAO na fila: ' + e.message); }
  var naFila = null;
  if (fila && fila.ok) {
    d('a fila respondeu com ' + fila.dados.quantos + ' processo(s).');
    naFila = (fila.dados.processos || []).filter(function (p) { return p.id === id; })[0] || null;
  } else {
    d('a fila nao respondeu: ' + ((fila && fila.codigo) || '?') + ' ' + ((fila && fila.mensagem) || ''));
  }
  d('a ficha de teste esta na fila? ' + (naFila ? 'SIM' : 'NAO'));
  if (naFila) {
    d('  fila.id = ' + naFila.id);
    d('  fila.token = ' + (naFila.token || '-'));
    d('  fila.etapa = ' + (naFila.etapa || '-'));
  }
  d('');

  /* ---------- 4. A CREDENCIAL (o que o modal do token mostra) ---------- */
  d('--- 4. CREDENCIAL / MODAL DO TOKEN ---');
  var cred = null;
  try { cred = AP_Modulo_precadastro('credencial', { id: id }, sessao); }
  catch (e) { d('EXCECAO na credencial: ' + e.message); }
  if (cred && cred.ok) {
    d('credencial.token = ' + cred.dados.token);
    d('credencial.conteudoQR = ' + String(cred.dados.conteudoQR || '-').slice(0, 60));
  } else {
    d('a credencial nao respondeu: ' + ((cred && cred.codigo) || '?') + ' ' + ((cred && cred.mensagem) || ''));
  }
  d('');

  /* ---------- 5. A LISTA DE 13 ---------- */
  d('--- 5. A LISTA DE VERIFICACAO ---');
  var tokenGravado = linha ? String(linha.token || '') : '';
  var etapaGravada = linha ? String(linha.etapa || '') : '';
  var itensGravados = linha ? String(linha.itensSelecionados || '') : '';

  item('Registro foi salvo?', !!linha, linha ? 'linha lida de volta da planilha' : 'nao achei a linha');
  item('ID do Pre-Cadastro foi criado?', !!id, id);
  item('EPIs foram salvos?', itensGravados.indexOf('TESTE-SKU-1') > -1,
    itensGravados ? itensGravados.slice(0, 70) : 'coluna itensSelecionados vazia');
  item('Pre-reserva foi salva?', itensGravados.indexOf('TESTE-SKU-1') > -1,
    'a pre-reserva e a propria lista de itens separados');
  item('Token foi gerado?', !!tokenRespondido, tokenRespondido || 'a resposta nao trouxe token');
  item('Token foi gravado no banco?', !!tokenGravado,
    tokenGravado || 'a coluna token voltou vazia da planilha');
  item('Token retornou para o frontend?', !!tokenRespondido, tokenRespondido);
  item('Modal do Token apareceu?', !!(cred && cred.ok && cred.dados.token),
    (cred && cred.ok) ? 'a acao credencial devolveu o token, que e o que o modal le'
      : 'a credencial nao respondeu, entao o modal nao teria o que mostrar');
  item('Status virou AGUARDANDO_VALIDACAO_SEGURANCA?',
    etapaGravada === AP_PRECAD_SEG.etapas.SEGURANCA ||
    etapaGravada === AP_PRECAD_SEG.etapas.VALIDACAO,
    'etapa gravada = ' + (etapaGravada || '(vazia)') +
    '  (a etapa do processo e esta coluna; a coluna status guarda o ACESSO: ' +
    (linha ? String(linha.status || '') : '?') + ')');
  item('Registro entrou na fila da Seguranca?', !!naFila,
    naFila ? 'achei na resposta de pendentesSeguranca' : 'nao esta na fila');
  item('Seguranca consegue localizar o colaborador?',
    !!(naFila && String(naFila.nome || '').indexOf('TESTE PONTA A PONTA') > -1),
    naFila ? String(naFila.nome || '') : '-');
  item('O mesmo ID aparece nos dois lados?', !!(naFila && naFila.id === id),
    'RH: ' + id + '  /  Seguranca: ' + ((naFila && naFila.id) || '-'));
  item('O mesmo TOKEN aparece nos dois lados?',
    !!(tokenRespondido && naFila && String(naFila.token || '') === tokenRespondido &&
      tokenGravado === tokenRespondido),
    'respondido: ' + (tokenRespondido || '-') +
    '  /  gravado: ' + (tokenGravado || '-') +
    '  /  fila: ' + ((naFila && naFila.token) || '-'));
  d('');

  /* ---------- 6. ARQUIVAR A FICHA DE TESTE ---------- */
  d('--- 6. LIMPEZA ---');
  try {
    AP_Data_update(AP_PRECAD_CFG.aba, id, {
      status: 'EXCLUIDO',
      etapa: 'EXCLUIDO',
      observacao: 'Ficha criada pelo teste ponta a ponta e arquivada no fim do teste.',
      atualizadoEm: AP_PRECAD_agora_(),
      atualizadoPor: 'teste ponta a ponta'
    }, 'id');
    d('a ficha de teste ' + id + ' foi marcada EXCLUIDO — a linha continua na');
    d('planilha, com o historico, e saiu da fila da Seguranca.');
  } catch (e) {
    d('NAO consegui arquivar a ficha de teste ' + id + ': ' + e.message);
    d('marque a mao como EXCLUIDO, ou apague a linha.');
  }

  return AP_PRECAD_PONTA_A_PONTA_fim_(log, marcas);
}

function AP_PRECAD_PONTA_A_PONTA_fim_(log, marcas) {
  var falhas = marcas.filter(function (m) { return !m; }).length;
  log.push('');
  log.push('============================================================');
  log.push(falhas
    ? '>>> ' + falhas + ' DE ' + marcas.length + ' ITEM(NS) FALHARAM — a cadeia para no primeiro [FALHA] acima.'
    : '>>> OS ' + marcas.length + ' ITENS PASSARAM — a cadeia esta inteira: RH -> banco -> token -> fila.');
  log.push('============================================================');
  var texto = log.join('\n');
  try { Logger.log(texto); } catch (e) { }
  try { console.log(texto); } catch (e) { }
  return texto;
}
