import type { Response } from "express";

/**
 * Server-Sent Events broadcaster for live conversion logs.
 *
 * Clients connect to GET /api/conversions/:id/logs and receive a stream
 * of JSON events as the conversion pipeline progresses.
 *
 * The worker calls reportProgress() which publishes via BullMQ,
 * QueueEvents picks it up and calls broadcast() here,
 * which fans out to all SSE clients watching that job.
 *
 * Event types:
 *   { type: "status",    status: string }
 *   { type: "log",       stage: string, message: string }
 *   { type: "completed", installerUrl: string, durationMs: number }
 *   { type: "failed",    error: string }
 *   { type: "ping" }    (sent every 15s to keep the connection alive)
 */

// jobId → set of active SSE response objects
const clients = new Map<string, Set<Response>>();

/**
 * Register a new SSE client for a conversion job.
 * Call this from the GET /api/conversions/:id/logs route handler.
 */
export function registerSseClient(jobId: string, res: Response): () => void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable Nginx buffering
  res.flushHeaders();

  if (!clients.has(jobId)) {
    clients.set(jobId, new Set());
  }
  clients.get(jobId)!.add(res);

  // Send a ping immediately so the client knows we're connected
  sendEvent(res, { type: "ping" });

  // Keep-alive ping every 15 seconds
  const pingInterval = setInterval(() => {
    if (res.writableEnded) {
      cleanup();
    } else {
      sendEvent(res, { type: "ping" });
    }
  }, 15_000);

  function cleanup(): void {
    clearInterval(pingInterval);
    clients.get(jobId)?.delete(res);
    if (clients.get(jobId)?.size === 0) {
      clients.delete(jobId);
    }
  }

  // Clean up when client disconnects
  res.on("close", cleanup);

  return cleanup;
}

/**
 * Broadcast an event to all SSE clients watching a job.
 * Called by queueEvents.ts whenever the worker reports progress.
 */
export function broadcast(jobId: string, event: Record<string, unknown>): void {
  const jobClients = clients.get(jobId);
  if (!jobClients || jobClients.size === 0) return;

  for (const res of jobClients) {
    if (!res.writableEnded) {
      sendEvent(res, event);
    }
  }
}

/**
 * Close all SSE connections for a job (e.g. after completion).
 */
export function closeJobStreams(jobId: string): void {
  const jobClients = clients.get(jobId);
  if (!jobClients) return;

  for (const res of jobClients) {
    if (!res.writableEnded) {
      res.end();
    }
  }
  clients.delete(jobId);
}

/**
 * Returns the number of active SSE connections (useful for metrics).
 */
export function getActiveConnectionCount(): number {
  let total = 0;
  for (const set of clients.values()) total += set.size;
  return total;
}

function sendEvent(res: Response, data: Record<string, unknown>): void {
  try {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch {
    // Client disconnected mid-write — ignore
  }
}
