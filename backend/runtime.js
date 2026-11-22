'use strict';

const { AlmoxaCore } = require('../core');
const { StorageOperations } = require('../database/storage-operations');
const { DataLayer } = require('../database/data-layer');
const { DatabaseAdapter } = require('../database/adapters/database-adapter');
const { GoogleSheetsProvider } = require('../database/adapters/google-sheets-provider');
const { AuthorizationManager } = require('../core/security/authorization-manager');
const { createHash, timingSafeEqual } = require('node:crypto');

function diagnosticSecurity(credential) {
  const authorizationProvider = new AuthorizationManager();
  authorizationProvider.registerRole('reader', ['diagnostics:read']);
  authorizationProvider.registerRole('operator', ['diagnostics:read', 'diagnostics:write']);
  const digest = value => createHash('sha256').update(value).digest();
  const expected = credential ? digest(credential.token) : null;
  return {
    authorizationProvider,
    sessionProvider: {
      validate(token) {
        if (!expected || !token || !timingSafeEqual(expected, digest(token))) return { valid: false };
        return { valid: true, session: {
          userId: credential.actor, role: credential.role, status: 'ACTIVE'
        } };
      }
    },
    auditProvider: {
      record(entry) {
        if (!entry.allowed) console.warn('Acesso ao diagnóstico recusado.', entry.errorCode);
      }
    }
  };
}

async function createRuntime(storage = new GoogleSheetsProvider(), { sqlite = false, credential } = {}) {
  const operations = sqlite ? new StorageOperations() : undefined;
  const database = new DataLayer(new DatabaseAdapter(storage, { operations }));
  const core = new AlmoxaCore(sqlite ? diagnosticSecurity(credential) : {});
  core.registerModule({
    id: 'database',
    version: '2.1.0',
    async initialize() {
      if (!sqlite) return;
      if (!(await database.connect()).success) throw new Error('Falha ao abrir o banco SQLite.');
    }
  });
  core.registerModule({
    id: 'database-diagnostics',
    version: '1.0.0',
    dependencies: ['database'],
    async healthcheck() {
      return (await database.healthCheck()).success;
    }
  });
  await core.start();
  return { core, diagnostics: storage, database };
}

module.exports = { createRuntime };
