
'use strict';

var AP_DB_ABA_TESTE = 'ALMOXA_TESTE_CONEXAO';

function AP_DB_direto(json) {
  try {
    var req = typeof json === 'string' ? JSON.parse(json) : json;
    var sessao = req.sessao || req.token || '';

    if (!sessao || typeof AP_Session_validate !== 'function') {
      return {
        ok: false,
        codigo: 'SESSAO_OBRIGATORIA',
        mensagem: 'Sessão autenticada obrigatória.'
      };
    }

    var validacao = AP_Session_validate(String(sessao));

    if (!validacao || !validacao.ok) {
      return {
        ok: false,
        codigo: 'SESSAO_INVALIDA',
        mensagem: 'A sessão não foi validada.'
      };
    }

    var acao = req.acao;
    var payload = req.payload || {};

    if (acao === 'diagnostico') {
      return AP_DB_diagnostico_();
    }

    if (acao === 'teste.gravar') {
      return AP_DB_gravarTeste_(payload.record);
    }

    if (acao === 'teste.ler') {
      return AP_DB_lerTeste_(payload.id);
    }

    return {
      ok: false,
      codigo: 'ACAO_NAO_PERMITIDA',
      mensagem: 'Ação de banco não autorizada.'
    };

  } catch (e) {
    return {
      ok: false,
      codigo: 'DATABASE_ROUTER_ERROR',
      mensagem: String(e.message || e)
    };
  }
}

function AP_DB_diagnostico_() {
  var ss = AP_Config_getSpreadsheet_();

  return {
    ok: true,
    codigo: 'DATABASE_CONNECTED',
    mensagem: 'Planilha identificada.',
    dados: {
      spreadsheet: ss.getName(),
      sheets: ss.getSheets().map(function(sheet) {
        return sheet.getName();
      }),
      timestamp: new Date().toISOString()
    }
  };
}

function AP_DB_gravarTeste_(record) {
  if (!record || !record.id || !record.createdAt) {
    throw new Error('Registro de teste inválido.');
  }

  var lock = LockService.getScriptLock();

  if (!lock.tryLock(10000)) {
    throw new Error('Não foi possível obter trava para gravação.');
  }

  try {
    var ss = AP_Config_getSpreadsheet_();
    var sheet = ss.getSheetByName(AP_DB_ABA_TESTE);

    if (!sheet) {
      sheet = ss.insertSheet(AP_DB_ABA_TESTE);
      sheet.appendRow(['ID', 'CRIADO_EM', 'ORIGEM', 'MENSAGEM']);
      sheet.setFrozenRows(1);
    }

    var headers = sheet.getRange(
      1, 1, 1, sheet.getLastColumn()
    ).getValues()[0];

    var esperados = ['ID', 'CRIADO_EM', 'ORIGEM', 'MENSAGEM'];

    if (JSON.stringify(headers) !== JSON.stringify(esperados)) {
      throw new Error('Cabeçalho da aba de teste inválido.');
    }

    var existentes = sheet.getLastRow() > 1
      ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues()
      : [];

    if (existentes.some(function(row) {
      return String(row[0]) === String(record.id);
    })) {
      throw new Error('Este UUID já foi gravado.');
    }

    sheet.appendRow([
      String(record.id),
      String(record.createdAt),
      String(record.origin || ''),
      String(record.message || '')
    ]);

    SpreadsheetApp.flush();

    return {
      ok: true,
      codigo: 'TEST_RECORD_WRITTEN',
      mensagem: 'Registro de teste gravado.',
      dados: {
        id: String(record.id),
        row: sheet.getLastRow()
      }
    };

  } finally {
    lock.releaseLock();
  }
}

function AP_DB_lerTeste_(id) {
  if (!id) throw new Error('ID obrigatório.');

  var ss = AP_Config_getSpreadsheet_();
  var sheet = ss.getSheetByName(AP_DB_ABA_TESTE);

  if (!sheet || sheet.getLastRow() < 2) {
    throw new Error('A aba de teste ainda não possui registros.');
  }

  var values = sheet.getRange(
    2, 1, sheet.getLastRow() - 1, 4
  ).getValues();

  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]) === String(id)) {
      return {
        ok: true,
        codigo: 'TEST_RECORD_FOUND',
        mensagem: 'Registro localizado.',
        dados: {
          id: String(values[i][0]),
          createdAt: String(values[i][1]),
          origin: String(values[i][2]),
          message: String(values[i][3])
        }
      };
    }
  }

  throw new Error('Registro não encontrado após gravação.');
}
