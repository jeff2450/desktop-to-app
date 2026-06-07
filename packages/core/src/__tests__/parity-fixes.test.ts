import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { PipelineContext } from "../pipeline/PipelineContext.js";
import { runPlanStage } from "../pipeline/stages/02-plan.js";
import { runBuildStage } from "../pipeline/stages/06-build.js";
import { runScaffoldStage } from "../pipeline/stages/04-scaffold.js";

async function createFixture(
  tmpDir: string,
  files: Record<string, string>
): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(tmpDir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf-8");
  }
}

function makeTestCtx(sourceDir: string, outputDir: string, workDir: string, configOverrides: Record<string, any> = {}) {
  const ctx = new PipelineContext({
    config: {
      name: "Parity Test App",
      version: "1.0.0",
      source: sourceDir,
      targets: ["windows"],
      mode: "online",
      appId: "com.test.parity",
      backend: { type: "none" },
      auth: { type: "none" },
      database: { type: "none" },
      ...configOverrides,
    },
    sourceDir,
    outputDir,
    workDir,
  });

  ctx.detection = {
    framework: "react",
    bundler: "vite",
    backend: "none",
    auth: "none",
    tables: [],
    tableColumns: {},
    rlsPolicies: {},
    uiLibrary: "other",
    hasOfflineSupport: false,
    confidence: 1.0,
    warnings: [],
    scannedFiles: [],
    dependencies: { react: "^18" },
    devDependencies: {},
    iconPath: undefined,
    pathAliases: { "@": "./src" },
  };

  return ctx;
}

describe("Parity Fixes — Electron frame and PostCSS", () => {
  let sourceDir: string;
  let outputDir: string;
  let workDir: string;

  beforeEach(async () => {
    sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "parity-src-"));
    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "parity-out-"));
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "parity-work-"));
  });

  afterEach(async () => {
    await Promise.all(
      [sourceDir, outputDir, workDir].map((d) =>
        fs.rm(d, { recursive: true, force: true }).catch(() => {})
      )
    );
  });

  it("ensures frame is not set to false in generated electron main by default (native titlebar)", async () => {
    await createFixture(sourceDir, {
      "package.json": JSON.stringify({ name: "test-app", version: "1.0.0" }),
      "index.html": "<html></html>",
    });

    const ctx = makeTestCtx(sourceDir, outputDir, workDir);

    // Run plan and scaffold stages
    await runPlanStage(ctx);
    await runScaffoldStage(ctx);

    const mainFile = path.join(outputDir, "electron", "main.cjs");
    const mainContent = await fs.readFile(mainFile, "utf-8");

    // Custom titlebar assignment should resolve to false
    expect(mainContent).toContain("isCustomTitleBar = 'native' === 'custom';");

    // Controls script should NOT be scaffolded or copied
    const controlsFile = path.join(outputDir, "electron", "window-controls.js");
    const controlsExists = await fs.access(controlsFile).then(() => true).catch(() => false);
    expect(controlsExists).toBe(false);
  });

  it("enables frameless option and injects window-controls.js when titleBar is set to 'custom'", async () => {
    await createFixture(sourceDir, {
      "package.json": JSON.stringify({ name: "test-app", version: "1.0.0" }),
      "index.html": "<html></html>",
    });

    const ctx = makeTestCtx(sourceDir, outputDir, workDir, { titleBar: "custom" });

    // Run plan and scaffold stages
    await runPlanStage(ctx);
    await runScaffoldStage(ctx);

    const mainFile = path.join(outputDir, "electron", "main.cjs");
    const mainContent = await fs.readFile(mainFile, "utf-8");

    // Borderless windows configurations should be present in the window config
    expect(mainContent).toContain("isCustomTitleBar = 'custom' === 'custom';");
    expect(mainContent).toContain("frame: false");

    // The custom window controls script should be generated/written
    const controlsFile = path.join(outputDir, "electron", "window-controls.js");
    const controlsExists = await fs.access(controlsFile).then(() => true).catch(() => false);
    expect(controlsExists).toBe(true);

    const controlsContent = await fs.readFile(controlsFile, "utf-8");
    expect(controlsContent).toContain("webToAppWindowControls");
    expect(controlsContent).toContain("wta-window-controls");
  });

  it("automatically detects and preserves PostCSS config in vite.config.ts", async () => {
    await createFixture(outputDir, {
      "package.json": JSON.stringify({ name: "test-app", version: "1.0.0" }),
      "index.html": "<html></html>",
      "postcss.config.js": "module.exports = { plugins: {} };",
    });

    const ctx = makeTestCtx(sourceDir, outputDir, workDir);

    // Run plan to set up ctx.plan structure (needed by build stage)
    await runPlanStage(ctx);

    try {
      await runBuildStage(ctx);
    } catch (err) {
      // It's expected to fail because npm install/vite build won't succeed in a bare temp dir
    }

    const configPath = path.join(outputDir, "vite.config.ts");
    const configExists = await fs.access(configPath).then(() => true).catch(() => false);
    expect(configExists).toBe(true);

    const configContent = await fs.readFile(configPath, "utf-8");
    expect(configContent).toContain("postcss: './postcss.config.js'");
  });
});
