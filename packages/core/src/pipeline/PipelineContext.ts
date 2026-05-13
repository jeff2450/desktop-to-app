import path from "node:path";
import fs from "node:fs/promises";
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

/** Ordered list of all stage names — used for resume logic */
const STAGE_ORDER = [
  "00-preflight",
  "01-detect",
  "02-plan",
  "03-transform",
  "04-scaffold",
  "05-install",
  "06-build",
  "07-package",
  "07b-mobile",
] as const;

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

  /**
   * Improvement #9: True when dry-run mode is active.
   * Stages should skip all file writes and npm installs,
   * but still log what they *would* do.
   */
  readonly dryRun: boolean;

  /** Populated by stage 01-detect */
  detection?: DetectionResult;

  /** Populated by stage 02-plan */
  plan?: MigrationPlan;

  /** Path to the final installer file, populated by stage 07-package */
  installerPath?: string;

  private readonly _stages: Map<string, StageRecord> = new Map();
  private readonly _logs: LogEntry[] = [];
  private _onLog?: (entry: LogEntry) => void;
  private _logFilePath?: string;
  private _stateFilePath: string;
  private _lastCompletedStage?: string;

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
    this.dryRun = params.config.dryRun ?? false;
    this._onLog = params.onLog;
    // Improvement #7: structured JSON log file path
    this._logFilePath = path.join(params.outputDir, "webtoapp-conversion.log");
    // Improvement #6: State persistence file path
    this._stateFilePath = path.join(params.outputDir, "webtoapp-state.json");
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
    // Flush logs and state to disk after every successful stage (improvement #6, #7)
    this.saveState().catch(() => {});
    this.flushLogs().catch(() => {});
  }

  failStage(name: string, error: Error): void {
    const stage = this._stages.get(name);
    if (!stage) return;
    stage.status = "failed";
    stage.error = error.message;
    stage.completedAt = new Date();
    this.log("error", `Stage failed: ${name} — ${error.message}`, name);
    // Flush logs so the log file is available for post-mortem analysis
    this.flushLogs().catch(() => {});
  }

  skipStage(name: string, reason: string): void {
    this._stages.set(name, { name, status: "skipped" });
    this.log("info", `Stage skipped: ${name} — ${reason}`, name);
  }

  getStages(): StageRecord[] {
    return Array.from(this._stages.values());
  }

  // ─── Improvement #8: Stage resume support ─────────────────────────────────

  /**
   * Returns true if this stage should be skipped because the user configured
   * resumeFromStage and this stage runs before the resume point.
   *
   * Usage inside each stage function:
   *   if (ctx.shouldSkipStage(STAGE)) {
   *     ctx.skipStage(STAGE, 'resuming from later stage');
   *     return;
   *   }
   */
  shouldSkipStage(stageName: string): boolean {
    const resumeFrom = this.config.resumeFromStage;
    if (resumeFrom) {
      const resumeIdx = STAGE_ORDER.indexOf(resumeFrom as typeof STAGE_ORDER[number]);
      const thisIdx   = STAGE_ORDER.indexOf(stageName  as typeof STAGE_ORDER[number]);
      if (resumeIdx !== -1 && thisIdx !== -1) return thisIdx < resumeIdx;
    }

    if (this._lastCompletedStage) {
      const lastIdx = STAGE_ORDER.indexOf(this._lastCompletedStage as typeof STAGE_ORDER[number]);
      const thisIdx = STAGE_ORDER.indexOf(stageName as typeof STAGE_ORDER[number]);
      if (lastIdx !== -1 && thisIdx !== -1) return thisIdx <= lastIdx;
    }

    return false;
  }

  async loadState(): Promise<void> {
    try {
      const data = await fs.readFile(this._stateFilePath, "utf-8");
      const state = JSON.parse(data);
      if (state.lastCompletedStage) {
        this._lastCompletedStage = state.lastCompletedStage;
        this.log("info", `Loaded state: last completed stage was ${this._lastCompletedStage}`);
      }
    } catch {
      // No state file or invalid, which is fine for a fresh run
    }
  }

  async saveState(): Promise<void> {
    if (this.dryRun) return;
    try {
      await fs.mkdir(path.dirname(this._stateFilePath), { recursive: true });
      const doneStages = this.getStages().filter(s => s.status === "done");
      if (doneStages.length > 0) {
        const last = doneStages[doneStages.length - 1]!.name;
        await fs.writeFile(this._stateFilePath, JSON.stringify({ lastCompletedStage: last }, null, 2), "utf-8");
      }
    } catch {
      // Non-fatal
    }
  }

  // ─── Logging ───────────────────────────────────────────────────────────────

  log(level: LogLevel, message: string, stage?: string): void {
    const entry: LogEntry = { level, message, timestamp: new Date(), stage };
    this._logs.push(entry);
    this._onLog?.(entry);

    // Always print errors; print others only when verbose or dryRun
    if (level === "error" || this.config.verbose || this.dryRun) {
      const prefix = stage ? `[${stage}]` : "[pipeline]";
      const tag = level === "error" ? "❌" : level === "warn" ? "⚠ " : "  ";
      console[level === "error" ? "error" : "log"](`${tag} ${prefix} ${message}`);
    }
  }

  getLogs(): LogEntry[] {
    return [...this._logs];
  }

  /**
   * Improvement #7: Flush all buffered log entries to a newline-delimited JSON
   * log file in the output directory. Safe to call multiple times.
   * Each line is a JSON object: { ts, level, stage, msg }
   */
  async flushLogs(): Promise<void> {
    if (!this._logFilePath) return;
    if (this.dryRun) return; // never write files in dry-run mode

    try {
      await fs.mkdir(path.dirname(this._logFilePath), { recursive: true });
      const lines = this._logs.map((e) =>
        JSON.stringify({
          ts:    e.timestamp.toISOString(),
          level: e.level,
          stage: e.stage ?? "pipeline",
          msg:   e.message,
        })
      );
      await fs.writeFile(this._logFilePath, lines.join("\n") + "\n", "utf-8");
    } catch {
      // Log file write failure is non-fatal — never crash the pipeline over it
    }
  }

  /**
   * Delete the on-disk log file produced by `flushLogs`.
   * Called automatically after a successful run when `config.cleanLogs` is true.
   * Safe to call multiple times — silently ignores missing files.
   */
  async deleteLogFile(): Promise<void> {
    if (!this._logFilePath) return;
    const target = this._logFilePath;
    this._logFilePath = undefined; // prevent future flushes from re-creating it
    try {
      await fs.unlink(target);
      this.log("info", `Log file deleted: ${target}`);
    } catch {
      // File may already be gone — not an error
    }
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
