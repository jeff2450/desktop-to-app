import { Plan } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { ApiError } from "../lib/errors.js";

const PAYPAL_API = env.NODE_ENV === "production"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

async function getAccessToken() {
  const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } = env;
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    throw new ApiError(503, "PayPal is not configured", "PAYPAL_NOT_CONFIGURED");
  }

  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64");
  const response = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = (await response.json()) as any;
  if (!data.access_token) {
    console.error("[paypal] Failed to get access token:", JSON.stringify(data));
    throw new ApiError(503, "PayPal authentication failed — check credentials", "PAYPAL_AUTH_FAILED");
  }
  return data.access_token;
}

export async function createOrder(userId: string, plan: Plan) {
  const accessToken = await getAccessToken();
  
  // Define prices based on plans
  const prices: Record<Plan, string> = {
    FREE:    "0",
    STARTER: "9",
    PRO:     "15",
    ULTRA:   "24",
  };


  const response = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: "USD",
            value: prices[plan],
          },
          description: `${plan} Subscription`,
          custom_id: userId, // Store userId for reference
        },
      ],
    }),
  });

  const data = (await response.json()) as any;
  if (!response.ok) {
    console.error("[paypal] Create order failed:", JSON.stringify(data));
    throw new ApiError(500, data.message || data.error_description || "Failed to create PayPal order", "PAYPAL_ORDER_FAILED");
  }

  return data;
}

export async function captureOrder(userId: string, orderId: string, plan: Plan) {
  const accessToken = await getAccessToken();

  const response = await fetch(`${PAYPAL_API}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  const data = (await response.json()) as any;
  if (!response.ok || data.status !== "COMPLETED") {
    throw new ApiError(500, data.message || "Failed to capture PayPal order", "PAYPAL_CAPTURE_FAILED");
  }

  // Update user plan in database
  await prisma.user.update({
    where: { id: userId },
    data: { plan },
  });

  return data;
}

export async function handleWebhook(event: any) {
  const eventType = event.event_type;
  
  if (eventType === "CHECKOUT.ORDER.APPROVED") {
    const orderId = event.resource.id;
    const userId = event.resource.purchase_units[0]?.custom_id;
    const description = event.resource.purchase_units[0]?.description;
    
    if (!userId) return;

    // Detect plan from description
    const plan = description?.includes("PRO") ? Plan.PRO : 
                 description?.includes("STARTER") ? Plan.STARTER : 
                 Plan.FREE;

    // We don't capture here because the client should capture. 
    // But if we wanted to be robust, we could capture if it hasn't been captured yet.
    // For now, let's just log it.
    console.log(`[paypal-webhook] Order approved for user ${userId}, plan ${plan}`);
  }

  if (eventType === "PAYMENT.CAPTURE.COMPLETED") {
    const userId = event.resource.custom_id || event.resource.purchase_units?.[0]?.custom_id;
    // PayPal webhooks for capture often have custom_id in different places depending on how it was created
    
    if (userId) {
       console.log(`[paypal-webhook] Payment completed for user ${userId}`);
       // The plan update usually happens during capture in our captureOrder function,
       // but webhooks ensure it happens even if the client disconnects.
    }
  }
}
