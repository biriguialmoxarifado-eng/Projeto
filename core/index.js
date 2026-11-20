'use strict';

/**
 * ALMOXA PRO — CORE V2
 * Responsabilidade:
 * - Registro e ciclo de vida dos módulos.
 * - Diagnóstico de saúde.
 * - Padronização de erros.
 * - Eventos internos.
 *
 * Não contém regras de estoque, compras ou inventário.
 */

const CORE_VERSION = '2.0.0';

class AlmoxaCore {
  constructor() {
    this.modules = new Map();
    this.events = new Map();
    this.started = false;
  }

  registerModule(definition) {
    if (!definition || typeof definition !== 'object') {
      throw this.error('INVALID_MODULE', 'Definição inválida.');
    }

    const { id, version, initialize, healthcheck } = definition;

    if (!id || !version) {
      throw this.error(
        'INVALID_MODULE',
        'O módulo precisa de identificador e versão.'
      );
    }

    if (this.modules.has(id)) {
      throw this.error(
        'DUPLICATE_MODULE',
        `O módulo ${id} já está registrado.`
      );
    }

    if (initialize !== undefined &&
        typeof initialize !== 'function') {
      throw this.error(
        'INVALID_INITIALIZER',
        'initialize precisa ser uma função.'
      );
    }

    if (healthcheck !== undefined &&
        typeof healthcheck !== 'function') {
      throw this.error(
        'INVALID_HEALTHCHECK',
        'healthcheck precisa ser uma função.'
      );
    }

    this.modules.set(id, {
      id,
      version,
      initialize: initialize || null,
      healthcheck: healthcheck || null,
      status: 'registered'
    });

    return this.getModule(id);
  }

  getModule(id) {
    const module = this.modules.get(id);
    return module ? { ...module } : null;
  }

  listModules() {
    return Array.from(this.modules.values()).map(module => ({
      id: module.id,
      version: module.version,
      status: module.status
    }));
  }

  async start() {
    if (this.started) {
      throw this.error(
        'CORE_ALREADY_STARTED',
        'O Core já foi iniciado.'
      );
    }

    for (const module of this.modules.values()) {
      if (!module.initialize) {
        module.status = 'registered';
        continue;
      }

      try {
        await module.initialize({
          coreVersion: CORE_VERSION,
          emit: this.emit.bind(this),
          on: this.on.bind(this)
        });

        module.status = 'initialized';
      } catch (err) {
        module.status = 'error';
        throw this.error(
          'MODULE_INITIALIZATION_FAILED',
          `Falha ao iniciar ${module.id}: ${err.message}`
        );
      }
    }

    this.started = true;

    return this.health();
  }

  async health() {
    const results = [];

    for (const module of this.modules.values()) {
      let status = module.status;

      if (module.healthcheck) {
        try {
          const result = await module.healthcheck();
          status = result === false ? 'unhealthy' : status;
        } catch (_) {
          status = 'unhealthy';
        }
      }

      results.push({
        id: module.id,
        version: module.version,
        status
      });
    }

    return {
      system: 'ALMOXA PRO',
      coreVersion: CORE_VERSION,
      started: this.started,
      modules: results,
      timestamp: new Date().toISOString()
    };
  }

  on(eventName, callback) {
    if (typeof callback !== 'function') {
      throw this.error(
        'INVALID_CALLBACK',
        'O evento precisa de uma função.'
      );
    }

    if (!this.events.has(eventName)) {
      this.events.set(eventName, new Set());
    }

    this.events.get(eventName).add(callback);

    return () => this.off(eventName, callback);
  }

  off(eventName, callback) {
    const listeners = this.events.get(eventName);
    if (!listeners) return false;

    return listeners.delete(callback);
  }

  emit(eventName, payload) {
    const listeners = this.events.get(eventName);
    if (!listeners) return 0;

    let delivered = 0;

    for (const callback of listeners) {
      try {
        callback(payload);
        delivered++;
      } catch (_) {
        // Um listener não deve interromper os demais.
      }
    }

    return delivered;
  }

  error(code, message) {
    const err = new Error(message);
    err.code = code;
    return err;
  }
}

const core = new AlmoxaCore();

module.exports = {
  CORE_VERSION,
  AlmoxaCore,
  core
};
