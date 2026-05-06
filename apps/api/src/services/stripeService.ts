import Stripe from "stripe";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";

if (!process.env["STRIPE_SECRET_KEY"]) {
  console.warn("[stripe] STRIPE_SECRET_KEY not set — billing features disabled");
}

export const stripe = process.env["STRIPE_SECRET_KEY"]
  ? new Stripe(process.env["STRIPE_SECRET_KEY"], { apiVersion: "2024-04-10" })
  : null;

// Price IDs from Stripe dashboard (set in environment)
const PRICE_IDS: Record<string, string> = {
  pro:        process.env["STRIPE_PRICE_PRO"]        ?? "",
  team:       process.env["STRIPE_PRICE_TEAM"]       ?? "",
  enterprise: process.env["STRIPE_PRICE_ENTERPRISE"] ?? "",
};

export interface CheckoutSession {
  url: string;
  sessionId: string;
}

export interface BillingPortalSession {
  url: string;
}

/**
 * Stripe billing service.
 *
 * Handles:
 *  - Checkout session creation (subscribe to a plan)
 *  - Customer portal (manage/cancel subscription)
 *  - Webhook event processing (subscription updates, payments)
 */
export class StripeService {
  /**
   * Create a Stripe Checkout session for a new subscription.
   * The user is redirected here from the /billing page.
   */
  async createCheckoutSession(params: {
    userId: string;
    userEmail: string;
    plan: "pro" | "team" | "enterprise";
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession> {
    if (!stripe) throw new Error("Stripe is not configured");

    const priceId = PRICE_IDS[params.plan];
    if (!priceId) throw new Error(`No price ID configured for plan: ${params.plan}`);

    // Get or create Stripe customer
    const customerId = await this.getOrCreateCustomer(params.userId, params.userEmail);

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: { userId: params.userId, plan: params.plan },
      subscription_data: {
        metadata: { userId: params.userId, plan: params.plan },
      },
      allow_promotion_codes: true,
    });

    if (!session.url) throw new Error("Stripe did not return a checkout URL");

    return { url: session.url, sessionId: session.id };
  }

  /**
   * Create a Stripe Billing Portal session.
   * Used for users who want to manage or cancel their subscription.
   */
  async createBillingPortalSession(params: {
    userId: string;
    returnUrl: string;
  }): Promise<BillingPortalSession> {
    if (!stripe) throw new Error("Stripe is not configured");

    const [user] = await db
      .select({ stripeCustomerId: users.stripeCustomerId })
      .from(users)
      .where(eq(users.id, params.userId))
      .limit(1);

    if (!user?.stripeCustomerId) {
      throw new Error("No Stripe customer found for this user — subscribe first");
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: params.returnUrl,
    });

    return { url: session.url };
  }

  /**
   * Process a Stripe webhook event.
   * Called by POST /api/webhooks/stripe with the raw request body and signature.
   */
  async handleWebhookEvent(rawBody: Buffer, signature: string): Promise<void> {
    if (!stripe) throw new Error("Stripe is not configured");

    const webhookSecret = process.env["STRIPE_WEBHOOK_SECRET"];
    if (!webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET not configured");

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err) {
      throw new Error(`Webhook signature verification failed: ${(err as Error).message}`);
    }

    console.log(`[stripe] Webhook event: ${event.type}`);

    switch (event.type) {
      case "checkout.session.completed":
        await this.onCheckoutComplete(event.data.object as Stripe.Checkout.Session);
        break;

      case "customer.subscription.updated":
        await this.onSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case "customer.subscription.deleted":
        await this.onSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case "invoice.payment_failed":
        await this.onPaymentFailed(event.data.object as Stripe.Invoice);
        break;

      default:
        console.log(`[stripe] Unhandled event type: ${event.type}`);
    }
  }

  // ── Webhook handlers ─────────────────────────────────────────────────────────

  private async onCheckoutComplete(session: Stripe.Checkout.Session): Promise<void> {
    const userId = session.metadata?.["userId"];
    const plan = session.metadata?.["plan"] as string | undefined;

    if (!userId || !plan) return;

    await db
      .update(users)
      .set({
        plan: plan as "pro" | "team" | "enterprise",
        stripeCustomerId: session.customer as string,
        stripeSubscriptionId: session.subscription as string,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    console.log(`[stripe] User ${userId} subscribed to ${plan}`);
  }

  private async onSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    const userId = subscription.metadata["userId"];
    if (!userId) return;

    const priceId = subscription.items.data[0]?.price.id;
    const plan = this.planFromPriceId(priceId ?? "");

    if (plan) {
      await db
        .update(users)
        .set({ plan, stripeSubscriptionId: subscription.id, updatedAt: new Date() })
        .where(eq(users.id, userId));
      console.log(`[stripe] User ${userId} plan updated to ${plan}`);
    }
  }

  private async onSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    const userId = subscription.metadata["userId"];
    if (!userId) return;

    await db
      .update(users)
      .set({ plan: "free", stripeSubscriptionId: null, updatedAt: new Date() })
      .where(eq(users.id, userId));

    console.log(`[stripe] User ${userId} downgraded to free`);
  }

  private async onPaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    // Notification is handled by notificationService.ts
    console.warn(`[stripe] Payment failed for customer: ${invoice.customer}`);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private async getOrCreateCustomer(userId: string, email: string): Promise<string> {
    const [user] = await db
      .select({ stripeCustomerId: users.stripeCustomerId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (user?.stripeCustomerId) return user.stripeCustomerId;

    const customer = await stripe!.customers.create({
      email,
      metadata: { userId },
    });

    await db
      .update(users)
      .set({ stripeCustomerId: customer.id })
      .where(eq(users.id, userId));

    return customer.id;
  }

  private planFromPriceId(priceId: string): "pro" | "team" | "enterprise" | null {
    for (const [plan, id] of Object.entries(PRICE_IDS)) {
      if (id === priceId) return plan as "pro" | "team" | "enterprise";
    }
    return null;
  }
}

export const stripeService = new StripeService();
