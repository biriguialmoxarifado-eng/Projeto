'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { readFile } = require('node:fs/promises');
const { join } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

async function until(check, label) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(100);
  }
  throw new Error('Tempo esgotado no Desktop: ' + label);
}

async function withBrowser(browser, profile, origin, visit) {
  const child = spawn(browser, ['--headless', '--no-first-run', '--disable-sync', '--no-default-browser-check',
    '--disable-background-networking', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'],
  { windowsHide: true, stdio: 'ignore' });
  const exited = once(child, 'exit');
  void exited.catch(() => {});
  let socket;
  try {
    const port = await Promise.race([until(async () => {
      const ready = await readFile(join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '');
      return /^\d+/m.exec(ready)?.[0];
    }, 'iniciar o navegador'), exited.then(() => { throw new Error('O navegador encerrou antes de abrir o Desktop.'); })]);
    const tabs = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
    await once(socket, 'open', { signal: AbortSignal.timeout(5000) });
    let nextId = 0;
    const messages = new Map();
    socket.addEventListener('message', ({ data }) => {
      const reply = JSON.parse(data);
      messages.get(reply.id)?.(reply);
    });
    async function send(method, params = {}) {
      const id = ++nextId;
      const reply = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { messages.delete(id); reject(new Error('Sem resposta para ' + method)); }, 6000);
        messages.set(id, result => { clearTimeout(timer); messages.delete(id); resolve(result); });
        socket.send(JSON.stringify({ id, method, params }));
      });
      if (reply.error) throw new Error(reply.error.message);
      return reply.result;
    }
    async function evaluate(fn, ...args) {
      const { result, exceptionDetails } = await send('Runtime.evaluate', {
        expression: '(' + fn.toString() + ')(...' + JSON.stringify(args) + ')', returnByValue: true
      });
      if (exceptionDetails) throw new Error(result.description);
      return result.value;
    }
    const visible = async selector => {
      try {
        return await until(() => evaluate(s => Boolean(document.querySelector(s)?.getClientRects().length), selector), selector);
      } catch (error) {
        throw new Error(error.message + ' · ' + await evaluate(() => document.body?.innerText.slice(0, 500)));
      }
    };
    const text = async (selector, value) => {
      try {
        await until(() => evaluate((s, v) => document.querySelector(s)?.innerText.includes(v), selector, value), value);
      } catch (error) {
        throw new Error(error.message + ' · ' + await evaluate(s => document.querySelector(s)?.innerText.slice(0, 500), selector));
      }
    };
    const click = selector => until(() => evaluate(s => {
      const button = document.querySelector(s);
      if (!button?.getClientRects().length || button.disabled) return false;
      button.click();
      return true;
    }, selector), 'clicar ' + selector);
    const set = (selector, value) => until(() => evaluate((s, v) => {
      const input = document.querySelector(s);
      if (!input?.getClientRects().length || input.disabled) return false;
      input.value = v;
      return true;
    }, selector, value), 'preencher ' + selector);
    const route = async (name, label) => {
      await evaluate(name => { location.hash = '#/' + name; }, name);
      await text('#appMain h1', label);
    };
    const login = async (user, password) => {
      await set('#lgUser', user);
      await set('#lgPass', password);
      await click('#lgEntrar');
    };
    const save = async () => {
      const invalid = await evaluate(() => Array.from(document.querySelectorAll('#modalRoot form :invalid'))
        .map(input => [input.name, input.validationMessage]));
      assert.deepEqual(invalid, []);
      await click('[data-core-gravar]');
      await until(() => evaluate(() => !document.querySelector('[data-core-gravar]')?.getClientRects().length ||
        document.querySelector('[data-core-erro]')?.textContent), 'gravar pelo formulário');
      assert.equal(await evaluate(() => document.querySelector('[data-core-erro]')?.textContent || ''), '');
    };
    await send('Page.navigate', { url: origin });
    await visit({ evaluate, visible, text, click, set, route, login, save, send });
    await send('Browser.close');
  } finally {
    socket?.close();
    child.kill();
    await exited.catch(() => {});
  }
}

function exerciseDesktop(browser, profile, origin, credential) {
  return withBrowser(browser, profile, origin, async ({ evaluate, visible, text, click, set, route, login: signIn, save, send }) => {
    const login = (password = credential) => signIn('integration-test', password);
    await login('credencial inválida');
    await until(() => evaluate(() => document.querySelector('#lgErro')?.innerText.trim()), 'rejeitar credencial inválida');
    await login();
    await text('#appMain h1', 'Painel do almoxarifado');

    await route('usuarios', 'Usuários e perfis');
    await click('[data-core-novo-usuario]');
    await set('#modalRoot [name="nome"]', 'Colaboradora do ensaio');
    await set('#modalRoot [name="matricula"]', '00073');
    await save();
    await text('#appMain', 'Colaboradora do ensaio');
    await click('[data-core-editar-usuario]');
    await set('#modalRoot [name="cargo"]', 'Almoxarife do ensaio');
    await save();
    await text('#appMain', 'Almoxarife do ensaio');

    await route('estoque', 'Estoque Geral');
    await click('[data-core-novo-item]');
    await set('#modalRoot [name="sku"]', 'SYN-LUVA');
    await set('#modalRoot [name="descricao"]', 'Luva do ensaio');
    await save();
    await text('#appMain', 'Luva do ensaio');
    await route('movimentacoes', 'Movimentações');
    await click('[data-core-movimento]');
    await set('#modalRoot [name="sku"]', 'SYN-LUVA');
    await set('#modalRoot [name="tipo"]', 'entrada');
    await set('#modalRoot [name="qtd"]', '5');
    await set('#modalRoot [name="motivo"]', 'Entrada do ensaio');
    await save();
    await text('#appMain tbody', 'SYN-LUVA');

    await route('epi-fichas', 'Fichas de EPI');
    await click('[data-core-entregar]');
    await visible('#modalRoot [name="usuarioId"]');
    const user = await evaluate(() => document.querySelector('#modalRoot [name="usuarioId"]').options[1].value);
    await set('#modalRoot [name="usuarioId"]', user);
    await set('#modalRoot [name="sku"]', 'SYN-LUVA');
    await set('#modalRoot [name="quantidade"]', '2');
    await save();
    await text('#appMain tbody', 'Entrega');
    await route('estoque', 'Estoque Geral');
    await text('#appMain tbody', 'SYN-LUVA');
    assert.equal(await evaluate(() => document.querySelector('#appMain tbody tr').cells[3].innerText.trim()), '3');
    await route('epi-fichas', 'Fichas de EPI');

    await send('Page.reload');
    await login();
    await text('#appMain tbody', 'Colaboradora do ensaio');
    await click('[data-core-devolver]');
    await save();
    await text('#appMain tbody', 'Devolução');
    await send('Page.reload');
    await login();
    await text('#appMain tbody', 'Devolução');
    assert.equal(await evaluate(() => document.querySelectorAll('#appMain tbody tr').length), 2);
    await route('usuarios', 'Usuários e perfis');
    await text('#appMain tbody', 'Almoxarife do ensaio');
    await route('estoque', 'Estoque Geral');
    await text('#appMain tbody', 'SYN-LUVA');
    assert.equal(await evaluate(() => document.querySelector('#appMain tbody tr').cells[3].innerText.trim()), '5');
    await route('movimentacoes', 'Movimentações');
    await text('#appMain tbody', 'Devolução');
    assert.equal(await evaluate(() => document.querySelectorAll('#appMain tbody tr').length), 3);
    await click('[data-core-movimento]');
    await set('#modalRoot [name="sku"]', 'SYN-LUVA');
    await set('#modalRoot [name="tipo"]', 'saida');
    await set('#modalRoot [name="qtd"]', '1');
    await set('#modalRoot [name="motivo"]', 'Saída do ensaio');
    await save();
    await until(() => evaluate(() => document.querySelectorAll('#appMain tbody tr').length === 4), 'confirmar saída manual');
    await route('estoque', 'Estoque Geral');
    await click('[data-ajuste="SYN-LUVA"]');
    await set('#ajNovo', '6');
    await click('#modalRoot [data-ok]');
    await until(() => evaluate(() => document.querySelector('#appMain tbody tr')?.cells[3].innerText.trim() === '6'), 'confirmar ajuste');
    await send('Page.reload');
    await login();
    await text('#appMain tbody', 'SYN-LUVA');
    assert.equal(await evaluate(() => document.querySelector('#appMain tbody tr').cells[3].innerText.trim()), '6');
    await route('movimentacoes', 'Movimentações');
    await until(() => evaluate(() => document.querySelectorAll('#appMain tbody tr').length === 5), 'reler cinco movimentos');
    await evaluate(() => { location.hash = '#/nf'; });
    await text('#appMain', '90831');
  });
}

function exerciseOperational(browser, profile, origin, credential, item) {
  return withBrowser(browser, profile, origin, async ({ text, click, evaluate, login, route }) => {
    await text('#coreLoginStatus', 'Planilha conectada');
    await login('browser-admin', 'invalid');
    await text('#coreLoginStatus', 'Login recusado');
    await login('browser-admin', credential);
    await text('#corePill span', 'Core e planilha conectados');
    await route('loja', 'Loja / Catálogo');
    await text('#appMain', item);
    assert.equal(await evaluate(() => document.querySelectorAll('#appMain .prod').length > 0), true);
    assert.equal(await evaluate(() => Boolean(document.querySelector('#appMain [data-mais], #appMain [data-pedir-compra]'))), false);
    await click('#btnUser');
    await click('#btnSair');
    await click('#modalRoot [data-ok]');
    await text('#coreLoginStatus', 'Planilha conectada');
  });
}

module.exports = { exerciseDesktop, exerciseOperational };
