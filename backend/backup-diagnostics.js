'use strict';

const { existsSync } = require('node:fs');
const { SqliteDiagnosticsProvider } = require('../database/adapters/sqlite-diagnostics-provider');

async function main() {
  const source = process.env.ALMOXA_SQLITE_PATH;
  const destination = process.argv[2];
  if (!source || !existsSync(source) || !destination) {
    throw new Error('Informe ALMOXA_SQLITE_PATH e o caminho de um novo arquivo de backup.');
  }
  const storage = new SqliteDiagnosticsProvider(source);
  storage.connect({ readOnly: true });
  try {
    await storage.backupTo(destination);
    console.log('Backup SQLite concluído.');
  } finally {
    storage.disconnect();
  }
}

main().catch(() => {
  console.error('Backup SQLite não concluído. Verifique a origem e use um destino novo.');
  process.exitCode = 1;
});
