
'use strict';

const assert = require('node:assert/strict');

const {
  GoogleSheetsProvider,
  GoogleSheetsProviderError
} = require('../adapters/google-sheets-provider');

async function run() {
  const originalFetch = global.fetch;
  const requests = [];

  try {
    // Simula a resposta do Google para testar o contrato.
    global.fetch = async (url, options) => {
      requests.push({
        url,
        options,
        body: JSON.parse(options.body)
      });

      return {
        ok: true,
        status: 200,
        async json() {
          return {
            success: true,
            data: {
              status: 'ok',
              provider: 'google-sheets'
            }
          };
        }
      };
    };

    const provider = new GoogleSheetsProvider({
      url: 'https://example.com/google-script',
      token: 'TEST_TOKEN'
    });

    // 1. Verifica conexão
    const connection = await provider.connect();

    assert.equal(connection.connected, true);
    assert.equal(provider.connected, true);

    // 2. Verifica consulta de saúde
    const health = await provider.healthCheck();

    assert.equal(health.status, 'ok');

    // 3. Verifica envio de consulta por ID
    await provider.findById('materiais', '123');

    const readRequest = requests[2];

    assert.equal(readRequest.body.action, 'findById');
    assert.equal(readRequest.body.payload.table, 'materiais');
    assert.equal(readRequest.body.payload.id, '123');

    // 4. Verifica envio de inserção
    await provider.insert('materiais', {
      nome: 'Material de teste'
    });

    const insertRequest = requests[3];

    assert.equal(insertRequest.body.action, 'insert');
    assert.equal(
      insertRequest.body.payload.data.nome,
      'Material de teste'
    );

    // 5. Verifica token e URL
    assert.equal(
      requests[0].body.token,
      'TEST_TOKEN'
    );

    assert.equal(
      requests[0].url,
      'https://example.com/google-script'
    );

    // 6. Verifica desconexão
    await provider.disconnect();

    assert.equal(provider.connected, false);

    // 7. Verifica configuração ausente
    const invalidProvider = new GoogleSheetsProvider({
      url: '',
      token: ''
    });

    await assert.rejects(
      () => invalidProvider.healthCheck(),
      GoogleSheetsProviderError
    );

    console.log(
      'ALMOXA PRO V2 — GOOGLE SHEETS PROVIDER: TESTES APROVADOS.'
    );

  } finally {
    global.fetch = originalFetch;
  }
}

run().catch(error => {
  console.error(
    'FALHA NO TESTE GOOGLE SHEETS PROVIDER:',
    error
  );

  process.exitCode = 1;
});
