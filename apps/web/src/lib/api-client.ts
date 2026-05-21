import type { Conversion, ConversionMode, ConversionStatus, User, UsageStats, BillingPlan, SubscriptionInfo, UsageChartData } from "../types";

const API_BASE = typeof window !== "undefined" ? "" : (process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001");
const REQUEST_TIMEOUT_MS = 15000;

let _accessToken: string | null = null;

type ApiResult<T> = { data: T; error?: never } | { data?: never; error: string };

type ConversionResponse = Conversion & {
  appName?: unknown;
  app_name?: unknown;
  created_at?: unknown;
  platforms?: unknown;
  source?: unknown;
  source_type?: unknown;
  targetPlatforms?: unknown;
  target_platforms?: unknown;
  updated_at?: unknown;
};

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  }

  if (typeof value === "string" && value.length > 0) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === "string" && item.length > 0);
      }
    } catch {
      return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }

  return [];
}

function toString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function normalizeConversion(conversion: ConversionResponse): Conversion {
  const id = toString(conversion.id, "unknown");
  const createdAt = toString(conversion.createdAt ?? conversion.created_at, new Date().toISOString());

  return {
    ...conversion,
    id,
    userId: toString(conversion.userId),
    name: toString(conversion.name ?? conversion.appName ?? conversion.app_name, `Conversion ${id.slice(0, 8)}`),
    sourceType: toString(conversion.sourceType ?? conversion.source_type ?? conversion.source, "upload") as Conversion["sourceType"],
    mode: toString(conversion.mode, "offline") as ConversionMode,
    status: toString(conversion.status, "queued") as ConversionStatus,
    targets: toStringArray(
      conversion.targets ??
      conversion.platforms ??
      conversion.targetPlatforms ??
      conversion.target_platforms
    ),
    createdAt,
    updatedAt: toString(conversion.updatedAt ?? conversion.updated_at, createdAt),
  };
}

function unwrapList<T>(value: T[] | { data?: T[] }): T[] {
  return Array.isArray(value) ? value : value.data ?? [];
}

function isApiError<T>(result: ApiResult<T>): result is { data?: never; error: string } {
  return "error" in result;
}

export function setClientToken(token: string | null) {
  _accessToken = token;
}

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<ApiResult<T>> {
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
  list: async (): Promise<ApiResult<Conversion[]>> => {
    const result = await request<ConversionResponse[] | { data?: ConversionResponse[] }>("/api/conversions");
    if (isApiError(result)) return result;

    return { data: unwrapList(result.data).map(normalizeConversion) };
  },
  get: async (id: string): Promise<ApiResult<Conversion>> => {
    const result = await request<ConversionResponse>(`/api/conversions/${id}`);
    if (isApiError(result)) return result;

    return { data: normalizeConversion(result.data) };
  },
  create: async (body: any): Promise<ApiResult<Conversion>> => {
    const result = await request<ConversionResponse>("/api/conversions", {
      method: "POST",
      body: body instanceof FormData ? body : JSON.stringify(body),
    });
    if (isApiError(result)) return result;

    return { data: normalizeConversion(result.data) };
  },
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
  createPaypalOrder: (plan: string) => {
    const apiPlan = plan === "pro" ? "STARTER" : plan === "team" ? "PRO" : plan.toUpperCase();
    return request<{ id: string }>("/api/billing/paypal/create", {
      method: "POST",
      body: JSON.stringify({ plan: apiPlan }),
    });
  },
  capturePaypalOrder: (orderID: string, plan: string) => {
    const apiPlan = plan === "pro" ? "STARTER" : plan === "team" ? "PRO" : plan.toUpperCase();
    return request<any>("/api/billing/paypal/capture", {
      method: "POST",
      body: JSON.stringify({ orderID, plan: apiPlan }),
    });
  },
};
