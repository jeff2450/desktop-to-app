import { Router } from "express";
import { db } from "../db/client.js";
import { sql } from "drizzle-orm";
import { getQueueMetrics } from "../queue/conversionQueue.js";
import { getActiveConnectionCount } from "../workers/logStreamer.js";

export const healthRouter: Router = Router();

// ── GET /api/health ───────────────────────────────────────────────────────────

healthRouter.get("/health", async (_req, res) => {
  const startMs = Date.now();

  // Check DB
  let dbOk = false;
  try {
    await db.execute(sql`SELECT 1`);
    dbOk = true;
  } catch {
    dbOk = false;
  }

  // Check queue
  let queueMetrics: Awaited<ReturnType<typeof getQueueMetrics>> | null = null;
  try {
    queueMetrics = await getQueueMetrics();
  } catch {
    // Redis may not be connected yet
  }

  const status = dbOk ? "ok" : "degraded";
  const responseMs = Date.now() - startMs;

  res.status(dbOk ? 200 : 503).json({
    status,
    version: process.env["npm_package_version"] ?? "1.0.0",
    uptime: Math.floor(process.uptime()),
    responseMs,
    checks: {
      database: dbOk ? "ok" : "error",
      redis: queueMetrics ? "ok" : "error",
    },
    queue: queueMetrics ?? null,
    sseConnections: getActiveConnectionCount(),
    timestamp: new Date().toISOString(),
  });
});

// ── GET /api/health/ready — Kubernetes readiness probe ────────────────────────

healthRouter.get("/health/ready", (_req, res) => {
  res.json({ ready: true });
});
