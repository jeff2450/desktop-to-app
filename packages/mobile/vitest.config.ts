import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The doctor tests call execSync to probe system tools (java, adb, gradle, node),
    // which can be slow on Windows or CI runners without these tools on PATH.
    // Set a generous per-test timeout so they don't flake.
    testTimeout: 30_000,

    // Collect coverage if --coverage flag is passed
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/__tests__/**', 'src/**/*.d.ts'],
    },
  },
});
