import path from "node:path";
import fs from "node:fs/promises";

import type { PipelineContext } from "../PipelineContext.js";

const STAGE = "07c-sign";

/**
 * Stage 07c — Code Signing
 *
 * Validates that signing credentials are available and surfaces clear
 * instructions when they are not. The actual signing is performed by
 * electron-builder (stage 07-package) using environment variables; this
 * stage's job is to:
 *
 *   1. Read signing config from webtoapp.config.json
 *   2. Map config fields → environment variables that electron-builder reads
 *   3. Warn (or fail, when --sign flag is set) if credentials are missing
 *   4. Log a clear summary of what is/isn't signed
 *
 * Supported providers:
 *   • Windows: WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD  (OV or EV .pfx cert)
 *   • macOS:   CSC_LINK + CSC_KEY_PASSWORD + APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID
 */
export async function runSignStage(ctx: PipelineContext): Promise<void> {
  ctx.startStage(STAGE);

  try {
    const signing = (ctx.config as { signing?: SigningConfig }).signing;
    const targets = ctx.config.targets ?? [];

    const wantsWindows = targets.includes("windows" as never);
    const wantsMac     = targets.includes("mac" as never);

    const results: SignResult[] = [];

    // ── Windows ────────────────────────────────────────────────────────────
    if (wantsWindows) {
      const win = await resolveWindowsSigning(signing?.windows, ctx);
      results.push(win);
    }

    // ── macOS ──────────────────────────────────────────────────────────────
    if (wantsMac) {
      const mac = await resolveMacSigning(signing?.mac, ctx);
      results.push(mac);
    }

    // ── Summary ────────────────────────────────────────────────────────────
    const signed   = results.filter((r) => r.ready);
    const unsigned = results.filter((r) => !r.ready);

    if (signed.length > 0) {
      ctx.log("info", `Code signing ready for: ${signed.map((r) => r.platform).join(", ")}`, STAGE);
    }

    if (unsigned.length > 0) {
      const msg =
        `Code signing NOT configured for: ${unsigned.map((r) => r.platform).join(", ")}.\n` +
        unsigned.map((r) => `  ${r.platform}: ${r.hint}`).join("\n");

      // In a future --sign=strict mode this would be ctx.failStage.
      // For now, always warn — unsigned apps still work, they just show OS warnings.
      ctx.log("warn", msg, STAGE);
    }

    ctx.completeStage(STAGE);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    ctx.failStage(STAGE, error);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------
async function resolveWindowsSigning(
  winConfig: SigningConfig["windows"] | undefined,
  ctx: PipelineContext
): Promise<SignResult> {
  // env vars take priority over config file
  const certLink = process.env["WIN_CSC_LINK"] ?? (winConfig?.certificatePath
    ? await resolveCertPath(winConfig.certificatePath, ctx.sourceDir)
    : undefined);
  const certPass = process.env["WIN_CSC_KEY_PASSWORD"] ?? winConfig?.certificatePassword;

  if (certLink && certPass) {
    // Expose to electron-builder
    process.env["WIN_CSC_LINK"]         = certLink;
    process.env["WIN_CSC_KEY_PASSWORD"] = certPass;
    return { platform: "Windows", ready: true, hint: "" };
  }

  return {
    platform: "Windows",
    ready: false,
    hint:
      "Set WIN_CSC_LINK (base64-encoded .pfx) and WIN_CSC_KEY_PASSWORD env vars, " +
      "or add 'signing.windows.certificatePath' to webtoapp.config.json.",
  };
}

// ---------------------------------------------------------------------------
// macOS
// ---------------------------------------------------------------------------
async function resolveMacSigning(
  macConfig: SigningConfig["mac"] | undefined,
  ctx: PipelineContext
): Promise<SignResult> {
  const certLink = process.env["CSC_LINK"] ?? (macConfig?.certificatePath
    ? await resolveCertPath(macConfig.certificatePath, ctx.sourceDir)
    : undefined);
  const certPass  = process.env["CSC_KEY_PASSWORD"]              ?? macConfig?.certificatePassword;
  const appleId   = process.env["APPLE_ID"]                      ?? macConfig?.appleId;
  const applePass = process.env["APPLE_APP_SPECIFIC_PASSWORD"]   ?? macConfig?.appleIdPassword;
  const teamId    = process.env["APPLE_TEAM_ID"]                 ?? macConfig?.teamId;

  const hasSigningCert = certLink && certPass;
  const hasNotarize    = appleId && applePass && teamId;

  if (hasSigningCert && hasNotarize) {
    process.env["CSC_LINK"]                        = certLink;
    process.env["CSC_KEY_PASSWORD"]                = certPass;
    process.env["APPLE_ID"]                        = appleId;
    process.env["APPLE_APP_SPECIFIC_PASSWORD"]     = applePass;
    process.env["APPLE_TEAM_ID"]                   = teamId;
    return { platform: "macOS", ready: true, hint: "" };
  }

  const missing: string[] = [];
  if (!hasSigningCert) missing.push("CSC_LINK + CSC_KEY_PASSWORD (Developer ID .p12 cert)");
  if (!hasNotarize)    missing.push("APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID");

  return {
    platform: "macOS",
    ready: false,
    hint: `Missing: ${missing.join("; ")}. Get a Developer ID cert and Apple Developer account.`,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function resolveCertPath(relativePath: string, sourceDir: string): Promise<string | undefined> {
  const absolute = path.resolve(sourceDir, relativePath);
  try {
    const data = await fs.readFile(absolute);
    return data.toString("base64");
  } catch {
    return undefined;
  }
}

interface SignResult {
  platform: string;
  ready: boolean;
  hint: string;
}

interface SigningConfig {
  windows?: {
    certificatePath?: string;
    certificatePassword?: string;
    publisherName?: string;
  };
  mac?: {
    certificatePath?: string;
    certificatePassword?: string;
    appleId?: string;
    appleIdPassword?: string;
    teamId?: string;
  };
}
