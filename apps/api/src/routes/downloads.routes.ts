import { Router } from "express";
import type { Artifact } from "@prisma/client";
import type { AuthenticatedRequest } from "../lib/types.js";
import { requireAuth } from "../middleware/auth.js";
import { getJob } from "../services/jobs.service.js";
import { generateSignedUrl } from "../services/storage.service.js";
import { ApiError } from "../lib/errors.js";

export const downloadsRouter: import("express").Router = Router();

downloadsRouter.use(requireAuth);

downloadsRouter.get("/:jobId/:platform", async (req, res, next) => {
  try {
    const authReq = req as unknown as AuthenticatedRequest;
    const job = await getJob(authReq.auth.userId, req.params["jobId"] ?? "");
    const platform = req.params["platform"] ?? "";
    const artifact = job.artifacts.find((item: Artifact) => item.platform === platform);

    if (!artifact) {
      throw new ApiError(404, "Artifact not found", "ARTIFACT_NOT_FOUND");
    }

    const url = await generateSignedUrl(artifact.s3Key);
    res.json({ url });
  } catch (error) {
    next(error);
  }
});
