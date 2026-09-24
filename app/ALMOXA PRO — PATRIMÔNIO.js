/**
 * ============================================================
 * ALMOXA PRO — PATRIMÔNIO
 * Versão 1.0.0
 * ------------------------------------------------------------
 * IDENTIFICAÇÃO E RASTREABILIDADE DE EQUIPAMENTOS
 *
 * Cada equipamento ganha um número de patrimônio, uma etiqueta
 * com QR Code e uma página própria que abre no celular — sem
 * login, só lendo o código.
 *
 * ------------------------------------------------------------
 * A PÁGINA PÚBLICA
 *
 * Quem lê o QR Code vê ficha, histórico e manutenções. Não vê
 * custo de aquisição nem fornecedor por padrão: a etiqueta fica
 * colada no equipamento, e qualquer um pode apontar a câmera.
 *
 * O que é sensível só aparece para quem tem sessão.
 * ============================================================
 */

var AP_PAT_CFG = {
  versao: '1.0.0',

  aba: 'ALMOXA_PATRIMONIO',
  colunas: ['patrimonio', 'token', 'descricao', 'categoria', 'marca', 'modelo',
    'numeroSerie', 'notaFiscal', 'pedido', 'fornecedor', 'valorAquisicao',
    'dataAquisicao', 'garantiaAte', 'vidaUtilMeses', 'localizacao', 'obra',
    'responsavel', 'matriculaResponsavel', 'estado', 'situacao',
    'ultimaManutencao', 'proximaManutencao', 'foto', 'observacao',
    /* vínculo com o item já cadastrado no sistema */
    'skuItem', 'limiteUtilizacoes',
    /* código da ficha, impresso na etiqueta e usado no QR */
    'codigoFicha',
    /* as fichas guardadas no Drive: a página e o PDF */
    'fichaHtmlId', 'fichaArquivoId', 'fichaGeradaEm', 'fichaVersao',
    'fichaDesatualizada',
    'criadoEm', 'criadoPor', 'atualizadoEm'],

  abaMovimentos: 'ALMOXA_PATRIMONIO_MOV',
  colunasMovimentos: ['id', 'patrimonio', 'tipo', 'quando', 'usuario',
    'de', 'para', 'motivo', 'documento', 'observacao'],

  abaFotos: 'ALMOXA_PATRIMONIO_FOTOS',
  colunasFotos: ['id', 'patrimonio', 'tipo', 'legenda', 'imagem',
    'ordem', 'enviadaEm', 'enviadaPor'],

  /**
   * As fotos que costumam ser tiradas de um equipamento novo.
   * Servem de sugestão na tela — não impedem outras.
   */
  tiposFoto: [
    { chave: 'PRINCIPAL', rotulo: 'Principal' },
    { chave: 'FRENTE', rotulo: 'Frente' },
    { chave: 'VERSO', rotulo: 'Verso' },
    { chave: 'ETIQUETA', rotulo: 'Etiqueta de patrimônio' },
    { chave: 'PLACA', rotulo: 'Placa do fabricante' },
    { chave: 'SERIE', rotulo: 'Número de série' },
    { chave: 'ACESSORIOS', rotulo: 'Acessórios e maleta' },
    { chave: 'NOTA', rotulo: 'Nota fiscal' },
    { chave: 'AVARIA', rotulo: 'Avaria ou desgaste' },
    { chave: 'OUTRA', rotulo: 'Outra' }
  ],

  abaLacres: 'ALMOXA_PATRIMONIO_LACRES',
  colunasLacres: ['id', 'patrimonio', 'codigo', 'cor', 'instaladoEm',
    'instaladoPor', 'motivo', 'observacao'],

  /**
   * NOTAS FISCAIS E PEDIDOS DO PATRIMÔNIO
   *
   * Um equipamento pode ter mais de uma nota: a da compra, a da
   * peça que trocou, a do acessório comprado depois. Uma nova
   * nunca substitui a anterior.
   */
  abaNotas: 'ALMOXA_PATRIMONIO_NF',
  colunasNotas: ['id', 'patrimonio', 'tipo', 'numero', 'serie', 'fornecedor',
    'cnpj', 'emissao', 'valor', 'documentoUrl', 'documentoId',
    'observacao', 'registradoEm', 'registradoPor'],

  /**
   * INFORMAÇÕES ADICIONAIS
   *
   * O que não cabe nos campos fixos: tensão, peso, acessórios que
   * vieram na maleta, onde fica a chave. Cada equipamento tem as
   * suas, e não dá para prever todas no cadastro.
   */
  abaInfos: 'ALMOXA_PATRIMONIO_INFOS',
  colunasInfos: ['id', 'patrimonio', 'grupo', 'rotulo', 'valor',
    'ordem', 'registradoEm', 'registradoPor'],

  abaDocumentos: 'ALMOXA_PATRIMONIO_DOCS',
  colunasDocumentos: ['id', 'patrimonio', 'tipo', 'nome', 'url',
    'enviadoEm', 'enviadoPor'],

  abaManutencoes: 'ALMOXA_PATRIMONIO_MANUT',
  colunasManutencoes: ['id', 'patrimonio', 'tipo', 'quando', 'executadaPor',
    'descricao', 'custo', 'proximaEm', 'documento', 'registradoPor'],

  prefixo: 'PAT',
  digitos: 6,

  /* tamanhos de etiqueta, em centímetros */
  etiquetas: {
    pequena: { largura: 3.0, altura: 1.5, rotulo: '3,0 × 1,5 cm',
      uso: 'ferramentas e equipamentos pequenos' },
    media: { largura: 4.5, altura: 2.0, rotulo: '4,5 × 2,0 cm',
      uso: 'equipamentos maiores' },
    grande: { largura: 6.0, altura: 3.0, rotulo: '6,0 × 3,0 cm',
      uso: 'máquinas e painéis' }
  },

  estados: ['Novo', 'Bom', 'Regular', 'Ruim', 'Inservível'],
  situacoes: ['ATIVO', 'EM_MANUTENCAO', 'EMPRESTADO', 'BAIXADO', 'EXTRAVIADO'],

  /**
   * O que a página pública NÃO mostra sem sessão.
   * A etiqueta fica no equipamento, à vista de qualquer um.
   */
  camposSensiveis: ['valorAquisicao', 'fornecedor', 'pedido', 'notaFiscal']
};

function AP_PAT_aba_() {
  AP_Data_getSheet(AP_PAT_CFG.aba, AP_PAT_CFG.colunas);
  return AP_PAT_CFG.aba;
}

function AP_PAT_abaMov_() {
  AP_Data_getSheet(AP_PAT_CFG.abaMovimentos, AP_PAT_CFG.colunasMovimentos);
  return AP_PAT_CFG.abaMovimentos;
}

function AP_PAT_abaManut_() {
  AP_Data_getSheet(AP_PAT_CFG.abaManutencoes, AP_PAT_CFG.colunasManutencoes);
  return AP_PAT_CFG.abaManutencoes;
}

function AP_PAT_abaFotos_() {
  AP_Data_getSheet(AP_PAT_CFG.abaFotos, AP_PAT_CFG.colunasFotos);
  return AP_PAT_CFG.abaFotos;
}

function AP_PAT_abaLacres_() {
  AP_Data_getSheet(AP_PAT_CFG.abaLacres, AP_PAT_CFG.colunasLacres);
  return AP_PAT_CFG.abaLacres;
}

function AP_PAT_abaDocs_() {
  AP_Data_getSheet(AP_PAT_CFG.abaDocumentos, AP_PAT_CFG.colunasDocumentos);
  return AP_PAT_CFG.abaDocumentos;
}

function AP_PAT_abaNotas_() {
  AP_Data_getSheet(AP_PAT_CFG.abaNotas, AP_PAT_CFG.colunasNotas);
  return AP_PAT_CFG.abaNotas;
}

function AP_PAT_abaInfos_() {
  AP_Data_getSheet(AP_PAT_CFG.abaInfos, AP_PAT_CFG.colunasInfos);
  return AP_PAT_CFG.abaInfos;
}

/* ============================================================
   NOTAS FISCAIS E PEDIDOS
   ============================================================ */

/**
 * Vincula uma nota fiscal ou pedido ao equipamento.
 *
 * O tipo separa os dois: NF e PEDIDO. Os dois vivem na mesma
 * tabela porque têm os mesmos campos e costumam vir juntos —
 * a nota referencia o pedido que a originou.
 */
function AP_PAT_vincularNota(dados, sessao) {
  var quem = (sessao && sessao.usuario) || 'sistema';

  var r = AP_PAT_obter(dados.patrimonio);
  if (!r.ok) return r;

  if (!dados.numero) {
    return { ok: false, codigo: 'SEM_NUMERO', mensagem: 'Informe o número.' };
  }

  var tipo = (dados.tipo === 'PEDIDO') ? 'PEDIDO' : 'NF';

  /* já existe esta mesma nota neste equipamento? */
  var jaTem = (AP_Data_rows(AP_PAT_abaNotas_()) || []).filter(function (n) {
    return n.patrimonio === dados.patrimonio &&
      n.tipo === tipo &&
      String(n.numero).toUpperCase() === String(dados.numero).toUpperCase();
  })[0];

  if (jaTem) {
    return {
      ok: false, codigo: 'JA_VINCULADA',
      mensagem: (tipo === 'NF' ? 'A nota ' : 'O pedido ') + dados.numero +
        ' já está vinculado a este patrimônio.'
    };
  }

  var registro = {
    id: AP_Utils_generateId(tipo === 'NF' ? 'PNF' : 'PPD'),
    patrimonio: dados.patrimonio,
    tipo: tipo,
    numero: dados.numero,
    serie: dados.serie || '',
    fornecedor: dados.fornecedor || '',
    cnpj: dados.cnpj || '',
    emissao: dados.emissao || '',
    valor: Number(dados.valor) || 0,
    documentoUrl: dados.documentoUrl || '',
    documentoId: dados.documentoId || '',
    observacao: dados.observacao || '',
    registradoEm: AP_Utils_now(),
    registradoPor: quem
  };

  AP_Data_append(AP_PAT_abaNotas_(), registro);

  /* a primeira NF preenche os campos do cadastro, se estiverem vazios */
  if (tipo === 'NF' && !r.dados.notaFiscal) {
    AP_Data_update(AP_PAT_aba_(), dados.patrimonio, {
      notaFiscal: registro.numero,
      fornecedor: r.dados.fornecedor || registro.fornecedor,
      atualizadoEm: AP_Utils_now()
    }, 'patrimonio');
  }
  if (tipo === 'PEDIDO' && !r.dados.pedido) {
    AP_Data_update(AP_PAT_aba_(), dados.patrimonio, {
      pedido: registro.numero, atualizadoEm: AP_Utils_now()
    }, 'patrimonio');
  }

  AP_Audit_log(quem, tipo === 'NF' ? 'NF_VINCULADA' : 'PEDIDO_VINCULADO',
    'PATRIMONIO', dados.patrimonio, { numero: registro.numero });

  /* a ficha no Drive ficou velha: a próxima leitura a refaz */
  AP_PAT_marcarDesatualizada_(dados.patrimonio);

  return { ok: true, dados: registro };
}

function AP_PAT_desvincularNota(id, sessao) {
  var nota = (AP_Data_rows(AP_PAT_abaNotas_()) || []).filter(function (n) {
    return n.id === id;
  })[0];

  if (!nota) return { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Registro não encontrado.' };

  AP_Data_remove(AP_PAT_abaNotas_(), id);

  AP_Audit_log((sessao && sessao.usuario) || 'sistema',
    'NF_DESVINCULADA', 'PATRIMONIO', nota.patrimonio,
    { tipo: nota.tipo, numero: nota.numero });

  return { ok: true, dados: { id: id, patrimonio: nota.patrimonio } };
}

function AP_PAT_notas_(patrimonio, tipo) {
  return (AP_Data_rows(AP_PAT_abaNotas_()) || [])
    .filter(function (n) {
      return n.patrimonio === patrimonio && (!tipo || n.tipo === tipo);
    })
    .sort(function (a, b) {
      return String(b.emissao || b.registradoEm).localeCompare(
        String(a.emissao || a.registradoEm));
    });
}

/* ============================================================
   INFORMAÇÕES ADICIONAIS
   ============================================================ */

function AP_PAT_adicionarInfo(dados, sessao) {
  var quem = (sessao && sessao.usuario) || 'sistema';

  var r = AP_PAT_obter(dados.patrimonio);
  if (!r.ok) return r;

  if (!dados.rotulo) {
    return { ok: false, codigo: 'SEM_ROTULO', mensagem: 'Informe o nome da informação.' };
  }

  var existentes = (AP_Data_rows(AP_PAT_abaInfos_()) || []).filter(function (i) {
    return i.patrimonio === dados.patrimonio;
  });

  /* mesmo rótulo: atualiza em vez de duplicar */
  var mesma = existentes.filter(function (i) {
    return String(i.rotulo).toUpperCase() === String(dados.rotulo).toUpperCase() &&
      String(i.grupo || '') === String(dados.grupo || '');
  })[0];

  if (mesma) {
    AP_Data_update(AP_PAT_abaInfos_(), mesma.id, {
      valor: dados.valor || '',
      registradoEm: AP_Utils_now(), registradoPor: quem
    });
    return { ok: true, dados: { id: mesma.id, rotulo: dados.rotulo, atualizada: true } };
  }

  var info = {
    id: AP_Utils_generateId('INF'),
    patrimonio: dados.patrimonio,
    grupo: dados.grupo || 'Geral',
    rotulo: dados.rotulo,
    valor: dados.valor || '',
    ordem: existentes.length + 1,
    registradoEm: AP_Utils_now(),
    registradoPor: quem
  };

  AP_Data_append(AP_PAT_abaInfos_(), info);

  AP_Audit_log(quem, 'INFO_ADICIONADA', 'PATRIMONIO', dados.patrimonio,
    { rotulo: info.rotulo });

  /* a ficha no Drive ficou velha: a próxima leitura a refaz */
  AP_PAT_marcarDesatualizada_(dados.patrimonio);

  return { ok: true, dados: info };
}

function AP_PAT_removerInfo(id, sessao) {
  var info = (AP_Data_rows(AP_PAT_abaInfos_()) || []).filter(function (i) {
    return i.id === id;
  })[0];
  if (!info) return { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Informação não encontrada.' };

  AP_Data_remove(AP_PAT_abaInfos_(), id);
  return { ok: true, dados: { id: id } };
}

/** As informações adicionais, agrupadas */
function AP_PAT_infos_(patrimonio) {
  var lista = (AP_Data_rows(AP_PAT_abaInfos_()) || [])
    .filter(function (i) { return i.patrimonio === patrimonio; })
    .sort(function (a, b) { return (Number(a.ordem) || 0) - (Number(b.ordem) || 0); });

  /* agrupa para a ficha mostrar em blocos */
  var grupos = {};
  lista.forEach(function (i) {
    var g = i.grupo || 'Geral';
    if (!grupos[g]) grupos[g] = [];
    grupos[g].push({ id: i.id, rotulo: i.rotulo, valor: i.valor });
  });

  return {
    lista: lista,
    grupos: Object.keys(grupos).map(function (g) {
      return { grupo: g, itens: grupos[g] };
    })
  };
}

/* ============================================================
   VÍNCULO COM O CADASTRO DE ITENS
   ------------------------------------------------------------
   O equipamento já existe no Cadastro Central. O patrimônio não
   cria outro registro: aponta para o item e reaproveita foto,
   descrição, marca e modelo.
   ============================================================ */

/** Itens que podem virar patrimônio */
function AP_PAT_itensDisponiveis(busca) {
  var itens = [];
  try {
    var r = AP_Modulo_itens('listar', {}, { perfil: 'ADMINISTRADOR' });
    itens = (r && r.ok) ? r.dados : [];
  } catch (e) { }

  /* quais já têm patrimônio */
  var jaTem = {};
  (AP_Data_rows(AP_PAT_aba_()) || []).forEach(function (p) {
    if (p.skuItem) jaTem[p.skuItem] = (jaTem[p.skuItem] || 0) + 1;
  });

  var t = String(busca || '').toLowerCase();

  return itens.filter(function (i) {
    if (!t) return true;
    return String(i.descricao).toLowerCase().indexOf(t) > -1 ||
      String(i.sku).toLowerCase().indexOf(t) > -1 ||
      String(i.categoria).toLowerCase().indexOf(t) > -1;
  }).map(function (i) {
    return {
      sku: i.sku,
      descricao: i.descricao,
      categoria: i.categoria,
      unidade: i.unidade,
      marca: i.marca || '',
      modelo: i.modelo || '',
      temFoto: !!i.foto,
      estoque: Number(i.estoqueAtual) || 0,
      /* quantos patrimônios já saíram deste item */
      patrimoniosGerados: jaTem[i.sku] || 0
    };
  });
}

/** Puxa os dados do item para o patrimônio */
function AP_PAT_dadosDoItem(sku) {
  var item = null;
  try {
    var r = AP_Modulo_itens('obter', { sku: sku }, { perfil: 'ADMINISTRADOR' });
    if (r && r.ok) item = r.dados;
  } catch (e) { }

  if (!item) {
    return { ok: false, codigo: 'ITEM_NAO_ENCONTRADO', mensagem: 'Item não encontrado no cadastro.' };
  }

  return {
    ok: true,
    dados: {
      skuItem: item.sku,
      descricao: item.descricao,
      categoria: item.categoria || '',
      marca: item.marca || '',
      modelo: item.modelo || '',
      /* a foto vem do item: um cadastro só */
      foto: item.foto || '',
      unidade: item.unidade || 'un',
      valorAquisicao: Number(item.valorUnitario) || 0
    }
  };
}

/* ============================================================
   NUMERAÇÃO
   ============================================================ */

/** Próximo número livre: PAT-000156 */
function AP_PAT_proximoNumero_() {
  var todos = AP_Data_rows(AP_PAT_aba_()) || [];

  var maior = 0;
  todos.forEach(function (p) {
    var n = Number(String(p.patrimonio).replace(/\D/g, ''));
    if (n > maior) maior = n;
  });

  var proximo = maior + 1;
  return AP_PAT_CFG.prefixo + '-' +
    ('0000000000' + proximo).slice(-AP_PAT_CFG.digitos);
}

/**
 * Token da página pública.
 *
 * Não é o número do patrimônio: quem descobre PAT-000156 não
 * deve conseguir adivinhar PAT-000157 e ver o equipamento do lado.
 */
/**
 * Identificador curto da etiqueta.
 *
 * SEIS caracteres, e o motivo é físico: cada caractere a mais no
 * QR aumenta o número de quadradinhos, e numa etiqueta de 1,5cm
 * cada quadradinho já tem menos de meio milímetro. Com 12
 * caracteres o código deixava de ser legível pela câmera.
 *
 * Seis caracteres num alfabeto de 32 dão 1 bilhão de combinações —
 * mais que suficiente, e imprevisível: ninguém adivinha a etiqueta
 * do equipamento ao lado.
 *
 * O alfabeto não tem o, l, 0 e 1, que se confundem quando alguém
 * precisa digitar o código à mão.
 */
function AP_PAT_token_() {
  var alfabeto = 'abcdefghijkmnpqrstuvwxyz23456789';
  var token = '';
  try {
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
      String(new Date().getTime()) + Math.random() + Math.random());
    for (var i = 0; i < 6; i++) {
      token += alfabeto[Math.abs(bytes[i * 3 % bytes.length]) % alfabeto.length];
    }
  } catch (e) {
    for (var j = 0; j < 6; j++) {
      token += alfabeto[Math.floor(Math.random() * alfabeto.length)];
    }
  }
  return token;
}

/**
 * CÓDIGO DA FICHA — o que vai no QR e sob a etiqueta.
 *
 * É separado do número de patrimônio de propósito:
 *
 *   Patrimônio:      PAT-000001   (a numeração da empresa)
 *   Código da ficha: QR-A7K92X4   (o endereço digital)
 *
 * Separar os dois permite trocar a etiqueta sem mexer no número
 * patrimonial, e evita que quem vê PAT-000001 adivinhe a ficha
 * de PAT-000002.
 *
 * Sete caracteres, sem O, I, 0 e 1 — que se confundem quando
 * alguém precisa digitar olhando a etiqueta.
 */
function AP_PAT_codigoFicha_() {
  var alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var codigo = '';
  try {
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
      String(new Date().getTime()) + Math.random() + Math.random());
    for (var i = 0; i < 7; i++) {
      codigo += alfabeto[Math.abs(bytes[i * 3 % bytes.length]) % alfabeto.length];
    }
  } catch (e) {
    for (var j = 0; j < 7; j++) {
      codigo += alfabeto[Math.floor(Math.random() * alfabeto.length)];
    }
  }
  return 'QR-' + codigo;
}

function AP_PAT_codigoFichaUnico_() {
  var usados = {};
  (AP_Data_rows(AP_PAT_aba_()) || []).forEach(function (p) {
    if (p.codigoFicha) usados[p.codigoFicha] = true;
  });

  for (var t = 0; t < 40; t++) {
    var c = AP_PAT_codigoFicha_();
    if (!usados[c]) return c;
  }
  return AP_PAT_codigoFicha_() + '2';
}

/** Garante que não repita — com 1 bilhão é raro, mas é barato conferir */
function AP_PAT_tokenUnico_() {
  var usados = {};
  (AP_Data_rows(AP_PAT_aba_()) || []).forEach(function (p) {
    if (p.token) usados[p.token] = true;
  });

  for (var tentativa = 0; tentativa < 40; tentativa++) {
    var t = AP_PAT_token_();
    if (!usados[t]) return t;
  }
  /* improvável: cai para um mais longo em vez de repetir */
  return AP_PAT_token_() + AP_PAT_token_().slice(0, 2);
}

/* ============================================================
   CADASTRO
   ============================================================ */

function AP_PAT_salvar(dados, sessao) {
  var quem = (sessao && sessao.usuario) || 'sistema';

  if (!dados.descricao && !dados.skuItem) {
    return {
      ok: false, codigo: 'SEM_DESCRICAO',
      mensagem: 'Informe a descrição ou escolha um item do cadastro.'
    };
  }

  var todos = AP_Data_rows(AP_PAT_aba_()) || [];
  var agora = AP_Utils_now();

  /* alteração */
  if (dados.patrimonio) {
    var existente = todos.filter(function (p) {
      return p.patrimonio === dados.patrimonio;
    })[0];

    if (!existente) {
      return {
        ok: false, codigo: 'NAO_ENCONTRADO',
        mensagem: 'O patrimônio ' + dados.patrimonio + ' não existe.'
      };
    }

    var mudancas = {};
    AP_PAT_CFG.colunas.forEach(function (c) {
      if (c === 'patrimonio' || c === 'token' || c === 'criadoEm' || c === 'criadoPor') return;
      if (dados[c] !== undefined) mudancas[c] = dados[c];
    });
    mudancas.atualizadoEm = agora;

    AP_Data_update(AP_PAT_aba_(), dados.patrimonio, mudancas, 'patrimonio');
    AP_PAT_marcarDesatualizada_(dados.patrimonio);
    AP_Audit_log(quem, 'PATRIMONIO_ALTERADO', 'PATRIMONIO', dados.patrimonio, {});

    return { ok: true, dados: Object.assign({}, existente, mudancas), atualizado: true };
  }

  /* número de série repetido costuma ser cadastro em duplicidade */
  if (dados.numeroSerie) {
    var mesmaSerie = todos.filter(function (p) {
      return p.numeroSerie && String(p.numeroSerie) === String(dados.numeroSerie);
    })[0];

    if (mesmaSerie && !dados.confirmarSerieRepetida) {
      return {
        ok: false, codigo: 'SERIE_REPETIDA',
        mensagem: 'O número de série ' + dados.numeroSerie + ' já está no patrimônio ' +
          mesmaSerie.patrimonio + ' (' + mesmaSerie.descricao + '). ' +
          'Confirme se é outro equipamento.',
        dados: { existente: mesmaSerie }
      };
    }
  }

  /**
   * Vinculado a um item do cadastro: os dados vêm de lá.
   *
   * O que a pessoa digitar tem prioridade — ela pode estar
   * corrigindo algo. O que ela deixar em branco vem do item.
   */
  var doItem = {};
  if (dados.skuItem) {
    var ri = AP_PAT_dadosDoItem(dados.skuItem);
    if (ri.ok) doItem = ri.dados;
  }

  var novo = {
    patrimonio: AP_PAT_proximoNumero_(),
    token: AP_PAT_tokenUnico_(),
    codigoFicha: AP_PAT_codigoFichaUnico_(),
    skuItem: dados.skuItem || '',
    limiteUtilizacoes: Number(dados.limiteUtilizacoes) || 0,
    descricao: dados.descricao || doItem.descricao || '',
    categoria: dados.categoria || doItem.categoria || '',
    marca: dados.marca || doItem.marca || '',
    modelo: dados.modelo || doItem.modelo || '',
    numeroSerie: dados.numeroSerie || '',
    notaFiscal: dados.notaFiscal || '',
    pedido: dados.pedido || '',
    fornecedor: dados.fornecedor || '',
    valorAquisicao: Number(dados.valorAquisicao) || 0,
    dataAquisicao: dados.dataAquisicao || '',
    garantiaAte: dados.garantiaAte || '',
    vidaUtilMeses: Number(dados.vidaUtilMeses) || 0,
    localizacao: dados.localizacao || '',
    obra: dados.obra || '',
    responsavel: dados.responsavel || '',
    matriculaResponsavel: dados.matriculaResponsavel || '',
    estado: dados.estado || 'Novo',
    situacao: 'ATIVO',
    ultimaManutencao: '',
    proximaManutencao: dados.proximaManutencao || '',
    /* a foto vem do item: não se cadastra duas vezes */
    foto: dados.foto || doItem.foto || '',
    observacao: dados.observacao || '',
    criadoEm: agora,
    criadoPor: quem,
    atualizadoEm: agora
  };

  AP_Data_append(AP_PAT_aba_(), novo);

  AP_PAT_registrarMovimento_({
    patrimonio: novo.patrimonio, tipo: 'CADASTRO',
    para: novo.localizacao || novo.obra || '',
    motivo: 'Equipamento cadastrado', usuario: quem
  });

  AP_Audit_log(quem, 'PATRIMONIO_CRIADO', 'PATRIMONIO', novo.patrimonio, {
    descricao: novo.descricao, serie: novo.numeroSerie
  });

  return { ok: true, dados: novo };
}

function AP_PAT_obter(patrimonio) {
  var achado = (AP_Data_rows(AP_PAT_aba_()) || []).filter(function (p) {
    return p.patrimonio === patrimonio;
  })[0];

  if (!achado) {
    return { ok: false, codigo: 'NAO_ENCONTRADO', mensagem: 'Patrimônio não cadastrado.' };
  }
  return { ok: true, dados: achado };
}

/**
 * Acha o equipamento pelo que veio da etiqueta.
 *
 * Aceita as três formas: o token interno, o código da ficha
 * (QR-A7K92X4) e o próprio número de patrimônio. Quem digita o
 * código olhando a etiqueta não precisa saber qual é qual.
 */
function AP_PAT_porToken(token) {
  var busca = String(token || '').trim().toUpperCase();
  if (!busca) {
    return { ok: false, codigo: 'SEM_CODIGO', mensagem: 'Informe o código da etiqueta.' };
  }

  var todos = AP_Data_rows(AP_PAT_aba_()) || [];

  var achado = todos.filter(function (p) {
    return String(p.token).toUpperCase() === busca ||
      String(p.codigoFicha).toUpperCase() === busca ||
      String(p.patrimonio).toUpperCase() === busca;
  })[0];

  /* digitou sem o "QR-" */
  if (!achado && busca.indexOf('QR-') !== 0) {
    achado = todos.filter(function (p) {
      return String(p.codigoFicha).toUpperCase() === 'QR-' + busca;
    })[0];
  }

  if (!achado) {
    return {
      ok: false, codigo: 'TOKEN_INVALIDO',
      mensagem: 'Etiqueta não reconhecida. Confira se o código está legível.'
    };
  }
  return { ok: true, dados: achado };
}

/* ============================================================
   MOVIMENTOS E MANUTENÇÕES
   ============================================================ */

function AP_PAT_registrarMovimento_(dados) {
  AP_Data_append(AP_PAT_abaMov_(), {
    id: AP_Utils_generateId('MOV'),
    patrimonio: dados.patrimonio,
    tipo: dados.tipo,
    quando: AP_Utils_now(),
    usuario: dados.usuario || 'sistema',
    de: dados.de || '',
    para: dados.para || '',
    motivo: dados.motivo || '',
    documento: dados.documento || '',
    observacao: dados.observacao || ''
  });
}

function AP_PAT_movimentar(dados, sessao) {
  var quem = (sessao && sessao.usuario) || 'sistema';

  var r = AP_PAT_obter(dados.patrimonio);
  if (!r.ok) return r;
  var pat = r.dados;

  if (pat.situacao === 'BAIXADO') {
    return {
      ok: false, codigo: 'PATRIMONIO_BAIXADO',
      mensagem: 'Este equipamento está baixado e não pode ser movimentado.'
    };
  }

  var mudancas = { atualizadoEm: AP_Utils_now() };
  if (dados.para !== undefined) mudancas.localizacao = dados.para;
  if (dados.obra !== undefined) mudancas.obra = dados.obra;
  if (dados.responsavel !== undefined) mudancas.responsavel = dados.responsavel;
  if (dados.matriculaResponsavel !== undefined) {
    mudancas.matriculaResponsavel = dados.matriculaResponsavel;
  }
  if (dados.situacao) {
    if (AP_PAT_CFG.situacoes.indexOf(dados.situacao) === -1) {
      return {
        ok: false, codigo: 'SITUACAO_INVALIDA',
        mensagem: 'Situação desconhecida. Use: ' + AP_PAT_CFG.situacoes.join(', ')
      };
    }
    mudancas.situacao = dados.situacao;
  }

  /**
   * A origem é lida ANTES de gravar.
   *
   * pat vem de AP_PAT_obter, que devolve a linha viva da tabela:
   * depois do update, pat.localizacao já era o destino, e o
   * histórico registrava "de: Obra B, para: Obra B" — perdendo
   * justamente de onde o equipamento saiu.
   */
  var origem = String(pat.localizacao || '');

  AP_Data_update(AP_PAT_aba_(), dados.patrimonio, mudancas, 'patrimonio');

  AP_PAT_registrarMovimento_({
    patrimonio: dados.patrimonio,
    tipo: dados.tipo || 'TRANSFERENCIA',
    de: origem,
    para: dados.para !== undefined ? dados.para : origem,
    motivo: dados.motivo || '',
    documento: dados.documento || '',
    usuario: quem
  });

  AP_Audit_log(quem, 'PATRIMONIO_MOVIMENTADO', 'PATRIMONIO', dados.patrimonio, {
    de: origem, para: dados.para, tipo: dados.tipo
  });

  /* a ficha no Drive ficou velha: a próxima leitura a refaz */
  AP_PAT_marcarDesatualizada_(dados.patrimonio);

  return { ok: true, dados: Object.assign({}, pat, mudancas) };
}

function AP_PAT_registrarManutencao(dados, sessao) {
  var quem = (sessao && sessao.usuario) || 'sistema';

  var r = AP_PAT_obter(dados.patrimonio);
  if (!r.ok) return r;

  if (!dados.descricao) {
    return { ok: false, codigo: 'SEM_DESCRICAO', mensagem: 'Descreva o que foi feito.' };
  }

  var registro = {
    id: AP_Utils_generateId('MNT'),
    patrimonio: dados.patrimonio,
    tipo: dados.tipo || 'PREVENTIVA',
    quando: dados.quando || AP_Utils_now(),
    executadaPor: dados.executadaPor || '',
    descricao: dados.descricao,
    custo: Number(dados.custo) || 0,
    proximaEm: dados.proximaEm || '',
    documento: dados.documento || '',
    registradoPor: quem
  };

  AP_Data_append(AP_PAT_abaManut_(), registro);

  AP_Data_update(AP_PAT_aba_(), dados.patrimonio, {
    ultimaManutencao: registro.quando,
    proximaManutencao: registro.proximaEm || r.dados.proximaManutencao || '',
    atualizadoEm: AP_Utils_now()
  }, 'patrimonio');

  AP_Audit_log(quem, 'MANUTENCAO_REGISTRADA', 'PATRIMONIO', dados.patrimonio, {
    tipo: registro.tipo, custo: registro.custo
  });

  /* a ficha no Drive ficou velha: a próxima leitura a refaz */
  AP_PAT_marcarDesatualizada_(dados.patrimonio);

  return { ok: true, dados: registro };
}

/* ============================================================
   FOTOS DO EQUIPAMENTO
   ------------------------------------------------------------
   Um equipamento novo chega e vale registrar de vários ângulos:
   frente, verso, a placa do fabricante, a etiqueta, os acessórios
   que vieram na maleta.
   
   Depois, quando houver dúvida sobre o que faltou ou o que já
   estava riscado, as fotos respondem.
   ============================================================ */

function AP_PAT_adicionarFoto(dados, sessao) {
  var quem = (sessao && sessao.usuario) || 'sistema';

  var r = AP_PAT_obter(dados.patrimonio);
  if (!r.ok) return r;

  if (!dados.imagem) {
    return { ok: false, codigo: 'SEM_IMAGEM', mensagem: 'Escolha a imagem.' };
  }

  var imagem = String(dados.imagem);

  /**
   * Fotos grandes travam a planilha.
   *
   * Uma célula do Sheets aguenta 50 mil caracteres. Uma foto de
   * celular em base64 passa de 3 milhões — a gravação falha e o
   * usuário não entende por quê.
   *
   * A tela já reduz a imagem antes de enviar; isto é a rede de
   * segurança para quando alguém enviar por outro caminho.
   */
  if (imagem.length > 45000) {
    return {
      ok: false, codigo: 'IMAGEM_GRANDE',
      mensagem: 'A imagem tem ' + Math.round(imagem.length / 1024) + ' KB e o limite ' +
        'é 45 KB. Reduza a foto antes de enviar — a tela faz isso sozinha.'
    };
  }

  var existentes = (AP_Data_rows(AP_PAT_abaFotos_()) || []).filter(function (f) {
    return f.patrimonio === dados.patrimonio;
  });

  if (existentes.length >= 12) {
    return {
      ok: false, codigo: 'LIMITE_FOTOS',
      mensagem: 'Este equipamento já tem 12 fotos. Remova alguma antes de acrescentar.'
    };
  }

  var foto = {
    id: AP_Utils_generateId('FOT'),
    patrimonio: dados.patrimonio,
    tipo: dados.tipo || 'OUTRA',
    legenda: dados.legenda || '',
    imagem: imagem,
    ordem: existentes.length + 1,
    enviadaEm: AP_Utils_now(),
    enviadaPor: quem
  };

  AP_Data_append(AP_PAT_abaFotos_(), foto);

  /* a primeira foto vira a do cadastro, se ainda não houver */
  if (!r.dados.foto && (foto.tipo === 'PRINCIPAL' || !existentes.length)) {
    AP_Data_update(AP_PAT_aba_(), dados.patrimonio, {
      foto: imagem, atualizadoEm: AP_Utils_now()
    }, 'patrimonio');
  }

  AP_Audit_log(quem, 'FOTO_ADICIONADA', 'PATRIMONIO', dados.patrimonio, {
    tipo: foto.tipo, bytes: imagem.length
  });

  /* a ficha no Drive ficou velha: a próxima leitura a refaz */
  AP_PAT_marcarDesatualizada_(dados.patrimonio);

  return {
    ok: true,
    dados: { id: foto.id, tipo: foto.tipo, legenda: foto.legenda,
      ordem: foto.ordem, total: existentes.length + 1 }
  };
}

function AP_PAT_removerFoto(id, sessao) {
  var foto = (AP_Data_rows(AP_PAT_abaFotos_()) || []).filter(function (f) {
    return f.id === id;
  })[0];

  if (!foto) return { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Foto não encontrada.' };

  AP_Data_remove(AP_PAT_abaFotos_(), id);

  AP_Audit_log((sessao && sessao.usuario) || 'sistema',
    'FOTO_REMOVIDA', 'PATRIMONIO', foto.patrimonio, { tipo: foto.tipo });

  return { ok: true, dados: { id: id, patrimonio: foto.patrimonio } };
}

/**
 * As fotos de um equipamento.
 *
 * Com semImagem, devolve só a lista sem os dados das imagens —
 * é o que a listagem precisa, e evita trafegar megabytes à toa.
 */
function AP_PAT_fotos_(patrimonio, semImagem) {
  var rotulos = {};
  AP_PAT_CFG.tiposFoto.forEach(function (t) { rotulos[t.chave] = t.rotulo; });

  return (AP_Data_rows(AP_PAT_abaFotos_()) || [])
    .filter(function (f) { return f.patrimonio === patrimonio; })
    .sort(function (a, b) { return (Number(a.ordem) || 0) - (Number(b.ordem) || 0); })
    .map(function (f) {
      return {
        id: f.id,
        tipo: f.tipo,
        rotulo: rotulos[f.tipo] || f.tipo,
        legenda: f.legenda,
        /* a ordem precisa vir: é por ela que a galeria e o
           visualizador sabem qual é a próxima foto */
        ordem: Number(f.ordem) || 0,
        imagem: semImagem ? '' : f.imagem,
        temImagem: !!f.imagem,
        enviadaEm: f.enviadaEm,
        enviadaPor: f.enviadaPor
      };
    });
}

/* ============================================================
   QUEM JÁ USOU E ROTATIVIDADE
   ============================================================ */

/**
 * Pessoas que tiveram o equipamento sob responsabilidade.
 *
 * Sai do histórico real de movimentações — não é uma lista à
 * parte que alguém precisa manter.
 */
function AP_PAT_quemUsou_(movimentos) {
  var contagem = {};

  (movimentos || []).forEach(function (m) {
    var pessoa = m.para && m.tipo === 'RETIRADA' ? m.para : (m.usuario || '');
    if (!pessoa || pessoa === 'sistema') return;
    if (!contagem[pessoa]) contagem[pessoa] = { nome: pessoa, vezes: 0, ultima: '' };
    contagem[pessoa].vezes++;
    if (!contagem[pessoa].ultima || m.quando > contagem[pessoa].ultima) {
      contagem[pessoa].ultima = m.quando;
    }
  });

  return Object.keys(contagem).map(function (k) { return contagem[k]; })
    .sort(function (a, b) { return b.vezes - a.vezes; });
}

/**
 * Rotatividade: quantas saídas desde a última manutenção.
 *
 * O limite é configurável por equipamento. Sem limite definido,
 * não inventa um número — apenas conta.
 */
function AP_PAT_rotatividade_(pat, movimentos) {
  var saidas = (movimentos || []).filter(function (m) {
    return m.tipo === 'RETIRADA' || m.tipo === 'SAIDA' || m.tipo === 'EMPRESTIMO';
  });

  var devolucoes = (movimentos || []).filter(function (m) {
    return m.tipo === 'DEVOLUCAO' || m.tipo === 'RETORNO';
  });

  var limite = Number(pat.limiteUtilizacoes) || 0;

  /* só conta a partir da última manutenção */
  var desdeManutencao = saidas.length;
  if (pat.ultimaManutencao) {
    desdeManutencao = saidas.filter(function (m) {
      return m.quando > pat.ultimaManutencao;
    }).length;
  }

  var situacao = 'NORMAL';
  var aviso = null;

  if (limite > 0) {
    var porcento = (desdeManutencao / limite) * 100;
    if (desdeManutencao >= limite) {
      situacao = 'MANUTENCAO_PROGRAMADA';
      aviso = 'Atingiu o limite de ' + limite + ' utilizações. Manutenção programada.';
    } else if (porcento >= 85) {
      situacao = 'PROXIMO_LIMITE';
      aviso = 'Faltam ' + (limite - desdeManutencao) + ' utilizações para a manutenção.';
    }
  }

  return {
    totalSaidas: saidas.length,
    totalDevolucoes: devolucoes.length,
    desdeUltimaManutencao: desdeManutencao,
    limite: limite || null,
    percentual: limite ? Math.min(100, Math.round((desdeManutencao / limite) * 100)) : null,
    situacao: situacao,
    aviso: aviso
  };
}

/* ============================================================
   LACRES
   ============================================================ */

function AP_PAT_trocarLacre(dados, sessao) {
  var quem = (sessao && sessao.usuario) || 'sistema';

  var r = AP_PAT_obter(dados.patrimonio);
  if (!r.ok) return r;

  if (!dados.codigo) {
    return { ok: false, codigo: 'SEM_CODIGO', mensagem: 'Informe o código do lacre.' };
  }

  var registro = {
    id: AP_Utils_generateId('LAC'),
    patrimonio: dados.patrimonio,
    codigo: dados.codigo,
    cor: dados.cor || '',
    instaladoEm: dados.instaladoEm || AP_Utils_now(),
    instaladoPor: dados.instaladoPor || quem,
    motivo: dados.motivo || '',
    observacao: dados.observacao || ''
  };

  AP_Data_append(AP_PAT_abaLacres_(), registro);

  AP_PAT_registrarMovimento_({
    patrimonio: dados.patrimonio, tipo: 'TROCA_LACRE',
    motivo: 'Lacre ' + registro.codigo + (registro.cor ? ' (' + registro.cor + ')' : ''),
    usuario: quem
  });

  AP_Audit_log(quem, 'LACRE_TROCADO', 'PATRIMONIO', dados.patrimonio, {
    codigo: registro.codigo, cor: registro.cor
  });

  /* a ficha no Drive ficou velha: a próxima leitura a refaz */
  AP_PAT_marcarDesatualizada_(dados.patrimonio);

  return { ok: true, dados: registro };
}

function AP_PAT_lacres_(patrimonio) {
  return (AP_Data_rows(AP_PAT_abaLacres_()) || [])
    .filter(function (l) { return l.patrimonio === patrimonio; })
    .sort(function (a, b) { return String(b.instaladoEm).localeCompare(String(a.instaladoEm)); });
}

function AP_PAT_documentos_(patrimonio) {
  return (AP_Data_rows(AP_PAT_abaDocs_()) || [])
    .filter(function (d) { return d.patrimonio === patrimonio; });
}

/* ============================================================
   A FICHA COMPLETA
   ============================================================ */

/**
 * Monta a ficha do equipamento.
 *
 * Sem sessão, os campos sensíveis não entram — nem como campo
 * vazio, para não dar a entender que o dado não existe.
 */
function AP_PAT_ficha(patrimonio, comSessao) {
  var r = AP_PAT_obter(patrimonio);
  if (!r.ok) return r;

  var pat = r.dados;

  var movimentos = (AP_Data_rows(AP_PAT_abaMov_()) || [])
    .filter(function (m) { return m.patrimonio === patrimonio; })
    .reverse();

  var manutencoes = (AP_Data_rows(AP_PAT_abaManut_()) || [])
    .filter(function (m) { return m.patrimonio === patrimonio; })
    .reverse();

  var ficha = {};
  AP_PAT_CFG.colunas.forEach(function (c) {
    if (!comSessao && AP_PAT_CFG.camposSensiveis.indexOf(c) > -1) return;
    ficha[c] = pat[c];
  });

  /* a idade do equipamento, calculada */
  var idadeMeses = null;
  if (pat.dataAquisicao) {
    try {
      var aquisicao = new Date(pat.dataAquisicao);
      var hoje = new Date();
      idadeMeses = Math.max(0,
        (hoje.getFullYear() - aquisicao.getFullYear()) * 12 +
        (hoje.getMonth() - aquisicao.getMonth()));
    } catch (e) { }
  }

  var manutencaoVencida = false;
  if (pat.proximaManutencao) {
    try { manutencaoVencida = new Date(pat.proximaManutencao) < new Date(); } catch (e) { }
  }

  var naGarantia = null;
  if (pat.garantiaAte) {
    try { naGarantia = new Date(pat.garantiaAte) >= new Date(); } catch (e) { }
  }

  var lacres = AP_PAT_lacres_(patrimonio);
  var documentos = AP_PAT_documentos_(patrimonio);

  return {
    ok: true,
    dados: {
      patrimonio: ficha,
      movimentos: movimentos.slice(0, 30),
      manutencoes: manutencoes.slice(0, 20),
      fotos: AP_PAT_fotos_(patrimonio),
      notasFiscais: AP_PAT_notas_(patrimonio, 'NF'),
      pedidos: AP_PAT_notas_(patrimonio, 'PEDIDO'),
      infosAdicionais: AP_PAT_infos_(patrimonio),
      quemUsou: AP_PAT_quemUsou_(movimentos),
      rotatividade: AP_PAT_rotatividade_(pat, movimentos),
      lacreAtual: lacres[0] || null,
      lacres: lacres.slice(0, 10),
      documentos: documentos,
      calculado: {
        idadeMeses: idadeMeses,
        manutencaoVencida: manutencaoVencida,
        naGarantia: naGarantia,
        totalMovimentos: movimentos.length,
        totalManutencoes: manutencoes.length,
        custoManutencoes: comSessao
          ? manutencoes.reduce(function (s, m) { return s + (Number(m.custo) || 0); }, 0)
          : null
      },
      publica: !comSessao
    }
  };
}

/* ============================================================
   ETIQUETAS
   ============================================================ */

/**
 * Prepara os dados das etiquetas.
 *
 * Não desenha nada: devolve o que a tela precisa para imprimir.
 * O desenho é do frontend, que sabe do papel e da impressora.
 */
function AP_PAT_etiquetas(dados) {
  var tamanho = AP_PAT_CFG.etiquetas[dados.tamanho || 'pequena'];
  if (!tamanho) {
    return {
      ok: false, codigo: 'TAMANHO_INVALIDO',
      mensagem: 'Tamanho desconhecido. Use: ' + Object.keys(AP_PAT_CFG.etiquetas).join(', ')
    };
  }

  var todos = AP_Data_rows(AP_PAT_aba_()) || [];
  var escolhidos;

  if (dados.patrimonios && dados.patrimonios.length) {
    escolhidos = todos.filter(function (p) {
      return dados.patrimonios.indexOf(p.patrimonio) > -1;
    });
  } else if (dados.todos) {
    escolhidos = todos.filter(function (p) { return p.situacao !== 'BAIXADO'; });
  } else {
    return {
      ok: false, codigo: 'NADA_ESCOLHIDO',
      mensagem: 'Escolha quais patrimônios receberão etiqueta.'
    };
  }

  if (!escolhidos.length) {
    return { ok: false, codigo: 'SEM_PATRIMONIOS', mensagem: 'Nenhum patrimônio encontrado.' };
  }

  var base = '';
  try { base = ScriptApp.getService().getUrl(); } catch (e) { }

  /**
   * O TAMANHO DA URL DECIDE SE O QR LÊ
   *
   * A URL do Apps Script tem cerca de 140 caracteres. Um QR com
   * isso dentro precisa de 49 módulos — e numa etiqueta de 1,5cm
   * cada módulo fica com 0,2mm. Nenhum celular lê.
   *
   * Com um endereço curto configurado, o QR cai para 21 módulos
   * e cada um fica com 0,5mm: aí lê.
   *
   * Sem endereço curto, a etiqueta pequena não é confiável — e o
   * sistema avisa em vez de imprimir algo que não funciona.
   */
  /**
   * PARA ONDE O QR APONTA
   *
   * Em ordem de preferência:
   *
   * 1. PATRIMONIO_URL_CURTA — um domínio próprio, o menor de todos
   * 2. PATRIMONIO_URL_FICHA — o servidor de fichas, projeto separado
   * 3. o próprio sistema — funciona, mas é o endereço mais longo
   *
   * O servidor de fichas existe porque o Apps Script só aceita um
   * doGet por projeto: junto do sistema, a ficha disputava a
   * entrada e acabava abrindo o ALMOXA PRO.
   */
  var enderecoCurto = AP_Config_get('PATRIMONIO_URL_CURTA', '');
  var servidorFicha = AP_Config_get('PATRIMONIO_URL_FICHA', '');
  var usandoCurta = !!enderecoCurto;

  var copias = Math.max(1, Math.min(20, Number(dados.copias) || 1));
  var lista = [];

  escolhidos.forEach(function (p) {
    /* o código da ficha é o que identifica; o token antigo continua
       valendo para as etiquetas já impressas */
    var chave = p.codigoFicha || p.token;

    /**
     * O CAMINHO É UM SÓ: ?f=
     *
     * Antes a etiqueta gerava "?pat=" e a tela da ficha digital
     * mostrava "?f=". Quem lia o QR caía num caminho e quem testava
     * pela tela, noutro — e o comportamento era diferente.
     */
    var url;
    if (usandoCurta) {
      url = enderecoCurto.replace(/\/+$/, '') + '/' + chave;
    } else if (servidorFicha) {
      url = servidorFicha.replace(/\/+$/, '') + '?f=' + chave;
    } else {
      url = base ? base + '?f=' + chave : '?f=' + chave;
    }

    for (var c = 0; c < copias; c++) {
      lista.push({
        patrimonio: p.patrimonio,
        descricao: p.descricao,
        categoria: p.categoria,
        /* impresso abaixo do QR: permite achar a ficha digitando */
        codigoFicha: p.codigoFicha || '',
        numeroCurto: String(p.patrimonio).replace(/\D/g, '').replace(/^0+/, ''),
        url: url,
        token: p.token
      });
    }
  });

  /**
   * Quantos milímetros cada quadradinho do QR terá no papel.
   *
   * A conta precisa bater com o que a tela desenha: margem de
   * 0,7mm de cada lado e o QR com 96% da altura útil. Se as duas
   * contas divergirem, o aviso mente — e o usuário só descobre
   * depois de imprimir.
   */
  var alturaMm = tamanho.altura * 10;
  var qrMm = (alturaMm - 1.4) * 0.96;
  var texto = lista.length ? lista[0].url : '';
  var modulos = AP_PAT_modulosDoQR_(texto, 'M');
  /* margem de 2 módulos de cada lado, como o gerador desenha */
  var mmPorModulo = modulos ? qrMm / (modulos + 4) : 0;
  var nivel = 'M';

  /* não coube em M: tenta com correção reduzida antes de desistir */
  if (mmPorModulo < 0.38) {
    var modulosL = AP_PAT_modulosDoQR_(texto, 'L');
    var mmL = modulosL ? qrMm / (modulosL + 4) : 0;
    if (mmL >= 0.38) {
      nivel = 'L'; modulos = modulosL; mmPorModulo = mmL;
    }
  }

  var legivel = mmPorModulo >= 0.38;

  return {
    ok: true,
    dados: {
      etiquetas: lista,
      tamanho: Object.assign({ chave: dados.tamanho || 'pequena' }, tamanho),
      quantidade: lista.length,
      patrimonios: escolhidos.length,
      copias: copias,
      /* o que decide se o celular vai conseguir ler */
      qr: {
        caracteres: texto.length,
        modulos: modulos,
        nivelCorrecao: nivel,
        mmPorModulo: Math.round(mmPorModulo * 1000) / 1000,
        legivel: legivel,
        usandoEnderecoCurto: usandoCurta,
        usandoServidorFicha: !usandoCurta && !!servidorFicha,
        destino: usandoCurta ? 'Endereço curto'
          : (servidorFicha ? 'Servidor de fichas' : 'Sistema principal'),
        aviso: legivel ? null
          : 'O QR vai ficar com ' + mmPorModulo.toFixed(2) + 'mm por quadradinho. ' +
            'Abaixo de 0,38mm a câmera do celular não lê. ' +
            (usandoCurta
              ? 'Use a etiqueta maior.'
              : 'Use a etiqueta de 4,5 × 2,0 cm, ou configure um endereço curto ' +
                'em PATRIMONIO_URL_CURTA.')
      }
    }
  };
}

/** Quantos módulos o QR vai ter com esse texto e nível */
function AP_PAT_modulosDoQR_(texto, nivel) {
  var n = String(texto || '').length;

  /* capacidade em bytes por versão */
  var limites = (nivel === 'L')
    ? [{ tam: 21, cabe: 17 }, { tam: 25, cabe: 32 }, { tam: 29, cabe: 53 },
       { tam: 33, cabe: 78 }, { tam: 37, cabe: 106 }, { tam: 41, cabe: 134 },
       { tam: 45, cabe: 154 }, { tam: 49, cabe: 192 }, { tam: 53, cabe: 230 },
       { tam: 57, cabe: 271 }]
    : [{ tam: 21, cabe: 14 }, { tam: 25, cabe: 26 }, { tam: 29, cabe: 42 },
       { tam: 33, cabe: 62 }, { tam: 37, cabe: 84 }, { tam: 41, cabe: 106 },
       { tam: 45, cabe: 122 }, { tam: 49, cabe: 152 }, { tam: 53, cabe: 180 },
       { tam: 57, cabe: 213 }];

  for (var i = 0; i < limites.length; i++) {
    if (n <= limites[i].cabe) return limites[i].tam;
  }
  return 0;
}

/* ============================================================
   MÓDULO
   ============================================================ */

function AP_Modulo_patrimonio(acao, payload, sessao) {
  payload = payload || {};
  var comSessao = !!(sessao && sessao.usuario);

  try {
    switch (acao) {

      case 'listar': {
        var todos = AP_Data_rows(AP_PAT_aba_()) || [];

        if (payload.categoria) {
          todos = todos.filter(function (p) { return p.categoria === payload.categoria; });
        }
        if (payload.situacao) {
          todos = todos.filter(function (p) { return p.situacao === payload.situacao; });
        }
        if (payload.busca) {
          var t = String(payload.busca).toLowerCase();
          todos = todos.filter(function (p) {
            return String(p.descricao).toLowerCase().indexOf(t) > -1 ||
              String(p.patrimonio).toLowerCase().indexOf(t) > -1 ||
              String(p.numeroSerie).toLowerCase().indexOf(t) > -1 ||
              String(p.marca).toLowerCase().indexOf(t) > -1;
          });
        }

        /* a listagem não carrega foto: são muitas e pesam */
        return {
          ok: true,
          dados: todos.map(function (p) {
            var copia = {};
            Object.keys(p).forEach(function (k) {
              if (k === 'foto') { copia.temFoto = !!p.foto; return; }
              copia[k] = p[k];
            });
            return copia;
          })
        };
      }

      case 'obter':
        return AP_PAT_obter(payload.patrimonio);

      case 'ficha':
        if (!payload.patrimonio) {
          return { ok: false, codigo: 'SEM_PATRIMONIO', mensagem: 'Informe o patrimônio.' };
        }
        return AP_PAT_ficha(payload.patrimonio, comSessao);

      case 'porToken': {
        var r = AP_PAT_porToken(payload.token);
        if (!r.ok) return r;
        return AP_PAT_ficha(r.dados.patrimonio, comSessao);
      }

      case 'salvar':
        return AP_PAT_salvar(payload, sessao);

      case 'criarSerie':
        return AP_PAT_criarSerie(payload, sessao);

      case 'movimentar':
        if (!payload.patrimonio) {
          return { ok: false, codigo: 'SEM_PATRIMONIO', mensagem: 'Informe o patrimônio.' };
        }
        return AP_PAT_movimentar(payload, sessao);

      case 'manutencao':
        if (!payload.patrimonio) {
          return { ok: false, codigo: 'SEM_PATRIMONIO', mensagem: 'Informe o patrimônio.' };
        }
        return AP_PAT_registrarManutencao(payload, sessao);

      case 'etiquetas':
        return AP_PAT_etiquetas(payload);

      case 'itensDisponiveis':
        return { ok: true, dados: AP_PAT_itensDisponiveis(payload.busca) };

      case 'dadosDoItem':
        if (!payload.sku) return { ok: false, codigo: 'SEM_SKU', mensagem: 'Informe o item.' };
        return AP_PAT_dadosDoItem(payload.sku);

      case 'lacre':
        return AP_PAT_trocarLacre(payload, sessao);

      case 'vincularNota':
        if (!payload.patrimonio) {
          return { ok: false, codigo: 'SEM_PATRIMONIO', mensagem: 'Informe o patrimônio.' };
        }
        return AP_PAT_vincularNota(payload, sessao);

      case 'desvincularNota':
        if (!payload.id) return { ok: false, codigo: 'SEM_ID', mensagem: 'Informe o registro.' };
        return AP_PAT_desvincularNota(payload.id, sessao);

      case 'notas':
        if (!payload.patrimonio) {
          return { ok: false, codigo: 'SEM_PATRIMONIO', mensagem: 'Informe o patrimônio.' };
        }
        return { ok: true, dados: AP_PAT_notas_(payload.patrimonio, payload.tipo) };

      case 'adicionarInfo':
        if (!payload.patrimonio) {
          return { ok: false, codigo: 'SEM_PATRIMONIO', mensagem: 'Informe o patrimônio.' };
        }
        return AP_PAT_adicionarInfo(payload, sessao);

      case 'removerInfo':
        if (!payload.id) return { ok: false, codigo: 'SEM_ID', mensagem: 'Informe a informação.' };
        return AP_PAT_removerInfo(payload.id, sessao);

      case 'infos':
        if (!payload.patrimonio) {
          return { ok: false, codigo: 'SEM_PATRIMONIO', mensagem: 'Informe o patrimônio.' };
        }
        return { ok: true, dados: AP_PAT_infos_(payload.patrimonio) };

      case 'adicionarFoto':
        if (!payload.patrimonio) {
          return { ok: false, codigo: 'SEM_PATRIMONIO', mensagem: 'Informe o patrimônio.' };
        }
        return AP_PAT_adicionarFoto(payload, sessao);

      case 'removerFoto':
        if (!payload.id) return { ok: false, codigo: 'SEM_ID', mensagem: 'Informe a foto.' };
        return AP_PAT_removerFoto(payload.id, sessao);

      case 'fotos':
        if (!payload.patrimonio) {
          return { ok: false, codigo: 'SEM_PATRIMONIO', mensagem: 'Informe o patrimônio.' };
        }
        return { ok: true, dados: AP_PAT_fotos_(payload.patrimonio, payload.semImagem) };

      case 'tiposFoto':
        return { ok: true, dados: AP_PAT_CFG.tiposFoto };

      case 'enviarDocumento':
        if (!payload.patrimonio) {
          return { ok: false, codigo: 'SEM_PATRIMONIO', mensagem: 'Informe o patrimônio.' };
        }
        return AP_PAT_enviarDocumento(payload, sessao);

      case 'removerDocumento':
        if (!payload.id) return { ok: false, codigo: 'SEM_ID', mensagem: 'Informe o documento.' };
        return AP_PAT_removerDocumento(payload.id, sessao);

      case 'documentos':
        if (!payload.patrimonio) {
          return { ok: false, codigo: 'SEM_PATRIMONIO', mensagem: 'Informe o patrimônio.' };
        }
        return { ok: true, dados: AP_PAT_documentos_(payload.patrimonio) };

      case 'documento': {
        if (!payload.patrimonio || !payload.url) {
          return { ok: false, codigo: 'DADOS_INCOMPLETOS', mensagem: 'Informe o patrimônio e o documento.' };
        }
        var doc = {
          id: AP_Utils_generateId('DOC'),
          patrimonio: payload.patrimonio,
          tipo: payload.tipo || 'OUTRO',
          nome: payload.nome || 'Documento',
          url: payload.url,
          enviadoEm: AP_Utils_now(),
          enviadoPor: (sessao && sessao.usuario) || 'sistema'
        };
        AP_Data_append(AP_PAT_abaDocs_(), doc);
        return { ok: true, dados: doc };
      }

      case 'tamanhos':
        return {
          ok: true,
          dados: Object.keys(AP_PAT_CFG.etiquetas).map(function (k) {
            return Object.assign({ chave: k }, AP_PAT_CFG.etiquetas[k]);
          })
        };

      case 'resumo': {
        var lista = AP_Data_rows(AP_PAT_aba_()) || [];
        var conta = function (st) {
          return lista.filter(function (p) { return p.situacao === st; }).length;
        };

        var vencidas = lista.filter(function (p) {
          if (!p.proximaManutencao) return false;
          try { return new Date(p.proximaManutencao) < new Date(); } catch (e) { return false; }
        }).length;

        return {
          ok: true,
          dados: {
            total: lista.length,
            ativos: conta('ATIVO'),
            emManutencao: conta('EM_MANUTENCAO'),
            emprestados: conta('EMPRESTADO'),
            baixados: conta('BAIXADO'),
            extraviados: conta('EXTRAVIADO'),
            manutencoesVencidas: vencidas,
            valorTotal: comSessao
              ? lista.reduce(function (s, p) { return s + (Number(p.valorAquisicao) || 0); }, 0)
              : null
          }
        };
      }

      case 'proximoNumero':
        return { ok: true, dados: { patrimonio: AP_PAT_proximoNumero_() } };

      /** Gera um código novo para a ficha — usado ao reimprimir etiqueta */
      case 'gerarFicha':
        if (!payload.patrimonio) {
          return { ok: false, codigo: 'SEM_PATRIMONIO', mensagem: 'Informe o patrimônio.' };
        }
        return AP_PAT_gerarFicha(payload.patrimonio, sessao);

      case 'garantirFicha':
        if (!payload.patrimonio) {
          return { ok: false, codigo: 'SEM_PATRIMONIO', mensagem: 'Informe o patrimônio.' };
        }
        return AP_PAT_garantirFichaAtual(payload.patrimonio, sessao);

      case 'localizarFicha':
        if (!payload.codigo) {
          return { ok: false, codigo: 'SEM_CODIGO', mensagem: 'Informe o código da ficha.' };
        }
        return AP_PAT_localizarFicha(payload.codigo);

      case 'novoCodigoFicha': {
        if (!payload.patrimonio) {
          return { ok: false, codigo: 'SEM_PATRIMONIO', mensagem: 'Informe o patrimônio.' };
        }
        var rp = AP_PAT_obter(payload.patrimonio);
        if (!rp.ok) return rp;

        var novoCodigo = AP_PAT_codigoFichaUnico_();
        AP_Data_update(AP_PAT_aba_(), payload.patrimonio, {
          codigoFicha: novoCodigo, atualizadoEm: AP_Utils_now()
        }, 'patrimonio');

        AP_Audit_log((sessao && sessao.usuario) || 'sistema',
          'CODIGO_FICHA_TROCADO', 'PATRIMONIO', payload.patrimonio,
          { de: rp.dados.codigoFicha, para: novoCodigo });

        return { ok: true, dados: { patrimonio: payload.patrimonio, codigoFicha: novoCodigo } };
      }

      case 'versao':
        return {
          ok: true,
          dados: {
            modulo: 'PATRIMONIO', versao: AP_PAT_CFG.versao,
            estados: AP_PAT_CFG.estados,
            situacoes: AP_PAT_CFG.situacoes,
            tamanhosEtiqueta: Object.keys(AP_PAT_CFG.etiquetas)
          }
        };

      default:
        return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'patrimonio.' + acao + ' não existe.' };
    }
  } catch (e) {
    AP_ErrorHandler_capture('AP_Modulo_patrimonio:' + acao, e);
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'patrimonio', acao: acao, mensagem: e.message };
  }
}

/* ============================================================
   TESTE
   ============================================================ */
function testePatrimonio() {
  var log = [];
  function reg(t, ok, d) { log.push((ok ? 'OK    ' : 'ERRO  ') + t + (d ? ' — ' + d : '')); }

  var sessao = { usuario: 'ismael', perfil: 'admin' };

  try {
    /* ---------- CADASTRO ---------- */
    var p1 = AP_PAT_salvar({
      descricao: 'Parafusadeira', categoria: 'Ferramenta',
      marca: 'Dewalt', modelo: 'DCD7781', numeroSerie: '78965',
      notaFiscal: 'NF 123456', pedido: 'OC 78910',
      fornecedor: 'Ferramentas Sul Ltda',
      valorAquisicao: 1250, dataAquisicao: '2024-03-17',
      garantiaAte: '2026-03-17', vidaUtilMeses: 60,
      localizacao: 'Almoxarifado - Obra A', responsavel: 'João Silva',
      estado: 'Bom', proximaManutencao: '2027-03-10'
    }, sessao);

    reg('cadastra o equipamento', p1.ok, p1.ok ? p1.dados.patrimonio : p1.mensagem);
    reg('numera no formato certo',
      p1.ok && /^PAT-\d{6}$/.test(p1.dados.patrimonio), p1.dados.patrimonio);
    reg('gera token para a etiqueta',
      p1.ok && (p1.dados.token || '').length === 12, p1.dados.token);
    reg('o token NÃO é o número do patrimônio',
      p1.dados.token.indexOf('PAT') === -1 && !/\d{6}/.test(p1.dados.token),
      'quem vê um não adivinha o outro');

    var p2 = AP_PAT_salvar({ descricao: 'Serra Mármore', categoria: 'Ferramenta' }, sessao);
    reg('o número avança', p2.ok && p2.dados.patrimonio !== p1.dados.patrimonio,
      p1.dados.patrimonio + ' → ' + p2.dados.patrimonio);
    reg('cada um tem seu token', p2.dados.token !== p1.dados.token, '');

    var semDescricao = AP_PAT_salvar({ marca: 'X' }, sessao);
    reg('exige a descrição', semDescricao.ok === false, semDescricao.codigo);

    /* ---------- SÉRIE REPETIDA ---------- */
    var repetida = AP_PAT_salvar({
      descricao: 'Outra parafusadeira', numeroSerie: '78965'
    }, sessao);
    reg('AVISA número de série repetido',
      repetida.ok === false && repetida.codigo === 'SERIE_REPETIDA',
      repetida.mensagem.slice(0, 60));

    var confirmada = AP_PAT_salvar({
      descricao: 'Outra parafusadeira', numeroSerie: '78965', confirmarSerieRepetida: true
    }, sessao);
    reg('mas permite se confirmarem', confirmada.ok, '');

    /* ---------- A PÁGINA PÚBLICA ---------- */
    var publica = AP_Modulo_patrimonio('porToken', { token: p1.dados.token }, null);
    reg('a etiqueta abre a ficha', publica.ok, '');
    reg('mostra o que interessa no campo',
      publica.dados.patrimonio.descricao === 'Parafusadeira' &&
      publica.dados.patrimonio.marca === 'Dewalt' &&
      publica.dados.patrimonio.numeroSerie === '78965', '');

    reg('NÃO mostra o valor sem login',
      publica.dados.patrimonio.valorAquisicao === undefined,
      'a etiqueta fica à vista de qualquer um');
    reg('NÃO mostra o fornecedor sem login',
      publica.dados.patrimonio.fornecedor === undefined, '');
    reg('NÃO mostra a nota fiscal sem login',
      publica.dados.patrimonio.notaFiscal === undefined, '');
    reg('e avisa que é a versão pública', publica.dados.publica === true, '');

    var comLogin = AP_Modulo_patrimonio('porToken', { token: p1.dados.token }, sessao);
    reg('com login, o valor aparece',
      comLogin.dados.patrimonio.valorAquisicao === 1250, 'R$ 1.250,00');
    reg('e o fornecedor também',
      comLogin.dados.patrimonio.fornecedor === 'Ferramentas Sul Ltda', '');

    var tokenFalso = AP_Modulo_patrimonio('porToken', { token: 'inventado1234' }, null);
    reg('token inventado é recusado',
      tokenFalso.ok === false && tokenFalso.codigo === 'TOKEN_INVALIDO', '');

    /* ---------- MOVIMENTAÇÃO ---------- */
    var mov = AP_PAT_movimentar({
      patrimonio: p1.dados.patrimonio,
      tipo: 'TRANSFERENCIA', para: 'Obra B — Canteiro 2',
      responsavel: 'Maria Souza', motivo: 'Realocação de equipe'
    }, sessao);
    reg('movimenta o equipamento', mov.ok, mov.ok ? mov.dados.localizacao : mov.mensagem);

    var ficha = AP_PAT_ficha(p1.dados.patrimonio, true);
    reg('o histórico registra tudo',
      ficha.dados.movimentos.length === 2, 'cadastro + transferência');
    reg('e guarda de onde veio',
      ficha.dados.movimentos[0].de === 'Almoxarifado - Obra A' &&
      ficha.dados.movimentos[0].para === 'Obra B — Canteiro 2', '');

    /* ---------- MANUTENÇÃO ---------- */
    var manut = AP_PAT_registrarManutencao({
      patrimonio: p1.dados.patrimonio, tipo: 'PREVENTIVA',
      descricao: 'Troca de escovas e limpeza', executadaPor: 'Assistência Dewalt',
      custo: 180, proximaEm: '2027-09-10'
    }, sessao);
    reg('registra a manutenção', manut.ok, '');

    var apos = AP_PAT_obter(p1.dados.patrimonio);
    reg('a próxima manutenção é atualizada',
      apos.dados.proximaManutencao === '2027-09-10', apos.dados.proximaManutencao);

    var semDesc = AP_PAT_registrarManutencao({ patrimonio: p1.dados.patrimonio }, sessao);
    reg('manutenção exige descrição', semDesc.ok === false, semDesc.codigo);

    /* ---------- O QUE É CALCULADO ---------- */
    var f2 = AP_PAT_ficha(p1.dados.patrimonio, true);
    reg('calcula a idade do equipamento',
      f2.dados.calculado.idadeMeses !== null && f2.dados.calculado.idadeMeses > 12,
      f2.dados.calculado.idadeMeses + ' meses');
    reg('soma o custo das manutenções',
      f2.dados.calculado.custoManutencoes === 180, 'R$ 180,00');

    var f3 = AP_PAT_ficha(p1.dados.patrimonio, false);
    reg('sem login, o custo de manutenção não aparece',
      f3.dados.calculado.custoManutencoes === null, '');

    /* ---------- ETIQUETAS ---------- */
    var etiq = AP_PAT_etiquetas({
      patrimonios: [p1.dados.patrimonio, p2.dados.patrimonio], tamanho: 'pequena'
    });
    reg('prepara as etiquetas', etiq.ok && etiq.dados.quantidade === 2,
      etiq.dados.quantidade + ' etiquetas');
    reg('no tamanho pedido',
      etiq.dados.tamanho.largura === 3.0 && etiq.dados.tamanho.altura === 1.5,
      etiq.dados.tamanho.rotulo);
    reg('cada uma com seu endereço',
      etiq.dados.etiquetas[0].url.indexOf(p1.dados.token) > -1, '');
    reg('e com o número curto para conferir',
      etiq.dados.etiquetas[0].numeroCurto === '1', 'PAT-000001 → 1');

    var varias = AP_PAT_etiquetas({
      patrimonios: [p1.dados.patrimonio], tamanho: 'media', copias: 4
    });
    reg('faz várias cópias da mesma', varias.dados.quantidade === 4, '');

    var tamanhoRuim = AP_PAT_etiquetas({ patrimonios: [p1.dados.patrimonio], tamanho: 'gigante' });
    reg('recusa tamanho desconhecido',
      tamanhoRuim.ok === false && tamanhoRuim.codigo === 'TAMANHO_INVALIDO', '');

    var semEscolha = AP_PAT_etiquetas({ tamanho: 'pequena' });
    reg('exige escolher os patrimônios',
      semEscolha.ok === false && semEscolha.codigo === 'NADA_ESCOLHIDO', '');

    /* ---------- BAIXA ---------- */
    AP_PAT_movimentar({
      patrimonio: p2.dados.patrimonio, situacao: 'BAIXADO', motivo: 'Fim de vida útil'
    }, sessao);

    var moverBaixado = AP_PAT_movimentar({
      patrimonio: p2.dados.patrimonio, para: 'Obra C'
    }, sessao);
    reg('NÃO movimenta equipamento baixado',
      moverBaixado.ok === false && moverBaixado.codigo === 'PATRIMONIO_BAIXADO', '');

    var todasEtiq = AP_PAT_etiquetas({ todos: true, tamanho: 'pequena' });
    reg('etiqueta de "todos" pula os baixados',
      todasEtiq.dados.etiquetas.every(function (e) {
        return e.patrimonio !== p2.dados.patrimonio;
      }), '');

    /* ---------- RESUMO ---------- */
    var resumo = AP_Modulo_patrimonio('resumo', {}, sessao);
    reg('resumo conta as situações',
      resumo.dados.total === 3 && resumo.dados.baixados === 1,
      resumo.dados.total + ' equipamentos, ' + resumo.dados.baixados + ' baixado');

    var resumoPublico = AP_Modulo_patrimonio('resumo', {}, null);
    reg('sem login, o valor total não aparece',
      resumoPublico.dados.valorTotal === null, '');

  } catch (e) {
    log.push('ERRO  exceção: ' + e.message);
  }

  try { Logger.log(log.join('\n')); } catch (e) { }
  return log;
}


/* ============================================================
   FICHA EM PDF NO DRIVE
   ------------------------------------------------------------
   Cada patrimônio ganha um PDF com tudo o que se sabe sobre ele.
   O arquivo fica numa pasta do Drive, e o banco guarda só o ID.

   Quem lê o QR não precisa achar arquivo nenhum: o sistema
   recebe o código, procura o ID e abre.
   ============================================================ */

var AP_PAT_PASTA_FICHAS = 'ALMOXA PRO — Fichas de Patrimônio';

function AP_PAT_pastaFichas_() {
  var nome = AP_Config_get('PATRIMONIO_PASTA_FICHAS', AP_PAT_PASTA_FICHAS);
  var pastas = DriveApp.getFoldersByName(nome);
  if (pastas.hasNext()) return pastas.next();
  return DriveApp.createFolder(nome);
}

/**
 * Gera a ficha em PDF e guarda no Drive.
 *
 * Se já existir uma ficha, a antiga vai para a lixeira — senão a
 * pasta enche de versões e ninguém sabe qual é a boa.
 */
function AP_PAT_gerarFicha(patrimonio, sessao) {
  var quem = (sessao && sessao.usuario) || 'sistema';

  var r = AP_PAT_ficha(patrimonio, true);
  if (!r.ok) return r;

  var d = r.dados;
  var p = d.patrimonio;

  try {
    /**
     * DUAS FICHAS, DOIS USOS
     *
     * O HTML é o que o QR Code abre: uma página que carrega rápido
     * no celular, com abas e busca. O PDF é para imprimir, anexar
     * num e-mail ou guardar.
     *
     * Antes só o PDF era gerado — e o servidor de fichas, que
     * procura o HTML primeiro, nunca o encontrava. Quem lia o QR
     * caía na ficha resumida de emergência.
     */
    var htmlPagina = AP_PAT_paginaDaFicha_(d);
    var htmlImpressao = AP_PAT_htmlDaFicha_(d);

    var pasta = AP_PAT_pastaFichas_();

    /* as anteriores saem de circulação */
    var anteriorPdf = p.fichaArquivoId;
    var anteriorHtml = p.fichaHtmlId;
    [anteriorPdf, anteriorHtml].forEach(function (id) {
      if (!id) return;
      try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { }
    });

    /* 1. a página que o QR abre */
    var nomeBase = patrimonio + ' — ' + String(p.descricao || '').slice(0, 40);

    var arquivoHtml = pasta.createFile(
      Utilities.newBlob(htmlPagina, 'text/html', nomeBase + '.html'));

    try {
      arquivoHtml.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (e) { }

    /* 2. o PDF para imprimir */
    var blob = Utilities.newBlob(htmlImpressao, 'text/html', patrimonio + '.html')
      .getAs('application/pdf')
      .setName('Ficha ' + nomeBase + '.pdf');

    var arquivo = pasta.createFile(blob);

    try {
      arquivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (e) { /* conta sem permissão de compartilhar: segue */ }

    /* CONFERE que o PDF existe e é um PDF */
    var bytes;
    try {
      bytes = DriveApp.getFileById(arquivo.getId()).getBlob().getBytes();
    } catch (e) {
      return {
        ok: false, codigo: 'FICHA_NAO_VALIDADA',
        mensagem: 'O PDF foi criado mas não pôde ser lido de volta: ' + e.message
      };
    }

    if (bytes.length < 500) {
      return {
        ok: false, codigo: 'FICHA_VAZIA',
        mensagem: 'O PDF saiu com ' + bytes.length + ' bytes — pequeno demais.'
      };
    }

    var assinatura = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (assinatura !== '%PDF') {
      return {
        ok: false, codigo: 'NAO_E_PDF',
        mensagem: 'O arquivo gerado não é um PDF (começa com "' + assinatura + '").'
      };
    }

    /* CONFERE a página também: sem isso o QR abriria um arquivo vazio */
    var htmlLido;
    try {
      htmlLido = DriveApp.getFileById(arquivoHtml.getId()).getBlob().getDataAsString();
    } catch (e) {
      htmlLido = '';
    }

    if (!htmlLido || htmlLido.indexOf('</html>') === -1) {
      return {
        ok: false, codigo: 'PAGINA_NAO_VALIDADA',
        mensagem: 'A página da ficha não pôde ser lida de volta do Drive.'
      };
    }

    var versao = (Number(p.fichaVersao) || 0) + 1;

    AP_Data_update(AP_PAT_aba_(), patrimonio, {
      fichaHtmlId: arquivoHtml.getId(),
      fichaArquivoId: arquivo.getId(),
      fichaGeradaEm: AP_Utils_now(),
      fichaVersao: versao,
      atualizadoEm: AP_Utils_now()
    }, 'patrimonio');

    AP_Audit_log(quem, 'FICHA_GERADA', 'PATRIMONIO', patrimonio, {
      versao: versao, pdfBytes: bytes.length, htmlBytes: htmlLido.length
    });

    return {
      ok: true,
      dados: {
        patrimonio: patrimonio,
        codigoFicha: p.codigoFicha,
        /* a página que o QR abre */
        htmlId: arquivoHtml.getId(),
        htmlBytes: htmlLido.length,
        /* o PDF para imprimir */
        arquivoId: arquivo.getId(),
        arquivo: arquivo.getName(),
        tamanhoBytes: bytes.length,
        versao: versao,
        geradaEm: AP_Utils_now(),
        url: 'https://drive.google.com/file/d/' + arquivo.getId() + '/view',
        urlVisualizar: 'https://drive.google.com/file/d/' + arquivo.getId() + '/preview',
        substituiuAnterior: !!(anteriorPdf || anteriorHtml)
      },
      validado: true
    };

  } catch (e) {
    AP_ErrorHandler_capture('AP_PAT_gerarFicha', e);
    return { ok: false, codigo: 'FALHA_GERACAO', mensagem: e.message };
  }
}

/** Onde está a ficha deste patrimônio */
function AP_PAT_localizarFicha(codigo) {
  var r = AP_PAT_porToken(codigo);
  if (!r.ok) return r;

  /* refaz a ficha se algo mudou desde a última geração */
  try { AP_PAT_garantirFichaAtual(r.dados.patrimonio, null); } catch (e) { }

  r = AP_PAT_porToken(codigo);
  var p = r.dados;

  if (!p.fichaArquivoId) {
    return {
      ok: false, codigo: 'SEM_FICHA',
      mensagem: 'Este patrimônio ainda não tem ficha em PDF.',
      dados: { patrimonio: p.patrimonio, descricao: p.descricao }
    };
  }

  /* o arquivo pode ter sido apagado do Drive à mão */
  try {
    var arq = DriveApp.getFileById(p.fichaArquivoId);
    return {
      ok: true,
      dados: {
        patrimonio: p.patrimonio,
        codigoFicha: p.codigoFicha,
        descricao: p.descricao,
        arquivoId: p.fichaArquivoId,
        arquivo: arq.getName(),
        geradaEm: p.fichaGeradaEm,
        versao: p.fichaVersao,
        url: 'https://drive.google.com/file/d/' + p.fichaArquivoId + '/view',
        urlVisualizar: 'https://drive.google.com/file/d/' + p.fichaArquivoId + '/preview'
      }
    };
  } catch (e) {
    return {
      ok: false, codigo: 'ARQUIVO_SUMIU',
      mensagem: 'A ficha foi apagada do Drive. Gere novamente.',
      dados: { patrimonio: p.patrimonio }
    };
  }
}

/* ============================================================
   O PAPEL DA FICHA
   ============================================================ */

function AP_PAT_htmlDaFicha_(d) {
  var p = d.patrimonio;
  var c = d.calculado || {};
  var rot = d.rotatividade || {};

  var EMPRESA = AP_Config_get('EMPRESA_NOME', 'COESA');
  var DESDE = AP_Config_get('EMPRESA_DESDE', 'Desde 1954');

  function esc(t) {
    return String(t === null || t === undefined ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function moeda(v) {
    var n = Number(v) || 0;
    return 'R$ ' + n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  function data(x) {
    if (!x) return '—';
    try {
      var dt = new Date(x);
      if (isNaN(dt.getTime())) return String(x).slice(0, 10);
      return ('0' + dt.getDate()).slice(-2) + '/' +
        ('0' + (dt.getMonth() + 1)).slice(-2) + '/' + dt.getFullYear();
    } catch (e) { return String(x); }
  }

  function linha(rotulo, valor) {
    if (valor === undefined || valor === null || valor === '') return '';
    return '<tr><td class="r">' + rotulo + '</td><td class="v">' + esc(valor) + '</td></tr>';
  }

  var rotSituacao = {
    ATIVO: 'ATIVO', EM_MANUTENCAO: 'EM MANUTENÇÃO', BAIXADO: 'BAIXADO',
    EMPRESTADO: 'EMPRESTADO', EXTRAVIADO: 'EXTRAVIADO'
  };
  var corSituacao = {
    ATIVO: '#1E9E5A', EM_MANUTENCAO: '#FF9F1C', BAIXADO: '#8E969F',
    EMPRESTADO: '#0B5FFF', EXTRAVIADO: '#C0392B'
  };

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
    '@page{size:A4;margin:12mm}' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    'body{font-family:Helvetica,Arial,sans-serif;font-size:9.5pt;color:#1A2634;line-height:1.45}' +

    '.topo{display:flex;justify-content:space-between;align-items:center;' +
    'border-bottom:2px solid #0B2A55;padding-bottom:7px;margin-bottom:14px}' +
    '.marca{display:flex;align-items:center;gap:7px}' +
    '.marca .c{font-family:Georgia,serif;font-size:22pt;font-weight:bold;color:#0B5FFF;line-height:1}' +
    '.marca .n{font-size:13pt;font-weight:bold;color:#0B2A55;letter-spacing:1px;line-height:1.1}' +
    '.marca .d{font-size:6.5pt;color:#9AA5B1;display:block;letter-spacing:0}' +
    '.tit{text-align:right}' +
    '.tit h1{font-size:12pt;color:#0B2A55;line-height:1.2}' +
    '.tit span{font-size:7.5pt;color:#8A96A3}' +

    '.cabeca{display:flex;gap:12px;margin-bottom:14px;align-items:flex-start}' +
    '.foto{width:120px;height:120px;border:1px solid #E3E9F0;border-radius:6px;' +
    'background:#F7F9FC;display:flex;align-items:center;justify-content:center;' +
    'padding:5px;flex-shrink:0;overflow:hidden}' +
    /* contain: a ferramenta aparece inteira, sem corte */
    '.foto img{max-width:100%;max-height:100%;width:auto;height:auto}' +
    '.ident{flex:1}' +
    '.ident h2{font-size:15pt;color:#0B2A55;line-height:1.2}' +
    '.ident .pat{font-size:13pt;font-weight:bold;color:#FF7A00;' +
    'font-family:monospace;margin:3px 0 5px}' +
    '.ident .cod{font-size:8pt;color:#8A96A3;font-family:monospace;margin-top:4px}' +
    '.selo{display:inline-block;padding:3px 10px;border-radius:10px;' +
    'font-size:8pt;font-weight:bold;color:#fff}' +

    'h3{font-size:8.5pt;text-transform:uppercase;letter-spacing:0.7px;color:#0B2A55;' +
    'border-bottom:1px solid #E3E9F0;padding-bottom:3px;margin:12px 0 6px}' +
    'table{width:100%;border-collapse:collapse;font-size:9pt}' +
    'td{padding:3.5px 0;vertical-align:top}' +
    'td.r{color:#6B7684;width:38%}' +
    'td.v{font-weight:bold;text-align:right}' +
    '.duas{display:flex;gap:16px}.duas>div{flex:1}' +

    '.lista{font-size:8.5pt}' +
    '.lista tr td{border-bottom:1px solid #F0F4F8;padding:4px 3px}' +
    '.lista th{background:#F4F7FB;color:#4A5866;font-size:7.5pt;text-align:left;' +
    'padding:4px 3px;text-transform:uppercase;letter-spacing:0.4px}' +

    '.barra{height:7px;background:#E9EEF4;border-radius:4px;overflow:hidden;margin:4px 0}' +
    '.barra i{display:block;height:100%}' +

    '.rodape{position:fixed;bottom:0;left:0;right:0;display:flex;' +
    'justify-content:space-between;border-top:1px solid #E3E9F0;padding-top:4px;' +
    'font-size:7pt;color:#8A96A3}' +
    '</style></head><body>' +

    '<div class="topo">' +
    '<div class="marca"><span class="c">C</span>' +
    '<span class="n">' + esc(EMPRESA) + '<span class="d">' + esc(DESDE) + '</span></span></div>' +
    '<div class="tit"><h1>FICHA TÉCNICA DE PATRIMÔNIO</h1>' +
    '<span>Emitida em ' + AP_ENTRADA_agoraTexto_() + '</span></div>' +
    '</div>' +

    '<div class="cabeca">' +
    '<div class="foto">' + (p.foto ? '<img src="' + esc(p.foto) + '">' : '') + '</div>' +
    '<div class="ident">' +
    '<h2>' + esc(p.descricao) + '</h2>' +
    '<div class="pat">' + esc(p.patrimonio) + '</div>' +
    '<span class="selo" style="background:' + (corSituacao[p.situacao] || '#8E969F') + '">' +
    (rotSituacao[p.situacao] || p.situacao) + '</span>' +
    (p.codigoFicha ? '<div class="cod">Código da ficha: ' + esc(p.codigoFicha) + '</div>' : '') +
    '</div></div>' +

    '<div class="duas">' +
    '<div>' +
    '<h3>Identificação</h3><table>' +
    linha('Marca', p.marca) + linha('Modelo', p.modelo) +
    linha('Nº de série', p.numeroSerie) + linha('Categoria', p.categoria) +
    (p.skuItem ? linha('Item no cadastro', p.skuItem) : '') +
    '</table>' +

    '<h3>Aquisição</h3><table>' +
    linha('Data', data(p.dataAquisicao)) +
    linha('Valor', p.valorAquisicao ? moeda(p.valorAquisicao) : '') +
    linha('Nota fiscal', p.notaFiscal) + linha('Pedido', p.pedido) +
    linha('Fornecedor', p.fornecedor) +
    linha('Garantia até', data(p.garantiaAte)) +
    (p.vidaUtilMeses ? linha('Vida útil', p.vidaUtilMeses + ' meses') : '') +
    '</table></div>' +

    '<div>' +
    '<h3>Situação atual</h3><table>' +
    linha('Estado', p.estado) + linha('Localização', p.localizacao) +
    linha('Obra', p.obra) + linha('Responsável', p.responsavel) +
    (c.idadeMeses !== null && c.idadeMeses !== undefined
      ? linha('Idade', c.idadeMeses + ' meses') : '') +
    '</table>' +

    '<h3>Manutenção</h3><table>' +
    linha('Última', data(p.ultimaManutencao)) +
    linha('Próxima', data(p.proximaManutencao)) +
    linha('Manutenções realizadas', String(c.totalManutencoes || 0)) +
    (c.custoManutencoes ? linha('Gasto acumulado', moeda(c.custoManutencoes)) : '') +
    '</table>' +

    (d.lacreAtual
      ? '<h3>Lacre atual</h3><table>' +
        linha('Código', d.lacreAtual.codigo) +
        linha('Cor', d.lacreAtual.cor) +
        linha('Instalado em', data(d.lacreAtual.instaladoEm)) +
        '</table>'
      : '') +
    '</div></div>' +

    '<h3>Rotatividade</h3>' +
    (rot.limite
      ? '<table><tr><td class="r">Utilizações desde a última manutenção</td>' +
        '<td class="v">' + rot.desdeUltimaManutencao + ' de ' + rot.limite + '</td></tr></table>' +
        '<div class="barra"><i style="width:' + (rot.percentual || 0) + '%;background:' +
        (rot.situacao === 'MANUTENCAO_PROGRAMADA' ? '#C0392B'
          : (rot.situacao === 'PROXIMO_LIMITE' ? '#FF9F1C' : '#1E9E5A')) + '"></i></div>'
      : '') +
    '<table>' +
    linha('Total de saídas', String(rot.totalSaidas || 0)) +
    linha('Total de devoluções', String(rot.totalDevolucoes || 0)) +
    '</table>' +

    (d.quemUsou && d.quemUsou.length
      ? '<h3>Pessoas que já utilizaram</h3>' +
        '<table class="lista"><tr><th>Pessoa</th><th>Utilizações</th><th>Última vez</th></tr>' +
        d.quemUsou.slice(0, 8).map(function (q) {
          return '<tr><td>' + esc(q.nome) + '</td><td>' + q.vezes + '</td>' +
            '<td>' + data(q.ultima) + '</td></tr>';
        }).join('') + '</table>'
      : '') +

    (d.movimentos && d.movimentos.length
      ? '<h3>Movimentações (últimas ' + Math.min(12, d.movimentos.length) + ')</h3>' +
        '<table class="lista"><tr><th>Data</th><th>Tipo</th><th>De</th><th>Para</th><th>Por</th></tr>' +
        d.movimentos.slice(0, 12).map(function (m) {
          return '<tr><td>' + data(m.quando) + '</td>' +
            '<td>' + esc(String(m.tipo).replace(/_/g, ' ')) + '</td>' +
            '<td>' + esc(m.de || '—') + '</td>' +
            '<td>' + esc(m.para || '—') + '</td>' +
            '<td>' + esc(m.usuario || '') + '</td></tr>';
        }).join('') + '</table>'
      : '') +

    (d.manutencoes && d.manutencoes.length
      ? '<h3>Manutenções realizadas</h3>' +
        '<table class="lista"><tr><th>Data</th><th>Tipo</th><th>Serviço</th><th>Por</th></tr>' +
        d.manutencoes.slice(0, 10).map(function (m) {
          return '<tr><td>' + data(m.quando) + '</td><td>' + esc(m.tipo) + '</td>' +
            '<td>' + esc(m.descricao) + '</td>' +
            '<td>' + esc(m.executadaPor || '') + '</td></tr>';
        }).join('') + '</table>'
      : '') +

    (d.lacres && d.lacres.length > 1
      ? '<h3>Histórico de lacres</h3>' +
        '<table class="lista"><tr><th>Data</th><th>Código</th><th>Cor</th><th>Motivo</th></tr>' +
        d.lacres.slice(0, 8).map(function (l) {
          return '<tr><td>' + data(l.instaladoEm) + '</td><td>' + esc(l.codigo) + '</td>' +
            '<td>' + esc(l.cor || '') + '</td><td>' + esc(l.motivo || '') + '</td></tr>';
        }).join('') + '</table>'
      : '') +

    (d.documentos && d.documentos.length
      ? '<h3>Documentos anexados</h3>' +
        '<table class="lista"><tr><th>Tipo</th><th>Documento</th><th>Enviado em</th></tr>' +
        d.documentos.map(function (doc) {
          return '<tr><td>' + esc(doc.tipo) + '</td><td>' + esc(doc.nome) + '</td>' +
            '<td>' + data(doc.enviadoEm) + '</td></tr>';
        }).join('') + '</table>'
      : '') +

    (p.observacao
      ? '<h3>Observações</h3><p style="font-size:9pt">' + esc(p.observacao) + '</p>' : '') +

    '<div class="rodape">' +
    '<div>' + esc(EMPRESA) + ' · ALMOXA PRO · Ficha ' + esc(p.patrimonio) + '</div>' +
    '<div>' + esc(p.codigoFicha || '') + '</div>' +
    '</div></body></html>';
}

/* data e hora, se o Entrada.gs não estiver carregado */
if (typeof AP_ENTRADA_agoraTexto_ !== 'function') {
  function AP_ENTRADA_agoraTexto_() {
    try {
      return Utilities.formatDate(new Date(),
        AP_Config_get('TIMEZONE', 'America/Sao_Paulo'), 'dd/MM/yyyy HH:mm');
    } catch (e) { return new Date().toLocaleString('pt-BR'); }
  }
}


/* ============================================================
   A PÁGINA DA FICHA
   ------------------------------------------------------------
   É este arquivo que o QR Code abre. Fica pronto no Drive: o
   servidor de fichas só encontra e entrega, sem montar nada na
   hora — por isso abre rápido mesmo com sinal ruim.

   O conteúdo é o mesmo da ficha em tela, mas sem depender do
   sistema estar no ar.
   ============================================================ */

function AP_PAT_paginaDaFicha_(d) {
  /* reaproveita a ficha que o sistema já sabe montar */
  if (typeof AP_ENTRADA_htmlPatrimonio_ === 'function') {
    try {
      return AP_ENTRADA_htmlPatrimonio_({ ok: true, dados: d });
    } catch (e) { /* cai para a versão local abaixo */ }
  }

  /* o Entrada.gs não está carregado: monta aqui mesmo */
  var p = d.patrimonio;
  var EMPRESA = AP_Config_get('EMPRESA_NOME', 'COESA');
  var DESDE = AP_Config_get('EMPRESA_DESDE', 'Desde 1954');

  function esc(t) {
    return String(t === null || t === undefined ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function linha(r, v) {
    if (v === undefined || v === null || v === '') return '';
    return '<div class="linha"><span>' + r + '</span><b>' + esc(v) + '</b></div>';
  }

  return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + esc(p.patrimonio) + ' · ' + esc(EMPRESA) + '</title>' +
    '<style>' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
    'background:#F4F7FB;color:#1A2634;line-height:1.5;padding-bottom:40px}' +
    '.topo{background:#fff;border-bottom:1px solid #E3E9F0;padding:10px 16px;' +
    'display:flex;align-items:center;justify-content:space-between}' +
    '.marca{display:flex;align-items:center;gap:7px}' +
    '.marca .c{font-family:Georgia,serif;font-size:19px;font-weight:900;color:#0B5FFF}' +
    '.marca .n{font-size:13px;font-weight:800;color:#0B2A55;letter-spacing:.06em}' +
    '.marca .n small{display:block;font-size:9px;font-weight:400;color:#9AA5B1}' +
    '.env{max-width:640px;margin:0 auto;padding:14px}' +
    '.cartao{background:#fff;border:1px solid #E3E9F0;border-radius:14px;' +
    'padding:16px;margin-bottom:12px}' +
    '.cabeca{display:flex;gap:14px;align-items:flex-start}' +
    '.foto{width:100px;height:100px;border-radius:12px;background:#F7F9FC;' +
    'display:flex;align-items:center;justify-content:center;font-size:36px;' +
    'flex-shrink:0;overflow:hidden;border:1px solid #E3E9F0;padding:6px}' +
    '.foto img{max-width:100%;max-height:100%;width:auto;height:auto}' +
    'h1{font-size:19px;color:#0B2A55;line-height:1.25}' +
    '.pat{font-family:monospace;font-size:14px;color:#FF7A00;font-weight:800;margin:3px 0 7px}' +
    '.linha{display:flex;justify-content:space-between;padding:9px 0;' +
    'border-bottom:1px solid #F0F4F8;font-size:14px;gap:14px}' +
    '.linha:last-child{border:0}.linha span{color:#6B7684}' +
    '.linha b{text-align:right}' +
    'h3{font-size:11.5px;text-transform:uppercase;letter-spacing:.8px;' +
    'color:#8A96A3;margin:18px 0 9px;font-weight:700}' +
    '</style></head><body>' +
    '<div class="topo"><div class="marca"><span class="c">C</span>' +
    '<span class="n">' + esc(EMPRESA) + '<small>' + esc(DESDE) + '</small></span></div>' +
    '<button onclick="window.print()" style="background:#0B2A55;color:#fff;border:0;' +
    'border-radius:8px;padding:8px 14px;font-family:inherit;font-weight:600;' +
    'cursor:pointer">Imprimir</button></div>' +
    '<div class="env"><div class="cartao"><div class="cabeca">' +
    '<div class="foto">' + (p.foto ? '<img src="' + esc(p.foto) + '">' : '🔧') + '</div>' +
    '<div><h1>' + esc(p.descricao) + '</h1>' +
    '<div class="pat">' + esc(p.patrimonio) + '</div></div></div>' +
    linha('Marca', p.marca) + linha('Modelo', p.modelo) +
    linha('Nº de série', p.numeroSerie) +
    '<h3>Onde está</h3>' +
    linha('Localização', p.localizacao) + linha('Responsável', p.responsavel) +
    '</div></div></body></html>';
}


/* ============================================================
   A FICHA SE REFAZ SOZINHA
   ------------------------------------------------------------
   O arquivo no Drive é uma fotografia do equipamento no momento
   em que foi gerado. Acrescentar uma nota fiscal depois não muda
   o arquivo — e quem lê o QR vê a versão velha.
   
   Ninguém vai lembrar de clicar "gerar ficha" a cada alteração.
   Então qualquer mudança marca a ficha como desatualizada, e a
   próxima leitura do QR a refaz.
   ============================================================ */

/** Marca que a ficha precisa ser refeita */
function AP_PAT_marcarDesatualizada_(patrimonio) {
  try {
    AP_Data_update(AP_PAT_aba_(), patrimonio, {
      fichaDesatualizada: 'SIM', atualizadoEm: AP_Utils_now()
    }, 'patrimonio');
  } catch (e) { /* a coluna pode não existir em bases antigas */ }
}

/**
 * Garante que a ficha está em dia.
 *
 * Chamada quando alguém lê o QR: se houve mudança desde a última
 * geração, refaz antes de servir. O custo é de uma geração, e só
 * na primeira leitura depois da mudança.
 */
function AP_PAT_garantirFichaAtual(patrimonio, sessao) {
  var r = AP_PAT_obter(patrimonio);
  if (!r.ok) return r;

  var p = r.dados;

  var precisa = !p.fichaHtmlId ||
    String(p.fichaDesatualizada || '').toUpperCase() === 'SIM';

  /* a ficha é anterior à última alteração do equipamento? */
  if (!precisa && p.atualizadoEm && p.fichaGeradaEm) {
    precisa = String(p.atualizadoEm) > String(p.fichaGeradaEm);
  }

  if (!precisa) {
    return { ok: true, dados: { patrimonio: patrimonio, jaEstavaEmDia: true } };
  }

  var g = AP_PAT_gerarFicha(patrimonio, sessao);

  if (g.ok) {
    try {
      AP_Data_update(AP_PAT_aba_(), patrimonio, { fichaDesatualizada: '' }, 'patrimonio');
    } catch (e) { }
  }

  return g;
}


/* ============================================================
   DIAGNÓSTICO — rode no editor do Apps Script
   ------------------------------------------------------------
   Escolha a função PATRIMONIO_DIAGNOSTICO e clique em Executar.
   O registro de execução mostra onde está o problema.
   ============================================================ */

function PATRIMONIO_DIAGNOSTICO() {
  var L = [];
  function p(t) { L.push(t); }
  function ok(t, d) { p('  OK    ' + t + (d ? ' — ' + d : '')); }
  function erro(t, d) { p('  FALHA ' + t + (d ? ' — ' + d : '')); }
  function aviso(t, d) { p('  !     ' + t + (d ? ' — ' + d : '')); }

  p('');
  p('  DIAGNÓSTICO DO PATRIMÔNIO');
  p('  ' + new Array(58).join('='));
  p('');

  /* ---------- 1. O ENDEREÇO DO SISTEMA ---------- */
  p('  1. ENDEREÇO');
  var base = '';
  try { base = ScriptApp.getService().getUrl(); } catch (e) { }

  if (!base) {
    erro('Não consegui obter o endereço do app',
      'publique em Implantar → Nova implantação');
  } else {
    ok('Endereço do sistema', base);
  }

  var urlCurta = AP_Config_get('PATRIMONIO_URL_CURTA', '');
  var urlFicha = AP_Config_get('PATRIMONIO_URL_FICHA', '');

  if (urlCurta) ok('Endereço curto configurado', urlCurta);
  else if (urlFicha) ok('Servidor de fichas configurado', urlFicha);
  else aviso('Sem endereço curto nem servidor de fichas',
    'o QR usa o endereço do sistema, que é longo');

  /* ---------- 2. OS EQUIPAMENTOS ---------- */
  p('');
  p('  2. EQUIPAMENTOS');
  var todos = [];
  try { todos = AP_Data_rows(AP_PAT_aba_()) || []; }
  catch (e) { erro('Não consegui ler a aba de patrimônio', e.message); }

  if (!todos.length) {
    erro('Nenhum equipamento cadastrado', 'cadastre um antes de testar');
    p('');
    try { Logger.log(L.join('\n')); } catch (e) { }
    return L.join('\n');
  }

  ok(todos.length + ' equipamento(s) cadastrado(s)');

  var semCodigo = todos.filter(function (x) { return !x.codigoFicha; });
  if (semCodigo.length) {
    aviso(semCodigo.length + ' sem código de ficha',
      'foram cadastrados antes desta versão — rode PATRIMONIO_CORRIGIR');
  } else {
    ok('Todos têm código de ficha');
  }

  /* ---------- 3. UM EQUIPAMENTO DE VERDADE ---------- */
  var alvo = todos.filter(function (x) { return x.codigoFicha; })[0] || todos[0];

  p('');
  p('  3. TESTE COM ' + alvo.patrimonio);
  p('     ' + (alvo.descricao || '(sem descrição)'));
  p('');

  /* o código que está no QR */
  var chave = alvo.codigoFicha || alvo.token;
  var urlQR;
  if (urlCurta) urlQR = urlCurta.replace(/\/+$/, '') + '/' + chave;
  else if (urlFicha) urlQR = urlFicha.replace(/\/+$/, '') + '?f=' + chave;
  else urlQR = base + '?f=' + chave;

  p('     O QR desta etiqueta contém:');
  p('     ' + urlQR);
  p('');

  /* a busca acha? */
  var achou = AP_PAT_porToken(chave);
  if (achou.ok) ok('A busca pelo código encontra o equipamento');
  else erro('A busca NÃO encontra', achou.mensagem);

  /* ---------- 4. AS FOTOS ---------- */
  p('');
  p('  4. FOTOS');
  var fotos = [];
  try { fotos = AP_PAT_fotos_(alvo.patrimonio); }
  catch (e) { erro('Não consegui ler as fotos', e.message); }

  if (!fotos.length) {
    aviso('Nenhuma foto neste equipamento',
      'Patrimônio → Abrir → Fotos → Escolher fotos');
  } else {
    ok(fotos.length + ' foto(s)', fotos.map(function (f) { return f.rotulo; }).join(', '));
    var semImagem = fotos.filter(function (f) { return !f.imagem; });
    if (semImagem.length) erro(semImagem.length + ' foto(s) sem imagem gravada');
  }

  /* ---------- 5. A FICHA NO DRIVE ---------- */
  p('');
  p('  5. FICHA NO DRIVE');

  if (!alvo.fichaHtmlId) {
    erro('Este equipamento não tem ficha HTML gerada',
      'é por isso que o QR abre a versão resumida');
  } else {
    var conteudo = null;
    try { conteudo = DriveApp.getFileById(alvo.fichaHtmlId).getBlob().getDataAsString(); }
    catch (e) { erro('O arquivo sumiu do Drive', e.message); }

    if (conteudo) {
      ok('Ficha encontrada', Math.round(conteudo.length / 1024) + ' KB · versão ' +
        (alvo.fichaVersao || 1));

      /* o conteúdo está completo? */
      if (conteudo.indexOf('ficha resumida') > -1) {
        erro('A ficha no Drive é a RESUMIDA',
          'foi gerada por uma versão antiga — rode PATRIMONIO_REGERAR_TUDO');
      } else {
        ok('É a ficha completa');
      }

      if (fotos.length) {
        var temGaleria = conteudo.indexOf('class="galeria"') > -1;
        if (temGaleria) ok('A galeria de fotos está na ficha');
        else erro('A ficha NÃO tem a galeria',
          'foi gerada antes das fotos — rode PATRIMONIO_REGERAR_TUDO');
      }

      var abas = ['pFotos', 'pNF', 'pPed', 'pInfos'];
      var faltando = abas.filter(function (a) {
        return conteudo.indexOf('data-aba="' + a + '"') === -1;
      });
      if (faltando.length) {
        erro('Faltam abas na ficha: ' + faltando.join(', '),
          'ficha antiga — rode PATRIMONIO_REGERAR_TUDO');
      } else {
        ok('Todas as abas estão na ficha');
      }
    }
  }

  /* ---------- 6. A ROTA ---------- */
  p('');
  p('  6. A ROTA DO QR');

  if (typeof AP_ENTRADA_abrirFicha_ !== 'function') {
    erro('A função que abre a ficha não existe',
      'o ALMOXA_PRO_Entrada.gs não foi atualizado');
  } else {
    try {
      var pagina = AP_ENTRADA_abrirFicha_(chave);
      var html = pagina.getContent ? pagina.getContent() : '';

      if (!html) {
        aviso('Não consegui ler a resposta da rota');
      } else if (html.indexOf('appMain') > -1) {
        erro('A ROTA ESTÁ ABRINDO O SISTEMA', 'em vez da ficha');
      } else if (html.indexOf('não reconhecida') > -1 || html.indexOf('Não encontrei') > -1) {
        erro('A rota não reconhece o código', chave);
      } else {
        ok('A rota abre a ficha corretamente');
      }
    } catch (e) {
      erro('A rota falhou', e.message);
    }
  }

  /* ---------- 7. O QUE FAZER ---------- */
  p('');
  p('  ' + new Array(58).join('='));
  var falhas = L.filter(function (l) { return l.indexOf('  FALHA') === 0; });

  if (!falhas.length) {
    p('  TUDO CERTO');
    p('');
    p('  Abra este endereço no navegador para conferir:');
    p('  ' + urlQR);
  } else {
    p('  ' + falhas.length + ' PROBLEMA(S)');
    p('');
    p('  O que resolve a maioria: rode PATRIMONIO_REGERAR_TUDO');
  }
  p('');

  var texto = L.join('\n');
  try { Logger.log(texto); } catch (e) { }
  return texto;
}

/**
 * Refaz a ficha de todos os equipamentos.
 *
 * Use depois de atualizar o sistema: as fichas geradas pela versão
 * anterior não têm as abas e a galeria novas.
 */
function PATRIMONIO_REGERAR_TUDO() {
  var todos = AP_Data_rows(AP_PAT_aba_()) || [];
  var feitas = 0, falhas = [];
  var L = [];

  L.push('');
  L.push('  REGERANDO AS FICHAS');
  L.push('  ' + new Array(50).join('-'));

  todos.forEach(function (p) {
    if (p.situacao === 'BAIXADO') return;

    try {
      var r = AP_PAT_gerarFicha(p.patrimonio, { usuario: 'sistema' });
      if (r.ok) {
        feitas++;
        L.push('  OK    ' + p.patrimonio + ' — versão ' + r.dados.versao +
          ' · ' + Math.round(r.dados.htmlBytes / 1024) + ' KB');
      } else {
        falhas.push(p.patrimonio + ': ' + r.mensagem);
        L.push('  FALHA ' + p.patrimonio + ' — ' + r.mensagem);
      }
    } catch (e) {
      falhas.push(p.patrimonio + ': ' + e.message);
      L.push('  FALHA ' + p.patrimonio + ' — ' + e.message);
    }
  });

  L.push('');
  L.push('  ' + feitas + ' ficha(s) refeita(s)' +
    (falhas.length ? ', ' + falhas.length + ' falha(s)' : ''));
  L.push('');

  var texto = L.join('\n');
  try { Logger.log(texto); } catch (e) { }
  return texto;
}

/** Dá código de ficha aos equipamentos cadastrados antes desta versão */
function PATRIMONIO_CORRIGIR() {
  var todos = AP_Data_rows(AP_PAT_aba_()) || [];
  var corrigidos = 0;

  todos.forEach(function (p) {
    if (p.codigoFicha) return;
    AP_Data_update(AP_PAT_aba_(), p.patrimonio, {
      codigoFicha: AP_PAT_codigoFichaUnico_(),
      fichaDesatualizada: 'SIM'
    }, 'patrimonio');
    corrigidos++;
  });

  var texto = corrigidos
    ? corrigidos + ' equipamento(s) receberam código de ficha. ' +
      'Agora rode PATRIMONIO_REGERAR_TUDO e imprima as etiquetas de novo.'
    : 'Todos já tinham código de ficha.';

  try { Logger.log(texto); } catch (e) { }
  return texto;
}


/* ============================================================
   ENVIAR DOCUMENTO DO COMPUTADOR PARA O DRIVE
   ------------------------------------------------------------
   Colar link do Drive obriga a pessoa a subir o arquivo primeiro,
   achar o link, voltar e colar. São quatro passos para anexar uma
   nota fiscal que já está na pasta de downloads.

   Aqui ela escolhe o arquivo e pronto: o sistema guarda no Drive,
   na pasta do patrimônio, e vincula.
   ============================================================ */

var AP_PAT_PASTA_DOCS = 'ALMOXA PRO — Documentos de Patrimônio';

function AP_PAT_pastaDocs_() {
  var nome = AP_Config_get('PATRIMONIO_PASTA_DOCS', AP_PAT_PASTA_DOCS);
  var pastas = DriveApp.getFoldersByName(nome);
  var raiz = pastas.hasNext() ? pastas.next() : DriveApp.createFolder(nome);
  return raiz;
}

/** Cada equipamento tem sua subpasta: achar depois fica fácil */
function AP_PAT_pastaDoEquipamento_(patrimonio) {
  var raiz = AP_PAT_pastaDocs_();
  var sub = raiz.getFoldersByName(patrimonio);
  return sub.hasNext() ? sub.next() : raiz.createFolder(patrimonio);
}

/**
 * Recebe o arquivo do navegador e guarda no Drive.
 *
 * O arquivo chega em base64 porque é o que passa pelo Apps Script.
 * O limite é do próprio Apps Script: acima de uns 8 MB a chamada
 * falha, e é melhor avisar antes do que deixar travar.
 */
function AP_PAT_enviarDocumento(dados, sessao) {
  var quem = (sessao && sessao.usuario) || 'sistema';

  var r = AP_PAT_obter(dados.patrimonio);
  if (!r.ok) return r;

  if (!dados.arquivo) {
    return { ok: false, codigo: 'SEM_ARQUIVO', mensagem: 'Escolha o arquivo.' };
  }

  var base64 = String(dados.arquivo);

  /* tira o cabeçalho "data:application/pdf;base64," se vier */
  var tipo = dados.tipoArquivo || 'application/pdf';
  var virgula = base64.indexOf(',');
  if (base64.indexOf('data:') === 0 && virgula > -1) {
    var cabecalho = base64.slice(5, virgula);
    if (cabecalho.indexOf(';') > -1) tipo = cabecalho.split(';')[0];
    base64 = base64.slice(virgula + 1);
  }

  /* base64 ocupa 4/3 do tamanho original */
  var bytesAprox = Math.round(base64.length * 0.75);

  if (bytesAprox > 8 * 1024 * 1024) {
    return {
      ok: false, codigo: 'ARQUIVO_GRANDE',
      mensagem: 'O arquivo tem ' + Math.round(bytesAprox / 1024 / 1024) + ' MB e o limite ' +
        'é 8 MB. Reduza o PDF ou envie as páginas em separado.'
    };
  }

  try {
    var bytes = Utilities.base64Decode(base64);
    var nome = dados.nome || ('documento-' + new Date().getTime());

    var blob = Utilities.newBlob(bytes, tipo, nome);

    var pasta = AP_PAT_pastaDoEquipamento_(dados.patrimonio);
    var arquivo = pasta.createFile(blob);

    try {
      arquivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (e) { /* conta sem permissão de compartilhar */ }

    /* CONFERE que subiu mesmo */
    var conferido;
    try {
      conferido = DriveApp.getFileById(arquivo.getId()).getSize();
    } catch (e) {
      return {
        ok: false, codigo: 'NAO_CONFERIDO',
        mensagem: 'O arquivo foi enviado mas não pôde ser lido de volta: ' + e.message
      };
    }

    if (!conferido || conferido < 10) {
      return {
        ok: false, codigo: 'ARQUIVO_VAZIO',
        mensagem: 'O arquivo chegou vazio ao Drive.'
      };
    }

    var url = 'https://drive.google.com/file/d/' + arquivo.getId() + '/view';

    var doc = {
      id: AP_Utils_generateId('DOC'),
      patrimonio: dados.patrimonio,
      tipo: dados.tipo || 'OUTRO',
      nome: nome,
      url: url,
      enviadoEm: AP_Utils_now(),
      enviadoPor: quem
    };

    AP_Data_append(AP_PAT_abaDocs_(), doc);

    /* é nota ou pedido: vincula também na aba própria */
    if (dados.vincularNota && dados.numeroNota) {
      AP_PAT_vincularNota({
        patrimonio: dados.patrimonio,
        tipo: dados.tipoNota || 'NF',
        numero: dados.numeroNota,
        fornecedor: dados.fornecedor || '',
        emissao: dados.emissao || '',
        valor: dados.valor || 0,
        documentoUrl: url,
        documentoId: arquivo.getId()
      }, sessao);
    }

    AP_PAT_marcarDesatualizada_(dados.patrimonio);

    AP_Audit_log(quem, 'DOCUMENTO_ENVIADO', 'PATRIMONIO', dados.patrimonio, {
      nome: nome, bytes: conferido
    });

    return {
      ok: true,
      dados: {
        id: doc.id,
        arquivoId: arquivo.getId(),
        nome: nome,
        tipo: doc.tipo,
        url: url,
        urlVisualizar: 'https://drive.google.com/file/d/' + arquivo.getId() + '/preview',
        tamanhoBytes: conferido,
        tamanhoKB: Math.round(conferido / 1024),
        pasta: pasta.getName()
      },
      conferido: true
    };

  } catch (e) {
    AP_ErrorHandler_capture('AP_PAT_enviarDocumento', e);
    return { ok: false, codigo: 'FALHA_ENVIO', mensagem: e.message };
  }
}

function AP_PAT_removerDocumento(id, sessao) {
  var doc = (AP_Data_rows(AP_PAT_abaDocs_()) || []).filter(function (d) {
    return d.id === id;
  })[0];

  if (!doc) return { ok: false, codigo: 'NAO_ENCONTRADO', mensagem: 'Documento não encontrado.' };

  /* tira do Drive também, se foi o sistema que subiu */
  var idDrive = String(doc.url || '').match(/\/d\/([^\/]+)/);
  if (idDrive) {
    try { DriveApp.getFileById(idDrive[1]).setTrashed(true); } catch (e) { }
  }

  AP_Data_remove(AP_PAT_abaDocs_(), id);
  AP_PAT_marcarDesatualizada_(doc.patrimonio);

  return { ok: true, dados: { id: id, patrimonio: doc.patrimonio } };
}


/* ============================================================
   PATRIMÔNIO EM SÉRIE
   ------------------------------------------------------------
   Chegam dez lixadeiras iguais na mesma nota. Tudo é idêntico —
   descrição, marca, modelo, valor, fornecedor — menos o número
   de série, que é o que distingue uma da outra.
   
   Cadastrar dez vezes à mão é trabalho repetido e fonte de erro:
   basta uma distração para duas ficarem com o mesmo número.
   ============================================================ */

function AP_PAT_criarSerie(dados, sessao) {
  var quem = (sessao && sessao.usuario) || 'sistema';

  if (!dados.descricao && !dados.skuItem) {
    return {
      ok: false, codigo: 'SEM_DESCRICAO',
      mensagem: 'Informe a descrição ou escolha um item do cadastro.'
    };
  }

  var series = dados.numerosSerie;

  /* aceita lista, ou texto com um por linha */
  if (typeof series === 'string') {
    series = series.split(/[\n,;]+/).map(function (x) { return x.trim(); })
      .filter(function (x) { return x; });
  }

  var quantos = Number(dados.quantidade) || (series ? series.length : 0);

  if (!quantos) {
    return {
      ok: false, codigo: 'SEM_QUANTIDADE',
      mensagem: 'Informe quantos equipamentos ou cole os números de série.'
    };
  }

  if (quantos > 50) {
    return {
      ok: false, codigo: 'SERIE_GRANDE',
      mensagem: 'São ' + quantos + ' equipamentos de uma vez. O limite é 50 — ' +
        'divida em lotes para o sistema não travar no meio.'
    };
  }

  /* sem números de série, ficam em branco para preencher depois */
  if (!series || !series.length) {
    series = [];
    for (var v = 0; v < quantos; v++) series.push('');
  }

  /* números repetidos dentro do próprio lote */
  var vistos = {}, repetidosNoLote = [];
  series.forEach(function (n) {
    if (!n) return;
    var chave = String(n).toUpperCase();
    if (vistos[chave]) repetidosNoLote.push(n);
    vistos[chave] = true;
  });

  if (repetidosNoLote.length) {
    return {
      ok: false, codigo: 'SERIE_REPETIDA_NO_LOTE',
      mensagem: 'Estes números de série aparecem mais de uma vez na lista: ' +
        repetidosNoLote.slice(0, 5).join(', ') +
        (repetidosNoLote.length > 5 ? '…' : '') + '. Cada equipamento tem o seu.'
    };
  }

  /**
   * Números que já estão no sistema.
   *
   * Um mesmo número de série em dois patrimônios significa que um
   * deles está errado — e é o tipo de erro que ninguém percebe até
   * precisar rastrear um equipamento específico.
   */
  var jaCadastrados = {};
  (AP_Data_rows(AP_PAT_aba_()) || []).forEach(function (p) {
    if (p.numeroSerie) jaCadastrados[String(p.numeroSerie).toUpperCase()] = p.patrimonio;
  });

  var conflitos = [];
  series.forEach(function (n) {
    if (!n) return;
    var achado = jaCadastrados[String(n).toUpperCase()];
    if (achado) conflitos.push(n + ' (já é ' + achado + ')');
  });

  if (conflitos.length && !dados.confirmarSerieRepetida) {
    return {
      ok: false, codigo: 'SERIE_JA_EXISTE',
      mensagem: conflitos.length + ' número(s) de série já estão cadastrados: ' +
        conflitos.slice(0, 4).join(', ') + (conflitos.length > 4 ? '…' : ''),
      dados: { conflitos: conflitos }
    };
  }

  /* os dados que se repetem em todos */
  var base = {};
  ['skuItem','descricao','categoria','marca','modelo','notaFiscal','pedido',
   'fornecedor','valorAquisicao','dataAquisicao','garantiaAte','vidaUtilMeses',
   'localizacao','obra','responsavel','estado','proximaManutencao',
   'limiteUtilizacoes','observacao','foto'].forEach(function (c) {
    if (dados[c] !== undefined && dados[c] !== '') base[c] = dados[c];
  });

  var criados = [], falhas = [];

  series.forEach(function (numero, i) {
    var registro = {};
    Object.keys(base).forEach(function (k) { registro[k] = base[k]; });

    registro.numeroSerie = numero;
    registro.confirmarSerieRepetida = true;   /* já foi conferido acima */

    /* a observação guarda de qual lote veio */
    registro.observacao = (base.observacao ? base.observacao + ' · ' : '') +
      'Lote de ' + quantos + (dados.notaFiscal ? ' — NF ' + dados.notaFiscal : '') +
      ' (' + (i + 1) + ' de ' + quantos + ')';

    var r = AP_PAT_salvar(registro, sessao);

    if (r.ok) {
      criados.push({
        patrimonio: r.dados.patrimonio,
        codigoFicha: r.dados.codigoFicha,
        numeroSerie: numero
      });
    } else {
      falhas.push((numero || 'sem série') + ': ' + r.mensagem);
    }
  });

  if (!criados.length) {
    return {
      ok: false, codigo: 'NENHUM_CRIADO',
      mensagem: 'Nenhum equipamento foi criado. ' + falhas.slice(0, 2).join(' · ')
    };
  }

  /* a nota fiscal vale para todos do lote */
  if (dados.notaFiscal) {
    criados.forEach(function (c) {
      AP_PAT_vincularNota({
        patrimonio: c.patrimonio, tipo: 'NF', numero: dados.notaFiscal,
        fornecedor: dados.fornecedor || '', emissao: dados.dataAquisicao || '',
        valor: Number(dados.valorAquisicao) || 0,
        documentoUrl: dados.documentoUrl || ''
      }, sessao);
    });
  }

  if (dados.pedido) {
    criados.forEach(function (c) {
      AP_PAT_vincularNota({
        patrimonio: c.patrimonio, tipo: 'PEDIDO', numero: dados.pedido,
        fornecedor: dados.fornecedor || ''
      }, sessao);
    });
  }

  AP_Audit_log(quem, 'PATRIMONIO_LOTE_CRIADO', 'PATRIMONIO',
    criados[0].patrimonio + '…' + criados[criados.length - 1].patrimonio,
    { quantos: criados.length, nf: dados.notaFiscal || '' });

  return {
    ok: true,
    dados: {
      criados: criados,
      quantos: criados.length,
      primeiro: criados[0].patrimonio,
      ultimo: criados[criados.length - 1].patrimonio,
      semSerie: criados.filter(function (c) { return !c.numeroSerie; }).length,
      falhas: falhas
    },
    mensagem: criados.length + ' equipamento(s) cadastrado(s): ' +
      criados[0].patrimonio + ' a ' + criados[criados.length - 1].patrimonio
  };
}
