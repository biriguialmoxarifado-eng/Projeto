
'use strict';

const assert = require('node:assert/strict');

const {
  DatabaseAdapter,
  DatabaseAdapterError
} = require('../database/adapters/database-adapter');

const {
  DataLayer,
  DATA_LAYER_VERSION
} = require('../database/data-layer');

async function run() {
  const state = {
    rows: [
      { id: '1', nome: 'Capacete', quantidade: 10 }
    ],
    connected: false
  };

  // Provider simulado para testar a camada sem banco real.
  const provider = {
    async connect() {
      state.connected = true;
      return { driver: 'fake' };
    },

    async disconnect() {
      state.connected = false;
    },

    async healthCheck() {
      return { status: 'ok' };
    },

    async findById(table, id) {
      return state.rows.find(row => row.id === id) || null;
    },

    async findMany(table, filters, options) {
      return {
        items: state.rows,
        page: options.page,
        limit: options.limit
      };
    },

    async insert(table, data) {
      const row = {
        id: String(state.rows.length + 1),
        ...data
      };

      state.rows.push(row);
      return row;
    },

    async insertMany(table, records) {
      const inserted = records.map((data, index) => ({
        id: `batch-${index + 1}`,
        ...data
      }));

      state.rows.push(...inserted);
      return inserted;
    },

    async update(table, id, data) {
      const row = state.rows.find(item => item.id === id);

      if (!row) return null;

      Object.assign(row, data);
      return row;
    },

    async delete(table, id) {
      const before = state.rows.length;

      state.rows = state.rows.filter(
        row => row.id !== id
      );

      return before !== state.rows.length;
    },

    async transaction(callback) {
      return callback({ transactional: true });
    }
  };

  const adapter = new DatabaseAdapter(provider);
  const layer = new DataLayer(adapter);

  // 1. Versão
  assert.equal(DATA_LAYER_VERSION, '2.1.0');

  // 2. Conexão
  const connection = await layer.connect();

  assert.equal(connection.success, true);
  assert.equal(layer.connected, true);
  assert.equal(adapter.connected, true);

  // 3. Consulta por ID
  const found = await layer.findById(
    'materiais',
    '1'
  );

  assert.equal(found.success, true);
  assert.equal(found.data.data.nome, 'Capacete');

  // 4. Consulta paginada
  const page = await layer.findMany(
    'materiais',
    {},
    { page: 2, limit: 500 }
  );

  assert.equal(page.success, true);
  assert.equal(page.data.data.page, 2);
  assert.equal(page.data.data.limit, 200);

  // 5. Inserção
  const inserted = await layer.insert(
    'materiais',
    { nome: 'Luva', quantidade: 50 }
  );

  assert.equal(inserted.success, true);
  assert.equal(inserted.data.data.nome, 'Luva');

  // 6. Inserção em lote
  const batch = await layer.insertMany(
    'materiais',
    [
      { nome: 'Óculos', quantidade: 20 },
      { nome: 'Protetor auricular', quantidade: 30 }
    ]
  );

  assert.equal(batch.success, true);
  assert.equal(batch.data.data.length, 2);

  // 7. Atualização
  const updated = await layer.update(
    'materiais',
    '1',
    { quantidade: 15 }
  );

  assert.equal(updated.success, true);
  assert.equal(updated.data.data.quantidade, 15);

  // 8. Exclusão
  const deleted = await layer.delete(
    'materiais',
    '2'
  );

  assert.equal(deleted.success, true);
  assert.equal(deleted.data.data, true);

  // 9. Transação
  const transaction = await layer.transaction(
    async tx => ({
      active: tx.transactional
    })
  );

  assert.equal(transaction.success, true);
  assert.equal(transaction.data.data.active, true);

  // 10. Health check
  const health = await layer.healthCheck();

  assert.equal(health.success, true);
  assert.equal(health.data.data.status, 'ok');

  // 11. Teste de falhas do provedor
  const failingAdapter = new DatabaseAdapter({
    async connect() {
      throw Object.assign(
        new Error('Conexão recusada'),
        { code: 'CONNECTION_REFUSED' }
      );
    },

    async findById() {
      throw Object.assign(
        new Error('Falha na consulta'),
        { code: 'QUERY_FAILED' }
      );
    },

    async insert() {
      return {
        success: false,
        error: { message: 'Gravação recusada' }
      };
    }
  });

  const failingLayer = new DataLayer(failingAdapter);

  const failedConnection = await failingLayer.connect();

  assert.equal(failedConnection.success, false);
  assert.equal(failingLayer.connected, false);
  assert.equal(
    failedConnection.error.code,
    'CONNECTION_REFUSED'
  );

  const failedRead = await failingLayer.findById(
    'materiais',
    '1'
  );

  assert.equal(failedRead.success, false);
  assert.equal(failedRead.error.code, 'QUERY_FAILED');

  const failedInsert = await failingLayer.insert(
    'materiais',
    { nome: 'Teste' }
  );

  assert.equal(failedInsert.success, false);
  assert.equal(
    failedInsert.error.code,
    'PROVIDER_OPERATION_FAILED'
  );

  // 12. Validações
  const missingMethod = new DatabaseAdapter({});

  await assert.rejects(
    () => missingMethod.findById('materiais', '1'),
    DatabaseAdapterError
  );

  const invalidTable = await layer.findById(
    'materiais;DROP',
    '1'
  );

  assert.equal(invalidTable.success, false);

  const invalidId = await layer.findById(
    'materiais',
    ''
  );

  assert.equal(invalidId.success, false);

  // 13. Desconexão
  const disconnected = await layer.disconnect();

  assert.equal(disconnected.success, true);
  assert.equal(layer.connected, false);
  assert.equal(adapter.connected, false);

  console.log(
    'ALMOXA PRO V2 — DATABASE ENGINE: TODOS OS TESTES PASSARAM.'
  );
}

run().catch(error => {
  console.error('FALHA NOS TESTES DO DATABASE ENGINE:', error);
  process.exitCode = 1;
});
