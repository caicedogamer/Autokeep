import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
      '@modules': fileURLToPath(new URL('./src/modules', import.meta.url)),
    },
  },
  test: {
    globals: false,
    // Default: jsdom for files that may touch the DOM. Pure-logic suites
    // should be named `*.pure.spec.ts` and override via `environmentMatchGlobs`.
    environment: 'jsdom',
    environmentMatchGlobs: [['src/**/*.pure.spec.ts', 'node']],
    setupFiles: ['src/test-setup.ts'],
    include: ['src/**/__tests__/**/*.spec.ts', 'tests/unit/**/*.spec.ts'],
    exclude: ['node_modules', 'dist', 'build', 'coverage', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/**/*.spec.ts', 'src/**/index.ts', 'src/main.ts'],
    },
  },
});
