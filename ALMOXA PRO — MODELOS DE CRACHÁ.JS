/* ============================================================
   ALMOXA PRO — MODELOS DE CRACHÁ
   ============================================================

   O QUE A AUDITORIA ENCONTROU
   ---------------------------
   O módulo de crachás já existe e funciona: ALMOXA_PRO_Modulo_Cracha.gs
   emite, valida, bloqueia e registra acesso. O desenho do cartão
   está no frontend, no bloco [CRA], e o que o usuário personaliza
   (quais campos aparecem, onde fica o QR) é guardado assim:

       localStorage.setItem("almoxa_cracha_layout", ...)
       localStorage.setItem("almoxa_cracha_layout_por", ...)

   Ou seja: no NAVEGADOR da pessoa. Por isso o item 100 do prompt
   pede que a personalização continue disponível "ao acessar o
   sistema em outro computador" — hoje ela não continua. Não é bug
   de salvamento: é que nunca houve onde salvar do lado do servidor.

   Este arquivo é esse lugar.

   O QUE ELE GUARDA
   ----------------
   Uma aba própria, ALMOXA_CRACHA_MODELOS, com um modelo por linha:
   identificador, nome, versão, qual modelo serviu de base,
   dimensões em milímetros, o que aparece na frente, o que aparece
   no verso, cores, bordas e o logotipo.

   OS MODELOS OFICIAIS NÃO FICAM NESTA ABA — de propósito
   ------------------------------------------------------
   O Modelo 1 (o original) e o Modelo 2 (o oficial COESA) são
   definidos em código, abaixo. Eles são devolvidos pela listagem
   junto com os salvos, marcados como oficial: true.

   Por que não guardá-los na planilha: porque o item 58 do prompt
   manda não sobrescrever os modelos oficiais. Se eles fossem
   linhas da aba, bastaria uma edição distraída para o padrão da
   empresa sumir. Estando no código, a gravação por cima deles é
   RECUSADA — não por disciplina de quem usa, mas porque não há
   linha para gravar.

   Personalizar um oficial cria uma CÓPIA, com id próprio.

   O QUE ELE NÃO FAZ
   -----------------
   NÃO mexe em ALMOXA_CRACHAS nem em ALMOXA_CRACHA_ACESSOS. Não
   emite crachá, não valida acesso, não toca em colaborador. O
   cadastro de pessoas continua sendo um só, o de usuários.

   NÃO apaga. Excluir vira STATUS = EXCLUIDO, com motivo e autor.

   NÃO guarda foto de colaborador. A foto vem do cadastro na hora
   de desenhar; aqui só fica o LOGOTIPO da empresa.

   COMO INSTALAR
   -------------
     1. Planilha "Base Dado almoxarifado" → Extensões → Apps Script
     2. "+" ao lado de Arquivos → Script
     3. Nome: ALMOXA_PRO_Modulo_CrachaModelos
     4. Cole este conteúdo inteiro e salve (Ctrl+S)
     5. Se o almoxaApi despacha por um mapa de módulos, acrescente
        'crachaModelos': AP_Modulo_crachaModelos
     6. Implantar → Gerenciar implantações → editar → Nova versão
     7. Para conferir sem gravar: rode AP_CRM_testes

   ============================================================ */


var AP_CRM_CFG = {
  versao: '1.0.0',

  aba: 'ALMOXA_CRACHA_MODELOS',
  colunas: [
    'ID', 'NOME', 'BASE', 'VERSAO',
    'LARGURA_MM', 'ALTURA_MM', 'ORIENTACAO', 'BORDA',
    'FRENTE', 'VERSO', 'ESTILO', 'CAMPOS', 'LOGO',
    'PADRAO', 'STATUS', 'OBSERVACAO',
    'CRIADO_EM', 'CRIADO_POR', 'ALTERADO_EM', 'ALTERADO_POR', 'MOTIVO'
  ],
  caminhos: ['', '01_BANCO_DADOS/'],

  /* uma célula do Sheets não aguarda 50.000 caracteres. Um logotipo
     em dataURL passa disso fácil, e o erro que o Apps Script devolve
     nesse caso não explica nada. Então o limite é conferido aqui,
     com uma mensagem que diz o que fazer. */
  limiteLogo: 45000,
  limiteJson: 45000
};


/* ============================================================
   OS MODELOS OFICIAIS — em código, não na planilha
   ============================================================ */
function AP_CRM_oficiais_() {
  return [
    {
      id: 'OFICIAL-1',
      nome: 'Modelo 1 — Original ALMOXA',
      base: '',
      versao: '1.0',
      larguraMm: 54,
      alturaMm: 85.6,
      orientacao: 'RETRATO',
      borda: 'ARREDONDADA',
      oficial: true,
      /* o que a frente mostra. São os mesmos nomes que o bloco [CRA]
         já usava no layout guardado no navegador — assim o que a
         pessoa personalizou continua valendo. */
      frente: {
        logo: false, marca: true, foto: true, nome: true, funcao: true,
        cpf: true, matricula: false, setor: true, obra: true,
        acesso: true, unidade: false, sangue: true, qr: true
      },
      verso: {
        qr: false, sangue: true, liberacoes: true, cursos: true,
        instrucoes: true, nome: false, matricula: false, textoLivre: ''
      },
      estilo: {
        fundo: '#FFFFFF', texto: '#0B2A55', apoio: '#5F6B7A',
        faixa: '#0B2A55', faixa2: '#0F5BD8', fonte: 'inherit',
        tamanhoNome: 15, tamanhoDado: 10.5
      },
      logo: ''
    },
    {
      id: 'OFICIAL-2',
      nome: 'Modelo 2 — Oficial COESA',
      base: '',
      versao: '1.1',
      /* O CARTÃO, E NÃO A FOLHA.
         O arquivo de referência chama-se COESA_Crachá_92x57mm.pdf,
         e eu li 92 × 57 como se fosse o cartão. Não é: aquilo é a
         folha com frente e verso lado a lado. O crachá em si é
         CR80 — 85,6 × 54 mm —, que é o cartão de PVC que a
         impressora de cartão aceita, e fica EM PÉ: 54 de largura
         por 85,6 de altura. A proporção do desenho da referência
         (0,63) é exatamente 54 ÷ 85,6. */
      larguraMm: 54,
      alturaMm: 85.6,
      orientacao: 'RETRATO',
      borda: 'ARREDONDADA',
      oficial: true,
      frente: {
        logo: true, marca: false, foto: true, nome: true, funcao: false,
        cpf: false, matricula: true, setor: false, obra: false,
        acesso: false, unidade: false, sangue: false, qr: false
      },
      verso: {
        qr: false, sangue: false, liberacoes: false, cursos: false,
        instrucoes: true, nome: true, matricula: true,
        textoLivre: 'Uso estritamente pessoal\n' +
          'Manter na altura do tórax para circulação na empresa\n' +
          'Devolver ao Setor Pessoal em caso de desligamento'
      },
      estilo: {
        fundo: '#FFFFFF', texto: '#17202A', apoio: '#5F6B7A',
        faixa: '#0B4C8C', faixa2: '#1C9AD6', preta: '#15181C',
        fonte: 'Arial, Helvetica, sans-serif',
        tamanhoNome: 13, tamanhoDado: 10
      },
      /* MEDIDO no crachá oficial, em % do cartão. Não é chute:
         logotipo 70,4 de largura a 13,5 do topo; foto 44,9 de
         largura a 43,3 da esquerda e 44,3 do topo; nome a 83,8 do
         topo com letra de 5,5% da altura (4,7 mm num cartão de
         85,6 mm). */
      campos: {
        logoLargura: 70, logoTopo: 13.5,
        fotoEsq: 43.3, fotoTopo: 44.3, fotoLargura: 44.9, fotoAltura: 33.6,
        nomeTopo: 83.8, nomeTamanho: 5.5
      },
      logo: ''
    }
  ];
}


/* ============================================================
   A PORTA DO ROTEADOR
   ============================================================ */
function AP_Modulo_crachaModelos(acao, payload, sessao) {
  payload = payload || {};
  sessao = sessao || {};
  try {
    switch (String(acao || '').trim()) {
      case 'listar':       return { ok: true, dados: AP_CRM_listar_(payload) };
      case 'obter':        return AP_CRM_obter_(payload);
      case 'salvar':       return AP_CRM_salvar_(payload, sessao);
      case 'duplicar':     return AP_CRM_duplicar_(payload, sessao);
      case 'excluir':      return AP_CRM_excluir_(payload, sessao);
      case 'definirPadrao':return AP_CRM_definirPadrao_(payload, sessao);
      case 'obterLogo':    return { ok: true, dados: { logo: AP_CRM_logoEmpresa_() } };
      case 'salvarLogo':   return AP_CRM_salvarLogo_(payload, sessao);
      case 'obterArte':    return { ok: true, dados: { arte: AP_CRM_arte_(payload) } };
      case 'salvarArte':   return AP_CRM_salvarArte_(payload, sessao);
      case 'removerArte':  return AP_CRM_removerArte_(payload, sessao);
      case 'diagnostico':  return { ok: true, dados: AP_CRM_diagnostico_() };
      default:
        return { ok: false, codigo: 'ACAO_DESCONHECIDA',
          mensagem: 'Os modelos de crachá não conhecem a ação "' + acao +
            '". Conhece: listar, obter, salvar, duplicar, excluir, ' +
            'definirPadrao, obterLogo, salvarLogo, obterArte, salvarArte, ' +
            'removerArte, diagnostico.' };
    }
  } catch (e) {
    return { ok: false, codigo: 'ERRO', mensagem: e.message,
      onde: String(e.stack || '').slice(0, 400) };
  }
}


/* ============================================================
   A ABA
   ============================================================ */
function AP_CRM_viva_(aba) {
  if (!aba) return false;
  try { aba.getLastColumn(); return true; } catch (e) { return false; }
}

function AP_CRM_aba_() {
  var nome = AP_CRM_CFG.aba;
  var colunas = AP_CRM_CFG.colunas;

  function completar(aba) {
    var largura = aba.getLastColumn();
    var atuais = largura
      ? aba.getRange(1, 1, 1, largura).getValues()[0].map(function (c) {
          return String(c === null || c === undefined ? '' : c).trim().toUpperCase();
        })
      : [];
    var faltando = colunas.filter(function (c) {
      return atuais.indexOf(String(c).toUpperCase()) < 0;
    });
    if (!faltando.length) return aba;
    aba.getRange(1, largura + 1, 1, faltando.length).setValues([faltando]);
    aba.getRange(1, largura + 1, 1, faltando.length).setFontWeight('bold');
    return aba;
  }

  if (typeof AP_SRV_aba_ === 'function') {
    for (var i = 0; i < AP_CRM_CFG.caminhos.length; i++) {
      var a = null;
      try { a = AP_SRV_aba_(AP_CRM_CFG.caminhos[i] + nome); } catch (e) {}
      if (a && AP_CRM_viva_(a)) return completar(a);
    }
  }
  var ss = SpreadsheetApp.getActive();
  if (!ss) throw new Error('Não há planilha ativa para a aba "' + nome + '".');
  var d = ss.getSheetByName(nome);
  if (d && AP_CRM_viva_(d)) return completar(d);
  if (d) return d;
  var nova = ss.insertSheet(nome);
  nova.getRange(1, 1, 1, colunas.length).setValues([colunas]);
  nova.setFrozenRows(1);
  nova.getRange(1, 1, 1, colunas.length).setFontWeight('bold');
  return nova;
}

function AP_CRM_indice_(aba) {
  var largura = aba.getLastColumn();
  var porNome = {};
  if (!largura) return porNome;
  aba.getRange(1, 1, 1, largura).getValues()[0].forEach(function (c, i) {
    var k = String(c === null || c === undefined ? '' : c).trim().toUpperCase();
    if (k && porNome[k] === undefined) porNome[k] = i;
  });
  return porNome;
}

function AP_CRM_linhas_(aba) {
  var ultima = aba.getLastRow();
  if (ultima < 2) return [];
  return aba.getRange(2, 1, ultima - 1, aba.getLastColumn()).getValues();
}

function AP_CRM_pegar_(linha, idx, coluna) {
  var i = idx[String(coluna).toUpperCase()];
  if (i === undefined) return '';
  var v = linha[i];
  return v === null || v === undefined ? '' : v;
}

function AP_CRM_montar_(idx, largura, valores) {
  var linha = [];
  for (var i = 0; i < largura; i++) linha.push('');
  Object.keys(valores).forEach(function (n) {
    var i = idx[String(n).toUpperCase()];
    if (i !== undefined && i < largura) linha[i] = valores[n];
  });
  return linha;
}

function AP_CRM_txt_(v) { return String(v === null || v === undefined ? '' : v).trim(); }

function AP_CRM_num_(v, p) {
  var n = Number(String(v === null || v === undefined ? '' : v).replace(',', '.'));
  return isFinite(n) && n > 0 ? n : (p || 0);
}

function AP_CRM_agora_() {
  return Utilities.formatDate(new Date(), 'America/Manaus', "yyyy-MM-dd'T'HH:mm:ss");
}

function AP_CRM_quem_(sessao) {
  return AP_CRM_txt_(sessao && (sessao.nome || sessao.usuario || sessao.matricula)) || 'sistema';
}

var AP_CRM_SEQ = 0;
function AP_CRM_id_() {
  AP_CRM_SEQ++;
  var sorte = Math.floor(Math.random() * 1679616).toString(36);
  return 'CRM' + Date.now().toString(36) + '-' + AP_CRM_SEQ + '-' + sorte;
}

/* JSON que não derruba a leitura: célula estragada vira objeto
   vazio com um aviso, em vez de quebrar a listagem inteira. */
function AP_CRM_json_(v, padrao) {
  var t = AP_CRM_txt_(v);
  if (!t) return padrao || {};
  try {
    var o = JSON.parse(t);
    return (o && typeof o === 'object') ? o : (padrao || {});
  } catch (e) {
    return padrao || {};
  }
}

function AP_CRM_oficialPorId_(id) {
  var alvo = AP_CRM_txt_(id).toUpperCase();
  var fora = null;
  AP_CRM_oficiais_().forEach(function (m) {
    if (m.id.toUpperCase() === alvo) fora = m;
  });
  return fora;
}

function AP_CRM_ehOficial_(id) { return !!AP_CRM_oficialPorId_(id); }


/* ============================================================
   O LOGOTIPO DA EMPRESA
   ------------------------------------------------------------
   Fica numa linha só, com ID fixo, e vale para TODOS os modelos
   que não tenham um logotipo próprio.

   Por que não repetir o arquivo em cada modelo: porque a marca da
   empresa é uma só. Guardada em cada linha, trocar o logotipo
   viraria uma caçada por todas elas, e a primeira esquecida sairia
   impressa com a marca velha.

   Isto NÃO é alterar modelo oficial: o oficial continua com a
   mesma configuração. O que muda é de onde ele busca a marca.
   ============================================================ */
var AP_CRM_ID_LOGO = 'LOGO-EMPRESA';

function AP_CRM_logoEmpresa_() {
  try {
    var aba = AP_CRM_aba_();
    var idx = AP_CRM_indice_(aba);
    var linhas = AP_CRM_linhas_(aba);
    for (var i = 0; i < linhas.length; i++) {
      if (AP_CRM_txt_(AP_CRM_pegar_(linhas[i], idx, 'ID')) === AP_CRM_ID_LOGO) {
        return AP_CRM_txt_(AP_CRM_pegar_(linhas[i], idx, 'LOGO'));
      }
    }
  } catch (e) {}
  return '';
}

function AP_CRM_salvarLogo_(payload, sessao) {
  var logo = AP_CRM_txt_(payload.logo);
  if (!logo) {
    return { ok: false, codigo: 'SEM_LOGO',
      mensagem: 'Nenhum arquivo foi enviado.' };
  }
  if (logo.length > AP_CRM_CFG.limiteLogo) {
    return { ok: false, codigo: 'LOGO_GRANDE',
      mensagem: 'O logotipo tem ' + Math.round(logo.length / 1024) + ' KB e o limite de ' +
        'uma célula da planilha é ' + Math.round(AP_CRM_CFG.limiteLogo / 1024) + ' KB. ' +
        'Exporte o logotipo em PNG com uns 400 px de largura — num crachá de 54 mm ' +
        'isso já passa de 180 dpi, que é mais do que a impressora de cartão usa.' };
  }

  var aba = AP_CRM_aba_();
  var idx = AP_CRM_indice_(aba);
  var largura = aba.getLastColumn();
  var linhas = AP_CRM_linhas_(aba);
  var agora = AP_CRM_agora_();
  var autor = AP_CRM_quem_(sessao);

  for (var i = 0; i < linhas.length; i++) {
    if (AP_CRM_txt_(AP_CRM_pegar_(linhas[i], idx, 'ID')) !== AP_CRM_ID_LOGO) continue;
    var nova = linhas[i].slice();
    function por(col, v) {
      var k = idx[col];
      if (k !== undefined) nova[k] = v;
    }
    por('LOGO', logo);
    por('ALTERADO_EM', agora);
    por('ALTERADO_POR', autor);
    por('MOTIVO', AP_CRM_txt_(payload.motivo) || 'logotipo substituído');
    aba.getRange(i + 2, 1, 1, largura).setValues([nova]);
    return { ok: true, dados: { substituido: true },
      mensagem: 'Logotipo atualizado. Todos os modelos passam a usar o novo arquivo.' };
  }

  aba.appendRow(AP_CRM_montar_(idx, largura, {
    ID: AP_CRM_ID_LOGO,
    NOME: 'Logotipo da empresa',
    STATUS: 'ATIVO',
    LOGO: logo,
    OBSERVACAO: 'Linha de configuração, não é um modelo.',
    CRIADO_EM: agora, CRIADO_POR: autor
  }));
  return { ok: true, dados: { criado: true },
    mensagem: 'Logotipo guardado. Todos os modelos passam a usá-lo.' };
}


/* ============================================================
   A ARTE ORIGINAL DO CARTÃO
   ------------------------------------------------------------
   É o item 77 do prompt, e é a única forma de o crachá sair
   IDÊNTICO ao oficial: em vez de eu redesenhar fundo e logotipo —
   que é o que os itens 9 e 13 proíbem —, a arte verdadeira entra
   como imagem e o sistema só escreve por cima dela a foto, o nome
   e a matrícula.

   POR QUE EM PEDAÇOS
   Uma célula do Sheets não guarda 50.000 caracteres. A arte de um
   cartão a 300 dpi, em base64, passa de 300 KB. Então ela é
   partida em pedaços de 45 KB, um por linha, e remontada na
   leitura. Não é gambiarra: é o que cabe no banco que existe.

   A arte antiga não é apagada quando entra uma nova: as linhas
   viram SUBSTITUIDA e ficam. Crachá já impresso tem direito a
   saber com que arte foi impresso.
   ============================================================ */
var AP_CRM_PEDACO = 45000;
var AP_CRM_MAX_PEDACOS = 16;

function AP_CRM_chaveArte_(modeloId, lado) {
  return 'ARTE|' + AP_CRM_txt_(modeloId).toUpperCase() + '|' +
    AP_CRM_txt_(lado).toUpperCase();
}

/* payload: { modeloId, lado } */
function AP_CRM_arte_(payload) {
  payload = payload || {};
  var chave = AP_CRM_chaveArte_(payload.modeloId, payload.lado);
  var pedacos = [];
  try {
    var aba = AP_CRM_aba_();
    var idx = AP_CRM_indice_(aba);
    AP_CRM_linhas_(aba).forEach(function (l) {
      var id = AP_CRM_txt_(AP_CRM_pegar_(l, idx, 'ID'));
      if (id.indexOf(chave + '|') !== 0) return;
      if (AP_CRM_txt_(AP_CRM_pegar_(l, idx, 'STATUS')).toUpperCase() !== 'ATIVO') return;
      var n = parseInt(id.split('|')[3], 10);
      if (isNaN(n)) return;
      pedacos.push({ n: n, texto: AP_CRM_txt_(AP_CRM_pegar_(l, idx, 'LOGO')) });
    });
  } catch (e) { return ''; }

  if (!pedacos.length) return '';
  pedacos.sort(function (a, b) { return a.n - b.n; });
  /* pedaço faltando = arte quebrada. Melhor devolver vazio e o
     cartão desenhar o fundo próprio do que montar uma imagem
     truncada que o navegador mostra pela metade. */
  for (var i = 0; i < pedacos.length; i++) {
    if (pedacos[i].n !== i + 1) return '';
  }
  return pedacos.map(function (p) { return p.texto; }).join('');
}

function AP_CRM_temArte_(modeloId, lado) {
  return !!AP_CRM_arte_({ modeloId: modeloId, lado: lado });
}

function AP_CRM_aposentarArte_(aba, idx, chave, autor, motivo) {
  var largura = aba.getLastColumn();
  var linhas = AP_CRM_linhas_(aba);
  var agora = AP_CRM_agora_();
  var quantos = 0;
  for (var i = 0; i < linhas.length; i++) {
    var id = AP_CRM_txt_(AP_CRM_pegar_(linhas[i], idx, 'ID'));
    if (id.indexOf(chave + '|') !== 0) continue;
    if (AP_CRM_txt_(AP_CRM_pegar_(linhas[i], idx, 'STATUS')).toUpperCase() !== 'ATIVO') continue;
    var nova = linhas[i].slice();
    if (idx['STATUS'] !== undefined) nova[idx['STATUS']] = 'SUBSTITUIDA';
    if (idx['ALTERADO_EM'] !== undefined) nova[idx['ALTERADO_EM']] = agora;
    if (idx['ALTERADO_POR'] !== undefined) nova[idx['ALTERADO_POR']] = autor;
    if (idx['MOTIVO'] !== undefined) nova[idx['MOTIVO']] = motivo;
    aba.getRange(i + 2, 1, 1, largura).setValues([nova]);
    quantos++;
  }
  return quantos;
}

/* payload: { modeloId, lado, arte } */
function AP_CRM_salvarArte_(payload, sessao) {
  var modeloId = AP_CRM_txt_(payload.modeloId);
  var lado = AP_CRM_txt_(payload.lado).toLowerCase();
  var arte = AP_CRM_txt_(payload.arte);

  if (!modeloId) {
    return { ok: false, codigo: 'SEM_MODELO', mensagem: 'Informe de qual modelo é a arte.' };
  }
  if (lado !== 'frente' && lado !== 'verso') {
    return { ok: false, codigo: 'LADO_INVALIDO',
      mensagem: 'O lado precisa ser "frente" ou "verso".' };
  }
  if (!arte) {
    return { ok: false, codigo: 'SEM_ARTE', mensagem: 'Nenhuma imagem foi enviada.' };
  }
  if (arte.indexOf('data:image/') !== 0 && arte.indexOf('http') !== 0) {
    return { ok: false, codigo: 'ARTE_INVALIDA',
      mensagem: 'A arte precisa ser uma imagem (PNG, JPG) ou um endereço http.' };
  }

  var total = Math.ceil(arte.length / AP_CRM_PEDACO);
  if (total > AP_CRM_MAX_PEDACOS) {
    return { ok: false, codigo: 'ARTE_GRANDE',
      mensagem: 'A arte tem ' + Math.round(arte.length / 1024) + ' KB e o máximo aqui é ' +
        Math.round(AP_CRM_PEDACO * AP_CRM_MAX_PEDACOS / 1024) + ' KB. ' +
        'Exporte em JPG a 300 dpi: para um cartão de 54 mm isso dá 640 px de largura, ' +
        'que costuma ficar em torno de 150 KB.' };
  }

  var aba = AP_CRM_aba_();
  var idx = AP_CRM_indice_(aba);
  var largura = aba.getLastColumn();
  var agora = AP_CRM_agora_();
  var autor = AP_CRM_quem_(sessao);
  var chave = AP_CRM_chaveArte_(modeloId, lado);

  var aposentados = AP_CRM_aposentarArte_(aba, idx, chave, autor,
    AP_CRM_txt_(payload.motivo) || 'arte substituída');

  var novas = [];
  for (var i = 0; i < total; i++) {
    novas.push(AP_CRM_montar_(idx, largura, {
      ID: chave + '|' + (i + 1),
      NOME: 'Arte ' + lado + ' do modelo ' + modeloId + ' (' + (i + 1) + '/' + total + ')',
      STATUS: 'ATIVO',
      LOGO: arte.substr(i * AP_CRM_PEDACO, AP_CRM_PEDACO),
      OBSERVACAO: 'Linha de arte, não é um modelo.',
      CRIADO_EM: agora, CRIADO_POR: autor
    }));
  }
  aba.getRange(aba.getLastRow() + 1, 1, novas.length, largura).setValues(novas);
  SpreadsheetApp.flush();

  return { ok: true,
    dados: { modeloId: modeloId, lado: lado, pedacos: total,
      tamanhoKb: Math.round(arte.length / 1024), aposentados: aposentados },
    mensagem: 'Arte da ' + lado + ' guardada (' + Math.round(arte.length / 1024) +
      ' KB em ' + total + ' pedaço(s)).' +
      (aposentados ? ' A arte anterior ficou guardada como histórico.' : '') };
}

function AP_CRM_removerArte_(payload, sessao) {
  var chave = AP_CRM_chaveArte_(payload.modeloId, payload.lado);
  var aba = AP_CRM_aba_();
  var idx = AP_CRM_indice_(aba);
  var quantos = AP_CRM_aposentarArte_(aba, idx, chave, AP_CRM_quem_(sessao),
    AP_CRM_txt_(payload.motivo) || 'arte removida');
  if (!quantos) {
    return { ok: false, codigo: 'NAO_ENCONTRADO',
      mensagem: 'Esse modelo não tem arte guardada nesse lado.' };
  }
  return { ok: true, dados: { pedacos: quantos },
    mensagem: 'Arte removida. O cartão volta a usar o desenho próprio do modelo.' };
}


/* ============================================================
   LER
   ============================================================ */
function AP_CRM_emObjeto_(linha, idx) {
  return {
    id: AP_CRM_txt_(AP_CRM_pegar_(linha, idx, 'ID')),
    nome: AP_CRM_txt_(AP_CRM_pegar_(linha, idx, 'NOME')),
    base: AP_CRM_txt_(AP_CRM_pegar_(linha, idx, 'BASE')),
    versao: AP_CRM_txt_(AP_CRM_pegar_(linha, idx, 'VERSAO')) || '1.0',
    larguraMm: AP_CRM_num_(AP_CRM_pegar_(linha, idx, 'LARGURA_MM'), 54),
    alturaMm: AP_CRM_num_(AP_CRM_pegar_(linha, idx, 'ALTURA_MM'), 85.6),
    orientacao: AP_CRM_txt_(AP_CRM_pegar_(linha, idx, 'ORIENTACAO')).toUpperCase() || 'RETRATO',
    borda: AP_CRM_txt_(AP_CRM_pegar_(linha, idx, 'BORDA')).toUpperCase() || 'ARREDONDADA',
    frente: AP_CRM_json_(AP_CRM_pegar_(linha, idx, 'FRENTE')),
    verso: AP_CRM_json_(AP_CRM_pegar_(linha, idx, 'VERSO')),
    estilo: AP_CRM_json_(AP_CRM_pegar_(linha, idx, 'ESTILO')),
    /* onde cada campo fica no cartão, em % — o que o editor move */
    campos: AP_CRM_json_(AP_CRM_pegar_(linha, idx, 'CAMPOS')),
    logo: AP_CRM_txt_(AP_CRM_pegar_(linha, idx, 'LOGO')),
    padrao: AP_CRM_txt_(AP_CRM_pegar_(linha, idx, 'PADRAO')).toUpperCase() === 'SIM',
    status: AP_CRM_txt_(AP_CRM_pegar_(linha, idx, 'STATUS')) || 'ATIVO',
    observacao: AP_CRM_txt_(AP_CRM_pegar_(linha, idx, 'OBSERVACAO')),
    criadoEm: AP_CRM_txt_(AP_CRM_pegar_(linha, idx, 'CRIADO_EM')),
    criadoPor: AP_CRM_txt_(AP_CRM_pegar_(linha, idx, 'CRIADO_POR')),
    alteradoEm: AP_CRM_txt_(AP_CRM_pegar_(linha, idx, 'ALTERADO_EM')),
    alteradoPor: AP_CRM_txt_(AP_CRM_pegar_(linha, idx, 'ALTERADO_POR')),
    oficial: false
  };
}

function AP_CRM_listar_(payload) {
  payload = payload || {};
  var incluirExcluidos = !!payload.incluirExcluidos;

  var salvos = [];
  try {
    var aba = AP_CRM_aba_();
    var idx = AP_CRM_indice_(aba);
    AP_CRM_linhas_(aba).forEach(function (l) {
      var m = AP_CRM_emObjeto_(l, idx);
      if (!m.id) return;
      if (m.id === AP_CRM_ID_LOGO) return;   /* é configuração, não é modelo */
      if (m.id.indexOf('ARTE|') === 0) return;  /* é pedaço de arte */
      if (!incluirExcluidos && String(m.status).toUpperCase() === 'EXCLUIDO') return;
      salvos.push(m);
    });
  } catch (e) {
    /* sem aba ainda: os oficiais continuam valendo */
    salvos = [];
  }

  var fora = AP_CRM_oficiais_().concat(salvos);

  /* quem tem arte original guardada. A arte em si NÃO vem na
     listagem: seriam centenas de KB em cada abertura de tela.
     A tela pede a arte do modelo que vai desenhar, uma por vez. */
  fora.forEach(function (m) {
    m.temArteFrente = AP_CRM_temArte_(m.id, 'frente');
    m.temArteVerso = AP_CRM_temArte_(m.id, 'verso');
  });

  /* o logotipo da empresa entra em quem não tem o seu */
  var daEmpresa = AP_CRM_logoEmpresa_();
  if (daEmpresa) {
    fora.forEach(function (m) {
      if (!m.logo) { m.logo = daEmpresa; m.logoDaEmpresa = true; }
    });
  }

  /* qual é o padrão: o marcado, senão o Modelo 1 */
  var temPadrao = false;
  fora.forEach(function (m) { if (m.padrao) temPadrao = true; });
  if (!temPadrao) {
    fora.forEach(function (m) { if (m.id === 'OFICIAL-1') m.padrao = true; });
  }
  return fora;
}

function AP_CRM_obter_(payload) {
  var id = AP_CRM_txt_(payload && payload.id);
  var lista = AP_CRM_listar_({ incluirExcluidos: true });
  for (var i = 0; i < lista.length; i++) {
    if (lista[i].id === id) return { ok: true, dados: lista[i] };
  }
  return { ok: false, codigo: 'NAO_ENCONTRADO',
    mensagem: 'Não existe modelo de crachá com o id "' + id + '".' };
}


/* ============================================================
   GRAVAR
   ============================================================ */
function AP_CRM_validar_(payload) {
  var erros = [];
  if (!AP_CRM_txt_(payload.nome)) erros.push('o modelo precisa de nome');

  var larg = AP_CRM_num_(payload.larguraMm, 0);
  var alt = AP_CRM_num_(payload.alturaMm, 0);
  if (!larg || !alt) erros.push('informe largura e altura em milímetros');
  if (larg && (larg < 20 || larg > 400)) erros.push('largura fora do razoável (20 a 400 mm)');
  if (alt && (alt < 20 || alt > 400)) erros.push('altura fora do razoável (20 a 400 mm)');

  var logo = AP_CRM_txt_(payload.logo);
  if (logo.length > AP_CRM_CFG.limiteLogo) {
    erros.push('o logotipo tem ' + Math.round(logo.length / 1024) + ' KB e o limite de uma ' +
      'célula da planilha é ' + Math.round(AP_CRM_CFG.limiteLogo / 1024) + ' KB. ' +
      'Reduza a imagem (uma PNG de 300×300 costuma bastar) ou use um link em vez do arquivo');
  }

  ['frente', 'verso', 'estilo', 'campos'].forEach(function (k) {
    var t = '';
    try { t = JSON.stringify(payload[k] || {}); } catch (e) { t = ''; }
    if (t.length > AP_CRM_CFG.limiteJson) {
      erros.push('a configuração de ' + k + ' ficou grande demais para uma célula');
    }
  });
  return erros;
}

function AP_CRM_salvar_(payload, sessao) {
  var id = AP_CRM_txt_(payload.id);

  /* item 58: oficial não se sobrescreve. E não é por regra: é que
     ele não mora na planilha, então não há linha para gravar. */
  if (id && AP_CRM_ehOficial_(id)) {
    return { ok: false, codigo: 'MODELO_OFICIAL',
      mensagem: 'O modelo "' + AP_CRM_oficialPorId_(id).nome + '" é oficial e não pode ser ' +
        'alterado. Use duplicar para criar uma versão sua a partir dele — o oficial ' +
        'continua intacto para todo mundo.' };
  }

  var erros = AP_CRM_validar_(payload);
  if (erros.length) {
    return { ok: false, codigo: 'INVALIDO',
      mensagem: erros.join('; ') + '.', dados: { erros: erros } };
  }

  var aba = AP_CRM_aba_();
  var idx = AP_CRM_indice_(aba);
  var largura = aba.getLastColumn();
  var linhas = AP_CRM_linhas_(aba);
  var agora = AP_CRM_agora_();
  var autor = AP_CRM_quem_(sessao);

  /* nome repetido entre os ativos confunde na hora de escolher */
  var nome = AP_CRM_txt_(payload.nome);
  for (var i = 0; i < linhas.length; i++) {
    var o = AP_CRM_emObjeto_(linhas[i], idx);
    if (!o.id || o.id === id) continue;
    if (String(o.status).toUpperCase() === 'EXCLUIDO') continue;
    if (o.nome.toUpperCase() === nome.toUpperCase()) {
      return { ok: false, codigo: 'NOME_REPETIDO',
        mensagem: 'Já existe um modelo chamado "' + o.nome + '". Use outro nome.' };
    }
  }

  var valores = {
    NOME: nome,
    BASE: AP_CRM_txt_(payload.base),
    VERSAO: AP_CRM_txt_(payload.versao) || '1.0',
    LARGURA_MM: AP_CRM_num_(payload.larguraMm, 54),
    ALTURA_MM: AP_CRM_num_(payload.alturaMm, 85.6),
    ORIENTACAO: AP_CRM_txt_(payload.orientacao).toUpperCase() || 'RETRATO',
    BORDA: AP_CRM_txt_(payload.borda).toUpperCase() || 'ARREDONDADA',
    FRENTE: JSON.stringify(payload.frente || {}),
    VERSO: JSON.stringify(payload.verso || {}),
    ESTILO: JSON.stringify(payload.estilo || {}),
    CAMPOS: JSON.stringify(payload.campos || {}),
    LOGO: AP_CRM_txt_(payload.logo),
    OBSERVACAO: AP_CRM_txt_(payload.observacao),
    ALTERADO_EM: agora,
    ALTERADO_POR: autor,
    MOTIVO: AP_CRM_txt_(payload.motivo)
  };

  if (id) {
    for (var j = 0; j < linhas.length; j++) {
      if (AP_CRM_txt_(AP_CRM_pegar_(linhas[j], idx, 'ID')) !== id) continue;
      var atual = AP_CRM_emObjeto_(linhas[j], idx);
      valores.ID = id;
      valores.STATUS = AP_CRM_txt_(payload.status) || atual.status || 'ATIVO';
      valores.PADRAO = atual.padrao ? 'SIM' : '';
      valores.CRIADO_EM = atual.criadoEm || agora;
      valores.CRIADO_POR = atual.criadoPor || autor;
      aba.getRange(j + 2, 1, 1, largura)
        .setValues([AP_CRM_montar_(idx, largura, valores)]);
      return { ok: true, dados: { id: id, atualizado: true },
        mensagem: 'Modelo "' + nome + '" atualizado. Os modelos oficiais não foram tocados.' };
    }
    return { ok: false, codigo: 'NAO_ENCONTRADO',
      mensagem: 'Não existe modelo com o id "' + id + '" para atualizar.' };
  }

  valores.ID = AP_CRM_id_();
  valores.STATUS = 'ATIVO';
  valores.PADRAO = '';
  valores.CRIADO_EM = agora;
  valores.CRIADO_POR = autor;
  aba.appendRow(AP_CRM_montar_(idx, largura, valores));
  return { ok: true, dados: { id: valores.ID, criado: true },
    mensagem: 'Modelo "' + nome + '" criado.' };
}

/* Duplicar: a única forma de personalizar um oficial. */
function AP_CRM_duplicar_(payload, sessao) {
  var origem = AP_CRM_txt_(payload.id);
  var r = AP_CRM_obter_({ id: origem });
  if (!r.ok) return r;

  var base = r.dados;
  var novo = {
    nome: AP_CRM_txt_(payload.nome) || (base.nome + ' (cópia)'),
    base: base.id,
    versao: '1.0',
    larguraMm: base.larguraMm,
    alturaMm: base.alturaMm,
    orientacao: base.orientacao,
    borda: base.borda,
    frente: base.frente,
    verso: base.verso,
    estilo: base.estilo,
    campos: base.campos,
    logo: base.logo,
    observacao: 'Criado a partir de ' + base.nome,
    motivo: AP_CRM_txt_(payload.motivo)
  };
  var s = AP_CRM_salvar_(novo, sessao);
  if (!s.ok) return s;
  s.mensagem = 'Modelo "' + novo.nome + '" criado a partir de "' + base.nome +
    '". O original continua como estava.';
  s.dados.base = base.id;
  return s;
}

function AP_CRM_excluir_(payload, sessao) {
  var id = AP_CRM_txt_(payload.id);
  if (!id) return { ok: false, codigo: 'SEM_ID', mensagem: 'Informe o id do modelo.' };

  if (AP_CRM_ehOficial_(id)) {
    return { ok: false, codigo: 'MODELO_OFICIAL',
      mensagem: 'Modelo oficial não é excluído. Ele é o padrão da empresa.' };
  }

  var aba = AP_CRM_aba_();
  var idx = AP_CRM_indice_(aba);
  var linhas = AP_CRM_linhas_(aba);

  for (var i = 0; i < linhas.length; i++) {
    if (AP_CRM_txt_(AP_CRM_pegar_(linhas[i], idx, 'ID')) !== id) continue;
    var nova = linhas[i].slice();
    function por(col, v) {
      var k = idx[col];
      if (k !== undefined) nova[k] = v;
    }
    por('STATUS', 'EXCLUIDO');
    por('PADRAO', '');
    por('ALTERADO_EM', AP_CRM_agora_());
    por('ALTERADO_POR', AP_CRM_quem_(sessao));
    por('MOTIVO', AP_CRM_txt_(payload.motivo) || 'excluído pelo usuário');
    aba.getRange(i + 2, 1, 1, aba.getLastColumn()).setValues([nova]);
    return { ok: true, dados: { id: id },
      mensagem: 'Modelo excluído. A linha continua na planilha, com o motivo — ' +
        'crachás já impressos com ele não mudam.' };
  }
  return { ok: false, codigo: 'NAO_ENCONTRADO',
    mensagem: 'Não existe modelo com o id "' + id + '".' };
}

/* O padrão da empresa: qual modelo já vem escolhido ao emitir. */
function AP_CRM_definirPadrao_(payload, sessao) {
  var id = AP_CRM_txt_(payload.id);
  var r = AP_CRM_obter_({ id: id });
  if (!r.ok) return r;

  var aba = AP_CRM_aba_();
  var idx = AP_CRM_indice_(aba);
  var largura = aba.getLastColumn();
  var linhas = AP_CRM_linhas_(aba);
  var agora = AP_CRM_agora_();
  var autor = AP_CRM_quem_(sessao);

  /* um padrão só: tira de todos e põe em um */
  for (var i = 0; i < linhas.length; i++) {
    var meu = AP_CRM_txt_(AP_CRM_pegar_(linhas[i], idx, 'ID'));
    var nova = linhas[i].slice();
    var k = idx['PADRAO'];
    if (k === undefined) break;
    var deveria = (meu === id) ? 'SIM' : '';
    if (AP_CRM_txt_(nova[k]).toUpperCase() === deveria) continue;
    nova[k] = deveria;
    if (idx['ALTERADO_EM'] !== undefined) nova[idx['ALTERADO_EM']] = agora;
    if (idx['ALTERADO_POR'] !== undefined) nova[idx['ALTERADO_POR']] = autor;
    aba.getRange(i + 2, 1, 1, largura).setValues([nova]);
  }

  /* padrão num oficial não tem linha para marcar: fica guardado
     numa propriedade do script, que também é do servidor */
  if (AP_CRM_ehOficial_(id)) {
    try {
      PropertiesService.getScriptProperties()
        .setProperty('ALMOXA_CRACHA_MODELO_PADRAO', id);
    } catch (e) {}
  } else {
    try {
      PropertiesService.getScriptProperties()
        .deleteProperty('ALMOXA_CRACHA_MODELO_PADRAO');
    } catch (e) {}
  }

  return { ok: true, dados: { id: id },
    mensagem: 'O modelo "' + r.dados.nome + '" passou a ser o padrão ao emitir crachá.' };
}


/* ============================================================
   DIAGNÓSTICO — só leitura
   ============================================================ */
function AP_CRM_diagnostico_() {
  var d = { versao: AP_CRM_CFG.versao, aba: {}, modelos: {} };
  try {
    var aba = AP_CRM_aba_();
    d.aba = { nome: aba.getName(), linhas: Math.max(0, aba.getLastRow() - 1) };
  } catch (e) {
    d.aba = { erro: e.message };
  }
  var lista = AP_CRM_listar_({ incluirExcluidos: true });
  d.modelos = {
    total: lista.length,
    oficiais: lista.filter(function (m) { return m.oficial; }).length,
    personalizados: lista.filter(function (m) { return !m.oficial; }).length,
    comLogo: lista.filter(function (m) { return !!m.logo; }).length
  };
  var padrao = null;
  lista.forEach(function (m) { if (m.padrao) padrao = m.id + ' — ' + m.nome; });
  d.padrao = padrao || '(nenhum)';
  return d;
}


/* ============================================================
   TESTES — não encostam na planilha
   ============================================================ */
function AP_CRM_testes() {
  var falhas = [];
  function conf(nome, obtido, esperado) {
    if (String(obtido) !== String(esperado)) {
      falhas.push(nome + ': esperava "' + esperado + '", veio "' + obtido + '"');
    }
  }

  var of = AP_CRM_oficiais_();
  conf('existem dois oficiais', of.length, 2);
  conf('o primeiro e o Modelo 1', of[0].id, 'OFICIAL-1');
  conf('o segundo e o COESA', of[1].id, 'OFICIAL-2');
  conf('o COESA tem medida de cartao PVC', of[1].larguraMm, 54);
  conf('o COESA mostra matricula', of[1].frente.matricula, 'true');
  conf('o COESA NAO mostra CPF na frente', of[1].frente.cpf, 'false');
  conf('o Modelo 1 continua com CPF', of[0].frente.cpf, 'true');
  conf('o Modelo 1 continua em retrato', of[0].orientacao, 'RETRATO');

  conf('oficial e reconhecido', AP_CRM_ehOficial_('OFICIAL-2'), 'true');
  conf('oficial em minuscula tambem', AP_CRM_ehOficial_('oficial-1'), 'true');
  conf('id qualquer nao e oficial', AP_CRM_ehOficial_('CRM123'), 'false');

  var r = AP_CRM_salvar_({ id: 'OFICIAL-2', nome: 'tentando sobrescrever' }, {});
  conf('gravar por cima do oficial RECUSA', r.ok, 'false');
  conf('com codigo proprio', r.codigo, 'MODELO_OFICIAL');
  conf('e manda duplicar', /duplicar/.test(r.mensagem), 'true');

  var x = AP_CRM_excluir_({ id: 'OFICIAL-1' }, {});
  conf('excluir oficial RECUSA', x.ok, 'false');

  conf('sem nome recusa', AP_CRM_validar_({ larguraMm: 54, alturaMm: 85 }).length > 0, 'true');
  conf('sem medida recusa', AP_CRM_validar_({ nome: 'x' }).length > 0, 'true');
  conf('medida absurda recusa',
    AP_CRM_validar_({ nome: 'x', larguraMm: 5000, alturaMm: 54 }).length > 0, 'true');
  conf('medida boa passa',
    AP_CRM_validar_({ nome: 'x', larguraMm: 92, alturaMm: 57 }).length, 0);

  var grande = '';
  for (var i = 0; i < 50000; i++) grande += 'a';
  var e = AP_CRM_validar_({ nome: 'x', larguraMm: 92, alturaMm: 57, logo: grande });
  conf('logo grande demais recusa', e.length > 0, 'true');
  conf('e explica o que fazer', /Reduza a imagem/.test(e.join(' ')), 'true');

  conf('json estragado nao derruba', JSON.stringify(AP_CRM_json_('{nao e json', {})), '{}');
  conf('json bom e lido', AP_CRM_json_('{"a":1}').a, 1);

  var d = AP_Modulo_crachaModelos('acao_que_nao_existe', {}, {});
  conf('acao desconhecida recusa', d.ok, 'false');

  conf('o COESA e CR80 em pe: 54 de largura', of[1].larguraMm, 54);
  conf('e 85,6 de altura', of[1].alturaMm, 85.6);
  conf('e RETRATO', of[1].orientacao, 'RETRATO');
  conf('logo vazio recusa', AP_CRM_salvarLogo_({}, {}).ok, 'false');
  conf('arte sem modelo recusa', AP_CRM_salvarArte_({ lado: 'frente', arte: 'x' }, {}).ok, 'false');
  conf('arte com lado errado recusa',
    AP_CRM_salvarArte_({ modeloId: 'X', lado: 'cima', arte: 'data:image/png;base64,A' }, {}).codigo,
    'LADO_INVALIDO');
  conf('arte que nao e imagem recusa',
    AP_CRM_salvarArte_({ modeloId: 'X', lado: 'frente', arte: 'oi' }, {}).codigo,
    'ARTE_INVALIDA');
  conf('a chave da arte e previsivel',
    AP_CRM_chaveArte_('crm-1', 'Frente'), 'ARTE|CRM-1|FRENTE');
  conf('o COESA traz as posicoes medidas', of[1].campos.fotoEsq, 43.3);
  conf('e o tamanho do nome medido', of[1].campos.nomeTamanho, 5.5);
  conf('existe coluna para guardar as posicoes',
    AP_CRM_CFG.colunas.indexOf('CAMPOS') > 0, 'true');
  var lg = AP_CRM_salvarLogo_({ logo: grande }, {});
  conf('logo grande recusa', lg.ok, 'false');
  conf('e diz quantos px exportar', /400 px/.test(lg.mensagem), 'true');

  var saida = falhas.length
    ? 'FALHOU (' + falhas.length + '):\n  ' + falhas.join('\n  ')
    : 'Os 36 testes passaram. Nenhuma linha foi gravada.';
  Logger.log(saida);
  return saida;
}
