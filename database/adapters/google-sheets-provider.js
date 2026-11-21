
'use strict';

class GoogleSheetsProviderError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'GoogleSheetsProviderError';
    this.code = code;
    this.details = details;
  }
}

class GoogleSheetsProvider {
  constructor(options = {}) {
    this.url = options.url || process.env.AL
MOXA_API_URL || '';
    this.key = options.key || process.env.ALMOXA_API_KEY || '';
    this.session = options.session || process.env.ALMOXA_SESSION || '';
    this.connected = false;
  }

  validateConfig() {
    if (!this.url) {
      throw new GoogleSheetsProviderError(
        'API_URL_REQUIRED',
        'Configure ALMOXA_API_URL.'
      );
    }

    if (!this.key) {
      throw new GoogleSheetsProviderError(
        'API_KEY_REQUIRED',
        'Configure ALMOXA_API_KEY.'
      );
    }

    if (!this.session) {
      throw new GoogleSheetsProviderError(
        'SESSION_REQUIRED',
        'Configure uma sessão autenticada em ALMOXA_SESSION.'
      );
    }
  }

  async request(action, payload = {}) {
    this.validateConfig();

    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ponte: 'ALMOXA',
        chave: this.key,
        modulo: 'database',
        acao: action,
        payload,
        sessao: this.session,
        origem: 'ALMOXA_PRO_V2'
      })
    });

    if (!response.ok) {
      throw new GoogleSheetsProviderError(
        'HTTP_ERROR',
        `API respondeu HTTP ${response.status}.`
      );
    }

    let result;

    try {
      result = await response.json();
    } catch {
      throw new GoogleSheetsProviderError(
        'INVALID_RESPONSE',
        'A API não retornou JSON válido.'
      );
    }

    if (!result || result.ok !== true) {
      throw new GoogleSheetsProviderError(
        result?.codigo || 'API_OPERATION_FAILED',
        result?.mensagem || 'A API recusou a operação.',
        result
      );
    }

    return result.dados;
  }

  async connect() {
    const data = await this.request('diagnostico');
    this.connected = true;

    return {
      connected: true,
      spreadsheet: data.spreadsheet,
      provider: 'google-sheets'
    };
  }

  async healthCheck() {
    const data = await this.request('diagnostico');

    return {
      status: 'ok',
      provider: 'google-sheets',
      spreadsheet: data.spreadsheet,
      sheets: data.sheets
    };
  }

  async writeTestRecord(record) {
    return this.request('teste.gravar', { record });
  }

  async readTestRecord(id) {
    return this.request('teste.ler', { id });
  }

  async disconnect() {
    this.connected = false;
    return { connected: false };
  }
}

module.exports = {
  GoogleSheetsProvider,
  GoogleSheetsProviderError
};
