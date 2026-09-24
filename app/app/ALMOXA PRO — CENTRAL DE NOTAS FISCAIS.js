/* ============================================================
   ALMOXA PRO — CENTRAL DE NOTAS FISCAIS
   ------------------------------------------------------------
   Três coisas que faltavam entre a nota e o resto do sistema:

   1. PENDÊNCIAS
      Uma nota entra mesmo incompleta — material chegando não
      espera cadastro. O que falta fica registrado como pendência
      nomeada, em vez de sumir: fornecedor sem cadastro, item sem
      SKU, valor não lido, chave ausente.

   2. PATRIMÔNIO PRELIMINAR
      Quando a nota traz um equipamento (um baú, uma furadeira),
      o patrimônio já nasce ali, com o que a nota sabe — nome,
      categoria, fornecedor, nota, data, valor. O resto fica como
      pendência para quem for etiquetar completar depois.

      Material de consumo não vira patrimônio. A separação é por
      categoria e por como o item se comporta: o que se gasta
      (cimento, cabo por metro) fica fora.

   3. PENTE-FINO DO HISTÓRICO
      Entradas antigas foram lançadas direto no estoque, sem nota.
      Elas continuam lá, soltas. O pente-fino varre as
      movimentações, junta o que pertence à mesma compra e propõe
      notas de histórico — sem duplicar o que já existe.

      NADA é gravado na varredura. Ela só propõe; gravar é uma
      ação separada, depois de você olhar a proposta.

   INSTALAÇÃO
   ----------
   Cole como um novo arquivo .gs no projeto do Core.
   Se o almoxaApi despacha por um mapa de módulos, acrescente
   'nfhub': AP_Modulo_nfhub.

   Rode AP_NFHUB_testes() para conferir a lógica sem tocar em dado.
   ============================================================ */

var AP_NFHUB_CFG = {
  versao: '1.0.0',

  abas: {
    notas: 'ALMOXA_NOTAS',
    nfItens: 'ALMOXA_NF_ITENS',
    movimentacoes: 'ALMOXA_MOVIMENTACOES',
    patrimonio: 'ALMOXA_PATRIMONIO'
  },

  /* uma nota de histórico não se confunde com uma nota real:
     o prefixo diz de onde ela veio */
  prefixoHistorico: 'HIST',

  /* entradas do mesmo fornecedor dentro desta janela são tratadas
     como a mesma compra quando não há documento que as ligue */
  janelaAgrupamentoHoras: 24,

  /* o que vira patrimônio */
  patrimonio: {
    categorias: ['FERRAMENTA', 'FERRAMENTAS', 'EQUIPAMENTO', 'EQUIPAMENTOS',
      'MAQUINA', 'MÁQUINA', 'MAQUINAS', 'MÁQUINAS', 'MOBILIARIO', 'MOBILIÁRIO',
      'INFORMATICA', 'INFORMÁTICA', 'VEICULO', 'VEÍCULO', 'ELETRODOMESTICO',
      'ELETRODOMÉSTICO', 'PATRIMONIO', 'PATRIMÔNIO'],

    /* palavras que denunciam equipamento na própria descrição */
    palavras: ['FURADEIRA', 'PARAFUSADEIRA', 'SERRA', 'LIXADEIRA', 'ESMERILHADEIRA',
      'MARTELETE', 'BETONEIRA', 'COMPRESSOR', 'GERADOR', 'ANDAIME', 'ESCADA',
      'BAU', 'BAÚ', 'ARMARIO', 'ARMÁRIO', 'BANCADA', 'CARRINHO', 'CARRETA',
      'NOTEBOOK', 'COMPUTADOR', 'IMPRESSORA', 'MONITOR', 'NOBREAK', 'BALANCA',
      'BALANÇA', 'TRENA', 'NIVEL', 'NÍVEL', 'MAQUINA', 'MÁQUINA', 'MOTOR',
      'BOMBA', 'ROCADEIRA', 'ROÇADEIRA', 'SOLDA', 'TALHA', 'MACACO'],

    /* unidades de coisa contável — o que se mede não é patrimônio */
    unidadesContaveis: ['UN', 'UND', 'PC', 'PÇ', 'CJ', 'JG', 'KIT', 'PAR'],

    /* acima disto, mesmo sem categoria, vale perguntar */
    valorMinimo: 250,

    /* nota com muitas unidades do mesmo item é compra de consumo,
       não um bem a etiquetar um a um */
    quantidadeMaxima: 20
  }
};


/* ============================================================
   ENTRADA DO MÓDULO
   ============================================================ */

function AP_Modulo_nfhub(acao, payload, sessao) {
  payload = payload || {};
  try {
    switch (acao) {

      case 'pendencias':
        return { ok: true, dados: AP_NFHUB_pendencias_(payload) };

      case 'historico':
        return { ok: true, dados: AP_NFHUB_historico_(payload) };

      /* varre e PROPÕE. Não grava nada. */
      case 'penteFino':
        return { ok: true, dados: AP_NFHUB_penteFino_(payload) };

      /* grava as propostas que você aprovou */
      case 'consolidar':
        return AP_NFHUB_consolidar_(payload, sessao);

      /* o que da nota merece virar patrimônio */
      case 'candidatosPatrimonio':
        return AP_NFHUB_candidatosPatrimonio_(payload);

      /* cria os registros preliminares */
      case 'criarPatrimonioPreliminar':
        return AP_NFHUB_criarPatrimonioPreliminar_(payload, sessao);

      case 'resumo':
        return { ok: true, dados: AP_NFHUB_resumo_() };
    }
    return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'nfhub.' + acao + ' não existe.' };
  } catch (e) {
    try { console.error('[NFHUB] ' + acao + ': ' + e.message); } catch (x) { }
    return { ok: false, codigo: 'NFHUB_ERRO', mensagem: e.message };
  }
}


/* ============================================================
   LEITURA — tudo passa por aqui, e tudo é defensivo
   ============================================================ */

function AP_NFHUB_linhas_(aba) {
  try {
    var r = AP_Data_rows(aba);
    return Array.isArray(r) ? r : [];
  } catch (e) {
    return [];
  }
}

function AP_NFHUB_notas_() {
  return AP_NFHUB_linhas_(AP_NFHUB_CFG.abas.notas);
}

function AP_NFHUB_movimentacoes_() {
  return AP_NFHUB_linhas_(AP_NFHUB_CFG.abas.movimentacoes);
}

/** Os itens de uma nota, venham da coluna JSON ou da aba própria */
function AP_NFHUB_itensDaNota_(nota) {
  var daAba = AP_NFHUB_linhas_(AP_NFHUB_CFG.abas.nfItens).filter(function (l) {
    return String(l.nf) === String(nota.numero);
  });
  if (daAba.length) return daAba.map(AP_NFHUB_normalizarItem_);

  var bruto = nota.listaItens;
  if (!bruto && typeof nota.itens === 'string' && nota.itens.indexOf('[') === 0) {
    try { bruto = JSON.parse(nota.itens); } catch (e) { bruto = []; }
  }
  if (!bruto && Array.isArray(nota.itens)) bruto = nota.itens;
  return (Array.isArray(bruto) ? bruto : []).map(AP_NFHUB_normalizarItem_);
}

function AP_NFHUB_normalizarItem_(i) {
  i = i || {};
  var qtd = Number(i.qtd !== undefined ? i.qtd : i.quantidade) || 0;
  var vu = Number(i.valorUnitario !== undefined ? i.valorUnitario : i.valor) || 0;
  return {
    sku: i.sku || '',
    codigo: i.codigo || '',
    descricao: i.descricao || i.nome || '',
    categoria: i.categoria || '',
    unidade: String(i.unidade || 'un').toUpperCase(),
    ncm: i.ncm || '',
    qtd: qtd,
    valorUnitario: vu,
    valorTotal: Number(i.valorTotal) || Math.round(qtd * vu * 100) / 100
  };
}

function AP_NFHUB_numero_(v) {
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  if (v === null || v === undefined || v === '') return 0;
  var t = String(v).replace(/[^\d,\.\-]/g, '');
  if (t.indexOf(',') > -1) t = t.replace(/\./g, '').replace(',', '.');
  var n = Number(t);
  return isNaN(n) ? 0 : n;
}

function AP_NFHUB_soDigitos_(v) {
  return String(v === null || v === undefined ? '' : v).replace(/\D/g, '');
}

function AP_NFHUB_dia_(v) {
  if (!v) return '';
  var d = (v instanceof Date) ? v : new Date(v);
  if (isNaN(d.getTime())) {
    var m = String(v).match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (!m) return String(v).slice(0, 10);
    var ano = m[3].length === 2 ? '20' + m[3] : m[3];
    return ano + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  }
  return d.toISOString().slice(0, 10);
}

function AP_NFHUB_quando_(v) {
  var d = (v instanceof Date) ? v : new Date(v);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}


/* ============================================================
   1. PENDÊNCIAS — o que falta em cada nota, com nome
   ------------------------------------------------------------
   A nota entra incompleta de propósito: material chegando não
   espera cadastro pronto. Mas o que falta precisa ficar visível,
   senão vira buraco silencioso no acervo.
   ============================================================ */

function AP_NFHUB_pendencias_(filtro) {
  filtro = filtro || {};
  var notas = AP_NFHUB_notas_();
  var fornecedoresPorCnpj = AP_NFHUB_indiceFornecedores_();
  var saida = [];

  notas.forEach(function (nota) {
    var itens = AP_NFHUB_itensDaNota_(nota);
    var faltas = [];

    if (!String(nota.fornecedor || '').trim()) {
      faltas.push({ campo: 'fornecedor', gravidade: 'ALTA', texto: 'A nota não tem fornecedor.' });
    } else if (!AP_NFHUB_soDigitos_(nota.cnpj)) {
      faltas.push({
        campo: 'cnpj', gravidade: 'MEDIA',
        texto: 'Fornecedor sem CNPJ: não dá para ligar ao cadastro.'
      });
    } else if (!fornecedoresPorCnpj[AP_NFHUB_soDigitos_(nota.cnpj)]) {
      faltas.push({
        campo: 'fornecedorCadastro', gravidade: 'ALTA',
        texto: 'O fornecedor ' + nota.fornecedor + ' não está no cadastro.',
        acao: 'cadastrarFornecedor',
        dados: { razaoSocial: nota.fornecedor, cnpj: nota.cnpj }
      });
    }

    if (!AP_NFHUB_numero_(nota.valor)) {
      var soma = itens.reduce(function (s, i) { return s + i.valorTotal; }, 0);
      faltas.push({
        campo: 'valor', gravidade: soma ? 'BAIXA' : 'MEDIA',
        texto: soma
          ? 'Valor total não lido. A soma dos itens dá ' + AP_NFHUB_moeda_(soma) + '.'
          : 'Valor total não lido e sem itens para somar.',
        acao: soma ? 'usarSomaDosItens' : null,
        dados: { sugerido: Math.round(soma * 100) / 100 }
      });
    }

    if (AP_NFHUB_soDigitos_(nota.chave).length !== 44) {
      faltas.push({
        campo: 'chave', gravidade: 'BAIXA',
        texto: 'Sem chave de acesso válida — a nota não pode ser conferida no portal.'
      });
    }

    if (!itens.length) {
      faltas.push({
        campo: 'itens', gravidade: 'ALTA',
        texto: 'A nota não tem nenhum item. Nada entrou no estoque por ela.'
      });
    } else {
      var semSku = itens.filter(function (i) { return !i.sku; });
      if (semSku.length) {
        faltas.push({
          campo: 'itensSemCadastro', gravidade: 'ALTA',
          texto: semSku.length + ' item(ns) sem vínculo com o Cadastro Central: ' +
            semSku.slice(0, 3).map(function (i) { return i.descricao; }).join(', ') +
            (semSku.length > 3 ? '…' : ''),
          acao: 'vincularItens',
          dados: { quantos: semSku.length }
        });
      }
      var semValor = itens.filter(function (i) { return !i.valorUnitario; });
      if (semValor.length) {
        faltas.push({
          campo: 'itensSemValor', gravidade: 'MEDIA',
          texto: semValor.length + ' item(ns) sem valor unitário — o custo do estoque fica furado.'
        });
      }
    }

    if (!faltas.length) return;
    if (filtro.gravidade && !faltas.some(function (f) { return f.gravidade === filtro.gravidade; })) return;

    saida.push({
      numero: nota.numero,
      fornecedor: nota.fornecedor || '(sem fornecedor)',
      cnpj: nota.cnpj || '',
      emissao: nota.emissao || '',
      entrada: nota.entrada || '',
      status: nota.status || '',
      origem: nota.origem || '',
      itens: itens.length,
      valor: AP_NFHUB_numero_(nota.valor),
      faltas: faltas,
      grave: faltas.some(function (f) { return f.gravidade === 'ALTA'; })
    });
  });

  saida.sort(function (a, b) {
    if (a.grave !== b.grave) return a.grave ? -1 : 1;
    return AP_NFHUB_quando_(b.entrada) - AP_NFHUB_quando_(a.entrada);
  });

  return {
    notas: saida,
    total: saida.length,
    graves: saida.filter(function (n) { return n.grave; }).length
  };
}

function AP_NFHUB_indiceFornecedores_() {
  var indice = {};
  try {
    var r = AP_Modulo_fornecedores('listar', {});
    if (r && r.ok) {
      (r.dados || []).forEach(function (f) {
        var d = AP_NFHUB_soDigitos_(f.cnpj);
        if (d) indice[d] = f;
      });
    }
  } catch (e) { }
  return indice;
}

function AP_NFHUB_moeda_(n) {
  return 'R$ ' + Number(n || 0).toFixed(2).replace('.', ',');
}


/* ============================================================
   2. PATRIMÔNIO PRELIMINAR
   ------------------------------------------------------------
   Nem tudo que entra pela nota é bem patrimoniável. Cimento não
   ganha etiqueta; uma furadeira ganha.

   A decisão nunca é automática de ponta a ponta: o módulo separa
   os candidatos e diz POR QUE cada um foi escolhido. Quem lança
   confirma. Criar patrimônio de ofício encheria o acervo de
   registros que ninguém pediu.
   ============================================================ */

function AP_NFHUB_ehCandidatoPatrimonio_(item) {
  var cfg = AP_NFHUB_CFG.patrimonio;
  var descricao = String(item.descricao || '').toUpperCase();
  var categoria = String(item.categoria || '').toUpperCase();
  var unidade = String(item.unidade || '').toUpperCase();

  /* quantidade grande é compra de consumo, não bem a etiquetar */
  if (item.qtd > cfg.quantidadeMaxima) {
    return { candidato: false, motivo: 'quantidade alta (' + item.qtd + '): parece consumo' };
  }
  if (cfg.unidadesContaveis.indexOf(unidade) === -1) {
    return { candidato: false, motivo: 'unidade "' + unidade + '" é de medida, não de peça' };
  }

  var porCategoria = cfg.categorias.some(function (c) { return categoria.indexOf(c) > -1; });
  if (porCategoria) {
    return { candidato: true, motivo: 'categoria "' + item.categoria + '" é de bem patrimoniável', forca: 'ALTA' };
  }

  var palavra = null;
  cfg.palavras.forEach(function (p) {
    if (!palavra && new RegExp('\\b' + p, 'i').test(descricao)) palavra = p;
  });
  if (palavra) {
    return { candidato: true, motivo: 'a descrição traz "' + palavra + '"', forca: 'ALTA' };
  }

  if (item.valorUnitario >= cfg.valorMinimo) {
    return {
      candidato: true, forca: 'MEDIA',
      motivo: 'valor unitário de ' + AP_NFHUB_moeda_(item.valorUnitario) +
        ' — acima de ' + AP_NFHUB_moeda_(cfg.valorMinimo) + ', vale conferir'
    };
  }

  return { candidato: false, motivo: 'sem categoria, palavra ou valor que indique patrimônio' };
}

function AP_NFHUB_candidatosPatrimonio_(payload) {
  var nota = AP_NFHUB_acharNota_(payload.numero);
  if (!nota) {
    return { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Nota ' + payload.numero + ' não localizada.' };
  }

  var itens = AP_NFHUB_itensDaNota_(nota);
  var candidatos = [], descartados = [];

  itens.forEach(function (item) {
    var teste = AP_NFHUB_ehCandidatoPatrimonio_(item);
    var linha = {
      sku: item.sku, descricao: item.descricao, categoria: item.categoria,
      unidade: item.unidade, qtd: item.qtd,
      valorUnitario: item.valorUnitario, motivo: teste.motivo
    };
    if (teste.candidato) {
      linha.forca = teste.forca;
      /* uma unidade = um patrimônio: três furadeiras são três bens */
      linha.quantosRegistros = Math.max(1, Math.round(item.qtd));
      linha.preliminar = AP_NFHUB_montarPreliminar_(item, nota);
      candidatos.push(linha);
    } else {
      descartados.push(linha);
    }
  });

  return {
    ok: true,
    dados: {
      numero: nota.numero,
      fornecedor: nota.fornecedor || '',
      candidatos: candidatos,
      descartados: descartados,
      registrosPropostos: candidatos.reduce(function (s, c) { return s + c.quantosRegistros; }, 0)
    }
  };
}

/**
 * O registro preliminar: o que a nota já sabe fica preenchido,
 * o resto vira lista de pendências nomeadas — não campo vazio
 * silencioso, que ninguém lembra de voltar e completar.
 */
function AP_NFHUB_montarPreliminar_(item, nota) {
  var preenchido = {
    descricao: item.descricao,
    categoria: item.categoria || '',
    fornecedor: nota.fornecedor || '',
    notaFiscal: nota.numero || '',
    dataAquisicao: AP_NFHUB_dia_(nota.emissao || nota.entrada),
    valorAquisicao: item.valorUnitario || 0,
    sku: item.sku || '',
    situacao: 'PRELIMINAR',
    origem: 'Entrada por nota fiscal ' + (nota.numero || ''),
    foto: item.foto || ''
  };

  var pendentes = [];
  if (!preenchido.categoria) pendentes.push('categoria');
  if (!preenchido.foto) pendentes.push('foto');
  if (!preenchido.valorAquisicao) pendentes.push('valor de aquisição');
  pendentes.push('estado de conservação');
  pendentes.push('localização');
  pendentes.push('responsável');
  if (!item.sku) pendentes.push('vínculo com o Cadastro Central');
  pendentes.push('número de série');

  preenchido.camposPendentes = pendentes;
  preenchido.completo = false;
  return preenchido;
}

function AP_NFHUB_criarPatrimonioPreliminar_(payload, sessao) {
  var escolhidos = payload.itens;
  if (!escolhidos || !escolhidos.length) {
    return { ok: false, codigo: 'SEM_ITENS', mensagem: 'Nenhum item escolhido para virar patrimônio.' };
  }

  var nota = AP_NFHUB_acharNota_(payload.numero) || { numero: payload.numero || '' };
  var criados = [], recusados = [];

  escolhidos.forEach(function (escolha) {
    var quantos = Math.max(1, Math.round(Number(escolha.quantosRegistros) || 1));

    for (var n = 0; n < quantos; n++) {
      var dados = AP_NFHUB_montarPreliminar_(AP_NFHUB_normalizarItem_(escolha), nota);
      if (quantos > 1) dados.descricao = dados.descricao + ' (' + (n + 1) + '/' + quantos + ')';

      try {
        var r = AP_Modulo_patrimonio('salvar', dados, sessao);
        if (r && r.ok && r.dados) {
          criados.push({
            patrimonio: r.dados.patrimonio || r.dados.id || '',
            descricao: dados.descricao,
            pendentes: dados.camposPendentes.length
          });
        } else {
          recusados.push({
            descricao: dados.descricao,
            motivo: (r && r.mensagem) || 'o módulo de patrimônio recusou'
          });
        }
      } catch (e) {
        recusados.push({ descricao: dados.descricao, motivo: e.message });
      }
    }
  });

  try {
    if (typeof AP_Audit_log === 'function') {
      AP_Audit_log((sessao && sessao.usuario) || 'sistema', 'PATRIMONIO_PRELIMINAR', 'NF',
        nota.numero, { criados: criados.length, recusados: recusados.length });
    }
  } catch (e) { }

  return {
    ok: criados.length > 0,
    dados: {
      criados: criados, recusados: recusados,
      mensagem: criados.length + ' registro(s) preliminar(es) criados. ' +
        'Complete os dados, gere a etiqueta e finalize no módulo de Patrimônio.'
    },
    mensagem: criados.length ? null : 'Nenhum registro pôde ser criado.'
  };
}

function AP_NFHUB_acharNota_(numero) {
  if (!numero) return null;
  return AP_NFHUB_notas_().filter(function (n) {
    return String(n.numero) === String(numero);
  })[0] || null;
}


/* ============================================================
   3. PENTE-FINO — o histórico que nunca teve nota
   ------------------------------------------------------------
   Entradas antigas foram lançadas direto no estoque. Elas contam
   saldo, mas não contam história: não se sabe de quem veio, por
   quanto, nem com qual documento.

   A varredura junta o que pertence à mesma compra e propõe uma
   nota de histórico para cada grupo. Ela NÃO grava — proposta e
   gravação são passos separados, porque agrupar por semelhança
   erra, e errar gravando é caro.
   ============================================================ */

function AP_NFHUB_penteFino_(filtro) {
  filtro = filtro || {};
  var movimentos = AP_NFHUB_movimentacoes_();
  var notas = AP_NFHUB_notas_();

  /* documentos que já são nota conhecida */
  var jaTemNota = {};
  notas.forEach(function (n) {
    jaTemNota[AP_NFHUB_chaveDocumento_(n.numero)] = true;
  });

  var entradas = movimentos.filter(function (m) {
    return String(m.tipo || '').toUpperCase() === 'ENTRADA';
  });

  var comNota = [], orfas = [];
  entradas.forEach(function (m) {
    var doc = String(m.documento || '').trim();
    var chave = AP_NFHUB_chaveDocumento_(doc);
    if (doc && jaTemNota[chave]) comNota.push(m);
    else orfas.push(m);
  });

  /* agrupa as órfãs: primeiro pelo documento que elas trazem;
     as sem documento nenhum, por fornecedor e dia */
  var grupos = {};
  orfas.forEach(function (m) {
    var doc = String(m.documento || '').trim();
    var chave;

    if (doc) {
      chave = 'DOC:' + AP_NFHUB_chaveDocumento_(doc);
    } else {
      var quem = String(m.fornecedor || m.obra || m.centro || 'sem origem').trim().toUpperCase();
      chave = 'AGRUPADA:' + quem + ':' + AP_NFHUB_dia_(m.data);
    }

    if (!grupos[chave]) {
      grupos[chave] = {
        chave: chave,
        documentoOriginal: doc,
        porDocumento: !!doc,
        fornecedor: m.fornecedor || '',
        obra: m.obra || '',
        data: m.data,
        movimentos: []
      };
    }
    grupos[chave].movimentos.push(m);
    /* a data do grupo é a mais antiga: é quando a compra chegou */
    if (AP_NFHUB_quando_(m.data) < AP_NFHUB_quando_(grupos[chave].data)) {
      grupos[chave].data = m.data;
    }
  });

  var propostas = Object.keys(grupos).map(function (k) {
    var g = grupos[k];
    var itens = g.movimentos.map(function (m) {
      var qtd = Math.abs(AP_NFHUB_numero_(m.qtd));
      var vu = AP_NFHUB_numero_(m.valorUnitario);
      return {
        sku: m.sku || '', descricao: m.descricao || '',
        unidade: 'un', qtd: qtd, valorUnitario: vu,
        valorTotal: Math.round(qtd * vu * 100) / 100,
        movimentoId: m.id || ''
      };
    });

    var valor = Math.round(itens.reduce(function (s, i) { return s + i.valorTotal; }, 0) * 100) / 100;
    var numeroProposto = AP_NFHUB_numeroDeHistorico_(g);

    return {
      chave: g.chave,
      numeroProposto: numeroProposto,
      jaExiste: !!jaTemNota[AP_NFHUB_chaveDocumento_(numeroProposto)],
      documentoOriginal: g.documentoOriginal,
      porDocumento: g.porDocumento,
      fornecedor: g.fornecedor || '(não informado)',
      obra: g.obra || '',
      data: AP_NFHUB_dia_(g.data),
      itens: itens,
      quantosItens: itens.length,
      unidades: itens.reduce(function (s, i) { return s + i.qtd; }, 0),
      valor: valor,
      confianca: g.porDocumento ? 'ALTA' : (g.fornecedor ? 'MEDIA' : 'BAIXA'),
      criterio: g.porDocumento
        ? 'todas as entradas trazem o documento "' + g.documentoOriginal + '"'
        : (g.fornecedor
          ? 'mesmo fornecedor no mesmo dia'
          : 'mesmo dia, sem fornecedor informado — confira antes de gravar')
    };
  });

  propostas.sort(function (a, b) { return AP_NFHUB_quando_(b.data) - AP_NFHUB_quando_(a.data); });

  return {
    entradasExaminadas: entradas.length,
    jaVinculadas: comNota.length,
    semNota: orfas.length,
    propostas: propostas,
    resumo: {
      grupos: propostas.length,
      porDocumento: propostas.filter(function (p) { return p.porDocumento; }).length,
      agrupadas: propostas.filter(function (p) { return !p.porDocumento; }).length,
      jaExistentes: propostas.filter(function (p) { return p.jaExiste; }).length,
      valorTotal: Math.round(propostas.reduce(function (s, p) { return s + p.valor; }, 0) * 100) / 100
    }
  };
}

/** Duas grafias do mesmo documento são o mesmo documento */
function AP_NFHUB_chaveDocumento_(doc) {
  return String(doc || '').toUpperCase()
    .replace(/^NF[\s\-\.:]*/, '')
    .replace(/[^A-Z0-9]/g, '');
}

function AP_NFHUB_numeroDeHistorico_(grupo) {
  if (grupo.porDocumento) {
    var limpo = String(grupo.documentoOriginal).replace(/^NF[\s\-\.:]*/i, '').trim();
    return limpo || (AP_NFHUB_CFG.prefixoHistorico + '-' + AP_NFHUB_dia_(grupo.data));
  }
  var quem = String(grupo.fornecedor || 'SEM-FORN').toUpperCase()
    .replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'SEMFORN';
  return AP_NFHUB_CFG.prefixoHistorico + '-' + AP_NFHUB_dia_(grupo.data).replace(/-/g, '') + '-' + quem;
}


/* ============================================================
   CONSOLIDAR — grava as propostas aprovadas
   ------------------------------------------------------------
   Aqui sim escreve. E o cuidado é um só: não duplicar. Uma nota
   já existente nunca é sobrescrita nem criada de novo — ela é
   pulada, e o motivo aparece no retorno.
   ============================================================ */

function AP_NFHUB_consolidar_(payload, sessao) {
  var propostas = payload.propostas;
  if (!propostas || !propostas.length) {
    return { ok: false, codigo: 'SEM_PROPOSTAS', mensagem: 'Nada foi escolhido para consolidar.' };
  }

  var existentes = {};
  AP_NFHUB_notas_().forEach(function (n) {
    existentes[AP_NFHUB_chaveDocumento_(n.numero)] = n;
  });

  var criadas = [], puladas = [], falhas = [];

  propostas.forEach(function (p) {
    var numero = String(p.numeroProposto || '').trim();
    if (!numero) {
      falhas.push({ chave: p.chave, motivo: 'proposta sem número' });
      return;
    }

    var chave = AP_NFHUB_chaveDocumento_(numero);
    if (existentes[chave]) {
      puladas.push({
        numero: numero,
        motivo: 'já existe uma nota com este número — nada foi alterado nela'
      });
      return;
    }

    var itens = (p.itens || []).map(AP_NFHUB_normalizarItem_);
    var registro = {
      numero: numero,
      serie: '',
      chave: '',
      fornecedor: p.fornecedor && p.fornecedor !== '(não informado)' ? p.fornecedor : '',
      cnpj: p.cnpj || '',
      emissao: p.data || '',
      entrada: p.data || '',
      valor: AP_NFHUB_numero_(p.valor),
      listaItens: itens,
      status: 'HISTORICO',
      origem: p.porDocumento ? 'Histórico (documento)' : 'Histórico (agrupado)'
    };

    try {
      var r = AP_Modulo_nf('salvar', registro, sessao);
      if (r && r.ok) {
        existentes[chave] = registro;   // já conta como existente nesta mesma rodada
        criadas.push({
          numero: numero, itens: itens.length, valor: registro.valor,
          origem: registro.origem
        });
      } else {
        falhas.push({ numero: numero, motivo: (r && r.mensagem) || 'o Core recusou' });
      }
    } catch (e) {
      falhas.push({ numero: numero, motivo: e.message });
    }
  });

  try {
    if (typeof AP_Audit_log === 'function') {
      AP_Audit_log((sessao && sessao.usuario) || 'sistema', 'NF_HISTORICO_CONSOLIDADO', 'NF',
        criadas.length + ' notas', {
        criadas: criadas.length, puladas: puladas.length, falhas: falhas.length
      });
    }
  } catch (e) { }

  return {
    ok: criadas.length > 0 || puladas.length > 0,
    dados: {
      criadas: criadas, puladas: puladas, falhas: falhas,
      mensagem: criadas.length + ' nota(s) de histórico criada(s)' +
        (puladas.length ? ', ' + puladas.length + ' já existia(m)' : '') +
        (falhas.length ? ', ' + falhas.length + ' falhou(aram)' : '') + '.'
    }
  };
}


/* ============================================================
   HISTÓRICO UNIFICADO
   ============================================================ */

function AP_NFHUB_historico_(filtro) {
  filtro = filtro || {};
  var notas = AP_NFHUB_notas_();
  var pendencias = AP_NFHUB_pendencias_({});
  var pendentePorNumero = {};
  pendencias.notas.forEach(function (p) { pendentePorNumero[p.numero] = p; });

  var linhas = notas.map(function (n) {
    var itens = AP_NFHUB_itensDaNota_(n);
    var valor = AP_NFHUB_numero_(n.valor) ||
      Math.round(itens.reduce(function (s, i) { return s + i.valorTotal; }, 0) * 100) / 100;
    var p = pendentePorNumero[n.numero];

    return {
      numero: n.numero,
      fornecedor: n.fornecedor || '',
      cnpj: n.cnpj || '',
      emissao: AP_NFHUB_dia_(n.emissao),
      entrada: AP_NFHUB_dia_(n.entrada),
      origem: n.origem || '',
      status: n.status || '',
      historico: String(n.status || '').toUpperCase() === 'HISTORICO' ||
        String(n.origem || '').indexOf('Histórico') === 0,
      quantosItens: itens.length,
      unidades: itens.reduce(function (s, i) { return s + i.qtd; }, 0),
      valor: valor,
      valorCalculado: !AP_NFHUB_numero_(n.valor) && valor > 0,
      pendencias: p ? p.faltas.length : 0,
      grave: p ? p.grave : false
    };
  });

  if (filtro.fornecedor) {
    var alvo = String(filtro.fornecedor).toUpperCase();
    linhas = linhas.filter(function (l) {
      return String(l.fornecedor).toUpperCase().indexOf(alvo) > -1;
    });
  }
  if (filtro.somentePendentes) {
    linhas = linhas.filter(function (l) { return l.pendencias > 0; });
  }

  linhas.sort(function (a, b) { return AP_NFHUB_quando_(b.entrada) - AP_NFHUB_quando_(a.entrada); });

  /* agrupamento por fornecedor, que é como se lê um histórico */
  var porFornecedor = {};
  linhas.forEach(function (l) {
    var f = l.fornecedor || '(sem fornecedor)';
    if (!porFornecedor[f]) porFornecedor[f] = { fornecedor: f, notas: 0, valor: 0, itens: 0, pendencias: 0 };
    porFornecedor[f].notas++;
    porFornecedor[f].valor = Math.round((porFornecedor[f].valor + l.valor) * 100) / 100;
    porFornecedor[f].itens += l.quantosItens;
    porFornecedor[f].pendencias += l.pendencias;
  });

  return {
    notas: linhas,
    fornecedores: Object.keys(porFornecedor).map(function (k) { return porFornecedor[k]; })
      .sort(function (a, b) { return b.valor - a.valor; }),
    totais: {
      notas: linhas.length,
      historicas: linhas.filter(function (l) { return l.historico; }).length,
      comPendencia: linhas.filter(function (l) { return l.pendencias > 0; }).length,
      valor: Math.round(linhas.reduce(function (s, l) { return s + l.valor; }, 0) * 100) / 100,
      unidades: linhas.reduce(function (s, l) { return s + l.unidades; }, 0)
    }
  };
}

function AP_NFHUB_resumo_() {
  var pend = AP_NFHUB_pendencias_({});
  var pente = AP_NFHUB_penteFino_({});
  var hist = AP_NFHUB_historico_({});

  return {
    versao: AP_NFHUB_CFG.versao,
    notas: hist.totais.notas,
    valorTotal: hist.totais.valor,
    notasComPendencia: pend.total,
    pendenciasGraves: pend.graves,
    entradasSemNota: pente.semNota,
    gruposPropostos: pente.resumo.grupos
  };
}


/* ============================================================
   TESTES — não tocam em dado nenhum
   ============================================================ */

function AP_NFHUB_testes() {
  var log = [], falhas = 0;
  function ok(nome, cond, detalhe) {
    log.push((cond ? 'PASSOU  ' : 'FALHOU  ') + nome + (detalhe ? '  [' + detalhe + ']' : ''));
    if (!cond) falhas++;
  }

  /* --- separação de patrimônio --- */
  [['Furadeira de Impacto 650W', '', 'UN', 1, 320, true, 'palavra na descrição'],
  ['Baú Azul para Ferramentas', '', 'UN', 2, 180, true, 'palavra "BAÚ"'],
  ['Notebook Dell i5', 'Informática', 'UN', 1, 3200, true, 'categoria'],
  ['Cimento CP-II 50kg', 'Materiais', 'SC', 200, 32.5, false, 'unidade de medida'],
  ['Cabo Flexível 2,5mm', 'Elétrica', 'MT', 100, 2.45, false, 'unidade de medida'],
  ['Parafuso Sextavado', 'Fixação', 'UN', 500, 0.8, false, 'quantidade alta'],
  ['Luva Vaqueta', 'EPI', 'PAR', 12, 12.5, false, 'sem indício de patrimônio'],
  ['Bancada de Marcenaria', '', 'UN', 1, 1800, true, 'palavra "BANCADA"'],
  ['Item Caro Sem Nome Claro', '', 'UN', 1, 900, true, 'valor acima do mínimo']
  ].forEach(function (c) {
    var r = AP_NFHUB_ehCandidatoPatrimonio_({
      descricao: c[0], categoria: c[1], unidade: c[2], qtd: c[3], valorUnitario: c[4]
    });
    ok('patrimônio? ' + c[0], r.candidato === c[5], r.motivo);
  });

  /* --- registro preliminar --- */
  var prel = AP_NFHUB_montarPreliminar_(
    { descricao: 'Baú Azul', categoria: '', unidade: 'UN', qtd: 1, valorUnitario: 180, sku: '' },
    { numero: '018.442', fornecedor: 'LOJA AVAN LTDA', emissao: '24/08/2026' });
  ok('preliminar traz o que a nota sabe',
    prel.descricao === 'Baú Azul' && prel.fornecedor === 'LOJA AVAN LTDA' &&
    prel.notaFiscal === '018.442' && prel.dataAquisicao === '2026-08-24',
    prel.dataAquisicao);
  ok('preliminar lista o que falta', prel.camposPendentes.length >= 5,
    prel.camposPendentes.join(', '));
  ok('preliminar nasce marcado como incompleto', prel.completo === false &&
    prel.situacao === 'PRELIMINAR');

  /* --- chave de documento --- */
  ok('NF 018.442 e 018442 são o mesmo documento',
    AP_NFHUB_chaveDocumento_('NF 018.442') === AP_NFHUB_chaveDocumento_('018442'),
    AP_NFHUB_chaveDocumento_('NF 018.442'));
  ok('documentos diferentes não se confundem',
    AP_NFHUB_chaveDocumento_('NF 100') !== AP_NFHUB_chaveDocumento_('NF 200'));

  /* --- números e datas --- */
  ok('1.579,89 vira 1579.89', AP_NFHUB_numero_('1.579,89') === 1579.89);
  ok('número já numérico não é remexido', AP_NFHUB_numero_(1579.89) === 1579.89);
  ok('data brasileira vira ISO', AP_NFHUB_dia_('24/08/2026') === '2026-08-24',
    AP_NFHUB_dia_('24/08/2026'));

  /* --- pente-fino com dados de mentira --- */
  var original = AP_NFHUB_movimentacoes_;
  var originalNotas = AP_NFHUB_notas_;
  try {
    AP_NFHUB_movimentacoes_ = function () { return AP_NFHUB_movimentosDeTeste_(); };
    AP_NFHUB_notas_ = function () { return [{ numero: '018.442' }]; };

    var pente = AP_NFHUB_penteFino_({});
    ok('entradas com nota conhecida ficam de fora', pente.jaVinculadas === 2,
      pente.jaVinculadas + ' vinculada(s)');
    ok('as órfãs foram achadas', pente.semNota === 5, pente.semNota + ' órfã(s)');
    ok('agrupou em 3 propostas', pente.propostas.length === 3,
      pente.propostas.map(function (p) { return p.numeroProposto; }).join(', '));

    var porDoc = pente.propostas.filter(function (p) { return p.porDocumento; })[0];
    ok('grupo por documento tem confiança ALTA', porDoc && porDoc.confianca === 'ALTA',
      porDoc ? porDoc.criterio : '—');
    ok('grupo por documento juntou os 2 itens', porDoc && porDoc.quantosItens === 2,
      porDoc ? porDoc.quantosItens + ' itens' : '—');
    ok('valor do grupo é a soma dos itens', porDoc && porDoc.valor === 350,
      porDoc ? porDoc.valor : '—');

    var semForn = pente.propostas.filter(function (p) { return p.confianca === 'BAIXA'; })[0];
    ok('sem fornecedor a confiança cai', !!semForn, semForn ? semForn.criterio : 'nenhuma');

    ok('nenhuma proposta colide com nota existente',
      pente.propostas.every(function (p) { return !p.jaExiste; }));
  } finally {
    AP_NFHUB_movimentacoes_ = original;
    AP_NFHUB_notas_ = originalNotas;
  }

  log.push('');
  log.push(falhas ? falhas + ' teste(s) FALHARAM' : 'todos os testes passaram');
  log.push('');
  log.push('Estes testes cobrem a lógica: separação de patrimônio, registro');
  log.push('preliminar, identidade de documento e agrupamento do pente-fino.');
  log.push('Nada foi lido nem gravado na planilha.');

  try { Logger.log(log.join('\n')); } catch (e) { }
  return log;
}

function AP_NFHUB_movimentosDeTeste_() {
  return [
    /* duas com nota já conhecida — devem ficar de fora */
    { id: 'M1', tipo: 'ENTRADA', data: '2026-08-24T10:00:00Z', documento: 'NF 018.442', sku: 'A', descricao: 'Cimento', qtd: 50, valorUnitario: 32.5 },
    { id: 'M2', tipo: 'ENTRADA', data: '2026-08-24T10:00:00Z', documento: 'NF 018.442', sku: 'B', descricao: 'Areia', qtd: 10, valorUnitario: 95 },

    /* duas com o mesmo documento desconhecido — um grupo */
    { id: 'M3', tipo: 'ENTRADA', data: '2026-07-10T09:00:00Z', documento: 'NF 007.115', fornecedor: 'FERRAGENS SUL', sku: 'C', descricao: 'Martelo', qtd: 2, valorUnitario: 40 },
    { id: 'M4', tipo: 'ENTRADA', data: '2026-07-10T09:05:00Z', documento: 'NF 007.115', fornecedor: 'FERRAGENS SUL', sku: 'D', descricao: 'Serrote', qtd: 3, valorUnitario: 90 },

    /* duas sem documento, mesmo fornecedor e dia — outro grupo */
    { id: 'M5', tipo: 'ENTRADA', data: '2026-06-02T08:00:00Z', documento: '', fornecedor: 'CASA DO EPI', sku: 'E', descricao: 'Capacete', qtd: 10, valorUnitario: 28 },
    { id: 'M6', tipo: 'ENTRADA', data: '2026-06-02T16:00:00Z', documento: '', fornecedor: 'CASA DO EPI', sku: 'F', descricao: 'Luva', qtd: 20, valorUnitario: 12 },

    /* uma sem documento e sem fornecedor — grupo de confiança baixa */
    { id: 'M7', tipo: 'ENTRADA', data: '2026-05-15T11:00:00Z', documento: '', sku: 'G', descricao: 'Item antigo', qtd: 5, valorUnitario: 10 },

    /* saídas não entram na conta */
    { id: 'M8', tipo: 'SAIDA', data: '2026-06-03T08:00:00Z', documento: '', sku: 'E', descricao: 'Capacete', qtd: -2, valorUnitario: 28 }
  ];
}
