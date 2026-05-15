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
import { pushLogLine, createWorker, type ConversionQueuePayload } from "../services/queue.service.js";
import { uploadArtifact } from "../services/storage.service.js";
import type { WebToAppConfig } from "../lib/types.js";

const PLATFORM_TARGET_MAP: Record<string, "windows" | "linux" | "mac"> = {
  windows: "windows",
  linux:   "linux",
  macos:   "mac",
};

// ─── Main job processor ──────────────────────────────────────────────────────

async function runWorkerJob(payload: ConversionQueuePayload): Promise<void> {
  const jobRecord = await prisma.job.findUnique({ where: { id: payload.jobId } });
  if (!jobRecord || jobRecord.status === "CANCELLED") return;

  await prisma.job.update({
    where: { id: jobRecord.id },
    data: { status: "RUNNING", logs: "" },
  });

  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), `webtoapp-${jobRecord.id}-`));

  const log = async (msg: string): Promise<void> => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    // Stream to Redis for real-time polling AND persist to DB
    await Promise.all([
      pushLogLine(jobRecord.id, line),
      appendJobLog(jobRecord.id, line),
    ]);
  };

  try {
    const sourceDir = await materializeSource(
      jobRecord.sourceRepo,
      payload.zipPath,
      tempRoot,
      log
    );

    const rawConfig = jobRecord.config as unknown as WebToAppConfig;

    for (const platform of jobRecord.platforms) {
      await ensureNotCancelled(jobRecord.id);

      await log(`▶ Starting build for platform: ${platform}`);

      const outputDir = path.join(tempRoot, `output-${platform}`);
      const pipeline = new ConversionPipeline(
        {
          name: rawConfig.name,
          version: rawConfig.version ?? "1.0.0",
          source: sourceDir,
          output: outputDir,
          targets: [PLATFORM_TARGET_MAP[platform] ?? "linux"],
          mode: rawConfig.mode,
          appId: rawConfig.appId,
          backend: { type: "express", port: 3001 },
          auth: { type: "local", defaultAdmin: rawConfig.defaultAdminEmail },
          database: { type: "sqlite" },
          cleanLogs: false,
        },
        {
          onLog: async (entry) => {
            const line = `[${entry.timestamp.toISOString()}] ${entry.stage ? `[${entry.stage}] ` : ""}${entry.message}`;
            await Promise.all([
              pushLogLine(jobRecord.id, line),
              appendJobLog(jobRecord.id, line),
            ]);
            await ensureNotCancelled(jobRecord.id);
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

    await prisma.job.update({
      where: { id: jobRecord.id },
      data: { status: "SUCCESS", completedAt: new Date() },
    });

    await log("✅ All platforms built successfully.");

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
}, 2);

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
