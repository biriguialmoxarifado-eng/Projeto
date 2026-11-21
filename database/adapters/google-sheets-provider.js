
'use strict';

/**
 * ALMOXA PRO V2
 * GOOGLE SHEETS PROVIDER
 *
 * Ponte entre o backend V2 e o Google Apps Script.
 * O Apps Script executa as operações no Google Sheets.
 */

class GoogleSheetsProviderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GoogleSheetsProviderError';
    this.code = code;
  }
}

class GoogleSheetsProvider {
  constructor(config = {}) {
    this.url = config.url || process.env.GOOGLE_APPS_SCRIPT_URL;
    this.token = config.token || process.env.GOOGLE_APPS_SCRIPT_TOKEN;
    this.connected = false;
  }

  async request(action, payload = {}) {
    if (!this.url) {
      throw new GoogleSheetsProviderError(
        'GOOGLE_URL_MISSING',
        'URL do Google Apps Script não configurada.'
      );
    }

    if (!this.token) {
      throw new GoogleSheetsProviderError(
        'GOOGLE_TOKEN_MISSING',
        'Token de integração não configurado.'
      );
    }

    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        token: this.token,
        action,
        payload
      }),
      redirect: 'follow'
    });

    if (!response.ok) {
      throw new GoogleSheetsProviderError(
        'GOOGLE_HTTP_ERROR',
        `Falha HTTP na integração: ${response.status}`
      );
    }

    const result = await response.json();

    if (!result || result.success !== true) {
      throw new GoogleSheetsProviderError(
        result?.error?.code || 'GOOGLE_OPERATION_FAILED',
        result?.error?.message || 'Falha na operação Google.'
      );
    }

    return result.data;
  }

  async connect() {
    await this.request('healthCheck');
    this.connected = true;
    return { connected: true, provider: 'google-sheets' };
  }

  async disconnect() {
    this.connected = false;
    return { connected: false };
  }

  async healthCheck() {
    return this.request('healthCheck');
  }

  async findById(table, id) {
    return this.request('findById', { table, id });
  }

  async findMany(table, filters = {}, options = {}) {
    return this.request('findMany', {
      table,
      filters,
      options
    });
  }

  async insert(table, data, options = {}) {
    return this.request('insert', {
      table,
      data,
      options
    });
  }

  async insertMany(table, records, options = {}) {
    return this.request('insertMany', {
      table,
      records,
      options
    });
  }

  async update(table, id, data, options = {}) {
    return this.request('update', {
      table,
      id,
      data,
      options
    });
  }

  async delete(table, id, options = {}) {
    return this.request('delete', {
      table,
      id,
      options
    });
  }

  async transaction() {
    throw new GoogleSheetsProviderError(
      'TRANSACTION_NOT_SUPPORTED',
      'Transações atômicas não estão disponíveis nesta integração.'
    );
  }
}

module.exports = {
  GoogleSheetsProvider,
  GoogleSheetsProviderError
};
