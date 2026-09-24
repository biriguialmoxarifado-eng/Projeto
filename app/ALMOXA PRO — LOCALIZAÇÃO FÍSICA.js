/**
 * ============================================================
 * ALMOXA PRO — LOCALIZAÇÃO FÍSICA
 * Versão 1.0.0
 * ------------------------------------------------------------
 * O ENDEREÇO DE CADA MATERIAL
 *
 * Este módulo guarda a estrutura física do almoxarifado:
 * almoxarifado, ruas, níveis e posições. É daqui que o mapa 3D
 * vai nascer — sem estrutura cadastrada, não há o que desenhar.
 *
 *   ALMOXARIFADO → RUA → NÍVEL → POSIÇÃO → MATERIAL
 *
 *        A01    -   R01  -  N02  -  P03
 *
 * ------------------------------------------------------------
 * GERAÇÃO AUTOMÁTICA
 *
 * O usuário diz "rua 01, 4 níveis, 5 posições cada" e o módulo
 * cria as 20 posições com seus códigos. Ninguém digita
 * A01-R01-N01-P01 vinte vezes.
 *
 * ------------------------------------------------------------
 * O QUE ELE NÃO FAZ
 *
 * Não mexe em estoque. A posição sabe QUE está ocupada, mas a
 * quantidade e o saldo continuam no módulo de estoque — que é a
 * autoridade. Aqui é só o endereço.
 * ============================================================
 */

var AP_LOC_CFG = {
  versao: '1.0.0',

  abaEstrutura: 'ALMOXA_ESTRUTURA_FISICA',
  colunas: ['codigo', 'tipo', 'pai', 'almoxarifado', 'rua', 'nivel', 'posicao',
    'nome', 'descricao', 'categoria', 'capacidade', 'status', 'observacao',
    'criadoEm', 'criadoPor', 'atualizadoEm'],

  abaOcupacao: 'ALMOXA_OCUPACAO',
  colunasOcupacao: ['id', 'localizacao', 'sku', 'descricao', 'quantidade',
    'unidade', 'lote', 'nf', 'armazenadoEm', 'armazenadoPor', 'observacao'],

  /* os níveis da hierarquia */
  tipos: ['ALMOXARIFADO', 'AREA', 'RUA', 'NIVEL', 'POSICAO'],

  /* estados possíveis de uma posição */
  status: {
    DISPONIVEL: { cor: '#1E9E5A', rotulo: 'Disponível' },
    OCUPADA: { cor: '#0B5FFF', rotulo: 'Ocupada' },
    RESERVADA: { cor: '#FF9F1C', rotulo: 'Reservada' },
    BLOQUEADA: { cor: '#8E969F', rotulo: 'Bloqueada' },
    CRITICA: { cor: '#C0392B', rotulo: 'Crítica' }
  }
};

function AP_LOC_aba_() {
  AP_Data_getSheet(AP_LOC_CFG.abaEstrutura, AP_LOC_CFG.colunas);
  return AP_LOC_CFG.abaEstrutura;
}

function AP_LOC_abaOcupacao_() {
  AP_Data_getSheet(AP_LOC_CFG.abaOcupacao, AP_LOC_CFG.colunasOcupacao);
  return AP_LOC_CFG.abaOcupacao;
}

/* ============================================================
   CÓDIGOS
   ============================================================ */

/** Monta o código a partir das partes: A01-R01-N02-P03 */
function AP_LOC_codigo_(partes) {
  var pedacos = [];
  if (partes.almoxarifado) pedacos.push('A' + AP_LOC_dois_(partes.almoxarifado));
  if (partes.rua) pedacos.push('R' + AP_LOC_dois_(partes.rua));
  if (partes.nivel) pedacos.push('N' + AP_LOC_dois_(partes.nivel));
  if (partes.posicao) pedacos.push('P' + AP_LOC_dois_(partes.posicao));
  return pedacos.join('-');
}

function AP_LOC_dois_(n) {
  var s = String(n).replace(/\D/g, '');
  return s.length >= 2 ? s : ('0' + s).slice(-2);
}

/** Lê um código e devolve suas partes */
function AP_LOC_partes(codigo) {
  var c = String(codigo || '').toUpperCase().trim();
  var r = { almoxarifado: null, rua: null, nivel: null, posicao: null, tipo: null };

  var a = c.match(/A(\d+)/); if (a) r.almoxarifado = Number(a[1]);
  var ru = c.match(/R(\d+)/); if (ru) r.rua = Number(ru[1]);
  var n = c.match(/N(\d+)/); if (n) r.nivel = Number(n[1]);
  var p = c.match(/P(\d+)/); if (p) r.posicao = Number(p[1]);

  if (r.posicao) r.tipo = 'POSICAO';
  else if (r.nivel) r.tipo = 'NIVEL';
  else if (r.rua) r.tipo = 'RUA';
  else if (r.almoxarifado) r.tipo = 'ALMOXARIFADO';

  return r;
}

/* ============================================================
   CRIAR ESTRUTURA
   ============================================================ */

/**
 * Cria uma rua inteira de uma vez.
 *
 * Dizendo "4 níveis, 5 posições cada", nascem 20 posições com
 * seus códigos prontos. Cadastrar uma a uma seria inviável num
 * almoxarifado de verdade.
 */
function AP_LOC_criarRua(dados, sessao) {
  var quem = (sessao && sessao.usuario) || 'sistema';

  var almox = Number(dados.almoxarifado) || 1;
  var rua = Number(dados.rua);
  var niveis = Number(dados.niveis) || 0;
  var posicoes = Number(dados.posicoesPorNivel) || 0;

  if (!rua) {
    return { ok: false, codigo: 'SEM_RUA', mensagem: 'Informe o número da rua.' };
  }
  if (niveis < 1 || posicoes < 1) {
    return {
      ok: false, codigo: 'ESTRUTURA_INVALIDA',
      mensagem: 'Informe quantos níveis e quantas posições por nível.'
    };
  }
  if (niveis > 20 || posicoes > 50) {
    return {
      ok: false, codigo: 'ESTRUTURA_GRANDE',
      mensagem: 'Limite: 20 níveis e 50 posições por nível. ' +
        'Estruturas maiores devem ser divididas em ruas.'
    };
  }

  var codigoRua = AP_LOC_codigo_({ almoxarifado: almox, rua: rua });
  var existentes = AP_Data_rows(AP_LOC_aba_()) || [];

  if (existentes.some(function (e) { return e.codigo === codigoRua; })) {
    return {
      ok: false, codigo: 'RUA_EXISTE',
      mensagem: 'A rua ' + codigoRua + ' já existe. Para mudar o tamanho dela, use "ajustarRua".'
    };
  }

  var agora = AP_Utils_now();
  var novos = [];

  /* o almoxarifado, se ainda não houver */
  var codigoAlmox = AP_LOC_codigo_({ almoxarifado: almox });
  if (!existentes.some(function (e) { return e.codigo === codigoAlmox; })) {
    novos.push({
      codigo: codigoAlmox, tipo: 'ALMOXARIFADO', pai: '',
      almoxarifado: almox, rua: '', nivel: '', posicao: '',
      nome: dados.nomeAlmoxarifado || ('Almoxarifado ' + AP_LOC_dois_(almox)),
      descricao: '', categoria: '', capacidade: '', status: 'DISPONIVEL',
      observacao: '', criadoEm: agora, criadoPor: quem, atualizadoEm: agora
    });
  }

  /* a rua */
  novos.push({
    codigo: codigoRua, tipo: 'RUA', pai: codigoAlmox,
    almoxarifado: almox, rua: rua, nivel: '', posicao: '',
    nome: dados.nome || ('Rua ' + AP_LOC_dois_(rua)),
    descricao: dados.descricao || '',
    categoria: dados.categoria || '',
    capacidade: niveis * posicoes,
    status: 'DISPONIVEL', observacao: '',
    criadoEm: agora, criadoPor: quem, atualizadoEm: agora
  });

  /* níveis e posições */
  for (var n = 1; n <= niveis; n++) {
    var codigoNivel = AP_LOC_codigo_({ almoxarifado: almox, rua: rua, nivel: n });

    novos.push({
      codigo: codigoNivel, tipo: 'NIVEL', pai: codigoRua,
      almoxarifado: almox, rua: rua, nivel: n, posicao: '',
      nome: 'Nível ' + AP_LOC_dois_(n), descricao: '',
      categoria: dados.categoria || '', capacidade: posicoes,
      status: 'DISPONIVEL', observacao: '',
      criadoEm: agora, criadoPor: quem, atualizadoEm: agora
    });

    for (var p = 1; p <= posicoes; p++) {
      novos.push({
        codigo: AP_LOC_codigo_({ almoxarifado: almox, rua: rua, nivel: n, posicao: p }),
        tipo: 'POSICAO', pai: codigoNivel,
        almoxarifado: almox, rua: rua, nivel: n, posicao: p,
        nome: 'Posição ' + AP_LOC_dois_(p), descricao: '',
        categoria: dados.categoria || '', capacidade: 1,
        status: 'DISPONIVEL', observacao: '',
        criadoEm: agora, criadoPor: quem, atualizadoEm: agora
      });
    }
  }

  /* grava tudo de uma vez — uma escrita, não 26 */
  AP_Data_appendBatch(AP_LOC_aba_(), novos);

  AP_Audit_log(quem, 'ESTRUTURA_CRIADA', 'LOCALIZACAO', codigoRua, {
    niveis: niveis, posicoesPorNivel: posicoes, total: novos.length
  });

  return {
    ok: true,
    dados: {
      rua: codigoRua,
      nome: dados.nome || ('Rua ' + AP_LOC_dois_(rua)),
      niveis: niveis,
      posicoesPorNivel: posicoes,
      posicoesCriadas: niveis * posicoes,
      registrosCriados: novos.length,
      primeiraPosicao: AP_LOC_codigo_({ almoxarifado: almox, rua: rua, nivel: 1, posicao: 1 }),
      ultimaPosicao: AP_LOC_codigo_({ almoxarifado: almox, rua: rua, nivel: niveis, posicao: posicoes })
    }
  };
}

/**
 * Muda o tamanho de uma rua que já existe.
 *
 * Acrescentar níveis é seguro. Reduzir só é permitido se as
 * posições que sumiriam estiverem vazias — apagar posição com
 * material dentro deixaria o estoque sem endereço.
 */
function AP_LOC_ajustarRua(dados, sessao) {
  var quem = (sessao && sessao.usuario) || 'sistema';
  var almox = Number(dados.almoxarifado) || 1;
  var rua = Number(dados.rua);
  var novosNiveis = Number(dados.niveis);
  var novasPosicoes = Number(dados.posicoesPorNivel);

  var codigoRua = AP_LOC_codigo_({ almoxarifado: almox, rua: rua });
  var todos = AP_Data_rows(AP_LOC_aba_()) || [];

  var aRua = todos.filter(function (e) { return e.codigo === codigoRua; })[0];
  if (!aRua) {
    return { ok: false, codigo: 'RUA_NAO_EXISTE', mensagem: 'A rua ' + codigoRua + ' não existe.' };
  }

  var posicoesAtuais = todos.filter(function (e) {
    return e.tipo === 'POSICAO' && String(e.almoxarifado) === String(almox) &&
      String(e.rua) === String(rua);
  });

  var niveisAtuais = Math.max.apply(null,
    posicoesAtuais.map(function (p) { return Number(p.nivel) || 0; }).concat([0]));
  var porNivelAtual = Math.max.apply(null,
    posicoesAtuais.map(function (p) { return Number(p.posicao) || 0; }).concat([0]));

  novosNiveis = novosNiveis || niveisAtuais;
  novasPosicoes = novasPosicoes || porNivelAtual;

  /* o que sumiria */
  var sumiriam = posicoesAtuais.filter(function (p) {
    return Number(p.nivel) > novosNiveis || Number(p.posicao) > novasPosicoes;
  });

  var ocupadas = sumiriam.filter(function (p) {
    return p.status === 'OCUPADA' || p.status === 'RESERVADA';
  });

  if (ocupadas.length && !dados.confirmarRemocao) {
    return {
      ok: false, codigo: 'POSICOES_OCUPADAS',
      mensagem: ocupadas.length + ' posição(ões) que seriam removidas têm material. ' +
        'Esvazie antes de reduzir a rua.',
      dados: { ocupadas: ocupadas.map(function (p) { return p.codigo; }) }
    };
  }

  var agora = AP_Utils_now();
  var criados = 0, removidos = 0;

  /* acrescenta o que falta */
  var novos = [];
  for (var n = 1; n <= novosNiveis; n++) {
    var codigoNivel = AP_LOC_codigo_({ almoxarifado: almox, rua: rua, nivel: n });

    if (!todos.some(function (e) { return e.codigo === codigoNivel; })) {
      novos.push({
        codigo: codigoNivel, tipo: 'NIVEL', pai: codigoRua,
        almoxarifado: almox, rua: rua, nivel: n, posicao: '',
        nome: 'Nível ' + AP_LOC_dois_(n), descricao: '',
        categoria: aRua.categoria || '', capacidade: novasPosicoes,
        status: 'DISPONIVEL', observacao: '',
        criadoEm: agora, criadoPor: quem, atualizadoEm: agora
      });
    }

    for (var p = 1; p <= novasPosicoes; p++) {
      var cod = AP_LOC_codigo_({ almoxarifado: almox, rua: rua, nivel: n, posicao: p });
      if (todos.some(function (e) { return e.codigo === cod; })) continue;

      novos.push({
        codigo: cod, tipo: 'POSICAO', pai: codigoNivel,
        almoxarifado: almox, rua: rua, nivel: n, posicao: p,
        nome: 'Posição ' + AP_LOC_dois_(p), descricao: '',
        categoria: aRua.categoria || '', capacidade: 1,
        status: 'DISPONIVEL', observacao: '',
        criadoEm: agora, criadoPor: quem, atualizadoEm: agora
      });
      criados++;
    }
  }

  if (novos.length) AP_Data_appendBatch(AP_LOC_aba_(), novos);

  /* remove o que sobrou */
  sumiriam.forEach(function (p) {
    AP_Data_remove(AP_LOC_aba_(), p.codigo, 'codigo');
    removidos++;
  });

  AP_Data_update(AP_LOC_aba_(), codigoRua, {
    capacidade: novosNiveis * novasPosicoes, atualizadoEm: agora
  }, 'codigo');

  AP_Audit_log(quem, 'ESTRUTURA_AJUSTADA', 'LOCALIZACAO', codigoRua, {
    de: niveisAtuais + 'x' + porNivelAtual,
    para: novosNiveis + 'x' + novasPosicoes,
    criados: criados, removidos: removidos
  });

  return {
    ok: true,
    dados: {
      rua: codigoRua,
      antes: { niveis: niveisAtuais, posicoesPorNivel: porNivelAtual },
      depois: { niveis: novosNiveis, posicoesPorNivel: novasPosicoes },
      posicoesCriadas: criados,
      posicoesRemovidas: removidos
    }
  };
}

/* ============================================================
   ARMAZENAR E RETIRAR
   ============================================================ */

/**
 * Guarda material numa posição.
 *
 * Não mexe no saldo do estoque: registra ONDE está. O quanto
 * existe continua sendo assunto do módulo de estoque.
 */
function AP_LOC_armazenar(dados, sessao) {
  var quem = (sessao && sessao.usuario) || 'sistema';

  if (!dados.localizacao) {
    return { ok: false, codigo: 'SEM_LOCALIZACAO', mensagem: 'Informe a posição.' };
  }
  if (!dados.sku) {
    return { ok: false, codigo: 'SEM_ITEM', mensagem: 'Informe o material.' };
  }

  var quantidade = Number(dados.quantidade) || 0;
  if (quantidade <= 0) {
    return { ok: false, codigo: 'QUANTIDADE_INVALIDA', mensagem: 'Informe uma quantidade maior que zero.' };
  }

  var pos = AP_Data_rows(AP_LOC_aba_()).filter(function (e) {
    return e.codigo === String(dados.localizacao).toUpperCase();
  })[0];

  if (!pos) {
    return {
      ok: false, codigo: 'LOCALIZACAO_NAO_EXISTE',
      mensagem: 'A posição ' + dados.localizacao + ' não está cadastrada. ' +
        'Crie a estrutura antes de armazenar.'
    };
  }

  if (pos.tipo !== 'POSICAO' && pos.tipo !== 'AREA') {
    return {
      ok: false, codigo: 'NAO_E_POSICAO',
      mensagem: pos.codigo + ' é ' + pos.tipo.toLowerCase() +
        ', não uma posição. Escolha uma posição para guardar o material.'
    };
  }

  if (pos.status === 'BLOQUEADA') {
    return {
      ok: false, codigo: 'POSICAO_BLOQUEADA',
      mensagem: 'A posição ' + pos.codigo + ' está bloqueada' +
        (pos.observacao ? ': ' + pos.observacao : '.') 
    };
  }

  /* o item precisa existir no cadastro */
  var item = null;
  try {
    var r = AP_Modulo_itens('obter', { sku: dados.sku }, sessao);
    if (r && r.ok) item = r.dados;
  } catch (e) { }

  if (!item) {
    return {
      ok: false, codigo: 'ITEM_NAO_CADASTRADO',
      mensagem: 'O item ' + dados.sku + ' não existe no cadastro.'
    };
  }

  /* mesmo item na mesma posição: soma */
  var jaTem = AP_Data_rows(AP_LOC_abaOcupacao_()).filter(function (o) {
    return o.localizacao === pos.codigo && o.sku === dados.sku;
  })[0];

  if (jaTem) {
    AP_Data_update(AP_LOC_abaOcupacao_(), jaTem.id, {
      quantidade: (Number(jaTem.quantidade) || 0) + quantidade,
      armazenadoEm: AP_Utils_now(),
      armazenadoPor: quem
    });
  } else {
    AP_Data_append(AP_LOC_abaOcupacao_(), {
      id: AP_Utils_generateId('OCP'),
      localizacao: pos.codigo,
      sku: dados.sku,
      descricao: item.descricao || '',
      quantidade: quantidade,
      unidade: item.unidade || 'un',
      lote: dados.lote || '',
      nf: dados.nf || '',
      armazenadoEm: AP_Utils_now(),
      armazenadoPor: quem,
      observacao: dados.observacao || ''
    });
  }

  /* a posição passa a ocupada */
  if (pos.status !== 'OCUPADA') {
    AP_Data_update(AP_LOC_aba_(), pos.codigo, {
      status: 'OCUPADA', atualizadoEm: AP_Utils_now()
    }, 'codigo');
  }

  AP_Audit_log(quem, 'MATERIAL_ARMAZENADO', 'LOCALIZACAO', pos.codigo, {
    sku: dados.sku, quantidade: quantidade
  });

  return {
    ok: true,
    dados: {
      localizacao: pos.codigo,
      sku: dados.sku,
      descricao: item.descricao,
      quantidade: quantidade,
      status: 'OCUPADA',
      somado: !!jaTem
    }
  };
}

/** O que existe numa posição */
function AP_LOC_conteudo(codigo) {
  var cod = String(codigo || '').toUpperCase();

  var pos = AP_Data_rows(AP_LOC_aba_()).filter(function (e) {
    return e.codigo === cod;
  })[0];

  if (!pos) {
    return {
      ok: false, codigo: 'NAO_EXISTE',
      mensagem: 'A localização ' + cod + ' não está cadastrada.'
    };
  }

  var itens = AP_Data_rows(AP_LOC_abaOcupacao_()).filter(function (o) {
    return o.localizacao === cod;
  });

  /* o saldo e a reserva vêm do estoque, não daqui */
  itens = itens.map(function (o) {
    var estoque = null;
    try {
      var r = AP_Modulo_estoque('item', { sku: o.sku });
      if (r && r.ok) estoque = r.dados;
    } catch (e) { }

    return {
      sku: o.sku,
      descricao: o.descricao,
      quantidadeNaPosicao: Number(o.quantidade) || 0,
      unidade: o.unidade,
      lote: o.lote, nf: o.nf,
      armazenadoEm: o.armazenadoEm,
      /* do estoque oficial */
      estoqueTotal: estoque ? Number(estoque.estoque) || 0 : null,
      reservado: estoque ? Number(estoque.reservado) || 0 : null,
      disponivel: estoque
        ? Math.max(0, (Number(estoque.estoque) || 0) - (Number(estoque.reservado) || 0))
        : null
    };
  });

  return {
    ok: true,
    dados: {
      codigo: pos.codigo,
      tipo: pos.tipo,
      nome: pos.nome,
      almoxarifado: pos.almoxarifado,
      rua: pos.rua, nivel: pos.nivel, posicao: pos.posicao,
      categoria: pos.categoria,
      status: pos.status,
      corStatus: (AP_LOC_CFG.status[pos.status] || {}).cor,
      observacao: pos.observacao,
      itens: itens,
      totalItens: itens.length
    }
  };
}

/** Onde está um material */
function AP_LOC_ondeEsta(sku) {
  var ocupacoes = AP_Data_rows(AP_LOC_abaOcupacao_()).filter(function (o) {
    return o.sku === sku;
  });

  if (!ocupacoes.length) {
    return {
      ok: true,
      dados: {
        sku: sku, encontrado: false, locais: [],
        /* nunca inventa uma posição */
        mensagem: 'Localização não cadastrada para este material.'
      }
    };
  }

  return {
    ok: true,
    dados: {
      sku: sku,
      encontrado: true,
      locais: ocupacoes.map(function (o) {
        var partes = AP_LOC_partes(o.localizacao);
        return {
          codigo: o.localizacao,
          quantidade: Number(o.quantidade) || 0,
          unidade: o.unidade,
          rua: partes.rua, nivel: partes.nivel, posicao: partes.posicao,
          armazenadoEm: o.armazenadoEm
        };
      }),
      quantidadeTotal: ocupacoes.reduce(function (s, o) {
        return s + (Number(o.quantidade) || 0);
      }, 0)
    }
  };
}

/* ============================================================
   A ESTRUTURA PARA O MAPA
   ============================================================ */

/**
 * Devolve a estrutura pronta para ser desenhada.
 *
 * O mapa não decide nada: ele recebe esta árvore e representa.
 * Se não houver estrutura, diz isso — em vez de desenhar um
 * almoxarifado que não existe.
 */
function AP_LOC_estrutura(filtro) {
  var todos = AP_Data_rows(AP_LOC_aba_()) || [];

  if (!todos.length) {
    return {
      ok: true,
      dados: {
        configurado: false,
        mensagem: 'Mapa 3D ainda não configurado.',
        proximoPasso: 'Crie a estrutura física: almoxarifado, ruas, níveis e posições.',
        almoxarifados: []
      }
    };
  }

  var ocupacoes = AP_Data_rows(AP_LOC_abaOcupacao_()) || [];
  var porPosicao = {};
  ocupacoes.forEach(function (o) {
    porPosicao[o.localizacao] = (porPosicao[o.localizacao] || 0) + 1;
  });

  var almoxarifados = todos.filter(function (e) { return e.tipo === 'ALMOXARIFADO'; });

  var arvore = almoxarifados.map(function (a) {
    var ruas = todos.filter(function (e) {
      return e.tipo === 'RUA' && String(e.almoxarifado) === String(a.almoxarifado);
    });

    return {
      codigo: a.codigo, nome: a.nome, tipo: 'ALMOXARIFADO',
      ruas: ruas.map(function (r) {
        var niveis = todos.filter(function (e) {
          return e.tipo === 'NIVEL' && String(e.almoxarifado) === String(a.almoxarifado) &&
            String(e.rua) === String(r.rua);
        }).sort(function (x, y) { return Number(x.nivel) - Number(y.nivel); });

        return {
          codigo: r.codigo, nome: r.nome, categoria: r.categoria, tipo: 'RUA',
          numero: Number(r.rua),
          niveis: niveis.map(function (n) {
            var posicoes = todos.filter(function (e) {
              return e.tipo === 'POSICAO' &&
                String(e.almoxarifado) === String(a.almoxarifado) &&
                String(e.rua) === String(r.rua) &&
                String(e.nivel) === String(n.nivel);
            }).sort(function (x, y) { return Number(x.posicao) - Number(y.posicao); });

            return {
              codigo: n.codigo, nome: n.nome, tipo: 'NIVEL',
              numero: Number(n.nivel),
              posicoes: posicoes.map(function (p) {
                return {
                  codigo: p.codigo, nome: p.nome, tipo: 'POSICAO',
                  numero: Number(p.posicao),
                  status: p.status,
                  cor: (AP_LOC_CFG.status[p.status] || {}).cor,
                  itens: porPosicao[p.codigo] || 0
                };
              })
            };
          })
        };
      })
    };
  });

  var posicoes = todos.filter(function (e) { return e.tipo === 'POSICAO'; });
  var conta = function (st) {
    return posicoes.filter(function (p) { return p.status === st; }).length;
  };

  return {
    ok: true,
    dados: {
      configurado: true,
      almoxarifados: arvore,
      resumo: {
        totalPosicoes: posicoes.length,
        ocupadas: conta('OCUPADA'),
        disponiveis: conta('DISPONIVEL'),
        reservadas: conta('RESERVADA'),
        bloqueadas: conta('BLOQUEADA'),
        ocupacaoPercentual: posicoes.length
          ? Math.round((conta('OCUPADA') / posicoes.length) * 100) : 0,
        ruas: todos.filter(function (e) { return e.tipo === 'RUA'; }).length,
        materiaisArmazenados: ocupacoes.length
      },
      cores: AP_LOC_CFG.status
    }
  };
}

/* ============================================================
   MÓDULO
   ============================================================ */

function AP_Modulo_localizacao(acao, payload, sessao) {
  payload = payload || {};

  try {
    switch (acao) {

      case 'estrutura':
        return AP_LOC_estrutura(payload);

      case 'criarRua':
        return AP_LOC_criarRua(payload, sessao);

      case 'ajustarRua':
        return AP_LOC_ajustarRua(payload, sessao);

      case 'conteudo':
        return AP_LOC_conteudo(payload.codigo || payload.localizacao);

      case 'armazenar':
        return AP_LOC_armazenar(payload, sessao);

      case 'ondeEsta':
        if (!payload.sku) return { ok: false, codigo: 'SEM_SKU', mensagem: 'Informe o material.' };
        return AP_LOC_ondeEsta(payload.sku);

      case 'partes':
        return { ok: true, dados: AP_LOC_partes(payload.codigo) };

      /** Bloqueia ou libera uma posição */
      case 'status': {
        if (!payload.codigo || !payload.status) {
          return { ok: false, codigo: 'DADOS_INCOMPLETOS', mensagem: 'Informe a posição e o novo estado.' };
        }
        if (!AP_LOC_CFG.status[payload.status]) {
          return {
            ok: false, codigo: 'STATUS_INVALIDO',
            mensagem: 'Estado desconhecido. Use: ' + Object.keys(AP_LOC_CFG.status).join(', ')
          };
        }

        var pos = AP_Data_rows(AP_LOC_aba_()).filter(function (e) {
          return e.codigo === payload.codigo;
        })[0];
        if (!pos) return { ok: false, codigo: 'NAO_EXISTE', mensagem: 'Posição não cadastrada.' };

        /* não deixa marcar como disponível o que tem material */
        if (payload.status === 'DISPONIVEL') {
          var tem = AP_Data_rows(AP_LOC_abaOcupacao_()).filter(function (o) {
            return o.localizacao === payload.codigo;
          }).length;
          if (tem) {
            return {
              ok: false, codigo: 'POSICAO_COM_MATERIAL',
              mensagem: 'Esta posição tem ' + tem + ' material(is). Retire antes de marcá-la como disponível.'
            };
          }
        }

        AP_Data_update(AP_LOC_aba_(), payload.codigo, {
          status: payload.status,
          observacao: payload.observacao || pos.observacao || '',
          atualizadoEm: AP_Utils_now()
        }, 'codigo');

        AP_Audit_log((sessao && sessao.usuario) || 'sistema',
          'LOCALIZACAO_' + payload.status, 'LOCALIZACAO', payload.codigo,
          { de: pos.status, para: payload.status, motivo: payload.observacao || '' });

        return { ok: true, dados: { codigo: payload.codigo, status: payload.status } };
      }

      case 'listar': {
        var lista = AP_Data_rows(AP_LOC_aba_()) || [];
        if (payload.tipo) lista = lista.filter(function (e) { return e.tipo === payload.tipo; });
        if (payload.status) lista = lista.filter(function (e) { return e.status === payload.status; });
        return { ok: true, dados: lista };
      }

      case 'versao':
        return {
          ok: true,
          dados: {
            modulo: 'LOCALIZACAO_FISICA', versao: AP_LOC_CFG.versao,
            tipos: AP_LOC_CFG.tipos, status: Object.keys(AP_LOC_CFG.status)
          }
        };

      default:
        return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'localizacao.' + acao + ' não existe.' };
    }
  } catch (e) {
    AP_ErrorHandler_capture('AP_Modulo_localizacao:' + acao, e);
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'localizacao', acao: acao, mensagem: e.message };
  }
}

/* ============================================================
   TESTE — o da seção 36 do documento
   ============================================================ */
function testeLocalizacaoFisica() {
  var log = [];
  function reg(t, ok, d) { log.push((ok ? 'OK    ' : 'ERRO  ') + t + (d ? ' — ' + d : '')); }

  var sessao = { usuario: 'ismael', perfil: 'admin' };

  try {
    /* ---------- SEM ESTRUTURA ---------- */
    var vazio = AP_LOC_estrutura({});
    reg('sem estrutura, avisa em vez de quebrar',
      vazio.ok && vazio.dados.configurado === false,
      vazio.dados.mensagem);

    /* ---------- O TESTE DO DOCUMENTO ---------- */
    var rua1 = AP_LOC_criarRua({
      almoxarifado: 1, rua: 1, nome: 'Rua 01 - Hidráulica',
      categoria: 'Hidráulica', niveis: 4, posicoesPorNivel: 5
    }, sessao);

    reg('cria a rua com 4 níveis e 5 posições', rua1.ok,
      rua1.ok ? rua1.dados.posicoesCriadas + ' posições' : rua1.mensagem);
    reg('gerou 20 posições', rua1.ok && rua1.dados.posicoesCriadas === 20, '4 × 5');
    reg('o código sai no formato certo',
      rua1.ok && rua1.dados.primeiraPosicao === 'A01-R01-N01-P01',
      rua1.ok ? rua1.dados.primeiraPosicao + ' … ' + rua1.dados.ultimaPosicao : '');

    var repetida = AP_LOC_criarRua({ almoxarifado: 1, rua: 1, niveis: 2, posicoesPorNivel: 2 }, sessao);
    reg('não cria rua repetida', repetida.ok === false && repetida.codigo === 'RUA_EXISTE', '');

    /* ---------- SEGUNDA RUA ---------- */
    var rua2 = AP_LOC_criarRua({
      almoxarifado: 1, rua: 2, nome: 'Rua 02 - Elétrica',
      categoria: 'Elétrica', niveis: 3, posicoesPorNivel: 6
    }, sessao);
    reg('cria a segunda rua', rua2.ok && rua2.dados.posicoesCriadas === 18, '3 × 6');

    var est = AP_LOC_estrutura({});
    reg('a estrutura agora existe', est.dados.configurado === true, '');
    reg('tem as duas ruas', est.dados.resumo.ruas === 2, est.dados.resumo.ruas + ' ruas');
    reg('conta as posições', est.dados.resumo.totalPosicoes === 38, '20 + 18');
    reg('todas começam disponíveis',
      est.dados.resumo.disponiveis === 38 && est.dados.resumo.ocupadas === 0, '');

    /* a árvore chega montada para o mapa desenhar */
    var arvore = est.dados.almoxarifados[0];
    reg('a árvore vem montada',
      arvore.ruas.length === 2 &&
      arvore.ruas[0].niveis.length === 4 &&
      arvore.ruas[0].niveis[0].posicoes.length === 5,
      'almoxarifado → 2 ruas → 4 níveis → 5 posições');

    /* ---------- ARMAZENAR ---------- */
    AP_Modulo_categorias('salvar', { nome: 'Hidráulica' });
    var item = AP_Modulo_itens('salvar', {
      descricao: 'JOELHO SOLDAVEL 25 MM', categoria: 'Hidráulica',
      unidade: 'un', valorUnitario: 3.5
    }, sessao);
    AP_Modulo_estoque('entrada', { sku: item.dados.sku, qtd: 50, documento: 'NF 000123' });

    var guardou = AP_LOC_armazenar({
      localizacao: 'A01-R01-N02-P03', sku: item.dados.sku,
      quantidade: 50, nf: '000123'
    }, sessao);
    reg('guarda o material na posição', guardou.ok,
      guardou.ok ? guardou.dados.localizacao : guardou.mensagem);

    var conteudo = AP_LOC_conteudo('A01-R01-N02-P03');
    reg('a posição fica OCUPADA', conteudo.ok && conteudo.dados.status === 'OCUPADA', '');
    reg('o material aparece lá',
      conteudo.ok && conteudo.dados.itens.length === 1 &&
      conteudo.dados.itens[0].quantidadeNaPosicao === 50,
      conteudo.ok ? conteudo.dados.itens[0].descricao : '');
    reg('traz o saldo do ESTOQUE, não o daqui',
      conteudo.ok && conteudo.dados.itens[0].estoqueTotal === 50,
      'estoque total ' + conteudo.dados.itens[0].estoqueTotal);

    /* ---------- ENCONTRAR ---------- */
    var onde = AP_LOC_ondeEsta(item.dados.sku);
    reg('encontra onde o material está',
      onde.ok && onde.dados.encontrado && onde.dados.locais[0].codigo === 'A01-R01-N02-P03',
      onde.dados.locais[0].codigo);

    var semLocal = AP_LOC_ondeEsta('SKU-SEM-LOCAL');
    reg('material sem endereço NÃO ganha um inventado',
      semLocal.ok && semLocal.dados.encontrado === false,
      semLocal.dados.mensagem);

    /* ---------- O QUE NÃO PODE ---------- */
    var posicaoFalsa = AP_LOC_armazenar({
      localizacao: 'A09-R09-N09-P09', sku: item.dados.sku, quantidade: 1
    }, sessao);
    reg('recusa posição inexistente',
      posicaoFalsa.ok === false && posicaoFalsa.codigo === 'LOCALIZACAO_NAO_EXISTE', '');

    var itemFalso = AP_LOC_armazenar({
      localizacao: 'A01-R01-N01-P01', sku: 'NAO-EXISTE', quantidade: 1
    }, sessao);
    reg('recusa item que não está no cadastro',
      itemFalso.ok === false && itemFalso.codigo === 'ITEM_NAO_CADASTRADO', '');

    var naRua = AP_LOC_armazenar({
      localizacao: 'A01-R01', sku: item.dados.sku, quantidade: 1
    }, sessao);
    reg('não deixa guardar numa rua, só em posição',
      naRua.ok === false && naRua.codigo === 'NAO_E_POSICAO', naRua.mensagem.slice(0, 50));

    /* ---------- BLOQUEIO ---------- */
    AP_Modulo_localizacao('status', {
      codigo: 'A01-R01-N01-P05', status: 'BLOQUEADA', observacao: 'prateleira danificada'
    }, sessao);

    var bloqueada = AP_LOC_armazenar({
      localizacao: 'A01-R01-N01-P05', sku: item.dados.sku, quantidade: 1
    }, sessao);
    reg('não guarda em posição bloqueada',
      bloqueada.ok === false && bloqueada.codigo === 'POSICAO_BLOQUEADA',
      bloqueada.mensagem.slice(0, 55));

    var liberar = AP_Modulo_localizacao('status', {
      codigo: 'A01-R01-N02-P03', status: 'DISPONIVEL'
    }, sessao);
    reg('não marca como disponível posição com material',
      liberar.ok === false && liberar.codigo === 'POSICAO_COM_MATERIAL',
      liberar.mensagem.slice(0, 50));

    /* ---------- O TESTE DE ALTERAÇÃO (seção 37) ---------- */
    var ajuste = AP_LOC_ajustarRua({
      almoxarifado: 1, rua: 1, niveis: 5, posicoesPorNivel: 5
    }, sessao);
    reg('aumenta a rua de 4 para 5 níveis', ajuste.ok,
      ajuste.ok ? '+' + ajuste.dados.posicoesCriadas + ' posições' : ajuste.mensagem);

    var depois = AP_LOC_conteudo('A01-R01-N02-P03');
    reg('AS POSIÇÕES ANTIGAS CONTINUAM INTACTAS',
      depois.ok && depois.dados.status === 'OCUPADA' && depois.dados.itens.length === 1,
      'material segue no lugar');

    var novaPos = AP_LOC_conteudo('A01-R01-N05-P05');
    reg('a posição nova existe', novaPos.ok && novaPos.dados.status === 'DISPONIVEL', '');

    /* reduzir com material dentro é recusado */
    var reducao = AP_LOC_ajustarRua({ almoxarifado: 1, rua: 1, niveis: 1, posicoesPorNivel: 2 }, sessao);
    reg('NÃO REDUZ a rua com material nas posições',
      reducao.ok === false && reducao.codigo === 'POSICOES_OCUPADAS',
      reducao.mensagem.slice(0, 55));

    /* ---------- CÓDIGOS ---------- */
    var partes = AP_LOC_partes('A01-R02-N03-P04');
    reg('lê o código de volta',
      partes.almoxarifado === 1 && partes.rua === 2 && partes.nivel === 3 &&
      partes.posicao === 4 && partes.tipo === 'POSICAO', 'A01-R02-N03-P04');

    var partesRua = AP_LOC_partes('A01-R02');
    reg('reconhece o tipo pelo código', partesRua.tipo === 'RUA', '');

  } catch (e) {
    log.push('ERRO  exceção: ' + e.message);
  }

  try { Logger.log(log.join('\n')); } catch (e) { }
  return log;
}


/* ============================================================
   MÓDULO "locais" — o que a tela do sistema chama
   ------------------------------------------------------------
   A tela de Localizações já existia e usa outro vocabulário:
   RUA · ESTANTE · PRATELEIRA · POSIÇÃO
   
   O motor acima usa ALMOXARIFADO · RUA · NÍVEL · POSIÇÃO.
   
   São a mesma coisa com nomes diferentes: estante é a divisão
   dentro da rua, prateleira é a altura. Aqui os dois vocabulários
   se encontram, sem duplicar a estrutura.
   ============================================================ */

var AP_LOCAIS_CFG = {
  aba: 'ALMOXA_LOCALIZACOES',
  colunas: ['id', 'rua', 'estante', 'prateleira', 'posicao', 'codigo',
    'capacidade', 'ocupacao', 'status', 'observacao', 'criadoEm', 'criadoPor']
};

function AP_LOCAIS_aba_() {
  AP_Data_getSheet(AP_LOCAIS_CFG.aba, AP_LOCAIS_CFG.colunas);
  return AP_LOCAIS_CFG.aba;
}

/** RUA 01 · ESTANTE A01 · PRATELEIRA P01 · POSIÇÃO 01 → 01-A01-P01-01 */
function AP_LOCAIS_codigo_(d) {
  return [d.rua, d.estante, d.prateleira, d.posicao]
    .filter(function (p) { return p; })
    .map(function (p) { return String(p).toUpperCase().trim(); })
    .join('-');
}

function AP_Modulo_locais(acao, payload, sessao) {
  payload = payload || {};
  var quem = (sessao && sessao.usuario) || 'sistema';

  try {
    switch (acao) {

      case 'listar': {
        var todos = AP_Data_rows(AP_LOCAIS_aba_()) || [];

        /* quantos itens estão em cada local */
        var ocupacoes = {};
        try {
          (AP_Data_rows(AP_LOC_abaOcupacao_()) || []).forEach(function (o) {
            ocupacoes[o.localizacao] = (ocupacoes[o.localizacao] || 0) + 1;
          });
        } catch (e) { }

        return {
          ok: true,
          dados: todos.map(function (l) {
            return Object.assign({}, l, { itens: ocupacoes[l.codigo] || 0 });
          })
        };
      }

      case 'salvar': {
        if (!payload.rua) {
          return { ok: false, codigo: 'SEM_RUA', mensagem: 'Informe a rua.' };
        }

        var codigo = AP_LOCAIS_codigo_(payload);

        var existente = (AP_Data_rows(AP_LOCAIS_aba_()) || []).filter(function (l) {
          return l.codigo === codigo;
        })[0];

        if (existente && !payload.id) {
          return {
            ok: false, codigo: 'JA_EXISTE',
            mensagem: 'A localização ' + codigo + ' já está cadastrada.'
          };
        }

        var agora = AP_Utils_now();

        if (payload.id) {
          AP_Data_update(AP_LOCAIS_aba_(), payload.id, {
            rua: String(payload.rua).toUpperCase(),
            estante: String(payload.estante || '').toUpperCase(),
            prateleira: String(payload.prateleira || '').toUpperCase(),
            posicao: String(payload.posicao || '').toUpperCase(),
            codigo: codigo,
            capacidade: payload.capacidade || '',
            observacao: payload.observacao || ''
          });

          AP_Audit_log(quem, 'LOCALIZACAO_ALTERADA', 'LOCAIS', codigo, {});
          return { ok: true, dados: { id: payload.id, codigo: codigo }, atualizado: true };
        }

        var novo = {
          id: AP_Utils_generateId('LOC'),
          rua: String(payload.rua).toUpperCase(),
          estante: String(payload.estante || '').toUpperCase(),
          prateleira: String(payload.prateleira || '').toUpperCase(),
          posicao: String(payload.posicao || '').toUpperCase(),
          codigo: codigo,
          capacidade: payload.capacidade || '',
          ocupacao: 0,
          status: 'DISPONIVEL',
          observacao: payload.observacao || '',
          criadoEm: agora, criadoPor: quem
        };

        AP_Data_append(AP_LOCAIS_aba_(), novo);
        AP_Audit_log(quem, 'LOCALIZACAO_CRIADA', 'LOCAIS', codigo, {});

        return { ok: true, dados: novo };
      }

      /**
       * Cria uma faixa de localizações de uma vez.
       *
       * Cadastrar posição por posição num almoxarifado de verdade
       * é inviável: 4 prateleiras × 10 posições são 40 cadastros.
       */
      case 'criarFaixa': {
        if (!payload.rua) return { ok: false, codigo: 'SEM_RUA', mensagem: 'Informe a rua.' };

        var prateleiras = Number(payload.prateleiras) || 0;
        var posicoes = Number(payload.posicoes) || 0;

        if (prateleiras < 1 || posicoes < 1) {
          return {
            ok: false, codigo: 'DADOS_INCOMPLETOS',
            mensagem: 'Informe quantas prateleiras e quantas posições por prateleira.'
          };
        }
        if (prateleiras * posicoes > 500) {
          return {
            ok: false, codigo: 'FAIXA_GRANDE',
            mensagem: 'São ' + (prateleiras * posicoes) + ' localizações de uma vez. ' +
              'O limite é 500 — divida em estantes.'
          };
        }

        var existentes = {};
        (AP_Data_rows(AP_LOCAIS_aba_()) || []).forEach(function (l) {
          existentes[l.codigo] = true;
        });

        var novos = [], pulados = 0;
        var quando = AP_Utils_now();

        for (var pr = 1; pr <= prateleiras; pr++) {
          for (var po = 1; po <= posicoes; po++) {
            var d = {
              rua: String(payload.rua).toUpperCase(),
              estante: String(payload.estante || '').toUpperCase(),
              prateleira: 'P' + ('0' + pr).slice(-2),
              posicao: ('0' + po).slice(-2)
            };
            var cod = AP_LOCAIS_codigo_(d);

            if (existentes[cod]) { pulados++; continue; }

            novos.push({
              id: AP_Utils_generateId('LOC'),
              rua: d.rua, estante: d.estante,
              prateleira: d.prateleira, posicao: d.posicao,
              codigo: cod,
              capacidade: payload.capacidade || '',
              ocupacao: 0, status: 'DISPONIVEL', observacao: '',
              criadoEm: quando, criadoPor: quem
            });
            existentes[cod] = true;
          }
        }

        if (novos.length) AP_Data_appendBatch(AP_LOCAIS_aba_(), novos);

        AP_Audit_log(quem, 'LOCALIZACOES_CRIADAS', 'LOCAIS', payload.rua, {
          criadas: novos.length, jaExistiam: pulados
        });

        return {
          ok: true,
          dados: {
            criadas: novos.length,
            jaExistiam: pulados,
            primeira: novos.length ? novos[0].codigo : null,
            ultima: novos.length ? novos[novos.length - 1].codigo : null
          }
        };
      }

      case 'excluir': {
        if (!payload.id) return { ok: false, codigo: 'SEM_ID', mensagem: 'Informe a localização.' };

        var local = (AP_Data_rows(AP_LOCAIS_aba_()) || []).filter(function (l) {
          return l.id === payload.id;
        })[0];

        if (!local) return { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Localização não existe.' };

        /* material sem endereço é pior que endereço a mais */
        var comMaterial = 0;
        try {
          comMaterial = (AP_Data_rows(AP_LOC_abaOcupacao_()) || []).filter(function (o) {
            return o.localizacao === local.codigo;
          }).length;
        } catch (e) { }

        if (comMaterial) {
          return {
            ok: false, codigo: 'TEM_MATERIAL',
            mensagem: 'Esta localização tem ' + comMaterial +
              ' material(is) guardado(s). Retire antes de excluir.'
          };
        }

        AP_Data_remove(AP_LOCAIS_aba_(), payload.id);
        AP_Audit_log(quem, 'LOCALIZACAO_EXCLUIDA', 'LOCAIS', local.codigo, {});

        return { ok: true, dados: { id: payload.id, codigo: local.codigo } };
      }

      /**
       * Liga um item a uma localização.
       *
       * É o que a tela "Definir localização" chama. Sem esta ação,
       * o botão não fazia nada.
       */
      case 'vincular': {
        if (!payload.sku) {
          return { ok: false, codigo: 'SEM_ITEM', mensagem: 'Informe o material.' };
        }
        if (!payload.localId && !payload.codigo) {
          return { ok: false, codigo: 'SEM_LOCAL', mensagem: 'Escolha a localização.' };
        }

        var oLocal = (AP_Data_rows(AP_LOCAIS_aba_()) || []).filter(function (l) {
          return l.id === payload.localId || l.codigo === payload.codigo;
        })[0];

        if (!oLocal) {
          return {
            ok: false, codigo: 'LOCAL_NAO_EXISTE',
            mensagem: 'Esta localização não está cadastrada.'
          };
        }

        /* o item precisa existir */
        var oItem = null;
        try {
          var ri = AP_Modulo_itens('obter', { sku: payload.sku }, sessao);
          if (ri && ri.ok) oItem = ri.dados;
        } catch (e) { }

        if (!oItem) {
          return {
            ok: false, codigo: 'ITEM_NAO_CADASTRADO',
            mensagem: 'O item ' + payload.sku + ' não existe no cadastro.'
          };
        }

        /* já está ligado a esta mesma localização? */
        var jaLigado = (AP_Data_rows(AP_LOC_abaOcupacao_()) || []).filter(function (o) {
          return o.sku === payload.sku && o.localizacao === oLocal.codigo;
        })[0];

        if (jaLigado) {
          return {
            ok: true,
            dados: { sku: payload.sku, localizacao: oLocal.codigo, jaEstava: true },
            mensagem: 'Este item já estava nesta localização.'
          };
        }

        /* o saldo do estoque é o que vai para o endereço */
        var quantidade = Number(payload.quantidade) || 0;
        if (!quantidade) {
          try {
            var re = AP_Modulo_estoque('item', { sku: payload.sku }, sessao);
            if (re && re.ok) quantidade = Number(re.dados.estoque) || 0;
          } catch (e) { }
        }

        AP_Data_append(AP_LOC_abaOcupacao_(), {
          id: AP_Utils_generateId('OCP'),
          localizacao: oLocal.codigo,
          sku: payload.sku,
          descricao: oItem.descricao || '',
          quantidade: quantidade,
          unidade: oItem.unidade || 'un',
          lote: payload.lote || '',
          nf: payload.nf || '',
          armazenadoEm: AP_Utils_now(),
          armazenadoPor: quem,
          observacao: payload.observacao || ''
        });

        /* a localização passa a ocupada */
        if (oLocal.status !== 'OCUPADA') {
          AP_Data_update(AP_LOCAIS_aba_(), oLocal.id, {
            status: 'OCUPADA', ocupacao: (Number(oLocal.ocupacao) || 0) + 1
          });
        }

        AP_Audit_log(quem, 'ITEM_LOCALIZADO', 'LOCAIS', oLocal.codigo, {
          sku: payload.sku, quantidade: quantidade
        });

        return {
          ok: true,
          dados: {
            sku: payload.sku,
            descricao: oItem.descricao,
            localizacao: oLocal.codigo,
            quantidade: quantidade,
            unidade: oItem.unidade || 'un'
          }
        };
      }

      /** Tira o item de uma localização */
      case 'desvincular': {
        if (!payload.sku) return { ok: false, codigo: 'SEM_ITEM', mensagem: 'Informe o material.' };

        var ligacoes = (AP_Data_rows(AP_LOC_abaOcupacao_()) || []).filter(function (o) {
          return o.sku === payload.sku &&
            (!payload.codigo || o.localizacao === payload.codigo);
        });

        if (!ligacoes.length) {
          return { ok: false, codigo: 'NAO_LOCALIZADO', mensagem: 'Este item não está em nenhuma localização.' };
        }

        var locaisAfetados = {};
        ligacoes.forEach(function (o) {
          locaisAfetados[o.localizacao] = true;
          AP_Data_remove(AP_LOC_abaOcupacao_(), o.id);
        });

        /* localização que ficou vazia volta a disponível */
        var aindaOcupadas = {};
        (AP_Data_rows(AP_LOC_abaOcupacao_()) || []).forEach(function (o) {
          aindaOcupadas[o.localizacao] = true;
        });

        Object.keys(locaisAfetados).forEach(function (cod) {
          if (aindaOcupadas[cod]) return;
          var l = (AP_Data_rows(AP_LOCAIS_aba_()) || []).filter(function (x) {
            return x.codigo === cod;
          })[0];
          if (l) AP_Data_update(AP_LOCAIS_aba_(), l.id, { status: 'DISPONIVEL', ocupacao: 0 });
        });

        AP_Audit_log(quem, 'ITEM_DESLOCALIZADO', 'LOCAIS', payload.sku, {
          locais: Object.keys(locaisAfetados).join(', ')
        });

        return { ok: true, dados: { sku: payload.sku, removidoDe: Object.keys(locaisAfetados) } };
      }

      /** Itens do cadastro que ainda não têm endereço */
      case 'semLocalizacao': {
        var comLocal = {};
        try {
          (AP_Data_rows(AP_LOC_abaOcupacao_()) || []).forEach(function (o) {
            comLocal[o.sku] = true;
          });
        } catch (e) { }

        var itens = [];
        try {
          var r = AP_Modulo_itens('listar', {}, sessao);
          itens = (r && r.ok) ? r.dados : [];
        } catch (e) { }

        return {
          ok: true,
          dados: itens.filter(function (i) { return !comLocal[i.sku]; })
            .map(function (i) {
              return { sku: i.sku, descricao: i.descricao, categoria: i.categoria };
            })
        };
      }

      case 'obter': {
        var achada = (AP_Data_rows(AP_LOCAIS_aba_()) || []).filter(function (l) {
          return l.id === payload.id || l.codigo === payload.codigo;
        })[0];

        if (!achada) return { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Localização não existe.' };

        /* o que está guardado nela */
        var itens = [];
        try {
          itens = (AP_Data_rows(AP_LOC_abaOcupacao_()) || []).filter(function (o) {
            return o.localizacao === achada.codigo;
          });
        } catch (e) { }

        return { ok: true, dados: Object.assign({}, achada, { itens: itens }) };
      }

      default:
        return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'locais.' + acao + ' não existe.' };
    }
  } catch (e) {
    AP_ErrorHandler_capture('AP_Modulo_locais:' + acao, e);
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'locais', acao: acao, mensagem: e.message };
  }
}

/* ============================================================
   TESTE DO MÓDULO locais
   ============================================================ */
function testeLocais() {
  var log = [];
  function reg(t, ok, d) { log.push((ok ? 'OK    ' : 'ERRO  ') + t + (d ? ' — ' + d : '')); }
  var sessao = { usuario: 'ismael', perfil: 'admin' };

  try {
    var um = AP_Modulo_locais('salvar', {
      rua: '01', estante: 'A01', prateleira: 'P01', posicao: '01', capacidade: 10
    }, sessao);
    reg('cadastra uma localização', um.ok, um.ok ? um.dados.codigo : um.mensagem);
    reg('o código sai montado', um.ok && um.dados.codigo === '01-A01-P01-01', '');

    var repetida = AP_Modulo_locais('salvar', {
      rua: '01', estante: 'A01', prateleira: 'P01', posicao: '01'
    }, sessao);
    reg('não cadastra repetida', repetida.ok === false && repetida.codigo === 'JA_EXISTE', '');

    var semRua = AP_Modulo_locais('salvar', { estante: 'A02' }, sessao);
    reg('exige a rua', semRua.ok === false && semRua.codigo === 'SEM_RUA', '');

    var faixa = AP_Modulo_locais('criarFaixa', {
      rua: '02', estante: 'A01', prateleiras: 4, posicoes: 10
    }, sessao);
    reg('cria 40 de uma vez', faixa.ok && faixa.dados.criadas === 40,
      faixa.ok ? faixa.dados.primeira + ' … ' + faixa.dados.ultima : faixa.mensagem);

    var denovo = AP_Modulo_locais('criarFaixa', {
      rua: '02', estante: 'A01', prateleiras: 4, posicoes: 10
    }, sessao);
    reg('não duplica ao repetir a faixa',
      denovo.ok && denovo.dados.criadas === 0 && denovo.dados.jaExistiam === 40, '');

    var grande = AP_Modulo_locais('criarFaixa', {
      rua: '99', prateleiras: 30, posicoes: 30
    }, sessao);
    reg('recusa faixa grande demais',
      grande.ok === false && grande.codigo === 'FAIXA_GRANDE', grande.mensagem.slice(0, 50));

    var lista = AP_Modulo_locais('listar', {}, sessao);
    reg('lista as localizações', lista.ok && lista.dados.length === 41,
      lista.dados.length + ' cadastradas');

    /* excluir com material dentro */
    AP_Modulo_categorias('salvar', { nome: 'Hidráulica' });
    var item = AP_Modulo_itens('salvar', {
      descricao: 'TUBO PVC 100', categoria: 'Hidráulica', unidade: 'm', valorUnitario: 30
    }, sessao);
    AP_Modulo_estoque('entrada', { sku: item.dados.sku, qtd: 20, documento: 'NF' });

    AP_Data_append(AP_LOC_abaOcupacao_(), {
      id: AP_Utils_generateId('OCP'), localizacao: '01-A01-P01-01',
      sku: item.dados.sku, descricao: 'TUBO PVC 100', quantidade: 20,
      unidade: 'm', lote: '', nf: '', armazenadoEm: AP_Utils_now(),
      armazenadoPor: 'teste', observacao: ''
    });

    var excluir = AP_Modulo_locais('excluir', { id: um.dados.id }, sessao);
    reg('NÃO EXCLUI localização com material',
      excluir.ok === false && excluir.codigo === 'TEM_MATERIAL',
      excluir.mensagem.slice(0, 50));

    var comItens = AP_Modulo_locais('listar', {}, sessao);
    var aOcupada = comItens.dados.filter(function (l) { return l.codigo === '01-A01-P01-01'; })[0];
    reg('a listagem mostra quantos itens tem', aOcupada && aOcupada.itens === 1, '');

    var sem = AP_Modulo_locais('semLocalizacao', {}, sessao);
    reg('mostra itens sem endereço', sem.ok, sem.dados.length + ' item(ns)');

  } catch (e) {
    log.push('ERRO  exceção: ' + e.message);
  }

  try { Logger.log(log.join('\n')); } catch (e) { }
  return log;
}
