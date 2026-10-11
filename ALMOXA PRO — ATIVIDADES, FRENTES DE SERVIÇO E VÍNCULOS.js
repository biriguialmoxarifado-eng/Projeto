/* ============================================================
   ALMOXA PRO — ATIVIDADES, FRENTES DE SERVIÇO E VÍNCULOS
   ============================================================

   POR QUE ESTE ARQUIVO EXISTE
   ---------------------------
   Você pediu para classificar as saídas e transferências ANTIGAS
   por tipo de atividade, para a rastreabilidade começar a andar.
   Eu disse que não dava, porque não havia onde gravar o vínculo —
   e gravar em lugar nenhum, só para a tela dizer "sucesso", é
   exatamente o que o item 183 do seu projeto proíbe.

   Este arquivo é o "onde gravar". Ele cria DUAS abas próprias:

     ALMOXA_ATIVIDADES      o cadastro das atividades / frentes de
                            serviço, cada uma apontando para UM
                            centro de custo
     ALMOXA_VINCULOS_MOV    a ligação entre uma movimentação que já
                            existe (saída, transferência, reserva) e
                            a atividade dela

   O QUE ELE NÃO FAZ — de propósito
   --------------------------------
   NÃO cria banco paralelo. A aba de vínculos NÃO guarda cópia da
   saída: nem produto, nem quantidade, nem valor, nem solicitante.
   Guarda só a CHAVE da movimentação e a atividade. Se guardasse
   cópia, existiriam dois valores para a mesma saída e eles
   divergiriam no primeiro acerto de estoque.

   NÃO mexe em aba existente. Não apaga linha, não renomeia coluna,
   não reescreve nada do Core. Se as abas já existirem, ele apenas
   completa as colunas que faltarem.

   NÃO apaga registro. Desclassificar vira STATUS = EXCLUIDO e a
   linha fica. Reclassificar vira STATUS = SUBSTITUIDO na linha
   velha e uma linha nova — o histórico de quem classificou o quê,
   quando e por quê fica inteiro (itens 116 e 183).

   NÃO adivinha centro de custo por semelhança de nome. Se a
   atividade não tiver centro de custo cadastrado, o vínculo é
   recusado com o nome do cadastro que falta (item 83).

   O CENTRO DE CUSTO APARECE DUAS VEZES, E ISSO É INTENCIONAL
   ----------------------------------------------------------
   Cada vínculo grava o centro de custo que a atividade apontava NO
   MOMENTO da classificação. A leitura devolve também o centro que
   a atividade aponta HOJE, e marca divergente: true quando os dois
   diferem.

   Não é duplicidade: são dois fatos diferentes. "Onde este
   consumo foi debitado" é história, não muda mais. "Onde esta
   atividade é debitada hoje" é cadastro, pode mudar amanhã. Se eu
   guardasse só um dos dois, ou o relatório do ano passado mudaria
   sozinho, ou você nunca saberia que o cadastro mudou.

   COMO INSTALAR
   -------------
     1. Planilha "Base Dado almoxarifado" → Extensões → Apps Script
     2. "+" ao lado de Arquivos → Script
     3. Nome: ALMOXA_PRO_Modulo_Vinculos
     4. Cole este conteúdo inteiro e salve (Ctrl+S)
     5. Implantar → Gerenciar implantações → editar → Nova versão
     6. Para conferir sem gravar nada: escolha a função
        AP_VINC_testes e execute. Ela não toca na planilha.

   ============================================================ */


var AP_VINC_CFG = {
  versao: '1.0.0',

  abaAtividades: 'ALMOXA_ATIVIDADES',
  colunasAtividade: [
    'ID', 'CODIGO', 'NOME', 'TIPO', 'FRENTE',
    'CENTRO_CUSTO', 'CENTRO_CUSTO_NOME', 'OBRA', 'RESPONSAVEL', 'OBSERVACAO',
    'STATUS', 'CRIADO_EM', 'CRIADO_POR', 'ALTERADO_EM', 'ALTERADO_POR', 'MOTIVO'
  ],

  abaVinculos: 'ALMOXA_VINCULOS_MOV',
  /* CHAVE_MOV é o protocolo (ou o id) da movimentação que JÁ existe
     noutra aba. Esta aba não repete nada do conteúdo dela. */
  colunasVinculo: [
    'ID', 'TIPO_MOV', 'CHAVE_MOV',
    'ATIVIDADE_ID', 'ATIVIDADE_CODIGO', 'ATIVIDADE_NOME',
    'CENTRO_CUSTO', 'CENTRO_CUSTO_NOME',
    'OBSERVACAO', 'STATUS',
    'CRIADO_EM', 'CRIADO_POR', 'ALTERADO_EM', 'ALTERADO_POR', 'MOTIVO'
  ],

  caminhos: ['', '01_BANCO_DADOS/'],

  /* os tipos de movimentação que aceitam vínculo. Fechado de
     propósito: tipo escrito errado viraria um vínculo órfão que
     nenhum relatório acha. */
  tiposMov: ['SAIDA', 'TRANSFERENCIA', 'RESERVA', 'ENTRADA', 'DEVOLUCAO', 'BAIXA', 'AJUSTE'],

  /* classificar 400 saídas de uma vez num só clique estoura o
     tempo do Apps Script e deixa metade gravada. O limite é por
     chamada; a tela manda em blocos. */
  maxPorChamada: 200
};


/* ============================================================
   AS PORTAS DO ROTEADOR
   ------------------------------------------------------------
   Dois módulos, um arquivo. O frontend já chama "atividades" (o
   formulário da Loja, desde a versão 216, procura as frentes de
   serviço ali e hoje não acha ninguém atendendo).
   ============================================================ */
function AP_Modulo_atividades(acao, payload, sessao) {
  payload = payload || {};
  sessao = sessao || {};
  try {
    switch (String(acao || '').trim()) {
      case 'listar':      return { ok: true, dados: AP_VINC_atividades_(payload) };
      case 'obter':       return AP_VINC_atividadeObter_(payload);
      case 'salvar':      return AP_VINC_atividadeSalvar_(payload, sessao);
      case 'excluir':     return AP_VINC_atividadeExcluir_(payload, sessao);
      case 'diagnostico': return { ok: true, dados: AP_VINC_diagnostico_() };
      default:
        return { ok: false, codigo: 'ACAO_DESCONHECIDA',
          mensagem: 'As atividades não conhecem a ação "' + acao +
            '". Conhece: listar, obter, salvar, excluir, diagnostico.' };
    }
  } catch (e) {
    return { ok: false, codigo: 'ERRO', mensagem: e.message,
      onde: String(e.stack || '').slice(0, 400) };
  }
}

/* "frentes" é como algumas telas chamam a mesma coisa. Não é um
   segundo cadastro: é a MESMA aba, devolvida pela mesma função.
   Dois cadastros de frente de serviço seria o começo do fim. */
function AP_Modulo_frentes(acao, payload, sessao) {
  return AP_Modulo_atividades(acao, payload, sessao);
}

function AP_Modulo_vinculos(acao, payload, sessao) {
  payload = payload || {};
  sessao = sessao || {};
  try {
    switch (String(acao || '').trim()) {
      case 'listar':       return { ok: true, dados: AP_VINC_listar_(payload) };
      case 'vincular':     return AP_VINC_vincular_(payload, sessao);
      case 'desvincular':  return AP_VINC_desvincular_(payload, sessao);
      case 'resumo':       return { ok: true, dados: AP_VINC_resumo_(payload) };
      case 'diagnostico':  return { ok: true, dados: AP_VINC_diagnostico_() };
      default:
        return { ok: false, codigo: 'ACAO_DESCONHECIDA',
          mensagem: 'Os vínculos não conhecem a ação "' + acao +
            '". Conhece: listar, vincular, desvincular, resumo, diagnostico.' };
    }
  } catch (e) {
    return { ok: false, codigo: 'ERRO', mensagem: e.message,
      onde: String(e.stack || '').slice(0, 400) };
  }
}


/* ============================================================
   AS ABAS
   ------------------------------------------------------------
   Mesmo caminho que os outros módulos usam: se o servidor tiver o
   atalho AP_SRV_aba_, usa; senão abre na planilha ativa. Cria
   somente se não existir, e nunca sobrescreve cabeçalho — só
   acrescenta coluna que falta, no fim.
   ============================================================ */
function AP_VINC_viva_(aba) {
  if (!aba) return false;
  try { aba.getLastColumn(); return true; } catch (e) { return false; }
}

function AP_VINC_aba_(nome, colunas) {
  function completar(aba) {
    var largura = aba.getLastColumn();
    var atuais = largura
      ? aba.getRange(1, 1, 1, largura).getValues()[0].map(function (c) {
          return String(c === null || c === undefined ? '' : c).trim().toUpperCase();
        })
      : [];
    var faltando = colunas.filter(function (c) {
      return atuais.indexOf(String(c).toUpperCase()) < 0;
    });
    if (!faltando.length) return aba;
    aba.getRange(1, largura + 1, 1, faltando.length).setValues([faltando]);
    aba.getRange(1, largura + 1, 1, faltando.length).setFontWeight('bold');
    return aba;
  }

  if (typeof AP_SRV_aba_ === 'function') {
    for (var i = 0; i < AP_VINC_CFG.caminhos.length; i++) {
      var a = null;
      try { a = AP_SRV_aba_(AP_VINC_CFG.caminhos[i] + nome); } catch (e) {}
      if (a && AP_VINC_viva_(a)) return completar(a);
    }
  }
  var ss = SpreadsheetApp.getActive();
  if (!ss) throw new Error('Não há planilha ativa para a aba "' + nome + '".');
  var d = ss.getSheetByName(nome);
  if (d && AP_VINC_viva_(d)) return completar(d);
  if (d) return d;
  var nova = ss.insertSheet(nome);
  nova.getRange(1, 1, 1, colunas.length).setValues([colunas]);
  nova.setFrozenRows(1);
  nova.getRange(1, 1, 1, colunas.length).setFontWeight('bold');
  return nova;
}

function AP_VINC_abaAtividades_() {
  return AP_VINC_aba_(AP_VINC_CFG.abaAtividades, AP_VINC_CFG.colunasAtividade);
}
function AP_VINC_abaVinculos_() {
  return AP_VINC_aba_(AP_VINC_CFG.abaVinculos, AP_VINC_CFG.colunasVinculo);
}

function AP_VINC_indice_(aba) {
  var largura = aba.getLastColumn();
  var porNome = {};
  if (!largura) return porNome;
  aba.getRange(1, 1, 1, largura).getValues()[0].forEach(function (c, i) {
    var k = String(c === null || c === undefined ? '' : c).trim().toUpperCase();
    if (k && porNome[k] === undefined) porNome[k] = i;
  });
  return porNome;
}

function AP_VINC_linhas_(aba) {
  var ultima = aba.getLastRow();
  if (ultima < 2) return [];
  return aba.getRange(2, 1, ultima - 1, aba.getLastColumn()).getValues();
}

function AP_VINC_pegar_(linha, idx, coluna) {
  var i = idx[String(coluna).toUpperCase()];
  if (i === undefined) return '';
  var v = linha[i];
  return v === null || v === undefined ? '' : v;
}

function AP_VINC_montar_(idx, largura, valores) {
  var linha = [];
  for (var i = 0; i < largura; i++) linha.push('');
  Object.keys(valores).forEach(function (n) {
    var i = idx[String(n).toUpperCase()];
    if (i !== undefined && i < largura) linha[i] = valores[n];
  });
  return linha;
}

function AP_VINC_txt_(v) {
  return String(v === null || v === undefined ? '' : v).trim();
}

function AP_VINC_agora_() {
  return Utilities.formatDate(new Date(), 'America/Manaus', "yyyy-MM-dd'T'HH:mm:ss");
}

function AP_VINC_quem_(sessao) {
  return AP_VINC_txt_(sessao && (sessao.nome || sessao.usuario || sessao.matricula)) || 'sistema';
}

var AP_VINC_SEQ = 0;
function AP_VINC_id_(prefixo) {
  AP_VINC_SEQ++;
  var sorte = Math.floor(Math.random() * 1679616).toString(36);
  return (prefixo || 'VIN') + Date.now().toString(36) + '-' + AP_VINC_SEQ + '-' + sorte;
}

/* A chave de uma movimentação, normalizada.
   Protocolo vem com espaço, com e sem zero à frente, às vezes em
   minúscula. Comparar o texto cru faria o mesmo documento aparecer
   como dois. */
function AP_VINC_chave_(v) {
  return AP_VINC_txt_(v).toUpperCase().replace(/\s+/g, '');
}

function AP_VINC_tipo_(v) {
  var t = AP_VINC_txt_(v).toUpperCase()
    .replace(/[ÁÀÂÃÄ]/g, 'A').replace(/[ÉÈÊË]/g, 'E').replace(/[ÍÌÎÏ]/g, 'I')
    .replace(/[ÓÒÔÕÖ]/g, 'O').replace(/[ÚÙÛÜ]/g, 'U').replace(/Ç/g, 'C');
  /* plural e sinônimo caem no termo canônico; qualquer outra coisa
     é recusada mais adiante, não "convertida no que parecer" */
  if (t === 'SAIDAS' || t === 'RETIRADA' || t === 'RETIRADAS') t = 'SAIDA';
  if (t === 'TRANSFERENCIAS') t = 'TRANSFERENCIA';
  if (t === 'RESERVAS') t = 'RESERVA';
  if (t === 'ENTRADAS') t = 'ENTRADA';
  if (t === 'DEVOLUCOES') t = 'DEVOLUCAO';
  if (t === 'BAIXAS') t = 'BAIXA';
  if (t === 'AJUSTES') t = 'AJUSTE';
  return t;
}


/* ============================================================
   ATIVIDADES — LER
   ============================================================ */
function AP_VINC_atividadeEmObjeto_(linha, idx) {
  return {
    id: AP_VINC_txt_(AP_VINC_pegar_(linha, idx, 'ID')),
    codigo: AP_VINC_txt_(AP_VINC_pegar_(linha, idx, 'CODIGO')),
    nome: AP_VINC_txt_(AP_VINC_pegar_(linha, idx, 'NOME')),
    tipo: AP_VINC_txt_(AP_VINC_pegar_(linha, idx, 'TIPO')),
    frente: AP_VINC_txt_(AP_VINC_pegar_(linha, idx, 'FRENTE')),
    centroCusto: AP_VINC_txt_(AP_VINC_pegar_(linha, idx, 'CENTRO_CUSTO')),
    centroCustoNome: AP_VINC_txt_(AP_VINC_pegar_(linha, idx, 'CENTRO_CUSTO_NOME')),
    obra: AP_VINC_txt_(AP_VINC_pegar_(linha, idx, 'OBRA')),
    responsavel: AP_VINC_txt_(AP_VINC_pegar_(linha, idx, 'RESPONSAVEL')),
    observacao: AP_VINC_txt_(AP_VINC_pegar_(linha, idx, 'OBSERVACAO')),
    status: AP_VINC_txt_(AP_VINC_pegar_(linha, idx, 'STATUS')) || 'ATIVA',
    criadoEm: AP_VINC_txt_(AP_VINC_pegar_(linha, idx, 'CRIADO_EM')),
    criadoPor: AP_VINC_txt_(AP_VINC_pegar_(linha, idx, 'CRIADO_POR')),
    alteradoEm: AP_VINC_txt_(AP_VINC_pegar_(linha, idx, 'ALTERADO_EM')),
    alteradoPor: AP_VINC_txt_(AP_VINC_pegar_(linha, idx, 'ALTERADO_POR'))
  };
}

function AP_VINC_atividades_(payload) {
  var aba = AP_VINC_abaAtividades_();
  var idx = AP_VINC_indice_(aba);
  var incluirInativas = !!(payload && payload.incluirInativas);
  var saida = [];
  AP_VINC_linhas_(aba).forEach(function (l) {
    var a = AP_VINC_atividadeEmObjeto_(l, idx);
    if (!a.id) return;
    var st = String(a.status).toUpperCase();
    if (!incluirInativas && (st === 'EXCLUIDA' || st === 'EXCLUIDO' || st === 'INATIVA' || st === 'INATIVO')) return;
    /* o rótulo que a tela mostra e que a pessoa reconhece */
    a.rotulo = (a.codigo ? a.codigo + ' — ' : '') + a.nome;
    a.semCentro = !a.centroCusto;
    saida.push(a);
  });
  saida.sort(function (x, y) {
    return String(x.codigo || x.nome).localeCompare(String(y.codigo || y.nome));
  });
  return saida;
}

function AP_VINC_atividadePorId_(id) {
  var alvo = AP_VINC_txt_(id);
  if (!alvo) return null;
  var lista = AP_VINC_atividades_({ incluirInativas: true });
  for (var i = 0; i < lista.length; i++) {
    if (lista[i].id === alvo) return lista[i];
  }
  return null;
}

function AP_VINC_atividadeObter_(payload) {
  var a = AP_VINC_atividadePorId_(payload && payload.id);
  if (!a) {
    return { ok: false, codigo: 'NAO_ENCONTRADO',
      mensagem: 'Não existe atividade com o id "' + AP_VINC_txt_(payload && payload.id) + '".' };
  }
  return { ok: true, dados: a };
}


/* ============================================================
   ATIVIDADES — GRAVAR
   ============================================================ */
function AP_VINC_atividadeSalvar_(payload, sessao) {
  var nome = AP_VINC_txt_(payload.nome);
  if (!nome) {
    return { ok: false, codigo: 'SEM_NOME',
      mensagem: 'A atividade precisa de nome. Ex.: "Montagem de tubulação", ' +
        '"Instalação elétrica", "Pintura industrial".' };
  }

  var codigo = AP_VINC_txt_(payload.codigo).toUpperCase();
  var centro = AP_VINC_txt_(payload.centroCusto);

  var aba = AP_VINC_abaAtividades_();
  var idx = AP_VINC_indice_(aba);
  var largura = aba.getLastColumn();
  var linhas = AP_VINC_linhas_(aba);
  var agora = AP_VINC_agora_();
  var autor = AP_VINC_quem_(sessao);
  var id = AP_VINC_txt_(payload.id);

  /* código repetido faz dois centros de custo brigarem pela mesma
     atividade no relatório. Barra antes de gravar. */
  if (codigo) {
    for (var i = 0; i < linhas.length; i++) {
      var o = AP_VINC_atividadeEmObjeto_(linhas[i], idx);
      if (!o.id || o.id === id) continue;
      if (String(o.status).toUpperCase().indexOf('EXCLUID') === 0) continue;
      if (o.codigo.toUpperCase() === codigo) {
        return { ok: false, codigo: 'CODIGO_REPETIDO',
          mensagem: 'O código "' + codigo + '" já está na atividade "' + o.nome +
            '". Use outro código ou edite aquela atividade.' };
      }
    }
  }

  var valores = {
    CODIGO: codigo,
    NOME: nome,
    TIPO: AP_VINC_txt_(payload.tipo),
    FRENTE: AP_VINC_txt_(payload.frente),
    CENTRO_CUSTO: centro,
    CENTRO_CUSTO_NOME: AP_VINC_txt_(payload.centroCustoNome),
    OBRA: AP_VINC_txt_(payload.obra),
    RESPONSAVEL: AP_VINC_txt_(payload.responsavel),
    OBSERVACAO: AP_VINC_txt_(payload.observacao),
    ALTERADO_EM: agora,
    ALTERADO_POR: autor,
    MOTIVO: AP_VINC_txt_(payload.motivo)
  };

  if (id) {
    for (var j = 0; j < linhas.length; j++) {
      if (AP_VINC_txt_(AP_VINC_pegar_(linhas[j], idx, 'ID')) !== id) continue;
      var atual = AP_VINC_atividadeEmObjeto_(linhas[j], idx);
      valores.ID = id;
      valores.STATUS = AP_VINC_txt_(payload.status) || atual.status || 'ATIVA';
      valores.CRIADO_EM = atual.criadoEm || agora;
      valores.CRIADO_POR = atual.criadoPor || autor;
      aba.getRange(j + 2, 1, 1, largura)
        .setValues([AP_VINC_montar_(idx, largura, valores)]);
      return { ok: true, dados: { id: id, atualizado: true },
        mensagem: 'Atividade "' + nome + '" atualizada.' };
    }
    return { ok: false, codigo: 'NAO_ENCONTRADO',
      mensagem: 'Não existe atividade com o id "' + id + '" para atualizar.' };
  }

  valores.ID = AP_VINC_id_('ATV');
  valores.STATUS = AP_VINC_txt_(payload.status) || 'ATIVA';
  valores.CRIADO_EM = agora;
  valores.CRIADO_POR = autor;
  aba.appendRow(AP_VINC_montar_(idx, largura, valores));
  return { ok: true, dados: { id: valores.ID, criado: true },
    mensagem: 'Atividade "' + nome + '" cadastrada.' +
      (centro ? '' : ' Ela ainda está sem centro de custo: enquanto estiver assim, ' +
        'não dá para usá-la para classificar consumo.') };
}

/* Não apaga. Troca o status e guarda o motivo (item 183). */
function AP_VINC_atividadeExcluir_(payload, sessao) {
  var id = AP_VINC_txt_(payload.id);
  if (!id) {
    return { ok: false, codigo: 'SEM_ID', mensagem: 'Informe o id da atividade.' };
  }
  var aba = AP_VINC_abaAtividades_();
  var idx = AP_VINC_indice_(aba);
  var linhas = AP_VINC_linhas_(aba);

  for (var i = 0; i < linhas.length; i++) {
    if (AP_VINC_txt_(AP_VINC_pegar_(linhas[i], idx, 'ID')) !== id) continue;

    /* quantos vínculos vivos apontam para ela: inativar sem avisar
       deixaria consumo apontando para uma atividade sumida */
    var presos = AP_VINC_listar_({ atividadeId: id }).length;

    var nova = linhas[i].slice();
    function por(col, v) {
      var k = idx[col];
      if (k !== undefined) nova[k] = v;
    }
    por('STATUS', 'INATIVA');
    por('ALTERADO_EM', AP_VINC_agora_());
    por('ALTERADO_POR', AP_VINC_quem_(sessao));
    por('MOTIVO', AP_VINC_txt_(payload.motivo) || 'inativada pelo usuário');
    aba.getRange(i + 2, 1, 1, aba.getLastColumn()).setValues([nova]);

    return { ok: true, dados: { id: id, vinculosAfetados: presos },
      mensagem: 'Atividade inativada. A linha continua na planilha, com o motivo.' +
        (presos ? ' Atenção: ' + presos + ' movimentação(ões) já classificada(s) nela ' +
          'continuam classificadas — o histórico não se apaga.' : '') };
  }
  return { ok: false, codigo: 'NAO_ENCONTRADO',
    mensagem: 'Não existe atividade com o id "' + id + '".' };
}


/* ============================================================
   VÍNCULOS — LER
   ============================================================ */
function AP_VINC_vinculoEmObjeto_(linha, idx) {
  return {
    id: AP_VINC_txt_(AP_VINC_pegar_(linha, idx, 'ID')),
    tipoMov: AP_VINC_txt_(AP_VINC_pegar_(linha, idx, 'TIPO_MOV')).toUpperCase(),
    chaveMov: AP_VINC_txt_(AP_VINC_pegar_(linha, idx, 'CHAVE_MOV')),
    atividadeId: AP_VINC_txt_(AP_VINC_pegar_(linha, idx, 'ATIVIDADE_ID')),
    atividadeCodigo: AP_VINC_txt_(AP_VINC_pegar_(linha, idx, 'ATIVIDADE_CODIGO')),
    atividadeNome: AP_VINC_txt_(AP_VINC_pegar_(linha, idx, 'ATIVIDADE_NOME')),
    centroCusto: AP_VINC_txt_(AP_VINC_pegar_(linha, idx, 'CENTRO_CUSTO')),
    centroCustoNome: AP_VINC_txt_(AP_VINC_pegar_(linha, idx, 'CENTRO_CUSTO_NOME')),
    observacao: AP_VINC_txt_(AP_VINC_pegar_(linha, idx, 'OBSERVACAO')),
    status: AP_VINC_txt_(AP_VINC_pegar_(linha, idx, 'STATUS')) || 'ATIVO',
    criadoEm: AP_VINC_txt_(AP_VINC_pegar_(linha, idx, 'CRIADO_EM')),
    criadoPor: AP_VINC_txt_(AP_VINC_pegar_(linha, idx, 'CRIADO_POR')),
    alteradoEm: AP_VINC_txt_(AP_VINC_pegar_(linha, idx, 'ALTERADO_EM')),
    alteradoPor: AP_VINC_txt_(AP_VINC_pegar_(linha, idx, 'ALTERADO_POR')),
    motivo: AP_VINC_txt_(AP_VINC_pegar_(linha, idx, 'MOTIVO'))
  };
}

/* payload aceita: tipoMov, chaves (lista), atividadeId, incluirHistorico */
function AP_VINC_listar_(payload) {
  payload = payload || {};
  var aba = AP_VINC_abaVinculos_();
  var idx = AP_VINC_indice_(aba);

  var tipoFiltro = payload.tipoMov ? AP_VINC_tipo_(payload.tipoMov) : '';
  var chavesFiltro = null;
  if (payload.chaves && payload.chaves.length) {
    chavesFiltro = {};
    for (var c = 0; c < payload.chaves.length; c++) {
      chavesFiltro[AP_VINC_chave_(payload.chaves[c])] = 1;
    }
  }
  var atvFiltro = AP_VINC_txt_(payload.atividadeId);
  var historico = !!payload.incluirHistorico;

  /* o cadastro de atividades, lido uma vez, para dizer onde a
     atividade é debitada HOJE */
  var hoje = {};
  AP_VINC_atividades_({ incluirInativas: true }).forEach(function (a) {
    hoje[a.id] = a;
  });

  var saida = [];
  AP_VINC_linhas_(aba).forEach(function (l) {
    var v = AP_VINC_vinculoEmObjeto_(l, idx);
    if (!v.id || !v.chaveMov) return;
    var st = String(v.status).toUpperCase();
    if (!historico && st !== 'ATIVO' && st !== 'ATIVA') return;
    if (tipoFiltro && v.tipoMov !== tipoFiltro) return;
    if (chavesFiltro && !chavesFiltro[AP_VINC_chave_(v.chaveMov)]) return;
    if (atvFiltro && v.atividadeId !== atvFiltro) return;

    var a = hoje[v.atividadeId] || null;
    v.atividadeStatus = a ? a.status : 'NAO_ENCONTRADA';
    v.centroCustoAtual = a ? a.centroCusto : '';
    /* o aviso: onde foi debitado não é mais onde a atividade debita */
    v.centroDivergente = !!(a && a.centroCusto && v.centroCusto &&
      a.centroCusto !== v.centroCusto);
    saida.push(v);
  });
  return saida;
}

/* Quantas movimentações de cada tipo já têm vínculo. A tela usa
   para dizer "47 de 130 classificadas" sem baixar tudo. */
function AP_VINC_resumo_(payload) {
  var vivos = AP_VINC_listar_(payload || {});
  var porTipo = {};
  var porAtividade = {};
  vivos.forEach(function (v) {
    porTipo[v.tipoMov] = (porTipo[v.tipoMov] || 0) + 1;
    var k = v.atividadeId || '(sem atividade)';
    porAtividade[k] = (porAtividade[k] || 0) + 1;
  });
  return {
    total: vivos.length,
    porTipo: porTipo,
    porAtividade: porAtividade,
    divergentes: vivos.filter(function (v) { return v.centroDivergente; }).length,
    orfaos: vivos.filter(function (v) { return v.atividadeStatus === 'NAO_ENCONTRADA'; }).length
  };
}


/* ============================================================
   VÍNCULOS — GRAVAR
   ------------------------------------------------------------
   Uma chamada, uma atividade, várias movimentações. É assim que a
   tela funciona: marca as linhas, escolhe a atividade, confirma.
   ============================================================ */
function AP_VINC_vincular_(payload, sessao) {
  var atividade = AP_VINC_atividadePorId_(payload.atividadeId);
  if (!atividade) {
    return { ok: false, codigo: 'ATIVIDADE_NAO_ENCONTRADA',
      mensagem: 'Escolha uma atividade cadastrada. O id "' +
        AP_VINC_txt_(payload.atividadeId) + '" não existe em ' +
        AP_VINC_CFG.abaAtividades + '.' };
  }
  if (String(atividade.status).toUpperCase() !== 'ATIVA') {
    return { ok: false, codigo: 'ATIVIDADE_INATIVA',
      mensagem: 'A atividade "' + atividade.nome + '" está ' + atividade.status +
        '. Reative-a antes de usá-la para classificar.' };
  }
  /* item 83: dizer qual cadastro falta, nunca preencher com
     invenção. Sem centro de custo, o vínculo não serve para nada
     financeiro — então ele não é gravado. */
  if (!atividade.centroCusto) {
    return { ok: false, codigo: 'ATIVIDADE_SEM_CENTRO',
      mensagem: 'A atividade "' + atividade.nome + '" não tem centro de custo. ' +
        'Cadastre o centro de custo dela primeiro (Projetos → Atividades e ' +
        'frentes de serviço); senão o consumo classificado aqui não entra em ' +
        'orçamento nenhum.' };
  }

  var crus = payload.itens || payload.movimentacoes || [];
  if (!crus.length) {
    return { ok: false, codigo: 'SEM_ITENS',
      mensagem: 'Nenhuma movimentação foi marcada.' };
  }
  if (crus.length > AP_VINC_CFG.maxPorChamada) {
    return { ok: false, codigo: 'LOTE_GRANDE',
      mensagem: 'São ' + crus.length + ' movimentações numa só chamada. O limite é ' +
        AP_VINC_CFG.maxPorChamada + ' — acima disso o Apps Script é interrompido no meio ' +
        'e metade ficaria gravada. Classifique em blocos menores.' };
  }

  /* normaliza e recusa o que não dá para identificar, ANTES de
     escrever qualquer linha */
  var alvos = [];
  var recusados = [];
  var vistos = {};
  for (var i = 0; i < crus.length; i++) {
    var it = crus[i] || {};
    var tipo = AP_VINC_tipo_(it.tipoMov || it.tipo || payload.tipoMov);
    var chave = AP_VINC_chave_(it.chaveMov || it.chave || it.protocolo || it.id);

    if (!chave) {
      recusados.push({ chave: '(vazia)', tipo: tipo,
        motivo: 'a movimentação não trouxe protocolo nem id — sem chave não há como ' +
          'ligar o vínculo a ela depois' });
      continue;
    }
    if (!tipo) {
      recusados.push({ chave: chave, tipo: '',
        motivo: 'tipo de movimentação não informado' });
      continue;
    }
    if (AP_VINC_CFG.tiposMov.indexOf(tipo) < 0) {
      recusados.push({ chave: chave, tipo: tipo,
        motivo: 'tipo desconhecido; conhecidos: ' + AP_VINC_CFG.tiposMov.join(', ') });
      continue;
    }
    var k = tipo + '|' + chave;
    if (vistos[k]) continue;   /* a mesma linha marcada duas vezes na tela */
    vistos[k] = 1;
    alvos.push({ tipo: tipo, chave: chave,
      observacao: AP_VINC_txt_(it.observacao || payload.observacao) });
  }

  if (!alvos.length) {
    return { ok: false, codigo: 'NADA_IDENTIFICAVEL',
      mensagem: 'Nenhuma das ' + crus.length + ' movimentações marcadas pôde ser ' +
        'identificada. Nada foi gravado.',
      dados: { recusados: recusados } };
  }

  var trava = null;
  try { trava = LockService.getScriptLock(); trava.waitLock(20000); } catch (e) { trava = null; }

  try {
    var aba = AP_VINC_abaVinculos_();
    var idx = AP_VINC_indice_(aba);
    var largura = aba.getLastColumn();
    var linhas = AP_VINC_linhas_(aba);
    var agora = AP_VINC_agora_();
    var autor = AP_VINC_quem_(sessao);

    /* onde está o vínculo vivo de cada alvo, se houver */
    var vivoNaLinha = {};
    for (var j = 0; j < linhas.length; j++) {
      var v = AP_VINC_vinculoEmObjeto_(linhas[j], idx);
      if (!v.id || !v.chaveMov) continue;
      if (String(v.status).toUpperCase() !== 'ATIVO') continue;
      vivoNaLinha[v.tipoMov + '|' + AP_VINC_chave_(v.chaveMov)] = { linha: j, vinculo: v };
    }

    var novos = [];
    var reclassificados = [];
    var inalterados = [];

    alvos.forEach(function (a) {
      var achado = vivoNaLinha[a.tipo + '|' + a.chave];

      if (achado && achado.vinculo.atividadeId === atividade.id) {
        inalterados.push(a.chave);
        return;
      }

      if (achado) {
        /* a linha velha não é sobrescrita: vira histórico */
        var antiga = linhas[achado.linha].slice();
        function marca(col, val) {
          var k = idx[col];
          if (k !== undefined) antiga[k] = val;
        }
        marca('STATUS', 'SUBSTITUIDO');
        marca('ALTERADO_EM', agora);
        marca('ALTERADO_POR', autor);
        marca('MOTIVO', AP_VINC_txt_(payload.motivo) ||
          ('reclassificado para ' + (atividade.codigo || atividade.nome)));
        aba.getRange(achado.linha + 2, 1, 1, largura).setValues([antiga]);
        reclassificados.push({ chave: a.chave,
          de: achado.vinculo.atividadeCodigo || achado.vinculo.atividadeNome ||
              achado.vinculo.atividadeId,
          para: atividade.codigo || atividade.nome });
      }

      novos.push(AP_VINC_montar_(idx, largura, {
        ID: AP_VINC_id_('VIN'),
        TIPO_MOV: a.tipo,
        CHAVE_MOV: a.chave,
        ATIVIDADE_ID: atividade.id,
        /* código e nome são ECO para leitura humana na planilha.
           Quem manda é ATIVIDADE_ID. */
        ATIVIDADE_CODIGO: atividade.codigo,
        ATIVIDADE_NOME: atividade.nome,
        /* o centro de custo DO MOMENTO da classificação */
        CENTRO_CUSTO: atividade.centroCusto,
        CENTRO_CUSTO_NOME: atividade.centroCustoNome,
        OBSERVACAO: a.observacao,
        STATUS: 'ATIVO',
        CRIADO_EM: agora,
        CRIADO_POR: autor,
        ALTERADO_EM: '',
        ALTERADO_POR: '',
        MOTIVO: AP_VINC_txt_(payload.motivo)
      }));
    });

    if (novos.length) {
      aba.getRange(aba.getLastRow() + 1, 1, novos.length, largura).setValues(novos);
      SpreadsheetApp.flush();
    }

    var partes = [];
    if (novos.length - reclassificados.length > 0) {
      partes.push((novos.length - reclassificados.length) + ' classificada(s)');
    }
    if (reclassificados.length) partes.push(reclassificados.length + ' reclassificada(s)');
    if (inalterados.length) partes.push(inalterados.length + ' já estava(m) nesta atividade');
    if (recusados.length) partes.push(recusados.length + ' recusada(s)');

    return {
      ok: true,
      dados: {
        atividade: { id: atividade.id, codigo: atividade.codigo, nome: atividade.nome,
          centroCusto: atividade.centroCusto },
        gravados: novos.length,
        reclassificados: reclassificados,
        inalterados: inalterados,
        recusados: recusados
      },
      mensagem: partes.join(', ') + '.' +
        (recusados.length ? ' As recusadas estão listadas no resultado, com o motivo de cada uma.' : '')
    };
  } finally {
    if (trava) { try { trava.releaseLock(); } catch (e) {} }
  }
}

/* Desclassificar. Não apaga a linha: STATUS = EXCLUIDO. */
function AP_VINC_desvincular_(payload, sessao) {
  var crus = payload.itens || payload.movimentacoes || [];
  if (!crus.length && payload.chaveMov) {
    crus = [{ tipoMov: payload.tipoMov, chaveMov: payload.chaveMov }];
  }
  if (!crus.length) {
    return { ok: false, codigo: 'SEM_ITENS',
      mensagem: 'Informe quais movimentações devem perder a classificação.' };
  }

  var procurar = {};
  crus.forEach(function (it) {
    var tipo = AP_VINC_tipo_(it.tipoMov || it.tipo || payload.tipoMov);
    var chave = AP_VINC_chave_(it.chaveMov || it.chave || it.protocolo || it.id);
    if (tipo && chave) procurar[tipo + '|' + chave] = 1;
  });
  if (!Object.keys(procurar).length) {
    return { ok: false, codigo: 'NADA_IDENTIFICAVEL',
      mensagem: 'Nenhuma movimentação identificável. Nada foi alterado.' };
  }

  var aba = AP_VINC_abaVinculos_();
  var idx = AP_VINC_indice_(aba);
  var largura = aba.getLastColumn();
  var linhas = AP_VINC_linhas_(aba);
  var agora = AP_VINC_agora_();
  var autor = AP_VINC_quem_(sessao);
  var mexidas = 0;

  for (var i = 0; i < linhas.length; i++) {
    var v = AP_VINC_vinculoEmObjeto_(linhas[i], idx);
    if (!v.id) continue;
    if (String(v.status).toUpperCase() !== 'ATIVO') continue;
    if (!procurar[v.tipoMov + '|' + AP_VINC_chave_(v.chaveMov)]) continue;

    var nova = linhas[i].slice();
    function por(col, val) {
      var k = idx[col];
      if (k !== undefined) nova[k] = val;
    }
    por('STATUS', 'EXCLUIDO');
    por('ALTERADO_EM', agora);
    por('ALTERADO_POR', autor);
    por('MOTIVO', AP_VINC_txt_(payload.motivo) || 'classificação removida pelo usuário');
    aba.getRange(i + 2, 1, 1, largura).setValues([nova]);
    mexidas++;
  }

  if (!mexidas) {
    return { ok: false, codigo: 'NAO_ENCONTRADO',
      mensagem: 'Nenhuma dessas movimentações tinha classificação ativa.' };
  }
  return { ok: true, dados: { removidos: mexidas },
    mensagem: mexidas + ' classificação(ões) removida(s). As linhas ficam na planilha ' +
      'marcadas como EXCLUIDO, com quem removeu e quando.' };
}


/* ============================================================
   DIAGNÓSTICO — só leitura
   ============================================================ */
function AP_VINC_diagnostico_() {
  var d = { versao: AP_VINC_CFG.versao, abas: {}, atividades: {}, vinculos: {} };
  try {
    var a = AP_VINC_abaAtividades_();
    d.abas.atividades = { nome: a.getName(), linhas: Math.max(0, a.getLastRow() - 1) };
    var lista = AP_VINC_atividades_({ incluirInativas: true });
    d.atividades.total = lista.length;
    d.atividades.ativas = lista.filter(function (x) {
      return String(x.status).toUpperCase() === 'ATIVA';
    }).length;
    d.atividades.semCentroCusto = lista.filter(function (x) { return !x.centroCusto; }).length;
  } catch (e) { d.abas.atividades = { erro: e.message }; }

  try {
    var b = AP_VINC_abaVinculos_();
    d.abas.vinculos = { nome: b.getName(), linhas: Math.max(0, b.getLastRow() - 1) };
    d.vinculos = AP_VINC_resumo_({});
  } catch (e) { d.abas.vinculos = { erro: e.message }; }

  return d;
}


/* ============================================================
   TESTES — não encostam na planilha
   ------------------------------------------------------------
   Rode AP_VINC_testes no editor. Ele exercita a normalização de
   chave e de tipo, que é onde um erro silencioso duplicaria
   vínculo ou criaria vínculo órfão.
   ============================================================ */
function AP_VINC_testes() {
  var falhas = [];
  function conf(nome, obtido, esperado) {
    if (String(obtido) !== String(esperado)) {
      falhas.push(nome + ': esperava "' + esperado + '", veio "' + obtido + '"');
    }
  }

  conf('chave com espaço', AP_VINC_chave_(' SAI 0012 '), 'SAI0012');
  conf('chave minúscula', AP_VINC_chave_('sai-0012'), 'SAI-0012');
  conf('chave nula', AP_VINC_chave_(null), '');
  conf('chave número', AP_VINC_chave_(53072), '53072');

  conf('tipo plural', AP_VINC_tipo_('saidas'), 'SAIDA');
  conf('tipo acento', AP_VINC_tipo_('transferência'), 'TRANSFERENCIA');
  conf('tipo acento plural', AP_VINC_tipo_('Transferências'), 'TRANSFERENCIA');
  conf('tipo retirada', AP_VINC_tipo_('Retirada'), 'SAIDA');
  conf('tipo inventado', AP_VINC_tipo_('qualquer'), 'QUALQUER');
  conf('tipo inventado é recusado',
    AP_VINC_CFG.tiposMov.indexOf(AP_VINC_tipo_('qualquer')) < 0, 'true');

  conf('texto nulo', AP_VINC_txt_(undefined), '');
  conf('tipos conhecidos tem SAIDA', AP_VINC_CFG.tiposMov.indexOf('SAIDA') >= 0, 'true');
  conf('limite por chamada', AP_VINC_CFG.maxPorChamada > 0, 'true');

  /* as ações recusadas devem recusar sem gravar: testa só o caminho
     que não chega na aba */
  var r1 = AP_Modulo_vinculos('acao_que_nao_existe', {}, {});
  conf('ação desconhecida recusa', r1.ok, 'false');
  conf('ação desconhecida tem código', r1.codigo, 'ACAO_DESCONHECIDA');

  var r2 = AP_Modulo_atividades('salvar', {}, {});
  conf('atividade sem nome recusa', r2.ok, 'false');
  conf('atividade sem nome tem código', r2.codigo, 'SEM_NOME');

  var saida = falhas.length
    ? 'FALHOU (' + falhas.length + '):\n  ' + falhas.join('\n  ')
    : 'Os ' + 15 + ' testes passaram. Nenhuma linha foi gravada.';
  Logger.log(saida);
  return saida;
}
