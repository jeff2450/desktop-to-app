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
    return `${baseUrl}/billing/success?plan=${plan}`;
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
