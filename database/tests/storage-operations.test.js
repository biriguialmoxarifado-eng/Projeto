'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { StorageOperations } = require('../storage-operations');

test('reutiliza leituras, protege cópias e invalida após gravar ou perder a resposta', async () => {
  const operations = new StorageOperations({ ttlMs: 60000 });
  let reads = 0;
  let value = 1;
  const read = () => operations.read('item', async () => ({ value, reads: ++reads }));
  (await read()).value = 99;
  assert.deepEqual(await read(), { value: 1, reads: 1 });
  const update = operations.mutate(async () => { value = 2; });
  const afterUpdate = read();
  await update;
  assert.deepEqual(await afterUpdate, { value: 2, reads: 2 });
  await assert.rejects(operations.mutate(async () => {
    value = 3;
    throw new Error('resposta perdida');
  }), /resposta perdida/);
  assert.deepEqual(await read(), { value: 3, reads: 3 });
});

test('limita a fila e volta a aceitar operações depois de drenar', async () => {
  const operations = new StorageOperations({ maxPending: 1 });
  let release;
  const pending = operations.mutate(() => new Promise(resolve => { release = resolve; }));
  await assert.rejects(operations.read('item', () => 1), { code: 'STORAGE_QUEUE_FULL' });
  release();
  await pending;
  assert.equal(await operations.read('item', () => 2), 2);
});
