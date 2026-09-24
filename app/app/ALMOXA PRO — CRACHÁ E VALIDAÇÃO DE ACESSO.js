/* ============================================================
   ALMOXA PRO — CRACHÁ E VALIDAÇÃO DE ACESSO
   ------------------------------------------------------------
   O crachá é a identidade do colaborador dentro do sistema. Ele
   substitui a senha decorada — que na obra vira papel no bolso,
   emprestada, esquecida — por uma coisa que a pessoa já carrega
   no peito e que tem dono.

   A REGRA QUE SUSTENTA TUDO

   Entrar no sistema NÃO é ter permissão para tudo. São duas
   perguntas separadas, e o Core responde as duas:

       1. QUEM É?        o crachá diz, e o Core confere
       2. PODE ISSO?     a ação pedida é comparada com o nível
                         do colaborador, uma por uma

   Um colaborador que só pode solicitar consegue abrir o sistema
   e consegue solicitar. Se tentar aprovar, o Core recusa — e
   registra a tentativa. Nenhum módulo decide isso por conta
   própria: quem decide é aqui.

   O QUE VAI NO QR CODE

   Só duas coisas: o código do crachá e uma chave aleatória.
   Nada de nome, CPF, senha ou digital. Um QR fotografado por
   estranho não entrega dado de ninguém — e sem o par
   código+chave batendo com o que está gravado aqui, não abre.

   CRACHÁ PERDIDO

   Reemitir cria um crachá NOVO e derruba o antigo na mesma hora.
   O que sumiu para de funcionar — é o motivo de existir uma
   chave, e não só um número sequencial que qualquer um imprime.

   Rode AP_CRACHA_testes() para conferir a lógica sem tocar em dado.
   ============================================================ */

var AP_CR_CFG = {
  versao: '1.0.0',

  abas: {
    crachas: 'ALMOXA_CRACHAS',
    acessos: 'ALMOXA_CRACHA_ACESSOS'
  },

  colunas: {
    crachas: ['codigo', 'chave', 'matricula', 'colaborador', 'cpf', 'funcao',
      'setor', 'unidade', 'obra', 'admissao', 'tipoAcesso', 'nivel', 'foto',
      'status', 'validade', 'emitidoEm', 'emitidoPor', 'via',
      'revogadoEm', 'revogadoPor', 'motivoRevogacao', 'ultimoAcesso', 'observacao'],
    acessos: ['id', 'data', 'codigo', 'matricula', 'colaborador', 'origem',
      'acao', 'resultado', 'motivo', 'dispositivo']
  },

  status: {
    ATIVO: 'ATIVO',
    BLOQUEADO: 'BLOQUEADO',
    REVOGADO: 'REVOGADO',
    VENCIDO: 'VENCIDO'
  },

  /**
   * OS NÍVEIS DE PERMISSÃO
   * ------------------------------------------------------------
   * Cada nível carrega a lista do que a pessoa pode fazer. É uma
   * lista, e não uma hierarquia de números, de propósito: assim
   * dá para ter um conferente que inventaria mas não retira, sem
   * precisar dar a ele tudo que vem "abaixo" de aprovar.
   */
  niveis: {
    SOLICITAR: {
      nome: 'Somente solicitar',
      acoes: ['identificar', 'consultar', 'solicitar']
    },
    SOLICITAR_DEVOLVER: {
      nome: 'Solicitar e devolver',
      acoes: ['identificar', 'consultar', 'solicitar', 'devolver', 'retirar']
    },
    SOLICITAR_APROVACAO: {
      nome: 'Solicitar e aguardar aprovação',
      acoes: ['identificar', 'consultar', 'solicitar', 'devolver']
    },
    APROVAR: {
      nome: 'Aprovar solicitações',
      acoes: ['identificar', 'consultar', 'solicitar', 'devolver', 'retirar',
        'aprovar', 'reservar']
    },
    ALMOXARIFE: {
      nome: 'Operação do almoxarifado',
      acoes: ['identificar', 'consultar', 'solicitar', 'devolver', 'retirar',
        'reservar', 'entregarEPI', 'retirarFerramenta', 'inventariar', 'lancarNota']
    },
    ADMIN: {
      nome: 'Administrativo',
      acoes: ['*']
    }
  },

  /** As ações que o sistema conhece, com nome de gente */
  acoes: {
    identificar: 'Entrar no sistema',
    consultar: 'Consultar informações',
    solicitar: 'Fazer solicitação',
    reservar: 'Reservar material',
    retirar: 'Retirar material',
    devolver: 'Devolver material',
    aprovar: 'Aprovar solicitações',
    entregarEPI: 'Entregar EPI',
    retirarFerramenta: 'Retirar ferramenta',
    inventariar: 'Fazer inventário',
    lancarNota: 'Lançar nota fiscal',
    administrar: 'Administrar o sistema'
  },

  /* o que o QR carrega — nada além disto */
  prefixoQR: 'ALMOXA:CR',

  /**
   * O TETO DA FOTO
   * ------------------------------------------------------------
   * A foto é guardada como texto (base64) numa célula da planilha,
   * e célula do Google Sheets não passa de 50.000 caracteres. Uma
   * foto de celular passa disso com folga: a gravação falhava calada
   * e o crachá saía sem rosto.
   *
   * A tela já encolhe a imagem antes de mandar. Este teto é a
   * segunda tranca — se vier grande mesmo assim, o Core diz o que
   * houve em vez de perder a foto no caminho.
   */
  limiteFotoCaracteres: 45000,

  validadePadraoMeses: 24
};


/* ============================================================
   ENTRADA DO MÓDULO
   ============================================================ */

function AP_Modulo_cracha(acao, payload, sessao) {
  payload = payload || {};
  try {
    switch (acao) {
      /* --- o crachá --- */
      case 'emitir': return AP_CR_emitir_(payload, sessao);
      case 'listar': return { ok: true, dados: AP_CR_listar_(payload) };
      case 'obter': return AP_CR_obter_(payload);
      case 'revogar': return AP_CR_revogar_(payload, sessao);
      case 'bloquear': return AP_CR_bloquear_(payload, sessao);
      case 'desbloquear': return AP_CR_desbloquear_(payload, sessao);
      case 'reemitir': return AP_CR_reemitir_(payload, sessao);
      case 'atualizar': return AP_CR_atualizar_(payload, sessao);

      /* --- a validação: o coração do módulo --- */
      case 'validar': return AP_CR_validar_(payload);
      case 'autorizar': return AP_CR_autorizar_(payload);

      /* --- permissões e auditoria --- */
      case 'niveis': return { ok: true, dados: AP_CR_niveis_() };
      case 'acessos': return { ok: true, dados: AP_CR_acessos_(payload) };
      case 'painel': return { ok: true, dados: AP_CR_painel_(payload) };
      case 'semCracha': return { ok: true, dados: AP_CR_semCrachaLista_() };

      /* --- a estação de leitura --- */
      case 'estacao': return { ok: true, dados: AP_CR_estacao_() };
      case 'configurarEstacao': return AP_CR_configurarEstacao_(payload);

      /* --- socorro quando a planilha não colabora --- */
      case 'diagnostico': return { ok: true, dados: AP_CR_diagnostico_() };
      case 'corrigirColunas': return AP_CR_corrigirColunas_();
    }
    return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'cracha.' + acao + ' não existe.' };
  } catch (e) {
    try { console.error('[CRACHA] ' + acao + ': ' + e.message); } catch (x) { }
    return { ok: false, codigo: 'CRACHA_ERRO', mensagem: e.message };
  }
}


/* ============================================================
   APOIO
   ============================================================ */

function AP_CR_linhas_(aba) {
  try { return AP_Data_rows(aba) || []; } catch (e) { return []; }
}

function AP_CR_abas_() {
  try {
    AP_Data_getSheet(AP_CR_CFG.abas.crachas, AP_CR_CFG.colunas.crachas);
    AP_Data_getSheet(AP_CR_CFG.abas.acessos, AP_CR_CFG.colunas.acessos);
  } catch (e) { }
}

function AP_CR_agora_() { return new Date().toISOString(); }

function AP_CR_quem_(sessao) {
  return (sessao && (sessao.nome || sessao.usuario || sessao.email)) || 'sistema';
}

/**
 * A chave do crachá. É ela que impede alguém de imprimir um QR
 * com um número sequencial qualquer e entrar no lugar de outro.
 */
function AP_CR_chave_() {
  var alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var c = '';
  try {
    var u = Utilities.getUuid().replace(/-/g, '');
    for (var i = 0; i < u.length && c.length < 16; i += 2) {
      c += alfabeto.charAt(parseInt(u.substr(i, 2), 16) % alfabeto.length);
    }
  } catch (e) { }
  while (c.length < 16) c += alfabeto.charAt(Math.floor(Math.random() * alfabeto.length));
  return c;
}

/** O código do crachá: CR- mais a matrícula, que é o que a obra já usa */
function AP_CR_codigo_(matricula, via) {
  var m = String(matricula || '').replace(/\D+/g, '');
  if (!m) m = String(Date.now()).slice(-6);
  return 'CR-' + m + (via > 1 ? '-V' + via : '');
}

/**
 * A foto cabe na planilha?
 * Devolve null quando está tudo bem, ou a recusa já explicada.
 */
function AP_CR_conferirFoto_(foto) {
  var f = String(foto || '');
  if (!f) return null;
  if (f.length <= AP_CR_CFG.limiteFotoCaracteres) return null;
  var kb = Math.round(f.length / 1024);
  return {
    ok: false, codigo: 'FOTO_GRANDE',
    mensagem: 'A foto tem ' + kb + ' KB e não cabe na planilha (o limite é ' +
      Math.round(AP_CR_CFG.limiteFotoCaracteres / 1024) + ' KB por célula). ' +
      'Use uma foto menor — a tela do crachá encolhe a imagem sozinha quando ' +
      'você escolhe o arquivo por lá.'
  };
}

/** O conteúdo do QR. Só código e chave — nada de pessoa aqui. */
function AP_CR_conteudoQR_(c) {
  return AP_CR_CFG.prefixoQR + ':' + c.codigo + ':' + c.chave;
}

/**
 * Lê o que veio da câmera. Aceita o QR inteiro, e também só o
 * código digitado à mão — porque leitor quebra, câmera falha, e
 * a obra não pode parar por isso. Sem a chave, porém, o acesso
 * exige confirmação de um responsável (ver AP_CR_validar_).
 */
function AP_CR_lerConteudo_(texto) {
  var t = String(texto || '').trim();
  if (!t) return null;

  var partes = t.split(':');
  if (partes.length >= 4 && (partes[0] + ':' + partes[1]) === AP_CR_CFG.prefixoQR) {
    return { codigo: partes[2], chave: partes[3], completo: true };
  }

  /* um código solto, digitado ou lido de código de barras */
  if (/^CR-[\w-]+$/i.test(t)) return { codigo: t.toUpperCase(), chave: '', completo: false };

  /* só a matrícula */
  if (/^\d{3,10}$/.test(t)) return { codigo: 'CR-' + t, chave: '', completo: false };

  return null;
}

function AP_CR_achar_(codigo) {
  if (!codigo) return null;
  return AP_CR_linhas_(AP_CR_CFG.abas.crachas).filter(function (c) {
    return String(c.codigo).toUpperCase() === String(codigo).toUpperCase();
  })[0] || null;
}

function AP_CR_vencido_(c) {
  if (!c.validade) return false;
  var d = new Date(String(c.validade).slice(0, 10) + 'T23:59:59');
  if (isNaN(d.getTime())) return false;
  return d.getTime() < Date.now();
}

function AP_CR_situacao_(c) {
  var st = String(c.status || '').toUpperCase();
  if (st === AP_CR_CFG.status.REVOGADO) return st;
  if (st === AP_CR_CFG.status.BLOQUEADO) return st;
  if (AP_CR_vencido_(c)) return AP_CR_CFG.status.VENCIDO;
  return AP_CR_CFG.status.ATIVO;
}

/**
 * O REGISTRO DE TODA TENTATIVA
 * ------------------------------------------------------------
 * Tanto a que deu certo quanto a que foi barrada. A barrada é
 * até mais importante: é ela que mostra crachá de desligado
 * rodando na portaria, ou alguém tentando aprovar o que não pode.
 */
function AP_CR_registrar_(dados) {
  try {
    AP_CR_abas_();
    AP_Data_append(AP_CR_CFG.abas.acessos, {
      id: 'ACS-' + Date.now().toString(36).toUpperCase(),
      data: AP_CR_agora_(),
      codigo: dados.codigo || '',
      matricula: dados.matricula || '',
      colaborador: dados.colaborador || '',
      origem: dados.origem || 'sistema',
      acao: dados.acao || 'identificar',
      resultado: dados.resultado || 'BLOQUEADO',
      motivo: dados.motivo || '',
      dispositivo: dados.dispositivo || ''
    });
  } catch (e) { }
}

/** O colaborador no cadastro central — a fonte da verdade sobre estar ativo */
function AP_CR_colaborador_(matricula) {
  try {
    var r = AP_Modulo_usuarios('listar', {}, {});
    if (r && r.ok) {
      return (r.dados || []).filter(function (u) {
        return String(u.matricula) === String(matricula);
      })[0] || null;
    }
  } catch (e) { }
  return null;
}


/* ============================================================
   1. EMITIR O CRACHÁ
   ============================================================ */

function AP_CR_emitir_(payload, sessao) {
  if (!payload.matricula) {
    return {
      ok: false, codigo: 'SEM_MATRICULA',
      mensagem: 'A matrícula identifica o colaborador — sem ela o crachá não tem dono.'
    };
  }
  if (!payload.colaborador) {
    return { ok: false, codigo: 'SEM_NOME', mensagem: 'Informe o nome do colaborador.' };
  }

  var nivel = String(payload.nivel || 'SOLICITAR').toUpperCase();
  if (!AP_CR_CFG.niveis[nivel]) {
    return {
      ok: false, codigo: 'NIVEL_INVALIDO',
      mensagem: 'Nível "' + nivel + '" não existe. Use: ' +
        Object.keys(AP_CR_CFG.niveis).join(', ') + '.'
    };
  }

  var fotoRuim = AP_CR_conferirFoto_(payload.foto);
  if (fotoRuim) return fotoRuim;

  /* já existe crachá ativo para esta matrícula? */
  var existente = AP_CR_linhas_(AP_CR_CFG.abas.crachas).filter(function (c) {
    return String(c.matricula) === String(payload.matricula) &&
      AP_CR_situacao_(c) === AP_CR_CFG.status.ATIVO;
  })[0];

  if (existente && !payload.substituir) {
    return {
      ok: false, codigo: 'JA_TEM_CRACHA',
      mensagem: payload.colaborador + ' já tem o crachá ' + existente.codigo +
        ' ativo. Para trocar, use a reemissão — ela derruba o antigo.',
      dados: { codigo: existente.codigo }
    };
  }

  AP_CR_abas_();
  var quem = AP_CR_quem_(sessao);
  var agora = AP_CR_agora_();

  var via = 1;
  AP_CR_linhas_(AP_CR_CFG.abas.crachas).forEach(function (c) {
    if (String(c.matricula) === String(payload.matricula)) {
      via = Math.max(via, (Number(c.via) || 1) + 1);
    }
  });

  var validade = payload.validade;
  if (!validade) {
    var d = new Date();
    d.setMonth(d.getMonth() + AP_CR_CFG.validadePadraoMeses);
    validade = d.toISOString().slice(0, 10);
  }

  var registro = {
    codigo: AP_CR_codigo_(payload.matricula, via),
    chave: AP_CR_chave_(),
    matricula: payload.matricula,
    colaborador: payload.colaborador,
    cpf: payload.cpf || '',
    funcao: payload.funcao || '',
    setor: payload.setor || '',
    unidade: payload.unidade || '',
    obra: payload.obra || '',
    admissao: payload.admissao || '',
    tipoAcesso: payload.tipoAcesso || 'Colaborador',
    nivel: nivel,
    foto: payload.foto || '',
    status: AP_CR_CFG.status.ATIVO,
    validade: validade,
    emitidoEm: agora, emitidoPor: quem, via: via,
    revogadoEm: '', revogadoPor: '', motivoRevogacao: '',
    ultimoAcesso: '', observacao: payload.observacao || ''
  };

  /* reemissão: o antigo para de valer AGORA */
  if (existente && payload.substituir) {
    AP_Data_update(AP_CR_CFG.abas.crachas, existente.codigo, {
      status: AP_CR_CFG.status.REVOGADO,
      revogadoEm: agora, revogadoPor: quem,
      motivoRevogacao: payload.motivo || 'substituído pela ' + via + 'ª via'
    }, 'codigo');
  }

  AP_Data_append(AP_CR_CFG.abas.crachas, registro);

  try {
    AP_Modulo_auditoria('registrar', {
      usuario: quem, acao: 'CRACHA_EMITIDO', alvo: registro.codigo,
      detalhes: JSON.stringify({ colaborador: payload.colaborador, nivel: nivel, via: via }),
      data: agora
    }, {});
  } catch (e) { }

  return {
    ok: true,
    dados: AP_CR_montar_(registro, true),
    mensagem: 'Crachá ' + registro.codigo + ' emitido para ' + payload.colaborador +
      (via > 1 ? ' (' + via + 'ª via — a anterior foi cancelada)' : '') + '.'
  };
}

function AP_CR_reemitir_(payload, sessao) {
  var atual = AP_CR_achar_(payload.codigo);
  if (!atual && payload.matricula) {
    atual = AP_CR_linhas_(AP_CR_CFG.abas.crachas).filter(function (c) {
      return String(c.matricula) === String(payload.matricula);
    }).sort(function (a, b) { return (Number(b.via) || 1) - (Number(a.via) || 1); })[0];
  }
  if (!atual) return { ok: false, codigo: 'NAO_ENCONTRADO', mensagem: 'Crachá não localizado.' };

  if (!String(payload.motivo || '').trim()) {
    return {
      ok: false, codigo: 'SEM_MOTIVO',
      mensagem: 'Diga por que está reemitindo — perdeu, quebrou, mudou de função. ' +
        'É o que explica o crachá antigo ter parado de funcionar.'
    };
  }

  return AP_CR_emitir_({
    matricula: atual.matricula, colaborador: atual.colaborador, cpf: atual.cpf,
    funcao: payload.funcao || atual.funcao, setor: payload.setor || atual.setor,
    unidade: atual.unidade, obra: atual.obra, admissao: atual.admissao,
    tipoAcesso: payload.tipoAcesso || atual.tipoAcesso,
    nivel: payload.nivel || atual.nivel,
    foto: payload.foto || atual.foto,
    substituir: true, motivo: payload.motivo
  }, sessao);
}


/* ============================================================
   2. A VALIDAÇÃO
   ------------------------------------------------------------
   Nenhuma tela decide sozinha se alguém entra ou não. Passa por
   aqui, sempre.
   ============================================================ */

function AP_CR_validar_(payload) {
  var origem = payload.origem || 'sistema';
  var acao = payload.acao || 'identificar';
  var dispositivo = payload.dispositivo || '';

  /* --- o QR veio legível? --- */
  var lido = payload.codigo && payload.chave
    ? { codigo: payload.codigo, chave: payload.chave, completo: true }
    : AP_CR_lerConteudo_(payload.conteudo || payload.codigo);

  if (!lido) {
    AP_CR_registrar_({
      origem: origem, acao: acao, resultado: 'BLOQUEADO',
      motivo: 'QR inválido ou ilegível', dispositivo: dispositivo,
      codigo: String(payload.conteudo || '').slice(0, 40)
    });
    return {
      ok: false, codigo: 'QR_INVALIDO', liberado: false,
      mensagem: 'Este código não é um crachá do ALMOXA PRO.'
    };
  }

  /* --- o crachá existe? --- */
  var c = AP_CR_achar_(lido.codigo);
  if (!c) {
    AP_CR_registrar_({
      codigo: lido.codigo, origem: origem, acao: acao, resultado: 'BLOQUEADO',
      motivo: 'crachá não cadastrado', dispositivo: dispositivo
    });
    return {
      ok: false, codigo: 'CRACHA_NAO_ENCONTRADO', liberado: false,
      mensagem: 'Crachá não cadastrado no sistema.'
    };
  }

  /* --- a chave bate? ---
     Sem isso, bastaria imprimir um QR com o número do crachá de
     outra pessoa. A chave é o que torna o crachá difícil de
     falsificar. */
  if (lido.completo && String(lido.chave) !== String(c.chave)) {
    AP_CR_registrar_({
      codigo: c.codigo, matricula: c.matricula, colaborador: c.colaborador,
      origem: origem, acao: acao, resultado: 'BLOQUEADO',
      motivo: 'chave não confere — crachá antigo ou falsificado',
      dispositivo: dispositivo
    });
    return {
      ok: false, codigo: 'CHAVE_INVALIDA', liberado: false,
      mensagem: 'Este crachá não vale mais. Se for uma via antiga, use a atual.'
    };
  }

  /* --- a situação do crachá --- */
  var situacao = AP_CR_situacao_(c);
  if (situacao !== AP_CR_CFG.status.ATIVO) {
    var motivos = {
      REVOGADO: 'Crachá cancelado' + (c.motivoRevogacao ? ': ' + c.motivoRevogacao : '') + '.',
      BLOQUEADO: 'Crachá bloqueado' + (c.motivoRevogacao ? ': ' + c.motivoRevogacao : '') + '.',
      VENCIDO: 'Crachá vencido em ' + String(c.validade).slice(0, 10) + '. Procure o RH.'
    };
    AP_CR_registrar_({
      codigo: c.codigo, matricula: c.matricula, colaborador: c.colaborador,
      origem: origem, acao: acao, resultado: 'BLOQUEADO',
      motivo: 'crachá ' + situacao.toLowerCase(), dispositivo: dispositivo
    });
    return {
      ok: false, codigo: 'CRACHA_' + situacao, liberado: false,
      mensagem: motivos[situacao] || 'Crachá indisponível.',
      dados: { colaborador: c.colaborador, situacao: situacao }
    };
  }

  /* --- o colaborador continua ativo? ---
     O crachá pode estar bom e a pessoa já ter sido desligada. Quem
     manda é o cadastro, não o plástico. */
  var pessoa = AP_CR_colaborador_(c.matricula);
  if (pessoa && String(pessoa.status || '').toUpperCase() !== 'ATIVO') {
    AP_CR_registrar_({
      codigo: c.codigo, matricula: c.matricula, colaborador: c.colaborador,
      origem: origem, acao: acao, resultado: 'BLOQUEADO',
      motivo: 'colaborador ' + pessoa.status, dispositivo: dispositivo
    });
    return {
      ok: false, codigo: 'COLABORADOR_INATIVO', liberado: false,
      mensagem: c.colaborador + ' está ' + String(pessoa.status).toLowerCase() +
        ' no cadastro. O acesso fica bloqueado até a regularização.'
    };
  }

  /* --- sem a chave, a identificação é incompleta ---
     Código digitado à mão serve para consultar, não para operar. */
  if (!lido.completo && acao !== 'identificar' && acao !== 'consultar') {
    AP_CR_registrar_({
      codigo: c.codigo, matricula: c.matricula, colaborador: c.colaborador,
      origem: origem, acao: acao, resultado: 'BLOQUEADO',
      motivo: 'código digitado sem leitura do crachá', dispositivo: dispositivo
    });
    return {
      ok: false, codigo: 'LEITURA_INCOMPLETA', liberado: false,
      mensagem: 'O código foi digitado, não lido do crachá. Para esta operação ' +
        'é preciso apresentar o crachá à câmera.'
    };
  }

  /* --- a permissão para ESTA ação --- */
  var podeFazer = AP_CR_podeFazer_(c.nivel, acao);
  if (!podeFazer.pode) {
    AP_CR_registrar_({
      codigo: c.codigo, matricula: c.matricula, colaborador: c.colaborador,
      origem: origem, acao: acao, resultado: 'BLOQUEADO',
      motivo: 'sem permissão para ' + acao, dispositivo: dispositivo
    });
    return {
      ok: false, codigo: 'SEM_PERMISSAO', liberado: false,
      mensagem: c.colaborador + ' não tem permissão para ' +
        (AP_CR_CFG.acoes[acao] || acao).toLowerCase() + '. ' +
        'O nível dele é "' + podeFazer.nomeNivel + '".',
      dados: {
        colaborador: c.colaborador, nivel: c.nivel,
        nomeNivel: podeFazer.nomeNivel, acao: acao
      }
    };
  }

  /* --- liberado --- */
  try {
    AP_Data_update(AP_CR_CFG.abas.crachas, c.codigo,
      { ultimoAcesso: AP_CR_agora_() }, 'codigo');
  } catch (e) { }

  AP_CR_registrar_({
    codigo: c.codigo, matricula: c.matricula, colaborador: c.colaborador,
    origem: origem, acao: acao, resultado: 'LIBERADO',
    motivo: '', dispositivo: dispositivo
  });

  return {
    ok: true, liberado: true,
    dados: AP_CR_montar_(c, false),
    mensagem: 'Acesso liberado para ' + c.colaborador + '.'
  };
}

/** A pergunta "pode isto?", isolada, para os módulos chamarem */
function AP_CR_autorizar_(payload) {
  var c = AP_CR_achar_(payload.codigo);
  if (!c && payload.matricula) {
    c = AP_CR_linhas_(AP_CR_CFG.abas.crachas).filter(function (x) {
      return String(x.matricula) === String(payload.matricula) &&
        AP_CR_situacao_(x) === AP_CR_CFG.status.ATIVO;
    })[0];
  }
  if (!c) {
    return { ok: false, codigo: 'CRACHA_NAO_ENCONTRADO', liberado: false,
      mensagem: 'Crachá não localizado.' };
  }

  var situacao = AP_CR_situacao_(c);
  if (situacao !== AP_CR_CFG.status.ATIVO) {
    return { ok: false, codigo: 'CRACHA_' + situacao, liberado: false,
      mensagem: 'Crachá ' + situacao.toLowerCase() + '.' };
  }

  var r = AP_CR_podeFazer_(c.nivel, payload.acao);
  if (!r.pode) {
    AP_CR_registrar_({
      codigo: c.codigo, matricula: c.matricula, colaborador: c.colaborador,
      origem: payload.origem || 'sistema', acao: payload.acao,
      resultado: 'BLOQUEADO', motivo: 'sem permissão'
    });
    return {
      ok: false, codigo: 'SEM_PERMISSAO', liberado: false,
      mensagem: c.colaborador + ' não tem permissão para ' +
        (AP_CR_CFG.acoes[payload.acao] || payload.acao).toLowerCase() + '.'
    };
  }

  return {
    ok: true, liberado: true,
    dados: { codigo: c.codigo, colaborador: c.colaborador, nivel: c.nivel }
  };
}

function AP_CR_podeFazer_(nivel, acao) {
  var n = AP_CR_CFG.niveis[String(nivel || '').toUpperCase()] || AP_CR_CFG.niveis.SOLICITAR;
  var a = String(acao || 'identificar');
  return {
    pode: n.acoes.indexOf('*') > -1 || n.acoes.indexOf(a) > -1,
    nomeNivel: n.nome,
    acoes: n.acoes
  };
}


/* ============================================================
   3. BLOQUEAR, DESBLOQUEAR E REVOGAR
   ============================================================ */

/* ============================================================
   CORRIGIR O QUE ESTÁ ESCRITO NO CRACHÁ
   ------------------------------------------------------------
   Nome trocado, função nova, setor mudado, a foto que faltou. Nada
   disso é motivo para jogar o crachá fora e emitir outro.

   O que esta função NÃO mexe, de propósito:
     · o código e a chave — são a identidade do plástico que está
       na mão da pessoa; mudar aqui derrubaria o crachá dela;
     · a matrícula — é o que liga o crachá ao cadastro. Se mudou de
       matrícula, é outra pessoa: emita um crachá novo.

   Trocar o NÍVEL por aqui é de propósito também: promoveu, mudou de
   função, o crachá continua o mesmo e a permissão acompanha.
   ============================================================ */

function AP_CR_atualizar_(payload, sessao) {
  var c = AP_CR_achar_(payload.codigo);
  if (!c && payload.matricula) {
    c = AP_CR_linhas_(AP_CR_CFG.abas.crachas).filter(function (x) {
      return String(x.matricula) === String(payload.matricula) &&
        AP_CR_situacao_(x) === AP_CR_CFG.status.ATIVO;
    })[0];
  }
  if (!c) return { ok: false, codigo: 'NAO_ENCONTRADO', mensagem: 'Crachá não localizado.' };

  if (AP_CR_situacao_(c) === AP_CR_CFG.status.REVOGADO) {
    return {
      ok: false, codigo: 'CRACHA_REVOGADO',
      mensagem: 'Este crachá foi cancelado — corrigir os dados dele não traria ninguém de volta. ' +
        'Emita uma nova via com os dados certos.'
    };
  }

  if (payload.nivel) {
    var nivel = String(payload.nivel).toUpperCase();
    if (!AP_CR_CFG.niveis[nivel]) {
      return {
        ok: false, codigo: 'NIVEL_INVALIDO',
        mensagem: 'Nível "' + nivel + '" não existe. Use: ' +
          Object.keys(AP_CR_CFG.niveis).join(', ') + '.'
      };
    }
  }

  var fotoRuim = AP_CR_conferirFoto_(payload.foto);
  if (fotoRuim) return fotoRuim;

  /* só entra no patch o que veio no pedido; campo ausente fica como está */
  var editaveis = ['colaborador', 'cpf', 'funcao', 'setor', 'unidade', 'obra',
    'admissao', 'tipoAcesso', 'nivel', 'foto', 'validade', 'observacao'];
  var patch = {}, mudou = [];
  editaveis.forEach(function (campo) {
    if (payload[campo] === undefined) return;
    var novoValor = campo === 'nivel' ? String(payload[campo]).toUpperCase() : payload[campo];
    if (String(novoValor) === String(c[campo] || '')) return;
    patch[campo] = novoValor;
    /* a foto é um paredão de base64: no histórico vai só o aviso */
    mudou.push(campo === 'foto'
      ? (novoValor ? 'foto trocada' : 'foto removida')
      : campo + ': "' + (c[campo] || '—') + '" → "' + novoValor + '"');
  });

  if (!mudou.length) {
    return { ok: false, codigo: 'NADA_MUDOU', mensagem: 'Nenhum campo foi alterado.' };
  }

  var quem = AP_CR_quem_(sessao);
  var agora = AP_CR_agora_();
  AP_Data_update(AP_CR_CFG.abas.crachas, c.codigo, patch, 'codigo');

  /* uma correção de crachá é mexida em identidade: fica registrada
     no log de acessos, junto com tudo o mais que aconteceu com ele */
  AP_CR_registrar_({
    codigo: c.codigo, matricula: c.matricula,
    colaborador: patch.colaborador || c.colaborador,
    origem: 'administracao', acao: 'administrar', resultado: 'LIBERADO',
    motivo: 'dados corrigidos por ' + quem + ' — ' + mudou.join('; ')
  });

  try {
    AP_Modulo_auditoria('registrar', {
      usuario: quem, acao: 'CRACHA_ATUALIZADO', alvo: c.codigo,
      detalhes: JSON.stringify({ mudou: mudou }), data: agora
    }, {});
  } catch (e) { }

  /* devolve o crachá já com as mudanças, sem reler a planilha */
  var atualizado = {};
  for (var k in c) atualizado[k] = c[k];
  for (var k2 in patch) atualizado[k2] = patch[k2];

  return {
    ok: true,
    dados: AP_CR_montar_(atualizado, true),
    mudou: mudou,
    mensagem: 'Crachá ' + c.codigo + ' atualizado. O código e a chave continuam os ' +
      'mesmos, então o crachá que está com a pessoa segue valendo.'
  };
}


function AP_CR_bloquear_(payload, sessao) {
  var c = AP_CR_achar_(payload.codigo);
  if (!c) return { ok: false, codigo: 'NAO_ENCONTRADO', mensagem: 'Crachá não localizado.' };
  if (!String(payload.motivo || '').trim()) {
    return { ok: false, codigo: 'SEM_MOTIVO', mensagem: 'Diga por que está bloqueando.' };
  }

  var quem = AP_CR_quem_(sessao);
  AP_Data_update(AP_CR_CFG.abas.crachas, c.codigo, {
    status: AP_CR_CFG.status.BLOQUEADO,
    motivoRevogacao: payload.motivo,
    revogadoEm: AP_CR_agora_(), revogadoPor: quem
  }, 'codigo');

  AP_CR_registrar_({
    codigo: c.codigo, matricula: c.matricula, colaborador: c.colaborador,
    origem: 'administracao', acao: 'administrar', resultado: 'BLOQUEADO',
    motivo: 'bloqueado por ' + quem + ': ' + payload.motivo
  });

  return {
    ok: true,
    dados: { codigo: c.codigo },
    mensagem: 'Crachá de ' + c.colaborador + ' bloqueado. Ele para de abrir na hora.'
  };
}

function AP_CR_desbloquear_(payload, sessao) {
  var c = AP_CR_achar_(payload.codigo);
  if (!c) return { ok: false, codigo: 'NAO_ENCONTRADO', mensagem: 'Crachá não localizado.' };

  if (String(c.status).toUpperCase() === AP_CR_CFG.status.REVOGADO) {
    return {
      ok: false, codigo: 'REVOGADO',
      mensagem: 'Crachá revogado não volta — emita uma via nova.'
    };
  }

  var quem = AP_CR_quem_(sessao);
  AP_Data_update(AP_CR_CFG.abas.crachas, c.codigo, {
    status: AP_CR_CFG.status.ATIVO, motivoRevogacao: '',
    revogadoEm: '', revogadoPor: ''
  }, 'codigo');

  AP_CR_registrar_({
    codigo: c.codigo, matricula: c.matricula, colaborador: c.colaborador,
    origem: 'administracao', acao: 'administrar', resultado: 'LIBERADO',
    motivo: 'desbloqueado por ' + quem
  });

  return { ok: true, dados: { codigo: c.codigo },
    mensagem: 'Crachá de ' + c.colaborador + ' liberado de novo.' };
}

function AP_CR_revogar_(payload, sessao) {
  var c = AP_CR_achar_(payload.codigo);
  if (!c) return { ok: false, codigo: 'NAO_ENCONTRADO', mensagem: 'Crachá não localizado.' };
  if (!String(payload.motivo || '').trim()) {
    return {
      ok: false, codigo: 'SEM_MOTIVO',
      mensagem: 'Revogar é definitivo — diga o motivo para ficar no histórico.'
    };
  }
  if (String(c.status).toUpperCase() === AP_CR_CFG.status.REVOGADO) {
    return { ok: false, codigo: 'JA_REVOGADO', mensagem: 'Este crachá já estava revogado.' };
  }

  var quem = AP_CR_quem_(sessao);
  AP_Data_update(AP_CR_CFG.abas.crachas, c.codigo, {
    status: AP_CR_CFG.status.REVOGADO,
    motivoRevogacao: payload.motivo,
    revogadoEm: AP_CR_agora_(), revogadoPor: quem
  }, 'codigo');

  AP_CR_registrar_({
    codigo: c.codigo, matricula: c.matricula, colaborador: c.colaborador,
    origem: 'administracao', acao: 'administrar', resultado: 'BLOQUEADO',
    motivo: 'revogado por ' + quem + ': ' + payload.motivo
  });

  return {
    ok: true, dados: { codigo: c.codigo },
    mensagem: 'Crachá ' + c.codigo + ' revogado. Ele não abre mais nada.'
  };
}


/* ============================================================
   4. CONSULTAS
   ============================================================ */

/**
 * O crachá do jeito que a tela lê. O QR só é devolvido para quem
 * está emitindo ou imprimindo — na validação do dia a dia ele não
 * precisa trafegar, e o que não trafega não vaza.
 */
function AP_CR_montar_(c, comQR) {
  var situacao = AP_CR_situacao_(c);
  var nivel = AP_CR_CFG.niveis[String(c.nivel || '').toUpperCase()] || AP_CR_CFG.niveis.SOLICITAR;

  var d = {
    codigo: c.codigo, matricula: c.matricula, colaborador: c.colaborador,
    cpf: c.cpf || '', funcao: c.funcao || '', setor: c.setor || '',
    unidade: c.unidade || '', obra: c.obra || '', admissao: c.admissao || '',
    tipoAcesso: c.tipoAcesso || 'Colaborador',
    nivel: String(c.nivel || 'SOLICITAR').toUpperCase(),
    nomeNivel: nivel.nome, acoesPermitidas: nivel.acoes,
    foto: c.foto || '', status: situacao, validade: c.validade || '',
    emitidoEm: c.emitidoEm, emitidoPor: c.emitidoPor, via: Number(c.via) || 1,
    ultimoAcesso: c.ultimoAcesso || '',
    motivoRevogacao: c.motivoRevogacao || '',
    observacao: c.observacao || ''
  };
  if (comQR) d.qr = AP_CR_conteudoQR_(c);
  return d;
}

function AP_CR_listar_(filtro) {
  filtro = filtro || {};
  var lista = AP_CR_linhas_(AP_CR_CFG.abas.crachas)
    .map(function (c) { return AP_CR_montar_(c, !!filtro.comQR); });

  if (filtro.status) {
    var alvo = String(filtro.status).toUpperCase();
    lista = lista.filter(function (c) { return c.status === alvo; });
  }
  if (filtro.matricula) {
    lista = lista.filter(function (c) { return String(c.matricula) === String(filtro.matricula); });
  }
  if (filtro.busca) {
    var b = String(filtro.busca).toLowerCase();
    lista = lista.filter(function (c) {
      return (c.colaborador + ' ' + c.matricula + ' ' + c.codigo + ' ' +
        c.funcao + ' ' + c.setor).toLowerCase().indexOf(b) > -1;
    });
  }

  lista.sort(function (a, b) {
    return String(a.colaborador || '').localeCompare(String(b.colaborador || ''));
  });

  var conta = function (s) { return lista.filter(function (c) { return c.status === s; }).length; };
  return {
    crachas: lista,
    totais: {
      todos: lista.length,
      ativos: conta('ATIVO'),
      bloqueados: conta('BLOQUEADO'),
      revogados: conta('REVOGADO'),
      vencidos: conta('VENCIDO')
    }
  };
}

function AP_CR_obter_(payload) {
  var c = AP_CR_achar_(payload.codigo);
  if (!c && payload.matricula) {
    c = AP_CR_linhas_(AP_CR_CFG.abas.crachas).filter(function (x) {
      return String(x.matricula) === String(payload.matricula) &&
        AP_CR_situacao_(x) === AP_CR_CFG.status.ATIVO;
    })[0];
  }
  if (!c) return { ok: false, codigo: 'NAO_ENCONTRADO', mensagem: 'Crachá não localizado.' };
  return { ok: true, dados: AP_CR_montar_(c, payload.comQR !== false) };
}

function AP_CR_niveis_() {
  return Object.keys(AP_CR_CFG.niveis).map(function (k) {
    var n = AP_CR_CFG.niveis[k];
    return {
      id: k, nome: n.nome, acoes: n.acoes,
      descricao: n.acoes.indexOf('*') > -1
        ? 'Todas as ações do sistema'
        : n.acoes.map(function (a) { return AP_CR_CFG.acoes[a] || a; }).join(', ')
    };
  });
}

function AP_CR_acessos_(filtro) {
  filtro = filtro || {};
  var lista = AP_CR_linhas_(AP_CR_CFG.abas.acessos).map(function (a, i) {
    return {
      ordem: i, id: a.id, data: a.data, codigo: a.codigo,
      matricula: a.matricula, colaborador: a.colaborador,
      origem: a.origem, acao: a.acao,
      nomeAcao: AP_CR_CFG.acoes[a.acao] || a.acao,
      resultado: a.resultado, motivo: a.motivo, dispositivo: a.dispositivo
    };
  });

  if (filtro.resultado) {
    var alvo = String(filtro.resultado).toUpperCase();
    lista = lista.filter(function (a) { return String(a.resultado).toUpperCase() === alvo; });
  }
  if (filtro.matricula) {
    lista = lista.filter(function (a) { return String(a.matricula) === String(filtro.matricula); });
  }
  if (filtro.codigo) {
    lista = lista.filter(function (a) { return String(a.codigo) === String(filtro.codigo); });
  }

  lista.sort(function (a, b) {
    return (new Date(b.data) - new Date(a.data)) || (b.ordem - a.ordem);
  });
  if (filtro.limite) lista = lista.slice(0, Number(filtro.limite));
  return lista;
}

function AP_CR_painel_(payload) {
  var lista = AP_CR_listar_({});
  var acessos = AP_CR_acessos_({});
  var hoje = new Date().setHours(0, 0, 0, 0);

  var doDia = acessos.filter(function (a) {
    var d = new Date(a.data).getTime();
    return !isNaN(d) && d >= hoje;
  });

  return {
    crachas: lista.totais,
    acessosHoje: doDia.length,
    liberadosHoje: doDia.filter(function (a) { return a.resultado === 'LIBERADO'; }).length,
    bloqueadosHoje: doDia.filter(function (a) { return a.resultado === 'BLOQUEADO'; }).length,
    semCracha: AP_CR_semCracha_(),
    ultimos: acessos.slice(0, 15)
  };
}

/** Quantas pessoas do cadastro ainda não têm crachá */
function AP_CR_semCracha_() {
  return AP_CR_semCrachaLista_().length;
}

/**
 * QUEM ainda não tem crachá — a lista, não só o número.
 * É por ela que a tela de emissão sabe quem chamar primeiro,
 * em vez de o almoxarife ter que descobrir no olho.
 */
function AP_CR_semCrachaLista_() {
  try {
    var r = AP_Modulo_usuarios('listar', {}, {});
    if (!r || !r.ok) return [];
    var comCracha = {};
    AP_CR_linhas_(AP_CR_CFG.abas.crachas).forEach(function (c) {
      if (AP_CR_situacao_(c) === AP_CR_CFG.status.ATIVO) comCracha[String(c.matricula)] = 1;
    });
    return (r.dados || []).filter(function (u) {
      return String(u.status || 'Ativo').toUpperCase() === 'ATIVO' && !comCracha[String(u.matricula)];
    });
  } catch (e) { return []; }
}


/* ============================================================
   A PORTA DE ENTRADA — ler crachá ANTES de existir sessão
   ------------------------------------------------------------
   O PROBLEMA QUE ISTO RESOLVE

   O almoxaApi exige token de sessão em tudo. Faz sentido: quase
   nada deve acontecer sem alguém logado.

   Só que o crachá é justamente COMO a pessoa entra. Pedir sessão
   para ler o crachá é pedir a chave para poder pegar a chave — e
   o resultado na tela era "Token de sessão não informado" no
   primeiro pop-up, antes de qualquer login.

   Então estas funções ficam FORA do almoxaApi, alcançáveis direto
   pelo google.script.run, e atendem só o que precisa acontecer
   antes da sessão existir:

       validar   — quem é esta pessoa, e ela pode esta ação?
       autorizar — esta pessoa pode esta ação?
       niveis    — a lista de níveis, para a tela desenhar

   Emitir, editar, bloquear, revogar e o log continuam passando
   pelo almoxaApi, com sessão, como sempre. Uma porta estreita,
   não um portão aberto.

   E "validar" não é um cheque em branco: ele já é o guardião. Ele
   confere a chave do crachá, a situação dele, se o colaborador
   está ativo e a permissão para a ação pedida — e registra tudo,
   inclusive as tentativas barradas.
   ============================================================ */

/** As únicas ações que rodam antes de existir sessão */
var AP_CR_SEM_SESSAO = ['validar', 'autorizar', 'niveis'];

/**
 * Chamada direta pela tela, sem passar pelo almoxaApi.
 * Recebe e devolve texto, que é o que o google.script.run carrega
 * sem surpresa entre navegador e servidor.
 */
function AP_CRACHA_direto(pedidoJson) {
  var pedido;
  try {
    pedido = (typeof pedidoJson === 'string') ? JSON.parse(pedidoJson) : (pedidoJson || {});
  } catch (e) {
    return JSON.stringify({ ok: false, codigo: 'PEDIDO_INVALIDO', mensagem: 'Pedido ilegível.' });
  }

  var acao = String(pedido.acao || '');
  if (AP_CR_SEM_SESSAO.indexOf(acao) === -1) {
    return JSON.stringify({
      ok: false, codigo: 'ACAO_EXIGE_SESSAO',
      mensagem: 'A ação "' + acao + '" precisa de login. Só a leitura de crachá acontece ' +
        'antes da sessão existir.'
    });
  }

  try {
    return JSON.stringify(AP_Modulo_cracha(acao, pedido.payload || {}, {}));
  } catch (falha) {
    return JSON.stringify({
      ok: false, codigo: 'CRACHA_ERRO',
      mensagem: falha && falha.message ? falha.message : String(falha)
    });
  }
}


/* ============================================================
   A ESTAÇÃO DE LEITURA — a câmera que o Apps Script não deixa abrir
   ------------------------------------------------------------
   O QUE ACONTECE E POR QUÊ

   O ALMOXA PRO é servido pelo Apps Script dentro de um iframe de
   origem opaca (googleusercontent.com). Navegador nenhum entrega
   câmera para uma origem opaca — é regra de segurança do próprio
   navegador, não ajuste do Google e não configuração do usuário.
   Em fevereiro de 2026 isso apertou de vez e a câmera parou em
   todos os sistemas feitos em Apps Script, no mundo inteiro.

   A SAÍDA

   A câmera mora numa página separada, hospedada num endereço HTTPS
   de verdade (ALMOXA_LEITOR.html). Ela abre a câmera, lê o QR e
   manda o conteúdo lido para CÁ. Quem decide continua sendo o Core:
   a página não libera nada, não sabe de permissão, não tem regra
   nenhuma dentro dela. Ela é olho, não é juízo.

       [página do leitor]  --HTTPS-->  [Core]  -->  libera ou barra

   O QUE ESTE ENDPOINT ACEITA

   Só "identificar". Um endereço público não retira material, não
   aprova e não entrega EPI — essas operações continuam saindo do
   sistema, com sessão. E toda tentativa entra no log igual às
   outras, com origem marcada como estação.

   A CHAVE DA ESTAÇÃO (opcional, recomendada)

   Guarde uma senha em Propriedades do Script com o nome
   ALMOXA_CHAVE_ESTACAO. Se existir, o leitor precisa mandá-la.
   Sem a propriedade, o endpoint funciona sem chave — para você não
   ficar travado no primeiro dia.
   ============================================================ */

function AP_CR_chaveEstacao_() {
  try {
    return String(PropertiesService.getScriptProperties()
      .getProperty('ALMOXA_CHAVE_ESTACAO') || '').trim();
  } catch (e) { return ''; }
}

function AP_CR_estacao_() {
  var url = '';
  try {
    url = String(PropertiesService.getScriptProperties()
      .getProperty('ALMOXA_URL_LEITOR') || '').trim();
  } catch (e) { }

  /* o endereço do próprio ALMOXA, para o leitor saber com quem falar */
  var core = '';
  try { core = ScriptApp.getService().getUrl() || ''; } catch (e) { }

  return {
    url: url,
    core: core,
    exigeChave: !!AP_CR_chaveEstacao_(),
    configurada: !!url
  };
}

function AP_CR_configurarEstacao_(payload) {
  var url = String(payload.url || '').trim();
  if (url && !/^https:\/\//i.test(url)) {
    return {
      ok: false, codigo: 'URL_INVALIDA',
      mensagem: 'O endereço do leitor precisa começar com https:// — câmera só abre em ' +
        'endereço seguro. Um endereço http:// ou um arquivo no computador não serve.'
    };
  }
  try {
    PropertiesService.getScriptProperties().setProperty('ALMOXA_URL_LEITOR', url);
  } catch (e) {
    return { ok: false, codigo: 'NAO_SALVOU', mensagem: e.message };
  }
  return {
    ok: true, dados: AP_CR_estacao_(),
    mensagem: url ? 'Leitor configurado. O botão da câmera já abre por ele.'
      : 'Endereço do leitor apagado.'
  };
}

/**
 * A porta de entrada da estação de leitura.
 *
 * Chame no começo do seu doGet, igual ao LinkFlow. Sem ?cr= na
 * URL, devolve null e o doGet segue como sempre foi.
 */
function AP_CRACHA_doGet(e) {
  var pedido = '';
  try {
    pedido = (e && e.parameter && e.parameter.cr) || '';
  } catch (erro) { return null; }
  if (!pedido) return null;

  var resposta;
  try {
    var p = (e && e.parameter) || {};

    /* a chave da estação, quando configurada */
    var esperada = AP_CR_chaveEstacao_();
    if (esperada && String(p.chave || '') !== esperada) {
      AP_CR_registrar_({
        origem: 'estacao', acao: 'identificar', resultado: 'BLOQUEADO',
        motivo: 'estação sem a chave certa', dispositivo: String(p.dispositivo || '')
      });
      resposta = {
        ok: false, liberado: false, codigo: 'ESTACAO_NAO_AUTORIZADA',
        mensagem: 'Esta estação de leitura não está autorizada. Confira a chave configurada.'
      };
    } else if (pedido === 'ping') {
      resposta = { ok: true, dados: { versao: AP_CR_CFG.versao, pronto: true } };

    } else if (pedido === 'validar') {
      /* SÓ IDENTIFICAR. Um endereço público não opera o almoxarifado. */
      resposta = AP_CR_validar_({
        conteudo: p.conteudo || '',
        acao: 'identificar',
        origem: 'estacao' + (p.origem ? ' · ' + p.origem : ''),
        dispositivo: p.dispositivo || 'estação de leitura'
      });
      /* o que volta para a rua é o mínimo: quem é e se pode entrar.
         Foto, CPF e o resto ficam aqui dentro. */
      if (resposta.ok && resposta.dados) {
        resposta.dados = {
          codigo: resposta.dados.codigo,
          colaborador: resposta.dados.colaborador,
          funcao: resposta.dados.funcao,
          setor: resposta.dados.setor,
          nivel: resposta.dados.nivel,
          nomeNivel: resposta.dados.nomeNivel
        };
      }
    } else {
      resposta = { ok: false, codigo: 'PEDIDO_DESCONHECIDO', mensagem: 'cr=' + pedido + ' não existe.' };
    }
  } catch (falha) {
    resposta = { ok: false, codigo: 'ERRO', mensagem: falha && falha.message ? falha.message : String(falha) };
  }

  return ContentService.createTextOutput(JSON.stringify(resposta))
    .setMimeType(ContentService.MimeType.JSON);
}


/* ============================================================
   DIAGNÓSTICO — quando a foto (ou qualquer campo) some
   ------------------------------------------------------------
   Um campo pode desaparecer sem erro nenhum: se a aba da planilha
   foi criada antes, com menos colunas, o que não tem coluna é
   jogado fora na gravação, em silêncio. O crachá é salvo, a foto
   não, e não aparece mensagem nenhuma.

   Esta função abre a aba, lê o cabeçalho de verdade e diz o que
   está faltando — em vez de deixar a gente adivinhando.
   ============================================================ */

function AP_CR_cabecalho_(nomeAba) {
  try {
    var sh = AP_Data_getSheet(nomeAba, AP_CR_CFG.colunas[
      nomeAba === AP_CR_CFG.abas.crachas ? 'crachas' : 'acessos']);
    if (!sh || typeof sh.getLastColumn !== 'function') return null;
    var n = sh.getLastColumn();
    if (!n) return [];
    return sh.getRange(1, 1, 1, n).getValues()[0].map(function (v) { return String(v).trim(); });
  } catch (e) { return null; }
}

function AP_CR_diagnostico_() {
  var r = { versao: AP_CR_CFG.versao, abas: [], resumo: '', problemas: [] };

  [['crachas', AP_CR_CFG.abas.crachas], ['acessos', AP_CR_CFG.abas.acessos]].forEach(function (par) {
    var chave = par[0], nome = par[1];
    var esperadas = AP_CR_CFG.colunas[chave];
    var achadas = AP_CR_cabecalho_(nome);
    var linhas = AP_CR_linhas_(nome);

    var faltando = [];
    if (achadas) {
      esperadas.forEach(function (c) {
        if (achadas.indexOf(c) === -1) faltando.push(c);
      });
    }

    r.abas.push({
      aba: nome,
      existe: achadas !== null,
      colunasNaPlanilha: achadas || [],
      colunasEsperadas: esperadas,
      faltando: faltando,
      registros: linhas.length
    });

    if (achadas === null) {
      r.problemas.push('Não consegui abrir a aba "' + nome + '".');
    } else if (faltando.length) {
      r.problemas.push('A aba "' + nome + '" está sem a(s) coluna(s): ' + faltando.join(', ') +
        '. O que for gravado nesses campos é descartado em silêncio — é isso que faz a foto sumir.');
    }
  });

  /* a prova real: as fotos que estão gravadas */
  var comFoto = 0, semFoto = 0;
  AP_CR_linhas_(AP_CR_CFG.abas.crachas).forEach(function (c) {
    if (String(c.foto || '').length > 30) comFoto++; else semFoto++;
  });
  r.fotos = { com: comFoto, sem: semFoto };

  r.resumo = r.problemas.length
    ? r.problemas.join(' ')
    : 'A planilha está com todas as colunas certas. ' + comFoto + ' crachá(s) com foto, ' +
      semFoto + ' sem.';
  return r;
}

/**
 * Conserta o cabeçalho: acrescenta as colunas que faltam, no fim,
 * sem tocar em nada que já está escrito.
 */
function AP_CR_corrigirColunas_() {
  var consertadas = [];
  var erros = [];

  [['crachas', AP_CR_CFG.abas.crachas], ['acessos', AP_CR_CFG.abas.acessos]].forEach(function (par) {
    var chave = par[0], nome = par[1];
    try {
      var sh = AP_Data_getSheet(nome, AP_CR_CFG.colunas[chave]);
      if (!sh || typeof sh.getLastColumn !== 'function') {
        erros.push('não consegui abrir "' + nome + '"');
        return;
      }
      var n = sh.getLastColumn();
      var achadas = n ? sh.getRange(1, 1, 1, n).getValues()[0].map(function (v) {
        return String(v).trim();
      }) : [];

      AP_CR_CFG.colunas[chave].forEach(function (c) {
        if (achadas.indexOf(c) > -1) return;
        n += 1;
        sh.getRange(1, n).setValue(c);
        achadas.push(c);
        consertadas.push(nome + '.' + c);
      });
    } catch (e) { erros.push(nome + ': ' + e.message); }
  });

  if (erros.length && !consertadas.length) {
    return { ok: false, codigo: 'NAO_CONSEGUI', mensagem: erros.join(' · ') };
  }
  return {
    ok: true,
    dados: { consertadas: consertadas, erros: erros },
    mensagem: consertadas.length
      ? 'Coluna(s) criada(s): ' + consertadas.join(', ') + '. Emita o crachá de novo — ' +
        'agora a foto tem onde ser gravada.'
      : 'Nenhuma coluna estava faltando. O problema da foto é outro.'
  };
}


/* ============================================================
   TESTES — não tocam na planilha
   ============================================================ */

function AP_CRACHA_testes() {
  var log = [], falhas = 0;
  function ok(nome, cond, detalhe) {
    log.push((cond ? 'PASSOU  ' : 'FALHOU  ') + nome + (detalhe ? '  [' + detalhe + ']' : ''));
    if (!cond) falhas++;
  }

  var tabelas = {};
  tabelas[AP_CR_CFG.abas.crachas] = [];
  tabelas[AP_CR_CFG.abas.acessos] = [];

  var usuarios = [
    { id: 'U1', nome: 'Ismael Silva', matricula: '00125', status: 'Ativo' },
    { id: 'U2', nome: 'Carlos Santos', matricula: '00234', status: 'Ativo' },
    { id: 'U3', nome: 'Ex Funcionário', matricula: '00999', status: 'Bloqueado' }
  ];

  var orig = {
    get: (typeof AP_Data_getSheet === 'function') ? AP_Data_getSheet : null,
    rows: (typeof AP_Data_rows === 'function') ? AP_Data_rows : null,
    app: (typeof AP_Data_append === 'function') ? AP_Data_append : null,
    upd: (typeof AP_Data_update === 'function') ? AP_Data_update : null,
    usr: (typeof AP_Modulo_usuarios === 'function') ? AP_Modulo_usuarios : null
  };

  try {
    AP_Data_getSheet = function () { return {}; };
    AP_Data_rows = function (aba) { return tabelas[aba] || []; };
    AP_Data_append = function (aba, reg) { (tabelas[aba] = tabelas[aba] || []).push(reg); };
    AP_Data_update = function (aba, id, patch, campo) {
      (tabelas[aba] || []).forEach(function (r) {
        if (String(r[campo || 'id']) === String(id)) { for (var k in patch) r[k] = patch[k]; }
      });
    };
    AP_Modulo_usuarios = function (acao) {
      if (acao === 'listar') return { ok: true, dados: usuarios };
      return { ok: false };
    };

    /* ---------- 1. EMITIR ---------- */
    var e1 = AP_Modulo_cracha('emitir', {
      matricula: '00125', colaborador: 'Ismael Silva', cpf: '123.456.789-00',
      funcao: 'Almoxarifado', setor: 'Logística', unidade: 'COESA',
      nivel: 'ALMOXARIFE', admissao: '2024-08-01'
    }, { nome: 'Admin' });
    ok('crachá emitido', e1.ok, e1.ok ? e1.dados.codigo : e1.mensagem);
    ok('o código usa a matrícula', e1.ok && e1.dados.codigo === 'CR-00125', e1.dados.codigo);
    ok('vem com o conteúdo do QR', e1.ok && /^ALMOXA:CR:/.test(e1.dados.qr), e1.dados.qr);
    ok('O QR NÃO CARREGA DADO PESSOAL',
      !/Ismael|123\.456|Almoxarifado/.test(e1.dados.qr), e1.dados.qr);

    var qr = e1.dados.qr;

    ok('sem matrícula é recusado',
      AP_Modulo_cracha('emitir', { colaborador: 'X' }).codigo === 'SEM_MATRICULA');
    ok('nível inventado é recusado',
      AP_Modulo_cracha('emitir', {
        matricula: '00234', colaborador: 'Y', nivel: 'CHEFAO'
      }).codigo === 'NIVEL_INVALIDO');
    ok('dois crachás ativos para a mesma pessoa é impedido',
      AP_Modulo_cracha('emitir', {
        matricula: '00125', colaborador: 'Ismael Silva'
      }).codigo === 'JA_TEM_CRACHA');

    /* ---------- 2. VALIDAR ---------- */
    var v1 = AP_Modulo_cracha('validar', { conteudo: qr, origem: 'entrada', acao: 'identificar' });
    ok('o crachá bom abre', v1.ok && v1.liberado, v1.mensagem);
    ok('e diz quem é', v1.dados.colaborador === 'Ismael Silva' && v1.dados.nomeNivel,
      v1.dados.colaborador + ' · ' + v1.dados.nomeNivel);

    ok('QR de outro sistema não passa',
      AP_Modulo_cracha('validar', { conteudo: 'QUALQUER:COISA:AQUI' }).codigo === 'QR_INVALIDO');
    ok('crachá não cadastrado não passa',
      AP_Modulo_cracha('validar', { conteudo: 'ALMOXA:CR:CR-99999:XXXX' })
        .codigo === 'CRACHA_NAO_ENCONTRADO');

    /* ---------- 3. A CHAVE É O QUE IMPEDE FALSIFICAR ---------- */
    var falso = 'ALMOXA:CR:CR-00125:CHAVEINVENTADA';
    var vf = AP_Modulo_cracha('validar', { conteudo: falso, acao: 'identificar' });
    ok('CRACHÁ COM CHAVE ERRADA NÃO ABRE', vf.codigo === 'CHAVE_INVALIDA', vf.mensagem);

    /* ---------- 4. PERMISSÃO POR AÇÃO ---------- */
    var e2 = AP_Modulo_cracha('emitir', {
      matricula: '00234', colaborador: 'Carlos Santos',
      funcao: 'Operador', nivel: 'SOLICITAR'
    }, { nome: 'Admin' });
    var qr2 = e2.dados.qr;

    ok('quem só solicita CONSEGUE entrar',
      AP_Modulo_cracha('validar', { conteudo: qr2, acao: 'identificar' }).liberado === true);
    ok('e consegue solicitar',
      AP_Modulo_cracha('validar', { conteudo: qr2, acao: 'solicitar' }).liberado === true);

    var semP = AP_Modulo_cracha('validar', { conteudo: qr2, acao: 'aprovar' });
    ok('MAS NÃO CONSEGUE APROVAR', semP.codigo === 'SEM_PERMISSAO', semP.mensagem);
    ok('e a recusa diz qual é o nível dele', /Somente solicitar/.test(semP.mensagem));

    ok('quem é almoxarife entrega EPI',
      AP_Modulo_cracha('validar', { conteudo: qr, acao: 'entregarEPI' }).liberado === true);
    ok('mas nem o almoxarife administra',
      AP_Modulo_cracha('validar', { conteudo: qr, acao: 'administrar' }).codigo === 'SEM_PERMISSAO');

    var e3 = AP_Modulo_cracha('emitir', {
      matricula: '00777', colaborador: 'Gestor Geral', nivel: 'ADMIN'
    }, {});
    ok('o administrador faz tudo',
      AP_Modulo_cracha('validar', { conteudo: e3.dados.qr, acao: 'administrar' }).liberado === true);

    /* ---------- 5. COLABORADOR DESLIGADO ---------- */
    var e4 = AP_Modulo_cracha('emitir', {
      matricula: '00999', colaborador: 'Ex Funcionário', nivel: 'SOLICITAR'
    }, {});
    var vd = AP_Modulo_cracha('validar', { conteudo: e4.dados.qr, acao: 'identificar' });
    ok('CRACHÁ BOM MAS PESSOA DESLIGADA NÃO ABRE',
      vd.codigo === 'COLABORADOR_INATIVO', vd.mensagem);

    /* ---------- 6. CÓDIGO DIGITADO À MÃO ---------- */
    ok('código digitado serve para identificar',
      AP_Modulo_cracha('validar', { conteudo: 'CR-00125', acao: 'identificar' }).liberado === true);
    var digitado = AP_Modulo_cracha('validar', { conteudo: 'CR-00125', acao: 'entregarEPI' });
    ok('MAS NÃO SERVE PARA OPERAR', digitado.codigo === 'LEITURA_INCOMPLETA', digitado.mensagem);

    /* ---------- 7. BLOQUEIO, REVOGAÇÃO E REEMISSÃO ---------- */
    ok('bloquear sem motivo é recusado',
      AP_Modulo_cracha('bloquear', { codigo: 'CR-00234' }).codigo === 'SEM_MOTIVO');
    AP_Modulo_cracha('bloquear', { codigo: 'CR-00234', motivo: 'crachá esquecido na obra' }, {});
    ok('CRACHÁ BLOQUEADO NÃO ABRE',
      AP_Modulo_cracha('validar', { conteudo: qr2 }).codigo === 'CRACHA_BLOQUEADO');
    ok('desbloquear devolve o acesso',
      AP_Modulo_cracha('desbloquear', { codigo: 'CR-00234' }, {}).ok &&
      AP_Modulo_cracha('validar', { conteudo: qr2 }).liberado === true);

    var re = AP_Modulo_cracha('reemitir', { codigo: 'CR-00125', motivo: 'perdeu o crachá' }, { nome: 'Admin' });
    ok('reemissão cria a 2ª via', re.ok && re.dados.via === 2, re.ok ? re.dados.codigo : re.mensagem);
    var vAntigo = AP_Modulo_cracha('validar', { conteudo: qr, acao: 'identificar' });
    ok('O CRACHÁ PERDIDO PARA DE FUNCIONAR NA HORA',
      vAntigo.codigo === 'CRACHA_REVOGADO', vAntigo.mensagem);
    ok('e a via nova funciona',
      AP_Modulo_cracha('validar', { conteudo: re.dados.qr, acao: 'identificar' }).liberado === true);
    ok('reemitir sem motivo é recusado',
      AP_Modulo_cracha('reemitir', { codigo: re.dados.codigo }).codigo === 'SEM_MOTIVO');

    /* ---------- 7b. CORRIGIR OS DADOS SEM MATAR O CRACHÁ ---------- */
    var antesDaEdicao = AP_Modulo_cracha('obter', { codigo: 'CR-00234' }).dados;
    var ed = AP_Modulo_cracha('atualizar', {
      codigo: 'CR-00234', funcao: 'Encarregado', setor: 'Elétrica', nivel: 'APROVAR'
    }, { nome: 'Admin' });
    ok('dá para corrigir função, setor e nível', ed.ok, ed.ok ? ed.mudou.join(' · ') : ed.mensagem);
    ok('O CÓDIGO E A CHAVE NÃO MUDAM',
      ed.ok && ed.dados.codigo === antesDaEdicao.codigo && ed.dados.qr === antesDaEdicao.qr,
      'o crachá na mão da pessoa continua valendo');
    ok('e o crachá antigo continua abrindo',
      AP_Modulo_cracha('validar', { conteudo: qr2, acao: 'identificar' }).liberado === true);
    ok('a permissão nova já vale',
      AP_Modulo_cracha('validar', { conteudo: qr2, acao: 'aprovar' }).liberado === true);

    ok('a foto entra por edição, sem reemitir',
      AP_Modulo_cracha('atualizar', { codigo: 'CR-00234', foto: 'data:image/jpeg;base64,abc' }, {}).ok);

    var fotoGigante = 'data:image/jpeg;base64,' + new Array(60000).join('A');
    var recusa = AP_Modulo_cracha('atualizar', { codigo: 'CR-00234', foto: fotoGigante }, {});
    ok('FOTO GRANDE DEMAIS É RECUSADA COM EXPLICAÇÃO',
      recusa.codigo === 'FOTO_GRANDE', recusa.mensagem);
    ok('e a foto boa continua lá',
      AP_Modulo_cracha('obter', { codigo: 'CR-00234' }).dados.foto === 'data:image/jpeg;base64,abc');
    ok('emitir com foto gigante também é recusado',
      AP_Modulo_cracha('emitir', {
        matricula: '00555', colaborador: 'Foto Pesada', foto: fotoGigante
      }, {}).codigo === 'FOTO_GRANDE');

    ok('editar sem mudar nada é recusado',
      AP_Modulo_cracha('atualizar', { codigo: 'CR-00234', funcao: 'Encarregado' }, {}).codigo === 'NADA_MUDOU');
    ok('nível inventado não passa pela edição',
      AP_Modulo_cracha('atualizar', { codigo: 'CR-00234', nivel: 'CHEFAO' }, {}).codigo === 'NIVEL_INVALIDO');
    ok('crachá cancelado não se corrige',
      AP_Modulo_cracha('atualizar', { codigo: 'CR-00125', funcao: 'X' }, {}).codigo === 'CRACHA_REVOGADO');
    ok('a correção fica no histórico do crachá',
      AP_CR_acessos_({ codigo: 'CR-00234' }).some(function (a) {
        return /dados corrigidos/.test(a.motivo || '');
      }));

    /* ---------- 7c. A ESTAÇÃO DE LEITURA (endereço público) ---------- */
    var leia = function (par) {
      var saida = AP_CRACHA_doGet({ parameter: par });
      return saida ? JSON.parse(saida.getContent()) : null;
    };

    ok('sem ?cr= o doGet nem se mete', AP_CRACHA_doGet({ parameter: {} }) === null,
      'o sistema abre normal para quem não é estação');
    ok('a estação consegue dar um oi', leia({ cr: 'ping' }).ok);

    var pelaEstacao = leia({ cr: 'validar', conteudo: qr2, dispositivo: 'Android' });
    ok('A ESTAÇÃO IDENTIFICA PELA CÂMERA', pelaEstacao.liberado === true,
      pelaEstacao.mensagem);
    ok('e diz quem é', pelaEstacao.dados.colaborador === 'Carlos Santos',
      pelaEstacao.dados.colaborador + ' · ' + pelaEstacao.dados.nomeNivel);
    ok('MAS NÃO DEVOLVE FOTO, CPF NEM CHAVE PARA A RUA',
      !pelaEstacao.dados.foto && !pelaEstacao.dados.cpf && !pelaEstacao.dados.chave &&
      !pelaEstacao.dados.qr,
      'volta só: ' + Object.keys(pelaEstacao.dados).join(', '));

    ok('QR de outro sistema é barrado na estação',
      leia({ cr: 'validar', conteudo: 'https://qualquer-coisa' }).codigo === 'QR_INVALIDO');
    ok('crachá revogado é barrado na estação',
      leia({ cr: 'validar', conteudo: qr }).codigo === 'CRACHA_REVOGADO');
    ok('pedido inventado não faz nada',
      leia({ cr: 'esvaziar-estoque' }).codigo === 'PEDIDO_DESCONHECIDO');

    /* a leitura da estação entra no log como qualquer outra */
    ok('A LEITURA DA ESTAÇÃO FICA REGISTRADA',
      AP_CR_acessos_({}).some(function (a) {
        return /^estacao/.test(String(a.origem)) && a.resultado === 'LIBERADO';
      }));
    ok('e o aparelho usado também',
      AP_CR_acessos_({}).some(function (a) { return a.dispositivo === 'Android'; }));

    /* --- a chave da estação, quando o administrador configura --- */
    var propsOriginal = (typeof PropertiesService !== 'undefined') ? PropertiesService : null;
    var guardado = { ALMOXA_CHAVE_ESTACAO: 'SEGREDO-DA-OBRA' };
    PropertiesService = {
      getScriptProperties: function () {
        return {
          getProperty: function (k) { return guardado[k] || null; },
          setProperty: function (k, v) { guardado[k] = v; }
        };
      }
    };
    try {
      ok('COM CHAVE CONFIGURADA, ESTAÇÃO SEM CHAVE NÃO PASSA',
        leia({ cr: 'validar', conteudo: qr2 }).codigo === 'ESTACAO_NAO_AUTORIZADA');
      ok('chave errada também não',
        leia({ cr: 'validar', conteudo: qr2, chave: 'chutando' }).codigo === 'ESTACAO_NAO_AUTORIZADA');
      ok('com a chave certa, passa',
        leia({ cr: 'validar', conteudo: qr2, chave: 'SEGREDO-DA-OBRA' }).liberado === true);
      ok('estação recusada também fica no log',
        AP_CR_acessos_({}).some(function (a) {
          return /chave certa/.test(String(a.motivo));
        }));

      /* o endereço do leitor */
      ok('endereço http:// é recusado — câmera só abre em https',
        AP_Modulo_cracha('configurarEstacao', { url: 'http://leitor.exemplo' }, {}).codigo === 'URL_INVALIDA');
      var cfg = AP_Modulo_cracha('configurarEstacao', { url: 'https://leitor.exemplo/x.html' }, {});
      ok('endereço https é aceito e guardado',
        cfg.ok && AP_CR_estacao_().url === 'https://leitor.exemplo/x.html');
      ok('e o sistema sabe que a chave está ligada', AP_CR_estacao_().exigeChave === true);
    } finally {
      if (propsOriginal) PropertiesService = propsOriginal; else PropertiesService = undefined;
    }

    /* ---------- 7d. A PORTA DE ENTRADA (sem sessão) ---------- */
    var direto = function (acao, payload) {
      return JSON.parse(AP_CRACHA_direto(JSON.stringify({ acao: acao, payload: payload || {} })));
    };

    ok('LER O CRACHÁ FUNCIONA ANTES DE EXISTIR SESSÃO',
      direto('validar', { conteudo: qr2, acao: 'identificar' }).liberado === true,
      'é assim que a pessoa entra: sem isto, precisaria de login para poder logar');
    ok('e a permissão é conferida do mesmo jeito',
      direto('validar', { conteudo: qr2, acao: 'administrar' }).codigo === 'SEM_PERMISSAO');
    ok('autorizar também passa',
      direto('autorizar', { codigo: 'CR-00234', acao: 'solicitar' }).ok === true);
    ok('a lista de níveis também', direto('niveis', {}).ok === true);

    ok('MAS EMITIR CRACHÁ NÃO PASSA POR AQUI',
      direto('emitir', { matricula: '1', colaborador: 'Invasor' }).codigo === 'ACAO_EXIGE_SESSAO',
      'porta estreita, não portão aberto');
    ok('nem bloquear',
      direto('bloquear', { codigo: 'CR-00234', motivo: 'x' }).codigo === 'ACAO_EXIGE_SESSAO');
    ok('nem revogar',
      direto('revogar', { codigo: 'CR-00234', motivo: 'x' }).codigo === 'ACAO_EXIGE_SESSAO');
    ok('nem editar dados',
      direto('atualizar', { codigo: 'CR-00234', funcao: 'Chefe' }).codigo === 'ACAO_EXIGE_SESSAO');
    ok('nem ver o log de acessos',
      direto('acessos', {}).codigo === 'ACAO_EXIGE_SESSAO');
    ok('pedido ilegível não quebra',
      JSON.parse(AP_CRACHA_direto('{isso não é json')).codigo === 'PEDIDO_INVALIDO');

    /* ---------- 8. AUDITORIA ---------- */
    var acessos = AP_CR_acessos_({});
    ok('toda tentativa fica registrada', acessos.length >= 14, acessos.length + ' registro(s)');
    var bloqueios = acessos.filter(function (a) { return a.resultado === 'BLOQUEADO'; });
    ok('AS TENTATIVAS BARRADAS TAMBÉM FICAM', bloqueios.length >= 6,
      bloqueios.length + ' bloqueio(s) registrado(s)');
    ok('o registro diz o motivo de cada bloqueio',
      bloqueios.every(function (a) { return !!a.motivo; }),
      bloqueios.slice(0, 3).map(function (a) { return a.motivo; }).join(' · '));
    ok('o registro diz de onde veio',
      acessos.some(function (a) { return a.origem === 'entrada'; }));

    /* ---------- 9. PAINEL ---------- */
    var painel = AP_CR_painel_({});
    ok('o painel conta os crachás', painel.crachas.todos === 5, painel.crachas.todos + ' crachá(s)');
    ok('conta liberados e bloqueados do dia',
      painel.liberadosHoje > 0 && painel.bloqueadosHoje > 0,
      painel.liberadosHoje + ' liberados · ' + painel.bloqueadosHoje + ' bloqueados');
    ok('sabe quem ainda não tem crachá', painel.semCracha === 0,
      painel.semCracha + ' sem crachá');

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
  log.push('O que foi verificado: o QR não carrega dado pessoal, crachá com chave');
  log.push('errada não abre, entrar no sistema não dá permissão para tudo, crachá');
  log.push('de desligado é barrado, código digitado identifica mas não opera,');
  log.push('crachá perdido para de funcionar na reemissão, e toda tentativa —');
  log.push('principalmente as barradas — fica registrada com o motivo.');

  try { Logger.log(log.join('\n')); } catch (e) { }
  return log;
}
