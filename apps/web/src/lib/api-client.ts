import { authHeaders } from "./auth";
import type { Conversion, User, UsageStats, BillingPlan } from "../types";

const API_BASE = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3000";

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<{ data: T; error?: never } | { data?: never; error: string }> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
        ...options?.headers,
      },
    });
    const json = (await res.json()) as { data?: T; error?: string };
    if (!res.ok) return { error: json.error ?? `HTTP ${res.status}` };
    return { data: json.data as T };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export const authApi = {
  login: (email: string, password: string) =>
    request<{ token: string; user: User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  register: (email: string, password: string, name?: string) =>
    request<{ token: string; user: User }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, name }),
    }),
  me: () => request<User>("/api/users/me"),
};

// ── Conversions ───────────────────────────────────────────────────────────────

export const conversionsApi = {
  list: () => request<Conversion[]>("/api/conversions"),
  get: (id: string) => request<Conversion>(`/api/conversions/${id}`),
  create: (body: {
    name: string;
    sourceUrl?: string;
    sourceType?: string;
    targets: string[];
    appId?: string;
    version?: string;
    mode?: "offline" | "online" | "hybrid";
  }) => request<Conversion>("/api/conversions", { method: "POST", body: JSON.stringify(body) }),
  cancel: (id: string) =>
    request<{ id: string; status: string }>(`/api/conversions/${id}`, { method: "DELETE" }),
};

// ── Downloads ─────────────────────────────────────────────────────────────────

export const downloadsApi = {
  getUrl: (conversionId: string) =>
    request<{ downloadUrl: string; expiresAt: string; installerSize?: number }>(
      `/api/downloads/${conversionId}`
    ),
};

// ── Billing ───────────────────────────────────────────────────────────────────

export const billingApi = {
  usage: () => request<UsageStats>("/api/billing/usage"),
  plans: () => request<BillingPlan[]>("/api/billing/plans"),
  checkout: (plan: string) =>
    request<{ url: string }>("/api/billing/checkout", {
      method: "POST",
      body: JSON.stringify({ plan }),
    }),
  portal: () =>
    request<{ url: string }>("/api/billing/portal", { method: "POST" }),
};

// ── Upload ────────────────────────────────────────────────────────────────────

export const uploadApi = {
  getPresignedUrl: (conversionId: string, filename: string) =>
    request<{ uploadUrl: string; key: string }>("/api/conversions/upload-url", {
      method: "POST",
      body: JSON.stringify({ conversionId, filename }),
    }),
};
