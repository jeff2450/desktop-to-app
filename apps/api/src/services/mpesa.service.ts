import crypto from "crypto";
import { env } from "../config/env.js";
import { getRedisConnection } from "./queue.service.js";

// ─── Configuration check ─────────────────────────────────────────────────────

export function isMpesaConfigured(): boolean {
  return Boolean(
    env.MPESA_API_KEY &&
      env.MPESA_PUBLIC_KEY &&
      env.MPESA_SERVICE_PROVIDER_CODE,
  );
}

// ─── Session-key generation ───────────────────────────────────────────────────
//
// Vodacom M-Pesa OpenAPI authentication:
//   1. Take the raw API_KEY string
//   2. RSA-encrypt it with Vodacom's PUBLIC_KEY (PKCS#1 v1.5 padding)
//   3. Base64-encode the result → this is the Bearer token ("session key")
//
// The session key is valid for ~24 hours; we cache it for 23 h.

export async function getMpesaSessionKey(): Promise<string> {
  const { MPESA_API_KEY, MPESA_PUBLIC_KEY } = env;
  if (!MPESA_API_KEY || !MPESA_PUBLIC_KEY) {
    throw new Error("M-Pesa is not configured");
  }

  const redis = getRedisConnection();
  const cacheKey = "mpesa:session:key";

  const cached = await redis.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Ensure the public key is properly PEM-formatted
  const pem = MPESA_PUBLIC_KEY.includes("-----BEGIN")
    ? MPESA_PUBLIC_KEY
    : `-----BEGIN PUBLIC KEY-----\n${MPESA_PUBLIC_KEY}\n-----END PUBLIC KEY-----`;

  const encrypted = crypto.publicEncrypt(
    {
      key: pem,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    Buffer.from(MPESA_API_KEY),
  );

  const sessionKey = encrypted.toString("base64");

  // Cache for 23 hours (session is valid ~24 h)
  await redis.set(cacheKey, sessionKey, "EX", 23 * 60 * 60);

  return sessionKey;
}

// ─── C2B Single Payment (USSD Push) ──────────────────────────────────────────

export interface MpesaPaymentInput {
  /** Our internal reference stored in MpesaOrder.orderReference */
  orderReference: string;
  /** Unique ID we generate; used to correlate async callback */
  thirdPartyConversationId: string;
  /** Customer MSISDN in international format without +, e.g. 255712345678 */
  customerMSISDN: string;
  /** Amount in the configured currency (default TZS) */
  amount: number;
  /** Short description shown to the customer */
  description: string;
}

export interface MpesaInitiateResponse {
  /** M-Pesa conversation ID — used for status queries */
  conversationId: string;
  /** Human-readable message from M-Pesa */
  responseDesc: string;
  /** M-Pesa response code; "INS-0" means success / request accepted */
  responseCode: string;
}

export async function initiateC2BPayment(
  input: MpesaPaymentInput,
): Promise<MpesaInitiateResponse> {
  const { MPESA_BASE_URL, MPESA_SERVICE_PROVIDER_CODE, MPESA_CURRENCY, MPESA_CALLBACK_URL, DASHBOARD_URL, MPESA_WEBHOOK_TOKEN } = env;
  if (!MPESA_SERVICE_PROVIDER_CODE) {
    throw new Error("M-Pesa SERVICE_PROVIDER_CODE is not set");
  }

  const sessionKey = await getMpesaSessionKey();

  // Callback URL: use env override, fall back to the API's own billing callback route
  let callbackUrl =
    MPESA_CALLBACK_URL ??
    `${DASHBOARD_URL ?? "http://localhost:3001"}/api/billing/mpesa/callback`;

  if (MPESA_WEBHOOK_TOKEN) {
    const urlObj = new URL(callbackUrl);
    urlObj.searchParams.set("token", MPESA_WEBHOOK_TOKEN);
    callbackUrl = urlObj.toString();
  }

  const body = {
    input_Amount: String(Math.round(input.amount)),
    input_Country: "TZN",
    input_Currency: MPESA_CURRENCY,
    input_CustomerMSISDN: input.customerMSISDN,
    input_ServiceProviderCode: MPESA_SERVICE_PROVIDER_CODE,
    input_ThirdPartyConversationID: input.thirdPartyConversationId,
    input_TransactionReference: input.orderReference,
    input_PurchasedItemsDesc: input.description.slice(0, 70), // M-Pesa max 70 chars
  };

  const baseUrl = MPESA_BASE_URL.endsWith("/") ? MPESA_BASE_URL : `${MPESA_BASE_URL}/`;
  const url = `${baseUrl}c2bPayment/singlePayment/`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sessionKey}`,
      "Content-Type": "application/json",
      Origin: "developer.mpesa.com",
    },
    body: JSON.stringify(body),
  });

  const json = (await response.json().catch(() => ({}))) as {
    output_ResponseCode?: string;
    output_ResponseDesc?: string;
    output_ConversationID?: string;
    output_ThirdPartyConversationID?: string;
  };

  if (!response.ok) {
    console.error("[mpesa] C2B initiation failed:", json);
    throw new Error(
      json.output_ResponseDesc ?? `M-Pesa request failed (HTTP ${response.status})`,
    );
  }

  // INS-0 = request accepted; anything else is an application-level error
  const responseCode = json.output_ResponseCode ?? "";
  if (responseCode !== "INS-0") {
    throw new Error(
      json.output_ResponseDesc ?? `M-Pesa rejected request: ${responseCode}`,
    );
  }

  return {
    conversationId: json.output_ConversationID ?? "",
    responseDesc: json.output_ResponseDesc ?? "Request accepted",
    responseCode,
  };
}

// ─── Transaction status query ─────────────────────────────────────────────────
//
// Called by the callback handler and the status-poll endpoint.

export interface MpesaCallbackPayload {
  /** M-Pesa's conversation ID */
  output_ConversationID?: string;
  output_ThirdPartyConversationID?: string;
  /** "INS-0" = success */
  output_ResponseCode?: string;
  output_ResponseDesc?: string;
  output_TransactionID?: string;
}

/**
 * Parses an M-Pesa async callback body.
 * Returns { paid, responseCode, responseDesc, conversationId }.
 */
export function parseMpesaCallback(body: MpesaCallbackPayload): {
  paid: boolean;
  responseCode: string;
  responseDesc: string;
  conversationId: string;
} {
  const responseCode = body.output_ResponseCode ?? "";
  const responseDesc = body.output_ResponseDesc ?? "";
  const conversationId = body.output_ConversationID ?? "";
  const paid = responseCode === "INS-0";
  return { paid, responseCode, responseDesc, conversationId };
}
