import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

import type { ConversionConfig } from "../types/ConversionConfig.js";
import type { BuildResult } from "../types/BuildResult.js";
import { PipelineContext } from "./PipelineContext.js";

import { runDetectStage } from "./stages/01-detect.js";
import { runPlanStage } from "./stages/02-plan.js";
import { runTransformStage } from "./stages/03-transform.js";
import { runScaffoldStage } from "./stages/04-scaffold.js";
import { runInstallStage } from "./stages/05-install.js";
import { runBuildStage } from "./stages/06-build.js";
import { runPackageStage } from "./stages/07-package.js";
import { runMobileStage } from "./stages/07b-mobile.js";
import { runPreflightStage } from "./stages/00-preflight.js";

/**
 * The main entry point for converting a web project to a desktop app.
 *
 * Usage:
 * ```ts
 * const pipeline = new ConversionPipeline(config);
 * const result = await pipeline.run();
 * ```
 *
 * Progress / log streaming:
 * ```ts
 * const pipeline = new ConversionPipeline(config, {
 *   onLog: (entry) => process.stdout.write(entry.message + "\n"),
 * });
 * ```
 */
export class ConversionPipeline {
  private readonly config: ConversionConfig;
  private readonly options: PipelineOptions;

  constructor(config: ConversionConfig, options: PipelineOptions = {}) {
    this.config = config;
    this.options = options;
  }

  async run(): Promise<BuildResult> {
    const sourceDir = path.resolve(this.config.source);
    const outputDir = path.resolve(
      this.config.output ?? path.join(sourceDir, "..", `${path.basename(sourceDir)}-desktop`)
    );
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "webtoapp-"));

    const ctx = new PipelineContext({
      config: this.config,
      sourceDir,
      outputDir,
      workDir,
      onLog: this.options.onLog,
    });

    ctx.log("info", `WebToApp conversion started`);
    ctx.log("info", `Source:  ${sourceDir}`);
    ctx.log("info", `Output:  ${outputDir}`);
    ctx.log("info", `Targets: ${this.config.targets.join(", ")}`);
    ctx.log("info", `Mode:    ${this.config.mode}`);
    if (ctx.dryRun) ctx.log("info", "🔍 DRY-RUN — no files will be written");
    if (this.config.resumeFromStage) {
      ctx.log("info", `Resuming from stage: ${this.config.resumeFromStage}`);
    }

    // ── Error #10 Fix: Backup before starting, rollback on any failure ──
    const backupDir = outputDir + ".backup";
    await this.createBackup(outputDir, backupDir, ctx);

    try {
      // Stage 00 — Pre-flight validation (NEW: fast-fails before touching anything)
      await runPreflightStage(ctx);

      // Stage 01 — Detect
      if (ctx.shouldSkipStage("01-detect")) ctx.skipStage("01-detect", "resuming from later stage");
      else await runDetectStage(ctx);

      // Stage 02 — Plan
      if (ctx.shouldSkipStage("02-plan")) ctx.skipStage("02-plan", "resuming from later stage");
      else await runPlanStage(ctx);

      // Stage 03 — Transform source files
      if (ctx.shouldSkipStage("03-transform")) ctx.skipStage("03-transform", "resuming from later stage");
      else await runTransformStage(ctx);

      // Stage 04 — Scaffold Electron + backend files
      if (ctx.shouldSkipStage("04-scaffold")) ctx.skipStage("04-scaffold", "resuming from later stage");
      else await runScaffoldStage(ctx);

      // Stage 05 — Install dependencies
      if (ctx.shouldSkipStage("05-install")) ctx.skipStage("05-install", "resuming from later stage");
      else await runInstallStage(ctx);

      // Stage 06 — Vite build
      if (ctx.shouldSkipStage("06-build")) ctx.skipStage("06-build", "resuming from later stage");
      else await runBuildStage(ctx);

      // Stage 07 — Package installer
      if (ctx.shouldSkipStage("07-package")) ctx.skipStage("07-package", "resuming from later stage");
      else await runPackageStage(ctx);

      // Stage 07b — Mobile (Android/iOS) — skipped if no mobile targets
      if (ctx.shouldSkipStage("07b-mobile")) ctx.skipStage("07b-mobile", "resuming from later stage");
      else await runMobileStage(ctx);

      // All stages succeeded — remove backup and flush logs
      await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {});
      await ctx.flushLogs();

      // If the user asked for a clean output, remove the log file after flushing
      if (this.config.cleanLogs) {
        await ctx.deleteLogFile();
      }

      ctx.log("info", "Conversion complete — backup removed");

      return this.buildResult(ctx, "success");
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      ctx.log("error", `Pipeline failed: ${error.message}`);

      // Rollback to the state before conversion started
      await this.rollback(outputDir, backupDir, ctx);
      await ctx.flushLogs();

      return this.buildResult(ctx, "failed", error);
    } finally {
      // Clean up temp dir
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Error #10: Snapshot outputDir → backupDir so we can restore on failure.
   * If outputDir doesn't exist yet there is nothing to back up.
   */
  private async createBackup(
    outputDir: string,
    backupDir: string,
    ctx: PipelineContext
  ): Promise<void> {
    const exists = await fs
      .stat(outputDir)
      .then((s) => s.isDirectory())
      .catch(() => false);

    if (!exists) {
      ctx.log("info", "No existing output directory — skipping backup");
      return;
    }

    // Remove any stale backup from a previous failed run
    await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {});

    await this.copyDir(outputDir, backupDir);
    ctx.log("info", `Backup created: ${backupDir}`);
  }

  /**
   * Error #10: Restore outputDir from backupDir after a failed pipeline run.
   */
  private async rollback(
    outputDir: string,
    backupDir: string,
    ctx: PipelineContext
  ): Promise<void> {
    const backupExists = await fs
      .stat(backupDir)
      .then((s) => s.isDirectory())
      .catch(() => false);

    if (!backupExists) {
      // Nothing to restore — just clean up the partial output
      ctx.log("warn", "No backup found — removing partial output directory");
      await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
      return;
    }

    ctx.log("info", "Rolling back to pre-conversion state...");
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
    await this.copyDir(backupDir, outputDir);
    await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {});
    ctx.log("info", "Rollback complete — output directory restored");
  }

  /** Recursive directory copy helper */
  private async copyDir(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await this.copyDir(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  private buildResult(
    ctx: PipelineContext,
    status: "success" | "failed",
    error?: Error
  ): BuildResult {
    const stages = ctx.getStages();
    const totalMs = stages.reduce((sum, s) => sum + (s.durationMs ?? 0), 0);

    return {
      status,
      installerPath: ctx.installerPath,
      detectionResult: ctx.detection,
      stages: stages.map((s) => ({
        name: s.name,
        status: s.status,
        durationMs: s.durationMs,
        error: s.error,
      })),
      logs: ctx.getLogs(),
      totalDurationMs: totalMs,
      error: error?.message,
    };
  }
}

export interface PipelineOptions {
  /** Called for every log line emitted by the pipeline (use for streaming) */
  onLog?: (entry: { level: string; message: string; stage?: string; timestamp: Date }) => void;
}
