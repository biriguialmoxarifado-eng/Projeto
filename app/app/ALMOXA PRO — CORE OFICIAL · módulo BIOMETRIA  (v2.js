/**
 * ALMOXA PRO — módulo BIOMETRIA + roteador de telas
 *
 * Este arquivo fica DENTRO do projeto Core, junto dos outros.
 * Ele resolve o problema das duas telas disputando a mesma URL.
 *
 * ---------------------------------------------------------------------------
 * COMO FICA
 *
 *   .../exec                      ->  sistema principal do ALMOXA PRO
 *   .../exec?pagina=biometria     ->  Central de Biometria
 *
 * A Central vira uma extensão do sistema, na mesma URL, como você quer.
 *
 * ---------------------------------------------------------------------------
 * DUAS COISAS PARA PREENCHER LOGO ABAIXO
 *
 *   TELA_PRINCIPAL  -> o nome do arquivo HTML do sistema principal
 *                      (aquele que desenha o menu do ALMOXA PRO)
 *   PLANILHA_ID     -> a URL da sua planilha
 *
 * Se você não souber o nome da tela principal, deixe em branco: ao abrir
 * o /exec o próprio sistema mostra uma lista dos nomes que ele tentou e
 * explica o que fazer.
 *
 * ---------------------------------------------------------------------------
 * IMPORTANTE
 *
 * Se algum OUTRO arquivo do projeto ainda tiver "function doGet", apague o
 * doGet daquele arquivo. Dois doGet no mesmo projeto brigam entre si, e foi
 * isso que derrubou o seu sistema. Só pode existir este aqui.
 */

// ===========================================================================
//  1) NOME DO ARQUIVO HTML DA TELA PRINCIPAL DO ALMOXA PRO
//     Exemplo:  'Index'   'Sistema'   'ALMOXA_PRO'   'App'
// ===========================================================================
var TELA_PRINCIPAL = 'ALMOXA_PRO_DESKTOP';

// ===========================================================================
//  2) URL DA SUA PLANILHA
// ===========================================================================
var PLANILHA_ID = 'https://docs.google.com/spreadsheets/d/1tqz_6yUJf6skL0ouoAs_glomJhfHnijE9lXwqQZC-mY/edit?gid=950271829#gid=950271829';


/**
 * Roteador único de telas.
 *   sem parâmetro           -> sistema principal
 *   ?pagina=biometria       -> Central de Biometria
 */
function doGet(e) {
  var pagina = (e && e.parameter && e.parameter.pagina) ? e.parameter.pagina : '';

  if (pagina === 'biometria') {
    return HtmlService.createHtmlOutput(AXBIO_TELA())
      .setTitle('ALMOXA PRO \u00b7 Central de Biometria')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  return _telaPrincipal(e);
}

/**
 * Recebe chamadas de fora (tela aberta como arquivo local).
 *
 * ATENÇÃO: se o projeto JÁ tiver "function doPost" em outro arquivo, APAGUE
 * esta função daqui e, dentro do doPost que já existe, acrescente:
 *
 *     var r = axbioPost(e); if (r) return r;
 */
function doPost(e) {
  var r = axbioPost(e);
  if (r) return r;
  return ContentService
    .createTextOutput(JSON.stringify({ ok: false, dados: {}, erro: 'ação desconhecida' }))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Trata só as ações bio_*. Devolve null para o resto. */
function axbioPost(e) {
  var corpo;
  try { corpo = JSON.parse(e.postData.contents); } catch (err) { return null; }
  if (!corpo || !corpo.acao || String(corpo.acao).indexOf('bio_') !== 0) return null;
  return ContentService
    .createTextOutput(JSON.stringify(AXBIO.api(corpo.acao, corpo.dados || {})))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Serve a tela principal do ALMOXA PRO. */
function _telaPrincipal(e) {
  var tentativas = [];
  if (TELA_PRINCIPAL) tentativas.push(TELA_PRINCIPAL);
  tentativas = tentativas.concat([
    'Index','index','INDEX','Sistema','SISTEMA','App','APP','Main','Home',
    'ALMOXA_PRO','ALMOXAPRO','AlmoxaPro','ALMOXA PRO','Painel','Dashboard',
    'Principal','Tela','Interface','Pagina','Portal'
  ]);

  for (var i = 0; i < tentativas.length; i++) {
    try {
      return HtmlService.createHtmlOutputFromFile(tentativas[i])
        .setTitle('ALMOXA PRO')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    } catch (err) { /* tenta o próximo */ }
  }

  return HtmlService.createHtmlOutput(
    '<div style="max-width:720px;margin:8vh auto;padding:32px;' +
    'font:15px/1.7 Segoe UI,system-ui,sans-serif;color:#1a2433;' +
    'border:2px solid #f0883e;border-radius:14px">' +
    '<h1 style="font-size:21px;margin:0 0 12px;color:#c2621f">' +
    'Falta dizer qual é a tela principal</h1>' +
    '<p>O roteador não achou o arquivo HTML do sistema principal. ' +
    'Ele tentou estes nomes, sem sucesso:</p>' +
    '<p style="font-family:monospace;font-size:12px;background:#f4f1ea;' +
    'padding:12px;border-radius:8px">' + tentativas.join(' · ') + '</p>' +
    '<h2 style="font-size:16px;margin:22px 0 8px">O que fazer</h2>' +
    '<ol style="padding-left:20px">' +
    '<li>No editor, veja a lista de Arquivos e ache o <b>HTML</b> do sistema ' +
    'principal (o que desenha o menu do ALMOXA PRO).</li>' +
    '<li>Copie o nome exato dele.</li>' +
    '<li>Neste arquivo, na linha <code>var TELA_PRINCIPAL</code>, ' +
    'cole o nome entre as aspas.</li>' +
    '<li>Salve e reimplante com Nova versão.</li>' +
    '</ol>' +
    '<p style="margin-top:20px;padding-top:16px;border-top:1px solid #ddd">' +
    'A Central de Biometria já está no ar e funcionando em: ' +
    '<br><b>esta mesma URL + <code>?pagina=biometria</code></b></p>' +
    '</div>').setTitle('ALMOXA PRO');
}


var AXBIO = (function () {

  var ABA        = 'BIOMETRIA';
  var ABA_DEDOS  = 'BIOMETRIA_DEDOS';
  var ABA_LOGS   = 'BIOMETRIA_LOGS';

  var DEDOS = ['Polegar direito','Indicador direito','Médio direito',
               'Anelar direito','Mínimo direito','Polegar esquerdo',
               'Indicador esquerdo','Médio esquerdo','Anelar esquerdo',
               'Mínimo esquerdo'];

  /* ---------------------------------------------------------------- base */

  /**
   * Devolve a planilha. Funciona nos dois casos:
   *  - projeto preso à planilha  -> getActive()
   *  - projeto independente      -> openById do ID guardado nas propriedades
   */
  function planilha() {
    var bruto = PLANILHA_ID || '';
    if (bruto.indexOf('COLE_AQUI') === 0 || !bruto) {
      throw new Error('Falta configurar a planilha. No topo deste script, ' +
        'coloque a URL da sua planilha na linha PLANILHA_ID.');
    }
    var m = String(bruto).match(/[-\w]{25,}/);
    var id = m ? m[0] : String(bruto).trim();
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {
      throw new Error('Não consegui abrir a planilha de ID ' + id +
        '. Confira a URL e a permissão. Detalhe: ' + e.message);
    }
  }

  function linhas(nomeAba) {
    var sh = planilha().getSheetByName(nomeAba);
    if (!sh) return [];
    var v = sh.getDataRange().getValues();
    if (v.length < 2) return [];
    var cab = v.shift().map(function (c) {
      return String(c).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    });
    return v.map(function (l) {
      var o = {};
      cab.forEach(function (c, i) { o[c] = l[i]; });
      return o;
    });
  }

  function data(v) {
    if (!v) return '';
    if (v instanceof Date) {
      return Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
    }
    return String(v);
  }

  /** Barreira: dado biométrico bruto não entra no Google. */
  function recusarBruto(d) {
    var proibidos = ['fmd','fid','template','imagem','image','base64','sample'];
    for (var k in d) {
      var chave = String(k).toLowerCase();
      for (var i = 0; i < proibidos.length; i++) {
        if (chave.indexOf(proibidos[i]) >= 0) {
          throw new Error('BLOQUEIO: o campo "' + k + '" carrega dado biométrico ' +
                          'bruto e não pode ser gravado na planilha.');
        }
      }
    }
  }

  /* -------------------------------------------------------- colaboradores */

  /** Normaliza um cabeçalho: "Matrícula do Colab." -> "matriculadocolab" */
  function nrm(s) {
    return String(s).trim().toLowerCase()
      .replace(/[áàâã]/g,'a').replace(/[éê]/g,'e').replace(/[íï]/g,'i')
      .replace(/[óôõ]/g,'o').replace(/[úü]/g,'u').replace(/ç/g,'c')
      .replace(/[^a-z0-9]/g,'');
  }

  /** Acha a coluna cujo nome contém uma das palavras. */
  function achar(cab, palavras) {
    for (var p = 0; p < palavras.length; p++) {
      for (var i = 0; i < cab.length; i++) {
        if (cab[i].indexOf(palavras[p]) >= 0) return i;
      }
    }
    return -1;
  }

  /**
   * Descobre sozinho qual aba guarda os colaboradores, dando nota para
   * cada aba conforme as colunas que ela tem. Guarda a escolha para não
   * refazer a busca toda vez.
   */
  function abaColaboradores() {
    var props = PropertiesService.getScriptProperties();
    var salvo = props.getProperty('AXBIO_ABA_COLAB');
    var ss = planilha();
    if (salvo && ss.getSheetByName(salvo)) return ss.getSheetByName(salvo);

    var melhor = null, notaMelhor = 0;
    ss.getSheets().forEach(function (sh) {
      var nome = nrm(sh.getName());
      if (nome.indexOf('biometria') >= 0) return;      // são as minhas abas
      var v = sh.getDataRange().getValues();
      if (v.length < 2) return;
      var cab = v[0].map(nrm);
      var nota = 0;
      if (achar(cab, ['matricula']) >= 0) nota += 4;
      if (achar(cab, ['nome']) >= 0) nota += 3;
      if (achar(cab, ['cargo','funcao']) >= 0) nota += 1;
      if (achar(cab, ['obra','setor']) >= 0) nota += 1;
      if (achar(cab, ['perfil','nivel']) >= 0) nota += 1;
      if (achar(cab, ['foto']) >= 0) nota += 1;
      if (nome.indexOf('colab') >= 0 || nome.indexOf('funcionario') >= 0 ||
          nome.indexOf('pessoa') >= 0) nota += 4;
      if (nota > notaMelhor) { notaMelhor = nota; melhor = sh; }
    });

    if (!melhor) {
      throw new Error('Não encontrei nenhuma aba com colaboradores nesta ' +
        'planilha. Abra a tela de Diagnóstico > Base de dados para ver o que ' +
        'existe, ou defina a aba na função axbioDefinirAbaColaboradores.');
    }
    props.setProperty('AXBIO_ABA_COLAB', melhor.getName());
    return melhor;
  }

  function lerColaboradores(_segundaTentativa) {
    var sh = abaColaboradores();
    var v = sh.getDataRange().getValues();
    var lista = [];

    if (v.length >= 2) {
      var cab = v.shift().map(nrm);
      var c = {
        id:   achar(cab, ['colaboradorid','idcolaborador','id','codigo','usuario']),
        nome: achar(cab, ['nomecompleto','nome','colaborador','funcionario']),
        mat:  achar(cab, ['matricula','matr','registro','chapa']),
        carg: achar(cab, ['cargo','funcao','ocupacao']),
        obra: achar(cab, ['obra','setor','local','unidade']),
        perf: achar(cab, ['perfil','nivel','acesso','tipo']),
        foto: achar(cab, ['foto','imagem','avatar']),
        stat: achar(cab, ['status','situacao','ativo'])
      };
      lista = v.map(function (l) {
        var pega = function (i) { return i >= 0 ? String(l[i] || '').trim() : ''; };
        return {
          colaborador_id: pega(c.id) || pega(c.mat),
          nome: pega(c.nome), matricula: pega(c.mat), cargo: pega(c.carg),
          obra: pega(c.obra), perfil: pega(c.perf), foto: pega(c.foto),
          status: (pega(c.stat) || 'ATIVO').toUpperCase()
        };
      }).filter(function (x) { return x.nome || x.matricula; });
    }

    // Se a aba gravada não devolveu ninguém, esquece a escolha e procura de novo.
    if (lista.length === 0 && !_segundaTentativa) {
      PropertiesService.getScriptProperties().deleteProperty('AXBIO_ABA_COLAB');
      return lerColaboradores(true);
    }
    return lista;
  }

  /** Radiografia da planilha, mostrada dentro da tela de Diagnóstico. */
  function estrutura() {
    var ss = planilha();
    var escolhida = '';
    try { escolhida = abaColaboradores().getName(); } catch (e) { escolhida = '(nenhuma)'; }
    return {
      planilha: ss.getName(),
      aba_gravada: PropertiesService.getScriptProperties().getProperty('AXBIO_ABA_COLAB') || '(nenhuma)',
      aba_colaboradores: escolhida,
      total_colaboradores: (function () {
        try { return lerColaboradores().length; } catch (e) { return 0; }
      })(),
      abas: ss.getSheets().map(function (sh) {
        var v = sh.getDataRange().getValues();
        return { nome: sh.getName(), linhas: Math.max(0, v.length - 1),
                 colunas: v.length ? v[0].join(' | ') : '' };
      })
    };
  }

  function buscar(termo) {
    termo = String(termo || '').toLowerCase().trim();
    if (!termo) return [];
    return lerColaboradores().filter(function (c) {
      return (String(c.nome) + String(c.matricula) + String(c.colaborador_id))
        .toLowerCase().indexOf(termo) >= 0;
    }).slice(0, 15);
  }

  /* -------------------------------------------------------------- cadastro */

  function situacao(id) {
    var dedos = linhas(ABA_DEDOS).filter(function (l) {
      return String(l['colaboradorid']) === String(id) &&
             String(l['status']).toUpperCase() === 'ATIVO';
    }).map(function (l) { return Number(l['dedo']); });

    var cab = linhas(ABA).filter(function (l) {
      return String(l['colaboradorid']) === String(id);
    })[0];

    return { colaborador_id: id, dedos: dedos, quantidade: dedos.length,
             biometria_id: cab ? cab['biometriaid'] : null,
             status: cab ? cab['status'] : 'SEM CADASTRO' };
  }

  function registrarCadastro(d) {
    recusarBruto(d);
    criarTabelas();
    var ss = planilha();
    var aba = ss.getSheetByName(ABA);
    var agora = new Date();

    var v = aba.getDataRange().getValues();
    var pos = -1;
    for (var i = 1; i < v.length; i++) {
      if (String(v[i][1]) === String(d.colaborador_id)) { pos = i + 1; break; }
    }
    var bioId = pos > 0 ? v[pos - 1][0]
              : 'BIO-' + Utilities.getUuid().slice(0, 8).toUpperCase();

    var linha = [bioId, d.colaborador_id, d.matricula || '', d.nome || '',
                 d.status || 'ATIVO', d.dedos_cadastrados || 0,
                 pos > 0 ? v[pos - 1][6] : agora, agora,
                 d.dispositivo || '', 'OK', d.observacao || ''];

    if (pos > 0) aba.getRange(pos, 1, 1, linha.length).setValues([linha]);
    else aba.appendRow(linha);

    var abaDedos = ss.getSheetByName(ABA_DEDOS);
    (d.dedos || []).forEach(function (n) {
      var w = abaDedos.getDataRange().getValues();
      for (var j = 1; j < w.length; j++) {
        if (String(w[j][0]) === String(d.colaborador_id) && Number(w[j][1]) === Number(n)) {
          abaDedos.getRange(j + 1, 1, 1, 6).setValues([[d.colaborador_id, n,
            DEDOS[n - 1], 'ATIVO', agora, d.dispositivo || '']]);
          return;
        }
      }
      abaDedos.appendRow([d.colaborador_id, n, DEDOS[n - 1], 'ATIVO', agora,
                          d.dispositivo || '']);
    });

    evento({ tipo: 'cadastro_concluido', colaborador_id: d.colaborador_id,
             detalhe: (d.dedos_cadastrados || 0) + '/10 dedos',
             dispositivo: d.dispositivo });

    return { biometria_id: bioId, dedos_cadastrados: d.dedos_cadastrados || 0 };
  }

  function listar() {
    return linhas(ABA).map(function (l) {
      return { biometria_id: l['biometriaid'], colaborador_id: l['colaboradorid'],
               matricula: l['matricula'], nome: l['nome'], status: l['status'],
               dedos_cadastrados: l['quantidadededos'],
               data_cadastro: data(l['datacadastro']),
               dispositivo: l['dispositivocadastro'] };
    });
  }

  /* ---------------------------------------------------------------- logs */

  function evento(d) {
    var aba = planilha().getSheetByName(ABA_LOGS);
    if (!aba) return { registrado: false };
    aba.appendRow([new Date(), d.tipo || '', d.colaborador_id || '',
                   d.detalhe || '', d.dispositivo || '', d.resultado || '']);
    return { registrado: true };
  }

  function logs(limite) {
    var l = linhas(ABA_LOGS);
    return l.slice(Math.max(0, l.length - (limite || 80))).reverse().map(function (r) {
      return { momento: data(r['momento']), tipo: r['tipo'],
               colaborador_id: r['colaboradorid'], detalhe: r['detalhe'],
               dispositivo: r['dispositivo'], resultado: r['resultado'] };
    });
  }

  /* --------------------------------------------------------- autorização */

  function autorizar(d) {
    var c = lerColaboradores().filter(function (x) {
      return String(x.colaborador_id) === String(d.colaborador_id);
    })[0];

    if (!c) return negar('COLABORADOR NÃO ENCONTRADO', d);
    if (c.status !== 'ATIVO') return negar('COLABORADOR INATIVO', d);

    var matriz = { 'MASTER': ['*'],
      'ALMOXARIFE': ['RETIRADA','DEVOLUCAO','SOLICITACAO','RESERVA','INVENTARIO'],
      'ENCARREGADO': ['SOLICITACAO','RESERVA','APROVACAO'],
      'COLABORADOR': ['SOLICITACAO','DEVOLUCAO'] };
    var perms = matriz[String(c.perfil).toUpperCase()] || [];
    if (perms.indexOf('*') < 0 &&
        perms.indexOf(String(d.operacao).toUpperCase()) < 0) {
      return negar('SEM PERMISSÃO PARA ' + d.operacao, d);
    }

    if (d.item) {
      var it = linhas('Itens').filter(function (l) {
        return String(l['codigo']) === String(d.item); })[0];
      if (!it) return negar('ITEM NÃO CADASTRADO. A solicitação não pode ser finalizada.', d);
      if (String(it['status']).toUpperCase() !== 'ATIVO') return negar('ITEM INATIVO', d);
      if (Number(it['disponivel'] || 0) <= 0) return negar('ITEM SEM DISPONIBILIDADE', d);
    }

    if (d.patrimonio) {
      var pt = linhas('Patrimonio').filter(function (l) {
        return String(l['patrimonio']) === String(d.patrimonio); })[0];
      if (!pt) return negar('PATRIMÔNIO NÃO CADASTRADO', d);
      if (String(pt['status']).toUpperCase() !== 'DISPONIVEL') {
        return negar('PATRIMÔNIO INDISPONÍVEL', d);
      }
      if (d.solicitacao_id) {
        var so = linhas('Solicitacoes').filter(function (l) {
          return String(l['id']) === String(d.solicitacao_id); })[0];
        if (!so) return negar('SOLICITAÇÃO NÃO ENCONTRADA', d);
        if (String(so['patrimonio']) !== String(d.patrimonio)) {
          return negar('PATRIMÔNIO NÃO CORRESPONDE À SOLICITAÇÃO', d);
        }
      }
    }

    evento({ tipo: 'operacao_autorizada', colaborador_id: d.colaborador_id,
             detalhe: d.operacao, dispositivo: d.dispositivo,
             resultado: 'AUTORIZADO' });
    return { autorizado: true, motivo: 'OK' };
  }

  function negar(motivo, d) {
    evento({ tipo: 'operacao_bloqueada', colaborador_id: d.colaborador_id,
             detalhe: motivo, dispositivo: d.dispositivo, resultado: 'BLOQUEADO' });
    return { autorizado: false, motivo: motivo };
  }

  /* -------------------------------------------------------------- tabelas */

  function criarTabelas() {
    var ss = planilha();
    if (!ss.getSheetByName(ABA)) {
      ss.insertSheet(ABA).appendRow(['BiometriaID','ColaboradorID','Matricula',
        'Nome','Status','QuantidadeDedos','DataCadastro','UltimaValidacao',
        'DispositivoCadastro','StatusBiometria','Observacao']);
    }
    if (!ss.getSheetByName(ABA_DEDOS)) {
      ss.insertSheet(ABA_DEDOS).appendRow(['ColaboradorID','Dedo','DedoNome',
        'Status','DataCadastro','Dispositivo']);
    }
    if (!ss.getSheetByName(ABA_LOGS)) {
      ss.insertSheet(ABA_LOGS).appendRow(['Momento','Tipo','ColaboradorID',
        'Detalhe','Dispositivo','Resultado']);
    }
    return ss;
  }

  function ping() {
    var ss = planilha();
    return { versao: 'biometria v4',
             hora: new Date().toISOString(),
             tabela_biometria: !!ss.getSheetByName(ABA),
             tabela_colaboradores: true,
             colaboradores: (function(){ try { return lerColaboradores().length; }
                                          catch(e){ return 0; } })() };
  }

  /* ----------------------------------------------------------------- tela */


  /* ------------------------------------------------------------- despacho */

  function api(acao, dados) {
    dados = dados || {};
    try {
      switch (acao) {
        case 'bio_ping':               return ok(ping());
        case 'bio_buscar_colaborador': return ok({ itens: buscar(dados.termo) });
        case 'bio_situacao':           return ok(situacao(dados.colaborador_id));
        case 'bio_registrar_cadastro': return ok(registrarCadastro(dados));
        case 'bio_estrutura':          return ok(estrutura());
        case 'bio_definir_aba':        return ok(definirAba(dados.aba));
        case 'bio_redetectar':         return ok(redetectar());
        case 'bio_listar':             return ok({ itens: listar() });
        case 'bio_logs':               return ok({ itens: logs(80) });
        case 'bio_evento':             return ok(evento(dados));
        case 'bio_autorizar':          return ok(autorizar(dados));
        default: return { ok: false, dados: {}, erro: 'Ação desconhecida: ' + acao };
      }
    } catch (err) {
      return { ok: false, dados: {},
               erro: String(err && err.message ? err.message : err) };
    }
  }

  function redetectar() {
    PropertiesService.getScriptProperties().deleteProperty('AXBIO_ABA_COLAB');
    var n = lerColaboradores().length;
    return { aba: abaColaboradores().getName(), colaboradores: n };
  }

  function definirAba(nome) {
    var ss = planilha();
    if (!ss.getSheetByName(nome)) throw new Error('Aba não existe: ' + nome);
    PropertiesService.getScriptProperties().setProperty('AXBIO_ABA_COLAB', nome);
    return { aba: nome, colaboradores: lerColaboradores().length };
  }

  function ok(d) { return { ok: true, dados: d || {}, erro: '' }; }

  return {
    api: api, criarTabelas: criarTabelas, lerColaboradores: lerColaboradores,
    linhas: linhas, planilha: planilha, estrutura: estrutura,
    DEDOS: DEDOS
  };
})();


/* ===========================================================================
   OS ÚNICOS 7 NOMES QUE ESTE ARQUIVO CRIA NO PROJETO
   =========================================================================== */

/** Chamada pela tela. */
function axbioApi(acao, dados) { return AXBIO.api(acao, dados); }

function axbioCriarTabelas() { AXBIO.criarTabelas(); Logger.log('Tabelas prontas.'); }

/** Lista abas, colunas e um exemplo. Mande este registro para análise. */
function axbioMostrarEstrutura() {
  var out = ['=== ESTRUTURA DA PLANILHA ==='];
  AXBIO.planilha().getSheets().forEach(function (sh) {
    var v = sh.getDataRange().getValues();
    out.push('');
    out.push('ABA: ' + sh.getName() + '   (' + Math.max(0, v.length - 1) + ' linhas)');
    out.push('  COLUNAS: ' + (v.length ? v[0].join(' | ') : '(vazia)'));
    if (v.length > 1) out.push('  EXEMPLO: ' + v[1].slice(0, 8).join(' | '));
  });
  Logger.log(out.join('\n'));
  return out.join('\n');
}

/** Confirma se o módulo enxerga os colaboradores. */
function axbioTestarLeitura() {
  var l = AXBIO.lerColaboradores();
  
  Logger.log('Colaboradores encontrados: ' + l.length);
  Logger.log('Primeiros 3: ' + JSON.stringify(l.slice(0, 3), null, 2));
  return l.length;
}

/** Mostra se algum nome deste arquivo bate com os módulos antigos. */
function axbioVerificarConflitos() {
  var meus = ['axbioApi','axbioAbrirCentral','axbioRota','axbioCriarTabelas',
              'axbioMostrarEstrutura','axbioTestarLeitura','axbioVerificarConflitos',
              'AXBIO'];
  var out = ['=== NOMES GLOBAIS DO PROJETO ==='];
  var todos = [];
  for (var k in this) { todos.push(k); }
  todos.sort();

  out.push('');
  out.push('Entradas web deste projeto:');
  ['doGet','doPost','onOpen','onEdit'].forEach(function (n) {
    out.push('  ' + n + ': ' + (typeof this[n] === 'function' ? 'existe' : 'não existe'));
  }, this);

  out.push('');
  out.push('Funções de biometria já existentes no projeto:');
  var outros = todos.filter(function (n) {
    return /^(bio|BIO)/.test(n) && meus.indexOf(n) < 0;
  });
  out.push(outros.length ? '  ' + outros.join('\n  ')
                         : '  nenhuma além das minhas');

  out.push('');
  out.push('Meus nomes (devem ser só estes 8): ' + meus.join(', '));
  Logger.log(out.join('\n'));
  return out.join('\n');
}


/* =========================================================================
   A TELA (HTML embutido). Não precisa mexer aqui.
   ========================================================================= */

function AXBIO_TELA() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ALMOXA PRO · Central de Biometria</title>

<!-- Integração oficial HID DigitalPersona para navegador.
     Exige o HID Authentication Device Client (antigo Lite Client) instalado
     na máquina. Sem ele, a tela avisa e NÃO finge estar conectada. -->
<script src="https://unpkg.com/@digitalpersona/websdk@v1"></script>
<script src="https://unpkg.com/@digitalpersona/fingerprint@v1"></script>

<style>
:root{
  --fundo:#0a1424;
  --painel:#0f1c30;
  --painel-alto:#132340;
  --linha:#1d2f4d;
  --texto:#e7eefb;
  --suave:#8ba0bd;
  --fraco:#5c7593;
  --neutro:#3b5273;
  --azul:#2f7ff0;
  --azul-escuro:#17304f;
  --verde:#2ecc71;
  --laranja:#f0883e;
  --vermelho:#ef4a5a;
}

*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{
  background:var(--fundo);
  color:var(--texto);
  font:400 14px/1.5 "Segoe UI",system-ui,-apple-system,sans-serif;
  display:flex;flex-direction:column;overflow:hidden;
}

/* ---------- topo ---------- */
.topo{display:flex;align-items:center;gap:28px;padding:14px 22px;background:var(--painel);border-bottom:1px solid var(--linha);flex:0 0 auto}
.marca{display:flex;align-items:center;gap:12px;width:224px;flex:0 0 224px}
.cubo{width:42px;height:42px;border-radius:11px;background:linear-gradient(150deg,#3b8ef7,#1d5fc4);display:grid;place-items:center;font-size:20px}
.marca b{display:block;font-size:15px;letter-spacing:.3px}
.marca span{display:block;font-size:11px;color:var(--suave)}
.subtitulo{flex:1}
.subtitulo b{font-size:13px;font-weight:600}
.subtitulo p{font-size:12px;color:var(--suave)}
.maquina{text-align:right;font-size:12px;color:var(--suave)}
.maquina b{display:block;color:var(--texto);font-size:13px}
.sinal{display:inline-flex;align-items:center;gap:6px;font-size:12px}
.ponto{width:8px;height:8px;border-radius:50%;background:var(--neutro)}
.ponto.on{background:var(--verde);box-shadow:0 0 8px rgba(46,204,113,.7)}
.ponto.off{background:var(--vermelho)}
.ponto.espera{background:var(--laranja)}

/* ---------- corpo ---------- */
.corpo{flex:1;display:flex;min-height:0}
nav{width:224px;flex:0 0 224px;background:var(--painel);border-right:1px solid var(--linha);padding:14px 0;display:flex;flex-direction:column;overflow-y:auto}
nav button{display:flex;align-items:center;gap:12px;width:100%;padding:12px 20px;background:none;border:0;border-left:3px solid transparent;color:var(--suave);font:inherit;font-size:14px;text-align:left;cursor:pointer}
nav button:hover{color:var(--texto);background:rgba(255,255,255,.03)}
nav button.ativo{color:var(--texto);background:var(--azul-escuro);border-left-color:var(--azul)}
nav button i{font-style:normal;width:20px;text-align:center;opacity:.9}
.rodape-nav{margin-top:auto;padding:20px;font-size:11px;color:var(--suave);line-height:1.6}

main{flex:1;overflow-y:auto;padding:22px}
.cabecalho{display:flex;align-items:flex-start;gap:16px;margin-bottom:20px}
.cabecalho .icone{font-size:34px;color:var(--azul)}
.cabecalho h1{font-size:24px;font-weight:600}
.cabecalho p{font-size:13px;color:var(--suave);margin-top:2px}
.cabecalho .acao{margin-left:auto}

.grade{display:grid;grid-template-columns:1fr 320px;gap:18px;align-items:start}
.coluna{display:flex;flex-direction:column;gap:18px;min-width:0}
.dupla{display:grid;grid-template-columns:1fr 1fr;gap:18px}

.cartao{background:var(--painel);border:1px solid var(--linha);border-radius:12px;padding:18px}
.cartao h2{font-size:15px;font-weight:600;margin-bottom:16px}
.cartao h3{font-size:13px;font-weight:600;color:var(--suave);margin-bottom:10px}

button.b{border:0;border-radius:9px;padding:12px 18px;font:inherit;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px}
button.b.principal{background:var(--azul);color:#fff;width:100%}
button.b.principal:hover{background:#3f8bf5}
button.b.principal:disabled{background:var(--neutro);cursor:not-allowed;opacity:.6}
button.b.fantasma{background:var(--painel-alto);color:var(--texto);border:1px solid var(--linha)}
button.b.fantasma:hover{border-color:var(--azul)}

/* colaborador */
.busca{display:flex;gap:8px;margin-bottom:16px}
.busca input{flex:1;background:var(--fundo);border:1px solid var(--linha);border-radius:8px;padding:10px 12px;color:var(--texto);font:inherit}
.busca input:focus{outline:none;border-color:var(--azul)}
.busca button{background:var(--painel-alto);border:1px solid var(--linha);border-radius:8px;width:42px;color:var(--suave);cursor:pointer;font-size:15px}
.pessoa{display:flex;gap:16px}
.retrato{width:112px;height:126px;border-radius:9px;object-fit:cover;background:var(--painel-alto);flex:0 0 112px;display:grid;place-items:center;color:var(--fraco);font-size:30px}
.pessoa .dados{flex:1;min-width:0}
.pessoa .nome{font-size:16px;font-weight:600;margin-bottom:8px}
.linha-dado{display:flex;gap:8px;font-size:13px;margin-bottom:4px}
.linha-dado span:first-child{color:var(--suave);width:66px;flex:0 0 66px}
.resultados{margin-top:10px;max-height:190px;overflow-y:auto;border:1px solid var(--linha);border-radius:8px;display:none}
.resultados div{padding:9px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--linha)}
.resultados div:last-child{border-bottom:0}
.resultados div:hover{background:var(--painel-alto)}

/* progresso */
.progresso{display:flex;align-items:center;gap:22px;margin-bottom:16px}
.rosca{position:relative;width:126px;height:126px;flex:0 0 126px}
.rosca text{fill:var(--texto)}
.legenda{flex:1;display:flex;flex-direction:column;gap:11px;font-size:13px}
.legenda div{display:flex;align-items:center;gap:9px}
.legenda b{margin-left:auto;font-variant-numeric:tabular-nums}

/* captura */
.captura{display:grid;grid-template-columns:1fr 1.15fr 1fr;gap:18px}
.captura>div{min-width:0}
.dedo-atual .contagem{font-size:34px;font-weight:600;line-height:1.1}
.dedo-atual .qual{font-size:17px;color:var(--azul);font-weight:600;margin-bottom:14px}
.mao{font-size:58px;text-align:center;padding:8px 0;color:var(--azul)}
.instrucao b{display:block;font-size:15px;margin-bottom:6px}
.instrucao p{font-size:13px;color:var(--suave)}
.alvo{text-align:center;padding:14px 0}
.alvo .marca-dedo{font-size:46px;color:var(--azul);opacity:.85}
.alvo .estado{font-size:13px;color:var(--suave);margin-top:8px}
.pontinhos{display:flex;gap:6px;justify-content:center;margin-top:12px}
.pontinhos i{width:7px;height:7px;border-radius:50%;background:var(--neutro);display:block}
.pontinhos i.feito{background:var(--verde)}
.pontinhos i.agora{background:var(--azul)}
.medidas{display:flex;gap:14px}
.moldura{width:96px;height:118px;border:1px solid var(--linha);border-radius:8px;background:var(--fundo);display:grid;place-items:center;overflow:hidden;flex:0 0 96px}
.moldura img{width:100%;height:100%;object-fit:contain}
.moldura span{color:var(--fraco);font-size:11px;text-align:center;padding:6px}
.barras{flex:1;display:flex;flex-direction:column;gap:11px;justify-content:center;font-size:12px;color:var(--suave)}
.barras div span{display:block;margin-bottom:4px}
.barra{height:5px;border-radius:3px;background:var(--painel-alto);overflow:hidden}
.barra i{display:block;height:100%;width:0;background:var(--verde);transition:width .25s}

/* painel dos dedos */
.dedos{display:grid;grid-template-columns:repeat(10,1fr);gap:9px}
.dedo{background:var(--fundo);border:1px solid var(--linha);border-radius:9px;padding:10px 6px;text-align:center;font-size:11px;color:var(--suave);cursor:pointer}
.dedo b{display:block;font-weight:600;color:var(--texto);font-size:11px;line-height:1.3;min-height:29px}
.dedo .simbolo{font-size:27px;margin-top:6px;color:var(--neutro)}
.dedo.ok .simbolo{color:var(--verde)}
.dedo.agora{background:var(--azul-escuro);border-color:var(--azul)}
.dedo.agora .simbolo{color:var(--azul)}
.dedo.ruim .simbolo{color:var(--laranja)}
.chaves{display:flex;gap:18px;margin-top:14px;font-size:12px;color:var(--suave)}
.chaves span{display:inline-flex;align-items:center;gap:7px}

/* lateral */
.estado-leitor{display:flex;align-items:center;gap:11px;font-size:15px;font-weight:600;margin-bottom:16px}
.ficha div{display:flex;font-size:13px;margin-bottom:9px;gap:10px}
.ficha div span:first-child{color:var(--suave);width:82px;flex:0 0 82px}
.ficha div span:last-child{flex:1;word-break:break-word}
.capturas{display:flex;flex-direction:column;gap:2px;max-height:330px;overflow-y:auto}
.capturas .item{display:flex;align-items:center;gap:11px;padding:9px 2px;border-bottom:1px solid var(--linha)}
.capturas .item:last-child{border-bottom:0}
.capturas .selo{width:34px;height:34px;border-radius:7px;background:var(--fundo);display:grid;place-items:center;color:var(--verde);font-size:17px;flex:0 0 34px}
.capturas .selo.ruim{color:var(--laranja)}
.capturas .txt{flex:1;min-width:0}
.capturas .txt b{display:block;font-size:13px;font-weight:500}
.capturas .txt span{font-size:11px;color:var(--suave)}
.capturas .hora{font-size:12px;color:var(--suave)}
.vazio{color:var(--fraco);font-size:13px;padding:12px 0;text-align:center}

/* rodapé */
.rodape{display:flex;gap:22px;padding:9px 22px;background:var(--painel);border-top:1px solid var(--linha);font-size:12px;color:var(--suave);flex:0 0 auto}
.rodape .dir{margin-left:auto;display:flex;gap:22px}

/* diagnóstico */
.diag{display:flex;flex-direction:column;gap:1px}
.diag .item{display:flex;align-items:flex-start;gap:13px;padding:13px 2px;border-bottom:1px solid var(--linha)}
.diag .item:last-child{border-bottom:0}
.diag .mark{font-size:16px;width:22px;flex:0 0 22px;text-align:center}
.diag .corpo-d{flex:1}
.diag .corpo-d b{display:block;font-size:14px;font-weight:600}
.diag .corpo-d p{font-size:12px;color:var(--suave);margin-top:3px}
.diag .corpo-d .acao-corr{font-size:12px;color:var(--laranja);margin-top:5px}

.aviso{border:1px solid var(--laranja);background:rgba(240,136,62,.09);border-radius:10px;padding:14px 16px;font-size:13px;line-height:1.6}
.aviso b{display:block;margin-bottom:6px;color:var(--laranja)}

table.reg{width:100%;border-collapse:collapse;font-size:13px}
table.reg th{text-align:left;color:var(--suave);font-weight:500;padding:9px 10px;border-bottom:1px solid var(--linha);font-size:12px}
table.reg td{padding:10px;border-bottom:1px solid var(--linha)}

.oculto{display:none !important}
@media(max-width:1180px){.grade{grid-template-columns:1fr}.captura{grid-template-columns:1fr}.dedos{grid-template-columns:repeat(5,1fr)}}
</style>
</head>
<body>

<header class="topo">
  <div class="marca">
    <div class="cubo">▣</div>
    <div><b>ALMOXA PRO</b><span>Central de Biometria</span></div>
  </div>
  <div class="subtitulo">
    <b>Controle de acesso, identificação e segurança</b>
    <p>Biometria para um almoxarifado mais seguro e eficiente</p>
  </div>
  <div class="maquina">
    <b id="tpMaquina">Estação local</b>
    <span class="sinal"><i class="ponto" id="tpPontoCore"></i> <span id="tpCore">Verificando Core…</span></span>
  </div>
</header>

<div class="corpo">
  <nav>
    <button data-tela="inicio"><i>⌂</i> Início</button>
    <button data-tela="cadastro" class="ativo"><i>◉</i> Cadastro de Biometria</button>
    <button data-tela="identificacao"><i>☺</i> Identificação</button>
    <button data-tela="consulta"><i>☷</i> Consultar Biometria</button>
    <button data-tela="dispositivos"><i>▭</i> Dispositivos</button>
    <button data-tela="diagnostico"><i>✚</i> Diagnóstico</button>
    <button data-tela="historico"><i>▤</i> Logs e Auditoria</button>
    <div class="rodape-nav">
      ALMOXA PRO<br>Gestão de Almoxarifado<br><br>Pessoas, materiais e obras em um só lugar.
    </div>
  </nav>

  <main>

  <!-- ================= CADASTRO ================= -->
  <section class="tela" id="tela-cadastro">
    <div class="cartao" id="barraUrl" style="display:none;margin-bottom:18px">
      <h2>Endereço do Core</h2>
      <p style="font-size:13px;color:var(--suave);margin-bottom:12px">
        Cole aqui a URL da implantação (termina em /exec). Ela fica salva neste
        computador.
      </p>
      <div class="busca">
        <input id="campoUrl" placeholder="https://script.google.com/macros/s/.../exec">
        <button onclick="salvarUrl()" style="width:auto;padding:0 16px">Salvar</button>
      </div>
      <div id="statusUrl" style="font-size:12px;color:var(--suave);margin-top:8px"></div>
    </div>
    <div class="cabecalho">
      <div class="icone">◉</div>
      <div>
        <h1>Cadastro de biometria</h1>
        <p>Selecione um colaborador e cadastre os 10 dedos de forma automática e guiada.</p>
      </div>
      <div class="acao"><button class="b fantasma" onclick="verificarDispositivo()">⟳ Verificar dispositivo</button></div>
    </div>

    <div class="grade">
      <div class="coluna">

        <div class="dupla">
          <div class="cartao">
            <h2>Colaborador</h2>
            <div class="busca">
              <input id="cBusca" placeholder="Buscar por nome, matrícula ou ID" onkeydown="if(event.key==='Enter')buscarColaborador()">
              <button onclick="buscarColaborador()">⌕</button>
            </div>
            <div class="resultados" id="cResultados"></div>
            <div class="pessoa">
              <div class="retrato" id="cFoto">☺</div>
              <div class="dados">
                <div class="nome" id="cNome">Nenhum selecionado</div>
                <div class="linha-dado"><span>ID</span><span id="cId">—</span></div>
                <div class="linha-dado"><span>Matrícula</span><span id="cMat">—</span></div>
                <div class="linha-dado"><span>Cargo</span><span id="cCargo">—</span></div>
                <div class="linha-dado"><span>Obra</span><span id="cObra">—</span></div>
                <div class="linha-dado"><span>Status</span><span id="cStatus">—</span></div>
              </div>
            </div>
          </div>

          <div class="cartao">
            <h2>Progresso do cadastro</h2>
            <div class="progresso">
              <div class="rosca">
                <svg viewBox="0 0 120 120" width="126" height="126">
                  <circle cx="60" cy="60" r="52" fill="none" stroke="#1d2f4d" stroke-width="11"/>
                  <circle id="arco" cx="60" cy="60" r="52" fill="none" stroke="#2ecc71" stroke-width="11"
                          stroke-linecap="round" stroke-dasharray="326.7" stroke-dashoffset="326.7"
                          transform="rotate(-90 60 60)"/>
                  <text id="arcoTxt" x="60" y="57" text-anchor="middle" font-size="25" font-weight="600">0/10</text>
                  <text x="60" y="74" text-anchor="middle" font-size="9.5" fill="#8ba0bd">dedos cadastrados</text>
                </svg>
              </div>
              <div class="legenda">
                <div><i class="ponto on"></i> Cadastrados <b id="lgOk">0</b></div>
                <div><i class="ponto"></i> Pendentes <b id="lgPend">10</b></div>
                <div><i class="ponto espera"></i> Qualidade baixa <b id="lgRuim">0</b></div>
              </div>
            </div>
            <button class="b principal" id="btIniciar" onclick="alternarCadastro()" disabled>▶ Iniciar cadastro</button>
          </div>
        </div>

        <div class="cartao">
          <h2>Captura de biometria</h2>
          <div class="captura">
            <div class="dedo-atual">
              <h3>Dedo atual</h3>
              <div class="contagem" id="capContagem">—</div>
              <div class="qual" id="capDedo">Aguardando início</div>
              <div class="mao" id="capMao">✋</div>
            </div>
            <div class="instrucao">
              <h3>Instruções</h3>
              <b id="capTitulo">Selecione um colaborador</b>
              <p id="capTexto">Busque a pessoa pelo nome ou matrícula e clique em iniciar cadastro.</p>
              <div class="alvo">
                <div class="marca-dedo">◉</div>
                <div class="estado" id="capEstado">Parado</div>
                <div class="pontinhos" id="capPontos"></div>
              </div>
            </div>
            <div>
              <h3>Qualidade da captura</h3>
              <div class="medidas">
                <div class="moldura" id="capMoldura"><span>A imagem aparece aqui quando o leitor capturar</span></div>
                <div class="barras">
                  <div><span>Qualidade</span><div class="barra"><i id="bQual"></i></div></div>
                  <div><span>Amostras válidas</span><div class="barra"><i id="bAmostras"></i></div></div>
                  <div><span>Progresso do dedo</span><div class="barra"><i id="bDedo"></i></div></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="cartao">
          <h2>Painel dos 10 dedos</h2>
          <div class="dedos" id="painelDedos"></div>
          <div class="chaves">
            <span><i class="ponto on"></i> Cadastrado</span>
            <span><i class="ponto" style="background:var(--azul)"></i> Em captura</span>
            <span><i class="ponto"></i> Pendente</span>
            <span><i class="ponto espera"></i> Qualidade baixa</span>
          </div>
        </div>
      </div>

      <div class="coluna">
        <div class="cartao">
          <h2>Status do dispositivo</h2>
          <div class="estado-leitor"><i class="ponto" id="devPonto"></i> <span id="devEstado">Verificando…</span></div>
          <div class="ficha">
            <div><span>Modelo</span><span id="devModelo">—</span></div>
            <div><span>Fabricante</span><span id="devFab">—</span></div>
            <div><span>Agente</span><span id="devAgente">—</span></div>
            <div><span>Biblioteca</span><span id="devLib">—</span></div>
            <div><span>Identificador</span><span id="devUid">—</span></div>
          </div>
          <button class="b fantasma" style="width:100%;margin-top:14px" onclick="testarLeitor()">⌾ Testar leitor</button>
        </div>

        <div class="cartao">
          <h2>Últimas capturas</h2>
          <div class="capturas" id="listaCapturas"><div class="vazio">Nenhuma captura ainda</div></div>
        </div>
      </div>
    </div>
  </section>

  <!-- ================= IDENTIFICAÇÃO ================= -->
  <section class="tela oculto" id="tela-identificacao">
    <div class="cabecalho">
      <div class="icone">☺</div>
      <div>
        <h1>Identificação biométrica</h1>
        <p>Coloque qualquer dedo cadastrado no leitor. O sistema não pergunta qual dedo é.</p>
      </div>
    </div>
    <div class="grade">
      <div class="coluna">
        <div class="cartao">
          <div class="alvo" style="padding:34px 0">
            <div class="marca-dedo" style="font-size:74px">◉</div>
            <div class="estado" id="idEstado" style="font-size:15px;margin-top:14px">Pronto para capturar</div>
          </div>
          <button class="b principal" id="btIdent" onclick="identificar()">Capturar e identificar</button>
        </div>
        <div class="cartao" id="idResultado" style="display:none"></div>
      </div>
      <div class="coluna">
        <div class="cartao">
          <div class="aviso">
            <b>Motor de comparação ainda não definido</b>
            A captura desta tela é real. A comparação 1:N não é feita pela biblioteca
            do navegador — ela precisa de um motor de matching. Enquanto ele não for
            definido, esta tela captura e informa o resultado verdadeiro, sem inventar
            identificação. Veja o cartão de decisão em Diagnóstico.
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- ================= CONSULTA ================= -->
  <section class="tela oculto" id="tela-consulta">
    <div class="cabecalho">
      <div class="icone">☷</div>
      <div><h1>Consultar biometria</h1><p>Situação do cadastro biométrico de cada colaborador, vinda da tabela BIOMETRIA do Core.</p></div>
      <div class="acao"><button class="b fantasma" onclick="carregarConsulta()">⟳ Atualizar</button></div>
    </div>
    <div class="cartao"><div id="tabConsulta" class="vazio">Clique em atualizar para buscar no Core.</div></div>
  </section>

  <!-- ================= DISPOSITIVOS ================= -->
  <section class="tela oculto" id="tela-dispositivos">
    <div class="cabecalho">
      <div class="icone">▭</div>
      <div><h1>Dispositivos</h1><p>Leitores encontrados pelo agente DigitalPersona nesta máquina.</p></div>
      <div class="acao"><button class="b fantasma" onclick="verificarDispositivo()">⟳ Procurar leitores</button></div>
    </div>
    <div class="cartao"><div id="listaDisp" class="vazio">Procurando…</div></div>
  </section>

  <!-- ================= DIAGNÓSTICO ================= -->
  <section class="tela oculto" id="tela-diagnostico">
    <div class="cabecalho">
      <div class="icone">✚</div>
      <div><h1>Doutor da biometria</h1><p>Cada item abaixo é verificado de verdade. Nada é marcado como funcionando por suposição.</p></div>
      <div class="acao"><button class="b fantasma" onclick="rodarDiagnostico()">⟳ Executar</button></div>
    </div>
    <div class="grade">
      <div class="coluna">
        <div class="cartao"><div class="diag" id="listaDiag"><div class="vazio">Clique em executar.</div></div></div>
      </div>
      <div class="coluna">
        <div class="cartao">
          <h2>Base de dados</h2>
          <div id="baseDados" class="vazio">Clique em executar.</div>
        </div>
        <div class="cartao">
          <h2>Decisão pendente: motor de comparação</h2>
          <div class="aviso">
            <b>O que falta para a identificação funcionar</b>
            A biblioteca do navegador captura e entrega a amostra, mas não compara
            digitais. Para a fase de identificação existem três caminhos, e é preciso
            escolher um:<br><br>
            <b style="color:var(--texto)">1. Servidor HID DigitalPersona</b>
            Produto pago da HID que faz o matching 1:N. Nenhuma instalação extra
            nas estações além do agente.<br><br>
            <b style="color:var(--texto)">2. Componente local de matching</b>
            Um serviço na máquina do leitor usando o SDK que você já tem. Guarda os
            templates cifrados localmente, como pede o item 11.<br><br>
            <b style="color:var(--texto)">3. Só verificação 1:1</b>
            O operador escolhe a pessoa na tela e a biometria apenas confirma.
            Ainda assim precisa de um motor de comparação.
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- ================= HISTÓRICO ================= -->
  <section class="tela oculto" id="tela-historico">
    <div class="cabecalho">
      <div class="icone">▤</div>
      <div><h1>Logs e auditoria</h1><p>Eventos biométricos gravados no Core.</p></div>
      <div class="acao"><button class="b fantasma" onclick="carregarHistorico()">⟳ Atualizar</button></div>
    </div>
    <div class="cartao"><div id="tabHistorico" class="vazio">Clique em atualizar.</div></div>
  </section>

  <!-- ================= INÍCIO ================= -->
  <section class="tela oculto" id="tela-inicio">
    <div class="cabecalho">
      <div class="icone">⌂</div>
      <div><h1>Central de biometria</h1><p>Extensão do ALMOXA PRO para identificação de colaboradores.</p></div>
    </div>
    <div class="cartao">
      <h2>Como esta central se encaixa</h2>
      <p style="font-size:13px;color:var(--suave);line-height:1.8">
        A biometria responde quem é a pessoa. O Core do ALMOXA PRO responde o que ela
        pode fazer. Nenhuma operação é liberada só porque a digital foi reconhecida:
        o Core ainda verifica cadastro, permissão, disponibilidade e patrimônio antes
        de autorizar.
      </p>
    </div>
  </section>

  </main>
</div>

<footer class="rodape">
  <span>ALMOXA PRO · Central de Biometria</span>
  <span id="rpAgente">Agente: verificando</span>
  <div class="dir">
    <span id="rpLeitor">Leitor: verificando</span>
    <span id="rpCore">Core: verificando</span>
  </div>
</footer>

<script>
/* =====================================================================
   ALMOXA PRO — Central de Biometria
   Camada de captura: HID DigitalPersona (@digitalpersona/fingerprint)
   Camada de decisão: Google Apps Script / Core oficial do ALMOXA PRO
   ===================================================================== */

let CORE_URL = 'https://script.google.com/macros/s/AKfycbwWahYJywIsbRGc3t8taMWTXNgLd_1JtFJ93VmGNfAA-bXcgMlUoW6OZszZWEWMULA1/exec';
try{ const s = localStorage.getItem('almoxa_core_url'); if(s) CORE_URL = s; }catch(e){}

const DEDOS = [
  'Polegar direito','Indicador direito','Médio direito','Anelar direito','Mínimo direito',
  'Polegar esquerdo','Indicador esquerdo','Médio esquerdo','Anelar esquerdo','Mínimo esquerdo'
];
const AMOSTRAS_POR_DEDO = 3;

const est = {
  api:null, uid:null, agente:false, leitor:false, coreOk:false,
  colaborador:null,
  cadastrando:false, indiceDedo:0, amostras:0,
  situacao:new Array(10).fill('pendente'),   // pendente | ok | ruim
  modo:'parado',                              // parado | cadastro | identificacao
  capturas:[]
};

/* ---------------- navegação ---------------- */
document.querySelectorAll('nav button[data-tela]').forEach(b=>{
  b.onclick = ()=>{
    document.querySelectorAll('nav button').forEach(x=>x.classList.remove('ativo'));
    b.classList.add('ativo');
    document.querySelectorAll('.tela').forEach(s=>s.classList.add('oculto'));
    document.getElementById('tela-'+b.dataset.tela).classList.remove('oculto');
    if(b.dataset.tela==='diagnostico') rodarDiagnostico();
    if(b.dataset.tela==='dispositivos') verificarDispositivo();
  };
});

/* ---------------- ponte com o Core ---------------- */
function chamarCore(acao, dados){
  dados = dados || {};
  const servidaPeloScript = (typeof google!=='undefined' && google.script && google.script.run);

  if(servidaPeloScript){
    return new Promise((ok,err)=>{
      const alvo = google.script.run
        .withSuccessHandler(r=>{
          let j = r;
          try{ if(typeof r==='string') j = JSON.parse(r); }catch(e){
            return err(new Error('resposta do Core não é JSON: '+String(r).slice(0,120)));
          }
          if(!j) return err(new Error('o Core respondeu vazio'));
          j.ok ? ok(j.dados||{}) : err(new Error(j.erro||'recusado pelo Core'));
        })
        .withFailureHandler(e=>err(new Error((e && e.message) ? e.message : String(e))));

      if(typeof alvo.axbioApi === 'function')      alvo.axbioApi(acao, dados);
      else if(typeof alvo.bioApi === 'function')   alvo.bioApi(acao, dados);
      else err(new Error('o projeto não tem a função axbioApi. Cole o Core_Biometria_v4.gs e salve.'));
    });
  }

  // Aberta como arquivo solto: só funciona se o doPost do Core tratar bio_*
  return fetch(CORE_URL, {
    method:'POST', redirect:'follow',
    headers:{'Content-Type':'text/plain;charset=utf-8'},
    body: JSON.stringify({acao:acao, dados:dados})
  }).then(r=>r.text()).then(txt=>{
    let j;
    try{ j = JSON.parse(txt); }
    catch(e){ throw new Error('a página foi aberta fora do Apps Script e o Core devolveu HTML, não JSON. Abra pela função axbioAbrirCentral ou pela URL ?pagina=biometria.'); }
    if(!j.ok) throw new Error(j.erro||'recusado pelo Core');
    return j.dados||{};
  }).catch(e=>{
    throw new Error(e.message || 'sem resposta do Core');
  });
}

function mostrarErroCore(msg){
  let faixa = document.getElementById('faixaErro');
  if(!faixa){
    faixa = document.createElement('div');
    faixa.id='faixaErro';
    faixa.className='aviso';
    faixa.style.margin='0 0 16px 0';
    const alvo = document.querySelector('#tela-cadastro .cabecalho');
    alvo.parentNode.insertBefore(faixa, alvo.nextSibling);
  }
  faixa.innerHTML = '<b>O Core respondeu com erro</b>'+
    '<div style="font-family:monospace;font-size:12px;margin-top:6px;color:var(--texto)">'+
    msg+'</div>'+
    '<div style="margin-top:8px;color:var(--suave)">Como esta tela foi aberta: '+
    ((typeof google!=='undefined'&&google.script&&google.script.run)
      ? 'servida pelo Apps Script (correto)'
      : 'arquivo solto no navegador — abra pela função axbioAbrirCentral')+'</div>';
  faixa.style.display='block';
}

function limparErroCore(){
  const f=document.getElementById('faixaErro');
  if(f) f.style.display='none';
}

function marcarCore(ok, texto){
  est.coreOk = ok;
  const p=document.getElementById('tpPontoCore');
  p.className = 'ponto ' + (ok?'on':'off');
  document.getElementById('tpCore').textContent = texto;
  document.getElementById('rpCore').textContent = 'Core: ' + texto;
}

function testarCore(){
  return chamarCore('bio_ping')
    .then(d=>{
      marcarCore(true,'Core online'+(d.colaboradores!==undefined?(' · '+d.colaboradores+' colaboradores'):''));
      limparErroCore();
      return d;
    })
    .catch(e=>{
      marcarCore(false,'Core com erro');
      mostrarErroCore(e.message);
      throw e;
    });
}

/* ---------------- leitor ---------------- */
function marcarLeitor(estado, texto){
  est.leitor = (estado==='on');
  document.getElementById('devPonto').className = 'ponto '+estado;
  document.getElementById('devEstado').textContent = texto;
  document.getElementById('rpLeitor').textContent = 'Leitor: '+texto;
  atualizarBotaoIniciar();
}

function iniciarLeitor(){
  if(typeof Fingerprint==='undefined' || !Fingerprint.WebApi){
    est.agente=false;
    document.getElementById('devAgente').textContent='biblioteca não carregou';
    document.getElementById('rpAgente').textContent='Agente: biblioteca ausente';
    marcarLeitor('off','Biblioteca DigitalPersona ausente');
    return;
  }
  document.getElementById('devLib').textContent='@digitalpersona/fingerprint';

  est.api = new Fingerprint.WebApi();

  est.api.onDeviceConnected   = ()=>{ marcarLeitor('on','Leitor conectado'); };
  est.api.onDeviceDisconnected= ()=>{ marcarLeitor('off','Leitor desconectado'); pararCaptura(); };
  est.api.onCommunicationFailed = ()=>{
    est.agente=false;
    document.getElementById('devAgente').textContent='sem resposta';
    document.getElementById('rpAgente').textContent='Agente: sem resposta';
    marcarLeitor('off','Agente DigitalPersona não respondeu');
  };
  est.api.onQualityReported = e=>{
    const q = e.quality;
    const bom = (q===0);
    setBarra('bQual', bom?100:30);
    setEstadoCaptura(bom ? 'Qualidade aprovada' : 'Reposicione o dedo — captura não aprovada');
    if(!bom && est.modo==='cadastro'){
      est.situacao[est.indiceDedo]='ruim';
      desenharDedos(); atualizarNumeros();
    }
  };
  est.api.onSamplesAcquired = aoCapturar;

  verificarDispositivo();
}

function verificarDispositivo(){
  if(!est.api){ iniciarLeitor(); return; }
  marcarLeitor('espera','Procurando leitor…');
  est.api.enumerateDevices().then(lista=>{
    est.agente = true;
    document.getElementById('devAgente').textContent='conectado';
    document.getElementById('rpAgente').textContent='Agente: conectado';
    const alvo = document.getElementById('listaDisp');
    if(!lista || !lista.length){
      marcarLeitor('off','Nenhum leitor encontrado');
      document.getElementById('devModelo').textContent='—';
      document.getElementById('devUid').textContent='—';
      if(alvo) alvo.innerHTML='<div class="vazio">O agente respondeu, mas nenhum leitor está conectado. Verifique o cabo USB.</div>';
      return;
    }
    est.uid = lista[0];
    document.getElementById('devUid').textContent = est.uid;
    return est.api.getDeviceInfo(est.uid).then(info=>{
      marcarLeitor('on','Leitor conectado');
      const modelo = descreverModelo(info);
      document.getElementById('devModelo').textContent = modelo;
      document.getElementById('devFab').textContent = 'HID Global / DigitalPersona';
      if(alvo){
        alvo.innerHTML = lista.map(u=>
          '<div class="linha-dado" style="padding:8px 0;border-bottom:1px solid var(--linha)">'+
          '<span style="width:auto;flex:0 0 auto">◉</span><span>'+u+'</span></div>').join('');
      }
    });
  }).catch(err=>{
    est.agente=false;
    document.getElementById('devAgente').textContent='não encontrado';
    document.getElementById('rpAgente').textContent='Agente: não encontrado';
    marcarLeitor('off','Agente DigitalPersona não instalado');
    const alvo=document.getElementById('listaDisp');
    if(alvo) alvo.innerHTML='<div class="vazio">Não foi possível falar com o agente DigitalPersona nesta máquina.</div>';
  });
}

function descreverModelo(info){
  if(!info) return 'Leitor DigitalPersona';
  const t = (info.eUidType!==undefined? 'U.are.U ':'');
  if(info.eDeviceModality!==undefined || info.eUidType!==undefined) return 'DigitalPersona '+(t||'')+'(modalidade '+(info.eDeviceModality||'—')+')';
  return 'Leitor DigitalPersona';
}

function testarLeitor(){
  if(!est.api){ iniciarLeitor(); return; }
  marcarLeitor('espera','Testando…');
  est.api.enumerateDevices().then(l=>{
    if(l && l.length){ verificarDispositivo(); }
    else marcarLeitor('off','Nenhum leitor encontrado');
  }).catch(()=>marcarLeitor('off','Agente não respondeu'));
}

/* ---------------- captura ---------------- */
function iniciarCaptura(){
  if(!est.api || !est.leitor) return Promise.reject(new Error('leitor indisponível'));
  return est.api.startAcquisition(Fingerprint.SampleFormat.PngImage, est.uid);
}
function pararCaptura(){
  if(est.api){ try{ est.api.stopAcquisition(est.uid); }catch(e){} }
  est.modo='parado';
}

function aoCapturar(evento){
  let png = null;
  try{
    const s = JSON.parse(evento.samples);
    png = 'data:image/png;base64,' + String(s[0]).replace(/_/g,'/').replace(/-/g,'+');
  }catch(e){}

  if(png){
    document.getElementById('capMoldura').innerHTML = '<img src="'+png+'" alt="captura">';
  }

  if(est.modo==='identificacao'){ concluirIdentificacao(png); return; }
  if(est.modo!=='cadastro') return;

  est.amostras++;
  registrarCaptura(DEDOS[est.indiceDedo], est.amostras);
  setBarra('bAmostras', (est.amostras/AMOSTRAS_POR_DEDO)*100);
  setBarra('bDedo', (est.amostras/AMOSTRAS_POR_DEDO)*100);
  desenharPontinhos();

  if(est.amostras < AMOSTRAS_POR_DEDO){
    setEstadoCaptura('Amostra '+est.amostras+' de '+AMOSTRAS_POR_DEDO+' aceita. Retire o dedo e posicione de novo.');
    return;
  }

  est.situacao[est.indiceDedo]='ok';
  est.amostras=0;
  desenharDedos(); atualizarNumeros();

  est.indiceDedo++;
  if(est.indiceDedo>=10){ concluirCadastro(); return; }
  mostrarDedoAtual();
}

/* ---------------- cadastro guiado ---------------- */
function alternarCadastro(){
  if(est.cadastrando){ pararCadastro(); return; }
  if(!est.colaborador || !est.leitor) return;

  est.cadastrando=true; est.modo='cadastro'; est.amostras=0;
  est.indiceDedo = est.situacao.findIndex(s=>s!=='ok');
  if(est.indiceDedo<0) est.indiceDedo=0;

  document.getElementById('btIniciar').textContent='■ Parar cadastro';
  mostrarDedoAtual();
  iniciarCaptura().catch(e=>{
    setEstadoCaptura('Não foi possível iniciar a captura: '+e.message);
    pararCadastro();
  });
}

function pararCadastro(){
  est.cadastrando=false; pararCaptura();
  document.getElementById('btIniciar').textContent='▶ Iniciar cadastro';
  setEstadoCaptura('Cadastro interrompido');
  desenharDedos();
}

function mostrarDedoAtual(){
  const n = est.indiceDedo+1;
  document.getElementById('capContagem').textContent = n+'/10';
  document.getElementById('capDedo').textContent = DEDOS[est.indiceDedo];
  document.getElementById('capMao').textContent = n<=5 ? '🤚' : '✋';
  document.getElementById('capTitulo').textContent = 'Coloque o '+DEDOS[est.indiceDedo].toLowerCase();
  document.getElementById('capTexto').textContent = 'Mantenha o dedo parado no leitor até a captura terminar. São '+AMOSTRAS_POR_DEDO+' amostras.';
  setEstadoCaptura('Aguardando dedo');
  setBarra('bAmostras',0); setBarra('bDedo',0); setBarra('bQual',0);
  desenharDedos(); desenharPontinhos();
}

function concluirCadastro(){
  pararCadastro();
  const total = est.situacao.filter(s=>s==='ok').length;
  setEstadoCaptura('Cadastro concluído — '+total+'/10 dedos');
  document.getElementById('capTitulo').textContent='Cadastro biométrico concluído';
  document.getElementById('capTexto').textContent=total+' de 10 dedos capturados nesta estação.';

  chamarCore('bio_registrar_cadastro',{
    colaborador_id: est.colaborador.colaborador_id,
    matricula: est.colaborador.matricula,
    nome: est.colaborador.nome,
    dedos_cadastrados: total,
    dedos: est.situacao.map((s,i)=> s==='ok' ? (i+1) : null).filter(x=>x),
    status:'ATIVO',
    dispositivo: est.uid || 'desconhecido'
  }).then(()=>{
    setEstadoCaptura('Cadastro concluído e registrado no Core.');
  }).catch(e=>{
    setEstadoCaptura('Cadastro concluído, mas o Core não registrou: '+e.message);
  });
}

/* ---------------- identificação ---------------- */
function identificar(){
  if(!est.leitor){ document.getElementById('idEstado').textContent='Leitor indisponível.'; return; }
  est.modo='identificacao';
  document.getElementById('idEstado').textContent='Coloque qualquer dedo cadastrado no leitor…';
  document.getElementById('idResultado').style.display='none';
  iniciarCaptura().catch(e=>{
    document.getElementById('idEstado').textContent='Falha ao iniciar a captura: '+e.message;
    est.modo='parado';
  });
}

function concluirIdentificacao(png){
  pararCaptura();
  document.getElementById('idEstado').textContent='Captura realizada.';
  const alvo=document.getElementById('idResultado');
  alvo.style.display='block';
  alvo.innerHTML =
    '<h2>Resultado</h2>'+
    (png?'<div class="moldura" style="width:120px;height:150px;margin-bottom:14px"><img src="'+png+'"></div>':'')+
    '<div class="aviso"><b>Digital capturada, comparação não executada</b>'+
    'A captura funcionou de verdade. Não existe motor de comparação configurado, '+
    'então o sistema não afirma quem é a pessoa. Escolha um dos caminhos listados '+
    'em Diagnóstico para habilitar a identificação.</div>';
  est.modo='parado';
}

/* ---------------- colaborador ---------------- */
function buscarColaborador(){
  const termo=document.getElementById('cBusca').value.trim();
  if(!termo) return;
  const cx=document.getElementById('cResultados');
  cx.style.display='block';
  cx.innerHTML='<div>Buscando no Core…</div>';
  chamarCore('bio_buscar_colaborador',{termo:termo}).then(d=>{
    const itens=d.itens||[];
    if(!itens.length){ cx.innerHTML='<div>Nenhum colaborador encontrado.</div>'; return; }
    cx.innerHTML='';
    itens.forEach(it=>{
      const el=document.createElement('div');
      el.textContent = it.nome+'  ·  matrícula '+(it.matricula||'—');
      el.onclick = ()=>{ selecionarColaborador(it); cx.style.display='none'; };
      cx.appendChild(el);
    });
  }).catch(e=>{ cx.innerHTML='<div>Core indisponível: '+e.message+'</div>'; });
}

function selecionarColaborador(c){
  est.colaborador=c;
  document.getElementById('cNome').textContent=c.nome||'—';
  document.getElementById('cId').textContent=c.colaborador_id||'—';
  document.getElementById('cMat').textContent=c.matricula||'—';
  document.getElementById('cCargo').textContent=c.cargo||'—';
  document.getElementById('cObra').textContent=c.obra||'—';
  document.getElementById('cStatus').textContent=c.status||'—';
  const f=document.getElementById('cFoto');
  if(c.foto){ f.outerHTML='<img class="retrato" id="cFoto" src="'+c.foto+'" alt="">'; }

  chamarCore('bio_situacao',{colaborador_id:c.colaborador_id}).then(d=>{
    est.situacao=new Array(10).fill('pendente');
    (d.dedos||[]).forEach(n=>{ if(n>=1&&n<=10) est.situacao[n-1]='ok'; });
    desenharDedos(); atualizarNumeros(); atualizarBotaoIniciar();
  }).catch(()=>{ desenharDedos(); atualizarNumeros(); atualizarBotaoIniciar(); });
}

/* ---------------- desenho ---------------- */
function desenharDedos(){
  const cx=document.getElementById('painelDedos');
  cx.innerHTML='';
  DEDOS.forEach((nome,i)=>{
    const d=document.createElement('div');
    d.className='dedo'+(est.situacao[i]==='ok'?' ok':'')+(est.situacao[i]==='ruim'?' ruim':'')+
                (est.cadastrando&&i===est.indiceDedo?' agora':'');
    d.innerHTML='<b>'+(i+1)+'. '+nome.replace(' ','<br>')+'</b><div class="simbolo">◉</div>';
    d.title='Recadastrar '+nome;
    d.onclick=()=>recadastrarDedo(i);
    cx.appendChild(d);
  });
}

function recadastrarDedo(i){
  if(!est.colaborador || !est.leitor || est.cadastrando) return;
  est.indiceDedo=i; est.amostras=0; est.cadastrando=true; est.modo='cadastro';
  document.getElementById('btIniciar').textContent='■ Parar cadastro';
  mostrarDedoAtual();
  iniciarCaptura().catch(e=>{ setEstadoCaptura('Falha: '+e.message); pararCadastro(); });
}

function desenharPontinhos(){
  const cx=document.getElementById('capPontos'); cx.innerHTML='';
  for(let i=0;i<AMOSTRAS_POR_DEDO;i++){
    const p=document.createElement('i');
    if(i<est.amostras) p.className='feito';
    else if(i===est.amostras && est.cadastrando) p.className='agora';
    cx.appendChild(p);
  }
}

function atualizarNumeros(){
  const ok=est.situacao.filter(s=>s==='ok').length;
  const ruim=est.situacao.filter(s=>s==='ruim').length;
  document.getElementById('lgOk').textContent=ok;
  document.getElementById('lgPend').textContent=10-ok;
  document.getElementById('lgRuim').textContent=ruim;
  document.getElementById('arcoTxt').textContent=ok+'/10';
  const c=2*Math.PI*52;
  document.getElementById('arco').setAttribute('stroke-dashoffset', c-(c*ok/10));
}

function atualizarBotaoIniciar(){
  const b=document.getElementById('btIniciar');
  if(!b) return;
  b.disabled = !(est.colaborador && est.leitor);
  if(!est.colaborador) b.textContent='Selecione um colaborador';
  else if(!est.leitor) b.textContent='Leitor indisponível';
  else if(!est.cadastrando) b.textContent='▶ Iniciar cadastro';
}

function setBarra(id,pct){ const e=document.getElementById(id); if(e) e.style.width=Math.max(0,Math.min(100,pct))+'%'; }
function setEstadoCaptura(t){ const e=document.getElementById('capEstado'); if(e) e.textContent=t; }

function registrarCaptura(dedo,amostra){
  const agora=new Date();
  est.capturas.unshift({dedo:dedo,amostra:amostra,hora:agora.toTimeString().slice(0,5)});
  est.capturas=est.capturas.slice(0,12);
  const cx=document.getElementById('listaCapturas');
  cx.innerHTML = est.capturas.map(c=>
    '<div class="item"><div class="selo">◉</div><div class="txt"><b>'+c.dedo+'</b>'+
    '<span>amostra '+c.amostra+' de '+AMOSTRAS_POR_DEDO+'</span></div>'+
    '<div class="hora">'+c.hora+'</div></div>').join('');
}

/* ---------------- diagnóstico ---------------- */
function mostrarBaseDados(){
  const cx=document.getElementById('baseDados');
  cx.innerHTML='<div class="vazio">Lendo a planilha…</div>';
  chamarCore('bio_estrutura').then(d=>{
    let h = '<div class="ficha">'+
      '<div><span>Planilha</span><span>'+d.planilha+'</span></div>'+
      '<div><span>Aba usada</span><span style="color:var(--verde)">'+d.aba_colaboradores+'</span></div>'+
      '<div><span>Gravada</span><span>'+(d.aba_gravada||'—')+'</span></div>'+
      '<div><span>Encontrados</span><span>'+d.total_colaboradores+' colaboradores</span></div>'+
      '</div>';
    h += '<button class="b fantasma" style="margin-top:12px;width:100%" '+
         'onclick="redetectarAba()">Redetectar aba automaticamente</button>';
    h += '<h3 style="margin-top:16px">Abas da planilha</h3>';
    h += '<div style="font-size:12px">';
    (d.abas||[]).forEach(a=>{
      const usada = (a.nome===d.aba_colaboradores);
      h += '<div style="padding:9px 0;border-bottom:1px solid var(--linha)">'+
           '<div style="display:flex;gap:8px;align-items:center">'+
           '<b style="flex:1">'+a.nome+'</b>'+
           '<span style="color:var(--suave)">'+a.linhas+' linhas</span>'+
           (usada?'<span style="color:var(--verde)">em uso</span>'
                 :'<button class="b fantasma" style="padding:4px 9px;font-size:11px" '+
                  'onclick="usarAba(\''+a.nome.replace(/'/g,"")+'\')">usar esta</button>')+
           '</div>'+
           '<div style="color:var(--suave);margin-top:3px;word-break:break-word">'+
           (a.colunas||'(vazia)')+'</div></div>';
    });
    h += '</div>';
    cx.innerHTML=h;
  }).catch(e=>{ cx.innerHTML='<div class="vazio">'+e.message+'</div>'; });
}

function redetectarAba(){
  chamarCore('bio_redetectar').then(d=>{
    mostrarBaseDados(); testarCore();
  }).catch(e=>alert(e.message));
}

function usarAba(nome){
  chamarCore('bio_definir_aba',{aba:nome}).then(d=>{
    mostrarBaseDados(); testarCore();
  }).catch(e=>alert(e.message));
}

function rodarDiagnostico(){
  mostrarBaseDados();
  const cx=document.getElementById('listaDiag');
  cx.innerHTML='<div class="vazio">Verificando…</div>';
  const itens=[];

  const libOk = (typeof Fingerprint!=='undefined' && !!Fingerprint.WebApi);
  itens.push(item('Biblioteca DigitalPersona', libOk,
    libOk?'@digitalpersona/fingerprint carregada':'não carregou',
    libOk?'':'Navegador sem internet ou CDN bloqueado pela rede da empresa.',
    libOk?'':'Liberar unpkg.com ou hospedar o arquivo junto do sistema.'));

  const p = (est.api ? est.api.enumerateDevices() : Promise.reject(new Error('sem API')));
  p.then(lista=>{
    itens.push(item('Agente DigitalPersona', true, 'respondendo nesta máquina'));
    const temLeitor = !!(lista&&lista.length);
    itens.push(item('Leitor físico', temLeitor,
      temLeitor?(lista.length+' leitor(es): '+lista[0]):'nenhum leitor encontrado',
      temLeitor?'':'Leitor desconectado ou driver ausente.',
      temLeitor?'':'Conferir o cabo USB e a instalação do driver DigitalPersona.'));
    finalizar();
  }).catch(()=>{
    itens.push(item('Agente DigitalPersona', false, 'não respondeu',
      'HID Authentication Device Client não instalado ou serviço parado.',
      'Instalar o HID Authentication Device Client (antigo Lite Client) nesta máquina.'));
    itens.push(item('Leitor físico', false, 'não verificável sem o agente'));
    finalizar();
  });

  function finalizar(){
    testarCore().then(d=>{
      itens.push(item('Core / Apps Script', true, 'online'+(d.versao?(' · '+d.versao):'')));
      itens.push(item('Tabela BIOMETRIA', !!d.tabela_biometria,
        d.tabela_biometria?'encontrada':'não encontrada',
        d.tabela_biometria?'':'A aba BIOMETRIA ainda não existe na planilha.',
        d.tabela_biometria?'':'Rodar a função bioCriarTabelas no editor do Apps Script.'));
      fecha();
    }).catch(e=>{
      itens.push(item('Core / Apps Script', false, e.message,
        'Implantação sem as ações bio_*, ou acesso negado.',
        'Colar o Core_Biometria.gs no projeto e reimplantar o web app.'));
      itens.push(item('Tabela BIOMETRIA', false, 'não verificável sem o Core'));
      fecha();
    });
  }

  function fecha(){
    itens.push(item('Motor de comparação', false, 'não configurado',
      'A biblioteca do navegador captura mas não compara digitais.',
      'Escolher um dos três caminhos no cartão ao lado.'));
    itens.push(item('Cadastro guiado dos 10 dedos', libOk && est.leitor,
      (libOk&&est.leitor)?'pronto para uso':'depende do leitor'));
    cx.innerHTML = itens.join('');
  }

  function item(nome, ok, detalhe, causa, acao){
    return '<div class="item"><div class="mark" style="color:'+(ok?'var(--verde)':'var(--vermelho)')+'">'+
      (ok?'✓':'✕')+'</div><div class="corpo-d"><b>'+nome+'</b><p>'+(detalhe||'')+'</p>'+
      (causa?'<p>Causa: '+causa+'</p>':'')+
      (acao?'<div class="acao-corr">Ação: '+acao+'</div>':'')+'</div></div>';
  }
}

/* ---------------- consulta e histórico ---------------- */
function carregarConsulta(){
  const cx=document.getElementById('tabConsulta');
  cx.innerHTML='<div class="vazio">Buscando…</div>';
  chamarCore('bio_listar').then(d=>{
    const l=d.itens||[];
    if(!l.length){ cx.innerHTML='<div class="vazio">Nenhum cadastro biométrico ainda.</div>'; return; }
    cx.innerHTML='<table class="reg"><tr><th>Colaborador</th><th>Matrícula</th><th>Dedos</th><th>Status</th><th>Cadastro</th><th>Estação</th></tr>'+
      l.map(r=>'<tr><td>'+(r.nome||'')+'</td><td>'+(r.matricula||'')+'</td><td>'+(r.dedos_cadastrados||0)+'/10</td><td>'+(r.status||'')+'</td><td>'+(r.data_cadastro||'')+'</td><td>'+(r.dispositivo||'')+'</td></tr>').join('')+'</table>';
  }).catch(e=>{ cx.innerHTML='<div class="vazio">Core indisponível: '+e.message+'</div>'; });
}

function carregarHistorico(){
  const cx=document.getElementById('tabHistorico');
  cx.innerHTML='<div class="vazio">Buscando…</div>';
  chamarCore('bio_logs').then(d=>{
    const l=d.itens||[];
    if(!l.length){ cx.innerHTML='<div class="vazio">Nenhum evento registrado.</div>'; return; }
    cx.innerHTML='<table class="reg"><tr><th>Data</th><th>Evento</th><th>Colaborador</th><th>Detalhe</th><th>Estação</th></tr>'+
      l.map(r=>'<tr><td>'+(r.momento||'')+'</td><td>'+(r.tipo||'')+'</td><td>'+(r.colaborador_id||'')+'</td><td>'+(r.detalhe||'')+'</td><td>'+(r.dispositivo||'')+'</td></tr>').join('')+'</table>';
  }).catch(e=>{ cx.innerHTML='<div class="vazio">Core indisponível: '+e.message+'</div>'; });
}

/* ---------------- arranque ---------------- */
function salvarUrl(){
  const v = document.getElementById('campoUrl').value.trim();
  if(!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec/.test(v)){
    document.getElementById('statusUrl').textContent =
      'O endereço precisa começar com https://script.google.com/macros/s/ e terminar em /exec';
    return;
  }
  try{ localStorage.setItem('almoxa_core_url', v); }catch(e){}
  CORE_URL = v;
  document.getElementById('statusUrl').textContent = 'Salvo. Testando…';
  testarCore()
    .then(d=>{ document.getElementById('statusUrl').textContent =
      'Conectado. ' + (d.colaboradores||0) + ' colaboradores encontrados.'; })
    .catch(e=>{ document.getElementById('statusUrl').textContent = 'Falhou: ' + e.message; });
}

function prepararBarraUrl(){
  const local = (location.protocol === 'file:');
  const servida = (typeof google!=='undefined' && google.script && google.script.run);
  if(servida) return;                       // dentro do Apps Script não precisa
  const b = document.getElementById('barraUrl');
  b.style.display = 'block';
  document.getElementById('campoUrl').value = CORE_URL;
  if(local){
    document.getElementById('statusUrl').textContent =
      'Modo local: o leitor funciona normalmente. A conexão com o Core depende ' +
      'de o script ter o doPost instalado.';
  }
}

window.addEventListener('DOMContentLoaded', ()=>{
  prepararBarraUrl();
  document.getElementById('tpMaquina').textContent = 'Estação de biometria';
  desenharDedos(); atualizarNumeros(); desenharPontinhos();
  iniciarLeitor();
  testarCore().catch(()=>{});
});
</script>
</body>
</html>
`;
}
