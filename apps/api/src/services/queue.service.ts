import { Job as BullJob, Queue, Worker, Processor } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../config/env.js";

export interface ConversionQueuePayload {
  jobId: string;
}

const connection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null
});

export const conversionQueue = new Queue<ConversionQueuePayload>("conversion-jobs", {
  connection,
  defaultJobOptions: {
    removeOnComplete: 50,
    removeOnFail: 100
  }
});

export function getRedisConnection(): Redis {
  return connection;
}

export async function addJob(
  payload: ConversionQueuePayload,
  priority: number
): Promise<BullJob<ConversionQueuePayload>> {
  return conversionQueue.add("conversion", payload, { priority });
}

export async function getJobStatus(jobId: string): Promise<BullJob<ConversionQueuePayload> | undefined> {
  const jobs = await conversionQueue.getJobs(["waiting", "active", "prioritized", "delayed"]);
  return jobs.find((job) => job.data.jobId === jobId);
}

export async function estimateWaitSeconds(): Promise<number> {
  const waitingCount = await conversionQueue.getWaitingCount();
  return waitingCount * 45;
}

export function createWorker(
  processor: Processor<ConversionQueuePayload>,
  concurrency = 2
): Worker<ConversionQueuePayload> {
  return new Worker<ConversionQueuePayload>("conversion-jobs", processor, {
    connection,
    concurrency
  });
}

export async function closeQueueResources(): Promise<void> {
  await conversionQueue.close();
  await connection.quit();
}
