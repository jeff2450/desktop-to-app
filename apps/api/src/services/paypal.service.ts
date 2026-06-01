import { env } from "../config/env.js";
import { getRedisConnection } from "./queue.service.js";

export function isPaypalConfigured(): boolean {
  return Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET);
}

export async function getPaypalAccessToken(): Promise<string> {
  const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_BASE_URL } = env;
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    throw new Error("PayPal is not configured");
  }

  const redis = getRedisConnection();
  const cacheKey = "paypal:auth:token";

  const cached = await redis.get(cacheKey);
  if (cached) {
    return cached;
  }

  const authString = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64");
  const response = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${authString}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const json = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!response.ok || !json.access_token) {
    throw new Error("PayPal authorization failed");
  }

  const token = json.access_token.startsWith("Bearer ") ? json.access_token : `Bearer ${json.access_token}`;
  
  // Cache for token duration (usually 9 hours, cache for 7.5 hours)
  const expireSeconds = json.expires_in ? Math.min(json.expires_in - 300, 27000) : 27000;
  await redis.set(cacheKey, token, "EX", expireSeconds);

  return token;
}

export async function createPaypalOrder(input: {
  orderReference: string;
  price: number;
  description: string;
  successUrl: string;
  failureUrl: string;
}): Promise<{ id: string; url: string }> {
  const { PAYPAL_BASE_URL } = env;
  const token = await getPaypalAccessToken();

  const response = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: input.orderReference,
          amount: {
            currency_code: "USD",
            value: input.price.toFixed(2),
          },
          description: input.description,
        },
      ],
      application_context: {
        brand_name: "WebToApp",
        landing_page: "NO_PREFERENCE",
        user_action: "PAY_NOW",
        return_url: input.successUrl,
        cancel_url: input.failureUrl,
      },
    }),
  });

  if (!response.ok) {
    const errorJson = await response.json().catch(() => ({}));
    console.error("[paypal] Create order error response:", errorJson);
    throw new Error("Failed to create PayPal order");
  }

  const json = (await response.json()) as {
    id: string;
    links: Array<{ href: string; rel: string }>;
  };

  const approveLink = json.links.find((l) => l.rel === "approve");
  if (!approveLink) {
    throw new Error("No approve link returned from PayPal");
  }

  return {
    id: json.id,
    url: approveLink.href,
  };
}

export async function capturePaypalOrder(paypalOrderId: string): Promise<boolean> {
  const { PAYPAL_BASE_URL } = env;
  const token = await getPaypalAccessToken();

  const response = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const errorJson = await response.json().catch(() => ({}));
    console.error("[paypal] Capture order error response:", errorJson);
    return false;
  }

  const json = (await response.json()) as { status?: string };
  return json.status === "COMPLETED";
}
