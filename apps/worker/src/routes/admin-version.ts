import { Hono } from 'hono';
import {
  BUNDLE_VERSION,
  WORKER_HASH,
  ADMIN_HASH,
  LIFF_HASH,
  RELEASED_AT,
} from '../_version.js';

// Unauthenticated by design — returns build-time public metadata used by the
// dashboard's upgrade banner before the user logs in. The hashes are derivable
// from the deployed bundle anyway. Task 18's /admin/update/* mounts under the
// same /admin prefix but layers ADMIN_API_KEY middleware on those subpaths.
const app = new Hono();

app.get('/version', (c) =>
  c.json({
    version: BUNDLE_VERSION,
    worker_hash: WORKER_HASH,
    admin_hash: ADMIN_HASH,
    liff_hash: LIFF_HASH,
    released_at: RELEASED_AT,
  }),
);

export default app;
