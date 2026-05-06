import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";

import { healthRouter } from "./routes/health.js";
import { conversionsRouter } from "./routes/conversions.js";
import { downloadsRouter } from "./routes/downloads.js";
import { usersRouter } from "./routes/users.js";
import { startQueueEvents } from "./queue/queueEvents.js";
import { startWorker } from "./workers/conversionWorker.js";
import { closeDb } from "./db/client.js";
import { webhooksRouter } from "./routes/webhooks.js";
import { billingRouter } from "./routes/billing.js";

const PORT = parseInt(process.env["PORT"] ?? "3000");
const HOST = process.env["HOST"] ?? "0.0.0.0";

const ALLOWED_ORIGINS = (process.env["CORS_ORIGINS"] ?? "http://localhost:3001")
  .split(",")
  .map((o) => o.trim());

// ── App setup ─────────────────────────────────────────────────────────────────

const app = express();

app.use(helmet({
  crossOriginEmbedderPolicy: false, // allow SSE
}));
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin ${origin} not allowed`));
    }
  },
  credentials: true,
}));
app.use(compression());

// Webhooks must be mounted before express.json() to receive raw body
app.use("/api", webhooksRouter);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Trust proxy (for correct IP behind load balancer)
app.set("trust proxy", 1);

// ── Routes ────────────────────────────────────────────────────────────────────

app.use("/api", healthRouter);
app.use("/api", usersRouter);
app.use("/api", billingRouter);
app.use("/api/conversions", conversionsRouter);
app.use("/api/downloads", downloadsRouter);

// ── 404 ───────────────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ── Error handler ─────────────────────────────────────────────────────────────

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[api] Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const server = app.listen(PORT, HOST, () => {
  console.log(`[api] WebToApp API listening on http://${HOST}:${PORT}`);
  console.log(`[api] Environment: ${process.env["NODE_ENV"] ?? "development"}`);
});

// Start queue event listener (syncs job progress → DB + SSE)
startQueueEvents();

// Start BullMQ worker in same process (for simple deploys)
// In production, run the worker in a separate container/process
if (process.env["RUN_WORKER"] !== "false") {
  startWorker();
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  console.log(`[api] ${signal} received — shutting down gracefully`);

  server.close(async () => {
    await closeDb();
    console.log("[api] Server closed");
    process.exit(0);
  });

  // Force exit after 30s
  setTimeout(() => {
    console.error("[api] Forced shutdown after timeout");
    process.exit(1);
  }, 30_000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

