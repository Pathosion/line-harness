# Release integrity and safe Worker inheritance

The release producer and both consumers (CLI update and Worker self-update)
use three distinct checksums. The manifest remains schema version 1; new fields
are optional so historical entries can still be read.

| Manifest field | Meaning | Check |
| --- | --- | --- |
| `worker_identity_hash` | First-pass Worker hash embedded as `WORKER_HASH` in the second build | Compare with `/admin/version` for fork detection; never use as proof of final artifact bytes |
| `worker_hash` | SHA-256 of the final `worker/index.js` shipped in the archive | Compare with extracted Worker bytes before upload |
| `bundle_hash` | SHA-256 of the exact compressed `bundle.tar.gz` | Compare before any component is deployed or migration executed |
| `admin_hash`, `liff_hash` | Sorted path/content hashes of the shipped UI files | Compare with extracted UI files |

The producer builds Worker once, computes its identity, embeds that identity,
builds again, packages the final output, then computes the Worker and archive
checksums. It never embeds the final raw checksum back into the Worker: doing so
would introduce a self-referential hash. Archive creation suppresses macOS
AppleDouble metadata so the UI file set matches the producer's directory hashes.

The running Worker's existing `worker_hash` response field continues to report
`WORKER_HASH` (identity). Fork detection compares it with the manifest's
`worker_identity_hash`, falling back to `worker_hash` for historical manifests.
The self-update route also passes the trusted current manifest entry to rollback,
so the runtime identity is not mistaken for a raw artifact checksum.

## Historical archives and repair

Old two-pass releases put their first-pass identity in `worker_hash`, even though
the shipped second-pass Worker has different bytes. Such an archive is accepted
only if its **entire compressed archive** matches an independently trusted
manifest `bundle_hash`. The old `worker_hash` then acts only as its identity; UI
hashes must still match. A new entry with `worker_identity_hash` always requires
the final raw `worker_hash` too, even when its archive hash matches.

Historical entries without a trusted archive checksum retain strict raw Worker
validation. The old two-pass mismatch therefore fails closed. Downloading an
unverified archive and copying its checksum into the manifest does not establish
trust. A repair requires the release owner to establish exact archive provenance
from retained trusted CI artifacts or another independently authenticated release
record, then review a manifest-only addition of that exact `bundle_hash`. Keep
the old identity in `worker_hash` and omit `worker_identity_hash` for this limited
compatibility mode. If exact bytes cannot be authenticated, use a newly produced
and verified release through the normal reviewed deployment procedure. This
change does not alter or republish historical release assets.

Raw Worker snapshots cannot use the whole-archive exception. Rollback requires a
trusted final raw checksum, supplied through `currentRelease.worker_hash`, plus
the matching current identity. Callers without `currentRelease` retain the strict
legacy raw comparison with `current.worker_hash`; a first-pass identity will fail.
`getWorkerScriptContent` is only a source-download helper; it does not persist a
snapshot or create a trusted raw checksum. Existing callers must not treat the
runtime identity as a recorded snapshot checksum.

## Inherited bindings and assets

Cloudflare's legacy script PUT inherits bindings and assets from the latest
uploaded version, which may be an undeployed draft. `bindings_inherit=strict`
only checks name resolution. Before reading settings, and again immediately
before PUT, the updater therefore requires:

1. The latest upload and active deployment can both be read.
2. Exactly one version receives 100% of the active deployment's traffic.
3. That version equals the latest uploaded version.
4. The version and deployment remain unchanged across the settings read.

Unknown responses, drafts ahead of production, split deployments and observed
concurrent changes stop before PUT. Secrets are inherited by binding name; their
values are not fetched. Existing compatibility flags, supported nonsecret
settings and assets are preserved; `nodejs_compat` is retained/added as required
by the updater.

Operate updates in an exclusive upload/release window. Cloudflare's legacy PUT
has no conditional version parameter: these reads cannot atomically exclude an
unrelated upload between the final check and PUT. Resolve an existing draft by
the release owner's normal deployment procedure before retrying; the updater
does not deploy or delete that draft automatically.

Cloudflare documents the inheritance boundary in [inherit binding errors](https://developers.cloudflare.com/workers/observability/errors/#inherit-binding-errors-10057),
and the identity reads in the [version list API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/list/)
and [deployment list API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/).
