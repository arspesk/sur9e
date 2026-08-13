import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'test/**/*.{test,spec}.{ts,tsx,mjs}'],
    exclude: ['node_modules', 'test/e2e/**'],
    // The jsdom + ProseMirror editor suites are memory-heavy. Vitest's default
    // one-fork-per-CPU parallelism OOM-kills a worker non-deterministically on
    // CI's memory-constrained runners — a killed worker surfaces as a spurious
    // "Quick quality gate" failure that truncates mid-test with no assertion.
    // Cap the fork pool to keep peak memory bounded and CI deterministic.
    pool: 'forks',
    poolOptions: {
      forks: { minForks: 1, maxForks: 2 },
    },
  },
  resolve: {
    alias: {
      // server-only throws at runtime in non-React-server environments.
      // In vitest (jsdom), resolve it to an empty no-op so the guard doesn't
      // block unit tests that import server-lib modules directly.
      'server-only': new URL('./src/lib/server/__mocks__/server-only.ts', import.meta.url).pathname,
      '@': new URL('./src', import.meta.url).pathname,
    },
    // Prefer .ts over .js so extensionless imports resolve through typed
    // entrypoints rather than compiled output.
    extensions: ['.ts', '.tsx', '.mts', '.mjs', '.js', '.jsx', '.json'],
  },
});
