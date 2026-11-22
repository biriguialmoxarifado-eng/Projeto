'use strict';
(() => {
  const supported = new Map([
    ['nf', new Set(['listar', 'obter', 'itens'])],
    ['itens', new Set(['listar', 'obter'])],
    ['fornecedores', new Set(['listar', 'porCnpj'])],
    ['categorias', new Set(['listar'])],
    ['obras', new Set(['listar'])],
    ['lojinha', new Set(['catalogo', 'item'])],
    ['inventario', new Set(['listar', 'obter', 'divergencias'])]
  ]);
  let token = '';
  let session = new AbortController();
  const pending = new Map();
  window.AlmoxaCorePreview = {
    setToken(value) {
      token = typeof value === 'string' ? value.trim() : '';
      session.abort();
      session = new AbortController();
      pending.clear();
    },
    call(module, action, payload) {
      if (!supported.get(module)?.has(action)) {
        return Promise.resolve({ ok: false, codigo: 'OPERACAO_FORA_DA_HOMOLOGACAO', mensagem: 'Operação indisponível no ambiente de homologação.' });
      }
      if (!token) return Promise.resolve({ ok: false, codigo: 'SEM_SESSAO', mensagem: 'Informe a credencial de homologação.' });
      const body = JSON.stringify({ modulo: module, acao: action, payload: payload ?? {} });
      if (pending.has(body)) return pending.get(body);
      const request = fetch('/api/v2/preview/dispatch', {
        method: 'POST', credentials: 'omit', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body, signal: AbortSignal.any([session.signal, AbortSignal.timeout(12000)])
      }).then(response => response.json()).catch(() => ({
        ok: false, codigo: 'CORE_INDISPONIVEL', mensagem: 'O Core de homologação não respondeu.'
      })).finally(() => {
        if (pending.get(body) === request) pending.delete(body);
      });
      pending.set(body, request);
      return request;
    }
  };

  window.addEventListener('DOMContentLoaded', () => {
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
      window.AlmoxaCorePreview.setToken(input.value);
      input.value = '';
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
      status.textContent = result.ok ? 'Core conectado. Notas de teste: ' + result.dados.length : result.mensagem;
      status.dataset.ok = String(result.ok);
    });
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.textContent = 'Encerrar sessão de teste';
    clear.addEventListener('click', () => {
      window.AlmoxaCorePreview.setToken('');
      input.value = '';
      status.textContent = 'Sessão de teste encerrada.';
      delete status.dataset.ok;
    });
    panel.id = 'almoxa-preview';
    panel.append(label, button, clear, status);
    document.body.append(panel);
  });
})();
