import { Router } from "express";
import { db } from "../db/client.js";
import { conversions, downloads } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";

export const downloadsRouter: Router = Router();

// ── GET /api/downloads/:conversionId — generate presigned download URL ────────

downloadsRouter.get("/:conversionId", requireAuth, async (req, res) => {
  const user = (req as AuthenticatedRequest).user;

  try {
    const [conversion] = await db
      .select()
      .from(conversions)
      .where(
        and(
          eq(conversions.id, req.params["conversionId"]!),
          eq(conversions.userId, user.id)
        )
      )
      .limit(1);

    if (!conversion) {
      return res.status(404).json({ error: "Conversion not found" });
    }

    if (conversion.status !== "done") {
      return res.status(400).json({
        error: "Conversion is not yet complete",
        status: conversion.status,
      });
    }

    if (!conversion.installerUrl) {
      return res.status(404).json({ error: "No installer available for this conversion" });
    }

    // Generate presigned URL (S3 implementation in Session 5)
    // For now, return the stored URL directly
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    const [download] = await db
      .insert(downloads)
      .values({
        conversionId: conversion.id,
        userId: user.id,
        downloadUrl: conversion.installerUrl,
        expiresAt,
      })
      .returning();

    res.json({
      data: {
        downloadUrl: download!.downloadUrl,
        expiresAt: download!.expiresAt,
        installerSize: conversion.installerSize,
        conversionName: conversion.name,
      },
    });
  } catch (err) {
    console.error("[downloads] error:", err);
    res.status(500).json({ error: "Failed to generate download URL" });
  }
});

// ── POST /api/downloads/:id/confirm — mark as downloaded ─────────────────────

downloadsRouter.post("/:id/confirm", requireAuth, async (req, res) => {
  const user = (req as AuthenticatedRequest).user;
  try {
    await db
      .update(downloads)
      .set({ downloadedAt: new Date() })
      .where(
        and(eq(downloads.id, req.params["id"]!), eq(downloads.userId, user.id))
      );
    res.json({ data: { confirmed: true } });
  } catch (err) {
    console.error("[downloads] confirm error:", err);
    res.status(500).json({ error: "Failed to confirm download" });
  }
});
