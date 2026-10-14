/**
 * ALMOX-PRO — CORRIGIR NOTA JÁ LANÇADA
 * ============================================================================
 * Contrato: nfed.v1     ·     porta: AP_NFED_direto
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * ---------------------------
 * A tela de correção de nota ("Editar a nota 53168") sempre terminou em
 * "NADA foi gravado — falta instalar um arquivo". O arquivo era este, e
 * ele nunca tinha sido escrito. Pior: mesmo que estivesse instalado, não
 * teria funcionado, porque a tela só sabia chamá-lo por google.script.run
 * — que só existe DENTRO do Apps Script. Na publicação do GitHub Pages
 * essa chamada nem sai do navegador. Os dois lados estavam quebrados, e o
 * recado mandava instalar uma peça que não ia ajudar.
 *
 * Agora: este arquivo existe, e a tela fala com ele pela porta de sempre
 * (a API única, rota "nfed"), funcionando hospedado ou dentro do Script.
 *
 * O QUE ELE FAZ
 *   nfed.atualizar          reescreve a nota que JÁ existe, na linha dela
 *   nfed.excluir            marca a nota como EXCLUIDA
 *   nfed.removerLancamento  quando a mesma nota entrou duas vezes, marca
 *                           a repetida e mantém uma
 *   nfed.diagnostico        mostra o que ele enxerga, sem mexer em nada
 *   nfed.contrato           nome e versão
 *
 * A REGRA QUE DÁ NOME A ELE
 *   Ele ATUALIZA; ele não acrescenta. O módulo de notas comum só sabe
 *   acrescentar linha — foi assim que a nota 53072 dobrou de valor. Aqui,
 *   se a nota não for encontrada, ele RECUSA. Nunca cria uma segunda.
 *
 * O QUE ELE NÃO FAZ
 *   · NÃO apaga linha de planilha. Nunca. Nem a da nota, nem a de item.
 *     O que sai de cena é marcado como EXCLUIDO e continua lá.
 *   · Não mexe no estoque. Corrigir o papel não movimenta material.
 *   · Não cria aba, não renomeia coluna, não inventa campo.
 *   · Não grava se não achar a nota, e diz por quê.
 *   · Não confia no navegador para saber quem é: quem assina é a sessão.
 *
 * INSTALAÇÃO
 *   1. Planilha → Extensões → Apps Script → + → Script
 *   2. Nome: ALMOX_PRO_Notas_Alterar  ·  cole este conteúdo  ·  salve
 *   3. Atualize o ALMOXA_PRO_API_UNICA para a versão 7 (tem a rota "nfed")
 *   4. Implantar → Gerenciar implantações → lápis → Nova versão → Implantar
 *   5. Rode ALMOXA_NFED_DIAGNOSTICO pelo editor e leia o registro
 *
 * ONDE PROCURAR ERRO
 *   SEM_ABA            a aba de notas não existe na planilha
 *   NAO_ENCONTRADA     não achei a nota com esse id/número — nada gravado
 *   MAIS_DE_UMA        a nota está lançada duas vezes; use removerLancamento
 *   NAO_CONFERIU       gravei e a releitura não trouxe a mudança
 * ============================================================================
 */

var NFED_CONTRATO = 'nfed.v1';
var NFED_ABA_NOTAS = 'ALMOXA_NOTAS';
var NFED_ABA_ITENS = 'ALMOXA_NF_ITENS';


/* ============================================================
   1. A PORTA
   ============================================================ */

function AP_NFED_direto(json) {
  var p = {};
  try { p = (typeof json === 'string') ? JSON.parse(json || '{}') : (json || {}); }
  catch (e) { return JSON.stringify(NFED_erro_('CORPO_INVALIDO', 'O pedido não veio em JSON.')); }
  return JSON.stringify(NFED_atender_(p));
}
/* nomes alternativos, para o roteador achar de qualquer jeito */
function AP_Modulo_nfed(json) { return AP_NFED_direto(json); }
function AP_NFED_API(json)    { return AP_NFED_direto(json); }

function NFED_atender_(p) {
  var acao = String(p.acao || p.operacao || '');
  var carga = p.payload || {};
  var quem = NFED_quem_(p.sessao || p.token);
  try {
    switch (acao) {
      case 'atualizar':         return NFED_atualizar_(carga, quem);
      case 'excluir':           return NFED_excluir_(carga, quem);
      case 'removerLancamento': return NFED_removerLancamento_(carga, quem);
      case 'diagnostico':       return NFED_diagnostico_(carga);
      case 'contrato':          return NFED_ok_({ contrato: NFED_CONTRATO,
                                  acoes: ['atualizar','excluir','removerLancamento','diagnostico','contrato'],
                                  apagaLinha: false });
      default:
        return NFED_erro_('ACAO_DESCONHECIDA',
          'nfed.' + acao + ' não existe. As ações são: atualizar, excluir, ' +
          'removerLancamento, diagnostico, contrato.');
    }
  } catch (e) {
    return NFED_erro_('ESTOUROU', String((e && e.message) || e));
  }
}

function NFED_ok_(dados, mensagem, extra) {
  var r = { ok: true, dados: dados === undefined ? null : dados,
    mensagem: mensagem || '', contrato: NFED_CONTRATO };
  if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) r[k] = extra[k];
  return r;
}
function NFED_erro_(codigo, mensagem, extra) {
  var r = { ok: false, codigo: codigo, mensagem: mensagem, contrato: NFED_CONTRATO, dados: null };
  if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) r[k] = extra[k];
  return r;
}
function NFED_texto_(v) { return String(v === undefined || v === null ? '' : v).trim(); }
function NFED_num_(v) {
  if (typeof v === 'number') return v;
  var s = NFED_texto_(v).replace(/\s|R\$/g, '');
  if (!s) return 0;
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  var n = parseFloat(s.replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : 0;
}
function NFED_agora_() {
  try { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'); }
  catch (e) { return new Date().toISOString(); }
}

/** Quem está assinando. Vem da sessão conferida, nunca do navegador. */
function NFED_quem_(token) {
  try {
    if (typeof AP_SESSAO_conferir === 'function' && token) {
      var s = AP_SESSAO_conferir(token);
      var nome = (s && s.usuario && (s.usuario.nome || s.usuario.login)) || (s && s.usuario);
      if (nome) return String(nome);
    }
  } catch (e) {}
  try {
    var email = Session.getActiveUser().getEmail();
    if (email) return email;
  } catch (e) {}
  return 'sessão sem nome';
}


/* ============================================================
   2. A PLANILHA — sem criar nada
   ============================================================ */

function NFED_planilha_() {
  try {
    if (typeof AP_Data_ss === 'function') return AP_Data_ss();
  } catch (e) {}
  return SpreadsheetApp.getActiveSpreadsheet();
}

function NFED_aba_(nome) {
  var ss = NFED_planilha_();
  if (!ss) return null;
  return ss.getSheetByName(nome);
}

/** Lê uma aba inteira como objetos, guardando o número da linha. */
function NFED_ler_(nomeDaAba) {
  var aba = NFED_aba_(nomeDaAba);
  if (!aba) return null;
  var valores = aba.getDataRange().getValues();
  if (!valores.length) return { aba: aba, cabecalho: [], linhas: [] };
  var cabecalho = valores[0].map(function (c) { return NFED_texto_(c); });
  var linhas = [];
  for (var i = 1; i < valores.length; i++) {
    var o = { __linha: i + 1 };
    for (var c = 0; c < cabecalho.length; c++) {
      if (cabecalho[c]) o[cabecalho[c]] = valores[i][c];
    }
    linhas.push(o);
  }
  return { aba: aba, cabecalho: cabecalho, linhas: linhas };
}

/** Escreve SÓ as colunas informadas, na linha informada. Não mexe no resto. */
function NFED_escrever_(tabela, numeroDaLinha, mudancas) {
  /* UMA LEITURA E UMA ESCRITA POR LINHA.
     A primeira versão disto fazia um setValue por coluna: doze idas à
     planilha para gravar uma nota, e doze por item. Cada ida ao Google
     Sheets custa caro, e é assim que uma nota de vinte linhas leva
     minutos. Agora a linha inteira vai de uma vez. */
  var aba = tabela.aba, cabecalho = tabela.cabecalho;
  var largura = cabecalho.length;
  if (!largura) return 0;
  var faixa = aba.getRange(numeroDaLinha, 1, 1, largura);
  var linha = faixa.getValues()[0];
  var quantas = 0;
  for (var campo in mudancas) {
    if (!mudancas.hasOwnProperty(campo)) continue;
    var col = cabecalho.indexOf(campo);
    if (col < 0) continue;                    /* coluna que não existe não é criada */
    linha[col] = mudancas[campo];
    quantas++;
  }
  if (quantas) faixa.setValues([linha]);
  return quantas;
}

function NFED_acrescentar_(tabela, objeto) {
  var linha = tabela.cabecalho.map(function (c) {
    return objeto[c] === undefined ? '' : objeto[c];
  });
  tabela.aba.appendRow(linha);
  return tabela.aba.getLastRow();
}


/* ============================================================
   3. ACHAR A NOTA — por id, e só então pelo número
   ============================================================ */

function NFED_identidade_(p) {
  var id = NFED_texto_(p.idNF || p.id);
  if (id) return id;
  try { if (typeof AP_NF_id === 'function') return NFED_texto_(AP_NF_id(p)); } catch (e) {}
  var numero = NFED_texto_(p.numero), serie = NFED_texto_(p.serie);
  var cnpj = NFED_texto_(p.cnpj).replace(/\D/g, '');
  if (!numero) return '';
  return 'NF_' + numero + '-' + (serie || '1') + '-' + (cnpj || 'SEMCNPJ');
}

function NFED_mesmaNota_(linha, p, id) {
  var idDaLinha = NFED_texto_(linha.idNF);
  if (id && idDaLinha && idDaLinha === id) return true;
  var numero = NFED_texto_(p.numero);
  if (!numero) return false;
  if (NFED_texto_(linha.numero) !== numero) return false;
  var serie = NFED_texto_(p.serie), serieDaLinha = NFED_texto_(linha.serie);
  if (serie && serieDaLinha && serie !== serieDaLinha) return false;
  var cnpj = NFED_texto_(p.cnpj).replace(/\D/g, '');
  var cnpjDaLinha = NFED_texto_(linha.cnpj).replace(/\D/g, '');
  if (cnpj && cnpjDaLinha && cnpj !== cnpjDaLinha) return false;
  return true;
}

function NFED_acharNota_(tabela, p) {
  var id = NFED_identidade_(p);
  var achadas = tabela.linhas.filter(function (l) {
    if (/EXCLUIDA/i.test(NFED_texto_(l.status))) return false;
    return NFED_mesmaNota_(l, p, id);
  });
  return { id: id, achadas: achadas };
}


/* ============================================================
   4. ATUALIZAR — o coração deste arquivo
   ============================================================ */

function NFED_atualizar_(p, quem) {
  p = p || {};
  if (!NFED_texto_(p.numero) && !NFED_texto_(p.idNF)) {
    return NFED_erro_('PEDIDO_INCOMPLETO', 'Informe o número da nota ou o idNF.');
  }

  var notas = NFED_ler_(NFED_ABA_NOTAS);
  if (!notas) return NFED_erro_('SEM_ABA', 'A aba ' + NFED_ABA_NOTAS + ' não existe nesta planilha.');

  var lock = LockService.getScriptLock();
  var travou = false;
  try { lock.waitLock(20000); travou = true; } catch (e) {
    return NFED_erro_('OCUPADO', 'Outra gravação está em andamento. Tente de novo.');
  }

  try {
    var busca = NFED_acharNota_(notas, p);
    if (!busca.achadas.length) {
      /* AQUI ELE RECUSA, DE PROPÓSITO.
         Não achar a nota e gravar assim mesmo seria criar uma segunda —
         que é exatamente o estrago que este arquivo existe para evitar. */
      return NFED_erro_('NAO_ENCONTRADA',
        'Não achei a nota ' + (NFED_texto_(p.numero) || NFED_texto_(p.idNF)) +
        ' na aba ' + NFED_ABA_NOTAS + '. NADA foi gravado — e não criei nota nova, ' +
        'porque corrigir o que não existe seria lançar em dobro.');
    }
    if (busca.achadas.length > 1) {
      return NFED_erro_('MAIS_DE_UMA',
        'Esta nota está lançada ' + busca.achadas.length + ' vezes (linhas ' +
        busca.achadas.map(function (l) { return l.__linha; }).join(', ') +
        '). Resolva a repetição primeiro — nada foi gravado.',
        { linhas: busca.achadas.map(function (l) { return l.__linha; }) });
    }

    var linha = busca.achadas[0];
    var id = NFED_texto_(linha.idNF) || busca.id;
    var agora = NFED_agora_();

    var itens = (p.listaItens || p.itens || []).filter(function (i) {
      return i && (NFED_texto_(i.descricao) || NFED_texto_(i.sku) || NFED_texto_(i.codigo));
    });
    var soma = 0;
    itens.forEach(function (i) {
      var q = NFED_num_(i.quantidade !== undefined ? i.quantidade : i.qtd);
      var vu = NFED_num_(i.valorUnitario);
      soma += NFED_num_(i.valorTotal) || Math.round(q * vu * 100) / 100;
    });
    soma = Math.round(soma * 100) / 100;

    /* ---- o antes, para a auditoria e para dar para voltar ---- */
    var antes = {
      numero: NFED_texto_(linha.numero), serie: NFED_texto_(linha.serie),
      chave: NFED_texto_(linha.chave), fornecedor: NFED_texto_(linha.fornecedor),
      cnpj: NFED_texto_(linha.cnpj), emissao: NFED_texto_(linha.emissao),
      valor: NFED_num_(linha.valor), itens: NFED_num_(linha.itens)
    };

    var mudancas = {
      numero: NFED_texto_(p.numero) || antes.numero,
      serie: NFED_texto_(p.serie),
      chave: NFED_texto_(p.chave),
      fornecedor: NFED_texto_(p.fornecedor),
      cnpj: NFED_texto_(p.cnpj),
      emissao: NFED_texto_(p.emissao),
      valor: NFED_num_(p.valor) > 0 ? NFED_num_(p.valor) : soma,
      itens: itens.length,
      atualizadoEm: agora,
      observacao: NFED_texto_(p.observacao || p.motivo) ||
        NFED_texto_(linha.observacao),
      gravacao: 'OK'
    };
    /* o id NÃO muda: é ele que amarra os itens à nota */
    var quantasColunas = NFED_escrever_(notas, linha.__linha, mudancas);

    /* ---- os itens ---- */
    var resumoItens = NFED_sincronizarItens_(id, mudancas, itens, quem, agora);

    /* ---- conferir relendo ---- */
    var depois = NFED_ler_(NFED_ABA_NOTAS);
    var confere = depois.linhas.filter(function (l) {
      return NFED_texto_(l.idNF) === id ||
        (l.__linha === linha.__linha);
    })[0];
    var ativas = depois.linhas.filter(function (l) {
      return !/EXCLUIDA/i.test(NFED_texto_(l.status)) && NFED_mesmaNota_(l, mudancas, id);
    }).length;
    if (ativas > 1) {
      return NFED_erro_('DUPLICOU',
        'Depois de gravar, a nota aparece ' + ativas + ' vezes. Confira a aba ' +
        NFED_ABA_NOTAS + ' antes de mexer de novo.');
    }
    if (!confere || NFED_num_(confere.valor) !== mudancas.valor) {
      return NFED_erro_('NAO_CONFERIU',
        'Mandei gravar e a releitura não trouxe o valor novo. Não considere corrigida.');
    }

    NFED_auditar_(quem, 'NF_CORRIGIDA', id, {
      linha: linha.__linha, antes: antes, depois: mudancas,
      motivo: NFED_texto_(p.motivo), itens: resumoItens
    });

    return NFED_ok_({
      idNF: id, linha: linha.__linha,
      colunasAlteradas: quantasColunas,
      itens: resumoItens,
      valor: mudancas.valor
    }, 'Nota ' + mudancas.numero + ' corrigida na linha ' + linha.__linha + '.');
  } finally {
    if (travou) { try { lock.releaseLock(); } catch (e) {} }
  }
}


/* ============================================================
   5. OS ITENS — atualiza, acrescenta, e MARCA o que saiu
   ------------------------------------------------------------
   Nenhuma linha é apagada. O item que a pessoa tirou da nota vira
   status EXCLUIDO, com data e autor. Quem olhar a planilha daqui a
   um ano vê o que aconteceu, em vez de um buraco.
   ============================================================ */

function NFED_sincronizarItens_(id, cabec, itensNovos, quem, agora) {
  var tabela = NFED_ler_(NFED_ABA_ITENS);
  if (!tabela) return { aba: 'não existe', atualizados: 0, novos: 0, marcados: 0 };

  var daNota = tabela.linhas.filter(function (l) {
    return NFED_texto_(l.idNF) === id && !/EXCLUIDO/i.test(NFED_texto_(l.status));
  });

  function chave(i) {
    var sku = NFED_texto_(i.sku || i.codigo).toUpperCase();
    if (sku) return 'S:' + sku;
    return 'D:' + NFED_texto_(i.descricao).toUpperCase().replace(/\s+/g, ' ');
  }

  var jaTem = {};
  daNota.forEach(function (l) { jaTem[chave(l)] = l; });

  var atualizados = 0, novos = 0, usados = {};
  itensNovos.forEach(function (i) {
    var k = chave(i);
    var q = NFED_num_(i.quantidade !== undefined ? i.quantidade : i.qtd);
    var vu = NFED_num_(i.valorUnitario);
    var vt = NFED_num_(i.valorTotal) || Math.round(q * vu * 100) / 100;
    var campos = {
      nf: cabec.numero, serie: cabec.serie,
      sku: NFED_texto_(i.sku), codigo: NFED_texto_(i.codigo),
      descricao: NFED_texto_(i.descricao),
      unidade: NFED_texto_(i.unidade) || 'un',
      quantidade: q, valorUnitario: vu, valorTotal: vt,
      fornecedor: cabec.fornecedor, cnpj: cabec.cnpj,
      emissao: cabec.emissao, idNF: id,
      status: 'OK', lancadoPor: quem, lancadoEm: agora
    };
    if (jaTem[k] && !usados[k]) {
      usados[k] = true;
      NFED_escrever_(tabela, jaTem[k].__linha, campos);
      atualizados++;
    } else {
      campos.id = 'ITEM_' + id + '_' + (Date.now() % 100000) + '_' + novos;
      NFED_acrescentar_(tabela, campos);
      novos++;
    }
  });

  /* o que estava na nota e não está mais: MARCA, não apaga */
  var marcados = 0;
  daNota.forEach(function (l) {
    var k = chave(l);
    if (usados[k]) return;
    NFED_escrever_(tabela, l.__linha, {
      status: 'EXCLUIDO',
      observacao: 'tirado da nota na correção de ' + agora + ' por ' + quem,
      lancadoEm: NFED_texto_(l.lancadoEm) || agora
    });
    marcados++;
  });

  return { atualizados: atualizados, novos: novos, marcados: marcados,
    tinhaAntes: daNota.length };
}


/* ============================================================
   6. EXCLUIR — marcando, nunca apagando
   ============================================================ */

function NFED_excluir_(p, quem) {
  p = p || {};
  var notas = NFED_ler_(NFED_ABA_NOTAS);
  if (!notas) return NFED_erro_('SEM_ABA', 'A aba ' + NFED_ABA_NOTAS + ' não existe.');
  if (!NFED_texto_(p.motivo)) {
    return NFED_erro_('MOTIVO_OBRIGATORIO',
      'Diga por que está excluindo esta nota. Fica na auditoria.');
  }

  var busca = NFED_acharNota_(notas, p);
  if (!busca.achadas.length) {
    return NFED_erro_('NAO_ENCONTRADA', 'Não achei esta nota. Nada foi alterado.');
  }
  var agora = NFED_agora_();
  var linhas = [];
  busca.achadas.forEach(function (l) {
    NFED_escrever_(notas, l.__linha, {
      status: 'EXCLUIDA', atualizadoEm: agora,
      observacao: 'excluída em ' + agora + ' por ' + quem + ': ' + NFED_texto_(p.motivo)
    });
    linhas.push(l.__linha);
  });

  /* os itens acompanham a nota */
  var itens = NFED_ler_(NFED_ABA_ITENS);
  var marcados = 0;
  if (itens) {
    var id = NFED_texto_(busca.achadas[0].idNF) || busca.id;
    itens.linhas.forEach(function (l) {
      if (NFED_texto_(l.idNF) !== id) return;
      if (/EXCLUIDO/i.test(NFED_texto_(l.status))) return;
      NFED_escrever_(itens, l.__linha, { status: 'EXCLUIDO',
        observacao: 'nota excluída em ' + agora });
      marcados++;
    });
  }

  NFED_auditar_(quem, 'NF_EXCLUIDA', busca.id, { linhas: linhas, motivo: p.motivo });
  return NFED_ok_({ linhas: linhas, itensMarcados: marcados },
    'Nota marcada como excluída. Nenhuma linha foi apagada da planilha.');
}


/* ============================================================
   7. A NOTA QUE ENTROU DUAS VEZES
   ============================================================ */

function NFED_removerLancamento_(p, quem) {
  p = p || {};
  var notas = NFED_ler_(NFED_ABA_NOTAS);
  if (!notas) return NFED_erro_('SEM_ABA', 'A aba ' + NFED_ABA_NOTAS + ' não existe.');

  var busca = NFED_acharNota_(notas, p);
  if (busca.achadas.length < 2) {
    return NFED_ok_({ linhas: busca.achadas.map(function (l) { return l.__linha; }) },
      'Esta nota está lançada uma vez só. Nada a remover.');
  }

  /* fica a linha pedida; na falta de pedido, fica a MAIS ANTIGA —
     é a que tem o histórico amarrado */
  var ficar = NFED_num_(p.linhaQueFica) ||
    Math.min.apply(null, busca.achadas.map(function (l) { return l.__linha; }));
  var agora = NFED_agora_();
  var removidas = [];
  busca.achadas.forEach(function (l) {
    if (l.__linha === ficar) return;
    NFED_escrever_(notas, l.__linha, {
      status: 'EXCLUIDA', atualizadoEm: agora,
      observacao: 'lançamento repetido, removido em ' + agora + ' por ' + quem +
        ' (ficou a linha ' + ficar + ')'
    });
    removidas.push(l.__linha);
  });

  NFED_auditar_(quem, 'NF_REPETIDA_REMOVIDA', busca.id,
    { ficou: ficar, removidas: removidas });
  return NFED_ok_({ ficou: ficar, removidas: removidas },
    removidas.length + ' lançamento(s) repetido(s) marcado(s). Ficou a linha ' + ficar + '.');
}


/* ============================================================
   8. DIAGNÓSTICO — olha e não toca
   ============================================================ */

function NFED_diagnostico_(p) {
  p = p || {};
  var notas = NFED_ler_(NFED_ABA_NOTAS);
  var itens = NFED_ler_(NFED_ABA_ITENS);
  var r = {
    contrato: NFED_CONTRATO,
    abaDeNotas: notas ? NFED_ABA_NOTAS : 'NÃO EXISTE',
    abaDeItens: itens ? NFED_ABA_ITENS : 'NÃO EXISTE',
    colunasDaNota: notas ? notas.cabecalho : [],
    linhasDeNota: notas ? notas.linhas.length : 0,
    linhasDeItem: itens ? itens.linhas.length : 0,
    moduloDeNotasInstalado: (typeof AP_NF_direto === 'function')
  };
  if (NFED_texto_(p.numero) || NFED_texto_(p.idNF)) {
    var busca = notas ? NFED_acharNota_(notas, p) : { achadas: [] };
    r.procurei = NFED_texto_(p.numero) || NFED_texto_(p.idNF);
    r.achei = busca.achadas.length;
    r.linhas = busca.achadas.map(function (l) { return l.__linha; });
    r.identidade = busca.id;
  }
  return NFED_ok_(r);
}

function NFED_auditar_(quem, acao, id, detalhe) {
  try {
    if (typeof AP_Audit_log === 'function') {
      AP_Audit_log(quem, acao, NFED_ABA_NOTAS, id, detalhe);
      return;
    }
  } catch (e) {}
  try {
    if (typeof REPO_registrarAuditoria === 'function') {
      REPO_registrarAuditoria({ conjunto: 'auditoria', operacao: acao, id: id,
        resultado: 'OK', modulo: 'nfed',
        detalhe: JSON.stringify(detalhe).slice(0, 400) }, { usuario: quem });
    }
  } catch (e) {}
}


/* ============================================================
   9. PELO EDITOR
   ============================================================ */

function ALMOXA_NFED_DIAGNOSTICO() {
  var r = NFED_diagnostico_({});
  var d = r.dados || {};
  var l = [];
  l.push('================================================================');
  l.push('   ALMOX-PRO — CORRIGIR NOTA  ·  contrato ' + NFED_CONTRATO);
  l.push('================================================================');
  l.push('');
  l.push('Aba de notas  : ' + d.abaDeNotas + '   (' + d.linhasDeNota + ' linha(s))');
  l.push('Aba de itens  : ' + d.abaDeItens + '   (' + d.linhasDeItem + ' linha(s))');
  l.push('Módulo de notas instalado: ' + (d.moduloDeNotasInstalado ? 'sim' : 'não'));
  l.push('');
  l.push('Colunas da aba de notas:');
  l.push('   ' + (d.colunasDaNota || []).join(', '));
  l.push('');
  var faltam = ['numero','serie','chave','fornecedor','cnpj','emissao','valor',
    'itens','status','idNF','atualizadoEm','observacao']
    .filter(function (c) { return (d.colunasDaNota || []).indexOf(c) < 0; });
  if (faltam.length) {
    l.push('ATENÇÃO: estas colunas não existem e por isso NÃO serão gravadas:');
    l.push('   ' + faltam.join(', '));
    l.push('   (eu não crio coluna sozinho — a planilha é sua)');
  } else {
    l.push('Todas as colunas de que preciso existem.');
  }
  l.push('');
  l.push('Falta a rota: o ALMOXA_PRO_API_UNICA precisa estar na versão 7,');
  l.push('que encaminha o módulo "nfed". Sem ela, a tela não alcança aqui.');
  try { Logger.log(l.join('\n')); } catch (e) {}
  return l.join('\n');
}

/** Procura uma nota pelo número, sem alterar nada. */
function ALMOXA_NFED_PROCURAR() {
  var NUMERO = '53168';          // <- ponha o número da nota aqui
  var r = NFED_diagnostico_({ numero: NUMERO });
  var d = r.dados || {};
  var l = ['Procurei a nota ' + NUMERO,
    'identidade: ' + (d.identidade || '(não calculada)'),
    'achei     : ' + d.achei + ' linha(s)' + (d.linhas && d.linhas.length ? ' → ' + d.linhas.join(', ') : '')];
  if (d.achei === 0) l.push('Com 0 linhas, a correção é recusada de propósito: gravar criaria uma segunda nota.');
  if (d.achei > 1) l.push('Com mais de uma, use nfed.removerLancamento antes de corrigir.');
  try { Logger.log(l.join('\n')); } catch (e) {}
  return l.join('\n');
}
