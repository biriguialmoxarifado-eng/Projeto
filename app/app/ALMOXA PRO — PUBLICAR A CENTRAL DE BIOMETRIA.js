
/**
 * ============================================================
 * ALMOXA PRO — PUBLICAR A CENTRAL DE BIOMETRIA
 * ============================================================
 * POR QUE ISTO EXISTE
 *
 * O botão "Abrir a Estação de Biometria" tentava abrir um
 * arquivo HTML na mesma pasta. Rodando pelo /exec do Apps
 * Script, essa pasta não existe — e o botão não fazia nada.
 *
 * Este arquivo faz o próprio Apps Script servir a Central.
 * O endereço passa a ser:
 *
 *     .../exec?app=biometria
 *
 * A Central abre em aba própria, FORA do quadro do Apps
 * Script. É isso que libera a câmera e o leitor.
 *
 * ------------------------------------------------------------
 * COMO INSTALAR
 *
 * 1. No editor, + > HTML, nome: biometria
 *    Cole ali o conteúdo de ALMOXA_PRO_BIOMETRIA.html
 *
 * 2. + > Script, nome: PUBLICAR_BIOMETRIA
 *    Cole este arquivo
 *
 * 3. No doGet do Core, logo no começo, acrescente:
 *
 *      var rotaBio = ALMOXA_rotaBiometria_(e);
 *      if (rotaBio) return rotaBio;
 *
 * 4. Publique nova versão
 * ============================================================
 */

/**
 * Serve a Central quando a URL pedir por ela.
 * Devolve null quando não for o caso, para o doGet seguir.
 */
function ALMOXA_rotaBiometria_(e) {
  var p = (e && e.parameter) || {};
  var app = String(p.app || p.tela || p.pagina || '').toLowerCase();

  if (app !== 'biometria' && app !== 'central' && app !== 'bio') return null;

  var t = HtmlService.createTemplateFromFile('biometria');

  /* a Central precisa saber o endereço do Core para conversar */
  t.CORE_URL = ScriptApp.getService().getUrl();

  return t.evaluate()
    .setTitle('ALMOXA PRO · Central de Biometria')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    /* ALLOWALL deixa a página abrir em aba própria, sem o quadro */
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Endereço da Central, para montar links dentro do sistema. */
function ALMOXA_urlBiometria() {
  return ScriptApp.getService().getUrl() + '?app=biometria';
}

/**
 * Confere se está tudo pronto. Rode no editor e leia o registro.
 */
function ALMOXA_Bio_diagnosticoPublicacao() {
  var r = { arquivoHtml:false, publicado:false, url:'', avisos:[] };

  try {
    HtmlService.createTemplateFromFile('biometria');
    r.arquivoHtml = true;
  } catch (e) {
    r.avisos.push('O arquivo HTML "biometria" não existe no projeto. ' +
      'Crie em + > HTML com esse nome exato.');
  }

  try {
    r.url = ScriptApp.getService().getUrl() || '';
    r.publicado = !!r.url;
    if (!r.publicado) r.avisos.push('O projeto ainda não foi publicado como aplicativo da web.');
  } catch (e) {
    r.avisos.push('Não consegui ler a URL do serviço: ' + e);
  }

  if (typeof doGet !== 'function') {
    r.avisos.push('Não encontrei a função doGet. A rota precisa ser chamada de dentro dela.');
  }

  Logger.log('================================');
  Logger.log('PUBLICAÇÃO DA CENTRAL DE BIOMETRIA');
  Logger.log('================================');
  Logger.log('Arquivo HTML "biometria": ' + (r.arquivoHtml ? 'OK' : 'FALTA'));
  Logger.log('Projeto publicado: ' + (r.publicado ? 'OK' : 'FALTA'));
  if (r.publicado) Logger.log('Endereço da Central: ' + r.url + '?app=biometria');
  Logger.log('');
  Logger.log(r.avisos.length ? '>>> AJUSTAR: ' + r.avisos.join(' | ')
                             : '>>> TUDO PRONTO. Abra o endereço acima.');
  return r;
}

/* ============================================================
   SE O SEU doGet JÁ TEM OUTRAS ROTAS

   O padrão é o mesmo do PUBLICAR_MOBILE. Exemplo de doGet
   com as duas rotas:

     function doGet(e) {
       var rotaBio = ALMOXA_rotaBiometria_(e);
       if (rotaBio) return rotaBio;

       var rotaMob = ALMOXA_rotaMobile_(e);
       if (rotaMob) return rotaMob;

       // ... o resto do seu doGet, que serve o desktop
     }

   A ordem não importa: cada rota devolve null quando não é
   com ela.
   ============================================================ */
