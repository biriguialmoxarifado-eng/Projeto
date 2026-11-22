/**
 * ============================================================
 * ALMOXA PRO — PARTE 11 · PERMISSÕES
 * ============================================================
 *
 * POR QUE ESTE ARQUIVO EXISTE
 *
 * O manifesto das 21 partes diz que a PARTE_11 se prova pela
 * função `AP_Permissions_can_`. A PONTE FRONTEND ↔ CORE MASTER
 * chama exatamente essa função antes de liberar qualquer
 * operação:
 *
 *     var perm = AP_BRIDGE_permissaoCache_(perfil, modulo, acao);
 *     if (!perm.ok && perm.ausente) {
 *       → "O Core não expõe verificação de permissão.
 *          Operação recusada por segurança."
 *     }
 *
 * A função nunca existiu. Cinco arquivos a mencionavam, nenhum
 * a definia. Resultado: a ponte recusava TODA operação e o painel
 * não carregava. A recusa estava certa — faltava o verificador.
 *
 * ------------------------------------------------------------
 * O QUE ESTE ARQUIVO FAZ, E O QUE NÃO FAZ
 *
 * FAZ: traduz o pedido da ponte para o vocabulário do módulo
 *      "PERFIS E PERMISSÕES DINÂMICOS", que já decide quem pode
 *      o quê, e devolve a resposta.
 *
 * NÃO FAZ: não inventa permissão, não tem regra própria, não
 *      libera nada por conta própria. Se o verificador não
 *      estiver no projeto, NEGA — nunca o contrário.
 *
 * ------------------------------------------------------------
 * DOIS VOCABULÁRIOS
 *
 * A ponte fala RBAC em maiúsculas (READ, CREATE, UPDATE...).
 * O cadastro de permissões fala português (visualizar, criar,
 * editar...). O mapa abaixo faz a tradução, e é o único lugar
 * onde ela acontece.
 *
 * ------------------------------------------------------------
 * ANTES DE USAR
 *
 * Rode AP_Permissions_diagnostico() no editor. Ele diz se o
 * cadastro de perfis está preenchido. Com o cadastro vazio, todo
 * perfil que não seja admin é negado — e isso é a regra do
 * sistema, não um defeito.
 * ============================================================
 */

var AP_PERMISSIONS = {
  versao: '1.0.0',
  parte: 'PARTE_11'
};

/**
 * Ação da ponte (RBAC) → ação do cadastro de permissões.
 *
 * MOVEMENT e INVENTORY não têm par exato no cadastro. Ambas são
 * escrita, então apontam para "editar" — o administrador pode
 * criar regras mais finas depois, e só este mapa muda.
 */
var AP_PERMISSIONS_ACOES = {
  READ:      'visualizar',
  SCAN:      'visualizar',
  EXPORT:    'exportar',
  CREATE:    'criar',
  UPDATE:    'editar',
  MOVEMENT:  'editar',
  INVENTORY: 'editar',
  DELETE:    'excluir',
  APPROVE:   'aprovar'
};


/* ============================================================
   A FUNÇÃO QUE A PONTE PROCURA
   ============================================================ */

/**
 * Pode ou não pode?
 *
 * @param {string} perfil  admin, gestor, almoxarife, colaborador
 * @param {string} modulo  estoque, nf, compras...
 * @param {string} acao    READ, CREATE, UPDATE, DELETE, APPROVE...
 * @return {boolean}       true libera; false nega.
 *
 * Nega em qualquer dúvida: verificador ausente, erro na consulta
 * ou falta de regra. Nunca libera por omissão.
 */
function AP_Permissions_can_(perfil, modulo, acao) {
  var r = AP_Permissions_decidir_(perfil, modulo, acao);
  return r.permitido === true;
}

/**
 * Mesma decisão, com o motivo junto.
 * Útil na auditoria e no diagnóstico, onde "não" sem explicação
 * não ajuda ninguém.
 */
function AP_Permissions_decidir_(perfil, modulo, acao) {
  var perfilLimpo = String(perfil || '').trim().toLowerCase();
  var moduloLimpo = String(modulo || '').trim();
  var acaoRbac = String(acao || 'READ').trim().toUpperCase();

  if (!perfilLimpo || !moduloLimpo) {
    return { permitido: false, motivo: 'SEM_CONTEXTO',
      explicacao: 'Faltou perfil ou módulo. Na dúvida, nega.' };
  }

  var acaoCadastro = AP_PERMISSIONS_ACOES[acaoRbac];
  if (!acaoCadastro) {
    return { permitido: false, motivo: 'ACAO_DESCONHECIDA',
      explicacao: 'A ação "' + acaoRbac + '" não está no mapa de tradução ' +
                  'da PARTE_11. Acrescente em AP_PERMISSIONS_ACOES.' };
  }

  if (typeof AP_PERM_pode !== 'function') {
    return { permitido: false, motivo: 'VERIFICADOR_AUSENTE',
      explicacao: 'O arquivo "PERFIS E PERMISSÕES DINÂMICOS" não está no ' +
                  'projeto. Sem ele não há como verificar, então nega.' };
  }

  try {
    var r = AP_PERM_pode({
      perfil: perfilLimpo,
      modulo: moduloLimpo,
      tela: '',
      acao: acaoCadastro
    });
    return {
      permitido: !!(r && r.permitido),
      motivo: (r && r.motivo) || 'SEM_REGRA',
      explicacao: (r && r.explicacao) || '',
      acaoTraduzida: acaoCadastro
    };
  } catch (e) {
    return { permitido: false, motivo: 'ERRO_NA_VERIFICACAO',
      explicacao: 'A verificação falhou: ' + ((e && e.message) || e) +
                  '. Em caso de erro, nega.' };
  }
}


/* ============================================================
   DIAGNÓSTICO — rode no editor
   ============================================================ */

/**
 * Diz se a PARTE_11 está de pé e se o cadastro tem conteúdo.
 * Sem perfis cadastrados, todo mundo que não for admin é negado:
 * é a regra do sistema, e convém saber disso antes de achar que
 * é defeito.
 */
function AP_Permissions_diagnostico() {
  var linhas = ['=== PARTE 11 · PERMISSÕES  v' + AP_PERMISSIONS.versao + ' ===', ''];

  var temVerificador = (typeof AP_PERM_pode === 'function');
  linhas.push((temVerificador ? '  [ok]    ' : '  [falta] ') +
    'Verificador AP_PERM_pode  (PERFIS E PERMISSÕES DINÂMICOS)');

  var temPonte = (typeof AP_BRIDGE_chamar_ === 'function');
  linhas.push((temPonte ? '  [ok]    ' : '  [falta] ') +
    'Ponte AP_BRIDGE_chamar_  (PONTE FRONTEND ↔ CORE MASTER)');

  var perfis = [];
  var regras = [];
  if (typeof AP_PERM_todos_ === 'function') {
    try { perfis = AP_PERM_todos_('perfis') || []; } catch (e) {}
    try { regras = AP_PERM_todos_('permissoes') || []; } catch (e) {}
  }
  linhas.push('');
  linhas.push('  Perfis cadastrados:     ' + perfis.length);
  linhas.push('  Regras de permissão:    ' + regras.length);

  if (!perfis.length) {
    linhas.push('');
    linhas.push('  ATENÇÃO: nenhum perfil cadastrado.');
    linhas.push('  Todo perfil que não seja admin será negado.');
    linhas.push('  Rode AP_PERM_semear() para criar os perfis iniciais.');
  }

  linhas.push('');
  linhas.push('  Tradução de ações:');
  Object.keys(AP_PERMISSIONS_ACOES).forEach(function (k) {
    linhas.push('     ' + k + '  →  ' + AP_PERMISSIONS_ACOES[k]);
  });

  linhas.push('');
  linhas.push('  Teste rápido (admin, estoque, READ): ' +
    (temVerificador ? AP_Permissions_can_('admin', 'estoque', 'READ') : 'não verificável'));

  var texto = linhas.join('\n');
  Logger.log(texto);
  return texto;
}
