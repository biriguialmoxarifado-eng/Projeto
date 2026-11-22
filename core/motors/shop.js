'use strict';

function createShopEngine({ core, catalog, stock }) {
  return async (token, action, input = {}) => {
    if (!['catalogo', 'item', 'estoque'].includes(action)) return { ok: false, codigo: 'ACAO_DESCONHECIDA' };
    await core.authorizeSession(token, 'stock:read');
    const local = input.local;
    if (typeof local !== 'string' || !/^[\w-]{1,80}$/.test(local)) {
      return { ok: false, codigo: 'LOCAL_OBRIGATORIO', mensagem: 'Informe o local de estoque da homologação.' };
    }
    const items = action === 'item'
      ? [await catalog.obter(token, 'itens', input.id ?? input.sku)].filter(Boolean)
      : await catalog.listar(token, 'itens');
    if (action === 'item' && !items.length) return { ok: false, codigo: 'ITEM_NAO_ENCONTRADO' };
    const hidden = new Set(action === 'catalogo' ? (await catalog.listar(token, 'categorias'))
      .filter(({ note }) => note.visivel === false || note.visivel === 'FALSE').map(({ note }) => note.nome) : []);
    const rawSearch = String(input.busca ?? '');
    const search = rawSearch.toLowerCase();
    const filtered = items.map(item => item.note).filter(note => {
      if (action !== 'catalogo') return true;
      const category = note.categoria || 'Sem categoria';
      return !hidden.has(category) && (!input.categoria || input.categoria === 'Todas' || input.categoria === category) &&
        (!search || [note.descricao, note.sku].some(value => String(value).toLowerCase().includes(search)) ||
          String(note.codigoBarras ?? '').includes(rawSearch));
    });
    if (!filtered.length) return { ok: true, dados: [] };
    const balances = await stock.saldos(token, filtered.map(note => note.sku), local);
    const projection = filtered.map(note => {
      const balance = balances.get(note.sku);
      const minimo = Number(note.estoqueMinimo) || 0;
      const maximo = Number(note.estoqueMaximo) || 0;
      const preco = Number(note.valorUnitario) || 0;
      const status = balance.saldo <= 0 ? 'critico' : balance.saldo < minimo ? 'atencao' : 'ok';
      return { status, id: note.sku, sku: note.sku, codigo: note.sku, nome: note.descricao, descricao: note.descricao,
        categoria: note.categoria || 'Sem categoria', unidade: note.unidade || 'un', local,
        estoque: balance.saldo, reservado: balance.reservado, disponivel: balance.saldo - balance.reservado,
        minimo, maximo, preco, valorUnitario: preco, codigoBarras: note.codigoBarras || '',
        foto: null, fornecedor: note.fornecedor || '', emoji: '📦' };
    });
    return { ok: true, dados: action === 'item' ? projection[0] : projection };
  };
}

module.exports = { createShopEngine };
