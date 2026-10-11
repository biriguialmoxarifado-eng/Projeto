/**
 * ALMOX PRO — RAIO-X FINANCEIRO
 * =============================
 *
 * SÓ LEITURA. Este arquivo não grava, não cria aba, não apaga nada,
 * não altera nenhum registro. Ele abre, olha e escreve um relatório.
 *
 * POR QUE ELE EXISTE
 * ------------------
 * O projeto pede, no item 154, "investigar se os problemas decorrem
 * de campos ausentes, nomes de propriedades divergentes, falhas no
 * backend, filtros incorretos ou ausência de relacionamento com os
 * itens do estoque".
 *
 * Nenhuma dessas quatro causas dá para descobrir olhando o HTML: a
 * tela mostra o que o Core devolve. Para saber por que a tela de
 * saídas só mostra protocolo e quantidade, é preciso ver O QUE O
 * CORE DEVOLVE DE VERDADE — e isso só a planilha responde.
 *
 * E o item 431 é explícito: se o banco não tiver o dado, identificar
 * a dependência ANTES de dizer que a função está pronta. Este
 * arquivo é o que torna essa frase verificável em vez de opinião.
 *
 * COMO RODAR
 * ----------
 *   1. Planilha "Base Dado almoxarifado" → Extensões → Apps Script
 *   2. "+" ao lado de Arquivos → Script → nome: ALMOX_PRO_Raio_X_Financeiro
 *   3. Cole este conteúdo inteiro e salve (Ctrl+S)
 *   4. No seletor de função escolha AP_RXF_RODAR e clique em Executar
 *   5. Abra Registro de execução (Ctrl+Enter) e me mande o texto
 *
 * O relatório NÃO traz valores de notas, nomes de pessoas nem
 * conteúdo de célula: traz NOMES DE CAMPO e CONTAGENS. É o que eu
 * preciso para consertar, e não expõe dado da empresa.
 */

var AP_RXF = {
  versao: '1.0.0',
  /* os módulos que o projeto manda auditar, item 32 */
  modulos: [
    { nome: 'saidas', acoes: ['listar'] },
    { nome: 'reservas', acoes: ['listar'] },
    { nome: 'transferencias', acoes: ['listar'] },
    { nome: 'movimentacoes', acoes: ['listar'] },
    { nome: 'estoque', acoes: ['listar'] },
    { nome: 'itens', acoes: ['listar'] },
    { nome: 'usuarios', acoes: ['listar'] },
    { nome: 'obras', acoes: ['listar'] },
    { nome: 'centros', acoes: ['listar'] },
    { nome: 'centrocusto', acoes: ['listar'] },
    { nome: 'setores', acoes: ['listar'] },
    { nome: 'orcamento', acoes: ['listar'] },
    { nome: 'nf', acoes: ['listar'] },
    { nome: 'patrimonio', acoes: ['listar'] }
  ],
  /* campos que o projeto exige ver na tela de saídas (item 132) */
  exigidosSaida: ['protocolo', 'data', 'tipo', 'produto', 'codigo', 'descricao',
    'unidade', 'qtd', 'valorUnitario', 'valorTotal', 'solicitante', 'entregue',
    'setorOrigem', 'setorDestino', 'centroCusto', 'reserva', 'status'],
  exigidosReserva: ['protocolo', 'solicitante', 'setor', 'centroCusto', 'data',
    'prazo', 'status', 'itens', 'qtd', 'valorUnitario', 'valorTotal', 'retirado'],
  exigidosTransferencia: ['protocolo', 'data', 'setorOrigem', 'setorDestino',
    'centroCustoOrigem', 'centroCustoDestino', 'responsavel', 'motivo', 'itens',
    'codigo', 'descricao', 'unidade', 'qtd', 'valorUnitario', 'valorTotal', 'status']
};

function AP_RXF_RODAR() {
  var L = [];
  function diz(t) { L.push(t === undefined ? '' : String(t)); }
  function titulo(t) {
    diz('');
    diz('============================================================');
    diz(t);
    diz('============================================================');
  }

  diz('RAIO-X FINANCEIRO DO ALMOXA PRO  ·  versão ' + AP_RXF.versao);
  diz('Rodado em ' + new Date().toLocaleString('pt-BR'));
  diz('ESTE ARQUIVO NÃO GRAVA NADA. É só leitura.');

  /* ----------------------------------------------------------
     1. QUE MÓDULOS EXISTEM DE VERDADE
     ---------------------------------------------------------- */
  titulo('1. MÓDULOS QUE RESPONDEM');
  diz('Um módulo que não existe é diferente de um módulo que responde');
  diz('vazio. O primeiro precisa ser escrito; o segundo, preenchido.');
  diz('');

  var vivos = {};
  AP_RXF.modulos.forEach(function (m) {
    var fn = null;
    try { fn = eval('typeof AP_Modulo_' + m.nome + ' === "function" ? AP_Modulo_' + m.nome + ' : null'); }
    catch (e) { fn = null; }

    if (!fn) {
      diz('  NÃO EXISTE   AP_Modulo_' + m.nome);
      return;
    }
    vivos[m.nome] = fn;
    diz('  existe       AP_Modulo_' + m.nome);
  });

  /* ----------------------------------------------------------
     2. O QUE CADA MÓDULO DEVOLVE
     ---------------------------------------------------------- */
  titulo('2. O QUE VEM DE VERDADE EM CADA LISTAGEM');
  diz('Para cada módulo: quantos registros, e QUAIS NOMES DE CAMPO o');
  diz('primeiro registro carrega. Nenhum valor é impresso.');

  var amostras = {};
  Object.keys(vivos).forEach(function (nome) {
    diz('');
    diz('--- ' + nome + '.listar ---');
    var r = null;
    try { r = vivos[nome]('listar', {}, {}); }
    catch (e) { diz('  ERRO AO CHAMAR: ' + e.message); return; }

    if (!r) { diz('  devolveu nada'); return; }
    if (!r.ok) { diz('  recusou: ' + (r.codigo || '') + ' ' + (r.mensagem || '')); return; }

    var lista = r.dados;
    if (Object.prototype.toString.call(lista) !== '[object Array]') {
      lista = (lista && lista.dados) || (lista && lista.lista) || null;
    }
    if (Object.prototype.toString.call(lista) !== '[object Array]') {
      diz('  dados NÃO é lista. Tipo: ' + typeof r.dados);
      if (r.dados && typeof r.dados === 'object') {
        diz('  chaves: ' + Object.keys(r.dados).slice(0, 30).join(', '));
      }
      return;
    }

    diz('  registros: ' + lista.length);
    if (!lista.length) { diz('  (lista vazia — nada a inspecionar)'); return; }

    amostras[nome] = lista[0];
    var campos = Object.keys(lista[0]);
    diz('  campos do 1º registro (' + campos.length + '):');
    diz('    ' + campos.join(', '));

    /* se houver itens dentro, os campos deles também importam:
       é ali que moram descrição, unidade e valor unitário */
    var itens = lista[0].itens || lista[0].produtos || lista[0].materiais;
    if (Object.prototype.toString.call(itens) === '[object Array]' && itens.length) {
      diz('  campos de CADA ITEM (' + Object.keys(itens[0]).length + '):');
      diz('    ' + Object.keys(itens[0]).join(', '));
    } else if (itens) {
      diz('  tem "itens" mas não é lista, ou está vazio');
    } else {
      diz('  ATENÇÃO: o registro NÃO traz lista de itens.');
      diz('  Sem itens, a tela não tem como mostrar produto, unidade');
      diz('  nem valor unitário — por mais que a tela seja corrigida.');
    }
  });

  /* ----------------------------------------------------------
     3. O QUE O PROJETO EXIGE × O QUE EXISTE
     ---------------------------------------------------------- */
  titulo('3. CAMPOS EXIGIDOS PELO PROJETO QUE NÃO EXISTEM HOJE');
  diz('Comparação literal com os itens 132, 170 e 206 do projeto.');
  diz('Campo que falta aqui não é erro de tela: é dado que o Core');
  diz('não guarda, e que precisa passar a ser guardado.');

  function conferirCampos(nome, exigidos) {
    diz('');
    diz('--- ' + nome + ' ---');
    var reg = amostras[nome];
    if (!reg) { diz('  sem amostra (módulo ausente ou lista vazia)'); return; }

    var tem = {};
    Object.keys(reg).forEach(function (k) { tem[k.toLowerCase()] = 1; });
    var itens = reg.itens || reg.produtos || reg.materiais;
    if (Object.prototype.toString.call(itens) === '[object Array]' && itens.length) {
      Object.keys(itens[0]).forEach(function (k) { tem[k.toLowerCase()] = 1; });
    }

    var faltando = exigidos.filter(function (c) { return !tem[c.toLowerCase()]; });
    if (!faltando.length) { diz('  todos os campos exigidos existem'); return; }
    diz('  FALTAM ' + faltando.length + ' de ' + exigidos.length + ':');
    diz('    ' + faltando.join(', '));
  }

  conferirCampos('saidas', AP_RXF.exigidosSaida);
  conferirCampos('reservas', AP_RXF.exigidosReserva);
  conferirCampos('transferencias', AP_RXF.exigidosTransferencia);

  /* ----------------------------------------------------------
     4. CENTRO DE CUSTO: EXISTE EM ALGUM LUGAR?
     ---------------------------------------------------------- */
  titulo('4. CENTRO DE CUSTO E ORÇAMENTO');
  diz('O projeto inteiro (itens 60 a 100 e 243 a 272) se apoia em');
  diz('centro de custo e orçamento mensal. Antes de escrever uma');
  diz('linha disso, é preciso saber se já existe alguma coisa.');
  diz('');

  var achouCC = [];
  Object.keys(amostras).forEach(function (nome) {
    var reg = amostras[nome];
    Object.keys(reg).forEach(function (k) {
      if (/centro|custo|cc$|orcament|pep/i.test(k)) {
        achouCC.push(nome + '.' + k);
      }
    });
    var itens = reg.itens;
    if (Object.prototype.toString.call(itens) === '[object Array]' && itens.length) {
      Object.keys(itens[0]).forEach(function (k) {
        if (/centro|custo|cc$|orcament|pep/i.test(k)) achouCC.push(nome + '.itens.' + k);
      });
    }
  });

  if (achouCC.length) {
    diz('  campos parecidos com centro de custo encontrados:');
    achouCC.forEach(function (c) { diz('    ' + c); });
  } else {
    diz('  NENHUM campo de centro de custo nos registros inspecionados.');
  }

  /* ----------------------------------------------------------
     5. AS ABAS DA PLANILHA
     ---------------------------------------------------------- */
  titulo('5. ABAS QUE EXISTEM NA PLANILHA');
  diz('Só os nomes e a contagem de linhas. Nenhum conteúdo é lido.');
  diz('');
  try {
    var ss = SpreadsheetApp.getActive();
    var abas = ss.getSheets();
    diz('  ' + abas.length + ' aba(s):');
    abas.forEach(function (a) {
      var ult = 0;
      try { ult = a.getLastRow(); } catch (e) {}
      var marca = /CENTRO|CUSTO|ORCAMENT|SETOR/i.test(a.getName()) ? '   <<< financeiro' : '';
      diz('    ' + a.getName() + '  (' + Math.max(0, ult - 1) + ' linha(s))' + marca);
    });
  } catch (e) {
    diz('  não consegui listar as abas: ' + e.message);
  }

  /* ----------------------------------------------------------
     6. O QUE ESTE ARQUIVO NÃO FAZ
     ---------------------------------------------------------- */
  titulo('6. O QUE ESTE ARQUIVO NÃO FEZ');
  diz('  não gravou nada');
  diz('  não criou aba');
  diz('  não apagou registro');
  diz('  não mexeu em estoque, nota, reserva nem saída');
  diz('  não imprimiu valor, nome de pessoa nem conteúdo de célula');
  diz('');
  diz('FIM DO RAIO-X. Mande este texto inteiro para eu continuar.');

  var texto = L.join('\n');
  Logger.log(texto);
  return texto;
}
