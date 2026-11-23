'use strict';

const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const { AuthorizationManager } = require('../core/security/authorization-manager');
const { readBody, reply } = require('./diagnostic-api');

const text = value => String(value ?? '').trim();
const normalized = value => text(value).toLowerCase();
const registration = value => normalized(value).replace(/^0+(?=\d+$)/, '');
const number = value => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const formatted = text(value).replace(/^R\$\s*/, '');
  if (!/^-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/.test(formatted)) return null;
  const parsed = Number(formatted.replaceAll('.', '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};
const sha256 = value => createHash('sha256').update(value, 'utf8').digest('hex');
const userFields = ['id', 'nome', 'email', 'matricula', 'login', 'cargo', 'setor', 'obra', 'status'];
const select = (row, keys) => Object.fromEntries(keys.map(key => [key, row[key] ?? '']));
const ttl = 15 * 60 * 1000;
const storageMessages = {
  PLANILHA_INCORRETA: 'O destino configurado não é a planilha operacional esperada.',
  PLANILHA_ESQUEMA_INVALIDO: 'Uma aba da planilha está ausente ou tem cabeçalhos incompatíveis.',
  GOOGLE_AUTH_FAILED: 'A autenticação Google do Core precisa ser configurada ou renovada.',
  GOOGLE_SHEETS_HTTP_401: 'O Google recusou a autenticação do Core.',
  GOOGLE_SHEETS_HTTP_403: 'O Google recusou o acesso do Core à planilha.',
  GOOGLE_SHEETS_HTTP_404: 'A planilha configurada está inacessível ou não foi encontrada.',
  GOOGLE_SHEETS_HTTP_429: 'O Google Sheets limitou temporariamente as consultas.',
  GOOGLE_SHEETS_UNAVAILABLE: 'O Core não conseguiu consultar o Google Sheets.'
};
const storageCode = error => Object.hasOwn(storageMessages, error?.code) ? error.code : 'GOOGLE_SHEETS_UNAVAILABLE';
const sheetError = code => Object.assign(new Error(storageMessages[code]), { code });

function createOperationalReader(provider, { expectedTitle, drive } = {}) {
  const cache = new Map();
  const sessions = new Map();
  const allowed = {
    dashboard: ['mural'], estoque: ['listar', 'item', 'movimentacoes'],
    usuarios: ['listar', 'obter', 'contar', 'fotoEpi'], epi: ['fichas', 'listar', 'indice', 'detalhe', 'assinaturas', 'foto'],
    itens: ['listar', 'obter', 'foto'],
    obras: ['listar'], lojinha: ['catalogo', 'item', 'foto']
  };
  const authorizationProvider = new AuthorizationManager();
  authorizationProvider.registerRole('administrator', Object.keys(allowed).map(name => name + ':read'));
  let failures = 0;
  let resetAt = 0;
  let authenticating = 0;
  let identity;
  let imageProvider = drive;
  let readLegacySignatures;

  function identify() {
    if (identity && identity.until > Date.now()) return identity.result;
    const result = provider.metadata(provider.spreadsheetId).then(data => {
      const title = text(data.properties?.title);
      if (data.spreadsheetId !== provider.spreadsheetId || !title || /^ALMOXA[_ -]TESTE(?:[_ -]|$)/i.test(title) ||
          (expectedTitle && title !== text(expectedTitle))) throw sheetError('PLANILHA_INCORRETA');
      return title;
    }).catch(error => { if (identity?.result === result) identity = undefined; throw error; });
    identity = { result, until: Date.now() + 60000 };
    return result;
  }

  function rows(name, required, sample = false) {
    const key = name + (sample ? ':sample' : '');
    const entry = cache.get(key);
    if (entry && entry.until > Date.now()) return entry.result;
    const range = encodeURIComponent("'" + name + (sample ? "'!A1:Z2" : "'!A:Z"));
    const result = identify().then(() => provider.request(provider.spreadsheetId, '/values/' + range + '?valueRenderOption=FORMATTED_VALUE'))
      .then(({ values = [] }) => {
        const headers = values[0] ?? [];
        if (!required.every(key => headers.filter(header => header === key).length === 1)) {
          throw sheetError('PLANILHA_ESQUEMA_INVALIDO');
        }
        return values.slice(1).filter(row => row.some(value => text(value))).map(row =>
          Object.fromEntries(headers.filter(header => typeof header === 'string' && header)
            .map(header => [header, row[headers.indexOf(header)] ?? ''])));
      }).catch(error => {
        if (cache.get(key)?.result === result) cache.delete(key);
        if (error.code === 'GOOGLE_SHEETS_HTTP_400') throw sheetError('PLANILHA_ESQUEMA_INVALIDO');
        throw error;
      });
    cache.set(key, { until: Date.now() + (sample ? 30000 : 15000), result });
    return result;
  }
  const users = sample => rows('USUARIOS', ['id', 'nome', 'email', 'senha_hash', 'perfil', 'status'], sample);
  const items = sample => rows('ALMOXA_ITENS', ['sku', 'descricao', 'estoqueAtual'], sample);
  const categories = sample => rows('ALMOXA_CATEGORIAS', ['nome', 'visivel'], sample);
  const works = () => rows('ALMOXA_OBRAS', ['id', 'nome']);
  const epi = () => rows('ALMOXA_EPI_FICHAS', ['id', 'matricula', 'colaborador', 'sku', 'item']);
  const badges = () => rows('ALMOXA_CRACHAS', ['codigo', 'matricula', 'foto']);
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
  function imageSource(id, value) {
    let source = text(value);
    if (source.length <= 1400000 && /^data:image\/(?:png|jpeg|webp|gif|avif);base64,[A-Za-z0-9+/]+={0,2}$/i.test(source)) return { inline: source };
    if (/^[\w-]{10,200}$/.test(text(id))) return { fileId: text(id) };
    if (!source || source.length > 500) return {};
    const formula = /^=IMAGE\(\s*"([^"]+)"(?:\s*[,;][\d\s,;]+)?\s*\)$/i.exec(source);
    if (formula) source = formula[1];
    try {
      const url = new URL(source);
      if (url.protocol === 'https:' && url.hostname === 'drive.google.com' && !url.username && !url.password) {
        const fileId = /^\/file\/d\/([\w-]+)(?:\/|$)/.exec(url.pathname)?.[1] ||
          (['/uc', '/open', '/thumbnail'].includes(url.pathname) ? url.searchParams.get('id') : null);
        if (/^[\w-]{10,200}$/.test(fileId ?? '')) return { fileId };
      }
    } catch { /* Sem endereço de imagem reconhecido. */ }
    return {};
  }
  function imageDrive() {
    const { GoogleDriveProvider } = require('../database/adapters/google-drive-provider');
    return imageProvider ??= new GoogleDriveProvider();
  }
  function itemSources(row) {
    return [imageSource(row.fotoDriveId, row.fotoUrl), imageSource(null, row.foto)].filter(source => source.inline || source.fileId);
  }
  async function image({ inline, fileId }) {
    if (inline) return { foto: inline };
    if (!fileId) return { foto: null };
    try {
      return { foto: await imageDrive().readImage(fileId) };
    } catch (error) {
      return { foto: null, estado: 'FOTO_INDISPONIVEL', codigo: /^GOOGLE_(?:DRIVE_[A-Z_\d]+|AUTH_FAILED)$/.test(error.code ?? '') ?
        error.code : 'GOOGLE_DRIVE_UNAVAILABLE' };
    }
  }
  async function firstPhoto(sources) {
    let result = { foto: null };
    for (const source of sources) {
      if (!source.inline && !source.fileId) continue;
      result = await image(source);
      if (result.foto) break;
    }
    return result;
  }
  async function personPhoto(user, allowRegistration) {
    const personal = await firstPhoto([imageSource(null, user.foto), imageSource(user.crachaFotoId, user.crachaFotoUrl)]);
    if (personal.foto || (!user.cracha && (!allowRegistration || !registration(user.matricula)))) return personal;
    const mat = registration(user.matricula);
    const candidates = (await badges()).filter(row => row.foto && (!mat || registration(row.matricula) === mat));
    const matches = user.cracha ? candidates.filter(row => normalized(row.codigo) === normalized(user.cracha)) : candidates;
    if (matches.length !== 1) return personal;
    return image(imageSource(null, matches[0].foto));
  }
  const stockItem = row => {
    const estoque = number(row.estoqueAtual);
    const minimo = number(row.estoqueMinimo);
    return { ...select(row, ['sku', 'descricao', 'categoria', 'unidade', 'ca', 'codigoBarras', 'marca']), id: row.sku,
      codigo: row.sku, nome: row.descricao, local: row.localizacao || '', estoque, estoqueAtual: estoque, minimo,
      preco: number(row.valorUnitario), valorUnitario: number(row.valorUnitario), reservado: null, disponivel: null,
      temFoto: itemSources(row).length > 0,
      status: estoque === null ? 'desconhecido' : estoque <= 0 ? 'critico' : minimo !== null && estoque < minimo ? 'atencao' : 'ok' };
  };

  return {
    security: { authorizationProvider, sessionProvider, auditProvider: { record() {} } },
    async connection() {
      try {
        await Promise.all([items(true), categories(true), users(true)]);
        return { provider: 'google-sheets', status: 'connected' };
      } catch (error) {
        const code = storageCode(error);
        return { provider: 'google-sheets', status: 'unavailable', code, message: storageMessages[code] };
      }
    },
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
        } else if (modulo === 'lojinha') {
          const [products, groups] = await Promise.all([items(), categories()]);
          const hidden = new Set(groups.filter(row => normalized(row.visivel) === 'false').map(row => normalized(row.nome)));
          const visible = products.filter(row => text(row.sku) && !hidden.has(normalized(row.categoria)));
          if (acao === 'catalogo') {
            const term = normalized(payload?.busca);
            const group = normalized(payload?.categoria);
            data = visible.filter(row => (!group || group === 'todas' || normalized(row.categoria) === group) &&
              (!term || [row.sku, row.descricao, row.codigoBarras, row.marca].some(value => normalized(value).includes(term))))
              .map(stockItem);
          } else {
            const product = visible.find(row => text(row.sku) === text(payload?.sku || payload?.id));
            data = acao === 'foto' ? await firstPhoto(product ? itemSources(product) : []) : product ? stockItem(product) : null;
          }
        } else if (modulo === 'estoque' && acao === 'movimentacoes') {
          data = (await rows('ALMOXA_MOVIMENTACOES', ['id', 'sku', 'qtd']))
            .map(row => ({ ...select(row, ['id', 'data', 'tipo', 'sku', 'descricao', 'saldo', 'obra', 'documento', 'usuario']),
              qtd: number(row.qtd), valorUnitario: number(row.valorUnitario) }));
        } else if (modulo === 'itens' && acao === 'foto') {
          const matches = (await items()).filter(row => text(row.sku) && text(row.sku) === text(payload?.sku));
          data = await firstPhoto(matches.length === 1 ? itemSources(matches[0]) : []);
        } else if (modulo === 'estoque' || modulo === 'itens') {
          const list = (await items()).filter(row => text(row.sku)).map(stockItem);
          const term = normalized(payload?.busca);
          data = ['item', 'obter'].includes(acao) ? list.find(row => row.sku === (payload?.sku || payload?.id)) ?? null :
            term ? list.filter(row => [row.sku, row.nome, row.codigoBarras].some(value => normalized(value).includes(term))) : list;
        } else if (modulo === 'usuarios' && acao === 'fotoEpi') {
          const directory = await users();
          const candidates = directory.filter(row => text(row.id) && text(row.id) === text(payload?.id));
          const user = candidates.length === 1 ? candidates[0] : null;
          data = user ? await personPhoto(user, directory.filter(row => registration(row.matricula) === registration(user.matricula)).length === 1) : { foto: null };
        } else if (modulo === 'usuarios') {
          const list = (await users()).filter(row => text(row.id)).map(publicUser);
          data = acao === 'listar' ? list : acao === 'contar' ? { total: list.length } :
            list.find(row => [row.id, row.matricula, row.email].some(value => text(value) && normalized(value) === normalized(payload?.id || payload?.matricula || payload?.email))) ?? null;
        } else if (modulo === 'obras') {
          data = (await works()).map(row => select(row, ['id', 'nome', 'almoxarifado', 'status']));
        } else {
          const people = new Map();
          for (const user of await users()) {
            const matricula = registration(user.matricula);
            if (!matricula || !text(user.id)) continue;
            people.set(matricula, people.has(matricula) ? null : user);
          }
          const groups = new Map();
          for (const row of await epi()) {
            const matricula = text(row.matricula);
            if (!matricula) continue;
            const user = people.get(registration(matricula));
            const key = user ? 'u:' + text(user.id) : 'm:' + matricula;
            const ficha = groups.get(key) ?? { id: row.id, chave: key, usuarioId: user ? text(user.id) : null,
              matricula, colaborador: user?.nome || row.colaborador,
              cargo: row.cargo, setor: row.setor, status: row.status, itens: [] };
            const evidence = text(row.assinatura);
            ficha.itens.push({ ...select(row, ['id', 'sku', 'item', 'qtd', 'ca', 'entrega', 'validade', 'status']),
              confirmacao: evidence.length <= 160 && !/^(?:https?:|data:|=|ASS:)/i.test(evidence) ? evidence : '',
              temAssinatura: Boolean(imageSource(null, evidence).inline || imageSource(null, evidence).fileId) });
            groups.set(key, ficha);
          }
          if (acao === 'assinaturas') {
            const ficha = groups.get(text(payload?.chave));
            if (!ficha) data = null;
            else if (payload?.entregaId) {
              const id = text(payload.entregaId);
              const matches = (await epi()).filter(row => text(row.id) === id);
              data = await image(matches.length === 1 && ficha.itens.some(item => text(item.id) === id) ? imageSource(null, matches[0].assinatura) : {});
            } else {
              const { createLegacyEpiSignatures } = require('./legacy-epi-signatures');
              readLegacySignatures ??= createLegacyEpiSignatures(imageDrive(), imageSource);
              try { data = await readLegacySignatures(ficha); }
              catch { data = { rubricaCadastrada: null, entregas: [], estado: 'REPOSITORIO_INDISPONIVEL' }; }
            }
          } else if (acao === 'foto') {
            const ficha = groups.get(text(payload?.chave));
            const user = ficha && people.get(registration(ficha.matricula));
            data = ficha && ficha.usuarioId && text(user?.id) === ficha.usuarioId ? await personPhoto(user, true) : { foto: null };
          } else if (acao === 'detalhe') {
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
        else {
          const code = storageCode(error);
          fail(res, 503, code, storageMessages[code]);
        }
      }
      return true;
    }
  };
}

module.exports = { createOperationalReader };
