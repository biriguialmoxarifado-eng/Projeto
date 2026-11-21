'use strict';

const { DatabaseSync, backup } = require('node:sqlite');
const { resolve } = require('node:path');

function failure(code) {
  return Object.assign(new Error(code), { code });
}

class SqliteDiagnosticsProvider {
  constructor(path, clock = () => new Date()) {
    this.path = resolve(path);
    this.clock = clock;
  }

  connect({ readOnly = false } = {}) {
    if (this.db) return;
    const db = new DatabaseSync(this.path, { readOnly });
    try {
      if (!readOnly) db.exec(`
        PRAGMA busy_timeout = 1500;
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS v2_diagnostic_records (
          id TEXT PRIMARY KEY NOT NULL,
          origin TEXT NOT NULL,
          message TEXT NOT NULL,
          createdAt TEXT NOT NULL,
          createdBy TEXT NOT NULL,
          updatedAt TEXT NOT NULL,
          updatedBy TEXT NOT NULL,
          version INTEGER NOT NULL CHECK (version > 0)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS v2_diagnostics_origin
          ON v2_diagnostic_records(origin, id);
        CREATE TABLE IF NOT EXISTS v2_diagnostic_audit (
          recordId TEXT NOT NULL REFERENCES v2_diagnostic_records(id),
          version INTEGER NOT NULL,
          occurredAt TEXT NOT NULL,
          actor TEXT NOT NULL,
          snapshot TEXT NOT NULL,
          PRIMARY KEY (recordId, version)
        ) STRICT;
      `);
      this.db = db;
    } catch (error) {
      db.close();
      throw error;
    }
  }

  disconnect() {
    this.db?.close();
    this.db = null;
  }

  healthCheck() {
    this.db.prepare('SELECT id FROM v2_diagnostic_records LIMIT 1').get();
    return { status: 'ok', provider: 'sqlite' };
  }

  findById(_table, id) {
    return this.db.prepare('SELECT * FROM v2_diagnostic_records WHERE id = ?').get(id) ?? null;
  }

  findMany(_table, { origin }, { page, limit }) {
    const where = origin === undefined ? '' : 'WHERE origin = ?';
    const args = origin === undefined ? [] : [origin];
    const offset = (page - 1) * limit;
    const records = this.db.prepare(`
      SELECT * FROM v2_diagnostic_records ${where} ORDER BY id LIMIT ? OFFSET ?
    `).all(...args, limit + 1, offset);
    return { records: records.slice(0, limit), page, limit, hasNext: records.length > limit };
  }

  transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* Original failure takes precedence. */ }
      throw error;
    }
  }

  saveAudit(record) {
    this.db.prepare('INSERT INTO v2_diagnostic_audit VALUES (?, ?, ?, ?, ?)')
      .run(record.id, record.version, record.updatedAt, record.updatedBy, JSON.stringify(record));
    return record;
  }

  insert(table, { id, origin, message }, { actor }) {
    return this.transaction(() => {
      const initial = this.db.prepare(`
        SELECT snapshot FROM v2_diagnostic_audit WHERE recordId = ? AND version = 1
      `).get(id);
      if (initial) {
        const original = JSON.parse(initial.snapshot);
        if (original.origin === origin && original.message === message && original.createdBy === actor) {
          return { record: original, created: false };
        }
        throw failure('RECORD_CONFLICT');
      }
      const now = this.clock().toISOString();
      this.db.prepare('INSERT INTO v2_diagnostic_records VALUES (?, ?, ?, ?, ?, ?, ?, 1)')
        .run(id, origin, message, now, actor, now, actor);
      return { record: this.saveAudit(this.findById(table, id)), created: true };
    });
  }

  update(table, id, { message, version }, { actor }) {
    return this.transaction(() => {
      const current = this.findById(table, id);
      if (!current) throw failure('RECORD_NOT_FOUND');
      if (current.version !== version) throw failure('RECORD_CONFLICT');
      this.db.prepare(`
        UPDATE v2_diagnostic_records SET message = ?, updatedAt = ?, updatedBy = ?,
          version = version + 1 WHERE id = ?
      `).run(message, this.clock().toISOString(), actor, id);
      return this.saveAudit(this.findById(table, id));
    });
  }

  async backupTo(destination) {
    const target = resolve(destination);
    if (target === this.path) throw failure('BACKUP_TARGET_INVALID');
    const { open, unlink } = require('node:fs/promises');
    const file = await open(target, 'wx', 0o600);
    await file.close();
    try {
      await backup(this.db, target);
    } catch (error) {
      await unlink(target).catch(() => {});
      throw error;
    }
  }
}

module.exports = { SqliteDiagnosticsProvider };
