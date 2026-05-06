import path from "node:path";
import fs from "node:fs/promises";

import { ReactDetector } from "./framework/ReactDetector.js";
import { VueDetector } from "./framework/VueDetector.js";
import { SupabaseDetector } from "./backend/SupabaseDetector.js";
import { SupabaseAuthDetector } from "./auth/SupabaseAuthDetector.js";
import { SchemaExtractor } from "./database/SchemaExtractor.js";

export type { SupabaseDetection } from "./backend/SupabaseDetector.js";
export type { SchemaExtractionResult, TableSchema, ColumnDef } from "./database/SchemaExtractor.js";

export interface DetectionResult {
  framework: "react" | "vue" | "svelte" | "angular" | "unknown";
  bundler: "vite" | "webpack" | "next" | "unknown";
  backend: "supabase" | "firebase" | "pocketbase" | "appwrite" | "none";
  auth: "supabase" | "firebase" | "clerk" | "auth0" | "none";
  tables: string[];
  uiLibrary: "shadcn" | "mui" | "tailwind" | "other";
  hasOfflineSupport: boolean;
  confidence: number;
  warnings: string[];
  scannedFiles: string[];
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

/**
 * Run all detectors against a project directory.
 * This is the main entry point for the detectors package.
 *
 * @example
 * ```ts
 * import { detectProject } from '@webtoapp/detectors';
 * const result = await detectProject('/path/to/my-app');
 * ```
 */
export async function detectProject(sourceDir: string): Promise<DetectionResult> {
  const warnings: string[] = [];

  // ── Read package.json ─────────────────────────────────────────
  const pkg = await readPackageJson(sourceDir);
  const deps = (pkg["dependencies"] as Record<string, string>) ?? {};
  const devDeps = (pkg["devDependencies"] as Record<string, string>) ?? {};
  const allDeps = { ...deps, ...devDeps };

  // ── Scan source files ─────────────────────────────────────────
  const scannedFiles = await scanSourceFiles(sourceDir);

  // ── Run detectors in parallel ─────────────────────────────────
  const [reactResult, vueResult, supabaseResult, supabaseAuthResult, schemaResult] =
    await Promise.all([
      new ReactDetector().detect(sourceDir, deps, devDeps),
      new VueDetector().detect(sourceDir, deps, devDeps),
      new SupabaseDetector().detect(sourceDir, allDeps, scannedFiles),
      new SupabaseAuthDetector().detect(sourceDir, scannedFiles),
      new SchemaExtractor().extract(sourceDir),
    ]);

  // ── Resolve framework ─────────────────────────────────────────
  let framework: DetectionResult["framework"] = "unknown";
  let bundler: DetectionResult["bundler"] = "unknown";
  let frameworkConfidence = 0.5;

  if (reactResult) {
    framework = reactResult.framework;
    bundler = reactResult.bundler;
    frameworkConfidence = reactResult.confidence;
    warnings.push(...reactResult.warnings);
  } else if (vueResult) {
    framework = vueResult.framework;
    bundler = vueResult.bundler;
    frameworkConfidence = vueResult.confidence;
    warnings.push(...vueResult.warnings);
  } else if ("svelte" in allDeps) {
    framework = "svelte";
    warnings.push("Svelte detected. Full Svelte transformer support is coming in Phase 3.");
    frameworkConfidence = 0.7;
  } else if ("@angular/core" in allDeps) {
    framework = "angular";
    warnings.push("Angular detected. Angular transformer support is coming in a future release.");
    frameworkConfidence = 0.6;
  }

  // ── Resolve backend ───────────────────────────────────────────
  let backend: DetectionResult["backend"] = "none";
  let backendConfidence = 1.0;

  if (supabaseResult.found) {
    backend = "supabase";
    backendConfidence = supabaseResult.confidence;
    warnings.push(...supabaseResult.warnings);
  } else if ("firebase" in allDeps || "firebase/app" in allDeps) {
    backend = "firebase";
    backendConfidence = 0.85;
  } else if ("pocketbase" in allDeps) {
    backend = "pocketbase";
    backendConfidence = 0.9;
    warnings.push("PocketBase detected. Transformer support is coming in Phase 3.");
  } else if ("appwrite" in allDeps) {
    backend = "appwrite";
    backendConfidence = 0.9;
    warnings.push("Appwrite detected. Transformer support is coming in a future release.");
  }

  // ── Resolve auth ──────────────────────────────────────────────
  let auth: DetectionResult["auth"] = "none";

  if ("@clerk/clerk-react" in allDeps || "@clerk/nextjs" in allDeps) {
    auth = "clerk";
  } else if ("@auth0/auth0-react" in allDeps) {
    auth = "auth0";
  } else if (supabaseResult.found || supabaseAuthResult.found) {
    auth = "supabase";
  } else if (backend === "firebase") {
    auth = "firebase";
  }

  warnings.push(...supabaseAuthResult.warnings);

  // ── Resolve UI library ────────────────────────────────────────
  let uiLibrary: DetectionResult["uiLibrary"] = "other";

  if ("@radix-ui/react-dialog" in allDeps || scannedFiles.some(
    (f) => f.includes("/components/ui/")
  )) {
    uiLibrary = "shadcn";
  } else if ("@mui/material" in allDeps) {
    uiLibrary = "mui";
  } else if ("tailwindcss" in allDeps || "tailwindcss" in devDeps) {
    uiLibrary = "tailwind";
  }

  // ── Offline support ───────────────────────────────────────────
  const hasOfflineSupport =
    "idb" in allDeps ||
    "dexie" in allDeps ||
    (await fileExists(path.join(sourceDir, "public", "sw.js"))) ||
    (await fileExists(path.join(sourceDir, "public", "service-worker.js")));

  // ── Overall confidence ────────────────────────────────────────
  const confidence = Math.min(
    (frameworkConfidence * 0.5) + (backendConfidence * 0.5),
    1.0
  );

  warnings.push(...schemaResult.warnings);

  return {
    framework,
    bundler,
    backend,
    auth,
    tables: schemaResult.tableNames,
    uiLibrary,
    hasOfflineSupport,
    confidence,
    warnings: [...new Set(warnings)], // deduplicate
    scannedFiles,
    dependencies: deps,
    devDependencies: devDeps,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function readPackageJson(sourceDir: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(path.join(sourceDir, "package.json"), "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function scanSourceFiles(sourceDir: string): Promise<string[]> {
  const files: string[] = [];

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
        if (!["node_modules", ".git", "dist", ".next", "build", "coverage"].includes(entry.name as string)) {
          await walk(full);
        }
      } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name as string)) {
        files.push(full);
      }
    }
  }

  await walk(sourceDir);
  return files;
}

async function fileExists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true).catch(() => false);
}

export { FirebaseDetector } from "./backend/FirebaseDetector.js";
export type { FirebaseDetectionResult } from "./backend/FirebaseDetector.js";

export { ClerkDetector } from "./auth/ClerkDetector.js";
export type { ClerkDetectionResult } from "./auth/ClerkDetector.js";
