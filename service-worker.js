'use strict';

const CACHE = 'almoxa-campo-433-casca';
const CAMPO = 'ALMOXA_CAMPO.html.html';
const ARQUIVOS = [
  CAMPO,
  'manifest.webmanifest',
  'icons/icone-64.png',
  'icons/icone-192.png',
  'icons/icone-512.png',
  'icons/icone-192-recortavel.png',
  'icons/icone-512-recortavel.png'
];
const PUBLICOS = new Set(ARQUIVOS.map(arquivo => new URL(arquivo, self.registration.scope).href));

self.addEventListener('install', evento => {
  evento.waitUntil(caches.open(CACHE).then(cache => cache.addAll([...PUBLICOS])));
});

self.addEventListener('activate', evento => {
  evento.waitUntil(self.clients.claim());
});

self.addEventListener('message', evento => {
  if (evento.data?.almoxaSw === 'trocar-agora') evento.waitUntil(self.skipWaiting());
  if (evento.data?.almoxaSw === 'quem-e-voce' && evento.source) {
    evento.source.postMessage({ almoxaSw: 'sou', versao: CACHE });
  }
});

self.addEventListener('fetch', evento => {
  const pedido = evento.request;
  if (pedido.method !== 'GET' || !PUBLICOS.has(pedido.url)) return;
  evento.respondWith(redeComReserva(pedido));
});

async function redeComReserva(pedido) {
  let resposta;
  try {
    resposta = await fetch(pedido);
  } catch (erro) {
    const cache = await caches.open(CACHE);
    const guardado = await cache.match(pedido);
    return guardado || Response.error();
  }
  if (resposta.ok && !resposta.redirected) {
    try {
      const cache = await caches.open(CACHE);
      await cache.put(pedido, resposta.clone());
    } catch (erro) {
      // A resposta da rede continua utilizável se a cota de cache acabar.
    }
  }
  return resposta;
}
