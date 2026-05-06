import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "../db/client.js";
import { users, apiKeys } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import {
  requireAuth,
  signJwt,
  generateApiKey,
  type AuthenticatedRequest,
} from "../middleware/auth.js";

export const usersRouter: Router = Router();

// ── POST /api/auth/register ───────────────────────────────────────────────────

usersRouter.post("/auth/register", async (req, res) => {
  const { email, password, name } = req.body as {
    email?: string;
    password?: string;
    name?: string;
  };

  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const [user] = await db
      .insert(users)
      .values({ email, passwordHash, name })
      .returning({ id: users.id, email: users.email, plan: users.plan });

    const token = signJwt({ id: user!.id, email: user!.email, plan: user!.plan });
    res.status(201).json({ data: { token, user } });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return res.status(409).json({ error: "An account with that email already exists" });
    }
    console.error("[users] register error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────

usersRouter.post("/auth/login", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  try {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = signJwt({ id: user.id, email: user.email, plan: user.plan });
    res.json({
      data: {
        token,
        user: { id: user.id, email: user.email, name: user.name, plan: user.plan },
      },
    });
  } catch (err) {
    console.error("[users] login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

// ── GET /api/users/me ─────────────────────────────────────────────────────────

usersRouter.get("/users/me", requireAuth, async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  try {
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        plan: users.plan,
        monthlyUsage: users.monthlyUsage,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, authReq.user.id))
      .limit(1);

    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ data: user });
  } catch (err) {
    console.error("[users] me error:", err);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

// ── PUT /api/users/me ─────────────────────────────────────────────────────────

usersRouter.put("/users/me", requireAuth, async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const { name } = req.body as { name?: string };

  try {
    const [updated] = await db
      .update(users)
      .set({ name, updatedAt: new Date() })
      .where(eq(users.id, authReq.user.id))
      .returning({ id: users.id, email: users.email, name: users.name });

    res.json({ data: updated });
  } catch (err) {
    console.error("[users] update error:", err);
    res.status(500).json({ error: "Failed to update user" });
  }
});

// ── GET /api/users/keys — list API keys ───────────────────────────────────────

usersRouter.get("/users/keys", requireAuth, async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  try {
    const keys = await db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        lastUsedAt: apiKeys.lastUsedAt,
        expiresAt: apiKeys.expiresAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.userId, authReq.user.id));

    res.json({ data: keys });
  } catch (err) {
    console.error("[users] keys list error:", err);
    res.status(500).json({ error: "Failed to list API keys" });
  }
});

// ── POST /api/users/keys — create API key ─────────────────────────────────────

usersRouter.post("/users/keys", requireAuth, async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const { name = "Default" } = req.body as { name?: string };

  try {
    const { raw, hash, prefix } = generateApiKey();

    await db.insert(apiKeys).values({
      userId: authReq.user.id,
      keyHash: hash,
      keyPrefix: prefix,
      name,
    });

    // Return the raw key ONCE — it cannot be recovered after this
    res.status(201).json({
      data: {
        key: raw,
        prefix,
        name,
        warning: "Save this key — it will not be shown again.",
      },
    });
  } catch (err) {
    console.error("[users] key create error:", err);
    res.status(500).json({ error: "Failed to create API key" });
  }
});

// ── DELETE /api/users/keys/:id — revoke API key ───────────────────────────────

usersRouter.delete("/users/keys/:id", requireAuth, async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  try {
    await db
      .delete(apiKeys)
      .where(
        and(
          eq(apiKeys.id, req.params["id"]!),
          eq(apiKeys.userId, authReq.user.id)
        )
      );
    res.json({ data: { deleted: true } });
  } catch (err) {
    console.error("[users] key delete error:", err);
    res.status(500).json({ error: "Failed to delete API key" });
  }
});
