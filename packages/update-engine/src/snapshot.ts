import type { UpdateEvent } from './types.js';

/**
 * Minimal subset of the Cloudflare D1Database interface that the snapshot CRUD
 * functions rely on. Defined locally so this package does not need to depend on
 * `@cloudflare/workers-types`. A test adapter wraps better-sqlite3 to satisfy
 * the same shape — see `test/snapshot.test.ts`.
 */
export interface D1Like {
  prepare(sql: string): {
    bind(...args: any[]): {
      run(): Promise<unknown>;
      first<T = any>(): Promise<T | null>;
      all<T = any>(): Promise<{ results: T[] }>;
    };
  };
}

export interface SnapshotRow {
  id: string;
  started_at: number;
  completed_at: number | null;
  from_version: string;
  to_version: string;
  status: 'running' | 'success' | 'failed' | 'rolled_back';
  snapshot_worker_url: string | null;
  snapshot_admin_deployment: string | null;
  snapshot_liff_deployment: string | null;
  events_jsonl: string;
  error: string | null;
  rollback_of: string | null;
  rollback_expires_at: number | null;
}

const ROLLBACK_WINDOW_MS = 7 * 86400 * 1000;
const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Generates a ULID-like ID: 10-char timestamp prefix (base32-ish, padded) +
 * 16 chars of randomness from a Crockford-style alphabet. The timestamp prefix
 * keeps IDs roughly sortable by creation time; the random suffix makes
 * collisions astronomically unlikely even when two snapshots are created in
 * the same millisecond.
 *
 * Uses `Math.random` rather than crypto for portability across both
 * Cloudflare Workers and Node test environments; this is a write-side ID not a
 * security secret.
 */
function ulid(): string {
  const t = Date.now().toString(36).toUpperCase().padStart(10, '0');
  const r = Array.from({ length: 16 }, () =>
    CROCKFORD_BASE32[Math.floor(Math.random() * 32)],
  ).join('');
  return `${t}${r}`;
}

export async function createSnapshot(
  d1: D1Like,
  v: {
    from: string;
    to: string;
    snapshotWorkerUrl?: string;
    snapshotAdminDeployment?: string;
    snapshotLiffDeployment?: string;
  },
): Promise<string> {
  const id = ulid();
  const now = Date.now();
  const rollbackExpiresAt = now + ROLLBACK_WINDOW_MS;
  await d1
    .prepare(
      `INSERT INTO update_history (
         id, started_at, completed_at, from_version, to_version, status,
         snapshot_worker_url, snapshot_admin_deployment, snapshot_liff_deployment,
         events_jsonl, error, rollback_of, rollback_expires_at
       ) VALUES (?, ?, NULL, ?, ?, 'running', ?, ?, ?, '', NULL, NULL, ?)`,
    )
    .bind(
      id,
      now,
      v.from,
      v.to,
      v.snapshotWorkerUrl ?? null,
      v.snapshotAdminDeployment ?? null,
      v.snapshotLiffDeployment ?? null,
      rollbackExpiresAt,
    )
    .run();
  return id;
}

export async function getSnapshot(
  d1: D1Like,
  id: string,
): Promise<SnapshotRow | null> {
  const row = await d1
    .prepare('SELECT * FROM update_history WHERE id = ?')
    .bind(id)
    .first<SnapshotRow>();
  return row ?? null;
}

export async function updateStatus(
  d1: D1Like,
  id: string,
  status: SnapshotRow['status'],
): Promise<void> {
  // `running` keeps completed_at NULL; any terminal state stamps it.
  const completedAt = status === 'running' ? null : Date.now();
  await d1
    .prepare(
      'UPDATE update_history SET status = ?, completed_at = ? WHERE id = ?',
    )
    .bind(status, completedAt, id)
    .run();
}

export async function appendEvent(
  d1: D1Like,
  id: string,
  ev: UpdateEvent,
): Promise<void> {
  // Append "<json>\n" to events_jsonl in-database so concurrent appends don't
  // race against a read-modify-write cycle in app code. `char(10)` is portable
  // across D1 (SQLite) and better-sqlite3.
  await d1
    .prepare(
      "UPDATE update_history SET events_jsonl = events_jsonl || ? || char(10) WHERE id = ?",
    )
    .bind(JSON.stringify(ev), id)
    .run();
}

export async function setError(
  d1: D1Like,
  id: string,
  error: string,
): Promise<void> {
  await d1
    .prepare('UPDATE update_history SET error = ? WHERE id = ?')
    .bind(error, id)
    .run();
}

export async function listRecent(
  d1: D1Like,
  limit = 20,
): Promise<SnapshotRow[]> {
  const result = await d1
    .prepare(
      'SELECT * FROM update_history ORDER BY started_at DESC LIMIT ?',
    )
    .bind(limit)
    .all<SnapshotRow>();
  return result.results;
}
