import type { NextFunction, Response } from "express";
import { prisma } from "../db/prisma.js";
import { ApiError } from "../lib/errors.js";
import type { AuthenticatedRequest } from "../lib/types.js";
import { verifyAccessToken } from "../services/auth.service.js";

export async function requireAuth(
  req: import("express").Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authorization = req.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      throw new ApiError(401, "Missing bearer token", "UNAUTHORIZED");
    }

    const token = authorization.slice("Bearer ".length);
    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, plan: true }
    });

    if (!user) {
      throw new ApiError(401, "User not found", "UNAUTHORIZED");
    }

    (req as unknown as AuthenticatedRequest).auth = { userId: user.id, plan: user.plan };
    next();
  } catch (error) {
    next(error);
  }
}
