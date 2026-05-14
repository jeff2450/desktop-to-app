import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { ApiError } from "../lib/errors.js";
import {
  hashPassword,
  revokeRefreshToken,
  rotateRefreshToken,
  signTokens,
  verifyPassword
} from "../services/auth.service.js";
import { loginRateLimiter, registerRateLimiter } from "../middleware/rateLimiter.js";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1)
});

export const authRouter: import("express").Router = Router();

authRouter.post("/register", registerRateLimiter, async (req, res, next) => {
  try {
    const { email, password } = credentialsSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
      throw new ApiError(409, "User already exists", "USER_EXISTS");
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { email, passwordHash },
      select: { id: true, email: true, plan: true }
    });
    const tokens = await signTokens(user);

    res.status(201).json({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/login", loginRateLimiter, async (req, res, next) => {
  try {
    const { email, password } = credentialsSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw new ApiError(401, "Invalid credentials", "INVALID_CREDENTIALS");
    }

    const tokens = await signTokens(user);

    res.json({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        email: user.email,
        plan: user.plan
      }
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/refresh", async (req, res, next) => {
  try {
    const { refreshToken } = refreshSchema.parse(req.body);
    const tokens = await rotateRefreshToken(refreshToken);
    res.json(tokens);
  } catch (error) {
    next(error);
  }
});

authRouter.post("/logout", async (req, res, next) => {
  try {
    const { refreshToken } = refreshSchema.parse(req.body);
    await revokeRefreshToken(refreshToken);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
