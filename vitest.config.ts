import { defineConfig } from 'vitest/config';

// Root vitest config — only picks up tests under `scripts/`.
// Per-package tests (apps/worker, packages/*) keep their own configs.
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['scripts/**/*.test.ts'],
  },
});
