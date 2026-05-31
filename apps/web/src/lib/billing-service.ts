import type { UsageStats, BillingPlan, SubscriptionInfo, UsageChartData, Plan, User } from "@/types";

const mockUserPlans = new Map<string, Plan>();
const clickPesaOrders = new Map<string, { userId: string; plan: Plan; createdAt: number }>();
let clickPesaTokenCache: { token: string; expiresAt: number } | null = null;

const MOCK_PLANS: BillingPlan[] = [
  {
    id: "free",
    name: "Free",
    price: 0,
    conversionsPerMonth: 1,
    features: [
      "1 free conversion",
      "Choose Windows, Linux, or macOS",
      "Community support",
      "Basic templates"
    ]
  },
  {
    id: "pro",
    name: "Pro",
    price: 9,
    conversionsPerMonth: 10,
    features: [
      "10 conversions per month",
      "Windows, Linux & macOS builds",
      "Priority support",
      "Advanced templates",
      "Custom configurations"
    ]
  },
  {
    id: "team",
    name: "Team",
    price: 15,
    conversionsPerMonth: 20,
    features: [
      "20 conversions per month",
      "All platforms + architectures",
      "Priority queue processing",
      "Team collaboration tools",
      "Advanced analytics"
    ]
  },
  {
    id: "ultra",
    name: "Ultra",
    price: 24,
    conversionsPerMonth: 50,
    features: [
      "50 conversions per month",
      "All platforms + architectures",
      "Ultra priority queue",
      "CI/CD API access",
      "Custom integrations",
      "Dedicated support"
    ]
  }
];


function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.DASHBOARD_URL) return process.env.DASHBOARD_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

function getClickPesaConfig() {
  const clientId = process.env.CLICKPESA_CLIENT_ID;
  const apiKey = process.env.CLICKPESA_API_KEY;

  if (!clientId || !apiKey) {
    return null;
  }

  return {
    clientId,
    apiKey,
    baseUrl: process.env.CLICKPESA_BASE_URL || "https://api.clickpesa.com/third-parties",
    currency: process.env.CLICKPESA_CURRENCY || "USD",
  };
}

function makeOrderReference(plan: Plan): string {
  const suffix = Math.random().toString(36).slice(2, 10);
  return `wta_${plan}_${Date.now()}_${suffix}`;
}

function normalizeBearerToken(token: string): string {
  return token.startsWith("Bearer ") ? token : `Bearer ${token}`;
}

async function getClickPesaToken(config: NonNullable<ReturnType<typeof getClickPesaConfig>>): Promise<string> {
  if (clickPesaTokenCache && clickPesaTokenCache.expiresAt > Date.now()) {
    return clickPesaTokenCache.token;
  }

  const response = await fetch(`${config.baseUrl}/generate-token`, {
    method: "POST",
    headers: {
      "api-key": config.apiKey,
      "client-id": config.clientId,
    },
  });

  const json = (await response.json().catch(() => ({}))) as { success?: boolean; token?: string };

  if (!response.ok || !json.token) {
    throw new Error("ClickPesa authorization failed");
  }

  const token = normalizeBearerToken(json.token);
  clickPesaTokenCache = {
    token,
    expiresAt: Date.now() + 55 * 60 * 1000,
  };

  return token;
}

async function queryClickPesaPayment(orderReference: string) {
  const config = getClickPesaConfig();
  if (!config) {
    throw new Error("ClickPesa is not configured");
  }

  const token = await getClickPesaToken(config);
  const response = await fetch(`${config.baseUrl}/payments/${encodeURIComponent(orderReference)}`, {
    headers: {
      Authorization: token,
    },
  });

  const json = (await response.json().catch(() => [])) as Array<{
    id?: string;
    status?: string;
    paymentReference?: string;
    orderReference?: string;
    message?: string;
  }>;

  if (!response.ok) {
    throw new Error("Unable to verify ClickPesa payment");
  }

  return json[0] ?? null;
}

function markPlanPaid(userId: string, plan: Plan) {
  mockUserPlans.set(userId, plan);
}

function getPlan(plan: Plan): BillingPlan {
  const billingPlan = MOCK_PLANS.find((item) => item.id === plan);

  if (!billingPlan) {
    throw new Error("Invalid plan");
  }

  if (billingPlan.price === null || billingPlan.price <= 0) {
    throw new Error("Plan cannot be purchased through checkout");
  }

  return billingPlan;
}

function getUserPlan(userId: string): Plan {
  return mockUserPlans.get(userId) ?? "free";
}

function getPlanLimitValue(plan: Plan): number {
  return MOCK_PLANS.find((item) => item.id === plan)?.conversionsPerMonth ?? 1;
}

function getMockUsageValue(plan: Plan): number {
  return plan === "free" ? 0 : 2;
}

export const billingService = {
  async getUsage(userId: string): Promise<UsageStats> {
    const plan = getUserPlan(userId);
    const limit = getPlanLimitValue(plan);
    const usage = getMockUsageValue(plan);

    return {
      plan,
      usage,
      limit,
      resetsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      percentUsed: limit === 9999 ? 0 : Math.round((usage / limit) * 100)
    };
  },

  async getSubscription(userId: string): Promise<SubscriptionInfo> {
    const plan = getUserPlan(userId);
    const limit = getPlanLimitValue(plan);
    const usage = getMockUsageValue(plan);

    return {
      plan,
      jobsUsedThisMonth: usage,
      jobsLimitThisMonth: limit === 9999 ? null : limit,
      renewsAt: plan === "free" ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      cancelAtPeriodEnd: false,
      stripePortalUrl: null
    };
  },

  async getUsageChart(userId: string): Promise<UsageChartData[]> {
    const now = new Date();
    const data: UsageChartData[] = [];

    for (let i = 29; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      data.push({
        date: date.toISOString().split('T')[0],
        jobs: Math.floor(Math.random() * 5)
      });
    }

    return data;
  },

  async getPlans(): Promise<BillingPlan[]> {
    return MOCK_PLANS;
  },

  async createCheckout(user: Pick<User, "id" | "email" | "name">, plan: Plan): Promise<string> {
    const baseUrl = getBaseUrl();

    const config = getClickPesaConfig();
    if (config) {
      const billingPlan = getPlan(plan);
      const orderReference = makeOrderReference(plan);
      const token = await getClickPesaToken(config);
      const callbackUrl = `${baseUrl}/api/billing/clickpesa/callback?orderReference=${encodeURIComponent(orderReference)}`;

      const response = await fetch(`${config.baseUrl}/checkout-link/generate-checkout-url`, {
        method: "POST",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          totalPrice: billingPlan.price?.toFixed(2),
          orderReference,
          orderCurrency: config.currency,
          customerName: user.name || user.email,
          customerEmail: user.email,
          description: `${billingPlan.name} plan subscription`,
          callbackUrl,
        }),
      });

      const json = (await response.json().catch(() => ({}))) as { checkoutLink?: string };

      if (!response.ok || !json.checkoutLink) {
        throw new Error("Failed to create ClickPesa checkout link");
      }

      clickPesaOrders.set(orderReference, { userId: user.id, plan, createdAt: Date.now() });
      return json.checkoutLink;
    }

    // Return a mock success redirect when ClickPesa credentials are not configured.
    return `${baseUrl}/billing/success?plan=${plan}`;
  },

  async verifyPayment(userId: string, transactionId: string, txRef: string, plan: Plan): Promise<any> {
    if (getClickPesaConfig()) {
      const payment = await queryClickPesaPayment(txRef);
      const status = payment?.status?.toUpperCase();
      const paid = status === "SUCCESS" || status === "SETTLED";

      if (paid) {
        markPlanPaid(userId, plan);
      }

      return {
        success: paid,
        plan,
        txRef,
        transactionId: payment?.paymentReference ?? payment?.id ?? transactionId,
        message: payment?.message ?? (paid ? "ClickPesa payment verified" : `Payment status: ${status ?? "UNKNOWN"}`),
      };
    }

    markPlanPaid(userId, plan);
    return {
      success: true,
      plan,
      txRef,
      transactionId,
      message: "Mock payment verified",
    };
  },

  async createPortal(userId: string): Promise<string> {
    const baseUrl = getBaseUrl();
    return `${baseUrl}/billing?portal=mock`;
  },

  async handleClickPesaCallback(orderReference: string): Promise<{ success: boolean; message: string }> {
    const order = clickPesaOrders.get(orderReference);
    if (!order) {
      return { success: false, message: "Unknown ClickPesa order reference" };
    }

    const payment = await queryClickPesaPayment(orderReference);
    const status = payment?.status?.toUpperCase();

    if (status === "SUCCESS" || status === "SETTLED") {
      markPlanPaid(order.userId, order.plan);
      clickPesaOrders.delete(orderReference);
      return { success: true, message: "ClickPesa payment verified" };
    }

    return { success: false, message: `Payment status: ${status ?? "UNKNOWN"}` };
  }
};
