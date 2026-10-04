
/* ============================================================
   ALMOX-PRO — LIBERAR A PONTE PARA A PÁGINA
   ============================================================
   O PROBLEMA QUE ISTO RESOLVE
     A ponte está no ar e responde quando você digita
     http://127.0.0.1:8789 na barra do navegador. Mas a tela de
     biometria diz "a ponte não respondeu".

     Os dois são verdade. Quando VOCÊ digita o endereço, não há
     página nenhuma pedindo — é você pedindo. Quando a tela pede,
     quem pede é uma página servida de fora (o GitHub Pages), e o
     Chrome não deixa uma página da internet falar com um programa
     da sua própria máquina sem que esse programa autorize.

     A autorização são três cabeçalhos de resposta. É só isso.

   COMO USAR  (uma linha no almoxa-bio-ponte.js)

     const liberar = require('./almoxa-bio-cors');

     http.createServer(function (req, res) {
       if (liberar(req, res)) return;     // <- esta linha, antes de tudo
       ... o resto do seu código continua igual ...
     })

     A função devolve true quando ela mesma já respondeu (o pedido
     de permissão, que o navegador manda antes do pedido de verdade).
     Nesse caso o seu código não precisa fazer mais nada.

   DEPOIS DE COLAR
     Pare a ponte e abra de novo. Na tela, clique em "Reconferir a
     ponte". Não precisa mexer no ALMOX-PRO.

   SOBRE SEGURANÇA
     Isto NÃO abre a sua máquina para a internet. A ponte continua
     atendendo só em 127.0.0.1, que ninguém de fora alcança. O que
     muda é que a página do ALMOX-PRO passa a ser aceita como quem
     pergunta. Se você quiser fechar mais ainda, preencha a lista
     ORIGENS abaixo com os endereços do seu sistema e só eles passam.
   ============================================================ */

'use strict';

/* Vazia = aceita qualquer origem (continua valendo só para quem está
   nesta máquina). Para fechar, escreva os endereços do seu ALMOX-PRO:
   ORIGENS = ['https://biriguialmoxarifado-eng.github.io', 'http://localhost:8080'] */
var ORIGENS = [];

function origemLiberada(origem) {
  if (!origem) return '*';
  if (!ORIGENS.length) return origem;
  return ORIGENS.indexOf(origem) > -1 ? origem : '';
}

function liberar(req, res) {
  var origem = req.headers.origin || '';
  var permitida = origemLiberada(origem);

  if (!permitida) {
    /* origem fora da lista: responde a recusa de forma explicada,
       em vez de deixar o navegador falhar sem dizer por quê */
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: false,
      codigo: 'ORIGEM_NAO_AUTORIZADA',
      mensagem: 'A ponte não aceita pedidos vindos de ' + origem +
        '. Acrescente esse endereço na lista ORIGENS do almoxa-bio-cors.js.'
    }));
    return true;
  }

  res.setHeader('Access-Control-Allow-Origin', permitida);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '600');

  /* ESTE é o cabeçalho que falta na maioria dos casos. O Chrome chama
     isso de "acesso à rede privada": uma página da internet pedindo
     para um endereço da sua própria máquina. Sem ele, o pedido morre
     antes de sair, e a tela não tem como saber por quê. */
  if (req.headers['access-control-request-private-network']) {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }

  /* O navegador manda um OPTIONS antes do pedido de verdade, só para
     perguntar se pode. Ele não chega no resto do seu código. */
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  return false;
}

module.exports = liberar;
module.exports.liberar = liberar;
module.exports.ORIGENS = ORIGENS;
