'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createRuntime } = require('../backend/runtime');
const { createOperationalReader } = require('../backend/operational-reader');
const { createHandler } = require('../backend/server');
const { createPreview } = require('../backend/preview-api');

test('leitura operacional exige administrador autenticado e retorna somente campos autorizados', async () => {
  const password = 'synthetic-operational-test';
  const digest = createHash('sha256').update(password).digest('hex');
  const sheets = {
    USUARIOS: [
      ['id', 'nome', 'email', 'senha_hash', 'perfil', 'status', 'matricula', 'foto'],
      ['1', 'Admin Teste', 'admin@example.test', digest, ' AdMiNiStRaDoR ', 'ATIVO', '11', 'data:image/png;base64,aW1n'],
      ['2', 'Operador Teste', 'operator@example.test', digest, 'OPERADOR', 'ATIVO', '22']
    ],
    ALMOXA_ITENS: [['sku', 'descricao', 'estoqueAtual', 'categoria', 'fotoDriveId', 'marca'],
      ['SYN-1', 'Item sintético', 8, 'Material', 'image-authorized', 'Fabricante'],
      ['OTHER-2', 'Item sem saldo conhecido', 'inconsistente'], ['HIDE-1', 'Item oculto', 3, 'Oculta', 'image-hidden']],
    ALMOXA_CATEGORIAS: [['nome', 'visivel'], ['Material', 'TRUE'], ['Oculta', 'FALSE']],
    ALMOXA_EPI_FICHAS: [['id', 'matricula', 'colaborador', 'sku', 'item', 'assinatura'], ['a', '11', 'Admin Teste', 'SYN-1', 'Luva', 'segredo']],
    ALMOXA_MOVIMENTACOES: [['id', 'sku', 'qtd', 'valorUnitario', 'usuario'], ['m', 'SYN-1', 2, '12,50', 'operador-teste']]
  };
  const provider = {
    spreadsheetId: 'fake',
    async healthCheck() { return { status: 'ok' }; },
    async metadata(id) { return { spreadsheetId: id, properties: { title: 'Base de teste do adaptador' } }; },
    async request(id, path) {
      assert.equal(id, 'fake');
      const name = /^\/values\/'([^']+)'!(?:A:Z|A1:Z2)\?/.exec(decodeURIComponent(path))?.[1];
      assert.ok(Object.hasOwn(sheets, name));
      return { values: sheets[name] };
    }
  };
  const operational = createOperationalReader(provider, { drive: { async readImage(id) {
    assert.equal(id, 'image-authorized');
    return 'data:image/png;base64,aW1n';
  } } });
  const { core } = await createRuntime(provider, { operationalSecurity: operational.security });
  const handler = createHandler(core, 'abc1234', null, (req, res) => operational.handle(core, req, res), operational);
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const endpoint = 'http://127.0.0.1:' + server.address().port + '/api/v2/preview/';
  let token;
  const send = async (path, body, method = 'POST') => {
    const response = await fetch(endpoint + path, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: response.status, ...(await response.json()) };
  };
  const dispatch = (modulo, acao) => send('dispatch', { modulo, acao });
  try {
    const health = await fetch(new URL('/health', endpoint));
    assert.equal(health.status, 200);
    assert.deepEqual((await health.json()).storage, { provider: 'google-sheets', status: 'connected' });
    assert.equal((await dispatch('dashboard', 'mural')).status, 401);
    assert.equal((await dispatch('lojinha', 'catalogo')).status, 401);
    assert.equal((await send('session', { usuario: '22', senha: password })).status, 401);
    assert.equal((await send('session', { usuario: '11', senha: 'errada' })).status, 401);
    const login = await send('session', { usuario: '11', senha: password, metodo: 'senha' });
    assert.equal(login.dados.usuario.perfil, 'admin');
    token = login.dados.sessao.token;
    assert.deepEqual((await dispatch('dashboard', 'mural')).dados,
      { coreOperational: true, itens: 3, colaboradores: 2, fichasEpi: 1 });
    assert.equal((await dispatch('estoque', 'listar')).dados[0].estoque, 8);
    const movement = (await dispatch('estoque', 'movimentacoes')).dados[0];
    assert.equal(movement.sku, 'SYN-1');
    assert.equal(movement.valorUnitario, 12.5);
    assert.equal(movement.usuario, 'operador-teste');
    assert.equal((await dispatch('usuarios', 'listar')).dados[0].senha_hash, undefined);
    assert.equal((await dispatch('epi', 'fichas')).dados[0].itens[0].assinatura, undefined);
    const call = (modulo, acao, payload) => send('dispatch', { modulo, acao, payload });
    const catalogue = await call('itens', 'listar', { busca: 'SYN' });
    assert.equal(catalogue.dados.length, 1);
    const unknown = (await call('estoque', 'item', { sku: 'OTHER-2' })).dados;
    assert.equal(unknown.estoque, null);
    assert.equal(unknown.status, 'desconhecido');
    assert.equal(catalogue.dados[0].disponivel, null);
    const shop = await dispatch('lojinha', 'catalogo');
    assert.deepEqual(shop.dados.map(p => p.sku), ['SYN-1', 'OTHER-2']);
    assert.equal(shop.dados[0].temFoto, true);
    assert.equal(shop.dados[0].fotoDriveId, undefined);
    assert.equal((await call('lojinha', 'catalogo', { busca: 'FABRICANTE', categoria: 'material' })).dados.length, 1);
    assert.equal((await call('lojinha', 'item', { sku: 'HIDE-1' })).dados, null);
    assert.equal((await call('lojinha', 'foto', { sku: 'HIDE-1', fileId: 'image-authorized' })).dados.foto, null);
    assert.equal((await call('lojinha', 'foto', { sku: 'SYN-1' })).dados.foto, 'data:image/png;base64,aW1n');
    assert.equal((await dispatch('lojinha', 'salvar')).status, 403);
    const index = (await dispatch('epi', 'indice')).dados;
    assert.equal(index[0].chave, 'u:1');
    assert.match(index[0].materiais, /Luva/);
    assert.equal(index[0].itens, undefined);
    const detail = (await call('epi', 'detalhe', { chave: index[0].chave })).dados;
    assert.equal(detail.itens[0].sku, 'SYN-1');
    assert.equal((await call('usuarios', 'fotoEpi', { id: detail.usuarioId })).dados.foto, 'data:image/png;base64,aW1n');
    assert.equal((await dispatch('estoque', 'movimentar')).status, 403);
    await send('session', null, 'DELETE');
    assert.equal((await dispatch('dashboard', 'mural')).status, 401);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('saúde operacional distingue acesso Google, destino errado e esquema inválido', async () => {
  const provider = {
    spreadsheetId: 'expected',
    async metadata() { return { spreadsheetId: 'expected', properties: { title: 'Origem' } }; },
    async request() { return { values: [['coluna não reconhecida']] }; }
  };
  for (const [source, expectedTitle, code] of [
    [provider, 'Outra', 'PLANILHA_INCORRETA'],
    [provider, 'Origem', 'PLANILHA_ESQUEMA_INVALIDO'],
    [{ ...provider, async metadata() { throw Object.assign(new Error('privado'), { code: 'GOOGLE_AUTH_FAILED' }); } }, 'Origem', 'GOOGLE_AUTH_FAILED'],
    [{ ...provider, async metadata() { throw Object.assign(new Error('privado'), { code: 'GOOGLE_SHEETS_HTTP_403' }); } }, 'Origem', 'GOOGLE_SHEETS_HTTP_403']
  ]) {
    const operational = createOperationalReader(source, { expectedTitle });
    const server = createServer(createHandler(null, 'abc1234', null, null, operational));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const response = await fetch('http://127.0.0.1:' + server.address().port + '/health');
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.equal(body.core, 'online');
      assert.equal(body.storage.code, code);
      assert.doesNotMatch(JSON.stringify(body), /privado/);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  }
});

test('Loja no navegador usa o catálogo somente leitura e distingue login recusado', {
  skip: !process.env.ALMOXA_TEST_BROWSER && 'Configure ALMOXA_TEST_BROWSER', timeout: 90000
}, async t => {
  const password = 'local-browser-synthetic';
  const real = process.env.ALMOXA_TEST_REAL_CATALOG === '1';
  const verifyDrive = real && process.env.ALMOXA_TEST_REAL_DRIVE === '1';
  const { GoogleSheetsProvider } = require('../database/adapters/google-sheets-provider');
  const sheets = real ? new GoogleSheetsProvider() : null;
  if (real) sheets.validateId(sheets.spreadsheetId, 'ALMOXA_SPREADSHEET_ID');
  const title = real ? 'Base Dado almoxarifado' : 'Origem sintética';
  let itemRows;
  const provider = {
    spreadsheetId: sheets?.spreadsheetId ?? 'browser-fixture',
    metadata: id => sheets ? sheets.metadata(id) : Promise.resolve({ spreadsheetId: id, properties: { title } }),
    async request(id, path) {
      const tab = /^\/values\/'([^']+)'!/.exec(decodeURIComponent(path))?.[1];
      if (tab === 'USUARIOS') return { values: [
        ['id', 'nome', 'email', 'senha_hash', 'perfil', 'status', 'login'],
        ['browser-admin', 'Operador de ensaio', '', createHash('sha256').update(password).digest('hex'), 'admin', 'ATIVO', 'browser-admin']
      ] };
      if (sheets) {
        const response = await sheets.request(id, path);
        if (verifyDrive && tab === 'ALMOXA_ITENS' && decodeURIComponent(path).includes("'!A:Z?")) itemRows = response.values;
        return response;
      }
      if (tab === 'ALMOXA_ITENS') return { values: [['sku', 'descricao', 'estoqueAtual'], ['SYN-BROWSER', 'Luva de ensaio', 5]] };
      if (tab === 'ALMOXA_CATEGORIAS') return { values: [['nome', 'visivel']] };
      if (tab === 'ALMOXA_EPI_FICHAS') return { values: [['id', 'matricula', 'colaborador', 'sku', 'item']] };
      throw new Error('Aba inesperada');
    }
  };
  const operational = createOperationalReader(provider, { expectedTitle: title });
  const runtime = await createRuntime(provider, { operationalSecurity: operational.security });
  const preview = createPreview(runtime, join(__dirname, '..'), { operational });
  const server = createServer(createHandler(runtime.core, 'abc1234', null, preview, operational));
  const temp = await mkdtemp(join(tmpdir(), 'almoxa-operacional-browser-'));
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = 'http://127.0.0.1:' + server.address().port;
    const health = await fetch(origin + '/health', { signal: AbortSignal.timeout(25000) });
    assert.equal(health.status, 200);
    const send = (path, body, token) => fetch(origin + '/api/v2/preview/' + path, { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: JSON.stringify(body), signal: AbortSignal.timeout(25000) });
    const login = await send('session', { usuario: 'browser-admin', senha: password });
    assert.equal(login.status, 200);
    const token = (await login.json()).dados.sessao.token;
    const response = await send('dispatch', { modulo: 'lojinha', acao: 'catalogo' }, token);
    assert.equal(response.status, 200);
    const { dados } = await response.json();
    assert.ok(dados.length);
    if (real) t.diagnostic('Catálogo retornado pela API Google ao Desktop: ' + dados.length + ' itens');
    let photoSku;
    if (verifyDrive) {
      const [headers, ...data] = itemRows ?? [];
      const idColumn = headers.indexOf('fotoDriveId');
      const skuColumn = headers.indexOf('sku');
      const visible = new Set(dados.filter(item => item.temFoto).map(item => String(item.sku)));
      const candidates = data.filter(row => /^[\w-]{10,200}$/.test(String(row[idColumn] ?? '')) && visible.has(String(row[skuColumn])));
      for (const candidate of candidates.slice(0, 5)) {
        const sku = String(candidate[skuColumn]);
        const image = await send('dispatch', { modulo: 'lojinha', acao: 'foto', payload: { sku } }, token);
        assert.equal(image.status, 200);
        if (/^data:image\//.test((await image.json()).dados.foto ?? '')) { photoSku = sku; break; }
      }
      assert.ok(photoSku, 'Nenhuma imagem associada foi entregue pelo Core.');
    }
    const { exerciseOperational } = require('./desktop-browser');
    await exerciseOperational(process.env.ALMOXA_TEST_BROWSER, join(temp, 'browser'), origin, password, String(dados[0].sku), photoSku);
    if (photoSku) t.diagnostic('Imagem associada do Google Drive renderizada no Desktop.');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(temp, { recursive: true, force: true, maxRetries: 12, retryDelay: 100 });
  }
});
