'use strict';
(() => {
  if (window.AlmoxaCorePreview) return;
  const script = document.currentScript;
  const remote = script?.dataset.deployment === 'pages';
  const operational = script?.dataset.operational === '1';
  const configured = remote ? document.querySelector('meta[name="almoxa-core-v2"]')?.content?.trim() : '';
  let origin = location.origin;
  if (remote) {
    try {
      const url = new URL(configured);
      if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' ||
          url.search || url.hash || /(?:^|\.)(?:google\.com|googleapis\.com|googleusercontent\.com)$/i.test(url.hostname)) {
        throw new Error('Invalid Core origin');
      }
      origin = url.origin;
    } catch {
      origin = null;
    }
    const policy = document.createElement('meta');
    policy.httpEquiv = 'Content-Security-Policy';
    policy.content = 'connect-src ' + (origin || "'none'");
    document.head.append(policy);
  }
  const endpoint = path => {
    if (!origin) throw new Error('Core origin unavailable');
    return origin + path;
  };
  const writeEnabled = !remote && script?.dataset.write === '1';
  const supported = new Map([
    ['nf', new Set(['listar', 'obter', 'itens', ...(writeEnabled ? ['salvar'] : [])])],
    ['nfed', new Set(writeEnabled ? ['atualizar'] : [])],
    ['compras', new Set(['listar', 'precompras', 'pedidos'])],
    ['estoque', new Set(['listar', 'item', 'movimentacoes', 'saldo', ...(writeEnabled ? ['movimentar'] : [])])],
    ['itens', new Set(['listar', 'obter'])],
    ['fornecedores', new Set(['listar', 'porCnpj'])],
    ['categorias', new Set(['listar'])],
    ['obras', new Set(['listar'])],
    ['usuarios', new Set(['listar', 'contar', 'obter', ...(operational ? ['fotoEpi'] : [])])],
    ['config', new Set(['obter'])],
    ['auditoria', new Set(['listar'])],
    ['ocorrencias', new Set(['listar', 'obter', 'criar', 'salvar'])],
    ['notificacoes', new Set(['listar'])],
    ['kits', new Set(['listar', 'obter', 'doPerfil'])],
    ['calendario', new Set(['listar'])],
    ['centros', new Set(['listar'])],
    ['projetos', new Set(['listar', 'obter', 'detalhe'])],
    ['relatorios', new Set(['listar', 'obter', 'gerados'])],
    ['mural', new Set(['listar', 'obter'])],
    ['painel', new Set(['carregar'])],
    ['dashboard', new Set(['mural'])],
    ['automacao', new Set(['regras'])],
    ['ferramentas', new Set(['listar', 'obter', 'historico'])],
    ['epi', new Set(['listar', 'fichas', 'obter', ...(operational ? ['indice', 'detalhe'] : []), ...(writeEnabled ? ['entregarEstoque', 'devolverEstoque', 'estornarEstoque', 'historicoEstoque'] : [])])],
    ['manutencao', new Set(['status', 'versoes', 'backups'])],
    ['aprovacoes', new Set(['listar', 'pendentes', 'porPerfil'])],
    ['retiradas', new Set(['itensLiberados'])],
    ['biometria', new Set(['status'])],
    ['ocr', new Set(['disponivel', ...(writeEnabled ? ['ler'] : [])])],
    ['lojinha', new Set(['catalogo', 'item'])],
    ['inventario', new Set(['listar', 'obter', 'divergencias'])]
  ]);
  const unavailable = () => ({ ok: false, codigo: 'CORE_V2_SEM_ENDERECO',
    mensagem: 'Configure o endereco HTTPS do Core V2 para abrir a sessao.' });
  let token = '';
  let session = new AbortController();
  const pending = new Map();
  window.AlmoxaCorePreview = {
    operational,
    epiProgressive: operational,
    async logout() {
      const previous = token;
      token = '';
      session.abort();
      session = new AbortController();
      pending.clear();
      if (previous) {
        await fetch(endpoint('/api/v2/preview/session'), { method: 'DELETE', credentials: 'omit', redirect: 'error',
          headers: { Authorization: 'Bearer ' + previous }, signal: AbortSignal.timeout(5000) }).catch(() => {});
      }
    },
    async login(value) {
      if (!origin) return unavailable();
      await this.logout();
      const active = session;
      const identifier = typeof value === 'string' ? value.trim() : '';
      if (!identifier) return { ok: false, mensagem: 'Informe a credencial de homologação.' };
      try {
        const response = await fetch(endpoint('/api/v2/preview/session'), { method: 'POST', credentials: 'omit', redirect: 'error',
          headers: { Authorization: 'Bearer ' + identifier },
          signal: AbortSignal.any([active.signal, AbortSignal.timeout(5000)]) });
        const result = await response.json();
        if (active === session && result.ok) token = result.dados.token;
        return result;
      } catch {
        return { ok: false, mensagem: 'O Core de homologação não respondeu.' };
      }
    },
    call(module, action, payload) {
      if (!origin) return Promise.resolve(unavailable());
      if (operational && module === 'auth' && action === 'login') {
        return (async () => {
          await this.logout();
          const active = session;
          try {
            const response = await fetch(endpoint('/api/v2/preview/session'), {
              method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
              signal: AbortSignal.any([active.signal, AbortSignal.timeout(20000)])
            });
            const result = await response.json();
            if (active !== session) return { ok: false, mensagem: 'Tentativa substituída.' };
            if (result.ok) token = result.dados.sessao.token;
            return result;
          } catch {
            return { ok: false, codigo: 'CORE_INDISPONIVEL', mensagem: 'O Core Node não respondeu.' };
          }
        })();
      }
      if (operational && module === 'auth' && action === 'logout') {
        return this.logout().then(() => ({ ok: true }));
      }
      if (!supported.get(module)?.has(action)) {
        return Promise.resolve({ ok: false, codigo: 'OPERACAO_FORA_DA_HOMOLOGACAO', mensagem: 'Operação indisponível no ambiente de homologação.' });
      }
      if (!token) return Promise.resolve({ ok: false, codigo: 'SEM_SESSAO', mensagem: 'Informe a credencial de homologação.' });
      const body = JSON.stringify({ modulo: module, acao: action, payload: payload ?? {} });
      if (pending.has(body)) return pending.get(body);
      const upload = module === 'ocr' && action === 'ler';
      const active = session;
      const request = fetch(endpoint(upload ? '/api/v2/preview/ocr' : '/api/v2/preview/dispatch'), {
        method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body, signal: AbortSignal.any([session.signal, AbortSignal.timeout(upload ? 40000 : 12000)])
      }).then(async response => {
        const result = await response.json();
        if (response.status === 401 && active === session) {
          void window.AlmoxaCorePreview.logout();
          document.querySelector('#almoxa-preview output')?.replaceChildren('Sessao expirada. Identifique-se novamente.');
        }
        return result;
      }).catch(() => ({
        ok: false, codigo: 'CORE_INDISPONIVEL', mensagem: 'O Core de homologação não respondeu.'
      })).finally(() => {
        if (pending.get(body) === request) pending.delete(body);
      });
      pending.set(body, request);
      return request;
    }
  };

  window.addEventListener('DOMContentLoaded', () => {
    if (operational) return;
    const panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:2147483647;background:#14242b;color:white;padding:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap';
    const label = document.createElement('label');
    label.textContent = 'Credencial de homologação ';
    const input = document.createElement('input');
    input.type = 'password';
    input.autocomplete = 'off';
    label.append(input);
    const status = document.createElement('output');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Testar leitura de NF';
    button.addEventListener('click', async () => {
      const credential = input.value;
      input.value = '';
      status.textContent = 'Autenticando…';
      delete status.dataset.ok;
      const login = await window.AlmoxaCorePreview.login(credential);
      if (!login.ok) {
        status.textContent = login.mensagem;
        status.dataset.ok = 'false';
        return;
      }
      status.textContent = 'Consultando…';
      const useCampo = location.pathname.endsWith('/campo');
      const invoke = useCampo ? window.api : window.API?.call?.bind(window.API);
      if (typeof invoke !== 'function') {
        status.textContent = 'O cliente não inicializou.';
        return;
      }
      const active = session;
      const result = await invoke('nf', 'listar', {});
      if (active !== session) return;
      status.textContent = result.ok ? 'Core conectado. Notas de teste: ' + result.dados.length : 'Sessao aberta. ' + result.mensagem;
      status.dataset.ok = String(result.ok);
    });
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.textContent = 'Encerrar sessão de teste';
    clear.addEventListener('click', () => {
      void window.AlmoxaCorePreview.logout();
      input.value = '';
      status.textContent = 'Sessão de teste encerrada.';
      delete status.dataset.ok;
    });
    panel.id = 'almoxa-preview';
    const diagnostics = document.createElement('small');
    diagnostics.id = 'almoxa-preview-diagnostics';
    const frontend = location.pathname.endsWith('/campo') ? 'ALMOX CAMPO' : (window.ALMOXA_VERSAO || 'Desktop V430');
    diagnostics.textContent = frontend + ' | Core: verificando';
    panel.append(label, button, clear, status, diagnostics);
    if (!origin) diagnostics.textContent = frontend + ' | Core V2 sem endereco HTTPS configurado';
    else void fetch(endpoint('/health'), { credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5000) })
      .then(async response => {
        const health = await response.json();
        if (health.environment !== 'homologacao-local' || !health.coreVersion) throw new Error();
        const revision = /^[a-f0-9]{7,40}$/i.test(health.revision ?? '') ? ' (' + health.revision.slice(0, 12) + ')' : '';
        diagnostics.textContent = frontend + ' | Core Node.js ' + health.coreVersion + revision +
          (remote ? ' | Core remoto | ' : ' | Homologacao local | ') + endpoint('/api/v2/preview/dispatch') + ' | Health HTTP ' + response.status;
      })
      .catch(() => { diagnostics.textContent = frontend + ' | Core de homologacao indisponivel'; });
    if (writeEnabled) {
      const write = document.createElement('button');
      write.type = 'button';
      write.textContent = 'Registrar ocorrência sintética';
      write.dataset.action = 'occurrence-test';
      let operation;
      write.addEventListener('click', async () => {
        const active = session;
        operation ??= crypto.randomUUID();
        write.disabled = true;
        try {
          const title = 'Homologação ' + operation;
          const created = await window.API.call('ocorrencias', 'criar', { operation, version: 0, titulo: title });
          if (active !== session) return;
          if (!created.ok) {
            status.textContent = created.mensagem || created.codigo;
            return;
          }
          const result = await window.API.call('ocorrencias', 'obter', { id: created.dados.id });
          if (active !== session) return;
          if (result.ok && result.dados.titulo === title) {
            status.textContent = 'Ocorrência de teste confirmada: ' + result.dados.id;
            status.dataset.written = result.dados.id;
            operation = undefined;
          } else status.textContent = result.mensagem || 'Gravação ainda não confirmada por releitura.';
        } finally {
          write.disabled = false;
        }
      });
      panel.append(write);
    }
    document.body.append(panel);
  });
})();
