import type { DetectionResult } from "./DetectionResult.js";
import type { LogEntry } from "../pipeline/PipelineContext.js";

/**
 * The final result returned by ConversionPipeline.run().
 * Returned to CLI callers, API workers, and SaaS job consumers.
 */
export interface BuildResult {
  status: "success" | "failed";

  /** Absolute path to the generated installer file (only set on success) */
  installerPath?: string;

  /** Detection result from stage 01 */
  detectionResult?: DetectionResult;

  /** Per-stage summary */
  stages: StageSummary[];

  /** All log entries emitted during the run */
  logs: LogEntry[];

  /** Total pipeline duration in milliseconds */
  totalDurationMs: number;

  /** Error message (only set when status is "failed") */
  error?: string;
}

export interface StageSummary {
  name: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  durationMs?: number;
  error?: string;
}
