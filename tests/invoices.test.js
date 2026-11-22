'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('../backend/runtime');
const { GoogleSheetsProvider } = require('../database/adapters/google-sheets-provider');

const credential = { token: 'isolated-token', actor: 'test-operator', role: 'operator' };
const note = { numero: '123', serie: '1', itens: [{ sku: 'SYNTHETIC', quantidade: 2 }] };

function fakeGoogle({ title = 'ALMOXA_TESTE_CORE' } = {}) {
  const rows = [['EVENTO_JSON']];
  const receivingRows = [['EVENTO_JSON']];
  const stockRows = [['EVENTO_JSON']];
  const itemRows = [['EVENTO_JSON']];
  const supplierRows = [['EVENTO_JSON']];
  const categoryRows = [['EVENTO_JSON']];
  const markers = new Set();
  let loseResponse = true;
  let writes = 0;
  const auth = { async getClient() {
    return { async request({ url, method, data }) {
      const path = decodeURIComponent(new URL(url).pathname);
      assert.ok(path.startsWith('/v4/spreadsheets/test-only'));
      if (method === 'GET') {
        if (new URL(url).searchParams.has('fields') && new URL(url).searchParams.get('fields').startsWith('namedRanges')) {
          return { data: { namedRanges: [...markers].map(namedRangeId => ({ namedRangeId })) } };
        }
        if (path.includes('/values/')) return { data: { values: structuredClone(path.includes('RECEBIMENTO_CORE_TESTE') ? receivingRows : path.includes('ESTOQUE_CORE_TESTE') ? stockRows : path.includes('ITENS_CORE_TESTE') ? itemRows : path.includes('FORNECEDORES_CORE_TESTE') ? supplierRows : path.includes('CATEGORIAS_CORE_TESTE') ? categoryRows : rows) } };
        return { data: { spreadsheetId: 'test-only', properties: { title },
          sheets: [{ properties: { title: 'NF_CORE_TESTE', sheetId: 7 } }, { properties: { title: 'RECEBIMENTO_CORE_TESTE', sheetId: 8 } }, { properties: { title: 'ESTOQUE_CORE_TESTE', sheetId: 9 } }, { properties: { title: 'ITENS_CORE_TESTE', sheetId: 10 } }, { properties: { title: 'FORNECEDORES_CORE_TESTE', sheetId: 11 } }, { properties: { title: 'CATEGORIAS_CORE_TESTE', sheetId: 12 } }] } };
      }
      writes++;
      const append = data.requests.at(-1);
      const names = data.requests.slice(0, -1).map(request => request.addNamedRange.namedRange.namedRangeId);
      if (names.some(name => markers.has(name))) throw { response: { status: 400 } };
      names.forEach(name => markers.add(name));
      assert.ok([7, 8, 9, 10, 11, 12].includes(append.appendCells.sheetId));
      const targetRows = append.appendCells.sheetId === 8 ? receivingRows : append.appendCells.sheetId === 9 ? stockRows : append.appendCells.sheetId === 10 ? itemRows : append.appendCells.sheetId === 11 ? supplierRows : append.appendCells.sheetId === 12 ? categoryRows : rows;
      targetRows.push([append.appendCells.rows[0].values[0].userEnteredValue.stringValue]);
      if (loseResponse) {
        loseResponse = false;
        throw new Error('response lost');
      }
      return { data: {} };
    } };
  } };
  return {
    provider: new GoogleSheetsProvider({ spreadsheetId: 'production', testSpreadsheetId: 'test-only',
      testOnly: true, readAuth: auth, writeAuth: auth }),
    events: () => rows.slice(1).map(row => JSON.parse(row[0])),
    writes: () => writes
  };
}

test('motor NF isolado confirma escrita, deduplica, rejeita versões concorrentes e restaura histórico', async () => {
  const { provider, events } = fakeGoogle();
  const runtime = () => createRuntime(provider, { invoiceTestStorage: provider, credential });
  const first = (await runtime()).getInvoiceEngine();
  const second = (await runtime()).getInvoiceEngine();
  const token = credential.token;
  const input = { operation: 'create-1', version: 0, note };
  await assert.rejects(first.salvar('wrong', input), { code: 'SESSION_INVALID' });
  assert.equal(events().length, 0);
  const initial = await first.salvar(token, input);
  assert.equal(initial.version, 1);
  assert.equal(initial.actor, 'test-operator');
  assert.deepEqual(await second.salvar(token, input), initial);
  await assert.rejects(second.salvar(token, { ...input, note: { ...note, fornecedor: 'outro' } }),
    { code: 'NF_CONFLITO_IDEMPOTENCIA' });
  const writes = await Promise.allSettled([
    first.salvar(token, { operation: 'edit-1', version: 1, note: { ...note, fornecedor: 'A' } }),
    second.salvar(token, { operation: 'edit-2', version: 1, note: { ...note, fornecedor: 'B' } })
  ]);
  assert.equal(writes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(writes.find(result => result.status === 'rejected').reason.code, 'NF_CONFLITO_VERSAO');
  const restored = await first.recuperar(token, { id: initial.id, operation: 'restore-1', version: 2, fromVersion: 1 });
  assert.equal(restored.version, 3);
  assert.deepEqual(restored.note, initial.note);
  assert.equal(restored.action, 'recuperar');
  assert.deepEqual(await second.listar(token), [restored]);
  assert.deepEqual(events().map(event => event.version), [1, 2, 3]);
});

test('motor inativo por padrão, proíbe escrita de leitor e rejeita título diferente antes de gravar', async () => {
  const { provider, writes } = fakeGoogle({ title: 'Outra planilha' });
  const disabled = await createRuntime(provider);
  assert.throws(() => disabled.getInvoiceEngine(), { code: 'NF_TESTE_DESATIVADO' });
  const reader = await createRuntime(provider, { invoiceTestStorage: provider, credential: { ...credential, role: 'reader' } });
  const input = { operation: 'invalid', version: 0, note };
  await assert.rejects(reader.getInvoiceEngine().salvar(credential.token, input), { code: 'ACCESS_DENIED' });
  const operator = await createRuntime(provider, { invoiceTestStorage: provider, credential });
  await assert.rejects(operator.getInvoiceEngine().salvar(credential.token, input), { code: 'NF_DESTINO_INSEGURO' });
  assert.equal(writes(), 0);
});

test('requisição e compra só geram entrada após conferência e recebem em duas notas sem duplicar', async () => {
  const { provider } = fakeGoogle();
  const runtime = await createRuntime(provider, { invoiceTestStorage: provider, credential });
  const invoices = runtime.getInvoiceEngine();
  const receiving = runtime.getReceivingEngine();
  const token = credential.token;
  const id = 'request-1';
  const makeInvoice = (numero, quantidade) => invoices.salvar(token, {
    operation: 'nf-' + numero, version: 0, note: { numero, itens: [{ sku: 'SYNTHETIC', quantidade }] }
  });
  const first = await makeInvoice('201', 2);
  const second = await makeInvoice('202', 3);
  await receiving.requisitar(token, {
    id, operation: 'request', version: 0, numero: 'RC-0007', solicitante: 'synthetic',
    itens: [{ sku: 'SYNTHETIC', quantidade: 5 }]
  });
  await receiving.comprar(token, { id, operation: 'purchase', version: 1, compra: 'PO-01' });
  assert.equal(await receiving.entradas(token, 'SYNTHETIC'), 0);
  const stock = runtime.getStockEngine();
  assert.equal((await stock.saldo(token, 'SYNTHETIC', 'A')).saldo, 0);
  const input = {
    id, operation: 'receipt-a', version: 2, nfId: first.id, nfVersion: 1,
    conferencia: true, local: 'A', itens: [{ sku: 'SYNTHETIC', quantidade: 2 }]
  };
  await assert.rejects(receiving.receber(token, { ...input, conferencia: false }), { code: 'CONFERENCIA_INVALIDA' });
  await assert.rejects(receiving.receber(token, { ...input, itens: [{ sku: 'SYNTHETIC', quantidade: 1 }] }),
    { code: 'CONFERENCIA_DIVERGENTE' });
  const partial = await receiving.receber(token, input);
  assert.equal(partial.note.status, 'PARCIAL');
  assert.equal(partial.nfVersion, 1);
  await assert.rejects(invoices.salvar(token, { operation: 'change-received', version: 1,
    note: { ...first.note, fornecedor: 'corrigido' } }), { code: 'NF_RECEBIDA' });
  assert.equal(partial.note.itens[0].pendente, 3);
  assert.equal(partial.notificacao.requisicao, 'RC-0007');
  assert.deepEqual(await receiving.receber(token, input), partial);
  await assert.rejects(receiving.receber(token, { ...input, version: 3, operation: 'duplicate-nf' }),
    { code: 'NF_JA_VINCULADA' });
  const final = await receiving.receber(token, {
    ...input, version: 3, operation: 'receipt-b', nfId: second.id, itens: [{ sku: 'SYNTHETIC', quantidade: 3 }]
  });
  assert.equal(final.note.status, 'RECEBIDA');
  assert.equal(final.note.itens[0].pendente, 0);
  assert.equal(await receiving.entradas(token, 'SYNTHETIC'), 5);
  assert.equal((await receiving.consultar(token, id)).version, 4);
  const reopened = (await createRuntime(provider, { invoiceTestStorage: provider, credential })).getStockEngine();
  assert.equal((await reopened.saldo(token, 'SYNTHETIC', 'A')).saldo, 5);
  assert.equal((await reopened.saldo(token, 'SYNTHETIC', 'B')).saldo, 0);
  const movement = { sku: 'SYNTHETIC', local: 'A', version: 0, action: 'saida', quantidade: 4, operation: 'receipt-spend' };
  await reopened.movimentar(token, movement);
  await reopened.movimentar(token, movement);
  assert.deepEqual(await stock.saldo(token, 'SYNTHETIC', 'A'), { saldo: 1, reservado: 0, disponivel: 1, version: 1 });
});

test('edição e recebimento simultâneos disputam a mesma versão da NF em duas instâncias', async () => {
  const { provider } = fakeGoogle();
  const makeRuntime = () => createRuntime(provider, { invoiceTestStorage: provider, credential });
  const a = await makeRuntime();
  const b = await makeRuntime();
  const invoices = a.getInvoiceEngine();
  const receiving = b.getReceivingEngine();
  const token = credential.token;
  const items = [{ sku: 'SYNTHETIC', quantidade: 2 }];
  const note = { numero: '900', itens: items };
  const nf = await invoices.salvar(token, { operation: 'nf-race', version: 0, note });
  const id = 'request-race';
  await receiving.requisitar(token, { id, operation: 'req-race', version: 0, numero: 'RC-900',
    solicitante: 'synthetic', itens: items });
  await receiving.comprar(token, { id, operation: 'buy-race', version: 1, compra: 'PO-900' });
  const [editing, receipt] = await Promise.allSettled([
    invoices.salvar(token, { operation: 'edit-race', version: 1, note: { ...note, fornecedor: 'alterado' } }),
    receiving.receber(token, { id, operation: 'receive-race', version: 2, nfId: nf.id,
      nfVersion: 1, conferencia: true, itens: items })
  ]);
  const finalNote = await invoices.consultar(token, nf.id);
  if (editing.status === 'fulfilled') {
    assert.equal(receipt.status, 'rejected');
    assert.equal(receipt.reason.code, 'NF_VERSAO_INVALIDA');
    assert.equal(finalNote.version, 2);
    assert.equal(await receiving.entradas(token, 'SYNTHETIC'), 0);
  } else {
    assert.equal(editing.reason.code, 'NF_RECEBIDA');
    assert.equal(receipt.status, 'fulfilled');
    assert.equal(finalNote.version, 1);
    assert.equal(receipt.value.nfVersion, 1);
    assert.equal(await receiving.entradas(token, 'SYNTHETIC'), 2);
  }
});

test('adaptador de leitura preserva o envelope dos clientes para lista, detalhe e itens', async () => {
  const { provider } = fakeGoogle();
  const runtime = await createRuntime(provider, { invoiceTestStorage: provider, credential });
  const token = credential.token;
  const invoice = await runtime.getInvoiceEngine().salvar(token, {
    version: 0, operation: 'client-contract',
    note: { numero: '555', serie: '2', itens: [{ sku: 'SYNTHETIC', quantidade: 2, valorUnitario: 3 }] }
  });
  const api = runtime.getInvoiceReadAdapter();
  const desktop = await api(token, 'listar', {});
  assert.equal(desktop.ok, true);
  assert.equal(desktop.dados[0].idNF, invoice.id);
  assert.equal(desktop.dados[0].valorItens, 6);
  const campo = await api(token, 'obter', { numero: '555', serie: '2' });
  assert.deepEqual(campo, { ok: true, dados: desktop.dados[0] });
  assert.deepEqual(await api(token, 'itens', { idNF: invoice.id }), { ok: true, dados: campo.dados.itens });
  assert.equal((await api(token, 'salvar', {})).codigo, 'ACAO_DESCONHECIDA');
  await assert.rejects(api('wrong', 'listar'), { code: 'SESSION_INVALID' });
});

test('estoque isolado protege reservas, transfere em um evento e estorna uma única vez', async () => {
  const { provider } = fakeGoogle();
  const runtime = await createRuntime(provider, { invoiceTestStorage: provider, credential });
  const stock = runtime.getStockEngine(), token = credential.token;
  const move = (version, action, quantidade, options = {}) => stock.movimentar(token, {
    sku: 'SYNTHETIC', local: 'A', version, action, quantidade, operation: action + '-' + version, ...options
  });
  await move(0, 'entrada', 10);
  await move(1, 'reservar', 3);
  await assert.rejects(move(2, 'saida', 8), { code: 'ESTOQUE_SALDO_INSUFICIENTE' });
  await move(2, 'retirarReserva', 2);
  const transfer = await move(3, 'transferir', 4, { destino: 'B' });
  assert.deepEqual(await move(3, 'transferir', 4, { destino: 'B' }), transfer);
  await move(4, 'devolucao', 1);
  await move(5, 'saida', 1);
  await move(6, 'estorno', undefined, { original: transfer.operation });
  await assert.rejects(move(7, 'estorno', undefined, { original: transfer.operation }),
    { code: 'ESTOQUE_ESTORNO_INVALIDO' });
  assert.deepEqual(await stock.saldo(token, 'SYNTHETIC', 'A'), { saldo: 8, reservado: 1, disponivel: 7, version: 7 });
  assert.deepEqual(await stock.saldo(token, 'SYNTHETIC', 'B'), { saldo: 0, reservado: 0, disponivel: 0, version: 7 });
});

test('itens e fornecedores passam pelo Core, deduplicam e preservam a versão e a identidade', async () => {
  const { provider } = fakeGoogle();
  const make = () => createRuntime(provider, { invoiceTestStorage: provider, credential });
  const engine = (await make()).getCatalogEngine();
  const token = credential.token;
  const item = { operation: 'item-create', version: 0, data: { sku: 'SYN-123', descricao: 'Sintético' } };
  const first = await engine.salvar(token, 'itens', item);
  assert.equal(first.version, 1);
  assert.deepEqual(await engine.salvar(token, 'itens', item), first);
  await assert.rejects(engine.salvar(token, 'itens', { ...item, operation: 'duplicate' }),
    { code: 'CADASTRO_CONFLITO_VERSAO' });
  const second = await engine.salvar(token, 'itens', {
    operation: 'item-edit', version: 1, data: { ...item.data, unidade: 'un' }
  });
  assert.deepEqual(await (await make()).getCatalogEngine().obter(token, 'itens', 'SYN-123'), second);
  const supplier = await engine.salvar(token, 'fornecedores', {
    operation: 'supplier-create', version: 0, data: { cnpj: '00.000.000/0000-00', razaoSocial: 'Teste' }
  });
  assert.equal(supplier.note.cnpj, '00000000000000');
  assert.deepEqual(await engine.listar(token, 'fornecedores'), [supplier]);
  assert.deepEqual(await engine.consultarLegado(token, 'itens', 'listar'), { ok: true, dados: [second.note] });
  assert.deepEqual(await engine.consultarLegado(token, 'itens', 'obter', { sku: 'SYN-123' }),
    { ok: true, dados: second.note });
  assert.deepEqual(await engine.consultarLegado(token, 'fornecedores', 'porCnpj', { cnpj: supplier.note.cnpj }),
    { ok: true, dados: supplier.note, cadastrado: true });
  assert.equal((await engine.consultarLegado(token, 'fornecedores', 'porCnpj', { cnpj: '11111111111111' })).cadastrado, false);
  await assert.rejects(engine.salvar('wrong', 'itens', item), { code: 'SESSION_INVALID' });
});

test('categorias são versionadas com nome único e valores padrão do legado', async () => {
  const { provider } = fakeGoogle();
  const runtime = await createRuntime(provider, { invoiceTestStorage: provider, credential });
  const catalog = runtime.getCatalogEngine(), token = credential.token;
  const input = { operation: 'category-create', version: 0, data: { nome: 'Sintética' } };
  const event = await catalog.salvar(token, 'categorias', input);
  assert.deepEqual(await catalog.salvar(token, 'categorias', input), event);
  assert.equal(event.note.icone, 'caixa');
  assert.equal(event.note.cor, 'ico-navy');
  assert.equal(event.note.visivel, true);
  await assert.rejects(catalog.salvar(token, 'categorias', {
    operation: 'category-duplicate', version: 0, data: { nome: 'SINTÉTICA' }
  }), { code: 'CATEGORIA_DUPLICADA' });
  const updated = await catalog.salvar(token, 'categorias', {
    operation: 'category-edit', version: 1, data: { id: event.id, nome: event.note.nome, visivel: false }
  });
  assert.equal(updated.note.criadoEm, event.note.criadoEm);
  assert.equal(updated.note.visivel, false);
  assert.deepEqual(await catalog.consultarLegado(token, 'categorias', 'listar'),
    { ok: true, dados: [updated.note] });
});
