// ─── Main pipeline ─────────────────────────────────────────────────────────
export { ConversionPipeline } from "./pipeline/ConversionPipeline.js";
export type { PipelineOptions } from "./pipeline/ConversionPipeline.js";
export { PipelineContext } from "./pipeline/PipelineContext.js";
export type { StageStatus, StageRecord, LogLevel, LogEntry } from "./pipeline/PipelineContext.js";

// ─── Types ──────────────────────────────────────────────────────────────────
export type { ConversionConfig, BackendConfig, AuthConfig, DatabaseConfig } from "./types/ConversionConfig.js";
export type { DetectionResult } from "./types/DetectionResult.js";
export type { MigrationPlan, FileTransformPlan, FileGeneratePlan } from "./types/MigrationPlan.js";
export type { BuildResult, StageSummary } from "./types/BuildResult.js";
