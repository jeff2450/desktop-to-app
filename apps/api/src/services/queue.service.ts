import { Job as BullJob, Queue, Worker, type Processor } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../config/env.js";

export interface ConversionQueuePayload {
  jobId: string;
  /** Absolute path to uploaded zip (set when job was created via file upload) */
  zipPath?: string;
}

// ── Redis connection (lazy / fault-tolerant) ──────────────────────────────────
// Redis is only required for conversion job queuing.
// Auth, registration, and billing all work without it.

let _connection: Redis | null = null;
let _redisAvailable = false;

function createConnection(): Redis {
  const conn = new Redis(env.REDIS_URL!, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    // Don't keep retrying forever if Redis isn't installed
    retryStrategy: (times) => {
      if (times > 3) {
        console.warn("[redis] Redis is not available — conversion jobs will be disabled until Redis starts");
        return null; // stop retrying
      }
      return Math.min(times * 500, 2000);
    },
  });

  conn.on("ready", () => {
    _redisAvailable = true;
    console.log("[redis] ✓ Connected");
  });

  conn.on("error", (err) => {
    if (_redisAvailable) {
      console.error("[redis] connection error", err.message);
    }
    _redisAvailable = false;
  });

  return conn;
}

function getConnection(): Redis {
  if (!_connection) {
    _connection = createConnection();
  }
  return _connection;
}

export function getRedisConnection(): Redis {
  return getConnection();
}

export function isRedisAvailable(): boolean {
  return _redisAvailable;
}

// ── Queue (only instantiated when Redis becomes available) ────────────────────

let _queue: Queue<ConversionQueuePayload> | null = null;

function getQueue(): Queue<ConversionQueuePayload> {
  if (!_queue) {
    _queue = new Queue<ConversionQueuePayload>("conversion-jobs", {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 50,
        removeOnFail: 100,
      },
    });
  }
  return _queue;
}

// Export a proxy so callers can import `conversionQueue` without crashing
export const conversionQueue = new Proxy({} as Queue<ConversionQueuePayload>, {
  get(_target, prop) {
    return (getQueue() as any)[prop];
  },
});

export async function addJob(
  payload: ConversionQueuePayload,
  priority = 10
): Promise<BullJob<ConversionQueuePayload>> {
  if (!_redisAvailable) {
    throw new Error("Redis is not available. Please start Redis to enable conversion jobs.");
  }
  return getQueue().add("conversion", payload, { priority });
}

export async function getQueuedBullJob(
  jobId: string
): Promise<BullJob<ConversionQueuePayload> | undefined> {
  if (!_redisAvailable) return undefined;
  const jobs = await getQueue().getJobs(["waiting", "active", "prioritized", "delayed"]);
  return jobs.find((j) => j.data.jobId === jobId);
}

export async function estimateWaitSeconds(): Promise<number> {
  if (!_redisAvailable) return 0;
  const waitingCount = await getQueue().getWaitingCount();
  return waitingCount * 45;
}

/**
 * Stream a log line into Redis so /jobs/:id can poll in real-time.
 * No-ops safely when Redis is unavailable.
 */
export async function pushLogLine(jobId: string, line: string): Promise<void> {
  if (!_redisAvailable) return;
  const key = `logs:${jobId}`;
  const conn = getConnection();
  await conn.rpush(key, line);
  await conn.ltrim(key, -10000, -1);
  await conn.expire(key, 7 * 24 * 60 * 60);
}

/** Retrieve all buffered log lines from Redis (returns [] when Redis is down) */
export async function getLogLines(jobId: string): Promise<string[]> {
  if (!_redisAvailable) return [];
  return getConnection().lrange(`logs:${jobId}`, 0, -1);
}

/** Store job progress in Redis (0-100) */
export async function setJobProgress(jobId: string, progress: number): Promise<void> {
  if (!_redisAvailable) return;
  const key = `progress:${jobId}`;
  const conn = getConnection();
  await conn.set(key, String(progress));
  await conn.expire(key, 7 * 24 * 60 * 60);
}

/** Retrieve job progress from Redis (returns 0 if not found or Redis is down) */
export async function getJobProgress(jobId: string): Promise<number> {
  if (!_redisAvailable) return 0;
  const key = `progress:${jobId}`;
  const val = await getConnection().get(key);
  return val ? parseInt(val, 10) : 0;
}

export function createWorker(
  processor: Processor<ConversionQueuePayload>,
  concurrency = 2
): Worker<ConversionQueuePayload> {
  return new Worker<ConversionQueuePayload>("conversion-jobs", processor, {
    connection: getConnection(),
    concurrency,
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 100 },
    // Builds can take many minutes — check for stalls every 5 min and allow
    // only 1 stall before moving to failed (avoids infinite retry loops).
    stalledInterval: 5 * 60 * 1000, // 5 minutes
    maxStalledCount: 1,
  });
}

export async function closeQueueResources(): Promise<void> {
  if (_queue) await _queue.close();
  if (_connection) await _connection.quit();
}

// Kick off the connection attempt in the background (non-blocking)
getConnection();
