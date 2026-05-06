import { Queue, Worker, type Job } from "bullmq";
import { Redis as IORedis } from "ioredis";

if (!process.env["REDIS_URL"]) {
  throw new Error("REDIS_URL environment variable is required");
}

export const redisConnection = new IORedis(process.env["REDIS_URL"], {
  maxRetriesPerRequest: null, // required for BullMQ
  enableReadyCheck: false,
});

redisConnection.on("error", (err: Error) => {
  console.error("[redis] Connection error:", err.message);
});

// ── Queue definition ──────────────────────────────────────────────────────────

export interface ConversionJobData {
  conversionId: string;
  userId: string;
  sourceUrl: string;
  sourceType: "github" | "upload" | "zip";
  targets: Array<"windows" | "linux" | "mac">;
  config: {
    name: string;
    version: string;
    appId: string;
    mode?: "offline" | "online" | "hybrid";
    backendPort?: number;
  };
}

export interface ConversionJobResult {
  installerUrl?: string;
  installerSize?: number;
  durationMs: number;
  detectionResult?: Record<string, unknown>;
  planSummary?: string;
}

export const conversionQueue = new Queue<ConversionJobData, ConversionJobResult>(
  "conversions",
  {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 2,
      backoff: {
        type: "exponential",
        delay: 10_000, // 10s initial backoff
      },
      removeOnComplete: { count: 100 },  // keep last 100 completed
      removeOnFail: { count: 500 },      // keep last 500 failed for debugging
    },
  }
);

// ── Queue management helpers ──────────────────────────────────────────────────

/**
 * Enqueue a new conversion job.
 * Returns the BullMQ job so the API can store its ID.
 */
export async function enqueueConversion(
  data: ConversionJobData
): Promise<Job<ConversionJobData, ConversionJobResult>> {
  return conversionQueue.add(`convert-${data.conversionId}`, data, {
    jobId: data.conversionId, // use conversionId as jobId for easy lookup
    priority: getPriority(data),
  });
}

/**
 * Cancel a queued or active conversion.
 */
export async function cancelConversion(conversionId: string): Promise<boolean> {
  const job = await conversionQueue.getJob(conversionId);
  if (!job) return false;

  const state = await job.getState();
  if (state === "active") {
    await job.discard();
  } else {
    await job.remove();
  }
  return true;
}

/**
 * Get current queue metrics.
 */
export async function getQueueMetrics() {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    conversionQueue.getWaitingCount(),
    conversionQueue.getActiveCount(),
    conversionQueue.getCompletedCount(),
    conversionQueue.getFailedCount(),
    conversionQueue.getDelayedCount(),
  ]);
  return { waiting, active, completed, failed, delayed };
}

/**
 * Pro/team users get higher priority (lower number = higher priority in BullMQ).
 */
function getPriority(data: ConversionJobData): number {
  // Plan is not in job data — set priority based on config name length as proxy,
  // real impl should pass plan from the API route
  return 10; // default — upgraded in Session 5 when plan is available
}
