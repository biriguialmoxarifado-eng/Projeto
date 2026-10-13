/**
 * ALMOXA PRO — API ÚNICA (a porta da rua)   ·   versão 6
 *
 * Este arquivo SUBSTITUI o ALMOXA_PRO_API_UNICA que você já tem, e
 * substitui qualquer outro arquivo de ponte que exista no projeto.
 * Ele é o único que pode ter doPost.
 *
 * ------------------------------------------------------------------
 * O QUE MUDOU DA VERSÃO 4 PARA ESTA
 * ------------------------------------------------------------------
 *  · UMA rota nova: 'juntar', para juntar cadastros repetidos da mesma
 *    pessoa. Ela precisa do arquivo ALMOXA_PRO_Modulo_JuntarCadastros.gs
 *    no projeto; sem ele a rota simplesmente não responde e nada quebra.
 *  · Mais NADA mudou. Mesmas rotas de antes, mesmo formato de resposta,
 *    mesmo doPost. Dá para colar por cima da versão 4 sem medo.
 *
 * ------------------------------------------------------------------
 * O QUE MUDOU DA VERSÃO 3 PARA A 4
 * ------------------------------------------------------------------
 *  · Todo pedido passa pelo SERVIDOR CENTRAL antes de chegar no módulo.
 *    É de lá que vem a chave de operação, que impede o mesmo
 *    lançamento de ser gravado duas ou três vezes.
 *  · Quem é o usuário passa a ser decidido AQUI, pelo token de sessão,
 *    e não pelo que o navegador diz ser. O navegador pode mentir.
 *  · Cada pedido fica registrado: quem, o quê, quanto tempo levou.
 *    Sem senha, sem token, sem o conteúdo do pedido.
 *  · Se o servidor central não estiver instalado, este arquivo funciona
 *    exatamente como a versão 3 funcionava. Nada quebra.
 *
 * O resto está igual: mesmas rotas, mesmas portas diretas dos módulos,
 * mesmo formato de resposta. Nenhuma tela precisa mudar para isto
 * entrar — a tela nova só acrescenta a chave de operação.
 *
 * ------------------------------------------------------------------
 * INSTALAÇÃO — leia, são 5 minutos
 * ------------------------------------------------------------------
 *  1. Instale primeiro o ALMOXA_PRO_Servidor_Central e rode
 *     ALMOXA_SERVIDOR_INSTALAR.
 *
 *  2. No editor, abra o arquivo ALMOXA_PRO_API_UNICA que já existe,
 *     apague tudo que tem dentro dele e cole este conteúdo.
 *     (Se ele não existir: + > Script, nome ALMOXA_PRO_API_UNICA.)
 *
 *  3. APAGUE os arquivos das pontes antigas. Isto é obrigatório:
 *       · o arquivo que contém  PONTE_encaminhar_   (ponte 1)
 *       · o arquivo que contém  PONTE_rotear_       (ponte 2)
 *     Nos três pontinhos ao lado do nome: Excluir.
 *     >>> Dois doPost no mesmo projeto brigam, e o Google escolhe um
 *         sem avisar qual. É daí que vem o CHAVE_INVALIDA. <<<
 *
 *  4. Se o seu projeto tiver um doGet (o que servia o HTML), abra ele e
 *     ponha estas duas linhas como PRIMEIRA coisa dentro dele:
 *
 *         var ponte = APIX_tratarGet(e);
 *         if (ponte) return ponte;
 *
 *  5. Rode  ALMOXA_CONFERIR_INSTALACAO  e leia o registro de execução.
 *
 *  6. Implantar > Gerenciar implantações > lápis >
 *     Versão: NOVA VERSÃO > Implantar.
 *     Confira: Executar como = Eu.  Quem pode acessar = Qualquer pessoa.
 *     Sem publicar nova versão, o endereço /exec continua entregando o
 *     código velho.
 *
 *  7. Na página do sistema, Ctrl+Shift+R.
 *
 * A CHAVE DO APLICATIVO não tem nenhuma relação com a CHAVE DO CRACHÁ.
 * Nada aqui apaga usuário, crachá, nota ou qualquer aba da planilha.
 */

var APIX_VERSAO = 4;


/* ============================================================
   1. A PORTA — a única do projeto
   ============================================================ */

function doPost(e) {
  var corpo;
  try {
    corpo = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return APIX_json_(APIX_erro_('CORPO_INVALIDO', 'O pedido não veio em JSON.'));
  }

  if (corpo.ponte !== 'ALMOXA') {
    return APIX_json_(APIX_erro_('NAO_E_PONTE',
      'Pedido fora do formato da ponte. Confira se o endereço em ALMOXA_CONFIG.API_URL '
      + 'é o /exec deste script.'));
  }

  if (!APIX_chaveConfere_(corpo.chave)) {
    return APIX_json_(APIX_erro_('CHAVE_APP_INVALIDA',
      'Este servidor está exigindo uma chave de aplicativo e a que chegou não confere. '
      + 'Rode ALMOXA_LIBERAR_FASE1 para dispensar a exigência, ou ALMOXA_VER_CHAVE para '
      + 'ver qual é. (Isto não tem relação com a chave do crachá.)'));
  }

  try {
    return APIX_json_(APIX_atender_(corpo));
  } catch (err) {
    return APIX_json_(APIX_erro_('API_ERRO', String((err && err.message) || err)));
  }
}

/** Chame isto no início do seu doGet, se você tiver um. */
function APIX_tratarGet(e) {
  var p = (e && e.parameter) || {};

  if (p.ponte === 'ping') {
    return APIX_json_({
      ok: true,
      codigo: 'CORE_ONLINE',
      mensagem: 'API disponível.',
      dados: {
        sistema: 'ALMOXA PRO',
        api: true,
        versaoPonte: APIX_VERSAO,
        servidorCentral: APIX_temServidorCentral_(),
        exigeChave: !!APIX_chaveGuardada_(),
        chaveConfere: APIX_chaveConfere_(p.chave),
        roteador: APIX_nomeDoRoteador_()
      }
    });
  }

  if (p.ponte === 'diagnostico') {
    return APIX_json_({
      ok: true,
      codigo: 'OK',
      mensagem: 'Diagnóstico da porta.',
      dados: APIX_retrato_()
    });
  }

  return null;
}


/* ============================================================
   2. QUEM ESTÁ PEDINDO
   ------------------------------------------------------------
   A identidade vem do TOKEN DE SESSÃO, conferido aqui.
   O que o navegador manda como perfil é só palpite dele —
   não serve como prova e não é usado para decidir nada.
   ============================================================ */

function APIX_quemE_(corpo) {
  var token = corpo.sessao || corpo.token || '';
  if (!token || typeof AP_Session_validate !== 'function') {
    return { usuario: '', perfil: '', dados: null, conferido: false };
  }
  try {
    var v = AP_Session_validate(String(token));
    if (v && v.ok && v.data) {
      return {
        usuario: v.data.usuario || v.data.matricula || v.data.email || '',
        perfil: v.data.perfil || '',
        dados: v.data,
        conferido: true
      };
    }
  } catch (e) {}
  return { usuario: '', perfil: '', dados: null, conferido: false };
}


/* ============================================================
   3. ATENDER — o servidor central na frente, o módulo atrás
   ============================================================ */

function APIX_temServidorCentral_() {
  return (typeof ASC_executar_ === 'function');
}

/**
 * A chave de operação pode vir de dois lugares:
 *   · no corpo do pedido (chaveOperacao / opKey)
 *   · dentro do payload, como __chaveOperacao
 * O segundo caminho existe para a tela não precisar mudar o formato
 * do pedido. Depois de lida, ela SAI do payload: nenhum módulo deve
 * receber um campo que não é dele.
 */
function APIX_tirarChaveDoPayload_(corpo) {
  var daqui = corpo.chaveOperacao || corpo.opKey || '';
  var p = corpo.payload;
  if (p && typeof p === 'object') {
    if (!daqui && p.__chaveOperacao) daqui = p.__chaveOperacao;
    try { delete p.__chaveOperacao; } catch (e) {}
  }
  return daqui;
}

function APIX_atender_(corpo) {
  var quem = APIX_quemE_(corpo);
  var chaveDaOperacao = APIX_tirarChaveDoPayload_(corpo);

  var req = {
    modulo: corpo.modulo,
    acao: corpo.acao,
    payload: corpo.payload || {},
    sessao: corpo.sessao || corpo.token || null,
    perfil: quem.perfil,              /* o conferido, não o que a tela disse */
    perfilDaTela: corpo.perfil || '', /* guardado só para diagnóstico */
    obra: corpo.obra || null,
    origem: corpo.origem || 'externo',
    chaveOperacao: chaveDaOperacao,
    quem: quem.usuario,
    sessaoDados: quem.dados,
    ts: Date.now()
  };

  if (!req.modulo || !req.acao) {
    return APIX_erro_('PEDIDO_INCOMPLETO', 'Informe o módulo e a ação.');
  }

  var trabalho = function () { return APIX_rotear_(req); };

  /* Com o servidor central instalado, tudo passa por ele. */
  if (APIX_temServidorCentral_()) {
    return APIX_padronizar_(ASC_executar_(req, trabalho));
  }

  /* Sem ele, funciona como a versão 3 funcionava. */
  return APIX_padronizar_(trabalho());
}


/* ============================================================
   4. O ROTEADOR — não decide nada, só encaminha
   ============================================================ */

/* Ações de crachá que o próprio sistema consulta sem sessão aberta. */
var APIX_CRACHA_SEM_SESSAO = ['validar', 'autorizar', 'niveis'];

function APIX_nomeDoRoteador_() {
  if (typeof almoxaApi === 'function') return 'almoxaApi';
  if (typeof AP_API === 'function') return 'AP_API';
  if (typeof apiAlmoxa === 'function') return 'apiAlmoxa';
  return '';
}

function APIX_chamarRoteador_(reqJson) {
  if (typeof almoxaApi === 'function') return almoxaApi(reqJson);
  if (typeof AP_API === 'function') return AP_API(reqJson);
  if (typeof apiAlmoxa === 'function') return apiAlmoxa(reqJson);
  return {
    ok: false,
    codigo: 'SEM_ROTEADOR',
    mensagem: 'Não encontrei a função almoxaApi neste projeto. '
      + 'Ela é o roteador do Core — sem ela a porta não tem para onde encaminhar.'
  };
}

function APIX_rotear_(req) {
  /* módulos que têm porta própria, quando instalados */
  if (req.modulo === 'nf' && typeof AP_NF_direto === 'function') {
    return APIX_padronizar_(AP_NF_direto(JSON.stringify({
      acao: req.acao, payload: req.payload, token: req.sessao,
      chaveOperacao: req.chaveOperacao
    })));
  }
  if (req.modulo === 'tarefas' && typeof AP_TAREFAS_direto === 'function') {
    return APIX_padronizar_(AP_TAREFAS_direto(JSON.stringify({
      acao: req.acao, payload: req.payload, token: req.sessao,
      chaveOperacao: req.chaveOperacao
    })));
  }
  if (req.modulo === 'permissoes' && typeof AP_PERMISSOES_direto === 'function') {
    return APIX_padronizar_(AP_PERMISSOES_direto(JSON.stringify({
      acao: req.acao, payload: req.payload, token: req.sessao,
      chaveOperacao: req.chaveOperacao
    })));
  }
  /* a identidade do colaborador — foto e assinatura — tem porta
     própria: é ela que decide onde a assinatura mora, para o
     navegador parar de adivinhar */
  if (req.modulo === 'identidade' && typeof AP_IDENTIDADE_direto === 'function') {
    return APIX_padronizar_(AP_IDENTIDADE_direto(JSON.stringify({
      acao: req.acao,
      payload: req.payload,
      sessao: req.sessao,
      token: req.sessao
    })));
  }
  /* o confronte fiscal guarda o resultado da conferência da nota.
     Ele NÃO confronta aqui — quem confronta é o motor na tela — e
     não lança estoque: só guarda a decisão e a auditoria. */
  if (req.modulo === 'confronte' && typeof AP_CONFRONTE_direto === 'function') {
    return APIX_padronizar_(AP_CONFRONTE_direto(JSON.stringify({
      acao: req.acao,
      payload: req.payload,
      sessao: req.sessao,
      token: req.sessao
    })));
  }
  /* [v5] JUNTAR CADASTROS REPETIDOS.
     Existe porque o módulo de usuários tem duas regras que se
     contradizem: mandando a matrícula ele diz "já existe" (achando o
     próprio cadastro que mandamos editar), e sem ela diz que é
     obrigatória. Não há pedido que passe nos dois.
     Este caminho fala direto com o repositório, onde os usuários
     moram, e por isso não esbarra nessas regras. Ele NÃO APAGA nada:
     só marca o cadastro repetido como bloqueado, guarda o estado
     anterior e sabe desfazer.
     Precisa do arquivo ALMOXA_PRO_Modulo_JuntarCadastros.gs. */
  if (req.modulo === 'juntar' && typeof AP_JUNTAR_direto === 'function') {
    return APIX_padronizar_(AP_JUNTAR_direto(JSON.stringify({
      acao: req.acao,
      payload: req.payload,
      sessao: req.sessao,
      token: req.sessao
    })));
  }
  /* [v6] MANIFESTO DE VERSÃO.
     Existe porque o sistema é servido de mais de um endereço e cada um
     entrega a cópia que tem. Sem um lugar que diga "a oficial é esta", o
     navegador não tem como saber que carregou uma antiga.
     A leitura (versao.manifesto) NÃO exige sessão de propósito: a
     conferência acontece antes de alguém entrar. Gravar exige.
     Precisa do arquivo ALMOXA_PRO_Modulo_Versao.gs. */
  if (req.modulo === 'versao' && typeof AP_VERSAO_direto === 'function') {
    return APIX_padronizar_(AP_VERSAO_direto(JSON.stringify({
      acao: req.acao,
      payload: req.payload,
      sessao: req.sessao,
      token: req.sessao
    })));
  }
  /* o repositório central no Drive fala o seu próprio idioma:
     operacao + payload, e a identidade vem do token, não do navegador */
  if (req.modulo === 'repo' && typeof REPO_direto === 'function') {
    return APIX_padronizar_(REPO_direto(JSON.stringify({
      operacao: req.acao,
      payload: req.payload,
      sessao: req.sessao,
      chaveOperacao: req.chaveOperacao
    })));
  }
  /* a migração das planilhas, para a tela poder mostrar acontecendo */
  if (req.modulo === 'migracao' && typeof MIG_direto === 'function') {
    return APIX_padronizar_(MIG_direto(JSON.stringify({
      operacao: req.acao, payload: req.payload, sessao: req.sessao
    })));
  }
  if (req.modulo === 'preconta' && typeof AP_PRECONTA_direto === 'function') {
    return APIX_padronizar_(AP_PRECONTA_direto(JSON.stringify({
      acao: req.acao, payload: req.payload, token: req.sessao,
      chaveOperacao: req.chaveOperacao
    })));
  }
  if (req.modulo === 'email' && typeof AP_EMAIL_direto === 'function') {
    return APIX_padronizar_(AP_EMAIL_direto(JSON.stringify({
      acao: req.acao, payload: req.payload, token: req.sessao,
      chaveOperacao: req.chaveOperacao
    })));
  }
  if (req.modulo === 'auth' && req.acao === 'loginCracha' && typeof AP_CRACHA_login === 'function') {
    return APIX_padronizar_(AP_CRACHA_login(req.payload));
  }
  if (req.modulo === 'cracha'
      && APIX_CRACHA_SEM_SESSAO.indexOf(req.acao) > -1
      && !req.sessao
      && typeof AP_CRACHA_direto === 'function') {
    return APIX_padronizar_(AP_CRACHA_direto(JSON.stringify({
      acao: req.acao, payload: req.payload
    })));
  }

  /* todo o resto segue pelo roteador de sempre.
     O Core recebe o pedido no mesmo formato de antes. */
  return APIX_padronizar_(APIX_chamarRoteador_(JSON.stringify({
    modulo: req.modulo,
    acao: req.acao,
    payload: req.payload,
    sessao: req.sessao,
    perfil: req.perfil,
    obra: req.obra,
    origem: req.origem,
    ts: req.ts
  })));
}


/* ============================================================
   5. RESPOSTA PADRÃO
   ============================================================ */

function APIX_padronizar_(bruto) {
  var r = bruto;
  if (typeof bruto === 'string') {
    try { r = JSON.parse(bruto); }
    catch (x) { return { ok: true, codigo: 'OK', mensagem: '', dados: bruto }; }
  }
  if (!r || typeof r !== 'object') {
    return APIX_erro_('RESPOSTA_VAZIA', 'O Core não respondeu.');
  }
  if (r.ok === undefined) return { ok: true, codigo: 'OK', mensagem: '', dados: r };

  var saida = {
    ok: !!r.ok,
    codigo: r.codigo || r.erro || (r.ok ? 'OK' : 'ERRO'),
    mensagem: r.mensagem || '',
    dados: r.dados !== undefined ? r.dados : null
  };
  /* campos que a tela já sabe ler, repassados só quando existem */
  if (r.exigeNovaSenha !== undefined) saida.exigeNovaSenha = r.exigeNovaSenha;
  if (r.liberado !== undefined) saida.liberado = r.liberado;
  if (r.atualizada !== undefined) saida.atualizada = r.atualizada;
  if (r.itens !== undefined) saida.itens = r.itens;
  /* Todo campo extra que o módulo mandou segue junto.
     ------------------------------------------------------------
     Antes esta função tinha uma lista fechada de campos permitidos,
     e tudo o que não estivesse nela era jogado fora em silêncio. Foi
     assim que o aviso de conflito de versão chegou na tela sem o
     nome de quem gravou e sem os números das versões: o repositório
     mandava, a porta descartava, e ninguém via o erro acontecer.
     Campo que o módulo decidiu mandar é problema do módulo, não da
     porta. A porta só padroniza o que é dela. */
  var RESERVADOS = { ok: 1, codigo: 1, erro: 1, mensagem: 1, dados: 1 };
  Object.keys(r).forEach(function (k) {
    if (RESERVADOS[k]) return;
    if (saida[k] !== undefined) return;
    if (r[k] === undefined) return;
    saida[k] = r[k];
  });
  return saida;
}

function APIX_erro_(codigo, mensagem) {
  return { ok: false, codigo: codigo, mensagem: mensagem, dados: null };
}

function APIX_json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


/* ============================================================
   6. A CHAVE DO APLICATIVO — opcional nesta fase
   ============================================================ */

function APIX_chaveGuardada_() {
  try {
    return PropertiesService.getScriptProperties().getProperty('PONTE_CHAVE') || '';
  } catch (e) { return ''; }
}

/** SEM chave guardada, a porta aceita. COM chave guardada, ela é exigida. */
function APIX_chaveConfere_(chave) {
  var guardada = APIX_chaveGuardada_();
  if (!guardada) return true;
  return String(chave || '') === guardada;
}


/* ============================================================
   7. CONFERÊNCIA — rode pelo editor
   ============================================================ */

function APIX_retrato_() {
  var r = {
    versao: APIX_VERSAO,
    exigeChave: !!APIX_chaveGuardada_(),
    roteador: APIX_nomeDoRoteador_(),
    servidorCentral: APIX_temServidorCentral_(),
    sessaoConferivel: (typeof AP_Session_validate === 'function'),
    ponteAntigaPresente: (typeof PONTE_encaminhar_ === 'function'),
    ponteV2Presente: (typeof PONTE_rotear_ === 'function'),
    corrigirChavePresente: (typeof ALMOXA_DIAGNOSTICO_DA_PORTA === 'function'),
    moduloNF: (typeof AP_NF_direto === 'function'),
    moduloIdentidade: (typeof AP_IDENTIDADE_direto === 'function'),
    moduloConfronte: (typeof AP_CONFRONTE_direto === 'function'),
    moduloTarefas: (typeof AP_TAREFAS_direto === 'function'),
    moduloEmail: (typeof AP_EMAIL_direto === 'function'),
    moduloPreConta: (typeof AP_PRECONTA_direto === 'function'),
    repositorio: (typeof REPO_direto === 'function'),
    moduloVersao: (typeof AP_VERSAO_direto === 'function'),
    contratoDoRepositorio: (typeof REPO_CONTRATO !== 'undefined') ? REPO_CONTRATO : '',
    moduloPermissoes: (typeof AP_PERMISSOES_direto === 'function'),
    loginCracha: (typeof AP_CRACHA_login === 'function'),
    crachaDireto: (typeof AP_CRACHA_direto === 'function')
  };
  /* o retrato do servidor central, se ele estiver aí */
  if (typeof ASC_retrato_ === 'function') {
    try {
      var s = ASC_retrato_();
      r.exigeChaveDeOperacao = s.exigeChaveDeOperacao;
      r.modoPermissao = s.modoPermissao;
      r.operacoesGuardadas = s.operacoesGuardadas;
      r.linhasDeLog = s.linhasDeLog;
    } catch (e) {}
  }
  return r;
}

/**
 * Diz, em português, se a instalação está de pé e o que falta.
 * Rode esta função e leia o Registro de execução.
 */
function ALMOXA_CONFERIR_INSTALACAO() {
  var d = APIX_retrato_();
  var l = [];
  var problemas = [];

  l.push('==================================================');
  l.push('   ALMOXA PRO — CONFERÊNCIA DA PORTA  (v' + APIX_VERSAO + ')');
  l.push('==================================================');
  l.push('');

  /* --- o que é obrigatório --- */
  if (d.ponteAntigaPresente) {
    problemas.push(
      'A PONTE ANTIGA AINDA ESTÁ NO PROJETO.\n'
      + '     Ela tem outro doPost e vai brigar com este.\n'
      + '     Ache o arquivo que contém PONTE_encaminhar_ e APAGUE esse arquivo.\n'
      + '     Enquanto ele existir, o erro CHAVE_INVALIDA pode voltar a qualquer momento.');
  }
  if (d.ponteV2Presente) {
    problemas.push(
      'A PONTE v2 TAMBÉM ESTÁ NO PROJETO.\n'
      + '     Ache o arquivo que contém PONTE_rotear_ e APAGUE esse arquivo.\n'
      + '     Só pode existir UMA porta: esta.');
  }
  if (d.corrigirChavePresente) {
    problemas.push(
      'O ARQUIVO ALMOXA_PRO_Corrigir_Chave AINDA ESTÁ NO PROJETO.\n'
      + '     Ele tem funções com o MESMO NOME das deste arquivo\n'
      + '     (ALMOXA_LIBERAR_FASE1, ALMOXA_VER_CHAVE, ALMOXA_QUEM_ATENDE).\n'
      + '     Quando dois arquivos têm a mesma função, o Google usa uma e\n'
      + '     descarta a outra sem avisar — e você fica sem saber qual rodou.\n'
      + '     Ache o arquivo que contém ALMOXA_DIAGNOSTICO_DA_PORTA e APAGUE.\n'
      + '     Tudo o que ele fazia está aqui dentro agora.');
  }
  if (!d.roteador) {
    problemas.push(
      'NÃO ACHEI O ROTEADOR DO CORE (almoxaApi).\n'
      + '     A porta não tem para onde encaminhar os pedidos.\n'
      + '     Confira se o arquivo principal do Core está no projeto.');
  }
  if (!d.servidorCentral) {
    problemas.push(
      'O SERVIDOR CENTRAL NÃO ESTÁ INSTALADO.\n'
      + '     Sem ele, a duplicação de lançamento continua acontecendo.\n'
      + '     Instale o arquivo ALMOXA_PRO_Servidor_Central e rode\n'
      + '     ALMOXA_SERVIDOR_INSTALAR.');
  }
  if (!d.sessaoConferivel) {
    problemas.push(
      'NÃO ACHEI AP_Session_validate.\n'
      + '     Sem ela, a porta não consegue conferir quem está pedindo, e o\n'
      + '     registro de operações fica sem o nome de quem fez.\n'
      + '     Confira se o arquivo de sessão do Core está no projeto.');
  }

  l.push('--- O ESSENCIAL ---');
  l.push('Roteador do Core (almoxaApi) : ' + (d.roteador ? 'OK — ' + d.roteador : 'NÃO ENCONTRADO'));
  l.push('Servidor central             : ' + (d.servidorCentral ? 'instalado' : 'NÃO INSTALADO'));
  l.push('Conferência de sessão        : ' + (d.sessaoConferivel ? 'OK' : 'NÃO ENCONTRADA'));
  l.push('Ponte antiga no projeto      : ' + (d.ponteAntigaPresente ? 'SIM — precisa apagar' : 'não (bom)'));
  l.push('Ponte v2 no projeto          : ' + (d.ponteV2Presente ? 'SIM — precisa apagar' : 'não (bom)'));
  l.push('Corrigir_Chave no projeto    : ' + (d.corrigirChavePresente ? 'SIM — precisa apagar' : 'não (bom)'));
  l.push('');

  if (d.servidorCentral) {
    l.push('--- O SERVIDOR CENTRAL ---');
    l.push('Chave de operação exigida : ' + (d.exigeChaveDeOperacao ? 'SIM' : 'não (fase 1)'));
    l.push('Permissão no servidor     : ' + (d.modoPermissao || '?'));
    l.push('Operações guardadas       : ' + (d.operacoesGuardadas || 0));
    l.push('Linhas de registro        : ' + (d.linhasDeLog || 0));
    l.push('');
  }

  l.push('--- A CHAVE DO APLICATIVO ---');
  if (d.exigeChave) {
    l.push('Exige chave  : SIM');
    l.push('');
    l.push('Escolha um:');
    l.push('  a) rode ALMOXA_LIBERAR_FASE1 para dispensar a exigência; ou');
    l.push('  b) rode ALMOXA_VER_CHAVE e cole a chave na tela de login.');
  } else {
    l.push('Exige chave  : não — FASE 1 ativa, a porta aceita a publicação.');
  }
  l.push('');
  l.push('--- MÓDULOS (opcionais) ---');
  l.push('Repositório no Drive (REPO)     : ' + (d.repositorio
    ? 'instalado — contrato ' + d.contratoDoRepositorio : 'não instalado'));
  l.push('Notas fiscais (AP_NF_direto)    : ' + (d.moduloNF ? 'instalado' : 'não instalado'));
  l.push('Permissões (AP_PERMISSOES_direto): ' + (d.moduloPermissoes ? 'instalado' : 'não instalado'));
  l.push('Pré-conta (AP_PRECONTA_direto)  : ' + (d.moduloPreConta ? 'instalado' : 'não instalado'));
  l.push('Tarefas (AP_TAREFAS_direto)     : ' + (d.moduloTarefas ? 'instalado' : 'não instalado'));
  l.push('E-mail (AP_EMAIL_direto)        : ' + (d.moduloEmail ? 'instalado' : 'não instalado'));
  l.push('Login por crachá                : ' + (d.loginCracha ? 'instalado' : 'não instalado'));
  l.push('');

  if (problemas.length) {
    l.push('##################################################');
    l.push('  RESOLVA ISTO:');
    l.push('##################################################');
    problemas.forEach(function (p, i) { l.push('  ' + (i + 1) + '. ' + p); l.push(''); });
  } else {
    l.push('TUDO CERTO AQUI DENTRO.');
    l.push('');
    l.push('Se a tela ainda recusar, sobra uma destas duas:');
    l.push('  1. FALTA PUBLICAR NOVA VERSÃO.');
    l.push('     Implantar > Gerenciar implantações > lápis >');
    l.push('     Versão: Nova versão > Implantar.');
    l.push('     Enquanto não publicar, o /exec entrega o código velho.');
    l.push('  2. A página está apontando para OUTRO /exec.');
    l.push('     Compare ALMOXA_CONFIG.API_URL (no HTML) com o endereço');
    l.push('     desta implantação.');
  }

  l.push('');
  l.push('Lembrete: chave do APLICATIVO e chave do CRACHÁ são coisas diferentes.');

  return APIX_LOG_(l);
}


/* ============================================================
   8. AS AÇÕES
   ============================================================ */

/** Fase 1: dispensa a exigência de chave do aplicativo. */
function ALMOXA_LIBERAR_FASE1() {
  PropertiesService.getScriptProperties().deleteProperty('PONTE_CHAVE');
  return APIX_LOG_([
    'Chave apagada. A porta agora aceita a publicação sem chave.',
    '',
    'FALTA PUBLICAR:',
    '  Implantar > Gerenciar implantações > lápis >',
    '  Versão: Nova versão > Implantar.',
    '',
    'Sem esse passo, o /exec continua entregando o código antigo.'
  ]);
}

/** Mostra a chave guardada hoje, para colar na tela de login. */
function ALMOXA_VER_CHAVE() {
  var chave = APIX_chaveGuardada_();
  if (!chave) {
    return APIX_LOG_(['Não existe chave guardada. A porta está em fase 1, aceitando sem chave.']);
  }
  return APIX_LOG_([
    'CHAVE DO APLICATIVO:', '', '    ' + chave, '',
    'Cole exatamente isto no campo da tela de login,',
    'ou em ALMOXA_CONFIG.API_CHAVE dentro do HTML.',
    '',
    'Não mande esta chave por WhatsApp nem deixe num arquivo público.'
  ]);
}

/** Cria uma chave nova. Use só se quiser mesmo exigir chave. */
function ALMOXA_CRIAR_CHAVE() {
  var chave = Utilities.getUuid().replace(/-/g, '').slice(0, 20);
  PropertiesService.getScriptProperties().setProperty('PONTE_CHAVE', chave);
  return APIX_LOG_([
    'CHAVE NOVA:', '', '    ' + chave, '',
    'Cole no campo da tela de login e publique nova versão.'
  ]);
}

/**
 * Faz um pedido de verdade ao Core, como a página faria.
 * Serve para provar que a porta e o banco estão conversando.
 */
function ALMOXA_TESTE_DE_FOGO() {
  var l = ['TESTE: o mesmo pedido que a tela de login faz.', ''];

  if (!APIX_nomeDoRoteador_()) {
    l.push('PAROU AQUI: não existe almoxaApi neste projeto.');
    return APIX_LOG_(l);
  }

  try {
    var r = APIX_atender_({ ponte: 'ALMOXA', modulo: 'usuarios', acao: 'contar', payload: {} });
    l.push('Resposta do Core:');
    l.push(JSON.stringify(r, null, 2));
    l.push('');
    if (r && r.ok && r.dados && typeof r.dados.total === 'number') {
      l.push('>>> A PORTA E O BANCO ESTÃO CONVERSANDO.');
      l.push('    Usuários na base oficial: ' + r.dados.total);
      if (!r.dados.total) {
        l.push('    (a base respondeu, mas está vazia — confira a aba USUARIOS)');
      }
    } else {
      l.push('>>> O Core respondeu, mas não do jeito esperado.');
      l.push('    Código: ' + (r && r.codigo));
      l.push('    Mensagem: ' + (r && r.mensagem));
    }
  } catch (e) {
    l.push('ERRO ao chamar o Core: ' + e.message);
    l.push('');
    l.push('Isto costuma ser permissão da planilha. Rode esta função uma vez');
    l.push('pelo editor e autorize o acesso quando o Google pedir.');
  }

  return APIX_LOG_(l);
}

/**
 * Diz QUEM está atendendo os pedidos hoje.
 * É a resposta para o mistério do CHAVE_INVALIDA: se aparecer mais de
 * uma ponte aqui, elas estão brigando e o Google escolhe uma sem avisar.
 */
function ALMOXA_QUEM_ATENDE() {
  var l = ['QUEM ESTÁ ATENDENDO OS PEDIDOS', ''];
  var achadas = [];
  if (typeof PONTE_encaminhar_ === 'function') achadas.push('ponte antiga (PONTE_encaminhar_)');
  if (typeof PONTE_rotear_ === 'function') achadas.push('ponte v2 (PONTE_rotear_)');
  achadas.push('API única v' + APIX_VERSAO + ' (este arquivo)');

  if (typeof ALMOXA_DIAGNOSTICO_DA_PORTA === 'function') {
    l.push('ATENÇÃO: o arquivo Corrigir_Chave também está no projeto, com');
    l.push('funções de nome igual às deste. Apague-o — veja ALMOXA_CONFERIR_INSTALACAO.');
    l.push('');
  }

  achadas.forEach(function (a, i) { l.push('  ' + (i + 1) + '. ' + a); });
  l.push('');
  if (achadas.length > 1) {
    l.push('>>> SÃO ' + achadas.length + ' PORTAS NO MESMO PROJETO.');
    l.push('    Cada uma define doPost. O Google carrega uma delas e');
    l.push('    descarta as outras, SEM AVISAR QUAL. Quando a escolhida');
    l.push('    é uma ponte antiga, aparece CHAVE_INVALIDA.');
    l.push('');
    l.push('    Apague os arquivos das pontes antigas. Só esta pode ficar.');
  } else {
    l.push('>>> UMA PORTA SÓ. É assim que tem que ser.');
  }
  l.push('');
  l.push('Servidor central instalado: ' + (APIX_temServidorCentral_() ? 'SIM' : 'NÃO'));
  return APIX_LOG_(l);
}


/* ============================================================ */

function APIX_LOG_(linhas) {
  var txt = linhas.join('\n');
  Logger.log(txt);
  return txt;
}
