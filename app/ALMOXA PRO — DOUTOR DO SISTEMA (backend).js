/**
 * ============================================================
 * ALMOXA PRO — DOUTOR DO SISTEMA (backend)
 * Versão 1.0.0
 * ------------------------------------------------------------
 * ONDE O TEMPO É GASTO
 *
 * "O Core não respondeu em 15 segundos" não diz nada útil. Pode
 * ser internet, pode ser o Apps Script, pode ser a planilha.
 *
 * Este módulo separa o tempo por camada e mostra o número de
 * cada uma. Sem isso, otimizar é adivinhação.
 *
 * ------------------------------------------------------------
 * REGRA QUE ESTE MÓDULO SEGUE
 *
 * Nunca inventa causa. Quando não consegue determinar, diz
 * "causa não determinada" e mostra as evidências que tem.
 * ============================================================
 */

var AP_DR_CFG = {
  versao: '1.0.0',

  /* limites para classificar, em milissegundos */
  limites: {
    otimo: 300,
    bom: 800,
    atencao: 2000,
    lento: 5000
    /* acima de 5000: crítico */
  }
};

function AP_DR_classificar_(ms) {
  var L = AP_DR_CFG.limites;
  if (ms <= L.otimo) return { simbolo: '🟢', nivel: 'OTIMO' };
  if (ms <= L.bom) return { simbolo: '🟢', nivel: 'BOM' };
  if (ms <= L.atencao) return { simbolo: '🟡', nivel: 'ATENCAO' };
  if (ms <= L.lento) return { simbolo: '🟠', nivel: 'LENTO' };
  return { simbolo: '🔴', nivel: 'CRITICO' };
}

function AP_DR_agora_() { return new Date().getTime(); }

/* ============================================================
   MEDIÇÃO POR CAMADA
   ============================================================ */

/**
 * Mede quanto tempo cada parte leva numa operação real.
 *
 * Não é estimativa: cada etapa é cronometrada de verdade.
 */
function AP_DR_medirCamadas() {
  var r = { etapas: [], total: 0 };

  function medir(nome, oque, funcao) {
    var t0 = AP_DR_agora_();
    var erro = null, detalhe = '';
    try { detalhe = funcao() || ''; }
    catch (e) { erro = e.message; }
    var ms = AP_DR_agora_() - t0;

    var c = AP_DR_classificar_(ms);
    r.etapas.push({
      etapa: nome, oque: oque, ms: ms,
      simbolo: erro ? '🔴' : c.simbolo,
      nivel: erro ? 'ERRO' : c.nivel,
      detalhe: erro ? erro : detalhe
    });
    r.total += ms;
    return ms;
  }

  /* 1. abrir a planilha — costuma ser o mais caro */
  medir('Abertura da planilha', 'SpreadsheetApp.openById', function () {
    var ss = AP_Config_getSpreadsheet_();
    return ss.getName();
  });

  /* 2. ler a configuração */
  medir('Leitura da CONFIG', 'aba CONFIG', function () {
    var v = AP_Config_get('SYSTEM_VERSION', '');
    return 'versão ' + v;
  });

  /* 3. ler uma aba pequena */
  medir('Leitura de aba pequena', AP_SHEETS.USUARIOS, function () {
    var linhas = AP_Data_rows(AP_SHEETS.USUARIOS) || [];
    return linhas.length + ' linha(s)';
  });

  /* 4. ler a maior aba do sistema */
  var maior = AP_DR_maiorAba_();
  if (maior.nome) {
    medir('Leitura da maior aba', maior.nome, function () {
      var linhas = AP_Data_rows(maior.nome) || [];
      return linhas.length + ' linha(s)';
    });
  }

  /* 5. uma consulta completa, como a tela faz */
  medir('Consulta de catálogo', 'lojinha.catalogo', function () {
    var res = AP_BRIDGE_despachar_('lojinha', 'catalogo', {}, { perfil: 'ADMINISTRADOR', usuario: 'doutor' });
    var n = (res && res.dados && res.dados.dados) ? res.dados.dados.length
      : ((res && res.dados) ? res.dados.length : 0);
    return (n || 0) + ' item(ns)';
  });

  /* 6. uma gravação */
  medir('Gravação de teste', 'append + remove', function () {
    var aba = 'DIAGNOSTICO_TEMP';
    AP_Data_getSheet(aba, ['id', 'quando']);
    AP_Data_append(aba, { id: 'DR-' + AP_DR_agora_(), quando: AP_Utils_now() });
    return 'uma linha gravada';
  });

  /* conclusão baseada nos números, não em palpite */
  var maiorEtapa = r.etapas.slice().sort(function (a, b) { return b.ms - a.ms; })[0];
  var classe = AP_DR_classificar_(r.total);

  return {
    ok: true,
    dados: {
      total: r.total,
      simbolo: classe.simbolo,
      nivel: classe.nivel,
      etapas: r.etapas,
      maiorGargalo: maiorEtapa ? {
        etapa: maiorEtapa.etapa,
        ms: maiorEtapa.ms,
        percentual: r.total > 0 ? Math.round((maiorEtapa.ms / r.total) * 100) : 0
      } : null,
      conclusao: AP_DR_concluir_(r.etapas, r.total),
      medidoEm: AP_Utils_now(),
      versao: AP_DR_CFG.versao
    }
  };
}

/**
 * Diz o que os números significam — sem chutar.
 */
function AP_DR_concluir_(etapas, total) {
  var abertura = etapas.filter(function (e) { return e.etapa.indexOf('Abertura') === 0; })[0];
  var leituras = etapas.filter(function (e) { return e.etapa.indexOf('Leitura') === 0; });
  var gravacao = etapas.filter(function (e) { return e.etapa.indexOf('Gravação') === 0; })[0];

  var msLeituras = leituras.reduce(function (s, e) { return s + e.ms; }, 0);
  var msAbertura = abertura ? abertura.ms : 0;
  var msGravacao = gravacao ? gravacao.ms : 0;

  var linhas = [];

  if (total <= AP_DR_CFG.limites.bom) {
    linhas.push('O sistema está respondendo bem. Se a lentidão aparece só em algumas telas, ' +
      'o problema está no que aquela tela consulta, não na base.');
  }

  if (msAbertura > msLeituras && msAbertura > 400) {
    linhas.push('A maior parte do tempo é a ABERTURA DA PLANILHA (' + msAbertura + ' ms). ' +
      'Isso acontece uma vez por execução e não depende da quantidade de dados — ' +
      'é o custo do Apps Script alcançar o Google Sheets.');
  }

  if (msLeituras > msAbertura && msLeituras > 800) {
    linhas.push('A maior parte do tempo é LEITURA DE ABAS (' + msLeituras + ' ms). ' +
      'Vale reduzir quantas abas cada operação toca, ou reduzir o tamanho das maiores.');
  }

  if (msGravacao > 1500) {
    linhas.push('A GRAVAÇÃO está lenta (' + msGravacao + ' ms). ' +
      'Escrever é sempre mais caro que ler no Apps Script.');
  }

  if (!linhas.length) {
    linhas.push('CAUSA NÃO DETERMINADA. Os tempos estão distribuídos sem um gargalo claro. ' +
      'Repita a medição em outro horário para comparar.');
  }

  return linhas.join(' ');
}

/** Qual aba tem mais linhas */
function AP_DR_maiorAba_() {
  var maior = { nome: null, linhas: 0 };
  try {
    var ss = AP_Config_getSpreadsheet_();
    ss.getSheets().forEach(function (s) {
      var n = s.getLastRow();
      if (n > maior.linhas) maior = { nome: s.getName(), linhas: n };
    });
  } catch (e) { }
  return maior;
}

/* ============================================================
   RAIO-X DA PLANILHA
   ============================================================ */

function AP_DR_planilha() {
  var t0 = AP_DR_agora_();
  var abas = [];
  var totalLinhas = 0;
  var alertas = [];

  try {
    var ss = AP_Config_getSpreadsheet_();
    ss.getSheets().forEach(function (s) {
      var linhas = s.getLastRow();
      var colunas = s.getLastColumn();
      totalLinhas += linhas;

      var registro = {
        nome: s.getName(), linhas: Math.max(0, linhas - 1), colunas: colunas,
        celulas: linhas * colunas
      };

      /* aba grande demais começa a pesar de verdade */
      if (linhas > 20000) {
        registro.alerta = 'MUITO_GRANDE';
        alertas.push({
          simbolo: '🟠', aba: s.getName(),
          problema: 'Aba com ' + linhas + ' linhas',
          impacto: 'Cada leitura desta aba carrega tudo.',
          recomendacao: 'Arquive as linhas antigas em outra planilha.'
        });
      }

      /* aba sem cabeçalho quebra a leitura */
      if (linhas > 0 && colunas === 0) {
        registro.alerta = 'SEM_COLUNAS';
        alertas.push({
          simbolo: '🔴', aba: s.getName(),
          problema: 'Aba sem cabeçalho',
          impacto: 'Leituras desta aba falham.',
          recomendacao: 'Verifique a primeira linha.'
        });
      }

      abas.push(registro);
    });
  } catch (e) {
    return { ok: false, codigo: 'FALHA_LEITURA', mensagem: e.message };
  }

  abas.sort(function (a, b) { return b.linhas - a.linhas; });

  return {
    ok: true,
    dados: {
      totalAbas: abas.length,
      totalLinhas: totalLinhas,
      maiores: abas.slice(0, 10),
      alertas: alertas,
      msMedicao: AP_DR_agora_() - t0,
      /* diz o que o número significa, para não assustar à toa */
      avaliacao: totalLinhas < 10000
        ? 'A base é pequena. O tamanho dos dados não é a causa de lentidão.'
        : (totalLinhas < 50000
          ? 'A base é média. Ainda não é o gargalo principal.'
          : 'A base é grande. Vale arquivar dados antigos.')
    }
  };
}

/* ============================================================
   TESTE DOS MÓDULOS
   ============================================================ */

function AP_DR_modulos() {
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  var resultados = [];

  var testes = [
    ['auth', 'perfis', {}],
    ['usuarios', 'listar', {}],
    ['itens', 'listar', {}],
    ['categorias', 'listar', {}],
    ['estoque', 'listar', {}],
    ['lojinha', 'catalogo', {}],
    ['reservas', 'listar', {}],
    ['aprovacoes', 'porPerfil', {}],
    ['nf', 'listar', {}],
    ['compras', 'precompras', {}],
    ['epi', 'fichas', {}],
    ['ferramentas', 'listar', {}],
    ['inventario', 'listar', {}],
    ['obras', 'listar', {}],
    ['auditoria', 'listar', {}],
    ['biometria', 'diagnostico', {}],
    ['inteligencia', 'versao', {}],
    ['backup', 'status', {}]
  ];

  var sessao = { perfil: 'ADMINISTRADOR', usuario: 'doutor' };

  testes.forEach(function (t) {
    var nome = t[0], acao = t[1];
    var existe = typeof g['AP_Modulo_' + nome] === 'function';

    if (!existe) {
      resultados.push({
        simbolo: '🔴', modulo: nome, acao: acao, ms: 0,
        status: 'AUSENTE',
        problema: 'A função AP_Modulo_' + nome + ' não existe neste projeto.',
        recomendacao: 'Verifique se o arquivo .gs desse módulo foi instalado.'
      });
      return;
    }

    var t0 = AP_DR_agora_();
    var res, erro = null;
    try { res = g['AP_Modulo_' + nome](acao, t[2], sessao); }
    catch (e) { erro = e.message; }
    var ms = AP_DR_agora_() - t0;

    var c = AP_DR_classificar_(ms);
    var ok = !erro && res && res.ok;

    var quantos = 0;
    if (ok && res.dados) {
      quantos = Array.isArray(res.dados) ? res.dados.length
        : (res.dados.dados && Array.isArray(res.dados.dados) ? res.dados.dados.length : 1);
    }

    resultados.push({
      simbolo: erro ? '🔴' : (ok ? c.simbolo : '🟠'),
      modulo: nome, acao: acao, ms: ms,
      status: erro ? 'ERRO' : (ok ? c.nivel : 'RECUSADO'),
      registros: quantos,
      problema: erro || (ok ? '' : (res && res.mensagem) || 'A ação não retornou ok.'),
      recomendacao: erro ? 'Erro dentro do módulo — veja a mensagem.'
        : (ok ? '' : 'Pode ser esperado se depender de dados que ainda não existem.')
    });
  });

  var comProblema = resultados.filter(function (r) { return r.simbolo === '🔴'; });
  var lentos = resultados.filter(function (r) { return r.ms > AP_DR_CFG.limites.atencao; });

  return {
    ok: true,
    dados: {
      total: resultados.length,
      funcionando: resultados.filter(function (r) { return r.simbolo === '🟢'; }).length,
      atencao: resultados.filter(function (r) { return r.simbolo === '🟡'; }).length,
      problemas: comProblema.length,
      lentos: lentos.length,
      resultados: resultados,
      maisLentos: resultados.slice().sort(function (a, b) { return b.ms - a.ms; }).slice(0, 5)
    }
  };
}

/* ============================================================
   PESO DA ABA — por que uma leitura demora
   ------------------------------------------------------------
   437 linhas não deveriam custar 3 segundos. O que costuma pesar
   não é a quantidade de linhas: é o que está DENTRO delas.

   Foto em base64 numa célula, por exemplo, transforma uma linha
   de 200 caracteres numa de 200.000. Ler 437 dessas é carregar
   dezenas de megabytes.

   Esta função mede o peso real, coluna por coluna.
   ============================================================ */

function AP_DR_pesoDaAba(nomeAba) {
  var t0 = AP_DR_agora_();

  var sheet = AP_Data_getSheet(nomeAba);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();

  if (lastRow < 2) {
    return { ok: true, dados: { aba: nomeAba, linhas: 0, aviso: 'Aba vazia.' } };
  }

  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  /* amostra: 20 linhas bastam para saber o que pesa */
  var amostra = Math.min(20, lastRow - 1);
  var valores = sheet.getRange(2, 1, amostra, lastCol).getValues();

  var colunas = [];
  var totalAmostra = 0;

  for (var c = 0; c < lastCol; c++) {
    var bytes = 0, maior = 0, preenchidas = 0;

    for (var l = 0; l < valores.length; l++) {
      var v = valores[l][c];
      var t = (v === null || v === undefined) ? '' : String(v);
      bytes += t.length;
      if (t.length > maior) maior = t.length;
      if (t) preenchidas++;
    }

    totalAmostra += bytes;
    var media = Math.round(bytes / amostra);

    colunas.push({
      coluna: String(headers[c] || ('coluna ' + (c + 1))),
      mediaCaracteres: media,
      maiorCelula: maior,
      preenchimento: Math.round((preenchidas / amostra) * 100) + '%',
      /* o que denuncia uma foto embutida */
      pesada: media > 1000,
      provavelImagem: maior > 5000
    });
  }

  colunas.sort(function (a, b) { return b.mediaCaracteres - a.mediaCaracteres; });

  var mediaLinha = Math.round(totalAmostra / amostra);
  var estimativaMB = Math.round((mediaLinha * (lastRow - 1)) / 1048576 * 100) / 100;

  var pesadas = colunas.filter(function (c) { return c.pesada; });
  var imagens = colunas.filter(function (c) { return c.provavelImagem; });

  var conclusao;
  if (imagens.length) {
    conclusao = 'A coluna "' + imagens[0].coluna + '" guarda algo muito grande — provavelmente ' +
      'imagem em base64 (até ' + imagens[0].maiorCelula + ' caracteres numa célula). ' +
      'É isso que faz a leitura demorar: cada consulta carrega todas as fotos junto.';
  } else if (pesadas.length) {
    conclusao = 'A coluna "' + pesadas[0].coluna + '" é pesada (' + pesadas[0].mediaCaracteres +
      ' caracteres em média). Vale verificar se o conteúdo dela precisa vir em toda listagem.';
  } else if (estimativaMB > 5) {
    conclusao = 'Nenhuma coluna isolada é pesada, mas a aba soma cerca de ' + estimativaMB +
      ' MB. O volume total é o que pesa.';
  } else {
    conclusao = 'A aba não parece pesada (' + estimativaMB + ' MB estimados). ' +
      'Se a leitura está lenta, a causa está em outro lugar.';
  }

  return {
    ok: true,
    dados: {
      aba: nomeAba,
      linhas: lastRow - 1,
      colunas: lastCol,
      mediaCaracteresPorLinha: mediaLinha,
      estimativaMB: estimativaMB,
      msMedicao: AP_DR_agora_() - t0,
      maisPesadas: colunas.slice(0, 6),
      colunasPesadas: pesadas.length,
      provaveisImagens: imagens.map(function (c) { return c.coluna; }),
      conclusao: conclusao
    }
  };
}

/* ============================================================
   MÓDULO
   ============================================================ */

function AP_Modulo_doutor(acao, payload, sessao) {
  payload = payload || {};

  try {
    switch (acao) {

      case 'ping':
        return { ok: true, dados: { core: 'ok', quando: AP_Utils_now(), versao: AP_DR_CFG.versao } };

      case 'performance':
        return AP_DR_medirCamadas();

      case 'planilha':
        return AP_DR_planilha();

      case 'pesoAba':
        return AP_DR_pesoDaAba(payload.aba || 'ALMOXA_ITENS');

      case 'modulos':
        return AP_DR_modulos();

      /** Tudo de uma vez */
      case 'completo': {
        var t0 = AP_DR_agora_();
        var perf = AP_DR_medirCamadas();
        var plan = AP_DR_planilha();
        var mods = AP_DR_modulos();

        var criticos = [];
        var bugs = [];
        var atencao = [];

        (mods.dados.resultados || []).forEach(function (r) {
          if (r.simbolo === '🔴') {
            bugs.push({
              prioridade: 'ALTA', simbolo: '🔴',
              modulo: r.modulo, acao: r.acao,
              problema: r.problema, recomendacao: r.recomendacao
            });
          } else if (r.ms > AP_DR_CFG.limites.lento) {
            atencao.push({
              prioridade: 'MEDIA', simbolo: '🟠',
              modulo: r.modulo, acao: r.acao,
              problema: 'Demorou ' + r.ms + ' ms',
              recomendacao: 'Reduza os dados lidos ou use cache.'
            });
          }
        });

        (plan.dados && plan.dados.alertas || []).forEach(function (a) {
          atencao.push({
            prioridade: 'MEDIA', simbolo: a.simbolo,
            modulo: 'planilha', acao: a.aba,
            problema: a.problema, recomendacao: a.recomendacao
          });
        });

        return {
          ok: true,
          dados: {
            executadoEm: AP_Utils_now(),
            duracaoMs: AP_DR_agora_() - t0,
            performance: perf.dados,
            planilha: plan.dados,
            modulos: mods.dados,
            resumo: {
              criticos: criticos.length,
              bugs: bugs.length,
              atencao: atencao.length,
              modulosOk: mods.dados.funcionando,
              modulosTotal: mods.dados.total,
              tempoTotal: perf.dados.total,
              maiorGargalo: perf.dados.maiorGargalo
            },
            listaDeProblemas: criticos.concat(bugs).concat(atencao),
            conclusao: perf.dados.conclusao
          }
        };
      }

      case 'limites':
        return { ok: true, dados: AP_DR_CFG.limites };

      default:
        return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'doutor.' + acao + ' não existe.' };
    }
  } catch (e) {
    AP_ErrorHandler_capture('AP_Modulo_doutor:' + acao, e);
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'doutor', acao: acao, mensagem: e.message };
  }
}

/* ============================================================
   PARA RODAR DIRETO NO EDITOR
   ============================================================ */

/**
 * Mede e escreve o resultado em linguagem clara.
 * É a função para rodar quando o sistema estiver lento.
 */
function DOUTOR_ondeEstaALentidao() {
  var r = AP_DR_medirCamadas();
  var d = r.dados;

  var linhas = [];
  linhas.push('');
  linhas.push('  ONDE O TEMPO ESTÁ SENDO GASTO');
  linhas.push('  ' + new Array(60).join('-'));
  linhas.push('');

  d.etapas.forEach(function (e) {
    linhas.push('  ' + e.simbolo + '  ' +
      (e.etapa + '                              ').substring(0, 26) +
      (String(e.ms) + ' ms').padStart(9) + '   ' +
      (e.detalhe || ''));
  });

  linhas.push('  ' + new Array(60).join('-'));
  linhas.push('  ' + d.simbolo + '  TOTAL: ' + d.total + ' ms');
  linhas.push('');

  if (d.maiorGargalo) {
    linhas.push('  MAIOR GARGALO: ' + d.maiorGargalo.etapa +
      ' (' + d.maiorGargalo.ms + ' ms, ' + d.maiorGargalo.percentual + '% do total)');
    linhas.push('');
  }

  linhas.push('  O QUE ISSO SIGNIFICA');
  linhas.push('  ' + d.conclusao);
  linhas.push('');

  var plan = AP_DR_planilha();
  if (plan.ok) {
    linhas.push('  TAMANHO DA BASE');
    linhas.push('  ' + plan.dados.totalAbas + ' abas, ' + plan.dados.totalLinhas + ' linhas no total');
    linhas.push('  ' + plan.dados.avaliacao);
    linhas.push('');
    linhas.push('  MAIORES ABAS');
    plan.dados.maiores.slice(0, 5).forEach(function (a) {
      linhas.push('    ' + (a.nome + '                              ').substring(0, 30) +
        String(a.linhas).padStart(7) + ' linhas');
    });
  }

  var texto = linhas.join('\n');
  try { Logger.log(texto); } catch (e) { }
  return texto;
}

/**
 * Descobre por que uma aba demora para ser lida.
 * Rode quando uma listagem estiver lenta.
 */
function DOUTOR_porQueEstaLento(nomeAba) {
  var r = AP_DR_pesoDaAba(nomeAba || 'ALMOXA_ITENS');
  var d = r.dados;

  var linhas = [];
  linhas.push('');
  linhas.push('  POR QUE A ABA ' + d.aba + ' DEMORA');
  linhas.push('  ' + new Array(66).join('-'));
  linhas.push('');
  linhas.push('  Linhas:                 ' + d.linhas);
  linhas.push('  Colunas:                ' + d.colunas);
  linhas.push('  Média por linha:        ' + d.mediaCaracteresPorLinha + ' caracteres');
  linhas.push('  Tamanho estimado:       ' + d.estimativaMB + ' MB');
  linhas.push('');
  linhas.push('  COLUNAS MAIS PESADAS');
  linhas.push('  ' + new Array(66).join('-'));

  d.maisPesadas.forEach(function (c) {
    var marca = c.provavelImagem ? '🔴' : (c.pesada ? '🟠' : '🟢');
    linhas.push('  ' + marca + '  ' +
      (c.coluna + '                        ').substring(0, 24) +
      (String(c.mediaCaracteres) + ' car.').padStart(12) +
      '   maior: ' + c.maiorCelula +
      '   ' + c.preenchimento + ' preenchida');
  });

  linhas.push('');
  linhas.push('  O QUE ISSO SIGNIFICA');
  linhas.push('  ' + d.conclusao);

  if (d.provaveisImagens.length) {
    linhas.push('');
    linhas.push('  COMO RESOLVER');
    linhas.push('  Guarde a foto no Google Drive e deixe na planilha só o link.');
    linhas.push('  A listagem passa a carregar o endereço da imagem, não a imagem inteira.');
  }

  var texto = linhas.join('\n');
  try { Logger.log(texto); } catch (e) { }
  return texto;
}

/** Testa todos os módulos e lista o que está quebrado */
function DOUTOR_testarModulos() {
  var r = AP_DR_modulos();
  var d = r.dados;

  var linhas = [];
  linhas.push('');
  linhas.push('  TESTE DOS MÓDULOS — ' + d.funcionando + ' de ' + d.total + ' respondendo bem');
  linhas.push('  ' + new Array(70).join('-'));

  d.resultados.forEach(function (m) {
    linhas.push('  ' + m.simbolo + '  ' +
      (m.modulo + '.' + m.acao + '                         ').substring(0, 28) +
      (String(m.ms) + ' ms').padStart(8) +
      (m.registros ? '   ' + m.registros + ' registro(s)' : '') +
      (m.problema ? '   ' + m.problema : ''));
  });

  if (d.problemas) {
    linhas.push('');
    linhas.push('  ' + d.problemas + ' MÓDULO(S) COM PROBLEMA — resolva estes primeiro');
  }

  var texto = linhas.join('\n');
  try { Logger.log(texto); } catch (e) { }
  return texto;
}
