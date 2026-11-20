'use strict';

/**
 * ALMOXA PRO — CORE V2
 * Versão 2.1.0
 *
 * Responsabilidades:
 * - Registro e ciclo de vida dos módulos.
 * - Controle de dependências.
 * - Comunicação por eventos.
 * - Diagnóstico de saúde.
 * - Contratos de sessão, autorização e auditoria.
 *
 * Não contém regras de estoque, compras ou inventário.
 */

const CORE_VERSION = '2.1.0';

class CoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CoreError';
    this.code = code;
    this.details = details;
  }
}

class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(name, callback) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new CoreError('INVALID_EVENT', 'Evento inválido.');
    }

    if (typeof callback !== 'function') {
      throw new CoreError('INVALID_CALLBACK', 'Callback inválido.');
    }

    if (!this.listeners.has(name)) {
      this.listeners.set(name, new Set());
    }

    this.listeners.get(name).add(callback);

    return () => this.off(name, callback);
  }

  off(name, callback) {
    const listeners = this.listeners.get(name);
    if (!listeners) return false;

    const removed = listeners.delete(callback);

    if (listeners.size === 0) {
      this.listeners.delete(name);
    }

    return removed;
  }

  emit(name, payload) {
    const listeners = this.listeners.get(name);
    if (!listeners) return { delivered: 0, errors: [] };

    let delivered = 0;
    const errors = [];

    for (const callback of [...listeners]) {
      try {
        callback(payload);
        delivered++;
      } catch (error) {
        errors.push({
          code: 'EVENT_HANDLER_FAILED',
          message: error.message
        });
      }
    }

    return { delivered, errors };
  }

  async emitAsync(name, payload) {
    const listeners = this.listeners.get(name);
    if (!listeners) return { delivered: 0, errors: [] };

    const results = await Promise.allSettled(
      [...listeners].map(callback =>
        Promise.resolve().then(() => callback(payload))
      )
    );

    return {
      delivered: results.filter(r => r.status === 'fulfilled').length,
      errors: results
        .filter(r => r.status === 'rejected')
        .map(r => ({
          code: 'EVENT_HANDLER_FAILED',
          message: r.reason?.message || 'Falha desconhecida.'
        }))
    };
  }

  clear() {
    this.listeners.clear();
  }
}

class AlmoxaCore {
  constructor(options = {}) {
    this.modules = new Map();
    this.events = new EventBus();

    this.started = false;
    this.starting = false;

    this.options = {
      authorizationProvider: options.authorizationProvider || null,
      sessionProvider: options.sessionProvider || null,
      auditProvider: options.auditProvider || null,
      clock: options.clock || (() => new Date())
    };
  }

  registerModule(definition) {
    if (!definition || typeof definition !== 'object') {
      throw new CoreError('INVALID_MODULE', 'Definição inválida.');
    }

    const {
      id,
      version,
      initialize,
      healthcheck,
      dependencies = []
    } = definition;

    if (
      typeof id !== 'string' || !id.trim() ||
      typeof version !== 'string' || !version.trim()
    ) {
      throw new CoreError(
        'INVALID_MODULE',
        'O módulo precisa de identificador e versão.'
      );
    }

    if (this.modules.has(id)) {
      throw new CoreError(
        'DUPLICATE_MODULE',
        `O módulo ${id} já está registrado.`
      );
    }

    if (initialize !== undefined && typeof initialize !== 'function') {
      throw new CoreError(
        'INVALID_INITIALIZER',
        'initialize precisa ser uma função.'
      );
    }

    if (healthcheck !== undefined && typeof healthcheck !== 'function') {
      throw new CoreError(
        'INVALID_HEALTHCHECK',
        'healthcheck precisa ser uma função.'
      );
    }

    if (
      !Array.isArray(dependencies) ||
      dependencies.some(dep => typeof dep !== 'string' || !dep.trim())
    ) {
      throw new CoreError(
        'INVALID_DEPENDENCIES',
        'Dependências inválidas.'
      );
    }

    this.modules.set(id, {
      id,
      version,
      dependencies: [...dependencies],
      initialize: initialize || null,
      healthcheck: healthcheck || null,
      status: 'registered',
      registeredAt: this.options.clock().toISOString(),
      initializedAt: null,
      lastError: null
    });

    return this.getModule(id);
  }

  getModule(id) {
    const module = this.modules.get(id);
    if (!module) return null;

    const { initialize, healthcheck, ...publicData } = module;

    return {
      ...publicData,
      dependencies: [...module.dependencies]
    };
  }

  listModules() {
    return [...this.modules.keys()].map(id => this.getModule(id));
  }

  async start() {
    if (this.started || this.starting) {
      throw new CoreError(
        'CORE_ALREADY_STARTED',
        'O Core já foi iniciado ou está iniciando.'
      );
    }

    this.starting = true;

    try {
      for (const module of this.modules.values()) {
        const missing = module.dependencies.filter(
          id => !this.modules.has(id)
        );

        if (missing.length) {
          module.status = 'blocked';

          throw new CoreError(
            'MODULE_DEPENDENCY_MISSING',
            `Dependência ausente no módulo ${module.id}.`,
            { moduleId: module.id, missing }
          );
        }
      }

      const pending = new Set(this.modules.keys());
      const ordered = [];

      while (pending.size) {
        let progressed = false;

        for (const id of [...pending]) {
          const module = this.modules.get(id);

          if (module.dependencies.every(dep => ordered.includes(dep))) {
            ordered.push(id);
            pending.delete(id);
            progressed = true;
          }
        }

        if (!progressed) {
          throw new CoreError(
            'MODULE_DEPENDENCY_CYCLE',
            'Ciclo de dependências detectado.',
            { modules: [...pending] }
          );
        }
      }

      for (const id of ordered) {
        const module = this.modules.get(id);

        try {
          if (module.initialize) {
            await module.initialize({
              coreVersion: CORE_VERSION,
              emit: this.emit.bind(this),
              on: this.on.bind(this),
              getModule: this.getModule.bind(this)
            });
          }

          module.status = 'initialized';
          module.initializedAt = this.options.clock().toISOString();
          module.lastError = null;

        } catch (error) {
          module.status = 'error';
          module.lastError = {
            code: 'MODULE_INITIALIZATION_FAILED',
            message: error.message
          };

          throw new CoreError(
            'MODULE_INITIALIZATION_FAILED',
            `Falha ao iniciar ${module.id}: ${error.message}`,
            { moduleId: module.id }
          );
        }
      }

      this.started = true;

      this.emit('core.started', {
        version: CORE_VERSION
      });

      return this.health();

    } finally {
      this.starting = false;
    }
  }

  async stop() {
    for (const module of [...this.modules.values()].reverse()) {
      if (module.status === 'initialized') {
        module.status = 'stopped';
      }
    }

    this.started = false;

    this.emit('core.stopped', {
      version: CORE_VERSION
    });

    return this.health();
  }

  async health() {
    const modules = [];

    for (const module of this.modules.values()) {
      let status = module.status;

      if (module.healthcheck && module.status === 'initialized') {
        try {
          if (await module.healthcheck() === false) {
            status = 'unhealthy';
          }
        } catch (_) {
          status = 'unhealthy';
        }
      }

      modules.push({
        id: module.id,
        version: module.version,
        status,
        dependencies: [...module.dependencies],
        lastError: module.lastError
      });
    }

    const degraded = modules.some(module =>
      ['error', 'unhealthy', 'blocked'].includes(module.status)
    );

    return {
      system: 'ALMOXA PRO',
      coreVersion: CORE_VERSION,
      started: this.started,
      status: degraded
        ? 'degraded'
        : this.started ? 'healthy' : 'stopped',
      modules,
      timestamp: this.options.clock().toISOString()
    };
  }

  on(name, callback) {
    return this.events.on(name, callback);
  }

  off(name, callback) {
    return this.events.off(name, callback);
  }

  emit(name, payload) {
    return this.events.emit(name, payload);
  }

  emitAsync(name, payload) {
    return this.events.emitAsync(name, payload);
  }

  async getSession(token) {
    if (
      !this.options.sessionProvider ||
      typeof this.options.sessionProvider.validate !== 'function'
    ) {
      throw new CoreError(
        'SESSION_PROVIDER_NOT_CONFIGURED',
        'Provedor de sessão não configurado ou inválido.'
      );
    }

    const result = await this.options.sessionProvider.validate(token);

    if (
      !result ||
      result.valid !== true ||
      !result.session
    ) {
      throw new CoreError(
        'SESSION_INVALID',
        'Sessão inválida ou não autorizada.'
      );
    }

    return result.session;
  }

    return this.options.sessionProvider.getActiveSession(sessionId);
  }

  async authorize(context, permission) {
    if (!this.options.authorizationProvider) {
      throw new CoreError(
        'AUTHORIZATION_PROVIDER_NOT_CONFIGURED',
        'Provedor de autorização não configurado.'
      );
    }

    const allowed = await this.options.authorizationProvider.authorize(
      context,
      permission
    );

    if (allowed !== true) {
      throw new CoreError(
        'ACCESS_DENIED',
        'Ação não autorizada.',
        { permission }
      );
    }

    return true;
  }

  async audit(entry) {
    if (
      !this.options.auditProvider ||
      typeof this.options.auditProvider.record !== 'function'
    ) {
      throw new CoreError(
        'AUDIT_PROVIDER_NOT_CONFIGURED',
        'Provedor de auditoria não configurado.'
      );
    }

    return this.options.auditProvider.record({
      ...entry,
      occurredAt: this.options.clock().toISOString(),
      coreVersion: CORE_VERSION
    });
  }

  error(code, message, details) {
    return new CoreError(code, message, details);
  }
}

const core = new AlmoxaCore();

module.exports = {
  CORE_VERSION,
  CoreError,
  EventBus,
  AlmoxaCore,
  core
};
