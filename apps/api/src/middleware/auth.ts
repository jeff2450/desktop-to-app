import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { createHash } from "node:crypto";
import { db } from "../db/client.js";
import { apiKeys, users } from "../db/schema.js";
import { eq } from "drizzle-orm";

const JWT_SECRET = process.env["JWT_SECRET"] ?? "dev-secret-change-in-production";

export interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    email: string;
    plan: string;
  };
}

/**
 * Authentication middleware.
 *
 * Accepts two forms of credentials:
 *  1. Bearer JWT token  (issued by POST /api/auth/login — web dashboard)
 *  2. Bearer API key    (issued by POST /api/users/keys — CLI usage)
 *
 * Sets req.user on success; sends 401 on failure.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = header.slice(7).trim();

  // ── API key path (prefix: "wta_") ─────────────────────────────
  if (token.startsWith("wta_")) {
    await authenticateApiKey(token, req, res, next);
    return;
  }

  // ── JWT path ───────────────────────────────────────────────────
  authenticateJwt(token, req, res, next);
}

function authenticateJwt(
  token: string,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as {
      id: string;
      email: string;
      plan: string;
    };
    (req as AuthenticatedRequest).user = {
      id: payload.id,
      email: payload.email,
      plan: payload.plan,
    };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

async function authenticateApiKey(
  rawKey: string,
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const keyHash = hashApiKey(rawKey);

    const [keyRow] = await db
      .select({
        id: apiKeys.id,
        userId: apiKeys.userId,
        expiresAt: apiKeys.expiresAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, keyHash))
      .limit(1);

    if (!keyRow) {
      res.status(401).json({ error: "Invalid API key" });
      return;
    }

    if (keyRow.expiresAt && keyRow.expiresAt < new Date()) {
      res.status(401).json({ error: "API key has expired" });
      return;
    }

    // Load user
    const [user] = await db
      .select({ id: users.id, email: users.email, plan: users.plan })
      .from(users)
      .where(eq(users.id, keyRow.userId))
      .limit(1);

    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }

    // Update lastUsedAt in background
    db.update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, keyRow.id))
      .catch(console.error);

    (req as AuthenticatedRequest).user = {
      id: user.id,
      email: user.email,
      plan: user.plan,
    };
    next();
  } catch (err) {
    console.error("[auth] API key authentication error:", err);
    res.status(500).json({ error: "Authentication error" });
  }
}

/**
 * Hash a raw API key for storage and comparison.
 * We store only the hash — the raw key is shown once at creation.
 */
export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

/**
 * Generate a new random API key.
 * Returns both the raw key (to show the user once) and its hash.
 */
export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const raw = "wta_" + Buffer.from(bytes).toString("base64url");
  const prefix = raw.slice(0, 12) + "…";
  return { raw, hash: hashApiKey(raw), prefix };
}

/**
 * Sign a short-lived JWT for the web dashboard session.
 */
export function signJwt(payload: { id: string; email: string; plan: string }): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}
