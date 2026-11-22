'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { GoogleSheetsProvider } = require('../adapters/google-sheets-provider');
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

async function validateSheets(testSpreadsheetId, write) {
  const diagnostics = new GoogleSheetsProvider({ testSpreadsheetId, testOnly: true });
  const start = performance.now();
  await diagnostics.testRows();
  console.log('Metadados e cabeçalhos de ALMOXA_TESTE_CORE validados em ' +
    Math.round(performance.now() - start) + ' ms.');

  if (!write) return;

  const id = randomUUID();
  const record = {
    id,
    createdAt: new Date().toISOString(),
    origin: 'ALMOXA_PRO_V2',
    message: 'Teste pendente ' + id
  };
  const written = await diagnostics.writeTestRecord(record);
  assert.equal(written.id, record.id);
  assert.deepEqual(await diagnostics.readTestRecord(record.id), record);
  assert.deepEqual(await diagnostics.writeTestRecord(record), written);
  assert.deepEqual(await diagnostics.readTestRecord(record.id), record);
  const expected = { ...record, message: 'Teste confirmado ' + id };
  assert.deepEqual(await diagnostics.confirmTestRecord(id), expected);
  assert.deepEqual(await diagnostics.confirmTestRecord(id), expected);
  const verification = spawnSync(process.execPath, [__filename, '--verify', id], { stdio: 'inherit', timeout: 60000 });
  assert.equal(verification.status, 0);
  console.log('Gravação, atualização, persistência em novo processo e retentativas aprovadas.');
}

async function verifyPersistence(testSpreadsheetId, id) {
  const diagnostics = new GoogleSheetsProvider({ testSpreadsheetId, testOnly: true });
  const persisted = await diagnostics.readTestRecord(id);
  assert.equal(persisted.id, id);
  assert.equal(persisted.origin, 'ALMOXA_PRO_V2');
  assert.equal(persisted.message, 'Teste confirmado ' + id);
  assert.ok(Number.isFinite(Date.parse(persisted.createdAt)));
}

async function run() {
  const driveOnly = args.length === 1 && args[0] === '--drive';
  const write = args.length === 1 && args[0] === '--write';
  const verify = args.length === 2 && args[0] === '--verify' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(args[1]);
  if (args.length && !write && !driveOnly && !verify) {
    console.error('Use npm run test:google com --drive ou --write, separadamente.');
    process.exitCode = 1;
    return;
  }

  if (driveOnly) {
    const fileId = requireSetting('ALMOXA_TEST_DRIVE_FILE_ID');
    if (fileId) await validateDrive(fileId);
    return;
  }

  const testId = requireSetting('ALMOXA_TEST_SHEET_ID');
  if (!testId) return;

  if (verify) {
    await verifyPersistence(testId, args[1]);
    return;
  }
  await validateSheets(testId, write);
  if (process.env.ALMOXA_TEST_DRIVE_FILE_ID) await validateDrive(process.env.ALMOXA_TEST_DRIVE_FILE_ID);
}

run().catch(error => {
  const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,60}$/.test(error.code)
    ? error.code
    : 'VALIDATION_FAILED';
  console.error('Validação do Google falhou (' + code + ').');
  process.exitCode = 1;
});
