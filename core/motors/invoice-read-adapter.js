'use strict';

function legacyItem(item, note, id) {
  const quantidade = Number(item.quantidade ?? item.qtd) || 0;
  const valorUnitario = Number(item.valorUnitario) || 0;
  return {
    id: item.id || '', idNF: item.idNF || id, nf: item.nf || note.numero, serie: item.serie || note.serie,
    sku: item.sku || '', idProduto: item.idProduto || item.sku || '', codigo: item.codigo || '',
    descricao: item.descricao || '', tamanho: item.tamanho || '', ncm: item.ncm || '',
    unidade: item.unidade || 'UN', quantidade, qtd: quantidade, valorUnitario,
    valorTotal: Number(item.valorTotal) || Math.round(quantidade * valorUnitario * 100) / 100,
    fornecedor: item.fornecedor || '', cnpj: item.cnpj || '', obra: item.obra || '', lote: item.lote || '',
    validade: item.validade || '', status: item.status || '', observacao: item.observacao || ''
  };
}

function legacyNote(event) {
  const { note } = event;
  const itens = note.itens.map(item => legacyItem(item, note, event.id));
  const valorItens = Math.round(itens.reduce((sum, item) =>
    sum + (Number(item.valorTotal) || (Number(item.quantidade ?? item.qtd) || 0) * (Number(item.valorUnitario) || 0)), 0) * 100) / 100;
  return {
    id: event.id, idNF: event.id, numero: note.numero, serie: note.serie, chave: note.chave,
    fornecedor: note.fornecedor || '', cnpj: note.cnpj, origem: String(note.origem || 'MANUAL').toUpperCase(),
    emissao: note.emissao || '', entrada: note.entrada || '', valor: Number(note.valor) > 0 ? Number(note.valor) : valorItens,
    valorItens, status: note.status || 'EM_CONFERENCIA', lancadoPor: note.lancadoPor || '',
    lancadoEm: note.lancadoEm || '', arquivoId: note.arquivoId || '', observacao: note.observacao || '',
    itens, listaItens: itens, qtdItens: itens.length, reconstruida: false
  };
}

function createInvoiceReadAdapter(engine) {
  return async (token, action, payload = {}) => {
    if (!['listar', 'obter', 'itens'].includes(action)) return { ok: false, codigo: 'ACAO_DESCONHECIDA' };
    const id = payload.id || payload.idNF;
    if (action !== 'listar' && id) {
      const event = await engine.consultar(token, id);
      if (event) {
        const note = legacyNote(event);
        return { ok: true, dados: action === 'itens' ? note.itens : note };
      }
    }
    const notes = (await engine.listar(token)).map(legacyNote);
    if (action === 'listar') {
      const busca = String(payload.busca || '').trim().toLowerCase();
      const filtered = notes.filter(note => {
        if (!['numero', 'serie', 'origem', 'status'].every(key =>
          payload[key] === undefined || String(payload[key]).toUpperCase() === String(note[key]).toUpperCase())) return false;
        const fields = [note.numero, note.serie, note.chave, note.fornecedor, note.cnpj, note.origem, note.status];
        for (const item of note.itens) fields.push(item.descricao, item.sku, item.codigo, item.tamanho);
        return fields.join(' ').toLowerCase().includes(busca);
      });
      filtered.sort((a, b) => String(b.entrada || b.emissao || '').localeCompare(String(a.entrada || a.emissao || '')));
      return { ok: true, dados: filtered };
    }
    const matches = notes.filter(note => payload.numero && String(payload.numero) === note.numero &&
      (!payload.serie || String(payload.serie) === note.serie));
    if (matches.length > 1) return { ok: false, codigo: 'NF_IDENTIDADE_AMBIGUA' };
    if (!matches.length) return { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Nota não localizada.' };
    return { ok: true, dados: action === 'itens' ? matches[0].itens : matches[0] };
  };
}

module.exports = { createInvoiceReadAdapter };
