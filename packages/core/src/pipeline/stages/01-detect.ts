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
  const isUrl = sourceDir.startsWith("http://") || sourceDir.startsWith("https://");
  
  if (isUrl) {
    return {
      isLiveUrl: true,
      liveUrl: sourceDir,
      framework: "react", // wrapper shell is built using react
      bundler: "vite",
      backend: "none",
      auth: "none",
      tables: [],
      tableColumns: {},
      rlsPolicies: {},
      uiLibrary: "other",
      hasOfflineSupport: false,
      confidence: 1.0,
      warnings: [],
      scannedFiles: [],
      dependencies: {},
      devDependencies: {},
      pathAliases: {},
    };
  }

  // Read package.json
  const pkgPath = path.join(sourceDir, "package.json");
  let pkg: Record<string, unknown> = {};
  let isStaticPlain = false;

  try {
    const raw = await fs.readFile(pkgPath, "utf-8");
    pkg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    ctx.log("warn", "Could not read package.json — treating as static site", STAGE);
    isStaticPlain = true;
  }

  const deps = flattenDeps(pkg);
  const devDeps = flattenDevDeps(pkg);
  const allDeps = { ...deps, ...devDeps };

  // Scan source files for import patterns
  const sourceFiles = await scanSourceFiles(sourceDir);
  const importedModules = await extractImports(sourceFiles);

  const warnings: string[] = [];

  if (isStaticPlain) {
    ctx.log("info", "Detected static/plain web files. Configuring minimal build pipeline.", STAGE);

    // ── Backend connectivity check for static sites ──────────────────────
    // Scan JS files for fetch/XHR calls that target localhost or relative
    // API paths. These will break in the packaged Electron app because there
    // is no local server running and relative paths go to the static file server.
    const backendWarnings = await detectStaticBackendCalls(sourceDir, sourceFiles);
    for (const w of backendWarnings) {
      ctx.log("warn", w, STAGE);
    }

    return {
      isStaticPlain: true,
      framework: "static",
      bundler: "vite",
      backend: "none",
      auth: "none",
      tables: [],
      tableColumns: {},
      rlsPolicies: {},
      uiLibrary: "other",
      hasOfflineSupport: false,
      confidence: 1.0,
      warnings: backendWarnings,
      scannedFiles: sourceFiles,
      dependencies: {},
      devDependencies: {},
      pathAliases: {},
    };
  }

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

  // Browser-local / offline persistence
  const hasOfflineSupport =
    "idb" in allDeps ||
    "dexie" in allDeps ||
    (await fileExists(path.join(sourceDir, "public", "sw.js"))) ||
    (await fileExists(path.join(sourceDir, "public", "service-worker.js")));

  // ── Improvement #3: Extract per-table column definitions ───────
  const tableColumns = await extractTableColumns(sourceDir);

  // ── Improvement #6: Auto-detect app icon ───────────────────────
  const iconPath = await detectIconPath(sourceDir);
  if (iconPath) ctx.log("info", `Icon auto-detected: ${iconPath}`, STAGE);

  // ── Improvement #11: Detect TypeScript path aliases ────────────
  const pathAliases = await extractPathAliases(sourceDir);
  if (Object.keys(pathAliases).length > 0) {
    ctx.log("info", `Path aliases: ${Object.keys(pathAliases).join(", ")}`, STAGE);
  }

  // ── Phase 2: Extract RLS Policies ──────────────────────────────
  const rlsPolicies = await extractRlsPolicies(sourceDir);
  const rlsTableCount = Object.keys(rlsPolicies).length;
  if (rlsTableCount > 0) {
    ctx.log("info", `Detected RLS policies for ${rlsTableCount} tables`, STAGE);
  }

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

  // ── Backend connectivity check for no-cloud-backend projects ──────────────
  // If the project doesn't use Supabase/Firebase/PocketBase but is making
  // fetch() calls to localhost or relative /api/ paths, those calls will break
  // in the packaged Electron app (no local server runs inside Electron).
  if (backend === "none") {
    const backendWarnings = await detectStaticBackendCalls(sourceDir, sourceFiles);
    for (const w of backendWarnings) {
      warnings.push(w);
      ctx.log("warn", w, STAGE);
    }
  }

  return {
    framework,
    bundler,
    backend,
    auth,
    tables,
    tableColumns,
    rlsPolicies,
    uiLibrary,
    hasOfflineSupport,
    confidence,
    warnings,
    scannedFiles: sourceFiles,
    dependencies: deps,
    devDependencies: devDeps,
    iconPath,
    pathAliases,
  };
}


// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Scan plain HTML/JS files for backend API calls that will break in a packaged
 * Electron app. Looks for:
 *  - fetch('http://localhost:...')  → local dev server, won't exist after packaging
 *  - fetch('/api/...')              → relative path, resolves to static file server (404)
 *  - new XMLHttpRequest() + open('...localhost...') → same issues
 *  - axios.get('/api/...')          → relative path
 *  - $.ajax({ url: '/api/...' })   → jQuery relative path
 */
async function detectStaticBackendCalls(
  sourceDir: string,
  sourceFiles: string[]
): Promise<string[]> {
  const warnings: string[] = [];

  // Scan frontend code files where API calls commonly live.
  const jsFiles = sourceFiles.filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(f));

  // Patterns that indicate localhost backend calls
  const LOCALHOST_RE = /(?:\bfetch\s*\(\s*|axios\.(?:get|post|put|patch|delete)\s*\(\s*|request\s*\(\s*)['"`](https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/[^'"`]*)/gi;
  // Patterns that indicate relative API path calls (likely backend routes)
  const RELATIVE_API_RE = /(?:\bfetch\s*\(\s*|axios\.(?:get|post|put|patch|delete)\s*\(\s*)['"`](\/api\/[^'"`]*)/gi;
  // XMLHttpRequest with localhost
  const XHR_LOCALHOST_RE = /\.open\s*\(\s*['"`][A-Z]+['"`]\s*,\s*['"`](https?:\/\/localhost[^'"`]*)/gi;
  // jQuery AJAX with localhost or /api
  const JQUERY_AJAX_RE = /\$\.(?:ajax|get|post|getJSON)\s*\(\s*['"`]((?:https?:\/\/localhost|\/api\/)[^'"`]*)/gi;

  const localhostFiles: string[] = [];
  const relativeApiFiles: string[] = [];

  for (const file of jsFiles.slice(0, 50)) {
    let content: string;
    try {
      content = await fs.readFile(file, "utf-8");
    } catch {
      continue;
    }

    const relPath = path.relative(sourceDir, file);
    let hasLocalhost = false;
    let hasRelativeApi = false;

    // Reset lastIndex for global regexes
    LOCALHOST_RE.lastIndex = 0;
    RELATIVE_API_RE.lastIndex = 0;
    XHR_LOCALHOST_RE.lastIndex = 0;
    JQUERY_AJAX_RE.lastIndex = 0;

    if (LOCALHOST_RE.test(content)) hasLocalhost = true;
    if (XHR_LOCALHOST_RE.test(content)) hasLocalhost = true;
    if (JQUERY_AJAX_RE.test(content)) { hasLocalhost = true; }

    RELATIVE_API_RE.lastIndex = 0;
    if (RELATIVE_API_RE.test(content)) hasRelativeApi = true;

    if (hasLocalhost) localhostFiles.push(relPath);
    if (hasRelativeApi) relativeApiFiles.push(relPath);
  }

  if (localhostFiles.length > 0) {
    warnings.push(
      `Backend connectivity: ${localhostFiles.length} JS file(s) make fetch/XHR calls to ` +
      `localhost (${localhostFiles.slice(0, 3).join(", ")}${localhostFiles.length > 3 ? ", ..." : ""}). ` +
      `These calls will fail in the packaged Electron app — no local server runs inside the app. ` +
      `Consider pointing your API calls to a hosted backend URL or bundling a local server.`
    );
  }

  if (relativeApiFiles.length > 0) {
    warnings.push(
      `Backend connectivity: ${relativeApiFiles.length} JS file(s) make fetch calls to relative ` +
      `'/api/...' paths (${relativeApiFiles.slice(0, 3).join(", ")}${relativeApiFiles.length > 3 ? ", ..." : ""}). ` +
      `In the packaged Electron app, relative paths are served by the static file handler — there is ` +
      `no backend server. These API calls will return 404. ` +
      `Point them to an absolute hosted API URL or bundle an Express server with electron-express.`
    );
  }

  return warnings;
}

function flattenDeps(pkg: Record<string, unknown>): Record<string, string> {
  const d = pkg["dependencies"];
  return typeof d === "object" && d !== null ? (d as Record<string, string>) : {};
}

function flattenDevDeps(pkg: Record<string, unknown>): Record<string, string> {
  const d = pkg["devDependencies"];
  return typeof d === "object" && d !== null ? (d as Record<string, string>) : {};
}

async function hasFrontendFiles(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!["node_modules", ".git", "dist", ".next", "build"].includes(entry.name)) {
          const subHas = await hasFrontendFiles(path.join(dir, entry.name));
          if (subHas) return true;
        }
      } else if (/\.(ts|tsx|js|jsx|css|scss|sass|less|html|vue|svelte)$/i.test(entry.name)) {
        return true;
      }
    }
  } catch {}
  return false;
}

async function scanSourceFiles(sourceDir: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string, recursive: boolean): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true }) as any;
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name as string);
      if (entry.isDirectory()) {
        if (recursive && !["node_modules", ".git", "dist", ".next", "build"].includes(entry.name as string)) {
          await walk(full, true);
        }
      } else if (/\.(ts|tsx|js|jsx|css|scss|sass|less|html|json|svg|png|jpg|jpeg|webp|woff|woff2)$/.test(entry.name as string)) {
        files.push(full);
      }
    }
  }

  const srcDir = path.join(sourceDir, "src");
  const hasPackageJson = await fileExists(path.join(sourceDir, "package.json"));
  let targetDir = sourceDir;
  let scanRootNonRecursively = false;

  if (hasPackageJson && await fileExists(srcDir)) {
    const isFrontendSrc = await hasFrontendFiles(srcDir);
    if (isFrontendSrc) {
      targetDir = srcDir;
      scanRootNonRecursively = true;
    }
  }

  await walk(targetDir, true);

  if (scanRootNonRecursively) {
    // Walk the root directory non-recursively to capture root-level config files and assets
    await walk(sourceDir, false);
  }

  return [...new Set(files)];
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

  // Strategy 2: parse supabase/types.ts — scoped to the Tables block only
  // (avoids picking up internal TS type keys like Row, Functions, Enums, etc.)
  const typesPath = path.join(sourceDir, "src", "integrations", "supabase", "types.ts");
  const altTypesPath = path.join(sourceDir, "supabase", "types.ts");

  for (const tp of [typesPath, altTypesPath]) {
    if (!(await fileExists(tp))) continue;
    const content = await fs.readFile(tp, "utf-8").catch(() => "");

    // Match table names only from inside the Tables: { tableName: { Row: ... } } block
    const tablesBlockRe = /Tables\s*:\s*\{/;
    const startIdx = tablesBlockRe.exec(content)?.index;
    if (startIdx === undefined) continue;

    let depth = 0;
    let i = content.indexOf("{", startIdx + 6); // opening brace of Tables value
    const blockStart = i + 1;
    for (; i < content.length; i++) {
      if (content[i] === "{") depth++;
      else if (content[i] === "}") { depth--; if (depth === 0) break; }
    }
    const tablesBlock = content.slice(blockStart, i);

    // First-level keys only: "table_name": {
    const tableKeyRe = /^\s*["']([\w]+)["']\s*:/gm;
    let m: RegExpExecArray | null;
    while ((m = tableKeyRe.exec(tablesBlock)) !== null) {
      if (m[1] && !["Row", "Insert", "Update", "Relationships"].includes(m[1])) {
        tables.add(m[1]);
      }
    }
  }

  // Strategy 3: scan source files for .from('tableName') / .from("tableName") patterns.
  // This is the critical fallback when neither supabase/migrations nor types.ts exist.
  // Covers Supabase (.from), Firebase (.collection), and generic ORMs.
  if (tables.size === 0) {
    const srcDir = path.join(sourceDir, "src");
    const scanDir = (await fileExists(srcDir)) ? srcDir : sourceDir;

    async function walkForTables(dir: string): Promise<void> {
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
            await walkForTables(full);
          }
        } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name as string)) {
          const content = await fs.readFile(full, "utf-8").catch(() => "");
          // Match: .from('table_name') or .from("table_name") or .collection('name')
          const fromRe = /\.(?:from|collection)\s*\(\s*['"`]([\w]+)['"`]\s*\)/g;
          let m: RegExpExecArray | null;
          while ((m = fromRe.exec(content)) !== null) {
            const name = m[1]!;
            // Skip common non-table names (RPC functions, storage buckets, channels)
            if (!["auth", "storage", "realtime", "functions", "rpc"].includes(name)) {
              tables.add(name);
            }
          }
        }
      }
    }

    await walkForTables(scanDir);
  }

  return [...tables];
}

async function fileExists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true).catch(() => false);
}

// ─── Improvement #3: Per-table column extraction ─────────────────────────────

import type { ColumnDefinition, RlsPolicy } from "../../types/DetectionResult.js";

/**
 * Extracts column definitions per table from Supabase types.ts.
 * Maps TypeScript types to SQLite-compatible column types so
 * Stage 04 can generate proper CREATE TABLE statements.
 */
async function extractTableColumns(
  sourceDir: string
): Promise<Record<string, ColumnDefinition[]>> {
  const result: Record<string, ColumnDefinition[]> = {};

  const candidates = [
    path.join(sourceDir, "src", "integrations", "supabase", "types.ts"),
    path.join(sourceDir, "supabase", "types.ts"),
    path.join(sourceDir, "src", "types", "supabase.ts"),
  ];

  for (const tp of candidates) {
    if (!(await fileExists(tp))) continue;
    const content = await fs.readFile(tp, "utf-8").catch(() => "");
    parseSupabaseTypes(content, result);
    break;
  }

  // Fallback: parse SQL migrations for column defs
  const migrationsDir = path.join(sourceDir, "supabase", "migrations");
  if (await fileExists(migrationsDir)) {
    const files = await fs.readdir(migrationsDir).catch(() => [] as string[]);
    for (const file of files.filter((f) => f.endsWith(".sql"))) {
      const sql = await fs.readFile(path.join(migrationsDir, file), "utf-8").catch(() => "");
      parseSqlMigration(sql, result);
    }
  }

  return result;
}

function parseSqlType(pgType: string): ColumnDefinition["type"] {
  const t = pgType.toLowerCase();
  if (t.includes("int") || t === "serial" || t === "bigserial") return "INTEGER";
  if (t.includes("float") || t.includes("double") || t === "numeric" || t === "decimal") return "REAL";
  if (t === "boolean" || t === "bool") return "BOOLEAN";
  if (t.includes("blob") || t === "bytea") return "BLOB";
  return "TEXT";
}

function parseSqlMigration(sql: string, result: Record<string, ColumnDefinition[]>): void {
  // Match CREATE TABLE blocks
  const tableRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?["']?(\w+)["']?\s*\(([^;]+)\)/gi;
  let tableMatch: RegExpExecArray | null;

  while ((tableMatch = tableRe.exec(sql)) !== null) {
    const tableName = tableMatch[1]!;
    const body = tableMatch[2]!;
    const cols: ColumnDefinition[] = [];

    for (const line of body.split(",")) {
      const colRe = /^\s*["']?(\w+)["']?\s+(\w+(?:\s*\(\d+\))?)/;
      const m = colRe.exec(line.trim());
      if (!m) continue;
      const colName = m[1]!;
      if (["primary", "unique", "constraint", "check", "foreign"].includes(colName.toLowerCase())) continue;

      cols.push({
        name: colName,
        type: parseSqlType(m[2]!),
        nullable: !line.includes("NOT NULL"),
        primaryKey: line.toLowerCase().includes("primary key") || colName === "id",
        defaultValue: undefined,
      });
    }

    if (cols.length > 0 && !result[tableName]) {
      result[tableName] = cols;
    }
  }
}

function parseSupabaseTypes(content: string, result: Record<string, ColumnDefinition[]>): void {
  // Find: Tables: { tableName: { Row: { col: type; ... } } }
  const tableBlockRe = /(?:["'](\w+)["']|(\w+))\s*:\s*\{[^}]*Row:\s*\{([^}]+)\}/g;
  let m: RegExpExecArray | null;

  while ((m = tableBlockRe.exec(content)) !== null) {
    const tableName = (m[1] || m[2])!;
    const rowBlock = m[3]!;
    const cols: ColumnDefinition[] = [];

    for (const line of rowBlock.split("\n")) {
      const colRe = /["']?(\w+)["']?\s*:\s*([^;|]+)/;
      const cm = colRe.exec(line.trim());
      if (!cm) continue;
      const colName = cm[1]!.trim();
      const tsType = cm[2]!.trim().toLowerCase();
      if (!colName || colName === "//") continue;

      let sqlType: ColumnDefinition["type"] = "TEXT";
      if (tsType.includes("number")) sqlType = "REAL";
      if (tsType.includes("boolean")) sqlType = "BOOLEAN";

      cols.push({
        name: colName,
        type: sqlType,
        nullable: tsType.includes("null"),
        primaryKey: colName === "id",
      });
    }

    if (cols.length > 0) result[tableName] = cols;
  }
}

// ─── Improvement #6: Icon auto-detection ─────────────────────────────────────

async function detectIconPath(sourceDir: string): Promise<string | undefined> {
  const candidates = [
    "public/icon.png",
    "public/logo.png",
    "public/favicon.png",
    "src/assets/icon.png",
    "src/assets/logo.png",
    "assets/icon.png",
    "public/favicon.ico",   // .ico works but .png preferred for Electron
  ];
  for (const rel of candidates) {
    if (await fileExists(path.join(sourceDir, rel))) return rel;
  }
  return undefined;
}

// ─── Improvement #11: TypeScript path alias extraction ───────────────────────

async function extractPathAliases(sourceDir: string): Promise<Record<string, string>> {
  const tsconfigCandidates = [
    "tsconfig.json",
    "tsconfig.app.json",
    "tsconfig.base.json",
  ];

  for (const candidate of tsconfigCandidates) {
    const tsconfigPath = path.join(sourceDir, candidate);
    if (!(await fileExists(tsconfigPath))) continue;

    try {
      const raw = await fs.readFile(tsconfigPath, "utf-8");
      // Strip comments from tsconfig (which is valid JSONC but not JSON)
      const stripped = raw.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
      const tsconfig = JSON.parse(stripped);
      const paths: Record<string, string[]> = tsconfig?.compilerOptions?.paths ?? {};

      const aliases: Record<string, string> = {};
      for (const [alias, targets] of Object.entries(paths)) {
        if (!targets[0]) continue;
        // Strip trailing wildcard: "@/*" → "@", "./src/*" → "./src"
        const key = alias.replace(/\/\*$/, "");
        const val = targets[0].replace(/\/\*$/, "");
        aliases[key] = val;
      }
      return aliases;
    } catch {
      // malformed tsconfig — skip
    }
  }

  // If no tsconfig aliases found, infer the common @/ → ./src convention
  if (await fileExists(path.join(sourceDir, "src"))) {
    return { "@": "./src" };
  }
  return {};
}

// ─── Phase 2: RLS Policy Extraction ──────────────────────────────────────────

async function extractRlsPolicies(sourceDir: string): Promise<Record<string, RlsPolicy[]>> {
  const result: Record<string, RlsPolicy[]> = {};
  const migrationsDir = path.join(sourceDir, "supabase", "migrations");

  if (!(await fileExists(migrationsDir))) {
    return result;
  }

  const files = await fs.readdir(migrationsDir).catch(() => [] as string[]);
  for (const file of files.filter((f) => f.endsWith(".sql"))) {
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf-8").catch(() => "");

    // Basic regex to match CREATE POLICY statements
    // Matches: create policy "name" on table_name for action using (expr)
    const policyRe = /create\s+policy\s+["']?([^"']+)["']?\s+on\s+["']?(?:\w+["']?\.["']?)?(\w+)["']?\s+.*?for\s+(select|insert|update|delete|all).*?(?:using|with\s+check)\s*\((.*?)\)/gis;
    
    let match: RegExpExecArray | null;
    while ((match = policyRe.exec(sql)) !== null) {
      const name = match[1]!;
      const table = match[2]!;
      const action = match[3]!.toUpperCase() as RlsPolicy["action"];
      const using = match[4]!.trim();

      // Check if it's an ownership policy: auth.uid() = user_id or user_id = auth.uid()
      const ownerMatch = /(?:auth\.uid\(\)\s*=\s*(\w+))|(?:(\w+)\s*=\s*auth\.uid\(\))/i.exec(using);
      const isOwnerOnly = ownerMatch !== null;
      const ownerColumn = ownerMatch ? (ownerMatch[1] || ownerMatch[2]) : undefined;

      if (!result[table]) {
        result[table] = [];
      }

      result[table]!.push({
        name,
        table,
        action,
        using,
        isOwnerOnly,
        ownerColumn
      });
    }
  }

  return result;
}
