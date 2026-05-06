import { Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { stripeService } from "../services/stripeService.js";
import { getUsageStats } from "../middleware/usageCheck.js";

export const billingRouter: Router = Router();

const APP_URL = process.env["APP_URL"] ?? "https://webtoapp.dev";

// ── GET /api/billing/usage — current usage stats ──────────────────────────────

billingRouter.get("/billing/usage", requireAuth, async (req, res) => {
  const user = (req as AuthenticatedRequest).user;
  try {
    const stats = await getUsageStats(user.id);
    res.json({ data: stats });
  } catch (err) {
    console.error("[billing] usage error:", err);
    res.status(500).json({ error: "Failed to fetch usage stats" });
  }
});

// ── POST /api/billing/checkout — create Stripe checkout session ───────────────

billingRouter.post("/billing/checkout", requireAuth, async (req, res) => {
  const user = (req as AuthenticatedRequest).user;
  const { plan } = req.body as { plan?: "pro" | "team" | "enterprise" };

  if (!plan || !["pro", "team", "enterprise"].includes(plan)) {
    return res.status(400).json({ error: "plan must be one of: pro, team, enterprise" });
  }

  try {
    const session = await stripeService.createCheckoutSession({
      userId: user.id,
      userEmail: user.email,
      plan,
      successUrl: `${APP_URL}/billing?success=true&plan=${plan}`,
      cancelUrl: `${APP_URL}/billing?cancelled=true`,
    });

    res.json({ data: { url: session.url, sessionId: session.sessionId } });
  } catch (err) {
    console.error("[billing] checkout error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── POST /api/billing/portal — create Stripe billing portal session ───────────

billingRouter.post("/billing/portal", requireAuth, async (req, res) => {
  const user = (req as AuthenticatedRequest).user;

  try {
    const session = await stripeService.createBillingPortalSession({
      userId: user.id,
      returnUrl: `${APP_URL}/billing`,
    });

    res.json({ data: { url: session.url } });
  } catch (err) {
    console.error("[billing] portal error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/billing/plans — return plan info ─────────────────────────────────

billingRouter.get("/billing/plans", (_req, res) => {
  res.json({
    data: [
      {
        id: "free",
        name: "Free",
        price: 0,
        conversionsPerMonth: 3,
        features: ["3 conversions/month", "Windows + Linux targets", "Community support"],
      },
      {
        id: "pro",
        name: "Pro",
        price: 29,
        conversionsPerMonth: 50,
        features: ["50 conversions/month", "All targets (Win, Linux, Mac)", "Priority builds", "Email support"],
      },
      {
        id: "team",
        name: "Team",
        price: 99,
        conversionsPerMonth: 200,
        features: ["200 conversions/month", "All targets", "Priority queue", "Slack support", "Team dashboard"],
      },
      {
        id: "enterprise",
        name: "Enterprise",
        price: null, // custom
        conversionsPerMonth: 9999,
        features: ["Unlimited conversions", "Self-hosted option", "SLA", "Dedicated support"],
      },
    ],
  });
});
