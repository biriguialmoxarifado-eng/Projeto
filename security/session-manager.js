'use strict';

/**
 * ALMOXA PRO — SESSION MANAGER V2
 *
 * Responsabilidades:
 * - Criar sessões seguras.
 * - Validar tokens.
 * - Controlar expiração.
 * - Revogar sessões.
 * - Bloquear usuários inativos.
 * - Registrar auditoria.
 *
 * O armazenamento deve guardar somente o hash do token.
 */

const crypto = require('node:crypto');
const { CoreError } = require('../index');

const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;
const TOKEN_BYTES = 32;

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(value, 'utf8')
    .digest('hex');
}

class SessionManager {
  constructor(options = {}) {
    if (
      !options.store ||
      typeof options.store.create !== 'function' ||
      typeof options.store.findByTokenHash !== 'function' ||
      typeof options.store.updateByTokenHash !== 'function'
    ) {
      throw new CoreError(
        'SESSION_STORE_INVALID',
        'Armazenamento de sessões inválido.'
      );
    }

    if (
      !options.userProvider ||
      typeof options.userProvider.getById !== 'function'
    ) {
      throw new CoreError(
        'SESSION_USER_PROVIDER_INVALID',
        'Provedor de usuários inválido.'
      );
    }

    this.store = options.store;
    this.userProvider = options.userProvider;
    this.auditProvider = options.auditProvider || null;
    this.eventBus = options.eventBus || null;
    this.clock = options.clock || (() => new Date());

    this.ttlMs =
      Number.isFinite(options.ttlMs) && options.ttlMs > 0
        ? options.ttlMs
        : DEFAULT_TTL_MS;
  }

  async create(input = {}) {
    const userId = String(input.userId || '').trim();

    if (!userId) {
      throw new CoreError(
        'SESSION_USER_REQUIRED',
        'Identificador do usuário obrigatório.'
      );
    }

    const user = await this.userProvider.getById(userId);

    if (!user || String(user.status || '').toUpperCase() !== 'ATIVO') {
      throw new CoreError(
        'SESSION_USER_INACTIVE',
        'Usuário inexistente ou inativo.'
      );
    }

    const now = this.clock();
    const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
    const tokenHash = sha256(token);
    const expiresAt = new Date(now.getTime() + this.ttlMs);

    const record = {
      tokenHash,
      userId,
      role: String(user.role || user.perfil || ''),
      authMethod: String(input.authMethod || 'unknown'),
      deviceId: String(input.deviceId || '').slice(0, 120),
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      status: 'ACTIVE',
      revokedAt: null,
      revokedReason: null
    };

    await this.store.create(record);

    await this._audit({
      action: 'SESSION_CREATED',
      userId,
      authMethod: record.authMethod,
      deviceId: record.deviceId
    });

    this._emit('session.created', {
      userId,
      authMethod: record.authMethod
    });

    // O token bruto é entregue somente nesta resposta.
    return {
      token,
      session: this._publicSession(record)
    };
  }

  async validate(token) {
    if (
      typeof token !== 'string' ||
      token.length < 20 ||
      token.length > 512
    ) {
      throw new CoreError(
        'SESSION_TOKEN_INVALID',
        'Token de sessão inválido.'
      );
    }

    const tokenHash = sha256(token);
    const record = await this.store.findByTokenHash(tokenHash);

    if (!record || record.tokenHash !== tokenHash) {
      throw new CoreError(
        'SESSION_NOT_FOUND',
        'Sessão não encontrada.'
      );
    }

    if (record.status !== 'ACTIVE') {
      throw new CoreError(
        'SESSION_REVOKED',
        'Sessão encerrada ou revogada.'
      );
    }

    const now = this.clock();
    const expiresAt = new Date(record.expiresAt);

    if (
      !Number.isFinite(expiresAt.getTime()) ||
      now.getTime() >= expiresAt.getTime()
    ) {
      await this.store.updateByTokenHash(tokenHash, {
        status: 'EXPIRED',
        revokedAt: now.toISOString(),
        revokedReason: 'TTL_EXPIRED'
      });

      await this._audit({
        action: 'SESSION_EXPIRED',
        userId: record.userId
      });

      this._emit('session.expired', {
        userId: record.userId
      });

      throw new CoreError(
        'SESSION_EXPIRED',
        'Sessão expirada. Faça login novamente.'
      );
    }

    const user = await this.userProvider.getById(record.userId);

    if (!user || String(user.status || '').toUpperCase() !== 'ATIVO') {
      await this.store.updateByTokenHash(tokenHash, {
        status: 'REVOKED',
        revokedAt: now.toISOString(),
        revokedReason: 'USER_INACTIVE'
      });

      await this._audit({
        action: 'SESSION_REVOKED_USER_INACTIVE',
        userId: record.userId
      });

      throw new CoreError(
        'SESSION_USER_INACTIVE',
        'Usuário inativo. Acesso bloqueado.'
      );
    }

    return {
      valid: true,
      session: this._publicSession(record),
      user: {
        id: String(user.id || user.userId || record.userId),
        name: String(user.name || user.nome || ''),
        role: String(user.role || user.perfil || ''),
        status: String(user.status)
      }
    };
  }

  async revoke(token, reason = 'USER_LOGOUT') {
    if (
      typeof token !== 'string' ||
      token.length < 20 ||
      token.length > 512
    ) {
      throw new CoreError(
        'SESSION_TOKEN_INVALID',
        'Token de sessão inválido.'
      );
    }

    const tokenHash = sha256(token);
    const record = await this.store.findByTokenHash(tokenHash);

    if (!record || record.tokenHash !== tokenHash) {
      throw new CoreError(
        'SESSION_NOT_FOUND',
        'Sessão não encontrada.'
      );
    }

    if (record.status !== 'ACTIVE') {
      return {
        revoked: false,
        status: record.status
      };
    }

    const now = this.clock();

    await this.store.updateByTokenHash(tokenHash, {
      status: 'REVOKED',
      revokedAt: now.toISOString(),
      revokedReason: String(reason).slice(0, 120)
    });

    await this._audit({
      action: 'SESSION_REVOKED',
      userId: record.userId,
      reason: String(reason).slice(0, 120)
    });

    this._emit('session.revoked', {
      userId: record.userId,
      reason
    });

    return {
      revoked: true,
      userId: record.userId
    };
  }

  async _audit(event) {
    if (!this.auditProvider) return;

    if (typeof this.auditProvider.record !== 'function') {
      throw new CoreError(
        'SESSION_AUDIT_PROVIDER_INVALID',
        'Provedor de auditoria inválido.'
      );
    }

    await this.auditProvider.record({
      ...event,
      occurredAt: this.clock().toISOString(),
      component: 'SessionManager'
    });
  }

  _emit(name, payload) {
    if (
      this.eventBus &&
      typeof this.eventBus.emit === 'function'
    ) {
      this.eventBus.emit(name, payload);
    }
  }

  _publicSession(record) {
    return {
      userId: record.userId,
      role: record.role,
      authMethod: record.authMethod,
      deviceId: record.deviceId,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      status: record.status
    };
  }
}

module.exports = {
  SessionManager,
  sha256
};
