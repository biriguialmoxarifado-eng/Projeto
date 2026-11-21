'use strict';

const { createServer } = require('node:http');
const { CORE_VERSION } = require('../core');
const { createRuntime } = require('./runtime');
const { createDiagnosticApi, reply } = require('./diagnostic-api');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

function createHandler(core, revision, database) {
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
  const { core, database } = await createRuntime(sqlite, { sqlite: Boolean(sqlite), credential: { token, actor, role } });
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '127.0.0.1';
  const handler = createHandler(core, process.env.ALMOXA_REVISION || null, sqlite && database);
  const server = createServer({ requestTimeout: 15000, headersTimeout: 10000 }, (req, res) => {
    if (req.url.startsWith('/api/v2/diagnostics')) {
      const start = performance.now();
      res.once('finish', () => console.info('diagnostics', req.method, res.statusCode, Math.round(performance.now() - start) + 'ms'));
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
