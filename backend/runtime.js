'use strict';

const { AlmoxaCore } = require('../core');
const { StorageOperations } = require('../database/storage-operations');
const { DataLayer } = require('../database/data-layer');
const { DatabaseAdapter } = require('../database/adapters/database-adapter');
const { GoogleSheetsProvider } = require('../database/adapters/google-sheets-provider');
const { AuthorizationManager } = require('../core/security/authorization-manager');
const { createHash, timingSafeEqual } = require('node:crypto');

function diagnosticSecurity(credential, invoices) {
  const authorizationProvider = new AuthorizationManager();
  const invoiceRead = invoices ? ['nf:read', 'receiving:read', 'stock:read', 'catalog:read', 'purchases:read', 'requests:read', 'config:read', 'obras:read', 'inventory:read'] : [];
  const invoiceWrite = invoices ? ['nf:write', 'receiving:write', 'stock:write', 'catalog:write', 'purchases:write', 'requests:write', 'config:write', 'obras:write', 'usuarios:read', 'inventory:write'] : [];
  authorizationProvider.registerRole('reader', ['diagnostics:read', ...invoiceRead]);
  authorizationProvider.registerRole('operator', ['diagnostics:read', 'diagnostics:write', ...invoiceRead, ...invoiceWrite]);
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

async function createRuntime(storage = new GoogleSheetsProvider(), { sqlite = false, credential, invoiceTestStorage } = {}) {
  const operations = sqlite ? new StorageOperations() : undefined;
  const database = new DataLayer(new DatabaseAdapter(storage, { operations }));
  const core = new AlmoxaCore(sqlite || invoiceTestStorage ? diagnosticSecurity(credential, Boolean(invoiceTestStorage)) : {});
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
  const coordinate = invoiceTestStorage
    ? require('../database/local-writer-lock').createLocalWriterLock(invoiceTestStorage.testSpreadsheetId)
    : undefined;
  let invoiceEngine;
  let receivingEngine;
  let invoiceReadAdapter;
  let stockEngine;
  let catalogEngine;
  let purchaseEngine;
  let requestEngine;
  let administrationEngine;
  let inventoryEngine;
  let shopEngine;
  return {
    core, diagnostics: storage, database,
    getInvoiceEngine() {
      if (!invoiceTestStorage) throw Object.assign(new Error('Motor de teste desativado.'), { code: 'NF_TESTE_DESATIVADO' });
      const { createInvoiceEngine, TestInvoiceStore } = require('../core/motors/invoices');
      invoiceEngine ??= createInvoiceEngine({ core, coordinate, storage: new TestInvoiceStore(invoiceTestStorage) });
      return invoiceEngine;
    },
    getInvoiceReadAdapter() {
      const engine = this.getInvoiceEngine();
      const { createInvoiceReadAdapter } = require('../core/motors/invoice-read-adapter');
      invoiceReadAdapter ??= createInvoiceReadAdapter(engine);
      return invoiceReadAdapter;
    },
    getCatalogEngine() {
      if (!invoiceTestStorage) throw Object.assign(new Error('Motor de teste desativado.'), { code: 'CATALOGO_TESTE_DESATIVADO' });
      const { TestInvoiceStore } = require('../core/motors/invoices');
      const { createCatalogEngine } = require('../core/motors/catalog');
      catalogEngine ??= createCatalogEngine({
        core, coordinate, stores: {
          itens: new TestInvoiceStore(invoiceTestStorage, 'itens'),
          fornecedores: new TestInvoiceStore(invoiceTestStorage, 'fornecedores'),
          categorias: new TestInvoiceStore(invoiceTestStorage, 'categorias')
        }
      });
      return catalogEngine;
    },
    getPurchaseEngine() {
      const catalog = this.getCatalogEngine();
      const { TestInvoiceStore } = require('../core/motors/invoices');
      const { createPurchaseEngine } = require('../core/motors/purchases');
      purchaseEngine ??= createPurchaseEngine({
        core, catalog, coordinate, store: new TestInvoiceStore(invoiceTestStorage, 'compras')
      });
      return purchaseEngine;
    },
    getShopEngine() {
      const catalog = this.getCatalogEngine();
      const stock = this.getStockEngine();
      const { createShopEngine } = require('../core/motors/shop');
      shopEngine ??= createShopEngine({ core, catalog, stock });
      return shopEngine;
    },
    getInventoryEngine() {
      const stock = this.getStockEngine();
      const { TestInvoiceStore } = require('../core/motors/invoices');
      const { createInventoryEngine } = require('../core/motors/inventory');
      inventoryEngine ??= createInventoryEngine({
        core, stock, coordinate, store: new TestInvoiceStore(invoiceTestStorage, 'inventario')
      });
      return inventoryEngine;
    },
    getAdministrationEngine() {
      if (!invoiceTestStorage) throw Object.assign(new Error('Motores de teste desativados.'), { code: 'ADMIN_TESTE_DESATIVADO' });
      const { TestInvoiceStore } = require('../core/motors/invoices');
      const { createAdministrationEngine } = require('../core/motors/administration');
      administrationEngine ??= createAdministrationEngine({
        core, coordinate, stores: {
          config: new TestInvoiceStore(invoiceTestStorage, 'config'),
          obras: new TestInvoiceStore(invoiceTestStorage, 'obras'),
          usuarios: new TestInvoiceStore(invoiceTestStorage, 'usuarios')
        }
      });
      return administrationEngine;
    },
    getRequestEngine() {
      const stock = this.getStockEngine();
      const { TestInvoiceStore } = require('../core/motors/invoices');
      const { createRequestEngine } = require('../core/motors/requests');
      requestEngine ??= createRequestEngine({
        core, stock, coordinate, store: new TestInvoiceStore(invoiceTestStorage, 'solicitacoes')
      });
      return requestEngine;
    },
    getStockEngine() {
      if (!invoiceTestStorage) throw Object.assign(new Error('Motor de teste desativado.'), { code: 'ESTOQUE_TESTE_DESATIVADO' });
      const { TestInvoiceStore } = require('../core/motors/invoices');
      const { createStockEngine } = require('../core/motors/stock');
      stockEngine ??= createStockEngine({
        core, coordinate, store: new TestInvoiceStore(invoiceTestStorage, 'stock'),
        receipts: new TestInvoiceStore(invoiceTestStorage, 'receiving')
      });
      return stockEngine;
    },
    getReceivingEngine() {
      const invoices = this.getInvoiceEngine();
      const { TestInvoiceStore } = require('../core/motors/invoices');
      const { createReceivingEngine } = require('../core/motors/receiving');
      receivingEngine ??= createReceivingEngine({
        core, invoices, coordinate, store: new TestInvoiceStore(invoiceTestStorage, 'receiving')
      });
      return receivingEngine;
    }
  };
}

module.exports = { createRuntime };
