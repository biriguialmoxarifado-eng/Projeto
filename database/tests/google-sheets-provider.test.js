
'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const { createRuntime } = require('../../backend/runtime');

async function run() {
  const { diagnostics } = await createRuntime();
  const connection = await diagnostics.probeRead();
  assert.ok(connection.spreadsheet);
  console.log('Leitura operacional via Google Sheets API aprovada.');

  if (!process.argv.includes('--write')) return;

  const id = randomUUID();

  const record = {
    id,
    createdAt: new Date().toISOString(),
    origin: 'ALMOXA_PRO_V2',
    message: 'Teste real de conexão Google Sheets'
  };

  const written = await diagnostics.writeTestRecord(record);

  assert.equal(written.id, id);

  assert.deepEqual(await diagnostics.readTestRecord(id), record);
  assert.deepEqual(await diagnostics.writeTestRecord(record), written);
  assert.deepEqual(await diagnostics.readTestRecord(id), record);

  console.log('VALIDAÇÃO REAL GOOGLE SHEETS APROVADA.');
}

run().catch(error => {
  console.error('VALIDAÇÃO GOOGLE SHEETS FALHOU:', error.code || 'VALIDATION_FAILED', error.message);
  process.exitCode = 1;
});
