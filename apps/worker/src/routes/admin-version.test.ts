import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import adminVersion from './admin-version.js';

describe('GET /admin/version', () => {
  it('returns version + hashes', async () => {
    const app = new Hono();
    app.route('/admin', adminVersion);
    const res = await app.request('/admin/version');
    expect(res.status).toBe(200);
    const j = (await res.json()) as {
      version: string;
      worker_hash: string;
      admin_hash: string;
      liff_hash: string;
      released_at: string;
    };
    expect(j.version).toMatch(/^\d+\.\d+\.\d+(-\w+)?$/);
    expect(j.worker_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(j.admin_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(j.liff_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(j.released_at).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });
});
