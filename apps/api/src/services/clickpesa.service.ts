import { env } from "../config/env.js";
import { getRedisConnection } from "./queue.service.js";

export function isClickPesaConfigured(): boolean {
  return Boolean(env.CLICKPESA_CLIENT_ID && env.CLICKPESA_API_KEY);
}

export async function getClickPesaToken(): Promise<string> {
  const { CLICKPESA_CLIENT_ID, CLICKPESA_API_KEY, CLICKPESA_BASE_URL } = env;
  if (!CLICKPESA_CLIENT_ID || !CLICKPESA_API_KEY) {
    throw new Error("ClickPesa is not configured");
  }

  const redis = getRedisConnection();
  const cacheKey = "clickpesa:auth:token";

  const cached = await redis.get(cacheKey);
  if (cached) {
    return cached;
  }

  const response = await fetch(`${CLICKPESA_BASE_URL}/generate-token`, {
    method: "POST",
    headers: {
      "api-key": CLICKPESA_API_KEY,
      "client-id": CLICKPESA_CLIENT_ID,
    },
  });

  const json = (await response.json().catch(() => ({}))) as { token?: string };
  if (!response.ok || !json.token) {
    throw new Error("ClickPesa authorization failed");
  }

  const token = json.token.startsWith("Bearer ") ? json.token : `Bearer ${json.token}`;
  
  // Cache for 55 minutes
  await redis.set(cacheKey, token, "EX", 55 * 60);

  return token;
}

export async function createClickPesaCheckout(input: {
  orderReference: string;
  price: number;
  customerName: string;
  customerEmail: string;
  description: string;
}): Promise<string> {
  const { CLICKPESA_CURRENCY, CLICKPESA_BASE_URL, DASHBOARD_URL } = env;
  const token = await getClickPesaToken();

  const callbackUrl = `${DASHBOARD_URL ?? "http://localhost:3000"}/api/billing/clickpesa/callback?orderReference=${encodeURIComponent(input.orderReference)}`;
  const successUrl = `${DASHBOARD_URL ?? "http://localhost:3000"}/billing/success?orderReference=${encodeURIComponent(input.orderReference)}`;
  const failureUrl = `${DASHBOARD_URL ?? "http://localhost:3000"}/billing?error=payment_failed`;

  const response = await fetch(`${CLICKPESA_BASE_URL}/checkout-link/generate-checkout-url`, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      totalPrice: input.price, // passed as number/float
      orderReference: input.orderReference,
      orderCurrency: CLICKPESA_CURRENCY,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      description: input.description,
      callbackUrl,
      successUrl,
      failureUrl,
    }),
  });

  const json = (await response.json().catch(() => ({}))) as { checkoutLink?: string };
  if (!response.ok || !json.checkoutLink) {
    throw new Error("Failed to create ClickPesa checkout link");
  }

  return json.checkoutLink;
}

export async function queryClickPesaPayment(orderReference: string) {
  const { CLICKPESA_BASE_URL } = env;
  const token = await getClickPesaToken();

  const response = await fetch(`${CLICKPESA_BASE_URL}/payments/${encodeURIComponent(orderReference)}`, {
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
