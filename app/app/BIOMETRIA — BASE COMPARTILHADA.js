/**
 * ============================================================
 * ALMOXA PRO — CORE
 * 02 · BIOMETRIA — BASE COMPARTILHADA
 * ============================================================
 * Instale este arquivo PRIMEIRO. Os outros dois dependem dele.
 *
 *   02_BIOMETRIA_BASE     (este)      aba, colunas, gravação
 *   03_BIOMETRIA_DIGITAL             leitor de digital
 *   04_BIOMETRIA_FACIAL              reconhecimento facial
 *
 * O QUE A PLANILHA GUARDA
 *   matrícula, tipo, aparelho, data, qualidade, assinatura,
 *   status e o identificador da credencial.
 *
 * O QUE ELA NÃO GUARDA
 *   imagem do rosto e imagem da digital. Dado biométrico bruto
 *   é sensível pela LGPD, e planilha vazada é planilha vazada.
 *   A imagem serve para conferir na hora e é descartada.
 * ============================================================
 */

var AP_BIO_ABA = 'CREDENCIAIS';

var AP_BIO_COLUNAS = [
  'ID', 'MATRICULA', 'NOME', 'TIPO', 'CREDENCIAL',
  'APARELHO', 'APELIDO', 'QUALIDADE', 'ASSINATURA',
  'STATUS', 'CRIADO_EM', 'ULTIMO_USO', 'ORIGEM', 'OBSERVACAO'
];

/** Cria a aba. Rode uma vez, no editor. */
function AP_Bio_prepararAba() {
  var ss = AP_Config_getSpreadsheet_();
  var aba = ss.getSheetByName(AP_BIO_ABA);

  if (!aba) {
    aba = ss.insertSheet(AP_BIO_ABA);
    aba.getRange(1, 1, 1, AP_BIO_COLUNAS.length).setValues([AP_BIO_COLUNAS]);
    aba.getRange(1, 1, 1, AP_BIO_COLUNAS.length)
       .setFontWeight('bold').setBackground('#0B2A55').setFontColor('#ffffff');
    aba.setFrozenRows(1);
    Logger.log('Aba ' + AP_BIO_ABA + ' criada.');
  } else {
    Logger.log('A aba ' + AP_BIO_ABA + ' já existe.');
  }
  return { ok: true, aba: AP_BIO_ABA };
}

function AP_Bio_aba_() {
  var ss = AP_Config_getSpreadsheet_();
  var aba = ss.getSheetByName(AP_BIO_ABA);
  if (!aba) { AP_Bio_prepararAba(); aba = ss.getSheetByName(AP_BIO_ABA); }
  return aba;
}

function AP_Bio_indices_(aba) {
  var cab = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0]
    .map(function (c) { return String(c).trim().toUpperCase(); });
  var ix = {};
  AP_BIO_COLUNAS.forEach(function (nome) { ix[nome] = cab.indexOf(nome); });
  return ix;
}

/** Grava a credencial. Usado pelo digital e pelo facial. */
function AP_Bio_gravar_(dados) {
  var aba = AP_Bio_aba_();
  var ix = AP_Bio_indices_(aba);
  var agora = new Date();
  var id = 'BIO-' + Utilities.formatDate(agora, 'GMT-3', 'yyyyMMdd-HHmmss') +
           '-' + Math.floor(Math.random() * 900 + 100);

  var linha = new Array(aba.getLastColumn()).fill('');
  function por(col, valor) { if (ix[col] >= 0) linha[ix[col]] = valor; }

  por('ID', id);
  por('MATRICULA', String(dados.matricula || ''));
  por('NOME', String(dados.nome || ''));
  por('TIPO', String(dados.tipo || ''));
  por('CREDENCIAL', String(dados.credencial || ''));
  por('APARELHO', String(dados.aparelho || ''));
  por('APELIDO', String(dados.apelido || dados.aparelho || ''));
  por('QUALIDADE', dados.qualidade === undefined ? '' : dados.qualidade);
  por('ASSINATURA', String(dados.assinatura || ''));
  por('STATUS', 'Ativa');
  por('CRIADO_EM', agora);
  por('ORIGEM', String(dados.origem || 'MOBILE'));
  por('OBSERVACAO', String(dados.observacao || ''));

  aba.appendRow(linha);

  try {
    AP_Auditoria_registrar({
      acao: 'Credencial criada', modulo: 'Biometria',
      registro: id + ' · ' + dados.tipo + ' · matrícula ' + dados.matricula,
      usuario: String(dados.nome || dados.matricula), resultado: 'OK'
    });
  } catch (e) {}

  return { id: id, criadoEm: agora };
}

/** Lê as credenciais ativas, opcionalmente de uma matrícula. */
function AP_Bio_ativas_(matricula) {
  var aba = AP_Bio_aba_();
  var ultima = aba.getLastRow();
  if (ultima < 2) return [];

  var ix = AP_Bio_indices_(aba);
  var dados = aba.getRange(2, 1, ultima - 1, aba.getLastColumn()).getValues();
  var filtro = String(matricula || '').replace(/^0+/, '');

  var lista = [];
  dados.forEach(function (l, i) {
    if (String(l[ix.STATUS] || '').toLowerCase().indexOf('ativ') < 0) return;
    var mat = String(l[ix.MATRICULA] || '').replace(/^0+/, '');
    if (filtro && mat !== filtro) return;
    lista.push({
      linha: i + 2,
      id: l[ix.ID], matricula: l[ix.MATRICULA], nome: l[ix.NOME],
      tipo: String(l[ix.TIPO] || '').toLowerCase(),
      credencial: l[ix.CREDENCIAL], aparelho: l[ix.APARELHO],
      apelido: l[ix.APELIDO], qualidade: l[ix.QUALIDADE],
      assinatura: String(l[ix.ASSINATURA] || ''),
      criadoEm: l[ix.CRIADO_EM], ultimoUso: l[ix.ULTIMO_USO], origem: l[ix.ORIGEM]
    });
  });
  return lista;
}

function AP_Bio_marcarUso_(linha) {
  try {
    var aba = AP_Bio_aba_();
    var ix = AP_Bio_indices_(aba);
    if (ix.ULTIMO_USO >= 0) aba.getRange(linha, ix.ULTIMO_USO + 1).setValue(new Date());
  } catch (e) {}
}

/**
 * usuarios.credenciais
 * Lista para o aplicativo. A assinatura não sai daqui.
 */
function AP_Bio_listarCredenciais(p) {
  p = p || {};
  var lista = AP_Bio_ativas_(p.matricula).map(function (c) {
    return {
      id: c.id, matricula: c.matricula, nome: c.nome, tipo: c.tipo,
      credencialId: c.credencial, aparelho: c.aparelho, apelido: c.apelido,
      qualidade: c.qualidade, status: 'Ativa',
      data: c.criadoEm, ultimoUso: c.ultimoUso, origem: c.origem
    };
  });
  return AP_Utils_ok(lista, lista.length + ' credencial(is).');
}

/**
 * usuarios.removerCredencial
 * Não apaga a linha: marca como revogada, para o histórico ficar.
 */
function AP_Bio_removerCredencial(p) {
  p = p || {};
  var alvo = String(p.id || p.credencialId || '').trim();
  if (!alvo) return AP_Utils_erro('SEM_ID', 'Informe qual credencial remover.');

  var aba = AP_Bio_aba_();
  var ultima = aba.getLastRow();
  if (ultima < 2) return AP_Utils_erro('NAO_ENCONTRADA', 'Nenhuma credencial cadastrada.');

  var ix = AP_Bio_indices_(aba);
  var dados = aba.getRange(2, 1, ultima - 1, aba.getLastColumn()).getValues();

  for (var i = 0; i < dados.length; i++) {
    if (String(dados[i][ix.ID]) === alvo || String(dados[i][ix.CREDENCIAL]) === alvo) {
      aba.getRange(i + 2, ix.STATUS + 1).setValue('Revogada');
      if (ix.OBSERVACAO >= 0) {
        aba.getRange(i + 2, ix.OBSERVACAO + 1)
           .setValue('Revogada em ' + new Date().toISOString() +
                     ' por ' + String(p.usuario || p.matricula || '—'));
      }
      return AP_Utils_ok({ id: alvo, status: 'Revogada' }, 'Credencial revogada.');
    }
  }
  return AP_Utils_erro('NAO_ENCONTRADA', 'Credencial não localizada.');
}

/**
 * usuarios.vincularCredencial
 * Porta de entrada. Encaminha para o módulo do tipo certo.
 */
function AP_Bio_vincularCredencial(p) {
  p = p || {};

  if (!String(p.matricula || '').trim()) {
    return AP_Utils_erro('SEM_MATRICULA', 'Informe a matrícula do usuário.');
  }

  var tipo = String(p.tipo || 'digital').toLowerCase();

  if (tipo === 'digital') {
    if (typeof AP_Digital_cadastrar !== 'function') {
      return AP_Utils_erro('MODULO_AUSENTE',
        'Instale o arquivo 03_BIOMETRIA_DIGITAL no Apps Script.');
    }
    return AP_Digital_cadastrar(p);
  }

  if (tipo === 'facial') {
    if (typeof AP_Facial_cadastrar !== 'function') {
      return AP_Utils_erro('MODULO_AUSENTE',
        'Instale o arquivo 04_BIOMETRIA_FACIAL no Apps Script.');
    }
    return AP_Facial_cadastrar(p);
  }

  if (tipo === 'cracha') {
    var codigo = String(p.cracha || p.codigo || '').trim();
    if (!codigo) return AP_Utils_erro('SEM_LEITURA', 'Nenhum crachá foi lido.');
    var r = AP_Bio_gravar_({
      matricula: p.matricula, nome: p.nome, tipo: 'cracha',
      credencial: 'CRACHA-' + codigo, aparelho: p.aparelho,
      apelido: p.apelido, origem: p.origem, observacao: 'Código do crachá'
    });
    return AP_Utils_ok({ id: r.id, tipo: 'cracha' }, 'Crachá vinculado.');
  }

  return AP_Utils_erro('TIPO_DESCONHECIDO', 'Tipo não reconhecido: ' + tipo);
}

/** Confere se a base está pronta. Rode no editor. */
function AP_Bio_diagnostico() {
  var r = { aba: false, registros: 0, digital: false, facial: false, avisos: [] };

  try {
    var aba = AP_Bio_aba_();
    r.aba = true;
    r.registros = Math.max(0, aba.getLastRow() - 1);
    var ix = AP_Bio_indices_(aba);
    AP_BIO_COLUNAS.forEach(function (c) {
      if (ix[c] < 0) r.avisos.push('Falta a coluna ' + c);
    });
  } catch (e) {
    r.avisos.push('Erro na aba: ' + e);
  }

  r.digital = (typeof AP_Digital_cadastrar === 'function');
  r.facial = (typeof AP_Facial_cadastrar === 'function');
  if (!r.digital) r.avisos.push('Módulo 03_BIOMETRIA_DIGITAL não instalado');
  if (!r.facial) r.avisos.push('Módulo 04_BIOMETRIA_FACIAL não instalado');

  Logger.log(JSON.stringify(r, null, 2));
  Logger.log(r.avisos.length ? '>>> AJUSTAR: ' + r.avisos.join(' | ') : '>>> TUDO PRONTO');
  return r;
}

/* ============================================================
   REGISTRO NO ROTEADOR

     'usuarios.vincularCredencial' : AP_Bio_vincularCredencial,
     'usuarios.credenciais'        : AP_Bio_listarCredenciais,
     'usuarios.removerCredencial'  : AP_Bio_removerCredencial
   ============================================================ */
