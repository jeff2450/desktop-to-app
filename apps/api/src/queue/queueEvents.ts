import { QueueEvents } from "bullmq";
import { redisConnection, type ConversionJobResult } from "./conversionQueue.js";
import { db } from "../db/client.js";
import { conversions } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { broadcast } from "../workers/logStreamer.js";

/**
 * QueueEvents listens to Redis Pub/Sub events emitted by BullMQ workers
 * and keeps the `conversions` table in sync with job state changes.
 *
 * This runs in the main API process (not the worker process).
 */
export function startQueueEvents(): void {
  const events = new QueueEvents("conversions", {
    connection: redisConnection,
  });

  events.on("active", async ({ jobId }) => {
    await updateStatus(jobId, "detecting");
    broadcast(jobId, { type: "status", status: "detecting" });
  });

  events.on("progress", async ({ jobId, data }) => {
    const progress = data as { stage: string; message: string };
    broadcast(jobId, { type: "log", ...progress });

    // Map stage name to conversion status
    const statusMap: Record<string, string> = {
      "01-detect":    "detecting",
      "02-plan":      "planning",
      "03-transform": "transforming",
      "04-scaffold":  "scaffolding",
      "05-install":   "installing",
      "06-build":     "building",
      "07-package":   "packaging",
    };

    const status = statusMap[progress.stage];
    if (status) {
      await updateStatus(jobId, status as Parameters<typeof updateStatus>[1]);
      broadcast(jobId, { type: "status", status });
    }
  });

  events.on("completed", async ({ jobId, returnvalue }) => {
    const result = (returnvalue as unknown) as ConversionJobResult;

    await db
      .update(conversions)
      .set({
        status: "done",
        installerUrl: result.installerUrl,
        installerSize: result.installerSize,
        durationMs: result.durationMs,
        detectionResult: result.detectionResult,
        planSummary: result.planSummary,
        completedAt: new Date(),
      })
      .where(eq(conversions.jobId, jobId));

    broadcast(jobId, {
      type: "completed",
      installerUrl: result.installerUrl,
      durationMs: result.durationMs,
    });

    console.log(`[queue] Job ${jobId} completed in ${result.durationMs}ms`);
  });

  events.on("failed", async ({ jobId, failedReason }) => {
    await db
      .update(conversions)
      .set({
        status: "failed",
        errorMessage: failedReason,
        completedAt: new Date(),
      })
      .where(eq(conversions.jobId, jobId));

    broadcast(jobId, { type: "failed", error: failedReason });
    console.error(`[queue] Job ${jobId} failed: ${failedReason}`);
  });

  events.on("error", (err) => {
    console.error("[queue-events] Error:", err);
  });

  console.log("[queue] Queue event listener started");
}

async function updateStatus(
  jobId: string,
  status: typeof conversions.$inferInsert["status"]
): Promise<void> {
  await db
    .update(conversions)
    .set({ status, updatedAt: new Date() })
    .where(eq(conversions.jobId, jobId))
    .catch((err) => console.error(`[queue] Failed to update status for ${jobId}:`, err));
}
