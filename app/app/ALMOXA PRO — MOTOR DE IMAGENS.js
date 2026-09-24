/**
 * ============================================================
 * ALMOXA PRO — MOTOR DE IMAGENS
 * Versão 1.0.0
 * ------------------------------------------------------------
 * POR QUE ESTE MOTOR EXISTE
 *
 * A foto do item fica em base64 na planilha. Uma foto de celular
 * vira uma célula de 100 a 200 mil caracteres.
 *
 * Quando a listagem trazia as fotos junto, ler 437 itens custava
 * quase 3 segundos e dezenas de megabytes. Quando parei de trazer,
 * a loja ficou rápida — e as fotos sumiram.
 *
 * Nenhum dos dois serve. A saída é separar:
 *
 *   LISTAGEM  → dados leves, rápida, sem foto
 *   IMAGENS   → carregadas depois, só as que estão na tela
 *
 * A tela aparece na hora e as fotos entram em seguida, aos poucos.
 * É como qualquer catálogo na internet funciona.
 *
 * ------------------------------------------------------------
 * O QUE ESTE MOTOR NÃO FAZ
 *
 * Não é um segundo Core. Ele não guarda dado próprio, não decide
 * permissão e não grava nada. Só entrega imagem que já está no
 * banco, quando alguém pede.
 * ============================================================
 */

var AP_IMG_CFG = {
  versao: '1.0.0',

  /* Quantas fotos por pedido. Acima disto, a resposta fica grande
     demais e o ganho se perde. */
  maximoPorLote: 12,

  /* Acima deste tamanho, a foto é considerada pesada */
  pesadaAcimaDe: 100000,

  /* Onde as fotos moram, por tipo de registro */
  origens: {
    item: { aba: 'ALMOXA_ITENS', chave: 'sku', coluna: 'foto' },
    categoria: { aba: 'ALMOXA_CATEGORIAS', chave: 'id', coluna: 'foto' },
    ferramenta: { aba: 'ALMOXA_FERRAMENTAS', chave: 'patrimonio', coluna: 'foto' },
    usuario: { aba: null, chave: 'matricula', coluna: 'foto' }   /* aba vem do Core */
  }
};

function AP_IMG_origem_(tipo) {
  var o = AP_IMG_CFG.origens[tipo || 'item'];
  if (!o) return null;
  if (!o.aba && tipo === 'usuario') {
    return { aba: AP_SHEETS.USUARIOS, chave: o.chave, coluna: o.coluna };
  }
  return o;
}

/* ============================================================
   BUSCA DAS IMAGENS
   ============================================================ */

/**
 * Devolve as fotos de uma lista de registros.
 *
 * Lê apenas a coluna da chave e a da foto — nunca a linha inteira.
 * E só das linhas pedidas.
 */
function AP_IMG_buscar(tipo, chaves) {
  var origem = AP_IMG_origem_(tipo);
  if (!origem) {
    return { ok: false, codigo: 'TIPO_DESCONHECIDO', mensagem: 'Tipo de imagem não reconhecido: ' + tipo };
  }

  chaves = (chaves || []).filter(Boolean);
  if (!chaves.length) {
    return { ok: true, dados: {}, encontradas: 0, pedidas: 0 };
  }

  if (chaves.length > AP_IMG_CFG.maximoPorLote) {
    return {
      ok: false, codigo: 'LOTE_GRANDE',
      mensagem: 'Peça no máximo ' + AP_IMG_CFG.maximoPorLote + ' imagens por vez. ' +
        'Lotes maiores anulam o ganho de separar as fotos da listagem.',
      maximo: AP_IMG_CFG.maximoPorLote
    };
  }

  var t0 = new Date().getTime();
  var sheet = AP_Data_getSheet(origem.aba);
  var ultimaLinha = sheet.getLastRow();
  var ultimaColuna = sheet.getLastColumn();

  if (ultimaLinha < 2) return { ok: true, dados: {}, encontradas: 0, pedidas: chaves.length };

  var cab = sheet.getRange(1, 1, 1, ultimaColuna).getValues()[0];
  var colChave = cab.indexOf(origem.chave);
  var colFoto = cab.indexOf(origem.coluna);

  if (colChave === -1 || colFoto === -1) {
    return {
      ok: false, codigo: 'COLUNA_AUSENTE',
      mensagem: 'A aba ' + origem.aba + ' não tem as colunas ' + origem.chave + ' e ' + origem.coluna + '.'
    };
  }

  /* lê SÓ a coluna da chave, para achar as linhas */
  var todasChaves = sheet.getRange(2, colChave + 1, ultimaLinha - 1, 1).getValues();

  var linhasQueImportam = [];
  for (var i = 0; i < todasChaves.length; i++) {
    var valor = String(todasChaves[i][0]);
    if (chaves.indexOf(valor) > -1) {
      linhasQueImportam.push({ linha: i + 2, chave: valor });
    }
  }

  /* lê a foto apenas das linhas encontradas, uma por uma —
     é o oposto de carregar a coluna inteira */
  var resultado = {};
  var bytes = 0;

  linhasQueImportam.forEach(function (r) {
    var foto = sheet.getRange(r.linha, colFoto + 1).getValue();
    if (foto) {
      resultado[r.chave] = foto;
      bytes += String(foto).length;
    }
  });

  return {
    ok: true,
    dados: resultado,
    pedidas: chaves.length,
    encontradas: Object.keys(resultado).length,
    semFoto: chaves.filter(function (c) { return !resultado[c]; }),
    bytes: bytes,
    kb: Math.round(bytes / 1024),
    ms: new Date().getTime() - t0
  };
}

/**
 * Quem tem foto e quem não tem, sem trazer nenhuma.
 *
 * A tela usa isto para saber onde mostrar o ícone de "sem foto"
 * antes mesmo de pedir as imagens.
 */
function AP_IMG_quemTem(tipo) {
  var origem = AP_IMG_origem_(tipo);
  if (!origem) return { ok: false, codigo: 'TIPO_DESCONHECIDO' };

  var sheet = AP_Data_getSheet(origem.aba);
  var ultimaLinha = sheet.getLastRow();
  var ultimaColuna = sheet.getLastColumn();
  if (ultimaLinha < 2) return { ok: true, dados: {} };

  var cab = sheet.getRange(1, 1, 1, ultimaColuna).getValues()[0];
  var colChave = cab.indexOf(origem.chave);
  var colFoto = cab.indexOf(origem.coluna);
  if (colChave === -1 || colFoto === -1) return { ok: true, dados: {} };

  var chaves = sheet.getRange(2, colChave + 1, ultimaLinha - 1, 1).getValues();

  /**
   * Aqui está o truque: em vez de ler o conteúdo da coluna de fotos
   * (que são megabytes), pergunta ao Sheets QUAL É O COMPRIMENTO de
   * cada célula. A conta acontece no servidor do Google; o que volta
   * é só um número por linha.
   */
  var comprimentos;
  try {
    var formula = '=ARRAYFORMULA(IF(' +
      AP_IMG_letraColuna_(colFoto + 1) + '2:' + AP_IMG_letraColuna_(colFoto + 1) + ultimaLinha +
      '="",0,LEN(' + AP_IMG_letraColuna_(colFoto + 1) + '2:' +
      AP_IMG_letraColuna_(colFoto + 1) + ultimaLinha + ')))';

    var auxiliar = sheet.getRange(1, ultimaColuna + 2);
    auxiliar.setFormula(formula);
    SpreadsheetApp.flush();
    comprimentos = sheet.getRange(1, ultimaColuna + 2, ultimaLinha - 1, 1).getValues();
    auxiliar.clearContent();
    sheet.getRange(1, ultimaColuna + 2, ultimaLinha - 1, 1).clearContent();
  } catch (e) {
    comprimentos = null;
  }

  var mapa = {};
  for (var i = 0; i < chaves.length; i++) {
    var chave = String(chaves[i][0]);
    if (!chave) continue;
    mapa[chave] = comprimentos ? (Number(comprimentos[i][0]) || 0) > 0 : null;
  }

  return {
    ok: true,
    dados: mapa,
    total: Object.keys(mapa).length,
    comFoto: Object.keys(mapa).filter(function (k) { return mapa[k] === true; }).length,
    /* honesto quando não deu para saber */
    determinado: comprimentos !== null
  };
}

/** Converte 1 → A, 27 → AA */
function AP_IMG_letraColuna_(n) {
  var letra = '';
  while (n > 0) {
    var resto = (n - 1) % 26;
    letra = String.fromCharCode(65 + resto) + letra;
    n = Math.floor((n - 1) / 26);
  }
  return letra;
}

/* ============================================================
   DIAGNÓSTICO
   ============================================================ */

function AP_IMG_diagnostico(tipo) {
  var origem = AP_IMG_origem_(tipo || 'item');
  if (!origem) return { ok: false, codigo: 'TIPO_DESCONHECIDO' };

  var sheet = AP_Data_getSheet(origem.aba);
  var ultimaLinha = sheet.getLastRow();
  var ultimaColuna = sheet.getLastColumn();
  if (ultimaLinha < 2) return { ok: true, dados: { aba: origem.aba, registros: 0 } };

  var cab = sheet.getRange(1, 1, 1, ultimaColuna).getValues()[0];
  var colFoto = cab.indexOf(origem.coluna);
  if (colFoto === -1) {
    return { ok: true, dados: { aba: origem.aba, aviso: 'A aba não tem coluna de foto.' } };
  }

  /* amostra de 15 fotos para estimar o peso */
  var amostra = Math.min(15, ultimaLinha - 1);
  var valores = sheet.getRange(2, colFoto + 1, amostra, 1).getValues();

  var comFoto = 0, bytes = 0, maior = 0;
  valores.forEach(function (v) {
    var t = String(v[0] || '');
    if (t.length > 100) { comFoto++; bytes += t.length; }
    if (t.length > maior) maior = t.length;
  });

  var mediaFoto = comFoto ? Math.round(bytes / comFoto) : 0;
  var registros = ultimaLinha - 1;
  var estimativaTotalMB = Math.round((mediaFoto * registros * (comFoto / amostra)) / 1048576 * 100) / 100;

  return {
    ok: true,
    dados: {
      aba: origem.aba,
      registros: registros,
      amostra: amostra,
      comFotoNaAmostra: comFoto,
      mediaPorFoto: mediaFoto,
      mediaKB: Math.round(mediaFoto / 1024),
      maiorFoto: maior,
      maiorKB: Math.round(maior / 1024),
      estimativaTotalMB: estimativaTotalMB,
      pesadas: maior > AP_IMG_CFG.pesadaAcimaDe,
      conclusao: maior > AP_IMG_CFG.pesadaAcimaDe
        ? 'As fotos são grandes (a maior tem ' + Math.round(maior / 1024) + ' KB). ' +
          'Somadas, cerca de ' + estimativaTotalMB + ' MB. Por isso não devem vir na listagem.'
        : (comFoto
          ? 'As fotos são leves (' + Math.round(mediaFoto / 1024) + ' KB em média). Não são o gargalo.'
          : 'Nenhuma foto encontrada na amostra.')
    }
  };
}

/* ============================================================
   MÓDULO
   ============================================================ */

function AP_Modulo_imagens(acao, payload, sessao) {
  payload = payload || {};

  try {
    switch (acao) {

      /** As fotos de um punhado de registros */
      case 'buscar':
        return AP_IMG_buscar(payload.tipo || 'item', payload.chaves || payload.skus);

      /** Uma foto só */
      case 'uma': {
        var chave = payload.chave || payload.sku;
        if (!chave) return { ok: false, codigo: 'SEM_CHAVE', mensagem: 'Informe qual imagem.' };

        var r = AP_IMG_buscar(payload.tipo || 'item', [chave]);
        if (!r.ok) return r;

        return {
          ok: true,
          dados: { chave: chave, foto: r.dados[chave] || null, temFoto: !!r.dados[chave] }
        };
      }

      case 'quemTem':
        return AP_IMG_quemTem(payload.tipo || 'item');

      case 'diagnostico':
        return AP_IMG_diagnostico(payload.tipo || 'item');

      case 'versao':
        return {
          ok: true,
          dados: {
            motor: 'MOTOR_DE_IMAGENS', versao: AP_IMG_CFG.versao,
            maximoPorLote: AP_IMG_CFG.maximoPorLote,
            tipos: Object.keys(AP_IMG_CFG.origens)
          }
        };

      default:
        return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'imagens.' + acao + ' não existe.' };
    }
  } catch (e) {
    AP_ErrorHandler_capture('AP_Modulo_imagens:' + acao, e);
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'imagens', acao: acao, mensagem: e.message };
  }
}

/* ============================================================
   TESTE
   ============================================================ */
function testeMotorImagens() {
  var log = [];
  function reg(t, ok, d) { log.push((ok ? 'OK    ' : 'ERRO  ') + t + (d ? ' — ' + d : '')); }

  try {
    AP_Modulo_categorias('salvar', { nome: 'Materiais' });

    var foto = 'data:image/jpeg;base64,' + new Array(60000).join('A');
    var skus = [];

    for (var i = 1; i <= 20; i++) {
      var it = AP_Modulo_itens('salvar', {
        descricao: 'Item com foto ' + i, categoria: 'Materiais',
        unidade: 'un', valorUnitario: i,
        foto: i <= 15 ? foto : '',      /* 15 com foto, 5 sem */
        confirmadoNovo: true
      });
      if (it.ok) skus.push(it.dados.sku);
    }

    reg('base de teste criada', skus.length === 20, '20 itens, 15 com foto');

    /* ---------- A LISTAGEM NÃO TRAZ FOTO ---------- */
    var lista = AP_Modulo_itens('listar', {});
    var pesoLista = JSON.stringify(lista.dados).length;
    reg('a listagem continua leve', pesoLista < 50000,
      Math.round(pesoLista / 1024) + ' KB para 20 itens');
    reg('e nenhuma foto vem nela',
      lista.dados.every(function (i) { return !i.foto || String(i.foto).length < 200; }), '');

    /* ---------- O MOTOR BUSCA AS FOTOS ---------- */
    var r = AP_IMG_buscar('item', skus.slice(0, 6));
    reg('busca as fotos pedidas', r.ok && r.encontradas === 6,
      r.encontradas + ' de ' + r.pedidas + ' · ' + r.kb + ' KB');
    reg('as fotos vêm inteiras',
      r.ok && String(r.dados[skus[0]]).indexOf('data:image') === 0, '');

    /* ---------- ITENS SEM FOTO ---------- */
    var semFoto = AP_IMG_buscar('item', skus.slice(15, 20));
    reg('item sem foto não inventa nada',
      semFoto.ok && semFoto.encontradas === 0 && semFoto.semFoto.length === 5,
      '5 itens sem foto, informados como tal');

    /* ---------- LOTE GRANDE É RECUSADO ---------- */
    var grande = AP_IMG_buscar('item', skus);
    reg('recusa lote grande', grande.ok === false && grande.codigo === 'LOTE_GRANDE',
      grande.mensagem.slice(0, 60));

    /* ---------- UMA FOTO SÓ ---------- */
    var uma = AP_Modulo_imagens('uma', { sku: skus[0] }, { usuario: 'teste' });
    reg('busca uma foto', uma.ok && uma.dados.temFoto === true, '');

    var umaSem = AP_Modulo_imagens('uma', { sku: skus[19] }, { usuario: 'teste' });
    reg('e diz quando não tem', umaSem.ok && umaSem.dados.temFoto === false, '');

    var inexistente = AP_Modulo_imagens('uma', { sku: 'NAO-EXISTE' }, { usuario: 'teste' });
    reg('sku inexistente devolve nulo, não erro',
      inexistente.ok && inexistente.dados.foto === null, '');

    /* ---------- DIAGNÓSTICO ---------- */
    var diag = AP_IMG_diagnostico('item');
    reg('diagnóstico mede o peso das fotos',
      diag.ok && diag.dados.mediaKB > 0, diag.dados.mediaKB + ' KB em média');
    reg('e diz se são o gargalo', !!diag.dados.conclusao, diag.dados.conclusao.slice(0, 60));

    /* ---------- COMPARAÇÃO ---------- */
    var pesoTodasFotos = 0;
    for (var j = 0; j < 15; j += 6) {
      var lote = AP_IMG_buscar('item', skus.slice(j, j + 6));
      if (lote.ok) pesoTodasFotos += lote.bytes;
    }
    reg('as fotos, somadas, são muito maiores que a lista',
      pesoTodasFotos > pesoLista * 10,
      Math.round(pesoTodasFotos / 1024) + ' KB de fotos contra ' +
      Math.round(pesoLista / 1024) + ' KB de dados');

    var tipoErrado = AP_IMG_buscar('coisa', ['x']);
    reg('tipo desconhecido é recusado',
      tipoErrado.ok === false && tipoErrado.codigo === 'TIPO_DESCONHECIDO', '');

  } catch (e) {
    log.push('ERRO  exceção: ' + e.message);
  }

  try { Logger.log(log.join('\n')); } catch (e) { }
  return log;
}
