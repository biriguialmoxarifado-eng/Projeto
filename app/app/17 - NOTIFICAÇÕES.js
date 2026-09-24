/**
 * ============================================================
 * 22 - NOTIFICAÇÕES
 * ============================================================
 * Infraestrutura central. A implementação visual fica para o HTML;
 * aqui apenas emitimos o evento padronizado que qualquer canal
 * (e-mail, WhatsApp, painel) poderá consumir futuramente.
 */

var AP_NOTIFICATION_EVENTS = {
  APROVACAO: 'NOTIFICACAO.APROVACAO',
  ERRO: 'NOTIFICACAO.ERRO',
  PENDENCIA: 'NOTIFICACAO.PENDENCIA',
  INVENTARIO: 'NOTIFICACAO.INVENTARIO',
  RESERVA: 'NOTIFICACAO.RESERVA',
  COMPRA: 'NOTIFICACAO.COMPRA',
  OCORRENCIA: 'NOTIFICACAO.OCORRENCIA',
  SISTEMA: 'NOTIFICACAO.SISTEMA'
};

var AP_Notify = {
  send: function (tipo, titulo, mensagem, destinatario, dados) {
    return AP_EventBus.emit(tipo, {
      titulo: titulo, mensagem: mensagem, destinatario: destinatario || '', dados: dados || {}
    });
  },
  types: function () { return AP_NOTIFICATION_EVENTS; }
};
