import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { PipelineContext } from "../pipeline/PipelineContext.js";
import { ConversionConfig } from "../types/ConversionConfig.js";


/**
 * Unit tests for PipelineContext — the shared state object that flows
 * through every pipeline stage. Tests focus on:
 *   - Stage lifecycle (start → complete → fail → skip)
 *   - Log accumulation and streaming
 *   - State persistence (save/load)
 *   - Resume-from-stage logic
 *   - Dry-run mode guard
 */

function makeConfig(overrides: Partial<ConversionConfig> = {}): ConversionConfig {
  return {
    name: "Test App",
    version: "1.0.0",
    source: "/fake/source",
    targets: ["windows"],
    mode: "offline",
    appId: "com.test.app",
    backend: { type: "auto", port: 3001 },
    auth: { type: "local" },
    database: { type: "sqlite" },
    ...overrides,
  };
}

describe("PipelineContext — stage lifecycle", () => {
  let tmpDir: string;
  let ctx: PipelineContext;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "webtoapp-test-"));
    ctx = new PipelineContext({
      config: makeConfig(),
      sourceDir: "/fake/source",
      outputDir: tmpDir,
      workDir: tmpDir,
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it("tracks a stage as running after startStage", () => {
    ctx.startStage("01-detect");
    const stages = ctx.getStages();
    expect(stages[0]?.status).toBe("running");
    expect(stages[0]?.name).toBe("01-detect");
    expect(stages[0]?.startedAt).toBeInstanceOf(Date);
  });

  it("marks a stage as done after completeStage", () => {
    ctx.startStage("01-detect");
    ctx.completeStage("01-detect");
    const stage = ctx.getStages()[0]!;
    expect(stage.status).toBe("done");
    expect(stage.durationMs).toBeGreaterThanOrEqual(0);
    expect(stage.completedAt).toBeInstanceOf(Date);
  });

  it("marks a stage as failed after failStage", () => {
    ctx.startStage("02-plan");
    ctx.failStage("02-plan", new Error("Schema missing"));
    const stage = ctx.getStages()[0]!;
    expect(stage.status).toBe("failed");
    expect(stage.error).toBe("Schema missing");
  });

  it("marks a stage as skipped via skipStage", () => {
    ctx.skipStage("03-transform", "resuming from later stage");
    const stage = ctx.getStages()[0]!;
    expect(stage.status).toBe("skipped");
  });

  it("records durationMs > 0 for a timed stage", async () => {
    ctx.startStage("05-install");
    await new Promise((r) => setTimeout(r, 5));
    ctx.completeStage("05-install");
    const stage = ctx.getStages()[0]!;
    expect(stage.durationMs).toBeGreaterThan(0);
  });
});

describe("PipelineContext — logging", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "webtoapp-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it("accumulates log entries", () => {
    const ctx = new PipelineContext({
      config: makeConfig(),
      sourceDir: "/fake",
      outputDir: tmpDir,
      workDir: tmpDir,
    });

    ctx.log("info", "Step 1 complete");
    ctx.log("warn", "Something odd", "01-detect");
    ctx.log("error", "Hard failure", "02-plan");

    const logs = ctx.getLogs();
    expect(logs).toHaveLength(3);
    expect(logs[0]?.level).toBe("info");
    expect(logs[1]?.stage).toBe("01-detect");
    expect(logs[2]?.level).toBe("error");
  });

  it("streams log entries via onLog callback", () => {
    const received: string[] = [];
    const ctx = new PipelineContext({
      config: makeConfig(),
      sourceDir: "/fake",
      outputDir: tmpDir,
      workDir: tmpDir,
      onLog: (entry) => received.push(entry.message),
    });

    ctx.log("info", "Hello from stream");
    expect(received).toContain("Hello from stream");
  });

  it("flushes logs to a NDJSON file", async () => {
    const ctx = new PipelineContext({
      config: makeConfig(),
      sourceDir: "/fake",
      outputDir: tmpDir,
      workDir: tmpDir,
    });

    ctx.log("info", "First line");
    ctx.log("warn", "Second line", "01-detect");
    await ctx.flushLogs();

    const logFile = path.join(tmpDir, "webtoapp-conversion.log");
    const content = await fs.readFile(logFile, "utf-8");
    const lines = content.trim().split("\n").map((l) => JSON.parse(l));

    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.some((l: any) => l.msg === "First line")).toBe(true);
    expect(lines.some((l: any) => l.stage === "01-detect")).toBe(true);
  });

  it("does not flush logs in dry-run mode", async () => {
    const ctx = new PipelineContext({
      config: makeConfig({ dryRun: true }),
      sourceDir: "/fake",
      outputDir: tmpDir,
      workDir: tmpDir,
    });

    ctx.log("info", "Dry run log");
    await ctx.flushLogs();

    const logFile = path.join(tmpDir, "webtoapp-conversion.log");
    const exists = await fs.access(logFile).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });
});

describe("PipelineContext — state persistence and resume", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "webtoapp-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it("saves state after completeStage and loads it back", async () => {
    const ctx1 = new PipelineContext({
      config: makeConfig(),
      sourceDir: "/fake",
      outputDir: tmpDir,
      workDir: tmpDir,
    });

    ctx1.startStage("05-install");
    ctx1.completeStage("05-install");
    await ctx1.saveState();

    // Simulate a fresh context loading existing state
    const ctx2 = new PipelineContext({
      config: makeConfig(),
      sourceDir: "/fake",
      outputDir: tmpDir,
      workDir: tmpDir,
    });
    await ctx2.loadState();

    // Stage 05 was completed — stages before it should be skippable
    expect(ctx2.shouldSkipStage("01-detect")).toBe(true);
    expect(ctx2.shouldSkipStage("05-install")).toBe(true);
    // Stage 06 was NOT completed — should NOT be skipped
    expect(ctx2.shouldSkipStage("06-build")).toBe(false);
  });

  it("shouldSkipStage respects resumeFromStage config", () => {
    const ctx = new PipelineContext({
      config: makeConfig({ resumeFromStage: "05-install" }),
      sourceDir: "/fake",
      outputDir: tmpDir,
      workDir: tmpDir,
    });

    expect(ctx.shouldSkipStage("01-detect")).toBe(true);
    expect(ctx.shouldSkipStage("02-plan")).toBe(true);
    expect(ctx.shouldSkipStage("03-transform")).toBe(true);
    expect(ctx.shouldSkipStage("04-scaffold")).toBe(true);
    expect(ctx.shouldSkipStage("05-install")).toBe(false);
    expect(ctx.shouldSkipStage("06-build")).toBe(false);
  });

  it("does not save state in dry-run mode", async () => {
    const ctx = new PipelineContext({
      config: makeConfig({ dryRun: true }),
      sourceDir: "/fake",
      outputDir: tmpDir,
      workDir: tmpDir,
    });

    ctx.startStage("04-scaffold");
    ctx.completeStage("04-scaffold");
    await ctx.saveState();

    const stateFile = path.join(tmpDir, "webtoapp-state.json");
    const exists = await fs.access(stateFile).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });
});

describe("PipelineContext — helpers", () => {
  it("relative() returns path relative to sourceDir", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "webtoapp-test-"));
    try {
      const ctx = new PipelineContext({
        config: makeConfig(),
        sourceDir: "/fake/source",
        outputDir: tmpDir,
        workDir: tmpDir,
      });

      const rel = ctx.relative("/fake/source/src/components/App.tsx");
      expect(rel).toBe(path.join("src", "components", "App.tsx"));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it("hasTargets returns true when targets is non-empty", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "webtoapp-test-"));
    try {
      const ctx = new PipelineContext({
        config: makeConfig({ targets: ["linux", "windows"] }),
        sourceDir: "/fake",
        outputDir: tmpDir,
        workDir: tmpDir,
      });
      expect(ctx.hasTargets).toBe(true);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});
