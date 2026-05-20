// Internal helpers shared by the CF API wrappers in this directory. Not
// re-exported from the package root — these are implementation details of
// d1.ts / pages.ts / workers.ts and should stay package-private.

/**
 * `Authorization: Bearer <token>` header. Used both with the long-lived
 * account API token (d1, workers, pages deployment / token / rollback) and
 * with the short-lived JWT returned by the Pages upload-token endpoint.
 */
export function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/**
 * Read a Response body for inclusion in an error message, truncated to 500
 * chars so logs stay readable when CF returns a wall-of-HTML 5xx page.
 * Never throws — falls back to '' if the body can't be drained.
 */
export async function readBodyExcerpt(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.length > 500 ? text.slice(0, 500) + '…' : text;
  } catch {
    return '';
  }
}

/**
 * Throw a uniformly-formatted error for a non-2xx CF response. The body
 * excerpt is included so caller logs always reveal the API's error reason.
 */
export async function throwHttpError(prefix: string, res: Response): Promise<never> {
  const excerpt = await readBodyExcerpt(res);
  throw new Error(`${prefix}: HTTP ${res.status} ${excerpt}`);
}

export function pagesProjectApiBase(accountId: string, projectName: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}`;
}

export function workersApiBase(accountId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts`;
}

export function d1QueryApiUrl(accountId: string, databaseId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
}
