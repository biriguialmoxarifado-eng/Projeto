'use strict';

const assert = require('node:assert/strict');
const {
  AlmoxaCore,
  CORE_VERSION,
  CoreError
} = require('../core');

async function executarTestes() {
  let total = 0;

  async function teste(nome, executar) {
    try {
      await executar();
      total++;
      process.stdout.write(`OK ${nome}\n`);
    } catch (erro) {
      process.stderr.write(`FALHOU ${nome}: ${erro.message}\n`);
      throw erro;
    }
  }

  await teste('Versão do Core 2.1.0', () => {
    assert.equal(CORE_VERSION, '2.1.0');
  });

  await teste('Registro de módulo', () => {
    const core = new AlmoxaCore();

    core.registerModule({
      id: 'estoque',
      version: '1.0.0'
    });

    assert.equal(core.getModule('estoque').status, 'registered');
  });

  await teste('Bloqueio de módulo duplicado', () => {
    const core = new AlmoxaCore();

    core.registerModule({
      id: 'estoque',
      version: '1.0.0'
    });

    assert.throws(
      () => core.registerModule({
        id: 'estoque',
        version: '1.0.0'
      }),
      error => error.code === 'DUPLICATE_MODULE'
    );
  });

  await teste('Dependência entre módulos', async () => {
    const core = new AlmoxaCore();
    const ordem = [];

    core.registerModule({
      id: 'estoque',
      version: '1.0.0',
      initialize: async () => ordem.push('estoque')
    });

    core.registerModule({
      id: 'notas',
      version: '1.0.0',
      dependencies: ['estoque'],
      initialize: async () => ordem.push('notas')
    });

    await core.start();

    assert.deepEqual(ordem, ['estoque', 'notas']);
  });

  await teste('Bloqueio de dependência inexistente', async () => {
    const core = new AlmoxaCore();

    core.registerModule({
      id: 'notas',
      version: '1.0.0',
      dependencies: ['estoque']
    });

    await assert.rejects(
      () => core.start(),
      error => error.code === 'MODULE_DEPENDENCY_MISSING'
    );
  });

  await teste('Detecção de ciclo de dependências', async () => {
    const core = new AlmoxaCore();

    core.registerModule({
      id: 'modulo.a',
      version: '1.0.0',
      dependencies: ['modulo.b']
    });

    core.registerModule({
      id: 'modulo.b',
      version: '1.0.0',
      dependencies: ['modulo.a']
    });

    await assert.rejects(
      () => core.start(),
      error => error.code === 'MODULE_DEPENDENCY_CYCLE'
    );
  });

  await teste('Inicialização do módulo', async () => {
    const core = new AlmoxaCore();
    let inicializado = false;

    core.registerModule({
      id: 'teste',
      version: '1.0.0',
      initialize: async () => {
        inicializado = true;
      }
    });

    await core.start();

    assert.equal(inicializado, true);
    assert.equal(core.getModule('teste').status, 'initialized');
  });

  await teste('Bloqueio de segunda inicialização', async () => {
    const core = new AlmoxaCore();

    await core.start();

    await assert.rejects(
      () => core.start(),
      error => error.code === 'CORE_ALREADY_STARTED'
    );
  });

  await teste('Comunicação por eventos', () => {
    const core = new AlmoxaCore();
    let recebido = null;

    core.on('estoque.atualizado', payload => {
      recebido = payload.quantidade;
    });

    const resultado = core.emit('estoque.atualizado', {
      quantidade: 25
    });

    assert.equal(resultado.delivered, 1);
    assert.equal(resultado.errors.length, 0);
    assert.equal(recebido, 25);
  });

  await teste('Comunicação assíncrona', async () => {
    const core = new AlmoxaCore();
    let recebido = false;

    core.on('teste.async', async () => {
      recebido = true;
    });

    const resultado = await core.emitAsync('teste.async', {});

    assert.equal(resultado.delivered, 1);
    assert.equal(recebido, true);
  });

  await teste('Cancelamento de evento', () => {
    const core = new AlmoxaCore();
    let chamadas = 0;

    const cancelar = core.on('teste.evento', () => {
      chamadas++;
    });

    cancelar();
    core.emit('teste.evento', {});

    assert.equal(chamadas, 0);
  });

  await teste('Diagnóstico de saúde', async () => {
    const core = new AlmoxaCore();

    core.registerModule({
      id: 'teste.saude',
      version: '1.0.0',
      healthcheck: async () => true
    });

    const resultado = await core.health();

    assert.equal(resultado.system, 'ALMOXA PRO');
    assert.equal(resultado.coreVersion, '2.1.0');
    assert.equal(resultado.modules.length, 1);
    assert.equal(resultado.status, 'stopped');
  });

  await teste('Falha de inicialização identificada', async () => {
    const core = new AlmoxaCore();

    core.registerModule({
      id: 'teste.falha',
      version: '1.0.0',
      initialize: async () => {
        throw new Error('Falha controlada');
      }
    });

    await assert.rejects(
      () => core.start(),
      error => error.code === 'MODULE_INITIALIZATION_FAILED'
    );

    assert.equal(core.getModule('teste.falha').status, 'error');
  });

  await teste('Autorização bloqueada sem provedor', async () => {
    const core = new AlmoxaCore();

    await assert.rejects(
      () => core.authorize(
        { userId: 'teste' },
        'NF.EDITAR'
      ),
      error => error.code === 'AUTHORIZATION_PROVIDER_NOT_CONFIGURED'
    );
  });

  await teste('Auditoria bloqueada sem provedor', async () => {
    const core = new AlmoxaCore();

    await assert.rejects(
      () => core.audit({ action: 'TESTE' }),
      error => error.code === 'AUDIT_PROVIDER_NOT_CONFIGURED'
    );
  });

  await teste('Erro padronizado', () => {
    const erro = new CoreError(
      'TEST_ERROR',
      'Erro de teste'
    );

    assert.equal(erro.code, 'TEST_ERROR');
    assert.equal(erro.message, 'Erro de teste');
  });

  process.stdout.write(
    `\n${total} testes concluídos com sucesso.\n`
  );
}

executarTestes().catch(() => {
  process.exitCode = 1;
});
