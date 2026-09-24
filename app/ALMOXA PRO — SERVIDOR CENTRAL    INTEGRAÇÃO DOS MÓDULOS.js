/* ============================================================
   ALMOXA PRO — SERVIDOR CENTRAL
   ETAPA 6 — INTEGRAÇÃO DOS MÓDULOS
   ------------------------------------------------------------
   ESTA ETAPA NÃO LIGA NADA SOZINHA.

   As outras cinco montaram um servidor que ninguém usa ainda. Esta
   constrói a tomada — e deixa a chave desligada. O ALMOXA PRO que
   está na obra continua funcionando exatamente como hoje depois de
   instalar este arquivo. Nada muda até você mandar mudar.

   Isso não é excesso de cuidado: é que ligar o sistema de uma obra
   num banco novo no meio da semana, sem comparar antes, é como
   trocar o piso enquanto o pessoal trabalha em cima.

   O QUE TEM AQUI

   1. O REGISTRO DOS MÓDULOS
      Cada arquivo do servidor se apresenta na CORE_MODULOS. Hoje
      só o CORE está lá; depois desta etapa, todos. Serve para o
      Doutor saber o que deveria existir.

   2. O OBJETO SERVIDOR
      A porta que os módulos usam. Ninguém abre planilha na mão:

          SERVIDOR.criar('produtos', {...}, token)
          SERVIDOR.listar('estoque', {PROJETO_ID: 'PRJ-1'}, token)

      Por trás é o AP_DB_ da etapa 3, com todas as regras. A porta
      existe para o módulo falar a língua dele ("produtos") e não
      precisar saber o nome da planilha — no dia da migração para
      outro banco, muda aqui e só aqui.

   3. A API DE UMA ENTRADA SÓ
      almoxaServidorApi(json) devolve {ok, dados, codigo, mensagem},
      o mesmo formato que o ALMOXA já entende. É por onde a tela
      vai conversar com o servidor quando chegar a hora.

   4. O MODO ESPELHO — desligado de fábrica
      Ligado, o servidor passa a receber uma CÓPIA do que acontece
      no sistema de hoje, sem ninguém depender dele. Roda uma
      semana assim, você compara os números, e só então vira a
      chave de verdade.

      O espelho NUNCA derruba o sistema. Se a gravação no servidor
      falhar, ele anota no log e devolve a vida ao normal. Um
      espelho que quebra a operação é pior que nenhum espelho.

   DEPENDE DE: Core (1 e 2) e Dados (3).
   ============================================================ */

var AP_INT_CFG = {
  versao: '2.0.0-etapa6',
  chaveEspelho: 'ESPELHO_ATIVO',
  chaveModoReal: 'SERVIDOR_COMO_FONTE'
};

/* O nome que o módulo usa → o banco onde aquilo mora.
   É o único lugar do sistema que sabe dessa ligação. */
var AP_INT_BANCOS = {
  usuarios: 'DB_USUARIOS',
  empresas: 'DB_EMPRESAS',
  equipes: 'DB_EQUIPES',
  projetos: 'DB_PROJETOS',
  obras: 'DB_PROJETOS',
  fornecedores: 'DB_FORNECEDORES',
  produtos: 'DB_PRODUTOS',
  itens: 'DB_PRODUTOS',
  estoque: 'DB_ESTOQUE',
  movimentacoes: 'DB_MOVIMENTACOES',
  notas: 'DB_NOTAS_FISCAIS',
  itensNota: 'DB_ITENS_NOTAS',
  solicitacoes: 'DB_SOLICITACOES',
  reservas: 'DB_RESERVAS',
  aprovacoes: 'DB_APROVACOES',
  epi: 'DB_EPI',
  fichasEpi: 'DB_FICHAS_EPI',
  patrimonio: 'DB_PATRIMONIO',
  inventarios: 'DB_INVENTARIOS',
  ocorrencias: 'DB_OCORRENCIAS',
  anexos: 'DB_ANEXOS'
};

var AP_INT_MODULOS = [
  { nome: 'CORE', arquivo: 'ALMOXA_PRO_Servidor_Core.gs', prova: 'inicializarServidorALMOXA_PRO',
    descricao: 'Estrutura do Drive, cabeçalhos, log, backup e integridade' },
  { nome: 'RELATORIO', arquivo: 'ALMOXA_PRO_Servidor_Relatorio.gs', prova: 'verServidor',
    descricao: 'Mostra o estado do servidor no editor' },
  { nome: 'DADOS', arquivo: 'ALMOXA_PRO_Servidor_Dados.gs', prova: 'AP_DB_inserir',
    descricao: 'Porta única dos dados: sessão, permissão, validação, exclusão lógica' },
  { nome: 'BACKUP', arquivo: 'ALMOXA_PRO_Servidor_Backup.gs', prova: 'ativarRotinasAutomaticas',
    descricao: 'Rotinas automáticas, limpeza, restauração e arquivamento de log' },
  { nome: 'DOUTOR', arquivo: 'ALMOXA_PRO_Servidor_Doutor.gs', prova: 'doutorDoSistema',
    descricao: 'Diagnóstico do servidor, sem conserto automático' },
  { nome: 'INTEGRACAO', arquivo: 'ALMOXA_PRO_Servidor_Integracao.gs', prova: 'almoxaServidorApi',
    descricao: 'Porta dos módulos, API de entrada e modo espelho' }
];

function AP_INT_dizer_(texto) {
  if (typeof AP_SRV_falar_ === 'function') return AP_SRV_falar_(texto);
  try { Logger.log(texto); } catch (e) { }
  return texto;
}

/* usa a coluna do Doutor se ele estiver instalado; se não, a sua
   própria — a tabela não pode depender de um arquivo opcional */
function AP_INT_col_(texto, tamanho) {
  if (typeof AP_DR_col_ === 'function') return AP_DR_col_(texto, tamanho);
  texto = String(texto === undefined ? '' : texto);
  if (texto.length > tamanho) return texto.substring(0, tamanho - 1) + '…';
  while (texto.length < tamanho) texto += ' ';
  return texto;
}

function AP_INT_existe_(nome) {
  try {
    if (typeof globalThis !== 'undefined' && typeof globalThis[nome] === 'function') return true;
  } catch (e) { }
  try { return eval('typeof ' + nome) === 'function'; } catch (e2) { return false; }
}

/* ============================================================
   1. O REGISTRO DOS MÓDULOS
   Só registra o que está REALMENTE no projeto. Registrar módulo
   que não existe seria mentir para o Doutor.
   ============================================================ */
function registrarModulosDoServidor() {
  var registrados = [], ausentes = [];
  for (var i = 0; i < AP_INT_MODULOS.length; i++) {
    var m = AP_INT_MODULOS[i];
    if (!AP_INT_existe_(m.prova)) { ausentes.push(m.nome); continue; }
    var r = registrarModulo({
      nome: m.nome, versao: AP_INT_CFG.versao, arquivo: m.arquivo, descricao: m.descricao
    });
    registrados.push(m.nome + (r.criado ? ' (novo)' : ' (atualizado)'));
  }

  var l = ['=== MÓDULOS DO SERVIDOR ==='];
  for (var a = 0; a < registrados.length; a++) l.push('  · ' + registrados[a]);
  if (ausentes.length) {
    l.push('');
    l.push('NÃO registrados, porque o arquivo não está no projeto:');
    for (var b = 0; b < ausentes.length; b++) l.push('  · ' + ausentes[b]);
    l.push('Não registro módulo que não existe — isso enganaria o Doutor.');
  }
  return AP_INT_dizer_(l.join('\n'));
}

/* ============================================================
   2. O OBJETO SERVIDOR — a porta dos módulos
   ============================================================ */
var SERVIDOR = {

  banco: function (assunto) { return AP_INT_BANCOS[String(assunto)] || null; },

  pronto: function () {
    if (!AP_INT_existe_('AP_DB_inserir')) {
      return { ok: false, codigo: 'SEM_DADOS', mensagem: 'A etapa 3 não está instalada.' };
    }
    var mapa = AP_SRV_mapaDeIds();
    if (!mapa.ok) {
      return { ok: false, codigo: 'SEM_ESTRUTURA', mensagem: 'Rode instalarServidor().' };
    }
    return { ok: true, dados: { versao: mapa.versao, raiz: mapa.raiz } };
  },

  abrirSessao: function (usuario, opcoes) { return AP_SEG_abrirSessao(usuario, opcoes); },
  encerrarSessao: function (token) { return AP_SEG_encerrarSessao(token); },
  conferirSessao: function (token) { return AP_SEG_validarSessao(token); },

  criar: function (assunto, dados, token) {
    var b = SERVIDOR.banco(assunto);
    if (!b) return AP_INT_semAssunto_(assunto);
    return AP_DB_inserir(b, dados, token);
  },
  atualizar: function (assunto, id, mudancas, token) {
    var b = SERVIDOR.banco(assunto);
    if (!b) return AP_INT_semAssunto_(assunto);
    return AP_DB_atualizar(b, id, mudancas, token);
  },
  excluir: function (assunto, id, motivo, token) {
    var b = SERVIDOR.banco(assunto);
    if (!b) return AP_INT_semAssunto_(assunto);
    return AP_DB_excluir(b, id, motivo, token);
  },
  reativar: function (assunto, id, motivo, token) {
    var b = SERVIDOR.banco(assunto);
    if (!b) return AP_INT_semAssunto_(assunto);
    return AP_DB_reativar(b, id, motivo, token);
  },
  obter: function (assunto, id, token) {
    var b = SERVIDOR.banco(assunto);
    if (!b) return AP_INT_semAssunto_(assunto);
    return AP_DB_obter(b, id, token);
  },
  listar: function (assunto, filtro, token) {
    var b = SERVIDOR.banco(assunto);
    if (!b) return AP_INT_semAssunto_(assunto);
    return AP_DB_listar(b, filtro, token);
  },

  log: function (tipo, dados) { return registrarLog(tipo, dados); }
};

function AP_INT_semAssunto_(assunto) {
  var conhecidos = [];
  for (var k in AP_INT_BANCOS) if (AP_INT_BANCOS.hasOwnProperty(k)) conhecidos.push(k);
  return {
    ok: false, codigo: 'ASSUNTO_DESCONHECIDO',
    mensagem: 'O servidor não conhece "' + assunto + '". Conhecidos: ' + conhecidos.join(', ') + '.'
  };
}

/* ============================================================
   3. A API DE UMA ENTRADA SÓ
   Mesmo formato de resposta que o ALMOXA já entende.
   ============================================================ */
var AP_INT_ACOES = {
  listar: function (a, p, t) { return SERVIDOR.listar(a, p.filtro || {}, t); },
  obter: function (a, p, t) { return SERVIDOR.obter(a, p.id, t); },
  criar: function (a, p, t) { return SERVIDOR.criar(a, p.dados || {}, t); },
  atualizar: function (a, p, t) { return SERVIDOR.atualizar(a, p.id, p.dados || {}, t); },
  excluir: function (a, p, t) { return SERVIDOR.excluir(a, p.id, p.motivo, t); },
  reativar: function (a, p, t) { return SERVIDOR.reativar(a, p.id, p.motivo, t); }
};

function almoxaServidorApi(pedidoJson) {
  var pedido;
  try {
    pedido = (typeof pedidoJson === 'string') ? JSON.parse(pedidoJson) : (pedidoJson || {});
  } catch (falha) {
    return AP_INT_resposta_({
      ok: false, codigo: 'PEDIDO_INVALIDO',
      mensagem: 'Não consegui ler o pedido. Ele precisa ser um JSON.'
    }, pedidoJson);
  }

  var assunto = String(pedido.modulo || pedido.assunto || '');
  var acao = String(pedido.acao || '');
  var token = pedido.sessao || pedido.token || '';

  var executor = AP_INT_ACOES[acao];
  if (!executor) {
    var lista = [];
    for (var k in AP_INT_ACOES) if (AP_INT_ACOES.hasOwnProperty(k)) lista.push(k);
    return AP_INT_resposta_({
      ok: false, codigo: 'ACAO_DESCONHECIDA',
      mensagem: 'O servidor não faz "' + acao + '". Faz: ' + lista.join(', ') + '.'
    }, pedidoJson);
  }

  try {
    return AP_INT_resposta_(executor(assunto, pedido.payload || {}, token), pedidoJson);
  } catch (explodiu) {
    registrarLog('ERRO', {
      modulo: 'INTEGRACAO', funcao: 'almoxaServidorApi', gravidade: 'ALTA',
      mensagem: (explodiu && explodiu.message) || String(explodiu),
      detalhe: assunto + '.' + acao
    });
    return AP_INT_resposta_({
      ok: false, codigo: 'FALHA_NO_SERVIDOR',
      mensagem: 'Deu erro no servidor ao fazer ' + assunto + '.' + acao + '. Nada foi concluído.'
    }, pedidoJson);
  }
}

/* Se o pedido veio como texto, a resposta volta como texto. Quem
   fala JSON recebe JSON; quem fala objeto recebe objeto. */
function AP_INT_resposta_(r, pedidoOriginal) {
  return (typeof pedidoOriginal === 'string') ? JSON.stringify(r) : r;
}

/* ============================================================
   4. O MODO ESPELHO
   ============================================================ */
function AP_INT_configLer_(chave) {
  var aba = AP_SRV_aba_('00_CORE/CORE_CONFIGURACAO');
  if (!aba || aba.getLastRow() < 2) return null;
  var colunas = AP_SRV_colunasDe_(aba);
  var iChave = colunas.indexOf('CHAVE'), iValor = colunas.indexOf('VALOR');
  var linhas = aba.getRange(2, 1, aba.getLastRow() - 1, aba.getLastColumn()).getValues();
  for (var i = 0; i < linhas.length; i++) {
    if (String(linhas[i][iChave]) === chave) {
      return { valor: String(linhas[i][iValor] || ''), linha: i + 2 };
    }
  }
  return null;
}

function AP_INT_configGravar_(chave, valor, descricao) {
  var aba = AP_SRV_aba_('00_CORE/CORE_CONFIGURACAO');
  if (!aba) return false;
  var colunas = AP_SRV_colunasDe_(aba);
  var achado = AP_INT_configLer_(chave);
  var agora = AP_SRV_agora_(), quem = AP_SRV_quemSou_();

  if (achado) {
    var iValor = colunas.indexOf('VALOR');
    aba.getRange(achado.linha, iValor + 1, 1, 1).setValues([[valor]]);
    var iAtual = colunas.indexOf('DATA_ATUALIZACAO');
    if (iAtual > -1) aba.getRange(achado.linha, iAtual + 1, 1, 1).setValues([[agora]]);
  } else {
    var linha = [];
    for (var c = 0; c < colunas.length; c++) linha.push('');
    AP_SRV_por_(linha, colunas, 'ID_CONFIG', AP_SRV_novoId_('CFG'));
    AP_SRV_por_(linha, colunas, 'CHAVE', chave);
    AP_SRV_por_(linha, colunas, 'VALOR', valor);
    AP_SRV_por_(linha, colunas, 'DESCRICAO', descricao || '');
    AP_SRV_por_(linha, colunas, 'TIPO', 'TEXTO');
    AP_SRV_por_(linha, colunas, 'STATUS', 'ATIVO');
    AP_SRV_por_(linha, colunas, 'USUARIO_RESPONSAVEL', quem);
    AP_SRV_por_(linha, colunas, 'VERSAO_REGISTRO', 1);
    AP_SRV_por_(linha, colunas, 'SYNC_ID', AP_SRV_novoId_('SYNC'));
    AP_SRV_por_(linha, colunas, 'DATA_CRIACAO', agora);
    AP_SRV_por_(linha, colunas, 'DATA_ATUALIZACAO', agora);
    aba.appendRow(linha);
  }

  registrarLog('ALTERACAO', {
    modulo: 'INTEGRACAO', tabela: 'CORE_CONFIGURACAO', campo: chave,
    valor_novo: valor, origem: 'configuração do servidor'
  });
  return true;
}

function espelhoLigado() {
  var c = AP_INT_configLer_(AP_INT_CFG.chaveEspelho);
  return !!c && /^(sim|true|1|ligado)$/i.test(c.valor);
}

function ativarEspelho(confirmacao) {
  if (String(confirmacao) !== 'CONFIRMO') {
    return AP_INT_dizer_(
      'Nada foi ligado.\n\n' +
      'O modo espelho faz o servidor receber uma CÓPIA do que acontece no\n' +
      'ALMOXA de hoje. O sistema continua funcionando igual: se a cópia\n' +
      'falhar, ele anota no log e segue. Nada da operação depende dela.\n\n' +
      'Para ligar:  ativarEspelho("CONFIRMO")');
  }
  AP_INT_configGravar_(AP_INT_CFG.chaveEspelho, 'SIM',
    'Servidor recebendo cópia das operações, sem ninguém depender dele');
  return AP_INT_dizer_('Modo espelho LIGADO.\n\n' +
    'Daqui pra frente, o que o ALMOXA gravar também chega aqui — mas só\n' +
    'se os módulos já estiverem chamando SERVIDOR.espelhar(). Enquanto\n' +
    'nenhum módulo chamar, ligar isto não muda nada, e é assim mesmo.\n\n' +
    'Deixa rodando alguns dias e compara com compararComOSistemaDeHoje().');
}

function desativarEspelho() {
  AP_INT_configGravar_(AP_INT_CFG.chaveEspelho, 'NAO', 'Espelho desligado');
  return AP_INT_dizer_('Modo espelho DESLIGADO. O servidor para de receber cópia.');
}

/* A cópia. Nunca, em hipótese nenhuma, deixa um erro subir para
   quem chamou: quem chama é a operação da obra. */
SERVIDOR.espelhar = function (assunto, dados, token) {
  try {
    if (!espelhoLigado()) return { ok: true, espelhado: false, motivo: 'espelho desligado' };
    var r = SERVIDOR.criar(assunto, dados, token);
    if (!r.ok) {
      registrarLog('SINCRONIZACAO', {
        modulo: 'INTEGRACAO', acao: 'espelho', item: assunto,
        resultado: 'FALHOU', detalhe: r.codigo + ': ' + r.mensagem
      });
      return { ok: true, espelhado: false, motivo: r.codigo };
    }
    return { ok: true, espelhado: true, id: r.id };
  } catch (explodiu) {
    try {
      registrarLog('ERRO', {
        modulo: 'INTEGRACAO', funcao: 'espelhar', gravidade: 'MEDIA',
        mensagem: (explodiu && explodiu.message) || String(explodiu), detalhe: assunto
      });
    } catch (e) { }
    return { ok: true, espelhado: false, motivo: 'erro' };
  }
};

/* ============================================================
   5. COMPARAR ANTES DE VIRAR A CHAVE
   ============================================================ */
function compararComOSistemaDeHoje(contagensDeHoje) {
  contagensDeHoje = contagensDeHoje || {};
  var l = ['=== SERVIDOR NOVO × SISTEMA DE HOJE ==='];
  l.push('');
  l.push('ASSUNTO          | NO SERVIDOR | NO SISTEMA DE HOJE | DIFERENÇA');
  l.push('-----------------+-------------+--------------------+----------');

  var iguais = 0, diferentes = 0;
  for (var assunto in AP_INT_BANCOS) {
    if (!AP_INT_BANCOS.hasOwnProperty(assunto)) continue;
    var aba = AP_SRV_aba_('01_BANCO_DADOS/' + AP_INT_BANCOS[assunto]);
    if (!aba) continue;
    var noServidor = Math.max(aba.getLastRow() - 1, 0);
    if (!contagensDeHoje.hasOwnProperty(assunto)) continue;

    var deHoje = contagensDeHoje[assunto];
    var dif = noServidor - deHoje;
    if (dif === 0) iguais++; else diferentes++;
    l.push(AP_INT_col_(assunto, 16) + ' | ' + AP_INT_col_(String(noServidor), 11) + ' | ' +
      AP_INT_col_(String(deHoje), 18) + ' | ' + (dif === 0 ? 'igual' : (dif > 0 ? '+' : '') + dif));
  }

  l.push('');
  if (!iguais && !diferentes) {
    l.push('Você não me passou as contagens do sistema de hoje. Chame assim:');
    l.push('  compararComOSistemaDeHoje({ produtos: 1200, estoque: 850 })');
  } else {
    l.push(iguais + ' assunto(s) batendo, ' + diferentes + ' com diferença.');
    l.push(diferentes === 0
      ? 'Os números batem. Isso é condição para virar a chave, não permissão — ' +
        'confira também alguns registros por dentro.'
      : 'Enquanto houver diferença, NÃO vire a chave.');
  }
  return AP_INT_dizer_(l.join('\n'));
}

/* ============================================================
   6. O ESTADO DA INTEGRAÇÃO
   ============================================================ */
function verIntegracao() {
  var l = ['=== INTEGRAÇÃO DOS MÓDULOS ==='];
  var pronto = SERVIDOR.pronto();
  l.push('Servidor ........... ' + (pronto.ok ? 'pronto (' + pronto.dados.versao + ')' : 'NÃO — ' + pronto.mensagem));
  l.push('Modo espelho ....... ' + (espelhoLigado() ? 'LIGADO' : 'desligado'));
  l.push('');
  l.push('ASSUNTOS QUE O SERVIDOR ATENDE');
  var linha = '  ';
  var conta = 0;
  for (var a in AP_INT_BANCOS) {
    if (!AP_INT_BANCOS.hasOwnProperty(a)) continue;
    linha += a + '  ';
    if (++conta % 5 === 0) { l.push(linha); linha = '  '; }
  }
  if (linha.trim()) l.push(linha);
  l.push('');
  l.push('AÇÕES: listar, obter, criar, atualizar, excluir, reativar');
  l.push('');
  l.push('O ALMOXA de hoje continua como está. Esta etapa só deixa a tomada pronta.');
  return AP_INT_dizer_(l.join('\n'));
}

/* ============================================================
   AP_INT_testes() — A PROVA DA ETAPA 6
   ------------------------------------------------------------
   O que mais importa aqui não é o que a integração FAZ — é o que
   ela NÃO faz enquanto ninguém mandou:

   · instalar este arquivo não liga espelho nenhum;
   · o espelho, mesmo ligado, nunca deixa um erro chegar em quem
     chamou — a operação da obra não pode cair por causa de cópia;
   · a API recusa assunto e ação que não conhece, com a lista do
     que conhece, em vez de dar erro seco;
   · só é registrado o módulo cujo arquivo está mesmo no projeto.
   ============================================================ */
function AP_INT_testes() {
  var log = [], falhas = 0;
  function ok(nome, passou, obs) {
    if (!passou) falhas++;
    log.push((passou ? 'PASSOU  ' : 'FALHOU  ') + nome + (obs ? '  [' + obs + ']' : ''));
  }

  var orig = {
    aba: AP_SRV_aba_, mapa: AP_SRV_mapaDeIds, logar: registrarLog,
    inserir: AP_DB_inserir, listar: AP_DB_listar, obter: AP_DB_obter,
    atualizar: AP_DB_atualizar, excluir: AP_DB_excluir,
    registrar: registrarModulo, existe: AP_INT_existe_,
    utils: (typeof Utilities !== 'undefined') ? Utilities : null,
    sess: (typeof Session !== 'undefined') ? Session : null
  };

  try {
    var ABAS = {}, LOGS = [], CHAMADAS = [], MODULOS = [];

    function novaAba(cabecalho, linhas) {
      var dados = [cabecalho.slice()];
      for (var i = 0; i < (linhas || []).length; i++) dados.push(linhas[i].slice());
      var eu = {
        __dados: dados,
        getLastRow: function () { return dados.length; },
        getLastColumn: function () { return cabecalho.length; },
        appendRow: function (l) { dados.push(l.slice()); return eu; },
        getRange: function (l, c, nl, nc) {
          nl = nl || 1; nc = nc || 1;
          return {
            getValues: function () {
              var s = [];
              for (var i = 0; i < nl; i++) {
                var linha = dados[l - 1 + i] || [], pedaco = [];
                for (var j = 0; j < nc; j++) pedaco.push(linha[c - 1 + j] === undefined ? '' : linha[c - 1 + j]);
                s.push(pedaco);
              }
              return s;
            },
            setValues: function (v) {
              for (var i = 0; i < v.length; i++) {
                if (!dados[l - 1 + i]) dados[l - 1 + i] = [];
                for (var j = 0; j < v[i].length; j++) dados[l - 1 + i][c - 1 + j] = v[i][j];
              }
              return this;
            }
          };
        }
      };
      return eu;
    }

    /* a CORE_CONFIGURACAO com o cabeçalho de verdade, do mapa */
    var itemConfig = null;
    for (var z = 0; z < AP_SRV_MAPA.length; z++) {
      if (AP_SRV_MAPA[z].caminho === '00_CORE/CORE_CONFIGURACAO') itemConfig = AP_SRV_MAPA[z];
    }
    ABAS['00_CORE/CORE_CONFIGURACAO'] = novaAba(itemConfig.colunas, []);
    ABAS['01_BANCO_DADOS/DB_PRODUTOS'] = novaAba(['ID_PRODUTO', 'DESCRICAO'],
      [['PRD-1', 'a'], ['PRD-2', 'b'], ['PRD-3', 'c']]);

    Utilities = {
      DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
      computeDigest: function (alg, texto) {
        var h = 0, saida = [];
        for (var k = 0; k < texto.length; k++) h = ((h << 5) - h + texto.charCodeAt(k)) | 0;
        for (var b = 0; b < 8; b++) saida.push((h >> (b * 4)) & 255);
        return saida;
      },
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

    AP_SRV_aba_ = function (c) { return ABAS[c] || null; };
    AP_SRV_mapaDeIds = function () { return { ok: true, versao: '2.0.0-etapa6', raiz: 'RAIZ', itens: {} }; };
    registrarLog = function (t, d) { LOGS.push({ t: t, d: d }); return true; };
    registrarModulo = function (d) { MODULOS.push(d.nome); return { ok: true, criado: true }; };

    AP_DB_inserir = function (banco, dados, token) {
      CHAMADAS.push({ f: 'inserir', banco: banco, dados: dados, token: token });
      return { ok: true, dados: dados, id: 'NOVO-1' };
    };
    AP_DB_listar = function (banco, filtro, token) {
      CHAMADAS.push({ f: 'listar', banco: banco, filtro: filtro, token: token });
      return { ok: true, dados: [], total: 0 };
    };
    AP_DB_obter = function (banco, id, token) {
      CHAMADAS.push({ f: 'obter', banco: banco, id: id, token: token });
      return { ok: true, dados: { ID: id } };
    };
    AP_DB_atualizar = function (banco, id, dados, token) {
      CHAMADAS.push({ f: 'atualizar', banco: banco, id: id, dados: dados, token: token });
      return { ok: true, alterado: true };
    };
    AP_DB_excluir = function (banco, id, motivo, token) {
      CHAMADAS.push({ f: 'excluir', banco: banco, id: id, motivo: motivo, token: token });
      return { ok: true, excluido: true };
    };

    /* ============================================================
       1. A PORTA TRADUZ O ASSUNTO NO BANCO CERTO
       ============================================================ */
    SERVIDOR.criar('produtos', { DESCRICAO: 'Cimento' }, 'TK-1');
    ok('produtos vai para DB_PRODUTOS',
      CHAMADAS[0].banco === 'DB_PRODUTOS' && CHAMADAS[0].token === 'TK-1');

    SERVIDOR.listar('estoque', { PROJETO_ID: 'PRJ-1' }, 'TK-1');
    ok('estoque vai para DB_ESTOQUE, com o filtro',
      CHAMADAS[1].banco === 'DB_ESTOQUE' && CHAMADAS[1].filtro.PROJETO_ID === 'PRJ-1');

    SERVIDOR.criar('obras', { NOME_PROJETO: 'Obra 1' }, 'TK-1');
    ok('dois nomes podem apontar para o mesmo banco (obras = projetos)',
      CHAMADAS[2].banco === 'DB_PROJETOS');

    var semAssunto = SERVIDOR.criar('dinossauros', {}, 'TK-1');
    ok('assunto que não existe é recusado',
      semAssunto.ok === false && semAssunto.codigo === 'ASSUNTO_DESCONHECIDO');
    ok('e a mensagem lista os assuntos que existem',
      semAssunto.mensagem.indexOf('produtos') > -1 && semAssunto.mensagem.indexOf('estoque') > -1);
    ok('assunto desconhecido não chega no banco', CHAMADAS.length === 3);

    /* ============================================================
       2. A API DE UMA ENTRADA SÓ
       ============================================================ */
    var comoTexto = almoxaServidorApi(JSON.stringify({
      modulo: 'produtos', acao: 'criar', sessao: 'TK-9', payload: { dados: { DESCRICAO: 'Areia' } }
    }));
    ok('pedido em texto devolve resposta em texto', typeof comoTexto === 'string');
    var lido = JSON.parse(comoTexto);
    ok('a resposta tem o formato que o ALMOXA já entende',
      lido.ok === true && lido.dados.DESCRICAO === 'Areia');
    ok('a sessão do pedido chegou no banco',
      CHAMADAS[CHAMADAS.length - 1].token === 'TK-9');

    var comoObjeto = almoxaServidorApi({ modulo: 'produtos', acao: 'obter', payload: { id: 'PRD-1' } });
    ok('pedido em objeto devolve objeto', typeof comoObjeto === 'object' && comoObjeto.ok === true);

    var acaoEstranha = almoxaServidorApi({ modulo: 'produtos', acao: 'dançar' });
    ok('ação que não existe é recusada com a lista do que existe',
      acaoEstranha.codigo === 'ACAO_DESCONHECIDA' && acaoEstranha.mensagem.indexOf('listar') > -1);

    var jsonQuebrado = almoxaServidorApi('isso não é json');
    ok('JSON quebrado dá mensagem clara, não erro seco',
      JSON.parse(jsonQuebrado).codigo === 'PEDIDO_INVALIDO');

    AP_DB_inserir = function () { throw new Error('a planilha sumiu'); };
    var explodiu = almoxaServidorApi({ modulo: 'produtos', acao: 'criar', payload: { dados: {} } });
    ok('erro dentro do servidor vira resposta, não exceção',
      explodiu.ok === false && explodiu.codigo === 'FALHA_NO_SERVIDOR');
    ok('e o erro fica no log',
      LOGS.some(function (l) { return l.t === 'ERRO' && l.d.mensagem === 'a planilha sumiu'; }));
    ok('a mensagem diz que nada foi concluído',
      explodiu.mensagem.indexOf('Nada foi concluído') > -1);

    /* ============================================================
       3. O ESPELHO NASCE DESLIGADO
       ============================================================ */
    ok('recém-instalado, o espelho está DESLIGADO', espelhoLigado() === false);

    AP_DB_inserir = function (b, d, t) {
      CHAMADAS.push({ f: 'inserir-espelho', banco: b }); return { ok: true, id: 'X' };
    };
    var comEspelhoDesligado = SERVIDOR.espelhar('produtos', { DESCRICAO: 'não deve copiar' }, 'TK-1');
    ok('com o espelho desligado, nada é copiado',
      comEspelhoDesligado.espelhado === false &&
      !CHAMADAS.some(function (c) { return c.f === 'inserir-espelho'; }));

    var semConfirmar = ativarEspelho();
    ok('ligar sem CONFIRMO não liga', semConfirmar.indexOf('Nada foi ligado') > -1 &&
      espelhoLigado() === false);

    ativarEspelho('CONFIRMO');
    ok('com CONFIRMO, liga', espelhoLigado() === true);
    ok('e a decisão fica gravada na CORE_CONFIGURACAO',
      ABAS['00_CORE/CORE_CONFIGURACAO'].getLastRow() === 2);

    var copiou = SERVIDOR.espelhar('produtos', { DESCRICAO: 'agora copia' }, 'TK-1');
    ok('com o espelho ligado, copia', copiou.espelhado === true);

    /* ---------- o ponto mais importante do arquivo ---------- */
    AP_DB_inserir = function () { throw new Error('servidor fora do ar'); };
    var naoDerrubou = true, resultado = null;
    try { resultado = SERVIDOR.espelhar('produtos', { DESCRICAO: 'x' }, 'TK-1'); }
    catch (e) { naoDerrubou = false; }
    ok('espelho que explode NÃO derruba quem chamou', naoDerrubou === true);
    ok('e devolve ok, porque a operação da obra não falhou',
      resultado && resultado.ok === true && resultado.espelhado === false);
    ok('mas o problema fica registrado',
      LOGS.some(function (l) { return l.t === 'ERRO' && l.d.funcao === 'espelhar'; }));

    AP_DB_inserir = function () {
      return { ok: false, codigo: 'DUPLICADO', mensagem: 'já existe' };
    };
    var recusou = SERVIDOR.espelhar('produtos', {}, 'TK-1');
    ok('cópia recusada pelo servidor também não derruba nada',
      recusou.ok === true && recusou.espelhado === false && recusou.motivo === 'DUPLICADO');
    ok('e vira linha no log de sincronização',
      LOGS.some(function (l) {
        return l.t === 'SINCRONIZACAO' && l.d.resultado === 'FALHOU';
      }));

    desativarEspelho();
    ok('desligar volta ao estado de fábrica', espelhoLigado() === false);
    ok('e não criou segunda linha de configuração',
      ABAS['00_CORE/CORE_CONFIGURACAO'].getLastRow() === 2);

    /* ============================================================
       4. O REGISTRO DOS MÓDULOS
       ============================================================ */
    MODULOS = [];
    AP_INT_existe_ = function (nome) { return nome !== 'doutorDoSistema'; };
    var textoModulos = registrarModulosDoServidor();
    ok('registrou os módulos que existem', MODULOS.indexOf('CORE') > -1 &&
      MODULOS.indexOf('DADOS') > -1 && MODULOS.indexOf('INTEGRACAO') > -1);
    ok('NÃO registrou o módulo cujo arquivo não está no projeto',
      MODULOS.indexOf('DOUTOR') === -1);
    ok('e avisa qual ficou de fora, e por quê',
      textoModulos.indexOf('DOUTOR') > -1 && textoModulos.indexOf('enganaria o Doutor') > -1);
    AP_INT_existe_ = orig.existe;

    /* ============================================================
       5. A COMPARAÇÃO ANTES DE VIRAR A CHAVE
       ============================================================ */
    var comparacao = compararComOSistemaDeHoje({ produtos: 3 });
    ok('quando os números batem, ele diz que batem', comparacao.indexOf('igual') > -1);
    var comDiferenca = compararComOSistemaDeHoje({ produtos: 10 });
    ok('quando não batem, mostra a diferença', comDiferenca.indexOf('-7') > -1);
    ok('e manda NÃO virar a chave', comDiferenca.indexOf('NÃO vire a chave') > -1);
    ok('sem contagens, explica como usar',
      compararComOSistemaDeHoje().indexOf('compararComOSistemaDeHoje({') > -1);

    /* ============================================================
       5b. A CHAVE DE PARTIDA
       ============================================================ */
    var usuariosItem = null;
    for (var u = 0; u < AP_SRV_MAPA.length; u++) {
      if (AP_SRV_MAPA[u].caminho === '01_BANCO_DADOS/DB_USUARIOS') usuariosItem = AP_SRV_MAPA[u];
    }
    ABAS['01_BANCO_DADOS/DB_USUARIOS'] = novaAba(usuariosItem.colunas, []);
    ABAS['00_CORE/CORE_SESSOES'] = novaAba(
      ['ID_SESSAO', 'TOKEN_HASH', 'USUARIO_ID', 'PERFIL', 'EMPRESA_ID', 'OBRA_ID',
       'ORIGEM', 'DATA_INICIO', 'DATA_EXPIRACAO', 'ULTIMO_ACESSO', 'STATUS', 'SYNC_ID'], []);

    ok('primeiroAcesso sem os dados explica como chamar',
      primeiroAcesso().indexOf('primeiroAcesso("Ismael Silva"') > -1);

    var criados = [];
    AP_DB_inserir = function (banco, dados, token) {
      criados.push({ banco: banco, dados: dados, token: token });
      var linha = [];
      for (var c = 0; c < usuariosItem.colunas.length; c++) linha.push('');
      AP_SRV_por_(linha, usuariosItem.colunas, 'ID_USUARIO', 'USU-1');
      AP_SRV_por_(linha, usuariosItem.colunas, 'NOME', dados.NOME);
      AP_SRV_por_(linha, usuariosItem.colunas, 'MATRICULA', dados.MATRICULA);
      AP_SRV_por_(linha, usuariosItem.colunas, 'PERFIL', dados.PERFIL);
      ABAS['01_BANCO_DADOS/DB_USUARIOS'].appendRow(linha);
      return { ok: true, dados: { ID_USUARIO: 'USU-1' }, id: 'USU-1' };
    };

    var primeiro = primeiroAcesso('Ismael Silva', '12345', 'i@coesa.com');
    ok('primeiroAcesso cadastra o usuário com perfil admin',
      criados.length === 1 && criados[0].dados.PERFIL === 'admin' &&
      criados[0].banco === 'DB_USUARIOS');
    ok('e usa uma sessão de instalação de verdade', !!criados[0].token);
    ok('e avisa que a porta fechou', primeiro.indexOf('FECHADA') > -1);

    var segundaVez = primeiroAcesso('Outra Pessoa', '99999');
    ok('com usuário cadastrado, a porta de primeiro acesso NÃO abre mais',
      segundaVez.indexOf('JÁ EXISTE') > -1 && criados.length === 1);
    ok('e ensina o caminho certo', segundaVez.indexOf('entrarComo') > -1);

    var entrada = entrarComo('12345');
    ok('entrarComo acha o usuário e abre sessão', entrada.indexOf('SESSÃO ABERTA') > -1);
    ok('e mostra a chave com o aviso de não deixar à vista',
      entrada.indexOf('CHAVE DA SESSÃO') > -1 && entrada.indexOf('outras pessoas leiam') > -1);
    ok('matrícula que não existe dá mensagem clara',
      entrarComo('00000').indexOf('Não achei ninguém') > -1);

    /* ============================================================
       6. O ESTADO
       ============================================================ */
    var estado = verIntegracao();
    ok('verIntegracao mostra se o servidor está pronto', estado.indexOf('2.0.0-etapa6') > -1);
    ok('mostra o espelho desligado', estado.indexOf('desligado') > -1);
    ok('e deixa claro que nada do ALMOXA mudou',
      estado.indexOf('continua como está') > -1);

  } catch (explodiuTudo) {
    falhas++;
    log.push('FALHOU  o teste explodiu: ' + (explodiuTudo && explodiuTudo.stack || explodiuTudo));
  } finally {
    AP_SRV_aba_ = orig.aba;
    AP_SRV_mapaDeIds = orig.mapa;
    registrarLog = orig.logar;
    registrarModulo = orig.registrar;
    AP_DB_inserir = orig.inserir;
    AP_DB_listar = orig.listar;
    AP_DB_obter = orig.obter;
    AP_DB_atualizar = orig.atualizar;
    AP_DB_excluir = orig.excluir;
    AP_INT_existe_ = orig.existe;
    if (orig.utils) Utilities = orig.utils;
    if (orig.sess) Session = orig.sess;
  }

  var texto = '=== ETAPA 6 — INTEGRAÇÃO — ' +
    (falhas ? falhas + ' FALHA(S) DE ' + log.length : 'TODOS OS ' + log.length + ' TESTES PASSARAM') +
    ' ===\n' + log.join('\n');
  try { Logger.log(texto); } catch (e) { }
  return { ok: falhas === 0, total: log.length, falhas: falhas, texto: texto };
}

/* ============================================================
   7. A CHAVE DE PARTIDA
   ------------------------------------------------------------
   O problema do ovo e da galinha: para gravar qualquer coisa no
   servidor é preciso uma sessão; para ter sessão é preciso um
   usuário; e para cadastrar o primeiro usuário seria preciso...
   uma sessão.

   primeiroAcesso() é a única porta que abre sem chave — e só
   funciona enquanto DB_USUARIOS estiver VAZIO. Cadastrado o
   primeiro, ela se fecha sozinha e nunca mais abre. Não é
   elegância: é que uma porta de emergência que continua
   destrancada depois da emergência é só uma porta destrancada.
   ============================================================ */
function primeiroAcesso(nome, matricula, email) {
  if (!nome || !matricula) {
    return AP_INT_dizer_(
      'Chame assim, com os SEUS dados:\n\n' +
      '  primeiroAcesso("Ismael Silva", "12345", "seu@email.com")\n\n' +
      'Isso cadastra o primeiro usuário do servidor, com perfil admin.\n' +
      'Só funciona uma vez: depois que existir usuário, esta porta fecha.');
  }

  var aba = AP_SRV_aba_('01_BANCO_DADOS/DB_USUARIOS');
  if (!aba) return AP_INT_dizer_('O banco DB_USUARIOS não existe. Rode instalarServidor().');
  if (aba.getLastRow() > 1) {
    return AP_INT_dizer_(
      'JÁ EXISTE usuário cadastrado. Esta porta está fechada, e é assim mesmo.\n\n' +
      'Para entrar, use:  entrarComo("' + matricula + '")\n' +
      'Para cadastrar mais gente, use o servidor com a sessão de um admin.');
  }

  /* a sessão de instalação: vive o tempo de cadastrar um usuário */
  var chave = AP_SEG_abrirSessao(
    { id: 'INSTALACAO', perfil: 'admin' }, { origem: 'primeiro acesso', horas: 1 });
  if (!chave.ok) return AP_INT_dizer_('Não consegui abrir a sessão de instalação: ' + chave.mensagem);

  var r = SERVIDOR.criar('usuarios', {
    NOME: nome, MATRICULA: String(matricula), EMAIL: email || '', PERFIL: 'admin'
  }, chave.dados.token);

  AP_SEG_encerrarSessao(chave.dados.token);

  if (!r.ok) return AP_INT_dizer_('Não consegui cadastrar: ' + r.mensagem);

  registrarLog('ACESSO', {
    usuario: r.dados.ID_USUARIO, acao: 'primeiro acesso do servidor',
    origem: 'primeiroAcesso', resultado: 'OK', detalhe: nome
  });

  return AP_INT_dizer_(
    '=== PRIMEIRO USUÁRIO CADASTRADO ===\n' +
    'Nome ......... ' + nome + '\n' +
    'Matrícula .... ' + matricula + '\n' +
    'Perfil ....... admin\n' +
    'ID ........... ' + r.dados.ID_USUARIO + '\n\n' +
    'A porta de primeiro acesso está FECHADA a partir de agora.\n\n' +
    'Agora entre com:  entrarComo("' + matricula + '")');
}

/* ------------------------------------------------------------
   entrarComo — abre uma sessão de verdade e mostra a chave.

   O token aparece no Registro de execução. Isso é aceitável para
   configurar e testar, e NÃO é aceitável no dia a dia: quem lê o
   registro passa a entrar como você. Por isso a sessão daqui vale
   poucas horas, e por isso o sistema de verdade vai abrir sessão
   sozinho, sem mostrar nada a ninguém.
   ------------------------------------------------------------ */
function entrarComo(matricula) {
  if (!matricula) {
    return AP_INT_dizer_('Chame assim:  entrarComo("12345")');
  }
  var aba = AP_SRV_aba_('01_BANCO_DADOS/DB_USUARIOS');
  if (!aba || aba.getLastRow() < 2) {
    return AP_INT_dizer_('Não há usuário nenhum ainda. Rode primeiroAcesso() antes.');
  }

  var colunas = AP_SRV_colunasDe_(aba);
  var linhas = aba.getRange(2, 1, aba.getLastRow() - 1, aba.getLastColumn()).getValues();
  var iMat = colunas.indexOf('MATRICULA'), iExc = colunas.indexOf('EXCLUIDO');

  for (var i = 0; i < linhas.length; i++) {
    if (String(linhas[i][iMat]).trim() !== String(matricula).trim()) continue;
    if (iExc > -1 && String(linhas[i][iExc] || '').toUpperCase() === 'SIM') {
      return AP_INT_dizer_('Esse usuário está excluído. Reative antes de entrar.');
    }

    var s = AP_SEG_abrirSessao({
      id: linhas[i][colunas.indexOf('ID_USUARIO')],
      perfil: linhas[i][colunas.indexOf('PERFIL')],
      empresa: linhas[i][colunas.indexOf('EMPRESA_ID')],
      obra: linhas[i][colunas.indexOf('OBRA_ID')]
    }, { origem: 'editor', horas: 8 });

    if (!s.ok) return AP_INT_dizer_('Não consegui abrir a sessão: ' + s.mensagem);

    return AP_INT_dizer_(
      '=== SESSÃO ABERTA ===\n' +
      'Quem ......... ' + linhas[i][colunas.indexOf('NOME')] +
      '  (' + linhas[i][colunas.indexOf('PERFIL')] + ')\n' +
      'Vale até ..... ' + s.dados.expira + '\n\n' +
      'CHAVE DA SESSÃO:\n' + s.dados.token + '\n\n' +
      'Copie essa chave para testar uma gravação de verdade:\n\n' +
      '  gravarNoServidor("fornecedores",\n' +
      '    { RAZAO_SOCIAL: "Nome do fornecedor", CNPJ: "00.000.000/0001-00" },\n' +
      '    "cole-a-chave-aqui")\n\n' +
      'Não deixe essa chave em lugar que outras pessoas leiam.');
  }
  return AP_INT_dizer_('Não achei ninguém com a matrícula ' + matricula + '.');
}

/* ------------------------------------------------------------
   gravarNoServidor — gravar do editor, com todas as regras
   valendo. Serve para você ver o dado entrar na planilha com os
   próprios olhos antes de ligar qualquer tela.
   ------------------------------------------------------------ */
function gravarNoServidor(assunto, dados, token) {
  if (!assunto || !dados || !token) {
    return AP_INT_dizer_(
      'Chame assim:\n\n' +
      '  gravarNoServidor("fornecedores", { RAZAO_SOCIAL: "Fulano ME" }, "sua-chave")\n\n' +
      'A chave sai do entrarComo().');
  }
  var r = SERVIDOR.criar(assunto, dados, token);
  if (!r.ok) {
    return AP_INT_dizer_('NÃO GRAVOU.\nMotivo: ' + r.codigo + '\n' + r.mensagem);
  }
  var banco = SERVIDOR.banco(assunto);
  return AP_INT_dizer_(
    '=== GRAVADO ===\n' +
    'Banco ..... ' + banco + '\n' +
    'ID ........ ' + r.id + '\n\n' +
    'Abra a planilha ' + banco + ' no Drive: a linha está lá, com data,\n' +
    'com o seu nome na coluna do responsável e com a versão 1.');
}

function TESTE_GRAVAR() {
  var aba = AP_SRV_aba_('01_BANCO_DADOS/DB_USUARIOS');
  if (!aba) return AP_INT_dizer_('Não achei o banco DB_USUARIOS.');
  if (aba.getLastRow() < 2) return AP_INT_dizer_('O DB_USUARIOS está vazio.');

  var cols = AP_SRV_colunasDe_(aba);
  var eu = aba.getRange(2, 1, 1, aba.getLastColumn()).getValues()[0];
  var id = eu[cols.indexOf('ID_USUARIO')];
  var perfil = eu[cols.indexOf('PERFIL')];

  var s = SERVIDOR.abrirSessao({ id: id, perfil: perfil }, { origem: 'teste no editor' });
  if (!s.ok) {
    return AP_INT_dizer_('NÃO ABRIU A SESSÃO.\n' +
      'Motivo: ' + s.codigo + '\n' + s.mensagem +
      '\n\nusuário lido: id="' + id + '"  perfil="' + perfil + '"');
  }

  return gravarNoServidor("fornecedores",
    { RAZAO_SOCIAL: "Um fornecedor seu", CNPJ: "11.222.333/0001-44" },
    s.dados.token);



    function DIAGNOSTICO_USUARIO() {
  var l = ['=== POR QUE NÃO GRAVA ==='];

  var aba = AP_SRV_aba_('01_BANCO_DADOS/DB_USUARIOS');
  l.push('1. DB_USUARIOS abre? ........ ' + (aba ? 'SIM' : 'NÃO'));
  if (aba) l.push('   linhas: ' + aba.getLastRow() + '   colunas: ' + aba.getLastColumn());

  var t = AP_DB_tabela_('DB_USUARIOS');
  l.push('2. O servidor enxerga? ...... ' + (t ? 'SIM' : 'NÃO'));

  var perm = AP_SRV_aba_('00_CORE/CORE_PERMISSOES');
  l.push('3. Regras de permissão ...... ' + (perm ? (perm.getLastRow() - 1) : 'planilha não abre'));

  var ses = AP_SRV_aba_('00_CORE/CORE_SESSOES');
  l.push('4. CORE_SESSOES abre? ....... ' + (ses ? 'SIM' : 'NÃO'));
  if (ses) l.push('   colunas: ' + AP_SRV_colunasDe_(ses).join(', '));

  var s = AP_SEG_abrirSessao({ id: 'DIAGNOSTICO', perfil: 'admin' }, { origem: 'diagnostico' });
  l.push('5. Abrir sessão ............. ' + (s.ok ? 'OK' : s.codigo + ' — ' + s.mensagem));

  if (s.ok) {
    var p = AP_SEG_podeFazer(s.dados, 'usuarios', 'criar');
    l.push('6. Pode criar usuário? ...... ' + (p.ok ? 'SIM' : p.codigo + ' — ' + p.mensagem));
    AP_SEG_encerrarSessao(s.dados.token);
  }

  return AP_INT_dizer_(l.join('\n'));
}
}