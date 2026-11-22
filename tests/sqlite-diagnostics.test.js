'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { runInNewContext } = require('node:vm');
const { SqliteDiagnosticsProvider } = require('../database/adapters/sqlite-diagnostics-provider');

const token = 'test-only-credential-for-sqlite-suite';

async function start(path, role = 'operator', preview = false, allowWrite = preview) {
  const processEnv = {
    ...process.env, ALMOXA_SQLITE_PATH: path, ALMOXA_DIAGNOSTICS_TOKEN: token,
    ALMOXA_DIAGNOSTICS_ACTOR: 'integration-test', ALMOXA_DIAGNOSTICS_ROLE: role,
    ALMOXA_PREVIEW_SHEET_ID: '', ALMOXA_PREVIEW_SQLITE: preview ? '1' : '',
    ALMOXA_PREVIEW_WRITE: allowWrite ? '1' : '',
    ALMOXA_PREVIEW_ORIGIN: preview ? 'https://candidate.example' : '', HOST: '127.0.0.1', PORT: '0'
  };
  const child = spawn(process.execPath, ['backend/server.js'], {
    env: processEnv, stdio: ['ignore', 'pipe', 'pipe']
  });
  const exit = once(child, 'exit');
  child.stderr.resume();
  let port;
  try {
    port = await Promise.race([
      once(child.stdout, 'data', { signal: AbortSignal.timeout(15000) })
        .then(([chunk]) => Number(String(chunk).match(/porta (\d+)/)?.[1])),
      exit.then(([code]) => { throw new Error('Backend encerrou com código ' + code); })
    ]);
    assert.ok(port);
  } catch (error) {
    child.kill();
    await exit;
    throw error;
  }
  child.stdout.resume();
  return {
    async call(route, { method = 'GET', body, authenticated = true, headers = {} } = {}) {
      if (authenticated) headers.Authorization = 'Bearer ' + token;
      if (body) headers['Content-Type'] = 'application/json';
      return fetch('http://127.0.0.1:' + port + route, {
        method, headers, body: body && JSON.stringify(body), signal: AbortSignal.timeout(10000)
      });
    },
    async close() {
      child.kill();
      await exit;
    }
  };
}

test('servidor real persiste, autoriza, faz backup e reabre SQLite após reiniciar', { timeout: 45000 }, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'almoxa-diagnostics-'));
  const path = join(temp, 'test.sqlite');
  const base = '/api/v2/diagnostics';
  const record = { id: 'record-1', message: 'inicial', origin: 'teste' };
  let server;
  try {
    server = await start(path);
    assert.equal((await server.call('/health')).status, 200);
    assert.match(await (await server.call('/')).text(), /preview-client\.js/);
    const opened = await server.call('/api/v2/preview/session', { method: 'POST' });
    assert.equal(opened.status, 200);
    const session = (await opened.json()).dados.token;
    const unavailable = await fetch(new URL('/api/v2/preview/dispatch', opened.url), {
      method: 'POST', headers: { Authorization: 'Bearer ' + session, 'Content-Type': 'application/json' },
      body: JSON.stringify({ modulo: 'nf', acao: 'listar' })
    });
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).codigo, 'ARMAZENAMENTO_OPERACIONAL_INDISPONIVEL');
    assert.match(await (await server.call('/diagnostics')).text(), /diagnostics-client\.js/);
    const browserScript = await (await server.call('/diagnostics-client.js')).text();
    assert.equal((await server.call(base, { authenticated: false })).status, 401);
    assert.equal((await server.call(base + '/missing')).status, 404);
    const write = body => server.call(base, { method: 'POST', body });
    const creates = await Promise.all([write(record), write(record)]);
    assert.deepEqual(creates.map(response => response.status).sort(), [200, 201]);
    assert.equal((await write({ ...record, message: 'diferente' })).status, 409);
    assert.equal((await write({ id: 'invalid' })).status, 400);
    const listing = await (await server.call(base + '?origin=teste&page=1&limit=1')).json();
    assert.equal(listing.data.records.length, 1);
    assert.equal(listing.data.hasNext, false);
    const empty = await (await server.call(base + '?origin=outro')).json();
    assert.deepEqual(empty.data.records, []);
    const current = await (await server.call(base + '/' + record.id)).json();
    assert.equal(current.data.message, 'inicial');
    const output = {};
    let submit;
    const form = {
      addEventListener(_event, handler) { submit = handler; },
      elements: { version: {}, message: {} }
    };
    runInNewContext(browserScript, {
      document: { querySelector: selector => selector === '#diagnostics' ? form : output },
      FormData: class { get(key) { return { id: record.id, token }[key]; } },
      fetch: (route, options) => {
        assert.equal(options.headers.Authorization, 'Bearer ' + token);
        return server.call(route, { method: options.method });
      },
      AbortSignal
    });
    await submit({ preventDefault() {}, submitter: { value: 'read' } });
    assert.equal(JSON.parse(output.textContent).data.message, 'inicial');
    assert.equal(form.elements.version.value, 1);
    const patch = body => server.call(base + '/' + record.id, { method: 'PATCH', body });
    assert.equal((await patch({ message: 'atualizado', version: 1 })).status, 200);
    assert.equal((await patch({ message: 'atualizado', version: 1 })).status, 409);

    const check = new DatabaseSync(path);
    try {
      assert.equal(check.prepare('SELECT count(*) AS n FROM v2_diagnostic_audit').get().n, 2);
      check.exec(`
        CREATE TRIGGER test_failure BEFORE INSERT ON v2_diagnostic_audit
        BEGIN SELECT RAISE(ABORT, 'simulated audit failure'); END
      `);
      assert.equal((await patch({ message: 'falha', version: 2 })).status, 503);
      assert.equal(check.prepare('SELECT message FROM v2_diagnostic_records').get().message, 'atualizado');
      check.exec('DROP TRIGGER test_failure');
    } finally {
      check.close();
    }

    const copy = join(temp, 'backup.sqlite');
    const storage = new SqliteDiagnosticsProvider(path);
    storage.connect({ readOnly: true });
    try {
      await storage.backupTo(copy);
      await assert.rejects(storage.backupTo(copy), { code: 'EEXIST' });
    } finally {
      storage.disconnect();
    }
    const snapshot = new DatabaseSync(copy, { readOnly: true });
    try {
      assert.equal(snapshot.prepare('SELECT version FROM v2_diagnostic_records').get().version, 2);
    } finally {
      snapshot.close();
    }

    await server.close();
    server = await start(path, 'reader');
    const persisted = await (await server.call(base + '/' + record.id)).json();
    assert.equal(persisted.data.message, 'atualizado');
    assert.equal(persisted.data.version, 2);
    assert.equal(persisted.data.updatedBy, 'integration-test');
    assert.equal((await patch({ message: 'bloqueado', version: 2 })).status, 403);
  } finally {
    await server?.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test('Desktop e Campo usam os motores do Core no mesmo SQLite isolado', { timeout: 45000 }, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'almoxa-preview-'));
  const path = join(temp, 'preview.sqlite');
  let server;
  try {
    server = await start(path, 'operator', true);
    for (const page of ['/', '/campo']) {
      const response = await server.call(page);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /homologacao\/preview-client\.js/);
    }
    for (const name of [
      'ALMOXA PRO — MÓDULO DE SINCRONIZAÇÃO E RENDERIZAÇÃO VISUAL.js',
      'ALMOX-PRO — BOOTSYNC.js',
      'ALMOX-PRO — MOTOR DE LEITURA DE NOTA FISCAL.js'
    ]) assert.equal((await server.call('/' + encodeURIComponent(name))).status, 200);
    const db = new DatabaseSync(path);
    try {
      const append = db.prepare('INSERT INTO v2_preview_events (motor,id,version,operation,payload) VALUES (?,?,1,?,?)');
      for (const [motor, note] of [
        ['config', { id: 'PAINEL_CONFIG', valor: JSON.stringify({ titulo: 'Painel sintético' }) }],
        ['usuarios', { id: 'SYN-COLAB', nome: 'Colaborador sintético', perfil: 'ADMINISTRADOR', senha: 'fixture' }]
      ]) {
        append.run(motor, note.id, note.id, JSON.stringify({
          id: note.id, operation: note.id, version: 1, actor: 'fixture', fingerprint: 'fixture', note
        }));
      }
    } finally {
      db.close();
    }
    const sessionPath = '/api/v2/preview/session';
    const options = { method: 'OPTIONS', authenticated: false, headers: {
      Origin: 'https://candidate.example', 'Access-Control-Request-Method': 'POST'
    } };
    const preflight = await server.call(sessionPath, options);
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), options.headers.Origin);
    const denied = await server.call(sessionPath, { ...options, headers: { ...options.headers, Origin: 'https://other.example' } });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.has('access-control-allow-origin'), false);
    const health = await server.call('/health', { headers: { Origin: options.headers.Origin } });
    assert.equal(health.headers.get('access-control-allow-origin'), options.headers.Origin);
    assert.equal((await server.call(sessionPath, { method: 'POST', authenticated: false })).status, 401);
    async function signIn() {
      const response = await server.call(sessionPath, { method: 'POST' });
      assert.equal(response.status, 200);
      return { url: response.url, token: (await response.json()).dados.token };
    }
    const dispatch = (session, modulo, acao, payload = {}) => fetch(
      new URL('/api/v2/preview/dispatch', session.url), {
        method: 'POST', headers: { Authorization: 'Bearer ' + session.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ modulo, acao, payload }), signal: AbortSignal.timeout(10000)
      });
    let session = await signIn();
    const call = async (...args) => {
      const response = await dispatch(session, ...args);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.ok, true);
      return body.dados;
    };
    assert.equal((await call('dashboard', 'mural')).titulo, 'Painel sintético');
    const users = await call('usuarios', 'listar');
    assert.equal(users[0].perfilCore, 'ADMINISTRADOR');
    assert.equal(users[0].senha, undefined);
    assert.deepEqual(await call('estoque', 'movimentacoes'), []);
    assert.deepEqual(await call('epi', 'fichas'), []);
    assert.deepEqual(await call('nf', 'listar'), []);
    const request = { operation: 'v431-test-operation', version: 0, titulo: 'Ocorrência sintética' };
    const created = await call('ocorrencias', 'criar', request);
    assert.equal((await call('ocorrencias', 'criar', request)).id, created.id);
    await server.close();
    server = await start(path, 'reader', true);
    session = await signIn();
    assert.equal((await call('ocorrencias', 'obter', { id: created.id })).titulo, request.titulo);
    assert.equal((await dispatch(session, 'usuarios', 'listar')).status, 403);
    assert.equal((await dispatch(session, 'ocorrencias', 'criar', request)).status, 403);
  } finally {
    await server?.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test('entrega, devolução e estorno de EPI persistem em um único evento de estoque', { timeout: 45000 }, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'almoxa-epi-'));
  const path = join(temp, 'epi.sqlite');
  let server;
  try {
    server = await start(path, 'operator', true);
    const db = new DatabaseSync(path);
    try {
      const insert = db.prepare('INSERT INTO v2_preview_events (motor,id,version,operation,payload) VALUES (?,?,1,?,?)');
      for (const [motor, note] of [
        ['usuarios', { id: 'synthetic-user', nome: 'Pessoa de teste', matricula: '123', status: 'ATIVO' }],
        ['stock', { id: 'SYN-EPI-1', locais: { A1: { saldo: 8, reservado: 2 }, B1: { saldo: 4, reservado: 0 } } }]
      ]) {
        insert.run(motor, note.id, 'seed-' + motor, JSON.stringify({
          id: note.id, operation: 'seed-' + motor, version: 1, note
        }));
      }
      db.exec("CREATE TRIGGER epi_fail BEFORE INSERT ON v2_preview_events WHEN NEW.operation='epi-fail' BEGIN SELECT RAISE(ABORT,'fixture'); END");
    } finally { db.close(); }
    let session;
    async function login() {
      const response = await server.call('/api/v2/preview/session', { method: 'POST' });
      assert.equal(response.status, 200);
      session = { url: response.url, token: (await response.json()).dados.token };
    }
    async function call(modulo, acao, payload) {
      const r = await fetch(new URL('/api/v2/preview/dispatch', session.url), {
        method: 'POST', headers: { Authorization: 'Bearer ' + session.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ modulo, acao, payload })
      });
      return { status: r.status, ...(await r.json()) };
    }
    await login();
    const base = { sku: 'SYN-EPI-1', local: 'A1', usuarioId: 'synthetic-user' };
    const mutate = (acao, fields) => call('epi', acao, { ...base, ...fields });
    const balance = async (local = 'A1') => (await call('estoque', 'saldo', { ...base, local })).dados;
    const history = async () => (await call('epi', 'historicoEstoque', { usuarioId: base.usuarioId })).dados;
    const deliver = { operacaoCore: 'epi-deliver', versaoCore: 1, quantidade: 3 };
    assert.equal((await mutate('entregarEstoque', { ...deliver, operacaoCore: 'epi-fail' })).status, 503);
    assert.equal((await balance()).saldo, 8);
    assert.deepEqual(await history(), []);
    assert.equal((await mutate('entregarEstoque', { ...deliver, quantidade: 7 })).status, 409);
    const first = await mutate('entregarEstoque', deliver);
    assert.equal(first.status, 200);
    assert.deepEqual(await mutate('entregarEstoque', deliver), first);
    assert.deepEqual(await balance(), { saldo: 5, reservado: 2, disponivel: 3, version: 2 });
    assert.equal((await balance('B1')).saldo, 4);
    assert.equal((await mutate('devolverEstoque', { original: 'epi-deliver', operacaoCore: 'epi-return', versaoCore: 2, quantidade: 3 })).status, 200);
    assert.equal((await mutate('estornarEstoque', { original: 'epi-deliver', operacaoCore: 'epi-again', versaoCore: 3 })).status, 409);
    assert.equal((await mutate('entregarEstoque', { ...deliver, operacaoCore: 'epi-second', versaoCore: 3 })).status, 200);
    assert.equal((await mutate('estornarEstoque', { original: 'epi-second', operacaoCore: 'epi-reverse', versaoCore: 4 })).status, 200);
    await server.close();
    server = await start(path, 'reader', true, false);
    await login();
    assert.equal((await mutate('entregarEstoque', { ...deliver, operacaoCore: 'readonly-denied', versaoCore: 5 })).status, 403);
    const fiche = await call('epi', 'obter', { id:'epi-deliver' });
    assert.equal(fiche.dados.matricula, '123');
    const list = await call('epi', 'fichas', {});
    assert.equal(list.dados.length, 4);
    const events = await history();
    assert.deepEqual(events.map(event => event.kind), ['entrega', 'devolucao', 'entrega', 'estorno']);
    assert.ok(events.every(event => event.actor === 'integration-test' && event.matricula === '123' && event.at));
    assert.deepEqual(await balance(), { saldo: 8, reservado: 2, disponivel: 6, version: 5 });
  } finally {
    await server?.close();
    await rm(temp, { recursive: true, force: true });
  }
});
