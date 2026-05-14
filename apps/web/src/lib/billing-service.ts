import type { UsageStats, BillingPlan, SubscriptionInfo, UsageChartData, Plan } from "@/types";

// Mock data - in a real app, this would connect to Stripe and your database
const MOCK_PLANS: BillingPlan[] = [
  {
    id: "free",
    name: "Free",
    price: 0,
    conversionsPerMonth: 3,
    features: [
      "3 conversions per month",
      "Linux builds only",
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

export const billingService = {
  async getUsage(userId: string): Promise<UsageStats> {
    // Mock usage data - in real app, query database
    return {
      plan: "free",
      usage: 2,
      limit: 3,
      resetsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      percentUsed: 67
    };
  },

  async getSubscription(userId: string): Promise<SubscriptionInfo> {
    // Mock subscription data - in real app, query Stripe
    return {
      plan: "free",
      jobsUsedThisMonth: 2,
      jobsLimitThisMonth: 3,
      renewsAt: null, // free plan doesn't renew
      cancelAtPeriodEnd: false,
      stripePortalUrl: null
    };
  },

  async getUsageChart(userId: string): Promise<UsageChartData[]> {
    // Mock chart data - in real app, aggregate from database
    const now = new Date();
    const data: UsageChartData[] = [];

    for (let i = 29; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      data.push({
        date: date.toISOString().split('T')[0],
        jobs: Math.floor(Math.random() * 5) // Random data for demo
      });
    }

    return data;
  },

  async getPlans(): Promise<BillingPlan[]> {
    return MOCK_PLANS;
  },

  async createCheckout(userId: string, plan: Plan): Promise<string> {
    // Mock checkout URL - in real app, create Stripe checkout session
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    return `${baseUrl}/billing/success?session_id=mock_session_${plan}`;
  },

  async createPortal(userId: string): Promise<string> {
    // Mock portal URL - in real app, create Stripe customer portal session
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    return `${baseUrl}/billing?portal=mock`;
  }
};