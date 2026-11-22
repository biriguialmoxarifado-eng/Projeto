'use strict';

const { createHash } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { GoogleAuth } = require('google-auth-library');
const { desktopGoogleAuth } = require('./google-desktop-auth');

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
    this.testOnly = options.testOnly === true;
    this.wait = options.wait ?? delay;
    const localAuth = desktopGoogleAuth();
    this.readAuth = options.readAuth ?? localAuth ?? new GoogleAuth({ scopes: [SCOPE + '.readonly'] });
    this.writeAuth = options.writeAuth ?? localAuth ?? new GoogleAuth({ scopes: [SCOPE] });
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
      throw new GoogleSheetsProviderError('GOOGLE_AUTH_FAILED', 'Configure a autenticação Google no backend.');
    }
    for (let attempt = 0; ; attempt++) {
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
        if (['invalid_grant', 'invalid_client'].includes(error.response?.data?.error)) {
          throw new GoogleSheetsProviderError('GOOGLE_AUTH_FAILED', 'Renove a autenticação Google do backend.');
        }
        const header = error.response?.headers?.get?.('retry-after');
        const seconds = /^\d+$/.test(header ?? '') ? Number(header) * 1000 : NaN;
        const retryAfter = Number.isFinite(seconds) ? seconds : Date.parse(header) - Date.now();
        const backoff = Math.max(1000 * 2 ** attempt + Math.floor(Math.random() * 250), retryAfter || 0);
        if (!data && attempt < 2 && [429, 503].includes(status) && backoff <= 10000) {
          await this.wait(backoff);
          continue;
        }
        throw new GoogleSheetsProviderError(
          Number.isInteger(status) ? `GOOGLE_SHEETS_HTTP_${status}` : 'GOOGLE_SHEETS_UNAVAILABLE',
          Number.isInteger(status) ? `Google Sheets respondeu HTTP ${status}.` : 'Falha na comunicação com Google Sheets.'
        );
      }
    }
  }

  async metadata(id) {
    const fields = encodeURIComponent('spreadsheetId,properties(title),sheets(properties(sheetId,title,gridProperties(rowCount)))');
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

  async readSheetPage(sheet, { startRow = 2, limit = 50 } = {}) {
    this.validateId(this.spreadsheetId, 'ALMOXA_SPREADSHEET_ID');
    if (typeof sheet !== 'string' || !sheet.trim()) {
      throw new GoogleSheetsProviderError('SHEET_REQUIRED', 'Informe o nome da aba.');
    }
    if (!Number.isSafeInteger(startRow) || startRow < 2 || startRow > 10000000 ||
        !Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new GoogleSheetsProviderError('SHEET_PAGE_INVALID', 'Informe uma linha inicial válida e um limite entre 1 e 100.');
    }

    const metadata = await this.metadata(this.spreadsheetId);
    const tab = metadata.sheets?.find(item => item.properties.title === sheet)?.properties;
    const rowCount = tab?.gridProperties?.rowCount;
    if (!Number.isInteger(rowCount) || rowCount < 1) {
      throw new GoogleSheetsProviderError('SHEET_GRID_REQUIRED', 'A aba informada não está disponível como grade.');
    }

    const prefix = "'" + sheet.replaceAll("'", "''") + "'!";
    const read = range => this.request(this.spreadsheetId,
      '/values/' + encodeURIComponent(prefix + range) + '?valueRenderOption=UNFORMATTED_VALUE');
    const endRow = Math.min(rowCount, startRow + limit - 1);
    const [header, page] = await Promise.all([
      read('1:1'),
      startRow <= endRow ? read(startRow + ':' + endRow) : { values: [] }
    ]);
    return {
      headers: header.values?.[0] ?? [],
      rows: (page.values ?? []).map((values, index) => ({ row: startRow + index, values })),
      nextRow: endRow < rowCount ? endRow + 1 : null
    };
  }


  async disconnect() {
    this.connected = false;
    return { connected: false };
  }

  async testRows() {
    if (!this.testOnly) this.validateId(this.spreadsheetId, 'ALMOXA_SPREADSHEET_ID');
    this.validateId(this.testSpreadsheetId, 'ALMOXA_TEST_SHEET_ID');
    if (this.testSpreadsheetId === this.spreadsheetId) {
      throw new GoogleSheetsProviderError('TEST_TARGET_UNSAFE', 'A planilha de teste deve ser separada da operacional.');
    }
    if (this.testOnly) {
      const metadata = await this.metadata(this.testSpreadsheetId);
      if (metadata.spreadsheetId !== this.testSpreadsheetId || metadata.properties?.title !== 'ALMOXA_TESTE_CORE') {
        throw new GoogleSheetsProviderError('TEST_TARGET_UNSAFE', 'O destino deve ser ALMOXA_TESTE_CORE.');
      }
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

  async confirmTestRecord(id) {
    if (!this.testOnly || typeof id !== 'string' ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)) {
      throw new GoogleSheetsProviderError('TEST_RECORD_INVALID', 'A confirmação exige um UUID de teste isolado.');
    }
    const previous = 'Teste pendente ' + id;
    const next = 'Teste confirmado ' + id;
    const record = await this.readTestRecord(id);
    if (record.origin !== 'ALMOXA_PRO_V2' || ![previous, next].includes(record.message)) {
      throw new GoogleSheetsProviderError('TEST_RECORD_CONFLICT', 'O registro não pertence a este teste.');
    }
    if (record.message === next) return record;

    const metadata = await this.metadata(this.testSpreadsheetId);
    const sheet = metadata.sheets?.find(item => item.properties.title === TEST_SHEET);
    if (!sheet || metadata.spreadsheetId !== this.testSpreadsheetId ||
        metadata.properties?.title !== 'ALMOXA_TESTE_CORE') {
      throw new GoogleSheetsProviderError('TEST_TARGET_UNSAFE', 'Destino de teste inválido.');
    }

    let requestError;
    try {
      await this.request(this.testSpreadsheetId, ':batchUpdate', {
        auth: this.writeAuth,
        data: { requests: [{ findReplace: {
          find: previous,
          replacement: next,
          matchCase: true,
          matchEntireCell: true,
          range: { sheetId: sheet.properties.sheetId, startRowIndex: 1, startColumnIndex: 3, endColumnIndex: 4 }
        } }] }
      });
    } catch (error) {
      requestError = error;
    }

    const confirmed = await this.readTestRecord(id).catch(error => { throw requestError ?? error; });
    if (confirmed.message === next && confirmed.origin === record.origin && confirmed.createdAt === record.createdAt) {
      return confirmed;
    }
    throw requestError ?? new GoogleSheetsProviderError('TEST_UPDATE_NOT_CONFIRMED', 'A atualização não foi confirmada.');
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
    if (!sheet || metadata.spreadsheetId === this.spreadsheetId ||
        (this.testOnly && (metadata.spreadsheetId !== this.testSpreadsheetId || metadata.properties?.title !== 'ALMOXA_TESTE_CORE'))) {
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
