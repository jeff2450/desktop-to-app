import { Plan, type User } from "@prisma/client";
import { Router, raw } from "express";
import Stripe from "stripe";
import { z } from "zod";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { ApiError } from "../lib/errors.js";
import type { AuthenticatedRequest } from "../lib/types.js";
import { requireAuth } from "../middleware/auth.js";
import {
  ensureStripeCustomer,
  getPlanFromPriceId,
  getPriceIdForPlan,
  getUsageStats,
  markWebhookProcessed,
  sendPaymentFailedEmail,
  stripe
} from "../services/billing.service.js";
import { getPlanLimit } from "../services/jobs.service.js";
import {
  isClickPesaConfigured,
  createClickPesaCheckout,
  queryClickPesaPayment
} from "../services/clickpesa.service.js";
import {
  isPaypalConfigured,
  createPaypalOrder,
  capturePaypalOrder
} from "../services/paypal.service.js";

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
  { id: "free", name: "Free", price: 0, conversionsPerMonth: 1, features: ["1 free conversion", "Choose Windows, Linux, or macOS", "Community support", "Basic templates"] },
  { id: "pro", name: "Pro", price: 9, conversionsPerMonth: 10, features: ["10 conversions per month", "Windows, Linux & macOS builds", "Priority support", "Advanced templates", "Custom configurations"] },
  { id: "team", name: "Team", price: 15, conversionsPerMonth: 20, features: ["20 conversions per month", "All platforms + architectures", "Priority queue processing", "Team collaboration tools", "Advanced analytics"] },
  { id: "ultra", name: "Ultra", price: 24, conversionsPerMonth: 50, features: ["50 conversions per month", "All platforms + architectures", "Ultra priority queue", "CI/CD API access", "Custom integrations", "Dedicated support"] }
];

const checkoutSchema = z.object({
  plan: z.string().min(1),
  gateway: z.string().optional()
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
      stripe: !!stripe,
      paypal: isPaypalConfigured(),
      clickpesa: isClickPesaConfigured()
    });
  } catch (error) {
    next(error);
  }
});

billingRouter.post("/checkout", requireAuth, async (req, res, next) => {
  try {
    const { plan, gateway } = checkoutSchema.parse(req.body);
    const authReq = req as unknown as AuthenticatedRequest;
    const user = await prisma.user.findUnique({
      where: { id: authReq.auth.userId },
      select: { id: true, email: true, name: true, stripeCustomerId: true }
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

    // Determine gateway
    let selectedGateway = gateway;
    if (!selectedGateway) {
      if (stripe) {
        selectedGateway = "stripe";
      } else if (isPaypalConfigured()) {
        selectedGateway = "paypal";
      } else if (isClickPesaConfigured()) {
        selectedGateway = "clickpesa";
      } else {
        selectedGateway = "mock";
      }
    }

    if (selectedGateway === "clickpesa" && isClickPesaConfigured()) {
      const orderReference = `wta_${frontendPlanId}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      
      try {
        const checkoutUrl = await createClickPesaCheckout({
          orderReference,
          price: billingPlan.price,
          customerName: user.name || user.email,
          customerEmail: user.email,
          description: `${billingPlan.name} plan subscription`,
        });

        await prisma.clickPesaOrder.create({
          data: {
            orderReference,
            userId: user.id,
            plan: dbPlan,
            status: "PENDING",
          }
        });

        return res.json({ url: checkoutUrl });
      } catch (err) {
        console.error("[billing] ClickPesa checkout creation failed:", err);
        throw new ApiError(502, (err as Error).message || "ClickPesa checkout initiation failed", "CLICKPESA_ERROR");
      }
    }

    if (selectedGateway === "paypal" && isPaypalConfigured()) {
      const orderReference = `wta_pp_${frontendPlanId}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const successUrl = `${env.DASHBOARD_URL ?? "http://localhost:3000"}/billing/success?plan=${frontendPlanId}&gateway=paypal&orderReference=${orderReference}`;
      const failureUrl = `${env.DASHBOARD_URL ?? "http://localhost:3000"}/billing?error=payment_failed`;

      try {
        const paypalOrder = await createPaypalOrder({
          orderReference,
          price: billingPlan.price,
          description: `${billingPlan.name} plan subscription`,
          successUrl,
          failureUrl,
        });

        await prisma.paypalOrder.create({
          data: {
            orderReference,
            paypalOrderId: paypalOrder.id,
            userId: user.id,
            plan: dbPlan,
            status: "PENDING",
          }
        });

        return res.json({ url: paypalOrder.url });
      } catch (err) {
        console.error("[billing] PayPal checkout creation failed:", err);
        throw new ApiError(502, (err as Error).message || "PayPal checkout initiation failed", "PAYPAL_ERROR");
      }
    }

    if (selectedGateway === "stripe" && stripe) {
      try {
        const customerId = await ensureStripeCustomer(user);
        const session = await stripe.checkout.sessions.create({
          mode: "subscription",
          line_items: [{ price: getPriceIdForPlan(dbPlan), quantity: 1 }],
          success_url: `${env.DASHBOARD_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${env.DASHBOARD_URL}/billing`,
          customer: customerId,
          metadata: { userId: user.id, plan: dbPlan }
        });

        return res.json({ url: session.url });
      } catch (stripeError) {
        console.warn("[billing] Stripe checkout creation failed, falling back to other gateways:", stripeError);
      }
    }

    const mockSuccessUrl = `${env.DASHBOARD_URL ?? "http://localhost:3000"}/billing/success?plan=${frontendPlanId}&txRef=mock_tx_${Date.now()}`;
    return res.json({ url: mockSuccessUrl });
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

    if (gateway === "paypal" || (!gateway && isPaypalConfigured() && txRef.startsWith("wta_pp_"))) {
      const order = await prisma.paypalOrder.findUnique({
        where: { orderReference: txRef }
      });

      if (!order) {
        throw new ApiError(404, "PayPal order not found", "NOT_FOUND");
      }

      let paid = order.status === "SUCCESS";

      if (!paid) {
        const paypalOrderId = transactionId || order.paypalOrderId;
        if (!paypalOrderId) {
          throw new ApiError(400, "PayPal Order ID is required to verify", "BAD_REQUEST");
        }

        const success = await capturePaypalOrder(paypalOrderId);
        if (success) {
          await prisma.user.update({
            where: { id: userId },
            data: { plan: dbPlan }
          });

          await prisma.paypalOrder.update({
            where: { id: order.id },
            data: { status: "SUCCESS" }
          });
          paid = true;
        } else {
          await prisma.paypalOrder.update({
            where: { id: order.id },
            data: { status: "FAILED" }
          });
        }
      }

      return res.json({
        success: paid,
        plan: toFrontendPlan(dbPlan),
        txRef,
        transactionId: transactionId || order.paypalOrderId || "",
        message: paid ? "PayPal payment verified and captured successfully" : "PayPal payment capture failed",
      });
    }

    if (gateway === "clickpesa" || isClickPesaConfigured()) {
      const payment = await queryClickPesaPayment(txRef);
      const status = payment?.status?.toUpperCase();
      const paid = status === "SUCCESS" || status === "SETTLED";

      if (paid) {
        await prisma.user.update({
          where: { id: userId },
          data: { plan: dbPlan }
        });

        await prisma.clickPesaOrder.updateMany({
          where: { orderReference: txRef },
          data: { status: "SUCCESS" }
        });
      } else if (status === "FAILED") {
        await prisma.clickPesaOrder.updateMany({
          where: { orderReference: txRef },
          data: { status: "FAILED" }
        });
      }

      return res.json({
        success: paid,
        plan: toFrontendPlan(dbPlan),
        txRef,
        transactionId: payment?.paymentReference ?? payment?.id ?? transactionId,
        message: payment?.message ?? (paid ? "ClickPesa payment verified" : `Payment status: ${status ?? "UNKNOWN"}`),
      });
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

billingRouter.post("/portal", requireAuth, async (req, res, next) => {
  try {
    const authReq = req as unknown as AuthenticatedRequest;
    const user = await prisma.user.findUnique({
      where: { id: authReq.auth.userId },
      select: { stripeCustomerId: true }
    });

    if (stripe && user?.stripeCustomerId) {
      const session = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: `${env.DASHBOARD_URL ?? "http://localhost:3000"}/billing`
      });
      return res.json({ url: session.url });
    }

    return res.json({ url: `${env.DASHBOARD_URL ?? "http://localhost:3000"}/billing?portal=mock` });
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
        plan: true,
        stripeCustomerId: true
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

    if (stripe && user.stripeCustomerId) {
      const subscriptions = await stripe.subscriptions.list({
        customer: user.stripeCustomerId,
        limit: 1,
        status: "all"
      });
      const subscription = subscriptions.data[0];

      if (subscription) {
        renewsAt = new Date(subscription.current_period_end * 1000).toISOString();
        cancelAtPeriodEnd = subscription.cancel_at_period_end;
      }

      const portal = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: `${env.DASHBOARD_URL ?? ""}/billing`
      });
      stripePortalUrl = portal.url;
    }

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

billingRouter.all("/clickpesa/callback", async (req, res, next) => {
  try {
    const queryOrderRef = req.query.orderReference as string | undefined;
    const body = req.body || {};
    const orderReference = queryOrderRef || body?.data?.orderReference || body?.orderReference;

    if (!orderReference) {
      throw new ApiError(400, "Order reference is required", "BAD_REQUEST");
    }

    const order = await prisma.clickPesaOrder.findUnique({
      where: { orderReference }
    });

    if (!order) {
      throw new ApiError(404, "Unknown ClickPesa order reference", "NOT_FOUND");
    }

    const payment = await queryClickPesaPayment(orderReference);
    const status = payment?.status?.toUpperCase();
    const paid = status === "SUCCESS" || status === "SETTLED";

    if (paid) {
      await prisma.user.update({
        where: { id: order.userId },
        data: { plan: order.plan }
      });

      await prisma.clickPesaOrder.update({
        where: { id: order.id },
        data: { status: "SUCCESS" }
      });
    } else if (status === "FAILED") {
      await prisma.clickPesaOrder.update({
        where: { id: order.id },
        data: { status: "FAILED" }
      });
    }

    res.json({ success: paid, message: payment?.message || `Payment status: ${status ?? "UNKNOWN"}` });
  } catch (error) {
    next(error);
  }
});

billingRouter.post(
  "/webhooks",
  raw({ type: "application/json" }),
  async (req, res, next) => {
    try {
      if (!stripe || !env.STRIPE_WEBHOOK_SECRET) {
        throw new ApiError(503, "Stripe webhook is not configured", "STRIPE_NOT_CONFIGURED");
      }

      const signature = req.headers["stripe-signature"];
      if (typeof signature !== "string") {
        throw new ApiError(400, "Missing Stripe signature", "MISSING_STRIPE_SIGNATURE");
      }

      const event = stripe.webhooks.constructEvent(req.body, signature, env.STRIPE_WEBHOOK_SECRET);
      res.status(200).json({ received: true });

      setImmediate(async () => {
        const firstTime = await markWebhookProcessed(event.id);
        if (!firstTime) {
          return;
        }

        await handleStripeEvent(event);
      });
    } catch (error) {
      next(error);
    }
  }
);

async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.["userId"];
      const plan = session.metadata?.["plan"];

      if (!userId || !plan) {
        return;
      }

      await prisma.user.update({
        where: { id: userId },
        data: {
          plan: plan as Plan,
          stripeCustomerId: typeof session.customer === "string" ? session.customer : null
        }
      });
      break;
    }
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const priceId = subscription.items.data[0]?.price.id;
      const plan = getPlanFromPriceId(priceId);

      await prisma.user.updateMany({
        where: { stripeCustomerId: String(subscription.customer) },
        data: { plan }
      });
      break;
    }
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      await prisma.user.updateMany({
        where: { stripeCustomerId: String(subscription.customer) },
        data: { plan: "FREE" }
      });
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = typeof invoice.customer === "string" ? invoice.customer : null;
      if (!customerId) {
        return;
      }

      const user = await prisma.user.findFirst({
        where: { stripeCustomerId: customerId }
      });

      if (!user) {
        return;
      }

      await sendPaymentFailedEmail(user.email);

      if ((invoice.attempt_count ?? 0) >= 3) {
        await prisma.user.update({
          where: { id: user.id },
          data: { plan: "FREE" }
        });
      }
      break;
    }
    default:
      break;
  }
}
