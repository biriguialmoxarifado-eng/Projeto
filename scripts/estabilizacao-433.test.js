'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function carregar(arquivos, globais) {
  const contexto = vm.createContext(globais);
  for (const arquivo of arquivos) {
    const codigo = readFileSync(join(__dirname, '..', 'app', arquivo), 'utf8');
    vm.runInContext(codigo, contexto, { filename: arquivo });
  }
  return contexto;
}

function ambienteHttp() {
  const entregas = [];
  const contexto = carregar(['00 - ENTRADA HTTP.js', 'ALMOXA PRO — API ÚNICA.js'], {
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: texto => ({ setMimeType: () => JSON.parse(texto) })
    },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: () => 'chave-de-teste' })
    },
    AP_Session_validate: token => token === 'sessao-confirmada'
      ? { ok: true, data: { usuario: 'operador', perfil: 'operador' } }
      : { ok: false },
    ASC_executar_: (req, trabalho) => {
      entregas.push(req);
      if (req.modulo !== 'auth' && !req.sessaoDados) return { ok: false, codigo: 'SEM_SESSAO' };
      return trabalho();
    },
    almoxaApi: json => ({ ok: true, dados: JSON.parse(json) }),
    axbioPost: () => 'bio-post',
    AXBIO_servirTela_: () => 'bio-tela',
    AP_ENTRADA_servir: () => 'entrada',
    AP_LINKFLOW_doGet: () => 'linkflow',
    AP_CRACHA_doGet: () => 'cracha',
    FICHA_servirGet_: () => 'ficha'
  });
  return { contexto, entregas };
}

function post(contexto, corpo) {
  return contexto.doPost({ postData: { contents: JSON.stringify(corpo) } });
}

test('GET mantém as rotas de status, biometria, crachá, 3D, aprovação e ficha', () => {
  const { contexto } = ambienteHttp();
  const get = parameter => contexto.doGet({ parameter });
  assert.equal(get({ ponte: 'ping', pagina: 'biometria' }).codigo, 'CORE_ONLINE');
  assert.equal(get({ pagina: 'biometria' }), 'bio-tela');
  assert.equal(get({ cr: 'ping' }), 'cracha');
  assert.equal(get({ lf: 'link' }), 'linkflow');
  assert.equal(get({ p: '3d', f: 'PAT-1' }), 'entrada');
  assert.equal(get({ aprovar: 'pedido' }), 'entrada');
  assert.equal(get({ f: 'PAT-1' }), 'ficha');
});

test('POST distingue biometria legada de envelopes ALMOXA e rejeita corpo inválido', () => {
  const { contexto } = ambienteHttp();
  assert.equal(post(contexto, { acao: 'bio_ping' }), 'bio-post');
  assert.equal(post(contexto, { ponte: 'ALMOXA', acao: 'bio_ping' }).codigo, 'CHAVE_APP_INVALIDA');
  assert.equal(post(contexto, null).codigo, 'NAO_E_PONTE');
  assert.equal(contexto.doPost({ postData: { contents: '{' } }).codigo, 'CORPO_INVALIDO');
});

test('POST e mapa aplicam a chave e encaminham o perfil da sessão autenticada', () => {
  const { contexto, entregas } = ambienteHttp();
  const pedido = { ponte: 'ALMOXA', chave: 'chave-de-teste', modulo: 'auth', acao: 'login' };
  assert.equal(post(contexto, pedido).ok, true);
  const estoque = { ...pedido, modulo: 'estoque', acao: 'movimentar', perfil: 'admin' };
  assert.equal(post(contexto, estoque).codigo, 'SEM_SESSAO');
  assert.equal(contexto.almoxaApiWeb(JSON.stringify({ ...estoque, chave: '' })).codigo, 'CHAVE_APP_INVALIDA');
  const operacao = { ...estoque, sessao: 'sessao-confirmada', payload: { __chaveOperacao: 'op-1' } };
  assert.equal(contexto.almoxaApiWeb(JSON.stringify(operacao)).ok, true);
  assert.equal(post(contexto, operacao).ok, true);
  for (const req of entregas.slice(-2)) {
    assert.equal(req.perfil, 'operador');
    assert.equal(req.chaveOperacao, 'op-1');
    assert.equal(req.payload.__chaveOperacao, undefined);
  }
});

test('almoxaApi aceita login e recusa gravação com sessão inválida', () => {
  const contexto = carregar(['ALMOXA PRO — PONTE FRONTEND ↔ CORE MASTER.js'], {
    AP_Modulo_auth: acao => ({ ok: acao === 'login', dados: { token: 'sessao-de-teste' } }),
    AP_Session_validate: () => ({ ok: false, code: 'SESSAO_EXPIRADA' }),
    AP_Modulo_estoque: () => assert.fail('estoque executado sem sessão')
  });
  const chamar = pedido => JSON.parse(contexto.almoxaApi(JSON.stringify(pedido)));
  assert.equal(chamar({ modulo: 'auth', acao: 'login' }).dados.token, 'sessao-de-teste');
  assert.equal(chamar({ modulo: 'estoque', acao: 'movimentar', sessao: 'expirada' }).codigo, 'SESSAO_EXPIRADA');
});

function ambienteTrava({ adquire = true, erroFlush } = {}) {
  const eventos = [];
  const contexto = carregar(['06 - BOOT E CONCORRÊNCIA.js', '05 -DATA LAYER.js'], {
    AP_Config_get: () => 30,
    LockService: {
      getScriptLock: () => ({
        tryLock(ms) { eventos.push(['travar', ms]); return adquire; },
        releaseLock() { eventos.push('liberar'); }
      })
    },
    SpreadsheetApp: { flush() { eventos.push('flush'); if (erroFlush) throw erroFlush; } }
  });
  return { contexto, eventos };
}

test('operação aninhada e Data Layer mantêm a trava até concluir a gravação externa', () => {
  const { contexto, eventos } = ambienteTrava();
  const resultado = contexto.AP_Core_withLock(() => contexto.AP_Core_withLock(() => {
    contexto.AP_Data_travar_().releaseLock();
    eventos.push('gravar');
    return 'ok';
  }), { espera: 0 });
  assert.equal(resultado, 'ok');
  assert.deepEqual(eventos, [['travar', 0], 'gravar', 'flush', 'liberar']);
});

test('timeout e indisponibilidade da trava recusam a operação', () => {
  const { contexto, eventos } = ambienteTrava({ adquire: false });
  const gravar = () => assert.fail('gravou sem trava');
  assert.throws(() => contexto.AP_Core_withLock(gravar), /OCUPADO/);
  assert.equal(contexto.AP_Data_travar_(), false);
  assert.deepEqual(eventos, [['travar', 30], ['travar', 30]]);
  contexto.LockService = undefined;
  assert.throws(() => contexto.AP_Core_withLock(gravar));
  assert.equal(contexto.AP_Data_travar_(), false);
});

test('trava é liberada após falha de gravação ou flush', () => {
  const erroFlush = new Error('falha de flush');
  const { contexto, eventos } = ambienteTrava({ erroFlush });
  const erroGravacao = new Error('falha de gravação');
  assert.throws(() => contexto.AP_Core_withLock(() => { throw erroGravacao; }), erroGravacao);
  assert.throws(() => contexto.AP_Core_withLock(() => true), erroFlush);
  assert.deepEqual(eventos, [['travar', 30], 'flush', 'liberar', ['travar', 30], 'flush', 'liberar']);
});

test('boot usa o resolvedor oficial de planilha e informa dependências ausentes', () => {
  const { contexto } = ambienteTrava();
  contexto.AP_Config_getSpreadsheet_ = () => ({ id: 'planilha-configurada' });
  assert.equal(contexto.AP_Core_boot().ok, false);
  assert.ok(contexto.AP_Core_boot().data.faltando.includes('almoxaApi'));
  for (const nome of ['APIX_atender_', 'almoxaApi', 'AP_BRIDGE_chamar_', 'AP_BRIDGE_resposta_']) {
    contexto[nome] = () => {};
  }
  assert.equal(contexto.AP_Core_boot().ok, true);
  contexto.AP_Config_getSpreadsheet_ = () => { throw new Error('sem planilha'); };
  assert.equal(contexto.AP_Core_boot().data.planilha.ok, false);
});
