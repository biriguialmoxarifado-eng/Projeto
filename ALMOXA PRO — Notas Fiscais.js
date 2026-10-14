/**
 * ALMOXA PRO — Notas Fiscais: persistência e histórico
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * O diagnóstico da planilha mostrou 10 linhas em ALMOXA_NF_ITENS e
 * apenas 1 linha em ALMOXA_NOTAS. Ou seja: os ITENS estavam sendo
 * gravados, mas o CABEÇALHO da nota não chegava à aba de notas — e é
 * dela que o histórico é lido. Por isso a nota sumia da listagem.
 *
 * O QUE ESTE MÓDULO FAZ
 *  1. Usa as DUAS abas que já existem. Não cria base nova.
 *  2. Grava cabeçalho e itens na mesma operação, ou não grava nada.
 *  3. Lista TODAS as notas, de qualquer origem e qualquer status.
 *  4. Recupera as notas órfãs: onde existem itens sem cabeçalho, o
 *     cabeçalho é reconstruído a partir dos próprios itens gravados.
 *     Nada é inventado — tudo vem do que já está na planilha.
 *  5. Editar atualiza o MESMO registro. Itens são comparados um a um:
 *     alterado atualiza, novo entra, removido sai. Nunca duplica.
 *
 * INSTALAÇÃO
 *  1. Cole num arquivo novo do Apps Script.
 *  2. Rode AP_NF_diagnostico e leia o registro.
 *  3. Rode AP_NF_recuperarOrfas para trazer de volta o histórico.
 *  4. Publique nova versão.
 *
 * A tela conversa com este módulo por AP_NF_direto, sem passar pelo
 * roteador — nenhum arquivo existente precisa ser alterado.
 */

var AP_NF_ABAS = { notas: 'ALMOXA_NOTAS', itens: 'ALMOXA_NF_ITENS' };

/* Colunas que precisam existir. As que já existem não são tocadas;
   idNF é acrescentada no fim para dar vínculo forte entre nota e item. */
var AP_NF_COL_NOTA = ['numero', 'serie', 'chave', 'fornecedor', 'cnpj', 'emissao',
  'entrada', 'valor', 'itens', 'status', 'origem', 'arquivoId',
  'lancadoPor', 'lancadoEm', 'idNF', 'atualizadoEm', 'observacao', 'gravacao',
  'idLanc', 'excluidoEm', 'excluidoPor', 'motivoExclusao'];

/* idNF  = o DOCUMENTO fiscal (número + série + CNPJ, ou a chave).
           Duas partes da mesma nota compartilham o idNF.
   idLanc = o LANÇAMENTO. Nasce uma vez e nunca muda, nem quando o
           número ou o fornecedor são corrigidos. É a chave de
           excluir, editar e restaurar. Nota de fornecedor diferente
           com o mesmo número tem idLanc diferente — foi a falta
           disto que fez uma exclusão apagar a nota do vizinho. */

/* A coluna "gravacao" é o controle da gravação em duas etapas:
     EM_GRAVACAO = o cabeçalho entrou e os itens ainda não terminaram
     OK          = cabeçalho e itens, os dois no lugar
   Nota em EM_GRAVACAO não é lixo nem erro: é nota que ficou pela
   metade e precisa ser conferida na mão. Ela aparece na lista
   marcada, e nunca é apagada sozinha.
   "status" continua sendo o status do negócio (EM_CONFERENCIA etc.)
   e não foi tocado. */
var AP_NF_GRAVANDO = 'EM_GRAVACAO';
var AP_NF_GRAVADA = 'OK';

var AP_NF_COL_ITEM = ['id', 'nf', 'serie', 'sku', 'codigo', 'descricao', 'ncm',
  'unidade', 'quantidade', 'valorUnitario', 'valorTotal', 'fornecedor', 'cnpj',
  'obra', 'lote', 'validade', 'emissao', 'entrada', 'status',
  'lancadoEm', 'lancadoPor', 'observacao', 'idNF', 'tamanho', 'idProduto',
  'idLanc', 'movEstoque'];

/* ============================================================
   IDENTIDADE DA NOTA
   A chave de acesso manda. Sem chave, número + série + CNPJ.
   Nunca só o nome do fornecedor.
   ============================================================ */
function AP_NF_id(n) {
  n = n || {};
  var chave = AP_NF_so_(n.chave);
  if (chave.length >= 20) return 'NFE:' + chave;
  var numero = AP_NF_so_(n.numero || n.nf);
  var serie = AP_NF_so_(n.serie) || '0';
  var cnpj = AP_NF_so_(n.cnpj);
  if (!numero) return '';
  return 'NF:' + numero + '-' + serie + (cnpj ? '-' + cnpj : '');
}

function AP_NF_so_(v) {
  return String(v === undefined || v === null ? '' : v).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

/** Identificador do LANÇAMENTO. Nasce uma vez; não muda mais. */
function AP_NF_novoIdLanc_() {
  var t;
  try { t = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMddHHmmss'); }
  catch (e) { t = String(new Date().getTime()); }
  var sufixo;
  try { sufixo = String(Utilities.getUuid()).replace(/-/g, '').slice(0, 4).toUpperCase(); }
  catch (e) { sufixo = String(Math.random()).slice(2, 6); }
  return 'L-' + t + '-' + sufixo;
}

/* ============================================================
   PORTA ÚNICA PARA A TELA
   ============================================================ */
function AP_NF_direto(json) {
  var p = {};
  try { p = JSON.parse(json || '{}'); } catch (e) { p = {}; }

  var sessao = null;
  if (p.token) {
    var v = AP_Session_validate(String(p.token));
    if (v && v.ok) sessao = v.data;
  }

  /* A chave de operação pode vir no pedido ou dentro do payload (é o
     caminho que a tela usa, para não mudar o formato). Depois de lida,
     ela sai do payload: não é campo de nota fiscal. */
  var chaveDaOperacao = p.chaveOperacao || '';
  if (p.payload && typeof p.payload === 'object') {
    if (!chaveDaOperacao && p.payload.__chaveOperacao) chaveDaOperacao = p.payload.__chaveOperacao;
    try { delete p.payload.__chaveOperacao; } catch (e) {}
  }

  /* Com o servidor central instalado, a chave de operação vale também
     quando a tela chama este módulo pela porta direta, sem passar pela
     porta da rua. Se o pedido já veio pelo servidor central, ele se
     protege sozinho e não conta duas vezes. */
  if (typeof ASC_executar_ === 'function' && chaveDaOperacao) {
    return JSON.stringify(ASC_executar_({
      modulo: 'nf', acao: p.acao, payload: p.payload || {},
      sessao: p.token || null, chaveOperacao: chaveDaOperacao,
      origem: 'porta direta', quem: (sessao && sessao.usuario) || '',
      sessaoDados: sessao
    }, function () { return AP_NF_atender_(p, sessao); }));
  }

  return JSON.stringify(AP_NF_atender_(p, sessao));
}

function AP_NF_atender_(p, sessao) {
  var r;
  try {
    switch (p.acao) {
      case 'listar':    r = AP_NF_listar(p.payload || {}); break;
      case 'obter':     r = AP_NF_obter(p.payload || {}); break;
      case 'itens':     r = AP_NF_itens(p.payload || {}); break;
      case 'salvar':
        if (!sessao) { r = { ok: false, codigo: 'SEM_SESSAO', mensagem: 'Faça login de novo para lançar notas.' }; break; }
        r = AP_NF_salvar(p.payload || {}, sessao); break;
      case 'atualizar':
        if (!sessao) { r = { ok: false, codigo: 'SEM_SESSAO', mensagem: 'Faça login de novo para corrigir notas.' }; break; }
        r = AP_NF_atualizar(p.payload || {}, sessao); break;
      case 'excluir':
        if (!sessao) { r = { ok: false, codigo: 'SEM_SESSAO', mensagem: 'Faça login de novo.' }; break; }
        r = AP_NF_excluir(p.payload || {}, sessao); break;
      /* [v2] a lixeira, a restauração e a migração moram no
         ALMOX_PRO_Notas_Alterar. Aqui é só passagem, para a tela
         poder chamar pela rota "nf" também. Nada é reimplementado:
         uma única fonte, um único lugar que grava. */
      case 'lixeira':
      case 'restaurar':
      case 'lancamentos':
      case 'estoqueDoLancamento':
      case 'marcarMovimento':
      case 'migrarIdLanc':
        r = AP_NF_paraNfed_(p, sessao); break;
      case 'diagnostico': r = AP_NF_diagnostico_(); break;
      case 'recuperar':   r = AP_NF_recuperarOrfas_(); break;
      case 'pendentes':   r = AP_NF_pendentes_(); break;
      case 'armazem':     r = AP_NF_estadoDoArmazem_(); break;
      case 'doArmazem':   r = AP_NF_doArmazem_(p.payload || {}); break;
      case 'enviarAoArmazem':
        if (!sessao) { r = { ok: false, codigo: 'SEM_SESSAO', mensagem: 'Faça login de novo.' }; break; }
        r = AP_NF_mandarTudoAoArmazem_(p.payload || {}, sessao); break;
      case 'contarTudo':  r = AP_NF_contarTudo_(); break;
      case 'backups':     r = AP_NF_listarBackups_(); break;
      case 'limparTudo':
        if (!sessao) { r = { ok: false, codigo: 'SEM_SESSAO', mensagem: 'Faça login de novo para apagar notas.' }; break; }
        r = AP_NF_limparTudo(p.payload || {}, sessao); break;
      case 'restaurarBackup':
        if (!sessao) { r = { ok: false, codigo: 'SEM_SESSAO', mensagem: 'Faça login de novo.' }; break; }
        r = AP_NF_restaurarBackup(p.payload || {}, sessao); break;
      default: r = { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'nf.' + p.acao + ' não existe.' };
    }
  } catch (e) {
    r = { ok: false, codigo: 'MODULO_ERRO', mensagem: e.message };
  }
  return r;
}

/* ============================================================
   LISTAR — todas as notas, de toda origem, de todo status
   ============================================================ */
function AP_NF_listar(filtro) {
  filtro = filtro || {};
  var cabecalhos = AP_NF_linhas_(AP_NF_ABAS.notas);
  var itens = AP_NF_linhas_(AP_NF_ABAS.itens);

  /* agrupa os itens pela identidade da nota */
  var porNota = {};
  itens.forEach(function (i) {
    var id = String(i.idNF || '') || AP_NF_id({ numero: i.nf, serie: i.serie, cnpj: i.cnpj });
    if (!id) return;
    (porNota[id] = porNota[id] || []).push(AP_NF_itemPublico_(i));
  });

  var vistas = {};
  var lista = cabecalhos.map(function (n) {
    var id = String(n.idNF || '') || AP_NF_id(n);
    vistas[id] = true;
    return AP_NF_montar_(n, porNota[id] || [], id, false);
  });

  /* itens gravados sem cabeçalho: a nota existe, só não foi listada.
     O cabeçalho é reconstruído a partir dos próprios itens. */
  Object.keys(porNota).forEach(function (id) {
    if (vistas[id]) return;
    lista.push(AP_NF_montar_(AP_NF_cabecalhoDosItens_(porNota[id]), porNota[id], id, true));
  });

  var busca = String(filtro.busca || '').trim().toLowerCase();
  if (busca) {
    lista = lista.filter(function (n) {
      var alvo = [n.numero, n.serie, n.chave, n.fornecedor, n.cnpj, n.origem, n.status]
        .concat((n.itens || []).map(function (i) {
          return [i.descricao, i.sku, i.codigo, i.tamanho].join(' ');
        })).join(' ').toLowerCase();
      return alvo.indexOf(busca) > -1;
    });
  }

  lista.sort(function (a, b) {
    return String(b.entrada || b.emissao || '').localeCompare(String(a.entrada || a.emissao || ''));
  });

  return { ok: true, dados: lista };
}

/** Monta a nota no formato que a tela espera. */
function AP_NF_montar_(n, itens, id, reconstruida) {
  n = n || {};
  var soma = Math.round(itens.reduce(function (s, i) {
    return s + (Number(i.valorTotal) || (Number(i.quantidade) || 0) * (Number(i.valorUnitario) || 0));
  }, 0) * 100) / 100;

  var gravado = Number(n.valor) || 0;

  return {
    id: id,
    idNF: id,
    /* [v2] o identificador do LANÇAMENTO vai junto: é por ele que a
       tela pede para excluir, editar e restaurar. Vazio = lançamento
       antigo, que ainda não passou pela migração (nfed.migrar). */
    idLanc: String(n.idLanc || ''),
    excluidoEm: String(n.excluidoEm || ''),
    excluidoPor: String(n.excluidoPor || ''),
    motivoExclusao: String(n.motivoExclusao || ''),
    numero: String(n.numero || n.nf || ''),
    serie: String(n.serie || ''),
    chave: String(n.chave || ''),
    fornecedor: n.fornecedor || '',
    cnpj: n.cnpj || '',
    origem: String(n.origem || 'MANUAL').toUpperCase(),
    emissao: n.emissao || '',
    entrada: n.entrada || '',
    /* valor gravado manda; sem ele, a soma dos itens */
    valor: gravado > 0 ? gravado : soma,
    valorItens: soma,
    status: n.status || 'EM_CONFERENCIA',
    lancadoPor: n.lancadoPor || '',
    lancadoEm: n.lancadoEm || '',
    arquivoId: n.arquivoId || '',
    observacao: n.observacao || '',
    itens: itens,
    listaItens: itens,
    qtdItens: itens.length,
    reconstruida: !!reconstruida,
    /* a marca da gravação em duas etapas */
    gravacao: String(n.gravacao || ''),
    incompleta: String(n.gravacao || '') === AP_NF_GRAVANDO
  };
}

/** Deduz o cabeçalho a partir dos itens — só com o que está gravado. */
function AP_NF_cabecalhoDosItens_(itens) {
  var base = itens[0] || {};
  return {
    numero: base.nf || base.numero || '',
    serie: base.serie || '',
    chave: '',
    fornecedor: base.fornecedor || '',
    cnpj: base.cnpj || '',
    emissao: base.emissao || '',
    entrada: base.entrada || base.lancadoEm || '',
    valor: 0,
    status: base.status || 'EM_CONFERENCIA',
    origem: base.origem || 'MANUAL',
    lancadoPor: base.lancadoPor || '',
    lancadoEm: base.lancadoEm || ''
  };
}

function AP_NF_itemPublico_(i) {
  var qtd = Number(i.quantidade) || 0;
  var vu = Number(i.valorUnitario) || 0;
  var vt = Number(i.valorTotal);
  return {
    id: i.id || '',
    idNF: i.idNF || '',
    idLanc: i.idLanc || '',
    movEstoque: i.movEstoque || '',
    nf: i.nf || '',
    serie: i.serie || '',
    sku: i.sku || '',
    idProduto: i.idProduto || i.sku || '',
    codigo: i.codigo || '',
    descricao: i.descricao || '',
    tamanho: i.tamanho || '',
    ncm: i.ncm || '',
    unidade: i.unidade || 'UN',
    quantidade: qtd,
    qtd: qtd,
    valorUnitario: vu,
    valorTotal: (vt || Math.round(qtd * vu * 100) / 100),
    fornecedor: i.fornecedor || '',
    cnpj: i.cnpj || '',
    obra: i.obra || '',
    lote: i.lote || '',
    validade: i.validade || '',
    status: i.status || '',
    observacao: i.observacao || ''
  };
}

/* ============================================================
   OBTER / ITENS
   ============================================================ */
function AP_NF_obter(p) {
  var id = String(p.id || p.idNF || '') || AP_NF_id(p);
  var achada = AP_NF_listar({}).dados.filter(function (n) {
    return n.id === id || (p.numero && String(n.numero) === String(p.numero) &&
      (!p.serie || String(n.serie) === String(p.serie)));
  })[0];
  return achada
    ? { ok: true, dados: achada }
    : { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Nota não localizada.' };
}

function AP_NF_itens(p) {
  var r = AP_NF_obter(p);
  return r.ok ? { ok: true, dados: r.dados.itens } : r;
}

/* ============================================================
   SALVAR — cria ou atualiza o MESMO registro, nunca duplica
   ============================================================ */
function AP_NF_salvar(p, sessao) {
  if (!p || !p.numero) {
    return { ok: false, codigo: 'CAMPO_OBRIGATORIO', mensagem: 'Informe o número da nota.' };
  }
  var id = AP_NF_id(p);
  if (!id) return { ok: false, codigo: 'SEM_IDENTIDADE', mensagem: 'Não consegui identificar esta nota.' };

  var quem = (sessao && sessao.usuario) || 'sistema';
  var agora = AP_NF_agora_();
  var itensNovos = (p.listaItens || p.itens || []).filter(function (i) {
    return i && (i.descricao || i.sku || i.codigo);
  });

  var lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (e) {
    return { ok: false, codigo: 'OCUPADO', mensagem: 'Outra gravação está em andamento. Tente de novo.' };
  }

  try {
    AP_NF_garantirColunas_(AP_NF_ABAS.notas, AP_NF_COL_NOTA);
    AP_NF_garantirColunas_(AP_NF_ABAS.itens, AP_NF_COL_ITEM);

    var soma = Math.round(itensNovos.reduce(function (s, i) {
      var q = Number(i.quantidade !== undefined ? i.quantidade : i.qtd) || 0;
      var vu = Number(i.valorUnitario) || 0;
      return s + (Number(i.valorTotal) || Math.round(q * vu * 100) / 100);
    }, 0) * 100) / 100;

    var cabec = {
      numero: String(p.numero),
      serie: String(p.serie || ''),
      chave: String(p.chave || ''),
      fornecedor: p.fornecedor || '',
      cnpj: p.cnpj || '',
      emissao: p.emissao || '',
      entrada: p.entrada || agora,
      valor: Number(p.valor) > 0 ? Number(p.valor) : soma,
      itens: itensNovos.length,
      status: p.status || 'EM_CONFERENCIA',
      origem: String(p.origem || 'MANUAL').toUpperCase(),
      arquivoId: p.arquivoId || '',
      observacao: p.observacao || '',
      idNF: id,
      atualizadoEm: agora
    };

    /* [v2] se a tela disse QUAL lançamento, é aquele. Sem isso, o
       documento manda — e a primeira linha dele é a que recebe. */
    var existente = null;
    var idLancPedido = String(p.idLanc || p.idLancamento || '');
    if (idLancPedido) {
      existente = AP_NF_linhas_(AP_NF_ABAS.notas).filter(function (l) {
        return String(l.idLanc || '') === idLancPedido; })[0] || null;
    }
    if (!existente) existente = AP_NF_acharLinha_(AP_NF_ABAS.notas, id);

    /* ---------- ETAPA 1: o cabeçalho, marcado como EM GRAVAÇÃO ----------
       A planilha do Google não sabe fazer "tudo ou nada". Então a nota
       entra marcada, e só perde a marca quando os itens estiverem no
       lugar. Se o Google derrubar a execução no meio, a nota fica
       marcada — visível, conferível, nunca invisível. */
    cabec.gravacao = AP_NF_GRAVANDO;
    var linhaDaNota;
    var idLanc;
    if (existente) {
      /* mantém quem lançou originalmente */
      cabec.lancadoPor = existente.lancadoPor || quem;
      cabec.lancadoEm = existente.lancadoEm || agora;
      idLanc = String(existente.idLanc || '') || AP_NF_novoIdLanc_();
      cabec.idLanc = idLanc;
      linhaDaNota = existente.__linha;
      AP_NF_escreverLinha_(AP_NF_ABAS.notas, linhaDaNota, cabec);
    } else {
      cabec.lancadoPor = quem;
      cabec.lancadoEm = agora;
      idLanc = idLancPedido || AP_NF_novoIdLanc_();
      cabec.idLanc = idLanc;
      AP_NF_acrescentar_(AP_NF_ABAS.notas, cabec);
      var recem = AP_NF_linhas_(AP_NF_ABAS.notas).filter(function (l) {
        return String(l.idLanc || '') === idLanc; })[0] ||
        AP_NF_acharLinha_(AP_NF_ABAS.notas, id);
      if (!recem) {
        return { ok: false, codigo: 'NAO_GRAVOU',
          mensagem: 'A nota não apareceu na aba ' + AP_NF_ABAS.notas + ' depois da gravação.' };
      }
      linhaDaNota = recem.__linha;
    }

    /* ---------- ETAPA 2: os itens ---------- */
    var resumoItens;
    try {
      resumoItens = AP_NF_sincronizarItens_(id, cabec, itensNovos, quem, agora, idLanc);
    } catch (eItens) {
      /* a nota fica marcada EM_GRAVACAO de propósito: é o aviso de que
         ficou pela metade. Nada é apagado. */
      try {
        AP_Audit_log(quem, 'NF_ITENS_FALHARAM', AP_NF_ABAS.notas, id, {
          numero: cabec.numero, erro: String(eItens && eItens.message)
        });
      } catch (e) {}
      return {
        ok: false, codigo: 'ITENS_NAO_GRAVARAM',
        incompleta: true,
        mensagem: 'O cabeçalho da nota ' + cabec.numero + ' entrou, mas os itens não. ' +
          'A nota ficou marcada como incompleta na lista — abra ela e salve de novo. ' +
          'Nada foi apagado. (' + String(eItens && eItens.message) + ')',
        dados: null
      };
    }

    /* ---------- ETAPA 3: tira a marca ---------- */
    AP_NF_escreverLinha_(AP_NF_ABAS.notas, linhaDaNota, { gravacao: AP_NF_GRAVADA });
    cabec.gravacao = AP_NF_GRAVADA;

    /* confere que gravou mesmo antes de dizer que deu certo */
    var conferencia = AP_NF_acharLinha_(AP_NF_ABAS.notas, id);
    if (!conferencia) {
      return { ok: false, codigo: 'NAO_GRAVOU',
        mensagem: 'A nota não apareceu na aba ' + AP_NF_ABAS.notas + ' depois da gravação.' };
    }

    try {
      AP_Audit_log(quem, existente ? 'NF_ATUALIZADA' : 'NF_LANCADA', AP_NF_ABAS.notas, id, {
        numero: cabec.numero, origem: cabec.origem, itens: itensNovos.length, valor: cabec.valor
      });
    } catch (e) {}

    var publica = AP_NF_montar_(cabec, itensNovos.map(function (i) {
      return AP_NF_itemPublico_(AP_NF_normalizarItem_(i, id, cabec));
    }), id, false);

    /* ---------- ETAPA 4: o armazém no Drive ----------
       A nota vira também um arquivo na sua pasta do Drive. A planilha
       continua com tudo — o armazém é o SEGUNDO lugar, não o único.
       Se o Drive falhar, a nota já está gravada e nada se perde: o
       aviso vem junto da resposta e a conferência pega depois. */
    var noArmazem = null;
    if (typeof ADRV_guardar === 'function') {
      try {
        var g = ADRV_guardar('nf', id, publica, {
          quem: quem,
          quando: cabec.entrada || agora,
          resumo: 'NF ' + cabec.numero + (cabec.fornecedor ? ' · ' + cabec.fornecedor : '')
            + ' · ' + itensNovos.length + ' item(ns)'
        });
        noArmazem = g && g.ok
          ? { guardado: true, arquivoId: g.dados.arquivoId, pasta: g.dados.pasta }
          : { guardado: false, motivo: (g && g.mensagem) || 'não guardou' };
      } catch (eArm) {
        noArmazem = { guardado: false, motivo: String(eArm && eArm.message) };
      }
    }

    return {
      ok: true,
      dados: publica,
      atualizada: !!existente,
      itens: resumoItens,
      armazem: noArmazem
    };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/* ============================================================
   ATUALIZAR — corrigir uma nota QUE JÁ EXISTE
   ------------------------------------------------------------
   POR QUE ISTO EXISTE
   A tela de "Corrigir a nota" chama nf.atualizar. Essa ação não
   existia aqui. Dependendo do que estivesse instalado no projeto,
   o pedido ou voltava como ACAO_DESCONHECIDA, ou — pior — voltava
   "ok" de alguma outra parte do Core sem gravar nada. A tela
   conferia a nota depois de salvar, via que ela não tinha mudado,
   e avisava: "O Core respondeu que deu certo, mas a nota não
   mudou". O aviso estava certo. Faltava a ação.

   POR QUE NÃO É SÓ UM APELIDO DE 'salvar'
   AP_NF_salvar é upsert: se a nota não existe, ele CRIA. Numa
   correção isso é a pior coisa possível — foi assim que a nota
   53072 virou dois lançamentos e dobrou de valor. Então:

     · atualizar NUNCA cria nota. Não achou, recusa e diz por quê.
     · se o número/série/CNPJ mudaram na correção, a identidade da
       nota muda junto. Aqui a gente RECHAVEIA a linha que já
       existe antes de gravar, para a correção cair POR CIMA dela
       em vez de nascer uma segunda nota.
     · se a mesma nota estiver repetida na planilha, recusa. Com
       duas linhas iguais não dá para saber qual é a boa, e gravar
       no escuro é o que estragou a 53072.

   O que grava de fato é AP_NF_salvar: mesma gravação em duas
   etapas, mesma reconciliação de itens (atualiza, cria e apaga o
   que saiu), mesma auditoria. Nada disso foi duplicado aqui.
   ============================================================ */
function AP_NF_atualizar(p, sessao) {
  p = p || {};
  if (!p.numero) {
    return { ok: false, codigo: 'CAMPO_OBRIGATORIO', mensagem: 'Informe o número da nota.' };
  }

  var idNovo = AP_NF_id(p);
  if (!idNovo) {
    return { ok: false, codigo: 'SEM_IDENTIDADE', mensagem: 'Não consegui identificar esta nota.' };
  }

  var lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (e) {
    return { ok: false, codigo: 'OCUPADO', mensagem: 'Outra gravação está em andamento. Tente de novo.' };
  }

  try {
    AP_NF_garantirColunas_(AP_NF_ABAS.notas, AP_NF_COL_NOTA);
    AP_NF_garantirColunas_(AP_NF_ABAS.itens, AP_NF_COL_ITEM);

    var idAntigo = AP_NF_identidadeAnterior_(p);

    /* a nota repetida é o caso que não se resolve adivinhando */
    var quantasNovo = AP_NF_quantasLinhas_(idNovo);
    var quantasAntigo = idAntigo && idAntigo !== idNovo ? AP_NF_quantasLinhas_(idAntigo) : 0;
    if (quantasNovo > 1 || quantasAntigo > 1) {
      return {
        ok: false, codigo: 'NOTA_REPETIDA',
        mensagem: 'Esta nota aparece ' + Math.max(quantasNovo, quantasAntigo) +
          ' vezes na aba ' + AP_NF_ABAS.notas + '. Não vou gravar por cima sem saber qual ' +
          'das linhas é a boa. Limpe a repetição primeiro — nada foi alterado.'
      };
    }

    var alvo = AP_NF_acharLinha_(AP_NF_ABAS.notas, idNovo);

    /* mudou o número, a série ou o CNPJ? então a identidade mudou.
       Rechaveia a linha que já existe para a nova identidade, senão
       AP_NF_salvar não acha ela e acrescenta uma nota nova. */
    var rechaveou = false;
    if (!alvo && idAntigo && idAntigo !== idNovo) {
      var velha = AP_NF_acharLinha_(AP_NF_ABAS.notas, idAntigo);
      if (velha) {
        AP_NF_escreverLinha_(AP_NF_ABAS.notas, velha.__linha, { idNF: idNovo });
        AP_NF_rechavearItens_(idAntigo, idNovo);
        alvo = AP_NF_acharLinha_(AP_NF_ABAS.notas, idNovo);
        rechaveou = true;
      }
    }

    if (!alvo) {
      return {
        ok: false, codigo: 'NOTA_NAO_ENCONTRADA',
        mensagem: 'Não achei a nota ' + String(p.numero) + ' na aba ' + AP_NF_ABAS.notas + '. ' +
          'A ação "atualizar" muda uma nota que já existe — ela nunca cria nota nova, ' +
          'de propósito. Se a nota ainda não foi lançada, use a entrada de NF. ' +
          'Nada foi gravado.'
      };
    }

    /* daqui para a frente é a mesma gravação de sempre */
    var r = AP_NF_salvar(p, sessao);
    if (r && r.ok) {
      r.atualizada = true;
      r.rechaveou = rechaveou;
      if (rechaveou) r.identidadeNova = idNovo;
      try {
        AP_Audit_log((sessao && sessao.usuario) || 'sistema', 'NF_CORRIGIDA',
          AP_NF_ABAS.notas, idNovo, {
            numero: String(p.numero),
            motivo: String(p.motivoEdicao || p.motivo || ''),
            identidadeAnterior: idAntigo || '',
            rechaveou: rechaveou
          });
      } catch (e) {}
    }
    return r;

  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** A identidade que a nota tinha ANTES da correção, como a tela manda. */
function AP_NF_identidadeAnterior_(p) {
  var bruta = p.identidadeAnterior || p.idAntigo || p.idOriginal || p.idNF || '';
  if (bruta && typeof bruta === 'object' && bruta.length) bruta = bruta[0];
  bruta = String(bruta || '').trim();
  if (bruta) return bruta;
  /* a tela pode mandar a nota original inteira em vez da identidade */
  if (p.original && typeof p.original === 'object') return AP_NF_id(p.original);
  return '';
}

/** Quantas linhas da aba de notas respondem por esta identidade. */
function AP_NF_quantasLinhas_(id) {
  if (!id) return 0;
  return AP_NF_linhas_(AP_NF_ABAS.notas).filter(function (l) {
    var seu = String(l.idNF || '') || AP_NF_id(l);
    return seu === id;
  }).length;
}

/** Leva os itens da identidade antiga para a nova, sem apagar nada. */
function AP_NF_rechavearItens_(idAntigo, idNovo) {
  if (!idAntigo || !idNovo || idAntigo === idNovo) return 0;
  var mudados = 0;
  AP_NF_linhas_(AP_NF_ABAS.itens).forEach(function (i) {
    var seu = String(i.idNF || '') || AP_NF_id({ numero: i.nf, serie: i.serie, cnpj: i.cnpj });
    if (seu !== idAntigo) return;
    AP_NF_escreverLinha_(AP_NF_ABAS.itens, i.__linha, { idNF: idNovo });
    mudados++;
  });
  return mudados;
}

/* ============================================================
   MANDAR O QUE JÁ ESTÁ NA PLANILHA PARA O ARMAZÉM
   ------------------------------------------------------------
   Nada é apagado da planilha. Isto COPIA cada nota para um
   arquivo no Drive. Pode rodar quantas vezes quiser: o que já
   foi não vai de novo, a não ser que você peça.
   Para por tempo, para não estourar os 6 minutos do Google —
   é só rodar outra vez que ele continua de onde parou.
   ============================================================ */
function AP_NF_mandarTudoAoArmazem_(p, sessao) {
  p = p || {};
  if (typeof ADRV_guardar !== 'function') {
    return { ok: false, codigo: 'SEM_ARMAZEM',
      mensagem: 'O armazém do Drive não está instalado. Cole o arquivo '
        + 'ALMOXA_PRO_Armazem_Drive e rode ALMOXA_ARMAZEM_INSTALAR.' };
  }

  var comecou = Date.now();
  var tetoMs = Math.min(Number(p.segundos) || 240, 300) * 1000;
  var limite = Math.min(Number(p.limite) || 300, 2000);
  var refazer = !!p.refazer;
  var quem = (sessao && sessao.usuario) || 'sistema';

  var notas = AP_NF_linhas_(AP_NF_ABAS.notas);
  var itens = AP_NF_linhas_(AP_NF_ABAS.itens);

  var porNota = {};
  itens.forEach(function (i) {
    var id = String(i.idNF || '') || AP_NF_id({ numero: i.nf, serie: i.serie, cnpj: i.cnpj });
    if (!id) return;
    (porNota[id] = porNota[id] || []).push(AP_NF_itemPublico_(i));
  });

  var feitas = 0, jaEstavam = 0, falharam = [], faltam = 0, acabouOTempo = false;

  for (var k = 0; k < notas.length; k++) {
    if (Date.now() - comecou > tetoMs || feitas >= limite) {
      acabouOTempo = true;
      faltam = notas.length - k;
      break;
    }
    var n = notas[k];
    var id = String(n.idNF || '') || AP_NF_id(n);
    if (!id) continue;

    if (!refazer) {
      var jaTem = null;
      try { jaTem = ADRV_procurarNoIndice_('nf', id); } catch (e) {}
      if (jaTem && String(jaTem.situacao) === 'GUARDADO') { jaEstavam++; continue; }
    }

    try {
      var g = ADRV_guardar('nf', id,
        AP_NF_montar_(n, porNota[id] || [], id, false), {
          quem: quem,
          quando: n.entrada || n.emissao || '',
          resumo: 'NF ' + String(n.numero || '') + (n.fornecedor ? ' · ' + n.fornecedor : '')
            + ' · ' + ((porNota[id] || []).length) + ' item(ns)'
        });
      if (g && g.ok) feitas++;
      else falharam.push({ id: id, motivo: (g && g.mensagem) || 'não guardou' });
    } catch (e) {
      falharam.push({ id: id, motivo: String(e && e.message) });
    }
  }

  return {
    ok: true,
    mensagem: feitas + ' nota(s) copiada(s) para o armazém.'
      + (acabouOTempo ? ' Parei por tempo — rode de novo para continuar.' : ' Acabou tudo.'),
    dados: {
      naPlanilha: notas.length,
      copiadas: feitas,
      jaEstavam: jaEstavam,
      falharam: falharam.length,
      listaDeFalhas: falharam.slice(0, 30),
      faltam: faltam,
      terminou: !acabouOTempo,
      segundos: Math.round((Date.now() - comecou) / 1000)
    }
  };
}

/** Lê uma nota do armazém do Drive, não da planilha. */
function AP_NF_doArmazem_(p) {
  if (typeof ADRV_ler !== 'function') {
    return { ok: false, codigo: 'SEM_ARMAZEM', mensagem: 'O armazém do Drive não está instalado.' };
  }
  var id = String((p && (p.id || p.idNF)) || '') || AP_NF_id(p || {});
  if (!id) return { ok: false, codigo: 'SEM_IDENTIDADE', mensagem: 'Informe a nota.' };
  return ADRV_ler('nf', id);
}

/** Quanto da planilha já está no armazém. */
function AP_NF_estadoDoArmazem_() {
  if (typeof ADRV_retrato_ !== 'function') {
    return { ok: true, dados: { instalado: false } };
  }
  var d = ADRV_retrato_();
  var naPlanilha = 0;
  try { naPlanilha = AP_NF_linhas_(AP_NF_ABAS.notas).length; } catch (e) {}
  var noArmazem = (d.porModulo && d.porModulo.nf) || 0;
  return { ok: true, dados: {
    instalado: true,
    url: d.url,
    naPlanilha: naPlanilha,
    noArmazem: noArmazem,
    faltam: Math.max(0, naPlanilha - noArmazem),
    naLixeira: d.naLixeira,
    registrosDeTodosOsModulos: d.registros
  } };
}

/* ============================================================
   NOTAS QUE FICARAM PELA METADE
   Cabeçalho gravado, itens não. Não é lixo: é conferência.
   ============================================================ */
function AP_NF_pendentes_() {
  var notas = AP_NF_linhas_(AP_NF_ABAS.notas);
  var itens = AP_NF_linhas_(AP_NF_ABAS.itens);

  var quantosItens = {};
  itens.forEach(function (i) {
    var id = String(i.idNF || '') || AP_NF_id({ numero: i.nf, serie: i.serie, cnpj: i.cnpj });
    if (id) quantosItens[id] = (quantosItens[id] || 0) + 1;
  });

  var lista = [];
  notas.forEach(function (n) {
    var id = String(n.idNF || '') || AP_NF_id(n);
    var marca = String(n.gravacao || '');
    var temItens = quantosItens[id] || 0;
    var declarados = Number(n.itens) || 0;

    var porque = '';
    if (marca === AP_NF_GRAVANDO) porque = 'A gravação não terminou.';
    else if (declarados > 0 && temItens === 0) porque = 'A nota diz ter ' + declarados + ' item(ns), e nenhum foi encontrado.';
    else if (declarados > 0 && temItens !== declarados) porque = 'A nota diz ter ' + declarados + ' item(ns) e tem ' + temItens + '.';
    if (!porque) return;

    lista.push({
      id: id, numero: String(n.numero || ''), serie: String(n.serie || ''),
      fornecedor: String(n.fornecedor || ''), valor: Number(n.valor) || 0,
      lancadoPor: String(n.lancadoPor || ''), lancadoEm: String(n.lancadoEm || ''),
      itensDeclarados: declarados, itensEncontrados: temItens,
      marca: marca, porque: porque, linha: n.__linha
    });
  });

  return {
    ok: true,
    mensagem: lista.length
      ? lista.length + ' nota(s) para conferir na mão.'
      : 'Nenhuma nota pela metade.',
    dados: { total: lista.length, lista: lista }
  };
}

/**
 * Compara os itens gravados com os que vieram da tela.
 * Alterado atualiza · novo entra · removido sai.
 * A comparação usa o identificador do item, nunca a descrição —
 * Bota 40 e Bota 41 são itens diferentes.
 */
function AP_NF_sincronizarItens_(id, cabec, novos, quem, agora, idLanc) {
  var aba = AP_NF_aba_(AP_NF_ABAS.itens);
  /* [CORRIGIDO] antes isto pegava todo item com o mesmo idNF — que é
     do DOCUMENTO — e, mais abaixo, apagava com deleteRow o que não
     estivesse na lista nova. Salvar a nota 53168 de um fornecedor
     apagava os itens da 53168 do outro. Agora o recorte é o
     lançamento, e o que sai de cena é MARCADO, não apagado. */
  var gravados = AP_NF_linhas_(AP_NF_ABAS.itens).filter(function (i) {
    if (idLanc) {
      var meu = String(i.idLanc || '');
      if (meu) return meu === idLanc;
      /* item antigo, sem idLanc: só entra se o documento bater E não
         existir outro lançamento disputando esse item */
      if (AP_NF_lancamentosDoDocumento_(cabec) > 1) return false;
    }
    var seu = String(i.idNF || '') || AP_NF_id({ numero: i.nf, serie: i.serie, cnpj: i.cnpj });
    return seu === id;
  });

  var usados = {};
  var criados = 0, atualizados = 0;

  novos.forEach(function (bruto) {
    var item = AP_NF_normalizarItem_(bruto, id, cabec);
    item.lancadoPor = quem;
    item.lancadoEm = agora;

    var alvo = null;
    if (item.id) {
      alvo = gravados.filter(function (g) { return String(g.id) === String(item.id) && !usados[g.__linha]; })[0];
    }
    if (!alvo) {
      alvo = gravados.filter(function (g) {
        if (usados[g.__linha]) return false;
        return AP_NF_chaveItem_(g) === AP_NF_chaveItem_(item);
      })[0];
    }

    if (alvo) {
      usados[alvo.__linha] = true;
      item.id = alvo.id || item.id;
      item.lancadoEm = alvo.lancadoEm || agora;
      AP_NF_escreverLinha_(AP_NF_ABAS.itens, alvo.__linha, item);
      atualizados++;
    } else {
      item.id = item.id || 'ITNF-' + new Date().getTime() + '-' + Math.floor(Math.random() * 1000);
      AP_NF_acrescentar_(AP_NF_ABAS.itens, item);
      criados++;
    }
  });

  /* [CORRIGIDO] o que saiu da nota é MARCADO como EXCLUIDO e continua
     na planilha. Antes era deleteRow — e linha apagada não volta. */
  var sobraram = gravados.filter(function (g) { return !usados[g.__linha]; })
    .sort(function (a, b) { return b.__linha - a.__linha; });
  sobraram.forEach(function (g) {
    AP_NF_escreverLinha_(AP_NF_ABAS.itens, g.__linha, {
      status: 'EXCLUIDO',
      observacao: 'tirado da nota em ' + agora + ' por ' + (quem || 'sistema')
    });
  });

  return { criados: criados, atualizados: atualizados, marcados: sobraram.length,
    removidos: 0, apagouLinha: false };
}

/* ------------------------------------------------------------
   PASSAGEM PARA O MÓDULO DE ALTERAR/RESTAURAR
   Não duplica nada: chama a função de lá. Se o arquivo não
   estiver instalado, diz exatamente isso.
   ------------------------------------------------------------ */
function AP_NF_paraNfed_(p, sessao) {
  var mapa = {
    lixeira: 'lixeira', restaurar: 'restaurar', lancamentos: 'lancamentos',
    estoqueDoLancamento: 'estoque', marcarMovimento: 'marcarMovimento',
    migrarIdLanc: 'migrar'
  };
  var acao = mapa[p.acao];
  if (typeof AP_NFED_direto !== 'function') {
    return { ok: false, codigo: 'SEM_ARQUIVO_DE_EDICAO',
      mensagem: 'nf.' + p.acao + ' precisa do arquivo ALMOX_PRO_Notas_Alterar.gs ' +
        '(contrato nfed.v2), que não está instalado neste projeto.' };
  }
  var escrita = ['restaurar', 'marcarMovimento', 'migrar'].indexOf(acao) > -1;
  if (escrita && !sessao) {
    return { ok: false, codigo: 'SEM_SESSAO', mensagem: 'Faça login de novo.' };
  }
  try {
    return JSON.parse(AP_NFED_direto(JSON.stringify({
      acao: acao, payload: p.payload || {}, token: p.token || null })));
  } catch (e) {
    return { ok: false, codigo: 'NFED_ERRO', mensagem: String((e && e.message) || e) };
  }
}

/** Quantos lançamentos existem do mesmo documento fiscal. */
function AP_NF_lancamentosDoDocumento_(cabec) {
  var id = AP_NF_id(cabec || {});
  if (!id) return 0;
  try {
    return AP_NF_linhas_(AP_NF_ABAS.notas).filter(function (l) {
      return (String(l.idNF || '') || AP_NF_id(l)) === id;
    }).length;
  } catch (e) { return 0; }
}

/** Identidade do item dentro da nota: produto + tamanho, nunca só a descrição. */
function AP_NF_chaveItem_(i) {
  var produto = AP_NF_so_(i.idProduto || i.sku || i.codigo);
  var tamanho = AP_NF_so_(i.tamanho);
  if (produto) return 'P:' + produto + (tamanho ? '#' + tamanho : '');
  /* sem cadastro ainda: descrição + tamanho + valor unitário */
  return 'D:' + String(i.descricao || '').trim().toUpperCase() +
    '#' + tamanho + '#' + (Number(i.valorUnitario) || 0).toFixed(2);
}

function AP_NF_normalizarItem_(i, id, cabec) {
  var q = Number(i.quantidade !== undefined ? i.quantidade : i.qtd) || 0;
  var vu = Number(i.valorUnitario) || 0;
  return {
    id: i.id || '',
    idNF: id,
    nf: cabec.numero,
    serie: cabec.serie,
    sku: i.sku || '',
    idProduto: i.idProduto || i.sku || '',
    codigo: i.codigo || i.codigoFornecedor || '',
    descricao: i.descricao || '',
    tamanho: i.tamanho || '',
    ncm: i.ncm || '',
    unidade: i.unidade || 'UN',
    quantidade: q,
    valorUnitario: vu,
    valorTotal: Number(i.valorTotal) || Math.round(q * vu * 100) / 100,
    fornecedor: cabec.fornecedor,
    cnpj: cabec.cnpj,
    obra: i.obra || '',
    lote: i.lote || '',
    validade: i.validade || '',
    emissao: cabec.emissao,
    entrada: cabec.entrada,
    status: i.status || cabec.status,
    observacao: i.observacao || ''
  };
}

/* ============================================================
   EXCLUIR
   ------------------------------------------------------------
   [CORRIGIDO] O QUE ESTA FUNÇÃO FAZIA, E O ESTRAGO QUE DAVA
   ------------------------------------------------------------
   Ela apagava linha de planilha com deleteRow — a da nota e as
   dos itens — e escolhia as linhas pelo id do DOCUMENTO
   (AP_NF_id = número + série + CNPJ). Quando a nota foi lançada
   à mão, sem série e sem CNPJ, duas notas 53168 de fornecedores
   DIFERENTES recebiam o mesmo id "NF:53168-0". Medido num teste
   com duas notas e três itens: um pedido de exclusão respondeu
   "itensRemovidos: 3" e deixou a planilha com 1 cabeçalho e
   ZERO itens — os itens dos dois fornecedores apagados de vez,
   sem backup e sem como voltar atrás.

   AGORA
   · Não existe mais deleteRow aqui. Nenhum.
   · A exclusão é LÓGICA e vale para UM lançamento.
   · Quem faz é o ALMOX_PRO_Notas_Alterar (nfed), que tem o
     idLanc, o backup e a lixeira. Esta função só encaminha.
   · Se aquele arquivo não estiver instalado, ela RECUSA e diz o
     que instalar — porque excluir sem poder restaurar é o
     problema, não a solução.
   ============================================================ */
function AP_NF_excluir(p, sessao) {
  p = p || {};
  var quem = (sessao && (sessao.usuario || sessao.nome)) || 'sistema';

  /* ---- 1. o caminho certo: o módulo que sabe excluir ---- */
  if (typeof NFED_excluir_ === 'function') {
    var carga = {};
    for (var k in p) if (p.hasOwnProperty(k)) carga[k] = p[k];
    if (!carga.motivo) carga.motivo = 'exclusão pedida pela tela de notas';
    var r = NFED_excluir_(carga, quem);
    if (r && r.ok) {
      return { ok: true, dados: r.dados, mensagem: r.mensagem,
        por: 'nfed', apagouLinha: false };
    }
    return { ok: false, codigo: (r && r.codigo) || 'RECUSADO',
      mensagem: (r && r.mensagem) || 'A exclusão foi recusada.',
      lancamentos: r && r.lancamentos, por: 'nfed' };
  }

  /* ---- 2. sem aquele arquivo, não dá para excluir com segurança ---- */
  var id = String(p.id || p.idNF || '') || AP_NF_id(p);
  var quantas = 0, quantosItens = 0;
  try {
    quantas = AP_NF_linhas_(AP_NF_ABAS.notas).filter(function (l) {
      return (String(l.idNF || '') || AP_NF_id(l)) === id; }).length;
    quantosItens = AP_NF_linhas_(AP_NF_ABAS.itens).filter(function (i) {
      var seu = String(i.idNF || '') ||
        AP_NF_id({ numero: i.nf, serie: i.serie, cnpj: i.cnpj });
      return seu === id; }).length;
  } catch (e) {}

  try {
    AP_Audit_log(quem, 'NF_EXCLUSAO_RECUSADA', AP_NF_ABAS.notas, id,
      { porque: 'ALMOX_PRO_Notas_Alterar ausente', bateriam: quantas });
  } catch (e) {}

  return { ok: false, codigo: 'SEM_ARQUIVO_DE_EDICAO',
    mensagem: 'NADA foi excluído, de propósito. Esta versão não apaga mais linha ' +
      'de planilha, e a exclusão segura (um lançamento só, com backup e lixeira) ' +
      'mora no arquivo ALMOX_PRO_Notas_Alterar.gs, que não está instalado neste ' +
      'projeto. Instale-o e tente de novo. ' +
      (quantas > 1
        ? 'Aviso: o identificador "' + id + '" bate com ' + quantas +
          ' lançamentos e ' + quantosItens + ' itens — era isto que a versão ' +
          'anterior apagava de uma vez.'
        : ''),
    dados: { id: id, lancamentosQueBateriam: quantas,
      itensQueBateriam: quantosItens, apagouLinha: false } };
}

/* ============================================================
   RECUPERAÇÃO DO HISTÓRICO
   ============================================================ */

/** Grava, na aba de notas, o cabeçalho das notas que só têm itens. */
function AP_NF_recuperarOrfas_() {
  AP_NF_garantirColunas_(AP_NF_ABAS.notas, AP_NF_COL_NOTA);
  AP_NF_garantirColunas_(AP_NF_ABAS.itens, AP_NF_COL_ITEM);

  var lista = AP_NF_listar({}).dados.filter(function (n) { return n.reconstruida; });
  var agora = AP_NF_agora_();
  var feitas = [];

  lista.forEach(function (n) {
    if (!n.numero) return;
    AP_NF_acrescentar_(AP_NF_ABAS.notas, {
      numero: n.numero, serie: n.serie, chave: n.chave,
      fornecedor: n.fornecedor, cnpj: n.cnpj,
      emissao: n.emissao, entrada: n.entrada,
      valor: n.valor, itens: n.qtdItens,
      status: n.status, origem: n.origem,
      arquivoId: '', lancadoPor: n.lancadoPor || 'recuperado',
      lancadoEm: n.lancadoEm || agora,
      idNF: n.id, atualizadoEm: agora,
      observacao: 'Cabeçalho reconstruído a partir dos itens gravados.'
    });
    feitas.push(n.numero + ' (' + n.qtdItens + ' itens · ' + n.valor.toFixed(2) + ')');
  });

  /* carimba o idNF nos itens antigos, para o vínculo ficar forte */
  var carimbados = 0;
  var aba = AP_NF_aba_(AP_NF_ABAS.itens);
  var cab = AP_NF_cabecalho_(aba);
  var iCol = cab.indexOf('idNF') + 1;
  if (iCol > 0) {
    AP_NF_linhas_(AP_NF_ABAS.itens).forEach(function (i) {
      if (i.idNF) return;
      var id = AP_NF_id({ numero: i.nf, serie: i.serie, cnpj: i.cnpj });
      if (!id) return;
      aba.getRange(i.__linha, iCol).setValue(id);
      carimbados++;
    });
  }

  return {
    ok: true,
    dados: {
      recuperadas: feitas.length,
      notas: feitas,
      itensVinculados: carimbados
    },
    mensagem: feitas.length
      ? feitas.length + ' nota(s) voltaram para o histórico.'
      : 'Nenhuma nota órfã — todos os itens já têm cabeçalho.'
  };
}

/* ============================================================
   DIAGNÓSTICO
   ============================================================ */
function AP_NF_diagnostico_() {
  var notas = AP_NF_linhas_(AP_NF_ABAS.notas);
  var itens = AP_NF_linhas_(AP_NF_ABAS.itens);
  var lista = AP_NF_listar({}).dados;
  var orfas = lista.filter(function (n) { return n.reconstruida; });
  var semItem = lista.filter(function (n) { return !n.qtdItens; });
  var semValor = lista.filter(function (n) { return !n.valor; });

  return {
    ok: true,
    dados: {
      linhasNaAbaDeNotas: notas.length,
      linhasNaAbaDeItens: itens.length,
      notasNoHistorico: lista.length,
      notasSemCabecalho: orfas.length,
      notasSemItens: semItem.length,
      notasSemValor: semValor.length,
      porOrigem: lista.reduce(function (a, n) {
        a[n.origem] = (a[n.origem] || 0) + 1; return a;
      }, {}),
      porStatus: lista.reduce(function (a, n) {
        a[n.status] = (a[n.status] || 0) + 1; return a;
      }, {}),
      exemploOrfa: orfas.length ? { numero: orfas[0].numero, itens: orfas[0].qtdItens, valor: orfas[0].valor } : null
    }
  };
}

/* ============================================================
   LIMPEZA GERAL — recomeçar o lançamento de notas do zero
   ------------------------------------------------------------
   O QUE APAGA
     Só as duas abas de nota fiscal: ALMOXA_NOTAS e ALMOXA_NF_ITENS.

   O QUE NÃO ENCOSTA
     Estoque, movimentações, entradas, reservas, EPI, patrimônio,
     usuários, crachás, compras, pré-contas. Nada disso é tocado.
     Apagar nota aqui NÃO desfaz entrada de estoque: o saldo que
     já entrou continua lá, de propósito, porque é o Ismael que
     vai conferir o estoque depois, num pente fino à parte.

   NADA É PERDIDO DE VERDADE
     Antes de apagar, as duas abas são COPIADAS para abas novas
     com a data e a hora no nome. Se der arrependimento, existe
     AP_NF_restaurarBackup para trazer tudo de volta.

   NÃO DISPARA SEM QUERER
     Só funciona se vier a palavra exata de confirmação no pedido.
     Um clique errado na tela não apaga nada.
   ============================================================ */

var AP_NF_SENHA_LIMPEZA = 'APAGAR TODAS AS NOTAS';

function AP_NF_carimbo_() {
  var d = new Date();
  function dd(n) { return (n < 10 ? '0' : '') + n; }
  /* com os segundos: duas limpezas no mesmo minuto não podem
     disputar o mesmo nome de aba */
  return d.getFullYear() + dd(d.getMonth() + 1) + dd(d.getDate()) + '_' +
    dd(d.getHours()) + dd(d.getMinutes()) + dd(d.getSeconds());
}

/** Quantas notas e itens existem hoje — para a tela avisar antes. */
function AP_NF_contarTudo_() {
  var notas = AP_NF_linhas_(AP_NF_ABAS.notas);
  var itens = AP_NF_linhas_(AP_NF_ABAS.itens);
  var lista = AP_NF_listar({}).dados || [];

  var valor = 0;
  lista.forEach(function (n) { valor += Number(n.valor) || 0; });

  return {
    ok: true,
    dados: {
      notas: lista.length,
      linhasDeNota: notas.length,
      itens: itens.length,
      valorSomado: valor,
      backups: AP_NF_listarBackups_().dados.backups,
      senha: AP_NF_SENHA_LIMPEZA
    }
  };
}

function AP_NF_listarBackups_() {
  var ss = AP_Config_getSpreadsheet_();
  var lista = [];
  ss.getSheets().forEach(function (aba) {
    var nome = aba.getName();
    var m = nome.match(/^(ALMOXA_NOTAS|ALMOXA_NF_ITENS)_BACKUP_(\d{8}_\d{4,6}[a-z]?)$/);
    if (!m) return;
    lista.push({
      aba: nome,
      tipo: m[1] === AP_NF_ABAS.notas ? 'notas' : 'itens',
      quando: m[2],
      linhas: Math.max(0, aba.getLastRow() - 1)
    });
  });
  lista.sort(function (a, b) { return String(b.quando).localeCompare(String(a.quando)); });
  return { ok: true, dados: { backups: lista } };
}

/** Copia uma aba inteira para outra, com nome novo. */
function AP_NF_copiarAba_(nomeOrigem, nomeDestino) {
  var ss = AP_Config_getSpreadsheet_();
  var origem = ss.getSheetByName(nomeOrigem);
  if (!origem) return 0;
  var copia = origem.copyTo(ss);
  /* se já existir uma aba com esse nome, acrescenta uma letra em vez
     de estourar — perder o backup por causa do nome seria o pior
     jeito possível de falhar */
  var nome = nomeDestino;
  var sufixos = 'abcdefghijklmnopqrstuvwxyz';
  var i = 0;
  while (ss.getSheetByName(nome) && i < sufixos.length) {
    nome = nomeDestino + sufixos.charAt(i);
    i++;
  }
  copia.setName(nome);
  return Math.max(0, copia.getLastRow() - 1);
}

/** Apaga as linhas de dados, deixando o cabeçalho de pé. */
function AP_NF_esvaziarAba_(nome) {
  var aba = AP_NF_aba_(nome);
  var ultima = aba.getLastRow();
  if (ultima < 2) return 0;
  var quantas = ultima - 1;
  aba.deleteRows(2, quantas);
  return quantas;
}

function AP_NF_limparTudo(p, sessao) {
  p = p || {};

  if (String(p.confirmacao || '').trim().toUpperCase() !== AP_NF_SENHA_LIMPEZA) {
    return {
      ok: false,
      codigo: 'CONFIRMACAO_FALTANDO',
      mensagem: 'Para apagar tudo, o pedido precisa trazer a frase exata ' +
        '"' + AP_NF_SENHA_LIMPEZA + '". Isso existe para um clique errado não apagar nada.'
    };
  }

  var trava = LockService.getScriptLock();
  try { trava.waitLock(30000); } catch (e) {
    return { ok: false, codigo: 'OCUPADO', mensagem: 'Outra gravação está em andamento. Tente de novo.' };
  }

  try {
    var antes = AP_NF_contarTudo_().dados;
    if (!antes.linhasDeNota && !antes.itens) {
      return {
        ok: true,
        dados: { notasApagadas: 0, itensApagados: 0, backup: null },
        mensagem: 'As duas abas já estavam vazias. Nada a apagar.'
      };
    }

    /* 1. a cópia vem ANTES de qualquer apagamento */
    var carimbo = AP_NF_carimbo_();
    var abaBackupNotas = AP_NF_ABAS.notas + '_BACKUP_' + carimbo;
    var abaBackupItens = AP_NF_ABAS.itens + '_BACKUP_' + carimbo;

    var copiadasN = AP_NF_copiarAba_(AP_NF_ABAS.notas, abaBackupNotas);
    var copiadasI = AP_NF_copiarAba_(AP_NF_ABAS.itens, abaBackupItens);

    /* confere que a cópia realmente ficou de pé antes de apagar */
    var ss = AP_Config_getSpreadsheet_();
    if (!ss.getSheetByName(abaBackupNotas) || !ss.getSheetByName(abaBackupItens)) {
      return {
        ok: false,
        codigo: 'BACKUP_FALHOU',
        mensagem: 'Não consegui guardar a cópia de segurança. NADA foi apagado — ' +
          'não vou apagar sem ter para onde voltar.'
      };
    }

    /* 2. agora sim */
    var apagadasN = AP_NF_esvaziarAba_(AP_NF_ABAS.notas);
    var apagadasI = AP_NF_esvaziarAba_(AP_NF_ABAS.itens);

    try {
      AP_Audit_log((sessao && sessao.usuario) || 'sistema', 'NF_LIMPEZA_GERAL',
        AP_NF_ABAS.notas, carimbo, {
          notasApagadas: apagadasN,
          itensApagados: apagadasI,
          backupNotas: abaBackupNotas,
          backupItens: abaBackupItens,
          motivo: String(p.motivo || '')
        });
    } catch (e) { }

    return {
      ok: true,
      dados: {
        notasApagadas: apagadasN,
        itensApagados: apagadasI,
        notasNoHistorico: antes.notas,
        backup: {
          notas: abaBackupNotas,
          itens: abaBackupItens,
          linhasNotas: copiadasN,
          linhasItens: copiadasI
        }
      },
      mensagem: apagadasN + ' linha(s) de nota e ' + apagadasI + ' item(ns) apagados. ' +
        'A cópia de segurança ficou nas abas ' + abaBackupNotas + ' e ' + abaBackupItens + '.'
    };
  } finally {
    try { trava.releaseLock(); } catch (e) { }
  }
}

/** Traz de volta um backup. Substitui o que estiver lá agora. */
function AP_NF_restaurarBackup(p, sessao) {
  p = p || {};
  var carimbo = String(p.carimbo || '').trim();
  if (!carimbo) {
    return { ok: false, codigo: 'SEM_CARIMBO', mensagem: 'Diga qual backup (a data e hora no nome da aba).' };
  }
  if (String(p.confirmacao || '').trim().toUpperCase() !== AP_NF_SENHA_LIMPEZA) {
    return {
      ok: false, codigo: 'CONFIRMACAO_FALTANDO',
      mensagem: 'Restaurar substitui o que está lançado agora. ' +
        'O pedido precisa trazer a frase "' + AP_NF_SENHA_LIMPEZA + '".'
    };
  }

  var ss = AP_Config_getSpreadsheet_();
  var deNotas = ss.getSheetByName(AP_NF_ABAS.notas + '_BACKUP_' + carimbo);
  var deItens = ss.getSheetByName(AP_NF_ABAS.itens + '_BACKUP_' + carimbo);
  if (!deNotas || !deItens) {
    return { ok: false, codigo: 'BACKUP_NAO_EXISTE', mensagem: 'Não achei o backup de ' + carimbo + '.' };
  }

  var trava = LockService.getScriptLock();
  try { trava.waitLock(30000); } catch (e) {
    return { ok: false, codigo: 'OCUPADO', mensagem: 'Outra gravação está em andamento.' };
  }

  try {
    /* o que está lá agora também vira backup, senão restaurar seria
       outra forma de perder coisa */
    var carimboAtual = AP_NF_carimbo_();
    AP_NF_copiarAba_(AP_NF_ABAS.notas, AP_NF_ABAS.notas + '_BACKUP_' + carimboAtual);
    AP_NF_copiarAba_(AP_NF_ABAS.itens, AP_NF_ABAS.itens + '_BACKUP_' + carimboAtual);

    AP_NF_esvaziarAba_(AP_NF_ABAS.notas);
    AP_NF_esvaziarAba_(AP_NF_ABAS.itens);

    var voltaram = 0;
    [[deNotas, AP_NF_ABAS.notas], [deItens, AP_NF_ABAS.itens]].forEach(function (par) {
      var origem = par[0];
      var destino = AP_NF_aba_(par[1]);
      var ultima = origem.getLastRow();
      if (ultima < 2) return;
      var largura = origem.getLastColumn();
      var dados = origem.getRange(2, 1, ultima - 1, largura).getValues();
      destino.getRange(2, 1, dados.length, largura).setValues(dados);
      voltaram += dados.length;
    });

    try {
      AP_Audit_log((sessao && sessao.usuario) || 'sistema', 'NF_BACKUP_RESTAURADO',
        AP_NF_ABAS.notas, carimbo, { linhas: voltaram, guardouAtualEm: carimboAtual });
    } catch (e) { }

    return {
      ok: true,
      dados: { carimbo: carimbo, linhas: voltaram, oQueEstavaFoiPara: carimboAtual },
      mensagem: voltaram + ' linha(s) voltaram do backup de ' + carimbo + '. ' +
        'O que estava lançado foi guardado em ' + carimboAtual + '.'
    };
  } finally {
    try { trava.releaseLock(); } catch (e) { }
  }
}

/* ---------- para rodar à mão no Apps Script, se preferir ---------- */

function ALMOXA_NF_VER_QUANTO_TEM() {
  var d = AP_NF_contarTudo_().dados;
  var l = [
    'NOTAS FISCAIS LANÇADAS HOJE',
    '',
    '  notas no histórico : ' + d.notas,
    '  linhas na aba      : ' + d.linhasDeNota,
    '  itens              : ' + d.itens,
    '  valor somado       : R$ ' + (Number(d.valorSomado) || 0).toFixed(2),
    ''
  ];
  if (d.backups.length) {
    l.push('BACKUPS QUE JÁ EXISTEM:');
    d.backups.forEach(function (b) {
      l.push('  ' + b.aba + '  (' + b.linhas + ' linhas)');
    });
  } else {
    l.push('Nenhum backup ainda.');
  }
  Logger.log(l.join('\n'));
  return l.join('\n');
}


/* ============================================================
   PLANILHA
   ============================================================ */
function AP_NF_aba_(nome) {
  var ss = AP_Config_getSpreadsheet_();
  var aba = ss.getSheetByName(nome);
  if (!aba) {
    aba = ss.insertSheet(nome);
    var colunas = (nome === AP_NF_ABAS.notas) ? AP_NF_COL_NOTA : AP_NF_COL_ITEM;
    aba.getRange(1, 1, 1, colunas.length).setValues([colunas]);
    aba.setFrozenRows(1);
  }
  return aba;
}

function AP_NF_cabecalho_(aba) {
  var n = Math.max(1, aba.getLastColumn());
  return aba.getRange(1, 1, 1, n).getValues()[0].map(function (c) { return String(c).trim(); });
}

/** Acrescenta as colunas que faltam, sem mexer nas que já existem. */
function AP_NF_garantirColunas_(nome, colunas) {
  var aba = AP_NF_aba_(nome);
  var cab = AP_NF_cabecalho_(aba);
  var faltam = colunas.filter(function (c) { return cab.indexOf(c) === -1; });
  if (faltam.length) {
    aba.getRange(1, cab.length + 1, 1, faltam.length).setValues([faltam]);
  }
  return aba;
}

function AP_NF_linhas_(nome) {
  var aba = AP_NF_aba_(nome);
  if (aba.getLastRow() < 2) return [];
  var cab = AP_NF_cabecalho_(aba);
  return aba.getRange(2, 1, aba.getLastRow() - 1, aba.getLastColumn()).getValues()
    .map(function (linha, k) {
      var o = { __linha: k + 2 };
      cab.forEach(function (c, i) { if (c) o[c] = linha[i]; });
      return o;
    })
    .filter(function (o) {
      return Object.keys(o).some(function (k) {
        return k !== '__linha' && o[k] !== '' && o[k] !== null;
      });
    });
}

function AP_NF_acharLinha_(nome, id) {
  return AP_NF_linhas_(nome).filter(function (l) {
    var seu = String(l.idNF || '') || AP_NF_id(l);
    return seu === id;
  })[0] || null;
}

/** Escreve só nas colunas que o registro traz. Coluna ausente fica intacta. */
function AP_NF_escreverLinha_(nome, linha, registro) {
  var aba = AP_NF_aba_(nome);
  var cab = AP_NF_cabecalho_(aba);
  var atual = aba.getRange(linha, 1, 1, cab.length).getValues()[0];
  cab.forEach(function (c, i) {
    if (c && registro[c] !== undefined) atual[i] = registro[c];
  });
  aba.getRange(linha, 1, 1, cab.length).setValues([atual]);
}

function AP_NF_acrescentar_(nome, registro) {
  var aba = AP_NF_aba_(nome);
  var cab = AP_NF_cabecalho_(aba);
  aba.appendRow(cab.map(function (c) {
    return registro[c] !== undefined ? registro[c] : '';
  }));
}

function AP_NF_agora_() {
  return Utilities.formatDate(new Date(),
    AP_Config_get('TIMEZONE', 'America/Sao_Paulo'), "yyyy-MM-dd'T'HH:mm:ss");
}

/* ============================================================
   PARA RODAR NO EDITOR
   ============================================================ */

/** Mostra o que está na planilha e o que o histórico devolveria. */
function AP_NF_diagnostico() {
  var d = AP_NF_diagnostico_().dados;
  var linhas = ['===== NOTAS FISCAIS — DIAGNÓSTICO ====='];
  linhas.push('');
  linhas.push('Linhas na aba ' + AP_NF_ABAS.notas + ': ' + d.linhasNaAbaDeNotas);
  linhas.push('Linhas na aba ' + AP_NF_ABAS.itens + ': ' + d.linhasNaAbaDeItens);
  linhas.push('');
  linhas.push('Notas que o histórico devolve: ' + d.notasNoHistorico);
  linhas.push('  · sem cabeçalho gravado (só itens): ' + d.notasSemCabecalho);
  linhas.push('  · sem nenhum item: ' + d.notasSemItens);
  linhas.push('  · com valor zerado: ' + d.notasSemValor);
  linhas.push('');
  linhas.push('Por origem: ' + JSON.stringify(d.porOrigem));
  linhas.push('Por status: ' + JSON.stringify(d.porStatus));
  if (d.exemploOrfa) {
    linhas.push('');
    linhas.push('Exemplo de nota sem cabeçalho: NF ' + d.exemploOrfa.numero +
      ' · ' + d.exemploOrfa.itens + ' item(ns) · R$ ' + d.exemploOrfa.valor.toFixed(2));
    linhas.push('Rode AP_NF_recuperarOrfas para trazer estas notas de volta.');
  }
  var txt = linhas.join('\n');
  Logger.log(txt);
  return txt;
}

/** Reconstrói o cabeçalho das notas que só têm itens. */
function AP_NF_recuperarOrfas() {
  var r = AP_NF_recuperarOrfas_();
  var txt = r.mensagem + (r.dados.notas.length ? '\n\n' + r.dados.notas.join('\n') : '') +
    '\n\nItens que ganharam vínculo forte: ' + r.dados.itensVinculados;
  Logger.log(txt);
  return txt;
}

/** Lista o histórico como a tela vai ver. Não altera nada. */
/**
 * Copia as notas que já estão na planilha para o armazém do Drive.
 * NÃO apaga nada da planilha. Pode rodar quantas vezes quiser —
 * ele continua de onde parou e não copia duas vezes.
 */
function ALMOXA_NF_MANDAR_AO_ARMAZEM() {
  var r = AP_NF_mandarTudoAoArmazem_({}, { usuario: 'pelo editor' });
  if (!r.ok) return AP_NF_LOG_(['NÃO DEU: ' + r.mensagem]);
  var d = r.dados;
  var l = [];
  l.push('COPIANDO AS NOTAS PARA O ARMAZÉM DO DRIVE');
  l.push('');
  l.push('Notas na planilha   : ' + d.naPlanilha);
  l.push('Copiadas agora      : ' + d.copiadas);
  l.push('Já estavam lá       : ' + d.jaEstavam);
  l.push('Não deram certo     : ' + d.falharam);
  l.push('Tempo               : ' + d.segundos + 's');
  l.push('');
  if (d.listaDeFalhas && d.listaDeFalhas.length) {
    l.push('--- AS QUE NÃO FORAM ---');
    d.listaDeFalhas.forEach(function (f) { l.push('  ' + f.id + '  ->  ' + f.motivo); });
    l.push('');
  }
  if (!d.terminou) {
    l.push('>>> PAREI POR TEMPO. Faltam cerca de ' + d.faltam + '.');
    l.push('    Rode esta mesma função de novo — ela continua de onde parou.');
  } else {
    l.push('>>> ACABOU. Toda nota da planilha tem o seu arquivo no Drive.');
  }
  l.push('');
  l.push('NADA foi apagado da planilha. O armazém é o segundo lugar.');
  l.push('Para ver onde ficou: ALMOXA_ARMAZEM_ONDE_FICA');
  return AP_NF_LOG_(l);
}

/** Quanto da planilha já está no Drive. */
function ALMOXA_NF_VER_ARMAZEM() {
  var r = AP_NF_estadoDoArmazem_();
  if (!r.dados.instalado) {
    return AP_NF_LOG_(['O armazém do Drive não está instalado.', '',
      'Cole o ALMOXA_PRO_Armazem_Drive e rode ALMOXA_ARMAZEM_INSTALAR.']);
  }
  var d = r.dados;
  return AP_NF_LOG_([
    'NOTA FISCAL — PLANILHA x ARMAZÉM', '',
    'Na planilha  : ' + d.naPlanilha + ' nota(s)',
    'No armazém   : ' + d.noArmazem + ' arquivo(s)',
    'Faltam ir    : ' + d.faltam,
    'Na lixeira   : ' + d.naLixeira,
    '',
    'Pasta: ' + d.url,
    '',
    d.faltam > 0
      ? 'Rode ALMOXA_NF_MANDAR_AO_ARMAZEM para copiar o que falta.'
      : 'Está tudo nos dois lugares.'
  ]);
}

function AP_NF_LOG_(linhas) {
  var txt = linhas.join('\n');
  try { Logger.log(txt); } catch (e) {}
  return txt;
}

function AP_NF_verHistorico() {
  var lista = AP_NF_listar({}).dados;
  var linhas = ['===== HISTÓRICO DE NOTAS (' + lista.length + ') ====='];
  lista.forEach(function (n) {
    linhas.push('');
    linhas.push('NF ' + n.numero + (n.serie ? '-' + n.serie : '') + '  ·  ' + n.origem + '  ·  ' + n.status +
      (n.reconstruida ? '  [cabeçalho reconstruído]' : ''));
    linhas.push('  fornecedor: ' + (n.fornecedor || '—'));
    linhas.push('  itens: ' + n.qtdItens + '  ·  valor: R$ ' + Number(n.valor).toFixed(2) +
      (n.valor !== n.valorItens ? '  (soma dos itens: R$ ' + n.valorItens.toFixed(2) + ')' : ''));
    n.itens.forEach(function (i) {
      linhas.push('    - ' + (i.descricao || '(sem descrição)') + (i.tamanho ? ' [' + i.tamanho + ']' : '') +
        '  ' + i.quantidade + ' ' + i.unidade + '  ×  R$ ' + Number(i.valorUnitario).toFixed(2) +
        '  =  R$ ' + Number(i.valorTotal).toFixed(2) + (i.sku ? '  · ' + i.sku : ''));
    });
  });
  if (!lista.length) linhas.push('Nenhuma nota encontrada nas duas abas.');
  var txt = linhas.join('\n');
  Logger.log(txt);
  return txt;
}
