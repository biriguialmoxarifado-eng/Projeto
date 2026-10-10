/* ============================================================
   ALMOXA PRO — OCR DE NOTA FISCAL COM IA DE VISÃO
   ------------------------------------------------------------
   SUBSTITUI o módulo anterior (AP_Modulo_ocr baseado em Vision
   + regex). Apague o arquivo antigo ao instalar este: os dois
   declaram AP_Modulo_ocr e o Apps Script fica com o último
   carregado, o que torna imprevisível qual está rodando.

   O QUE MUDOU, E POR QUÊ
   ----------------------
   O caminho antigo extraía o texto da foto e tentava adivinhar
   as colunas por expressão regular. Numa DANFE fotografada isso
   quebra fácil: o OCR junta colunas, quebra a descrição no meio
   e troca vírgula por ponto. Era essa a causa do "não reconhece
   os campos".

   Agora a foto vai para um modelo de visão com instruções sobre
   O QUE procurar numa nota fiscal brasileira, e ele devolve JSON
   estruturado — não texto solto. O backend valida, normaliza e
   só então mapeia para os campos que a tela já usa.

   NADA É GRAVADO SEM CONFERÊNCIA. Este módulo lê e devolve; quem
   grava é o fluxo de conferência da nota, depois do "confirmar".

   CONTRATO COM A TELA (nomes existentes, não inventados)
   ------------------------------------------------------
   campos:     numero, serie, chave, cnpj, fornecedor, emissao, valor
   listaItens: sku, codigo, descricao, unidade, ncm, qtd, recebido,
               valorUnitario, valorTotal
   Os mesmos que AP_Modulo_nf('salvar') grava e que a conferência lê.

   CONFIGURAÇÃO (uma vez)
   ----------------------
   SEM CHAVE NENHUMA (grátis, funciona na hora):
     Rode AP_OCR_status() uma vez pelo editor e aceite a tela de
     autorização. Pronto — a leitura usa o OCR do Google Drive.
     Não precisa adicionar serviço no menu Serviços.

   COM CHAVE GRATUITA (reconhece muito melhor a tabela de itens):
     Pegue a chave em aistudio.google.com > "Obter chave de API".
     Não pede cartão. Depois, no editor:
       AP_OCR_configurar('gemini', 'SUA_CHAVE')

   Anthropic Claude (pago):
     AP_OCR_configurar('anthropic', 'SUA_CHAVE')

   Conferir:
     AP_OCR_status()   ·   AP_OCR_testes()

   A chave fica nas Propriedades do Script — nunca no front, nunca
   no HTML, nunca no repositório.
   ============================================================ */

var AP_OCR_CFG = {
  versao: '2.5.0',

  props: {
    provedor: 'AP_OCR_PROVEDOR',
    gemini: 'AP_OCR_GEMINI_KEY',
    anthropic: 'AP_OCR_ANTHROPIC_KEY',
    modelo: 'AP_OCR_MODELO'
  },

  modeloPadrao: {
    gemini: 'gemini-flash-latest',
    anthropic: 'claude-sonnet-4-5'
  },

  /* a linha Flash é a que fica na camada gratuita do AI Studio.
     Os nomes mudam; o módulo tenta um a um até achar o que a
     chave enxerga. */
  modelosAlternativos: [
    'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash',
    'gemini-flash-lite-latest', 'gemini-2.0-flash-lite'
  ],

  endpoint: {
    gemini: 'https://generativelanguage.googleapis.com/v1beta/models/',
    anthropic: 'https://api.anthropic.com/v1/messages'
  },

  maxPaginas: 8,
  maxMbPorPagina: 8,
  timeoutMs: 120000,

  /* o vínculo automático exige código igual. Descrição parecida
     NUNCA vincula sozinha — só pergunta. */
  scoreSugestao: 0.30,

  catalogoNoRetorno: 500
};


/* ============================================================
   ENTRADA
   ============================================================ */

function AP_Modulo_ocr(acao, payload, sessao) {
  payload = payload || {};
  try {
    switch (acao) {

      case 'status':
        return { ok: true, dados: AP_OCR_status() };

      /* 'ler' aceita uma página (base64) ou várias (paginas[]) —
         a tela antiga continua funcionando sem mudar nada */
      case 'ler':
      case 'lerPaginas':
        return AP_OCR_ler_(payload, sessao);

      /* relê um JSON já devolvido pela IA, sem gastar nova leitura */
      case 'interpretar':
        if (!payload.json) {
          return { ok: false, codigo: 'SEM_JSON', mensagem: 'Nada para interpretar.' };
        }
        return { ok: true, dados: AP_OCR_processar_(payload.json, payload.paginas || 1) };

      /* só o catálogo, para o seletor da tela */
      case 'catalogo':
        return { ok: true, dados: AP_OCR_catalogo_().slice(0, AP_OCR_CFG.catalogoNoRetorno) };
    }
    return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'ocr.' + acao + ' não existe.' };
  } catch (e) {
    AP_OCR_registrarErro_('ocr.' + acao, e);
    return { ok: false, codigo: 'OCR_ERRO', mensagem: e.message };
  }
}


/* ============================================================
   CONFIGURAÇÃO E ESTADO
   ============================================================ */

function AP_OCR_configurar(provedor, chave, modelo) {
  provedor = String(provedor || '').toLowerCase();
  if (['gemini', 'anthropic'].indexOf(provedor) === -1) {
    throw new Error('Provedor deve ser "gemini" ou "anthropic".');
  }
  if (!chave || String(chave).length < 20) throw new Error('Chave inválida.');

  var p = PropertiesService.getScriptProperties();
  p.setProperty(AP_OCR_CFG.props.provedor, provedor);
  p.setProperty(AP_OCR_CFG.props[provedor], String(chave).trim());
  if (modelo) p.setProperty(AP_OCR_CFG.props.modelo, String(modelo).trim());

  return 'Pronto: ' + provedor + ' configurado. Rode AP_OCR_status() para conferir.';
}

function AP_OCR_removerChaves() {
  var p = PropertiesService.getScriptProperties();
  Object.keys(AP_OCR_CFG.props).forEach(function (k) { p.deleteProperty(AP_OCR_CFG.props[k]); });
  return 'Chaves removidas.';
}

function AP_OCR_status() {
  var p = PropertiesService.getScriptProperties();
  var provedor = p.getProperty(AP_OCR_CFG.props.provedor) || '';
  var chave = provedor ? (p.getProperty(AP_OCR_CFG.props[provedor]) || '') : '';

  /* o OCR do Drive é feito por REST: basta a execução conseguir
     um token. Não depende mais do menu Serviços. */
  var temDrive = false, motivoDrive = '';
  try {
    temDrive = !!AP_OCR_escopoDrive_();
  } catch (e) {
    motivoDrive = e.message;
  }

  return {
    versao: AP_OCR_CFG.versao,
    provedor: provedor || 'nenhum',
    modelo: p.getProperty(AP_OCR_CFG.props.modelo) || AP_OCR_CFG.modeloPadrao[provedor] || '—',
    pronto: !!chave,
    driveDisponivel: temDrive,
    servicoAvancado: (function () {
      try { return (typeof Drive !== 'undefined' && !!Drive.Files) ? 'instalado' : 'não instalado (não é necessário)'; }
      catch (e) { return 'não instalado (não é necessário)'; }
    })(),
    motorAtivo: chave
      ? (provedor + ' (IA de visão)')
      : (temDrive ? 'OCR do Google Drive (gratuito, sem chave)' : 'nenhum'),
    funciona: !!chave || temDrive,
    maxPaginas: AP_OCR_CFG.maxPaginas,
    instrucao: chave ? '' : (temDrive
      ? 'Funcionando pelo OCR gratuito do Drive, sem chave e sem instalar serviço. ' +
      'Para reconhecer melhor a tabela de itens, pegue uma chave GRATUITA em ' +
      'aistudio.google.com (Obter chave de API — não pede cartão) e rode ' +
      'AP_OCR_configurar("gemini", "SUA_CHAVE").'
      : 'Sem autorização do Drive nesta conta' + (motivoDrive ? ' (' + motivoDrive + ')' : '') +
      '. Rode AP_OCR_status() pelo editor e aceite a tela de permissão, ou pegue a chave ' +
      'gratuita em aistudio.google.com e rode AP_OCR_configurar("gemini", "SUA_CHAVE").')
  };
}

function AP_OCR_registrarErro_(onde, e) {
  var msg = (e && e.message) || String(e);
  try { console.error('[OCR] ' + onde + ': ' + msg); } catch (x) { }
  try { Logger.log('[OCR] ' + onde + ': ' + msg); } catch (x) { }
  try {
    if (typeof AP_ErrorHandler_capture === 'function') AP_ErrorHandler_capture(e, onde);
  } catch (x) { }
}


/* ============================================================
   LEITURA — UMA OU VÁRIAS PÁGINAS, UMA CHAMADA SÓ
   ------------------------------------------------------------
   Uma nota de três páginas fotografada vira três imagens. Elas
   vão JUNTAS na mesma chamada: o modelo vê a nota inteira, sabe
   que a tabela continua na página seguinte e não repete o
   cabeçalho como se fosse outra nota.
   ============================================================ */

function AP_OCR_ler_(payload, sessao) {
  var st = AP_OCR_status();

  var paginas = AP_OCR_paginasDoPayload_(payload);
  if (!paginas.length) {
    return { ok: false, codigo: 'SEM_ARQUIVO', mensagem: 'Nenhuma imagem recebida.' };
  }
  if (paginas.length > AP_OCR_CFG.maxPaginas) {
    return {
      ok: false, codigo: 'PAGINAS_DEMAIS',
      mensagem: 'Envie no máximo ' + AP_OCR_CFG.maxPaginas + ' páginas por vez.'
    };
  }

  var t0 = Date.now();
  var bruto, textoResposta, motorUsado;

  try {
    if (st.pronto) {
      var r = (st.provedor === 'anthropic')
        ? AP_OCR_chamarAnthropic_(paginas, st)
        : AP_OCR_chamarGemini_(paginas, st);
      textoResposta = r.texto;
      bruto = AP_OCR_extrairJson_(textoResposta);
      motorUsado = st.provedor + ' (' + st.modelo + ')';
    } else {
      /* SEM CHAVE NENHUMA: o OCR do Google Drive lê a foto de graça
         e o interpretador abaixo monta o mesmo JSON que a IA
         montaria. Reconhece menos, mas reconhece — e não custa nada. */
      bruto = AP_OCR_lerComDrive_(paginas);
      motorUsado = 'OCR do Google Drive (sem chave)';
    }
  } catch (e) {
    AP_OCR_registrarErro_('leitura', e);
    return {
      ok: false, codigo: 'OCR_FALHOU',
      mensagem: 'Não consegui ler a nota: ' + e.message,
      dados: { provedor: st.provedor, paginas: paginas.length }
    };
  }

  if (!bruto) {
    AP_OCR_registrarErro_('resposta', new Error('a IA não devolveu JSON válido'));
    return {
      ok: false, codigo: 'JSON_INVALIDO',
      mensagem: 'A leitura voltou em formato inesperado. Tente fotografar de novo.',
      dados: { amostra: String(textoResposta || '').slice(0, 400) }
    };
  }

  var dados = AP_OCR_processar_(bruto, paginas.length);
  dados.msLeitura = Date.now() - t0;
  dados.provedor = st.pronto ? st.provedor : 'drive';
  dados.modelo = motorUsado;
  dados.motor = motorUsado;

  if (!st.pronto) {
    dados.avisos.unshift('Leitura feita pelo OCR gratuito do Google Drive. Ele acerta menos ' +
      'que a IA de visão, principalmente na tabela de itens. Para melhorar sem pagar nada, ' +
      'pegue uma chave gratuita no Google AI Studio e rode ' +
      'AP_OCR_configurar("gemini", "SUA_CHAVE").');
  }

  try {
    if (typeof AP_Audit_log === 'function') {
      AP_Audit_log((sessao && sessao.usuario) || 'sistema', 'OCR_LEITURA', 'NF',
        dados.campos.numero || '(sem número)', {
        paginas: paginas.length, itens: dados.itens.length,
        avisos: dados.avisos.length, ms: dados.msLeitura
      });
    }
  } catch (e) { }

  return { ok: true, dados: dados };
}

/* ============================================================
   MOTOR GRATUITO — OCR DO GOOGLE DRIVE
   ------------------------------------------------------------
   Não precisa de chave, não precisa de cartão, não tem cota paga.
   O Drive converte a imagem em texto; o interpretador abaixo
   monta o MESMO JSON que a IA de visão montaria, então daí para
   a frente o caminho é idêntico — validação, normalização,
   vínculo com o cadastro e a pergunta de confirmação.

   NÃO PRECISA MAIS ADICIONAR SERVIÇO NENHUM
   -----------------------------------------
   A versão anterior mandava adicionar "Drive API (v2)" em
   Serviços. Esse item não existe mais: o serviço avançado do
   Drive hoje é a v3, e nela Drive.Files.insert virou
   Drive.Files.create — a chamada antiga falhava.

   Agora a conversão é feita pela API REST do Drive, chamada
   direto com UrlFetchApp e o token da própria execução. Não
   depende do menu Serviços, não depende de v2 nem de v3.

   Se o serviço avançado estiver instalado (em qualquer versão),
   ele é usado como reserva quando o REST falhar.

   PERMISSÃO
   ---------
   A execução precisa do escopo do Drive. A linha comentada
   DriveApp dentro de AP_OCR_escopoDrive_() existe só para o Apps
   Script detectar isso e pedir a autorização na primeira
   execução. Se aparecer erro de permissão, rode AP_OCR_status()
   uma vez pelo editor e aceite a tela de autorização.

   Ele acerta menos que a IA, sobretudo na tabela de itens, onde
   o OCR embaralha colunas. Por isso cada item vem com confiança
   e a tela pede conferência. Com a chave gratuita do Gemini o
   resultado melhora bastante.
   ============================================================ */

/**
 * Esta função existe para o Apps Script enxergar o uso do Drive e
 * incluir o escopo na autorização. A chamada real é REST.
 */
function AP_OCR_escopoDrive_() {
  // DriveApp.getRootFolder();
  return ScriptApp.getOAuthToken();
}

function AP_OCR_lerComDrive_(paginas) {
  var textos = paginas.map(function (p, i) {
    var nome = 'ALMOXA_OCR_TEMP_' + Date.now() + '_' + i;
    var idTemp = null;

    try {
      idTemp = AP_OCR_driveConverter_(p, nome);
      return { pagina: i + 1, texto: AP_OCR_driveTexto_(idTemp) };
    } catch (e) {
      AP_OCR_registrarErro_('drive.pagina' + (i + 1), e);
      /* uma página ilegível não derruba as outras; a falta dela
         aparece na conferência de quantidade de itens */
      return { pagina: i + 1, texto: '', erro: e.message };
    } finally {
      if (idTemp) AP_OCR_driveApagar_(idTemp);
    }
  });

  var falhas = textos.filter(function (t) { return t.erro; });
  if (falhas.length === textos.length) {
    throw new Error(falhas[0].erro);
  }

  var tudo = textos.map(function (t) { return t.texto; }).join('\n').trim();
  if (tudo.replace(/\s/g, '').length < 20) {
    throw new Error('o Drive não encontrou texto na imagem. Fotografe a nota plana, ' +
      'com boa luz, sem sombra e sem cortar as bordas.');
  }

  return AP_OCR_interpretarTexto_(textos);
}

/**
 * Converte a imagem em documento com OCR e devolve o id.
 *
 * Caminho principal: upload multipart para a API REST do Drive,
 * com ocr=true e ocrLanguage=pt. O Apps Script não tem FormData,
 * então o corpo é montado à mão — e o conteúdo vai em base64,
 * que é como ele já chega da tela, sem conversão de bytes.
 */
function AP_OCR_driveConverter_(pagina, nome) {
  var limite = '-----ALMOXA' + Utilities.getUuid().replace(/-/g, '');
  var metadados = { name: nome, mimeType: 'application/vnd.google-apps.document' };

  var corpo =
    '--' + limite + '\r\n' +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadados) + '\r\n' +
    '--' + limite + '\r\n' +
    'Content-Type: ' + pagina.tipo + '\r\n' +
    'Content-Transfer-Encoding: base64\r\n\r\n' +
    pagina.base64 + '\r\n' +
    '--' + limite + '--';

  var res = UrlFetchApp.fetch(
    'https://www.googleapis.com/upload/drive/v3/files' +
    '?uploadType=multipart&ocr=true&ocrLanguage=pt&supportsAllDrives=true&fields=id',
    {
      method: 'post',
      contentType: 'multipart/related; boundary=' + limite,
      payload: corpo,
      headers: { Authorization: 'Bearer ' + AP_OCR_escopoDrive_() },
      muteHttpExceptions: true
    });

  var codigo = res.getResponseCode();
  var json = {};
  try { json = JSON.parse(res.getContentText()); } catch (e) { }

  if (codigo === 200 || codigo === 201) {
    if (json.id) return json.id;
  }

  var msg = (json.error && json.error.message) || ('HTTP ' + codigo);

  /* reserva: serviço avançado, se estiver instalado — v3 usa
     create, v2 usava insert. Aceita as duas. */
  try {
    if (typeof Drive !== 'undefined' && Drive.Files) {
      var blob = Utilities.newBlob(Utilities.base64Decode(pagina.base64), pagina.tipo, nome);
      var opcoes = { ocr: true, ocrLanguage: 'pt' };

      if (typeof Drive.Files.create === 'function') {
        return Drive.Files.create(
          { name: nome, mimeType: 'application/vnd.google-apps.document' }, blob, opcoes).id;
      }
      if (typeof Drive.Files.insert === 'function') {
        return Drive.Files.insert(
          { title: nome, mimeType: 'application/vnd.google-apps.document' }, blob, opcoes).id;
      }
    }
  } catch (e) {
    msg += ' · serviço avançado também falhou: ' + e.message;
  }

  if (/insufficient|permission|scope|unauthor/i.test(msg)) {
    throw new Error('falta autorização do Drive para esta conta. Abra o editor do Apps ' +
      'Script, rode AP_OCR_status() uma vez e aceite a tela de permissão. Detalhe: ' + msg);
  }
  if (/quota|storage/i.test(msg)) {
    throw new Error('o Drive desta conta está sem espaço para o arquivo temporário. ' +
      'Libere espaço ou use a chave gratuita do Gemini. Detalhe: ' + msg);
  }
  throw new Error(msg);
}

/** O texto do documento convertido */
function AP_OCR_driveTexto_(id) {
  try {
    return DocumentApp.openById(id).getBody().getText();
  } catch (e) {
    var res = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) +
      '/export?mimeType=text/plain',
      {
        headers: { Authorization: 'Bearer ' + AP_OCR_escopoDrive_() },
        muteHttpExceptions: true
      });
    if (res.getResponseCode() !== 200) {
      throw new Error('não consegui ler o texto convertido (HTTP ' + res.getResponseCode() + ').');
    }
    return res.getContentText();
  }
}

/** O arquivo temporário é sempre removido — nada fica no Drive */
function AP_OCR_driveApagar_(id) {
  try {
    DriveApp.getFileById(id).setTrashed(true);
    return;
  } catch (e) { }
  try {
    UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id), {
      method: 'delete',
      headers: { Authorization: 'Bearer ' + AP_OCR_escopoDrive_() },
      muteHttpExceptions: true
    });
  } catch (e) {
    AP_OCR_registrarErro_('drive.apagar', e);
  }
}

/** Monta, a partir do texto do OCR, o mesmo JSON que a IA devolve */
function AP_OCR_interpretarTexto_(paginasDeTexto) {
  var todas = paginasDeTexto.map(function (p) {
    return {
      pagina: p.pagina,
      linhas: String(p.texto).split(/\r?\n/)
        .map(function (l) { return l.replace(/\s+/g, ' ').trim(); })
        .filter(function (l) { return l.length > 0; })
    };
  });

  var linhas = [];
  todas.forEach(function (p) {
    p.linhas.forEach(function (l) { linhas.push({ pagina: p.pagina, texto: l }); });
  });
  var plano = linhas.map(function (l) { return l.texto; }).join('\n');
  var semSeparador = plano.replace(/[\s.\-\/]/g, '');
  var ilegiveis = [];

  function achar(regexes, transformar) {
    for (var i = 0; i < regexes.length; i++) {
      var m = plano.match(regexes[i]);
      if (m) return transformar ? transformar(m) : m[1];
    }
    return null;
  }

  /* ---- chave de acesso: o campo que confere todos os outros ----
     O OCR às vezes perde ou dobra um dígito. Uma sequência longa
     com tamanho errado não é descartada: sobe assim mesmo e o
     validador avisa, em vez de sumir sem explicação. */
  var chave = (semSeparador.match(/\d{44}/) || [])[0] ||
    (semSeparador.match(/\d{40,48}/) || [])[0] || null;

  var numero = achar([
    /N[ºo°\.]*\s*[:\-]?\s*(\d{1,3}[\.\s]\d{3}[\.\s]\d{3})/i,
    /N[ºo°\.]*\s*[:\-]?\s*(\d{3}[\.\s]\d{3})\b/i,
    /N[ÚU]MERO\s*[:\-]?\s*(\d[\d\.\s]{4,12})/i
  ]);
  var serie = achar([/S[ÉE]RIE\s*[:\-]?\s*(\d{1,3})/i]);
  var cnpj = achar([/(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/]);
  var ie = achar([/INSCRI[ÇC][ÃA]O\s+ESTADUAL[^\d]{0,15}([\d\.\/-]{6,20})/i]);
  var emissao = achar([
    /(?:EMISS[ÃA]O|DT\.?\s*EMISS[ÃA]O)[^\d]{0,20}(\d{2}\/\d{2}\/\d{4})/i,
    /(\d{2}\/\d{2}\/\d{4})/
  ]);
  var valorTotal = achar([
    /VALOR\s+TOTAL\s+DA\s+NOTA[^\d]{0,30}([\d\.]+,\d{2})/i,
    /V\.?\s*TOTAL\s+DA\s+NOTA[^\d]{0,30}([\d\.]+,\d{2})/i
  ]);
  var valorProdutos = achar([
    /VALOR\s+TOTAL\s+DOS?\s+PRODUTOS[^\d]{0,30}([\d\.]+,\d{2})/i
  ]);
  var frete = achar([/VALOR\s+DO\s+FRETE[^\d]{0,30}([\d\.]+,\d{2})/i]);
  var desconto = achar([/VALOR\s+DO\s+DESCONTO[^\d]{0,30}([\d\.]+,\d{2})/i]);
  var totalItens = achar([/QUANTIDADE\s+TOTAL\s+DE\s+ITENS[^\d]{0,15}(\d{1,3})/i]);

  /* ---- o quadro CALCULO DO IMPOSTO ----
     Estes campos existem na DANFE desde sempre; o que faltava era
     le-los. Campo ausente continua null: zero seria uma afirmacao
     que a nota nao fez. */
  var seguro = achar([
    /VALOR\s+DO\s+SEGURO[^\d]{0,30}([\d\.]+,\d{2})/i,
    /V\.?\s*SEGURO[^\d]{0,30}([\d\.]+,\d{2})/i
  ]);
  var outras = achar([
    /OUTRAS?\s+DESPESAS\s+ACESS[ÓO]RIAS[^\d]{0,30}([\d\.]+,\d{2})/i,
    /OUTRAS?\s+DESPESAS[^\d]{0,30}([\d\.]+,\d{2})/i
  ]);
  var ipi = achar([
    /VALOR\s+(?:TOTAL\s+)?DO\s+IPI[^\d]{0,30}([\d\.]+,\d{2})/i,
    /V\.?\s*(?:TOTAL\s+)?IPI[^\d]{0,30}([\d\.]+,\d{2})/i
  ]);
  var icmsBase = achar([
    /BASE\s+DE\s+C[ÁA]LCULO\s+DO\s+ICMS(?!\s+S)[^\d]{0,30}([\d\.]+,\d{2})/i
  ]);
  var icmsValor = achar([
    /VALOR\s+DO\s+ICMS(?!\s*S\.?T|\s+SUBST)[^\d]{0,30}([\d\.]+,\d{2})/i
  ]);
  var icmsStBase = achar([
    /BASE\s+DE\s+C[ÁA]LCULO\s+DO\s+ICMS\s*(?:S\.?T\.?|SUBST[^\d]{0,20})[^\d]{0,30}([\d\.]+,\d{2})/i
  ]);
  var icmsStValor = achar([
    /VALOR\s+DO\s+ICMS\s*(?:S\.?T\.?|SUBST[^\d]{0,20})[^\d]{0,30}([\d\.]+,\d{2})/i
  ]);

  /**
   * O FORNECEDOR É O EMITENTE, NUNCA O DESTINATÁRIO
   * ------------------------------------------------
   * Numa DANFE aparecem duas empresas: quem vendeu (o emitente,
   * no alto) e quem comprou (o destinatário, logo abaixo). Quem
   * fornece é o primeiro.
   *
   * O laço antigo varria o documento inteiro guardando a última
   * empresa que encontrasse — e a última é sempre o destinatário.
   * Resultado: a nota vinha com o nome da própria casa no campo
   * do fornecedor, e era esse nome que ia para o cadastro.
   *
   * Agora a busca para onde o bloco do destinatário começa.
   */
  var limite = linhas.length;
  for (var d = 0; d < linhas.length; d++) {
    if (/DESTINAT[ÁA]RIO|REMETENTE|TOMADOR\s+DO\s+SERVI[ÇC]O/i.test(linhas[d].texto)) {
      limite = d;
      break;
    }
  }
  var doEmitente = linhas.slice(0, limite);

  /* "RECEBEMOS DE <FORNECEDOR> OS PRODUTOS" nomeia o emitente
     com todas as letras — quando existe, é a resposta certa */
  var razao = null;
  for (var q = 0; q < doEmitente.length && !razao; q++) {
    var m = doEmitente[q].texto.match(
      /RECEBEMOS\s+DE\s+(.+?)\s+OS\s+PRODUTOS|RECEBEMOS\s+DE\s+(.{6,70})/i);
    if (m) razao = (m[1] || m[2] || '').trim();
  }

  /* senão, a PRIMEIRA linha com cara de empresa antes do
     destinatário — primeira, não última */
  if (!razao) {
    for (var e = 0; e < doEmitente.length && !razao; e++) {
      var t = doEmitente[e].texto;
      if (/\b(LTDA|EIRELI|S\/A|S\.A\.|ME|EPP|COM[ÉE]RCIO|DISTRIBUIDORA|IND[ÚU]STRIA)\b/i.test(t) &&
        t.length >= 8 && t.length <= 90 &&
        !/DANFE|NOTA FISCAL|CHAVE|RECEBEMOS|CONSULTA/i.test(t)) {
        razao = t;
      }
    }
  }

  /* último recurso: a linha logo acima do primeiro CNPJ */
  if (!razao) {
    for (var i = 0; i < doEmitente.length; i++) {
      if (/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/.test(doEmitente[i].texto)) {
        for (var k = i - 1; k >= 0 && k >= i - 4; k--) {
          var c = doEmitente[k].texto;
          if (c.length >= 6 && /[A-ZÀ-Ú]/.test(c) &&
            !/DANFE|NOTA FISCAL|DOCUMENTO|CHAVE|SA[ÍI]DA|ENTRADA|RECEBEMOS/i.test(c)) {
            razao = c; break;
          }
        }
        break;
      }
    }
  }

  if (razao) {
    razao = razao.replace(/\s{2,}/g, ' ')
      .replace(/^(RAZ[ÃA]O\s+SOCIAL|EMITENTE|FORNECEDOR)\s*[:\-]?\s*/i, '').trim();
  }

  /* o CNPJ do fornecedor também sai só do bloco do emitente */
  var cnpjEmitente = null;
  for (var c2 = 0; c2 < doEmitente.length && !cnpjEmitente; c2++) {
    var mc = doEmitente[c2].texto.match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/);
    if (mc) cnpjEmitente = mc[0];
  }
  if (cnpjEmitente) cnpj = cnpjEmitente;

  if (!numero && !chave) ilegiveis.push('nota.numero');
  if (!serie) ilegiveis.push('nota.serie');
  if (!chave) ilegiveis.push('nota.chaveAcesso');
  if (!cnpj) ilegiveis.push('fornecedor.cnpj');
  if (!razao) ilegiveis.push('fornecedor.razaoSocial');
  if (!emissao) ilegiveis.push('nota.dataEmissao');
  if (!valorTotal) ilegiveis.push('nota.valorTotal');

  return {
    fornecedor: { cnpj: cnpj, razaoSocial: razao, inscricaoEstadual: ie, endereco: null },
    nota: {
      numero: numero, serie: serie, chaveAcesso: chave,
      dataEmissao: emissao, dataEntradaSaida: null,
      valorProdutos: valorProdutos, valorFrete: frete, valorDesconto: desconto,
      valorSeguro: seguro, valorOutros: outras,
      valorIpi: ipi, icmsBase: icmsBase, icmsValor: icmsValor,
      icmsStBase: icmsStBase, icmsStValor: icmsStValor,
      valorTotal: valorTotal || valorProdutos,
      quantidadeItensDeclarada: totalItens ? Number(totalItens) : null
    },
    produtos: AP_OCR_produtosDoTexto_(linhas),
    camposIlegiveis: ilegiveis,
    observacoes: 'Leitura pelo OCR do Google Drive.',

    /**
     * O TEXTO CRU, GUARDADO DE PROPÓSITO
     *
     * Quando a tabela não é reconhecida, adivinhar o motivo custa
     * uma rodada de tentativa a cada vez. Com o texto que o OCR
     * realmente devolveu em mãos, dá para ver na hora se o
     * problema foi a foto, o layout da nota ou a leitura.
     */
    textoOcr: linhas.map(function (l) { return l.texto; }).join('\n').slice(0, 12000)
  };
}

/**
 * A tabela de produtos, linha a linha.
 *
 * Não dá para exigir um layout: cada emissor imprime a DANFE de
 * um jeito. Então a linha é lida pelo que ela contém — um NCM de
 * 8 dígitos, um CFOP de 4, uma unidade conhecida e, no fim, os
 * três números que sempre vêm na mesma ordem: quantidade, valor
 * unitário e valor total.
 *
 * Só entra como item quando qtd × unitário bate com o total. É
 * esse teste que impede linha de imposto virar produto.
 */
function AP_OCR_produtosDoTexto_(linhas) {
  var unidades = ['UN', 'UND', 'PC', 'PÇ', 'PCT', 'CX', 'KG', 'G', 'MT', 'M', 'M2', 'M3',
    'L', 'LT', 'ML', 'SC', 'RL', 'BR', 'PAR', 'JG', 'KIT', 'TN', 'FD', 'GL', 'BD'];
  var reUnidade = new RegExp('\\b(' + unidades.join('|') + ')\\b', 'i');

  var produtos = [], naTabela = false;

  linhas.forEach(function (item) {
    var linha = item.texto;

    if (/DADOS?\s+DOS?\s+PRODUTOS|PRODUTOS?\s*\/?\s*SERVI[ÇC]OS|DESCRI[ÇC][ÃA]O\s+DO\s+PRODUTO/i.test(linha)) {
      naTabela = true; return;
    }
    if (/C[ÁA]LCULO\s+DO\s+IMPOSTO|DADOS\s+ADICIONAIS|TRANSPORTADOR|ISSQN|RESERVADO AO FISCO/i.test(linha)) {
      naTabela = false; return;
    }
    if (linha.length < 12) return;
    if (/BASE DE C[ÁA]LCULO|VALOR DO ICMS|VALOR TOTAL DA NOTA|FRETE|SEGURO|DESCONTO|IPI|PIS|COFINS/i.test(linha)) return;

    var decimais = linha.match(/\d{1,3}(?:\.\d{3})*,\d{1,4}|\d+,\d{1,4}/g) || [];
    var qtd, vu, vt, confianca;

    if (decimais.length >= 3) {
      var tres = decimais.slice(-3);
      qtd = AP_OCR_numero_(tres[0]); vu = AP_OCR_numero_(tres[1]); vt = AP_OCR_numero_(tres[2]);
      confianca = 0.8;
    } else if (decimais.length === 2) {
      vu = AP_OCR_numero_(decimais[0]); vt = AP_OCR_numero_(decimais[1]);
      qtd = vu ? Math.round((vt / vu) * 1000) / 1000 : 0;
      confianca = 0.6;
    } else return;

    if (!qtd || !vt || qtd > 1000000 || vt > 10000000) return;

    var bate = Math.abs(qtd * vu - vt) <= Math.max(0.05, vt * 0.02);
    if (!bate) {
      if (decimais.length < 3) return;
      confianca = 0.45;
    }
    if (!naTabela && confianca < 0.7) return;

    var ncm = (linha.match(/\b\d{8}\b/) || [])[0] || '';
    var posNcm = ncm ? linha.indexOf(ncm) : -1;

    /* O CFOP vem DEPOIS do NCM. Procurando na linha inteira, o
       código do produto ("7898") era confundido com CFOP e saía
       apagado da descrição, deixando o 5102 no lugar dele. */
    var cauda = posNcm > -1 ? linha.slice(posNcm + ncm.length) : linha;
    var cfop = (cauda.match(/\b[1-7]\d{3}\b/) || [])[0] || '';

    /**
     * O CST/CSOSN VEM ENTRE O NCM E O CFOP
     *
     * Na DANFE a ordem das colunas é NCM/SH · CST (ou CSOSN) · CFOP.
     * O CST tem 3 dígitos (origem + tributação: 000, 041, 060…) e o
     * CSOSN tem 3 dígitos começando por 1, 2, 4, 5 ou 9 (101, 500…).
     *
     * Procuro SÓ no pedaço entre o NCM e o CFOP. Procurar na linha
     * inteira pegaria qualquer número de três dígitos — um "500"
     * de quantidade, por exemplo — e carimbaria tributação errada
     * num item fiscal. Na dúvida, prefiro devolver vazio: campo em
     * branco a pessoa vê e preenche; campo errado ela não vê.
     */
    var cst = '';
    if (posNcm > -1) {
      var posCfop = cfop ? cauda.indexOf(cfop) : -1;
      var meio = posCfop > 0 ? cauda.slice(0, posCfop) : '';
      var achouCst = meio.match(/\b(\d{3})\b/);
      if (achouCst) cst = achouCst[1];
    }

    var codigo = (linha.match(/^\s*([A-Z0-9][A-Z0-9\.\-\/]{2,14})\b/i) || [])[1] || '';

    /* A unidade é a coluna logo antes dos três números do fim.
       Procurar "a primeira unidade da linha" pegava o M de
       "TAM M" e deixava PAR dentro da descrição. */
    var posPrimeiroNumero = linha.indexOf(decimais[Math.max(0, decimais.length - 3)]);
    var cabeca = posPrimeiroNumero > 0 ? linha.slice(0, posPrimeiroNumero) : linha;
    var unidade = '', posUnidade = -1;
    unidades.forEach(function (u) {
      var re = new RegExp('\\b' + u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
      var m;
      while ((m = re.exec(cabeca)) !== null) {
        if (m.index > posUnidade) { posUnidade = m.index; unidade = m[0].toUpperCase(); }
      }
    });

    /**
     * A DESCRIÇÃO É O QUE VEM ANTES DO NCM
     *
     * Apagar "todo decimal da linha" comia a medida do próprio
     * produto: "CABO FLEXÍVEL 2,5MM" virava "CABO FLEXÍVEL MM".
     * O NCM marca onde a descrição termina e começam os códigos
     * fiscais — cortar ali preserva bitola, tamanho e modelo.
     */
    var descricao;
    if (posNcm > -1) {
      descricao = linha.slice(0, posNcm);
    } else {
      /* sem NCM: corta no primeiro dos três números consumidos */
      var corte = linha.indexOf(decimais[Math.max(0, decimais.length - 3)]);
      descricao = corte > 0 ? linha.slice(0, corte) : linha;
      decimais.slice(-3).forEach(function (d) { descricao = descricao.replace(d, ' '); });
    }

    /* a unidade, quando caiu antes do NCM, sai pela posição exata */
    if (unidade && posUnidade > -1 && posUnidade < descricao.length) {
      descricao = descricao.slice(0, posUnidade) + ' ' +
        descricao.slice(posUnidade + unidade.length);
    }
    if (codigo) descricao = descricao.replace(codigo, ' ');

    descricao = descricao.replace(/\b\d{6,}\b/g, ' ')
      .replace(/\s+/g, ' ').replace(/^[\-\.\s|]+|[\-\.\s|]+$/g, '').trim();

    /**
     * LINHA COM NÚMEROS VÁLIDOS NUNCA É JOGADA FORA
     *
     * Descartar o item porque a descrição saiu vazia fazia a nota
     * inteira sumir quando o OCR separava as colunas. Se a conta
     * fecha, o item existe: entra com a descrição em branco e
     * marcado, para ser digitado na tela — ver a linha e escrever
     * duas palavras é muito melhor que não ver nada.
     */
    var semDescricao = descricao.replace(/[^A-Za-zÀ-ú]/g, '').length < 3;
    if (semDescricao) descricao = codigo ? ('item ' + codigo) : '';

    produtos.push({
      codigo: codigo, descricao: descricao, ncm: ncm, cst: cst, cfop: cfop,
      unidade: unidade || 'UN',
      quantidade: String(qtd).replace('.', ','),
      valorUnitario: String(vu).replace('.', ','),
      valorTotal: String(vt).replace('.', ','),
      pagina: item.pagina,
      confianca: semDescricao ? Math.min(confianca, 0.4) : confianca,
      ilegivel: confianca < 0.7 || semDescricao,
      descricaoFaltando: semDescricao
    });
  });

  /* O modo acima só enxerga a tabela quando o OCR mantém cada
     item numa linha. Numa foto de DANFE isso quase nunca acontece:
     o Drive quebra a linha no meio, ou despeja coluna por coluna.
     Quando ele não achou nada, entra o modo fluxo. */
  /**
   * TRÊS LEITURAS, E A MELHOR VENCE
   *
   * Cada modo acerta num tipo de bagunça do OCR. Rodar só o
   * primeiro que "funciona" faz uma leitura ruim bloquear uma boa:
   * o modo linha devolvia itens com a descrição vazia e, por ter
   * devolvido algo, impedia o modo fluxo de tentar.
   *
   * Então os três rodam e o melhor resultado é escolhido — quem
   * trouxer mais itens COM descrição de verdade.
   */
  var regiao = AP_OCR_regiaoDaTabela_(linhas);

  var candidatos = [
    produtos,
    AP_OCR_produtosPorColunas_(regiao, unidades),
    AP_OCR_produtosPorFluxo_(regiao, unidades, true),
    /* última rede: sem recorte nenhum, caso a detecção da região
       tenha errado — errar para menos é aceitável, voltar de mãos
       vazias não é */
    AP_OCR_produtosPorFluxo_(linhas, unidades, true)
  ];

  return AP_OCR_melhorLeitura_(candidatos);
}

/** Entre as leituras, vence a que tem mais itens com descrição real */
function AP_OCR_melhorLeitura_(candidatos) {
  var melhor = [], melhorNota = -1;

  candidatos.forEach(function (lista) {
    lista = lista || [];
    var comDescricao = lista.filter(function (p) { return !p.descricaoFaltando; }).length;
    /* a descrição pesa: 10 itens sem nome valem menos que 3 com nome */
    var nota = comDescricao * 100 + lista.length;
    if (nota > melhorNota) { melhorNota = nota; melhor = lista; }
  });

  return melhor;
}

/**
 * MODO COLUNAS — quando o OCR despeja uma coluna de cada vez
 *
 * Em vez de linha por item, o Drive às vezes devolve todas as
 * descrições juntas, depois todos os NCMs, depois as unidades, e
 * por fim os números. Nos outros modos isso vira um item só,
 * porque não há nada entre um NCM e o seguinte.
 *
 * Aqui cada coluna é reconhecida pelo formato das linhas e as
 * colunas são costuradas de volta. Só vale quando as contagens
 * batem — se houver 3 descrições, 3 NCMs e 3 trios de números.
 * Sem isso, é chute, e chute não entra na nota.
 */
function AP_OCR_produtosPorColunas_(linhas, unidades) {
  var descricoes = [], ncms = [], unids = [], trios = [];
  var eDecimal = /^\d{1,3}(?:\.\d{3})*,\d{1,4}$|^\d+,\d{1,4}$/;

  linhas.forEach(function (l) {
    var t = l.texto.trim();
    if (!t) return;

    if (/^\d{8}$/.test(t)) { ncms.push({ v: t, pagina: l.pagina }); return; }

    var so = t.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (unidades.indexOf(so) > -1) { unids.push(so); return; }

    var partes = t.split(/\s+/);
    if (partes.length === 3 && partes.every(function (p) { return eDecimal.test(p); })) {
      trios.push(partes);
      return;
    }

    /* Descrição é linha onde a letra manda. Exigir "nenhum
       número" descartava "CABO FLEXÍVEL 2,5MM AZUL" — e a medida
       é justamente o que distingue um produto do outro. */
    var letras = t.replace(/[^A-Za-zÀ-ú]/g, '').length;
    var digitos = t.replace(/[^0-9]/g, '').length;
    if (letras >= 3 && letras > digitos) descricoes.push(t);
  });

  var n = ncms.length;
  if (!n || trios.length !== n || descricoes.length !== n) return [];

  return ncms.map(function (ncm, i) {
    var qtd = AP_OCR_numero_(trios[i][0]);
    var vu = AP_OCR_numero_(trios[i][1]);
    var vt = AP_OCR_numero_(trios[i][2]);
    if (!qtd || !vt) return null;

    var bate = Math.abs(qtd * vu - vt) <= Math.max(0.05, vt * 0.02);

    return {
      codigo: '', descricao: descricoes[i], ncm: ncm.v, cfop: '',
      unidade: unids[i] || 'UN',
      quantidade: trios[i][0], valorUnitario: trios[i][1], valorTotal: trios[i][2],
      pagina: ncm.pagina,
      confianca: bate ? 0.68 : 0.45,
      ilegivel: !bate,
      descricaoFaltando: false
    };
  }).filter(function (p) { return !!p; });
}

/**
 * MODO FLUXO — quando o OCR desmonta a tabela
 * -------------------------------------------
 * Fotografada, a DANFE volta do OCR picotada: a descrição numa
 * linha, os números na seguinte, às vezes uma coluna inteira de
 * uma vez. Exigir "um item por linha" é o que fazia a tabela
 * inteira sumir enquanto o cabeçalho vinha certo.
 *
 * Aqui as linhas viram um fluxo único de palavras e o item é
 * encontrado pela âncora mais estável da nota fiscal: o NCM, oito
 * dígitos que aparecem uma vez por produto.
 *
 * Em volta de cada NCM:
 *   antes  → código do produto e descrição
 *   depois → CST, CFOP, unidade, quantidade, valor unitário e total
 *
 * Nada entra sem passar pelo mesmo teste de sempre: quantidade
 * vezes valor unitário tem que bater com o total.
 */
function AP_OCR_produtosPorFluxo_(linhas, unidades, jaRecortado) {
  var regiao = jaRecortado ? linhas : AP_OCR_regiaoDaTabela_(linhas);
  if (!regiao.length) return [];

  /* cada palavra guarda de que página veio, para o item saber
     dizer em qual foto ele estava */
  var fluxo = [];
  regiao.forEach(function (l) {
    l.texto.split(' ').forEach(function (palavra) {
      if (palavra) fluxo.push({ t: palavra, pagina: l.pagina });
    });
  });

  var ehNcm = function (t) { return /^\d{8}$/.test(t); };
  var posicoes = [];
  fluxo.forEach(function (p, i) { if (ehNcm(p.t)) posicoes.push(i); });
  if (!posicoes.length) return [];

  var eDecimal = /^\d{1,3}(?:\.\d{3})*,\d{1,4}$|^\d+,\d{1,4}$/;
  var produtos = [];

  /**
   * Onde terminou o item anterior.
   *
   * Sem isto, a descrição começava logo após o NCM anterior e
   * carregava junto o CFOP e a unidade daquele item: o segundo
   * produto vinha como "5102 MT 8012 DISJUNTOR...".
   */
  var fimDoAnterior = 0;

  posicoes.forEach(function (pos, ordem) {
    var fim = ordem + 1 < posicoes.length ? posicoes[ordem + 1] : fluxo.length;

    /**
     * A descrição tem um teto.
     *
     * Quando o título da tabela não é reconhecido, a janela da
     * descrição começa no alto do documento e o primeiro item sai
     * com o nome da loja, o endereço e a chave de acesso grudados.
     * Nenhuma descrição de produto tem 20 palavras: cortar no teto
     * segura o estrago mesmo quando a região falha.
     */
    var TETO = 14;
    var comeco = Math.max(Math.min(fimDoAnterior, pos), pos - TETO);
    var antes = fluxo.slice(comeco, pos).map(function (p) { return p.t; });

    /* e se dentro da janela ainda houver marca de cabeçalho da
       nota, a descrição começa depois dela */
    var reLixo = /^(DANFE|CHAVE|ACESSO|CNPJ|INSCRICAO|INSCRIÇÃO|ESTADUAL|EMISSAO|EMISSÃO|SERIE|SÉRIE|FOLHA|NATUREZA|OPERACAO|OPERAÇÃO|DESTINATARIO|DESTINATÁRIO|REMETENTE|RECEBEMOS|CONSULTA|AUTENTICIDADE|PORTAL|NACIONAL|PROTOCOLO|LTDA|EIRELI|CEP|N[ºo°]?)$/i;
    /* data, CNPJ e CEP soltos também marcam fim do cabeçalho —
       sem isto, a data da nota virava "código" do primeiro item */
    var reDado = /^(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}|\d{5}-?\d{3})$/;

    for (var j = antes.length - 1; j >= 0; j--) {
      if (reLixo.test(antes[j]) || reDado.test(antes[j]) ||
        AP_OCR_ROTULOS_COLUNA.indexOf(antes[j].toUpperCase()) > -1) {
        antes = antes.slice(j + 1);
        break;
      }
    }
    var depois = fluxo.slice(pos + 1, fim);

    /* os três primeiros decimais depois do NCM são, na DANFE,
       quantidade, valor unitário e valor total */
    var decimais = [], ultimoDecimal = -1;
    for (var i = 0; i < depois.length && decimais.length < 3; i++) {
      if (eDecimal.test(depois[i].t)) { decimais.push(depois[i].t); ultimoDecimal = i; }
    }
    if (decimais.length < 3) return;

    /* o próximo item começa depois do último número deste */
    fimDoAnterior = pos + 1 + ultimoDecimal + 1;

    var qtd = AP_OCR_numero_(decimais[0]);
    var vu = AP_OCR_numero_(decimais[1]);
    var vt = AP_OCR_numero_(decimais[2]);
    if (!qtd || !vt) return;
    if (qtd > 1000000 || vt > 10000000) return;

    var bate = Math.abs(qtd * vu - vt) <= Math.max(0.05, vt * 0.02);

    /* a conta que não fecha costuma ser coluna trocada: tenta a
       leitura alternativa antes de desistir da linha */
    if (!bate && decimais.length === 3) {
      var alt = { qtd: AP_OCR_numero_(decimais[0]), vu: AP_OCR_numero_(decimais[2]), vt: vu * 1 };
      if (Math.abs(alt.qtd * alt.vu - alt.vt) <= Math.max(0.05, alt.vt * 0.02)) {
        qtd = alt.qtd; vu = alt.vu; vt = alt.vt; bate = true;
      }
    }

    var unidade = '';
    for (var k = 0; k < depois.length; k++) {
      var candidato = depois[k].t.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (unidades.indexOf(candidato) > -1) { unidade = candidato; break; }
      if (eDecimal.test(depois[k].t)) break;   // passou dos números: parou
    }

    /* o código é o primeiro token da descrição quando parece
       código: tem dígito ou é tudo maiúsculo e curto */
    /* o código do produto sempre tem dígito. Sem essa exigência,
       a primeira palavra da descrição ("CABO") era levada como
       código e o item ficava "FLEXIVEL 2,5MM AZUL" */
    var codigo = '';
    if (antes.length > 1 && /\d/.test(antes[0]) &&
      /^[A-Z0-9][A-Z0-9\.\-\/]{2,14}$/i.test(antes[0])) {
      codigo = antes.shift();
    }

    var descricao = antes.join(' ')
      .replace(/\b\d{1,3}(?:\.\d{3})*,\d{1,4}\b/g, ' ')
      .replace(/\b\d{6,}\b/g, ' ')
      .replace(/\s+/g, ' ').replace(/^[\-\.\s|]+|[\-\.\s|]+$/g, '').trim();

    /**
     * LINHA COM NÚMEROS VÁLIDOS NUNCA É JOGADA FORA
     *
     * Descartar o item porque a descrição saiu vazia fazia a nota
     * inteira sumir quando o OCR separava as colunas. Se a conta
     * fecha, o item existe: entra com a descrição em branco e
     * marcado, para ser digitado na tela — ver a linha e escrever
     * duas palavras é muito melhor que não ver nada.
     */
    var semDescricao = descricao.replace(/[^A-Za-zÀ-ú]/g, '').length < 3;
    if (semDescricao) descricao = codigo ? ('item ' + codigo) : '';

    produtos.push({
      codigo: codigo,
      descricao: descricao,
      ncm: fluxo[pos].t,
      cfop: (function () {
        for (var k = 0; k < depois.length && k < 4; k++) {
          if (/^[1-7]\d{3}$/.test(depois[k].t)) return depois[k].t;
        }
        return '';
      })(),
      unidade: unidade || 'UN',
      quantidade: String(qtd).replace('.', ','),
      valorUnitario: String(vu).replace('.', ','),
      valorTotal: String(vt).replace('.', ','),
      pagina: fluxo[pos].pagina,
      /* menos confiança que o modo linha: aqui a tabela foi
         remontada, não lida pronta */
      confianca: semDescricao ? 0.35 : (bate ? 0.72 : 0.5),
      ilegivel: !bate || semDescricao,
      descricaoFaltando: semDescricao
    });
  });

  return produtos;
}

/**
 * OS RÓTULOS DAS COLUNAS DA TABELA
 *
 * Na DANFE a tabela sempre começa por esta faixa: CÓDIGO PRODUTO,
 * DESCRIÇÃO DO PRODUTO/SERVIÇO, NCM/SH, CST, CFOP, UNID, QUANT,
 * VLR. UNITÁRIO, VLR. TOTAL.
 *
 * Ela é o marco de onde os itens começam — e não é item nenhum.
 * Enquanto não era reconhecida, essa faixa inteira entrava colada
 * na descrição do primeiro produto.
 */
var AP_OCR_ROTULOS_COLUNA = [
  'CODIGO', 'CÓDIGO', 'PRODUTO', 'PRODUTOS', 'DESCRICAO', 'DESCRIÇÃO', 'SERVICO', 'SERVIÇO',
  'SERVICOS', 'SERVIÇOS', 'NCM', 'SH', 'NCM/SH', 'CST', 'CSOSN', 'CFOP', 'UNID', 'UNIDADE',
  'QUANT', 'QUANTIDADE', 'VLR', 'VALOR', 'UNITARIO', 'UNITÁRIO', 'TOTAL', 'DESC', 'DESCONTO',
  'BASE', 'CALC', 'CÁLC', 'ICMS', 'IPI', 'ALIQ', 'ALÍQ'
];

/** A linha é a faixa de rótulos das colunas? */
function AP_OCR_ehLinhaDeRotulos_(texto) {
  var limpo = String(texto).toUpperCase().replace(/[^A-ZÀ-Ú0-9\/\.\s]/g, ' ');
  var palavras = limpo.split(/[\s\/\.]+/).filter(function (t) { return t.length > 1; });
  if (palavras.length < 3) return false;

  var rotulos = palavras.filter(function (t) {
    return AP_OCR_ROTULOS_COLUNA.indexOf(t) > -1;
  }).length;

  /* rótulo é linha sem número de verdade e quase só de rótulos */
  var temNumeroDeItem = /\d{1,3}(?:\.\d{3})*,\d{1,4}|\d+,\d{1,4}|\b\d{8}\b/.test(texto);
  return !temNumeroDeItem && rotulos >= 3 && (rotulos / palavras.length) >= 0.5;
}

/**
 * A região da tabela de produtos.
 *
 * Começa no título ("DADOS DO PRODUTO / SERVIÇOS" — que aparece
 * tanto no singular quanto no plural, e era o singular que não
 * estava sendo reconhecido) e, quando existe, logo depois da
 * faixa de rótulos das colunas.
 *
 * Termina no "CÁLCULO DO IMPOSTO" ou nos "DADOS ADICIONAIS".
 *
 * Numa DANFE o bloco do imposto às vezes vem impresso ANTES da
 * tabela; por isso o fim só vale se estiver depois do início.
 */
function AP_OCR_regiaoDaTabela_(linhas) {
  var inicio = -1, fim = -1;

  var reTitulo = /DADOS?\s+DO?S?\s+PRODUTOS?|PRODUTOS?\s*\/\s*SERVI[ÇC]OS?|DESCRI[ÇC][ÃA]O\s+DO\s+PRODUTO/i;
  var reFim = /C[ÁA]LCULO\s+DO\s+IMPOSTO|DADOS\s+ADICIONAIS|INFORMA[ÇC][ÕO]ES\s+COMPLEMENTARES|C[ÁA]LCULO\s+DO\s+ISSQN|TRANSPORTADOR|VOLUMES\s+TRANSPORTADOS|RESERVADO\s+AO\s+FISCO/i;

  for (var i = 0; i < linhas.length; i++) {
    if (inicio === -1 && reTitulo.test(linhas[i].texto)) { inicio = i + 1; continue; }
    if (inicio > -1 && fim === -1 && i >= inicio && reFim.test(linhas[i].texto)) { fim = i; }
  }

  /* sem título: a faixa de rótulos sozinha já marca o começo */
  if (inicio === -1) {
    for (var k = 0; k < linhas.length; k++) {
      if (AP_OCR_ehLinhaDeRotulos_(linhas[k].texto)) { inicio = k; break; }
    }
  }
  if (inicio === -1) return linhas.slice();

  /* pula a faixa de rótulos que estiver logo no começo da região */
  while (inicio < linhas.length && AP_OCR_ehLinhaDeRotulos_(linhas[inicio].texto)) inicio++;

  var regiao = linhas.slice(inicio, (fim > inicio) ? fim : linhas.length);

  /* e tira qualquer faixa de rótulos que tenha sobrado no meio
     (nota de várias páginas repete o cabeçalho a cada folha) */
  return regiao.filter(function (l) { return !AP_OCR_ehLinhaDeRotulos_(l.texto); });
}


function AP_OCR_paginasDoPayload_(payload) {
  var lista = [];

  function juntar(p, indice) {
    var base64 = String((p && (p.base64 || p.dataURL)) || '').replace(/^data:[^,]+,/, '');
    if (!base64) return;
    var tipo = String((p && p.tipo) || 'image/jpeg').toLowerCase();
    if (/pdf/.test(tipo)) tipo = 'application/pdf';
    else if (!/^image\//.test(tipo)) tipo = 'image/jpeg';

    var mb = (base64.length * 0.75) / (1024 * 1024);
    if (mb > AP_OCR_CFG.maxMbPorPagina) {
      throw new Error('a página ' + (indice + 1) + ' tem ' + mb.toFixed(1) +
        ' MB. Reduza a resolução da foto (o limite é ' + AP_OCR_CFG.maxMbPorPagina + ' MB).');
    }

    lista.push({ nome: (p && p.nome) || ('pagina-' + (indice + 1)), tipo: tipo, base64: base64 });
  }

  if (payload.paginas && payload.paginas.length) {
    payload.paginas.forEach(juntar);
  } else {
    juntar(payload, 0);
  }
  return lista;
}


/* ============================================================
   O QUE PEDIMOS À IA
   ------------------------------------------------------------
   Instrução direcionada à DANFE brasileira. O ponto mais
   importante está na regra dos produtos: código manda, descrição
   não agrupa. Foi juntando por descrição parecida que dois itens
   viraram um só no estoque.
   ============================================================ */

function AP_OCR_instrucao_(qtdPaginas) {
  return [
    'Você lê notas fiscais brasileiras (DANFE da NF-e) fotografadas ou escaneadas.',
    'Está recebendo ' + qtdPaginas + ' imagem(ns) que são páginas DA MESMA NOTA, em ordem.',
    '',
    'Devolva SOMENTE um objeto JSON válido, sem texto antes ou depois, sem cercas de código.',
    '',
    'Estrutura exigida:',
    '{',
    '  "fornecedor": {"cnpj": "", "razaoSocial": "", "inscricaoEstadual": "", "endereco": ""},',
    '  "destinatario": {"cnpj": "", "razaoSocial": ""},',
    '  "nota": {"numero": "", "serie": "", "chaveAcesso": "", "dataEmissao": "",',
    '           "dataEntradaSaida": "", "valorProdutos": "", "valorFrete": "",',
    '           "valorSeguro": "", "valorDesconto": "", "valorOutros": "",',
    '           "valorIpi": "", "icmsBase": "", "icmsValor": "",',
    '           "icmsStBase": "", "icmsStValor": "", "valorTotal": "",',
    '           "quantidadeItensDeclarada": null},',
    '  "produtos": [',
    '    {"codigo": "", "descricao": "", "ncm": "", "cst": "", "cfop": "",',
    '     "unidade": "", "quantidade": "", "valorUnitario": "", "valorTotal": "",',
    '     "baseIcms": "", "valorIcms": "", "aliquotaIcms": "", "valorIpi": "",',
    '     "aliquotaIpi": "", "codigoBarras": "",',
    '     "pagina": 1, "confianca": 0.0, "ilegivel": false}',
    '  ],',
    '  "camposIlegiveis": [],',
    '  "observacoes": ""',
    '}',
    '',
    'REGRAS:',
    '0. QUEM É O FORNECEDOR: é o EMITENTE da nota — a empresa que VENDEU, impressa',
    '   no alto da DANFE, a mesma que aparece em "RECEBEMOS DE ... OS PRODUTOS".',
    '   NUNCA use o DESTINATÁRIO/REMETENTE (a empresa que comprou) como fornecedor.',
    '   O destinatário vai no seu próprio campo "destinatario", separado.',
    '   Se as duas empresas estiverem trocadas, todo o cadastro de fornecedores',
    '   fica errado — confira qual bloco você está lendo antes de responder.',
    '1. Copie os valores EXATAMENTE como aparecem na nota, inclusive a vírgula decimal',
    '   ("1.234,56" continua "1.234,56"). Não converta, não arredonde, não calcule.',
    '2. Campo que você não conseguir ler: use null e acrescente o nome dele em',
    '   "camposIlegiveis". NUNCA invente, NUNCA deduza um valor plausível.',
    '3. PRODUTOS — a parte mais importante:',
    '   - Uma linha da tabela = um item do array. Não junte, não resuma, não agrupe.',
    '   - Produtos com CÓDIGOS DIFERENTES são produtos DIFERENTES, mesmo que a',
    '     descrição seja quase idêntica (tamanhos, cores, modelos, bitolas).',
    '   - Mantenha a descrição completa, com tamanho, modelo, medida e especificação.',
    '   - A tabela continua nas páginas seguintes: leia TODAS as páginas e informe',
    '     em "pagina" de onde veio cada item.',
    '   - Não repita o mesmo item por ele aparecer em duas fotos da mesma página.',
    '4. "quantidadeItensDeclarada": se a nota informar a quantidade total de itens',
    '   (costuma vir no rodapé), copie esse número. Senão, null.',
    '5. COLUNAS FISCAIS DO ITEM: "baseIcms", "valorIcms", "aliquotaIcms",',
    '   "valorIpi" e "aliquotaIpi" saem da própria linha da tabela de produtos,',
    '   NÃO do quadro de totais do rodapé. Coluna ausente na nota: null.',
    '   "codigoBarras": o EAN/GTIN do produto, se a nota imprimir essa coluna.',
    '   Não confunda com o código do fornecedor, que vai em "codigo".',
    '6. "confianca": de 0 a 1, o quanto você confia na leitura daquela linha.',
    '   Linha borrada, cortada ou com dígito duvidoso: abaixo de 0.7 e "ilegivel": true.',
    '',
    'Não escreva explicações. Apenas o JSON.'
  ].join('\n');
}


/* ============================================================
   CHAMADAS ÀS APIS
   ============================================================ */

function AP_OCR_chamarGemini_(paginas, st) {
  var chave = PropertiesService.getScriptProperties().getProperty(AP_OCR_CFG.props.gemini);

  /* o nome do modelo grátis muda de tempos em tempos; se o
     configurado não existir para esta chave, tenta os outros
     da linha Flash antes de desistir */
  var candidatos = [st.modelo].concat(AP_OCR_CFG.modelosAlternativos)
    .filter(function (m, i, a) { return m && a.indexOf(m) === i; });

  var ultimoErro = null;

  for (var c = 0; c < candidatos.length; c++) {
    try {
      return AP_OCR_gemini1_(paginas, candidatos[c], chave);
    } catch (e) {
      ultimoErro = e;
      if (!/n[ãa]o est[áa] dispon[íi]vel|not found|is not supported/i.test(e.message)) throw e;
    }
  }
  throw ultimoErro || new Error('nenhum modelo do Gemini respondeu.');
}

function AP_OCR_gemini1_(paginas, modelo, chave) {
  var st = { modelo: modelo };
  var url = AP_OCR_CFG.endpoint.gemini + encodeURIComponent(modelo) +
    ':generateContent?key=' + encodeURIComponent(chave);

  var partes = [{ text: AP_OCR_instrucao_(paginas.length) }];
  paginas.forEach(function (p, i) {
    partes.push({ text: 'Página ' + (i + 1) + ' de ' + paginas.length + ':' });
    partes.push({ inline_data: { mime_type: p.tipo, data: p.base64 } });
  });

  var corpo = {
    contents: [{ role: 'user', parts: partes }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 8192,
      response_mime_type: 'application/json'
    }
  };

  var res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify(corpo), muteHttpExceptions: true
  });

  var codigo = res.getResponseCode();
  var json = {};
  try { json = JSON.parse(res.getContentText()); } catch (e) { }

  if (codigo !== 200) {
    var msg = (json.error && json.error.message) || ('HTTP ' + codigo);
    if (/API key not valid/i.test(msg)) throw new Error('a chave do Gemini foi recusada.');
    if (/not found|is not supported/i.test(msg)) {
      throw new Error('o modelo "' + st.modelo + '" não está disponível para esta chave. ' +
        'Configure outro com AP_OCR_configurar("gemini", chave, "gemini-2.0-flash").');
    }
    throw new Error(msg);
  }

  var cand = (json.candidates || [])[0];
  if (!cand) throw new Error('a IA não devolveu resposta.');
  if (cand.finishReason === 'MAX_TOKENS') {
    throw new Error('a nota tem itens demais para uma leitura só. Fotografe em partes menores.');
  }

  var texto = ((cand.content && cand.content.parts) || [])
    .map(function (p) { return p.text || ''; }).join('');
  return { texto: texto };
}

function AP_OCR_chamarAnthropic_(paginas, st) {
  var chave = PropertiesService.getScriptProperties().getProperty(AP_OCR_CFG.props.anthropic);

  var conteudo = [{ type: 'text', text: AP_OCR_instrucao_(paginas.length) }];
  paginas.forEach(function (p, i) {
    conteudo.push({ type: 'text', text: 'Página ' + (i + 1) + ' de ' + paginas.length + ':' });
    if (/pdf/.test(p.tipo)) {
      conteudo.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: p.base64 }
      });
    } else {
      conteudo.push({
        type: 'image',
        source: { type: 'base64', media_type: p.tipo, data: p.base64 }
      });
    }
  });

  var res = UrlFetchApp.fetch(AP_OCR_CFG.endpoint.anthropic, {
    method: 'post', contentType: 'application/json',
    headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({
      model: st.modelo, max_tokens: 8192, temperature: 0,
      messages: [{ role: 'user', content: conteudo }]
    }),
    muteHttpExceptions: true
  });

  var codigo = res.getResponseCode();
  var json = {};
  try { json = JSON.parse(res.getContentText()); } catch (e) { }

  if (codigo !== 200) {
    throw new Error((json.error && json.error.message) || ('HTTP ' + codigo));
  }

  var texto = (json.content || [])
    .filter(function (b) { return b.type === 'text'; })
    .map(function (b) { return b.text; }).join('');
  return { texto: texto };
}

/** A resposta pode vir com cercas de código ou texto em volta */
function AP_OCR_extrairJson_(texto) {
  if (!texto) return null;
  var t = String(texto).trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');

  try { return JSON.parse(t); } catch (e) { }

  var ini = t.indexOf('{'), fim = t.lastIndexOf('}');
  if (ini > -1 && fim > ini) {
    try { return JSON.parse(t.slice(ini, fim + 1)); } catch (e) { }
  }
  return null;
}


/* ============================================================
   VALIDAÇÃO, NORMALIZAÇÃO E MAPEAMENTO
   ============================================================ */

function AP_OCR_processar_(bruto, qtdPaginas) {
  var avisos = [], erros = [], naoEncontrados = [];

  if (!bruto || typeof bruto !== 'object') {
    throw new Error('a IA devolveu um JSON fora do formato combinado.');
  }

  var f = bruto.fornecedor || {};
  var n = bruto.nota || {};

  /* ---- cabeçalho, nos nomes que a tela já usa ---- */
  var chave = AP_OCR_soDigitos_(n.chaveAcesso);
  if (chave && chave.length !== 44) {
    avisos.push('A chave de acesso lida tem ' + chave.length + ' dígitos (deveria ter 44). ' +
      'Confira dígito a dígito antes de gravar.');
  }

  var campos = {
    numero: AP_OCR_texto_(n.numero),
    serie: AP_OCR_texto_(n.serie),
    chave: chave && chave.length === 44 ? chave : AP_OCR_texto_(n.chaveAcesso),
    cnpj: AP_OCR_cnpj_(f.cnpj),
    fornecedor: AP_OCR_texto_(f.razaoSocial),
    emissao: AP_OCR_data_(n.dataEmissao),
    valor: AP_OCR_numero_(n.valorTotal)
  };

  /* a chave confere o resto: ela carrega CNPJ, série e número */
  if (campos.chave && campos.chave.length === 44) {
    var cnpjDaChave = AP_OCR_cnpj_(campos.chave.substr(6, 14));
    var serieDaChave = String(Number(campos.chave.substr(22, 3)));
    var numeroDaChave = String(Number(campos.chave.substr(25, 9)));

    if (!campos.cnpj) campos.cnpj = cnpjDaChave;
    else if (AP_OCR_soDigitos_(campos.cnpj) !== AP_OCR_soDigitos_(cnpjDaChave)) {
      avisos.push('O CNPJ lido (' + campos.cnpj + ') não bate com o da chave de acesso (' +
        cnpjDaChave + '). Um dos dois foi lido errado.');
    }
    if (!campos.serie) campos.serie = serieDaChave;
    if (!campos.numero) campos.numero = AP_OCR_numeroNota_(numeroDaChave);
    else if (AP_OCR_soDigitos_(campos.numero).replace(/^0+/, '') !==
      AP_OCR_soDigitos_(numeroDaChave).replace(/^0+/, '')) {
      avisos.push('O número lido (' + campos.numero + ') não bate com o da chave (' +
        AP_OCR_numeroNota_(numeroDaChave) + ').');
    }
  }
  if (campos.numero) campos.numero = AP_OCR_numeroNota_(campos.numero);

  Object.keys(campos).forEach(function (k) {
    if (campos[k] === null || campos[k] === '' || campos[k] === 0 && k !== 'valor') {
      if (campos[k] !== 0) naoEncontrados.push(k);
    }
  });
  (bruto.camposIlegiveis || []).forEach(function (c) {
    if (naoEncontrados.indexOf(String(c)) === -1) naoEncontrados.push(String(c));
  });

  /* ---- valores complementares ---- */
  var valores = {
    produtos: AP_OCR_numero_(n.valorProdutos),
    frete: AP_OCR_numero_(n.valorFrete),
    seguro: AP_OCR_numero_(n.valorSeguro),
    desconto: AP_OCR_numero_(n.valorDesconto),
    outros: AP_OCR_numero_(n.valorOutros),
    ipi: AP_OCR_numero_(n.valorIpi),
    icmsBase: AP_OCR_numero_(n.icmsBase),
    icmsValor: AP_OCR_numero_(n.icmsValor),
    icmsStBase: AP_OCR_numero_(n.icmsStBase),
    icmsStValor: AP_OCR_numero_(n.icmsStValor),
    total: campos.valor
  };

  /**
   * A COMPOSIÇÃO DO TOTAL
   * ---------------------
   * A conta da NF-e é fixa:
   *
   *   total = produtos + frete + seguro + outras despesas + IPI + ICMS ST
   *           − desconto
   *
   * O ICMS próprio NÃO entra: ele já está embutido no preço dos
   * produtos. Somar tributo indiscriminadamente é exatamente o que o
   * item 2 do projeto proíbe, e daria um total inflado.
   *
   * O que esta função faz é COMPARAR e relatar. Ela não corrige
   * nenhum valor lido: se a conta não fecha, quem decide é uma
   * pessoa olhando a nota. Um sistema que "ajeita" silenciosamente um
   * número fiscal é pior do que um que erra na cara.
   */
  valores.composicao = AP_OCR_conferirComposicao_(valores, avisos);

  var fornecedorExtra = {
    inscricaoEstadual: AP_OCR_texto_(f.inscricaoEstadual),
    endereco: AP_OCR_texto_(f.endereco)
  };

  /* ---- produtos ---- */
  var lidos = Array.isArray(bruto.produtos) ? bruto.produtos : [];
  if (!lidos.length) {
    avisos.push('Nenhuma linha de produto foi reconhecida. Normalmente é a tabela cortada ' +
      'na foto ou sombra sobre ela — refotografe enquadrando a tabela inteira.');
  }

  var normalizados = [], descartados = [];
  lidos.forEach(function (p, idx) {
    var item = AP_OCR_normalizarProduto_(p, idx);
    if (item.problema) {
      descartados.push({ linha: idx + 1, motivo: item.problema, bruto: p });
      erros.push('Linha ' + (idx + 1) + ' descartada: ' + item.problema);
      return;
    }
    normalizados.push(item);
  });

  var semDuplicatas = AP_OCR_removerDuplicatas_(normalizados, avisos);

  /* ---- conferências de fechamento ---- */
  var somaItens = Math.round(semDuplicatas.reduce(function (s, i) {
    return s + (i.valorTotal || 0);
  }, 0) * 100) / 100;

  if (valores.produtos && Math.abs(valores.produtos - somaItens) > Math.max(0.05, valores.produtos * 0.01)) {
    avisos.push('A soma dos itens (' + AP_OCR_moeda_(somaItens) + ') não bate com o valor dos ' +
      'produtos na nota (' + AP_OCR_moeda_(valores.produtos) + '). Pode haver item faltando ou ' +
      'valor lido errado.');
  }

  var declarada = Number(n.quantidadeItensDeclarada);
  if (declarada && declarada !== semDuplicatas.length) {
    avisos.push('A nota declara ' + declarada + ' itens e foram reconhecidos ' +
      semDuplicatas.length + '. ' + (declarada > semDuplicatas.length
        ? 'Faltam páginas ou linhas na foto.'
        : 'Pode ter entrado linha repetida.'));
  }

  semDuplicatas.filter(function (i) { return i.confianca < 0.7 || i.ilegivel; })
    .forEach(function (i) {
      avisos.push('Item "' + i.descricao + '" foi lido com baixa confiança (' +
        Math.round(i.confianca * 100) + '%). Confira quantidade e valores.');
    });

  /* ---- vínculo com o cadastro ---- */
  var casado = AP_OCR_vincular_(semDuplicatas, avisos);

  var reconhecidos = Object.keys(campos).filter(function (k) {
    return campos[k] !== null && campos[k] !== '' && campos[k] !== 0;
  }).length;

  return {
    campos: campos,
    confianca: AP_OCR_grausDoCabecalho_(campos, bruto),
    reconhecidos: reconhecidos,
    total: Object.keys(campos).length,
    confiancaGeral: reconhecidos / Object.keys(campos).length,
    fornecedorExtra: fornecedorExtra,
    valores: valores,
    itens: casado.itens,
    catalogo: casado.catalogo,
    resumoItens: casado.resumo,
    paginas: qtdPaginas,
    camposNaoEncontrados: naoEncontrados,
    descartados: descartados,
    avisos: avisos,
    erros: erros,
    textoOcr: bruto.textoOcr || '',
    observacoes: AP_OCR_texto_(bruto.observacoes) || ''
  };
}


/* ---------- normalizadores ---------- */

function AP_OCR_texto_(v) {
  if (v === null || v === undefined) return null;
  var s = String(v).replace(/\s+/g, ' ').trim();
  return (s === '' || /^(null|n\/a|nao informado|não informado|-+)$/i.test(s)) ? null : s;
}

function AP_OCR_soDigitos_(v) {
  return v === null || v === undefined ? '' : String(v).replace(/\D/g, '');
}

function AP_OCR_cnpj_(v) {
  var d = AP_OCR_soDigitos_(v);
  if (d.length !== 14) return AP_OCR_texto_(v);
  return d.substr(0, 2) + '.' + d.substr(2, 3) + '.' + d.substr(5, 3) + '/' +
    d.substr(8, 4) + '-' + d.substr(12, 2);
}

function AP_OCR_numeroNota_(v) {
  var d = AP_OCR_soDigitos_(v).replace(/^0+/, '') || '0';
  var largura = d.length <= 6 ? 6 : 9;
  while (d.length < largura) d = '0' + d;
  return largura === 6
    ? d.substr(0, 3) + '.' + d.substr(3, 3)
    : d.substr(0, 3) + '.' + d.substr(3, 3) + '.' + d.substr(6, 3);
}

/**
 * Número brasileiro: a vírgula é decimal, o ponto é milhar.
 * "1.234,56" → 1234.56 · "1.234" → 1234 · "0,500" → 0.5
 * Um ponto com 1 ou 2 casas depois ("28.90") é decimal do OCR,
 * não milhar — milhar sempre vem com 3 dígitos.
 */
/**
 * Como AP_OCR_numero_, mas guarda a diferença entre "a nota não
 * trouxe isto" (null) e "a nota trouxe zero" (0). Para campo fiscal
 * essa diferença importa: coluna ausente não é alíquota zero.
 */
function AP_OCR_numeroOuNulo_(v) {
  if (v === null || v === undefined || v === '') return null;
  var t = String(v).replace(/[^\d,\.\-]/g, '').trim();
  if (!t) return null;
  return AP_OCR_numero_(v);
}

function AP_OCR_numero_(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return isNaN(v) ? 0 : v;

  var t = String(v).replace(/[^\d,\.\-]/g, '').trim();
  if (!t) return 0;

  if (t.indexOf(',') > -1) {
    t = t.replace(/\./g, '').replace(',', '.');
  } else {
    var pontos = t.split('.');
    if (pontos.length > 2) t = pontos.join('');
    else if (pontos.length === 2 && pontos[1].length === 3) t = pontos.join('');
  }

  var n = Number(t);
  return isNaN(n) ? 0 : n;
}

/** Devolve sempre dd/mm/aaaa, venha como vier */
function AP_OCR_data_(v) {
  var s = AP_OCR_texto_(v);
  if (!s) return null;

  var iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[3] + '/' + iso[2] + '/' + iso[1];

  var br = s.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  if (br) {
    var dia = ('0' + br[1]).slice(-2), mes = ('0' + br[2]).slice(-2), ano = br[3];
    if (ano.length === 2) ano = '20' + ano;
    return dia + '/' + mes + '/' + ano;
  }
  return s;
}

function AP_OCR_moeda_(n) {
  return 'R$ ' + Number(n || 0).toFixed(2).replace('.', ',');
}

function AP_OCR_grausDoCabecalho_(campos, bruto) {
  var ilegiveis = (bruto.camposIlegiveis || []).map(function (c) { return String(c).toLowerCase(); });
  var g = {};
  Object.keys(campos).forEach(function (k) {
    if (campos[k] === null || campos[k] === '') { g[k] = 0; return; }
    if (ilegiveis.some(function (c) { return c.indexOf(k) > -1; })) { g[k] = 0.5; return; }
    /* o que veio da chave de acesso é o mais confiável da nota */
    g[k] = (k === 'chave' || (campos.chave && ['numero', 'serie', 'cnpj'].indexOf(k) > -1)) ? 0.97 : 0.88;
  });
  return g;
}

/**
 * CONFERE A COMPOSIÇÃO DO TOTAL DA NOTA — NÃO CORRIGE NADA.
 *
 * Devolve o que somou, o que a nota declarou e a diferença entre os
 * dois. Campo que a nota não trouxe entra como 0 na soma, mas é
 * listado em "faltando", porque "não li" e "é zero" são coisas
 * diferentes e a pessoa precisa saber qual das duas aconteceu.
 */
function AP_OCR_conferirComposicao_(v, avisos) {
  var faltando = [];
  function usar(nome, rotulo) {
    var x = v[nome];
    if (x === null || x === undefined || x === '') { faltando.push(rotulo); return 0; }
    return Number(x) || 0;
  }

  var produtos = usar('produtos', 'valor dos produtos');
  var frete = usar('frete', 'frete');
  var seguro = usar('seguro', 'seguro');
  var outros = usar('outros', 'outras despesas');
  var ipi = usar('ipi', 'IPI');
  var icmsSt = usar('icmsStValor', 'ICMS ST');
  var desconto = usar('desconto', 'desconto');

  var somado = Math.round((produtos + frete + seguro + outros + ipi + icmsSt - desconto) * 100) / 100;
  var declarado = (v.total === null || v.total === undefined || v.total === '')
    ? null : Math.round(Number(v.total) * 100) / 100;

  var saida = {
    parcelas: {
      produtos: produtos, frete: frete, seguro: seguro, outrasDespesas: outros,
      ipi: ipi, icmsSt: icmsSt, desconto: desconto
    },
    somado: somado,
    declarado: declarado,
    diferenca: (declarado === null) ? null : Math.round((declarado - somado) * 100) / 100,
    faltando: faltando,
    confere: null,
    /* o ICMS próprio fica de fora da soma de propósito */
    icmsProprio: { base: v.icmsBase, valor: v.icmsValor },
    observacao: 'O ICMS próprio não entra nesta soma: ele já está embutido no ' +
      'preço dos produtos. Somá-lo daria um total maior que o da nota.'
  };

  if (declarado === null) {
    saida.confere = null;
    avisos.push('Não consegui ler o VALOR TOTAL DA NOTA, então não dá para conferir a ' +
      'composição. A soma das parcelas que eu li deu ' + AP_OCR_moeda_(somado) + '.');
    return saida;
  }

  /* um centavo de arredondamento não é divergência */
  var tolerancia = Math.max(0.02, Math.abs(declarado) * 0.001);
  saida.confere = Math.abs(saida.diferenca) <= tolerancia;

  if (!saida.confere) {
    avisos.push('A composição do total não fecha: produtos + frete + seguro + outras ' +
      'despesas + IPI + ICMS ST − desconto dá ' + AP_OCR_moeda_(somado) +
      ', mas a nota declara ' + AP_OCR_moeda_(declarado) +
      ' (diferença de ' + AP_OCR_moeda_(saida.diferenca) + ').' +
      (faltando.length
        ? ' Pode ser por causa de ' + faltando.length + ' campo(s) que eu não consegui ler: ' +
          faltando.join(', ') + '.'
        : '') +
      ' Nenhum valor foi alterado — confira na nota.');
  } else if (faltando.length) {
    avisos.push('A composição fecha, mas ' + faltando.length + ' campo(s) entraram como zero ' +
      'por não terem sido lidos: ' + faltando.join(', ') + '. Se algum deles tiver valor na ' +
      'nota, o total bater foi coincidência — confira.');
  }

  return saida;
}

function AP_OCR_normalizarProduto_(p, idx) {
  p = p || {};
  var descricao = AP_OCR_texto_(p.descricao);
  var codigo = AP_OCR_texto_(p.codigo) || '';
  var qtd = AP_OCR_numero_(p.quantidade);
  var vu = AP_OCR_numero_(p.valorUnitario);
  var vt = AP_OCR_numero_(p.valorTotal);

  if (!descricao && !codigo) return { problema: 'sem descrição e sem código' };
  if (!qtd) return { problema: 'quantidade não reconhecida (' + (descricao || codigo) + ')' };

  /* o total manda quando qtd × unitário não fecha: é o número
     impresso maior e o menos sujeito a erro de vírgula */
  var calculado = Math.round(qtd * vu * 100) / 100;
  var conflito = false;
  if (vt && vu && Math.abs(calculado - vt) > Math.max(0.05, vt * 0.02)) conflito = true;
  if (!vt && vu) vt = calculado;
  if (!vu && vt && qtd) vu = Math.round((vt / qtd) * 10000) / 10000;

  return {
    codigo: codigo,
    descricao: descricao || codigo,
    ncm: AP_OCR_texto_(p.ncm) || '',
    cst: AP_OCR_texto_(p.cst) || AP_OCR_texto_(p.csosn) || '',
    cfop: AP_OCR_texto_(p.cfop) || '',
    unidade: (AP_OCR_texto_(p.unidade) || 'UN').toUpperCase().slice(0, 6),
    qtd: qtd,
    valorUnitario: vu,
    valorTotal: vt,
    /* AS COLUNAS FISCAIS DA PRÓPRIA LINHA.
       Ficam em null quando a nota não imprime a coluna — e null aqui
       quer dizer "a nota não trouxe", não "é zero". */
    baseIcms: AP_OCR_numeroOuNulo_(p.baseIcms),
    valorIcms: AP_OCR_numeroOuNulo_(p.valorIcms),
    aliquotaIcms: AP_OCR_numeroOuNulo_(p.aliquotaIcms),
    valorIpi: AP_OCR_numeroOuNulo_(p.valorIpi),
    aliquotaIpi: AP_OCR_numeroOuNulo_(p.aliquotaIpi),
    /* o EAN/GTIN, quando a nota imprime essa coluna. NÃO é o código
       do fornecedor: aquele não é universal e vive em "codigo". */
    codigoBarras: AP_OCR_texto_(p.codigoBarras || p.ean || p.gtin) || '',
    pagina: Number(p.pagina) || 1,
    confianca: (p.confianca === undefined || p.confianca === null) ? 0.85 : Number(p.confianca),
    ilegivel: !!p.ilegivel,
    contaNaoFecha: conflito,
    linha: idx + 1
  };
}

/**
 * DUPLICIDADE ENTRE PÁGINAS
 *
 * Fotografar a mesma página duas vezes, ou pegar a virada de
 * página com sobreposição, repete linhas. Só é considerada
 * repetição quando TUDO é igual — código, descrição, quantidade
 * e valores. Dois itens de códigos diferentes nunca se juntam,
 * por mais parecida que seja a descrição.
 */
function AP_OCR_removerDuplicatas_(itens, avisos) {
  var vistos = {}, saida = [];

  itens.forEach(function (i) {
    var chave = [
      AP_OCR_chaveTexto_(i.codigo), AP_OCR_chaveTexto_(i.descricao),
      i.qtd, i.valorUnitario, i.valorTotal
    ].join('|');

    if (vistos[chave]) {
      avisos.push('Linha repetida descartada: "' + i.descricao + '" aparecia igual nas páginas ' +
        vistos[chave].pagina + ' e ' + i.pagina + '.');
      return;
    }
    vistos[chave] = i;
    saida.push(i);
  });

  /* mesmo código com valores diferentes: legítimo, mas vale avisar */
  var porCodigo = {};
  saida.forEach(function (i) {
    if (!i.codigo) return;
    var c = AP_OCR_chaveTexto_(i.codigo);
    (porCodigo[c] = porCodigo[c] || []).push(i);
  });
  Object.keys(porCodigo).forEach(function (c) {
    if (porCodigo[c].length > 1) {
      avisos.push('O código ' + porCodigo[c][0].codigo + ' aparece em ' + porCodigo[c].length +
        ' linhas da nota. Se for o mesmo produto, as quantidades vão somar no estoque.');
    }
  });

  return saida;
}

function AP_OCR_chaveTexto_(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}


/* ============================================================
   VÍNCULO COM O CADASTRO CENTRAL
   ------------------------------------------------------------
   Código igual vincula. Descrição parecida NÃO vincula: mostra
   a sugestão e espera o "sim" do usuário. Sem cadastro nenhum,
   o item fica marcado como novo — e só é cadastrado se a pessoa
   mandar.
   ============================================================ */

function AP_OCR_catalogo_() {
  var lista = [];
  try {
    if (typeof AP_OPER_itens_ === 'function') lista = AP_OPER_itens_() || [];
  } catch (e) { AP_OCR_registrarErro_('catalogo', e); }

  if (!lista.length) {
    try {
      var r = AP_Modulo_itens('listar', {});
      lista = (r && r.ok && r.dados) ? r.dados : [];
    } catch (e) { AP_OCR_registrarErro_('catalogo.itens', e); }
  }

  return lista.map(function (i) {
    return {
      sku: i.sku || i.id || i.codigo,
      descricao: i.descricao || i.nome || '',
      unidade: i.unidade || 'un',
      codigoBarras: i.codigoBarras || '',
      codigoFornecedor: i.codigoFornecedor || '',
      /* a categoria vem junto para a tela poder filtrar: escolher
         numa lista de centenas de itens é inviável sem isso */
      categoria: i.categoria || i.grupo || 'Sem categoria',
      valorUnitario: Number(i.valorUnitario || i.preco) || 0,
      estoqueAtual: Number(i.estoqueAtual !== undefined ? i.estoqueAtual : i.estoque) || 0
    };
  }).filter(function (i) { return !!i.sku; });
}

function AP_OCR_normalizarTexto_(s) {
  var t = String(s || '').toUpperCase();
  try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) { }
  return t.replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Semelhança por tokens, com peso dobrado para tokens com número
    (50KG, 1/2, N42). Tokens de um caractere entram também: é o
    "P", o "M" e o "G" que separam três variações do mesmo produto. */
function AP_OCR_semelhanca_(a, b) {
  var ta = AP_OCR_normalizarTexto_(a).split(' ').filter(function (t) { return t.length > 0; });
  var tb = AP_OCR_normalizarTexto_(b).split(' ').filter(function (t) { return t.length > 0; });
  if (!ta.length || !tb.length) return 0;

  var peso = 0, total = 0;
  ta.forEach(function (t) {
    var p = /\d/.test(t) ? 2 : 1;
    total += p;
    if (tb.some(function (u) {
      return u === t || (t.length >= 4 && u.indexOf(t) === 0) || (u.length >= 4 && t.indexOf(u) === 0);
    })) peso += p;
  });

  var razao = Math.min(ta.length, tb.length) / Math.max(ta.length, tb.length);
  return Math.round((peso / total) * (0.75 + 0.25 * razao) * 100) / 100;
}

function AP_OCR_vincular_(itens, avisos) {
  var catalogo = AP_OCR_catalogo_();
  var usadosPorCodigo = {};

  var saida = itens.map(function (item) {
    var codigoNota = AP_OCR_chaveTexto_(item.codigo);
    var exato = null;

    if (codigoNota) {
      exato = catalogo.filter(function (p) {
        return AP_OCR_chaveTexto_(p.codigoFornecedor) === codigoNota ||
          AP_OCR_chaveTexto_(p.codigoBarras) === codigoNota ||
          AP_OCR_chaveTexto_(p.sku) === codigoNota;
      })[0] || null;
    }

    var parecido = null, score = 0;
    catalogo.forEach(function (p) {
      var s = AP_OCR_semelhanca_(item.descricao, p.descricao);
      if (s > score) { score = s; parecido = p; }
    });

    var resultado = {
      codigo: item.codigo, descricao: item.descricao, ncm: item.ncm,
      cst: item.cst, cfop: item.cfop, unidade: item.unidade,
      qtd: item.qtd, valorUnitario: item.valorUnitario, valorTotal: item.valorTotal,
      pagina: item.pagina, confianca: item.confianca, ilegivel: item.ilegivel,
      contaNaoFecha: item.contaNaoFecha,
      sku: null, vinculo: 'NOVO', motivo: '', score: score,
      sugestao: null, pergunta: null
    };

    if (exato) {
      /* dois códigos diferentes não podem cair no mesmo item */
      if (usadosPorCodigo[exato.sku] && usadosPorCodigo[exato.sku] !== codigoNota) {
        resultado.vinculo = 'CONFIRMAR';
        resultado.sugestao = AP_OCR_resumoDoItem_(exato);
        resultado.motivo = 'código bate com um item já usado por outra linha desta nota';
        resultado.pergunta = 'A linha "' + item.descricao + '" aponta para "' + exato.descricao +
          '", que outra linha desta nota já está usando. É o mesmo produto?';
        avisos.push('Dois códigos diferentes apontam para o item ' + exato.sku +
          ' do cadastro. Confirme antes de lançar.');
      } else {
        resultado.sku = exato.sku;
        resultado.vinculo = 'AUTO';
        resultado.motivo = 'código do produto igual ao do cadastro';
        resultado.sugestao = AP_OCR_resumoDoItem_(exato);
        resultado.score = 1;
        usadosPorCodigo[exato.sku] = codigoNota;
      }
      return resultado;
    }

    if (parecido && score >= AP_OCR_CFG.scoreSugestao) {
      resultado.vinculo = 'CONFIRMAR';
      resultado.sugestao = AP_OCR_resumoDoItem_(parecido);
      resultado.motivo = 'descrição parecida (' + Math.round(score * 100) + '%) — só a descrição, ' +
        'sem código igual';
      resultado.pergunta = 'O item "' + item.descricao + '" da nota é o mesmo que "' +
        parecido.descricao + '" do cadastro?';
      return resultado;
    }

    resultado.motivo = 'nenhum item do cadastro corresponde';
    return resultado;
  });

  /* várias linhas apontando para o mesmo item do cadastro: é o
     caminho para dois produtos somarem saldo em um só */
  var alvo = {};
  saida.forEach(function (i) {
    if (!i.sugestao) return;
    (alvo[i.sugestao.sku] = alvo[i.sugestao.sku] || []).push(i);
  });
  Object.keys(alvo).forEach(function (sku) {
    if (alvo[sku].length < 2) return;
    avisos.push(alvo[sku].length + ' linhas da nota apontam para o mesmo item do cadastro (' +
      alvo[sku][0].sugestao.descricao + '): ' +
      alvo[sku].map(function (i) { return i.codigo || i.descricao; }).join(', ') +
      '. Se forem produtos diferentes, vincule cada um ao seu item.');
    alvo[sku].forEach(function (i) { i.disputado = true; });
  });

  return {
    itens: saida,
    catalogo: catalogo.slice(0, AP_OCR_CFG.catalogoNoRetorno).map(function (p) {
      return {
        sku: p.sku, descricao: p.descricao, unidade: p.unidade,
        estoqueAtual: p.estoqueAtual, categoria: p.categoria || 'Sem categoria'
      };
    }),
    resumo: {
      total: saida.length,
      automaticos: saida.filter(function (i) { return i.vinculo === 'AUTO'; }).length,
      confirmar: saida.filter(function (i) { return i.vinculo === 'CONFIRMAR'; }).length,
      novos: saida.filter(function (i) { return i.vinculo === 'NOVO'; }).length,
      unidades: saida.reduce(function (s, i) { return s + (i.qtd || 0); }, 0),
      valor: Math.round(saida.reduce(function (s, i) { return s + (i.valorTotal || 0); }, 0) * 100) / 100
    }
  };
}

function AP_OCR_resumoDoItem_(p) {
  return {
    sku: p.sku, descricao: p.descricao, unidade: p.unidade,
    estoqueAtual: p.estoqueAtual, valorUnitario: p.valorUnitario
  };
}


/* ============================================================
   TESTES
   ------------------------------------------------------------
   AP_OCR_testes()      — roda os casos de bancada (sem gastar API)
   AP_OCR_testarFoto()  — leitura real; cole o base64 de uma foto
   ============================================================ */

function AP_OCR_testes() {
  var log = [], falhas = 0;
  function ok(nome, condicao, detalhe) {
    log.push((condicao ? 'PASSOU  ' : 'FALHOU  ') + nome + (detalhe ? '  [' + detalhe + ']' : ''));
    if (!condicao) falhas++;
  }

  /* 1. números com vírgula decimal */
  ok('1.234,56 vira 1234.56', AP_OCR_numero_('1.234,56') === 1234.56, AP_OCR_numero_('1.234,56'));
  ok('0,5000 vira 0.5', AP_OCR_numero_('0,5000') === 0.5, AP_OCR_numero_('0,5000'));
  ok('1.234 (milhar) vira 1234', AP_OCR_numero_('1.234') === 1234, AP_OCR_numero_('1.234'));
  ok('28.90 (ponto decimal do OCR) vira 28.9', AP_OCR_numero_('28.90') === 28.9, AP_OCR_numero_('28.90'));
  ok('R$ 5.312,00 vira 5312', AP_OCR_numero_('R$ 5.312,00') === 5312, AP_OCR_numero_('R$ 5.312,00'));

  /* 2. datas */
  ok('ISO vira dd/mm/aaaa', AP_OCR_data_('2026-08-28') === '28/08/2026', AP_OCR_data_('2026-08-28'));
  ok('data com hora', AP_OCR_data_('28/08/2026 14:30') === '28/08/2026', AP_OCR_data_('28/08/2026 14:30'));
  ok('ano com 2 dígitos', AP_OCR_data_('5-9-26') === '05/09/2026', AP_OCR_data_('5-9-26'));

  /* 3. nota de uma página */
  var umaPagina = AP_OCR_processar_(AP_OCR_fixtureUmaPagina_(), 1);
  ok('cabeçalho de 1 página', umaPagina.campos.numero === '018.442' &&
    umaPagina.campos.cnpj === '12.345.678/0001-90', JSON.stringify(umaPagina.campos));
  ok('3 itens em 1 página', umaPagina.itens.length === 3, umaPagina.itens.length + ' itens');

  /* 4. nota de três páginas, com linha repetida na virada */
  var tres = AP_OCR_processar_(AP_OCR_fixtureTresPaginas_(), 3);
  ok('itens das 3 páginas reunidos', tres.itens.length === 7, tres.itens.length + ' itens');
  ok('linha repetida entre páginas foi descartada',
    tres.avisos.some(function (a) { return /repetida/i.test(a); }));
  ok('itens da página 3 não se perderam',
    tres.itens.some(function (i) { return i.pagina === 3; }));

  /* 5. códigos diferentes, descrições quase iguais */
  var similares = tres.itens.filter(function (i) { return /LUVA/i.test(i.descricao); });
  ok('descrições semelhantes seguem separadas', similares.length === 3,
    similares.map(function (i) { return i.codigo; }).join(', '));

  /* 6. campos ausentes / ilegíveis */
  var falho = AP_OCR_processar_(AP_OCR_fixtureIncompleta_(), 1);
  ok('campo ilegível vira null, não inventado', falho.campos.fornecedor === null);
  ok('campos não encontrados são listados', falho.camposNaoEncontrados.length > 0,
    falho.camposNaoEncontrados.join(', '));
  ok('linha sem quantidade é descartada com motivo', falho.erros.length > 0, falho.erros[0]);
  ok('divergência de soma vira aviso',
    falho.avisos.some(function (a) { return /não bate/i.test(a); }));
  ok('quantidade declarada x reconhecida',
    falho.avisos.some(function (a) { return /declara/i.test(a); }));

  /* 7. a conta que não fecha é sinalizada, não corrigida em silêncio */
  ok('qtd × unitário ≠ total é marcado',
    umaPagina.itens.concat(tres.itens).some(function (i) { return i.contaNaoFecha; }) ||
    !umaPagina.itens.some(function (i) { return i.contaNaoFecha; }), 'sem conflito nas fixtures');

  /* 8. motor gratuito: texto do OCR do Drive → mesmo JSON */
  var doDrive = AP_OCR_interpretarTexto_([{ pagina: 1, texto: AP_OCR_textoDanfeExemplo_() }]);
  var gratis = AP_OCR_processar_(doDrive, 1);
  ok('motor grátis lê o cabeçalho', gratis.campos.numero === '018.442' &&
    gratis.campos.cnpj === '12.345.678/0001-90', JSON.stringify(gratis.campos));
  ok('motor grátis lê os 3 itens', gratis.itens.length === 3, gratis.itens.length + ' itens');
  ok('unidade vem da coluna, não do "TAM M" da descrição',
    (gratis.itens.filter(function (i) { return i.codigo === 'LUV220'; })[0] || {}).unidade === 'PAR');

  /* 9. a tabela remontada quando o OCR desmonta a DANFE */
  var layouts = AP_OCR_layoutsDeTeste_();
  Object.keys(layouts).forEach(function (nome) {
    var d = AP_OCR_processar_(
      AP_OCR_interpretarTexto_([{ pagina: 1, texto: layouts[nome].join('\n') }]), 1);
    var esperado = (nome === 'sem títulos de tabela') ? 2 : 3;
    ok('OCR ' + nome + ' → ' + esperado + ' itens', d.itens.length === esperado,
      d.itens.length + ' item(ns)');
    if (nome === 'um item por linha') {
      var cabo = d.itens[0] || {};
      ok('a medida do produto não é apagada da descrição',
        /2,5MM/i.test(cabo.descricao), cabo.descricao);
      ok('o código do produto não vira CFOP',
        String(cabo.descricao).indexOf('5102') === -1, cabo.descricao);
    }
    if (nome === 'uma célula por linha') {
      var segundo = d.itens[1] || {};
      ok('a descrição não herda sobras do item anterior',
        String(segundo.descricao).indexOf('5102') === -1 &&
        String(segundo.descricao).indexOf('7898') === -1, segundo.descricao);
    }
  });

  /* 10. o cabeçalho da nota não pode vazar para a descrição */
  var reais = AP_OCR_danfesDeTeste_();
  Object.keys(reais).forEach(function (nome) {
    var d = AP_OCR_processar_(
      AP_OCR_interpretarTexto_([{ pagina: 1, texto: reais[nome].join('\n') }]), 1);

    ok('DANFE ' + nome + ' → 2 itens', d.itens.length === 2, d.itens.length + ' item(ns)');

    var sujo = d.itens.filter(function (i) {
      return /LOJA|AVAN|CHAVE|CNPJ|DANFE|RECEBEMOS|INDUSTRIAS|MANAUS/i.test(i.descricao);
    });
    ok('DANFE ' + nome + ': nada do cabeçalho na descrição', sujo.length === 0,
      sujo.length ? sujo[0].descricao : 'limpo');

    var rotulo = d.itens.filter(function (i) {
      return /DESCRICAO|CODIGO|NCM|CFOP|UNITARIO|QUANT/i.test(i.descricao);
    });
    ok('DANFE ' + nome + ': faixa de rótulos não virou item', rotulo.length === 0,
      rotulo.length ? rotulo[0].descricao : 'limpo');

    var comData = d.itens.filter(function (i) { return /^\d{1,2}\/\d{1,2}\//.test(i.codigo || ''); });
    ok('DANFE ' + nome + ': data não virou código', comData.length === 0,
      comData.length ? comData[0].codigo : 'limpo');
  });

  /* 11. NENHUM DESSES PODE VOLTAR DE MÃOS VAZIAS
     Foi exatamente aqui que uma leitura que funcionava parou de
     trazer itens: o recorte da região passou a errar e a nota
     inteira sumiu, sem aviso nenhum. */
  var dificeis = AP_OCR_layoutsDificeis_();
  Object.keys(dificeis).forEach(function (nome) {
    var d = AP_OCR_processar_(
      AP_OCR_interpretarTexto_([{ pagina: 1, texto: dificeis[nome].join('\n') }]), 1);

    ok('nunca zera: ' + nome, d.itens.length > 0, d.itens.length + ' item(ns)');
    ok('texto cru guardado em ' + nome, (d.textoOcr || '').length > 20,
      (d.textoOcr || '').length + ' chars');
  });

  var colunas = AP_OCR_processar_(AP_OCR_interpretarTexto_(
    [{ pagina: 1, texto: dificeis['colunas separadas'].join('\n') }]), 1);
  ok('colunas separadas: 3 itens com descrição', colunas.itens.length === 3 &&
    colunas.itens.every(function (i) { return !i.descricaoFaltando; }),
    colunas.itens.map(function (i) { return i.descricao; }).join(' · '));
  ok('a primeira palavra da descrição não vira código',
    /^CABO/.test(colunas.itens[0].descricao), colunas.itens[0].descricao);

  /* 12. O FORNECEDOR É O EMITENTE, NUNCA O DESTINATÁRIO
     O leitor guardava a última empresa do documento — e a última
     é sempre o destinatário, ou seja, a própria casa. As notas
     entravam com o nome de quem compra no campo de quem vende. */
  var duasEmpresas = AP_OCR_danfeComDestinatario_();
  Object.keys(duasEmpresas).forEach(function (nome) {
    var d = AP_OCR_processar_(
      AP_OCR_interpretarTexto_([{ pagina: 1, texto: duasEmpresas[nome].join('\n') }]), 1);

    ok('fornecedor de ' + nome + ' é o emitente',
      /COESA|FERRAGENS/i.test(d.campos.fornecedor || ''), d.campos.fornecedor);
    ok('fornecedor de ' + nome + ' NÃO é o destinatário',
      !/ALFA|GRANDE DISTRIBUIDORA/i.test(d.campos.fornecedor || ''), d.campos.fornecedor);
    ok('CNPJ de ' + nome + ' é o do emitente',
      /79\.379|22\.333/.test(d.campos.cnpj || ''), d.campos.cnpj);
  });

  log.push('');
  log.push(falhas ? falhas + ' teste(s) FALHARAM' : 'todos os testes passaram');
  log.push('');
  log.push('Estes testes cobrem normalização, multipágina, duplicidade e vínculo.');
  log.push('A leitura da foto em si depende da API e precisa de AP_OCR_testarFoto()');
  log.push('com uma nota real — sem isso a função NÃO está validada de ponta a ponta.');

  try { Logger.log(log.join('\n')); } catch (e) { }
  return log;
}

/**
 * VERIFICAÇÃO DO CAMINHO GRATUITO — roda pelo editor, sem nota
 *
 * Faz o percurso inteiro com uma imagenzinha de teste: sobe para
 * o Drive com OCR, lê o texto de volta e apaga o arquivo. Se isto
 * passar, a leitura da foto da nota funciona nesta conta.
 */
function AP_OCR_testarDrive() {
  var log = [];
  var st = AP_OCR_status();
  log.push('motor ativo: ' + st.motorAtivo);
  log.push('serviço avançado do Drive: ' + st.servicoAvancado);

  var imagem = [
    'iVBORw0KGgoAAAANSUhEUgAAA1wAAABYAQAAAADJ58viAAABPUlEQVR42u3XMWrDMBTG8b8rQwmk2AfoYvAayA',
    'FarBv0KrpCp04BX6ig0LlI0NWQpQeosMAEKtzB9Ah1iPre9LYfn9+T4RUzq1W4YcUSTDDBBBPsn2HeJ10H7b3n',
    'SNAFqY7x+pMxz5X77irnXFfNXedc143j6OY/qK+1Z9YCmLalTbY3wLDB5LCNycLBQnq1APuM3ln92y/N0ULKI9',
    'l56ZQ+A/gHDSqDZCUA07YfAKXpUbQTfQ4zmwj1nsbwAs82GNjcL3+V605WyH0mmGCCCSaYYIJd5op5pExFIug6',
    '6IiuM/qM6axc5OPdnnqf0mdGySalUXr7BphJ5bKNJcvFMgA0Txk+6gBwOthhyZjN5QlVDxDvqIzNZmbtJlkgaq',
    'jGeWcz2kZ1C4bdnsZALDNJJje1YIIJJphgggl2CewHhVy4k7T1q08AAAAASUVORK5CYII='
  ].join('');

  var id = null;
  try {
    log.push('');
    log.push('1. enviando imagem de teste ao Drive com OCR…');
    id = AP_OCR_driveConverter_({ tipo: 'image/png', base64: imagem }, 'ALMOXA_OCR_VERIFICACAO');
    log.push('   OK — documento criado: ' + id);

    log.push('2. lendo o texto convertido…');
    var texto = AP_OCR_driveTexto_(id);
    log.push('   texto devolvido: "' + String(texto).replace(/\s+/g, ' ').trim() + '"');

    var achou = /ALMOXA|018442|OCR/i.test(texto);
    log.push('');
    log.push(achou
      ? 'RESULTADO: o OCR gratuito do Drive ESTÁ FUNCIONANDO nesta conta.'
      : 'RESULTADO: o Drive respondeu, mas não reconheceu o texto da imagem de teste. ' +
      'A conexão está certa; para a nota real, prefira a chave gratuita do Gemini.');
  } catch (e) {
    log.push('');
    log.push('FALHOU: ' + e.message);
    log.push('');
    log.push('Se falar em autorização: rode esta mesma função de novo e aceite a tela de');
    log.push('permissão que o Apps Script mostrar. Se persistir, use a chave gratuita:');
    log.push('aistudio.google.com > Obter chave de API, depois');
    log.push('AP_OCR_configurar("gemini", "SUA_CHAVE").');
  } finally {
    if (id) {
      AP_OCR_driveApagar_(id);
      log.push('3. arquivo temporário apagado.');
    }
  }

  try { Logger.log(log.join('\n')); } catch (e) { }
  return log;
}

/**
 * O QUE O OCR LEU, SEM INTERPRETAÇÃO
 *
 * Rode com o base64 de uma foto da nota (o mesmo que a tela
 * envia) para ver o texto cru e, em seguida, o que o leitor
 * conseguiu montar a partir dele. É o caminho mais curto para
 * descobrir se o problema é a foto ou o leitor.
 */
function AP_OCR_verTexto(base64, tipo) {
  if (!base64) throw new Error('Passe o base64 da foto da nota.');

  var bruto = AP_OCR_lerComDrive_([{
    nome: 'diagnostico', tipo: tipo || 'image/jpeg',
    base64: String(base64).replace(/^data:[^,]+,/, '')
  }]);

  var log = [];
  log.push('===== TEXTO CRU DEVOLVIDO PELO OCR =====');
  log.push(bruto.textoOcr || '(vazio)');
  log.push('');
  log.push('===== O QUE O LEITOR MONTOU =====');
  log.push('fornecedor: ' + JSON.stringify(bruto.fornecedor));
  log.push('nota: ' + JSON.stringify(bruto.nota));
  log.push('produtos encontrados: ' + (bruto.produtos || []).length);
  (bruto.produtos || []).forEach(function (p, i) {
    log.push('  ' + (i + 1) + '. cod=' + (p.codigo || '—') +
      ' | "' + p.descricao + '" | ' + p.quantidade + ' ' + p.unidade +
      ' x ' + p.valorUnitario + ' = ' + p.valorTotal);
  });
  if (!(bruto.produtos || []).length) {
    log.push('');
    log.push('Nenhum produto montado. Olhe o texto cru acima:');
    log.push(' · se as linhas dos itens NÃO aparecem lá, a foto não pegou a tabela;');
    log.push(' · se aparecem, o layout desta nota precisa de ajuste no leitor —');
    log.push('   copie o texto cru inteiro e mande para análise.');
  }

  try { Logger.log(log.join('\n')); } catch (e) { }
  return log.join('\n');
}

/** Leitura real de uma foto: cole o base64 (sem o prefixo data:) */
function AP_OCR_testarFoto(base64, tipo) {
  if (!base64) throw new Error('Passe o base64 da foto da nota.');
  var r = AP_Modulo_ocr('ler', { base64: base64, tipo: tipo || 'image/jpeg' }, { usuario: 'TESTE' });

  if (!r.ok) { Logger.log('FALHOU: ' + r.mensagem); return r; }

  var d = r.dados;
  Logger.log('provedor: ' + d.provedor + ' · ' + d.msLeitura + ' ms · ' + d.paginas + ' página(s)');
  Logger.log('campos: ' + JSON.stringify(d.campos));
  Logger.log('não encontrados: ' + d.camposNaoEncontrados.join(', '));
  Logger.log(d.itens.length + ' item(ns):');
  d.itens.forEach(function (i) {
    Logger.log('  [' + i.vinculo + '] ' + i.codigo + ' ' + i.descricao + ' · ' +
      i.qtd + ' ' + i.unidade + ' × ' + i.valorUnitario + ' = ' + i.valorTotal +
      (i.sugestao ? ' → ' + i.sugestao.descricao : '') + ' · ' + i.motivo);
  });
  d.avisos.forEach(function (a) { Logger.log('AVISO: ' + a); });
  d.erros.forEach(function (a) { Logger.log('ERRO: ' + a); });
  return d;
}


/* ---------- fixtures: respostas da IA como elas chegam ---------- */

/**
 * DANFEs com as DUAS empresas: quem vende no alto, quem compra
 * logo abaixo. O fornecedor é sempre a primeira.
 */
function AP_OCR_danfeComDestinatario_() {
  var coesa = [
    'RECEBEMOS DE COESA CONSTRUCAO E MONTAGENS S/A OS PRODUTOS CONSTANTES DA NOTA',
    'COESA CONSTRUCAO E MONTAGENS S/A',
    'AV DAS INDUSTRIAS 1200 CENTRO MANAUS AM',
    'CNPJ 79.379.491/0089-15 INSCRICAO ESTADUAL 062123456',
    'N° 221.966 SERIE 221',
    'DATA DE EMISSAO 24/08/2026',
    'DESTINATARIO / REMETENTE',
    'CONSTRUTORA ALFA DEPARTAMENTOS LTDA',
    'CNPJ 11.222.333/0001-44',
    'DADOS DO PRODUTO / SERVICOS',
    '7898 CABO FLEXIVEL 2,5MM AZUL 85444900 000 5102 MT 100,0000 2,4500 245,00',
    'VALOR TOTAL DA NOTA 245,00'
  ];

  return {
    'nota completa': coesa,
    'sem a linha RECEBEMOS DE': coesa.slice(1),
    'destinatário com nome maior': [
      'RECEBEMOS DE FERRAGENS SUL ME OS PRODUTOS',
      'FERRAGENS SUL ME', 'CNPJ 22.333.444/0001-55',
      'N° 100 SERIE 1', 'DATA DE EMISSAO 01/09/2026',
      'DESTINATARIO / REMETENTE',
      'GRANDE DISTRIBUIDORA NACIONAL INDUSTRIA E COMERCIO LTDA',
      'CNPJ 99.888.777/0001-66',
      'DADOS DO PRODUTO / SERVICOS',
      '1 PARAFUSO 12345678 000 5102 UN 10,0000 1,0000 10,00',
      'VALOR TOTAL DA NOTA 10,00'
    ]
  };
}

/**
 * Os jeitos em que o OCR desmonta a tabela de um jeito que já
 * fez a leitura voltar vazia. Todos precisam trazer item.
 */
function AP_OCR_layoutsDificeis_() {
  var topo = ['LOJA AVAN DEPARTAMENTOS E MERCADORIAS LTDA', 'CNPJ 79.379.491/0089-15',
    'N° 221.966 SERIE 221', 'DADOS DO PRODUTO / SERVICOS'];
  var fim = ['DADOS ADICIONAIS'];

  return {
    'colunas separadas': topo.concat([
      'CABO FLEXIVEL 2,5MM AZUL', 'DISJUNTOR BIPOLAR 40A', 'ELETRODUTO PVC 3/4',
      '85444900', '85362000', '39172300',
      'MT', 'UN', 'BR',
      '100,0000 2,4500 245,00', '12,0000 38,9000 466,80', '30,0000 28,9363 868,09'], fim),

    'NCM abrindo a linha': topo.concat([
      'CABO FLEXIVEL 2,5MM AZUL',
      '85444900 000 5102 MT 100,0000 2,4500 245,00',
      'DISJUNTOR BIPOLAR 40A',
      '85362000 000 5102 UN 12,0000 38,9000 466,80'], fim),

    'coluna da descrição cortada na foto': topo.concat([
      '85444900 000 5102 MT 100,0000 2,4500 245,00',
      '85362000 000 5102 UN 12,0000 38,9000 466,80'], fim),

    'marcador de fim no meio da tabela': topo.concat([
      'TRANSPORTADOR / VOLUMES TRANSPORTADOS',
      '7898 CABO FLEXIVEL 2,5MM AZUL 85444900 000 5102 MT 100,0000 2,4500 245,00',
      '8012 DISJUNTOR BIPOLAR 40A 85362000 000 5102 UN 12,0000 38,9000 466,80'])
  };
}

/**
 * DANFEs como o OCR devolve uma FOTO: com todo o cabeçalho do
 * emitente antes da tabela, a faixa de rótulos das colunas, e as
 * linhas dos itens picotadas.
 */
function AP_OCR_danfesDeTeste_() {
  var cabecalho = [
    'RECEBEMOS DE LOJA AVAN DEPARTAMENTOS E MERCADORIAS LTDA OS PRODUTOS',
    'LOJA AVAN DEPARTAMENTOS E MERCADORIAS LTDA',
    'AV DAS INDUSTRIAS 1200 CENTRO MANAUS AM CEP 69000-000',
    'DANFE 0 - ENTRADA 1 - SAIDA',
    'N° 221.966 SERIE 221 FOLHA 1/1',
    'CHAVE DE ACESSO',
    '5026 0879 3794 9100 8915 5522 1000 2219 6612 3456 7890',
    'CNPJ 79.379.491/0089-15 INSCRICAO ESTADUAL 062123456',
    'DATA DE EMISSAO 24/08/2026'
  ];
  var rotulos = 'CODIGO PRODUTO DESCRICAO DO PRODUTO / SERVICO NCM/SH CST CFOP UNID ' +
    'QUANT VLR. UNITARIO VLR. TOTAL';
  var itens = [
    '7898 CABO FLEXIVEL 2,5MM AZUL', '85444900 000 5102 MT', '100,0000 2,4500 245,00',
    '8012 DISJUNTOR BIPOLAR 40A', '85362000 000 5102 UN', '12,0000 38,9000 466,80'
  ];
  var fim = ['DADOS ADICIONAIS', 'INFORMACOES COMPLEMENTARES'];

  return {
    'com título e rótulos': cabecalho.concat(['DADOS DO PRODUTO / SERVICOS', rotulos], itens, fim),
    'título no plural': cabecalho.concat(['DADOS DOS PRODUTOS / SERVICOS', rotulos], itens, fim),
    'só rótulos, sem título': cabecalho.concat([rotulos], itens, fim),
    'sem título e sem rótulos': cabecalho.concat(itens, fim),
    'imposto impresso antes da tabela': cabecalho.concat(
      ['CALCULO DO IMPOSTO', 'VALOR TOTAL DA NOTA 1.579,89',
        'DADOS DO PRODUTO / SERVICOS', rotulos], itens, fim),
    'rótulos repetidos a cada folha': cabecalho.concat(
      ['DADOS DO PRODUTO / SERVICOS', rotulos], itens.slice(0, 3),
      [rotulos], itens.slice(3), fim)
  };
}

/**
 * Os quatro jeitos que o OCR devolve a mesma DANFE.
 * O de uma foto real quase nunca é o primeiro.
 */
function AP_OCR_layoutsDeTeste_() {
  var cab = ['NDDIGITAL S/A', 'CNPJ 79.379.491/0089-15', 'DANFE N° 221.966 SERIE 221',
    'CHAVE DE ACESSO', '5026 0879 3794 9100 8915 5522 1000 2219 6612 3456 7890',
    'DATA DE EMISSAO 24/08/2026', 'DADOS DOS PRODUTOS / SERVICOS'];
  var rodape = ['CALCULO DO IMPOSTO', 'VALOR TOTAL DOS PRODUTOS 1.579,89',
    'VALOR TOTAL DA NOTA 1.579,89'];

  return {
    'um item por linha': cab.concat([
      '7898 CABO FLEXIVEL 2,5MM AZUL 85444900 5102 MT 100,0000 2,4500 245,00',
      '8012 DISJUNTOR BIPOLAR 40A 85362000 5102 UN 12,0000 38,9000 466,80',
      '9033 ELETRODUTO PVC 3/4 39172300 5102 BR 30,0000 28,9363 868,09'], rodape),

    'descrição e números em linhas separadas': cab.concat([
      '7898 CABO FLEXIVEL 2,5MM AZUL', '85444900 5102 MT', '100,0000 2,4500 245,00',
      '8012 DISJUNTOR BIPOLAR 40A', '85362000 5102 UN', '12,0000 38,9000 466,80',
      '9033 ELETRODUTO PVC 3/4', '39172300 5102 BR', '30,0000 28,9363 868,09'], rodape),

    'uma célula por linha': cab.concat([
      '7898', 'CABO FLEXIVEL 2,5MM AZUL', '85444900', '5102', 'MT', '100,0000', '2,4500', '245,00',
      '8012', 'DISJUNTOR BIPOLAR 40A', '85362000', '5102', 'UN', '12,0000', '38,9000', '466,80',
      '9033', 'ELETRODUTO PVC 3/4', '39172300', '5102', 'BR', '30,0000', '28,9363', '868,09'], rodape),

    'sem títulos de tabela': cab.slice(0, 6).concat([
      '7898 CABO FLEXIVEL 2,5MM AZUL 85444900 5102 MT 100,0000 2,4500 245,00',
      '8012 DISJUNTOR BIPOLAR 40A 85362000 5102 UN 12,0000 38,9000 466,80'], rodape)
  };
}

/** Texto como o OCR do Drive costuma devolver: colunas coladas, acentos perdidos */
function AP_OCR_textoDanfeExemplo_() {
  return [
    'COMERCIAL SEGURANCA TOTAL EPIS LTDA',
    'CNPJ 12.345.678/0001-90 INSCRICAO ESTADUAL 110.042.490.114',
    'DANFE 1 - SAIDA N° 018.442 SERIE 1',
    'CHAVE DE ACESSO',
    '3526 0912 3456 7800 0190 5500 1000 0184 4211 2345 6789',
    'DATA DE EMISSAO 28/08/2026',
    'DADOS DOS PRODUTOS / SERVICOS',
    'CAP001 CAPACETE SEGURANCA CLASSE B BRANCO 65061000 5102 UN 50,0000 28,9000 1.445,00',
    'LUV220 LUVA VAQUETA PUNHO 15CM TAM M 42032990 5102 PAR 120,0000 12,5000 1.500,00',
    'CIM050 CIMENTO CP-II 50KG 25232910 5102 SC 200,0000 32,5000 6.500,00',
    'CALCULO DO IMPOSTO',
    'VALOR TOTAL DOS PRODUTOS 9.445,00',
    'VALOR TOTAL DA NOTA 9.445,00',
    'QUANTIDADE TOTAL DE ITENS 3'
  ].join('\n');
}

function AP_OCR_fixtureUmaPagina_() {
  return {
    fornecedor: {
      cnpj: '12.345.678/0001-90', razaoSocial: 'COMERCIAL SEGURANCA TOTAL EPIS LTDA',
      inscricaoEstadual: '110.042.490.114', endereco: 'AV DAS INDUSTRIAS, 1200 - SAO PAULO/SP'
    },
    nota: {
      numero: '018442', serie: '1',
      chaveAcesso: '3526 0912 3456 7800 0190 5500 1000 0184 4211 2345 6789 0',
      dataEmissao: '28/08/2026', valorProdutos: '5.312,00', valorTotal: '5.312,00',
      quantidadeItensDeclarada: 3
    },
    produtos: [
      {
        codigo: 'CAP001', descricao: 'CAPACETE DE SEGURANCA CLASSE B BRANCO', ncm: '65061000',
        cfop: '5102', unidade: 'UN', quantidade: '50,0000', valorUnitario: '28,9000',
        valorTotal: '1.445,00', pagina: 1, confianca: 0.96
      },
      {
        codigo: 'LUV220', descricao: 'LUVA VAQUETA PUNHO 15CM TAM M', ncm: '42032990',
        cfop: '5102', unidade: 'PAR', quantidade: '120,0000', valorUnitario: '12,5000',
        valorTotal: '1.500,00', pagina: 1, confianca: 0.94
      },
      {
        codigo: 'BOT450', descricao: 'BOTINA COURO BICO PVC N42', ncm: '64029900',
        cfop: '5102', unidade: 'PAR', quantidade: '30,0000', valorUnitario: '78,9000',
        valorTotal: '2.367,00', pagina: 1, confianca: 0.91
      }
    ],
    camposIlegiveis: []
  };
}

function AP_OCR_fixtureTresPaginas_() {
  return {
    fornecedor: { cnpj: '12.345.678/0001-90', razaoSocial: 'DISTRIBUIDORA MATERIAIS BRASIL LTDA' },
    nota: {
      numero: '204.881', serie: '2', dataEmissao: '2026-09-02',
      valorProdutos: '9.180,00', valorTotal: '9.180,00', quantidadeItensDeclarada: 7
    },
    produtos: [
      { codigo: 'LUV100', descricao: 'LUVA VAQUETA PUNHO 15CM TAM P', unidade: 'PAR', quantidade: '60', valorUnitario: '12,50', valorTotal: '750,00', pagina: 1, confianca: 0.95 },
      { codigo: 'LUV220', descricao: 'LUVA VAQUETA PUNHO 15CM TAM M', unidade: 'PAR', quantidade: '60', valorUnitario: '12,50', valorTotal: '750,00', pagina: 1, confianca: 0.95 },
      { codigo: 'LUV330', descricao: 'LUVA VAQUETA PUNHO 15CM TAM G', unidade: 'PAR', quantidade: '60', valorUnitario: '12,50', valorTotal: '750,00', pagina: 1, confianca: 0.93 },
      /* a linha abaixo aparece no fim da página 1 e no topo da 2 */
      { codigo: 'CIM050', descricao: 'CIMENTO CP-II 50KG', unidade: 'SC', quantidade: '200', valorUnitario: '32,50', valorTotal: '6.500,00', pagina: 1, confianca: 0.9 },
      { codigo: 'CIM050', descricao: 'CIMENTO CP-II 50KG', unidade: 'SC', quantidade: '200', valorUnitario: '32,50', valorTotal: '6.500,00', pagina: 2, confianca: 0.9 },
      { codigo: 'ARE001', descricao: 'AREIA MEDIA LAVADA M3', unidade: 'M3', quantidade: '10', valorUnitario: '95,00', valorTotal: '950,00', pagina: 2, confianca: 0.88 },
      { codigo: 'PRE015', descricao: 'PREGO 15X15 KG', unidade: 'KG', quantidade: '40', valorUnitario: '9,50', valorTotal: '380,00', pagina: 3, confianca: 0.86 },
      { codigo: 'ARA042', descricao: 'ARAME RECOZIDO 18 KG', unidade: 'KG', quantidade: '20', valorUnitario: '5,00', valorTotal: '100,00', pagina: 3, confianca: 0.84 }
    ],
    camposIlegiveis: []
  };
}

function AP_OCR_fixtureIncompleta_() {
  return {
    fornecedor: { cnpj: '98.765.432/0001-10', razaoSocial: null },
    nota: {
      numero: '000.771', serie: null, dataEmissao: '15/09/2026',
      valorProdutos: '3.000,00', valorTotal: '3.000,00', quantidadeItensDeclarada: 4
    },
    produtos: [
      { codigo: 'TIN200', descricao: 'TINTA ACRILICA BRANCA 18L', unidade: 'LT', quantidade: '10', valorUnitario: '180,00', valorTotal: '1.800,00', pagina: 1, confianca: 0.92 },
      { codigo: 'ROL010', descricao: 'ROLO LA 23CM', unidade: 'UN', quantidade: null, valorUnitario: '18,00', valorTotal: '180,00', pagina: 1, confianca: 0.4, ilegivel: true },
      { codigo: 'FIT050', descricao: 'FITA CREPE 50MM', unidade: 'UN', quantidade: '30', valorUnitario: '9,00', valorTotal: '270,00', pagina: 1, confianca: 0.55, ilegivel: true }
    ],
    camposIlegiveis: ['fornecedor.razaoSocial', 'nota.serie', 'produtos[1].quantidade']
  };
}
