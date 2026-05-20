import type { UsageStats, BillingPlan, SubscriptionInfo, UsageChartData, Plan } from "@/types";

const FLUTTERWAVE_API_BASE = "https://api.flutterwave.com/v3";
const DEFAULT_CURRENCY = "USD";
const mockUserPlans = new Map<string, Plan>();

type FlutterwavePaymentResponse = {
  status: string;
  message: string;
  data?: {
    link?: string;
  };
};

type FlutterwaveVerifyResponse = {
  status: string;
  message: string;
  data?: {
    id: number;
    tx_ref: string;
    amount: number;
    currency: string;
    status: string;
    customer?: {
      email?: string;
      name?: string;
    };
  } | null;
};

export type PaymentVerificationResult = {
  success: boolean;
  plan: Plan;
  txRef: string;
  transactionId: string;
  message: string;
};

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

function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

function getFlutterwaveSecretKey(): string | undefined {
  return process.env.FLUTTERWAVE_SECRET_KEY || process.env.FLW_SECRET_KEY;
}

function getFlutterwaveCurrency(): string {
  return process.env.FLUTTERWAVE_CURRENCY || DEFAULT_CURRENCY;
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
  return MOCK_PLANS.find((item) => item.id === plan)?.conversionsPerMonth ?? 3;
}

function createTransactionReference(userId: string, plan: Plan): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `wta_${plan}_${userId.slice(0, 8)}_${Date.now()}_${random}`;
}

export const billingService = {
  async getUsage(userId: string): Promise<UsageStats> {
    const plan = getUserPlan(userId);
    const limit = getPlanLimitValue(plan);

    // Mock usage data - in real app, query database
    return {
      plan,
      usage: 2,
      limit,
      resetsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      percentUsed: limit === 9999 ? 0 : Math.round((2 / limit) * 100)
    };
  },

  async getSubscription(userId: string): Promise<SubscriptionInfo> {
    const plan = getUserPlan(userId);
    const limit = getPlanLimitValue(plan);

    // Mock subscription data - in real app, query your billing database.
    return {
      plan,
      jobsUsedThisMonth: 2,
      jobsLimitThisMonth: limit === 9999 ? null : limit,
      renewsAt: plan === "free" ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
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

  async createCheckout(userId: string, plan: Plan, email = "user@example.com"): Promise<string> {
    const billingPlan = getPlan(plan);
    const baseUrl = getBaseUrl();
    const txRef = createTransactionReference(userId, plan);
    const secretKey = getFlutterwaveSecretKey();

    if (!secretKey && process.env.NODE_ENV !== "production") {
      return `${baseUrl}/billing/success?status=successful&plan=${plan}&tx_ref=${txRef}&transaction_id=mock_${txRef}`;
    }

    if (!secretKey) {
      throw new Error("Flutterwave is not configured");
    }

    const response = await fetch(`${FLUTTERWAVE_API_BASE}/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tx_ref: txRef,
        amount: billingPlan.price,
        currency: getFlutterwaveCurrency(),
        redirect_url: `${baseUrl}/billing/success?plan=${plan}`,
        customer: {
          email,
        },
        customizations: {
          title: "WebToApp",
          description: `${billingPlan.name} monthly plan`,
        },
        meta: {
          userId,
          plan,
        },
      }),
    });

    const json = (await response.json()) as FlutterwavePaymentResponse;
    const checkoutUrl = json.data?.link;

    if (!response.ok || !checkoutUrl) {
      throw new Error(json.message || "Unable to create Flutterwave checkout");
    }

    return checkoutUrl;
  },

  async verifyPayment(userId: string, transactionId: string, txRef: string, plan: Plan): Promise<PaymentVerificationResult> {
    const billingPlan = getPlan(plan);
    const expectedAmount = billingPlan.price ?? 0;
    const secretKey = getFlutterwaveSecretKey();

    if (transactionId.startsWith("mock_") && process.env.NODE_ENV !== "production") {
      mockUserPlans.set(userId, plan);

      return {
        success: true,
        plan,
        txRef,
        transactionId,
        message: "Mock payment verified",
      };
    }

    if (!secretKey) {
      throw new Error("Flutterwave is not configured");
    }

    const response = await fetch(`${FLUTTERWAVE_API_BASE}/transactions/${transactionId}/verify`, {
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
    });

    const json = (await response.json()) as FlutterwaveVerifyResponse;
    const transaction = json.data;
    const currency = getFlutterwaveCurrency();

    const verified =
      response.ok &&
      json.status === "success" &&
      transaction?.status === "successful" &&
      transaction.tx_ref === txRef &&
      transaction.currency === currency &&
      transaction.amount >= expectedAmount;

    if (verified) {
      mockUserPlans.set(userId, plan);
    }

    return {
      success: verified,
      plan,
      txRef,
      transactionId,
      message: verified ? "Payment verified" : json.message || "Payment could not be verified",
    };
  },

  async createPortal(userId: string): Promise<string> {
    // Mock portal URL - Flutterwave does not provide a Stripe-style subscription portal here.
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    return `${baseUrl}/billing?portal=mock`;
  }
};
