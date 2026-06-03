import path from "node:path";
import fs from "node:fs/promises";

import type { PipelineContext } from "../PipelineContext.js";

const STAGE = "06b-parity";

type ParityPolicy = "strict" | "warn" | "off";
type FindingLevel = "error" | "warn";

interface Finding {
  level: FindingLevel;
  message: string;
  file?: string;
  line?: number;
  suggestion?: string;
}

const CODE_EXT_RE = /\.(ts|tsx|js|jsx|vue|svelte)$/i;
const CLOUD_ENV_RE = /^\s*([A-Z0-9_]*(?:SUPABASE|FIREBASE|CLERK|AUTH0)[A-Z0-9_]*)\s*=/i;

/**
 * Stage 06b - Behavior parity gate
 *
 * Online conversions should preserve the web app source and cloud environment
 * values while producing a valid built dist for Electron packaging.
 */
export async function runParityStage(ctx: PipelineContext): Promise<void> {
  const policy: ParityPolicy = ctx.config.behaviorParity ?? "strict";
  if (policy === "off") {
    ctx.skipStage(STAGE, "behaviorParity is off");
    return;
  }

  ctx.startStage(STAGE);

  try {
    if (ctx.dryRun) {
      ctx.log("info", `[DRY-RUN] Would validate behavior parity (${policy})`, STAGE);
      ctx.completeStage(STAGE);
      return;
    }

    if (!ctx.plan || !ctx.detection) {
      throw new Error("Parity gate requires detection results and a migration plan");
    }

    const findings: Finding[] = [];
    if (ctx.config.mode === "online") {
      await checkOnlineSourceParity(ctx, findings);
      await checkCloudEnvPreserved(ctx, findings);
    } else {
      await checkOfflineSourceParity(ctx, findings);
    }
    await checkBuiltDist(ctx, findings);

    for (const finding of findings) {
      ctx.log(finding.level === "error" ? "error" : "warn", formatFinding(finding), STAGE);
    }

    const errors = findings.filter((finding) => finding.level === "error");
    if (policy === "strict" && errors.length > 0) {
      throw new Error(
        `Behavior parity gate blocked packaging with ${errors.length} blocking finding(s). Fix the items above or set behaviorParity to "warn" to package anyway.`,
      );
    }

    ctx.log(
      "info",
      findings.length === 0
        ? "Behavior parity gate passed"
        : `Behavior parity gate completed with ${findings.length} finding(s) under ${policy} policy`,
      STAGE,
    );
    ctx.completeStage(STAGE);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    ctx.failStage(STAGE, error);
    throw error;
  }
}

async function checkOnlineSourceParity(ctx: PipelineContext, findings: Finding[]): Promise<void> {
  if (ctx.plan!.filesToTransform.length > 0) {
    findings.push({
      level: "error",
      message: "Online conversions should not transform source files, but the migration plan contains transforms.",
    });
  }

  for (const absolutePath of ctx.detection!.scannedFiles) {
    if (!CODE_EXT_RE.test(absolutePath)) continue;

    const rel = ctx.relative(absolutePath);
    if (!normalizeRel(rel).startsWith("src/")) continue;

    const outputPath = path.join(ctx.outputDir, rel);
    const [sourceContent, outputContent] = await Promise.all([
      fs.readFile(absolutePath, "utf-8").catch(() => null),
      fs.readFile(outputPath, "utf-8").catch(() => null),
    ]);

    if (sourceContent !== null && outputContent !== null && sourceContent !== outputContent) {
      findings.push({
        level: "error",
        file: rel,
        message: "Online conversion output differs from the original web source.",
        suggestion: "Online conversion is intended to wrap web output without changing app code.",
      });
    }
  }
}

async function checkOfflineSourceParity(ctx: PipelineContext, findings: Finding[]): Promise<void> {
  for (const absolutePath of ctx.detection!.scannedFiles) {
    if (!CODE_EXT_RE.test(absolutePath)) continue;

    const rel = ctx.relative(absolutePath);
    if (!normalizeRel(rel).startsWith("src/")) continue;

    const sourceContent = await fs.readFile(absolutePath, "utf-8").catch(() => null);
    if (sourceContent === null) continue;

    if (sourceContent.includes("supabase.rpc(")) {
      findings.push({
        level: "error",
        file: rel,
        message: "Unsupported Supabase RPC behavior detected: rpc calls cannot be automatically converted for offline mode.",
        suggestion: "Replace the RPC call with standard table queries or implement a custom backend route.",
      });
    }

    if (sourceContent.includes("supabase.functions.invoke(")) {
      findings.push({
        level: "warn",
        file: rel,
        message: "Supabase Edge Function invocation detected. This will call the local fallback server which returns a 501 status.",
        suggestion: "Ensure the local backend routes handle these functions or mock them appropriately.",
      });
    }
  }
}

async function checkCloudEnvPreserved(ctx: PipelineContext, findings: Finding[]): Promise<void> {
  const sourceKeys = await readCloudEnvKeys(ctx.sourceDir);
  if (sourceKeys.size === 0) return;

  const outputEnv = await readEnvBundle(ctx.outputDir);
  for (const key of sourceKeys) {
    const keyPattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`, "m");
    if (!keyPattern.test(outputEnv)) {
      findings.push({
        level: "error",
        file: ".env",
        message: `Online conversion must preserve ${key}, but it is missing from output env files.`,
        suggestion: "Keep cloud env values so packaged behavior can match the web app.",
      });
    }
  }
}

async function checkBuiltDist(ctx: PipelineContext, findings: Finding[]): Promise<void> {
  const htmlPath = path.join(ctx.outputDir, "dist", "index.html");
  const html = await fs.readFile(htmlPath, "utf-8").catch(() => null);
  if (html === null) {
    findings.push({
      level: "error",
      file: "dist/index.html",
      message: "Build output is missing dist/index.html.",
    });
    return;
  }

  if (!/<script\b[^>]*type=["']module["'][^>]*src=/i.test(html)) {
    findings.push({
      level: "warn",
      file: "dist/index.html",
      message: "Built HTML does not contain a module script tag; the app may not mount.",
    });
  }

  if (/cdn\.gpteng\.co|gptengineer|lovable\.dev/i.test(html)) {
    findings.push({
      level: "error",
      file: "dist/index.html",
      message: "Known preview/runtime script is still present in built HTML.",
      suggestion: "Strip preview instrumentation before packaging.",
    });
  }

  const assetRefs = [...html.matchAll(/\b(?:src|href)=["']\.?\/?(assets\/[^"']+)["']/gi)]
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value));

  for (const assetRef of assetRefs) {
    const assetPath = path.join(ctx.outputDir, "dist", assetRef);
    if (!(await fileExists(assetPath))) {
      findings.push({
        level: "error",
        file: "dist/index.html",
        message: `Built HTML references missing asset ${assetRef}.`,
      });
    }
  }
}

function formatFinding(finding: Finding): string {
  const where = finding.file
    ? `${finding.file}${finding.line ? `:${finding.line}` : ""}: `
    : "";
  const suffix = finding.suggestion ? ` Suggestion: ${finding.suggestion}` : "";
  return `${where}${finding.message}${suffix}`;
}

async function readCloudEnvKeys(dir: string): Promise<Set<string>> {
  const keys = new Set<string>();
  for (const name of [".env", ".env.local", ".env.production"]) {
    const content = await fs.readFile(path.join(dir, name), "utf-8").catch(() => "");
    for (const line of content.split(/\r?\n/)) {
      if (line.trimStart().startsWith("#")) continue;
      const match = CLOUD_ENV_RE.exec(line);
      if (match?.[1]) keys.add(match[1]);
    }
  }
  return keys;
}

async function readEnvBundle(dir: string): Promise<string> {
  const chunks: string[] = [];
  for (const name of [".env", ".env.local", ".env.production"]) {
    chunks.push(await fs.readFile(path.join(dir, name), "utf-8").catch(() => ""));
  }
  return chunks.join("\n");
}

function normalizeRel(rel: string): string {
  return rel.replace(/\\/g, "/");
}

async function fileExists(filePath: string): Promise<boolean> {
  return fs.stat(filePath).then((stat) => stat.isFile()).catch(() => false);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
