function doGet(e) {
  var params = (e && e.parameter) || {};
  var api = APIX_tratarGet(e);
  if (api) return api;

  if (params.lf || params.linkflow) return AP_LINKFLOW_doGet(e);
  if (params.cr) return AP_CRACHA_doGet(e);
  if (params.pagina === 'biometria') return AXBIO_servirTela_(e);
  if (params.aprovar || params.p === '3d' || params.pagina === '3d') {
    return AP_ENTRADA_servir(e);
  }
  return FICHA_servirGet_(e);
}

function doPost(e) {
  var corpo;
  try {
    corpo = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (erro) {
    return APIX_json_(APIX_erro_('CORPO_INVALIDO', 'O pedido não veio em JSON.'));
  }

  if (corpo && corpo.ponte !== 'ALMOXA' && /^bio_/.test(String(corpo.acao || ''))) {
    return axbioPost(e);
  }
  return APIX_json_(APIX_processarPedido_(corpo));
}
