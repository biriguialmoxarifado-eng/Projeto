/**
 * ALMOXA PRO — API ÚNICA (a porta da rua)
 *
 * Este arquivo SUBSTITUI qualquer arquivo de ponte/API que exista hoje
 * no projeto. Ele é o único que precisa ficar.
 *
 * ------------------------------------------------------------------
 * POR QUE ISTO VIROU NECESSÁRIO
 * ------------------------------------------------------------------
 * Enquanto o HTML era servido pelo próprio Apps Script, a tela falava
 * com o Core por dentro (google.script.run). Não havia porta, não havia
 * chave: era tudo a mesma casa.
 *
 * Agora que o HTML mora fora (rede, GitHub Pages, servidor próprio), a
 * tela precisa BATER NA PORTA da rua — o doPost deste script. E a ponte
 * antiga tinha uma tranca:
 *
 *     return !!guardada && String(chave) === guardada;
 *     // "sem chave definida, a ponte fica fechada"
 *
 * Ou seja: ela recusava tudo, inclusive quando não havia chave nenhuma.
 * Por isso o erro CHAVE_INVALIDA e por isso o banco não aparece — nenhum
 * pedido conseguia entrar.
 *
 * Aqui a regra é a combinada para a fase 1:
 *     sem chave guardada  ->  a porta aceita
 *     com chave guardada  ->  a chave é exigida
 *
 * A CHAVE DO APLICATIVO não tem nenhuma relação com a CHAVE DO CRACHÁ.
 *
 * ------------------------------------------------------------------
 * INSTALAÇÃO — leia, são 5 minutos
 * ------------------------------------------------------------------
 *  1. No editor do Apps Script, ache o arquivo que contém a função
 *     PONTE_encaminhar_  (é a ponte antiga).
 *     Nos três pontinhos ao lado do nome dele: Excluir.
 *     >>> ISTO É OBRIGATÓRIO. Dois doPost no mesmo projeto brigam,
 *         e o Google escolhe um sem avisar qual. <<<
 *
 *  2. + > Script, nome ALMOXA_PRO_API_UNICA, e cole este arquivo.
 *
 *  3. Se o seu projeto tiver um doGet (o que servia o HTML), abra ele e
 *     ponha estas duas linhas como PRIMEIRA coisa dentro dele:
 *
 *         var ponte = APIX_tratarGet(e);
 *         if (ponte) return ponte;
 *
 *     Se não tiver doGet nenhum, pule este passo: o login funciona
 *     assim mesmo (só o teste de ping da tela fica sem resposta).
 *
 *  4. Rode  ALMOXA_CONFERIR_INSTALACAO  e leia o registro de execução.
 *
 *  5. Implantar > Gerenciar implantações > lápis >
 *     Versão: NOVA VERSÃO > Implantar.
 *     Confira: Executar como = Eu.  Quem pode acessar = Qualquer pessoa.
 *     Sem publicar nova versão, o endereço /exec continua entregando o
 *     código velho.
 *
 *  6. Na página do sistema, Ctrl+Shift+R.
 *
 * Nada aqui apaga usuário, crachá, nota ou qualquer aba da planilha.
 */


/* ============================================================
   1. A PORTA
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
    return APIX_json_(APIX_rotear_(corpo));
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
        versaoPonte: 3,
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
   2. O ROTEADOR — não decide nada, só encaminha
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

function APIX_rotear_(c) {
  var req = {
    modulo: c.modulo,
    acao: c.acao,
    payload: c.payload || {},
    sessao: c.sessao || null,
    perfil: c.perfil || null,
    obra: c.obra || null,
    origem: c.origem || 'externo',
    ts: Date.now()
  };

  if (!req.modulo || !req.acao) {
    return APIX_erro_('PEDIDO_INCOMPLETO', 'Informe o módulo e a ação.');
  }

  /* módulos que têm porta própria, quando instalados */
  if (req.modulo === 'nf' && typeof AP_NF_direto === 'function') {
    return APIX_padronizar_(AP_NF_direto(JSON.stringify({
      acao: req.acao, payload: req.payload, token: req.sessao
    })));
  }
  if (req.modulo === 'tarefas' && typeof AP_TAREFAS_direto === 'function') {
    return APIX_padronizar_(AP_TAREFAS_direto(JSON.stringify({
      acao: req.acao, payload: req.payload, token: req.sessao
    })));
  }
  if (req.modulo === 'permissoes' && typeof AP_PERMISSOES_direto === 'function') {
    return APIX_padronizar_(AP_PERMISSOES_direto(JSON.stringify({
      acao: req.acao, payload: req.payload, token: req.sessao
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

  /* todo o resto segue pelo roteador de sempre */
  return APIX_padronizar_(APIX_chamarRoteador_(JSON.stringify(req)));
}


/* ============================================================
   3. RESPOSTA PADRÃO
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
  return {
    ok: !!r.ok,
    codigo: r.codigo || r.erro || (r.ok ? 'OK' : 'ERRO'),
    mensagem: r.mensagem || '',
    dados: r.dados !== undefined ? r.dados : null,
    exigeNovaSenha: r.exigeNovaSenha || undefined,
    liberado: r.liberado !== undefined ? r.liberado : undefined
  };
}

function APIX_erro_(codigo, mensagem) {
  return { ok: false, codigo: codigo, mensagem: mensagem, dados: null };
}

function APIX_json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


/* ============================================================
   4. A CHAVE — opcional nesta fase
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
   5. CONFERÊNCIA — rode pelo editor
   ============================================================ */

function APIX_retrato_() {
  return {
    chaveGuardada: APIX_chaveGuardada_(),
    exigeChave: !!APIX_chaveGuardada_(),
    roteador: APIX_nomeDoRoteador_(),
    pontEAntigaPresente: (typeof PONTE_encaminhar_ === 'function'),
    pontEV2Presente: (typeof PONTE_rotear_ === 'function'),
    moduloNF: (typeof AP_NF_direto === 'function'),
    moduloTarefas: (typeof AP_TAREFAS_direto === 'function'),
    moduloEmail: (typeof AP_EMAIL_direto === 'function'),
    loginCracha: (typeof AP_CRACHA_login === 'function'),
    crachaDireto: (typeof AP_CRACHA_direto === 'function')
  };
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
  l.push('   ALMOXA PRO — CONFERÊNCIA DA PORTA');
  l.push('==================================================');
  l.push('');

  /* --- o que é obrigatório --- */
  if (d.pontEAntigaPresente) {
    problemas.push(
      'A PONTE ANTIGA AINDA ESTÁ NO PROJETO.\n'
      + '     Ela tem outro doPost e vai brigar com este.\n'
      + '     Ache o arquivo que contém PONTE_encaminhar_ e APAGUE esse arquivo.\n'
      + '     Enquanto ele existir, o erro CHAVE_INVALIDA pode voltar a qualquer momento.');
  }
  if (d.pontEV2Presente) {
    problemas.push(
      'A PONTE v2 TAMBÉM ESTÁ NO PROJETO.\n'
      + '     Ache o arquivo que contém PONTE_rotear_ e APAGUE esse arquivo.\n'
      + '     Só pode existir UMA porta: esta.');
  }
  if (!d.roteador) {
    problemas.push(
      'NÃO ACHEI O ROTEADOR DO CORE (almoxaApi).\n'
      + '     A porta não tem para onde encaminhar os pedidos.\n'
      + '     Confira se o arquivo principal do Core está no projeto.');
  }

  l.push('--- O ESSENCIAL ---');
  l.push('Roteador do Core (almoxaApi) : ' + (d.roteador ? 'OK — ' + d.roteador : 'NÃO ENCONTRADO'));
  l.push('Ponte antiga no projeto      : ' + (d.pontEAntigaPresente ? 'SIM — precisa apagar' : 'não (bom)'));
  l.push('Ponte v2 no projeto          : ' + (d.pontEV2Presente ? 'SIM — precisa apagar' : 'não (bom)'));
  l.push('');
  l.push('--- A CHAVE DO APLICATIVO ---');
  if (d.exigeChave) {
    l.push('Exige chave  : SIM');
    l.push('Chave atual  : ' + d.chaveGuardada);
    l.push('');
    l.push('Escolha um:');
    l.push('  a) rode ALMOXA_LIBERAR_FASE1 para dispensar a exigência; ou');
    l.push('  b) cole a chave acima no campo que a tela de login mostra.');
  } else {
    l.push('Exige chave  : não — FASE 1 ativa, a porta aceita a publicação.');
  }
  l.push('');
  l.push('--- MÓDULOS (opcionais) ---');
  l.push('Notas fiscais (AP_NF_direto)   : ' + (d.moduloNF ? 'instalado' : 'não instalado'));
  l.push('Tarefas (AP_TAREFAS_direto)    : ' + (d.moduloTarefas ? 'instalado' : 'não instalado'));
  l.push('E-mail (AP_EMAIL_direto)       : ' + (d.moduloEmail ? 'instalado' : 'não instalado'));
  l.push('Login por crachá               : ' + (d.loginCracha ? 'instalado' : 'não instalado'));
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
   6. AS AÇÕES
   ============================================================ */

/** Fase 1: dispensa a exigência de chave. */
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
    'ou em ALMOXA_CONFIG.API_CHAVE dentro do HTML.'
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
    var r = APIX_rotear_({ modulo: 'usuarios', acao: 'contar', payload: {} });
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


/* ============================================================ */

function APIX_LOG_(linhas) {
  var txt = linhas.join('\n');
  Logger.log(txt);
  return txt;
}
