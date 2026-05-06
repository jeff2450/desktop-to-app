import type { Request, Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "./auth.js";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// In-memory store — for production, swap with Redis (ioredis + sliding window)
const store = new Map<string, RateLimitEntry>();

const PLAN_LIMITS: Record<string, { rpm: number; conversionsPerMonth: number }> = {
  free:       { rpm: 30,  conversionsPerMonth: 3   },
  pro:        { rpm: 120, conversionsPerMonth: 50  },
  team:       { rpm: 300, conversionsPerMonth: 200 },
  enterprise: { rpm: 600, conversionsPerMonth: 999 },
};

/**
 * Per-user rate limiter based on requests-per-minute.
 * Falls back to IP-based limiting for unauthenticated routes.
 */
export function rateLimit(opts: { windowMs?: number } = {}) {
  const windowMs = opts.windowMs ?? 60_000; // 1 minute

  return function rateLimitMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    const authedReq = req as AuthenticatedRequest;
    const key = authedReq.user?.id ?? req.ip ?? "unknown";
    const plan = authedReq.user?.plan ?? "free";
    const limit = (PLAN_LIMITS[plan] ?? PLAN_LIMITS["free"]!).rpm;

    const now = Date.now();
    const entry = store.get(key);

    if (!entry || entry.resetAt < now) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      setRateLimitHeaders(res, limit, limit - 1, windowMs);
      next();
      return;
    }

    entry.count++;

    if (entry.count > limit) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader("Retry-After", retryAfter);
      setRateLimitHeaders(res, limit, 0, entry.resetAt - now);
      res.status(429).json({
        error: "Rate limit exceeded",
        retryAfter,
        limit,
        plan,
      });
      return;
    }

    setRateLimitHeaders(res, limit, limit - entry.count, entry.resetAt - now);
    next();
  };
}

function setRateLimitHeaders(
  res: Response,
  limit: number,
  remaining: number,
  resetMs: number
): void {
  res.setHeader("X-RateLimit-Limit", limit);
  res.setHeader("X-RateLimit-Remaining", Math.max(remaining, 0));
  res.setHeader("X-RateLimit-Reset", Math.ceil(Date.now() / 1000 + resetMs / 1000));
}

/**
 * Monthly conversion usage check.
 * Increments monthlyUsage and blocks if the plan limit is exceeded.
 */
export function checkUsageLimit(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authedReq = req as AuthenticatedRequest;
  const plan = authedReq.user?.plan ?? "free";
  const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS["free"]!;

  // monthlyUsage comes from the JWT — for a real implementation,
  // fetch from DB in the auth middleware and attach to req.user
  const usage = (authedReq.user as unknown as Record<string, number>)["monthlyUsage"] ?? 0;

  if (usage >= limits.conversionsPerMonth) {
    res.status(402).json({
      error: "Monthly conversion limit reached",
      limit: limits.conversionsPerMonth,
      plan,
      upgradeUrl: "https://webtoapp.dev/billing",
    });
    return;
  }

  next();
}

// Cleanup old entries every 5 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt < now) store.delete(key);
  }
}, 5 * 60_000);
