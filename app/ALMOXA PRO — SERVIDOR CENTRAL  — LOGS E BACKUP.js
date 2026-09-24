/* ============================================================
   ALMOXA PRO — SERVIDOR CENTRAL
   ETAPA 4 — LOGS E BACKUP
   ------------------------------------------------------------
   O QUE ESTE ARQUIVO ACRESCENTA

   O Core já sabia COPIAR (executarBackup). O que faltava era o
   resto da vida de um backup:

     · acontecer sozinho, todo dia e toda semana;
     · não encher o Drive para sempre;
     · poder voltar atrás sem destruir o que está lá;
     · e o log não crescer até a planilha travar.

   Ele NÃO reimplementa a cópia. Chama o executarBackup do Core.
   Backup feito de dois jeitos diferentes é backup que um dia
   copia coisas diferentes.

   AS TRÊS DECISÕES QUE VOCÊ PRECISA CONHECER

   1. BACKUP VELHO VAI PARA A LIXEIRA, NÃO SOME.
      A limpeza usa a lixeira do Drive, que segura 30 dias. Se eu
      errar a conta de quantos guardar, você tem um mês para
      perceber. Apagar de vez não tem volta.

   2. BACKUP MANUAL NUNCA É LIMPO AUTOMATICAMENTE.
      Backup manual é o que alguém fez de propósito, antes de
      alguma coisa arriscada. Esse é justamente o que não pode
      sumir sozinho.

   3. RESTAURAR NÃO SUBSTITUI NADA SEM ANTES COPIAR.
      Toda restauração faz um backup do estado atual primeiro. Se
      a restauração for a decisão errada, ainda dá para voltar do
      jeito que estava cinco minutos atrás.

   DEPENDE DE: ALMOXA_PRO_Servidor_Core.gs
   ============================================================ */

var AP_BK_CFG = {
  versao: '2.0.0-etapa4',
  /* quantas cópias guardar de cada tipo. MANUAL = 0 significa
     "não limpo nunca", não "não guardo nenhuma". */
  guardar: { DIARIO: 7, SEMANAL: 8, MANUAL: 0 },
  diasDeLog: 90,
  horaDoDiario: 2,
  horaDoSemanal: 3,
  rotinas: {
    AP_BK_diario: 'backup diário',
    AP_BK_semanal: 'backup semanal',
    AP_BK_manutencaoDeLogs: 'arquivamento dos logs'
  }
};

function AP_BK_dizer_(texto) {
  if (typeof AP_SRV_falar_ === 'function') return AP_SRV_falar_(texto);
  try { Logger.log(texto); } catch (e) { }
  return texto;
}

/* ============================================================
   AS ROTINAS AUTOMÁTICAS
   ------------------------------------------------------------
   Idempotente como todo o resto: rodar de novo não cria gatilho
   repetido. Gatilho duplicado significa backup rodando duas vezes
   na mesma madrugada e o dobro do consumo da cota do Drive.
   ============================================================ */
function ativarRotinasAutomaticas() {
  var existentes = {};
  var todos = ScriptApp.getProjectTriggers();
  for (var i = 0; i < todos.length; i++) {
    existentes[todos[i].getHandlerFunction()] = true;
  }

  var criados = [], jaTinha = [];

  if (!existentes.AP_BK_diario) {
    ScriptApp.newTrigger('AP_BK_diario').timeBased()
      .atHour(AP_BK_CFG.horaDoDiario).everyDays(1).inTimezone('America/Manaus').create();
    criados.push('backup diário às ' + AP_BK_CFG.horaDoDiario + 'h');
  } else jaTinha.push('backup diário');

  if (!existentes.AP_BK_semanal) {
    ScriptApp.newTrigger('AP_BK_semanal').timeBased()
      .onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(AP_BK_CFG.horaDoSemanal)
      .inTimezone('America/Manaus').create();
    criados.push('backup semanal, domingo às ' + AP_BK_CFG.horaDoSemanal + 'h');
  } else jaTinha.push('backup semanal');

  if (!existentes.AP_BK_manutencaoDeLogs) {
    ScriptApp.newTrigger('AP_BK_manutencaoDeLogs').timeBased()
      .onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(4)
      .inTimezone('America/Manaus').create();
    criados.push('arquivamento dos logs, segunda às 4h');
  } else jaTinha.push('arquivamento dos logs');

  registrarLog('SINCRONIZACAO', {
    modulo: 'BACKUP', acao: 'ativar rotinas', item: criados.join(' | ') || '(nada novo)',
    resultado: 'OK', detalhe: jaTinha.length + ' já existiam'
  });

  var l = ['=== ROTINAS AUTOMÁTICAS ==='];
  l.push(criados.length ? 'Criadas agora:' : 'Nada novo foi criado.');
  for (var c = 0; c < criados.length; c++) l.push('  · ' + criados[c]);
  if (jaTinha.length) {
    l.push('Já existiam (não mexi):');
    for (var j = 0; j < jaTinha.length; j++) l.push('  · ' + jaTinha[j]);
  }
  l.push('');
  l.push('O horário é aproximado — o Google roda dentro de uma janela de uma hora.');
  return AP_BK_dizer_(l.join('\n'));
}

function desativarRotinasAutomaticas() {
  var todos = ScriptApp.getProjectTriggers(), apagados = 0;
  for (var i = 0; i < todos.length; i++) {
    if (AP_BK_CFG.rotinas[todos[i].getHandlerFunction()]) {
      ScriptApp.deleteTrigger(todos[i]); apagados++;
    }
  }
  registrarLog('SINCRONIZACAO', {
    modulo: 'BACKUP', acao: 'desativar rotinas', resultado: 'OK', detalhe: apagados + ' removidas'
  });
  return AP_BK_dizer_(apagados + ' rotina(s) desligada(s). O backup manual continua funcionando.');
}

function verRotinas() {
  var todos = ScriptApp.getProjectTriggers();
  var l = ['=== ROTINAS DO SERVIDOR ==='], achou = 0;
  for (var i = 0; i < todos.length; i++) {
    var nome = todos[i].getHandlerFunction();
    if (!AP_BK_CFG.rotinas[nome]) continue;
    achou++;
    l.push('  · ' + AP_BK_CFG.rotinas[nome] + '   (' + nome + ')');
  }
  if (!achou) l.push('  (nenhuma ligada — rode ativarRotinasAutomaticas)');
  return AP_BK_dizer_(l.join('\n'));
}

/* ============================================================
   O QUE AS ROTINAS FAZEM
   ============================================================ */
function AP_BK_diario() { return AP_BK_rodar_('DIARIO'); }
function AP_BK_semanal() { return AP_BK_rodar_('SEMANAL'); }

function AP_BK_rodar_(tipo) {
  var comecou = new Date().getTime();
  var r = executarBackup({ tipo: tipo });

  if (!r.ok) {
    registrarLog('ERRO', {
      modulo: 'BACKUP', funcao: 'AP_BK_rodar_', gravidade: 'ALTA',
      mensagem: 'backup ' + tipo + ' falhou', detalhe: (r.falhou || []).join(', ') || r.mensagem
    });
  }

  var limpeza = limparBackupsAntigos(tipo);
  var segundos = Math.round((new Date().getTime() - comecou) / 100) / 10;

  registrarLog('SINCRONIZACAO', {
    modulo: 'BACKUP', acao: 'backup ' + tipo, item: r.pasta || '-',
    resultado: r.ok ? 'OK' : 'FALHOU',
    detalhe: (r.copiados || []).length + ' copiadas, ' +
      (limpeza.paraLixeira || 0) + ' antigas para a lixeira, ' + segundos + 's'
  });

  return { ok: r.ok, backup: r, limpeza: limpeza, segundos: segundos };
}

/* ============================================================
   LIMPEZA — PARA A LIXEIRA, NUNCA DE VEZ
   ============================================================ */
function limparBackupsAntigos(tipo, guardar) {
  tipo = String(tipo || 'DIARIO').toUpperCase();
  if (guardar === undefined) guardar = AP_BK_CFG.guardar[tipo];

  if (!guardar) {
    return { ok: true, paraLixeira: 0, guardadas: 0,
      mensagem: 'Backup ' + tipo + ' não é limpo automaticamente.' };
  }

  var caminho = '04_BACKUP/BACKUP_' + tipo;
  var registro = AP_SRV_registroLer_();
  var pasta = AP_SRV_pastaPorId_(registro[caminho]);
  if (!pasta) {
    return { ok: false, paraLixeira: 0, mensagem: 'A pasta ' + caminho + ' não existe.' };
  }

  var copias = [], it = pasta.getFolders();
  while (it.hasNext()) {
    var f = it.next();
    if (/^BACKUP_/.test(f.getName())) copias.push(f);
  }
  /* pelo nome, que carrega a data — mais confiável que a data de
     criação, que muda se alguém mover a pasta */
  copias.sort(function (a, b) { return a.getName() < b.getName() ? 1 : -1; });

  var paraLixeira = 0, nomes = [];
  for (var i = guardar; i < copias.length; i++) {
    try {
      copias[i].setTrashed(true);
      nomes.push(copias[i].getName());
      paraLixeira++;
    } catch (falha) { }
  }

  if (paraLixeira) {
    registrarLog('SINCRONIZACAO', {
      modulo: 'BACKUP', acao: 'limpeza ' + tipo, resultado: 'OK',
      item: nomes.join(', '),
      detalhe: 'para a lixeira do Drive, recuperável por 30 dias'
    });
  }

  return {
    ok: true, paraLixeira: paraLixeira,
    guardadas: Math.min(copias.length, guardar), nomes: nomes,
    mensagem: paraLixeira
      ? paraLixeira + ' cópia(s) antiga(s) foram para a lixeira. Guardei as ' + guardar + ' mais novas.'
      : 'Nada a limpar: ' + copias.length + ' cópia(s), guardando até ' + guardar + '.'
  };
}

/* ============================================================
   RESTAURAÇÃO CONTROLADA
   ------------------------------------------------------------
   Exige a palavra CONFIRMO escrita à mão. Não é burocracia: é o
   intervalo entre "acho que é esse backup" e apagar um mês de
   lançamentos por cima do banco certo.
   ============================================================ */
function AP_BK_listarCopias(tipo) {
  tipo = String(tipo || 'MANUAL').toUpperCase();
  var registro = AP_SRV_registroLer_();
  var pasta = AP_SRV_pastaPorId_(registro['04_BACKUP/BACKUP_' + tipo]);
  if (!pasta) return AP_BK_dizer_('A pasta de backup ' + tipo + ' não existe.');

  var l = ['=== CÓPIAS ' + tipo + ' ==='], achou = 0, it = pasta.getFolders();
  var lista = [];
  while (it.hasNext()) lista.push(it.next());
  lista.sort(function (a, b) { return a.getName() < b.getName() ? 1 : -1; });
  for (var i = 0; i < lista.length; i++) {
    achou++;
    l.push('  ' + lista[i].getName() + '   id: ' + lista[i].getId());
  }
  if (!achou) l.push('  (nenhuma ainda)');
  return AP_BK_dizer_(l.join('\n'));
}

function restaurarBanco(nomeBanco, idDaPastaDeBackup, confirmacao) {
  if (String(confirmacao) !== 'CONFIRMO') {
    return AP_BK_dizer_(
      'RESTAURAÇÃO NÃO EXECUTADA.\n\n' +
      'Para restaurar, chame assim:\n' +
      '  restaurarBanco("' + (nomeBanco || 'DB_PRODUTOS') + '", "id-da-pasta-do-backup", "CONFIRMO")\n\n' +
      'Antes disso, use AP_BK_listarCopias("MANUAL") para achar o id da cópia.\n' +
      'A restauração troca o conteúdo atual do banco pelo do backup — mas faz\n' +
      'uma cópia de segurança do estado de agora antes de encostar em qualquer coisa.');
  }

  var caminho = '01_BANCO_DADOS/' + nomeBanco;
  var item = null;
  for (var i = 0; i < AP_SRV_MAPA.length; i++) {
    if (AP_SRV_MAPA[i].caminho === caminho) { item = AP_SRV_MAPA[i]; break; }
  }
  if (!item) return AP_BK_dizer_('Não existe banco chamado "' + nomeBanco + '".');

  var pastaBk = AP_SRV_pastaPorId_(idDaPastaDeBackup);
  if (!pastaBk) return AP_BK_dizer_('Não consegui abrir a pasta de backup ' + idDaPastaDeBackup + '.');

  /* acha a cópia daquele banco dentro da pasta do backup */
  var copia = null, arquivos = pastaBk.getFiles();
  while (arquivos.hasNext()) {
    var a = arquivos.next();
    if (a.getName().indexOf(nomeBanco) === 0) { copia = a; break; }
  }
  if (!copia) {
    return AP_BK_dizer_('Nessa pasta de backup não tem cópia de ' + nomeBanco + '.');
  }

  var planilhaCopia;
  try { planilhaCopia = SpreadsheetApp.openById(copia.getId()); }
  catch (falha) { return AP_BK_dizer_('A cópia de ' + nomeBanco + ' não abriu como planilha.'); }

  var abaCopia = planilhaCopia.getSheetByName(item.aba) || planilhaCopia.getSheets()[0];
  var abaViva = AP_SRV_aba_(caminho);
  if (!abaViva) return AP_BK_dizer_('O banco ' + nomeBanco + ' não existe no servidor.');

  /* os cabeçalhos têm que bater, senão a restauração embaralha
     os dados de coluna — que é pior do que não restaurar */
  var cabCopia = AP_SRV_colunasDe_(abaCopia);
  var cabVivo = AP_SRV_colunasDe_(abaViva);
  var diferenca = [];
  for (var c = 0; c < cabVivo.length; c++) {
    if (cabCopia[c] !== cabVivo[c]) {
      diferenca.push('coluna ' + (c + 1) + ': backup tem "' + (cabCopia[c] || '(vazia)') +
        '", banco tem "' + cabVivo[c] + '"');
    }
  }
  if (diferenca.length) {
    return AP_BK_dizer_('RESTAURAÇÃO CANCELADA — os cabeçalhos não batem:\n  · ' +
      diferenca.join('\n  · ') +
      '\n\nRestaurar assim embaralharia os dados de coluna. Nada foi alterado.');
  }

  /* 1. a rede de segurança, ANTES de qualquer coisa */
  var seguranca = executarBackup({ tipo: 'MANUAL' });
  if (!seguranca.ok) {
    return AP_BK_dizer_('RESTAURAÇÃO CANCELADA: não consegui fazer a cópia de segurança do ' +
      'estado atual, e sem ela eu não mexo no banco.\n' + (seguranca.mensagem || ''));
  }

  /* 2. só então a troca */
  var linhas = abaCopia.getLastRow() > 1
    ? abaCopia.getRange(2, 1, abaCopia.getLastRow() - 1, cabVivo.length).getValues() : [];
  var tinha = Math.max(abaViva.getLastRow() - 1, 0);

  if (abaViva.getLastRow() > 1) {
    abaViva.getRange(2, 1, abaViva.getLastRow() - 1, abaViva.getLastColumn()).clearContent();
  }
  if (linhas.length) {
    abaViva.getRange(2, 1, linhas.length, cabVivo.length).setValues(linhas);
  }

  registrarLog('ALTERACAO', {
    modulo: 'BACKUP', tabela: nomeBanco, campo: '(restauração)',
    valor_anterior: tinha + ' linhas', valor_novo: linhas.length + ' linhas do backup',
    origem: 'restaurarBanco'
  });

  return AP_BK_dizer_('=== RESTAURAÇÃO CONCLUÍDA ===\n' +
    'Banco ............... ' + nomeBanco + '\n' +
    'Tinha ............... ' + tinha + ' linha(s)\n' +
    'Agora tem ........... ' + linhas.length + ' linha(s)\n' +
    'Cópia de segurança .. ' + seguranca.pasta + '\n\n' +
    'Se isso não era o que você queria, o estado de antes está naquela pasta.');
}

/* ============================================================
   MANUTENÇÃO DOS LOGS
   ------------------------------------------------------------
   Log cresce para sempre, e planilha do Google tem teto. As linhas
   velhas saem do log vivo e vão para um arquivo morto do ano —
   copiadas primeiro, CONFERIDAS, e só então removidas do vivo.

   Só sai o bloco do começo, e só enquanto for antigo. Log é
   escrito de cima para baixo, então o velho está sempre em cima.
   Se aparecer uma linha nova no meio, a varredura para ali — é
   melhor arquivar de menos do que arquivar o que não devia.
   ============================================================ */
function AP_BK_manutencaoDeLogs() { return arquivarLogsAntigos(AP_BK_CFG.diasDeLog); }

function arquivarLogsAntigos(dias) {
  dias = dias || AP_BK_CFG.diasDeLog;
  var corte = Utilities.formatDate(new Date(new Date().getTime() - dias * 86400000),
    'America/Manaus', 'yyyy-MM-dd HH:mm:ss');
  var resultado = { ok: true, dias: dias, corte: corte, movidas: 0, porLog: {}, erros: [] };

  for (var chave in AP_SRV_LOGS) {
    if (!AP_SRV_LOGS.hasOwnProperty(chave)) continue;
    var caminho = AP_SRV_LOGS[chave];
    try {
      var r = AP_BK_arquivarUm_(caminho, corte);
      resultado.porLog[caminho] = r.movidas;
      resultado.movidas += r.movidas;
      if (r.erro) resultado.erros.push(caminho + ': ' + r.erro);
    } catch (falha) {
      resultado.erros.push(caminho + ': ' + ((falha && falha.message) || falha));
    }
  }

  resultado.ok = resultado.erros.length === 0;
  registrarLog('SINCRONIZACAO', {
    modulo: 'BACKUP', acao: 'arquivar logs', resultado: resultado.ok ? 'OK' : 'PARCIAL',
    item: 'anteriores a ' + corte, detalhe: resultado.movidas + ' linha(s) arquivada(s)'
  });

  var l = ['=== ARQUIVAMENTO DOS LOGS ==='];
  l.push('Guardando os últimos ' + dias + ' dias (corte em ' + corte + ')');
  for (var k in resultado.porLog) {
    if (resultado.porLog.hasOwnProperty(k)) l.push('  · ' + k + ': ' + resultado.porLog[k]);
  }
  l.push('Total arquivado: ' + resultado.movidas + ' linha(s)');
  for (var e = 0; e < resultado.erros.length; e++) l.push('  ERRO: ' + resultado.erros[e]);
  AP_BK_dizer_(l.join('\n'));
  return resultado;
}

function AP_BK_arquivarUm_(caminho, corte) {
  var aba = AP_SRV_aba_(caminho);
  if (!aba) return { movidas: 0, erro: 'planilha não encontrada' };
  if (aba.getLastRow() < 2) return { movidas: 0 };

  var colunas = AP_SRV_colunasDe_(aba);
  var iData = colunas.indexOf('DATA_HORA');
  if (iData === -1) return { movidas: 0, erro: 'sem coluna DATA_HORA' };

  var linhas = aba.getRange(2, 1, aba.getLastRow() - 1, aba.getLastColumn()).getValues();
  var velhas = [];
  for (var i = 0; i < linhas.length; i++) {
    var d = AP_SRV_quando_(linhas[i][iData]);
    if (!d || d >= corte) break;   /* parou de ser antigo: para aqui */
    velhas.push(linhas[i]);
  }
  if (!velhas.length) return { movidas: 0 };

  var destino = AP_BK_abaDoArquivoMorto_(caminho, colunas);
  if (!destino) return { movidas: 0, erro: 'não consegui abrir o arquivo morto' };

  var antesNoDestino = destino.getLastRow();
  for (var v = 0; v < velhas.length; v++) destino.appendRow(velhas[v]);

  /* CONFERE antes de apagar. Copiar e apagar sem conferir é como
     assinar o recibo antes de contar o dinheiro. */
  var depoisNoDestino = destino.getLastRow();
  if (depoisNoDestino - antesNoDestino !== velhas.length) {
    return {
      movidas: 0,
      erro: 'a cópia para o arquivo morto não bateu (' + (depoisNoDestino - antesNoDestino) +
        ' de ' + velhas.length + '). NÃO apaguei nada do log.'
    };
  }

  aba.deleteRows(2, velhas.length);
  return { movidas: velhas.length };
}

/* O arquivo morto é uma planilha por log e por ano, na mesma pasta
   dos logs. Criada só quando precisa, e reaproveitada depois. */
function AP_BK_abaDoArquivoMorto_(caminhoDoLog, colunas) {
  var ano = new Date().getFullYear();
  var nomeLog = caminhoDoLog.split('/').pop();
  var nomeArquivo = nomeLog + '_ARQUIVO_' + ano;
  var caminho = '05_LOGS_AUDITORIA/' + nomeArquivo;

  var registro = AP_SRV_registroLer_();
  var pl = null;
  try { if (registro[caminho]) pl = SpreadsheetApp.openById(registro[caminho]); } catch (e) { pl = null; }

  if (!pl) {
    var pastaLogs = AP_SRV_pastaPorId_(registro['05_LOGS_AUDITORIA']);
    if (!pastaLogs) return null;
    var relatorio = { criados: 0, reaproveitados: 0, alertas: [], pendentes: [], erros: [] };
    pl = AP_SRV_garantirPlanilha_(pastaLogs,
      { aba: 'ARQUIVO', colunas: colunas }, caminho, registro, relatorio);
    AP_SRV_registroGravar_(registro);
    if (!pl) return null;
  }
  return pl.getSheetByName('ARQUIVO') || pl.getSheets()[0];
}

/* ============================================================
   AP_BK_testes() — A PROVA DA ETAPA 4
   ------------------------------------------------------------
   Nada do seu Drive é tocado. Os gatilhos, as pastas de backup e
   as planilhas são de mentira; tudo volta ao lugar no finally.

   O que está sendo provado:

   · ligar as rotinas duas vezes não cria gatilho repetido;
   · desligar não encosta em gatilho que não é nosso;
   · a limpeza joga fora as MAIS VELHAS e guarda as mais novas;
   · backup manual não é limpo nunca;
   · restaurar sem escrever CONFIRMO não faz nada;
   · cabeçalho diferente cancela a restauração antes de gravar;
   · se a cópia de segurança falhar, a restauração não acontece;
   · o log velho é copiado, CONFERIDO e só então removido;
   · se a cópia não bater, nada é apagado do log.
   ============================================================ */
function AP_BK_testes() {
  var log = [], falhas = 0;
  function ok(nome, passou, obs) {
    if (!passou) falhas++;
    log.push((passou ? 'PASSOU  ' : 'FALHOU  ') + nome + (obs ? '  [' + obs + ']' : ''));
  }

  var orig = {
    Script: (typeof ScriptApp !== 'undefined') ? ScriptApp : null,
    Planilhas: (typeof SpreadsheetApp !== 'undefined') ? SpreadsheetApp : null,
    Utils: (typeof Utilities !== 'undefined') ? Utilities : null,
    aba: AP_SRV_aba_, pasta: AP_SRV_pastaPorId_, ler: AP_SRV_registroLer_,
    gravar: AP_SRV_registroGravar_, garantir: AP_SRV_garantirPlanilha_,
    backup: executarBackup, logar: registrarLog, colunas: AP_SRV_colunasDe_
  };

  try {
    /* ---------------- planilha de mentira ---------------- */
    function novaAba(cabecalho, linhas) {
      var dados = [cabecalho.slice()];
      for (var i = 0; i < (linhas || []).length; i++) dados.push(linhas[i].slice());
      function garantir(l, c) {
        while (dados.length < l) dados.push([]);
        for (var i = 0; i < dados.length; i++) while (dados[i].length < c) dados[i].push('');
      }
      var eu = {
        __dados: dados,
        getLastRow: function () { return dados.length; },
        getLastColumn: function () { return cabecalho.length; },
        appendRow: function (l) { dados.push(l.slice()); return eu; },
        deleteRows: function (inicio, quantas) { dados.splice(inicio - 1, quantas); return eu; },
        getSheets: function () { return [eu]; },
        getRange: function (l, c, nl, nc) {
          nl = nl || 1; nc = nc || 1;
          return {
            getValues: function () {
              garantir(l + nl - 1, c + nc - 1);
              var s = [];
              for (var i = 0; i < nl; i++) s.push(dados[l - 1 + i].slice(c - 1, c - 1 + nc));
              return s;
            },
            setValues: function (v) {
              garantir(l + nl - 1, c + nc - 1);
              for (var i = 0; i < v.length; i++) {
                for (var j = 0; j < v[i].length; j++) dados[l - 1 + i][c - 1 + j] = v[i][j];
              }
              return this;
            },
            clearContent: function () {
              for (var i = 0; i < nl; i++) {
                for (var j = 0; j < nc; j++) {
                  if (dados[l - 1 + i]) dados[l - 1 + i][c - 1 + j] = '';
                }
              }
              /* o clearContent do Sheets esvazia, não remove linha —
                 aqui some com as linhas vazias do fim para o
                 getLastRow se comportar igual ao de verdade */
              while (dados.length > 1 &&
                dados[dados.length - 1].join('') === '') dados.pop();
              return this;
            }
          };
        }
      };
      return eu;
    }

    function novaPastaFalsa(nome, filhas, arquivos) {
      var eu = {
        __nome: nome, __id: 'pasta_' + nome, __filhas: filhas || [], __arquivos: arquivos || [],
        getId: function () { return eu.__id; },
        getName: function () { return eu.__nome; },
        getFolders: function () {
          /* o DriveApp de verdade NÃO lista o que está na lixeira.
             O falso tem que mentir igual, senão o teste mede outra
             coisa que não o Drive do Ismael. */
          var i = 0, l = eu.__filhas.filter(function (f) { return !f.__naLixeira; });
          return { hasNext: function () { return i < l.length; }, next: function () { return l[i++]; } };
        },
        getFiles: function () {
          var i = 0, l = eu.__arquivos;
          return { hasNext: function () { return i < l.length; }, next: function () { return l[i++]; } };
        }
      };
      return eu;
    }

    function copiaFalsa(nome) {
      var eu = {
        __nome: nome, __id: 'bk_' + nome, __naLixeira: false,
        getId: function () { return eu.__id; },
        getName: function () { return eu.__nome; },
        setTrashed: function (v) { eu.__naLixeira = v; return eu; }
      };
      return eu;
    }

    var ABAS = {}, PASTAS = {}, PLANILHAS = {}, REGISTRO = {}, LOGS = [];

    AP_SRV_aba_ = function (c) { return ABAS[c] || null; };
    AP_SRV_pastaPorId_ = function (id) { return PASTAS[id] || null; };
    AP_SRV_registroLer_ = function () { return REGISTRO; };
    AP_SRV_registroGravar_ = function () { };
    AP_SRV_colunasDe_ = orig.colunas;
    registrarLog = function (tipo, dados) { LOGS.push({ tipo: tipo, dados: dados }); return true; };
    Session = { getScriptTimeZone: function () { return 'America/Manaus'; } };
    Utilities = {
      formatDate: function (d) {
        function dd(n) { return (n < 10 ? '0' : '') + n; }
        return d.getFullYear() + '-' + dd(d.getMonth() + 1) + '-' + dd(d.getDate()) +
          ' ' + dd(d.getHours()) + ':' + dd(d.getMinutes()) + ':' + dd(d.getSeconds());
      }
    };

    /* ---------------- gatilhos de mentira ---------------- */
    var GATILHOS = [];
    function gatilho(nome) {
      return { getHandlerFunction: function () { return nome; } };
    }
    function construtor(nome) {
      var b = {
        timeBased: function () { return b; }, atHour: function () { return b; },
        everyDays: function () { return b; }, onWeekDay: function () { return b; },
        inTimezone: function () { return b; },
        create: function () { GATILHOS.push(gatilho(nome)); return b; }
      };
      return b;
    }
    ScriptApp = {
      WeekDay: { SUNDAY: 'DOM', MONDAY: 'SEG' },
      newTrigger: function (nome) { return construtor(nome); },
      getProjectTriggers: function () { return GATILHOS.slice(); },
      deleteTrigger: function (g) {
        for (var i = 0; i < GATILHOS.length; i++) {
          if (GATILHOS[i].getHandlerFunction() === g.getHandlerFunction()) {
            GATILHOS.splice(i, 1); return;
          }
        }
      }
    };

    /* ============================================================
       1. ROTINAS AUTOMÁTICAS
       ============================================================ */
    GATILHOS.push(gatilho('rotinaDoIsmael'));   /* um gatilho que não é nosso */
    ativarRotinasAutomaticas();
    ok('ligou as três rotinas', GATILHOS.length === 4, GATILHOS.length + ' gatilhos');

    ativarRotinasAutomaticas();
    ok('ligar de novo NÃO duplica gatilho', GATILHOS.length === 4, GATILHOS.length + ' gatilhos');

    var texto = verRotinas();
    ok('verRotinas lista as três', (texto.match(/·/g) || []).length === 3);
    ok('verRotinas não mostra gatilho que não é nosso', texto.indexOf('rotinaDoIsmael') === -1);

    desativarRotinasAutomaticas();
    ok('desligou as nossas e deixou a do Ismael',
      GATILHOS.length === 1 && GATILHOS[0].getHandlerFunction() === 'rotinaDoIsmael');
    ativarRotinasAutomaticas();

    /* ============================================================
       2. LIMPEZA — AS MAIS VELHAS VÃO PARA A LIXEIRA
       ============================================================ */
    var copias = [];
    for (var d = 1; d <= 10; d++) {
      copias.push(copiaFalsa('BACKUP_2026-09-' + (d < 10 ? '0' + d : d) + '_0200'));
    }
    PASTAS['pasta_diario'] = novaPastaFalsa('BACKUP_DIARIO', copias);
    REGISTRO['04_BACKUP/BACKUP_DIARIO'] = 'pasta_diario';

    var limpeza = limparBackupsAntigos('DIARIO');
    ok('jogou fora as 3 mais antigas', limpeza.paraLixeira === 3, limpeza.mensagem);
    ok('as que foram para a lixeira são as mais VELHAS',
      copias[0].__naLixeira && copias[1].__naLixeira && copias[2].__naLixeira);
    ok('as 7 mais novas ficaram',
      copias.slice(3).every(function (c) { return c.__naLixeira === false; }));
    ok('foi para a lixeira, não apagado de vez',
      JSON.stringify(LOGS).indexOf('recuperável por 30 dias') > -1);

    var limpezaDeNovo = limparBackupsAntigos('DIARIO');
    ok('limpar de novo não joga mais nada fora', limpezaDeNovo.paraLixeira === 0);

    PASTAS['pasta_manual'] = novaPastaFalsa('BACKUP_MANUAL', [
      copiaFalsa('BACKUP_2026-01-01_0900'), copiaFalsa('BACKUP_2026-02-01_0900'),
      copiaFalsa('BACKUP_2026-03-01_0900'), copiaFalsa('BACKUP_2026-04-01_0900'),
      copiaFalsa('BACKUP_2026-05-01_0900'), copiaFalsa('BACKUP_2026-06-01_0900'),
      copiaFalsa('BACKUP_2026-07-01_0900'), copiaFalsa('BACKUP_2026-08-01_0900'),
      copiaFalsa('BACKUP_2026-09-01_0900')
    ]);
    REGISTRO['04_BACKUP/BACKUP_MANUAL'] = 'pasta_manual';
    var limpezaManual = limparBackupsAntigos('MANUAL');
    ok('backup MANUAL nunca é limpo sozinho',
      limpezaManual.paraLixeira === 0 &&
      PASTAS['pasta_manual'].__filhas.every(function (c) { return !c.__naLixeira; }),
      limpezaManual.mensagem);

    /* ============================================================
       3. A ROTINA DIÁRIA CHAMA O BACKUP DO CORE
       ============================================================ */
    var chamadas = [];
    executarBackup = function (o) {
      chamadas.push(o.tipo);
      return { ok: true, pasta: 'bk-novo', copiados: ['a', 'b'], falhou: [], mensagem: '2 copiadas' };
    };
    var rodou = AP_BK_diario();
    ok('a rotina diária chama o executarBackup do Core, com o tipo certo',
      chamadas.length === 1 && chamadas[0] === 'DIARIO');
    ok('a rotina não reimplementa a cópia', rodou.ok === true && rodou.backup.copiados.length === 2);
    ok('o backup fica registrado no log',
      LOGS.some(function (l) {
        return l.tipo === 'SINCRONIZACAO' && String(l.dados.acao).indexOf('backup DIARIO') > -1;
      }));

    executarBackup = function () {
      return { ok: false, falhou: ['DB_PRODUTOS'], copiados: [], mensagem: 'sem permissão' };
    };
    AP_BK_semanal();
    ok('backup que falhou vira linha no log de ERRO',
      LOGS.some(function (l) { return l.tipo === 'ERRO' && String(l.dados.mensagem).indexOf('falhou') > -1; }));

    /* ============================================================
       4. RESTAURAÇÃO
       ============================================================ */
    var CAB = ['ID_PRODUTO', 'CODIGO', 'DESCRICAO'];
    ABAS['01_BANCO_DADOS/DB_PRODUTOS'] = novaAba(CAB, [
      ['PRD-1', 'A-1', 'como está hoje'],
      ['PRD-2', 'A-2', 'linha que veio depois do backup']
    ]);
    var abaViva = ABAS['01_BANCO_DADOS/DB_PRODUTOS'];

    var copiaBoa = { __id: 'arq-bom', getId: function () { return 'arq-bom'; }, getName: function () { return 'DB_PRODUTOS_2026-09-01'; } };
    PLANILHAS['arq-bom'] = {
      getSheetByName: function () { return PLANILHAS['arq-bom'].__aba; },
      getSheets: function () { return [PLANILHAS['arq-bom'].__aba]; },
      __aba: novaAba(CAB, [['PRD-1', 'A-1', 'como estava no backup']])
    };
    PASTAS['pasta-bk-1'] = novaPastaFalsa('BACKUP_2026-09-01_0200', [], [copiaBoa]);
    SpreadsheetApp = {
      openById: function (id) {
        if (!PLANILHAS[id]) throw new Error('não é planilha');
        return PLANILHAS[id];
      }
    };

    var semConfirmar = restaurarBanco('DB_PRODUTOS', 'pasta-bk-1');
    ok('sem escrever CONFIRMO, não restaura', semConfirmar.indexOf('NÃO EXECUTADA') > -1);
    ok('e o banco continua intacto', abaViva.getLastRow() === 3, abaViva.getLastRow() + ' linhas');

    /* cabeçalho diferente: tem que cancelar */
    PLANILHAS['arq-torto'] = {
      getSheetByName: function () { return PLANILHAS['arq-torto'].__aba; },
      getSheets: function () { return [PLANILHAS['arq-torto'].__aba]; },
      __aba: novaAba(['ID_PRODUTO', 'DESCRICAO', 'CODIGO'], [['PRD-9', 'trocado', 'X']])
    };
    var copiaTorta = { getId: function () { return 'arq-torto'; }, getName: function () { return 'DB_PRODUTOS_torto'; } };
    PASTAS['pasta-bk-torta'] = novaPastaFalsa('BACKUP_torto', [], [copiaTorta]);

    var tortoResultado = restaurarBanco('DB_PRODUTOS', 'pasta-bk-torta', 'CONFIRMO');
    ok('cabeçalho diferente CANCELA a restauração',
      tortoResultado.indexOf('CANCELADA') > -1 && tortoResultado.indexOf('não batem') > -1);
    ok('e nada foi alterado no banco', abaViva.getLastRow() === 3);

    /* cópia de segurança falhando: não restaura */
    executarBackup = function () { return { ok: false, mensagem: 'o Drive recusou' }; };
    var semRede = restaurarBanco('DB_PRODUTOS', 'pasta-bk-1', 'CONFIRMO');
    ok('sem cópia de segurança, a restauração não acontece',
      semRede.indexOf('CANCELADA') > -1 && abaViva.getLastRow() === 3);

    /* agora a restauração de verdade */
    var ordem = [];
    executarBackup = function (o) {
      ordem.push('backup-de-seguranca:' + abaViva.getLastRow());
      return { ok: true, pasta: 'bk-seguranca', copiados: ['x'], falhou: [] };
    };
    var feito = restaurarBanco('DB_PRODUTOS', 'pasta-bk-1', 'CONFIRMO');
    ok('a restauração aconteceu', feito.indexOf('CONCLUÍDA') > -1);
    ok('a cópia de segurança foi feita ANTES, com o conteúdo de antes',
      ordem.length === 1 && ordem[0] === 'backup-de-seguranca:3', ordem.join(','));
    ok('o banco ficou com o conteúdo do backup',
      abaViva.getLastRow() === 2 &&
      abaViva.getRange(2, 3, 1, 1).getValues()[0][0] === 'como estava no backup');
    ok('a restauração foi registrada no log',
      LOGS.some(function (l) {
        return l.tipo === 'ALTERACAO' && String(l.dados.campo).indexOf('restauração') > -1;
      }));
    ok('o relatório diz onde está a cópia de segurança',
      feito.indexOf('bk-seguranca') > -1);

    ok('banco que não existe é recusado',
      restaurarBanco('DB_FOGUETE', 'pasta-bk-1', 'CONFIRMO').indexOf('Não existe banco') > -1);

    /* ============================================================
       5. ARQUIVAMENTO DOS LOGS
       ============================================================ */
    var CAB_LOG = ['ID_LOG', 'DATA_HORA', 'USUARIO_ID', 'MODULO', 'FUNCAO',
      'MENSAGEM', 'DETALHE', 'GRAVIDADE'];
    function linhaLog(id, data) { return [id, data, 'u', 'm', 'f', 'msg', 'd', 'BAIXA']; }

    ABAS['05_LOGS_AUDITORIA/LOG_ERROS'] = novaAba(CAB_LOG, [
      linhaLog('L1', '2020-01-01 08:00:00'),
      linhaLog('L2', '2020-01-02 08:00:00'),
      linhaLog('L3', '2020-01-03 08:00:00'),
      linhaLog('L4', '2099-01-01 08:00:00'),
      linhaLog('L5', '2099-01-02 08:00:00')
    ]);
    ABAS['05_LOGS_AUDITORIA/LOG_ACESSOS'] = novaAba(CAB_LOG, []);
    ABAS['05_LOGS_AUDITORIA/LOG_ALTERACOES'] = novaAba(CAB_LOG, []);
    ABAS['05_LOGS_AUDITORIA/LOG_SINCRONIZACAO'] = novaAba(CAB_LOG, []);

    var morto = novaAba(CAB_LOG, []);
    PASTAS['pasta_logs'] = novaPastaFalsa('05_LOGS_AUDITORIA');
    REGISTRO['05_LOGS_AUDITORIA'] = 'pasta_logs';
    AP_SRV_garantirPlanilha_ = function () {
      return { getSheetByName: function () { return morto; }, getSheets: function () { return [morto]; } };
    };

    var arq = arquivarLogsAntigos(90);
    var vivo = ABAS['05_LOGS_AUDITORIA/LOG_ERROS'];
    ok('arquivou só as três antigas', arq.movidas === 3, arq.movidas + ' movidas');
    ok('as duas novas continuam no log vivo', vivo.getLastRow() === 3);
    ok('as novas são mesmo as que ficaram',
      vivo.getRange(2, 1, 2, 1).getValues().map(function (l) { return l[0]; }).join(',') === 'L4,L5');
    ok('as antigas estão no arquivo morto', morto.getLastRow() === 4,
      (morto.getLastRow() - 1) + ' linhas arquivadas');

    var arqDeNovo = arquivarLogsAntigos(90);
    ok('arquivar de novo não move nada', arqDeNovo.movidas === 0);

    /* o mesmo defeito que apareceu no relatório do Ismael: a data
       vindo como Date em vez de texto */
    ABAS['05_LOGS_AUDITORIA/LOG_ERROS'] = novaAba(CAB_LOG, [
      ['LD1', new Date(2020, 0, 1, 8, 0, 0), 'u', 'm', 'f', 'msg', 'd', 'BAIXA'],
      ['LD2', new Date(2099, 0, 1, 8, 0, 0), 'u', 'm', 'f', 'msg', 'd', 'BAIXA']
    ]);
    var mortoData = novaAba(CAB_LOG, []);
    AP_SRV_garantirPlanilha_ = function () {
      return { getSheetByName: function () { return mortoData; }, getSheets: function () { return [mortoData]; } };
    };
    var arqData = arquivarLogsAntigos(90);
    ok('arquiva certo mesmo quando a data vem como data, não como texto',
      arqData.movidas === 1 &&
      ABAS['05_LOGS_AUDITORIA/LOG_ERROS'].getLastRow() === 2,
      arqData.movidas + ' movida(s)');

    /* a cópia para o morto falhando: NÃO pode apagar do vivo */
    ABAS['05_LOGS_AUDITORIA/LOG_ERROS'] = novaAba(CAB_LOG, [
      linhaLog('L6', '2020-02-01 08:00:00'), linhaLog('L7', '2020-02-02 08:00:00')
    ]);
    var vivo2 = ABAS['05_LOGS_AUDITORIA/LOG_ERROS'];
    var mortoQuebrado = novaAba(CAB_LOG, []);
    mortoQuebrado.appendRow = function () { return mortoQuebrado; };   /* engole a linha */
    AP_SRV_garantirPlanilha_ = function () {
      return { getSheetByName: function () { return mortoQuebrado; }, getSheets: function () { return [mortoQuebrado]; } };
    };
    var arqFalho = arquivarLogsAntigos(90);
    ok('se a cópia não bater, NADA é apagado do log',
      vivo2.getLastRow() === 3 && arqFalho.movidas === 0, vivo2.getLastRow() + ' linhas no vivo');
    ok('e o problema é relatado', arqFalho.erros.length > 0 &&
      arqFalho.erros.join(' ').indexOf('NÃO apaguei') > -1);

  } catch (explodiu) {
    falhas++;
    log.push('FALHOU  o teste explodiu: ' + (explodiu && explodiu.stack || explodiu));
  } finally {
    if (orig.Script) ScriptApp = orig.Script;
    if (orig.Planilhas) SpreadsheetApp = orig.Planilhas;
    if (orig.Utils) Utilities = orig.Utils;
    AP_SRV_aba_ = orig.aba;
    AP_SRV_pastaPorId_ = orig.pasta;
    AP_SRV_registroLer_ = orig.ler;
    AP_SRV_registroGravar_ = orig.gravar;
    AP_SRV_garantirPlanilha_ = orig.garantir;
    AP_SRV_colunasDe_ = orig.colunas;
    executarBackup = orig.backup;
    registrarLog = orig.logar;
  }

  var texto = '=== ETAPA 4 — LOGS E BACKUP — ' +
    (falhas ? falhas + ' FALHA(S) DE ' + log.length : 'TODOS OS ' + log.length + ' TESTES PASSARAM') +
    ' ===\n' + log.join('\n');
  try { Logger.log(texto); } catch (e) { }
  return { ok: falhas === 0, total: log.length, falhas: falhas, texto: texto };
}
