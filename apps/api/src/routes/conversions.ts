import { Router } from "express";
import { db } from "../db/client.js";
import { conversions } from "../db/schema.js";
import { eq, desc, and } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { rateLimit, checkUsageLimit } from "../middleware/rateLimit.js";
import { enqueueConversion, cancelConversion } from "../queue/conversionQueue.js";
import { registerSseClient } from "../workers/logStreamer.js";

export const conversionsRouter: Router = Router();

const apiLimiter = rateLimit();

// ── GET /api/conversions — list user's conversions ────────────────────────────

conversionsRouter.get("/", requireAuth, apiLimiter, async (req, res) => {
  const user = (req as AuthenticatedRequest).user;
  try {
    const rows = await db
      .select()
      .from(conversions)
      .where(eq(conversions.userId, user.id))
      .orderBy(desc(conversions.createdAt))
      .limit(50);
    res.json({ data: rows });
  } catch (err) {
    console.error("[conversions] list error:", err);
    res.status(500).json({ error: "Failed to fetch conversions" });
  }
});

// ── GET /api/conversions/:id — get single conversion ─────────────────────────

conversionsRouter.get("/:id", requireAuth, async (req, res) => {
  const user = (req as AuthenticatedRequest).user;
  try {
    const [row] = await db
      .select()
      .from(conversions)
      .where(and(eq(conversions.id, req.params["id"]!), eq(conversions.userId, user.id)))
      .limit(1);

    if (!row) return res.status(404).json({ error: "Conversion not found" });
    res.json({ data: row });
  } catch (err) {
    console.error("[conversions] get error:", err);
    res.status(500).json({ error: "Failed to fetch conversion" });
  }
});

// ── POST /api/conversions — create and enqueue ────────────────────────────────

conversionsRouter.post("/", requireAuth, apiLimiter, checkUsageLimit, async (req, res) => {
  const user = (req as AuthenticatedRequest).user;
  const {
    name,
    sourceUrl,
    sourceType = "github",
    targets = ["windows"],
    appId,
    version = "1.0.0",
    mode = "offline",
  } = req.body as {
    name?: string;
    sourceUrl?: string;
    sourceType?: string;
    targets?: string[];
    appId?: string;
    version?: string;
    mode?: "offline" | "online" | "hybrid";
  };

  if (!name) return res.status(400).json({ error: "name is required" });
  if (!sourceUrl && sourceType !== "upload") {
    return res.status(400).json({ error: "sourceUrl is required" });
  }

  // GitHub cloning is not yet implemented — block it before creating a queue job
  if (sourceType === "github") {
    return res.status(501).json({
      error: "GitHub source type is not yet supported. Please upload a ZIP archive instead (sourceType: 'upload').",
    });
  }

  try {
    // Create conversion record
    const [conversion] = await db
      .insert(conversions)
      .values({
        userId: user.id,
        name,
        sourceUrl,
        sourceType,
        targets,
        status: "queued",
      })
      .returning();

    // Enqueue BullMQ job
    const job = await enqueueConversion({
      conversionId: conversion!.id,
      userId: user.id,
      sourceUrl: sourceUrl ?? "",
      sourceType: sourceType as "github" | "upload" | "zip",
      targets: targets as Array<"windows" | "linux" | "mac">,
      config: {
        name,
        version,
        appId: appId ?? `com.webtoapp.${name.toLowerCase().replace(/\s+/g, "")}`,
        mode,
      },
    });

    // Store job ID
    await db
      .update(conversions)
      .set({ jobId: job.id, startedAt: new Date() })
      .where(eq(conversions.id, conversion!.id));

    res.status(201).json({
      data: { ...conversion, jobId: job.id },
    });
  } catch (err) {
    console.error("[conversions] create error:", err);
    res.status(500).json({ error: "Failed to create conversion" });
  }
});

// ── DELETE /api/conversions/:id — cancel conversion ───────────────────────────

conversionsRouter.delete("/:id", requireAuth, async (req, res) => {
  const user = (req as AuthenticatedRequest).user;
  try {
    const [row] = await db
      .select()
      .from(conversions)
      .where(and(eq(conversions.id, req.params["id"]!), eq(conversions.userId, user.id)))
      .limit(1);

    if (!row) return res.status(404).json({ error: "Conversion not found" });
    if (row.status === "done") return res.status(400).json({ error: "Cannot cancel a completed conversion" });

    if (row.jobId) await cancelConversion(row.jobId);

    await db
      .update(conversions)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(conversions.id, row.id));

    res.json({ data: { id: row.id, status: "cancelled" } });
  } catch (err) {
    console.error("[conversions] cancel error:", err);
    res.status(500).json({ error: "Failed to cancel conversion" });
  }
});

// ── GET /api/conversions/:id/logs — SSE live log stream ──────────────────────

conversionsRouter.get("/:id/logs", requireAuth, async (req, res) => {
  const user = (req as AuthenticatedRequest).user;
  try {
    const [row] = await db
      .select({ id: conversions.id, jobId: conversions.jobId, userId: conversions.userId })
      .from(conversions)
      .where(and(eq(conversions.id, req.params["id"]!), eq(conversions.userId, user.id)))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Conversion not found" });
      return;
    }

    if (!row.jobId) {
      res.status(400).json({ error: "Conversion has no associated job" });
      return;
    }

    // Register SSE client — this keeps the response open
    registerSseClient(row.jobId, res);
  } catch (err) {
    console.error("[conversions] logs error:", err);
    res.status(500).json({ error: "Failed to open log stream" });
  }
});
