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
 * Runs after the web build and before packaging. The gate does not promise
 * impossible magic: instead, it blocks strict builds when the selected mode
 * cannot preserve the source app's behavior. Online mode is checked for
 * verbatim source preservation. Offline/hybrid modes are checked for
 * unsupported cloud features, low-confidence rewrites, missing compatibility
 * modules, and leftover imports that would break at runtime.
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
    const mode = ctx.config.mode ?? "offline";

    if (mode === "online") {
      await checkOnlineSourceParity(ctx, findings);
      await checkCloudEnvPreserved(ctx, findings, "online");
    } else {
      checkModeSupport(ctx, findings);
      checkTransformConfidence(ctx, findings);
      await scanSourceForUnsupportedFeatures(ctx, findings);
      await scanOutputForRuntimeBreaks(ctx, findings);
      await checkGeneratedCompatibilityFiles(ctx, findings);
      if (mode === "hybrid") {
        await checkCloudEnvPreserved(ctx, findings, "hybrid");
      }
    }

    await checkBuiltDist(ctx, findings);

    for (const finding of findings) {
      ctx.log(finding.level === "error" ? "error" : "warn", formatFinding(finding), STAGE);
    }

    const errors = findings.filter((finding) => finding.level === "error");
    if (policy === "strict" && errors.length > 0) {
      throw new Error(
        [
          `Behavior parity gate blocked packaging with ${errors.length} blocking finding(s).`,
          "Use mode \"online\" for exact web behavior, fix the items above, or set behaviorParity to \"warn\" to package anyway.",
        ].join(" ")
      );
    }

    ctx.log(
      "info",
      findings.length === 0
        ? "Behavior parity gate passed"
        : `Behavior parity gate completed with ${findings.length} finding(s) under ${policy} policy`,
      STAGE
    );
    ctx.completeStage(STAGE);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    ctx.failStage(STAGE, error);
    throw error;
  }
}

function checkModeSupport(ctx: PipelineContext, findings: Finding[]): void {
  const { backend, framework, confidence } = ctx.detection!;

  if (confidence < 0.8) {
    findings.push({
      level: "error",
      message: `Detection confidence is ${(confidence * 100).toFixed(0)}%, so strict behavior parity cannot be guaranteed.`,
      suggestion: "Review detector warnings or use online mode for exact behavior.",
    });
  }

  if (backend === "pocketbase" || backend === "appwrite") {
    findings.push({
      level: "error",
      message: `${backend} backend conversion is not implemented for offline/hybrid parity.`,
      suggestion: "Use online mode or add a backend transformer before packaging.",
    });
  }

  if (backend === "firebase") {
    findings.push({
      level: "error",
      message: "Firebase offline/hybrid conversion is marked partial, so strict behavior parity cannot be guaranteed.",
      suggestion: "Use online mode for exact Firebase behavior, or set behaviorParity to warn after manual testing.",
    });
  }

  if (framework === "vue" || framework === "angular" || framework === "unknown") {
    findings.push({
      level: "error",
      message: `${framework} framework conversion is not strict-parity ready in offline/hybrid mode.`,
      suggestion: "Use online mode for exact behavior or manually validate the converted app.",
    });
  }
}

function checkTransformConfidence(ctx: PipelineContext, findings: Finding[]): void {
  const risky = ctx.plan!.filesToTransform.filter(
    (file) => file.confidence < 0.8 || file.transformerType === "ai"
  );

  for (const file of risky.slice(0, 20)) {
    findings.push({
      level: "error",
      file: file.sourcePath,
      message: `Low-confidence ${file.transformerType} transform (${(file.confidence * 100).toFixed(0)}%) cannot guarantee identical behavior.`,
      suggestion: file.reason,
    });
  }

  if (risky.length > 20) {
    findings.push({
      level: "error",
      message: `${risky.length - 20} additional low-confidence transform(s) were omitted from the log.`,
    });
  }
}

async function scanSourceForUnsupportedFeatures(ctx: PipelineContext, findings: Finding[]): Promise<void> {
  const mode = ctx.config.mode ?? "offline";
  const sourceFiles = ctx.detection!.scannedFiles;

  for (const absolutePath of sourceFiles) {
    if (!CODE_EXT_RE.test(absolutePath)) continue;
    const rel = ctx.relative(absolutePath);
    const content = await fs.readFile(absolutePath, "utf-8").catch(() => "");
    if (!content) continue;

    addMatches(findings, content, rel, /\bsupabase\s*\.\s*rpc\s*\(/g, {
      message: "Supabase RPC calls do not have an automatic local equivalent.",
      suggestion: "Create a local Express route for this RPC or use online mode.",
    });

    addMatches(findings, content, rel, /\bsupabase\s*\.\s*functions\s*\.\s*invoke\s*\(/g, {
      level: "warn",
      message: "Supabase Edge Function calls cannot be preserved in offline mode.",
      suggestion: "The generated localApi.functions.invoke() shim will return a clear error. Port the function into the generated backend or use online mode for full behavior.",
    });

    addMatches(
      findings,
      content,
      rel,
      /supabase\s*\.\s*from\s*\([\s\S]{0,600}?\.(?:or|filter|contains|containedBy|overlaps|textSearch|range|order|limit|neq|gt|gte|lt|lte|in|is|not|maybeSingle)\s*\(/g,
      {
        message: "Advanced Supabase query chaining exceeds the strict local API compatibility layer.",
        suggestion: "Simplify the query, add localApi support for this method, or use online mode.",
      }
    );

    addMatches(
      findings,
      content,
      rel,
      /supabase\s*\.\s*storage[\s\S]{0,400}?\.(?:createSignedUrl|createSignedUrls|move|copy|createBucket|removeBucket)\s*\(/g,
      {
        message: "Advanced Supabase Storage operations are not automatically mirrored locally.",
        suggestion: "Implement matching storage endpoints or use online mode.",
      }
    );

    addMatches(
      findings,
      content,
      rel,
      /supabase\s*\.\s*auth\s*\.(?:signInWithOAuth|signInWithOtp|signInWithMagicLink|resetPasswordForEmail|verifyOtp|mfa)\b/g,
      {
        message: "Cloud auth flows such as OAuth, OTP, password reset, or MFA cannot be identical in local auth.",
        suggestion: "Use online mode for exact auth behavior or replace the flow with local email/password auth.",
      }
    );

    addMatches(findings, content, rel, /\.on\s*\(\s*['"](?:broadcast|presence)['"]/g, {
      message: "Supabase broadcast/presence channels cannot be preserved by the local SSE table-change bridge.",
      suggestion: "Use online mode or implement a custom local realtime channel.",
    });

    addMatches(findings, content, rel, /\.track\s*\(/g, {
      message: "Presence tracking cannot be preserved in offline mode.",
      suggestion: "Use online mode or implement local presence semantics.",
    });

    if (mode === "offline") {
      addMatches(findings, content, rel, /fetch\s*\(\s*['"`]https?:\/\//g, {
        message: "Direct external HTTP calls will not work the same in offline mode.",
        suggestion: "Cache/replace this API locally, or use hybrid/online mode.",
      });
    }
  }
}

async function scanOutputForRuntimeBreaks(ctx: PipelineContext, findings: Finding[]): Promise<void> {
  const srcDir = path.join(ctx.outputDir, "src");
  if (!(await dirExists(srcDir))) return;

  const removedDeps = ctx.plan!.dependenciesToRemove;
  const files = await collectFiles(srcDir);

  for (const filePath of files) {
    const rel = normalizeRel(path.relative(ctx.outputDir, filePath));
    const content = await fs.readFile(filePath, "utf-8").catch(() => "");
    const isSyncEngine = rel === "src/lib/syncEngine.ts";

    if (/undefined\s*\/\*\s*removed by WebToApp\s*\*\//.test(content)) {
      findings.push({
        level: "error",
        file: rel,
        message: "A transformed file still contains an undefined env placeholder.",
        suggestion: "Rewrite this file to use localApi or preserve the env value in online/hybrid mode.",
      });
    }

    for (const dependency of removedDeps) {
      if (importsDependency(content, dependency)) {
        findings.push({
          level: "error",
          file: rel,
          message: `Output still imports ${dependency}, but that dependency is removed from package.json.`,
          suggestion: "Fix the transformer output or keep the build in online mode.",
        });
      }
    }

    if (!isSyncEngine && (importsDependency(content, "@supabase/supabase-js") || importsDependency(content, "firebase"))) {
      findings.push({
        level: "error",
        file: rel,
        message: "Cloud SDK import remains in app source outside the generated hybrid sync engine.",
        suggestion: "Move cloud access into syncEngine, transform it to localApi, or use online mode.",
      });
    }
  }
}

async function checkGeneratedCompatibilityFiles(ctx: PipelineContext, findings: Finding[]): Promise<void> {
  const localApiPath = path.join(ctx.outputDir, "src", "lib", "localApi.ts");
  const localAuthPath = path.join(ctx.outputDir, "src", "lib", "localAuth.ts");
  const srcDir = path.join(ctx.outputDir, "src");

  if (ctx.config.backend.type !== "none" && !(await fileExists(localApiPath))) {
    findings.push({
      level: "error",
      file: "src/lib/localApi.ts",
      message: "localApi compatibility client was not generated.",
    });
  }

  if (!(await dirExists(srcDir))) return;

  const files = await collectFiles(srcDir);
  let importsLocalAuth = false;

  for (const file of files) {
    const content = await fs.readFile(file, "utf-8").catch(() => "");
    if (content.includes("@/lib/localAuth") || content.includes("./localAuth") || content.includes("../lib/localAuth")) {
      importsLocalAuth = true;
      break;
    }
  }

  if (importsLocalAuth && !(await fileExists(localAuthPath))) {
    findings.push({
      level: "error",
      file: "src/lib/localAuth.ts",
      message: "Converted auth code imports localAuth, but the compatibility wrapper is missing.",
    });
  }
}

async function checkOnlineSourceParity(ctx: PipelineContext, findings: Finding[]): Promise<void> {
  if (ctx.plan!.filesToTransform.length > 0) {
    findings.push({
      level: "error",
      message: "Online mode should not transform source files, but the migration plan contains transforms.",
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
        message: "Online mode source file differs from the original web source.",
        suggestion: "Online mode is intended to wrap Lovable output without changing app code.",
      });
    }
  }
}

async function checkCloudEnvPreserved(
  ctx: PipelineContext,
  findings: Finding[],
  mode: "online" | "hybrid"
): Promise<void> {
  const sourceKeys = await readCloudEnvKeys(ctx.sourceDir);
  if (sourceKeys.size === 0) return;

  const outputEnv = await readEnvBundle(ctx.outputDir);
  for (const key of sourceKeys) {
    const keyPattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`, "m");
    if (!keyPattern.test(outputEnv)) {
      findings.push({
        level: "error",
        file: ".env",
        message: `${mode} mode must preserve ${key}, but it is missing from output env files.`,
        suggestion: "Keep cloud env values for online/hybrid mode, or use offline mode only after local replacement.",
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
      message: "Known Lovable preview/runtime script is still present in built HTML.",
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

function addMatches(
  findings: Finding[],
  content: string,
  file: string,
  pattern: RegExp,
  details: Pick<Finding, "message" | "suggestion"> & Partial<Pick<Finding, "level">>
): void {
  for (const match of content.matchAll(pattern)) {
    findings.push({
      level: details.level ?? "error",
      file,
      line: lineNumber(content, match.index ?? 0),
      ...details,
    });
  }
}

function formatFinding(finding: Finding): string {
  const where = finding.file
    ? `${finding.file}${finding.line ? `:${finding.line}` : ""}: `
    : "";
  const suffix = finding.suggestion ? ` Suggestion: ${finding.suggestion}` : "";
  return `${where}${finding.message}${suffix}`;
}

function importsDependency(content: string, dependency: string): boolean {
  const escaped = escapeRegExp(dependency);
  const importPattern = new RegExp(
    `(?:from\\s+|import\\s*\\(\\s*|require\\s*\\(\\s*|import\\s+)['"](${escaped}(?:/[^'"]*)?)['"]`,
    "g"
  );

  return importPattern.test(content);
}

async function collectFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  const ignoredDirs = new Set(["node_modules", "dist", "release", ".git", "android", "ios"]);

  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name)) {
          await walk(path.join(current, entry.name));
        }
        continue;
      }

      if (CODE_EXT_RE.test(entry.name)) {
        files.push(path.join(current, entry.name));
      }
    }
  }

  await walk(dir);
  return files;
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

function lineNumber(content: string, index: number): number {
  return content.slice(0, index).split(/\r?\n/).length;
}

function normalizeRel(rel: string): string {
  return rel.replace(/\\/g, "/");
}

async function fileExists(filePath: string): Promise<boolean> {
  return fs.stat(filePath).then((stat) => stat.isFile()).catch(() => false);
}

async function dirExists(dirPath: string): Promise<boolean> {
  return fs.stat(dirPath).then((stat) => stat.isDirectory()).catch(() => false);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
