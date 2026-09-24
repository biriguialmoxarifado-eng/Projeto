/**
 * ALMOXA PRO — Sincronizar crachá do usuário
 *
 * Preenche a coluna "cracha" da aba USUARIOS com o CÓDIGO do crachá
 * (CR-01, CR-02...) da aba ALMOXA_CRACHAS, casando pela matrícula.
 *
 * É esse código que o Core compara com o QR lido. Se a coluna estiver
 * vazia, ou com a matrícula no lugar do código, o crachá é reconhecido
 * mas não entra no sistema.
 *
 * COMO USAR
 *  1. Crie um arquivo novo no Apps Script e cole isto.
 *  2. Rode ALMOXA_verCrachasDosUsuarios para ver a situação (não altera nada).
 *  3. Rode ALMOXA_sincronizarCrachas para corrigir.
 *  4. Passe o crachá no sistema. Não precisa publicar nova versão.
 */

/** Só mostra como está hoje. Não grava nada. */
function ALMOXA_verCrachasDosUsuarios() {
  var r = ALMOXA_cruzarCrachas_();
  var linhas = ['===== CRACHÁ DE CADA USUÁRIO ====='];
  r.forEach(function (x) {
    linhas.push('');
    linhas.push(x.nome + '  (matrícula ' + x.matricula + ')');
    linhas.push('   na aba USUARIOS: ' + (x.atual === '' ? '(vazio)' : x.atual));
    linhas.push('   crachá emitido:  ' + (x.codigo || '(nenhum crachá ativo)'));
    linhas.push('   situação: ' + x.situacao);
  });
  if (!r.length) linhas.push('Nenhum usuário encontrado.');
  Logger.log(linhas.join('\n'));
  return linhas.join('\n');
}

/** Corrige a coluna cracha de quem está errado ou vazio. */
function ALMOXA_sincronizarCrachas() {
  var r = ALMOXA_cruzarCrachas_();
  var mexidos = [];
  r.forEach(function (x) {
    if (!x.codigo) return;                 // pessoa sem crachá ativo: não mexe
    if (String(x.atual) === String(x.codigo)) return;  // já está certo
    AP_Data_update(AP_SHEETS.USUARIOS, x.email, { cracha: x.codigo }, 'email');
    mexidos.push(x.nome + ': "' + x.atual + '" -> ' + x.codigo);
  });

  var texto = mexidos.length
    ? mexidos.length + ' usuário(s) corrigido(s):\n' + mexidos.join('\n')
    : 'Nada para corrigir — todos já estão com o código certo.';
  Logger.log(texto);
  try {
    AP_Audit_log('manutencao', 'CRACHA_SINCRONIZADO', 'USUARIOS', '', { corrigidos: mexidos.length });
  } catch (e) {}
  return texto;
}

/** Cruza USUARIOS com ALMOXA_CRACHAS pela matrícula. */
function ALMOXA_cruzarCrachas_() {
  var usuarios = AP_Data_rows(AP_SHEETS.USUARIOS) || [];
  var crachas = ALMOXA_lerCrachas_();

  return usuarios.map(function (u) {
    var mat = ALMOXA_norm_(u.matricula);
    var meus = crachas.filter(function (c) {
      return ALMOXA_norm_(c.matricula) === mat && mat !== '';
    });
    var ativo = meus.filter(function (c) {
      return String(c.status || '').toUpperCase() === 'ATIVO';
    })[0] || meus[0] || null;

    return {
      nome: u.nome || '(sem nome)',
      email: u.email,
      matricula: u.matricula === '' || u.matricula === undefined ? '(vazia)' : String(u.matricula),
      atual: u.cracha === undefined || u.cracha === null ? '' : String(u.cracha),
      codigo: ativo ? String(ativo.codigo) : '',
      situacao: !meus.length ? 'sem crachá emitido'
        : !ativo ? 'crachá existe mas não está ativo'
        : String(u.cracha) === String(ativo.codigo) ? 'ok'
        : 'precisa corrigir'
    };
  });
}

/** Lê a aba de crachás direto, sem depender de outro módulo. */
function ALMOXA_lerCrachas_() {
  var nomes = ['ALMOXA_CRACHAS', 'CRACHAS'];
  var ss = AP_Config_getSpreadsheet_();
  var aba = null;
  for (var i = 0; i < nomes.length && !aba; i++) aba = ss.getSheetByName(nomes[i]);
  if (!aba || aba.getLastRow() < 2) return [];

  var dados = aba.getRange(1, 1, aba.getLastRow(), aba.getLastColumn()).getValues();
  var cab = dados.shift().map(function (c) { return String(c).trim(); });
  return dados.map(function (linha) {
    var o = {};
    cab.forEach(function (c, i) { o[c] = linha[i]; });
    return o;
  }).filter(function (o) { return o.codigo; });
}

/** "0001" e 1 são a mesma matrícula. */
function ALMOXA_norm_(v) {
  var t = String(v === undefined || v === null ? '' : v).trim().toLowerCase();
  if (!t) return '';
  return /^\d+$/.test(t) ? String(Number(t)) : t;
}
