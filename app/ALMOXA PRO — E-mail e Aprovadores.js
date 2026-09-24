/**
 * ALMOXA PRO — E-mail e Aprovadores
 *
 * Três coisas, todas guardadas na sua planilha:
 *   1. ALMOXA_APROVADORES  — quem aprova quem, por obra e por tipo de operação
 *   2. ALMOXA_EMAIL_MODELOS — os textos dos e-mails, editáveis por você
 *   3. ALMOXA_EMAIL_LOG    — tudo o que foi enviado
 *
 * Não cria cadastro de usuário novo: o e-mail de cada pessoa continua
 * vindo da coluna "email" da aba USUARIOS.
 *
 * INSTALAÇÃO
 *  1. Cole num arquivo novo do Apps Script.
 *  2. Rode AP_EMAIL_instalar (cria as abas e os modelos iniciais).
 *  3. Rode AP_EMAIL_testar para receber um e-mail de teste.
 *
 * QUOTA: conta comum do Gmail envia 100 e-mails por dia; Workspace, 1500.
 * O módulo confere antes de enviar e avisa quando está no limite.
 */

/** Identidade e cópia fixa. Mude aqui ou pela aba CONFIG (chaves iguais). */
function AP_EMAIL_cfg() {
  return {
    empresa: AP_Config_get('EMAIL_EMPRESA', 'COESA'),
    assinatura: AP_Config_get('EMAIL_ASSINATURA', 'CONSTRUINDO SOLUÇÕES · DESDE 1974'),
    sistema: AP_Config_get('EMAIL_SISTEMA', 'ALMOX-PRO'),
    subtitulo: AP_Config_get('EMAIL_SUBTITULO', 'GESTÃO INTELIGENTE DE MATERIAIS E OPERAÇÕES'),
    logo: AP_Config_get('EMAIL_LOGO_URL', ''),
    copiaPadrao: AP_Config_get('EMAIL_COPIA_PADRAO', ''),
    suporte: AP_Config_get('EMAIL_SUPORTE', '')
  };
}

var AP_EMAIL_ABAS = {
  aprovadores: 'ALMOXA_APROVADORES',
  modelos: 'ALMOXA_EMAIL_MODELOS',
  log: 'ALMOXA_EMAIL_LOG'
};

/* ============================================================
   INSTALAÇÃO
   ============================================================ */
function AP_EMAIL_instalar() {
  var ss = AP_Config_getSpreadsheet_();
  var feitos = [];

  function garantir(nome, colunas) {
    var aba = ss.getSheetByName(nome);
    if (!aba) {
      aba = ss.insertSheet(nome);
      aba.getRange(1, 1, 1, colunas.length).setValues([colunas]);
      aba.setFrozenRows(1);
      feitos.push('criada ' + nome);
      return aba;
    }
    /* aba já existia: acrescenta as colunas que faltam, sem apagar nada */
    var cab = aba.getRange(1, 1, 1, Math.max(1, aba.getLastColumn())).getValues()[0]
      .map(function (c) { return String(c).trim(); });
    var faltam = colunas.filter(function (c) { return cab.indexOf(c) === -1; });
    if (faltam.length) {
      aba.getRange(1, cab.length + 1, 1, faltam.length).setValues([faltam]);
      feitos.push(nome + ': colunas acrescentadas (' + faltam.join(', ') + ')');
    }
    return aba;
  }

  garantir(AP_EMAIL_ABAS.aprovadores,
    ['id', 'aprovador', 'matriculaAprovador', 'emailAprovador', 'copia', 'equipe', 'empresa',
     'obra', 'operacoes', 'valorMaximo', 'ativo', 'observacao']);

  var modelos = garantir(AP_EMAIL_ABAS.modelos,
    ['chave', 'assunto', 'corpo', 'ativo', 'observacao']);

  garantir(AP_EMAIL_ABAS.log,
    ['quando', 'tipo', 'para', 'assunto', 'referencia', 'resultado', 'motivo', 'enviadoPor']);

  if (modelos.getLastRow() < 2) {
    modelos.getRange(2, 1, 4, 5).setValues([
      ['aprovacao',
       'ALMOXA PRO · Aprovação pendente — {{titulo}}',
       'Olá {{aprovador}},\n\n{{solicitante}} pediu a sua aprovação.\n\n' +
       'O que é: {{titulo}}\nObra: {{obra}}\nQuando: {{quando}}\n\n{{detalhes}}\n\n' +
       'Para aprovar ou recusar, abra o link abaixo:\n{{link}}\n\n' +
       'O link vale até {{validade}}.',
       true,
       'Use {{aprovador}} {{solicitante}} {{titulo}} {{obra}} {{quando}} {{detalhes}} {{link}} {{validade}}'],
      ['relatorio',
       'ALMOXA PRO · {{titulo}}',
       'Olá {{destinatario}},\n\nSegue o {{titulo}} de {{quando}}.\n\n{{detalhes}}\n\n' +
       'Gerado pelo ALMOXA PRO.',
       true,
       'Use {{destinatario}} {{titulo}} {{quando}} {{detalhes}}'],
      ['transferencia',
       'ALMOXA PRO · Transferência de material — {{destino}}',
       'Olá {{destinatario}},\n\n{{detalhes}}',
       true,
       'A tabela de itens e o valor total são montados pelo sistema.'],
      ['aviso',
       'ALMOXA PRO · {{titulo}}',
       'Olá {{destinatario}},\n\n{{detalhes}}\n\nALMOXA PRO.',
       true,
       'Modelo livre. Acrescente os seus abaixo, com a chave que quiser.']
    ]);
    feitos.push('modelos iniciais criados');
  }

  var texto = feitos.length ? feitos.join('\n') : 'Tudo já estava instalado.';
  Logger.log(texto);
  return texto;
}

/* ============================================================
   APROVADORES
   ============================================================ */

/** Quem pode aprovar para esta pessoa, nesta operação e nesta obra. */
function AP_EMAIL_aprovadoresDe(matricula, operacao, obra) {
  var linhas = AP_EMAIL_lerAba_(AP_EMAIL_ABAS.aprovadores);
  var mat = AP_EMAIL_norm_(matricula);

  return linhas.filter(function (r) {
    if (String(r.ativo) === 'false' || r.ativo === false) return false;

    var equipe = String(r.equipe || '').split(/[;,]/).map(AP_EMAIL_norm_).filter(Boolean);
    var cuidaDela = !equipe.length || equipe.indexOf(mat) > -1;
    if (!cuidaDela) return false;

    if (obra && r.obra && String(r.obra).trim() && String(r.obra).trim() !== String(obra).trim()) return false;

    var ops = String(r.operacoes || '').split(/[;,]/).map(function (x) {
      return String(x).trim().toLowerCase();
    }).filter(Boolean);
    if (ops.length && operacao && ops.indexOf(String(operacao).toLowerCase()) < 0 && ops.indexOf('*') < 0) return false;

    return true;
  }).map(function (r) {
    return {
      nome: r.aprovador,
      matricula: r.matriculaAprovador,
      email: AP_EMAIL_enderecoDe_(r.emailAprovador, r.matriculaAprovador),
      copia: String(r.copia || ''),
      valorMaximo: Number(r.valorMaximo) || 0,
      empresa: r.empresa || '',
      obra: r.obra || ''
    };
  }).filter(function (a) { return a.email; });
}

/** Pega o e-mail: o da linha do aprovador, senão o da aba USUARIOS. */
function AP_EMAIL_enderecoDe_(email, matricula) {
  var e = String(email || '').trim();
  if (AP_EMAIL_valido_(e)) return e;
  try {
    var u = AP_ADAPT_localizar_(matricula);
    if (u && AP_EMAIL_valido_(u.email)) return String(u.email).trim();
  } catch (x) {}
  return '';
}

/** @almoxa.local é endereço interno, não recebe nada. */
function AP_EMAIL_valido_(e) {
  var t = String(e || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t)) return false;
  return !/@almoxa\.local$/i.test(t);
}

/* ============================================================
   ENVIO
   ============================================================ */

/**
 * Manda um e-mail a partir de um modelo.
 * @param {string} chave     chave do modelo (aprovacao, relatorio, aviso, ou o seu)
 * @param {string|Array} para e-mail ou lista
 * @param {Object} campos    valores das {{marcações}}
 * @param {Object} extra     { referencia, anexos }
 */
function AP_EMAIL_enviar(chave, para, campos, extra) {
  extra = extra || {};
  campos = campos || {};

  var destinos = (para instanceof Array ? para : [para])
    .map(function (e) { return String(e || '').trim(); })
    .filter(AP_EMAIL_valido_);

  var cfg = AP_EMAIL_cfg();
  var copias = []
    .concat(extra.copia || [])
    .concat(String(cfg.copiaPadrao || '').split(/[;,]/))
    .map(function (e) { return String(e || '').trim(); })
    .filter(AP_EMAIL_valido_)
    .filter(function (e, i, arr) { return arr.indexOf(e) === i && destinos.indexOf(e) < 0; });

  if (!destinos.length) {
    return AP_EMAIL_registrar_('SEM_DESTINO', chave, String(para), '', extra.referencia,
      'Nenhum e-mail válido. Confira o cadastro — @almoxa.local não recebe.');
  }

  var modelo = AP_EMAIL_modelo_(chave);
  if (!modelo) {
    return AP_EMAIL_registrar_('SEM_MODELO', chave, destinos.join(', '), '', extra.referencia,
      'Modelo "' + chave + '" não existe na aba ' + AP_EMAIL_ABAS.modelos + '.');
  }

  var sobra = MailApp.getRemainingDailyQuota();
  if (sobra < destinos.length) {
    return AP_EMAIL_registrar_('SEM_QUOTA', chave, destinos.join(', '), '', extra.referencia,
      'Quota do dia esgotada (restam ' + sobra + ').');
  }

  var assunto = AP_EMAIL_preencher_(modelo.assunto, campos);
  var corpo = AP_EMAIL_preencher_(modelo.corpo, campos);

  var enviados = [], falhas = [];
  destinos.forEach(function (e) {
    try {
      MailApp.sendEmail({
        to: e,
        cc: copias.join(','),
        subject: assunto,
        body: corpo,
        htmlBody: AP_EMAIL_html_(corpo, campos),
        name: AP_EMAIL_cfg().sistema,
        attachments: extra.anexos || []
      });
      enviados.push(e);
    } catch (err) {
      falhas.push(e + ': ' + err.message);
    }
  });

  AP_EMAIL_registrar_(falhas.length ? (enviados.length ? 'PARCIAL' : 'ERRO') : 'ENVIADO',
    chave, destinos.join(', '), assunto, extra.referencia, falhas.join(' | '));

  return {
    ok: enviados.length > 0,
    enviados: enviados,
    copias: copias,
    falhas: falhas,
    assunto: assunto
  };
}

/** Manda o pedido de aprovação para quem é responsável pela pessoa. */
function AP_EMAIL_pedirAprovacao(dados) {
  dados = dados || {};
  var aprovadores = AP_EMAIL_aprovadoresDe(dados.matriculaSolicitante, dados.operacao, dados.obra);

  if (!aprovadores.length) {
    return {
      ok: false, codigo: 'SEM_APROVADOR',
      mensagem: 'Ninguém cadastrado como aprovador desta pessoa na aba ' + AP_EMAIL_ABAS.aprovadores + '.'
    };
  }

  var resultados = aprovadores.map(function (a) {
    return AP_EMAIL_enviar('aprovacao', a.email, {
      aprovador: a.nome,
      saudacao: 'Olá, ' + String(a.nome || '').split(' ')[0] + ',',
      solicitante: dados.solicitante || '',
      titulo: dados.titulo || 'Aprovação pendente',
      obra: dados.obra || '',
      quando: AP_EMAIL_agora_(),
      detalhes: dados.detalhes || '',
      link: dados.link || '',
      validade: dados.validade || '',
      selo: 'AGUARDANDO APROVAÇÃO',
      seloNota: 'Sua análise é necessária.',
      rotuloBotao: 'ANALISAR SOLICITAÇÃO',
      tituloFicha: String(dados.tipo || 'SOLICITAÇÃO').toUpperCase(),
      numero: dados.numero || dados.referencia || '',
      ficha: [
        ['Solicitante', dados.solicitante || '—'],
        ['Setor', dados.setor || '—'],
        ['Obra', dados.obra || '—'],
        ['Tipo', dados.tipo || 'Solicitação'],
        ['Valor estimado', dados.total !== undefined ? AP_EMAIL_moeda_(dados.total) : '—'],
        ['Prioridade', dados.prioridade || 'Normal'],
        ['Descrição', dados.detalhes || '—']
      ],
      itens: dados.itens || [],
      total: dados.total
    }, {
      referencia: dados.referencia || '',
      copia: [].concat(dados.copia || []).concat(String(a.copia || '').split(/[;,]/))
    });
  });

  var ok = resultados.filter(function (r) { return r.ok; }).length;
  return {
    ok: ok > 0,
    dados: {
      avisados: ok,
      aprovadores: aprovadores.map(function (a) { return a.nome + ' <' + a.email + '>'; })
    }
  };
}

/**
 * Avisa por e-mail uma transferência entre locais ou departamentos,
 * com os itens discriminados e o valor total.
 * dados: { para, copia, destino, origem, responsavel, obra, protocolo,
 *          motivo, itens:[{sku,descricao,qtd,unidade,valorUnitario}] }
 */
function AP_EMAIL_avisarTransferencia(dados) {
  dados = dados || {};
  var itens = dados.itens || [];
  var total = itens.reduce(function (s, i) {
    return s + (i.total !== undefined ? Number(i.total) : (Number(i.qtd) || 0) * (Number(i.valorUnitario) || 0));
  }, 0);

  var destinos = [].concat(dados.para || []);
  if (!destinos.length) {
    return { ok: false, codigo: 'SEM_DESTINO', mensagem: 'Informe para quem mandar o aviso da transferência.' };
  }

  return AP_EMAIL_enviar('transferencia', destinos, {
    destinatario: dados.destinatario || '',
    saudacao: 'Olá, ' + String(dados.destinatario || '').split(' ')[0] + ',',
    titulo: 'Transferência de material',
    detalhes: 'Os itens abaixo foram transferidos para ' + (dados.destino || 'o seu departamento') + '.' +
      (dados.motivo ? '\n\nMotivo: ' + dados.motivo : ''),
    quando: AP_EMAIL_agora_(),
    selo: 'MATERIAL TRANSFERIDO',
    seloNota: itens.length + ' item(ns)',
    tituloFicha: 'TRANSFERÊNCIA',
    numero: dados.protocolo || '',
    ficha: [
      ['Origem', dados.origem || '—'],
      ['Destino', dados.destino || '—'],
      ['Responsável', dados.responsavel || '—'],
      ['Obra', dados.obra || '—'],
      ['Quando', AP_EMAIL_agora_()],
      ['Valor total', AP_EMAIL_moeda_(total)]
    ],
    itens: itens,
    total: total
  }, { referencia: dados.protocolo || '', copia: dados.copia || [] });
}

/* ============================================================
   PORTA PARA A TELA (sem passar pelo roteador)
   ============================================================ */
function AP_EMAIL_direto(json) {
  var p = {};
  try { p = JSON.parse(json || '{}'); } catch (e) { p = {}; }

  var sessao = null;
  var token = p.token || '';
  if (token) {
    var v = AP_Session_validate(String(token));
    if (v && v.ok) sessao = v.data;
  }
  if (!sessao) return JSON.stringify({ ok: false, codigo: 'SEM_SESSAO', mensagem: 'Faça login de novo.' });

  var r;
  switch (p.acao) {
    case 'aprovadores':
      r = { ok: true, dados: AP_EMAIL_aprovadoresDe(p.matricula, p.operacao, p.obra) };
      break;
    case 'transferencia':
      r = AP_EMAIL_avisarTransferencia(p.payload || {});
      break;
    case 'pedirAprovacao':
      r = AP_EMAIL_pedirAprovacao(p.payload || {});
      break;
    case 'enviar':
      r = AP_EMAIL_enviar(p.chave, p.para, p.campos || {}, { referencia: p.referencia });
      break;
    case 'salvarAprovador':
      r = AP_EMAIL_salvarAprovador(p.payload || {});
      break;
    case 'excluirAprovador':
      r = AP_EMAIL_excluirAprovador(p.id);
      break;
    case 'listarAprovadores':
      r = { ok: true, dados: AP_EMAIL_lerAba_(AP_EMAIL_ABAS.aprovadores) };
      break;
    case 'modelos':
      r = { ok: true, dados: AP_EMAIL_lerAba_(AP_EMAIL_ABAS.modelos) };
      break;
    case 'quota':
      r = { ok: true, dados: { restam: MailApp.getRemainingDailyQuota() } };
      break;
    default:
      r = { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'email.' + p.acao + ' não existe.' };
  }
  return JSON.stringify(r);
}

/** Cria ou atualiza um aprovador. */
function AP_EMAIL_salvarAprovador(d) {
  d = d || {};
  if (!d.aprovador || !d.matriculaAprovador) {
    return { ok: false, codigo: 'CAMPOS_OBRIGATORIOS', mensagem: 'Informe o nome e a matrícula do aprovador.' };
  }
  var email = AP_EMAIL_enderecoDe_(d.emailAprovador, d.matriculaAprovador);
  if (!email) {
    return { ok: false, codigo: 'SEM_EMAIL',
      mensagem: 'Este aprovador não tem e-mail que receba. Preencha o e-mail aqui ou na aba USUARIOS.' };
  }

  var ss = AP_Config_getSpreadsheet_();
  var aba = ss.getSheetByName(AP_EMAIL_ABAS.aprovadores);
  if (!aba) return { ok: false, codigo: 'SEM_ABA', mensagem: 'Rode AP_EMAIL_instalar primeiro.' };

  var cab = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0]
    .map(function (c) { return String(c).trim(); });

  var linha = cab.map(function (c) {
    switch (c) {
      case 'id': return d.id || 'APR-' + new Date().getTime();
      case 'aprovador': return d.aprovador;
      case 'matriculaAprovador': return String(d.matriculaAprovador);
      case 'emailAprovador': return email;
      case 'copia': return String(d.copia || '');
      case 'equipe': return String(d.equipe || '');
      case 'empresa': return d.empresa || '';
      case 'obra': return d.obra || '';
      case 'operacoes': return String(d.operacoes || '');
      case 'valorMaximo': return Number(d.valorMaximo) || 0;
      case 'ativo': return d.ativo === false ? false : true;
      case 'observacao': return d.observacao || '';
      default: return '';
    }
  });

  var iId = cab.indexOf('id');
  if (d.id && aba.getLastRow() > 1) {
    var ids = aba.getRange(2, iId + 1, aba.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(d.id)) {
        aba.getRange(i + 2, 1, 1, linha.length).setValues([linha]);
        return { ok: true, dados: { id: d.id, atualizado: true } };
      }
    }
  }
  aba.appendRow(linha);
  return { ok: true, dados: { id: linha[iId], criado: true } };
}

/** Tira um aprovador da lista. */
function AP_EMAIL_excluirAprovador(id) {
  if (!id) return { ok: false, codigo: 'SEM_ID', mensagem: 'Informe qual aprovador.' };
  var ss = AP_Config_getSpreadsheet_();
  var aba = ss.getSheetByName(AP_EMAIL_ABAS.aprovadores);
  if (!aba || aba.getLastRow() < 2) return { ok: false, codigo: 'NAO_ENCONTRADO', mensagem: 'Nada para excluir.' };
  var cab = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0]
    .map(function (c) { return String(c).trim(); });
  var iId = cab.indexOf('id');
  var ids = aba.getRange(2, iId + 1, aba.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) {
      aba.deleteRow(i + 2);
      return { ok: true, dados: { id: id, excluido: true } };
    }
  }
  return { ok: false, codigo: 'NAO_ENCONTRADO', mensagem: 'Aprovador não encontrado.' };
}

/* ============================================================
   INTERNOS
   ============================================================ */
function AP_EMAIL_lerAba_(nome) {
  var ss = AP_Config_getSpreadsheet_();
  var aba = ss.getSheetByName(nome);
  if (!aba || aba.getLastRow() < 2) return [];
  var dados = aba.getRange(1, 1, aba.getLastRow(), aba.getLastColumn()).getValues();
  var cab = dados.shift().map(function (c) { return String(c).trim(); });
  return dados.map(function (linha) {
    var o = {};
    cab.forEach(function (c, i) { o[c] = linha[i]; });
    return o;
  }).filter(function (o) {
    return Object.keys(o).some(function (k) { return o[k] !== '' && o[k] !== null; });
  });
}

function AP_EMAIL_modelo_(chave) {
  return AP_EMAIL_lerAba_(AP_EMAIL_ABAS.modelos).filter(function (m) {
    return String(m.chave).trim() === String(chave).trim() && String(m.ativo) !== 'false';
  })[0] || null;
}

function AP_EMAIL_preencher_(texto, campos) {
  return String(texto || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, function (todo, chave) {
    var v = campos[chave];
    return (v === undefined || v === null) ? '' : String(v);
  });
}

/** Monta o e-mail no layout da empresa. */
function AP_EMAIL_html_(corpo, campos) {
  var cfg = AP_EMAIL_cfg();
  var esc = AP_EMAIL_escapar_;
  var azul = '#0B2A55', azulClaro = '#1565D8', laranja = '#F08A1C', borda = '#D8E0EA';

  /* o texto do modelo vira os parágrafos de abertura; link e tabela têm lugar próprio */
  var texto = String(corpo || '');
  if (campos.link) texto = texto.split(campos.link).join('');
  var paragrafos = esc(texto).replace(/\n{2,}/g, '</p><p style="margin:0 0 10px">').replace(/\n/g, '<br>');

  var selo = campos.selo ? '<td align="right" style="padding:0 0 0 12px">' +
    '<div style="background:#FFF4E6;border-radius:10px;padding:12px 16px;display:inline-block">' +
    '<div style="color:' + laranja + ';font-weight:800;font-size:13px;letter-spacing:.4px">' + esc(campos.selo) + '</div>' +
    (campos.seloNota ? '<div style="color:#5F6B7A;font-size:12px;margin-top:2px">' + esc(campos.seloNota) + '</div>' : '') +
    '</div></td>' : '';

  var linhasFicha = '';
  if (campos.ficha instanceof Array) {
    campos.ficha.forEach(function (f) {
      if (!f || !f[0]) return;
      linhasFicha += '<tr>' +
        '<td style="padding:7px 0;color:#5F6B7A;font-size:13px;width:42%">' + esc(f[0]) + '</td>' +
        '<td style="padding:7px 0;color:#1B2433;font-size:13px;font-weight:700">' + esc(f[1]) + '</td></tr>';
    });
  }

  var tabelaItens = '';
  if (campos.itens instanceof Array && campos.itens.length) {
    tabelaItens = '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:14px">' +
      '<tr style="background:#EDF1F7">' +
      '<th align="left" style="padding:8px 10px;font-size:11px;letter-spacing:.4px;color:#5F6B7A">ITEM</th>' +
      '<th align="left" style="padding:8px 10px;font-size:11px;letter-spacing:.4px;color:#5F6B7A">CÓDIGO</th>' +
      '<th align="right" style="padding:8px 10px;font-size:11px;letter-spacing:.4px;color:#5F6B7A">QTD</th>' +
      '<th align="right" style="padding:8px 10px;font-size:11px;letter-spacing:.4px;color:#5F6B7A">VALOR UNIT.</th>' +
      '<th align="right" style="padding:8px 10px;font-size:11px;letter-spacing:.4px;color:#5F6B7A">TOTAL</th></tr>';
    campos.itens.forEach(function (i) {
      tabelaItens += '<tr>' +
        '<td style="padding:8px 10px;border-bottom:1px solid #E8EDF3;font-size:13px">' + esc(i.descricao || '') + '</td>' +
        '<td style="padding:8px 10px;border-bottom:1px solid #E8EDF3;font-size:12px;color:#5F6B7A">' + esc(i.sku || '') + '</td>' +
        '<td align="right" style="padding:8px 10px;border-bottom:1px solid #E8EDF3;font-size:13px">' + esc(i.qtd) + ' ' + esc(i.unidade || '') + '</td>' +
        '<td align="right" style="padding:8px 10px;border-bottom:1px solid #E8EDF3;font-size:13px">' + AP_EMAIL_moeda_(i.valorUnitario) + '</td>' +
        '<td align="right" style="padding:8px 10px;border-bottom:1px solid #E8EDF3;font-size:13px;font-weight:700">' + AP_EMAIL_moeda_(i.total !== undefined ? i.total : (Number(i.qtd) || 0) * (Number(i.valorUnitario) || 0)) + '</td></tr>';
    });
    var soma = campos.total !== undefined ? campos.total : campos.itens.reduce(function (s2, i) {
      return s2 + (i.total !== undefined ? Number(i.total) : (Number(i.qtd) || 0) * (Number(i.valorUnitario) || 0));
    }, 0);
    tabelaItens += '<tr><td colspan="4" align="right" style="padding:10px;font-size:13px;font-weight:700">TOTAL</td>' +
      '<td align="right" style="padding:10px;font-size:15px;font-weight:800;color:' + azul + '">' + AP_EMAIL_moeda_(soma) + '</td></tr></table>';
  }

  var botao = campos.link ? '<div style="text-align:center;margin:22px 0 6px">' +
    '<a href="' + esc(campos.link) + '" style="display:inline-block;background:' + azulClaro + ';color:#fff;' +
    'padding:14px 34px;border-radius:10px;text-decoration:none;font-weight:800;font-size:15px;letter-spacing:.3px">' +
    esc(campos.rotuloBotao || 'ANALISAR SOLICITAÇÃO') + '</a>' +
    '<div style="color:#5F6B7A;font-size:12px;margin-top:8px">Acesso seguro' +
    (campos.validade ? ' · o link vale até ' + esc(campos.validade) : '') + '</div></div>' : '';

  return '<div style="background:#F2F5F9;padding:18px 0;font-family:Segoe UI,Arial,sans-serif">' +
    '<table width="620" cellpadding="0" cellspacing="0" align="center" style="max-width:620px;background:#fff;border-radius:12px;overflow:hidden">' +
    /* cabeçalho */
    '<tr><td style="background:' + azul + ';padding:20px 24px">' +
      '<table width="100%"><tr>' +
      '<td>' + (cfg.logo ? '<img src="' + esc(cfg.logo) + '" height="34" alt="" style="vertical-align:middle;margin-right:12px">' : '') +
      '<span style="color:#fff;font-size:22px;font-weight:800;letter-spacing:1px">' + esc(cfg.empresa) + '</span>' +
      '<div style="color:#9FC0F0;font-size:10px;letter-spacing:2px;margin-top:2px">' + esc(cfg.assinatura) + '</div></td>' +
      '<td align="right"><span style="color:#fff;font-size:18px;font-weight:800">' + esc(cfg.sistema) + '</span>' +
      '<div style="color:#9FC0F0;font-size:9px;letter-spacing:1.4px;margin-top:2px">' + esc(cfg.subtitulo) + '</div></td>' +
      '</tr></table></td></tr>' +
    /* saudação e selo */
    '<tr><td style="padding:24px">' +
      '<table width="100%"><tr><td>' +
      '<div style="font-size:21px;font-weight:800;color:' + azul + '">' + esc(campos.saudacao || ('Olá, ' + (campos.aprovador || campos.destinatario || ''))) + '</div>' +
      '<p style="margin:8px 0 0;color:#42505F;font-size:14px;line-height:1.5">' + paragrafos + '</p>' +
      '</td>' + selo + '</tr></table>' +
    /* ficha */
      (linhasFicha ? '<div style="border:1px solid ' + borda + ';border-radius:12px;padding:16px 18px;margin-top:18px">' +
        (campos.numero ? '<div style="font-size:12px;letter-spacing:.6px;color:#5F6B7A">' + esc(campos.tituloFicha || 'REGISTRO') + '</div>' +
          '<div style="font-size:24px;font-weight:800;color:' + azul + ';margin-bottom:10px">' + esc(campos.numero) + '</div>' : '') +
        '<table width="100%" cellpadding="0" cellspacing="0">' + linhasFicha + '</table>' +
        tabelaItens + '</div>' : tabelaItens) +
      botao +
    '</td></tr>' +
    /* rodapé */
    '<tr><td style="background:' + azul + ';padding:16px 24px">' +
      '<span style="color:#fff;font-weight:800;letter-spacing:1px">' + esc(cfg.empresa) + '</span>' +
      '<span style="color:#9FC0F0"> · ' + esc(cfg.sistema) + '</span>' +
      '<div style="color:#9FC0F0;font-size:11px;margin-top:6px">Este e-mail foi enviado automaticamente pelo sistema' +
      (cfg.suporte ? ' · dúvidas: ' + esc(cfg.suporte) : '') + '</div>' +
    '</td></tr></table></div>';
}

function AP_EMAIL_moeda_(v) {
  var n = Number(v) || 0;
  return 'R$ ' + n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function AP_EMAIL_escapar_(t) {
  return String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function AP_EMAIL_registrar_(resultado, tipo, para, assunto, referencia, motivo) {
  try {
    var ss = AP_Config_getSpreadsheet_();
    var aba = ss.getSheetByName(AP_EMAIL_ABAS.log);
    if (aba) {
      aba.appendRow([new Date(), tipo, para, assunto, referencia || '', resultado, motivo || '',
        Session.getActiveUser().getEmail() || 'sistema']);
    }
  } catch (e) {}
  return { ok: resultado === 'ENVIADO', codigo: resultado, mensagem: motivo || '' };
}

function AP_EMAIL_agora_() {
  return Utilities.formatDate(new Date(),
    AP_Config_get('TIMEZONE', 'America/Sao_Paulo'), 'dd/MM/yyyy HH:mm');
}

function AP_EMAIL_norm_(v) {
  var t = String(v === undefined || v === null ? '' : v).trim().toLowerCase();
  if (!t) return '';
  return /^\d+$/.test(t) ? String(Number(t)) : t;
}

/* ============================================================
   TESTES
   ============================================================ */

/** Manda um e-mail de teste para você mesmo. */
function AP_EMAIL_testar() {
  var meu = Session.getActiveUser().getEmail();
  var r = AP_EMAIL_enviar('aviso', meu, {
    destinatario: 'Ismael',
    titulo: 'Teste de envio',
    detalhes: 'Se você está lendo isto, o envio por e-mail está funcionando.\n' +
      'Restam ' + MailApp.getRemainingDailyQuota() + ' e-mails na quota de hoje.'
  }, { referencia: 'teste' });
  Logger.log(JSON.stringify(r, null, 2));
  return r;
}

/** Mostra quem tem e-mail de verdade e quem ainda está com o interno. */
function AP_EMAIL_verEnderecos() {
  var linhas = ['===== E-MAIL DE CADA USUÁRIO ====='];
  (AP_Data_rows(AP_SHEETS.USUARIOS) || []).forEach(function (u) {
    linhas.push((u.nome || '?') + ' | ' + (u.email || '(vazio)') +
      (AP_EMAIL_valido_(u.email) ? '  -> recebe' : '  -> NÃO RECEBE (interno ou inválido)'));
  });
  linhas.push('');
  linhas.push('Quota de hoje: ' + MailApp.getRemainingDailyQuota() + ' e-mails.');
  Logger.log(linhas.join('\n'));
  return linhas.join('\n');
}
