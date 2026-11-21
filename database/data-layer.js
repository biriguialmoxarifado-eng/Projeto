
'use strict';

/**
 * ALMOXA PRO V2
 * DATA LAYER — Camada central de dados
 *
 * Responsabilidades:
 * - Centralizar operações de dados.
 * - Validar entradas.
 * - Padronizar resultados e erros.
 * - Controlar transações através do adaptador.
 * - Evitar dependência de um banco específico.
 *
 * Não contém regras de negócio dos motores.
 */

const DATA_LAYER_VERSION = '2.0.0';

class DataLayerError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'DataLayerError';
    this.code = code;
    this.details = details;
  }
}

class DataLayer {
  constructor(adapter) {
    if (!adapter || typeof adapter !== 'object') {
      throw new DataLayerError(
        'ADAPTER_REQUIRED',
        'Um adaptador de banco de dados é obrigatório.'
      );
    }

    this.adapter = adapter;
    this.connected = false;
  }

  async connect() {
    if (typeof this.adapter.connect !== 'function') {
      throw new DataLayerError(
        'CONNECT_NOT_IMPLEMENTED',
        'O adaptador não implementa connect().'
      );
    }

    await this.adapter.connect();
    this.connected = true;

    return this.success({
      version: DATA_LAYER_VERSION,
      connected: true
    });
  }

  async disconnect() {
    if (typeof this.adapter.disconnect === 'function') {
      await this.adapter.disconnect();
    }

    this.connected = false;
    return this.success({ connected: false });
  }

  async healthCheck() {
    try {
      if (typeof this.adapter.healthCheck !== 'function') {
        throw new DataLayerError(
          'HEALTHCHECK_NOT_IMPLEMENTED',
          'O adaptador não implementa healthCheck().'
        );
      }

      const result = await this.adapter.healthCheck();

      return this.success({
        version: DATA_LAYER_VERSION,
        database: result
      });
    } catch (error) {
      return this.failure(error);
    }
  }

  async findById(table, id) {
    this.validateTable(table);
    this.validateId(id);

    return this.execute('findById', () =>
      this.adapter.findById(table, id)
    );
  }

  async findMany(table, filters = {}, options = {}) {
    this.validateTable(table);

    if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
      throw new DataLayerError(
        'INVALID_FILTERS',
        'Os filtros devem ser um objeto.'
      );
    }

    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(
      200,
      Math.max(1, Number(options.limit) || 50)
    );

    return this.execute('findMany', () =>
      this.adapter.findMany(table, filters, {
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
      this.adapter.insert(table, data, options)
    );
  }

  async update(table, id, data, options = {}) {
    this.validateTable(table);
    this.validateId(id);
    this.validateData(data);

    return this.execute('update', () =>
      this.adapter.update(table, id, data, options)
    );
  }

  async delete(table, id, options = {}) {
    this.validateTable(table);
    this.validateId(id);

    return this.execute('delete', () =>
      this.adapter.delete(table, id, options)
    );
  }

  async transaction(callback) {
    if (typeof callback !== 'function') {
      throw new DataLayerError(
        'INVALID_TRANSACTION',
        'A transação precisa receber uma função.'
      );
    }

    if (typeof this.adapter.transaction !== 'function') {
      throw new DataLayerError(
        'TRANSACTION_NOT_IMPLEMENTED',
        'O adaptador ainda não implementa transações.'
      );
    }

    try {
      const result = await this.adapter.transaction(callback);
      return this.success(result);
    } catch (error) {
      return this.failure(error);
    }
  }

  async execute(operation, callback) {
    try {
      const result = await callback();

      return this.success({
        operation,
        data: result
      });
    } catch (error) {
      return this.failure(error);
    }
  }

  validateTable(table) {
    if (
      typeof table !== 'string' ||
      !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(table)
    ) {
      throw new DataLayerError(
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
      throw new DataLayerError(
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
      throw new DataLayerError(
        'INVALID_DATA',
        'Os dados devem ser um objeto.'
      );
    }
  }

  success(data) {
    return {
      success: true,
      data,
      version: DATA_LAYER_VERSION
    };
  }

  failure(error) {
    return {
      success: false,
      error: {
        code: error.code || 'DATA_LAYER_ERROR',
        message: error.message || 'Erro na camada de dados.',
        details: error.details || null
      },
      version: DATA_LAYER_VERSION
    };
  }
}

module.exports = {
  DataLayer,
  DataLayerError,
  DATA_LAYER_VERSION
};
