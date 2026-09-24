/**
 * ============================================================
 * ALMOXA PRO — DOCUMENT ENGINE
 * Versão 1.0.0
 * ------------------------------------------------------------
 * GERA PDF DE VERDADE
 *
 * O Apps Script consegue transformar HTML em PDF de verdade,
 * gravar no Drive e devolver um link. É isso que este módulo faz.
 *
 * ------------------------------------------------------------
 * A REGRA QUE MANDA
 *
 * Nunca dizer "PDF gerado" sem o arquivo existir.
 *
 * Depois de gerar, o arquivo é LIDO DE VOLTA do Drive, o tamanho
 * é conferido e os primeiros bytes são checados — um PDF de
 * verdade começa com "%PDF". Se qualquer coisa falhar, o
 * resultado é "PDF NÃO GERADO" com o motivo.
 *
 * ------------------------------------------------------------
 * LINK DE APROVAÇÃO
 *
 * O responsável recebe um link pelo WhatsApp, abre no celular,
 * vê o documento e decide. Sem entrar no sistema, sem senha.
 *
 * O token é aleatório e tem validade. A decisão é registrada
 * pelo Core, não pela página — a página só transporta.
 * ============================================================
 */

var AP_DOC_CFG = {
  versao: '1.0.0',

  abaDocumentos: 'ALMOXA_DOCUMENTOS',
  colunas: ['id', 'tipo', 'template', 'versaoTemplate', 'modulo', 'registro',
    'titulo', 'usuario', 'obra', 'criadoEm', 'arquivo', 'arquivoId',
    'tamanhoBytes', 'paginas', 'hash', 'status', 'erro', 'operacaoId'],

  abaLinks: 'ALMOXA_LINKS_APROVACAO',
  colunasLinks: ['token', 'documento', 'modulo', 'registro', 'criadoEm', 'criadoPor',
    'expiraEm', 'status', 'decisao', 'decidiuEm', 'decididoPor', 'motivo',
    'ip', 'usos', 'ultimoAcesso'],

  pastaDrive: 'ALMOXA PRO — Documentos',

  /* quanto tempo o link vale, em horas */
  validadeHoras: 72
};

function AP_DOC_aba_() {
  AP_Data_getSheet(AP_DOC_CFG.abaDocumentos, AP_DOC_CFG.colunas);
  return AP_DOC_CFG.abaDocumentos;
}

function AP_DOC_abaLinks_() {
  AP_Data_getSheet(AP_DOC_CFG.abaLinks, AP_DOC_CFG.colunasLinks);
  return AP_DOC_CFG.abaLinks;
}

/* ============================================================
   O PAPEL DO DOCUMENTO
   ============================================================ */

/** Cabeçalho e rodapé, iguais em todo documento do sistema */
function AP_DOC_moldura_(dados) {
  var titulo = dados.titulo || 'Documento';
  var numero = dados.numero || '';
  var obra = dados.obra || '';
  var periodo = dados.periodo || '';
  var responsavel = dados.responsavel || '';

  return {
    topo:
      '<div class="cab">' +
      '<div class="marca"><span class="logo">ALMOXA <b>PRO</b></span>' +
      '<span class="sub">Gestão de Materiais e Obras</span></div>' +
      '<div class="doc-id">' +
      (numero ? '<div><span>Documento</span><b>' + AP_DOC_esc_(numero) + '</b></div>' : '') +
      '<div><span>Emissão</span><b>' + AP_DOC_dataHora_() + '</b></div>' +
      '</div></div>' +

      '<h1>' + AP_DOC_esc_(titulo) + '</h1>' +

      '<div class="meta">' +
      (obra ? '<div><span>Obra</span><b>' + AP_DOC_esc_(obra) + '</b></div>' : '') +
      (periodo ? '<div><span>Período</span><b>' + AP_DOC_esc_(periodo) + '</b></div>' : '') +
      (responsavel ? '<div><span>Responsável</span><b>' + AP_DOC_esc_(responsavel) + '</b></div>' : '') +
      '</div>',

    rodape:
      '<div class="rodape">' +
      '<div>ALMOXA PRO · documento gerado pelo sistema em ' + AP_DOC_dataHora_() + '</div>' +
      (dados.documentoId ? '<div class="cod">' + AP_DOC_esc_(dados.documentoId) + '</div>' : '') +
      '</div>'
  };
}

function AP_DOC_estilo_() {
  return '<style>' +
    '@page{size:A4;margin:14mm 12mm}' +
    'body{font-family:Helvetica,Arial,sans-serif;font-size:10pt;color:#1A2634;margin:0}' +
    '.cab{display:flex;justify-content:space-between;align-items:flex-start;' +
    'border-bottom:2px solid #0B2A55;padding-bottom:8px;margin-bottom:14px}' +
    '.logo{font-size:17pt;font-weight:bold;color:#0B2A55;letter-spacing:-.4px}' +
    '.logo b{color:#FF7A00}' +
    '.sub{display:block;font-size:7.5pt;color:#6B7684;margin-top:1px}' +
    '.doc-id{text-align:right;font-size:8pt}' +
    '.doc-id span{color:#6B7684;display:block;font-size:7pt}' +
    '.doc-id b{color:#0B2A55}' +
    'h1{font-size:14pt;color:#0B2A55;margin:0 0 10px}' +
    '.meta{display:flex;gap:22px;background:#F4F7FB;padding:8px 10px;border-radius:4px;' +
    'margin-bottom:14px;font-size:8.5pt}' +
    '.meta span{color:#6B7684;display:block;font-size:7.5pt}' +
    '.meta b{color:#1A2634}' +
    'table{width:100%;border-collapse:collapse;font-size:8.5pt;margin-bottom:12px}' +
    'th{background:#0B2A55;color:#fff;text-align:left;padding:6px 7px;font-size:8pt}' +
    'td{padding:5px 7px;border-bottom:1px solid #E3E9F0}' +
    'tr:nth-child(even) td{background:#FAFCFE}' +
    '.num{text-align:right}' +
    '.totais{background:#F4F7FB;padding:10px;border-radius:4px;margin-bottom:14px}' +
    '.totais div{display:flex;justify-content:space-between;padding:3px 0;font-size:9pt}' +
    '.totais .destaque{border-top:1px solid #C9D6E4;margin-top:4px;padding-top:6px;' +
    'font-weight:bold;font-size:10.5pt;color:#0B2A55}' +
    '.assinaturas{display:flex;gap:40px;margin-top:34px}' +
    '.assinaturas div{flex:1;border-top:1px solid #1A2634;padding-top:5px;' +
    'text-align:center;font-size:8pt;color:#6B7684}' +
    '.rodape{position:fixed;bottom:0;left:0;right:0;display:flex;justify-content:space-between;' +
    'border-top:1px solid #E3E9F0;padding-top:5px;font-size:7pt;color:#6B7684}' +
    '.cod{font-family:monospace}' +
    '.selo{display:inline-block;padding:3px 9px;border-radius:11px;font-size:8pt;font-weight:bold}' +
    '.selo.ok{background:#E9F7EF;color:#14603A}' +
    '.selo.nao{background:#FDEDEC;color:#8B2A22}' +
    '.selo.aguarda{background:#FEF6E7;color:#8A5A00}' +
    '.aviso{background:#FEF6E7;border-left:3px solid #FF9F1C;padding:8px 10px;' +
    'font-size:8.5pt;margin-bottom:12px}' +
    '</style>';
}

function AP_DOC_esc_(t) {
  return String(t === null || t === undefined ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function AP_DOC_dataHora_() {
  try {
    return Utilities.formatDate(new Date(), AP_Config_get('TIMEZONE', 'America/Sao_Paulo'),
      'dd/MM/yyyy HH:mm');
  } catch (e) {
    return new Date().toLocaleString('pt-BR');
  }
}

function AP_DOC_moeda_(v) {
  var n = Number(v) || 0;
  return 'R$ ' + n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/* ============================================================
   OS MODELOS
   ------------------------------------------------------------
   Cada tipo de documento monta seu corpo. A moldura é comum.
   ============================================================ */

var AP_DOC_TEMPLATES = {

  /* ---------- SOLICITAÇÃO PARA APROVAÇÃO ---------- */
  solicitacao: {
    versao: '1.0',
    titulo: 'Solicitação de Materiais',
    montar: function (d) {
      var itens = d.itens || [];
      var total = itens.reduce(function (s, i) {
        return s + (Number(i.qtd || i.quantidade) || 0) * (Number(i.preco || i.valorUnitario) || 0);
      }, 0);

      return '<table><thead><tr>' +
        '<th style="width:34px">#</th><th>Item</th><th>Código</th>' +
        '<th class="num">Qtd</th><th class="num">Unit.</th><th class="num">Total</th>' +
        '</tr></thead><tbody>' +
        itens.map(function (i, n) {
          var qtd = Number(i.qtd || i.quantidade) || 0;
          var preco = Number(i.preco || i.valorUnitario) || 0;
          return '<tr><td>' + (n + 1) + '</td>' +
            '<td>' + AP_DOC_esc_(i.nome || i.descricao) + '</td>' +
            '<td>' + AP_DOC_esc_(i.sku || i.codigo || '') + '</td>' +
            '<td class="num">' + qtd + ' ' + AP_DOC_esc_(i.unidade || 'un') + '</td>' +
            '<td class="num">' + AP_DOC_moeda_(preco) + '</td>' +
            '<td class="num">' + AP_DOC_moeda_(qtd * preco) + '</td></tr>';
        }).join('') +
        '</tbody></table>' +

        '<div class="totais">' +
        '<div><span>Itens diferentes</span><b>' + itens.length + '</b></div>' +
        '<div><span>Quantidade total</span><b>' +
        itens.reduce(function (s, i) { return s + (Number(i.qtd || i.quantidade) || 0); }, 0) +
        '</b></div>' +
        '<div class="destaque"><span>Valor estimado</span><b>' + AP_DOC_moeda_(total) + '</b></div>' +
        '</div>' +

        (d.observacao
          ? '<div class="aviso"><b>Observação</b><br>' + AP_DOC_esc_(d.observacao) + '</div>' : '') +

        '<div class="assinaturas">' +
        '<div>' + AP_DOC_esc_(d.solicitante || 'Solicitante') + '<br>Solicitante</div>' +
        '<div>Aprovador</div>' +
        '</div>';
    }
  },

  /* ---------- FICHA DE ENTREGA DE EPI ---------- */
  fichaEpi: {
    versao: '1.0',
    titulo: 'Ficha de Entrega de EPI',
    montar: function (d) {
      var itens = d.itens || [];

      return '<div class="meta" style="margin-bottom:14px">' +
        '<div><span>Colaborador</span><b>' + AP_DOC_esc_(d.colaborador || '') + '</b></div>' +
        '<div><span>Matrícula</span><b>' + AP_DOC_esc_(d.matricula || '') + '</b></div>' +
        '<div><span>Função</span><b>' + AP_DOC_esc_(d.cargo || '') + '</b></div>' +
        '</div>' +

        '<table><thead><tr>' +
        '<th style="width:34px">#</th><th>Equipamento</th><th>CA</th>' +
        '<th class="num">Qtd</th><th>Entrega</th><th>Validade</th>' +
        '</tr></thead><tbody>' +
        itens.map(function (i, n) {
          return '<tr><td>' + (n + 1) + '</td>' +
            '<td>' + AP_DOC_esc_(i.nome || i.descricao) + '</td>' +
            '<td>' + AP_DOC_esc_(i.ca || '—') + '</td>' +
            '<td class="num">' + (i.qtd || 1) + '</td>' +
            '<td>' + AP_DOC_esc_(i.entrega || d.data || '') + '</td>' +
            '<td>' + AP_DOC_esc_(i.validade || '—') + '</td></tr>';
        }).join('') +
        '</tbody></table>' +

        '<div class="aviso">' +
        '<b>Declaração</b><br>' +
        'Declaro ter recebido os equipamentos de proteção individual acima, ' +
        'gratuitamente, e ter sido orientado quanto ao uso correto, guarda e conservação. ' +
        'Comprometo-me a utilizá-los durante toda a jornada e a comunicar qualquer ' +
        'dano ou extravio.' +
        '</div>' +

        (d.metodoAutenticacao
          ? '<div class="meta"><div><span>Identidade confirmada por</span><b>' +
            AP_DOC_esc_(d.metodoAutenticacao) + '</b></div>' +
            '<div><span>Data e hora</span><b>' + AP_DOC_esc_(d.confirmadoEm || '') + '</b></div>' +
            '</div>'
          : '') +

        '<div class="assinaturas">' +
        '<div>' + AP_DOC_esc_(d.colaborador || '') + '<br>Colaborador</div>' +
        '<div>' + AP_DOC_esc_(d.entregador || '') + '<br>Responsável pela entrega</div>' +
        '</div>';
    }
  },

  /* ---------- POSICIONAMENTO DE ESTOQUE ---------- */
  estoque: {
    versao: '1.0',
    titulo: 'Posicionamento de Estoque',
    montar: function (d) {
      var itens = d.itens || [];
      var valorTotal = itens.reduce(function (s, i) {
        return s + (Number(i.estoque) || 0) * (Number(i.valorUnitario) || 0);
      }, 0);

      return '<table><thead><tr>' +
        '<th>SKU</th><th>Descrição</th><th>Categoria</th><th>Un.</th>' +
        '<th class="num">Estoque</th><th class="num">Reservado</th>' +
        '<th class="num">Disponível</th><th class="num">Valor total</th>' +
        '</tr></thead><tbody>' +
        itens.map(function (i) {
          var est = Number(i.estoque) || 0;
          var res = Number(i.reservado) || 0;
          return '<tr>' +
            '<td>' + AP_DOC_esc_(i.sku) + '</td>' +
            '<td>' + AP_DOC_esc_(i.descricao) + '</td>' +
            '<td>' + AP_DOC_esc_(i.categoria || '') + '</td>' +
            '<td>' + AP_DOC_esc_(i.unidade || '') + '</td>' +
            '<td class="num">' + est + '</td>' +
            '<td class="num">' + res + '</td>' +
            '<td class="num">' + Math.max(0, est - res) + '</td>' +
            '<td class="num">' + AP_DOC_moeda_(est * (Number(i.valorUnitario) || 0)) + '</td>' +
            '</tr>';
        }).join('') +
        '</tbody></table>' +

        '<div class="totais">' +
        '<div><span>Itens listados</span><b>' + itens.length + '</b></div>' +
        '<div class="destaque"><span>Valor total em estoque</span><b>' +
        AP_DOC_moeda_(valorTotal) + '</b></div></div>';
    }
  },

  /* ---------- APROVAÇÕES VIA LINK ---------- */
  aprovacoes: {
    versao: '1.0',
    titulo: 'Relatório de Aprovações',
    montar: function (d) {
      var linhas = d.linhas || [];
      var conta = function (st) {
        return linhas.filter(function (l) { return l.status === st; }).length;
      };

      return '<div class="totais">' +
        '<div><span>Links gerados</span><b>' + linhas.length + '</b></div>' +
        '<div><span>Aprovadas</span><b>' + conta('APROVADA') + '</b></div>' +
        '<div><span>Reprovadas</span><b>' + conta('REPROVADA') + '</b></div>' +
        '<div><span>Pendentes</span><b>' + conta('PENDENTE') + '</b></div>' +
        '</div>' +

        '<table><thead><tr>' +
        '<th>Solicitação</th><th>Obra</th><th>Solicitante</th>' +
        '<th class="num">Valor</th><th>Aprovador</th><th>Decisão</th><th>Quando</th>' +
        '</tr></thead><tbody>' +
        linhas.map(function (l) {
          var selo = l.status === 'APROVADA' ? 'ok' : (l.status === 'REPROVADA' ? 'nao' : 'aguarda');
          return '<tr>' +
            '<td>' + AP_DOC_esc_(l.registro) + '</td>' +
            '<td>' + AP_DOC_esc_(l.obra || '') + '</td>' +
            '<td>' + AP_DOC_esc_(l.solicitante || '') + '</td>' +
            '<td class="num">' + AP_DOC_moeda_(l.valor) + '</td>' +
            '<td>' + AP_DOC_esc_(l.decididoPor || '—') + '</td>' +
            '<td><span class="selo ' + selo + '">' + AP_DOC_esc_(l.status) + '</span></td>' +
            '<td>' + AP_DOC_esc_(l.decidiuEm || '—') + '</td>' +
            '</tr>';
        }).join('') +
        '</tbody></table>';
    }
  }
};

/* ============================================================
   GERAÇÃO DO PDF
   ============================================================ */

function AP_DOC_pasta_() {
  var pastas = DriveApp.getFoldersByName(AP_DOC_CFG.pastaDrive);
  if (pastas.hasNext()) return pastas.next();
  return DriveApp.createFolder(AP_DOC_CFG.pastaDrive);
}

/**
 * Gera o PDF e CONFERE que ele existe e é válido.
 *
 * A conferência dos primeiros bytes é o que separa "a função não
 * deu erro" de "o arquivo é um PDF". Todo PDF começa com %PDF.
 */
function AP_DOC_gerar(tipo, dados, sessao) {
  var t0 = new Date().getTime();
  var quem = (sessao && sessao.usuario) || 'sistema';

  var template = AP_DOC_TEMPLATES[tipo];
  if (!template) {
    return {
      ok: false, codigo: 'TEMPLATE_DESCONHECIDO',
      mensagem: 'Não existe modelo para "' + tipo + '". Modelos: ' +
        Object.keys(AP_DOC_TEMPLATES).join(', ')
    };
  }

  /* mesma operação duas vezes não gera dois documentos */
  if (dados.operacaoId) {
    var jaFeito = AP_Data_rows(AP_DOC_aba_()).filter(function (d) {
      return d.operacaoId === dados.operacaoId && d.status === 'GERADO';
    })[0];

    if (jaFeito) {
      return {
        ok: true, dados: jaFeito, jaExistia: true,
        mensagem: 'Este documento já havia sido gerado.'
      };
    }
  }

  var registro = {
    id: AP_Utils_generateId('DOC'),
    tipo: tipo,
    template: tipo,
    versaoTemplate: template.versao,
    modulo: dados.modulo || tipo,
    registro: dados.registro || '',
    titulo: dados.titulo || template.titulo,
    usuario: quem,
    obra: dados.obra || '',
    criadoEm: AP_Utils_now(),
    operacaoId: dados.operacaoId || ''
  };

  try {
    var moldura = AP_DOC_moldura_({
      titulo: registro.titulo,
      numero: dados.registro,
      obra: dados.obra,
      periodo: dados.periodo,
      responsavel: dados.responsavel || quem,
      documentoId: registro.id
    });

    var html = '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      AP_DOC_estilo_() + '</head><body>' +
      moldura.topo +
      template.montar(dados) +
      moldura.rodape +
      '</body></html>';

    /* HTML → PDF de verdade */
    var blob = Utilities.newBlob(html, 'text/html', registro.id + '.html')
      .getAs('application/pdf')
      .setName(AP_DOC_nomeArquivo_(tipo, dados));

    var arquivo = AP_DOC_pasta_().createFile(blob);

    registro.arquivo = arquivo.getName();
    registro.arquivoId = arquivo.getId();

    /* CONFERE — é aqui que "gerado" deixa de ser suposição */
    var lido;
    try {
      lido = DriveApp.getFileById(arquivo.getId()).getBlob();
    } catch (e) {
      registro.status = 'FALHOU';
      registro.erro = 'O arquivo foi criado mas não pôde ser lido: ' + e.message;
      AP_DOC_registrar_(registro);
      return { ok: false, codigo: 'NAO_VALIDADO', mensagem: registro.erro, dados: registro };
    }

    var bytes = lido.getBytes();
    registro.tamanhoBytes = bytes.length;

    if (bytes.length < 500) {
      registro.status = 'FALHOU';
      registro.erro = 'O arquivo saiu com apenas ' + bytes.length +
        ' bytes — pequeno demais para ser um PDF com conteúdo.';
      AP_DOC_registrar_(registro);
      return { ok: false, codigo: 'PDF_VAZIO', mensagem: registro.erro, dados: registro };
    }

    /* todo PDF começa com %PDF */
    var assinatura = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (assinatura !== '%PDF') {
      registro.status = 'FALHOU';
      registro.erro = 'O arquivo gerado não é um PDF (começa com "' + assinatura + '").';
      AP_DOC_registrar_(registro);
      return { ok: false, codigo: 'NAO_E_PDF', mensagem: registro.erro, dados: registro };
    }

    registro.hash = AP_DOC_hash_(bytes);
    registro.paginas = AP_DOC_contarPaginas_(bytes);
    registro.status = 'GERADO';
    registro.erro = '';

    AP_DOC_registrar_(registro);

    AP_Audit_log(quem, 'DOCUMENTO_GERADO', 'DOCUMENTOS', registro.id, {
      tipo: tipo, registro: dados.registro || '', bytes: registro.tamanhoBytes
    });

    return {
      ok: true,
      dados: Object.assign({}, registro, {
        url: 'https://drive.google.com/file/d/' + registro.arquivoId + '/view',
        duracaoMs: new Date().getTime() - t0
      }),
      validado: true
    };

  } catch (e) {
    registro.status = 'FALHOU';
    registro.erro = e.message;
    try { AP_DOC_registrar_(registro); } catch (e2) { }
    AP_ErrorHandler_capture('AP_DOC_gerar:' + tipo, e);
    return { ok: false, codigo: 'FALHA_GERACAO', mensagem: e.message, dados: registro };
  }
}

function AP_DOC_nomeArquivo_(tipo, dados) {
  var agora = new Date();
  var data = agora.getFullYear() + '-' +
    String(agora.getMonth() + 1).padStart(2, '0') + '-' +
    String(agora.getDate()).padStart(2, '0');
  var ref = String(dados.registro || '').replace(/[^\w\-]/g, '');
  return 'almoxa-' + tipo + (ref ? '-' + ref : '') + '-' + data + '.pdf';
}

function AP_DOC_hash_(bytes) {
  try {
    var d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
    return d.map(function (b) {
      var v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? '0' + v : v;
    }).join('');
  } catch (e) {
    return null;
  }
}

/** Conta as páginas procurando as marcas /Type /Page no arquivo */
function AP_DOC_contarPaginas_(bytes) {
  try {
    var texto = '';
    var limite = Math.min(bytes.length, 300000);
    for (var i = 0; i < limite; i++) {
      var b = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
      if (b >= 32 && b < 127) texto += String.fromCharCode(b);
    }
    var achados = texto.match(/\/Type\s*\/Page[^s]/g);
    return achados ? achados.length : 1;
  } catch (e) {
    return null;
  }
}

function AP_DOC_registrar_(registro) {
  AP_Data_append(AP_DOC_aba_(), registro);
}

/** Confere se um documento gerado continua íntegro */
function AP_DOC_verificar(id) {
  var doc = AP_Data_rows(AP_DOC_aba_()).filter(function (d) { return d.id === id; })[0];
  if (!doc) return { ok: false, codigo: 'NAO_ENCONTRADO', mensagem: 'Documento não está no registro.' };
  if (!doc.arquivoId) return { ok: false, codigo: 'SEM_ARQUIVO', mensagem: 'Não há arquivo ligado a este documento.' };

  try {
    var bytes = DriveApp.getFileById(doc.arquivoId).getBlob().getBytes();

    if (String(bytes.length) !== String(doc.tamanhoBytes)) {
      return {
        ok: false, codigo: 'TAMANHO_DIFERENTE',
        mensagem: 'O arquivo tem ' + bytes.length + ' bytes; deveria ter ' + doc.tamanhoBytes + '.'
      };
    }

    var hash = AP_DOC_hash_(bytes);
    if (doc.hash && hash !== doc.hash) {
      return {
        ok: false, codigo: 'INTEGRIDADE_COMPROMETIDA',
        mensagem: 'O documento foi alterado depois de gerado.'
      };
    }

    return {
      ok: true,
      dados: {
        id: doc.id, arquivo: doc.arquivo, tamanhoBytes: bytes.length,
        paginas: doc.paginas, criadoEm: doc.criadoEm, integridade: 'CONFIRMADA'
      }
    };
  } catch (e) {
    return { ok: false, codigo: 'FALHA_LEITURA', mensagem: 'Não foi possível ler o arquivo: ' + e.message };
  }
}

/* ============================================================
   LINK DE APROVAÇÃO
   ============================================================ */

/** Token aleatório — nunca o número da solicitação */
function AP_DOC_token_() {
  var alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  var token = '';
  try {
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
      String(new Date().getTime()) + Math.random() + Math.random());
    for (var i = 0; i < 32; i++) {
      var b = bytes[i % bytes.length];
      token += alfabeto[Math.abs(b) % alfabeto.length];
    }
  } catch (e) {
    for (var j = 0; j < 32; j++) {
      token += alfabeto[Math.floor(Math.random() * alfabeto.length)];
    }
  }
  return token;
}

function AP_DOC_criarLink(dados, sessao) {
  var quem = (sessao && sessao.usuario) || 'sistema';

  if (!dados.registro) {
    return { ok: false, codigo: 'SEM_REGISTRO', mensagem: 'Informe qual solicitação será aprovada.' };
  }

  var expira = new Date();
  expira.setHours(expira.getHours() + (Number(dados.validadeHoras) || AP_DOC_CFG.validadeHoras));

  var link = {
    token: AP_DOC_token_(),
    documento: dados.documento || '',
    modulo: dados.modulo || 'reservas',
    registro: dados.registro,
    criadoEm: AP_Utils_now(),
    criadoPor: quem,
    expiraEm: expira.toISOString(),
    status: 'PENDENTE',
    decisao: '', decidiuEm: '', decididoPor: '', motivo: '',
    ip: '', usos: 0, ultimoAcesso: ''
  };

  AP_Data_append(AP_DOC_abaLinks_(), link);

  AP_Audit_log(quem, 'LINK_APROVACAO_CRIADO', 'DOCUMENTOS', dados.registro, {
    token: link.token.slice(0, 8) + '…', expiraEm: link.expiraEm
  });

  var base = '';
  try { base = ScriptApp.getService().getUrl(); } catch (e) { base = ''; }

  return {
    ok: true,
    dados: {
      token: link.token,
      url: base ? base + '?aprovar=' + link.token : '?aprovar=' + link.token,
      expiraEm: link.expiraEm,
      validadeHoras: Number(dados.validadeHoras) || AP_DOC_CFG.validadeHoras
    }
  };
}

/**
 * Abre o link: valida o token e devolve o que a página precisa.
 *
 * Nunca confia no que vem do navegador. O status vem do banco.
 */
function AP_DOC_abrirLink(token) {
  if (!token) return { ok: false, codigo: 'SEM_TOKEN', mensagem: 'Link inválido.' };

  var link = AP_Data_rows(AP_DOC_abaLinks_()).filter(function (l) {
    return l.token === token;
  })[0];

  if (!link) {
    return {
      ok: false, codigo: 'LINK_INVALIDO',
      mensagem: 'Este link não existe ou foi cancelado.'
    };
  }

  /* expirado antes de tudo, para a mensagem ser a verdadeira */
  if (link.status === 'EXPIRADO' ||
      (link.status === 'PENDENTE' && new Date(link.expiraEm) < new Date())) {
    AP_Data_update(AP_DOC_abaLinks_(), token, { status: 'EXPIRADO' }, 'token');
    return {
      ok: false, codigo: 'LINK_EXPIRADO',
      mensagem: 'Este link expirou. Peça um novo ao solicitante.'
    };
  }

  /* já decidido: mostra a decisão, não os botões */
  if (link.status !== 'PENDENTE') {
    return {
      ok: true,
      dados: {
        situacao: 'JA_DECIDIDO',
        decisao: link.status,
        decidiuEm: link.decidiuEm,
        decididoPor: link.decididoPor,
        motivo: link.motivo,
        registro: link.registro,
        mensagem: 'Esta solicitação já foi ' +
          (link.status === 'APROVADA' ? 'aprovada' : 'reprovada') +
          ' em ' + link.decidiuEm + '.'
      }
    };
  }

  /* registra o acesso */
  AP_Data_update(AP_DOC_abaLinks_(), token, {
    usos: (Number(link.usos) || 0) + 1,
    ultimoAcesso: AP_Utils_now()
  }, 'token');

  /* busca a solicitação de verdade */
  var solicitacao = null;
  try {
    var r = AP_Modulo_reservas('obter', { protocolo: link.registro },
      { perfil: 'ADMINISTRADOR', usuario: 'link' });
    if (r && r.ok) solicitacao = r.dados;
  } catch (e) { }

  var documento = null;
  if (link.documento) {
    documento = AP_Data_rows(AP_DOC_aba_()).filter(function (d) {
      return d.id === link.documento;
    })[0] || null;
  }

  return {
    ok: true,
    dados: {
      situacao: 'PENDENTE',
      registro: link.registro,
      modulo: link.modulo,
      expiraEm: link.expiraEm,
      solicitacao: solicitacao,
      documento: documento ? {
        id: documento.id,
        arquivo: documento.arquivo,
        url: 'https://drive.google.com/file/d/' + documento.arquivoId + '/preview',
        paginas: documento.paginas
      } : null
    }
  };
}

/**
 * Registra a decisão.
 *
 * A página não decide nada: ela manda a intenção e o Core valida
 * o token, o estado e a validade antes de gravar.
 */
function AP_DOC_decidir(token, decisao, dados) {
  dados = dados || {};

  if (['APROVADA', 'REPROVADA'].indexOf(decisao) === -1) {
    return { ok: false, codigo: 'DECISAO_INVALIDA', mensagem: 'Decisão desconhecida.' };
  }

  var link = AP_Data_rows(AP_DOC_abaLinks_()).filter(function (l) {
    return l.token === token;
  })[0];

  if (!link) return { ok: false, codigo: 'LINK_INVALIDO', mensagem: 'Link inválido.' };

  /* expirado vem ANTES de "já decidido": senão um link vencido
     respondia "já foi reprovada", o que não é verdade e confunde
     quem está tentando decidir */
  if (link.status === 'EXPIRADO' || new Date(link.expiraEm) < new Date()) {
    AP_Data_update(AP_DOC_abaLinks_(), token, { status: 'EXPIRADO' }, 'token');
    return {
      ok: false, codigo: 'LINK_EXPIRADO',
      mensagem: 'Este link expirou. Peça um novo ao solicitante.'
    };
  }

  /* já decidido: não sobrescreve */
  if (link.status !== 'PENDENTE') {
    return {
      ok: false, codigo: 'JA_DECIDIDO',
      mensagem: 'Esta solicitação já foi ' +
        (link.status === 'APROVADA' ? 'aprovada' : 'reprovada') + ' em ' + link.decidiuEm + '.',
      dados: { decisao: link.status, decidiuEm: link.decidiuEm }
    };
  }

  if (decisao === 'REPROVADA' && !dados.motivo) {
    return {
      ok: false, codigo: 'MOTIVO_OBRIGATORIO',
      mensagem: 'Informe o motivo da reprovação — é o que explica a decisão depois.'
    };
  }

  var quem = dados.quem || 'aprovador externo';
  var agora = AP_Utils_now();

  /* a decisão vai para o fluxo oficial */
  var noCore = null;
  try {
    noCore = AP_Modulo_reservas('decidir', {
      protocolo: link.registro,
      decisao: decisao === 'APROVADA' ? 'aprovar' : 'reprovar',
      motivo: dados.motivo || '',
      origem: 'LINK_EXTERNO'
    }, { perfil: 'GESTOR', usuario: quem });
  } catch (e) {
    noCore = { ok: false, mensagem: e.message };
  }

  if (noCore && !noCore.ok) {
    return {
      ok: false, codigo: 'CORE_RECUSOU',
      mensagem: 'A decisão não pôde ser registrada: ' + (noCore.mensagem || '') +
        ' O link continua válido.',
      dados: noCore
    };
  }

  AP_Data_update(AP_DOC_abaLinks_(), token, {
    status: decisao,
    decisao: decisao,
    decidiuEm: agora,
    decididoPor: quem,
    motivo: dados.motivo || ''
  }, 'token');

  AP_Audit_log(quem, 'APROVACAO_POR_LINK', 'DOCUMENTOS', link.registro, {
    decisao: decisao, token: token.slice(0, 8) + '…', motivo: dados.motivo || ''
  });

  return {
    ok: true,
    dados: {
      decisao: decisao, registro: link.registro,
      decidiuEm: agora, decididoPor: quem
    }
  };
}

/* ============================================================
   MÓDULO
   ============================================================ */

function AP_Modulo_documentos(acao, payload, sessao) {
  payload = payload || {};

  try {
    switch (acao) {

      case 'gerar':
        if (!payload.tipo) return { ok: false, codigo: 'SEM_TIPO', mensagem: 'Informe o tipo de documento.' };
        return AP_DOC_gerar(payload.tipo, payload.dados || payload, sessao);

      case 'verificar':
        if (!payload.id) return { ok: false, codigo: 'SEM_ID', mensagem: 'Informe o documento.' };
        return AP_DOC_verificar(payload.id);

      case 'listar': {
        var todos = (AP_Data_rows(AP_DOC_aba_()) || []).slice().reverse();
        if (payload.tipo) todos = todos.filter(function (d) { return d.tipo === payload.tipo; });
        if (payload.registro) todos = todos.filter(function (d) { return d.registro === payload.registro; });
        return { ok: true, dados: todos.slice(0, Number(payload.limite) || 50) };
      }

      case 'criarLink':
        return AP_DOC_criarLink(payload, sessao);

      case 'abrirLink':
        return AP_DOC_abrirLink(payload.token);

      case 'decidir':
        return AP_DOC_decidir(payload.token, payload.decisao, payload);

      case 'links': {
        var links = (AP_Data_rows(AP_DOC_abaLinks_()) || []).slice().reverse();
        return {
          ok: true,
          dados: links.map(function (l) {
            /* o token nunca sai inteiro numa listagem */
            return Object.assign({}, l, { token: String(l.token).slice(0, 8) + '…' });
          })
        };
      }

      case 'modelos':
        return {
          ok: true,
          dados: Object.keys(AP_DOC_TEMPLATES).map(function (k) {
            return { tipo: k, titulo: AP_DOC_TEMPLATES[k].titulo, versao: AP_DOC_TEMPLATES[k].versao };
          })
        };

      default:
        return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'documentos.' + acao + ' não existe.' };
    }
  } catch (e) {
    AP_ErrorHandler_capture('AP_Modulo_documentos:' + acao, e);
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'documentos', acao: acao, mensagem: e.message };
  }
}

/* ============================================================
   PARA RODAR NO EDITOR
   ============================================================ */

/**
 * Gera um PDF e um link de aprovação de uma solicitação real.
 *
 * Rode isto, copie o link do registro e abra no celular.
 * Serve para conferir o fluxo inteiro antes de existir botão.
 */
function DOCUMENTO_gerarLinkDeTeste(protocolo) {
  var sessao = { usuario: 'editor', perfil: 'admin' };

  /* pega a solicitação mais recente, se não indicarem uma */
  var reserva = null;
  try {
    if (protocolo) {
      var r1 = AP_Modulo_reservas('obter', { protocolo: protocolo }, sessao);
      if (r1 && r1.ok) reserva = r1.dados;
    } else {
      var todas = AP_Modulo_reservas('listar', {}, sessao);
      if (todas && todas.ok && todas.dados.length) reserva = todas.dados[0];
    }
  } catch (e) { }

  if (!reserva) {
    var aviso = '\n  NENHUMA SOLICITAÇÃO ENCONTRADA\n' +
      '  Crie uma solicitação na loja primeiro, ou passe o protocolo:\n' +
      '  DOCUMENTO_gerarLinkDeTeste("#RES-000001")\n';
    try { Logger.log(aviso); } catch (e) { }
    return aviso;
  }

  /* 1. o PDF */
  var doc = AP_DOC_gerar('solicitacao', {
    registro: reserva.protocolo,
    obra: reserva.obra || '',
    solicitante: reserva.solicitante || '',
    itens: reserva.itens || [],
    observacao: reserva.observacao || ''
  }, sessao);

  if (!doc.ok) {
    var erro = '\n  O PDF NÃO FOI GERADO\n  ' + doc.mensagem + '\n';
    try { Logger.log(erro); } catch (e) { }
    return erro;
  }

  /* 2. o link */
  var link = AP_DOC_criarLink({
    registro: reserva.protocolo,
    documento: doc.dados.id,
    modulo: 'reservas'
  }, sessao);

  if (!link.ok) {
    var erro2 = '\n  O LINK NÃO FOI CRIADO\n  ' + link.mensagem + '\n';
    try { Logger.log(erro2); } catch (e) { }
    return erro2;
  }

  var texto = '\n' +
    '  PDF E LINK GERADOS\n' +
    '  ' + new Array(62).join('-') + '\n\n' +
    '  Solicitação:  ' + reserva.protocolo + '\n' +
    '  Itens:        ' + (reserva.itens || []).length + '\n' +
    '  PDF:          ' + doc.dados.arquivo + '\n' +
    '  Tamanho:      ' + Math.round(doc.dados.tamanhoBytes / 1024) + ' KB · ' +
      doc.dados.paginas + ' página(s)\n' +
    '  Ver o PDF:    ' + doc.dados.url + '\n\n' +
    '  LINK DE APROVAÇÃO — copie e abra no celular:\n\n' +
    '  ' + link.dados.url + '\n\n' +
    '  Válido por ' + link.dados.validadeHoras + ' horas.\n' +
    '  Quem abrir vê a solicitação e decide, sem entrar no sistema.\n';

  try { Logger.log(texto); } catch (e) { }
  return texto;
}

/* ============================================================
   TESTE
   ============================================================ */
function testeDocumentEngine() {
  var log = [];
  function reg(t, ok, d) { log.push((ok ? 'OK    ' : 'ERRO  ') + t + (d ? ' — ' + d : '')); }

  var sessao = { usuario: 'ismael', perfil: 'admin' };

  try {
    /* ---------- PDF DE VERDADE ---------- */
    var doc = AP_DOC_gerar('solicitacao', {
      registro: 'SC-2026-00125',
      obra: 'Residencial Real Parque',
      solicitante: 'João Pedreiro',
      itens: [
        { nome: 'JOELHO GALVANIZADO 90° 2"', sku: 'ALM-HID-000001', qtd: 24, preco: 12.5, unidade: 'un' },
        { nome: 'TUBO GALVANIZADO 2"', sku: 'ALM-HID-000002', qtd: 50, preco: 34, unidade: 'm' }
      ],
      observacao: 'Material para a frente de serviço do 3º pavimento.'
    }, sessao);

    reg('gera o PDF', doc.ok, doc.ok ? doc.dados.arquivo : doc.mensagem);
    reg('o arquivo tem tamanho real',
      doc.ok && doc.dados.tamanhoBytes > 500,
      doc.ok ? Math.round(doc.dados.tamanhoBytes / 1024) + ' KB' : '');
    reg('É MESMO UM PDF (começa com %PDF)',
      doc.ok && doc.dados.status === 'GERADO', 'conferido byte a byte');
    reg('gera hash do arquivo', doc.ok && (doc.dados.hash || '').length === 64,
      doc.ok && doc.dados.hash ? doc.dados.hash.slice(0, 12) + '…' : 'sem hash');
    reg('conta as páginas', doc.ok && doc.dados.paginas >= 1,
      doc.ok ? doc.dados.paginas + ' página(s)' : '');
    reg('devolve link para abrir', doc.ok && /drive\.google\.com/.test(doc.dados.url || ''), '');

    /* ---------- NÃO DUPLICA ---------- */
    var mesmo = AP_DOC_gerar('solicitacao', {
      registro: 'SC-2026-00125', operacaoId: 'OP-TESTE-1', itens: [{ nome: 'X', qtd: 1, preco: 1 }]
    }, sessao);
    var denovo = AP_DOC_gerar('solicitacao', {
      registro: 'SC-2026-00125', operacaoId: 'OP-TESTE-1', itens: [{ nome: 'X', qtd: 1, preco: 1 }]
    }, sessao);
    reg('a mesma operação não gera dois documentos',
      denovo.ok && denovo.jaExistia === true && denovo.dados.id === mesmo.dados.id, '');

    /* ---------- OUTROS MODELOS ---------- */
    var ficha = AP_DOC_gerar('fichaEpi', {
      registro: 'EPI-000045', colaborador: 'Maria Souza', matricula: '0002', cargo: 'Eletricista',
      itens: [{ nome: 'Capacete classe B', ca: '31469', qtd: 1, validade: '10/2027' }],
      metodoAutenticacao: 'Senha do sistema', confirmadoEm: '08/09/2026 14:20'
    }, sessao);
    reg('gera a ficha de EPI', ficha.ok && ficha.dados.status === 'GERADO',
      ficha.ok ? Math.round(ficha.dados.tamanhoBytes / 1024) + ' KB' : ficha.mensagem);

    var est = AP_DOC_gerar('estoque', {
      titulo: 'Posicionamento de Estoque', periodo: 'Setembro/2026',
      itens: [{ sku: 'A1', descricao: 'Item A', estoque: 100, reservado: 20, valorUnitario: 5, unidade: 'un' }]
    }, sessao);
    reg('gera o relatório de estoque', est.ok, est.ok ? est.dados.arquivo : est.mensagem);

    var inexistente = AP_DOC_gerar('modelo-que-nao-existe', {}, sessao);
    reg('recusa modelo desconhecido',
      inexistente.ok === false && inexistente.codigo === 'TEMPLATE_DESCONHECIDO', '');

    /* ---------- VERIFICAÇÃO POSTERIOR ---------- */
    var ver = AP_DOC_verificar(doc.dados.id);
    reg('confere o documento depois', ver.ok && ver.dados.integridade === 'CONFIRMADA', '');

    var verFalso = AP_DOC_verificar('DOC-NAO-EXISTE');
    reg('avisa documento inexistente', verFalso.ok === false, verFalso.codigo);

    /* ---------- LINK DE APROVAÇÃO ---------- */
    var link = AP_DOC_criarLink({
      registro: 'SC-2026-00125', documento: doc.dados.id, modulo: 'reservas'
    }, sessao);
    reg('cria o link', link.ok, link.ok ? link.dados.token.slice(0, 10) + '…' : link.mensagem);
    reg('o token é longo e imprevisível',
      link.ok && link.dados.token.length === 32 && !/SC-2026/.test(link.dados.token),
      '32 caracteres, sem o número da solicitação');
    reg('o link tem validade', link.ok && !!link.dados.expiraEm,
      link.ok ? link.dados.validadeHoras + 'h' : '');

    /* ---------- ABRIR O LINK ---------- */
    var aberto = AP_DOC_abrirLink(link.dados.token);
    reg('abre o link', aberto.ok && aberto.dados.situacao === 'PENDENTE', '');
    reg('o link traz o documento certo',
      aberto.ok && aberto.dados.documento && aberto.dados.documento.id === doc.dados.id,
      'mesmo processo, mesmo PDF');

    var tokenFalso = AP_DOC_abrirLink('umtokenqualquerinventado123456789');
    reg('token inventado é recusado',
      tokenFalso.ok === false && tokenFalso.codigo === 'LINK_INVALIDO', '');

    var semToken = AP_DOC_abrirLink('');
    reg('sem token é recusado', semToken.ok === false, semToken.codigo);

    /* ---------- DECIDIR ---------- */
    var semMotivo = AP_DOC_decidir(link.dados.token, 'REPROVADA', {});
    reg('reprovar exige motivo',
      semMotivo.ok === false && semMotivo.codigo === 'MOTIVO_OBRIGATORIO', '');

    var decisaoInvalida = AP_DOC_decidir(link.dados.token, 'TALVEZ', {});
    reg('decisão desconhecida é recusada', decisaoInvalida.ok === false, decisaoInvalida.codigo);

    /* ---------- LINK EXPIRADO ---------- */
    var linkVelho = AP_DOC_criarLink({ registro: 'SC-VELHA', validadeHoras: 1 }, sessao);
    AP_Data_update(AP_DOC_abaLinks_(), linkVelho.dados.token,
      { expiraEm: new Date(Date.now() - 86400000).toISOString() }, 'token');

    var expirado = AP_DOC_abrirLink(linkVelho.dados.token);
    reg('LINK EXPIRADO é bloqueado',
      expirado.ok === false && expirado.codigo === 'LINK_EXPIRADO',
      expirado.mensagem.slice(0, 45));

    var decidirExpirado = AP_DOC_decidir(linkVelho.dados.token, 'APROVADA', {});
    reg('e não aceita decisão depois de expirar',
      decidirExpirado.ok === false && decidirExpirado.codigo === 'LINK_EXPIRADO',
      'a mensagem diz expirado, não "já decidido"');

    /* ---------- JÁ DECIDIDO ---------- */
    var linkDecidido = AP_DOC_criarLink({ registro: 'SC-DECIDIDA' }, sessao);
    AP_Data_update(AP_DOC_abaLinks_(), linkDecidido.dados.token, {
      status: 'APROVADA', decisao: 'APROVADA',
      decidiuEm: '08/09/2026 14:32', decididoPor: 'Gestor'
    }, 'token');

    var jaDecidido = AP_DOC_abrirLink(linkDecidido.dados.token);
    reg('link já decidido mostra a decisão',
      jaDecidido.ok && jaDecidido.dados.situacao === 'JA_DECIDIDO' &&
      jaDecidido.dados.decisao === 'APROVADA',
      jaDecidido.dados.mensagem);

    var segundaDecisao = AP_DOC_decidir(linkDecidido.dados.token, 'REPROVADA', { motivo: 'mudei de ideia' });
    reg('NÃO PERMITE decidir duas vezes',
      segundaDecisao.ok === false && segundaDecisao.codigo === 'JA_DECIDIDO',
      segundaDecisao.mensagem.slice(0, 50));

    /* ---------- O TOKEN NÃO VAZA ---------- */
    var lista = AP_Modulo_documentos('links', {}, sessao);
    reg('a listagem não expõe o token inteiro',
      lista.ok && lista.dados.every(function (l) { return String(l.token).indexOf('…') > -1; }),
      'só os primeiros caracteres');

  } catch (e) {
    log.push('ERRO  exceção: ' + e.message);
  }

  try { Logger.log(log.join('\n')); } catch (e) { }
  return log;
}
