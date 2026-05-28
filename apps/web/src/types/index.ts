export type ConversionMode = "offline" | "online" | "hybrid";

export type Plan = "free" | "pro" | "team" | "ultra";


export type ConversionStatus =
  | "queued" | "detecting" | "planning" | "transforming"
  | "scaffolding" | "installing" | "building" | "packaging"
  | "done" | "failed" | "cancelled";

export interface User {
  id: string;
  email: string;
  name?: string | null;
  plan: Plan;
  monthlyUsage: number;
  createdAt: string;
}

export interface Conversion {
  id: string;
  userId: string;
  name: string;
  sourceType: "github" | "upload" | "zip";
  mode: ConversionMode;
  sourceUrl?: string;
  jobId?: string;
  status: ConversionStatus;
  detectionResult?: DetectionResult;
  planSummary?: string;
  targets: string[];
  installerUrl?: string;
  installerSize?: number;
  errorMessage?: string;
  durationMs?: number;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  /** Estimated seconds to build start — returned by POST /conversions */
  estimatedWait?: number;
  /** Live log lines from Redis buffer — returned by GET /conversions/:id */
  liveLogLines?: string[];
  /** Job execution progress percentage (0 to 100) */
  progress?: number;
}

export interface DetectionResult {
  framework: string;
  bundler: string;
  backend: string;
  auth: string;
  tables: string[];
  uiLibrary: string;
  confidence: number;
  warnings: string[];
}

export interface UsageStats {
  plan: Plan;
  usage: number;
  limit: number;
  resetsAt: string;
  percentUsed: number;
}

export interface SubscriptionInfo {
  plan: Plan;
  jobsUsedThisMonth: number;
  jobsLimitThisMonth: number | null;
  renewsAt: string | null;
  cancelAtPeriodEnd: boolean;
  stripePortalUrl: string | null;
}

export interface UsageChartData {
  date: string;
  jobs: number;
}

export interface BillingPlan {
  id: Plan;
  name: string;
  price: number | null;
  conversionsPerMonth: number;
  features: string[];
}

export interface SseEvent {
  type: "status" | "log" | "completed" | "failed" | "ping" | "progress";
  status?: ConversionStatus;
  stage?: string;
  message?: string;
  installerUrl?: string;
  durationMs?: number;
  error?: string;
  progress?: number;
  line?: string;
}
