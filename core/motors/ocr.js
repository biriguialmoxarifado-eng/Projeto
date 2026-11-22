'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createHash } = require('node:crypto');

const run = promisify(execFile);
const script = join(__dirname, 'windows-ocr.ps1');
const fail = code => Object.assign(new Error(code), { code });
const digits = value => value.replace(/\D/g, '');
const money = value => Number(value.replaceAll('.', '').replace(',', '.'));

async function runWindows(image) {
  const args = ['-NoProfile', '-NonInteractive', '-File', script];
  if (!image) return run('powershell.exe', args, { timeout: 6000, windowsHide: true });
  const temporary = await mkdtemp(join(tmpdir(), 'almoxa-ocr-'));
  try {
    const file = join(temporary, 'image.' + image.extension);
    await writeFile(file, image.bytes, { flag: 'wx', mode: 0o600 });
    const { stdout } = await run('powershell.exe', [...args, '-ImagePath', file], {
      timeout: 20000, maxBuffer: 256000, windowsHide: true
    });
    return stdout;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function parseDanfe(text) {
  const campos = { numero: null, serie: null, chave: null, cnpj: null, fornecedor: null, emissao: null, valor: null };
  const confianca = {};
  function put(name, value, confidence) {
    if (value !== undefined && value !== null) {
      campos[name] = value;
      confianca[name] = confidence;
    }
  }
  const chave = (text.match(/\b\d{44}\b|(?:\b\d{4}[ .]+){10}\d{4}\b/g) ?? []).map(digits).find(value => value.length === 44);
  if (chave) {
    put('chave', chave, 0.99);
    put('cnpj', chave.slice(6, 20), 0.95);
    put('serie', String(Number(chave.slice(22, 25))), 0.95);
    put('numero', String(Number(chave.slice(25, 34))), 0.95);
  }
  if (!campos.numero) put('numero', text.match(/N[ºo°.\s]*\s*([\d.]{3,15})/i)?.[1], 0.7);
  if (!campos.serie) put('serie', text.match(/S[ÉE]RIE\s*:?\s*(\d{1,3})/i)?.[1], 0.75);
  if (!campos.cnpj) put('cnpj', text.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/)?.[0]?.replace(/\D/g, ''), 0.9);
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  put('fornecedor', lines.find(line => line.length > 8 && line.length < 90 &&
    /(LTDA|S\.?A\.?$|EIRELI|\sME$|MATERIAIS|COM[ÉE]RCIO|IND[ÚU]STRIA)/i.test(line)), 0.7);
  put('emissao', text.match(/\b\d{2}\/\d{2}\/\d{4}\b/)?.[0], 0.75);
  const totalValue = (text.match(/VALOR\s+TOTAL\s+DA\s+N(?:OTA|F)[\s\S]{0,40}?([\d.]+,\d{2})/i)
    ?? text.match(/VALOR\s+TOTAL[\s\S]{0,40}?([\d.]+,\d{2})/i))?.[1];
  if (totalValue) put('valor', money(totalValue), 0.8);
  const itens = [];
  for (const line of lines) {
    const item = line.match(/^(\S{2,20})\s+(.{5,60}?)\s+([\d.]{4,12})\s+([A-Z]{2,3})\s+([\d.,]+)\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})$/);
    if (item) itens.push({ codigo: item[1], descricao: item[2], ncm: item[3], unidade: item[4],
      qtd: money(item[5]), valorUnitario: money(item[6]), valorTotal: money(item[7]), confianca: 0.7 });
  }
  const weights = Object.values(confianca);
  return { campos, confianca, itens, reconhecidos: weights.length, total: Object.keys(campos).length,
    confiancaGeral: weights.length ? weights.reduce((sum, value) => sum + value, 0) / weights.length : 0 };
}

function decodeImage({ tipo, base64 }) {
  const extension = { 'image/png': 'png', 'image/jpeg': 'jpg' }[tipo];
  if (!extension || typeof base64 !== 'string' || base64.length > 1400000 ||
      base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw fail('OCR_ARQUIVO_INVALIDO');
  const bytes = Buffer.from(base64, 'base64');
  const valid = extension === 'png' ? bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
    : bytes.subarray(0, 3).toString('hex') === 'ffd8ff';
  if (!valid) throw fail('OCR_ARQUIVO_INVALIDO');
  return { bytes, extension };
}

function createOcrEngine({ core, store, coordinate, extract = runWindows, clock = () => new Date() }) {
  return async (token, action, input = {}) => {
    await core.authorizeSession(token, 'ocr:read');
    if (action === 'disponivel') {
      const disponivel = await extract().then(() => true, () => false);
      return { ok: true, dados: { disponivel, motor: 'Windows OCR',
        mensagem: disponivel ? 'OCR local pronto para uso.' : 'OCR local indisponível.' } };
    }
    if (action !== 'ler') return { ok: false, codigo: 'ACAO_DESCONHECIDA' };
    await core.authorizeSession(token, 'ocr:write');
    if (!input.base64) return { ok: false, codigo: 'ARQUIVO_AUSENTE', mensagem: 'Nenhum arquivo recebido para leitura.' };
    if (typeof input.operation !== 'string' || !/^[\w-]{1,80}$/.test(input.operation)) throw fail('OCR_OPERACAO_INVALIDA');
    const image = decodeImage(input);
    const actor = String((await core.getSession(token)).userId);
    const fingerprint = createHash('sha256').update(JSON.stringify([actor, input.tipo])).update(image.bytes).digest('hex');
    const id = 'OCR-' + createHash('sha256').update(input.operation).digest('hex').slice(0, 24);
    const replay = events => {
      const prior = events.find(event => event.operation === input.operation);
      if (prior && prior.fingerprint !== fingerprint) throw fail('OCR_CONFLITO_IDEMPOTENCIA');
      return prior?.response;
    };
    const prior = replay(await store.events());
    if (prior) return prior;
    let text;
    try { text = await extract(image); } catch { throw fail('OCR_EXTRACAO_FALHOU'); }
    if (typeof text !== 'string' || !text.trim()) throw fail('OCR_SEM_TEXTO');
    const parsed = parseDanfe(text.slice(0, 8000));
    const response = { ok: true, dados: { ...parsed, arquivoId: null, textoBruto: text.slice(0, 4000) } };
    return coordinate(async () => {
      const duplicate = replay(await store.events());
      if (duplicate) return duplicate;
      const event = { id, operation: input.operation, version: 1, actor, fingerprint, action: 'OCR_EXECUTADO',
        at: clock().toISOString(), note: { id, reconhecidos: parsed.reconhecidos }, response };
      let writeError;
      try { await store.append(event); } catch (error) { writeError = error; }
      const persisted = replay(await store.events().catch(error => { throw writeError ?? error; }));
      if (persisted) return persisted;
      throw writeError ?? fail('OCR_NAO_CONFIRMADO');
    });
  };
}

module.exports = { createOcrEngine, parseDanfe };
