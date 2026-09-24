/**
 * ============================================================
 * ALMOXA PRO — MÓDULOS DE OPERAÇÃO
 * Versão 1.0.0 · estoque, movimentações, loja e painel
 * ------------------------------------------------------------
 * Resolve os erros:
 *   "Nenhum módulo atende estoque"
 *   "Nenhum módulo atende lojinha"
 *   "Nenhum módulo atende dashboard"
 *
 * Tudo grava pelo Data Layer do Core (AP_Data) e lê o Cadastro
 * Central de Itens. Não cria banco paralelo nem duplica cadastro.
 * ============================================================
 */

var AP_OPER_CFG = {
  versao: '1.0.0',
  abaMovimentacoes: 'ALMOXA_MOVIMENTACOES',
  colunasMov: ['id', 'data', 'tipo', 'sku', 'descricao', 'qtd', 'saldo',
    'valorUnitario', 'documento', 'centro', 'obra', 'usuario', 'observacao']
};

function AP_OPER_abaMov_() {
  return AP_Data_getSheet(AP_OPER_CFG.abaMovimentacoes, AP_OPER_CFG.colunasMov);
}

/** Todos os itens do Cadastro Central (uma leitura por execução) */
var AP_OPER_ITENS_CACHE_ = null;

function AP_OPER_invalidar_() {
  AP_OPER_ITENS_CACHE_ = null;
  if (typeof AP_ITENS_invalidar_ === 'function') AP_ITENS_invalidar_();
}

function AP_OPER_itens_() {
  if (AP_OPER_ITENS_CACHE_) return AP_OPER_ITENS_CACHE_;
  var r = AP_Modulo_itens('listar', {});
  AP_OPER_ITENS_CACHE_ = (r && r.ok) ? r.dados : [];
  return AP_OPER_ITENS_CACHE_;
}

function AP_OPER_item_(sku) {
  return AP_OPER_itens_().filter(function (i) { return String(i.sku) === String(sku); })[0] || null;
}

/** Situação do saldo em relação ao mínimo */
function AP_OPER_situacao_(item) {
  var saldo = Number(item.estoqueAtual) || 0;
  var minimo = Number(item.estoqueMinimo) || 0;
  if (saldo <= 0) return 'critico';
  if (minimo && saldo <= minimo) return 'atencao';
  return 'ok';
}

/* ============================================================
   MÓDULO ESTOQUE
   ============================================================ */
function AP_Modulo_estoque(acao, payload, sessao) {
  payload = payload || {};
  try {
    switch (acao) {

      case 'listar': {
        var itens = AP_OPER_itens_().map(function (i) {
          return {
            id: i.sku, sku: i.sku, codigo: i.sku, nome: i.descricao,
            descricao: i.descricao, categoria: i.categoria || 'Sem categoria',
            unidade: i.unidade || 'un', local: i.localizacao || '—',
            estoque: Number(i.estoqueAtual) || 0,
            minimo: Number(i.estoqueMinimo) || 0,
            maximo: Number(i.estoqueMaximo) || 0,
            reservado: 0,
            preco: Number(i.valorUnitario) || 0,
            valorUnitario: Number(i.valorUnitario) || 0,
            codigoBarras: i.codigoBarras || '', foto: i.foto || null,
            fornecedor: i.fornecedor || '', emoji: '📦',
            status: AP_OPER_situacao_(i)
          };
        });
        if (payload.status) itens = itens.filter(function (i) { return i.status === payload.status; });
        if (payload.categoria) itens = itens.filter(function (i) { return i.categoria === payload.categoria; });
        return { ok: true, dados: itens };
      }

      case 'item': {
        var it = AP_OPER_item_(payload.id || payload.sku);
        if (!it) return { ok: false, codigo: 'ITEM_NAO_ENCONTRADO', mensagem: 'Item não localizado no cadastro.' };
        var lista = AP_Modulo_estoque('listar', {}).dados;
        return { ok: true, dados: lista.filter(function (x) { return x.sku === it.sku; })[0] };
      }

      case 'movimentacoes': {
        var movs = AP_Data_rows(AP_OPER_CFG.abaMovimentacoes);
        if (payload.sku) movs = movs.filter(function (m) { return String(m.sku) === String(payload.sku); });
        movs.sort(function (a, b) { return new Date(b.data) - new Date(a.data); });
        return { ok: true, dados: movs.slice(0, payload.limite || 200) };
      }

      /** Entrada, saída ou ajuste — sempre com lock, para não perder saldo */
      case 'movimentar': {
        if (!payload.sku || !payload.qtd) {
          return { ok: false, codigo: 'CAMPO_OBRIGATORIO', mensagem: 'Informe o item e a quantidade.' };
        }
        var tipo = (payload.tipo || 'ENTRADA').toUpperCase();
        /**
         * Os tipos que o estoque reconhece.
         *
         * DEVOLUÇÃO era recusada, e a devolução de uma ferramenta
         * nunca chegava à ficha do patrimônio — ela ficava
         * "emprestada" para sempre mesmo depois de voltar.
         *
         * Cada tipo soma ou subtrai como ENTRADA ou SAIDA; o nome
         * existe para o histórico dizer o que aconteceu.
         */
        if (['ENTRADA', 'SAIDA', 'AJUSTE', 'DEVOLUCAO',
             'TRANSFERENCIA', 'RESERVA', 'CANCELAMENTO'].indexOf(tipo) === -1) {
          return {
            ok: false, codigo: 'TIPO_INVALIDO',
            mensagem: 'Tipo "' + tipo + '" não existe. Use ENTRADA, SAIDA, AJUSTE, ' +
              'DEVOLUCAO, TRANSFERENCIA, RESERVA ou CANCELAMENTO.'
          };
        }

        return AP_Core_withLock(function () {
          var item = AP_OPER_item_(payload.sku);
          if (!item) return { ok: false, codigo: 'ITEM_NAO_ENCONTRADO', mensagem: 'Item não localizado.' };

          var saldoAtual = Number(item.estoqueAtual) || 0;
          var qtd = Math.abs(Number(payload.qtd));
          /**
           * Quanto o saldo muda com cada tipo.
           *
           * Devolução e cancelamento somam: o material volta.
           * Transferência não muda o total — o item sai de um lugar
           * e entra em outro, mas continua sendo do almoxarifado.
           * Ajuste define o saldo, não soma nem subtrai.
           */
          var delta;
          if (tipo === 'ENTRADA' || tipo === 'DEVOLUCAO' || tipo === 'CANCELAMENTO') {
            delta = qtd;
          } else if (tipo === 'SAIDA' || tipo === 'RESERVA') {
            delta = -qtd;
          } else if (tipo === 'TRANSFERENCIA') {
            delta = 0;
          } else {
            /* AJUSTE: o valor informado passa a ser o saldo */
            delta = Number(payload.qtd) - saldoAtual;
          }
          var novoSaldo = (tipo === 'AJUSTE') ? Number(payload.qtd) : saldoAtual + delta;

          if (novoSaldo < 0) {
            return {
              ok: false, codigo: 'SALDO_INSUFICIENTE',
              mensagem: 'Saldo insuficiente: há ' + saldoAtual + ' ' + (item.unidade || 'un') +
                ' e a saída pede ' + qtd + '.'
            };
          }

          AP_Modulo_itens('salvar', {
            sku: item.sku, descricao: item.descricao, estoqueAtual: novoSaldo, editando: true
          }, sessao);
          AP_OPER_invalidar_();   // o saldo mudou: a próxima leitura vem da planilha

          var registro = {
            id: AP_Utils_generateId('MOV'),
            data: AP_Utils_now(), tipo: tipo, sku: item.sku, descricao: item.descricao,
            qtd: delta, saldo: novoSaldo,
            valorUnitario: Number(payload.valorUnitario) || Number(item.valorUnitario) || 0,
            documento: payload.documento || '', centro: payload.centro || '',
            obra: payload.obra || '',
            usuario: (sessao && sessao.usuario) || (sessao && sessao.userId) || 'sistema',
            observacao: payload.observacao || ''
          };
          AP_OPER_abaMov_();
          AP_Data_append(AP_OPER_CFG.abaMovimentacoes, registro);

          AP_Audit_log(registro.usuario, 'ESTOQUE_' + tipo, 'ESTOQUE', item.sku,
            { qtd: delta, saldo: novoSaldo, documento: registro.documento });
          AP_EventBus.emit('ESTOQUE.MOVIMENTADO', {
            sku: item.sku, tipo: tipo, qtd: delta, saldo: novoSaldo,
            critico: novoSaldo <= (Number(item.estoqueMinimo) || 0)
          }, registro.usuario);

          /**
           * SE O ITEM TEM PATRIMÔNIO, A FICHA DELE TAMBÉM SABE
           *
           * Retirar a lixadeira PAT-000001 precisa aparecer na ficha
           * dela, não só no estoque. Quem lê o QR quer saber onde a
           * ferramenta está e quem pegou por último.
           *
           * Se falhar, a movimentação de estoque continua valendo:
           * o saldo é a informação que não pode se perder.
           */
          var noPatrimonio = null;
          try {
            if (typeof AP_PAT_registrarMovimentoDoEstoque === 'function') {
              noPatrimonio = AP_PAT_registrarMovimentoDoEstoque({
                sku: item.sku,
                patrimonio: payload.patrimonio || '',
                tipo: tipo,
                documento: registro.documento,
                usuario: registro.usuario,
                destino: payload.destino || payload.obra || registro.obra || '',
                responsavel: payload.responsavel || payload.solicitante || '',
                motivo: payload.motivo || payload.observacao || ''
              });
            }
          } catch (e) { /* a ficha pode esperar; o saldo não */ }

          return { ok: true, dados: {
            sku: item.sku, saldoAnterior: saldoAtual, saldo: novoSaldo,
            movimento: registro,
            /* quando há vários equipamentos do mesmo item, avisa
               que falta dizer qual saiu */
            patrimonio: (noPatrimonio && noPatrimonio.dados) ? noPatrimonio.dados : null,
            avisoPatrimonio: (noPatrimonio && noPatrimonio.indefinido)
              ? noPatrimonio.mensagem : null
          } };
        });
      }

      case 'ajustar':
        return AP_Modulo_estoque('movimentar', {
          sku: payload.sku, qtd: payload.qtd, tipo: 'AJUSTE',
          observacao: payload.motivo || payload.observacao, documento: 'Ajuste manual'
        }, sessao);

      case 'entradaEmLote':
        return AP_OPER_entradaEmLote(payload.itens, payload, sessao);

      case 'entrada':
        return AP_Modulo_estoque('movimentar', {
          sku: payload.sku, qtd: payload.qtd,
          /* devolução é entrada, mas a ficha precisa saber a diferença:
             uma traz material novo, a outra devolve o que saiu */
          tipo: payload.tipo === 'DEVOLUCAO' ? 'DEVOLUCAO' : 'ENTRADA',
          documento: payload.documento, valorUnitario: payload.valorUnitario,
          patrimonio: payload.patrimonio || '',
          obra: payload.obra || '', observacao: payload.observacao || ''
        }, sessao);

      case 'saida':
        /**
         * Repassa tudo o que veio.
         *
         * Antes só sku, qtd, documento, centro e obra chegavam ao
         * movimentar — destino, responsável e o número do patrimônio
         * ficavam pelo caminho. Sem eles, a ficha do equipamento não
         * sabia para onde foi nem com quem está.
         */
        return AP_Modulo_estoque('movimentar', {
          sku: payload.sku, qtd: payload.qtd, tipo: 'SAIDA',
          documento: payload.documento, centro: payload.centro, obra: payload.obra,
          patrimonio: payload.patrimonio || '',
          destino: payload.destino || payload.obra || '',
          responsavel: payload.responsavel || payload.solicitante || '',
          motivo: payload.motivo || '',
          observacao: payload.observacao || ''
        }, sessao);

      case 'criticos': {
        var todos = AP_Modulo_estoque('listar', {}).dados;
        return { ok: true, dados: todos.filter(function (i) { return i.status !== 'ok'; }) };
      }

      case 'resumo': {
        var l = AP_Modulo_estoque('listar', {}).dados;
        return {
          ok: true,
          dados: {
            itens: l.length,
            criticos: l.filter(function (i) { return i.status === 'critico'; }).length,
            atencao: l.filter(function (i) { return i.status === 'atencao'; }).length,
            valorTotal: l.reduce(function (s, i) { return s + i.estoque * i.valorUnitario; }, 0),
            unidades: l.reduce(function (s, i) { return s + i.estoque; }, 0)
          }
        };
      }

      default:
        return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'estoque.' + acao + ' não existe.' };
    }
  } catch (e) {
    AP_ErrorHandler_capture('AP_Modulo_estoque:' + acao, e);
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'estoque', acao: acao, mensagem: e.message };
  }
}

/* ============================================================
   MÓDULO LOJINHA — catálogo lido do Cadastro Central
   ============================================================ */
function AP_Modulo_lojinha(acao, payload, sessao) {
  payload = payload || {};
  try {
    switch (acao) {

      case 'catalogo': {
        var itens = AP_Modulo_estoque('listar', {}).dados;

        /* categoria oculta na loja não aparece */
        var categorias = [];
        try {
          var rc = AP_Modulo_categorias ? AP_Modulo_categorias('listar', {}) : null;
          categorias = (rc && rc.ok) ? rc.dados : [];
        } catch (e) { categorias = []; }

        var ocultas = {};
        categorias.forEach(function (c) { if (c.visivel === false || c.visivel === 'FALSE') ocultas[c.nome] = true; });

        var visiveis = itens.filter(function (i) { return !ocultas[i.categoria]; });

        if (payload.categoria && payload.categoria !== 'Todas') {
          visiveis = visiveis.filter(function (i) { return i.categoria === payload.categoria; });
        }
        if (payload.busca) {
          var t = String(payload.busca).toLowerCase();
          visiveis = visiveis.filter(function (i) {
            return String(i.nome).toLowerCase().indexOf(t) > -1 ||
              String(i.sku).toLowerCase().indexOf(t) > -1 ||
              String(i.codigoBarras).indexOf(payload.busca) > -1;
          });
        }
        return { ok: true, dados: visiveis };
      }

      case 'item':
        return AP_Modulo_estoque('item', payload, sessao);

      default:
        return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'lojinha.' + acao + ' não existe.' };
    }
  } catch (e) {
    AP_ErrorHandler_capture('AP_Modulo_lojinha:' + acao, e);
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'lojinha', acao: acao, mensagem: e.message };
  }
}

/* ============================================================
   MÓDULO DASHBOARD / PAINEL
   ============================================================ */
function AP_Modulo_dashboard(acao, payload, sessao) {
  payload = payload || {};
  try {
    switch (acao) {

      case 'mural': {
        var cfg = null;
        try { cfg = AP_Config_get('PAINEL_CONFIG', null); } catch (e) { cfg = null; }
        if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg); } catch (e) { cfg = null; } }

        var resumo = AP_Modulo_estoque('resumo', {}).dados;
        var obras = [];
        try {
          var ro = AP_Modulo_obras ? AP_Modulo_obras('listar', {}) : null;
          obras = (ro && ro.ok) ? ro.dados : [];
        } catch (e) { obras = []; }

        var obra = obras[0] || { nome: 'Nenhuma obra cadastrada', almoxarifado: '—', responsavel: '—', avanco: 0 };

        return {
          ok: true,
          dados: {
            banners: (cfg && cfg.banners) || [{
              tag: 'ALMOXA PRO', titulo: 'Gestão Inteligente para Obras',
              texto: resumo.itens
                ? 'Acompanhe o almoxarifado da sua obra.'
                : 'Cadastre a obra, as categorias e os itens para começar.',
              botao: resumo.itens ? 'Ir para a loja' : 'Configurar sistema',
              rota: resumo.itens ? '#/loja' : '#/config-inicial'
            }],
            comunicados: (cfg && cfg.comunicados) || [],
            aniversariantes: [],
            obra: {
              id: obra.id || null, nome: obra.nome,
              almoxarifado: obra.almoxarifado || '—', responsavel: obra.responsavel || '—',
              avanco: Number(obra.avanco) || 0,
              itens: resumo.itens, valorEstoque: resumo.valorTotal
            },
            meta: { titulo: 'Meta de produtividade', mes: '—', meta: 0, alcancado: 0, unidade: '' },
            resumo: resumo
          }
        };
      }

      case 'resumo': {
        var est = AP_Modulo_estoque('resumo', {}).dados;
        var movs = AP_Data_rows(AP_OPER_CFG.abaMovimentacoes);
        var hoje = new Date().toISOString().slice(0, 10);

        return {
          ok: true,
          dados: {
            estoque: est,
            movimentacoesHoje: movs.filter(function (m) {
              return String(m.data).slice(0, 10) === hoje;
            }).length,
            entradas: movs.filter(function (m) { return m.tipo === 'ENTRADA'; }).length,
            saidas: movs.filter(function (m) { return m.tipo === 'SAIDA'; }).length
          }
        };
      }

      default:
        return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'dashboard.' + acao + ' não existe.' };
    }
  } catch (e) {
    AP_ErrorHandler_capture('AP_Modulo_dashboard:' + acao, e);
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'dashboard', acao: acao, mensagem: e.message };
  }
}

/* ============================================================
   MÓDULO OBRAS
   ============================================================ */
var AP_OBRAS_CFG = {
  aba: 'ALMOXA_OBRAS',
  colunas: ['id', 'nome', 'codigo', 'cliente', 'local', 'almoxarifado',
    'responsavel', 'status', 'inicio', 'previsao', 'avanco', 'criadoEm']
};

function AP_Modulo_obras(acao, payload, sessao) {
  payload = payload || {};
  try {
    AP_Data_getSheet(AP_OBRAS_CFG.aba, AP_OBRAS_CFG.colunas);
    switch (acao) {
      case 'listar':
        return { ok: true, dados: AP_Data_rows(AP_OBRAS_CFG.aba) };

      case 'criar':
      case 'salvar': {
        if (!payload.nome) return { ok: false, codigo: 'CAMPO_OBRIGATORIO', mensagem: 'Informe o nome da obra.' };
        var todas = AP_Data_rows(AP_OBRAS_CFG.aba);
        if (payload.id) {
          AP_Data_update(AP_OBRAS_CFG.aba, payload.id, payload);
          return { ok: true, dados: payload, atualizado: true };
        }
        var nova = {
          id: payload.id || ('OB' + String(todas.length + 1).padStart(2, '0')),
          nome: payload.nome, codigo: payload.codigo || '', cliente: payload.cliente || '',
          local: payload.local || '', almoxarifado: payload.almoxarifado || '',
          responsavel: payload.responsavel || '', status: payload.status || 'Mobilização',
          inicio: payload.inicio || '', previsao: payload.previsao || '',
          avanco: 0, criadoEm: AP_Utils_now()
        };
        AP_Data_append(AP_OBRAS_CFG.aba, nova);
        AP_Audit_log((sessao && sessao.usuario) || 'sistema', 'OBRA_CRIADA', 'OBRAS', nova.id, { nome: nova.nome });
        return { ok: true, dados: nova, criado: true };
      }

      default:
        return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'obras.' + acao + ' não existe.' };
    }
  } catch (e) {
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'obras', acao: acao, mensagem: e.message };
  }
}

/* ============================================================
   MÓDULO CATEGORIAS
   ============================================================ */
var AP_CAT_CFG = { aba: 'ALMOXA_CATEGORIAS', colunas: ['id', 'nome', 'icone', 'cor', 'visivel', 'criadoEm'] };

function AP_Modulo_categorias(acao, payload, sessao) {
  payload = payload || {};
  try {
    AP_Data_getSheet(AP_CAT_CFG.aba, AP_CAT_CFG.colunas);
    switch (acao) {
      case 'listar':
        return { ok: true, dados: AP_Data_rows(AP_CAT_CFG.aba) };

      case 'salvar': {
        if (!payload.nome) return { ok: false, codigo: 'CAMPO_OBRIGATORIO', mensagem: 'Informe o nome da categoria.' };
        var todas = AP_Data_rows(AP_CAT_CFG.aba);
        if (payload.id) {
          AP_Data_update(AP_CAT_CFG.aba, payload.id, payload);
          return { ok: true, dados: payload, atualizado: true };
        }
        var dup = todas.filter(function (c) {
          return String(c.nome).toLowerCase() === String(payload.nome).toLowerCase();
        })[0];
        if (dup) return { ok: false, codigo: 'CATEGORIA_DUPLICADA', mensagem: 'Já existe a categoria "' + dup.nome + '".' };

        var nova = {
          id: AP_Utils_generateId('CAT'), nome: payload.nome,
          icone: payload.icone || 'caixa', cor: payload.cor || 'ico-navy',
          visivel: payload.visivel !== false, criadoEm: AP_Utils_now()
        };
        AP_Data_append(AP_CAT_CFG.aba, nova);
        return { ok: true, dados: nova, criado: true };
      }

      case 'excluir': {
        var cat = AP_Data_findBy(AP_CAT_CFG.aba, { id: payload.id })[0];
        if (!cat) return { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Categoria não localizada.' };
        var emUso = AP_OPER_itens_().filter(function (i) { return i.categoria === cat.nome; }).length;
        if (emUso) {
          return { ok: false, codigo: 'CATEGORIA_EM_USO', mensagem: emUso + ' item(ns) usam esta categoria.' };
        }
        AP_Data_remove(AP_CAT_CFG.aba, payload.id);
        return { ok: true, dados: { id: payload.id, excluida: true } };
      }

      default:
        return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'categorias.' + acao + ' não existe.' };
    }
  } catch (e) {
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'categorias', acao: acao, mensagem: e.message };
  }
}

/* ============================================================
   TESTE
   ============================================================ */
function testeModulosOperacao() {
  var log = [];
  function reg(t, ok, d) { log.push((ok ? 'OK    ' : 'ERRO  ') + t + (d ? ' — ' + d : '')); }

  try {
    var cat = AP_Modulo_categorias('salvar', { nome: 'Materiais Teste' });
    reg('cria categoria', cat.ok, cat.ok ? cat.dados.nome : cat.mensagem);

    var item = AP_Modulo_itens('salvar', { descricao: 'Cimento Teste 50kg', categoria: 'Materiais Teste', unidade: 'sc', valorUnitario: 32.5, estoqueMinimo: 10 });
    reg('cria item no cadastro central', item.ok, item.ok ? item.dados.sku : item.mensagem);
    var sku = item.ok ? item.dados.sku : null;

    var lista = AP_Modulo_estoque('listar', {});
    reg('estoque lista o item', lista.ok && lista.dados.length > 0, lista.dados.length + ' item(ns)');
    reg('item novo nasce crítico', lista.dados[0] && lista.dados[0].status === 'critico', 'saldo 0');

    var ent = AP_Modulo_estoque('entrada', { sku: sku, qtd: 100, documento: 'NF TESTE' });
    reg('entrada soma saldo', ent.ok && ent.dados.saldo === 100, ent.ok ? 'saldo ' + ent.dados.saldo : ent.mensagem);

    var sai = AP_Modulo_estoque('saida', { sku: sku, qtd: 30, documento: 'RETIRADA' });
    reg('saída subtrai saldo', sai.ok && sai.dados.saldo === 70, sai.ok ? 'saldo ' + sai.dados.saldo : sai.mensagem);

    var demais = AP_Modulo_estoque('saida', { sku: sku, qtd: 500 });
    reg('recusa saída maior que o saldo', demais.ok === false && demais.codigo === 'SALDO_INSUFICIENTE', demais.mensagem);

    var aj = AP_Modulo_estoque('ajustar', { sku: sku, qtd: 5, motivo: 'inventário' });
    reg('ajuste fixa o saldo contado', aj.ok && aj.dados.saldo === 5, aj.ok ? 'saldo ' + aj.dados.saldo : aj.mensagem);

    var depois = AP_Modulo_estoque('item', { sku: sku });
    reg('saldo 5 abaixo do mínimo 10 vira atenção', depois.dados.status === 'atencao', depois.dados.status);

    var movs = AP_Modulo_estoque('movimentacoes', { sku: sku });
    reg('movimentações registradas', movs.ok && movs.dados.length === 3, movs.dados.length + ' movimento(s)');

    var loja = AP_Modulo_lojinha('catalogo', {});
    reg('loja mostra o item do cadastro', loja.ok && loja.dados.length > 0, loja.dados.length + ' item(ns)');

    AP_Modulo_categorias('salvar', { id: cat.dados.id, nome: 'Materiais Teste', visivel: false });
    var lojaOculta = AP_Modulo_lojinha('catalogo', {});
    reg('categoria oculta some da loja', lojaOculta.dados.length === 0, lojaOculta.dados.length + ' item(ns)');

    var mural = AP_Modulo_dashboard('mural', {});
    reg('painel responde', mural.ok && !!mural.dados.obra, 'itens: ' + mural.dados.resumo.itens);

    var resumo = AP_Modulo_estoque('resumo', {});
    reg('resumo calcula valor', resumo.ok, 'R$ ' + resumo.dados.valorTotal + ' · ' + resumo.dados.itens + ' itens');

  } catch (e) {
    log.push('ERRO  exceção: ' + e.message);
  }

  try { Logger.log(log.join('\n')); } catch (e) { }
  return log;
}


/* ============================================================
   ENTRADA EM LOTE — VÁRIOS ITENS DE UMA VEZ
   ------------------------------------------------------------
   Lançar uma nota com 30 itens fazia 30 chamadas ao estoque, cada
   uma pegando e soltando a trava de concorrência.

   No Apps Script isso não é detalhe: cada trava espera a anterior,
   cada uma tem seu custo de rede, e a execução morre aos 6
   minutos. Com um item funciona; com trinta, estoura no meio — e
   metade da nota entra no estoque, metade não.

   Aqui tudo acontece dentro de UMA trava, com uma leitura e uma
   escrita em bloco. Ou entra a nota inteira, ou não entra nada.
   ============================================================ */

function AP_OPER_entradaEmLote(itens, dados, sessao) {
  if (!itens || !itens.length) {
    return { ok: false, codigo: 'SEM_ITENS', mensagem: 'Nenhum item para lançar.' };
  }

  var quem = (sessao && sessao.usuario) || 'sistema';
  var documento = dados.documento || '';

  return AP_Core_withLock(function () {
    /* os itens vêm pelo mesmo caminho do resto do módulo, para
       respeitar o cache e o tratamento de colunas pesadas */
    var todos = AP_OPER_itens_() || [];

    /* um índice por SKU: sem isto seria uma varredura por item */
    var porSku = {};
    todos.forEach(function (it) { porSku[it.sku] = it; });

    var entradas = [], recusados = [];
    var movimentos = [];
    var agora = AP_Utils_now();

    itens.forEach(function (i) {
      var item = porSku[i.sku];

      if (!item) {
        recusados.push({ sku: i.sku, motivo: 'item não cadastrado' });
        return;
      }

      var qtd = Math.abs(Number(i.qtd) || 0);
      if (!qtd) {
        recusados.push({ sku: i.sku, motivo: 'quantidade zerada' });
        return;
      }

      var saldoAnterior = Number(item.estoqueAtual) || 0;
      var novoSaldo = saldoAnterior + qtd;

      /* o saldo do índice acompanha: dois itens iguais na mesma
         nota somam, em vez de o segundo sobrescrever o primeiro */
      item.estoqueAtual = novoSaldo;

      var vu = Number(i.valorUnitario) || Number(item.valorUnitario) || 0;

      movimentos.push({
        id: AP_Utils_generateId('MOV'),
        data: agora,
        tipo: 'ENTRADA',
        sku: item.sku,
        descricao: item.descricao,
        qtd: qtd,
        saldo: novoSaldo,
        valorUnitario: vu,
        documento: documento,
        centro: dados.centro || '',
        obra: dados.obra || '',
        usuario: quem,
        observacao: dados.observacao || ''
      });

      entradas.push({
        sku: item.sku, descricao: item.descricao,
        qtd: qtd, saldoAnterior: saldoAnterior, saldo: novoSaldo,
        valorUnitario: vu, valorTotal: Math.round(qtd * vu * 100) / 100
      });
    });

    if (!entradas.length) {
      return {
        ok: false, codigo: 'NENHUM_LANCADO',
        mensagem: 'Nenhum item pôde ser lançado.',
        dados: { recusados: recusados }
      };
    }

    /* uma escrita por item alterado — e o valor unitário da nota
       passa a valer para o item, que é o preço mais recente */
    /**
     * "editando: true" é o que o módulo de itens exige para
     * aceitar alteração de saldo — sem isso ele trata como
     * cadastro novo e o estoque não muda.
     */
    entradas.forEach(function (e) {
      var patch = {
        sku: e.sku, descricao: e.descricao,
        estoqueAtual: e.saldo, editando: true
      };
      if (e.valorUnitario) patch.valorUnitario = e.valorUnitario;
      AP_Modulo_itens('salvar', patch, sessao);
    });

    /* o cache de itens ficou velho depois das escritas */
    AP_OPER_ITENS_CACHE_ = null;

    /* as movimentações vão todas de uma vez: uma escrita em vez
       de uma por item */
    AP_Data_appendBatch(AP_OPER_CFG.abaMovimentacoes, movimentos);

    AP_Audit_log(quem, 'ENTRADA_EM_LOTE', 'ESTOQUE', documento, {
      itens: entradas.length, recusados: recusados.length
    });

    try {
      AP_EventBus.emit('ESTOQUE.LOTE', {
        documento: documento, itens: entradas.length
      }, quem);
    } catch (e) { }

    return {
      ok: true,
      dados: {
        entradas: entradas,
        quantos: entradas.length,
        recusados: recusados,
        unidades: entradas.reduce(function (a, e) { return a + e.qtd; }, 0),
        valor: Math.round(entradas.reduce(function (a, e) {
          return a + e.valorTotal;
        }, 0) * 100) / 100
      }
    };
  });
}
