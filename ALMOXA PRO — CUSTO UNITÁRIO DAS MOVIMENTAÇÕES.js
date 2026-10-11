/* ============================================================
   ALMOXA PRO — CUSTO UNITÁRIO DAS MOVIMENTAÇÕES
   ============================================================

   O QUE A AUDITORIA ENCONTROU  (item 95 do prompt)
   -------------------------------------------------
   Procurei onde o valor de uma movimentação deveria estar. Não
   estava em lugar nenhum, e não é descuido de preenchimento:

     DB_MOVIMENTACOES tem as colunas
       ID_MOVIMENTACAO, PRODUTO_ID, TIPO_MOVIMENTO, QUANTIDADE,
       DOCUMENTO_REFERENCIA, USUARIO_ID, PROJETO_ID,
       DATA_MOVIMENTO, OBSERVACAO
     Não existe coluna de valor. Nenhuma.

     DB_ESTOQUE tem SALDO_ATUAL, SALDO_RESERVADO e SALDO_DISPONIVEL.
     Não tem valor, não tem custo médio e NÃO TEM LOTE.

   Consequência direta, e é importante: **não existe método de
   custeio adotado neste sistema**. Não há custo médio gravado, não
   há lote, e não há nada que ligue uma saída a uma entrada
   específica. O item 46 do prompt manda "aplicar o método de
   custeio já adotado pelo sistema ou definido pela empresa" — o
   primeiro não existe, então o segundo é uma decisão sua, não minha.

   PEPS/FIFO por lote NÃO É CALCULÁVEL com os dados que existem
   hoje. Para isso seria preciso gravar lote na entrada e consumir
   lote na saída. Dizer que fiz FIFO aqui seria mentira.

   O QUE ESTE ARQUIVO FAZ
   ----------------------
   Ele resolve o custo unitário de um produto NA HORA DA LEITURA, a
   partir das duas únicas fontes que existem de verdade:

     1. as ENTRADAS FISCAIS — ALMOXA_NF_ITENS (as notas lidas pelo
        sistema) e DB_ITENS_NOTAS (o banco do Core). Cada entrada
        tem quantidade, valor unitário e a data da nota.
     2. o CADASTRO DO PRODUTO — DB_PRODUTOS.VALOR_UNITARIO.

   E devolve TRÊS números, sempre, mais o que foi aplicado:

     custoMedio     média ponderada das entradas: Σ(qtd×vu) ÷ Σqtd
     ultimaEntrada  o valor unitário da entrada mais recente
     cadastro       o VALOR_UNITARIO do cadastro do produto
     aplicado       qual deles vale, segundo AP_CUSTO_CFG.metodo

   Devolver os três não é indecisão: é o que permite conferir. Se um
   dia a empresa decidir outro método, muda-se UMA LINHA na
   configuração abaixo e nenhum relatório precisa ser reescrito.

   Por que MEDIO é o padrão: é o único dos três que usa o histórico
   fiscal inteiro e não cai na armadilha que o item 46 proíbe —
   aplicar o preço da última nota a todas as unidades compradas
   antes dela.

   O QUE ELE NÃO FAZ — de propósito
   --------------------------------
   NÃO grava nada. Nem uma célula. É só leitura.

   NÃO escreve valor dentro de DB_MOVIMENTACOES. Aquela tabela é
   declarada imutável e sem exclusão no próprio Core ("é
   livro-caixa"). Acrescentar valor em lançamento já fechado é
   exatamente o que o item 89 proíbe. O custo é resolvido na
   leitura, e o livro-caixa continua intacto.

   NÃO preenche com zero quando não sabe. Quando não há custo
   confiável, devolve pendente: true com o motivo — item 19.

   NÃO casa produto por descrição como regra. Casa por ID, código e
   SKU (item 15). Descrição é último recurso e vem MARCADA como
   casadoPorDescricao, para ir para conferência — item 91.

   COMO INSTALAR
   -------------
     1. Planilha "Base Dado almoxarifado" → Extensões → Apps Script
     2. "+" ao lado de Arquivos → Script
     3. Nome: ALMOXA_PRO_Modulo_Custos
     4. Cole este conteúdo inteiro e salve (Ctrl+S)
     5. Implantar → Gerenciar implantações → editar → Nova versão
     6. Para ver o que ele encontrou sem gravar nada: escolha a
        função AP_CUSTO_RAIO_X e execute (Ctrl+Enter para o log).

   ============================================================ */


var AP_CUSTO_CFG = {
  versao: '1.0.0',

  /* ---------- A ÚNICA LINHA QUE DECIDE O CUSTEIO ----------
     'MEDIO'    média ponderada das entradas fiscais  (padrão)
     'ULTIMA'   valor unitário da entrada mais recente
     'CADASTRO' o VALOR_UNITARIO do cadastro do produto
     Trocar aqui muda todos os relatórios de uma vez. */
  metodo: 'MEDIO',

  /* quando o método escolhido não tem número, tenta nesta ordem
     antes de declarar pendência */
  reserva: ['MEDIO', 'CADASTRO', 'ULTIMA'],

  caminhos: ['', '01_BANCO_DADOS/'],

  /* as entradas fiscais vivem em dois lugares conforme por onde a
     nota entrou. Os dois são lidos e somados — a mesma nota não é
     contada duas vezes porque a chave inclui o documento. */
  abaNfItens: 'ALMOXA_NF_ITENS',
  abaNotas: 'ALMOXA_NOTAS',
  bancoItensNota: 'DB_ITENS_NOTAS',
  bancoNotas: 'DB_NOTAS_FISCAIS',
  bancoProdutos: 'DB_PRODUTOS',

  /* um valor unitário acima disto quase certamente é valor TOTAL
     lançado na coluna errada. Não corrige sozinho: marca para
     conferência (item 91). */
  tetoSuspeito: 1000000
};


/* ============================================================
   A PORTA DO ROTEADOR
   ============================================================ */
function AP_Modulo_custos(acao, payload, sessao) {
  payload = payload || {};
  sessao = sessao || {};
  try {
    switch (String(acao || '').trim()) {
      case 'tabela':     return { ok: true, dados: AP_CUSTO_tabela_(payload) };
      case 'doProduto':  return AP_CUSTO_doProduto_(payload);
      case 'pendencias': return { ok: true, dados: AP_CUSTO_pendencias_(payload) };
      case 'metodo':     return { ok: true, dados: AP_CUSTO_metodo_() };
      case 'diagnostico':return { ok: true, dados: AP_CUSTO_diagnostico_() };
      default:
        return { ok: false, codigo: 'ACAO_DESCONHECIDA',
          mensagem: 'Os custos não conhecem a ação "' + acao +
            '". Conhece: tabela, doProduto, pendencias, metodo, diagnostico.' };
    }
  } catch (e) {
    return { ok: false, codigo: 'ERRO', mensagem: e.message,
      onde: String(e.stack || '').slice(0, 400) };
  }
}


/* ============================================================
   LEITURA CRUA — nunca cria aba, nunca escreve
   ============================================================ */
function AP_CUSTO_viva_(aba) {
  if (!aba) return false;
  try { aba.getLastColumn(); return true; } catch (e) { return false; }
}

/* Devolve a aba se ela EXISTIR. Se não existir, devolve null —
   este arquivo não cria nada. */
function AP_CUSTO_abaOuNulo_(nome) {
  if (typeof AP_SRV_aba_ === 'function') {
    for (var i = 0; i < AP_CUSTO_CFG.caminhos.length; i++) {
      var a = null;
      try { a = AP_SRV_aba_(AP_CUSTO_CFG.caminhos[i] + nome); } catch (e) {}
      if (a && AP_CUSTO_viva_(a)) return a;
    }
  }
  try {
    var ss = SpreadsheetApp.getActive();
    if (!ss) return null;
    var d = ss.getSheetByName(nome);
    return (d && AP_CUSTO_viva_(d)) ? d : null;
  } catch (e) { return null; }
}

/* Um banco do Core (DB_*): usa o atalho do servidor quando ele
   existe, senão procura a aba pelo nome. */
function AP_CUSTO_banco_(nome) {
  if (typeof AP_DB_tabela_ === 'function') {
    try {
      var t = AP_DB_tabela_(nome);
      if (t && t.aba && AP_CUSTO_viva_(t.aba)) return t.aba;
    } catch (e) {}
  }
  return AP_CUSTO_abaOuNulo_(nome);
}

/* Lê a aba e devolve objetos. Cada valor fica acessível pelo
   cabeçalho cru, por ele em MAIÚSCULA e pela versão camelCase —
   porque as abas do NFHub usam valorUnitario e as do Core usam
   VALOR_UNITARIO, e este arquivo lê as duas. */
function AP_CUSTO_objetos_(aba) {
  if (!aba) return [];
  var ultima = 0, largura = 0;
  try { ultima = aba.getLastRow(); largura = aba.getLastColumn(); } catch (e) { return []; }
  if (ultima < 2 || !largura) return [];

  var tudo = aba.getRange(1, 1, ultima, largura).getValues();
  var cab = tudo[0];
  var chaves = [];
  for (var c = 0; c < largura; c++) {
    var cru = String(cab[c] === null || cab[c] === undefined ? '' : cab[c]).trim();
    chaves.push(cru);
  }

  var saida = [];
  for (var l = 1; l < tudo.length; l++) {
    var o = {};
    var vazia = true;
    for (var k = 0; k < largura; k++) {
      var nome = chaves[k];
      if (!nome) continue;
      var v = tudo[l][k];
      if (v !== '' && v !== null && v !== undefined) vazia = false;
      o[nome] = v;
      o[nome.toUpperCase()] = v;
      o[AP_CUSTO_camel_(nome)] = v;
    }
    if (!vazia) saida.push(o);
  }
  return saida;
}

function AP_CUSTO_camel_(nome) {
  var partes = String(nome).toLowerCase().split(/[^a-z0-9]+/);
  var fora = partes[0] || '';
  for (var i = 1; i < partes.length; i++) {
    if (!partes[i]) continue;
    fora += partes[i].charAt(0).toUpperCase() + partes[i].slice(1);
  }
  return fora;
}

function AP_CUSTO_pegar_(o, nomes) {
  for (var i = 0; i < nomes.length; i++) {
    var v = o[nomes[i]];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return '';
}

/* Número no padrão brasileiro e no americano, sem adivinhação:
   se tem vírgula, a vírgula é o decimal e o ponto é milhar. */
function AP_CUSTO_num_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  if (v === null || v === undefined || v === '') return 0;
  var t = String(v).replace(/[^\d,.\-]/g, '');
  if (!t) return 0;
  if (t.indexOf(',') > -1) t = t.replace(/\./g, '').replace(',', '.');
  var n = Number(t);
  return isFinite(n) ? n : 0;
}

function AP_CUSTO_txt_(v) {
  return String(v === null || v === undefined ? '' : v).trim();
}

/* A chave de um produto. Código e SKU vêm escritos de jeitos
   diferentes conforme a tela; comparar o texto cru faria o mesmo
   produto virar dois. */
function AP_CUSTO_chave_(v) {
  return AP_CUSTO_txt_(v).toUpperCase().replace(/\s+/g, '');
}

function AP_CUSTO_semAcento_(v) {
  return AP_CUSTO_txt_(v).toUpperCase()
    .replace(/[ÁÀÂÃÄ]/g, 'A').replace(/[ÉÈÊË]/g, 'E').replace(/[ÍÌÎÏ]/g, 'I')
    .replace(/[ÓÒÔÕÖ]/g, 'O').replace(/[ÚÙÛÜ]/g, 'U').replace(/Ç/g, 'C')
    .replace(/\s+/g, ' ');
}

function AP_CUSTO_dia_(v) {
  if (!v) return '';
  if (v instanceof Date) {
    return isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  }
  var s = AP_CUSTO_txt_(v);

  /* ISO PRIMEIRO, e ancorado.
     Sem esta linha, "2026-03-04" caía no padrão brasileiro mais
     abaixo: a busca não é ancorada, então ela achava "26-03-04"
     no meio do texto e devolvia 2004-03-26. Um ano inteiro de
     diferença, calado, na hora de escolher a entrada mais recente. */
  var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];

  var m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    var ano = m[3].length === 2 ? '20' + m[3] : m[3];
    return ano + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  }
  var d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return s.slice(0, 10);
}


/* ============================================================
   AS ENTRADAS FISCAIS
   ------------------------------------------------------------
   Uma entrada é uma linha de item de nota: produto, quantidade,
   valor unitário e a data do documento. É daqui que sai o custo.
   ============================================================ */
function AP_CUSTO_entradas_() {
  var saida = [];
  var vistas = {};

  /* --- 1. a aba do NFHub (notas que passaram pelo leitor) --- */
  var abaItens = AP_CUSTO_abaOuNulo_(AP_CUSTO_CFG.abaNfItens);
  var notasPorNumero = {};
  AP_CUSTO_objetos_(AP_CUSTO_abaOuNulo_(AP_CUSTO_CFG.abaNotas)).forEach(function (n) {
    var num = AP_CUSTO_chave_(AP_CUSTO_pegar_(n, ['numero', 'NUMERO', 'nf', 'NF']));
    if (!num) return;
    notasPorNumero[num] = AP_CUSTO_dia_(AP_CUSTO_pegar_(n,
      ['dataEmissao', 'DATA_EMISSAO', 'emissao', 'EMISSAO', 'data', 'DATA']));
  });

  AP_CUSTO_objetos_(abaItens).forEach(function (i) {
    var doc = AP_CUSTO_chave_(AP_CUSTO_pegar_(i, ['nf', 'NF', 'numero', 'NUMERO', 'notaId', 'NOTA_ID']));
    var e = AP_CUSTO_entrada_(i, doc, notasPorNumero[doc] || '', 'NF_ITENS');
    if (e) AP_CUSTO_guardar_(saida, vistas, e);
  });

  /* --- 2. o banco do Core --- */
  var notasCore = {};
  AP_CUSTO_objetos_(AP_CUSTO_banco_(AP_CUSTO_CFG.bancoNotas)).forEach(function (n) {
    var id = AP_CUSTO_chave_(AP_CUSTO_pegar_(n, ['ID_NOTA', 'idNota']));
    if (!id) return;
    notasCore[id] = {
      dia: AP_CUSTO_dia_(AP_CUSTO_pegar_(n, ['DATA_EMISSAO', 'dataEmissao'])),
      numero: AP_CUSTO_txt_(AP_CUSTO_pegar_(n, ['NUMERO', 'numero']))
    };
  });

  AP_CUSTO_objetos_(AP_CUSTO_banco_(AP_CUSTO_CFG.bancoItensNota)).forEach(function (i) {
    var notaId = AP_CUSTO_chave_(AP_CUSTO_pegar_(i, ['NOTA_ID', 'notaId']));
    var ref = notasCore[notaId] || { dia: '', numero: notaId };
    var e = AP_CUSTO_entrada_(i, AP_CUSTO_chave_(ref.numero || notaId), ref.dia, 'DB_ITENS_NOTAS');
    if (e) AP_CUSTO_guardar_(saida, vistas, e);
  });

  return saida;
}

function AP_CUSTO_entrada_(i, documento, dia, fonte) {
  var qtd = AP_CUSTO_num_(AP_CUSTO_pegar_(i, ['qtd', 'QTD', 'quantidade', 'QUANTIDADE', 'qtde', 'QTDE']));
  var vu = AP_CUSTO_num_(AP_CUSTO_pegar_(i,
    ['valorUnitario', 'VALOR_UNITARIO', 'valorUnit', 'precoUnitario', 'valor', 'VALOR']));
  var vt = AP_CUSTO_num_(AP_CUSTO_pegar_(i, ['valorTotal', 'VALOR_TOTAL', 'total', 'TOTAL']));

  /* unitário em branco mas total preenchido: o unitário é dedutível
     e isso NÃO é invenção, é a mesma conta ao contrário */
  if (!vu && vt && qtd) vu = Math.round((vt / qtd) * 10000) / 10000;

  if (qtd <= 0 || vu <= 0) return null;

  var id = AP_CUSTO_chave_(AP_CUSTO_pegar_(i, ['PRODUTO_ID', 'produtoId', 'idProduto', 'ID_PRODUTO']));
  var cod = AP_CUSTO_chave_(AP_CUSTO_pegar_(i, ['codigo', 'CODIGO', 'sku', 'SKU', 'codigoProduto']));
  var desc = AP_CUSTO_txt_(AP_CUSTO_pegar_(i, ['descricao', 'DESCRICAO', 'nome', 'NOME', 'item']));
  if (!id && !cod && !desc) return null;

  return {
    produtoId: id,
    codigo: cod,
    descricao: desc,
    unidade: AP_CUSTO_txt_(AP_CUSTO_pegar_(i, ['unidade', 'UNIDADE', 'un', 'UN'])).toUpperCase(),
    qtd: qtd,
    valorUnitario: vu,
    data: dia,
    documento: documento,
    fonte: fonte,
    suspeito: vu > AP_CUSTO_CFG.tetoSuspeito
  };
}

/* A mesma linha de item lida nas duas fontes não pode contar duas
   vezes na média: documento + produto + quantidade + valor é
   identidade suficiente. */
function AP_CUSTO_guardar_(saida, vistas, e) {
  var k = [e.documento, e.produtoId || e.codigo || AP_CUSTO_semAcento_(e.descricao),
    e.qtd, e.valorUnitario].join('|');
  if (vistas[k]) return;
  vistas[k] = 1;
  saida.push(e);
}


/* ============================================================
   O CADASTRO DE PRODUTOS
   ============================================================ */
function AP_CUSTO_produtos_() {
  var fora = [];
  AP_CUSTO_objetos_(AP_CUSTO_banco_(AP_CUSTO_CFG.bancoProdutos)).forEach(function (p) {
    var id = AP_CUSTO_chave_(AP_CUSTO_pegar_(p, ['ID_PRODUTO', 'idProduto', 'id', 'ID']));
    var cod = AP_CUSTO_chave_(AP_CUSTO_pegar_(p, ['CODIGO', 'codigo', 'SKU', 'sku']));
    var desc = AP_CUSTO_txt_(AP_CUSTO_pegar_(p, ['DESCRICAO', 'descricao', 'NOME', 'nome']));
    if (!id && !cod && !desc) return;
    var excluido = AP_CUSTO_txt_(AP_CUSTO_pegar_(p, ['EXCLUIDO', 'excluido'])).toUpperCase();
    if (excluido === 'SIM') return;
    fora.push({
      produtoId: id,
      codigo: cod,
      descricao: desc,
      unidade: AP_CUSTO_txt_(AP_CUSTO_pegar_(p, ['UNIDADE', 'unidade'])).toUpperCase(),
      valorCadastro: AP_CUSTO_num_(AP_CUSTO_pegar_(p, ['VALOR_UNITARIO', 'valorUnitario', 'valor']))
    });
  });
  return fora;
}


/* ============================================================
   A TABELA DE CUSTOS
   ------------------------------------------------------------
   payload.chaves — lista de códigos/ids a resolver. Sem ela,
   resolve tudo o que encontrar.
   ============================================================ */
function AP_CUSTO_tabela_(payload) {
  payload = payload || {};
  var entradas = AP_CUSTO_entradas_();
  var produtos = AP_CUSTO_produtos_();

  var fichas = {};        /* chave canônica -> ficha */
  var porChave = {};      /* qualquer identificador -> ficha */
  var porDescricao = {};  /* descrição normalizada -> ficha */

  function ficha(produtoId, codigo, descricao, unidade) {
    var ids = [];
    if (produtoId) ids.push(AP_CUSTO_chave_(produtoId));
    if (codigo) ids.push(AP_CUSTO_chave_(codigo));

    var achada = null;
    for (var i = 0; i < ids.length && !achada; i++) achada = porChave[ids[i]] || null;

    if (!achada) {
      var canon = ids[0] || ('DESC:' + AP_CUSTO_semAcento_(descricao));
      achada = {
        chave: canon,
        produtoId: AP_CUSTO_txt_(produtoId),
        codigo: AP_CUSTO_txt_(codigo),
        descricao: AP_CUSTO_txt_(descricao),
        unidade: AP_CUSTO_txt_(unidade),
        entradas: 0,
        quantidadeEntrada: 0,
        somaFinanceira: 0,
        custoMedio: 0,
        ultimaEntrada: null,
        cadastro: 0,
        aplicado: 0,
        fonte: '',
        pendente: true,
        motivo: '',
        suspeitos: 0,
        casadoPorDescricao: false
      };
      fichas[canon] = achada;
    }

    /* o que chegou depois completa o que faltava, sem sobrescrever */
    if (!achada.produtoId && produtoId) achada.produtoId = AP_CUSTO_txt_(produtoId);
    if (!achada.codigo && codigo) achada.codigo = AP_CUSTO_txt_(codigo);
    if (!achada.descricao && descricao) achada.descricao = AP_CUSTO_txt_(descricao);
    if (!achada.unidade && unidade) achada.unidade = AP_CUSTO_txt_(unidade);

    for (var j = 0; j < ids.length; j++) porChave[ids[j]] = achada;
    var nd = AP_CUSTO_semAcento_(descricao);
    if (nd && !porDescricao[nd]) porDescricao[nd] = achada;
    return achada;
  }

  /* o cadastro primeiro: ele é quem define a identidade do produto */
  produtos.forEach(function (p) {
    var f = ficha(p.produtoId, p.codigo, p.descricao, p.unidade);
    if (p.valorCadastro > 0) f.cadastro = p.valorCadastro;
  });

  entradas.forEach(function (e) {
    var f = ficha(e.produtoId, e.codigo, e.descricao, e.unidade);
    if (e.suspeito) { f.suspeitos++; return; }
    f.entradas++;
    f.quantidadeEntrada += e.qtd;
    f.somaFinanceira += e.qtd * e.valorUnitario;
    if (!f.ultimaEntrada || String(e.data) > String(f.ultimaEntrada.data)) {
      f.ultimaEntrada = { valor: e.valorUnitario, data: e.data,
        documento: e.documento, fonte: e.fonte };
    }
  });

  Object.keys(fichas).forEach(function (k) { AP_CUSTO_fechar_(fichas[k]); });

  /* filtro por chaves pedidas */
  var pedidas = payload.chaves || payload.produtos || null;
  if (!pedidas || !pedidas.length) {
    var todas = {};
    Object.keys(fichas).forEach(function (k) { todas[k] = fichas[k]; });
    return { metodo: AP_CUSTO_CFG.metodo, total: Object.keys(todas).length, fichas: todas,
      indice: AP_CUSTO_indicePublico_(porChave) };
  }

  var fora = {};
  pedidas.forEach(function (p) {
    var alvo = (typeof p === 'object' && p) ? p : { codigo: p };
    var f = AP_CUSTO_achar_(porChave, porDescricao, alvo);
    var k = AP_CUSTO_chave_(alvo.codigo || alvo.sku || alvo.produtoId || alvo.id || alvo.descricao);
    if (!k) return;
    if (!f) {
      fora[k] = { chave: k, codigo: AP_CUSTO_txt_(alvo.codigo || alvo.sku),
        descricao: AP_CUSTO_txt_(alvo.descricao), entradas: 0, custoMedio: 0,
        ultimaEntrada: null, cadastro: 0, aplicado: 0, fonte: '',
        pendente: true,
        motivo: 'produto não encontrado no cadastro nem em nota fiscal nenhuma' };
      return;
    }
    fora[k] = f;
  });
  return { metodo: AP_CUSTO_CFG.metodo, total: Object.keys(fora).length, fichas: fora,
    indice: AP_CUSTO_indicePublico_(porChave) };
}

/* Fecha a conta de uma ficha: calcula a média, escolhe o aplicado e
   decide se é pendência. */
function AP_CUSTO_fechar_(f) {
  f.custoMedio = f.quantidadeEntrada > 0
    ? Math.round((f.somaFinanceira / f.quantidadeEntrada) * 10000) / 10000
    : 0;

  var valores = {
    MEDIO: f.custoMedio,
    ULTIMA: f.ultimaEntrada ? f.ultimaEntrada.valor : 0,
    CADASTRO: f.cadastro
  };

  var ordem = [AP_CUSTO_CFG.metodo].concat(AP_CUSTO_CFG.reserva || []);
  for (var i = 0; i < ordem.length; i++) {
    var m = ordem[i];
    if (valores[m] > 0) {
      f.aplicado = valores[m];
      f.fonte = m;
      f.pendente = false;
      f.motivo = (i === 0) ? '' :
        ('sem valor por ' + AP_CUSTO_CFG.metodo + '; usei ' + m);
      break;
    }
  }

  if (f.pendente) {
    f.aplicado = 0;
    f.fonte = '';
    f.motivo = f.suspeitos
      ? 'as entradas encontradas têm valor unitário acima de ' +
        AP_CUSTO_CFG.tetoSuspeito + ' — provavelmente valor total na coluna errada'
      : (f.entradas
        ? 'há entradas, mas nenhuma com quantidade e valor unitário válidos'
        : 'nenhuma entrada fiscal e nenhum valor no cadastro do produto');
  }
  return f;
}

function AP_CUSTO_achar_(porChave, porDescricao, alvo) {
  var tentativas = [alvo.produtoId, alvo.id, alvo.codigo, alvo.sku, alvo.codigoProduto];
  for (var i = 0; i < tentativas.length; i++) {
    var k = AP_CUSTO_chave_(tentativas[i]);
    if (k && porChave[k]) return porChave[k];
  }
  /* último recurso, e marcado: o item 15 manda não depender da
     descrição, então quando ela é a única ligação a ficha vai para
     conferência em vez de passar por certa */
  var nd = AP_CUSTO_semAcento_(alvo.descricao);
  if (nd && porDescricao[nd]) {
    var f = porDescricao[nd];
    f.casadoPorDescricao = true;
    return f;
  }
  return null;
}

/* O índice que a tela usa para achar a ficha de cada movimentação
   sem repetir a lógica de casamento no navegador. */
function AP_CUSTO_indicePublico_(porChave) {
  var fora = {};
  Object.keys(porChave).forEach(function (k) { fora[k] = porChave[k].chave; });
  return fora;
}

function AP_CUSTO_doProduto_(payload) {
  var r = AP_CUSTO_tabela_({ chaves: [payload || {}] });
  var ks = Object.keys(r.fichas);
  if (!ks.length) {
    return { ok: false, codigo: 'NAO_ENCONTRADO',
      mensagem: 'Não achei esse produto no cadastro nem em nota fiscal nenhuma.' };
  }
  return { ok: true, dados: r.fichas[ks[0]] };
}

/* Os produtos sem custo confiável — item 19 e item 91. */
function AP_CUSTO_pendencias_(payload) {
  var r = AP_CUSTO_tabela_(payload || {});
  var fora = [];
  Object.keys(r.fichas).forEach(function (k) {
    var f = r.fichas[k];
    /* casadoPorDescricao NÃO entra aqui: ele é marca de UMA consulta
       (quem perguntou só sabia a descrição), não um defeito do
       cadastro. Quem consulta recebe a marca na própria ficha e
       decide o que fazer. Listar aqui daria pendência que some
       sozinha na próxima leitura. */
    if (f.pendente || f.suspeitos) fora.push(f);
  });
  fora.sort(function (a, b) {
    return String(a.descricao || a.codigo).localeCompare(String(b.descricao || b.codigo));
  });
  return { metodo: AP_CUSTO_CFG.metodo, total: fora.length, itens: fora };
}

function AP_CUSTO_metodo_() {
  return {
    metodo: AP_CUSTO_CFG.metodo,
    reserva: AP_CUSTO_CFG.reserva,
    explicacao: {
      MEDIO: 'média ponderada de todas as entradas fiscais do produto',
      ULTIMA: 'valor unitário da entrada mais recente',
      CADASTRO: 'o VALOR_UNITARIO escrito no cadastro do produto'
    },
    naoDisponiveis: {
      PEPS: 'não é calculável: não há coluna de lote no estoque nem ligação ' +
        'entre uma saída e a entrada que a abasteceu',
      UEPS: 'mesmo motivo do PEPS'
    },
    ondeTrocar: 'AP_CUSTO_CFG.metodo, no topo do ALMOXA_PRO_Modulo_Custos.gs'
  };
}


/* ============================================================
   DIAGNÓSTICO E RAIO-X — só leitura
   ============================================================ */
function AP_CUSTO_diagnostico_() {
  var d = { versao: AP_CUSTO_CFG.versao, metodo: AP_CUSTO_CFG.metodo, fontes: {} };

  function olhar(rotulo, aba) {
    if (!aba) { d.fontes[rotulo] = { existe: false }; return; }
    var linhas = 0;
    try { linhas = Math.max(0, aba.getLastRow() - 1); } catch (e) {}
    d.fontes[rotulo] = { existe: true, linhas: linhas };
  }

  olhar(AP_CUSTO_CFG.abaNfItens, AP_CUSTO_abaOuNulo_(AP_CUSTO_CFG.abaNfItens));
  olhar(AP_CUSTO_CFG.abaNotas, AP_CUSTO_abaOuNulo_(AP_CUSTO_CFG.abaNotas));
  olhar(AP_CUSTO_CFG.bancoItensNota, AP_CUSTO_banco_(AP_CUSTO_CFG.bancoItensNota));
  olhar(AP_CUSTO_CFG.bancoProdutos, AP_CUSTO_banco_(AP_CUSTO_CFG.bancoProdutos));

  var r = AP_CUSTO_tabela_({});
  var comCusto = 0, pendentes = 0, porDescricao = 0;
  Object.keys(r.fichas).forEach(function (k) {
    var f = r.fichas[k];
    if (f.pendente) pendentes++; else comCusto++;
    if (f.casadoPorDescricao) porDescricao++;
  });
  d.produtos = { total: Object.keys(r.fichas).length, comCusto: comCusto,
    pendentes: pendentes, casadosPorDescricao: porDescricao };
  return d;
}

/* Rode esta função no editor para ver o que existe. Ela não grava
   nada e não imprime preço nenhum — só contagens e nomes de campo. */
function AP_CUSTO_RAIO_X() {
  var L = [];
  function diz(t) { L.push(t === undefined ? '' : String(t)); }

  diz('RAIO-X DO CUSTO UNITÁRIO  ·  versão ' + AP_CUSTO_CFG.versao);
  diz('ESTE ARQUIVO NÃO GRAVA NADA.');
  diz('');

  var d = AP_CUSTO_diagnostico_();
  diz('MÉTODO DE CUSTEIO APLICADO: ' + d.metodo);
  diz('');
  diz('FONTES:');
  Object.keys(d.fontes).forEach(function (k) {
    var f = d.fontes[k];
    diz('  ' + (f.existe ? 'existe  ' : 'NÃO EXISTE  ') + k +
      (f.existe ? '  (' + f.linhas + ' linha(s))' : ''));
  });
  diz('');
  diz('PRODUTOS:');
  diz('  total identificados ....... ' + d.produtos.total);
  diz('  com custo confiável ....... ' + d.produtos.comCusto);
  diz('  SEM custo (pendência) ..... ' + d.produtos.pendentes);
  diz('  casados só pela descrição . ' + d.produtos.casadosPorDescricao);
  diz('');

  var p = AP_CUSTO_pendencias_({});
  if (p.itens.length) {
    diz('OS QUE PRECISAM DE CONFERÊNCIA (até 30):');
    p.itens.slice(0, 30).forEach(function (f) {
      diz('  ' + (f.codigo || '(sem código)') + '  ' +
        String(f.descricao || '').slice(0, 40) + '  — ' + f.motivo);
    });
  } else {
    diz('Nenhuma pendência: todo produto encontrado tem custo.');
  }

  diz('');
  diz('O QUE ESTE ARQUIVO NÃO FEZ: não gravou, não criou aba, não');
  diz('alterou movimentação, não escreveu valor em lançamento fechado.');

  var texto = L.join('\n');
  Logger.log(texto);
  return texto;
}


/* ============================================================
   TESTES — não encostam na planilha
   ============================================================ */
function AP_CUSTO_testes() {
  var falhas = [];
  function conf(nome, obtido, esperado) {
    if (String(obtido) !== String(esperado)) {
      falhas.push(nome + ': esperava "' + esperado + '", veio "' + obtido + '"');
    }
  }

  conf('numero br', AP_CUSTO_num_('1.234,56'), 1234.56);
  conf('numero us', AP_CUSTO_num_('1234.56'), 1234.56);
  conf('numero com R$', AP_CUSTO_num_('R$ 42,50'), 42.5);
  conf('numero vazio', AP_CUSTO_num_(''), 0);
  conf('numero nulo', AP_CUSTO_num_(null), 0);

  conf('chave sem espaco', AP_CUSTO_chave_(' sku-1 '), 'SKU-1');
  conf('camel de VALOR_UNITARIO', AP_CUSTO_camel_('VALOR_UNITARIO'), 'valorUnitario');
  conf('camel de qtd', AP_CUSTO_camel_('QTD'), 'qtd');
  conf('sem acento', AP_CUSTO_semAcento_('Tubo Galvanizado'), 'TUBO GALVANIZADO');

  conf('dia iso', AP_CUSTO_dia_('2026-03-04'), '2026-03-04');
  conf('dia br', AP_CUSTO_dia_('04/03/2026'), '2026-03-04');

  /* a média ponderada, na mão */
  var f = { quantidadeEntrada: 15, somaFinanceira: 150, entradas: 2,
    ultimaEntrada: { valor: 12, data: '2026-01-01' }, cadastro: 9,
    pendente: true, suspeitos: 0 };
  AP_CUSTO_fechar_(f);
  conf('media ponderada 150/15', f.custoMedio, 10);
  conf('aplicou o medio', f.fonte, 'MEDIO');
  conf('nao e pendencia', f.pendente, 'false');

  /* sem entrada nenhuma, cai no cadastro */
  var g = { quantidadeEntrada: 0, somaFinanceira: 0, entradas: 0,
    ultimaEntrada: null, cadastro: 7.5, pendente: true, suspeitos: 0 };
  AP_CUSTO_fechar_(g);
  conf('sem entrada usa cadastro', g.aplicado, 7.5);
  conf('e diz que foi o cadastro', g.fonte, 'CADASTRO');

  /* sem nada, vira pendência — nunca zero silencioso */
  var h = { quantidadeEntrada: 0, somaFinanceira: 0, entradas: 0,
    ultimaEntrada: null, cadastro: 0, pendente: true, suspeitos: 0 };
  AP_CUSTO_fechar_(h);
  conf('sem nada e pendencia', h.pendente, 'true');
  conf('com motivo escrito', h.motivo.length > 10, 'true');
  conf('e aplicado fica zero, nao um chute', h.aplicado, 0);

  /* unitário deduzido do total */
  var e1 = AP_CUSTO_entrada_({ codigo: 'X1', qtd: 5, valorTotal: 50 },
    'NF1', '2026-01-01', 'teste');
  conf('unitario deduzido de 50/5', e1 && e1.valorUnitario, 10);
  var e2 = AP_CUSTO_entrada_({ codigo: 'X1', qtd: 0, valorUnitario: 10 }, 'NF1', '', 'teste');
  conf('quantidade zero nao vira entrada', e2, null);
  /* sem código, sem id e sem descrição não dá para saber de que
     produto é a entrada: ela é recusada em vez de virar um produto
     fantasma na tabela de custos */
  var e3 = AP_CUSTO_entrada_({ qtd: 5, valorTotal: 50 }, 'NF1', '', 'teste');
  conf('entrada sem identidade e recusada', e3, null);
  conf('data ISO continua ISO', AP_CUSTO_dia_('2026-03-04'), '2026-03-04');

  var r1 = AP_Modulo_custos('acao_que_nao_existe', {}, {});
  conf('acao desconhecida recusa', r1.ok, 'false');

  var m = AP_CUSTO_metodo_();
  conf('o metodo e declarado', m.metodo, AP_CUSTO_CFG.metodo);
  conf('e diz que PEPS nao da', m.naoDisponiveis.PEPS.indexOf('não é calculável'), 0);

  var saida = falhas.length
    ? 'FALHOU (' + falhas.length + '):\n  ' + falhas.join('\n  ')
    : 'Os 25 testes passaram. Nenhuma linha foi gravada.';
  Logger.log(saida);
  return saida;
}
