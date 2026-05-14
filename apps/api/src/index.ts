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
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { globalRateLimiter } from "./middleware/rateLimiter.js";
import { closeQueueResources } from "./services/queue.service.js";

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: true,
    credentials: true
  })
);
app.use(compression());
app.use(globalRateLimiter);
app.use("/billing/webhooks", billingRouter);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/auth", authRouter);
app.use("/jobs", jobsRouter);
app.use("/downloads", downloadsRouter);
app.use("/billing", billingRouter);

app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(env.PORT, () => {
  console.log(`[api] listening on port ${env.PORT}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[api] received ${signal}, shutting down`);
  server.close(async () => {
    await closeQueueResources();
    await prisma.$disconnect();
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
