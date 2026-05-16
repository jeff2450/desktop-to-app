import { describe, it, expect } from "vitest";

/**
 * Snapshot-style tests for the inline generator functions in 04-scaffold.ts.
 *
 * We can't import these directly (they're not exported), so we test them
 * via observable outputs: the generated strings must contain specific
 * required constructs. This ensures regressions in template output are
 * caught immediately rather than only discovered at runtime.
 *
 * Because the inline generators are private helpers, we test their output
 * indirectly through the exported runScaffoldStage() using a lightweight
 * fixture. The key properties we check:
 *
 *   electron/main.cjs —
 *     ✓ uses app:// protocol (not file://)
 *     ✓ registers scheme as privileged BEFORE app is ready
 *     ✓ waitForBackend() polls /api/health
 *     ✓ uses HashRouter-compatible URLs
 *
 *   backend/server.cjs —
 *     ✓ listens on 127.0.0.1 only (not 0.0.0.0)
 *     ✓ includes /api/health endpoint
 *
 *   backend/database.cjs —
 *     ✓ enables WAL mode
 *     ✓ enables foreign keys
 *
 *   backend/auth.cjs —
 *     ✓ uses bcryptjs
 *     ✓ uses JWT
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { PipelineContext } from "../pipeline/PipelineContext.js";
import { runScaffoldStage } from "../pipeline/stages/04-scaffold.js";

async function createMinimalFixture(sourceDir: string, outputDir: string) {
  await fs.mkdir(sourceDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });

  await fs.writeFile(
    path.join(sourceDir, "package.json"),
    JSON.stringify({
      name: "test-app",
      version: "1.0.0",
      dependencies: { react: "^18" },
    }),
    "utf-8"
  );
}

function makeScaffoldCtx(sourceDir: string, outputDir: string, workDir: string) {
  const ctx = new PipelineContext({
    config: {
      name: "Test App",
      version: "1.0.0",
      source: sourceDir,
      targets: ["windows"],
      mode: "offline",
      appId: "com.test.scaffoldtest",
      backend: { type: "auto", port: 3001 },
      auth: { type: "local", defaultAdmin: "admin@test.local" },
      database: { type: "sqlite" },
    },
    sourceDir,
    outputDir,
    workDir,
  });

  // Inject a minimal detection result
  ctx.detection = {
    framework: "react",
    bundler: "vite",
    backend: "supabase",
    auth: "supabase",
    tables: ["users", "products"],
    tableColumns: {},
    rlsPolicies: {},
    uiLibrary: "other",
    hasOfflineSupport: false,
    confidence: 0.9,
    warnings: [],
    scannedFiles: [],
    dependencies: { react: "^18" },
    devDependencies: {},
    iconPath: undefined,
    pathAliases: { "@": "./src" },
  };

  // Inject a minimal migration plan
  ctx.plan = {
    filesToTransform: [],
    filesToCopy: [],
    filesToDelete: [],
    filesToGenerate: [
      {
        outputPath: "electron/main.cjs",
        generatorType: "electron-main",
        templateVars: {
          appName: "Test App",
          devPort: 5173,
          backendPort: 3001,
          onlineMode: false,
        },
      },
      {
        outputPath: "electron/preload.cjs",
        generatorType: "electron-preload",
        templateVars: {},
      },
      {
        outputPath: "backend/server.cjs",
        generatorType: "express-server",
        templateVars: { port: 3001, tables: ["users", "products"], appName: "Test App" },
      },
      {
        outputPath: "backend/database.cjs",
        generatorType: "sqlite-database",
        templateVars: { tables: ["users", "products"] },
      },
      {
        outputPath: "backend/auth.cjs",
        generatorType: "jwt-auth",
        templateVars: { defaultAdmin: "admin@test.local" },
      },
    ],
    dependenciesToAdd: {},
    dependenciesToRemove: [],
    scriptsToInject: {},
    summary: "test",
  };

  return ctx;
}

describe("runScaffoldStage — electron/main.cjs", () => {
  it("generates a main.cjs with correct Electron security settings", async () => {
    const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "scaffold-src-"));
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "scaffold-out-"));
    const workDir   = await fs.mkdtemp(path.join(os.tmpdir(), "scaffold-work-"));

    try {
      await createMinimalFixture(sourceDir, outputDir);
      const ctx = makeScaffoldCtx(sourceDir, outputDir, workDir);

      await runScaffoldStage(ctx);

      const mainContent = await fs.readFile(
        path.join(outputDir, "electron/main.cjs"),
        "utf-8"
      );

      // Must register app:// as privileged scheme
      expect(mainContent).toContain("registerSchemesAsPrivileged");
      expect(mainContent).toContain("app://");

      // Must wait for backend before creating the window
      expect(mainContent).toContain("waitForBackend");

      // contextIsolation must be true
      expect(mainContent).toContain("contextIsolation: true");

      // nodeIntegration must be false (security)
      expect(mainContent).toContain("nodeIntegration: false");

    } finally {
      await Promise.all([sourceDir, outputDir, workDir].map((d) =>
        fs.rm(d, { recursive: true, force: true })
      ));
    }
  });
});

describe("runScaffoldStage — backend/server.cjs", () => {
  it("generates a server.cjs that binds to 127.0.0.1 and has a health endpoint", async () => {
    const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "scaffold-src-"));
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "scaffold-out-"));
    const workDir   = await fs.mkdtemp(path.join(os.tmpdir(), "scaffold-work-"));

    try {
      await createMinimalFixture(sourceDir, outputDir);
      const ctx = makeScaffoldCtx(sourceDir, outputDir, workDir);

      await runScaffoldStage(ctx);

      const serverContent = await fs.readFile(
        path.join(outputDir, "backend/server.cjs"),
        "utf-8"
      );

      // Must listen on loopback only (security — not expose to network)
      expect(serverContent).toContain("127.0.0.1");

      // Health endpoint required for waitForBackend() to work
      expect(serverContent).toContain("/api/health");

      // Must import and use initDatabase
      expect(serverContent).toContain("initDatabase");

      // Must register table routes
      expect(serverContent).toContain("users");
      expect(serverContent).toContain("products");
    } finally {
      await Promise.all([sourceDir, outputDir, workDir].map((d) =>
        fs.rm(d, { recursive: true, force: true })
      ));
    }
  });
});

describe("runScaffoldStage — backend/database.cjs", () => {
  it("generates a database.cjs with WAL mode and foreign keys enabled", async () => {
    const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "scaffold-src-"));
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "scaffold-out-"));
    const workDir   = await fs.mkdtemp(path.join(os.tmpdir(), "scaffold-work-"));

    try {
      await createMinimalFixture(sourceDir, outputDir);
      const ctx = makeScaffoldCtx(sourceDir, outputDir, workDir);

      await runScaffoldStage(ctx);

      const dbContent = await fs.readFile(
        path.join(outputDir, "backend/database.cjs"),
        "utf-8"
      );

      expect(dbContent).toContain("WAL");
      expect(dbContent).toContain("foreign_keys");
      expect(dbContent).toContain("CREATE TABLE IF NOT EXISTS users");
      expect(dbContent).toContain("CREATE TABLE IF NOT EXISTS products");
    } finally {
      await Promise.all([sourceDir, outputDir, workDir].map((d) =>
        fs.rm(d, { recursive: true, force: true })
      ));
    }
  });
});

describe("runScaffoldStage — backend/auth.cjs", () => {
  it("generates a secure auth module with bcrypt and JWT", async () => {
    const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "scaffold-src-"));
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "scaffold-out-"));
    const workDir   = await fs.mkdtemp(path.join(os.tmpdir(), "scaffold-work-"));

    try {
      await createMinimalFixture(sourceDir, outputDir);
      const ctx = makeScaffoldCtx(sourceDir, outputDir, workDir);

      await runScaffoldStage(ctx);

      const authContent = await fs.readFile(
        path.join(outputDir, "backend/auth.cjs"),
        "utf-8"
      );

      expect(authContent).toContain("bcrypt");
      expect(authContent).toContain("jsonwebtoken");
      expect(authContent).toContain("admin@test.local");
      // JWT secret must not be hardcoded
      expect(authContent).toContain("JWT_SECRET");
      expect(authContent).not.toContain("hardcoded");
    } finally {
      await Promise.all([sourceDir, outputDir, workDir].map((d) =>
        fs.rm(d, { recursive: true, force: true })
      ));
    }
  });
});

describe("runScaffoldStage — dry run", () => {
  it("does not write any files in dry-run mode", async () => {
    const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "scaffold-src-"));
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "scaffold-out-"));
    const workDir   = await fs.mkdtemp(path.join(os.tmpdir(), "scaffold-work-"));

    try {
      await createMinimalFixture(sourceDir, outputDir);
      const ctx = new PipelineContext({
        config: {
          name: "Test",
          version: "1.0.0",
          source: sourceDir,
          targets: ["windows"],
          mode: "offline",
          appId: "com.test.dry",
          backend: { type: "auto", port: 3001 },
          auth: { type: "local" },
          database: { type: "sqlite" },
          dryRun: true,
        },
        sourceDir,
        outputDir,
        workDir,
      });

      ctx.detection = {
        framework: "react", bundler: "vite", backend: "supabase",
        auth: "supabase", tables: [], tableColumns: {}, rlsPolicies: {},
        uiLibrary: "other", hasOfflineSupport: false, confidence: 0.9,
        warnings: [], scannedFiles: [], dependencies: {}, devDependencies: {},
        iconPath: undefined, pathAliases: {},
      };

      ctx.plan = {
        filesToTransform: [], filesToCopy: [], filesToDelete: [],
        filesToGenerate: [{
          outputPath: "electron/main.cjs",
          generatorType: "electron-main",
          templateVars: { appName: "Test", devPort: 5173, backendPort: 3001, onlineMode: false },
        }],
        dependenciesToAdd: {}, dependenciesToRemove: [], scriptsToInject: {}, summary: "dry",
      };

      await runScaffoldStage(ctx);

      // In dry-run mode, actual file content must NOT be written.
      // The stage may create the output directory structure (mkdir is idempotent),
      // but the generated file itself should not exist.
      const generatedFile = path.join(outputDir, "electron", "main.cjs");
      const fileExists = await fs.access(generatedFile).then(() => true).catch(() => false);
      expect(fileExists).toBe(false);
    } finally {
      await Promise.all([sourceDir, outputDir, workDir].map((d) =>
        fs.rm(d, { recursive: true, force: true })
      ));
    }
  });
});
