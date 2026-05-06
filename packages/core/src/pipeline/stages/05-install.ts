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

  // Keep ALL original devDeps (includes vite, @vitejs/plugin-react, typescript etc.)
  // and add electron build tools on top
  const devDeps = {
    ...((sourcePkg["devDependencies"] as Record<string, string>) ?? {}),
    "electron-builder": "^24.13.0",
    "@electron/rebuild": "^3.6.0",
    concurrently: "^8.2.0",
    "wait-on": "^7.2.0",
  };

  // Merge scripts
  const scripts = {
    ...((sourcePkg["scripts"] as Record<string, string>) ?? {}),
    ...plan.scriptsToInject,
  };

  const outputPkg = {
    ...sourcePkg,
    name: ctx.config.name.toLowerCase().replace(/\s+/g, "-"),
    version: ctx.config.version,
    description: `${ctx.config.name} — desktop app`,
    main: "electron/main.js",
    scripts,
    dependencies: deps,
    devDependencies: devDeps,
    // Remove fields that don't make sense in the desktop app
    private: true,
  };

  await fs.writeFile(outputPkgPath, JSON.stringify(outputPkg, null, 2) + "\n", "utf-8");
  ctx.log("info", "Wrote output package.json", STAGE);
}