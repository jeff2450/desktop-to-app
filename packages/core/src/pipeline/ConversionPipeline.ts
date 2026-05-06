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
    ctx.log("info", `Source: ${sourceDir}`);
    ctx.log("info", `Output: ${outputDir}`);
    ctx.log("info", `Targets: ${this.config.targets.join(", ")}`);

    try {
      // Stage 01 — Detect
      await runDetectStage(ctx);

      // Stage 02 — Plan
      await runPlanStage(ctx);

      // Stage 03 — Transform source files
      await runTransformStage(ctx);

      // Stage 04 — Scaffold Electron + backend files
      await runScaffoldStage(ctx);

      // Stage 05 — Install dependencies
      await runInstallStage(ctx);

      // Stage 06 — Vite build
      await runBuildStage(ctx);

      // Stage 07 — Package installer
      await runPackageStage(ctx);

      // Stage 07b — Mobile (Android/iOS) — skipped if no mobile targets
      await runMobileStage(ctx);

      return this.buildResult(ctx, "success");
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      ctx.log("error", `Pipeline failed: ${error.message}`);
      return this.buildResult(ctx, "failed", error);
    } finally {
      // Clean up temp dir
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
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
