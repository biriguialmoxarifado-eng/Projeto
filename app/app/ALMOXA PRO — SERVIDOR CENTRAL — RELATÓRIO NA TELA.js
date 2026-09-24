/* ============================================================
   ALMOXA PRO — SERVIDOR CENTRAL — RELATÓRIO NA TELA
   ------------------------------------------------------------
   POR QUE ESTE ARQUIVO EXISTE

   As funções do Core DEVOLVEM o resultado. Quem chama elas de
   dentro do sistema recebe tudo certinho — mas quem clica em
   Executar no editor não vê nada, porque o editor só mostra o
   que passou pelo Logger. Foi falha minha no arranjo: dei uma
   função que fala e um lugar que não escuta.

   Este arquivo é só o alto-falante. Ele NÃO refaz nenhuma regra,
   não tem lógica própria e não duplica nada do Core: chama as
   mesmas funções de lá e escreve o resultado no Registro de
   execução, em português.

   COMO USAR NO EDITOR

     verServidor()        → só olha. Não cria e não muda nada.
     instalarServidor()   → instala/confere e mostra o relatório.
     backupAgora()        → faz um backup manual e mostra o que copiou.

   Use verServidor() sempre que quiser saber como está a casa.
   Ele é seguro de rodar a qualquer hora, inclusive com o sistema
   em uso.
   ============================================================ */

function AP_SRV_falar_(texto) {
  try { Logger.log(texto); } catch (e) { }
  return texto;
}

/* ------------------------------------------------------------
   instalarServidor() — o que você roda depois de colar código novo
   ------------------------------------------------------------ */
function instalarServidor() {
  var r = inicializarServidorALMOXA_PRO();
  var l = [];
  l.push(r.texto || '(a instalação não devolveu relatório)');
  l.push('');
  l.push(r.ok
    ? '>>> RESULTADO: tudo certo.'
    : '>>> RESULTADO: terminou COM ERRO. Leia a lista de ERROS acima.');
  if (r.criados === 0 && r.reaproveitados > 0) {
    l.push('>>> Nada foi criado agora porque já estava tudo no lugar.');
    l.push('    Isso é o esperado da segunda execução em diante.');
  }
  return AP_SRV_falar_(l.join('\n'));
}

/* ------------------------------------------------------------
   verServidor() — a conferência completa, sem tocar em nada
   ------------------------------------------------------------ */
function verServidor() {
  var l = [];
  var mapa = AP_SRV_mapaDeIds();

  l.push('=== ALMOXA PRO — SERVIDOR CENTRAL ===');
  l.push('');

  if (!mapa.ok) {
    l.push('A pasta raiz ainda não foi registrada.');
    l.push('Rode instalarServidor() uma vez.');
    return AP_SRV_falar_(l.join('\n'));
  }

  l.push('Versão instalada ... ' + (mapa.versao || '(não registrada)'));
  l.push('Pasta raiz ......... ' + mapa.raiz);
  l.push('');

  var estrutura = validarEstruturaServidor();
  l.push('PASTAS');
  l.push('  no lugar ......... ' + estrutura.presentes.length);
  l.push('  faltando ......... ' + estrutura.ausentes.length);
  for (var i = 0; i < estrutura.ausentes.length; i++) l.push('      · ' + estrutura.ausentes[i]);

  var bancos = validarBancosDeDados();
  l.push('');
  l.push('PLANILHAS');
  l.push('  no lugar ......... ' + bancos.presentes.length);
  l.push('  faltando ......... ' + bancos.ausentes.length);
  for (var j = 0; j < bancos.ausentes.length; j++) l.push('      · ' + bancos.ausentes[j]);
  l.push('  próximas etapas .. ' + bancos.pendentes.length);

  var cab = validarCabecalhos();
  l.push('');
  l.push('CABEÇALHOS');
  l.push('  conferidos ....... ' + cab.conferidos);
  l.push('  com problema ..... ' + cab.problemas.length);
  for (var k = 0; k < cab.problemas.length; k++) {
    l.push('      · ' + cab.problemas[k].componente + ' — ' + cab.problemas[k].problema);
    l.push('        o que fazer: ' + cab.problemas[k].sugestao);
  }

  /* os módulos que já se registraram */
  try {
    var aba = AP_SRV_aba_('00_CORE/CORE_MODULOS');
    l.push('');
    l.push('MÓDULOS REGISTRADOS');
    if (!aba || aba.getLastRow() < 2) {
      l.push('  (nenhum ainda)');
    } else {
      var colunas = AP_SRV_colunasDe_(aba);
      var linhas = aba.getRange(2, 1, aba.getLastRow() - 1, aba.getLastColumn()).getValues();
      for (var m = 0; m < linhas.length; m++) {
        l.push('  · ' + linhas[m][colunas.indexOf('NOME_MODULO')] +
          '  v' + linhas[m][colunas.indexOf('VERSAO')] +
          '  [' + linhas[m][colunas.indexOf('STATUS')] + ']');
      }
    }
  } catch (falha) {
    l.push('  (não consegui ler CORE_MODULOS: ' + (falha && falha.message || falha) + ')');
  }

  var integridade = verificarIntegridade();
  l.push('');
  l.push(integridade.ok
    ? '>>> INTEGRIDADE: nenhum problema encontrado.'
    : '>>> INTEGRIDADE: ' + integridade.problemas.length + ' problema(s). Rode instalarServidor().');

  l.push('');
  l.push('ONDE ESTÁ CADA COISA');
  for (var caminho in mapa.itens) {
    if (!mapa.itens.hasOwnProperty(caminho)) continue;
    l.push('  ' + (caminho === '/' ? '(raiz)' : caminho) + '  →  ' + mapa.itens[caminho]);
  }

  return AP_SRV_falar_(l.join('\n'));
}

/* ------------------------------------------------------------
   backupAgora() — backup manual, com o resultado na tela
   ------------------------------------------------------------ */
function backupAgora() {
  var r = executarBackup({ tipo: 'MANUAL' });
  var l = [];
  l.push('=== BACKUP MANUAL ===');
  l.push('quando ....... ' + (r.quando || '-'));
  l.push('quem ......... ' + (r.usuario || '-'));
  l.push('pasta ........ ' + (r.pasta || '-'));
  l.push('copiadas ..... ' + ((r.copiados || []).length));
  for (var i = 0; i < (r.copiados || []).length; i++) l.push('      · ' + r.copiados[i]);
  if ((r.falhou || []).length) {
    l.push('NÃO COPIADAS:');
    for (var j = 0; j < r.falhou.length; j++) l.push('      · ' + r.falhou[j]);
  }
  l.push('');
  l.push(r.ok ? '>>> Backup concluído.' : '>>> Backup com problema: ' + (r.mensagem || ''));
  return AP_SRV_falar_(l.join('\n'));
}

/* ------------------------------------------------------------
   AP_SRV_RELATORIO_testes() — o alto-falante fala a verdade?
   Troca as funções do Core por versões de mentira e confere se o
   texto que sai bate com o que entrou. Não toca no seu Drive.
   ------------------------------------------------------------ */
function AP_SRV_RELATORIO_testes() {
  var log = [], falhas = 0;
  function ok(nome, passou, obs) {
    if (!passou) falhas++;
    log.push((passou ? 'PASSOU  ' : 'FALHOU  ') + nome + (obs ? '  [' + obs + ']' : ''));
  }

  var orig = {
    ini: inicializarServidorALMOXA_PRO, mapa: AP_SRV_mapaDeIds,
    est: validarEstruturaServidor, ban: validarBancosDeDados,
    cab: validarCabecalhos, integ: verificarIntegridade,
    aba: AP_SRV_aba_, cols: AP_SRV_colunasDe_, bk: executarBackup
  };

  try {
    /* ---------- caso 1: segunda execução, tudo no lugar ---------- */
    inicializarServidorALMOXA_PRO = function () {
      return { ok: true, criados: 0, reaproveitados: 34, erros: [], texto: 'Criados agora ......... 0' };
    };
    var t1 = instalarServidor();
    ok('instalarServidor mostra o texto do relatório', t1.indexOf('Criados agora') > -1);
    ok('avisa que nada foi criado porque já existia', t1.indexOf('já estava tudo no lugar') > -1);
    ok('diz que deu certo', t1.indexOf('tudo certo') > -1);

    /* ---------- caso 2: instalação com erro ---------- */
    inicializarServidorALMOXA_PRO = function () {
      return { ok: false, criados: 2, reaproveitados: 0, erros: ['deu ruim'], texto: 'ERROS:\n  · deu ruim' };
    };
    var t2 = instalarServidor();
    ok('erro na instalação aparece em letras claras', t2.indexOf('COM ERRO') > -1);
    ok('não diz "já estava tudo no lugar" quando criou coisa', t2.indexOf('já estava tudo no lugar') === -1);

    /* ---------- caso 3: servidor ainda não instalado ---------- */
    AP_SRV_mapaDeIds = function () { return { ok: false, raiz: '', versao: '', itens: {} }; };
    var t3 = verServidor();
    ok('sem instalação, manda instalar em vez de dar erro feio',
      t3.indexOf('ainda não foi registrada') > -1 && t3.indexOf('instalarServidor') > -1);

    /* ---------- caso 4: servidor instalado e saudável ---------- */
    AP_SRV_mapaDeIds = function () {
      return { ok: true, raiz: 'RAIZ-1', versao: '2.0.0-etapa1', itens: { '/': 'RAIZ-1', '00_CORE': 'P-1' } };
    };
    validarEstruturaServidor = function () { return { ok: true, presentes: ['a', 'b'], ausentes: [], pendentes: [] }; };
    validarBancosDeDados = function () { return { ok: true, presentes: ['x'], ausentes: [], pendentes: ['DB_USUARIOS'] }; };
    validarCabecalhos = function () { return { ok: true, conferidos: 9, problemas: [] }; };
    verificarIntegridade = function () { return { ok: true, problemas: [] }; };
    AP_SRV_aba_ = function () {
      return {
        getLastRow: function () { return 2; }, getLastColumn: function () { return 6; },
        getRange: function () {
          return {
            getValues: function () {
              return [['MOD-1', 'CORE', '2.0.0-etapa1', 'x.gs', 'desc', 'ATIVO']];
            }
          };
        }
      };
    };
    AP_SRV_colunasDe_ = function () {
      return ['ID_MODULO', 'NOME_MODULO', 'VERSAO', 'ARQUIVO', 'DESCRICAO', 'STATUS'];
    };
    var t4 = verServidor();
    ok('mostra a versão instalada', t4.indexOf('2.0.0-etapa1') > -1);
    ok('mostra o módulo CORE registrado', t4.indexOf('· CORE') > -1);
    ok('diz que a integridade está limpa', t4.indexOf('nenhum problema') > -1);
    ok('separa o que é de etapa futura do que está faltando',
      t4.indexOf('próximas etapas .. 1') > -1 && t4.indexOf('faltando ......... 0') > -1);
    ok('mostra onde está cada coisa', t4.indexOf('00_CORE  →  P-1') > -1);

    /* ---------- caso 5: falta coisa ---------- */
    validarEstruturaServidor = function () {
      return { ok: false, presentes: [], ausentes: ['04_BACKUP/BACKUP_SEMANAL'], pendentes: [] };
    };
    validarCabecalhos = function () {
      return {
        ok: false, conferidos: 9,
        problemas: [{ componente: '00_CORE/CORE_SESSOES', problema: 'faltam colunas: TOKEN_HASH', sugestao: 'rodar instalarServidor()' }]
      };
    };
    verificarIntegridade = function () { return { ok: false, problemas: [1, 2] }; };
    var t5 = verServidor();
    ok('aponta a pasta que falta pelo nome', t5.indexOf('04_BACKUP/BACKUP_SEMANAL') > -1);
    ok('aponta a coluna que falta e o que fazer',
      t5.indexOf('TOKEN_HASH') > -1 && t5.indexOf('rodar instalarServidor()') > -1);
    ok('avisa quantos problemas de integridade', t5.indexOf('2 problema(s)') > -1);

    /* ---------- caso 6: backup ---------- */
    executarBackup = function () {
      return {
        ok: true, quando: '2026-09-20 17:00:00', usuario: 'ismael', pasta: 'BK-1',
        copiados: ['00_CORE/CORE_MODULOS'], falhou: [], mensagem: '1 copiada'
      };
    };
    var t6 = backupAgora();
    ok('o backup mostra o que copiou', t6.indexOf('00_CORE/CORE_MODULOS') > -1 && t6.indexOf('concluído') > -1);

    executarBackup = function () {
      return { ok: false, copiados: [], falhou: ['00_CORE/CORE_MODULOS (sem permissão)'], mensagem: 'falhou' };
    };
    var t7 = backupAgora();
    ok('o backup que falhou não se anuncia como concluído',
      t7.indexOf('NÃO COPIADAS') > -1 && t7.indexOf('concluído') === -1);

  } catch (explodiu) {
    falhas++;
    log.push('FALHOU  o teste explodiu: ' + (explodiu && explodiu.stack || explodiu));
  } finally {
    inicializarServidorALMOXA_PRO = orig.ini;
    AP_SRV_mapaDeIds = orig.mapa;
    validarEstruturaServidor = orig.est;
    validarBancosDeDados = orig.ban;
    validarCabecalhos = orig.cab;
    verificarIntegridade = orig.integ;
    AP_SRV_aba_ = orig.aba;
    AP_SRV_colunasDe_ = orig.cols;
    executarBackup = orig.bk;
  }

  var texto = '=== RELATÓRIO — ' +
    (falhas ? falhas + ' FALHA(S) DE ' + log.length : 'TODOS OS ' + log.length + ' TESTES PASSARAM') +
    ' ===\n' + log.join('\n');
  AP_SRV_falar_(texto);
  return { ok: falhas === 0, total: log.length, falhas: falhas, texto: texto };
}
