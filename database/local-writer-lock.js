'use strict';

const { createHash } = require('node:crypto');
const { mkdir, open, unlink } = require('node:fs/promises');
const { join } = require('node:path');
const { homedir } = require('node:os');
const { setTimeout: delay } = require('node:timers/promises');

function createLocalWriterLock(spreadsheetId) {
  const directory = join(process.env.LOCALAPPDATA || homedir(), '.almoxa-writer-locks');
  const id = createHash('sha256').update(String(spreadsheetId)).digest('hex');
  const path = join(directory, id + '.lock');

  return async function coordinate(work) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const deadline = performance.now() + 15000;
    let file;
    while (!file) {
      try {
        file = await open(path, 'wx', 0o600);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (performance.now() >= deadline) {
          throw Object.assign(new Error('Escrita isolada ocupada.'), { code: 'ALMOXA_WRITER_BUSY' });
        }
        await delay(50);
      }
    }
    try {
      return await work();
    } finally {
      await file.close();
      await unlink(path);
    }
  };
}

module.exports = { createLocalWriterLock };
