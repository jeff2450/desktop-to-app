import { JobStatus, Prisma } from "@prisma/client";
import { ConversionPipeline } from "@webtoapp/core";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import { prisma } from "../db/prisma.js";
import { appendJobLog } from "../services/jobs.service.js";
import { createWorker, type ConversionQueuePayload } from "../services/queue.service.js";
import { uploadToS3 } from "../services/storage.service.js";
import type { WebToAppConfig } from "../lib/types.js";

const PLATFORM_TARGET_MAP: Record<string, "windows" | "linux" | "mac"> = {
  windows: "windows",
  linux: "linux",
  macos: "mac"
};

async function runWorkerJob(payload: ConversionQueuePayload): Promise<void> {
  const jobRecord = await prisma.job.findUnique({
    where: { id: payload.jobId }
  });

  if (!jobRecord) {
    return;
  }

  if (jobRecord.status === "CANCELLED") {
    return;
  }

  await prisma.job.update({
    where: { id: jobRecord.id },
    data: { status: "RUNNING", logs: "" }
  });

  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), `webtoapp-${jobRecord.id}-`));

  try {
    const sourceDir = await materializeSource(jobRecord.sourceRepo, tempRoot);
    const rawConfig = jobRecord.config as unknown as WebToAppConfig;

    for (const platform of jobRecord.platforms) {
      await ensureNotCancelled(jobRecord.id);

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
          cleanLogs: false
        },
        {
          onLog: async (entry) => {
            const line = `[${entry.timestamp.toISOString()}] ${entry.stage ? `${entry.stage} ` : ""}${entry.message}`;
            await appendJobLog(jobRecord.id, line);
            await ensureNotCancelled(jobRecord.id);
          }
        }
      );

      await appendJobLog(jobRecord.id, `Starting platform build: ${platform}`);
      const result = await pipeline.run();

      if (result.status !== "success" || !result.installerPath) {
        await prisma.job.update({
          where: { id: jobRecord.id },
          data: {
            status: "FAILED",
            completedAt: new Date(),
            logs: {
              set: `${(await getLogs(jobRecord.id))}\n${result.error ?? "Build failed"}`
            }
          }
        });
        return;
      }

      const artifactFileName = path.basename(result.installerPath);
      const s3Key = `artifacts/${jobRecord.id}/${platform}/${artifactFileName}`;
      await uploadToS3(s3Key, fs.createReadStream(result.installerPath), getContentType(artifactFileName));
      const stats = await fsp.stat(result.installerPath);

      await prisma.artifact.create({
        data: {
          jobId: jobRecord.id,
          platform,
          s3Key,
          sizeBytes: Number(stats.size)
        }
      });

      await appendJobLog(jobRecord.id, `Uploaded artifact for ${platform}: ${artifactFileName}`);
    }

    await prisma.job.update({
      where: { id: jobRecord.id },
      data: {
        status: "SUCCESS",
        completedAt: new Date()
      }
    });
  } catch (error) {
    const latestStatus = await prisma.job.findUnique({
      where: { id: jobRecord.id },
      select: { status: true }
    });
    const nextStatus: JobStatus = latestStatus?.status === "CANCELLED" ? "CANCELLED" : "FAILED";
    await appendJobLog(jobRecord.id, error instanceof Error ? error.message : String(error));
    await prisma.job.update({
      where: { id: jobRecord.id },
      data: {
        status: nextStatus,
        completedAt: new Date()
      }
    });
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

async function getLogs(jobId: string): Promise<string> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { logs: true }
  });
  return job?.logs ?? "";
}

async function ensureNotCancelled(jobId: string): Promise<void> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { status: true }
  });

  if (job?.status === "CANCELLED") {
    throw new Error("Job cancelled");
  }
}

async function materializeSource(sourceRepo: string, tempRoot: string): Promise<string> {
  const targetDir = path.join(tempRoot, "source");
  if (sourceRepo.includes("github.com")) {
    await runCommand("git", ["clone", "--depth", "1", sourceRepo, targetDir], tempRoot);
    return targetDir;
  }

  if (sourceRepo.startsWith("http://") || sourceRepo.startsWith("https://")) {
    const response = await fetch(sourceRepo);
    if (!response.ok) {
      throw new Error(`Failed to download source archive: ${response.status}`);
    }

    const archivePath = path.join(tempRoot, "source.zip");
    await fsp.writeFile(archivePath, Buffer.from(await response.arrayBuffer()));
    await runCommand("powershell", ["-Command", `Expand-Archive -LiteralPath "${archivePath}" -DestinationPath "${targetDir}" -Force`], tempRoot);
    return targetDir;
  }

  return sourceRepo;
}

function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "pipe" });
    let stderr = "";

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr || `${command} exited with code ${code}`));
      }
    });
  });
}

function getContentType(fileName: string): string {
  if (fileName.endsWith(".exe")) return "application/vnd.microsoft.portable-executable";
  if (fileName.endsWith(".dmg")) return "application/x-apple-diskimage";
  if (fileName.endsWith(".AppImage")) return "application/octet-stream";
  return "application/octet-stream";
}

const worker = createWorker(async (bullJob) => {
  await runWorkerJob(bullJob.data);
}, 2);

worker.on("failed", async (job, error) => {
  if (job?.data.jobId) {
    await appendJobLog(job.data.jobId, `Worker failure: ${error.message}`);
  }
});

export { worker };
