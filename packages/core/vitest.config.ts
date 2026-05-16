import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/**
 * Vitest configuration for @webtoapp/core.
 *
 * The project uses TypeScript ESM with `.js` extension imports
 * (e.g. `import ... from './foo.js'`) which is standard for Node ESM.
 * Vitest runs tests against source .ts files directly, so we need to
 * redirect those `.js` imports back to their `.ts` counterparts.
 */
export default defineConfig({
  plugins: [],
  resolve: {
    alias: [
      // Redirect any import ending in .js to the same path without extension,
      // letting vitest's TypeScript loader find the .ts file.
      {
        find: /^(\.\.\/.*|\.\/.*?)\.js$/,
        replacement: "$1",
      },
    ],
  },
  test: {
    environment: "node",
    globals: false,
    testTimeout: 60_000,
    include: ["src/**/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/__tests__/**"],
    },
  },
});
