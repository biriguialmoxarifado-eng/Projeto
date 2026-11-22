'use strict';

class StorageOperations {
  constructor({ ttlMs = 1000, maxEntries = 128, maxPending = 64 } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.maxPending = maxPending;
    this.cache = new Map();
    this.tail = Promise.resolve();
    this.pending = 0;
  }

  read(key, load) {
    return this.enqueue(async () => {
      const cached = this.cache.get(key);
      if (cached && cached.expires > performance.now()) return structuredClone(cached.value);
      this.cache.delete(key);
      const value = await load();
      if (value !== null && value !== undefined) {
        if (this.cache.size >= this.maxEntries) this.cache.delete(this.cache.keys().next().value);
        this.cache.set(key, { value: structuredClone(value), expires: performance.now() + this.ttlMs });
      }
      return value;
    });
  }

  mutate(work) {
    return this.enqueue(async () => {
      try {
        return await work();
      } finally {
        // Uma resposta perdida pode ocultar uma gravação que já persistiu.
        this.cache.clear();
      }
    });
  }

  enqueue(work) {
    if (this.pending >= this.maxPending) {
      return Promise.reject(Object.assign(new Error('Fila de armazenamento cheia.'), { code: 'STORAGE_QUEUE_FULL' }));
    }
    this.pending++;
    const result = this.tail.then(work).finally(() => { this.pending--; });
    this.tail = result.catch(() => {});
    return result;
  }
}

module.exports = { StorageOperations };
