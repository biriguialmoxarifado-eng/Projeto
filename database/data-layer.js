
'use strict';

/**
 * ALMOXA PRO V2
 * DATA LAYER 2.1
 *
 * Camada central de acesso aos dados.
 * Responsável por:
 * - Leitura e gravação
 * - Atualização e exclusão
 * - Consultas paginadas
 * - Operações em lote
 * - Transações
 * - Padronização de respostas
 * - Tratamento de falhas
 *
 * Não contém regras de negócio dos motores.
 */

const DATA_LAYER_VERSION = '2.1.0';

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
    try {
      if (typeof this.adapter.connect !== 'function') {
        throw new DataLayerError(
          'CONNECT_NOT_IMPLEMENTED',
          'O adaptador não implementa connect().'
        );
      }

      const result = await this.adapter.connect();
      this.connected = true;

      return this.success({
        connected: true,
        result
      });

    } catch (error) {
      this.connected = false;
      return this.failure(error, 'connect');
    }
  }

  async disconnect() {
    try {
      if (typeof this.adapter.disconnect === 'function') {
        await this.adapter.disconnect();
      }

      this.connected = false;

      return this.success({
        connected: false
      });

    } catch (error) {
      return this.failure(error, 'disconnect');
    }
  }

  async healthCheck() {
    if (typeof this.adapter.healthCheck !== 'function') {
      return this.failure(
        new DataLayerError(
          'HEALTHCHECK_NOT_IMPLEMENTED',
          'O adaptador não implementa healthCheck().'
        ),
        'healthCheck'
      );
    }

    return this.execute(
      'healthCheck',
      () => this.adapter.healthCheck()
    );
  }

  async findById(table, id) {
    try {
      this.validateTable(table);
      this.validateId(id);

      return await this.execute(
        'findById',
        () => this.adapter.findById(table, id)
      );

    } catch (error) {
      return this.failure(error, 'findById');
    }
  }

  async findMany(table, filters = {}, options = {}) {
    try {
      this.validateTable(table);

      if (
        !filters ||
        typeof filters !== 'object' ||
        Array.isArray(filters)
      ) {
        throw new DataLayerError(
          'INVALID_FILTERS',
          'Os filtros devem ser um objeto.'
        );
      }

      const page = Math.max(
        1,
        Number(options.page) || 1
      );

      const limit = Math.min(
        200,
        Math.max(1, Number(options.limit) || 50)
      );

      return await this.execute(
        'findMany',
        () => this.adapter.findMany(
          table,
          filters,
          { ...options, page, limit }
        )
      );

    } catch (error) {
      return this.failure(error, 'findMany');
    }
  }

  async insert(table, data, options = {}) {
    try {
      this.validateTable(table);
      this.validateData(data);

      return await this.execute(
        'insert',
        () => this.adapter.insert(table, data, options)
      );

    } catch (error) {
      return this.failure(error, 'insert');
    }
  }

  async insertMany(table, records, options = {}) {
    try {
      this.validateTable(table);

      if (
        !Array.isArray(records) ||
        records.length === 0
      ) {
        throw new DataLayerError(
          'INVALID_BATCH',
          'O lote precisa conter registros.'
        );
      }

      records.forEach(record => this.validateData(record));

      if (typeof this.adapter.insertMany !== 'function') {
        throw new DataLayerError(
          'BATCH_NOT_SUPPORTED',
          'O adaptador não implementa insertMany().'
        );
      }

      return await this.execute(
        'insertMany',
        () => this.adapter.insertMany(
          table,
          records,
          options
        )
      );

    } catch (error) {
      return this.failure(error, 'insertMany');
    }
  }

  async update(table, id, data, options = {}) {
    try {
      this.validateTable(table);
      this.validateId(id);
      this.validateData(data);

      return await this.execute(
        'update',
        () => this.adapter.update(
          table,
          id,
          data,
          options
        )
      );

    } catch (error) {
      return this.failure(error, 'update');
    }
  }

  async delete(table, id, options = {}) {
    try {
      this.validateTable(table);
      this.validateId(id);

      return await this.execute(
        'delete',
        () => this.adapter.delete(
          table,
          id,
          options
        )
      );

    } catch (error) {
      return this.failure(error, 'delete');
    }
  }

  async transaction(callback) {
    if (typeof callback !== 'function') {
      return this.failure(
        new DataLayerError(
          'INVALID_TRANSACTION',
          'A transação precisa receber uma função.'
        ),
        'transaction'
      );
    }

    if (typeof this.adapter.transaction !== 'function') {
      return this.failure(
        new DataLayerError(
          'TRANSACTION_NOT_IMPLEMENTED',
          'O adaptador ainda não implementa transações.'
        ),
        'transaction'
      );
    }

    return this.execute(
      'transaction',
      () => this.adapter.transaction(callback)
    );
  }

  async execute(operation, callback) {
    try {
      const data = await callback();

      return this.success({
        operation,
        data
      });

    } catch (error) {
      return this.failure(error, operation);
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

  failure(error, operation = null) {
    return {
      success: false,
      operation,
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
