import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSnapshot,
  getSnapshot,
  updateStatus,
  appendEvent,
  setError,
  listRecent,
  type D1Like,
  type SnapshotRow,
} from '../src/snapshot.js';
import type { UpdateEvent } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const DB_PKG = join(REPO_ROOT, 'packages', 'db');

function loadDb(): Database.Database {
  const db = new Database(':memory:');
  const schema = readFileSync(join(DB_PKG, 'schema.sql'), 'utf8');
  db.exec(schema);
  const migration = readFileSync(
    join(DB_PKG, 'migrations', '041_update_history.sql'),
    'utf8',
  );
  db.exec(migration);
  return db;
}

function makeD1Adapter(db: Database.Database): D1Like {
  return {
    prepare: (sql: string) => ({
      bind: (...args: any[]) => ({
        run: async () => db.prepare(sql).run(...args),
        first: async <T>() =>
          (db.prepare(sql).get(...args) as T | undefined) ?? null,
        all: async <T>() => ({
          results: db.prepare(sql).all(...args) as T[],
        }),
      }),
    }),
  };
}

describe('snapshot CRUD', () => {
  let rawDb: Database.Database;
  let d1: D1Like;

  beforeEach(() => {
    rawDb = loadDb();
    d1 = makeD1Adapter(rawDb);
  });

  describe('createSnapshot', () => {
    it('returns an ID matching expected pattern', async () => {
      const id = await createSnapshot(d1, { from: '0.5.0', to: '0.6.0' });
      expect(id).toMatch(/^[A-Z0-9]+$/);
      expect(id.length).toBeGreaterThanOrEqual(10);
    });

    it('persists row with status=running and version fields', async () => {
      const id = await createSnapshot(d1, {
        from: '0.5.0',
        to: '0.6.0',
        snapshotWorkerUrl: 'https://r2.example.com/worker-snap.js',
        snapshotAdminDeployment: 'dep-admin-123',
        snapshotLiffDeployment: 'dep-liff-456',
      });

      const row = await getSnapshot(d1, id);
      expect(row).not.toBeNull();
      expect(row!.id).toBe(id);
      expect(row!.status).toBe('running');
      expect(row!.from_version).toBe('0.5.0');
      expect(row!.to_version).toBe('0.6.0');
      expect(row!.snapshot_worker_url).toBe('https://r2.example.com/worker-snap.js');
      expect(row!.snapshot_admin_deployment).toBe('dep-admin-123');
      expect(row!.snapshot_liff_deployment).toBe('dep-liff-456');
      expect(row!.completed_at).toBeNull();
      expect(row!.error).toBeNull();
      expect(row!.events_jsonl).toBe('');
    });

    it('sets rollback_expires_at ~7 days from now', async () => {
      const before = Date.now();
      const id = await createSnapshot(d1, { from: '0.5.0', to: '0.6.0' });
      const after = Date.now();

      const row = await getSnapshot(d1, id);
      expect(row!.rollback_expires_at).not.toBeNull();
      const expected = before + 7 * 86400 * 1000;
      const expectedMax = after + 7 * 86400 * 1000;
      // Tolerance: should be between expected (using `before`) and expectedMax (using `after`)
      expect(row!.rollback_expires_at!).toBeGreaterThanOrEqual(expected);
      expect(row!.rollback_expires_at!).toBeLessThanOrEqual(expectedMax + 1000);
    });

    it('persists optional snapshot fields as null when omitted', async () => {
      const id = await createSnapshot(d1, { from: '0.5.0', to: '0.6.0' });
      const row = await getSnapshot(d1, id);
      expect(row!.snapshot_worker_url).toBeNull();
      expect(row!.snapshot_admin_deployment).toBeNull();
      expect(row!.snapshot_liff_deployment).toBeNull();
    });
  });

  describe('getSnapshot', () => {
    it('returns the row by ID', async () => {
      const id = await createSnapshot(d1, { from: '0.5.0', to: '0.6.0' });
      const row = await getSnapshot(d1, id);
      expect(row).not.toBeNull();
      expect(row!.id).toBe(id);
    });

    it('returns null for nonexistent ID', async () => {
      const row = await getSnapshot(d1, 'NONEXISTENT');
      expect(row).toBeNull();
    });
  });

  describe('appendEvent', () => {
    it('appends one event to events_jsonl', async () => {
      const id = await createSnapshot(d1, { from: '0.5.0', to: '0.6.0' });
      const ev: UpdateEvent = { step: 'preflight', status: 'running' };
      await appendEvent(d1, id, ev);

      const row = await getSnapshot(d1, id);
      const lines = row!.events_jsonl.split('\n').filter((l) => l.length > 0);
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0]);
      expect(parsed.step).toBe('preflight');
      expect(parsed.status).toBe('running');
    });

    it('accumulates multiple calls (3 calls → 3 lines)', async () => {
      const id = await createSnapshot(d1, { from: '0.5.0', to: '0.6.0' });
      await appendEvent(d1, id, { step: 'preflight', status: 'done' });
      await appendEvent(d1, id, { step: 'migration', status: 'running' });
      await appendEvent(d1, id, { step: 'migration', status: 'done' });

      const row = await getSnapshot(d1, id);
      const lines = row!.events_jsonl.split('\n').filter((l) => l.length > 0);
      expect(lines).toHaveLength(3);
      expect(JSON.parse(lines[0]).step).toBe('preflight');
      expect(JSON.parse(lines[1]).step).toBe('migration');
      expect(JSON.parse(lines[2]).step).toBe('migration');
      expect(JSON.parse(lines[2]).status).toBe('done');
    });
  });

  describe('updateStatus', () => {
    it("sets completed_at to Date.now() when status='success'", async () => {
      const id = await createSnapshot(d1, { from: '0.5.0', to: '0.6.0' });
      const before = Date.now();
      await updateStatus(d1, id, 'success');
      const after = Date.now();

      const row = await getSnapshot(d1, id);
      expect(row!.status).toBe('success');
      expect(row!.completed_at).not.toBeNull();
      expect(row!.completed_at!).toBeGreaterThanOrEqual(before);
      expect(row!.completed_at!).toBeLessThanOrEqual(after);
    });

    it("keeps completed_at null when status='running'", async () => {
      const id = await createSnapshot(d1, { from: '0.5.0', to: '0.6.0' });
      await updateStatus(d1, id, 'running');

      const row = await getSnapshot(d1, id);
      expect(row!.status).toBe('running');
      expect(row!.completed_at).toBeNull();
    });

    it("sets completed_at when status='failed'", async () => {
      const id = await createSnapshot(d1, { from: '0.5.0', to: '0.6.0' });
      await updateStatus(d1, id, 'failed');
      const row = await getSnapshot(d1, id);
      expect(row!.status).toBe('failed');
      expect(row!.completed_at).not.toBeNull();
    });
  });

  describe('setError', () => {
    it('stores error trace', async () => {
      const id = await createSnapshot(d1, { from: '0.5.0', to: '0.6.0' });
      const trace = 'Error: boom\n  at foo (bar.ts:1:1)';
      await setError(d1, id, trace);

      const row = await getSnapshot(d1, id);
      expect(row!.error).toBe(trace);
    });
  });

  describe('listRecent', () => {
    it('returns rows ORDER BY started_at DESC', async () => {
      // Insert three rows with controlled started_at via raw SQL so order is deterministic.
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const id = await createSnapshot(d1, {
          from: '0.5.0',
          to: `0.6.${i}`,
        });
        ids.push(id);
        // Force distinct started_at values, increasing.
        rawDb
          .prepare('UPDATE update_history SET started_at = ? WHERE id = ?')
          .run(1000 + i, id);
      }

      const rows = await listRecent(d1);
      expect(rows.length).toBe(3);
      // DESC: latest started_at first, which is the last-inserted id.
      expect(rows[0].id).toBe(ids[2]);
      expect(rows[1].id).toBe(ids[1]);
      expect(rows[2].id).toBe(ids[0]);
    });

    it('respects limit', async () => {
      for (let i = 0; i < 5; i++) {
        await createSnapshot(d1, { from: '0.5.0', to: `0.6.${i}` });
      }
      const rows = await listRecent(d1, 2);
      expect(rows.length).toBe(2);
    });

    it('defaults limit to 20', async () => {
      for (let i = 0; i < 25; i++) {
        await createSnapshot(d1, { from: '0.5.0', to: `0.${i}.0` });
      }
      const rows = await listRecent(d1);
      expect(rows.length).toBe(20);
    });
  });

  describe('ULID uniqueness', () => {
    it('generates distinct IDs even back-to-back', async () => {
      const id1 = await createSnapshot(d1, { from: '0.5.0', to: '0.6.0' });
      const id2 = await createSnapshot(d1, { from: '0.5.0', to: '0.6.0' });
      expect(id1).not.toBe(id2);
    });
  });
});
