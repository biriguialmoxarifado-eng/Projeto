/* ============================================================
   ALMOXA PRO — FERRAMENTARIA
   ------------------------------------------------------------
   Ferramenta não é saldo, é objeto. Cada furadeira é UMA
   furadeira, com número de patrimônio próprio, e a pergunta que
   importa é sempre a mesma: onde ela está e com quem.

   Por isso aqui nada é quantidade. Tudo gira em torno de três
   coisas amarradas:

       o SKU        — o que é (do Cadastro Central)
       o patrimônio — qual delas é (a plaquinha, o número)
       a pessoa     — com quem está agora

   O CAMINHO DE UMA FERRAMENTA

     DISPONIVEL ──retirar──► EM_POSSE ──devolver──► DISPONIVEL
                                │  ▲
                                │  └── transferir (troca de mão,
                                │       sem passar pelo almoxarifado)
                                └──► MANUTENCAO ──retorno──► DISPONIVEL

   REGRAS QUE O MÓDULO NÃO ABRE MÃO

     · duas pessoas não podem estar com a mesma ferramenta: a
       retirada de algo que já está na mão de alguém é recusada,
       dizendo com quem está;
     · transferência sai de quem está com ela — não de quem
       gostaria de estar;
     · devolução só de quem está em posse, e com identificação
       confirmada, do mesmo jeito que o EPI;
     · nada é apagado: cada retirada, transferência, devolução e
       manutenção vira uma linha nova. O histórico é a trajetória
       inteira da ferramenta, e é dele que sai a resposta de quem
       ficou com ela por último;
     · ferramenta em manutenção não sai para ninguém.

   Rode AP_FER_testes() para conferir a lógica sem tocar em dado.
   ============================================================ */

var AP_FER_CFG = {
  versao: '1.0.0',

  abas: {
    ferramentas: 'ALMOXA_FERRAMENTAS',
    movimentos: 'ALMOXA_FER_MOVIMENTOS'
  },

  colunas: {
    ferramentas: ['patrimonio', 'sku', 'nome', 'categoria', 'marca', 'modelo',
      'serie', 'foto', 'status', 'com', 'matricula', 'desde', 'obra',
      'local', 'observacao', 'motivo', 'atualizadoEm', 'atualizadoPor'],
    movimentos: ['id', 'data', 'patrimonio', 'sku', 'ferramenta', 'tipo',
      'deQuem', 'deMatricula', 'paraQuem', 'paraMatricula', 'obra',
      'autenticacao', 'condicao', 'observacao', 'registradoPor']
  },

  status: {
    DISPONIVEL: 'DISPONIVEL',
    EM_POSSE: 'EM_POSSE',
    MANUTENCAO: 'MANUTENCAO',
    BAIXADA: 'BAIXADA'
  },

  tipos: {
    RETIRADA: 'RETIRADA',
    TRANSFERENCIA: 'TRANSFERENCIA',
    DEVOLUCAO: 'DEVOLUCAO',
    MANUTENCAO: 'MANUTENCAO',
    RETORNO: 'RETORNO_MANUTENCAO',
    BAIXA: 'BAIXA'
  },

  autenticacoes: ['BIOMETRIA', 'FACIAL', 'CRACHA', 'SENHA', 'ASSINATURA', 'PRESENCIAL_RESPONSAVEL'],

  /* a partir de quantos dias fora a ferramenta vira pendência */
  diasParaPendencia: 1,

  /* o que conta como ferramenta, pela categoria do cadastro */
  regraCategoria: /FERRAMENT|EQUIPAMENT|M[ÁA]QUIN/i
};


/* ============================================================
   ENTRADA DO MÓDULO
   ============================================================ */

function AP_Modulo_ferramentaria(acao, payload, sessao) {
  payload = payload || {};
  try {
    switch (acao) {
      case 'listar': return { ok: true, dados: AP_FER_listar_(payload) };
      case 'obter': return AP_FER_obter_(payload);
      case 'salvar': return AP_FER_salvar_(payload, sessao);

      case 'retirar': return AP_FER_retirar_(payload, sessao);
      case 'transferir': return AP_FER_transferir_(payload, sessao);
      case 'devolver': return AP_FER_devolver_(payload, sessao);
      case 'manutencao': return AP_FER_manutencao_(payload, sessao);
      case 'retornarManutencao': return AP_FER_retorno_(payload, sessao);

      case 'historico': return { ok: true, dados: AP_FER_historico_(payload) };
      case 'pendencias': return { ok: true, dados: AP_FER_pendencias_(payload) };
      case 'painel': return { ok: true, dados: AP_FER_painel_(payload) };
      case 'comQuem': return { ok: true, dados: AP_FER_comQuem_(payload) };
    }
    return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'ferramentaria.' + acao + ' não existe.' };
  } catch (e) {
    try { console.error('[FER] ' + acao + ': ' + e.message); } catch (x) { }
    return { ok: false, codigo: 'FER_ERRO', mensagem: e.message };
  }
}


/* ============================================================
   APOIO
   ============================================================ */

function AP_FER_linhas_(aba) {
  try { return AP_Data_rows(aba) || []; } catch (e) { return []; }
}

function AP_FER_abas_() {
  try {
    AP_Data_getSheet(AP_FER_CFG.abas.ferramentas, AP_FER_CFG.colunas.ferramentas);
    AP_Data_getSheet(AP_FER_CFG.abas.movimentos, AP_FER_CFG.colunas.movimentos);
  } catch (e) { }
}

function AP_FER_agora_() { return new Date().toISOString(); }

function AP_FER_quem_(sessao) {
  return (sessao && (sessao.nome || sessao.usuario || sessao.email)) || 'sistema';
}

function AP_FER_id_() {
  try { return 'MOV-' + Utilities.getUuid().slice(0, 8).toUpperCase(); }
  catch (e) { return 'MOV-' + Date.now().toString(36).toUpperCase(); }
}

/** O cadastro de itens, para saber o que é cada patrimônio */
function AP_FER_catalogo_() {
  try {
    var r = AP_Modulo_estoque('listar', {});
    if (r && r.ok) return r.dados || [];
  } catch (e) { }
  return [];
}

/** Os patrimônios já criados, quando o módulo existe */
function AP_FER_patrimonios_() {
  try {
    if (typeof AP_Modulo_patrimonio !== 'function') return [];
    var r = AP_Modulo_patrimonio('listar', {});
    if (r && r.ok) return r.dados || [];
  } catch (e) { }
  return [];
}

function AP_FER_ehFerramenta_(item) {
  var c = String((item && (item.categoria || item.grupo)) || '');
  return AP_FER_CFG.regraCategoria.test(c);
}

function AP_FER_auditar_(quem, acao, alvo, dados) {
  try {
    AP_Modulo_auditoria('registrar', {
      usuario: quem, acao: acao, alvo: alvo,
      detalhes: JSON.stringify(dados || {}), data: AP_FER_agora_()
    }, {});
  } catch (e) { }
}

function AP_FER_dias_(desde) {
  if (!desde) return 0;
  var d = new Date(desde);
  if (isNaN(d.getTime())) return 0;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}


/* ============================================================
   A LISTA
   ------------------------------------------------------------
   Junta três fontes numa lista só: as ferramentas já
   registradas, os patrimônios criados que ainda não viraram
   registro, e os itens do catálogo na categoria de ferramenta
   que ainda não têm patrimônio nenhum.

   A terceira fonte é o que responde à pergunta "por que minha
   ferramenta não aparece aqui": ela aparece, marcada como
   SEM_PATRIMONIO, esperando a plaquinha.
   ============================================================ */

function AP_FER_listar_(filtro) {
  filtro = filtro || {};
  var registradas = AP_FER_linhas_(AP_FER_CFG.abas.ferramentas);
  var catalogo = AP_FER_catalogo_();
  var patrimonios = AP_FER_patrimonios_();
  var movimentos = AP_FER_linhas_(AP_FER_CFG.abas.movimentos);

  var porSku = {};
  catalogo.forEach(function (i) {
    var sku = i.sku || i.id || i.codigo;
    if (sku) porSku[sku] = i;
  });

  var vistos = {};
  var saida = [];

  /* 1. o que já é ferramenta registrada */
  registradas.forEach(function (f) {
    if (!f.patrimonio) return;
    vistos[String(f.patrimonio)] = true;
    saida.push(AP_FER_montar_(f, porSku[f.sku], movimentos));
  });

  /* 2. patrimônios criados que ainda não viraram ferramenta */
  patrimonios.forEach(function (p) {
    var num = p.patrimonio || p.numero;
    if (!num || vistos[String(num)]) return;
    var item = porSku[p.sku] || {};
    if (!AP_FER_ehFerramenta_(item) && !AP_FER_ehFerramenta_(p)) return;
    vistos[String(num)] = true;
    saida.push(AP_FER_montar_({
      patrimonio: num, sku: p.sku || '', nome: p.descricao || item.descricao || '',
      categoria: p.categoria || item.categoria || '', foto: p.foto || item.foto || '',
      marca: p.marca || '', modelo: p.modelo || '', serie: p.serie || '',
      status: (String(p.situacao || '').toUpperCase() === 'EM_MANUTENCAO')
        ? AP_FER_CFG.status.MANUTENCAO : AP_FER_CFG.status.DISPONIVEL,
      obra: p.obra || '', local: p.local || ''
    }, item, movimentos));
  });

  /* 3. itens da categoria ferramenta que ainda não têm patrimônio */
  if (!filtro.somenteComPatrimonio) {
    catalogo.forEach(function (i) {
      if (!AP_FER_ehFerramenta_(i)) return;
      var sku = i.sku || i.id || i.codigo;
      var temAlgum = saida.some(function (f) { return String(f.sku) === String(sku); });
      if (temAlgum) return;
      saida.push({
        patrimonio: '', sku: sku, nome: i.descricao || i.nome || '',
        categoria: i.categoria || '', foto: i.foto || '',
        marca: i.marca || '', modelo: i.modelo || '', serie: '',
        status: 'SEM_PATRIMONIO',
        com: '', matricula: '', desde: '', obra: '', local: i.localizacao || '',
        diasFora: 0, pendente: false, motivo: '',
        saldoCadastro: Number(i.estoque !== undefined ? i.estoque : i.estoqueAtual) || 0,
        ultimoMovimento: null,
        precisaPatrimonio: true
      });
    });
  }

  /* filtros */
  if (filtro.status) {
    var alvo = String(filtro.status).toUpperCase();
    saida = saida.filter(function (f) { return f.status === alvo; });
  }
  if (filtro.obra) saida = saida.filter(function (f) { return String(f.obra) === String(filtro.obra); });
  if (filtro.matricula) saida = saida.filter(function (f) { return String(f.matricula) === String(filtro.matricula); });
  if (filtro.busca) {
    var b = String(filtro.busca).toLowerCase();
    saida = saida.filter(function (f) {
      return [f.nome, f.patrimonio, f.sku, f.com, f.marca, f.modelo, f.serie]
        .some(function (c) { return String(c || '').toLowerCase().indexOf(b) > -1; });
    });
  }
  if (filtro.pendentes) saida = saida.filter(function (f) { return f.pendente; });

  saida.sort(function (a, b) {
    return String(a.nome || '').localeCompare(String(b.nome || '')) ||
      String(a.patrimonio || '').localeCompare(String(b.patrimonio || ''));
  });

  return saida;
}

function AP_FER_montar_(f, item, movimentos) {
  item = item || {};
  var status = String(f.status || AP_FER_CFG.status.DISPONIVEL).toUpperCase();
  var dias = (status === AP_FER_CFG.status.EM_POSSE) ? AP_FER_dias_(f.desde) : 0;

  var ultimo = null;
  if (movimentos) {
    var meus = movimentos.filter(function (m) {
      return String(m.patrimonio) === String(f.patrimonio);
    }).sort(function (a, b) { return new Date(b.data) - new Date(a.data); });
    ultimo = meus[0] || null;
  }

  return {
    patrimonio: f.patrimonio,
    sku: f.sku || '',
    nome: f.nome || item.descricao || item.nome || '',
    categoria: f.categoria || item.categoria || '',
    marca: f.marca || item.marca || '',
    modelo: f.modelo || item.modelo || '',
    serie: f.serie || '',
    /* a foto é a do patrimônio, e na falta dela a do item */
    foto: f.foto || item.foto || '',
    status: status,
    com: f.com || '',
    matricula: f.matricula || '',
    desde: f.desde || '',
    obra: f.obra || '',
    local: f.local || item.localizacao || '',
    motivo: f.motivo || '',
    observacao: f.observacao || '',
    diasFora: dias,
    pendente: status === AP_FER_CFG.status.EM_POSSE && dias >= AP_FER_CFG.diasParaPendencia,
    ultimoMovimento: ultimo ? {
      tipo: ultimo.tipo, data: ultimo.data,
      deQuem: ultimo.deQuem, paraQuem: ultimo.paraQuem
    } : null,
    precisaPatrimonio: false
  };
}

function AP_FER_obter_(payload) {
  var f = AP_FER_linhas_(AP_FER_CFG.abas.ferramentas)
    .filter(function (x) { return String(x.patrimonio) === String(payload.patrimonio); })[0];

  if (!f) {
    /* pode ser um patrimônio ainda não registrado aqui */
    var daLista = AP_FER_listar_({}).filter(function (x) {
      return String(x.patrimonio) === String(payload.patrimonio);
    })[0];
    if (daLista) return { ok: true, dados: daLista };
    return { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Patrimônio não localizado.' };
  }

  var movimentos = AP_FER_linhas_(AP_FER_CFG.abas.movimentos);
  var catalogo = AP_FER_catalogo_();
  var item = catalogo.filter(function (i) { return (i.sku || i.id) === f.sku; })[0];
  var dados = AP_FER_montar_(f, item, movimentos);
  dados.historico = AP_FER_historico_({ patrimonio: f.patrimonio });
  return { ok: true, dados: dados };
}

/** Cadastra ou corrige a ferramenta (a amarração patrimônio ↔ SKU) */
function AP_FER_salvar_(payload, sessao) {
  if (!payload.patrimonio) {
    return {
      ok: false, codigo: 'SEM_PATRIMONIO',
      mensagem: 'A ferramenta precisa de um número de patrimônio — é ele que diz qual delas é.'
    };
  }
  AP_FER_abas_();
  var quem = AP_FER_quem_(sessao);
  var existente = AP_FER_linhas_(AP_FER_CFG.abas.ferramentas)
    .filter(function (x) { return String(x.patrimonio) === String(payload.patrimonio); })[0];

  var registro = {
    patrimonio: payload.patrimonio,
    sku: payload.sku || (existente && existente.sku) || '',
    nome: payload.nome || (existente && existente.nome) || '',
    categoria: payload.categoria || (existente && existente.categoria) || '',
    marca: payload.marca || (existente && existente.marca) || '',
    modelo: payload.modelo || (existente && existente.modelo) || '',
    serie: payload.serie || (existente && existente.serie) || '',
    foto: payload.foto || (existente && existente.foto) || '',
    obra: payload.obra || (existente && existente.obra) || '',
    local: payload.local || (existente && existente.local) || '',
    observacao: payload.observacao || (existente && existente.observacao) || '',
    atualizadoEm: AP_FER_agora_(), atualizadoPor: quem
  };

  if (existente) {
    /* status, responsável e data de posse NÃO se editam por aqui:
       quem muda isso é retirada, transferência e devolução */
    AP_Data_update(AP_FER_CFG.abas.ferramentas, payload.patrimonio, registro, 'patrimonio');
    AP_FER_auditar_(quem, 'FERRAMENTA_ATUALIZADA', payload.patrimonio, registro);
    return { ok: true, dados: registro, atualizado: true, mensagem: 'Ferramenta atualizada.' };
  }

  registro.status = AP_FER_CFG.status.DISPONIVEL;
  registro.com = ''; registro.matricula = ''; registro.desde = ''; registro.motivo = '';
  AP_Data_append(AP_FER_CFG.abas.ferramentas, registro);
  AP_FER_auditar_(quem, 'FERRAMENTA_CRIADA', payload.patrimonio, registro);

  return {
    ok: true, dados: registro, criado: true,
    mensagem: 'Ferramenta ' + payload.patrimonio + ' cadastrada e pronta para retirada.'
  };
}


/* ============================================================
   MOVIMENTAÇÃO
   ============================================================ */

/** Grava o movimento. Uma linha nova por evento — nada se sobrescreve. */
function AP_FER_movimento_(f, tipo, dados, sessao) {
  var reg = {
    id: AP_FER_id_(), data: AP_FER_agora_(),
    patrimonio: f.patrimonio, sku: f.sku || '', ferramenta: f.nome || '',
    tipo: tipo,
    deQuem: dados.deQuem || '', deMatricula: dados.deMatricula || '',
    paraQuem: dados.paraQuem || '', paraMatricula: dados.paraMatricula || '',
    obra: dados.obra || f.obra || '',
    autenticacao: dados.autenticacao || '',
    condicao: dados.condicao || '',
    observacao: dados.observacao || '',
    registradoPor: AP_FER_quem_(sessao)
  };
  AP_Data_append(AP_FER_CFG.abas.movimentos, reg);
  return reg;
}

function AP_FER_acharFerramenta_(patrimonio) {
  return AP_FER_linhas_(AP_FER_CFG.abas.ferramentas)
    .filter(function (x) { return String(x.patrimonio) === String(patrimonio); })[0];
}

/**
 * A identificação de quem leva a ferramenta. Vale a mesma regra do
 * EPI: registra-se o método que aconteceu de verdade, e sem
 * confirmação nada sai.
 */
function AP_FER_conferirAuth_(auth) {
  auth = auth || {};
  var metodo = String(auth.metodo || '').toUpperCase();
  if (!metodo) {
    return { ok: false, codigo: 'SEM_AUTENTICACAO', mensagem: 'A pessoa precisa se identificar para levar a ferramenta.' };
  }
  if (AP_FER_CFG.autenticacoes.indexOf(metodo) === -1) {
    return {
      ok: false, codigo: 'AUTENTICACAO_INVALIDA',
      mensagem: 'Método "' + metodo + '" não é aceito. Use: ' + AP_FER_CFG.autenticacoes.join(', ') + '.'
    };
  }
  if (!auth.confirmada) {
    return {
      ok: false, codigo: 'AUTENTICACAO_NAO_CONFIRMADA',
      mensagem: 'A identificação não foi confirmada. Nada é registrado como validado sem ter acontecido.'
    };
  }
  return { ok: true, metodo: metodo };
}

function AP_FER_retirar_(payload, sessao) {
  var f = AP_FER_acharFerramenta_(payload.patrimonio);
  if (!f) return { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Patrimônio não localizado.' };

  var status = String(f.status || '').toUpperCase();
  if (status === AP_FER_CFG.status.EM_POSSE) {
    return {
      ok: false, codigo: 'JA_EM_POSSE',
      mensagem: 'Esta ferramenta está com ' + (f.com || 'outra pessoa') +
        (f.desde ? ' desde ' + String(f.desde).slice(0, 10) : '') +
        '. Para passar para outra pessoa, use a transferência.',
      dados: { com: f.com, matricula: f.matricula, desde: f.desde }
    };
  }
  if (status === AP_FER_CFG.status.MANUTENCAO) {
    return {
      ok: false, codigo: 'EM_MANUTENCAO',
      mensagem: 'Ferramenta em manutenção' + (f.motivo ? ': ' + f.motivo : '') + '. Não sai para uso.'
    };
  }
  if (status === AP_FER_CFG.status.BAIXADA) {
    return { ok: false, codigo: 'BAIXADA', mensagem: 'Esta ferramenta foi baixada do patrimônio.' };
  }

  if (!payload.matricula && !payload.quem) {
    return { ok: false, codigo: 'SEM_PESSOA', mensagem: 'Diga quem está levando a ferramenta.' };
  }

  var auth = AP_FER_conferirAuth_(payload.autenticacao);
  if (!auth.ok) return auth;

  var quem = AP_FER_quem_(sessao);
  var agora = AP_FER_agora_();

  AP_Data_update(AP_FER_CFG.abas.ferramentas, f.patrimonio, {
    status: AP_FER_CFG.status.EM_POSSE,
    com: payload.quem || '', matricula: payload.matricula || '',
    desde: agora, obra: payload.obra || f.obra || '',
    motivo: '', atualizadoEm: agora, atualizadoPor: quem
  }, 'patrimonio');

  var mov = AP_FER_movimento_(f, AP_FER_CFG.tipos.RETIRADA, {
    paraQuem: payload.quem, paraMatricula: payload.matricula,
    obra: payload.obra, autenticacao: auth.metodo, observacao: payload.observacao
  }, sessao);

  AP_FER_auditar_(quem, 'FERRAMENTA_RETIRADA', f.patrimonio,
    { para: payload.quem, autenticacao: auth.metodo });

  return {
    ok: true,
    dados: {
      patrimonio: f.patrimonio, movimento: mov.id, status: AP_FER_CFG.status.EM_POSSE,
      mensagem: (f.nome || f.patrimonio) + ' saiu com ' + (payload.quem || payload.matricula) +
        ', identificado por ' + auth.metodo.toLowerCase() + '.'
    }
  };
}

function AP_FER_transferir_(payload, sessao) {
  var f = AP_FER_acharFerramenta_(payload.patrimonio);
  if (!f) return { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Patrimônio não localizado.' };

  var status = String(f.status || '').toUpperCase();
  if (status !== AP_FER_CFG.status.EM_POSSE) {
    return {
      ok: false, codigo: 'NAO_ESTA_EM_POSSE',
      mensagem: 'A ferramenta está ' + status + ' — não há de quem transferir. Faça uma retirada.'
    };
  }
  if (!payload.paraMatricula && !payload.paraQuem) {
    return { ok: false, codigo: 'SEM_DESTINO', mensagem: 'Diga para quem a ferramenta está passando.' };
  }
  if (String(payload.paraMatricula || '') && String(payload.paraMatricula) === String(f.matricula)) {
    return {
      ok: false, codigo: 'MESMA_PESSOA',
      mensagem: 'A ferramenta já está com essa pessoa.'
    };
  }

  /* quem entrega é quem está com ela: a transferência é assinada
     por quem passa, não por quem recebe */
  var auth = AP_FER_conferirAuth_(payload.autenticacao);
  if (!auth.ok) return auth;

  var quem = AP_FER_quem_(sessao);
  var agora = AP_FER_agora_();
  var de = f.com, deMat = f.matricula;

  AP_Data_update(AP_FER_CFG.abas.ferramentas, f.patrimonio, {
    com: payload.paraQuem || '', matricula: payload.paraMatricula || '',
    desde: agora, obra: payload.obra || f.obra || '',
    atualizadoEm: agora, atualizadoPor: quem
  }, 'patrimonio');

  var mov = AP_FER_movimento_(f, AP_FER_CFG.tipos.TRANSFERENCIA, {
    deQuem: de, deMatricula: deMat,
    paraQuem: payload.paraQuem, paraMatricula: payload.paraMatricula,
    obra: payload.obra, autenticacao: auth.metodo, observacao: payload.observacao
  }, sessao);

  AP_FER_auditar_(quem, 'FERRAMENTA_TRANSFERIDA', f.patrimonio,
    { de: de, para: payload.paraQuem });

  return {
    ok: true,
    dados: {
      patrimonio: f.patrimonio, movimento: mov.id,
      mensagem: (f.nome || f.patrimonio) + ' passou de ' + (de || '—') +
        ' para ' + (payload.paraQuem || payload.paraMatricula) +
        '. A responsabilidade agora é de quem recebeu.'
    }
  };
}

function AP_FER_devolver_(payload, sessao) {
  var f = AP_FER_acharFerramenta_(payload.patrimonio);
  if (!f) return { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Patrimônio não localizado.' };

  var status = String(f.status || '').toUpperCase();
  if (status !== AP_FER_CFG.status.EM_POSSE) {
    return {
      ok: false, codigo: 'NAO_ESTA_EM_POSSE',
      mensagem: status === AP_FER_CFG.status.DISPONIVEL
        ? 'Esta ferramenta já está na ferramentaria — não há o que devolver.'
        : 'A ferramenta está ' + status + '.'
    };
  }

  var auth = AP_FER_conferirAuth_(payload.autenticacao);
  if (!auth.ok) return auth;

  var condicao = String(payload.condicao || 'OK').toUpperCase();
  var comAvaria = (condicao === 'AVARIA' || condicao === 'DANIFICADA' || !!payload.avaria);
  if (comAvaria && !String(payload.observacao || '').trim()) {
    return {
      ok: false, codigo: 'SEM_DESCRICAO_DA_AVARIA',
      mensagem: 'Descreva a avaria — é o que a manutenção vai ler.'
    };
  }

  var quem = AP_FER_quem_(sessao);
  var agora = AP_FER_agora_();
  var de = f.com, deMat = f.matricula;
  var dias = AP_FER_dias_(f.desde);

  AP_Data_update(AP_FER_CFG.abas.ferramentas, f.patrimonio, {
    status: comAvaria ? AP_FER_CFG.status.MANUTENCAO : AP_FER_CFG.status.DISPONIVEL,
    com: '', matricula: '', desde: agora,
    motivo: comAvaria ? (payload.observacao || 'avaria na devolução') : '',
    atualizadoEm: agora, atualizadoPor: quem
  }, 'patrimonio');

  var mov = AP_FER_movimento_(f, AP_FER_CFG.tipos.DEVOLUCAO, {
    deQuem: de, deMatricula: deMat,
    obra: payload.obra, autenticacao: auth.metodo,
    condicao: comAvaria ? 'AVARIA' : 'OK', observacao: payload.observacao
  }, sessao);

  AP_FER_auditar_(quem, 'FERRAMENTA_DEVOLVIDA', f.patrimonio,
    { de: de, condicao: comAvaria ? 'AVARIA' : 'OK', diasFora: dias });

  return {
    ok: true,
    dados: {
      patrimonio: f.patrimonio, movimento: mov.id,
      status: comAvaria ? AP_FER_CFG.status.MANUTENCAO : AP_FER_CFG.status.DISPONIVEL,
      diasFora: dias,
      mensagem: (f.nome || f.patrimonio) + ' devolvida por ' + (de || '—') +
        ' depois de ' + dias + ' dia(s)' +
        (comAvaria
          ? '. Como veio com avaria, foi para MANUTENÇÃO e não volta para a prateleira.'
          : ' e está disponível de novo.')
    }
  };
}

function AP_FER_manutencao_(payload, sessao) {
  var f = AP_FER_acharFerramenta_(payload.patrimonio);
  if (!f) return { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Patrimônio não localizado.' };
  if (!String(payload.motivo || '').trim()) {
    return { ok: false, codigo: 'SEM_MOTIVO', mensagem: 'Diga o que a ferramenta tem.' };
  }

  var status = String(f.status || '').toUpperCase();
  if (status === AP_FER_CFG.status.MANUTENCAO) {
    return { ok: false, codigo: 'JA_EM_MANUTENCAO', mensagem: 'Esta ferramenta já está em manutenção.' };
  }

  var quem = AP_FER_quem_(sessao);
  var agora = AP_FER_agora_();
  var de = f.com, deMat = f.matricula;

  AP_Data_update(AP_FER_CFG.abas.ferramentas, f.patrimonio, {
    status: AP_FER_CFG.status.MANUTENCAO,
    com: '', matricula: '', desde: agora,
    motivo: payload.motivo, atualizadoEm: agora, atualizadoPor: quem
  }, 'patrimonio');

  var mov = AP_FER_movimento_(f, AP_FER_CFG.tipos.MANUTENCAO, {
    deQuem: de, deMatricula: deMat, observacao: payload.motivo, condicao: 'AVARIA'
  }, sessao);

  AP_FER_auditar_(quem, 'FERRAMENTA_MANUTENCAO', f.patrimonio, { motivo: payload.motivo });

  return {
    ok: true,
    dados: {
      patrimonio: f.patrimonio, movimento: mov.id,
      mensagem: (f.nome || f.patrimonio) + ' foi para manutenção e não sai para ninguém até voltar.'
    }
  };
}

function AP_FER_retorno_(payload, sessao) {
  var f = AP_FER_acharFerramenta_(payload.patrimonio);
  if (!f) return { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Patrimônio não localizado.' };

  if (String(f.status || '').toUpperCase() !== AP_FER_CFG.status.MANUTENCAO) {
    return { ok: false, codigo: 'NAO_ESTA_EM_MANUTENCAO', mensagem: 'Esta ferramenta não está em manutenção.' };
  }

  var quem = AP_FER_quem_(sessao);
  var agora = AP_FER_agora_();

  AP_Data_update(AP_FER_CFG.abas.ferramentas, f.patrimonio, {
    status: AP_FER_CFG.status.DISPONIVEL,
    com: '', matricula: '', desde: agora, motivo: '',
    atualizadoEm: agora, atualizadoPor: quem
  }, 'patrimonio');

  var mov = AP_FER_movimento_(f, AP_FER_CFG.tipos.RETORNO, {
    observacao: payload.observacao || 'manutenção concluída', condicao: 'OK'
  }, sessao);

  AP_FER_auditar_(quem, 'FERRAMENTA_RETORNO', f.patrimonio, {});

  return {
    ok: true,
    dados: {
      patrimonio: f.patrimonio, movimento: mov.id,
      mensagem: (f.nome || f.patrimonio) + ' voltou da manutenção e está disponível.'
    }
  };
}


/* ============================================================
   CONSULTAS
   ============================================================ */

/** A trajetória: tudo que aconteceu com aquela ferramenta, do mais novo ao mais velho */
function AP_FER_historico_(payload) {
  var todos = AP_FER_linhas_(AP_FER_CFG.abas.movimentos);
  var lista = payload && payload.patrimonio
    ? todos.filter(function (m) { return String(m.patrimonio) === String(payload.patrimonio); })
    : todos;

  if (payload && payload.matricula) {
    lista = lista.filter(function (m) {
      return String(m.paraMatricula) === String(payload.matricula) ||
        String(m.deMatricula) === String(payload.matricula);
    });
  }

  /* a ordem de gravação desempata o que caiu no mesmo instante:
     sem isso, dois movimentos do mesmo segundo apareciam trocados
     e a trajetória contava a história ao contrário */
  lista = lista.map(function (m, pos) {
    return {
      ordem: pos, id: m.id, data: m.data, patrimonio: m.patrimonio, sku: m.sku,
      ferramenta: m.ferramenta, tipo: String(m.tipo || '').toUpperCase(),
      deQuem: m.deQuem || '', deMatricula: m.deMatricula || '',
      paraQuem: m.paraQuem || '', paraMatricula: m.paraMatricula || '',
      obra: m.obra || '', autenticacao: m.autenticacao || '',
      condicao: m.condicao || '', observacao: m.observacao || '',
      registradoPor: m.registradoPor || ''
    };
  }).sort(function (a, b) {
    return (new Date(b.data) - new Date(a.data)) || (b.ordem - a.ordem);
  });

  if (payload && payload.limite) lista = lista.slice(0, Number(payload.limite));
  return lista;
}

/** O que está fora há tempo demais */
function AP_FER_pendencias_(payload) {
  var dias = Number((payload && payload.dias)) || AP_FER_CFG.diasParaPendencia;
  return AP_FER_listar_({ somenteComPatrimonio: true })
    .filter(function (f) {
      return f.status === AP_FER_CFG.status.EM_POSSE && f.diasFora >= dias;
    })
    .sort(function (a, b) { return b.diasFora - a.diasFora; });
}

/** O que está na mão de uma pessoa */
function AP_FER_comQuem_(payload) {
  return AP_FER_listar_({ somenteComPatrimonio: true }).filter(function (f) {
    if (payload.matricula) return String(f.matricula) === String(payload.matricula);
    if (payload.quem) return String(f.com).toLowerCase() === String(payload.quem).toLowerCase();
    return false;
  });
}

function AP_FER_painel_(payload) {
  var lista = AP_FER_listar_(payload || {});
  var conta = function (st) { return lista.filter(function (f) { return f.status === st; }).length; };

  var pessoas = {};
  lista.forEach(function (f) {
    if (f.status === AP_FER_CFG.status.EM_POSSE && f.matricula) pessoas[f.matricula] = 1;
  });

  var movimentos = AP_FER_historico_({});
  var hoje = new Date().setHours(0, 0, 0, 0);
  var doDia = movimentos.filter(function (m) {
    var d = new Date(m.data).getTime();
    return !isNaN(d) && d >= hoje;
  });

  return {
    total: lista.length,
    disponiveis: conta(AP_FER_CFG.status.DISPONIVEL),
    emPosse: conta(AP_FER_CFG.status.EM_POSSE),
    manutencao: conta(AP_FER_CFG.status.MANUTENCAO),
    semPatrimonio: conta('SEM_PATRIMONIO'),
    pendencias: AP_FER_pendencias_({}).length,
    pessoasComFerramenta: Object.keys(pessoas).length,
    movimentosHoje: doDia.length,
    ultimosMovimentos: movimentos.slice(0, 10)
  };
}


/* ============================================================
   TESTES — não tocam na planilha
   ============================================================ */

function AP_FER_testes() {
  var log = [], falhas = 0;
  function ok(nome, cond, detalhe) {
    log.push((cond ? 'PASSOU  ' : 'FALHOU  ') + nome + (detalhe ? '  [' + detalhe + ']' : ''));
    if (!cond) falhas++;
  }

  var catalogo = [
    { sku: 'ALM-FER-000001', descricao: 'Furadeira Profissional', categoria: 'Ferramentas', estoque: 3 },
    { sku: 'ALM-FER-000002', descricao: 'Serra Circular', categoria: 'Ferramentas', estoque: 1 },
    { sku: 'ALM-FER-000003', descricao: 'Nível a Laser', categoria: 'Ferramentas', estoque: 1 },
    { sku: 'ALM-ELE-000010', descricao: 'Cabo Flexível 2,5mm', categoria: 'Elétrica', estoque: 300 }
  ];

  var tabelas = {};
  tabelas[AP_FER_CFG.abas.ferramentas] = [];
  tabelas[AP_FER_CFG.abas.movimentos] = [];

  var orig = {
    est: (typeof AP_Modulo_estoque === 'function') ? AP_Modulo_estoque : null,
    get: (typeof AP_Data_getSheet === 'function') ? AP_Data_getSheet : null,
    rows: (typeof AP_Data_rows === 'function') ? AP_Data_rows : null,
    app: (typeof AP_Data_append === 'function') ? AP_Data_append : null,
    upd: (typeof AP_Data_update === 'function') ? AP_Data_update : null
  };

  try {
    AP_Modulo_estoque = function (acao) {
      if (acao === 'listar') return { ok: true, dados: catalogo };
      return { ok: false };
    };
    AP_Data_getSheet = function () { return {}; };
    AP_Data_rows = function (aba) { return tabelas[aba] || []; };
    AP_Data_append = function (aba, reg) { (tabelas[aba] = tabelas[aba] || []).push(reg); };
    AP_Data_update = function (aba, id, patch, campo) {
      (tabelas[aba] || []).forEach(function (r) {
        if (String(r[campo || 'id']) === String(id)) { for (var k in patch) r[k] = patch[k]; }
      });
    };

    var auth = { metodo: 'BIOMETRIA', confirmada: true };

    /* ---------- 1. O CATÁLOGO APARECE MESMO SEM PATRIMÔNIO ---------- */
    var lista = AP_FER_listar_({});
    ok('as ferramentas do catálogo aparecem', lista.length === 3,
      lista.length + ' na tela: ' + lista.map(function (f) { return f.nome; }).join(', '));
    ok('o cabo elétrico NÃO entra na ferramentaria',
      !lista.some(function (f) { return /Cabo/.test(f.nome); }));
    ok('sem plaquinha, a ferramenta é marcada como tal',
      lista.every(function (f) { return f.status === 'SEM_PATRIMONIO'; }),
      lista[0].status);

    /* ---------- 2. PATRIMÔNIO AMARRA A FERRAMENTA AO SKU ---------- */
    var c1 = AP_Modulo_ferramentaria('salvar', {
      patrimonio: 'FUR-001', sku: 'ALM-FER-000001', nome: 'Furadeira Profissional',
      categoria: 'Ferramentas', marca: 'Bosch', serie: 'BX-99'
    }, { nome: 'Ismael' });
    AP_Modulo_ferramentaria('salvar', {
      patrimonio: 'FUR-002', sku: 'ALM-FER-000001', nome: 'Furadeira Profissional', categoria: 'Ferramentas'
    }, {});
    AP_Modulo_ferramentaria('salvar', {
      patrimonio: 'SER-001', sku: 'ALM-FER-000002', nome: 'Serra Circular', categoria: 'Ferramentas'
    }, {});

    ok('ferramenta cadastrada com patrimônio', c1.ok, c1.ok ? c1.dados.patrimonio : c1.mensagem);
    ok('cadastrar sem patrimônio é recusado',
      AP_Modulo_ferramentaria('salvar', { nome: 'X' }).codigo === 'SEM_PATRIMONIO');

    lista = AP_FER_listar_({});
    ok('duas furadeiras do mesmo SKU convivem',
      lista.filter(function (f) { return f.sku === 'ALM-FER-000001' && f.patrimonio; }).length === 2,
      lista.filter(function (f) { return f.patrimonio; }).map(function (f) { return f.patrimonio; }).join(', '));
    ok('o SKU sem nenhuma plaquinha continua aparecendo',
      lista.some(function (f) { return f.status === 'SEM_PATRIMONIO' && /Laser/.test(f.nome); }));

    /* ---------- 3. RETIRADA ---------- */
    ok('não sai sem identificação',
      AP_Modulo_ferramentaria('retirar', {
        patrimonio: 'FUR-001', quem: 'Douglas', matricula: '5482'
      }).codigo === 'SEM_AUTENTICACAO');
    ok('identificação não confirmada não vale',
      AP_Modulo_ferramentaria('retirar', {
        patrimonio: 'FUR-001', quem: 'Douglas', matricula: '5482',
        autenticacao: { metodo: 'BIOMETRIA' }
      }).codigo === 'AUTENTICACAO_NAO_CONFIRMADA');
    ok('não sai sem dizer quem leva',
      AP_Modulo_ferramentaria('retirar', { patrimonio: 'FUR-001', autenticacao: auth }).codigo === 'SEM_PESSOA');

    var ret = AP_Modulo_ferramentaria('retirar', {
      patrimonio: 'FUR-001', quem: 'Douglas', matricula: '5482', obra: 'Obra Beta',
      autenticacao: auth
    }, { nome: 'Almoxarife' });
    ok('retirada registrada', ret.ok, ret.ok ? ret.dados.mensagem : ret.mensagem);

    var f1 = AP_Modulo_ferramentaria('obter', { patrimonio: 'FUR-001' }).dados;
    ok('a ferramenta ficou EM POSSE do Douglas',
      f1.status === 'EM_POSSE' && f1.com === 'Douglas' && f1.matricula === '5482',
      f1.status + ' com ' + f1.com);

    /* ---------- 4. DUAS PESSOAS NÃO SEGURAM A MESMA FERRAMENTA ---------- */
    var dupla = AP_Modulo_ferramentaria('retirar', {
      patrimonio: 'FUR-001', quem: 'João', matricula: '4587', autenticacao: auth
    });
    ok('A MESMA FERRAMENTA NÃO SAI DUAS VEZES', dupla.codigo === 'JA_EM_POSSE', dupla.mensagem);
    ok('e a recusa diz com quem ela está', /Douglas/.test(dupla.mensagem));

    /* ---------- 5. TRANSFERÊNCIA ---------- */
    ok('não transfere o que ninguém pegou',
      AP_Modulo_ferramentaria('transferir', {
        patrimonio: 'FUR-002', paraQuem: 'João', paraMatricula: '4587', autenticacao: auth
      }).codigo === 'NAO_ESTA_EM_POSSE');

    ok('não transfere para quem já está com ela',
      AP_Modulo_ferramentaria('transferir', {
        patrimonio: 'FUR-001', paraQuem: 'Douglas', paraMatricula: '5482', autenticacao: auth
      }).codigo === 'MESMA_PESSOA');

    var tr = AP_Modulo_ferramentaria('transferir', {
      patrimonio: 'FUR-001', paraQuem: 'João', paraMatricula: '4587',
      obra: 'Obra Beta', autenticacao: auth
    }, { nome: 'Almoxarife' });
    ok('transferência registrada', tr.ok, tr.ok ? tr.dados.mensagem : tr.mensagem);

    f1 = AP_Modulo_ferramentaria('obter', { patrimonio: 'FUR-001' }).dados;
    ok('a responsabilidade passou para o João',
      f1.com === 'João' && f1.matricula === '4587', 'agora com ' + f1.com);

    /* ---------- 6. DEVOLUÇÃO ---------- */
    ok('não devolve o que está na prateleira',
      AP_Modulo_ferramentaria('devolver', { patrimonio: 'FUR-002', autenticacao: auth }).codigo === 'NAO_ESTA_EM_POSSE');

    var dev = AP_Modulo_ferramentaria('devolver', {
      patrimonio: 'FUR-001', autenticacao: auth
    }, { nome: 'Almoxarife' });
    ok('devolução registrada', dev.ok, dev.ok ? dev.dados.mensagem : dev.mensagem);

    f1 = AP_Modulo_ferramentaria('obter', { patrimonio: 'FUR-001' }).dados;
    ok('voltou a ficar disponível', f1.status === 'DISPONIVEL' && !f1.com, f1.status);
    ok('devolver de novo é impedido',
      AP_Modulo_ferramentaria('devolver', { patrimonio: 'FUR-001', autenticacao: auth }).codigo === 'NAO_ESTA_EM_POSSE');

    /* ---------- 7. DEVOLUÇÃO COM AVARIA NÃO VOLTA PARA A PRATELEIRA ---------- */
    AP_Modulo_ferramentaria('retirar', {
      patrimonio: 'SER-001', quem: 'Marcos', matricula: '2210', autenticacao: auth
    }, {});
    ok('avaria sem descrição é recusada',
      AP_Modulo_ferramentaria('devolver', {
        patrimonio: 'SER-001', condicao: 'AVARIA', autenticacao: auth
      }).codigo === 'SEM_DESCRICAO_DA_AVARIA');

    var avar = AP_Modulo_ferramentaria('devolver', {
      patrimonio: 'SER-001', condicao: 'AVARIA',
      observacao: 'disco trincado e proteção quebrada', autenticacao: auth
    }, {});
    var f2 = AP_Modulo_ferramentaria('obter', { patrimonio: 'SER-001' }).dados;
    ok('DEVOLVIDA COM AVARIA VAI PARA MANUTENÇÃO', avar.ok && f2.status === 'MANUTENCAO',
      f2.status + ' · ' + f2.motivo);
    ok('e não sai para mais ninguém',
      AP_Modulo_ferramentaria('retirar', {
        patrimonio: 'SER-001', quem: 'Carlos', matricula: '3341', autenticacao: auth
      }).codigo === 'EM_MANUTENCAO');

    var volta = AP_Modulo_ferramentaria('retornarManutencao', { patrimonio: 'SER-001' }, {});
    ok('volta da manutenção disponível',
      volta.ok && AP_Modulo_ferramentaria('obter', { patrimonio: 'SER-001' }).dados.status === 'DISPONIVEL',
      volta.ok ? volta.dados.mensagem : volta.mensagem);

    /* ---------- 8. A TRAJETÓRIA INTEIRA ---------- */
    var hist = AP_FER_historico_({ patrimonio: 'FUR-001' });
    ok('o histórico guarda os três passos', hist.length === 3,
      hist.map(function (h) { return h.tipo; }).join(' ← '));
    ok('a transferência diz de quem para quem',
      hist.filter(function (h) { return h.tipo === 'TRANSFERENCIA'; })[0].deQuem === 'Douglas' &&
      hist.filter(function (h) { return h.tipo === 'TRANSFERENCIA'; })[0].paraQuem === 'João');
    ok('cada movimento guarda como a pessoa se identificou',
      hist.every(function (h) { return h.autenticacao === 'BIOMETRIA'; }));
    ok('NADA FOI APAGADO: a devolução não sumiu com a retirada',
      hist.some(function (h) { return h.tipo === 'RETIRADA'; }) &&
      hist.some(function (h) { return h.tipo === 'DEVOLUCAO'; }));

    /* ---------- 9. QUEM ESTÁ COM O QUÊ ---------- */
    AP_Modulo_ferramentaria('retirar', {
      patrimonio: 'FUR-002', quem: 'Carlos', matricula: '3341', autenticacao: auth
    }, {});
    var doCarlos = AP_FER_comQuem_({ matricula: '3341' });
    ok('dá para saber o que está com uma pessoa', doCarlos.length === 1,
      doCarlos.map(function (f) { return f.patrimonio; }).join(', '));

    /* ---------- 10. PAINEL ---------- */
    var painel = AP_FER_painel_({});
    ok('o painel conta o que está em posse', painel.emPosse === 1, 'em posse: ' + painel.emPosse);
    ok('o painel conta as disponíveis', painel.disponiveis === 2, 'disponíveis: ' + painel.disponiveis);
    ok('o painel conta quem ainda não tem plaquinha', painel.semPatrimonio === 1,
      'sem patrimônio: ' + painel.semPatrimonio);
    ok('o painel conta os movimentos do dia', painel.movimentosHoje >= 6,
      painel.movimentosHoje + ' movimento(s) hoje');

  } finally {
    if (orig.est) AP_Modulo_estoque = orig.est;
    if (orig.get) AP_Data_getSheet = orig.get;
    if (orig.rows) AP_Data_rows = orig.rows;
    if (orig.app) AP_Data_append = orig.app;
    if (orig.upd) AP_Data_update = orig.upd;
  }

  log.push('');
  log.push(falhas ? falhas + ' teste(s) FALHARAM' : 'todos os testes passaram');
  log.push('');
  log.push('O que foi verificado: as ferramentas do catálogo aparecem mesmo sem');
  log.push('patrimônio, cada patrimônio amarra uma ferramenta a um SKU, a mesma');
  log.push('ferramenta não sai para duas pessoas, transferência sai de quem está');
  log.push('com ela, devolução com avaria não volta para a prateleira, e o');
  log.push('histórico guarda a trajetória inteira sem apagar nada. Nada foi lido');
  log.push('nem gravado na planilha.');

  try { Logger.log(log.join('\n')); } catch (e) { }
  return log;
}
