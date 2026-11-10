export interface ReleaseEntry {
  version: string;
  released_at: string;
  /** SHA256 of the exact packaged worker/index.js bytes. */
  worker_hash: string;
  /** Embedded build identity; omitted by legacy manifests. */
  worker_identity_hash?: string;
  /** SHA256 of the complete compressed release archive, when available. */
  bundle_hash?: string;
  admin_hash: string;
  liff_hash: string;
  bundle_url: string;
  bundle_size_bytes: number;
  required_secrets: string[];
  new_required_secrets: string[];
  migrations: string[];
  changelog_url: string;
  min_from_version: string;
}

export interface Manifest {
  schema_version: 1;
  latest: string;
  releases: ReleaseEntry[];
}

export interface CurrentVersion {
  version: string;
  worker_hash: string;
  admin_hash: string;
  liff_hash: string;
}

export type ForkStatus =
  | { kind: 'vanilla'; matchedRelease: ReleaseEntry }
  | { kind: 'fork'; reason: string };

export interface UpdateEvent {
  step:
    | 'preflight'
    | 'migration'
    | 'worker'
    | 'admin'
    | 'liff'
    | 'verify'
    | 'rollback'
    | 'complete';
  status: 'pending' | 'running' | 'done' | 'failed';
  name?: string;
  hash?: string;
  deployment_id?: string;
  error?: string;
  rolling_back?: boolean;
  new_version?: string;
  reverted_to?: string;
}

export interface CfApiCreds {
  accountId: string;
  apiToken: string;
}

export interface UpdateContext {
  creds: CfApiCreds;
  workerName: string;
  adminPagesProject: string;
  liffPagesProject: string;
  d1DatabaseId: string;
  current: CurrentVersion;
  target: ReleaseEntry;
  manifestUrl: string;
  bundleStoragePath?: string;
}
