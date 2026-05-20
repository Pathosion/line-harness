import { findRelease } from './manifest.js';
import type { CurrentVersion, ForkStatus, Manifest } from './types.js';

/**
 * Detect whether the currently-deployed harness is a vanilla build (i.e. it
 * matches a known release in the manifest by version AND all three component
 * hashes) or a fork (any deviation from the manifest).
 *
 * Hashes are compared in priority order `worker > admin > liff` so the caller
 * gets a single, deterministic reason string instead of a list of mismatches.
 * Worker is highest priority because a worker fork is the riskiest to update
 * automatically (it owns DB writes and webhook routing).
 */
export function detectFork(
  current: CurrentVersion,
  manifest: Manifest,
): ForkStatus {
  const matched = findRelease(manifest, current.version);
  if (!matched) {
    return {
      kind: 'fork',
      reason: `unknown version ${current.version} — not in manifest`,
    };
  }

  if (current.worker_hash !== matched.worker_hash) {
    return { kind: 'fork', reason: 'worker hash mismatch (custom build)' };
  }
  if (current.admin_hash !== matched.admin_hash) {
    return { kind: 'fork', reason: 'admin hash mismatch (custom build)' };
  }
  if (current.liff_hash !== matched.liff_hash) {
    return { kind: 'fork', reason: 'liff hash mismatch (custom build)' };
  }

  return { kind: 'vanilla', matchedRelease: matched };
}
