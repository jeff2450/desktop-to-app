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

  function makeContext(opts: { mode?: "offline" | "online" | "hybrid"; targets?: string[]; dryRun?: boolean } = {}) {
    return new PipelineContext({
      config: {
        name: "Test Fixture App",
        version: "1.2.3",
        source: sourceDir,
        targets: opts.targets ?? ["windows"],
        mode: opts.mode ?? "offline",
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

    it("creates an offline plan when offline mode is selected", async () => {
      const ctx = makeContext({ mode: "offline" });
      
      await runDetectStage(ctx);
      await runPlanStage(ctx);

      expect(ctx.plan).toBeDefined();
      expect(ctx.plan?.dependenciesToAdd).toHaveProperty("electron");
      expect(ctx.plan?.dependenciesToAdd).toHaveProperty("better-sqlite3");
      expect(ctx.plan?.dependenciesToRemove).toContain("@supabase/supabase-js");
      expect(ctx.plan?.scriptsToInject).toHaveProperty("backend:start");
      
      const fileToGen = ctx.plan?.filesToGenerate.map(f => f.outputPath);
      expect(fileToGen).toContain("electron/main.cjs");
      expect(fileToGen).toContain("backend/server.cjs");
      expect(fileToGen).toContain("backend/database.cjs");
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
  });

  describe("Stage 03 — Transform", () => {
    it("copies files, rewrites BrowserRouter to HashRouter, and rewrites Supabase createClient() calls", async () => {
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

      const ctx = makeContext({ mode: "offline" });
      
      await runDetectStage(ctx);
      await runPlanStage(ctx);

      ctx.plan!.filesToTransform = [
        {
          sourcePath: "src/RouterFile.tsx",
          outputPath: "src/RouterFile.tsx",
          transformerType: "supabase-query",
          confidence: 0.9,
          reason: "react-router-dom tests",
        },
        {
          sourcePath: "src/supabase-client.ts",
          outputPath: "src/supabase-client.ts",
          transformerType: "supabase-auth",
          confidence: 0.9,
          reason: "supabase-client tests",
        }
      ];

      await runTransformStage(ctx);

      // 1. Verify Browser Router was replaced by HashRouter
      const routerFileContent = await fs.readFile(path.join(outputDir, "src/RouterFile.tsx"), "utf-8");
      expect(routerFileContent).toContain("HashRouter");
      expect(routerFileContent).not.toContain("BrowserRouter");

      // 2. Verify Supabase client was rewritten to re-export localApi (asserting function call '= createClient(' is removed)
      const clientFileContent = await fs.readFile(path.join(outputDir, "src/supabase-client.ts"), "utf-8");
      expect(clientFileContent).toContain("supabase = localApi");
      expect(clientFileContent).not.toContain("= createClient(");
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

      const ctx = makeContext({ mode: "offline", dryRun: true });
      await runDetectStage(ctx);
      await runPlanStage(ctx);
      await runInstallStage(ctx);

      const outputPkg = JSON.parse(await fs.readFile(path.join(outputDir, "package.json"), "utf-8"));

      expect(outputPkg.dependencies).not.toHaveProperty("electron");
      expect(outputPkg.devDependencies).toHaveProperty("electron");
      expect(outputPkg.dependencies).not.toHaveProperty("vite-plugin-pwa");
      expect(outputPkg.dependencies["date-fns"]).toBe("^3.6.0");
    });
  });

  describe("Stage 06 — Build", () => {
    it("patches the vite config, fixes css imports, and runs vite build", async () => {
      await createValidFixture(sourceDir);
      const ctx = makeContext({ mode: "offline", dryRun: false });

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
  });
});
