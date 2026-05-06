import { Router, type Request, type Response } from "express";
import { stripeService } from "../services/stripeService.js";
import { notificationService } from "../services/notificationService.js";
import { db } from "../db/client.js";
import { conversions, users } from "../db/schema.js";
import { eq } from "drizzle-orm";

export const webhooksRouter: Router = Router();

/**
 * POST /api/webhooks/stripe
 *
 * Receives Stripe webhook events. Must use raw body (not parsed JSON)
 * for signature verification — mount this route BEFORE express.json().
 *
 * Register this URL in your Stripe dashboard:
 *   https://dashboard.stripe.com/webhooks
 */
webhooksRouter.post(
  "/webhooks/stripe",
  // Raw body middleware — only for this route
  (req: Request, res: Response, next) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => { data += chunk; });
    req.on("end", () => {
      (req as Request & { rawBody: Buffer }).rawBody = Buffer.from(data);
      next();
    });
  },
  async (req: Request, res: Response) => {
    const sig = req.headers["stripe-signature"];

    if (!sig || typeof sig !== "string") {
      res.status(400).json({ error: "Missing stripe-signature header" });
      return;
    }

    try {
      const rawBody = (req as Request & { rawBody: Buffer }).rawBody;
      await stripeService.handleWebhookEvent(rawBody, sig);

      // Send notification emails for key events
      await dispatchNotifications(req);

      res.json({ received: true });
    } catch (err) {
      console.error("[webhooks] Stripe error:", (err as Error).message);
      res.status(400).json({ error: (err as Error).message });
    }
  }
);

/**
 * POST /api/webhooks/conversion-complete
 *
 * Internal webhook called by the worker process when a conversion finishes.
 * Triggers email notification to the user.
 *
 * Protected by a shared secret (INTERNAL_WEBHOOK_SECRET).
 */
webhooksRouter.post("/webhooks/conversion-complete", async (req: Request, res: Response) => {
  const secret = req.headers["x-webhook-secret"];
  const expectedSecret = process.env["INTERNAL_WEBHOOK_SECRET"];

  if (expectedSecret && secret !== expectedSecret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { conversionId, status, errorMessage } = req.body as {
    conversionId?: string;
    status?: string;
    errorMessage?: string;
  };

  if (!conversionId) {
    res.status(400).json({ error: "conversionId is required" });
    return;
  }

  try {
    // Load conversion + user
    const [conversion] = await db
      .select({
        id: conversions.id,
        name: conversions.name,
        userId: conversions.userId,
        durationMs: conversions.durationMs,
        targets: conversions.targets,
        errorMessage: conversions.errorMessage,
      })
      .from(conversions)
      .where(eq(conversions.id, conversionId))
      .limit(1);

    if (!conversion) {
      res.status(404).json({ error: "Conversion not found" });
      return;
    }

    const [user] = await db
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, conversion.userId))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Send appropriate email
    if (status === "done") {
      await notificationService.sendConversionComplete({
        to: user.email,
        userName: user.name ?? undefined,
        conversionName: conversion.name,
        conversionId: conversion.id,
        durationMs: conversion.durationMs ?? 0,
        targets: conversion.targets,
      });
    } else if (status === "failed") {
      await notificationService.sendConversionFailed({
        to: user.email,
        userName: user.name ?? undefined,
        conversionName: conversion.name,
        conversionId: conversion.id,
        errorMessage: errorMessage ?? conversion.errorMessage ?? "Unknown error",
      });
    }

    res.json({ notified: true });
  } catch (err) {
    console.error("[webhooks] conversion-complete error:", err);
    res.status(500).json({ error: "Failed to process webhook" });
  }
});

// ── Stripe notification dispatcher ────────────────────────────────────────────

async function dispatchNotifications(req: Request): Promise<void> {
  // Re-parse the raw body to inspect event type for email triggers
  try {
    const rawBody = (req as Request & { rawBody: Buffer }).rawBody;
    const event = JSON.parse(rawBody.toString()) as {
      type: string;
      data: { object: Record<string, unknown> };
    };

    if (event.type === "customer.subscription.deleted") {
      // User downgraded — no email needed (Stripe sends its own)
    }

    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object as { customer_email?: string };
      if (invoice.customer_email) {
        await notificationService.sendPaymentFailed({ to: invoice.customer_email });
      }
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as {
        customer_email?: string;
        metadata?: { plan?: string };
      };
      if (session.customer_email && session.metadata?.plan) {
        await notificationService.sendPlanUpgraded({
          to: session.customer_email,
          plan: session.metadata.plan,
        });
      }
    }
  } catch {
    // Non-fatal — notifications are best-effort
  }
}
