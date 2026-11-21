'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createRuntime } = require('../../backend/runtime');
const { GoogleDriveProvider } = require('../adapters/google-drive-provider');

const args = process.argv.slice(2);

function requireSetting(name) {
  if (process.env[name]?.trim()) return process.env[name];
  console.error('Configure ' + name + ' no ambiente do backend de teste.');
  process.exitCode = 1;
  return null;
}

async function validateDrive(fileId) {
  const file = await new GoogleDriveProvider().readMetadata(fileId);
  assert.equal(file.trashed, false);
  console.log('Leitura de metadados do Google Drive aprovada.');
}

async function validateSheets(write) {
  const { diagnostics } = await createRuntime();
  const connection = await diagnostics.probeRead();
  assert.ok(connection.spreadsheet);
  console.log('Leitura operacional via Google Sheets API aprovada.');

  const sheet = process.env.ALMOXA_TEST_READ_SHEET;
  if (sheet) {
    const result = await diagnostics.readSheetPage(sheet);
    assert.ok(result.headers.length);
    console.log('Leitura paginada da aba aprovada.');
  }

  if (!write) return;

  const record = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    origin: 'ALMOXA_PRO_V2',
    message: 'Teste real de conexão Google Sheets'
  };
  const written = await diagnostics.writeTestRecord(record);
  assert.equal(written.id, record.id);
  assert.deepEqual(await diagnostics.readTestRecord(record.id), record);
  assert.deepEqual(await diagnostics.writeTestRecord(record), written);
  assert.deepEqual(await diagnostics.readTestRecord(record.id), record);
  console.log('Gravação, releitura e retentativa na planilha de teste aprovadas.');
}

async function run() {
  const driveOnly = args.length === 1 && args[0] === '--drive';
  const write = args.length === 1 && args[0] === '--write';
  if (args.length && !write && !driveOnly) {
    console.error('Use npm run test:google com --drive ou --write, separadamente.');
    process.exitCode = 1;
    return;
  }

  if (driveOnly) {
    const fileId = requireSetting('ALMOXA_TEST_DRIVE_FILE_ID');
    if (fileId) await validateDrive(fileId);
    return;
  }

  const productionId = requireSetting('ALMOXA_SPREADSHEET_ID');
  const testId = write ? requireSetting('ALMOXA_TEST_SPREADSHEET_ID') : null;
  if (write && productionId && testId && productionId === testId) {
    console.error('ALMOXA_TEST_SPREADSHEET_ID deve identificar uma planilha separada da operacional.');
    process.exitCode = 1;
    return;
  }
  if (process.exitCode) return;

  await validateSheets(write);
  if (process.env.ALMOXA_TEST_DRIVE_FILE_ID) await validateDrive(process.env.ALMOXA_TEST_DRIVE_FILE_ID);
}

run().catch(error => {
  const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,60}$/.test(error.code)
    ? error.code
    : 'VALIDATION_FAILED';
  console.error('Validação do Google falhou (' + code + ').');
  process.exitCode = 1;
});
