/**
 * ALMOX-PRO — GUARDA DE OPERAÇÕES E DELEGAÇÃO   ·  busca: [GUARDA-GS]
 * V4 — evolução da V3. A V3 continua exatamente como está.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 *
 *   A V3 entregou a regra: quem pode, onde pode, até quanto pode,
 *   e quem aprova o que passa disso. Só que regra que ninguém
 *   chama é regra que não existe — hoje AP_ORG_validarOperacao
 *   está lá e nenhum módulo passa por ele.
 *
 *   A V4 dá o portão: um lugar só por onde as gravações passam.
 *
 *       módulo  →  AP_GUARDA_executar  →  grava
 *                        │
 *                        ├─ nega          (e registra)
 *                        └─ manda aprovar (e diz para quem)
 *
 *   E resolve o que faltava para a aprovação não travar a obra:
 *   o aprovador de férias. Sem substituto, a primeira folga do
 *   encarregado para o almoxarifado inteiro.
 *
 * O QUE A V4 NÃO FAZ, DE PROPÓSITO
 *
 *   NÃO cria fluxo de aprovação. O Core já tem o módulo
 *   "aprovacoes" (pendentes, decidir, porPerfil, decidirItens), e
 *   é ele que guarda as pendências. A V4 monta o pedido no
 *   formato dele e entrega — não abre uma segunda caixa de
 *   pendências, que seria o jeito mais rápido de metade das
 *   aprovações sumir.
 *
 *   NÃO refaz organograma, escopo, permissão nem alçada: pergunta
 *   à V3 e ao módulo de permissões.
 *
 *   NÃO grava nada sozinha. Quem grava é o módulo que chamou — a
 *   V4 só deixa passar, ou não. Guarda que também mexe no estoque
 *   vira parte do problema que deveria vigiar.
 *
 *   NÃO mexe na chave do aplicativo: é etapa própria, depois.
 *
 * ABA QUE CRIA (e só esta)
 *   ALMOXA_DELEGACOES   quem responde por quem, e até quando
 *
 * INSTALAÇÃO
 *   1. Cole num arquivo novo do Apps Script.
 *   2. Rode AP_GUARDA_instalar.
 *   3. Publique nova versão.
 *
 * DEPENDE DE
 *   V3  ALMOX_PRO_Modulo_Organograma.gs   (escopo, limite, rota)
 *   V2  ALMOX_PRO_Modulo_Permissoes.gs    (perfil, ação, alçada)
 *   Core  módulo "aprovacoes"             (opcional: sem ele, a
 *         V4 devolve o pedido montado em vez de abrir a pendência)
 *
 * ONDE PROCURAR ERRO
 *   SEM_V3            a V3 não está no projeto
 *   NEGADO            a operação foi barrada — o motivo vem junto
 *   PRECISA_APROVACAO não é erro: é o caminho normal acima do limite
 *   GRAVACAO_FALHOU   o módulo que grava levantou erro
 *   NAO_GRAVOU        o módulo disse que não gravou
 *   DELEGACAO_CIRCULAR  A responde por B que responde por A
 *   OCUPADO           outra gravação igual está acontecendo agora
 *
 * Todos os nomes começam com AGRD_ ou AP_GUARDA_.
 */

var AGRD_ABAS = { delegacoes: 'ALMOXA_DELEGACOES' };

var AGRD_COLUNAS = {
  delegacoes: ['id', 'deQuem', 'paraQuem', 'motivo', 'empresa', 'obra',
               'setor', 'modulo', 'inicio', 'fim', 'ativo',
               'observacao', 'criadoEm', 'criadoPor']
};

/** Quantos saltos de substituição o sistema aceita seguir.
    Três é folga: A sai, B sai, C responde. Mais que isso já é
    sinal de que ninguém está na obra. */
var AGRD_MAXIMO_DE_SALTOS = 3;

/** Depois de quantas horas uma pendência pode subir de nível. */
var AGRD_HORAS_PARA_ESCALAR = 24;


/* ============================================================
   1. INFRAESTRUTURA — emprestada da V3, não reescrita
   ------------------------------------------------------------
   Abrir planilha, ler linha e formatar data já existem na V3 e
   funcionam. Copiar isso para cá criaria duas versões da mesma
   coisa, que é como um dia elas passam a discordar.
   ============================================================ */

function AGRD_temV3_() {
  return typeof AP_ORG_validarOperacao === 'function'
    && typeof AORG_linhas_ === 'function';
}

function AGRD_exigirV3_() {
  if (AGRD_temV3_()) return null;
  return AGRD_erro_('SEM_V3',
    'O módulo de organograma (V3) não está no projeto. A guarda depende dele ' +
    'para saber escopo, limite e rota de aprovação.');
}

function AGRD_texto_(v) { return String(v === undefined || v === null ? '' : v).trim(); }

function AGRD_sim_(v) {
  var t = AGRD_texto_(v).toLowerCase();
  return t === 'sim' || t === 'true' || t === '1' || t === 'x' || t === 's' || v === true;
}

function AGRD_agora_() {
  if (typeof AORG_agora_ === 'function') return AORG_agora_();
  var fuso = 'America/Manaus';
  try { fuso = Session.getScriptTimeZone() || fuso; } catch (e) { }
  return Utilities.formatDate(new Date(), fuso, 'yyyy-MM-dd HH:mm:ss');
}

function AGRD_hoje_() { return AGRD_agora_().substring(0, 10); }

function AGRD_id_(p) {
  if (typeof AORG_id_ === 'function') return AORG_id_(p);
  return (p || 'ID') + '-' + new Date().getTime().toString(36).toUpperCase();
}

function AGRD_quemSou_() {
  try { return Session.getActiveUser().getEmail() || 'sistema'; } catch (e) { return 'sistema'; }
}

function AGRD_ok_(dados, mensagem) {
  return { ok: true, codigo: 'OK', mensagem: mensagem || '', dados: dados === undefined ? null : dados };
}

function AGRD_erro_(codigo, mensagem, extra) {
  var r = { ok: false, codigo: codigo, mensagem: mensagem, dados: null };
  if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) r[k] = extra[k];
  return r;
}

/* ------------------------------------------------------------
   A ABA DE DELEGAÇÕES É CUIDADA AQUI, NÃO LÁ

   A primeira versão deste arquivo registrava a aba no mapa da V3
   para aproveitar o leitor dela. Funcionava — e mudava a V3 de
   lugar: AP_ORG_instalar passava a criar sete abas em vez de
   seis, e o teste da V3 acusava. Um módulo novo que altera o
   comportamento do módulo antigo é exatamente o que não pode
   acontecer numa evolução incremental.

   Então a V4 abre a própria aba. Ela reaproveita da V3 só o que
   é infraestrutura pura — qual é a planilha do sistema — e não
   reimplementa nenhuma regra.
   ------------------------------------------------------------ */
function AGRD_planilha_() {
  if (typeof AORG_planilha_ === 'function') return AORG_planilha_();
  try { return SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { return null; }
}

function AGRD_aba_(criarSeFaltar) {
  var pl = AGRD_planilha_();
  if (!pl) return null;
  var nome = AGRD_ABAS.delegacoes;
  var aba = pl.getSheetByName(nome);
  if (!aba && criarSeFaltar) {
    aba = pl.insertSheet(nome);
    var colunas = AGRD_COLUNAS.delegacoes;
    aba.getRange(1, 1, 1, colunas.length).setValues([colunas]);
    try {
      aba.getRange(1, 1, 1, colunas.length).setFontWeight('bold');
      aba.setFrozenRows(1);
    } catch (e) { }
  }
  return aba || null;
}

/** Coluna que falta entra no fim; coluna que existe não se mexe. */
function AGRD_garantirAba_() {
  var aba = AGRD_aba_(true);
  if (!aba) return { ok: false, acrescentadas: [] };

  var esperadas = AGRD_COLUNAS.delegacoes;
  var largura = aba.getLastColumn();
  var atuais = largura > 0
    ? aba.getRange(1, 1, 1, largura).getValues()[0].map(AGRD_texto_) : [];
  while (atuais.length && atuais[atuais.length - 1] === '') atuais.pop();

  if (!atuais.length) {
    aba.getRange(1, 1, 1, esperadas.length).setValues([esperadas]);
    return { ok: true, acrescentadas: esperadas.slice() };
  }
  var faltando = esperadas.filter(function (c) { return atuais.indexOf(c) === -1; });
  if (faltando.length) {
    aba.getRange(1, atuais.length + 1, 1, faltando.length).setValues([faltando]);
  }
  return { ok: true, acrescentadas: faltando };
}

function AGRD_linhasDaAba_() {
  var aba = AGRD_aba_(false);
  if (!aba) return null;
  if (aba.getLastRow() < 2) return [];
  var largura = aba.getLastColumn();
  var tudo = aba.getRange(1, 1, aba.getLastRow(), largura).getValues();
  var cabecalho = tudo[0].map(AGRD_texto_);
  var saida = [];
  for (var i = 1; i < tudo.length; i++) {
    var vazia = true, o = { __linha: i + 1 };
    for (var c = 0; c < cabecalho.length; c++) {
      if (!cabecalho[c]) continue;
      o[cabecalho[c]] = tudo[i][c];
      if (AGRD_texto_(tudo[i][c]) !== '') vazia = false;
    }
    if (!vazia) saida.push(o);
  }
  return saida;
}

function AGRD_escreverLinha_(registro) {
  var aba = AGRD_aba_(true);
  if (!aba) return null;
  var cabecalho = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0].map(AGRD_texto_);
  aba.appendRow(cabecalho.map(function (c) {
    return registro[c] === undefined || registro[c] === null ? '' : registro[c];
  }));
  return registro;
}

function AGRD_atualizarLinha_(id, mudancas) {
  var aba = AGRD_aba_(false);
  if (!aba) return null;
  var linhas = AGRD_linhasDaAba_();
  if (!linhas) return null;
  var alvo = linhas.filter(function (x) { return AGRD_texto_(x.id) === AGRD_texto_(id); })[0];
  if (!alvo) return null;

  var cabecalho = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0].map(AGRD_texto_);
  var atual = aba.getRange(alvo.__linha, 1, 1, cabecalho.length).getValues()[0];
  for (var campo in mudancas) {
    if (!mudancas.hasOwnProperty(campo)) continue;
    var i = cabecalho.indexOf(campo);
    if (i > -1) atual[i] = mudancas[campo];
  }
  aba.getRange(alvo.__linha, 1, 1, cabecalho.length).setValues([atual]);
  return true;
}


/* ============================================================
   2. INSTALAÇÃO
   ============================================================ */

function AP_GUARDA_instalar() {
  var falta = AGRD_exigirV3_();
  if (falta) return falta;
  var r = AGRD_garantirAba_();
  if (!r.ok) {
    return AGRD_erro_('SEM_PLANILHA', 'Não achei a planilha do sistema.');
  }

  var temPermissoes = (typeof AP_PERMISSOES_verificar === 'function');
  var temAprovacoes = (typeof AP_Modulo_aprovacoes === 'function');

  return AGRD_ok_({
    aba: AGRD_ABAS.delegacoes,
    colunasAcrescentadas: r.acrescentadas,
    v3: 'presente',
    permissoes: temPermissoes ? 'presente' : 'AUSENTE',
    aprovacoes: temAprovacoes ? 'presente' : 'ausente (a guarda devolve o pedido montado)'
  }, 'Guarda instalada. Ela não bloqueia nada sozinha: só bloqueia o que a V3 mandar bloquear, ' +
     'e a V3 está em modo ' + (typeof AORG_modo_ === 'function' ? AORG_modo_() : '?') + '.');
}


/* ============================================================
   3. DELEGAÇÃO — quem responde quando o aprovador não está
   ------------------------------------------------------------
   Regras que valem aqui:

   · delegação tem começo e fim. Delegação sem prazo é um cargo
     paralelo que ninguém lembra de desfazer;
   · ninguém delega para si mesmo;
   · corrente circular é recusada: A responde por B que responde
     por A deixaria a aprovação girando sem sair do lugar;
   · a delegação pode ser limitada a uma obra, setor ou módulo —
     dar procuração geral para cobrir uma semana de férias é dar
     mais do que se quis dar.
   ============================================================ */

function AGRD_delegacaoPublica_(d) {
  return {
    id: AGRD_texto_(d.id), deQuem: AGRD_texto_(d.deQuem), paraQuem: AGRD_texto_(d.paraQuem),
    motivo: AGRD_texto_(d.motivo), empresa: AGRD_texto_(d.empresa), obra: AGRD_texto_(d.obra),
    setor: AGRD_texto_(d.setor), modulo: AGRD_texto_(d.modulo),
    inicio: AGRD_texto_(d.inicio), fim: AGRD_texto_(d.fim),
    ativo: AGRD_sim_(d.ativo), observacao: AGRD_texto_(d.observacao)
  };
}

function AGRD_delegacoes_() {
  var linhas = AGRD_linhasDaAba_();
  if (linhas === null) return null;
  return linhas.map(AGRD_delegacaoPublica_);
}

/** Vale hoje, e vale para ESTE contexto? */
function AGRD_delegacaoVale_(d, contexto) {
  if (!d.ativo) return false;
  var hoje = AGRD_hoje_();
  if (d.inicio && d.inicio > hoje) return false;
  if (d.fim && d.fim < hoje) return false;

  contexto = contexto || {};
  if (d.empresa && contexto.empresa && d.empresa !== contexto.empresa) return false;
  if (d.obra && contexto.obra && d.obra !== contexto.obra) return false;
  if (d.setor && contexto.setor && d.setor !== contexto.setor) return false;
  if (d.modulo && contexto.modulo && d.modulo !== contexto.modulo) return false;

  /* delegação amarrada a uma obra não cobre pedido que não diz de
     que obra é: na dúvida, quem responde é o titular */
  if (d.obra && !contexto.obra) return false;
  if (d.modulo && !contexto.modulo) return false;
  return true;
}

/**
 * Quem responde por esta pessoa agora.
 * Segue a corrente — o substituto do substituto — e para ao
 * primeiro sinal de círculo.
 */
function AP_GUARDA_quemResponde(usuario, contexto) {
  var todas = AGRD_delegacoes_();
  if (todas === null) {
    return { ok: true, usuario: usuario, delegado: false, motivo: 'sem aba de delegações' };
  }

  var atual = AGRD_texto_(usuario);
  var caminho = [atual];
  var porQue = [];

  for (var salto = 0; salto < AGRD_MAXIMO_DE_SALTOS; salto++) {
    var achou = null;
    for (var i = 0; i < todas.length; i++) {
      var d = todas[i];
      if (AGRD_texto_(d.deQuem) !== atual) continue;
      if (!AGRD_delegacaoVale_(d, contexto)) continue;
      achou = d;
      break;
    }
    if (!achou) break;

    var proximo = AGRD_texto_(achou.paraQuem);
    if (caminho.indexOf(proximo) > -1) {
      return {
        ok: false, codigo: 'DELEGACAO_CIRCULAR', usuario: usuario, delegado: false,
        motivo: 'As delegações estão em círculo (' + caminho.concat(proximo).join(' → ') +
          '). Enquanto isso, quem responde é o titular.'
      };
    }
    caminho.push(proximo);
    porQue.push(atual + ' → ' + proximo + (achou.motivo ? ' (' + achou.motivo + ')' : ''));
    atual = proximo;
  }

  return {
    ok: true,
    usuario: atual,
    titular: AGRD_texto_(usuario),
    delegado: atual !== AGRD_texto_(usuario),
    caminho: porQue,
    motivo: porQue.length ? porQue.join('; ') : ''
  };
}

function AGRD_delegar_(p, quem) {
  p = p || {};
  var de = AGRD_texto_(p.deQuem);
  var para = AGRD_texto_(p.paraQuem);
  var inicio = AGRD_texto_(p.inicio);
  var fim = AGRD_texto_(p.fim);

  if (!de || !para) return AGRD_erro_('FALTA_GENTE', 'Diga quem sai e quem responde no lugar.');
  if (de === para) {
    return AGRD_erro_('MESMA_PESSOA', 'Ninguém delega para si mesmo.');
  }
  if (!inicio || !fim) {
    return AGRD_erro_('FALTA_PRAZO',
      'Delegação precisa de começo e fim. Sem prazo, ela vira um cargo paralelo ' +
      'que ninguém lembra de desfazer.');
  }
  if (fim < inicio) {
    return AGRD_erro_('PRAZO_INVERTIDO', 'O fim não pode ser antes do começo.');
  }

  var todas = AGRD_delegacoes_();
  if (todas === null) return AGRD_erro_('SEM_ABA', 'Rode AP_GUARDA_instalar no Apps Script.');

  /* o círculo é conferido ANTES de gravar: depois de gravado, a
     primeira aprovação já sai girando */
  var contexto = { empresa: AGRD_texto_(p.empresa), obra: AGRD_texto_(p.obra),
                   setor: AGRD_texto_(p.setor), modulo: AGRD_texto_(p.modulo) };
  var simulada = { deQuem: de, paraQuem: para, ativo: true, inicio: inicio, fim: fim,
                   empresa: contexto.empresa, obra: contexto.obra,
                   setor: contexto.setor, modulo: contexto.modulo };
  var comASimulada = todas.concat([AGRD_delegacaoPublica_(simulada)]);

  var atual = para, caminho = [de, para];
  for (var s = 0; s < AGRD_MAXIMO_DE_SALTOS; s++) {
    var prox = null;
    for (var i = 0; i < comASimulada.length; i++) {
      if (AGRD_texto_(comASimulada[i].deQuem) === atual &&
          AGRD_delegacaoVale_(comASimulada[i], contexto)) { prox = AGRD_texto_(comASimulada[i].paraQuem); break; }
    }
    if (!prox) break;
    if (caminho.indexOf(prox) > -1) {
      return AGRD_erro_('DELEGACAO_CIRCULAR',
        'Isso fecharia um círculo: ' + caminho.concat(prox).join(' → ') +
        '. A aprovação ficaria girando sem chegar em ninguém.');
    }
    caminho.push(prox);
    atual = prox;
  }

  var jaTem = todas.filter(function (d) {
    return d.ativo && AGRD_texto_(d.deQuem) === de &&
      !(d.fim && d.fim < inicio) && !(d.inicio && d.inicio > fim) &&
      AGRD_texto_(d.obra) === contexto.obra && AGRD_texto_(d.modulo) === contexto.modulo;
  });
  if (jaTem.length) {
    return AGRD_erro_('PERIODO_SOBREPOSTO',
      de + ' já tem quem responda por ele nesse período (' +
      jaTem[0].inicio + ' a ' + jaTem[0].fim + ', para ' + jaTem[0].paraQuem + '). ' +
      'Duas procurações valendo ao mesmo tempo é decisão indo para dois lugares.');
  }

  var id = AGRD_id_('DEL');
  AGRD_escreverLinha_({
    id: id, deQuem: de, paraQuem: para, motivo: AGRD_texto_(p.motivo),
    empresa: contexto.empresa, obra: contexto.obra, setor: contexto.setor,
    modulo: contexto.modulo, inicio: inicio, fim: fim, ativo: 'Sim',
    observacao: AGRD_texto_(p.observacao),
    criadoEm: AGRD_agora_(), criadoPor: quem || AGRD_quemSou_()
  });

  if (typeof AORG_auditar_ === 'function') {
    AORG_auditar_({
      usuario: quem || AGRD_quemSou_(), operacao: 'delegar', modulo: 'guarda',
      registro: id, resultado: 'AUTORIZADO',
      motivo: de + ' → ' + para + ' de ' + inicio + ' a ' + fim, status: 'LIBERADO',
      origem: 'backend', obra: contexto.obra, setor: contexto.setor, empresa: contexto.empresa
    });
  }

  return AGRD_ok_({ id: id, deQuem: de, paraQuem: para, inicio: inicio, fim: fim },
    'Delegação criada. Ela se desfaz sozinha em ' + fim + '.');
}

function AGRD_encerrarDelegacao_(p) {
  p = p || {};
  var id = AGRD_texto_(p.id);
  if (!id) return AGRD_erro_('FALTA_ID', 'Diga qual delegação encerrar.');
  var ok = AGRD_atualizarLinha_(id, { ativo: 'Nao', fim: AGRD_hoje_() });
  if (!ok) return AGRD_erro_('NAO_ENCONTRADO', 'Não achei a delegação ' + id + '.');
  return AGRD_ok_({ id: id }, 'Encerrada hoje. A linha fica no histórico.');
}

function AGRD_listarDelegacoes_(p) {
  p = p || {};
  var todas = AGRD_delegacoes_();
  if (todas === null) return AGRD_erro_('SEM_ABA', 'Rode AP_GUARDA_instalar no Apps Script.');
  var hoje = AGRD_hoje_();
  var saida = todas.filter(function (d) {
    if (p.deQuem && d.deQuem !== AGRD_texto_(p.deQuem)) return false;
    if (p.somenteValendo) {
      if (!d.ativo) return false;
      if (d.inicio && d.inicio > hoje) return false;
      if (d.fim && d.fim < hoje) return false;
    } else if (!p.incluirEncerradas && !d.ativo) return false;
    return true;
  });
  return AGRD_ok_(saida);
}


/* ============================================================
   4. A ROTA, COM SUBSTITUTO APLICADO
   ------------------------------------------------------------
   A V3 decide QUEM aprova pela regra e pelo organograma. Aqui só
   se pergunta, para cada nome que ela devolveu: essa pessoa está?
   Se não estiver, quem responde por ela.

   A ordem importa e é esta de propósito: primeiro a regra, depois
   a ausência. Deixar a delegação escolher o aprovador antes da
   regra seria deixar a procuração mudar a alçada.
   ============================================================ */

function AP_GUARDA_aprovadorPara(pedido) {
  var falta = AGRD_exigirV3_();
  if (falta) return falta;
  pedido = pedido || {};

  var rota = AP_ORG_aprovadorPara(pedido);
  if (!rota.ok) return rota;

  var contexto = {
    empresa: AGRD_texto_(pedido.empresa), obra: AGRD_texto_(pedido.obra),
    setor: AGRD_texto_(pedido.setor), modulo: AGRD_texto_(pedido.modulo)
  };

  var avisos = [];
  var comSubstituto = rota.dados.aprovadores.map(function (a) {
    var resposta = AP_GUARDA_quemResponde(a.usuario, contexto);
    if (!resposta.ok) {
      avisos.push(resposta.motivo);
      return a;   /* círculo: fica o titular, e o aviso sobe junto */
    }
    if (!resposta.delegado) return a;

    var copia = {};
    for (var k in a) if (a.hasOwnProperty(k)) copia[k] = a[k];
    copia.usuario = resposta.usuario;
    copia.titular = a.usuario;
    copia.porDelegacao = resposta.motivo;
    return copia;
  });

  rota.dados.aprovadores = comSubstituto;
  rota.dados.houveDelegacao = comSubstituto.some(function (a) { return !!a.titular; });
  if (avisos.length) rota.dados.avisos = avisos;
  return rota;
}


/* ============================================================
   5. O PORTÃO
   ------------------------------------------------------------
   É a única função que os módulos precisam conhecer.

       AP_GUARDA_executar(pedido, function () {
         ... aqui o módulo grava ...
         return { ok: true, id: 'NF-123' };
       });

   O que acontece, nesta ordem:

     1. a V3 valida — identidade, sessão, permissão, escopo, limite;
     2. negado          → não grava, devolve o motivo, registra;
     3. precisa aprovar → NÃO grava, devolve para quem vai;
     4. liberado        → roda a função do módulo;
     5. o que a função devolveu é o que vira resultado: se ela
        disser que não gravou, a guarda não diz que gravou.

   O passo 5 parece óbvio e não é: sistema que registra "sucesso"
   porque chegou até o fim da função, sem olhar o retorno, é
   sistema que mostra estoque que não existe.
   ============================================================ */

function AP_GUARDA_executar(pedido, aoLiberar) {
  var falta = AGRD_exigirV3_();
  if (falta) return falta;
  pedido = pedido || {};

  /* ---- 1. a regra, que é da V3 ---- */
  var veredito = AP_ORG_validarOperacao(pedido);

  if (!veredito.ok) {
    return AGRD_erro_(veredito.codigo || 'NEGADO', veredito.mensagem,
      { gravou: false, passouPelaGuarda: true });
  }

  /* ---- 2. acima do limite: não grava, encaminha ---- */
  if (veredito.dados.precisaAprovacao) {
    var rota = AP_GUARDA_aprovadorPara({
      valor: pedido.valor, categoria: pedido.categoria, modulo: pedido.modulo,
      empresa: pedido.empresa, obra: pedido.obra, setor: pedido.setor
    });
    if (!rota.ok) {
      return AGRD_erro_(rota.codigo,
        'Esta operação precisa de aprovação e não há para quem mandar: ' + rota.mensagem,
        { gravou: false });
    }

    var pendencia = AGRD_montarPendencia_(pedido, rota.dados);
    var abriu = AGRD_abrirPendencia_(pendencia);

    return {
      ok: true, codigo: 'PRECISA_APROVACAO', gravou: false,
      mensagem: 'Nada foi gravado ainda: esta operação passa do limite e foi ' +
        'encaminhada para aprovação de ' +
        rota.dados.aprovadores.map(function (a) { return a.usuario; }).join(', ') + '.',
      dados: {
        pendencia: pendencia,
        aprovadores: rota.dados.aprovadores,
        regra: rota.dados.regra,
        faixa: rota.dados.faixa,
        houveDelegacao: rota.dados.houveDelegacao,
        avisos: rota.dados.avisos || [],
        registradaNoCore: abriu.registrada,
        detalheDoCore: abriu.detalhe
      }
    };
  }

  /* ---- 3. liberado: o módulo grava, sob trava ---- */
  if (typeof aoLiberar !== 'function') {
    return AGRD_ok_({ autorizado: true, gravou: false, vinculo: veredito.dados.vinculo },
      'Autorizado. Nenhuma gravação foi pedida à guarda.');
  }

  var trava = null;
  try {
    trava = LockService.getScriptLock();
    if (!trava.tryLock(20000)) {
      return AGRD_erro_('OCUPADO',
        'O sistema está gravando outra coisa agora. Tente de novo em instantes.',
        { gravou: false });
    }
  } catch (e) { trava = null; }

  var resultado, erro = null;
  try {
    resultado = aoLiberar(veredito.dados);
  } catch (explodiu) {
    erro = (explodiu && explodiu.message) || String(explodiu);
  } finally {
    if (trava) { try { trava.releaseLock(); } catch (e2) { } }
  }

  if (erro) {
    AGRD_auditarResultado_(pedido, 'ERRO', erro, false);
    return AGRD_erro_('GRAVACAO_FALHOU',
      'A operação estava autorizada, mas a gravação falhou: ' + erro, { gravou: false });
  }

  /* o que o módulo devolveu manda no que a guarda diz */
  var gravou = !(resultado && resultado.ok === false);
  if (resultado === undefined || resultado === null) gravou = true;

  if (!gravou) {
    AGRD_auditarResultado_(pedido, 'NAO_GRAVOU',
      (resultado && resultado.mensagem) || 'o módulo recusou', false);
    return AGRD_erro_('NAO_GRAVOU',
      (resultado && resultado.mensagem) || 'O módulo não gravou e não disse por quê.',
      { gravou: false, doModulo: resultado });
  }

  AGRD_auditarResultado_(pedido, 'GRAVADO',
    (resultado && (resultado.id || resultado.registro)) || '', true);

  return AGRD_ok_({
    autorizado: true, gravou: true, precisaAprovacao: false,
    vinculo: veredito.dados.vinculo, doModulo: resultado
  }, 'Autorizado e gravado.');
}

function AGRD_auditarResultado_(pedido, resultado, motivo, gravou) {
  if (typeof AORG_auditar_ !== 'function') return;
  AORG_auditar_({
    usuario: AGRD_texto_(pedido.usuario), sessao: AGRD_texto_(pedido.sessao),
    empresa: AGRD_texto_(pedido.empresa), obra: AGRD_texto_(pedido.obra),
    setor: AGRD_texto_(pedido.setor),
    operacao: AGRD_texto_(pedido.acao) + ' (gravação)',
    modulo: AGRD_texto_(pedido.modulo),
    registro: AGRD_texto_(pedido.registro) || AGRD_texto_(motivo),
    valor: Number(pedido.valor) || 0,
    resultado: resultado, motivo: AGRD_texto_(motivo),
    status: gravou ? 'GRAVADO' : 'NAO_GRAVOU',
    origem: AGRD_texto_(pedido.origem) || 'guarda'
  });
}


/* ============================================================
   6. A PENDÊNCIA VAI PARA O MÓDULO QUE JÁ EXISTE
   ------------------------------------------------------------
   O Core já tem "aprovacoes". A guarda monta o pedido e entrega
   a ele. Se ele não estiver no projeto, a guarda devolve o pedido
   montado e diz que não registrou — o que ela não faz é abrir uma
   segunda caixa de pendências e deixar metade das aprovações
   dormindo num lugar que ninguém abre.
   ============================================================ */

function AGRD_montarPendencia_(pedido, rota) {
  return {
    origemModulo: AGRD_texto_(pedido.modulo),
    operacao: AGRD_texto_(pedido.acao),
    registro: AGRD_texto_(pedido.registro),
    descricao: AGRD_texto_(pedido.descricao) ||
      (AGRD_texto_(pedido.acao) + ' em ' + AGRD_texto_(pedido.modulo)),
    solicitante: AGRD_texto_(pedido.usuario),
    empresa: AGRD_texto_(pedido.empresa),
    obra: AGRD_texto_(pedido.obra),
    setor: AGRD_texto_(pedido.setor),
    valor: Number(pedido.valor) || 0,
    categoria: AGRD_texto_(pedido.categoria),
    regra: rota.regra,
    faixa: rota.faixa,
    aprovadores: rota.aprovadores.map(function (a) { return a.usuario; }),
    aprovadoresDetalhe: rota.aprovadores,
    criadaEm: AGRD_agora_(),
    prazoHoras: AGRD_HORAS_PARA_ESCALAR,
    payload: pedido.payload || null
  };
}

function AGRD_abrirPendencia_(pendencia) {
  if (typeof AP_Modulo_aprovacoes !== 'function') {
    return {
      registrada: false,
      detalhe: 'O módulo "aprovacoes" não está neste projeto. O pedido vai montado ' +
        'na resposta: quem chamou decide onde guardar.'
    };
  }
  try {
    var r = AP_Modulo_aprovacoes({ acao: 'criar', payload: pendencia });
    if (r && r.ok === false) {
      return { registrada: false, detalhe: 'O módulo de aprovações recusou: ' + (r.mensagem || r.codigo) };
    }
    return { registrada: true, detalhe: (r && r.dados) || '' };
  } catch (e) {
    /* não derruba a operação: o pedido volta montado e o problema
       fica visível, em vez de a aprovação sumir em silêncio */
    return { registrada: false, detalhe: 'Erro ao falar com o módulo de aprovações: ' +
      ((e && e.message) || e) };
  }
}


/* ============================================================
   7. ESCALONAMENTO — pendência parada não é decisão
   ------------------------------------------------------------
   Passado o prazo, a guarda diz PARA QUEM subir. Ela não sobe
   sozinha, e não decide nada: quem decide é quem tem a pendência
   na mão. Sistema que aprova sozinho porque o prazo venceu é
   sistema que aprova o que ninguém leu.
   ============================================================ */

function AP_GUARDA_escalonar(p) {
  var falta = AGRD_exigirV3_();
  if (falta) return falta;
  p = p || {};

  var criadaEm = AGRD_texto_(p.criadaEm);
  if (!criadaEm) return AGRD_erro_('FALTA_DATA', 'Diga quando a pendência foi criada.');

  var horas = AGRD_horasDesde_(criadaEm);
  var prazo = Number(p.prazoHoras) || AGRD_HORAS_PARA_ESCALAR;

  if (horas < prazo) {
    return AGRD_ok_({
      escalar: false, horasParadas: horas, prazoHoras: prazo,
      faltamHoras: Math.max(0, Math.round((prazo - horas) * 10) / 10)
    }, 'Ainda dentro do prazo.');
  }

  /* sobe um degrau: o mesmo roteamento, mas ignorando quem já
     está com ela na mão */
  var jaTem = (p.aprovadores || []).map(AGRD_texto_);
  var rota = AP_GUARDA_aprovadorPara({
    valor: p.valor, categoria: p.categoria, modulo: p.modulo,
    empresa: p.empresa, obra: p.obra, setor: p.setor
  });
  if (!rota.ok) {
    return AGRD_erro_(rota.codigo,
      'A pendência está parada há ' + horas + 'h e não há para quem subir: ' + rota.mensagem);
  }

  var acima = rota.dados.aprovadores.filter(function (a) {
    return jaTem.indexOf(AGRD_texto_(a.usuario)) === -1;
  });

  if (!acima.length) {
    return AGRD_ok_({
      escalar: false, horasParadas: horas, semNinguemAcima: true,
      aprovadoresAtuais: jaTem
    }, 'Parada há ' + horas + 'h, mas não existe ninguém acima de quem já está com ela. ' +
       'Cobre a pessoa, ou ajuste a regra.');
  }

  return AGRD_ok_({
    escalar: true, horasParadas: horas, prazoHoras: prazo,
    de: jaTem, para: acima,
    sugestao: 'Mandar também para ' + acima.map(function (a) { return a.usuario; }).join(', ')
  }, 'Parada há ' + horas + 'h. Dá para subir um degrau.');
}

function AGRD_horasDesde_(quando) {
  try {
    var texto = AGRD_texto_(quando).replace(' ', 'T');
    var d = new Date(texto);
    if (isNaN(d.getTime())) return 0;
    return Math.round(((new Date().getTime() - d.getTime()) / 3600000) * 10) / 10;
  } catch (e) { return 0; }
}


/* ============================================================
   8. O RAIO-X — o que a guarda faria com este pedido
   ------------------------------------------------------------
   Serve para conferir a configuração sem gravar nada e sem
   precisar de alguém para ser cobaia.
   ============================================================ */

function AP_GUARDA_simular(pedido) {
  var falta = AGRD_exigirV3_();
  if (falta) return falta;
  pedido = pedido || {};

  var passos = [];
  var veredito = AP_ORG_validarOperacao(pedido);

  passos.push({ passo: 'identidade e sessão', resultado: veredito.codigo === 'SEM_USUARIO' ||
    veredito.codigo === 'SEM_SESSAO' ? 'PAROU AQUI' : 'ok' });
  passos.push({ passo: 'permissão do perfil',
    resultado: veredito.codigo === 'SEM_PERMISSAO' ? 'PAROU AQUI' : 'ok' });
  passos.push({ passo: 'escopo (empresa/obra/setor)',
    resultado: veredito.codigo === 'FORA_DO_ESCOPO' || veredito.codigo === 'SEM_VINCULO'
      ? 'PAROU AQUI' : (veredito.ok && veredito.dados.escopo === 'fora (sombra)'
        ? 'fora, mas passou (modo sombra)' : 'ok') });

  if (!veredito.ok) {
    return AGRD_ok_({
      vaiPassar: false, motivo: veredito.mensagem, codigo: veredito.codigo,
      passos: passos, gravaria: false
    }, 'Este pedido seria BARRADO.');
  }

  passos.push({ passo: 'limite',
    resultado: veredito.dados.precisaAprovacao
      ? 'acima do limite: vai para aprovação' : 'dentro do limite' });

  var rota = null;
  if (veredito.dados.precisaAprovacao) {
    rota = AP_GUARDA_aprovadorPara({
      valor: pedido.valor, categoria: pedido.categoria, modulo: pedido.modulo,
      empresa: pedido.empresa, obra: pedido.obra, setor: pedido.setor
    });
    passos.push({ passo: 'quem aprova',
      resultado: rota.ok
        ? rota.dados.aprovadores.map(function (a) {
            return a.usuario + (a.titular ? ' (no lugar de ' + a.titular + ')' : '');
          }).join(', ')
        : 'NINGUÉM — ' + rota.mensagem });
  }

  return AGRD_ok_({
    vaiPassar: true,
    gravaria: !veredito.dados.precisaAprovacao,
    precisaAprovacao: veredito.dados.precisaAprovacao,
    limite: veredito.dados.limite,
    aprovadores: rota && rota.ok ? rota.dados.aprovadores : [],
    passos: passos
  }, veredito.dados.precisaAprovacao
      ? 'Passaria, mas iria para aprovação antes de gravar.'
      : 'Passaria e gravaria.');
}


/* ============================================================
   9. AS PORTAS
   ============================================================ */

function AGRD_atender_(acao, payload, quem) {
  payload = payload || {};
  switch (String(acao || '')) {
    case 'delegar':            return AGRD_delegar_(payload, quem);
    case 'encerrarDelegacao':  return AGRD_encerrarDelegacao_(payload);
    case 'delegacoes':         return AGRD_listarDelegacoes_(payload);
    case 'quemResponde':       return AGRD_ok_(AP_GUARDA_quemResponde(payload.usuario, payload));
    case 'aprovadorPara':      return AP_GUARDA_aprovadorPara(payload);
    case 'simular':            return AP_GUARDA_simular(payload);
    case 'escalonar':          return AP_GUARDA_escalonar(payload);
    case 'validar':            return AP_GUARDA_executar(payload, null);
    default:
      return AGRD_erro_('ACAO_DESCONHECIDA',
        'A guarda não conhece a ação "' + acao + '".');
  }
}

function AP_Modulo_guarda(req) {
  req = req || {};
  if (typeof req === 'string') {
    try { req = JSON.parse(req); } catch (e) { req = {}; }
  }
  return AGRD_atender_(req.acao, req.payload, req.sessao || req.token || '');
}

function AP_GUARDA_direto(json) {
  var c = {};
  try { c = JSON.parse(json || '{}'); } catch (e) { c = {}; }
  try {
    return JSON.stringify(AGRD_atender_(c.acao, c.payload, c.token || ''));
  } catch (err) {
    return JSON.stringify(AGRD_erro_('GUARDA_ERRO', String((err && err.message) || err)));
  }
}


/* ============================================================
   10. AP_GUARDA_testes()  —  A PROVA DA V4
   ------------------------------------------------------------
   Roda em cima da V3 de verdade, com a planilha trocada por uma
   de mentira. Nenhuma aba sua é tocada.

   O que está sendo provado:

   · a guarda NÃO grava quando a V3 barra;
   · a guarda NÃO grava quando precisa de aprovação — e diz para
     quem vai;
   · quando o módulo diz que não gravou, a guarda NÃO diz que
     gravou (é o erro que faz sistema mostrar estoque que não tem);
   · módulo que explode no meio não vira "sucesso";
   · a delegação troca o aprovador — e só dentro do prazo, do
     escopo e do módulo para o qual foi dada;
   · círculo de delegação é recusado ANTES de gravar;
   · duas procurações no mesmo período são recusadas;
   · a pendência é entregue ao módulo "aprovacoes" que já existe,
     e quando ele não está, a guarda AVISA em vez de fingir;
   · escalonamento sugere, nunca aprova sozinho.
   ============================================================ */
function AP_GUARDA_testes() {
  var log = [], falhas = 0;
  function ok(nome, passou, obs) {
    if (!passou) falhas++;
    log.push((passou ? 'PASSOU  ' : 'FALHOU  ') + nome + (obs ? '  [' + obs + ']' : ''));
  }

  if (typeof AP_ORG_instalar !== 'function') {
    return { ok: false, total: 0, falhas: 1,
      texto: '=== V4 — A V3 NÃO ESTÁ NO PROJETO. Cole ALMOX_PRO_Modulo_Organograma.gs primeiro. ===' };
  }

  var guardado = {
    Planilhas: (typeof SpreadsheetApp !== 'undefined') ? SpreadsheetApp : null,
    Props: (typeof PropertiesService !== 'undefined') ? PropertiesService : null,
    Utils: (typeof Utilities !== 'undefined') ? Utilities : null,
    Sessao: (typeof Session !== 'undefined') ? Session : null,
    Lock: (typeof LockService !== 'undefined') ? LockService : null,
    verificar: (typeof AP_PERMISSOES_verificar === 'function') ? AP_PERMISSOES_verificar : null,
    alcada: (typeof APERM_alcadaPara_ === 'function') ? APERM_alcadaPara_ : null,
    aprovacoes: (typeof AP_Modulo_aprovacoes === 'function') ? AP_Modulo_aprovacoes : null
  };

  try {
    /* ---------- a mesma planilha de mentira da V3 ---------- */
    function novaAba(nome) {
      var dados = [];
      function garantir(l, c) {
        while (dados.length < l) dados.push([]);
        for (var i = 0; i < dados.length; i++) while (dados[i].length < c) dados[i].push('');
      }
      var eu = {
        __nome: nome, __dados: dados,
        getName: function () { return nome; },
        getLastRow: function () {
          var u = 0;
          for (var i = 0; i < dados.length; i++)
            for (var j = 0; j < dados[i].length; j++)
              if (String(dados[i][j] || '') !== '') { u = i + 1; break; }
          return u;
        },
        getLastColumn: function () {
          var u = 0;
          for (var i = 0; i < dados.length; i++)
            for (var j = 0; j < dados[i].length; j++)
              if (String(dados[i][j] || '') !== '' && j + 1 > u) u = j + 1;
          return u;
        },
        appendRow: function (l) { dados.push(l.slice()); return eu; },
        setFrozenRows: function () { return eu; },
        getRange: function (l, c, nl, nc) {
          nl = nl || 1; nc = nc || 1;
          return {
            getValues: function () {
              garantir(l + nl - 1, c + nc - 1);
              var s = [];
              for (var i = 0; i < nl; i++) s.push(dados[l - 1 + i].slice(c - 1, c - 1 + nc));
              return s;
            },
            setValues: function (v) {
              garantir(l + nl - 1, c + nc - 1);
              for (var i = 0; i < v.length; i++)
                for (var j = 0; j < v[i].length; j++) dados[l - 1 + i][c - 1 + j] = v[i][j];
              return this;
            },
            setFontWeight: function () { return this; }
          };
        }
      };
      return eu;
    }
    var ABAS = {};
    SpreadsheetApp = {
      getActiveSpreadsheet: function () {
        return {
          getSheetByName: function (n) { return ABAS[n] || null; },
          insertSheet: function (n) { ABAS[n] = novaAba(n); return ABAS[n]; }
        };
      }
    };
    var props = {};
    PropertiesService = {
      getScriptProperties: function () {
        return {
          getProperty: function (k) { return props[k] === undefined ? null : props[k]; },
          setProperty: function (k, v) { props[k] = String(v); }
        };
      }
    };
    Utilities = {
      formatDate: function (d) {
        function dd(n) { return (n < 10 ? '0' : '') + n; }
        return d.getFullYear() + '-' + dd(d.getMonth() + 1) + '-' + dd(d.getDate()) +
          ' ' + dd(d.getHours()) + ':' + dd(d.getMinutes()) + ':' + dd(d.getSeconds());
      }
    };
    Session = {
      getActiveUser: function () { return { getEmail: function () { return 'teste@coesa'; } }; },
      getScriptTimeZone: function () { return 'America/Manaus'; }
    };
    LockService = {
      getScriptLock: function () {
        return { tryLock: function () { return true; }, releaseLock: function () { } };
      }
    };

    /* ---------- monta um organograma de verdade, pela V3 ---------- */
    AP_ORG_instalar();
    var emp = AORG_salvarEmpresa_({ nome: 'COESA' }).dados.id;
    var obra = AORG_salvarObra_({ nome: 'Obra Ponte', codigo: 'PON', empresa: emp }).dados.id;
    var setor = AORG_salvarSetor_({ nome: 'Almoxarifado', obra: obra }).dados.id;
    AORG_vincular_({ usuario: 'ismael', setor: setor, funcao: 'almoxarife', nivel: 'Operacional' });
    AORG_vincular_({ usuario: 'joao', setor: setor, funcao: 'encarregado', nivel: 'Supervisão' });
    AORG_vincular_({ usuario: 'maria', setor: setor, funcao: 'encarregado', nivel: 'Supervisão' });
    AORG_vincular_({ usuario: 'diretor', empresa: emp, funcao: 'gerente', nivel: 'Direção' });
    AP_ORG_VALER();

    AP_PERMISSOES_verificar = function () {
      return { ok: true, permitido: true, escopo: 'OBRA', limite: '1000' };
    };
    APERM_alcadaPara_ = function (p) {
      if ((Number(p.valor) || 0) <= 5000) {
        return { ok: true, dados: { id: 'A1', nome: 'Até 5 mil', perfilAprovador: 'encarregado',
          aprovadores: 1, faixa: '0 a 5.000' } };
      }
      return { ok: true, dados: { id: 'A2', nome: 'Acima de 5 mil', perfilAprovador: 'gerente',
        aprovadores: 1, faixa: 'acima de 5.000' } };
    };
    AP_Modulo_aprovacoes = undefined;

    var inst = AP_GUARDA_instalar();
    ok('a guarda instala e enxerga a V3', inst.ok, inst.mensagem);
    ok('e avisa que o módulo de aprovações não está aqui',
      String(inst.dados.aprovacoes).indexOf('ausente') > -1);

    var pedidoOk = {
      usuario: 'ismael', perfil: 'almoxarife', modulo: 'estoque', acao: 'retirar',
      obra: obra, setor: setor, empresa: emp, valor: 100, registro: 'MOV-1'
    };

    /* ============================================================
       1. O PORTÃO DEIXA PASSAR — E SÓ ENTÃO O MÓDULO GRAVA
       ============================================================ */
    var gravou = false;
    var r1 = AP_GUARDA_executar(pedidoOk, function () { gravou = true; return { ok: true, id: 'MOV-1' }; });
    ok('autorizado: o módulo grava', r1.ok && r1.dados.gravou === true && gravou === true, r1.mensagem);

    /* ============================================================
       2. BARRADO: NÃO CHEGA A GRAVAR
       ============================================================ */
    var tentou = false;
    var r2 = AP_GUARDA_executar({
      usuario: 'estranho', perfil: 'almoxarife', modulo: 'estoque', acao: 'retirar',
      obra: obra, valor: 10
    }, function () { tentou = true; return { ok: true }; });
    ok('sem vínculo: barrado', !r2.ok && r2.codigo === 'SEM_VINCULO', r2.codigo);
    ok('e a função do módulo NEM FOI CHAMADA', tentou === false);

    AP_PERMISSOES_verificar = function () {
      return { ok: false, permitido: false, motivo: 'Perfil sem autorização.' };
    };
    var tentou2 = false;
    var r3 = AP_GUARDA_executar(pedidoOk, function () { tentou2 = true; return { ok: true }; });
    ok('sem permissão: barrado pelo módulo de permissões',
      !r3.ok && r3.codigo === 'SEM_PERMISSAO');
    ok('e também não grava', tentou2 === false);
    AP_PERMISSOES_verificar = function () {
      return { ok: true, permitido: true, escopo: 'OBRA', limite: '1000' };
    };

    /* ============================================================
       3. O QUE O MÓDULO DEVOLVE MANDA NO QUE A GUARDA DIZ
       ============================================================ */
    var r4 = AP_GUARDA_executar(pedidoOk, function () {
      return { ok: false, mensagem: 'sem saldo no depósito' };
    });
    ok('módulo disse que NÃO gravou: a guarda não diz que gravou',
      !r4.ok && r4.codigo === 'NAO_GRAVOU' && r4.gravou === false, r4.mensagem);
    ok('e repassa o motivo do módulo', r4.mensagem.indexOf('sem saldo') > -1);

    var r5 = AP_GUARDA_executar(pedidoOk, function () { throw new Error('planilha fora do ar'); });
    ok('módulo que explode não vira sucesso',
      !r5.ok && r5.codigo === 'GRAVACAO_FALHOU' && r5.gravou === false);
    ok('e a mensagem carrega o erro de verdade', r5.mensagem.indexOf('planilha fora do ar') > -1);

    /* ============================================================
       4. ACIMA DO LIMITE: ENCAMINHA, NÃO GRAVA
       ============================================================ */
    var gravouAlto = false;
    var alto = AP_GUARDA_executar({
      usuario: 'ismael', perfil: 'almoxarife', modulo: 'compras', acao: 'criar',
      obra: obra, setor: setor, empresa: emp, valor: 3000, registro: 'CMP-9'
    }, function () { gravouAlto = true; return { ok: true }; });

    ok('acima do limite: NÃO grava', alto.codigo === 'PRECISA_APROVACAO' && gravouAlto === false);
    ok('e diz para quem foi',
      alto.dados.aprovadores.length === 1 &&
      ['joao', 'maria'].indexOf(alto.dados.aprovadores[0].usuario) > -1,
      JSON.stringify(alto.dados.aprovadores.map(function (a) { return a.usuario; })));
    ok('a mensagem deixa claro que nada foi gravado',
      alto.mensagem.indexOf('Nada foi gravado') > -1);
    ok('e avisa que a pendência não foi registrada, porque o módulo não está aqui',
      alto.dados.registradaNoCore === false &&
      String(alto.dados.detalheDoCore).indexOf('não está neste projeto') > -1);
    ok('o pedido volta montado, com tudo que a aprovação precisa',
      alto.dados.pendencia.solicitante === 'ismael' &&
      alto.dados.pendencia.valor === 3000 &&
      alto.dados.pendencia.obra === obra &&
      !!alto.dados.pendencia.regra);

    /* com o módulo de aprovações presente */
    var recebeu = null;
    AP_Modulo_aprovacoes = function (req) { recebeu = req; return { ok: true, dados: { id: 'PEND-1' } }; };
    var alto2 = AP_GUARDA_executar({
      usuario: 'ismael', perfil: 'almoxarife', modulo: 'compras', acao: 'criar',
      obra: obra, setor: setor, empresa: emp, valor: 3000
    }, function () { return { ok: true }; });
    ok('com o módulo presente, a pendência é entregue a ele',
      alto2.dados.registradaNoCore === true && recebeu && recebeu.acao === 'criar');
    ok('e a guarda NÃO abriu caixa própria de pendências',
      typeof ABAS['ALMOXA_PENDENCIAS'] === 'undefined' &&
      typeof ABAS['ALMOXA_APROVACOES'] === 'undefined');

    AP_Modulo_aprovacoes = function () { throw new Error('o Core caiu'); };
    var alto3 = AP_GUARDA_executar({
      usuario: 'ismael', perfil: 'almoxarife', modulo: 'compras', acao: 'criar',
      obra: obra, setor: setor, empresa: emp, valor: 3000
    }, function () { return { ok: true }; });
    ok('módulo de aprovações quebrado: a guarda avisa, não engole',
      alto3.dados.registradaNoCore === false &&
      String(alto3.dados.detalheDoCore).indexOf('o Core caiu') > -1);
    AP_Modulo_aprovacoes = function () { return { ok: true, dados: { id: 'PEND-X' } }; };

    /* ============================================================
       5. DELEGAÇÃO
       ============================================================ */
    var semPrazo = AGRD_delegar_({ deQuem: 'joao', paraQuem: 'maria' });
    ok('delegação sem prazo é recusada',
      !semPrazo.ok && semPrazo.codigo === 'FALTA_PRAZO', semPrazo.mensagem);

    ok('ninguém delega para si mesmo',
      !AGRD_delegar_({ deQuem: 'joao', paraQuem: 'joao', inicio: '2026-01-01', fim: '2026-12-31' }).ok);

    ok('fim antes do começo é recusado',
      !AGRD_delegar_({ deQuem: 'joao', paraQuem: 'maria',
        inicio: '2026-12-31', fim: '2026-01-01' }).ok);

    var ontem = '2020-01-01', amanha = '2099-12-31';
    var del = AGRD_delegar_({ deQuem: 'joao', paraQuem: 'maria', motivo: 'férias',
      inicio: ontem, fim: amanha }, 'ti');
    ok('a delegação é criada', del.ok, del.mensagem);

    var sobreposta = AGRD_delegar_({ deQuem: 'joao', paraQuem: 'diretor',
      inicio: ontem, fim: amanha });
    ok('duas procurações no mesmo período são recusadas',
      !sobreposta.ok && sobreposta.codigo === 'PERIODO_SOBREPOSTO', sobreposta.mensagem);

    var quem = AP_GUARDA_quemResponde('joao', { obra: obra, modulo: 'compras' });
    ok('quem responde por João agora é Maria',
      quem.ok && quem.usuario === 'maria' && quem.delegado === true, quem.motivo);

    /* ============================================================
       6. A DELEGAÇÃO ENTRA NA ROTA — DEPOIS DA REGRA, NUNCA ANTES
       ============================================================ */
    var rotaComDel = AP_GUARDA_aprovadorPara({
      valor: 3000, modulo: 'compras', obra: obra, setor: setor, empresa: emp
    });
    var nomes = rotaComDel.dados.aprovadores.map(function (a) { return a.usuario; });
    ok('a rota continua escolhendo pela REGRA (perfil encarregado)',
      rotaComDel.dados.perfilAprovador === 'encarregado');
    ok('e João foi substituído por Maria na entrega',
      nomes.indexOf('joao') === -1, nomes.join(','));
    ok('o titular fica registrado, não some',
      rotaComDel.dados.aprovadores.every(function (a) {
        return a.usuario !== 'maria' || a.titular === 'joao' || !a.titular;
      }));

    /* delegação fora do prazo não vale */
    AGRD_encerrarDelegacao_({ id: del.dados.id });
    var velha = AGRD_delegar_({ deQuem: 'joao', paraQuem: 'diretor',
      inicio: '2020-01-01', fim: '2020-02-01' }, 'ti');
    ok('delegação vencida pode ser cadastrada (é histórico)', velha.ok);
    var quemHoje = AP_GUARDA_quemResponde('joao', { obra: obra });
    ok('mas não vale hoje: quem responde volta a ser o titular',
      quemHoje.usuario === 'joao' && quemHoje.delegado === false);

    /* delegação amarrada a um módulo não vaza para outro */
    AGRD_delegar_({ deQuem: 'maria', paraQuem: 'diretor', modulo: 'compras',
      inicio: ontem, fim: amanha }, 'ti');
    ok('delegação de "compras" vale em compras',
      AP_GUARDA_quemResponde('maria', { modulo: 'compras' }).usuario === 'diretor');
    ok('e NÃO vale em estoque',
      AP_GUARDA_quemResponde('maria', { modulo: 'estoque' }).usuario === 'maria');
    ok('nem quando o pedido não diz o módulo',
      AP_GUARDA_quemResponde('maria', {}).usuario === 'maria');

    /* ============================================================
       7. CÍRCULO
       ============================================================ */
    var circulo = AGRD_delegar_({ deQuem: 'diretor', paraQuem: 'maria', modulo: 'compras',
      inicio: ontem, fim: amanha });
    ok('círculo de delegação é recusado ANTES de gravar',
      !circulo.ok && circulo.codigo === 'DELEGACAO_CIRCULAR', circulo.mensagem);
    ok('e a mensagem desenha o círculo', circulo.mensagem.indexOf('→') > -1);

    /* ============================================================
       8. ESCALONAMENTO — sugere, não aprova
       ============================================================ */
    var dentroDoPrazo = AP_GUARDA_escalonar({
      criadaEm: AGRD_agora_(), valor: 3000, modulo: 'compras',
      obra: obra, setor: setor, empresa: emp, aprovadores: ['maria']
    });
    ok('dentro do prazo não escala', dentroDoPrazo.ok && dentroDoPrazo.dados.escalar === false);

    var parada = AP_GUARDA_escalonar({
      criadaEm: '2020-01-01 08:00:00', valor: 9000, modulo: 'compras',
      obra: obra, setor: setor, empresa: emp, aprovadores: ['maria']
    });
    ok('parada há muito tempo: sugere subir',
      parada.ok && parada.dados.escalar === true, parada.mensagem);
    ok('e sugere gente que ainda NÃO está com ela',
      parada.dados.para.every(function (a) { return a.usuario !== 'maria'; }));
    ok('mas não aprova nada sozinha',
      !('aprovado' in parada.dados) && !('decidido' in parada.dados));

    /* ============================================================
       9. O RAIO-X
       ============================================================ */
    var raio = AP_GUARDA_simular({
      usuario: 'ismael', perfil: 'almoxarife', modulo: 'compras', acao: 'criar',
      obra: obra, setor: setor, empresa: emp, valor: 3000
    });
    ok('a simulação diz que passaria e iria para aprovação',
      raio.ok && raio.dados.vaiPassar === true && raio.dados.gravaria === false);
    ok('e mostra o caminho passo a passo', raio.dados.passos.length >= 4);

    var raioBarrado = AP_GUARDA_simular({
      usuario: 'estranho', perfil: 'almoxarife', modulo: 'compras', acao: 'criar',
      obra: obra, valor: 10
    });
    ok('a simulação também mostra onde PARARIA',
      raioBarrado.dados.vaiPassar === false &&
      raioBarrado.dados.passos.some(function (p) { return p.resultado === 'PAROU AQUI'; }));

    var antesDaSimulacao = (AORG_linhas_('auditoria') || []).length;
    AP_GUARDA_simular({ usuario: 'ismael', perfil: 'almoxarife', modulo: 'estoque',
      acao: 'retirar', obra: obra, setor: setor, valor: 10 });
    ok('simular não grava dado nenhum no sistema',
      typeof ABAS['ALMOXA_ESTOQUE'] === 'undefined');

    /* ============================================================
       10. AUDITORIA E PORTAS
       ============================================================ */
    var auditoria = AORG_auditoria_({ quantas: 200 }).dados;
    var comGravacao = auditoria.filter(function (a) {
      return String(a.operacao).indexOf('(gravação)') > -1;
    });
    ok('a gravação de verdade vira linha de auditoria', comGravacao.length > 0);
    ok('inclusive quando o módulo recusou',
      comGravacao.some(function (a) { return a.resultado === 'NAO_GRAVOU'; }));
    ok('e quando o módulo explodiu',
      comGravacao.some(function (a) { return a.resultado === 'ERRO'; }));

    var pelaPorta = AP_Modulo_guarda({ acao: 'delegacoes', payload: { incluirEncerradas: true } });
    ok('a porta do roteador responde', pelaPorta.ok && pelaPorta.dados.length >= 2);
    ok('ação inventada é recusada',
      !AP_Modulo_guarda({ acao: 'voar' }).ok);
    var texto = AP_GUARDA_direto(JSON.stringify({ acao: 'quemResponde',
      payload: { usuario: 'maria', modulo: 'compras' } }));
    ok('a porta direta devolve texto',
      typeof texto === 'string' && JSON.parse(texto).dados.usuario === 'diretor');

  } catch (explodiu) {
    falhas++;
    log.push('FALHOU  o teste explodiu: ' + ((explodiu && explodiu.stack) || explodiu));
  } finally {
    if (guardado.Planilhas) SpreadsheetApp = guardado.Planilhas;
    if (guardado.Props) PropertiesService = guardado.Props;
    if (guardado.Utils) Utilities = guardado.Utils;
    if (guardado.Sessao) Session = guardado.Sessao;
    if (guardado.Lock) LockService = guardado.Lock;
    if (guardado.verificar) AP_PERMISSOES_verificar = guardado.verificar;
    if (guardado.alcada) APERM_alcadaPara_ = guardado.alcada;
    AP_Modulo_aprovacoes = guardado.aprovacoes;
  }

  var texto = '=== V4 — GUARDA DE OPERAÇÕES E DELEGAÇÃO — ' +
    (falhas ? falhas + ' FALHA(S) DE ' + log.length : 'TODOS OS ' + log.length + ' TESTES PASSARAM') +
    ' ===\n' + log.join('\n');
  try { Logger.log(texto); } catch (e) { }
  return { ok: falhas === 0, total: log.length, falhas: falhas, texto: texto };
}
