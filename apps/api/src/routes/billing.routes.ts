import { Plan, type User } from "@prisma/client";
import express, { Router } from "express";
import { z } from "zod";
import crypto from "crypto";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { ApiError } from "../lib/errors.js";
import type { AuthenticatedRequest } from "../lib/types.js";
import { requireAuth } from "../middleware/auth.js";
import { getUsageStats } from "../services/billing.service.js";
import { getPlanLimit } from "../services/jobs.service.js";


function normalizeTanzanianPhone(phone: string): string {
  let cleaned = phone.replace(/\D/g, "");
  if (cleaned.startsWith("0")) cleaned = "255" + cleaned.slice(1);
  else if (!cleaned.startsWith("255") && cleaned.length === 9 && /^[6789]/.test(cleaned)) cleaned = "255" + cleaned;
  if (!/^255[6789]\d{8}$/.test(cleaned))
    throw new ApiError(400, "Invalid phone number. Use format 07XXXXXXXX or 2557XXXXXXXX.", "INVALID_PHONE");
  return cleaned;
}

function toFrontendPlan(plan: Plan): "free" | "pro" | "team" | "ultra" {
  switch (plan) {
    case "STARTER": return "pro";
    case "PRO": return "team";
    case "ULTRA": return "ultra";
    default: return "free";
  }
}

function normalizePlan(plan: string): Plan {
  switch (plan.toLowerCase()) {
    case "starter":
    case "pro":
      return "STARTER";
    case "team":
      return "PRO";
    case "ultra":
      return "ULTRA";
    default:
      return "FREE";
  }
}

const PLANS_METADATA = [
  { id: "free", name: "Free", price: 0, conversionsPerMonth: 1, features: ["1 free conversion", "All build targets (Win, Linux, Mac, Android, iOS)", "Community support", "Basic templates"] },
  { id: "pro", name: "Pro", price: 20000, conversionsPerMonth: 10, features: ["10 conversions per month", "All build targets (Win, Linux, Mac, Android, iOS)", "Priority support", "Advanced templates", "Custom configurations"] },
  { id: "team", name: "Semi-Pro", price: 30000, conversionsPerMonth: 50, features: ["50 conversions per month", "All build targets (Win, Linux, Mac, Android, iOS)", "Priority queue processing", "Team collaboration tools", "Advanced analytics"] },
  { id: "ultra", name: "Ultra", price: 50000, conversionsPerMonth: 100, features: ["100 conversions per month", "All build targets (Win, Linux, Mac, Android, iOS)", "Ultra priority queue", "CI/CD API access", "Custom integrations", "Dedicated support"] }
];

const checkoutGatewaySchema = z.enum(["credit", "stripe", "paypal", "mpesa", "clickpesa", "mock", "mongike"]);
const checkoutSchema = z.object({
  plan: z.string().min(1),
  gateway: checkoutGatewaySchema.optional(),
  phoneNumber: z.string().optional(),
});

export const billingRouter: import("express").Router = Router();

billingRouter.get("/usage", requireAuth, async (req, res, next) => {
  try {
    const authReq = req as unknown as AuthenticatedRequest;
    const user = await prisma.user.findUnique({
      where: { id: authReq.auth.userId }
    });
    if (!user) throw new ApiError(404, "User not found", "USER_NOT_FOUND");

    const usage = await getUsageStats(user.id);
    const limit = getPlanLimit(user.plan);
    const mappedPlan = toFrontendPlan(user.plan);

    res.json({
      plan: mappedPlan,
      usage,
      limit: limit === null ? 9999 : limit,
      resetsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      percentUsed: limit === null ? 0 : Math.round((usage / limit) * 100)
    });
  } catch (error) {
    next(error);
  }
});

billingRouter.get("/plans", requireAuth, async (req, res, next) => {
  try {
    res.json(PLANS_METADATA);
  } catch (error) {
    next(error);
  }
});

billingRouter.get("/usage-chart", requireAuth, async (req, res, next) => {
  try {
    const authReq = req as unknown as AuthenticatedRequest;
    const groupedUsage = await prisma.job.groupBy({
      by: ["createdAt"],
      where: {
        userId: authReq.auth.userId,
        createdAt: {
          gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
        },
        status: { not: "CANCELLED" }
      },
      _count: true,
      orderBy: { createdAt: "asc" }
    });

    const chartMap = new Map<string, number>();
    for (const entry of groupedUsage) {
      const day = entry.createdAt.toISOString().slice(0, 10);
      chartMap.set(day, (chartMap.get(day) ?? 0) + 1);
    }

    const data: Array<{ date: string; jobs: number }> = [];
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const day = date.toISOString().slice(0, 10);
      data.push({
        date: day,
        jobs: chartMap.get(day) ?? 0
      });
    }

    res.json(data);
  } catch (error) {
    next(error);
  }
});

billingRouter.get("/config", requireAuth, async (req, res, next) => {
  try {
    res.json({
      credit: false,
      stripe: false,
      paypal: false,
      clickpesa: false,
      mpesa: false,
      mongike: !!env.MONGIKE_API_KEY,
      mock: true
    });
  } catch (error) {
    next(error);
  }
});

billingRouter.post("/checkout", requireAuth, async (req, res, next) => {
  try {
    const { plan, gateway, phoneNumber } = checkoutSchema.parse(req.body);
    const authReq = req as unknown as AuthenticatedRequest;
    const user = await prisma.user.findUnique({
      where: { id: authReq.auth.userId },
      select: { id: true, email: true, name: true }
    });

    if (!user) {
      throw new ApiError(404, "User not found", "USER_NOT_FOUND");
    }

    const dbPlan = normalizePlan(plan);
    const frontendPlanId = toFrontendPlan(dbPlan);
    const billingPlan = PLANS_METADATA.find(p => p.id === frontendPlanId);
    
    if (!billingPlan) {
      throw new ApiError(400, "Invalid plan", "INVALID_PLAN");
    }

    // ── Mongike Mobile Money ──────────────────────────────────────
    if (gateway === "mongike") {
      if (!phoneNumber) throw new ApiError(400, "Phone number is required", "PHONE_REQUIRED");
      if (!env.MONGIKE_API_KEY) throw new ApiError(503, "Mobile Money payments are not enabled", "GATEWAY_DISABLED");

      const phone = normalizeTanzanianPhone(phoneNumber);
      const txRef = `tx_mk_${crypto.randomUUID()}`;

      await prisma.transaction.create({
        data: { userId: user.id, plan: dbPlan, amount: billingPlan.price, gateway: "mongike", status: "PENDING", txRef }
      });

      const host = req.get("host") || "localhost:3001";
      const protocol = req.headers["x-forwarded-proto"] ?? req.protocol ?? "http";
      
      let webhookUrl = `${protocol}://${host}/billing/webhooks/mongike`;
      if (env.WEBHOOK_BASE_URL) {
        webhookUrl = `${env.WEBHOOK_BASE_URL}/billing/webhooks/mongike`;
      } else if (webhookUrl.includes("localhost") || webhookUrl.includes("127.0.0.1")) {
        // WEBHOOK_BASE_URL is not set — Mongike cannot reach localhost.
        // Set WEBHOOK_BASE_URL in .env to a public tunnel URL (e.g. cloudflare tunnel / ngrok).
        // Payments will still be initiated but the webhook won't auto-upgrade the user.
        // Use the 'Simulate Webhook Trigger' button in the UI to manually complete dev payments.
        console.warn(
          "[billing] ⚠️  WEBHOOK_BASE_URL is not set. Mongike cannot reach localhost.\n" +
          "           Run: .\\cloudflared.exe tunnel --url http://localhost:3001\n" +
          "           Then set WEBHOOK_BASE_URL=https://<your-tunnel>.trycloudflare.com in .env"
        );
        // Keep the localhost URL — Mongike will fail to deliver but at least won't error on creation.
        // The dev simulation button in the UI can be used to complete the payment manually.
      }

      const tzsAmount = billingPlan.price;

      try {
        const resp = await fetch(`${env.MONGIKE_API_URL}/payments/mobile-money/tanzania`, {
          method: "POST",
          headers: { "x-api-key": env.MONGIKE_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({
            order_id: txRef,
            amount: tzsAmount,
            buyer_phone: phone,
            fee_payer: "MERCHANT",
            webhook_url: webhookUrl
          })
        });
        if (!resp.ok) {
          const errText = await resp.text().catch(() => "");
          console.error("[billing] Mongike error:", resp.status, errText);
          throw new Error(`HTTP ${resp.status}`);
        }
      } catch (err: any) {
        await prisma.transaction.update({ where: { txRef }, data: { status: "FAILED" } });
        throw new ApiError(502, "Failed to initiate mobile payment. Please try again.", "GATEWAY_ERROR");
      }

      return res.json({
        pending: true,
        orderReference: txRef,
        message: "A payment prompt has been sent to your phone. Enter your PIN to confirm."
      });
    }

    // ── Mock / fallback ───────────────────────────────────────────
    let dashboardUrl = env.DASHBOARD_URL ?? "http://localhost:3000";
    if (dashboardUrl.endsWith("/billing")) {
      dashboardUrl = dashboardUrl.slice(0, -8);
    } else if (dashboardUrl.endsWith("/billing/")) {
      dashboardUrl = dashboardUrl.slice(0, -9);
    }

    const mockSuccessUrl = `${dashboardUrl}/billing/success?plan=${frontendPlanId}&txRef=mock_tx_${Date.now()}&gateway=${gateway || "mock"}`;
    return res.json({ url: mockSuccessUrl });
  } catch (error) {
    next(error);
  }
});


billingRouter.post(["/mongike", "/webhooks/mongike"], express.json(), async (req, res, next) => {
  try {
    const apiKey = (req.headers["x-api-key"] || req.headers["X-API-KEY"]) as string;
    
    // Security check: Verify the webhook call is signed with the correct API key.
    // In local development, we bypass it if not provided to allow dev simulation.
    if (env.NODE_ENV === "production" || apiKey) {
      if (apiKey !== env.MONGIKE_API_KEY) {
        throw new ApiError(401, "Unauthorized webhook trigger", "UNAUTHORIZED");
      }
    }

    const { order_id, payment_status, reference } = req.body;
    console.log("[billing-webhook] Mongike:", { order_id, payment_status, reference });

    if (!order_id) throw new ApiError(400, "Missing order_id", "BAD_REQUEST");

    const transaction = await prisma.transaction.findUnique({ where: { txRef: order_id } });
    if (!transaction) return res.status(404).json({ success: false, message: "Transaction not found" });
    if (transaction.status !== "PENDING") return res.json({ success: true, message: "Already processed" });

    const status = String(payment_status).toUpperCase();
    if (status === "COMPLETED") {
      await prisma.transaction.update({ where: { txRef: order_id }, data: { status: "COMPLETED" } });
      await prisma.user.update({ where: { id: transaction.userId }, data: { plan: transaction.plan } });
      console.log(`[billing-webhook] Upgraded user ${transaction.userId} to ${transaction.plan}`);
    } else {
      await prisma.transaction.update({ where: { txRef: order_id }, data: { status: "FAILED" } });
    }

    return res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

billingRouter.post("/verify", requireAuth, async (req, res, next) => {
  try {
    const { transactionId, txRef, plan, gateway } = req.body;
    if (!txRef || !plan) {
      throw new ApiError(400, "txRef and plan are required", "BAD_REQUEST");
    }

    const dbPlan = normalizePlan(plan);
    const authReq = req as unknown as AuthenticatedRequest;
    const userId = authReq.auth.userId;

    // Mongike: check DB transaction status
    if (gateway === "mongike") {
      const tx = await prisma.transaction.findUnique({ where: { txRef } });
      if (!tx) throw new ApiError(404, "Transaction not found", "NOT_FOUND");
      if (tx.status === "COMPLETED") return res.json({ success: true, plan: toFrontendPlan(dbPlan), txRef, message: "Payment confirmed" });
      if (tx.status === "FAILED") return res.json({ success: false, plan: toFrontendPlan(dbPlan), txRef, message: "Payment failed or was cancelled" });
      return res.json({ success: false, plan: toFrontendPlan(dbPlan), txRef, message: "Waiting for payment confirmation…" });
    }

    await prisma.user.update({
      where: { id: userId },
      data: { plan: dbPlan }
    });

    return res.json({
      success: true,
      plan: toFrontendPlan(dbPlan),
      txRef,
      transactionId: transactionId || `mock_tx_${Date.now()}`,
      message: "Mock payment verified",
    });
  } catch (error) {
    next(error);
  }
});

billingRouter.get("/subscription", requireAuth, async (req, res, next) => {
  try {
    const authReq = req as unknown as AuthenticatedRequest;
    const user = await prisma.user.findUnique({
      where: { id: authReq.auth.userId },
      select: {
        id: true,
        plan: true
      }
    });

    if (!user) {
      throw new ApiError(404, "User not found", "USER_NOT_FOUND");
    }

    const jobsUsedThisMonth = await getUsageStats(user.id);
    const jobsLimitThisMonth = getPlanLimit(user.plan);
    let renewsAt: string | null = null;
    let cancelAtPeriodEnd = false;
    let stripePortalUrl: string | null = null;
    let usageByDay: Array<{ date: string; count: number }> = [];

    const groupedUsage = await prisma.job.groupBy({
      by: ["createdAt"],
      where: {
        userId: user.id,
        createdAt: {
          gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
        },
        status: { not: "CANCELLED" }
      },
      _count: true,
      orderBy: { createdAt: "asc" }
    });

    usageByDay = groupedUsage.map((entry: { createdAt: Date; _count: number }) => ({
      date: entry.createdAt.toISOString().slice(0, 10),
      count: entry._count
    }));

    res.json({
      plan: toFrontendPlan(user.plan),
      jobsUsedThisMonth,
      jobsLimitThisMonth,
      renewsAt,
      cancelAtPeriodEnd,
      stripePortalUrl,
      usageByDay
    });
  } catch (error) {
    next(error);
  }
});
