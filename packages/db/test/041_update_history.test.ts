import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');

function loadDb(): Database.Database {
  const db = new Database(':memory:');
  // Apply base schema then the specific migration under test.
  // (041 does not depend on any other migration — no FKs to migrated tables.)
  const schema = readFileSync(join(PKG_ROOT, 'schema.sql'), 'utf8');
  db.exec(schema);
  const migration = readFileSync(
    join(PKG_ROOT, 'migrations', '041_update_history.sql'),
    'utf8',
  );
  db.exec(migration);
  return db;
}

describe('041_update_history.sql', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = loadDb();
  });

  it('creates update_history table with all 13 expected columns', () => {
    const rows = db
      .prepare("PRAGMA table_info('update_history')")
      .all() as Array<{ name: string }>;
    const names = rows.map((r) => r.name).sort();

    const expected = [
      'id',
      'started_at',
      'completed_at',
      'from_version',
      'to_version',
      'status',
      'snapshot_worker_url',
      'snapshot_admin_deployment',
      'snapshot_liff_deployment',
      'events_jsonl',
      'error',
      'rollback_of',
      'rollback_expires_at',
    ].sort();

    expect(names).toEqual(expected);
    expect(names).toHaveLength(13);
  });

  it('rejects invalid status values via CHECK constraint', () => {
    const insert = db.prepare(
      `INSERT INTO update_history (id, started_at, from_version, to_version, status)
       VALUES (?, ?, ?, ?, ?)`,
    );
    expect(() =>
      insert.run('u-bad', 1, '0.1.0', '0.2.0', 'bogus'),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      insert.run('u-bad-2', 1, '0.1.0', '0.2.0', 'pending'),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      insert.run('u-bad-3', 1, '0.1.0', '0.2.0', ''),
    ).toThrow(/CHECK constraint failed/);
  });

  it('accepts all 4 valid status values', () => {
    const insert = db.prepare(
      `INSERT INTO update_history (id, started_at, from_version, to_version, status)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const status of ['running', 'success', 'failed', 'rolled_back']) {
      expect(() =>
        insert.run(`u-${status}`, 1, '0.1.0', '0.2.0', status),
      ).not.toThrow();
    }
    const count = db
      .prepare('SELECT COUNT(*) AS c FROM update_history')
      .get() as { c: number };
    expect(count.c).toBe(4);
  });

  it('creates idx_update_history_started index', () => {
    const idx = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'index' AND name = 'idx_update_history_started'`,
      )
      .get() as { name: string } | undefined;
    expect(idx).toBeDefined();
    expect(idx?.name).toBe('idx_update_history_started');
  });
});
