#!/usr/bin/env node
'use strict';

/**
 * ============================================================
 * ALMOXA PRO — verificação antes de publicar no Apps Script
 * ============================================================
 *
 * O que ele pega, antes de o código chegar ao Google:
 *
 *   1. Erro de sintaxe em qualquer arquivo de app/
 *   2. doGet ou doPost declarado em mais de um arquivo
 *   3. Função global declarada em dois arquivos ao mesmo tempo
 *   4. Capacidade que a ponte procura e ninguém define
 *
 * Os três últimos são silenciosos no Apps Script: todos os
 * arquivos dividem um escopo global, a última declaração apaga
 * a anterior e nada avisa. O sistema simplesmente para de
 * funcionar de um jeito difícil de rastrear.
 *
 * Uso:  npm test
 */

const { readFileSync, readdirSync, statSync } = require('node:fs');
const { join } = require('node:path');
const { parse } = require('acorn');

const RAIZ = join(__dirname, '..', 'app');
const problemas = [];
const avisos = [];

/* ------------------------------------------------------------
   Leitura
   ------------------------------------------------------------ */

/**
 * Só o que o clasp realmente envia.
 *
 * O .clasp.json declara scriptExtensions: ['.js', '.gs']. Arquivo sem
 * extensão fica no repositório e NÃO sobe para o Apps Script — contá-lo
 * aqui produz duplicata que não existe no Google.
 */
function extensoesDoClasp() {
  try {
    const conf = JSON.parse(readFileSync(join(__dirname, '..', '.clasp.json'), 'utf8'));
    return conf.scriptExtensions || ['.js', '.gs'];
  } catch {
    return ['.js', '.gs'];
  }
}

function arquivosDoApp() {
  const extensoes = extensoesDoClasp();
  return readdirSync(RAIZ)
    .filter(nome => {
      const caminho = join(RAIZ, nome);
      if (!statSync(caminho).isFile()) return false;
      return extensoes.some(ext => nome.endsWith(ext));
    })
    .map(nome => ({ nome, texto: readFileSync(join(RAIZ, nome), 'utf8') }));
}

/* ------------------------------------------------------------
   1 a 3. Sintaxe e nomes globais
   ------------------------------------------------------------ */

function mapearFuncoes(arquivos, errosSintaxe) {
  const onde = new Map();
  for (const { nome, texto } of arquivos) {
    let programa;
    try {
      programa = parse(texto, { ecmaVersion: 'latest', sourceType: 'script', locations: true });
    } catch (erro) {
      errosSintaxe.push(`Erro de sintaxe em "${nome}": ${erro.message}`);
      continue;
    }
    for (const declaracao of programa.body) {
      if (declaracao.type !== 'FunctionDeclaration') continue;
      const fn = declaracao.id.name;
      if (!onde.has(fn)) onde.set(fn, []);
      onde.get(fn).push({ nome, linha: declaracao.loc.start.line });
    }
  }
  return onde;
}

const FUNCOES_CRITICAS = [
  'doGet', 'doPost', 'AP_Core_boot', 'AP_Core_withLock',
  'APIX_atender_', 'almoxaApi', 'almoxaApiWeb'
];

function verificarFuncoesCriticas(onde, erros) {
  for (const fn of FUNCOES_CRITICAS) {
    const declaracoes = onde.get(fn) || [];
    if (declaracoes.length === 0) erros.push(`Nenhuma declaração global de ${fn}.`);
    if (declaracoes.length > 1) {
      const locais = declaracoes.map(({ nome, linha }) => `${nome}:${linha}`);
      erros.push(`${fn} tem ${declaracoes.length} declarações:\n       ${locais.join('\n       ')}`);
    }
  }
}

/**
 * Duplicatas entram como AVISO, não como impedimento.
 *
 * Elas são um defeito real — uma declaração apaga a outra —, mas já
 * existem hoje e o sistema roda assim. Bloquear a publicação por causa
 * delas impediria justamente as correções que vão eliminá-las.
 *
 * O relatório agrupa por arquivo: na prática são poucos arquivos
 * duplicados respondendo pela maior parte dos casos.
 */
function verificarDuplicadas(onde) {
  const repetidas = [...onde.entries()]
    .filter(([fn, declaracoes]) => declaracoes.length > 1 && !FUNCOES_CRITICAS.includes(fn));

  if (!repetidas.length) return;

  const porArquivo = new Map();
  for (const [, declaracoes] of repetidas) {
    for (const nome of new Set(declaracoes.map(d => d.nome))) {
      porArquivo.set(nome, (porArquivo.get(nome) || 0) + 1);
    }
  }

  const ranking = [...porArquivo.entries()].sort((x, y) => y[1] - x[1]);
  avisos.push(
    `${repetidas.length} funções com declarações globais duplicadas. ` +
    `No Apps Script uma apaga a outra, e qual sobrevive depende da ordem.\n` +
    `       Arquivos com mais casos:\n` +
    ranking.slice(0, 6).map(([a, n]) => `         ${String(n).padStart(3)} em ${a}`).join('\n')
  );
}

/* ------------------------------------------------------------
   4. Capacidades que a ponte espera do Core
   ------------------------------------------------------------ */

function verificarCapacidades(arquivos, onde) {
  const ponte = arquivos.find(a => a.nome.includes('PONTE FRONTEND'));
  if (!ponte) return;

  const bloco = ponte.texto.match(/mapa:\s*\{([\s\S]*?)\n\s*\}/);
  if (!bloco) return;

  const definidasEmOutroLugar = new Set(onde.keys());
  const linhas = bloco[1].matchAll(/(\w+)\s*:\s*\[([^\]]*)\]/g);

  for (const linha of linhas) {
    const capacidade = linha[1];
    const nomes = linha[2].match(/'([^']+)'/g) || [];
    const procurados = nomes.map(n => n.replace(/'/g, ''));

    // nomes com ponto são métodos de objeto; esta checagem é só de função
    const simples = procurados.filter(n => !n.includes('.'));
    if (!simples.length) continue;

    const achou = simples.some(n => definidasEmOutroLugar.has(n));
    if (!achou) {
      // Aviso, não impedimento: a ponte recusa só a operação que depende
      // desta capacidade, e o resto do sistema continua de pé.
      avisos.push(
        `A ponte procura "${capacidade}" e ninguém define ${simples.map(n => `"${n}"`).join(' ou ')}. ` +
        `As operações que dependem disso serão recusadas.`
      );
    }
  }
}

/* ------------------------------------------------------------
   Execução
   ------------------------------------------------------------ */

function principal() {
  console.log('Verificando os arquivos de app/ antes da publicação...\n');

  const arquivos = arquivosDoApp();
  console.log(`  ${arquivos.length} arquivos encontrados`);

  const onde = mapearFuncoes(arquivos, problemas);
  console.log(`  ${onde.size} funções globais mapeadas`);

  verificarFuncoesCriticas(onde, problemas);
  verificarDuplicadas(onde);
  verificarCapacidades(arquivos, onde);

  console.log('');

  if (avisos.length) {
    for (const aviso of avisos) console.log(`  aviso: ${aviso}`);
    console.log('');
  }

  if (problemas.length) {
    console.error(`${problemas.length} problema(s) impedem a publicação:\n`);
    problemas.forEach((p, i) => console.error(`  ${i + 1}. ${p}\n`));
    process.exit(1);
  }

  console.log('Verificação estática concluída.');
}

if (require.main === module) principal();

module.exports = { mapearFuncoes, verificarFuncoesCriticas };
