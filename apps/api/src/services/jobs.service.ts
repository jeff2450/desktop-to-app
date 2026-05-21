import type { Artifact, Job, JobStatus, Plan, Prisma } from "@prisma/client";
import { Plan as PlanEnum } from "@prisma/client";
import { startOfMonth } from "date-fns";
import { prisma } from "../db/prisma.js";
import { PlanLimitError, ApiError } from "../lib/errors.js";
import type { WebToAppConfig } from "../lib/types.js";
import { addJob, estimateWaitSeconds } from "./queue.service.js";

const PLAN_LIMITS: Record<
  Plan,
  { monthlyLimit: number | null; platforms: string[]; priority: number }
> = {
  FREE:    { monthlyLimit: 1,    platforms: ["windows", "linux", "macos"],     priority: 10 },
  STARTER: { monthlyLimit: 20,   platforms: ["windows", "linux", "macos"],     priority: 5  },
  PRO:     { monthlyLimit: null, platforms: ["windows", "linux", "macos"],     priority: 1  },
};

// ─── Create job (zip upload path) ───────────────────────────────────────────

export async function createJobFromUpload(input: {
  userId: string;
  plan: Plan;
  zipPath: string;      // absolute path to uploaded zip on disk
  zipName: string;      // original filename shown to user
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

  await addJob({ jobId: job.id, zipPath: input.zipPath }, policy.priority);
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

  await addJob({ jobId: job.id }, policy.priority);
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
    throw new PlanLimitError("You have used your 1 free conversion. Upgrade or pay from Billing to convert another app.");
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
      where: { userId: input.userId },
      include: { artifacts: true },
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    prisma.job.count({ where: { userId: input.userId } }),
  ]);

  return { data, total, page: input.page };
}

export async function getJob(
  userId: string,
  jobId: string
): Promise<Job & { artifacts: Artifact[] }> {
  const job = await prisma.job.findFirst({
    where: { id: jobId, userId },
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
  const existing = await prisma.job.findUnique({
    where: { id: jobId },
    select: { logs: true },
  });

  const nextLogs = existing?.logs ? `${existing.logs}\n${line}` : line;
  await prisma.job.update({ where: { id: jobId }, data: { logs: nextLogs } });
}

export function getPlanLimit(plan: Plan): number | null {
  return PLAN_LIMITS[plan].monthlyLimit;
}

export function isPlanPlatformAllowed(plan: Plan, platform: string): boolean {
  return PLAN_LIMITS[plan].platforms.includes(platform);
}

export const defaultConfig = {
  version: "1.0.0",
  mode: "offline",
  targets: ["linux"],
} satisfies Pick<WebToAppConfig, "version" | "mode" | "targets">;

export function getPlanLabel(plan: Plan): Plan {
  return plan ?? PlanEnum.FREE;
}
