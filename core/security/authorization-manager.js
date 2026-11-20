'use strict';

/**
 * ALMOXA PRO V2
 * Gerenciador central de autorizações.
 *
 * A autenticação e a validação da sessão
 * devem acontecer antes desta camada.
 */

class AuthorizationManager {
  constructor(options = {}) {
    this.permissions = new Map();
    this.audit = options.audit || null;
  }

  registerRole(role, permissions = []) {
    if (typeof role !== 'string' || !role.trim()) {
      throw new Error('Perfil inválido');
    }

    if (!Array.isArray(permissions)) {
      throw new Error('Permissões inválidas');
    }

    this.permissions.set(role, new Set(permissions));
  }

  can(session, permission) {
    if (!session || session.status !== 'active') {
      return false;
    }

    if (!session.userId || !session.role) {
      return false;
    }

    if (
      typeof permission !== 'string' ||
      !permission.trim()
    ) {
      return false;
    }

    const allowed = this.permissions.get(session.role);

    return Boolean(allowed && allowed.has(permission));
  }

  authorize(session, permission) {
    const allowed = this.can(session, permission);

    if (typeof this.audit === 'function') {
      this.audit({
        userId: session?.userId || null,
        permission,
        allowed,
        timestamp: new Date().toISOString()
      });
    }

    if (!allowed) {
      const error = new Error('Acesso não autorizado');
      error.code = 'ACCESS_DENIED';
      throw error;
    }

    return true;
  }
}

module.exports = { AuthorizationManager };
