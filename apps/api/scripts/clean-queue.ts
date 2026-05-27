/**
 * One-off script: drain stalled / failed / waiting jobs from BullMQ.
 * Run with: npx tsx scripts/clean-queue.ts
 */
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../src/config/env.js";

const connection = new Redis(env.REDIS_URL!, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const queue = new Queue("conversion-jobs", { connection });

async function main() {
  console.log("🔍 Fetching queue counts before cleanup…");
  const counts = await queue.getJobCounts(
    "waiting", "active", "failed", "delayed", "paused"
  );
  console.table(counts);

  console.log("\n🧹 Cleaning failed jobs…");
  await queue.clean(0, 1000, "failed");

  console.log("🧹 Cleaning delayed jobs…");
  await queue.clean(0, 1000, "delayed");

  console.log("🧹 Cleaning waiting jobs…");
  await queue.clean(0, 1000, "wait");

  // Force-remove any active jobs that have gone stale (skip locked ones — they're running)
  const activeJobs = await queue.getActive();
  for (const job of activeJobs) {
    try {
      await job.remove();
      console.log(`⚠️  Removed stale active job: ${job.id} (appId: ${job.data.jobId})`);
    } catch {
      console.log(`ℹ️  Skipped active job ${job.id} (appId: ${job.data.jobId}) — locked by a live worker`);
    }
  }

  console.log("\n✅ Queue counts after cleanup:");
  const after = await queue.getJobCounts(
    "waiting", "active", "failed", "delayed", "paused"
  );
  console.table(after);

  await queue.close();
  await connection.quit();
  console.log("\n✅ Done. Queue is clean.");
}

main().catch((err) => {
  console.error("❌ Cleanup failed:", err);
  process.exit(1);
});
