'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('../backend/runtime');
const { GoogleSheetsProvider } = require('../database/adapters/google-sheets-provider');

const credential = { token: 'isolated-token', actor: 'test-operator', role: 'operator' };
const note = { numero: '123', serie: '1', itens: [{ sku: 'SYNTHETIC', quantidade: 2 }] };

function fakeGoogle({ title = 'ALMOXA_TESTE_CORE' } = {}) {
  const rows = [['EVENTO_JSON']];
  const markers = new Set();
  let loseResponse = true;
  let writes = 0;
  const auth = { async getClient() {
    return { async request({ url, method, data }) {
      const path = decodeURIComponent(new URL(url).pathname);
      assert.ok(path.startsWith('/v4/spreadsheets/test-only'));
      if (method === 'GET') {
        if (path.includes('/values/')) return { data: { values: structuredClone(rows) } };
        return { data: { spreadsheetId: 'test-only', properties: { title },
          sheets: [{ properties: { title: 'NF_CORE_TESTE', sheetId: 7 } }] } };
      }
      writes++;
      const [op, version, append] = data.requests;
      const names = [op, version].map(request => request.addNamedRange.namedRange.namedRangeId);
      if (names.some(name => markers.has(name))) throw { response: { status: 400 } };
      names.forEach(name => markers.add(name));
      assert.equal(append.appendCells.sheetId, 7);
      rows.push([append.appendCells.rows[0].values[0].userEnteredValue.stringValue]);
      if (loseResponse) {
        loseResponse = false;
        throw new Error('response lost');
      }
      return { data: {} };
    } };
  } };
  return {
    provider: new GoogleSheetsProvider({ spreadsheetId: 'production', testSpreadsheetId: 'test-only',
      testOnly: true, readAuth: auth, writeAuth: auth }),
    events: () => rows.slice(1).map(row => JSON.parse(row[0])),
    writes: () => writes
  };
}

test('motor NF isolado confirma escrita, deduplica, rejeita versões concorrentes e restaura histórico', async () => {
  const { provider, events } = fakeGoogle();
  const runtime = () => createRuntime(provider, { invoiceTestStorage: provider, credential });
  const first = (await runtime()).getInvoiceEngine();
  const second = (await runtime()).getInvoiceEngine();
  const token = credential.token;
  const input = { operation: 'create-1', version: 0, note };
  await assert.rejects(first.salvar('wrong', input), { code: 'SESSION_INVALID' });
  assert.equal(events().length, 0);
  const initial = await first.salvar(token, input);
  assert.equal(initial.version, 1);
  assert.equal(initial.actor, 'test-operator');
  assert.deepEqual(await second.salvar(token, input), initial);
  await assert.rejects(second.salvar(token, { ...input, note: { ...note, fornecedor: 'outro' } }),
    { code: 'NF_CONFLITO_IDEMPOTENCIA' });
  const writes = await Promise.allSettled([
    first.salvar(token, { operation: 'edit-1', version: 1, note: { ...note, fornecedor: 'A' } }),
    second.salvar(token, { operation: 'edit-2', version: 1, note: { ...note, fornecedor: 'B' } })
  ]);
  assert.equal(writes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(writes.find(result => result.status === 'rejected').reason.code, 'NF_CONFLITO_VERSAO');
  const restored = await first.recuperar(token, { id: initial.id, operation: 'restore-1', version: 2, fromVersion: 1 });
  assert.equal(restored.version, 3);
  assert.deepEqual(restored.note, initial.note);
  assert.equal(restored.action, 'recuperar');
  assert.deepEqual(await second.listar(token), [restored]);
  assert.deepEqual(events().map(event => event.version), [1, 2, 3]);
});

test('motor inativo por padrão, proíbe escrita de leitor e rejeita título diferente antes de gravar', async () => {
  const { provider, writes } = fakeGoogle({ title: 'Outra planilha' });
  const disabled = await createRuntime(provider);
  assert.throws(() => disabled.getInvoiceEngine(), { code: 'NF_TESTE_DESATIVADO' });
  const reader = await createRuntime(provider, { invoiceTestStorage: provider, credential: { ...credential, role: 'reader' } });
  const input = { operation: 'invalid', version: 0, note };
  await assert.rejects(reader.getInvoiceEngine().salvar(credential.token, input), { code: 'ACCESS_DENIED' });
  const operator = await createRuntime(provider, { invoiceTestStorage: provider, credential });
  await assert.rejects(operator.getInvoiceEngine().salvar(credential.token, input), { code: 'NF_DESTINO_INSEGURO' });
  assert.equal(writes(), 0);
});
