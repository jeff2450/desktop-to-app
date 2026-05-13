import path from "node:path";
import fs from "node:fs/promises";

import type { PipelineContext } from "../PipelineContext.js";
import { ElectronPackager } from "@webtoapp/builder";
import { NativeDepsBuilder } from "@webtoapp/builder";

const STAGE = "07-package";

/**
 * Stage 07 — Package
 *
 * The final stage. Rebuilds native modules (better-sqlite3) against
 * the target Electron version, then runs electron-builder to produce
 * the platform installer(s) (.exe / .AppImage / .dmg).
 *
 * Sets ctx.installerPath on success so the pipeline result includes it.
 */
export async function runPackageStage(ctx: PipelineContext): Promise<void> {
  ctx.startStage(STAGE);

  try {
    const log = (line: string) => ctx.log("info", line, STAGE);

    if (ctx.dryRun) {
      ctx.log("info", "[DRY-RUN] Would rebuild native modules and package the desktop app", STAGE);
      ctx.completeStage(STAGE);
      return;
    }

    // ── Step 1: Rebuild native Node modules for Electron ──────────
    ctx.log("info", "Rebuilding native modules for Electron...", STAGE);

    const electronVersion = await resolveElectronVersion(ctx.outputDir);
    ctx.log("info", `Electron version: ${electronVersion}`, STAGE);

    const nativeBuilder = new NativeDepsBuilder();
    const nativeResult = await nativeBuilder.build({
      projectDir: ctx.outputDir,
      electronVersion,
      platform:
        process.platform === "win32"
          ? "win32"
          : process.platform === "darwin"
          ? "darwin"
          : "linux",
      arch: (process.arch === "arm64" ? "arm64" : "x64") as "x64" | "arm64",
      onLog: log,
    });

    if (!nativeResult.success) {
      ctx.log(
        "warn",
        `Native module rebuild had issues: ${nativeResult.error ?? "unknown"}. Continuing...`,
        STAGE
      );
    }

    // ── Step 2: Run electron-builder ──────────────────────────────
    ctx.log("info", "Packaging with electron-builder...", STAGE);

    // Filter out mobile targets — those are handled by stage 07b-mobile
    const desktopTargets = ctx.config.targets.filter(
      (t): t is "windows" | "linux" | "mac" =>
        t === "windows" || t === "linux" || t === "mac"
    );

    const packager = new ElectronPackager();
    const packResult = await packager.package({
      projectDir: ctx.outputDir,
      targets: desktopTargets,
      outputDir: path.join(ctx.outputDir, "release"),
      appName: ctx.config.name,
      version: ctx.config.version,
      onLog: log,
    });

    if (!packResult.success) {
      throw new Error(`electron-builder failed: ${packResult.error}`);
    }

    // ── Step 3: Store installer path ──────────────────────────────
    if (packResult.installerPaths.length > 0) {
      // Primary installer = first result (Windows .exe or Linux .AppImage or macOS .dmg)
      ctx.installerPath = packResult.installerPaths[0];
      ctx.log("info", `Installer ready: ${ctx.installerPath}`, STAGE);
    }

    ctx.completeStage(STAGE);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    ctx.failStage(STAGE, error);
    throw error;
  }
}

/**
 * Read the installed electron version from node_modules.
 */
async function resolveElectronVersion(projectDir: string): Promise<string> {
  try {
    const electronPkgPath = path.join(
      projectDir,
      "node_modules",
      "electron",
      "package.json"
    );
    const raw = await fs.readFile(electronPkgPath, "utf-8");
    const pkg = JSON.parse(raw) as { version: string };
    return pkg.version;
  } catch {
    return "31.0.0"; // fallback
  }
}
