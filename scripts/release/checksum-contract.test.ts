import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync, createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { injectVersion } from '../../apps/worker/scripts/inject-version.js';
import { buildBundle } from './build-bundle.js';
import { parseAndVerifyReleaseBundle } from '../../packages/update-engine/src/bundle.js';
import { detectFork } from '../../packages/update-engine/src/fork-detect.js';
import { runRollback } from '../../packages/update-engine/src/phases/rollback.js';
import type { ReleaseEntry, CurrentVersion } from '../../packages/update-engine/src/types.js';
import { workerGuardResponse } from '../../packages/update-engine/test/worker-guard-fixture.js';

const require = createRequire(import.meta.url);
const { build } = createRequire(realpathSync(require.resolve('tsx/package.json')))('esbuild');
const hash = (bytes: Buffer) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

async function artifact() {
  const dir = mkdtempSync(join(tmpdir(), 'line-checksum-contract-'));
  const versionPath = join(dir, '_version.ts');
  const version = { version: '0.8.0', workerHash: 'sha256:' + '0'.repeat(64), adminHash: '', liffHash: '', releasedAt: '2026-11-10T00:00:00Z' };
  for (const folder of ['admin', 'liff', 'migrations']) mkdirSync(join(dir, folder));
  writeFileSync(join(dir, 'admin/index.html'), '<html>admin</html>');
  writeFileSync(join(dir, 'liff/index.html'), '<html>liff</html>');
  version.adminHash = injectVersion.hashDirectory(join(dir, 'admin'));
  version.liffHash = injectVersion.hashDirectory(join(dir, 'liff'));
  injectVersion.write(versionPath, version);
  const compile = async () => Buffer.from((await build({ stdin: { contents: `import * as version from ${JSON.stringify(versionPath)};export default {fetch(){return new Response(JSON.stringify(version))}}`, sourcefile: 'worker.ts', resolveDir: dir }, bundle: true, write: false, platform: 'browser', format: 'esm' })).outputFiles[0].contents);
  const first = await compile(), identity = hash(first);
  injectVersion.write(versionPath, { ...version, workerHash: identity });
  const shipped = await compile(), workerPath = join(dir, 'worker.js'), tarball = join(dir, 'bundle.tar.gz');
  writeFileSync(workerPath, shipped);
  buildBundle({ workerJs: workerPath, adminDir: join(dir, 'admin'), liffDir: join(dir, 'liff'), migrationsDir: join(dir, 'migrations'), outPath: tarball });
  const release: ReleaseEntry = { version: version.version, released_at: version.releasedAt, worker_hash: hash(shipped), worker_identity_hash: identity, bundle_hash: hash(readFileSync(tarball)), admin_hash: version.adminHash, liff_hash: version.liffHash, bundle_url: 'https://example.test/bundle.tar.gz', bundle_size_bytes: readFileSync(tarball).length, required_secrets: [], new_required_secrets: [], migrations: [], changelog_url: '', min_from_version: '0.0.0' };
  const current: CurrentVersion = { version: release.version, worker_hash: identity, admin_hash: release.admin_hash, liff_hash: release.liff_hash };
  return { dir, first, shipped, tarball, release, current };
}

describe('producer to consumer release checksum contract', () => {
  it('separates the embedded first-build identity from the final archive and Worker checksums', async () => {
    const f = await artifact();
    try {
      expect(f.release.worker_hash).not.toBe(f.release.worker_identity_hash);
      expect(f.shipped.toString()).toContain(f.release.worker_identity_hash);
      expect(f.shipped.toString()).not.toContain(f.release.worker_hash);
      const bundle = await parseAndVerifyReleaseBundle(createReadStream(f.tarball), f.release);
      expect(bundle.workerJs.equals(f.shipped)).toBe(true);
      expect(detectFork(f.current, { schema_version: 1, latest: f.release.version, releases: [f.release] }).kind).toBe('vanilla');
      await expect(parseAndVerifyReleaseBundle(createReadStream(f.tarball), { ...f.release, worker_hash: hash(f.first) })).rejects.toThrow(/worker hash mismatch/);
      await expect(parseAndVerifyReleaseBundle(createReadStream(f.tarball), { ...f.release, bundle_hash: 'sha256:' + 'f'.repeat(64) })).rejects.toThrow(/archive hash mismatch/);
    } finally { rmSync(f.dir, { recursive: true, force: true }); }
  });

  it('accepts a historical identity-only Worker hash only when the exact full archive is independently sealed', async () => {
    const f = await artifact();
    try {
      const legacy = { ...f.release, worker_hash: f.current.worker_hash }; delete legacy.worker_identity_hash;
      expect((await parseAndVerifyReleaseBundle(createReadStream(f.tarball), legacy)).workerJs.equals(f.shipped)).toBe(true);
      const unsealed = { ...legacy }; delete unsealed.bundle_hash;
      await expect(parseAndVerifyReleaseBundle(createReadStream(f.tarball), unsealed)).rejects.toThrow(/worker hash mismatch/);
      await expect(parseAndVerifyReleaseBundle(createReadStream(f.tarball), { ...legacy, admin_hash: 'sha256:' + '0'.repeat(64) })).rejects.toThrow(/admin hash mismatch/);
    } finally { rmSync(f.dir, { recursive: true, force: true }); }
  });

  it('rolls back archive and raw snapshots using the trusted release checksum rather than its embedded identity', async () => {
    const f = await artifact(); const originalFetch = globalThis.fetch;
    const uploads: Buffer[] = []; let source = readFileSync(f.tarball);
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const guard = workerGuardResponse(url); if (guard) return guard;
      if (url === f.release.bundle_url) return new Response(source);
      if (url.endsWith('/bindings')) return Response.json({ result: [] });
      if (url.endsWith('/settings')) return Response.json({ result: { compatibility_date: '2024-12-01', compatibility_flags: ['nodejs_compat'], bindings: [] } });
      if (init?.method === 'PUT') { uploads.push(Buffer.from(await ((init.body as FormData).get('worker.js') as Blob).arrayBuffer())); return Response.json({ success: true }); }
      if (url.endsWith('/rollback')) return Response.json({ success: true });
      throw new Error('Unexpected request ' + url);
    }) as typeof fetch;
    const ctx = { creds: { accountId: 'a', apiToken: 'synthetic' }, workerName: 'w', adminPagesProject: 'admin', liffPagesProject: 'liff', d1DatabaseId: 'd', current: f.current, target: f.release, manifestUrl: '' };
    const snap = { snapshotWorkerBundleUrl: f.release.bundle_url, snapshotAdminDeployment: 'admin', snapshotLiffDeployment: 'liff', release: f.release };
    try {
      await runRollback(ctx, snap, { emit: async () => {} });
      source = f.shipped;
      await runRollback(ctx, snap, { emit: async () => {} });
      expect(uploads).toHaveLength(2); expect(uploads.every(bytes => bytes.equals(f.shipped))).toBe(true);
      const legacy = { ...f.release, worker_hash: f.current.worker_hash }; delete legacy.worker_identity_hash;
      await expect(runRollback(ctx, { ...snap, release: legacy }, { emit: async () => {} })).rejects.toThrow(/hash mismatch/);
      expect(uploads).toHaveLength(2);
    } finally { globalThis.fetch = originalFetch; rmSync(f.dir, { recursive: true, force: true }); }
  });
});
