/**
 * ============================================================
 * ALMOXA_ARRUMAR_SENHA.gs · 09/11/2026
 * ALMOX PRO · conserta a senha de um usuário
 * ------------------------------------------------------------
 * ISTO GRAVA. É a correção, não um relatório.
 *
 * O que ele faz, em uma frase: grava na coluna senha_hash o
 * SHA-256 da senha que o senhor escolher, do mesmo jeito que
 * está nos 212 cadastros que entram normalmente.
 *
 * Por que isso resolve: se os outros entram lendo essa mesma
 * coluna com um hash de 64, deixar esta linha no mesmo formato
 * a torna igual às que funcionam.
 *
 * ------------------------------------------------------------
 * O QUE ELE PROTEGE
 *
 *   · GUARDA O VALOR ANTIGO antes de escrever, numa aba
 *     BKP_SENHAS, com data e linha de origem. Nada se perde e
 *     dá para voltar atrás.
 *   · MEXE EM UMA CÉLULA SÓ. Uma linha, uma coluna. Não toca
 *     em nome, perfil, situação, matrícula nem em mais ninguém.
 *   · SE HOUVER LINHA REPETIDA PARA A MESMA MATRÍCULA, ELE
 *     PARA. Escolher a linha errada deixaria o problema de pé
 *     e estragaria a outra.
 *   · CONFERE DEPOIS DE GRAVAR, lendo de volta da planilha.
 *     Só diz que deu certo se leu de volta o valor esperado.
 *   · NUNCA imprime a senha nem o hash.
 *
 * ------------------------------------------------------------
 * COMO USAR
 *
 *   1. preencha as duas linhas abaixo
 *   2. escolha ARRUMAR_SENHA na lista → Executar
 *   3. tente entrar no sistema
 *   4. APAGUE A SENHA DE DENTRO DAS ASPAS e salve
 *
 * Se não entrar nem assim, a linha estará idêntica às que
 * funcionam — e aí a causa não é esta linha. Me avise.
 * ============================================================
 */

/* ============================================================
   >>> PREENCHA AQUI <<<
   ============================================================ */

var AS_MATRICULA = 408215;   /* a matrícula que não entra           */
var AS_NOVA_SENHA = '';      /* a senha que ela vai passar a ter    */

function ARRUMAR_SENHA() {
  return AS_arrumar_(AS_MATRICULA, AS_NOVA_SENHA, false);
}

/* Mostra o que FARIA, sem gravar nada. Use se quiser conferir
   antes. */
function ARRUMAR_SENHA_SIMULAR() {
  return AS_arrumar_(AS_MATRICULA, AS_NOVA_SENHA, true);
}

/* ============================================================
   ARRUMAR O STATUS
   ------------------------------------------------------------
   O diagnóstico de 10/11 mostrou, na aba USUARIOS:

       "ATIVO"     153 cadastros
       "Ativo"       9 cadastros   <<< o que não entra
       "EXCLUIDO"   51 cadastros

   Os 153 que entram escrevem ATIVO em maiúsculas. O que não
   entra escreve Ativo. Para os olhos é a mesma palavra; para
   uma comparação exata são textos diferentes, e o Core recusa.

   Esta função troca o status da linha pela grafia que a maioria
   usa — a mesma coisa que foi feita com a senha: deixar a linha
   IGUAL às que funcionam.

   Ela NÃO inventa o valor: lê a aba, conta as grafias, e usa a
   mais comum entre as que não são exclusão nem bloqueio. Se o
   senhor quiser mandar outra, preencha AS_STATUS_NOVO.
   ============================================================ */

var AS_STATUS_NOVO = '';     /* vazio = usa a grafia da maioria */

function ARRUMAR_STATUS()         { return AS_status_(AS_MATRICULA, false); }
function ARRUMAR_STATUS_SIMULAR() { return AS_status_(AS_MATRICULA, true); }

/* ============================================================
   ARRUMAR O STATUS DE TODOS DE UMA VEZ
   ------------------------------------------------------------
   Não é só um cadastro: 9 escrevem "Ativo" enquanto 153
   escrevem "ATIVO". Arrumar um por um é repetir o mesmo
   trabalho nove vezes e deixar oito pessoas sem entrar.

   Esta função acerta TODOS os que estão numa grafia diferente
   da maioria — e SÓ a grafia. Quem está EXCLUIDO, Bloqueado ou
   Inativo não é tocado: isso não é diferença de escrita, é
   decisão que alguém tomou.

   Cada linha alterada vai para BKP_SENHAS antes, uma por uma,
   com o valor que tinha. Dá para desfazer qualquer uma.

   RODE PRIMEIRO A SIMULAÇÃO. Ela lista exatamente quem seria
   mudado, sem gravar.
   ============================================================ */

function ARRUMAR_STATUS_TODOS_SIMULAR() { return AS_todos_(true); }
function ARRUMAR_STATUS_TODOS()         { return AS_todos_(false); }

function AS_todos_(simular) {
  var L = [];
  function diz(s) { L.push(s); }

  diz(simular ? '=== SIMULAÇÃO · nada será gravado ==='
              : '=== ACERTANDO A GRAFIA DO STATUS DE TODOS ===');
  diz('');

  var trava = LockService.getDocumentLock();
  try { trava.waitLock(30000); }
  catch (e) {
    diz('Outra execução está rodando. Tente de novo em instantes.');
    Logger.log(L.join('\n')); return L.join('\n');
  }

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var cand = AS_candidatas_(ss);
    if (!cand.length) {
      diz('Não achei aba de usuários com cadastros.');
      Logger.log(L.join('\n')); return L.join('\n');
    }
    var aba = cand[0].aba;
    var nL = aba.getLastRow() - 1, nC = aba.getLastColumn();
    var cab = aba.getRange(1, 1, 1, nC).getValues()[0];
    var dados = aba.getRange(2, 1, nL, nC).getValues();
    var cMat = AS_col_(cab, AS_COL.matricula);
    var cNom = AS_col_(cab, AS_COL.nome);
    var cSit = AS_col_(cab, ['status', 'situacao', 'situação', 'ativo', 'bloqueado']);

    diz('aba: ' + aba.getName() + '  ·  ' + nL + ' cadastros');
    if (cSit < 0) {
      diz('Esta aba não tem coluna de status.');
      Logger.log(L.join('\n')); return L.join('\n');
    }
    diz('coluna: ' + cab[cSit] + '  (coluna ' + (cSit + 1) + ')');
    diz('');

    var maioria = AS_statusDaMaioria_(dados, cSit);
    diz('grafias encontradas:');
    for (var g = 0; g < maioria.ordem.length; g++) {
      diz('  "' + maioria.ordem[g] + '"  ·  ' + maioria.conta[maioria.ordem[g]]);
    }
    var certo = String(AS_STATUS_NOVO || '').trim() || maioria.valor;
    if (!certo) {
      diz('Não consegui descobrir a grafia certa. Preencha AS_STATUS_NOVO.');
      Logger.log(L.join('\n')); return L.join('\n');
    }
    diz('');
    diz('grafia correta: "' + certo + '"  (' + maioria.quantos + ' cadastros já usam)');
    diz('');

    /* quem muda: mesma palavra, escrita diferente. Nada mais. */
    var mudar = [], intocados = {}, ordemI = [];
    for (var r = 0; r < dados.length; r++) {
      var v = String(dados[r][cSit] === null ? '' : dados[r][cSit]);
      var t = v.trim();
      if (t === certo) continue;
      if (!t) continue;                                   /* vazio: não invento status */
      if (/exclu|bloque|inativ|desligad|demitid/i.test(t)) {
        if (intocados[t] === undefined) { intocados[t] = 0; ordemI.push(t); }
        intocados[t]++;
        continue;
      }
      /* só mexe se for a MESMA palavra com outra caixa ou espaço */
      if (t.toLowerCase() !== certo.toLowerCase()) {
        if (intocados[t] === undefined) { intocados[t] = 0; ordemI.push(t); }
        intocados[t]++;
        continue;
      }
      mudar.push({ linha: r + 2, antigo: v,
        quem: cNom > -1 ? String(dados[r][cNom]).trim() : '',
        mat: cMat > -1 ? String(dados[r][cMat]).trim() : '' });
    }

    if (ordemI.length) {
      diz('NÃO vou tocar nestes — não é grafia, é outra coisa:');
      for (var i2 = 0; i2 < ordemI.length; i2++) {
        diz('  "' + ordemI[i2] + '"  ·  ' + intocados[ordemI[i2]] + ' cadastro(s)');
      }
      diz('');
    }

    if (!mudar.length) {
      diz('Nenhum cadastro para acertar: todos já estão em "' + certo + '"');
      diz('ou estão numa situação que não é diferença de escrita.');
      Logger.log(L.join('\n')); return L.join('\n');
    }

    diz('A ACERTAR: ' + mudar.length + ' cadastro(s)');
    for (var m = 0; m < Math.min(30, mudar.length); m++) {
      diz('  linha ' + mudar[m].linha + '  ·  ' + mudar[m].mat + '  ·  ' +
          mudar[m].quem + '  ·  "' + mudar[m].antigo + '" → "' + certo + '"');
    }
    if (mudar.length > 30) diz('  ... e mais ' + (mudar.length - 30));
    diz('');

    if (simular) {
      diz('SIMULAÇÃO: nada foi gravado.');
      diz('Se a lista acima estiver certa, rode ARRUMAR_STATUS_TODOS.');
      Logger.log(L.join('\n')); return L.join('\n');
    }

    /* backup de todas as linhas, antes de qualquer escrita */
    var bkp = ss.getSheetByName('BKP_SENHAS');
    if (!bkp) {
      bkp = ss.insertSheet('BKP_SENHAS');
      bkp.getRange(1, 1, 1, 6).setValues([[
        'quando', 'aba', 'linha', 'matricula', 'valor_anterior', 'observacao']]);
      bkp.setFrozenRows(1);
    }
    var quando = Utilities.formatDate(new Date(), 'America/Manaus', 'yyyy-MM-dd HH:mm:ss');
    var registros = [];
    for (var b = 0; b < mudar.length; b++) {
      registros.push([quando, aba.getName(), mudar[b].linha, mudar[b].mat, mudar[b].antigo,
        'antes de ARRUMAR_STATUS_TODOS · coluna "' + cab[cSit] + '" · passou a "' + certo + '"']);
    }
    bkp.getRange(bkp.getLastRow() + 1, 1, registros.length, 6).setValues(registros);
    SpreadsheetApp.flush();
    diz('as ' + registros.length + ' linhas foram guardadas em BKP_SENHAS.');

    /* grava célula por célula: só as que mudam são tocadas */
    var feitos = 0, falhou = [];
    for (var w = 0; w < mudar.length; w++) {
      aba.getRange(mudar[w].linha, cSit + 1).setValue(certo);
      feitos++;
    }
    SpreadsheetApp.flush();

    /* confere lendo de volta */
    for (var c2 = 0; c2 < mudar.length; c2++) {
      var lido = String(aba.getRange(mudar[c2].linha, cSit + 1).getValue() || '');
      if (lido !== certo) falhou.push(mudar[c2].linha + ' (leu "' + lido + '")');
    }

    diz('gravados: ' + feitos);
    if (falhou.length) {
      diz('');
      diz('>>> ' + falhou.length + ' NÃO CONFIRMARAM: ' + falhou.join(', '));
      diz('Os valores antigos estão em BKP_SENHAS. Me avise.');
    } else {
      diz('conferidos: todos os ' + feitos + ' foram lidos de volta e estão certos.');
      diz('');
      diz('────────────────────────────────');
      diz('PRONTO. Os ' + feitos + ' cadastros agora têm o status na mesma');
      diz('grafia dos ' + maioria.quantos + ' que já entravam.');
      diz('');
      diz('Tente entrar. Se ainda não entrar, a causa não é o');
      diz('status nem a senha — é a função de login, e aí eu');
      diz('preciso do arquivo dela.');
    }

  } finally { try { trava.releaseLock(); } catch (e) {} }

  Logger.log(L.join('\n'));
  return L.join('\n');
}

/* a grafia que a maioria usa, ignorando exclusão e bloqueio */
function AS_statusDaMaioria_(dados, cSit) {
  var conta = {}, ordem = [];
  for (var i = 0; i < dados.length; i++) {
    var v = String(dados[i][cSit] === null ? '' : dados[i][cSit]).trim();
    if (!v) continue;
    if (/exclu|bloque|inativ|desligad|demitid/i.test(v)) continue;
    if (conta[v] === undefined) { conta[v] = 0; ordem.push(v); }
    conta[v]++;
  }
  var melhor = '', quantos = 0;
  for (var k = 0; k < ordem.length; k++) {
    if (conta[ordem[k]] > quantos) { melhor = ordem[k]; quantos = conta[ordem[k]]; }
  }
  return { valor: melhor, quantos: quantos, conta: conta, ordem: ordem };
}

function AS_status_(matricula, simular) {
  var L = [];
  function diz(s) { L.push(s); }
  var alvo = String(matricula === undefined || matricula === null ? '' : matricula).trim();

  diz(simular ? '=== SIMULAÇÃO · nada será gravado ===' : '=== ARRUMANDO O STATUS ===');
  diz('matrícula: ' + alvo);
  diz('');

  if (!alvo) { diz('Preencha AS_MATRICULA.'); Logger.log(L.join('\n')); return L.join('\n'); }

  var trava = LockService.getDocumentLock();
  try { trava.waitLock(30000); }
  catch (e) {
    diz('Outra execução está rodando. Tente de novo em instantes.');
    Logger.log(L.join('\n')); return L.join('\n');
  }

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var cand = AS_candidatas_(ss);
    if (!cand.length) {
      diz('Não achei aba de usuários com cadastros.');
      Logger.log(L.join('\n')); return L.join('\n');
    }
    var aba = cand[0].aba;
    var nL = aba.getLastRow() - 1, nC = aba.getLastColumn();
    var cab = aba.getRange(1, 1, 1, nC).getValues()[0];
    var dados = aba.getRange(2, 1, nL, nC).getValues();
    var cMat = AS_col_(cab, AS_COL.matricula);
    var cEml = AS_col_(cab, AS_COL.email);
    var cNom = AS_col_(cab, AS_COL.nome);
    var cSit = AS_col_(cab, ['status', 'situacao', 'situação', 'ativo', 'bloqueado']);

    diz('aba: ' + aba.getName() + '  ·  ' + nL + ' cadastros');
    if (cSit < 0) {
      diz('Esta aba não tem coluna de status. Nada a fazer.');
      Logger.log(L.join('\n')); return L.join('\n');
    }
    diz('coluna que vou mexer: ' + cab[cSit] + '  (coluna ' + (cSit + 1) + ')');
    diz('');

    var achadas = [], semZero = alvo.replace(/^0+/, '');
    for (var r = 0; r < dados.length; r++) {
      var bateu = false;
      if (cMat > -1) {
        var t = String(dados[r][cMat] === null ? '' : dados[r][cMat]).trim();
        if (t === alvo || (semZero !== '' && t.replace(/^0+/, '') === semZero)) bateu = true;
      }
      if (!bateu && cEml > -1) {
        var em = String(dados[r][cEml] || '').trim().toLowerCase();
        if (em && em === alvo.toLowerCase()) bateu = true;
      }
      if (bateu) achadas.push(r);
    }

    if (!achadas.length) {
      diz('>>> PAREI: a matrícula ' + alvo + ' não está nesta aba.');
      Logger.log(L.join('\n')); return L.join('\n');
    }
    if (achadas.length > 1) {
      diz('>>> PAREI: esta matrícula tem ' + achadas.length + ' LINHAS.');
      for (var d = 0; d < achadas.length; d++) {
        diz('  linha ' + (achadas[d] + 2) + ': status "' +
            String(dados[achadas[d]][cSit]).trim() + '"');
      }
      diz('Não gravo sem saber qual delas o login usa.');
      Logger.log(L.join('\n')); return L.join('\n');
    }

    var r0 = achadas[0], linha = r0 + 2;
    var antigo = String(dados[r0][cSit] === null ? '' : dados[r0][cSit]);

    var maioria = AS_statusDaMaioria_(dados, cSit);
    diz('grafias de status nesta aba:');
    for (var g = 0; g < maioria.ordem.length; g++) {
      diz('  "' + maioria.ordem[g] + '"  ·  ' + maioria.conta[maioria.ordem[g]] + ' cadastro(s)');
    }
    diz('');

    var novo = String(AS_STATUS_NOVO || '').trim() || maioria.valor;
    if (!novo) {
      diz('>>> PAREI: não consegui descobrir a grafia certa, e');
      diz('AS_STATUS_NOVO está vazio. Preencha com o valor desejado.');
      Logger.log(L.join('\n')); return L.join('\n');
    }

    diz('cadastro: linha ' + linha +
        (cNom > -1 ? '  ·  ' + String(dados[r0][cNom]).trim() : ''));
    diz('status agora:   "' + antigo + '"');
    diz('status depois:  "' + novo + '"' +
        (AS_STATUS_NOVO ? '   (o senhor mandou este)'
                        : '   (a grafia de ' + maioria.quantos + ' cadastros)'));
    diz('');

    if (antigo === novo) {
      diz('Já está exatamente assim. Não há o que arrumar aqui.');
      diz('Se não entra mesmo com o status igual ao dos outros, a');
      diz('causa não é o status.');
      Logger.log(L.join('\n')); return L.join('\n');
    }

    if (/exclu|bloque|inativ/i.test(antigo)) {
      diz('>>> PAREI: o status atual é "' + antigo + '".');
      diz('Isso não é diferença de grafia — é uma decisão que');
      diz('alguém tomou. Não vou reativar um cadastro excluído ou');
      diz('bloqueado por conta própria. Se for para reativar,');
      diz('preencha AS_STATUS_NOVO e rode de novo, sabendo disso.');
      Logger.log(L.join('\n')); return L.join('\n');
    }

    if (simular) {
      diz('SIMULAÇÃO: eu gravaria na linha ' + linha + ', coluna ' + (cSit + 1) + '.');
      diz('O valor antigo iria para BKP_SENHAS antes. Nada foi gravado.');
      Logger.log(L.join('\n')); return L.join('\n');
    }

    /* backup antes */
    var bkp = ss.getSheetByName('BKP_SENHAS');
    if (!bkp) {
      bkp = ss.insertSheet('BKP_SENHAS');
      bkp.getRange(1, 1, 1, 6).setValues([[
        'quando', 'aba', 'linha', 'matricula', 'valor_anterior', 'observacao']]);
      bkp.setFrozenRows(1);
    }
    bkp.appendRow([
      Utilities.formatDate(new Date(), 'America/Manaus', 'yyyy-MM-dd HH:mm:ss'),
      aba.getName(), linha, alvo, antigo,
      'antes de ARRUMAR_STATUS · coluna "' + cab[cSit] + '" · passou a "' + novo + '"']);
    SpreadsheetApp.flush();
    diz('valor anterior guardado em BKP_SENHAS.');

    aba.getRange(linha, cSit + 1).setValue(novo);
    SpreadsheetApp.flush();

    var conferido = String(aba.getRange(linha, cSit + 1).getValue() || '');
    if (conferido !== novo) {
      diz('');
      diz('>>> A GRAVAÇÃO NÃO CONFIRMOU. Li de volta "' + conferido + '".');
      diz('O valor antigo está em BKP_SENHAS. NÃO tente de novo sem me avisar.');
      Logger.log(L.join('\n')); return L.join('\n');
    }

    diz('gravado e conferido.');
    diz('');
    diz('────────────────────────────────');
    diz('PRONTO. Tente entrar com a matrícula ' + alvo + '.');
    diz('');
    diz('Se ENTRAR: a causa era a grafia do status. E aí os outros');
    diz('8 cadastros com "' + antigo + '" têm o mesmo problema —');
    diz('me avise que eu trato todos de uma vez, com cuidado.');
    diz('');
    diz('Se NÃO ENTRAR: a linha agora está igual às que funcionam');
    diz('em status e em senha. A causa está na função de login.');

  } finally { try { trava.releaseLock(); } catch (e) {} }

  Logger.log(L.join('\n'));
  return L.join('\n');
}

/* ------------------------------------------------------------ */

var AS_COL = {
  matricula: ['matricula', 'matrícula', 'registro', 'cracha', 'crachá'],
  email:     ['email', 'e-mail', 'mail'],
  nome:      ['nome', 'colaborador'],
  /* "hash" sozinho NÃO entra aqui. A aba ALMOXA_DOCUMENTOS tem
     uma coluna "hash" que é do documento, e isso fez o script
     escolher a aba errada. Coluna de senha tem senha no nome. */
  senha:     ['senha_hash', 'senhahash', 'senha', 'password', 'passwd']
};

function AS_ch_(v) {
  return String(v === null || v === undefined ? '' : v).trim().toLowerCase()
    .replace(/[áàâã]/g, 'a').replace(/[éê]/g, 'e').replace(/í/g, 'i')
    .replace(/[óôõ]/g, 'o').replace(/ú/g, 'u').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]/g, '');
}

function AS_col_(cab, quais) {
  var ch = cab.map(AS_ch_);
  for (var i = 0; i < quais.length; i++) {
    var p = ch.indexOf(AS_ch_(quais[i]));
    if (p > -1) return p;
  }
  for (var j = 0; j < quais.length; j++) {
    var t = AS_ch_(quais[j]);
    for (var k = 0; k < ch.length; k++) if (ch[k] && ch[k].indexOf(t) > -1) return k;
  }
  return -1;
}

function AS_hex_(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i];
    if (b < 0) b += 256;
    var h = b.toString(16);
    if (h.length === 1) h = '0' + h;
    s += h;
  }
  return s;
}

function AS_sha256_(texto) {
  return AS_hex_(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, texto, Utilities.Charset.UTF_8));
}

function AS_formato_(v) {
  if (v === null || v === undefined) return 'vazia';
  var s = String(v); if (s === '') return 'vazia';
  var t = s.trim(); if (t === '') return 'só espaços';
  if (/^[0-9a-f]{64}$/i.test(t)) return 'hash de 64';
  return 'texto de ' + t.length + ' caracteres';
}

/* As abas que podem ser de usuários, da mais provável para a
   menos. Não basta "ter coluna de senha": ALMOXA_DOCUMENTOS
   passava nesse teste. Agora cada candidata ganha pontos:

     +100  o NOME da aba fala de usuário
     + 50  a coluna de senha se chama senha (não só parece)
     + 25  tem coluna de matrícula de verdade
     +  n  quantidade de cadastros, até 25

   A de mais pontos vence, e o relatório mostra a conta. */
function AS_candidatas_(ss) {
  var cand = [], todas = ss.getSheets();
  for (var k = 0; k < todas.length; k++) {
    var s = todas[k];
    if (/^BKP_|_LOG$/i.test(s.getName())) continue;
    if (s.getLastColumn() < 1 || s.getLastRow() < 2) continue;

    var cab = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
    var cSen = AS_col_(cab, AS_COL.senha);
    if (cSen < 0) continue;
    var cMat = AS_col_(cab, AS_COL.matricula);
    var cEml = AS_col_(cab, AS_COL.email);
    if (cMat < 0 && cEml < 0) continue;

    var pontos = 0;
    var nome = AS_ch_(s.getName());
    if (nome.indexOf('usuario') > -1 || nome.indexOf('user') > -1) pontos += 100;
    if (AS_ch_(cab[cSen]).indexOf('senha') > -1) pontos += 50;
    if (cMat > -1) pontos += 25;
    pontos += Math.min(25, Math.max(0, s.getLastRow() - 1) / 10);

    cand.push({ aba: s, pontos: pontos, cadastros: s.getLastRow() - 1,
                colunaSenha: String(cab[cSen]) });
  }
  cand.sort(function (a, b) { return b.pontos - a.pontos; });
  return cand;
}

/* ============================================================ */
function AS_arrumar_(matricula, novaSenha, simular) {
  var L = [];
  function diz(s) { L.push(s); }
  var alvo = String(matricula === undefined || matricula === null ? '' : matricula).trim();
  var senha = String(novaSenha === undefined || novaSenha === null ? '' : novaSenha);

  diz(simular ? '=== SIMULAÇÃO · nada será gravado ==='
              : '=== ARRUMANDO A SENHA ===');
  diz('matrícula: ' + alvo);
  diz('senha recebida: ' + (senha ? senha.length + ' caracteres' : 'NENHUMA'));
  diz('');

  if (!alvo) { diz('Preencha AS_MATRICULA.'); Logger.log(L.join('\n')); return L.join('\n'); }
  if (!senha) {
    diz('Preencha AS_NOVA_SENHA com a senha que este usuário vai passar');
    diz('a ter — escreva entre as aspas, lá em cima do arquivo.');
    diz('Depois escolha ARRUMAR_SENHA na lista de funções (não');
    diz('AS_arrumar_) e aperte Executar.');
    Logger.log(L.join('\n')); return L.join('\n');
  }
  if (senha.length < 4) {
    diz('Senha curta demais. Use ao menos 4 caracteres.');
    Logger.log(L.join('\n')); return L.join('\n');
  }
  if (senha !== senha.trim()) {
    diz('A senha tem espaço no começo ou no fim. Tire — espaço em');
    diz('senha é fonte de erro que ninguém enxerga depois.');
    Logger.log(L.join('\n')); return L.join('\n');
  }

  var trava = LockService.getDocumentLock();
  try { trava.waitLock(30000); }
  catch (e) {
    diz('Outra execução está rodando. Tente de novo em instantes.');
    Logger.log(L.join('\n')); return L.join('\n');
  }

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var cand = AS_candidatas_(ss);
    if (!cand.length) {
      diz('Não achei aba de usuários com cadastros nesta planilha.');
      Logger.log(L.join('\n')); return L.join('\n');
    }
    if (cand.length > 1) {
      diz('abas que poderiam ser de usuários, da mais provável:');
      for (var q = 0; q < cand.length; q++) {
        diz('  ' + cand[q].aba.getName() + '  ·  ' + cand[q].cadastros + ' cadastros' +
            '  ·  coluna "' + cand[q].colunaSenha + '"' +
            (q === 0 ? '   <<< escolhida' : ''));
      }
      diz('');
    }
    var aba = cand[0].aba;
    var nL = aba.getLastRow() - 1, nC = aba.getLastColumn();
    var cab = aba.getRange(1, 1, 1, nC).getValues()[0];
    var dados = aba.getRange(2, 1, nL, nC).getValues();
    var cMat = AS_col_(cab, AS_COL.matricula);
    var cEml = AS_col_(cab, AS_COL.email);
    var cNom = AS_col_(cab, AS_COL.nome);
    var cSen = AS_col_(cab, AS_COL.senha);

    diz('aba: ' + aba.getName() + '  ·  ' + nL + ' cadastros');
    diz('coluna que vou mexer: ' + cab[cSen] + '  (coluna ' + (cSen + 1) + ')');
    diz('');

    /* acha TODAS as linhas desta matrícula */
    var achadas = [], semZero = alvo.replace(/^0+/, '');
    for (var r = 0; r < dados.length; r++) {
      var bateu = false;
      if (cMat > -1) {
        var t = String(dados[r][cMat] === null ? '' : dados[r][cMat]).trim();
        if (t === alvo || (semZero !== '' && t.replace(/^0+/, '') === semZero)) bateu = true;
      }
      if (!bateu && cEml > -1) {
        var em = String(dados[r][cEml] || '').trim().toLowerCase();
        if (em && em === alvo.toLowerCase()) bateu = true;
      }
      if (bateu) achadas.push(r);
    }

    if (!achadas.length) {
      diz('>>> PAREI: a matrícula ' + alvo + ' não está nesta aba.');
      diz('Não vou criar cadastro novo — criar por cima de um que');
      diz('existe em outro lugar faria dois do mesmo usuário.');
      Logger.log(L.join('\n')); return L.join('\n');
    }

    if (achadas.length > 1) {
      diz('>>> PAREI: esta matrícula tem ' + achadas.length + ' LINHAS.');
      for (var d = 0; d < achadas.length; d++) {
        diz('  linha ' + (achadas[d] + 2) + ': senha ' + AS_formato_(dados[achadas[d]][cSen]));
      }
      diz('');
      diz('Não gravo sem saber qual delas o login usa. Arrumar a');
      diz('errada deixa o problema de pé e estraga a outra.');
      diz('');
      diz('Isto é, muito provavelmente, a causa de tudo: a gravação');
      diz('acrescentou uma linha em vez de alterar a que já existia.');
      diz('Me mande este texto que eu digo qual apagar e como.');
      Logger.log(L.join('\n')); return L.join('\n');
    }

    var r0 = achadas[0];
    var linhaPlanilha = r0 + 2;
    var antigo = String(dados[r0][cSen] === null ? '' : dados[r0][cSen]);
    var novo = AS_sha256_(senha);

    diz('cadastro: linha ' + linhaPlanilha +
        (cNom > -1 ? '  ·  ' + String(dados[r0][cNom]).trim() : ''));
    diz('senha antes: ' + AS_formato_(antigo));
    diz('senha depois: hash de 64');
    diz('');

    if (AS_formato_(antigo) === 'hash de 64' && antigo.trim().toLowerCase() === novo) {
      diz('O hash que já está lá é EXATAMENTE o desta senha.');
      diz('Não há o que arrumar nesta célula: o dado já está certo.');
      diz('Se não entra assim, a causa não é esta linha.');
      Logger.log(L.join('\n')); return L.join('\n');
    }

    if (simular) {
      diz('SIMULAÇÃO: eu gravaria o hash de 64 na linha ' + linhaPlanilha +
          ', coluna ' + (cSen + 1) + '.');
      diz('O valor antigo iria para a aba BKP_SENHAS antes.');
      diz('Nada foi gravado. Rode ARRUMAR_SENHA para valer.');
      Logger.log(L.join('\n')); return L.join('\n');
    }

    /* 1 · guarda o antigo ANTES de qualquer escrita */
    var bkp = ss.getSheetByName('BKP_SENHAS');
    if (!bkp) {
      bkp = ss.insertSheet('BKP_SENHAS');
      bkp.getRange(1, 1, 1, 6).setValues([[
        'quando', 'aba', 'linha', 'matricula', 'valor_anterior', 'observacao']]);
      bkp.setFrozenRows(1);
    }
    bkp.appendRow([
      Utilities.formatDate(new Date(), 'America/Manaus', 'yyyy-MM-dd HH:mm:ss'),
      aba.getName(), linhaPlanilha, alvo, antigo,
      'antes de ARRUMAR_SENHA · formato anterior: ' + AS_formato_(antigo)]);
    SpreadsheetApp.flush();
    diz('valor anterior guardado na aba BKP_SENHAS.');

    /* 2 · grava a célula, uma só */
    aba.getRange(linhaPlanilha, cSen + 1).setValue(novo);
    SpreadsheetApp.flush();

    /* 3 · lê de volta e confere */
    var conferido = String(aba.getRange(linhaPlanilha, cSen + 1).getValue() || '');
    if (conferido.trim().toLowerCase() !== novo) {
      diz('');
      diz('>>> A GRAVAÇÃO NÃO CONFIRMOU.');
      diz('Li de volta e não veio o que eu escrevi. O valor antigo');
      diz('está em BKP_SENHAS. NÃO tente de novo sem me avisar.');
      Logger.log(L.join('\n')); return L.join('\n');
    }

    diz('gravado e conferido: li de volta e é o valor esperado.');
    diz('');
    diz('────────────────────────────────');
    diz('PRONTO. Agora tente entrar com a matrícula ' + alvo + ' e essa senha.');
    diz('');
    diz('Se ENTRAR: a causa era a senha gravada em formato errado');
    diz('pela tela de cadastro. Essa tela ainda precisa ser');
    diz('corrigida, senão o próximo usuário dá o mesmo problema.');
    diz('');
    diz('Se NÃO ENTRAR: esta linha agora está idêntica às 212 que');
    diz('funcionam, então a causa não está nela. Me avise que eu');
    diz('vou olhar a função de login.');
    diz('');
    diz('>>> APAGUE A SENHA DE DENTRO DAS ASPAS E SALVE.');

  } finally { try { trava.releaseLock(); } catch (e) {} }

  Logger.log(L.join('\n'));
  return L.join('\n');
}
