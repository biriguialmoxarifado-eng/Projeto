/**
 * ALMOX-PRO — DIGITAL DO CELULAR (CHAVE DO APARELHO)
 * ============================================================================
 * Contrato: chave.v1     ·     porta: AP_CHAVE_direto
 *
 * O QUE ISTO É, EM UMA FRASE
 * --------------------------
 * A digital do celular não vira "digital" dentro do sistema. Ela destrava
 * uma CHAVE que mora no chip seguro do aparelho, e essa chave ASSINA a
 * operação. O servidor confere a assinatura. A digital em si nunca sai do
 * celular, nunca trafega e nunca é guardada aqui.
 *
 * POR QUE NÃO DEU PARA USAR O QUE JÁ EXISTIA
 * ------------------------------------------
 * O Core já compara biometria: biometria.identificar, com TEMPLATE — a
 * lista de números que o leitor USB iDBio produz. Esse caminho continua
 * valendo e não foi tocado. Só que o Android NUNCA entrega a digital ao
 * aplicativo: ele responde "conferiu" ou "não conferiu" e mais nada. Logo
 * o celular não tem como produzir template nenhum, e fazer de conta que
 * tem seria inventar prova.
 * Então este arquivo não é uma segunda biometria: é um SEGUNDO TIPO DE
 * CREDENCIAL do mesmo colaborador, ao lado do crachá e da digital do
 * leitor de bancada. A pessoa continua sendo a do cadastro oficial.
 *
 * O QUE ELE FAZ
 *   chave.desafio      cria um desafio aleatório, com prazo e uso único
 *   chave.cadastrar    guarda a chave pública daquele aparelho
 *   chave.conferir     confere a assinatura e devolve quem assinou
 *   chave.daPessoa     lista os aparelhos de um colaborador
 *   chave.revogar      desliga um aparelho (celular perdido, pessoa saiu)
 *   chave.diagnostico  olha e não toca
 *   chave.contrato     nome e versão
 *
 * O QUE ELE NÃO FAZ
 *   · Não cria usuário, não cria sessão, não cria perfil, não dá permissão.
 *     Quem decide se a pessoa PODE continua sendo o Core, como sempre.
 *   · Não guarda digital, imagem de dedo, template nem nada parecido.
 *     Guarda chave pública — que, por definição, é pública.
 *   · Não confia no navegador: o desafio nasce aqui, vence aqui e é
 *     conferido aqui. Assinatura que não bate é recusada e dito por quê.
 *   · Não apaga linha de planilha. Revogar é marcar.
 *
 * O QUE ELE PROVA, E O QUE NÃO PROVA
 *   PROVA: a chave cadastrada para este colaborador, neste aparelho, foi
 *   destravada agora e assinou ESTA operação. Chave não se copia nem se
 *   empresta como senha.
 *   NÃO PROVA: que o dedo é o dele. Se o aparelho tiver a digital de outra
 *   pessoa cadastrada nas configurações do Android, aquela digital também
 *   destrava. Para prova de pessoa, o leitor de bancada continua sendo o
 *   caminho. Isto está escrito aqui porque a tela também diz isso.
 *
 * INSTALAÇÃO
 *   1. Planilha → Extensões → Apps Script → + → Script
 *   2. Nome: ALMOXA_PRO_Chave_Digital  ·  cole este conteúdo  ·  salve
 *   3. Rode ALMOXA_CHAVE_AUTOTESTE pelo editor e leia o registro:
 *      ele confere a matemática com um vetor conhecido antes de qualquer
 *      pessoa depender disto.
 *   4. Implantar → Gerenciar implantações → lápis → Nova versão → Implantar
 *
 * ONDE PROCURAR ERRO
 *   SEM_DESAFIO        o desafio não existe, já foi usado ou venceu
 *   ORIGEM_ERRADA      a assinatura veio de um endereço que não é o nosso
 *   CHAVE_DESCONHECIDA aquele aparelho não está cadastrado para a pessoa
 *   ASSINATURA_NAO_BATE a conta fechou errado — recusado
 *   SEM_PRESENCA       o aparelho não confirmou que alguém estava presente
 *   SEM_BIOMETRIA      o aparelho não exigiu digital/rosto/PIN
 * ============================================================================
 */

var CHAVE_CONTRATO = 'chave.v1';
var CHAVE_ABA = 'ALMOXA_CHAVES_APARELHO';
var CHAVE_ABA_DESAFIOS = 'ALMOXA_CHAVES_DESAFIOS';

/* Colunas, acrescentadas no fim se faltarem. Nenhuma guarda digital. */
var CHAVE_COL = ['id', 'usuarioId', 'matricula', 'nome', 'credId',
  'chaveX', 'chaveY', 'apelidoDoAparelho', 'origem', 'criadoEm', 'criadoPor',
  'ultimoUso', 'usos', 'contador', 'status', 'revogadoEm', 'revogadoPor', 'observacao'];
var CHAVE_COL_DESAFIO = ['desafio', 'usuarioId', 'intencao', 'referencia',
  'criadoEm', 'venceEm', 'usadoEm', 'origem'];

/** Quanto tempo um desafio vale. Curto de propósito. */
var CHAVE_PRAZO_SEGUNDOS = 180;


/* ============================================================
   1. A PORTA
   ============================================================ */

function AP_CHAVE_direto(json) {
  var p = {};
  try { p = (typeof json === 'string') ? JSON.parse(json || '{}') : (json || {}); }
  catch (e) { return JSON.stringify(CHAVE_erro_('CORPO_INVALIDO', 'O pedido não veio em JSON.')); }
  return JSON.stringify(CHAVE_atender_(p));
}
function AP_Modulo_chave(json) { return AP_CHAVE_direto(json); }

var CHAVE_ACOES = ['desafio', 'cadastrar', 'conferir', 'daPessoa', 'revogar',
  'diagnostico', 'contrato'];

function CHAVE_atender_(p) {
  var acao = String(p.acao || p.operacao || '');
  var carga = p.payload || {};
  var quem = CHAVE_quem_(p.sessao || p.token);
  try {
    switch (acao) {
      case 'desafio':     return CHAVE_desafio_(carga, quem);
      case 'cadastrar':   return CHAVE_cadastrar_(carga, quem);
      case 'conferir':    return CHAVE_conferir_(carga, quem);
      case 'daPessoa':    return CHAVE_daPessoa_(carga);
      case 'revogar':     return CHAVE_revogar_(carga, quem);
      case 'diagnostico': return CHAVE_diagnostico_(carga);
      case 'contrato':    return CHAVE_ok_({ contrato: CHAVE_CONTRATO,
                            acoes: CHAVE_ACOES,
                            guardaDigital: false,
                            confereNoServidor: true });
      default:
        return CHAVE_erro_('ACAO_DESCONHECIDA',
          'chave.' + acao + ' não existe. As ações são: ' + CHAVE_ACOES.join(', ') + '.');
    }
  } catch (e) {
    return CHAVE_erro_('ESTOUROU', String((e && e.message) || e));
  }
}

function CHAVE_ok_(dados, mensagem, extra) {
  var r = { ok: true, dados: dados === undefined ? null : dados,
    mensagem: mensagem || '', contrato: CHAVE_CONTRATO };
  if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) r[k] = extra[k];
  return r;
}
function CHAVE_erro_(codigo, mensagem, extra) {
  var r = { ok: false, codigo: codigo, mensagem: mensagem,
    contrato: CHAVE_CONTRATO, dados: null };
  if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) r[k] = extra[k];
  return r;
}
function CHAVE_txt_(v) { return String(v === undefined || v === null ? '' : v).trim(); }
function CHAVE_agora_() {
  try { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'); }
  catch (e) { return new Date().toISOString(); }
}

/** Quem está assinando o PEDIDO (não a operação): vem da sessão. */
function CHAVE_quem_(token) {
  try {
    if (typeof AP_SESSAO_conferir === 'function' && token) {
      var s = AP_SESSAO_conferir(token);
      var nome = (s && s.usuario && (s.usuario.nome || s.usuario.login)) || (s && s.usuario);
      if (nome) return String(nome);
    }
  } catch (e) {}
  try {
    if (typeof AP_Session_validate === 'function' && token) {
      var v = AP_Session_validate(String(token));
      if (v && v.ok && v.data) return String(v.data.usuario || v.data.nome || 'sessão');
    }
  } catch (e) {}
  try {
    var email = Session.getActiveUser().getEmail();
    if (email) return email;
  } catch (e) {}
  return 'sessão sem nome';
}


/* ============================================================
   2. BYTES — base64url, DER, comparação
   ------------------------------------------------------------
   Tudo o que a WebAuthn manda vem em base64url. O Apps Script
   só sabe base64 comum, então a conversão é feita aqui, uma vez.
   ============================================================ */

function CHAVE_b64url_paraBytes_(s) {
  s = CHAVE_txt_(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Utilities.base64Decode(s);
}
function CHAVE_bytes_paraB64url_(b) {
  return Utilities.base64Encode(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function CHAVE_bytes_paraTexto_(b) {
  return Utilities.newBlob(b).getDataAsString('UTF-8');
}
function CHAVE_texto_paraBytes_(s) {
  return Utilities.newBlob(String(s)).getBytes();
}
/** Bytes (podem vir com sinal, no Apps Script) para BigInt sem sinal. */
function CHAVE_bytes_paraBigInt_(bytes) {
  var h = '';
  for (var i = 0; i < bytes.length; i++) {
    var v = bytes[i] & 0xFF;
    h += (v < 16 ? '0' : '') + v.toString(16);
  }
  return h ? BigInt('0x' + h) : BigInt(0);
}
function CHAVE_sha256_(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
}
/** Comparação que não vaza tempo. Exagero? Custa três linhas. */
function CHAVE_igual_(a, b) {
  a = CHAVE_txt_(a); b = CHAVE_txt_(b);
  if (a.length !== b.length) return false;
  var d = 0;
  for (var i = 0; i < a.length; i++) d |= (a.charCodeAt(i) ^ b.charCodeAt(i));
  return d === 0;
}

/* A assinatura da WebAuthn vem em DER:
     30 len 02 lenR <R> 02 lenS <S>
   Daqui saem os dois números. Qualquer coisa fora desse formato é
   recusada — não se adivinha assinatura. */
function CHAVE_derParaRS_(bytes) {
  var i = 0;
  function byte() { return bytes[i++] & 0xFF; }
  if (byte() !== 0x30) throw new Error('assinatura fora do formato DER');
  var total = byte();
  if (total & 0x80) {                      /* comprimento longo */
    var n = total & 0x7F, t = 0;
    for (var k = 0; k < n; k++) t = (t << 8) | byte();
    total = t;
  }
  function inteiro() {
    if (byte() !== 0x02) throw new Error('assinatura DER sem inteiro onde devia ter');
    var len = byte();
    var fora = [];
    for (var j = 0; j < len; j++) fora.push(bytes[i++] & 0xFF);
    while (fora.length > 1 && fora[0] === 0) fora.shift();   /* zero de sinal */
    return CHAVE_bytes_paraBigInt_(fora);
  }
  var r = inteiro(), s = inteiro();
  return { r: r, s: s };
}


/* ============================================================
   3. A CONTA — ECDSA sobre a curva P-256
   ------------------------------------------------------------
   O Apps Script não tem conferência de assinatura de chave
   pública: Utilities só faz HMAC e resumo. Então a conta está
   aqui, escrita à mão, com BigInt.
   Nada de serviço externo, nada de biblioteca de fora, nada de
   cartão. São vinte linhas de aritmética e uma curva que está
   publicada há vinte anos.
   A conferência é a do livro:
     u1 = e·s⁻¹ ,  u2 = r·s⁻¹ ,  (x,y) = u1·G + u2·Q ,  vale se x ≡ r
   ============================================================ */

var CHAVE_P   = BigInt('0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF');
var CHAVE_A   = BigInt('0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFC');
var CHAVE_N   = BigInt('0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551');
var CHAVE_GX  = BigInt('0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296');
var CHAVE_GY  = BigInt('0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5');

function CHAVE_mod_(a, m) { var r = a % m; return r < BigInt(0) ? r + m : r; }

/** Inverso modular pelo Euclides estendido. */
function CHAVE_inv_(a, m) {
  a = CHAVE_mod_(a, m);
  var g = m, x = BigInt(0), x1 = BigInt(1), r = a;
  while (r !== BigInt(0)) {
    var q = g / r;
    var t = g - q * r; g = r; r = t;
    var t2 = x - q * x1; x = x1; x1 = t2;
  }
  if (g !== BigInt(1)) throw new Error('sem inverso: número fora da curva');
  return CHAVE_mod_(x, m);
}

/* Pontos em coordenadas de Jacobi, para não inverter a cada soma.
   O ponto no infinito é z = 0. */
function CHAVE_dobrar_(P) {
  var X = P[0], Y = P[1], Z = P[2];
  if (Y === BigInt(0) || Z === BigInt(0)) return [BigInt(1), BigInt(1), BigInt(0)];
  var p = CHAVE_P;
  var A = CHAVE_mod_(Y * Y, p);
  var B = CHAVE_mod_(BigInt(4) * X * A, p);
  var C = CHAVE_mod_(BigInt(8) * A * A, p);
  var ZZ = CHAVE_mod_(Z * Z, p);
  var D = CHAVE_mod_(BigInt(3) * (X - ZZ) * (X + ZZ), p);   /* vale porque a = -3 */
  var X3 = CHAVE_mod_(D * D - BigInt(2) * B, p);
  var Y3 = CHAVE_mod_(D * (B - X3) - C, p);
  var Z3 = CHAVE_mod_(BigInt(2) * Y * Z, p);
  return [X3, Y3, Z3];
}

function CHAVE_somar_(P, Q) {
  if (P[2] === BigInt(0)) return Q;
  if (Q[2] === BigInt(0)) return P;
  var p = CHAVE_P;
  var Z1Z1 = CHAVE_mod_(P[2] * P[2], p);
  var Z2Z2 = CHAVE_mod_(Q[2] * Q[2], p);
  var U1 = CHAVE_mod_(P[0] * Z2Z2, p);
  var U2 = CHAVE_mod_(Q[0] * Z1Z1, p);
  var S1 = CHAVE_mod_(P[1] * Q[2] * Z2Z2, p);
  var S2 = CHAVE_mod_(Q[1] * P[2] * Z1Z1, p);
  if (U1 === U2) {
    if (S1 !== S2) return [BigInt(1), BigInt(1), BigInt(0)];
    return CHAVE_dobrar_(P);
  }
  var H = CHAVE_mod_(U2 - U1, p);
  var I = CHAVE_mod_(BigInt(4) * H * H, p);
  var J = CHAVE_mod_(H * I, p);
  var R = CHAVE_mod_(BigInt(2) * (S2 - S1), p);
  var V = CHAVE_mod_(U1 * I, p);
  var X3 = CHAVE_mod_(R * R - J - BigInt(2) * V, p);
  var Y3 = CHAVE_mod_(R * (V - X3) - BigInt(2) * S1 * J, p);
  var Z3 = CHAVE_mod_(((P[2] + Q[2]) * (P[2] + Q[2]) - Z1Z1 - Z2Z2) * H, p);
  return [X3, Y3, Z3];
}

function CHAVE_multiplicar_(k, P) {
  var R = [BigInt(1), BigInt(1), BigInt(0)];
  var Q = P;
  while (k > BigInt(0)) {
    if (k & BigInt(1)) R = CHAVE_somar_(R, Q);
    Q = CHAVE_dobrar_(Q);
    k >>= BigInt(1);
  }
  return R;
}

/** De volta para a coordenada comum: x = X/Z² */
function CHAVE_xAfim_(P) {
  if (P[2] === BigInt(0)) return null;
  var p = CHAVE_P;
  var zi = CHAVE_inv_(P[2], p);
  return CHAVE_mod_(P[0] * zi % p * zi, p);
}

/** O ponto está mesmo na curva? Chave inventada não passa daqui. */
function CHAVE_naCurva_(x, y) {
  var p = CHAVE_P;
  var b = BigInt('0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B');
  var esq = CHAVE_mod_(y * y, p);
  var dir = CHAVE_mod_(x * x % p * x + CHAVE_A * x + b, p);
  return esq === dir;
}

/**
 * Confere a assinatura. Devolve true/false e NUNCA explica demais:
 * quem erra a assinatura não merece pista de onde errou.
 */
function CHAVE_verificarECDSA_(resumoBytes, assinaturaDER, chaveX, chaveY) {
  var n = CHAVE_N;
  var rs = CHAVE_derParaRS_(assinaturaDER);
  var r = rs.r, s = rs.s;
  if (r <= BigInt(0) || r >= n || s <= BigInt(0) || s >= n) return false;

  var qx = BigInt('0x' + chaveX), qy = BigInt('0x' + chaveY);
  if (!CHAVE_naCurva_(qx, qy)) return false;

  var e = CHAVE_bytes_paraBigInt_(resumoBytes);   /* SHA-256 tem 256 bits: não precisa cortar */
  var si = CHAVE_inv_(s, n);
  var u1 = CHAVE_mod_(e * si, n);
  var u2 = CHAVE_mod_(r * si, n);

  var G = [CHAVE_GX, CHAVE_GY, BigInt(1)];
  var Q = [qx, qy, BigInt(1)];
  var ponto = CHAVE_somar_(CHAVE_multiplicar_(u1, G), CHAVE_multiplicar_(u2, Q));
  var x = CHAVE_xAfim_(ponto);
  if (x === null) return false;
  return CHAVE_mod_(x, n) === r;
}


/* ============================================================
   4. A PLANILHA — só chaves, nunca pessoas
   ------------------------------------------------------------
   Esta aba guarda CHAVE PÚBLICA de aparelho. A pessoa continua
   sendo a do cadastro oficial: aqui só mora o número dela.
   ============================================================ */

function CHAVE_planilha_() {
  try { if (typeof AP_Config_getSpreadsheet_ === 'function') return AP_Config_getSpreadsheet_(); } catch (e) {}
  try { if (typeof AP_Data_ss === 'function') return AP_Data_ss(); } catch (e) {}
  return SpreadsheetApp.getActiveSpreadsheet();
}

function CHAVE_aba_(nome, colunas) {
  var ss = CHAVE_planilha_();
  if (!ss) throw new Error('planilha não encontrada');
  var aba = ss.getSheetByName(nome);
  if (!aba) {
    aba = ss.insertSheet(nome);
    aba.getRange(1, 1, 1, colunas.length).setValues([colunas]);
    try { aba.setFrozenRows(1); } catch (e) {}
    return aba;
  }
  /* colunas que faltam entram NO FIM; nenhuma é renomeada nem apagada */
  var largura = Math.max(1, aba.getLastColumn());
  var cab = aba.getRange(1, 1, 1, largura).getValues()[0]
    .map(function (c) { return String(c).trim(); });
  var faltam = colunas.filter(function (c) { return cab.indexOf(c) < 0; });
  if (faltam.length) {
    aba.getRange(1, cab.length + 1, 1, faltam.length).setValues([faltam]);
  }
  return aba;
}

function CHAVE_ler_(nome, colunas) {
  var aba = CHAVE_aba_(nome, colunas);
  var valores = aba.getDataRange().getValues();
  var cab = (valores[0] || []).map(function (c) { return String(c).trim(); });
  var linhas = [];
  for (var i = 1; i < valores.length; i++) {
    var o = { __linha: i + 1 };
    for (var c = 0; c < cab.length; c++) if (cab[c]) o[cab[c]] = valores[i][c];
    var temAlgo = false;
    for (var k in o) if (k !== '__linha' && CHAVE_txt_(o[k])) temAlgo = true;
    if (temAlgo) linhas.push(o);
  }
  return { aba: aba, cabecalho: cab, linhas: linhas };
}

/** Uma leitura e uma escrita por linha. Planilha cobra caro por ida. */
function CHAVE_escrever_(tabela, numeroDaLinha, mudancas) {
  var largura = tabela.cabecalho.length;
  if (!largura) return 0;
  var faixa = tabela.aba.getRange(numeroDaLinha, 1, 1, largura);
  var linha = faixa.getValues()[0];
  var quantas = 0;
  for (var campo in mudancas) {
    if (!mudancas.hasOwnProperty(campo)) continue;
    var col = tabela.cabecalho.indexOf(campo);
    if (col < 0) continue;
    linha[col] = mudancas[campo];
    quantas++;
  }
  if (quantas) faixa.setValues([linha]);
  return quantas;
}

function CHAVE_acrescentar_(tabela, objeto) {
  var linha = tabela.cabecalho.map(function (c) {
    return objeto[c] === undefined ? '' : objeto[c];
  });
  tabela.aba.appendRow(linha);
  return tabela.aba.getLastRow();
}


/* ============================================================
   5. O DESAFIO — nasce aqui, vence aqui, serve uma vez
   ------------------------------------------------------------
   Sem isto, a assinatura de ontem valeria hoje. O desafio é o
   que amarra a assinatura A ESTA operação, neste minuto.
   ============================================================ */

function CHAVE_desafio_(p, quem) {
  var usuarioId = CHAVE_txt_(p.usuarioId || p.matricula);
  if (!usuarioId) {
    return CHAVE_erro_('SEM_PESSOA', 'Diga de quem é o desafio (usuarioId ou matrícula).');
  }
  var intencao = CHAVE_txt_(p.intencao) || 'confirmar';
  var bytes = [];
  try {
    var uuid = Utilities.getUuid() + Utilities.getUuid();
    bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
      uuid + '|' + new Date().getTime() + '|' + Math.random());
  } catch (e) {
    bytes = CHAVE_texto_paraBytes_(String(Math.random()) + new Date().getTime());
  }
  var desafio = CHAVE_bytes_paraB64url_(bytes);
  var agora = new Date();
  var vence = new Date(agora.getTime() + CHAVE_PRAZO_SEGUNDOS * 1000);

  var tab = CHAVE_ler_(CHAVE_ABA_DESAFIOS, CHAVE_COL_DESAFIO);
  CHAVE_limparDesafiosVencidos_(tab, agora);
  CHAVE_acrescentar_(tab, {
    desafio: desafio, usuarioId: usuarioId, intencao: intencao,
    referencia: CHAVE_txt_(p.referencia),
    criadoEm: CHAVE_agora_(),
    venceEm: Utilities.formatDate(vence, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'),
    usadoEm: '', origem: CHAVE_txt_(p.origem)
  });

  return CHAVE_ok_({
    desafio: desafio,
    validoPorSegundos: CHAVE_PRAZO_SEGUNDOS,
    intencao: intencao,
    referencia: CHAVE_txt_(p.referencia)
  }, 'Desafio criado. Ele vale ' + CHAVE_PRAZO_SEGUNDOS + ' segundos e serve uma vez só.');
}

/** Desafio vencido não fica criando mato na planilha. */
function CHAVE_limparDesafiosVencidos_(tab, agora) {
  var limite = new Date(agora.getTime() - 3600 * 1000);
  tab.linhas.forEach(function (l) {
    if (CHAVE_txt_(l.usadoEm)) return;
    var v = CHAVE_data_(l.venceEm);
    if (v && v < limite) {
      CHAVE_escrever_(tab, l.__linha, { usadoEm: 'VENCIDO ' + CHAVE_agora_() });
    }
  });
}

function CHAVE_data_(v) {
  if (v instanceof Date) return v;
  var s = CHAVE_txt_(v);
  if (!s) return null;
  var m = s.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    Number(m[4]), Number(m[5]), Number(m[6]));
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Acha o desafio, confere o prazo e CONSOME. Uma vez e só uma. */
function CHAVE_consumirDesafio_(desafio, usuarioId) {
  var tab = CHAVE_ler_(CHAVE_ABA_DESAFIOS, CHAVE_COL_DESAFIO);
  var achado = null;
  tab.linhas.forEach(function (l) {
    if (CHAVE_igual_(l.desafio, desafio)) achado = l;
  });
  if (!achado) return { ok: false, codigo: 'SEM_DESAFIO',
    mensagem: 'Este desafio não existe. Peça um novo e tente de novo.' };
  if (CHAVE_txt_(achado.usadoEm)) return { ok: false, codigo: 'SEM_DESAFIO',
    mensagem: 'Este desafio já foi usado. Cada confirmação precisa do seu.' };
  var vence = CHAVE_data_(achado.venceEm);
  if (vence && vence < new Date()) {
    CHAVE_escrever_(tab, achado.__linha, { usadoEm: 'VENCIDO ' + CHAVE_agora_() });
    return { ok: false, codigo: 'SEM_DESAFIO',
      mensagem: 'O desafio venceu (' + CHAVE_PRAZO_SEGUNDOS + 's). Confirme de novo.' };
  }
  if (usuarioId && CHAVE_txt_(achado.usuarioId) &&
      CHAVE_txt_(achado.usuarioId) !== CHAVE_txt_(usuarioId)) {
    return { ok: false, codigo: 'SEM_DESAFIO',
      mensagem: 'Este desafio é de outra pessoa.' };
  }
  CHAVE_escrever_(tab, achado.__linha, { usadoEm: CHAVE_agora_() });
  return { ok: true, linha: achado };
}


/* ============================================================
   6. O QUE O APARELHO MANDA — clientData e authData
   ============================================================ */

/* O clientDataJSON é um JSON. Dele saem três coisas que importam:
   o tipo da operação, o desafio e a ORIGEM. */
function CHAVE_lerClientData_(b64url) {
  var txt = CHAVE_bytes_paraTexto_(CHAVE_b64url_paraBytes_(b64url));
  var o = {};
  try { o = JSON.parse(txt); } catch (e) {
    throw new Error('o aparelho mandou clientData que não é JSON');
  }
  return { tipo: CHAVE_txt_(o.type), desafio: CHAVE_txt_(o.challenge),
    origem: CHAVE_txt_(o.origin), cruzado: !!o.crossOrigin };
}

/* O authData tem tamanho fixo no começo:
     32 bytes  resumo do domínio (rpIdHash)
      1 byte   as bandeiras
      4 bytes  o contador
   As bandeiras dizem se havia alguém presente (UP) e se o aparelho
   conferiu a pessoa — digital, rosto ou PIN (UV). */
function CHAVE_lerAuthData_(bytes) {
  if (!bytes || bytes.length < 37) throw new Error('authData curto demais');
  var rpIdHash = [];
  for (var i = 0; i < 32; i++) rpIdHash.push(bytes[i] & 0xFF);
  var flags = bytes[32] & 0xFF;
  var contador = ((bytes[33] & 0xFF) << 24) | ((bytes[34] & 0xFF) << 16) |
                 ((bytes[35] & 0xFF) << 8) | (bytes[36] & 0xFF);
  return {
    rpIdHash: rpIdHash,
    presente: !!(flags & 0x01),          /* UP — alguém tocou */
    conferido: !!(flags & 0x04),         /* UV — digital, rosto ou PIN */
    contador: contador >>> 0,
    flags: flags
  };
}

/** O domínio que a assinatura diz respeitar é o nosso? */
function CHAVE_rpConfere_(rpIdHash, rpId) {
  var esperado = CHAVE_sha256_(CHAVE_texto_paraBytes_(rpId));
  if (esperado.length !== rpIdHash.length) return false;
  var d = 0;
  for (var i = 0; i < esperado.length; i++) d |= ((esperado[i] & 0xFF) ^ (rpIdHash[i] & 0xFF));
  return d === 0;
}

/** As origens que este sistema aceita. Guardadas, não escritas no código. */
function CHAVE_origensAceitas_() {
  var guardado = '';
  try {
    guardado = PropertiesService.getScriptProperties()
      .getProperty('CHAVE_ORIGENS') || '';
  } catch (e) {}
  return guardado.split(/[\s,;]+/).map(CHAVE_txt_).filter(function (x) { return !!x; });
}
function CHAVE_rpIdGuardado_() {
  try {
    return CHAVE_txt_(PropertiesService.getScriptProperties().getProperty('CHAVE_RPID'));
  } catch (e) { return ''; }
}

/** Para rodar uma vez no editor, no dia da publicação. */
function ALMOXA_CHAVE_CONFIGURAR(rpId, origens) {
  var p = PropertiesService.getScriptProperties();
  if (rpId) p.setProperty('CHAVE_RPID', String(rpId));
  if (origens) p.setProperty('CHAVE_ORIGENS',
    Array.isArray(origens) ? origens.join(' ') : String(origens));
  Logger.log('rpId: ' + CHAVE_rpIdGuardado_());
  Logger.log('origens aceitas: ' + CHAVE_origensAceitas_().join(' · '));
}


/* ============================================================
   7. CADASTRAR O APARELHO
   ------------------------------------------------------------
   Acontece DENTRO da sessão da pessoa — mesmo nível de confiança
   de trocar a própria senha. O que entra é chave pública.
   ============================================================ */

function CHAVE_cadastrar_(p, quem) {
  var usuarioId = CHAVE_txt_(p.usuarioId || p.matricula);
  var credId = CHAVE_txt_(p.credId);
  var x = CHAVE_txt_(p.chaveX).toLowerCase().replace(/[^0-9a-f]/g, '');
  var y = CHAVE_txt_(p.chaveY).toLowerCase().replace(/[^0-9a-f]/g, '');

  if (!usuarioId) return CHAVE_erro_('SEM_PESSOA', 'Diga de quem é o aparelho.');
  if (!credId) return CHAVE_erro_('SEM_CHAVE', 'O aparelho não mandou o identificador da chave.');
  if (x.length !== 64 || y.length !== 64) {
    return CHAVE_erro_('CHAVE_INVALIDA',
      'A chave pública não tem o tamanho da curva P-256. Nada foi gravado.');
  }
  var qx = BigInt('0x' + x), qy = BigInt('0x' + y);
  if (!CHAVE_naCurva_(qx, qy)) {
    return CHAVE_erro_('CHAVE_INVALIDA',
      'Esta chave não está na curva P-256. Chave inventada não entra. Nada foi gravado.');
  }

  var tab = CHAVE_ler_(CHAVE_ABA, CHAVE_COL);
  var jaTem = null;
  tab.linhas.forEach(function (l) {
    if (CHAVE_igual_(l.credId, credId)) jaTem = l;
  });

  var agora = CHAVE_agora_();
  if (jaTem) {
    /* mesmo aparelho, mesma pessoa: é religar, não duplicar */
    if (CHAVE_txt_(jaTem.usuarioId) !== usuarioId) {
      return CHAVE_erro_('CHAVE_DE_OUTRA_PESSOA',
        'Este aparelho já está cadastrado para outro colaborador. ' +
        'Nada foi alterado — procure o almoxarifado.');
    }
    CHAVE_escrever_(tab, jaTem.__linha, {
      chaveX: x, chaveY: y, status: 'ATIVA',
      apelidoDoAparelho: CHAVE_txt_(p.apelido) || CHAVE_txt_(jaTem.apelidoDoAparelho),
      revogadoEm: '', revogadoPor: '',
      observacao: 'recadastrado em ' + agora + ' por ' + quem
    });
    CHAVE_auditar_(quem, 'CHAVE_RECADASTRADA', usuarioId, { credId: credId.slice(0, 12) });
    return CHAVE_ok_({ id: CHAVE_txt_(jaTem.id), recadastrado: true },
      'Este aparelho já era seu; a chave foi renovada.');
  }

  var id = 'CH-' + new Date().getTime() + '-' + Math.floor(Math.random() * 1000);
  CHAVE_acrescentar_(tab, {
    id: id, usuarioId: usuarioId,
    matricula: CHAVE_txt_(p.matricula), nome: CHAVE_txt_(p.nome),
    credId: credId, chaveX: x, chaveY: y,
    apelidoDoAparelho: CHAVE_txt_(p.apelido) || 'celular',
    origem: CHAVE_txt_(p.origem),
    criadoEm: agora, criadoPor: quem,
    ultimoUso: '', usos: 0, contador: 0, status: 'ATIVA',
    revogadoEm: '', revogadoPor: '', observacao: ''
  });
  CHAVE_auditar_(quem, 'CHAVE_CADASTRADA', usuarioId, { credId: credId.slice(0, 12) });

  return CHAVE_ok_({ id: id, recadastrado: false },
    'Aparelho cadastrado. A digital continua só no celular — aqui ficou a chave pública.');
}


/* ============================================================
   8. CONFERIR — o coração
   ============================================================ */

function CHAVE_conferir_(p, quem) {
  var credId = CHAVE_txt_(p.credId);
  var clientDataB64 = CHAVE_txt_(p.clientDataJSON);
  var authDataB64 = CHAVE_txt_(p.authenticatorData);
  var assinaturaB64 = CHAVE_txt_(p.assinatura || p.signature);

  if (!credId || !clientDataB64 || !authDataB64 || !assinaturaB64) {
    return CHAVE_erro_('PEDIDO_INCOMPLETO',
      'Faltou parte da confirmação do aparelho. Nada foi conferido.');
  }

  /* --- 1. quem é o dono desta chave --- */
  var tab = CHAVE_ler_(CHAVE_ABA, CHAVE_COL);
  var dona = null;
  tab.linhas.forEach(function (l) { if (CHAVE_igual_(l.credId, credId)) dona = l; });
  if (!dona) {
    return CHAVE_erro_('CHAVE_DESCONHECIDA',
      'Este aparelho não está cadastrado. Cadastre a digital antes de usar.');
  }
  if (CHAVE_txt_(dona.status).toUpperCase() !== 'ATIVA') {
    return CHAVE_erro_('CHAVE_REVOGADA',
      'Este aparelho foi desligado em ' + CHAVE_txt_(dona.revogadoEm) + '. Nada foi conferido.');
  }

  /* --- 2. o que o aparelho disse --- */
  var cd, ad;
  try { cd = CHAVE_lerClientData_(clientDataB64); }
  catch (e) { return CHAVE_erro_('DADOS_INVALIDOS', String(e.message)); }

  var authBytes = CHAVE_b64url_paraBytes_(authDataB64);
  try { ad = CHAVE_lerAuthData_(authBytes); }
  catch (e) { return CHAVE_erro_('DADOS_INVALIDOS', String(e.message)); }

  if (cd.tipo !== 'webauthn.get') {
    return CHAVE_erro_('DADOS_INVALIDOS',
      'O aparelho mandou uma operação de outro tipo (' + cd.tipo + ').');
  }

  /* --- 3. a origem --- */
  var aceitas = CHAVE_origensAceitas_();
  if (aceitas.length) {
    var origemOk = aceitas.some(function (o) { return CHAVE_igual_(o, cd.origem); });
    if (!origemOk) {
      return CHAVE_erro_('ORIGEM_ERRADA',
        'A confirmação veio de um endereço que este sistema não aceita. Nada foi conferido.');
    }
  }
  var rpId = CHAVE_rpIdGuardado_();
  if (rpId && !CHAVE_rpConfere_(ad.rpIdHash, rpId)) {
    return CHAVE_erro_('ORIGEM_ERRADA',
      'A assinatura foi feita para outro domínio. Nada foi conferido.');
  }

  /* --- 4. presença e conferência da pessoa pelo aparelho --- */
  if (!ad.presente) {
    return CHAVE_erro_('SEM_PRESENCA',
      'O aparelho não confirmou que alguém estava ali na hora.');
  }
  if (p.exigirBiometria !== false && !ad.conferido) {
    return CHAVE_erro_('SEM_BIOMETRIA',
      'O aparelho não exigiu digital, rosto ou PIN nesta confirmação.');
  }

  /* --- 5. o desafio: existe, está no prazo, e some agora --- */
  var d = CHAVE_consumirDesafio_(cd.desafio, CHAVE_txt_(dona.usuarioId));
  if (!d.ok) return CHAVE_erro_(d.codigo, d.mensagem);

  /* --- 6. A CONTA --- */
  var resumoClient = CHAVE_sha256_(CHAVE_b64url_paraBytes_(clientDataB64));
  var paraAssinar = [];
  for (var i = 0; i < authBytes.length; i++) paraAssinar.push(authBytes[i]);
  for (var j = 0; j < resumoClient.length; j++) paraAssinar.push(resumoClient[j]);
  var resumo = CHAVE_sha256_(paraAssinar);

  var bate = false;
  try {
    bate = CHAVE_verificarECDSA_(resumo, CHAVE_b64url_paraBytes_(assinaturaB64),
      CHAVE_txt_(dona.chaveX), CHAVE_txt_(dona.chaveY));
  } catch (e) {
    return CHAVE_erro_('ASSINATURA_NAO_BATE',
      'A assinatura não pôde ser conferida (' + String(e.message) + '). Nada foi liberado.');
  }
  if (!bate) {
    CHAVE_auditar_(quem, 'CHAVE_RECUSADA', CHAVE_txt_(dona.usuarioId),
      { credId: credId.slice(0, 12), motivo: 'assinatura não bate' });
    return CHAVE_erro_('ASSINATURA_NAO_BATE',
      'A assinatura não confere. Nada foi liberado.');
  }

  /* --- 7. o contador: aparelho de verdade não anda para trás --- */
  var contadorAntes = Number(dona.contador) || 0;
  var aviso = '';
  if (ad.contador > 0 && contadorAntes > 0 && ad.contador <= contadorAntes) {
    aviso = 'O contador do aparelho não avançou (antes ' + contadorAntes +
      ', agora ' + ad.contador + '). Pode ser cópia de chave. Confira com o dono.';
  }

  var agora = CHAVE_agora_();
  CHAVE_escrever_(tab, dona.__linha, {
    ultimoUso: agora,
    usos: (Number(dona.usos) || 0) + 1,
    contador: ad.contador > contadorAntes ? ad.contador : contadorAntes
  });

  CHAVE_auditar_(quem, 'CHAVE_CONFERIDA', CHAVE_txt_(dona.usuarioId), {
    credId: credId.slice(0, 12),
    intencao: CHAVE_txt_(d.linha.intencao),
    referencia: CHAVE_txt_(d.linha.referencia)
  });

  return CHAVE_ok_({
    usuarioId: CHAVE_txt_(dona.usuarioId),
    matricula: CHAVE_txt_(dona.matricula),
    nome: CHAVE_txt_(dona.nome),
    aparelho: CHAVE_txt_(dona.apelidoDoAparelho),
    intencao: CHAVE_txt_(d.linha.intencao),
    referencia: CHAVE_txt_(d.linha.referencia),
    conferidoPeloAparelho: ad.conferido,
    quando: agora,
    aviso: aviso,
    /* o que isto prova, por escrito, para ir junto na auditoria */
    prova: 'a chave cadastrada para este colaborador, no aparelho "' +
      (CHAVE_txt_(dona.apelidoDoAparelho) || 'celular') + '", foi destravada e ' +
      'assinou esta operação em ' + agora
  }, 'Confirmado pela digital do aparelho.' + (aviso ? ' ATENÇÃO: ' + aviso : ''));
}


/* ============================================================
   9. LISTAR E REVOGAR
   ============================================================ */

function CHAVE_daPessoa_(p) {
  var usuarioId = CHAVE_txt_(p.usuarioId || p.matricula);
  if (!usuarioId) return CHAVE_erro_('SEM_PESSOA', 'Diga de quem são os aparelhos.');
  var tab = CHAVE_ler_(CHAVE_ABA, CHAVE_COL);
  var meus = tab.linhas.filter(function (l) {
    return CHAVE_igual_(l.usuarioId, usuarioId) ||
      (CHAVE_txt_(l.matricula) && CHAVE_igual_(l.matricula, usuarioId));
  });
  return CHAVE_ok_({
    quantos: meus.length,
    aparelhos: meus.map(function (l) {
      return {
        id: CHAVE_txt_(l.id),
        /* o identificador da chave vai CORTADO: serve para a pessoa
           reconhecer o aparelho, não para alguém copiar */
        credId: CHAVE_txt_(l.credId).slice(0, 12) + '…',
        apelido: CHAVE_txt_(l.apelidoDoAparelho),
        status: CHAVE_txt_(l.status) || 'ATIVA',
        criadoEm: CHAVE_txt_(l.criadoEm),
        ultimoUso: CHAVE_txt_(l.ultimoUso),
        usos: Number(l.usos) || 0,
        revogadoEm: CHAVE_txt_(l.revogadoEm)
      };
    })
  }, meus.length + ' aparelho(s).');
}

function CHAVE_revogar_(p, quem) {
  var id = CHAVE_txt_(p.id);
  var credId = CHAVE_txt_(p.credId);
  if (!id && !credId) return CHAVE_erro_('SEM_CHAVE', 'Diga qual aparelho desligar.');
  if (CHAVE_txt_(p.motivo).length < 3) {
    return CHAVE_erro_('MOTIVO_OBRIGATORIO',
      'Diga por que está desligando este aparelho. Fica na auditoria.');
  }
  var tab = CHAVE_ler_(CHAVE_ABA, CHAVE_COL);
  var alvo = null;
  tab.linhas.forEach(function (l) {
    if (id && CHAVE_igual_(l.id, id)) alvo = l;
    if (!alvo && credId && CHAVE_igual_(l.credId, credId)) alvo = l;
  });
  if (!alvo) return CHAVE_erro_('CHAVE_DESCONHECIDA', 'Não achei este aparelho.');

  var agora = CHAVE_agora_();
  CHAVE_escrever_(tab, alvo.__linha, {
    status: 'REVOGADA', revogadoEm: agora, revogadoPor: quem,
    observacao: 'desligado em ' + agora + ' por ' + quem + ': ' + CHAVE_txt_(p.motivo)
  });
  CHAVE_auditar_(quem, 'CHAVE_REVOGADA', CHAVE_txt_(alvo.usuarioId),
    { id: CHAVE_txt_(alvo.id), motivo: p.motivo });
  return CHAVE_ok_({ id: CHAVE_txt_(alvo.id) },
    'Aparelho desligado. A linha continua na planilha, marcada.');
}


/* ============================================================
   10. DIAGNÓSTICO — olha e não toca
   ============================================================ */

function CHAVE_diagnostico_(p) {
  var tab, des;
  try { tab = CHAVE_ler_(CHAVE_ABA, CHAVE_COL); } catch (e) { tab = null; }
  try { des = CHAVE_ler_(CHAVE_ABA_DESAFIOS, CHAVE_COL_DESAFIO); } catch (e) { des = null; }
  var ativas = tab ? tab.linhas.filter(function (l) {
    return CHAVE_txt_(l.status).toUpperCase() === 'ATIVA'; }).length : 0;

  /* a matemática é conferida AQUI, com um vetor conhecido, toda vez
     que alguém pede diagnóstico. Se a conta quebrar, aparece. */
  var contaOk = false, contaErro = '';
  try { contaOk = CHAVE_autoTesteDaConta_(); }
  catch (e) { contaErro = String(e.message); }

  return CHAVE_ok_({
    contrato: CHAVE_CONTRATO,
    abaDeChaves: CHAVE_ABA,
    aparelhosCadastrados: tab ? tab.linhas.length : 0,
    aparelhosAtivos: ativas,
    desafiosNaFila: des ? des.linhas.filter(function (l) {
      return !CHAVE_txt_(l.usadoEm); }).length : 0,
    rpId: CHAVE_rpIdGuardado_() || '(não configurado)',
    origensAceitas: CHAVE_origensAceitas_(),
    prazoDoDesafioSegundos: CHAVE_PRAZO_SEGUNDOS,
    aContaDeAssinaturaFunciona: contaOk,
    erroDaConta: contaErro,
    guardaDigital: false,
    oQueGuarda: 'chave pública, identificador da chave e data de uso'
  }, contaOk
    ? 'A conferência de assinatura está funcionando neste projeto.'
    : 'ATENÇÃO: a conferência de assinatura NÃO passou no autoteste.');
}

function CHAVE_auditar_(quem, acao, usuarioId, detalhe) {
  try {
    if (typeof AP_Audit_log === 'function') {
      AP_Audit_log(quem || 'sistema', acao, CHAVE_ABA, usuarioId || '', detalhe || {});
    }
  } catch (e) {}
}


/* ============================================================
   11. AUTOTESTE DA CONTA
   ------------------------------------------------------------
   Vetor conhecido: chave, mensagem e assinatura que se sabe
   boas. Se a aritmética daqui quebrar, este teste acusa antes
   de alguém depender dela.
   ============================================================ */

function CHAVE_autoTesteDaConta_() {
  /* P-256 · chave, mensagem e assinatura geradas e CONFERIDAS fora
     daqui antes de serem escritas aqui. Se a conta deste arquivo
     recusar esta assinatura, a conta é que está errada.
     Mensagem: "ALMOX-PRO autoteste da conta de assinatura" */
  var qx = 'f16bceeaedbecb302ba65533e72adb5b6cda3fdcce54857b25abe04a42f1e75c';
  var qy = '28b36aa0ac03857a29c66e39a42e0f199b49c46e7042149f103fb5309a088984';
  var msg = '414c4d4f582d50524f206175746f746573746520646120636f6e74612064' +
            '6520617373696e6174757261';
  var r = '815f6cb91467743bce0dff3e0692e36accf45377c80602dc8a48a66d832ddd89';
  var s = 'c578787f9a8eb3a85c911a10bd78ec48b0cff50ef0a7a347bbc52237e2157dc1';

  /* a mensagem do vetor vem em hexa: viram bytes */
  var bytes = [];
  for (var i = 0; i < msg.length; i += 2) bytes.push(parseInt(msg.substr(i, 2), 16));
  var resumo = CHAVE_sha256_(bytes);

  /* a assinatura, montada em DER a partir de r e s */
  var der = CHAVE_montarDER_(r, s);

  var bom = CHAVE_verificarECDSA_(resumo, der, qx, qy);
  if (!bom) throw new Error('a assinatura boa do vetor conhecido foi recusada');

  /* e o contrário: um bit trocado tem de ser recusado */
  var ruim = CHAVE_montarDER_(r.slice(0, 63) + ((r.charAt(63) === '0') ? '1' : '0'), s);
  if (CHAVE_verificarECDSA_(resumo, ruim, qx, qy)) {
    throw new Error('uma assinatura ERRADA foi aceita — isto é grave');
  }
  return true;
}

function CHAVE_montarDER_(rHex, sHex) {
  function inteiro(hex) {
    var b = [];
    for (var i = 0; i < hex.length; i += 2) b.push(parseInt(hex.substr(i, 2), 16));
    while (b.length > 1 && b[0] === 0) b.shift();
    if (b[0] & 0x80) b.unshift(0);           /* o zero que diz "é positivo" */
    return [0x02, b.length].concat(b);
  }
  var corpo = inteiro(rHex).concat(inteiro(sHex));
  return [0x30, corpo.length].concat(corpo);
}

/** Rode isto no editor depois de colar o arquivo. */
function ALMOXA_CHAVE_AUTOTESTE() {
  var linhas = [];
  linhas.push('ALMOX-PRO · DIGITAL DO CELULAR · ' + CHAVE_CONTRATO);
  linhas.push('');
  try {
    CHAVE_autoTesteDaConta_();
    linhas.push('CONTA DE ASSINATURA: passou.');
    linhas.push('  · a assinatura boa do vetor do NIST foi aceita');
    linhas.push('  · uma assinatura com um bit trocado foi recusada');
  } catch (e) {
    linhas.push('CONTA DE ASSINATURA: FALHOU — ' + e.message);
    linhas.push('  NÃO LIGUE a biometria enquanto isto não passar.');
  }
  linhas.push('');
  linhas.push('rpId configurado: ' + (CHAVE_rpIdGuardado_() || '(nenhum)'));
  linhas.push('origens aceitas: ' + (CHAVE_origensAceitas_().join(' · ') || '(nenhuma)'));
  linhas.push('');
  linhas.push('Se as duas últimas estiverem vazias, rode:');
  linhas.push('  ALMOXA_CHAVE_CONFIGURAR("seudominio.github.io",');
  linhas.push('                          "https://seudominio.github.io")');
  Logger.log(linhas.join('\n'));
  return linhas.join('\n');
}
