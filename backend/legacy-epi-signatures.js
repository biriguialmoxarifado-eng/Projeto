'use strict';

const matrícula = value => String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '');
const fileId = value => typeof value === 'string' && /^[\w-]{10,200}$/.test(value);
const roles = new Set(['colaborador', 'almoxarife', 'responsavel', 'testemunha', 'recebedor', 'entregador', 'supervisor', 'sesmt']);

function deliveryKey(mat, entries) {
  let first = 5381, second = 52711;
  for (const char of entries.slice().sort().join('|').split('')) {
    const code = char.charCodeAt(0);
    first = (first * 33 ^ code) >>> 0;
    second = (second * 31 ^ code) >>> 0;
  }
  return 'ASS:' + mat + ':' + (first.toString(36) + second.toString(36)).slice(0, 12).toUpperCase();
}

function createLegacyEpiSignatures(drive, imageSource) {
  let indexCache;
  async function folder(parent, name) {
    const files = await drive.listFiles({ parent, name });
    if (files.length !== 1 || !fileId(files[0].id)) throw new Error('Pasta do repositório indisponível ou ambígua.');
    return files[0].id;
  }
  async function indices() {
    if (indexCache && Date.now() < indexCache.until) return indexCache.result;
    const result = (async () => {
      const root = await folder(undefined, 'ALMOXA_PRO_DATA');
      const index = await folder(root, '18_INDICES_MANIFESTOS');
      const merged = new Map();
      for (const collection of ['assinaturas', 'documentos']) {
        const [directory] = await drive.listFiles({ parent: index, name: collection });
        if (!directory) continue;
        const files = await drive.listFiles({ parent: await folder(index, collection) });
        for (const file of files.filter(file => fileId(file.id) &&
            new RegExp('^indice__' + collection + '__\\d{4}-\\d{2}\\.json$').test(file.name))) {
          const registry = await drive.readJson(file.id);
          if (registry?.conjunto !== collection || !Array.isArray(registry.registros)) continue;
          for (const record of registry.registros) {
            if (!fileId(record.arquivoId) || typeof record.id !== 'string' ||
                !record.id.startsWith(collection === 'assinaturas' ? 'COLAB:' : 'ASS:')) continue;
            const prior = merged.get(record.id);
            if (!prior || record.versao > prior.versao) merged.set(record.id, { ...record, collection });
            else if (record.versao === prior.versao && record.arquivoId !== prior.arquivoId) {
              merged.set(record.id, { ...prior, ambiguous: true });
            }
          }
        }
      }
      return merged;
    })().catch(error => { if (indexCache?.result === result) indexCache = undefined; throw error; });
    indexCache = { result, until: Date.now() + 120000 };
    return result;
  }
  async function record(entry) {
    if (!entry || entry.excluido || entry.ambiguous) return null;
    const stored = await drive.readJson(entry.arquivoId);
    return stored?.id === entry.id && stored.conjunto === entry.collection && !stored.excluido ? stored.dados : null;
  }
  return async ficha => {
    const mat = matrícula(ficha.matricula);
    const records = await indices();
    const registered = ficha.usuarioId ? await record(records.get('COLAB:' + ficha.usuarioId) ?? records.get('COLAB:MAT:' + mat)) : null;
    const profile = registered && matrícula(registered.matricula) === mat &&
      (!registered.idColaborador || String(registered.idColaborador) === ficha.usuarioId) ? imageSource(null, registered.imagem).inline : null;
    const items = new Set(ficha.itens.map(item => String(item.id || ('SKU:' + item.sku + '@' + String(item.entrega).slice(0, 10)))));
    const deliveries = [];
    for (const [id, entry] of records) {
      if (!id.startsWith('ASS:' + mat + ':')) continue;
      const signed = await record(entry);
      if (!signed || matrícula(signed.matricula) !== mat || !Array.isArray(signed.fichaItens) || !signed.fichaItens.length) continue;
      const ids = signed.fichaItens.map(String);
      if (new Set(ids).size !== ids.length || ids.some(id => !items.has(id)) || deliveryKey(mat, ids) !== id) continue;
      for (const [role, proof] of Object.entries(signed.papeis ?? {})) {
        const photo = imageSource(null, proof?.imagem).inline;
        if (roles.has(role) && photo) deliveries.push({ itens: ids, papel: role, imagem: photo, quando: proof.quando });
      }
    }
    return { rubricaCadastrada: profile || null, entregas: deliveries };
  };
}

module.exports = { createLegacyEpiSignatures };
