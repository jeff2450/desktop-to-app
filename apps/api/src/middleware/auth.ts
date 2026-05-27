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
    // Primary: Authorization: Bearer <token>
    // Fallback: ?token=<token> (used by EventSource / SSE — can't set custom headers)
    const authorization = req.headers.authorization;
    let token: string | undefined;

    if (authorization?.startsWith("Bearer ")) {
      token = authorization.slice("Bearer ".length);
    } else if (typeof req.query["token"] === "string" && req.query["token"]) {
      token = req.query["token"];
    }

    if (!token) {
      throw new ApiError(401, "Missing bearer token", "UNAUTHORIZED");
    }

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

