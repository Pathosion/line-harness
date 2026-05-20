import { describe, it, expect } from 'vitest';
import { detectFork } from '../src/fork-detect.js';
import type { CurrentVersion, Manifest, ReleaseEntry } from '../src/types.js';

const release = (overrides: Partial<ReleaseEntry> = {}): ReleaseEntry => ({
  version: '0.8.0',
  released_at: '2026-05-10T00:00:00Z',
  worker_hash: 'sha256:worker-0.8.0',
  admin_hash: 'sha256:admin-0.8.0',
  liff_hash: 'sha256:liff-0.8.0',
  bundle_url: 'https://example.com/bundles/0.8.0.tar.gz',
  bundle_size_bytes: 12345,
  required_secrets: ['LINE_CHANNEL_ACCESS_TOKEN'],
  new_required_secrets: [],
  migrations: [],
  changelog_url: 'https://example.com/changelog#0.8.0',
  min_from_version: '0.7.0',
  ...overrides,
});

const manifest: Manifest = {
  schema_version: 1,
  latest: '0.8.0',
  releases: [
    release({
      version: '0.7.0',
      worker_hash: 'sha256:worker-0.7.0',
      admin_hash: 'sha256:admin-0.7.0',
      liff_hash: 'sha256:liff-0.7.0',
      bundle_url: 'https://example.com/bundles/0.7.0.tar.gz',
      changelog_url: 'https://example.com/changelog#0.7.0',
      min_from_version: '0.6.0',
    }),
    release({ version: '0.8.0' }),
  ],
};

const vanillaCurrent = (version: string): CurrentVersion => {
  const r = manifest.releases.find((x) => x.version === version);
  if (!r) throw new Error(`fixture missing release ${version}`);
  return {
    version: r.version,
    worker_hash: r.worker_hash,
    admin_hash: r.admin_hash,
    liff_hash: r.liff_hash,
  };
};

describe('detectFork', () => {
  it('returns vanilla when all 3 hashes match the latest release', () => {
    const status = detectFork(vanillaCurrent('0.8.0'), manifest);
    expect(status.kind).toBe('vanilla');
    if (status.kind === 'vanilla') {
      expect(status.matchedRelease.version).toBe('0.8.0');
    }
  });

  it('returns vanilla when matching an older release (not just latest)', () => {
    const status = detectFork(vanillaCurrent('0.7.0'), manifest);
    expect(status.kind).toBe('vanilla');
    if (status.kind === 'vanilla') {
      expect(status.matchedRelease.version).toBe('0.7.0');
    }
  });

  it('returns fork when worker hash mismatches', () => {
    const current: CurrentVersion = {
      ...vanillaCurrent('0.8.0'),
      worker_hash: 'sha256:worker-tampered',
    };
    const status = detectFork(current, manifest);
    expect(status.kind).toBe('fork');
    if (status.kind === 'fork') {
      expect(status.reason).toMatch(/worker/i);
    }
  });

  it('returns fork when admin hash mismatches', () => {
    const current: CurrentVersion = {
      ...vanillaCurrent('0.8.0'),
      admin_hash: 'sha256:admin-tampered',
    };
    const status = detectFork(current, manifest);
    expect(status.kind).toBe('fork');
    if (status.kind === 'fork') {
      expect(status.reason).toMatch(/admin/i);
    }
  });

  it('returns fork when liff hash mismatches', () => {
    const current: CurrentVersion = {
      ...vanillaCurrent('0.8.0'),
      liff_hash: 'sha256:liff-tampered',
    };
    const status = detectFork(current, manifest);
    expect(status.kind).toBe('fork');
    if (status.kind === 'fork') {
      expect(status.reason).toMatch(/liff/i);
    }
  });

  it('returns fork when version is unknown to manifest', () => {
    const current: CurrentVersion = {
      version: '9.9.9',
      worker_hash: 'sha256:worker-9.9.9',
      admin_hash: 'sha256:admin-9.9.9',
      liff_hash: 'sha256:liff-9.9.9',
    };
    const status = detectFork(current, manifest);
    expect(status.kind).toBe('fork');
    if (status.kind === 'fork') {
      expect(status.reason).toMatch(/version|unknown/i);
    }
  });

  it('reports only the highest-priority mismatch (worker > admin > liff) when multiple differ', () => {
    const current: CurrentVersion = {
      ...vanillaCurrent('0.8.0'),
      worker_hash: 'sha256:worker-tampered',
      admin_hash: 'sha256:admin-tampered',
    };
    const status = detectFork(current, manifest);
    expect(status.kind).toBe('fork');
    if (status.kind === 'fork') {
      expect(status.reason).toMatch(/worker/i);
      expect(status.reason).not.toMatch(/admin/i);
    }
  });
});
