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

function semComentarios(texto) {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/* ------------------------------------------------------------
   1. Sintaxe
   ------------------------------------------------------------ */

function verificarSintaxe(arquivos) {
  const { execFileSync } = require('node:child_process');
  const { writeFileSync, mkdtempSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const pasta = mkdtempSync(join(tmpdir(), 'almoxa-check-'));

  for (const { nome, texto } of arquivos) {
    const alvo = join(pasta, 'arquivo.js');
    writeFileSync(alvo, texto);
    try {
      execFileSync(process.execPath, ['--check', alvo], { stdio: 'pipe' });
    } catch (erro) {
      const detalhe = String(erro.stderr || '').split('\n').slice(1, 3).join(' ').trim();
      problemas.push(`Erro de sintaxe em "${nome}": ${detalhe}`);
    }
  }
}

/* ------------------------------------------------------------
   2 e 3. Nomes globais em disputa
   ------------------------------------------------------------ */

function mapearFuncoes(arquivos) {
  const onde = new Map();
  for (const { nome, texto } of arquivos) {
    const limpo = semComentarios(texto);
    // Sem indentação: só o que está no nível raiz do arquivo é global.
    // Uma função indentada vive dentro de outra e não disputa nome.
    const encontradas = limpo.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm);
    for (const achada of encontradas) {
      const fn = achada[1];
      if (!onde.has(fn)) onde.set(fn, []);
      if (!onde.get(fn).includes(nome)) onde.get(fn).push(nome);
    }
  }
  return onde;
}

/**
 * Cada entrada HTTP precisa existir uma única vez.
 */
function verificarEntradas(onde) {
  for (const entrada of ['doGet', 'doPost']) {
    const arquivos = onde.get(entrada) || [];
    if (arquivos.length > 1) {
      problemas.push(
        `${entrada} declarado em ${arquivos.length} arquivos — o Apps Script fica ` +
        `com um só, e qual depende da ordem:\n       ${arquivos.join('\n       ')}`
      );
    }
    if (arquivos.length === 0) {
      problemas.push(
        `Nenhum arquivo declara ${entrada}. Sem isso o sistema não atende ` +
        `nenhum pedido por essa via.`
      );
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
    .filter(([fn, arquivos]) => arquivos.length > 1 && fn !== 'doGet' && fn !== 'doPost');

  if (!repetidas.length) return;

  const porArquivo = new Map();
  for (const [, arquivos] of repetidas) {
    for (const a of arquivos) porArquivo.set(a, (porArquivo.get(a) || 0) + 1);
  }

  const ranking = [...porArquivo.entries()].sort((x, y) => y[1] - x[1]);
  avisos.push(
    `${repetidas.length} funções declaradas em mais de um arquivo. ` +
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

  verificarSintaxe(arquivos);
  const onde = mapearFuncoes(arquivos);
  console.log(`  ${onde.size} funções globais mapeadas`);

  verificarEntradas(onde);
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

  console.log('Tudo certo para publicar.');
}

principal();
