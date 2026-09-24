/**
 * ============================================================
 * ALMOXA PRO — SERVIDOR DE FICHAS
 * Versão 1.0.0
 * ------------------------------------------------------------
 * ESTE É UM PROJETO SEPARADO DO SISTEMA
 *
 * Crie um projeto NOVO no Apps Script, cole só este arquivo e
 * publique. Ele terá um endereço próprio, que é o que vai no QR
 * Code das etiquetas.
 *
 * SE VOCÊ COLAR ISTO NO PROJETO DO SISTEMA, não quebra: o doGet
 * abaixo detecta o ALMOXA PRO e devolve a entrada para ele. Mas o
 * certo é um projeto separado — é o que dá um endereço curto para
 * o QR Code.
 *
 * Por que separado: o Apps Script só aceita um doGet por projeto.
 * Estando junto do sistema, a ficha disputa a entrada com o
 * ALMOXA PRO — e é por isso que o QR acabava abrindo o sistema.
 *
 * Aqui não existe sistema. Só existe ficha.
 *
 * ------------------------------------------------------------
 * COMO FUNCIONA
 *
 *   QR: .../exec?f=QR-A7K92X4
 *        ↓
 *   procura o código na planilha
 *        ↓
 *   pega o HTML da ficha guardado no Drive
 *        ↓
 *   entrega a página
 *
 * O HTML fica pronto no Drive. Este script só encontra e serve —
 * por isso abre rápido mesmo num celular com sinal ruim.
 * ============================================================
 */

var FICHA_CFG = {
  versao: '1.0.0',

  /**
   * O ID da planilha do ALMOXA PRO.
   *
   * É o trecho entre /d/ e /edit no endereço da planilha:
   * docs.google.com/spreadsheets/d/AQUI_O_ID/edit
   */
  planilhaId: 'COLE_AQUI_O_ID_DA_PLANILHA',

  aba: 'ALMOXA_PATRIMONIO',

  /* pasta onde o sistema guarda as fichas */
  pastaFichas: 'ALMOXA PRO — Fichas de Patrimônio',

  empresa: 'COESA',
  desde: 'Desde 1954',

  /* quanto tempo guardar a ficha em memória, em minutos */
  cacheMinutos: 30
};

/* ============================================================
   A ENTRADA
   ============================================================ */

/**
 * A ENTRADA.
 *
 * ATENÇÃO: o Apps Script só aceita UM doGet por projeto.
 *
 * Se este arquivo for colado no mesmo projeto do ALMOXA PRO, os
 * dois doGet brigam e o sistema para de abrir. Por isso, antes de
 * qualquer coisa, este arquivo verifica se o sistema está junto —
 * e, se estiver, devolve a entrada para ele.
 *
 * Assim, colar no lugar errado deixa de derrubar o sistema.
 */
function doGet(e) {
  var params = (e && e.parameter) ? e.parameter : {};

  var codigo = String(
    params.f || params.ficha || params.pat ||
    params.q || params.patrimonio || params.codigo || ''
  ).trim();

  /* ?p=3d é do módulo 3D, não da ficha */
  if (!codigo && params.p && params.p !== '3d') codigo = String(params.p).trim();

  /**
   * O ALMOXA PRO está neste mesmo projeto?
   *
   * Se estiver, ele é quem manda: só ficamos com os pedidos de
   * ficha. Sem código, a entrada é do sistema.
   */
  var sistemaJunto = (typeof AP_ENTRADA_servir === 'function');

  if (sistemaJunto && !codigo) {
    return AP_ENTRADA_servir(e);
  }

  if (!codigo) return FICHA_paginaInicial_();

  try {
    return FICHA_servir_(codigo);
  } catch (erro) {
    /* falhou a ficha, mas o sistema está aqui: melhor abrir ele */
    if (sistemaJunto) {
      try { return AP_ENTRADA_servir(e); } catch (e2) { }
    }
    return FICHA_paginaErro_('Não foi possível abrir a ficha', erro.message);
  }
}

/* ============================================================
   ENCONTRAR E SERVIR
   ============================================================ */

function FICHA_servir_(codigo) {
  var registro = FICHA_procurar_(codigo);

  /* a busca por nome achou vários: mostra a lista */
  if (registro && registro.__varios) {
    return FICHA_paginaEscolha_(registro.__varios, registro.__busca);
  }

  if (!registro) {
    return FICHA_paginaErro_('Não encontrei',
      'Nada corresponde a <b>' + FICHA_esc_(codigo) + '</b>.<br><br>' +
      'Você pode procurar pelo código da etiqueta (QR-A7K92X4), pelo número ' +
      'do patrimônio (PAT-000001 ou só 1) ou pelo nome do equipamento.');
  }

  /* 1. o HTML já pronto no Drive — o caminho normal */
  if (registro.fichaHtmlId) {
    var html = FICHA_lerDoDrive_(registro.fichaHtmlId);
    if (html) {
      return HtmlService.createHtmlOutput(html)
        .setTitle(registro.patrimonio + ' · ' + FICHA_CFG.empresa)
        .addMetaTag('viewport', 'width=device-width, initial-scale=1')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }
  }

  /* 2. só existe o PDF: manda para ele */
  if (registro.fichaArquivoId) {
    return FICHA_redirecionar_(registro,
      'https://drive.google.com/file/d/' + registro.fichaArquivoId + '/view');
  }

  /**
   * 3. NENHUMA FICHA GERADA
   *
   * Se o ALMOXA PRO está no mesmo projeto, ele sabe montar a ficha
   * completa — com fotos, notas, pedidos e histórico. Então geramos
   * agora, servimos, e da próxima vez já estará pronta no Drive.
   *
   * A ficha resumida abaixo só entra quando nem isso é possível:
   * projeto separado, sem acesso ao módulo. É o último recurso,
   * não o caminho normal.
   */
  if (typeof AP_PAT_gerarFicha === 'function') {
    try {
      var gerada = AP_PAT_gerarFicha(registro.patrimonio, null);

      if (gerada && gerada.ok && gerada.dados.htmlId) {
        var completa = FICHA_lerDoDrive_(gerada.dados.htmlId);
        if (completa) {
          return HtmlService.createHtmlOutput(completa)
            .setTitle(registro.patrimonio + ' · ' + FICHA_CFG.empresa)
            .addMetaTag('viewport', 'width=device-width, initial-scale=1')
            .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
        }
      }
    } catch (e) { /* segue para a versão montada aqui */ }
  }

  /**
   * 4. Sem o módulo por perto: monta a ficha aqui mesmo.
   *
   * Mostra tudo o que a planilha guarda sobre o equipamento —
   * não é "resumida" por escolha, é o que dá para saber lendo só
   * a tabela principal.
   */
  return HtmlService.createHtmlOutput(FICHA_montarDaPlanilha_(registro))
    .setTitle(registro.patrimonio + ' · ' + FICHA_CFG.empresa)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Procura o equipamento na planilha do sistema.
 *
 * Aceita o código da ficha, o token e o próprio número de
 * patrimônio — quem digita olhando a etiqueta não sabe a diferença.
 */
function FICHA_procurar_(codigo) {
  var busca = String(codigo).toUpperCase().trim();

  var linhas = FICHA_lerPlanilha_();
  if (!linhas.length) return null;

  var achado = null;

  for (var i = 0; i < linhas.length; i++) {
    var r = linhas[i];
    if (String(r.codigoFicha || '').toUpperCase() === busca ||
        String(r.token || '').toUpperCase() === busca ||
        String(r.patrimonio || '').toUpperCase() === busca) {
      achado = r;
      break;
    }
  }

  /* digitou sem o prefixo QR- */
  if (!achado && busca.indexOf('QR-') !== 0) {
    for (var j = 0; j < linhas.length; j++) {
      if (String(linhas[j].codigoFicha || '').toUpperCase() === 'QR-' + busca) {
        achado = linhas[j];
        break;
      }
    }
  }

  /* digitou só o número: 1, 01, 000001 */
  if (!achado && /^\d+$/.test(busca)) {
    var numero = parseInt(busca, 10);
    for (var k = 0; k < linhas.length; k++) {
      var n = parseInt(String(linhas[k].patrimonio || '').replace(/\D/g, ''), 10);
      if (n === numero) { achado = linhas[k]; break; }
    }
  }

  /**
   * Digitou o nome do equipamento.
   *
   * Quem está no campo com a etiqueta apagada na mão digita
   * "furadeira", não um código. Se a descrição levar a um
   * equipamento só, abre direto.
   */
  if (!achado && busca.length >= 3) {
    var parecidos = linhas.filter(function (l) {
      return String(l.descricao || '').toUpperCase().indexOf(busca) > -1 ||
        String(l.marca || '').toUpperCase().indexOf(busca) > -1 ||
        String(l.numeroSerie || '').toUpperCase() === busca;
    });

    if (parecidos.length === 1) achado = parecidos[0];
    else if (parecidos.length > 1) {
      /* vários: quem chamou decide o que fazer */
      return { __varios: parecidos.slice(0, 12), __busca: busca };
    }
  }

  return achado;
}

/**
 * Lê a planilha do sistema.
 *
 * Guarda o resultado por alguns minutos: sem isso, cada leitura de
 * QR abriria a planilha inteira de novo — e numa obra com várias
 * pessoas escaneando, isso derruba o tempo de resposta.
 */
function FICHA_lerPlanilha_() {
  var cache = CacheService.getScriptCache();
  var guardado = null;

  try {
    guardado = cache.get('patrimonios');
    if (guardado) return JSON.parse(guardado);
  } catch (e) { /* cache cheio ou indisponível: lê direto */ }

  /**
   * QUAL PLANILHA LER
   *
   * Se o ALMOXA PRO está no mesmo projeto, ele já sabe qual é a
   * planilha — e pedir que alguém digite o ID de novo é pedir um
   * erro. Só quando este arquivo roda sozinho é que o ID
   * configurado faz falta.
   */
  var planilha = null, aba = null;

  /**
   * 1. o sistema está junto: usa a planilha dele
   *
   * A aba só serve se souber devolver os dados. Sem esta conferência,
   * um objeto qualquer devolvido aqui interrompe a busca — e os
   * caminhos seguintes nunca são tentados.
   */
  try {
    if (typeof AP_Data_getSheet === 'function') {
      var doSistema = AP_Data_getSheet(FICHA_CFG.aba);
      if (doSistema && typeof doSistema.getDataRange === 'function') {
        aba = doSistema;
        planilha = true;
      }
    }
  } catch (e) { aba = null; }

  /* 2. a configuração do próprio Core */
  if (!aba) {
    try {
      if (typeof AP_Config_get === 'function') {
        var idDoCore = AP_Config_get('PLANILHA_ID', '') ||
          AP_Config_get('SPREADSHEET_ID', '');
        if (idDoCore) {
          planilha = SpreadsheetApp.openById(idDoCore);
          aba = planilha.getSheetByName(FICHA_CFG.aba);
        }
      }
    } catch (e) { aba = null; }
  }

  /* 3. a planilha em que o script está vinculado */
  if (!aba) {
    try {
      var ativa = SpreadsheetApp.getActiveSpreadsheet();
      if (ativa) {
        planilha = ativa;
        aba = ativa.getSheetByName(FICHA_CFG.aba);
      }
    } catch (e) { aba = null; }
  }

  /* 4. o ID configurado neste arquivo */
  if (!aba) {
    if (!FICHA_CFG.planilhaId || FICHA_CFG.planilhaId.indexOf('COLE_AQUI') === 0) {
      return [];
    }
    try {
      planilha = SpreadsheetApp.openById(FICHA_CFG.planilhaId);
      aba = planilha.getSheetByName(FICHA_CFG.aba);
    } catch (e) {
      return [];
    }
  }

  if (!aba || !aba.getDataRange) return [];

  var valores = aba.getDataRange().getValues();
  if (valores.length < 2) return [];

  var cabecalho = valores[0];
  var linhas = [];

  for (var i = 1; i < valores.length; i++) {
    var obj = {};
    for (var c = 0; c < cabecalho.length; c++) {
      obj[String(cabecalho[c])] = valores[i][c];
    }
    if (obj.patrimonio) linhas.push(obj);
  }

  try {
    /* o cache tem limite de tamanho; se não couber, segue sem ele */
    cache.put('patrimonios', JSON.stringify(linhas), FICHA_CFG.cacheMinutos * 60);
  } catch (e) { }

  return linhas;
}

/** Limpa a memória — chame depois de cadastrar equipamentos novos */
function FICHA_limparCache() {
  try {
    CacheService.getScriptCache().remove('patrimonios');
    return 'Memória limpa. A próxima leitura busca os dados atualizados.';
  } catch (e) {
    return 'Não foi possível limpar: ' + e.message;
  }
}

function FICHA_lerDoDrive_(arquivoId) {
  try {
    return DriveApp.getFileById(arquivoId).getBlob().getDataAsString();
  } catch (e) {
    return null;
  }
}

/* ============================================================
   AS PÁGINAS
   ============================================================ */

function FICHA_estilo_() {
  return '<style>' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;' +
    'background:#F4F7FB;color:#1A2634;line-height:1.5;padding-bottom:40px}' +

    /* faixa da empresa, igual à do sistema */
    '.topo{background:#0B2A55;color:#fff;padding:12px 16px;' +
    'display:flex;align-items:center;justify-content:space-between;gap:12px}' +
    '.marca{display:flex;align-items:center;gap:8px}' +
    '.marca .c{width:30px;height:30px;border-radius:50%;background:#fff;color:#0B5FFF;' +
    'font-family:Georgia,serif;font-size:19px;font-weight:900;display:grid;' +
    'place-items:center;line-height:1;flex-shrink:0}' +
    '.marca .n{font-size:15px;font-weight:800;letter-spacing:.08em;line-height:1.1}' +
    '.marca .n small{display:block;font-size:8.5px;font-weight:400;opacity:.65}' +
    '.bt{background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.2);' +
    'color:#fff;border-radius:8px;padding:7px 12px;font-size:12px;font-family:inherit;' +
    'cursor:pointer;font-weight:600;text-decoration:none;display:inline-block;' +
    'white-space:nowrap}' +
    '.bt.principal{background:#FF7A00;border-color:#FF7A00}' +

    '.titulo-ficha{background:#123A6E;color:#fff;border-radius:12px;padding:14px 16px;' +
    'margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:12px}' +
    '.tf-txt h2{font-size:15px;font-weight:800;line-height:1.2}' +
    '.tf-txt small{font-size:10.5px;opacity:.7}' +
    '.tf-pat{text-align:right;flex-shrink:0}' +
    '.tf-pat small{display:block;font-size:9px;opacity:.7;letter-spacing:.08em}' +
    '.tf-pat b{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:17px}' +
    '.valor-grande{font-size:22px;font-weight:800;color:#0B2A55;margin:6px 0 10px}' +

    '.env{max-width:640px;margin:0 auto;padding:14px}' +
    '.cartao{background:#fff;border:1px solid #E3E9F0;border-radius:14px;' +
    'padding:16px;margin-bottom:12px}' +

    '.cabeca{display:flex;gap:14px;align-items:flex-start}' +
    '.foto{width:100px;height:100px;border-radius:12px;background:#F7F9FC;' +
    'display:flex;align-items:center;justify-content:center;font-size:36px;' +
    'flex-shrink:0;overflow:hidden;border:1px solid #E3E9F0;padding:6px}' +
    '.foto img{max-width:100%;max-height:100%;width:auto;height:auto;display:block}' +
    'h1{font-size:19px;color:#0B2A55;line-height:1.25;word-break:break-word}' +
    '.pat{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:14px;' +
    'color:#FF7A00;font-weight:800;margin:3px 0 7px}' +
    '.cod{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10.5px;' +
    'color:#9AA5B1;margin-top:6px}' +

    '.selo{display:inline-block;padding:4px 12px;border-radius:14px;' +
    'font-size:11.5px;font-weight:700;color:#fff}' +

    '.linha{display:flex;justify-content:space-between;padding:9px 0;' +
    'border-bottom:1px solid #F0F4F8;font-size:14px;gap:14px}' +
    '.linha:last-child{border:0}' +
    '.linha span{color:#6B7684;flex-shrink:0}' +
    '.linha b{text-align:right;word-break:break-word}' +

    'h3{font-size:11.5px;text-transform:uppercase;letter-spacing:.8px;' +
    'color:#8A96A3;margin-bottom:9px;font-weight:700}' +
    'h3:not(:first-child){margin-top:18px}' +

    '.aviso{border-radius:10px;padding:13px 15px;font-size:13.5px;margin-bottom:12px}' +
    '.a-amarelo{background:#FEF6E7;color:#8A5A00;border-left:4px solid #FF9F1C}' +
    '.a-vermelho{background:#FDEDEC;color:#8B2A22;border-left:4px solid #C0392B}' +
    '.a-azul{background:#EAF2FF;color:#0B3D91;border-left:4px solid #0B5FFF}' +

    '.rodape{text-align:center;font-size:11px;color:#9AA5B1;margin-top:16px;padding:0 16px}' +
    '@media print{.topo .bt{display:none}.cartao{border:1px solid #ccc}@page{margin:12mm}}' +
    '</style>';
}

function FICHA_topo_(comBotoes) {
  return '<div class="topo">' +
    '<div class="marca"><span class="c">C</span>' +
    '<span class="n">' + FICHA_esc_(FICHA_CFG.empresa) +
    '<small>' + FICHA_esc_(FICHA_CFG.desde) + '</small></span></div>' +
    (comBotoes
      ? '<div><button class="bt" onclick="window.print()">Imprimir</button> ' +
        '<button class="bt principal" onclick="window.print()">PDF</button></div>'
      : '') +
    '</div>';
}

/** Monta a ficha direto da planilha, quando não há arquivo no Drive */
function FICHA_montarDaPlanilha_(r) {
  var rotSituacao = {
    ATIVO: 'ATIVO', EM_MANUTENCAO: 'EM MANUTENÇÃO', BAIXADO: 'BAIXADO',
    EMPRESTADO: 'EMPRESTADO', EXTRAVIADO: 'EXTRAVIADO'
  };
  var cores = {
    ATIVO: '#1E9E5A', EM_MANUTENCAO: '#FF9F1C', BAIXADO: '#8E969F',
    EMPRESTADO: '#0B5FFF', EXTRAVIADO: '#C0392B'
  };

  function linha(rotulo, valor) {
    if (valor === undefined || valor === null || valor === '') return '';
    return '<div class="linha"><span>' + rotulo + '</span><b>' +
      FICHA_esc_(valor) + '</b></div>';
  }

  function data(x) {
    if (!x) return '';
    try {
      var d = new Date(x);
      if (isNaN(d.getTime())) return String(x).slice(0, 10);
      return ('0' + d.getDate()).slice(-2) + '/' +
        ('0' + (d.getMonth() + 1)).slice(-2) + '/' + d.getFullYear();
    } catch (e) { return String(x); }
  }

  var vencida = false;
  if (r.proximaManutencao) {
    try { vencida = new Date(r.proximaManutencao) < new Date(); } catch (e) { }
  }

  return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + FICHA_esc_(r.patrimonio) + '</title>' + FICHA_estilo_() +
    '</head><body>' + FICHA_topo_(true) +
    '<div class="env">' +

    '<div class="titulo-ficha">' +
    '<div class="tf-txt"><h2>FICHA TÉCNICA DO PATRIMÔNIO</h2>' +
    '<small>Identificação e rastreabilidade</small></div>' +
    '<div class="tf-pat"><small>Nº PATRIMÔNIO</small>' +
    '<b>' + FICHA_esc_(r.patrimonio) + '</b></div>' +
    '</div>' +

    (vencida
      ? '<div class="aviso a-amarelo"><b>Manutenção vencida</b><br>' +
        'Estava prevista para ' + data(r.proximaManutencao) + '.</div>' : '') +

    (r.situacao === 'BAIXADO'
      ? '<div class="aviso a-vermelho"><b>Equipamento baixado</b><br>' +
        'Não deve estar em uso.</div>' : '') +

    '<div class="cartao"><div class="cabeca">' +
    '<div class="foto">' +
    (r.foto ? '<img src="' + FICHA_esc_(r.foto) + '" alt="">' : '🔧') + '</div>' +
    '<div style="flex:1;min-width:0">' +
    '<h1>' + FICHA_esc_(r.descricao) + '</h1>' +
    '<div class="pat">' + FICHA_esc_(r.patrimonio) + '</div>' +
    '<span class="selo" style="background:' + (cores[r.situacao] || '#8E969F') + '">' +
    (rotSituacao[r.situacao] || r.situacao || 'ATIVO') + '</span>' +
    (r.codigoFicha ? '<div class="cod">' + FICHA_esc_(r.codigoFicha) + '</div>' : '') +
    '</div></div>' +
    linha('Marca', r.marca) + linha('Modelo', r.modelo) +
    linha('Nº de série', r.numeroSerie) + linha('Categoria', r.categoria) +
    '</div>' +

    '<div class="cartao">' +
    '<h3>Onde está</h3>' +
    linha('Localização', r.localizacao) + linha('Obra', r.obra) +
    linha('Responsável', r.responsavel) +

    '<h3>Situação</h3>' +
    linha('Estado', r.estado) +
    linha('Aquisição', data(r.dataAquisicao)) +
    linha('Garantia até', data(r.garantiaAte)) +
    (r.vidaUtilMeses ? linha('Vida útil', r.vidaUtilMeses + ' meses') : '') +
    linha('Última manutenção', data(r.ultimaManutencao)) +
    linha('Próxima manutenção', data(r.proximaManutencao)) +

    (r.notaFiscal || r.pedido || r.valorAquisicao
      ? '<h3>Aquisição</h3>' +
        (r.valorAquisicao
          ? '<div class="valor-grande">R$ ' +
            (Number(r.valorAquisicao)||0).toFixed(2).replace('.', ',')
              .replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '</div>' : '') +
        linha('Nota fiscal', r.notaFiscal) +
        linha('Pedido', r.pedido) +
        linha('Fornecedor', r.fornecedor)
      : '') +

    (r.observacao
      ? '<h3>Observação</h3><p style="font-size:13.5px;color:#4A5866">' +
        FICHA_esc_(r.observacao) + '</p>' : '') +
    '</div>' +

    /* as fotos e demais tabelas exigem o módulo; aqui só o que
       a tabela principal guarda */
    '' +

    '<div class="rodape">' + FICHA_esc_(FICHA_CFG.empresa) + ' · ALMOXA PRO<br>' +
    'Consultada em ' + FICHA_agora_() + '</div>' +
    '</div></body></html>';
}

/** Manda para o PDF no Drive */
function FICHA_redirecionar_(r, url) {
  return HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + FICHA_esc_(r.patrimonio) + '</title>' + FICHA_estilo_() +
    '<script>setTimeout(function(){window.location.replace(' +
    JSON.stringify(url) + ');},400);</script>' +
    '</head><body>' + FICHA_topo_(false) +
    '<div class="env"><div class="cartao" style="text-align:center;padding:30px 20px">' +
    '<h1 style="font-size:17px">' + FICHA_esc_(r.descricao) + '</h1>' +
    '<div class="pat" style="font-size:17px">' + FICHA_esc_(r.patrimonio) + '</div>' +
    '<p style="font-size:13px;color:#6B7684;margin:14px 0">Abrindo a ficha…</p>' +
    '<a class="bt principal" style="padding:12px 20px" href="' + FICHA_esc_(url) + '">' +
    'Abrir a ficha</a>' +
    '</div></div></body></html>')
    .setTitle(r.patrimonio + ' · ' + FICHA_CFG.empresa)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function FICHA_paginaErro_(titulo, detalhe) {
  return HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Ficha não encontrada</title>' + FICHA_estilo_() +
    '</head><body>' + FICHA_topo_(false) +
    '<div class="env"><div class="cartao">' +
    '<div class="aviso a-vermelho"><b>' + FICHA_esc_(titulo) + '</b><br>' +
    detalhe + '</div></div></div></body></html>')
    .setTitle('Ficha não encontrada')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function FICHA_paginaInicial_() {
  /* o que importa não é o ID estar preenchido, e sim conseguir
     ler os patrimônios — de onde quer que eles venham */
  var configurado = false;
  try { configurado = FICHA_lerPlanilha_().length > 0; } catch (e) { }

  return HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Fichas de Patrimônio · ' + FICHA_esc_(FICHA_CFG.empresa) + '</title>' +
    FICHA_estilo_() +
    '</head><body>' + FICHA_topo_(false) +
    '<div class="env"><div class="cartao">' +

    (configurado
      ? '<h3>Consultar patrimônio</h3>' +
        '<p style="font-size:13.5px;color:#4A5866;margin-bottom:14px">' +
        'Leia o QR Code da etiqueta, ou procure pelo código da etiqueta, ' +
        'pelo número do patrimônio ou pelo <b>nome do equipamento</b>.</p>' +
        '<input id="cod" placeholder="furadeira · PAT-000001 · QR-A7K92X4" ' +
        'style="width:100%;padding:12px;border:1px solid #D8E0E9;border-radius:9px;' +
        'font-size:16px">' +
        '<button class="bt principal" style="width:100%;margin-top:10px;padding:12px" ' +
        'onclick="ir()">Abrir a ficha</button>' +
        '<script>' +
        'function ir(){var v=document.getElementById("cod").value.trim();' +
        'if(v) window.location.search="?f="+encodeURIComponent(v);}' +
        'document.getElementById("cod").addEventListener("keydown",function(e){' +
        'if(e.key==="Enter") ir();});' +
        '</script>'

      : '<div class="aviso a-amarelo"><b>Falta configurar a planilha</b><br>' +
        'Abra este script no editor e coloque o ID da planilha do ALMOXA PRO ' +
        'em <b>FICHA_CFG.planilhaId</b>.<br><br>' +
        'O ID é o trecho entre <b>/d/</b> e <b>/edit</b> no endereço da planilha.' +
        '</div>') +

    '</div></div></body></html>')
    .setTitle('Fichas de Patrimônio · ' + FICHA_CFG.empresa)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* ============================================================
   APOIO
   ============================================================ */

function FICHA_esc_(t) {
  return String(t === null || t === undefined ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function FICHA_agora_() {
  try {
    return Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm');
  } catch (e) {
    return new Date().toLocaleString('pt-BR');
  }
}

/* ============================================================
   PARA RODAR NO EDITOR
   ============================================================ */

/**
 * Confere se está tudo no lugar.
 * Rode isto depois de configurar, antes de publicar.
 */
function FICHA_testar() {
  var linhas = [];
  linhas.push('');
  linhas.push('  SERVIDOR DE FICHAS — verificação');
  linhas.push('  ' + new Array(56).join('-'));
  linhas.push('');

  /* 1. de onde vêm os dados */
  var juntoDoSistema = (typeof AP_Data_getSheet === 'function');

  linhas.push('  Sistema no mesmo projeto: ' + (juntoDoSistema ? 'sim' : 'não'));

  if (juntoDoSistema) {
    linhas.push('  🟢 Usando a planilha do ALMOXA PRO (não precisa configurar ID).');
  } else if (FICHA_CFG.planilhaId && FICHA_CFG.planilhaId.indexOf('COLE_AQUI') !== 0) {
    try {
      var planilha = SpreadsheetApp.openById(FICHA_CFG.planilhaId);
      linhas.push('  🟢 Planilha encontrada: ' + planilha.getName());
    } catch (e) {
      linhas.push('  🔴 Não consegui abrir a planilha: ' + e.message);
      linhas.push('     Confira o ID e se esta conta tem acesso a ela.');
      var texto2 = linhas.join('\n');
      try { Logger.log(texto2); } catch (e2) { }
      return texto2;
    }
  } else {
    linhas.push('  🔴 Sem planilha: configure FICHA_CFG.planilhaId,');
    linhas.push('     ou cole este arquivo no projeto do ALMOXA PRO.');
    var texto1 = linhas.join('\n');
    try { Logger.log(texto1); } catch (e) { }
    return texto1;
  }

  /* 2. a aba */
  var registros = FICHA_lerPlanilha_();
  if (!registros.length) {
    linhas.push('  🟠 A aba ' + FICHA_CFG.aba + ' está vazia ou não existe.');
    linhas.push('     Cadastre um patrimônio no sistema primeiro.');
  } else {
    linhas.push('  🟢 ' + registros.length + ' patrimônio(s) encontrado(s).');

    var comCodigo = registros.filter(function (r) { return r.codigoFicha; }).length;
    var comFicha = registros.filter(function (r) { return r.fichaArquivoId; }).length;

    linhas.push('  ' + (comCodigo ? '🟢' : '🟠') + ' ' + comCodigo + ' com código de ficha.');
    linhas.push('  ' + (comFicha ? '🟢' : '🟠') + ' ' + comFicha + ' com ficha em PDF gerada.');

    /* 3. um teste de verdade */
    var exemplo = registros.filter(function (r) { return r.codigoFicha; })[0];
    if (exemplo) {
      linhas.push('');
      linhas.push('  TESTE COM UM CÓDIGO REAL');
      linhas.push('  Código:     ' + exemplo.codigoFicha);
      linhas.push('  Patrimônio: ' + exemplo.patrimonio);
      linhas.push('  Descrição:  ' + exemplo.descricao);

      var achado = FICHA_procurar_(exemplo.codigoFicha);
      linhas.push('  Busca:      ' + (achado ? '🟢 encontrou' : '🔴 NÃO encontrou'));
    }
  }

  /* 4. o endereço para o QR */
  var url = '';
  try { url = ScriptApp.getService().getUrl(); } catch (e) { }

  linhas.push('');
  if (url) {
    linhas.push('  ENDEREÇO DESTE SERVIDOR');
    linhas.push('  ' + url);
    linhas.push('');
    linhas.push('  Configure este endereço no ALMOXA PRO, na aba CONFIG:');
    linhas.push('  chave: PATRIMONIO_URL_FICHA');
    linhas.push('  valor: ' + url);
  } else {
    linhas.push('  🟠 Publique o projeto (Implantar → Nova implantação)');
    linhas.push('     e rode de novo para ver o endereço.');
  }

  linhas.push('');
  var texto = linhas.join('\n');
  try { Logger.log(texto); } catch (e) { }
  return texto;
}


/** Vários equipamentos com o mesmo nome: a pessoa escolhe */
function FICHA_paginaEscolha_(lista, busca) {
  var cores = {
    ATIVO: '#1E9E5A', EM_MANUTENCAO: '#FF9F1C', BAIXADO: '#8E969F',
    EMPRESTADO: '#0B5FFF', EXTRAVIADO: '#C0392B'
  };

  return HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Escolha o equipamento</title>' + FICHA_estilo_() +
    '<style>.escolha{display:flex;align-items:center;gap:12px;padding:13px 0;' +
    'border-bottom:1px solid #F0F4F8;text-decoration:none;color:inherit}' +
    '.escolha:last-child{border:0}' +
    '.escolha .mini{width:44px;height:44px;border-radius:9px;background:#F7F9FC;' +
    'border:1px solid #E3E9F0;display:flex;align-items:center;justify-content:center;' +
    'overflow:hidden;flex-shrink:0;font-size:20px;padding:3px}' +
    '.escolha .mini img{max-width:100%;max-height:100%}' +
    '.escolha .d{flex:1;min-width:0}' +
    '.escolha .d b{display:block;font-size:14px;color:#0B2A55}' +
    '.escolha .d small{color:#8A96A3;font-size:11.5px;font-family:monospace}' +
    '.pt{width:9px;height:9px;border-radius:50%;flex-shrink:0}' +
    '</style></head><body>' + FICHA_topo_(false) +
    '<div class="env"><div class="cartao">' +
    '<h3>' + lista.length + ' equipamentos com "' + FICHA_esc_(busca) + '"</h3>' +
    '<p style="font-size:13px;color:#6B7684;margin-bottom:6px">Escolha qual você quer ver.</p>' +
    lista.map(function (r) {
      return '<a class="escolha" href="?f=' +
        encodeURIComponent(r.codigoFicha || r.patrimonio) + '">' +
        '<div class="mini">' +
        (r.foto ? '<img src="' + FICHA_esc_(r.foto) + '">' : '🔧') + '</div>' +
        '<div class="d"><b>' + FICHA_esc_(r.descricao) + '</b>' +
        '<small>' + FICHA_esc_(r.patrimonio) +
        (r.localizacao ? ' · ' + FICHA_esc_(r.localizacao) : '') + '</small></div>' +
        '<span class="pt" style="background:' + (cores[r.situacao] || '#8E969F') + '"></span>' +
        '</a>';
    }).join('') +
    '</div></div></body></html>')
    .setTitle('Escolha o equipamento')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
