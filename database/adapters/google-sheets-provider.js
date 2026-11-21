'use strict';

const { createHash } = require('node:crypto');
const { GoogleAuth } = require('google-auth-library');

const TEST_SHEET = 'ALMOXA_TESTE_CONEXAO';
const HEADERS = ['ID', 'CRIADO_EM', 'ORIGEM', 'MENSAGEM'];
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

class GoogleSheetsProviderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GoogleSheetsProviderError';
    this.code = code;
  }
}

class GoogleSheetsProvider {
  constructor(options = {}) {
    this.spreadsheetId = options.spreadsheetId ?? process.env.ALMOXA_SPREADSHEET_ID;
    this.testSpreadsheetId = options.testSpreadsheetId ?? process.env.ALMOXA_TEST_SPREADSHEET_ID;
    this.readAuth = options.readAuth ?? new GoogleAuth({ scopes: [SCOPE + '.readonly'] });
    this.writeAuth = options.writeAuth ?? new GoogleAuth({ scopes: [SCOPE] });
    this.connected = false;
  }

  validateId(id, variable) {
    if (!/^[\w-]+$/.test(id ?? '')) {
      throw new GoogleSheetsProviderError('SPREADSHEET_ID_REQUIRED', `Configure ${variable} com o ID da planilha.`);
    }
  }

  async request(id, path, { auth = this.readAuth, data } = {}) {
    let client;
    try {
      client = await auth.getClient();
    } catch {
      throw new GoogleSheetsProviderError('GOOGLE_AUTH_FAILED', 'Configure Application Default Credentials no backend.');
    }
    try {
      const result = await client.request({
        url: `https://sheets.googleapis.com/v4/spreadsheets/${id}${path}`,
        method: data ? 'POST' : 'GET',
        data,
        timeout: 10000,
        retry: false
      });
      return result.data;
    } catch (error) {
      const status = error.response?.status;
      throw new GoogleSheetsProviderError(
        Number.isInteger(status) ? `GOOGLE_SHEETS_HTTP_${status}` : 'GOOGLE_SHEETS_UNAVAILABLE',
        Number.isInteger(status) ? `Google Sheets respondeu HTTP ${status}.` : 'Falha na comunicação com Google Sheets.'
      );
    }
  }

  async metadata(id) {
    const fields = encodeURIComponent('spreadsheetId,properties(title),sheets(properties(sheetId,title))');
    return this.request(id, `?fields=${fields}`);
  }

  async healthCheck() {
    this.validateId(this.spreadsheetId, 'ALMOXA_SPREADSHEET_ID');
    const data = await this.metadata(this.spreadsheetId);
    return {
      status: 'ok',
      provider: 'google-sheets',
      spreadsheet: data.properties.title,
      sheets: (data.sheets ?? []).map(sheet => sheet.properties.title)
    };
  }

  async connect() {
    this.connected = false;
    const { spreadsheet, provider } = await this.healthCheck();
    this.connected = true;
    return { connected: true, spreadsheet, provider };
  }

  async probeRead() {
    const connection = await this.healthCheck();
    const sheet = connection.sheets[0];
    if (!sheet) {
      throw new GoogleSheetsProviderError('SHEET_REQUIRED', 'A planilha operacional não contém abas.');
    }
    const range = encodeURIComponent(`'${sheet.replaceAll("'", "''")}'!A1`);
    await this.request(this.spreadsheetId, `/values/${range}`);
    return connection;
  }

  async disconnect() {
    this.connected = false;
    return { connected: false };
  }

  async testRows() {
    this.validateId(this.spreadsheetId, 'ALMOXA_SPREADSHEET_ID');
    this.validateId(this.testSpreadsheetId, 'ALMOXA_TEST_SPREADSHEET_ID');
    if (this.testSpreadsheetId === this.spreadsheetId) {
      throw new GoogleSheetsProviderError('TEST_TARGET_UNSAFE', 'A planilha de teste deve ser separada da operacional.');
    }
    const range = encodeURIComponent(`'${TEST_SHEET}'!A:D`);
    const { values = [] } = await this.request(this.testSpreadsheetId, `/values/${range}?valueRenderOption=UNFORMATTED_VALUE`);
    if (!HEADERS.every((header, index) => values[0]?.[index] === header)) {
      throw new GoogleSheetsProviderError('TEST_SCHEMA_INVALID', 'Cabeçalho inválido na aba de teste.');
    }
    return values;
  }

  findTestRow(rows, id) {
    const matches = rows.slice(1).flatMap((row, index) => String(row[0]) === id ? [index + 2] : []);
    if (matches.length > 1) {
      throw new GoogleSheetsProviderError('TEST_RECORD_DUPLICATE', 'A aba de teste já contém IDs duplicados.');
    }
    return matches[0];
  }

  async readTestRecord(id) {
    const rows = await this.testRows();
    const row = this.findTestRow(rows, String(id));
    if (!row) {
      throw new GoogleSheetsProviderError('TEST_RECORD_NOT_FOUND', 'Registro de teste não encontrado.');
    }
    const [recordId, createdAt, origin = '', message = ''] = rows[row - 1].map(String);
    return { id: recordId, createdAt, origin, message };
  }

  async writeTestRecord(record) {
    if (!record?.id || !record.createdAt) {
      throw new GoogleSheetsProviderError('TEST_RECORD_INVALID', 'ID e data são obrigatórios.');
    }
    const values = [record.id, record.createdAt, record.origin ?? '', record.message ?? ''].map(String);
    const id = values[0];
    const checkExisting = rows => {
      const row = this.findTestRow(rows, id);
      if (!row) return null;
      if (!values.every((value, index) => value === String(rows[row - 1][index] ?? ''))) {
        throw new GoogleSheetsProviderError('TEST_RECORD_CONFLICT', 'O ID já existe com dados diferentes.');
      }
      return { id, row };
    };

    const existing = checkExisting(await this.testRows());
    if (existing) return existing;

    const metadata = await this.metadata(this.testSpreadsheetId);
    const sheet = metadata.sheets?.find(item => item.properties.title === TEST_SHEET);
    if (!sheet || metadata.spreadsheetId === this.spreadsheetId) {
      throw new GoogleSheetsProviderError('TEST_TARGET_UNSAFE', 'Destino de teste inválido.');
    }
    const { sheetId } = sheet.properties;
    // Uma restrição de nome único e a gravação são aplicadas no mesmo lote.
    const name = 'almoxa_test_' + createHash('sha256').update(id).digest('hex');
    try {
      await this.request(this.testSpreadsheetId, ':batchUpdate', {
        auth: this.writeAuth,
        data: { requests: [
          { addNamedRange: { namedRange: { name, namedRangeId: name, range: {
            sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1
          } } } },
          { appendCells: {
            sheetId,
            rows: [{ values: values.map(stringValue => ({ userEnteredValue: { stringValue } })) }],
            fields: 'userEnteredValue'
          } }
        ] }
      });
    } catch (error) {
      // Uma chamada concorrente pode ter vencido, ou a resposta pode ter se perdido.
      const rows = await this.testRows().catch(() => null);
      const written = rows && checkExisting(rows);
      if (written) return written;
      throw error;
    }
    const written = checkExisting(await this.testRows());
    if (!written) {
      throw new GoogleSheetsProviderError('TEST_RECORD_NOT_FOUND', 'Registro de teste não encontrado após gravação.');
    }
    return written;
  }
}

module.exports = { GoogleSheetsProvider, GoogleSheetsProviderError };
