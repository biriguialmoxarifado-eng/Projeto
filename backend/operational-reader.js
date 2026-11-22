'use strict';

const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const { AuthorizationManager } = require('../core/security/authorization-manager');
const { readBody, reply } = require('./diagnostic-api');

const text = value => String(value ?? '').trim();
const normalized = value => text(value).toLowerCase();
const number = value => Number(text(value).replace(/\.(?=\d{3}(?:[.,]|$))/g, '').replace(',', '.')) || 0;
const sha256 = value => createHash('sha256').update(value, 'utf8').digest('hex');
const userFields = ['id', 'nome', 'email', 'matricula', 'login', 'cargo', 'setor', 'obra', 'status'];
const select = (row, keys) => Object.fromEntries(keys.map(key => [key, row[key] ?? '']));
const ttl = 15 * 60 * 1000;

function createOperationalReader(provider) {
  const cache = new Map();
  const sessions = new Map();
  const allowed = {
    dashboard: ['mural'], estoque: ['listar', 'item', 'movimentacoes'],
    usuarios: ['listar', 'obter', 'contar', 'fotoEpi'], epi: ['fichas', 'listar', 'indice', 'detalhe'], itens: ['listar', 'obter'], obras: ['listar']
  };
  const authorizationProvider = new AuthorizationManager();
  authorizationProvider.registerRole('administrator', Object.keys(allowed).map(name => name + ':read'));
  let failures = 0;
  let resetAt = 0;
  let authenticating = 0;

  function rows(name, required) {
    const entry = cache.get(name);
    if (entry && entry.until > Date.now()) return entry.result;
    const range = encodeURIComponent("'" + name + "'!A:Z");
    const result = provider.request(provider.spreadsheetId, '/values/' + range + '?valueRenderOption=FORMATTED_VALUE')
      .then(({ values = [] }) => {
        const headers = values[0] ?? [];
        if (!required.every(key => headers.filter(header => header === key).length === 1)) {
          throw new Error('Cabeçalho incompatível.');
        }
        return values.slice(1).filter(row => row.some(value => text(value))).map(row =>
          Object.fromEntries(headers.filter(header => typeof header === 'string' && header)
            .map(header => [header, row[headers.indexOf(header)] ?? ''])));
      }).catch(error => { if (cache.get(name)?.result === result) cache.delete(name); throw error; });
    cache.set(name, { until: Date.now() + 15000, result });
    return result;
  }
  const users = () => rows('USUARIOS', ['id', 'nome', 'email', 'senha_hash', 'perfil', 'status']);
  const items = () => rows('ALMOXA_ITENS', ['sku', 'descricao', 'estoqueAtual']);
  const works = () => rows('ALMOXA_OBRAS', ['id', 'nome']);
  const epi = () => rows('ALMOXA_EPI_FICHAS', ['id', 'matricula', 'colaborador', 'sku', 'item']);
  const isAdmin = user => user && text(user.id) && normalized(user.status) === 'ativo' &&
    ['administrador', 'admin'].includes(normalized(user.perfil)) &&
    !['false', 'não', 'nao', '0', 'bloqueado'].includes(normalized(user.acesso_desktop));
  const sessionProvider = {
    async validate(token) {
      if (typeof token !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(token)) return { valid: false };
      const key = sha256(token);
      const record = sessions.get(key);
      if (!record || record.expires <= Date.now()) {
        sessions.delete(key);
        return { valid: false };
      }
      const matches = (await users()).filter(user => text(user.id) === record.userId);
      if (matches.length !== 1 || !isAdmin(matches[0])) {
        sessions.delete(key);
        return { valid: false };
      }
      return { valid: true, session: { userId: record.userId, role: 'administrator', status: 'ACTIVE' } };
    }
  };
  const ok = (res, dados) => reply(res, 200, { ok: true, dados });
  const fail = (res, status, codigo, mensagem) => reply(res, status, { ok: false, codigo, mensagem });
  const publicUser = user => ({ ...select(user, userFields), perfil: normalized(user.perfil) === 'administrador' ? 'admin' : normalized(user.perfil) });
  const stockItem = row => {
    const estoque = text(row.estoqueAtual) ? number(row.estoqueAtual) : null;
    const minimo = number(row.estoqueMinimo);
    return { ...select(row, ['sku', 'descricao', 'categoria', 'unidade', 'ca', 'codigoBarras']), id: row.sku,
      codigo: row.sku, nome: row.descricao, local: row.localizacao || '', estoque, estoqueAtual: estoque, minimo,
      preco: number(row.valorUnitario), valorUnitario: number(row.valorUnitario), reservado: null, disponivel: null,
      status: estoque === null ? 'desconhecido' : estoque <= 0 ? 'critico' : estoque < minimo ? 'atencao' : 'ok' };
  };

  return {
    security: { authorizationProvider, sessionProvider, auditProvider: { record() {} } },
    async handle(core, req, res) {
      const sessionPath = req.url === '/api/v2/preview/session';
      if (!sessionPath && req.url !== '/api/v2/preview/dispatch') return false;
      const token = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization || '')?.[1];
      try {
        if (sessionPath && req.method === 'DELETE') {
          if (token) sessions.delete(sha256(token));
          ok(res, {});
          return true;
        }
        if (req.method !== 'POST') {
          fail(res, 405, 'METODO_INVALIDO', 'Use POST.');
          return true;
        }
        if (sessionPath) {
          const { usuario, senha, metodo } = await readBody(req, 2048);
          if (Date.now() >= resetAt) { failures = 0; resetAt = Date.now() + 60000; }
          if (failures >= 8 || authenticating >= 2) {
            fail(res, 429, 'TENTATIVAS_LIMITADAS', 'Aguarde antes de tentar novamente.');
            return true;
          }
          if (typeof usuario !== 'string' || usuario.length > 254 || !usuario.trim() ||
              typeof senha !== 'string' || !senha || senha.length > 256 || (metodo && metodo !== 'senha')) {
            fail(res, 400, 'CREDENCIAIS_INVALIDAS', 'Use e-mail ou matrícula e senha.');
            return true;
          }
          authenticating++;
          let matches;
          try {
            matches = (await users()).filter(user => [user.email, user.matricula, user.login]
              .some(value => normalized(value) === normalized(usuario)));
          } finally {
            authenticating--;
          }
          const user = matches.length === 1 ? matches[0] : null;
          const stored = /^[\da-f]{64}$/i.test(text(user?.senha_hash)) ? text(user.senha_hash) : '0'.repeat(64);
          const passwordOk = timingSafeEqual(Buffer.from(stored, 'hex'), Buffer.from(sha256(senha), 'hex'));
          if (!passwordOk || !isAdmin(user)) {
            failures++;
            fail(res, 401, 'CREDENCIAIS_INVALIDAS', 'Usuário, senha ou acesso administrativo inválidos.');
            return true;
          }
          for (const [key, value] of sessions) if (value.expires <= Date.now()) sessions.delete(key);
          if (sessions.size >= 64) {
            fail(res, 429, 'SESSOES_LIMITADAS', 'Limite de sessões atingido.');
            return true;
          }
          const newToken = randomBytes(32).toString('base64url');
          const expires = Date.now() + ttl;
          sessions.set(sha256(newToken), { userId: text(user.id), expires });
          ok(res, { usuario: publicUser(user), sessao: { token: newToken, expira: expires } });
          return true;
        }
        const { modulo, acao, payload = {} } = await readBody(req);
        if (!Object.hasOwn(allowed, modulo) || !allowed[modulo].includes(acao)) {
          fail(res, 403, 'OPERACAO_INDISPONIVEL', 'Operação indisponível no Core em modo de leitura.');
          return true;
        }
        await core.authorizeSession(token, modulo + ':read');
        let data;
        if (modulo === 'dashboard') {
          const [products, people, fichas] = await Promise.all([items(), users(), epi()]);
          data = { coreOperational: true, itens: products.filter(row => text(row.sku)).length,
            colaboradores: people.filter(row => normalized(row.status) === 'ativo').length, fichasEpi: fichas.length };
        } else if (modulo === 'estoque' && acao === 'movimentacoes') {
          data = (await rows('ALMOXA_MOVIMENTACOES', ['id', 'sku', 'qtd']))
            .map(row => ({ ...select(row, ['id', 'data', 'tipo', 'sku', 'descricao', 'saldo', 'obra', 'documento', 'usuario']),
              qtd: number(row.qtd), valorUnitario: text(row.valorUnitario) ? number(row.valorUnitario) : null }));
        } else if (modulo === 'estoque' || modulo === 'itens') {
          const list = (await items()).filter(row => text(row.sku)).map(stockItem);
          const term = normalized(payload?.busca);
          data = ['item', 'obter'].includes(acao) ? list.find(row => row.sku === (payload?.sku || payload?.id)) ?? null :
            term ? list.filter(row => [row.sku, row.nome, row.codigoBarras].some(value => normalized(value).includes(term))) : list;
        } else if (modulo === 'usuarios' && acao === 'fotoEpi') {
          const candidates = (await users()).filter(row => text(row.id) && text(row.id) === text(payload?.id));
          const source = candidates.length === 1 ? text(candidates[0].foto) : '';
          // URLs externas e conteúdo ativo (por exemplo SVG) nunca são entregues.
          const image = source.length <= 1400000 && /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(source);
          let foto = image ? source : null;
          if (!foto && source.length <= 500) {
            let fileId;
            try {
              const url = new URL(source);
              if (url.protocol === 'https:' && url.hostname === 'drive.google.com' && !url.username && !url.password) {
                fileId = /^\/file\/d\/([\w-]+)(?:\/|$)/.exec(url.pathname)?.[1] ||
                  (['/uc', '/open'].includes(url.pathname) ? url.searchParams.get('id') : null);
              }
            } catch { /* Cadastro sem uma URL de Drive reconhecida. */ }
            if (fileId && /^[\w-]{10,200}$/.test(fileId)) {
              try {
                const { GoogleDriveProvider } = require('../database/adapters/google-drive-provider');
                foto = await new GoogleDriveProvider().readImage(fileId);
              } catch {
                ok(res, { foto: null, estado: 'FOTO_INDISPONIVEL' });
                return true;
              }
            }
          }
          data = { foto };
        } else if (modulo === 'usuarios') {
          const list = (await users()).filter(row => text(row.id)).map(publicUser);
          data = acao === 'listar' ? list : acao === 'contar' ? { total: list.length } :
            list.find(row => [row.id, row.matricula, row.email].some(value => text(value) && normalized(value) === normalized(payload?.id || payload?.matricula || payload?.email))) ?? null;
        } else if (modulo === 'obras') {
          data = (await works()).map(row => select(row, ['id', 'nome', 'almoxarifado', 'status']));
        } else {
          const people = new Map();
          for (const user of await users()) {
            const matricula = text(user.matricula);
            if (!matricula || !text(user.id)) continue;
            people.set(matricula, people.has(matricula) ? null : user);
          }
          const groups = new Map();
          for (const row of await epi()) {
            const matricula = text(row.matricula);
            if (!matricula) continue;
            const user = people.get(matricula);
            const key = user ? 'u:' + text(user.id) : 'm:' + matricula;
            const ficha = groups.get(key) ?? { id: row.id, chave: key, usuarioId: user ? text(user.id) : null,
              matricula, colaborador: user?.nome || row.colaborador,
              cargo: row.cargo, setor: row.setor, status: row.status, itens: [] };
            ficha.itens.push(select(row, ['id', 'sku', 'item', 'qtd', 'ca', 'entrega', 'validade', 'status']));
            groups.set(key, ficha);
          }
          if (acao === 'detalhe') {
            data = groups.get(text(payload?.chave)) ?? null;
          } else if (acao === 'indice') {
            data = [...groups.values()].map(({ itens, ...ficha }) => ({
              ...ficha, total: itens.length, materiais: [...new Set(itens.flatMap(item => [item.sku, item.item]).filter(Boolean))].join(' ')
            }));
          } else {
            data = [...groups.values()];
          }
        }
        ok(res, data);
      } catch (error) {
        if (error.code === 'SESSION_INVALID') fail(res, 401, 'SEM_SESSAO', 'Entre novamente.');
        else if (error.code === 'ACCESS_DENIED') fail(res, 403, 'ACESSO_NEGADO', 'Operação sem permissão.');
        else if (error.status) fail(res, error.status, 'REQUISICAO_INVALIDA', 'Solicitação inválida.');
        else fail(res, 503, 'DADOS_INDISPONIVEIS', 'Não foi possível ler os dados do Google Sheets.');
      }
      return true;
    }
  };
}

module.exports = { createOperationalReader };
