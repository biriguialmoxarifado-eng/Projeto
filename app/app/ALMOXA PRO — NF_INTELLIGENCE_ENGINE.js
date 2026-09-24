/**
 * ============================================================
 * ALMOXA PRO — NF_INTELLIGENCE_ENGINE
 * Versão 1.0.0
 * ------------------------------------------------------------
 * O MOTOR QUE ENTENDE A NOTA FISCAL
 *
 * Cada serviço de leitura devolve a resposta no seu próprio
 * formato. Se esse formato vazasse para o resto do sistema,
 * trocar de fornecedor exigiria reescrever tudo.
 *
 * Aqui cada um passa por um adaptador e vira o MESMO objeto
 * interno. O resto do ALMOXA só conhece esse objeto.
 *
 *   XML     → AdaptadorXML     ┐
 *   Azure   → AdaptadorAzure   ├→  NF PADRÃO  →  conferência
 *   Google  → AdaptadorGoogle  ┤
 *   OCR     → AdaptadorTexto   ┘
 *
 * ------------------------------------------------------------
 * A REGRA QUE MANDA
 *
 * A leitura NUNCA dá entrada no estoque sozinha. Ela prepara a
 * conferência; quem efetiva é uma pessoa, e quem grava é o Core.
 *
 * E campo que não foi encontrado fica VAZIO, com a marca
 * "não identificado". Nunca é preenchido com chute.
 * ============================================================
 */

var AP_NF_CFG = {
  versao: '1.0.0',

  /* faixas de confiança por campo */
  confianca: {
    alta: 90,      /* 🟢 usar direto */
    media: 70      /* 🟡 revisar; abaixo disso 🔴 não identificado */
  },

  /* diferença tolerada ao conferir a matemática da nota */
  toleranciaCentavos: 0.05
};

/* ============================================================
   O OBJETO PADRÃO
   ============================================================ */

function AP_NF_novoPadrao_() {
  return {
    identificacao: {
      numero: null, serie: null, chave: null, modelo: null,
      dataEmissao: null, dataSaida: null, naturezaOperacao: null
    },
    fornecedor: { cnpj: null, razaoSocial: null, nomeFantasia: null, endereco: null, inscricao: null },
    destinatario: { cnpj: null, razaoSocial: null },
    valores: {
      produtos: null, frete: null, desconto: null,
      icms: null, ipi: null, outros: null, total: null
    },
    itens: [],
    paginas: [],
    /* de onde veio cada campo e com que confiança */
    procedencia: {},
    motores: [],
    avisos: []
  };
}

/**
 * Registra de onde veio o campo. Sem isso, ninguém consegue
 * conferir depois por que o sistema escreveu aquele valor.
 */
function AP_NF_marcar_(nf, campo, valor, confianca, motor, pagina) {
  nf.procedencia[campo] = {
    valor: valor,
    confianca: confianca === undefined || confianca === null ? null : Number(confianca),
    motor: motor || 'desconhecido',
    pagina: pagina || null,
    status: AP_NF_statusConfianca_(confianca)
  };
  return valor;
}

function AP_NF_statusConfianca_(c) {
  if (c === undefined || c === null) return 'NAO_IDENTIFICADO';
  var n = Number(c);
  if (n >= AP_NF_CFG.confianca.alta) return 'ALTA';
  if (n >= AP_NF_CFG.confianca.media) return 'REVISAR';
  return 'BAIXA';
}

/* ============================================================
   ADAPTADORES
   ============================================================ */

/**
 * XML da NF-e — a fonte mais confiável que existe.
 * Quando há XML, ele manda: são os dados fiscais oficiais, não
 * uma interpretação de imagem.
 */
function AP_NF_adaptarXML(xml) {
  var nf = AP_NF_novoPadrao_();
  nf.motores.push('XML');

  function pegar(tag, dentro) {
    var fonte = dentro || xml;
    var m = String(fonte).match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>'));
    return m ? m[1].trim() : null;
  }

  var ide = (String(xml).match(/<ide>([\s\S]*?)<\/ide>/) || [])[1] || '';
  var emit = (String(xml).match(/<emit>([\s\S]*?)<\/emit>/) || [])[1] || '';
  var dest = (String(xml).match(/<dest>([\s\S]*?)<\/dest>/) || [])[1] || '';
  var total = (String(xml).match(/<ICMSTot>([\s\S]*?)<\/ICMSTot>/) || [])[1] || '';

  /* XML tem confiança 100: é o documento oficial, não leitura */
  nf.identificacao.numero = AP_NF_marcar_(nf, 'numero', pegar('nNF', ide), 100, 'XML');
  nf.identificacao.serie = AP_NF_marcar_(nf, 'serie', pegar('serie', ide), 100, 'XML');
  nf.identificacao.dataEmissao = AP_NF_marcar_(nf, 'dataEmissao', pegar('dhEmi', ide) || pegar('dEmi', ide), 100, 'XML');
  nf.identificacao.naturezaOperacao = AP_NF_marcar_(nf, 'naturezaOperacao', pegar('natOp', ide), 100, 'XML');

  var chave = (String(xml).match(/Id="NFe(\d{44})"/) || [])[1] || pegar('chNFe');
  nf.identificacao.chave = AP_NF_marcar_(nf, 'chave', chave, 100, 'XML');

  nf.fornecedor.cnpj = AP_NF_marcar_(nf, 'fornecedorCnpj', pegar('CNPJ', emit), 100, 'XML');
  nf.fornecedor.razaoSocial = AP_NF_marcar_(nf, 'fornecedorNome', pegar('xNome', emit), 100, 'XML');
  nf.fornecedor.nomeFantasia = pegar('xFant', emit);

  nf.destinatario.cnpj = pegar('CNPJ', dest);
  nf.destinatario.razaoSocial = pegar('xNome', dest);

  nf.valores.produtos = AP_NF_marcar_(nf, 'valorProdutos', AP_NF_numero_(pegar('vProd', total)), 100, 'XML');
  nf.valores.frete = AP_NF_numero_(pegar('vFrete', total));
  nf.valores.desconto = AP_NF_numero_(pegar('vDesc', total));
  nf.valores.icms = AP_NF_numero_(pegar('vICMS', total));
  nf.valores.ipi = AP_NF_numero_(pegar('vIPI', total));
  nf.valores.total = AP_NF_marcar_(nf, 'valorTotal', AP_NF_numero_(pegar('vNF', total)), 100, 'XML');

  /* itens */
  var blocos = String(xml).match(/<det[^>]*>[\s\S]*?<\/det>/g) || [];
  blocos.forEach(function (bloco, i) {
    var prod = (bloco.match(/<prod>([\s\S]*?)<\/prod>/) || [])[1] || '';
    nf.itens.push({
      ordem: i + 1,
      codigo: pegar('cProd', prod),
      descricao: pegar('xProd', prod),
      ncm: pegar('NCM', prod),
      cfop: pegar('CFOP', prod),
      unidade: pegar('uCom', prod),
      quantidade: AP_NF_numero_(pegar('qCom', prod)),
      valorUnitario: AP_NF_numero_(pegar('vUnCom', prod)),
      valorTotal: AP_NF_numero_(pegar('vProd', prod)),
      confianca: 100,
      motor: 'XML',
      /* preenchido depois pelo cruzamento com o catálogo */
      sku: null, descricaoAlmoxa: null, confiancaMatch: null, statusMatch: 'PENDENTE'
    });
  });

  return nf;
}

/**
 * Azure Document Intelligence — modelo de invoice.
 * A resposta traz campos com confiança própria; aqui ela é
 * traduzida para o padrão interno.
 */
function AP_NF_adaptarAzure(resposta) {
  var nf = AP_NF_novoPadrao_();
  nf.motores.push('AZURE');

  var doc = (resposta && resposta.analyzeResult &&
    resposta.analyzeResult.documents && resposta.analyzeResult.documents[0]) || null;

  if (!doc || !doc.fields) {
    nf.avisos.push({
      nivel: 'ERRO',
      mensagem: 'O Azure respondeu, mas sem campos estruturados. ' +
        'Pode ser imagem de baixa qualidade ou documento que o modelo não reconheceu.'
    });
    return nf;
  }

  var f = doc.fields;

  function campo(nome) {
    var c = f[nome];
    if (!c) return { valor: null, confianca: null };
    var v = c.valueString || c.content ||
      (c.valueNumber !== undefined ? c.valueNumber : null) ||
      (c.valueDate || null) ||
      (c.valueCurrency ? c.valueCurrency.amount : null);
    return { valor: v, confianca: c.confidence !== undefined ? Math.round(c.confidence * 100) : null };
  }

  var numero = campo('InvoiceId');
  nf.identificacao.numero = AP_NF_marcar_(nf, 'numero', numero.valor, numero.confianca, 'AZURE', 1);

  var data = campo('InvoiceDate');
  nf.identificacao.dataEmissao = AP_NF_marcar_(nf, 'dataEmissao', data.valor, data.confianca, 'AZURE', 1);

  var forn = campo('VendorName');
  nf.fornecedor.razaoSocial = AP_NF_marcar_(nf, 'fornecedorNome', forn.valor, forn.confianca, 'AZURE', 1);

  var cnpj = campo('VendorTaxId');
  nf.fornecedor.cnpj = AP_NF_marcar_(nf, 'fornecedorCnpj', cnpj.valor, cnpj.confianca, 'AZURE', 1);

  var tot = campo('InvoiceTotal');
  nf.valores.total = AP_NF_marcar_(nf, 'valorTotal', AP_NF_numero_(tot.valor), tot.confianca, 'AZURE', 1);

  var sub = campo('SubTotal');
  nf.valores.produtos = AP_NF_marcar_(nf, 'valorProdutos', AP_NF_numero_(sub.valor), sub.confianca, 'AZURE', 1);

  /* itens */
  var linhas = (f.Items && f.Items.valueArray) || [];
  linhas.forEach(function (linha, i) {
    var v = linha.valueObject || {};
    function sub2(nome) {
      var c = v[nome];
      if (!c) return null;
      return c.valueString || c.content ||
        (c.valueNumber !== undefined ? c.valueNumber : null) ||
        (c.valueCurrency ? c.valueCurrency.amount : null);
    }
    nf.itens.push({
      ordem: i + 1,
      codigo: sub2('ProductCode'),
      descricao: sub2('Description'),
      unidade: sub2('Unit'),
      quantidade: AP_NF_numero_(sub2('Quantity')),
      valorUnitario: AP_NF_numero_(sub2('UnitPrice')),
      valorTotal: AP_NF_numero_(sub2('Amount')),
      confianca: linha.confidence !== undefined ? Math.round(linha.confidence * 100) : null,
      motor: 'AZURE',
      sku: null, descricaoAlmoxa: null, confiancaMatch: null, statusMatch: 'PENDENTE'
    });
  });

  if (!nf.itens.length) {
    nf.avisos.push({
      nivel: 'ATENCAO',
      mensagem: 'Nenhum item foi identificado. A tabela de produtos pode estar cortada ou ilegível.'
    });
  }

  return nf;
}

/** Google Document AI — invoice parser */
function AP_NF_adaptarGoogle(resposta) {
  var nf = AP_NF_novoPadrao_();
  nf.motores.push('GOOGLE');

  var doc = (resposta && resposta.document) || null;
  if (!doc || !doc.entities) {
    nf.avisos.push({
      nivel: 'ERRO',
      mensagem: 'O Google respondeu, mas sem entidades. Confira se o processador é o Invoice Parser.'
    });
    return nf;
  }

  var mapa = {};
  doc.entities.forEach(function (e) {
    if (e.type === 'line_item') return;
    mapa[e.type] = {
      valor: e.mentionText || (e.normalizedValue && e.normalizedValue.text) || null,
      confianca: e.confidence !== undefined ? Math.round(e.confidence * 100) : null,
      pagina: (e.pageAnchor && e.pageAnchor.pageRefs && e.pageAnchor.pageRefs[0] &&
        Number(e.pageAnchor.pageRefs[0].page) + 1) || 1
    };
  });

  function pega(tipo) { return mapa[tipo] || { valor: null, confianca: null, pagina: null }; }

  var n = pega('invoice_id');
  nf.identificacao.numero = AP_NF_marcar_(nf, 'numero', n.valor, n.confianca, 'GOOGLE', n.pagina);

  var d = pega('invoice_date');
  nf.identificacao.dataEmissao = AP_NF_marcar_(nf, 'dataEmissao', d.valor, d.confianca, 'GOOGLE', d.pagina);

  var s = pega('supplier_name');
  nf.fornecedor.razaoSocial = AP_NF_marcar_(nf, 'fornecedorNome', s.valor, s.confianca, 'GOOGLE', s.pagina);

  var st = pega('supplier_tax_id');
  nf.fornecedor.cnpj = AP_NF_marcar_(nf, 'fornecedorCnpj', st.valor, st.confianca, 'GOOGLE', st.pagina);

  var t = pega('total_amount');
  nf.valores.total = AP_NF_marcar_(nf, 'valorTotal', AP_NF_numero_(t.valor), t.confianca, 'GOOGLE', t.pagina);

  var imp = pega('total_tax_amount');
  nf.valores.icms = AP_NF_numero_(imp.valor);

  /* itens vêm como entidades line_item com propriedades */
  doc.entities.filter(function (e) { return e.type === 'line_item'; })
    .forEach(function (e, i) {
      var props = {};
      (e.properties || []).forEach(function (p) {
        props[p.type] = p.mentionText || (p.normalizedValue && p.normalizedValue.text) || null;
      });

      nf.itens.push({
        ordem: i + 1,
        codigo: props['line_item/product_code'] || null,
        descricao: props['line_item/description'] || null,
        unidade: props['line_item/unit'] || null,
        quantidade: AP_NF_numero_(props['line_item/quantity']),
        valorUnitario: AP_NF_numero_(props['line_item/unit_price']),
        valorTotal: AP_NF_numero_(props['line_item/amount']),
        confianca: e.confidence !== undefined ? Math.round(e.confidence * 100) : null,
        motor: 'GOOGLE',
        sku: null, descricaoAlmoxa: null, confiancaMatch: null, statusMatch: 'PENDENTE'
      });
    });

  return nf;
}

/** Converte "1.234,56" ou "1234.56" em número */
function AP_NF_numero_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;

  var t = String(v).replace(/[R$\s]/g, '');
  /* formato brasileiro: ponto separa milhar, vírgula separa decimal */
  if (t.indexOf(',') > -1) t = t.replace(/\./g, '').replace(',', '.');
  var n = Number(t);
  return isNaN(n) ? null : n;
}

/* ============================================================
   COMPARAÇÃO ENTRE MOTORES
   ============================================================ */

/**
 * Junta o que dois motores encontraram, campo a campo.
 *
 * Não escolhe em silêncio quando eles discordam: marca o conflito
 * para a pessoa decidir. Escolher sozinho seria fingir certeza.
 */
function AP_NF_consolidar(a, b) {
  if (!a) return b;
  if (!b) return a;

  var nf = AP_NF_novoPadrao_();
  nf.motores = (a.motores || []).concat(b.motores || []);
  nf.avisos = (a.avisos || []).concat(b.avisos || []);

  var caminhos = [
    ['identificacao', 'numero', 'numero'],
    ['identificacao', 'serie', 'serie'],
    ['identificacao', 'chave', 'chave'],
    ['identificacao', 'dataEmissao', 'dataEmissao'],
    ['fornecedor', 'cnpj', 'fornecedorCnpj'],
    ['fornecedor', 'razaoSocial', 'fornecedorNome'],
    ['valores', 'total', 'valorTotal'],
    ['valores', 'produtos', 'valorProdutos']
  ];

  caminhos.forEach(function (c) {
    var grupo = c[0], campo = c[1], chave = c[2];
    var pa = a.procedencia[chave], pb = b.procedencia[chave];

    var va = pa ? pa.valor : (a[grupo] ? a[grupo][campo] : null);
    var vb = pb ? pb.valor : (b[grupo] ? b[grupo][campo] : null);

    var ca = pa && pa.confianca !== null ? pa.confianca : -1;
    var cb = pb && pb.confianca !== null ? pb.confianca : -1;

    /* só um encontrou */
    if (va && !vb) { nf[grupo][campo] = AP_NF_marcar_(nf, chave, va, ca, pa && pa.motor, pa && pa.pagina); return; }
    if (vb && !va) { nf[grupo][campo] = AP_NF_marcar_(nf, chave, vb, cb, pb && pb.motor, pb && pb.pagina); return; }
    if (!va && !vb) { nf[grupo][campo] = null; return; }

    /* os dois concordam: confiança sobe */
    if (AP_NF_mesmoValor_(va, vb)) {
      var melhor = Math.max(ca, cb);
      nf[grupo][campo] = AP_NF_marcar_(nf, chave, va,
        Math.min(100, melhor + 5), 'CONFIRMADO', pa && pa.pagina);
      nf.procedencia[chave].confirmadoPor = [pa && pa.motor, pb && pb.motor].filter(Boolean);
      return;
    }

    /* discordam: fica o mais confiante, MAS o conflito é registrado */
    var venceu = ca >= cb ? { v: va, c: ca, p: pa } : { v: vb, c: cb, p: pb };
    var perdeu = ca >= cb ? { v: vb, c: cb, p: pb } : { v: va, c: ca, p: pa };

    nf[grupo][campo] = AP_NF_marcar_(nf, chave, venceu.v, venceu.c, venceu.p && venceu.p.motor,
      venceu.p && venceu.p.pagina);
    nf.procedencia[chave].conflito = {
      escolhido: { valor: venceu.v, confianca: venceu.c, motor: venceu.p && venceu.p.motor },
      descartado: { valor: perdeu.v, confianca: perdeu.c, motor: perdeu.p && perdeu.p.motor }
    };
    nf.procedencia[chave].status = 'REVISAR';

    nf.avisos.push({
      nivel: 'CONFLITO', campo: chave,
      mensagem: 'Os motores encontraram valores diferentes para ' + chave + ': "' +
        venceu.v + '" e "' + perdeu.v + '". Confirme qual está certo.'
    });
  });

  /* itens: fica a lista mais completa */
  nf.itens = (a.itens || []).length >= (b.itens || []).length ? a.itens : b.itens;
  nf.paginas = (a.paginas || []).concat(b.paginas || []);

  return nf;
}

function AP_NF_mesmoValor_(a, b) {
  if (a === b) return true;
  var na = AP_NF_numero_(a), nb = AP_NF_numero_(b);
  if (na !== null && nb !== null) return Math.abs(na - nb) < 0.01;
  return String(a).replace(/[^\w]/g, '').toUpperCase() ===
    String(b).replace(/[^\w]/g, '').toUpperCase();
}

/* ============================================================
   VALIDAÇÃO
   ============================================================ */

/**
 * Confere a matemática da nota e o que falta.
 * Divergência não é escondida: é mostrada com o valor exato.
 */
function AP_NF_validar(nf) {
  var criticos = [], avisos = [];

  if (!nf.identificacao.numero) {
    criticos.push({ campo: 'numero', mensagem: 'Número da nota não identificado no documento.' });
  }
  if (!nf.fornecedor.razaoSocial && !nf.fornecedor.cnpj) {
    criticos.push({ campo: 'fornecedor', mensagem: 'Fornecedor não identificado no documento.' });
  }
  if (!nf.itens.length) {
    criticos.push({ campo: 'itens', mensagem: 'Nenhum item foi identificado. Sem itens não há entrada.' });
  }

  /* CNPJ com dígito verificador */
  if (nf.fornecedor.cnpj && !AP_NF_cnpjValido_(nf.fornecedor.cnpj)) {
    avisos.push({
      campo: 'fornecedorCnpj',
      mensagem: 'O CNPJ lido (' + nf.fornecedor.cnpj + ') não passa na verificação. Confira o número.'
    });
  }

  /* soma dos itens contra o total da nota */
  var somaItens = 0, itensComProblema = [];
  nf.itens.forEach(function (i) {
    var q = Number(i.quantidade) || 0;
    var vu = Number(i.valorUnitario) || 0;
    var vt = Number(i.valorTotal) || 0;

    if (q <= 0) {
      itensComProblema.push({ ordem: i.ordem, descricao: i.descricao, problema: 'quantidade inválida' });
    }

    var calculado = q * vu;
    if (vt && Math.abs(calculado - vt) > AP_NF_CFG.toleranciaCentavos) {
      itensComProblema.push({
        ordem: i.ordem, descricao: i.descricao,
        problema: 'quantidade × valor unitário = ' + calculado.toFixed(2) +
          ', mas a nota diz ' + vt.toFixed(2)
      });
    }
    somaItens += vt || calculado;
  });

  var conferencia = {
    somaDosItens: Math.round(somaItens * 100) / 100,
    totalDaNota: nf.valores.total,
    divergencia: null
  };

  if (nf.valores.total !== null) {
    var dif = Math.round((nf.valores.total - somaItens) * 100) / 100;
    if (Math.abs(dif) > AP_NF_CFG.toleranciaCentavos) {
      conferencia.divergencia = dif;

      /* frete e imposto explicam parte da diferença */
      var extras = (Number(nf.valores.frete) || 0) + (Number(nf.valores.ipi) || 0) -
        (Number(nf.valores.desconto) || 0);
      var sobra = Math.round((dif - extras) * 100) / 100;

      avisos.push({
        campo: 'total',
        mensagem: 'Soma dos itens: R$ ' + somaItens.toFixed(2) +
          ' · Total da nota: R$ ' + Number(nf.valores.total).toFixed(2) +
          ' · Diferença: R$ ' + Math.abs(dif).toFixed(2) +
          (Math.abs(sobra) <= AP_NF_CFG.toleranciaCentavos
            ? ' — explicada por frete, IPI e desconto.'
            : ' — NÃO explicada por frete, IPI ou desconto. Confira antes de efetivar.')
      });
    }
  }

  return {
    ok: criticos.length === 0,
    podeEfetivar: criticos.length === 0,
    criticos: criticos,
    avisos: avisos,
    itensComProblema: itensComProblema,
    conferencia: conferencia
  };
}

function AP_NF_cnpjValido_(cnpj) {
  var n = String(cnpj).replace(/\D/g, '');
  if (n.length !== 14) return false;
  if (/^(\d)\1+$/.test(n)) return false;

  function digito(base, pesos) {
    var soma = 0;
    for (var i = 0; i < pesos.length; i++) soma += Number(base[i]) * pesos[i];
    var r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  }

  var d1 = digito(n, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  var d2 = digito(n, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return Number(n[12]) === d1 && Number(n[13]) === d2;
}

/* ============================================================
   CRUZAMENTO COM O CATÁLOGO
   ============================================================ */

/**
 * Procura cada item da nota no Cadastro Central.
 * Usa o motor de correspondência que já existe — o mesmo que
 * atende o módulo de projetos, para não haver duas lógicas.
 */
function AP_NF_relacionarCatalogo(nf, sessao) {
  if (typeof AP_PIE_procurar !== 'function') {
    nf.avisos.push({
      nivel: 'ATENCAO',
      mensagem: 'O motor de correspondência não está instalado. Os itens ficam sem SKU até serem ligados à mão.'
    });
    return nf;
  }

  nf.itens.forEach(function (item) {
    if (!item.descricao) {
      item.statusMatch = 'SEM_DESCRICAO';
      return;
    }

    var r = AP_PIE_procurar({
      descricao: item.descricao, codigo: item.codigo, unidade: item.unidade
    }, sessao);

    var d = r.dados || {};

    if (d.encontrado) {
      item.sku = d.sku;
      item.descricaoAlmoxa = d.descricao;
      item.confiancaMatch = d.confianca;
      item.statusMatch = 'IDENTIFICADO';
    } else if (d.precisaConfirmar && d.candidatos && d.candidatos.length) {
      item.candidatos = d.candidatos;
      item.confiancaMatch = d.confianca;
      item.statusMatch = 'REVISAR';
    } else {
      item.statusMatch = 'NAO_ENCONTRADO';
      item.candidatos = [];
    }
  });

  var resumo = {
    identificados: nf.itens.filter(function (i) { return i.statusMatch === 'IDENTIFICADO'; }).length,
    revisar: nf.itens.filter(function (i) { return i.statusMatch === 'REVISAR'; }).length,
    naoEncontrados: nf.itens.filter(function (i) { return i.statusMatch === 'NAO_ENCONTRADO'; }).length
  };
  nf.resumoMatch = resumo;

  return nf;
}

/* ============================================================
   DUPLICIDADE
   ============================================================ */

function AP_NF_jaExiste(nf) {
  var lista = [];
  try {
    var r = AP_Modulo_nf('listar', {}, { perfil: 'ADMINISTRADOR', usuario: 'motor' });
    lista = (r && r.ok) ? r.dados : [];
  } catch (e) { return { existe: false } }

  /* a chave é única por definição — se bate, é a mesma nota */
  if (nf.identificacao.chave) {
    var porChave = lista.filter(function (n) { return n.chave === nf.identificacao.chave; })[0];
    if (porChave) {
      return {
        existe: true, motivo: 'CHAVE',
        mensagem: 'Esta NF já está cadastrada (chave de acesso idêntica).',
        nota: porChave
      };
    }
  }

  /* mesmo número + mesmo fornecedor também é a mesma nota */
  if (nf.identificacao.numero && nf.fornecedor.cnpj) {
    var cnpjLimpo = String(nf.fornecedor.cnpj).replace(/\D/g, '');
    var porNumero = lista.filter(function (n) {
      return String(n.numero) === String(nf.identificacao.numero) &&
        String(n.cnpj || '').replace(/\D/g, '') === cnpjLimpo;
    })[0];

    if (porNumero) {
      return {
        existe: true, motivo: 'NUMERO_FORNECEDOR',
        mensagem: 'Já existe a nota ' + nf.identificacao.numero +
          ' deste fornecedor. Lançar de novo duplicaria o estoque.',
        nota: porNumero
      };
    }
  }

  return { existe: false };
}

/* ============================================================
   MÓDULO
   ============================================================ */

function AP_Modulo_nfmotor(acao, payload, sessao) {
  payload = payload || {};

  try {
    switch (acao) {

      /** Lê o XML — o caminho mais confiável */
      case 'lerXML': {
        if (!payload.xml) {
          return { ok: false, codigo: 'SEM_XML', mensagem: 'Envie o conteúdo do XML.' };
        }
        var nf = AP_NF_adaptarXML(payload.xml);
        nf = AP_NF_relacionarCatalogo(nf, sessao);

        return {
          ok: true,
          dados: {
            nf: nf,
            validacao: AP_NF_validar(nf),
            duplicidade: AP_NF_jaExiste(nf)
          }
        };
      }

      /** Recebe a resposta de um serviço de leitura e padroniza */
      case 'interpretar': {
        var padronizada = null;

        if (payload.azure) padronizada = AP_NF_adaptarAzure(payload.azure);
        if (payload.google) {
          var g = AP_NF_adaptarGoogle(payload.google);
          padronizada = padronizada ? AP_NF_consolidar(padronizada, g) : g;
        }
        if (payload.xml) {
          var x = AP_NF_adaptarXML(payload.xml);
          /* o XML tem prioridade: é documento fiscal, não leitura */
          padronizada = padronizada ? AP_NF_consolidar(x, padronizada) : x;
        }

        if (!padronizada) {
          return {
            ok: false, codigo: 'SEM_ENTRADA',
            mensagem: 'Nenhum resultado de leitura foi enviado.'
          };
        }

        padronizada = AP_NF_relacionarCatalogo(padronizada, sessao);

        return {
          ok: true,
          dados: {
            nf: padronizada,
            validacao: AP_NF_validar(padronizada),
            duplicidade: AP_NF_jaExiste(padronizada)
          }
        };
      }

      case 'validar':
        if (!payload.nf) return { ok: false, codigo: 'SEM_NF', mensagem: 'Envie a nota.' };
        return { ok: true, dados: AP_NF_validar(payload.nf) };

      case 'duplicidade':
        if (!payload.nf) return { ok: false, codigo: 'SEM_NF', mensagem: 'Envie a nota.' };
        return { ok: true, dados: AP_NF_jaExiste(payload.nf) };

      case 'relacionar':
        if (!payload.nf) return { ok: false, codigo: 'SEM_NF', mensagem: 'Envie a nota.' };
        return { ok: true, dados: AP_NF_relacionarCatalogo(payload.nf, sessao) };

      case 'versao':
        return {
          ok: true,
          dados: {
            motor: 'NF_INTELLIGENCE_ENGINE', versao: AP_NF_CFG.versao,
            adaptadores: ['XML', 'AZURE', 'GOOGLE'],
            confianca: AP_NF_CFG.confianca,
            /* deixa claro o que depende de configuração externa */
            servicos: {
              xml: 'pronto — não depende de serviço externo',
              azure: AP_Config_get('AZURE_DI_ENDPOINT', '') ? 'configurado' : 'não configurado',
              google: AP_Config_get('GOOGLE_DOCAI_ENDPOINT', '') ? 'configurado' : 'não configurado'
            }
          }
        };

      default:
        return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'nfmotor.' + acao + ' não existe.' };
    }
  } catch (e) {
    AP_ErrorHandler_capture('AP_Modulo_nfmotor:' + acao, e);
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'nfmotor', acao: acao, mensagem: e.message };
  }
}

/* ============================================================
   TESTE
   ============================================================ */
function testeMotorNF() {
  var log = [];
  function reg(t, ok, d) { log.push((ok ? 'OK    ' : 'ERRO  ') + t + (d ? ' — ' + d : '')); }

  try {
    /* ---------- XML ---------- */
    var xml =
      '<nfeProc><NFe><infNFe Id="NFe35240612345678000195550010000184421000184428">' +
      '<ide><nNF>18442</nNF><serie>1</serie><dhEmi>2026-09-01T10:00:00-03:00</dhEmi>' +
      '<natOp>VENDA</natOp></ide>' +
      '<emit><CNPJ>12345678000195</CNPJ><xNome>HIDROSUL MATERIAIS LTDA</xNome></emit>' +
      '<dest><CNPJ>98765432000110</CNPJ><xNome>CONSTRUTORA X</xNome></dest>' +
      '<det nItem="1"><prod><cProd>JG902</cProd><xProd>JOELHO GALVANIZADO 90 2"</xProd>' +
      '<NCM>73079900</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>24</qCom>' +
      '<vUnCom>12.50</vUnCom><vProd>300.00</vProd></prod></det>' +
      '<det nItem="2"><prod><cProd>TB2</cProd><xProd>TUBO GALVANIZADO 2"</xProd>' +
      '<NCM>73063000</NCM><CFOP>5102</CFOP><uCom>M</uCom><qCom>50</qCom>' +
      '<vUnCom>34.00</vUnCom><vProd>1700.00</vProd></prod></det>' +
      '<total><ICMSTot><vProd>2000.00</vProd><vFrete>0.00</vFrete><vDesc>0.00</vDesc>' +
      '<vICMS>360.00</vICMS><vIPI>0.00</vIPI><vNF>2000.00</vNF></ICMSTot></total>' +
      '</infNFe></NFe></nfeProc>';

    var nfXml = AP_NF_adaptarXML(xml);
    reg('lê o número da nota', nfXml.identificacao.numero === '18442', nfXml.identificacao.numero);
    reg('lê a chave de acesso', (nfXml.identificacao.chave || '').length === 44, nfXml.identificacao.chave);
    reg('lê o fornecedor', nfXml.fornecedor.razaoSocial === 'HIDROSUL MATERIAIS LTDA', '');
    reg('lê o CNPJ', nfXml.fornecedor.cnpj === '12345678000195', nfXml.fornecedor.cnpj);
    reg('lê o valor total', nfXml.valores.total === 2000, 'R$ ' + nfXml.valores.total);
    reg('lê os dois itens', nfXml.itens.length === 2,
      nfXml.itens.map(function (i) { return i.descricao; }).join(' / '));
    reg('lê quantidade e valor do item',
      nfXml.itens[0].quantidade === 24 && nfXml.itens[0].valorUnitario === 12.5, '');
    reg('XML tem confiança máxima', nfXml.procedencia.numero.confianca === 100, '');

    /* ---------- VALIDAÇÃO ---------- */
    var v = AP_NF_validar(nfXml);
    reg('a matemática confere', v.ok && !v.conferencia.divergencia,
      'soma ' + v.conferencia.somaDosItens + ' = total ' + v.conferencia.totalDaNota);

    var nfErrada = JSON.parse(JSON.stringify(nfXml));
    nfErrada.valores.total = 2500;
    var v2 = AP_NF_validar(nfErrada);
    reg('DETECTA divergência de valor', v2.avisos.some(function (a) { return a.campo === 'total'; }),
      v2.avisos.filter(function (a) { return a.campo === 'total'; })[0].mensagem.slice(0, 70));

    var nfItemErrado = JSON.parse(JSON.stringify(nfXml));
    nfItemErrado.itens[0].valorTotal = 999;
    var v3 = AP_NF_validar(nfItemErrado);
    reg('DETECTA item com conta errada', v3.itensComProblema.length > 0,
      v3.itensComProblema[0].problema);

    var nfSemNumero = JSON.parse(JSON.stringify(nfXml));
    nfSemNumero.identificacao.numero = null;
    var v4 = AP_NF_validar(nfSemNumero);
    reg('impede efetivar sem número', v4.podeEfetivar === false, v4.criticos[0].mensagem);

    var nfSemItens = JSON.parse(JSON.stringify(nfXml));
    nfSemItens.itens = [];
    reg('impede efetivar sem itens', AP_NF_validar(nfSemItens).podeEfetivar === false, '');

    /* ---------- CNPJ ---------- */
    /* 12345678000195 fecha nos dois dígitos; ...90 não fecha.
       O primeiro teste usava o número errado — a função estava certa. */
    reg('valida CNPJ correto', AP_NF_cnpjValido_('12345678000195') === true, '');
    reg('recusa CNPJ com dígito errado', AP_NF_cnpjValido_('12345678000190') === false,
      'um dígito trocado já derruba');
    reg('recusa CNPJ inventado', AP_NF_cnpjValido_('11111111111111') === false, '');

    var nfCnpjRuim = JSON.parse(JSON.stringify(nfXml));
    nfCnpjRuim.fornecedor.cnpj = '12345678000190';
    reg('avisa CNPJ que não fecha',
      AP_NF_validar(nfCnpjRuim).avisos.some(function (a) { return a.campo === 'fornecedorCnpj'; }), '');

    /* ---------- AZURE ---------- */
    var azure = {
      analyzeResult: {
        documents: [{
          fields: {
            InvoiceId: { valueString: '18442', confidence: 0.98 },
            VendorName: { valueString: 'HIDROSUL MATERIAIS LTDA', confidence: 0.95 },
            InvoiceTotal: { valueCurrency: { amount: 2000 }, confidence: 0.99 },
            Items: {
              valueArray: [{
                valueObject: {
                  Description: { valueString: 'JOELHO GALV 90 2' },
                  Quantity: { valueNumber: 24 },
                  UnitPrice: { valueCurrency: { amount: 12.5 } },
                  Amount: { valueCurrency: { amount: 300 } }
                },
                confidence: 0.91
              }]
            }
          }
        }]
      }
    };
    var nfAzure = AP_NF_adaptarAzure(azure);
    reg('adaptador Azure lê os campos',
      nfAzure.identificacao.numero === '18442' && nfAzure.valores.total === 2000, '');
    reg('Azure traz a confiança', nfAzure.procedencia.numero.confianca === 98, '98%');
    reg('Azure lê os itens', nfAzure.itens.length === 1, nfAzure.itens[0].descricao);

    var azureVazio = AP_NF_adaptarAzure({ analyzeResult: { documents: [] } });
    reg('Azure sem campos avisa em vez de fingir',
      azureVazio.avisos.length > 0 && !azureVazio.identificacao.numero,
      azureVazio.avisos[0].mensagem.slice(0, 50));

    /* ---------- GOOGLE ---------- */
    var google = {
      document: {
        entities: [
          { type: 'invoice_id', mentionText: '18442', confidence: 0.99 },
          { type: 'supplier_name', mentionText: 'HIDROSUL MATERIAIS LTDA', confidence: 0.97 },
          { type: 'total_amount', mentionText: '2.000,00', confidence: 0.96 },
          {
            type: 'line_item', confidence: 0.93,
            properties: [
              { type: 'line_item/description', mentionText: 'JOELHO GALVANIZADO 90 2"' },
              { type: 'line_item/quantity', mentionText: '24' },
              { type: 'line_item/unit_price', mentionText: '12,50' }
            ]
          }
        ]
      }
    };
    var nfGoogle = AP_NF_adaptarGoogle(google);
    reg('adaptador Google lê os campos', nfGoogle.identificacao.numero === '18442', '');
    reg('Google entende valor no formato brasileiro', nfGoogle.valores.total === 2000, 'R$ 2.000,00 → 2000');
    reg('Google lê os itens de linha', nfGoogle.itens.length === 1 && nfGoogle.itens[0].quantidade === 24, '');

    /* ---------- CONSOLIDAÇÃO ---------- */
    var juntos = AP_NF_consolidar(nfAzure, nfGoogle);
    reg('quando os dois concordam, a confiança sobe',
      juntos.procedencia.numero.confianca >= 99 &&
      juntos.procedencia.numero.motor === 'CONFIRMADO',
      juntos.procedencia.numero.confianca + '%');

    var azureDiferente = AP_NF_adaptarAzure({
      analyzeResult: { documents: [{ fields: {
        VendorName: { valueString: 'EMPRESA ABC LTDA', confidence: 0.78 }
      } }] }
    });
    var googleDiferente = AP_NF_adaptarGoogle({
      document: { entities: [
        { type: 'supplier_name', mentionText: 'EMPRESA ABC INDUSTRIAL LTDA', confidence: 0.96 }
      ] }
    });
    var conflito = AP_NF_consolidar(azureDiferente, googleDiferente);
    reg('discordância fica com o mais confiante',
      conflito.fornecedor.razaoSocial === 'EMPRESA ABC INDUSTRIAL LTDA', '96% venceu 78%');
    reg('mas o conflito É REGISTRADO',
      !!conflito.procedencia.fornecedorNome.conflito &&
      conflito.avisos.some(function (a) { return a.nivel === 'CONFLITO'; }),
      'a pessoa decide');
    reg('e o campo fica marcado para revisar',
      conflito.procedencia.fornecedorNome.status === 'REVISAR', '');

    /* ---------- XML VENCE OCR ---------- */
    var comXml = AP_NF_consolidar(nfXml, azureDiferente);
    reg('o XML prevalece sobre a leitura de imagem',
      comXml.fornecedor.razaoSocial === 'HIDROSUL MATERIAIS LTDA', 'documento fiscal manda');

    /* ---------- NADA É INVENTADO ---------- */
    var vazio = AP_NF_adaptarAzure({ analyzeResult: { documents: [{ fields: {} }] } });
    reg('campo ausente fica nulo, não inventado',
      vazio.identificacao.numero === null && vazio.fornecedor.cnpj === null, '');

  } catch (e) {
    log.push('ERRO  exceção: ' + e.message);
  }

  try { Logger.log(log.join('\n')); } catch (e) { }
  return log;
}
