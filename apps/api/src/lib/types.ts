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
  mode:               "online";
  targets:            Array<"windows" | "linux" | "macos" | "mac" | "android" | "ios">;
  output?:            string;
  icon?:              string;
  defaultAdminEmail?: string;
  mobile?: {
    webDir?: string;
    android?: {
      minSdkVersion?: number;
      targetSdkVersion?: number;
      buildVariant?: "debug" | "release";
      artifactType?: "apk" | "aab";
      keystorePath?: string;
      keystoreAlias?: string;
      keystorePassword?: string;
      keystoreAliasPassword?: string;
    };
    ios?: {
      deploymentTarget?: string;
      developmentTeam?: string;
    };
  };
}
