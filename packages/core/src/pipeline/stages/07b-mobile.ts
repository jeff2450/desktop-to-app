import type { PipelineContext } from "../PipelineContext.js";

const STAGE = "07b-mobile";

/**
 * Stage 07b — Mobile (optional)
 *
 * Runs Capacitor builds for android/ios targets when requested.
 * Skipped automatically when no mobile targets are in config.targets.
 *
 * Prerequisites:
 *  Android — Java JDK 17+, Android Studio, ANDROID_HOME set in env
 *  iOS     — macOS only, Xcode + CocoaPods installed
 *
 * The @webtoapp/mobile package is dynamically imported so that its
 * Capacitor/execa deps are never loaded for desktop-only conversions.
 */
export async function runMobileStage(ctx: PipelineContext): Promise<void> {
  const mobileTargets = ctx.config.targets.filter(
    (t) => t === "android" || t === "ios"
  ) as Array<"android" | "ios">;

  if (mobileTargets.length === 0) {
    ctx.skipStage(STAGE, "No mobile targets requested");
    return;
  }

  ctx.startStage(STAGE);

  try {
    if (ctx.dryRun) {
      for (const t of mobileTargets) {
        ctx.log("info", `[DRY-RUN] Would build ${t} with Capacitor`, STAGE);
      }
      ctx.completeStage(STAGE);
      return;
    }

    // Dynamically import @webtoapp/mobile to avoid loading Capacitor deps
    // when only desktop targets are requested.
    const { buildAndroid, buildIos } = await import("@webtoapp/mobile");

    const mobileConfig = {
      appId:   ctx.config.appId,
      appName: ctx.config.name,
      webDir:  "dist",
      ...(ctx.config.mobile ?? {}),
      android: ctx.config.mobile?.android,
      ios:     ctx.config.mobile?.ios,
    };

    const log = (msg: string) => ctx.log("info", msg, STAGE);

    for (const target of mobileTargets) {
      if (target === "android") {
        ctx.log("info", "Building Android APK via Capacitor...", STAGE);
        const result = await buildAndroid(ctx.outputDir, mobileConfig, log);

        for (const w of result.warnings) {
          ctx.log("warn", w, STAGE);
        }

        if (!result.success) {
          throw new Error(`Android build failed: ${result.error}`);
        }

        if (result.outputPath) {
          ctx.log("info", `Android APK: ${result.outputPath}`, STAGE);
        }
      }

      if (target === "ios") {
        if (process.platform !== "darwin") {
          ctx.log(
            "warn",
            "iOS build skipped — iOS requires macOS with Xcode. " +
            "Use a macOS GitHub Actions runner (macos-latest) to build iOS in CI.",
            STAGE
          );
          continue;
        }

        ctx.log("info", "Building iOS app via Capacitor...", STAGE);
        const result = await buildIos(ctx.outputDir, mobileConfig, log);

        for (const w of result.warnings) {
          ctx.log("warn", w, STAGE);
        }

        if (!result.success) {
          // iOS failure is non-fatal when Android already succeeded
          if (mobileTargets.includes("android")) {
            ctx.log(
              "warn",
              `iOS build failed (non-fatal): ${result.error} — ` +
              "iOS builds require macOS + Xcode. Desktop build still succeeded.",
              STAGE
            );
          } else {
            throw new Error(`iOS build failed: ${result.error}`);
          }
        }
      }
    }

    ctx.completeStage(STAGE);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    ctx.failStage(STAGE, error);
    throw error;
  }
}
