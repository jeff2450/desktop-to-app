import type { Request, Response, NextFunction } from "express";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import type { AuthenticatedRequest } from "./auth.js";

const PLAN_LIMITS: Record<string, number> = {
  free:       3,
  pro:        50,
  team:       200,
  enterprise: 9999,
};

/**
 * Middleware that enforces monthly conversion limits per plan.
 *
 * Fetches the user's current monthlyUsage from the database
 * (more reliable than the JWT payload which can be stale),
 * resets the counter if a new calendar month has started,
 * and blocks the request if the limit is exceeded.
 *
 * On success, increments the counter atomically.
 */
export async function enforceUsageLimit(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user?.id;

  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const [user] = await db
      .select({
        plan: users.plan,
        monthlyUsage: users.monthlyUsage,
        usageResetAt: users.usageResetAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // ── Reset counter if new month ─────────────────────────────────
    const now = new Date();
    const resetAt = user.usageResetAt ?? new Date(0);
    const isNewMonth =
      now.getFullYear() !== resetAt.getFullYear() ||
      now.getMonth() !== resetAt.getMonth();

    if (isNewMonth) {
      await db
        .update(users)
        .set({ monthlyUsage: 0, usageResetAt: now, updatedAt: now })
        .where(eq(users.id, userId));
      user.monthlyUsage = 0;
    }

    // ── Check limit ────────────────────────────────────────────────
    const limit = PLAN_LIMITS[user.plan] ?? PLAN_LIMITS["free"]!;

    if (user.monthlyUsage >= limit) {
      res.status(402).json({
        error: "Monthly conversion limit reached",
        usage: user.monthlyUsage,
        limit,
        plan: user.plan,
        resetsAt: getMonthEnd(now).toISOString(),
        upgradeUrl: "https://webtoapp.dev/billing",
      });
      return;
    }

    // ── Increment usage atomically ─────────────────────────────────
    // Uses a SQL expression to avoid race conditions
    await db
      .update(users)
      .set({
        monthlyUsage: user.monthlyUsage + 1,
        updatedAt: now,
      })
      .where(eq(users.id, userId));

    // Attach usage info to request for logging
    (authReq as AuthenticatedRequest & { usage: { current: number; limit: number } }).usage = {
      current: user.monthlyUsage + 1,
      limit,
    };

    next();
  } catch (err) {
    console.error("[usage] Error checking usage limit:", err);
    // Fail open — don't block conversions due to a DB error
    next();
  }
}

/**
 * GET /api/users/me/usage — returns current usage stats.
 * Used by the dashboard to show the usage bar.
 */
export async function getUsageStats(userId: string): Promise<{
  plan: string;
  usage: number;
  limit: number;
  resetsAt: string;
  percentUsed: number;
}> {
  const [user] = await db
    .select({ plan: users.plan, monthlyUsage: users.monthlyUsage, usageResetAt: users.usageResetAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) throw new Error("User not found");

  const limit = PLAN_LIMITS[user.plan] ?? PLAN_LIMITS["free"]!;
  const usage = user.monthlyUsage;
  const resetsAt = getMonthEnd(new Date()).toISOString();
  const percentUsed = Math.min(Math.round((usage / limit) * 100), 100);

  return { plan: user.plan, usage, limit, resetsAt, percentUsed };
}

function getMonthEnd(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}
