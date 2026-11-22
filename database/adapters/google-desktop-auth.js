'use strict';

const { OAuth2Client } = require('google-auth-library');
const { randomBytes } = require('node:crypto');
const { createServer } = require('node:http');
const { mkdir, readFile, rename, rm, writeFile } = require('node:fs/promises');
const { homedir } = require('node:os');
const { join } = require('node:path');
const { once } = require('node:events');

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.metadata.readonly'
];
const OPERATIONAL_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/drive.readonly'
];
const directory = join(process.env.LOCALAPPDATA || homedir(), '.almoxa-google');
const clientPath = join(directory, 'client.json');
const tokenPath = join(directory, 'token.json');
const operationalTokenPath = join(directory, 'token-operational.json');

async function loadClient() {
  let config;
  try {
    config = JSON.parse(await readFile(clientPath, 'utf8')).installed;
  } catch {
    throw new Error('Salve o JSON de um cliente OAuth do tipo App para computador em ' + clientPath);
  }
  if (typeof config?.client_id !== 'string' || !config.client_id.endsWith('.apps.googleusercontent.com') ||
      typeof config.client_secret !== 'string' || !config.client_secret) {
    throw new Error('O arquivo client.json não contém um cliente OAuth de computador válido.');
  }
  return { client: new OAuth2Client(config.client_id, config.client_secret), clientId: config.client_id };
}

async function saveToken(refreshToken, clientId, destination) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temp = join(directory, randomBytes(16).toString('hex') + '.tmp');
  try {
    await writeFile(temp, JSON.stringify({ clientId, refreshToken }), { flag: 'wx', mode: 0o600 });
    await rename(temp, destination);
  } finally {
    await rm(temp, { force: true });
  }
}

function callbackResult(url, state) {
  const request = new URL(url, 'http://127.0.0.1');
  if (request.pathname !== '/oauth/callback' || request.searchParams.get('state') !== state) return null;
  return { code: request.searchParams.get('code'), denied: request.searchParams.has('error') };
}

async function authorize(operational) {
  const scopes = operational ? OPERATIONAL_SCOPES : SCOPES;
  const { client, clientId } = await loadClient();
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  const state = randomBytes(32).toString('base64url');
  let finish;
  const callback = new Promise(resolve => { finish = resolve; });
  const server = createServer((req, res) => {
    const result = req.method === 'GET' && callbackResult(req.url, state);
    if (!result) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer'
    }).end('Resposta recebida. Volte ao terminal do ALMOXA PRO.');
    finish(result);
  });

  let timer;
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const redirect = 'http://127.0.0.1:' + server.address().port + '/oauth/callback';
    console.log('Abra este endereço no navegador deste computador e autorize com sua conta Google:');
    console.log(client.generateAuthUrl({
      redirect_uri: redirect, access_type: 'offline', prompt: 'consent',
      code_challenge: codeChallenge, code_challenge_method: 'S256', state, scope: scopes
    }));
    timer = setTimeout(() => finish({ denied: true }), 180000);
    const { code, denied } = await callback;
    if (denied || !code) throw new Error('Autorização cancelada ou expirada.');
    let tokens;
    try {
      ({ tokens } = await client.getToken({ code, codeVerifier, redirect_uri: redirect }));
    } catch {
      throw new Error('O Google recusou a troca do código. Confira o cliente e o usuário de teste.');
    }
    if (!tokens.refresh_token || !scopes.every(scope => tokens.scope?.split(' ').includes(scope))) {
      throw new Error('O Google não concedeu o acesso offline com todos os escopos solicitados.');
    }
    await saveToken(tokens.refresh_token, clientId, operational ? operationalTokenPath : tokenPath);
    console.log('Autorização armazenada no perfil local.');
  } finally {
    clearTimeout(timer);
    server.close();
  }
}

function desktopGoogleAuth() {
  if (process.env.ALMOXA_GOOGLE_AUTH !== 'oauth') return undefined;
  let pending;
  return {
    getClient() {
      pending ??= (async () => {
        const { client, clientId } = await loadClient();
        const preferred = process.env.ALMOXA_OPERATIONAL_READ === '1' ? operationalTokenPath : tokenPath;
        const stored = await readFile(preferred, 'utf8').catch(error => {
          if (preferred === operationalTokenPath && error.code === 'ENOENT') return readFile(tokenPath, 'utf8');
          throw error;
        });
        const token = JSON.parse(stored);
        if (token.clientId !== clientId || typeof token.refreshToken !== 'string' || !token.refreshToken) {
          throw new Error('Execute npm run auth:google para autorizar o cliente local.');
        }
        client.setCredentials({ refresh_token: token.refreshToken });
        return client;
      })().catch(error => { pending = undefined; throw error; });
      return pending;
    }
  };
}

if (require.main === module) {
  authorize(process.argv.includes('--operational')).catch(error => {
    console.error(error instanceof Error && !error.code ? error.message : 'Falha ao configurar OAuth local.');
    process.exitCode = 1;
  });
}

module.exports = { desktopGoogleAuth, callbackResult };
