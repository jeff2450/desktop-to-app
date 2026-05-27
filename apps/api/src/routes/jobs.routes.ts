import { Router } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../lib/types.js";
import { requireAuth } from "../middleware/auth.js";
import { cancelJob, deleteJob, createJob, getJob, listJobs } from "../services/jobs.service.js";

const configSchema = z.object({
  name: z.string().min(1),
  version: z.string().optional(),
  appId: z.string().regex(/^[a-z][a-z0-9]*(\.[a-z0-9-]+)+$/i),
  mode: z.enum(["offline", "online", "hybrid"]),
  targets: z.array(z.enum(["windows", "linux", "macos"])).min(1),
  output: z.string().optional(),
  icon: z.string().optional(),
  defaultAdminEmail: z.string().email().optional()
});

const createJobSchema = z.object({
  sourceRepo: z.string().min(1),
  config: configSchema,
  platforms: z.array(z.enum(["windows", "linux", "macos"])).min(1)
});

const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(50).default(10)
});

export const jobsRouter: import("express").Router = Router();

jobsRouter.use(requireAuth);

jobsRouter.post("/", async (req, res, next) => {
  try {
    const body = createJobSchema.parse(req.body);
    const authReq = req as unknown as AuthenticatedRequest;
    const result = await createJob({
      userId: authReq.auth.userId,
      plan: authReq.auth.plan,
      sourceRepo: body.sourceRepo,
      config: body.config,
      platforms: body.platforms
    });

    res.status(201).json({
      jobId: result.job.id,
      status: result.job.status,
      estimatedWait: result.estimatedWait
    });
  } catch (error) {
    next(error);
  }
});

jobsRouter.get("/", async (req, res, next) => {
  try {
    const authReq = req as unknown as AuthenticatedRequest;
    const query = paginationSchema.parse(req.query);
    const result = await listJobs({
      userId: authReq.auth.userId,
      page: query.page,
      pageSize: query.pageSize
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

jobsRouter.get("/:id", async (req, res, next) => {
  try {
    const authReq = req as unknown as AuthenticatedRequest;
    const job = await getJob(authReq.auth.userId, req.params["id"] ?? "");
    res.json(job);
  } catch (error) {
    next(error);
  }
});

jobsRouter.delete("/:id", async (req, res, next) => {
  try {
    const authReq = req as unknown as AuthenticatedRequest;
    const jobId   = req.params["id"] ?? "";

    if (req.query["action"] === "cancel") {
      const job = await cancelJob(authReq.auth.userId, jobId);
      return res.json(job);
    }

    const result = await deleteJob(authReq.auth.userId, jobId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});
