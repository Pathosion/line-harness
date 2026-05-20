import type { CfApiCreds } from '../types.js';
import { authHeader, throwHttpError, workersApiBase } from './_shared.js';

/**
 * Cloudflare Workers binding shape used by the Workers Scripts API.
 *
 * Only the binding types we care about for the LINE Harness Worker are
 * modelled here: env-style plain text, secrets, and resource bindings for
 * D1, R2, and KV. Other types (`service`, `queue`, `analytics_engine`, …)
 * are intentionally left unsupported in v1 — callers should fail loudly if
 * the deployed Worker uses an unsupported binding type so we don't silently
 * drop it on update.
 */
export interface WorkerBinding {
  type: 'plain_text' | 'secret_text' | 'd1' | 'r2_bucket' | 'kv_namespace';
  name: string;
  database_id?: string;
  bucket_name?: string;
  namespace_id?: string;
  text?: string;
}

const DEFAULT_COMPATIBILITY_DATE = '2024-12-01';

/**
 * Upload (create or overwrite) a Worker script via the Cloudflare API.
 *
 * Uses the multipart/form-data ES module upload format: a `metadata` JSON
 * part describing the entrypoint + bindings + compatibility_date, and a
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
  const compatibility_date = opts.compatibilityDate ?? DEFAULT_COMPATIBILITY_DATE;

  const metadata = {
    main_module: 'worker.js',
    bindings,
    compatibility_date,
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

  const res = await fetch(`${workersApiBase(creds.accountId)}/${scriptName}`, {
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
