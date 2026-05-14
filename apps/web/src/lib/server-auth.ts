import { NextRequest } from "next/server";
import type { User } from "@/types";

export async function auth(request: NextRequest): Promise<User | null> {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return null;
    }

    const token = authHeader.substring(7);
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const payload = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString("utf8")
    ) as Record<string, any>;

    if (payload["exp"] && payload["exp"] < Date.now() / 1000) {
      return null;
    }

    return {
      id: payload["sub"] ?? "",
      email: payload["email"] ?? "user@example.com",
      plan: payload["plan"] ?? "free",
      monthlyUsage: 0,
      createdAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}