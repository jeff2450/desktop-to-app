import path from "node:path";
import type { ConversionConfig } from "../types/ConversionConfig.js";
import type { DetectionResult } from "../types/DetectionResult.js";
import type { MigrationPlan } from "../types/MigrationPlan.js";

export type StageStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface StageRecord {
  name: string;
  status: StageStatus;
  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;
  error?: string;
}

export type LogLevel = "info" | "warn" | "error" | "debug";

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Date;
  stage?: string;
}

/**
 * Shared mutable state that flows through every pipeline stage.
 * Stages read from it to get earlier results and write to it
 * to pass results forward.
 */
export class PipelineContext {
  readonly config: ConversionConfig;

  /** Absolute path to the source project (resolved from config.source) */
  readonly sourceDir: string;

  /** Absolute path where the output project will be written */
  readonly outputDir: string;

  /** Absolute path to the temp working directory for this run */
  readonly workDir: string;

  /** Populated by stage 01-detect */
  detection?: DetectionResult;

  /** Populated by stage 02-plan */
  plan?: MigrationPlan;

  /** Path to the final installer file, populated by stage 07-package */
  installerPath?: string;

  private readonly _stages: Map<string, StageRecord> = new Map();
  private readonly _logs: LogEntry[] = [];
  private _onLog?: (entry: LogEntry) => void;

  constructor(params: {
    config: ConversionConfig;
    sourceDir: string;
    outputDir: string;
    workDir: string;
    onLog?: (entry: LogEntry) => void;
  }) {
    this.config = params.config;
    this.sourceDir = params.sourceDir;
    this.outputDir = params.outputDir;
    this.workDir = params.workDir;
    this._onLog = params.onLog;
  }

  // ─── Stage tracking ────────────────────────────────────────────────────────

  startStage(name: string): void {
    this._stages.set(name, {
      name,
      status: "running",
      startedAt: new Date(),
    });
    this.log("info", `Starting stage: ${name}`, name);
  }

  completeStage(name: string): void {
    const stage = this._stages.get(name);
    if (!stage) return;
    const completedAt = new Date();
    stage.status = "done";
    stage.completedAt = completedAt;
    stage.durationMs = completedAt.getTime() - (stage.startedAt?.getTime() ?? 0);
    this.log("info", `Stage complete: ${name} (${stage.durationMs}ms)`, name);
  }

  failStage(name: string, error: Error): void {
    const stage = this._stages.get(name);
    if (!stage) return;
    stage.status = "failed";
    stage.error = error.message;
    stage.completedAt = new Date();
    this.log("error", `Stage failed: ${name} — ${error.message}`, name);
  }

  skipStage(name: string, reason: string): void {
    this._stages.set(name, { name, status: "skipped" });
    this.log("info", `Stage skipped: ${name} — ${reason}`, name);
  }

  getStages(): StageRecord[] {
    return Array.from(this._stages.values());
  }

  // ─── Logging ───────────────────────────────────────────────────────────────

  log(level: LogLevel, message: string, stage?: string): void {
    const entry: LogEntry = { level, message, timestamp: new Date(), stage };
    this._logs.push(entry);
    this._onLog?.(entry);

    if (this.config.verbose) {
      const prefix = stage ? `[${stage}]` : "[pipeline]";
      console[level === "error" ? "error" : "log"](`${prefix} ${message}`);
    }
  }

  getLogs(): LogEntry[] {
    return [...this._logs];
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /** True when the pipeline is configured to build for at least one target */
  get hasTargets(): boolean {
    return this.config.targets.length > 0;
  }

  /** Relative path from sourceDir to an absolute path */
  relative(absolutePath: string): string {
    return path.relative(this.sourceDir, absolutePath);
  }
}
