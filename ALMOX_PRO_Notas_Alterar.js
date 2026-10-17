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
  itens:       ['itens', 'listaitens', 'produtos', 'itensjson'],
  idLanc:      ['idlanc', 'idlancamento', 'id', 'protocolo'],
  editadoPor:  ['editadopor'],
  editadoEm:   ['editadoem'],
  editadoMat:  ['editadomatricula'],
  motivo:      ['motivoedicao', 'motivo', 'observacao', 'obs']
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
  itens:       ['itens', 'produtos'],
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
                  'origem','itens','idLanc','editadoPor','editadoEm','editadoMat',
                  'motivo','serie','numero'];

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
    if (!mapa[c]) faltando.push(c);
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
    versaoDoArquivo: 'nfed 1.0'
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
      'A aba ' + aba.getName() + ' não tem as colunas de número e de itens que eu preciso.',
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
 * AS PORTAS
 * ============================================================ */

/** A porta do roteador: almoxaApi chama isto para a rota "nfed". */
function AP_Modulo_nfed(acao, payload, sessao) {
  try {
    switch (nfedTexto_(acao)) {
      case 'atualizar':         return nfedAtualizar_(payload);
      case 'excluir':           return nfedExcluir_(payload);
      case 'removerLancamento': return nfedRemoverLancamento_(payload);
      case 'diagnostico':       return nfedDiagnostico_();
      default:
        return nfedResposta_(false, 'ACAO_DESCONHECIDA',
          'A rota nfed não conhece a ação "' + nfedTexto_(acao) + '".');
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
