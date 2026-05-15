import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { ApiError } from "../lib/errors.js";
import {
  hashPassword,
  revokeRefreshToken,
  rotateRefreshToken,
  signTokens,
  verifyPassword,
} from "../services/auth.service.js";
import { loginRateLimiter, registerRateLimiter } from "../middleware/rateLimiter.js";
import { requireAuth } from "../middleware/auth.js";
import type { AuthenticatedRequest } from "../lib/types.js";

const credentialsSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(8),
  plan:     z.enum(["free", "pro", "team", "enterprise"]).optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const authRouter: Router = Router();

// POST /auth/register
authRouter.post("/register", registerRateLimiter, async (req, res, next) => {
  try {
    const { email, password, plan } = credentialsSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
      throw new ApiError(409, "An account with that email already exists", "USER_EXISTS");
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data:   { 
        email, 
        passwordHash, 
        plan: (plan as any) || "free" 
      },
      select: { id: true, email: true, plan: true, createdAt: true },
    });
    const tokens = await signTokens(user);

    res.status(201).json({
      accessToken:  tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user,
    });
  } catch (error) {
    next(error);
  }
});

// POST /auth/login
authRouter.post("/login", loginRateLimiter, async (req, res, next) => {
  try {
    const { email, password } = credentialsSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw new ApiError(401, "Invalid email or password", "INVALID_CREDENTIALS");
    }

    const tokens = await signTokens(user);
    res.json({
      accessToken:  tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: { id: user.id, email: user.email, plan: user.plan },
    });
  } catch (error) {
    next(error);
  }
});

// GET /auth/me — current user info
authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const authReq = req as unknown as AuthenticatedRequest;
    const user = await prisma.user.findUnique({
      where:  { id: authReq.auth.userId },
      select: { id: true, email: true, plan: true, createdAt: true },
    });

    if (!user) throw new ApiError(404, "User not found", "USER_NOT_FOUND");

    res.json(user);
  } catch (error) {
    next(error);
  }
});

// POST /auth/refresh
authRouter.post("/refresh", async (req, res, next) => {
  try {
    const { refreshToken } = refreshSchema.parse(req.body);
    const tokens = await rotateRefreshToken(refreshToken);
    res.json(tokens);
  } catch (error) {
    next(error);
  }
});

// POST /auth/logout
authRouter.post("/logout", async (req, res, next) => {
  try {
    const { refreshToken } = refreshSchema.parse(req.body);
    await revokeRefreshToken(refreshToken);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
