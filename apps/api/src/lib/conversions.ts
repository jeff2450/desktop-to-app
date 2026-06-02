import type { Artifact, Job, JobStatus } from "@prisma/client";

type ConversionStatus = "queued" | "running" | "done" | "failed" | "cancelled";

type ConversionMode = "online";

type JobWithArtifacts = Job & { artifacts?: Artifact[] };

type ConversionExtras = {
  estimatedWait?: number;
  liveLogLines?: unknown[];
  progress?: number;
};

const VALID_MODES = new Set<ConversionMode>(["online"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toIso(value: Date | null | undefined): string | undefined {
  return value ? value.toISOString() : undefined;
}

export function toConversionStatus(
  status: JobStatus | string | null | undefined,
): ConversionStatus {
  switch ((status ?? "").toUpperCase()) {
    case "QUEUED":
      return "queued";
    case "RUNNING":
      return "running";
    case "SUCCESS":
      return "done";
    case "FAILED":
      return "failed";
    case "CANCELLED":
      return "cancelled";
    default:
      return "queued";
  }
}

export function serializeConversion(
  job: JobWithArtifacts,
  extras: ConversionExtras = {},
) {
  const config = isRecord(job.config) ? job.config : {};
  const configuredMode = stringValue(config["mode"]);
  const sourceRepo = job.sourceRepo ?? "";
  const isUpload = sourceRepo.startsWith("upload:");
  const fallbackName = isUpload
    ? sourceRepo.replace(/^upload:/, "")
    : job.inputName || job.id;

  return {
    id: job.id,
    userId: job.userId,
    name: stringValue(config["name"]) ?? fallbackName,
    sourceType: isUpload ? "upload" : "github",
    sourceUrl: isUpload ? undefined : sourceRepo,
    mode:
      configuredMode && VALID_MODES.has(configuredMode as ConversionMode)
        ? configuredMode
        : "online",
    status: toConversionStatus(job.status),
    targets: job.platforms,
    artifacts: job.artifacts ?? [],
    errorMessage: job.errorMsg ?? undefined,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    completedAt: toIso(job.completedAt),
    estimatedWait: extras.estimatedWait,
    liveLogLines: extras.liveLogLines,
    progress: extras.progress,
  };
}
