/**
 * ============================================================
 * ALMOX_PRO_Notas_Alterar.gs
 * ------------------------------------------------------------
 * A PEÇA QUE FALTAVA: alterar e excluir nota fiscal já lançada.
 *
 * Sem este arquivo, a tela de edição manda a correção, a ponte
 * responde "ok" e nada muda na planilha — foi o que você viu.
 *
 * O QUE ELE ATENDE (rota "nfed")
 *   atualizar          corrige o cabeçalho e a lista de itens
 *   excluir            marca a nota inteira como EXCLUIDA
 *   removerLancamento  marca UM lançamento da nota
 *   diagnostico        só olha e conta; não muda nada
 *
 * REGRAS QUE ELE SEGUE
 *   · NADA é apagado fisicamente. Linha some da conta virando
 *     status EXCLUIDA, e o histórico fica.
 *   · NUNCA acrescenta linha numa correção. Foi acrescentar que
 *     dobrou a nota 53072. Aqui a correção ESCREVE POR CIMA da
 *     primeira linha da nota e marca as demais como substituídas.
 *   · Não cria aba, não cria "Cópia de", não renomeia nada.
 *   · Não inventa coluna. Se uma coluna esperada não existir, ele
 *     grava o que dá e DIZ na resposta o que não coube.
 *   · Só responde ok:true depois de RELER a linha e conferir.
 *
 * COMO INSTALAR
 *   1. Apps Script do ALMOX-PRO → + Arquivo → Script
 *   2. Nome: ALMOX_PRO_Notas_Alterar   (o .gs entra sozinho)
 *   3. Cole este conteúdo e salve.
 *   4. No mapa de módulos do almoxaApi, aponte "nfed" para
 *      AP_Modulo_nfed. Se o seu roteador já procura a função pelo
 *      nome AP_Modulo_<rota>, não precisa mexer em nada.
 *   5. Publique de novo (Implantar → Gerenciar implantações →
 *      editar → Nova versão). Sem isso a /exec continua servindo
 *      a versão antiga.
 *   6. Na tela, abra uma nota e clique em "Salvar as correções".
 *      A resposta crua do Core aparece no quadro.
 *
 * PARA CONFERIR SEM MEXER EM NADA
 *   Rode a função AP_NFED_diagnostico() aqui no editor e olhe o
 *   Registro de execução: ele diz qual aba achou, quais colunas
 *   reconheceu e quantas notas existem.
 * ============================================================ */

/* nomes de aba que costumam guardar as notas; se nenhum existir,
   o arquivo procura pelo CABEÇALHO, que é mais confiável que o nome */
var NFED_ABAS_PROVAVEIS = [
  'NOTAS', 'NOTAS_FISCAIS', 'NOTAS FISCAIS', 'NF', 'NFE',
  'ENTRADAS', 'NOTAS_ENTRADA', 'LANCAMENTOS'
];

/* ---------- utilidades miúdas ---------- */

function nfedTexto_(v) {
  return (v === null || v === undefined) ? '' : String(v).trim();
}

/* "Nº da Nota" e "numero_nota" viram a mesma chave: numeronota */
function nfedChaveCol_(v) {
  var t = nfedTexto_(v).toLowerCase();
  t = t.replace(/[áàâãä]/g, 'a').replace(/[éèêë]/g, 'e')
       .replace(/[íìîï]/g, 'i').replace(/[óòôõö]/g, 'o')
       .replace(/[úùûü]/g, 'u').replace(/[ç]/g, 'c');
  return t.replace(/[^a-z0-9]/g, '');
}

function nfedSoNumeros_(v) {
  return nfedTexto_(v).replace(/\D/g, '');
}

function nfedNumero_(v) {
  if (typeof v === 'number') return v;
  var t = nfedTexto_(v).replace(/[R$\s]/g, '');
  if (t.indexOf(',') >= 0) t = t.replace(/\./g, '').replace(',', '.');
  var n = Number(t);
  return isFinite(n) ? n : 0;
}

/* a MESMA identidade que a tela usa, para os dois lados concordarem
   sobre o que é "a mesma nota" */
function nfedIdentidade_(n) {
  if (!n) return '';
  var chave = nfedSoNumeros_(n.chave);
  if (chave.length >= 20) return 'NFE:' + chave;
  var num = nfedSoNumeros_(n.numero) || nfedTexto_(n.numero).toUpperCase();
  if (!num) return '';
  var serie = nfedSoNumeros_(n.serie);
  var cnpj = nfedSoNumeros_(n.cnpj);
  return 'NUM:' + num + '|' + serie + '|' + cnpj;
}

/* ---------- achar a aba e entender as colunas ---------- */

function nfedAcharAba_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var i, aba;

  for (i = 0; i < NFED_ABAS_PROVAVEIS.length; i++) {
    aba = ss.getSheetByName(NFED_ABAS_PROVAVEIS[i]);
    if (aba) return aba;
  }
  /* nome não bateu: procura pelo cabeçalho. Uma aba de notas tem
     número da nota e, quase sempre, fornecedor ou a lista de itens. */
  var todas = ss.getSheets();
  for (i = 0; i < todas.length; i++) {
    var larg = todas[i].getLastColumn();
    if (larg < 2) continue;
    var cab = todas[i].getRange(1, 1, 1, larg).getValues()[0].map(nfedChaveCol_);
    var temNum = cab.indexOf('numero') > -1 || cab.indexOf('numeronota') > -1 ||
                 cab.indexOf('numeronf') > -1 || cab.indexOf('nf') > -1;
    var temPista = cab.indexOf('fornecedor') > -1 || cab.indexOf('itens') > -1 ||
                   cab.indexOf('listaitens') > -1 || cab.indexOf('chave') > -1;
    if (temNum && temPista) return todas[i];
  }
  return null;
}

/* apelidos aceitos para cada campo; o primeiro que existir vence */
var NFED_APELIDOS = {
  numero:      ['numero', 'numeronota', 'numeronf', 'nnf', 'nf', 'nota'],
  serie:       ['serie'],
  chave:       ['chave', 'chaveacesso', 'chavedeacesso'],
  cnpj:        ['cnpj', 'cnpjfornecedor', 'cnpjemitente'],
  fornecedor:  ['fornecedor', 'emitente', 'razaosocial'],
  emissao:     ['emissao', 'dataemissao', 'dtemissao'],
  entrada:     ['entrada', 'dataentrada', 'dtentrada', 'lancadoem', 'criadoem'],
  valor:       ['valor', 'valortotal', 'valordanota', 'total'],
  status:      ['status', 'situacao'],
  origem:      ['origem'],
  /* A LISTA e a CONTAGEM sao colunas diferentes. No sistema,
     "itens" é o NÚMERO de itens e "listaItens" é a lista. Procurar
     'itens' primeiro fazia eu gravar o JSON na coluna da contagem. */
  itens:       ['listaitens', 'itensjson', 'produtos', 'itenslista'],
  contagem:    ['itens', 'qtditens', 'qtdeitens', 'totalitens'],
  idLanc:      ['idlanc', 'idlancamento', 'id', 'protocolo'],
  editadoPor:  ['editadopor'],
  editadoEm:   ['editadoem'],
  editadoMat:  ['editadomatricula'],
  motivo:      ['motivoedicao', 'motivo', 'observacao', 'obs'],
  statusAnterior: ['statusanterior', 'statusantes'],
  excluidoEm:  ['excluidoem', 'dataexclusao'],
  excluidoPor: ['excluidopor']
};

/* palavra que basta aparecer DENTRO do nome da coluna. Serve para
   cabeçalhos escritos como gente escreve: "Nº da Nota" vira
   "ndanota", "Valor Total da NF" vira "valortotaldanf". */
var NFED_PEDACOS = {
  chave:       ['chave'],
  cnpj:        ['cnpj'],
  fornecedor:  ['fornecedor', 'emitente'],
  emissao:     ['emissao'],
  entrada:     ['entrada', 'lancadoem'],
  valor:       ['valor', 'total'],
  status:      ['status', 'situacao'],
  origem:      ['origem'],
  itens:       ['listaitens', 'itensjson', 'produtos'],
  contagem:    ['qtditens', 'totalitens'],
  idLanc:      ['idlanc', 'protocolo'],
  editadoPor:  ['editadopor'],
  editadoEm:   ['editadoem'],
  editadoMat:  ['editadomatricula'],
  motivo:      ['motivo'],
  serie:       ['serie'],
  numero:      ['numero', 'nota', 'nnf']
};
/* a ordem importa: quem é mais específico escolhe primeiro, senão
   "numero" roubaria a coluna "Nº do Lançamento" */
var NFED_ORDEM = ['chave','cnpj','fornecedor','emissao','entrada','valor','status',
                  'origem','itens','contagem','idLanc','editadoPor','editadoEm',
                  'editadoMat','motivo','serie','numero'];

function nfedMapa_(aba) {
  var larg = aba.getLastColumn();
  var cab = aba.getRange(1, 1, 1, larg).getValues()[0].map(nfedChaveCol_);
  var mapa = {};
  var usada = {};

  /* 1ª passada: nome exato, que é a mais confiável */
  for (var campo in NFED_APELIDOS) {
    if (!NFED_APELIDOS.hasOwnProperty(campo)) continue;
    var apelidos = NFED_APELIDOS[campo];
    for (var k = 0; k < apelidos.length; k++) {
      var c = cab.indexOf(apelidos[k]);
      if (c > -1 && !usada[c]) { mapa[campo] = c + 1; usada[c] = true; break; }
    }
  }

  /* 2ª passada: o apelido DENTRO do nome da coluna */
  for (var o = 0; o < NFED_ORDEM.length; o++) {
    var alvo = NFED_ORDEM[o];
    if (mapa[alvo]) continue;
    var pedacos = NFED_PEDACOS[alvo] || [];
    var achou = -1;
    for (var pi = 0; pi < pedacos.length && achou < 0; pi++) {
      for (var ci = 0; ci < cab.length; ci++) {
        if (usada[ci] || !cab[ci]) continue;
        if (cab[ci].indexOf(pedacos[pi]) > -1) { achou = ci; break; }
      }
    }
    if (achou > -1) { mapa[alvo] = achou + 1; usada[achou] = true; }
  }

  /* Nenhuma coluna de LISTA? Talvez a planilha guarde o JSON na
     própria coluna "itens". Só uso ela para isso se o conteúdo for
     mesmo uma lista — se for número, é contagem, e gravar JSON ali
     estragaria a coluna. */
  if (!mapa.itens && mapa.contagem) {
    var amostra = '';
    try {
      if (aba.getLastRow() > 1) {
        amostra = nfedTexto_(aba.getRange(2, mapa.contagem).getValue());
      }
    } catch (e) { amostra = ''; }
    if (amostra.charAt(0) === '[') {
      mapa.itens = mapa.contagem;
      delete mapa.contagem;
    }
  }

  mapa.__cabecalho = cab;
  mapa.__largura = larg;
  return mapa;
}

/* lê uma linha como objeto de nota */
function nfedLerLinha_(valores, mapa) {
  function col(campo) {
    var c = mapa[campo];
    return c ? valores[c - 1] : '';
  }
  return {
    numero: nfedTexto_(col('numero')),
    serie: nfedTexto_(col('serie')),
    chave: nfedTexto_(col('chave')),
    cnpj: nfedTexto_(col('cnpj')),
    fornecedor: nfedTexto_(col('fornecedor')),
    valor: nfedNumero_(col('valor')),
    status: nfedTexto_(col('status')).toUpperCase(),
    idLanc: nfedTexto_(col('idLanc')),
    itensCru: col('itens')
  };
}

/* as linhas vivas de uma nota, de cima para baixo */
function nfedLinhasDaNota_(aba, mapa, alvo) {
  var ultima = aba.getLastRow();
  if (ultima < 2) return [];
  var dados = aba.getRange(2, 1, ultima - 1, mapa.__largura).getValues();
  var id = nfedIdentidade_(alvo);
  var achadas = [];
  for (var i = 0; i < dados.length; i++) {
    var n = nfedLerLinha_(dados[i], mapa);
    if (n.status === 'EXCLUIDA') continue;
    if (nfedIdentidade_(n) !== id) continue;
    achadas.push({ linha: i + 2, dados: n, bruto: dados[i] });
  }
  return achadas;
}

function nfedMarcarExcluida_(aba, mapa, linha, motivo, quem, matricula) {
  /* [1.3] guarda o status de antes, para a restauração devolver a
     nota ao estado em que ela estava — e não a um estado chutado */
  if (mapa.status && mapa.statusAnterior) {
    var antes = nfedTexto_(aba.getRange(linha, mapa.status).getValue()).toUpperCase();
    if (antes && antes !== 'EXCLUIDA') {
      aba.getRange(linha, mapa.statusAnterior).setValue(antes);
    }
  }
  if (mapa.excluidoEm) aba.getRange(linha, mapa.excluidoEm).setValue(new Date().toISOString());
  if (mapa.excluidoPor) aba.getRange(linha, mapa.excluidoPor).setValue(nfedTexto_(quem));
  if (mapa.status) aba.getRange(linha, mapa.status).setValue('EXCLUIDA');
  if (mapa.motivo) aba.getRange(linha, mapa.motivo).setValue(nfedTexto_(motivo));
  if (mapa.editadoPor) aba.getRange(linha, mapa.editadoPor).setValue(nfedTexto_(quem));
  if (mapa.editadoMat) aba.getRange(linha, mapa.editadoMat).setValue(nfedTexto_(matricula));
  if (mapa.editadoEm) aba.getRange(linha, mapa.editadoEm).setValue(new Date().toISOString());
}

function nfedResposta_(ok, codigo, mensagem, dados) {
  return { ok: !!ok, codigo: codigo || '', mensagem: mensagem || '', dados: dados || null };
}

/* ============================================================
 * AS AÇÕES
 * ============================================================ */

function nfedDiagnostico_() {
  var aba = nfedAcharAba_();
  if (!aba) {
    return nfedResposta_(false, 'SEM_ABA_DE_NOTAS',
      'Não achei a aba das notas. Procurei por ' + NFED_ABAS_PROVAVEIS.join(', ') +
      ' e também por um cabeçalho com número da nota.');
  }
  var mapa = nfedMapa_(aba);
  var faltando = [];
  ['numero', 'itens', 'status'].forEach(function (c) {
    if (!mapa[c]) faltando.push(c === 'itens' ? 'listaItens (a LISTA, não a contagem)' : c);
  });
  return nfedResposta_(true, '', 'Diagnóstico da edição de notas', {
    aba: aba.getName(),
    linhas: Math.max(0, aba.getLastRow() - 1),
    colunasReconhecidas: (function () {
      var o = {};
      for (var k in mapa) {
        if (k.indexOf('__') === 0) continue;
        o[k] = mapa[k];
      }
      return o;
    })(),
    cabecalhoDaPlanilha: mapa.__cabecalho,
    colunasEssenciaisFaltando: faltando,
    podeAlterar: faltando.length === 0,
    abaDeItens: (function () {
      var ai = nfedAcharAbaDeItens_();
      if (!ai) return 'NAO ENCONTRADA';
      var mi = nfedMapaDeItens_(ai);
      return {
        aba: ai.getName(),
        linhas: Math.max(0, ai.getLastRow() - 1),
        colunas: (function () {
          var o = {};
          for (var k in mi) { if (k.indexOf('__') !== 0) o[k] = mi[k]; }
          return o;
        })(),
        cabecalho: mi.__cabecalho
      };
    })(),
    moduloDeNotasOriginal: (function () {
      for (var i = 0; i < NFED_NOMES_DO_MODULO_DE_NOTAS.length; i++) {
        if (nfedGlobal_(NFED_NOMES_DO_MODULO_DE_NOTAS[i])) {
          return NFED_NOMES_DO_MODULO_DE_NOTAS[i];
        }
      }
      return 'NAO ENCONTRADO — se a tela de notas parar de carregar, ' +
             'confira se o arquivo do módulo de notas ainda existe no projeto';
    })(),
    versaoDoArquivo: 'nfed 1.4'
  });
}

function nfedAtualizar_(p) {
  p = p || {};
  if (!nfedTexto_(p.numero) && !nfedTexto_(p.chave)) {
    return nfedResposta_(false, 'SEM_IDENTIFICACAO',
      'A nota precisa de número ou chave de acesso para ser localizada.');
  }
  var lista = p.listaItens;
  if (!lista || !lista.length) {
    return nfedResposta_(false, 'SEM_ITENS',
      'A correção veio sem itens. Para zerar uma nota use a exclusão, que guarda o histórico.');
  }

  var aba = nfedAcharAba_();
  if (!aba) return nfedResposta_(false, 'SEM_ABA_DE_NOTAS', 'Não achei a aba das notas.');
  var mapa = nfedMapa_(aba);
  if (!mapa.numero || !mapa.itens) {
    return nfedResposta_(false, 'COLUNAS_FALTANDO',
      'Na aba ' + aba.getName() + ' eu não achei ' +
      (!mapa.numero ? 'a coluna do número da nota' : '') +
      (!mapa.numero && !mapa.itens ? ' nem ' : '') +
      (!mapa.itens ? 'a coluna que guarda a LISTA de itens (procurei por ' +
        'ListaItens, ItensJson, Produtos). A coluna "Itens", quando guarda só o ' +
        'número de itens, não serve — gravar a lista nela estragaria a contagem' : '') +
      '. Nada foi gravado.',
      { cabecalho: mapa.__cabecalho });
  }

  var trava = LockService.getScriptLock();
  try { trava.waitLock(20000); }
  catch (e) {
    return nfedResposta_(false, 'OCUPADO',
      'Outra pessoa está gravando agora. Espere alguns segundos e tente de novo.');
  }

  try {
    var linhas = nfedLinhasDaNota_(aba, mapa, p);
    if (!linhas.length) {
      return nfedResposta_(false, 'NOTA_NAO_ENCONTRADA',
        'Não achei essa nota na planilha. Nada foi gravado.',
        { identidadeProcurada: nfedIdentidade_(p) });
    }

    /* A CORREÇÃO ESCREVE POR CIMA. Nunca acrescenta linha: foi
       acrescentar que dobrou a nota 53072. */
    var alvo = linhas[0].linha;
    var naoCoube = [];

    function escreve(campo, valor) {
      if (!mapa[campo]) { naoCoube.push(campo); return; }
      aba.getRange(alvo, mapa[campo]).setValue(valor);
    }

    var itensJson = JSON.stringify(lista);
    var somaItens = 0;
    for (var i = 0; i < lista.length; i++) {
      var it = lista[i] || {};
      var vt = Number(it.valorTotal);
      if (!isFinite(vt) || !vt) vt = (Number(it.qtd) || 0) * (Number(it.valorUnitario) || 0);
      somaItens += Number(vt) || 0;
    }
    somaItens = Math.round(somaItens * 100) / 100;

    escreve('numero', nfedTexto_(p.numero));
    escreve('serie', nfedTexto_(p.serie));
    escreve('chave', nfedTexto_(p.chave));
    escreve('cnpj', nfedTexto_(p.cnpj));
    escreve('fornecedor', nfedTexto_(p.fornecedor));
    escreve('emissao', nfedTexto_(p.emissao));
    escreve('valor', nfedNumero_(p.valor) || somaItens);
    escreve('itens', itensJson);
    /* a coluna de contagem recebe o NÚMERO, não o JSON */
    if (mapa.contagem) aba.getRange(alvo, mapa.contagem).setValue(lista.length);
    if (mapa.status) aba.getRange(alvo, mapa.status).setValue(nfedTexto_(p.status) || 'LANCADA');
    if (mapa.editadoPor) aba.getRange(alvo, mapa.editadoPor).setValue(nfedTexto_(p.editadoPor));
    if (mapa.editadoMat) aba.getRange(alvo, mapa.editadoMat).setValue(nfedTexto_(p.editadoMatricula));
    if (mapa.editadoEm) aba.getRange(alvo, mapa.editadoEm).setValue(nfedTexto_(p.editadoEm) || new Date().toISOString());
    if (mapa.motivo) aba.getRange(alvo, mapa.motivo).setValue(nfedTexto_(p.motivoEdicao));

    /* as outras linhas da MESMA nota viram substituídas, para a soma
       não contar duas vezes — e continuam na planilha, com histórico */
    var substituidas = 0;
    for (var k = 1; k < linhas.length; k++) {
      nfedMarcarExcluida_(aba, mapa, linhas[k].linha,
        'substituída pela correção de ' + (nfedTexto_(p.editadoPor) || 'alguém'),
        p.editadoPor, p.editadoMatricula);
      substituidas++;
    }

    SpreadsheetApp.flush();

    /* SÓ AGORA DIGO QUE DEU CERTO — depois de reler a linha */
    var confere = nfedLerLinha_(
      aba.getRange(alvo, 1, 1, mapa.__largura).getValues()[0], mapa);
    var gravados = [];
    try { gravados = JSON.parse(confere.itensCru || '[]'); } catch (e) { gravados = []; }

    if (gravados.length !== lista.length) {
      return nfedResposta_(false, 'GRAVACAO_NAO_CONFERE',
        'Escrevi na linha ' + alvo + ' mas a releitura trouxe ' + gravados.length +
        ' item(ns) em vez de ' + lista.length + '. Confira a planilha antes de tentar de novo.',
        { linha: alvo, aba: aba.getName() });
    }

    return nfedResposta_(true, '', 'Nota corrigida.', {
      aba: aba.getName(),
      linha: alvo,
      itensGravados: gravados.length,
      valorGravado: nfedNumero_(confere.valor),
      somaDosItens: somaItens,
      linhasSubstituidas: substituidas,
      camposQueNaoCouberam: naoCoube
    });
  } finally {
    trava.releaseLock();
  }
}

function nfedExcluir_(p) {
  p = p || {};
  var aba = nfedAcharAba_();
  if (!aba) return nfedResposta_(false, 'SEM_ABA_DE_NOTAS', 'Não achei a aba das notas.');
  var mapa = nfedMapa_(aba);
  if (!mapa.status) {
    return nfedResposta_(false, 'SEM_COLUNA_STATUS',
      'A aba ' + aba.getName() + ' não tem coluna de status. Sem ela eu teria de apagar a ' +
      'linha de verdade, e isso eu não faço.');
  }
  var trava = LockService.getScriptLock();
  try { trava.waitLock(20000); } catch (e) {
    return nfedResposta_(false, 'OCUPADO', 'Outra pessoa está gravando agora.');
  }
  try {
    var linhas = nfedLinhasDaNota_(aba, mapa, p);
    if (!linhas.length) {
      return nfedResposta_(false, 'NOTA_NAO_ENCONTRADA', 'Não achei essa nota. Nada foi mudado.');
    }
    for (var i = 0; i < linhas.length; i++) {
      nfedMarcarExcluida_(aba, mapa, linhas[i].linha, p.motivo, p.por, p.matricula);
    }
    SpreadsheetApp.flush();
    var ainda = nfedLinhasDaNota_(aba, mapa, p).length;
    if (ainda) {
      return nfedResposta_(false, 'EXCLUSAO_NAO_CONFERE',
        'Marquei ' + linhas.length + ' linha(s), mas ' + ainda + ' continua(m) valendo.');
    }
    return nfedResposta_(true, '', 'Nota excluída.', {
      aba: aba.getName(), linhasMarcadas: linhas.length,
      observacao: 'As linhas continuam na planilha com status EXCLUIDA. Nada foi apagado.'
    });
  } finally {
    trava.releaseLock();
  }
}

function nfedRemoverLancamento_(p) {
  p = p || {};
  var id = nfedTexto_(p.idLanc);
  if (!id) return nfedResposta_(false, 'SEM_ID', 'Faltou o identificador do lançamento.');
  var aba = nfedAcharAba_();
  if (!aba) return nfedResposta_(false, 'SEM_ABA_DE_NOTAS', 'Não achei a aba das notas.');
  var mapa = nfedMapa_(aba);
  if (!mapa.idLanc) {
    return nfedResposta_(false, 'SEM_COLUNA_ID',
      'A aba não tem coluna de identificador de lançamento.');
  }
  if (!mapa.status) {
    return nfedResposta_(false, 'SEM_COLUNA_STATUS', 'A aba não tem coluna de status.');
  }
  var trava = LockService.getScriptLock();
  try { trava.waitLock(20000); } catch (e) {
    return nfedResposta_(false, 'OCUPADO', 'Outra pessoa está gravando agora.');
  }
  try {
    var ultima = aba.getLastRow();
    var dados = aba.getRange(2, 1, Math.max(0, ultima - 1), mapa.__largura).getValues();
    for (var i = 0; i < dados.length; i++) {
      var n = nfedLerLinha_(dados[i], mapa);
      if (n.idLanc !== id || n.status === 'EXCLUIDA') continue;
      nfedMarcarExcluida_(aba, mapa, i + 2, p.motivo, p.por, p.matricula);
      SpreadsheetApp.flush();
      return nfedResposta_(true, '', 'Lançamento removido da conta.',
        { aba: aba.getName(), linha: i + 2 });
    }
    return nfedResposta_(false, 'LANCAMENTO_NAO_ENCONTRADO',
      'Não achei esse lançamento valendo na planilha.');
  } finally {
    trava.releaseLock();
  }
}

/* ============================================================
 * OS ITENS, QUE MORAM NUMA ABA PROPRIA
 * ------------------------------------------------------------
 * ALMOXA_NF_ITENS: uma linha por item, ligada a nota pelas colunas
 * "nf" e "serie". O sistema esperava a lista dentro do registro da
 * nota e nunca foi buscar aqui — por isso as notas apareciam com o
 * valor certo e nenhum produto.
 *
 * Cuidado que custou caro entender: o Google formata a coluna "nf"
 * como numero e mostra "192.920". Comparar com o texto "192920"
 * falha. Aqui a comparacao e feita so com os digitos.
 * ============================================================ */

var NFED_ABAS_DE_ITENS = [
  'ALMOXA_NF_ITENS', 'NF_ITENS', 'NOTAS_ITENS', 'ITENS_NF', 'ITENS_NOTA'
];

function nfedAcharAbaDeItens_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var i, aba;
  for (i = 0; i < NFED_ABAS_DE_ITENS.length; i++) {
    aba = ss.getSheetByName(NFED_ABAS_DE_ITENS[i]);
    if (aba) return aba;
  }
  /* pelo cabecalho: uma aba de itens tem nf e descricao (ou sku) */
  var todas = ss.getSheets();
  for (i = 0; i < todas.length; i++) {
    var larg = todas[i].getLastColumn();
    if (larg < 3) continue;
    var cab = todas[i].getRange(1, 1, 1, larg).getValues()[0].map(nfedChaveCol_);
    var temNf = cab.indexOf('nf') > -1 || cab.indexOf('numeronf') > -1 ||
                cab.indexOf('numeronota') > -1;
    var temItem = cab.indexOf('descricao') > -1 || cab.indexOf('sku') > -1;
    var temQtd = cab.indexOf('quantidade') > -1 || cab.indexOf('qtd') > -1;
    if (temNf && temItem && temQtd) return todas[i];
  }
  return null;
}

var NFED_APELIDOS_ITEM = {
  nf:            ['nf', 'numeronf', 'numeronota', 'numero', 'nota'],
  serie:         ['serie'],
  sku:           ['sku', 'codigointerno'],
  codigo:        ['codigo', 'cod', 'codigofornecedor'],
  descricao:     ['descricao', 'produto', 'item', 'nome'],
  ncm:           ['ncm'],
  unidade:       ['unidade', 'und', 'um'],
  quantidade:    ['quantidade', 'qtd', 'qtde', 'quant'],
  valorUnitario: ['valorunitario', 'vlrunitario', 'precounitario', 'unitario'],
  valorTotal:    ['valortotal', 'vlrtotal', 'total']
};

function nfedMapaDeItens_(aba) {
  var larg = aba.getLastColumn();
  var cab = aba.getRange(1, 1, 1, larg).getValues()[0].map(nfedChaveCol_);
  var mapa = {}, usada = {};
  for (var campo in NFED_APELIDOS_ITEM) {
    if (!NFED_APELIDOS_ITEM.hasOwnProperty(campo)) continue;
    var ap = NFED_APELIDOS_ITEM[campo];
    for (var k = 0; k < ap.length; k++) {
      var c = cab.indexOf(ap[k]);
      if (c > -1 && !usada[c]) { mapa[campo] = c + 1; usada[c] = true; break; }
    }
  }
  mapa.__cabecalho = cab;
  mapa.__largura = larg;
  return mapa;
}

/* "192.920", 192920 e " 192920 " sao a mesma nota */
function nfedMesmoNumero_(a, b) {
  var x = nfedSoNumeros_(a), y = nfedSoNumeros_(b);
  if (!x || !y) return false;
  return String(Number(x)) === String(Number(y));
}

function nfedItens_(p) {
  p = p || {};
  var numero = nfedTexto_(p.numero) || nfedTexto_(p.nf);
  if (!numero) {
    return nfedResposta_(false, 'SEM_NUMERO',
      'Para buscar os itens eu preciso do número da nota.');
  }
  var aba = nfedAcharAbaDeItens_();
  if (!aba) {
    return nfedResposta_(false, 'SEM_ABA_DE_ITENS',
      'Não achei a aba dos itens. Procurei por ' + NFED_ABAS_DE_ITENS.join(', ') +
      ' e por um cabeçalho com nf, descrição e quantidade.');
  }
  var mapa = nfedMapaDeItens_(aba);
  if (!mapa.nf) {
    return nfedResposta_(false, 'SEM_COLUNA_NF',
      'A aba ' + aba.getName() + ' não tem a coluna que liga o item à nota.',
      { cabecalho: mapa.__cabecalho });
  }
  var ultima = aba.getLastRow();
  if (ultima < 2) {
    return nfedResposta_(true, '', 'A aba de itens está vazia.', []);
  }
  var dados = aba.getRange(2, 1, ultima - 1, mapa.__largura).getValues();
  var serieAlvo = nfedTexto_(p.serie);
  var achados = [];
  function col(linha, campo) {
    var c = mapa[campo];
    return c ? linha[c - 1] : '';
  }
  for (var i = 0; i < dados.length; i++) {
    if (!nfedMesmoNumero_(col(dados[i], 'nf'), numero)) continue;
    /* a série só filtra quando as duas existem; nota sem série na
       planilha não é descartada por causa disso */
    if (serieAlvo && mapa.serie) {
      var sLinha = nfedTexto_(col(dados[i], 'serie'));
      if (sLinha && !nfedMesmoNumero_(sLinha, serieAlvo) && sLinha !== serieAlvo) continue;
    }
    var qtd = nfedNumero_(col(dados[i], 'quantidade'));
    var vu  = nfedNumero_(col(dados[i], 'valorUnitario'));
    var vt  = nfedNumero_(col(dados[i], 'valorTotal'));
    achados.push({
      sku: nfedTexto_(col(dados[i], 'sku')) || null,
      codigo: nfedTexto_(col(dados[i], 'codigo')),
      descricao: nfedTexto_(col(dados[i], 'descricao')),
      ncm: nfedTexto_(col(dados[i], 'ncm')),
      unidade: nfedTexto_(col(dados[i], 'unidade')) || 'un',
      qtd: qtd,
      recebido: qtd,
      valorUnitario: vu || (qtd ? Math.round(vt / qtd * 100) / 100 : 0),
      valorTotal: vt || Math.round(qtd * vu * 100) / 100,
      linha: i + 2
    });
  }
  return nfedResposta_(true, '',
    achados.length + ' item(ns) da nota ' + numero + '.', achados);
}

/* ============================================================
 * A LIXEIRA E A RESTAURACAO
 * ------------------------------------------------------------
 * Nota apagada aqui nunca saiu da planilha: ela virou status
 * EXCLUIDA. Então devolvê-la é mudar o status de volta — a nota
 * volta inteira, com o mesmo identificador e os mesmos itens.
 * ============================================================ */

function nfedLerLinhaCompleta_(valores, mapa) {
  var n = nfedLerLinha_(valores, mapa);
  function col(campo) { var c = mapa[campo]; return c ? valores[c - 1] : ''; }
  n.fornecedor   = nfedTexto_(col('fornecedor'));
  n.excluidoEm   = nfedTexto_(col('excluidoEm')) || nfedTexto_(col('editadoEm'));
  n.excluidoPor  = nfedTexto_(col('excluidoPor')) || nfedTexto_(col('editadoPor'));
  n.motivo       = nfedTexto_(col('motivo'));
  n.statusAnterior = nfedTexto_(col('statusAnterior')).toUpperCase();
  var lista = [];
  try { lista = JSON.parse(n.itensCru || '[]'); } catch (e) { lista = []; }
  n.quantosItens = (Object.prototype.toString.call(lista) === '[object Array]')
    ? lista.length : 0;
  return n;
}

function nfedLixeira_(p) {
  p = p || {};
  var aba = nfedAcharAba_();
  if (!aba) return nfedResposta_(false, 'SEM_ABA_DE_NOTAS', 'Não achei a aba das notas.');
  var mapa = nfedMapa_(aba);
  if (!mapa.status) {
    return nfedResposta_(false, 'SEM_COLUNA_STATUS',
      'A aba ' + aba.getName() + ' não tem coluna de status, então não há como ' +
      'saber quais notas foram excluídas.');
  }
  var ultima = aba.getLastRow();
  if (ultima < 2) return nfedResposta_(true, '', 'Lixeira vazia.', { quantos: 0, notas: [] });

  var dados = aba.getRange(2, 1, ultima - 1, mapa.__largura).getValues();
  /* as identidades que estão VIVAS: uma nota excluída cuja identidade
     já voltou a existir não pode ser restaurada sem decisão humana */
  var vivas = {};
  var i, n;
  for (i = 0; i < dados.length; i++) {
    n = nfedLerLinha_(dados[i], mapa);
    if (n.status === 'EXCLUIDA') continue;
    var idv = nfedIdentidade_(n);
    if (idv) vivas[idv] = (n.numero || '') + (n.serie ? '/' + n.serie : '');
  }

  var busca = nfedTexto_(p.busca).toLowerCase();
  var de = nfedTexto_(p.de), ate = nfedTexto_(p.ate);
  var notas = [];
  for (i = 0; i < dados.length; i++) {
    n = nfedLerLinhaCompleta_(dados[i], mapa);
    if (n.status !== 'EXCLUIDA') continue;
    if (busca) {
      var alvo = (n.numero + ' ' + n.serie + ' ' + n.fornecedor + ' ' + n.cnpj +
                  ' ' + n.chave).toLowerCase();
      if (alvo.indexOf(busca) === -1) continue;
    }
    var quando = nfedTexto_(n.excluidoEm).slice(0, 10);
    if (de && quando && quando < de) continue;
    if (ate && quando && quando > ate) continue;

    var conflito = vivas[nfedIdentidade_(n)];
    notas.push({
      idLanc: n.idLanc || ('LINHA:' + (i + 2)),
      linha: i + 2,
      numero: n.numero, serie: n.serie, cnpj: n.cnpj,
      fornecedor: n.fornecedor, valor: n.valor,
      itens: n.quantosItens,
      excluidoEm: n.excluidoEm, excluidoPor: n.excluidoPor,
      motivoExclusao: n.motivo,
      podeRestaurar: !conflito,
      porqueNao: conflito
        ? 'Já existe uma nota valendo com esta mesma identificação (' + conflito +
          '). Restaurar agora deixaria a mesma nota em dobro.'
        : ''
    });
  }
  notas.sort(function (a, b) {
    return String(b.excluidoEm || '').localeCompare(String(a.excluidoEm || ''));
  });
  return nfedResposta_(true, '', notas.length + ' nota(s) na lixeira.', {
    quantos: notas.length, notas: notas, aba: aba.getName()
  });
}

function nfedRestaurar_(p) {
  p = p || {};
  var id = nfedTexto_(p.idLanc);
  if (!id) return nfedResposta_(false, 'SEM_ID', 'Faltou o identificador da nota.');
  var aba = nfedAcharAba_();
  if (!aba) return nfedResposta_(false, 'SEM_ABA_DE_NOTAS', 'Não achei a aba das notas.');
  var mapa = nfedMapa_(aba);
  if (!mapa.status) {
    return nfedResposta_(false, 'SEM_COLUNA_STATUS', 'A aba não tem coluna de status.');
  }
  var trava = LockService.getScriptLock();
  try { trava.waitLock(20000); } catch (e) {
    return nfedResposta_(false, 'OCUPADO', 'Outra pessoa está gravando agora.');
  }
  try {
    var ultima = aba.getLastRow();
    var dados = aba.getRange(2, 1, Math.max(0, ultima - 1), mapa.__largura).getValues();
    var alvo = -1, nAlvo = null, i, n;
    for (i = 0; i < dados.length; i++) {
      n = nfedLerLinhaCompleta_(dados[i], mapa);
      if (n.status !== 'EXCLUIDA') continue;
      var idDaLinha = n.idLanc || ('LINHA:' + (i + 2));
      if (idDaLinha !== id) continue;
      alvo = i + 2; nAlvo = n; break;
    }
    if (alvo < 0) {
      return nfedResposta_(false, 'NOTA_NAO_ENCONTRADA',
        'Não achei essa nota na lixeira. Nada foi mudado.');
    }
    /* conflito: a mesma nota já voltou a existir */
    var idv = nfedIdentidade_(nAlvo);
    for (i = 0; i < dados.length; i++) {
      if (i + 2 === alvo) continue;
      var outra = nfedLerLinha_(dados[i], mapa);
      if (outra.status === 'EXCLUIDA') continue;
      if (nfedIdentidade_(outra) !== idv) continue;
      if (!p.resolverConflito) {
        return nfedResposta_(false, 'CONFLITO',
          'Já existe uma nota valendo com esta mesma identificação, na linha ' +
          (i + 2) + '. Restaurar agora deixaria a mesma nota em dobro. ' +
          'Nada foi mudado.', { linhaEmConflito: i + 2 });
      }
    }
    var volta = nfedTexto_(nAlvo.statusAnterior) || 'LANCADA';
    aba.getRange(alvo, mapa.status).setValue(volta);
    if (mapa.motivo) {
      aba.getRange(alvo, mapa.motivo).setValue(
        'restaurada por ' + (nfedTexto_(p.por) || 'alguém') +
        (nfedTexto_(p.motivo) ? ' — ' + nfedTexto_(p.motivo) : ''));
    }
    if (mapa.editadoPor) aba.getRange(alvo, mapa.editadoPor).setValue(nfedTexto_(p.por));
    if (mapa.editadoMat) aba.getRange(alvo, mapa.editadoMat).setValue(nfedTexto_(p.matricula));
    if (mapa.editadoEm) aba.getRange(alvo, mapa.editadoEm).setValue(new Date().toISOString());
    SpreadsheetApp.flush();

    var confere = nfedLerLinha_(aba.getRange(alvo, 1, 1, mapa.__largura).getValues()[0], mapa);
    if (confere.status === 'EXCLUIDA') {
      return nfedResposta_(false, 'RESTAURACAO_NAO_CONFERE',
        'Escrevi na linha ' + alvo + ' mas ela continua marcada como excluída.');
    }
    return nfedResposta_(true, '',
      'Nota ' + nAlvo.numero + (nAlvo.serie ? ' série ' + nAlvo.serie : '') +
      ' restaurada como ' + volta + ', com ' + nAlvo.quantosItens + ' item(ns).',
      { linha: alvo, status: volta, itens: nAlvo.quantosItens,
        statusVeioDe: nfedTexto_(nAlvo.statusAnterior)
          ? 'o status guardado na exclusão'
          : 'LANCADA, porque a planilha não guardou o status anterior' });
  } finally {
    trava.releaseLock();
  }
}

/* ============================================================
 * AS PORTAS
 * ============================================================ */

/* ------------------------------------------------------------
 * ESTE ARQUIVO É UM COMPLEMENTO, NÃO O DONO DA ROTA.
 *
 * Se o seu roteador mandar TODO o tráfego de notas para cá — e foi
 * o que aconteceu: a tela de Notas Fiscais morreu com "a rota nfed
 * não conhece a ação listar" — recusar seria derrubar o sistema.
 * Então o que não é meu eu repasso para o módulo de notas de
 * verdade, se ele existir no projeto.
 * ------------------------------------------------------------ */
var NFED_NOMES_DO_MODULO_DE_NOTAS = [
  'AP_Modulo_nf', 'AP_Modulo_notas', 'AP_Modulo_notasfiscais',
  'AP_Modulo_NotasFiscais', 'AP_Modulo_nota', 'AP_NF', 'AP_Notas'
];

function nfedGlobal_(nome) {
  try {
    if (typeof globalThis !== 'undefined' && typeof globalThis[nome] === 'function') {
      return globalThis[nome];
    }
  } catch (e) {}
  try {
    if (typeof this !== 'undefined' && typeof this[nome] === 'function') {
      return this[nome];
    }
  } catch (e) {}
  return null;
}

function nfedRepassar_(acao, payload, sessao) {
  for (var i = 0; i < NFED_NOMES_DO_MODULO_DE_NOTAS.length; i++) {
    var nome = NFED_NOMES_DO_MODULO_DE_NOTAS[i];
    if (nome === 'AP_Modulo_nfed') continue;          /* nunca a mim mesmo */
    var fn = nfedGlobal_(nome);
    if (!fn) continue;
    try {
      return fn(acao, payload, sessao);
    } catch (e) {
      return nfedResposta_(false, 'ERRO_NO_MODULO_DE_NOTAS',
        'Repassei "' + nfedTexto_(acao) + '" para ' + nome + ' e ele falhou: ' +
        (e && e.message ? e.message : e));
    }
  }
  return nfedResposta_(false, 'ACAO_DESCONHECIDA',
    'A ação "' + nfedTexto_(acao) + '" não é deste arquivo (ele só faz atualizar, ' +
    'excluir, removerLancamento e diagnostico) e eu não achei o módulo de notas ' +
    'original no projeto para repassar. Se a tela de notas parou de carregar, é ' +
    'porque o roteador está mandando tudo para a rota nfed — confira se o arquivo ' +
    'do módulo de notas ainda existe no Apps Script.');
}

/** A porta do roteador: almoxaApi chama isto para a rota "nfed". */
function AP_Modulo_nfed(acao, payload, sessao) {
  try {
    switch (nfedTexto_(acao)) {
      case 'atualizar':         return nfedAtualizar_(payload);
      case 'excluir':           return nfedExcluir_(payload);
      case 'removerLancamento': return nfedRemoverLancamento_(payload);
      case 'itens':             return nfedItens_(payload);
      case 'lixeira':           return nfedLixeira_(payload);
      case 'restaurar':         return nfedRestaurar_(payload);
      case 'diagnostico':       return nfedDiagnostico_();
      /* qualquer outra coisa é do módulo de notas, não minha */
      default:                  return nfedRepassar_(acao, payload, sessao);
    }
  } catch (e) {
    return nfedResposta_(false, 'ERRO_NO_MODULO',
      'Falhou dentro do módulo de alteração: ' + (e && e.message ? e.message : e));
  }
}

/** Porta para quem abre o sistema DE DENTRO do Apps Script. */
function AP_NF_direto(json) {
  var req = {};
  try { req = JSON.parse(json || '{}'); } catch (e) { req = {}; }
  return JSON.stringify(AP_Modulo_nfed(req.acao, req.payload, req.token));
}

/** Rode esta aqui no editor para conferir a instalação sem mexer em nada. */
function AP_NFED_diagnostico() {
  var r = nfedDiagnostico_();
  Logger.log(JSON.stringify(r, null, 2));
  return r;
}
