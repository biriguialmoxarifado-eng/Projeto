/**
 * ALMOXA PRO — Notas Fiscais: persistência e histórico
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * O diagnóstico da planilha mostrou 10 linhas em ALMOXA_NF_ITENS e
 * apenas 1 linha em ALMOXA_NOTAS. Ou seja: os ITENS estavam sendo
 * gravados, mas o CABEÇALHO da nota não chegava à aba de notas — e é
 * dela que o histórico é lido. Por isso a nota sumia da listagem.
 *
 * O QUE ESTE MÓDULO FAZ
 *  1. Usa as DUAS abas que já existem. Não cria base nova.
 *  2. Grava cabeçalho e itens na mesma operação, ou não grava nada.
 *  3. Lista TODAS as notas, de qualquer origem e qualquer status.
 *  4. Recupera as notas órfãs: onde existem itens sem cabeçalho, o
 *     cabeçalho é reconstruído a partir dos próprios itens gravados.
 *     Nada é inventado — tudo vem do que já está na planilha.
 *  5. Editar atualiza o MESMO registro. Itens são comparados um a um:
 *     alterado atualiza, novo entra, removido sai. Nunca duplica.
 *
 * INSTALAÇÃO
 *  1. Cole num arquivo novo do Apps Script.
 *  2. Rode AP_NF_diagnostico e leia o registro.
 *  3. Rode AP_NF_recuperarOrfas para trazer de volta o histórico.
 *  4. Publique nova versão.
 *
 * A tela conversa com este módulo por AP_NF_direto, sem passar pelo
 * roteador — nenhum arquivo existente precisa ser alterado.
 */

var AP_NF_ABAS = { notas: 'ALMOXA_NOTAS', itens: 'ALMOXA_NF_ITENS' };

/* Colunas que precisam existir. As que já existem não são tocadas;
   idNF é acrescentada no fim para dar vínculo forte entre nota e item. */
var AP_NF_COL_NOTA = ['numero', 'serie', 'chave', 'fornecedor', 'cnpj', 'emissao',
  'entrada', 'valor', 'itens', 'status', 'origem', 'arquivoId',
  'lancadoPor', 'lancadoEm', 'idNF', 'atualizadoEm', 'observacao'];

var AP_NF_COL_ITEM = ['id', 'nf', 'serie', 'sku', 'codigo', 'descricao', 'ncm',
  'unidade', 'quantidade', 'valorUnitario', 'valorTotal', 'fornecedor', 'cnpj',
  'obra', 'lote', 'validade', 'emissao', 'entrada', 'status',
  'lancadoEm', 'lancadoPor', 'observacao', 'idNF', 'tamanho', 'idProduto'];

/* ============================================================
   IDENTIDADE DA NOTA
   A chave de acesso manda. Sem chave, número + série + CNPJ.
   Nunca só o nome do fornecedor.
   ============================================================ */
function AP_NF_id(n) {
  n = n || {};
  var chave = AP_NF_so_(n.chave);
  if (chave.length >= 20) return 'NFE:' + chave;
  var numero = AP_NF_so_(n.numero || n.nf);
  var serie = AP_NF_so_(n.serie) || '0';
  var cnpj = AP_NF_so_(n.cnpj);
  if (!numero) return '';
  return 'NF:' + numero + '-' + serie + (cnpj ? '-' + cnpj : '');
}

function AP_NF_so_(v) {
  return String(v === undefined || v === null ? '' : v).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

/* ============================================================
   PORTA ÚNICA PARA A TELA
   ============================================================ */
function AP_NF_direto(json) {
  var p = {};
  try { p = JSON.parse(json || '{}'); } catch (e) { p = {}; }

  var sessao = null;
  if (p.token) {
    var v = AP_Session_validate(String(p.token));
    if (v && v.ok) sessao = v.data;
  }

  var r;
  try {
    switch (p.acao) {
      case 'listar':    r = AP_NF_listar(p.payload || {}); break;
      case 'obter':     r = AP_NF_obter(p.payload || {}); break;
      case 'itens':     r = AP_NF_itens(p.payload || {}); break;
      case 'salvar':
        if (!sessao) { r = { ok: false, codigo: 'SEM_SESSAO', mensagem: 'Faça login de novo para lançar notas.' }; break; }
        r = AP_NF_salvar(p.payload || {}, sessao); break;
      case 'excluir':
        if (!sessao) { r = { ok: false, codigo: 'SEM_SESSAO', mensagem: 'Faça login de novo.' }; break; }
        r = AP_NF_excluir(p.payload || {}, sessao); break;
      case 'diagnostico': r = AP_NF_diagnostico_(); break;
      case 'recuperar':   r = AP_NF_recuperarOrfas_(); break;
      default: r = { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'nf.' + p.acao + ' não existe.' };
    }
  } catch (e) {
    r = { ok: false, codigo: 'MODULO_ERRO', mensagem: e.message };
  }
  return JSON.stringify(r);
}

/* ============================================================
   LISTAR — todas as notas, de toda origem, de todo status
   ============================================================ */
function AP_NF_listar(filtro) {
  filtro = filtro || {};
  var cabecalhos = AP_NF_linhas_(AP_NF_ABAS.notas);
  var itens = AP_NF_linhas_(AP_NF_ABAS.itens);

  /* agrupa os itens pela identidade da nota */
  var porNota = {};
  itens.forEach(function (i) {
    var id = String(i.idNF || '') || AP_NF_id({ numero: i.nf, serie: i.serie, cnpj: i.cnpj });
    if (!id) return;
    (porNota[id] = porNota[id] || []).push(AP_NF_itemPublico_(i));
  });

  var vistas = {};
  var lista = cabecalhos.map(function (n) {
    var id = String(n.idNF || '') || AP_NF_id(n);
    vistas[id] = true;
    return AP_NF_montar_(n, porNota[id] || [], id, false);
  });

  /* itens gravados sem cabeçalho: a nota existe, só não foi listada.
     O cabeçalho é reconstruído a partir dos próprios itens. */
  Object.keys(porNota).forEach(function (id) {
    if (vistas[id]) return;
    lista.push(AP_NF_montar_(AP_NF_cabecalhoDosItens_(porNota[id]), porNota[id], id, true));
  });

  var busca = String(filtro.busca || '').trim().toLowerCase();
  if (busca) {
    lista = lista.filter(function (n) {
      var alvo = [n.numero, n.serie, n.chave, n.fornecedor, n.cnpj, n.origem, n.status]
        .concat((n.itens || []).map(function (i) {
          return [i.descricao, i.sku, i.codigo, i.tamanho].join(' ');
        })).join(' ').toLowerCase();
      return alvo.indexOf(busca) > -1;
    });
  }

  lista.sort(function (a, b) {
    return String(b.entrada || b.emissao || '').localeCompare(String(a.entrada || a.emissao || ''));
  });

  return { ok: true, dados: lista };
}

/** Monta a nota no formato que a tela espera. */
function AP_NF_montar_(n, itens, id, reconstruida) {
  n = n || {};
  var soma = Math.round(itens.reduce(function (s, i) {
    return s + (Number(i.valorTotal) || (Number(i.quantidade) || 0) * (Number(i.valorUnitario) || 0));
  }, 0) * 100) / 100;

  var gravado = Number(n.valor) || 0;

  return {
    id: id,
    idNF: id,
    numero: String(n.numero || n.nf || ''),
    serie: String(n.serie || ''),
    chave: String(n.chave || ''),
    fornecedor: n.fornecedor || '',
    cnpj: n.cnpj || '',
    origem: String(n.origem || 'MANUAL').toUpperCase(),
    emissao: n.emissao || '',
    entrada: n.entrada || '',
    /* valor gravado manda; sem ele, a soma dos itens */
    valor: gravado > 0 ? gravado : soma,
    valorItens: soma,
    status: n.status || 'EM_CONFERENCIA',
    lancadoPor: n.lancadoPor || '',
    lancadoEm: n.lancadoEm || '',
    arquivoId: n.arquivoId || '',
    observacao: n.observacao || '',
    itens: itens,
    listaItens: itens,
    qtdItens: itens.length,
    reconstruida: !!reconstruida
  };
}

/** Deduz o cabeçalho a partir dos itens — só com o que está gravado. */
function AP_NF_cabecalhoDosItens_(itens) {
  var base = itens[0] || {};
  return {
    numero: base.nf || base.numero || '',
    serie: base.serie || '',
    chave: '',
    fornecedor: base.fornecedor || '',
    cnpj: base.cnpj || '',
    emissao: base.emissao || '',
    entrada: base.entrada || base.lancadoEm || '',
    valor: 0,
    status: base.status || 'EM_CONFERENCIA',
    origem: base.origem || 'MANUAL',
    lancadoPor: base.lancadoPor || '',
    lancadoEm: base.lancadoEm || ''
  };
}

function AP_NF_itemPublico_(i) {
  var qtd = Number(i.quantidade) || 0;
  var vu = Number(i.valorUnitario) || 0;
  var vt = Number(i.valorTotal);
  return {
    id: i.id || '',
    idNF: i.idNF || '',
    nf: i.nf || '',
    serie: i.serie || '',
    sku: i.sku || '',
    idProduto: i.idProduto || i.sku || '',
    codigo: i.codigo || '',
    descricao: i.descricao || '',
    tamanho: i.tamanho || '',
    ncm: i.ncm || '',
    unidade: i.unidade || 'UN',
    quantidade: qtd,
    qtd: qtd,
    valorUnitario: vu,
    valorTotal: (vt || Math.round(qtd * vu * 100) / 100),
    fornecedor: i.fornecedor || '',
    cnpj: i.cnpj || '',
    obra: i.obra || '',
    lote: i.lote || '',
    validade: i.validade || '',
    status: i.status || '',
    observacao: i.observacao || ''
  };
}

/* ============================================================
   OBTER / ITENS
   ============================================================ */
function AP_NF_obter(p) {
  var id = String(p.id || p.idNF || '') || AP_NF_id(p);
  var achada = AP_NF_listar({}).dados.filter(function (n) {
    return n.id === id || (p.numero && String(n.numero) === String(p.numero) &&
      (!p.serie || String(n.serie) === String(p.serie)));
  })[0];
  return achada
    ? { ok: true, dados: achada }
    : { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Nota não localizada.' };
}

function AP_NF_itens(p) {
  var r = AP_NF_obter(p);
  return r.ok ? { ok: true, dados: r.dados.itens } : r;
}

/* ============================================================
   SALVAR — cria ou atualiza o MESMO registro, nunca duplica
   ============================================================ */
function AP_NF_salvar(p, sessao) {
  if (!p || !p.numero) {
    return { ok: false, codigo: 'CAMPO_OBRIGATORIO', mensagem: 'Informe o número da nota.' };
  }
  var id = AP_NF_id(p);
  if (!id) return { ok: false, codigo: 'SEM_IDENTIDADE', mensagem: 'Não consegui identificar esta nota.' };

  var quem = (sessao && sessao.usuario) || 'sistema';
  var agora = AP_NF_agora_();
  var itensNovos = (p.listaItens || p.itens || []).filter(function (i) {
    return i && (i.descricao || i.sku || i.codigo);
  });

  var lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (e) {
    return { ok: false, codigo: 'OCUPADO', mensagem: 'Outra gravação está em andamento. Tente de novo.' };
  }

  try {
    AP_NF_garantirColunas_(AP_NF_ABAS.notas, AP_NF_COL_NOTA);
    AP_NF_garantirColunas_(AP_NF_ABAS.itens, AP_NF_COL_ITEM);

    var soma = Math.round(itensNovos.reduce(function (s, i) {
      var q = Number(i.quantidade !== undefined ? i.quantidade : i.qtd) || 0;
      var vu = Number(i.valorUnitario) || 0;
      return s + (Number(i.valorTotal) || Math.round(q * vu * 100) / 100);
    }, 0) * 100) / 100;

    var cabec = {
      numero: String(p.numero),
      serie: String(p.serie || ''),
      chave: String(p.chave || ''),
      fornecedor: p.fornecedor || '',
      cnpj: p.cnpj || '',
      emissao: p.emissao || '',
      entrada: p.entrada || agora,
      valor: Number(p.valor) > 0 ? Number(p.valor) : soma,
      itens: itensNovos.length,
      status: p.status || 'EM_CONFERENCIA',
      origem: String(p.origem || 'MANUAL').toUpperCase(),
      arquivoId: p.arquivoId || '',
      observacao: p.observacao || '',
      idNF: id,
      atualizadoEm: agora
    };

    var existente = AP_NF_acharLinha_(AP_NF_ABAS.notas, id);
    if (existente) {
      /* mantém quem lançou originalmente */
      cabec.lancadoPor = existente.lancadoPor || quem;
      cabec.lancadoEm = existente.lancadoEm || agora;
      AP_NF_escreverLinha_(AP_NF_ABAS.notas, existente.__linha, cabec);
    } else {
      cabec.lancadoPor = quem;
      cabec.lancadoEm = agora;
      AP_NF_acrescentar_(AP_NF_ABAS.notas, cabec);
    }

    var resumoItens = AP_NF_sincronizarItens_(id, cabec, itensNovos, quem, agora);

    /* confere que gravou mesmo antes de dizer que deu certo */
    var conferencia = AP_NF_acharLinha_(AP_NF_ABAS.notas, id);
    if (!conferencia) {
      return { ok: false, codigo: 'NAO_GRAVOU', mensagem: 'A nota não apareceu na aba ' + AP_NF_ABAS.notas + ' depois da gravação.' };
    }

    try {
      AP_Audit_log(quem, existente ? 'NF_ATUALIZADA' : 'NF_LANCADA', AP_NF_ABAS.notas, id, {
        numero: cabec.numero, origem: cabec.origem, itens: itensNovos.length, valor: cabec.valor
      });
    } catch (e) {}

    return {
      ok: true,
      dados: AP_NF_montar_(cabec, itensNovos.map(function (i) {
        return AP_NF_itemPublico_(AP_NF_normalizarItem_(i, id, cabec));
      }), id, false),
      atualizada: !!existente,
      itens: resumoItens
    };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * Compara os itens gravados com os que vieram da tela.
 * Alterado atualiza · novo entra · removido sai.
 * A comparação usa o identificador do item, nunca a descrição —
 * Bota 40 e Bota 41 são itens diferentes.
 */
function AP_NF_sincronizarItens_(id, cabec, novos, quem, agora) {
  var aba = AP_NF_aba_(AP_NF_ABAS.itens);
  var gravados = AP_NF_linhas_(AP_NF_ABAS.itens).filter(function (i) {
    var seu = String(i.idNF || '') || AP_NF_id({ numero: i.nf, serie: i.serie, cnpj: i.cnpj });
    return seu === id;
  });

  var usados = {};
  var criados = 0, atualizados = 0;

  novos.forEach(function (bruto) {
    var item = AP_NF_normalizarItem_(bruto, id, cabec);
    item.lancadoPor = quem;
    item.lancadoEm = agora;

    var alvo = null;
    if (item.id) {
      alvo = gravados.filter(function (g) { return String(g.id) === String(item.id) && !usados[g.__linha]; })[0];
    }
    if (!alvo) {
      alvo = gravados.filter(function (g) {
        if (usados[g.__linha]) return false;
        return AP_NF_chaveItem_(g) === AP_NF_chaveItem_(item);
      })[0];
    }

    if (alvo) {
      usados[alvo.__linha] = true;
      item.id = alvo.id || item.id;
      item.lancadoEm = alvo.lancadoEm || agora;
      AP_NF_escreverLinha_(AP_NF_ABAS.itens, alvo.__linha, item);
      atualizados++;
    } else {
      item.id = item.id || 'ITNF-' + new Date().getTime() + '-' + Math.floor(Math.random() * 1000);
      AP_NF_acrescentar_(AP_NF_ABAS.itens, item);
      criados++;
    }
  });

  /* removidos: saem de baixo para cima, para os índices não escorregarem */
  var sobraram = gravados.filter(function (g) { return !usados[g.__linha]; })
    .sort(function (a, b) { return b.__linha - a.__linha; });
  sobraram.forEach(function (g) { aba.deleteRow(g.__linha); });

  return { criados: criados, atualizados: atualizados, removidos: sobraram.length };
}

/** Identidade do item dentro da nota: produto + tamanho, nunca só a descrição. */
function AP_NF_chaveItem_(i) {
  var produto = AP_NF_so_(i.idProduto || i.sku || i.codigo);
  var tamanho = AP_NF_so_(i.tamanho);
  if (produto) return 'P:' + produto + (tamanho ? '#' + tamanho : '');
  /* sem cadastro ainda: descrição + tamanho + valor unitário */
  return 'D:' + String(i.descricao || '').trim().toUpperCase() +
    '#' + tamanho + '#' + (Number(i.valorUnitario) || 0).toFixed(2);
}

function AP_NF_normalizarItem_(i, id, cabec) {
  var q = Number(i.quantidade !== undefined ? i.quantidade : i.qtd) || 0;
  var vu = Number(i.valorUnitario) || 0;
  return {
    id: i.id || '',
    idNF: id,
    nf: cabec.numero,
    serie: cabec.serie,
    sku: i.sku || '',
    idProduto: i.idProduto || i.sku || '',
    codigo: i.codigo || i.codigoFornecedor || '',
    descricao: i.descricao || '',
    tamanho: i.tamanho || '',
    ncm: i.ncm || '',
    unidade: i.unidade || 'UN',
    quantidade: q,
    valorUnitario: vu,
    valorTotal: Number(i.valorTotal) || Math.round(q * vu * 100) / 100,
    fornecedor: cabec.fornecedor,
    cnpj: cabec.cnpj,
    obra: i.obra || '',
    lote: i.lote || '',
    validade: i.validade || '',
    emissao: cabec.emissao,
    entrada: cabec.entrada,
    status: i.status || cabec.status,
    observacao: i.observacao || ''
  };
}

/* ============================================================
   EXCLUIR
   ============================================================ */
function AP_NF_excluir(p, sessao) {
  var id = String(p.id || p.idNF || '') || AP_NF_id(p);
  if (!id) return { ok: false, codigo: 'SEM_IDENTIDADE', mensagem: 'Informe qual nota.' };

  var abaN = AP_NF_aba_(AP_NF_ABAS.notas);
  var abaI = AP_NF_aba_(AP_NF_ABAS.itens);
  var n = AP_NF_acharLinha_(AP_NF_ABAS.notas, id);
  var quantos = 0;

  AP_NF_linhas_(AP_NF_ABAS.itens).filter(function (i) {
    var seu = String(i.idNF || '') || AP_NF_id({ numero: i.nf, serie: i.serie, cnpj: i.cnpj });
    return seu === id;
  }).sort(function (a, b) { return b.__linha - a.__linha; })
    .forEach(function (i) { abaI.deleteRow(i.__linha); quantos++; });

  if (n) abaN.deleteRow(n.__linha);

  try {
    AP_Audit_log((sessao && sessao.usuario) || 'sistema', 'NF_EXCLUIDA', AP_NF_ABAS.notas, id, { itens: quantos });
  } catch (e) {}

  return { ok: true, dados: { id: id, itensRemovidos: quantos } };
}

/* ============================================================
   RECUPERAÇÃO DO HISTÓRICO
   ============================================================ */

/** Grava, na aba de notas, o cabeçalho das notas que só têm itens. */
function AP_NF_recuperarOrfas_() {
  AP_NF_garantirColunas_(AP_NF_ABAS.notas, AP_NF_COL_NOTA);
  AP_NF_garantirColunas_(AP_NF_ABAS.itens, AP_NF_COL_ITEM);

  var lista = AP_NF_listar({}).dados.filter(function (n) { return n.reconstruida; });
  var agora = AP_NF_agora_();
  var feitas = [];

  lista.forEach(function (n) {
    if (!n.numero) return;
    AP_NF_acrescentar_(AP_NF_ABAS.notas, {
      numero: n.numero, serie: n.serie, chave: n.chave,
      fornecedor: n.fornecedor, cnpj: n.cnpj,
      emissao: n.emissao, entrada: n.entrada,
      valor: n.valor, itens: n.qtdItens,
      status: n.status, origem: n.origem,
      arquivoId: '', lancadoPor: n.lancadoPor || 'recuperado',
      lancadoEm: n.lancadoEm || agora,
      idNF: n.id, atualizadoEm: agora,
      observacao: 'Cabeçalho reconstruído a partir dos itens gravados.'
    });
    feitas.push(n.numero + ' (' + n.qtdItens + ' itens · ' + n.valor.toFixed(2) + ')');
  });

  /* carimba o idNF nos itens antigos, para o vínculo ficar forte */
  var carimbados = 0;
  var aba = AP_NF_aba_(AP_NF_ABAS.itens);
  var cab = AP_NF_cabecalho_(aba);
  var iCol = cab.indexOf('idNF') + 1;
  if (iCol > 0) {
    AP_NF_linhas_(AP_NF_ABAS.itens).forEach(function (i) {
      if (i.idNF) return;
      var id = AP_NF_id({ numero: i.nf, serie: i.serie, cnpj: i.cnpj });
      if (!id) return;
      aba.getRange(i.__linha, iCol).setValue(id);
      carimbados++;
    });
  }

  return {
    ok: true,
    dados: {
      recuperadas: feitas.length,
      notas: feitas,
      itensVinculados: carimbados
    },
    mensagem: feitas.length
      ? feitas.length + ' nota(s) voltaram para o histórico.'
      : 'Nenhuma nota órfã — todos os itens já têm cabeçalho.'
  };
}

/* ============================================================
   DIAGNÓSTICO
   ============================================================ */
function AP_NF_diagnostico_() {
  var notas = AP_NF_linhas_(AP_NF_ABAS.notas);
  var itens = AP_NF_linhas_(AP_NF_ABAS.itens);
  var lista = AP_NF_listar({}).dados;
  var orfas = lista.filter(function (n) { return n.reconstruida; });
  var semItem = lista.filter(function (n) { return !n.qtdItens; });
  var semValor = lista.filter(function (n) { return !n.valor; });

  return {
    ok: true,
    dados: {
      linhasNaAbaDeNotas: notas.length,
      linhasNaAbaDeItens: itens.length,
      notasNoHistorico: lista.length,
      notasSemCabecalho: orfas.length,
      notasSemItens: semItem.length,
      notasSemValor: semValor.length,
      porOrigem: lista.reduce(function (a, n) {
        a[n.origem] = (a[n.origem] || 0) + 1; return a;
      }, {}),
      porStatus: lista.reduce(function (a, n) {
        a[n.status] = (a[n.status] || 0) + 1; return a;
      }, {}),
      exemploOrfa: orfas.length ? { numero: orfas[0].numero, itens: orfas[0].qtdItens, valor: orfas[0].valor } : null
    }
  };
}

/* ============================================================
   PLANILHA
   ============================================================ */
function AP_NF_aba_(nome) {
  var ss = AP_Config_getSpreadsheet_();
  var aba = ss.getSheetByName(nome);
  if (!aba) {
    aba = ss.insertSheet(nome);
    var colunas = (nome === AP_NF_ABAS.notas) ? AP_NF_COL_NOTA : AP_NF_COL_ITEM;
    aba.getRange(1, 1, 1, colunas.length).setValues([colunas]);
    aba.setFrozenRows(1);
  }
  return aba;
}

function AP_NF_cabecalho_(aba) {
  var n = Math.max(1, aba.getLastColumn());
  return aba.getRange(1, 1, 1, n).getValues()[0].map(function (c) { return String(c).trim(); });
}

/** Acrescenta as colunas que faltam, sem mexer nas que já existem. */
function AP_NF_garantirColunas_(nome, colunas) {
  var aba = AP_NF_aba_(nome);
  var cab = AP_NF_cabecalho_(aba);
  var faltam = colunas.filter(function (c) { return cab.indexOf(c) === -1; });
  if (faltam.length) {
    aba.getRange(1, cab.length + 1, 1, faltam.length).setValues([faltam]);
  }
  return aba;
}

function AP_NF_linhas_(nome) {
  var aba = AP_NF_aba_(nome);
  if (aba.getLastRow() < 2) return [];
  var cab = AP_NF_cabecalho_(aba);
  return aba.getRange(2, 1, aba.getLastRow() - 1, aba.getLastColumn()).getValues()
    .map(function (linha, k) {
      var o = { __linha: k + 2 };
      cab.forEach(function (c, i) { if (c) o[c] = linha[i]; });
      return o;
    })
    .filter(function (o) {
      return Object.keys(o).some(function (k) {
        return k !== '__linha' && o[k] !== '' && o[k] !== null;
      });
    });
}

function AP_NF_acharLinha_(nome, id) {
  return AP_NF_linhas_(nome).filter(function (l) {
    var seu = String(l.idNF || '') || AP_NF_id(l);
    return seu === id;
  })[0] || null;
}

/** Escreve só nas colunas que o registro traz. Coluna ausente fica intacta. */
function AP_NF_escreverLinha_(nome, linha, registro) {
  var aba = AP_NF_aba_(nome);
  var cab = AP_NF_cabecalho_(aba);
  var atual = aba.getRange(linha, 1, 1, cab.length).getValues()[0];
  cab.forEach(function (c, i) {
    if (c && registro[c] !== undefined) atual[i] = registro[c];
  });
  aba.getRange(linha, 1, 1, cab.length).setValues([atual]);
}

function AP_NF_acrescentar_(nome, registro) {
  var aba = AP_NF_aba_(nome);
  var cab = AP_NF_cabecalho_(aba);
  aba.appendRow(cab.map(function (c) {
    return registro[c] !== undefined ? registro[c] : '';
  }));
}

function AP_NF_agora_() {
  return Utilities.formatDate(new Date(),
    AP_Config_get('TIMEZONE', 'America/Sao_Paulo'), "yyyy-MM-dd'T'HH:mm:ss");
}

/* ============================================================
   PARA RODAR NO EDITOR
   ============================================================ */

/** Mostra o que está na planilha e o que o histórico devolveria. */
function AP_NF_diagnostico() {
  var d = AP_NF_diagnostico_().dados;
  var linhas = ['===== NOTAS FISCAIS — DIAGNÓSTICO ====='];
  linhas.push('');
  linhas.push('Linhas na aba ' + AP_NF_ABAS.notas + ': ' + d.linhasNaAbaDeNotas);
  linhas.push('Linhas na aba ' + AP_NF_ABAS.itens + ': ' + d.linhasNaAbaDeItens);
  linhas.push('');
  linhas.push('Notas que o histórico devolve: ' + d.notasNoHistorico);
  linhas.push('  · sem cabeçalho gravado (só itens): ' + d.notasSemCabecalho);
  linhas.push('  · sem nenhum item: ' + d.notasSemItens);
  linhas.push('  · com valor zerado: ' + d.notasSemValor);
  linhas.push('');
  linhas.push('Por origem: ' + JSON.stringify(d.porOrigem));
  linhas.push('Por status: ' + JSON.stringify(d.porStatus));
  if (d.exemploOrfa) {
    linhas.push('');
    linhas.push('Exemplo de nota sem cabeçalho: NF ' + d.exemploOrfa.numero +
      ' · ' + d.exemploOrfa.itens + ' item(ns) · R$ ' + d.exemploOrfa.valor.toFixed(2));
    linhas.push('Rode AP_NF_recuperarOrfas para trazer estas notas de volta.');
  }
  var txt = linhas.join('\n');
  Logger.log(txt);
  return txt;
}

/** Reconstrói o cabeçalho das notas que só têm itens. */
function AP_NF_recuperarOrfas() {
  var r = AP_NF_recuperarOrfas_();
  var txt = r.mensagem + (r.dados.notas.length ? '\n\n' + r.dados.notas.join('\n') : '') +
    '\n\nItens que ganharam vínculo forte: ' + r.dados.itensVinculados;
  Logger.log(txt);
  return txt;
}

/** Lista o histórico como a tela vai ver. Não altera nada. */
function AP_NF_verHistorico() {
  var lista = AP_NF_listar({}).dados;
  var linhas = ['===== HISTÓRICO DE NOTAS (' + lista.length + ') ====='];
  lista.forEach(function (n) {
    linhas.push('');
    linhas.push('NF ' + n.numero + (n.serie ? '-' + n.serie : '') + '  ·  ' + n.origem + '  ·  ' + n.status +
      (n.reconstruida ? '  [cabeçalho reconstruído]' : ''));
    linhas.push('  fornecedor: ' + (n.fornecedor || '—'));
    linhas.push('  itens: ' + n.qtdItens + '  ·  valor: R$ ' + Number(n.valor).toFixed(2) +
      (n.valor !== n.valorItens ? '  (soma dos itens: R$ ' + n.valorItens.toFixed(2) + ')' : ''));
    n.itens.forEach(function (i) {
      linhas.push('    - ' + (i.descricao || '(sem descrição)') + (i.tamanho ? ' [' + i.tamanho + ']' : '') +
        '  ' + i.quantidade + ' ' + i.unidade + '  ×  R$ ' + Number(i.valorUnitario).toFixed(2) +
        '  =  R$ ' + Number(i.valorTotal).toFixed(2) + (i.sku ? '  · ' + i.sku : ''));
    });
  });
  if (!lista.length) linhas.push('Nenhuma nota encontrada nas duas abas.');
  var txt = linhas.join('\n');
  Logger.log(txt);
  return txt;
}
