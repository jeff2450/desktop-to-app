import { Plan, type User } from "@prisma/client";
import Stripe from "stripe";
import nodemailer from "nodemailer";
import { startOfMonth } from "date-fns";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { ApiError } from "../lib/errors.js";
import { getRedisConnection } from "./queue.service.js";

export const stripe =
  env.STRIPE_SECRET_KEY
    ? new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: "2024-04-10" })
    : null;

export async function ensureStripeCustomer(user: Pick<User, "id" | "email" | "stripeCustomerId">): Promise<string> {
  if (!stripe) {
    throw new ApiError(503, "Stripe is not configured", "STRIPE_NOT_CONFIGURED");
  }

  if (user.stripeCustomerId) {
    return user.stripeCustomerId;
  }

  const customer = await stripe.customers.create({
    email: user.email,
    metadata: { userId: user.id }
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { stripeCustomerId: customer.id }
  });

  return customer.id;
}

export function getPriceIdForPlan(plan: Plan): string {
  if (plan === "STARTER" && env.STRIPE_PRICE_STARTER) {
    return env.STRIPE_PRICE_STARTER;
  }

  if (plan === "PRO" && env.STRIPE_PRICE_PRO) {
    return env.STRIPE_PRICE_PRO;
  }

  throw new ApiError(400, "Plan cannot be purchased", "INVALID_PLAN");
}

export function getPlanFromPriceId(priceId: string | null | undefined): Plan {
  if (!priceId) {
    return "FREE";
  }

  if (priceId === env.STRIPE_PRICE_STARTER) {
    return "STARTER";
  }

  if (priceId === env.STRIPE_PRICE_PRO) {
    return "PRO";
  }

  return "FREE";
}

export async function markWebhookProcessed(eventId: string): Promise<boolean> {
  const redis = getRedisConnection();
  const key = `stripe:webhook:${eventId}`;
  const wasSet = await redis.set(key, "1", "EX", 60 * 60 * 24 * 14, "NX");
  return wasSet === "OK";
}

export async function getUsageStats(userId: string): Promise<number> {
  return prisma.job.count({
    where: {
      userId,
      createdAt: { gte: startOfMonth(new Date()) },
      status: { not: "CANCELLED" }
    }
  });
}

export async function sendPaymentFailedEmail(email: string): Promise<void> {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) {
    console.warn(`[billing] SMTP not configured. Skipping payment failure email for ${email}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS
    }
  });

  await transporter.sendMail({
    from: env.SMTP_FROM,
    to: email,
    subject: "Action required - WebToApp payment failed",
    text: `Your payment could not be processed. Please update your billing details at ${env.DASHBOARD_URL ?? ""}/billing.`
  });
}
