/**
 * ALMOX PRO — RAIO-X DA PONTE FINANCEIRA
 * ======================================
 *
 * SÓ LEITURA. Não grava, não cria aba, não altera registro.
 *
 * POR QUE ELE EXISTE
 * ------------------
 * O item 1 do prompt pergunta por que os valores aparecem quando a
 * função roda direto no editor do Apps Script, mas não aparecem na
 * interface publicada.
 *
 * A resposta não é uma só: entre o editor e a tela publicada há
 * QUATRO camadas, e qualquer uma delas derruba o pedido sem que a
 * anterior perceba:
 *
 *   editor  →  [1] a função existe no projeto
 *           →  [2] o almoxaApi encaminha esse nome de módulo
 *           →  [3] a ponte aceita a chave do aplicativo
 *           →  [4] a implantação publicada é a versão atual
 *   tela publicada
 *
 * Rodar a função no editor testa SÓ a camada 1. Por isso ela
 * "funciona no Apps Script e não funciona no site" — não é um
 * mistério, é que são caminhos diferentes.
 *
 * Este arquivo testa as quatro, uma por uma, e diz qual quebrou.
 *
 * COMO RODAR
 * ----------
 *   1. Planilha "Base Dado almoxarifado" → Extensões → Apps Script
 *   2. "+" ao lado de Arquivos → Script → nome: ALMOX_PRO_Raio_X_Ponte_Financeira
 *   3. Cole este conteúdo inteiro e salve (Ctrl+S)
 *   4. No seletor de função escolha AP_RXP_RODAR e clique em Executar
 *   5. Abra Registro de execução (Ctrl+Enter) e me mande o texto
 *
 * O relatório NÃO imprime a chave do aplicativo, nem valores, nem
 * nomes de pessoas. Só nomes de módulo, códigos de resposta e
 * contagens.
 */

var AP_RXP = {
  versao: '1.0.0',

  /* os módulos de que o financeiro depende, e uma ação de leitura
     de cada um para bater na porta */
  modulos: [
    { nome: 'custos', acao: 'metodo', arquivo: 'ALMOXA_PRO_Modulo_Custos.gs' },
    { nome: 'vinculos', acao: 'listar', arquivo: 'ALMOXA_PRO_Modulo_Vinculos.gs' },
    { nome: 'atividades', acao: 'listar', arquivo: 'ALMOXA_PRO_Modulo_Vinculos.gs' },
    { nome: 'transferencias', acao: 'historico', arquivo: 'ALMOXA_PRO_Modulo_Transferencias.gs' },
    { nome: 'centros', acao: 'listar', arquivo: '(Core)' },
    { nome: 'saidas', acao: 'listar', arquivo: '(Core)' },
    { nome: 'itens', acao: 'listar', arquivo: '(Core)' },
    { nome: 'usuarios', acao: 'listar', arquivo: '(Core)' }
  ]
};

function AP_RXP_RODAR() {
  var L = [];
  function diz(t) { L.push(t === undefined ? '' : String(t)); }
  function titulo(t) {
    diz('');
    diz('============================================================');
    diz(t);
    diz('============================================================');
  }

  diz('RAIO-X DA PONTE FINANCEIRA  ·  versão ' + AP_RXP.versao);
  diz('Rodado em ' + new Date().toLocaleString('pt-BR'));
  diz('ESTE ARQUIVO NÃO GRAVA NADA.');

  /* ----------------------------------------------------------
     CAMADA 1 — a função existe no projeto?
     ---------------------------------------------------------- */
  titulo('CAMADA 1 — AS FUNÇÕES EXISTEM NESTE PROJETO');
  diz('É só isto que você testa quando roda uma função no editor.');
  diz('');

  var existe = {};
  AP_RXP.modulos.forEach(function (m) {
    var tem = false;
    try { tem = eval('typeof AP_Modulo_' + m.nome + ' === "function"'); } catch (e) { tem = false; }
    existe[m.nome] = tem;
    diz('  ' + (tem ? 'existe       ' : 'NÃO EXISTE   ') + 'AP_Modulo_' + m.nome +
      (tem ? '' : '   ← falta colar ' + m.arquivo));
  });

  /* ----------------------------------------------------------
     CAMADA 2 — o almoxaApi encaminha esse módulo?
     ---------------------------------------------------------- */
  titulo('CAMADA 2 — O ROTEADOR (almoxaApi) CONHECE O MÓDULO?');
  diz('A tela publicada NUNCA chama AP_Modulo_x direto. Ela chama a');
  diz('ponte, a ponte chama o almoxaApi, e o almoxaApi decide para');
  diz('qual módulo o pedido vai. Módulo que existe mas não está no');
  diz('mapa do almoxaApi é invisível para o site inteiro.');
  diz('');

  if (typeof almoxaApi !== 'function') {
    diz('  A FUNÇÃO almoxaApi NÃO EXISTE NESTE PROJETO.');
    diz('  Sem ela a ponte não tem a quem entregar, e NENHUM módulo');
    diz('  responde pelo site. Procure em qual arquivo ela está.');
  } else {
    AP_RXP.modulos.forEach(function (m) {
      if (!existe[m.nome]) {
        diz('  (pulado)     ' + m.nome + ' — a função nem existe ainda');
        return;
      }
      var r = null, cru = null;
      try {
        cru = almoxaApi(JSON.stringify({
          modulo: m.nome, acao: m.acao, payload: {}, sessao: null, origem: 'raiox'
        }));
        r = (typeof cru === 'string') ? JSON.parse(cru) : cru;
      } catch (e) {
        diz('  ERRO         ' + m.nome + ' — o roteador quebrou: ' + e.message);
        return;
      }
      if (!r) { diz('  SEM RESPOSTA ' + m.nome); return; }

      var txt = String(r.codigo || '') + ' ' + String(r.mensagem || '');
      var naoConhece = /MODULO|DESCONHECID|NAO_ENCONTRAD|INVALID|NAO_INSTALAD/i.test(txt) &&
        !/ACAO_DESCONHECIDA/i.test(String(r.codigo || ''));
      var pediuLogin = /SESSAO|LOGIN|AUTENTIC|PERMISS/i.test(txt);

      if (r.ok || pediuLogin || /ACAO_DESCONHECIDA/i.test(String(r.codigo || ''))) {
        diz('  encaminha    ' + m.nome +
          (pediuLogin ? '   (pediu sessão — normal aqui, o caminho está pronto)' : ''));
      } else if (naoConhece) {
        diz('  NÃO ENCAMINHA  ' + m.nome + '   ← ' + (r.codigo || '') + ' ' +
          String(r.mensagem || '').slice(0, 90));
        diz('       >> No arquivo onde está o almoxaApi, ache a lista (ou o');
        diz('          switch) de módulos e acrescente a linha para "' + m.nome + '"');
        diz('          apontando para AP_Modulo_' + m.nome + '.');
      } else {
        diz('  ?            ' + m.nome + '   resposta: ' +
          String(r.codigo || r.mensagem || '').slice(0, 90));
      }
    });
  }

  /* ----------------------------------------------------------
     CAMADA 3 — a chave do aplicativo
     ---------------------------------------------------------- */
  titulo('CAMADA 3 — A CHAVE DO APLICATIVO');
  diz('A ponte compara a chave que o site manda com a que está');
  diz('guardada nas propriedades do script. Se as duas não baterem,');
  diz('TUDO é recusado com APP_NAO_AUTORIZADO — e no editor nada');
  diz('disso acontece, porque o editor não passa pela ponte.');
  diz('');
  diz('A chave NÃO é impressa aqui. Só o que dá para conferir sem');
  diz('expor o segredo.');
  diz('');

  try {
    var prop = '';
    try {
      prop = String(PropertiesService.getScriptProperties()
        .getProperty((typeof AP_PONTE_CFG !== 'undefined' && AP_PONTE_CFG.propChave) ||
          'ALMOXA_CHAVE_APP') || '').trim();
    } catch (e) { prop = ''; }

    if (!prop) {
      diz('  A chave NÃO está configurada no servidor.');
      diz('  Nesse caso a ponte aceita qualquer chave, então ela NÃO');
      diz('  é a causa do problema — mas também não há proteção.');
    } else {
      diz('  A chave ESTÁ configurada.');
      diz('  Tamanho: ' + prop.length + ' caracteres.');
      diz('  Termina em: ...' + prop.slice(-4));
      diz('');
      diz('  CONFIRA NO SITE: abra o sistema publicado, aperte F12,');
      diz('  aba Console, e digite        CFG.chaveApp.slice(-4)');
      diz('  Se os quatro últimos não forem iguais aos de cima, achamos');
      diz('  a causa: a tela está mandando outra chave, e a ponte recusa');
      diz('  tudo antes mesmo de chegar no módulo.');
    }
  } catch (e) {
    diz('  não consegui ler as propriedades: ' + e.message);
  }

  diz('');
  diz('  A ponte existe neste projeto: ' +
    (typeof AP_PONTE_doPost === 'function' ? 'SIM' : 'NÃO — e sem ela o site não fala com o Core'));
  diz('  O doPost existe neste projeto: ' +
    (typeof doPost === 'function' ? 'SIM' : 'NÃO — e sem ele o /exec não recebe nada'));

  /* ----------------------------------------------------------
     CAMADA 4 — a implantação publicada
     ---------------------------------------------------------- */
  titulo('CAMADA 4 — A IMPLANTAÇÃO PUBLICADA');
  diz('O editor roda o código SALVO. O site roda o código IMPLANTADO.');
  diz('São coisas diferentes. Salvar não publica.');
  diz('');
  try {
    var url = ScriptApp.getService().getUrl();
    diz('  URL do serviço: ' + (url || '(não publicado)'));
    if (!url) {
      diz('  >> O script NÃO está publicado como aplicativo da web.');
      diz('     Implantar → Nova implantação → Aplicativo da web.');
    }
  } catch (e) {
    diz('  não consegui ler a URL do serviço: ' + e.message);
  }
  diz('');
  diz('  COMO CONFERIR SE A IMPLANTAÇÃO ESTÁ ATUAL:');
  diz('    Implantar → Gerenciar implantações → olhe a VERSÃO.');
  diz('    Depois de colar qualquer arquivo novo é preciso');
  diz('    editar a implantação e escolher "Nova versão".');
  diz('    Sem isso, o site continua rodando o código de antes —');
  diz('    e os módulos novos simplesmente não existem para ele.');

  /* ----------------------------------------------------------
     5. O QUE JÁ DÁ PARA CALCULAR
     ---------------------------------------------------------- */
  titulo('5. O QUE O FINANCEIRO ENCONTRA HOJE');
  diz('Contagens, nenhum valor.');
  diz('');

  try {
    if (typeof AP_CUSTO_diagnostico_ === 'function') {
      var dc = AP_CUSTO_diagnostico_();
      diz('  CUSTOS  método: ' + dc.metodo);
      Object.keys(dc.fontes).forEach(function (k) {
        var f = dc.fontes[k];
        diz('    ' + (f.existe ? 'existe' : 'NÃO EXISTE') + '  ' + k +
          (f.existe ? '  (' + f.linhas + ' linha(s))' : ''));
      });
      diz('    produtos identificados .. ' + dc.produtos.total);
      diz('    com custo confiável ..... ' + dc.produtos.comCusto);
      diz('    SEM custo (pendência) ... ' + dc.produtos.pendentes);
    } else {
      diz('  CUSTOS: o módulo não está neste projeto.');
    }
  } catch (e) { diz('  CUSTOS: erro ao diagnosticar: ' + e.message); }

  diz('');
  try {
    if (typeof AP_VINC_diagnostico_ === 'function') {
      var dv = AP_VINC_diagnostico_();
      diz('  VÍNCULOS');
      diz('    aba de atividades ....... ' +
        (dv.abas.atividades && dv.abas.atividades.nome ? dv.abas.atividades.nome +
          ' (' + dv.abas.atividades.linhas + ' linha(s))' : 'erro'));
      diz('    aba de vínculos ......... ' +
        (dv.abas.vinculos && dv.abas.vinculos.nome ? dv.abas.vinculos.nome +
          ' (' + dv.abas.vinculos.linhas + ' linha(s))' : 'erro'));
      diz('    atividades ativas ....... ' + (dv.atividades.ativas || 0));
      diz('    atividades sem centro ... ' + (dv.atividades.semCentroCusto || 0));
      diz('    movimentações ligadas ... ' + (dv.vinculos.total || 0));
      diz('    com centro divergente ... ' + (dv.vinculos.divergentes || 0));
    } else {
      diz('  VÍNCULOS: o módulo não está neste projeto.');
    }
  } catch (e) { diz('  VÍNCULOS: erro ao diagnosticar: ' + e.message); }

  diz('');
  try {
    if (typeof AP_Modulo_transferencias === 'function') {
      var h = AP_Modulo_transferencias('historico', { limite: 5000 }, {});
      var n = (h && h.ok && h.dados && h.dados.totais) ? h.dados.totais.todas : 0;
      diz('  TRANSFERÊNCIAS no histórico: ' + n);
    } else {
      diz('  TRANSFERÊNCIAS: o módulo não está neste projeto.');
    }
  } catch (e) { diz('  TRANSFERÊNCIAS: erro: ' + e.message); }

  /* ----------------------------------------------------------
     6. O VEREDITO
     ---------------------------------------------------------- */
  titulo('6. ONDE O CAMINHO QUEBRA');

  var faltamFuncoes = [];
  AP_RXP.modulos.forEach(function (m) { if (!existe[m.nome]) faltamFuncoes.push(m.nome); });

  if (faltamFuncoes.length) {
    diz('  CAMADA 1: faltam os módulos ' + faltamFuncoes.join(', ') + '.');
    diz('  Cole os arquivos correspondentes antes de olhar o resto.');
  } else {
    diz('  CAMADA 1: todas as funções existem.');
  }
  if (typeof almoxaApi !== 'function') {
    diz('  CAMADA 2: o almoxaApi não existe. É a parada mais grave.');
  } else {
    diz('  CAMADA 2: veja a lista acima — todo "NÃO ENCAMINHA" é um');
    diz('            módulo invisível para o site.');
  }
  diz('  CAMADA 3: confira os 4 últimos da chave no console do site.');
  diz('  CAMADA 4: confira a versão em Gerenciar implantações.');
  diz('');
  diz('  Na prática, a ordem de suspeita é: 4, depois 2, depois 3.');
  diz('  Esquecer de publicar nova versão é o motivo mais comum de');
  diz('  "funciona no Apps Script e não funciona no site".');

  titulo('O QUE ESTE ARQUIVO NÃO FEZ');
  diz('  não gravou nada');
  diz('  não criou aba');
  diz('  não imprimiu a chave do aplicativo');
  diz('  não imprimiu valor, nome de pessoa nem conteúdo de célula');
  diz('');
  diz('FIM. Mande este texto inteiro.');

  var texto = L.join('\n');
  Logger.log(texto);
  return texto;
}
