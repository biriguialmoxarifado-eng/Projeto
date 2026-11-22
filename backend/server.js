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
      revision,
      ...(preview ? { environment: 'homologacao-local' } : {})
    }));
  };
}

function previewCors(configured) {
  if (!configured) return () => false;
  const url = new URL(configured);
  if (url.protocol !== 'https:' || url.origin !== configured) {
    throw new Error('ALMOXA_PREVIEW_ORIGIN deve conter somente a origem HTTPS publicada.');
  }
  const allowed = new Map([
    ['/health', ['GET']],
    ['/api/v2/preview/session', ['POST', 'DELETE']],
    ['/api/v2/preview/dispatch', ['POST']]
  ]);
  return (req, res) => {
    const methods = allowed.get(req.url);
    if (!methods) return false;
    res.setHeader('Vary', 'Origin');
    const trusted = req.headers.origin === configured;
    if (trusted) res.setHeader('Access-Control-Allow-Origin', configured);
    if (req.method !== 'OPTIONS') return false;
    if (!trusted || !methods.includes(req.headers['access-control-request-method'])) {
      res.writeHead(403).end();
      return true;
    }
    res.writeHead(204, {
      'Access-Control-Allow-Methods': methods.join(', '),
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Cache-Control': 'no-store'
    }).end();
    return true;
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
  const sqlitePreview = process.env.ALMOXA_PREVIEW_SQLITE === '1';
  if (sqlitePreview && (!sqlite || previewId || (process.env.HOST ?? '127.0.0.1') !== '127.0.0.1')) {
    throw new Error('Homologação SQLite exige banco isolado, loopback e ausência de planilha de teste.');
  }
  if (sqlitePreview) sqlite.enablePreview();
  let operational;
  let operationalStorage;
  if (process.env.ALMOXA_OPERATIONAL_READ === '1') {
    if (sqlite || previewId || (process.env.HOST ?? '127.0.0.1') !== '127.0.0.1' ||
        process.env.ALMOXA_PREVIEW_ORIGIN) {
      throw new Error('Leitura operacional local exige loopback, sem SQLite, homologação ou origem externa.');
    }
    const { GoogleSheetsProvider } = require('../database/adapters/google-sheets-provider');
    operationalStorage = new GoogleSheetsProvider();
    operationalStorage.validateId(operationalStorage.spreadsheetId, 'ALMOXA_SPREADSHEET_ID');
    operational = require('./operational-reader').createOperationalReader(operationalStorage);
  }
  let invoiceTestStorage;
  if (previewId) {
    if ((process.env.HOST ?? '127.0.0.1') !== '127.0.0.1' || !token || token.length < 32 ||
        !/^\S+$/.test(token) || !actor?.trim() || !['reader', 'operator'].includes(role)) {
      throw new Error('Homologação exige loopback e credencial local.');
    }
    const { GoogleSheetsProvider } = require('../database/adapters/google-sheets-provider');
    invoiceTestStorage = new GoogleSheetsProvider({ testSpreadsheetId: previewId, testOnly: true });
  }
  const runtime = await createRuntime(operationalStorage || sqlite, { operationalSecurity: operational?.security, sqlite: Boolean(sqlite), credential: { token, actor, role, approvalProfile: previewId ? process.env.ALMOXA_PREVIEW_APPROVAL_PROFILE : undefined }, invoiceTestStorage, sqlitePreview });
  const { core, database } = runtime;
  // O Desktop e o Campo passam a ser servidos sempre que houver banco —
  // SQLite basta. Antes dependiam de ALMOXA_PREVIEW_SHEET_ID, o que
  // amarrava a interface a uma planilha do Google para simplesmente abrir.
  const preview = (operational || invoiceTestStorage || sqlite) &&
    require('./preview-api').createPreview(runtime, join(__dirname, '..'), {
      operational,
      modulesAvailable: Boolean(invoiceTestStorage || sqlitePreview),
      allowWrite: Boolean(invoiceTestStorage || sqlitePreview) && process.env.ALMOXA_PREVIEW_WRITE === '1'
    });
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '127.0.0.1';
  const handler = createHandler(core, process.env.ALMOXA_REVISION || null, sqlite && database, preview);
  const cors = previewCors(preview ? process.env.ALMOXA_PREVIEW_ORIGIN : undefined);
  const server = createServer({ requestTimeout: 15000, headersTimeout: 10000 }, (req, res) => {
    if (operational && req.headers.host !== host + ':' + server.address().port) {
      res.writeHead(403).end();
      return;
    }
    if (cors(req, res)) return;
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
  server.listen(port, host, () => {
    console.log(`ALMOXA PRO V2 disponível na porta ${server.address().port}.`);
    // Sem banco não há diagnóstico: o servidor responderia 404 a tudo
    // sem dizer por quê. Avisar aqui evita a caça ao erro.
    if (!operational && !sqlite && !invoiceTestStorage) {
      console.warn(
        'ATENÇÃO: nenhum banco configurado — todas as rotas vão responder 404.\n' +
        '  Falta a variável ALMOXA_SQLITE_PATH (e a credencial do diagnóstico).\n' +
        '  Copie .env.example para .env, preencha, e suba com: npm run start:local'
      );
    }
  });
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
