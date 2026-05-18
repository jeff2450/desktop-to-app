import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { ZodError } from "zod";
import { ApiError } from "../lib/errors.js";

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: "Not found" });
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: "Validation failed",
      details: error.flatten()
    });
    return;
  }

  if (error instanceof jwt.TokenExpiredError || error instanceof jwt.JsonWebTokenError) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  if (error instanceof ApiError) {
    res.status(error.statusCode).json({ error: error.message, code: error.code });
    return;
  }

  console.error("[api] unhandled error", error);
  res.status(500).json({ error: "Internal server error" });
}
