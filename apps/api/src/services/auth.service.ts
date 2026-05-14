import { Plan, type Session, type User } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
import { ApiError } from "../lib/errors.js";
import type { AccessTokenPayload, RefreshTokenPayload } from "../lib/types.js";

const ACCESS_TOKEN_EXPIRES_IN = "15m";
const REFRESH_TOKEN_EXPIRES_IN = "7d";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

function buildAccessToken(user: Pick<User, "id" | "plan">): string {
  const payload: AccessTokenPayload = {
    sub: user.id,
    plan: user.plan
  };

  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRES_IN });
}

function buildRefreshToken(userId: string, sessionId: string): string {
  const payload: RefreshTokenPayload = {
    sub: userId,
    sessionId
  };

  return jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRES_IN });
}

export async function signTokens(user: Pick<User, "id" | "plan">): Promise<{
  accessToken: string;
  refreshToken: string;
  session: Session;
}> {
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshToken: "pending",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    }
  });

  const refreshToken = buildRefreshToken(user.id, session.id);
  const updatedSession = await prisma.session.update({
    where: { id: session.id },
    data: { refreshToken }
  });

  return {
    accessToken: buildAccessToken(user),
    refreshToken,
    session: updatedSession
  };
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
}

export async function rotateRefreshToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  user: Pick<User, "id" | "email" | "plan">;
}> {
  const payload = verifyRefreshToken(refreshToken);
  const session = await prisma.session.findUnique({
    where: { refreshToken },
    include: { user: true }
  });

  if (!session || session.id !== payload.sessionId || session.expiresAt < new Date()) {
    throw new ApiError(401, "Refresh session expired", "UNAUTHORIZED");
  }

  await prisma.session.delete({ where: { id: session.id } });
  const tokens = await signTokens(session.user);

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    user: {
      id: session.user.id,
      email: session.user.email,
      plan: session.user.plan
    }
  };
}

export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  await prisma.session.deleteMany({ where: { refreshToken } });
}

export function normalizePlan(plan: string): Plan {
  if (plan === "STARTER" || plan === "PRO" || plan === "FREE") {
    return plan;
  }

  throw new ApiError(400, "Invalid plan", "INVALID_PLAN");
}
