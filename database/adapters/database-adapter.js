
'use strict';

/**
 * ALMOXA PRO V2
 * DATABASE ADAPTER
 *
 * Contrato padrão de comunicação com o banco.
 * Não contém regras de negócio.
 *
 * Preparado para futura implementação PostgreSQL.
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
      throw new DatabaseAdapterError(
        'PROVIDER_REQUIRED',
        'O provedor de banco de dados é obrigatório.'
      );
    }

    this.provider = provider;
    this.connected = false;
  }

  async connect() {
    return this.execute('connect', async () => {
      await this.provider.connect();
      this.connected = true;
      return { connected: true };
    });
  }

  async disconnect() {
    return this.execute('disconnect', async () => {
      if (typeof this.provider.disconnect === 'function') {
        await this.provider.disconnect();
      }

      this.connected = false;
      return { connected: false };
    });
  }

  async healthCheck() {
    return this.execute('healthCheck', async () => {
      const result = await this.provider.healthCheck();
      return {
        status: 'healthy',
        database: result
      };
    });
  }

  async findById(table, id) {
    this.validateTable(table);
    this.validateId(id);

    return this.execute('findById', () =>
      this.provider.findById(table, id)
    );
  }

  async findMany(table, filters = {}, options = {}) {
    this.validateTable(table);

    if (
      !filters ||
      typeof filters !== 'object' ||
      Array.isArray(filters)
    ) {
      throw new DatabaseAdapterError(
        'INVALID_FILTERS',
        'Filtros inválidos.'
      );
    }

    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(
      200,
      Math.max(1, Number(options.limit) || 50)
    );

    return this.execute('findMany', () =>
      this.provider.findMany(table, filters, {
        ...options,
        page,
        limit
      })
    );
  }

  async insert(table, data, options = {}) {
    this.validateTable(table);
    this.validateData(data);

    return this.execute('insert', () =>
      this.provider.insert(table, data, options)
    );
  }

  async insertMany(table, records, options = {}) {
    this.validateTable(table);

    if (!Array.isArray(records) || records.length === 0) {
      throw new DatabaseAdapterError(
        'INVALID_BATCH',
        'O lote precisa conter registros.'
      );
    }

    records.forEach(this.validateData);

    return this.execute('insertMany', () => {
      if (typeof this.provider.insertMany !== 'function') {
        throw new DatabaseAdapterError(
          'BATCH_NOT_SUPPORTED',
          'O provedor não implementa gravação em lote.'
        );
      }

      return this.provider.insertMany(table, records, options);
    });
  }

  async update(table, id, data, options = {}) {
    this.validateTable(table);
    this.validateId(id);
    this.validateData(data);

    return this.execute('update', () =>
      this.provider.update(table, id, data, options)
    );
  }

  async delete(table, id, options = {}) {
    this.validateTable(table);
    this.validateId(id);

    return this.execute('delete', () =>
      this.provider.delete(table, id, options)
    );
  }

  async transaction(callback) {
    if (typeof callback !== 'function') {
      throw new DatabaseAdapterError(
        'INVALID_TRANSACTION',
        'Callback da transação inválido.'
      );
    }

    if (typeof this.provider.transaction !== 'function') {
      throw new DatabaseAdapterError(
        'TRANSACTION_NOT_SUPPORTED',
        'O provedor não suporta transações.'
      );
    }

    return this.execute('transaction', () =>
      this.provider.transaction(callback)
    );
  }

  async execute(operation, callback) {
    try {
      const data = await callback();

      return {
        success: true,
        operation,
        data
      };
    } catch (error) {
      return {
        success: false,
        operation,
        error: {
          code: error.code || 'DATABASE_ERROR',
          message: error.message || 'Erro no banco de dados.'
        }
      };
    }
  }

  validateTable(table) {
    if (
      typeof table !== 'string' ||
      !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(table)
    ) {
      throw new DatabaseAdapterError(
        'INVALID_TABLE',
        'Nome de tabela inválido.'
      );
    }
  }

  validateId(id) {
    if (
      id === null ||
      id === undefined ||
      String(id).trim() === ''
    ) {
      throw new DatabaseAdapterError(
        'INVALID_ID',
        'Identificador obrigatório.'
      );
    }
  }

  validateData(data) {
    if (
      !data ||
      typeof data !== 'object' ||
      Array.isArray(data)
    ) {
      throw new DatabaseAdapterError(
        'INVALID_DATA',
        'Os dados devem ser um objeto.'
      );
    }
  }
}

module.exports = {
  DatabaseAdapter,
  DatabaseAdapterError
};
