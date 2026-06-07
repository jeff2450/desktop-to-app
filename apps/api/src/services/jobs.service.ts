import type { Artifact, Job, JobStatus, Plan, Prisma } from "@prisma/client";
import { Plan as PlanEnum } from "@prisma/client";
import { startOfMonth } from "date-fns";
import { prisma } from "../db/prisma.js";
import { PlanLimitError, ApiError } from "../lib/errors.js";
import type { WebToAppConfig } from "../lib/types.js";
import { addJob, estimateWaitSeconds, getQueuedBullJob } from "./queue.service.js";

const ALL_PLATFORMS = ["windows", "linux", "macos", "mac", "android", "ios"];

const PLAN_LIMITS: Record<
  Plan,
  { monthlyLimit: number | null; platforms: string[]; priority: number }
> = {
  FREE:    { monthlyLimit: 1,    platforms: ALL_PLATFORMS, priority: 10 }, // Free plan: 1 conversion, all platforms
  STARTER: { monthlyLimit: 20,   platforms: ALL_PLATFORMS, priority: 5  }, // Pro plan: 20 conversions, all platforms
  PRO:     { monthlyLimit: 50,   platforms: ALL_PLATFORMS, priority: 3  }, // Team (semi-pro) plan: 50 conversions, all platforms
  ULTRA:   { monthlyLimit: 100,  platforms: ALL_PLATFORMS, priority: 1  }, // Ultra plan: 100 conversions, all platforms
};


// ─── Create job (zip upload path) ───────────────────────────────────────────

export async function createJobFromUpload(input: {
  userId: string;
  plan: Plan;
  zipPath: string;      // absolute path to uploaded zip on disk
  zipName: string;      // original filename shown to user
  iconPath?: string;    // optional path to uploaded icon file on disk
  keystorePath?: string;// optional path to uploaded keystore file on disk
  config: WebToAppConfig;
  platforms: string[];
}): Promise<{ job: Job; estimatedWait: number }> {
  const policy = PLAN_LIMITS[input.plan];
  await assertPlanLimits(input.userId, input.plan, policy, input.platforms);

  const job = await prisma.job.create({
    data: {
      userId: input.userId,
      sourceRepo: `upload:${input.zipName}`,
      config: input.config as unknown as Prisma.InputJsonValue,
      platforms: input.platforms,
      inputName: input.zipName,
    },
  });

  await addJob({ jobId: job.id, zipPath: input.zipPath, iconPath: input.iconPath, keystorePath: input.keystorePath }, policy.priority);
  const estimatedWait = await estimateWaitSeconds();

  return { job, estimatedWait };
}

// ─── Create job (git / URL path — legacy / power-user) ──────────────────────

export async function createJob(input: {
  userId: string;
  plan: Plan;
  sourceRepo: string;
  config: WebToAppConfig;
  platforms: string[];
  iconPath?: string;    // optional path to uploaded icon file on disk
  keystorePath?: string;// optional path to uploaded keystore file on disk
}): Promise<{ job: Job; estimatedWait: number }> {
  const policy = PLAN_LIMITS[input.plan];
  await assertPlanLimits(input.userId, input.plan, policy, input.platforms);

  const job = await prisma.job.create({
    data: {
      userId: input.userId,
      sourceRepo: input.sourceRepo,
      config: input.config as unknown as Prisma.InputJsonValue,
      platforms: input.platforms,
      inputName: input.sourceRepo,
    },
  });

  await addJob({ jobId: job.id, iconPath: input.iconPath, keystorePath: input.keystorePath }, policy.priority);
  const estimatedWait = await estimateWaitSeconds();

  return { job, estimatedWait };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function assertPlanLimits(
  userId: string,
  plan: Plan,
  policy: (typeof PLAN_LIMITS)[Plan],
  platforms: string[]
): Promise<void> {
  const jobsThisMonth = await prisma.job.count({
    where: {
      userId,
      createdAt: { gte: startOfMonth(new Date()) },
      status: { not: "CANCELLED" },
    },
  });

  if (policy.monthlyLimit !== null && jobsThisMonth >= policy.monthlyLimit) {
    throw new PlanLimitError(`You have reached your ${policy.monthlyLimit} conversion limit for this month. Upgrade your plan at /billing to continue.`);
  }


  const invalidPlatforms = platforms.filter((p) => !policy.platforms.includes(p));
  if (invalidPlatforms.length > 0) {
    throw new PlanLimitError(
      `Your ${plan} plan cannot build for: ${invalidPlatforms.join(", ")}. Upgrade at /billing.`
    );
  }
}

export async function listJobs(input: {
  userId: string;
  page: number;
  pageSize: number;
}): Promise<{ data: Array<Job & { artifacts: Artifact[] }>; total: number; page: number }> {
  const [data, total] = await Promise.all([
    prisma.job.findMany({
      where: {
        userId: input.userId,
        NOT: {
          inputName: { startsWith: "[DELETED]" }
        }
      },
      include: { artifacts: true },
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    prisma.job.count({
      where: {
        userId: input.userId,
        NOT: {
          inputName: { startsWith: "[DELETED]" }
        }
      }
    }),
  ]);

  return { data, total, page: input.page };
}

export async function getJob(
  userId: string,
  jobId: string
): Promise<Job & { artifacts: Artifact[] }> {
  const job = await prisma.job.findFirst({
    where: {
      id: jobId,
      userId,
      NOT: {
        inputName: { startsWith: "[DELETED]" }
      }
    },
    include: { artifacts: true },
  });

  if (!job) {
    throw new ApiError(404, "Job not found", "JOB_NOT_FOUND");
  }

  return job;
}

export async function cancelJob(userId: string, jobId: string): Promise<Job> {
  const job = await prisma.job.findFirst({ where: { id: jobId, userId } });

  if (!job) {
    throw new ApiError(404, "Job not found", "JOB_NOT_FOUND");
  }

  if (job.status !== "QUEUED" && job.status !== "RUNNING") {
    throw new ApiError(409, "Only queued or running jobs can be cancelled", "JOB_NOT_CANCELLABLE");
  }

  return prisma.job.update({
    where: { id: job.id },
    data: { status: "CANCELLED", completedAt: new Date() },
  });
}

export async function appendJobLog(jobId: string, line: string): Promise<void> {
  try {
    const existing = await prisma.job.findUnique({
      where: { id: jobId },
      select: { logs: true },
    });

    const nextLogs = existing?.logs ? `${existing.logs}\n${line}` : line;
    await prisma.job.update({ where: { id: jobId }, data: { logs: nextLogs } });
  } catch (err) {
    console.error(`[appendJobLog] Failed to append log line for job ${jobId}:`, err);
  }
}

export function getPlanLimit(plan: Plan): number | null {
  return PLAN_LIMITS[plan].monthlyLimit;
}

export function isPlanPlatformAllowed(plan: Plan, platform: string): boolean {
  return PLAN_LIMITS[plan].platforms.includes(platform);
}

export const defaultConfig = {
  version: "1.0.0",
  mode: "online",
  targets: ["linux"],
} satisfies Pick<WebToAppConfig, "version" | "mode" | "targets">;

export function getPlanLabel(plan: Plan): Plan {
  return plan ?? PlanEnum.FREE;
}

export async function deleteJob(
  userId: string,
  jobId: string
): Promise<{ id: string; success: boolean }> {
  const job = await prisma.job.findFirst({
    where: {
      id: jobId,
      userId,
      NOT: {
        inputName: { startsWith: "[DELETED]" }
      }
    }
  });

  if (!job) {
    throw new ApiError(404, "Job not found", "JOB_NOT_FOUND");
  }

  // If active, try to cancel it / remove from queue
  if (job.status === "QUEUED" || job.status === "RUNNING") {
    try {
      const bullJob = await getQueuedBullJob(job.id);
      if (bullJob) {
        await bullJob.remove();
      }
    } catch (err) {
      console.warn(`Failed to remove job ${job.id} from queue:`, err);
    }
  }

  // Delete associated artifacts from the database to clean up storage references
  await prisma.artifact.deleteMany({
    where: { jobId: job.id },
  });

  // Soft delete the job record by marking it
  await prisma.job.update({
    where: { id: job.id },
    data: {
      inputName: `[DELETED] ${job.inputName}`,
      logs: null,
      outputPath: null,
    },
  });

  return { id: jobId, success: true };
}
