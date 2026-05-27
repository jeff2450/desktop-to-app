import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { PipelineContext } from "../pipeline/PipelineContext.js";
import { runParityStage } from "../pipeline/stages/06b-parity.js";
import type { ConversionConfig } from "../types/ConversionConfig.js";
import type { DetectionResult } from "../types/DetectionResult.js";
import type { MigrationPlan } from "../types/MigrationPlan.js";

function config(
  sourceDir: string,
  outputDir: string,
  overrides: Partial<ConversionConfig> = {}
): ConversionConfig {
  return {
    name: "Parity Test",
    version: "1.0.0",
    source: sourceDir,
    output: outputDir,
    targets: ["windows"],
    mode: "offline",
    appId: "com.test.parity",
    backend: { type: "auto", port: 3001 },
    auth: { type: "local" },
    database: { type: "sqlite" },
    behaviorParity: "strict",
    ...overrides,
  };
}

function detection(sourceDir: string, scannedFile: string, overrides: Partial<DetectionResult> = {}): DetectionResult {
  return {
    framework: "react",
    bundler: "vite",
    backend: "supabase",
    auth: "supabase",
    tables: ["users"],
    tableColumns: {},
    rlsPolicies: {},
    uiLibrary: "tailwind",
    hasOfflineSupport: false,
    confidence: 0.95,
    warnings: [],
    scannedFiles: [path.join(sourceDir, scannedFile)],
    dependencies: {},
    devDependencies: {},
    pathAliases: { "@": "./src" },
    ...overrides,
  };
}

function plan(overrides: Partial<MigrationPlan> = {}): MigrationPlan {
  return {
    filesToTransform: [],
    filesToCopy: [],
    filesToDelete: [],
    filesToGenerate: [],
    dependenciesToAdd: {},
    dependenciesToRemove: [],
    scriptsToInject: {},
    summary: "test plan",
    ...overrides,
  };
}

async function writeFile(root: string, rel: string, content: string): Promise<void> {
  const target = path.join(root, rel);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf-8");
}

async function writeBuiltDist(outputDir: string): Promise<void> {
  await writeFile(
    outputDir,
    "dist/index.html",
    `<div id="root"></div><script type="module" src="./assets/index.js"></script>`
  );
  await writeFile(outputDir, "dist/assets/index.js", "console.log('ok');");
}

describe("runParityStage", () => {
  let tmpRoot: string;
  let sourceDir: string;
  let outputDir: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "webtoapp-parity-"));
    sourceDir = path.join(tmpRoot, "source");
    outputDir = path.join(tmpRoot, "output");
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("blocks offline packaging when unsupported Supabase RPC behavior is detected", async () => {
    await writeFile(sourceDir, "src/App.tsx", "await supabase.rpc('search_users');");
    await writeFile(outputDir, "src/App.tsx", "await localApi.from('users').select();");
    await writeFile(outputDir, "src/lib/localApi.ts", "export const localApi = {};");
    await writeBuiltDist(outputDir);

    const ctx = new PipelineContext({
      config: config(sourceDir, outputDir),
      sourceDir,
      outputDir,
      workDir: tmpRoot,
    });
    ctx.detection = detection(sourceDir, "src/App.tsx");
    ctx.plan = plan({
      filesToTransform: [
        {
          sourcePath: "src/App.tsx",
          outputPath: "src/App.tsx",
          transformerType: "supabase-query",
          confidence: 0.9,
          reason: "Contains Supabase query calls",
        },
      ],
      dependenciesToRemove: ["@supabase/supabase-js"],
    });

    await expect(runParityStage(ctx)).rejects.toThrow(/Behavior parity gate blocked/i);
  });

  it("passes online mode when source code and cloud env values are preserved", async () => {
    const appSource = "export function App() { return <div>Hello</div>; }";
    await writeFile(sourceDir, "src/App.tsx", appSource);
    await writeFile(sourceDir, ".env", "VITE_SUPABASE_URL=https://example.supabase.co\n");
    await writeFile(outputDir, "src/App.tsx", appSource);
    await writeFile(outputDir, ".env", "VITE_SUPABASE_URL=https://example.supabase.co\n");
    await writeBuiltDist(outputDir);

    const ctx = new PipelineContext({
      config: config(sourceDir, outputDir, { mode: "online" }),
      sourceDir,
      outputDir,
      workDir: tmpRoot,
    });
    ctx.detection = detection(sourceDir, "src/App.tsx");
    ctx.plan = plan();

    await expect(runParityStage(ctx)).resolves.toBeUndefined();
  });
});
