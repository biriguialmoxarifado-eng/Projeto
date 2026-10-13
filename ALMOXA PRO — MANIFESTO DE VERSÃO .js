/**
 * ALMOXA PRO — MANIFESTO DE VERSÃO (a fonte oficial do que é "a versão atual")
 * ============================================================================
 * Contrato: versao.v1
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * ---------------------------
 * "O sistema volta para a tela azul antiga depois que eu fecho, atualizo ou
 *  abro outra aba."
 *
 * Quando o mesmo sistema é servido de DOIS lugares — a hospedagem do
 * front-end e o /exec do Apps Script, que também sabe devolver HTML — cada
 * endereço entrega a cópia que tem. Uma delas é velha. Nenhuma das duas está
 * com defeito: elas estão com IDADES diferentes, e o navegador não tem como
 * saber disso sozinho. Enquanto não existir um lugar que diga "a versão
 * oficial é esta", qualquer cópia pode parecer a certa.
 *
 * Este arquivo é esse lugar. Ele NÃO serve o HTML, NÃO decide hospedagem e
 * NÃO muda nada no Core: ele só guarda, com data e assinatura, QUAL é a
 * versão publicada e quais arquivos fazem parte dela. Quem lê isso é o
 * ALMOXA_PRO_BootSync.js, no navegador, antes de liberar o Dashboard.
 *
 * O QUE ELE FAZ
 *   versao.manifesto     devolve a versão oficial  (NÃO exige sessão: a
 *                        conferência acontece ANTES de alguém entrar)
 *   versao.publicar      registra uma versão nova  (exige sessão)
 *   versao.voltar        volta para a versão anterior do manifesto
 *   versao.historico     as últimas versões registradas
 *   versao.registrar     o navegador relata o que carregou (diagnóstico)
 *   versao.diagnostico   manifesto + últimos relatos + onde está guardado
 *   versao.contrato      nome e versão do contrato
 *
 * O QUE ELE NÃO FAZ — e cada linha aqui é uma regra dele
 *   · Não serve HTML, não cria doGet, não cria outra porta e não encosta no
 *     doPost existente. A porta continua sendo uma só.
 *   · Não apaga nem sobrescreve o manifesto anterior: guarda histórico, e o
 *     "voltar" existe justamente porque publicação errada acontece.
 *   · Não troca o manifesto oficial antes de validar o que recebeu. Pacote
 *     incompleto não vira versão oficial.
 *   · Não guarda dado de negócio, usuário, nota ou estoque. Só versão.
 *   · Não executa nada que receba. Ele guarda texto e devolve texto.
 *
 * ONDE FICA GUARDADO
 *   PropertiesService do script:
 *     ALMOXA_MANIFESTO        o manifesto oficial (JSON)
 *     ALMOXA_MANIFESTO_HIST   as últimas 10 versões (JSON)
 *     ALMOXA_MANIFESTO_BOOTS  os últimos 20 relatos de abertura (JSON)
 *   Não cria aba, não cria planilha, não cria pasta.
 *
 * INSTALAÇÃO
 *   1. No editor do Apps Script: + > Script, nome ALMOXA_PRO_Modulo_Versao.
 *   2. Cole este conteúdo inteiro e salve.
 *   3. Confira que o ALMOXA_PRO_API_UNICA está na versão 6 (a que tem a rota
 *      "versao"). Sem a rota, o módulo existe e ninguém alcança.
 *   4. Implantar > Gerenciar implantações > lápis > Nova versão > Implantar.
 *   5. Rode ALMOXA_VERSAO_INSTALAR pelo editor e leia o registro: ele diz o
 *      que ficou guardado e o que falta.
 *
 * ONDE PROCURAR ERRO
 *   SEM_SESSAO        publicar e voltar exigem sessão aberta
 *   PACOTE_INVALIDO   faltou versão, endereço ou lista de recursos
 *   NADA_PUBLICADO    ninguém registrou versão ainda
 *   SEM_ANTERIOR      não há versão anterior para onde voltar
 * ============================================================================
 */

var VER_CONTRATO = 'versao.v1';
var VER_PROP        = 'ALMOXA_MANIFESTO';
var VER_PROP_HIST   = 'ALMOXA_MANIFESTO_HIST';
var VER_PROP_BOOTS  = 'ALMOXA_MANIFESTO_BOOTS';
var VER_HIST_MAX    = 10;
var VER_BOOTS_MAX   = 20;


/* ============================================================
   1. A PORTA DO MÓDULO
   ============================================================ */

function AP_VERSAO_direto(json) {
  var p = {};
  try { p = JSON.parse(json || '{}'); } catch (e) {
    return JSON.stringify(VER_erro_('CORPO_INVALIDO', 'O pedido não veio em JSON.'));
  }
  return JSON.stringify(VER_atender_(p));
}
function AP_Modulo_versao(json) { return AP_VERSAO_direto(json); }

function VER_atender_(p) {
  p = p || {};
  var acao = String(p.acao || p.operacao || '');
  var carga = p.payload || {};
  var quem = p.sessao || p.token || null;
  try {
    switch (acao) {
      /* LEITURA PÚBLICA, de propósito: o BootSync precisa saber qual é a
         versão oficial ANTES de a pessoa entrar. Aqui não sai nenhum dado
         de negócio — sai o número da versão e o endereço oficial, que já
         estão à vista de quem abre o sistema. */
      case 'manifesto':   return VER_manifesto_();
      case 'contrato':    return VER_ok_({ contrato: VER_CONTRATO,
                            acoes: ['manifesto','publicar','voltar','historico',
                                    'registrar','diagnostico','contrato'] });
      case 'registrar':   return VER_registrarBoot_(carga);

      /* ESCRITA: exige sessão */
      case 'publicar':    return VER_publicar_(carga, quem);
      case 'voltar':      return VER_voltar_(quem);
      case 'historico':   return VER_historico_(quem);
      case 'diagnostico': return VER_diagnostico_(quem);
      default:
        return VER_erro_('ACAO_DESCONHECIDA',
          'versao.' + acao + ' não existe. As ações são: manifesto, publicar, ' +
          'voltar, historico, registrar, diagnostico, contrato.');
    }
  } catch (e) {
    return VER_erro_('ESTOUROU', String((e && e.message) || e));
  }
}

function VER_ok_(dados, mensagem, extra) {
  var r = { ok: true, dados: dados === undefined ? null : dados,
    mensagem: mensagem || '', contrato: VER_CONTRATO };
  if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) r[k] = extra[k];
  return r;
}
function VER_erro_(codigo, mensagem) {
  return { ok: false, codigo: codigo, mensagem: mensagem, contrato: VER_CONTRATO, dados: null };
}

function VER_props_()  { return PropertiesService.getScriptProperties(); }
function VER_agora_()  { return new Date().toISOString(); }
function VER_texto_(v) { return String(v === undefined || v === null ? '' : v).trim(); }

function VER_ler_(chave, padrao) {
  try {
    var t = VER_props_().getProperty(chave);
    if (!t) return padrao;
    var o = JSON.parse(t);
    return (o === null || o === undefined) ? padrao : o;
  } catch (e) { return padrao; }
}
function VER_gravar_(chave, valor) {
  VER_props_().setProperty(chave, JSON.stringify(valor));
}

/** Quem está pedindo. Sem inventar permissão: se o Core souber dizer, ele diz. */
function VER_quem_(quem) {
  var fora = { usuario: '', perfil: '', conferido: false };
  if (!quem) return fora;
  try {
    if (typeof AP_SESSAO_conferir === 'function') {
      var s = AP_SESSAO_conferir(quem);
      if (s && (s.ok || s.usuario)) {
        return { usuario: (s.usuario && s.usuario.nome) || s.usuario || '',
          perfil: (s.usuario && s.usuario.perfil) || s.perfil || '', conferido: true };
      }
    }
  } catch (e) {}
  /* o Core deste projeto nem sempre expõe o conferidor de sessão. Sem ele,
     eu aceito o token como presença de sessão — e NÃO como prova de perfil.
     Nenhuma decisão de permissão é tomada aqui com base no navegador. */
  return { usuario: '', perfil: '', conferido: !!VER_texto_(quem) };
}


/* ============================================================
   2. LER O MANIFESTO  (a pergunta que o BootSync faz)
   ============================================================ */

function VER_manifesto_() {
  var m = VER_ler_(VER_PROP, null);
  if (!m) {
    return VER_erro_('NADA_PUBLICADO',
      'Ainda não há versão oficial registrada. Publique uma pela tela ' +
      '(Configurações > Versão do sistema) ou rode ALMOXA_VERSAO_REGISTRAR_ESTA pelo editor.');
  }
  m.servidorAgora = VER_agora_();
  return VER_ok_(m);
}


/* ============================================================
   3. PUBLICAR UMA VERSÃO
   ------------------------------------------------------------
   A ordem importa e é a do pedido dele: guardar, validar, e só
   então trocar o oficial. Pacote que não passa na validação não
   vira versão oficial — o anterior continua valendo.
   ============================================================ */

function VER_publicar_(p, quem) {
  var eu = VER_quem_(quem);
  if (!eu.conferido) {
    return VER_erro_('SEM_SESSAO', 'Publicar uma versão exige sessão aberta.');
  }
  p = p || {};

  var versao   = VER_texto_(p.versao);
  var endereco = VER_texto_(p.enderecoOficial || p.endereco);
  var recursos = VER_listaDeRecursos_(p.recursos);

  var faltou = [];
  if (!versao)  faltou.push('a versão (o texto que aparece na barra, ex.: "sistema 257 · 12/10")');
  if (!endereco) faltou.push('o endereço oficial do front-end');
  if (!recursos.length) faltou.push('a lista de arquivos da versão');
  if (faltou.length) {
    return VER_erro_('PACOTE_INVALIDO', 'Faltou: ' + faltou.join('; ') + '.');
  }
  if (!/^https:\/\//i.test(endereco)) {
    return VER_erro_('PACOTE_INVALIDO',
      'O endereço oficial precisa começar com https:// — veio "' + endereco + '".');
  }

  /* VALIDAR ANTES DE TROCAR. Um recurso sem nome, ou com tamanho zero, é
     publicação pela metade: é exatamente o caso em que o navegador baixa
     um arquivo vazio e a tela "volta" para o estado anterior. */
  var ruins = [];
  recursos.forEach(function (r) {
    if (!r.nome) ruins.push('um recurso sem nome');
    else if (r.bytes !== null && r.bytes <= 0) ruins.push(r.nome + ' veio com 0 byte');
  });
  if (ruins.length) {
    return VER_erro_('PACOTE_INVALIDO',
      'Não troquei a versão oficial: ' + ruins.join('; ') + '. A anterior continua valendo.');
  }

  var anterior = VER_ler_(VER_PROP, null);
  if (anterior && VER_texto_(anterior.versao) === versao && !p.forcar) {
    return VER_ok_(anterior, 'Esta versão já era a oficial. Nada mudou.',
      { jaEra: true });
  }

  var novo = {
    versao: versao,
    numero: VER_numeroDaVersao_(versao, p.numero),
    publicadoEm: VER_agora_(),
    publicadoPor: eu.usuario || VER_texto_(p.publicadoPor) || 'sessão sem nome',
    enderecoOficial: endereco,
    recursos: recursos,
    notas: VER_texto_(p.notas).slice(0, 500),
    selo: VER_selo_(versao, recursos)
  };

  /* o anterior vai para o histórico ANTES de o novo entrar: é assim que o
     "voltar" tem para onde voltar */
  if (anterior) {
    var hist = VER_ler_(VER_PROP_HIST, []);
    if (!Array.isArray(hist)) hist = [];
    hist.unshift(anterior);
    VER_gravar_(VER_PROP_HIST, hist.slice(0, VER_HIST_MAX));
  }
  VER_gravar_(VER_PROP, novo);

  /* confere relendo: gravou mesmo? */
  var conferido = VER_ler_(VER_PROP, null);
  if (!conferido || VER_texto_(conferido.versao) !== versao) {
    return VER_erro_('NAO_CONFERIU',
      'Mandei gravar e a releitura não trouxe a versão nova. Não considere publicado.');
  }

  VER_anotarAuditoria_('publicar', novo, eu);
  return VER_ok_(conferido, 'Versão oficial agora é ' + versao + '.');
}

function VER_listaDeRecursos_(v) {
  var fora = [];
  if (!v) return fora;
  var lista = Array.isArray(v) ? v : [v];
  lista.forEach(function (r) {
    if (!r) return;
    if (typeof r === 'string') { fora.push({ nome: VER_texto_(r), bytes: null, marca: '' }); return; }
    fora.push({
      nome: VER_texto_(r.nome || r.arquivo || r.path),
      bytes: (r.bytes === undefined || r.bytes === null) ? null : Number(r.bytes) || 0,
      marca: VER_texto_(r.marca || r.hash).slice(0, 64)
    });
  });
  return fora;
}

/** "sistema 257 · 12/10" → 257. Serve para comparar idade sem depender de data. */
function VER_numeroDaVersao_(versao, dado) {
  var n = Number(dado);
  if (n > 0) return n;
  var m = String(versao || '').match(/(\d{1,6})/);
  return m ? Number(m[1]) : 0;
}

/** Um selo simples do conjunto, para o navegador perceber troca de conteúdo
    mesmo quando o número da versão não muda. Não é segurança: é conferência. */
function VER_selo_(versao, recursos) {
  var txt = String(versao) + '|' + recursos.map(function (r) {
    return r.nome + ':' + (r.bytes === null ? '?' : r.bytes) + ':' + (r.marca || '');
  }).join(',');
  var soma = 0;
  for (var i = 0; i < txt.length; i++) {
    soma = ((soma << 5) - soma + txt.charCodeAt(i)) | 0;
  }
  return 'sel' + Math.abs(soma).toString(36);
}


/* ============================================================
   4. VOLTAR PARA A VERSÃO ANTERIOR
   ============================================================ */

function VER_voltar_(quem) {
  var eu = VER_quem_(quem);
  if (!eu.conferido) return VER_erro_('SEM_SESSAO', 'Voltar a versão exige sessão aberta.');

  var hist = VER_ler_(VER_PROP_HIST, []);
  if (!Array.isArray(hist) || !hist.length) {
    return VER_erro_('SEM_ANTERIOR', 'Não há versão anterior registrada para onde voltar.');
  }
  var atual = VER_ler_(VER_PROP, null);
  var volta = hist.shift();
  VER_gravar_(VER_PROP_HIST, hist);
  if (atual) {
    /* o que estava valendo não some: entra no histórico, para dar para ir e
       voltar sem perder nenhum dos dois */
    var h2 = VER_ler_(VER_PROP_HIST, []);
    if (!Array.isArray(h2)) h2 = [];
    h2.unshift(atual);
    VER_gravar_(VER_PROP_HIST, h2.slice(0, VER_HIST_MAX));
  }
  VER_gravar_(VER_PROP, volta);
  VER_anotarAuditoria_('voltar', volta, eu);
  return VER_ok_(volta, 'Voltei para a versão ' + VER_texto_(volta.versao) + '.');
}

function VER_historico_(quem) {
  var eu = VER_quem_(quem);
  if (!eu.conferido) return VER_erro_('SEM_SESSAO', 'O histórico exige sessão aberta.');
  return VER_ok_({ atual: VER_ler_(VER_PROP, null), anteriores: VER_ler_(VER_PROP_HIST, []) });
}


/* ============================================================
   5. O QUE CADA NAVEGADOR CARREGOU
   ------------------------------------------------------------
   É o único jeito de responder "de onde está vindo a tela azul".
   Guardo pouco e guardo curto: versão, origem e resultado. Sem
   nome de usuário, sem token, sem dado pessoal.
   ============================================================ */

function VER_registrarBoot_(p) {
  p = p || {};
  var relato = {
    quando: VER_agora_(),
    versaoLocal: VER_texto_(p.versaoLocal).slice(0, 60),
    versaoOficial: VER_texto_(p.versaoOficial).slice(0, 60),
    origem: VER_texto_(p.origem).slice(0, 200),
    resultado: VER_texto_(p.resultado).slice(0, 40),
    erro: VER_texto_(p.erro).slice(0, 200)
  };
  var boots = VER_ler_(VER_PROP_BOOTS, []);
  if (!Array.isArray(boots)) boots = [];
  boots.unshift(relato);
  VER_gravar_(VER_PROP_BOOTS, boots.slice(0, VER_BOOTS_MAX));
  return VER_ok_({ anotado: true }, '');
}

function VER_diagnostico_(quem) {
  var eu = VER_quem_(quem);
  if (!eu.conferido) return VER_erro_('SEM_SESSAO', 'O diagnóstico exige sessão aberta.');
  var m = VER_ler_(VER_PROP, null);
  var boots = VER_ler_(VER_PROP_BOOTS, []);
  var origens = {};
  (Array.isArray(boots) ? boots : []).forEach(function (b) {
    var k = VER_texto_(b.origem) || '(sem origem)';
    origens[k] = origens[k] || { quantos: 0, versoes: {} };
    origens[k].quantos++;
    var v = VER_texto_(b.versaoLocal) || '(sem versão)';
    origens[k].versoes[v] = (origens[k].versoes[v] || 0) + 1;
  });
  return VER_ok_({
    manifesto: m,
    temManifesto: !!m,
    historico: (VER_ler_(VER_PROP_HIST, []) || []).length,
    aberturas: boots,
    porOrigem: origens,
    guardadoEm: 'PropertiesService do script (' + VER_PROP + ')'
  });
}

function VER_anotarAuditoria_(acao, manifesto, eu) {
  try {
    if (typeof REPO_registrarAuditoria === 'function') {
      REPO_registrarAuditoria({
        conjunto: 'auditoria', operacao: 'versao.' + acao,
        id: VER_texto_(manifesto && manifesto.versao),
        resultado: 'OK', modulo: 'versao',
        detalhe: VER_texto_(manifesto && manifesto.enderecoOficial)
      }, { usuario: eu.usuario, perfil: eu.perfil });
    }
  } catch (e) {}
}


/* ============================================================
   6. PELO EDITOR
   ============================================================ */

function VER_LOG_(l) {
  var t = l.join('\n');
  try { Logger.log(t); } catch (e) {}
  return t;
}

/** Mostra o que está guardado agora. Não muda nada. */
function ALMOXA_VERSAO_INSTALAR() {
  var l = [];
  l.push('================================================================');
  l.push('   ALMOX-PRO — MANIFESTO DE VERSÃO · contrato ' + VER_CONTRATO);
  l.push('================================================================');
  l.push('');
  var m = VER_ler_(VER_PROP, null);
  if (!m) {
    l.push('NÃO HÁ VERSÃO OFICIAL REGISTRADA.');
    l.push('');
    l.push('Isso não é defeito: é o estado de quem ainda não publicou nenhuma.');
    l.push('Enquanto estiver assim, o BootSync abre o sistema normalmente e');
    l.push('avisa que não conseguiu confirmar a versão — ele nunca troca a sua');
    l.push('tela por uma antiga por falta de resposta.');
    l.push('');
    l.push('Para registrar a versão que está no ar agora, rode:');
    l.push('   ALMOXA_VERSAO_REGISTRAR_ESTA');
    l.push('(antes, ponha o endereço e a versão lá dentro).');
  } else {
    l.push('VERSÃO OFICIAL');
    l.push('   versão      : ' + m.versao + '   (número ' + m.numero + ')');
    l.push('   publicada em: ' + m.publicadoEm);
    l.push('   por         : ' + m.publicadoPor);
    l.push('   endereço    : ' + m.enderecoOficial);
    l.push('   selo        : ' + m.selo);
    l.push('   arquivos    : ' + (m.recursos || []).length);
    (m.recursos || []).forEach(function (r) {
      l.push('      · ' + r.nome + (r.bytes ? '  (' + r.bytes + ' bytes)' : ''));
    });
    if (m.notas) l.push('   notas       : ' + m.notas);
  }
  l.push('');
  var h = VER_ler_(VER_PROP_HIST, []);
  l.push('Versões anteriores guardadas: ' + ((h && h.length) || 0) +
    ((h && h.length) ? '  (versao.voltar leva para a primeira delas)' : ''));
  var b = VER_ler_(VER_PROP_BOOTS, []);
  l.push('Aberturas registradas       : ' + ((b && b.length) || 0));
  if (b && b.length) {
    l.push('');
    l.push('ÚLTIMAS ABERTURAS — é aqui que aparece de onde vem a tela antiga:');
    b.slice(0, 8).forEach(function (x) {
      l.push('   ' + x.quando.slice(0, 19).replace('T', ' ') +
        '  local=' + (x.versaoLocal || '?') +
        '  resultado=' + (x.resultado || '?'));
      l.push('      origem: ' + (x.origem || '?'));
    });
  }
  l.push('');
  l.push('ROTA: o ALMOXA_PRO_API_UNICA precisa estar na versão 6 (com a rota');
  l.push('"versao"). Sem ela este módulo existe e ninguém alcança.');
  return VER_LOG_(l);
}

/**
 * Registra a versão que está no ar AGORA como a oficial.
 * Preencha as três linhas abaixo e rode uma vez.
 */
function ALMOXA_VERSAO_REGISTRAR_ESTA() {
  var VERSAO    = 'sistema 258 · 13/10';
  var ENDERECO  = 'https://biriguialmoxarifado-eng.github.io/Projeto/';
  var ARQUIVOS  = ['index.html',
                   'ALMOXA_PRO_Sincronizacao_Visual.js',
                   'ALMOXA_PRO_BootSync.js'];

  var r = VER_publicar_({
    versao: VERSAO, enderecoOficial: ENDERECO,
    recursos: ARQUIVOS, notas: 'registrada pelo editor', forcar: true
  }, 'editor');
  return VER_LOG_([
    r.ok ? 'REGISTRADA: ' + VERSAO : 'NÃO REGISTRADA: ' + r.mensagem,
    '',
    r.ok ? 'Endereço oficial: ' + ENDERECO : '',
    r.ok ? 'Agora abra o sistema: o BootSync vai conferir contra isto.' : ''
  ]);
}

/** Apaga só os relatos de abertura. Não mexe no manifesto. */
function ALMOXA_VERSAO_LIMPAR_ABERTURAS() {
  VER_gravar_(VER_PROP_BOOTS, []);
  return VER_LOG_(['Relatos de abertura zerados. O manifesto continua como estava.']);
}

/** Teste pelo editor: publica, lê, volta e confere — sem tocar no manifesto real. */
function ALMOXA_VERSAO_TESTE() {
  var l = [];
  var guardado = VER_props_().getProperty(VER_PROP);
  var guardadoH = VER_props_().getProperty(VER_PROP_HIST);
  try {
    VER_props_().deleteProperty(VER_PROP);
    VER_props_().deleteProperty(VER_PROP_HIST);

    var vazio = VER_manifesto_();
    l.push((vazio.ok === false && vazio.codigo === 'NADA_PUBLICADO' ? 'ok  ' : 'ERRO ') +
      'sem manifesto, responde NADA_PUBLICADO');

    var semSessao = VER_publicar_({ versao: 'x', enderecoOficial: 'https://a/', recursos: ['i'] }, null);
    l.push((semSessao.ok === false && semSessao.codigo === 'SEM_SESSAO' ? 'ok  ' : 'ERRO ') +
      'publicar sem sessão é recusado');

    var meio = VER_publicar_({ versao: 'sistema 1', enderecoOficial: 'https://a/',
      recursos: [{ nome: 'index.html', bytes: 0 }] }, 'tok');
    l.push((meio.ok === false && meio.codigo === 'PACOTE_INVALIDO' ? 'ok  ' : 'ERRO ') +
      'arquivo com 0 byte NÃO vira versão oficial');

    var um = VER_publicar_({ versao: 'sistema 100 · 01/01', enderecoOficial: 'https://a/',
      recursos: [{ nome: 'index.html', bytes: 10 }] }, 'tok');
    l.push((um.ok ? 'ok  ' : 'ERRO ') + 'publicou a 100');

    var dois = VER_publicar_({ versao: 'sistema 101 · 02/01', enderecoOficial: 'https://a/',
      recursos: [{ nome: 'index.html', bytes: 12 }] }, 'tok');
    l.push((dois.ok && dois.dados.numero === 101 ? 'ok  ' : 'ERRO ') + 'publicou a 101 e leu o número');

    var volta = VER_voltar_('tok');
    l.push((volta.ok && VER_ler_(VER_PROP, {}).numero === 100 ? 'ok  ' : 'ERRO ') +
      'voltou para a 100');

    var dedup = VER_publicar_({ versao: 'sistema 100 · 01/01', enderecoOficial: 'https://a/',
      recursos: [{ nome: 'index.html', bytes: 10 }] }, 'tok');
    l.push((dedup.ok && dedup.jaEra ? 'ok  ' : 'ERRO ') + 'publicar a mesma versão não duplica');

  } finally {
    if (guardado) VER_props_().setProperty(VER_PROP, guardado);
    else VER_props_().deleteProperty(VER_PROP);
    if (guardadoH) VER_props_().setProperty(VER_PROP_HIST, guardadoH);
    else VER_props_().deleteProperty(VER_PROP_HIST);
    l.push('');
    l.push('o manifesto de verdade foi devolvido como estava.');
  }
  return VER_LOG_(l);
}
