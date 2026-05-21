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
import * as paypalService from "../services/paypal.service.js";
import { getPlanLimit } from "../services/jobs.service.js";

const checkoutSchema = z.object({
  plan: z.enum(["STARTER", "PRO"])
});

export const billingRouter: import("express").Router = Router();

billingRouter.post("/checkout", requireAuth, async (req, res, next) => {
  try {
    if (!stripe || !env.DASHBOARD_URL) {
      throw new ApiError(503, "Billing is not configured", "BILLING_NOT_CONFIGURED");
    }

    const { plan } = checkoutSchema.parse(req.body);
    const authReq = req as unknown as AuthenticatedRequest;
    const user = await prisma.user.findUnique({
      where: { id: authReq.auth.userId },
      select: { id: true, email: true, stripeCustomerId: true }
    });

    if (!user) {
      throw new ApiError(404, "User not found", "USER_NOT_FOUND");
    }

    const customerId = await ensureStripeCustomer(user);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: getPriceIdForPlan(plan), quantity: 1 }],
      success_url: `${env.DASHBOARD_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.DASHBOARD_URL}/billing`,
      customer: customerId,
      metadata: { userId: user.id, plan }
    });

    res.json({ url: session.url });
  } catch (error) {
    next(error);
  }
});

billingRouter.post("/portal", requireAuth, async (req, res, next) => {
  try {
    if (!stripe || !env.DASHBOARD_URL) {
      throw new ApiError(503, "Billing is not configured", "BILLING_NOT_CONFIGURED");
    }

    const authReq = req as unknown as AuthenticatedRequest;
    const user = await prisma.user.findUnique({
      where: { id: authReq.auth.userId },
      select: { stripeCustomerId: true }
    });

    if (!user?.stripeCustomerId) {
      throw new ApiError(400, "No Stripe customer found", "NO_STRIPE_CUSTOMER");
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${env.DASHBOARD_URL}/billing`
    });

    res.json({ url: session.url });
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
      plan: user.plan,
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

billingRouter.post("/paypal/create", requireAuth, async (req, res, next) => {
  try {
    const { plan } = z.object({ plan: z.nativeEnum(Plan) }).parse(req.body);
    const authReq = req as unknown as AuthenticatedRequest;
    
    const order = await paypalService.createOrder(authReq.auth.userId, plan);
    res.json(order);
  } catch (error) {
    next(error);
  }
});

billingRouter.post("/paypal/capture", requireAuth, async (req, res, next) => {
  try {
    const { orderID, plan } = z.object({ 
      orderID: z.string(), 
      plan: z.nativeEnum(Plan) 
    }).parse(req.body);
    const authReq = req as unknown as AuthenticatedRequest;

    const result = await paypalService.captureOrder(authReq.auth.userId, orderID, plan);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

billingRouter.post("/paypal/webhooks", async (req, res, next) => {
  try {
    // PayPal sends JSON body
    await paypalService.handleWebhook(req.body);
    res.status(200).send("OK");
  } catch (error) {
    console.error("[paypal-webhook] Error:", error);
    res.status(200).send("OK"); // Always 200 to PayPal
  }
});

