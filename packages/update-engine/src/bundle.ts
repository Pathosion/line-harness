/**
 * Bundle parser + hash verifier.
 *
 * Reads a release bundle (`bundle.tar.gz`) produced by the build pipeline and
 * splits it into worker / admin / liff / migrations buckets. Computes hashes
 * for the shipped bytes. Worker artifact integrity uses its final raw checksum;
 * fork detection separately uses the first-pass identity embedded by
 * `apps/worker/scripts/inject-version.ts`.
 *
 * Phase 2: Node-only (uses `node:zlib` + `tar-stream`). A Workers-runtime
 * variant lands in Phase 5.
 */

import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { Transform, type Readable } from 'node:stream';
import { extract as tarExtract } from 'tar-stream';
import type { ReleaseEntry } from './types.js';
import { validateReleaseChecksums } from './release-checksums.js';

export interface ParsedBundle {
  workerJs: Buffer;
  /** path relative to admin/ → content */
  adminFiles: Map<string, Buffer>;
  /** path relative to liff/ → content */
  liffFiles: Map<string, Buffer>;
  /** filename → SQL content */
  migrations: Map<string, Buffer>;
}

export interface BundleHashes {
  worker: string;
  admin: string;
  liff: string;
}

/**
 * Parse a gzipped tarball stream into a {@link ParsedBundle}.
 *
 * Routing:
 *   - `worker/index.js`     → result.workerJs
 *   - `admin/<rest>`        → result.adminFiles.set(<rest>, buf)
 *   - `liff/<rest>`         → result.liffFiles.set(<rest>, buf)
 *   - `migrations/<rest>`   → result.migrations.set(<rest>, buf)
 *   - anything else         → ignored (directory entries, hidden files)
 *
 * Resolves when the tar stream finishes; rejects on any underlying error.
 */
export function parseBundleStream(input: Readable): Promise<ParsedBundle> {
  return new Promise<ParsedBundle>((resolve, reject) => {
    const result: ParsedBundle = {
      workerJs: Buffer.alloc(0),
      adminFiles: new Map(),
      liffFiles: new Map(),
      migrations: new Map(),
    };

    const gunzip = createGunzip();
    const extract = tarExtract();

    let settled = false;
    const fail = (err: Error): void => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const done = (): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    extract.on('entry', (header, stream, next) => {
      // Only regular files contribute content. Directory headers, symlinks,
      // hardlinks etc. are skipped (their content stream is empty but we still
      // need to drain it so tar-stream advances to the next entry).
      if (header.type !== 'file') {
        stream.on('end', next);
        stream.resume();
        return;
      }

      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => {
        const buf = Buffer.concat(chunks);
        routeEntry(result, header.name, buf);
        next();
      });
      stream.on('error', (err) => fail(err));
    });

    extract.on('finish', done);
    extract.on('error', fail);
    gunzip.on('error', fail);
    input.on('error', fail);

    input.pipe(gunzip).pipe(extract);
  });
}

function routeEntry(result: ParsedBundle, name: string, buf: Buffer): void {
  // tar entries always use forward slashes (POSIX path semantics in the
  // archive format itself), matching inject-version.ts's normalization step.
  // Strip a leading `./` if present so prefixes match cleanly.
  const cleaned = name.startsWith('./') ? name.slice(2) : name;

  if (cleaned === 'worker/index.js') {
    result.workerJs = buf;
    return;
  }

  const adminPrefix = 'admin/';
  if (cleaned.startsWith(adminPrefix)) {
    const rest = cleaned.slice(adminPrefix.length);
    if (rest.length > 0 && !rest.endsWith('/')) {
      result.adminFiles.set(rest, buf);
    }
    return;
  }

  const liffPrefix = 'liff/';
  if (cleaned.startsWith(liffPrefix)) {
    const rest = cleaned.slice(liffPrefix.length);
    if (rest.length > 0 && !rest.endsWith('/')) {
      result.liffFiles.set(rest, buf);
    }
    return;
  }

  const migPrefix = 'migrations/';
  if (cleaned.startsWith(migPrefix)) {
    const rest = cleaned.slice(migPrefix.length);
    if (rest.length > 0 && !rest.endsWith('/')) {
      result.migrations.set(rest, buf);
    }
    return;
  }

  // Anything else (e.g. tarball-level metadata, future buckets) is ignored.
}

type ReleaseChecksums = Pick<ReleaseEntry, 'worker_hash' | 'worker_identity_hash' | 'admin_hash' | 'liff_hash' | 'bundle_hash'>;

/** Validate exact archive bytes before any component is allowed to execute. */
export async function parseAndVerifyReleaseBundle(input: Readable, expected: ReleaseChecksums): Promise<ParsedBundle> {
  validateReleaseChecksums(expected);
  const hash = createHash('sha256');
  const observed = new Transform({ transform(chunk, _encoding, next) { hash.update(chunk); next(null, chunk); } });
  const onError = (error: Error) => observed.destroy(error);
  input.on('error', onError);
  try {
    const bundle = await parseBundleStream(input.pipe(observed));
    const archiveHash = `sha256:${hash.digest('hex')}`;
    if (expected.bundle_hash !== undefined && archiveHash !== expected.bundle_hash) throw new Error('release archive hash mismatch');
    const components = verifyBundleHashes(bundle);
    // Historical two-pass releases embedded their first-pass identity in the
    // worker_hash field. Only a trusted, exact whole-archive checksum can seal
    // those old bytes; an unsealed identity mismatch is never relaxed.
    if (expected.worker_identity_hash === undefined && expected.bundle_hash === archiveHash) {
      assertUiHashesMatch(components, expected);
    } else {
      assertHashesMatch(components, expected);
    }
    if (!bundle.workerJs.length) throw new Error('Release archive has no Worker entry point');
    return bundle;
  } catch (error) {
    input.destroy(); observed.destroy(); throw error;
  } finally { input.off('error', onError); }
}

/**
 * Compute the canonical hashes for a parsed bundle.
 *
 * **Hash algorithm must stay byte-compatible with `inject-version.ts`** in
 * `apps/worker/scripts/`:
 *   - worker → `sha256:` + SHA256 of the raw worker bundle bytes
 *   - admin/liff → `sha256:` + SHA256 of `{key}\0{content}\0` for every entry,
 *                   keys sorted lexicographically (forward-slash separator).
 *
 * The same raw hash algorithm produces two different Worker values: the first
 * pass becomes its self-reported identity, the final pass seals shipped bytes.
 */
export function verifyBundleHashes(b: ParsedBundle): BundleHashes {
  return {
    worker: hashBuffer(b.workerJs),
    admin: hashContentMap(b.adminFiles),
    liff: hashContentMap(b.liffFiles),
  };
}

function hashBuffer(buf: Buffer): string {
  return `sha256:${createHash('sha256').update(buf).digest('hex')}`;
}

function hashContentMap(map: Map<string, Buffer>): string {
  const keys = Array.from(map.keys()).sort();
  const hash = createHash('sha256');
  const NUL = Buffer.from([0]);
  for (const key of keys) {
    hash.update(Buffer.from(key, 'utf8'));
    hash.update(NUL);
    // map.get cannot return undefined here because `key` came from map.keys().
    hash.update(map.get(key) as Buffer);
    hash.update(NUL);
  }
  return `sha256:${hash.digest('hex')}`;
}

/**
 * Compare a parsed bundle's computed hashes against the manifest's declared
 * hashes. Throws a descriptive error on mismatch; returns `undefined` when all
 * three match.
 *
 * The worker error embeds both hex hashes so operators can quickly identify
 * whether the bundle was tampered with (e.g. CDN replaced the artifact) or
 * the manifest itself drifted.
 */
export function assertHashesMatch(
  computed: BundleHashes,
  expected: { worker_hash: string; admin_hash: string; liff_hash: string },
): void {
  if (computed.worker !== expected.worker_hash) {
    throw new Error(
      `bundle worker hash mismatch (tampered? ${computed.worker} vs ${expected.worker_hash})`,
    );
  }
  assertUiHashesMatch(computed, expected);
}

function assertUiHashesMatch(computed: BundleHashes, expected: { admin_hash: string; liff_hash: string }): void {
  if (computed.admin !== expected.admin_hash) {
    throw new Error('bundle admin hash mismatch');
  }
  if (computed.liff !== expected.liff_hash) {
    throw new Error('bundle liff hash mismatch');
  }
}
