
  /* [DATABASE] Rota do banco central */
  if (req.modulo === 'database' && typeof AP_DB_direto === 'function') {
    return APIX_padronizar_(AP_DB_direto(JSON.stringify({
      acao: req.acao,
      payload: req.payload,
      sessao: req.sessao,
      token: req.sessao
    })));
  }

