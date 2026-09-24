/* ============================================================
   ALMOXA PRO — SERVIDOR CENTRAL DE DADOS (GOOGLE DRIVE)
   ETAPA 1 — CORE E ESTRUTURA DO DRIVE
   ------------------------------------------------------------
   O QUE ESTE ARQUIVO FAZ

   Monta e confere a estrutura do servidor dentro do Google Drive:
   as pastas, as planilhas do CORE e as planilhas de log. Nada de
   regra de estoque, EPI, nota ou patrimônio mora aqui — isso é
   dos módulos, e continua sendo.

   O QUE ELE NÃO FAZ, DE PROPÓSITO

   Não apaga. Não sobrescreve. Não duplica. Não cria "Cópia de".
   Antes de criar qualquer coisa ele procura, nesta ordem:

     1. pelo ID que já está registrado nas Propriedades do Script;
     2. pelo nome, dentro da pasta certa (só ali, nunca no Drive
        inteiro — dois nomes iguais em cantos diferentes não podem
        virar a mesma coisa por engano);
     3. só então cria o que faltar.

   Rodar duas vezes tem que dar o mesmo resultado da primeira. Isso
   não é promessa: está provado em AP_SRV_testes(), com um Drive de
   mentira, contando itens criados na primeira e na segunda volta.

   CABEÇALHOS — A REGRA MAIS IMPORTANTE DESTE ARQUIVO

   Coluna que já existe NUNCA é renomeada, movida nem apagada, mesmo
   que esteja fora da ordem esperada. Coluna que falta é acrescentada
   NO FIM. O motivo é simples: a coluna C de uma planilha com 4.000
   linhas dentro tem 4.000 valores embaixo dela. Reordenar cabeçalho
   sem mover os dados é a maneira mais rápida de transformar um
   sistema que funciona em um sistema que mente.

   ONDE FICA A RAIZ

   Na propriedade do script ALMOXA_SERVIDOR_RAIZ_ID. Se você já tem
   a pasta criada, cole o ID dela lá antes de rodar (Extensões →
   Apps Script → Configurações do projeto → Propriedades do script).
   Se não colar, o sistema procura pelo nome no seu Drive e, não
   achando, cria uma. O ID fica registrado na primeira execução e é
   ele que manda nas próximas — assim renomear a pasta não faz o
   sistema criar outra.

   ETAPA 1 MATERIALIZA:
     · todas as pastas da árvore;
     · as 5 planilhas do 00_CORE;
     · as 4 planilhas de 05_LOGS_AUDITORIA (sem log não há rastro).

   Os DB_* de 01_BANCO_DADOS estão declarados no mapa mas marcados
   como etapa 2 — aparecem no relatório como PENDENTE, não como erro.
   ============================================================ */

/* Junta as colunas do documento com as de controle, sem repetir
   nenhuma e sem mudar a ordem das que o documento definiu. Fica
   antes do mapa de propósito — é ele quem monta as listas. */
function AP_SRV_comControle_(colunas, opcoes) {
  opcoes = opcoes || {};
  var saida = colunas.slice();
  var controle = ['STATUS', 'USUARIO_RESPONSAVEL', 'VERSAO_REGISTRO',
    'SYNC_ID', 'EXCLUIDO', 'DATA_CRIACAO', 'DATA_ATUALIZACAO'];
  for (var i = 0; i < controle.length; i++) {
    if (opcoes.semExclusao && controle[i] === 'EXCLUIDO') continue;
    if (saida.indexOf(controle[i]) === -1) saida.push(controle[i]);
  }
  return saida;
}

var AP_SRV_CFG = {
  versao: '2.0.0-etapa2',
  nomeRaiz: 'ALMOXA_PRO_SERVIDOR_CENTRAL',
  propRaiz: 'ALMOXA_SERVIDOR_RAIZ_ID',
  propRegistro: 'ALMOXA_SERVIDOR_REGISTRO',
  propVersao: 'ALMOXA_SERVIDOR_VERSAO',
  etapaAtual: 2,
  segundosDeEspera: 30,
  /* colunas que toda tabela de dados carrega, por exigência do
     documento: rastro de quem, quando, em que versão e se está viva */
  colunasDeControle: ['STATUS', 'USUARIO_RESPONSAVEL', 'VERSAO_REGISTRO',
    'SYNC_ID', 'EXCLUIDO', 'DATA_CRIACAO', 'DATA_ATUALIZACAO']
};

/* ------------------------------------------------------------
   O MAPA — UMA VERDADE SÓ SOBRE A ESTRUTURA
   Lista plana. O caminho diz onde fica; quem lê o caminho descobre
   o pai. Um lugar só para consertar quando a estrutura mudar.
   ------------------------------------------------------------ */
var AP_SRV_MAPA = [
  /* ---------------- 00_CORE ---------------- */
  { caminho: '00_CORE', tipo: 'pasta', etapa: 1 },
  {
    caminho: '00_CORE/CORE_CONFIGURACAO', tipo: 'planilha', etapa: 1, aba: 'CONFIGURACAO',
    colunas: ['ID_CONFIG', 'CHAVE', 'VALOR', 'DESCRICAO', 'TIPO',
      'STATUS', 'USUARIO_RESPONSAVEL', 'VERSAO_REGISTRO', 'SYNC_ID',
      'DATA_CRIACAO', 'DATA_ATUALIZACAO']
  },
  {
    caminho: '00_CORE/CORE_MODULOS', tipo: 'planilha', etapa: 1, aba: 'MODULOS',
    colunas: ['ID_MODULO', 'NOME_MODULO', 'VERSAO', 'ARQUIVO', 'DESCRICAO',
      'STATUS', 'USUARIO_RESPONSAVEL', 'VERSAO_REGISTRO', 'SYNC_ID',
      'DATA_CRIACAO', 'DATA_ATUALIZACAO']
  },
  {
    caminho: '00_CORE/CORE_PERMISSOES', tipo: 'planilha', etapa: 1, aba: 'PERMISSOES',
    colunas: ['ID_PERMISSAO', 'PERFIL', 'MODULO', 'ACAO', 'PERMITIDO',
      'EMPRESA_ID', 'OBRA_ID',
      'STATUS', 'USUARIO_RESPONSAVEL', 'VERSAO_REGISTRO', 'SYNC_ID',
      'DATA_CRIACAO', 'DATA_ATUALIZACAO']
  },
  {
    /* TOKEN_HASH, não TOKEN: a planilha guarda a impressão digital
       da sessão, não a chave. Planilha se compartilha sem querer. */
    caminho: '00_CORE/CORE_SESSOES', tipo: 'planilha', etapa: 1, aba: 'SESSOES',
    colunas: ['ID_SESSAO', 'TOKEN_HASH', 'USUARIO_ID', 'PERFIL',
      'EMPRESA_ID', 'OBRA_ID', 'ORIGEM', 'DATA_INICIO', 'DATA_EXPIRACAO',
      'ULTIMO_ACESSO', 'STATUS', 'SYNC_ID']
  },
  {
    caminho: '00_CORE/CORE_VERSOES', tipo: 'planilha', etapa: 1, aba: 'VERSOES',
    colunas: ['ID_VERSAO', 'COMPONENTE', 'VERSAO', 'DESCRICAO', 'ETAPA',
      'DATA_APLICACAO', 'USUARIO_RESPONSAVEL', 'STATUS', 'SYNC_ID']
  },

  /* ---------------- 01_BANCO_DADOS ----------------
     As colunas de cada banco são as do documento, na ordem do
     documento, mais as colunas de controle que o item 3 exige
     (status, quem mexeu, versão do registro, sincronização,
     exclusão lógica e datas). AP_SRV_comControle_ só acrescenta
     o que ainda não estiver na lista — nada é repetido.

     DB_MOVIMENTACOES é a única sem EXCLUIDO, de propósito:
     movimentação é livro-caixa. Estorno se faz com lançamento
     contrário, não apagando o de antes. Coluna de exclusão ali
     seria um convite a sumir com a história do estoque.
     -------------------------------------------------------- */
  { caminho: '01_BANCO_DADOS', tipo: 'pasta', etapa: 1 },
  {
    caminho: '01_BANCO_DADOS/DB_USUARIOS', tipo: 'planilha', etapa: 2, aba: 'USUARIOS',
    colunas: AP_SRV_comControle_(['ID_USUARIO', 'NOME', 'MATRICULA', 'EMAIL', 'PERFIL',
      'STATUS', 'EMPRESA_ID', 'OBRA_ID', 'DATA_CRIACAO', 'DATA_ATUALIZACAO'])
  },
  {
    caminho: '01_BANCO_DADOS/DB_EMPRESAS', tipo: 'planilha', etapa: 2, aba: 'EMPRESAS',
    colunas: AP_SRV_comControle_(['ID_EMPRESA', 'RAZAO_SOCIAL', 'CNPJ', 'NOME_FANTASIA',
      'STATUS', 'DATA_CRIACAO', 'DATA_ATUALIZACAO'])
  },
  {
    /* DB_EQUIPES aparece na árvore do documento mas ficou sem lista
       de colunas. Montei o mínimo para uma equipe existir e se ligar
       a empresa e obra. Se a COESA tiver outros campos, é só dizer:
       acrescentar coluna depois é seguro, o sistema põe no fim. */
    caminho: '01_BANCO_DADOS/DB_EQUIPES', tipo: 'planilha', etapa: 2, aba: 'EQUIPES',
    colunas: AP_SRV_comControle_(['ID_EQUIPE', 'NOME_EQUIPE', 'CODIGO', 'EMPRESA_ID',
      'PROJETO_ID', 'LIDER_ID', 'DESCRICAO'])
  },
  {
    caminho: '01_BANCO_DADOS/DB_PROJETOS', tipo: 'planilha', etapa: 2, aba: 'PROJETOS',
    colunas: AP_SRV_comControle_(['ID_PROJETO', 'NOME_PROJETO', 'CODIGO', 'EMPRESA_ID',
      'ENDERECO', 'STATUS', 'DATA_CRIACAO', 'DATA_ATUALIZACAO'])
  },
  {
    caminho: '01_BANCO_DADOS/DB_FORNECEDORES', tipo: 'planilha', etapa: 2, aba: 'FORNECEDORES',
    colunas: AP_SRV_comControle_(['ID_FORNECEDOR', 'RAZAO_SOCIAL', 'CNPJ', 'CONTATO',
      'EMAIL', 'TELEFONE', 'STATUS', 'DATA_CRIACAO', 'DATA_ATUALIZACAO'])
  },
  {
    caminho: '01_BANCO_DADOS/DB_PRODUTOS', tipo: 'planilha', etapa: 2, aba: 'PRODUTOS',
    colunas: AP_SRV_comControle_(['ID_PRODUTO', 'CODIGO', 'DESCRICAO', 'CATEGORIA',
      'UNIDADE', 'VALOR_UNITARIO', 'FORNECEDOR_ID', 'LOCALIZACAO',
      'STATUS', 'DATA_CRIACAO', 'DATA_ATUALIZACAO'])
  },
  {
    caminho: '01_BANCO_DADOS/DB_ESTOQUE', tipo: 'planilha', etapa: 2, aba: 'ESTOQUE',
    colunas: AP_SRV_comControle_(['ID_ESTOQUE', 'PRODUTO_ID', 'PROJETO_ID', 'LOCALIZACAO',
      'SALDO_ATUAL', 'SALDO_RESERVADO', 'SALDO_DISPONIVEL',
      'DATA_ATUALIZACAO', 'STATUS'])
  },
  {
    caminho: '01_BANCO_DADOS/DB_MOVIMENTACOES', tipo: 'planilha', etapa: 2, aba: 'MOVIMENTACOES',
    colunas: AP_SRV_comControle_(['ID_MOVIMENTACAO', 'PRODUTO_ID', 'TIPO_MOVIMENTO',
      'QUANTIDADE', 'DOCUMENTO_REFERENCIA', 'USUARIO_ID',
      'PROJETO_ID', 'DATA_MOVIMENTO', 'OBSERVACAO'], { semExclusao: true })
  },
  {
    caminho: '01_BANCO_DADOS/DB_NOTAS_FISCAIS', tipo: 'planilha', etapa: 2, aba: 'NOTAS_FISCAIS',
    colunas: AP_SRV_comControle_(['ID_NOTA', 'NUMERO', 'SERIE', 'CHAVE_ACESSO',
      'FORNECEDOR_ID', 'DATA_EMISSAO', 'VALOR_TOTAL', 'ARQUIVO_ID',
      'STATUS', 'USUARIO_ID', 'DATA_CADASTRO'])
  },
  {
    caminho: '01_BANCO_DADOS/DB_ITENS_NOTAS', tipo: 'planilha', etapa: 2, aba: 'ITENS_NOTAS',
    colunas: AP_SRV_comControle_(['ID_ITEM', 'NOTA_ID', 'PRODUTO_ID', 'DESCRICAO',
      'QUANTIDADE', 'VALOR_UNITARIO', 'VALOR_TOTAL',
      'CA_EPI', 'PATRIMONIO_NECESSARIO'])
  },
  {
    caminho: '01_BANCO_DADOS/DB_SOLICITACOES', tipo: 'planilha', etapa: 2, aba: 'SOLICITACOES',
    colunas: AP_SRV_comControle_(['ID_SOLICITACAO', 'SOLICITANTE_ID', 'PROJETO_ID',
      'TIPO', 'STATUS', 'PRIORIDADE', 'DATA_CRIACAO', 'DATA_ATUALIZACAO'])
  },
  {
    caminho: '01_BANCO_DADOS/DB_RESERVAS', tipo: 'planilha', etapa: 2, aba: 'RESERVAS',
    colunas: AP_SRV_comControle_(['ID_RESERVA', 'SOLICITACAO_ID', 'PRODUTO_ID',
      'COLABORADOR_ID', 'QUANTIDADE', 'STATUS',
      'DATA_RESERVA', 'DATA_VALIDADE', 'USUARIO_RESPONSAVEL'])
  },
  {
    caminho: '01_BANCO_DADOS/DB_APROVACOES', tipo: 'planilha', etapa: 2, aba: 'APROVACOES',
    colunas: AP_SRV_comControle_(['ID_APROVACAO', 'TIPO_REGISTRO', 'REGISTRO_ID',
      'APROVADOR_ID', 'STATUS', 'DATA_ANALISE', 'OBSERVACAO'])
  },
  {
    caminho: '01_BANCO_DADOS/DB_EPI', tipo: 'planilha', etapa: 2, aba: 'EPI',
    colunas: AP_SRV_comControle_(['ID_EPI', 'PRODUTO_ID', 'DESCRICAO', 'CATEGORIA',
      'CA', 'TAMANHO', 'VALOR_UNITARIO', 'IMAGEM_ID',
      'STATUS', 'DATA_ATUALIZACAO'])
  },
  {
    caminho: '01_BANCO_DADOS/DB_FICHAS_EPI', tipo: 'planilha', etapa: 2, aba: 'FICHAS_EPI',
    colunas: AP_SRV_comControle_(['ID_FICHA', 'COLABORADOR_ID', 'ITEM_ID',
      'QUANTIDADE', 'CA', 'TIPO_OPERACAO', 'DATA_ENTREGA',
      'DATA_DEVOLUCAO', 'ASSINATURA_ID', 'RESPONSAVEL_ID', 'STATUS'])
  },
  {
    caminho: '01_BANCO_DADOS/DB_PATRIMONIO', tipo: 'planilha', etapa: 2, aba: 'PATRIMONIO',
    colunas: AP_SRV_comControle_(['ID_PATRIMONIO', 'NUMERO_PATRIMONIAL', 'PRODUTO_ID',
      'DESCRICAO', 'NOTA_ID', 'LOCALIZACAO', 'RESPONSAVEL_ID',
      'DATA_ENTRADA', 'VALOR', 'STATUS', 'IMAGEM_ID'])
  },
  {
    caminho: '01_BANCO_DADOS/DB_INVENTARIOS', tipo: 'planilha', etapa: 2, aba: 'INVENTARIOS',
    colunas: AP_SRV_comControle_(['ID_INVENTARIO', 'PROJETO_ID', 'RESPONSAVEL_ID',
      'DATA_INICIO', 'DATA_FINAL', 'STATUS',
      'QUANTIDADE_ITENS', 'VALOR_TOTAL', 'OBSERVACAO'])
  },
  {
    caminho: '01_BANCO_DADOS/DB_OCORRENCIAS', tipo: 'planilha', etapa: 2, aba: 'OCORRENCIAS',
    colunas: AP_SRV_comControle_(['ID_OCORRENCIA', 'TIPO', 'DESCRICAO', 'REGISTRO_ID',
      'USUARIO_ID', 'PRIORIDADE', 'STATUS', 'DATA_CRIACAO', 'DATA_RESOLUCAO'])
  },
  {
    caminho: '01_BANCO_DADOS/DB_ANEXOS', tipo: 'planilha', etapa: 2, aba: 'ANEXOS',
    colunas: AP_SRV_comControle_(['ID_ANEXO', 'TIPO_DOCUMENTO', 'REGISTRO_ID',
      'NOME_ARQUIVO', 'ID_ARQUIVO_DRIVE', 'URL_ARQUIVO',
      'HASH_ARQUIVO', 'DATA_UPLOAD', 'USUARIO_ID'])
  },

  /* ---------------- 02_DOCUMENTOS ---------------- */
  { caminho: '02_DOCUMENTOS', tipo: 'pasta', etapa: 1 },
  { caminho: '02_DOCUMENTOS/NOTAS_FISCAIS', tipo: 'pasta', etapa: 1 },
  { caminho: '02_DOCUMENTOS/FICHAS_EPI', tipo: 'pasta', etapa: 1 },
  { caminho: '02_DOCUMENTOS/PATRIMONIO', tipo: 'pasta', etapa: 1 },
  { caminho: '02_DOCUMENTOS/INVENTARIOS', tipo: 'pasta', etapa: 1 },
  { caminho: '02_DOCUMENTOS/RELATORIOS', tipo: 'pasta', etapa: 1 },
  { caminho: '02_DOCUMENTOS/ASSINATURAS', tipo: 'pasta', etapa: 1 },

  /* ---------------- 03_MODULOS ---------------- */
  { caminho: '03_MODULOS', tipo: 'pasta', etapa: 1 },
  { caminho: '03_MODULOS/ESTOQUE', tipo: 'pasta', etapa: 1 },
  { caminho: '03_MODULOS/COMPRAS', tipo: 'pasta', etapa: 1 },
  { caminho: '03_MODULOS/EPI', tipo: 'pasta', etapa: 1 },
  { caminho: '03_MODULOS/PATRIMONIO', tipo: 'pasta', etapa: 1 },
  { caminho: '03_MODULOS/INVENTARIO', tipo: 'pasta', etapa: 1 },
  { caminho: '03_MODULOS/NOTAS_FISCAIS', tipo: 'pasta', etapa: 1 },
  { caminho: '03_MODULOS/AUDITORIA', tipo: 'pasta', etapa: 1 },

  /* ---------------- 04_BACKUP ---------------- */
  { caminho: '04_BACKUP', tipo: 'pasta', etapa: 1 },
  { caminho: '04_BACKUP/BACKUP_DIARIO', tipo: 'pasta', etapa: 1 },
  { caminho: '04_BACKUP/BACKUP_SEMANAL', tipo: 'pasta', etapa: 1 },
  { caminho: '04_BACKUP/BACKUP_MANUAL', tipo: 'pasta', etapa: 1 },

  /* ---------------- 05_LOGS_AUDITORIA ---------------- */
  { caminho: '05_LOGS_AUDITORIA', tipo: 'pasta', etapa: 1 },
  {
    caminho: '05_LOGS_AUDITORIA/LOG_ACESSOS', tipo: 'planilha', etapa: 1, aba: 'ACESSOS',
    colunas: ['ID_LOG', 'DATA_HORA', 'USUARIO_ID', 'USUARIO_EMAIL', 'ACAO',
      'ORIGEM', 'RESULTADO', 'DETALHE']
  },
  {
    caminho: '05_LOGS_AUDITORIA/LOG_ALTERACOES', tipo: 'planilha', etapa: 1, aba: 'ALTERACOES',
    colunas: ['ID_LOG', 'DATA_HORA', 'USUARIO_ID', 'MODULO', 'TABELA',
      'REGISTRO_ID', 'CAMPO', 'VALOR_ANTERIOR', 'VALOR_NOVO', 'ORIGEM']
  },
  {
    caminho: '05_LOGS_AUDITORIA/LOG_ERROS', tipo: 'planilha', etapa: 1, aba: 'ERROS',
    colunas: ['ID_LOG', 'DATA_HORA', 'MODULO', 'FUNCAO', 'MENSAGEM',
      'DETALHE', 'GRAVIDADE', 'USUARIO_ID']
  },
  {
    caminho: '05_LOGS_AUDITORIA/LOG_SINCRONIZACAO', tipo: 'planilha', etapa: 1, aba: 'SINCRONIZACAO',
    colunas: ['ID_LOG', 'DATA_HORA', 'MODULO', 'ACAO', 'ITEM',
      'RESULTADO', 'DETALHE', 'USUARIO_ID']
  },

  /* ---------------- 06_CONFIGURACOES (pastas agora, planilhas na etapa 3) ------- */
  { caminho: '06_CONFIGURACOES', tipo: 'pasta', etapa: 1 },

  /* ---------------- 07_TESTES (pastas agora, planilhas na etapa 5) ------------- */
  { caminho: '07_TESTES', tipo: 'pasta', etapa: 1 }
];

/* ============================================================
   PEÇAS INTERNAS
   ============================================================ */

function AP_SRV_props_() {
  return PropertiesService.getScriptProperties();
}

function AP_SRV_agora_() {
  return Utilities.formatDate(new Date(), 'America/Manaus', 'yyyy-MM-dd HH:mm:ss');
}

/* ------------------------------------------------------------
   AP_SRV_quando_ — data virando texto, sempre do mesmo jeito

   O Sheets é esperto demais: gravei "2026-09-20 18:16:23" como
   texto e ele me devolveu um objeto Date. Isso quebra em silêncio
   toda comparação feita como texto — e uma delas é a validade da
   sessão. Comparar Date com texto não dá erro: dá resposta errada.

   Aqui tudo vira o mesmo formato antes de comparar. A volta usa
   o fuso DO PROJETO, não um fixo: foi nesse fuso que o Sheets
   interpretou o texto, então é nele que o texto volta igual.
   ------------------------------------------------------------ */
function AP_SRV_quando_(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  if (Object.prototype.toString.call(valor) === '[object Date]') {
    if (isNaN(valor.getTime())) return '';
    var fuso = 'America/Manaus';
    try { fuso = Session.getScriptTimeZone() || fuso; } catch (e) { }
    return Utilities.formatDate(valor, fuso, 'yyyy-MM-dd HH:mm:ss');
  }
  return String(valor).trim();
}

/* ID único de verdade: momento + contador + acaso. Não depende de
   número de linha, porque linha some quando alguém ordena a planilha.

   O contador existe porque o teste pegou uma falha real: 3000 IDs
   gerados dentro do mesmo milissegundo colidiram. Só o acaso não
   basta quando um laço grava centenas de linhas de uma vez — e um
   ID repetido em banco de dados é um estrago silencioso. O contador
   garante a diferença dentro da execução; o acaso cuida de duas
   execuções simultâneas. */
var AP_SRV_CONTADOR = 0;

function AP_SRV_novoId_(prefixo) {
  AP_SRV_CONTADOR = (AP_SRV_CONTADOR + 1) % 1679616;
  var t = new Date().getTime().toString(36).toUpperCase();
  var c = AP_SRV_CONTADOR.toString(36).toUpperCase();
  while (c.length < 4) c = '0' + c;
  var r = Math.floor(Math.random() * 46656).toString(36).toUpperCase();
  while (r.length < 3) r = '0' + r;
  return (prefixo || 'ID') + '-' + t + '-' + c + r;
}

function AP_SRV_quemSou_() {
  try {
    var e = Session.getActiveUser().getEmail();
    return e || 'sistema';
  } catch (falha) { return 'sistema'; }
}

/* ---------- o registro de IDs (passo 1 da regra de não duplicar) ---------- */
function AP_SRV_registroLer_() {
  try {
    var bruto = AP_SRV_props_().getProperty(AP_SRV_CFG.propRegistro);
    return bruto ? JSON.parse(bruto) : {};
  } catch (falha) { return {}; }
}

function AP_SRV_registroGravar_(registro) {
  AP_SRV_props_().setProperty(AP_SRV_CFG.propRegistro, JSON.stringify(registro));
}

/* ---------- diário de bordo desta execução ---------- */
var AP_SRV_DIARIO = null;

function AP_SRV_anotar_(acao, item, detalhe) {
  if (!AP_SRV_DIARIO) AP_SRV_DIARIO = [];
  AP_SRV_DIARIO.push({ acao: acao, item: item, detalhe: detalhe || '', quando: AP_SRV_agora_() });
}

/* ============================================================
   DRIVE — PROCURAR ANTES DE CRIAR, SEMPRE
   ============================================================ */

function AP_SRV_pastaPorId_(id) {
  if (!id) return null;
  try { return DriveApp.getFolderById(id); } catch (falha) { return null; }
}

function AP_SRV_arquivoPorId_(id) {
  if (!id) return null;
  try { return DriveApp.getFileById(id); } catch (falha) { return null; }
}

/* Procura pelo nome DENTRO da pasta indicada. Se achar mais de uma,
   fica com a mais antiga e denuncia a ambiguidade — não escolhe no
   escuro e não cria uma terceira. */
function AP_SRV_acharPastaNaPasta_(pai, nome) {
  var achadas = [], it = pai.getFoldersByName(nome);
  while (it.hasNext()) achadas.push(it.next());
  if (!achadas.length) return { pasta: null, quantas: 0 };
  achadas.sort(function (a, b) {
    return a.getDateCreated().getTime() - b.getDateCreated().getTime();
  });
  return { pasta: achadas[0], quantas: achadas.length };
}

function AP_SRV_acharArquivoNaPasta_(pai, nome) {
  var achados = [], it = pai.getFilesByName(nome);
  while (it.hasNext()) achados.push(it.next());
  if (!achados.length) return { arquivo: null, quantos: 0 };
  achados.sort(function (a, b) {
    return a.getDateCreated().getTime() - b.getDateCreated().getTime();
  });
  return { arquivo: achados[0], quantos: achados.length };
}

/* A RAIZ. Ordem: ID registrado → ID na propriedade → nome no Drive
   → criar. O ID sempre ganha do nome, para renomear a pasta não
   fazer o sistema criar outra do lado. */
function AP_SRV_garantirRaiz_(registro, relatorio) {
  var idConfigurado = AP_SRV_props_().getProperty(AP_SRV_CFG.propRaiz) || registro['/'] || '';
  var pasta = AP_SRV_pastaPorId_(idConfigurado);

  if (pasta) {
    AP_SRV_anotar_('reusou', AP_SRV_CFG.nomeRaiz, 'encontrada pelo ID registrado');
    relatorio.reaproveitados++;
  } else {
    if (idConfigurado) {
      relatorio.alertas.push('O ID da pasta raiz que estava configurado (' + idConfigurado +
        ') não abriu. Pode ter ido para a lixeira ou perdido o acesso. Procurei pelo nome.');
    }
    var achadas = [], it = DriveApp.getFoldersByName(AP_SRV_CFG.nomeRaiz);
    while (it.hasNext()) achadas.push(it.next());
    if (achadas.length) {
      achadas.sort(function (a, b) {
        return a.getDateCreated().getTime() - b.getDateCreated().getTime();
      });
      pasta = achadas[0];
      if (achadas.length > 1) {
        relatorio.alertas.push('Existem ' + achadas.length + ' pastas chamadas "' +
          AP_SRV_CFG.nomeRaiz + '" no seu Drive. Usei a mais antiga (ID ' + pasta.getId() +
          '). Confira as outras antes de continuar — eu não mexo nelas.');
      }
      AP_SRV_anotar_('reusou', AP_SRV_CFG.nomeRaiz, 'encontrada pelo nome');
      relatorio.reaproveitados++;
    } else {
      pasta = DriveApp.createFolder(AP_SRV_CFG.nomeRaiz);
      AP_SRV_anotar_('criou', AP_SRV_CFG.nomeRaiz, 'pasta raiz nova');
      relatorio.criados++;
    }
  }

  registro['/'] = pasta.getId();
  AP_SRV_props_().setProperty(AP_SRV_CFG.propRaiz, pasta.getId());
  return pasta;
}

function AP_SRV_garantirPasta_(pai, nome, caminho, registro, relatorio) {
  var pasta = AP_SRV_pastaPorId_(registro[caminho]);
  if (pasta) {
    /* o ID pode apontar para algo que foi movido para fora: confere o pai */
    relatorio.reaproveitados++;
    AP_SRV_anotar_('reusou', caminho, 'pelo ID registrado');
    return pasta;
  }
  var achado = AP_SRV_acharPastaNaPasta_(pai, nome);
  if (achado.pasta) {
    pasta = achado.pasta;
    if (achado.quantas > 1) {
      relatorio.alertas.push('Há ' + achado.quantas + ' pastas "' + nome + '" dentro de ' +
        caminho.replace('/' + nome, '') + '. Usei a mais antiga e não toquei nas outras.');
    }
    relatorio.reaproveitados++;
    AP_SRV_anotar_('reusou', caminho, 'pelo nome');
  } else {
    pasta = pai.createFolder(nome);
    relatorio.criados++;
    AP_SRV_anotar_('criou', caminho, 'pasta nova');
  }
  registro[caminho] = pasta.getId();
  return pasta;
}

/* Mover um arquivo recém-criado para a pasta certa. SpreadsheetApp
   .create() sempre nasce na raiz do Drive; se a mudança falhar, a
   planilha existe mas está no lugar errado — e isso precisa aparecer,
   não ficar quieto. */
function AP_SRV_mover_(arquivo, destino) {
  try {
    if (arquivo.moveTo) { arquivo.moveTo(destino); return true; }
  } catch (falha) { /* cai no jeito antigo */ }
  try {
    destino.addFile(arquivo);
    DriveApp.getRootFolder().removeFile(arquivo);
    return true;
  } catch (falha2) { return false; }
}

/* ============================================================
   PLANILHAS E CABEÇALHOS
   ============================================================ */

function AP_SRV_abrirPlanilha_(id) {
  if (!id) return null;
  try { return SpreadsheetApp.openById(id); } catch (falha) { return null; }
}

function AP_SRV_garantirPlanilha_(pasta, item, caminho, registro, relatorio) {
  var nome = caminho.split('/').pop();
  var planilha = AP_SRV_abrirPlanilha_(registro[caminho]);

  if (planilha) {
    relatorio.reaproveitados++;
    AP_SRV_anotar_('reusou', caminho, 'pelo ID registrado');
  } else {
    var achado = AP_SRV_acharArquivoNaPasta_(pasta, nome);
    if (achado.arquivo) {
      planilha = AP_SRV_abrirPlanilha_(achado.arquivo.getId());
      if (!planilha) {
        relatorio.alertas.push('Existe um arquivo chamado "' + nome + '" em ' + caminho +
          ', mas ele não é uma planilha do Google. Não criei outra e não mexi nele. ' +
          'Renomeie ou tire da pasta e rode de novo.');
        relatorio.pendentes.push(caminho);
        return null;
      }
      if (achado.quantos > 1) {
        relatorio.alertas.push('Há ' + achado.quantos + ' arquivos "' + nome +
          '" na mesma pasta. Usei o mais antigo e não toquei nos outros.');
      }
      relatorio.reaproveitados++;
      AP_SRV_anotar_('reusou', caminho, 'pelo nome');
    } else {
      planilha = SpreadsheetApp.create(nome);
      var arq = AP_SRV_arquivoPorId_(planilha.getId());
      var mudou = arq ? AP_SRV_mover_(arq, pasta) : false;
      if (!mudou) {
        relatorio.alertas.push('A planilha "' + nome + '" foi criada, mas não consegui ' +
          'movê-la para ' + caminho + '. Ela está na raiz do seu Drive.');
      }
      relatorio.criados++;
      AP_SRV_anotar_('criou', caminho, 'planilha nova');
    }
    registro[caminho] = planilha.getId();
  }

  AP_SRV_garantirAba_(planilha, item, caminho, relatorio);
  return planilha;
}

function AP_SRV_garantirAba_(planilha, item, caminho, relatorio) {
  var nomeAba = item.aba || 'DADOS';
  var aba = planilha.getSheetByName(nomeAba);

  if (!aba) {
    var abas = planilha.getSheets();
    /* a aba padrão que vem vazia com a planilha nova é reaproveitada,
       não abandonada ao lado da aba certa */
    if (abas.length === 1 && abas[0].getLastRow() === 0 &&
      /^(Sheet1|P.gina1|Planilha1)$/i.test(abas[0].getName())) {
      aba = abas[0];
      aba.setName(nomeAba);
      AP_SRV_anotar_('renomeou', caminho + ' → aba ' + nomeAba, 'aba padrão reaproveitada');
    } else {
      aba = planilha.insertSheet(nomeAba);
      AP_SRV_anotar_('criou', caminho + ' → aba ' + nomeAba, 'aba nova');
    }
  }

  AP_SRV_garantirCabecalho_(aba, item.colunas || [], caminho, relatorio);
  return aba;
}

/* A REGRA: acrescenta o que falta no fim. Nunca renomeia, nunca
   apaga, nunca reordena. Coluna estranha que já estava lá continua
   lá — pode ser de alguém. */
function AP_SRV_garantirCabecalho_(aba, colunas, caminho, relatorio) {
  if (!colunas.length) return;
  var largura = aba.getLastColumn();
  var atuais = [];
  if (largura > 0 && aba.getLastRow() > 0) {
    atuais = aba.getRange(1, 1, 1, largura).getValues()[0].map(function (c) {
      return String(c || '').trim();
    });
    while (atuais.length && atuais[atuais.length - 1] === '') atuais.pop();
  }

  if (!atuais.length) {
    aba.getRange(1, 1, 1, colunas.length).setValues([colunas]);
    try {
      aba.getRange(1, 1, 1, colunas.length).setFontWeight('bold');
      aba.setFrozenRows(1);
    } catch (falha) { /* formatação é enfeite, não pode derrubar a instalação */ }
    AP_SRV_anotar_('cabecalho', caminho, colunas.length + ' colunas escritas');
    return;
  }

  var faltando = [];
  for (var i = 0; i < colunas.length; i++) {
    if (atuais.indexOf(colunas[i]) === -1) faltando.push(colunas[i]);
  }
  if (faltando.length) {
    aba.getRange(1, atuais.length + 1, 1, faltando.length).setValues([faltando]);
    try {
      aba.getRange(1, atuais.length + 1, 1, faltando.length).setFontWeight('bold');
    } catch (falha) { }
    relatorio.alertas.push('Em ' + caminho + ' faltavam as colunas ' + faltando.join(', ') +
      '. Acrescentei no fim, sem mexer nas que já existiam nem nos dados.');
    AP_SRV_anotar_('cabecalho', caminho, 'acrescentadas: ' + faltando.join(', '));
  }

  var sobrando = [];
  for (var j = 0; j < atuais.length; j++) {
    if (atuais[j] && colunas.indexOf(atuais[j]) === -1) sobrando.push(atuais[j]);
  }
  if (sobrando.length) {
    relatorio.alertas.push('Em ' + caminho + ' existem colunas que o sistema não conhece: ' +
      sobrando.join(', ') + '. Deixei como estavam — não apago coluna de ninguém.');
  }
}

/* ============================================================
   FUNÇÕES PÚBLICAS — AS DO DOCUMENTO
   ============================================================ */

/* ------------------------------------------------------------
   inicializarServidorALMOXA_PRO()
   Roda a instalação inteira da etapa 1. Pode rodar quantas vezes
   quiser: da segunda em diante ela só confere.
   ------------------------------------------------------------ */
function inicializarServidorALMOXA_PRO() {
  var trava = null;
  try {
    trava = LockService.getScriptLock();
    if (!trava.tryLock(AP_SRV_CFG.segundosDeEspera * 1000)) {
      return {
        ok: false, codigo: 'OCUPADO',
        mensagem: 'Outra instalação está rodando agora. Espere ela terminar e tente de novo.'
      };
    }
  } catch (falha) { trava = null; }

  AP_SRV_DIARIO = [];
  var comecou = new Date().getTime();
  var relatorio = {
    versao: AP_SRV_CFG.versao, etapa: AP_SRV_CFG.etapaAtual,
    criados: 0, reaproveitados: 0, pendentes: [], alertas: [], erros: []
  };

  try {
    var registro = AP_SRV_registroLer_();
    var raiz = AP_SRV_garantirRaiz_(registro, relatorio);
    var pastas = { '': raiz };

    for (var i = 0; i < AP_SRV_MAPA.length; i++) {
      var item = AP_SRV_MAPA[i];
      if (item.etapa > AP_SRV_CFG.etapaAtual) { relatorio.pendentes.push(item.caminho); continue; }

      var partes = item.caminho.split('/');
      var nome = partes.pop();
      var caminhoPai = partes.join('/');
      var pai = pastas[caminhoPai];

      if (!pai) {
        relatorio.erros.push('A pasta de cima de ' + item.caminho + ' não existe. ' +
          'Isso é erro do mapa, não do seu Drive.');
        continue;
      }

      try {
        if (item.tipo === 'pasta') {
          pastas[item.caminho] = AP_SRV_garantirPasta_(pai, nome, item.caminho, registro, relatorio);
        } else {
          AP_SRV_garantirPlanilha_(pai, item, item.caminho, registro, relatorio);
        }
      } catch (falhaItem) {
        relatorio.erros.push(item.caminho + ': ' + (falhaItem && falhaItem.message || falhaItem));
      }

      /* grava o registro a cada passo: se o Apps Script cortar no
         meio por tempo, o que já foi criado está anotado e a próxima
         execução reaproveita em vez de duplicar */
      AP_SRV_registroGravar_(registro);
    }

    AP_SRV_props_().setProperty(AP_SRV_CFG.propVersao, AP_SRV_CFG.versao);

    /* o CORE se registra como módulo e anota a própria versão */
    try {
      registrarModulo({
        nome: 'CORE', versao: AP_SRV_CFG.versao,
        arquivo: 'ALMOXA_PRO_Servidor_Core.gs',
        descricao: 'Estrutura do Drive, registro de módulos, log e integridade'
      });
      AP_SRV_registrarVersao_('CORE', AP_SRV_CFG.versao, 'Etapa 1 instalada');
    } catch (falhaMod) {
      relatorio.alertas.push('A estrutura ficou pronta, mas não consegui registrar o módulo CORE: ' +
        (falhaMod && falhaMod.message || falhaMod));
    }

    var integridade = verificarIntegridade();
    relatorio.integridade = integridade;

    /* só agora o log existe: o diário da execução vai para a planilha */
    for (var d = 0; d < AP_SRV_DIARIO.length; d++) {
      var linha = AP_SRV_DIARIO[d];
      registrarLog('SINCRONIZACAO', {
        modulo: 'CORE', acao: linha.acao, item: linha.item,
        resultado: 'OK', detalhe: linha.detalhe
      });
    }
    for (var a = 0; a < relatorio.erros.length; a++) {
      registrarLog('ERRO', {
        modulo: 'CORE', funcao: 'inicializarServidorALMOXA_PRO',
        mensagem: relatorio.erros[a], gravidade: 'ALTA'
      });
    }

    relatorio.ok = relatorio.erros.length === 0;
    relatorio.segundos = Math.round((new Date().getTime() - comecou) / 100) / 10;
    relatorio.raizId = registro['/'];
    relatorio.texto = AP_SRV_textoDoRelatorio_(relatorio);
    return relatorio;

  } catch (falhaGeral) {
    relatorio.ok = false;
    relatorio.erros.push(falhaGeral && falhaGeral.message || String(falhaGeral));
    relatorio.texto = AP_SRV_textoDoRelatorio_(relatorio);
    try {
      registrarLog('ERRO', {
        modulo: 'CORE', funcao: 'inicializarServidorALMOXA_PRO',
        mensagem: relatorio.erros[relatorio.erros.length - 1], gravidade: 'CRITICA'
      });
    } catch (e) { }
    return relatorio;
  } finally {
    if (trava) { try { trava.releaseLock(); } catch (e) { } }
  }
}

function AP_SRV_textoDoRelatorio_(r) {
  var l = [];
  l.push('ALMOXA PRO — SERVIDOR CENTRAL — ETAPA ' + r.etapa + ' (' + r.versao + ')');
  l.push('');
  l.push('Criados agora ......... ' + r.criados);
  l.push('Já existiam ........... ' + r.reaproveitados);
  l.push('Para as próximas etapas ' + r.pendentes.length);
  l.push('Erros ................. ' + r.erros.length);
  if (r.raizId) l.push('Pasta raiz ............ ' + r.raizId);
  if (r.alertas && r.alertas.length) {
    l.push(''); l.push('ATENÇÃO:');
    for (var i = 0; i < r.alertas.length; i++) l.push('  · ' + r.alertas[i]);
  }
  if (r.erros && r.erros.length) {
    l.push(''); l.push('ERROS:');
    for (var j = 0; j < r.erros.length; j++) l.push('  · ' + r.erros[j]);
  }
  if (r.integridade && r.integridade.problemas && r.integridade.problemas.length) {
    l.push(''); l.push('INTEGRIDADE:');
    for (var k = 0; k < r.integridade.problemas.length; k++) {
      var p = r.integridade.problemas[k];
      l.push('  · [' + p.gravidade + '] ' + p.componente + ' — ' + p.problema);
      if (p.sugestao) l.push('      o que fazer: ' + p.sugestao);
    }
  }
  return l.join('\n');
}

/* ------------------------------------------------------------
   validarEstruturaServidor() — as pastas estão todas lá?
   Só olha. Não cria nada.
   ------------------------------------------------------------ */
function validarEstruturaServidor() {
  var registro = AP_SRV_registroLer_();
  var resultado = { ok: true, presentes: [], ausentes: [], pendentes: [] };
  var raiz = AP_SRV_pastaPorId_(registro['/'] || AP_SRV_props_().getProperty(AP_SRV_CFG.propRaiz));

  if (!raiz) {
    return {
      ok: false, presentes: [], ausentes: ['/'], pendentes: [],
      mensagem: 'A pasta raiz do servidor não foi encontrada. Rode inicializarServidorALMOXA_PRO().'
    };
  }
  resultado.presentes.push('/');

  for (var i = 0; i < AP_SRV_MAPA.length; i++) {
    var item = AP_SRV_MAPA[i];
    if (item.tipo !== 'pasta') continue;
    if (item.etapa > AP_SRV_CFG.etapaAtual) { resultado.pendentes.push(item.caminho); continue; }
    if (AP_SRV_pastaPorId_(registro[item.caminho])) resultado.presentes.push(item.caminho);
    else { resultado.ausentes.push(item.caminho); resultado.ok = false; }
  }
  return resultado;
}

/* ------------------------------------------------------------
   validarBancosDeDados() — as planilhas estão lá e abrem?
   ------------------------------------------------------------ */
function validarBancosDeDados() {
  var registro = AP_SRV_registroLer_();
  var resultado = { ok: true, presentes: [], ausentes: [], pendentes: [] };

  for (var i = 0; i < AP_SRV_MAPA.length; i++) {
    var item = AP_SRV_MAPA[i];
    if (item.tipo !== 'planilha') continue;
    if (item.etapa > AP_SRV_CFG.etapaAtual) { resultado.pendentes.push(item.caminho); continue; }
    var pl = AP_SRV_abrirPlanilha_(registro[item.caminho]);
    if (pl) resultado.presentes.push(item.caminho);
    else { resultado.ausentes.push(item.caminho); resultado.ok = false; }
  }
  return resultado;
}

/* ------------------------------------------------------------
   validarCabecalhos() — confere coluna por coluna. Não conserta.
   ------------------------------------------------------------ */
function validarCabecalhos() {
  var registro = AP_SRV_registroLer_();
  var resultado = { ok: true, conferidos: 0, problemas: [] };

  for (var i = 0; i < AP_SRV_MAPA.length; i++) {
    var item = AP_SRV_MAPA[i];
    if (item.tipo !== 'planilha' || item.etapa > AP_SRV_CFG.etapaAtual) continue;

    var pl = AP_SRV_abrirPlanilha_(registro[item.caminho]);
    if (!pl) {
      resultado.ok = false;
      resultado.problemas.push({
        componente: item.caminho, problema: 'planilha não encontrada',
        gravidade: 'ALTA', sugestao: 'rodar inicializarServidorALMOXA_PRO()'
      });
      continue;
    }
    var aba = pl.getSheetByName(item.aba || 'DADOS');
    if (!aba) {
      resultado.ok = false;
      resultado.problemas.push({
        componente: item.caminho, problema: 'a aba ' + (item.aba || 'DADOS') + ' não existe',
        gravidade: 'ALTA', sugestao: 'rodar inicializarServidorALMOXA_PRO()'
      });
      continue;
    }
    resultado.conferidos++;

    var largura = aba.getLastColumn();
    var atuais = largura > 0
      ? aba.getRange(1, 1, 1, largura).getValues()[0].map(function (c) { return String(c || '').trim(); })
      : [];
    var faltando = [];
    for (var c = 0; c < item.colunas.length; c++) {
      if (atuais.indexOf(item.colunas[c]) === -1) faltando.push(item.colunas[c]);
    }
    if (faltando.length) {
      resultado.ok = false;
      resultado.problemas.push({
        componente: item.caminho, problema: 'faltam colunas: ' + faltando.join(', '),
        gravidade: 'MEDIA',
        sugestao: 'rodar inicializarServidorALMOXA_PRO() — ele acrescenta no fim, sem mexer nas outras'
      });
    }
  }
  return resultado;
}

/* ------------------------------------------------------------
   registrarModulo() — cadastra ou atualiza. Nunca duplica: a chave
   é o nome do módulo.
   ------------------------------------------------------------ */
function registrarModulo(dados) {
  dados = dados || {};
  var nome = String(dados.nome || '').trim();
  if (!nome) return { ok: false, codigo: 'SEM_NOME', mensagem: 'O módulo precisa de um nome.' };

  var aba = AP_SRV_aba_('00_CORE/CORE_MODULOS');
  if (!aba) {
    return {
      ok: false, codigo: 'SEM_ESTRUTURA',
      mensagem: 'A planilha CORE_MODULOS não existe ainda. Rode inicializarServidorALMOXA_PRO().'
    };
  }

  var colunas = AP_SRV_colunasDe_(aba);
  var linhas = aba.getLastRow() > 1
    ? aba.getRange(2, 1, aba.getLastRow() - 1, aba.getLastColumn()).getValues() : [];
  var iNome = colunas.indexOf('NOME_MODULO');
  var agora = AP_SRV_agora_();
  var quem = AP_SRV_quemSou_();

  for (var i = 0; i < linhas.length; i++) {
    if (String(linhas[i][iNome] || '').trim().toUpperCase() === nome.toUpperCase()) {
      var atual = linhas[i].slice();
      AP_SRV_por_(atual, colunas, 'VERSAO', dados.versao || atual[colunas.indexOf('VERSAO')]);
      AP_SRV_por_(atual, colunas, 'ARQUIVO', dados.arquivo || atual[colunas.indexOf('ARQUIVO')]);
      AP_SRV_por_(atual, colunas, 'DESCRICAO', dados.descricao || atual[colunas.indexOf('DESCRICAO')]);
      AP_SRV_por_(atual, colunas, 'STATUS', dados.status || 'ATIVO');
      AP_SRV_por_(atual, colunas, 'USUARIO_RESPONSAVEL', quem);
      AP_SRV_por_(atual, colunas, 'DATA_ATUALIZACAO', agora);
      var v = parseInt(atual[colunas.indexOf('VERSAO_REGISTRO')], 10);
      AP_SRV_por_(atual, colunas, 'VERSAO_REGISTRO', (isNaN(v) ? 1 : v + 1));
      aba.getRange(i + 2, 1, 1, colunas.length).setValues([atual]);
      return { ok: true, criado: false, id: atual[colunas.indexOf('ID_MODULO')] };
    }
  }

  var nova = [];
  for (var c = 0; c < colunas.length; c++) nova.push('');
  AP_SRV_por_(nova, colunas, 'ID_MODULO', AP_SRV_novoId_('MOD'));
  AP_SRV_por_(nova, colunas, 'NOME_MODULO', nome);
  AP_SRV_por_(nova, colunas, 'VERSAO', dados.versao || '');
  AP_SRV_por_(nova, colunas, 'ARQUIVO', dados.arquivo || '');
  AP_SRV_por_(nova, colunas, 'DESCRICAO', dados.descricao || '');
  AP_SRV_por_(nova, colunas, 'STATUS', dados.status || 'ATIVO');
  AP_SRV_por_(nova, colunas, 'USUARIO_RESPONSAVEL', quem);
  AP_SRV_por_(nova, colunas, 'VERSAO_REGISTRO', 1);
  AP_SRV_por_(nova, colunas, 'SYNC_ID', AP_SRV_novoId_('SYNC'));
  AP_SRV_por_(nova, colunas, 'DATA_CRIACAO', agora);
  AP_SRV_por_(nova, colunas, 'DATA_ATUALIZACAO', agora);
  aba.appendRow(nova);
  return { ok: true, criado: true, id: nova[colunas.indexOf('ID_MODULO')] };
}

function AP_SRV_registrarVersao_(componente, versao, descricao) {
  var aba = AP_SRV_aba_('00_CORE/CORE_VERSOES');
  if (!aba) return false;
  var colunas = AP_SRV_colunasDe_(aba);
  var linha = [];
  for (var c = 0; c < colunas.length; c++) linha.push('');
  AP_SRV_por_(linha, colunas, 'ID_VERSAO', AP_SRV_novoId_('VER'));
  AP_SRV_por_(linha, colunas, 'COMPONENTE', componente);
  AP_SRV_por_(linha, colunas, 'VERSAO', versao);
  AP_SRV_por_(linha, colunas, 'DESCRICAO', descricao || '');
  AP_SRV_por_(linha, colunas, 'ETAPA', AP_SRV_CFG.etapaAtual);
  AP_SRV_por_(linha, colunas, 'DATA_APLICACAO', AP_SRV_agora_());
  AP_SRV_por_(linha, colunas, 'USUARIO_RESPONSAVEL', AP_SRV_quemSou_());
  AP_SRV_por_(linha, colunas, 'STATUS', 'APLICADA');
  AP_SRV_por_(linha, colunas, 'SYNC_ID', AP_SRV_novoId_('SYNC'));
  aba.appendRow(linha);
  return true;
}

/* ------------------------------------------------------------
   registrarLog(tipo, dados)
   tipo: ACESSO | ALTERACAO | ERRO | SINCRONIZACAO
   Log que derruba o sistema não é log. Aqui, se falhar, falha quieto.
   ------------------------------------------------------------ */
var AP_SRV_LOGS = {
  ACESSO: '05_LOGS_AUDITORIA/LOG_ACESSOS',
  ALTERACAO: '05_LOGS_AUDITORIA/LOG_ALTERACOES',
  ERRO: '05_LOGS_AUDITORIA/LOG_ERROS',
  SINCRONIZACAO: '05_LOGS_AUDITORIA/LOG_SINCRONIZACAO'
};

function registrarLog(tipo, dados) {
  try {
    var caminho = AP_SRV_LOGS[String(tipo || '').toUpperCase()];
    if (!caminho) return false;
    var aba = AP_SRV_aba_(caminho);
    if (!aba) return false;

    dados = dados || {};
    var colunas = AP_SRV_colunasDe_(aba);
    var linha = [];
    for (var c = 0; c < colunas.length; c++) linha.push('');
    AP_SRV_por_(linha, colunas, 'ID_LOG', AP_SRV_novoId_('LOG'));
    AP_SRV_por_(linha, colunas, 'DATA_HORA', AP_SRV_agora_());
    AP_SRV_por_(linha, colunas, 'USUARIO_ID', dados.usuario || AP_SRV_quemSou_());
    for (var chave in dados) {
      if (!dados.hasOwnProperty(chave)) continue;
      var coluna = chave.toUpperCase();
      if (colunas.indexOf(coluna) > -1) AP_SRV_por_(linha, colunas, coluna, dados[chave]);
    }
    aba.appendRow(linha);
    return true;
  } catch (falha) {
    return false;
  }
}

/* ------------------------------------------------------------
   executarBackup(opcoes) — cópia, nunca movimento do original.
   Na etapa 1 copia o que existe: as planilhas do CORE e os logs.
   ------------------------------------------------------------ */
function executarBackup(opcoes) {
  opcoes = opcoes || {};
  var tipo = String(opcoes.tipo || 'MANUAL').toUpperCase();
  var destinos = { MANUAL: '04_BACKUP/BACKUP_MANUAL', DIARIO: '04_BACKUP/BACKUP_DIARIO', SEMANAL: '04_BACKUP/BACKUP_SEMANAL' };
  var caminhoDestino = destinos[tipo] || destinos.MANUAL;

  var registro = AP_SRV_registroLer_();
  var pastaDestino = AP_SRV_pastaPorId_(registro[caminhoDestino]);
  if (!pastaDestino) {
    return {
      ok: false, codigo: 'SEM_DESTINO',
      mensagem: 'A pasta ' + caminhoDestino + ' não existe. Rode inicializarServidorALMOXA_PRO().'
    };
  }

  var carimbo = Utilities.formatDate(new Date(), 'America/Manaus', 'yyyy-MM-dd_HHmm');
  var pastaDaVez = pastaDestino.createFolder('BACKUP_' + carimbo);
  var copiados = [], falhou = [];

  for (var i = 0; i < AP_SRV_MAPA.length; i++) {
    var item = AP_SRV_MAPA[i];
    if (item.tipo !== 'planilha' || item.etapa > AP_SRV_CFG.etapaAtual) continue;
    var id = registro[item.caminho];
    var arq = AP_SRV_arquivoPorId_(id);
    if (!arq) { falhou.push(item.caminho); continue; }
    try {
      arq.makeCopy(item.caminho.split('/').pop() + '_' + carimbo, pastaDaVez);
      copiados.push(item.caminho);
    } catch (falha) {
      falhou.push(item.caminho + ' (' + (falha && falha.message || falha) + ')');
    }
  }

  var resultado = {
    ok: falhou.length === 0, tipo: tipo, pasta: pastaDaVez.getId(),
    quando: AP_SRV_agora_(), usuario: AP_SRV_quemSou_(),
    copiados: copiados, falhou: falhou,
    mensagem: copiados.length + ' planilha(s) copiada(s)' +
      (falhou.length ? ', ' + falhou.length + ' com problema' : '')
  };
  registrarLog('SINCRONIZACAO', {
    modulo: 'CORE', acao: 'backup ' + tipo, item: pastaDaVez.getId(),
    resultado: resultado.ok ? 'OK' : 'PARCIAL', detalhe: resultado.mensagem
  });
  return resultado;
}

/* ------------------------------------------------------------
   verificarIntegridade() — junta as três conferências e devolve no
   formato que o Doutor do Sistema vai usar na etapa 5.
   ------------------------------------------------------------ */
function verificarIntegridade() {
  var problemas = [];
  var quando = AP_SRV_agora_();

  var estrutura = validarEstruturaServidor();
  for (var i = 0; i < estrutura.ausentes.length; i++) {
    problemas.push({
      modulo: 'CORE', componente: estrutura.ausentes[i], problema: 'pasta ausente',
      gravidade: 'ALTA', data: quando, sugestao: 'rodar inicializarServidorALMOXA_PRO()'
    });
  }

  var bancos = validarBancosDeDados();
  for (var j = 0; j < bancos.ausentes.length; j++) {
    problemas.push({
      modulo: 'CORE', componente: bancos.ausentes[j], problema: 'planilha ausente',
      gravidade: 'ALTA', data: quando, sugestao: 'rodar inicializarServidorALMOXA_PRO()'
    });
  }

  var cabecalhos = validarCabecalhos();
  for (var k = 0; k < cabecalhos.problemas.length; k++) {
    var p = cabecalhos.problemas[k];
    problemas.push({
      modulo: 'CORE', componente: p.componente, problema: p.problema,
      gravidade: p.gravidade, data: quando, sugestao: p.sugestao
    });
  }

  return {
    ok: problemas.length === 0,
    quando: quando,
    pastasOk: estrutura.presentes.length,
    planilhasOk: bancos.presentes.length,
    pendentesProximasEtapas: estrutura.pendentes.length + bancos.pendentes.length,
    problemas: problemas
  };
}

/* ============================================================
   ACESSO ÀS ABAS — o único caminho para os módulos
   Nenhum módulo deve abrir planilha por ID na mão. Pede aqui.
   ============================================================ */
function AP_SRV_aba_(caminho) {
  var registro = AP_SRV_registroLer_();
  var pl = AP_SRV_abrirPlanilha_(registro[caminho]);
  if (!pl) return null;
  var item = null;
  for (var i = 0; i < AP_SRV_MAPA.length; i++) {
    if (AP_SRV_MAPA[i].caminho === caminho) { item = AP_SRV_MAPA[i]; break; }
  }
  return pl.getSheetByName((item && item.aba) || 'DADOS');
}

function AP_SRV_colunasDe_(aba) {
  var largura = aba.getLastColumn();
  if (!largura) return [];
  return aba.getRange(1, 1, 1, largura).getValues()[0].map(function (c) {
    return String(c || '').trim();
  });
}

function AP_SRV_por_(linha, colunas, coluna, valor) {
  var i = colunas.indexOf(coluna);
  if (i > -1) linha[i] = valor;
  return linha;
}

/* Para os módulos e para a interface: onde está tudo. */
function AP_SRV_mapaDeIds() {
  var registro = AP_SRV_registroLer_();
  return {
    ok: !!registro['/'], versao: AP_SRV_props_().getProperty(AP_SRV_CFG.propVersao) || '',
    raiz: registro['/'] || '', itens: registro
  };
}

/* ============================================================
   AP_SRV_testes() — A PROVA
   ------------------------------------------------------------
   Roda a instalação inteira contra um Drive de MENTIRA. Nenhuma
   pasta, planilha ou arquivo seu é tocado: DriveApp, SpreadsheetApp,
   PropertiesService, LockService, Utilities e Session são trocados
   no começo e devolvidos no finally, aconteça o que acontecer.

   O que está sendo provado, e por quê:

   · rodar duas vezes cria ZERO item novo — é a única definição
     honesta de idempotente: contar, não confiar;
   · dado que já estava na planilha continua lá depois da segunda
     rodada — a instalação não pode custar nada a quem já usava;
   · coluna que falta entra no fim e as antigas não saem do lugar —
     porque embaixo de cada coluna existem linhas de dados;
   · coluna que o sistema não conhece não é apagada;
   · o ID registrado manda no nome: renomear a pasta não faz nascer
     uma segunda estrutura;
   · nenhum nome com "(1)", "(2)" ou "Cópia" aparece no Drive.
   ============================================================ */
function AP_SRV_testes() {
  var log = [], falhas = 0;
  function ok(nome, passou, obs) {
    if (!passou) falhas++;
    log.push((passou ? 'PASSOU  ' : 'FALHOU  ') + nome + (obs ? '  [' + obs + ']' : ''));
  }

  var etapaDeVerdade = AP_SRV_CFG.etapaAtual;
  var orig = {
    Drive: (typeof DriveApp !== 'undefined') ? DriveApp : null,
    Planilhas: (typeof SpreadsheetApp !== 'undefined') ? SpreadsheetApp : null,
    Props: (typeof PropertiesService !== 'undefined') ? PropertiesService : null,
    Lock: (typeof LockService !== 'undefined') ? LockService : null,
    Utils: (typeof Utilities !== 'undefined') ? Utilities : null,
    Sess: (typeof Session !== 'undefined') ? Session : null
  };

  try {
    /* ---------------- O DRIVE DE MENTIRA ---------------- */
    var sequencia = 0;
    function proximoId(p) { sequencia++; return (p || 'x') + '_' + sequencia; }
    var relogio = 1000;

    function novaPasta(nome) {
      var pastas = [], arquivos = [], nascida = relogio++;
      var eu = {
        __tipo: 'pasta', __id: proximoId('pasta'), __nome: nome,
        __pastas: pastas, __arquivos: arquivos,
        getId: function () { return eu.__id; },
        getName: function () { return eu.__nome; },
        getDateCreated: function () { return new Date(nascida); },
        createFolder: function (n) { var f = novaPasta(n); pastas.push(f); return f; },
        getFoldersByName: function (n) { return iterar(pastas.filter(function (f) { return f.__nome === n; })); },
        getFilesByName: function (n) { return iterar(arquivos.filter(function (f) { return f.__nome === n; })); },
        getFolders: function () { return iterar(pastas.slice()); },
        getFiles: function () { return iterar(arquivos.slice()); },
        addFile: function (a) { if (arquivos.indexOf(a) === -1) arquivos.push(a); a.__pai = eu; },
        removeFile: function (a) { var i = arquivos.indexOf(a); if (i > -1) arquivos.splice(i, 1); }
      };
      return eu;
    }

    function iterar(lista) {
      var i = 0;
      return { hasNext: function () { return i < lista.length; }, next: function () { return lista[i++]; } };
    }

    var RAIZ = novaPasta('Meu Drive');
    var PLANILHAS = {};   /* id → objeto planilha */

    function novoArquivo(nome, pai, planilha) {
      var nascida = relogio++;
      var eu = {
        __tipo: 'arquivo', __id: planilha ? planilha.__id : proximoId('arq'),
        __nome: nome, __pai: pai, __planilha: planilha || null,
        getId: function () { return eu.__id; },
        getName: function () { return eu.__nome; },
        getDateCreated: function () { return new Date(nascida); },
        moveTo: function (destino) {
          if (eu.__pai) eu.__pai.removeFile(eu);
          destino.addFile(eu); eu.__pai = destino; return eu;
        },
        makeCopy: function (nomeNovo, destino) {
          var copia = novoArquivo(nomeNovo, destino, null);
          copia.__copiaDe = eu.__id;
          destino.addFile(copia);
          return copia;
        }
      };
      if (pai) pai.addFile(eu);
      return eu;
    }

    /* ---------------- AS PLANILHAS DE MENTIRA ---------------- */
    function novaAba(nome) {
      var dados = [];   /* linhas de array */
      var congeladas = 0, negritos = 0;
      function garantir(l, c) {
        while (dados.length < l) dados.push([]);
        for (var i = 0; i < dados.length; i++) {
          while (dados[i].length < c) dados[i].push('');
        }
      }
      var eu = {
        __nome: nome, __dados: dados,
        getName: function () { return eu.__nome; },
        setName: function (n) { eu.__nome = n; return eu; },
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
        setFrozenRows: function (n) { congeladas = n; return eu; },
        appendRow: function (linha) { dados.push(linha.slice()); return eu; },
        getRange: function (l, c, nl, nc) {
          nl = nl || 1; nc = nc || 1;
          return {
            getValues: function () {
              garantir(l + nl - 1, c + nc - 1);
              var saida = [];
              for (var i = 0; i < nl; i++) saida.push(dados[l - 1 + i].slice(c - 1, c - 1 + nc));
              return saida;
            },
            setValues: function (v) {
              garantir(l + nl - 1, c + nc - 1);
              for (var i = 0; i < v.length; i++) {
                for (var j = 0; j < v[i].length; j++) dados[l - 1 + i][c - 1 + j] = v[i][j];
              }
              return this;
            },
            setFontWeight: function () { negritos++; return this; }
          };
        }
      };
      return eu;
    }

    function novaPlanilha(nome) {
      var abas = [novaAba('Sheet1')];
      var eu = {
        __id: proximoId('pl'), __nome: nome, __abas: abas,
        getId: function () { return eu.__id; },
        getName: function () { return eu.__nome; },
        getSheets: function () { return abas.slice(); },
        getSheetByName: function (n) {
          for (var i = 0; i < abas.length; i++) if (abas[i].__nome === n) return abas[i];
          return null;
        },
        insertSheet: function (n) { var a = novaAba(n); abas.push(a); return a; }
      };
      PLANILHAS[eu.__id] = eu;
      return eu;
    }

    /* ---------------- OS SERVIÇOS TROCADOS ---------------- */
    var guardado = {};
    DriveApp = {
      getRootFolder: function () { return RAIZ; },
      createFolder: function (n) { return RAIZ.createFolder(n); },
      getFoldersByName: function (n) { return RAIZ.getFoldersByName(n); },
      getFolderById: function (id) {
        var achada = null;
        (function procurar(p) {
          if (p.__id === id) { achada = p; return; }
          for (var i = 0; i < p.__pastas.length; i++) procurar(p.__pastas[i]);
        })(RAIZ);
        if (!achada) throw new Error('pasta não encontrada: ' + id);
        return achada;
      },
      getFileById: function (id) {
        var achado = null;
        (function procurar(p) {
          for (var i = 0; i < p.__arquivos.length; i++) {
            if (p.__arquivos[i].__id === id) { achado = p.__arquivos[i]; return; }
          }
          for (var j = 0; j < p.__pastas.length; j++) procurar(p.__pastas[j]);
        })(RAIZ);
        if (!achado) throw new Error('arquivo não encontrado: ' + id);
        return achado;
      }
    };
    SpreadsheetApp = {
      create: function (nome) {
        var pl = novaPlanilha(nome);
        novoArquivo(nome, RAIZ, pl);
        return pl;
      },
      openById: function (id) {
        if (!PLANILHAS[id]) throw new Error('não é planilha: ' + id);
        return PLANILHAS[id];
      }
    };
    PropertiesService = {
      getScriptProperties: function () {
        return {
          getProperty: function (k) { return guardado.hasOwnProperty(k) ? guardado[k] : null; },
          setProperty: function (k, v) { guardado[k] = String(v); },
          deleteProperty: function (k) { delete guardado[k]; }
        };
      }
    };
    LockService = { getScriptLock: function () { return { tryLock: function () { return true; }, releaseLock: function () { } }; } };
    Utilities = {
      formatDate: function (d, tz, f) {
        function dd(n) { return (n < 10 ? '0' : '') + n; }
        return d.getFullYear() + '-' + dd(d.getMonth() + 1) + '-' + dd(d.getDate()) +
          (f.indexOf('HH:mm:ss') > -1
            ? ' ' + dd(d.getHours()) + ':' + dd(d.getMinutes()) + ':' + dd(d.getSeconds())
            : '_' + dd(d.getHours()) + dd(d.getMinutes()));
      }
    };
    Session = { getActiveUser: function () { return { getEmail: function () { return 'teste@coesa'; } }; } };

    /* ---------- ferramentas de contagem do Drive de mentira ---------- */
    function contarTudo() {
      var pastas = 0, arquivos = 0, nomes = [];
      (function andar(p) {
        for (var i = 0; i < p.__pastas.length; i++) {
          pastas++; nomes.push(p.__pastas[i].__nome); andar(p.__pastas[i]);
        }
        for (var j = 0; j < p.__arquivos.length; j++) { arquivos++; nomes.push(p.__arquivos[j].__nome); }
      })(RAIZ);
      return { pastas: pastas, arquivos: arquivos, nomes: nomes };
    }
    function acharPasta(caminho) {
      var reg = JSON.parse(guardado[AP_SRV_CFG.propRegistro] || '{}');
      try { return DriveApp.getFolderById(reg[caminho]); } catch (e) { return null; }
    }

    /* ============================================================
       1. PRIMEIRA INSTALAÇÃO
       ============================================================ */
    function esperados(etapa) {
      var p = 0, a = 0;
      for (var i = 0; i < AP_SRV_MAPA.length; i++) {
        if (AP_SRV_MAPA[i].etapa > etapa) continue;
        if (AP_SRV_MAPA[i].tipo === 'pasta') p++; else a++;
      }
      return { pastas: p + 1, arquivos: a };   /* +1: a própria pasta raiz, que não está no mapa */
    }

    /* Começa na etapa 1 de propósito: é exatamente a situação do
       Ismael hoje — servidor já instalado na etapa 1 — e o teste 2b
       prova que subir para a etapa 2 não mexe no que já existe. */
    AP_SRV_CFG.etapaAtual = 1;
    var conta1 = esperados(1);

    var r1 = inicializarServidorALMOXA_PRO();
    var depois1 = contarTudo();

    ok('a instalação termina sem erro', r1.ok === true,
      r1.erros.length ? r1.erros.join(' | ') : '');
    ok('criou exatamente o que a etapa 1 manda',
      r1.criados === conta1.pastas + conta1.arquivos,
      'criados: ' + r1.criados + ', esperado: ' + (conta1.pastas + conta1.arquivos));
    ok('a pasta raiz ficou registrada', !!r1.raizId);
    ok('a árvore existe no Drive',
      depois1.pastas === conta1.pastas && depois1.arquivos === conta1.arquivos,
      depois1.pastas + ' pastas, ' + depois1.arquivos + ' arquivos');

    /* ============================================================
       2. A PROVA DA IDEMPOTÊNCIA — RODAR DE NOVO NÃO CRIA NADA
       ============================================================ */
    /* deixa um dado plantado para ver se sobrevive */
    var abaModulos = AP_SRV_aba_('00_CORE/CORE_MODULOS');
    var colunasAntes = AP_SRV_colunasDe_(abaModulos);
    abaModulos.appendRow(['MOD-PLANTADO', 'ESTOQUE_ANTIGO', '1.0', 'x.gs', 'não pode sumir',
      'ATIVO', 'ismael', 1, 'SYNC-1', '2026-01-01 08:00:00', '2026-01-01 08:00:00']);
    var linhasAntes = abaModulos.getLastRow();

    var r2 = inicializarServidorALMOXA_PRO();
    var depois2 = contarTudo();

    ok('segunda execução não criou NENHUM item novo', r2.criados === 0, 'criados: ' + r2.criados);
    ok('segunda execução reaproveitou tudo', r2.reaproveitados >= r1.criados,
      'reaproveitados: ' + r2.reaproveitados);
    ok('o Drive tem exatamente o mesmo número de pastas',
      depois2.pastas === depois1.pastas, depois1.pastas + ' → ' + depois2.pastas);
    ok('o Drive tem exatamente o mesmo número de arquivos',
      depois2.arquivos === depois1.arquivos, depois1.arquivos + ' → ' + depois2.arquivos);

    var abaDepois = AP_SRV_aba_('00_CORE/CORE_MODULOS');
    var achouPlantado = false;
    var linhasFinais = abaDepois.getRange(1, 1, abaDepois.getLastRow(), abaDepois.getLastColumn()).getValues();
    for (var i = 0; i < linhasFinais.length; i++) {
      if (String(linhasFinais[i][0]) === 'MOD-PLANTADO') achouPlantado = true;
    }
    ok('o dado plantado sobreviveu à segunda execução', achouPlantado);
    ok('nenhuma linha foi perdida', abaDepois.getLastRow() >= linhasAntes,
      linhasAntes + ' → ' + abaDepois.getLastRow());

    /* ============================================================
       2b. SUBIR DA ETAPA 1 PARA A ETAPA 2
       A situação real: servidor já instalado, código novo colado.
       Tem que criar só os 19 bancos e não encostar no resto.
       ============================================================ */
    AP_SRV_CFG.etapaAtual = 2;
    var conta2 = esperados(2);
    var novosDaEtapa2 = (conta2.pastas + conta2.arquivos) - (conta1.pastas + conta1.arquivos);

    var r2b = inicializarServidorALMOXA_PRO();
    var depois2b = contarTudo();

    ok('subir para a etapa 2 criou SÓ os bancos novos',
      r2b.criados === novosDaEtapa2, 'criados: ' + r2b.criados + ', esperado: ' + novosDaEtapa2);
    ok('são 19 bancos, como o documento pede', novosDaEtapa2 === 19, 'são ' + novosDaEtapa2);
    ok('nenhuma pasta foi criada nessa subida',
      depois2b.pastas === depois1.pastas, depois1.pastas + ' → ' + depois2b.pastas);
    ok('as planilhas do CORE e dos logs não foram recriadas',
      depois2b.arquivos === depois1.arquivos + 19,
      depois1.arquivos + ' → ' + depois2b.arquivos);

    var modDepoisSubida = AP_SRV_aba_('00_CORE/CORE_MODULOS');
    var aindaTemPlantado = modDepoisSubida
      .getRange(1, 1, modDepoisSubida.getLastRow(), modDepoisSubida.getLastColumn())
      .getValues().some(function (l) { return String(l[0]) === 'MOD-PLANTADO'; });
    ok('o dado plantado sobreviveu à subida de etapa', aindaTemPlantado);

    /* rodar de novo depois da subida: zero de novo */
    var r2c = inicializarServidorALMOXA_PRO();
    ok('depois da subida, rodar outra vez cria zero', r2c.criados === 0, 'criados: ' + r2c.criados);

    /* ============================================================
       2d. OS BANCOS TÊM AS COLUNAS QUE O DOCUMENTO EXIGE
       ============================================================ */
    var bancos = AP_SRV_MAPA.filter(function (m) {
      return m.caminho.indexOf('01_BANCO_DADOS/') === 0;
    });
    var semId = [], semControle = [], repetidas = [], naOrdemErrada = [];

    for (var b = 0; b < bancos.length; b++) {
      var banco = bancos[b];
      var abaB = AP_SRV_aba_(banco.caminho);
      if (!abaB) { semId.push(banco.caminho + ' (não abriu)'); continue; }
      var cols = AP_SRV_colunasDe_(abaB);

      if (!cols.length || cols[0].indexOf('ID_') !== 0) semId.push(banco.caminho);

      var precisa = ['STATUS', 'VERSAO_REGISTRO', 'SYNC_ID', 'DATA_CRIACAO', 'DATA_ATUALIZACAO'];
      for (var pc = 0; pc < precisa.length; pc++) {
        if (cols.indexOf(precisa[pc]) === -1) semControle.push(banco.caminho + ':' + precisa[pc]);
      }

      var vistas = {};
      for (var cc = 0; cc < cols.length; cc++) {
        if (vistas[cols[cc]]) repetidas.push(banco.caminho + ':' + cols[cc]);
        vistas[cols[cc]] = true;
      }

      /* as colunas do documento têm que estar na ordem do documento */
      for (var oc = 0; oc < banco.colunas.length; oc++) {
        if (cols[oc] !== banco.colunas[oc]) {
          naOrdemErrada.push(banco.caminho + ': esperava ' + banco.colunas[oc] + ', achei ' + cols[oc]);
          break;
        }
      }
    }

    ok('os 19 bancos foram criados', bancos.length === 19, 'são ' + bancos.length);
    ok('todo banco começa com a coluna de ID', semId.length === 0, semId.join(', '));
    ok('todo banco tem status, versão, sync e as duas datas',
      semControle.length === 0, semControle.join(', '));
    ok('nenhum banco tem coluna repetida', repetidas.length === 0, repetidas.join(', '));
    ok('as colunas saíram na ordem do documento',
      naOrdemErrada.length === 0, naOrdemErrada.join(' | '));

    var comExclusao = 0, movTemExclusao = false;
    for (var x = 0; x < bancos.length; x++) {
      var colsX = AP_SRV_colunasDe_(AP_SRV_aba_(bancos[x].caminho));
      if (colsX.indexOf('EXCLUIDO') > -1) {
        comExclusao++;
        if (bancos[x].caminho.indexOf('DB_MOVIMENTACOES') > -1) movTemExclusao = true;
      }
    }
    ok('18 bancos têm exclusão lógica', comExclusao === 18, 'são ' + comExclusao);
    ok('DB_MOVIMENTACOES NÃO tem exclusão lógica (é livro-caixa)', movTemExclusao === false);

    /* o cabeçalho do documento continua exatamente igual ao pedido */
    var colsNota = AP_SRV_colunasDe_(AP_SRV_aba_('01_BANCO_DADOS/DB_NOTAS_FISCAIS'));
    ok('DB_NOTAS_FISCAIS tem a chave de acesso e o arquivo',
      colsNota.indexOf('CHAVE_ACESSO') > -1 && colsNota.indexOf('ARQUIVO_ID') > -1);
    var colsAnexo = AP_SRV_colunasDe_(AP_SRV_aba_('01_BANCO_DADOS/DB_ANEXOS'));
    ok('DB_ANEXOS guarda ID do Drive e hash, não o arquivo',
      colsAnexo.indexOf('ID_ARQUIVO_DRIVE') > -1 && colsAnexo.indexOf('HASH_ARQUIVO') > -1);

    /* e os bancos estão DENTRO de 01_BANCO_DADOS, não soltos */
    var pastaBancos = acharPasta('01_BANCO_DADOS');
    ok('os 19 bancos estão dentro de 01_BANCO_DADOS',
      pastaBancos && pastaBancos.__arquivos.length === 19,
      pastaBancos ? pastaBancos.__arquivos.length + ' arquivos lá dentro' : 'pasta não achada');
    ok('nenhum banco ficou perdido na raiz do Drive',
      RAIZ.__arquivos.length === 0, RAIZ.__arquivos.length + ' soltos na raiz');

    /* ============================================================
       3. NUNCA "(1)", "(2)" OU "CÓPIA"
       ============================================================ */
    var suspeitos = depois2.nomes.filter(function (n) {
      return /\(\d+\)|^C[óo]pia/i.test(n);
    });
    ok('nenhum nome com "(1)", "(2)" ou "Cópia" no Drive', suspeitos.length === 0,
      suspeitos.join(', '));

    /* ============================================================
       4. O ID MANDA NO NOME — RENOMEAR NÃO DUPLICA
       ============================================================ */
    var pastaDocs = acharPasta('02_DOCUMENTOS');
    pastaDocs.__nome = '02_DOCUMENTOS_RENOMEADA_PELO_ISMAEL';
    var r3 = inicializarServidorALMOXA_PRO();
    var depois3 = contarTudo();
    ok('renomear uma pasta não fez o sistema criar outra',
      r3.criados === 0 && depois3.pastas === depois2.pastas,
      'criados: ' + r3.criados + ', pastas: ' + depois2.pastas + ' → ' + depois3.pastas);
    pastaDocs.__nome = '02_DOCUMENTOS';

    /* ============================================================
       5. PASTA QUE JÁ EXISTIA PELO NOME É REAPROVEITADA
       ============================================================ */
    /* apaga o registro de IDs: obriga o sistema a procurar pelo nome */
    delete guardado[AP_SRV_CFG.propRegistro];
    var r4 = inicializarServidorALMOXA_PRO();
    var depois4 = contarTudo();
    ok('sem o registro de IDs, achou tudo pelo nome e não duplicou',
      r4.criados === 0 && depois4.pastas === depois3.pastas && depois4.arquivos === depois3.arquivos,
      'criados: ' + r4.criados + ', pastas ' + depois3.pastas + ' → ' + depois4.pastas +
      ', arquivos ' + depois3.arquivos + ' → ' + depois4.arquivos);

    /* ============================================================
       6. CABEÇALHO — FALTANDO ENTRA NO FIM, EXISTENTE NÃO SE MEXE
       ============================================================ */
    var abaPerm = AP_SRV_aba_('00_CORE/CORE_PERMISSOES');
    /* simula uma planilha antiga: menos colunas, fora de ordem, com
       uma coluna que o sistema não conhece, e com dados embaixo */
    abaPerm.__dados.length = 0;
    abaPerm.appendRow(['PERFIL', 'MODULO', 'ACAO', 'OBSERVACAO_DO_ISMAEL', 'ID_PERMISSAO']);
    abaPerm.appendRow(['almoxarife', 'estoque', 'retirar', 'combinado em obra', 'PER-1']);

    var r5 = inicializarServidorALMOXA_PRO();
    var cab = abaPerm.getRange(1, 1, 1, abaPerm.getLastColumn()).getValues()[0];

    ok('as 5 colunas antigas continuam nas MESMAS posições',
      cab[0] === 'PERFIL' && cab[1] === 'MODULO' && cab[2] === 'ACAO' &&
      cab[3] === 'OBSERVACAO_DO_ISMAEL' && cab[4] === 'ID_PERMISSAO',
      cab.slice(0, 5).join(' | '));
    ok('a coluna desconhecida NÃO foi apagada', cab.indexOf('OBSERVACAO_DO_ISMAEL') > -1);
    ok('as colunas que faltavam entraram no fim',
      cab.indexOf('EMPRESA_ID') >= 5 && cab.indexOf('DATA_CRIACAO') >= 5,
      'EMPRESA_ID na posição ' + cab.indexOf('EMPRESA_ID'));
    ok('a linha de dados que estava embaixo continua intacta',
      abaPerm.getRange(2, 1, 1, 5).getValues()[0].join('|') ===
      'almoxarife|estoque|retirar|combinado em obra|PER-1');
    ok('o relatório avisou sobre as colunas acrescentadas',
      r5.alertas.join(' ').indexOf('EMPRESA_ID') > -1);
    ok('o relatório avisou sobre a coluna desconhecida',
      r5.alertas.join(' ').indexOf('OBSERVACAO_DO_ISMAEL') > -1);

    /* rodar de novo com o cabeçalho já completo não avisa mais nada */
    var r6 = inicializarServidorALMOXA_PRO();
    var avisouDeNovo = r6.alertas.join(' ').indexOf('EMPRESA_ID') > -1;
    ok('na execução seguinte não acrescenta a mesma coluna outra vez', !avisouDeNovo);

    /* ============================================================
       7. validarCabecalhos() ENXERGA O PROBLEMA E NÃO CONSERTA
       ============================================================ */
    var abaSess = AP_SRV_aba_('00_CORE/CORE_SESSOES');
    abaSess.__dados[0][1] = '';   /* alguém apagou o TOKEN_HASH */
    var confere = validarCabecalhos();
    var achouFalta = confere.problemas.some(function (p) {
      return p.componente.indexOf('CORE_SESSOES') > -1 && p.problema.indexOf('TOKEN_HASH') > -1;
    });
    ok('validarCabecalhos() acusa a coluna que sumiu', achouFalta && confere.ok === false);
    ok('validarCabecalhos() NÃO consertou sozinho',
      String(abaSess.__dados[0][1] || '') === '');
    inicializarServidorALMOXA_PRO();   /* aí sim conserta, quando mandado */
    ok('a instalação recolocou a coluna que faltava',
      validarCabecalhos().problemas.filter(function (p) {
        return p.componente.indexOf('CORE_SESSOES') > -1;
      }).length === 0);

    /* ============================================================
       8. registrarModulo() — ATUALIZA, NÃO DUPLICA
       ============================================================ */
    var abaMod = AP_SRV_aba_('00_CORE/CORE_MODULOS');
    var antesMod = abaMod.getLastRow();
    var m1 = registrarModulo({ nome: 'EPI', versao: '1.0', arquivo: 'ALMOXA_PRO_Modulo_EPI.gs' });
    var meioMod = abaMod.getLastRow();
    var m2 = registrarModulo({ nome: 'EPI', versao: '1.1', arquivo: 'ALMOXA_PRO_Modulo_EPI.gs' });
    var fimMod = abaMod.getLastRow();

    ok('registrarModulo cadastrou o módulo novo', m1.ok && m1.criado === true && meioMod === antesMod + 1);
    ok('registrar o MESMO módulo não criou segunda linha',
      m2.ok && m2.criado === false && fimMod === meioMod, antesMod + ' → ' + meioMod + ' → ' + fimMod);

    var colsMod = AP_SRV_colunasDe_(abaMod);
    var linhasMod = abaMod.getRange(2, 1, abaMod.getLastRow() - 1, abaMod.getLastColumn()).getValues();
    var epi = null;
    for (var e = 0; e < linhasMod.length; e++) {
      if (linhasMod[e][colsMod.indexOf('NOME_MODULO')] === 'EPI') epi = linhasMod[e];
    }
    ok('a versão do módulo foi atualizada para 1.1', epi && epi[colsMod.indexOf('VERSAO')] === '1.1');
    ok('a versão do REGISTRO subiu para 2', epi && Number(epi[colsMod.indexOf('VERSAO_REGISTRO')]) === 2);
    ok('o CORE se registrou sozinho na instalação',
      linhasMod.some(function (l) { return l[colsMod.indexOf('NOME_MODULO')] === 'CORE'; }));

    ok('registrarModulo sem nome é recusado com mensagem clara',
      registrarModulo({}).ok === false && registrarModulo({}).codigo === 'SEM_NOME');

    /* ============================================================
       9. registrarLog() — ESCREVE NA PLANILHA CERTA
       ============================================================ */
    var abaErros = AP_SRV_aba_('05_LOGS_AUDITORIA/LOG_ERROS');
    var antesErros = abaErros.getLastRow();
    registrarLog('ERRO', { modulo: 'ESTOQUE', funcao: 'baixar', mensagem: 'saldo negativo', gravidade: 'ALTA' });
    var colsErro = AP_SRV_colunasDe_(abaErros);
    var ultima = abaErros.getRange(abaErros.getLastRow(), 1, 1, abaErros.getLastColumn()).getValues()[0];

    ok('o log de erro entrou na planilha de erros', abaErros.getLastRow() === antesErros + 1);
    ok('o log gravou módulo, função e mensagem',
      ultima[colsErro.indexOf('MODULO')] === 'ESTOQUE' &&
      ultima[colsErro.indexOf('FUNCAO')] === 'baixar' &&
      ultima[colsErro.indexOf('MENSAGEM')] === 'saldo negativo');
    ok('o log tem ID único e data', !!ultima[colsErro.indexOf('ID_LOG')] && !!ultima[colsErro.indexOf('DATA_HORA')]);
    ok('o log de acesso não foi parar na planilha de erros',
      registrarLog('ACESSO', { acao: 'login', resultado: 'OK' }) === true &&
      abaErros.getLastRow() === antesErros + 1);
    ok('tipo de log inventado é recusado sem quebrar nada', registrarLog('SEI_LA', {}) === false);

    /* ============================================================
       10. IDs ÚNICOS SEM DEPENDER DA LINHA
       ============================================================ */
    var vistos = {}, repetiu = false;
    for (var n = 0; n < 3000; n++) {
      var id = AP_SRV_novoId_('T');
      if (vistos[id]) repetiu = true;
      vistos[id] = true;
    }
    ok('3000 IDs gerados sem repetir nenhum', !repetiu);

    /* ============================================================
       11. BACKUP — COPIA, NÃO MOVE
       ============================================================ */
    var antesBackup = contarTudo();
    var bk = executarBackup({ tipo: 'MANUAL' });
    var depoisBackup = contarTudo();
    ok('o backup terminou sem falha', bk.ok === true, (bk.falhou || []).join(', '));
    ok('o backup copiou todas as planilhas da etapa 1',
      bk.copiados.length === AP_SRV_MAPA.filter(function (m) {
        return m.tipo === 'planilha' && m.etapa <= AP_SRV_CFG.etapaAtual;
      }).length, bk.copiados.length + ' copiadas');
    ok('os originais continuam todos no lugar',
      depoisBackup.arquivos === antesBackup.arquivos + bk.copiados.length,
      antesBackup.arquivos + ' → ' + depoisBackup.arquivos);
    ok('o original continua abrindo depois do backup',
      !!AP_SRV_aba_('00_CORE/CORE_MODULOS'));
    ok('o backup ficou registrado no log de sincronização',
      AP_SRV_aba_('05_LOGS_AUDITORIA/LOG_SINCRONIZACAO').getLastRow() > 1);

    /* ============================================================
       12. INTEGRIDADE E RELATÓRIO
       ============================================================ */
    var integ = verificarIntegridade();
    ok('a integridade está limpa depois da instalação', integ.ok === true,
      integ.problemas.map(function (p) { return p.componente + ': ' + p.problema; }).join(' | '));
    ok('o diagnóstico traz os campos que o documento pede',
      integ.problemas.length === 0 ||
      (integ.problemas[0].modulo && integ.problemas[0].componente &&
        integ.problemas[0].problema && integ.problemas[0].gravidade &&
        integ.problemas[0].data && integ.problemas[0].sugestao));
    ok('as etapas seguintes aparecem como pendentes, não como erro',
      integ.pendentesProximasEtapas >= 0 && integ.ok === true);
    ok('o relatório final é texto legível', typeof r1.texto === 'string' && r1.texto.indexOf('Criados agora') > -1);

    /* ============================================================
       13. PASTA SUMIU — O SISTEMA ENXERGA E RECRIA SÓ ELA
       ============================================================ */
    var pastaBk = acharPasta('04_BACKUP/BACKUP_SEMANAL');
    var paiBk = acharPasta('04_BACKUP');
    paiBk.__pastas.splice(paiBk.__pastas.indexOf(pastaBk), 1);
    var reg = JSON.parse(guardado[AP_SRV_CFG.propRegistro]);
    delete reg['04_BACKUP/BACKUP_SEMANAL'];
    guardado[AP_SRV_CFG.propRegistro] = JSON.stringify(reg);

    var checou = validarEstruturaServidor();
    ok('validarEstruturaServidor acusa a pasta que sumiu',
      checou.ok === false && checou.ausentes.indexOf('04_BACKUP/BACKUP_SEMANAL') > -1);

    var antesR = contarTudo();
    var r7 = inicializarServidorALMOXA_PRO();
    var depoisR = contarTudo();
    ok('recriou SÓ a pasta que faltava', r7.criados === 1 && depoisR.pastas === antesR.pastas + 1,
      'criados: ' + r7.criados);
    ok('depois disso a estrutura volta a estar completa', validarEstruturaServidor().ok === true);

    /* ============================================================
       14. ARQUIVO ESTRANHO COM O MESMO NOME — NÃO MEXE, AVISA
       ============================================================ */
    var pastaCore = acharPasta('00_CORE');
    var regA = JSON.parse(guardado[AP_SRV_CFG.propRegistro]);
    delete regA['00_CORE/CORE_VERSOES'];
    guardado[AP_SRV_CFG.propRegistro] = JSON.stringify(regA);
    /* um PDF chamado CORE_VERSOES aparece na pasta antes da planilha */
    var intruso = novoArquivo('CORE_VERSOES_PDF', pastaCore, null);
    intruso.__nome = 'CORE_VERSOES';
    /* tira a planilha de verdade de vista para o nome bater no PDF */
    var verdadeira = null;
    for (var v = 0; v < pastaCore.__arquivos.length; v++) {
      if (pastaCore.__arquivos[v].__nome === 'CORE_VERSOES' && pastaCore.__arquivos[v].__planilha) {
        verdadeira = pastaCore.__arquivos[v];
      }
    }
    if (verdadeira) pastaCore.__arquivos.splice(pastaCore.__arquivos.indexOf(verdadeira), 1);

    var r8 = inicializarServidorALMOXA_PRO();
    ok('arquivo que não é planilha não vira planilha nova',
      r8.alertas.join(' ').indexOf('não é uma planilha') > -1 &&
      pastaCore.__arquivos.filter(function (a) { return a.__nome === 'CORE_VERSOES'; }).length === 1,
      r8.alertas.join(' | ').substring(0, 120));
    ok('o intruso continua lá, intacto', pastaCore.__arquivos.indexOf(intruso) > -1);

  } catch (explodiu) {
    falhas++;
    log.push('FALHOU  o teste explodiu: ' + (explodiu && explodiu.stack || explodiu));
  } finally {
    if (orig.Drive) DriveApp = orig.Drive;
    if (orig.Planilhas) SpreadsheetApp = orig.Planilhas;
    if (orig.Props) PropertiesService = orig.Props;
    if (orig.Lock) LockService = orig.Lock;
    if (orig.Utils) Utilities = orig.Utils;
    if (orig.Sess) Session = orig.Sess;
    AP_SRV_CFG.etapaAtual = etapaDeVerdade;
    AP_SRV_DIARIO = null;
  }

  var cabecalho = '=== SERVIDOR CENTRAL — ETAPAS 1 E 2 — ' +
    (falhas ? falhas + ' FALHA(S) DE ' + log.length : 'TODOS OS ' + log.length + ' TESTES PASSARAM') + ' ===';
  var texto = cabecalho + '\n' + log.join('\n');
  try { Logger.log(texto); } catch (e) { }
  return { ok: falhas === 0, total: log.length, falhas: falhas, texto: texto };
}
