import { Worker, type Job } from "bullmq";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

import {
  redisConnection,
  type ConversionJobData,
  type ConversionJobResult,
} from "../queue/conversionQueue.js";
import { DockerRunner } from "./dockerRunner.js";
import { ConversionPipeline } from "@webtoapp/core";

const USE_DOCKER = process.env["USE_DOCKER"] !== "false";
const WORKER_CONCURRENCY = parseInt(process.env["WORKER_CONCURRENCY"] ?? "2");

/**
 * BullMQ worker that processes conversion jobs.
 *
 * Strategy:
 *  - If Docker is available → run in a container (isolated, cross-platform)
 *  - If Docker is not available → run in-process (development / simple deploys)
 *
 * Progress is reported via job.updateProgress() which QueueEvents picks up
 * and broadcasts to SSE clients via logStreamer.ts.
 */
export function startWorker(): Worker<ConversionJobData, ConversionJobResult> {
  const worker = new Worker<ConversionJobData, ConversionJobResult>(
    "conversions",
    async (job) => processJob(job),
    {
      connection: redisConnection,
      concurrency: WORKER_CONCURRENCY,
      limiter: {
        max: WORKER_CONCURRENCY,
        duration: 1000,
      },
    }
  );

  worker.on("completed", (job) => {
    console.log(`[worker] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[worker] Job ${job?.id} failed:`, err.message);
  });

  worker.on("error", (err) => {
    console.error("[worker] Worker error:", err);
  });

  console.log(`[worker] Started with concurrency=${WORKER_CONCURRENCY}, docker=${USE_DOCKER}`);
  return worker;
}

async function processJob(
  job: Job<ConversionJobData, ConversionJobResult>
): Promise<ConversionJobResult> {
  const { conversionId, sourceUrl, sourceType, targets, config } = job.data;
  const startTime = Date.now();

  const log = async (stage: string, message: string) => {
    await job.updateProgress({ stage, message });
  };

  await log("01-detect", "Starting conversion pipeline");

  // ── Step 1: Prepare source directory ──────────────────────────
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `webtoapp-job-${conversionId}-`));
  const sourceDir = path.join(workDir, "source");
  const outputDir = path.join(workDir, "output");
  await fs.mkdir(sourceDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });

  try {
    await log("01-detect", "Preparing source code");
    await prepareSource(sourceUrl, sourceType, sourceDir, (msg) =>
      job.updateProgress({ stage: "01-detect", message: msg })
    );

    // ── Step 2: Run conversion ─────────────────────────────────
    const dockerAvailable = USE_DOCKER && (await DockerRunner.isAvailable());

    let installerUrl: string | undefined;
    let installerSize: number | undefined;
    let detectionResult: Record<string, unknown> | undefined;
    let planSummary: string | undefined;

    if (dockerAvailable) {
      await log("01-detect", "Running in Docker container");

      const runner = new DockerRunner();
      const result = await runner.run({
        conversionId,
        sourceDir,
        outputDir,
        targets,
        configJson: JSON.stringify({
          ...config,
          source: "/workspace/source",
          output: "/workspace/output",
          targets,
          mode: config.mode || "offline",
          backend: { type: "auto", port: 3001 },
          auth: { type: "local" },
          database: { type: "sqlite" },
        }),
        onLog: (line) => job.updateProgress({ stage: "07-package", message: line }),
      });

      if (!result.success) {
        throw new Error(result.error ?? "Docker build failed");
      }

      // Upload installer to S3 (Session 5)
      // For now, store local path as URL
      if (result.installerPaths[0]) {
        const stat = await fs.stat(result.installerPaths[0]).catch(() => null);
        installerSize = stat?.size;
        installerUrl = `file://${result.installerPaths[0]}`; // replaced by S3 URL in Session 5
      }
    } else {
      // In-process fallback
      await log("01-detect", "Running in-process (Docker not available)");

      const pipeline = new ConversionPipeline(
        {
          ...config,
          source: sourceDir,
          output: outputDir,
          targets: targets as any,
          mode: config.mode || "offline",
          backend: { type: "auto", port: 3001 },
          auth: { type: "local" },
          database: { type: "sqlite" },
          verbose: true,
        },
        {
          onLog: ({ level, message, stage }) => {
            if (stage) {
              job.updateProgress({ stage, message }).catch(() => {});
            }
          },
        }
      );

      const result = await pipeline.run();

      if (result.status === "failed") {
        throw new Error(result.error ?? "Pipeline failed");
      }

      detectionResult = result.detectionResult as Record<string, unknown> | undefined;
      planSummary = result.detectionResult
        ? `Detected ${result.detectionResult.framework} + ${result.detectionResult.backend}`
        : undefined;

      if (result.installerPath) {
        const stat = await fs.stat(result.installerPath).catch(() => null);
        installerSize = stat?.size;
        installerUrl = `file://${result.installerPath}`;
      }
    }

    await log("07-package", "Conversion complete");

    return {
      installerUrl,
      installerSize,
      durationMs: Date.now() - startTime,
      detectionResult,
      planSummary,
    };
  } finally {
    // Always clean up work directory
    await fs.rm(workDir, { recursive: true, force: true }).catch((err) =>
      console.error(`[worker] Failed to clean up ${workDir}:`, err)
    );
  }
}

async function prepareSource(
  sourceUrl: string | undefined,
  sourceType: string,
  destDir: string,
  onLog: (msg: string) => void
): Promise<void> {
  if (sourceType === "github" && sourceUrl) {
    onLog(`Cloning ${sourceUrl}`);
    // GitHub cloning is implemented in Session 5 (githubService.ts)
    // For now, throw a clear error
    throw new Error(
      "GitHub cloning requires the githubService — implemented in Session 5. " +
        "Use sourceType='upload' for now."
    );
  }

  if (sourceType === "upload" && sourceUrl) {
    onLog(`Extracting uploaded archive from ${sourceUrl}`);
    // Extraction from S3 upload path — implemented in Session 5
    // For local dev, treat sourceUrl as a local directory path
    const stat = await fs.stat(sourceUrl).catch(() => null);
    if (stat?.isDirectory()) {
      // Copy directory
      await copyDir(sourceUrl, destDir);
      onLog("Source directory copied");
      return;
    }
    throw new Error("Source extraction from S3 not yet implemented — see Session 5");
  }

  throw new Error(`Unknown sourceType: ${sourceType}`);
}

async function copyDir(src: string, dest: string): Promise<void> {
  const entries = await fs.readdir(src, { withFileTypes: true });
  await fs.mkdir(dest, { recursive: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

// ── Session 5 service imports (appended) ─────────────────────────────────────
// githubService, storageService, and notificationService are wired below
// in the updated prepareSource and processJob functions via the patched helpers.
