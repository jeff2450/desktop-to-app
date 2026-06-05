import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

import type { ConversionConfig } from "../types/ConversionConfig.js";
import type { BuildResult } from "../types/BuildResult.js";
import { PipelineContext } from "./PipelineContext.js";
import { generateReport } from "../report/generateReport.js";

import { runDetectStage } from "./stages/01-detect.js";
import { runPlanStage } from "./stages/02-plan.js";
import { runTransformStage } from "./stages/03-transform.js";
import { runScaffoldStage } from "./stages/04-scaffold.js";
import { runInstallStage } from "./stages/05-install.js";
import { runBuildStage } from "./stages/06-build.js";
import { runParityStage } from "./stages/06b-parity.js";
import { runPackageStage } from "./stages/07-package.js";
import { runMobileStage } from "./stages/07b-mobile.js";
import { runSignStage } from "./stages/07c-sign.js";
import { runCiEmitStage } from "./stages/08-ci-emit.js";
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
    const isUrl = this.config.source.startsWith("http://") || this.config.source.startsWith("https://");
    const sourceDir = isUrl ? this.config.source : path.resolve(this.config.source);
    
    let defaultOutputDirName = "webtoapp-app-desktop";
    if (!isUrl) {
      defaultOutputDirName = `${path.basename(sourceDir)}-desktop`;
    } else {
      try {
        const u = new URL(this.config.source);
        defaultOutputDirName = `${u.hostname.replace(/\./g, "-")}-desktop`;
      } catch {}
    }

    const outputDir = path.resolve(
      this.config.output ?? (isUrl ? path.join(process.cwd(), defaultOutputDirName) : path.join(sourceDir, "..", defaultOutputDirName))
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
    
    // Auto-resume if state exists
    await ctx.loadState();
    await this.validateLoadedState(ctx);

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

      // Stage 06b - Behavior parity gate
      if (ctx.shouldSkipStage("06b-parity")) ctx.skipStage("06b-parity", "resuming from later stage");
      else await runParityStage(ctx);

      // Stage 07 - Package installer
      if (ctx.shouldSkipStage("07-package")) ctx.skipStage("07-package", "resuming from later stage");
      else await runPackageStage(ctx);

      // Stage 07b — Mobile (Android/iOS) — skipped if no mobile targets
      if (ctx.shouldSkipStage("07b-mobile")) ctx.skipStage("07b-mobile", "resuming from later stage");
      else await runMobileStage(ctx);

      // Stage 07c — Code signing validation (warns if certs are missing, never hard-fails)
      if (ctx.shouldSkipStage("07c-sign")) ctx.skipStage("07c-sign", "resuming from later stage");
      else await runSignStage(ctx);

      // Stage 08 — CI emit (writes .github/workflows/build.yml when ci.autoEmit=true)
      if (ctx.shouldSkipStage("08-ci-emit")) ctx.skipStage("08-ci-emit", "resuming from later stage");
      else await runCiEmitStage(ctx);

      // All stages succeeded — remove backup and flush logs
      await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {});
      await ctx.flushLogs();

      // If the user asked for a clean output, remove the log file after flushing
      if (this.config.cleanLogs) {
        await ctx.deleteLogFile();
      }

      ctx.log("info", "Conversion complete — backup removed");

      const successResult = this.buildResult(ctx, "success");

      // Generate migration health report
      await generateReport(successResult, outputDir).catch(() => {});
      ctx.log("info", "📄 Migration report: webtoapp-report.html");

      return successResult;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      ctx.log("error", `Pipeline failed: ${error.message}`);

      // Rollback to the state before conversion started
      await this.rollback(outputDir, backupDir, ctx);
      await ctx.flushLogs();

      const failedResult = this.buildResult(ctx, "failed", error);

      // Generate report even on failure so users can diagnose what went wrong
      await generateReport(failedResult, outputDir).catch(() => {});

      return failedResult;
    } finally {
      // Clean up temp dir
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async validateLoadedState(ctx: PipelineContext): Promise<void> {
    if (this.config.resumeFromStage || !ctx.getLastCompletedStage()) return;

    const isUrl = ctx.sourceDir.startsWith("http://") || ctx.sourceDir.startsWith("https://");
    if (isUrl) return;

    const outputHasPackageJson = await this.fileExists(path.join(ctx.outputDir, "package.json"));
    const outputHasSrc = await this.dirExists(path.join(ctx.outputDir, "src"));
    if (!outputHasPackageJson || !outputHasSrc) {
      ctx.discardLoadedState("output project is incomplete");
      return;
    }

    const sourceHasIndex = await this.fileExists(path.join(ctx.sourceDir, "index.html"));
    const outputHasIndex = await this.fileExists(path.join(ctx.outputDir, "index.html"));
    if (sourceHasIndex && !outputHasIndex) {
      ctx.discardLoadedState("output project is missing index.html");
      return;
    }

    const sourceHasViteConfig = await this.hasAnyFile(ctx.sourceDir, [
      "vite.config.ts",
      "vite.config.js",
      "vite.config.mts",
      "vite.config.mjs",
      "vite.config.cjs",
    ]);
    const outputHasViteConfig = await this.hasAnyFile(ctx.outputDir, [
      "vite.config.ts",
      "vite.config.js",
      "vite.config.mts",
      "vite.config.mjs",
      "vite.config.cjs",
    ]);
    if (sourceHasViteConfig && !outputHasViteConfig) {
      ctx.discardLoadedState("output project is missing Vite config");
    }
  }

  private async hasAnyFile(dir: string, names: string[]): Promise<boolean> {
    const results = await Promise.all(names.map((name) => this.fileExists(path.join(dir, name))));
    return results.some(Boolean);
  }

  private async fileExists(filePath: string): Promise<boolean> {
    return fs.stat(filePath).then((s) => s.isFile()).catch(() => false);
  }

  private async dirExists(dirPath: string): Promise<boolean> {
    return fs.stat(dirPath).then((s) => s.isDirectory()).catch(() => false);
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

    // Preserve state and log files during rollback
    const stateFile = path.join(outputDir, "webtoapp-state.json");
    const logFile = path.join(outputDir, "webtoapp-conversion.log");
    
    let stateData: string | null = null;
    let logData: string | null = null;
    try { stateData = await fs.readFile(stateFile, "utf-8"); } catch {}
    try { logData = await fs.readFile(logFile, "utf-8"); } catch {}

    if (!backupExists) {
      // Nothing to restore — just clean up the partial output
      ctx.log("warn", "No backup found — removing partial output directory");
      await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
    } else {
      ctx.log("info", "Rolling back to pre-conversion state...");
      await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
      await this.copyDir(backupDir, outputDir);
      await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {});
      ctx.log("info", "Rollback complete — output directory restored");
    }

    // Restore preserved files
    if (stateData) {
      await fs.mkdir(outputDir, { recursive: true }).catch(() => {});
      await fs.writeFile(stateFile, stateData, "utf-8");
    }
    if (logData) {
      await fs.mkdir(outputDir, { recursive: true }).catch(() => {});
      await fs.writeFile(logFile, logData, "utf-8");
    }
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
      artifactPaths: ctx.artifactPaths,
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
