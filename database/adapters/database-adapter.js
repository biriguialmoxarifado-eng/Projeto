
'use strict';

/**
 * ALMOXA PRO V2 — DATABASE ADAPTER
 * Contrato entre a Data Layer e o provedor concreto de banco.
 * Retorna dados crus e propaga falhas. A Data Layer padroniza as respostas.
 */

class DatabaseAdapterError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'DatabaseAdapterError';
    this.code = code;
    this.details = details;
  }
}

class DatabaseAdapter {
  constructor(provider) {
    if (!provider || typeof provider !== 'object') {
      throw new DatabaseAdapterError('PROVIDER_REQUIRED', 'O provedor de banco de dados é obrigatório.');
    }
    this.provider = provider;
    this.connected = false;
  }

  async call(method, ...args) {
    if (typeof this.provider[method] !== 'function') {
      throw new DatabaseAdapterError(
        'PROVIDER_METHOD_NOT_IMPLEMENTED',
        `O provedor não implementa ${method}().`,
        { method }
      );
    }

    const result = await this.provider[method](...args);

    if (result && typeof result === 'object' && result.success === false) {
      const detail = result.error;
      const message =
        (detail && typeof detail === 'object' && detail.message) ||
        (typeof detail === 'string' ? detail : 'O provedor informou falha na operação.');
      throw new DatabaseAdapterError('PROVIDER_OPERATION_FAILED', message, detail || result);
    }

    return result;
  }

  async connect() {
    const result = await this.call('connect');
    this.connected = true;
    return result ?? { connected: true };
  }

  async disconnect() {
    if (typeof this.provider.disconnect === 'function') {
      const result = await this.call('disconnect');
      this.connected = false;
      return result ?? { connected: false };
    }
    this.connected = false;
    return { connected: false };
  }

  async healthCheck() {
    return this.call('healthCheck');
  }

  async findById(table, id) {
    this.validateTable(table);
    this.validateId(id);
    return this.call('findById', table, id);
  }

  async findMany(table, filters = {}, options = {}) {
    this.validateTable(table);
    if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
      throw new DatabaseAdapterError('INVALID_FILTERS', 'Filtros inválidos.');
    }
    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(options.limit) || 50));
    return this.call('findMany', table, filters, { ...options, page, limit });
  }

  async insert(table, data, options = {}) {
    this.validateTable(table);
    this.validateData(data);
    return this.call('insert', table, data, options);
  }

  async insertMany(table, records, options = {}) {
    this.validateTable(table);
    if (!Array.isArray(records) || records.length === 0) {
      throw new DatabaseAdapterError('INVALID_BATCH', 'O lote precisa conter registros.');
    }
    records.forEach(record => this.validateData(record));
    return this.call('insertMany', table, records, options);
  }

  async update(table, id, data, options = {}) {
    this.validateTable(table);
    this.validateId(id);
    this.validateData(data);
    return this.call('update', table, id, data, options);
  }

  async delete(table, id, options = {}) {
    this.validateTable(table);
    this.validateId(id);
    return this.call('delete', table, id, options);
  }

  async transaction(callback) {
    if (typeof callback !== 'function') {
      throw new DatabaseAdapterError('INVALID_TRANSACTION', 'Callback da transação inválido.');
    }
    return this.call('transaction', callback);
  }

  validateTable(table) {
    if (typeof table !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(table)) {
      throw new DatabaseAdapterError('INVALID_TABLE', 'Nome de tabela inválido.');
    }
  }

  validateId(id) {
    if (id === null || id === undefined || String(id).trim() === '') {
      throw new DatabaseAdapterError('INVALID_ID', 'Identificador obrigatório.');
    }
  }

  validateData(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new DatabaseAdapterError('INVALID_DATA', 'Os dados devem ser um objeto.');
    }
  }
}

module.exports = { DatabaseAdapter, DatabaseAdapterError };
