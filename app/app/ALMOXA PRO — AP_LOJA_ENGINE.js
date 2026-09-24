/**
 * ============================================================
 * ALMOXA PRO — AP_LOJA_ENGINE
 * Motor de compatibilidade e montagem
 * Versão 1.0.0
 * ------------------------------------------------------------
 * O QUE ESTE MOTOR FAZ
 *
 * Olha os itens que a pessoa colocou no carrinho e responde:
 * dá para montar um conjunto com isto?
 *
 * Ele é o cérebro por trás da visualização 3D. Sem ele, o 3D
 * seria um desenho bonito sem relação com a realidade —
 * mostrando conexões que não encaixam.
 *
 * ------------------------------------------------------------
 * A REGRA QUE NÃO SE QUEBRA
 *
 * Nunca inventar uma conexão. Se não há informação suficiente
 * nos itens, a resposta é "compatibilidade não identificada" —
 * e a solicitação segue normalmente.
 *
 * O 3D é um recurso a mais. Ele NUNCA impede o pedido.
 * ============================================================
 */

var AP_LOJA_CFG = {
  versao: '1.0.0',

  /**
   * Quantas pontas cada peça tem, e o que ela faz.
   * Isso é o que permite dizer se uma sequência fecha:
   * um tubo liga duas coisas, um joelho muda a direção,
   * uma válvula termina ou interrompe.
   */
  pecas: {
    TUBO: { pontas: 2, papel: 'CONDUCAO', muda: null },
    CANO: { pontas: 2, papel: 'CONDUCAO', muda: null },
    JOELHO: { pontas: 2, papel: 'MUDANCA_DIRECAO', muda: 'angulo' },
    COTOVELO: { pontas: 2, papel: 'MUDANCA_DIRECAO', muda: 'angulo' },
    CURVA: { pontas: 2, papel: 'MUDANCA_DIRECAO', muda: 'angulo' },
    LUVA: { pontas: 2, papel: 'EMENDA', muda: null },
    NIPLE: { pontas: 2, papel: 'EMENDA', muda: null },
    UNIAO: { pontas: 2, papel: 'EMENDA', muda: null },
    REDUCAO: { pontas: 2, papel: 'MUDANCA_BITOLA', muda: 'diametro' },
    BUCHA: { pontas: 2, papel: 'MUDANCA_BITOLA', muda: 'diametro' },
    TE: { pontas: 3, papel: 'DERIVACAO', muda: null },
    CRUZETA: { pontas: 4, papel: 'DERIVACAO', muda: null },
    VALVULA: { pontas: 2, papel: 'CONTROLE', muda: null },
    REGISTRO: { pontas: 2, papel: 'CONTROLE', muda: null },
    TAMPAO: { pontas: 1, papel: 'FECHAMENTO', muda: null },
    FLANGE: { pontas: 1, papel: 'FECHAMENTO', muda: null },
    ADAPTADOR: { pontas: 2, papel: 'EMENDA', muda: null },
    CONECTOR: { pontas: 2, papel: 'EMENDA', muda: null }
  },

  /* materiais que se conectam entre si sem adaptador */
  compativeis: {
    GALVANIZADO: ['GALVANIZADO', 'FERRO GALVANIZADO', 'ACO'],
    PVC: ['PVC'],
    CPVC: ['CPVC'],
    COBRE: ['COBRE', 'LATAO'],
    PPR: ['PPR']
  }
};

/* ============================================================
   ANÁLISE DOS ITENS
   ============================================================ */

/**
 * Lê os atributos de um item do carrinho.
 * Reaproveita o extrator do motor de projetos — não faz sentido
 * ter duas lógicas para entender "JOELHO GALVANIZADO 90° 2"".
 */
function AP_LOJA_analisar_(item) {
  var descricao = item.descricao || item.nome || '';

  var attr = (typeof AP_PIE_atributos === 'function')
    ? AP_PIE_atributos(descricao)
    : { tipo: null, material: null, diametro: null, angulo: null };

  var definicao = attr.tipo ? AP_LOJA_CFG.pecas[attr.tipo] : null;

  return {
    sku: item.sku || item.id,
    descricao: descricao,
    quantidade: Number(item.qtd || item.quantidade) || 1,
    tipo: attr.tipo,
    material: attr.material,
    diametro: attr.diametro,
    angulo: attr.angulo,
    pontas: definicao ? definicao.pontas : null,
    papel: definicao ? definicao.papel : null,
    /* o que faltou para entender a peça */
    faltando: [
      !attr.tipo ? 'tipo de peça' : null,
      !attr.diametro ? 'bitola' : null,
      !attr.material ? 'material' : null
    ].filter(Boolean)
  };
}

/** Dois materiais se conectam sem adaptador? */
function AP_LOJA_materiaisCompativeis_(a, b) {
  if (!a || !b) return null;          /* sem informação: não opina */
  if (a === b) return true;

  var listaA = AP_LOJA_CFG.compativeis[a] || [];
  var listaB = AP_LOJA_CFG.compativeis[b] || [];
  return listaA.indexOf(b) > -1 || listaB.indexOf(a) > -1;
}

/** Duas bitolas encaixam? */
function AP_LOJA_bitolasIguais_(a, b) {
  if (!a || !b) return null;
  var va = a.unidade === 'mm' ? a.valor : a.valor * 25.4;
  var vb = b.unidade === 'mm' ? b.valor : b.valor * 25.4;
  return Math.abs(va - vb) <= 2;
}

/* ============================================================
   COMPATIBILIDADE DO CARRINHO
   ============================================================ */

/**
 * Analisa o carrinho inteiro.
 *
 * Devolve um dos quatro resultados do documento:
 *   COMPATIVEL · PARCIALMENTE_COMPATIVEL · INCOMPATIVEL · NAO_IDENTIFICADO
 *
 * E, principalmente, DIZ POR QUÊ. Um "incompatível" sem motivo
 * não ajuda ninguém a resolver.
 */
function AP_LOJA_compatibilidade(itens) {
  var lista = (itens || []).map(AP_LOJA_analisar_);

  if (!lista.length) {
    return {
      resultado: 'NAO_IDENTIFICADO',
      mensagem: 'Nenhum item no carrinho.',
      pecas: [], observacoes: []
    };
  }

  /* peças que o motor não conseguiu entender */
  var reconhecidas = lista.filter(function (p) { return p.tipo; });
  var desconhecidas = lista.filter(function (p) { return !p.tipo; });

  if (!reconhecidas.length) {
    return {
      resultado: 'NAO_IDENTIFICADO',
      mensagem: 'Compatibilidade não identificada. Os itens não parecem ser conexões que se encaixam.',
      pecas: lista,
      observacoes: [{
        nivel: 'INFO',
        texto: 'A montagem 3D só é possível com peças de tubulação. ' +
          'A solicitação segue normalmente sem ela.'
      }]
    };
  }

  /* uma peça só não é conjunto */
  if (reconhecidas.length === 1) {
    return {
      resultado: 'NAO_IDENTIFICADO',
      mensagem: 'Um único item não forma um conjunto. Acrescente as peças que se conectam a ele.',
      pecas: lista, observacoes: []
    };
  }

  var observacoes = [];
  var conflitos = [];

  /* --- bitolas --- */
  var comBitola = reconhecidas.filter(function (p) { return p.diametro; });
  var semBitola = reconhecidas.filter(function (p) { return !p.diametro; });

  var bitolas = {};
  comBitola.forEach(function (p) {
    var mm = p.diametro.unidade === 'mm' ? p.diametro.valor : p.diametro.valor * 25.4;
    var chave = Math.round(mm);
    bitolas[chave] = (bitolas[chave] || 0) + 1;
  });
  var bitolasDistintas = Object.keys(bitolas);

  /* peça que muda de bitola explica a diferença */
  var temReducao = reconhecidas.some(function (p) { return p.papel === 'MUDANCA_BITOLA'; });

  if (bitolasDistintas.length > 1 && !temReducao) {
    conflitos.push({
      tipo: 'BITOLA',
      texto: 'Há bitolas diferentes no carrinho e nenhuma peça de redução. ' +
        'Sem redução, elas não se encaixam entre si.'
    });
  } else if (bitolasDistintas.length > 1 && temReducao) {
    observacoes.push({
      nivel: 'INFO',
      texto: 'Bitolas diferentes, ligadas por peça de redução.'
    });
  }

  /* --- materiais --- */
  var materiais = {};
  reconhecidas.forEach(function (p) { if (p.material) materiais[p.material] = true; });
  var listaMateriais = Object.keys(materiais);

  if (listaMateriais.length > 1) {
    var todosCompativeis = true;
    for (var i = 0; i < listaMateriais.length; i++) {
      for (var j = i + 1; j < listaMateriais.length; j++) {
        if (AP_LOJA_materiaisCompativeis_(listaMateriais[i], listaMateriais[j]) === false) {
          todosCompativeis = false;
        }
      }
    }
    if (!todosCompativeis) {
      conflitos.push({
        tipo: 'MATERIAL',
        texto: 'Materiais diferentes no mesmo conjunto (' + listaMateriais.join(', ') + '). ' +
          'Costumam precisar de adaptador para se unir.'
      });
    }
  }

  /* --- o que faltou saber --- */
  if (semBitola.length) {
    observacoes.push({
      nivel: 'ATENCAO',
      texto: semBitola.length + ' item(ns) sem bitola na descrição: ' +
        semBitola.map(function (p) { return p.descricao; }).join(', ') +
        '. A compatibilidade deles não pôde ser conferida.'
    });
  }

  if (desconhecidas.length) {
    observacoes.push({
      nivel: 'INFO',
      texto: desconhecidas.length + ' item(ns) fora da montagem por não serem conexões: ' +
        desconhecidas.map(function (p) { return p.descricao; }).join(', ')
    });
  }

  /* --- veredito --- */
  var resultado, mensagem;

  if (conflitos.length) {
    resultado = 'INCOMPATIVEL';
    mensagem = conflitos.map(function (c) { return c.texto; }).join(' ');
  } else if (semBitola.length || bitolasDistintas.length === 0) {
    resultado = 'PARCIALMENTE_COMPATIVEL';
    mensagem = 'As peças parecem compatíveis, mas faltam informações para confirmar.';
  } else {
    resultado = 'COMPATIVEL';
    mensagem = 'As peças são da mesma bitola' +
      (listaMateriais.length === 1 ? ' e do mesmo material' : '') + '. Dá para montar o conjunto.';
  }

  return {
    resultado: resultado,
    mensagem: mensagem,
    pecas: lista,
    conflitos: conflitos,
    observacoes: observacoes,
    resumo: {
      total: lista.length,
      reconhecidas: reconhecidas.length,
      naoReconhecidas: desconhecidas.length,
      bitolaPrincipal: bitolasDistintas.length
        ? AP_LOJA_bitolaTexto_(comBitola[0].diametro) : null,
      materiais: listaMateriais
    }
  };
}

function AP_LOJA_bitolaTexto_(d) {
  if (!d) return null;
  return d.unidade === 'mm' ? d.valor + ' mm' : d.valor + '"';
}

/* ============================================================
   MONTAGEM
   ============================================================ */

/**
 * Monta a ordem das peças, para o 3D saber onde pôr cada uma.
 *
 * A sequência não é inventada: segue o papel de cada peça.
 * Começa por um fechamento ou condução, e as conexões entram
 * onde fazem sentido.
 *
 * Quando não é possível determinar, DIZ isso — em vez de
 * desenhar qualquer coisa.
 */
function AP_LOJA_montar(itens) {
  var compat = AP_LOJA_compatibilidade(itens);

  if (compat.resultado === 'INCOMPATIVEL') {
    return {
      ok: false,
      motivo: 'INCOMPATIVEL',
      mensagem: 'Não foi possível determinar uma montagem 3D para estes itens. ' + compat.mensagem,
      compatibilidade: compat
    };
  }

  if (compat.resultado === 'NAO_IDENTIFICADO') {
    return {
      ok: false,
      motivo: 'NAO_IDENTIFICADO',
      mensagem: 'Não foi possível determinar uma montagem 3D para estes itens.',
      compatibilidade: compat
    };
  }

  /* expande a quantidade: 4 joelhos são 4 peças no desenho */
  var pecas = [];
  compat.pecas.filter(function (p) { return p.tipo; }).forEach(function (p) {
    for (var i = 0; i < p.quantidade; i++) {
      pecas.push({
        sku: p.sku, descricao: p.descricao, tipo: p.tipo,
        papel: p.papel, angulo: p.angulo,
        bitola: AP_LOJA_bitolaTexto_(p.diametro),
        material: p.material,
        indice: i + 1, deQuantos: p.quantidade
      });
    }
  });

  /* ordem da montagem: condução, emenda, direção, derivação, controle, fecho */
  var ordemPapel = {
    CONDUCAO: 1, EMENDA: 2, MUDANCA_BITOLA: 3,
    MUDANCA_DIRECAO: 4, DERIVACAO: 5, CONTROLE: 6, FECHAMENTO: 7
  };
  pecas.sort(function (a, b) {
    return (ordemPapel[a.papel] || 9) - (ordemPapel[b.papel] || 9);
  });

  /* posição de cada peça na linha, para o desenho */
  var x = 0, direcao = 0;
  var montagem = pecas.map(function (p, i) {
    var posicao = { x: x, y: 0, z: 0, rotacao: direcao };

    /* joelho muda a direção da linha a partir dali */
    if (p.papel === 'MUDANCA_DIRECAO' && p.angulo) direcao += p.angulo;

    x += 1;
    return {
      ordem: i + 1,
      sku: p.sku, descricao: p.descricao, tipo: p.tipo,
      bitola: p.bitola, material: p.material,
      posicao: posicao,
      anterior: i > 0 ? i : null,
      proxima: i < pecas.length - 1 ? i + 2 : null
    };
  });

  return {
    ok: true,
    compatibilidade: compat,
    montagem: montagem,
    conjunto: {
      pecas: montagem.length,
      tipos: Object.keys(pecas.reduce(function (m, p) { m[p.tipo] = true; return m; }, {})),
      bitolaPrincipal: compat.resumo.bitolaPrincipal,
      materiais: compat.resumo.materiais,
      /* honesto sobre o que a montagem é */
      observacao: 'Sequência sugerida a partir do tipo de cada peça. ' +
        'A montagem real depende do projeto.'
    }
  };
}

/* ============================================================
   DISPONIBILIDADE
   ============================================================ */

/**
 * Confere o que há em estoque para cada item do carrinho.
 * Sempre pelo Core — nunca por número guardado na tela.
 */
function AP_LOJA_disponibilidade(itens, sessao) {
  var resultado = [];

  (itens || []).forEach(function (item) {
    var sku = item.sku || item.id;
    var pedido = Number(item.qtd || item.quantidade) || 0;

    var atual = 0, reservado = 0, achou = false;
    try {
      var r = AP_Modulo_estoque('item', { sku: sku }, sessao);
      if (r && r.ok && r.dados) {
        achou = true;
        atual = Number(r.dados.estoque) || 0;
        reservado = Number(r.dados.reservado) || 0;
      }
    } catch (e) { }

    var disponivel = Math.max(0, atual - reservado);

    var situacao;
    if (!achou) situacao = 'NAO_ENCONTRADO';
    else if (disponivel >= pedido) situacao = 'DISPONIVEL';
    else if (disponivel > 0) situacao = 'PARCIAL';
    else situacao = 'SEM_ESTOQUE';

    resultado.push({
      sku: sku, descricao: item.descricao || item.nome,
      pedido: pedido, estoque: achou ? atual : null,
      reservado: achou ? reservado : null,
      disponivel: achou ? disponivel : null,
      situacao: situacao,
      /* o que o usuário precisa saber, em uma frase */
      aviso: situacao === 'DISPONIVEL' ? null
        : (situacao === 'PARCIAL'
          ? 'Só há ' + disponivel + ' de ' + pedido + ' em estoque. O restante vira pedido de compra.'
          : (situacao === 'SEM_ESTOQUE'
            ? 'Sem estoque. Este item vira pedido de compra.'
            : 'Item não localizado no cadastro.'))
    });
  });

  return {
    itens: resultado,
    resumo: {
      total: resultado.length,
      disponiveis: resultado.filter(function (r) { return r.situacao === 'DISPONIVEL'; }).length,
      parciais: resultado.filter(function (r) { return r.situacao === 'PARCIAL'; }).length,
      semEstoque: resultado.filter(function (r) { return r.situacao === 'SEM_ESTOQUE'; }).length,
      naoEncontrados: resultado.filter(function (r) { return r.situacao === 'NAO_ENCONTRADO'; }).length
    }
  };
}

/* ============================================================
   MÓDULO
   ============================================================ */

function AP_Modulo_loja(acao, payload, sessao) {
  payload = payload || {};

  try {
    switch (acao) {

      case 'compatibilidade':
        return { ok: true, dados: AP_LOJA_compatibilidade(payload.itens) };

      case 'montar':
        return { ok: true, dados: AP_LOJA_montar(payload.itens) };

      case 'disponibilidade':
        return { ok: true, dados: AP_LOJA_disponibilidade(payload.itens, sessao) };

      /** Tudo o que a tela do carrinho precisa, numa chamada só */
      case 'analisarCarrinho': {
        if (!payload.itens || !payload.itens.length) {
          return { ok: false, codigo: 'CARRINHO_VAZIO', mensagem: 'O carrinho está vazio.' };
        }

        var disp = AP_LOJA_disponibilidade(payload.itens, sessao);
        var mont = AP_LOJA_montar(payload.itens);

        return {
          ok: true,
          dados: {
            disponibilidade: disp,
            montagem3d: mont.ok ? mont : null,
            /* o 3D nunca impede o pedido */
            podeEnviar: true,
            avisoMontagem: mont.ok ? null : mont.mensagem,
            compatibilidade: mont.compatibilidade
          }
        };
      }

      case 'versao':
        return {
          ok: true,
          dados: {
            motor: 'AP_LOJA_ENGINE', versao: AP_LOJA_CFG.versao,
            pecasConhecidas: Object.keys(AP_LOJA_CFG.pecas).length
          }
        };

      default:
        return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'loja.' + acao + ' não existe.' };
    }
  } catch (e) {
    AP_ErrorHandler_capture('AP_Modulo_loja:' + acao, e);
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'loja', acao: acao, mensagem: e.message };
  }
}

/* ============================================================
   TESTE
   ============================================================ */
function testeMotorLoja() {
  var log = [];
  function reg(t, ok, d) { log.push((ok ? 'OK    ' : 'ERRO  ') + t + (d ? ' — ' + d : '')); }

  try {
    /* ---------- O EXEMPLO DO DOCUMENTO ---------- */
    var carrinho = [
      { sku: 'S1', descricao: 'JOELHO GALVANIZADO 90° 2"', qtd: 4 },
      { sku: 'S2', descricao: 'TE GALVANIZADO 2"', qtd: 1 },
      { sku: 'S3', descricao: 'CRUZETA GALVANIZADA 2"', qtd: 1 },
      { sku: 'S4', descricao: 'LUVA GALVANIZADA 2"', qtd: 2 },
      { sku: 'S5', descricao: 'UNIAO GALVANIZADA 2"', qtd: 1 },
      { sku: 'S6', descricao: 'NIPLE GALVANIZADO 2"', qtd: 1 }
    ];

    var c = AP_LOJA_compatibilidade(carrinho);
    reg('conjunto da mesma bitola é compatível', c.resultado === 'COMPATIVEL',
      c.resultado + ' · ' + c.mensagem);
    reg('identifica todas as peças', c.resumo.reconhecidas === 6, c.resumo.reconhecidas + ' de 6');
    reg('identifica a bitola principal', c.resumo.bitolaPrincipal === '2"', c.resumo.bitolaPrincipal);

    var m = AP_LOJA_montar(carrinho);
    reg('monta o conjunto', m.ok, m.ok ? m.montagem.length + ' peças posicionadas' : m.mensagem);
    reg('a quantidade vira peças no desenho',
      m.ok && m.montagem.filter(function (p) { return p.tipo === 'JOELHO'; }).length === 4,
      '4 joelhos = 4 peças');
    reg('cada peça sabe a anterior e a próxima',
      m.ok && m.montagem[0].proxima === 2 && m.montagem[1].anterior === 1, '');

    /* ---------- BITOLAS DIFERENTES ---------- */
    var misturado = [
      { sku: 'A', descricao: 'JOELHO GALVANIZADO 90° 2"', qtd: 1 },
      { sku: 'B', descricao: 'TUBO GALVANIZADO 3"', qtd: 1 }
    ];
    var cm = AP_LOJA_compatibilidade(misturado);
    reg('bitolas diferentes sem redução: INCOMPATÍVEL', cm.resultado === 'INCOMPATIVEL',
      cm.conflitos[0].texto.slice(0, 60));

    var mm = AP_LOJA_montar(misturado);
    reg('e a montagem 3D não acontece', mm.ok === false, mm.motivo);
    reg('mas a mensagem explica o porquê',
      mm.mensagem.indexOf('redução') > -1 || mm.mensagem.indexOf('encaixam') > -1, '');

    /* com redução, a diferença passa a fazer sentido */
    var comReducao = misturado.concat([
      { sku: 'C', descricao: 'REDUCAO GALVANIZADA 3" X 2"', qtd: 1 }
    ]);
    var cr = AP_LOJA_compatibilidade(comReducao);
    reg('com peça de redução, deixa de ser incompatível',
      cr.resultado !== 'INCOMPATIVEL', cr.resultado);

    /* ---------- MATERIAIS DIFERENTES ---------- */
    var materiais = [
      { sku: 'A', descricao: 'JOELHO GALVANIZADO 90° 2"', qtd: 1 },
      { sku: 'B', descricao: 'TUBO PVC 2"', qtd: 1 }
    ];
    var cmat = AP_LOJA_compatibilidade(materiais);
    reg('galvanizado com PVC é sinalizado', cmat.resultado === 'INCOMPATIVEL',
      cmat.conflitos[0].texto.slice(0, 55));

    /* ---------- ITENS QUE NÃO SÃO CONEXÃO ---------- */
    var naoConexao = [
      { sku: 'A', descricao: 'CIMENTO CP-II 50KG', qtd: 10 },
      { sku: 'B', descricao: 'AREIA MEDIA', qtd: 5 }
    ];
    var cn = AP_LOJA_compatibilidade(naoConexao);
    reg('material comum: compatibilidade não identificada',
      cn.resultado === 'NAO_IDENTIFICADO', cn.mensagem.slice(0, 50));

    var mn = AP_LOJA_montar(naoConexao);
    reg('sem montagem 3D, mas SEM travar nada', mn.ok === false, mn.mensagem.slice(0, 55));

    /* ---------- A REGRA MAIS IMPORTANTE ---------- */
    var analise = AP_Modulo_loja('analisarCarrinho', { itens: naoConexao }, { usuario: 'teste' });
    reg('O 3D NUNCA IMPEDE A SOLICITAÇÃO',
      analise.ok && analise.dados.podeEnviar === true,
      'podeEnviar continua verdadeiro sem montagem');

    var analise2 = AP_Modulo_loja('analisarCarrinho', { itens: misturado }, { usuario: 'teste' });
    reg('nem quando os itens são incompatíveis',
      analise2.ok && analise2.dados.podeEnviar === true, analise2.dados.avisoMontagem.slice(0, 45));

    /* ---------- UM ITEM SÓ ---------- */
    var umSo = AP_LOJA_compatibilidade([{ sku: 'A', descricao: 'JOELHO GALVANIZADO 90° 2"', qtd: 1 }]);
    reg('um item só não forma conjunto', umSo.resultado === 'NAO_IDENTIFICADO',
      umSo.mensagem.slice(0, 45));

    /* ---------- SEM BITOLA NA DESCRIÇÃO ---------- */
    var semBitola = [
      { sku: 'A', descricao: 'JOELHO GALVANIZADO', qtd: 1 },
      { sku: 'B', descricao: 'LUVA GALVANIZADA 2"', qtd: 1 }
    ];
    var csb = AP_LOJA_compatibilidade(semBitola);
    reg('item sem bitola vira parcialmente compatível',
      csb.resultado === 'PARCIALMENTE_COMPATIVEL', csb.resultado);
    reg('e o motor DIZ qual item faltou informação',
      csb.observacoes.some(function (o) { return o.texto.indexOf('sem bitola') > -1; }),
      'não esconde a limitação');

    /* ---------- CARRINHO VAZIO ---------- */
    var vazio = AP_Modulo_loja('analisarCarrinho', { itens: [] }, {});
    reg('carrinho vazio avisa', vazio.ok === false && vazio.codigo === 'CARRINHO_VAZIO', '');

    /* ---------- DISPONIBILIDADE ---------- */
    AP_Modulo_categorias('salvar', { nome: 'Hidráulica' });
    var it = AP_Modulo_itens('salvar', {
      descricao: 'JOELHO GALVANIZADO 90 GRAUS 2 POLEGADAS TESTE LOJA',
      categoria: 'Hidráulica', unidade: 'un', valorUnitario: 12, confirmadoNovo: true
    });
    if (!it.ok) {
      log.push('ERRO  não foi possível criar o item de teste — ' + it.codigo + ' ' + it.mensagem);
    }
    AP_Modulo_estoque('entrada', { sku: it.dados.sku, qtd: 10, documento: 'TESTE' });

    var d1 = AP_LOJA_disponibilidade([{ sku: it.dados.sku, descricao: 'JOELHO', qtd: 4 }], { usuario: 't' });
    reg('mostra disponível quando há estoque',
      d1.itens[0].situacao === 'DISPONIVEL', d1.itens[0].disponivel + ' em estoque');

    var d2 = AP_LOJA_disponibilidade([{ sku: it.dados.sku, descricao: 'JOELHO', qtd: 50 }], { usuario: 't' });
    reg('avisa quando o estoque não cobre',
      d2.itens[0].situacao === 'PARCIAL', d2.itens[0].aviso);

    var d3 = AP_LOJA_disponibilidade([{ sku: 'NAO-EXISTE', descricao: 'X', qtd: 1 }], { usuario: 't' });
    reg('item inexistente é sinalizado', d3.itens[0].situacao === 'NAO_ENCONTRADO', '');
    reg('e o estoque fica nulo, não zero inventado', d3.itens[0].estoque === null, '');

  } catch (e) {
    log.push('ERRO  exceção: ' + e.message);
  }

  try { Logger.log(log.join('\n')); } catch (e) { }
  return log;
}
