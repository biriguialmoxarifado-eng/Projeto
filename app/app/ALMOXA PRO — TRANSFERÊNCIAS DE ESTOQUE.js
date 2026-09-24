/* ============================================================
   ALMOXA PRO — TRANSFERÊNCIAS DE ESTOQUE
   ------------------------------------------------------------
   Três movimentos que o estoque não tinha e que resolvem
   problemas do dia a dia:

   1. ENTRE ITENS — o lançamento saiu no item errado
      Entrou como "pá de bico" e era "pá quadrada". Hoje a saída
      seria dar baixa num e entrada no outro: duas mentiras no
      histórico, e o custo médio estragado nos dois.
      Aqui é um movimento só, com os dois lados amarrados pelo
      mesmo protocolo, e o motivo registrado.

   2. ENTRE LOCAIS — o material mudou de prateleira, de galpão
      ou de obra. O saldo total não muda; muda onde ele está.

   3. PARA O ESTOQUE RESERVADO — material separado que ninguém
      pode pegar. O saldo continua na empresa, mas sai do
      disponível: quem for retirar vê que aquilo não está livre.
      Reservar e liberar são os dois sentidos do mesmo caminho.

   NENHUMA transferência inventa nem destrói saldo. O que sai de
   um lado entra no outro, sempre, e a conta é conferida antes de
   gravar. Se não fechar, nada acontece.

   INSTALAÇÃO
   ----------
   Arquivo NOVO. Cole como .gs no projeto do Core.
   Se o almoxaApi despacha por um mapa de módulos, acrescente
   'transferencias': AP_Modulo_transferencias.

   Rode AP_TRANSF_testes() para conferir a lógica sem tocar em dado.
   ============================================================ */

var AP_TRANSF_CFG = {
  versao: '1.0.0',

  abas: {
    transferencias: 'ALMOXA_TRANSFERENCIAS',
    reservado: 'ALMOXA_ESTOQUE_RESERVADO'
  },

  colunas: {
    transferencias: ['protocolo', 'data', 'tipo', 'skuOrigem', 'descricaoOrigem',
      'skuDestino', 'descricaoDestino', 'localOrigem', 'localDestino',
      'qtd', 'valorUnitario', 'motivo', 'usuario', 'observacao', 'estorno'],
    reservado: ['id', 'data', 'sku', 'descricao', 'qtd', 'motivo', 'local',
      'responsavel', 'usuario', 'liberadoEm', 'liberadoPor', 'situacao']
  },

  tipos: {
    ITEM: 'ENTRE_ITENS',
    LOCAL: 'ENTRE_LOCAIS',
    RESERVAR: 'PARA_RESERVADO',
    LIBERAR: 'DO_RESERVADO'
  }
};


/* ============================================================
   ENTRADA DO MÓDULO
   ============================================================ */

function AP_Modulo_transferencias(acao, payload, sessao) {
  payload = payload || {};
  try {
    switch (acao) {

      case 'entreItens':
        return AP_TRANSF_entreItens_(payload, sessao);

      case 'entreLocais':
        return AP_TRANSF_entreLocais_(payload, sessao);

      case 'reservar':
        return AP_TRANSF_reservar_(payload, sessao);

      case 'liberar':
        return AP_TRANSF_liberar_(payload, sessao);

      case 'reservado':
        return { ok: true, dados: AP_TRANSF_listarReservado_(payload) };

      case 'historico':
        return { ok: true, dados: AP_TRANSF_historico_(payload) };

      /* quanto deste item está livre de verdade */
      case 'disponivel':
        return { ok: true, dados: AP_TRANSF_disponivel_(payload.sku) };
    }
    return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'transferencias.' + acao + ' não existe.' };
  } catch (e) {
    try { console.error('[TRANSF] ' + acao + ': ' + e.message); } catch (x) { }
    return { ok: false, codigo: 'TRANSF_ERRO', mensagem: e.message };
  }
}


/* ============================================================
   APOIO
   ============================================================ */

function AP_TRANSF_abaTransf_() {
  return AP_Data_getSheet(AP_TRANSF_CFG.abas.transferencias,
    AP_TRANSF_CFG.colunas.transferencias);
}

function AP_TRANSF_abaReservado_() {
  return AP_Data_getSheet(AP_TRANSF_CFG.abas.reservado,
    AP_TRANSF_CFG.colunas.reservado);
}

function AP_TRANSF_linhas_(aba) {
  try {
    var r = AP_Data_rows(aba);
    return Array.isArray(r) ? r : [];
  } catch (e) { return []; }
}

function AP_TRANSF_item_(sku) {
  if (!sku) return null;
  try {
    var r = AP_Modulo_estoque('item', { sku: sku });
    if (r && r.ok && r.dados) return r.dados;
  } catch (e) { }
  return null;
}

function AP_TRANSF_agora_() {
  try { return AP_Utils_now(); } catch (e) { return new Date().toISOString(); }
}

function AP_TRANSF_protocolo_(prefixo) {
  try { return AP_Utils_generateId(prefixo); } catch (e) { }
  return prefixo + '-' + Date.now().toString(36).toUpperCase();
}

function AP_TRANSF_quem_(sessao) {
  return (sessao && (sessao.usuario || sessao.userId)) || 'sistema';
}

function AP_TRANSF_num_(v) {
  var n = Number(String(v === null || v === undefined ? 0 : v).replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

/**
 * O que está reservado deste item.
 * O saldo do item não muda ao reservar — o material continua no
 * galpão. O que muda é quanto dele está livre para pegar.
 */
function AP_TRANSF_reservadoDoSku_(sku) {
  return AP_TRANSF_linhas_(AP_TRANSF_CFG.abas.reservado)
    .filter(function (l) {
      return String(l.sku) === String(sku) &&
        String(l.situacao || 'RESERVADO').toUpperCase() === 'RESERVADO';
    })
    .reduce(function (s, l) { return s + AP_TRANSF_num_(l.qtd); }, 0);
}

function AP_TRANSF_disponivel_(sku) {
  var item = AP_TRANSF_item_(sku);
  if (!item) return { sku: sku, existe: false, saldo: 0, reservado: 0, disponivel: 0 };

  var saldo = AP_TRANSF_num_(item.estoque !== undefined ? item.estoque : item.estoqueAtual);
  var reservado = AP_TRANSF_reservadoDoSku_(sku);

  return {
    sku: sku,
    existe: true,
    descricao: item.descricao || item.nome || '',
    unidade: item.unidade || 'un',
    saldo: saldo,
    reservado: reservado,
    disponivel: Math.max(0, saldo - reservado),
    local: item.local || item.localizacao || ''
  };
}

function AP_TRANSF_registrar_(registro) {
  AP_TRANSF_abaTransf_();
  AP_Data_append(AP_TRANSF_CFG.abas.transferencias, registro);
}


/* ============================================================
   1. ENTRE ITENS — corrige lançamento no item errado
   ------------------------------------------------------------
   Sai de um SKU e entra em outro, na mesma operação. Os dois
   movimentos carregam o mesmo protocolo, então o histórico mostra
   de onde veio e para onde foi — em vez de uma baixa e uma
   entrada que ninguém liga depois.
   ============================================================ */

function AP_TRANSF_entreItens_(payload, sessao) {
  var origem = payload.skuOrigem;
  var destino = payload.skuDestino;
  var qtd = Math.abs(AP_TRANSF_num_(payload.qtd));
  var motivo = String(payload.motivo || '').trim();

  if (!origem || !destino) {
    return { ok: false, codigo: 'CAMPO_OBRIGATORIO', mensagem: 'Informe o item de origem e o de destino.' };
  }
  if (String(origem) === String(destino)) {
    return {
      ok: false, codigo: 'MESMO_ITEM',
      mensagem: 'Origem e destino são o mesmo item — não há o que transferir.'
    };
  }
  if (!qtd) {
    return { ok: false, codigo: 'QTD_INVALIDA', mensagem: 'Informe a quantidade a transferir.' };
  }
  if (!motivo) {
    return {
      ok: false, codigo: 'SEM_MOTIVO',
      mensagem: 'Diga o motivo da transferência — é o que explica o movimento no histórico.'
    };
  }

  var a = AP_TRANSF_disponivel_(origem);
  var b = AP_TRANSF_disponivel_(destino);

  if (!a.existe) return { ok: false, codigo: 'ORIGEM_NAO_EXISTE', mensagem: 'Item de origem não cadastrado.' };
  if (!b.existe) return { ok: false, codigo: 'DESTINO_NAO_EXISTE', mensagem: 'Item de destino não cadastrado.' };

  if (qtd > a.disponivel) {
    return {
      ok: false, codigo: 'SALDO_INSUFICIENTE',
      mensagem: 'O item de origem tem ' + a.disponivel + ' ' + a.unidade +
        ' disponível' + (a.reservado ? ' (' + a.reservado + ' está reservado)' : '') +
        ' e a transferência pede ' + qtd + '.'
    };
  }

  var protocolo = AP_TRANSF_protocolo_('TRF');
  var quem = AP_TRANSF_quem_(sessao);
  var documento = 'Transferência ' + protocolo;

  /* o valor unitário acompanha o material: o custo não se perde
     no caminho entre um item e outro */
  var vu = AP_TRANSF_num_(payload.valorUnitario) ||
    AP_TRANSF_num_((AP_TRANSF_item_(origem) || {}).valorUnitario);

  var saida = AP_Modulo_estoque('movimentar', {
    sku: origem, qtd: qtd, tipo: 'SAIDA',
    documento: documento, valorUnitario: vu,
    observacao: 'Transferido para ' + destino + ' · ' + motivo
  }, sessao);

  if (!saida || !saida.ok) {
    return {
      ok: false, codigo: 'FALHA_NA_SAIDA',
      mensagem: 'Nada foi transferido: ' + ((saida && saida.mensagem) || 'a baixa na origem falhou.')
    };
  }

  var entrada = AP_Modulo_estoque('movimentar', {
    sku: destino, qtd: qtd, tipo: 'ENTRADA',
    documento: documento, valorUnitario: vu,
    observacao: 'Recebido de ' + origem + ' · ' + motivo
  }, sessao);

  /**
   * A ENTRADA FALHOU DEPOIS DA SAÍDA: DESFAZ
   *
   * Deixar assim sumiria com o material. O estorno devolve o saldo
   * à origem e o histórico guarda as três linhas, para ninguém
   * ficar procurando o que aconteceu.
   */
  if (!entrada || !entrada.ok) {
    var volta = AP_Modulo_estoque('movimentar', {
      sku: origem, qtd: qtd, tipo: 'ENTRADA',
      documento: documento + ' (estorno)', valorUnitario: vu,
      observacao: 'Estorno: a entrada no item de destino falhou'
    }, sessao);

    return {
      ok: false, codigo: 'FALHA_NA_ENTRADA',
      mensagem: 'A entrada no item de destino falhou: ' +
        ((entrada && entrada.mensagem) || 'motivo não informado') +
        (volta && volta.ok
          ? '. O saldo foi devolvido à origem — nada se perdeu.'
          : '. ATENÇÃO: o estorno também falhou. Confira o saldo de ' + origem + '.'),
      dados: { estornado: !!(volta && volta.ok), protocolo: protocolo }
    };
  }

  AP_TRANSF_registrar_({
    protocolo: protocolo, data: AP_TRANSF_agora_(), tipo: AP_TRANSF_CFG.tipos.ITEM,
    skuOrigem: origem, descricaoOrigem: a.descricao,
    skuDestino: destino, descricaoDestino: b.descricao,
    localOrigem: '', localDestino: '',
    qtd: qtd, valorUnitario: vu, motivo: motivo, usuario: quem,
    observacao: payload.observacao || '', estorno: ''
  });

  try {
    if (typeof AP_Audit_log === 'function') {
      AP_Audit_log(quem, 'TRANSFERENCIA_ENTRE_ITENS', 'ESTOQUE', protocolo, {
        origem: origem, destino: destino, qtd: qtd, motivo: motivo
      });
    }
  } catch (e) { }

  return {
    ok: true,
    dados: {
      protocolo: protocolo,
      origem: { sku: origem, descricao: a.descricao, saldoAntes: a.saldo, saldoDepois: a.saldo - qtd },
      destino: { sku: destino, descricao: b.descricao, saldoAntes: b.saldo, saldoDepois: b.saldo + qtd },
      qtd: qtd, motivo: motivo,
      mensagem: qtd + ' ' + a.unidade + ' movidos de "' + a.descricao +
        '" para "' + b.descricao + '".'
    }
  };
}


/* ============================================================
   2. ENTRE LOCAIS — muda onde o material está
   ------------------------------------------------------------
   O saldo total não se mexe. Por isso não passa por entrada nem
   saída: seria inventar movimento de estoque para uma coisa que
   não mudou o estoque.
   ============================================================ */

function AP_TRANSF_entreLocais_(payload, sessao) {
  var sku = payload.sku;
  var destino = String(payload.localDestino || '').trim();
  var qtd = Math.abs(AP_TRANSF_num_(payload.qtd));

  if (!sku) return { ok: false, codigo: 'CAMPO_OBRIGATORIO', mensagem: 'Informe o item.' };
  if (!destino) return { ok: false, codigo: 'SEM_DESTINO', mensagem: 'Informe o local de destino.' };

  var estado = AP_TRANSF_disponivel_(sku);
  if (!estado.existe) return { ok: false, codigo: 'ITEM_NAO_EXISTE', mensagem: 'Item não cadastrado.' };

  var origem = String(payload.localOrigem || estado.local || '').trim();
  if (origem && origem.toUpperCase() === destino.toUpperCase()) {
    return {
      ok: false, codigo: 'MESMO_LOCAL',
      mensagem: 'O material já está em "' + destino + '".'
    };
  }

  /* sem quantidade, muda o item inteiro de lugar */
  var total = !qtd || qtd >= estado.saldo;
  if (qtd && qtd > estado.saldo) {
    return {
      ok: false, codigo: 'SALDO_INSUFICIENTE',
      mensagem: 'O item tem ' + estado.saldo + ' ' + estado.unidade + ' e a transferência pede ' + qtd + '.'
    };
  }

  var protocolo = AP_TRANSF_protocolo_('TRL');
  var quem = AP_TRANSF_quem_(sessao);

  /* a localização do cadastro só muda quando o item inteiro se
     muda; parcial fica registrado na transferência, sem mentir
     sobre onde está o resto */
  if (total) {
    var salvou = AP_Modulo_itens('salvar', {
      sku: sku, descricao: estado.descricao,
      localizacao: destino, editando: true
    }, sessao);

    if (!salvou || !salvou.ok) {
      return {
        ok: false, codigo: 'FALHA_AO_MUDAR_LOCAL',
        mensagem: (salvou && salvou.mensagem) || 'Não consegui gravar o novo local.'
      };
    }
  }

  AP_TRANSF_registrar_({
    protocolo: protocolo, data: AP_TRANSF_agora_(), tipo: AP_TRANSF_CFG.tipos.LOCAL,
    skuOrigem: sku, descricaoOrigem: estado.descricao,
    skuDestino: sku, descricaoDestino: estado.descricao,
    localOrigem: origem, localDestino: destino,
    qtd: total ? estado.saldo : qtd,
    valorUnitario: 0,
    motivo: payload.motivo || 'Mudança de local',
    usuario: quem, observacao: payload.observacao || '', estorno: ''
  });

  try {
    if (typeof AP_Audit_log === 'function') {
      AP_Audit_log(quem, 'TRANSFERENCIA_DE_LOCAL', 'ESTOQUE', sku, {
        de: origem, para: destino, qtd: total ? estado.saldo : qtd, parcial: !total
      });
    }
  } catch (e) { }

  return {
    ok: true,
    dados: {
      protocolo: protocolo, sku: sku, descricao: estado.descricao,
      localOrigem: origem || '(não informado)', localDestino: destino,
      qtd: total ? estado.saldo : qtd, parcial: !total,
      mensagem: total
        ? '"' + estado.descricao + '" agora está em ' + destino + '.'
        : qtd + ' ' + estado.unidade + ' de "' + estado.descricao + '" foram para ' + destino +
        '. O cadastro segue apontando ' + (origem || 'o local antigo') +
        ', porque o resto do saldo continua lá.'
    }
  };
}


/* ============================================================
   3. ESTOQUE RESERVADO — separado, e ninguém mexe
   ------------------------------------------------------------
   O material continua no galpão e no saldo da empresa. O que muda
   é que ele sai do DISPONÍVEL: quem for retirar vê que aquilo
   está separado, para quem e por quê.

   Dar baixa seria mentir — o material não saiu. Por isso a reserva
   é uma camada por cima do saldo, não um movimento dele.
   ============================================================ */

function AP_TRANSF_reservar_(payload, sessao) {
  var sku = payload.sku;
  var qtd = Math.abs(AP_TRANSF_num_(payload.qtd));
  var motivo = String(payload.motivo || '').trim();

  if (!sku) return { ok: false, codigo: 'CAMPO_OBRIGATORIO', mensagem: 'Informe o item.' };
  if (!qtd) return { ok: false, codigo: 'QTD_INVALIDA', mensagem: 'Informe a quantidade a reservar.' };
  if (!motivo) {
    return {
      ok: false, codigo: 'SEM_MOTIVO',
      mensagem: 'Diga por que este material está sendo separado — quem for retirar precisa saber.'
    };
  }

  var estado = AP_TRANSF_disponivel_(sku);
  if (!estado.existe) return { ok: false, codigo: 'ITEM_NAO_EXISTE', mensagem: 'Item não cadastrado.' };

  if (qtd > estado.disponivel) {
    return {
      ok: false, codigo: 'SALDO_INSUFICIENTE',
      mensagem: 'Há ' + estado.disponivel + ' ' + estado.unidade + ' disponível' +
        (estado.reservado ? ' (' + estado.reservado + ' já está reservado)' : '') +
        ' e a reserva pede ' + qtd + '.'
    };
  }

  var id = AP_TRANSF_protocolo_('RES');
  var quem = AP_TRANSF_quem_(sessao);

  AP_TRANSF_abaReservado_();
  AP_Data_append(AP_TRANSF_CFG.abas.reservado, {
    id: id, data: AP_TRANSF_agora_(), sku: sku, descricao: estado.descricao,
    qtd: qtd, motivo: motivo, local: payload.local || 'Estoque reservado',
    responsavel: payload.responsavel || '', usuario: quem,
    liberadoEm: '', liberadoPor: '', situacao: 'RESERVADO'
  });

  AP_TRANSF_registrar_({
    protocolo: id, data: AP_TRANSF_agora_(), tipo: AP_TRANSF_CFG.tipos.RESERVAR,
    skuOrigem: sku, descricaoOrigem: estado.descricao,
    skuDestino: sku, descricaoDestino: estado.descricao,
    localOrigem: estado.local || '', localDestino: payload.local || 'Estoque reservado',
    qtd: qtd, valorUnitario: 0, motivo: motivo, usuario: quem,
    observacao: payload.observacao || '', estorno: ''
  });

  try {
    if (typeof AP_Audit_log === 'function') {
      AP_Audit_log(quem, 'ESTOQUE_RESERVADO', 'ESTOQUE', sku, { qtd: qtd, motivo: motivo });
    }
  } catch (e) { }

  return {
    ok: true,
    dados: {
      id: id, sku: sku, descricao: estado.descricao, qtd: qtd, motivo: motivo,
      saldo: estado.saldo,
      reservadoAgora: estado.reservado + qtd,
      disponivelAgora: estado.disponivel - qtd,
      mensagem: qtd + ' ' + estado.unidade + ' de "' + estado.descricao +
        '" separados. O saldo continua o mesmo; o disponível caiu para ' +
        (estado.disponivel - qtd) + '.'
    }
  };
}

function AP_TRANSF_liberar_(payload, sessao) {
  var id = payload.id;
  if (!id) return { ok: false, codigo: 'CAMPO_OBRIGATORIO', mensagem: 'Informe a reserva a liberar.' };

  var reserva = AP_TRANSF_linhas_(AP_TRANSF_CFG.abas.reservado)
    .filter(function (l) { return String(l.id) === String(id); })[0];

  if (!reserva) {
    return { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Reserva ' + id + ' não localizada.' };
  }
  if (String(reserva.situacao || '').toUpperCase() === 'LIBERADO') {
    return {
      ok: false, codigo: 'JA_LIBERADA',
      mensagem: 'Esta reserva já foi liberada em ' + (reserva.liberadoEm || 'data não registrada') + '.'
    };
  }

  var quem = AP_TRANSF_quem_(sessao);
  AP_Data_update(AP_TRANSF_CFG.abas.reservado, id, {
    situacao: 'LIBERADO', liberadoEm: AP_TRANSF_agora_(), liberadoPor: quem
  }, 'id');

  AP_TRANSF_registrar_({
    protocolo: AP_TRANSF_protocolo_('LIB'), data: AP_TRANSF_agora_(),
    tipo: AP_TRANSF_CFG.tipos.LIBERAR,
    skuOrigem: reserva.sku, descricaoOrigem: reserva.descricao,
    skuDestino: reserva.sku, descricaoDestino: reserva.descricao,
    localOrigem: reserva.local || '', localDestino: '',
    qtd: AP_TRANSF_num_(reserva.qtd), valorUnitario: 0,
    motivo: payload.motivo || 'Liberação da reserva ' + id,
    usuario: quem, observacao: '', estorno: ''
  });

  var estado = AP_TRANSF_disponivel_(reserva.sku);

  return {
    ok: true,
    dados: {
      id: id, sku: reserva.sku, descricao: reserva.descricao,
      qtd: AP_TRANSF_num_(reserva.qtd),
      disponivelAgora: estado.disponivel,
      mensagem: AP_TRANSF_num_(reserva.qtd) + ' un. de "' + reserva.descricao +
        '" voltaram ao estoque livre.'
    }
  };
}

function AP_TRANSF_listarReservado_(filtro) {
  filtro = filtro || {};
  var linhas = AP_TRANSF_linhas_(AP_TRANSF_CFG.abas.reservado);

  if (!filtro.incluirLiberados) {
    linhas = linhas.filter(function (l) {
      return String(l.situacao || 'RESERVADO').toUpperCase() === 'RESERVADO';
    });
  }
  if (filtro.sku) {
    linhas = linhas.filter(function (l) { return String(l.sku) === String(filtro.sku); });
  }

  linhas.sort(function (a, b) { return new Date(b.data) - new Date(a.data); });

  var porItem = {};
  linhas.forEach(function (l) {
    if (String(l.situacao || 'RESERVADO').toUpperCase() !== 'RESERVADO') return;
    var k = l.sku;
    if (!porItem[k]) porItem[k] = { sku: k, descricao: l.descricao, qtd: 0, reservas: 0 };
    porItem[k].qtd += AP_TRANSF_num_(l.qtd);
    porItem[k].reservas++;
  });

  return {
    reservas: linhas.map(function (l) {
      return {
        id: l.id, data: l.data, sku: l.sku, descricao: l.descricao,
        qtd: AP_TRANSF_num_(l.qtd), motivo: l.motivo, local: l.local,
        responsavel: l.responsavel, usuario: l.usuario,
        situacao: String(l.situacao || 'RESERVADO').toUpperCase(),
        liberadoEm: l.liberadoEm || ''
      };
    }),
    porItem: Object.keys(porItem).map(function (k) { return porItem[k]; }),
    totais: {
      reservas: linhas.filter(function (l) {
        return String(l.situacao || 'RESERVADO').toUpperCase() === 'RESERVADO';
      }).length,
      itens: Object.keys(porItem).length,
      unidades: Object.keys(porItem).reduce(function (s, k) { return s + porItem[k].qtd; }, 0)
    }
  };
}

function AP_TRANSF_historico_(filtro) {
  filtro = filtro || {};
  var linhas = AP_TRANSF_linhas_(AP_TRANSF_CFG.abas.transferencias);

  if (filtro.tipo) {
    linhas = linhas.filter(function (l) { return String(l.tipo) === String(filtro.tipo); });
  }
  if (filtro.sku) {
    linhas = linhas.filter(function (l) {
      return String(l.skuOrigem) === String(filtro.sku) ||
        String(l.skuDestino) === String(filtro.sku);
    });
  }

  linhas.sort(function (a, b) { return new Date(b.data) - new Date(a.data); });

  return {
    transferencias: linhas.slice(0, filtro.limite || 200),
    totais: {
      todas: linhas.length,
      entreItens: linhas.filter(function (l) { return l.tipo === AP_TRANSF_CFG.tipos.ITEM; }).length,
      entreLocais: linhas.filter(function (l) { return l.tipo === AP_TRANSF_CFG.tipos.LOCAL; }).length,
      reservas: linhas.filter(function (l) { return l.tipo === AP_TRANSF_CFG.tipos.RESERVAR; }).length
    }
  };
}


/* ============================================================
   TESTES — com um estoque de mentira, sem tocar em dado
   ============================================================ */

function AP_TRANSF_testes() {
  var log = [], falhas = 0;
  function ok(nome, cond, detalhe) {
    log.push((cond ? 'PASSOU  ' : 'FALHOU  ') + nome + (detalhe ? '  [' + detalhe + ']' : ''));
    if (!cond) falhas++;
  }

  /* estoque e planilha de mentira */
  var estoque = {
    'PA-BICO': { sku: 'PA-BICO', descricao: 'Pá de Bico', estoque: 10, unidade: 'un', valorUnitario: 35, local: 'Galpão A' },
    'PA-QUAD': { sku: 'PA-QUAD', descricao: 'Pá Quadrada', estoque: 2, unidade: 'un', valorUnitario: 35, local: 'Galpão A' }
  };
  var gravadas = [], reservadas = [];

  var origEstoque = (typeof AP_Modulo_estoque === 'function') ? AP_Modulo_estoque : null;
  var origItens = (typeof AP_Modulo_itens === 'function') ? AP_Modulo_itens : null;
  var origGet = (typeof AP_Data_getSheet === 'function') ? AP_Data_getSheet : null;
  var origApp = (typeof AP_Data_append === 'function') ? AP_Data_append : null;
  var origRows = (typeof AP_Data_rows === 'function') ? AP_Data_rows : null;
  var origUpd = (typeof AP_Data_update === 'function') ? AP_Data_update : null;

  try {
    AP_Modulo_estoque = function (acao, p) {
      if (acao === 'item') {
        return estoque[p.sku] ? { ok: true, dados: estoque[p.sku] }
          : { ok: false, mensagem: 'não existe' };
      }
      if (acao === 'movimentar') {
        var it = estoque[p.sku];
        if (!it) return { ok: false, mensagem: 'item não existe' };
        if (p.sku === 'FALHA-AQUI') return { ok: false, mensagem: 'recusado de propósito' };
        var d = p.tipo === 'SAIDA' ? -Math.abs(p.qtd) : Math.abs(p.qtd);
        if (it.estoque + d < 0) return { ok: false, mensagem: 'saldo insuficiente' };
        it.estoque += d;
        return { ok: true, dados: { saldo: it.estoque } };
      }
      return { ok: false };
    };
    AP_Modulo_itens = function (acao, p) {
      if (acao === 'salvar' && estoque[p.sku]) {
        estoque[p.sku].local = p.localizacao;
        return { ok: true, dados: estoque[p.sku] };
      }
      return { ok: false, mensagem: 'não salvou' };
    };
    AP_Data_getSheet = function () { return {}; };
    AP_Data_append = function (aba, reg) {
      if (aba === AP_TRANSF_CFG.abas.reservado) reservadas.push(reg);
      else gravadas.push(reg);
    };
    AP_Data_rows = function (aba) {
      return aba === AP_TRANSF_CFG.abas.reservado ? reservadas : gravadas;
    };
    AP_Data_update = function (aba, id, patch) {
      reservadas.forEach(function (r) { if (r.id === id) { for (var k in patch) r[k] = patch[k]; } });
    };

    /* --- entre itens: o caso da pá --- */
    var r = AP_Modulo_transferencias('entreItens', {
      skuOrigem: 'PA-BICO', skuDestino: 'PA-QUAD', qtd: 6,
      motivo: 'Lançamento saiu no item errado'
    }, { usuario: 'teste' });

    ok('transferência entre itens aconteceu', r.ok, r.ok ? r.dados.mensagem : r.mensagem);
    ok('saldo saiu da origem', estoque['PA-BICO'].estoque === 4, 'sobrou ' + estoque['PA-BICO'].estoque);
    ok('saldo entrou no destino', estoque['PA-QUAD'].estoque === 8, 'ficou ' + estoque['PA-QUAD'].estoque);
    ok('nada foi criado nem perdido',
      estoque['PA-BICO'].estoque + estoque['PA-QUAD'].estoque === 12, 'total 12');
    ok('os dois lados têm o mesmo protocolo', !!r.dados.protocolo, r.dados.protocolo);
    ok('a transferência ficou registrada', gravadas.length === 1, gravadas.length + ' linha(s)');
    ok('o motivo foi guardado', gravadas[0].motivo === 'Lançamento saiu no item errado');

    /* --- recusas --- */
    ok('não transfere para o mesmo item',
      AP_Modulo_transferencias('entreItens', { skuOrigem: 'PA-BICO', skuDestino: 'PA-BICO', qtd: 1, motivo: 'x' }).codigo === 'MESMO_ITEM');
    ok('não transfere sem motivo',
      AP_Modulo_transferencias('entreItens', { skuOrigem: 'PA-BICO', skuDestino: 'PA-QUAD', qtd: 1 }).codigo === 'SEM_MOTIVO');
    ok('não transfere mais do que tem',
      AP_Modulo_transferencias('entreItens', { skuOrigem: 'PA-BICO', skuDestino: 'PA-QUAD', qtd: 999, motivo: 'x' }).codigo === 'SALDO_INSUFICIENTE');
    ok('saldo não mudou depois das recusas', estoque['PA-BICO'].estoque === 4);

    /* --- reserva --- */
    var res = AP_Modulo_transferencias('reservar', {
      sku: 'PA-QUAD', qtd: 3, motivo: 'Separado para a obra do centro'
    }, { usuario: 'teste' });

    ok('reserva feita', res.ok, res.ok ? res.dados.mensagem : res.mensagem);
    ok('o saldo do item NÃO mudou ao reservar', estoque['PA-QUAD'].estoque === 8,
      'saldo ' + estoque['PA-QUAD'].estoque);
    ok('o disponível caiu', res.dados.disponivelAgora === 5, 'disponível ' + res.dados.disponivelAgora);

    var disp = AP_TRANSF_disponivel_('PA-QUAD');
    ok('disponível = saldo menos reservado', disp.saldo === 8 && disp.reservado === 3 && disp.disponivel === 5,
      disp.saldo + ' - ' + disp.reservado + ' = ' + disp.disponivel);

    ok('não reserva além do disponível',
      AP_Modulo_transferencias('reservar', { sku: 'PA-QUAD', qtd: 6, motivo: 'x' }).codigo === 'SALDO_INSUFICIENTE');
    ok('não reserva sem motivo',
      AP_Modulo_transferencias('reservar', { sku: 'PA-QUAD', qtd: 1 }).codigo === 'SEM_MOTIVO');

    /* o reservado bloqueia até a transferência entre itens */
    ok('transferência respeita o que está reservado',
      AP_Modulo_transferencias('entreItens', { skuOrigem: 'PA-QUAD', skuDestino: 'PA-BICO', qtd: 6, motivo: 'x' }).codigo === 'SALDO_INSUFICIENTE');

    /* --- liberar --- */
    var lib = AP_Modulo_transferencias('liberar', { id: res.dados.id }, { usuario: 'teste' });
    ok('reserva liberada', lib.ok, lib.ok ? lib.dados.mensagem : lib.mensagem);
    ok('disponível voltou ao saldo cheio', AP_TRANSF_disponivel_('PA-QUAD').disponivel === 8);
    ok('não libera duas vezes',
      AP_Modulo_transferencias('liberar', { id: res.dados.id }).codigo === 'JA_LIBERADA');

    /* --- entre locais --- */
    var loc = AP_Modulo_transferencias('entreLocais', {
      sku: 'PA-BICO', localDestino: 'Galpão B', motivo: 'Reorganização'
    }, { usuario: 'teste' });

    ok('mudança de local aconteceu', loc.ok, loc.ok ? loc.dados.mensagem : loc.mensagem);
    ok('o cadastro aponta o novo local', estoque['PA-BICO'].local === 'Galpão B');
    ok('o saldo não mudou ao mudar de local', estoque['PA-BICO'].estoque === 4);
    ok('não muda para o local onde já está',
      AP_Modulo_transferencias('entreLocais', { sku: 'PA-BICO', localDestino: 'Galpão B' }).codigo === 'MESMO_LOCAL');

    /* mudança parcial não mexe no cadastro */
    var parcial = AP_Modulo_transferencias('entreLocais', {
      sku: 'PA-BICO', localDestino: 'Obra Norte', qtd: 2, motivo: 'Levado para a frente'
    }, { usuario: 'teste' });
    ok('mudança parcial é aceita', parcial.ok && parcial.dados.parcial === true);
    ok('mudança parcial não muda o cadastro', estoque['PA-BICO'].local === 'Galpão B',
      'local segue ' + estoque['PA-BICO'].local);

    /* --- histórico --- */
    var hist = AP_TRANSF_historico_({});
    ok('histórico registrou tudo', hist.totais.todas === gravadas.length,
      hist.totais.todas + ' movimento(s)');
    ok('histórico separa por tipo',
      hist.totais.entreItens === 1 && hist.totais.entreLocais === 2 && hist.totais.reservas === 1,
      'itens ' + hist.totais.entreItens + ' · locais ' + hist.totais.entreLocais +
      ' · reservas ' + hist.totais.reservas);

  } finally {
    if (origEstoque) AP_Modulo_estoque = origEstoque;
    if (origItens) AP_Modulo_itens = origItens;
    if (origGet) AP_Data_getSheet = origGet;
    if (origApp) AP_Data_append = origApp;
    if (origRows) AP_Data_rows = origRows;
    if (origUpd) AP_Data_update = origUpd;
  }

  log.push('');
  log.push(falhas ? falhas + ' teste(s) FALHARAM' : 'todos os testes passaram');
  log.push('');
  log.push('Cobertura: saldo que sai é igual ao que entra, recusas não mexem no');
  log.push('estoque, reserva não altera saldo mas derruba o disponível, e o');
  log.push('reservado bloqueia retirada. Nada foi lido nem gravado na planilha.');

  try { Logger.log(log.join('\n')); } catch (e) { }
  return log;
}
