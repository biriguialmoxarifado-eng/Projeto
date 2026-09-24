/**
 * ============================================================
 * ALMOXA PRO — MÓDULO DE OCR
 * Versão 1.0.0 · leitura real de PDF e imagem
 * ------------------------------------------------------------
 * NÃO usa serviço externo nem chave paga.
 *
 * Usa o OCR do próprio Google Drive: ao copiar um PDF ou imagem
 * com a opção ocr:true, o Drive devolve um Google Docs com o
 * texto extraído. É o mesmo motor do Google Docs, gratuito
 * dentro da sua conta, e o arquivo não sai do seu Drive.
 *
 * ------------------------------------------------------------
 * ATIVAR ANTES DE USAR (uma vez, 30 segundos)
 *
 *   No editor do Apps Script:
 *   Serviços (+)  ->  Drive API  ->  Adicionar
 *
 *   Sem isso este módulo responde OCR_NAO_ATIVADO e o sistema
 *   segue oferecendo o lançamento manual — nunca inventa dados.
 * ------------------------------------------------------------
 */

var AP_OCR_CFG = {
  versao: '1.0.0',
  pasta: 'ALMOXA_PRO_OCR',      // onde os arquivos processados ficam
  idioma: 'pt',
  manterOriginal: true          // guarda o arquivo como comprovante da nota
};

/** O serviço avançado do Drive foi ativado? */
function AP_OCR_disponivel_() {
  try { return (typeof Drive !== 'undefined') && !!Drive.Files; }
  catch (e) { return false; }
}

function AP_OCR_pasta_() {
  var pastas = DriveApp.getFoldersByName(AP_OCR_CFG.pasta);
  return pastas.hasNext() ? pastas.next() : DriveApp.createFolder(AP_OCR_CFG.pasta);
}

/**
 * Extrai o texto de um PDF/imagem em base64 usando o OCR do Drive.
 * @return {{ok:boolean, texto:string, arquivoId:string}}
 */
function AP_OCR_extrairTexto_(nome, mimeType, base64) {
  if (!AP_OCR_disponivel_()) {
    return {
      ok: false, codigo: 'OCR_NAO_ATIVADO',
      mensagem: 'O serviço Drive API não está ativado neste projeto. ' +
        'No editor do Apps Script: Serviços (+) → Drive API → Adicionar.'
    };
  }

  var pasta = AP_OCR_pasta_();
  var blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType, nome);
  var original = pasta.createFile(blob);
  var docId = null;

  try {
    /* copiar com ocr:true faz o Drive rodar o reconhecimento */
    var copia = Drive.Files.copy(
      { title: '[OCR] ' + nome, parents: [{ id: pasta.getId() }] },
      original.getId(),
      { ocr: true, ocrLanguage: AP_OCR_CFG.idioma }
    );
    docId = copia.id;

    var texto = DocumentApp.openById(docId).getBody().getText();

    /* o documento convertido é descartado; o original fica de comprovante */
    DriveApp.getFileById(docId).setTrashed(true);
    if (!AP_OCR_CFG.manterOriginal) original.setTrashed(true);

    return { ok: true, texto: texto, arquivoId: original.getId() };

  } catch (e) {
    if (docId) { try { DriveApp.getFileById(docId).setTrashed(true); } catch (e2) { } }
    AP_ErrorHandler_capture('AP_OCR_extrairTexto_', e);
    return {
      ok: false, codigo: 'OCR_FALHOU',
      mensagem: 'O Drive não conseguiu ler este arquivo: ' + e.message,
      arquivoId: original.getId()
    };
  }
}

/* ------------------------------------------------------------
   LEITURA DA DANFE — o que dá para reconhecer com segurança
   ------------------------------------------------------------ */

function AP_OCR_soDigitos_(t) { return String(t || '').replace(/\D/g, ''); }

function AP_OCR_valor_(t) {
  if (!t) return null;
  var limpo = String(t).replace(/[R$\s.]/g, '').replace(',', '.');
  var n = Number(limpo);
  return isNaN(n) ? null : n;
}

/**
 * Interpreta o texto da DANFE. Cada campo vem com a confiança
 * do que foi encontrado. O que não for achado volta como null —
 * nunca preenchido por suposição.
 */
function AP_OCR_interpretarDanfe_(texto) {
  var campos = {
    numero: null, serie: null, chave: null, cnpj: null,
    fornecedor: null, emissao: null, valor: null
  };
  var confianca = {};

  /* chave de acesso: 44 dígitos, é o campo mais confiável da nota */
  var chave = (texto.match(/(\d[\d\s.]{50,60}\d)/g) || [])
    .map(function (c) { return AP_OCR_soDigitos_(c); })
    .filter(function (c) { return c.length === 44; })[0];
  if (chave) {
    campos.chave = chave;
    confianca.chave = 0.99;
    /* a própria chave carrega CNPJ do emitente, número e série */
    campos.cnpj = chave.substr(6, 14);
    confianca.cnpj = 0.95;
    campos.serie = String(Number(chave.substr(22, 3)));
    confianca.serie = 0.95;
    campos.numero = String(Number(chave.substr(25, 9)));
    confianca.numero = 0.95;
  }

  /* número: "Nº 000.000.127" ou "N. 000000127" */
  if (!campos.numero) {
    var mNum = texto.match(/N[ºo°.\s]*\s*([\d.]{3,15})/i);
    if (mNum) { campos.numero = mNum[1]; confianca.numero = 0.7; }
  }

  /* série */
  if (!campos.serie) {
    var mSerie = texto.match(/S[ÉE]RIE\s*:?\s*(\d{1,3})/i);
    if (mSerie) { campos.serie = mSerie[1]; confianca.serie = 0.75; }
  }

  /* CNPJ com máscara */
  if (!campos.cnpj) {
    var mCnpj = texto.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/);
    if (mCnpj) { campos.cnpj = AP_OCR_soDigitos_(mCnpj[1]); confianca.cnpj = 0.9; }
  }

  /* fornecedor: linha com LTDA / S.A. / ME / EIRELI */
  var linhas = texto.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
  var mForn = linhas.filter(function (l) {
    return /(LTDA|S\.?A\.?$|EIRELI|\sME$|MATERIAIS|COM[ÉE]RCIO|IND[ÚU]STRIA)/i.test(l) && l.length > 8 && l.length < 90;
  })[0];
  if (mForn) { campos.fornecedor = mForn; confianca.fornecedor = 0.7; }

  /* emissão */
  var mData = texto.match(/(\d{2}\/\d{2}\/\d{4})/);
  if (mData) { campos.emissao = mData[1]; confianca.emissao = 0.75; }

  /* valor total: procura o rótulo antes de pegar qualquer número */
  var mTotal = texto.match(/VALOR\s+TOTAL\s+DA\s+N(?:OTA|F)[\s\S]{0,40}?([\d.]+,\d{2})/i) ||
    texto.match(/VALOR\s+TOTAL[\s\S]{0,40}?([\d.]+,\d{2})/i);
  if (mTotal) { campos.valor = AP_OCR_valor_(mTotal[1]); confianca.valor = 0.8; }

  /* itens: linhas com quantidade, valor unitário e total */
  var itens = [];
  linhas.forEach(function (l) {
    var m = l.match(/^(\S{2,20})\s+(.{5,60}?)\s+([\d.]{4,12})\s+([A-Z]{2,3})\s+([\d.,]+)\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})$/);
    if (m) {
      itens.push({
        codigo: m[1], descricao: m[2].trim(), ncm: m[3], unidade: m[4],
        qtd: Number(String(m[5]).replace(/\./g, '').replace(',', '.')) || 0,
        valorUnitario: AP_OCR_valor_(m[6]), valorTotal: AP_OCR_valor_(m[7]),
        confianca: 0.7
      });
    }
  });

  var encontrados = Object.keys(campos).filter(function (k) { return campos[k] !== null; });
  var media = encontrados.length
    ? encontrados.reduce(function (s, k) { return s + (confianca[k] || 0.5); }, 0) / encontrados.length
    : 0;

  return {
    campos: campos, confianca: confianca, itens: itens,
    confiancaGeral: media,
    reconhecidos: encontrados.length,
    total: Object.keys(campos).length
  };
}

/* ------------------------------------------------------------
   MÓDULO
   ------------------------------------------------------------ */
function AP_Modulo_ocr(acao, payload, sessao) {
  payload = payload || {};
  try {
    switch (acao) {

      case 'disponivel':
        return {
          ok: true,
          dados: {
            disponivel: AP_OCR_disponivel_(),
            motor: 'Google Drive OCR',
            mensagem: AP_OCR_disponivel_()
              ? 'OCR pronto para uso.'
              : 'Ative o serviço Drive API no editor do Apps Script: Serviços (+) → Drive API.'
          }
        };

      case 'ler': {
        if (!payload.base64) {
          return { ok: false, codigo: 'ARQUIVO_AUSENTE', mensagem: 'Nenhum arquivo recebido para leitura.' };
        }
        var extracao = AP_OCR_extrairTexto_(
          payload.nome || 'documento',
          payload.tipo || 'application/pdf',
          payload.base64
        );
        if (!extracao.ok) return extracao;

        var leitura = AP_OCR_interpretarDanfe_(extracao.texto);

        AP_Audit_log((sessao && sessao.usuario) || 'sistema', 'OCR_EXECUTADO', 'NF',
          leitura.campos.numero || '', {
          arquivo: payload.nome, reconhecidos: leitura.reconhecidos,
          confianca: Math.round(leitura.confiancaGeral * 100) + '%'
        });

        return {
          ok: true,
          dados: {
            campos: leitura.campos,
            confianca: leitura.confianca,
            confiancaGeral: leitura.confiancaGeral,
            itens: leitura.itens,
            reconhecidos: leitura.reconhecidos,
            total: leitura.total,
            arquivoId: extracao.arquivoId,
            textoBruto: extracao.texto.slice(0, 4000)
          }
        };
      }

      default:
        return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'ocr.' + acao + ' não existe.' };
    }
  } catch (e) {
    AP_ErrorHandler_capture('AP_Modulo_ocr:' + acao, e);
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'ocr', acao: acao, mensagem: e.message };
  }
}

/* ------------------------------------------------------------
   TESTE
   ------------------------------------------------------------ */
function testeModuloOCR() {
  var log = [];
  function reg(t, ok, d) { log.push((ok ? 'OK    ' : 'ERRO  ') + t + (d ? ' — ' + d : '')); }

  var d = AP_Modulo_ocr('disponivel', {});
  reg('serviço Drive API ativado', d.dados.disponivel, d.dados.mensagem);

  /* texto de uma DANFE, para conferir o interpretador sem gastar Drive */
  var amostra = [
    'DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRONICA',
    'ALMOXA PRO MATERIAIS E SERVICOS LTDA.',
    'CNPJ: 12.345.678/0001-90',
    'Nº 000.000.127 — SÉRIE 001',
    'CHAVE DE ACESSO 3526 0812 3456 7800 0190 5500 1000 0001 2712 3456 7890',
    'Data de Emissão 30/08/2026',
    'MAT-001 Cimento Portland CP II 32 2523.29.10 SC 50 32,50 1.625,00',
    'MAT-014 Bloco de concreto 14 x 19 x 39 cm 6810.11.00 UN 300 3,20 960,00',
    'VALOR TOTAL DA NF 4.236,00'
  ].join('\n');

  var r = AP_OCR_interpretarDanfe_(amostra);
  reg('leu a chave de acesso', r.campos.chave && r.campos.chave.length === 44, r.campos.chave);
  reg('extraiu o número pela chave', r.campos.numero === '127', 'número: ' + r.campos.numero);
  reg('extraiu a série pela chave', r.campos.serie === '1', 'série: ' + r.campos.serie);
  reg('extraiu o CNPJ', r.campos.cnpj === '12345678000190', r.campos.cnpj);
  reg('identificou o fornecedor', /ALMOXA PRO MATERIAIS/.test(r.campos.fornecedor || ''), r.campos.fornecedor);
  reg('leu a data de emissão', r.campos.emissao === '30/08/2026', r.campos.emissao);
  reg('leu o valor total', r.campos.valor === 4236, 'R$ ' + r.campos.valor);
  reg('reconheceu os itens', r.itens.length === 2, r.itens.length + ' item(ns)');
  if (r.itens.length) {
    reg('item com quantidade e valor', r.itens[0].qtd === 50 && r.itens[0].valorUnitario === 32.5,
      r.itens[0].descricao + ' · ' + r.itens[0].qtd + ' x ' + r.itens[0].valorUnitario);
  }

  /* nada reconhecido não pode virar dado inventado */
  var vazio = AP_OCR_interpretarDanfe_('texto qualquer sem nota fiscal');
  reg('texto irreconhecível não inventa dados',
    Object.keys(vazio.campos).every(function (k) { return vazio.campos[k] === null; }), '');

  try { Logger.log(log.join('\n')); } catch (e) { }
  return log;
}
