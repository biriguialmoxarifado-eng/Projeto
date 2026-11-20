'use strict';

const assert = require('node:assert/strict');

const {
  AuthorizationManager
} = require('../core/security/authorization-manager');

function criarGerenciador() {
  const auditoria = [];

  const manager = new AuthorizationManager({
    audit: evento => auditoria.push(evento)
  });

  manager.registerRole('OPERADOR', [
    'ESTOQUE.CONSULTAR',
    'MOVIMENTO.REGISTRAR'
  ]);

  manager.registerRole('GESTOR', [
    'ESTOQUE.CONSULTAR',
    'MOVIMENTO.REGISTRAR',
    'USUARIO.GERENCIAR'
  ]);

  return { manager, auditoria };
}

function executarTeste(nome, executar) {
  executar();
  process.stdout.write('OK: ' + nome + '\n');
}

function executarTestes() {
  let total = 0;

  executarTeste('Autoriza perfil com permissão cadastrada', () => {
    const { manager } = criarGerenciador();

    assert.equal(
      manager.can(
        { userId: 'u1', role: 'OPERADOR', status: 'active' },
        'ESTOQUE.CONSULTAR'
      ),
      true
    );
    total++;
  });

  executarTeste('Bloqueia permissão não cadastrada no perfil', () => {
    const { manager } = criarGerenciador();

    assert.equal(
      manager.can(
        { userId: 'u1', role: 'OPERADOR', status: 'active' },
        'USUARIO.GERENCIAR'
      ),
      false
    );
    total++;
  });

  executarTeste('Bloqueia sessão ausente', () => {
    const { manager } = criarGerenciador();

    assert.equal(
      manager.can(null, 'ESTOQUE.CONSULTAR'),
      false
    );
    total++;
  });

  executarTeste('Bloqueia sessão inativa', () => {
    const { manager } = criarGerenciador();

    assert.equal(
      manager.can(
        { userId: 'u1', role: 'GESTOR', status: 'inactive' },
        'USUARIO.GERENCIAR'
      ),
      false
    );
    total++;
  });

  executarTeste('Bloqueia sessão sem usuário ou perfil', () => {
    const { manager } = criarGerenciador();

    assert.equal(
      manager.can(
        { status: 'active', role: 'GESTOR' },
        'USUARIO.GERENCIAR'
      ),
      false
    );

    assert.equal(
      manager.can(
        { status: 'active', userId: 'u1' },
        'USUARIO.GERENCIAR'
      ),
      false
    );
    total++;
  });

  executarTeste('Bloqueia permissão vazia ou inválida', () => {
    const { manager } = criarGerenciador();

    const session = {
      userId: 'u1',
      role: 'GESTOR',
      status: 'active'
    };

    assert.equal(manager.can(session, ''), false);
    assert.equal(manager.can(session, null), false);
    total++;
  });

  executarTeste('Rejeita cadastro de perfil inválido', () => {
    const { manager } = criarGerenciador();

    assert.throws(
      () => manager.registerRole('', []),
      /Perfil inválido/
    );

    assert.throws(
      () => manager.registerRole('OPERADOR', 'ESTOQUE'),
      /Permissões inválidas/
    );
    total++;
  });

  executarTeste('Libera autorização permitida', () => {
    const { manager } = criarGerenciador();

    assert.equal(
      manager.authorize(
        { userId: 'u1', role: 'GESTOR', status: 'active' },
        'USUARIO.GERENCIAR'
      ),
      true
    );
    total++;
  });

  executarTeste('Bloqueia autorização negada', () => {
    const { manager } = criarGerenciador();

    assert.throws(
      () => manager.authorize(
        { userId: 'u1', role: 'OPERADOR', status: 'active' },
        'USUARIO.GERENCIAR'
      ),
      erro => erro.code === 'ACCESS_DENIED'
    );
    total++;
  });

  executarTeste('Registra auditoria de acessos permitidos e negados', () => {
    const { manager, auditoria } = criarGerenciador();

    manager.authorize(
      { userId: 'u1', role: 'GESTOR', status: 'active' },
      'ESTOQUE.CONSULTAR'
    );

    assert.throws(
      () => manager.authorize(
        { userId: 'u2', role: 'OPERADOR', status: 'active' },
        'USUARIO.GERENCIAR'
      ),
      erro => erro.code === 'ACCESS_DENIED'
    );

    assert.equal(auditoria.length, 2);
    assert.equal(auditoria[0].allowed, true);
    assert.equal(auditoria[1].allowed, false);
    assert.equal(auditoria[1].userId, 'u2');
    total++;
  });

  process.stdout.write(
    '\n' + total + ' testes do Authorization Manager aprovados.\n'
  );
}

try {
  executarTestes();
} catch (erro) {
  process.stderr.write('FALHA: ' + erro.stack + '\n');
  process.exitCode = 1;
}
