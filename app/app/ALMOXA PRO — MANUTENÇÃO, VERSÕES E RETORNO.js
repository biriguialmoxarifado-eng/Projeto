/**
 * ============================================================
 * ALMOXA PRO — MANUTENÇÃO, VERSÕES E RETORNO
 * Versão 1.0.0
 * ------------------------------------------------------------
 * O QUE ESTE ARQUIVO RESOLVE
 *
 * "Muitas vezes não consigo voltar a versão anterior."
 *
 * No Apps Script há duas coisas diferentes, e é importante não
 * confundir:
 *
 *  1. VOLTAR O CÓDIGO  — feito pelo próprio Apps Script, em
 *     Implantar > Gerenciar implantações > Versão. Só quem tem
 *     acesso ao editor faz isso, e este arquivo NÃO tenta fazer
 *     por você (seria mentira: o script não pode reimplantar a
 *     si mesmo sem credencial de administrador do projeto).
 *     O que ele faz é REGISTRAR cada versão publicada, para você
 *     saber exatamente a qual voltar.
 *
 *  2. VOLTAR OS DADOS — este arquivo faz de verdade. Antes de
 *     atualizar, ele tira uma cópia das abas. Se a atualização
 *     estragar alguma coisa, você restaura os dados como estavam.
 *
 * Além disso, o MODO DE MANUTENÇÃO congela as gravações enquanto
 * você mexe no sistema, sem tirar ninguém do ar: a consulta
 * continua funcionando.
 * ============================================================
 */

var AP_MANUT_CFG = {
  versao: '1.0.0',
  chaveModo: 'MODO_MANUTENCAO',
  abaVersoes: 'ALMOXA_VERSOES',
  abaSnapshots: 'ALMOXA_SNAPSHOTS',
  colunasVersoes: ['id', 'quando', 'versao', 'descricao', 'modulos', 'autor', 'situacao'],
  colunasSnapshots: ['id', 'quando', 'descricao', 'abas', 'linhas', 'autor', 'planilhaId'],
  /* abas que fazem parte do backup */
  abasDados: ['ALMOXA_ITENS', 'ALMOXA_CATEGORIAS', 'ALMOXA_MOVIMENTACOES', 'ALMOXA_RESERVAS',
    'ALMOXA_NOTAS', 'ALMOXA_COMPRAS', 'ALMOXA_EPI_FICHAS', 'ALMOXA_FERRAMENTAS',
    'ALMOXA_OCORRENCIAS', 'ALMOXA_INVENTARIOS', 'ALMOXA_PROJETOS', 'ALMOXA_OBRAS',
    'ALMOXA_FORNECEDORES', 'ALMOXA_MURAL', 'USUARIOS', 'CONFIG']
};

/* ------------------------------------------------------------
   MODO DE MANUTENÇÃO
   ------------------------------------------------------------ */

function AP_MANUT_status() {
  var bruto = null;
  try { bruto = AP_Config_get(AP_MANUT_CFG.chaveModo, null); } catch (e) { bruto = null; }
  if (typeof bruto === 'string') { try { bruto = JSON.parse(bruto); } catch (e) { bruto = null; } }
  if (!bruto) return { ativo: false };
  return bruto;
}

function AP_MANUT_ativo() {
  return AP_MANUT_status().ativo === true;
}

/* ------------------------------------------------------------
   VERSÕES INSTALADAS
   ------------------------------------------------------------ */

/** Lê a versão declarada por cada módulo que está no projeto */
function AP_MANUT_versoesInstaladas() {
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  var mapa = [
    { modulo: 'Core Master', variavel: 'CORE_MASTER', campo: 'version' },
    { modulo: 'Entrada', variavel: 'AP_ENTRADA', campo: 'versao' },
    { modulo: 'Ponte', variavel: 'AP_BRIDGE_CONFIG', campo: 'versao' },
    { modulo: 'Usuários', variavel: 'AP_ADAPT_CFG', campo: 'versao' },
    { modulo: 'Itens', variavel: 'AP_ITENS_CFG', campo: 'versao' },
    { modulo: 'Operação', variavel: 'AP_OPER_CFG', campo: 'versao' },
    { modulo: 'Fluxo', variavel: 'AP_FLUXO_CFG', campo: 'versao' },
    { modulo: 'OCR', variavel: 'AP_OCR_CFG', campo: 'versao' },
    { modulo: 'Manutenção', variavel: 'AP_MANUT_CFG', campo: 'versao' }
  ];

  return mapa.map(function (m) {
    var alvo = g[m.variavel];
    var v = null;
    if (alvo) {
      v = (typeof alvo[m.campo] === 'function') ? alvo[m.campo]() : alvo[m.campo];
    }
    return {
      modulo: m.modulo,
      versao: v || null,
      instalado: !!alvo,
      situacao: alvo ? 'INSTALADO' : 'AUSENTE'
    };
  });
}

/** Handlers de módulo presentes no projeto */
function AP_MANUT_handlers() {
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  var achados = [];
  try {
    Object.keys(g).forEach(function (k) {
      if (/^AP_Modulo_/.test(k) && typeof g[k] === 'function') achados.push(k.replace('AP_Modulo_', ''));
    });
  } catch (e) { }
  return achados.sort();
}

/* ------------------------------------------------------------
   SNAPSHOT DOS DADOS — o que realmente permite voltar
   ------------------------------------------------------------ */

function AP_MANUT_aba_(nome, colunas) {
  return AP_Data_getSheet(nome, colunas);
}

/**
 * Copia a planilha inteira para um arquivo novo no Drive.
 * É a cópia que você restaura se a atualização estragar os dados.
 */
function AP_MANUT_snapshot(descricao, autor) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return { ok: false, codigo: 'SEM_PLANILHA', mensagem: 'Nenhuma planilha vinculada ao projeto.' };

  var carimbo = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HH-mm');
  var nome = 'ALMOXA_PRO_BACKUP_' + carimbo;

  var copiaId = null;
  try {
    var arquivo = DriveApp.getFileById(ss.getId());
    var copia = arquivo.makeCopy(nome);
    copiaId = copia.getId();
  } catch (e) {
    return {
      ok: false, codigo: 'BACKUP_FALHOU',
      mensagem: 'Não foi possível copiar a planilha: ' + e.message
    };
  }

  /* registra o que foi salvo */
  var resumo = [], totalLinhas = 0;
  ss.getSheets().forEach(function (aba) {
    var linhas = Math.max(0, aba.getLastRow() - 1);
    totalLinhas += linhas;
    resumo.push(aba.getName() + ':' + linhas);
  });

  var registro = {
    id: 'SNAP-' + carimbo,
    quando: AP_Utils_now(),
    descricao: descricao || 'Backup manual',
    abas: resumo.join(' | '),
    linhas: totalLinhas,
    autor: autor || 'sistema',
    planilhaId: copiaId
  };

  AP_MANUT_aba_(AP_MANUT_CFG.abaSnapshots, AP_MANUT_CFG.colunasSnapshots);
  AP_Data_append(AP_MANUT_CFG.abaSnapshots, registro);
  AP_Audit_log(autor || 'sistema', 'BACKUP_CRIADO', 'MANUTENCAO', registro.id,
    { linhas: totalLinhas, arquivo: nome });

  return { ok: true, dados: registro };
}

/**
 * Restaura os dados de um snapshot: copia as abas da cópia de
 * volta para a planilha ativa. As abas que não existiam no
 * backup NÃO são apagadas — nada é perdido sem aviso.
 */
function AP_MANUT_restaurar(snapshotId, autor) {
  var registro = AP_Data_findBy(AP_MANUT_CFG.abaSnapshots, { id: snapshotId })[0];
  if (!registro) return { ok: false, codigo: 'SNAPSHOT_NAO_ENCONTRADO', mensagem: 'Backup não localizado.' };
  if (!registro.planilhaId) return { ok: false, codigo: 'SEM_ARQUIVO', mensagem: 'O backup não tem arquivo vinculado.' };

  var origem, destino = SpreadsheetApp.getActiveSpreadsheet();
  try {
    origem = SpreadsheetApp.openById(registro.planilhaId);
  } catch (e) {
    return {
      ok: false, codigo: 'BACKUP_INACESSIVEL',
      mensagem: 'A cópia do backup não pôde ser aberta: ' + e.message
    };
  }

  /* antes de restaurar, guarda o estado atual — restauração também tem volta */
  var seguranca = AP_MANUT_snapshot('Antes de restaurar ' + snapshotId, autor);

  var restauradas = [], falhas = [];
  origem.getSheets().forEach(function (abaOrigem) {
    var nome = abaOrigem.getName();
    try {
      var dados = abaOrigem.getDataRange().getValues();
      var abaDestino = destino.getSheetByName(nome);
      if (!abaDestino) abaDestino = destino.insertSheet(nome);
      abaDestino.clear();
      if (dados.length && dados[0].length) {
        abaDestino.getRange(1, 1, dados.length, dados[0].length).setValues(dados);
      }
      restauradas.push(nome + ':' + Math.max(0, dados.length - 1));
    } catch (e) {
      falhas.push(nome + ' (' + e.message + ')');
    }
  });

  AP_Audit_log(autor || 'sistema', 'BACKUP_RESTAURADO', 'MANUTENCAO', snapshotId,
    { restauradas: restauradas.length, falhas: falhas.length });

  return {
    ok: falhas.length === 0,
    dados: {
      restauradas: restauradas, falhas: falhas,
      seguranca: seguranca.ok ? seguranca.dados.id : null
    },
    mensagem: falhas.length
      ? falhas.length + ' aba(s) não puderam ser restauradas.'
      : restauradas.length + ' aba(s) restauradas.'
  };
}

/* ------------------------------------------------------------
   MÓDULO
   ------------------------------------------------------------ */
function AP_Modulo_manutencao(acao, payload, sessao) {
  payload = payload || {};
  var autor = (sessao && (sessao.usuario || sessao.userId)) || 'sistema';

  try {
    switch (acao) {

      case 'status': {
        var st = AP_MANUT_status();
        return {
          ok: true,
          dados: {
            ativo: st.ativo === true,
            mensagem: st.mensagem || '',
            desde: st.desde || null,
            por: st.por || null,
            versoes: AP_MANUT_versoesInstaladas(),
            modulos: AP_MANUT_handlers()
          }
        };
      }

      case 'ativar': {
        AP_Config_set(AP_MANUT_CFG.chaveModo, JSON.stringify({
          ativo: true,
          mensagem: payload.mensagem || 'Sistema em manutenção. As consultas seguem disponíveis.',
          desde: AP_Utils_now(), por: autor
        }));
        AP_Audit_log(autor, 'MANUTENCAO_ATIVADA', 'MANUTENCAO', '', { mensagem: payload.mensagem });
        return { ok: true, dados: { ativo: true } };
      }

      case 'desativar': {
        AP_Config_set(AP_MANUT_CFG.chaveModo, JSON.stringify({ ativo: false, desde: AP_Utils_now(), por: autor }));
        AP_Audit_log(autor, 'MANUTENCAO_DESATIVADA', 'MANUTENCAO', '', {});
        return { ok: true, dados: { ativo: false } };
      }

      case 'versoes':
        return { ok: true, dados: { versoes: AP_MANUT_versoesInstaladas(), modulos: AP_MANUT_handlers() } };

      /** Registra a versão publicada, para você saber a qual voltar */
      case 'registrarVersao': {
        if (!payload.versao) {
          return { ok: false, codigo: 'CAMPO_OBRIGATORIO', mensagem: 'Informe o número da versão publicada.' };
        }
        AP_MANUT_aba_(AP_MANUT_CFG.abaVersoes, AP_MANUT_CFG.colunasVersoes);
        var reg = {
          id: AP_Utils_generateId('VER'), quando: AP_Utils_now(),
          versao: payload.versao, descricao: payload.descricao || '',
          modulos: JSON.stringify(AP_MANUT_versoesInstaladas()),
          autor: autor, situacao: 'PUBLICADA'
        };
        AP_Data_append(AP_MANUT_CFG.abaVersoes, reg);
        AP_Audit_log(autor, 'VERSAO_REGISTRADA', 'MANUTENCAO', payload.versao, {});
        return { ok: true, dados: reg };
      }

      case 'historico': {
        AP_MANUT_aba_(AP_MANUT_CFG.abaVersoes, AP_MANUT_CFG.colunasVersoes);
        AP_MANUT_aba_(AP_MANUT_CFG.abaSnapshots, AP_MANUT_CFG.colunasSnapshots);
        return {
          ok: true,
          dados: {
            versoes: AP_Data_rows(AP_MANUT_CFG.abaVersoes),
            backups: AP_Data_rows(AP_MANUT_CFG.abaSnapshots)
          }
        };
      }

      case 'backup':
        return AP_MANUT_snapshot(payload.descricao, autor);

      /**
       * Exporta os dados para guardar fora do sistema.
       *
       * Devolve o conteúdo das abas; quem grava é quem chamou —
       * a ponte, na pasta local, ou o Drive. O Core não escreve
       * em disco: ele só entrega os dados oficiais.
       */
      case 'exportar': {
        var abas = payload.abas || [
          'ALMOXA_ITENS', 'ALMOXA_CATEGORIAS', 'ALMOXA_ESTOQUE',
          'ALMOXA_MOVIMENTACOES', 'ALMOXA_RESERVAS', 'ALMOXA_NOTAS',
          'ALMOXA_COMPRAS', 'ALMOXA_EPI_FICHAS', 'ALMOXA_FERRAMENTAS',
          'ALMOXA_OBRAS', 'ALMOXA_LOCALIZACOES', AP_SHEETS.USUARIOS
        ];

        var conteudo = {};
        var totalLinhas = 0;
        var falhas = [];

        abas.forEach(function (aba) {
          try {
            var linhas = AP_Data_rows(aba) || [];
            /* a senha nunca sai do sistema, nem em backup */
            if (aba === AP_SHEETS.USUARIOS) {
              linhas = linhas.map(function (u) {
                var copia = {};
                Object.keys(u).forEach(function (k) {
                  if (/senha|hash|token|salt/i.test(k)) return;
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

        AP_Audit_log(autor, 'BACKUP_EXPORTADO', 'MANUTENCAO', '',
          { abas: Object.keys(conteudo).length, linhas: totalLinhas });

        return {
          ok: true,
          dados: {
            geradoEm: AP_Utils_now(),
            geradoPor: autor,
            versaoSistema: AP_Config_get('SYSTEM_VERSION', ''),
            abas: Object.keys(conteudo).length,
            totalLinhas: totalLinhas,
            falhas: falhas,
            /* aviso dentro do próprio arquivo, para quem abrir depois */
            aviso: 'Cópia para restauração. Não é o banco oficial — o Core continua sendo a autoridade. ' +
              'Senhas não são incluídas.',
            dados: conteudo
          }
        };
      }

      case 'restaurar': {
        if (!payload.id) return { ok: false, codigo: 'CAMPO_OBRIGATORIO', mensagem: 'Informe qual backup restaurar.' };
        if (!payload.confirmado) {
          return {
            ok: false, codigo: 'CONFIRMACAO_NECESSARIA',
            mensagem: 'A restauração substitui os dados atuais. Confirme para prosseguir.'
          };
        }
        return AP_MANUT_restaurar(payload.id, autor);
      }

      /** Conferência rápida depois de uma atualização */
      case 'verificar': {
        var problemas = [];
        var versoes = AP_MANUT_versoesInstaladas();
        versoes.filter(function (v) { return !v.instalado; }).forEach(function (v) {
          problemas.push('Módulo ausente: ' + v.modulo);
        });

        var g = (typeof globalThis !== 'undefined') ? globalThis : this;
        if (typeof g.almoxaApi !== 'function') problemas.push('almoxaApi não está instalada');
        if (typeof g.AP_ENTRADA_servir !== 'function') problemas.push('Entrada Única não está instalada');
        if (typeof g.doGet !== 'function') problemas.push('Nenhum doGet no projeto');

        try {
          SpreadsheetApp.getActiveSpreadsheet().getName();
        } catch (e) { problemas.push('Planilha inacessível: ' + e.message); }

        return {
          ok: problemas.length === 0,
          dados: { problemas: problemas, versoes: versoes, modulos: AP_MANUT_handlers() },
          mensagem: problemas.length ? problemas.length + ' problema(s) encontrado(s).' : 'Instalação íntegra.'
        };
      }

      default:
        return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'manutencao.' + acao + ' não existe.' };
    }
  } catch (e) {
    AP_ErrorHandler_capture('AP_Modulo_manutencao:' + acao, e);
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'manutencao', acao: acao, mensagem: e.message };
  }
}

/* ------------------------------------------------------------
   TESTE
   ------------------------------------------------------------ */
function testeModuloManutencao() {
  var log = [];
  function reg(t, ok, d) { log.push((ok ? 'OK    ' : 'ERRO  ') + t + (d ? ' — ' + d : '')); }

  try {
    var st = AP_Modulo_manutencao('status', {});
    reg('status responde', st.ok, 'manutenção ' + (st.dados.ativo ? 'ATIVA' : 'desligada'));
    reg('lista as versões instaladas', st.dados.versoes.length > 0,
      st.dados.versoes.filter(function (v) { return v.instalado; }).length + ' módulo(s) com versão');
    reg('lista os handlers', st.dados.modulos.length > 0, st.dados.modulos.length + ' handler(s)');

    var on = AP_Modulo_manutencao('ativar', { mensagem: 'Atualizando o sistema' }, { usuario: 'teste' });
    reg('ativa a manutenção', on.ok && AP_MANUT_ativo() === true, '');

    var off = AP_Modulo_manutencao('desativar', {}, { usuario: 'teste' });
    reg('desativa a manutenção', off.ok && AP_MANUT_ativo() === false, '');

    var semConfirmar = AP_Modulo_manutencao('restaurar', { id: 'QUALQUER' }, { usuario: 'teste' });
    reg('restauração exige confirmação', semConfirmar.ok === false &&
      semConfirmar.codigo === 'CONFIRMACAO_NECESSARIA', semConfirmar.codigo);

    var inexistente = AP_Modulo_manutencao('restaurar', { id: 'NAO_EXISTE', confirmado: true }, { usuario: 'teste' });
    reg('backup inexistente é recusado', inexistente.ok === false, inexistente.codigo);

    var v = AP_Modulo_manutencao('registrarVersao', { versao: '1.0.0', descricao: 'teste' }, { usuario: 'teste' });
    reg('registra a versão publicada', v.ok, v.ok ? v.dados.versao : v.mensagem);

    var h = AP_Modulo_manutencao('historico', {});
    reg('histórico disponível', h.ok, h.dados.versoes.length + ' versão(ões)');

    var chk = AP_Modulo_manutencao('verificar', {});
    reg('verificação de integridade', true,
      chk.ok ? 'instalação íntegra' : chk.dados.problemas.join(' | '));

  } catch (e) {
    log.push('ERRO  exceção: ' + e.message);
  }

  try { Logger.log(log.join('\n')); } catch (e) { }
  return log;
}


/* ============================================================
   MÓDULO BACKUP
   ------------------------------------------------------------
   A tela chama "backup"; as ações vivem em "manutencao". Este
   atalho evita duplicar a lógica só por causa do nome.
   ============================================================ */
function AP_Modulo_backup(acao, payload, sessao) {
  return AP_Modulo_manutencao(acao, payload, sessao);
}
