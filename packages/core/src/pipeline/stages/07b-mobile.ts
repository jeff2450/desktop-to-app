import type { PipelineContext } from "../PipelineContext.js";

const STAGE = "07b-mobile";

/**
 * Stage 07b — Mobile (optional)
 * Runs Capacitor builds for android/ios targets.
 * Skipped automatically when no mobile targets are requested.
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
    // Dynamically import to avoid loading Capacitor deps when not needed
    const { CapacitorBuilder } = await import("@webtoapp/builder");

    const builder = new CapacitorBuilder();
    const result = await builder.build({
      projectDir: ctx.outputDir,
      appName: ctx.config.name,
      appId: ctx.config.appId,
      version: ctx.config.version,
      targets: mobileTargets,
      onLog: (line: string) => ctx.log("info", line, STAGE),
    });

    if (!result.success) {
      throw new Error(result.error ?? "Capacitor build failed");
    }

    for (const artifact of result.artifacts) {
      ctx.log("info", `Mobile artifact [${artifact.platform}]: ${artifact.path}`, STAGE);
    }

    ctx.completeStage(STAGE);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    ctx.failStage(STAGE, error);
    throw error;
  }
}
