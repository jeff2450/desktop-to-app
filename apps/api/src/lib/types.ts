import type { JwtPayload } from "jsonwebtoken";
import type { Request } from "express";
import type { Plan } from "@prisma/client";

export interface AccessTokenPayload extends JwtPayload {
  sub:  string;
  plan: Plan;
}

export interface RefreshTokenPayload extends JwtPayload {
  sub:       string;
  sessionId: string;
}

export type AuthenticatedRequest = Request & {
  auth: {
    userId: string;
    plan:   Plan;
  };
  file?: any;
};

export interface WebToAppConfig {
  name:               string;
  version?:           string;
  appId:              string;
  mode:               "offline" | "online" | "hybrid";
  targets:            Array<"windows" | "linux" | "macos">;
  output?:            string;
  icon?:              string;
  defaultAdminEmail?: string;
}
