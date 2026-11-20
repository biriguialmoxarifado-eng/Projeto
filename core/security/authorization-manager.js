'use strict';

/**
 * ALMOXA PRO V2
 * AUTHORIZATION MANAGER
 *
 * Responsabilidades:
 * - Cadastro de permissões por perfil.
 * - Validação de sessão ativa.
 * - Autorização de operações.
 * - Registro de tentativas de acesso.
 *
 * Não contém regras de negócio dos módulos.
 */

class AuthorizationManager {
  constructor(options = {}) {
    this.permissions = new Map();
    this.audit = options.audit || null;
  }

  /**
   * Registra as permissões de um perfil.
   */
  registerRole(role, permissions = []) {
    if (typeof role !== 'string' || !role.trim()) {
      throw new Error('Perfil inválido');
    }

    if (!Array.isArray(permissions)) {
      throw new Error('Permissões inválidas');
    }

    this.permissions.set(
      role,
      new Set(permissions)
    );

    return true;
  }

  /**
   * Verifica se a sessão possui autorização.
   */
  can(session, permission) {
    // Validação da sessão.
    // Aceita ACTIVE e active.
    if (
      !session ||
      String(session.status || '').toUpperCase() !== 'ACTIVE'
    ) {
      return false;
    }

    // Identificação obrigatória.
    if (!session.userId || !session.role) {
      return false;
    }

    // Permissão obrigatória.
    if (
      typeof permission !== 'string' ||
      !permission.trim()
    ) {
      return false;
    }

    // Consulta as permissões do perfil.
    const allowed = this.permissions.get(session.role);

    return Boolean(
      allowed && allowed.has(permission)
    );
  }

  /**
   * Executa a autorização e registra auditoria.
   */
  authorize(session, permission) {
    const allowed = this.can(session, permission);

    if (typeof this.audit === 'function') {
      this.audit({
        userId: session?.userId || null,
        role: session?.role || null,
        permission,
        allowed,
        timestamp: new Date().toISOString()
      });
    }

    if (!allowed) {
      const error = new Error(
        'Acesso não autorizado'
      );

      error.code = 'ACCESS_DENIED';

      throw error;
    }

    return true;
  }
}

module.exports = {
  AuthorizationManager
};
