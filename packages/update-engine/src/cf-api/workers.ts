import type { CfApiCreds } from '../types.js';
import { authHeader, throwHttpError, workersApiBase } from './_shared.js';

/**
 * Cloudflare Workers binding shape used by the Workers Scripts API.
 *
 * These are the binding hints used by existing callers. The settings reader
 * records every deployed binding by identity and the uploader inherits it,
 * including opaque resource types and redacted secrets, without round-tripping
 * their values.
 */
export interface WorkerBinding {
  type: 'plain_text' | 'secret_text' | 'd1' | 'r2_bucket' | 'kv_namespace';
  name: string;
  database_id?: string;
  bucket_name?: string;
  namespace_id?: string;
  text?: string;
}

export interface WorkerSettings {
  compatibilityDate: string;
  compatibilityFlags: string[];
  bindings: { name: string; type: string }[];
  /** Nonsecret settings accepted unchanged by the script-upload API. */
  uploadMetadata: Record<string, unknown>;
}

/** Read configuration only; secret values are neither requested nor retained. */
export async function getWorkerSettings(opts: {
  creds: CfApiCreds;
  scriptName: string;
}): Promise<WorkerSettings> {
  const res = await fetch(`${workersApiBase(opts.creds.accountId)}/${opts.scriptName}/settings`, {
    headers: authHeader(opts.creds.apiToken),
  });
  if (!res.ok) await throwHttpError('GET worker settings failed', res);
  const body: unknown = await res.json();
  const result = isRecord(body) && isRecord(body.result) ? body.result : null;
  if (!result || typeof result.compatibility_date !== 'string'
      || !/^\d{4}-\d{2}-\d{2}$/.test(result.compatibility_date)
      || !Array.isArray(result.bindings)
      || (result.compatibility_flags !== undefined && (!Array.isArray(result.compatibility_flags)
        || !result.compatibility_flags.every((flag: unknown) => typeof flag === 'string')))) {
    throw new Error('Worker settings are missing or invalid; refusing to reset runtime configuration');
  }
  const bindings = result.bindings.map((binding: unknown) => {
    if (!isRecord(binding) || typeof binding.name !== 'string' || !binding.name
        || typeof binding.type !== 'string' || !binding.type) {
      throw new Error('Worker binding identity is invalid');
    }
    return { name: binding.name, type: binding.type };
  });
  if (new Set(bindings.map(binding => binding.name)).size !== bindings.length) {
    throw new Error('Worker binding names are duplicated');
  }
  const uploadMetadata: Record<string, unknown> = {};
  for (const key of ['usage_model', 'limits', 'placement', 'logpush', 'tail_consumers', 'observability', 'tags']) {
    if (result[key] !== undefined) uploadMetadata[key] = result[key];
  }
  return {
    compatibilityDate: result.compatibility_date,
    compatibilityFlags: (result.compatibility_flags ?? []) as string[],
    bindings,
    uploadMetadata,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Legacy script uploads inherit from latest upload, not necessarily production. */
export async function assertDeployedLatestWorker(opts: {
  creds: CfApiCreds;
  scriptName: string;
}): Promise<{ version: string; deployment: string }> {
  const base = `${workersApiBase(opts.creds.accountId)}/${opts.scriptName}`;
  const read = async (suffix: string): Promise<unknown> => {
    const response = await fetch(base + suffix, { headers: authHeader(opts.creds.apiToken), cache: 'no-store' });
    if (!response.ok) await throwHttpError('GET worker deployment identity failed', response);
    return response.json();
  };
  const [versions, deployments] = await Promise.all([read('/versions?per_page=1'), read('/deployments?per_page=1')]);
  const versionResult = isRecord(versions) && versions.success === true && isRecord(versions.result) ? versions.result : null;
  const deploymentResult = isRecord(deployments) && deployments.success === true && isRecord(deployments.result) ? deployments.result : null;
  const latest = Array.isArray(versionResult?.items) ? versionResult.items[0] : null;
  const active = Array.isArray(deploymentResult?.deployments) ? deploymentResult.deployments[0] : null;
  const traffic = isRecord(active) && Array.isArray(active.versions) ? active.versions : [];
  const only = traffic.length === 1 && isRecord(traffic[0]) ? traffic[0] : null;
  if (!isRecord(latest) || typeof latest.id !== 'string' || !latest.id
      || !isRecord(active) || typeof active.id !== 'string' || !active.id
      || active.strategy !== 'percentage' || !only || only.percentage !== 100
      || only.version_id !== latest.id) {
    throw new Error('Worker inheritance refused: require one 100% deployed version equal to the latest uploaded version');
  }
  return { version: latest.id, deployment: active.id };
}

/**
 * Replace an existing Worker script while preserving its runtime configuration.
 *
 * Uses the multipart/form-data ES module upload format: a `metadata` JSON
 * part describing the entrypoint and preserved runtime settings, and a
 * `worker.js` part with the script bytes. The script part's content-type
 * is `application/javascript+module`, which is what CF expects for
 * `main_module` uploads.
 *
 * Throws on non-2xx with a body excerpt so caller logs include the API's
 * error reason.
 */
export async function putWorkerScript(opts: {
  creds: CfApiCreds;
  scriptName: string;
  scriptContent: Buffer;
  bindings: WorkerBinding[];
  compatibilityDate?: string;
}): Promise<void> {
  const { creds, scriptName, scriptContent, bindings } = opts;
  const before = await assertDeployedLatestWorker({ creds, scriptName });
  const settings = await getWorkerSettings({ creds, scriptName });
  const currentNames = new Set(settings.bindings.map(binding => binding.name));
  if (bindings.some(binding => !currentNames.has(binding.name))) {
    throw new Error('Worker bindings changed before upload; retry from the current settings');
  }
  if (settings.compatibilityFlags.includes('no_nodejs_compat')) {
    throw new Error('Worker explicitly disables required nodejs_compat; refusing to change its runtime contract');
  }
  const metadata = {
    ...settings.uploadMetadata,
    main_module: 'worker.js',
    // Inherit every current binding by name, including redacted secrets and
    // binding types this updater cannot round-trip. Never fetch secret values.
    bindings: settings.bindings.map(binding => ({ name: binding.name, type: 'inherit' })),
    compatibility_date: opts.compatibilityDate ?? settings.compatibilityDate,
    compatibility_flags: [...new Set([...settings.compatibilityFlags, 'nodejs_compat'])],
    keep_assets: true,
  };

  const fd = new FormData();
  fd.set(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' }),
  );
  // Copy bytes into a fresh ArrayBuffer so Blob accepts them in both Node and
  // Workers runtimes. Slicing avoids the SharedArrayBuffer-vs-ArrayBuffer
  // type incompatibility on Node's Buffer.
  const ab = scriptContent.buffer.slice(
    scriptContent.byteOffset,
    scriptContent.byteOffset + scriptContent.byteLength,
  ) as ArrayBuffer;
  fd.set(
    'worker.js',
    new Blob([ab], { type: 'application/javascript+module' }),
    'worker.js',
  );

  const after = await assertDeployedLatestWorker({ creds, scriptName });
  if (before.version !== after.version || before.deployment !== after.deployment) {
    throw new Error('Worker deployment changed while preparing upload; no script was uploaded');
  }

  const res = await fetch(`${workersApiBase(creds.accountId)}/${scriptName}?bindings_inherit=strict`, {
    method: 'PUT',
    headers: authHeader(creds.apiToken),
    body: fd,
  });

  if (!res.ok) {
    await throwHttpError('PUT worker script failed', res);
  }
}

/**
 * Fetch the deployed Worker script source. Used to snapshot the current
 * Worker before applying an update so we can roll back if verify fails.
 */
export async function getWorkerScriptContent(opts: {
  creds: CfApiCreds;
  scriptName: string;
}): Promise<string> {
  const { creds, scriptName } = opts;
  const res = await fetch(`${workersApiBase(creds.accountId)}/${scriptName}`, {
    method: 'GET',
    headers: authHeader(creds.apiToken),
  });
  if (!res.ok) {
    await throwHttpError('GET worker script failed', res);
  }
  return res.text();
}

/**
 * List the current bindings on a deployed Worker. The update flow reads
 * these so it can re-attach the same D1/R2/KV/plain_text/secret_text
 * bindings when PUTting a new script — CF does not preserve bindings
 * across script uploads.
 */
export async function listWorkerBindings(opts: {
  creds: CfApiCreds;
  scriptName: string;
}): Promise<WorkerBinding[]> {
  const { creds, scriptName } = opts;
  const res = await fetch(
    `${workersApiBase(creds.accountId)}/${scriptName}/bindings`,
    {
      method: 'GET',
      headers: authHeader(creds.apiToken),
    },
  );
  if (!res.ok) {
    await throwHttpError('GET worker bindings failed', res);
  }
  const body = (await res.json()) as { result: WorkerBinding[] };
  return body.result;
}
