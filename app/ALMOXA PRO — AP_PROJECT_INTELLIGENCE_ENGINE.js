/**
 * ============================================================
 * ALMOXA PRO — AP_PROJECT_INTELLIGENCE_ENGINE
 * Versão 1.0.0
 * ------------------------------------------------------------
 * O MOTOR QUE ENTENDE O PROJETO
 *
 * Este motor lê o que está escrito na legenda da planta e procura
 * o produto correspondente no Cadastro Central.
 *
 * Ele NÃO grava nada. Toda gravação passa pelo Core.
 * Ele NÃO inventa SKU. Quando não tem certeza, diz que não tem.
 *
 * ------------------------------------------------------------
 * POR QUE NÃO BASTA COMPARAR NOMES
 *
 *   "JOELHO GALV 90 2"      e   "JOELHO GALVANIZADO 90° 2\""
 *   são o mesmo produto.
 *
 *   "JOELHO GALV 90 2""     e   "JOELHO GALV 90 3\""
 *   são 87% parecidos no nome — e são produtos DIFERENTES.
 *
 * Por isso a comparação é por ATRIBUTOS: tipo, material, ângulo,
 * diâmetro, unidade. Uma diferença de diâmetro derruba a
 * correspondência, por mais parecido que o nome seja.
 * ============================================================
 */

var AP_PIE_CFG = {
  versao: '1.0.0',

  /* Faixas de confiança — vindas da seção 8 do documento */
  faixas: {
    muitoForte: 95,   /* 95 a 100: correspondência muito forte */
    provavel: 75,     /* 75 a 94:  provável, confirmar */
    possivel: 50      /* 50 a 74:  possível, revisar
                         abaixo de 50: sem correspondência confiável */
  },

  /* Peso de cada atributo na conta final.
     Diâmetro e ângulo pesam mais que o nome de propósito: são eles
     que separam produtos parecidos. */
  pesos: {
    codigo: 30,       /* código igual é evidência forte */
    tipo: 20,
    diametro: 20,
    material: 12,
    angulo: 8,
    unidade: 5,
    texto: 5
  },

  /* Atributos que, quando conflitam, DERRUBAM a correspondência.
     Não adianta o nome ser parecido: 2" e 3" não são o mesmo item. */
  bloqueantes: ['diametro', 'angulo', 'bitola']
};

/* ============================================================
   NORMALIZAÇÃO
   ============================================================ */

/** Tira acento, pontuação e espaço sobrando */
function AP_PIE_normalizar_(texto) {
  return String(texto || '')
    .toUpperCase()
    .replace(/[ÁÀÂÃÄ]/g, 'A').replace(/[ÉÈÊË]/g, 'E').replace(/[ÍÌÎÏ]/g, 'I')
    .replace(/[ÓÒÔÕÖ]/g, 'O').replace(/[ÚÙÛÜ]/g, 'U').replace(/Ç/g, 'C')
    .replace(/[.,;:()\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Abreviações usadas em planta.
 * A lista é conservadora: só entra o que é inequívoco no contexto
 * de obra. "CX" pode ser caixa ou conexão — fica de fora.
 */
var AP_PIE_ABREVIACOES = {
  'GALV': 'GALVANIZADO', 'GALV.': 'GALVANIZADO',
  'INOX': 'INOXIDAVEL',
  'PVC': 'PVC', 'CPVC': 'CPVC', 'PPR': 'PPR',
  'FG': 'FERRO GALVANIZADO', 'FF': 'FERRO FUNDIDO',
  'JG': 'JOELHO GALVANIZADO', 'JOELH': 'JOELHO',
  'TE': 'TE', 'RED': 'REDUCAO', 'RED.': 'REDUCAO',
  'CURV': 'CURVA', 'CV': 'CURVA',
  'VLV': 'VALVULA', 'VALV': 'VALVULA', 'VALV.': 'VALVULA',
  'REG': 'REGISTRO', 'REG.': 'REGISTRO',
  'CONX': 'CONEXAO', 'CON': 'CONEXAO',
  'ELET': 'ELETRICO', 'ELETR': 'ELETRICO',
  'HID': 'HIDRAULICO', 'HIDR': 'HIDRAULICO',
  'POL': 'POLEGADA', 'POLEG': 'POLEGADA',
  'UN': 'UNIDADE', 'PC': 'PECA', 'PCS': 'PECA',
  'MT': 'METRO', 'MTS': 'METRO', 'ML': 'METRO'
};

function AP_PIE_expandir_(texto) {
  return AP_PIE_normalizar_(texto).split(' ').map(function (palavra) {
    return AP_PIE_ABREVIACOES[palavra] || palavra;
  }).join(' ');
}

/* ============================================================
   EXTRAÇÃO DE ATRIBUTOS
   ------------------------------------------------------------
   Transforma "JOELHO GALV 90° 2\"" em dados estruturados.
   ============================================================ */

/** Converte 1/2, 3/4, 1.1/2 em número decimal de polegadas */
function AP_PIE_fracao_(texto) {
  var t = String(texto).trim();

  /* 1.1/2 ou 1 1/2 -> 1,5 */
  var misto = t.match(/^(\d+)[\s.](\d+)\/(\d+)$/);
  if (misto) return Number(misto[1]) + (Number(misto[2]) / Number(misto[3]));

  var fracao = t.match(/^(\d+)\/(\d+)$/);
  if (fracao) return Number(fracao[1]) / Number(fracao[2]);

  var inteiro = t.match(/^(\d+(?:[.,]\d+)?)$/);
  if (inteiro) return Number(String(inteiro[1]).replace(',', '.'));

  return null;
}

/** Diâmetro em polegadas ou milímetros */
function AP_PIE_diametro_(texto) {
  var t = AP_PIE_normalizar_(texto);

  /* polegadas: 2", 1/2", 1.1/2", 2 POL */
  var pol = t.match(/(\d+(?:[.\s]\d+\/\d+|\/\d+)?)\s*(?:"|''|POLEGADAS?|POL\b)/);
  if (pol) {
    var v = AP_PIE_fracao_(pol[1]);
    if (v !== null) return { valor: v, unidade: 'pol' };
  }

  /* milímetros: 50MM, DN50, Ø50 */
  var mm = t.match(/(?:DN\s*|Ø\s*)?(\d+(?:[.,]\d+)?)\s*MM\b/) || t.match(/\bDN\s*(\d+)\b/);
  if (mm) return { valor: Number(String(mm[1]).replace(',', '.')), unidade: 'mm' };

  return null;
}

/** Ângulo: 90°, 45 GRAUS, 90 */
function AP_PIE_angulo_(texto) {
  var t = AP_PIE_normalizar_(texto);
  var m = t.match(/(\d{2,3})\s*(?:°|GRAUS?|G\b)/);
  if (m) return Number(m[1]);

  /* ângulo solto só vale para peças que têm ângulo */
  if (/JOELHO|CURVA|COTOVELO/.test(t)) {
    var solto = t.match(/\b(45|90|135|180)\b/);
    if (solto) return Number(solto[1]);
  }
  return null;
}

var AP_PIE_MATERIAIS = [
  'GALVANIZADO', 'INOXIDAVEL', 'PVC', 'CPVC', 'PPR', 'COBRE', 'LATAO',
  'FERRO FUNDIDO', 'FERRO GALVANIZADO', 'ACO CARBONO', 'ACO', 'ALUMINIO',
  'POLIETILENO', 'PEAD', 'BRONZE', 'PLASTICO', 'BORRACHA'
];

var AP_PIE_TIPOS = [
  'JOELHO', 'COTOVELO', 'CURVA', 'TE', 'CRUZETA', 'LUVA', 'NIPLE',
  'REDUCAO', 'BUCHA', 'TAMPAO', 'FLANGE', 'UNIAO', 'ADAPTADOR',
  'VALVULA', 'REGISTRO', 'TUBO', 'CANO', 'CONECTOR', 'ABRACADEIRA',
  'PARAFUSO', 'PORCA', 'ARRUELA', 'ELETRODUTO', 'CABO', 'FIO',
  'DISJUNTOR', 'TOMADA', 'INTERRUPTOR', 'LUMINARIA', 'CAIXA'
];

/**
 * Lê uma descrição e devolve os atributos que conseguiu identificar.
 * O que não for identificado fica null — nunca é chutado.
 */
function AP_PIE_atributos(descricao) {
  var expandido = AP_PIE_expandir_(descricao);

  var tipo = null;
  for (var i = 0; i < AP_PIE_TIPOS.length; i++) {
    if (expandido.indexOf(AP_PIE_TIPOS[i]) > -1) { tipo = AP_PIE_TIPOS[i]; break; }
  }

  var material = null;
  for (var j = 0; j < AP_PIE_MATERIAIS.length; j++) {
    if (expandido.indexOf(AP_PIE_MATERIAIS[j]) > -1) { material = AP_PIE_MATERIAIS[j]; break; }
  }

  return {
    original: String(descricao || ''),
    normalizado: expandido,
    tipo: tipo,
    material: material,
    diametro: AP_PIE_diametro_(descricao),
    angulo: AP_PIE_angulo_(descricao),
    palavras: expandido.split(' ').filter(function (p) { return p.length > 2; })
  };
}

/* ============================================================
   COMPARAÇÃO
   ============================================================ */

/** Semelhança textual simples, de 0 a 1 */
function AP_PIE_semelhancaTexto_(a, b) {
  var pa = String(a || '').split(' ').filter(Boolean);
  var pb = String(b || '').split(' ').filter(Boolean);
  if (!pa.length || !pb.length) return 0;

  var iguais = 0;
  pa.forEach(function (p) { if (pb.indexOf(p) > -1) iguais++; });
  return (2 * iguais) / (pa.length + pb.length);
}

/** Dois diâmetros são o mesmo? Converte polegada e milímetro */
function AP_PIE_mesmoDiametro_(d1, d2) {
  if (!d1 || !d2) return null;      /* sem informação: não opina */

  var v1 = d1.unidade === 'mm' ? d1.valor : d1.valor * 25.4;
  var v2 = d2.unidade === 'mm' ? d2.valor : d2.valor * 25.4;

  /* tolerância de 2 mm: DN50 e 2" são a mesma bitola comercial */
  return Math.abs(v1 - v2) <= 2;
}

/**
 * Compara o que está no projeto com um item do cadastro.
 *
 * Devolve a confiança de 0 a 100 e a razão — porque o usuário
 * precisa saber POR QUE o sistema achou que é o mesmo item.
 */
function AP_PIE_comparar(doProjeto, doCadastro) {
  var a = AP_PIE_atributos(doProjeto.descricao || doProjeto);
  var b = AP_PIE_atributos(doCadastro.descricao || doCadastro);

  var pontos = 0, possiveis = 0;
  var razoes = [], conflitos = [];

  /**
   * Código igual é a evidência mais forte que existe.
   *
   * Mas código DIFERENTE não é evidência de nada: o código da planta
   * (JG-90-2) quase nunca é igual ao SKU do almoxarifado
   * (ALM-HID-000001). Por isso o código só soma quando confere —
   * nunca penaliza quando difere.
   */
  var codProjeto = AP_PIE_normalizar_(doProjeto.codigo || '');
  var codCadastro = AP_PIE_normalizar_(doCadastro.codigo || doCadastro.sku || '');
  if (codProjeto && codCadastro) {
    if (codProjeto === codCadastro) {
      possiveis += AP_PIE_CFG.pesos.codigo;
      pontos += AP_PIE_CFG.pesos.codigo;
      razoes.push('código igual');
    } else if (codCadastro.indexOf(codProjeto) > -1 || codProjeto.indexOf(codCadastro) > -1) {
      possiveis += AP_PIE_CFG.pesos.codigo;
      pontos += AP_PIE_CFG.pesos.codigo * 0.6;
      razoes.push('código parecido');
    }
    /* diferentes: nem soma nem tira — o código da planta não é o SKU */
  }

  /* tipo da peça */
  if (a.tipo && b.tipo) {
    possiveis += AP_PIE_CFG.pesos.tipo;
    if (a.tipo === b.tipo) { pontos += AP_PIE_CFG.pesos.tipo; razoes.push('mesmo tipo (' + a.tipo + ')'); }
    else conflitos.push({ atributo: 'tipo', texto: 'tipo diferente: ' + a.tipo + ' × ' + b.tipo });
  }

  /* DIÂMETRO — bloqueante */
  if (a.diametro && b.diametro) {
    possiveis += AP_PIE_CFG.pesos.diametro;
    var mesmo = AP_PIE_mesmoDiametro_(a.diametro, b.diametro);
    if (mesmo) {
      pontos += AP_PIE_CFG.pesos.diametro;
      razoes.push('mesmo diâmetro');
    } else {
      conflitos.push({
        atributo: 'diametro',
        texto: 'diâmetro diferente: ' + a.diametro.valor + a.diametro.unidade +
          ' × ' + b.diametro.valor + b.diametro.unidade
      });
    }
  }

  /* ÂNGULO — bloqueante */
  if (a.angulo !== null && b.angulo !== null) {
    possiveis += AP_PIE_CFG.pesos.angulo;
    if (a.angulo === b.angulo) { pontos += AP_PIE_CFG.pesos.angulo; razoes.push('mesmo ângulo'); }
    else conflitos.push({ atributo: 'angulo', texto: 'ângulo diferente: ' + a.angulo + '° × ' + b.angulo + '°' });
  }

  /* material */
  if (a.material && b.material) {
    possiveis += AP_PIE_CFG.pesos.material;
    if (a.material === b.material) { pontos += AP_PIE_CFG.pesos.material; razoes.push('mesmo material'); }
    else conflitos.push({ atributo: 'material', texto: 'material diferente: ' + a.material + ' × ' + b.material });
  }

  /* unidade */
  var un1 = AP_PIE_normalizar_(doProjeto.unidade || '');
  var un2 = AP_PIE_normalizar_(doCadastro.unidade || '');
  if (un1 && un2) {
    possiveis += AP_PIE_CFG.pesos.unidade;
    if (AP_PIE_expandir_(un1) === AP_PIE_expandir_(un2)) pontos += AP_PIE_CFG.pesos.unidade;
  }

  /* texto, com o menor peso */
  possiveis += AP_PIE_CFG.pesos.texto;
  var sem = AP_PIE_semelhancaTexto_(a.normalizado, b.normalizado);
  pontos += AP_PIE_CFG.pesos.texto * sem;
  if (sem > 0.7) razoes.push('descrição muito parecida');

  var confianca = possiveis > 0 ? Math.round((pontos / possiveis) * 100) : 0;

  /**
   * Sem nenhum atributo estrutural em comum, a nota fica refém do
   * texto — e duas descrições sem relação chegariam a 50% só por
   * dividirem uma palavra comum.
   *
   * Se não houve acordo em tipo, diâmetro, material nem código,
   * isto não é correspondência: é semelhança de palavras.
   */
  var acordoEstrutural =
    (a.tipo && b.tipo && a.tipo === b.tipo) ||
    (a.diametro && b.diametro && AP_PIE_mesmoDiametro_(a.diametro, b.diametro)) ||
    (a.material && b.material && a.material === b.material) ||
    razoes.indexOf('código igual') > -1;

  if (!acordoEstrutural) {
    confianca = Math.min(confianca, 40);
  }

  /**
   * Conflito em atributo bloqueante derruba tudo.
   *
   * É aqui que "2 polegadas" deixa de virar "3 polegadas" por causa
   * de um nome parecido. A comparação é pelo NOME DO ATRIBUTO, não
   * pelo texto da mensagem — texto com acento nunca casava com a
   * lista, e o bloqueio não acontecia.
   */
  var temBloqueante = conflitos.some(function (c) {
    return AP_PIE_CFG.bloqueantes.indexOf(c.atributo) > -1;
  });

  if (temBloqueante) {
    /* abaixo de 50 = sem correspondência confiável, como manda a
       seção 8 do documento. Diferença de bitola não é "provável". */
    confianca = Math.min(confianca, 30);
  }

  return {
    confianca: confianca,
    nivel: AP_PIE_nivel(confianca),
    razoes: razoes,
    conflitos: conflitos.map(function (c) { return c.texto; }),
    conflitosDetalhados: conflitos,
    bloqueado: temBloqueante,
    atributosProjeto: a,
    atributosCadastro: b
  };
}

function AP_PIE_nivel(confianca) {
  if (confianca >= AP_PIE_CFG.faixas.muitoForte) return 'MUITO_FORTE';
  if (confianca >= AP_PIE_CFG.faixas.provavel) return 'PROVAVEL';
  if (confianca >= AP_PIE_CFG.faixas.possivel) return 'POSSIVEL';
  return 'SEM_CORRESPONDENCIA';
}

/* ============================================================
   BUSCA NO CADASTRO
   ============================================================ */

/**
 * Procura o item do projeto no Cadastro Central.
 *
 * NUNCA cria SKU. Se não achar, diz que não achou — e oferece as
 * opções do documento: pesquisar, cadastrar, criar equivalência,
 * deixar pendente ou ignorar.
 */
function AP_PIE_procurar(doProjeto, sessao) {
  var cadastro = [];
  try {
    var r = AP_Modulo_itens('listar', {}, sessao);
    cadastro = (r && r.ok) ? r.dados : [];
  } catch (e) { cadastro = []; }

  if (!cadastro.length) {
    return {
      ok: true,
      dados: {
        encontrado: false,
        motivo: 'CADASTRO_VAZIO',
        mensagem: 'Não há itens no Cadastro Central para comparar.',
        candidatos: []
      }
    };
  }

  /* equivalência já confirmada por alguém vale mais que o motor */
  var equivalente = AP_PIE_equivalenciaConfirmada_(doProjeto.descricao);
  if (equivalente) {
    var item = cadastro.filter(function (i) { return i.sku === equivalente.sku; })[0];
    if (item) {
      return {
        ok: true,
        dados: {
          encontrado: true, sku: item.sku, descricao: item.descricao,
          confianca: 100, nivel: 'MUITO_FORTE',
          origem: 'EQUIVALENCIA_CONFIRMADA',
          razoes: ['equivalência confirmada por ' + (equivalente.confirmadoPor || 'usuário') +
            ' em ' + (equivalente.data || 'data não registrada')],
          candidatos: []
        }
      };
    }
  }

  var candidatos = cadastro.map(function (item) {
    var c = AP_PIE_comparar(doProjeto, item);
    return {
      sku: item.sku, descricao: item.descricao, unidade: item.unidade,
      categoria: item.categoria, estoque: Number(item.estoqueAtual) || 0,
      confianca: c.confianca, nivel: c.nivel,
      razoes: c.razoes, conflitos: c.conflitos
    };
  }).filter(function (c) { return c.confianca >= AP_PIE_CFG.faixas.possivel; })
    .sort(function (a, b) { return b.confianca - a.confianca; })
    .slice(0, 5);

  if (!candidatos.length) {
    return {
      ok: true,
      dados: {
        encontrado: false,
        motivo: 'SEM_CORRESPONDENCIA',
        mensagem: 'Produto não encontrado no cadastro.',
        opcoes: ['pesquisar manualmente', 'cadastrar produto', 'criar equivalência',
          'deixar pendente', 'ignorar'],
        candidatos: []
      }
    };
  }

  var melhor = candidatos[0];
  var segundo = candidatos[1];

  /* dois candidatos empatados: não escolhe sozinho */
  var ambiguo = segundo && (melhor.confianca - segundo.confianca) < 10;

  return {
    ok: true,
    dados: {
      encontrado: melhor.nivel === 'MUITO_FORTE' && !ambiguo,
      precisaConfirmar: melhor.nivel !== 'MUITO_FORTE' || ambiguo,
      ambiguo: !!ambiguo,
      sku: melhor.sku, descricao: melhor.descricao,
      confianca: melhor.confianca, nivel: melhor.nivel,
      razoes: melhor.razoes, conflitos: melhor.conflitos,
      origem: 'MOTOR',
      mensagem: melhor.nivel === 'MUITO_FORTE'
        ? (ambiguo ? 'Dois produtos ficaram igualmente parecidos. Confirme qual é.'
          : 'Correspondência muito forte.')
        : 'Correspondência ' + (melhor.nivel === 'PROVAVEL' ? 'provável' : 'possível') +
          ' — necessita validação.',
      candidatos: candidatos
    }
  };
}

/* ============================================================
   EQUIVALÊNCIAS — o aprendizado do sistema
   ============================================================ */

var AP_PIE_ABA_EQUIV = 'ALMOXA_EQUIVALENCIAS';
var AP_PIE_COLS_EQUIV = ['id', 'termoProjeto', 'termoNormalizado', 'sku', 'descricao',
  'confirmado', 'confirmadoPor', 'data', 'versaoMotor', 'usos', 'observacao'];

function AP_PIE_equivalencias_() {
  AP_Data_getSheet(AP_PIE_ABA_EQUIV, AP_PIE_COLS_EQUIV);
  return AP_Data_rows(AP_PIE_ABA_EQUIV) || [];
}

function AP_PIE_equivalenciaConfirmada_(termo) {
  var alvo = AP_PIE_expandir_(termo);
  return AP_PIE_equivalencias_().filter(function (e) {
    return e.termoNormalizado === alvo &&
      (e.confirmado === true || e.confirmado === 'TRUE' || e.confirmado === 'SIM');
  })[0] || null;
}

/* ============================================================
   MÓDULO — a porta de entrada pelo Core
   ============================================================ */

function AP_Modulo_inteligencia(acao, payload, sessao) {
  payload = payload || {};

  try {
    switch (acao) {

      /** Lê uma descrição e mostra o que entendeu dela */
      case 'interpretar':
        return { ok: true, dados: AP_PIE_atributos(payload.descricao) };

      /** Procura o item do projeto no cadastro */
      case 'procurar':
        if (!payload.descricao) {
          return { ok: false, codigo: 'SEM_DESCRICAO', mensagem: 'Informe a descrição do elemento.' };
        }
        return AP_PIE_procurar(payload, sessao);

      /** Compara duas descrições diretamente */
      case 'comparar': {
        if (!payload.a || !payload.b) {
          return { ok: false, codigo: 'DADOS_INCOMPLETOS', mensagem: 'Informe as duas descrições.' };
        }
        return { ok: true, dados: AP_PIE_comparar({ descricao: payload.a }, { descricao: payload.b }) };
      }

      /** Processa a legenda inteira de uma prancha */
      case 'processarLegenda': {
        var linhas = payload.linhas || [];
        if (!linhas.length) {
          return { ok: false, codigo: 'SEM_LINHAS', mensagem: 'Nenhuma linha de legenda foi enviada.' };
        }

        var resultado = { automaticas: [], confirmar: [], semCorrespondencia: [] };

        linhas.forEach(function (linha) {
          var busca = AP_PIE_procurar(linha, sessao);
          var d = busca.dados;

          var registro = {
            codigo: linha.codigo || '', descricao: linha.descricao,
            quantidade: linha.quantidade || null, unidade: linha.unidade || '',
            sku: d.sku || null, confianca: d.confianca || 0,
            nivel: d.nivel || 'SEM_CORRESPONDENCIA',
            razoes: d.razoes || [], conflitos: d.conflitos || [],
            candidatos: d.candidatos || []
          };

          if (d.encontrado) resultado.automaticas.push(registro);
          else if (d.precisaConfirmar) resultado.confirmar.push(registro);
          else resultado.semCorrespondencia.push(registro);
        });

        return {
          ok: true,
          dados: {
            total: linhas.length,
            automaticas: resultado.automaticas.length,
            confirmar: resultado.confirmar.length,
            semCorrespondencia: resultado.semCorrespondencia.length,
            versaoMotor: AP_PIE_CFG.versao,
            processadoEm: AP_Utils_now(),
            itens: resultado
          }
        };
      }

      /** Guarda uma equivalência confirmada por alguém */
      case 'confirmarEquivalencia': {
        if (!payload.termoProjeto || !payload.sku) {
          return { ok: false, codigo: 'DADOS_INCOMPLETOS', mensagem: 'Informe o termo do projeto e o SKU.' };
        }
        if (!sessao) {
          return { ok: false, codigo: 'SEM_SESSAO', mensagem: 'Confirmar equivalência exige usuário identificado.' };
        }

        /* o SKU precisa existir — nunca criar produto aqui */
        var itemR = AP_Modulo_itens('obter', { sku: payload.sku }, sessao);
        if (!itemR || !itemR.ok) {
          return {
            ok: false, codigo: 'SKU_INEXISTENTE',
            mensagem: 'O SKU ' + payload.sku + ' não existe no cadastro. Cadastre o produto antes.'
          };
        }

        var normalizado = AP_PIE_expandir_(payload.termoProjeto);
        var jaExiste = AP_PIE_equivalencias_().filter(function (e) {
          return e.termoNormalizado === normalizado;
        })[0];

        if (jaExiste && jaExiste.sku !== payload.sku) {
          return {
            ok: false, codigo: 'EQUIVALENCIA_CONFLITANTE',
            mensagem: 'Este termo já está ligado ao SKU ' + jaExiste.sku +
              '. Remova a equivalência antiga antes de criar outra.'
          };
        }

        if (jaExiste) {
          AP_Data_update(AP_PIE_ABA_EQUIV, jaExiste.id, {
            usos: (Number(jaExiste.usos) || 0) + 1, data: AP_Utils_now()
          });
          return { ok: true, dados: jaExiste, jaExistia: true };
        }

        var nova = {
          id: AP_Utils_generateId('EQV'),
          termoProjeto: payload.termoProjeto,
          termoNormalizado: normalizado,
          sku: payload.sku,
          descricao: (itemR.dados && itemR.dados.descricao) || '',
          confirmado: true,
          confirmadoPor: (sessao.usuario || 'usuário'),
          data: AP_Utils_now(),
          versaoMotor: AP_PIE_CFG.versao,
          usos: 1,
          observacao: payload.observacao || ''
        };

        AP_Data_getSheet(AP_PIE_ABA_EQUIV, AP_PIE_COLS_EQUIV);
        AP_Data_append(AP_PIE_ABA_EQUIV, nova);

        AP_Audit_log(sessao.usuario, 'EQUIVALENCIA_CRIADA', 'PROJETOS', payload.sku,
          { termo: payload.termoProjeto, versaoMotor: AP_PIE_CFG.versao });

        return { ok: true, dados: nova, criado: true };
      }

      case 'equivalencias':
        return { ok: true, dados: AP_PIE_equivalencias_() };

      case 'removerEquivalencia': {
        if (!sessao) return { ok: false, codigo: 'SEM_SESSAO', mensagem: 'Operação exige usuário identificado.' };
        AP_Data_remove(AP_PIE_ABA_EQUIV, payload.id);
        AP_Audit_log(sessao.usuario, 'EQUIVALENCIA_REMOVIDA', 'PROJETOS', payload.id, {});
        return { ok: true, dados: { id: payload.id, removido: true } };
      }

      case 'versao':
        return {
          ok: true,
          dados: {
            motor: 'AP_PROJECT_INTELLIGENCE_ENGINE',
            versao: AP_PIE_CFG.versao,
            faixas: AP_PIE_CFG.faixas,
            pesos: AP_PIE_CFG.pesos,
            bloqueantes: AP_PIE_CFG.bloqueantes
          }
        };

      default:
        return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'inteligencia.' + acao + ' não existe.' };
    }
  } catch (e) {
    AP_ErrorHandler_capture('AP_Modulo_inteligencia:' + acao, e);
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'inteligencia', acao: acao, mensagem: e.message };
  }
}

/* ============================================================
   TESTE
   ============================================================ */
function testeMotorInteligencia() {
  var log = [];
  function reg(t, ok, d) { log.push((ok ? 'OK    ' : 'ERRO  ') + t + (d ? ' — ' + d : '')); }

  try {
    /* ---------- NORMALIZAÇÃO ---------- */
    var a = AP_PIE_atributos('JOELHO GALV 90° 2"');
    reg('identifica o tipo', a.tipo === 'JOELHO', a.tipo);
    reg('expande a abreviação', a.material === 'GALVANIZADO', a.material);
    reg('lê o ângulo', a.angulo === 90, a.angulo + '°');
    reg('lê o diâmetro', a.diametro && a.diametro.valor === 2, a.diametro ? a.diametro.valor + a.diametro.unidade : '—');

    var b = AP_PIE_atributos('TUBO PVC DN50');
    reg('lê diâmetro em milímetro', b.diametro && b.diametro.unidade === 'mm', b.diametro ? b.diametro.valor + 'mm' : '—');

    var c = AP_PIE_atributos('LUVA GALVANIZADA 1.1/2"');
    reg('lê fração mista', c.diametro && Math.abs(c.diametro.valor - 1.5) < 0.01,
      c.diametro ? c.diametro.valor + '"' : '—');

    /* ---------- O CASO DO DOCUMENTO ---------- */
    var iguais = AP_PIE_comparar(
      { descricao: 'JOELHO GALV 90 2"' },
      { descricao: 'JOELHO GALVANIZADO 90° 2"' });
    reg('reconhece as duas escritas do mesmo item',
      iguais.confianca >= 95, iguais.confianca + '% · ' + iguais.razoes.join(', '));

    var variacoes = ['JOELHO GALV. 90 2"', 'JG 90 GALV 2"', 'JOELHO 90 GALVANIZADO 2 POL'];
    var todasOk = variacoes.every(function (v) {
      return AP_PIE_comparar({ descricao: v }, { descricao: 'JOELHO GALVANIZADO 90° 2"' }).confianca >= 75;
    });
    reg('reconhece as demais variações do documento', todasOk, variacoes.length + ' formas');

    /* ---------- O QUE NÃO PODE ACONTECER ---------- */
    var diametroDiferente = AP_PIE_comparar(
      { descricao: 'JOELHO GALVANIZADO 90° 2"' },
      { descricao: 'JOELHO GALVANIZADO 90° 3"' });
    reg('NÃO confunde 2" com 3"',
      diametroDiferente.confianca < 50 && diametroDiferente.bloqueado,
      diametroDiferente.confianca + '% · ' + diametroDiferente.conflitos.join('; '));

    var anguloDiferente = AP_PIE_comparar(
      { descricao: 'JOELHO GALVANIZADO 90° 2"' },
      { descricao: 'JOELHO GALVANIZADO 45° 2"' });
    reg('NÃO confunde 90° com 45°', anguloDiferente.confianca < 50,
      anguloDiferente.confianca + '%');

    var materialDiferente = AP_PIE_comparar(
      { descricao: 'JOELHO GALVANIZADO 90° 2"' },
      { descricao: 'JOELHO PVC 90° 2"' });
    reg('separa materiais diferentes', materialDiferente.confianca < 95,
      materialDiferente.confianca + '%');

    var tipoDiferente = AP_PIE_comparar(
      { descricao: 'JOELHO GALVANIZADO 90° 2"' },
      { descricao: 'CURVA GALVANIZADA 90° 2"' });
    reg('joelho e curva não são o mesmo automaticamente',
      tipoDiferente.confianca < 95, tipoDiferente.confianca + '%');

    /* ---------- NÍVEIS ---------- */
    reg('faixa muito forte', AP_PIE_nivel(97) === 'MUITO_FORTE');
    reg('faixa provável', AP_PIE_nivel(80) === 'PROVAVEL');
    reg('faixa possível', AP_PIE_nivel(60) === 'POSSIVEL');
    reg('abaixo de 50 é sem correspondência', AP_PIE_nivel(40) === 'SEM_CORRESPONDENCIA');

    /* ---------- BUSCA NO CADASTRO ---------- */
    AP_Modulo_categorias('salvar', { nome: 'Hidráulica' });
    var it1 = AP_Modulo_itens('salvar', { descricao: 'JOELHO GALVANIZADO 90° 2"', categoria: 'Hidráulica', unidade: 'un', valorUnitario: 12 });
    AP_Modulo_itens('salvar', { descricao: 'JOELHO GALVANIZADO 90° 3"', categoria: 'Hidráulica', unidade: 'un', valorUnitario: 18, confirmadoNovo: true });
    AP_Modulo_itens('salvar', { descricao: 'TUBO PVC 100MM', categoria: 'Hidráulica', unidade: 'm', valorUnitario: 30, confirmadoNovo: true });

    var achou = AP_PIE_procurar({ descricao: 'JG 90 GALV 2"', unidade: 'UN' }, { usuario: 'teste' });
    reg('acha o produto certo no cadastro',
      achou.dados.sku === it1.dados.sku,
      achou.dados.sku + ' · ' + achou.dados.confianca + '% · ' + achou.dados.nivel);

    var naoAchou = AP_PIE_procurar({ descricao: 'PARAFUSO SEXTAVADO M8 INOX' }, { usuario: 'teste' });
    reg('diz que não achou em vez de inventar',
      naoAchou.dados.encontrado === false && !naoAchou.dados.sku,
      naoAchou.dados.mensagem);
    reg('oferece as opções do documento',
      (naoAchou.dados.opcoes || []).length === 5, (naoAchou.dados.opcoes || []).join(', '));

    /* ---------- LEGENDA COMPLETA ---------- */
    var legenda = AP_Modulo_inteligencia('processarLegenda', {
      linhas: [
        { codigo: 'JG-90-2', descricao: 'JOELHO GALVANIZADO 90° 2"', quantidade: 24, unidade: 'UN' },
        { codigo: 'JG-90-3', descricao: 'JOELHO GALV 90 3"', quantidade: 8, unidade: 'UN' },
        { codigo: 'XX-01', descricao: 'PECA ESPECIAL SOB MEDIDA', quantidade: 2, unidade: 'UN' }
      ]
    }, { usuario: 'teste' });

    reg('processa a legenda inteira', legenda.ok,
      legenda.dados.automaticas + ' automática(s), ' +
      legenda.dados.confirmar + ' a confirmar, ' +
      legenda.dados.semCorrespondencia + ' sem correspondência');

    reg('a peça especial fica sem correspondência',
      legenda.dados.semCorrespondencia >= 1, '');

    /* ---------- EQUIVALÊNCIAS ---------- */
    var eq = AP_Modulo_inteligencia('confirmarEquivalencia', {
      termoProjeto: 'JG 90 GALV 2"', sku: it1.dados.sku
    }, { usuario: 'ismael' });
    reg('grava a equivalência confirmada', eq.ok, eq.ok ? eq.dados.id : eq.mensagem);

    var comEquiv = AP_PIE_procurar({ descricao: 'JG 90 GALV 2"' }, { usuario: 'teste' });
    reg('usa a equivalência na próxima vez',
      comEquiv.dados.origem === 'EQUIVALENCIA_CONFIRMADA',
      comEquiv.dados.razoes[0]);

    var skuFalso = AP_Modulo_inteligencia('confirmarEquivalencia', {
      termoProjeto: 'QUALQUER COISA', sku: 'SKU-QUE-NAO-EXISTE'
    }, { usuario: 'ismael' });
    reg('recusa equivalência para SKU inexistente',
      skuFalso.ok === false && skuFalso.codigo === 'SKU_INEXISTENTE', skuFalso.codigo);

    var semSessao = AP_Modulo_inteligencia('confirmarEquivalencia', {
      termoProjeto: 'X', sku: it1.dados.sku
    }, null);
    reg('equivalência exige usuário identificado', semSessao.ok === false, semSessao.codigo);

  } catch (e) {
    log.push('ERRO  exceção: ' + e.message);
  }

  try { Logger.log(log.join('\n')); } catch (e) { }
  return log;
}
