/* ============================================================
   ALMOXA PRO — SERVIDOR CENTRAL
   ETAPA 3 — VALIDAÇÃO E SEGURANÇA
   ------------------------------------------------------------
   O QUE ESTE ARQUIVO É

   A única porta de entrada dos dados. Nenhum módulo — estoque,
   EPI, nota, patrimônio — escreve direto na planilha. Todo mundo
   passa por aqui, e aqui é onde as regras acontecem:

     · a sessão é conferida antes de qualquer coisa;
     · a permissão é conferida por AÇÃO, não por tela;
     · empresa e obra limitam o que a pessoa enxerga e altera;
     · campo obrigatório vazio não passa;
     · campo que o banco não conhece não passa;
     · número que não é número não passa;
     · duplicidade é barrada antes de gravar;
     · a linha é montada inteira ANTES de encostar na planilha;
     · registro não se apaga: vira EXCLUIDO e continua lá;
     · toda alteração vira uma linha no log, campo por campo.

   POR QUE A PORTA É ÚNICA

   Regra que mora em dois lugares é regra que um dia diverge. Se
   o módulo de EPI souber gravar sozinho, um dia ele vai gravar
   sem conferir permissão — e ninguém vai perceber até a auditoria.

   O PEDIDO QUE VEM DE FORA NÃO MANDA EM NADA

   Quem chama diz o que quer gravar. Quem decide se pode é daqui.
   ID, datas, versão do registro, quem fez e status de exclusão
   são escritos pelo servidor e IGNORADOS se vierem no pedido —
   senão bastaria mentir no campo USUARIO_RESPONSAVEL para a
   auditoria apontar para outra pessoa.

   DEPENDE DE: ALMOXA_PRO_Servidor_Core.gs (etapas 1 e 2).
   ============================================================ */

var AP_DB_CFG = {
  versao: '2.0.0-etapa3',
  pasta: '01_BANCO_DADOS/',
  horasDeSessao: 12,
  /* colunas que só o servidor escreve — pedido que mandar estas
     tem os valores descartados, sem reclamar e sem gravar */
  soDoServidor: ['VERSAO_REGISTRO', 'SYNC_ID', 'EXCLUIDO',
    'DATA_CRIACAO', 'DATA_ATUALIZACAO', 'USUARIO_RESPONSAVEL'],
  acoes: ['ler', 'criar', 'atualizar', 'excluir']
};

/* ------------------------------------------------------------
   AS REGRAS DE CADA BANCO

   modulo ....... nome usado na conferência de permissão
   id ........... coluna da chave
   prefixo ...... começo do ID gerado
   obrigatorios . sem isso não grava
   unicos ....... conjuntos de colunas que não podem repetir
   numericos .... precisam ser número
   escopo ....... por onde empresa/obra limitam o acesso
   imutavel ..... nasce e não muda mais (livro-caixa)
   semExclusao .. não tem exclusão lógica nem física
   ------------------------------------------------------------ */
var AP_DB_REGRAS = {
  DB_USUARIOS: {
    modulo: 'usuarios', id: 'ID_USUARIO', prefixo: 'USU',
    obrigatorios: ['NOME', 'MATRICULA', 'PERFIL'],
    unicos: [['MATRICULA'], ['EMAIL']],
    escopo: { empresa: 'EMPRESA_ID', obra: 'OBRA_ID' }
  },
  DB_EMPRESAS: {
    modulo: 'empresas', id: 'ID_EMPRESA', prefixo: 'EMP',
    obrigatorios: ['RAZAO_SOCIAL'], unicos: [['CNPJ']]
  },
  DB_EQUIPES: {
    modulo: 'equipes', id: 'ID_EQUIPE', prefixo: 'EQP',
    obrigatorios: ['NOME_EQUIPE'], unicos: [['CODIGO', 'EMPRESA_ID']],
    escopo: { empresa: 'EMPRESA_ID', obra: 'PROJETO_ID' }
  },
  DB_PROJETOS: {
    modulo: 'projetos', id: 'ID_PROJETO', prefixo: 'PRJ',
    obrigatorios: ['NOME_PROJETO'], unicos: [['CODIGO']],
    escopo: { empresa: 'EMPRESA_ID' }
  },
  DB_FORNECEDORES: {
    modulo: 'fornecedores', id: 'ID_FORNECEDOR', prefixo: 'FOR',
    obrigatorios: ['RAZAO_SOCIAL'], unicos: [['CNPJ']]
  },
  DB_PRODUTOS: {
    modulo: 'produtos', id: 'ID_PRODUTO', prefixo: 'PRD',
    obrigatorios: ['DESCRICAO', 'UNIDADE'], unicos: [['CODIGO']],
    numericos: ['VALOR_UNITARIO']
  },
  DB_ESTOQUE: {
    modulo: 'estoque', id: 'ID_ESTOQUE', prefixo: 'EST',
    obrigatorios: ['PRODUTO_ID'],
    unicos: [['PRODUTO_ID', 'PROJETO_ID', 'LOCALIZACAO']],
    numericos: ['SALDO_ATUAL', 'SALDO_RESERVADO', 'SALDO_DISPONIVEL'],
    escopo: { obra: 'PROJETO_ID' }
  },
  DB_MOVIMENTACOES: {
    modulo: 'estoque', id: 'ID_MOVIMENTACAO', prefixo: 'MOV',
    obrigatorios: ['PRODUTO_ID', 'TIPO_MOVIMENTO', 'QUANTIDADE'],
    numericos: ['QUANTIDADE'],
    escopo: { obra: 'PROJETO_ID' },
    imutavel: true, semExclusao: true
  },
  DB_NOTAS_FISCAIS: {
    modulo: 'notas', id: 'ID_NOTA', prefixo: 'NF',
    obrigatorios: ['NUMERO', 'FORNECEDOR_ID'],
    unicos: [['CHAVE_ACESSO'], ['NUMERO', 'SERIE', 'FORNECEDOR_ID']],
    numericos: ['VALOR_TOTAL']
  },
  DB_ITENS_NOTAS: {
    modulo: 'notas', id: 'ID_ITEM', prefixo: 'ITN',
    obrigatorios: ['NOTA_ID', 'QUANTIDADE'],
    numericos: ['QUANTIDADE', 'VALOR_UNITARIO', 'VALOR_TOTAL']
  },
  DB_SOLICITACOES: {
    modulo: 'solicitacoes', id: 'ID_SOLICITACAO', prefixo: 'SOL',
    obrigatorios: ['SOLICITANTE_ID'], escopo: { obra: 'PROJETO_ID' }
  },
  DB_RESERVAS: {
    modulo: 'reservas', id: 'ID_RESERVA', prefixo: 'RSV',
    obrigatorios: ['PRODUTO_ID', 'QUANTIDADE'], numericos: ['QUANTIDADE']
  },
  DB_APROVACOES: {
    modulo: 'aprovacoes', id: 'ID_APROVACAO', prefixo: 'APR',
    obrigatorios: ['TIPO_REGISTRO', 'REGISTRO_ID']
  },
  DB_EPI: {
    modulo: 'epi', id: 'ID_EPI', prefixo: 'EPI',
    obrigatorios: ['DESCRICAO'], unicos: [['PRODUTO_ID', 'TAMANHO', 'CA']],
    numericos: ['VALOR_UNITARIO']
  },
  DB_FICHAS_EPI: {
    modulo: 'epi', id: 'ID_FICHA', prefixo: 'FCH',
    obrigatorios: ['COLABORADOR_ID', 'ITEM_ID', 'QUANTIDADE'],
    numericos: ['QUANTIDADE']
  },
  DB_PATRIMONIO: {
    modulo: 'patrimonio', id: 'ID_PATRIMONIO', prefixo: 'PAT',
    obrigatorios: ['DESCRICAO'], unicos: [['NUMERO_PATRIMONIAL']],
    numericos: ['VALOR']
  },
  DB_INVENTARIOS: {
    modulo: 'inventario', id: 'ID_INVENTARIO', prefixo: 'INV',
    obrigatorios: ['PROJETO_ID', 'RESPONSAVEL_ID'],
    numericos: ['QUANTIDADE_ITENS', 'VALOR_TOTAL'],
    escopo: { obra: 'PROJETO_ID' }
  },
  DB_OCORRENCIAS: {
    modulo: 'ocorrencias', id: 'ID_OCORRENCIA', prefixo: 'OCO',
    obrigatorios: ['TIPO', 'DESCRICAO']
  },
  DB_ANEXOS: {
    modulo: 'anexos', id: 'ID_ANEXO', prefixo: 'ANX',
    obrigatorios: ['TIPO_DOCUMENTO', 'REGISTRO_ID', 'ID_ARQUIVO_DRIVE']
  }
};

/* ============================================================
   RESPOSTA PADRÃO — sempre a mesma forma, sempre com motivo
   ============================================================ */
function AP_DB_ok_(dados, extra) {
  var r = { ok: true, dados: dados };
  if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) r[k] = extra[k];
  return r;
}

function AP_DB_erro_(codigo, mensagem, detalhe) {
  return { ok: false, codigo: codigo, mensagem: mensagem, detalhe: detalhe || null };
}

/* ============================================================
   SESSÃO
   ------------------------------------------------------------
   A planilha guarda a IMPRESSÃO DIGITAL do token, nunca o token.
   Planilha se compartilha por engano; com o hash, quem abrir a
   CORE_SESSOES não consegue se passar por ninguém.
   ============================================================ */
function AP_SEG_impressao_(token) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    String(token), Utilities.Charset.UTF_8);
  var saida = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] < 0 ? bytes[i] + 256 : bytes[i]).toString(16);
    saida += (b.length === 1 ? '0' : '') + b;
  }
  return saida;
}

function AP_SEG_abrirSessao(usuario, opcoes) {
  opcoes = opcoes || {};
  usuario = usuario || {};
  if (!usuario.id || !usuario.perfil) {
    return AP_DB_erro_('USUARIO_INCOMPLETO',
      'Para abrir uma sessão preciso do id e do perfil do usuário.');
  }
  var aba = AP_SRV_aba_('00_CORE/CORE_SESSOES');
  if (!aba) return AP_DB_erro_('SEM_ESTRUTURA', 'A planilha CORE_SESSOES não existe. Rode instalarServidor().');

  var token = AP_SRV_novoId_('TK') + '-' + AP_SRV_novoId_('TK');
  var agora = new Date();
  var expira = new Date(agora.getTime() + (opcoes.horas || AP_DB_CFG.horasDeSessao) * 3600000);
  var colunas = AP_SRV_colunasDe_(aba);
  var linha = [];
  for (var c = 0; c < colunas.length; c++) linha.push('');

  AP_SRV_por_(linha, colunas, 'ID_SESSAO', AP_SRV_novoId_('SES'));
  AP_SRV_por_(linha, colunas, 'TOKEN_HASH', AP_SEG_impressao_(token));
  AP_SRV_por_(linha, colunas, 'USUARIO_ID', usuario.id);
  AP_SRV_por_(linha, colunas, 'PERFIL', usuario.perfil);
  AP_SRV_por_(linha, colunas, 'EMPRESA_ID', usuario.empresa || '');
  AP_SRV_por_(linha, colunas, 'OBRA_ID', usuario.obra || '');
  AP_SRV_por_(linha, colunas, 'ORIGEM', opcoes.origem || 'sistema');
  AP_SRV_por_(linha, colunas, 'DATA_INICIO', AP_SRV_agora_());
  AP_SRV_por_(linha, colunas, 'DATA_EXPIRACAO',
    Utilities.formatDate(expira, 'America/Manaus', 'yyyy-MM-dd HH:mm:ss'));
  AP_SRV_por_(linha, colunas, 'ULTIMO_ACESSO', AP_SRV_agora_());
  AP_SRV_por_(linha, colunas, 'STATUS', 'ATIVA');
  AP_SRV_por_(linha, colunas, 'SYNC_ID', AP_SRV_novoId_('SYNC'));
  aba.appendRow(linha);

  registrarLog('ACESSO', {
    usuario: usuario.id, acao: 'sessão aberta',
    origem: opcoes.origem || 'sistema', resultado: 'OK', detalhe: 'perfil ' + usuario.perfil
  });

  /* o token só aparece AQUI, uma vez. O que fica na planilha é a
     impressão digital dele, que não serve para entrar. */
  return AP_DB_ok_({
    token: token,
    expira: Utilities.formatDate(expira, 'America/Manaus', 'yyyy-MM-dd HH:mm:ss')
  });
}

function AP_SEG_validarSessao(token) {
  if (!token) return AP_DB_erro_('SEM_SESSAO', 'Esta operação precisa de login.');
  var aba = AP_SRV_aba_('00_CORE/CORE_SESSOES');
  if (!aba) return AP_DB_erro_('SEM_ESTRUTURA', 'A planilha CORE_SESSOES não existe.');
  if (aba.getLastRow() < 2) return AP_DB_erro_('SESSAO_INVALIDA', 'Sessão não encontrada. Faça login de novo.');

  var colunas = AP_SRV_colunasDe_(aba);
  var linhas = aba.getRange(2, 1, aba.getLastRow() - 1, aba.getLastColumn()).getValues();
  var impressao = AP_SEG_impressao_(token);
  var iHash = colunas.indexOf('TOKEN_HASH');

  for (var i = 0; i < linhas.length; i++) {
    if (String(linhas[i][iHash]) !== impressao) continue;

    var status = String(linhas[i][colunas.indexOf('STATUS')] || '');
    if (status !== 'ATIVA') {
      return AP_DB_erro_('SESSAO_ENCERRADA', 'Esta sessão foi encerrada. Faça login de novo.');
    }
    /* passa pelo AP_SRV_quando_ porque o Sheets pode ter transformado
       este campo em data de verdade — e aí a comparação mentiria */
    var expira = AP_SRV_quando_(linhas[i][colunas.indexOf('DATA_EXPIRACAO')]);
    if (expira && expira < AP_SRV_agora_()) {
      return AP_DB_erro_('SESSAO_VENCIDA', 'Sua sessão venceu. Faça login de novo.');
    }

    /* carimba o último acesso sem reescrever a linha inteira */
    try {
      var iUltimo = colunas.indexOf('ULTIMO_ACESSO');
      if (iUltimo > -1) aba.getRange(i + 2, iUltimo + 1, 1, 1).setValues([[AP_SRV_agora_()]]);
    } catch (falha) { }

    return AP_DB_ok_({
      id: linhas[i][colunas.indexOf('ID_SESSAO')],
      usuario: linhas[i][colunas.indexOf('USUARIO_ID')],
      perfil: String(linhas[i][colunas.indexOf('PERFIL')] || '').toLowerCase(),
      empresa: linhas[i][colunas.indexOf('EMPRESA_ID')],
      obra: linhas[i][colunas.indexOf('OBRA_ID')],
      origem: linhas[i][colunas.indexOf('ORIGEM')],
      linha: i + 2
    });
  }
  return AP_DB_erro_('SESSAO_INVALIDA', 'Sessão não encontrada. Faça login de novo.');
}

function AP_SEG_encerrarSessao(token) {
  var s = AP_SEG_validarSessao(token);
  if (!s.ok) return s;
  var aba = AP_SRV_aba_('00_CORE/CORE_SESSOES');
  var colunas = AP_SRV_colunasDe_(aba);
  var iStatus = colunas.indexOf('STATUS');
  aba.getRange(s.dados.linha, iStatus + 1, 1, 1).setValues([['ENCERRADA']]);
  registrarLog('ACESSO', {
    usuario: s.dados.usuario, acao: 'sessão encerrada', resultado: 'OK', origem: s.dados.origem
  });
  return AP_DB_ok_({ encerrada: true });
}

/* ============================================================
   PERMISSÃO
   ------------------------------------------------------------
   Quem decide é a CORE_PERMISSOES. Enquanto ela estiver vazia,
   NADA é permitido — nem para o admin. Isso é de propósito: um
   sistema que libera tudo quando a tabela está vazia é um sistema
   que libera tudo no dia em que alguém apagar a tabela sem querer.
   Para preencher a matriz de fábrica, rode semearPermissoes().
   ============================================================ */
function AP_SEG_podeFazer(sessao, modulo, acao) {
  var aba = AP_SRV_aba_('00_CORE/CORE_PERMISSOES');
  if (!aba) {
    return AP_DB_erro_('SEM_ESTRUTURA', 'A planilha CORE_PERMISSOES não existe. Rode instalarServidor().');
  }
  if (aba.getLastRow() < 2) {
    return AP_DB_erro_('PERMISSOES_VAZIAS',
      'A tabela de permissões está vazia, então nada é permitido ainda. ' +
      'Rode semearPermissoes() uma vez para criar a matriz inicial.');
  }

  var colunas = AP_SRV_colunasDe_(aba);
  var linhas = aba.getRange(2, 1, aba.getLastRow() - 1, aba.getLastColumn()).getValues();
  var perfil = String(sessao.perfil || '').toLowerCase();
  var iPerfil = colunas.indexOf('PERFIL'), iMod = colunas.indexOf('MODULO');
  var iAcao = colunas.indexOf('ACAO'), iPerm = colunas.indexOf('PERMITIDO');
  var iEmp = colunas.indexOf('EMPRESA_ID'), iObra = colunas.indexOf('OBRA_ID');
  var iStatus = colunas.indexOf('STATUS');

  var melhor = null;
  for (var i = 0; i < linhas.length; i++) {
    var l = linhas[i];
    if (iStatus > -1 && String(l[iStatus] || 'ATIVO').toUpperCase() === 'INATIVO') continue;
    if (String(l[iPerfil] || '').toLowerCase() !== perfil) continue;

    var mod = String(l[iMod] || '').toLowerCase();
    var act = String(l[iAcao] || '').toLowerCase();
    if (mod !== '*' && mod !== String(modulo).toLowerCase()) continue;
    if (act !== '*' && act !== String(acao).toLowerCase()) continue;

    /* regra amarrada a uma empresa/obra só vale para aquela empresa/obra */
    var emp = iEmp > -1 ? String(l[iEmp] || '') : '';
    var obr = iObra > -1 ? String(l[iObra] || '') : '';
    if (emp && emp !== String(sessao.empresa || '')) continue;
    if (obr && obr !== String(sessao.obra || '')) continue;

    /* a regra mais específica ganha da genérica */
    var peso = (mod === '*' ? 0 : 2) + (act === '*' ? 0 : 2) + (emp ? 1 : 0) + (obr ? 1 : 0);
    if (!melhor || peso > melhor.peso) {
      melhor = { peso: peso, permitido: /^(sim|true|1|x|s)$/i.test(String(l[iPerm] || '')) };
    }
  }

  if (!melhor) {
    return AP_DB_erro_('SEM_PERMISSAO',
      'O perfil "' + perfil + '" não tem permissão para ' + acao + ' em ' + modulo + '.');
  }
  if (!melhor.permitido) {
    return AP_DB_erro_('SEM_PERMISSAO',
      'O perfil "' + perfil + '" está proibido de ' + acao + ' em ' + modulo + '.');
  }
  return AP_DB_ok_({ permitido: true });
}

/* A matriz de fábrica. Só entra quando você mandar, e só se a
   tabela estiver vazia — para não passar por cima do que você
   já tiver ajustado à mão. */
var AP_SEG_PADRAO = [
  ['admin', '*', '*', 'SIM'],

  ['gestor', '*', 'ler', 'SIM'],
  ['gestor', '*', 'criar', 'SIM'],
  ['gestor', '*', 'atualizar', 'SIM'],
  ['gestor', '*', 'excluir', 'SIM'],
  ['gestor', 'usuarios', 'excluir', 'NAO'],
  ['gestor', 'empresas', 'excluir', 'NAO'],

  ['almoxarife', '*', 'ler', 'SIM'],
  ['almoxarife', 'produtos', 'criar', 'SIM'],
  ['almoxarife', 'produtos', 'atualizar', 'SIM'],
  ['almoxarife', 'estoque', 'criar', 'SIM'],
  ['almoxarife', 'estoque', 'atualizar', 'SIM'],
  ['almoxarife', 'notas', 'criar', 'SIM'],
  ['almoxarife', 'notas', 'atualizar', 'SIM'],
  ['almoxarife', 'epi', 'criar', 'SIM'],
  ['almoxarife', 'epi', 'atualizar', 'SIM'],
  ['almoxarife', 'patrimonio', 'criar', 'SIM'],
  ['almoxarife', 'patrimonio', 'atualizar', 'SIM'],
  ['almoxarife', 'inventario', 'criar', 'SIM'],
  ['almoxarife', 'inventario', 'atualizar', 'SIM'],
  ['almoxarife', 'reservas', 'criar', 'SIM'],
  ['almoxarife', 'reservas', 'atualizar', 'SIM'],
  ['almoxarife', 'anexos', 'criar', 'SIM'],
  ['almoxarife', 'ocorrencias', 'criar', 'SIM'],
  ['almoxarife', 'solicitacoes', 'criar', 'SIM'],
  ['almoxarife', 'solicitacoes', 'atualizar', 'SIM'],

  ['encarregado', '*', 'ler', 'SIM'],
  ['encarregado', 'solicitacoes', 'criar', 'SIM'],
  ['encarregado', 'ocorrencias', 'criar', 'SIM'],

  ['consulta', '*', 'ler', 'SIM']
];

/* Não depende do arquivo do relatório estar instalado: se ele
   estiver, fala por ele; se não, fala por si mesmo. */
function AP_DB_dizer_(texto) {
  if (typeof AP_SRV_falar_ === 'function') return AP_SRV_falar_(texto);
  try { Logger.log(texto); } catch (e) { }
  return texto;
}

function semearPermissoes() {
  var aba = AP_SRV_aba_('00_CORE/CORE_PERMISSOES');
  if (!aba) {
    return AP_DB_dizer_('A planilha CORE_PERMISSOES não existe. Rode instalarServidor() primeiro.');
  }
  if (aba.getLastRow() > 1) {
    return AP_DB_dizer_('A tabela de permissões JÁ TEM ' + (aba.getLastRow() - 1) +
      ' regra(s). Não mexi em nada.\nSe quiser recomeçar do zero, apague as linhas à mão ' +
      'e rode de novo — assim a decisão é sua, não minha.');
  }

  var colunas = AP_SRV_colunasDe_(aba);
  var agora = AP_SRV_agora_(), quem = AP_SRV_quemSou_();
  for (var i = 0; i < AP_SEG_PADRAO.length; i++) {
    var p = AP_SEG_PADRAO[i];
    var linha = [];
    for (var c = 0; c < colunas.length; c++) linha.push('');
    AP_SRV_por_(linha, colunas, 'ID_PERMISSAO', AP_SRV_novoId_('PER'));
    AP_SRV_por_(linha, colunas, 'PERFIL', p[0]);
    AP_SRV_por_(linha, colunas, 'MODULO', p[1]);
    AP_SRV_por_(linha, colunas, 'ACAO', p[2]);
    AP_SRV_por_(linha, colunas, 'PERMITIDO', p[3]);
    AP_SRV_por_(linha, colunas, 'STATUS', 'ATIVO');
    AP_SRV_por_(linha, colunas, 'USUARIO_RESPONSAVEL', quem);
    AP_SRV_por_(linha, colunas, 'VERSAO_REGISTRO', 1);
    AP_SRV_por_(linha, colunas, 'SYNC_ID', AP_SRV_novoId_('SYNC'));
    AP_SRV_por_(linha, colunas, 'DATA_CRIACAO', agora);
    AP_SRV_por_(linha, colunas, 'DATA_ATUALIZACAO', agora);
    aba.appendRow(linha);
  }
  registrarLog('ALTERACAO', {
    modulo: 'CORE', tabela: 'CORE_PERMISSOES', campo: 'matriz inicial',
    valor_novo: AP_SEG_PADRAO.length + ' regras', origem: 'semearPermissoes'
  });
  return AP_DB_dizer_('Matriz inicial criada: ' + AP_SEG_PADRAO.length + ' regras.\n' +
    'Confira e ajuste na planilha CORE_PERMISSOES — ela manda no sistema, não o código.');
}

/* ============================================================
   A PORTA DOS DADOS
   ============================================================ */
function AP_DB_tabela_(nome) {
  var regras = AP_DB_REGRAS[nome];
  if (!regras) return null;
  var caminho = AP_DB_CFG.pasta + nome;
  var aba = AP_SRV_aba_(caminho);
  if (!aba) return null;
  return { nome: nome, caminho: caminho, aba: aba, regras: regras, colunas: AP_SRV_colunasDe_(aba) };
}

function AP_DB_numero_(valor) {
  if (valor === '' || valor === null || valor === undefined) return null;
  var n = Number(String(valor).replace(',', '.'));
  return isNaN(n) ? null : n;
}

/* Confere TUDO antes de encostar na planilha. Devolve a lista de
   problemas de uma vez — corrigir um por vez, com uma ida e volta
   cada, é castigo para quem está digitando. */
function AP_DB_conferir_(t, dados, ehNovo) {
  var problemas = [];

  var desconhecidas = [];
  for (var campo in dados) {
    if (!dados.hasOwnProperty(campo)) continue;
    if (AP_DB_CFG.soDoServidor.indexOf(campo) > -1) continue;
    if (campo === t.regras.id) continue;
    if (t.colunas.indexOf(campo) === -1) desconhecidas.push(campo);
  }
  if (desconhecidas.length) {
    problemas.push('o banco ' + t.nome + ' não tem a(s) coluna(s): ' + desconhecidas.join(', '));
  }

  if (ehNovo) {
    var obrig = t.regras.obrigatorios || [];
    for (var i = 0; i < obrig.length; i++) {
      var v = dados[obrig[i]];
      if (v === undefined || v === null || String(v).trim() === '') {
        problemas.push('falta preencher ' + obrig[i]);
      }
    }
  } else {
    var obrig2 = t.regras.obrigatorios || [];
    for (var j = 0; j < obrig2.length; j++) {
      if (dados.hasOwnProperty(obrig2[j]) && String(dados[obrig2[j]] || '').trim() === '') {
        problemas.push(obrig2[j] + ' não pode ficar em branco');
      }
    }
  }

  var num = t.regras.numericos || [];
  for (var k = 0; k < num.length; k++) {
    if (!dados.hasOwnProperty(num[k])) continue;
    if (String(dados[num[k]] || '').trim() === '') continue;
    if (AP_DB_numero_(dados[num[k]]) === null) {
      problemas.push(num[k] + ' precisa ser um número (veio "' + dados[num[k]] + '")');
    }
  }

  return problemas;
}

/* Duplicidade. Linha excluída logicamente não conta — se a empresa
   foi excluída, o CNPJ dela volta a estar livre. */
function AP_DB_duplicado_(t, dados, idIgnorado, linhas) {
  var conjuntos = t.regras.unicos || [];
  if (!conjuntos.length) return null;
  var iId = t.colunas.indexOf(t.regras.id);
  var iExc = t.colunas.indexOf('EXCLUIDO');

  for (var c = 0; c < conjuntos.length; c++) {
    var grupo = conjuntos[c];
    var temValor = false, valores = [];
    for (var g = 0; g < grupo.length; g++) {
      var v = dados.hasOwnProperty(grupo[g]) ? String(dados[grupo[g]] || '').trim() : '';
      if (v !== '') temValor = true;
      valores.push(v.toUpperCase());
    }
    if (!temValor) continue;   /* conjunto todo vazio não duplica nada */

    for (var i = 0; i < linhas.length; i++) {
      if (idIgnorado && String(linhas[i][iId]) === String(idIgnorado)) continue;
      if (iExc > -1 && String(linhas[i][iExc] || '').toUpperCase() === 'SIM') continue;

      var igual = true;
      for (var h = 0; h < grupo.length; h++) {
        var atual = String(linhas[i][t.colunas.indexOf(grupo[h])] || '').trim().toUpperCase();
        if (atual !== valores[h]) { igual = false; break; }
      }
      if (igual) {
        return { campos: grupo, id: linhas[i][iId] };
      }
    }
  }
  return null;
}

/* Empresa e obra. Admin enxerga tudo; os outros só o que é deles.
   Tabela sem essas colunas não tem escopo — é global por natureza. */
function AP_DB_dentroDoEscopo_(t, linha, sessao) {
  if (String(sessao.perfil).toLowerCase() === 'admin') return true;
  var esc = t.regras.escopo;
  if (!esc) return true;

  if (esc.empresa && sessao.empresa) {
    var iE = t.colunas.indexOf(esc.empresa);
    var vE = iE > -1 ? String(linha[iE] || '') : '';
    if (vE && vE !== String(sessao.empresa)) return false;
  }
  if (esc.obra && sessao.obra) {
    var iO = t.colunas.indexOf(esc.obra);
    var vO = iO > -1 ? String(linha[iO] || '') : '';
    if (vO && vO !== String(sessao.obra)) return false;
  }
  return true;
}

function AP_DB_porta_(nomeTabela, acao, token) {
  var t = AP_DB_tabela_(nomeTabela);
  if (!t) {
    return {
      erro: AP_DB_erro_('BANCO_DESCONHECIDO',
        'Não existe banco chamado "' + nomeTabela + '" no servidor.')
    };
  }
  var s = AP_SEG_validarSessao(token);
  if (!s.ok) return { erro: s };

  var p = AP_SEG_podeFazer(s.dados, t.regras.modulo, acao);
  if (!p.ok) {
    registrarLog('ACESSO', {
      usuario: s.dados.usuario, acao: acao + ' em ' + nomeTabela,
      origem: s.dados.origem, resultado: 'NEGADO', detalhe: p.codigo
    });
    return { erro: p };
  }
  return { t: t, sessao: s.dados };
}

function AP_DB_linhas_(t) {
  if (t.aba.getLastRow() < 2) return [];
  return t.aba.getRange(2, 1, t.aba.getLastRow() - 1, t.aba.getLastColumn()).getValues();
}

/* ------------------------------------------------------------
   inserir
   ------------------------------------------------------------ */
function AP_DB_inserir(nomeTabela, dados, token) {
  var porta = AP_DB_porta_(nomeTabela, 'criar', token);
  if (porta.erro) return porta.erro;
  var t = porta.t, sessao = porta.sessao;
  dados = dados || {};

  var problemas = AP_DB_conferir_(t, dados, true);
  if (problemas.length) {
    return AP_DB_erro_('DADOS_INVALIDOS',
      'Não gravei nada. ' + problemas.join('; ') + '.', problemas);
  }

  var trava = null;
  try {
    trava = LockService.getScriptLock();
    if (!trava.tryLock(20000)) {
      return AP_DB_erro_('OCUPADO', 'O sistema está gravando outra coisa. Tente de novo em instantes.');
    }
  } catch (falha) { trava = null; }

  try {
    var linhas = AP_DB_linhas_(t);
    var dup = AP_DB_duplicado_(t, dados, null, linhas);
    if (dup) {
      return AP_DB_erro_('DUPLICADO',
        'Já existe um registro com ' + dup.campos.join(' + ') + ' igual (' + dup.id + '). Nada foi gravado.');
    }

    /* a linha é montada INTEIRA antes de tocar na planilha */
    var agora = AP_SRV_agora_();
    var id = AP_SRV_novoId_(t.regras.prefixo);
    var linha = [];
    for (var c = 0; c < t.colunas.length; c++) linha.push('');

    for (var campo in dados) {
      if (!dados.hasOwnProperty(campo)) continue;
      if (AP_DB_CFG.soDoServidor.indexOf(campo) > -1) continue;   /* o pedido não manda nestas */
      if (campo === t.regras.id) continue;
      AP_SRV_por_(linha, t.colunas, campo, dados[campo]);
    }

    /* escopo: quem não é admin grava dentro da própria empresa/obra */
    var esc = t.regras.escopo;
    if (esc && String(sessao.perfil).toLowerCase() !== 'admin') {
      if (esc.empresa && sessao.empresa) AP_SRV_por_(linha, t.colunas, esc.empresa, sessao.empresa);
      if (esc.obra && sessao.obra && !dados[esc.obra]) AP_SRV_por_(linha, t.colunas, esc.obra, sessao.obra);
    }

    AP_SRV_por_(linha, t.colunas, t.regras.id, id);
    AP_SRV_por_(linha, t.colunas, 'STATUS', dados.STATUS || 'ATIVO');
    AP_SRV_por_(linha, t.colunas, 'USUARIO_RESPONSAVEL', sessao.usuario);
    AP_SRV_por_(linha, t.colunas, 'VERSAO_REGISTRO', 1);
    AP_SRV_por_(linha, t.colunas, 'SYNC_ID', AP_SRV_novoId_('SYNC'));
    if (t.colunas.indexOf('EXCLUIDO') > -1) AP_SRV_por_(linha, t.colunas, 'EXCLUIDO', 'NAO');
    AP_SRV_por_(linha, t.colunas, 'DATA_CRIACAO', agora);
    AP_SRV_por_(linha, t.colunas, 'DATA_ATUALIZACAO', agora);

    t.aba.appendRow(linha);

    /* confirma que gravou mesmo antes de dizer que gravou */
    var conferido = AP_DB_acharLinha_(t, id);
    if (!conferido) {
      return AP_DB_erro_('GRAVACAO_NAO_CONFIRMADA',
        'Mandei gravar mas não encontrei o registro depois. Confira a planilha ' + t.nome +
        ' antes de tentar de novo.');
    }

    registrarLog('ALTERACAO', {
      modulo: t.regras.modulo, tabela: t.nome, registro_id: id, campo: '(registro novo)',
      valor_novo: AP_DB_resumo_(t, linha), usuario: sessao.usuario, origem: sessao.origem
    });

    return AP_DB_ok_(AP_DB_objeto_(t, linha), { id: id, criado: true });

  } catch (falha) {
    registrarLog('ERRO', {
      modulo: t.regras.modulo, funcao: 'AP_DB_inserir', gravidade: 'ALTA',
      mensagem: (falha && falha.message) || String(falha), detalhe: t.nome
    });
    return AP_DB_erro_('FALHA_AO_GRAVAR', 'Não consegui gravar em ' + t.nome + '. ' +
      ((falha && falha.message) || falha));
  } finally {
    if (trava) { try { trava.releaseLock(); } catch (e) { } }
  }
}

/* ------------------------------------------------------------
   atualizar
   ------------------------------------------------------------ */
function AP_DB_atualizar(nomeTabela, id, mudancas, token) {
  var porta = AP_DB_porta_(nomeTabela, 'atualizar', token);
  if (porta.erro) return porta.erro;
  var t = porta.t, sessao = porta.sessao;
  mudancas = mudancas || {};

  if (t.regras.imutavel) {
    return AP_DB_erro_('REGISTRO_IMUTAVEL',
      t.nome + ' não se altera: é livro-caixa. Para corrigir, lance um movimento contrário.');
  }

  var problemas = AP_DB_conferir_(t, mudancas, false);
  if (problemas.length) {
    return AP_DB_erro_('DADOS_INVALIDOS', 'Não mudei nada. ' + problemas.join('; ') + '.', problemas);
  }

  var trava = null;
  try {
    trava = LockService.getScriptLock();
    if (!trava.tryLock(20000)) {
      return AP_DB_erro_('OCUPADO', 'O sistema está gravando outra coisa. Tente de novo em instantes.');
    }
  } catch (falha) { trava = null; }

  try {
    var achado = AP_DB_acharLinha_(t, id);
    if (!achado) {
      return AP_DB_erro_('NAO_ENCONTRADO', 'Não achei ' + id + ' em ' + t.nome + '.');
    }
    if (!AP_DB_dentroDoEscopo_(t, achado.valores, sessao)) {
      return AP_DB_erro_('FORA_DO_ESCOPO',
        'Este registro é de outra empresa ou obra. Você não pode alterá-lo.');
    }
    if (t.colunas.indexOf('EXCLUIDO') > -1 &&
      String(achado.valores[t.colunas.indexOf('EXCLUIDO')] || '').toUpperCase() === 'SIM') {
      return AP_DB_erro_('REGISTRO_EXCLUIDO',
        'Este registro está excluído. Reative antes de alterar.');
    }

    var linhas2 = AP_DB_linhas_(t);
    var dup = AP_DB_duplicado_(t, mudancas, id, linhas2);
    if (dup) {
      return AP_DB_erro_('DUPLICADO',
        'Outro registro já usa ' + dup.campos.join(' + ') + ' (' + dup.id + '). Nada foi alterado.');
    }

    var nova = achado.valores.slice();
    var mudou = [];
    for (var campo in mudancas) {
      if (!mudancas.hasOwnProperty(campo)) continue;
      if (AP_DB_CFG.soDoServidor.indexOf(campo) > -1) continue;
      if (campo === t.regras.id) continue;
      var i = t.colunas.indexOf(campo);
      if (i === -1) continue;
      var antes = nova[i];
      if (String(antes) === String(mudancas[campo])) continue;
      nova[i] = mudancas[campo];
      mudou.push({ campo: campo, de: antes, para: mudancas[campo] });
    }

    if (!mudou.length) {
      return AP_DB_ok_(AP_DB_objeto_(t, nova), { alterado: false, mensagem: 'Nada mudou.' });
    }

    var v = parseInt(nova[t.colunas.indexOf('VERSAO_REGISTRO')], 10);
    AP_SRV_por_(nova, t.colunas, 'VERSAO_REGISTRO', isNaN(v) ? 1 : v + 1);
    AP_SRV_por_(nova, t.colunas, 'USUARIO_RESPONSAVEL', sessao.usuario);
    AP_SRV_por_(nova, t.colunas, 'DATA_ATUALIZACAO', AP_SRV_agora_());

    /* uma gravação só: ou entra a linha inteira, ou não entra nada */
    t.aba.getRange(achado.linha, 1, 1, t.colunas.length).setValues([nova]);

    for (var m = 0; m < mudou.length; m++) {
      registrarLog('ALTERACAO', {
        modulo: t.regras.modulo, tabela: t.nome, registro_id: id,
        campo: mudou[m].campo, valor_anterior: mudou[m].de, valor_novo: mudou[m].para,
        usuario: sessao.usuario, origem: sessao.origem
      });
    }

    return AP_DB_ok_(AP_DB_objeto_(t, nova), { alterado: true, campos: mudou.length });

  } catch (falha) {
    registrarLog('ERRO', {
      modulo: t.regras.modulo, funcao: 'AP_DB_atualizar', gravidade: 'ALTA',
      mensagem: (falha && falha.message) || String(falha), detalhe: t.nome + ' ' + id
    });
    return AP_DB_erro_('FALHA_AO_GRAVAR', 'Não consegui alterar ' + id + '. ' +
      ((falha && falha.message) || falha));
  } finally {
    if (trava) { try { trava.releaseLock(); } catch (e) { } }
  }
}

/* ------------------------------------------------------------
   excluir — que não apaga
   ------------------------------------------------------------ */
function AP_DB_excluir(nomeTabela, id, motivo, token) {
  var porta = AP_DB_porta_(nomeTabela, 'excluir', token);
  if (porta.erro) return porta.erro;
  var t = porta.t, sessao = porta.sessao;

  if (t.colunas.indexOf('EXCLUIDO') === -1) {
    return AP_DB_erro_('NAO_SE_EXCLUI',
      t.nome + ' não aceita exclusão: é histórico. Para corrigir, lance um registro contrário.');
  }
  if (!motivo || String(motivo).trim().length < 3) {
    return AP_DB_erro_('SEM_MOTIVO',
      'Para excluir é preciso dizer o motivo. Fica registrado no log junto com o seu nome.');
  }

  var achado = AP_DB_acharLinha_(t, id);
  if (!achado) return AP_DB_erro_('NAO_ENCONTRADO', 'Não achei ' + id + ' em ' + t.nome + '.');
  if (!AP_DB_dentroDoEscopo_(t, achado.valores, sessao)) {
    return AP_DB_erro_('FORA_DO_ESCOPO', 'Este registro é de outra empresa ou obra.');
  }
  if (String(achado.valores[t.colunas.indexOf('EXCLUIDO')] || '').toUpperCase() === 'SIM') {
    return AP_DB_ok_(AP_DB_objeto_(t, achado.valores), { jaEstava: true, mensagem: 'Já estava excluído.' });
  }

  var nova = achado.valores.slice();
  AP_SRV_por_(nova, t.colunas, 'EXCLUIDO', 'SIM');
  AP_SRV_por_(nova, t.colunas, 'STATUS', 'EXCLUIDO');
  AP_SRV_por_(nova, t.colunas, 'USUARIO_RESPONSAVEL', sessao.usuario);
  AP_SRV_por_(nova, t.colunas, 'DATA_ATUALIZACAO', AP_SRV_agora_());
  var v = parseInt(nova[t.colunas.indexOf('VERSAO_REGISTRO')], 10);
  AP_SRV_por_(nova, t.colunas, 'VERSAO_REGISTRO', isNaN(v) ? 1 : v + 1);

  t.aba.getRange(achado.linha, 1, 1, t.colunas.length).setValues([nova]);

  registrarLog('ALTERACAO', {
    modulo: t.regras.modulo, tabela: t.nome, registro_id: id, campo: 'EXCLUIDO',
    valor_anterior: 'NAO', valor_novo: 'SIM — ' + motivo,
    usuario: sessao.usuario, origem: sessao.origem
  });

  return AP_DB_ok_(AP_DB_objeto_(t, nova), { excluido: true });
}

function AP_DB_reativar(nomeTabela, id, motivo, token) {
  var porta = AP_DB_porta_(nomeTabela, 'excluir', token);
  if (porta.erro) return porta.erro;
  var t = porta.t, sessao = porta.sessao;

  var achado = AP_DB_acharLinha_(t, id);
  if (!achado) return AP_DB_erro_('NAO_ENCONTRADO', 'Não achei ' + id + ' em ' + t.nome + '.');
  if (t.colunas.indexOf('EXCLUIDO') === -1) {
    return AP_DB_erro_('NAO_SE_EXCLUI', t.nome + ' não tem exclusão lógica.');
  }

  var nova = achado.valores.slice();
  AP_SRV_por_(nova, t.colunas, 'EXCLUIDO', 'NAO');
  AP_SRV_por_(nova, t.colunas, 'STATUS', 'ATIVO');
  AP_SRV_por_(nova, t.colunas, 'USUARIO_RESPONSAVEL', sessao.usuario);
  AP_SRV_por_(nova, t.colunas, 'DATA_ATUALIZACAO', AP_SRV_agora_());
  t.aba.getRange(achado.linha, 1, 1, t.colunas.length).setValues([nova]);

  registrarLog('ALTERACAO', {
    modulo: t.regras.modulo, tabela: t.nome, registro_id: id, campo: 'EXCLUIDO',
    valor_anterior: 'SIM', valor_novo: 'NAO — ' + (motivo || 'reativado'),
    usuario: sessao.usuario, origem: sessao.origem
  });
  return AP_DB_ok_(AP_DB_objeto_(t, nova), { reativado: true });
}

/* ------------------------------------------------------------
   ler
   ------------------------------------------------------------ */
function AP_DB_obter(nomeTabela, id, token) {
  var porta = AP_DB_porta_(nomeTabela, 'ler', token);
  if (porta.erro) return porta.erro;
  var t = porta.t, sessao = porta.sessao;

  var achado = AP_DB_acharLinha_(t, id);
  if (!achado) return AP_DB_erro_('NAO_ENCONTRADO', 'Não achei ' + id + ' em ' + t.nome + '.');
  if (!AP_DB_dentroDoEscopo_(t, achado.valores, sessao)) {
    /* "não encontrado" de propósito: dizer "existe mas não é seu"
       já conta ao curioso que aquele ID existe */
    return AP_DB_erro_('NAO_ENCONTRADO', 'Não achei ' + id + ' em ' + t.nome + '.');
  }
  return AP_DB_ok_(AP_DB_objeto_(t, achado.valores));
}

function AP_DB_listar(nomeTabela, filtro, token) {
  var porta = AP_DB_porta_(nomeTabela, 'ler', token);
  if (porta.erro) return porta.erro;
  var t = porta.t, sessao = porta.sessao;
  filtro = filtro || {};

  var linhas = AP_DB_linhas_(t);
  var iExc = t.colunas.indexOf('EXCLUIDO');
  var saida = [];

  for (var i = 0; i < linhas.length; i++) {
    var l = linhas[i];
    if (!String(l[t.colunas.indexOf(t.regras.id)] || '')) continue;
    if (iExc > -1 && !filtro.incluirExcluidos &&
      String(l[iExc] || '').toUpperCase() === 'SIM') continue;
    if (!AP_DB_dentroDoEscopo_(t, l, sessao)) continue;

    var serve = true;
    for (var campo in filtro) {
      if (!filtro.hasOwnProperty(campo) || campo === 'incluirExcluidos') continue;
      var ic = t.colunas.indexOf(campo);
      if (ic === -1) continue;
      if (String(l[ic] || '').toUpperCase() !== String(filtro[campo] || '').toUpperCase()) {
        serve = false; break;
      }
    }
    if (serve) saida.push(AP_DB_objeto_(t, l));
  }
  return AP_DB_ok_(saida, { total: saida.length });
}

/* ------------------------------------------------------------
   peças pequenas
   ------------------------------------------------------------ */
function AP_DB_acharLinha_(t, id) {
  if (!id) return null;
  var linhas = AP_DB_linhas_(t);
  var iId = t.colunas.indexOf(t.regras.id);
  for (var i = 0; i < linhas.length; i++) {
    if (String(linhas[i][iId]) === String(id)) {
      return { linha: i + 2, valores: linhas[i] };
    }
  }
  return null;
}

function AP_DB_objeto_(t, linha) {
  var o = {};
  for (var i = 0; i < t.colunas.length; i++) {
    if (t.colunas[i]) o[t.colunas[i]] = linha[i];
  }
  return o;
}

function AP_DB_resumo_(t, linha) {
  var partes = [], obrig = t.regras.obrigatorios || [];
  for (var i = 0; i < obrig.length && i < 3; i++) {
    partes.push(obrig[i] + '=' + linha[t.colunas.indexOf(obrig[i])]);
  }
  return partes.join(', ');
}

/* ============================================================
   AP_DB_testes() — A PROVA DA ETAPA 3
   ------------------------------------------------------------
   Aqui não há Drive de mentira: o que interessa nesta etapa são
   as REGRAS, não as pastas. Então trocamos só a porta que abre as
   abas (AP_SRV_aba_) por planilhas de memória, com os cabeçalhos
   de verdade, vindos do mesmo mapa do Core. Se o cabeçalho mudar
   lá, o teste muda junto — não existe cópia para envelhecer.

   Nada do seu Drive é tocado. Tudo volta ao normal no finally.

   O QUE ESTÁ SENDO PROVADO

   · sem sessão não passa nada, nem leitura;
   · sessão vencida e sessão encerrada dão mensagens diferentes;
   · o token não fica guardado em lugar nenhum;
   · permissão é por AÇÃO: almoxarife cria produto e não exclui;
   · tabela de permissões vazia = nada permitido, nem para admin;
   · empresa e obra escondem e protegem registro dos outros;
   · obrigatório vazio, coluna inventada e número torto são barrados
     ANTES de qualquer gravação;
   · duplicidade é barrada, e volta a ser permitida se o registro
     duplicado foi excluído;
   · o pedido não consegue forjar ID, data, versão nem responsável;
   · excluir não apaga: marca, mantém e exige motivo;
   · movimentação não se altera nem se exclui;
   · toda alteração vira linha no log, campo por campo.
   ============================================================ */
function AP_DB_testes() {
  var log = [], falhas = 0;
  function ok(nome, passou, obs) {
    if (!passou) falhas++;
    log.push((passou ? 'PASSOU  ' : 'FALHOU  ') + nome + (obs ? '  [' + obs + ']' : ''));
  }

  var orig = {
    aba: AP_SRV_aba_, lock: (typeof LockService !== 'undefined') ? LockService : null,
    utils: (typeof Utilities !== 'undefined') ? Utilities : null,
    sess: (typeof Session !== 'undefined') ? Session : null
  };

  try {
    /* ---------------- planilhas de memória ---------------- */
    var ABAS = {};
    function novaAba(colunas) {
      var dados = [colunas.slice()];
      function garantir(l, c) {
        while (dados.length < l) dados.push([]);
        for (var i = 0; i < dados.length; i++) while (dados[i].length < c) dados[i].push('');
      }
      var eu = {
        __dados: dados,
        getLastRow: function () {
          var u = 0;
          for (var i = 0; i < dados.length; i++) {
            for (var j = 0; j < dados[i].length; j++) {
              if (String(dados[i][j] || '') !== '') { u = i + 1; break; }
            }
          }
          return u;
        },
        getLastColumn: function () {
          var u = 0;
          for (var i = 0; i < dados.length; i++) {
            for (var j = 0; j < dados[i].length; j++) {
              if (String(dados[i][j] || '') !== '' && j + 1 > u) u = j + 1;
            }
          }
          return u;
        },
        appendRow: function (linha) { dados.push(linha.slice()); return eu; },
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
              for (var i = 0; i < v.length; i++) {
                for (var j = 0; j < v[i].length; j++) dados[l - 1 + i][c - 1 + j] = v[i][j];
              }
              return this;
            },
            setFontWeight: function () { return this; }
          };
        },
        setFrozenRows: function () { return eu; }
      };
      return eu;
    }

    /* os cabeçalhos vêm do mapa do Core: uma verdade só */
    for (var i = 0; i < AP_SRV_MAPA.length; i++) {
      var item = AP_SRV_MAPA[i];
      if (item.tipo !== 'planilha') continue;
      ABAS[item.caminho] = novaAba(item.colunas);
    }
    AP_SRV_aba_ = function (caminho) { return ABAS[caminho] || null; };

    LockService = { getScriptLock: function () { return { tryLock: function () { return true; }, releaseLock: function () { } }; } };
    Session = {
      getActiveUser: function () { return { getEmail: function () { return 'teste@coesa'; } }; },
      getScriptTimeZone: function () { return 'America/Manaus'; }
    };

    var relogioFalso = null;
    Utilities = {
      DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
      computeDigest: function (alg, texto) {
        /* não é criptografia de verdade; é só para o teste poder
           conferir que a planilha NÃO guarda o token em claro */
        var h = 0, saida = [];
        for (var k = 0; k < texto.length; k++) h = ((h << 5) - h + texto.charCodeAt(k)) | 0;
        for (var b = 0; b < 8; b++) saida.push((h >> (b * 4)) & 255);
        return saida;
      },
      formatDate: function (d, tz, f) {
        function dd(n) { return (n < 10 ? '0' : '') + n; }
        return d.getFullYear() + '-' + dd(d.getMonth() + 1) + '-' + dd(d.getDate()) +
          ' ' + dd(d.getHours()) + ':' + dd(d.getMinutes()) + ':' + dd(d.getSeconds());
      }
    };

    function linhasDe(caminho) {
      var a = ABAS[caminho];
      return a.getLastRow() > 1
        ? a.getRange(2, 1, a.getLastRow() - 1, a.getLastColumn()).getValues() : [];
    }
    function contarLog(caminho) { return linhasDe(caminho).length; }

    /* ============================================================
       1. SEM PERMISSÃO NENHUMA CADASTRADA, NADA PASSA
       ============================================================ */
    var sAdmin = AP_SEG_abrirSessao({ id: 'USU-ADM', perfil: 'admin' }, { origem: 'teste' });
    ok('a sessão abre e devolve o token', sAdmin.ok && !!sAdmin.dados.token);

    var tentativa = AP_DB_inserir('DB_EMPRESAS', { RAZAO_SOCIAL: 'COESA' }, sAdmin.dados.token);
    ok('com a tabela de permissões vazia, nem o admin grava',
      tentativa.ok === false && tentativa.codigo === 'PERMISSOES_VAZIAS', tentativa.codigo);

    semearPermissoes();
    ok('a matriz de fábrica entrou', contarLog('00_CORE/CORE_PERMISSOES') === AP_SEG_PADRAO.length,
      contarLog('00_CORE/CORE_PERMISSOES') + ' regras');

    var segundaSemeada = semearPermissoes();
    ok('semear duas vezes não duplica a matriz',
      contarLog('00_CORE/CORE_PERMISSOES') === AP_SEG_PADRAO.length &&
      segundaSemeada.indexOf('JÁ TEM') > -1);

    /* ============================================================
       2. O TOKEN NÃO FICA GUARDADO
       ============================================================ */
    var tokenAdmin = sAdmin.dados.token;
    var tudoQueEstaNaSessoes = JSON.stringify(linhasDe('00_CORE/CORE_SESSOES'));
    ok('o token NÃO aparece na planilha de sessões',
      tudoQueEstaNaSessoes.indexOf(tokenAdmin) === -1);
    ok('o que está guardado é a impressão digital',
      tudoQueEstaNaSessoes.indexOf(AP_SEG_impressao_(tokenAdmin)) > -1);

    /* ============================================================
       3. SESSÃO — INVÁLIDA, ENCERRADA, VENCIDA
       ============================================================ */
    ok('sem token não lê nem escreve',
      AP_DB_listar('DB_EMPRESAS', {}, '').codigo === 'SEM_SESSAO');
    ok('token inventado não entra',
      AP_DB_listar('DB_EMPRESAS', {}, 'TK-QUALQUER-COISA').codigo === 'SESSAO_INVALIDA');

    var sTemp = AP_SEG_abrirSessao({ id: 'USU-X', perfil: 'consulta' });
    AP_SEG_encerrarSessao(sTemp.dados.token);
    ok('sessão encerrada dá mensagem própria',
      AP_DB_listar('DB_EMPRESAS', {}, sTemp.dados.token).codigo === 'SESSAO_ENCERRADA');

    var sVence = AP_SEG_abrirSessao({ id: 'USU-Y', perfil: 'consulta' }, { horas: -1 });
    ok('sessão vencida dá mensagem própria',
      AP_DB_listar('DB_EMPRESAS', {}, sVence.dados.token).codigo === 'SESSAO_VENCIDA');

    /* O Sheets às vezes devolve a data como Date, não como texto.
       Foi o que apareceu no relatório do Ismael. Aqui a célula é
       trocada por um Date de verdade: se a comparação voltar a ser
       feita como texto puro, este teste cai. */
    var sData = AP_SEG_abrirSessao({ id: 'USU-D', perfil: 'consulta' });
    var abaSes = AP_SRV_aba_('00_CORE/CORE_SESSOES');
    var colsSes = AP_SRV_colunasDe_(abaSes);
    var iExp = colsSes.indexOf('DATA_EXPIRACAO');
    abaSes.getRange(abaSes.getLastRow(), iExp + 1, 1, 1)
      .setValues([[new Date(2020, 0, 1, 8, 0, 0)]]);
    ok('sessão vencida é pega mesmo quando o Sheets devolve DATA como data',
      AP_DB_listar('DB_EMPRESAS', {}, sData.dados.token).codigo === 'SESSAO_VENCIDA',
      AP_DB_listar('DB_EMPRESAS', {}, sData.dados.token).codigo);

    var sValida = AP_SEG_abrirSessao({ id: 'USU-E', perfil: 'admin' });
    abaSes.getRange(abaSes.getLastRow(), iExp + 1, 1, 1)
      .setValues([[new Date(2099, 0, 1, 8, 0, 0)]]);
    ok('e a sessão boa continua valendo com data de verdade na célula',
      AP_SEG_validarSessao(sValida.dados.token).ok === true);

    /* ============================================================
       4. INSERIR DE VERDADE
       ============================================================ */
    var emp = AP_DB_inserir('DB_EMPRESAS',
      { RAZAO_SOCIAL: 'COESA ENGENHARIA', CNPJ: '11.111.111/0001-11' }, tokenAdmin);
    ok('o admin grava a empresa', emp.ok === true, emp.mensagem || '');
    ok('o ID foi gerado pelo servidor', emp.ok && /^EMP-/.test(emp.dados.ID_EMPRESA));
    ok('nasceu ATIVO, não excluído',
      emp.ok && emp.dados.STATUS === 'ATIVO' && emp.dados.EXCLUIDO === 'NAO');
    ok('gravou quem fez e a versão 1',
      emp.ok && emp.dados.USUARIO_RESPONSAVEL === 'USU-ADM' &&
      Number(emp.dados.VERSAO_REGISTRO) === 1);
    ok('as duas datas foram preenchidas',
      emp.ok && !!emp.dados.DATA_CRIACAO && !!emp.dados.DATA_ATUALIZACAO);
    ok('a criação virou linha no log de alterações',
      contarLog('05_LOGS_AUDITORIA/LOG_ALTERACOES') >= 1);

    /* ============================================================
       5. O PEDIDO NÃO MANDA NO QUE É DO SERVIDOR
       ============================================================ */
    var forjada = AP_DB_inserir('DB_EMPRESAS', {
      RAZAO_SOCIAL: 'TENTATIVA', CNPJ: '22.222.222/0001-22',
      ID_EMPRESA: 'EMP-EU-QUE-ESCOLHI',
      USUARIO_RESPONSAVEL: 'OUTRA PESSOA',
      VERSAO_REGISTRO: 99, EXCLUIDO: 'SIM',
      DATA_CRIACAO: '1999-01-01 00:00:00'
    }, tokenAdmin);
    ok('não dá para escolher o próprio ID',
      forjada.ok && forjada.dados.ID_EMPRESA !== 'EMP-EU-QUE-ESCOLHI');
    ok('não dá para gravar em nome de outra pessoa',
      forjada.ok && forjada.dados.USUARIO_RESPONSAVEL === 'USU-ADM');
    ok('não dá para forjar a versão do registro',
      forjada.ok && Number(forjada.dados.VERSAO_REGISTRO) === 1);
    ok('não dá para nascer excluído', forjada.ok && forjada.dados.EXCLUIDO === 'NAO');
    ok('não dá para forjar a data de criação',
      forjada.ok && String(forjada.dados.DATA_CRIACAO).indexOf('1999') === -1);

    /* ============================================================
       6. VALIDAÇÃO DOS DADOS RECEBIDOS
       ============================================================ */
    var antesDeErrar = linhasDe('01_BANCO_DADOS/DB_PRODUTOS').length;
    var semNada = AP_DB_inserir('DB_PRODUTOS', {}, tokenAdmin);
    ok('obrigatório em branco não passa',
      semNada.ok === false && semNada.codigo === 'DADOS_INVALIDOS');
    ok('a mensagem diz QUAIS campos faltam',
      semNada.mensagem.indexOf('DESCRICAO') > -1 && semNada.mensagem.indexOf('UNIDADE') > -1,
      semNada.mensagem);

    var colunaInventada = AP_DB_inserir('DB_PRODUTOS',
      { DESCRICAO: 'Cimento', UNIDADE: 'SC', COR_PREFERIDA: 'azul' }, tokenAdmin);
    ok('coluna que não existe é recusada',
      colunaInventada.ok === false && colunaInventada.mensagem.indexOf('COR_PREFERIDA') > -1);

    var numeroTorto = AP_DB_inserir('DB_PRODUTOS',
      { DESCRICAO: 'Areia', UNIDADE: 'M3', VALOR_UNITARIO: 'setenta reais' }, tokenAdmin);
    ok('número que não é número é recusado',
      numeroTorto.ok === false && numeroTorto.mensagem.indexOf('VALOR_UNITARIO') > -1);

    ok('NENHUMA dessas tentativas gravou linha',
      linhasDe('01_BANCO_DADOS/DB_PRODUTOS').length === antesDeErrar,
      antesDeErrar + ' → ' + linhasDe('01_BANCO_DADOS/DB_PRODUTOS').length);

    ok('número com vírgula é aceito',
      AP_DB_inserir('DB_PRODUTOS',
        { DESCRICAO: 'Brita', UNIDADE: 'M3', CODIGO: 'BR-01', VALOR_UNITARIO: '89,90' },
        tokenAdmin).ok === true);

    /* ============================================================
       7. DUPLICIDADE
       ============================================================ */
    var dup = AP_DB_inserir('DB_EMPRESAS',
      { RAZAO_SOCIAL: 'OUTRO NOME', CNPJ: '11.111.111/0001-11' }, tokenAdmin);
    ok('CNPJ repetido é barrado', dup.ok === false && dup.codigo === 'DUPLICADO', dup.mensagem);
    ok('a mensagem diz qual registro já usa', dup.mensagem.indexOf(emp.dados.ID_EMPRESA) > -1);

    var semCnpj1 = AP_DB_inserir('DB_EMPRESAS', { RAZAO_SOCIAL: 'SEM CNPJ A' }, tokenAdmin);
    var semCnpj2 = AP_DB_inserir('DB_EMPRESAS', { RAZAO_SOCIAL: 'SEM CNPJ B' }, tokenAdmin);
    ok('campo único VAZIO não conta como duplicado', semCnpj1.ok && semCnpj2.ok);

    var produtoA = AP_DB_inserir('DB_PRODUTOS',
      { DESCRICAO: 'Prego 18', UNIDADE: 'KG', CODIGO: 'PR-18' }, tokenAdmin);
    var produtoRepetido = AP_DB_inserir('DB_PRODUTOS',
      { DESCRICAO: 'Prego 18 outro', UNIDADE: 'KG', CODIGO: 'pr-18' }, tokenAdmin);
    ok('duplicidade não escapa por maiúscula/minúscula', produtoRepetido.ok === false);

    /* ============================================================
       8. EXCLUIR NÃO APAGA
       ============================================================ */
    var antesExc = linhasDe('01_BANCO_DADOS/DB_PRODUTOS').length;
    ok('excluir sem motivo é recusado',
      AP_DB_excluir('DB_PRODUTOS', produtoA.dados.ID_PRODUTO, '', tokenAdmin).codigo === 'SEM_MOTIVO');

    var exc = AP_DB_excluir('DB_PRODUTOS', produtoA.dados.ID_PRODUTO,
      'cadastrado em duplicidade pelo estagiário', tokenAdmin);
    ok('a exclusão marca em vez de apagar',
      exc.ok && exc.dados.EXCLUIDO === 'SIM' && exc.dados.STATUS === 'EXCLUIDO');
    ok('a linha continua na planilha',
      linhasDe('01_BANCO_DADOS/DB_PRODUTOS').length === antesExc, 'continuam ' + antesExc);
    ok('o excluído some da lista', AP_DB_listar('DB_PRODUTOS', {}, tokenAdmin).dados
      .every(function (p) { return p.ID_PRODUTO !== produtoA.dados.ID_PRODUTO; }));
    ok('mas aparece quando se pede para incluir os excluídos',
      AP_DB_listar('DB_PRODUTOS', { incluirExcluidos: true }, tokenAdmin).dados
        .some(function (p) { return p.ID_PRODUTO === produtoA.dados.ID_PRODUTO; }));
    ok('o motivo ficou no log',
      JSON.stringify(linhasDe('05_LOGS_AUDITORIA/LOG_ALTERACOES')).indexOf('estagiário') > -1);
    ok('o código do produto excluído volta a ficar livre',
      AP_DB_inserir('DB_PRODUTOS', { DESCRICAO: 'Prego 18 novo', UNIDADE: 'KG', CODIGO: 'PR-18' },
        tokenAdmin).ok === true);
    ok('registro excluído não aceita alteração',
      AP_DB_atualizar('DB_PRODUTOS', produtoA.dados.ID_PRODUTO, { DESCRICAO: 'x' }, tokenAdmin)
        .codigo === 'REGISTRO_EXCLUIDO');
    ok('dá para reativar', AP_DB_reativar('DB_PRODUTOS', produtoA.dados.ID_PRODUTO,
      'era engano', tokenAdmin).ok === true);

    /* ============================================================
       9. ATUALIZAR E O LOG CAMPO POR CAMPO
       ============================================================ */
    var logAntes = contarLog('05_LOGS_AUDITORIA/LOG_ALTERACOES');
    var alt = AP_DB_atualizar('DB_EMPRESAS', emp.dados.ID_EMPRESA,
      { RAZAO_SOCIAL: 'COESA ENGENHARIA LTDA', NOME_FANTASIA: 'COESA' }, tokenAdmin);
    ok('a alteração foi gravada', alt.ok === true && alt.campos === 2);
    ok('a versão do registro subiu para 2', Number(alt.dados.VERSAO_REGISTRO) === 2);
    ok('foram DUAS linhas de log, uma por campo',
      contarLog('05_LOGS_AUDITORIA/LOG_ALTERACOES') === logAntes + 2,
      logAntes + ' → ' + contarLog('05_LOGS_AUDITORIA/LOG_ALTERACOES'));
    var ultimoLog = JSON.stringify(linhasDe('05_LOGS_AUDITORIA/LOG_ALTERACOES'));
    ok('o log guarda o valor de antes e o de agora',
      ultimoLog.indexOf('COESA ENGENHARIA') > -1 && ultimoLog.indexOf('COESA ENGENHARIA LTDA') > -1);

    var semMudanca = AP_DB_atualizar('DB_EMPRESAS', emp.dados.ID_EMPRESA,
      { RAZAO_SOCIAL: 'COESA ENGENHARIA LTDA' }, tokenAdmin);
    ok('mandar o mesmo valor não gera log nem sobe versão',
      semMudanca.ok && semMudanca.alterado === false &&
      contarLog('05_LOGS_AUDITORIA/LOG_ALTERACOES') === logAntes + 2);

    /* ============================================================
       10. PERMISSÃO POR AÇÃO — O ALMOXARIFE
       ============================================================ */
    var sAlmox = AP_SEG_abrirSessao({ id: 'USU-ALM', perfil: 'almoxarife' }, { origem: 'obra' });
    var tkAlmox = sAlmox.dados.token;

    ok('almoxarife LÊ produtos', AP_DB_listar('DB_PRODUTOS', {}, tkAlmox).ok === true);
    var prodAlmox = AP_DB_inserir('DB_PRODUTOS',
      { DESCRICAO: 'Luva', UNIDADE: 'PAR', CODIGO: 'LV-01' }, tkAlmox);
    ok('almoxarife CRIA produto', prodAlmox.ok === true, prodAlmox.mensagem || '');
    ok('almoxarife ATUALIZA produto',
      AP_DB_atualizar('DB_PRODUTOS', prodAlmox.dados.ID_PRODUTO,
        { DESCRICAO: 'Luva de raspa' }, tkAlmox).ok === true);
    var excAlmox = AP_DB_excluir('DB_PRODUTOS', prodAlmox.dados.ID_PRODUTO, 'teste', tkAlmox);
    ok('almoxarife NÃO exclui', excAlmox.ok === false && excAlmox.codigo === 'SEM_PERMISSAO');
    ok('almoxarife NÃO cadastra empresa',
      AP_DB_inserir('DB_EMPRESAS', { RAZAO_SOCIAL: 'X' }, tkAlmox).codigo === 'SEM_PERMISSAO');
    ok('a negativa fica registrada no log de acessos',
      JSON.stringify(linhasDe('05_LOGS_AUDITORIA/LOG_ACESSOS')).indexOf('NEGADO') > -1);

    var sConsulta = AP_SEG_abrirSessao({ id: 'USU-CON', perfil: 'consulta' });
    ok('perfil consulta lê', AP_DB_listar('DB_PRODUTOS', {}, sConsulta.dados.token).ok === true);
    ok('perfil consulta não cria',
      AP_DB_inserir('DB_PRODUTOS', { DESCRICAO: 'X', UNIDADE: 'UN' },
        sConsulta.dados.token).codigo === 'SEM_PERMISSAO');

    var sInventado = AP_SEG_abrirSessao({ id: 'USU-ZZ', perfil: 'diretor_supremo' });
    ok('perfil que não está na matriz não pode nada',
      AP_DB_listar('DB_PRODUTOS', {}, sInventado.dados.token).codigo === 'SEM_PERMISSAO');

    /* ============================================================
       11. EMPRESA E OBRA
       ============================================================ */
    var sObraA = AP_SEG_abrirSessao({ id: 'USU-A', perfil: 'almoxarife', empresa: 'EMP-1', obra: 'PRJ-A' });
    var sObraB = AP_SEG_abrirSessao({ id: 'USU-B', perfil: 'almoxarife', empresa: 'EMP-1', obra: 'PRJ-B' });

    var estoqueA = AP_DB_inserir('DB_ESTOQUE',
      { PRODUTO_ID: 'PRD-1', LOCALIZACAO: 'Prateleira 1', SALDO_ATUAL: 10 }, sObraA.dados.token);
    ok('o estoque nasce carimbado com a obra de quem gravou',
      estoqueA.ok && estoqueA.dados.PROJETO_ID === 'PRJ-A', estoqueA.mensagem || '');

    ok('a obra B não enxerga o estoque da obra A',
      AP_DB_listar('DB_ESTOQUE', {}, sObraB.dados.token).dados.length === 0);
    ok('a obra A enxerga o próprio',
      AP_DB_listar('DB_ESTOQUE', {}, sObraA.dados.token).dados.length === 1);
    ok('a obra B não consegue abrir o registro da obra A pelo ID',
      AP_DB_obter('DB_ESTOQUE', estoqueA.dados.ID_ESTOQUE, sObraB.dados.token)
        .codigo === 'NAO_ENCONTRADO');
    ok('a obra B não consegue alterar o registro da obra A',
      AP_DB_atualizar('DB_ESTOQUE', estoqueA.dados.ID_ESTOQUE,
        { SALDO_ATUAL: 0 }, sObraB.dados.token).codigo === 'FORA_DO_ESCOPO');
    ok('o admin enxerga as duas obras',
      AP_DB_listar('DB_ESTOQUE', {}, tokenAdmin).dados.length >= 1);

    /* ============================================================
       12. MOVIMENTAÇÃO É LIVRO-CAIXA
       ============================================================ */
    var mov = AP_DB_inserir('DB_MOVIMENTACOES',
      { PRODUTO_ID: 'PRD-1', TIPO_MOVIMENTO: 'ENTRADA', QUANTIDADE: 5 }, sObraA.dados.token);
    ok('a movimentação é gravada', mov.ok === true, mov.mensagem || '');
    ok('movimentação NÃO se altera',
      AP_DB_atualizar('DB_MOVIMENTACOES', mov.dados.ID_MOVIMENTACAO,
        { QUANTIDADE: 500 }, tokenAdmin).codigo === 'REGISTRO_IMUTAVEL');
    ok('movimentação NÃO se exclui',
      AP_DB_excluir('DB_MOVIMENTACOES', mov.dados.ID_MOVIMENTACAO, 'errei', tokenAdmin)
        .codigo === 'NAO_SE_EXCLUI');

    /* ============================================================
       13. BANCO QUE NÃO EXISTE E REGISTRO QUE NÃO EXISTE
       ============================================================ */
    ok('banco inventado dá mensagem clara',
      AP_DB_listar('DB_FOGUETE', {}, tokenAdmin).codigo === 'BANCO_DESCONHECIDO');
    ok('ID que não existe dá mensagem clara',
      AP_DB_obter('DB_EMPRESAS', 'EMP-NAO-EXISTE', tokenAdmin).codigo === 'NAO_ENCONTRADO');

    /* ============================================================
       14. FILTRO NA LISTAGEM
       ============================================================ */
    var comFiltro = AP_DB_listar('DB_PRODUTOS', { UNIDADE: 'M3' }, tokenAdmin);
    ok('o filtro devolve só o que casa',
      comFiltro.ok && comFiltro.dados.every(function (p) { return p.UNIDADE === 'M3'; }) &&
      comFiltro.dados.length > 0, comFiltro.dados.length + ' itens');

  } catch (explodiu) {
    falhas++;
    log.push('FALHOU  o teste explodiu: ' + (explodiu && explodiu.stack || explodiu));
  } finally {
    AP_SRV_aba_ = orig.aba;
    if (orig.lock) LockService = orig.lock;
    if (orig.utils) Utilities = orig.utils;
    if (orig.sess) Session = orig.sess;
  }

  var texto = '=== ETAPA 3 — VALIDAÇÃO E SEGURANÇA — ' +
    (falhas ? falhas + ' FALHA(S) DE ' + log.length : 'TODOS OS ' + log.length + ' TESTES PASSARAM') +
    ' ===\n' + log.join('\n');
  try { Logger.log(texto); } catch (e) { }
  return { ok: falhas === 0, total: log.length, falhas: falhas, texto: texto };
}
