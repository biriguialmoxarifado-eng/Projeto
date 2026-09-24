/**
 * ALMOXA PRO — Central de Tarefas em Andamento
 *
 * Serviço do Core, usado por todos os módulos. Guarda o ESTADO de uma
 * tarefa (não só a página) para o usuário sair, fazer outra coisa e
 * voltar exatamente ao ponto onde parou.
 *
 * Tudo numa aba só: ALMOXA_TAREFAS.
 * A tarefa pertence ao usuário da sessão — outro usuário não abre.
 *
 * INSTALAÇÃO
 *  1. Cole num arquivo novo do Apps Script.
 *  2. Rode AP_TAREFAS_instalar.
 *  3. Publique nova versão.
 */

var AP_TAREFAS_ABA = 'ALMOXA_TAREFAS';
var AP_TAREFAS_COLUNAS = ['id', 'usuario', 'matricula', 'modulo', 'tipo', 'referencia', 'rota',
  'titulo', 'status', 'etapa', 'progresso', 'estado', 'criadoEm', 'atualizadoEm',
  'standbyEm', 'dispositivo', 'versao'];

/** Estados possíveis. Uma tarefa concluída some da lista de pendentes. */
var AP_TAREFAS_STATUS = ['RASCUNHO', 'EM_ANDAMENTO', 'STANDBY', 'AGUARDANDO_ACAO',
  'CONCLUIDA', 'CANCELADA', 'EXPIRADA'];

function AP_TAREFAS_instalar() {
  var ss = AP_Config_getSpreadsheet_();
  var aba = ss.getSheetByName(AP_TAREFAS_ABA);
  if (!aba) {
    aba = ss.insertSheet(AP_TAREFAS_ABA);
    aba.getRange(1, 1, 1, AP_TAREFAS_COLUNAS.length).setValues([AP_TAREFAS_COLUNAS]);
    aba.setFrozenRows(1);
    Logger.log('Aba ' + AP_TAREFAS_ABA + ' criada.');
    return 'Aba criada.';
  }
  var cab = aba.getRange(1, 1, 1, Math.max(1, aba.getLastColumn())).getValues()[0]
    .map(function (c) { return String(c).trim(); });
  var faltam = AP_TAREFAS_COLUNAS.filter(function (c) { return cab.indexOf(c) === -1; });
  if (faltam.length) {
    aba.getRange(1, cab.length + 1, 1, faltam.length).setValues([faltam]);
    Logger.log('Colunas acrescentadas: ' + faltam.join(', '));
    return 'Colunas acrescentadas.';
  }
  Logger.log('Já estava instalado.');
  return 'Já estava instalado.';
}

/* ============================================================
   PORTA ÚNICA PARA A TELA
   ============================================================ */
function AP_TAREFAS_direto(json) {
  var p = {};
  try { p = JSON.parse(json || '{}'); } catch (e) { p = {}; }

  var v = p.token ? AP_Session_validate(String(p.token)) : null;
  if (!v || !v.ok) {
    return JSON.stringify({ ok: false, codigo: 'SEM_SESSAO', mensagem: 'Faça login de novo.' });
  }
  var dono = String(v.data.usuario || '').toLowerCase();

  var r;
  try {
    switch (p.acao) {
      case 'listar':   r = AP_TAREFAS_listar_(dono, p.incluirConcluidas); break;
      case 'salvar':   r = AP_TAREFAS_salvar_(dono, p.payload || {}); break;
      case 'obter':    r = AP_TAREFAS_obter_(dono, p.id); break;
      case 'standby':  r = AP_TAREFAS_status_(dono, p.id, 'STANDBY'); break;
      case 'retomar':  r = AP_TAREFAS_status_(dono, p.id, 'EM_ANDAMENTO'); break;
      case 'finalizar':r = AP_TAREFAS_status_(dono, p.id, 'CONCLUIDA'); break;
      case 'cancelar': r = AP_TAREFAS_status_(dono, p.id, 'CANCELADA'); break;
      case 'excluir':  r = AP_TAREFAS_excluir_(dono, p.id); break;
      default: r = { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'tarefas.' + p.acao + ' não existe.' };
    }
  } catch (e) {
    r = { ok: false, codigo: 'MODULO_ERRO', mensagem: e.message };
  }
  return JSON.stringify(r);
}

/* ============================================================
   OPERAÇÕES
   ============================================================ */

/** Cria ou atualiza. Nunca duplica: mesma referência do mesmo dono = mesma tarefa. */
function AP_TAREFAS_salvar_(dono, d) {
  var aba = AP_TAREFAS_aba_();
  if (!aba) return { ok: false, codigo: 'SEM_ABA', mensagem: 'Rode AP_TAREFAS_instalar.' };
  if (!d.modulo) return { ok: false, codigo: 'SEM_MODULO', mensagem: 'A tarefa precisa dizer de qual módulo é.' };

  var estado = typeof d.estado === 'string' ? d.estado : JSON.stringify(d.estado || {});
  if (estado.length > 45000) {
    return { ok: false, codigo: 'ESTADO_GRANDE',
      mensagem: 'O estado desta tarefa passou do tamanho que cabe numa célula. Finalize ou tire os anexos.' };
  }

  var linhas = AP_TAREFAS_linhas_(aba);
  var agora = new Date();
  var alvo = null;

  if (d.id) {
    alvo = linhas.filter(function (l) { return String(l.id) === String(d.id); })[0];
  }
  if (!alvo && d.referencia) {
    alvo = linhas.filter(function (l) {
      return String(l.usuario).toLowerCase() === dono &&
        String(l.modulo) === String(d.modulo) &&
        String(l.referencia) === String(d.referencia) &&
        ['CONCLUIDA', 'CANCELADA'].indexOf(String(l.status)) < 0;
    })[0];
  }
  if (alvo && String(alvo.usuario).toLowerCase() !== dono) {
    return { ok: false, codigo: 'NAO_E_SUA', mensagem: 'Esta tarefa é de outro usuário.' };
  }

  var registro = {
    id: alvo ? alvo.id : 'TAR-' + agora.getTime() + '-' + Math.floor(Math.random() * 1000),
    usuario: alvo ? alvo.usuario : dono,
    matricula: d.matricula || (alvo ? alvo.matricula : ''),
    modulo: d.modulo,
    tipo: d.tipo || '',
    referencia: d.referencia || '',
    rota: d.rota || '',
    titulo: d.titulo || d.referencia || d.modulo,
    status: d.status || (alvo ? alvo.status : 'EM_ANDAMENTO'),
    etapa: d.etapa || '',
    progresso: Number(d.progresso) || 0,
    estado: estado,
    criadoEm: alvo ? alvo.criadoEm : agora,
    atualizadoEm: agora,
    standbyEm: d.status === 'STANDBY' ? agora : (alvo ? alvo.standbyEm : ''),
    dispositivo: String(d.dispositivo || '').slice(0, 120),
    versao: Number(alvo ? alvo.versao : 0) + 1
  };

  var valores = AP_TAREFAS_cab_(aba).map(function (c) {
    return registro[c] !== undefined ? registro[c] : '';
  });

  if (alvo) {
    aba.getRange(alvo.__linha, 1, 1, valores.length).setValues([valores]);
  } else {
    aba.appendRow(valores);
  }
  return { ok: true, dados: { id: registro.id, versao: registro.versao, atualizadoEm: agora.getTime() } };
}

function AP_TAREFAS_listar_(dono, incluirConcluidas) {
  var aba = AP_TAREFAS_aba_();
  if (!aba) return { ok: true, dados: [] };
  var lista = AP_TAREFAS_linhas_(aba).filter(function (l) {
    if (String(l.usuario).toLowerCase() !== dono) return false;
    if (incluirConcluidas) return true;
    return ['CONCLUIDA', 'CANCELADA', 'EXPIRADA'].indexOf(String(l.status)) < 0;
  }).map(function (l) {
    return {
      id: l.id, modulo: l.modulo, tipo: l.tipo, referencia: l.referencia, rota: l.rota,
      titulo: l.titulo, status: l.status, etapa: l.etapa, progresso: Number(l.progresso) || 0,
      criadoEm: AP_TAREFAS_ms_(l.criadoEm), atualizadoEm: AP_TAREFAS_ms_(l.atualizadoEm)
    };
  }).sort(function (a, b) { return b.atualizadoEm - a.atualizadoEm; });
  return { ok: true, dados: lista };
}

function AP_TAREFAS_obter_(dono, id) {
  var aba = AP_TAREFAS_aba_();
  var l = aba ? AP_TAREFAS_linhas_(aba).filter(function (x) { return String(x.id) === String(id); })[0] : null;
  if (!l) return { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Tarefa não encontrada.' };
  if (String(l.usuario).toLowerCase() !== dono) {
    return { ok: false, codigo: 'NAO_E_SUA', mensagem: 'Esta tarefa é de outro usuário.' };
  }
  var estado = {};
  try { estado = JSON.parse(l.estado || '{}'); } catch (e) { estado = {}; }
  return {
    ok: true,
    dados: {
      id: l.id, modulo: l.modulo, tipo: l.tipo, referencia: l.referencia, rota: l.rota,
      titulo: l.titulo, status: l.status, etapa: l.etapa, progresso: Number(l.progresso) || 0,
      estado: estado, atualizadoEm: AP_TAREFAS_ms_(l.atualizadoEm)
    }
  };
}

function AP_TAREFAS_status_(dono, id, novo) {
  var aba = AP_TAREFAS_aba_();
  var l = aba ? AP_TAREFAS_linhas_(aba).filter(function (x) { return String(x.id) === String(id); })[0] : null;
  if (!l) return { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Tarefa não encontrada.' };
  if (String(l.usuario).toLowerCase() !== dono) {
    return { ok: false, codigo: 'NAO_E_SUA', mensagem: 'Esta tarefa é de outro usuário.' };
  }
  var cab = AP_TAREFAS_cab_(aba);
  aba.getRange(l.__linha, cab.indexOf('status') + 1).setValue(novo);
  aba.getRange(l.__linha, cab.indexOf('atualizadoEm') + 1).setValue(new Date());
  if (novo === 'STANDBY') aba.getRange(l.__linha, cab.indexOf('standbyEm') + 1).setValue(new Date());
  return { ok: true, dados: { id: id, status: novo } };
}

function AP_TAREFAS_excluir_(dono, id) {
  var aba = AP_TAREFAS_aba_();
  var l = aba ? AP_TAREFAS_linhas_(aba).filter(function (x) { return String(x.id) === String(id); })[0] : null;
  if (!l) return { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Tarefa não encontrada.' };
  if (String(l.usuario).toLowerCase() !== dono) {
    return { ok: false, codigo: 'NAO_E_SUA', mensagem: 'Esta tarefa é de outro usuário.' };
  }
  aba.deleteRow(l.__linha);
  return { ok: true, dados: { id: id, excluida: true } };
}

/* ============================================================
   INTERNOS
   ============================================================ */
function AP_TAREFAS_aba_() {
  return AP_Config_getSpreadsheet_().getSheetByName(AP_TAREFAS_ABA);
}

function AP_TAREFAS_cab_(aba) {
  return aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0]
    .map(function (c) { return String(c).trim(); });
}

function AP_TAREFAS_linhas_(aba) {
  if (aba.getLastRow() < 2) return [];
  var cab = AP_TAREFAS_cab_(aba);
  return aba.getRange(2, 1, aba.getLastRow() - 1, aba.getLastColumn()).getValues()
    .map(function (linha, i) {
      var o = { __linha: i + 2 };
      cab.forEach(function (c, k) { o[c] = linha[k]; });
      return o;
    }).filter(function (o) { return o.id; });
}

function AP_TAREFAS_ms_(v) {
  if (!v) return 0;
  var d = (v instanceof Date) ? v : new Date(v);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

/** Marca como expiradas as tarefas paradas há muito tempo. Use num acionador diário. */
function AP_TAREFAS_limpar() {
  var dias = Number(AP_Config_get('TAREFAS_DIAS_VALIDADE', 30)) || 30;
  var limite = new Date().getTime() - dias * 864e5;
  var aba = AP_TAREFAS_aba_();
  if (!aba) return 'Aba não existe.';
  var cab = AP_TAREFAS_cab_(aba);
  var mexidas = 0;
  AP_TAREFAS_linhas_(aba).forEach(function (l) {
    if (['CONCLUIDA', 'CANCELADA', 'EXPIRADA'].indexOf(String(l.status)) > -1) return;
    if (AP_TAREFAS_ms_(l.atualizadoEm) > limite) return;
    aba.getRange(l.__linha, cab.indexOf('status') + 1).setValue('EXPIRADA');
    mexidas++;
  });
  Logger.log(mexidas + ' tarefa(s) marcada(s) como expiradas.');
  return mexidas;
}
