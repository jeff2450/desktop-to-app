import path from "node:path";
import fs from "node:fs/promises";

import type { PipelineContext } from "../PipelineContext.js";
import type {
  MigrationPlan,
  FileTransformPlan,
  FileGeneratePlan,
} from "../../types/MigrationPlan.js";
import type { DetectionResult } from "../../types/DetectionResult.js";

const STAGE = "02-plan";

/**
 * Stage 02 — Plan
 *
 * Reads the DetectionResult and the user's chosen mode to produce a MigrationPlan.
 *
 * Mode behaviour:
 *  "offline" — transform ALL cloud SDK files → local API. Generate SQLite backend.
 *  "online"  — copy ALL files verbatim. Skip transformation entirely.
 *              Just wrap in Electron — cloud backend stays untouched.
 *  "hybrid"  — transform cloud SDK files → local API AND generate a sync engine
 *              that pushes local SQLite changes back to the cloud when online.
 */
export async function runPlanStage(ctx: PipelineContext): Promise<void> {
  ctx.startStage(STAGE);

  if (!ctx.detection) {
    const err = new Error("Detection result missing — stage 01 must run first");
    ctx.failStage(STAGE, err);
    throw err;
  }

  const mode = ctx.config.mode ?? "offline";
  ctx.log("info", `Conversion mode: ${mode}`, STAGE);

  try {
    const plan = await buildMigrationPlan(ctx, mode);
    ctx.plan = plan;

    ctx.log("info", `Files to transform: ${plan.filesToTransform.length}`, STAGE);
    ctx.log("info", `Files to copy:      ${plan.filesToCopy.length}`, STAGE);
    ctx.log("info", `Files to generate:  ${plan.filesToGenerate.length}`, STAGE);
    ctx.log("info", `Deps to add:        ${Object.keys(plan.dependenciesToAdd).join(", ")}`, STAGE);
    ctx.log("info", `Deps to remove:     ${plan.dependenciesToRemove.join(", ") || "none"}`, STAGE);
    ctx.log("info", plan.summary, STAGE);

    ctx.completeStage(STAGE);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    ctx.failStage(STAGE, error);
    throw error;
  }
}

// ─── Plan builder ─────────────────────────────────────────────────────────────

async function buildMigrationPlan(
  ctx: PipelineContext,
  mode: "offline" | "online" | "hybrid"
): Promise<MigrationPlan> {
  const detection = ctx.detection!;
  const { backend, auth, tables, framework } = detection;

  const filesToTransform: FileTransformPlan[] = [];
  const filesToCopy: string[] = [];
  const filesToGenerate: FileGeneratePlan[] = [];
  const dependenciesToAdd: Record<string, string> = {};
  const dependenciesToRemove: string[] = [];

  // ── ONLINE MODE: copy everything verbatim, just wrap in Electron ──
  if (mode === "online") {
    for (const filePath of detection.scannedFiles) {
      filesToCopy.push(ctx.relative(filePath));
    }

    // Only add Electron — keep all cloud deps, don't touch any source files
    Object.assign(dependenciesToAdd, {
      electron: "31.0.0",
      "electron-updater": "^6.1.0",
    });

    filesToGenerate.push(
      {
        outputPath: "electron/main.cjs",
        generatorType: "electron-main",
        templateVars: {
          appName: ctx.config.name,
          devPort: detection.bundler === "vite" ? 5173 : 3000,
          backendPort: 0, // no local backend in online mode
          onlineMode: true,
        },
      },
      {
        outputPath: "electron/preload.cjs",
        generatorType: "electron-preload",
        templateVars: {},
      },
      {
        outputPath: "electron-builder.yml",
        generatorType: "electron-builder-config",
        templateVars: {
          appId: ctx.config.appId,
          appName: ctx.config.name,
          version: ctx.config.version,
          targets: ctx.config.targets,
          icon: ctx.config.icon ?? "assets/icon.png",
        },
      }
    );

    return {
      filesToTransform: [],
      filesToCopy,
      filesToDelete: [],
      filesToGenerate,
      dependenciesToAdd,
      dependenciesToRemove: [],
      scriptsToInject: {
        "electron:dev": "concurrently \"vite\" \"wait-on tcp:5173 && electron .\"",
        "electron:build": "vite build && electron-builder",
      },
      summary: "Online mode — Electron wrapper only. Cloud backend (Supabase/Firebase) kept as-is. Internet required.",
    };
  }

  // ── OFFLINE + HYBRID: scan and plan transformations ───────────────

  for (const filePath of detection.scannedFiles) {
    const rel = ctx.relative(filePath);
    const plan = await planFile(filePath, rel, detection, ctx);
    if (plan.type === "transform") {
      filesToTransform.push(plan.transform);
    } else {
      filesToCopy.push(rel);
    }
  }

  // ── Deps to remove (offline + hybrid both strip cloud SDKs) ───────
  if (backend === "supabase") {
    dependenciesToRemove.push("@supabase/supabase-js", "@supabase/ssr");
  } else if (backend === "firebase") {
    dependenciesToRemove.push("firebase", "@firebase/app");
  }
  if (auth === "clerk") {
    dependenciesToRemove.push("@clerk/clerk-react", "@clerk/nextjs");
  } else if (auth === "auth0") {
    dependenciesToRemove.push("@auth0/auth0-react");
  }

  // ── Deps to add ────────────────────────────────────────────────────
  Object.assign(dependenciesToAdd, {
    electron: "31.0.0",
    "better-sqlite3": "^11.0.0",
    express: "^4.19.0",
    cors: "^2.8.5",
    bcryptjs: "^2.4.3",
    jsonwebtoken: "^9.0.0",
    "electron-updater": "^6.1.0",
  });

  // Hybrid mode additionally needs the original cloud SDK for syncing
  if (mode === "hybrid") {
    if (backend === "supabase") {
      // Keep supabase for sync — don't remove it, override the removal above
      const idx = dependenciesToRemove.indexOf("@supabase/supabase-js");
      if (idx !== -1) dependenciesToRemove.splice(idx, 1);
      Object.assign(dependenciesToAdd, {
        "@supabase/supabase-js": "^2.43.0",
      });
    } else if (backend === "firebase") {
      const idx = dependenciesToRemove.indexOf("firebase");
      if (idx !== -1) dependenciesToRemove.splice(idx, 1);
      Object.assign(dependenciesToAdd, { firebase: "^10.12.0" });
    }
  }

  // ── Generate: Electron main ────────────────────────────────────────
  filesToGenerate.push(
    {
      outputPath: "electron/main.cjs",
      generatorType: "electron-main",
      templateVars: {
        appName: ctx.config.name,
        devPort: detection.bundler === "vite" ? 5173 : 3000,
        backendPort: ctx.config.backend.port ?? 3001,
        onlineMode: false,
      },
    },
    {
      outputPath: "electron/preload.cjs",
      generatorType: "electron-preload",
      templateVars: {},
    },
    {
      outputPath: "electron-builder.yml",
      generatorType: "electron-builder-config",
      templateVars: {
        appId: ctx.config.appId,
        appName: ctx.config.name,
        version: ctx.config.version,
        targets: ctx.config.targets,
        icon: ctx.config.icon ?? "assets/icon.png",
      },
    }
  );

  // ── Generate: Local backend ────────────────────────────────────────
  if (ctx.config.backend.type !== "none") {
    filesToGenerate.push(
      {
        outputPath: "backend/server.cjs",
        generatorType: "express-server",
        templateVars: { port: ctx.config.backend.port ?? 3001, tables, appName: ctx.config.name },
      },
      {
        outputPath: "backend/database.cjs",
        generatorType: "sqlite-database",
        templateVars: { tables },
      }
    );

    if (ctx.config.auth.type === "local") {
      filesToGenerate.push({
        outputPath: "backend/auth.cjs",
        generatorType: "jwt-auth",
        templateVars: { defaultAdmin: ctx.config.auth.defaultAdmin ?? "admin@app.local" },
      });
    }

    for (const table of tables) {
      const policies = ctx.detection?.rlsPolicies?.[table];
      filesToGenerate.push({
        outputPath: `backend/routes/${table}.cjs`,
        generatorType: "crud-routes",
        templateVars: { table, policies },
      });
    }

    filesToGenerate.push({
      outputPath: "src/lib/localApi.ts",
      generatorType: "local-api-client",
      templateVars: { port: ctx.config.backend.port ?? 3001, tables, framework },
    });
  }

  // ── Generate: Hybrid sync engine ───────────────────────────────────
  if (mode === "hybrid") {
    filesToGenerate.push({
      outputPath: "src/lib/syncEngine.ts",
      generatorType: "sync-engine",
      templateVars: {
        backend,
        tables,
        port: ctx.config.backend.port ?? 3001,
      },
    });

    filesToGenerate.push({
      outputPath: "src/hooks/useOnlineStatus.ts",
      generatorType: "online-status-hook",
      templateVars: {},
    });
  }

  // ── npm scripts ────────────────────────────────────────────────────
  const scriptsToInject: Record<string, string> = {
    "electron:dev": "concurrently \"vite\" \"wait-on tcp:5173 && electron .\"",
    "electron:build": "vite build && electron-builder",
    "backend:start": "node backend/server.cjs",
  };

  const aiTransforms = filesToTransform.filter((f) => f.transformerType === "ai");
  const modeLabel =
    mode === "hybrid"
      ? "Hybrid mode — local SQLite + cloud sync when online"
      : "Offline mode — fully local SQLite, no internet required";

  const summary =
    `${modeLabel}. ${filesToTransform.length} files transformed ` +
    `(${aiTransforms.length} via AI fallback), ` +
    `${filesToGenerate.length} files generated, ` +
    `${tables.length} tables detected.`;

  return {
    filesToTransform,
    filesToCopy,
    filesToDelete: [],
    filesToGenerate,
    dependenciesToAdd,
    dependenciesToRemove,
    scriptsToInject,
    summary,
  };
}

// ─── Per-file planner ─────────────────────────────────────────────────────────

type FilePlan =
  | { type: "transform"; transform: FileTransformPlan }
  | { type: "copy" };

async function planFile(
  absolutePath: string,
  relativePath: string,
  detection: DetectionResult,
  ctx: PipelineContext
): Promise<FilePlan> {
  let content: string;
  try {
    content = await fs.readFile(absolutePath, "utf-8");
  } catch {
    return { type: "copy" };
  }

  const { backend, auth, confidence } = ctx.detection!;

  if (backend === "supabase") {
    if (content.includes("@supabase/supabase-js") || content.includes("supabase.from(")) {
      const hasRealtime = content.includes(".channel(") || content.includes("on(");
      const hasStorage  = content.includes("storage.from(");
      const hasAuth     = content.includes("supabase.auth.");

      let transformerType: FileTransformPlan["transformerType"] = "supabase-query";
      if (hasRealtime)                                     transformerType = "supabase-realtime";
      else if (hasStorage)                                 transformerType = "supabase-storage";
      else if (hasAuth && !content.includes("supabase.from(")) transformerType = "supabase-auth";

      const fileConfidence = scoreFileComplexity(content, confidence);

      return {
        type: "transform",
        transform: {
          sourcePath: relativePath,
          outputPath: relativePath,
          transformerType: fileConfidence < 0.8 ? "ai" : transformerType,
          confidence: fileConfidence,
          reason: `Contains Supabase ${transformerType.replace("supabase-", "")} calls`,
        },
      };
    }
  }

  if (backend === "firebase") {
    if (content.includes("firebase/app") || content.includes("getFirestore")) {
      const hasAuth = content.includes("firebase/auth") || content.includes("signInWithEmailAndPassword");
      return {
        type: "transform",
        transform: {
          sourcePath: relativePath,
          outputPath: relativePath,
          transformerType: hasAuth ? "firebase-auth" : "firebase-firestore",
          confidence: 0.75,
          reason: `Contains Firebase ${hasAuth ? "auth" : "Firestore"} calls`,
        },
      };
    }
  }

  if (auth === "clerk") {
    if (content.includes("@clerk/") || content.includes("useUser") || content.includes("useAuth")) {
      return {
        type: "transform",
        transform: {
          sourcePath: relativePath,
          outputPath: relativePath,
          transformerType: "clerk-auth",
          confidence: 0.8,
          reason: "Contains Clerk auth hooks/components",
        },
      };
    }
  }

  return { type: "copy" };
}

function scoreFileComplexity(content: string, baseConfidence: number): number {
  const complexPatterns = [/\.rpc\(/g, /\.filter\(/g, /\.or\(/g, /\.contains\(/g, /upsert\(/g];
  const matchCount = complexPatterns.reduce((n, re) => n + (content.match(re)?.length ?? 0), 0);
  return Math.max(baseConfidence - Math.min(matchCount * 0.05, 0.3), 0.4);
}
