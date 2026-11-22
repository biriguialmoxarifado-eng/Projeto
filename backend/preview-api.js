'use strict';

const { readFileSync } = require('node:fs');
const { randomBytes } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { join } = require('node:path');
const { reply, readBody } = require('./diagnostic-api');

function createPreview(runtime, root, { allowWrite = false, modulesAvailable = true, operational, desktopLocal } = {}) {
  const epiWrites = new Set(['entregarEstoque', 'devolverEstoque', 'estornarEstoque']);
  const catalogKinds = new Set(['itens', 'fornecedores', 'categorias']);
  const adminWrites = new Set([...catalogKinds, 'config', 'obras', 'usuarios']);
  const flowWrites = new Map([['compras', new Set(['precompra', 'alterarStatus', 'pedido'])],
    ['solicitacoes', new Set(['criar'])], ['aprovacoes', new Set(['decidirItens'])],
    ['retiradas', new Set(['confirmar'])],
    ['ferramentas', new Set(['salvar', 'retirar', 'devolver', 'retornarManutencao'])],
    ['inventario', new Set(['criar', 'registrarContagem', 'encerrar'])],
    ['recebimento', new Set(['requisitar', 'comprar', 'receber'])],
    ['notificacoes', new Set(['marcarLida'])]]);
  const read = new Map([
    ['nf', ['listar', 'obter', 'itens', ...(allowWrite ? ['salvar'] : [])]],
    ['nfed', allowWrite ? ['atualizar'] : []],
    ['recebimento', ['consultar', ...flowWrites.get('recebimento')]],
    ['compras', ['listar', 'precompras', 'pedidos', ...flowWrites.get('compras')]],
    ['solicitacoes', ['listar', ...flowWrites.get('solicitacoes')]],
    ['estoque', ['listar', 'item', 'movimentacoes', 'saldo', ...(allowWrite ? ['movimentar'] : [])]],
    ['itens', ['listar', 'obter', 'salvar']],
    ['fornecedores', ['listar', 'porCnpj', 'salvar']],
    ['categorias', ['listar', 'salvar']],
    ['obras', ['listar', 'salvar']],
    ['usuarios', ['listar', 'contar', 'obter', ...(desktopLocal ? ['salvar'] : [])]],
    ['config', ['obter', 'salvar']],
    ['auditoria', ['listar']],
    ['ocorrencias', ['listar', 'obter', ...(allowWrite ? ['criar', 'salvar'] : [])]],
    ['notificacoes', ['listar', ...flowWrites.get('notificacoes')]],
    ['kits', ['listar', 'obter', 'doPerfil']],
    ['calendario', ['listar']],
    ['centros', ['listar']],
    ['projetos', ['listar', 'obter', 'detalhe']],
    ['relatorios', ['listar', 'obter', 'gerados']],
    ['mural', ['listar', 'obter']],
    ['painel', ['carregar']],
    ['dashboard', ['mural']],
    ['automacao', ['regras']],
    ['ferramentas', ['listar', 'obter', 'historico', ...flowWrites.get('ferramentas')]],
    ['epi', ['listar', 'fichas', 'obter', 'historicoEstoque', ...(allowWrite ? [...epiWrites] : [])]],
    ['manutencao', ['status', 'versoes', 'backups']],
    ['aprovacoes', ['listar', 'pendentes', 'porPerfil', ...flowWrites.get('aprovacoes')]],
    ['retiradas', ['itensLiberados', ...flowWrites.get('retiradas')]],
    ['biometria', ['status']],
    ['ocr', ['disponivel', ...(allowWrite ? ['ler'] : [])]],
    ['lojinha', ['catalogo', 'item']],
    ['inventario', ['listar', 'obter', 'divergencias', ...flowWrites.get('inventario')]]
  ]);
  const files = {
    // A raiz abre o Desktop: quem sobe o Core V2 digita o endereço e usa
    // o sistema, sem precisar saber de caminho de homologação.
    '/': 'index.html',
    '/homologacao/desktop': 'index.html',
    '/homologacao/campo': 'ALMOXA_CAMPO.html.html',
    '/campo': 'ALMOXA_CAMPO.html.html'
  };
  const desktopScripts = new Map(["ALMOXA PRO — MÓDULO DE SINCRONIZAÇÃO E RENDERIZAÇÃO VISUAL.js","ALMOX-PRO — BOOTSYNC.js","ALMOX-PRO — MOTOR DE LEITURA DE NOTA FISCAL.js"].map(name => [encodeURIComponent(name), name]));
  const client = readFileSync(join(__dirname, 'preview-client.js'));
  const guard = (write, desktop) => '<script src="/homologacao/preview-client.js"' + (write ? ' data-write="1"' : '') +
    (operational ? ' data-operational="1"' : '') + (desktop ? ' data-desktop="1"' : '') + '></script>';
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
    if (operational && await operational.handle(runtime.core, req, res)) return true;
    if (req.url === '/api/v2/preview/session') {
      let token = bearer(req);
      if (req.method === 'DELETE') {
        sessions.delete(token);
        reply(res, 200, { ok: true });
        return true;
      }
      if (req.method !== 'POST') {
        error(res, 405, 'METODO_INVALIDO', 'Método de sessão inválido.');
        return true;
      }
      const desktop = Boolean(desktopLocal && !token);
      let actor;
      try {
        if (desktop) {
          const { usuario, senha, metodo } = await readBody(req, 2048);
          if (typeof usuario !== 'string' || typeof senha !== 'string' || (metodo && metodo !== 'senha')) throw new Error();
          token = senha;
          actor = await runtime.core.getSession(token);
          if (!actor?.userId || String(actor.userId).toLowerCase() !== usuario.trim().toLowerCase()) throw new Error();
        }
        await runtime.core.authorizeSession(token, 'preview:session');
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
      const expires = now + ttlMs;
      sessions.set(id, { token, expires, desktop, invoiceVersions: new Map() });
      const data = desktop ? {
        usuario: { id: actor.userId, nome: actor.userId, perfil: actor.role === 'operator' ? 'admin' : 'almoxarife' },
        sessao: { token: id, expira: expires }, obra: { id: desktopLocal, nome: desktopLocal },
        podeGravar: allowWrite && actor.role === 'operator'
      } : { token: id, expiraEm: expires };
      reply(res, 200, { ok: true, dados: data });
      return true;
    }
    if (req.method === 'GET' && Object.hasOwn(files, req.url)) {
      const html = readFileSync(join(root, files[req.url]), 'utf8');
      const desktopScript = '<script src="./backend/preview-client.js" data-deployment="pages"></script>';
      const page = html.includes(desktopScript)
        ? html.replace(desktopScript, guard(allowWrite, desktopLocal && !req.url.endsWith('/campo')))
        : html.replace(/<head[^>]*>/i, tag => tag + '<meta name="almoxa-core-v2">' + guard(false));
      res.writeHead(200, pageHeaders).end(page);
      return true;
    }
    if (req.method === 'GET' && req.url === '/homologacao/preview-client.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' }).end(client);
      return true;
    }
    const script = desktopScripts.get(req.url.replace(/^\/(?:homologacao\/)?/, ''));
    if (req.method === 'GET' && script) {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store' }).end(readFileSync(join(root, script)));
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
    if (!modulesAvailable) {
      error(res, 503, 'ARMAZENAMENTO_OPERACIONAL_INDISPONIVEL', 'Configure a planilha de teste ou o SQLite isolado desta homologação.');
      return true;
    }
    const { token } = session;
    try {
      await runtime.core.authorizeSession(token, 'preview:session');
      const { modulo, acao, payload = {} } = await readBody(req, upload ? 1450000 : 8192);
      if (!allowWrite && ((acao === 'salvar' && adminWrites.has(modulo)) || flowWrites.get(modulo)?.has(acao))) {
        error(res, 403, 'ACESSO_NEGADO', 'Gravação desativada nesta homologação.');
        return true;
      }
      if (!allowWrite && modulo === 'epi' && epiWrites.has(acao)) {
        error(res, 403, 'ACESSO_NEGADO', 'Gravações de EPI indisponíveis nesta homologação.');
        return true;
      }
      if (!read.get(modulo)?.includes(acao) || (upload !== (modulo === 'ocr' && acao === 'ler')) || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
        error(res, 400, 'OPERACAO_FORA_DA_HOMOLOGACAO', 'Operação indisponível no ambiente de homologação.');
        return true;
      }
      if (modulo === 'usuarios' && acao === 'salvar' && !session.desktop) {
        error(res, 403, 'ACESSO_NEGADO', 'Use a sessão do Desktop V2 local.');
        return true;
      }
      if (session.desktop && ['estoque', 'lojinha', 'epi'].includes(modulo)) {
        if (payload.local !== undefined && payload.local !== desktopLocal) {
          error(res, 403, 'ACESSO_NEGADO', 'Local fora da sessão do Desktop.');
          return true;
        }
        payload.local = desktopLocal;
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
      else if (modulo === 'recebimento') {
        const receiving = runtime.getReceivingEngine();
        let entry;
        if (acao === 'consultar') entry = await receiving.consultar(token, payload.id);
        else {
          await runtime.core.authorizeSession(token, 'receiving:write');
          if (acao === 'receber' && (typeof payload.local !== 'string' || !/^[\w-]{1,80}$/.test(payload.local))) {
            error(res, 400, 'RECEBIMENTO_LOCAL_INVALIDO', 'Informe o local de entrada no estoque.');
            return true;
          }
          const input = acao === 'requisitar' ? { ...payload, solicitante: (await runtime.core.getSession(token))?.userId } : payload;
          entry = await receiving[acao](token, input);
        }
        if (!entry) {
          error(res, 404, 'REQUISICAO_NAO_ENCONTRADA', 'Requisição não localizada.');
          return true;
        }
        result = { ok: true, dados: entry.note, versaoCore: entry.version };
      }
      else if (modulo === 'estoque') {
        const stock = runtime.getStockEngine();
        if (acao === 'listar' || acao === 'item') {
          result = await runtime.getShopEngine()(token, acao === 'listar' ? 'estoque' : 'item', payload);
        } else if (acao === 'movimentacoes') result = await stock.movimentacoes(token, payload);
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
      else if (modulo === 'compras') {
        const purchases = runtime.getPurchaseEngine();
        if (acao === 'precompra') result = await purchases.precompra(token, payload);
        else if (acao === 'pedido') result = await purchases.pedido(token, payload);
        else if (acao === 'alterarStatus') result = await purchases.alterarStatus(token, payload);
        else result = await purchases.consultarLegado(token, acao, payload);
      }
      else if (modulo === 'solicitacoes') {
        const requests = runtime.getRequestEngine();
        result = acao === 'criar' ? await requests.criar(token, payload) : await requests.listar(token);
      }
      else if (modulo === 'dashboard') {
        if (session.desktop) {
          const [stock, history] = await Promise.all([
            runtime.getShopEngine()(token, 'estoque', { local: desktopLocal }),
            runtime.getStockEngine().historicoEpi(token)
          ]);
          result = { ok: true, dados: { coreDesktop: true, itens: stock.dados.length,
            entregas: history.filter(event => event.local === desktopLocal && event.kind === 'entrega').length } };
        } else {
          const panel = await runtime.getAdministrationEngine().painel(token, 'carregar');
          result = { ok: true, dados: panel.dados ?? {} };
        }
      }
      else if (modulo === 'epi' && ['entregarEstoque', 'devolverEstoque', 'estornarEstoque', 'historicoEstoque'].includes(acao)) {
        const stock = runtime.getStockEngine();
        if (acao === 'historicoEstoque') {
          const history = await stock.historicoEpi(token, payload.usuarioId);
          result = { ok: true, dados: session.desktop ? history.filter(event => event.local === desktopLocal) : history };
        } else {
          const { sku, local, quantidade, operacaoCore, versaoCore, original, usuarioId } = payload;
          const [action, kind] = {
            entregarEstoque: ['saida', 'entrega'], devolverEstoque: ['devolucao', 'devolucao'],
            estornarEstoque: ['estorno', 'estorno']
          }[acao];
          if (typeof sku !== 'string' || !/^SYN-[a-zA-Z0-9-]+$/.test(sku)) {
            error(res, 400, 'EPI_MOVIMENTO_INVALIDO', 'Use um SKU sintético.');
            return true;
          }
          const entry = await stock.movimentar(token, { sku, local, quantidade, original, action,
            operation: operacaoCore, version: versaoCore, epi: { kind, usuarioId } });
          result = { ok: true, dados: { operacaoCore: entry.operation, versaoCore: entry.version, ...entry.epi } };
        }
      }
      else if (modulo === 'epi' && ['listar', 'fichas', 'obter'].includes(acao)) {
        result = await runtime.getAdministrationEngine().epi(token, acao, payload);
        if (acao !== 'obter' || !result.ok) {
          const all = await runtime.getStockEngine().historicoEpi(token);
          const linked = all.map(event => ({ id: event.operation, colaborador: event.colaborador,
            matricula: event.matricula, sku: event.sku, item: event.sku, qtd: event.quantidade,
            entrega: event.at, entreguePor: event.actor, status: event.kind.toUpperCase(),
            local: event.local, original: event.original }));
          if (acao === 'obter') {
            const item = linked.find(record => record.id === payload.id);
            if (item) result = { ok: true, dados: item };
          } else if (result.ok) {
            result = { ...result, dados: [...result.dados, ...linked.filter(row =>
              !payload.status || row.status === payload.status)] };
          }
        }
      }
      else if (modulo === 'auditoria') result = await runtime.getAdministrationEngine().auditoria(token, acao, payload);
      else if (modulo === 'usuarios') result = await runtime.getAdministrationEngine().usuarios(token, acao, payload);
      else if (catalogKinds.has(modulo) && acao === 'salvar') {
        if (session.desktop && modulo === 'itens' && !/^SYN-[a-zA-Z0-9-]+$/.test(payload.data?.sku ?? '')) {
          error(res, 400, 'CADASTRO_DADOS_INVALIDOS', 'Use um SKU que comece com SYN-.');
          return true;
        }
        const event = await runtime.getCatalogEngine().salvar(token, modulo, payload);
        result = { ok: true, dados: event.note, versaoCore: event.version, operacaoCore: event.operation };
      }
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
      else if (cause.code === 'USUARIO_NAO_ENCONTRADO') error(res, 404, cause.code, 'Usuário não localizado.');
      else if (cause.code === 'USUARIO_DUPLICADO') error(res, 409, cause.code, 'Matrícula já cadastrada.');
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
      else if (cause.code === 'EPI_REVERSAO_INVALIDA') error(res, 409, cause.code, 'Entrega já revertida ou incompatível.');
      else if (['EPI_MOVIMENTO_INVALIDO', 'EPI_COLABORADOR_INVALIDO'].includes(cause.code)) error(res, 400, cause.code, 'Dados de EPI inválidos.');
      else if (['CADASTRO_CONFLITO_VERSAO', 'CADASTRO_CONFLITO_IDEMPOTENCIA', 'CATEGORIA_DUPLICADA'].includes(cause.code)) {
        error(res, 409, cause.code, 'Cadastro em conflito com a versão armazenada.');
      }
      else if (['CADASTRO_OPERACAO_INVALIDA', 'CADASTRO_DADOS_INVALIDOS', 'CONFIG_VALOR_INVALIDO', 'CONFIG_CHAVE_NAO_SUPORTADA', 'OBRA_DADOS_INVALIDOS'].includes(cause.code)) {
        error(res, 400, cause.code, 'Dados de cadastro inválidos.');
      }
      else if (cause.code === 'OBRA_NAO_ENCONTRADA') error(res, 404, cause.code, 'Obra não localizada.');
      else if (['COMPRA_CONFLITO_IDEMPOTENCIA', 'COMPRA_CONFLITO_VERSAO', 'PRECOMPRA_INCOMPATIVEL',
        'SOLICITACAO_CONFLITO_IDEMPOTENCIA'].includes(cause.code)) {
        error(res, 409, cause.code, 'Operação já usada ou versão desatualizada.');
      }
      else if (['COMPRA_DADOS_INVALIDOS', 'SOLICITACAO_INVALIDA', 'SOLICITACAO_ITENS_INVALIDOS'].includes(cause.code)) {
        error(res, 400, cause.code, 'Dados de fluxo inválidos.');
      }
      else if (['PRECOMPRA_NAO_ENCONTRADA', 'ITEM_NAO_ENCONTRADO'].includes(cause.code)) {
        error(res, 404, cause.code, 'Registro de compra ou item não localizado.');
      }
      else if (cause.code === 'RESERVA_NAO_ENCONTRADA') error(res, 404, cause.code, 'Reserva não localizada.');
      else if (['RESERVA_NAO_APROVADA', 'RETIRADA_ACIMA_DO_PENDENTE', 'RETIRADA_LOCAL_NAO_INFORMADO', 'RETIRADA_ITEM_AMBIGUO'].includes(cause.code)) {
        error(res, 409, cause.code, 'A retirada não é compatível com a reserva atual.');
      }
      else if (cause.code === 'RETIRADA_INVALIDA') error(res, 400, cause.code, 'Dados de retirada inválidos.');
      else if (['INVENTARIO_OPERACAO_INVALIDA', 'INVENTARIO_DADOS_INVALIDOS', 'INVENTARIO_CONTAGEM_INVALIDA',
        'SEM_DESCRICAO_DA_AVARIA', 'SEM_PATRIMONIO'].includes(cause.code)) {
        error(res, 400, cause.code, 'Dados da operação inválidos.');
      }
      else if (['ATIVIDADE_NAO_ENCONTRADA', 'FERRAMENTA_NAO_ENCONTRADA'].includes(cause.code)) {
        error(res, 404, cause.code, 'Registro não localizado.');
      }
      else if (cause.code === 'NOTIFICACAO_NAO_ENCONTRADA') error(res, 404, cause.code, 'Notificação não localizada.');
      else if (['RECEBIMENTO_OPERACAO_INVALIDA', 'REQUISICAO_INVALIDA', 'RECEBIMENTO_ITENS_INVALIDOS',
        'NF_ITEM_INVALIDO', 'CONFERENCIA_INVALIDA'].includes(cause.code)) {
        error(res, 400, cause.code, 'Dados de recebimento inválidos.');
      }
      else if (['RECEBIMENTO_CONFLITO_VERSAO', 'RECEBIMENTO_CONFLITO_IDEMPOTENCIA', 'COMPRA_INVALIDA',
        'CONFERENCIA_DIVERGENTE', 'NF_VERSAO_INVALIDA', 'NF_JA_VINCULADA'].includes(cause.code)) {
        error(res, 409, cause.code, 'Recebimento incompatível com os dados atuais.');
      }
      else if (['INVENTARIO_CONFLITO_VERSAO', 'INVENTARIO_CONFLITO_IDEMPOTENCIA', 'INVENTARIO_CONTAGEM_PENDENTE',
        'ATIVIDADE_CONFIRMADA', 'JA_EM_POSSE', 'FERRAMENTA_INDISPONIVEL', 'NAO_ESTA_EM_POSSE',
        'FERRAMENTA_FORA_MANUTENCAO'].includes(cause.code)) {
        error(res, 409, cause.code, 'Operação incompatível com o estado atual do registro.');
      }
      else if (cause.status) error(res, cause.status, cause.code, 'Solicitação inválida.');
      else error(res, 503, 'CORE_INDISPONIVEL', 'O Core de homologação não conseguiu consultar os dados.');
    }
    return true;
  };
}

module.exports = { createPreview };
