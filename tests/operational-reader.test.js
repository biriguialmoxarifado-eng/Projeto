'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { createRuntime } = require('../backend/runtime');
const { createOperationalReader } = require('../backend/operational-reader');

test('leitura operacional exige administrador autenticado e retorna somente campos autorizados', async () => {
  const password = 'synthetic-operational-test';
  const digest = createHash('sha256').update(password).digest('hex');
  const sheets = {
    USUARIOS: [
      ['id', 'nome', 'email', 'senha_hash', 'perfil', 'status', 'matricula', 'foto'],
      ['1', 'Admin Teste', 'admin@example.test', digest, ' AdMiNiStRaDoR ', 'ATIVO', '11', 'data:image/png;base64,aW1n'],
      ['2', 'Operador Teste', 'operator@example.test', digest, 'OPERADOR', 'ATIVO', '22']
    ],
    ALMOXA_ITENS: [['sku', 'descricao', 'estoqueAtual'], ['SYN-1', 'Item sintético', 8], ['OTHER-2', 'Item sem saldo conhecido', 'inconsistente']],
    ALMOXA_EPI_FICHAS: [['id', 'matricula', 'colaborador', 'sku', 'item', 'assinatura'], ['a', '11', 'Admin Teste', 'SYN-1', 'Luva', 'segredo']],
    ALMOXA_MOVIMENTACOES: [['id', 'sku', 'qtd', 'valorUnitario', 'usuario'], ['m', 'SYN-1', 2, '12,50', 'operador-teste']]
  };
  const provider = {
    spreadsheetId: 'fake',
    async healthCheck() { return { status: 'ok' }; },
    async request(id, path) {
      assert.equal(id, 'fake');
      const name = /^\/values\/'([^']+)'!A:Z\?/.exec(decodeURIComponent(path))?.[1];
      assert.ok(Object.hasOwn(sheets, name));
      return { values: sheets[name] };
    }
  };
  const operational = createOperationalReader(provider);
  const { core } = await createRuntime(provider, { operationalSecurity: operational.security });
  const server = createServer((req, res) => { void operational.handle(core, req, res); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const endpoint = 'http://127.0.0.1:' + server.address().port + '/api/v2/preview/';
  let token;
  const send = async (path, body, method = 'POST') => {
    const response = await fetch(endpoint + path, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: response.status, ...(await response.json()) };
  };
  const dispatch = (modulo, acao) => send('dispatch', { modulo, acao });
  try {
    assert.equal((await dispatch('dashboard', 'mural')).status, 401);
    assert.equal((await send('session', { usuario: '22', senha: password })).status, 401);
    assert.equal((await send('session', { usuario: '11', senha: 'errada' })).status, 401);
    const login = await send('session', { usuario: '11', senha: password, metodo: 'senha' });
    assert.equal(login.dados.usuario.perfil, 'admin');
    token = login.dados.sessao.token;
    assert.deepEqual((await dispatch('dashboard', 'mural')).dados,
      { coreOperational: true, itens: 2, colaboradores: 2, fichasEpi: 1 });
    assert.equal((await dispatch('estoque', 'listar')).dados[0].estoque, 8);
    const movement = (await dispatch('estoque', 'movimentacoes')).dados[0];
    assert.equal(movement.sku, 'SYN-1');
    assert.equal(movement.valorUnitario, 12.5);
    assert.equal(movement.usuario, 'operador-teste');
    assert.equal((await dispatch('usuarios', 'listar')).dados[0].senha_hash, undefined);
    assert.equal((await dispatch('epi', 'fichas')).dados[0].itens[0].assinatura, undefined);
    const call = (modulo, acao, payload) => send('dispatch', { modulo, acao, payload });
    const catalogue = await call('itens', 'listar', { busca: 'SYN' });
    assert.equal(catalogue.dados.length, 1);
    const unknown = (await call('estoque', 'item', { sku: 'OTHER-2' })).dados;
    assert.equal(unknown.estoque, null);
    assert.equal(unknown.status, 'desconhecido');
    assert.equal(catalogue.dados[0].disponivel, null);
    const index = (await dispatch('epi', 'indice')).dados;
    assert.equal(index[0].chave, 'u:1');
    assert.match(index[0].materiais, /Luva/);
    assert.equal(index[0].itens, undefined);
    const detail = (await call('epi', 'detalhe', { chave: index[0].chave })).dados;
    assert.equal(detail.itens[0].sku, 'SYN-1');
    assert.equal((await call('usuarios', 'fotoEpi', { id: detail.usuarioId })).dados.foto, 'data:image/png;base64,aW1n');
    assert.equal((await dispatch('estoque', 'movimentar')).status, 403);
    await send('session', null, 'DELETE');
    assert.equal((await dispatch('dashboard', 'mural')).status, 401);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
