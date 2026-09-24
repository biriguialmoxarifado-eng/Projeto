/* ============================================================
   ALMOXA PRO — SERVIDOR CENTRAL
   ETAPA 5 — DOUTOR DO SISTEMA
   ------------------------------------------------------------
   O QUE ELE É

   Um exame. Roda em cima do servidor de verdade e diz o que está
   errado, onde, quanto isso importa e o que fazer. Não conserta
   nada sozinho — e isso é a parte mais importante deste arquivo.

   POR QUE ELE NÃO CONSERTA SOZINHO

   Porque conserto automático em cima de diagnóstico errado é
   como remédio forte em cima de exame trocado. O Doutor olha,
   aponta e sugere. Quem decide é você, e os consertos ficam em
   funções separadas que você chama de propósito.

   A ÚNICA EXCEÇÃO é estrutura vazia: pasta e planilha que faltam
   são recriadas pelo instalarServidor, e isso você já autorizou
   quando rodou a instalação. Linha de dado, nunca.

   O QUE ELE EXAMINA

     · pastas, planilhas e cabeçalhos;
     · módulos registrados contra os que estão realmente no projeto;
     · a matriz de permissões (vazia, torta ou sem perfil);
     · sessões vencidas que ninguém encerrou;
     · quando foi o último backup e a última sincronização;
     · erros recentes, os mais graves primeiro;
     · registros duplicados — com o NÚMERO DA LINHA;
     · registros apontando para coisa que não existe;
     · planilha chegando perto do tamanho que trava.

   DEPENDE DE: Core (etapas 1 e 2) e Dados (etapa 3).
   O de Backup (etapa 4) é opcional — se não estiver instalado,
   o Doutor diz isso em vez de quebrar.
   ============================================================ */

var AP_DR_CFG = {
  versao: '2.0.0-etapa5',
  diasSemBackup: 2,
  diasDeErrosRecentes: 7,
  linhasParaAvisar: 20000,
  linhasDeLogParaAvisar: 5000,
  minutosMaximos: 4,
  gravidades: { CRITICA: 4, ALTA: 3, MEDIA: 2, BAIXA: 1 }
};

/* As peças que o servidor precisa ter. Se alguém apagar um arquivo
   do projeto, é aqui que aparece — antes de dar erro na obra. */
var AP_DR_PECAS = [
  { modulo: 'CORE', funcao: 'inicializarServidorALMOXA_PRO', arquivo: 'Servidor_Core', etapa: 1 },
  { modulo: 'CORE', funcao: 'registrarLog', arquivo: 'Servidor_Core', etapa: 1 },
  { modulo: 'CORE', funcao: 'executarBackup', arquivo: 'Servidor_Core', etapa: 1 },
  { modulo: 'RELATORIO', funcao: 'verServidor', arquivo: 'Servidor_Relatorio', etapa: 1 },
  { modulo: 'DADOS', funcao: 'AP_DB_inserir', arquivo: 'Servidor_Dados', etapa: 3 },
  { modulo: 'DADOS', funcao: 'AP_SEG_validarSessao', arquivo: 'Servidor_Dados', etapa: 3 },
  { modulo: 'DADOS', funcao: 'semearPermissoes', arquivo: 'Servidor_Dados', etapa: 3 },
  { modulo: 'BACKUP', funcao: 'ativarRotinasAutomaticas', arquivo: 'Servidor_Backup', etapa: 4 },
  { modulo: 'BACKUP', funcao: 'arquivarLogsAntigos', arquivo: 'Servidor_Backup', etapa: 4 }
];

/* Quem aponta para quem. Só confere valor preenchido — campo em
   branco é ausência, não erro. */
var AP_DR_REFERENCIAS = [
  { de: 'DB_ESTOQUE', campo: 'PRODUTO_ID', para: 'DB_PRODUTOS' },
  { de: 'DB_MOVIMENTACOES', campo: 'PRODUTO_ID', para: 'DB_PRODUTOS' },
  { de: 'DB_ITENS_NOTAS', campo: 'NOTA_ID', para: 'DB_NOTAS_FISCAIS' },
  { de: 'DB_ITENS_NOTAS', campo: 'PRODUTO_ID', para: 'DB_PRODUTOS' },
  { de: 'DB_FICHAS_EPI', campo: 'ITEM_ID', para: 'DB_EPI' },
  { de: 'DB_RESERVAS', campo: 'PRODUTO_ID', para: 'DB_PRODUTOS' },
  { de: 'DB_PATRIMONIO', campo: 'NOTA_ID', para: 'DB_NOTAS_FISCAIS' },
  { de: 'DB_USUARIOS', campo: 'EMPRESA_ID', para: 'DB_EMPRESAS' },
  { de: 'DB_PROJETOS', campo: 'EMPRESA_ID', para: 'DB_EMPRESAS' },
  { de: 'DB_EQUIPES', campo: 'EMPRESA_ID', para: 'DB_EMPRESAS' }
];

function AP_DR_dizer_(texto) {
  if (typeof AP_SRV_falar_ === 'function') return AP_SRV_falar_(texto);
  try { Logger.log(texto); } catch (e) { }
  return texto;
}

/* Existe essa função no projeto? O globalThis funciona no V8 do
   Apps Script; o eval fica de reserva para o caso de o projeto
   estar no motor antigo. */
function AP_DR_existe_(nome) {
  try {
    if (typeof globalThis !== 'undefined' && typeof globalThis[nome] === 'function') return true;
  } catch (e) { }
  try { return eval('typeof ' + nome) === 'function'; } catch (e2) { return false; }
}

function AP_DR_achado_(modulo, componente, problema, gravidade, sugestao, linha) {
  return {
    modulo: modulo, componente: componente, problema: problema,
    linha: (linha === undefined || linha === null) ? '-' : linha,
    gravidade: gravidade, data: AP_SRV_agora_(), sugestao: sugestao
  };
}

/* ============================================================
   O EXAME
   ============================================================ */
function doutorDoSistema(opcoes) {
  opcoes = opcoes || {};
  var comecou = new Date().getTime();
  var achados = [], resumo = {}, parou = null;

  function tempoAcabou() {
    return (new Date().getTime() - comecou) > AP_DR_CFG.minutosMaximos * 60000;
  }

  /* ---------- 1. a estrutura ---------- */
  var mapa = AP_SRV_mapaDeIds();
  if (!mapa.ok) {
    achados.push(AP_DR_achado_('CORE', 'pasta raiz', 'o servidor não foi instalado',
      'CRITICA', 'rodar instalarServidor()'));
    return AP_DR_fechar_(achados, {}, comecou, null);
  }
  resumo.versao = mapa.versao;
  resumo.raiz = mapa.raiz;

  var estrutura = validarEstruturaServidor();
  for (var i = 0; i < estrutura.ausentes.length; i++) {
    achados.push(AP_DR_achado_('CORE', estrutura.ausentes[i], 'pasta ausente',
      'ALTA', 'rodar instalarServidor() — recria pasta vazia sem tocar em dado'));
  }
  resumo.pastas = estrutura.presentes.length;

  var bancos = validarBancosDeDados();
  for (var j = 0; j < bancos.ausentes.length; j++) {
    achados.push(AP_DR_achado_('CORE', bancos.ausentes[j], 'planilha ausente',
      'CRITICA', 'rodar instalarServidor()'));
  }
  resumo.planilhas = bancos.presentes.length;

  var cab = validarCabecalhos();
  for (var k = 0; k < cab.problemas.length; k++) {
    achados.push(AP_DR_achado_('CORE', cab.problemas[k].componente, cab.problemas[k].problema,
      cab.problemas[k].gravidade || 'MEDIA', cab.problemas[k].sugestao));
  }

  /* ---------- 2. as peças do projeto ---------- */
  var faltando = [];
  for (var p = 0; p < AP_DR_PECAS.length; p++) {
    var peca = AP_DR_PECAS[p];
    var existe = AP_DR_existe_(peca.funcao);
    if (!existe) {
      faltando.push(peca.modulo);
      achados.push(AP_DR_achado_(peca.modulo, peca.funcao + '()',
        'função não encontrada — o arquivo ' + peca.arquivo + ' pode ter sido removido',
        peca.etapa <= 3 ? 'CRITICA' : 'ALTA',
        'reinstalar o arquivo ALMOXA_PRO_' + peca.arquivo + '.gs (etapa ' + peca.etapa + ')'));
    }
  }
  resumo.pecasFaltando = faltando.length;

  /* ---------- 3. os módulos registrados ---------- */
  try {
    var abaMod = AP_SRV_aba_('00_CORE/CORE_MODULOS');
    var registrados = {};
    if (abaMod && abaMod.getLastRow() > 1) {
      var colsM = AP_SRV_colunasDe_(abaMod);
      var linhasM = abaMod.getRange(2, 1, abaMod.getLastRow() - 1, abaMod.getLastColumn()).getValues();
      for (var m = 0; m < linhasM.length; m++) {
        registrados[String(linhasM[m][colsM.indexOf('NOME_MODULO')] || '').toUpperCase()] =
          linhasM[m][colsM.indexOf('VERSAO')];
      }
    }
    resumo.modulos = Object.keys(registrados).length;
    if (!registrados.CORE) {
      achados.push(AP_DR_achado_('CORE', 'CORE_MODULOS', 'o próprio CORE não está registrado',
        'MEDIA', 'rodar instalarServidor()'));
    }
  } catch (falha) {
    achados.push(AP_DR_achado_('CORE', 'CORE_MODULOS', 'não consegui ler: ' + falha.message,
      'ALTA', 'abrir a planilha e conferir'));
  }

  /* ---------- 4. as permissões ---------- */
  try {
    var abaPerm = AP_SRV_aba_('00_CORE/CORE_PERMISSOES');
    if (!abaPerm || abaPerm.getLastRow() < 2) {
      achados.push(AP_DR_achado_('DADOS', 'CORE_PERMISSOES', 'tabela de permissões vazia — ' +
        'nada é permitido, nem para o admin', 'CRITICA', 'rodar semearPermissoes()'));
      resumo.permissoes = 0;
    } else {
      var colsP = AP_SRV_colunasDe_(abaPerm);
      var linhasP = abaPerm.getRange(2, 1, abaPerm.getLastRow() - 1, abaPerm.getLastColumn()).getValues();
      resumo.permissoes = linhasP.length;
      var iPerm = colsP.indexOf('PERMITIDO'), iPerfil = colsP.indexOf('PERFIL');
      var temAdmin = false;
      for (var q = 0; q < linhasP.length; q++) {
        var valor = String(linhasP[q][iPerm] || '').trim();
        if (String(linhasP[q][iPerfil] || '').toLowerCase() === 'admin') temAdmin = true;
        if (valor && !/^(sim|nao|não|true|false|1|0|x|s|n)$/i.test(valor)) {
          achados.push(AP_DR_achado_('DADOS', 'CORE_PERMISSOES',
            'a coluna PERMITIDO está com "' + valor + '", que o sistema lê como NÃO',
            'ALTA', 'escrever SIM ou NAO', q + 2));
        }
      }
      if (!temAdmin) {
        achados.push(AP_DR_achado_('DADOS', 'CORE_PERMISSOES',
          'nenhuma regra para o perfil admin', 'ALTA',
          'sem isso ninguém administra o sistema — conferir a planilha'));
      }
    }
  } catch (falha2) {
    achados.push(AP_DR_achado_('DADOS', 'CORE_PERMISSOES', 'não consegui ler: ' + falha2.message,
      'ALTA', 'abrir a planilha e conferir'));
  }

  /* ---------- 5. sessões esquecidas ---------- */
  try {
    var abaSes = AP_SRV_aba_('00_CORE/CORE_SESSOES');
    if (abaSes && abaSes.getLastRow() > 1) {
      var colsS = AP_SRV_colunasDe_(abaSes);
      var linhasS = abaSes.getRange(2, 1, abaSes.getLastRow() - 1, abaSes.getLastColumn()).getValues();
      var agora = AP_SRV_agora_(), vencidasAbertas = 0;
      for (var s = 0; s < linhasS.length; s++) {
        var st = String(linhasS[s][colsS.indexOf('STATUS')] || '');
        var exp = AP_SRV_quando_(linhasS[s][colsS.indexOf('DATA_EXPIRACAO')]);
        if (st === 'ATIVA' && exp && exp < agora) vencidasAbertas++;
      }
      resumo.sessoes = linhasS.length;
      resumo.sessoesVencidas = vencidasAbertas;
      if (vencidasAbertas > 0) {
        achados.push(AP_DR_achado_('DADOS', 'CORE_SESSOES',
          vencidasAbertas + ' sessão(ões) vencida(s) ainda marcadas como ATIVA',
          'BAIXA', 'rodar encerrarSessoesVencidas("CONFIRMO") — elas já não entram, ' +
          'é só arrumação'));
      }
    }
  } catch (falha3) { }

  /* ---------- 6. backup e sincronização ---------- */
  try {
    var ultimo = AP_DR_ultimoBackup_();
    resumo.ultimoBackup = ultimo.quando || '(nenhum)';
    if (!ultimo.quando) {
      achados.push(AP_DR_achado_('BACKUP', '04_BACKUP', 'nenhum backup foi feito ainda',
        'ALTA', 'rodar backupAgora() e depois ativarRotinasAutomaticas()'));
    } else if (ultimo.diasAtras > AP_DR_CFG.diasSemBackup) {
      achados.push(AP_DR_achado_('BACKUP', '04_BACKUP',
        'o último backup foi há ' + ultimo.diasAtras + ' dias',
        ultimo.diasAtras > 7 ? 'ALTA' : 'MEDIA',
        'conferir as rotinas com verRotinas()'));
    }
    if (typeof ativarRotinasAutomaticas !== 'function') {
      achados.push(AP_DR_achado_('BACKUP', 'rotinas', 'o arquivo de backup não está instalado',
        'MEDIA', 'instalar ALMOXA_PRO_Servidor_Backup.gs (etapa 4)'));
    }
  } catch (falha4) { }

  try {
    var abaSinc = AP_SRV_aba_('05_LOGS_AUDITORIA/LOG_SINCRONIZACAO');
    if (abaSinc && abaSinc.getLastRow() > 1) {
      var colsSi = AP_SRV_colunasDe_(abaSinc);
      var ultimaLinha = abaSinc.getRange(abaSinc.getLastRow(), 1, 1, abaSinc.getLastColumn()).getValues()[0];
      resumo.ultimaSincronizacao = AP_SRV_quando_(ultimaLinha[colsSi.indexOf('DATA_HORA')]);
    } else resumo.ultimaSincronizacao = '(nenhuma)';
  } catch (falha5) { }

  /* ---------- 7. erros recentes ---------- */
  try {
    var abaErr = AP_SRV_aba_('05_LOGS_AUDITORIA/LOG_ERROS');
    if (abaErr && abaErr.getLastRow() > 1) {
      var colsE = AP_SRV_colunasDe_(abaErr);
      var linhasE = abaErr.getRange(2, 1, abaErr.getLastRow() - 1, abaErr.getLastColumn()).getValues();
      var corte = Utilities.formatDate(
        new Date(new Date().getTime() - AP_DR_CFG.diasDeErrosRecentes * 86400000),
        'America/Manaus', 'yyyy-MM-dd HH:mm:ss');
      var recentes = 0, exemplo = '';
      for (var e = 0; e < linhasE.length; e++) {
        if (AP_SRV_quando_(linhasE[e][colsE.indexOf('DATA_HORA')]) < corte) continue;
        recentes++;
        if (!exemplo) exemplo = String(linhasE[e][colsE.indexOf('MENSAGEM')] || '');
      }
      resumo.errosRecentes = recentes;
      if (recentes > 0) {
        achados.push(AP_DR_achado_('CORE', 'LOG_ERROS',
          recentes + ' erro(s) nos últimos ' + AP_DR_CFG.diasDeErrosRecentes +
          ' dias. O primeiro: ' + exemplo,
          recentes > 20 ? 'ALTA' : 'MEDIA', 'abrir a planilha LOG_ERROS e ler'));
      }
    }
  } catch (falha6) { }

  /* ---------- 8. duplicados, órfãos e tamanho ---------- */
  if (!opcoes.rapido) {
    var fundo = AP_DR_examinarOsBancos_(tempoAcabou);
    achados = achados.concat(fundo.achados);
    resumo.linhasNoTotal = fundo.linhas;
    resumo.duplicados = fundo.duplicados;
    resumo.orfaos = fundo.orfaos;
    if (fundo.parou) parou = fundo.parou;
  } else {
    resumo.exameDeFundo = 'pulado (modo rápido)';
  }

  return AP_DR_fechar_(achados, resumo, comecou, parou);
}

function AP_DR_examinarOsBancos_(tempoAcabou) {
  var achados = [], totalLinhas = 0, duplicados = 0, orfaos = 0, parou = null;
  var conteudo = {};

  for (var nome in AP_DB_REGRAS) {
    if (!AP_DB_REGRAS.hasOwnProperty(nome)) continue;
    if (tempoAcabou()) { parou = nome; break; }

    var caminho = '01_BANCO_DADOS/' + nome;
    var aba = AP_SRV_aba_(caminho);
    if (!aba) continue;

    var colunas = AP_SRV_colunasDe_(aba);
    var linhas = aba.getLastRow() > 1
      ? aba.getRange(2, 1, aba.getLastRow() - 1, aba.getLastColumn()).getValues() : [];
    conteudo[nome] = { colunas: colunas, linhas: linhas };
    totalLinhas += linhas.length;

    if (linhas.length > AP_DR_CFG.linhasParaAvisar) {
      achados.push(AP_DR_achado_(AP_DB_REGRAS[nome].modulo, nome,
        linhas.length + ' linhas — a planilha está ficando pesada',
        'MEDIA', 'arquivar o que já passou ou planejar a migração do banco'));
    }

    /* duplicados de verdade, com o número da linha */
    var regras = AP_DB_REGRAS[nome];
    var iExc = colunas.indexOf('EXCLUIDO');
    var iId = colunas.indexOf(regras.id);
    var conjuntos = regras.unicos || [];

    for (var c = 0; c < conjuntos.length; c++) {
      var vistos = {};
      for (var i = 0; i < linhas.length; i++) {
        if (iExc > -1 && String(linhas[i][iExc] || '').toUpperCase() === 'SIM') continue;
        var partes = [], temValor = false;
        for (var g = 0; g < conjuntos[c].length; g++) {
          var v = String(linhas[i][colunas.indexOf(conjuntos[c][g])] || '').trim().toUpperCase();
          if (v) temValor = true;
          partes.push(v);
        }
        if (!temValor) continue;
        var chave = partes.join('||');
        if (vistos[chave]) {
          duplicados++;
          achados.push(AP_DR_achado_(regras.modulo, nome,
            'repetido: ' + conjuntos[c].join(' + ') + ' = "' + partes.join(' + ') +
            '" (igual à linha ' + vistos[chave] + ')',
            'ALTA',
            'decidir qual fica e excluir o outro com AP_DB_excluir — não apague a linha à mão',
            i + 2));
        } else vistos[chave] = i + 2;
      }
    }

    /* IDs em branco: linha que o sistema não consegue achar depois */
    for (var b = 0; b < linhas.length; b++) {
      var vazia = linhas[b].join('').trim() === '';
      if (vazia) continue;
      if (iId > -1 && !String(linhas[b][iId] || '').trim()) {
        achados.push(AP_DR_achado_(regras.modulo, nome, 'linha sem ' + regras.id,
          'ALTA', 'provavelmente digitada direto na planilha — conferir e corrigir', b + 2));
      }
    }
  }

  /* referências apontando para o nada */
  for (var r = 0; r < AP_DR_REFERENCIAS.length; r++) {
    var ref = AP_DR_REFERENCIAS[r];
    var origem = conteudo[ref.de], destino = conteudo[ref.para];
    if (!origem || !destino) continue;

    var idDestino = AP_DB_REGRAS[ref.para].id;
    var iIdDestino = destino.colunas.indexOf(idDestino);
    var existentes = {};
    for (var d = 0; d < destino.linhas.length; d++) {
      existentes[String(destino.linhas[d][iIdDestino] || '')] = true;
    }

    var iCampo = origem.colunas.indexOf(ref.campo);
    if (iCampo === -1) continue;
    var contados = 0;
    for (var o = 0; o < origem.linhas.length; o++) {
      var valor = String(origem.linhas[o][iCampo] || '').trim();
      if (!valor) continue;
      if (existentes[valor]) continue;
      orfaos++; contados++;
      if (contados <= 3) {
        achados.push(AP_DR_achado_(AP_DB_REGRAS[ref.de].modulo, ref.de,
          ref.campo + ' = "' + valor + '" não existe em ' + ref.para,
          'MEDIA', 'conferir o cadastro de ' + ref.para + ' ou corrigir o registro',
          o + 2));
      }
    }
    if (contados > 3) {
      achados.push(AP_DR_achado_(AP_DB_REGRAS[ref.de].modulo, ref.de,
        'mais ' + (contados - 3) + ' registro(s) com ' + ref.campo + ' apontando para o nada',
        'MEDIA', 'conferir o cadastro de ' + ref.para));
    }
  }

  return { achados: achados, linhas: totalLinhas, duplicados: duplicados, orfaos: orfaos, parou: parou };
}

function AP_DR_ultimoBackup_() {
  var registro = AP_SRV_registroLer_();
  var melhor = '', tipos = ['DIARIO', 'SEMANAL', 'MANUAL'];
  for (var t = 0; t < tipos.length; t++) {
    var pasta = AP_SRV_pastaPorId_(registro['04_BACKUP/BACKUP_' + tipos[t]]);
    if (!pasta) continue;
    var it = pasta.getFolders();
    while (it.hasNext()) {
      var nome = it.next().getName();
      if (/^BACKUP_\d{4}-\d{2}-\d{2}/.test(nome) && nome > melhor) melhor = nome;
    }
  }
  if (!melhor) return { quando: null, diasAtras: null };

  var data = melhor.substring(7, 17);
  var dias = Math.floor((new Date().getTime() - new Date(data + 'T00:00:00').getTime()) / 86400000);
  return { quando: data, diasAtras: isNaN(dias) ? null : dias };
}

function AP_DR_fechar_(achados, resumo, comecou, parou) {
  achados.sort(function (a, b) {
    return (AP_DR_CFG.gravidades[b.gravidade] || 0) - (AP_DR_CFG.gravidades[a.gravidade] || 0);
  });

  var segundos = Math.round((new Date().getTime() - comecou) / 100) / 10;
  var contagem = { CRITICA: 0, ALTA: 0, MEDIA: 0, BAIXA: 0 };
  for (var i = 0; i < achados.length; i++) {
    if (contagem[achados[i].gravidade] !== undefined) contagem[achados[i].gravidade]++;
  }

  var l = [];
  l.push('=== DOUTOR DO SISTEMA — ALMOXA PRO ===');
  l.push('exame de ' + AP_SRV_agora_() + '  (' + segundos + 's)');
  l.push('');
  l.push('Versão ................. ' + (resumo.versao || '-'));
  l.push('Pastas no lugar ........ ' + (resumo.pastas !== undefined ? resumo.pastas : '-'));
  l.push('Planilhas no lugar ..... ' + (resumo.planilhas !== undefined ? resumo.planilhas : '-'));
  l.push('Módulos registrados .... ' + (resumo.modulos !== undefined ? resumo.modulos : '-'));
  l.push('Regras de permissão .... ' + (resumo.permissoes !== undefined ? resumo.permissoes : '-'));
  l.push('Último backup .......... ' + (resumo.ultimoBackup || '-'));
  l.push('Última sincronização ... ' + (resumo.ultimaSincronizacao || '-'));
  l.push('Erros nos últimos dias . ' + (resumo.errosRecentes !== undefined ? resumo.errosRecentes : 0));
  l.push('Linhas nos bancos ...... ' + (resumo.linhasNoTotal !== undefined ? resumo.linhasNoTotal : '-'));
  l.push('');

  if (!achados.length) {
    l.push('>>> NENHUM PROBLEMA ENCONTRADO.');
  } else {
    l.push('>>> ' + achados.length + ' PROBLEMA(S): ' +
      contagem.CRITICA + ' crítico(s), ' + contagem.ALTA + ' alto(s), ' +
      contagem.MEDIA + ' médio(s), ' + contagem.BAIXA + ' baixo(s).');
    l.push('');
    l.push('MÓDULO      | COMPONENTE           | LINHA | GRAVIDADE | PROBLEMA');
    l.push('------------+----------------------+-------+-----------+---------');
    for (var a = 0; a < achados.length; a++) {
      var x = achados[a];
      l.push(AP_DR_col_(x.modulo, 11) + ' | ' + AP_DR_col_(x.componente, 20) + ' | ' +
        AP_DR_col_(String(x.linha), 5) + ' | ' + AP_DR_col_(x.gravidade, 9) + ' | ' + x.problema);
      l.push('            |                      |       |           | → ' + x.sugestao);
    }
  }

  if (parou) {
    l.push('');
    l.push('ATENÇÃO: o exame de fundo parou em ' + parou + ' por causa do limite de tempo ' +
      'do Apps Script. O relatório está incompleto dessa parte para baixo.');
  }

  l.push('');
  l.push('O Doutor não conserta nada sozinho. As sugestões acima são para você decidir.');

  AP_DR_dizer_(l.join('\n'));
  return {
    ok: achados.length === 0, quando: AP_SRV_agora_(), segundos: segundos,
    resumo: resumo, contagem: contagem, achados: achados, parou: parou,
    texto: l.join('\n')
  };
}

function AP_DR_col_(texto, tamanho) {
  texto = String(texto === undefined ? '' : texto);
  if (texto.length > tamanho) return texto.substring(0, tamanho - 1) + '…';
  while (texto.length < tamanho) texto += ' ';
  return texto;
}

/* Versão curta, para rodar todo dia sem esperar */
function doutorRapido() { return doutorDoSistema({ rapido: true }); }

/* ============================================================
   OS CONSERTOS — SEPARADOS, E SÓ COM CONFIRMAÇÃO
   ============================================================ */
function encerrarSessoesVencidas(confirmacao) {
  if (String(confirmacao) !== 'CONFIRMO') {
    return AP_DR_dizer_('Nada foi alterado.\nPara encerrar as sessões vencidas, chame:\n' +
      '  encerrarSessoesVencidas("CONFIRMO")\n\n' +
      'Isso só muda o STATUS de ATIVA para VENCIDA nas que já passaram da validade. ' +
      'Elas já não davam acesso — é arrumação, não segurança.');
  }
  var aba = AP_SRV_aba_('00_CORE/CORE_SESSOES');
  if (!aba || aba.getLastRow() < 2) return AP_DR_dizer_('Não há sessões registradas.');

  var colunas = AP_SRV_colunasDe_(aba);
  var iStatus = colunas.indexOf('STATUS'), iExp = colunas.indexOf('DATA_EXPIRACAO');
  var linhas = aba.getRange(2, 1, aba.getLastRow() - 1, aba.getLastColumn()).getValues();
  var agora = AP_SRV_agora_(), mexidas = 0;

  for (var i = 0; i < linhas.length; i++) {
    if (String(linhas[i][iStatus] || '') !== 'ATIVA') continue;
    var exp = String(linhas[i][iExp] || '');
    if (!exp || exp >= agora) continue;
    aba.getRange(i + 2, iStatus + 1, 1, 1).setValues([['VENCIDA']]);
    mexidas++;
  }

  registrarLog('ALTERACAO', {
    modulo: 'CORE', tabela: 'CORE_SESSOES', campo: 'STATUS',
    valor_anterior: 'ATIVA', valor_novo: 'VENCIDA (' + mexidas + ' sessões)',
    origem: 'encerrarSessoesVencidas'
  });
  return AP_DR_dizer_(mexidas + ' sessão(ões) vencida(s) foram marcadas. Nenhum dado foi tocado.');
}

/* ============================================================
   AP_DR_testes() — A PROVA DA ETAPA 5
   ------------------------------------------------------------
   Monta um servidor doente de propósito e confere se o Doutor
   acha cada doença, com a gravidade certa e o número da linha
   certo — e, principalmente, se ele NÃO mexe em nada.

   Um diagnóstico que erra o lugar é pior que nenhum: manda a
   pessoa procurar defeito onde não tem.
   ============================================================ */
function AP_DR_testes() {
  var log = [], falhas = 0;
  function ok(nome, passou, obs) {
    if (!passou) falhas++;
    log.push((passou ? 'PASSOU  ' : 'FALHOU  ') + nome + (obs ? '  [' + obs + ']' : ''));
  }
  function achou(r, pedaco) {
    return r.achados.some(function (a) {
      return (a.problema + ' ' + a.componente + ' ' + a.sugestao).indexOf(pedaco) > -1;
    });
  }
  function achadoDe(r, pedaco) {
    for (var i = 0; i < r.achados.length; i++) {
      var a = r.achados[i];
      if ((a.problema + ' ' + a.componente).indexOf(pedaco) > -1) return a;
    }
    return null;
  }

  var orig = {
    aba: AP_SRV_aba_, mapa: AP_SRV_mapaDeIds, est: validarEstruturaServidor,
    ban: validarBancosDeDados, cab: validarCabecalhos, ler: AP_SRV_registroLer_,
    pasta: AP_SRV_pastaPorId_, logar: registrarLog,
    utils: (typeof Utilities !== 'undefined') ? Utilities : null
  };

  try {
    var ABAS = {}, PASTAS = {}, LOGS = [];

    function novaAba(cabecalho, linhas) {
      var dados = [cabecalho.slice()];
      for (var i = 0; i < (linhas || []).length; i++) dados.push(linhas[i].slice());
      var eu = {
        __dados: dados,
        getLastRow: function () { return dados.length; },
        getLastColumn: function () { return cabecalho.length; },
        appendRow: function (l) { dados.push(l.slice()); return eu; },
        getRange: function (l, c, nl, nc) {
          nl = nl || 1; nc = nc || 1;
          return {
            getValues: function () {
              var s = [];
              for (var i = 0; i < nl; i++) {
                var linha = dados[l - 1 + i] || [];
                var pedaco = [];
                for (var j = 0; j < nc; j++) pedaco.push(linha[c - 1 + j] === undefined ? '' : linha[c - 1 + j]);
                s.push(pedaco);
              }
              return s;
            },
            setValues: function (v) {
              for (var i = 0; i < v.length; i++) {
                if (!dados[l - 1 + i]) dados[l - 1 + i] = [];
                for (var j = 0; j < v[i].length; j++) dados[l - 1 + i][c - 1 + j] = v[i][j];
              }
              return this;
            }
          };
        }
      };
      return eu;
    }

    function pastaComCopias(nomes) {
      var filhas = nomes.map(function (n) {
        return { getName: function () { return n; }, getId: function () { return 'id_' + n; } };
      });
      return {
        getFolders: function () {
          var i = 0;
          return { hasNext: function () { return i < filhas.length; }, next: function () { return filhas[i++]; } };
        }
      };
    }

    AP_SRV_aba_ = function (c) { return ABAS[c] || null; };
    AP_SRV_pastaPorId_ = function (id) { return PASTAS[id] || null; };
    AP_SRV_registroLer_ = function () {
      return { '/': 'RAIZ', '04_BACKUP/BACKUP_DIARIO': 'pasta_diario' };
    };
    registrarLog = function (t, d) { LOGS.push({ t: t, d: d }); return true; };
    Utilities = {
      formatDate: function (d) {
        function dd(n) { return (n < 10 ? '0' : '') + n; }
        return d.getFullYear() + '-' + dd(d.getMonth() + 1) + '-' + dd(d.getDate()) +
          ' ' + dd(d.getHours()) + ':' + dd(d.getMinutes()) + ':' + dd(d.getSeconds());
      }
    };

    function hojeMenos(dias) {
      var d = new Date(new Date().getTime() - dias * 86400000);
      function dd(n) { return (n < 10 ? '0' : '') + n; }
      return d.getFullYear() + '-' + dd(d.getMonth() + 1) + '-' + dd(d.getDate());
    }

    /* ---------- o servidor saudável de partida ---------- */
    function montarSaudavel() {
      ABAS = {}; PASTAS = {}; LOGS = [];
      AP_SRV_mapaDeIds = function () {
        return { ok: true, versao: '2.0.0-etapa5', raiz: 'RAIZ', itens: { '/': 'RAIZ' } };
      };
      validarEstruturaServidor = function () { return { ok: true, presentes: ['a'], ausentes: [], pendentes: [] }; };
      validarBancosDeDados = function () { return { ok: true, presentes: ['b'], ausentes: [], pendentes: [] }; };
      validarCabecalhos = function () { return { ok: true, conferidos: 9, problemas: [] }; };

      ABAS['00_CORE/CORE_MODULOS'] = novaAba(
        ['ID_MODULO', 'NOME_MODULO', 'VERSAO', 'STATUS'],
        [['M1', 'CORE', '2.0.0', 'ATIVO']]);
      ABAS['00_CORE/CORE_PERMISSOES'] = novaAba(
        ['ID_PERMISSAO', 'PERFIL', 'MODULO', 'ACAO', 'PERMITIDO', 'STATUS'],
        [['P1', 'admin', '*', '*', 'SIM', 'ATIVO'],
         ['P2', 'almoxarife', 'produtos', 'criar', 'SIM', 'ATIVO']]);
      ABAS['00_CORE/CORE_SESSOES'] = novaAba(
        ['ID_SESSAO', 'TOKEN_HASH', 'USUARIO_ID', 'STATUS', 'DATA_EXPIRACAO'], []);
      ABAS['05_LOGS_AUDITORIA/LOG_ERROS'] = novaAba(
        ['ID_LOG', 'DATA_HORA', 'MODULO', 'MENSAGEM'], []);
      ABAS['05_LOGS_AUDITORIA/LOG_SINCRONIZACAO'] = novaAba(
        ['ID_LOG', 'DATA_HORA', 'MODULO', 'ACAO'],
        [['L1', hojeMenos(0) + ' 02:00:00', 'BACKUP', 'backup DIARIO']]);

      /* bancos vazios, com os cabeçalhos de verdade */
      for (var nome in AP_DB_REGRAS) {
        if (!AP_DB_REGRAS.hasOwnProperty(nome)) continue;
        var caminho = '01_BANCO_DADOS/' + nome;
        var item = null;
        for (var i = 0; i < AP_SRV_MAPA.length; i++) {
          if (AP_SRV_MAPA[i].caminho === caminho) item = AP_SRV_MAPA[i];
        }
        ABAS[caminho] = novaAba(item.colunas, []);
      }
      PASTAS['pasta_diario'] = pastaComCopias(['BACKUP_' + hojeMenos(0) + '_0200']);
    }

    /* ============================================================
       1. SERVIDOR SAUDÁVEL — O DOUTOR NÃO PODE INVENTAR DOENÇA
       ============================================================ */
    montarSaudavel();
    var saudavel = doutorDoSistema();
    ok('servidor saudável: nenhum problema',
      saudavel.ok === true && saudavel.achados.length === 0,
      saudavel.achados.map(function (a) { return a.componente + ': ' + a.problema; }).join(' | '));
    ok('o relatório mostra o resumo',
      saudavel.texto.indexOf('Último backup') > -1 && saudavel.texto.indexOf('2.0.0-etapa5') > -1);

    /* ============================================================
       2. DUPLICADO — COM O NÚMERO DA LINHA
       ============================================================ */
    montarSaudavel();
    var colsProd = AP_SRV_colunasDe_(ABAS['01_BANCO_DADOS/DB_PRODUTOS']);
    function linhaProduto(id, codigo, descricao) {
      var l = [];
      for (var i = 0; i < colsProd.length; i++) l.push('');
      AP_SRV_por_(l, colsProd, 'ID_PRODUTO', id);
      AP_SRV_por_(l, colsProd, 'CODIGO', codigo);
      AP_SRV_por_(l, colsProd, 'DESCRICAO', descricao);
      AP_SRV_por_(l, colsProd, 'UNIDADE', 'UN');
      AP_SRV_por_(l, colsProd, 'EXCLUIDO', 'NAO');
      return l;
    }
    ABAS['01_BANCO_DADOS/DB_PRODUTOS'].appendRow(linhaProduto('PRD-1', 'CIM-50', 'Cimento'));
    ABAS['01_BANCO_DADOS/DB_PRODUTOS'].appendRow(linhaProduto('PRD-2', 'ARE-01', 'Areia'));
    ABAS['01_BANCO_DADOS/DB_PRODUTOS'].appendRow(linhaProduto('PRD-3', 'CIM-50', 'Cimento repetido'));

    var comDup = doutorDoSistema();
    var dup = achadoDe(comDup, 'repetido');
    ok('achou o produto duplicado', !!dup);
    ok('apontou a LINHA certa (4)', dup && dup.linha === 4, dup ? 'linha ' + dup.linha : '');
    ok('disse com qual linha ele colide (2)', dup && dup.problema.indexOf('linha 2') > -1, dup ? dup.problema : '');
    ok('a gravidade é ALTA', dup && dup.gravidade === 'ALTA');
    ok('a sugestão manda usar AP_DB_excluir, não apagar à mão',
      dup && dup.sugestao.indexOf('não apague a linha à mão') > -1);
    ok('o Doutor NÃO apagou o duplicado',
      ABAS['01_BANCO_DADOS/DB_PRODUTOS'].getLastRow() === 4,
      ABAS['01_BANCO_DADOS/DB_PRODUTOS'].getLastRow() + ' linhas');

    /* duplicado que já foi excluído não é problema */
    montarSaudavel();
    var excluido = linhaProduto('PRD-3', 'CIM-50', 'Cimento antigo');
    AP_SRV_por_(excluido, colsProd, 'EXCLUIDO', 'SIM');
    ABAS['01_BANCO_DADOS/DB_PRODUTOS'].appendRow(linhaProduto('PRD-1', 'CIM-50', 'Cimento'));
    ABAS['01_BANCO_DADOS/DB_PRODUTOS'].appendRow(excluido);
    ok('registro excluído não conta como duplicado', !achou(doutorDoSistema(), 'repetido'));

    /* ============================================================
       3. REGISTRO APONTANDO PARA O NADA
       ============================================================ */
    montarSaudavel();
    var colsEst = AP_SRV_colunasDe_(ABAS['01_BANCO_DADOS/DB_ESTOQUE']);
    var linhaEst = [];
    for (var z = 0; z < colsEst.length; z++) linhaEst.push('');
    AP_SRV_por_(linhaEst, colsEst, 'ID_ESTOQUE', 'EST-1');
    AP_SRV_por_(linhaEst, colsEst, 'PRODUTO_ID', 'PRD-QUE-NAO-EXISTE');
    ABAS['01_BANCO_DADOS/DB_ESTOQUE'].appendRow(linhaEst);

    var comOrfao = doutorDoSistema();
    var orfao = achadoDe(comOrfao, 'não existe em DB_PRODUTOS');
    ok('achou o estoque apontando para produto inexistente', !!orfao);
    ok('apontou a linha 2 do estoque', orfao && orfao.linha === 2, orfao ? 'linha ' + orfao.linha : '');
    ok('o Doutor NÃO apagou o órfão',
      ABAS['01_BANCO_DADOS/DB_ESTOQUE'].getLastRow() === 2);

    /* ============================================================
       4. LINHA DIGITADA À MÃO, SEM ID
       ============================================================ */
    montarSaudavel();
    var semId = linhaProduto('', 'XX-1', 'digitado direto na planilha');
    ABAS['01_BANCO_DADOS/DB_PRODUTOS'].appendRow(semId);
    var comSemId = doutorDoSistema();
    ok('achou a linha sem ID', achou(comSemId, 'linha sem ID_PRODUTO'));
    ok('a sugestão explica que foi digitação direta',
      achadoDe(comSemId, 'linha sem ID_PRODUTO').sugestao.indexOf('direto na planilha') > -1);

    /* ============================================================
       5. PERMISSÕES
       ============================================================ */
    montarSaudavel();
    ABAS['00_CORE/CORE_PERMISSOES'] = novaAba(
      ['ID_PERMISSAO', 'PERFIL', 'MODULO', 'ACAO', 'PERMITIDO', 'STATUS'], []);
    var semPerm = doutorDoSistema();
    ok('tabela de permissões vazia é CRÍTICA',
      achadoDe(semPerm, 'permissões vazia').gravidade === 'CRITICA');
    ok('e a sugestão é semearPermissoes', achou(semPerm, 'semearPermissoes'));

    montarSaudavel();
    ABAS['00_CORE/CORE_PERMISSOES'] = novaAba(
      ['ID_PERMISSAO', 'PERFIL', 'MODULO', 'ACAO', 'PERMITIDO', 'STATUS'],
      [['P1', 'admin', '*', '*', 'talvez', 'ATIVO']]);
    var permTorta = doutorDoSistema();
    var torta = achadoDe(permTorta, 'PERMITIDO');
    ok('valor estranho em PERMITIDO é acusado', !!torta);
    ok('e o Doutor avisa que isso é lido como NÃO',
      torta && torta.problema.indexOf('lê como NÃO') > -1);
    ok('com a linha exata', torta && torta.linha === 2);

    montarSaudavel();
    ABAS['00_CORE/CORE_PERMISSOES'] = novaAba(
      ['ID_PERMISSAO', 'PERFIL', 'MODULO', 'ACAO', 'PERMITIDO', 'STATUS'],
      [['P1', 'consulta', '*', 'ler', 'SIM', 'ATIVO']]);
    ok('avisa quando não existe regra de admin',
      achou(doutorDoSistema(), 'nenhuma regra para o perfil admin'));

    /* ============================================================
       6. BACKUP ATRASADO E SESSÕES VENCIDAS
       ============================================================ */
    montarSaudavel();
    PASTAS['pasta_diario'] = pastaComCopias(['BACKUP_' + hojeMenos(10) + '_0200']);
    var atrasado = doutorDoSistema();
    ok('backup de 10 dias atrás é acusado', achou(atrasado, 'último backup foi há 10 dias'));
    ok('e a gravidade é ALTA', achadoDe(atrasado, 'último backup').gravidade === 'ALTA');

    montarSaudavel();
    PASTAS['pasta_diario'] = pastaComCopias([]);
    ok('nenhum backup é acusado', achou(doutorDoSistema(), 'nenhum backup foi feito ainda'));

    montarSaudavel();
    ABAS['00_CORE/CORE_SESSOES'] = novaAba(
      ['ID_SESSAO', 'TOKEN_HASH', 'USUARIO_ID', 'STATUS', 'DATA_EXPIRACAO'],
      [['S1', 'h', 'u', 'ATIVA', '2020-01-01 00:00:00'],
       ['S2', 'h', 'u', 'ATIVA', '2099-01-01 00:00:00']]);
    var comSessao = doutorDoSistema();
    ok('sessão vencida ainda ATIVA é achada', achou(comSessao, 'vencida'));
    ok('mas é gravidade BAIXA, porque ela já não dá acesso',
      achadoDe(comSessao, 'vencida').gravidade === 'BAIXA');
    ok('o Doutor NÃO encerrou a sessão sozinho',
      ABAS['00_CORE/CORE_SESSOES'].getRange(2, 4, 1, 1).getValues()[0][0] === 'ATIVA');

    var semConfirmar = encerrarSessoesVencidas();
    ok('encerrar sem CONFIRMO não muda nada',
      semConfirmar.indexOf('Nada foi alterado') > -1 &&
      ABAS['00_CORE/CORE_SESSOES'].getRange(2, 4, 1, 1).getValues()[0][0] === 'ATIVA');

    encerrarSessoesVencidas('CONFIRMO');
    ok('com CONFIRMO, a vencida vira VENCIDA',
      ABAS['00_CORE/CORE_SESSOES'].getRange(2, 4, 1, 1).getValues()[0][0] === 'VENCIDA');
    ok('e a que ainda vale continua ATIVA',
      ABAS['00_CORE/CORE_SESSOES'].getRange(3, 4, 1, 1).getValues()[0][0] === 'ATIVA');

    /* ============================================================
       7. ESTRUTURA QUEBRADA E ERROS RECENTES
       ============================================================ */
    montarSaudavel();
    validarBancosDeDados = function () {
      return { ok: false, presentes: [], ausentes: ['01_BANCO_DADOS/DB_EPI'], pendentes: [] };
    };
    var semBanco = doutorDoSistema();
    ok('planilha ausente é CRÍTICA', achadoDe(semBanco, 'DB_EPI').gravidade === 'CRITICA');
    ok('os críticos vêm primeiro na lista', semBanco.achados[0].gravidade === 'CRITICA');

    montarSaudavel();
    ABAS['05_LOGS_AUDITORIA/LOG_ERROS'] = novaAba(
      ['ID_LOG', 'DATA_HORA', 'MODULO', 'MENSAGEM'],
      [['E1', hojeMenos(1) + ' 10:00:00', 'ESTOQUE', 'saldo negativo em PRD-1'],
       ['E2', hojeMenos(300) + ' 10:00:00', 'ESTOQUE', 'erro velho, não conta']]);
    var comErro = doutorDoSistema();
    ok('conta só os erros recentes', comErro.resumo.errosRecentes === 1,
      comErro.resumo.errosRecentes + ' erros');
    ok('e mostra a mensagem do primeiro', achou(comErro, 'saldo negativo em PRD-1'));

    /* ============================================================
       8. SERVIDOR NÃO INSTALADO
       ============================================================ */
    AP_SRV_mapaDeIds = function () { return { ok: false, raiz: '', versao: '', itens: {} }; };
    var semServidor = doutorDoSistema();
    ok('sem servidor, o Doutor diz isso e para',
      semServidor.achados.length === 1 &&
      semServidor.achados[0].gravidade === 'CRITICA' &&
      semServidor.achados[0].problema.indexOf('não foi instalado') > -1);

    /* ============================================================
       9. O RELATÓRIO TEM AS COLUNAS QUE O DOCUMENTO PEDE
       ============================================================ */
    montarSaudavel();
    ABAS['01_BANCO_DADOS/DB_PRODUTOS'].appendRow(linhaProduto('PRD-1', 'CIM-50', 'Cimento'));
    ABAS['01_BANCO_DADOS/DB_PRODUTOS'].appendRow(linhaProduto('PRD-2', 'CIM-50', 'repetido'));
    var final = doutorDoSistema();
    var cabecalhoOk = final.texto.indexOf('MÓDULO') > -1 && final.texto.indexOf('COMPONENTE') > -1 &&
      final.texto.indexOf('LINHA') > -1 && final.texto.indexOf('GRAVIDADE') > -1 &&
      final.texto.indexOf('PROBLEMA') > -1;
    ok('o relatório traz módulo, componente, linha, gravidade e problema', cabecalhoOk);
    ok('cada achado tem data e sugestão',
      final.achados.every(function (a) { return !!a.data && !!a.sugestao; }));
    ok('o rodapé lembra que ele não conserta nada',
      final.texto.indexOf('não conserta nada sozinho') > -1);
    ok('o modo rápido pula o exame de fundo',
      doutorRapido().resumo.exameDeFundo === 'pulado (modo rápido)');

  } catch (explodiu) {
    falhas++;
    log.push('FALHOU  o teste explodiu: ' + (explodiu && explodiu.stack || explodiu));
  } finally {
    AP_SRV_aba_ = orig.aba;
    AP_SRV_mapaDeIds = orig.mapa;
    validarEstruturaServidor = orig.est;
    validarBancosDeDados = orig.ban;
    validarCabecalhos = orig.cab;
    AP_SRV_registroLer_ = orig.ler;
    AP_SRV_pastaPorId_ = orig.pasta;
    registrarLog = orig.logar;
    if (orig.utils) Utilities = orig.utils;
  }

  var texto = '=== ETAPA 5 — DOUTOR DO SISTEMA — ' +
    (falhas ? falhas + ' FALHA(S) DE ' + log.length : 'TODOS OS ' + log.length + ' TESTES PASSARAM') +
    ' ===\n' + log.join('\n');
  try { Logger.log(texto); } catch (e) { }
  return { ok: falhas === 0, total: log.length, falhas: falhas, texto: texto };
}
