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
import type { AuthenticatedRequest } from "../lib/types.js";
import { requireAuth } from "../middleware/auth.js";
import { handleUpload } from "../middleware/upload.js";
import {
  cancelJob,
  createJob,
  createJobFromUpload,
  getJob,
  listJobs,
} from "../services/jobs.service.js";
import { generateSignedUrl, localPathForKey } from "../services/storage.service.js";
import { getLogLines } from "../services/queue.service.js";
import { ApiError } from "../lib/errors.js";
import { useS3 } from "../config/env.js";
import fs from "node:fs";
import type { Response, Request } from "express";

const configSchema = z.object({
  name:               z.string().min(1),
  version:            z.string().optional(),
  appId:              z.string().regex(/^[a-z][a-z0-9]*(\.[a-z0-9-]+)+$/i),
  mode:               z.enum(["offline", "online", "hybrid"]),
  targets:            z.array(z.enum(["windows", "linux", "macos"])).min(1),
  output:             z.string().optional(),
  icon:               z.string().optional(),
  defaultAdminEmail:  z.string().email().optional(),
});

const paginationSchema = z.object({
  page:     z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(50).default(10),
});

// JSON body for git/URL-based submissions (no file upload)
const createFromRepoSchema = z.object({
  sourceRepo: z.string().min(1),
  config:     configSchema,
  platforms:  z.array(z.enum(["windows", "linux", "macos"])).min(1),
});

export const conversionsRouter: Router = Router();
conversionsRouter.use(requireAuth);

// ─── POST /conversions — upload zip ─────────────────────────────────────────

conversionsRouter.post("/", async (req: Request, res: Response, next) => {
  try {
    const authReq = req as unknown as AuthenticatedRequest;

    // Detect whether this is a multipart (zip upload) or JSON (git/URL) request
    const contentType = req.headers["content-type"] ?? "";

    if (contentType.includes("multipart/form-data")) {
      // ── Zip upload path ──────────────────────────────────────────────────
      await handleUpload(req, res);

      if (!authReq.file) {
        throw new ApiError(400, "No archive file provided. Upload a .zip as the 'archive' field.", "NO_FILE");
      }

      const rawConfig = req.body["config"];
      if (!rawConfig) {
        throw new ApiError(400, "Missing 'config' field in form data (send as JSON string)", "MISSING_CONFIG");
      }

      let parsedConfig: unknown;
      try {
        parsedConfig = typeof rawConfig === "string" ? JSON.parse(rawConfig) : rawConfig;
      } catch {
        throw new ApiError(400, "Invalid JSON in 'config' field", "INVALID_CONFIG");
      }

      const config = configSchema.parse(parsedConfig);
      const platformsRaw = req.body["platforms"];
      const platforms = z
        .array(z.enum(["windows", "linux", "macos"]))
        .min(1)
        .parse(
          typeof platformsRaw === "string" ? JSON.parse(platformsRaw) : platformsRaw
        );

      const result = await createJobFromUpload({
        userId:   authReq.auth.userId,
        plan:     authReq.auth.plan,
        zipPath:  authReq.file.path,
        zipName:  authReq.file.originalname,
        config,
        platforms,
      });

      res.status(201).json({
        conversionId:  result.job.id,
        status:        result.job.status,
        estimatedWait: result.estimatedWait,
      });
    } else {
      // ── Git / URL path (JSON body) ────────────────────────────────────────
      const body = createFromRepoSchema.parse(req.body);
      const result = await createJob({
        userId:     authReq.auth.userId,
        plan:       authReq.auth.plan,
        sourceRepo: body.sourceRepo,
        config:     body.config,
        platforms:  body.platforms,
      });

      res.status(201).json({
        conversionId:  result.job.id,
        status:        result.job.status,
        estimatedWait: result.estimatedWait,
      });
    }
  } catch (error) {
    next(error);
  }
});

// ─── GET /conversions — list ─────────────────────────────────────────────────

conversionsRouter.get("/", async (req: Request, res: Response, next) => {
  try {
    const authReq = req as unknown as AuthenticatedRequest;
    const query    = paginationSchema.parse(req.query);
    const result   = await listJobs({ userId: authReq.auth.userId, ...query });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ─── GET /conversions/:id — status + logs ────────────────────────────────────

conversionsRouter.get("/:id", async (req: Request, res: Response, next) => {
  try {
    const authReq = req as unknown as AuthenticatedRequest;
    const job     = await getJob(authReq.auth.userId, (req.params["id"] as string) ?? "");

    // Enrich with any live Redis log lines not yet flushed to DB
    const liveLines = await getLogLines(job.id);

    res.json({
      ...job,
      // Prefer real-time Redis buffer while job is running; fall back to DB logs
      liveLogLines: liveLines.length > 0 ? liveLines : undefined,
    });
  } catch (error) {
    next(error);
  }
});

// ─── GET /conversions/:id/download — signed download URL ────────────────────

conversionsRouter.get("/:id/download", async (req: Request, res: Response, next) => {
  try {
    const authReq  = req as unknown as AuthenticatedRequest;
    const job      = await getJob(authReq.auth.userId, (req.params["id"] as string) ?? "");
    const platform = (req.query["platform"] as string | undefined) ?? job.platforms[0];

    if (!platform) {
      throw new ApiError(400, "Specify a 'platform' query param", "MISSING_PLATFORM");
    }

    const artifact = job.artifacts.find((a) => a.platform === platform);
    if (!artifact) {
      throw new ApiError(
        404,
        `No artifact for platform '${platform}'. Available: ${job.artifacts.map((a) => a.platform).join(", ") || "none yet"}`,
        "ARTIFACT_NOT_FOUND"
      );
    }

    const url = await generateSignedUrl(artifact.s3Key);
    res.json({ url, platform, sizeBytes: artifact.sizeBytes });
  } catch (error) {
    next(error);
  }
});

// ─── GET /downloads/local/:key — dev-only local file serving ─────────────────

conversionsRouter.get("/local-file/:key", async (req: Request, res: Response, next) => {
  try {
    if (useS3) {
      throw new ApiError(404, "Not found", "NOT_FOUND");
    }
    const key      = decodeURIComponent((req.params["key"] as string) ?? "");
    const filePath = localPathForKey(key);

    if (!fs.existsSync(filePath)) {
      throw new ApiError(404, "Artifact file not found", "ARTIFACT_NOT_FOUND");
    }

    res.download(filePath);
  } catch (error) {
    next(error);
  }
});

// ─── DELETE /conversions/:id — cancel ────────────────────────────────────────

conversionsRouter.delete("/:id", async (req: Request, res: Response, next) => {
  try {
    const authReq = req as unknown as AuthenticatedRequest;
    const job     = await cancelJob(authReq.auth.userId, (req.params["id"] as string) ?? "");
    res.json(job);
  } catch (error) {
    next(error);
  }
});
