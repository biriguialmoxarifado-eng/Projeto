'use strict';

const assert = require('node:assert/strict');

const {
  SessionManager,
  sha256
} = require('../core/security/session-manager');

function criarAmbiente(opcoes = {}) {
  const registros = new Map();
  const auditoria = [];
  const eventos = [];

  const usuarios = new Map([
    ['u1', {
      id: 'u1',
      name: 'Operador',
      role: 'OPERADOR',
      status: 'ATIVO'
    }],
    ['u2', {
      id: 'u2',
      name: 'Usuario inativo',
      role: 'OPERADOR',
      status: 'INATIVO'
    }]
  ]);

  const store = {
    async create(registro) {
      registros.set(registro.tokenHash, { ...registro });
    },

    async findByTokenHash(hash) {
      const registro = registros.get(hash);
      return registro ? { ...registro } : null;
    },

    async updateByTokenHash(hash, alteracoes) {
      const registro = registros.get(hash);
      if (!registro) throw new Error('Sessao nao encontrada.');
      Object.assign(registro, alteracoes);
    }
  };

  const manager = new SessionManager({
    store,
    userProvider: {
      async getById(id) {
        return usuarios.get(id) || null;
      }
    },
    auditProvider: {
      async record(evento) {
        auditoria.push(evento);
      }
    },
    eventBus: {
      emit(nome, dados) {
        eventos.push({ nome, dados });
      }
    },
    clock: opcoes.clock || (() => new Date('2026-11-20T12:00:00.000Z')),
    ttlMs: opcoes.ttlMs || 60000
  });

  return { manager, registros, usuarios, auditoria, eventos };
}

async function teste(nome, executar) {
  await executar();
  process.stdout.write('OK: ' + nome + '\n');
}

async function executarTestes() {
  let total = 0;

  await teste('Gera hash SHA-256', async () => {
    assert.equal(sha256('teste').length, 64);
    total++;
  });

  await teste('Cria sessao segura', async () => {
    const h = criarAmbiente();
    const resultado = await h.manager.create({
      userId: 'u1',
      authMethod: 'badge'
    });

    assert.ok(resultado.token);
    assert.equal(resultado.session.status, 'ACTIVE');

    const salvo = [...h.registros.values()][0];
    assert.notEqual(salvo.tokenHash, resultado.token);
    assert.equal(Object.hasOwn(salvo, 'token'), false);
    total++;
  });

  await teste('Valida sessao ativa', async () => {
    const h = criarAmbiente();
    const criada = await h.manager.create({ userId: 'u1' });
    const resultado = await h.manager.validate(criada.token);

    assert.equal(resultado.valid, true);
    assert.equal(resultado.user.id, 'u1');
    total++;
  });

  await teste('Bloqueia usuario inativo', async () => {
    const h = criarAmbiente();

    await assert.rejects(
      () => h.manager.create({ userId: 'u2' }),
      erro => erro.code === 'SESSION_USER_INACTIVE'
    );
    total++;
  });

  await teste('Rejeita token desconhecido', async () => {
    const h = criarAmbiente();

    await assert.rejects(
      () => h.manager.validate('x'.repeat(40)),
      erro => erro.code === 'SESSION_NOT_FOUND'
    );
    total++;
  });

  await teste('Expira sessao', async () => {
    let agora = new Date('2026-11-20T12:00:00.000Z');

    const h = criarAmbiente({
      clock: () => agora,
      ttlMs: 1000
    });

    const criada = await h.manager.create({ userId: 'u1' });
    agora = new Date('2026-11-20T12:00:02.000Z');

    await assert.rejects(
      () => h.manager.validate(criada.token),
      erro => erro.code === 'SESSION_EXPIRED'
    );

    const salvo = [...h.registros.values()][0];
    assert.equal(salvo.status, 'EXPIRED');
    total++;
  });

  await teste('Revoga sessao', async () => {
    const h = criarAmbiente();
    const criada = await h.manager.create({ userId: 'u1' });

    const resultado = await h.manager.revoke(criada.token);

    assert.equal(resultado.revoked, true);

    await assert.rejects(
      () => h.manager.validate(criada.token),
      erro => erro.code === 'SESSION_REVOKED'
    );
    total++;
  });

  await teste('Registra auditoria e eventos', async () => {
    const h = criarAmbiente();
    const criada = await h.manager.create({ userId: 'u1' });

    await h.manager.revoke(criada.token);

    assert.ok(h.auditoria.some(
      e => e.action === 'SESSION_CREATED'
    ));

    assert.ok(h.auditoria.some(
      e => e.action === 'SESSION_REVOKED'
    ));

    assert.ok(h.eventos.some(
      e => e.nome === 'session.created'
    ));

    assert.ok(h.eventos.some(
      e => e.nome === 'session.revoked'
    ));
    total++;
  });

  process.stdout.write(
    '\n' + total + ' testes do Session Manager aprovados.\n'
  );
}

executarTestes().catch(erro => {
  process.stderr.write('FALHA: ' + erro.stack + '\n');
  process.exitCode = 1;
});
