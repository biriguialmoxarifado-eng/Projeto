/**
 * ============================================================
 * ALMOXA PRO — CORE
 * 07 · TEMPLATES BIOMÉTRICOS E COMPARAÇÃO NO SERVIDOR
 * ============================================================
 * O QUE ISTO RESOLVE
 *
 * Antes o template ficava só no computador da ponte. Consequência:
 * o celular não conseguia validar nada, e a planilha não mostrava
 * prova nenhuma de que houve leitura.
 *
 * Agora o template é guardado no Core e a COMPARAÇÃO acontece
 * aqui. Qualquer aparelho manda a leitura e pergunta de quem é.
 *
 *     celular   ┐
 *     computador├→ biometria.identificar → Core compara → identidade
 *     Central   ┘
 *
 * ------------------------------------------------------------
 * ONDE O TEMPLATE FICA
 *
 * Numa aba própria, ALMOXA_TEMPLATES, uma linha por dedo.
 * O desenho (os tracinhos) fica numa coluna ao lado, para você
 * conferir a olho.
 *
 * Não é a imagem da digital — essa nunca sai do leitor, e nem o
 * fabricante entrega. É a representação numérica dela, que é o
 * que serve para comparar.
 *
 * ------------------------------------------------------------
 * UMA COISA QUE PRECISO DIZER UMA VEZ
 *
 * Template biométrico é dado sensível pela LGPD. Guardar em
 * planilha exige: acesso restrito a quem precisa, consentimento
 * por escrito de cada colaborador, e cuidado com quem tem link
 * de edição. A aba nasce oculta para ajudar, mas isso não
 * substitui controlar as permissões da planilha.
 *
 * Você decidiu centralizar, e a decisão é sua. Só não quero que
 * ela seja tomada sem essa informação.
 *
 * ------------------------------------------------------------
 * COMO INSTALAR
 *
 * 1. + > Script, nome: BIOMETRIA_TEMPLATES
 * 2. Cole este arquivo
 * 3. Rode AP_Tpl_prepararAba() uma vez
 * 4. Registre no roteador:
 *      'biometria.salvarTemplate' : AP_Tpl_salvar,
 *      'biometria.identificar'    : AP_Tpl_identificar,
 *      'biometria.templates'      : AP_Tpl_listar,
 *      'biometria.removerTemplate': AP_Tpl_remover
 * 5. Publique nova versão
 * ============================================================
 */

var AP_TPL_ABA = 'ALMOXA_TEMPLATES';

var AP_TPL_COLUNAS = [
  'ID', 'MATRICULA', 'NOME', 'TIPO', 'DEDO', 'CODIGO',
  'TEMPLATE', 'DESENHO', 'QUALIDADE', 'AMOSTRAS',
  'STATUS', 'CRIADO_EM', 'CRIADO_POR', 'ORIGEM', 'ULTIMO_USO', 'USOS'
];

/* Quanto dois templates podem diferir e ainda ser o mesmo dedo.
   Mais baixo, mais rígido. Vale para digital e facial. */
var AP_TPL_LIMIAR_DIGITAL = 0.22;
var AP_TPL_LIMIAR_FACIAL = 0.62;

/* Margem mínima sobre o segundo colocado. Sem isso, dois
   cadastros parecidos fariam o sistema chutar. */
var AP_TPL_MARGEM_MINIMA = 0.06;

/** Cria a aba. Rode uma vez, no editor. */
function AP_Tpl_prepararAba() {
  var ss = AP_Config_getSpreadsheet_();
  var aba = ss.getSheetByName(AP_TPL_ABA);

  if (!aba) {
    aba = ss.insertSheet(AP_TPL_ABA);
    aba.getRange(1, 1, 1, AP_TPL_COLUNAS.length).setValues([AP_TPL_COLUNAS]);
    aba.getRange(1, 1, 1, AP_TPL_COLUNAS.length)
       .setFontWeight('bold').setBackground('#0B2A55').setFontColor('#ffffff');
    aba.setFrozenRows(1);

    /* a coluna do desenho em fonte de largura fixa, para os
       tracinhos ficarem alinhados e legíveis */
    var iDes = AP_TPL_COLUNAS.indexOf('DESENHO') + 1;
    aba.getRange(2, iDes, 500, 1).setFontFamily('Courier New').setFontSize(8);
    aba.setColumnWidth(iDes, 110);

    var iTpl = AP_TPL_COLUNAS.indexOf('TEMPLATE') + 1;
    aba.setColumnWidth(iTpl, 60);

    /* nasce oculta: não é aba para ficar aberta no dia a dia */
    aba.hideSheet();

    Logger.log('Aba ' + AP_TPL_ABA + ' criada e oculta.');
    Logger.log('Para ver: menu Exibir > Planilhas ocultas.');
  } else {
    Logger.log('A aba ' + AP_TPL_ABA + ' já existe.');
  }
  return { ok: true, aba: AP_TPL_ABA };
}

function AP_Tpl_aba_() {
  var ss = AP_Config_getSpreadsheet_();
  var aba = ss.getSheetByName(AP_TPL_ABA);
  if (!aba) { AP_Tpl_prepararAba(); aba = ss.getSheetByName(AP_TPL_ABA); }
  return aba;
}

function AP_Tpl_indices_(aba) {
  var cab = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0]
    .map(function (c) { return String(c).trim().toUpperCase(); });
  var ix = {};
  AP_TPL_COLUNAS.forEach(function (n) { ix[n] = cab.indexOf(n); });
  return ix;
}

/**
 * biometria.salvarTemplate
 *
 * @param p.matricula  obrigatório
 * @param p.tipo       digital | facial
 * @param p.dedo       rótulo do dedo, quando digital
 * @param p.template   array de números, ou texto JSON
 * @param p.desenho    os tracinhos, para conferência visual
 */
function AP_Tpl_salvar(p) {
  p = p || {};

  var mat = String(p.matricula || '').trim();
  if (!mat) return AP_Utils_erro('SEM_MATRICULA', 'Informe a matrícula.');

  var tipo = String(p.tipo || 'digital').toLowerCase();
  var tpl = AP_Tpl_normalizar_(p.template);

  if (!tpl || tpl.length < 16) {
    return AP_Utils_erro('SEM_TEMPLATE',
      'Nenhum template foi enviado, ou ele é curto demais. ' +
      'Sem template não há como comparar depois.');
  }

  /* este dedo já é de outra pessoa? */
  var conflito = AP_Tpl_procurar_(tpl, tipo, mat);
  if (conflito.achou) {
    return AP_Utils_erro('BIOMETRIA_DE_OUTRO',
      'Esta leitura é muito parecida com a de ' + conflito.nome +
      ', matrícula ' + conflito.matricula + '. Confira antes de cadastrar.');
  }

  var aba = AP_Tpl_aba_();
  var ix = AP_Tpl_indices_(aba);
  var dedo = String(p.dedo || (tipo === 'facial' ? 'rosto' : 'indicador-direito'));
  var codigo = String(p.codigo || p.codigoLeitura || AP_Tpl_codigo_(tpl));

  /* substitui o mesmo dedo da mesma pessoa, em vez de duplicar */
  var ultima = aba.getLastRow();
  if (ultima >= 2) {
    var dados = aba.getRange(2, 1, ultima - 1, aba.getLastColumn()).getValues();
    for (var i = 0; i < dados.length; i++) {
      var mesmaPessoa = String(dados[i][ix.MATRICULA]).replace(/^0+/, '') === mat.replace(/^0+/, '');
      var mesmoDedo = String(dados[i][ix.DEDO]) === dedo;
      var mesmoTipo = String(dados[i][ix.TIPO]).toLowerCase() === tipo;
      if (mesmaPessoa && mesmoDedo && mesmoTipo) {
        aba.getRange(i + 2, ix.STATUS + 1).setValue('Substituida');
      }
    }
  }

  var agora = new Date();
  var id = 'TPL-' + Utilities.formatDate(agora, 'GMT-3', 'yyyyMMdd-HHmmss') +
           '-' + Math.floor(Math.random() * 900 + 100);

  var linha = new Array(aba.getLastColumn()).fill('');
  function por(c, v) { if (ix[c] >= 0) linha[ix[c]] = v; }

  por('ID', id);
  por('MATRICULA', mat);
  por('NOME', String(p.nome || ''));
  por('TIPO', tipo);
  por('DEDO', dedo);
  por('CODIGO', codigo);
  por('TEMPLATE', JSON.stringify(tpl));
  por('DESENHO', String(p.desenho || AP_Tpl_desenho_(tpl)));
  por('QUALIDADE', p.qualidade || '');
  por('AMOSTRAS', p.amostras || 1);
  por('STATUS', 'Ativa');
  por('CRIADO_EM', agora);
  por('CRIADO_POR', String(p.registradoPor || p.criadoPor || ''));
  por('ORIGEM', String(p.origem || 'SISTEMA'));
  por('USOS', 0);

  aba.appendRow(linha);

  try {
    AP_Auditoria_registrar({
      acao: 'Template biométrico salvo', modulo: 'Biometria',
      registro: id + ' · ' + tipo + ' · ' + dedo + ' · matrícula ' + mat +
        ' · código ' + codigo,
      usuario: String(p.registradoPor || mat), resultado: 'OK'
    });
  } catch (e) {}

  return AP_Utils_ok({
    id: id, codigo: codigo, tipo: tipo, dedo: dedo,
    valores: tpl.length, criadoEm: agora.toISOString()
  }, 'Template guardado. Agora qualquer aparelho consegue comparar.');
}

/**
 * biometria.identificar
 * É ESTA a ação que o celular e o computador chamam antes de
 * liberar qualquer coisa.
 *
 * @param p.template  a leitura feita agora
 * @param p.tipo      digital | facial
 * @param p.matricula opcional: confere se é quem se diz
 */
function AP_Tpl_identificar(p) {
  p = p || {};

  var tpl = AP_Tpl_normalizar_(p.template);
  if (!tpl || tpl.length < 16) {
    return AP_Utils_erro('SEM_LEITURA',
      'Nenhuma leitura foi enviada. O aparelho precisa mandar o template.');
  }

  var tipo = String(p.tipo || 'digital').toLowerCase();
  var r = AP_Tpl_procurar_(tpl, tipo, null);

  if (!r.total) {
    return AP_Utils_erro('SEM_CADASTRO',
      'Nenhuma biometria ' + tipo + ' cadastrada no sistema para comparar.');
  }

  if (!r.achou) {
    return AP_Utils_erro('NAO_IDENTIFICADO',
      'Nenhuma biometria cadastrada corresponde a esta leitura.', {
        comparados: r.total,
        maisProximo: r.maisProximo,
        distancia: r.melhorDistancia,
        limiar: r.limiar,
        semelhanca: Math.round((1 - r.melhorDistancia) * 100),
        codigoLido: AP_Tpl_codigo_(tpl)
      });
  }

  if (r.ambiguo) {
    return AP_Utils_erro('AMBIGUO',
      'Duas biometrias cadastradas ficaram parecidas demais com esta leitura. ' +
      'Por segurança, não vou escolher entre elas.', {
        candidatos: r.candidatos, margem: r.margem
      });
  }

  /* o aparelho disse de quem deveria ser: conferimos */
  if (p.matricula) {
    var esperada = String(p.matricula).replace(/^0+/, '');
    var veio = String(r.matricula).replace(/^0+/, '');
    if (esperada !== veio) {
      try {
        AP_Auditoria_registrar({
          acao: 'Biometria de outra pessoa', modulo: 'Biometria',
          registro: 'esperava matrícula ' + p.matricula + ', a leitura é de ' + r.nome,
          usuario: String(p.operador || ''), resultado: 'NEGADO'
        });
      } catch (e) {}
      return AP_Utils_erro('BIOMETRIA_DE_OUTRO',
        'Esta biometria é de ' + r.nome + ', não da matrícula informada.');
    }
  }

  AP_Tpl_marcarUso_(r.linha);

  return AP_Utils_ok({
    matricula: r.matricula,
    nome: r.nome,
    tipo: tipo,
    dedo: r.dedo,
    credencialId: r.id,
    codigoCadastrado: r.codigo,
    codigoLido: AP_Tpl_codigo_(tpl),
    semelhanca: Math.round((1 - r.melhorDistancia) * 100),
    distancia: Math.round(r.melhorDistancia * 1000) / 1000,
    margem: Math.round(r.margem * 1000) / 1000,
    comparados: r.total,
    desenhoCadastrado: r.desenho
  }, 'Identificado: ' + r.nome + '.');
}

/**
 * Procura o template mais parecido.
 * @param ignorarMatricula quando informada, pula essa pessoa
 */
function AP_Tpl_procurar_(tpl, tipo, ignorarMatricula) {
  var aba = AP_Tpl_aba_();
  var ultima = aba.getLastRow();
  var limiar = (tipo === 'facial') ? AP_TPL_LIMIAR_FACIAL : AP_TPL_LIMIAR_DIGITAL;

  if (ultima < 2) {
    return { achou: false, total: 0, limiar: limiar, melhorDistancia: 9 };
  }

  var ix = AP_Tpl_indices_(aba);
  var dados = aba.getRange(2, 1, ultima - 1, aba.getLastColumn()).getValues();
  var pular = ignorarMatricula ? String(ignorarMatricula).replace(/^0+/, '') : null;

  var melhor = null, menor = 9, segundo = 9, total = 0, candidatos = [];

  for (var i = 0; i < dados.length; i++) {
    var l = dados[i];
    if (String(l[ix.STATUS] || '').toLowerCase().indexOf('ativ') < 0) continue;
    if (String(l[ix.TIPO] || '').toLowerCase() !== tipo) continue;

    var mat = String(l[ix.MATRICULA] || '').replace(/^0+/, '');
    if (pular && mat === pular) continue;

    var outro = AP_Tpl_normalizar_(l[ix.TEMPLATE]);
    if (!outro || outro.length !== tpl.length) continue;

    total++;
    var d = AP_Tpl_distancia_(tpl, outro);

    if (d < menor) {
      segundo = menor;
      menor = d;
      melhor = {
        linha: i + 2, id: l[ix.ID], matricula: l[ix.MATRICULA], nome: l[ix.NOME],
        dedo: l[ix.DEDO], codigo: l[ix.CODIGO], desenho: l[ix.DESENHO]
      };
    } else if (d < segundo) {
      segundo = d;
    }

    if (d <= limiar) {
      candidatos.push({ nome: l[ix.NOME], matricula: l[ix.MATRICULA],
                        distancia: Math.round(d * 1000) / 1000 });
    }
  }

  var margem = segundo - menor;

  if (!melhor || menor > limiar) {
    return { achou: false, total: total, limiar: limiar, melhorDistancia: menor,
             maisProximo: melhor ? melhor.nome : null };
  }

  /* dois candidatos colados: não escolhemos no chute */
  if (candidatos.length > 1 && margem < AP_TPL_MARGEM_MINIMA) {
    return { achou: false, ambiguo: true, total: total, limiar: limiar,
             melhorDistancia: menor, margem: margem, candidatos: candidatos };
  }

  melhor.achou = true;
  melhor.total = total;
  melhor.limiar = limiar;
  melhor.melhorDistancia = menor;
  melhor.margem = margem;
  return melhor;
}

/** Distância média entre os valores. */
function AP_Tpl_distancia_(a, b) {
  var s = 0;
  for (var i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

/** Aceita array, texto JSON ou texto com vírgulas. */
function AP_Tpl_normalizar_(v) {
  if (!v) return null;
  if (Array.isArray(v)) return v.map(Number);
  var t = String(v).trim();
  if (!t) return null;
  try {
    var p = JSON.parse(t);
    if (Array.isArray(p)) return p.map(Number);
  } catch (e) {}
  if (t.indexOf(',') > -1) {
    var n = t.split(',').map(function (x) { return Number(x); });
    if (n.every(function (x) { return !isNaN(x); })) return n;
  }
  return null;
}

/** Código estável do template, para aparecer na planilha. */
function AP_Tpl_codigo_(tpl) {
  var chave = tpl.map(function (v) { return Math.round(v * 20); }).join(',');
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, chave);
  var hex = b.map(function (x) {
    return ('0' + (x & 0xFF).toString(16)).slice(-2);
  }).join('').toUpperCase();
  return hex.slice(0, 12).match(/.{1,4}/g).join('-');
}

/** Os tracinhos, para conferir a olho na planilha. */
function AP_Tpl_desenho_(tpl) {
  var niveis = ' .:-=+*#%@';
  var linhas = [];
  var lado = 8;
  for (var l = 0; l < lado; l++) {
    var s = '';
    for (var c = 0; c < lado; c++) {
      var v = tpl[l * lado + c];
      s += niveis[Math.max(0, Math.min(9, Math.floor((v || 0) * 10)))];
    }
    linhas.push(s);
  }
  return linhas.join('\n');
}

function AP_Tpl_marcarUso_(linha) {
  try {
    var aba = AP_Tpl_aba_();
    var ix = AP_Tpl_indices_(aba);
    if (ix.ULTIMO_USO >= 0) aba.getRange(linha, ix.ULTIMO_USO + 1).setValue(new Date());
    if (ix.USOS >= 0) {
      var c = aba.getRange(linha, ix.USOS + 1);
      c.setValue((Number(c.getValue()) || 0) + 1);
    }
  } catch (e) {}
}

/** biometria.templates — lista sem devolver o template bruto. */
function AP_Tpl_listar(p) {
  p = p || {};
  var aba = AP_Tpl_aba_();
  var ultima = aba.getLastRow();
  if (ultima < 2) return AP_Utils_ok([], 'Nenhum template cadastrado.');

  var ix = AP_Tpl_indices_(aba);
  var dados = aba.getRange(2, 1, ultima - 1, aba.getLastColumn()).getValues();
  var filtro = p.matricula ? String(p.matricula).replace(/^0+/, '') : null;

  var lista = [];
  dados.forEach(function (l) {
    if (String(l[ix.STATUS] || '').toLowerCase().indexOf('ativ') < 0) return;
    var mat = String(l[ix.MATRICULA] || '').replace(/^0+/, '');
    if (filtro && mat !== filtro) return;

    lista.push({
      id: l[ix.ID], matricula: l[ix.MATRICULA], nome: l[ix.NOME],
      tipo: l[ix.TIPO], dedo: l[ix.DEDO], codigo: l[ix.CODIGO],
      desenho: l[ix.DESENHO], qualidade: l[ix.QUALIDADE],
      criadoEm: l[ix.CRIADO_EM], ultimoUso: l[ix.ULTIMO_USO], usos: l[ix.USOS]
      /* o TEMPLATE não sai daqui: só a comparação dentro do Core o usa */
    });
  });

  return AP_Utils_ok(lista, lista.length + ' template(s).');
}

/** biometria.removerTemplate */
function AP_Tpl_remover(p) {
  p = p || {};
  var alvo = String(p.id || '').trim();
  if (!alvo) return AP_Utils_erro('SEM_ID', 'Informe qual template remover.');

  var aba = AP_Tpl_aba_();
  var ultima = aba.getLastRow();
  if (ultima < 2) return AP_Utils_erro('NAO_ENCONTRADO', 'Nenhum template cadastrado.');

  var ix = AP_Tpl_indices_(aba);
  var dados = aba.getRange(2, 1, ultima - 1, aba.getLastColumn()).getValues();

  for (var i = 0; i < dados.length; i++) {
    if (String(dados[i][ix.ID]) === alvo) {
      aba.getRange(i + 2, ix.STATUS + 1).setValue('Revogada');
      return AP_Utils_ok({ id: alvo }, 'Template revogado.');
    }
  }
  return AP_Utils_erro('NAO_ENCONTRADO', 'Template não localizado.');
}

/** Confere o módulo. Rode no editor. */
function AP_Tpl_diagnostico() {
  var r = { aba: false, ativos: 0, digitais: 0, faciais: 0, pessoas: {}, avisos: [] };

  try {
    var aba = AP_Tpl_aba_();
    r.aba = true;
    var ultima = aba.getLastRow();

    if (ultima >= 2) {
      var ix = AP_Tpl_indices_(aba);
      var dados = aba.getRange(2, 1, ultima - 1, aba.getLastColumn()).getValues();
      dados.forEach(function (l) {
        if (String(l[ix.STATUS] || '').toLowerCase().indexOf('ativ') < 0) return;
        r.ativos++;
        var t = String(l[ix.TIPO] || '').toLowerCase();
        if (t === 'digital') r.digitais++;
        if (t === 'facial') r.faciais++;
        r.pessoas[String(l[ix.MATRICULA])] = true;

        if (!AP_Tpl_normalizar_(l[ix.TEMPLATE])) {
          r.avisos.push('Linha de ' + l[ix.NOME] + ' está sem template válido.');
        }
      });
    }
  } catch (e) {
    r.avisos.push('Erro na aba: ' + e);
  }

  var qtdPessoas = Object.keys(r.pessoas).length;

  Logger.log('================================');
  Logger.log('TEMPLATES BIOMÉTRICOS');
  Logger.log('================================');
  Logger.log('Aba: ' + (r.aba ? AP_TPL_ABA : 'FALTA'));
  Logger.log('Templates ativos: ' + r.ativos);
  Logger.log('  digitais: ' + r.digitais);
  Logger.log('  faciais : ' + r.faciais);
  Logger.log('Pessoas com biometria: ' + qtdPessoas);
  Logger.log('Limiar digital: ' + AP_TPL_LIMIAR_DIGITAL + ' · facial: ' + AP_TPL_LIMIAR_FACIAL);
  Logger.log('');
  Logger.log(r.avisos.length ? '>>> AJUSTAR: ' + r.avisos.join(' | ')
    : r.ativos ? '>>> PRONTO. Qualquer aparelho já pode comparar.'
               : '>>> A aba está vazia. Cadastre uma biometria pela Central.');
  return r;
}

/**
 * Teste sem leitor. Rode no editor para provar que a comparação
 * funciona: cadastra dois dedos de mentira e tenta identificar.
 */
function AP_Tpl_testar() {
  function gerar(semente, ruido) {
    var t = [];
    var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, semente);
    for (var i = 0; i < 64; i++) {
      var v = ((b[i % b.length] & 0xFF) / 255) + ((Math.random() - 0.5) * (ruido || 0));
      t.push(Math.round(Math.max(0, Math.min(1, v)) * 1000) / 1000);
    }
    return t;
  }

  Logger.log('=== TESTE DA COMPARAÇÃO ===');

  var a = AP_Tpl_salvar({ matricula: '__T1__', nome: 'Teste Um', tipo: 'digital',
    dedo: 'indicador-direito', template: gerar('dedo-a', 0.04), origem: 'TESTE' });
  Logger.log('cadastro dedo A: ' + (a.ok ? 'ok · ' + a.dados.codigo : a.codigo));

  var b2 = AP_Tpl_salvar({ matricula: '__T2__', nome: 'Teste Dois', tipo: 'digital',
    dedo: 'indicador-direito', template: gerar('dedo-b', 0.04), origem: 'TESTE' });
  Logger.log('cadastro dedo B: ' + (b2.ok ? 'ok · ' + b2.dados.codigo : b2.codigo));

  var i1 = AP_Tpl_identificar({ tipo: 'digital', template: gerar('dedo-a', 0.06) });
  Logger.log('lendo o dedo A: ' + (i1.ok
    ? 'reconheceu ' + i1.dados.nome + ' · semelhança ' + i1.dados.semelhanca
    : 'NÃO reconheceu · ' + i1.codigo));

  var i2 = AP_Tpl_identificar({ tipo: 'digital', template: gerar('dedo-c', 0.06) });
  Logger.log('lendo um dedo NÃO cadastrado: ' + (i2.ok
    ? 'reconheceu ' + i2.dados.nome + ' — PROBLEMA'
    : 'recusou, correto · ' + i2.codigo));

  var i3 = AP_Tpl_identificar({ tipo: 'digital', template: gerar('dedo-b', 0.06),
    matricula: '__T1__' });
  Logger.log('dedo do B dizendo ser o A: ' + (i3.ok
    ? 'PERMITIU — PROBLEMA' : 'bloqueou, correto · ' + i3.codigo));

  Logger.log('');
  Logger.log('Apague as linhas __T1__ e __T2__ da aba depois do teste.');
  return { a: a, b: b2, i1: i1, i2: i2, i3: i3 };
}

/* ============================================================
   REGISTRO NO ROTEADOR

     'biometria.salvarTemplate'  : AP_Tpl_salvar,
     'biometria.identificar'     : AP_Tpl_identificar,
     'biometria.templates'       : AP_Tpl_listar,
     'biometria.removerTemplate' : AP_Tpl_remover

   Depois de registrar, rode AP_Tpl_testar() no editor. Ele prova
   a comparação sem precisar de leitor.
   ============================================================ */
