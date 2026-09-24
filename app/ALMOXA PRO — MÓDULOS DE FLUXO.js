/**
 * ============================================================
 * ALMOXA PRO — MÓDULOS DE FLUXO
 * Versão 1.0.0 · reservas, aprovações, notas, compras,
 *                 EPI, ferramentas, ocorrências, inventário,
 *                 projetos, relatórios, painel e mural
 * ------------------------------------------------------------
 * Completa os módulos que faltavam. Tudo grava pelo Data Layer
 * do Core (AP_Data), consulta o Cadastro Central de Itens e
 * movimenta estoque por AP_Modulo_estoque — sem banco paralelo.
 * ============================================================
 */

var AP_FLUXO_CFG = {
  versao: '1.0.0',
  abas: {
    reservas: 'ALMOXA_RESERVAS',
    notas: 'ALMOXA_NOTAS',
    nfItens: 'ALMOXA_NF_ITENS',
    compras: 'ALMOXA_COMPRAS',
    epi: 'ALMOXA_EPI_FICHAS',
    ferramentas: 'ALMOXA_FERRAMENTAS',
    ocorrencias: 'ALMOXA_OCORRENCIAS',
    inventarios: 'ALMOXA_INVENTARIOS',
    projetos: 'ALMOXA_PROJETOS',
    relatorios: 'ALMOXA_RELATORIOS',
    mural: 'ALMOXA_MURAL'
  },
  colunas: {
    reservas: ['protocolo', 'data', 'solicitante', 'matricula', 'obra', 'centro', 'projeto',
      'motivo', 'itens', 'valor', 'status', 'aprovadoPor', 'aprovadoEm',
      'retiradoPor', 'retiradoEm', 'observacao'],
    notas: ['numero', 'serie', 'chave', 'fornecedor', 'cnpj', 'emissao', 'entrada',
      'valor', 'itens', 'status', 'origem', 'arquivoId', 'lancadoPor', 'lancadoEm'],

    /**
     * OS ITENS DA NOTA, UM POR LINHA
     *
     * A coluna "itens" acima guarda o mesmo conteúdo em JSON, e
     * continua existindo para não quebrar as notas já lançadas.
     * Mas JSON dentro de célula não se consulta: não dá para
     * perguntar "o que veio na NF 12345", filtrar por SKU nem
     * somar por fornecedor.
     *
     * Aqui cada item é uma linha. A NF continua sendo uma só;
     * os itens ficam vinculados a ela pelo número.
     */
    nfItens: ['id', 'nf', 'serie', 'sku', 'codigo', 'descricao', 'ncm',
      'unidade', 'quantidade', 'valorUnitario', 'valorTotal',
      'fornecedor', 'cnpj', 'obra', 'lote', 'validade',
      'emissao', 'entrada', 'status', 'lancadoEm', 'lancadoPor', 'observacao'],
    compras: ['id', 'data', 'tipo', 'sku', 'descricao', 'qtd', 'valorEstimado',
      'fornecedor', 'status', 'previsao', 'origem', 'solicitante', 'aprovadoPor', 'historico'],
    epi: ['id', 'colaborador', 'matricula', 'cargo', 'setor', 'sku', 'item',
      'qtd', 'ca', 'entrega', 'validade', 'status', 'entreguePor', 'assinatura'],
    ferramentas: ['patrimonio', 'sku', 'nome', 'status', 'com', 'desde', 'obra', 'observacao'],
    ocorrencias: ['id', 'data', 'titulo', 'categoria', 'prioridade', 'obra', 'local',
      'responsavel', 'autor', 'status', 'descricao', 'materiais', 'protocoloNecessidade', 'historico'],
    inventarios: ['id', 'data', 'obra', 'responsavel', 'status', 'itens', 'divergencias', 'encerradoEm'],
    projetos: ['id', 'nome', 'obra', 'responsavel', 'status', 'progresso', 'inicio',
      'previsao', 'centro', 'descricao', 'materiais', 'observacoes'],
    relatorios: ['id', 'nome', 'tipo', 'data', 'formato', 'autor', 'parametros'],
    mural: ['id', 'titulo', 'categoria', 'data', 'obra', 'atividade', 'responsavel',
      'descricao', 'fotos', 'autor', 'criadoEm']
  }
};

function AP_FLUXO_aba_(chave) {
  return AP_Data_getSheet(AP_FLUXO_CFG.abas[chave], AP_FLUXO_CFG.colunas[chave]);
}

function AP_FLUXO_ler_(chave) {
  AP_FLUXO_aba_(chave);
  return AP_Data_rows(AP_FLUXO_CFG.abas[chave]);
}

function AP_FLUXO_json_(v, padrao) {
  if (!v) return padrao;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch (e) { return padrao; }
}

function AP_FLUXO_usuario_(sessao) {
  return (sessao && (sessao.usuario || sessao.userId)) ||
    (sessao && sessao.usuario && sessao.usuario.nome) || 'sistema';
}

/* ============================================================
   RESERVAS E APROVAÇÕES
   ============================================================ */
/**
 * Localiza a reserva pelo que a pessoa digitou.
 *
 * O protocolo é gravado como "#RES-000001", mas ninguém digita o "#".
 * Antes, "RES-000001" não achava nada e a tela dizia "Reserva não
 * localizada" — mesmo com a reserva existindo e aprovada.
 *
 * Aceita: #RES-000001, RES-000001, res-000001, 000001 e 1.
 */
function AP_FLUXO_acharReserva_(entrada) {
  var bruto = String(entrada || '').trim();
  if (!bruto) return null;

  var todas = AP_FLUXO_ler_('reservas');

  function limpar(v) {
    return String(v || '').trim().toUpperCase().replace(/^#/, '').replace(/\s+/g, '');
  }
  function soNumero(v) {
    var n = String(v || '').replace(/\D/g, '').replace(/^0+/, '');
    return n || '';
  }

  var alvo = limpar(bruto);

  /* 1) igual, com ou sem # */
  var achada = todas.filter(function (r) { return limpar(r.protocolo) === alvo; })[0];
  if (achada) return achada;

  /* 2) só o número: 000001, 1 */
  var num = soNumero(bruto);
  if (num) {
    achada = todas.filter(function (r) { return soNumero(r.protocolo) === num; })[0];
    if (achada) return achada;
  }

  /* 3) o número dentro do texto: "reserva 125" */
  if (num) {
    achada = todas.filter(function (r) {
      return String(r.protocolo || '').indexOf(num) > -1;
    })[0];
    if (achada) return achada;
  }

  return null;
}

function AP_Modulo_reservas(acao, payload, sessao) {
  payload = payload || {};
  try {
    switch (acao) {

      case 'listar': {
        var lista = AP_FLUXO_ler_('reservas').map(function (r) {
          r.itens = AP_FLUXO_json_(r.itens, []);
          return r;
        });
        if (payload.status) lista = lista.filter(function (r) { return r.status === payload.status; });
        return { ok: true, dados: lista };
      }

      case 'obter': {
        var alvo = AP_FLUXO_acharReserva_(payload.protocolo);
        if (!alvo) {
          return {
            ok: false, codigo: 'NAO_ENCONTRADA',
            mensagem: 'Reserva não localizada. O protocolo pode ser digitado com ou sem o "#".'
          };
        }
        alvo.itens = AP_FLUXO_json_(alvo.itens, []);
        return { ok: true, dados: alvo };
      }

      case 'criar': {
        var itens = payload.itens || [];
        if (!itens.length) return { ok: false, codigo: 'SEM_ITENS', mensagem: 'A reserva precisa de pelo menos um item.' };

        /* confere saldo antes de aceitar */
        var semSaldo = [];
        itens.forEach(function (i) {
          var e = AP_Modulo_estoque('item', { sku: i.sku || i.codigo });
          if (!e.ok) { semSaldo.push(i.nome || i.descricao + ' (não cadastrado)'); return; }
          if (e.dados.estoque < i.qtd) {
            semSaldo.push((i.nome || i.descricao) + ' — há ' + e.dados.estoque + ', pedido ' + i.qtd);
          }
        });

        var protocolo = '#RES-' + String(AP_FLUXO_ler_('reservas').length + 1).padStart(6, '0');
        var registro = {
          protocolo: protocolo, data: AP_Utils_now(),
          solicitante: payload.solicitante || AP_FLUXO_usuario_(sessao),
          matricula: payload.matricula || '', obra: payload.obra || '',
          centro: payload.centro || '', projeto: payload.projeto || '',
          motivo: payload.motivo || '', itens: JSON.stringify(itens),
          valor: itens.reduce(function (s, i) { return s + (i.qtd * (i.preco || i.valorUnitario || 0)); }, 0),
          status: 'PENDENTE_APROVACAO', aprovadoPor: '', aprovadoEm: '',
          retiradoPor: '', retiradoEm: '',
          observacao: semSaldo.length ? 'Sem saldo: ' + semSaldo.join(' | ') : ''
        };
        AP_FLUXO_aba_('reservas');
        AP_Data_append(AP_FLUXO_CFG.abas.reservas, registro);

        AP_Audit_log(registro.solicitante, 'RESERVA_CRIADA', 'RESERVAS', protocolo, { itens: itens.length });
        AP_EventBus.emit('RESERVA.CRIADA', { protocolo: protocolo, itens: itens.length }, registro.solicitante);

        return { ok: true, dados: { protocolo: protocolo, semSaldo: semSaldo, reserva: registro } };
      }

      case 'decidir': {
        var r2 = AP_FLUXO_acharReserva_(payload.protocolo);
        if (!r2) return { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Reserva não localizada.' };

        /* daqui para a frente usa o protocolo GRAVADO, não o digitado */
        payload.protocolo = r2.protocolo;

        var novoStatus = payload.decisao === 'APROVADA' ? 'APROVADA' : 'CANCELADA';
        AP_Data_update(AP_FLUXO_CFG.abas.reservas, payload.protocolo, {
          status: novoStatus, aprovadoPor: AP_FLUXO_usuario_(sessao), aprovadoEm: AP_Utils_now(),
          observacao: payload.observacao || r2.observacao
        }, 'protocolo');

        AP_Audit_log(AP_FLUXO_usuario_(sessao), 'RESERVA_' + novoStatus, 'RESERVAS', payload.protocolo, {});
        AP_EventBus.emit('RESERVA.' + novoStatus, { protocolo: payload.protocolo }, AP_FLUXO_usuario_(sessao));

        return { ok: true, dados: { protocolo: payload.protocolo, status: novoStatus } };
      }

      /** Retirada: é aqui que o estoque baixa de verdade */
      case 'retirar': {
        var r3 = AP_FLUXO_acharReserva_(payload.protocolo);
        if (!r3) {
          return {
            ok: false, codigo: 'NAO_ENCONTRADA',
            mensagem: 'Reserva não localizada. Confira o protocolo — pode ser digitado com ou sem o "#".'
          };
        }
        payload.protocolo = r3.protocolo;

        /* já retirada: dizer isso é mais útil que "não localizada" */
        if (r3.status === 'RETIRADA') {
          return {
            ok: false, codigo: 'JA_RETIRADA',
            mensagem: 'Esta reserva já foi retirada em ' +
              (r3.retiradoEm ? AP_Utils_formatDate(r3.retiradoEm) : 'data não registrada') +
              (r3.retiradoPor ? ' por ' + r3.retiradoPor : '') + '.'
          };
        }

        /* PARCIALMENTE_RETIRADA continua entregável: é justamente a
           reserva que ainda tem saldo para retirar depois */
        if (['APROVADA', 'DISPONIBILIZADA', 'PARCIALMENTE_RETIRADA'].indexOf(r3.status) === -1) {
          return {
            ok: false, codigo: 'RESERVA_NAO_APROVADA',
            mensagem: r3.status === 'PENDENTE_APROVACAO'
              ? 'Esta reserva ainda aguarda aprovação. Peça ao gestor para aprovar antes de entregar.'
              : 'Não é possível retirar. Situação atual: ' + r3.status
          };
        }

        var itensR = AP_FLUXO_json_(r3.itens, []);

        /**
         * Duas estações não podem retirar a mesma reserva ao mesmo tempo.
         *
         * A trava é usada só para MARCAR a reserva como em uso e é
         * liberada logo em seguida: o módulo de estoque tem a própria
         * trava, e segurar as duas ao mesmo tempo travava a baixa.
         *
         * Quem chegar depois encontra o estado EM_RETIRADA e é recusado.
         */
        var travaOk = false;
        try {
          var trava = LockService.getScriptLock();
          travaOk = trava.tryLock(15000);
          if (!travaOk) {
            return {
              ok: false, codigo: 'RESERVA_EM_USO',
              mensagem: 'Outra estação está retirando esta reserva agora. Aguarde alguns segundos.'
            };
          }

          /* relê dentro da trava: o estado pode ter mudado */
          r3 = AP_FLUXO_acharReserva_(payload.protocolo) || r3;
          itensR = AP_FLUXO_json_(r3.itens, []);

          if (r3.status === 'RETIRADA') {
            trava.releaseLock();
            return {
              ok: false, codigo: 'JA_RETIRADA',
              mensagem: 'Esta reserva acabou de ser entregue por outra estação.'
            };
          }
          if (r3.status === 'EM_RETIRADA') {
            trava.releaseLock();
            return {
              ok: false, codigo: 'RESERVA_EM_USO',
              mensagem: 'Outra estação começou a retirar esta reserva. Aguarde a conclusão.'
            };
          }

          /* marca como em uso e libera a trava para o estoque trabalhar */
          var estadoAnterior = r3.status;
          AP_Data_update(AP_FLUXO_CFG.abas.reservas, r3.protocolo, { status: 'EM_RETIRADA' }, 'protocolo');
          trava.releaseLock();
        } catch (eLock) { }

        /**
         * Pedir mais do que falta é recusado, não aparado em silêncio.
         * Aparar sem avisar esconde erro de conferência.
         */
        var pedidosR = payload.itens || [];
        if (pedidosR.length) {
          var excessos = [];
          pedidosR.forEach(function (pedido) {
            var doItem = itensR.filter(function (i) {
              return String(i.sku || i.id) === String(pedido.sku);
            })[0];
            if (!doItem) {
              excessos.push(pedido.sku + ' não faz parte desta reserva');
              return;
            }
            var falta = (Number(doItem.qtd) || 0) - (Number(doItem.retirado) || 0);
            if ((Number(pedido.qtd) || 0) > falta) {
              excessos.push((doItem.nome || pedido.sku) + ': pedido ' + pedido.qtd +
                ', disponível ' + falta);
            }
          });

          if (excessos.length) {
            /* devolve a reserva ao estado anterior: nada foi entregue */
            AP_Data_update(AP_FLUXO_CFG.abas.reservas, r3.protocolo,
              { status: estadoAnterior || 'APROVADA' }, 'protocolo');
            return {
              ok: false, codigo: 'QUANTIDADE_ACIMA_DO_SALDO',
              mensagem: 'Quantidade superior ao saldo da reserva. ' + excessos.join(' | ')
            };
          }
        }
        var baixados = [], falhas = [];

        itensR.forEach(function (i) {
          var skuItem = i.sku || i.codigo || i.id;
          var jaSaiu = Number(i.retirado) || 0;
          var faltaItem = (Number(i.qtd) || 0) - jaSaiu;
          if (faltaItem <= 0) return;

          /* entrega parcial: só sai o que foi pedido nesta operação */
          var quanto = faltaItem;
          if (pedidosR.length) {
            var ped = pedidosR.filter(function (x) { return String(x.sku) === String(skuItem); })[0];
            if (!ped) return;
            quanto = Math.min(faltaItem, Number(ped.qtd) || 0);
            if (quanto <= 0) return;
          }

          var mov = AP_Modulo_estoque('saida', {
            sku: skuItem, qtd: quanto,
            documento: r3.protocolo, centro: r3.centro, obra: r3.obra
          }, sessao);
          if (mov.ok) i.retirado = jaSaiu + quanto;
          if (mov.ok) baixados.push({ sku: skuItem, nome: i.nome, qtd: quanto, saldo: mov.dados.saldo });
          else falhas.push({ item: i.nome || i.descricao, motivo: mov.mensagem });
        });

        /* ainda falta alguma coisa? a reserva continua aberta */
        var aindaFalta = itensR.some(function (i) {
          return (Number(i.qtd) || 0) - (Number(i.retirado) || 0) > 0;
        });

        AP_Data_update(AP_FLUXO_CFG.abas.reservas, payload.protocolo, {
          itens: JSON.stringify(itensR),
          status: aindaFalta ? 'PARCIALMENTE_RETIRADA' : 'RETIRADA',
          retiradoPor: payload.retiradoPor || AP_FLUXO_usuario_(sessao),
          retiradoEm: AP_Utils_now()
        }, 'protocolo');

        AP_Audit_log(AP_FLUXO_usuario_(sessao), 'RESERVA_RETIRADA', 'RESERVAS', payload.protocolo, {
          baixados: baixados.length, falhas: falhas.length,
          metodo: payload.metodo || 'senha',
          retiradoPor: payload.retiradoPor || AP_FLUXO_usuario_(sessao),
          solicitante: r3.solicitante, aprovador: r3.aprovadoPor || '',
          parcial: aindaFalta
        });

        var resposta = {
          ok: baixados.length > 0,
          dados: {
            protocolo: payload.protocolo, baixados: baixados, falhas: falhas,
            status: aindaFalta ? 'PARCIALMENTE_RETIRADA' : 'RETIRADA',
            pendente: aindaFalta
          },
          parcial: aindaFalta
        };

        if (!baixados.length) {
          /* nada saiu: a reserva volta ao que era, não fica presa */
          AP_Data_update(AP_FLUXO_CFG.abas.reservas, r3.protocolo,
            { status: estadoAnterior || 'APROVADA' }, 'protocolo');
          resposta.codigo = 'NADA_ENTREGUE';
          resposta.mensagem = falhas.length ? falhas[0].motivo : 'Nenhum item foi entregue.';
        }

        return resposta;
      }

      default:
        return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'reservas.' + acao + ' não existe.' };
    }
  } catch (e) {
    AP_ErrorHandler_capture('AP_Modulo_reservas:' + acao, e);
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'reservas', acao: acao, mensagem: e.message };
  }
}

/* ============================================================
   ALÇADAS DE APROVAÇÃO
   ------------------------------------------------------------
   Uma solicitação com luva e cimento chega DIVIDIDA: o técnico
   de segurança decide sobre o EPI, o mestre decide sobre o
   material. Ninguém aprova o que não é da sua área.
   ============================================================ */

var AP_ALCADAS = {
  seguranca: { nome: 'EPI e segurança', perfis: ['SEGURANCA', 'ADMINISTRADOR', 'GESTOR'] },
  material: { nome: 'Material e ferramentas', perfis: ['MESTRE', 'ALMOXARIFE', 'ADMINISTRADOR', 'GESTOR', 'COMPRADOR'] }
};

function AP_APROV_alcadaDoItem_(item) {
  var cat = String((item && item.categoria) || '');
  if (!cat && item && item.sku) {
    var doCadastro = AP_ITENS_todos_().filter(function (i) { return i.sku === item.sku; })[0];
    cat = String((doCadastro && doCadastro.categoria) || '');
  }
  return /epi|seguran|uniform/i.test(cat) ? 'seguranca' : 'material';
}

function AP_APROV_alcadasDoPerfil_(perfil) {
  var p = String(perfil || '').toUpperCase();
  return Object.keys(AP_ALCADAS).filter(function (chave) {
    return AP_ALCADAS[chave].perfis.indexOf(p) > -1;
  });
}

function AP_Modulo_aprovacoes(acao, payload, sessao) {
  payload = payload || {};
  var perfil = (sessao && (sessao.perfil || sessao.role)) || 'ADMINISTRADOR';

  try {
    if (acao === 'listar' || acao === 'pendentes') {
      var r = AP_Modulo_reservas('listar', { status: 'PENDENTE_APROVACAO' }, sessao);
      return { ok: true, dados: r.dados || [] };
    }

    /**
     * O que ESTE perfil tem para decidir.
     * Devolve blocos: cada bloco é a parte de uma solicitação que
     * cabe a quem está olhando.
     */
    if (acao === 'porPerfil') {
      var minhas = AP_APROV_alcadasDoPerfil_(payload.perfil || perfil);
      var blocos = [];

      /* reservas pendentes, divididas por alçada */
      var reservas = AP_Modulo_reservas('listar', { status: 'PENDENTE_APROVACAO' }, sessao);
      (reservas.dados || []).forEach(function (res) {
        var itens = res.itens;
        if (typeof itens === 'string') { try { itens = JSON.parse(itens); } catch (e) { itens = []; } }
        itens = itens || [];

        var porAlcada = {};
        itens.forEach(function (i) {
          var chave = AP_APROV_alcadaDoItem_(i);
          if (!porAlcada[chave]) porAlcada[chave] = { itens: [], valor: 0, categorias: {} };
          porAlcada[chave].itens.push(i);
          porAlcada[chave].valor += (Number(i.qtd) || 0) * (Number(i.preco || i.valorUnitario) || 0);
          porAlcada[chave].categorias[i.categoria || 'Sem categoria'] = true;
        });

        Object.keys(porAlcada).forEach(function (chave) {
          if (minhas.indexOf(chave) === -1) return;
          blocos.push({
            tipo: 'RESERVA',
            reserva: res,
            alcada: chave,
            grupo: {
              nome: AP_ALCADAS[chave].nome,
              itens: porAlcada[chave].itens,
              categorias: Object.keys(porAlcada[chave].categorias),
              valor: porAlcada[chave].valor
            }
          });
        });
      });

      /* pedidos de compra esperando decisão */
      if (typeof AP_Modulo_compras === 'function') {
        var pc = AP_Modulo_compras('precompras', {}, sessao);
        (pc.dados || []).forEach(function (item) {
          var st = String(item.status || '').toUpperCase();
          if (['AGUARDANDO_MESTRE', 'AGUARDANDO_GESTOR', 'ABERTA'].indexOf(st) === -1) return;
          var chave = AP_APROV_alcadaDoItem_(item);
          if (minhas.indexOf(chave) === -1) return;
          blocos.push({
            tipo: 'PRECOMPRA',
            precompra: item,
            alcada: chave,
            grupo: {
              nome: AP_ALCADAS[chave].nome,
              itens: [item],
              categorias: [item.categoria || 'Sem categoria'],
              valor: Number(item.valorEstimado) || 0
            }
          });
        });
      }

      return { ok: true, dados: blocos, alcadas: minhas };
    }

    if (acao === 'alcadas') {
      return {
        ok: true,
        dados: Object.keys(AP_ALCADAS).map(function (k) {
          return { id: k, nome: AP_ALCADAS[k].nome, perfis: AP_ALCADAS[k].perfis,
                   minha: AP_APROV_alcadasDoPerfil_(perfil).indexOf(k) > -1 };
        })
      };
    }

    if (acao === 'decidir') return AP_Modulo_reservas('decidir', payload, sessao);

    if (acao === 'decidirItens') {
      /* decisão por item, dentro da alçada de quem decide */
      var res2 = AP_FLUXO_acharReserva_(payload.protocolo);
      if (res2) payload.protocolo = res2.protocolo;
      if (!res2) return { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Reserva não localizada.' };

      var lista = res2.itens;
      if (typeof lista === 'string') { try { lista = JSON.parse(lista); } catch (e) { lista = []; } }
      lista = lista || [];

      var decididos = 0;
      lista.forEach(function (i) {
        var alvo = (payload.itens || []).indexOf(i.sku) > -1 || (payload.itens || []).indexOf(i.id) > -1;
        if (!alvo) return;
        i.decisao = payload.decisao === 'APROVADA' ? 'APROVADO' : 'RECUSADO';
        i.decididoPor = AP_FLUXO_usuarioSeguro_(sessao);
        i.decididoEm = AP_Utils_now();
        decididos++;
      });

      var pendentes = lista.filter(function (i) { return !i.decisao || i.decisao === 'PENDENTE'; });
      var novoStatus = res2.status;
      if (!pendentes.length) {
        novoStatus = lista.some(function (i) { return i.decisao === 'APROVADO'; }) ? 'APROVADA' : 'CANCELADA';
      }

      AP_Data_update(AP_FLUXO_CFG.abas.reservas, payload.protocolo, {
        itens: JSON.stringify(lista), status: novoStatus,
        aprovador: AP_FLUXO_usuarioSeguro_(sessao), aprovadoEm: AP_Utils_now()
      }, 'protocolo');

      AP_Audit_log(AP_FLUXO_usuarioSeguro_(sessao), 'APROVACAO_ITENS', 'RESERVAS', payload.protocolo,
        { decididos: decididos, status: novoStatus });

      return { ok: true, dados: { protocolo: payload.protocolo, decididos: decididos,
                                  status: novoStatus, pendentes: pendentes.length } };
    }

    return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'aprovacoes.' + acao + ' não existe.' };
  } catch (e) {
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'aprovacoes', acao: acao, mensagem: e.message };
  }
}

/* ============================================================
   NOTAS FISCAIS
   ============================================================ */
function AP_Modulo_nf(acao, payload, sessao) {
  payload = payload || {};
  try {
    switch (acao) {

      case 'listar':
        return { ok: true, dados: AP_FLUXO_ler_('notas') };

      case 'obter': {
        var n = AP_FLUXO_ler_('notas').filter(function (x) { return x.numero === payload.numero; })[0];
        return n ? { ok: true, dados: n }
          : { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Nota não localizada.' };
      }

      case 'salvar': {
        if (!payload.numero) return { ok: false, codigo: 'CAMPO_OBRIGATORIO', mensagem: 'Informe o número da nota.' };
        AP_FLUXO_aba_('notas');
        var existente = AP_FLUXO_ler_('notas').filter(function (x) { return x.numero === payload.numero; })[0];

        var registro = {
          numero: payload.numero, serie: payload.serie || '', chave: payload.chave || '',
          fornecedor: payload.fornecedor || '', cnpj: payload.cnpj || '',
          emissao: payload.emissao || '', entrada: payload.entrada || AP_Utils_now(),
          valor: Number(payload.valor) || 0,
          itens: JSON.stringify(payload.listaItens || payload.itens || []),
          status: payload.status || 'EM_CONFERENCIA', origem: payload.origem || 'Manual',
          arquivoId: payload.arquivoId || '',
          lancadoPor: AP_FLUXO_usuario_(sessao), lancadoEm: AP_Utils_now()
        };

        if (existente) {
          AP_Data_update(AP_FLUXO_CFG.abas.notas, payload.numero, registro, 'numero');
          /* os itens também viram linhas próprias */
          AP_FLUXO_gravarItensNF_(registro,
            payload.listaItens || payload.itens || [], sessao);
          return { ok: true, dados: registro, atualizado: true };
        }
        AP_Data_append(AP_FLUXO_CFG.abas.notas, registro);
        AP_FLUXO_gravarItensNF_(registro,
          payload.listaItens || payload.itens || [], sessao);
        AP_Audit_log(registro.lancadoPor, 'NF_REGISTRADA', 'NF', payload.numero, { origem: registro.origem });
        return { ok: true, dados: registro, criado: true };
      }

      /** Conferência confirmada: entra no estoque e cadastra fornecedor se preciso */
      case 'itens':
        if (!payload.numero) {
          return { ok: false, codigo: 'SEM_NUMERO', mensagem: 'Informe o número da nota.' };
        }
        return AP_FLUXO_itensDaNF(payload.numero);

      case 'notasDoItem':
        if (!payload.sku) return { ok: false, codigo: 'SEM_SKU', mensagem: 'Informe o material.' };
        return AP_FLUXO_notasDoItem(payload.sku);

      case 'conferir':
        if (!payload.numero) {
          return { ok: false, codigo: 'SEM_NUMERO', mensagem: 'Informe o número da nota.' };
        }
        return AP_FLUXO_conferirNF(payload.numero);

      case 'lancar': {
        /**
         * UMA NOTA SÓ ENTRA NO ESTOQUE UMA VEZ
         *
         * Lançar duas vezes a mesma nota dobrava o saldo — e o erro
         * só apareceria no inventário, semanas depois, quando a
         * contagem física não batesse.
         *
         * Acontece fácil: a tela demora, a pessoa clica de novo;
         * ou duas pessoas lançam a mesma nota sem saber.
         *
         * Para relançar de propósito (uma correção), é preciso
         * passar 'confirmarRelancamento' — uma decisão consciente,
         * registrada na auditoria.
         */
        var jaLancada = AP_FLUXO_ler_('notas').filter(function (x) {
          return String(x.numero) === String(payload.numero);
        })[0];

        if (jaLancada && String(jaLancada.status).toUpperCase() === 'LANCADA' &&
            !payload.confirmarRelancamento) {
          return {
            ok: false,
            codigo: 'NF_JA_LANCADA',
            mensagem: 'A nota ' + payload.numero + ' já foi lançada no estoque em ' +
              (jaLancada.lancadoEm || 'data não registrada') +
              (jaLancada.lancadoPor ? ' por ' + jaLancada.lancadoPor : '') +
              '. Lançar de novo dobraria o saldo.',
            dados: {
              numero: payload.numero,
              lancadoEm: jaLancada.lancadoEm,
              lancadoPor: jaLancada.lancadoPor,
              /* quem realmente precisa relançar sabe o que fazer */
              comoRelancar: 'Envie confirmarRelancamento: true para lançar mesmo assim.'
            }
          };
        }

        var nota = AP_FLUXO_ler_('notas').filter(function (x) { return x.numero === payload.numero; })[0];
        if (!nota) return { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Nota não localizada.' };

        /**
         * De onde vêm os itens para lançar.
         *
         * A tabela de itens é a fonte: é ela que a tela edita e
         * que permite corrigir uma quantidade antes de lançar. O
         * JSON antigo continua valendo para notas lançadas antes
         * desta mudança.
         */
        var itens = payload.itens;

        if (!itens || !itens.length) {
          var daTabela = AP_FLUXO_itensDaNF(payload.numero).dados.itens;
          if (daTabela.length) {
            itens = daTabela.map(function (l) {
              return {
                sku: l.sku, descricao: l.descricao, ncm: l.ncm,
                unidade: l.unidade, qtd: Number(l.quantidade) || 0,
                valorUnitario: Number(l.valorUnitario) || 0,
                valorTotal: Number(l.valorTotal) || 0
              };
            });
          }
        }

        if (!itens || !itens.length) itens = AP_FLUXO_json_(nota.itens, []);
        if (!itens.length) return { ok: false, codigo: 'SEM_ITENS', mensagem: 'A nota não tem itens para lançar.' };

        /* fornecedor: usa o que existe, cadastra o que não existe */
        var fornecedorId = null;
        if (nota.cnpj) {
          var busca = AP_Modulo_fornecedores('porCnpj', { cnpj: nota.cnpj }, sessao);
          if (busca.ok && busca.dados) fornecedorId = busca.dados.id;
          else {
            var novoF = AP_Modulo_fornecedores('salvar', {
              razaoSocial: nota.fornecedor || 'Fornecedor da NF ' + nota.numero, cnpj: nota.cnpj
            }, sessao);
            if (novoF.ok) fornecedorId = novoF.dados.id;
          }
        }

        /**
         * OS ITENS NOVOS PRIMEIRO, A ENTRADA DEPOIS
         *
         * Cadastrar item e dar entrada são coisas diferentes: a
         * primeira acontece uma vez por item, a segunda pode ser
         * feita toda de uma vez.
         *
         * Antes, cada item pegava a trava de concorrência para si.
         * Com uma nota de trinta itens isso estourava o tempo de
         * execução do Apps Script no meio — e metade da nota
         * entrava no estoque, metade não.
         */
        var novos = [];
        var paraLancar = [];

        itens.forEach(function (i) {
          var sku = i.sku;

          if (!sku) {
            var criado = AP_Modulo_itens('salvar', {
              descricao: i.descricao, unidade: i.unidade || 'un',
              valorUnitario: i.valorUnitario || 0, ncm: i.ncm || '',
              categoria: i.categoria || '', fornecedor: nota.fornecedor || '',
              confirmadoNovo: true
            }, sessao);

            if (!criado.ok) return;
            sku = criado.dados.sku;
            novos.push(sku);
          }

          paraLancar.push({
            sku: sku, qtd: i.qtd,
            valorUnitario: i.valorUnitario || 0
          });
        });

        var lote = AP_Modulo_estoque('entradaEmLote', {
          itens: paraLancar,
          documento: 'NF ' + nota.numero,
          obra: nota.obra || ''
        }, sessao);

        if (!lote.ok) {
          return {
            ok: false, codigo: lote.codigo || 'FALHA_LANCAMENTO',
            mensagem: lote.mensagem || 'Não foi possível lançar a nota no estoque.',
            dados: lote.dados
          };
        }

        var entradas = lote.dados.entradas;

        /* o que não entrou precisa ser dito, não escondido */
        var recusados = lote.dados.recusados || [];

        AP_Data_update(AP_FLUXO_CFG.abas.notas, payload.numero, { status: 'LANCADA' }, 'numero');
        AP_Audit_log(AP_FLUXO_usuario_(sessao), 'NF_LANCADA', 'NF', payload.numero,
          { entradas: entradas.length, itensNovos: novos.length });
        /* os itens passam a constar como lançados no estoque */
        AP_FLUXO_marcarItensLancados_(payload.numero, sessao);

        /* a nota fica marcada: a próxima tentativa é barrada */
        AP_Data_update(AP_FLUXO_CFG.abas.notas, payload.numero, {
          status: 'LANCADA',
          lancadoEm: AP_Utils_now(),
          lancadoPor: (sessao && sessao.usuario) || 'sistema'
        }, 'numero');

        if (payload.confirmarRelancamento && jaLancada) {
          AP_Audit_log((sessao && sessao.usuario) || 'sistema',
            'NF_RELANCADA', 'NF', payload.numero,
            { lancamentoAnterior: jaLancada.lancadoEm, entradas: entradas.length });
        }

        AP_EventBus.emit('NF.LANCADA', { numero: payload.numero, entradas: entradas.length });

        return {
          ok: true,
          dados: {
            numero: payload.numero,
            entradas: entradas,
            itensNovos: novos,
            fornecedorId: fornecedorId,
            unidades: lote.dados.unidades,
            valor: lote.dados.valor,
            recusados: recusados,
            aviso: recusados.length
              ? recusados.length + ' item(ns) não entraram: ' +
                recusados.map(function (r) { return r.sku + ' (' + r.motivo + ')'; })
                  .slice(0, 3).join(', ')
              : null
          }
        };
      }

      default:
        return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'nf.' + acao + ' não existe.' };
    }
  } catch (e) {
    AP_ErrorHandler_capture('AP_Modulo_nf:' + acao, e);
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'nf', acao: acao, mensagem: e.message };
  }
}

/* ============================================================
   COMPRAS — pedidos e pré-compras com ação de verdade
   ============================================================ */
function AP_Modulo_compras(acao, payload, sessao) {
  payload = payload || {};
  try {
    AP_FLUXO_aba_('compras');
    var todas = AP_FLUXO_ler_('compras');

    switch (acao) {

      case 'listar': {
        var lista = todas;
        if (payload.tipo) lista = lista.filter(function (c) { return c.tipo === payload.tipo; });
        if (payload.status) lista = lista.filter(function (c) { return c.status === payload.status; });
        return { ok: true, dados: lista };
      }

      case 'precompras':
        return { ok: true, dados: todas.filter(function (c) { return c.tipo === 'PRE_COMPRA'; }) };

      case 'pedidos':
        return { ok: true, dados: todas.filter(function (c) { return c.tipo === 'PEDIDO'; }) };

      /** Pré-compra: nunca duplica o mesmo item, só reforça */
      case 'precompra': {
        if (!payload.sku) return { ok: false, codigo: 'CAMPO_OBRIGATORIO', mensagem: 'Informe o item.' };
        var item = AP_OPER_item_(payload.sku);
        if (!item) return { ok: false, codigo: 'ITEM_NAO_ENCONTRADO', mensagem: 'Item não localizado no cadastro.' };

        var existente = todas.filter(function (c) {
          return c.tipo === 'PRE_COMPRA' && c.sku === payload.sku &&
            ['AGUARDANDO_APROVACAO', 'EM_COTACAO'].indexOf(c.status) > -1;
        })[0];

        if (existente) {
          var historico = AP_FLUXO_json_(existente.historico, []);
          historico.push({ quando: new Date().toISOString(), texto: 'Necessidade reforçada: ' + payload.qtd + ' un.' });
          AP_Data_update(AP_FLUXO_CFG.abas.compras, existente.id, {
            qtd: Math.max(Number(existente.qtd) || 0, Number(payload.qtd) || 0),
            historico: JSON.stringify(historico)
          });
          return { ok: true, dados: { id: existente.id, reforcada: true }, mensagem: 'Pré-compra existente reforçada — nada foi duplicado.' };
        }

        var nova = {
          id: '#PC-' + String(todas.length + 1).padStart(6, '0'),
          data: AP_Utils_now(), tipo: 'PRE_COMPRA', sku: payload.sku, descricao: item.descricao,
          qtd: Number(payload.qtd) || 0,
          valorEstimado: (Number(payload.qtd) || 0) * (Number(item.valorUnitario) || 0),
          fornecedor: item.fornecedor || '', status: 'AGUARDANDO_APROVACAO',
          previsao: '', origem: payload.origem || 'ESTOQUE_MINIMO',
          solicitante: AP_FLUXO_usuario_(sessao), aprovadoPor: '',
          historico: JSON.stringify([{ quando: new Date().toISOString(), texto: 'Pré-compra aberta' }])
        };
        AP_Data_append(AP_FLUXO_CFG.abas.compras, nova);
        AP_EventBus.emit('COMPRA.PRECOMPRA_ABERTA', { id: nova.id, sku: payload.sku });
        return { ok: true, dados: nova, criado: true };
      }

      /** Pedido de compra — o botão que estava sem ação */
      case 'pedido': {
        if (!payload.sku && !payload.itens) {
          return { ok: false, codigo: 'CAMPO_OBRIGATORIO', mensagem: 'Informe o item ou a lista de itens.' };
        }
        var itensPedido = payload.itens || [{ sku: payload.sku, qtd: payload.qtd }];
        var criados = [];

        itensPedido.forEach(function (i) {
          var it = AP_OPER_item_(i.sku);
          if (!it) return;
          var pedido = {
            id: '#CP-' + String(AP_FLUXO_ler_('compras').length + 1).padStart(6, '0'),
            data: AP_Utils_now(), tipo: 'PEDIDO', sku: i.sku, descricao: it.descricao,
            qtd: Number(i.qtd) || 0,
            valorEstimado: (Number(i.qtd) || 0) * (Number(i.valorUnitario || it.valorUnitario) || 0),
            fornecedor: payload.fornecedor || it.fornecedor || '',
            status: 'EMITIDO', previsao: payload.previsao || '',
            origem: payload.precompra || 'MANUAL',
            solicitante: AP_FLUXO_usuario_(sessao), aprovadoPor: '',
            historico: JSON.stringify([{ quando: new Date().toISOString(), texto: 'Pedido emitido' }])
          };
          AP_Data_append(AP_FLUXO_CFG.abas.compras, pedido);
          criados.push(pedido);
        });

        if (!criados.length) {
          return { ok: false, codigo: 'ITEM_NAO_ENCONTRADO', mensagem: 'Nenhum item válido para o pedido.' };
        }

        /* pré-compra que virou pedido sai da fila */
        if (payload.precompra) {
          AP_Data_update(AP_FLUXO_CFG.abas.compras, payload.precompra, { status: 'CONVERTIDA_EM_PEDIDO' });
        }

        AP_Audit_log(AP_FLUXO_usuario_(sessao), 'PEDIDO_EMITIDO', 'COMPRAS', criados[0].id,
          { itens: criados.length, fornecedor: payload.fornecedor });
        AP_EventBus.emit('COMPRA.PEDIDO_EMITIDO', { pedidos: criados.map(function (c) { return c.id; }) });

        return { ok: true, dados: { pedidos: criados, quantidade: criados.length } };
      }

      case 'alterarStatus': {
        var alvo = todas.filter(function (c) { return c.id === payload.id; })[0];
        if (!alvo) return { ok: false, codigo: 'NAO_ENCONTRADO', mensagem: 'Registro de compra não localizado.' };
        var h = AP_FLUXO_json_(alvo.historico, []);
        h.push({ quando: new Date().toISOString(), texto: 'Status: ' + alvo.status + ' → ' + payload.status });
        AP_Data_update(AP_FLUXO_CFG.abas.compras, payload.id, {
          status: payload.status, previsao: payload.previsao || alvo.previsao,
          fornecedor: payload.fornecedor || alvo.fornecedor, historico: JSON.stringify(h)
        });
        AP_Audit_log(AP_FLUXO_usuario_(sessao), 'COMPRA_STATUS', 'COMPRAS', payload.id, { status: payload.status });
        return { ok: true, dados: { id: payload.id, status: payload.status } };
      }

      /** Estoque no mínimo gera pré-compra sozinho */
      case 'sugerir': {
        var criticos = AP_Modulo_estoque('criticos', {}).dados || [];
        var abertas = [];
        criticos.forEach(function (i) {
          var falta = Math.max((Number(i.maximo) || Number(i.minimo) * 2 || 0) - i.estoque, i.minimo || 0);
          if (falta <= 0) return;
          var r = AP_Modulo_compras('precompra', { sku: i.sku, qtd: falta, origem: 'ESTOQUE_MINIMO' }, sessao);
          if (r.ok) abertas.push({ sku: i.sku, id: r.dados.id, reforcada: !!r.dados.reforcada });
        });
        return { ok: true, dados: { analisados: criticos.length, precompras: abertas } };
      }

      default:
        return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'compras.' + acao + ' não existe.' };
    }
  } catch (e) {
    AP_ErrorHandler_capture('AP_Modulo_compras:' + acao, e);
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'compras', acao: acao, mensagem: e.message };
  }
}

/* ============================================================
   MÓDULOS DE CADASTRO SIMPLES (mesma estrutura)
   ============================================================ */
function AP_FLUXO_crud_(nome, chave, idCampo, acao, payload, sessao, aoCriar) {
  payload = payload || {};
  AP_FLUXO_aba_(chave);
  switch (acao) {
    case 'listar': {
      var lista = AP_FLUXO_ler_(chave);
      if (payload.status) lista = lista.filter(function (x) { return x.status === payload.status; });
      return { ok: true, dados: lista };
    }
    case 'obter': {
      var alvo = AP_FLUXO_ler_(chave).filter(function (x) { return String(x[idCampo]) === String(payload[idCampo] || payload.id); })[0];
      return alvo ? { ok: true, dados: alvo }
        : { ok: false, codigo: 'NAO_ENCONTRADO', mensagem: nome + ' não localizado.' };
    }
    case 'salvar':
    case 'criar': {
      var existente = payload[idCampo] &&
        AP_FLUXO_ler_(chave).filter(function (x) { return String(x[idCampo]) === String(payload[idCampo]); })[0];
      if (existente) {
        AP_Data_update(AP_FLUXO_CFG.abas[chave], payload[idCampo], payload, idCampo);
        return { ok: true, dados: payload, atualizado: true };
      }
      var novo = aoCriar(payload, AP_FLUXO_ler_(chave).length, sessao);
      AP_Data_append(AP_FLUXO_CFG.abas[chave], novo);
      AP_Audit_log(AP_FLUXO_usuario_(sessao), nome.toUpperCase() + '_CRIADO', chave.toUpperCase(), novo[idCampo], {});
      return { ok: true, dados: novo, criado: true };
    }
    case 'excluir': {
      AP_Data_remove(AP_FLUXO_CFG.abas[chave], payload[idCampo] || payload.id, idCampo);
      return { ok: true, dados: { excluido: true } };
    }
    default:
      return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: chave + '.' + acao + ' não existe.' };
  }
}

function AP_Modulo_epi(acao, payload, sessao) {
  try {
    if (acao === 'catalogo') {
      var itens = AP_Modulo_estoque('listar', {}).dados || [];
      return { ok: true, dados: itens.filter(function (i) { return /epi|seguran/i.test(i.categoria || ''); }) };
    }
    if (acao === 'fichas') acao = 'listar';
    return AP_FLUXO_crud_('Ficha de EPI', 'epi', 'id', acao, payload, sessao, function (p, n, s) {
      return {
        id: 'EPI' + String(n + 1).padStart(5, '0'), colaborador: p.colaborador || '',
        matricula: p.matricula || '', cargo: p.cargo || '', setor: p.setor || '',
        sku: p.sku || '', item: p.item || '', qtd: Number(p.qtd) || 1, ca: p.ca || '',
        entrega: p.entrega || AP_Utils_now(), validade: p.validade || '',
        status: p.status || 'ENTREGUE', entreguePor: AP_FLUXO_usuario_(s), assinatura: p.assinatura || ''
      };
    });
  } catch (e) { return { ok: false, codigo: 'MODULO_ERRO', modulo: 'epi', acao: acao, mensagem: e.message }; }
}

function AP_Modulo_ferramentas(acao, payload, sessao) {
  try {
    return AP_FLUXO_crud_('Ferramenta', 'ferramentas', 'patrimonio', acao, payload, sessao, function (p, n, s) {
      return {
        patrimonio: p.patrimonio || ('FER-' + String(n + 1).padStart(4, '0')),
        sku: p.sku || '', nome: p.nome || '', status: p.status || 'DISPONIVEL',
        com: p.com || '', desde: p.desde || '', obra: p.obra || '', observacao: p.observacao || ''
      };
    });
  } catch (e) { return { ok: false, codigo: 'MODULO_ERRO', modulo: 'ferramentas', acao: acao, mensagem: e.message }; }
}

function AP_Modulo_ocorrencias(acao, payload, sessao) {
  try {
    return AP_FLUXO_crud_('Ocorrência', 'ocorrencias', 'id', acao, payload, sessao, function (p, n, s) {
      return {
        id: '#OC-' + String(n + 1).padStart(6, '0'), data: AP_Utils_now(),
        titulo: p.titulo || '', categoria: p.categoria || 'Geral',
        prioridade: p.prioridade || 'Média', obra: p.obra || '', local: p.local || '',
        responsavel: p.responsavel || '', autor: AP_FLUXO_usuario_(s),
        status: p.status || 'ABERTA', descricao: p.descricao || '',
        materiais: JSON.stringify(p.materiais || []),
        protocoloNecessidade: '', historico: JSON.stringify([])
      };
    });
  } catch (e) { return { ok: false, codigo: 'MODULO_ERRO', modulo: 'ocorrencias', acao: acao, mensagem: e.message }; }
}

function AP_Modulo_inventario(acao, payload, sessao) {
  try {
    if (acao === 'sugestoes') {
      var criticos = AP_Modulo_estoque('criticos', {}).dados || [];
      return {
        ok: true,
        dados: criticos.map(function (i) {
          return {
            codigo: i.sku, nome: i.nome, emoji: '📦', local: i.local, categoria: i.categoria,
            saldo: i.estoque, valor: i.estoque * i.valorUnitario,
            motivo: i.status === 'critico' ? 'Item em nível crítico' : 'Item em atenção',
            ultimaContagem: '', prioridade: i.status === 'critico' ? 'Alta' : 'Média'
          };
        })
      };
    }
    if (acao === 'divergencias') return { ok: true, dados: [] };
    return AP_FLUXO_crud_('Inventário', 'inventarios', 'id', acao, payload, sessao, function (p, n, s) {
      return {
        id: 'INV-' + String(n + 1).padStart(4, '0'), data: AP_Utils_now(),
        obra: p.obra || '', responsavel: p.responsavel || AP_FLUXO_usuario_(s),
        status: p.status || 'EM_ANDAMENTO', itens: JSON.stringify(p.itens || []),
        divergencias: JSON.stringify([]), encerradoEm: ''
      };
    });
  } catch (e) { return { ok: false, codigo: 'MODULO_ERRO', modulo: 'inventario', acao: acao, mensagem: e.message }; }
}

function AP_Modulo_projetos(acao, payload, sessao) {
  try {
    if (acao === 'detalhe') acao = 'obter';
    if (acao === 'abastecer') return { ok: true, dados: [] };
    return AP_FLUXO_crud_('Projeto', 'projetos', 'id', acao, payload, sessao, function (p, n, s) {
      return {
        id: p.id || ('PRJ-' + String(n + 1).padStart(3, '0')), nome: p.nome || '',
        obra: p.obra || '', responsavel: p.responsavel || '', status: p.status || 'EM_ANDAMENTO',
        progresso: 0, inicio: p.inicio || '', previsao: p.previsao || '', centro: p.centro || '',
        descricao: p.descricao || '', materiais: JSON.stringify(p.materiais || []),
        observacoes: JSON.stringify([])
      };
    });
  } catch (e) { return { ok: false, codigo: 'MODULO_ERRO', modulo: 'projetos', acao: acao, mensagem: e.message }; }
}

function AP_Modulo_relatorios(acao, payload, sessao) {
  try {
    if (acao === 'gerados') acao = 'listar';
    if (acao === 'registrar') acao = 'salvar';
    return AP_FLUXO_crud_('Relatório', 'relatorios', 'id', acao, payload, sessao, function (p, n, s) {
      return {
        id: 'REL' + String(n + 1).padStart(5, '0'), nome: p.nome || 'Relatório',
        tipo: p.tipo || 'Geral', data: AP_Utils_now(), formato: p.formato || 'PDF',
        autor: AP_FLUXO_usuario_(s), parametros: JSON.stringify(p.parametros || {})
      };
    });
  } catch (e) { return { ok: false, codigo: 'MODULO_ERRO', modulo: 'relatorios', acao: acao, mensagem: e.message }; }
}

function AP_Modulo_mural(acao, payload, sessao) {
  try {
    if (acao === 'excluir') {
      AP_Data_remove(AP_FLUXO_CFG.abas.mural, payload.id, 'id');
      return { ok: true, dados: { id: payload.id, excluida: true } };
    }
    if (acao === 'listar') {
      return {
        ok: true,
        dados: AP_FLUXO_ler_('mural').map(function (p) { p.fotos = AP_FLUXO_json_(p.fotos, []); return p; })
      };
    }
    return AP_FLUXO_crud_('Publicação', 'mural', 'id', acao, payload, sessao, function (p, n, s) {
      return {
        id: AP_Utils_generateId('PUB'), titulo: p.titulo || '', categoria: p.categoria || 'Comunicado',
        data: p.data || AP_Utils_now(), obra: p.obra || '', atividade: p.atividade || '',
        responsavel: p.responsavel || '', descricao: p.descricao || '',
        fotos: JSON.stringify(p.fotos || []), autor: AP_FLUXO_usuario_(s), criadoEm: AP_Utils_now()
      };
    });
  } catch (e) { return { ok: false, codigo: 'MODULO_ERRO', modulo: 'mural', acao: acao, mensagem: e.message }; }
}

/** Painel: guarda a configuração do mural na CONFIG do Core */
function AP_Modulo_painel(acao, payload, sessao) {
  payload = payload || {};
  try {
    if (acao === 'carregar') {
      var cfg = AP_Config_get('PAINEL_CONFIG', null);
      if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg); } catch (e) { cfg = null; } }
      return { ok: true, dados: cfg };
    }
    if (acao === 'salvar') {
      AP_Config_set('PAINEL_CONFIG', JSON.stringify(payload.config || {}));
      AP_Audit_log(AP_FLUXO_usuario_(sessao), 'PAINEL_CONFIGURADO', 'PAINEL', '', {});
      return { ok: true, dados: payload.config };
    }
    return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'painel.' + acao + ' não existe.' };
  } catch (e) {
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'painel', acao: acao, mensagem: e.message };
  }
}

/* ============================================================
   TESTE
   ============================================================ */
function testeModulosFluxo() {
  var log = [];
  function reg(t, ok, d) { log.push((ok ? 'OK    ' : 'ERRO  ') + t + (d ? ' — ' + d : '')); }

  try {
    AP_Modulo_categorias('salvar', { nome: 'Materiais' });
    var item = AP_Modulo_itens('salvar', { descricao: 'Cimento CP-II 50kg', categoria: 'Materiais', unidade: 'sc', valorUnitario: 32.5, estoqueMinimo: 20 });
    var sku = item.dados.sku;
    AP_Modulo_estoque('entrada', { sku: sku, qtd: 100, documento: 'NF INICIAL' });

    /* NOTA FISCAL */
    var nf = AP_Modulo_nf('salvar', {
      numero: '000.000.127', serie: '1', fornecedor: 'ALMOXA PRO MATERIAIS LTDA', cnpj: '12345678000190',
      valor: 1625, listaItens: [{ sku: sku, descricao: 'Cimento CP-II 50kg', qtd: 50, valorUnitario: 32.5, unidade: 'sc' }]
    });
    reg('registra nota fiscal', nf.ok, nf.ok ? nf.dados.numero : nf.mensagem);

    var lanc = AP_Modulo_nf('lancar', { numero: '000.000.127' });
    reg('lançamento da NF entra no estoque', lanc.ok && lanc.dados.entradas.length === 1,
      lanc.ok ? 'saldo agora ' + AP_Modulo_estoque('item', { sku: sku }).dados.estoque : lanc.mensagem);
    reg('fornecedor cadastrado pela NF', !!lanc.dados.fornecedorId, lanc.dados.fornecedorId);

    /* RESERVA */
    var res = AP_Modulo_reservas('criar', {
      solicitante: 'João', obra: 'Obra 1',
      itens: [{ sku: sku, nome: 'Cimento CP-II 50kg', qtd: 30, preco: 32.5 }]
    });
    reg('cria reserva', res.ok, res.ok ? res.dados.protocolo : res.mensagem);
    var proto = res.dados.protocolo;

    var semSaldo = AP_Modulo_reservas('criar', {
      solicitante: 'João', itens: [{ sku: sku, nome: 'Cimento', qtd: 9999, preco: 32.5 }]
    });
    reg('avisa falta de saldo na reserva', semSaldo.ok && semSaldo.dados.semSaldo.length === 1,
      semSaldo.dados.semSaldo[0] || '');

    var semAprovar = AP_Modulo_reservas('retirar', { protocolo: proto });
    reg('não deixa retirar sem aprovação', semAprovar.ok === false && semAprovar.codigo === 'RESERVA_NAO_APROVADA', semAprovar.codigo);

    AP_Modulo_reservas('decidir', { protocolo: proto, decisao: 'APROVADA' });
    var saldoAntes = AP_Modulo_estoque('item', { sku: sku }).dados.estoque;
    var ret = AP_Modulo_reservas('retirar', { protocolo: proto });
    var saldoDepois = AP_Modulo_estoque('item', { sku: sku }).dados.estoque;
    reg('retirada baixa o estoque', ret.ok && saldoDepois === saldoAntes - 30,
      saldoAntes + ' → ' + saldoDepois);

    /* COMPRAS */
    var pc = AP_Modulo_compras('precompra', { sku: sku, qtd: 200 });
    reg('abre pré-compra', pc.ok, pc.ok ? pc.dados.id : pc.mensagem);
    var pc2 = AP_Modulo_compras('precompra', { sku: sku, qtd: 300 });
    reg('não duplica pré-compra do mesmo item', pc2.ok && pc2.dados.reforcada === true, pc2.mensagem);

    var ped = AP_Modulo_compras('pedido', { sku: sku, qtd: 200, fornecedor: 'ALMOXA PRO MATERIAIS LTDA', precompra: pc.dados.id });
    reg('emite pedido de compra', ped.ok && ped.dados.quantidade === 1, ped.ok ? ped.dados.pedidos[0].id : ped.mensagem);

    var st = AP_Modulo_compras('alterarStatus', { id: ped.dados.pedidos[0].id, status: 'EM_TRANSITO', previsao: '2026-09-10' });
    reg('altera status do pedido', st.ok, 'EM_TRANSITO');

    /* DEMAIS MÓDULOS */
    var oc = AP_Modulo_ocorrencias('criar', { titulo: 'Vazamento na prumada', categoria: 'Manutenção' });
    reg('cria ocorrência', oc.ok, oc.ok ? oc.dados.id : oc.mensagem);

    var pub = AP_Modulo_mural('salvar', { titulo: 'DDS — Trabalho em altura', fotos: [] });
    reg('publica no mural', pub.ok, pub.ok ? pub.dados.titulo : pub.mensagem);

    var painelOk = AP_Modulo_painel('salvar', { config: { layout: 2 } });
    var painelLido = AP_Modulo_painel('carregar', {});
    reg('painel salva e relê a configuração', painelOk.ok && painelLido.dados && painelLido.dados.layout === 2, 'layout 2');

    var prj = AP_Modulo_projetos('criar', { nome: 'Prumada Torre 02', obra: 'Obra 1' });
    reg('cria projeto', prj.ok, prj.ok ? prj.dados.id : prj.mensagem);

    var inv = AP_Modulo_inventario('sugestoes', {});
    reg('inventário sugere itens', inv.ok, inv.dados.length + ' sugestão(ões)');

    var fer = AP_Modulo_ferramentas('criar', { nome: 'Furadeira', patrimonio: 'FUR-001' });
    reg('cadastra ferramenta', fer.ok, fer.ok ? fer.dados.patrimonio : fer.mensagem);

    var ficha = AP_Modulo_epi('salvar', { colaborador: 'João', matricula: '001', item: 'Capacete', qtd: 1 });
    reg('registra ficha de EPI', ficha.ok, ficha.ok ? ficha.dados.id : ficha.mensagem);

  } catch (e) {
    log.push('ERRO  exceção: ' + e.message + ' | ' + (e.stack || '').split('\n')[1]);
  }

  try { Logger.log(log.join('\n')); } catch (e) { }
  return log;
}


/* ============================================================
   ITENS DA NOTA FISCAL
   ------------------------------------------------------------
   Uma linha por item. É o que permite responder:
   
     — o que veio na NF 12345?
     — de quais notas veio este SKU?
     — quanto compramos deste fornecedor no mês?
   
   Cada item mantém seu SKU, sua unidade e seu valor. Produtos
   parecidos com SKU diferente nunca são somados juntos.
   ============================================================ */

function AP_FLUXO_abaNFItens_() {
  return AP_Data_getSheet(AP_FLUXO_CFG.abas.nfItens, AP_FLUXO_CFG.colunas.nfItens);
}

/**
 * Grava os itens de uma nota, um por linha.
 *
 * Relançar a mesma nota substitui os itens anteriores — senão
 * cada correção da nota dobraria as linhas e o total.
 */
function AP_FLUXO_gravarItensNF_(nota, itens, sessao) {
  AP_FLUXO_abaNFItens_();
  var quem = (sessao && sessao.usuario) || 'sistema';
  var agora = AP_Utils_now();

  /* tira os itens que já estavam nesta nota */
  var existentes = (AP_Data_rows(AP_FLUXO_CFG.abas.nfItens) || [])
    .filter(function (l) { return String(l.nf) === String(nota.numero); });

  existentes.forEach(function (l) {
    AP_Data_remove(AP_FLUXO_CFG.abas.nfItens, l.id);
  });

  var linhas = [];
  var somaItens = 0;

  (itens || []).forEach(function (i, posicao) {
    var qtd = Number(i.qtd !== undefined ? i.qtd : i.quantidade) || 0;
    var vu = Number(i.valorUnitario !== undefined ? i.valorUnitario : i.valor) || 0;

    /* o total do item vem da nota quando ela traz; senão calcula.
       Notas com desconto por item trazem um total que não é
       simplesmente qtd × unitário. */
    var vt = (i.valorTotal !== undefined && i.valorTotal !== null && i.valorTotal !== '')
      ? Number(i.valorTotal) || 0
      : Math.round(qtd * vu * 100) / 100;

    somaItens += vt;

    linhas.push({
      id: AP_Utils_generateId('NFI'),
      nf: nota.numero,
      serie: nota.serie || '',
      sku: i.sku || '',
      codigo: i.codigo || i.cProd || '',
      descricao: i.descricao || i.nome || '',
      ncm: i.ncm || '',
      unidade: i.unidade || 'un',
      quantidade: qtd,
      valorUnitario: vu,
      valorTotal: vt,
      fornecedor: nota.fornecedor || '',
      cnpj: nota.cnpj || '',
      obra: i.obra || nota.obra || '',
      lote: i.lote || '',
      validade: i.validade || '',
      emissao: nota.emissao || '',
      entrada: nota.entrada || agora,
      status: 'REGISTRADO',
      lancadoEm: agora,
      lancadoPor: quem,
      observacao: i.observacao || ''
    });
  });

  if (linhas.length) AP_Data_appendBatch(AP_FLUXO_CFG.abas.nfItens, linhas);

  return {
    gravados: linhas.length,
    substituidos: existentes.length,
    somaItens: Math.round(somaItens * 100) / 100
  };
}

/** Marca os itens como lançados no estoque */
function AP_FLUXO_marcarItensLancados_(numeroNF, sessao) {
  var itens = (AP_Data_rows(AP_FLUXO_CFG.abas.nfItens) || [])
    .filter(function (l) { return String(l.nf) === String(numeroNF); });

  itens.forEach(function (l) {
    AP_Data_update(AP_FLUXO_CFG.abas.nfItens, l.id, {
      status: 'LANCADO',
      lancadoEm: AP_Utils_now(),
      lancadoPor: (sessao && sessao.usuario) || 'sistema'
    });
  });

  return itens.length;
}

/** Os itens de uma nota */
function AP_FLUXO_itensDaNF(numero) {
  AP_FLUXO_abaNFItens_();

  var itens = (AP_Data_rows(AP_FLUXO_CFG.abas.nfItens) || [])
    .filter(function (l) { return String(l.nf) === String(numero); });

  var total = itens.reduce(function (s, i) { return s + (Number(i.valorTotal) || 0); }, 0);
  var quantidade = itens.reduce(function (s, i) { return s + (Number(i.quantidade) || 0); }, 0);

  return {
    ok: true,
    dados: {
      nf: numero,
      itens: itens,
      quantosItens: itens.length,
      quantidadeTotal: quantidade,
      valorTotal: Math.round(total * 100) / 100
    }
  };
}

/** De quais notas veio este material */
function AP_FLUXO_notasDoItem(sku) {
  AP_FLUXO_abaNFItens_();

  /**
   * A ordem é pela data de EMISSÃO da nota, não pela de registro.
   *
   * Duas notas lançadas no mesmo dia têm a mesma data de registro,
   * e aí "última compra" saía na ordem em que foram digitadas —
   * que não é a ordem em que as compras aconteceram.
   */
  var linhas = (AP_Data_rows(AP_FLUXO_CFG.abas.nfItens) || [])
    .filter(function (l) { return l.sku === sku; })
    .sort(function (a, b) {
      var da = String(a.emissao || a.entrada || '');
      var db = String(b.emissao || b.entrada || '');
      if (da === db) return String(b.lancadoEm || '').localeCompare(String(a.lancadoEm || ''));
      return db.localeCompare(da);
    });

  var quantidade = linhas.reduce(function (s, i) { return s + (Number(i.quantidade) || 0); }, 0);
  var valor = linhas.reduce(function (s, i) { return s + (Number(i.valorTotal) || 0); }, 0);

  /* o preço tem histórico: comprar mais caro ou mais barato aparece aqui */
  var precos = linhas.map(function (l) { return Number(l.valorUnitario) || 0; })
    .filter(function (v) { return v > 0; });

  return {
    ok: true,
    dados: {
      sku: sku,
      entradas: linhas,
      quantasNotas: linhas.length,
      quantidadeTotal: quantidade,
      valorTotal: Math.round(valor * 100) / 100,
      precoMedio: precos.length
        ? Math.round((precos.reduce(function (a, b) { return a + b; }, 0) / precos.length) * 100) / 100
        : 0,
      precoMenor: precos.length ? Math.min.apply(null, precos) : 0,
      precoMaior: precos.length ? Math.max.apply(null, precos) : 0,
      ultimaCompra: linhas[0] || null
    }
  };
}

/**
 * Confere se a soma dos itens bate com o valor da nota.
 *
 * Diferença costuma ser frete, desconto ou item digitado errado —
 * e é melhor saber antes de lançar no estoque.
 */
function AP_FLUXO_conferirNF(numero) {
  var nota = AP_FLUXO_ler_('notas').filter(function (x) {
    return String(x.numero) === String(numero);
  })[0];

  if (!nota) return { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Nota não localizada.' };

  var r = AP_FLUXO_itensDaNF(numero);
  var somaItens = r.dados.valorTotal;
  var valorNota = Number(nota.valor) || 0;
  var diferenca = Math.round((valorNota - somaItens) * 100) / 100;

  return {
    ok: true,
    dados: {
      nf: numero,
      valorNota: valorNota,
      somaItens: somaItens,
      diferenca: diferenca,
      confere: Math.abs(diferenca) < 0.02,
      quantosItens: r.dados.quantosItens,
      aviso: Math.abs(diferenca) < 0.02 ? null
        : 'A soma dos itens (' + somaItens.toFixed(2) + ') não bate com o valor da nota (' +
          valorNota.toFixed(2) + '). Diferença de ' + Math.abs(diferenca).toFixed(2) +
          ' — pode ser frete, desconto ou item digitado errado.'
    }
  };
}
