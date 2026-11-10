import type { ReleaseEntry } from './types.js';
type ReleaseChecksums = Pick<ReleaseEntry, 'worker_hash' | 'worker_identity_hash' | 'admin_hash' | 'liff_hash' | 'bundle_hash'>;

export function validateReleaseChecksums(release: ReleaseChecksums): void {
  const valid = (value: unknown) => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
  if (release.worker_identity_hash !== undefined && (!valid(release.worker_identity_hash) || !valid(release.worker_hash))) {
    throw new Error('Invalid separated Worker identity/artifact checksum');
  }
  if (release.bundle_hash !== undefined && (!valid(release.bundle_hash) || !valid(release.worker_hash))) throw new Error('Invalid release archive checksum');
}

