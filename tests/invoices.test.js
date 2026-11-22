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
        if (path.includes('/values/')) return { data: { values: structuredClone(path.includes('RECEBIMENTO_CORE_TESTE') ? receivingRows : path.includes('ESTOQUE_CORE_TESTE') ? stockRows : rows) } };
        return { data: { spreadsheetId: 'test-only', properties: { title },
          sheets: [{ properties: { title: 'NF_CORE_TESTE', sheetId: 7 } }, { properties: { title: 'RECEBIMENTO_CORE_TESTE', sheetId: 8 } }, { properties: { title: 'ESTOQUE_CORE_TESTE', sheetId: 9 } }] } };
      }
      writes++;
      const append = data.requests.at(-1);
      const names = data.requests.slice(0, -1).map(request => request.addNamedRange.namedRange.namedRangeId);
      if (names.some(name => markers.has(name))) throw { response: { status: 400 } };
      names.forEach(name => markers.add(name));
      assert.ok([7, 8, 9].includes(append.appendCells.sheetId));
      const targetRows = append.appendCells.sheetId === 8 ? receivingRows : append.appendCells.sheetId === 9 ? stockRows : rows;
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
  const input = {
    id, operation: 'receipt-a', version: 2, nfId: first.id, nfVersion: 1,
    conferencia: true, itens: [{ sku: 'SYNTHETIC', quantidade: 2 }]
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
