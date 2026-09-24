/**
 * ============================================================
 * CORE MASTER — 23 — ORQUESTRADOR CENTRAL
 * ============================================================
 * NÃO recria nenhuma das 21 partes. Apenas orquestra, identifica
 * plataforma, controla autorização de acesso por plataforma e
 * expõe uma API central única (CORE_MASTER) para as futuras
 * aplicações Mobile e Desktop, que usarão o MESMO Core.
 *
 * Toda função pública do CORE_MASTER que já existir em uma das 21
 * partes apenas ENCAMINHA a chamada (ex.: CORE_MASTER.health() ->
 * AP_API.health()) — nunca duplica a lógica.
 */

var MASTER_VERSION = '1.0.0';

var AP_PLATFORMS = { MOBILE: 'MOBILE', DESKTOP: 'DESKTOP' };

// Estende (não substitui) o AP_STATUS já existente com o estado STARTING,
// necessário para o Core Master (seção 3 do prompt).
if (typeof AP_STATUS !== 'undefined' && !AP_STATUS.STARTING) {
  AP_STATUS.STARTING = 'STARTING';
}

/* ------------------------------------------------------------
 * Contexto da requisição (seção 4 e 12 do prompt)
 * ------------------------------------------------------------ */

/**
 * Constrói/normaliza o contexto de uma chamada.
 * @param {Object} raw { appId, platform, appVersion, deviceId, sessionId, userId }
 */
function AP_CoreMaster_buildContext_(raw) {
  raw = raw || {};
  return {
    requestId: AP_Utils_generateId('REQ'),
    appId: raw.appId || raw.appID || '',
    platform: (raw.platform || '').toUpperCase(),
    appVersion: raw.appVersion || '',
    deviceId: raw.deviceId || '',
    sessionId: raw.sessionId || '',
    userId: raw.userId || '',
    timestamp: AP_Utils_now()
  };
}

/** Envelope de resposta padrão do Master (seção 9 do prompt). */
function AP_CoreMaster_wrap_(result, context) {
  var envelope = {
    coreVersion: String(AP_Config_get('SYSTEM_VERSION')),
    masterVersion: MASTER_VERSION,
    platform: context ? context.platform : '',
    appVersion: context ? context.appVersion : '',
    requestId: context ? context.requestId : ''
  };
  return Object.assign({}, result, envelope);
}

/* ------------------------------------------------------------
 * CORE_MASTER — API pública
 * ------------------------------------------------------------ */

var CORE_MASTER = {

  version: function () {
    return AP_CoreMaster_wrap_(AP_Utils_ok({
      coreVersion: String(AP_Config_get('SYSTEM_VERSION')),
      masterVersion: MASTER_VERSION,
      build: AP_Config_get('SYSTEM_BUILD')
    }), null);
  },

  /** Encaminha para AP_API.health() e agrega o status das 21 partes. */
  health: function (appContext) {
    var context = AP_CoreMaster_buildContext_(appContext);
    return AP_Utils_safeRun('CORE_MASTER.health', function () {
      var coreHealth = AP_API.health(); // encaminhado, não duplicado
      var parts = AP_CoreMaster_checkAllParts_();
      var offline = parts.filter(function (p) { return p.status === AP_STATUS.OFFLINE; }).length;
      var warning = parts.filter(function (p) { return p.status === AP_STATUS.WARNING; }).length;
      var errorCount = parts.filter(function (p) { return p.status === AP_STATUS.ERROR; }).length;
      var status = (offline > 0 || errorCount > 0) ? AP_STATUS.ERROR : (warning > 0 ? AP_STATUS.WARNING : AP_STATUS.ONLINE);
      return AP_CoreMaster_wrap_(AP_Utils_ok({
        core: coreHealth.data,
        master_status: status,
        partes: { total: parts.length, online: parts.length - offline - warning - errorCount, warning: warning, error: errorCount, offline: offline },
        detalhe_partes: parts
      }, 'Health check consolidado.'), context);
    });
  },

  /** Encaminha o registro de módulos existente (AP_ModuleRegistry) + manifesto das 21 partes. */
  modules: function (appContext) {
    var context = AP_CoreMaster_buildContext_(appContext);
    return AP_Utils_safeRun('CORE_MASTER.modules', function () {
      return AP_CoreMaster_wrap_(AP_Utils_ok({
        modulos_registrados: AP_ModuleRegistry.list(),
        partes_core: AP_CoreMaster_checkAllParts_()
      }), context);
    });
  },

  /** Status resumido do Core (seção 3 do prompt). */
  status: function (appContext) {
    var context = AP_CoreMaster_buildContext_(appContext);
    return AP_Utils_safeRun('CORE_MASTER.status', function () {
      var parts = AP_CoreMaster_checkAllParts_();
      var offline = parts.filter(function (p) { return p.status === AP_STATUS.OFFLINE; }).length;
      var warning = parts.filter(function (p) { return p.status === AP_STATUS.WARNING; }).length;
      var errorCount = parts.filter(function (p) { return p.status === AP_STATUS.ERROR; }).length;
      var online = parts.length - offline - warning - errorCount;
      var geral = (offline > 0 || errorCount > 0) ? AP_STATUS.ERROR : (warning > 0 ? AP_STATUS.WARNING : AP_STATUS.ONLINE);
      return AP_CoreMaster_wrap_(AP_Utils_ok({
        core_status: geral,
        core_version: String(AP_Config_get('SYSTEM_VERSION')),
        master_version: MASTER_VERSION,
        partes_online: online,
        partes_warning: warning,
        partes_error: errorCount + offline,
        timestamp: AP_Utils_now(),
        ultima_inicializacao: AP_Cache_get('AP_CORE_MASTER_LAST_BOOT') || null
      }), context);
    });
  },

  /** Identifica a aplicação/plataforma que está chamando (seções 4, 5, 6). */
  identify: function (appContext) {
    var context = AP_CoreMaster_buildContext_(appContext);
    if (context.platform !== AP_PLATFORMS.MOBILE && context.platform !== AP_PLATFORMS.DESKTOP) {
      return AP_CoreMaster_wrap_(AP_Utils_fail('PLATAFORMA_INVALIDA', 'PLATFORM deve ser MOBILE ou DESKTOP.', { recebido: context.platform }), context);
    }
    AP_Logger_info('CORE_MASTER.identify', 'Chamada identificada como ' + context.platform, context);
    return AP_CoreMaster_wrap_(AP_Utils_ok({
      mensagem: 'Esta chamada veio do ' + context.platform + '.',
      appId: context.appId, platform: context.platform, appVersion: context.appVersion,
      deviceId: context.deviceId, requestId: context.requestId
    }), context);
  },

  /** Autentica encaminhando para AP_Auth.login, e já valida a plataforma junto. */
  authenticate: function (email, senha, appContext) {
    var context = AP_CoreMaster_buildContext_(appContext);
    return AP_Utils_safeRun('CORE_MASTER.authenticate', function () {
      var idCheck = CORE_MASTER.identify(appContext);
      if (!idCheck.ok) return idCheck;

      var loginResult = AP_Auth.login(email, senha); // encaminhado, não duplicado
      if (!loginResult.ok) {
        AP_Audit_log(email, 'ACCESS_DENIED', 'AUTH', email, { plataforma: context.platform, motivo: loginResult.code });
        return AP_CoreMaster_wrap_(loginResult, context);
      }

      var platformCheck = AP_CoreMaster_userCanAccessPlatform_(email, context.platform);
      if (!platformCheck) {
        AP_Session_destroy(loginResult.data.token);
        AP_Audit_log(email, 'PLATFORM_ACCESS_DENIED', 'AUTH', email, { plataforma: context.platform });
        return AP_CoreMaster_wrap_(AP_Utils_fail('PLATAFORMA_NAO_AUTORIZADA', 'Usuário não tem acesso liberado para ' + context.platform + '.'), context);
      }

      AP_Audit_log(email, 'ACCESS_GRANTED', 'AUTH', email, { plataforma: context.platform });
      return AP_CoreMaster_wrap_(loginResult, context);
    });
  },

  /** Encaminha para AP_Session_validate, mas retorna já no envelope do Master. */
  validateSession: function (token, appContext) {
    var context = AP_CoreMaster_buildContext_(appContext);
    return AP_Utils_safeRun('CORE_MASTER.validateSession', function () {
      var result = AP_Session_validate(token); // encaminhado
      return AP_CoreMaster_wrap_(result, context);
    });
  },

  /** Valida USUÁRIO + SESSÃO + PLATAFORMA (seção 7). Perfil não substitui esta regra. */
  authorizePlatform: function (token, appContext) {
    var context = AP_CoreMaster_buildContext_(appContext);
    return AP_Utils_safeRun('CORE_MASTER.authorizePlatform', function () {
      if (context.platform !== AP_PLATFORMS.MOBILE && context.platform !== AP_PLATFORMS.DESKTOP) {
        return AP_CoreMaster_wrap_(AP_Utils_fail('PLATAFORMA_INVALIDA', 'PLATFORM deve ser MOBILE ou DESKTOP.'), context);
      }
      var session = AP_Session_validate(token);
      if (!session.ok) return AP_CoreMaster_wrap_(session, context);

      var allowed = AP_CoreMaster_userCanAccessPlatform_(session.data.usuario, context.platform);
      if (!allowed) {
        AP_Audit_log(session.data.usuario, 'PLATFORM_ACCESS_DENIED', 'AUTH', session.data.usuario, { plataforma: context.platform });
        return AP_CoreMaster_wrap_(AP_Utils_fail('PLATAFORMA_NAO_AUTORIZADA', 'Usuário não autorizado para ' + context.platform + '.'), context);
      }
      return AP_CoreMaster_wrap_(AP_Utils_ok({ usuario: session.data.usuario, perfil: session.data.perfil, plataforma: context.platform }), context);
    });
  },

  /** Valida sessão + plataforma + permissão funcional (RBAC) para uma ação de módulo. */
  authorizeAction: function (token, modulo, acao, appContext) {
    var context = AP_CoreMaster_buildContext_(appContext);
    return AP_Utils_safeRun('CORE_MASTER.authorizeAction', function () {
      var platformCheck = CORE_MASTER.authorizePlatform(token, appContext);
      if (!platformCheck.ok) return platformCheck;

      var denied = AP_Permissions_guard(token, modulo, acao); // encaminhado
      if (denied) return AP_CoreMaster_wrap_(denied, context);

      return AP_CoreMaster_wrap_(AP_Utils_ok({ autorizado: true, modulo: modulo, acao: acao }), context);
    });
  },

  /** Encaminha para o Event Bus já existente, enriquecendo o payload com contexto. */
  emit: function (eventName, payload, appContext) {
    var context = AP_CoreMaster_buildContext_(appContext);
    return AP_Utils_safeRun('CORE_MASTER.emit', function () {
      var enrichedPayload = Object.assign({}, payload || {}, {
        _eventId: AP_Utils_generateId('EVT'),
        _source: context.appId || 'CORE_MASTER',
        _platform: context.platform,
        _appId: context.appId,
        _requestId: context.requestId
      });
      var result = AP_EventBus.emit(eventName, enrichedPayload, context.userId); // encaminhado
      return AP_CoreMaster_wrap_(result, context);
    });
  },

  /**
   * Mecanismo central de despacho (seção 11).
   * @param {Object} request { module, action, payload, context }
   */
  dispatch: function (request) {
    request = request || {};
    var context = AP_CoreMaster_buildContext_(request.context);
    return AP_Utils_safeRun('CORE_MASTER.dispatch', function () {
      if (!request.module || !request.action) {
        return AP_CoreMaster_wrap_(AP_Utils_fail('REQUISICAO_INVALIDA', 'Informe "module" e "action" para despachar.'), context);
      }

      // 1-2) validar sessão (quando token informado; algumas ações podem ser públicas)
      if (request.context && request.context.sessionId) {
        var session = AP_Session_validate(request.context.sessionId);
        if (!session.ok) return AP_CoreMaster_wrap_(session, context);
        context.userId = session.data.usuario;

        // 3) validar plataforma
        var platformOk = AP_CoreMaster_userCanAccessPlatform_(session.data.usuario, context.platform);
        if (!platformOk) {
          AP_Audit_log(session.data.usuario, 'PLATFORM_ACCESS_DENIED', request.module, request.action, {});
          return AP_CoreMaster_wrap_(AP_Utils_fail('PLATAFORMA_NAO_AUTORIZADA', 'Plataforma não autorizada para este usuário.'), context);
        }

        // 4) validar permissão funcional
        if (!AP_Permissions_can_(session.data.perfil, request.module, request.action)) {
          AP_Audit_log(session.data.usuario, 'ACCESS_DENIED', request.module, request.action, {});
          return AP_CoreMaster_wrap_(AP_Utils_fail('ACESSO_NEGADO', 'Perfil sem permissão para ' + request.action + ' em ' + request.module + '.'), context);
        }
      }

      // 5-6) localizar módulo + função autorizada
      var handler = AP_CoreMaster_resolveHandler_(request.module, request.action);
      if (!handler) {
        AP_Logger_warn('CORE_MASTER.dispatch', 'Handler não encontrado: ' + request.module + '.' + request.action, context);
        return AP_CoreMaster_wrap_(AP_Utils_fail('MODULO_NAO_IMPLEMENTADO', 'Módulo/ação "' + request.module + '.' + request.action + '" não está disponível.'), context);
      }

      // 7) executar
      var result;
      try {
        result = handler(request.payload, context);
      } catch (e) {
        AP_ErrorHandler_capture('CORE_MASTER.dispatch:' + request.module + '.' + request.action, e);
        AP_Audit_log(context.userId, 'MODULE_ERROR', request.module, request.action, { erro: e.message });
        return AP_CoreMaster_wrap_(AP_Utils_fail('ERRO_MODULO', 'Erro ao executar ' + request.module + '.' + request.action + ': ' + e.message), context);
      }

      // 8) registrar — só o que precisa de rastreabilidade
      //
      // Antes, TODA chamada gravava uma linha na auditoria. Uma
      // simples consulta ao catálogo virava uma escrita na planilha,
      // que é a operação mais cara do Apps Script — no meio do
      // caminho crítico do usuário.
      //
      // Operação crítica continua auditada, sempre. Consulta não.
      if (!AP_CoreMaster_ehLeitura_(request.action)) {
        AP_Audit_log(context.userId, 'MODULE_CALL', request.module, request.action, { requestId: context.requestId });
      }

      // 9) retornar
      return AP_CoreMaster_wrap_(result, context);
    });
  },

  /**
   * A ação é apenas consulta?
   *
   * A lista é do que NÃO altera nada. Qualquer ação fora dela é
   * tratada como escrita e auditada — na dúvida, audita.
   */
  ehLeitura: function (acao) { return AP_CoreMaster_ehLeitura_(acao); },

  /** Roda o Doutor existente + relatório das 21 partes no formato do prompt (seção 17). */
  diagnose: function (appContext) {
    var context = AP_CoreMaster_buildContext_(appContext);
    return AP_Utils_safeRun('CORE_MASTER.diagnose', function () {
      var coreDoctor = AP_Doctor.run(); // encaminhado, não duplicado
      var parts = AP_CoreMaster_checkAllParts_();
      var offline = parts.some(function (p) { return p.status === AP_STATUS.OFFLINE || p.status === AP_STATUS.ERROR; });
      var masterStatus = (coreDoctor.ok && !offline) ? AP_STATUS.ONLINE : AP_STATUS.ERROR;

      var linhas = ['CORE MASTER: ' + masterStatus];
      parts.forEach(function (p) {
        linhas.push(p.id + ' (' + p.nome + '): ' + p.status + (p.erro ? ' | ERRO: ' + p.erro : ''));
      });

      return AP_CoreMaster_wrap_(AP_Utils_ok({
        status_geral: masterStatus,
        resumo_textual: linhas.join('\n'),
        core_doctor: coreDoctor.data,
        partes: parts,
        mobile_interface: AP_STATUS.OFFLINE, // ainda não construída (fase futura)
        desktop_interface: AP_STATUS.OFFLINE  // ainda não construída (fase futura)
      }, 'Diagnóstico do Core Master concluído.'), context);
    });
  }
};

/* ------------------------------------------------------------
 * Resolução de handlers do dispatch (whitelist — nada arbitrário)
 * ------------------------------------------------------------ */

var AP_CoreMaster_HANDLERS_ = {
  CORE: {
    health: function () { return AP_API.health(); },
    doctor: function () { return AP_API.doctor(); },
    modules: function () { return AP_API.modules(); },
    config: function (payload) { return AP_API.config(payload && payload.key); },
    emit: function (payload, context) { return AP_EventBus.emit(payload.eventName, payload.data, context.userId); }
  }
};

function AP_CoreMaster_resolveHandler_(moduleId, action) {
  var moduleHandlers = AP_CoreMaster_HANDLERS_[moduleId];
  if (!moduleHandlers) return null;
  return moduleHandlers[action] || null;
}

/* ------------------------------------------------------------
 * Boot do Master (seção 15)
 * ------------------------------------------------------------ */

function CORE_MASTER_boot() {
  var steps = [];
  var status = AP_STATUS.STARTING;

  function step(name, fn) {
    try {
      var result = fn();
      steps.push({ etapa: name, status: AP_STATUS.ONLINE, detalhe: result || '' });
      return true;
    } catch (e) {
      steps.push({ etapa: name, status: AP_STATUS.ERROR, detalhe: e.message });
      AP_ErrorHandler_capture('CORE_MASTER_boot:' + name, e);
      return false;
    }
  }

  // 1) carregar configuração / 2) verificar Spreadsheet / 9) verificar Data Layer
  var coreBootResult = step('Inicializar Core (AP_Core_boot)', function () {
    var r = AP_Core_boot(); // encaminhado — não duplica a lógica de boot das 21 partes
    if (!r.ok) throw new Error('AP_Core_boot retornou erro: ' + r.message);
    return r.message;
  });

  // 3) carregar registro das 21 partes / 4) verificar dependências
  var parts = [];
  step('Verificar as 21 partes e dependências', function () {
    parts = AP_CoreMaster_checkAllParts_();
    var faltando = parts.filter(function (p) { return p.status === AP_STATUS.OFFLINE; });
    if (faltando.length) {
      throw new Error('Partes ausentes: ' + faltando.map(function (p) { return p.id + ' (' + p.nome + ')'; }).join(', '));
    }
    return parts.length + ' partes verificadas.';
  });

  // 5) inicializar serviços (apenas verifica o registro, não inventa integração)
  step('Verificar registro de Services', function () { return AP_Services.list().length + ' pontos de serviço mapeados.'; });

  // 6) inicializar Event Bus
  step('Verificar Event Bus', function () {
    var r = AP_EventBus.emit('CORE_MASTER.BOOT_PING', { ts: new Date() });
    if (!r.ok) throw new Error('Event Bus não respondeu corretamente.');
    return 'ok';
  });

  // 7-8) inicializar autenticação / sessão (apenas garante estrutura)
  step('Verificar Auth/Sessão', function () {
    AP_Auth_ensureSheet_();
    AP_Session_ensureSheet_();
    return 'ok';
  });

  // Extensão do Master: garantir colunas de plataforma
  step('Garantir colunas de acesso por plataforma (USUARIOS)', function () {
    var r = AP_CoreMaster_ensurePlatformColumns_();
    return JSON.stringify(r.data);
  });

  // 10) executar Health Checks
  var healthResult = null;
  step('Executar Health Check consolidado', function () {
    healthResult = CORE_MASTER.health();
    if (!healthResult.ok) throw new Error('Health check consolidado falhou.');
    return healthResult.master_status;
  });

  // Registrar o próprio Master no Module Registry (não duplica; complementa)
  step('Registrar CORE_MASTER no Module Registry', function () {
    return AP_ModuleRegistry.register({
      id: 'CORE_MASTER',
      nome: 'Core Master (Orquestrador)',
      versao: MASTER_VERSION,
      dependencias: parts.map(function (p) { return p.id; }),
      funcoes: ['health', 'status', 'modules', 'identify', 'authenticate', 'validateSession', 'authorizePlatform', 'authorizeAction', 'emit', 'dispatch', 'diagnose', 'version']
    });
  });

  var hasError = steps.some(function (s) { return s.status === AP_STATUS.ERROR; });
  status = hasError ? AP_STATUS.ERROR : AP_STATUS.ONLINE;

  AP_Cache_set('AP_CORE_MASTER_LAST_BOOT', AP_Utils_formatDate(new Date()), 3600);
  AP_Logger_info('CORE_MASTER_boot', 'Boot do Master concluído: ' + status, { etapas: steps.length, falhas: steps.filter(function (s) { return s.status === AP_STATUS.ERROR; }).length });
  AP_Audit_log('sistema', status === AP_STATUS.ONLINE ? 'ONLINE' : 'CORE_ERROR', 'CORE_MASTER', 'boot', { status: status });

  var summary = { status: status, data: AP_Utils_now(), etapas: steps, partes: parts };
  Logger.log(JSON.stringify(summary, null, 2));

  return status === AP_STATUS.ONLINE
    ? AP_CoreMaster_wrap_(AP_Utils_ok(summary, 'Core Master inicializado. Status: ONLINE 🟢'), null)
    : AP_CoreMaster_wrap_(AP_Utils_fail('MASTER_BOOT_COM_ERROS', 'Core Master inicializado com erros.', summary), null);
}


/**
 * Ações que só leem. Tudo o que não estiver aqui é auditado.
 *
 * A regra é conservadora de propósito: esquecer de auditar uma
 * escrita é pior que auditar uma leitura a mais.
 */
var AP_CORE_ACOES_LEITURA = /^(listar|obter|catalogo|consultar|detalhe|ping|diagnostico|contar|resumo|mural|item|movimentacoes|criticos|matriz|verificar|capacidades|fichas|pendentes|precompras|pedidos|sugestoes|divergencias|gerados|carregar|disponivel|credenciais|proximoSku|verificarSku|buscarSemelhante|porCnpj|perfis|doPerfil|alcadas|alcadaPara|acoes|excecoes|versao|status|performance|planilha|modulos|completo|daPessoa|equivalencias|compatibilidade|montar|disponibilidade|analisarCarrinho|interpretar|procurar|comparar|limites|historico|backups)$/i;

function AP_CoreMaster_ehLeitura_(acao) {
  return AP_CORE_ACOES_LEITURA.test(String(acao || ''));
}
