import path from "node:path";
import fs from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";

import type { PipelineContext } from "../PipelineContext.js";

const execAsync = promisify(exec);
const STAGE = "05-install";

function cmd(command: string): string {
  return process.platform === "win32" ? `cmd /c ${command}` : command;
}

/**
 * Stage 05 — Install
 *
 * Writes the final package.json into the output project
 * (merging original deps with WebToApp additions/removals from the plan),
 * then runs npm install to pull all dependencies.
 */
export async function runInstallStage(ctx: PipelineContext): Promise<void> {
  ctx.startStage(STAGE);

  if (!ctx.plan) {
    const err = new Error("Migration plan missing — stage 02 must run first");
    ctx.failStage(STAGE, err);
    throw err;
  }

  try {
    // ── Build output package.json ──────────────────────────────────
    await writeOutputPackageJson(ctx);

    // ── Run npm install ────────────────────────────────────────────
    if (ctx.dryRun) {
      ctx.log("info", "[DRY-RUN] Would run npm install", STAGE);
      ctx.completeStage(STAGE);
      return;
    }

    ctx.log("info", "Running npm install in output project...", STAGE);

    // Use --legacy-peer-deps to handle peer dependency conflicts in the
    // source project (common with date-fns, react versions, etc.)
    const { stdout, stderr } = await execAsync(
      cmd("npm install --legacy-peer-deps --ignore-scripts"),
      {
        cwd: ctx.outputDir,
        env: { ...process.env, NODE_ENV: "development" },
      }
    );

    if (stdout) {
      stdout.split("\n").filter(Boolean).forEach((l) =>
        ctx.log("debug", l, STAGE)
      );
    }
    if (stderr) {
      stderr.split("\n").filter(Boolean).forEach((l) =>
        ctx.log("warn", l, STAGE)
      );
    }

    ctx.log("info", "npm install complete", STAGE);

    // ── Auto-fix non-breaking vulnerabilities in production deps ──
    // Runs npm audit fix with --omit=dev so only runtime deps are patched,
    // and without --force so breaking changes are never applied automatically.
    // Failure here is non-fatal — we warn and continue.
    try {
      ctx.log("info", "Running npm audit fix (production deps only)...", STAGE);
      const auditResult = await execAsync(
        cmd("npm audit fix --omit=dev"),
        {
          cwd: ctx.outputDir,
          env: { ...process.env, NODE_ENV: "development" },
        }
      );
      if (auditResult.stdout) {
        auditResult.stdout.split("\n").filter(Boolean).forEach((l) =>
          ctx.log("debug", l, STAGE)
        );
      }
      ctx.log("info", "npm audit fix complete", STAGE);
    } catch {
      ctx.log(
        "warn",
        "npm audit fix reported issues — run `npm audit` in the output project to review. Continuing...",
        STAGE
      );
    }

    ctx.completeStage(STAGE);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    ctx.failStage(STAGE, error);
    throw error;
  }
}

async function writeOutputPackageJson(ctx: PipelineContext): Promise<void> {
  const sourcePkgPath = path.join(ctx.sourceDir, "package.json");
  const outputPkgPath = path.join(ctx.outputDir, "package.json");

  // Read source package.json
  let sourcePkg: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(sourcePkgPath, "utf-8");
    sourcePkg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    ctx.log("warn", "Source package.json not found — creating minimal one", STAGE);
  }

  const plan = ctx.plan!;

  // Merge dependencies
  const deps = {
    ...((sourcePkg["dependencies"] as Record<string, string>) ?? {}),
    ...plan.dependenciesToAdd,
  };

  // Remove cloud deps
  for (const dep of plan.dependenciesToRemove) {
    delete deps[dep];
  }

  // ── Error #2 Fix: electron MUST be in devDependencies ─────────
  // electron-builder will error if electron is listed as a runtime dependency.
  const electronDevOnly = [
    "electron",
    "electron-builder",
    "electron-rebuild",
    "@electron/rebuild",
    "vite",
    "@vitejs/plugin-react",
    "@vitejs/plugin-vue",
    "@sveltejs/vite-plugin-svelte",
    "concurrently",
    "wait-on",
  ];
  const extractedDevFromDeps: Record<string, string> = {};
  for (const pkg_name of electronDevOnly) {
    if (deps[pkg_name]) {
      extractedDevFromDeps[pkg_name] = deps[pkg_name];
      delete deps[pkg_name];
      ctx.log("info", `Moved ${pkg_name} from dependencies → devDependencies`, STAGE);
    }
  }

  // ── Error #4 Fix: vite-plugin-pwa is web-only (safety net) ────
  const pwaPackages = ["vite-plugin-pwa", "@vite-pwa/assets-generator", "workbox-window", "workbox-precaching"];
  for (const p of pwaPackages) {
    if (deps[p]) {
      delete deps[p];
      ctx.log("info", `Removed web-only dep: ${p}`, STAGE);
    }
  }

  // ── Error #7 Fix: date-fns v4 is incompatible with react-day-picker v8 ──
  // react-day-picker v8 declares a peer dependency on date-fns v2 or v3.
  // If the source project has date-fns v4, npm install will fail unless we
  // downgrade it to the latest compatible v3 release.
  const dayPickerVersion = deps["react-day-picker"] as string | undefined;
  const dateFnsVersion = deps["date-fns"] as string | undefined;
  if (
    (dayPickerVersion?.startsWith("^8") || dayPickerVersion?.startsWith("8")) &&
    dateFnsVersion && (dateFnsVersion.startsWith("^4") || dateFnsVersion.startsWith("4"))
  ) {
    deps["date-fns"] = "^3.6.0";
    ctx.log(
      "info",
      `Downgraded date-fns ${dateFnsVersion} → ^3.6.0 (react-day-picker@8 peer requirement)`,
      STAGE
    );
  }

  // Keep ALL original devDeps (includes vite, @vitejs/plugin-react, typescript etc.)
  // and add electron build tools on top
  const devDeps: Record<string, string> = {
    ...((sourcePkg["devDependencies"] as Record<string, string>) ?? {}),
    ...extractedDevFromDeps,
    "electron-builder": "^24.13.0",
    "@electron/rebuild": "^3.6.0",
    concurrently: "^8.2.0",
    "wait-on": "^7.2.0",
  };

  // Also strip PWA packages from devDeps
  for (const p of pwaPackages) {
    delete (devDeps as Record<string, string>)[p];
  }

  // ── Sentry crash reporting ────────────────────────────────────────────────
  // Auto-inject @sentry/electron when a DSN is configured (config file or env vars).
  // Previously done in Stage 04's patchPackageJson; consolidated here to avoid
  // double-patching conflicts.
  const sentryDsn = (ctx.config as { crashReporting?: { dsn?: string } }).crashReporting?.dsn
    ?? process.env["SENTRY_DSN"]
    ?? process.env["VITE_SENTRY_DSN"];
  if (sentryDsn) {
    deps["@sentry/electron"] ??= "^5.0.0";
    ctx.log("info", "Added @sentry/electron dependency (Sentry DSN detected)", STAGE);
  }

  // Merge scripts
  const scripts = {
    build: "vite build",
    ...((sourcePkg["scripts"] as Record<string, string>) ?? {}),
    ...plan.scriptsToInject,
  };

  const outputPkg = {
    ...sourcePkg,
    name: ctx.config.name.toLowerCase().replace(/\s+/g, "-"),
    version: ctx.config.version,
    description: `${ctx.config.name} — desktop app`,
    author: (sourcePkg["author"] as string | undefined) ?? (ctx.config as any).author ?? "WebToApp Conversion",
    main: "electron/main.cjs",
    scripts,
    dependencies: deps,
    devDependencies: devDeps,
    // Remove fields that don't make sense in the desktop app
    private: true,
  };

  await fs.writeFile(outputPkgPath, JSON.stringify(outputPkg, null, 2) + "\n", "utf-8");
  ctx.log("info", "Wrote output package.json", STAGE);
}
