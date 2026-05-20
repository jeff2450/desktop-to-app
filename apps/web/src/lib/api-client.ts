import type { Conversion, User, UsageStats, BillingPlan, SubscriptionInfo, UsageChartData } from "../types";

const API_BASE = typeof window !== "undefined" ? "" : (process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001");
const REQUEST_TIMEOUT_MS = 15000;

let _accessToken: string | null = null;

export function setClientToken(token: string | null) {
  _accessToken = token;
}

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<{ data: T; error?: never } | { data?: never; error: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      ...options?.headers as any,
    };

    if (!(options?.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }

    if (_accessToken) {
      headers["Authorization"] = `Bearer ${_accessToken}`;
    }

    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      signal: options?.signal ?? controller.signal,
    });

    const json = await res.json().catch(() => ({}));
    
    if (res.status === 401 && path !== "/api/auth/login") {
       // Handle token refresh logic here or in the caller
       return { error: "UNAUTHORIZED" };
    }

    if (!res.ok) {
      const fieldErrors = json.details?.fieldErrors;
      const validationDetails =
        fieldErrors && typeof fieldErrors === "object"
          ? Object.entries(fieldErrors)
              .flatMap(([field, messages]) =>
                Array.isArray(messages) ? messages.map((message) => `${field}: ${message}`) : []
              )
              .join("; ")
          : "";

      return { error: validationDetails || json.error || `HTTP ${res.status}` };
    }
    // Backend returns data at the root level (not wrapped in { data: ... })
    return { data: json as T };
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return { error: "Request timed out. Please check that the API server is running." };
    }

    return { error: (err as Error).message };
  } finally {
    clearTimeout(timeout);
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export const authApi = {
  login: (email: string, password: string) =>
    request<{ accessToken: string; refreshToken: string; user: User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  register: (email: string, password: string, name?: string, plan?: string) =>
    request<{ accessToken: string; refreshToken: string; user: User }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, name, plan }),
    }),
  me: () => request<User>("/api/auth/me"),
  logout: () => request<{ success: boolean }>("/api/auth/logout", { method: "POST" }),
  refresh: (refreshToken: string) => 
    request<{ accessToken: string }>("/api/auth/refresh", { 
      method: "POST", 
      body: JSON.stringify({ refreshToken }) 
    }),
};

// ── Conversions ───────────────────────────────────────────────────────────────

export const conversionsApi = {
  list: () => request<Conversion[]>("/api/conversions"),
  get: (id: string) => request<Conversion>(`/api/conversions/${id}`),
  create: (body: any) =>
    request<Conversion>("/api/conversions", {
      method: "POST",
      body: body instanceof FormData ? body : JSON.stringify(body),
    }),
  cancel: (id: string) =>
    request<{ id: string; status: string }>(`/api/conversions/${id}`, { method: "DELETE" }),
  getDownloadUrl: (id: string, platform: string) =>
    request<{ url: string; platform: string; sizeBytes: number }>(`/api/conversions/${id}/download?platform=${platform}`),
};

// ── Downloads ─────────────────────────────────────────────────────────────────

export const downloadsApi = {
  getUrl: (conversionId: string) =>
    request<{ downloadUrl: string; expiresAt: string }>(`/api/downloads/${conversionId}`),
};

// ── Billing ───────────────────────────────────────────────────────────────────

export const billingApi = {
  usage: () => request<UsageStats>("/api/billing/usage"),
  plans: () => request<BillingPlan[]>("/api/billing/plans"),
  subscription: () => request<SubscriptionInfo>("/api/billing/subscription"),
  usageChart: () => request<UsageChartData[]>("/api/billing/usage-chart"),
  checkout: (plan: string) =>
    request<{ url: string }>("/api/billing/checkout", {
      method: "POST",
      body: JSON.stringify({ plan }),
    }),
  verifyPayment: (transactionId: string, txRef: string, plan: string) =>
    request<{ success: boolean; plan: string; txRef: string; transactionId: string; message: string }>("/api/billing/verify", {
      method: "POST",
      body: JSON.stringify({ transactionId, txRef, plan }),
    }),
  portal: () =>
    request<{ url: string }>("/api/billing/portal", { method: "POST" }),
};
