/**
 * ============================================================
 * ALMOXA PRO — ROTEADOR ÚNICO (parte 00)
 * ============================================================
 *
 * POR QUE ESTE ARQUIVO EXISTE
 *
 * No Apps Script todos os arquivos dividem UM escopo global.
 * Duas funções com o mesmo nome não convivem: a última carregada
 * apaga a anterior, e a ordem depende da posição dos arquivos no
 * projeto. Com `doGet` e `doPost` isso é fatal, porque são as
 * únicas portas pelas quais o Google entrega um pedido.
 *
 * Antes desta correção o projeto tinha:
 *
 *   doGet  declarado em 2 arquivos
 *   doPost declarado em 3 arquivos
 *
 * O Google chamava um de cada e descartava o resto em silêncio.
 * Quando vencia o doPost do módulo de biometria, ele respondia
 * "ação desconhecida" para TODO pedido que não começasse com
 * bio_ — ou seja, a API ÚNICA inteira ficava muda, e o sistema
 * parecia estar preso ao core antigo.
 *
 * ------------------------------------------------------------
 * COMO FICOU
 *
 * Este é o ÚNICO arquivo do projeto que declara doGet e doPost.
 * Os módulos continuam donos da sua própria lógica: cada um
 * expõe uma função nomeada, e o roteador chama na ordem certa.
 *
 *   doGet   →  FICHA_doGet_        ficha de patrimônio por QR
 *           →  AXBIO_doGet_        central de biometria
 *           →  AP_ENTRADA_servir   entrada da V2 (padrão)
 *
 *   doPost  →  APIX_doPost_        API ÚNICA — a oficial da V2
 *           →  axbioPost           ações bio_*
 *           →  PONTE_doPost_       ponte antiga (compatibilidade)
 *
 * ------------------------------------------------------------
 * REGRA PARA QUEM FOR MEXER
 *
 * Nenhum outro arquivo deste projeto pode declarar doGet ou
 * doPost. Para acrescentar uma rota, exponha uma função no seu
 * módulo e acrescente uma linha aqui. Se declarar outro doGet,
 * ele apaga este em silêncio e o sistema volta a falhar de forma
 * difícil de rastrear.
 *
 * Para conferir a qualquer momento, rode: AP_ROTEADOR_conferir()
 * ============================================================
 */

var AP_ROTEADOR = {
  versao: '1.0.0',
  parte: 'PARTE_00'
};


/* ============================================================
   ENTRADA DE PÁGINAS  (GET)
   ============================================================ */

function doGet(e) {
  var params = (e && e.parameter) ? e.parameter : {};

  /* 1. Ficha de patrimônio — vem do QR Code colado no equipamento.
        Só assume quando há um código de ficha no endereço. */
  if (AP_ROTEADOR_existe_('FICHA_doGet_')) {
    var temCodigo = !!(params.f || params.ficha || params.pat ||
                       params.q || params.patrimonio || params.codigo ||
                       (params.p && params.p !== '3d'));
    if (temCodigo) {
      var ficha = AP_ROTEADOR_tentar_('FICHA_doGet_', e);
      if (ficha) return ficha;
    }
  }

  /* 2. Central de biometria — ?pagina=biometria */
  if (params.pagina === 'biometria' && AP_ROTEADOR_existe_('AXBIO_doGet_')) {
    var bio = AP_ROTEADOR_tentar_('AXBIO_doGet_', e);
    if (bio) return bio;
  }

  /* 3. Entrada padrão: o sistema. */
  if (AP_ROTEADOR_existe_('AP_ENTRADA_servir')) {
    return AP_ENTRADA_servir(e);
  }

  return AP_ROTEADOR_telaDeFalha_(
    'A entrada do sistema não foi encontrada.',
    'O arquivo "ALMOXA PRO — ENTRADA ÚNICA" precisa estar no projeto e ' +
    'expor a função AP_ENTRADA_servir.'
  );
}


/* ============================================================
   ENTRADA DE DADOS  (POST)
   ============================================================ */

function doPost(e) {
  /* 1. API ÚNICA — o canal oficial da V2. Responde a tudo que
        chega no formato da ponte. */
  if (AP_ROTEADOR_existe_('APIX_doPost_')) {
    var api = AP_ROTEADOR_tentar_('APIX_doPost_', e);
    if (api) return api;
  }

  /* 2. Biometria — trata só as ações bio_* e devolve null no resto. */
  if (AP_ROTEADOR_existe_('axbioPost')) {
    var bio = AP_ROTEADOR_tentar_('axbioPost', e);
    if (bio) return bio;
  }

  /* 3. Ponte antiga — mantida para o que ainda aponta para ela. */
  if (AP_ROTEADOR_existe_('PONTE_doPost_')) {
    var ponte = AP_ROTEADOR_tentar_('PONTE_doPost_', e);
    if (ponte) return ponte;
  }

  return ContentService
    .createTextOutput(JSON.stringify({
      ok: false,
      codigo: 'SEM_ROTA',
      mensagem: 'Nenhum módulo do projeto aceitou este pedido. ' +
                'Confira se a API ÚNICA está instalada.'
    }))
    .setMimeType(ContentService.MimeType.JSON);
}


/* ============================================================
   APOIO
   ============================================================ */

/** A função existe no escopo global? Sem inventar substituto. */
function AP_ROTEADOR_existe_(nome) {
  try {
    return eval('typeof ' + nome) === 'function';
  } catch (err) {
    return false;
  }
}

/**
 * Chama a função e devolve o resultado.
 * Se ela não existir, devolver null, ou estourar, o roteador segue
 * para a próxima opção em vez de derrubar a página inteira.
 */
function AP_ROTEADOR_tentar_(nome, e) {
  try {
    var fn = eval(nome);
    var r = fn(e);
    return r || null;
  } catch (err) {
    try {
      if (typeof AP_Logger_info === 'function') {
        AP_Logger_info('ROTEADOR', 'Falha em ' + nome + ': ' + (err && err.message));
      }
    } catch (ignorado) {}
    return null;
  }
}

/** Página honesta de falha: diz o que faltou e o que fazer. */
function AP_ROTEADOR_telaDeFalha_(titulo, acao) {
  return HtmlService.createHtmlOutput(
    '<div style="max-width:620px;margin:10vh auto;padding:28px;' +
    'font:15px/1.7 Segoe UI,system-ui,sans-serif;color:#1a2433;' +
    'border:2px solid #f0883e;border-radius:12px">' +
    '<h1 style="font-size:19px;margin:0 0 10px;color:#c2621f">' + titulo + '</h1>' +
    '<p>' + acao + '</p></div>'
  ).setTitle('ALMOXA PRO');
}


/* ============================================================
   CONFERÊNCIA — rode esta função no editor
   ============================================================ */

/**
 * Mostra quais rotas estão de pé e avisa se alguém voltou a
 * declarar doGet/doPost em outro arquivo.
 */
function AP_ROTEADOR_conferir() {
  var rotas = [
    ['GET  ficha de patrimônio', 'FICHA_doGet_'],
    ['GET  central de biometria', 'AXBIO_doGet_'],
    ['GET  entrada do sistema', 'AP_ENTRADA_servir'],
    ['POST API ÚNICA (oficial)', 'APIX_doPost_'],
    ['POST ações de biometria', 'axbioPost'],
    ['POST ponte antiga', 'PONTE_doPost_']
  ];

  var linhas = ['=== ROTEADOR ÚNICO v' + AP_ROTEADOR.versao + ' ===', ''];
  for (var i = 0; i < rotas.length; i++) {
    var ok = AP_ROTEADOR_existe_(rotas[i][1]);
    linhas.push((ok ? '  [ok]    ' : '  [falta] ') + rotas[i][0] +
                '   (' + rotas[i][1] + ')');
  }

  linhas.push('');
  linhas.push('Entrada do sistema: ' +
    (AP_ROTEADOR_existe_('AP_ENTRADA_servir')
      ? 'de pé — o sistema abre normalmente'
      : 'AUSENTE — a página inicial vai falhar'));

  var texto = linhas.join('\n');
  Logger.log(texto);
  return texto;
}
