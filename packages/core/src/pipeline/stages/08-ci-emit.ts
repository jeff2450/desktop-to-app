import path from "node:path";
import fs from "node:fs/promises";
import Handlebars from "handlebars";
import { fileURLToPath } from "node:url";

import type { PipelineContext } from "../PipelineContext.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const STAGE      = "08-ci-emit";

/**
 * Stage 08 — CI Emit
 *
 * Optionally emits a GitHub Actions workflow file (.github/workflows/build.yml)
 * into the SOURCE project directory so the next git push triggers a
 * cross-platform build on GitHub's runners (Windows / macOS / Linux).
 *
 * This stage is skipped unless:
 *   - ci.provider is "github-actions"  AND
 *   - ci.autoEmit is true              OR
 *   - the --emit-ci CLI flag was passed
 *
 * The generated workflow:
 *   • Uses a matrix strategy (win / mac / linux)
 *   • Signs each platform artifact using GitHub Secrets
 *   • Publishes to GitHub Releases (works with electron-updater)
 *   • Uploads installer artifacts for manual inspection
 */
export async function runCiEmitStage(ctx: PipelineContext): Promise<void> {
  ctx.startStage(STAGE);

  try {
    const ci = (ctx.config as { ci?: CiConfig }).ci;

    if (!ci || ci.provider === "none" || (!ci.autoEmit)) {
      ctx.skipStage(STAGE, "CI emit disabled. Set ci.autoEmit=true in webtoapp.config.json to enable.");
      return;
    }

    if (ctx.dryRun) {
      ctx.log("info", "[DRY-RUN] Would emit .github/workflows/build.yml to source project", STAGE);
      ctx.completeStage(STAGE);
      return;
    }

    const workflowDir  = path.join(ctx.sourceDir, ".github", "workflows");
    const workflowPath = path.join(workflowDir, "build.yml");

    await fs.mkdir(workflowDir, { recursive: true });

    // Load and render the template
    const templatePath = path.resolve(
      __dirname,
      "../../../../templates/ci/github-actions.yml.hbs"
    );
    let templateContent: string;
    try {
      templateContent = await fs.readFile(templatePath, "utf-8");
    } catch {
      ctx.log("warn", `CI template not found at ${templatePath}. Skipping.`, STAGE);
      ctx.skipStage(STAGE, "CI template missing");
      return;
    }

    const rendered = Handlebars.compile(templateContent)({
      appName:     ctx.config.name,
      version:     ctx.config.version,
      githubOwner: ci.githubOwner ?? "your-github-username",
      githubRepo:  ci.githubRepo  ?? "your-repo-name",
      targets: {
        windows: ctx.config.targets.includes("windows" as never),
        mac:     ctx.config.targets.includes("mac" as never),
        linux:   ctx.config.targets.includes("linux" as never),
      },
    });

    // Don't overwrite an existing customized workflow without explicit flag
    const exists = await fs.access(workflowPath).then(() => true).catch(() => false);
    if (exists) {
      ctx.log(
        "warn",
        `.github/workflows/build.yml already exists in the source project. Skipping to avoid overwriting customizations.`,
        STAGE
      );
      ctx.completeStage(STAGE);
      return;
    }

    await fs.writeFile(workflowPath, rendered, "utf-8");

    ctx.log(
      "info",
      [
        `Emitted .github/workflows/build.yml → ${workflowPath}`,
        `Next steps:`,
        `  1. Commit and push to GitHub`,
        `  2. Add signing secrets in repo Settings → Secrets and variables → Actions`,
        `     WIN_CSC_LINK, WIN_CSC_KEY_PASSWORD (Windows)`,
        `     CSC_LINK, CSC_KEY_PASSWORD, APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID (macOS)`,
        `  3. Create a git tag: git tag v${ctx.config.version} && git push --tags`,
        `  4. Watch the build at: https://github.com/${ci.githubOwner}/${ci.githubRepo}/actions`,
      ].join("\n"),
      STAGE
    );

    ctx.completeStage(STAGE);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    ctx.failStage(STAGE, error);
    throw error;
  }
}

interface CiConfig {
  provider?: "github-actions" | "none";
  autoEmit?: boolean;
  githubOwner?: string;
  githubRepo?: string;
}
