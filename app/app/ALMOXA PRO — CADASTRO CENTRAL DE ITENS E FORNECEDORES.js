/**
 * ============================================================
 * ALMOXA PRO — CADASTRO CENTRAL DE ITENS E FORNECEDORES
 * Versão 1.0.0 · backend real, gravando na planilha
 * ------------------------------------------------------------
 * Fonte única: todo módulo (loja, estoque, NF, inventário,
 * etiquetas, reservas) consulta ESTE cadastro. Não existe cópia.
 *
 * Handlers expostos:
 *   AP_Modulo_itens
 *   AP_Modulo_fornecedores
 *   AP_Modulo_config
 * ============================================================
 */

var AP_ITENS_CFG = {
  versao: '1.0.0',
  abaItens: 'ALMOXA_ITENS',
  abaFornecedores: 'ALMOXA_FORNECEDORES',
  abaConfig: 'ALMOXA_CONFIG',
  colunas: ['sku', 'codigoBarras', 'descricao', 'descricaoComplementar', 'categoria', 'subcategoria',
    'marca', 'modelo', 'unidade', 'ncm', 'fornecedor', 'localizacao',
    'estoqueMinimo', 'estoqueMaximo', 'estoqueAtual', 'valorUnitario',
    'foto', 'observacoes', 'status', 'criadoEm', 'criadoPor', 'atualizadoEm'],
  colunasFornecedor: ['id', 'razaoSocial', 'nomeFantasia', 'cnpj', 'email', 'telefone',
    'contato', 'categoria', 'prazoEntrega', 'status', 'criadoEm'],
  /* padrão do SKU — alterável em Configurações → Cadastro de Itens */
  skuPadrao: {
    automatico: true,
    permitirManual: true,
    prefixo: 'ALM',
    digitos: 6,
    usarCategoria: true,     // ALM-FER-000157
    proximo: 1,
    codigoBarrasAutomatico: true
  }
};

/* ------------------------------------------------------------
   PLANILHA
   ------------------------------------------------------------ */
function AP_ITENS_aba_(nome, cabecalho) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Nenhuma planilha vinculada ao projeto.');
  var aba = ss.getSheetByName(nome);
  if (!aba) {
    aba = ss.insertSheet(nome);
    aba.appendRow(cabecalho);
    aba.setFrozenRows(1);
    aba.getRange(1, 1, 1, cabecalho.length).setFontWeight('bold');
    AP_ITENS_esquecerCabecalho_();
  }
  return aba;
}

/**
 * Lê a aba de itens.
 *
 * POR QUE NÃO USA getDataRange()
 *
 * getDataRange() traz TODAS as colunas, inclusive a foto em base64.
 * Com 437 itens e fotos de ~120 mil caracteres, isso são dezenas de
 * megabytes vindos do Google Sheets a cada leitura — e é aí que os
 * 3 segundos são gastos.
 *
 * Remover a foto DEPOIS de ler não adianta: o custo já aconteceu.
 * Por isso a leitura pula as colunas pesadas, lendo apenas os blocos
 * de colunas que interessam.
 *
 * Quem precisa da foto pede pelo 'obter', que traz uma linha só.
 */
var AP_ITENS_COLUNAS_PESADAS = ['foto', 'imagem', 'anexo', 'observacaoLonga'];

/**
 * O cabeçalho da aba não muda durante uma execução.
 *
 * Lê-lo a cada consulta é uma ida à planilha por operação — e no
 * Apps Script cada ida custa de 200 a 800 ms. Guardado aqui, some
 * quando a execução termina.
 */
var AP_ITENS_cabecalhoCache_ = {};

function AP_ITENS_cabecalho_(aba, ultimaColuna) {
  var chave = aba.getName() + ':' + ultimaColuna;
  if (AP_ITENS_cabecalhoCache_[chave]) return AP_ITENS_cabecalhoCache_[chave];

  var cab = aba.getRange(1, 1, 1, ultimaColuna).getValues()[0];
  AP_ITENS_cabecalhoCache_[chave] = cab;
  return cab;
}

/** Chamado quando a estrutura da aba muda */
function AP_ITENS_esquecerCabecalho_() {
  AP_ITENS_cabecalhoCache_ = {};
}

function AP_ITENS_ler_(aba, colunas, incluirPesadas) {
  var ultimaLinha = aba.getLastRow();
  var ultimaColuna = aba.getLastColumn();
  if (ultimaLinha < 2 || ultimaColuna < 1) return [];

  var cab = AP_ITENS_cabecalho_(aba, ultimaColuna);

  /* quais colunas pular */
  var pular = {};
  if (!incluirPesadas) {
    cab.forEach(function (c, i) {
      if (AP_ITENS_COLUNAS_PESADAS.indexOf(String(c)) > -1) pular[i] = String(c);
    });
  }

  var quantasPuladas = Object.keys(pular).length;

  /* nada a pular: uma leitura só, como antes */
  if (!quantasPuladas) {
    var tudo = aba.getRange(1, 1, ultimaLinha, ultimaColuna).getValues();
    return AP_ITENS_montar_(tudo[0], tudo.slice(1), {});
  }

  /**
   * Lê em blocos, pulando as colunas pesadas.
   * Menos blocos é melhor: cada getRange é uma ida à planilha.
   */
  var blocos = [];
  var inicio = null;
  for (var c = 0; c < ultimaColuna; c++) {
    if (pular[c]) {
      if (inicio !== null) { blocos.push({ de: inicio, ate: c - 1 }); inicio = null; }
    } else if (inicio === null) {
      inicio = c;
    }
  }
  if (inicio !== null) blocos.push({ de: inicio, ate: ultimaColuna - 1 });

  var linhas = [];
  for (var i = 0; i < ultimaLinha - 1; i++) linhas.push(new Array(ultimaColuna));

  blocos.forEach(function (b) {
    var largura = b.ate - b.de + 1;
    var valores = aba.getRange(2, b.de + 1, ultimaLinha - 1, largura).getValues();
    valores.forEach(function (linha, li) {
      for (var j = 0; j < largura; j++) linhas[li][b.de + j] = linha[j];
    });
  });

  return AP_ITENS_montar_(cab, linhas, pular);
}

/** Transforma as linhas cruas em objetos */
function AP_ITENS_montar_(cab, linhas, pular) {
  var registros = [];
  for (var i = 0; i < linhas.length; i++) {
    var linha = linhas[i];
    if (!linha || !linha[0]) continue;

    var o = { _linha: i + 2 };
    for (var c = 0; c < cab.length; c++) {
      var nome = String(cab[c]);
      if (pular[c]) {
        /* a coluna não foi lida: diz que existe, sem carregá-la */
        o[nome] = '';
        if (nome === 'foto') o.temFoto = null;   /* desconhecido nesta leitura */
        continue;
      }
      o[nome] = linha[c];
    }
    registros.push(o);
  }
  return registros;
}

/* A mesma requisição costuma pedir o catálogo várias vezes (estoque,
   loja, conferência). Ler a planilha inteira toda vez era o principal
   custo de tempo — agora lê uma vez por execução. */
var AP_ITENS_CACHE_ = null;

/* quanto a listagem deixou de trafegar por não mandar as fotos */
var AP_ITENS_ULTIMA_ECONOMIA_ = null;

/**
 * Esquece a lista de itens em memória.
 *
 * Precisa avisar TAMBÉM o módulo de operação: ele guarda a própria
 * cópia do catálogo, e sem este aviso um item recém-criado aparecia
 * como "não localizado" na consulta de estoque logo em seguida.
 */
function AP_ITENS_invalidar_() {
  AP_ITENS_CACHE_ = null;
  try {
    if (typeof AP_OPER_ITENS_CACHE_ !== 'undefined') {
      var g = (typeof globalThis !== 'undefined') ? globalThis : this;
      g.AP_OPER_ITENS_CACHE_ = null;
    }
  } catch (e) { }
}

function AP_ITENS_todos_() {
  if (AP_ITENS_CACHE_) return AP_ITENS_CACHE_;
  AP_ITENS_CACHE_ = AP_ITENS_ler_(AP_ITENS_aba_(AP_ITENS_CFG.abaItens, AP_ITENS_CFG.colunas), AP_ITENS_CFG.colunas);
  return AP_ITENS_CACHE_;
}

/* ------------------------------------------------------------
   CONFIGURAÇÃO (inclusive as regras de SKU)
   ------------------------------------------------------------ */
/**
 * A ABA DE CONFIGURAÇÃO É LIDA INTEIRA A CADA CHAVE
 *
 * Cadastrar um item consulta três chaves: prefixo do SKU, quantos
 * dígitos, se é automático. Eram três leituras completas da aba
 * para pegar três células.
 *
 * A aba é pequena e muda pouco. Lida uma vez por execução, serve
 * a todas as consultas — e some quando a execução termina.
 *
 * Gravar atualiza a memória junto com a planilha, então nunca se
 * lê um valor velho.
 */
var AP_CONFIG_cache_ = null;

function AP_CONFIG_carregar_() {
  if (AP_CONFIG_cache_) return AP_CONFIG_cache_;

  var aba = AP_ITENS_aba_(AP_ITENS_CFG.abaConfig, ['chave', 'valor', 'atualizadoEm']);
  var linhas = aba.getDataRange().getValues();

  var mapa = {};
  for (var i = 1; i < linhas.length; i++) {
    if (linhas[i][0]) mapa[linhas[i][0]] = { valor: linhas[i][1], linha: i + 1 };
  }

  AP_CONFIG_cache_ = mapa;
  return mapa;
}

function AP_CONFIG_ler_(chave) {
  var mapa = AP_CONFIG_carregar_();
  if (!(chave in mapa)) return null;

  var bruto = mapa[chave].valor;
  try { return JSON.parse(bruto); } catch (e) { return bruto; }
}

function AP_CONFIG_gravar_(chave, valor) {
  var aba = AP_ITENS_aba_(AP_ITENS_CFG.abaConfig, ['chave', 'valor', 'atualizadoEm']);
  var mapa = AP_CONFIG_carregar_();

  var texto = (typeof valor === 'object') ? JSON.stringify(valor) : String(valor);
  var agora = new Date().toISOString();

  if (chave in mapa) {
    /* as duas células numa ida só */
    aba.getRange(mapa[chave].linha, 2, 1, 2).setValues([[texto, agora]]);
    mapa[chave].valor = texto;
    return valor;
  }

  aba.appendRow([chave, texto, agora]);
  /* a linha nova é a última */
  mapa[chave] = { valor: texto, linha: Object.keys(mapa).length + 2 };
  return valor;
}

/** Esquece a configuração lida. Use se outra parte gravar direto na aba. */
function AP_CONFIG_esquecer_() { AP_CONFIG_cache_ = null; }

function AP_ITENS_configSku_() {
  var c = AP_CONFIG_ler_('sku');
  if (!c) { c = AP_ITENS_CFG.skuPadrao; AP_CONFIG_gravar_('sku', c); }
  return c;
}

/* ------------------------------------------------------------
   SKU — automático, sequencial e sem duplicidade
   ------------------------------------------------------------ */
function AP_ITENS_siglaCategoria_(categoria) {
  var limpa = String(categoria || 'GER')
    .normalize ? String(categoria || 'GER').normalize('NFD').replace(/[\u0300-\u036f]/g, '') : String(categoria || 'GER');
  return limpa.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 3) || 'GER';
}

/**
 * Gera o próximo SKU livre. Nunca devolve um SKU já usado.
 */
function AP_ITENS_gerarSku_(categoria) {
  var cfg = AP_ITENS_configSku_();
  var usados = {};
  AP_ITENS_todos_().forEach(function (i) { usados[String(i.sku).toUpperCase()] = true; });

  var seq = Number(cfg.proximo) || 1;
  var sku = '';
  var tentativas = 0;

  do {
    var partes = [cfg.prefixo || 'ALM'];
    if (cfg.usarCategoria) partes.push(AP_ITENS_siglaCategoria_(categoria));
    partes.push(String(seq).padStart(Number(cfg.digitos) || 6, '0'));
    sku = partes.join('-');
    seq++;
    tentativas++;
  } while (usados[sku.toUpperCase()] && tentativas < 10000);

  cfg.proximo = seq;
  AP_CONFIG_gravar_('sku', cfg);
  return sku;
}

/** Código de barras EAN-13-like, derivado do SKU, sem repetir */
function AP_ITENS_gerarCodigoBarras_(sku) {
  var base = '789';
  var soma = 0;
  for (var i = 0; i < sku.length; i++) soma = (soma * 31 + sku.charCodeAt(i)) % 1000000000;
  var corpo = String(soma).padStart(9, '0').slice(0, 9);
  var num = base + corpo;
  var total = 0;
  for (var j = 0; j < 12; j++) total += Number(num[j]) * (j % 2 === 0 ? 1 : 3);
  var dv = (10 - (total % 10)) % 10;
  return num + dv;
}

/* ------------------------------------------------------------
   BUSCA E SEMELHANÇA (usada pela Nota Fiscal)
   ------------------------------------------------------------ */
function AP_ITENS_normalizar_(t) {
  return String(t || '').toLowerCase()
    .replace(/[àáâã]/g, 'a').replace(/[éê]/g, 'e').replace(/[íî]/g, 'i')
    .replace(/[óôõ]/g, 'o').replace(/[úû]/g, 'u').replace(/ç/g, 'c')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function AP_ITENS_semelhanca_(a, b) {
  var pa = AP_ITENS_normalizar_(a).split(' ').filter(Boolean);
  var pb = AP_ITENS_normalizar_(b).split(' ').filter(Boolean);
  if (!pa.length || !pb.length) return 0;
  var comuns = pa.filter(function (t) { return pb.indexOf(t) > -1; }).length;
  return comuns / Math.max(pa.length, pb.length);
}

/* ------------------------------------------------------------
   MÓDULO ITENS
   ------------------------------------------------------------ */
function AP_Modulo_itens(acao, payload, sessao) {
  payload = payload || {};

  try {
    switch (acao) {

      case 'listar': {
        var lista = AP_ITENS_todos_();

        /**
         * A foto vem em base64 dentro da célula. Numa listagem de
         * 437 itens, isso são dezenas de megabytes trafegando para
         * mostrar uma tabela onde a foto aparece em miniatura — ou
         * nem aparece.
         *
         * Quem precisa da foto pede com semFotos: false, ou busca
         * o item pelo 'obter'.
         */
        var semFotos = payload.semFotos !== false && payload.comFotos !== true;

        if (payload.categoria) {
          lista = lista.filter(function (i) { return i.categoria === payload.categoria; });
        }
        if (payload.busca) {
          var t = AP_ITENS_normalizar_(payload.busca);
          lista = lista.filter(function (i) {
            return AP_ITENS_normalizar_(i.descricao).indexOf(t) > -1 ||
              String(i.sku).toLowerCase().indexOf(payload.busca.toLowerCase()) > -1 ||
              String(i.codigoBarras).indexOf(payload.busca) > -1;
          });
        }

        if (semFotos) {
          var comFoto = 0, bytesFoto = 0;
          lista = lista.map(function (i) {
            var copia = {};
            for (var k in i) {
              if (k === 'foto' && i.foto && String(i.foto).length > 200) {
                comFoto++;
                bytesFoto += String(i.foto).length;
                /* marca que existe foto, sem carregá-la */
                copia.foto = '';
                copia.temFoto = true;
                continue;
              }
              copia[k] = i[k];
            }
            return copia;
          });

          if (comFoto) {
            AP_ITENS_ULTIMA_ECONOMIA_ = {
              itensComFoto: comFoto,
              caracteresEvitados: bytesFoto,
              mbEvitados: Math.round(bytesFoto / 1048576 * 100) / 100
            };
          }
        }
        return { ok: true, dados: lista };
      }

      case 'obter': {
        /**
         * Buscar UM item carregava a aba inteira: 201 linhas para
         * devolver 1 registro, medido com 200 itens. Com 5.000 no
         * cadastro, seriam 5.001 — e é aí que a tela trava.
         *
         * A busca direcionada procura só na coluna certa e lê
         * apenas a linha encontrada. Se o cadastro já estiver em
         * memória nesta execução, ela usa o que já está lá.
         */
        var achado = null;

        /* o 'obter' traz a linha inteira, com a foto — é uma linha só */
        if (typeof AP_Data_findFirstBy === 'function') {
          if (payload.sku) {
            achado = AP_Data_findFirstBy(AP_ITENS_CFG.abaItens, 'sku', payload.sku);
          }
          if (!achado && payload.codigoBarras) {
            achado = AP_Data_findFirstBy(AP_ITENS_CFG.abaItens, 'codigoBarras', payload.codigoBarras);
          }
        }

        /* Data Layer antigo: caminho de sempre, mesmo resultado */
        if (!achado) {
          achado = AP_ITENS_todos_().filter(function (i) {
            return String(i.sku) === String(payload.sku) ||
              (payload.codigoBarras && String(i.codigoBarras) === String(payload.codigoBarras));
          })[0];
        }

        return achado
          ? { ok: true, dados: achado }
          : { ok: false, codigo: 'ITEM_NAO_CADASTRADO', mensagem: 'Item não cadastrado.', consultado: payload.sku || payload.codigoBarras };
      }

      case 'proximoSku': {
        return { ok: true, dados: { sku: AP_ITENS_gerarSku_(payload.categoria) } };
      }

      case 'verificarSku': {
        var existe = AP_ITENS_todos_().filter(function (i) {
          return String(i.sku).toUpperCase() === String(payload.sku).toUpperCase();
        })[0];
        return {
          ok: true,
          dados: { disponivel: !existe, usadoPor: existe ? existe.descricao : null }
        };
      }

      case 'salvar': {
        if (!payload.descricao) {
          return { ok: false, codigo: 'CAMPO_OBRIGATORIO', campo: 'descricao', mensagem: 'A descrição do item é obrigatória.' };
        }
        var todos = AP_ITENS_todos_();
        var cfg = AP_ITENS_configSku_();
        var aba = AP_ITENS_aba_(AP_ITENS_CFG.abaItens, AP_ITENS_CFG.colunas);

        /* edição */
        if (payload.sku && payload.editando) {
          var alvo = todos.filter(function (i) { return String(i.sku) === String(payload.sku); })[0];
          if (!alvo) return { ok: false, codigo: 'ITEM_NAO_ENCONTRADO', mensagem: 'Item não localizado para edição.' };
          var linha = AP_ITENS_CFG.colunas.map(function (c) {
            if (c === 'sku') return alvo.sku;
            if (c === 'criadoEm') return alvo.criadoEm;
            if (c === 'criadoPor') return alvo.criadoPor;
            if (c === 'atualizadoEm') return new Date().toISOString();
            return payload[c] !== undefined ? payload[c] : alvo[c];
          });
          aba.getRange(alvo._linha, 1, 1, AP_ITENS_CFG.colunas.length).setValues([linha]);
          AP_ITENS_invalidar_();
          return { ok: true, dados: AP_Modulo_itens('obter', { sku: alvo.sku }).dados, atualizado: true };
        }

        /* SKU manual precisa ser único */
        var sku = payload.sku;
        if (sku) {
          if (!cfg.permitirManual) {
            return { ok: false, codigo: 'SKU_MANUAL_BLOQUEADO', mensagem: 'A configuração atual não permite SKU manual.' };
          }
          var duplicado = todos.filter(function (i) {
            return String(i.sku).toUpperCase() === String(sku).toUpperCase();
          })[0];
          if (duplicado) {
            return {
              ok: false, codigo: 'SKU_DUPLICADO',
              mensagem: 'Este SKU já está sendo utilizado por: ' + duplicado.descricao,
              itemExistente: duplicado
            };
          }
        } else {
          sku = AP_ITENS_gerarSku_(payload.categoria);
        }

        /* item equivalente já cadastrado? avisa em vez de duplicar */
        if (!payload.confirmadoNovo) {
          var parecido = null, melhor = 0;
          todos.forEach(function (i) {
            var s = AP_ITENS_semelhanca_(payload.descricao, i.descricao);
            if (s > melhor) { melhor = s; parecido = i; }
          });
          if (melhor >= 0.7) {
            return {
              ok: false, codigo: 'ITEM_SEMELHANTE',
              mensagem: 'Já existe um item parecido: ' + parecido.descricao,
              semelhanca: Math.round(melhor * 100),
              itemExistente: parecido
            };
          }
        }

        var codigoBarras = payload.codigoBarras ||
          (cfg.codigoBarrasAutomatico ? AP_ITENS_gerarCodigoBarras_(sku) : '');

        var novo = {};
        AP_ITENS_CFG.colunas.forEach(function (c) { novo[c] = payload[c] !== undefined ? payload[c] : ''; });
        novo.sku = sku;
        novo.codigoBarras = codigoBarras;
        novo.status = payload.status || 'Ativo';
        novo.estoqueAtual = payload.estoqueAtual || 0;
        novo.criadoEm = new Date().toISOString();
        novo.criadoPor = (sessao && sessao.usuario) ? sessao.usuario.nome : (payload.criadoPor || 'sistema');
        novo.atualizadoEm = novo.criadoEm;

        aba.appendRow(AP_ITENS_CFG.colunas.map(function (c) { return novo[c]; }));
        AP_ITENS_invalidar_();
        return { ok: true, dados: novo, criado: true };
      }

      case 'buscarSemelhante': {
        var candidatos = AP_ITENS_todos_().map(function (i) {
          return { item: i, semelhanca: AP_ITENS_semelhanca_(payload.descricao, i.descricao) };
        }).filter(function (c) { return c.semelhanca >= 0.5; })
          .sort(function (a, b) { return b.semelhanca - a.semelhanca; });

        /* código de barras ou SKU idênticos valem mais que a descrição */
        var exato = AP_ITENS_todos_().filter(function (i) {
          return (payload.codigoBarras && String(i.codigoBarras) === String(payload.codigoBarras)) ||
            (payload.sku && String(i.sku) === String(payload.sku));
        })[0];

        return {
          ok: true,
          dados: {
            exato: exato || null,
            semelhantes: candidatos.slice(0, 3).map(function (c) {
              return { item: c.item, semelhanca: Math.round(c.semelhanca * 100) };
            })
          }
        };
      }

      case 'excluir': {
        if (!sessao) return { ok: false, codigo: 'SEM_SESSAO', mensagem: 'Operação exige autenticação.' };
        var aba2 = AP_ITENS_aba_(AP_ITENS_CFG.abaItens, AP_ITENS_CFG.colunas);
        var alvo2 = AP_ITENS_todos_().filter(function (i) { return String(i.sku) === String(payload.sku); })[0];
        if (!alvo2) return { ok: false, codigo: 'ITEM_NAO_ENCONTRADO', mensagem: 'Item não localizado.' };
        if (Number(alvo2.estoqueAtual) > 0) {
          return { ok: false, codigo: 'ITEM_COM_SALDO', mensagem: 'Item com saldo em estoque não pode ser excluído. Inative-o.' };
        }
        aba2.deleteRow(alvo2._linha);
        AP_ITENS_invalidar_();
        return { ok: true, dados: { sku: payload.sku, excluido: true } };
      }

      case 'contar': {
        var t2 = AP_ITENS_todos_();
        return {
          ok: true,
          dados: {
            total: t2.length,
            ativos: t2.filter(function (i) { return i.status === 'Ativo'; }).length,
            valorEstoque: t2.reduce(function (s, i) {
              return s + (Number(i.estoqueAtual) || 0) * (Number(i.valorUnitario) || 0);
            }, 0)
          }
        };
      }

      default:
        return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'itens.' + acao + ' não existe neste módulo.' };
    }
  } catch (e) {
    return {
      ok: false, codigo: 'MODULO_ERRO', modulo: 'itens', acao: acao,
      etapa: 'gravação/leitura da planilha', mensagem: e.message
    };
  }
}

/* ------------------------------------------------------------
   MÓDULO FORNECEDORES
   ------------------------------------------------------------ */
function AP_FORNEC_limparCnpj_(cnpj) {
  return String(cnpj || '').replace(/\D/g, '');
}

function AP_Modulo_fornecedores(acao, payload, sessao) {
  payload = payload || {};
  var aba = AP_ITENS_aba_(AP_ITENS_CFG.abaFornecedores, AP_ITENS_CFG.colunasFornecedor);

  try {
    switch (acao) {

      case 'listar':
        return { ok: true, dados: AP_ITENS_ler_(aba, AP_ITENS_CFG.colunasFornecedor) };

      case 'porCnpj': {
        var alvo = AP_ITENS_ler_(aba, AP_ITENS_CFG.colunasFornecedor).filter(function (f) {
          return AP_FORNEC_limparCnpj_(f.cnpj) === AP_FORNEC_limparCnpj_(payload.cnpj);
        })[0];
        return alvo
          ? { ok: true, dados: alvo, cadastrado: true }
          : {
            ok: true, dados: null, cadastrado: false,
            mensagem: 'Fornecedor não cadastrado.', cnpj: payload.cnpj
          };
      }

      case 'salvar': {
        if (!payload.razaoSocial || !payload.cnpj) {
          return { ok: false, codigo: 'CAMPO_OBRIGATORIO', mensagem: 'Razão social e CNPJ são obrigatórios.' };
        }
        var todos = AP_ITENS_ler_(aba, AP_ITENS_CFG.colunasFornecedor);
        var dup = todos.filter(function (f) {
          return AP_FORNEC_limparCnpj_(f.cnpj) === AP_FORNEC_limparCnpj_(payload.cnpj);
        })[0];
        if (dup && !payload.editando) {
          return { ok: false, codigo: 'FORNECEDOR_DUPLICADO', mensagem: 'Já existe fornecedor com este CNPJ.', itemExistente: dup };
        }
        var novo = {
          id: payload.id || ('F' + String(todos.length + 1).padStart(3, '0')),
          razaoSocial: payload.razaoSocial, nomeFantasia: payload.nomeFantasia || '',
          cnpj: payload.cnpj, email: payload.email || '', telefone: payload.telefone || '',
          contato: payload.contato || '', categoria: payload.categoria || '',
          prazoEntrega: payload.prazoEntrega || '', status: payload.status || 'Ativo',
          criadoEm: new Date().toISOString()
        };
        if (dup && payload.editando) {
          aba.getRange(dup._linha, 1, 1, AP_ITENS_CFG.colunasFornecedor.length)
            .setValues([AP_ITENS_CFG.colunasFornecedor.map(function (c) { return novo[c]; })]);
          return { ok: true, dados: novo, atualizado: true };
        }
        aba.appendRow(AP_ITENS_CFG.colunasFornecedor.map(function (c) { return novo[c]; }));
        return { ok: true, dados: novo, criado: true };
      }

      default:
        return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'fornecedores.' + acao + ' não existe.' };
    }
  } catch (e) {
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'fornecedores', acao: acao, mensagem: e.message };
  }
}

/* ------------------------------------------------------------
   MÓDULO CONFIG — parâmetros do sistema, incluindo SKU
   ------------------------------------------------------------ */
function AP_Modulo_config(acao, payload, sessao) {
  payload = payload || {};
  try {
    switch (acao) {
      case 'obter':
        return { ok: true, dados: payload.chave === 'sku' ? AP_ITENS_configSku_() : AP_CONFIG_ler_(payload.chave) };
      case 'salvar':
        if (!sessao && payload.chave !== 'sku') {
          return { ok: false, codigo: 'SEM_SESSAO', mensagem: 'Alterar configuração exige autenticação.' };
        }
        return { ok: true, dados: AP_CONFIG_gravar_(payload.chave, payload.valor) };
      default:
        return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'config.' + acao + ' não existe.' };
    }
  } catch (e) {
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'config', acao: acao, mensagem: e.message };
  }
}

/* ------------------------------------------------------------
   TESTES
   ------------------------------------------------------------ */
function testeModuloItens() {
  var log = [];
  function reg(t, ok, d) { log.push((ok ? 'OK    ' : 'ERRO  ') + t + (d ? ' — ' + d : '')); }

  try {
    var vazio = AP_Modulo_itens('salvar', {});
    reg('exige descrição', vazio.ok === false, vazio.codigo);

    var a = AP_Modulo_itens('salvar', { descricao: 'Furadeira de Impacto 850W', categoria: 'Ferramentas', unidade: 'un' });
    reg('cria item com SKU automático', a.ok && !!a.dados.sku, a.ok ? a.dados.sku : a.mensagem);
    reg('gera código de barras', a.ok && String(a.dados.codigoBarras).length === 13, a.ok ? a.dados.codigoBarras : '');

    var b = AP_Modulo_itens('salvar', { descricao: 'Trena de Fibra 30m', categoria: 'Ferramentas', unidade: 'un' });
    reg('SKU sequencial e diferente', b.ok && b.dados.sku !== a.dados.sku, b.ok ? b.dados.sku : b.mensagem);

    var c = AP_Modulo_itens('salvar', { descricao: 'Furadeira de Impacto 850W', categoria: 'Ferramentas' });
    reg('avisa item semelhante em vez de duplicar', c.ok === false && c.codigo === 'ITEM_SEMELHANTE', c.mensagem);

    var d = AP_Modulo_itens('salvar', { descricao: 'Item com SKU manual', sku: a.dados.sku });
    reg('recusa SKU duplicado', d.ok === false && d.codigo === 'SKU_DUPLICADO', d.codigo);

    var e2 = AP_Modulo_itens('verificarSku', { sku: 'ALM-XXX-999999' });
    reg('verifica SKU livre', e2.ok && e2.dados.disponivel === true, '');

    var f = AP_Modulo_itens('buscarSemelhante', { descricao: 'Furadeira impacto 850 W' });
    reg('encontra semelhante para a NF', f.ok && f.dados.semelhantes.length > 0,
      f.ok && f.dados.semelhantes[0] ? f.dados.semelhantes[0].semelhanca + '%' : '');

    var g = AP_Modulo_fornecedores('porCnpj', { cnpj: '12.345.678/0001-90' });
    reg('fornecedor inexistente é declarado', g.ok && g.cadastrado === false, g.mensagem);

    var h = AP_Modulo_fornecedores('salvar', { razaoSocial: 'HidroSul Materiais', cnpj: '12.345.678/0001-90' });
    reg('cadastra fornecedor', h.ok, h.ok ? h.dados.id : h.mensagem);

    var i2 = AP_Modulo_fornecedores('porCnpj', { cnpj: '12345678000190' });
    reg('acha fornecedor por CNPJ sem máscara', i2.cadastrado === true, '');

  } catch (err) {
    log.push('ERRO  exceção: ' + err.message);
  }

  Logger.log(log.join('\n'));
  return log;
}
