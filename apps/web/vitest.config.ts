import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Unit tests live in src; the Playwright e2e suite under /e2e is run by
    // `pnpm --filter @ventureos/web test:e2e`, not by vitest.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    environment: 'node',
  },
});
