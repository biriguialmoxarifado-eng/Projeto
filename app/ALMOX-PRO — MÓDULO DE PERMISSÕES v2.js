/**
 * ALMOX-PRO — MÓDULO DE PERMISSÕES        ·  código de busca: [PERM-GS]
 *
 * O QUE FAZ
 *   Dá backend à tela "Perfis e Permissões", que já existe no
 *   index.html e hoje abre em erro por falta deste arquivo.
 *   Guarda perfis, permissões por AÇÃO e alçadas de aprovação
 *   em abas próprias, e responde às oito ações que a tela chama.
 *
 * O QUE NÃO FAZ
 *   Não mexe em usuário, sessão, autenticação nem em nenhuma aba
 *   que já existia. Não renomeia coluna, não apaga registro.
 *   Não cria roteador, não cria ponte, não cria login.
 *
 * ABAS QUE CRIA (e só estas)
 *   ALMOXA_PERFIS        um perfil por linha
 *   ALMOXA_PERMISSOES    uma AÇÃO por linha, por perfil
 *   ALMOXA_ALCADAS       uma regra de aprovação por linha
 *   ALMOXA_FUNCOES       uma função (com descrição) por linha
 *
 * INSTALAÇÃO
 *   1. Cole este arquivo num arquivo novo do Apps Script.
 *   2. Rode  AP_PERMISSOES_instalar   (cria as abas e copia o
 *      acesso que cada perfil tem HOJE, para ninguém perder nada).
 *   3. Publique nova versão.
 *   4. Abra Administração > Permissões.
 *
 * FASE DE TRANSIÇÃO
 *   Enquanto AP_PERMISSOES_estaValendo() for false, o sistema
 *   continua obedecendo às listas de perfil do index.html: você
 *   configura à vontade sem risco de trancar ninguém para fora.
 *   Quando a configuração estiver do seu gosto, rode
 *   AP_PERMISSOES_VALER(). Para voltar atrás, AP_PERMISSOES_SOMBRA().
 *
 * ONDE PROCURAR ERRO
 *   SEM_PLANILHA      não achou a planilha do sistema
 *   SEM_ABA           rode AP_PERMISSOES_instalar
 *   PERFIL_NAO_EXISTE o id do perfil não está na aba ALMOXA_PERFIS
 *   ACAO_DESCONHECIDA a tela pediu uma ação que este arquivo não tem
 *   FAIXA_SOBREPOSTA  a alçada nova cobre valor que outra já cobre
 *
 * Todos os nomes deste arquivo começam com APERM_ ou
 * AP_PERMISSOES_, para não colidir com nada do Core.
 */

var APERM_ABAS = {
  perfis: 'ALMOXA_PERFIS',
  permissoes: 'ALMOXA_PERMISSOES',
  alcadas: 'ALMOXA_ALCADAS'
};

var APERM_COLUNAS = {
  perfis: ['id', 'nome', 'descricao', 'ativo', 'sistema', 'criadoEm', 'criadoPor', 'observacao'],
  /* escopo, condicao e limite já nascem aqui: as etapas seguintes só
     precisam preencher, sem mexer de novo na estrutura da aba. */
  permissoes: ['id', 'perfil', 'modulo', 'tela', 'acao', 'permitido',
               'escopo', 'condicao', 'limite', 'descricao',
               'atualizadoEm', 'atualizadoPor'],
  alcadas: ['id', 'nome', 'valorMinimo', 'valorMaximo', 'perfilAprovador',
            'categoria', 'obra', 'modulo', 'aprovadores', 'ativo',
            'criadoEm', 'observacao']
};

/** Perfis que nunca perdem acesso — a porta de emergência. */
var APERM_SEMPRE_TOTAL = ['ti'];

/** Perfis que a tela não deixa apagar. */
var APERM_DO_SISTEMA = ['admin', 'ti', 'publico'];

var APERM_PROP_MODO = 'ALMOXA_PERMISSOES_MODO';


/* ============================================================
   1. PLANILHA E ABAS — nada aqui toca em aba de outro módulo
   ============================================================ */

function APERM_planilha_() {
  /* usa a planilha que o Core já usa, se o Core estiver presente */
  try {
    if (typeof AP_Config_getSpreadsheet_ === 'function') {
      var ss = AP_Config_getSpreadsheet_();
      if (ss) return ss;
    }
  } catch (e) {}
  var ativa = SpreadsheetApp.getActive();
  if (ativa) return ativa;
  throw new Error('SEM_PLANILHA');
}

function APERM_aba_(qual, criarSeFaltar) {
  var ss = APERM_planilha_();
  var nome = APERM_ABAS[qual];
  var aba = ss.getSheetByName(nome);
  if (!aba) {
    if (!criarSeFaltar) return null;
    aba = ss.insertSheet(nome);
    aba.getRange(1, 1, 1, APERM_COLUNAS[qual].length).setValues([APERM_COLUNAS[qual]]);
    aba.setFrozenRows(1);
    return aba;
  }
  /* aba já existia: só ACRESCENTA coluna que falte, no fim */
  var largura = Math.max(1, aba.getLastColumn());
  var cab = aba.getRange(1, 1, 1, largura).getValues()[0].map(function (c) {
    return String(c).trim();
  });
  var faltam = APERM_COLUNAS[qual].filter(function (c) { return cab.indexOf(c) === -1; });
  if (faltam.length) {
    aba.getRange(1, cab.length + 1, 1, faltam.length).setValues([faltam]);
  }
  return aba;
}

function APERM_linhas_(qual) {
  var aba = APERM_aba_(qual, false);
  if (!aba) return null;
  var ultima = aba.getLastRow();
  if (ultima < 2) return [];
  var largura = Math.max(1, aba.getLastColumn());
  var tudo = aba.getRange(1, 1, ultima, largura).getValues();
  var cab = tudo[0].map(function (c) { return String(c).trim(); });
  return tudo.slice(1).map(function (linha, i) {
    var o = { __linha: i + 2 };
    cab.forEach(function (c, k) { if (c) o[c] = linha[k]; });
    return o;
  }).filter(function (o) { return String(o.id || '').trim() !== ''; });
}

function APERM_escrever_(qual, registro) {
  var aba = APERM_aba_(qual, true);
  var largura = Math.max(1, aba.getLastColumn());
  var cab = aba.getRange(1, 1, 1, largura).getValues()[0].map(function (c) {
    return String(c).trim();
  });
  var linha = cab.map(function (c) {
    return registro[c] === undefined || registro[c] === null ? '' : registro[c];
  });
  if (registro.__linha) {
    aba.getRange(registro.__linha, 1, 1, linha.length).setValues([linha]);
    return registro.__linha;
  }
  aba.appendRow(linha);
  return aba.getLastRow();
}

function APERM_id_(prefixo) {
  return prefixo + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
}

function APERM_agora_() {
  return Utilities.formatDate(new Date(), 'America/Manaus', "yyyy-MM-dd'T'HH:mm:ss");
}

function APERM_sim_(v) {
  return v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1' || v === 'SIM';
}

function APERM_texto_(v) {
  return String(v === undefined || v === null ? '' : v).trim();
}

function APERM_ok_(dados, mensagem) {
  return { ok: true, codigo: 'OK', mensagem: mensagem || '', dados: dados === undefined ? null : dados };
}

function APERM_erro_(codigo, mensagem) {
  return { ok: false, codigo: codigo, mensagem: mensagem, dados: null };
}


/* ============================================================
   2. O CATÁLOGO — as ações que existem no sistema
   ------------------------------------------------------------
   Gerado a partir do ADM_MAPA do index.html, para os dois não
   divergirem. Se você acrescentar módulo ou ação lá, acrescente
   aqui também e rode AP_PERMISSOES_conferir.
   ============================================================ */

var APERM_CATALOGO = [
  ["dashboard", "Painel e indicadores", [
    ["aprovar-preconta", "Aprovação de pré-conta", ["visualizar", "criar", "editar", "cancelar", "aprovar", "reprovar", "verCusto", "imprimir"]],
    ["assistente", "Assistente ALMOXA", ["visualizar", "criar", "imprimir"]],
    ["calendario", "Calendário", ["visualizar", "criar"]],
    ["central-mestre", "Central do Mestre de Obra", ["visualizar"]],
    ["dashboard", "Painel de Informações", ["visualizar", "filtrar", "criar"]],
    ["doutor", "Doutor do Sistema", ["visualizar"]],
    ["indicadores", "Indicadores da Obra", ["visualizar", "criar"]],
    ["mural", "Mural", ["visualizar", "criar", "editar", "excluir"]]
  ]],
  ["lojinha", "Loja e catálogo", [
    ["loja", "Loja / Catálogo", ["visualizar", "filtrar", "verCusto"]],
    ["painel-config", "Configuração do Painel Interativo", ["visualizar", "editar", "excluir"]]
  ]],
  ["solicitacoes", "Solicitações", [
    ["solicitacao-nova", "Nova Solicitação", ["visualizar", "criar"]],
    ["solicitacoes", "Minhas Solicitações", ["visualizar", "criar"]]
  ]],
  ["reservas", "Reservas, saídas e retiradas", [
    ["reserva", "Detalhes da Reserva", ["visualizar", "cancelar", "aprovar", "reprovar"]],
    ["reserva-nova", "Nova Solicitação", ["visualizar", "criar", "excluir", "verCusto"]],
    ["reservas", "Reservas", ["visualizar", "filtrar", "criar", "exportar"]],
    ["reservas-calendario", "Calendário de Reservas", ["visualizar", "criar"]],
    ["retirada", "Registrar Retirada", ["visualizar", "retirar"]],
    ["saidas", "Saídas e Retiradas", ["visualizar"]]
  ]],
  ["aprovacoes", "Aprovações", [
    ["aprovacoes", "Aprovações", ["visualizar", "aprovar", "reprovar"]],
    ["aprovar", "Solicitação para aprovar", ["visualizar", "aprovar", "reprovar"]],
    ["historico-aprovacoes", "Histórico de Aprovações", ["visualizar"]],
    ["linkflow", "Links de Aprovação", ["visualizar", "criar", "editar", "excluir", "aprovar", "reprovar", "confirmar", "autenticar", "imprimir"]]
  ]],
  ["estoque", "Estoque e cadastros", [
    ["ajustes", "Ajustes de Estoque", ["visualizar", "filtrar", "criar", "editar", "excluir", "verCusto", "imprimir"]],
    ["categorias", "Categorias", ["visualizar", "filtrar", "criar", "editar", "excluir"]],
    ["entradas", "Entradas", ["visualizar", "criar"]],
    ["estoque", "Estoque Geral", ["visualizar", "filtrar", "ajustar", "exportar"]],
    ["estoque-item", "Detalhes do Item", ["visualizar", "imprimir"]],
    ["etiquetas", "Etiquetas", ["visualizar", "imprimir"]],
    ["ferramentas-devolucao", "Devolução de ferramentas", ["visualizar"]],
    ["ferramentas-uso", "Ferramentas em Uso", ["visualizar"]],
    ["fornecedores", "Fornecedores", ["visualizar", "criar", "editar"]],
    ["itens", "Cadastro Central de Itens", ["visualizar", "filtrar", "criar", "editar", "excluir", "exportar"]],
    ["localizacao", "Localização Física", ["visualizar", "criar", "editar", "excluir"]],
    ["mapa-3d", "Mapeamento 3D", ["visualizar", "criar", "editar", "imprimir"]],
    ["movimentacoes", "Movimentações", ["visualizar", "exportar"]],
    ["rastreabilidade", "Rastreabilidade", ["visualizar"]],
    ["sem-localizacao", "Itens sem Localização", ["visualizar", "criar"]],
    ["transferencias", "Transferências de Estoque", ["visualizar"]]
  ]],
  ["inventario", "Inventário", [
    ["inventario", "Inventários", ["visualizar", "criar"]],
    ["inventario-contagem", "Contagem de Inventário", ["visualizar", "criar", "editar"]],
    ["inventario-divergencias", "Divergências de Inventário", ["visualizar", "exportar"]],
    ["inventario-relatorio", "Relatório de Inventário", ["visualizar", "exportar"]],
    ["inventario-sugestoes", "Inventários sugeridos", ["visualizar"]]
  ]],
  ["nf", "Notas fiscais", [
    ["nf", "Notas Fiscais de Entrada", ["visualizar", "criar"]],
    ["nf-conferencia", "Conferência de Notas", ["visualizar"]],
    ["nf-divergencias", "Divergências de Nota", ["visualizar", "registrarEntrada", "imprimir"]],
    ["nf-historico", "Histórico de Notas Fiscais", ["visualizar"]],
    ["nf-importar", "Importar Nota Fiscal", ["visualizar"]],
    ["nf-nova", "Nova Entrada de NF", ["visualizar", "criar", "verCusto", "administrar"]]
  ]],
  ["compras", "Compras", [
    ["compras", "Compras", ["visualizar", "criar"]],
    ["historico-precos", "Histórico de Preços", ["visualizar", "criar"]],
    ["orcamentos", "Orçamentos", ["visualizar"]],
    ["precompras", "Pedidos de Compra", ["visualizar", "aprovar", "reprovar"]],
    ["preconta", "Pré-Conta de Compras", ["visualizar", "editar"]]
  ]],
  ["epi", "EPI, uniformes e segurança", [
    ["epi", "EPI's e Uniformes", ["visualizar", "editar", "imprimir"]],
    ["epi-catalogo", "Catálogo de EPI", ["visualizar", "criar"]],
    ["epi-fichas", "Fichas de EPI Ativas", ["visualizar", "exportar"]],
    ["epi-retiradas", "Retiradas Agendadas", ["visualizar", "criar", "cancelar", "confirmar"]],
    ["epi-solicitacoes", "Solicitações de EPI", ["visualizar"]],
    ["epi-vencimentos", "Vencimentos de EPI", ["visualizar"]],
    ["kits", "Kits por função", ["visualizar", "criar", "editar"]],
    ["kits-cadastro", "Kits", ["visualizar", "criar", "editar", "excluir"]],
    ["painel-seguranca", "Painel de Segurança", ["visualizar"]],
    ["precadastros", "Pré-cadastros", ["visualizar", "criar", "editar", "reprovar", "confirmar"]]
  ]],
  ["ferramentas", "Ferramentas", [
    ["ferramentas", "Ferramentas", ["visualizar", "criar", "editar"]],
    ["ferramentas-historico", "Histórico de Ferramentas", ["visualizar"]],
    ["ferramentas-manutencao", "Manutenção de Ferramentas", ["visualizar"]],
    ["ferramentas-retiradas", "Retiradas de Ferramentas", ["visualizar", "criar"]]
  ]],
  ["patrimonio", "Patrimônio", [
    ["patrimonio", "Patrimônio", ["visualizar", "criar", "editar", "excluir", "imprimir"]]
  ]],
  ["obras", "Obras, projetos e centros", [
    ["centros", "Centros de Custo", ["visualizar", "criar", "editar", "excluir", "verCusto"]],
    ["obras", "Obras e Projetos", ["visualizar", "criar"]],
    ["projeto", "Projeto", ["visualizar", "criar"]],
    ["projetos", "Projetos", ["visualizar", "criar"]]
  ]],
  ["ocorrencias", "Ocorrências", [
    ["mapa", "Mapa da Obra", ["visualizar"]],
    ["ocorrencia", "Detalhes da Ocorrência", ["visualizar", "criar"]],
    ["ocorrencias", "Ocorrências", ["visualizar", "filtrar", "criar"]]
  ]],
  ["tarefas", "Tarefas e stand-by", [
    ["tarefas", "Tarefas em andamento", ["visualizar"]]
  ]],
  ["relatorios", "Relatórios", [
    ["relatorios", "Central de Relatórios", ["visualizar", "filtrar"]],
    ["relatorios-gerados", "Relatórios Gerados", ["visualizar"]]
  ]],
  ["usuarios", "Usuários, crachás e acessos", [
    ["admin", "Painel do Administrador", ["visualizar"]],
    ["crachas", "Crachás e Acesso", ["visualizar", "criar", "editar", "excluir", "imprimir"]],
    ["credenciais", "Identidade e Credenciais", ["visualizar", "criar", "editar", "excluir", "registrarSaida", "administrar"]],
    ["usuarios", "Usuários e Perfis", ["visualizar", "criar", "editar"]]
  ]],
  ["permissoes", "Perfis e permissões", [
    ["admin-alcadas", "Alçadas de Aprovação", ["visualizar", "pesquisar", "filtrar", "criar", "exportar"]],
    ["admin-funcoes", "Funções e descrições", ["visualizar", "filtrar", "criar", "editar", "excluir", "aprovar", "reprovar", "verCusto", "exportar", "imprimir"]],
    ["admin-permissoes", "Perfis e Permissões", ["visualizar", "criar", "editar"]],
    ["permissoes", "Permissões", ["visualizar", "exportar"]]
  ]],
  ["auditoria", "Auditoria e rastreio", [
    ["auditoria", "Log de Auditoria", ["visualizar", "exportar"]],
    ["cracha-acessos", "Log de Acessos", ["visualizar", "editar", "ajustar", "verCusto"]]
  ]],
  ["automacao", "Automação e avisos", [
    ["automacao", "Links & Automação", ["visualizar", "criar", "editar"]],
    ["automacao-canais", "Canais e Destinatários", ["visualizar", "criar", "excluir", "verCusto"]],
    ["automacao-historico", "Histórico de Envios", ["visualizar"]],
    ["automacao-regras", "Regras de automação", ["visualizar", "criar", "editar"]],
    ["envios", "Envios e Links", ["visualizar", "verCusto"]]
  ]],
  ["configuracoes", "Configurações do sistema", [
    ["aprovadores", "Aprovadores e E-mail", ["visualizar", "criar"]],
    ["backup", "Backup e Sincronização", ["visualizar"]],
    ["config", "Parâmetros do Sistema", ["visualizar", "verCusto"]],
    ["config-inicial", "Configuração inicial", ["visualizar", "criar"]],
    ["config-loja", "Configuração da Loja", ["visualizar", "filtrar", "criar", "editar"]],
    ["config-sku", "Identificação de Itens", ["visualizar", "editar"]],
    ["dados", "Dados do sistema", ["visualizar", "criar"]],
    ["integracao-core", "Integração com o Core", ["visualizar", "criar", "editar", "excluir", "verCusto"]],
    ["integracoes", "Integrações", ["visualizar"]],
    ["manutencao", "Manutenção e Versões", ["visualizar", "criar", "administrar"]],
    ["painel-imagens", "Imagens do Carrossel", ["visualizar", "filtrar", "criar", "editar"]]
  ]],
  ["backup", "Backup e armazenamento", [
    ["armazenamento", "Armazenamento Local", ["visualizar", "criar", "exportar"]]
  ]],
  ["pessoal", "Minha conta e consultas", [
    ["consulta", "Consulta de Estoque", ["visualizar", "editar"]],
    ["link", "Solicitação", ["visualizar", "aprovar", "reprovar"]],
    ["notificacoes", "Centro de Notificações", ["visualizar"]],
    ["notificacoes-prefs", "Preferências de Notificação", ["visualizar"]],
    ["perfil", "Meu Perfil", ["visualizar", "criar"]],
    ["tela-principal", "Tela principal", ["visualizar"]]
  ]]
];
function APERM_totalDeAcoes_() {
  var t = 0;
  APERM_CATALOGO.forEach(function (m) {
    m[2].forEach(function (tela) { t += tela[2].length; });
  });
  return t;
}

function APERM_acaoExiste_(modulo, tela, acao) {
  var m = APERM_CATALOGO.filter(function (x) { return x[0] === modulo; })[0];
  if (!m) return false;
  var t = m[2].filter(function (x) { return String(x[0]) === String(tela || ''); })[0];
  if (!t) return false;
  return t[2].indexOf(acao) > -1;
}


/* ============================================================
   3. INSTALAÇÃO — copia o acesso que cada perfil tem HOJE
   ============================================================ */

var APERM_PERFIS_DE_HOJE = [
  ["admin","Administrador","*"],
  ["gestor","Gestor",["dashboard","mural","indicadores","estoque","consulta","movimentacoes","reservas","reserva","aprovacoes","aprovar","historico-aprovacoes","reservas-calendario","solicitacoes","compras","precompras","preconta","aprovar-preconta","orcamentos","fornecedores","historico-precos","relatorios","relatorios-gerados","auditoria","rastreabilidade","obras","projetos","centros","ocorrencias","ocorrencia","epi","epi-vencimentos","ferramentas","nf","perfil","notificacoes"]],
  ["almoxarife","Almoxarife",["dashboard","mural","estoque","itens","consulta","movimentacoes","entradas","saidas","inventario","inventario-contagem","inventario-relatorio","localizacao","sem-localizacao","mapa-3d","etiquetas","reservas","reserva","reserva-nova","retirada","reservas-calendario","aprovacoes","aprovar","nf","nf-nova","nf-conferencia","nf-divergencias","nf-importar","loja","solicitacoes","epi","epi-catalogo","epi-fichas","epi-vencimentos","epi-solicitacoes","kits","kits-cadastro","ferramentas","ferramentas-uso","ferramentas-devolucao","ferramentas-retiradas","ferramentas-manutencao","ferramentas-historico","compras","precompras","preconta","aprovar-preconta","fornecedores","historico-precos","ocorrencias","ocorrencia","crachas","cracha-acessos","relatorios","obras","perfil","notificacoes","credenciais","armazenamento"]],
  ["mestre","Mestre de Obras",["dashboard","mural","loja","solicitacoes","reservas","reserva","retirada","aprovacoes","aprovar","aprovar-preconta","consulta","estoque","epi","epi-fichas","epi-vencimentos","ferramentas","ferramentas-uso","ocorrencias","ocorrencia","obras","projetos","relatorios","perfil","notificacoes"]],
  ["seguranca","Técnico de Segurança",["dashboard","mural","epi","epi-catalogo","epi-fichas","epi-vencimentos","epi-solicitacoes","kits","kits-cadastro","painel-seguranca","aprovacoes","aprovar","ocorrencias","ocorrencia","consulta","ferramentas","perfil","notificacoes"]],
  ["colaborador","Colaborador",["dashboard","mural","loja","solicitacoes","reservas","reserva","epi","epi-fichas","consulta","ocorrencias","perfil","notificacoes"]],
  ["auditor","Auditor",["dashboard","auditoria","rastreabilidade","relatorios","relatorios-gerados","estoque","movimentacoes","consulta","reservas","nf","compras","preconta","historico-precos","fornecedores","ocorrencias","ferramentas","inventario-relatorio","perfil","notificacoes"]],
  ["comprador","Comprador",["dashboard","compras","precompras","preconta","aprovar-preconta","orcamentos","historico-precos","fornecedores","estoque","consulta","itens","nf","nf-nova","relatorios","obras","perfil","notificacoes"]],
  ["ti","TI","*"],
  ["publico","Modo público",["dashboard","mural","loja","consulta","estoque","reserva-nova","epi-catalogo","kits","aprovar-preconta"]]
];
function AP_PERMISSOES_instalar() {
  var relato = [];

  ['perfis', 'permissoes', 'alcadas', 'funcoes'].forEach(function (qual) {
    var tinha = !!APERM_aba_(qual, false);
    APERM_aba_(qual, true);
    relato.push((tinha ? 'aba já existia: ' : 'aba criada: ') + APERM_ABAS[qual]);
  });

  var perfisAgora = APERM_linhas_('perfis') || [];
  var jaTem = {};
  perfisAgora.forEach(function (p) { jaTem[APERM_texto_(p.id)] = true; });

  var criados = 0;
  APERM_PERFIS_DE_HOJE.forEach(function (p) {
    if (jaTem[p[0]]) return;
    APERM_escrever_('perfis', {
      id: p[0],
      nome: p[1],
      descricao: '',
      ativo: true,
      sistema: APERM_DO_SISTEMA.indexOf(p[0]) > -1,
      criadoEm: APERM_agora_(),
      criadoPor: 'instalação',
      observacao: 'copiado do perfil que já existia no sistema'
    });
    criados++;
  });
  relato.push(criados + ' perfil(is) criado(s); ' + perfisAgora.length + ' já estavam lá');

  var regras = APERM_linhas_('permissoes') || [];
  var chaves = {};
  regras.forEach(function (r) {
    chaves[APERM_texto_(r.perfil) + '|' + APERM_texto_(r.modulo) + '|' + APERM_texto_(r.tela) + '|' + APERM_texto_(r.acao)] = true;
  });

  var novas = [];
  var agora = APERM_agora_();
  APERM_PERFIS_DE_HOJE.forEach(function (p) {
    var perfil = p[0];
    var telasDeHoje = p[2];
    APERM_CATALOGO.forEach(function (m) {
      m[2].forEach(function (tela) {
        var temHoje = telasDeHoje === '*' || telasDeHoje.indexOf(tela[0]) > -1;
        if (!temHoje) return;
        tela[2].forEach(function (acao) {
          var chave = perfil + '|' + m[0] + '|' + tela[0] + '|' + acao;
          if (chaves[chave]) return;
          chaves[chave] = true;
          novas.push({
            id: APERM_id_('PR'),
            perfil: perfil,
            modulo: m[0],
            tela: tela[0],
            acao: acao,
            permitido: true,
            escopo: '',
            condicao: '',
            limite: '',
            descricao: 'acesso que este perfil já tinha antes da configuração',
            atualizadoEm: agora,
            atualizadoPor: 'instalação'
          });
        });
      });
    });
  });

  if (novas.length) {
    var aba = APERM_aba_('permissoes', true);
    var cab = aba.getRange(1, 1, 1, Math.max(1, aba.getLastColumn())).getValues()[0]
      .map(function (c) { return String(c).trim(); });
    var bloco = novas.map(function (r) {
      return cab.map(function (c) { return r[c] === undefined ? '' : r[c]; });
    });
    aba.getRange(aba.getLastRow() + 1, 1, bloco.length, cab.length).setValues(bloco);
  }
  relato.push(novas.length + ' permissão(ões) gravada(s), espelhando o acesso de hoje');

  var orfas = (APERM_linhas_('permissoes') || []).filter(function (r) {
    return !APERM_acaoExiste_(APERM_texto_(r.modulo), APERM_texto_(r.tela), APERM_texto_(r.acao));
  });
  if (orfas.length) {
    relato.push('');
    relato.push('ATENÇÃO: ' + orfas.length + ' regra(s) não batem com o catálogo atual.');
    relato.push('Isso acontece quando o catálogo cresceu (telas novas entraram).');
    relato.push('Rode AP_PERMISSOES_limparOrfas() para tirá-las — nada mais é tocado.');
  }

  var modo = APERM_modo_();
  relato.push('');
  relato.push('MODO ATUAL: ' + modo.toUpperCase());
  if (modo === 'sombra') {
    relato.push('Em "sombra" o sistema ainda obedece às listas do index.html.');
    relato.push('Configure à vontade. Quando estiver do seu gosto, rode');
    relato.push('AP_PERMISSOES_VALER() e publique nova versão.');
  }
  relato.push('');
  relato.push('Catálogo: ' + APERM_CATALOGO.length + ' módulos, ' + APERM_totalDeAcoes_() + ' ações.');
  relato.push('FALTA PUBLICAR: Implantar > Gerenciar implantações > lápis >');
  relato.push('Versão: Nova versão > Implantar.');

  return APERM_LOG_(relato);
}


/**
 * Tira as regras que sobraram de um catálogo antigo.
 * Só apaga linha que NÃO existe mais no catálogo — o que você
 * configurou e continua existindo fica exatamente como está.
 */
function AP_PERMISSOES_limparOrfas() {
  var aba = APERM_aba_('permissoes', false);
  if (!aba) return APERM_LOG_(['Aba não existe. Rode AP_PERMISSOES_instalar.']);

  var regras = APERM_linhas_('permissoes') || [];
  var orfas = regras.filter(function (r) {
    return !APERM_acaoExiste_(APERM_texto_(r.modulo), APERM_texto_(r.tela), APERM_texto_(r.acao));
  });
  if (!orfas.length) return APERM_LOG_(['Nenhuma regra órfã. Nada a fazer.']);

  /* de baixo para cima, senão as linhas se deslocam */
  orfas.sort(function (a, b) { return b.__linha - a.__linha; })
    .forEach(function (r) { aba.deleteRow(r.__linha); });

  var amostra = orfas.slice(0, 8).map(function (r) {
    return '   ' + r.perfil + ' · ' + r.modulo + '/' + r.tela + ' · ' + r.acao;
  });
  return APERM_LOG_([
    orfas.length + ' regra(s) órfã(s) removida(s).'
  ].concat(amostra, [
    orfas.length > 8 ? '   … e mais ' + (orfas.length - 8) : '',
    '',
    'Rode AP_PERMISSOES_instalar depois, para as telas novas',
    'entrarem com o acesso que cada perfil já tinha.'
  ]));
}


/* ============================================================
   4. MODO — sombra (configurando) ou valendo (mandando)
   ============================================================ */

function APERM_modo_() {
  try {
    var v = PropertiesService.getScriptProperties().getProperty(APERM_PROP_MODO);
    return v === 'valendo' ? 'valendo' : 'sombra';
  } catch (e) { return 'sombra'; }
}

function AP_PERMISSOES_estaValendo() {
  return APERM_modo_() === 'valendo';
}

function AP_PERMISSOES_VALER() {
  PropertiesService.getScriptProperties().setProperty(APERM_PROP_MODO, 'valendo');
  return APERM_LOG_([
    'As permissões configuradas passam a mandar.',
    '',
    'A partir de agora, ação sem marcação é ação NEGADA.',
    'O perfil ' + APERM_SEMPRE_TOTAL.join(', ') + ' continua com acesso total —',
    'é a porta de emergência, para você nunca ficar trancado para fora.',
    '',
    'Se algo der errado, rode AP_PERMISSOES_SOMBRA() e tudo volta.',
    'FALTA PUBLICAR nova versão.'
  ]);
}

function AP_PERMISSOES_SOMBRA() {
  PropertiesService.getScriptProperties().setProperty(APERM_PROP_MODO, 'sombra');
  return APERM_LOG_([
    'Voltou para o modo sombra.',
    'O sistema obedece de novo às listas de perfil do index.html.',
    'Nada do que você configurou foi apagado.',
    'FALTA PUBLICAR nova versão.'
  ]);
}


/* ============================================================
   5. AS OITO AÇÕES QUE A TELA CHAMA
   ============================================================ */

function APERM_perfis_() {
  var perfis = APERM_linhas_('perfis');
  if (perfis === null) return APERM_erro_('SEM_ABA', 'Rode AP_PERMISSOES_instalar no Apps Script.');
  var regras = APERM_linhas_('permissoes') || [];
  var total = APERM_totalDeAcoes_();

  var concedidasPor = {};
  regras.forEach(function (r) {
    if (!APERM_sim_(r.permitido)) return;
    var p = APERM_texto_(r.perfil);
    concedidasPor[p] = (concedidasPor[p] || 0) + 1;
  });

  return APERM_ok_(perfis.map(function (p) {
    var id = APERM_texto_(p.id);
    var total_ = APERM_SEMPRE_TOTAL.indexOf(id) > -1 ? total : (concedidasPor[id] || 0);
    return {
      id: id,
      nome: APERM_texto_(p.nome) || id,
      descricao: APERM_texto_(p.descricao),
      ativo: APERM_sim_(p.ativo),
      sistema: APERM_sim_(p.sistema),
      permissoes: total,
      concedidas: total_
    };
  }));
}

function APERM_doPerfil_(payload) {
  var id = APERM_texto_(payload && payload.perfil);
  if (!id) return APERM_erro_('PERFIL_NAO_INFORMADO', 'Diga qual perfil.');

  var perfis = APERM_linhas_('perfis');
  if (perfis === null) return APERM_erro_('SEM_ABA', 'Rode AP_PERMISSOES_instalar no Apps Script.');

  var p = perfis.filter(function (x) { return APERM_texto_(x.id) === id; })[0];
  if (!p) return APERM_erro_('PERFIL_NAO_EXISTE', 'Não existe perfil com o id ' + id + '.');

  var regras = (APERM_linhas_('permissoes') || []).filter(function (r) {
    return APERM_texto_(r.perfil) === id;
  });

  return APERM_ok_({
    perfil: {
      id: id,
      nome: APERM_texto_(p.nome) || id,
      descricao: APERM_texto_(p.descricao),
      ativo: APERM_sim_(p.ativo),
      sistema: APERM_sim_(p.sistema)
    },
    permissoes: regras.map(function (r) {
      return {
        modulo: APERM_texto_(r.modulo),
        tela: APERM_texto_(r.tela),
        acao: APERM_texto_(r.acao),
        permitido: APERM_sim_(r.permitido),
        escopo: APERM_texto_(r.escopo),
        condicao: APERM_texto_(r.condicao),
        limite: APERM_texto_(r.limite)
      };
    })
  });
}

function APERM_definir_(payload, quem) {
  payload = payload || {};
  var perfil = APERM_texto_(payload.perfil);
  var modulo = APERM_texto_(payload.modulo);
  var tela = APERM_texto_(payload.tela);
  var acao = APERM_texto_(payload.acao);
  var permitido = payload.permitido === true || payload.permitido === 'true';

  if (!perfil || !modulo || !acao) {
    return APERM_erro_('CAMPOS_OBRIGATORIOS', 'Informe perfil, módulo e ação.');
  }
  if (!APERM_acaoExiste_(modulo, tela, acao)) {
    return APERM_erro_('ACAO_DESCONHECIDA',
      'A ação ' + acao + ' não existe em ' + modulo + (tela ? '/' + tela : '') + '. ' +
      'Se ela foi acrescentada no index.html, acrescente também no catálogo deste arquivo.');
  }

  var perfis = APERM_linhas_('perfis');
  if (perfis === null) return APERM_erro_('SEM_ABA', 'Rode AP_PERMISSOES_instalar no Apps Script.');
  if (!perfis.filter(function (x) { return APERM_texto_(x.id) === perfil; })[0]) {
    return APERM_erro_('PERFIL_NAO_EXISTE', 'Não existe perfil com o id ' + perfil + '.');
  }
  if (APERM_SEMPRE_TOTAL.indexOf(perfil) > -1) {
    return APERM_erro_('PERFIL_DE_EMERGENCIA',
      'O perfil ' + perfil + ' é a porta de emergência e tem acesso total por definição. ' +
      'Para restringir alguém, use outro perfil.');
  }

  var trava = LockService.getScriptLock();
  try { trava.waitLock(15000); } catch (e) {
    return APERM_erro_('OCUPADO', 'Outra gravação está em andamento. Tente de novo.');
  }
  try {
    var regras = APERM_linhas_('permissoes') || [];
    var achada = regras.filter(function (r) {
      return APERM_texto_(r.perfil) === perfil
        && APERM_texto_(r.modulo) === modulo
        && APERM_texto_(r.tela) === tela
        && APERM_texto_(r.acao) === acao;
    })[0];

    if (achada) {
      achada.permitido = permitido;
      achada.atualizadoEm = APERM_agora_();
      achada.atualizadoPor = quem || '';
      APERM_escrever_('permissoes', achada);
    } else {
      APERM_escrever_('permissoes', {
        id: APERM_id_('PR'),
        perfil: perfil, modulo: modulo, tela: tela, acao: acao,
        permitido: permitido,
        escopo: '', condicao: '', limite: '', descricao: '',
        atualizadoEm: APERM_agora_(),
        atualizadoPor: quem || ''
      });
    }
    return APERM_ok_({ perfil: perfil, modulo: modulo, tela: tela, acao: acao, permitido: permitido });
  } finally {
    try { trava.releaseLock(); } catch (e) {}
  }
}

function APERM_criarPerfil_(payload, quem) {
  payload = payload || {};
  var nome = APERM_texto_(payload.nome);
  if (!nome) return APERM_erro_('CAMPOS_OBRIGATORIOS', 'Informe o nome do perfil.');

  var perfis = APERM_linhas_('perfis');
  if (perfis === null) return APERM_erro_('SEM_ABA', 'Rode AP_PERMISSOES_instalar no Apps Script.');

  var id = nome.toLowerCase()
    .replace(/[àáâãä]/g, 'a').replace(/[èéêë]/g, 'e').replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõö]/g, 'o').replace(/[ùúûü]/g, 'u').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  if (!id) id = 'perfil';
  var base = id, n = 2;
  while (perfis.filter(function (x) { return APERM_texto_(x.id) === id; })[0]) {
    id = base + '-' + n; n++;
  }

  APERM_escrever_('perfis', {
    id: id,
    nome: nome,
    descricao: APERM_texto_(payload.descricao),
    ativo: true,
    sistema: false,
    criadoEm: APERM_agora_(),
    criadoPor: quem || '',
    observacao: ''
  });

  var copiadas = 0;
  var origem = APERM_texto_(payload.base);
  if (origem) {
    var regras = (APERM_linhas_('permissoes') || []).filter(function (r) {
      return APERM_texto_(r.perfil) === origem && APERM_sim_(r.permitido);
    });
    if (regras.length) {
      var aba = APERM_aba_('permissoes', true);
      var cab = aba.getRange(1, 1, 1, Math.max(1, aba.getLastColumn())).getValues()[0]
        .map(function (c) { return String(c).trim(); });
      var agora = APERM_agora_();
      var bloco = regras.map(function (r) {
        var novo = {
          id: APERM_id_('PR'), perfil: id,
          modulo: APERM_texto_(r.modulo), tela: APERM_texto_(r.tela), acao: APERM_texto_(r.acao),
          permitido: true,
          escopo: APERM_texto_(r.escopo), condicao: APERM_texto_(r.condicao), limite: APERM_texto_(r.limite),
          descricao: 'copiado do perfil ' + origem,
          atualizadoEm: agora, atualizadoPor: quem || ''
        };
        return cab.map(function (c) { return novo[c] === undefined ? '' : novo[c]; });
      });
      aba.getRange(aba.getLastRow() + 1, 1, bloco.length, cab.length).setValues(bloco);
      copiadas = bloco.length;
    }
  }

  return APERM_ok_({ id: id, nome: nome, permissoesCopiadas: copiadas });
}

function APERM_alterarPerfil_(payload) {
  payload = payload || {};
  var id = APERM_texto_(payload.id);
  if (!id) return APERM_erro_('CAMPOS_OBRIGATORIOS', 'Informe o perfil.');

  var perfis = APERM_linhas_('perfis');
  if (perfis === null) return APERM_erro_('SEM_ABA', 'Rode AP_PERMISSOES_instalar no Apps Script.');

  var p = perfis.filter(function (x) { return APERM_texto_(x.id) === id; })[0];
  if (!p) return APERM_erro_('PERFIL_NAO_EXISTE', 'Não existe perfil com o id ' + id + '.');

  if (APERM_SEMPRE_TOTAL.indexOf(id) > -1 && payload.ativo === false) {
    return APERM_erro_('PERFIL_DE_EMERGENCIA',
      'O perfil ' + id + ' não pode ser desativado: é a porta de emergência do sistema.');
  }

  if (payload.ativo !== undefined) p.ativo = !!payload.ativo;
  if (payload.nome !== undefined) p.nome = APERM_texto_(payload.nome);
  if (payload.descricao !== undefined) p.descricao = APERM_texto_(payload.descricao);
  APERM_escrever_('perfis', p);

  return APERM_ok_({ id: id, ativo: APERM_sim_(p.ativo) });
}


/* ============================================================
   6. ALÇADAS
   ============================================================ */

function APERM_alcadaPublica_(a) {
  return {
    id: APERM_texto_(a.id),
    nome: APERM_texto_(a.nome),
    valorMinimo: Number(a.valorMinimo) || 0,
    valorMaximo: APERM_texto_(a.valorMaximo) === '' ? '' : Number(a.valorMaximo),
    perfilAprovador: APERM_texto_(a.perfilAprovador),
    categoria: APERM_texto_(a.categoria),
    obra: APERM_texto_(a.obra),
    modulo: APERM_texto_(a.modulo),
    aprovadores: Number(a.aprovadores) || 1,
    ativo: APERM_sim_(a.ativo)
  };
}

function APERM_alcadas_() {
  var linhas = APERM_linhas_('alcadas');
  if (linhas === null) return APERM_erro_('SEM_ABA', 'Rode AP_PERMISSOES_instalar no Apps Script.');
  return APERM_ok_(linhas.map(APERM_alcadaPublica_));
}

/** Quanto mais campos preenchidos, mais específica é a regra. */
function APERM_especificidade_(a) {
  return (a.categoria ? 1 : 0) + (a.obra ? 1 : 0) + (a.modulo ? 1 : 0);
}

function APERM_cobre_(a, valor, categoria, obra, modulo) {
  if (!a.ativo) return false;
  var min = Number(a.valorMinimo) || 0;
  if (valor < min) return false;
  if (a.valorMaximo !== '' && valor > Number(a.valorMaximo)) return false;
  if (a.categoria && categoria && a.categoria.toLowerCase() !== String(categoria).toLowerCase()) return false;
  if (a.categoria && !categoria) return false;
  if (a.obra && obra && a.obra !== obra) return false;
  if (a.obra && !obra) return false;
  if (a.modulo && modulo && a.modulo !== modulo) return false;
  if (a.modulo && !modulo) return false;
  return true;
}

function APERM_alcadaPara_(payload) {
  payload = payload || {};
  var valor = Number(payload.valor) || 0;
  var categoria = APERM_texto_(payload.categoria);
  var obra = APERM_texto_(payload.obra);
  var modulo = APERM_texto_(payload.modulo);

  var linhas = APERM_linhas_('alcadas');
  if (linhas === null) return APERM_erro_('SEM_ABA', 'Rode AP_PERMISSOES_instalar no Apps Script.');

  var servem = linhas.map(APERM_alcadaPublica_).filter(function (a) {
    return APERM_cobre_(a, valor, categoria, obra, modulo);
  });

  if (!servem.length) {
    return APERM_erro_('SEM_REGRA',
      'Nenhuma regra ativa cobre ' + (categoria ? categoria + ' ' : '') + 'no valor informado. ' +
      'Crie uma regra que inclua essa faixa.');
  }

  servem.sort(function (x, y) {
    var d = APERM_especificidade_(y) - APERM_especificidade_(x);
    if (d) return d;
    var fx = x.valorMaximo === '' ? Infinity : x.valorMaximo;
    var fy = y.valorMaximo === '' ? Infinity : y.valorMaximo;
    return fx - fy;
  });

  var e = servem[0];
  return APERM_ok_({
    id: e.id,
    nome: e.nome,
    perfilAprovador: e.perfilAprovador,
    aprovadores: e.aprovadores,
    faixa: APERM_faixa_(e),
    outrasQueSeAplicam: servem.length - 1
  });
}

function APERM_moeda_(n) {
  var v = (Number(n) || 0).toFixed(2);
  var partes = v.split('.');
  var inteiro = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return 'R$ ' + inteiro + ',' + partes[1];
}

function APERM_faixa_(a) {
  return APERM_moeda_(a.valorMinimo) + ' até ' +
    (a.valorMaximo === '' ? 'sem limite' : APERM_moeda_(a.valorMaximo));
}

function APERM_criarAlcada_(payload) {
  payload = payload || {};
  var nome = APERM_texto_(payload.nome);
  var perfilAprovador = APERM_texto_(payload.perfilAprovador);
  if (!nome) return APERM_erro_('CAMPOS_OBRIGATORIOS', 'Informe o nome da regra.');
  if (!perfilAprovador) return APERM_erro_('CAMPOS_OBRIGATORIOS', 'Informe quem aprova.');

  var nova = APERM_alcadaPublica_({
    id: '',
    nome: nome,
    valorMinimo: payload.valorMinimo,
    valorMaximo: APERM_texto_(payload.valorMaximo),
    perfilAprovador: perfilAprovador,
    categoria: APERM_texto_(payload.categoria),
    obra: APERM_texto_(payload.obra),
    modulo: APERM_texto_(payload.modulo),
    aprovadores: payload.aprovadores,
    ativo: true
  });

  if (nova.valorMaximo !== '' && nova.valorMaximo < nova.valorMinimo) {
    return APERM_erro_('FAIXA_INVALIDA', 'O valor máximo é menor que o mínimo.');
  }

  var linhas = APERM_linhas_('alcadas');
  if (linhas === null) return APERM_erro_('SEM_ABA', 'Rode AP_PERMISSOES_instalar no Apps Script.');

  if (payload.confirmarSobreposicao !== true && payload.confirmarSobreposicao !== 'true') {
    var choque = linhas.map(APERM_alcadaPublica_).filter(function (a) {
      if (!a.ativo) return false;
      if (APERM_texto_(a.categoria) !== nova.categoria) return false;
      if (APERM_texto_(a.obra) !== nova.obra) return false;
      if (APERM_texto_(a.modulo) !== nova.modulo) return false;
      var aMax = a.valorMaximo === '' ? Infinity : a.valorMaximo;
      var nMax = nova.valorMaximo === '' ? Infinity : nova.valorMaximo;
      return nova.valorMinimo <= aMax && a.valorMinimo <= nMax;
    })[0];
    if (choque) {
      return {
        ok: false,
        codigo: 'FAIXA_SOBREPOSTA',
        mensagem: 'A regra "' + choque.nome + '" já cobre parte dessa faixa (' +
          APERM_faixa_(choque) + '). Se você criar assim mesmo, a mais específica vence.',
        dados: null
      };
    }
  }

  nova.id = APERM_id_('AL');
  APERM_escrever_('alcadas', {
    id: nova.id, nome: nova.nome,
    valorMinimo: nova.valorMinimo,
    valorMaximo: nova.valorMaximo,
    perfilAprovador: nova.perfilAprovador,
    categoria: nova.categoria, obra: nova.obra, modulo: nova.modulo,
    aprovadores: nova.aprovadores, ativo: true,
    criadoEm: APERM_agora_(), observacao: ''
  });

  return APERM_ok_(nova, 'Regra criada.');
}


/* ============================================================
   7. VERIFICAR — a porta única do item 25 do prompt
   ------------------------------------------------------------
   Ainda não é chamada por nenhum módulo: quem chama é a etapa 7.
   Já fica pronta aqui para as etapas seguintes usarem.
   ============================================================ */

function AP_PERMISSOES_verificar(perfil, modulo, acao, contexto) {
  contexto = contexto || {};
  perfil = APERM_texto_(perfil);
  var tela = APERM_texto_(contexto.tela);

  if (!perfil) {
    return { ok: false, permitido: false, motivo: 'Sem perfil na sessão.' };
  }
  if (APERM_SEMPRE_TOTAL.indexOf(perfil) > -1) {
    return { ok: true, permitido: true, escopo: 'TODOS', motivo: 'perfil de emergência' };
  }
  if (!AP_PERMISSOES_estaValendo()) {
    return { ok: true, permitido: true, escopo: '', motivo: 'modo sombra: as permissões ainda não mandam' };
  }

  var perfis = APERM_linhas_('perfis');
  if (perfis === null) {
    return { ok: false, permitido: false, motivo: 'O módulo de permissões não está instalado.' };
  }
  var p = perfis.filter(function (x) { return APERM_texto_(x.id) === perfil; })[0];
  if (!p) return { ok: false, permitido: false, motivo: 'Perfil ' + perfil + ' não existe.' };
  if (!APERM_sim_(p.ativo)) {
    return { ok: false, permitido: false, motivo: 'O perfil ' + APERM_texto_(p.nome) + ' está desativado.' };
  }

  var r = (APERM_linhas_('permissoes') || []).filter(function (x) {
    return APERM_texto_(x.perfil) === perfil
      && APERM_texto_(x.modulo) === APERM_texto_(modulo)
      && APERM_texto_(x.tela) === tela
      && APERM_texto_(x.acao) === APERM_texto_(acao);
  })[0];

  if (!r || !APERM_sim_(r.permitido)) {
    return {
      ok: false, permitido: false,
      motivo: 'O perfil ' + APERM_texto_(p.nome) + ' não tem autorização para ' +
        APERM_texto_(acao) + ' em ' + APERM_texto_(modulo) + '.'
    };
  }

  return {
    ok: true, permitido: true,
    escopo: APERM_texto_(r.escopo) || 'TODOS',
    condicao: APERM_texto_(r.condicao),
    limite: APERM_texto_(r.limite)
  };
}


/* ============================================================
   8. AS PORTAS — roteador e porta direta
   ============================================================ */

function APERM_atender_(acao, payload, quem) {
  switch (String(acao || '')) {
    case 'perfis':        return APERM_perfis_();
    case 'doPerfil':      return APERM_doPerfil_(payload);
    case 'definir':       return APERM_definir_(payload, quem);
    case 'criarPerfil':   return APERM_criarPerfil_(payload, quem);
    case 'alterarPerfil': return APERM_alterarPerfil_(payload);
    case 'alcadas':       return APERM_alcadas_();
    case 'alcadaPara':    return APERM_alcadaPara_(payload);
    case 'criarAlcada':   return APERM_criarAlcada_(payload);
    case 'funcoes':       return APERM_funcoes_(payload);
    case 'salvarFuncao':  return APERM_salvarFuncao_(payload);
    case 'arquivarFuncao':return APERM_arquivarFuncao_(payload);
    case 'importarCargos':return APERM_importarCargosAcao_();
    case 'verificar':     return APERM_ok_(AP_PERMISSOES_verificar(
                                 (payload || {}).perfil, (payload || {}).modulo,
                                 (payload || {}).acao, payload || {}));
    case 'catalogo':      return APERM_ok_({
                                 modulos: APERM_CATALOGO.length,
                                 acoes: APERM_totalDeAcoes_(),
                                 modo: APERM_modo_()
                               });
    default:
      return APERM_erro_('ACAO_DESCONHECIDA',
        'O módulo de permissões não conhece a ação "' + acao + '".');
  }
}

/** Nome por convenção do roteador do Core. */
function AP_Modulo_permissoes(req) {
  req = req || {};
  if (typeof req === 'string') {
    try { req = JSON.parse(req); } catch (e) { req = {}; }
  }
  return APERM_atender_(req.acao, req.payload, req.sessao || req.token || '');
}

/** Porta direta, para o frontend chamar sem passar pelo roteador. */
function AP_PERMISSOES_direto(json) {
  var c = {};
  try { c = JSON.parse(json || '{}'); } catch (e) { c = {}; }
  try {
    return JSON.stringify(APERM_atender_(c.acao, c.payload, c.token || ''));
  } catch (err) {
    return JSON.stringify(APERM_erro_('PERMISSOES_ERRO', String((err && err.message) || err)));
  }
}


/* ============================================================
   10. FUNÇÕES  ·  item 4 do prompt V2
   ------------------------------------------------------------
   A função descreve RESPONSABILIDADE. Ela não concede nada:
   quem concede é a permissão, no bloco 5. Dois "Gestores" com
   funções diferentes podem ter permissões diferentes.
   ============================================================ */

APERM_ABAS.funcoes = 'ALMOXA_FUNCOES';
APERM_COLUNAS.funcoes = ['id', 'nome', 'descricao', 'categoria', 'nivel',
                         'responsabilidades', 'status', 'observacao',
                         'criadoEm', 'atualizadoEm'];

var APERM_NIVEIS = ['Auxiliar', 'Operacional', 'Técnico', 'Supervisão', 'Gestão', 'Direção'];

function APERM_funcaoPublica_(f) {
  return {
    id: APERM_texto_(f.id),
    nome: APERM_texto_(f.nome),
    descricao: APERM_texto_(f.descricao),
    categoria: APERM_texto_(f.categoria),
    nivel: APERM_texto_(f.nivel),
    responsabilidades: APERM_texto_(f.responsabilidades),
    status: APERM_texto_(f.status) || 'ATIVA',
    observacao: APERM_texto_(f.observacao)
  };
}

function APERM_funcoes_(payload) {
  var linhas = APERM_linhas_('funcoes');
  if (linhas === null) return APERM_erro_('SEM_ABA', 'Rode AP_PERMISSOES_instalar no Apps Script.');
  var so = APERM_texto_(payload && payload.status).toUpperCase();
  var lista = linhas.map(APERM_funcaoPublica_).filter(function (f) {
    return !so || f.status.toUpperCase() === so;
  });
  lista.sort(function (a, b) { return a.nome.localeCompare(b.nome); });
  return APERM_ok_({
    funcoes: lista,
    niveis: APERM_NIVEIS,
    semDescricao: lista.filter(function (f) { return !f.descricao; }).length
  });
}

function APERM_salvarFuncao_(payload) {
  payload = payload || {};
  var nome = APERM_texto_(payload.nome);
  if (!nome) return APERM_erro_('CAMPOS_OBRIGATORIOS', 'Informe o nome da função.');

  var linhas = APERM_linhas_('funcoes');
  if (linhas === null) return APERM_erro_('SEM_ABA', 'Rode AP_PERMISSOES_instalar no Apps Script.');

  var id = APERM_texto_(payload.id);
  var atual = id ? linhas.filter(function (f) { return APERM_texto_(f.id) === id; })[0] : null;
  if (id && !atual) return APERM_erro_('FUNCAO_NAO_EXISTE', 'Não existe função com o id ' + id + '.');

  var repetida = linhas.filter(function (f) {
    return APERM_texto_(f.nome).toLowerCase() === nome.toLowerCase()
      && (!atual || APERM_texto_(f.id) !== APERM_texto_(atual.id));
  })[0];
  if (repetida) {
    return APERM_erro_('FUNCAO_DUPLICADA', 'Já existe uma função chamada "' + nome + '".');
  }

  var reg = atual || { id: APERM_id_('FN'), criadoEm: APERM_agora_() };
  reg.nome = nome;
  if (payload.descricao !== undefined) reg.descricao = APERM_texto_(payload.descricao);
  if (payload.categoria !== undefined) reg.categoria = APERM_texto_(payload.categoria);
  if (payload.nivel !== undefined) reg.nivel = APERM_texto_(payload.nivel);
  if (payload.responsabilidades !== undefined) reg.responsabilidades = APERM_texto_(payload.responsabilidades);
  if (payload.observacao !== undefined) reg.observacao = APERM_texto_(payload.observacao);
  reg.status = APERM_texto_(payload.status).toUpperCase() || APERM_texto_(reg.status) || 'ATIVA';
  reg.atualizadoEm = APERM_agora_();

  APERM_escrever_('funcoes', reg);
  return APERM_ok_(APERM_funcaoPublica_(reg), atual ? 'Função atualizada.' : 'Função criada.');
}

/** Não apaga: arquiva. Cargo já escrito em cadastro de gente não some. */
function APERM_arquivarFuncao_(payload) {
  var id = APERM_texto_(payload && payload.id);
  if (!id) return APERM_erro_('CAMPOS_OBRIGATORIOS', 'Informe a função.');

  var linhas = APERM_linhas_('funcoes');
  if (linhas === null) return APERM_erro_('SEM_ABA', 'Rode AP_PERMISSOES_instalar no Apps Script.');

  var f = linhas.filter(function (x) { return APERM_texto_(x.id) === id; })[0];
  if (!f) return APERM_erro_('FUNCAO_NAO_EXISTE', 'Não existe função com o id ' + id + '.');

  f.status = APERM_texto_(f.status).toUpperCase() === 'ARQUIVADA' ? 'ATIVA' : 'ARQUIVADA';
  f.atualizadoEm = APERM_agora_();
  APERM_escrever_('funcoes', f);
  return APERM_ok_(APERM_funcaoPublica_(f));
}

/**
 * Cria uma função para cada cargo que JÁ está sendo usado nos
 * cadastros de pessoas. Não inventa nada: só lê o que existe e
 * deixa a descrição em branco para você preencher.
 */
function APERM_importarCargos_() {
  var cargos = {};
  var onde = '';

  try {
    if (typeof AP_Data_rows === 'function' && typeof AP_SHEETS !== 'undefined' && AP_SHEETS.USUARIOS) {
      AP_Data_rows(AP_SHEETS.USUARIOS).forEach(function (u) {
        var c = APERM_texto_(u.cargo || u.funcao);
        if (c) cargos[c] = true;
      });
      onde = 'pela camada de dados do Core';
    }
  } catch (e) {}

  if (!onde) {
    /* sem o Core, procura a aba de usuários pelo nome */
    try {
      var ss = APERM_planilha_();
      var aba = ['USUARIOS', 'ALMOXA_USUARIOS', 'Usuarios', 'USUÁRIOS'].reduce(function (a, n) {
        return a || ss.getSheetByName(n);
      }, null);
      if (aba && aba.getLastRow() > 1) {
        var largura = Math.max(1, aba.getLastColumn());
        var tudo = aba.getRange(1, 1, aba.getLastRow(), largura).getValues();
        var cab = tudo[0].map(function (c) { return String(c).trim().toLowerCase(); });
        var col = cab.indexOf('cargo');
        if (col < 0) col = cab.indexOf('funcao');
        if (col > -1) {
          tudo.slice(1).forEach(function (l) {
            var c = APERM_texto_(l[col]);
            if (c) cargos[c] = true;
          });
          onde = 'da aba ' + aba.getName();
        }
      }
    } catch (e2) {}
  }

  return { cargos: Object.keys(cargos), onde: onde };
}

/** A mesma importação, mas respondendo para a tela em vez do registro. */
function APERM_importarCargosAcao_() {
  var achado = APERM_importarCargos_();
  if (!achado.onde) {
    return APERM_erro_('SEM_CADASTROS',
      'Não encontrei a aba de usuários para ler os cargos. Cadastre as funções à mão.');
  }
  var linhas = APERM_linhas_('funcoes');
  if (linhas === null) return APERM_erro_('SEM_ABA', 'Rode AP_PERMISSOES_instalar no Apps Script.');

  var jaTem = {};
  linhas.forEach(function (f) { jaTem[APERM_texto_(f.nome).toLowerCase()] = true; });

  var criadas = [];
  achado.cargos.forEach(function (c) {
    if (jaTem[c.toLowerCase()]) return;
    APERM_escrever_('funcoes', {
      id: APERM_id_('FN'), nome: c, descricao: '', categoria: '', nivel: '',
      responsabilidades: '', status: 'ATIVA',
      observacao: 'importada dos cargos que já estavam nos cadastros',
      criadoEm: APERM_agora_(), atualizadoEm: APERM_agora_()
    });
    criadas.push(c);
  });

  return APERM_ok_({
    criadas: criadas,
    jaExistiam: achado.cargos.length - criadas.length,
    onde: achado.onde
  });
}

function AP_PERMISSOES_importarCargos() {
  var achado = APERM_importarCargos_();
  if (!achado.onde) {
    return APERM_LOG_([
      'Não encontrei a aba de usuários nem a camada de dados do Core.',
      '',
      'Isso não é problema: cadastre as funções à mão em',
      'Administração > Funções. O importador só serve para poupar',
      'digitação quando os cargos já estão preenchidos.'
    ]);
  }
  if (!achado.cargos.length) {
    return APERM_LOG_(['Encontrei a aba de usuários ' + achado.onde + ', mas nenhum cargo preenchido.']);
  }

  var linhas = APERM_linhas_('funcoes') || [];
  var jaTem = {};
  linhas.forEach(function (f) { jaTem[APERM_texto_(f.nome).toLowerCase()] = true; });

  var criadas = [];
  achado.cargos.forEach(function (c) {
    if (jaTem[c.toLowerCase()]) return;
    APERM_escrever_('funcoes', {
      id: APERM_id_('FN'),
      nome: c,
      descricao: '',
      categoria: '',
      nivel: '',
      responsabilidades: '',
      status: 'ATIVA',
      observacao: 'importada dos cargos que já estavam nos cadastros',
      criadoEm: APERM_agora_(),
      atualizadoEm: APERM_agora_()
    });
    criadas.push(c);
  });

  return APERM_LOG_([
    criadas.length + ' função(ões) criada(s) ' + achado.onde + '.',
    ''
  ].concat(criadas.map(function (c) { return '   ' + c; }), [
    '',
    (achado.cargos.length - criadas.length) + ' já existia(m).',
    '',
    'TODAS estão sem descrição. Abra Administração > Funções e',
    'escreva o que cada uma faz — é a descrição que explica o papel',
    'da pessoa no fluxo, e ela não concede permissão nenhuma.'
  ]));
}


/* ============================================================
   9. CONFERIR — para rodar à mão quando algo não bate
   ============================================================ */

function AP_PERMISSOES_conferir() {
  var l = [];
  l.push('MÓDULO DE PERMISSÕES DO ALMOX-PRO');
  l.push('');

  ['perfis', 'permissoes', 'alcadas', 'funcoes'].forEach(function (qual) {
    var linhas = APERM_linhas_(qual);
    l.push(APERM_ABAS[qual] + ': ' + (linhas === null ? 'NÃO EXISTE — rode AP_PERMISSOES_instalar'
      : linhas.length + ' linha(s)'));
  });

  l.push('');
  l.push('Catálogo: ' + APERM_CATALOGO.length + ' módulos, ' + APERM_totalDeAcoes_() + ' ações.');
  l.push('Modo: ' + APERM_modo_().toUpperCase() +
    (APERM_modo_() === 'sombra' ? '  (as permissões ainda não mandam)' : '  (as permissões mandam)'));
  l.push('Porta de emergência: ' + APERM_SEMPRE_TOTAL.join(', '));
  l.push('');

  var regras = APERM_linhas_('permissoes') || [];
  var orfas = regras.filter(function (r) {
    return !APERM_acaoExiste_(APERM_texto_(r.modulo), APERM_texto_(r.tela), APERM_texto_(r.acao));
  });
  l.push('Regras que não batem com o catálogo: ' + orfas.length);
  orfas.slice(0, 10).forEach(function (r) {
    l.push('   ' + r.perfil + ' · ' + r.modulo + '/' + r.tela + ' · ' + r.acao);
  });
  if (orfas.length) {
    l.push('   (isso acontece quando o index.html ganhou módulo ou ação');
    l.push('    que ainda não foi acrescentada ao catálogo deste arquivo)');
  }

  l.push('');
  l.push('Roteador: ' +
    (typeof almoxaApi === 'function' ? 'almoxaApi presente'
      : typeof AP_API === 'function' ? 'AP_API presente'
        : 'nenhum roteador encontrado — a tela usará a porta direta'));

  return APERM_LOG_(l);
}

function APERM_LOG_(linhas) {
  var txt = linhas.join('\n');
  Logger.log(txt);
  return txt;
}

