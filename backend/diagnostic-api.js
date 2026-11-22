'use strict';

const TABLE = 'diagnostics';
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id);
const validText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

function reply(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(data));
}

function reject(res, status, code) {
  return reply(res, status, { ok: false, error: { code } });
}

async function readBody(req, limit = 8192) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
    throw { status: 415, code: 'JSON_REQUIRED' };
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > limit) {
      req.resume();
      throw { status: 413, code: 'PAYLOAD_TOO_LARGE' };
    }
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* Handled below. */ }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw { status: 400, code: 'INVALID_JSON' };
  }
  return body;
}

function createDiagnosticApi({ core, database, log = console }) {
  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const match = /^\/api\/v2\/diagnostics(?:\/([^/]+))?$/.exec(url.pathname);
    if (!match) return false;
    const id = match[1];
    const method = req.method;
    if (!['GET', id ? 'PATCH' : 'POST'].includes(method)) {
      reject(res, 405, 'METHOD_NOT_ALLOWED');
      return true;
    }
    const permission = method === 'GET' ? 'diagnostics:read' : 'diagnostics:write';
    const token = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization || '')?.[1];
    let actor;
    try {
      await core.authorizeSession(token, permission);
      if (method !== 'GET') actor = (await core.getSession(token)).userId;
    } catch (error) {
      if (error.code === 'SESSION_INVALID') reject(res, 401, 'SESSION_INVALID');
      else if (error.code === 'ACCESS_DENIED') reject(res, 403, 'ACCESS_DENIED');
      else reject(res, 503, 'AUTHORIZATION_UNAVAILABLE');
      return true;
    }
    if (id && !validId(id)) {
      reject(res, 400, 'INVALID_ID');
      return true;
    }

    let result;
    if (method === 'GET' && id) {
      result = await database.findById(TABLE, id);
    } else if (method === 'GET') {
      const origin = url.searchParams.get('origin') ?? undefined;
      const page = Number(url.searchParams.get('page') ?? 1);
      const limit = Number(url.searchParams.get('limit') ?? 25);
      if (!Number.isInteger(page) || page < 1 || page > 10000 ||
          !Number.isInteger(limit) || limit < 1 || limit > 100 ||
          (origin !== undefined && !validText(origin, 80))) {
        reject(res, 400, 'INVALID_FILTERS');
        return true;
      }
      result = await database.findMany(TABLE, origin === undefined ? {} : { origin }, { page, limit });
    } else {
      let body;
      try {
        body = await readBody(req);
      } catch (error) {
        if (!error.status) throw error;
        reject(res, error.status, error.code);
        return true;
      }
      if (method === 'POST' && validId(body.id) && validText(body.origin, 80) && validText(body.message, 2000)) {
        result = await database.insert(TABLE, { id: body.id, origin: body.origin, message: body.message }, { actor });
      } else if (method === 'PATCH' && validText(body.message, 2000) &&
          Number.isSafeInteger(body.version) && body.version > 0) {
        result = await database.update(TABLE, id, { message: body.message, version: body.version }, { actor });
      } else {
        reject(res, 400, 'INVALID_RECORD');
        return true;
      }
    }

    if (!result.success) {
      const { code } = result.error;
      if (code === 'RECORD_CONFLICT') reject(res, 409, code);
      else if (code === 'RECORD_NOT_FOUND') reject(res, 404, code);
      else {
        log.error('Falha no banco de diagnóstico.', method, code);
        reject(res, 503, 'DATABASE_UNAVAILABLE');
      }
    } else {
      const value = result.data.data;
      if (method === 'POST') reply(res, value.created ? 201 : 200, { ok: true, data: value.record });
      else if (value === null) reject(res, 404, 'RECORD_NOT_FOUND');
      else reply(res, 200, { ok: true, data: value });
    }
    return true;
  };
}

module.exports = { createDiagnosticApi, reply, readBody };
