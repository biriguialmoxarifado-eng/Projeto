/**
 * ============================================================
 * 14 - SERVICES
 * ============================================================
 * Pontos de integração compartilhados. Nesta fase criamos apenas a
 * infraestrutura/registro — não implementamos integrações externas
 * reais nem colocamos credenciais no código. Módulos futuros vão
 * preencher o "handler" de cada serviço via AP_Services.register().
 */

var AP_SERVICE_NAMES = [
  'SHEETS', 'DRIVE', 'PDF', 'NOTIFICACOES', 'EMAIL', 'OCR',
  'WHATSAPP', 'SAP', 'IA', 'CAMERA', 'GPS', 'BIOMETRIA', 'ARQUIVOS', 'EXPORTACAO'
];

var AP_Services_registry_ = {};

var AP_Services = {
  /** Lista os pontos de integração previstos (implementados ou não). */
  list: function () {
    return AP_SERVICE_NAMES.map(function (name) {
      return { nome: name, implementado: !!AP_Services_registry_[name] };
    });
  },

  /** Um módulo registra o handler real de um serviço (ex.: envio de e-mail). */
  register: function (name, handlerFn) {
    if (AP_SERVICE_NAMES.indexOf(name) === -1) {
      AP_Logger_warn('AP_Services.register', 'Serviço "' + name + '" não está na lista prevista pelo Core.');
    }
    AP_Services_registry_[name] = handlerFn;
    return AP_Utils_ok({ nome: name }, 'Serviço registrado.');
  },

  /** Invoca um serviço registrado. Retorna erro padronizado se não implementado. */
  call: function (name, args) {
    var handler = AP_Services_registry_[name];
    if (!handler) {
      return AP_Utils_fail('SERVICO_NAO_IMPLEMENTADO', 'Serviço "' + name + '" ainda não possui implementação registrada.');
    }
    try {
      return AP_Utils_ok(handler(args), 'Serviço "' + name + '" executado.');
    } catch (e) {
      AP_ErrorHandler_capture('AP_Services.call:' + name, e);
      return AP_Utils_fail('ERRO_SERVICO', 'Erro ao executar serviço "' + name + '": ' + e.message);
    }
  }
};
