'use strict';

const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { reply, readBody } = require('./diagnostic-api');

function createPreview(runtime, root, { allowWrite = false } = {}) {
  const read = new Map([
    ['nf', ['listar', 'obter', 'itens']],
    ['itens', ['listar', 'obter']],
    ['fornecedores', ['listar', 'porCnpj']],
    ['categorias', ['listar']],
    ['obras', ['listar']],
    ['ocorrencias', ['listar', 'obter', ...(allowWrite ? ['criar', 'salvar'] : [])]],
    ['notificacoes', ['listar']],
    ['kits', ['listar', 'obter', 'doPerfil']],
    ['calendario', ['listar']],
    ['centros', ['listar']],
    ['projetos', ['listar', 'obter', 'detalhe']],
    ['relatorios', ['listar', 'obter', 'gerados']],
    ['mural', ['listar', 'obter']],
    ['lojinha', ['catalogo', 'item']],
    ['inventario', ['listar', 'obter', 'divergencias']]
  ]);
  const files = {
    '/homologacao/desktop': 'index.html',
    '/homologacao/campo': 'ALMOXA_CAMPO.html.html'
  };
  const client = readFileSync(join(__dirname, 'preview-client.js'));
  const guard = write => '<script src="/homologacao/preview-client.js"' + (write ? ' data-write="1"' : '') + '></script>';
  const pageHeaders = {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'none'; frame-ancestors 'self'; form-action 'none'; base-uri 'none'",
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'
  };
  const error = (res, status, codigo, mensagem) => reply(res, status, { ok: false, codigo, mensagem });
  return async (req, res) => {
    if (req.method === 'GET' && Object.hasOwn(files, req.url)) {
      const html = readFileSync(join(root, files[req.url]), 'utf8');
      res.writeHead(200, pageHeaders).end(html.replace(/<head[^>]*>/i, tag => tag + guard(allowWrite && req.url.endsWith('/desktop'))));
      return true;
    }
    if (req.method === 'GET' && req.url === '/homologacao/preview-client.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' }).end(client);
      return true;
    }
    if (req.url !== '/api/v2/preview/dispatch') return false;
    if (req.method !== 'POST') {
      error(res, 405, 'METODO_INVALIDO', 'Use POST para o despacho de homologação.');
      return true;
    }
    const token = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization || '')?.[1];
    try {
      await runtime.core.authorizeSession(token, 'nf:read');
      const { modulo, acao, payload = {} } = await readBody(req);
      if (!read.get(modulo)?.includes(acao) || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
        error(res, 400, 'OPERACAO_FORA_DA_HOMOLOGACAO', 'Operação indisponível no ambiente de homologação.');
        return true;
      }
      let result;
      if (modulo === 'nf') result = await runtime.getInvoiceReadAdapter()(token, acao, payload);
      else if (modulo === 'obras') result = await runtime.getAdministrationEngine().obras(token, acao, payload);
      else if (['ocorrencias', 'notificacoes', 'kits', 'calendario', 'centros', 'projetos', 'relatorios', 'mural'].includes(modulo)) {
        result = await runtime.getAdministrationEngine()[modulo](token, acao, payload);
      }
      else if (modulo === 'lojinha') result = await runtime.getShopEngine()(token, acao, payload);
      else if (modulo === 'inventario') result = await runtime.getInventoryEngine()(token, acao, payload);
      else result = await runtime.getCatalogEngine().consultarLegado(token, modulo, acao, payload);
      reply(res, 200, result);
    } catch (cause) {
      if (cause.code === 'SESSION_INVALID') error(res, 401, 'SEM_SESSAO', 'Credencial de homologação inválida.');
      else if (cause.code === 'ACCESS_DENIED') error(res, 403, 'ACESSO_NEGADO', 'Operação sem permissão.');
      else if (cause.code === 'ADMIN_CONFLITO_IDEMPOTENCIA' || cause.code === 'ADMIN_CONFLITO_VERSAO') {
        error(res, 409, cause.code, 'A operação conflita com a versão armazenada.');
      }
      else if (cause.code === 'OCORRENCIA_NAO_ENCONTRADA') {
        error(res, 404, cause.code, 'Ocorrência não localizada.');
      }
      else if (['ADMIN_OPERACAO_INVALIDA', 'ADMIN_DADOS_INVALIDOS', 'OCORRENCIA_MATERIAIS_INVALIDOS'].includes(cause.code)) {
        error(res, 400, cause.code, 'Dados da operação inválidos.');
      }
      else if (cause.status) error(res, cause.status, cause.code, 'Solicitação inválida.');
      else error(res, 503, 'CORE_INDISPONIVEL', 'O Core de homologação não conseguiu consultar os dados.');
    }
    return true;
  };
}

module.exports = { createPreview };
