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

async function start(path, role = 'operator', preview = false, allowWrite = preview, approvalProfile = '', actor = 'integration-test') {
  const processEnv = {
    ...process.env, ALMOXA_SQLITE_PATH: path, ALMOXA_DIAGNOSTICS_TOKEN: token,
    ALMOXA_DIAGNOSTICS_ACTOR: actor, ALMOXA_DIAGNOSTICS_ROLE: role,
    ALMOXA_PREVIEW_SHEET_ID: '', ALMOXA_PREVIEW_SQLITE: preview ? '1' : '',
    ALMOXA_PREVIEW_WRITE: allowWrite ? '1' : '', ALMOXA_PREVIEW_APPROVAL_PROFILE: approvalProfile,
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

async function previewDispatch(server) {
  const login = await server.call('/api/v2/preview/session', { method: 'POST' });
  assert.equal(login.status, 200);
  const session = (await login.json()).dados.token;
  return async (modulo, acao, payload = {}) => {
    const response = await fetch(new URL('/api/v2/preview/dispatch', login.url), {
      method: 'POST', headers: { Authorization: 'Bearer ' + session, 'Content-Type': 'application/json' },
      body: JSON.stringify({ modulo, acao, payload }), signal: AbortSignal.timeout(5000)
    });
    return { status: response.status, ...(await response.json()) };
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

test('lote de 23 consultas de homologação passa pelo Core e SQLite via HTTP', { timeout: 45000 }, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'almoxa-lote-23-'));
  let server;
  try {
    server = await start(join(temp, 'homologacao.sqlite'), 'operator', true, false);
    const login = await server.call('/api/v2/preview/session', { method: 'POST' });
    assert.equal(login.status, 200);
    const session = (await login.json()).dados.token;
    const routes = [
      ['nf', 'listar'], ['compras', 'listar'], ['estoque', 'movimentacoes'],
      ['itens', 'listar'], ['fornecedores', 'listar'], ['categorias', 'listar'],
      ['obras', 'listar'], ['usuarios', 'listar'], ['config', 'obter', { chave: 'PAINEL_CONFIG' }],
      ['auditoria', 'listar'], ['ocorrencias', 'listar'], ['notificacoes', 'listar'],
      ['kits', 'listar'], ['calendario', 'listar'], ['centros', 'listar'],
      ['projetos', 'listar'], ['relatorios', 'listar'], ['mural', 'listar'],
      ['painel', 'carregar'], ['automacao', 'regras'], ['ferramentas', 'listar'],
      ['epi', 'fichas'], ['manutencao', 'status']
    ];
    assert.equal(new Set(routes.map(([modulo]) => modulo)).size, 23);
    for (const [modulo, acao, payload = {}] of routes) {
      const url = new URL('/api/v2/preview/dispatch', login.url);
      const options = { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modulo, acao, payload }), signal: AbortSignal.timeout(5000) };
      const denied = await fetch(url, options);
      assert.equal(denied.status, 401, modulo + ' sem sessão');
      await denied.text();
      const response = await fetch(url, { ...options,
        headers: { ...options.headers, Authorization: 'Bearer ' + session } });
      const result = await response.json();
      assert.equal(response.status, 200, modulo + ': ' + JSON.stringify(result));
      assert.equal(result.ok, true, modulo + ': ' + JSON.stringify(result));
      assert.ok(Object.hasOwn(result, 'dados'), modulo + ' sem envelope');
    }
  } finally {
    await server?.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test('catálogo, configuração e obras gravam por HTTP e mantêm o escopo de leitura', { timeout: 45000 }, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'almoxa-catalogo-http-'));
  const path = join(temp, 'catalogo.sqlite');
  let server;
  let session;
  async function boot(role, write) {
    server = await start(path, role, true, write);
    const response = await server.call('/api/v2/preview/session', { method: 'POST' });
    assert.equal(response.status, 200);
    session = { url: response.url, token: (await response.json()).dados.token };
  }
  async function call(modulo, acao, payload = {}) {
    const response = await fetch(new URL('/api/v2/preview/dispatch', session.url), {
      method: 'POST', headers: { Authorization: 'Bearer ' + session.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ modulo, acao, payload }), signal: AbortSignal.timeout(5000)
    });
    return { status: response.status, ...(await response.json()) };
  }
  try {
    await boot('operator', true);
    const seeds = [
      ['categorias', { data: { id: 'SYN-CAT', nome: 'Categoria sintética' } }],
      ['itens', { data: { sku: 'SYN-CATALOG', descricao: 'Item sintético', categoria: 'SYN-CAT' } }],
      ['fornecedores', { data: { cnpj: '00000000000001', razaoSocial: 'Fornecedor sintético' } }],
      ['config', { chave: 'synthetic-display', valor: { modo: 'teste' } }],
      ['obras', { nome: 'Obra sintética' }]
    ];
    for (const [motor, data] of seeds) {
      const body = { operation: 'synthetic-' + motor, version: 0, ...data };
      const created = await call(motor, 'salvar', body);
      assert.equal(created.status, 200, motor);
      assert.equal(created.ok, true, motor);
      assert.deepEqual(await call(motor, 'salvar', body), created);
    }
    const stale = await call('itens', 'salvar', { operation:'synthetic-update', version:0,
      data:{sku:'SYN-CATALOG', descricao:'Alteração defasada'} });
    assert.equal(stale.status, 409);
    const invalid = await call('itens', 'salvar', { operation:'synthetic-invalid', version:0, data:{} });
    assert.equal(invalid.status, 400);
    const changed = await call('itens', 'salvar', { operation:'synthetic-update', version:1,
      data:{sku:'SYN-CATALOG', descricao:'Item atualizado'} });
    assert.equal(changed.versaoCore, 2);
    const audit = await call('auditoria','listar');
    assert.deepEqual(new Set(audit.dados.map(row=>row.modulo)), new Set(['config','obras']));

    await server.close();
    await boot('reader', true);
    for (const [motor, data] of seeds) {
      const denied = await call(motor, 'salvar', { operation: 'synthetic-denied', version: 0, ...data });
      assert.equal(denied.status, 403, motor);
    }
    assert.equal((await call('itens','obter',{sku:'SYN-CATALOG'})).dados.descricao, 'Item atualizado');
    assert.equal((await call('fornecedores','listar')).dados.length, 1);
    assert.equal((await call('categorias','listar')).dados.length, 1);
    assert.deepEqual((await call('config','obter',{chave:'synthetic-display'})).dados, { modo:'teste' });
    assert.equal((await call('obras','listar')).dados.length, 1);
    await server.close();
    await boot('operator', false);
    assert.equal((await call('obras','salvar',{nome:'Não gravar'})).status, 403);
  } finally {
    await server?.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test('compras e solicitações pelo HTTP preservam reenvio, reserva e recuperação', { timeout: 45000 }, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'almoxa-fluxos-http-'));
  const path = join(temp, 'fluxos.sqlite');
  let server;
  let session;
  async function boot(role, write) {
    server = await start(path, role, true, write);
    const response = await server.call('/api/v2/preview/session', { method: 'POST' });
    assert.equal(response.status, 200);
    session = { url: response.url, token: (await response.json()).dados.token };
  }
  async function call(modulo, acao, payload = {}) {
    const r = await fetch(new URL('/api/v2/preview/dispatch', session.url), {
      method:'POST', headers:{ Authorization:'Bearer '+session.token, 'Content-Type':'application/json' },
      body:JSON.stringify({ modulo, acao, payload }), signal:AbortSignal.timeout(5000)
    });
    return { status:r.status, ...(await r.json()) };
  }
  try {
    await boot('operator', true);
    const sku = 'SYN-FLUXO';
    assert.equal((await call('itens','salvar',{ operation:'synthetic-item',version:0,
      data:{sku,descricao:'Material sintético',valorUnitario:5} })).ok,true);
    assert.equal((await call('estoque','movimentar',{ sku,local:'A',tipo:'entrada',qtd:2,
      operacaoCore:'synthetic-stock',versaoCore:0 })).ok,true);
    const purchase = { sku, qtd:3, operation:'synthetic-purchase' };
    const created = await call('compras','precompra',purchase);
    assert.equal(created.ok,true);
    assert.deepEqual(await call('compras','precompra',purchase),created);
    assert.equal((await call('compras','precompra',{...purchase,qtd:4})).status,409);
    assert.equal((await call('compras','alterarStatus',{id:created.dados.id,operation:'synthetic-transition',
      version:1,status:'EM_COTACAO'})).ok,true);
    const request = { local:'A', operation:'synthetic-request', itens:JSON.stringify([{sku,qtd:3,preco:5}]) };
    const sent = await call('solicitacoes','criar',request);
    assert.equal(sent.ok,true);
    assert.equal(sent.reserva.reserva.status,'PENDENTE_APROVACAO');
    assert.equal(sent.reserva.semSaldo.length,1);
    assert.deepEqual(await call('solicitacoes','criar',request),sent);
    assert.deepEqual((await call('estoque','saldo',{sku,local:'A'})).dados,
      {saldo:2,reservado:0,disponivel:2,version:1});
    await server.close();
    await boot('reader',true);
    assert.equal((await call('compras','precompra',purchase)).status,403);
    assert.equal((await call('solicitacoes','criar',request)).status,403);
    const loaded = await call('solicitacoes','listar');
    assert.equal(loaded.dados.length,1);
    assert.equal(loaded.dados[0].reserva,sent.reserva.protocolo);
    assert.equal((await call('compras','listar',{status:'EM_COTACAO'})).dados.length,1);
    await server.close();
    await boot('operator',false);
    assert.equal((await call('solicitacoes','criar',request)).status,403);
  } finally {
    await server?.close();
    await rm(temp,{recursive:true,force:true});
  }
});

test('aprovação e retirada via HTTP aplicam a alçada e baixam estoque uma vez', { timeout: 45000 }, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'almoxa-retirada-http-'));
  const path = join(temp, 'retirada.sqlite');
  let server;
  let session;
  async function boot(role, approvalProfile) {
    server = await start(path, role, true, true, approvalProfile);
    const response = await server.call('/api/v2/preview/session', { method:'POST' });
    assert.equal(response.status,200);
    session={url:response.url,token:(await response.json()).dados.token};
  }
  async function call(modulo,acao,payload) {
    const response=await fetch(new URL('/api/v2/preview/dispatch',session.url),{
      method:'POST',headers:{Authorization:'Bearer '+session.token,'Content-Type':'application/json'},
      body:JSON.stringify({modulo,acao,payload}),signal:AbortSignal.timeout(5000)
    });
    return {status:response.status,...await response.json()};
  }
  try {
    await boot('operator','MESTRE');
    const sku='SYN-WITHDRAW-HTTP';
    const local='A';
    assert.equal((await call('itens','salvar',{operation:'withdraw-item',version:0,
      data:{sku,descricao:'Item sintético',categoria:'Material'}})).ok,true);
    assert.equal((await call('estoque','movimentar',{sku,local,tipo:'entrada',qtd:4,
      operacaoCore:'withdraw-stock',versaoCore:0})).ok,true);
    const request=await call('solicitacoes','criar',{operation:'withdraw-request',local,itens:[{sku,qtd:3}]});
    const protocolo=request.reserva.protocolo;
    const decision={protocolo,itens:[sku],decisao:'APROVADA',version:1,operation:'withdraw-approve'};
    const take={protocolo,sku,qtd:1,version:2,operation:'withdraw-one'};
    assert.equal((await call('retiradas','confirmar',take)).status,409);
    assert.equal((await call('aprovacoes','decidirItens',decision)).ok,true);
    const partial=await call('retiradas','confirmar',take);
    assert.equal(partial.dados.status,'PARCIALMENTE_RETIRADA');
    assert.deepEqual(await call('retiradas','confirmar',take),partial);
    assert.equal((await call('estoque','saldo',{sku,local})).dados.saldo,3);
    await server.close();
    await boot('reader','MESTRE');
    assert.equal((await call('aprovacoes','decidirItens',decision)).status,403);
    assert.equal((await call('retiradas','confirmar',take)).status,403);
    assert.equal((await call('retiradas','itensLiberados',{protocolo})).dados.liberados.length,1);
    const history=await call('estoque','movimentacoes',{sku,somenteSaidas:true});
    assert.deepEqual(history.dados.map(row=>row.qtd),[-1]);
  } finally {
    await server?.close();
    await rm(temp,{recursive:true,force:true});
  }
});

test('inventário e ferramentas pela API aplicam versões, custódia e restrições de gravação', { timeout: 45000 }, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'almoxa-inventario-ferramentas-'));
  const path = join(temp, 'operacoes.sqlite');
  let server;
  try {
    server = await start(path, 'operator', true);
    let call = await previewDispatch(server);
    const sku = 'SYN-INV-HTTP';
    const local = 'A';
    const secondSku = 'SYN-INV-SEGUNDO';
    assert.equal((await call('estoque', 'movimentar', { sku, local, tipo: 'entrada', qtd: 5,
      operacaoCore: 'inv-http-stock', versaoCore: 0 })).ok, true);
    const open = { operation: 'inv-http-open', version: 0, obra: 'OB01', local, itens: [{ sku }, { sku: secondSku }] };
    const inventory = await call('inventario', 'criar', open);
    assert.equal(inventory.versaoCore, 1);
    const id = inventory.dados.id;
    assert.deepEqual(JSON.parse(inventory.dados.itens).map(item => [item.saldo, item.versaoEstoque]), [[5, 1], [0, 0]]);
    const count = { id, sku, quantidade: 3, operation: 'inv-http-count', version: 1 };
    assert.equal((await call('inventario', 'encerrar', { id, operation: 'inv-http-close', version: 1 })).status, 409);
    assert.equal((await call('inventario', 'registrarContagem', { ...count, quantidade: -1 })).status, 400);
    assert.equal((await call('inventario', 'registrarContagem', count)).versaoCore, 2);
    assert.equal((await call('inventario', 'registrarContagem', count)).repetida, true);
    assert.equal((await call('inventario', 'registrarContagem', { ...count, quantidade: 4 })).codigo, 'INVENTARIO_CONFLITO_IDEMPOTENCIA');
    assert.equal((await call('inventario', 'registrarContagem', { ...count, operation: 'inv-second', sku: secondSku, quantidade: 0 })).codigo,
      'INVENTARIO_CONFLITO_VERSAO');
    assert.equal((await call('inventario', 'registrarContagem', { ...count, operation: 'inv-second', sku: secondSku, quantidade: 0, version: 2 })).versaoCore, 3);

    const patrimonio = 'SYN-FERRAMENTA';
    const tool = { patrimonio, operation: 'tool-http-open', version: 0, nome: 'Ferramenta sintética' };
    assert.equal((await call('ferramentas', 'salvar', tool)).dados.status, 'DISPONIVEL');
    const take = { patrimonio, operation: 'tool-http-take', version: 1 };
    const taken = await call('ferramentas', 'retirar', take);
    assert.equal(taken.dados.com, 'integration-test');
    assert.deepEqual(await call('ferramentas', 'retirar', take), taken);
    const damaged = { patrimonio, operation: 'tool-http-return', version: 2, avaria: true };
    assert.equal((await call('ferramentas', 'devolver', damaged)).status, 400);
    damaged.observacao = 'Avaria sintética';

    await server.close();
    server = await start(path, 'operator', true, true, '', 'outro-operador');
    call = await previewDispatch(server);
    const close = { id, operation: 'inv-http-close', version: 3 };
    assert.equal((await call('inventario', 'encerrar', close)).status, 403);
    assert.equal((await call('ferramentas', 'devolver', damaged)).status, 403);

    await server.close();
    server = await start(path, 'operator', true);
    call = await previewDispatch(server);
    assert.equal((await call('inventario', 'encerrar', close)).dados.status, 'CONFIRMADA');
    assert.equal((await call('ferramentas', 'devolver', damaged)).dados.status, 'MANUTENCAO');
    assert.equal((await call('ferramentas', 'retornarManutencao', { patrimonio, operation: 'tool-http-repair', version: 3 })).dados.status,
      'DISPONIVEL');

    await server.close();
    server = await start(path, 'reader', true);
    call = await previewDispatch(server);
    assert.equal((await call('inventario', 'criar', open)).status, 403);
    assert.equal((await call('ferramentas', 'retirar', take)).status, 403);
    assert.equal((await call('inventario', 'obter', { id })).versaoCore, 4);
    assert.deepEqual((await call('inventario', 'divergencias', { id })).dados,
      [{ sku, saldo: 5, quantidade: 3, diferenca: -2 }]);
    assert.equal((await call('estoque', 'saldo', { sku, local })).dados.saldo, 5);
    assert.equal((await call('ferramentas', 'obter', { patrimonio })).versaoCore, 4);
    const history = await call('ferramentas', 'historico', { patrimonio });
    assert.deepEqual(history.dados.map(row => [row.evento, row.actor]),
      ['salvar', 'retirar', 'devolver', 'retornarManutencao'].map(evento => [evento, 'integration-test']));

    await server.close();
    server = await start(path, 'operator', true, false);
    call = await previewDispatch(server);
    assert.equal((await call('inventario', 'criar', open)).status, 403);
    assert.equal((await call('ferramentas', 'salvar', tool)).status, 403);
  } finally {
    await server?.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test('compras emite o lote e converte a pré-compra no mesmo evento', { timeout: 45000 }, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'almoxa-pedidos-http-'));
  const path = join(temp, 'compras.sqlite');
  let server;
  try {
    server = await start(path, 'operator', true);
    let call = await previewDispatch(server);
    const sku = 'SYN-PEDIDO';
    const other = 'SYN-ACESSORIO';
    for (const key of [sku, other]) {
      assert.equal((await call('itens', 'salvar', { operation: 'item-' + key, version: 0,
        data: { sku: key, descricao: 'Material sintético', valorUnitario: 5 } })).ok, true);
    }
    const source = await call('compras', 'precompra', { sku, qtd: 2, operation: 'pc-pedido' });
    assert.equal(source.ok, true);
    const [precompra] = (await call('compras', 'precompras')).dados;
    const request = { operation: 'emitir-pedido', precompra: precompra.id, version: precompra.versaoCore,
      itens: [{ sku, qtd: 2 }, { sku: other, qtd: 1, valorUnitario: 0 }] };
    const missing = { ...request, itens: [request.itens[0], { sku: 'SYN-INEXISTENTE', qtd: 1 }] };
    assert.equal((await call('compras', 'pedido', missing)).status, 404);
    assert.deepEqual((await call('compras', 'pedidos')).dados, []);
    assert.equal((await call('compras', 'precompras')).dados[0].status, 'AGUARDANDO_APROVACAO');
    assert.equal((await call('compras', 'pedido', { ...request, version: 2 })).codigo, 'COMPRA_CONFLITO_VERSAO');
    const [order, replay] = await Promise.all([call('compras', 'pedido', request), call('compras', 'pedido', request)]);
    assert.equal(order.status, 200);
    assert.deepEqual(replay, order);
    assert.equal(order.dados.quantidade, 2);
    assert.deepEqual(order.dados.pedidos.map(note => [note.sku, note.valorEstimado, note.precompra]),
      [[sku, 10, precompra.id], [other, 0, precompra.id]]);
    const [, accessory] = order.dados.pedidos;
    assert.equal((await call('compras', 'alterarStatus', { id: accessory.id, status: 'EM_TRANSITO', version: 1,
      operation: 'pedido-transito' })).ok, true);
    assert.equal((await call('compras', 'pedido', { ...request, operation: 'pedido-novo', version: 2 })).codigo,
      'PRECOMPRA_INCOMPATIVEL');
    assert.equal((await call('compras', 'alterarStatus', { id: precompra.id, status: 'EM_COTACAO', version: 2,
      operation: 'pc-reabrir' })).status, 409);

    await server.close();
    server = await start(path, 'operator', true);
    call = await previewDispatch(server);
    assert.deepEqual(await call('compras', 'pedido', request), order);
    const manual = await call('compras', 'pedido', { sku, qtd: 1, operation: 'pedido-manual' });
    assert.equal(manual.dados.pedidos[0].origem, 'MANUAL');
    await server.close();
    server = await start(path, 'reader', true);
    call = await previewDispatch(server);
    assert.equal((await call('compras', 'pedido', request)).status, 403);
    const orders = (await call('compras', 'pedidos')).dados;
    assert.equal(new Set(orders.map(note => note.id)).size, 3);
    assert.equal(orders.find(note => note.id === accessory.id).status, 'EM_TRANSITO');
    const sourceAfterRestart = (await call('compras', 'precompras')).dados[0];
    assert.equal(sourceAfterRestart.status, 'CONVERTIDA_EM_PEDIDO');
    assert.equal(sourceAfterRestart.versaoCore, 2);
  } finally {
    await server?.close();
    await rm(temp, { recursive: true, force: true });
  }
});
