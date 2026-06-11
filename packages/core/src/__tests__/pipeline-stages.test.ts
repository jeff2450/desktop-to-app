import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("node:child_process", () => ({
  exec: vi.fn((cmdString, opts, callback) => {
    const cb = typeof opts === "function" ? opts : callback;
    // Call callback with success
    cb(null, { stdout: "mock exec output", stderr: "" });
  }),
}));

vi.mock("@webtoapp/transformers", () => ({
  transformFile: vi.fn().mockImplementation(async ({ sourcePath }) => {
    const content = await fs.readFile(sourcePath, "utf-8").catch(() => "");
    return {
      success: true,
      transformedContent: content + "\n// transformed mock content",
      confidence: 0.9,
      changes: ["mocked transform change"],
      warnings: [],
    };
  }),
}));

vi.mock("@webtoapp/builder", () => ({
  ElectronPackager: class {
    package = vi.fn().mockResolvedValue({ success: true, installerPaths: ["/mock/installer.exe"] });
  },
  NativeDepsBuilder: class {
    build = vi.fn().mockResolvedValue({ success: true });
  },
}));

vi.mock("@webtoapp/mobile", () => ({
  buildAndroid: vi.fn().mockResolvedValue({ success: true, warnings: [], outputPath: "/mock/android.apk" }),
  buildIos: vi.fn().mockResolvedValue({ success: true, warnings: [] }),
}));

// Import stages and pipeline context AFTER registering mocks
import { PipelineContext } from "../pipeline/PipelineContext.js";
import { runPreflightStage } from "../pipeline/stages/00-preflight.js";
import { runDetectStage } from "../pipeline/stages/01-detect.js";
import { runPlanStage } from "../pipeline/stages/02-plan.js";
import { runTransformStage } from "../pipeline/stages/03-transform.js";
import { runInstallStage } from "../pipeline/stages/05-install.js";
import { runBuildStage } from "../pipeline/stages/06-build.js";
import { runPackageStage } from "../pipeline/stages/07-package.js";
import { runMobileStage } from "../pipeline/stages/07b-mobile.js";

describe("Pipeline Stages (00-07b) Integration and Unit Tests", () => {
  let sourceDir: string;
  let outputDir: string;
  let workDir: string;

  beforeEach(async () => {
    sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "webtoapp-test-src-"));
    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "webtoapp-test-out-"));
    workDir   = await fs.mkdtemp(path.join(os.tmpdir(), "webtoapp-test-work-"));
  });

  afterEach(async () => {
    await Promise.all([sourceDir, outputDir, workDir].map(d =>
      fs.rm(d, { recursive: true, force: true, maxRetries: 3 }).catch(() => {})
    ));
    vi.clearAllMocks();
  });

  async function createValidFixture(src: string) {
    await fs.mkdir(path.join(src, "src"), { recursive: true });
    await fs.writeFile(
      path.join(src, "package.json"),
      JSON.stringify({
        name: "test-fixture-app",
        version: "1.2.3",
        dependencies: {
          react: "^18.2.0",
          "@supabase/supabase-js": "^2.39.0",
        },
        devDependencies: {
          vite: "^5.0.0",
        },
      }),
      "utf-8"
    );
    await fs.writeFile(
      path.join(src, "index.html"),
      "<!DOCTYPE html><html><body><div id='root'></div></body></html>",
      "utf-8"
    );
    await fs.writeFile(
      path.join(src, "src/main.tsx"),
      "import React from 'react';\nconsole.log('Main entry point');",
      "utf-8"
    );
  }

  function makeContext(opts: { mode?: "online" | "offline" | "hybrid"; targets?: Array<"windows" | "linux" | "mac" | "android" | "ios">; dryRun?: boolean } = {}) {
    return new PipelineContext({
      config: {
        name: "Test Fixture App",
        version: "1.2.3",
        source: sourceDir,
        targets: opts.targets ?? ["windows"],
        mode: opts.mode ?? "online",
        appId: "com.test.fixtureapp",
        backend: { type: "auto", port: 3001 },
        auth: { type: "local" },
        database: { type: "sqlite" },
        dryRun: opts.dryRun ?? false,
      },
      sourceDir,
      outputDir,
      workDir,
    });
  }

  describe("Stage 00 — Preflight", () => {
    it("passes preflight on a valid project directory structure", async () => {
      await createValidFixture(sourceDir);
      const ctx = makeContext();
      await expect(runPreflightStage(ctx)).resolves.not.toThrow();
    });
  });

  describe("Stage 02 — Plan", () => {
    beforeEach(async () => {
      await createValidFixture(sourceDir);
    });

    it("creates an online wrapper plan", async () => {
      const ctx = makeContext({ mode: "online" });
      
      await runDetectStage(ctx);
      await runPlanStage(ctx);

      expect(ctx.plan).toBeDefined();
      expect(ctx.plan?.dependenciesToAdd).toHaveProperty("electron");
      expect(ctx.plan?.dependenciesToAdd).toHaveProperty("electron-updater");
      expect(ctx.plan?.dependenciesToRemove).toHaveLength(0);
      expect(ctx.plan?.scriptsToInject).toHaveProperty("electron:dev");
      
      const fileToGen = ctx.plan?.filesToGenerate.map(f => f.outputPath);
      expect(fileToGen).toContain("electron/main.cjs");
      expect(fileToGen).toContain("electron/preload.cjs");
      expect(fileToGen).toContain("electron-builder.yml");
      expect(fileToGen).not.toContain("backend/server.cjs");
    });

    it("creates an online wrapper plan when online mode is selected", async () => {
      const ctx = makeContext({ mode: "online" });
      
      await runDetectStage(ctx);
      await runPlanStage(ctx);

      expect(ctx.plan).toBeDefined();
      expect(ctx.plan?.dependenciesToAdd).toHaveProperty("electron");
      expect(ctx.plan?.dependenciesToAdd).not.toHaveProperty("better-sqlite3");
      expect(ctx.plan?.dependenciesToRemove).toHaveLength(0);
      
      const fileToGen = ctx.plan?.filesToGenerate.map(f => f.outputPath);
      expect(fileToGen).toContain("electron/main.cjs");
      expect(fileToGen).not.toContain("backend/server.cjs");
    });

    it("falls back from online to offline when local API calls would break packaged online mode", async () => {
      const pkg = JSON.parse(await fs.readFile(path.join(sourceDir, "package.json"), "utf-8"));
      delete pkg.dependencies["@supabase/supabase-js"];
      await fs.writeFile(path.join(sourceDir, "package.json"), JSON.stringify(pkg), "utf-8");
      await fs.writeFile(
        path.join(sourceDir, "src/main.tsx"),
        "import React from 'react';\nfetch('/api/orders').then((res) => res.json());",
        "utf-8"
      );

      const ctx = makeContext({ mode: "online" });

      await runDetectStage(ctx);
      await runPlanStage(ctx);

      expect(ctx.config.mode).toBe("offline");
      expect(ctx.plan?.effectiveMode).toBe("offline");
      expect(ctx.plan?.dependenciesToAdd).toHaveProperty("better-sqlite3");

      const fileToGen = ctx.plan?.filesToGenerate.map(f => f.outputPath);
      expect(fileToGen).toContain("backend/server.cjs");
      expect(fileToGen).toContain("backend/database.cjs");
      expect(fileToGen).toContain("src/lib/localApi.ts");
    });
  });

  describe("Stage 03 — Transform", () => {
    it("rewrites BrowserRouter to HashRouter in online local-source mode (Electron app:// protocol requirement)", async () => {
      await createValidFixture(sourceDir);

      await fs.writeFile(
        path.join(sourceDir, "src/RouterFile.tsx"),
        "import { BrowserRouter, Route } from 'react-router-dom';\nconst App = () => <BrowserRouter></BrowserRouter>;",
        "utf-8"
      );
      await fs.writeFile(
        path.join(sourceDir, "src/supabase-client.ts"),
        "const client = createClient('URL', 'KEY');",
        "utf-8"
      );
      await fs.mkdir(path.join(sourceDir, "src/integrations/supabase"), { recursive: true });
      await fs.writeFile(
        path.join(sourceDir, "src/integrations/supabase/client.ts"),
        [
          "import { createClient } from '@supabase/supabase-js';",
          "const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;",
          "const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;",
          "export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);",
        ].join("\n"),
        "utf-8"
      );

      const ctx = makeContext({ mode: "online" });
      
      await runDetectStage(ctx);
      await runPlanStage(ctx);
      await runTransformStage(ctx);

      // BrowserRouter MUST be converted — Electron uses app:// protocol (no server)
      // so BrowserRouter's History API causes blank screens on non-root routes.
      const routerFileContent = await fs.readFile(path.join(outputDir, "src/RouterFile.tsx"), "utf-8");
      expect(routerFileContent).toContain("HashRouter");
      expect(routerFileContent).not.toContain("BrowserRouter");

      // Online mode keeps the real Supabase client (no localApi replacement)
      const integrationClientContent = await fs.readFile(path.join(outputDir, "src/integrations/supabase/client.ts"), "utf-8");
      expect(integrationClientContent).toContain("@supabase/supabase-js");
      expect(integrationClientContent).toContain("VITE_SUPABASE");
    });

    it("rewrites BrowserRouter to HashRouter in online mode and preserves Supabase client", async () => {
      await createValidFixture(sourceDir);

      await fs.writeFile(
        path.join(sourceDir, "src/RouterFile.tsx"),
        "import { BrowserRouter, Route } from 'react-router-dom';\nconst App = () => <BrowserRouter></BrowserRouter>;",
        "utf-8"
      );
      await fs.mkdir(path.join(sourceDir, "src/integrations/supabase"), { recursive: true });
      await fs.writeFile(
        path.join(sourceDir, "src/integrations/supabase/client.ts"),
        [
          "import { createClient } from '@supabase/supabase-js';",
          "const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;",
          "const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;",
          "export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);",
        ].join("\n"),
        "utf-8"
      );

      const ctx = makeContext({ mode: "online" });
      
      await runDetectStage(ctx);
      await runPlanStage(ctx);
      await runTransformStage(ctx);

      // HashRouter fix applies — Electron uses app:// protocol even in online local-source mode
      const routerFileContent = await fs.readFile(path.join(outputDir, "src/RouterFile.tsx"), "utf-8");
      expect(routerFileContent).toContain("HashRouter");
      expect(routerFileContent).not.toContain("BrowserRouter");

      // Online mode keeps the real Supabase client intact (no localApi)
      const supabaseClientContent = await fs.readFile(
        path.join(outputDir, "src/integrations/supabase/client.ts"),
        "utf-8"
      );
      expect(supabaseClientContent).toContain("createClient");
      expect(supabaseClientContent).toContain("@supabase/supabase-js");
      expect(supabaseClientContent).not.toContain("@/lib/localApi");
    });
  });

  describe("Stage 05 — Install", () => {
    it("downgrades date-fns and moves electron to devDependencies in package.json", async () => {
      await createValidFixture(sourceDir);
      
      const pkg = JSON.parse(await fs.readFile(path.join(sourceDir, "package.json"), "utf-8"));
      pkg.dependencies["react-day-picker"] = "^8.10.0";
      pkg.dependencies["date-fns"] = "^4.0.0";
      pkg.dependencies["electron"] = "^31.0.0";
      pkg.dependencies["vite-plugin-pwa"] = "^0.20.0";
      await fs.writeFile(path.join(sourceDir, "package.json"), JSON.stringify(pkg), "utf-8");

      const ctx = makeContext({ mode: "online", dryRun: true });
      await runDetectStage(ctx);
      await runPlanStage(ctx);
      await runInstallStage(ctx);

      const outputPkg = JSON.parse(await fs.readFile(path.join(outputDir, "package.json"), "utf-8"));

      expect(outputPkg.dependencies).not.toHaveProperty("electron");
      expect(outputPkg.devDependencies).toHaveProperty("electron");
      expect(outputPkg.dependencies).not.toHaveProperty("vite-plugin-pwa");
      expect(outputPkg.dependencies["date-fns"]).toBe("^3.6.0");
      expect(outputPkg.scripts.build).toBe("vite build");
    });

    it("preserves custom build script in package.json", async () => {
      await createValidFixture(sourceDir);
      
      const pkg = JSON.parse(await fs.readFile(path.join(sourceDir, "package.json"), "utf-8"));
      pkg.scripts = { build: "custom-build-command" };
      await fs.writeFile(path.join(sourceDir, "package.json"), JSON.stringify(pkg), "utf-8");

      const ctx = makeContext({ mode: "online", dryRun: true });
      await runDetectStage(ctx);
      await runPlanStage(ctx);
      await runInstallStage(ctx);

      const outputPkg = JSON.parse(await fs.readFile(path.join(outputDir, "package.json"), "utf-8"));
      expect(outputPkg.scripts.build).toBe("custom-build-command");
    });
  });

  describe("Stage 06 — Build", () => {
    it("patches the vite config, fixes css imports, and runs vite build", async () => {
      await createValidFixture(sourceDir);
      const ctx = makeContext({ mode: "online", dryRun: false });

      // Create fake node_modules/vite etc so stage doesn't call npm install
      await fs.mkdir(path.join(outputDir, "node_modules/vite"), { recursive: true });
      await fs.mkdir(path.join(outputDir, "node_modules/@vitejs/plugin-react"), { recursive: true });

      // Create raw CSS file with @tailwind and @import in wrong order
      await fs.mkdir(path.join(outputDir, "src"), { recursive: true });
      await fs.writeFile(
        path.join(outputDir, "src/index.css"),
        "@tailwind base;\n@import './custom.css';\n@tailwind components;",
        "utf-8"
      );

      // Create dummy package.json in outputDir
      await fs.writeFile(
        path.join(outputDir, "package.json"),
        JSON.stringify({ type: "module" }),
        "utf-8"
      );

      // Create dummy dist/ directory because stage checks if it exists after building
      await fs.mkdir(path.join(outputDir, "dist"), { recursive: true });

      await runDetectStage(ctx);
      await runPlanStage(ctx);
      await runBuildStage(ctx);

      // 1. Verify vite.config.ts was generated
      const configExists = await fs.access(path.join(outputDir, "vite.config.ts")).then(() => true).catch(() => false);
      expect(configExists).toBe(true);

      // 2. Verify css imports were reordered (import should now be at the top)
      const cssContent = await fs.readFile(path.join(outputDir, "src/index.css"), "utf-8");
      const lines = cssContent.split("\n").map(l => l.trim()).filter(Boolean);
      expect(lines[0]).toBe("@import './custom.css';");
      expect(lines[1]).toBe("@tailwind base;");
    });
  });

  describe("Stage 07 & 07b — Package & Mobile", () => {
    it("completes package stage successfully in dry-run", async () => {
      const ctx = makeContext({ dryRun: true });
      await expect(runPackageStage(ctx)).resolves.not.toThrow();
    });

    it("skips mobile stage when targets contain no mobile target", async () => {
      const ctx = makeContext({ targets: ["windows"], dryRun: true });
      await expect(runMobileStage(ctx)).resolves.not.toThrow();
    });

    it("completes mobile stage successfully in dry-run when mobile targets exist", async () => {
      const ctx = makeContext({ targets: ["android", "ios"], dryRun: true });
      await expect(runMobileStage(ctx)).resolves.not.toThrow();
    });

    it("does not create a desktop installer for mobile-only targets", async () => {
      const ctx = makeContext({ targets: ["android"], dryRun: false });

      await expect(runPackageStage(ctx)).resolves.not.toThrow();

      expect(ctx.installerPath).toBeUndefined();
      expect(ctx.artifactPaths.android).toBeUndefined();
      expect(ctx.getStages().find((stage) => stage.name === "07-package")?.status).toBe("skipped");
    });

    it("records the Android APK/AAB output path as the android artifact", async () => {
      const ctx = makeContext({ targets: ["android"], dryRun: false });

      await expect(runMobileStage(ctx)).resolves.not.toThrow();

      expect(ctx.artifactPaths.android).toBe("/mock/android.apk");
    });
  });
});
