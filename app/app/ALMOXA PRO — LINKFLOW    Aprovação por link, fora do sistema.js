/* ============================================================
   ALMOXA PRO — LINKFLOW
   Aprovação por link, fora do sistema
   ------------------------------------------------------------
   O problema que isto resolve é de obra, não de software: a
   solicitação está parada esperando uma pessoa que não abre o
   sistema. O engenheiro está na frente de serviço, o supervisor
   está em reunião, o suprimentos está na rua.

   Então o ALMOXA manda o assunto até essa pessoa. Gera um link,
   você cola no WhatsApp dela, ela abre no celular, vê exatamente
   o que precisa decidir — e só aquilo — e decide. A decisão volta
   para dentro do sistema na mesma hora.

   O QUE PODE IR NUM LINK

     APROVACAO     solicitações e reservas esperando aprovação
     COMPRA        pré-compras e ordens de compra
     DIVERGENCIA   divergência de nota fiscal para o supervisor
     EPI           ficha de EPI esperando liberação
     CONSULTA      só para ver — a pessoa lê e não decide nada
                   (é o caso de mandar a lista de itens pedidos
                    para o suprimentos dar uma olhada)

   O QUE O LINK NÃO É
     Não é login. Quem tem o link tem acesso ao que está dentro
     dele — e nada além disso. Por isso todo link:

       · é de assunto fechado: mostra só os alvos que você pôs
         nele, nunca a tela inteira do sistema;
       · vence sozinho (72 horas por padrão);
       · pode exigir um PIN de 4 dígitos, que você manda por
         outro caminho — é o que transforma "quem tem o link"
         em "quem tem o link E o PIN";
       · pode ser revogado a qualquer momento;
       · registra tudo: quando foi aberto, de onde, e o que foi
         decidido. Decisão tomada não se desfaz pelo link: para
         mudar, alguém decide dentro do sistema.

   COMO LIGAR NO SEU PROJETO
     No topo da sua função doGet, antes de tudo:

         function doGet(e) {
           try {
             var lf = AP_LINKFLOW_doGet(e);
             if (lf) return lf;
           } catch (semLinkFlow) { }
           ... o resto do seu doGet continua igual
         }

     O try/catch não é enfeite: é o que garante que, se um dia
     este arquivo for apagado ou renomeado, o sistema continue
     abrindo. Sem ele, um módulo faltando derruba o doGet inteiro
     e NINGUÉM entra no ALMOXA — nem quem nunca usou link.

     Com ele, o pior que acontece é os links pararem de abrir
     enquanto o módulo não voltar. O sistema segue de pé.

     Quando a URL tiver ?lf=TOKEN, o LinkFlow responde; quando não
     tiver, ele devolve null e o sistema abre como sempre.

   Rode AP_LINKFLOW_testes() para conferir a lógica sem tocar em dado.
   ============================================================ */

var AP_LF_CFG = {
  versao: '1.0.0',

  aba: 'ALMOXA_LINKFLOW',

  colunas: ['token', 'criadoEm', 'criadoPor', 'tipo', 'titulo', 'paraQuem',
    'paraMatricula', 'paraContato', 'perfil', 'alvos', 'mensagem', 'pin',
    'expiraEm', 'usosMax', 'usos', 'status', 'abertoEm', 'decididoEm',
    'decididoPor', 'decisao', 'motivo', 'registro'],

  tipos: ['APROVACAO', 'COMPRA', 'DIVERGENCIA', 'EPI', 'CONSULTA'],

  status: {
    ATIVO: 'ATIVO',
    USADO: 'USADO',
    EXPIRADO: 'EXPIRADO',
    REVOGADO: 'REVOGADO'
  },

  decisoes: ['APROVADO', 'REJEITADO', 'AJUSTE'],

  horasPadrao: 72,

  /* tipos que só mostram; não têm botão de decidir */
  somenteLeitura: ['CONSULTA']
};


/* ============================================================
   ENTRADA DO MÓDULO
   ============================================================ */

function AP_Modulo_linkflow(acao, payload, sessao) {
  payload = payload || {};
  try {
    switch (acao) {
      case 'gerar': return AP_LF_gerar_(payload, sessao);
      case 'listar': return { ok: true, dados: AP_LF_listar_(payload) };
      case 'obter': return AP_LF_obter_(payload);
      case 'revogar': return AP_LF_revogar_(payload, sessao);
      case 'abrir': return AP_LF_abrir_(payload);
      case 'decidir': return AP_LF_decidir_(payload);
      case 'pendentesDoPerfil': return { ok: true, dados: AP_LF_pendentesDoPerfil_(payload) };
      case 'url': return { ok: true, dados: { url: AP_LF_url_(payload.token) } };
    }
    return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'linkflow.' + acao + ' não existe.' };
  } catch (e) {
    try { console.error('[LINKFLOW] ' + acao + ': ' + e.message); } catch (x) { }
    return { ok: false, codigo: 'LINKFLOW_ERRO', mensagem: e.message };
  }
}


/* ============================================================
   APOIO
   ============================================================ */

function AP_LF_linhas_() {
  try { return AP_Data_rows(AP_LF_CFG.aba) || []; } catch (e) { return []; }
}

function AP_LF_aba_() {
  try { AP_Data_getSheet(AP_LF_CFG.aba, AP_LF_CFG.colunas); } catch (e) { }
}

function AP_LF_agora_() { return new Date().toISOString(); }

function AP_LF_quem_(sessao) {
  return (sessao && (sessao.nome || sessao.usuario || sessao.email)) || 'sistema';
}

/**
 * O token. Comprido e aleatório de propósito: ele é a chave do
 * que está dentro do link, e adivinhar um tem que ser impossível
 * na prática.
 */
function AP_LF_token_() {
  var alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  var t = '';
  try {
    var u = Utilities.getUuid().replace(/-/g, '');
    for (var i = 0; i < u.length && t.length < 28; i += 2) {
      t += alfabeto.charAt(parseInt(u.substr(i, 2), 16) % alfabeto.length);
    }
  } catch (e) { }
  while (t.length < 28) t += alfabeto.charAt(Math.floor(Math.random() * alfabeto.length));
  return t;
}

function AP_LF_json_(v, padrao) {
  if (v === undefined || v === null || v === '') return padrao;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch (e) { return padrao; }
}

function AP_LF_url_(token) {
  var base = '';
  try { base = ScriptApp.getService().getUrl(); } catch (e) { }
  if (!base) {
    try { base = PropertiesService.getScriptProperties().getProperty('ALMOXA_URL') || ''; } catch (e2) { }
  }
  if (!base) return '?lf=' + token;
  return base + (base.indexOf('?') > -1 ? '&' : '?') + 'lf=' + token;
}

function AP_LF_achar_(token) {
  if (!token) return null;
  return AP_LF_linhas_().filter(function (l) { return String(l.token) === String(token); })[0] || null;
}

function AP_LF_vencido_(l) {
  if (!l.expiraEm) return false;
  var d = new Date(l.expiraEm);
  if (isNaN(d.getTime())) return false;
  return d.getTime() < Date.now();
}

/** A situação real do link, olhando também o relógio */
function AP_LF_situacao_(l) {
  var st = String(l.status || '').toUpperCase();
  if (st === AP_LF_CFG.status.REVOGADO) return st;
  if (st === AP_LF_CFG.status.USADO) return st;
  if (AP_LF_vencido_(l)) return AP_LF_CFG.status.EXPIRADO;
  return AP_LF_CFG.status.ATIVO;
}

function AP_LF_auditar_(quem, acao, alvo, dados) {
  try {
    AP_Modulo_auditoria('registrar', {
      usuario: quem, acao: acao, alvo: alvo,
      detalhes: JSON.stringify(dados || {}), data: AP_LF_agora_()
    }, {});
  } catch (e) { }
}

function AP_LF_registrar_(l, evento) {
  var reg = AP_LF_json_(l.registro, []);
  reg.push(evento);
  return JSON.stringify(reg);
}


/* ============================================================
   1. GERAR O LINK
   ============================================================ */

function AP_LF_gerar_(payload, sessao) {
  var tipo = String(payload.tipo || 'APROVACAO').toUpperCase();
  if (AP_LF_CFG.tipos.indexOf(tipo) === -1) {
    return {
      ok: false, codigo: 'TIPO_INVALIDO',
      mensagem: 'Tipo "' + tipo + '" não existe. Use: ' + AP_LF_CFG.tipos.join(', ') + '.'
    };
  }

  var alvos = payload.alvos || [];
  if (!Array.isArray(alvos)) alvos = [alvos];

  /* sem alvo e sem perfil, o link não mostraria nada — e um link
     que abre vazio é pior que link nenhum */
  if (!alvos.length && !payload.perfil) {
    return {
      ok: false, codigo: 'SEM_CONTEUDO',
      mensagem: 'Diga o que vai no link: os alvos (protocolos, ordens, notas) ' +
        'ou o perfil cujas pendências devem aparecer.'
    };
  }

  if (!payload.paraQuem && !payload.paraMatricula && !payload.perfil) {
    return {
      ok: false, codigo: 'SEM_DESTINATARIO',
      mensagem: 'Diga para quem é o link — é o nome que fica no registro da decisão.'
    };
  }

  var pin = String(payload.pin || '').replace(/\D+/g, '');
  if (pin && pin.length !== 4) {
    return { ok: false, codigo: 'PIN_INVALIDO', mensagem: 'O PIN deve ter 4 dígitos.' };
  }

  var horas = Number(payload.horas) || AP_LF_CFG.horasPadrao;
  var expira = new Date(Date.now() + horas * 3600000).toISOString();

  AP_LF_aba_();
  var token = AP_LF_token_();
  var quem = AP_LF_quem_(sessao);

  var registro = {
    token: token, criadoEm: AP_LF_agora_(), criadoPor: quem,
    tipo: tipo,
    titulo: payload.titulo || AP_LF_tituloPadrao_(tipo),
    paraQuem: payload.paraQuem || '',
    paraMatricula: payload.paraMatricula || '',
    paraContato: payload.paraContato || '',
    perfil: payload.perfil || '',
    alvos: JSON.stringify(alvos),
    mensagem: payload.mensagem || '',
    pin: pin,
    expiraEm: expira,
    usosMax: Number(payload.usosMax) || (tipo === 'CONSULTA' ? 50 : 1),
    usos: 0,
    status: AP_LF_CFG.status.ATIVO,
    abertoEm: '', decididoEm: '', decididoPor: '', decisao: '', motivo: '',
    registro: JSON.stringify([{ evento: 'CRIADO', quando: AP_LF_agora_(), por: quem }])
  };

  AP_Data_append(AP_LF_CFG.aba, registro);
  AP_LF_auditar_(quem, 'LINKFLOW_GERADO', token,
    { tipo: tipo, para: payload.paraQuem, alvos: alvos.length });

  var url = AP_LF_url_(token);

  return {
    ok: true,
    dados: {
      token: token, url: url, expiraEm: expira, tipo: tipo,
      pin: pin ? true : false,
      texto: AP_LF_textoParaEnviar_(registro, url),
      mensagem: 'Link criado. Ele vence em ' + horas + ' horas' +
        (pin ? ' e pede o PIN de 4 dígitos — mande o PIN por outro caminho, não junto com o link' : '') +
        '.'
    }
  };
}

function AP_LF_tituloPadrao_(tipo) {
  return {
    APROVACAO: 'Solicitação aguardando sua aprovação',
    COMPRA: 'Ordem de compra aguardando sua aprovação',
    DIVERGENCIA: 'Divergência de nota fiscal para sua análise',
    EPI: 'Ficha de EPI aguardando liberação',
    CONSULTA: 'Itens solicitados para sua análise'
  }[tipo] || 'ALMOXA PRO';
}

/** O texto pronto para colar no WhatsApp */
function AP_LF_textoParaEnviar_(l, url) {
  var linhas = [];
  linhas.push('*ALMOXA PRO* — ' + l.titulo);
  if (l.paraQuem) linhas.push('Para: ' + l.paraQuem);
  if (l.mensagem) linhas.push('');
  if (l.mensagem) linhas.push(l.mensagem);
  linhas.push('');
  linhas.push(url);
  linhas.push('');
  if (AP_LF_CFG.somenteLeitura.indexOf(l.tipo) === -1) {
    linhas.push('Abra no celular e decida direto pelo link.');
  } else {
    linhas.push('Abra no celular para ver os itens.');
  }
  var d = new Date(l.expiraEm);
  if (!isNaN(d.getTime())) {
    linhas.push('O link vale até ' + ('0' + d.getDate()).slice(-2) + '/' +
      ('0' + (d.getMonth() + 1)).slice(-2) + ' às ' +
      ('0' + d.getHours()).slice(-2) + 'h.');
  }
  return linhas.join('\n');
}


/* ============================================================
   2. CONSULTAR E REVOGAR
   ============================================================ */

function AP_LF_listar_(filtro) {
  filtro = filtro || {};
  var lista = AP_LF_linhas_().map(function (l) {
    return {
      token: l.token, criadoEm: l.criadoEm, criadoPor: l.criadoPor,
      tipo: l.tipo, titulo: l.titulo,
      paraQuem: l.paraQuem, paraMatricula: l.paraMatricula, paraContato: l.paraContato,
      perfil: l.perfil, alvos: AP_LF_json_(l.alvos, []),
      mensagem: l.mensagem, temPin: !!l.pin,
      expiraEm: l.expiraEm, usos: Number(l.usos) || 0, usosMax: Number(l.usosMax) || 1,
      situacao: AP_LF_situacao_(l),
      abertoEm: l.abertoEm, decididoEm: l.decididoEm, decididoPor: l.decididoPor,
      decisao: l.decisao, motivo: l.motivo,
      registro: AP_LF_json_(l.registro, []),
      url: AP_LF_url_(l.token)
    };
  });

  if (filtro.situacao) {
    var alvo = String(filtro.situacao).toUpperCase();
    lista = lista.filter(function (l) { return l.situacao === alvo; });
  }
  if (filtro.tipo) {
    var t = String(filtro.tipo).toUpperCase();
    lista = lista.filter(function (l) { return l.tipo === t; });
  }
  if (filtro.busca) {
    var b = String(filtro.busca).toLowerCase();
    lista = lista.filter(function (l) {
      return (l.paraQuem + ' ' + l.titulo + ' ' + l.alvos.join(' ')).toLowerCase().indexOf(b) > -1;
    });
  }

  lista.sort(function (a, b) { return new Date(b.criadoEm) - new Date(a.criadoEm); });

  var conta = function (s) { return lista.filter(function (l) { return l.situacao === s; }).length; };
  return {
    links: lista,
    totais: {
      todos: lista.length,
      ativos: conta('ATIVO'),
      usados: conta('USADO'),
      expirados: conta('EXPIRADO'),
      revogados: conta('REVOGADO'),
      aprovados: lista.filter(function (l) { return l.decisao === 'APROVADO'; }).length,
      rejeitados: lista.filter(function (l) { return l.decisao === 'REJEITADO'; }).length
    }
  };
}

function AP_LF_obter_(payload) {
  var l = AP_LF_achar_(payload.token);
  if (!l) return { ok: false, codigo: 'NAO_ENCONTRADO', mensagem: 'Link não localizado.' };
  var achado = AP_LF_listar_({}).links.filter(function (x) { return x.token === l.token; })[0];
  return { ok: true, dados: achado };
}

function AP_LF_revogar_(payload, sessao) {
  var l = AP_LF_achar_(payload.token);
  if (!l) return { ok: false, codigo: 'NAO_ENCONTRADO', mensagem: 'Link não localizado.' };

  var st = AP_LF_situacao_(l);
  if (st === AP_LF_CFG.status.REVOGADO) {
    return { ok: false, codigo: 'JA_REVOGADO', mensagem: 'Este link já estava revogado.' };
  }
  if (st === AP_LF_CFG.status.USADO) {
    return {
      ok: false, codigo: 'JA_USADO',
      mensagem: 'A decisão já foi tomada por este link — revogar não desfaz o que foi decidido.'
    };
  }

  var quem = AP_LF_quem_(sessao);
  AP_Data_update(AP_LF_CFG.aba, l.token, {
    status: AP_LF_CFG.status.REVOGADO,
    registro: AP_LF_registrar_(l, { evento: 'REVOGADO', quando: AP_LF_agora_(), por: quem })
  }, 'token');

  AP_LF_auditar_(quem, 'LINKFLOW_REVOGADO', l.token, { motivo: payload.motivo || '' });

  return {
    ok: true,
    dados: { token: l.token, mensagem: 'Link revogado. Quem abrir agora vai ver que ele não vale mais.' }
  };
}


/* ============================================================
   3. ABRIR O LINK
   ------------------------------------------------------------
   Aqui é onde alguém de fora chega. Tudo que este trecho faz é
   conferir se o link ainda vale e montar o que pode ser mostrado
   — nada além dos alvos que foram postos nele.
   ============================================================ */

function AP_LF_abrir_(payload) {
  var l = AP_LF_achar_(payload.token);
  if (!l) {
    return { ok: false, codigo: 'LINK_INVALIDO', mensagem: 'Este link não existe.' };
  }

  var st = AP_LF_situacao_(l);
  if (st === AP_LF_CFG.status.REVOGADO) {
    return { ok: false, codigo: 'LINK_REVOGADO', mensagem: 'Este link foi cancelado por quem o enviou.' };
  }
  if (st === AP_LF_CFG.status.EXPIRADO) {
    return {
      ok: false, codigo: 'LINK_EXPIRADO',
      mensagem: 'Este link venceu. Peça um novo a quem enviou.'
    };
  }
  if (st === AP_LF_CFG.status.USADO) {
    return {
      ok: false, codigo: 'LINK_USADO',
      mensagem: 'Este link já foi usado' +
        (l.decisao ? ' — a decisão registrada foi: ' + String(l.decisao).toLowerCase() : '') + '.',
      dados: { decisao: l.decisao, decididoEm: l.decididoEm, decididoPor: l.decididoPor }
    };
  }

  /* o PIN, quando existe, é pedido antes de qualquer dado */
  if (l.pin) {
    var informado = String(payload.pin || '').replace(/\D+/g, '');
    if (!informado) {
      return {
        ok: false, codigo: 'PIN_NECESSARIO',
        mensagem: 'Este link pede um PIN de 4 dígitos. Ele foi enviado à parte.'
      };
    }
    if (informado !== String(l.pin)) {
      AP_Data_update(AP_LF_CFG.aba, l.token, {
        registro: AP_LF_registrar_(l, { evento: 'PIN_ERRADO', quando: AP_LF_agora_() })
      }, 'token');
      return { ok: false, codigo: 'PIN_ERRADO', mensagem: 'PIN incorreto.' };
    }
  }

  var conteudo = AP_LF_conteudo_(l);

  AP_Data_update(AP_LF_CFG.aba, l.token, {
    abertoEm: l.abertoEm || AP_LF_agora_(),
    registro: AP_LF_registrar_(l, { evento: 'ABERTO', quando: AP_LF_agora_() })
  }, 'token');

  return {
    ok: true,
    dados: {
      token: l.token, tipo: l.tipo, titulo: l.titulo,
      paraQuem: l.paraQuem, mensagem: l.mensagem,
      criadoPor: l.criadoPor, criadoEm: l.criadoEm, expiraEm: l.expiraEm,
      podeDecidir: AP_LF_CFG.somenteLeitura.indexOf(String(l.tipo).toUpperCase()) === -1,
      itens: conteudo.itens,
      resumo: conteudo.resumo
    }
  };
}

/**
 * O que existe dentro do link. Busca nos módulos do sistema o
 * estado ATUAL de cada alvo — se a solicitação já foi aprovada
 * por outro caminho enquanto o link estava no WhatsApp, é isso
 * que a pessoa vai ver, e não um retrato velho.
 */
function AP_LF_conteudo_(l) {
  var alvos = AP_LF_json_(l.alvos, []);
  var tipo = String(l.tipo || '').toUpperCase();
  var itens = [];

  /* sem alvos, o link mostra o que o perfil tem pendente */
  if (!alvos.length && l.perfil) {
    itens = AP_LF_pendentesDoPerfil_({ perfil: l.perfil });
  } else {
    alvos.forEach(function (a) {
      var alvo = (typeof a === 'string') ? { id: a, tipo: tipo } : a;
      var achado = AP_LF_buscarAlvo_(alvo, tipo);
      if (achado) itens.push(achado);
    });
  }

  var valor = itens.reduce(function (s, i) { return s + (Number(i.valor) || 0); }, 0);
  var quantos = itens.reduce(function (s, i) {
    return s + (i.itens ? i.itens.length : 0);
  }, 0);

  return {
    itens: itens,
    resumo: {
      blocos: itens.length, itens: quantos, valor: valor,
      pendentes: itens.filter(function (i) { return i.pendente; }).length
    }
  };
}

function AP_LF_buscarAlvo_(alvo, tipoPadrao) {
  var tipo = String(alvo.tipo || tipoPadrao || '').toUpperCase();
  var id = String(alvo.id || alvo.protocolo || alvo.numero || '');
  if (!id) return null;

  try {
    if (tipo === 'APROVACAO' || tipo === 'CONSULTA') {
      var r = AP_Modulo_reservas('obter', { protocolo: id }, {});
      if (r && r.ok && r.dados) return AP_LF_daReserva_(r.dados, alvo);
    }
    if (tipo === 'COMPRA') {
      var c = AP_LF_buscarCompra_(id);
      if (c) return c;
    }
    if (tipo === 'DIVERGENCIA') {
      var n = AP_Modulo_nf('obter', { numero: id }, {});
      if (n && n.ok && n.dados) return AP_LF_daNota_(n.dados, alvo);
    }
    if (tipo === 'EPI' && typeof AP_Modulo_epigestao === 'function') {
      var e = AP_Modulo_epigestao('obterReserva', { protocolo: id }, {});
      if (e && e.ok && e.dados) return AP_LF_daFichaEPI_(e.dados, alvo);
    }
  } catch (err) { }

  /* o alvo pode ter vindo com os dados prontos de quem gerou o
     link: melhor mostrar isso do que não mostrar nada */
  if (alvo.titulo || alvo.descricao) {
    return {
      id: id, tipo: tipo, titulo: alvo.titulo || alvo.descricao,
      status: alvo.status || '', pendente: true,
      valor: Number(alvo.valor) || 0,
      campos: alvo.campos || [],
      itens: alvo.itens || [],
      observacao: alvo.observacao || ''
    };
  }
  return null;
}

function AP_LF_daReserva_(res, alvo) {
  var itens = AP_LF_json_(res.itens, []);
  var status = String(res.status || '').toUpperCase();
  return {
    id: res.protocolo, tipo: 'APROVACAO',
    titulo: 'Solicitação ' + res.protocolo,
    status: status,
    pendente: status === 'PENDENTE_APROVACAO',
    valor: Number(res.valor) || itens.reduce(function (s, i) {
      return s + (Number(i.qtd) || 0) * (Number(i.preco || i.valorUnitario) || 0);
    }, 0),
    campos: [
      { rotulo: 'Solicitante', valor: res.solicitante || '' },
      { rotulo: 'Obra', valor: res.obra || '' },
      { rotulo: 'Centro de custo', valor: res.centro || '' },
      { rotulo: 'Data', valor: res.data || '' }
    ],
    itens: itens.map(function (i) {
      return {
        codigo: i.sku || i.codigo || i.id || '',
        descricao: i.nome || i.descricao || '',
        qtd: Number(i.qtd) || 0,
        unidade: i.unidade || 'un',
        valorUnitario: Number(i.preco || i.valorUnitario) || 0,
        observacao: i.observacao || ''
      };
    }),
    observacao: res.motivo || res.obs || (alvo && alvo.observacao) || ''
  };
}

function AP_LF_buscarCompra_(id) {
  try {
    var r = AP_Modulo_compras('listar', {}, {});
    var lista = (r && r.ok) ? (r.dados || []) : [];
    var achado = lista.filter(function (c) {
      return String(c.id || c.numero || c.ordem) === String(id);
    })[0];
    if (!achado) {
      var p = AP_Modulo_compras('precompras', {}, {});
      lista = (p && p.ok) ? (p.dados || []) : [];
      achado = lista.filter(function (c) { return String(c.id || c.numero) === String(id); })[0];
    }
    if (!achado) return null;

    var itens = AP_LF_json_(achado.itens, []);
    var status = String(achado.status || '').toUpperCase();
    return {
      id: id, tipo: 'COMPRA',
      titulo: 'Ordem de compra ' + id,
      status: status,
      pendente: /AGUARDANDO|ABERTA|PENDENTE/.test(status),
      valor: Number(achado.valor || achado.valorEstimado) || 0,
      campos: [
        { rotulo: 'Obra', valor: achado.obra || '' },
        { rotulo: 'Centro de custo', valor: achado.centro || achado.categoria || '' },
        { rotulo: 'Solicitante', valor: achado.solicitante || '' },
        { rotulo: 'Fornecedor sugerido', valor: achado.fornecedor || '' }
      ],
      itens: (Array.isArray(itens) ? itens : []).map(function (i) {
        return {
          codigo: i.sku || i.codigo || '', descricao: i.nome || i.descricao || '',
          qtd: Number(i.qtd) || 0, unidade: i.unidade || 'un',
          valorUnitario: Number(i.preco || i.valorUnitario) || 0
        };
      }),
      observacao: achado.observacao || achado.motivo || ''
    };
  } catch (e) { return null; }
}

function AP_LF_daNota_(nota, alvo) {
  var itens = AP_LF_json_(nota.itens, []);
  return {
    id: nota.numero, tipo: 'DIVERGENCIA',
    titulo: 'Nota fiscal ' + nota.numero,
    status: String(nota.status || '').toUpperCase(),
    pendente: true,
    valor: Number(nota.valor) || 0,
    campos: [
      { rotulo: 'Fornecedor', valor: nota.fornecedor || '' },
      { rotulo: 'Emissão', valor: nota.emissao || '' },
      { rotulo: 'Entrada', valor: nota.entrada || '' },
      { rotulo: 'Situação', valor: nota.status || '' }
    ],
    itens: (Array.isArray(itens) ? itens : []).map(function (i) {
      return {
        codigo: i.sku || i.codigo || '', descricao: i.descricao || i.nome || '',
        qtd: Number(i.qtd) || 0, unidade: i.unidade || 'un',
        valorUnitario: Number(i.valorUnitario) || 0,
        observacao: i.divergencia || ''
      };
    }),
    observacao: (alvo && alvo.observacao) || nota.observacao || ''
  };
}

function AP_LF_daFichaEPI_(ficha, alvo) {
  return {
    id: ficha.protocolo, tipo: 'EPI',
    titulo: 'Ficha de EPI ' + ficha.protocolo,
    status: ficha.status,
    pendente: /SOLICITADA|AGUARDANDO/.test(String(ficha.status || '')),
    valor: 0,
    campos: [
      { rotulo: 'Colaborador', valor: ficha.colaborador || '' },
      { rotulo: 'Matrícula', valor: ficha.matricula || '' },
      { rotulo: 'Obra', valor: ficha.obra || '' },
      { rotulo: 'Retirada marcada', valor: (ficha.prazo && ficha.prazo.dataRetirada) || '' }
    ],
    itens: (ficha.itens || []).map(function (i) {
      return {
        codigo: i.sku, descricao: i.descricao, qtd: i.qtdSolicitada,
        unidade: i.unidade || 'un', valorUnitario: 0,
        observacao: i.tamanho ? 'tam. ' + i.tamanho : ''
      };
    }),
    observacao: (alvo && alvo.observacao) || ficha.observacao || ''
  };
}

/** As pendências de um perfil, para o link que não nomeia alvos */
function AP_LF_pendentesDoPerfil_(payload) {
  var saida = [];
  try {
    var r = AP_Modulo_aprovacoes('porPerfil', { perfil: payload.perfil }, { perfil: payload.perfil });
    (r && r.ok ? (r.dados || []) : []).forEach(function (bloco) {
      if (bloco.tipo === 'RESERVA' && bloco.reserva) {
        var item = AP_LF_daReserva_(bloco.reserva, null);
        item.titulo += ' · ' + (bloco.grupo ? bloco.grupo.nome : '');
        saida.push(item);
      }
      if (bloco.tipo === 'PRECOMPRA' && bloco.precompra) {
        var c = bloco.precompra;
        saida.push({
          id: c.id || c.numero, tipo: 'COMPRA',
          titulo: 'Pré-compra ' + (c.id || c.numero),
          status: c.status, pendente: true,
          valor: Number(c.valorEstimado) || 0,
          campos: [
            { rotulo: 'Item', valor: c.nome || c.descricao || '' },
            { rotulo: 'Obra', valor: c.obra || '' }
          ],
          itens: [], observacao: c.motivo || ''
        });
      }
    });
  } catch (e) { }
  return saida;
}


/* ============================================================
   4. DECIDIR PELO LINK
   ------------------------------------------------------------
   A decisão de fora entra no sistema pelo mesmo caminho que a de
   dentro: chama o módulo dono do assunto. Se o módulo recusar, a
   decisão NÃO é dada como tomada — fica registrado que tentou e
   por que não deu, e o link continua valendo.
   ============================================================ */

function AP_LF_decidir_(payload) {
  var l = AP_LF_achar_(payload.token);
  if (!l) return { ok: false, codigo: 'LINK_INVALIDO', mensagem: 'Este link não existe.' };

  var st = AP_LF_situacao_(l);
  if (st !== AP_LF_CFG.status.ATIVO) {
    return {
      ok: false, codigo: 'LINK_' + st,
      mensagem: st === AP_LF_CFG.status.USADO
        ? 'Este link já foi usado.'
        : (st === AP_LF_CFG.status.EXPIRADO ? 'Este link venceu.' : 'Este link foi cancelado.')
    };
  }
  if (l.pin && String(payload.pin || '').replace(/\D+/g, '') !== String(l.pin)) {
    return { ok: false, codigo: 'PIN_ERRADO', mensagem: 'PIN incorreto.' };
  }

  var tipo = String(l.tipo || '').toUpperCase();
  if (AP_LF_CFG.somenteLeitura.indexOf(tipo) > -1) {
    return {
      ok: false, codigo: 'SOMENTE_LEITURA',
      mensagem: 'Este link é de consulta — não há o que decidir nele.'
    };
  }

  var decisao = String(payload.decisao || '').toUpperCase();
  if (AP_LF_CFG.decisoes.indexOf(decisao) === -1) {
    return {
      ok: false, codigo: 'DECISAO_INVALIDA',
      mensagem: 'Decisão inválida. Use: ' + AP_LF_CFG.decisoes.join(', ') + '.'
    };
  }
  if ((decisao === 'REJEITADO' || decisao === 'AJUSTE') && !String(payload.motivo || '').trim()) {
    return {
      ok: false, codigo: 'SEM_MOTIVO',
      mensagem: decisao === 'REJEITADO'
        ? 'Escreva por que está rejeitando — é o que a obra vai ler.'
        : 'Escreva o que precisa ser ajustado.'
    };
  }

  var quemDecidiu = payload.quem || l.paraQuem || 'decisor externo';
  var conteudo = AP_LF_conteudo_(l);

  /* aplica em cada alvo; nada é dado como decidido antes de o
     módulo dono confirmar */
  var aplicados = [], falhas = [];
  conteudo.itens.forEach(function (item) {
    var r = AP_LF_aplicar_(item, decisao, payload.motivo, quemDecidiu, l);
    if (r.ok) aplicados.push({ id: item.id, tipo: item.tipo, mensagem: r.mensagem });
    else falhas.push({ id: item.id, tipo: item.tipo, motivo: r.mensagem || r.codigo });
  });

  if (!aplicados.length) {
    AP_Data_update(AP_LF_CFG.aba, l.token, {
      registro: AP_LF_registrar_(l, {
        evento: 'DECISAO_RECUSADA', quando: AP_LF_agora_(),
        por: quemDecidiu, decisao: decisao, falhas: falhas
      })
    }, 'token');

    return {
      ok: false, codigo: 'NAO_APLICADA',
      mensagem: 'A decisão não pôde ser registrada: ' +
        (falhas.length ? falhas[0].motivo : 'o sistema recusou') +
        '. Nada foi alterado e o link continua valendo.',
      dados: { falhas: falhas }
    };
  }

  var usos = (Number(l.usos) || 0) + 1;
  var fecha = usos >= (Number(l.usosMax) || 1);

  AP_Data_update(AP_LF_CFG.aba, l.token, {
    usos: usos,
    status: fecha ? AP_LF_CFG.status.USADO : AP_LF_CFG.status.ATIVO,
    decisao: decisao,
    decididoEm: AP_LF_agora_(),
    decididoPor: quemDecidiu,
    motivo: payload.motivo || '',
    registro: AP_LF_registrar_(l, {
      evento: 'DECIDIDO', quando: AP_LF_agora_(), por: quemDecidiu,
      decisao: decisao, motivo: payload.motivo || '',
      aplicados: aplicados.length, falhas: falhas
    })
  }, 'token');

  AP_LF_auditar_(quemDecidiu, 'LINKFLOW_DECISAO', l.token, {
    decisao: decisao, aplicados: aplicados.length, falhas: falhas.length, externo: true
  });

  return {
    ok: true,
    dados: {
      token: l.token, decisao: decisao, decididoPor: quemDecidiu,
      decididoEm: AP_LF_agora_(),
      aplicados: aplicados, falhas: falhas,
      mensagem: (decisao === 'APROVADO' ? 'Aprovação' : decisao === 'REJEITADO' ? 'Rejeição' : 'Pedido de ajuste') +
        ' registrada em ' + aplicados.length + ' item(ns)' +
        (falhas.length ? ', com ' + falhas.length + ' que não pôde(ram) ser aplicado(s)' : '') + '.'
    }
  };
}

/** Manda a decisão para o módulo dono do assunto */
function AP_LF_aplicar_(item, decisao, motivo, quem, link) {
  var sessao = {
    nome: quem, usuario: quem, perfil: link.perfil || 'APROVADOR_EXTERNO',
    origem: 'LINKFLOW', token: link.token
  };

  try {
    if (item.tipo === 'APROVACAO') {
      var r = AP_Modulo_aprovacoes('decidir', {
        protocolo: item.id,
        decisao: decisao === 'APROVADO' ? 'APROVADA' : 'CANCELADA',
        motivo: motivo || ''
      }, sessao);
      if (r && r.ok) return { ok: true, mensagem: 'solicitação ' + item.id + ' ' + decisao.toLowerCase() };
      return { ok: false, mensagem: (r && r.mensagem) || 'o módulo de aprovações recusou' };
    }

    if (item.tipo === 'COMPRA') {
      if (typeof AP_Modulo_compras === 'function') {
        var acao = decisao === 'APROVADO' ? 'aprovarPrecompra' : 'recusarPrecompra';
        var c = AP_Modulo_compras(acao, { id: item.id, motivo: motivo || '' }, sessao);
        if (c && c.ok) return { ok: true, mensagem: 'compra ' + item.id + ' ' + decisao.toLowerCase() };
        return { ok: false, mensagem: (c && c.mensagem) || 'o módulo de compras recusou' };
      }
      return { ok: false, mensagem: 'o módulo de compras não respondeu' };
    }

    if (item.tipo === 'DIVERGENCIA') {
      var n = AP_Modulo_nf('salvar', {
        numero: item.id,
        status: decisao === 'APROVADO' ? 'CONFERIDA' : 'DIVERGENCIA',
        observacao: 'LinkFlow · ' + quem + ': ' + (motivo || decisao)
      }, sessao);
      if (n && n.ok) return { ok: true, mensagem: 'nota ' + item.id + ' ' + decisao.toLowerCase() };
      return { ok: false, mensagem: (n && n.mensagem) || 'o módulo de notas recusou' };
    }

    if (item.tipo === 'EPI' && typeof AP_Modulo_epigestao === 'function') {
      if (decisao === 'APROVADO') {
        var e = AP_Modulo_epigestao('mudarStatus', { protocolo: item.id, status: 'APROVADA' }, sessao);
        if (e && e.ok) return { ok: true, mensagem: 'ficha ' + item.id + ' aprovada' };
        return { ok: false, mensagem: (e && e.mensagem) || 'o módulo de EPI recusou' };
      }
      var x = AP_Modulo_epigestao('cancelarReserva', {
        protocolo: item.id, motivo: motivo || 'recusado por link externo'
      }, sessao);
      if (x && x.ok) return { ok: true, mensagem: 'ficha ' + item.id + ' cancelada' };
      return { ok: false, mensagem: (x && x.mensagem) || 'o módulo de EPI recusou' };
    }
  } catch (e) {
    return { ok: false, mensagem: e.message };
  }

  return { ok: false, mensagem: 'não há módulo que receba uma decisão deste tipo' };
}


/* ============================================================
   5. A PÁGINA QUE ABRE NO CELULAR
   ============================================================ */

/**
 * Chame isto no começo do seu doGet. Devolve a página do LinkFlow
 * quando a URL traz ?lf=TOKEN, e null quando não traz — aí o seu
 * doGet segue como sempre foi.
 */
function AP_LINKFLOW_doGet(e) {
  /* Sem ?lf= na URL, o LinkFlow não se mete: devolve null e o
     doGet do sistema segue como sempre foi. Esta é a garantia de
     que ligar isto não muda nada para quem abre o ALMOXA normal. */
  var token = '';
  try {
    token = (e && e.parameter && (e.parameter.lf || e.parameter.linkflow)) || '';
  } catch (erro) { return null; }
  if (!token) return null;

  /**
   * Daqui para baixo é página de link. Se der qualquer problema
   * aqui dentro, NÃO se cai no sistema — quem abriu um link tem
   * que ver que o link falhou, e não a tela de login do ALMOXA
   * pedindo uma senha que ele não tem.
   */
  var html;
  try {
    var pin = (e && e.parameter && e.parameter.pin) || '';
    html = AP_LF_pagina_(token, pin);
  } catch (falha) {
    html = AP_LF_molde_(
      '<div class="card centro"><div class="ico">⚠️</div>' +
      '<h2>Não foi possível abrir este link</h2>' +
      '<p>Avise quem enviou. Nada foi decidido nem alterado.</p>' +
      '<p class="mini">' + AP_LF_esc_(falha && falha.message ? falha.message : falha) + '</p>' +
      '</div>', token, null);
  }

  return HtmlService.createHtmlOutput(html)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setTitle('ALMOXA PRO — Aprovação');
}

function AP_LF_esc_(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Data no jeito de quem lê. O que vem do sistema é
 * "2026-09-09T10:14:00" — na tela isso não diz nada a ninguém.
 * A data pura é lida como dia daqui, não de Greenwich, senão
 * aparece sempre um dia a menos.
 */
function AP_LF_data_(v) {
  var s = String(v === undefined || v === null ? '' : v);
  if (!s) return '';
  var so = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (so) return so[3] + '/' + so[2] + '/' + so[1];

  var com = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(s);
  if (com) return com[3] + '/' + com[2] + '/' + com[1] + ' ' + com[4] + ':' + com[5];

  return s;
}

function AP_LF_moeda_(v) {
  var n = Number(v) || 0;
  var s = n.toFixed(2).split('.');
  s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return 'R$ ' + s.join(',');
}

function AP_LF_pagina_(token, pin) {
  var r = AP_LF_abrir_({ token: token, pin: pin });

  if (!r.ok && r.codigo === 'PIN_NECESSARIO') {
    return AP_LF_molde_(
      '<div class="card centro">' +
      '<div class="ico">🔒</div>' +
      '<h2>Este link pede um PIN</h2>' +
      '<p>Digite os 4 dígitos que você recebeu à parte.</p>' +
      '<input class="pin" id="pin" inputmode="numeric" maxlength="4" placeholder="••••">' +
      '<button class="bt azul" onclick="entrarComPin()">Continuar</button>' +
      '<div id="aviso"></div>' +
      '</div>', token, null);
  }

  if (!r.ok) {
    var icones = {
      LINK_EXPIRADO: '⏳', LINK_REVOGADO: '🚫', LINK_USADO: '✅',
      LINK_INVALIDO: '❓', PIN_ERRADO: '🔒'
    };
    return AP_LF_molde_(
      '<div class="card centro">' +
      '<div class="ico">' + (icones[r.codigo] || '⚠️') + '</div>' +
      '<h2>' + AP_LF_esc_(
        r.codigo === 'LINK_USADO' ? 'Decisão já registrada' :
          r.codigo === 'LINK_EXPIRADO' ? 'Link vencido' :
            r.codigo === 'LINK_REVOGADO' ? 'Link cancelado' : 'Link inválido') + '</h2>' +
      '<p>' + AP_LF_esc_(r.mensagem) + '</p>' +
      '</div>', token, null);
  }

  var d = r.dados;
  var corpo = '';

  /* cabeçalho do assunto */
  corpo += '<div class="card">' +
    '<div class="topo">' +
    '<div class="bola">' + (d.tipo === 'COMPRA' ? '🛒' : d.tipo === 'DIVERGENCIA' ? '📄' :
      d.tipo === 'EPI' ? '🦺' : d.tipo === 'CONSULTA' ? '📋' : '🛒') + '</div>' +
    '<div class="grow"><div class="rot">' + AP_LF_esc_(d.tipo === 'CONSULTA' ? 'Consulta' : 'Aguardando você') + '</div>' +
    '<h1>' + AP_LF_esc_(d.titulo) + '</h1></div>' +
    '<span class="tag laranja">' + (d.podeDecidir ? 'Aguardando aprovação' : 'Somente leitura') + '</span>' +
    '</div>' +
    (d.mensagem ? '<p class="recado">' + AP_LF_esc_(d.mensagem) + '</p>' : '') +
    '<div class="resumo">' +
    '<div><span>Blocos</span><b>' + d.resumo.blocos + '</b></div>' +
    '<div><span>Itens</span><b>' + d.resumo.itens + '</b></div>' +
    (d.resumo.valor ? '<div><span>Valor total</span><b>' + AP_LF_moeda_(d.resumo.valor) + '</b></div>' : '') +
    '</div>' +
    '<p class="mini">Enviado por ' + AP_LF_esc_(d.criadoPor) + '.</p>' +
    '</div>';

  if (!d.itens.length) {
    corpo += '<div class="card centro"><div class="ico">📭</div>' +
      '<h2>Nada pendente</h2><p>Não há nada esperando decisão neste link.</p></div>';
    return AP_LF_molde_(corpo, token, null);
  }

  /* cada bloco */
  d.itens.forEach(function (it) {
    corpo += '<div class="card">' +
      '<div class="topo"><div class="grow"><h2>' + AP_LF_esc_(it.titulo) + '</h2>' +
      (it.status ? '<div class="rot">' + AP_LF_esc_(String(it.status).replace(/_/g, ' ').toLowerCase()) + '</div>' : '') +
      '</div>' +
      (it.valor ? '<b class="valor">' + AP_LF_moeda_(it.valor) + '</b>' : '') + '</div>' +

      (it.campos && it.campos.length
        ? '<div class="campos">' + it.campos.filter(function (c) { return c.valor; }).map(function (c) {
          return '<div><span>' + AP_LF_esc_(c.rotulo) + '</span><b>' +
            AP_LF_esc_(AP_LF_data_(c.valor)) + '</b></div>';
        }).join('') + '</div>'
        : '') +

      (it.itens && it.itens.length
        ? '<table><thead><tr><th>Item</th><th>Qtd.</th><th class="dir">Valor</th></tr></thead><tbody>' +
        it.itens.map(function (i) {
          return '<tr><td><b>' + AP_LF_esc_(i.descricao) + '</b>' +
            (i.codigo ? '<div class="cod">' + AP_LF_esc_(i.codigo) + '</div>' : '') +
            (i.observacao ? '<div class="cod">' + AP_LF_esc_(i.observacao) + '</div>' : '') +
            '</td><td>' + AP_LF_esc_(i.qtd) + ' ' + AP_LF_esc_(i.unidade) + '</td>' +
            '<td class="dir">' + (i.valorUnitario
              ? AP_LF_moeda_(i.valorUnitario * (Number(i.qtd) || 0))
              : '—') + '</td></tr>';
        }).join('') + '</tbody></table>'
        : '') +

      (it.observacao ? '<p class="recado">' + AP_LF_esc_(it.observacao) + '</p>' : '') +
      '</div>';
  });

  /* os botões */
  if (d.podeDecidir) {
    corpo += '<div class="card">' +
      '<div class="acoes">' +
      '<button class="bt verde" onclick="decidir(\'APROVADO\')">✔ Aprovar</button>' +
      '<button class="bt vermelho" onclick="decidir(\'REJEITADO\')">✕ Rejeitar</button>' +
      '<button class="bt claro" onclick="decidir(\'AJUSTE\')">💬 Solicitar ajustes</button>' +
      '</div>' +
      '<div id="motivoCaixa" class="oculto">' +
      '<label id="motivoRot">Motivo</label>' +
      '<textarea id="motivo" rows="3" placeholder="Escreva aqui"></textarea>' +
      '<button class="bt azul" onclick="confirmar()">Confirmar</button>' +
      '<button class="bt claro" onclick="cancelar()">Voltar</button>' +
      '</div>' +
      '<div id="aviso"></div>' +
      '</div>';
  }

  corpo += '<div class="selos">' +
    '<div><b>🔒 Link seguro</b><span>vence sozinho e pode ser cancelado</span></div>' +
    '<div><b>📝 Tudo registrado</b><span>quem abriu, quando e o que decidiu</span></div>' +
    '<div><b>🎯 Assunto fechado</b><span>mostra só o que foi enviado</span></div>' +
    '</div>';

  return AP_LF_molde_(corpo, token, d);
}

/** A casca da página: um arquivo só, sem nada de fora */
function AP_LF_molde_(corpo, token, dados) {
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>ALMOXA PRO — Aprovação</title><style>' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;' +
    'background:#EEF1F6;color:#16233D;padding:0 0 40px;font-size:15px;line-height:1.45}' +
    '.cab{background:#132546;color:#fff;padding:16px 18px;display:flex;align-items:center;' +
    'justify-content:space-between;gap:12px;flex-wrap:wrap}' +
    '.marca{font-weight:800;font-size:19px;letter-spacing:.3px}' +
    '.marca i{color:#F28C28;font-style:normal}' +
    '.marca small{display:block;font-weight:400;font-size:11px;opacity:.75;letter-spacing:.2px}' +
    '.selo{border:1px solid rgba(255,255,255,.35);border-radius:8px;padding:6px 10px;font-size:11px;text-align:center}' +
    '.selo b{display:block;font-size:12px}' +
    '.wrap{max-width:640px;margin:0 auto;padding:14px}' +
    '.card{background:#fff;border-radius:12px;padding:16px;margin-bottom:12px;' +
    'box-shadow:0 1px 3px rgba(16,24,40,.08)}' +
    '.card.centro{text-align:center;padding:34px 20px}' +
    '.ico{font-size:46px;margin-bottom:10px}' +
    'h1{font-size:19px;line-height:1.25}h2{font-size:16px}' +
    '.topo{display:flex;gap:12px;align-items:flex-start;margin-bottom:12px;flex-wrap:wrap}' +
    '.bola{width:44px;height:44px;border-radius:10px;background:#F28C28;display:grid;' +
    'place-items:center;font-size:21px;flex:none}' +
    '.grow{flex:1;min-width:150px}' +
    '.rot{font-size:12px;color:#61708C;text-transform:uppercase;letter-spacing:.4px}' +
    '.tag{font-size:11px;padding:5px 10px;border-radius:20px;font-weight:600;white-space:nowrap}' +
    '.tag.laranja{background:#FFEFD8;color:#B36200}' +
    '.valor{font-size:17px;white-space:nowrap}' +
    '.resumo{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;' +
    'margin:12px 0;padding:12px 0;border-top:1px solid #E7EBF2;border-bottom:1px solid #E7EBF2}' +
    '.resumo span{display:block;font-size:11px;color:#61708C;text-transform:uppercase;letter-spacing:.3px}' +
    '.resumo b{font-size:16px}' +
    '.campos{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:12px}' +
    '.campos span{display:block;font-size:11px;color:#61708C}' +
    '.campos b{font-size:14px;font-weight:600}' +
    'table{width:100%;border-collapse:collapse;font-size:13.5px;margin-top:6px}' +
    'th{text-align:left;font-size:11px;color:#61708C;text-transform:uppercase;' +
    'padding:8px 6px;border-bottom:1px solid #E7EBF2}' +
    'td{padding:9px 6px;border-bottom:1px solid #F1F4F8;vertical-align:top}' +
    '.dir{text-align:right}' +
    '.cod{font-size:11px;color:#7A889F;font-family:ui-monospace,Menlo,monospace}' +
    '.recado{background:#F7F9FC;border-left:3px solid #F28C28;padding:10px 12px;' +
    'border-radius:6px;font-size:13.5px;margin-top:10px;color:#3A4A66}' +
    '.mini{font-size:11.5px;color:#7A889F;margin-top:8px}' +
    '.acoes{display:grid;gap:10px}' +
    '.bt{width:100%;border:none;border-radius:10px;padding:14px;font-size:15.5px;font-weight:700;' +
    'cursor:pointer;font-family:inherit}' +
    '.bt.verde{background:#12A05C;color:#fff}.bt.vermelho{background:#DB3B3B;color:#fff}' +
    '.bt.azul{background:#1F6FEB;color:#fff}.bt.claro{background:#EDF1F7;color:#33415C}' +
    '.bt:disabled{opacity:.55}' +
    '.oculto{display:none}' +
    '#motivoCaixa{display:none;margin-top:12px}#motivoCaixa.on{display:block}' +
    '#motivoCaixa label{display:block;font-size:12px;color:#61708C;margin-bottom:6px}' +
    'textarea{width:100%;border:1px solid #D6DCE7;border-radius:8px;padding:11px;' +
    'font-family:inherit;font-size:15px;margin-bottom:10px;resize:vertical}' +
    '.pin{width:170px;font-size:30px;text-align:center;letter-spacing:12px;padding:12px;' +
    'border:1px solid #D6DCE7;border-radius:10px;margin:14px auto;display:block}' +
    '.selos{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;' +
    'font-size:11.5px;color:#61708C;text-align:center;margin-top:6px}' +
    '.selos b{display:block;color:#33415C;font-size:12px;margin-bottom:2px}' +
    '.alerta{border-radius:8px;padding:11px 12px;font-size:13.5px;margin-top:10px}' +
    '.alerta.ruim{background:#FDECEC;color:#A32020}' +
    '.alerta.bom{background:#E6F6EE;color:#0B6B3E}' +
    '.ok{text-align:center;padding:30px 20px}' +
    '.ok .marcaVerde{width:96px;height:96px;border-radius:50%;background:#12A05C;color:#fff;' +
    'font-size:52px;display:grid;place-items:center;margin:0 auto 16px}' +
    '.linhas{text-align:left;background:#F7F9FC;border-radius:10px;padding:14px;margin-top:16px}' +
    '.linhas div{display:flex;justify-content:space-between;gap:12px;padding:5px 0;font-size:13.5px}' +
    '.linhas span{color:#61708C}' +
    '</style></head><body>' +

    '<div class="cab"><div class="marca">ALMOXA <i>PRO</i>' +
    '<small>Gestão Inteligente para Obras</small></div>' +
    '<div class="selo"><b>LinkFlow</b>Aprovação externa</div></div>' +

    '<div class="wrap" id="tela">' + corpo + '</div>' +

    '<script>' +
    'var TOKEN=' + JSON.stringify(token) + ';' +
    'var PIN="";' +
    'var escolha=null;' +
    'function $(i){return document.getElementById(i);}' +
    'function aviso(t,classe){var a=$("aviso");if(a)a.innerHTML=' +
    '\'<div class="alerta \'+(classe||"ruim")+\'">\'+t+"</div>";}' +
    'function entrarComPin(){var v=($("pin").value||"").replace(/\\D/g,"");' +
    'if(v.length!==4){aviso("Digite os 4 dígitos.");return;}' +
    'location.search="?lf="+encodeURIComponent(TOKEN)+"&pin="+encodeURIComponent(v);}' +
    'function decidir(d){escolha=d;' +
    'if(d==="APROVADO"){enviar(d,"");return;}' +
    '$("motivoRot").textContent=(d==="REJEITADO")?"Por que está rejeitando?":"O que precisa ser ajustado?";' +
    '$("motivoCaixa").className="on";$("motivo").focus();}' +
    'function cancelar(){escolha=null;$("motivoCaixa").className="oculto";}' +
    'function confirmar(){var m=($("motivo").value||"").trim();' +
    'if(!m){aviso("Escreva o motivo — é o que a obra vai ler.");return;}enviar(escolha,m);}' +
    'function enviar(decisao,motivo){' +
    'var bts=document.querySelectorAll(".bt");' +
    'for(var i=0;i<bts.length;i++)bts[i].disabled=true;' +
    'aviso("Registrando…","bom");' +
    'google.script.run.withSuccessHandler(function(r){' +
    'var res=(typeof r==="string")?JSON.parse(r):r;' +
    'if(res&&res.ok){pronto(res.dados,decisao);return;}' +
    'for(var i=0;i<bts.length;i++)bts[i].disabled=false;' +
    'aviso((res&&res.mensagem)||"Não foi possível registrar.");' +
    '}).withFailureHandler(function(e){' +
    'for(var i=0;i<bts.length;i++)bts[i].disabled=false;' +
    'aviso("Falha de comunicação: "+(e&&e.message?e.message:e));' +
    '}).AP_LINKFLOW_decidirDaPagina(TOKEN,decisao,motivo,PIN);}' +
    'function pronto(d,decisao){' +
    'var titulo=decisao==="APROVADO"?"Aprovação realizada com sucesso!":' +
    '(decisao==="REJEITADO"?"Rejeição registrada":"Pedido de ajuste enviado");' +
    'var cor=decisao==="APROVADO"?"#12A05C":(decisao==="REJEITADO"?"#DB3B3B":"#1F6FEB");' +
    'var marca=decisao==="APROVADO"?"✓":(decisao==="REJEITADO"?"✕":"💬");' +
    'document.getElementById("tela").innerHTML=' +
    '\'<div class="card ok"><div class="marcaVerde" style="background:\'+cor+\'">\'+marca+"</div>"+' +
    '"<h1>"+titulo+"</h1>"+' +
    '\'<p style="margin-top:8px;color:#4A5A78">\'+(d.mensagem||"")+"</p>"+' +
    '\'<div class="linhas">\'+' +
    '"<div><span>Decisão</span><b>"+(d.decisao||"").toLowerCase()+"</b></div>"+' +
    '"<div><span>Registrado por</span><b>"+(d.decididoPor||"")+"</b></div>"+' +
    '"<div><span>Data / hora</span><b>"+new Date().toLocaleString("pt-BR")+"</b></div>"+' +
    '"<div><span>Método</span><b>LinkFlow (externo)</b></div>"+' +
    '"</div>"+' +
    '\'<p class="mini" style="margin-top:16px">Você pode fechar esta página. \' +' +
    '"O resultado já foi registrado no ALMOXA PRO.</p></div>";' +
    'window.scrollTo(0,0);}' +
    '</script></body></html>';
}

/* ============================================================
   AS DUAS PORTAS QUE A PÁGINA USA
   ------------------------------------------------------------
   Elas existem fora do módulo por um motivo: o google.script.run
   só enxerga funções soltas do projeto.

   E existem separadas do almoxaApi por outro, mais importante:
   quem abre um link de aprovação NÃO FEZ LOGIN — é um supervisor
   no WhatsApp, não um usuário do sistema. O almoxaApi exige
   sessão, e está certo em exigir: é o que protege o resto.

   Aqui a autorização é outra, e é suficiente: o próprio token.
   Ele é longo, aleatório, vence sozinho, vale para um assunto só
   e pode pedir PIN. Quem tem o token tem direito àquele assunto
   — e a nada além dele.
   ============================================================ */

/** A página pede o conteúdo do link. Sem sessão, com o token. */
function AP_LINKFLOW_abrirDaPagina(token, pin) {
  var r = AP_Modulo_linkflow('abrir', { token: token, pin: pin }, {});
  return JSON.stringify(r);
}

/** Chamada pela página. Fica fora do módulo para o google.script.run alcançar. */
function AP_LINKFLOW_decidirDaPagina(token, decisao, motivo, pin) {
  var r = AP_Modulo_linkflow('decidir', {
    token: token, decisao: decisao, motivo: motivo, pin: pin
  }, {});
  return JSON.stringify(r);
}


/* ============================================================
   TESTES — não tocam na planilha
   ============================================================ */

function AP_LINKFLOW_testes() {
  var log = [], falhas = 0;
  function ok(nome, cond, detalhe) {
    log.push((cond ? 'PASSOU  ' : 'FALHOU  ') + nome + (detalhe ? '  [' + detalhe + ']' : ''));
    if (!cond) falhas++;
  }

  var tabela = [];
  var reservas = {
    '#RES-000187': {
      protocolo: '#RES-000187', solicitante: 'Ismael Silva', obra: 'Residencial Real Parque',
      centro: 'Alvenaria', data: '2026-09-09T10:14:00', valor: 3800, status: 'PENDENTE_APROVACAO',
      motivo: 'Material elétrico da frente de serviço',
      itens: JSON.stringify([
        { sku: 'ELE-001', nome: 'Cabo 2,5 mm', qtd: 500, unidade: 'm', preco: 2.80 },
        { sku: 'ELE-002', nome: 'Disjuntor 25A', qtd: 20, unidade: 'un', preco: 18.50 }
      ])
    }
  };

  var orig = {
    get: (typeof AP_Data_getSheet === 'function') ? AP_Data_getSheet : null,
    rows: (typeof AP_Data_rows === 'function') ? AP_Data_rows : null,
    app: (typeof AP_Data_append === 'function') ? AP_Data_append : null,
    upd: (typeof AP_Data_update === 'function') ? AP_Data_update : null,
    res: (typeof AP_Modulo_reservas === 'function') ? AP_Modulo_reservas : null,
    apr: (typeof AP_Modulo_aprovacoes === 'function') ? AP_Modulo_aprovacoes : null
  };

  try {
    AP_Data_getSheet = function () { return {}; };
    AP_Data_rows = function () { return tabela; };
    AP_Data_append = function (aba, reg) { tabela.push(reg); };
    AP_Data_update = function (aba, id, patch, campo) {
      tabela.forEach(function (r) {
        if (String(r[campo || 'id']) === String(id)) { for (var k in patch) r[k] = patch[k]; }
      });
    };
    AP_Modulo_reservas = function (acao, p) {
      if (acao === 'obter') {
        return reservas[p.protocolo] ? { ok: true, dados: reservas[p.protocolo] } : { ok: false };
      }
      return { ok: false };
    };
    AP_Modulo_aprovacoes = function (acao, p) {
      if (acao === 'decidir') {
        var r = reservas[p.protocolo];
        if (!r) return { ok: false, mensagem: 'reserva não existe' };
        if (r.status !== 'PENDENTE_APROVACAO') {
          return { ok: false, mensagem: 'esta solicitação já foi decidida' };
        }
        r.status = p.decisao;
        r.aprovador = 'externo';
        return { ok: true, dados: r };
      }
      return { ok: false };
    };

    /* ---------- 1. GERAR ---------- */
    var g = AP_Modulo_linkflow('gerar', {
      tipo: 'APROVACAO', paraQuem: 'Carlos Alberto Lima', paraContato: '92999990000',
      alvos: ['#RES-000187'], mensagem: 'Preciso disso hoje, Carlos.'
    }, { nome: 'Ismael Silva' });

    ok('link gerado', g.ok, g.ok ? g.dados.token.slice(0, 10) + '…' : g.mensagem);
    ok('o token é longo o bastante para não se adivinhar',
      g.ok && g.dados.token.length >= 24, g.ok ? g.dados.token.length + ' caracteres' : '');
    ok('vem com o texto pronto para o WhatsApp',
      g.ok && /ALMOXA PRO/.test(g.dados.texto) && /Carlos/.test(g.dados.texto));

    var tk = g.ok ? g.dados.token : '';

    ok('link sem conteúdo é recusado',
      AP_Modulo_linkflow('gerar', { paraQuem: 'X' }).codigo === 'SEM_CONTEUDO');
    ok('link sem destinatário é recusado',
      AP_Modulo_linkflow('gerar', { alvos: ['#RES-000187'] }).codigo === 'SEM_DESTINATARIO');
    ok('tipo inventado é recusado',
      AP_Modulo_linkflow('gerar', {
        tipo: 'QUALQUER', paraQuem: 'X', alvos: ['a']
      }).codigo === 'TIPO_INVALIDO');

    /* ---------- 2. ABRIR ---------- */
    var a = AP_Modulo_linkflow('abrir', { token: tk });
    ok('o link abre', a.ok, a.ok ? a.dados.titulo : a.mensagem);
    ok('mostra a solicitação certa',
      a.ok && a.dados.itens.length === 1 && a.dados.itens[0].id === '#RES-000187');
    ok('traz os itens com quantidade e valor',
      a.ok && a.dados.itens[0].itens.length === 2 &&
      a.dados.itens[0].itens[0].descricao === 'Cabo 2,5 mm',
      a.ok ? a.dados.itens[0].itens.map(function (i) { return i.descricao; }).join(', ') : '');
    ok('soma o valor do que está no link', a.ok && a.dados.resumo.valor === 3800,
      a.ok ? AP_LF_moeda_(a.dados.resumo.valor) : '');
    ok('token inventado não abre',
      AP_Modulo_linkflow('abrir', { token: 'nao-existe' }).codigo === 'LINK_INVALIDO');

    /* ---------- 3. O LINK SÓ MOSTRA O QUE ESTÁ NELE ---------- */
    reservas['#RES-000999'] = {
      protocolo: '#RES-000999', solicitante: 'Outra pessoa', valor: 99999,
      status: 'PENDENTE_APROVACAO', itens: '[]'
    };
    a = AP_Modulo_linkflow('abrir', { token: tk });
    ok('O LINK NÃO VAZA O QUE NÃO FOI ENVIADO NELE',
      a.dados.itens.length === 1 && a.dados.itens[0].id === '#RES-000187',
      'mostrou ' + a.dados.itens.length + ' bloco(s)');

    /* ---------- 4. DECIDIR ---------- */
    ok('rejeitar sem motivo é recusado',
      AP_Modulo_linkflow('decidir', { token: tk, decisao: 'REJEITADO' }).codigo === 'SEM_MOTIVO');
    ok('decisão inventada é recusada',
      AP_Modulo_linkflow('decidir', { token: tk, decisao: 'TALVEZ' }).codigo === 'DECISAO_INVALIDA');

    var d = AP_Modulo_linkflow('decidir', {
      token: tk, decisao: 'APROVADO', quem: 'Carlos Alberto Lima'
    });
    ok('a aprovação pelo link funciona', d.ok, d.ok ? d.dados.mensagem : d.mensagem);
    ok('A DECISÃO ENTROU NO SISTEMA DE VERDADE',
      reservas['#RES-000187'].status === 'APROVADA',
      'a solicitação ficou ' + reservas['#RES-000187'].status);
    ok('fica registrado quem decidiu por fora',
      AP_LF_achar_(tk).decididoPor === 'Carlos Alberto Lima');

    /* ---------- 5. LINK DE UM USO SÓ ---------- */
    var reabrir = AP_Modulo_linkflow('abrir', { token: tk });
    ok('LINK USADO NÃO ABRE DE NOVO', reabrir.codigo === 'LINK_USADO', reabrir.mensagem);
    ok('e não aceita uma segunda decisão',
      AP_Modulo_linkflow('decidir', { token: tk, decisao: 'REJEITADO', motivo: 'mudei de ideia' })
        .codigo === 'LINK_USADO');

    /* ---------- 6. QUANDO O MÓDULO RECUSA, NADA É DADO COMO FEITO ---------- */
    var g2 = AP_Modulo_linkflow('gerar', {
      tipo: 'APROVACAO', paraQuem: 'Carlos', alvos: ['#RES-000187']
    }, { nome: 'Ismael' });
    var d2 = AP_Modulo_linkflow('decidir', { token: g2.dados.token, decisao: 'APROVADO' });
    ok('DECISÃO RECUSADA PELO MÓDULO NÃO É REGISTRADA COMO FEITA',
      !d2.ok && d2.codigo === 'NAO_APLICADA', d2.mensagem);
    ok('e o link continua valendo para tentar de novo',
      AP_LF_situacao_(AP_LF_achar_(g2.dados.token)) === 'ATIVO');

    /* ---------- 7. PIN ---------- */
    var g3 = AP_Modulo_linkflow('gerar', {
      tipo: 'APROVACAO', paraQuem: 'Supervisor', alvos: ['#RES-000999'], pin: '4731'
    }, { nome: 'Ismael' });
    ok('PIN de 4 dígitos é aceito', g3.ok && g3.dados.pin === true);
    ok('PIN torto é recusado',
      AP_Modulo_linkflow('gerar', {
        tipo: 'APROVACAO', paraQuem: 'X', alvos: ['a'], pin: '12'
      }).codigo === 'PIN_INVALIDO');
    ok('SEM O PIN O LINK NÃO MOSTRA NADA',
      AP_Modulo_linkflow('abrir', { token: g3.dados.token }).codigo === 'PIN_NECESSARIO');
    ok('PIN errado não passa',
      AP_Modulo_linkflow('abrir', { token: g3.dados.token, pin: '0000' }).codigo === 'PIN_ERRADO');
    ok('com o PIN certo abre',
      AP_Modulo_linkflow('abrir', { token: g3.dados.token, pin: '4731' }).ok);

    /* ---------- 8. VALIDADE E REVOGAÇÃO ---------- */
    var g4 = AP_Modulo_linkflow('gerar', {
      tipo: 'APROVACAO', paraQuem: 'Alguém', alvos: ['#RES-000999'], horas: 1
    }, {});
    AP_Data_update(AP_LF_CFG.aba, g4.dados.token,
      { expiraEm: new Date(Date.now() - 3600000).toISOString() }, 'token');
    ok('LINK VENCIDO NÃO ABRE',
      AP_Modulo_linkflow('abrir', { token: g4.dados.token }).codigo === 'LINK_EXPIRADO');

    var g5 = AP_Modulo_linkflow('gerar', {
      tipo: 'APROVACAO', paraQuem: 'Alguém', alvos: ['#RES-000999']
    }, {});
    ok('revogar funciona', AP_Modulo_linkflow('revogar', { token: g5.dados.token }, {}).ok);
    ok('LINK REVOGADO NÃO ABRE',
      AP_Modulo_linkflow('abrir', { token: g5.dados.token }).codigo === 'LINK_REVOGADO');
    ok('não se revoga o que já foi decidido',
      AP_Modulo_linkflow('revogar', { token: tk }, {}).codigo === 'JA_USADO');

    /* ---------- 9. LINK DE CONSULTA ---------- */
    var gc = AP_Modulo_linkflow('gerar', {
      tipo: 'CONSULTA', paraQuem: 'Suprimentos', alvos: ['#RES-000187'],
      mensagem: 'Dá uma olhada nesses itens, por favor'
    }, {});
    var ac = AP_Modulo_linkflow('abrir', { token: gc.dados.token });
    ok('link de consulta abre sem botão de decidir', ac.ok && ac.dados.podeDecidir === false);
    ok('e recusa qualquer decisão',
      AP_Modulo_linkflow('decidir', { token: gc.dados.token, decisao: 'APROVADO' })
        .codigo === 'SOMENTE_LEITURA');
    ok('consulta pode ser aberta várias vezes',
      AP_Modulo_linkflow('abrir', { token: gc.dados.token }).ok);

    /* ---------- 10. A PÁGINA ---------- */
    var gp = AP_Modulo_linkflow('gerar', {
      tipo: 'APROVACAO', paraQuem: 'Carlos', alvos: ['#RES-000999']
    }, {});
    var html = AP_LF_pagina_(gp.dados.token, '');
    ok('a página sai inteira', /<\/html>/.test(html) && html.length > 3000, html.length + ' bytes');
    ok('a página mostra a marca e o LinkFlow', /ALMOXA/.test(html) && /LinkFlow/.test(html));
    ok('a página tem os três botões',
      /Aprovar/.test(html) && /Rejeitar/.test(html) && /Solicitar ajustes/.test(html));
    ok('a página de link vencido não mostra os dados',
      !/RES-000999/.test(AP_LF_pagina_(g4.dados.token, '')));

    /* ---------- 11. A LISTA DE LINKS ---------- */
    var lst = AP_Modulo_linkflow('listar', {}).dados;
    ok('a lista traz todos os links', lst.links.length === tabela.length, lst.links.length + ' link(s)');
    ok('os totais batem',
      lst.totais.usados >= 1 && lst.totais.revogados === 1 && lst.totais.expirados === 1,
      'ativos ' + lst.totais.ativos + ' · usados ' + lst.totais.usados +
      ' · expirados ' + lst.totais.expirados + ' · revogados ' + lst.totais.revogados);
    ok('cada link guarda o que aconteceu com ele',
      AP_LF_json_(AP_LF_achar_(tk).registro, []).length >= 3,
      AP_LF_json_(AP_LF_achar_(tk).registro, []).map(function (e) { return e.evento; }).join(' → '));

  } finally {
    if (orig.get) AP_Data_getSheet = orig.get;
    if (orig.rows) AP_Data_rows = orig.rows;
    if (orig.app) AP_Data_append = orig.app;
    if (orig.upd) AP_Data_update = orig.upd;
    if (orig.res) AP_Modulo_reservas = orig.res;
    if (orig.apr) AP_Modulo_aprovacoes = orig.apr;
  }

  log.push('');
  log.push(falhas ? falhas + ' teste(s) FALHARAM' : 'todos os testes passaram');
  log.push('');
  log.push('O que foi verificado: o link mostra só o que foi posto nele, a decisão');
  log.push('entra no sistema de verdade, link usado não abre nem decide de novo,');
  log.push('decisão recusada pelo módulo não é dada como feita, o PIN barra quem');
  log.push('não o tem, link vencido e revogado não mostram dado nenhum, e tudo');
  log.push('fica registrado. Nada foi lido nem gravado na planilha.');

  try { Logger.log(log.join('\n')); } catch (e) { }
  return log;
}
