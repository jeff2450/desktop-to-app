import path from "node:path";
import fs from "node:fs/promises";

import type { PipelineContext } from "../PipelineContext.js";
import { assertValidConfig } from "../../config/validateConfig.js";

const STAGE = "00-preflight";

/**
 * Stage 00 — Pre-flight Validation
 *
 * Runs BEFORE any file is touched. Validates the source project structure
 * and configuration so the pipeline fails fast with clear, actionable messages
 * instead of cryptic errors deep inside later stages.
 *
 * Checks performed:
 *  ✓ source directory exists and is readable
 *  ✓ package.json is present and valid JSON
 *  ✓ index.html is present (Vite entry point)
 *  ✓ src/ directory exists
 *  ✓ a Vite config file exists (vite.config.ts/js)
 *  ✓ config.name / config.appId are non-empty
 *  ✓ config.targets is a non-empty array
 *  ⚠  Next.js projects warned (not blocked — online mode still works)
 *  ⚠  If project has no recognisable framework
 */
export async function runPreflightStage(ctx: PipelineContext): Promise<void> {
  ctx.startStage(STAGE);

  // ── Config schema validation (fail-fast before touching anything) ──
  try {
    assertValidConfig(ctx.config);
    ctx.log("info", "✅ Config schema valid", STAGE);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    ctx.failStage(STAGE, error);
    throw error;
  }

  const failures: string[] = [];
  const warnings: string[] = [];

  const isUrl = ctx.sourceDir.startsWith("http://") || ctx.sourceDir.startsWith("https://");
  let isStaticPlain = false;
  let pkg: Record<string, unknown> = {};

  if (isUrl) {
    try {
      new URL(ctx.sourceDir);
    } catch {
      failures.push(`Invalid source URL: ${ctx.sourceDir}`);
      bail(ctx, failures);
      return;
    }
  } else {
    const srcExists = await isDir(ctx.sourceDir);
    if (!srcExists) {
      failures.push(`Source directory does not exist: ${ctx.sourceDir}`);
      bail(ctx, failures);
      return;
    }

    const hasIndexHtml = await fileExists(path.join(ctx.sourceDir, "index.html"));
    const hasPkgJson = await fileExists(path.join(ctx.sourceDir, "package.json"));

    if (hasIndexHtml && !hasPkgJson) {
      isStaticPlain = true;
      ctx.log("info", "Static plain HTML/CSS/JS site detected (no package.json).", STAGE);
    } else {
      // ── package.json ────────────────────────────────────────────────
      const pkgPath = path.join(ctx.sourceDir, "package.json");
      try {
        const raw = await fs.readFile(pkgPath, "utf-8");
        pkg = JSON.parse(raw);
      } catch {
        failures.push("No valid package.json found in source directory. Is this a Node.js project?");
      }

      // ── index.html ──────────────────────────────────────────────────
      if (!hasIndexHtml) {
        failures.push(
          "index.html not found in source root. " +
          "Vite expects an index.html at the project root — is this a Vite project?"
        );
      }

      // ── src/ directory ──────────────────────────────────────────────
      if (!(await isDir(path.join(ctx.sourceDir, "src")))) {
        failures.push("No src/ directory found — detection and transformation require a standard src folder.");
      }

      // ── Vite config ─────────────────────────────────────────────────
      const viteConfigs = [
        "vite.config.ts", "vite.config.js", "vite.config.mts", "vite.config.mjs",
      ];
      const hasViteConfig = (
        await Promise.all(viteConfigs.map((f) => fileExists(path.join(ctx.sourceDir, f))))
      ).some(Boolean);

      if (!hasViteConfig) {
        const allDeps = {
          ...(pkg["dependencies"] as Record<string, string> ?? {}),
          ...(pkg["devDependencies"] as Record<string, string> ?? {}),
        };
        if (!("vite" in allDeps)) {
          failures.push(
            "No vite.config file found and vite is not a dependency. " +
            "WebToApp requires a Vite project."
          );
        }
      }
    }
  }

  // ── Next.js warning ─────────────────────────────────────────────
  const allDeps2 = {
    ...(pkg["dependencies"] as Record<string, string> ?? {}),
    ...(pkg["devDependencies"] as Record<string, string> ?? {}),
  };
  if ("next" in allDeps2) {
    warnings.push(
      "Next.js project detected. Full SSR/RSC support is not available in Electron. " +
      "Consider using 'online' mode to wrap the app as-is, or migrating to Vite first."
    );
  }

  // ── Config fields ───────────────────────────────────────────────
  if (!ctx.config.name || ctx.config.name.trim() === "") {
    failures.push("config.name is required but is empty. Set it in webtoapp.config.json.");
  }

  if (!ctx.config.appId || !ctx.config.appId.includes(".")) {
    failures.push(
      `config.appId must be a reverse-domain identifier (e.g. 'com.acme.myapp'). ` +
      `Got: '${ctx.config.appId ?? ""}'`
    );
  }

  if (!ctx.config.targets || ctx.config.targets.length === 0) {
    failures.push("config.targets is empty — specify at least one platform: windows, linux, or mac.");
  }

  // ── Cross-platform build warning ────────────────────────────────
  // electron-builder cannot cross-compile desktop targets without the native
  // OS toolchain (e.g. mksquashfs for Linux AppImage, Xcode for macOS .dmg).
  // Warn early so the user knows which targets will actually be built.
  if (ctx.config.targets && ctx.config.targets.length > 0) {
    const currentPlatform =
      process.platform === "win32" ? "windows" :
      process.platform === "darwin" ? "mac" : "linux";

    const desktopTargets = ctx.config.targets.filter(
      (t) => t === "windows" || t === "linux" || t === "mac"
    );
    const crossTargets = desktopTargets.filter((t) => t !== currentPlatform);

    if (crossTargets.length > 0) {
      warnings.push(
        `Cross-platform targets requested: ${crossTargets.join(", ")}. ` +
        `On this ${currentPlatform} machine, only the ${currentPlatform} installer will be built. ` +
        `To build ${crossTargets.join("/")} installers, run on the target OS or use a CI matrix ` +
        `(see .github/workflows/publish-cli.yml for an example).`
      );
    }
  }

  // ── Mobile config checks ────────────────────────────────────────
  await validateMobilePreflight(ctx, failures, warnings);

  // ── Dry-run notice ──────────────────────────────────────────────
  if ((ctx.config as any).dryRun) {
    ctx.log("info", "🔍 DRY-RUN MODE — no files will be written or installed", STAGE);
  }

  // ── Report ──────────────────────────────────────────────────────
  for (const w of warnings) ctx.log("warn", `⚠  ${w}`, STAGE);

  if (failures.length > 0) {
    bail(ctx, failures);
    return;
  }

  ctx.log("info", "✅ Pre-flight checks passed", STAGE);
  ctx.completeStage(STAGE);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function bail(ctx: PipelineContext, failures: string[]): void {
  const msg = [
    "Pre-flight validation failed:",
    ...failures.map((f) => `  ✗ ${f}`),
    "",
    "Fix the issues above and re-run the conversion.",
  ].join("\n");

  const err = new Error(msg);
  ctx.failStage(STAGE, err);
  throw err;
}

async function fileExists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true).catch(() => false);
}

async function isDir(p: string): Promise<boolean> {
  return fs.stat(p).then((s) => s.isDirectory()).catch(() => false);
}

async function validateMobilePreflight(
  ctx: PipelineContext,
  failures: string[],
  warnings: string[]
): Promise<void> {
  if (!ctx.config.targets?.includes("android")) return;

  const android = ctx.config.mobile?.android;
  if (!android || android.buildVariant !== "release") return;

  const missing = [
    ["mobile.android.keystorePath", android.keystorePath],
    ["mobile.android.keystoreAlias", android.keystoreAlias],
    ["mobile.android.keystorePassword", android.keystorePassword],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    failures.push(
      `Android release builds require signing config before Gradle runs. Missing: ${missing.join(", ")}. ` +
      `Use mobile.android.buildVariant "debug" for an unsigned test APK.`
    );
  }

  if (android.keystorePath) {
    const keystorePath = path.isAbsolute(android.keystorePath)
      ? android.keystorePath
      : path.resolve(ctx.sourceDir, android.keystorePath);

    if (!(await fileExists(keystorePath))) {
      failures.push(`Android release keystore not found: ${keystorePath}`);
    }
  }

  const targetSdkVersion = android.targetSdkVersion ?? 35;
  if (targetSdkVersion < 35) {
    failures.push(
      `Android release targetSdkVersion must be 35 or higher for Google Play submissions. ` +
      `Got: ${targetSdkVersion}.`
    );
  }

  if (android.artifactType === "apk") {
    warnings.push(
      `Android release artifactType is "apk". Google Play submissions should use "aab"; ` +
      `APK is best reserved for side-loading or internal testing.`
    );
  }
}
