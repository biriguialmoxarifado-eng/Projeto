// Cada execução mantém a própria referência enquanto possui o ScriptLock.
var AP_Core_travaAtiva_ = null;

function AP_Core_withLock(fn, opcoes) {
  if (typeof fn !== 'function') throw new TypeError('Informe a operação que precisa da trava.');
  if (AP_Core_travaAtiva_) return fn();

  opcoes = opcoes || {};
  var espera = Number(opcoes.espera == null ? AP_Config_get('LOCK_TIMEOUT_MS', 10000) : opcoes.espera);
  if (!Number.isInteger(espera) || espera < 0) throw new RangeError('Tempo de espera inválido.');

  var trava = LockService.getScriptLock();
  if (!trava.tryLock(espera)) throw new Error('OCUPADO: outra gravação está em andamento.');
  AP_Core_travaAtiva_ = trava;
  var terminou = false;
  try {
    var resultado = fn();
    terminou = true;
    return resultado;
  } finally {
    try {
      SpreadsheetApp.flush();
    } catch (erro) {
      if (terminou) throw erro;
    } finally {
      AP_Core_travaAtiva_ = null;
      trava.releaseLock();
    }
  }
}

function AP_Core_boot() {
  var pecas = {
    AP_Core_withLock: typeof AP_Core_withLock === 'function',
    APIX_atender_: typeof APIX_atender_ === 'function',
    almoxaApi: typeof almoxaApi === 'function',
    AP_BRIDGE_chamar_: typeof AP_BRIDGE_chamar_ === 'function',
    AP_BRIDGE_resposta_: typeof AP_BRIDGE_resposta_ === 'function'
  };
  var faltando = Object.keys(pecas).filter(function (nome) { return !pecas[nome]; });
  var planilha = { ok: false };
  try {
    planilha.ok = Boolean(AP_Config_getSpreadsheet_());
  } catch (erro) {
    planilha.motivo = 'Não foi possível abrir a planilha configurada.';
  }
  var ok = !faltando.length && planilha.ok;
  return {
    ok: ok,
    message: ok ? 'Core operacional.' : 'Core incompleto. Confira as funções e a planilha configurada.',
    data: { pecas: pecas, faltando: faltando, planilha: planilha }
  };
}
