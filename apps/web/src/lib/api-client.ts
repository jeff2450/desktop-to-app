import type {
  BillingPlan,
  Conversion,
  ConversionArtifact,
  ConversionMode,
  ConversionStatus,
  SubscriptionInfo,
  UsageChartData,
  UsageStats,
  User,
} from "../types";

const API_BASE =
  typeof window !== "undefined"
    ? ""
    : (process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001");
const REQUEST_TIMEOUT_MS = 15000;

if (
  typeof window === "undefined" &&
  !process.env["NEXT_PUBLIC_API_URL"] &&
  process.env["NODE_ENV"] !== "production"
) {
  console.warn(
    "[api-client] NEXT_PUBLIC_API_URL is not set. Defaulting to http://localhost:3001 for SSR requests. " +
      "Set this env var if your API runs on a different port.",
  );
}

let _accessToken: string | null = null;

type ApiResult<T> =
  | { data: T; error?: never }
  | { data?: never; error: string };

type ConversionResponse = Partial<Conversion> &
  Record<string, unknown> & {
    appName?: unknown;
    app_name?: unknown;
    completed_at?: unknown;
    conversionId?: unknown;
    created_at?: unknown;
    errorMsg?: unknown;
    error_msg?: unknown;
    jobId?: unknown;
    platforms?: unknown;
    source?: unknown;
    sourceRepo?: unknown;
    source_type?: unknown;
    targetPlatforms?: unknown;
    target_platforms?: unknown;
    updated_at?: unknown;
  };

const VALID_CONVERSION_STATUSES = new Set<ConversionStatus>([
  "queued",
  "running",
  "detecting",
  "planning",
  "transforming",
  "scaffolding",
  "installing",
  "building",
  "packaging",
  "done",
  "failed",
  "cancelled",
]);

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is string => typeof item === "string" && item.length > 0,
    );
  }

  if (typeof value === "string" && value.length > 0) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (item): item is string => typeof item === "string" && item.length > 0,
        );
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

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeArtifact(artifact: unknown): ConversionArtifact | null {
  if (!isRecord(artifact)) return null;

  const platform = toOptionalString(artifact["platform"]);
  if (!platform) return null;

  const s3Key = toOptionalString(artifact["s3Key"] ?? artifact["s3_key"]);
  return {
    id: toString(artifact["id"], s3Key ?? platform),
    jobId: toOptionalString(artifact["jobId"] ?? artifact["job_id"]),
    platform,
    s3Key,
    sizeBytes:
      toOptionalNumber(artifact["sizeBytes"] ?? artifact["size_bytes"]) ?? 0,
  };
}

function toArtifactArray(value: unknown): ConversionArtifact[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeArtifact)
    .filter((artifact): artifact is ConversionArtifact => artifact !== null);
}

export function normalizeConversionStatus(value: unknown): ConversionStatus {
  const normalized = toString(value, "queued").toLowerCase();

  if (normalized === "success") return "done";
  if (normalized === "queued") return "queued";
  if (normalized === "running") return "running";
  if (normalized === "failed") return "failed";
  if (normalized === "cancelled" || normalized === "canceled")
    return "cancelled";
  if (VALID_CONVERSION_STATUSES.has(normalized as ConversionStatus)) {
    return normalized as ConversionStatus;
  }

  return "queued";
}

function normalizeConversion(conversion: ConversionResponse): Conversion {
  const id = toString(
    conversion.id ?? conversion.conversionId ?? conversion.jobId,
    "unknown",
  );
  const createdAt = toString(
    conversion.createdAt ?? conversion.created_at,
    new Date().toISOString(),
  );
  const sourceUrl = toOptionalString(
    conversion.sourceUrl ?? conversion.sourceRepo,
  );
  const sourceType =
    toOptionalString(
      conversion.sourceType ?? conversion.source_type ?? conversion.source,
    ) ?? (sourceUrl ? "github" : "upload");

  return {
    ...conversion,
    id,
    userId: toString(conversion.userId),
    name: toString(
      conversion.name ?? conversion.appName ?? conversion.app_name,
      `Conversion ${id.slice(0, 8)}`,
    ),
    sourceType: sourceType as Conversion["sourceType"],
    sourceUrl,
    mode: toString(conversion.mode, "online") as ConversionMode,
    status: normalizeConversionStatus(conversion.status),
    targets: toStringArray(
      conversion.targets ??
        conversion.platforms ??
        conversion.targetPlatforms ??
        conversion.target_platforms,
    ),
    artifacts: toArtifactArray(conversion.artifacts),
    errorMessage: toOptionalString(
      conversion.errorMessage ?? conversion.errorMsg ?? conversion.error_msg,
    ),
    createdAt,
    updatedAt: toString(
      conversion.updatedAt ?? conversion.updated_at,
      createdAt,
    ),
    completedAt: toOptionalString(
      conversion.completedAt ?? conversion.completed_at,
    ),
    estimatedWait: toOptionalNumber(conversion.estimatedWait),
    liveLogLines: Array.isArray(conversion.liveLogLines)
      ? conversion.liveLogLines
      : undefined,
    progress: toOptionalNumber(conversion.progress),
  };
}

function unwrapList<T>(value: T[] | { data?: T[] }): T[] {
  return Array.isArray(value) ? value : (value.data ?? []);
}

function isApiError<T>(
  result: ApiResult<T>,
): result is { data?: never; error: string } {
  return "error" in result;
}

export function setClientToken(token: string | null) {
  _accessToken = token;
}

export function getClientToken(): string | null {
  return _accessToken;
}

async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      ...(options?.headers as any),
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
                Array.isArray(messages)
                  ? messages.map((message) => `${field}: ${message}`)
                  : [],
              )
              .join("; ")
          : "";

      return { error: validationDetails || json.error || `HTTP ${res.status}` };
    }
    // Backend returns data at the root level (not wrapped in { data: ... })
    return { data: json as T };
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return {
        error:
          "Request timed out. Please check that the API server is running.",
      };
    }

    return { error: (err as Error).message };
  } finally {
    clearTimeout(timeout);
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export const authApi = {
  login: (email: string, password: string) =>
    request<{ accessToken: string; refreshToken: string; user: User }>(
      "/api/auth/login",
      {
        method: "POST",
        body: JSON.stringify({ email, password }),
      },
    ),
  register: (email: string, password: string, name?: string, plan?: string) =>
    request<{ accessToken: string; refreshToken: string; user: User }>(
      "/api/auth/register",
      {
        method: "POST",
        body: JSON.stringify({ email, password, name, plan }),
      },
    ),
  me: () => request<User>("/api/auth/me"),
  logout: () =>
    request<{ success: boolean }>("/api/auth/logout", { method: "POST" }),
  refresh: (refreshToken: string) =>
    request<{ accessToken: string }>("/api/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    }),
};

// ── Conversions ───────────────────────────────────────────────────────────────

export const conversionsApi = {
  list: async (): Promise<ApiResult<Conversion[]>> => {
    const result = await request<
      ConversionResponse[] | { data?: ConversionResponse[] }
    >("/api/conversions");
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
  delete: (id: string) =>
    request<{ id: string; success: boolean }>(`/api/conversions/${id}`, {
      method: "DELETE",
    }),
  cancel: (id: string) =>
    request<{ id: string; status: string }>(
      `/api/conversions/${id}?action=cancel`,
      { method: "DELETE" },
    ),
  getDownloadUrl: (id: string, platform: string) =>
    request<{ url: string; platform: string; sizeBytes: number }>(
      `/api/conversions/${id}/download?platform=${platform}`,
    ),
  /**
   * Open an SSE connection to /api/conversions/:id/stream.
   * Calls onEvent for each parsed SSE message.
   * Returns an EventSource so the caller can close it.
   */
  streamLogs: (
    id: string,
    onEvent: (event: {
      type: string;
      line?: string;
      status?: ConversionStatus;
      progress?: number;
    }) => void,
  ): EventSource | null => {
    if (typeof window === "undefined" || typeof EventSource === "undefined")
      return null;
    // EventSource can't send Authorization headers — pass token as ?token= query param
    const token = getClientToken();
    const url = `${API_BASE}/api/conversions/${id}/stream${token ? `?token=${encodeURIComponent(token)}` : ""}`;
    const es = new EventSource(url);
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        if (isRecord(event) && event["status"]) {
          event["status"] = normalizeConversionStatus(event["status"]);
        }
        onEvent(event);
      } catch {
        // ignore malformed frames
      }
    };
    return es;
  },
};

// ── Downloads ─────────────────────────────────────────────────────────────────

export const downloadsApi = {
  getUrl: (conversionId: string) =>
    request<{ downloadUrl: string; expiresAt: string }>(
      `/api/downloads/${conversionId}`,
    ),
};

// ── Billing ───────────────────────────────────────────────────────────────────

export const billingApi = {
  usage: () => request<UsageStats>("/api/billing/usage"),
  plans: () => request<BillingPlan[]>("/api/billing/plans"),
  subscription: () => request<SubscriptionInfo>("/api/billing/subscription"),
  usageChart: () => request<UsageChartData[]>("/api/billing/usage-chart"),
  config: () =>
    request<{ credit: boolean; stripe: boolean; paypal: boolean; clickpesa: boolean; mpesa: boolean }>(
      "/api/billing/config",
    ),
  checkout: (plan: string, gateway?: string, phoneNumber?: string) =>
    request<{ url: string } | { pending: true; orderReference: string; message: string }>("/api/billing/checkout", {
      method: "POST",
      body: JSON.stringify({ plan, gateway, phoneNumber }),
    }),
  verifyPayment: (
    transactionId: string,
    txRef: string,
    plan: string,
    gateway?: string,
  ) =>
    request<{
      success: boolean;
      plan: string;
      txRef: string;
      transactionId: string;
      message: string;
    }>("/api/billing/verify", {
      method: "POST",
      body: JSON.stringify({ transactionId, txRef, plan, gateway }),
    }),
  portal: () =>
    request<{ url: string }>("/api/billing/portal", { method: "POST" }),
  mpesaStatus: (orderReference: string) =>
    request<{
      status: string;
      paid: boolean;
      orderReference: string;
      responseCode: string | null;
      responseDesc: string | null;
      plan: string;
    }>(`/api/billing/mpesa/status/${encodeURIComponent(orderReference)}`),
};
