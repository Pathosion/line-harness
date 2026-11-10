import { workerGuardResponse } from '../worker-guard-fixture.js';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  putWorkerScript,
  getWorkerScriptContent,
  listWorkerBindings,
  type WorkerBinding,
} from '../../src/cf-api/workers.js';
import type { CfApiCreds } from '../../src/types.js';

const creds: CfApiCreds = {
  accountId: 'acct123',
  apiToken: 'tok_abc',
};

describe('putWorkerScript', () => {
  const originalFetch = globalThis.fetch;
  const bindings: WorkerBinding[] = [
    { type: 'plain_text', name: 'API_URL', text: 'https://example.com' },
    { type: 'd1', name: 'DB', database_id: 'db123' },
    { type: 'secret_text', name: 'TOKEN' },
  ];
  const settings = (changes: Record<string, unknown> = {}) => ({
    compatibility_date: '2025-01-15', compatibility_flags: ['nodejs_compat', 'some_existing_flag'],
    bindings: [...bindings, { type: 'assets', name: 'ASSETS' }],
    observability: { enabled: true }, limits: { cpu_ms: 100 }, ...changes,
  });
  afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

  function route(current = settings(), putStatus = 200) {
    return vi.fn(async (url: string, init?: RequestInit) => {
      const identity = workerGuardResponse(url); if (identity) return identity;
      if (url.endsWith('/settings')) return Response.json({ result: current });
      if (init?.method === 'PUT') return new Response('{}', { status: putStatus });
      throw new Error('Unexpected request: ' + url);
    });
  }

  it('preserves flags, static assets and all bindings without reading secret values', async () => {
    const mock = route(); globalThis.fetch = mock;
    const scriptText = 'export default { fetch() { return new Response("ok"); } }';
    await putWorkerScript({ creds, scriptName: 'myname', scriptContent: Buffer.from(scriptText), bindings });
    expect(mock).toHaveBeenCalledTimes(6);
    const [url, init] = mock.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/acct123/workers/scripts/myname?bindings_inherit=strict');
    expect(init?.headers).toEqual({ Authorization: 'Bearer tok_abc' });
    const fd = init?.body as FormData;
    const metadata = JSON.parse(await (fd.get('metadata') as Blob).text());
    expect(metadata).toMatchObject({
      main_module: 'worker.js', compatibility_date: '2025-01-15',
      compatibility_flags: ['nodejs_compat', 'some_existing_flag'], keep_assets: true,
      observability: { enabled: true }, limits: { cpu_ms: 100 },
      bindings: ['API_URL', 'DB', 'TOKEN', 'ASSETS'].map(name => ({ name, type: 'inherit' })),
    });
    expect(metadata.bindings.every((binding: { text?: string }) => binding.text === undefined)).toBe(true);
    expect(await (fd.get('worker.js') as Blob).text()).toBe(scriptText);
    expect(mock.mock.calls.every(([requestUrl]) => !requestUrl.includes('/secrets'))).toBe(true);
  });

  it('adds required node compatibility while preserving the current date', async () => {
    const mock = route(settings({ compatibility_flags: [] })); globalThis.fetch = mock;
    await putWorkerScript({ creds, scriptName: 'w', scriptContent: Buffer.from('x'), bindings });
    const fd = mock.mock.calls.find(([, init]) => init?.method === 'PUT')![1]?.body as FormData;
    const metadata = JSON.parse(await (fd.get('metadata') as Blob).text());
    expect(metadata.compatibility_flags).toEqual(['nodejs_compat']);
    expect(metadata.compatibility_date).toBe('2025-01-15');
  });

  it.each([
    ['missing date', { compatibility_date: undefined }],
    ['invalid flags', { compatibility_flags: 'nodejs_compat' }],
    ['explicitly disabled Node', { compatibility_flags: ['no_nodejs_compat'] }],
    ['removed binding', { bindings: [] }],
  ])('refuses %s before any upload', async (_name, changes) => {
    const mock = route(settings(changes)); globalThis.fetch = mock;
    await expect(putWorkerScript({ creds, scriptName: 'w', scriptContent: Buffer.from('x'), bindings })).rejects.toThrow();
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it('propagates an upload rejection after preserving current settings', async () => {
    const mock = route(settings(), 403); globalThis.fetch = mock;
    await expect(putWorkerScript({ creds, scriptName: 'w', scriptContent: Buffer.from('x'), bindings })).rejects.toThrow(/PUT worker script failed: HTTP 403/);
  });
});

describe('getWorkerScriptContent', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns response text on 200', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'export default { fetch() {} }',
    } as Response);

    const content = await getWorkerScriptContent({
      creds,
      scriptName: 'myname',
    });

    expect(content).toBe('export default { fetch() {} }');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acct123/workers/scripts/myname',
    );
    expect(init.method ?? 'GET').toBe('GET');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tok_abc');
  });

  it('throws on 404', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'not found',
    } as Response);

    await expect(
      getWorkerScriptContent({ creds, scriptName: 'missing' }),
    ).rejects.toThrow(/HTTP 404/);
  });
});

describe('listWorkerBindings', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns the result array', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const bindings: WorkerBinding[] = [
      { type: 'd1', name: 'DB', database_id: 'db1' },
      { type: 'secret_text', name: 'TOKEN' },
    ];
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, result: bindings }),
    } as Response);

    const result = await listWorkerBindings({ creds, scriptName: 'myname' });

    expect(result).toEqual(bindings);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acct123/workers/scripts/myname/bindings',
    );
    expect(init.method ?? 'GET').toBe('GET');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tok_abc');
  });

  it('throws on non-200', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'oops',
    } as Response);

    await expect(
      listWorkerBindings({ creds, scriptName: 'myname' }),
    ).rejects.toThrow(/HTTP 500/);
  });
});

it.each(['draft', 'split', 'unknown', 'changed'] as const)('refuses %s inheritance without issuing any Worker PUT', async kind => {
  const originalFetch = globalThis.fetch; let settingsRead = false;
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/versions?')) return Response.json({ success: true, result: { items: kind === 'unknown' ? [] : [{ id: kind === 'draft' || (kind === 'changed' && settingsRead) ? 'draft' : 'deployed-version' }] } });
    if (url.includes('/deployments?')) return Response.json({ success: true, result: { deployments: [{ id: 'active-deployment', strategy: 'percentage', versions: kind === 'split' ? [{ version_id: 'deployed-version', percentage: 50 }, { version_id: 'other', percentage: 50 }] : [{ version_id: kind === 'changed' && settingsRead ? 'draft' : 'deployed-version', percentage: 100 }] }] } });
    if (url.endsWith('/settings')) { settingsRead = true; return Response.json({ result: { compatibility_date: '2024-12-01', compatibility_flags: [], bindings: [] } }); }
    throw new Error('Unexpected mutation: ' + init?.method);
  }); globalThis.fetch = mock as typeof fetch;
  try {
    await expect(putWorkerScript({ creds, scriptName: 'w', scriptContent: Buffer.from('export default{}'), bindings: [] })).rejects.toThrow(/inheritance refused|deployment changed/);
    expect(mock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  } finally { globalThis.fetch = originalFetch; }
});
