
'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const {
  GoogleSheetsProvider
} = require('../adapters/google-sheets-provider');

async function run() {
  const provider = new GoogleSheetsProvider();

  const connection = await provider.connect();

  assert.equal(connection.connected, true);
  assert.ok(connection.spreadsheet);

  const id = randomUUID();

  const record = {
    id,
    createdAt: new Date().toISOString(),
    origin: 'ALMOXA_PRO_V2',
    message: 'Teste real de conexão Google Sheets'
  };

  const written = await provider.writeTestRecord(record);

  assert.equal(written.id, id);

  const read = await provider.readTestRecord(id);

  assert.equal(read.id, id);
  assert.equal(read.origin, record.origin);
  assert.equal(read.message, record.message);

  console.log('VALIDAÇÃO REAL GOOGLE SHEETS APROVADA.');
  console.log('Planilha:', connection.spreadsheet);
  console.log('UUID confirmado:', id);
}

run().catch(error => {
  console.error('VALIDAÇÃO GOOGLE SHEETS FALHOU:', error.message);
  process.exitCode = 1;
});
