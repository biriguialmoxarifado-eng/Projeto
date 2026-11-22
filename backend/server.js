'use strict';

const { createServer } = require('node:http');
const { CORE_VERSION } = require('../core');
const { createRuntime } = require('./runtime');
const { createDiagnosticApi, reply } = require('./diagnostic-api');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

function createHandler(core, revision, database, preview) {
  const api = database && createDiagnosticApi({ core, database });
  const page = api && readFileSync(join(__dirname, 'diagnostics.html'));
  const client = api && readFileSync(join(__dirname, 'diagnostics-client.js'));
  return async (req, res) => {
    if (api && req.method === 'GET' && ['/diagnostics', '/diagnostics-client.js'].includes(req.url)) {
      const html = req.url === '/diagnostics';
      res.writeHead(200, {
        'Content-Type': html ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'",
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store'
      });
      res.end(html ? page : client);
      return;
    }
    if (preview && await preview(req, res)) return;
    if (api && await api(req, res)) return;
    if (req.method !== 'GET' || req.url !== '/health') {
      res.writeHead(404).end();
      return;
    }
    const { status } = await core.health();
    res.writeHead(status === 'healthy' ? 200 : 503, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify({
      status,
      coreVersion: CORE_VERSION,
      revision
    }));
  };
}

async function main() {
  const sqlitePath = process.env.ALMOXA_SQLITE_PATH;
  const { ALMOXA_DIAGNOSTICS_TOKEN: token, ALMOXA_DIAGNOSTICS_ACTOR: actor,
    ALMOXA_DIAGNOSTICS_ROLE: role = 'operator' } = process.env;
  let sqlite;
  if (sqlitePath) {
    if (!token || token.length < 32 || !/^\S+$/.test(token) ||
        !actor?.trim() || actor.length > 80 || !['reader', 'operator'].includes(role)) {
      throw new Error('Configure a credencial e o responsável do diagnóstico SQLite.');
    }
    const { SqliteDiagnosticsProvider } = require('../database/adapters/sqlite-diagnostics-provider');
    sqlite = new SqliteDiagnosticsProvider(sqlitePath);
  }
  const previewId = process.env.ALMOXA_PREVIEW_SHEET_ID;
  let invoiceTestStorage;
  if (previewId) {
    if ((process.env.HOST ?? '127.0.0.1') !== '127.0.0.1' || !token || token.length < 32 ||
        !/^\S+$/.test(token) || !actor?.trim() || !['reader', 'operator'].includes(role)) {
      throw new Error('Homologação exige loopback e credencial local.');
    }
    const { GoogleSheetsProvider } = require('../database/adapters/google-sheets-provider');
    invoiceTestStorage = new GoogleSheetsProvider({ testSpreadsheetId: previewId, testOnly: true });
  }
  const runtime = await createRuntime(sqlite, { sqlite: Boolean(sqlite), credential: { token, actor, role, approvalProfile: previewId ? process.env.ALMOXA_PREVIEW_APPROVAL_PROFILE : undefined }, invoiceTestStorage });
  const { core, database } = runtime;
  const preview = invoiceTestStorage && require('./preview-api').createPreview(runtime, join(__dirname, '..'), {
    allowWrite: process.env.ALMOXA_PREVIEW_WRITE === '1'
  });
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '127.0.0.1';
  const handler = createHandler(core, process.env.ALMOXA_REVISION || null, sqlite && database, preview);
  const server = createServer({ requestTimeout: 15000, headersTimeout: 10000 }, (req, res) => {
    const diagnostic = req.url.startsWith('/api/v2/diagnostics');
    const previewRequest = req.url.startsWith('/api/v2/preview/');
    if (diagnostic || previewRequest) {
      const start = performance.now();
      res.once('finish', () => console.info(diagnostic ? 'diagnostics' : 'preview', req.method, res.statusCode, Math.round(performance.now() - start) + 'ms'));
    }
    handler(req, res).catch(() => {
      console.error('Falha ao processar uma requisição.');
      if (res.headersSent) res.destroy();
      else reply(res, 500, { ok: false, error: { code: 'INTERNAL_ERROR' } });
    });
  });
  server.on('error', () => {
    console.error('Falha ao iniciar o servidor ALMOXA PRO V2.');
    process.exitCode = 1;
  });
  server.listen(port, host, () => console.log(`ALMOXA PRO V2 disponível na porta ${server.address().port}.`));
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => server.close(() => sqlite?.disconnect()));
  }
}

if (require.main === module) {
  main().catch(() => {
    console.error('Falha ao carregar o backend ALMOXA PRO V2.');
    process.exitCode = 1;
  });
}

module.exports = { createHandler };
