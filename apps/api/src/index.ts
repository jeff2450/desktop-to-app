import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import { env } from "./config/env.js";
import { prisma } from "./db/prisma.js";
import { authRouter } from "./routes/auth.routes.js";
import { billingRouter } from "./routes/billing.routes.js";
import { downloadsRouter } from "./routes/downloads.routes.js";
import { jobsRouter } from "./routes/jobs.routes.js";
import { conversionsRouter } from "./routes/conversions.routes.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { globalRateLimiter } from "./middleware/rateLimiter.js";
import { closeQueueResources } from "./services/queue.service.js";

const app = express();

// ── Security ────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(
  cors({
    origin: env.DASHBOARD_URL ?? true,
    credentials: true,
  })
);
app.use(compression());
app.use(globalRateLimiter);

// ── Webhooks MUST arrive before express.json() ──────────────────────────────
app.use("/billing/webhooks", billingRouter);

// ── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ── Health ───────────────────────────────────────────────────────────────────
app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: "degraded", reason: "database unreachable" });
  }
});

// ── Routes ───────────────────────────────────────────────────────────────────
app.use("/api/auth",        authRouter);
app.use("/api/jobs",        jobsRouter);         // legacy route (kept for backwards compat)
app.use("/api/conversions", conversionsRouter);  // Session 4 spec route
app.use("/api/downloads",   downloadsRouter);    // /downloads/:jobId/:platform
app.use("/api/billing",     billingRouter);

app.use(notFoundHandler);
app.use(errorHandler);

// ── Start ────────────────────────────────────────────────────────────────────
const server = app.listen(env.PORT, () => {
  console.log(`[api] ✅ Listening on port ${env.PORT} (${env.NODE_ENV})`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[api] Received ${signal}, shutting down gracefully…`);
  server.close(async () => {
    await closeQueueResources();
    await prisma.$disconnect();
    console.log("[api] Shutdown complete.");
    process.exit(0);
  });
  // Force exit after 10 s
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT",  () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

