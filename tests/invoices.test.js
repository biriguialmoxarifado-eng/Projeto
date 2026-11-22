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
  const purchaseRows = [['EVENTO_JSON']];
  const requestRows = [['EVENTO_JSON']];
  const adminRows = new Map([
    ['CONFIG_CORE_TESTE', { sheetId: 15, rows: [['EVENTO_JSON']] }],
    ['OBRAS_CORE_TESTE', { sheetId: 16, rows: [['EVENTO_JSON']] }],
    ['USUARIOS_CORE_TESTE', { sheetId: 17, rows: [['EVENTO_JSON']] }],
    ['INVENTARIO_CORE_TESTE', { sheetId: 18, rows: [['EVENTO_JSON']] }],
    ['OCORRENCIAS_CORE_TESTE', { sheetId: 19, rows: [['EVENTO_JSON']] }],
    ['NOTIFICACOES_CORE_TESTE', { sheetId: 20, rows: [['EVENTO_JSON']] }],
    ['KITS_CORE_TESTE', { sheetId: 21, rows: [['EVENTO_JSON']] }],
    ['CALENDARIO_CORE_TESTE', { sheetId: 22, rows: [['EVENTO_JSON']] }],
    ['CENTROS_CORE_TESTE', { sheetId: 23, rows: [['EVENTO_JSON']] }],
    ['PROJETOS_CORE_TESTE', { sheetId: 24, rows: [['EVENTO_JSON']] }],
    ['RELATORIOS_CORE_TESTE', { sheetId: 25, rows: [['EVENTO_JSON']] }],
    ['MURAL_CORE_TESTE', { sheetId: 26, rows: [['EVENTO_JSON']] }],
    ['AUTOMACAO_CORE_TESTE', { sheetId: 27, rows: [['EVENTO_JSON']] }]
  ]);
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
        const admin = [...adminRows].find(([name]) => path.includes("/values/'" + name + "'!"));
        if (admin) return { data: { values: structuredClone(admin[1].rows) } };
        if (path.includes('/values/')) return { data: { values: structuredClone(path.includes('RECEBIMENTO_CORE_TESTE') ? receivingRows : path.includes('ESTOQUE_CORE_TESTE') ? stockRows : path.includes('ITENS_CORE_TESTE') ? itemRows : path.includes('FORNECEDORES_CORE_TESTE') ? supplierRows : path.includes('CATEGORIAS_CORE_TESTE') ? categoryRows : path.includes('COMPRAS_CORE_TESTE') ? purchaseRows : path.includes('SOLICITACOES_CORE_TESTE') ? requestRows : rows) } };
        return { data: { spreadsheetId: 'test-only', properties: { title },
          sheets: [{ properties: { title: 'NF_CORE_TESTE', sheetId: 7 } }, { properties: { title: 'RECEBIMENTO_CORE_TESTE', sheetId: 8 } }, { properties: { title: 'ESTOQUE_CORE_TESTE', sheetId: 9 } }, { properties: { title: 'ITENS_CORE_TESTE', sheetId: 10 } }, { properties: { title: 'FORNECEDORES_CORE_TESTE', sheetId: 11 } }, { properties: { title: 'CATEGORIAS_CORE_TESTE', sheetId: 12 } }, { properties: { title: 'COMPRAS_CORE_TESTE', sheetId: 13 } }, { properties: { title: 'SOLICITACOES_CORE_TESTE', sheetId: 14 } }, ...[...adminRows].map(([title, v]) => ({ properties: { title, sheetId: v.sheetId } }))] } };
      }
      writes++;
      const append = data.requests.at(-1);
      const names = data.requests.slice(0, -1).map(request => request.addNamedRange.namedRange.namedRangeId);
      if (names.some(name => markers.has(name))) throw { response: { status: 400 } };
      names.forEach(name => markers.add(name));
      assert.ok([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27].includes(append.appendCells.sheetId));
      const admin = [...adminRows.values()].find(row => row.sheetId === append.appendCells.sheetId);
      const targetRows = append.appendCells.sheetId === 8 ? receivingRows : append.appendCells.sheetId === 9 ? stockRows : append.appendCells.sheetId === 10 ? itemRows : append.appendCells.sheetId === 11 ? supplierRows : append.appendCells.sheetId === 12 ? categoryRows : append.appendCells.sheetId === 13 ? purchaseRows : append.appendCells.sheetId === 14 ? requestRows : rows;
      (admin?.rows ?? targetRows).push([append.appendCells.rows[0].values[0].userEnteredValue.stringValue]);
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
  assert.equal(desktop.dados[0].itens[0].qtd, 2);
  assert.equal(desktop.dados[0].itens[0].idNF, invoice.id);
  assert.deepEqual(await api(token, 'listar', { busca: ' synthetic ' }), desktop);
  assert.deepEqual(await api(token, 'listar', { busca: 'ausente' }), { ok: true, dados: [] });
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
  await assert.rejects(move(7, 'ajuste', 0), { code: 'ESTOQUE_SALDO_INSUFICIENTE' });
  await move(7, 'ajuste', 5);
  assert.equal((await stock.saldo(token, 'SYNTHETIC', 'A')).saldo, 5);
  const result = await stock.movimentacoes(token, { sku: 'SYNTHETIC', somenteSaidas: true, limite: 200 });
  assert.ok(result.dados.every(movement => movement.qtd < 0));
  assert.ok(result.dados.some(movement => movement.tipo === 'AJUSTE' && movement.qtd === -3));
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

test('pré-compra reforça a necessidade máxima e mantém histórico e envelope do legado', async () => {
  const { provider } = fakeGoogle();
  const load = () => createRuntime(provider, { invoiceTestStorage: provider, credential });
  const runtime = await load(), token = credential.token;
  const purchases = runtime.getPurchaseEngine();
  const catalog = runtime.getCatalogEngine();
  const first = { operation: 'pre-one', sku: 'SYN-PURCHASE', qtd: 3 };
  assert.equal((await purchases.precompra(token, first)).codigo, 'ITEM_NAO_ENCONTRADO');
  await catalog.salvar(token, 'itens', { operation: 'make-purchase-item', version: 0,
    data: { sku: first.sku, descricao: 'Sintético', valorUnitario: 5, fornecedor: 'Teste' } });
  const created = await purchases.precompra(token, first);
  assert.equal(created.criado, true);
  assert.equal(created.dados.id, '#PC-000001');
  assert.equal(created.dados.valorEstimado, 15);
  assert.deepEqual(await purchases.precompra(token, first), created);
  const second = (await load()).getPurchaseEngine();
  const reinforced = await Promise.all([
    purchases.precompra(token, { ...first, operation: 'pre-two', qtd: 7 }),
    second.precompra(token, { ...first, operation: 'pre-three', qtd: 2 })
  ]);
  assert.ok(reinforced.every(result => result.dados.reforcada && result.dados.id === created.dados.id));
  const result = await second.consultarLegado(token, 'listar', { tipo: 'PRE_COMPRA', status: 'AGUARDANDO_APROVACAO' });
  assert.equal(result.dados.length, 1);
  assert.equal(result.dados[0].qtd, 7);
  assert.equal(JSON.parse(result.dados[0].historico).length, 3);
  assert.deepEqual(await second.consultarLegado(token, 'pedidos'), { ok: true, dados: [] });
  await assert.rejects(second.precompra(token, { ...first, qtd: 4 }), { code: 'COMPRA_CONFLITO_IDEMPOTENCIA' });
  const transition = { id: created.dados.id, operation: 'pre-approve', version: 3, status: 'EM_COTACAO' };
  const changed = await second.alterarStatus(token, transition);
  assert.deepEqual(await purchases.alterarStatus(token, transition), changed);
  assert.deepEqual(changed, { ok: true, dados: { id: created.dados.id, status: 'EM_COTACAO' } });
  await assert.rejects(purchases.alterarStatus(token, { ...transition, operation: 'pre-stale' }),
    { code: 'COMPRA_CONFLITO_VERSAO' });
  assert.equal((await purchases.consultarLegado(token, 'listar', { status: 'EM_COTACAO' })).dados.length, 1);
});

test('solicitação abre uma única reserva pendente, informa falta e deixa saldo intacto', async () => {
  const { provider } = fakeGoogle();
  const load = () => createRuntime(provider, { invoiceTestStorage: provider, credential });
  const first = await load(), second = await load(), token = credential.token;
  const stock = first.getStockEngine();
  await stock.movimentar(token, { sku: 'SYN-REQUEST', local: 'A', version: 0,
    operation: 'request-stock', action: 'entrada', quantidade: 2 });
  const request = { operation: 'request-shop', local: 'A',
    itens: JSON.stringify([{ sku: 'SYN-REQUEST', qtd: 3, preco: 5 }]) };
  const [a, b] = await Promise.all([
    first.getRequestEngine().criar(token, request), second.getRequestEngine().criar(token, request)
  ]);
  assert.deepEqual(a, b);
  assert.equal(a.dados.valor, 15);
  assert.equal(a.dados.status, 'ABERTA');
  assert.equal(a.reserva.reserva.status, 'PENDENTE_APROVACAO');
  assert.equal(a.reserva.semSaldo.length, 1);
  const { dados } = await second.getRequestEngine().listar(token);
  assert.equal(dados.length, 1);
  assert.equal(dados[0].status, 'CONVERTIDA');
  assert.equal(dados[0].reserva, a.reserva.protocolo);
  assert.equal(dados[0].itens[0].qtd, 3);
  assert.deepEqual(await stock.saldo(token, 'SYN-REQUEST', 'A'), { saldo: 2, reservado: 0, disponivel: 2, version: 1 });
});

test('configuração e obras preservam envelope e valores legados, com versão e acesso restrito', async () => {
  const { provider } = fakeGoogle();
  const load = role => createRuntime(provider, { invoiceTestStorage: provider, credential: { ...credential, role } });
  const admin = (await load('operator')).getAdministrationEngine();
  const reader = (await load('reader')).getAdministrationEngine();
  const token = credential.token;
  const config = { chave: 'catalogo.teste', valor: { limite: 7 }, operation: 'config-new', version: 0 };
  assert.deepEqual(await admin.config(token, 'salvar', config), { ok: true, dados: config.valor });
  assert.deepEqual(await reader.config(token, 'obter', { chave: config.chave }), { ok: true, dados: config.valor });
  await assert.rejects(reader.config(token, 'salvar', config), { code: 'ACCESS_DENIED' });
  await assert.rejects(admin.config(token, 'salvar', { ...config, operation: 'config-stale' }), { code: 'ADMIN_CONFLITO_VERSAO' });
  const obra = { nome: 'Obra sintética', codigo: 'SYN', operation: 'obra-create', version: 0 };
  const [first, replay] = await Promise.all([admin.obras(token, 'criar', obra), admin.obras(token, 'salvar', obra)]);
  assert.deepEqual(first, replay);
  assert.equal(first.dados.id, 'OB01');
  assert.equal(first.dados.status, 'Mobilização');
  await admin.obras(token, 'salvar', { ...obra, id: first.dados.id, version: 1, operation: 'obra-edit', avanco: 40 });
  assert.equal((await reader.obras(token, 'listar')).dados[0].avanco, 40);
});

test('consultas de usuários resolvem matrícula e perfil e omitem credenciais do envelope', async () => {
  const { provider } = fakeGoogle();
  const user = { id: 'U-SYN', nome: 'Sintético', matricula: '0001', perfil: 'OPERADOR',
    email: 'teste@example.invalid', senha_hash: 'fixture', token: 'fixture' };
  const { TestInvoiceStore } = require('../core/motors/invoices');
  await new TestInvoiceStore(provider, 'usuarios').append({
    id: user.id, version: 1, operation: 'synthetic-user', fingerprint: 'synthetic',
    actor: 'test-operator', note: user
  }).catch(error => { if (error.code !== 'GOOGLE_SHEETS_UNAVAILABLE') throw error; });
  const admin = (await createRuntime(provider, { invoiceTestStorage: provider, credential })).getAdministrationEngine();
  const token = credential.token;
  const result = await admin.usuarios(token, 'obter', { matricula: 1 });
  assert.equal(result.dados.id, user.id);
  assert.equal(result.dados.perfil, 'colaborador');
  assert.equal(result.dados.perfilCore, 'OPERADOR');
  assert.equal(Object.hasOwn(result.dados, 'senha_hash'), false);
  assert.equal(Object.hasOwn(result.dados, 'token'), false);
  assert.deepEqual(await admin.usuarios(token, 'contar'), { ok: true, dados: { total: 1 } });
  assert.equal((await admin.usuarios(token, 'listar')).dados.length, 1);
  const reader = await createRuntime(provider, { invoiceTestStorage: provider, credential: { ...credential, role: 'reader' } });
  await assert.rejects(reader.getAdministrationEngine().usuarios(token, 'listar'), { code: 'ACCESS_DENIED' });
});

test('inventário registra contagem offline uma vez, aponta divergência e não ajusta estoque ao encerrar', async () => {
  const { provider } = fakeGoogle();
  const start = () => createRuntime(provider, { invoiceTestStorage: provider, credential });
  const a = await start(), b = await start(), token = credential.token;
  const stock = a.getStockEngine(), inv = a.getInventoryEngine();
  await stock.movimentar(token, { sku: 'SYN-INV', local: 'A', version: 0,
    operation: 'inv-stock', action: 'entrada', quantidade: 5 });
  const opened = await inv(token, 'criar', { operation: 'inv-open', version: 0,
    obra: 'OB01', local: 'A', itens: [{ sku: 'SYN-INV' }] });
  const id = opened.dados.id;
  await assert.rejects(inv(token, 'encerrar', { id, operation: 'too-soon', version: 1 }),
    { code: 'INVENTARIO_CONTAGEM_PENDENTE' });
  const input = { id, operacaoId: 'offline-1', version: 1, sku: 'SYN-INV', quantidade: 3 };
  const result = await Promise.all([inv(token, 'registrarContagem', input), b.getInventoryEngine()(token, 'registrarContagem', input)]);
  assert.equal(result.filter(item => item.repetida).length, 1);
  assert.deepEqual((await inv(token, 'divergencias', { id })).dados,
    [{ sku: 'SYN-INV', saldo: 5, quantidade: 3, diferenca: -2 }]);
  const closed = await b.getInventoryEngine()(token, 'encerrar', { id, version: 2, operation: 'inv-close' });
  assert.equal(closed.dados.status, 'CONFIRMADA');
  assert.equal((await stock.saldo(token, 'SYN-INV', 'A')).saldo, 5);
  await assert.rejects(inv(token, 'registrarContagem', { ...input, operacaoId: 'offline-2', version: 3 }),
    { code: 'ATIVIDADE_CONFIRMADA' });
});

test('lojinha filtra categorias ocultas e busca, e lê saldo por local sem gravar', async () => {
  const { provider } = fakeGoogle();
  const runtime = await createRuntime(provider, { invoiceTestStorage: provider, credential });
  const token = credential.token, catalog = runtime.getCatalogEngine(), stock = runtime.getStockEngine();
  await catalog.salvar(token, 'categorias', {
    operation: 'hidden-category', version: 0, data: { nome: 'Oculta', visivel: false }
  });
  for (const [sku, categoria] of [['SYN-VISIBLE', 'Visível'], ['SYN-HIDDEN', 'Oculta']]) {
    await catalog.salvar(token, 'itens', {
      operation: 'shop-' + sku, version: 0, data: { sku, categoria, descricao: sku, codigoBarras: '01234' }
    });
    await stock.movimentar(token, { sku, action: 'entrada', local: 'A', quantidade: 4, version: 0, operation: 'stock-' + sku });
  }
  const shop = runtime.getShopEngine();
  const filtered = await shop(token, 'catalogo', { local: 'A', busca: '01234' });
  assert.deepEqual(filtered.dados.map(row => row.sku), ['SYN-VISIBLE']);
  assert.equal(filtered.dados[0].estoque, 4);
  assert.equal((await shop(token, 'item', { id: 'SYN-VISIBLE', local: 'B' })).dados.estoque, 0);
  assert.equal((await shop(token, 'catalogo')).codigo, 'LOCAL_OBRIGATORIO');
  await assert.rejects(shop('wrong', 'catalogo', { local: 'A' }), { code: 'SESSION_INVALID' });
});

test('homologação HTTP exige credencial, atende leitura e bloqueia mutação', async () => {
  const { createServer } = require('node:http');
  const { once } = require('node:events');
  const { createPreview } = require('../backend/preview-api');
  const { createHandler } = require('../backend/server');
  const { provider } = fakeGoogle();
  const runtime = await createRuntime(provider, { invoiceTestStorage: provider, credential });
  const handler = createHandler(runtime.core, 'test', undefined, createPreview(runtime, __dirname));
  const server = createServer(handler).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const url = 'http://127.0.0.1:' + server.address().port + '/api/v2/preview/dispatch';
    const call = (acao, token) => fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: JSON.stringify({ modulo: 'nf', acao })
    });
    const denied = await call('listar');
    assert.equal(denied.status, 401);
    assert.equal((await denied.json()).codigo, 'SEM_SESSAO');
    const allowed = await call('listar', credential.token);
    assert.deepEqual(await allowed.json(), { ok: true, dados: [] });
    const write = await call('salvar', credential.token);
    assert.equal(write.status, 400);
    assert.equal((await write.json()).codigo, 'OPERACAO_FORA_DA_HOMOLOGACAO');
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('ocorrências e notificações persistem com controle de acesso e retentativa', async () => {
  const { provider } = fakeGoogle();
  const load = (role, actor) => createRuntime(provider, { invoiceTestStorage: provider,
    credential: { ...credential, role, actor } });
  const a = (await load('operator', 'operator-a')).getAdministrationEngine();
  const b = (await load('reader', 'reader-b')).getAdministrationEngine();
  const token = credential.token;
  const input = { operation: 'occ-create', version: 0, titulo: 'Sintética', materiais: [{ sku: 'SYN' }] };
  await assert.rejects(b.ocorrencias(token, 'criar', input), { code: 'ACCESS_DENIED' });
  const created = await a.ocorrencias(token, 'criar', input);
  assert.deepEqual(await a.ocorrencias(token, 'criar', input), created);
  const id = created.dados.id;
  assert.equal(id, '#OC-000001');
  assert.deepEqual(JSON.parse(created.dados.materiais), [{ sku: 'SYN' }]);
  await a.ocorrencias(token, 'salvar', { id, operation: 'occ-update', version: 1, status: 'ENCERRADA' });
  assert.equal((await b.ocorrencias(token, 'listar', { status: 'ABERTA' })).dados.length, 0);
  assert.equal((await b.ocorrencias(token, 'obter', { id })).dados.status, 'ENCERRADA');
  const noticeInput = { operation: 'notice-create', version: 0, titulo: 'Aviso', destinatario: 'operator-a', perfis: ['OPERATOR'] };
  const createdNotice = await a.notificacoes(token, 'criar', noticeInput);
  assert.deepEqual(await a.notificacoes(token, 'criar', noticeInput), createdNotice);
  assert.deepEqual(await b.notificacoes(token, 'listar'), { ok: true, dados: [] });
  await assert.rejects(b.notificacoes(token, 'marcarLida', {
    id: createdNotice.dados.id, version: 1, operation: 'foreign-notice'
  }), { code: 'ACCESS_DENIED' });
  await a.notificacoes(token, 'marcarLida', { id: createdNotice.dados.id, version: 1, operation: 'notice-read' });
  assert.equal((await a.notificacoes(token, 'listar')).dados[0].lida, true);
});

test('kits, calendário e centros preservam contratos de leitura, idempotência e exclusão auditável', async () => {
  const { provider } = fakeGoogle();
  const load = (role = 'operator') => createRuntime(provider, {
    invoiceTestStorage: provider, credential: { ...credential, role }
  });
  const a = (await load()).getAdministrationEngine(), b = (await load()).getAdministrationEngine();
  const token = credential.token;
  const kit = { operation: 'kit-one', version: 0, nome: 'Kit Sintético', cargo: 'Operador',
    itens: JSON.stringify([{ sku: 'SYN', qtd: 2 }]) };
  const [x, y] = await Promise.all([a.kits(token, 'salvar', kit), b.kits(token, 'salvar', kit)]);
  assert.deepEqual(x, y);
  assert.equal(x.dados.codigo, 'KIT-001');
  assert.deepEqual((await b.kits(token, 'doPerfil', { perfil: 'operador' })).dados.itens, [{ sku: 'SYN', qtd: 2 }]);
  assert.equal((await a.kits(token, 'obter', { codigo: 'KIT-001' })).dados.id, x.dados.id);
  await assert.rejects(a.kits(token, 'salvar', { ...kit, operation: 'kit-duplicate' }), { code: 'KIT_DUPLICADO' });
  const ev = await a.calendario(token, 'criar', { operation: 'calendar-one', version: 0, titulo: 'Ensaio', data: '2026-11-22' });
  assert.equal(ev.dados.status, 'PROGRAMADO');
  const remove = { id: ev.dados.id, operation: 'calendar-delete', version: 1 };
  assert.deepEqual(await a.calendario(token, 'excluir', remove), await b.calendario(token, 'excluir', remove));
  assert.deepEqual(await a.calendario(token, 'listar'), { ok: true, dados: [] });
  const input = { codigo: 'SYN-01', nome: 'Frente sintética', orcamento: '25', operation: 'center-one', version: 0 };
  assert.equal((await a.centros(token, 'salvar', input)).dados.orcamento, 25);
  await assert.rejects(b.centros(token, 'salvar', { ...input, operation: 'center-duplicate' }), { code: 'CENTRO_DUPLICADO' });
  await b.centros(token, 'salvar', { ...input, operation: 'center-edit', version: 1, editando: true, nome: 'Revisada' });
  assert.equal((await a.centros(token, 'listar')).dados[0].nome, 'Revisada');
  const reader = (await load('reader')).getAdministrationEngine();
  await assert.rejects(reader.centros(token, 'excluir', { codigo: input.codigo, operation: 'denied', version: 2 }),
    { code: 'ACCESS_DENIED' });
});

test('projetos, relatórios e mural preservam aliases, formato e histórico de registros', async () => {
  const { provider } = fakeGoogle();
  const load = () => createRuntime(provider, { invoiceTestStorage: provider, credential });
  const a = (await load()).getAdministrationEngine(), b = (await load()).getAdministrationEngine(), token = credential.token;
  const project = { operation: 'project-new', version: 0, nome: 'Sintético', materiais: [{ sku: 'SYN' }] };
  const first = await a.projetos(token, 'criar', project);
  assert.deepEqual(await b.projetos(token, 'criar', project), first);
  const id = first.dados.id;
  await a.projetos(token, 'salvar', { id, operation: 'project-edit', version: 1, progresso: 25 });
  assert.equal((await b.projetos(token, 'detalhe', { id })).dados.progresso, 25);
  const report = await a.relatorios(token, 'registrar', { operation: 'report-new', version: 0, parametros: { obra: 'SYN' } });
  assert.equal(report.dados.formato, 'PDF');
  assert.deepEqual((await b.relatorios(token, 'gerados')).dados, [report.dados]);
  const mural = await a.mural(token, 'criar', { operation: 'mural-new', version: 0, fotos: ['foto-sintetica'] });
  assert.deepEqual((await b.mural(token, 'listar')).dados[0].fotos, ['foto-sintetica']);
  const remove = { id: mural.dados.id, operation: 'mural-remove', version: 1 };
  assert.deepEqual(await a.mural(token, 'excluir', remove), await b.mural(token, 'excluir', remove));
  assert.deepEqual(await b.mural(token, 'listar'), { ok: true, dados: [] });
});

test('painel compartilha a chave legada e regras alternam uma única vez sob concorrência', async () => {
  const { provider } = fakeGoogle();
  const load = role => createRuntime(provider, { invoiceTestStorage: provider, credential: { ...credential, role } });
  const a = (await load('operator')).getAdministrationEngine();
  const b = (await load('operator')).getAdministrationEngine();
  const reader = (await load('reader')).getAdministrationEngine();
  const token = credential.token;
  assert.deepEqual(await a.painel(token, 'carregar'), { ok: true, dados: null });
  const config = { banners: [{ titulo: 'Sintético' }] };
  await a.painel(token, 'salvar', { config, operation: 'panel-write', version: 0 });
  assert.deepEqual(await b.config(token, 'obter', { chave: 'PAINEL_CONFIG' }), { ok: true, dados: config });
  assert.deepEqual(await reader.painel(token, 'carregar'), { ok: true, dados: config });
  await assert.rejects(reader.painel(token, 'salvar', { config, operation: 'denied', version: 1 }),
    { code: 'ACCESS_DENIED' });
  const rule = await a.automacao(token, 'salvar', {
    operation: 'rule-new', version: 0, nome: 'Sintética', evento: 'TESTE', acaoRegra: 'NENHUMA', canais: ['painel']
  });
  const toggle = { id: rule.dados.id, operation: 'rule-toggle', version: 1 };
  const choices = await Promise.all([a.automacao(token, 'alternar', toggle), b.automacao(token, 'alternar', toggle)]);
  assert.deepEqual(choices[0], choices[1]);
  assert.equal(choices[0].dados.ativa, false);
  assert.deepEqual((await reader.automacao(token, 'regras')).dados[0], { ...rule.dados, ativa: false });
  const { TestInvoiceStore } = require('../core/motors/invoices');
  assert.deepEqual((await new TestInvoiceStore(provider, 'automacao').events()).map(event => event.action),
    ['AUTOMACAO_CRIADA', 'AUTOMACAO_ALTERADA']);
});
