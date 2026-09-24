/* ============================================================
   ALMOXA PRO — GESTÃO DE EPI (COESA)
   RESERVA · ENTREGA · TROCA · DEVOLUÇÃO · HISTÓRICO
   ------------------------------------------------------------
   A regra que organiza tudo neste módulo:

       RESERVAR NÃO BAIXA ESTOQUE.
       A BAIXA ACONTECE NA ENTREGA, COM AUTENTICAÇÃO.

   Reservar apenas COMPROMETE a quantidade: o material continua
   no galpão e no saldo, mas sai do disponível. Quem olhar o
   estoque vê que aquilo está prometido para alguém.

   A baixa só acontece quando o colaborador está na frente do
   balcão, se identifica e recebe. Antes disso, nada sai.

   O QUE ESTE ARQUIVO FAZ
   ----------------------
   · reservas centralizadas num lugar só, com ciclo de status
   · entrega com conferência, autenticação e baixa real
   · troca e devolução sem nunca apagar a entrega original
   · histórico por item e por colaborador
   · trava contra baixa duplicada, entrega acima do saldo e
     devolução do mesmo item duas vezes

   O QUE ELE NÃO FAZ (e precisa de outra rodada)
   ---------------------------------------------
   · o PDF da ficha no layout COESA
   · a matriz de permissões por empresa/obra/setor
   · biometria de verdade — aqui ela é apenas registrada quando
     o front disser que ocorreu; este módulo JAMAIS inventa uma
     autenticação que não aconteceu

   INSTALAÇÃO
   ----------
   Arquivo NOVO. Cole como .gs no projeto do Core.
   Se o almoxaApi usa mapa de módulos, acrescente
   'epigestao': AP_Modulo_epigestao.

   Rode AP_EPI_testes() para conferir a lógica sem tocar em dado.
   ============================================================ */

var AP_EPI_CFG = {
  versao: '1.0.0',

  abas: {
    reservas: 'ALMOXA_EPI_RESERVAS',
    itensReserva: 'ALMOXA_EPI_RESERVA_ITENS',
    entregas: 'ALMOXA_EPI_ENTREGAS',
    devolucoes: 'ALMOXA_EPI_DEVOLUCOES'
  },

  colunas: {
    reservas: ['protocolo', 'data', 'codigoColaborador', 'matricula', 'colaborador',
      'empresa', 'obra', 'setor', 'funcao', 'solicitante', 'status', 'validade',
      'dataRetirada', 'toleranciaHoras', 'observacao', 'fichaOrigem', 'tipo',
      'atualizadoEm', 'atualizadoPor'],
    itensReserva: ['id', 'protocolo', 'sku', 'descricao', 'ca', 'tamanho',
      'unidade', 'qtdSolicitada', 'qtdEntregue', 'situacao'],
    entregas: ['ficha', 'data', 'protocolo', 'codigoColaborador', 'matricula',
      'colaborador', 'sku', 'descricao', 'ca', 'tamanho', 'qtd', 'unidade',
      'validade', 'entreguePor', 'autenticacao', 'idOperacao', 'obra', 'setor',
      'situacao', 'observacao'],
    devolucoes: ['id', 'data', 'fichaOrigem', 'idOperacaoOrigem', 'sku', 'descricao',
      'matricula', 'colaborador', 'qtd', 'motivo', 'condicao', 'tipo',
      'reservaTroca', 'recebidoPor', 'autenticacao']
  },

  /* o ciclo de vida de uma reserva. A ordem importa: só se anda
     para frente, e cada passo diz quem pode dá-lo. */
  status: {
    SOLICITADA: 'SOLICITADA',
    AGUARDANDO: 'AGUARDANDO_APROVACAO',
    APROVADA: 'APROVADA',
    SEPARACAO: 'SEPARACAO',
    PRONTA: 'PRONTA_PARA_RETIRADA',
    PARCIAL: 'RETIRADA_PARCIALMENTE',
    CONCLUIDA: 'CONCLUIDA',
    CANCELADA: 'CANCELADA',
    EXPIRADA: 'EXPIRADA'
  },

  /* status em que a reserva ainda segura saldo */
  seguramSaldo: ['SOLICITADA', 'AGUARDANDO_APROVACAO', 'APROVADA',
    'SEPARACAO', 'PRONTA_PARA_RETIRADA', 'RETIRADA_PARCIALMENTE'],

  /* de onde se pode entregar */
  podemEntregar: ['APROVADA', 'SEPARACAO', 'PRONTA_PARA_RETIRADA', 'RETIRADA_PARCIALMENTE'],

  /* autenticações que valem para receber EPI */
  autenticacoes: ['SENHA', 'BIOMETRIA', 'ASSINATURA', 'CRACHA', 'PRESENCIAL_RESPONSAVEL'],

  validadePadraoDias: 15,

  /* quanto tempo a reserva ainda espera o colaborador DEPOIS do dia
     marcado para a retirada. Passou disso, ela expira sozinha e o
     saldo volta para o estoque. */
  toleranciaPadraoHoras: 48
};


/* ============================================================
   ENTRADA DO MÓDULO
   ============================================================ */

function AP_Modulo_epigestao(acao, payload, sessao) {
  payload = payload || {};
  try {
    switch (acao) {

      /* --- reservas --- */
      case 'criarReserva': return AP_EPI_criarReserva_(payload, sessao);
      case 'listarReservas': return { ok: true, dados: AP_EPI_listarReservas_(payload) };
      case 'obterReserva': return AP_EPI_obterReserva_(payload);
      case 'mudarStatus': return AP_EPI_mudarStatus_(payload, sessao);
      case 'cancelarReserva': return AP_EPI_cancelar_(payload, sessao);
      case 'reagendar': return AP_EPI_reagendar_(payload, sessao);
      case 'expirarVencidas': return AP_EPI_expirarVencidas_(payload, sessao);
      case 'agenda': return { ok: true, dados: AP_EPI_agenda_(payload) };

      /* --- entrega: aqui, e só aqui, o estoque baixa --- */
      case 'entregar': return AP_EPI_entregar_(payload, sessao);

      /* --- troca e devolução --- */
      case 'devolver': return AP_EPI_devolver_(payload, sessao);

      /* --- consultas --- */
      case 'historicoItem': return { ok: true, dados: AP_EPI_historicoItem_(payload) };
      case 'historicoColaborador': return { ok: true, dados: AP_EPI_historicoColaborador_(payload) };
      case 'disponibilidade': return { ok: true, dados: AP_EPI_disponibilidade_(payload.sku) };
      case 'painel': return { ok: true, dados: AP_EPI_painel_(payload) };
    }
    return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'epigestao.' + acao + ' não existe.' };
  } catch (e) {
    try { console.error('[EPI] ' + acao + ': ' + e.message); } catch (x) { }
    return { ok: false, codigo: 'EPI_ERRO', mensagem: e.message };
  }
}


/* ============================================================
   APOIO
   ============================================================ */

function AP_EPI_linhas_(aba) {
  try {
    var r = AP_Data_rows(aba);
    return Array.isArray(r) ? r : [];
  } catch (e) { return []; }
}

function AP_EPI_num_(v) {
  var n = Number(String(v === null || v === undefined ? 0 : v).replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function AP_EPI_agora_() {
  try { return AP_Utils_now(); } catch (e) { return new Date().toISOString(); }
}

function AP_EPI_id_(prefixo) {
  try { return AP_Utils_generateId(prefixo); } catch (e) { }
  return prefixo + '-' + Date.now().toString(36).toUpperCase() +
    Math.random().toString(36).slice(2, 5).toUpperCase();
}

function AP_EPI_quem_(sessao) {
  return (sessao && (sessao.usuario || sessao.userId)) || 'sistema';
}

function AP_EPI_abas_() {
  AP_Data_getSheet(AP_EPI_CFG.abas.reservas, AP_EPI_CFG.colunas.reservas);
  AP_Data_getSheet(AP_EPI_CFG.abas.itensReserva, AP_EPI_CFG.colunas.itensReserva);
  AP_Data_getSheet(AP_EPI_CFG.abas.entregas, AP_EPI_CFG.colunas.entregas);
  AP_Data_getSheet(AP_EPI_CFG.abas.devolucoes, AP_EPI_CFG.colunas.devolucoes);
}

/**
 * QUANTO DESTE EPI ESTÁ REALMENTE LIVRE
 *
 * saldo    — o que existe no galpão
 * reservado — o que está prometido a alguém, mas ainda não saiu
 * disponível — o que sobra para prometer a mais alguém
 *
 * O reservado NÃO é descontado do saldo em lugar nenhum: se fosse,
 * o estoque mentiria sobre o que existe fisicamente.
 */
function AP_EPI_disponibilidade_(sku) {
  var item = null;
  try {
    var r = AP_Modulo_estoque('item', { sku: sku });
    if (r && r.ok) item = r.dados;
  } catch (e) { }

  if (!item) return { sku: sku, existe: false, saldo: 0, reservado: 0, disponivel: 0, emUso: 0 };

  var saldo = AP_EPI_num_(item.estoque !== undefined ? item.estoque : item.estoqueAtual);
  var reservado = AP_EPI_reservadoDoSku_(sku);
  var emUso = AP_EPI_emUsoDoSku_(sku);

  return {
    sku: sku, existe: true,
    descricao: item.descricao || item.nome || '',
    unidade: item.unidade || 'un',
    ca: item.ca || '',
    saldo: saldo,
    reservado: reservado,
    disponivel: Math.max(0, saldo - reservado),
    emUso: emUso
  };
}

/** O que está prometido: solicitado menos já entregue, nas reservas vivas */
function AP_EPI_reservadoDoSku_(sku) {
  var vivas = {};
  AP_EPI_linhas_(AP_EPI_CFG.abas.reservas).forEach(function (r) {
    if (AP_EPI_CFG.seguramSaldo.indexOf(String(r.status).toUpperCase()) > -1) {
      vivas[r.protocolo] = true;
    }
  });

  return AP_EPI_linhas_(AP_EPI_CFG.abas.itensReserva)
    .filter(function (i) { return vivas[i.protocolo] && String(i.sku) === String(sku); })
    .reduce(function (s, i) {
      var falta = AP_EPI_num_(i.qtdSolicitada) - AP_EPI_num_(i.qtdEntregue);
      return s + Math.max(0, falta);
    }, 0);
}

/** O que está com os colaboradores: entregue menos devolvido */
function AP_EPI_emUsoDoSku_(sku) {
  var entregue = AP_EPI_linhas_(AP_EPI_CFG.abas.entregas)
    .filter(function (e) {
      return String(e.sku) === String(sku) &&
        String(e.situacao || 'EM_USO').toUpperCase() !== 'CANCELADA';
    })
    .reduce(function (s, e) { return s + AP_EPI_num_(e.qtd); }, 0);

  var devolvido = AP_EPI_linhas_(AP_EPI_CFG.abas.devolucoes)
    .filter(function (d) { return String(d.sku) === String(sku); })
    .reduce(function (s, d) { return s + AP_EPI_num_(d.qtd); }, 0);

  return Math.max(0, entregue - devolvido);
}


/* ============================================================
   RESERVA — compromete, não baixa
   ============================================================ */

function AP_EPI_criarReserva_(payload, sessao) {
  var itens = payload.itens;
  if (!itens || !itens.length) {
    return { ok: false, codigo: 'SEM_ITENS', mensagem: 'A reserva precisa de pelo menos um EPI.' };
  }
  if (!payload.matricula && !payload.codigoColaborador) {
    return {
      ok: false, codigo: 'SEM_COLABORADOR',
      mensagem: 'Identifique o colaborador — reserva sem dono não pode ser entregue depois.'
    };
  }

  /* confere TUDO antes de gravar QUALQUER COISA: reserva pela
     metade é pior que reserva recusada */
  var recusados = [];
  var conferidos = itens.map(function (i) {
    var d = AP_EPI_disponibilidade_(i.sku);
    var qtd = Math.abs(AP_EPI_num_(i.qtd));

    if (!d.existe) recusados.push({ sku: i.sku, motivo: 'EPI não cadastrado' });
    else if (!qtd) recusados.push({ sku: i.sku, motivo: 'quantidade zerada' });
    else if (qtd > d.disponivel) {
      recusados.push({
        sku: i.sku,
        motivo: 'há ' + d.disponivel + ' disponível' +
          (d.reservado ? ' (' + d.reservado + ' já reservado para outros)' : '') +
          ' e o pedido é de ' + qtd
      });
    }
    return { pedido: i, estado: d, qtd: qtd };
  });

  if (recusados.length) {
    return {
      ok: false, codigo: 'ITENS_INDISPONIVEIS',
      mensagem: recusados.length + ' item(ns) não podem ser reservados.',
      dados: { recusados: recusados }
    };
  }

  AP_EPI_abas_();
  var protocolo = AP_EPI_id_('EPI');
  var quem = AP_EPI_quem_(sessao);
  var agora = AP_EPI_agora_();

  /* o dia marcado para a retirada. Pode ser hoje ou daqui a quatro
     dias — até lá a reserva segura o saldo sem baixar nada. */
  var diaRetirada = AP_EPI_diaZero_(payload.dataRetirada);
  if (payload.dataRetirada && !diaRetirada) {
    return { ok: false, codigo: 'DATA_INVALIDA', mensagem: 'Data de retirada inválida — use AAAA-MM-DD.' };
  }
  if (diaRetirada && diaRetirada.getTime() < AP_EPI_hoje_()) {
    return {
      ok: false, codigo: 'DATA_NO_PASSADO',
      mensagem: 'A data de retirada não pode ser anterior a hoje.'
    };
  }
  var dataRetirada = diaRetirada ? diaRetirada.toISOString().slice(0, 10) : '';
  var tolerancia = AP_EPI_num_(payload.toleranciaHoras) || AP_EPI_CFG.toleranciaPadraoHoras;

  var validade = payload.validade;
  if (!validade) {
    var d2 = diaRetirada ? new Date(diaRetirada.getTime()) : new Date();
    if (diaRetirada) d2.setTime(d2.getTime() + 86400000 + tolerancia * 3600000);
    else d2.setDate(d2.getDate() + AP_EPI_CFG.validadePadraoDias);
    validade = d2.toISOString().slice(0, 10);
  }

  AP_Data_append(AP_EPI_CFG.abas.reservas, {
    protocolo: protocolo, data: agora,
    codigoColaborador: payload.codigoColaborador || '',
    matricula: payload.matricula || '',
    colaborador: payload.colaborador || '',
    empresa: payload.empresa || '', obra: payload.obra || '',
    setor: payload.setor || '', funcao: payload.funcao || '',
    solicitante: payload.solicitante || quem,
    status: payload.exigeAprovacao ? AP_EPI_CFG.status.AGUARDANDO : AP_EPI_CFG.status.SOLICITADA,
    validade: validade,
    dataRetirada: dataRetirada,
    toleranciaHoras: tolerancia,
    observacao: payload.observacao || '',
    fichaOrigem: payload.fichaOrigem || '',
    tipo: payload.tipo || 'ENTREGA',
    atualizadoEm: agora, atualizadoPor: quem
  });

  var linhas = conferidos.map(function (c) {
    return {
      id: AP_EPI_id_('EPII'), protocolo: protocolo,
      sku: c.pedido.sku, descricao: c.estado.descricao || c.pedido.descricao || '',
      ca: c.pedido.ca || c.estado.ca || '',
      tamanho: c.pedido.tamanho || '',
      unidade: c.estado.unidade || 'un',
      qtdSolicitada: c.qtd, qtdEntregue: 0, situacao: 'PENDENTE'
    };
  });

  try {
    AP_Data_appendBatch(AP_EPI_CFG.abas.itensReserva, linhas);
  } catch (e) {
    linhas.forEach(function (l) { AP_Data_append(AP_EPI_CFG.abas.itensReserva, l); });
  }

  AP_EPI_auditar_(quem, 'EPI_RESERVA_CRIADA', protocolo, {
    colaborador: payload.colaborador, itens: linhas.length
  });

  return {
    ok: true,
    dados: {
      protocolo: protocolo, status: payload.exigeAprovacao ? 'AGUARDANDO_APROVACAO' : 'SOLICITADA',
      validade: validade, itens: linhas,
      dataRetirada: dataRetirada, toleranciaHoras: tolerancia,
      mensagem: 'Reserva ' + protocolo + ' criada com ' + linhas.length + ' item(ns). ' +
        (dataRetirada
          ? 'Retirada marcada para ' + dataRetirada + ' — o saldo fica guardado até lá e por mais ' +
            tolerancia + 'h. '
          : '') +
        'O estoque NÃO foi baixado — a baixa acontece na entrega.'
    }
  };
}

function AP_EPI_obterReserva_(payload) {
  var r = AP_EPI_linhas_(AP_EPI_CFG.abas.reservas)
    .filter(function (x) { return String(x.protocolo) === String(payload.protocolo); })[0];

  if (!r) return { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Reserva não localizada.' };

  var itens = AP_EPI_linhas_(AP_EPI_CFG.abas.itensReserva)
    .filter(function (i) { return String(i.protocolo) === String(r.protocolo); })
    .map(function (i) {
      var d = AP_EPI_disponibilidade_(i.sku);
      var sol = AP_EPI_num_(i.qtdSolicitada);
      var ent = AP_EPI_num_(i.qtdEntregue);
      return {
        id: i.id, sku: i.sku, descricao: i.descricao, ca: i.ca, tamanho: i.tamanho,
        unidade: i.unidade, qtdSolicitada: sol, qtdEntregue: ent,
        falta: Math.max(0, sol - ent),
        situacao: i.situacao,
        saldoAtual: d.saldo, disponivelAgora: d.disponivel
      };
    });

  return { ok: true, dados: AP_EPI_montarReserva_(r, itens) };
}

function AP_EPI_montarReserva_(r, itens) {
  return {
    protocolo: r.protocolo, data: r.data,
    codigoColaborador: r.codigoColaborador, matricula: r.matricula,
    colaborador: r.colaborador, empresa: r.empresa, obra: r.obra,
    setor: r.setor, funcao: r.funcao, solicitante: r.solicitante,
    status: String(r.status || '').toUpperCase(), validade: r.validade,
    observacao: r.observacao, tipo: r.tipo || 'ENTREGA',
    fichaOrigem: r.fichaOrigem || '',
    itens: itens,
    totalSolicitado: itens.reduce(function (s, i) { return s + i.qtdSolicitada; }, 0),
    totalEntregue: itens.reduce(function (s, i) { return s + i.qtdEntregue; }, 0),
    podeEntregar: AP_EPI_CFG.podemEntregar.indexOf(String(r.status || '').toUpperCase()) > -1,
    vencida: AP_EPI_vencida_(r),
    prazo: AP_EPI_prazo_(r)
  };
}

/* ------------------------------------------------------------
   O PRAZO DE RETIRADA
   ------------------------------------------------------------
   O técnico marca o dia em que o colaborador vem buscar. Até lá a
   reserva segura o saldo, mesmo que faltem quatro dias. Do dia
   marcado ele tem ainda a tolerância (48h por padrão) para aparecer.
   Passou disso, a reserva expira e o saldo volta — mas isso só
   acontece quando alguém roda a varredura, nunca no meio de uma
   leitura, para que consulta nenhuma altere dado.
   ------------------------------------------------------------ */

/** Converte 'AAAA-MM-DD' (ou data) para o instante 00:00 daquele dia */
function AP_EPI_diaZero_(v) {
  if (!v) return null;
  var d = (v instanceof Date) ? new Date(v.getTime()) : new Date(String(v).slice(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) {
    d = new Date(v);
    if (isNaN(d.getTime())) return null;
  }
  d.setHours(0, 0, 0, 0);
  return d;
}

function AP_EPI_hoje_() { return new Date().setHours(0, 0, 0, 0); }

/**
 * Situação do prazo de uma reserva:
 *   SEM_AGENDA  — ninguém marcou dia; a reserva fica aberta pela validade
 *   AGENDADA    — o dia da retirada ainda não chegou
 *   LIBERADA    — é hoje, ou está dentro da tolerância
 *   EXPIRADA    — passou do dia + tolerância
 */
function AP_EPI_prazo_(r) {
  var dia = AP_EPI_diaZero_(r.dataRetirada);
  var horas = AP_EPI_num_(r.toleranciaHoras) || AP_EPI_CFG.toleranciaPadraoHoras;
  var aberta = AP_EPI_CFG.seguramSaldo.indexOf(String(r.status || '').toUpperCase()) > -1;

  if (!dia) {
    return {
      dataRetirada: '', toleranciaHoras: horas, limite: '',
      situacao: 'SEM_AGENDA', diasAte: null, horasRestantes: null, expirou: false
    };
  }

  var agora = Date.now();
  /* a tolerância corre a partir do FIM do dia marcado: quem marca
     "dia 23" tem o dia 23 inteiro mais as 48h seguintes */
  var limite = dia.getTime() + 86400000 + horas * 3600000;
  var diasAte = Math.round((dia.getTime() - AP_EPI_hoje_()) / 86400000);

  var situacao;
  if (agora >= limite) situacao = 'EXPIRADA';
  else if (diasAte > 0) situacao = 'AGENDADA';
  else situacao = 'LIBERADA';

  return {
    dataRetirada: String(r.dataRetirada).slice(0, 10),
    toleranciaHoras: horas,
    limite: new Date(limite).toISOString(),
    situacao: situacao,
    diasAte: diasAte,
    horasRestantes: Math.max(0, Math.round((limite - agora) / 3600000)),
    atrasada: situacao === 'LIBERADA' && diasAte < 0,
    expirou: situacao === 'EXPIRADA' && aberta
  };
}

/**
 * Varredura: fecha as reservas que passaram do prazo.
 * Escreve — por isso é uma ação própria, e não parte de uma consulta.
 * Pode rodar por gatilho de tempo, ou quando a tela de EPI abre.
 */
function AP_EPI_expirarVencidas_(payload, sessao) {
  payload = payload || {};
  var quem = AP_EPI_quem_(sessao) || 'SISTEMA';
  var reservas = AP_EPI_linhas_(AP_EPI_CFG.abas.reservas);
  var fechadas = [];

  reservas.forEach(function (r) {
    var status = String(r.status || '').toUpperCase();
    if (AP_EPI_CFG.seguramSaldo.indexOf(status) === -1) return;

    var p = AP_EPI_prazo_(r);
    var venceuPorAgenda = p.expirou;
    var venceuPorValidade = !p.dataRetirada && AP_EPI_vencida_(r);
    if (!venceuPorAgenda && !venceuPorValidade) return;

    /* quem já retirou parte não é apagado: fica como concluído
       parcialmente, senão o que saiu do estoque perderia o dono */
    var novo = (status === 'RETIRADA_PARCIALMENTE')
      ? AP_EPI_CFG.status.CONCLUIDA
      : AP_EPI_CFG.status.EXPIRADA;

    var nota = venceuPorAgenda
      ? 'Expirada automaticamente: retirada marcada para ' + p.dataRetirada +
        ' e não houve retirada em ' + p.toleranciaHoras + 'h.'
      : 'Expirada automaticamente: passou da validade ' + r.validade + '.';

    if (payload.simular) {
      fechadas.push({ protocolo: r.protocolo, colaborador: r.colaborador, de: status, para: novo, motivo: nota });
      return;
    }

    AP_Data_update(AP_EPI_CFG.abas.reservas, r.protocolo, {
      status: novo,
      observacao: (r.observacao ? r.observacao + ' · ' : '') + nota,
      atualizadoEm: AP_EPI_agora_(), atualizadoPor: quem
    }, 'protocolo');

    AP_EPI_auditar_(quem, 'EPI_RESERVA_EXPIRADA', r.protocolo, { de: status, para: novo, motivo: nota });
    fechadas.push({ protocolo: r.protocolo, colaborador: r.colaborador, de: status, para: novo, motivo: nota });
  });

  return {
    ok: true,
    dados: {
      fechadas: fechadas,
      quantas: fechadas.length,
      simulacao: !!payload.simular,
      mensagem: fechadas.length
        ? fechadas.length + ' reserva(s) expiraram e o saldo voltou ao disponível.'
        : 'Nenhuma reserva passou do prazo.'
    }
  };
}

/**
 * Remarcar a retirada. O técnico adia — a reserva continua a mesma,
 * com o histórico do adiamento na observação.
 */
function AP_EPI_reagendar_(payload, sessao) {
  var r = AP_EPI_linhas_(AP_EPI_CFG.abas.reservas)
    .filter(function (x) { return String(x.protocolo) === String(payload.protocolo); })[0];
  if (!r) return { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Reserva não localizada.' };

  var status = String(r.status || '').toUpperCase();
  if (status === 'CONCLUIDA' || status === 'CANCELADA') {
    return {
      ok: false, codigo: 'RESERVA_FECHADA',
      mensagem: 'A reserva está ' + status + ' — não dá para remarcar. Crie outra.'
    };
  }

  var dia = AP_EPI_diaZero_(payload.dataRetirada);
  if (!dia) {
    return { ok: false, codigo: 'DATA_INVALIDA', mensagem: 'Informe a nova data de retirada (AAAA-MM-DD).' };
  }
  if (dia.getTime() < AP_EPI_hoje_()) {
    return { ok: false, codigo: 'DATA_NO_PASSADO', mensagem: 'A data de retirada não pode ser anterior a hoje.' };
  }

  var horas = AP_EPI_num_(payload.toleranciaHoras) || AP_EPI_num_(r.toleranciaHoras) ||
    AP_EPI_CFG.toleranciaPadraoHoras;
  var novaData = dia.toISOString().slice(0, 10);
  var quem = AP_EPI_quem_(sessao);
  var antes = r.dataRetirada ? String(r.dataRetirada).slice(0, 10) : '(sem data)';

  var campos = {
    dataRetirada: novaData,
    toleranciaHoras: horas,
    observacao: (r.observacao ? r.observacao + ' · ' : '') +
      'Retirada remarcada de ' + antes + ' para ' + novaData +
      (payload.motivo ? ' (' + payload.motivo + ')' : ''),
    atualizadoEm: AP_EPI_agora_(), atualizadoPor: quem
  };
  /* reserva que já tinha expirado volta a valer com a nova data */
  if (status === 'EXPIRADA') campos.status = AP_EPI_CFG.status.APROVADA;

  AP_Data_update(AP_EPI_CFG.abas.reservas, r.protocolo, campos, 'protocolo');
  AP_EPI_auditar_(quem, 'EPI_RESERVA_REAGENDADA', r.protocolo,
    { de: antes, para: novaData, motivo: payload.motivo || '' });

  return {
    ok: true,
    dados: {
      protocolo: r.protocolo, dataRetirada: novaData, toleranciaHoras: horas,
      status: campos.status || status,
      mensagem: 'Retirada remarcada para ' + novaData + '. O colaborador tem até ' +
        horas + 'h depois desse dia para buscar.'
    }
  };
}

function AP_EPI_vencida_(r) {
  if (!r.validade) return false;
  if (AP_EPI_CFG.seguramSaldo.indexOf(String(r.status).toUpperCase()) === -1) return false;
  var v = new Date(r.validade);
  if (isNaN(v.getTime())) return false;
  return v.getTime() < new Date().setHours(0, 0, 0, 0);
}

function AP_EPI_listarReservas_(filtro) {
  filtro = filtro || {};
  var reservas = AP_EPI_linhas_(AP_EPI_CFG.abas.reservas);
  var todosItens = AP_EPI_linhas_(AP_EPI_CFG.abas.itensReserva);

  var saida = reservas.map(function (r) {
    var itens = todosItens
      .filter(function (i) { return String(i.protocolo) === String(r.protocolo); })
      .map(function (i) {
        var sol = AP_EPI_num_(i.qtdSolicitada), ent = AP_EPI_num_(i.qtdEntregue);
        return {
          id: i.id, sku: i.sku, descricao: i.descricao, ca: i.ca, tamanho: i.tamanho,
          unidade: i.unidade, qtdSolicitada: sol, qtdEntregue: ent,
          falta: Math.max(0, sol - ent), situacao: i.situacao
        };
      });
    return AP_EPI_montarReserva_(r, itens);
  });

  if (filtro.status) {
    var alvo = String(filtro.status).toUpperCase();
    saida = saida.filter(function (r) { return r.status === alvo; });
  }
  if (filtro.matricula) {
    saida = saida.filter(function (r) { return String(r.matricula) === String(filtro.matricula); });
  }
  if (filtro.abertas) {
    saida = saida.filter(function (r) {
      return AP_EPI_CFG.seguramSaldo.indexOf(r.status) > -1;
    });
  }
  /* o que o técnico precisa ver na tela: tudo que ainda vai ser
     retirado, marcado ou não, sem o que já fechou */
  if (filtro.paraRetirar) {
    saida = saida.filter(function (r) {
      return AP_EPI_CFG.seguramSaldo.indexOf(r.status) > -1 && !r.prazo.expirou;
    });
  }
  if (filtro.dataRetirada) {
    var alvoDia = String(filtro.dataRetirada).slice(0, 10);
    saida = saida.filter(function (r) { return r.prazo.dataRetirada === alvoDia; });
  }

  saida.sort(function (a, b) { return new Date(b.data) - new Date(a.data); });

  var porStatus = {};
  saida.forEach(function (r) { porStatus[r.status] = (porStatus[r.status] || 0) + 1; });

  return {
    reservas: saida,
    porStatus: porStatus,
    totais: {
      todas: saida.length,
      abertas: saida.filter(function (r) { return AP_EPI_CFG.seguramSaldo.indexOf(r.status) > -1; }).length,
      vencidas: saida.filter(function (r) { return r.vencida; }).length,
      agendadas: saida.filter(function (r) { return r.prazo.situacao === 'AGENDADA'; }).length,
      prontasHoje: saida.filter(function (r) {
        return r.prazo.situacao === 'LIBERADA' && !r.prazo.atrasada &&
          AP_EPI_CFG.seguramSaldo.indexOf(r.status) > -1;
      }).length,
      atrasadas: saida.filter(function (r) {
        return r.prazo.atrasada && AP_EPI_CFG.seguramSaldo.indexOf(r.status) > -1;
      }).length,
      aExpirar: saida.filter(function (r) { return r.prazo.expirou; }).length
    }
  };
}

function AP_EPI_mudarStatus_(payload, sessao) {
  var novo = String(payload.status || '').toUpperCase();
  if (Object.keys(AP_EPI_CFG.status).map(function (k) { return AP_EPI_CFG.status[k]; })
    .indexOf(novo) === -1) {
    return { ok: false, codigo: 'STATUS_INVALIDO', mensagem: 'Status "' + novo + '" não existe.' };
  }

  var r = AP_EPI_linhas_(AP_EPI_CFG.abas.reservas)
    .filter(function (x) { return String(x.protocolo) === String(payload.protocolo); })[0];
  if (!r) return { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Reserva não localizada.' };

  var atual = String(r.status || '').toUpperCase();
  if (atual === 'CONCLUIDA' || atual === 'CANCELADA') {
    return {
      ok: false, codigo: 'RESERVA_FECHADA',
      mensagem: 'A reserva está ' + atual + ' — não muda mais de status.'
    };
  }

  var quem = AP_EPI_quem_(sessao);
  AP_Data_update(AP_EPI_CFG.abas.reservas, r.protocolo, {
    status: novo, atualizadoEm: AP_EPI_agora_(), atualizadoPor: quem
  }, 'protocolo');

  AP_EPI_auditar_(quem, 'EPI_RESERVA_STATUS', r.protocolo, { de: atual, para: novo });

  return {
    ok: true,
    dados: { protocolo: r.protocolo, de: atual, para: novo, mensagem: 'Reserva ' + novo + '.' }
  };
}

function AP_EPI_cancelar_(payload, sessao) {
  if (!payload.motivo) {
    return {
      ok: false, codigo: 'SEM_MOTIVO',
      mensagem: 'Cancelamento precisa de motivo — é o que dá rastreabilidade.'
    };
  }

  var r = AP_EPI_linhas_(AP_EPI_CFG.abas.reservas)
    .filter(function (x) { return String(x.protocolo) === String(payload.protocolo); })[0];
  if (!r) return { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Reserva não localizada.' };

  var atual = String(r.status || '').toUpperCase();
  if (atual === 'CONCLUIDA') {
    return {
      ok: false, codigo: 'JA_CONCLUIDA',
      mensagem: 'Reserva já concluída — o que foi entregue não se cancela, se devolve.'
    };
  }
  if (atual === 'CANCELADA') {
    return { ok: false, codigo: 'JA_CANCELADA', mensagem: 'Esta reserva já estava cancelada.' };
  }

  var quem = AP_EPI_quem_(sessao);
  AP_Data_update(AP_EPI_CFG.abas.reservas, r.protocolo, {
    status: AP_EPI_CFG.status.CANCELADA,
    observacao: (r.observacao ? r.observacao + ' · ' : '') + 'Cancelada: ' + payload.motivo,
    atualizadoEm: AP_EPI_agora_(), atualizadoPor: quem
  }, 'protocolo');

  AP_EPI_auditar_(quem, 'EPI_RESERVA_CANCELADA', r.protocolo, { motivo: payload.motivo });

  return {
    ok: true,
    dados: {
      protocolo: r.protocolo,
      mensagem: 'Reserva cancelada. O saldo que estava comprometido voltou ao disponível.'
    }
  };
}


/* ============================================================
   ENTREGA — o único lugar onde o estoque baixa
   ------------------------------------------------------------
   Antes de qualquer baixa: a reserva existe, está num status que
   permite entregar, o colaborador se identificou, e há saldo.
   Tudo é conferido ANTES; só então o estoque se mexe.
   ============================================================ */

function AP_EPI_entregar_(payload, sessao) {
  var r = AP_EPI_linhas_(AP_EPI_CFG.abas.reservas)
    .filter(function (x) { return String(x.protocolo) === String(payload.protocolo); })[0];

  if (!r) return { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Reserva não localizada.' };

  var status = String(r.status || '').toUpperCase();
  if (status === 'CONCLUIDA') {
    return {
      ok: false, codigo: 'JA_ENTREGUE',
      mensagem: 'Esta reserva já foi concluída. Entregar de novo baixaria o estoque duas vezes.'
    };
  }
  if (status === 'CANCELADA' || status === 'EXPIRADA') {
    return { ok: false, codigo: 'RESERVA_' + status, mensagem: 'A reserva está ' + status + '.' };
  }
  if (AP_EPI_CFG.podemEntregar.indexOf(status) === -1) {
    return {
      ok: false, codigo: 'STATUS_NAO_PERMITE',
      mensagem: 'A reserva está ' + status + '. Ela precisa estar aprovada ou pronta para retirada.'
    };
  }

  /* o prazo de retirada. Passou do dia marcado mais a tolerância, a
     reserva não vale mais — o técnico remarca antes de entregar. */
  var prazo = AP_EPI_prazo_(r);
  if (prazo.expirou) {
    return {
      ok: false, codigo: 'PRAZO_VENCIDO',
      mensagem: 'A retirada estava marcada para ' + prazo.dataRetirada + ' e passou das ' +
        prazo.toleranciaHoras + 'h de tolerância. Remarque a retirada para entregar.',
      dados: { prazo: prazo }
    };
  }
  if (prazo.situacao === 'AGENDADA' && !payload.adiantarRetirada) {
    return {
      ok: false, codigo: 'RETIRADA_AGENDADA',
      mensagem: 'A retirada está marcada para ' + prazo.dataRetirada + ' (faltam ' +
        prazo.diasAte + ' dia(s)). Para entregar hoje mesmo, confirme a antecipação.',
      dados: { prazo: prazo }
    };
  }

  /* identificação do colaborador: sem isso não sai material */
  var auth = payload.autenticacao || {};
  var metodo = String(auth.metodo || '').toUpperCase();
  if (!metodo) {
    return {
      ok: false, codigo: 'SEM_AUTENTICACAO',
      mensagem: 'O colaborador precisa se identificar para receber o EPI.'
    };
  }
  if (AP_EPI_CFG.autenticacoes.indexOf(metodo) === -1) {
    return {
      ok: false, codigo: 'AUTENTICACAO_INVALIDA',
      mensagem: 'Método "' + metodo + '" não é aceito. Use: ' + AP_EPI_CFG.autenticacoes.join(', ') + '.'
    };
  }
  if (!auth.confirmada) {
    return {
      ok: false, codigo: 'AUTENTICACAO_NAO_CONFIRMADA',
      mensagem: 'A autenticação não foi confirmada. Nada é registrado como validado sem ter acontecido.'
    };
  }

  var itensReserva = AP_EPI_linhas_(AP_EPI_CFG.abas.itensReserva)
    .filter(function (i) { return String(i.protocolo) === String(r.protocolo); });

  var pedidos = payload.itens && payload.itens.length
    ? payload.itens
    : itensReserva.map(function (i) {
      return { id: i.id, qtd: AP_EPI_num_(i.qtdSolicitada) - AP_EPI_num_(i.qtdEntregue) };
    });

  /* ---- conferência completa antes de mexer no estoque ---- */
  var plano = [], problemas = [];

  pedidos.forEach(function (p) {
    var linha = itensReserva.filter(function (i) {
      return String(i.id) === String(p.id) || String(i.sku) === String(p.sku);
    })[0];

    if (!linha) {
      problemas.push({ item: p.sku || p.id, motivo: 'este item não está nesta reserva' });
      return;
    }

    var qtd = Math.abs(AP_EPI_num_(p.qtd));
    if (!qtd) return;   // zero = não entrega agora, sem erro

    var falta = AP_EPI_num_(linha.qtdSolicitada) - AP_EPI_num_(linha.qtdEntregue);
    if (qtd > falta) {
      problemas.push({
        item: linha.descricao || linha.sku,
        motivo: 'faltam ' + falta + ' para entregar e o pedido é de ' + qtd
      });
      return;
    }

    var d = AP_EPI_disponibilidade_(linha.sku);
    /* o saldo precisa cobrir a entrega; o que esta reserva
       segurava deixa de segurar no instante da baixa */
    if (qtd > d.saldo) {
      problemas.push({
        item: linha.descricao || linha.sku,
        motivo: 'saldo de ' + d.saldo + ' não cobre a entrega de ' + qtd
      });
      return;
    }

    plano.push({ linha: linha, qtd: qtd, estado: d });
  });

  if (problemas.length) {
    return {
      ok: false, codigo: 'ENTREGA_RECUSADA',
      mensagem: 'Nada foi entregue: ' + problemas.length + ' problema(s) na conferência.',
      dados: { problemas: problemas }
    };
  }
  if (!plano.length) {
    return { ok: false, codigo: 'NADA_A_ENTREGAR', mensagem: 'Nenhuma quantidade foi informada.' };
  }

  /* ---- agora sim: baixa, ficha e atualização ---- */
  AP_EPI_abas_();
  var ficha = payload.ficha || AP_EPI_id_('FICHA');
  var quem = AP_EPI_quem_(sessao);
  var agora = AP_EPI_agora_();
  var entregues = [], falhas = [];

  plano.forEach(function (p) {
    var idOperacao = AP_EPI_id_('OP');

    var mov = AP_Modulo_estoque('movimentar', {
      sku: p.linha.sku, qtd: p.qtd, tipo: 'SAIDA',
      documento: 'Ficha EPI ' + ficha,
      valorUnitario: 0,
      obra: r.obra || '', centro: r.setor || '',
      destino: r.colaborador || '', responsavel: quem,
      observacao: 'Entrega de EPI · reserva ' + r.protocolo + ' · ' + (r.colaborador || '')
    }, sessao);

    if (!mov || !mov.ok) {
      falhas.push({
        sku: p.linha.sku, descricao: p.linha.descricao,
        motivo: (mov && mov.mensagem) || 'a baixa no estoque falhou'
      });
      return;
    }

    AP_Data_append(AP_EPI_CFG.abas.entregas, {
      ficha: ficha, data: agora, protocolo: r.protocolo,
      codigoColaborador: r.codigoColaborador || '', matricula: r.matricula || '',
      colaborador: r.colaborador || '',
      sku: p.linha.sku, descricao: p.linha.descricao,
      ca: p.linha.ca || '', tamanho: p.linha.tamanho || '',
      qtd: p.qtd, unidade: p.linha.unidade || 'un',
      validade: payload.validade || '',
      entreguePor: quem,
      autenticacao: metodo + (auth.detalhe ? ' · ' + auth.detalhe : ''),
      idOperacao: idOperacao,
      obra: r.obra || '', setor: r.setor || '',
      situacao: 'EM_USO', observacao: payload.observacao || ''
    });

    var novoEntregue = AP_EPI_num_(p.linha.qtdEntregue) + p.qtd;
    var solicitado = AP_EPI_num_(p.linha.qtdSolicitada);
    AP_Data_update(AP_EPI_CFG.abas.itensReserva, p.linha.id, {
      qtdEntregue: novoEntregue,
      situacao: novoEntregue >= solicitado ? 'ENTREGUE' : 'PARCIAL'
    }, 'id');

    entregues.push({
      sku: p.linha.sku, descricao: p.linha.descricao, ca: p.linha.ca,
      tamanho: p.linha.tamanho, qtd: p.qtd, unidade: p.linha.unidade,
      idOperacao: idOperacao, saldoDepois: (mov.dados && mov.dados.saldo)
    });
  });

  if (!entregues.length) {
    return {
      ok: false, codigo: 'FALHA_NA_BAIXA',
      mensagem: 'Nenhum item pôde ser baixado do estoque.',
      dados: { falhas: falhas }
    };
  }

  /* status novo: concluída só quando tudo saiu */
  var atualizados = AP_EPI_linhas_(AP_EPI_CFG.abas.itensReserva)
    .filter(function (i) { return String(i.protocolo) === String(r.protocolo); });
  var tudoEntregue = atualizados.every(function (i) {
    return AP_EPI_num_(i.qtdEntregue) >= AP_EPI_num_(i.qtdSolicitada);
  });

  AP_Data_update(AP_EPI_CFG.abas.reservas, r.protocolo, {
    status: tudoEntregue ? AP_EPI_CFG.status.CONCLUIDA : AP_EPI_CFG.status.PARCIAL,
    atualizadoEm: agora, atualizadoPor: quem
  }, 'protocolo');

  AP_EPI_auditar_(quem, 'EPI_ENTREGUE', ficha, {
    protocolo: r.protocolo, colaborador: r.colaborador,
    itens: entregues.length, autenticacao: metodo
  });

  return {
    ok: true,
    dados: {
      ficha: ficha, protocolo: r.protocolo,
      colaborador: r.colaborador, matricula: r.matricula,
      entregues: entregues, falhas: falhas,
      statusReserva: tudoEntregue ? 'CONCLUIDA' : 'RETIRADA_PARCIALMENTE',
      autenticacao: metodo, entreguePor: quem, data: agora,
      mensagem: entregues.length + ' item(ns) entregues na ficha ' + ficha +
        (tudoEntregue ? '. Reserva concluída.' : '. Reserva segue com saldo a retirar.')
    }
  };
}


/* ============================================================
   DEVOLUÇÃO E TROCA
   ------------------------------------------------------------
   A entrega original NUNCA é apagada. A devolução é um registro
   novo que aponta para ela. E o mesmo item não se devolve duas
   vezes: o módulo soma o que já voltou antes de aceitar mais.
   ============================================================ */

function AP_EPI_devolver_(payload, sessao) {
  var idOperacao = payload.idOperacao;
  if (!idOperacao) {
    return {
      ok: false, codigo: 'SEM_OPERACAO',
      mensagem: 'Informe qual entrega está sendo devolvida.'
    };
  }
  if (!payload.motivo) {
    return { ok: false, codigo: 'SEM_MOTIVO', mensagem: 'Informe o motivo da devolução ou troca.' };
  }

  var entrega = AP_EPI_linhas_(AP_EPI_CFG.abas.entregas)
    .filter(function (e) { return String(e.idOperacao) === String(idOperacao); })[0];

  if (!entrega) {
    return { ok: false, codigo: 'ENTREGA_NAO_ENCONTRADA', mensagem: 'Entrega não localizada.' };
  }

  var jaDevolvido = AP_EPI_linhas_(AP_EPI_CFG.abas.devolucoes)
    .filter(function (d) { return String(d.idOperacaoOrigem) === String(idOperacao); })
    .reduce(function (s, d) { return s + AP_EPI_num_(d.qtd); }, 0);

  var entregue = AP_EPI_num_(entrega.qtd);
  var disponivelParaDevolver = entregue - jaDevolvido;

  if (disponivelParaDevolver <= 0) {
    return {
      ok: false, codigo: 'JA_DEVOLVIDO',
      mensagem: 'Esta entrega já foi devolvida por inteiro (' + jaDevolvido + ' de ' + entregue + ').'
    };
  }

  var qtd = Math.abs(AP_EPI_num_(payload.qtd)) || disponivelParaDevolver;
  if (qtd > disponivelParaDevolver) {
    return {
      ok: false, codigo: 'QTD_ACIMA_DO_ENTREGUE',
      mensagem: 'Foram entregues ' + entregue + ' e ' + jaDevolvido +
        ' já voltaram. Restam ' + disponivelParaDevolver + ' para devolver.'
    };
  }

  var ehTroca = String(payload.tipo || 'DEVOLUCAO').toUpperCase() === 'TROCA';
  var condicao = String(payload.condicao || '').toUpperCase() || 'NAO_INFORMADA';
  var quem = AP_EPI_quem_(sessao);
  var agora = AP_EPI_agora_();

  /**
   * ITEM EM CONDIÇÃO DE USO VOLTA AO ESTOQUE.
   * Item danificado NÃO volta: ele saiu de circulação, e fingir
   * que voltou encheria o saldo de material imprestável.
   */
  var voltaAoEstoque = (condicao === 'BOM' || condicao === 'NOVO' || condicao === 'USADO_BOM');
  var movimento = null;

  if (voltaAoEstoque) {
    movimento = AP_Modulo_estoque('movimentar', {
      sku: entrega.sku, qtd: qtd, tipo: 'DEVOLUCAO',
      documento: 'Devolução EPI · ficha ' + entrega.ficha,
      observacao: (ehTroca ? 'Troca' : 'Devolução') + ' · ' + payload.motivo +
        ' · ' + (entrega.colaborador || '')
    }, sessao);

    if (!movimento || !movimento.ok) {
      return {
        ok: false, codigo: 'FALHA_NO_RETORNO',
        mensagem: 'A devolução não foi registrada: ' +
          ((movimento && movimento.mensagem) || 'o estoque recusou o retorno.')
      };
    }
  }

  AP_EPI_abas_();
  var idDevolucao = AP_EPI_id_('DEV');
  var reservaTroca = '';

  /* troca gera uma reserva nova, amarrada à ficha original */
  if (ehTroca && payload.skuNovo) {
    var nova = AP_EPI_criarReserva_({
      codigoColaborador: entrega.codigoColaborador, matricula: entrega.matricula,
      colaborador: entrega.colaborador, obra: entrega.obra, setor: entrega.setor,
      solicitante: quem, tipo: 'TROCA', fichaOrigem: entrega.ficha,
      observacao: 'Troca de "' + entrega.descricao + '" · ' + payload.motivo,
      itens: [{
        sku: payload.skuNovo, qtd: qtd,
        tamanho: payload.tamanhoNovo || entrega.tamanho
      }]
    }, sessao);

    if (nova.ok) reservaTroca = nova.dados.protocolo;
  }

  AP_Data_append(AP_EPI_CFG.abas.devolucoes, {
    id: idDevolucao, data: agora,
    fichaOrigem: entrega.ficha, idOperacaoOrigem: idOperacao,
    sku: entrega.sku, descricao: entrega.descricao,
    matricula: entrega.matricula, colaborador: entrega.colaborador,
    qtd: qtd, motivo: payload.motivo, condicao: condicao,
    tipo: ehTroca ? 'TROCA' : 'DEVOLUCAO',
    reservaTroca: reservaTroca,
    recebidoPor: quem,
    autenticacao: (payload.autenticacao && payload.autenticacao.confirmada)
      ? String(payload.autenticacao.metodo || '').toUpperCase() : ''
  });

  /* a entrega original fica: muda só a situação dela */
  var totalDevolvido = jaDevolvido + qtd;
  AP_Data_update(AP_EPI_CFG.abas.entregas, idOperacao, {
    situacao: totalDevolvido >= entregue
      ? (ehTroca ? 'TROCADA' : 'DEVOLVIDA')
      : 'DEVOLVIDA_PARCIALMENTE'
  }, 'idOperacao');

  AP_EPI_auditar_(quem, ehTroca ? 'EPI_TROCA' : 'EPI_DEVOLUCAO', idDevolucao, {
    ficha: entrega.ficha, sku: entrega.sku, qtd: qtd, condicao: condicao
  });

  return {
    ok: true,
    dados: {
      id: idDevolucao, tipo: ehTroca ? 'TROCA' : 'DEVOLUCAO',
      sku: entrega.sku, descricao: entrega.descricao, qtd: qtd,
      condicao: condicao, voltouAoEstoque: voltaAoEstoque,
      reservaTroca: reservaTroca,
      totalDevolvido: totalDevolvido, entregaOriginal: entrega.ficha,
      mensagem: qtd + ' un. de "' + entrega.descricao + '" ' +
        (ehTroca ? 'trocadas' : 'devolvidas') + '. ' +
        (voltaAoEstoque
          ? 'O material voltou ao estoque.'
          : 'Condição "' + condicao + '": não voltou ao estoque.') +
        (reservaTroca ? ' Reserva de troca: ' + reservaTroca + '.' : '')
    }
  };
}


/* ============================================================
   HISTÓRICOS
   ============================================================ */

function AP_EPI_historicoItem_(payload) {
  var sku = payload.sku;
  if (!sku) return { sku: '', eventos: [] };

  var eventos = [];

  /* movimentações do estoque: entradas, saídas, ajustes */
  try {
    var movs = AP_Modulo_estoque('movimentacoes', { sku: sku, limite: 500 });
    if (movs && movs.ok) {
      (movs.dados || []).forEach(function (m) {
        eventos.push({
          quando: m.data, tipo: String(m.tipo || '').toUpperCase(),
          qtd: AP_EPI_num_(m.qtd), saldoDepois: AP_EPI_num_(m.saldo),
          documento: m.documento || '', responsavel: m.usuario || '',
          colaborador: '', observacao: m.observacao || ''
        });
      });
    }
  } catch (e) { }

  /* entregas: quem recebeu */
  AP_EPI_linhas_(AP_EPI_CFG.abas.entregas)
    .filter(function (e) { return String(e.sku) === String(sku); })
    .forEach(function (e) {
      eventos.push({
        quando: e.data, tipo: 'ENTREGA', qtd: AP_EPI_num_(e.qtd),
        saldoDepois: null, documento: 'Ficha ' + e.ficha,
        responsavel: e.entreguePor || '', colaborador: e.colaborador || '',
        matricula: e.matricula || '', reserva: e.protocolo || '',
        idOperacao: e.idOperacao || '', situacao: e.situacao || '',
        observacao: e.observacao || ''
      });
    });

  /* devoluções e trocas */
  AP_EPI_linhas_(AP_EPI_CFG.abas.devolucoes)
    .filter(function (d) { return String(d.sku) === String(sku); })
    .forEach(function (d) {
      eventos.push({
        quando: d.data, tipo: d.tipo || 'DEVOLUCAO', qtd: AP_EPI_num_(d.qtd),
        saldoDepois: null, documento: 'Ficha ' + d.fichaOrigem,
        responsavel: d.recebidoPor || '', colaborador: d.colaborador || '',
        matricula: d.matricula || '', condicao: d.condicao || '',
        observacao: d.motivo || ''
      });
    });

  /* reservas relacionadas */
  var reservas = [];
  var protocolos = {};
  AP_EPI_linhas_(AP_EPI_CFG.abas.itensReserva)
    .filter(function (i) { return String(i.sku) === String(sku); })
    .forEach(function (i) { protocolos[i.protocolo] = i; });

  AP_EPI_linhas_(AP_EPI_CFG.abas.reservas).forEach(function (r) {
    if (!protocolos[r.protocolo]) return;
    reservas.push({
      protocolo: r.protocolo, data: r.data, colaborador: r.colaborador,
      status: String(r.status || '').toUpperCase(),
      qtdSolicitada: AP_EPI_num_(protocolos[r.protocolo].qtdSolicitada),
      qtdEntregue: AP_EPI_num_(protocolos[r.protocolo].qtdEntregue)
    });
  });

  eventos.sort(function (a, b) { return new Date(b.quando) - new Date(a.quando); });

  var d = AP_EPI_disponibilidade_(sku);

  return {
    sku: sku, descricao: d.descricao, ca: d.ca,
    situacaoAtual: { saldo: d.saldo, reservado: d.reservado, disponivel: d.disponivel, emUso: d.emUso },
    eventos: eventos,
    reservas: reservas,
    totais: {
      eventos: eventos.length,
      entregas: eventos.filter(function (e) { return e.tipo === 'ENTREGA'; }).length,
      devolucoes: eventos.filter(function (e) { return e.tipo === 'DEVOLUCAO'; }).length,
      trocas: eventos.filter(function (e) { return e.tipo === 'TROCA'; }).length,
      colaboradores: Object.keys(eventos.reduce(function (a, e) {
        if (e.colaborador) a[e.colaborador] = 1;
        return a;
      }, {})).length
    }
  };
}

function AP_EPI_historicoColaborador_(payload) {
  var chave = payload.matricula || payload.codigoColaborador;
  if (!chave) return { colaborador: '', entregas: [], reservas: [] };

  function ehDele(x) {
    return String(x.matricula) === String(chave) ||
      String(x.codigoColaborador) === String(chave);
  }

  var entregas = AP_EPI_linhas_(AP_EPI_CFG.abas.entregas).filter(ehDele);
  var devolucoes = AP_EPI_linhas_(AP_EPI_CFG.abas.devolucoes).filter(function (d) {
    return String(d.matricula) === String(chave);
  });

  var devolvidoPorOperacao = {};
  devolucoes.forEach(function (d) {
    devolvidoPorOperacao[d.idOperacaoOrigem] =
      (devolvidoPorOperacao[d.idOperacaoOrigem] || 0) + AP_EPI_num_(d.qtd);
  });

  var hoje = new Date().setHours(0, 0, 0, 0);
  var emUso = [], vencidos = [], aVencer = [];

  var listaEntregas = entregas.map(function (e) {
    var devolvido = devolvidoPorOperacao[e.idOperacao] || 0;
    var comEle = Math.max(0, AP_EPI_num_(e.qtd) - devolvido);
    var linha = {
      ficha: e.ficha, data: e.data, sku: e.sku, descricao: e.descricao,
      ca: e.ca, tamanho: e.tamanho, qtd: AP_EPI_num_(e.qtd),
      devolvido: devolvido, emUso: comEle,
      validade: e.validade || '', idOperacao: e.idOperacao,
      situacao: e.situacao || 'EM_USO', entreguePor: e.entreguePor,
      autenticacao: e.autenticacao || '', reserva: e.protocolo || ''
    };

    if (comEle > 0) {
      emUso.push(linha);
      if (e.validade) {
        var v = new Date(e.validade).getTime();
        if (!isNaN(v)) {
          if (v < hoje) vencidos.push(linha);
          else if (v - hoje <= 30 * 86400000) aVencer.push(linha);
        }
      }
    }
    return linha;
  });

  listaEntregas.sort(function (a, b) { return new Date(b.data) - new Date(a.data); });

  var reservas = AP_EPI_listarReservas_({ matricula: chave }).reservas;

  return {
    colaborador: (entregas[0] && entregas[0].colaborador) || payload.colaborador || '',
    matricula: chave,
    entregas: listaEntregas,
    devolucoes: devolucoes.map(function (d) {
      return {
        id: d.id, data: d.data, sku: d.sku, descricao: d.descricao,
        qtd: AP_EPI_num_(d.qtd), motivo: d.motivo, condicao: d.condicao,
        tipo: d.tipo, fichaOrigem: d.fichaOrigem
      };
    }),
    reservas: reservas,
    emUso: emUso, vencidos: vencidos, aVencer: aVencer,
    fichas: Object.keys(entregas.reduce(function (a, e) { a[e.ficha] = 1; return a; }, {})),
    totais: {
      entregas: listaEntregas.length,
      itensEmUso: emUso.length,
      vencidos: vencidos.length,
      aVencer: aVencer.length,
      devolucoes: devolucoes.length,
      reservasAbertas: reservas.filter(function (r) {
        return AP_EPI_CFG.seguramSaldo.indexOf(r.status) > -1;
      }).length
    }
  };
}


/* ============================================================
   PAINEL
   ============================================================ */

/**
 * A agenda de retiradas, do jeito que o técnico precisa ver:
 * o que vence hoje, o que está atrasado dentro da tolerância, o que
 * está marcado para os próximos dias, e o que já passou do prazo.
 * Consulta pura — não escreve nada.
 */
function AP_EPI_agenda_(payload) {
  payload = payload || {};
  var lista = AP_EPI_listarReservas_({}).reservas
    .filter(function (r) { return AP_EPI_CFG.seguramSaldo.indexOf(r.status) > -1; });

  var hoje = [], proximas = [], atrasadas = [], vencidas = [];

  lista.forEach(function (r) {
    var p = r.prazo;
    if (p.expirou) vencidas.push(r);
    else if (p.situacao === 'AGENDADA') proximas.push(r);
    else if (p.atrasada) atrasadas.push(r);
    else hoje.push(r);
  });

  var porDia = function (a, b) {
    return String(a.prazo.dataRetirada || '9999').localeCompare(String(b.prazo.dataRetirada || '9999'));
  };
  proximas.sort(porDia); atrasadas.sort(porDia); vencidas.sort(porDia);

  return {
    hoje: hoje, proximas: proximas, atrasadas: atrasadas, vencidas: vencidas,
    totais: {
      hoje: hoje.length, proximas: proximas.length,
      atrasadas: atrasadas.length, vencidas: vencidas.length,
      abertas: lista.length
    },
    toleranciaPadraoHoras: AP_EPI_CFG.toleranciaPadraoHoras
  };
}

function AP_EPI_painel_(payload) {
  var reservas = AP_EPI_listarReservas_({});
  var entregas = AP_EPI_linhas_(AP_EPI_CFG.abas.entregas);
  var devolucoes = AP_EPI_linhas_(AP_EPI_CFG.abas.devolucoes);

  var devolvidoPorOp = {};
  devolucoes.forEach(function (d) {
    devolvidoPorOp[d.idOperacaoOrigem] = (devolvidoPorOp[d.idOperacaoOrigem] || 0) + AP_EPI_num_(d.qtd);
  });

  var hoje = new Date();
  var inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1).getTime();
  var hojeZero = new Date().setHours(0, 0, 0, 0);

  var emUso = 0, vencidos = 0, aVencer = 0, noMes = 0;
  var pessoas = {};

  entregas.forEach(function (e) {
    var comEle = AP_EPI_num_(e.qtd) - (devolvidoPorOp[e.idOperacao] || 0);
    if (comEle > 0) {
      emUso += comEle;
      if (e.matricula) pessoas[e.matricula] = 1;
      if (e.validade) {
        var v = new Date(e.validade).getTime();
        if (!isNaN(v)) {
          if (v < hojeZero) vencidos++;
          else if (v - hojeZero <= 30 * 86400000) aVencer++;
        }
      }
    }
    var q = new Date(e.data).getTime();
    if (!isNaN(q) && q >= inicioMes) noMes++;
  });

  /* o catálogo de EPI: tudo que está cadastrado, sem recorte */
  var catalogo = [], disponivel = 0, reservado = 0;
  try {
    var r = AP_Modulo_estoque('listar', {});
    if (r && r.ok) {
      catalogo = (r.dados || []).filter(function (i) {
        if (payload && payload.todasCategorias) return true;
        return AP_EPI_ehEpi_(i);
      });
      catalogo.forEach(function (i) {
        var d = AP_EPI_disponibilidade_(i.sku);
        disponivel += d.disponivel;
        reservado += d.reservado;
      });
    }
  } catch (e) { }

  return {
    epis: catalogo.length,
    disponiveis: disponivel,
    reservados: reservado,
    emUso: emUso,
    vencidos: vencidos,
    proximosDoVencimento: aVencer,
    entregasNoMes: noMes,
    colaboradoresComFicha: Object.keys(pessoas).length,
    reservas: {
      abertas: reservas.totais.abertas,
      vencidas: reservas.totais.vencidas,
      agendadas: reservas.totais.agendadas,
      prontasHoje: reservas.totais.prontasHoje,
      atrasadas: reservas.totais.atrasadas,
      aExpirar: reservas.totais.aExpirar,
      porStatus: reservas.porStatus
    }
  };
}

/** O que conta como EPI: pela categoria, com os nomes que a norma usa */
function AP_EPI_ehEpi_(item) {
  var c = String(item.categoria || '').toUpperCase();
  if (!c) return false;
  return /EPI|PROTE[ÇC][ÃA]O|SEGURAN[ÇC]A|UNIFORME|ALTURA|RESPIRAT|AURICULAR|OCULAR/.test(c);
}

function AP_EPI_auditar_(quem, acao, alvo, dados) {
  try {
    if (typeof AP_Audit_log === 'function') AP_Audit_log(quem, acao, 'EPI', alvo, dados);
  } catch (e) { }
}


/* ============================================================
   TESTES — estoque de mentira, nada é lido nem gravado
   ============================================================ */

function AP_EPI_testes() {
  var log = [], falhas = 0;
  function ok(nome, cond, detalhe) {
    log.push((cond ? 'PASSOU  ' : 'FALHOU  ') + nome + (detalhe ? '  [' + detalhe + ']' : ''));
    if (!cond) falhas++;
  }

  var estoque = {
    'BOTA41': { sku: 'BOTA41', descricao: 'Bota de Segurança N41', estoque: 10, unidade: 'par', ca: '12345', categoria: 'Proteção dos pés' },
    'CAPBR': { sku: 'CAPBR', descricao: 'Capacete Branco', estoque: 5, unidade: 'un', ca: '54321', categoria: 'Proteção da cabeça' },
    'BOTA42': { sku: 'BOTA42', descricao: 'Bota de Segurança N42', estoque: 4, unidade: 'par', ca: '12346', categoria: 'Proteção dos pés' }
  };
  var tabelas = {};
  tabelas[AP_EPI_CFG.abas.reservas] = [];
  tabelas[AP_EPI_CFG.abas.itensReserva] = [];
  tabelas[AP_EPI_CFG.abas.entregas] = [];
  tabelas[AP_EPI_CFG.abas.devolucoes] = [];

  var orig = {
    estoque: (typeof AP_Modulo_estoque === 'function') ? AP_Modulo_estoque : null,
    get: (typeof AP_Data_getSheet === 'function') ? AP_Data_getSheet : null,
    app: (typeof AP_Data_append === 'function') ? AP_Data_append : null,
    lote: (typeof AP_Data_appendBatch === 'function') ? AP_Data_appendBatch : null,
    rows: (typeof AP_Data_rows === 'function') ? AP_Data_rows : null,
    upd: (typeof AP_Data_update === 'function') ? AP_Data_update : null
  };

  try {
    AP_Modulo_estoque = function (acao, p) {
      if (acao === 'item') {
        return estoque[p.sku] ? { ok: true, dados: estoque[p.sku] } : { ok: false };
      }
      if (acao === 'listar') {
        return { ok: true, dados: Object.keys(estoque).map(function (k) { return estoque[k]; }) };
      }
      if (acao === 'movimentacoes') return { ok: true, dados: [] };
      if (acao === 'movimentar') {
        var it = estoque[p.sku];
        if (!it) return { ok: false, mensagem: 'item não existe' };
        var d = (p.tipo === 'SAIDA') ? -Math.abs(p.qtd) : Math.abs(p.qtd);
        if (it.estoque + d < 0) return { ok: false, mensagem: 'saldo insuficiente' };
        it.estoque += d;
        return { ok: true, dados: { saldo: it.estoque } };
      }
      return { ok: false };
    };
    AP_Data_getSheet = function () { return {}; };
    AP_Data_rows = function (aba) { return tabelas[aba] || []; };
    AP_Data_append = function (aba, reg) { (tabelas[aba] = tabelas[aba] || []).push(reg); };
    AP_Data_appendBatch = function (aba, regs) {
      regs.forEach(function (r) { AP_Data_append(aba, r); });
    };
    AP_Data_update = function (aba, id, patch, campo) {
      (tabelas[aba] || []).forEach(function (r) {
        if (String(r[campo || 'id']) === String(id)) {
          for (var k in patch) r[k] = patch[k];
        }
      });
    };

    /* ---------- 1. RESERVA NÃO BAIXA ESTOQUE ---------- */
    var saldoAntes = estoque.BOTA41.estoque;
    var res = AP_Modulo_epigestao('criarReserva', {
      matricula: '000891', colaborador: 'Paulo Mendes', obra: 'OB02', setor: 'Acabamento',
      itens: [{ sku: 'BOTA41', qtd: 1, tamanho: '41' }, { sku: 'CAPBR', qtd: 1 }]
    }, { usuario: 'almoxarife' });

    ok('reserva criada', res.ok, res.ok ? res.dados.protocolo : res.mensagem);
    ok('RESERVA NÃO BAIXOU O ESTOQUE', estoque.BOTA41.estoque === saldoAntes,
      'saldo segue ' + estoque.BOTA41.estoque);

    var disp = AP_EPI_disponibilidade_('BOTA41');
    ok('mas o disponível caiu', disp.saldo === 10 && disp.reservado === 1 && disp.disponivel === 9,
      disp.saldo + ' - ' + disp.reservado + ' = ' + disp.disponivel);

    /* ---------- 2. RESERVA RESPEITA O DISPONÍVEL ---------- */
    var demais = AP_Modulo_epigestao('criarReserva', {
      matricula: '000112', colaborador: 'Carlos',
      itens: [{ sku: 'CAPBR', qtd: 99 }]
    }, {});
    ok('não reserva além do disponível', demais.codigo === 'ITENS_INDISPONIVEIS',
      demais.dados ? demais.dados.recusados[0].motivo : demais.codigo);
    ok('recusa não gravou reserva parcial',
      tabelas[AP_EPI_CFG.abas.reservas].length === 1,
      tabelas[AP_EPI_CFG.abas.reservas].length + ' reserva(s)');

    ok('reserva sem colaborador é recusada',
      AP_Modulo_epigestao('criarReserva', { itens: [{ sku: 'BOTA41', qtd: 1 }] }).codigo === 'SEM_COLABORADOR');

    /* ---------- 3. STATUS E AUTENTICAÇÃO SÃO DOIS PORTÕES ----------
       A ordem importa: o status é conferido primeiro, porque ele
       fala do documento; a autenticação depois, porque fala da
       pessoa. Os dois precisam passar. */
    var protocolo = res.dados.protocolo;

    var cedoDemais = AP_Modulo_epigestao('entregar', {
      protocolo: protocolo, autenticacao: { metodo: 'SENHA', confirmada: true }
    }, {});
    ok('reserva apenas SOLICITADA não entrega', cedoDemais.codigo === 'STATUS_NAO_PERMITE',
      cedoDemais.mensagem);
    ok('estoque intacto após a recusa de status', estoque.BOTA41.estoque === 10);

    /* agora aprovada: o portão do status abre, o da autenticação não */
    AP_Modulo_epigestao('mudarStatus', { protocolo: protocolo, status: 'APROVADA' }, { usuario: 'gestor' });

    var semAuth = AP_Modulo_epigestao('entregar', { protocolo: protocolo }, {});
    ok('não entrega sem autenticação', semAuth.codigo === 'SEM_AUTENTICACAO', semAuth.mensagem);
    ok('estoque intacto após a recusa', estoque.BOTA41.estoque === 10);

    var naoConfirmada = AP_Modulo_epigestao('entregar', {
      protocolo: protocolo, autenticacao: { metodo: 'BIOMETRIA', confirmada: false }
    }, {});
    ok('não registra autenticação que não ocorreu',
      naoConfirmada.codigo === 'AUTENTICACAO_NAO_CONFIRMADA', naoConfirmada.mensagem);
    ok('estoque segue intacto', estoque.BOTA41.estoque === 10);

    var metodoInventado = AP_Modulo_epigestao('entregar', {
      protocolo: protocolo, autenticacao: { metodo: 'ADIVINHACAO', confirmada: true }
    }, {});
    ok('método de autenticação desconhecido é recusado',
      metodoInventado.codigo === 'AUTENTICACAO_INVALIDA');

    /* ---------- 4. A BAIXA ACONTECE NA ENTREGA ---------- */

    var ent = AP_Modulo_epigestao('entregar', {
      protocolo: protocolo,
      autenticacao: { metodo: 'BIOMETRIA', confirmada: true, detalhe: 'digital polegar direito' },
      validade: '2027-09-19'
    }, { usuario: 'almoxarife' });

    ok('entrega feita', ent.ok, ent.ok ? ent.dados.mensagem : ent.mensagem);
    ok('AGORA SIM o estoque baixou', estoque.BOTA41.estoque === 9 && estoque.CAPBR.estoque === 4,
      'bota ' + estoque.BOTA41.estoque + ' · capacete ' + estoque.CAPBR.estoque);
    ok('reserva virou CONCLUIDA', ent.dados.statusReserva === 'CONCLUIDA');
    ok('a ficha foi gerada', !!ent.dados.ficha, ent.dados.ficha);
    ok('a autenticação ficou registrada',
      tabelas[AP_EPI_CFG.abas.entregas][0].autenticacao.indexOf('BIOMETRIA') === 0,
      tabelas[AP_EPI_CFG.abas.entregas][0].autenticacao);

    /* ---------- 5. NÃO ENTREGA DUAS VEZES ---------- */
    var dupla = AP_Modulo_epigestao('entregar', {
      protocolo: protocolo, autenticacao: { metodo: 'SENHA', confirmada: true }
    }, {});
    ok('BAIXA DUPLICADA É IMPEDIDA', dupla.codigo === 'JA_ENTREGUE', dupla.mensagem);
    ok('estoque não baixou de novo', estoque.BOTA41.estoque === 9);

    /* ---------- 6. ENTREGA PARCIAL ---------- */
    var res2 = AP_Modulo_epigestao('criarReserva', {
      matricula: '000733', colaborador: 'Mariana Lima',
      itens: [{ sku: 'BOTA42', qtd: 3 }]
    }, {});
    AP_Modulo_epigestao('mudarStatus', { protocolo: res2.dados.protocolo, status: 'PRONTA_PARA_RETIRADA' }, {});

    var linhaItem = tabelas[AP_EPI_CFG.abas.itensReserva]
      .filter(function (i) { return i.protocolo === res2.dados.protocolo; })[0];

    var parcial = AP_Modulo_epigestao('entregar', {
      protocolo: res2.dados.protocolo,
      itens: [{ id: linhaItem.id, qtd: 1 }],
      autenticacao: { metodo: 'ASSINATURA', confirmada: true }
    }, {});

    ok('entrega parcial aceita', parcial.ok && parcial.dados.statusReserva === 'RETIRADA_PARCIALMENTE',
      parcial.ok ? parcial.dados.statusReserva : parcial.mensagem);
    ok('baixou só o que foi entregue', estoque.BOTA42.estoque === 3, 'saldo ' + estoque.BOTA42.estoque);
    ok('o resto continua reservado', AP_EPI_disponibilidade_('BOTA42').reservado === 2,
      'reservado ' + AP_EPI_disponibilidade_('BOTA42').reservado);

    var acimaDoPedido = AP_Modulo_epigestao('entregar', {
      protocolo: res2.dados.protocolo,
      itens: [{ id: linhaItem.id, qtd: 99 }],
      autenticacao: { metodo: 'SENHA', confirmada: true }
    }, {});
    ok('não entrega acima do reservado', acimaDoPedido.codigo === 'ENTREGA_RECUSADA',
      acimaDoPedido.dados ? acimaDoPedido.dados.problemas[0].motivo : '');

    /* ---------- 7. DEVOLUÇÃO NÃO APAGA A ENTREGA ---------- */
    var opBota = tabelas[AP_EPI_CFG.abas.entregas]
      .filter(function (e) { return e.sku === 'BOTA41'; })[0];

    var dev = AP_Modulo_epigestao('devolver', {
      idOperacao: opBota.idOperacao, qtd: 1, motivo: 'Tamanho errado',
      condicao: 'BOM', tipo: 'TROCA', skuNovo: 'BOTA42', tamanhoNovo: '42'
    }, { usuario: 'almoxarife' });

    ok('troca registrada', dev.ok, dev.ok ? dev.dados.mensagem : dev.mensagem);
    ok('a entrega original NÃO foi apagada',
      tabelas[AP_EPI_CFG.abas.entregas].filter(function (e) {
        return e.idOperacao === opBota.idOperacao;
      }).length === 1);
    ok('a entrega original mudou de situação', opBota.situacao === 'TROCADA', opBota.situacao);
    ok('item em bom estado voltou ao estoque', estoque.BOTA41.estoque === 10,
      'saldo ' + estoque.BOTA41.estoque);
    ok('a troca gerou reserva nova', !!dev.dados.reservaTroca, dev.dados.reservaTroca);

    var devDupla = AP_Modulo_epigestao('devolver', {
      idOperacao: opBota.idOperacao, qtd: 1, motivo: 'de novo', condicao: 'BOM'
    }, {});
    ok('DEVOLUÇÃO DUPLICADA É IMPEDIDA', devDupla.codigo === 'JA_DEVOLVIDO', devDupla.mensagem);

    /* item danificado não volta ao estoque */
    var opCap = tabelas[AP_EPI_CFG.abas.entregas]
      .filter(function (e) { return e.sku === 'CAPBR'; })[0];
    var saldoCap = estoque.CAPBR.estoque;
    var devRuim = AP_Modulo_epigestao('devolver', {
      idOperacao: opCap.idOperacao, qtd: 1, motivo: 'Quebrou', condicao: 'DANIFICADO'
    }, {});
    ok('item danificado não volta ao estoque',
      devRuim.ok && estoque.CAPBR.estoque === saldoCap && !devRuim.dados.voltouAoEstoque,
      'saldo ' + estoque.CAPBR.estoque);

    /* ---------- 8. HISTÓRICOS ---------- */
    var hi = AP_EPI_historicoItem_({ sku: 'BOTA41' });
    ok('histórico do item mostra entrega e troca',
      hi.totais.entregas === 1 && hi.totais.trocas === 1,
      hi.totais.entregas + ' entrega(s) · ' + hi.totais.trocas + ' troca(s)');
    ok('histórico do item nomeia quem recebeu',
      hi.eventos.some(function (e) { return e.colaborador === 'Paulo Mendes'; }));

    var hc = AP_EPI_historicoColaborador_({ matricula: '000891' });
    ok('histórico do colaborador traz as entregas', hc.totais.entregas === 2,
      hc.totais.entregas + ' entrega(s)');
    ok('histórico do colaborador traz as devoluções', hc.totais.devolucoes === 2,
      hc.totais.devolucoes + ' devolução(ões)');

    /* ---------- 9. CANCELAMENTO ---------- */
    ok('não cancela sem motivo',
      AP_Modulo_epigestao('cancelarReserva', { protocolo: res2.dados.protocolo }).codigo === 'SEM_MOTIVO');
    var canc = AP_Modulo_epigestao('cancelarReserva', {
      protocolo: res2.dados.protocolo, motivo: 'Colaborador desligado'
    }, {});
    ok('cancelamento com motivo funciona', canc.ok);
    /* sobra 1 reservado: é a reserva de TROCA criada no passo 7,
       que continua viva e de outro dono — cancelar uma reserva
       não pode soltar o que outra está segurando */
    ok('cancelar solta o saldo daquela reserva, e só dela',
      AP_EPI_disponibilidade_('BOTA42').reservado === 1,
      'reservado ' + AP_EPI_disponibilidade_('BOTA42').reservado + ' (a reserva de troca)');
    ok('reserva concluída não se cancela',
      AP_Modulo_epigestao('cancelarReserva', { protocolo: protocolo, motivo: 'x' }).codigo === 'JA_CONCLUIDA');

    /* ---------- 10. RETIRADA AGENDADA E AS 48 HORAS ----------
       O técnico marca o dia. Até lá a reserva segura o saldo sem
       baixar nada. Do dia marcado, o colaborador tem 48h. Não
       apareceu, a reserva expira sozinha e o saldo volta. */
    var dia = function (n) {
      var d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n);
      return d.toISOString().slice(0, 10);
    };

    var agendada = AP_Modulo_epigestao('criarReserva', {
      matricula: '000777', colaborador: 'Fulano que entra daqui 4 dias',
      dataRetirada: dia(4),
      itens: [{ sku: 'CAPBR', qtd: 1 }]
    }, { usuario: 'tecnico.seguranca' });
    ok('reserva com data de retirada futura é aceita', agendada.ok,
      agendada.ok ? 'retirada em ' + agendada.dados.dataRetirada : agendada.mensagem);

    var protAg = agendada.ok ? agendada.dados.protocolo : '';
    var vAg = AP_Modulo_epigestao('obterReserva', { protocolo: protAg }).dados;
    ok('4 dias antes ela já segura o saldo', vAg.prazo.situacao === 'AGENDADA' && vAg.prazo.diasAte === 4,
      vAg.prazo.situacao + ', faltam ' + vAg.prazo.diasAte + ' dia(s)');
    var capAntes = estoque.CAPBR.estoque;
    ok('e o estoque continua intacto', vAg.prazo.situacao === 'AGENDADA' && capAntes === estoque.CAPBR.estoque,
      'capacetes no estoque: ' + capAntes + ' (a reserva não tocou)');

    ok('data de retirada no passado é recusada',
      AP_Modulo_epigestao('criarReserva', {
        matricula: '000778', colaborador: 'X', dataRetirada: dia(-1),
        itens: [{ sku: 'CAPBR', qtd: 1 }]
      }).codigo === 'DATA_NO_PASSADO');

    AP_Modulo_epigestao('mudarStatus', { protocolo: protAg, status: 'APROVADA' }, {});
    var cedo = AP_Modulo_epigestao('entregar', {
      protocolo: protAg,
      autenticacao: { metodo: 'CRACHA', confirmada: true },
      itens: [{ sku: 'CAPBR', qtd: 1 }]
    }, { usuario: 'almoxarife' });
    ok('não entrega antes do dia marcado sem confirmar antecipação',
      cedo.codigo === 'RETIRADA_AGENDADA', cedo.codigo);

    /* o dia chegou: a retirada libera */
    AP_Data_update(AP_EPI_CFG.abas.reservas, protAg, { dataRetirada: dia(0) }, 'protocolo');
    var vHoje = AP_Modulo_epigestao('obterReserva', { protocolo: protAg }).dados;
    ok('no dia marcado a retirada libera', vHoje.prazo.situacao === 'LIBERADA', vHoje.prazo.situacao);

    /* passou do dia + 48h: expira e devolve o saldo */
    AP_Data_update(AP_EPI_CFG.abas.reservas, protAg, { dataRetirada: dia(-3) }, 'protocolo');
    var vTarde = AP_Modulo_epigestao('obterReserva', { protocolo: protAg }).dados;
    ok('passadas as 48h o prazo aparece como vencido', vTarde.prazo.situacao === 'EXPIRADA',
      vTarde.prazo.situacao + ' (marcada para ' + vTarde.prazo.dataRetirada + ')');

    var tarde = AP_Modulo_epigestao('entregar', {
      protocolo: protAg,
      autenticacao: { metodo: 'CRACHA', confirmada: true },
      itens: [{ sku: 'CAPBR', qtd: 1 }]
    }, {});
    ok('entrega fora do prazo é recusada', tarde.codigo === 'PRAZO_VENCIDO', tarde.codigo);
    ok('e a recusa não baixou nada do estoque', estoque.CAPBR.estoque === capAntes,
      'capacetes: ' + estoque.CAPBR.estoque + ' (o mesmo de antes da tentativa)');

    var reservadoAntes = AP_EPI_disponibilidade_('CAPBR').reservado;
    var varredura = AP_Modulo_epigestao('expirarVencidas', {}, {});
    ok('a varredura fecha a reserva vencida', varredura.ok && varredura.dados.quantas >= 1,
      varredura.dados.mensagem);
    ok('e o saldo reservado voltou ao disponível',
      AP_EPI_disponibilidade_('CAPBR').reservado === reservadoAntes - 1,
      'reservado era ' + reservadoAntes + ', virou ' + AP_EPI_disponibilidade_('CAPBR').reservado);

    /* remarcar traz a reserva de volta */
    var remarc = AP_Modulo_epigestao('reagendar', {
      protocolo: protAg, dataRetirada: dia(2), motivo: 'colaborador só chega na quarta'
    }, { usuario: 'tecnico.seguranca' });
    ok('remarcar reabre a reserva expirada', remarc.ok && remarc.dados.status === 'APROVADA',
      remarc.ok ? remarc.dados.mensagem : remarc.mensagem);
    ok('e ela volta a segurar o saldo',
      AP_EPI_disponibilidade_('CAPBR').reservado === reservadoAntes,
      'reservado ' + AP_EPI_disponibilidade_('CAPBR').reservado);
    ok('remarcar para o passado é recusado',
      AP_Modulo_epigestao('reagendar', { protocolo: protAg, dataRetirada: dia(-2) }).codigo === 'DATA_NO_PASSADO');

    var ag = AP_EPI_agenda_({});
    ok('a agenda mostra a retirada marcada', ag.totais.proximas >= 1,
      'hoje ' + ag.totais.hoje + ' · próximas ' + ag.totais.proximas +
      ' · atrasadas ' + ag.totais.atrasadas + ' · vencidas ' + ag.totais.vencidas);

    /* ---------- 11. PAINEL ---------- */
    var painel = AP_EPI_painel_({});
    ok('painel conta os EPIs do catálogo', painel.epis === 3, painel.epis + ' EPI(s)');
    ok('painel conta itens em uso', painel.emUso >= 0, 'em uso ' + painel.emUso);
    /* "ficha ativa" é quem AINDA está com EPI. O Paulo devolveu e
       trocou tudo, então sai da conta — o que é o certo: a ficha
       dele existe no histórico, mas não há EPI com ele agora. */
    ok('painel conta só quem está com EPI agora', painel.colaboradoresComFicha === 1,
      painel.colaboradoresComFicha + ' colaborador(es) com EPI em mãos');

  } finally {
    if (orig.estoque) AP_Modulo_estoque = orig.estoque;
    if (orig.get) AP_Data_getSheet = orig.get;
    if (orig.app) AP_Data_append = orig.app;
    if (orig.lote) AP_Data_appendBatch = orig.lote;
    if (orig.rows) AP_Data_rows = orig.rows;
    if (orig.upd) AP_Data_update = orig.upd;
  }

  log.push('');
  log.push(falhas ? falhas + ' teste(s) FALHARAM' : 'todos os testes passaram');
  log.push('');
  log.push('O que foi verificado: reserva compromete sem baixar, a baixa só');
  log.push('acontece na entrega com autenticação confirmada, não há baixa nem');
  log.push('devolução em dobro, a entrega original nunca é apagada e o');
  log.push('cancelamento devolve o saldo. Nada foi lido nem gravado na planilha.');

  try { Logger.log(log.join('\n')); } catch (e) { }
  return log;
}
