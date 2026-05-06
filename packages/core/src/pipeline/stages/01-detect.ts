import path from "node:path";
import fs from "node:fs/promises";

import type { PipelineContext } from "../PipelineContext.js";
import type { DetectionResult } from "../../types/DetectionResult.js";

const STAGE = "01-detect";

/**
 * Stage 01 — Detect
 *
 * Scans the source project and produces a DetectionResult describing:
 * - Framework (React, Vue, Svelte, …)
 * - Bundler (Vite, Webpack, Next.js, …)
 * - Cloud backend (Supabase, Firebase, …)
 * - Auth provider (Clerk, Auth0, …)
 * - Database tables
 * - UI library
 *
 * The full detector modules (packages/detectors) are wired in Session 2.
 * This stage provides a lightweight in-pipeline version that handles the
 * most common case (React + Vite + Supabase) without importing the full
 * detector package, so the core pipeline works standalone.
 */
export async function runDetectStage(ctx: PipelineContext): Promise<void> {
  ctx.startStage(STAGE);

  try {
    const result = await detectProject(ctx.sourceDir, ctx);
    ctx.detection = result;

    ctx.log("info", `Framework:  ${result.framework}`, STAGE);
    ctx.log("info", `Bundler:    ${result.bundler}`, STAGE);
    ctx.log("info", `Backend:    ${result.backend}`, STAGE);
    ctx.log("info", `Auth:       ${result.auth}`, STAGE);
    ctx.log("info", `Tables:     ${result.tables.join(", ") || "none detected"}`, STAGE);
    ctx.log("info", `Confidence: ${(result.confidence * 100).toFixed(0)}%`, STAGE);

    if (result.warnings.length > 0) {
      for (const w of result.warnings) ctx.log("warn", w, STAGE);
    }

    ctx.completeStage(STAGE);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    ctx.failStage(STAGE, error);
    throw error;
  }
}

// ─── Internal detection logic ─────────────────────────────────────────────────

async function detectProject(
  sourceDir: string,
  ctx: PipelineContext
): Promise<DetectionResult> {
  // Read package.json
  const pkgPath = path.join(sourceDir, "package.json");
  let pkg: Record<string, unknown> = {};

  try {
    const raw = await fs.readFile(pkgPath, "utf-8");
    pkg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    ctx.log("warn", "Could not read package.json — detection will be limited", STAGE);
  }

  const deps = flattenDeps(pkg);
  const devDeps = flattenDevDeps(pkg);
  const allDeps = { ...deps, ...devDeps };

  // Scan source files for import patterns
  const sourceFiles = await scanSourceFiles(sourceDir);
  const importedModules = await extractImports(sourceFiles);

  const warnings: string[] = [];

  // ── Framework ─────────────────────────────────────────────────
  let framework: DetectionResult["framework"] = "unknown";
  if ("react" in allDeps) framework = "react";
  else if ("vue" in allDeps) framework = "vue";
  else if ("svelte" in allDeps) framework = "svelte";
  else if ("@angular/core" in allDeps) framework = "angular";

  const frameworkDetected = framework !== "unknown";

  if (framework === "unknown") {
    warnings.push("Could not determine framework. Defaulting to 'react'.");
    framework = "react";
  }

  // ── Bundler ────────────────────────────────────────────────────
  let bundler: DetectionResult["bundler"] = "unknown";
  if ("vite" in allDeps || "vite" in devDeps) bundler = "vite";
  else if ("next" in allDeps) bundler = "next";
  else if ("webpack" in allDeps || "react-scripts" in allDeps) bundler = "webpack";

  // ── Backend ────────────────────────────────────────────────────
  let backend: DetectionResult["backend"] = "none";
  const hasSupabase =
    "@supabase/supabase-js" in allDeps ||
    importedModules.has("@supabase/supabase-js");
  const hasFirebase =
    "firebase" in allDeps || importedModules.has("firebase/app");
  const hasPocketBase =
    "pocketbase" in allDeps || importedModules.has("pocketbase");

  if (hasSupabase) backend = "supabase";
  else if (hasFirebase) backend = "firebase";
  else if (hasPocketBase) backend = "pocketbase";

  // ── Auth ───────────────────────────────────────────────────────
  let auth: DetectionResult["auth"] = "none";
  const hasClerk =
    "@clerk/clerk-react" in allDeps ||
    "@clerk/nextjs" in allDeps ||
    importedModules.has("@clerk/clerk-react");
  const hasAuth0 =
    "@auth0/auth0-react" in allDeps || importedModules.has("@auth0/auth0-react");

  if (hasClerk) auth = "clerk";
  else if (hasAuth0) auth = "auth0";
  else if (hasSupabase) auth = "supabase";  // Supabase ships built-in auth
  else if (hasFirebase) auth = "firebase";

  // ── UI Library ─────────────────────────────────────────────────
  let uiLibrary: DetectionResult["uiLibrary"] = "other";
  if ("@radix-ui/react-dialog" in allDeps || importedModules.has("@/components/ui/button")) {
    uiLibrary = "shadcn";
  } else if ("@mui/material" in allDeps) {
    uiLibrary = "mui";
  } else if ("tailwindcss" in allDeps || "tailwindcss" in devDeps) {
    uiLibrary = "tailwind";
  }

  // ── Tables ─────────────────────────────────────────────────────
  const tables = await extractTableNames(sourceDir);

  // ── Offline support ────────────────────────────────────────────
  const hasOfflineSupport =
    "idb" in allDeps ||
    "dexie" in allDeps ||
    (await fileExists(path.join(sourceDir, "public", "sw.js"))) ||
    (await fileExists(path.join(sourceDir, "public", "service-worker.js")));

  // ── Confidence score ───────────────────────────────────────────
  let confidence = 0.5;
  if (frameworkDetected) confidence += 0.2;
  if (bundler !== "unknown") confidence += 0.1;
  if (backend !== "none") confidence += 0.2;
  confidence = Math.min(confidence, 1.0);

  if (confidence < 0.6) {
    warnings.push(
      `Low detection confidence (${(confidence * 100).toFixed(0)}%). ` +
        `Consider running with --verbose and checking the source project structure.`
    );
  }

  return {
    framework,
    bundler,
    backend,
    auth,
    tables,
    uiLibrary,
    hasOfflineSupport,
    confidence,
    warnings,
    scannedFiles: sourceFiles,
    dependencies: deps,
    devDependencies: devDeps,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function flattenDeps(pkg: Record<string, unknown>): Record<string, string> {
  const d = pkg["dependencies"];
  return typeof d === "object" && d !== null ? (d as Record<string, string>) : {};
}

function flattenDevDeps(pkg: Record<string, unknown>): Record<string, string> {
  const d = pkg["devDependencies"];
  return typeof d === "object" && d !== null ? (d as Record<string, string>) : {};
}

async function scanSourceFiles(sourceDir: string): Promise<string[]> {
  const files: string[] = [];
  const srcDir = path.join(sourceDir, "src");

  async function walk(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true }) as any;
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name as string);
      if (entry.isDirectory()) {
        if (!["node_modules", ".git", "dist", ".next", "build"].includes(entry.name as string)) {
          await walk(full);
        }
      } else if (/\.(ts|tsx|js|jsx|css|scss|sass|less|html|json|svg|png|jpg|jpeg|webp|woff|woff2)$/.test(entry.name as string)) {
        files.push(full);
      }
    }
  }

  const targetDir = await fileExists(srcDir) ? srcDir : sourceDir;
  await walk(targetDir);
  return files;
}

async function extractImports(files: string[]): Promise<Set<string>> {
  const modules = new Set<string>();
  const importRe = /from\s+['"]([^'"]+)['"]/g;

  for (const file of files.slice(0, 100)) { // limit to first 100 files for speed
    try {
      const content = await fs.readFile(file, "utf-8");
      let match: RegExpExecArray | null;
      importRe.lastIndex = 0;
      while ((match = importRe.exec(content)) !== null) {
        const mod = match[1];
        if (mod && !mod.startsWith(".") && !mod.startsWith("/")) {
          // Normalize to package root (e.g. "firebase/app" → keep as-is, "@scope/pkg/sub" → "@scope/pkg")
          modules.add(mod);
        }
      }
    } catch {
      // skip unreadable files
    }
  }

  return modules;
}

async function extractTableNames(sourceDir: string): Promise<string[]> {
  const tables = new Set<string>();

  // Strategy 1: read Supabase SQL migrations
  const migrationsDir = path.join(sourceDir, "supabase", "migrations");
  if (await fileExists(migrationsDir)) {
    const files = await fs.readdir(migrationsDir).catch(() => []);
    for (const file of files) {
      if (!file.endsWith(".sql")) continue;
      const sql = await fs.readFile(path.join(migrationsDir, file), "utf-8").catch(() => "");
      const matches = sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?["']?(\w+)["']?/gi);
      for (const m of matches) {
        if (m[1]) tables.add(m[1]);
      }
    }
  }

  // Strategy 2: parse supabase/types.ts for Database interface
  const typesPath = path.join(sourceDir, "src", "integrations", "supabase", "types.ts");
  const altTypesPath = path.join(sourceDir, "supabase", "types.ts");

  for (const tp of [typesPath, altTypesPath]) {
    if (!(await fileExists(tp))) continue;
    const content = await fs.readFile(tp, "utf-8").catch(() => "");
    const matches = content.matchAll(/["'](\w+)["']\s*:/g);
    for (const m of matches) {
      if (m[1] && !["Row", "Insert", "Update", "Relationships"].includes(m[1])) {
        tables.add(m[1]);
      }
    }
  }

  return [...tables];
}

async function fileExists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true).catch(() => false);
}
