/**
 * ============================================================
 * ALMOXA PRO — BACKUP AUTOMÁTICO
 * Versão 1.0.0
 * ------------------------------------------------------------
 * O QUE ELE FAZ
 *
 * Guarda uma cópia dos dados todo dia, no horário escolhido,
 * sem ninguém precisar clicar em nada.
 *
 * Roda no agendamento do próprio Google, no servidor deles. Não
 * depende de navegador aberto, nem do computador ligado, nem da
 * ponte instalada. Se o Apps Script está publicado, o backup
 * acontece.
 *
 * ------------------------------------------------------------
 * A REGRA QUE MANDA AQUI
 *
 * Nunca dizer "backup OK" só porque a função terminou.
 *
 * Depois de gravar, o arquivo é LIDO DE VOLTA, o tamanho é
 * conferido e o hash é recalculado. Se qualquer coisa não bater,
 * o resultado é "BACKUP NÃO CONFIRMADO" com o motivo real.
 *
 * Um backup em que não se pode confiar é pior que nenhum: dá
 * uma sensação de segurança que não existe.
 * ============================================================
 */

var AP_BKP_CFG = {
  versao: '1.0.0',

  abaHistorico: 'ALMOXA_BACKUP_HISTORICO',
  /* arquivoId precisa estar aqui: sem a coluna, o Data Layer
     descarta o campo e depois não há como localizar o arquivo
     no Drive para verificar ou restaurar. */
  colunas: ['id', 'quando', 'tipo', 'destino', 'pasta', 'arquivo', 'arquivoId',
    'tamanhoBytes', 'abas', 'linhas', 'hash', 'duracaoMs',
    'integridade', 'status', 'erro', 'versao', 'origem'],

  chaveConfig: 'BACKUP_AUTO_CONFIG',
  nomeFuncaoAgendada: 'AP_BKP_executarAgendado',
  pastaDrive: 'ALMOXA PRO — Backups',

  /* padrão; o administrador ajusta */
  padrao: {
    ativo: false,
    hora: 2,
    manterDias: 30,
    manterMinimo: 3,      /* nunca fica com menos que isto */
    destinoDrive: true
  }
};

/* ============================================================
   CONFIGURAÇÃO QUE PERSISTE DE VERDADE
   ============================================================ */

function AP_BKP_config() {
  try {
    var salvo = AP_Config_get(AP_BKP_CFG.chaveConfig, '');
    if (!salvo) return Object.assign({}, AP_BKP_CFG.padrao);

    var cfg = typeof salvo === 'string' ? JSON.parse(salvo) : salvo;
    return Object.assign({}, AP_BKP_CFG.padrao, cfg);
  } catch (e) {
    return Object.assign({}, AP_BKP_CFG.padrao);
  }
}

/**
 * Salva e CONFERE que salvou.
 *
 * O documento é explícito: não considerar salvo só porque o
 * botão foi apertado. Aqui a configuração é lida de volta antes
 * de dizer que deu certo.
 */
function AP_BKP_salvarConfig(nova, quem) {
  var atual = AP_BKP_config();
  var merge = Object.assign({}, atual, nova);
  merge.atualizadoEm = AP_Utils_now();
  merge.atualizadoPor = quem || 'sistema';

  AP_Config_set(AP_BKP_CFG.chaveConfig, JSON.stringify(merge));

  /* lê de volta — é o que prova a persistência */
  var conferida = AP_BKP_config();

  var bateu = String(conferida.hora) === String(merge.hora) &&
    !!conferida.ativo === !!merge.ativo &&
    String(conferida.manterDias) === String(merge.manterDias);

  if (!bateu) {
    return {
      ok: false, codigo: 'NAO_PERSISTIU',
      mensagem: 'A configuração não foi gravada. Verifique se a aba CONFIG está acessível.',
      enviada: merge, lida: conferida
    };
  }

  AP_Audit_log(quem, 'BACKUP_CONFIG_ALTERADA', 'BACKUP', '', {
    ativo: merge.ativo, hora: merge.hora, manterDias: merge.manterDias
  });

  return { ok: true, dados: conferida, confirmada: true };
}

/* ============================================================
   AGENDAMENTO
   ============================================================ */

/** Os agendamentos que existem hoje para o backup */
function AP_BKP_agendamentos_() {
  try {
    return ScriptApp.getProjectTriggers().filter(function (t) {
      return t.getHandlerFunction() === AP_BKP_CFG.nomeFuncaoAgendada;
    });
  } catch (e) {
    return [];
  }
}

/**
 * Cria o agendamento diário.
 *
 * Antes de criar, apaga os que já existem — senão cada vez que
 * alguém salvasse a configuração nasceria um agendamento novo, e
 * o backup rodaria três, quatro, dez vezes por dia.
 */
function AP_BKP_agendar(hora, quem) {
  hora = Math.max(0, Math.min(23, Number(hora) || AP_BKP_CFG.padrao.hora));

  var antigos = AP_BKP_agendamentos_();
  antigos.forEach(function (t) {
    try { ScriptApp.deleteTrigger(t); } catch (e) { }
  });

  try {
    ScriptApp.newTrigger(AP_BKP_CFG.nomeFuncaoAgendada)
      .timeBased()
      .atHour(hora)
      .everyDays(1)
      .create();
  } catch (e) {
    return {
      ok: false, codigo: 'AGENDAMENTO_FALHOU',
      mensagem: 'Não foi possível criar o agendamento: ' + e.message +
        '. Autorize o script a criar gatilhos (Executar uma vez no editor).'
    };
  }

  /* confere que existe exatamente um */
  var agora = AP_BKP_agendamentos_();
  if (agora.length !== 1) {
    return {
      ok: false, codigo: 'AGENDAMENTO_INCERTO',
      mensagem: 'Foram encontrados ' + agora.length + ' agendamentos. Esperado: 1.'
    };
  }

  AP_Audit_log(quem, 'BACKUP_AGENDADO', 'BACKUP', '', { hora: hora, removidos: antigos.length });

  return {
    ok: true,
    dados: {
      hora: hora, agendamentos: agora.length, removidos: antigos.length,
      proximaExecucao: AP_BKP_proxima_(hora)
    }
  };
}

function AP_BKP_desagendar(quem) {
  var antigos = AP_BKP_agendamentos_();
  antigos.forEach(function (t) {
    try { ScriptApp.deleteTrigger(t); } catch (e) { }
  });

  AP_Audit_log(quem, 'BACKUP_DESAGENDADO', 'BACKUP', '', { removidos: antigos.length });
  return { ok: true, dados: { removidos: antigos.length } };
}

function AP_BKP_proxima_(hora) {
  var agora = new Date();
  var proxima = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), hora, 0, 0);
  if (proxima <= agora) proxima.setDate(proxima.getDate() + 1);
  return proxima.toISOString();
}

/* ============================================================
   O BACKUP
   ============================================================ */

/**
 * Monta o conteúdo do backup.
 * Senha e token nunca entram — nem no arquivo, nem no hash.
 */
function AP_BKP_montarConteudo_() {
  var abas = [
    'ALMOXA_ITENS', 'ALMOXA_CATEGORIAS', 'ALMOXA_ESTOQUE', 'ALMOXA_MOVIMENTACOES',
    'ALMOXA_RESERVAS', 'ALMOXA_NOTAS', 'ALMOXA_COMPRAS', 'ALMOXA_EPI_FICHAS',
    'ALMOXA_FERRAMENTAS', 'ALMOXA_OBRAS', 'ALMOXA_LOCALIZACOES',
    'ALMOXA_PERFIS', 'ALMOXA_PERFIL_PERMISSOES', 'ALMOXA_ALCADAS',
    AP_SHEETS.USUARIOS
  ];

  var conteudo = {};
  var totalLinhas = 0;
  var falhas = [];

  abas.forEach(function (aba) {
    try {
      var linhas = AP_Data_rows(aba) || [];

      if (aba === AP_SHEETS.USUARIOS) {
        linhas = linhas.map(function (u) {
          var copia = {};
          Object.keys(u).forEach(function (k) {
            /* nada de senha, hash de senha ou token no arquivo */
            if (/senha|password|hash|token|salt|secret|chavePrivada/i.test(k)) return;
            copia[k] = u[k];
          });
          return copia;
        });
      }

      conteudo[aba] = linhas;
      totalLinhas += linhas.length;
    } catch (e) {
      falhas.push({ aba: aba, motivo: e.message });
    }
  });

  return {
    cabecalho: {
      sistema: 'ALMOXA PRO',
      versaoBackup: AP_BKP_CFG.versao,
      versaoSistema: AP_Config_get('SYSTEM_VERSION', ''),
      geradoEm: AP_Utils_now(),
      abas: Object.keys(conteudo).length,
      linhas: totalLinhas,
      falhas: falhas,
      aviso: 'Cópia de segurança. Não é o banco oficial — o Core continua sendo a autoridade. ' +
        'Senhas e credenciais não estão incluídas.'
    },
    dados: conteudo
  };
}

/** Hash do conteúdo, para conferir depois se o arquivo mudou */
function AP_BKP_hash_(texto) {
  try {
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texto, Utilities.Charset.UTF_8);
    return bytes.map(function (b) {
      var v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? '0' + v : v;
    }).join('');
  } catch (e) {
    return null;
  }
}

/** A pasta do Drive onde os backups ficam */
function AP_BKP_pastaDrive_() {
  var pastas = DriveApp.getFoldersByName(AP_BKP_CFG.pastaDrive);
  if (pastas.hasNext()) return pastas.next();
  return DriveApp.createFolder(AP_BKP_CFG.pastaDrive);
}

/**
 * Executa o backup, grava e CONFERE.
 *
 * A conferência é o que diferencia "acho que salvou" de
 * "está salvo": o arquivo é lido de volta do Drive, o tamanho é
 * comparado e o hash recalculado.
 */
function AP_BKP_executar(tipo, quem) {
  var t0 = new Date().getTime();
  var registro = {
    id: AP_Utils_generateId('BKP'),
    quando: AP_Utils_now(),
    tipo: tipo || 'AUTOMATICO',
    destino: 'GOOGLE_DRIVE',
    origem: quem || 'agendamento',
    versao: AP_BKP_CFG.versao
  };

  try {
    /* 1. montar */
    var pacote = AP_BKP_montarConteudo_();
    var texto = JSON.stringify(pacote);
    var hashEsperado = AP_BKP_hash_(texto);

    registro.abas = pacote.cabecalho.abas;
    registro.linhas = pacote.cabecalho.linhas;
    registro.hash = hashEsperado;
    registro.tamanhoBytes = texto.length;

    if (!pacote.cabecalho.linhas) {
      registro.status = 'NAO_CONFIRMADO';
      registro.integridade = 'SEM_DADOS';
      registro.erro = 'Nenhuma linha foi lida. Um backup vazio não protege nada.';
      registro.duracaoMs = new Date().getTime() - t0;
      AP_BKP_registrar_(registro);
      return { ok: false, codigo: 'BACKUP_VAZIO', mensagem: registro.erro, dados: registro };
    }

    /* 2. gravar */
    var agora = new Date();
    var nome = 'almoxa-backup-' +
      agora.getFullYear() + '-' +
      String(agora.getMonth() + 1).padStart(2, '0') + '-' +
      String(agora.getDate()).padStart(2, '0') + '-' +
      String(agora.getHours()).padStart(2, '0') +
      String(agora.getMinutes()).padStart(2, '0') + '.json';

    var pasta = AP_BKP_pastaDrive_();
    var arquivo = pasta.createFile(nome, texto, MimeType.PLAIN_TEXT);

    registro.arquivo = nome;
    registro.pasta = AP_BKP_CFG.pastaDrive;
    registro.arquivoId = arquivo.getId();

    /* 3. CONFERIR — sem isto, "OK" é chute */
    var lido;
    try {
      lido = DriveApp.getFileById(arquivo.getId()).getBlob().getDataAsString();
    } catch (e) {
      registro.status = 'NAO_CONFIRMADO';
      registro.integridade = 'NAO_LEU';
      registro.erro = 'O arquivo foi criado, mas não pôde ser lido de volta: ' + e.message;
      registro.duracaoMs = new Date().getTime() - t0;
      AP_BKP_registrar_(registro);
      return { ok: false, codigo: 'NAO_CONFIRMADO', mensagem: registro.erro, dados: registro };
    }

    if (lido.length !== texto.length) {
      registro.status = 'NAO_CONFIRMADO';
      registro.integridade = 'TAMANHO_DIFERENTE';
      registro.erro = 'O arquivo gravado tem ' + lido.length +
        ' caracteres, mas deveria ter ' + texto.length + '.';
      registro.duracaoMs = new Date().getTime() - t0;
      AP_BKP_registrar_(registro);
      return { ok: false, codigo: 'NAO_CONFIRMADO', mensagem: registro.erro, dados: registro };
    }

    var hashLido = AP_BKP_hash_(lido);
    if (hashEsperado && hashLido !== hashEsperado) {
      registro.status = 'NAO_CONFIRMADO';
      registro.integridade = 'HASH_DIFERENTE';
      registro.erro = 'O conteúdo gravado não confere com o original.';
      registro.duracaoMs = new Date().getTime() - t0;
      AP_BKP_registrar_(registro);
      return { ok: false, codigo: 'NAO_CONFIRMADO', mensagem: registro.erro, dados: registro };
    }

    /* 4. só agora é confirmado */
    registro.status = 'CONFIRMADO';
    registro.integridade = 'CONFIRMADA';
    registro.erro = '';
    registro.duracaoMs = new Date().getTime() - t0;

    AP_BKP_registrar_(registro);
    AP_BKP_limparAntigos_(quem);

    AP_Audit_log(quem || 'agendamento', 'BACKUP_CONFIRMADO', 'BACKUP', registro.id, {
      arquivo: nome, linhas: registro.linhas, bytes: registro.tamanhoBytes
    });

    return { ok: true, dados: registro, confirmado: true };

  } catch (e) {
    registro.status = 'FALHOU';
    registro.integridade = 'NAO_VERIFICADA';
    registro.erro = e.message;
    registro.duracaoMs = new Date().getTime() - t0;

    try { AP_BKP_registrar_(registro); } catch (e2) { }
    AP_ErrorHandler_capture('AP_BKP_executar', e);

    return { ok: false, codigo: 'BACKUP_FALHOU', mensagem: e.message, dados: registro };
  }
}

function AP_BKP_registrar_(registro) {
  AP_Data_getSheet(AP_BKP_CFG.abaHistorico, AP_BKP_CFG.colunas);
  AP_Data_append(AP_BKP_CFG.abaHistorico, registro);
}

function AP_BKP_historico(limite) {
  AP_Data_getSheet(AP_BKP_CFG.abaHistorico, AP_BKP_CFG.colunas);
  var todos = (AP_Data_rows(AP_BKP_CFG.abaHistorico) || []).slice().reverse();
  return limite ? todos.slice(0, limite) : todos;
}

/**
 * Apaga backups velhos — com uma trava.
 *
 * Nunca deixa o sistema com menos que o mínimo de cópias
 * confirmadas. Apagar o único backup válido para respeitar uma
 * política de retenção seria o pior desfecho possível.
 */
function AP_BKP_limparAntigos_(quem) {
  var cfg = AP_BKP_config();
  var dias = Number(cfg.manterDias) || 30;
  var minimo = Number(cfg.manterMinimo) || 3;

  var confirmados = AP_BKP_historico().filter(function (b) {
    return b.status === 'CONFIRMADO';
  });

  if (confirmados.length <= minimo) return { removidos: 0, motivo: 'MINIMO_PROTEGIDO' };

  var limite = new Date();
  limite.setDate(limite.getDate() - dias);

  var candidatos = confirmados.filter(function (b) {
    return new Date(b.quando) < limite;
  });

  /* mesmo velhos, preserva o mínimo */
  var podeRemover = Math.max(0, confirmados.length - minimo);
  candidatos = candidatos.slice(0, podeRemover);

  var removidos = 0;
  candidatos.forEach(function (b) {
    try {
      if (b.arquivoId) {
        DriveApp.getFileById(b.arquivoId).setTrashed(true);
        AP_Data_update(AP_BKP_CFG.abaHistorico, b.id, { status: 'REMOVIDO_POR_RETENCAO' });
        removidos++;
      }
    } catch (e) { /* já apagado à mão: segue */ }
  });

  if (removidos) {
    AP_Audit_log(quem || 'sistema', 'BACKUP_RETENCAO', 'BACKUP', '', {
      removidos: removidos, mantidos: confirmados.length - removidos
    });
  }

  return { removidos: removidos, mantidos: confirmados.length - removidos };
}

/* ============================================================
   A FUNÇÃO QUE O AGENDAMENTO CHAMA
   ============================================================ */

function AP_BKP_executarAgendado() {
  var cfg = AP_BKP_config();
  if (!cfg.ativo) return;

  var r = AP_BKP_executar('AUTOMATICO', 'agendamento');

  try {
    Logger.log(r.ok
      ? 'Backup confirmado: ' + r.dados.arquivo + ' (' + r.dados.linhas + ' linhas)'
      : 'Backup NÃO confirmado: ' + r.mensagem);
  } catch (e) { }

  return r;
}

/* ============================================================
   SITUAÇÃO — sem enfeitar
   ============================================================ */

function AP_BKP_status() {
  var cfg = AP_BKP_config();
  var agendamentos = AP_BKP_agendamentos_();
  var historico = AP_BKP_historico(30);

  var confirmados = historico.filter(function (b) { return b.status === 'CONFIRMADO'; });
  var ultimo = confirmados[0] || null;
  var ultimaTentativa = historico[0] || null;

  /* o estado é calculado, não declarado */
  var estado, mensagem;

  if (!cfg.ativo) {
    estado = 'DESLIGADO';
    mensagem = 'O backup automático está desligado. Nenhuma cópia está sendo feita.';
  } else if (!agendamentos.length) {
    estado = 'SEM_AGENDAMENTO';
    mensagem = 'O backup está marcado como ativo, mas NÃO há agendamento criado. ' +
      'Nenhuma cópia vai acontecer. Salve a configuração de novo para criar o agendamento.';
  } else if (!ultimo) {
    estado = 'AGUARDANDO_PRIMEIRO';
    mensagem = 'Agendado, mas nenhum backup foi confirmado ainda. ' +
      'O primeiro acontece no próximo horário — ou faça um agora para conferir.';
  } else {
    var horasDesde = (new Date() - new Date(ultimo.quando)) / 3600000;
    if (horasDesde > 48) {
      estado = 'ATRASADO';
      mensagem = 'O último backup confirmado foi há ' + Math.round(horasDesde / 24) +
        ' dia(s). Deveria ser diário. Verifique o agendamento.';
    } else {
      estado = 'EM_DIA';
      mensagem = 'Backup em dia.';
    }
  }

  return {
    ok: true,
    dados: {
      estado: estado,
      mensagem: mensagem,
      configuracao: cfg,
      agendamentoExiste: agendamentos.length > 0,
      quantosAgendamentos: agendamentos.length,
      proximaExecucao: cfg.ativo && agendamentos.length ? AP_BKP_proxima_(cfg.hora) : null,
      ultimoConfirmado: ultimo,
      ultimaTentativa: ultimaTentativa,
      totalConfirmados: confirmados.length,
      totalFalhas: historico.filter(function (b) {
        return b.status === 'FALHOU' || b.status === 'NAO_CONFIRMADO';
      }).length,
      pastaDrive: AP_BKP_CFG.pastaDrive
    }
  };
}

/** Confere se um backup gravado continua íntegro */
function AP_BKP_verificar(id) {
  var registro = AP_BKP_historico().filter(function (b) { return b.id === id; })[0];
  if (!registro) {
    return { ok: false, codigo: 'NAO_ENCONTRADO', mensagem: 'Backup não está no histórico.' };
  }

  if (!registro.arquivoId) {
    return { ok: false, codigo: 'SEM_ARQUIVO', mensagem: 'O registro não aponta para nenhum arquivo.' };
  }

  try {
    var texto = DriveApp.getFileById(registro.arquivoId).getBlob().getDataAsString();

    if (String(texto.length) !== String(registro.tamanhoBytes)) {
      return {
        ok: false, codigo: 'TAMANHO_DIFERENTE',
        mensagem: 'O arquivo tem ' + texto.length + ' caracteres; deveria ter ' + registro.tamanhoBytes + '.'
      };
    }

    var hash = AP_BKP_hash_(texto);
    if (registro.hash && hash !== registro.hash) {
      return {
        ok: false, codigo: 'INTEGRIDADE_COMPROMETIDA',
        mensagem: 'O conteúdo foi alterado depois do backup. Não use este arquivo para restaurar.'
      };
    }

    var pacote = JSON.parse(texto);
    return {
      ok: true,
      dados: {
        arquivo: registro.arquivo,
        quando: registro.quando,
        tamanhoBytes: texto.length,
        abas: pacote.cabecalho ? pacote.cabecalho.abas : null,
        linhas: pacote.cabecalho ? pacote.cabecalho.linhas : null,
        integridade: 'CONFIRMADA'
      }
    };
  } catch (e) {
    return { ok: false, codigo: 'FALHA_LEITURA', mensagem: 'Não foi possível ler o arquivo: ' + e.message };
  }
}

/* ============================================================
   MÓDULO
   ============================================================ */

function AP_Modulo_backupauto(acao, payload, sessao) {
  payload = payload || {};
  var quem = (sessao && sessao.usuario) || 'sistema';
  var perfil = String((sessao && sessao.perfil) || '').toLowerCase();
  var ehAdmin = perfil === 'admin' || perfil === 'administrador' || perfil === 'ti';

  try {
    switch (acao) {

      case 'status':
        return AP_BKP_status();

      case 'historico':
        return { ok: true, dados: AP_BKP_historico(Number(payload.limite) || 30) };

      case 'configurar': {
        if (!ehAdmin) {
          return { ok: false, codigo: 'SEM_PERMISSAO', mensagem: 'Só o administrador configura o backup.' };
        }

        var r = AP_BKP_salvarConfig({
          ativo: !!payload.ativo,
          hora: Number(payload.hora),
          manterDias: Number(payload.manterDias) || 30,
          destinoDrive: payload.destinoDrive !== false
        }, quem);

        if (!r.ok) return r;

        /* liga ou desliga o agendamento conforme a escolha */
        var agenda = payload.ativo
          ? AP_BKP_agendar(payload.hora, quem)
          : AP_BKP_desagendar(quem);

        if (!agenda.ok) {
          return {
            ok: false, codigo: agenda.codigo,
            mensagem: 'A configuração foi salva, mas o agendamento falhou: ' + agenda.mensagem,
            dados: { configuracao: r.dados, agendamento: agenda }
          };
        }

        return {
          ok: true,
          dados: { configuracao: r.dados, agendamento: agenda.dados },
          mensagem: payload.ativo
            ? 'Backup automático ligado para as ' + payload.hora + 'h.'
            : 'Backup automático desligado.'
        };
      }

      case 'agora': {
        if (!ehAdmin) {
          return { ok: false, codigo: 'SEM_PERMISSAO', mensagem: 'Só o administrador executa backup.' };
        }
        return AP_BKP_executar('MANUAL', quem);
      }

      case 'verificar':
        if (!payload.id) return { ok: false, codigo: 'SEM_ID', mensagem: 'Informe qual backup verificar.' };
        return AP_BKP_verificar(payload.id);

      case 'agendamentos':
        return {
          ok: true,
          dados: {
            quantos: AP_BKP_agendamentos_().length,
            funcao: AP_BKP_CFG.nomeFuncaoAgendada
          }
        };

      default:
        return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'backupauto.' + acao + ' não existe.' };
    }
  } catch (e) {
    AP_ErrorHandler_capture('AP_Modulo_backupauto:' + acao, e);
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'backupauto', acao: acao, mensagem: e.message };
  }
}

/* ============================================================
   PARA RODAR NO EDITOR
   ============================================================ */

/** Liga o backup automático diário. Rode uma vez. */
function BACKUP_ligarAutomatico() {
  var r = AP_Modulo_backupauto('configurar',
    { ativo: true, hora: 2, manterDias: 30 },
    { usuario: 'editor', perfil: 'admin' });

  var texto = r.ok
    ? '\n  BACKUP AUTOMÁTICO LIGADO\n' +
      '  Horário: ' + r.dados.configuracao.hora + 'h, todo dia\n' +
      '  Próxima execução: ' + r.dados.agendamento.proximaExecucao + '\n' +
      '  Pasta no Drive: ' + AP_BKP_CFG.pastaDrive + '\n\n' +
      '  Não depende de navegador aberto nem do computador ligado.\n'
    : '\n  NÃO FOI LIGADO\n  ' + r.mensagem + '\n';

  try { Logger.log(texto); } catch (e) { }
  return texto;
}

/** Situação do backup, em linguagem clara */
function BACKUP_situacao() {
  var r = AP_BKP_status();
  var d = r.dados;

  var marca = { EM_DIA: '🟢', AGUARDANDO_PRIMEIRO: '🟡', ATRASADO: '🟠',
    SEM_AGENDAMENTO: '🔴', DESLIGADO: '⚫' }[d.estado] || '🔵';

  var linhas = [];
  linhas.push('');
  linhas.push('  ' + marca + '  BACKUP — ' + d.estado.replace(/_/g, ' '));
  linhas.push('  ' + d.mensagem);
  linhas.push('');
  linhas.push('  Automático:       ' + (d.configuracao.ativo ? 'ligado' : 'desligado'));
  linhas.push('  Horário:          ' + d.configuracao.hora + 'h');
  linhas.push('  Agendamento:      ' + (d.agendamentoExiste ? 'existe' : 'NÃO EXISTE'));
  linhas.push('  Próxima execução: ' + (d.proximaExecucao || '—'));
  linhas.push('  Guardar por:      ' + d.configuracao.manterDias + ' dias');
  linhas.push('');

  if (d.ultimoConfirmado) {
    var u = d.ultimoConfirmado;
    linhas.push('  ÚLTIMO BACKUP CONFIRMADO');
    linhas.push('  Quando:      ' + u.quando);
    linhas.push('  Arquivo:     ' + u.arquivo);
    linhas.push('  Tamanho:     ' + Math.round(Number(u.tamanhoBytes) / 1024) + ' KB');
    linhas.push('  Conteúdo:    ' + u.abas + ' abas, ' + u.linhas + ' linhas');
    linhas.push('  Integridade: ' + u.integridade);
  } else {
    linhas.push('  NENHUM BACKUP CONFIRMADO AINDA');
  }

  linhas.push('');
  linhas.push('  Confirmados: ' + d.totalConfirmados + '  ·  Falhas: ' + d.totalFalhas);

  var texto = linhas.join('\n');
  try { Logger.log(texto); } catch (e) { }
  return texto;
}

/* ============================================================
   TESTE
   ============================================================ */
function testeBackupAutomatico() {
  var log = [];
  function reg(t, ok, d) { log.push((ok ? 'OK    ' : 'ERRO  ') + t + (d ? ' — ' + d : '')); }

  var admin = { usuario: 'ismael', perfil: 'admin' };
  var comum = { usuario: 'joao', perfil: 'colaborador' };

  try {
    /* ---------- SÓ ADMIN ---------- */
    var negado = AP_Modulo_backupauto('configurar', { ativo: true, hora: 3 }, comum);
    reg('só o administrador configura', negado.ok === false && negado.codigo === 'SEM_PERMISSAO', '');

    var negado2 = AP_Modulo_backupauto('agora', {}, comum);
    reg('só o administrador executa backup', negado2.ok === false, negado2.codigo);

    /* ---------- CONFIGURAÇÃO PERSISTE ---------- */
    var cfg = AP_BKP_salvarConfig({ ativo: true, hora: 3, manterDias: 15 }, 'ismael');
    reg('salva a configuração', cfg.ok, cfg.ok ? 'confirmada por releitura' : cfg.mensagem);

    var lida = AP_BKP_config();
    reg('a configuração persiste de verdade',
      lida.hora === 3 && lida.manterDias === 15 && lida.ativo === true,
      'hora ' + lida.hora + ', ' + lida.manterDias + ' dias');

    /* ---------- BACKUP COM CONFERÊNCIA ---------- */
    AP_Modulo_categorias('salvar', { nome: 'Materiais' });
    for (var i = 1; i <= 5; i++) {
      AP_Modulo_itens('salvar', {
        descricao: 'Item de backup ' + i, categoria: 'Materiais',
        unidade: 'un', valorUnitario: i, confirmadoNovo: true
      });
    }

    var bk = AP_BKP_executar('MANUAL', 'ismael');
    reg('faz o backup', bk.ok, bk.ok ? bk.dados.arquivo : bk.mensagem);
    reg('CONFIRMA lendo de volta',
      bk.ok && bk.dados.integridade === 'CONFIRMADA' && bk.dados.status === 'CONFIRMADO',
      'não diz OK sem conferir');
    reg('gera hash do conteúdo', bk.ok && (bk.dados.hash || '').length === 64,
      bk.ok && bk.dados.hash ? bk.dados.hash.slice(0, 16) + '…' : 'sem hash');
    reg('registra o que guardou',
      bk.ok && bk.dados.linhas > 0 && bk.dados.abas > 0,
      bk.ok ? bk.dados.abas + ' abas, ' + bk.dados.linhas + ' linhas' : '');

    /* ---------- SENHA NÃO ENTRA ---------- */
    var pacote = AP_BKP_montarConteudo_();
    var texto = JSON.stringify(pacote);
    reg('senha NÃO vai no backup',
      !/"senha"|"senhaHash"|"password"/.test(texto), 'nem o hash da senha');

    /* ---------- HISTÓRICO ---------- */
    var hist = AP_BKP_historico();
    reg('registra no histórico', hist.length > 0, hist.length + ' registro(s)');
    reg('o histórico guarda a integridade',
      hist[0].integridade === 'CONFIRMADA', hist[0].integridade);

    /* ---------- VERIFICAÇÃO POSTERIOR ---------- */
    var ver = AP_BKP_verificar(bk.dados.id);
    reg('confere um backup antigo', ver.ok && ver.dados.integridade === 'CONFIRMADA', '');

    var verInexistente = AP_BKP_verificar('NAO-EXISTE');
    reg('avisa backup inexistente', verInexistente.ok === false, verInexistente.codigo);

    /* ---------- SITUAÇÃO SEM ENFEITE ---------- */
    var st = AP_BKP_status();
    reg('a situação é calculada, não declarada',
      st.dados.estado && st.dados.mensagem, st.dados.estado);
    reg('sabe se há agendamento', typeof st.dados.agendamentoExiste === 'boolean',
      st.dados.agendamentoExiste ? 'existe' : 'não existe');

    /* ativo sem agendamento tem que ser denunciado */
    AP_BKP_salvarConfig({ ativo: true }, 'ismael');
    AP_BKP_desagendar('ismael');
    var semAgenda = AP_BKP_status();
    reg('DENUNCIA ativo sem agendamento',
      semAgenda.dados.estado === 'SEM_AGENDAMENTO',
      semAgenda.dados.mensagem.slice(0, 60));

    /* ---------- RETENÇÃO NÃO APAGA O ÚLTIMO ---------- */
    AP_BKP_salvarConfig({ manterDias: 0, manterMinimo: 3 }, 'ismael');
    var antes = AP_BKP_historico().filter(function (b) { return b.status === 'CONFIRMADO'; }).length;
    AP_BKP_limparAntigos_('ismael');
    var depois = AP_BKP_historico().filter(function (b) { return b.status === 'CONFIRMADO'; }).length;
    reg('NUNCA apaga os últimos backups', depois >= Math.min(antes, 3),
      antes + ' → ' + depois + ' (mínimo protegido)');

  } catch (e) {
    log.push('ERRO  exceção: ' + e.message);
  }

  try { Logger.log(log.join('\n')); } catch (e) { }
  return log;
}
