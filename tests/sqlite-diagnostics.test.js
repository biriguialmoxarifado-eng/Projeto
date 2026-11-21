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

async function start(path, role = 'operator') {
  const processEnv = {
    ...process.env, ALMOXA_SQLITE_PATH: path, ALMOXA_DIAGNOSTICS_TOKEN: token,
    ALMOXA_DIAGNOSTICS_ACTOR: 'integration-test', ALMOXA_DIAGNOSTICS_ROLE: role,
    HOST: '127.0.0.1', PORT: '0'
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
    async call(route, { method = 'GET', body, authenticated = true } = {}) {
      const headers = {};
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
