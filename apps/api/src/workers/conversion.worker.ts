/**
 * BullMQ conversion worker.
 *
 * Flow:
 *   1. Receive { jobId, zipPath? } from queue
 *   2. Materialise source: unzip uploaded file -OR- git clone / download URL
 *   3. Run ConversionPipeline from @webtoapp/core for each requested platform
 *   4. Upload output installer to S3 (or local outputs/ in dev)
 *   5. Mark job SUCCESS / FAILED in DB; log lines streamed to Redis in real-time
 */
import { JobStatus, type Prisma } from "@prisma/client";
import { ConversionPipeline } from "@webtoapp/core";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import unzipperModule from "unzipper";
const unzipper = (unzipperModule as any).default || unzipperModule;
import { prisma } from "../db/prisma.js";
import { appendJobLog } from "../services/jobs.service.js";
import { pushLogLine, setJobProgress, createWorker, type ConversionQueuePayload } from "../services/queue.service.js";
import { uploadArtifact } from "../services/storage.service.js";
import { sendBuildComplete, sendBuildFailed } from "../services/email.service.js";
import { env } from "../config/env.js";
import type { WebToAppConfig } from "../lib/types.js";

const PLATFORM_TARGET_MAP: Record<string, "windows" | "linux" | "mac" | "android" | "ios"> = {
  windows: "windows",
  linux:   "linux",
  macos:   "mac",
  mac:     "mac",
  android: "android",
  ios:     "ios",
};

function isPlatformBuildable(platform: string): boolean {
  const host = process.platform;
  if (platform === "windows") return host === "win32";
  if (platform === "linux") return host === "linux";
  if (platform === "macos" || platform === "mac" || platform === "ios") return host === "darwin";
  if (platform === "android") return true; // Android build uses capacitor which runs on any desktop OS
  return false;
}

const CURRENT_WORKER_PLATFORM =
  process.platform === "win32" ? "windows" :
  process.platform === "darwin" ? "macos" : "linux";

// ─── Progress checkpoints (0–100) ───────────────────────────────────────────
// These are approximate — they give the user a meaningful sense of advancement
// without needing fine-grained instrumentation inside the pipeline.
const PROGRESS = {
  STARTED:    5,
  SOURCE:     15,  // source materialised
  BUILD_BASE: 20,  // per-platform base (before pipeline runs)
  UPLOADING:  90,  // artifact uploading
  DONE:       100,
} as const;

// ─── Main job processor ──────────────────────────────────────────────────────

async function runWorkerJob(payload: ConversionQueuePayload): Promise<void> {
  const jobRecord = await prisma.job.findUnique({ where: { id: payload.jobId } });
  if (!jobRecord || jobRecord.status === "CANCELLED") {
    console.warn(`[worker] skipping job ${payload.jobId}: record not found or cancelled`);
    return;
  }

  try {
    await prisma.job.update({
      where: { id: jobRecord.id },
      data: { status: "RUNNING", logs: "" },
    });
  } catch (updateErr: any) {
    // P2025 = record not found — the DB row was deleted between findUnique and update
    if (updateErr?.code === "P2025") {
      console.warn(`[worker] skipping job ${payload.jobId}: DB record disappeared before update`);
      return;
    }
    throw updateErr;
  }

  await setJobProgress(jobRecord.id, PROGRESS.STARTED);

  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), `webtoapp-${jobRecord.id}-`));

  const log = async (msg: string, stageName = ""): Promise<void> => {
    const ts = new Date().toISOString();
    const line = `[${ts}] ${stageName ? `[${stageName}] ` : ""}${msg}`;
    await appendJobLog(jobRecord.id, line);
    const structuredLog = JSON.stringify({
      ts: new Date(ts).getTime(),
      stage: stageName,
      message: msg,
    });
    await pushLogLine(jobRecord.id, structuredLog);
  };

  try {
    const sourceDir = await materializeSource(
      jobRecord.sourceRepo,
      payload.zipPath,
      tempRoot,
      log
    );
    await setJobProgress(jobRecord.id, PROGRESS.SOURCE);

    const rawConfig = jobRecord.config as unknown as WebToAppConfig;
    const requestedPlatforms = jobRecord.platforms;
    const buildablePlatforms = requestedPlatforms.filter(isPlatformBuildable);
    const skippedPlatforms = requestedPlatforms.filter((platform) => !isPlatformBuildable(platform));

    if (skippedPlatforms.length > 0) {
      await log(
        `Skipping ${skippedPlatforms.join(", ")} on this ${CURRENT_WORKER_PLATFORM} worker. ` +
        "Those platforms need a worker running on their native OS."
      );
    }

    if (buildablePlatforms.length === 0) {
      throw new Error(
        `No selected platforms can be built on this ${CURRENT_WORKER_PLATFORM} worker. ` +
        `Selected: ${requestedPlatforms.join(", ")}.`
      );
    }

    // Each platform gets an equal slice of the BUILD_BASE → UPLOADING range
    const perPlatformSlice = Math.floor(
      (PROGRESS.UPLOADING - PROGRESS.BUILD_BASE) / buildablePlatforms.length
    );

    for (const [platformIdx, platform] of buildablePlatforms.entries()) {
      await ensureNotCancelled(jobRecord.id);
      const platformBaseProgress = PROGRESS.BUILD_BASE + platformIdx * perPlatformSlice;

      await log(`▶ Starting build for platform: ${platform}`);
      await setJobProgress(jobRecord.id, platformBaseProgress);

      const outputDir = path.join(tempRoot, `output-${platform}`);

      // Internal stage weights within a single platform build (add up to 100)
      // Used to interpolate progress inside the pipeline.
      const STAGE_WEIGHTS: Record<string, number> = {
        "01-detect":    8,
        "02-plan":      5,
        "03-transform": 15,
        "04-scaffold":  12,
        "05-install":   30,
        "06-build":     20,
        "07-package":   10,
      };
      let stageAccum = 0;
      const stageTotal = Object.values(STAGE_WEIGHTS).reduce((a, b) => a + b, 0);
      let lastStage = "";

      const pipeline = new ConversionPipeline(
        {
          name: rawConfig.name,
          version: rawConfig.version ?? "1.0.0",
          source: sourceDir,
          output: outputDir,
          targets: [PLATFORM_TARGET_MAP[platform] ?? platform as any],
          mode: rawConfig.mode,
          appId: rawConfig.appId,
          backend: { type: "express", port: 3001 },
          auth: { type: "local", defaultAdmin: rawConfig.defaultAdminEmail },
          database: { type: "sqlite" },
          cleanLogs: false,
          mobile: rawConfig.mobile,
        },
        {
          onLog: async (entry) => {
            const line = `[${entry.timestamp.toISOString()}] ${entry.stage ? `[${entry.stage}] ` : ""}${entry.message}`;
            await appendJobLog(jobRecord.id, line);
            const structuredLog = JSON.stringify({
              ts: entry.timestamp.getTime(),
              stage: entry.stage || "",
              message: entry.message,
            });
            await pushLogLine(jobRecord.id, structuredLog);
            await ensureNotCancelled(jobRecord.id);

            // Advance progress when a new pipeline stage starts
            if (entry.stage && entry.stage !== lastStage) {
              if (lastStage) {
                stageAccum += STAGE_WEIGHTS[lastStage] ?? 0;
              }
              lastStage = entry.stage;
              const stageRatio = stageAccum / stageTotal;
              const interpolated = Math.round(
                platformBaseProgress + stageRatio * perPlatformSlice
              );
              await setJobProgress(jobRecord.id, Math.min(interpolated, PROGRESS.UPLOADING - 1));
            }
          },
        }
      );

      const result = await pipeline.run();

      if (result.status !== "success" || !result.installerPath) {
        await log(`✗ Build failed for ${platform}: ${result.error ?? "unknown error"}`);
        await prisma.job.update({
          where: { id: jobRecord.id },
          data: { status: "FAILED", completedAt: new Date() },
        });
        return;
      }

      const artifactFileName = path.basename(result.installerPath);
      const s3Key = `artifacts/${jobRecord.id}/${platform}/${artifactFileName}`;

      await log(`↑ Uploading artifact: ${artifactFileName}`);
      await setJobProgress(jobRecord.id, PROGRESS.UPLOADING);
      await uploadArtifact(s3Key, fs.createReadStream(result.installerPath), getContentType(artifactFileName));

      const stats = await fsp.stat(result.installerPath);
      await prisma.artifact.create({
        data: {
          jobId:     jobRecord.id,
          platform,
          s3Key,
          sizeBytes: Number(stats.size),
        },
      });

      await log(`✓ Platform ${platform} complete — ${artifactFileName} (${formatBytes(Number(stats.size))})`);
    }

    await setJobProgress(jobRecord.id, PROGRESS.DONE);
    await prisma.job.update({
      where: { id: jobRecord.id },
      data: { status: "SUCCESS", completedAt: new Date() },
    });

    await log("✅ All platforms built successfully.");

    // Send completion email (non-blocking — failure here must not crash the job)
    try {
      const user = await prisma.user.findUnique({ where: { id: jobRecord.userId }, select: { email: true } });
      if (user?.email) {
        await sendBuildComplete(user.email, jobRecord.inputName ?? jobRecord.id, jobRecord.id, buildablePlatforms);
      }
    } catch (mailErr) {
      console.warn(`[worker] email notification failed for job ${jobRecord.id}:`, mailErr);
    }

  } catch (err) {
    const latest = await prisma.job.findUnique({
      where: { id: jobRecord.id },
      select: { status: true },
    });
    const nextStatus: JobStatus = latest?.status === "CANCELLED" ? "CANCELLED" : "FAILED";
    const errMsg = err instanceof Error ? err.message : String(err);
    await log(`✗ Worker error: ${errMsg}`);
    await prisma.job.update({
      where: { id: jobRecord.id },
      data: { status: nextStatus, completedAt: new Date() },
    });

    // Send failure email (non-blocking)
    if (nextStatus === "FAILED") {
      try {
        const user = await prisma.user.findUnique({ where: { id: jobRecord.userId }, select: { email: true } });
        if (user?.email) {
          await sendBuildFailed(user.email, jobRecord.inputName ?? jobRecord.id, jobRecord.id, errMsg);
        }
      } catch (mailErr) {
        console.warn(`[worker] failure email notification failed for job ${jobRecord.id}:`, mailErr);
      }
    }
  } finally {
    // Clean up temp directory regardless of outcome
    await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {/* ignore */});
    // Clean up uploaded zip if it was a file upload
    if (payload.zipPath) {
      await fsp.unlink(payload.zipPath).catch(() => {/* already gone */});
    }
  }
}

// ─── Source materialisation ──────────────────────────────────────────────────

async function materializeSource(
  sourceRepo: string,
  zipPath: string | undefined,
  tempRoot: string,
  log: (msg: string) => Promise<void>
): Promise<string> {
  const targetDir = path.join(tempRoot, "source");

  // 1. File upload: extract zip
  if (zipPath) {
    await log(`📦 Extracting uploaded archive…`);
    await fsp.mkdir(targetDir, { recursive: true });
    await new Promise<void>((resolve, reject) => {
      fs.createReadStream(zipPath)
        .pipe(unzipper.Extract({ path: targetDir }))
        .on("close", resolve)
        .on("error", reject);
    });
    // If the zip contained a single root folder, descend into it
    const entries = await fsp.readdir(targetDir);
    if (entries.length === 1) {
      const sub = path.join(targetDir, entries[0]!);
      const stat = await fsp.stat(sub);
      if (stat.isDirectory()) return sub;
    }
    return targetDir;
  }

  // 2. GitHub / git URL
  if (sourceRepo.includes("github.com") || sourceRepo.endsWith(".git")) {
    await log(`🔗 Cloning repository: ${sourceRepo}`);
    await runCommand("git", ["clone", "--depth", "1", sourceRepo, targetDir], tempRoot);
    return targetDir;
  }

  // 3. HTTP archive URL
  if (sourceRepo.startsWith("http://") || sourceRepo.startsWith("https://")) {
    await log(`⬇ Downloading archive: ${sourceRepo}`);
    const response = await fetch(sourceRepo);
    if (!response.ok) {
      throw new Error(`Failed to download source: HTTP ${response.status}`);
    }
    const archivePath = path.join(tempRoot, "source.zip");
    await fsp.writeFile(archivePath, Buffer.from(await response.arrayBuffer()));
    await fsp.mkdir(targetDir, { recursive: true });
    await new Promise<void>((resolve, reject) => {
      fs.createReadStream(archivePath)
        .pipe(unzipper.Extract({ path: targetDir }))
        .on("close", resolve)
        .on("error", reject);
    });
    return targetDir;
  }

  // 4. Already a local path (CI / testing)
  return sourceRepo;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "pipe" });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("exit", (code) => {
      code === 0 ? resolve() : reject(new Error(stderr || `${command} exited with code ${code}`));
    });
  });
}

async function ensureNotCancelled(jobId: string): Promise<void> {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { status: true } });
  if (job?.status === "CANCELLED") throw new Error("Job cancelled by user");
}

function getContentType(fileName: string): string {
  if (fileName.endsWith(".exe"))      return "application/vnd.microsoft.portable-executable";
  if (fileName.endsWith(".dmg"))      return "application/x-apple-diskimage";
  if (fileName.endsWith(".AppImage")) return "application/octet-stream";
  if (fileName.endsWith(".deb"))      return "application/vnd.debian.binary-package";
  if (fileName.endsWith(".rpm"))      return "application/x-rpm";
  if (fileName.endsWith(".apk"))      return "application/vnd.android.package-archive";
  if (fileName.endsWith(".aab"))      return "application/octet-stream";
  if (fileName.endsWith(".ipa"))      return "application/octet-stream";
  return "application/octet-stream";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ─── Worker bootstrap ────────────────────────────────────────────────────────

const worker = createWorker(async (bullJob) => {
  await runWorkerJob(bullJob.data);
}, env.WORKER_CONCURRENCY);

worker.on("failed", async (job, error) => {
  console.error(`[worker] job ${job?.data.jobId} failed: ${error.message}`);
  if (job?.data.jobId) {
    await appendJobLog(job.data.jobId, `Worker error: ${error.message}`).catch(() => {/* ignore */});
  }
});

worker.on("completed", (job) => {
  console.log(`[worker] job ${job.data.jobId} completed`);
});

process.on("SIGINT",  () => void worker.close());
process.on("SIGTERM", () => void worker.close());

console.log("[worker] Conversion worker started. Waiting for jobs…");

export { worker };
