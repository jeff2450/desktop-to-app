/**
 * /conversions routes — Session 4 spec-compliant endpoint names.
 *
 * POST   /conversions                — upload zip, queue conversion job
 * GET    /conversions                — list user's past conversions
 * GET    /conversions/:id            — get job status + real-time logs
 * GET    /conversions/:id/download   — download output installer (signed URL)
 * DELETE /conversions/:id            — cancel a queued/running job
 */
import { Router } from "express";
import { z } from "zod";
import type { Artifact } from "@prisma/client";
import type { AuthenticatedRequest } from "../lib/types.js";
import { requireAuth } from "../middleware/auth.js";
import { handleUpload, extractUploadedFiles } from "../middleware/upload.js";
import {
  cancelJob,
  deleteJob,
  createJob,
  createJobFromUpload,
  getJob,
  listJobs,
} from "../services/jobs.service.js";
import {
  generateSignedUrl,
  localPathForKey,
} from "../services/storage.service.js";
import { getLogLines, getJobProgress } from "../services/queue.service.js";
import { ApiError } from "../lib/errors.js";
import { serializeConversion, toConversionStatus } from "../lib/conversions.js";
import { useS3 } from "../config/env.js";
import fs from "node:fs";
import type { Response, Request } from "express";

/** Terminal job statuses — SSE stream closes once the job reaches one of these */
const TERMINAL_STATUSES = new Set(["SUCCESS", "FAILED", "CANCELLED"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const configSchema = z.preprocess(
  (val: unknown) => {
    if (isRecord(val)) {
      const targets = val["targets"] ?? val["platforms"];
      return { ...val, targets };
    }
    return val;
  },
  z.object({
    name: z.string().min(1),
    version: z.string().optional(),
    appId: z.string().regex(/^[a-z][a-z0-9]*(\.[a-z0-9-]+)+$/i),
    mode: z.enum(["offline", "online", "hybrid"]),
    targets: z
      .array(z.enum(["windows", "linux", "macos", "mac", "android", "ios"]))
      .min(1),
    output: z.string().optional(),
    icon: z.string().optional(),
    defaultAdminEmail: z.string().email().optional(),
    mobile: z
      .object({
        webDir: z.string().optional(),
        android: z
          .object({
            minSdkVersion: z.number().optional(),
            targetSdkVersion: z.number().optional(),
            buildVariant: z.enum(["debug", "release"]).optional(),
            artifactType: z.enum(["apk", "aab"]).optional(),
            keystorePath: z.string().optional(),
            keystoreAlias: z.string().optional(),
            keystorePassword: z.string().optional(),
            keystoreAliasPassword: z.string().optional(),
          })
          .optional(),
        ios: z
          .object({
            deploymentTarget: z.string().optional(),
            developmentTeam: z.string().optional(),
          })
          .optional(),
      })
      .optional(),
  }),
);

const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(50).default(10),
});

// JSON body for git/URL-based submissions (no file upload)
const createFromRepoSchema = z.preprocess(
  (val: unknown) => {
    if (isRecord(val)) {
      const sourceRepo = val["sourceRepo"] ?? val["sourceUrl"];
      const platforms = val["platforms"] ?? val["targets"];
      return { ...val, sourceRepo, platforms };
    }
    return val;
  },
  z.object({
    sourceRepo: z.string().min(1),
    config: configSchema,
    platforms: z
      .array(z.enum(["windows", "linux", "macos", "mac", "android", "ios"]))
      .min(1),
  }),
);

export const conversionsRouter: Router = Router();
conversionsRouter.use(requireAuth);

// ─── POST /conversions — upload zip ─────────────────────────────────────────

conversionsRouter.post("/", async (req: Request, res: Response, next) => {
  try {
    const authReq = req as unknown as AuthenticatedRequest;

    // Detect whether this is a multipart (zip upload / git with icon) or JSON (git/URL no icon) request
    const contentType = req.headers["content-type"] ?? "";
    const isMultipart = contentType.includes("multipart/form-data");

    if (isMultipart) {
      await handleUpload(req, res);
      const { archiveFile, iconFile } = extractUploadedFiles(req);

      if (archiveFile) {
        // ── Zip upload path ──────────────────────────────────────────────────
        const rawConfig = req.body["config"];
        if (!rawConfig) {
          throw new ApiError(
            400,
            "Missing 'config' field in form data (send as JSON string)",
            "MISSING_CONFIG",
          );
        }

        let parsedConfig: unknown;
        try {
          parsedConfig =
            typeof rawConfig === "string" ? JSON.parse(rawConfig) : rawConfig;
        } catch {
          throw new ApiError(
            400,
            "Invalid JSON in 'config' field",
            "INVALID_CONFIG",
          );
        }

        const config = configSchema.parse(parsedConfig);
        const platformsRaw = req.body["platforms"];
        const platforms = z
          .array(z.enum(["windows", "linux", "macos", "mac", "android", "ios"]))
          .min(1)
          .parse(
            typeof platformsRaw === "string"
              ? JSON.parse(platformsRaw)
              : platformsRaw,
          );

        const result = await createJobFromUpload({
          userId: authReq.auth.userId,
          plan: authReq.auth.plan,
          zipPath: archiveFile.path,
          zipName: archiveFile.originalname,
          iconPath: iconFile?.path,
          config,
          platforms,
        });

        res.status(201).json(
          serializeConversion(result.job, {
            estimatedWait: result.estimatedWait,
          }),
        );
      } else {
        // ── Git / URL path with icon upload ──────────────────────────────────
        const rawConfig = req.body["config"];
        const parsedConfig = typeof rawConfig === "string" ? JSON.parse(rawConfig) : rawConfig;
        const config = configSchema.parse(parsedConfig);

        const platformsRaw = req.body["platforms"];
        const platforms = z
          .array(z.enum(["windows", "linux", "macos", "mac", "android", "ios"]))
          .min(1)
          .parse(typeof platformsRaw === "string" ? JSON.parse(platformsRaw) : platformsRaw);

        const sourceRepo = (req.body["sourceRepo"] as string | undefined)?.trim() ?? "";
        if (!sourceRepo) {
          throw new ApiError(400, "Missing 'sourceRepo' field", "MISSING_SOURCE_REPO");
        }

        const result = await createJob({
          userId: authReq.auth.userId,
          plan: authReq.auth.plan,
          sourceRepo,
          config,
          platforms,
          iconPath: iconFile?.path,
        });

        res.status(201).json(
          serializeConversion(result.job, {
            estimatedWait: result.estimatedWait,
          }),
        );
      }
    } else {
      // ── Git / URL path with plain JSON ─────────────────────────────────────
      const body = createFromRepoSchema.parse(req.body);
      const sourceRepo = body.sourceRepo;
      const config = body.config;
      const platforms = body.platforms;

      const result = await createJob({
        userId: authReq.auth.userId,
        plan: authReq.auth.plan,
        sourceRepo,
        config,
        platforms,
      });

      res.status(201).json(
        serializeConversion(result.job, {
          estimatedWait: result.estimatedWait,
        }),
      );
    }
  } catch (error) {
    next(error);
  }
});

// ─── GET /conversions — list ─────────────────────────────────────────────────

conversionsRouter.get("/", async (req: Request, res: Response, next) => {
  try {
    const authReq = req as unknown as AuthenticatedRequest;
    const query = paginationSchema.parse(req.query);
    const result = await listJobs({ userId: authReq.auth.userId, ...query });

    const data = await Promise.all(
      result.data.map(async (job) => {
        const progress = await getJobProgress(job.id);
        return serializeConversion(job, { progress });
      })
    );

    res.json({
      ...result,
      data,
    });
  } catch (error) {
    next(error);
  }
});

// ─── GET /conversions/:id — status + logs ────────────────────────────────────

conversionsRouter.get("/:id", async (req: Request, res: Response, next) => {
  try {
    const authReq = req as unknown as AuthenticatedRequest;
    const job = await getJob(
      authReq.auth.userId,
      (req.params["id"] as string) ?? "",
    );

    // Enrich with any live Redis log lines not yet flushed to DB
    const liveLines = await getLogLines(job.id);
    const parsedLines = liveLines.map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return line;
      }
    });
    const progress = await getJobProgress(job.id);

    res.json(
      serializeConversion(job, {
        progress,
        // Prefer real-time Redis buffer while job is running; fall back to DB logs
        liveLogLines: parsedLines.length > 0 ? parsedLines : undefined,
      }),
    );
  } catch (error) {
    next(error);
  }
});

// ─── GET /conversions/:id/stream — SSE real-time log stream ─────────────────
//
// Events emitted:
//   data: {"type":"log","line":"..."} — one per log line
//   data: {"type":"status","status":"..."} — when job status changes
//   data: {"type":"ping"} — keepalive every 15 s
//   data: {"type":"done"} — stream end (terminal status reached)

conversionsRouter.get(
  "/:id/stream",
  async (req: Request, res: Response, next) => {
    try {
      const authReq = req as unknown as AuthenticatedRequest;
      const jobId = (req.params["id"] as string) ?? "";

      // Verify the job exists and belongs to this user (throws 404 otherwise)
      await getJob(authReq.auth.userId, jobId);

      // ── SSE headers ──────────────────────────────────────────────────────────
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
      res.flushHeaders();

      const send = (payload: Record<string, unknown>) => {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      };

      // ── Send all buffered lines and current progress immediately ─────────────
      let sentCount = 0;
      const initialLines = await getLogLines(jobId);
      for (const line of initialLines) {
        let parsed = line;
        try {
          parsed = JSON.parse(line);
        } catch {}
        send({ type: "log", line: parsed });
      }
      sentCount = initialLines.length;

      const initialProgress = await getJobProgress(jobId);
      send({ type: "progress", progress: initialProgress });

      // ── Periodic polling ─────────────────────────────────────────────────────
      let lastStatus = "";
      let lastProgress = initialProgress;
      let pingCount = 0;
      const POLL_MS = 500;
      const PING_EVERY = Math.ceil(15_000 / POLL_MS); // every 30 ticks ≈ 15 s

      const interval = setInterval(async () => {
        try {
          // Check job status
          const job = await getJob(authReq.auth.userId, jobId);

          if (job.status !== lastStatus) {
            lastStatus = job.status;
            send({ type: "status", status: toConversionStatus(job.status) });
          }

          const progress = await getJobProgress(jobId);
          if (progress !== lastProgress) {
            lastProgress = progress;
            send({ type: "progress", progress });
          }

          // Push any new log lines
          const allLines = await getLogLines(jobId);
          if (allLines.length > sentCount) {
            for (const line of allLines.slice(sentCount)) {
              let parsed = line;
              try {
                parsed = JSON.parse(line);
              } catch {}
              send({ type: "log", line: parsed });
            }
            sentCount = allLines.length;
          }

          // Keepalive ping
          pingCount++;
          if (pingCount % PING_EVERY === 0) {
            send({ type: "ping" });
          }

          // Close when terminal
          if (TERMINAL_STATUSES.has(job.status)) {
            send({ type: "done" });
            clearInterval(interval);
            res.end();
          }
        } catch {
          // If the job disappears, close gracefully
          clearInterval(interval);
          res.end();
        }
      }, POLL_MS);

      // ── Clean up if client disconnects ───────────────────────────────────────
      req.on("close", () => {
        clearInterval(interval);
      });
    } catch (error) {
      next(error);
    }
  },
);

// ─── GET /conversions/:id/download — signed download URL ────────────────────

conversionsRouter.get(
  "/:id/download",
  async (req: Request, res: Response, next) => {
    try {
      const authReq = req as unknown as AuthenticatedRequest;
      const job = await getJob(
        authReq.auth.userId,
        (req.params["id"] as string) ?? "",
      );
      const platform =
        (req.query["platform"] as string | undefined) ?? job.platforms[0];

      if (!platform) {
        throw new ApiError(
          400,
          "Specify a 'platform' query param",
          "MISSING_PLATFORM",
        );
      }

      const artifact = job.artifacts.find(
        (a: Artifact) => a.platform === platform,
      );
      if (!artifact) {
        throw new ApiError(
          404,
          `No artifact for platform '${platform}'. Available: ${job.artifacts.map((a: Artifact) => a.platform).join(", ") || "none yet"}`,
          "ARTIFACT_NOT_FOUND",
        );
      }

      const url = await generateSignedUrl(artifact.s3Key);
      res.json({ url, platform, sizeBytes: artifact.sizeBytes });
    } catch (error) {
      next(error);
    }
  },
);

// ─── GET /downloads/local/:key — dev-only local file serving ─────────────────

conversionsRouter.get(
  "/local-file/:key",
  async (req: Request, res: Response, next) => {
    try {
      if (useS3) {
        throw new ApiError(404, "Not found", "NOT_FOUND");
      }
      const key = decodeURIComponent((req.params["key"] as string) ?? "");
      const filePath = localPathForKey(key);

      if (!fs.existsSync(filePath)) {
        throw new ApiError(
          404,
          "Artifact file not found",
          "ARTIFACT_NOT_FOUND",
        );
      }

      res.download(filePath);
    } catch (error) {
      next(error);
    }
  },
);

// ─── DELETE /conversions/:id — cancel ────────────────────────────────────────

conversionsRouter.delete("/:id", async (req: Request, res: Response, next) => {
  try {
    const authReq = req as unknown as AuthenticatedRequest;
    const jobId = (req.params["id"] as string) ?? "";

    if (req.query["action"] === "cancel") {
      const job = await cancelJob(authReq.auth.userId, jobId);
      return res.json(serializeConversion(job));
    }

    const result = await deleteJob(authReq.auth.userId, jobId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});
