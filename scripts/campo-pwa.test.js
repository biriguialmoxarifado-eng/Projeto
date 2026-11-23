'use strict';

const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('manifesto e instalação offline apontam para a página real do Campo', async () => {
  const raiz = join(__dirname, '..');
  const manifesto = JSON.parse(readFileSync(join(raiz, 'manifest.webmanifest'), 'utf8'));
  const escopo = 'https://example.test/Projeto/';
  const eventos = {};
  let arquivos;
  vm.runInNewContext(readFileSync(join(raiz, 'service-worker.js'), 'utf8'), {
    URL,
    self: {
      registration: { scope: escopo },
      addEventListener: (nome, fn) => { eventos[nome] = fn; }
    },
    caches: {
      open: async () => ({
        addAll: async urls => { arquivos = Array.from(urls); },
        match: async () => 'página guardada'
      })
    },
    fetch: async () => { throw new Error('offline'); }
  });
  let instalacao;
  eventos.install({ waitUntil: p => { instalacao = p; } });
  await instalacao;
  const campo = new URL(manifesto.start_url, escopo).href;
  assert.ok(arquivos.includes(campo));
  for (const url of arquivos) assert.ok(existsSync(join(raiz, url.slice(escopo.length))));

  const consultarCache = (method, url) => {
    let resposta;
    eventos.fetch({ request: { method, url }, respondWith: p => { resposta = p; } });
    return resposta;
  };
  assert.equal(await consultarCache('GET', campo), 'página guardada');
  assert.equal(consultarCache('POST', campo), undefined);
  assert.equal(consultarCache('GET', campo + '?sessao=teste'), undefined);
  assert.equal(consultarCache('GET', 'https://script.google.com/macros/teste/exec'), undefined);
});
