'use strict';

const { readFileSync } = require('node:fs');
const { randomBytes } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { join } = require('node:path');
const { reply, readBody } = require('./diagnostic-api');

function createPreview(runtime, root, { allowWrite = false } = {}) {
  const read = new Map([
    ['nf', ['listar', 'obter', 'itens', ...(allowWrite ? ['salvar'] : [])]],
    ['nfed', allowWrite ? ['atualizar'] : []],
    ['compras', ['listar', 'precompras', 'pedidos']],
    ['estoque', ['movimentacoes', 'saldo', ...(allowWrite ? ['movimentar'] : [])]],
    ['itens', ['listar', 'obter']],
    ['fornecedores', ['listar', 'porCnpj']],
    ['categorias', ['listar']],
    ['obras', ['listar']],
    ['usuarios', ['listar', 'contar', 'obter']],
    ['config', ['obter']],
    ['auditoria', ['listar']],
    ['ocorrencias', ['listar', 'obter', ...(allowWrite ? ['criar', 'salvar'] : [])]],
    ['notificacoes', ['listar']],
    ['kits', ['listar', 'obter', 'doPerfil']],
    ['calendario', ['listar']],
    ['centros', ['listar']],
    ['projetos', ['listar', 'obter', 'detalhe']],
    ['relatorios', ['listar', 'obter', 'gerados']],
    ['mural', ['listar', 'obter']],
    ['painel', ['carregar']],
    ['dashboard', ['mural']],
    ['automacao', ['regras']],
    ['ferramentas', ['listar', 'obter', 'historico']],
    ['epi', ['listar', 'fichas', 'obter']],
    ['manutencao', ['status', 'versoes', 'backups']],
    ['aprovacoes', ['listar', 'pendentes', 'porPerfil']],
    ['retiradas', ['itensLiberados']],
    ['biometria', ['status']],
    ['ocr', ['disponivel', ...(allowWrite ? ['ler'] : [])]],
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
  const sessions = new Map();
  const ttlMs = 15 * 60 * 1000;
  const bearer = req => /^Bearer ([^\s]+)$/i.exec(req.headers.authorization || '')?.[1];
  return async (req, res) => {
    if (req.url === '/api/v2/preview/session') {
      const token = bearer(req);
      if (req.method === 'DELETE') {
        sessions.delete(token);
        reply(res, 200, { ok: true });
        return true;
      }
      if (req.method !== 'POST') {
        error(res, 405, 'METODO_INVALIDO', 'Método de sessão inválido.');
        return true;
      }
      try {
        await runtime.core.authorizeSession(token, 'nf:read');
      } catch {
        error(res, 401, 'SEM_SESSAO', 'Credencial de homologação inválida.');
        return true;
      }
      const now = Date.now();
      for (const [id, value] of sessions) if (value.expires <= now) sessions.delete(id);
      if (sessions.size >= 64) {
        error(res, 429, 'SESSOES_LIMITADAS', 'Limite de sessões de homologação atingido.');
        return true;
      }
      const id = randomBytes(32).toString('base64url');
      sessions.set(id, { token, expires: now + ttlMs, invoiceVersions: new Map() });
      reply(res, 200, { ok: true, dados: { token: id, expiraEm: now + ttlMs } });
      return true;
    }
    if (req.method === 'GET' && Object.hasOwn(files, req.url)) {
      const html = readFileSync(join(root, files[req.url]), 'utf8');
      res.writeHead(200, pageHeaders).end(html.replace(/<head[^>]*>/i, tag => tag + guard(allowWrite && req.url.endsWith('/desktop'))));
      return true;
    }
    if (req.method === 'GET' && req.url === '/homologacao/preview-client.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' }).end(client);
      return true;
    }
    const upload = req.url === '/api/v2/preview/ocr';
    if (!upload && req.url !== '/api/v2/preview/dispatch') return false;
    if (upload && !allowWrite) {
      error(res, 404, 'OPERACAO_FORA_DA_HOMOLOGACAO', 'Processamento OCR desativado.');
      return true;
    }
    if (req.method !== 'POST') {
      error(res, 405, 'METODO_INVALIDO', 'Use POST para o despacho de homologação.');
      return true;
    }
    const presented = bearer(req);
    const session = sessions.get(presented);
    if (!session || session.expires <= Date.now()) {
      sessions.delete(presented);
      error(res, 401, 'SEM_SESSAO', 'Abra uma sessão de homologação.');
      return true;
    }
    const { token } = session;
    try {
      await runtime.core.authorizeSession(token, 'nf:read');
      const { modulo, acao, payload = {} } = await readBody(req, upload ? 1450000 : 8192);
      if (!read.get(modulo)?.includes(acao) || (upload !== (modulo === 'ocr' && acao === 'ler')) || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
        error(res, 400, 'OPERACAO_FORA_DA_HOMOLOGACAO', 'Operação indisponível no ambiente de homologação.');
        return true;
      }
      let result;
      if (modulo === 'ocr') result = await runtime.getOcrEngine()(token, acao, payload);
      else if (modulo === 'nfed' || (modulo === 'nf' && acao === 'salvar')) {
        const { legacyNote } = require('../core/motors/invoice-read-adapter');
        const editing = modulo === 'nfed';
        const { operacaoCore, versaoCore, ...note } = payload;
        const id = note.id || note.idNF;
        if (!/^TESTE CORE /.test(note.fornecedor || '') ||
            (editing && (!id || !Number.isSafeInteger(versaoCore) || versaoCore < 1))) {
          error(res, 400, 'NF_OPERACAO_INVALIDA', 'Informe os dados sinteticos e a versao lida da nota.');
          return true;
        }
        const engine = runtime.getInvoiceEngine();
        if (editing) {
          const previous = await engine.consultar(token, id);
          if (!/^TESTE CORE /.test(previous?.note.fornecedor || '')) {
            error(res, 404, 'NAO_ENCONTRADA', 'Nota sintetica indisponivel.');
            return true;
          }
        }
        const entry = await engine.salvar(token, {
          operation: operacaoCore, version: editing ? versaoCore : 0,
          expectedId: editing ? id : undefined, note
        });
        const confirmed = session.invoiceVersions.get(entry.id) ?? 0;
        session.invoiceVersions.set(entry.id, Math.max(confirmed, entry.version));
        result = { ok: true, dados: legacyNote(entry), atualizada: editing };
      }
      else if (modulo === 'nf') {
        const readInvoice = runtime.getInvoiceReadAdapter();
        const minVersion = acao === 'obter' ? session.invoiceVersions.get(payload.id || payload.idNF) : undefined;
        result = await readInvoice(token, acao, payload);
        if (minVersion) {
          for (const pause of [250, 750]) {
            if (result.dados?.versaoCore >= minVersion) break;
            await delay(pause);
            result = await readInvoice(token, acao, payload);
          }
          if (!(result.dados?.versaoCore >= minVersion)) {
            error(res, 503, 'NF_LEITURA_DESATUALIZADA', 'A versao confirmada ainda nao esta disponivel para consulta.');
            return true;
          }
        }
      }
      else if (modulo === 'estoque') {
        const stock = runtime.getStockEngine();
        if (acao === 'movimentacoes') result = await stock.movimentacoes(token, payload);
        else if (acao === 'saldo') result = { ok: true, dados: await stock.saldo(token, payload.sku, payload.local) };
        else {
          const { sku, local, tipo, qtd, operacaoCore, versaoCore, motivo } = payload;
          const action = typeof tipo === 'string' ? tipo.toLowerCase() : '';
          if (typeof sku !== 'string' || !/^SYN-[a-zA-Z0-9-]+$/.test(sku) ||
              !['entrada', 'saida', 'ajuste'].includes(action)) {
            error(res, 400, 'ESTOQUE_OPERACAO_INVALIDA', 'Use um SKU sintetico e um tipo de movimento permitido.');
            return true;
          }
          const entry = await stock.movimentar(token, { sku, local, action, quantidade: qtd,
            operation: operacaoCore, version: versaoCore, motivo });
          result = { ok: true, dados: { sku, local, tipo: action.toUpperCase(), versaoCore: entry.version,
            operacaoCore: entry.operation } };
        }
      }
      else if (modulo === 'compras') result = await runtime.getPurchaseEngine().consultarLegado(token, acao, payload);
      else if (modulo === 'dashboard') {
        const panel = await runtime.getAdministrationEngine().painel(token, 'carregar');
        result = { ok: true, dados: panel.dados ?? {} };
      }
      else if (modulo === 'auditoria') result = await runtime.getAdministrationEngine().auditoria(token, acao, payload);
      else if (modulo === 'usuarios') result = await runtime.getAdministrationEngine().usuarios(token, acao, payload);
      else if (modulo === 'config') {
        if (payload.chave !== 'PAINEL_CONFIG' && !/^synthetic-[\w-]{1,75}$/.test(payload.chave ?? '')) {
          error(res, 403, 'ACESSO_NEGADO', 'Chave fora da homologação.');
          return true;
        }
        result = await runtime.getAdministrationEngine().config(token, acao, payload);
      }
      else if (modulo === 'obras') result = await runtime.getAdministrationEngine().obras(token, acao, payload);
      else if (['ocorrencias', 'notificacoes', 'kits', 'calendario', 'centros', 'projetos', 'relatorios', 'mural', 'painel', 'automacao', 'ferramentas', 'epi', 'manutencao', 'aprovacoes', 'retiradas', 'biometria'].includes(modulo)) {
        result = await runtime.getAdministrationEngine()[modulo](token, acao, payload);
      }
      else if (modulo === 'lojinha') result = await runtime.getShopEngine()(token, acao, payload);
      else if (modulo === 'inventario') result = await runtime.getInventoryEngine()(token, acao, payload);
      else result = await runtime.getCatalogEngine().consultarLegado(token, modulo, acao, payload);
      reply(res, 200, result);
    } catch (cause) {
      if (cause.code === 'SESSION_INVALID') error(res, 401, 'SEM_SESSAO', 'Credencial de homologação inválida.');
      else if (cause.code === 'ACCESS_DENIED') error(res, 403, 'ACESSO_NEGADO', 'Operação sem permissão.');
      else if (cause.code === 'OCR_CONFLITO_IDEMPOTENCIA') error(res, 409, cause.code, 'A operação OCR já usa outro arquivo.');
      else if (cause.code?.startsWith('OCR_')) error(res, 400, cause.code, 'Não foi possível processar a imagem em homologação.');
      else if (cause.code === 'ADMIN_CONFLITO_IDEMPOTENCIA' || cause.code === 'ADMIN_CONFLITO_VERSAO') {
        error(res, 409, cause.code, 'A operação conflita com a versão armazenada.');
      }
      else if (cause.code === 'OCORRENCIA_NAO_ENCONTRADA') {
        error(res, 404, cause.code, 'Ocorrência não localizada.');
      }
      else if (['ADMIN_OPERACAO_INVALIDA', 'ADMIN_DADOS_INVALIDOS', 'OCORRENCIA_MATERIAIS_INVALIDOS'].includes(cause.code)) {
        error(res, 400, cause.code, 'Dados da operação inválidos.');
      }
      else if (['NF_CONFLITO_IDEMPOTENCIA', 'NF_CONFLITO_VERSAO', 'NF_RECEBIDA'].includes(cause.code)) {
        error(res, 409, cause.code, 'A nota mudou ou a operacao ja foi utilizada.');
      }
      else if (['NF_OPERACAO_INVALIDA', 'NF_INVALIDA', 'NF_IDENTIDADE_ALTERADA'].includes(cause.code)) {
        error(res, 400, cause.code, 'Dados da nota invalidos.');
      }
      else if (['ESTOQUE_OPERACAO_INVALIDA', 'ESTOQUE_MOVIMENTO_INVALIDO'].includes(cause.code)) {
        error(res, 400, cause.code, 'Dados de estoque invalidos.');
      }
      else if (['ESTOQUE_CONFLITO_VERSAO', 'ESTOQUE_CONFLITO_IDEMPOTENCIA', 'ESTOQUE_SALDO_INSUFICIENTE'].includes(cause.code)) {
        error(res, 409, cause.code, 'O movimento conflita com os dados atuais do estoque.');
      }
      else if (cause.status) error(res, cause.status, cause.code, 'Solicitação inválida.');
      else error(res, 503, 'CORE_INDISPONIVEL', 'O Core de homologação não conseguiu consultar os dados.');
    }
    return true;
  };
}

module.exports = { createPreview };
