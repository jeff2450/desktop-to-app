import type { UsageStats, BillingPlan, SubscriptionInfo, UsageChartData, Plan } from "@/types";

const mockUserPlans = new Map<string, Plan>();

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
    conversionsPerMonth: 20,
    features: [
      "20 conversions per month",
      "Windows, Linux & macOS builds",
      "Priority support",
      "Advanced templates",
      "Custom configurations"
    ]
  },
  {
    id: "team",
    name: "Team",
    price: 29,
    conversionsPerMonth: 9999, // unlimited
    features: [
      "Unlimited conversions",
      "All platforms + architectures",
      "Priority queue processing",
      "Team collaboration tools",
      "Advanced analytics",
      "Custom integrations"
    ]
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: null,
    conversionsPerMonth: 9999,
    features: [
      "Everything in Team",
      "Dedicated support",
      "Custom deployment options",
      "SLA guarantees",
      "On-premise deployment",
      "White-label solutions"
    ]
  }
];

function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
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

  async createCheckout(userId: string, plan: Plan): Promise<string> {
    const baseUrl = getBaseUrl();
    // Return a mock success redirect
    return `${baseUrl}/billing?payment=success&plan=${plan}`;
  },

  async createPaypalOrder(userId: string, planId: Plan, authHeader: string | null = null): Promise<{ id: string }> {
    const apiBase = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
    
    // Convert web plan to API plan
    const apiPlan = planId === "pro" ? "STARTER" : planId === "team" ? "PRO" : planId.toUpperCase();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (authHeader) {
      headers["Authorization"] = authHeader;
    }

    console.log("[billing-service] createPaypalOrder", { apiBase, planId, apiPlan, hasAuth: !!authHeader });

    const response = await fetch(`${apiBase}/api/billing/paypal/create`, {
      method: "POST",
      headers,
      body: JSON.stringify({ plan: apiPlan, userId }),
    });

    if (!response.ok) {
      let errMsg = `PayPal API error (HTTP ${response.status})`;
      try {
        const errBody = await response.json();
        if (errBody?.error) errMsg = errBody.error;
      } catch { /* ignore */ }
      throw new Error(errMsg);
    }

    return response.json();
  },

  async capturePaypalOrder(userId: string, orderId: string, planId: Plan, authHeader: string | null = null): Promise<any> {
    const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
    const apiPlan = planId === "pro" ? "STARTER" : planId === "team" ? "PRO" : planId.toUpperCase();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (authHeader) {
      headers["Authorization"] = authHeader;
    }

    const response = await fetch(`${apiBase}/api/billing/paypal/capture`, {
      method: "POST",
      headers,
      body: JSON.stringify({ orderID: orderId, plan: apiPlan, userId }),
    });

    if (!response.ok) {
      throw new Error("Failed to capture order via API");
    }

    const result = await response.json();
    if (result.status === "COMPLETED") {
       mockUserPlans.set(userId, planId);
    }
    return result;
  },

  async verifyPayment(userId: string, transactionId: string, txRef: string, plan: Plan): Promise<any> {
    mockUserPlans.set(userId, plan);
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
  }
};
