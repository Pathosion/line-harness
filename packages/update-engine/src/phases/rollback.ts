import type { UpdateContext } from '../types.js';
import type { EventEmitter } from '../events.js';
import { listWorkerBindings, putWorkerScript } from '../cf-api/workers.js';
import { rollbackPagesDeployment } from '../cf-api/pages.js';

/**
 * Snapshot fields required to roll back a partially-applied update.
 *
 * The orchestrator captures these BEFORE doing anything destructive — they
 * are the "known-good" coordinates we revert to if Apply or Verify fails.
 */
export interface RollbackSnapshot {
  /** Fully-qualified URL where the previous Worker bundle bytes can be fetched (e.g. R2 signed URL). */
  snapshotWorkerBundleUrl: string;
  /** CF Pages deployment id to revert the admin project to. */
  snapshotAdminDeployment: string;
  /** CF Pages deployment id to revert the liff project to. */
  snapshotLiffDeployment: string;
}

async function readBodyExcerpt(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.length > 500 ? text.slice(0, 500) + '…' : text;
  } catch {
    return '';
  }
}

/**
 * Phase 3 — Rollback.
 *
 * Re-runs the deploy steps in reverse semantic order using the snapshot
 * captured by the orchestrator BEFORE the failed update:
 *
 *   1. Fetch the previous Worker bundle bytes from `snapshotWorkerBundleUrl`.
 *   2. List the Worker's current bindings — CF wipes bindings on every PUT,
 *      so we re-attach them. Even though the new Worker may have crashed,
 *      its bindings are the customer's source of truth (they aren't part
 *      of the bundle — they're env wiring).
 *   3. PUT the old Worker bundle with the preserved bindings.
 *   4. Roll back the admin Pages project to its previous deployment id.
 *   5. Roll back the liff Pages project to its previous deployment id.
 *
 * **D1 migrations are NOT rolled back.** The harness contract is
 * additive-only migrations (new tables/columns), so the old Worker
 * continues to function against the new-but-superset schema. Reverting
 * schema would risk losing rows that were written after the migration
 * succeeded but before Apply failed downstream.
 *
 * Steps run sequentially with no retry — if any step throws, the error
 * propagates and the orchestrator records both the original failure and
 * the rollback failure. We intentionally do NOT swallow errors here so
 * the operator can see exactly which step left the system in a degraded
 * state.
 */
export async function runRollback(
  ctx: UpdateContext,
  snap: RollbackSnapshot,
  ev: EventEmitter,
): Promise<void> {
  await ev.emit({ step: 'rollback', status: 'running' });

  // Step 1: fetch the previous Worker bundle. A non-200 means the snapshot
  // URL is gone (R2 lifecycle? signed URL expired?) and we cannot proceed
  // — rolling back to nothing would brick the Worker.
  const res = await fetch(snap.snapshotWorkerBundleUrl);
  if (!res.ok) {
    const excerpt = await readBodyExcerpt(res);
    throw new Error(
      `rollback: failed to fetch snapshot worker bundle from ${snap.snapshotWorkerBundleUrl}: HTTP ${res.status} ${excerpt}`,
    );
  }
  const bytes = Buffer.from(await res.arrayBuffer());

  // Step 2 + 3: re-PUT the old worker with current bindings preserved.
  // listWorkerBindings reads the live state — even mid-rollback this is
  // what the customer expects to keep (D1/R2/KV ids, secrets, env vars).
  const bindings = await listWorkerBindings({
    creds: ctx.creds,
    scriptName: ctx.workerName,
  });
  await putWorkerScript({
    creds: ctx.creds,
    scriptName: ctx.workerName,
    scriptContent: bytes,
    bindings,
  });

  // Step 4: admin Pages rollback. Done before liff so a failure here
  // surfaces before we touch the customer-facing UI, leaving liff still
  // on the new (possibly-broken) version for now — but admin is internal
  // so that's a smaller blast radius than leaving the operator without
  // a console.
  await rollbackPagesDeployment({
    creds: ctx.creds,
    projectName: ctx.adminPagesProject,
    deploymentId: snap.snapshotAdminDeployment,
  });

  // Step 5: liff Pages rollback. Customer-facing, done last so the swap
  // back happens only after the admin console is already on the old
  // version.
  await rollbackPagesDeployment({
    creds: ctx.creds,
    projectName: ctx.liffPagesProject,
    deploymentId: snap.snapshotLiffDeployment,
  });

  await ev.emit({ step: 'rollback', status: 'done' });
}
