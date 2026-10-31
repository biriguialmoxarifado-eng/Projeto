/**
 * ============================================================================
 * AP_CAUTELA_AUTO — O MOTOR DE CAUTELAS, NO SERVIDOR
 * ----------------------------------------------------------------------------
 * POR QUE ESTE ARQUIVO EXISTE
 *
 *   Ismael, 31/10: "cadê os motores? Só dependendo do HTML não vai dar certo.
 *   Ele precisa aparecer ali nas cautelas de equipamentos automático, não
 *   precisa clicar em nada."
 *
 *   Ele tem razão. Tudo que eu tinha feito rodava no NAVEGADOR: o motor de
 *   regras, o gerador, a identificação do colaborador. Com a aba fechada,
 *   nada nascia. Quem pede pelo celular não gerava cautela nenhuma.
 *
 *   Este arquivo é o motor de verdade: roda no Apps Script, com ou sem
 *   ninguém olhando.
 *
 * COMO ELE ALCANÇA OS OUTROS MÓDULOS
 *   Pelo MESMO roteador que o navegador usa — almoxaApi. Não toco em tabela
 *   de ninguém, não presumo nome de aba, não duplico módulo. Se o Core sabe
 *   responder ao navegador, sabe responder a mim.
 *
 * O QUE ELE FAZ
 *   1. pega a reserva pelo protocolo;
 *   2. confere se ela está confirmada (reserva pendente não gera documento);
 *   3. descobre a categoria de cada item no catálogo;
 *   4. pergunta à Central de Cautelas qual modelo se aplica;
 *   5. descarta o que não exige cautela;
 *   6. agrupa por modelo — ferramenta na simples, TI no Termo;
 *   7. acha o id único do colaborador no cadastro;
 *   8. grava UMA cautela por modelo.
 *
 * O QUE ELE NÃO FAZ
 *   Não cria aba, não cria coluna, não apaga nada, não altera o Core.
 *   Não gera duas cautelas da mesma operação: antes de gravar, procura a
 *   marca de origem nas cautelas que já existem.
 *   Não inventa colaborador: se não identificar com segurança, recusa e diz.
 *
 * COMO LIGAR — duas formas, e a segunda é a que você quer
 *
 *   A) NA HORA: chame AP_CT_gerarDaReserva("#RES-000037") de onde a
 *      aprovação acontece no seu Core. Uma linha.
 *
 *   B) SOZINHO, SEM NAVEGADOR: crie um acionador de tempo para
 *      AP_CT_varrerPendentes. No editor do Apps Script:
 *        Acionadores → Adicionar acionador
 *        Função: AP_CT_varrerPendentes
 *        Origem: Baseado no tempo → Temporizador por minuto → A cada 5 minutos
 *      A partir daí ele varre as reservas confirmadas sem cautela e gera.
 *      Ninguém precisa clicar em nada.
 *
 * ANTES DE LIGAR O ACIONADOR
 *   Rode AP_CT_testar() uma vez. Ele NÃO grava nada: só diz o que faria.
 * ============================================================================
 */

/** Com true, calcula tudo e NÃO grava. Comece assim, leia o relatório,
 *  depois mude para false. (Aprendi isto do jeito ruim: um arquivo meu
 *  ficou dias em simulação sem ninguém perceber. Por isso AP_CT_testar()
 *  e AP_CT_diagnostico() dizem em que modo ele está, sempre.) */
var AP_CT_SIMULAR = false;

/** Quantas reservas a varredura olha por rodada. */
var AP_CT_TETO_VARREDURA = 40;

/** Situações em que uma reserva já pode gerar documento. */
var AP_CT_CONFIRMADA = /^(APROVADA|CONFIRMADA|LIBERADA|DISPONIVEL|SEPARACAO|AGUARDANDO_RETIRADA|ENTREGUE)$/i;
var AP_CT_PENDENTE   = /^(AGUARDANDO_APROV|PENDENTE|EM_APROV|RASCUNHO)/i;
var AP_CT_MORTA      = /^(RECUSADA|CANCELADA|VENCIDA|EXCLUIDA)/i;


/* ==========================================================================
   1. FALAR COM O RESTO DO SISTEMA
   --------------------------------------------------------------------------
   Uma porta só: o roteador que o navegador já usa. Se ele não existir
   neste projeto, eu digo — não procuro outro caminho por conta própria.
   ========================================================================== */
function AP_CT_core_(modulo, acao, payload) {
  if (typeof almoxaApi !== 'function') {
    return { ok: false, codigo: 'SEM_ROTEADOR',
      mensagem: 'A função almoxaApi não existe neste projeto do Apps Script. ' +
                'É por ela que o navegador fala com o Core, e é por ela que ' +
                'este motor fala também. Sem ela eu não alcanço módulo nenhum.' };
  }
  var pedido = {
    modulo: modulo,
    acao: acao,
    payload: payload || {},
    sessao: null,
    perfil: 'sistema',
    origem: 'AP_CAUTELA_AUTO',
    ts: new Date().getTime()
  };
  var bruto;
  try {
    bruto = almoxaApi(JSON.stringify(pedido));
  } catch (e) {
    return { ok: false, codigo: 'EXCECAO',
      mensagem: 'o roteador estourou em ' + modulo + '.' + acao + ': ' +
                String(e && e.message || e) };
  }
  var r = bruto;
  if (typeof bruto === 'string') {
    try { r = JSON.parse(bruto); } catch (e) { r = null; }
  }
  if (!r) {
    return { ok: false, codigo: 'RESPOSTA_ESTRANHA',
      mensagem: modulo + '.' + acao + ' respondeu algo que não é resposta' };
  }
  if (r.ok === undefined) return { ok: true, dados: r };
  return r;
}

function AP_CT_txt_(v) {
  return String(v === null || v === undefined ? '' : v).trim();
}
function AP_CT_lista_(v) {
  if (!v) return [];
  if (Object.prototype.toString.call(v) === '[object Array]') return v;
  if (typeof v === 'object') {
    var chaves = ['dados', 'itens', 'lista', 'registros', 'linhas', 'reservas', 'modelos', 'regras'];
    for (var i = 0; i < chaves.length; i++) {
      if (v[chaves[i]] && Object.prototype.toString.call(v[chaves[i]]) === '[object Array]') {
        return v[chaves[i]];
      }
    }
  }
  return [];
}
function AP_CT_normal_(v) {
  return AP_CT_txt_(v).toUpperCase()
    .replace(/[ÁÀÂÃÄ]/g, 'A').replace(/[ÉÈÊË]/g, 'E').replace(/[ÍÌÎÏ]/g, 'I')
    .replace(/[ÓÒÔÕÖ]/g, 'O').replace(/[ÚÙÛÜ]/g, 'U').replace(/[Ç]/g, 'C')
    .replace(/\s+/g, ' ').trim();
}
function AP_CT_mat_(v) {
  return AP_CT_txt_(v).toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '');
}
function AP_CT_soAlfaNum_(v) {
  return AP_CT_txt_(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
}
/** A marca de origem. Normalizada, porque "#RES-35" e "RES-35" são a
 *  mesma operação — e comparar o texto cru já me rendeu cautela duplicada. */
function AP_CT_marca_(protocolo, modeloId) {
  return '[origem:' + AP_CT_soAlfaNum_(protocolo) + '|' + AP_CT_soAlfaNum_(modeloId) + ']';
}


/* ==========================================================================
   2. O MOTOR DE REGRAS
   --------------------------------------------------------------------------
   A mesma precedência da Central: regra do produto manda mais que a da
   categoria, que manda mais que o padrão. "Herdar" sobe um nível.
   ========================================================================== */
var AP_CT_CHAVES = ['exigePatrimonio', 'exigeCautela', 'exigeAssinatura', 'exigeSerie',
                    'exigeIdentificacao', 'exigeDevolucao', 'permitePermanente',
                    'validaEntregaFisica'];

function AP_CT_carregarConfig_() {
  var cfg = { modelos: [], regras: [], erro: '' };
  var rm = AP_CT_core_('cautelacfg', 'modelos', {});
  if (!rm.ok) { cfg.erro = 'modelos: ' + AP_CT_txt_(rm.mensagem || rm.codigo); return cfg; }
  cfg.modelos = AP_CT_lista_(rm.dados);

  var rr = AP_CT_core_('cautelacfg', 'regras', {});
  if (!rr.ok) { cfg.erro = 'regras: ' + AP_CT_txt_(rr.mensagem || rr.codigo); return cfg; }
  cfg.regras = AP_CT_lista_(rr.dados);
  return cfg;
}

function AP_CT_alvosDe_(r) {
  if (r.alvos && r.alvos.length) return r.alvos;
  return AP_CT_txt_(r.alvo).split(/[;\n]/).map(AP_CT_txt_).filter(function (x) { return !!x; });
}

/** Devolve { exigeCautela, modeloId, modeloNome, origem, porQue } */
function AP_CT_resolver_(cfg, produto) {
  var sku = AP_CT_txt_(produto.sku || produto.codigo || produto.id).toUpperCase();
  var categoria = AP_CT_normal_(produto.categoria);

  var daSku = null, daCategoria = null;
  AP_CT_lista_(cfg.regras).forEach(function (r) {
    if (AP_CT_txt_(r.status).toUpperCase() === 'EXCLUIDA') return;
    if (r.ativo === false) return;
    var tipo = AP_CT_txt_(r.tipo).toUpperCase();
    AP_CT_alvosDe_(r).forEach(function (a) {
      var alvo = AP_CT_txt_(a).toUpperCase();
      if (!alvo) return;
      if (tipo === 'SKU' && alvo === sku && !daSku) daSku = r;
      if (tipo === 'CATEGORIA' && AP_CT_normal_(alvo) === categoria && !daCategoria) daCategoria = r;
    });
  });

  var escolhida = daSku || daCategoria;
  if (!escolhida) {
    return { exigeCautela: false, modeloId: '', modeloNome: '',
             origem: 'PADRÃO DA EMPRESA',
             porQue: 'este produto não tem regra cadastrada' };
  }

  var modelo = null;
  AP_CT_lista_(cfg.modelos).forEach(function (m) {
    if (AP_CT_txt_(m.id) === AP_CT_txt_(escolhida.modeloId)) modelo = m;
  });

  /* "herdar" = o campo não foi decidido na regra; vale o do modelo */
  var saida = {
    origem: daSku ? 'REGRA DO PRODUTO' : 'REGRA DA CATEGORIA',
    modeloId: AP_CT_txt_(escolhida.modeloId),
    modeloNome: AP_CT_txt_(modelo && modelo.nome) || AP_CT_txt_(escolhida.modeloNome),
    modeloExiste: !!modelo
  };
  AP_CT_CHAVES.forEach(function (k) {
    var naRegra = escolhida[k];
    if (naRegra === true || naRegra === false) { saida[k] = naRegra; return; }
    saida[k] = modelo ? (modelo[k] === true) : false;
  });
  saida.porQue = 'veio da ' + saida.origem.toLowerCase() +
    (saida.modeloNome ? ', modelo "' + saida.modeloNome + '"' : '');
  return saida;
}


/* ==========================================================================
   3. QUEM É O COLABORADOR
   --------------------------------------------------------------------------
   Pela matrícula, pelo nome, e — quando o nome repete — estreitando por
   cargo e setor. Se não separar, PARA: cautela carimbada na pessoa errada
   é pior do que cautela nenhuma.
   ========================================================================== */
function AP_CT_acharColaborador_(reserva) {
  var direto = AP_CT_txt_(reserva.idColaborador || reserva.colaboradorId || reserva.usuarioId);
  if (direto) return { id: direto, por: 'veio na reserva' };

  var r = AP_CT_core_('usuarios', 'listar', {});
  if (!r.ok) {
    return { id: '', erro: 'não consegui ler o cadastro de colaboradores (' +
                           AP_CT_txt_(r.mensagem || r.codigo) + ')' };
  }
  var todos = AP_CT_lista_(r.dados);
  var mat = AP_CT_mat_(reserva.matricula);
  var nome = AP_CT_normal_(reserva.colaborador || reserva.solicitante);

  if (mat) {
    var porMat = todos.filter(function (u) { return AP_CT_mat_(u.matricula) === mat; });
    if (porMat.length === 1) return { id: AP_CT_txt_(porMat[0].id), por: 'matrícula' };
  }
  if (!nome) {
    return { id: '', erro: 'a reserva não diz o nome do colaborador' };
  }

  var candidatos = todos.filter(function (u) {
    return AP_CT_normal_(u.nome || u.colaborador) === nome;
  });
  if (candidatos.length === 1) return { id: AP_CT_txt_(candidatos[0].id), por: 'nome' };
  if (!candidatos.length) {
    return { id: '', erro: 'não achei "' + AP_CT_txt_(reserva.colaborador) + '"' +
                           (mat ? ' (matrícula ' + mat + ')' : '') + ' no cadastro' };
  }

  var usou = ['nome'];
  if (mat) {
    var m2 = candidatos.filter(function (u) { return AP_CT_mat_(u.matricula) === mat; });
    if (m2.length === 1) return { id: AP_CT_txt_(m2[0].id), por: 'nome + matrícula' };
    if (m2.length) { candidatos = m2; usou.push('matrícula'); }
  }
  var cargo = AP_CT_normal_(reserva.cargo);
  if (cargo) {
    var c2 = candidatos.filter(function (u) { return AP_CT_normal_(u.cargo || u.funcao) === cargo; });
    if (c2.length === 1) return { id: AP_CT_txt_(c2[0].id), por: usou.concat('cargo').join(' + ') };
    if (c2.length) { candidatos = c2; usou.push('cargo'); }
  }
  var setor = AP_CT_normal_(reserva.setor);
  if (setor) {
    var s2 = candidatos.filter(function (u) { return AP_CT_normal_(u.setor) === setor; });
    if (s2.length === 1) return { id: AP_CT_txt_(s2[0].id), por: usou.concat('setor').join(' + ') };
    if (s2.length) candidatos = s2;
  }

  return { id: '', erro: 'achei ' + candidatos.length + ' cadastros com o nome "' +
    AP_CT_txt_(reserva.colaborador) + '" e não consegui separar nem pela matrícula, ' +
    'nem pelo cargo, nem pelo setor (' +
    candidatos.map(function (u) { return AP_CT_txt_(u.id); }).join(', ') +
    ') — resolva a duplicidade no cadastro' };
}


/* ==========================================================================
   4. A CATEGORIA DE CADA ITEM
   --------------------------------------------------------------------------
   A reserva traz sku, nome e quantidade — raramente a categoria. E a regra
   é por categoria. Sem completar no catálogo, nada bate e tudo cai no
   padrão da empresa. Foi exatamente isso que fez o Ismael perder uma manhã.
   ========================================================================== */
function AP_CT_catalogo_() {
  var r = AP_CT_core_('itens', 'listar', {});
  if (!r.ok) return null;
  var ix = {};
  AP_CT_lista_(r.dados).forEach(function (i) {
    var k = AP_CT_txt_(i.sku || i.codigo || i.id).toUpperCase();
    if (k) ix[k] = i;
  });
  return ix;
}

function AP_CT_completar_(item, catalogo) {
  var copia = {};
  for (var k in item) if (item.hasOwnProperty(k)) copia[k] = item[k];
  if (AP_CT_txt_(copia.categoria)) { copia.__categoriaDe = 'reserva'; return copia; }
  var sku = AP_CT_txt_(copia.sku || copia.codigo || copia.id).toUpperCase();
  if (!sku || !catalogo || !catalogo[sku]) { copia.__categoriaDe = 'NÃO ACHEI'; return copia; }
  var c = catalogo[sku];
  copia.categoria = AP_CT_txt_(c.categoria || c.familia || c.grupo);
  if (!AP_CT_txt_(copia.nome)) copia.nome = AP_CT_txt_(c.nome || c.descricao);
  copia.__categoriaDe = 'catálogo';
  return copia;
}


/* ==========================================================================
   5. O GERADOR
   ========================================================================== */
function AP_CT_jaExiste_(protocolo, modeloId) {
  var marca = AP_CT_marca_(protocolo, modeloId);
  var r = AP_CT_core_('cautela', 'listar', {});
  if (!r.ok) return false;          /* na dúvida eu não bloqueio */
  var achou = false;
  AP_CT_lista_(r.dados).forEach(function (c) {
    if (AP_CT_txt_(c.observacao).indexOf(marca) > -1) achou = true;
  });
  return achou;
}

function AP_CT_montar_(reserva, grupo, idColab, protocolo) {
  var hoje = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return {
    numero: '',
    emissao: hoje,
    empresa: AP_CT_txt_(reserva.empresa),
    obra: AP_CT_txt_(reserva.obra),
    setor: AP_CT_txt_(reserva.setor),
    contrato: AP_CT_txt_(reserva.contrato),
    colaborador: AP_CT_txt_(reserva.colaborador || reserva.solicitante),
    matricula: AP_CT_txt_(reserva.matricula),
    cpf: AP_CT_txt_(reserva.cpf),
    cargo: AP_CT_txt_(reserva.cargo),
    setorColaborador: AP_CT_txt_(reserva.setor),
    idColaborador: AP_CT_txt_(idColab),
    requisitante: AP_CT_txt_(reserva.solicitante || reserva.colaborador),
    categoria: AP_CT_txt_(grupo.modeloNome),
    modeloId: AP_CT_txt_(grupo.modeloId),
    modeloNome: AP_CT_txt_(grupo.modeloNome),
    observacao: 'Gerada pelo motor, a partir de ' + AP_CT_txt_(protocolo) + '. ' +
                AP_CT_marca_(protocolo, grupo.modeloId),
    itens: grupo.itens.map(function (i) {
      return {
        descricao: AP_CT_txt_(i.nome || i.descricao || i.item),
        sku: AP_CT_txt_(i.sku || i.codigo),
        qtd: Number(i.qtd || i.qtdSolicitada || i.quantidade || 1) || 1,
        patrimonio: AP_CT_txt_(i.patrimonio),
        serie: AP_CT_txt_(i.serie || i.numeroSerie),
        marca: AP_CT_txt_(i.marca),
        modelo: AP_CT_txt_(i.modelo)
      };
    })
  };
}

/**
 * O FLUXO INTEIRO, PARA UMA RESERVA.
 * Devolve um relatório. Nunca estoura: quem chama pode ser um acionador.
 */
function AP_CT_gerarDaReserva(protocolo, reservaJaLida) {
  var saida = {
    ok: true, protocolo: AP_CT_txt_(protocolo), simulado: !!AP_CT_SIMULAR,
    criadas: [], puladas: [], falhas: [], semCautela: 0, detalhe: [],
    colaborador: null, quando: new Date().toISOString()
  };
  if (!AP_CT_txt_(protocolo)) {
    saida.ok = false;
    saida.falhas.push({ modelo: '(nenhum)', motivo: 'sem protocolo não dá para gerar nada' });
    return saida;
  }

  /* --- a reserva --- */
  var reserva = reservaJaLida || null;
  if (!reserva) {
    var rr = AP_CT_core_('reservas', 'obter', { protocolo: AP_CT_txt_(protocolo) });
    if (!rr.ok || !rr.dados) {
      rr = AP_CT_core_('reservas', 'detalhe', { protocolo: AP_CT_txt_(protocolo) });
    }
    if (!rr.ok || !rr.dados) {
      saida.ok = false;
      saida.falhas.push({ modelo: '(nenhum)',
        motivo: 'não consegui ler a reserva ' + AP_CT_txt_(protocolo) + ': ' +
                AP_CT_txt_(rr.mensagem || rr.codigo) });
      return saida;
    }
    reserva = rr.dados;
  }

  var status = AP_CT_txt_(reserva.status || reserva.situacao).toUpperCase();
  saida.status = status;
  if (AP_CT_MORTA.test(status)) {
    saida.falhas.push({ modelo: '(nenhum)',
      motivo: 'a reserva está ' + status + ' — não gero documento para ela' });
    return saida;
  }
  if (AP_CT_PENDENTE.test(status)) {
    saida.puladas.push('(aguardando aprovação)');
    saida.motivo = 'a reserva ainda não está confirmada (' + status +
                   ') — vai gerar quando for aprovada';
    return saida;
  }
  if (status && !AP_CT_CONFIRMADA.test(status)) {
    saida.motivo = 'situação "' + status + '" não é uma em que eu gere cautela';
    return saida;
  }

  var itens = AP_CT_lista_(reserva.itens);
  if (!itens.length) {
    saida.falhas.push({ modelo: '(nenhum)',
      motivo: 'a reserva não tem itens, então não sei que cautela gerar' });
    return saida;
  }

  /* --- regras e catálogo --- */
  var cfg = AP_CT_carregarConfig_();
  if (cfg.erro) {
    saida.ok = false;
    saida.falhas.push({ modelo: '(todos)',
      motivo: 'não consultei a Central de Cautelas — ' + cfg.erro });
    return saida;
  }
  var catalogo = AP_CT_catalogo_();

  /* --- agrupar por modelo --- */
  var grupos = {}, ordem = [];
  itens.forEach(function (bruto) {
    var i = AP_CT_completar_(bruto, catalogo);
    var reg = AP_CT_resolver_(cfg, {
      sku: i.sku || i.codigo, codigo: i.codigo || i.sku, categoria: i.categoria
    });
    saida.detalhe.push({
      item: AP_CT_txt_(i.nome || i.descricao || i.sku),
      sku: AP_CT_txt_(i.sku || i.codigo),
      categoria: AP_CT_txt_(i.categoria),
      categoriaDe: AP_CT_txt_(i.__categoriaDe),
      origem: reg.origem,
      modelo: reg.modeloNome || reg.modeloId,
      gera: reg.exigeCautela === true
    });
    /* A ORDEM IMPORTA, e eu errei aqui primeiro.
       Quando a regra existe mas aponta para um modelo que sumiu do
       servidor, o resolvedor devolvia exigeCautela=false — porque as
       exigências vêm do modelo, e sem modelo tudo é false. O item
       caía em "não exige cautela" e NINGUÉM ficava sabendo.
       Isso é sucesso falso: o Teste D do pedido dele proíbe. Então a
       regra órfã é conferida ANTES do portão da exigência. */
    if (AP_CT_txt_(reg.modeloId) && !reg.modeloExiste) {
      saida.falhas.push({ modelo: AP_CT_txt_(reg.modeloId),
        motivo: 'a ' + reg.origem.toLowerCase() + ' aponta para um modelo que não ' +
                'existe no servidor — não sei que documento emitir, e não vou ' +
                'tratar isto como "não exige cautela"' });
      return;
    }
    if (reg.exigeCautela !== true) { saida.semCautela++; return; }
    var k = AP_CT_txt_(reg.modeloId) || '(sem modelo)';
    if (!grupos[k]) {
      grupos[k] = { modeloId: k, modeloNome: reg.modeloNome, itens: [] };
      ordem.push(k);
    }
    grupos[k].itens.push(i);
  });

  if (!ordem.length) return saida;

  /* --- quem é a pessoa --- */
  var quem = AP_CT_acharColaborador_(reserva);
  saida.colaborador = { id: quem.id, por: AP_CT_txt_(quem.por), erro: AP_CT_txt_(quem.erro) };
  if (!quem.id) {
    saida.ok = false;
    saida.falhas.push({
      modelo: ordem.map(function (k) { return grupos[k].modeloNome || k; }).join(', '),
      motivo: 'não identifiquei o colaborador: ' + quem.erro +
              '. Sem o id a assinatura cadastrada nunca é encontrada, então não gravo.'
    });
    return saida;
  }

  /* --- gravar --- */
  ordem.forEach(function (k) {
    var grupo = grupos[k];
    var nome = grupo.modeloNome || grupo.modeloId;
    if (AP_CT_jaExiste_(protocolo, grupo.modeloId)) {
      saida.puladas.push(nome);
      return;
    }
    var c = AP_CT_montar_(reserva, grupo, quem.id, protocolo);
    if (AP_CT_SIMULAR) {
      saida.criadas.push({ numero: '(simulação)', modelo: nome, itens: grupo.itens.length });
      return;
    }
    var rs = AP_CT_core_('cautela', 'salvar', c);
    if (rs.ok) {
      var numero = AP_CT_txt_(rs.dados && (rs.dados.numero || rs.dados.id));
      /* só digo que gravou porque o servidor devolveu o número */
      if (!numero) {
        saida.falhas.push({ modelo: nome,
          motivo: 'o servidor respondeu ok mas não devolveu o número — ' +
                  'NÃO considere gravada, confira a lista de cautelas' });
        return;
      }
      saida.criadas.push({ numero: numero, modelo: nome, itens: grupo.itens.length });
    } else {
      saida.falhas.push({ modelo: nome,
        motivo: AP_CT_txt_(rs.mensagem || rs.codigo) || 'o servidor não confirmou' });
    }
  });

  if (saida.falhas.length) saida.ok = false;
  return saida;
}


/* ==========================================================================
   6. A VARREDURA — é ela que faz "sem clicar em nada"
   --------------------------------------------------------------------------
   Ponha num acionador de tempo. Ela olha as reservas confirmadas, pula as
   que já têm cautela (a marca de origem resolve isso) e gera o que falta.
   ========================================================================== */
function AP_CT_varrerPendentes() {
  var relatorio = { quando: new Date().toISOString(), simulado: !!AP_CT_SIMULAR,
                    olhadas: 0, geradas: 0, puladas: 0, falhas: [], detalhe: [] };

  var r = AP_CT_core_('reservas', 'listar', {});
  if (!r.ok) {
    relatorio.falhas.push('não consegui listar as reservas: ' +
                          AP_CT_txt_(r.mensagem || r.codigo));
    Logger.log(JSON.stringify(relatorio, null, 2));
    return relatorio;
  }

  var lista = AP_CT_lista_(r.dados);
  /* da mais nova para a mais velha, com teto: um acionador não pode
     varrer o histórico inteiro a cada cinco minutos */
  lista = lista.slice(0, AP_CT_TETO_VARREDURA);

  lista.forEach(function (reserva) {
    var status = AP_CT_txt_(reserva.status || reserva.situacao).toUpperCase();
    if (!AP_CT_CONFIRMADA.test(status)) return;
    var protocolo = AP_CT_txt_(reserva.protocolo || reserva.numero || reserva.id);
    if (!protocolo) return;

    relatorio.olhadas++;
    var s = AP_CT_gerarDaReserva(protocolo, reserva);
    relatorio.geradas += s.criadas.length;
    relatorio.puladas += s.puladas.length;
    s.falhas.forEach(function (f) {
      relatorio.falhas.push(protocolo + ' · ' + f.modelo + ': ' + f.motivo);
    });
    if (s.criadas.length) {
      relatorio.detalhe.push(protocolo + ' → ' +
        s.criadas.map(function (c) { return c.numero + ' (' + c.modelo + ')'; }).join(', '));
    }
  });

  Logger.log(JSON.stringify(relatorio, null, 2));
  return relatorio;
}


/* ==========================================================================
   7. DIAGNÓSTICO E ENSAIO — nenhum dos dois grava nada
   ========================================================================== */
function AP_CT_diagnostico() {
  var saida = [];
  function diz(s) { saida.push(s); Logger.log(s); }

  diz('=== AP_CAUTELA_AUTO · DIAGNÓSTICO ===');
  diz('modo: ' + (AP_CT_SIMULAR ? 'SIMULAÇÃO (não grava nada)' : 'GRAVANDO DE VERDADE'));
  diz('roteador almoxaApi: ' + (typeof almoxaApi === 'function' ? 'existe' : 'NÃO EXISTE'));
  if (typeof almoxaApi !== 'function') {
    diz('');
    diz('Sem o roteador eu não alcanço módulo nenhum. Confira se este arquivo');
    diz('está no MESMO projeto do Apps Script que o ALMOX-PRO.');
    return saida.join('\n');
  }

  [['cautelacfg', 'modelos'], ['cautelacfg', 'regras'], ['itens', 'listar'],
   ['usuarios', 'listar'], ['reservas', 'listar'], ['cautela', 'listar']
  ].forEach(function (par) {
    var r = AP_CT_core_(par[0], par[1], {});
    var n = r.ok ? AP_CT_lista_(r.dados).length : 0;
    diz(par[0] + '.' + par[1] + ': ' +
        (r.ok ? 'ok · ' + n + ' registro(s)'
              : 'FALHOU · ' + AP_CT_txt_(r.codigo) + ' ' + AP_CT_txt_(r.mensagem)));
  });

  var cfg = AP_CT_carregarConfig_();
  if (cfg.erro) { diz('motor de regras: NÃO carregou — ' + cfg.erro); }
  else {
    diz('motor de regras: ' + cfg.modelos.length + ' modelo(s), ' +
        cfg.regras.length + ' regra(s)');
    cfg.regras.forEach(function (rg) {
      var m = null;
      cfg.modelos.forEach(function (x) { if (AP_CT_txt_(x.id) === AP_CT_txt_(rg.modeloId)) m = x; });
      diz('  · ' + AP_CT_txt_(rg.tipo) + ' "' + AP_CT_txt_(rg.alvo) + '" → ' +
          (m ? AP_CT_txt_(m.nome) : 'MODELO ' + AP_CT_txt_(rg.modeloId) + ' NÃO EXISTE'));
    });
  }
  diz('');
  diz('Para ensaiar sem gravar: AP_CT_testar()');
  diz('Para gerar de uma reserva:  AP_CT_gerarDaReserva("#RES-000037")');
  diz('Para rodar sozinho:         acionador de tempo em AP_CT_varrerPendentes');
  return saida.join('\n');
}

/** Ensaio: roda a varredura SEM gravar, aconteça o que acontecer. */
function AP_CT_testar() {
  var antes = AP_CT_SIMULAR;
  AP_CT_SIMULAR = true;
  var r;
  try { r = AP_CT_varrerPendentes(); }
  finally { AP_CT_SIMULAR = antes; }
  Logger.log('--- ENSAIO: nada acima foi gravado. Modo real continua ' +
             (antes ? 'SIMULAÇÃO' : 'GRAVANDO') + '. ---');
  return r;
}
