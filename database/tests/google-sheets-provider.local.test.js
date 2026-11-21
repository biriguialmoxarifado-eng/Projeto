'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('../../backend/runtime');
const { createHandler } = require('../../backend/server');
const { GoogleDriveProvider } = require('../adapters/google-drive-provider');
const { GoogleSheetsProvider } = require('../adapters/google-sheets-provider');

function fixture({ testSpreadsheetId = 'test-only', loseResponse = false } = {}) {
  const rows = [['ID', 'CRIADO_EM', 'ORIGEM', 'MENSAGEM']];
  const markers = new Set();
  const calls = [];
  const auth = writable => ({
    async getClient() {
      return {
        async request({ url, method, data }) {
          const path = new URL(url).pathname;
          calls.push({ path, method });
          if (path.includes('/values/')) {
            const values = path.includes('/production/') ? [['Título']] : structuredClone(rows);
            return { data: { values } };
          }
          if (method === 'GET') {
            const spreadsheetId = path.split('/').at(-1);
            const title = spreadsheetId === 'production' ? "Itens d'obra" : 'ALMOXA_TESTE_CONEXAO';
            return { data: {
              spreadsheetId,
              properties: { title: 'ALMOXA' },
              sheets: [{ properties: { sheetId: 42, title } }]
            } };
          }
          assert.equal(writable, true);
          assert.equal(path, '/v4/spreadsheets/test-only:batchUpdate');
          const [marker, append] = data.requests;
          const { namedRangeId } = marker.addNamedRange.namedRange;
          if (markers.has(namedRangeId)) throw { response: { status: 400 } };
          markers.add(namedRangeId);
          assert.equal(append.appendCells.sheetId, 42);
          rows.push(append.appendCells.rows[0].values.map(value => value.userEnteredValue.stringValue));
          if (loseResponse) throw new Error('response lost');
          return { data: {} };
        }
      };
    }
  });
  const provider = new GoogleSheetsProvider({
    spreadsheetId: 'production',
    testSpreadsheetId,
    readAuth: auth(false),
    writeAuth: auth(true)
  });
  return { provider, rows, calls };
}

const record = { id: '12345', createdAt: '2026-11-21T10:00:00.000Z', origin: 'V2', message: '=literal' };

test('o Core verifica o banco e o diagnóstico lê valores operacionais sem gravação', async () => {
  const { provider, calls } = fixture();
  const { core, diagnostics } = await createRuntime(provider);
  assert.equal((await core.health()).status, 'healthy');
  assert.deepEqual((await diagnostics.probeRead()).sheets, ["Itens d'obra"]);
  assert.ok(calls.some(({ path }) => decodeURIComponent(path).endsWith("/values/'Itens d''obra'!A1")));
  assert.ok(calls.every(({ method }) => method === 'GET'));
});

test('lê cabeçalhos e páginas pela posição física, com aspas no nome e limite da grade', async () => {
  const calls = [];
  const provider = new GoogleSheetsProvider({
    spreadsheetId: 'production',
    readAuth: { async getClient() {
      return { async request({ url, method }) {
        assert.equal(method, 'GET');
        const path = decodeURIComponent(new URL(url).pathname);
        calls.push(path);
        if (!path.includes('/values/')) return { data: { sheets: [
          { properties: { title: "Itens d'obra", gridProperties: { rowCount: 5 } } }
        ] } };
        const suffix = path.split('!').at(-1);
        const values = { '1:1': [['ID', 'Saldo']], '2:3': [[10, 0], []], '4:5': [[11, 8]] };
        assert.ok(path.includes("'Itens d''obra'!"));
        return { data: { values: values[suffix] } };
      } };
    } }
  });
  assert.deepEqual(await provider.readSheetPage("Itens d'obra", { limit: 2 }), {
    headers: ['ID', 'Saldo'], rows: [{ row: 2, values: [10, 0] }, { row: 3, values: [] }], nextRow: 4
  });
  assert.deepEqual(await provider.readSheetPage("Itens d'obra", { startRow: 4 }), {
    headers: ['ID', 'Saldo'], rows: [{ row: 4, values: [11, 8] }], nextRow: null
  });
  assert.deepEqual(await provider.readSheetPage("Itens d'obra", { startRow: 6 }), {
    headers: ['ID', 'Saldo'], rows: [], nextRow: null
  });
  const previousCalls = calls.length;
  await assert.rejects(provider.readSheetPage("Itens d'obra", { limit: 101 }), { code: 'SHEET_PAGE_INVALID' });
  assert.equal(calls.length, previousCalls);
  await assert.rejects(provider.readSheetPage('Inexistente'), { code: 'SHEET_GRID_REQUIRED' });
});


test('gravações concorrentes e retentativas deixam um único registro de teste', async () => {
  const { provider, rows } = fixture({ loseResponse: true });
  const written = await Promise.all([provider.writeTestRecord(record), provider.writeTestRecord(record)]);
  assert.deepEqual(written, [{ id: record.id, row: 2 }, { id: record.id, row: 2 }]);
  assert.deepEqual(await provider.writeTestRecord(record), written[0]);
  assert.deepEqual(await provider.readTestRecord(record.id), record);
  assert.equal(rows.length, 2);
  await assert.rejects(provider.writeTestRecord({ ...record, message: 'outro' }), { code: 'TEST_RECORD_CONFLICT' });
});

test('bloqueia planilha operacional como destino antes de fazer qualquer chamada', async () => {
  const { provider, calls } = fixture({ testSpreadsheetId: 'production' });
  await assert.rejects(provider.writeTestRecord(record), { code: 'TEST_TARGET_UNSAFE' });
  assert.equal(calls.length, 0);
});

test('o erro do Google não expõe cabeçalhos ou detalhes da autenticação', async () => {
  const provider = new GoogleSheetsProvider({
    spreadsheetId: 'production',
    readAuth: { async getClient() {
      return { async request() {
        throw { response: { status: 403, data: { sensitive: 'private' } } };
      } };
    } }
  });
  await assert.rejects(provider.probeRead(), {
    code: 'GOOGLE_SHEETS_HTTP_403',
    message: 'Google Sheets respondeu HTTP 403.'
  });
});

test('a API informa a revisão e o estado sem expor operações de banco', async () => {
  const { core } = await createRuntime(new GoogleSheetsProvider({ spreadsheetId: '' }));
  const handler = createHandler(core, 'test-revision');
  const response = {
    writeHead(status) { this.status = status; return this; },
    end(body) { this.body = body; }
  };
  await handler({ method: 'GET', url: '/health' }, response);
  assert.equal(response.status, 503);
  assert.deepEqual(JSON.parse(response.body), {
    status: 'degraded', coreVersion: '2.1.0', revision: 'test-revision'
  });
  await handler({ method: 'POST', url: '/database' }, response);
  assert.equal(response.status, 404);
});

test('lê somente os metadados solicitados do Drive com suporte a unidades compartilhadas', async () => {
  let requests = 0;
  const provider = new GoogleDriveProvider({ auth: { async getClient() {
    return { async request({ url, method, retry }) {
      requests++;
      const request = new URL(url);
      assert.equal(request.origin + request.pathname, 'https://www.googleapis.com/drive/v3/files/file-1');
      assert.equal(request.searchParams.get('supportsAllDrives'), 'true');
      assert.equal(request.searchParams.get('fields'), 'id,mimeType,trashed,modifiedTime');
      assert.equal(request.searchParams.has('alt'), false);
      assert.equal(method, 'GET');
      assert.equal(retry, false);
      return { data: { id: 'file-1', mimeType: 'application/pdf', trashed: false, name: 'private' } };
    } };
  } } });
  await assert.rejects(provider.readMetadata('a/../b'), { code: 'DRIVE_FILE_ID_INVALID' });
  assert.equal(requests, 0);
  assert.deepEqual(await provider.readMetadata('file-1'), {
    id: 'file-1', mimeType: 'application/pdf', trashed: false, modifiedTime: null
  });
});

test('oculta detalhes de autenticação e de erros do Drive', async () => {
  const denied = new GoogleDriveProvider({ auth: { async getClient() {
    return { async request() { throw { response: { status: 403, data: { private: true } } }; } };
  } } });
  await assert.rejects(denied.readMetadata('file-1'), {
    code: 'GOOGLE_DRIVE_HTTP_403', message: 'Google Drive respondeu HTTP 403.'
  });
  const unavailable = new GoogleDriveProvider({ auth: { async getClient() { throw new Error('private'); } } });
  await assert.rejects(unavailable.readMetadata('file-1'), { code: 'GOOGLE_AUTH_FAILED' });
});
