import type { Conversion, User, UsageStats, BillingPlan, SubscriptionInfo, UsageChartData } from "../types";

const API_BASE = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3000";

let _accessToken: string | null = null;

export function setClientToken(token: string | null) {
  _accessToken = token;
}

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<{ data: T; error?: never } | { data?: never; error: string }> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...options?.headers as any,
    };

    if (_accessToken) {
      headers["Authorization"] = `Bearer ${_accessToken}`;
    }

    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

    const json = await res.json();
    
    if (res.status === 401 && path !== "/api/auth/login") {
       // Handle token refresh logic here or in the caller
       return { error: "UNAUTHORIZED" };
    }

    if (!res.ok) return { error: json.error ?? `HTTP ${res.status}` };
    // Backend returns data at the root level (not wrapped in { data: ... })
    return { data: json as T };
  } catch (err) {
    return { error: (err as Error).message };
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
  create: (body: any) => request<Conversion>("/api/conversions", { method: "POST", body: JSON.stringify(body) }),
  cancel: (id: string) =>
    request<{ id: string; status: string }>(`/api/conversions/${id}`, { method: "DELETE" }),
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
  portal: () =>
    request<{ url: string }>("/api/billing/portal", { method: "POST" }),
};
