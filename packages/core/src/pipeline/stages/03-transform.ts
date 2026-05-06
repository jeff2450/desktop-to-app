import path from "node:path";
import fs from "node:fs/promises";

import type { PipelineContext } from "../PipelineContext.js";
import { transformFile } from "@webtoapp/transformers";

const STAGE = "03-transform";

/**
 * Stage 03 — Transform
 *
 * Iterates over ctx.plan.filesToTransform and runs the appropriate
 * transformer on each file, writing the result to ctx.outputDir.
 *
 * Files that the transformer cannot handle confidently (confidence < 0.8)
 * are flagged; the AI fallback transformer (Session 3) handles those.
 *
 * Files in ctx.plan.filesToCopy are copied verbatim to outputDir.
 */
export async function runTransformStage(ctx: PipelineContext): Promise<void> {
  ctx.startStage(STAGE);

  if (!ctx.plan) {
    const err = new Error("Migration plan missing — stage 02 must run first");
    ctx.failStage(STAGE, err);
    throw err;
  }

  try {
    const { filesToTransform, filesToCopy } = ctx.plan;
    let transformed = 0;
    let copied = 0;
    let failed = 0;
    const lowConfidenceFiles: string[] = [];

    // ── Transform files ────────────────────────────────────────────
    for (const plan of filesToTransform) {
      const sourcePath = path.join(ctx.sourceDir, plan.sourcePath);
      const outputPath = path.join(ctx.outputDir, plan.outputPath);

      await fs.mkdir(path.dirname(outputPath), { recursive: true });

      ctx.log("info", `Transforming: ${plan.sourcePath} (${plan.transformerType})`, STAGE);

      try {
        const result = await transformFile({
          sourcePath,
          outputPath,
          transformerType: plan.transformerType,
          projectRoot: ctx.sourceDir,
        });

        if (result.success) {
          // Write transformed content to output
          await fs.writeFile(outputPath, result.transformedContent ?? "", "utf-8");
          transformed++;

          for (const change of result.changes) {
            ctx.log("debug", `  ✓ ${change}`, STAGE);
          }

          if (result.confidence < 0.8) {
            lowConfidenceFiles.push(plan.sourcePath);
            ctx.log("warn", `  Low confidence (${(result.confidence * 100).toFixed(0)}%): ${plan.sourcePath}`, STAGE);
          }

          for (const warning of result.warnings) {
            ctx.log("warn", `  ⚠ ${warning}`, STAGE);
          }
        } else {
          // Transformer failed — copy original and log
          ctx.log("warn", `Transform failed for ${plan.sourcePath}: ${result.error}`, STAGE);
          await fs.copyFile(sourcePath, outputPath);
          failed++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.log("warn", `Transformer threw for ${plan.sourcePath}: ${msg} — copying original`, STAGE);
        await fs.copyFile(sourcePath, outputPath).catch(() => {});
        failed++;
      }
    }

    // ── Copy verbatim files ────────────────────────────────────────
    for (const relPath of filesToCopy) {
      const src = path.join(ctx.sourceDir, relPath);
      const dest = path.join(ctx.outputDir, relPath);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(src, dest).catch(() => {
        // File may no longer exist — skip silently
      });
      copied++;
    }

    // ── Also copy non-source assets ────────────────────────────────
    await copyPublicAssets(ctx);
    await copySrcAssets(ctx);

    ctx.log("info", `Transformed: ${transformed} files`, STAGE);
    ctx.log("info", `Copied:      ${copied} files`, STAGE);
    if (failed > 0) ctx.log("warn", `Failed:      ${failed} files (originals preserved)`, STAGE);
    if (lowConfidenceFiles.length > 0) {
      ctx.log(
        "warn",
        `${lowConfidenceFiles.length} file(s) had low transform confidence — ` +
          "AI fallback will be used for these in Session 3.",
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Copy public/ directory and other static assets to the output project.
 */
async function copyPublicAssets(ctx: PipelineContext): Promise<void> {
  const publicSrc = path.join(ctx.sourceDir, "public");
  const publicDest = path.join(ctx.outputDir, "public");

  if (!(await dirExists(publicSrc))) return;

  await copyDir(publicSrc, publicDest);
  ctx.log("info", "Copied public/ assets", STAGE);
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

async function dirExists(p: string): Promise<boolean> {
  return fs
    .stat(p)
    .then((s) => s.isDirectory())
    .catch(() => false);
}

/**
 * Copy all non-TypeScript files from src/ that were not already
 * copied by the transform/copy steps. This includes .css, .svg,
 * .png, .json, .postcss, and any other asset files.
 */
async function copySrcAssets(ctx: PipelineContext): Promise<void> {
  const srcDir = path.join(ctx.sourceDir, "src");
  const destSrcDir = path.join(ctx.outputDir, "src");

  if (!(await dirExists(srcDir))) return;

  // Non-TS file extensions to copy
  const assetExts = /\.(css|scss|sass|less|svg|png|jpg|jpeg|gif|ico|webp|json|xml|txt|md|woff|woff2|ttf|eot)$/i;

  async function walk(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await walk(srcPath, destPath);
      } else if (assetExts.test(entry.name)) {
        // Only copy if not already present in dest
        const exists = await fs.access(destPath).then(() => true).catch(() => false);
        if (!exists) {
          await fs.copyFile(srcPath, destPath);
        }
      }
    }
  }

  await walk(srcDir, destSrcDir);

  // Also copy root-level config files needed for the build
  const rootAssets = [
    "postcss.config.js",
    "postcss.config.cjs",
    "postcss.config.ts",
    "tailwind.config.js",
    "tailwind.config.ts",
    "tailwind.config.cjs",
    "tsconfig.json",
    "tsconfig.app.json",
    "tsconfig.node.json",
    ".env",
    ".env.local",
  ];

  for (const file of rootAssets) {
    const src = path.join(ctx.sourceDir, file);
    const dest = path.join(ctx.outputDir, file);
    const srcExists = await fs.access(src).then(() => true).catch(() => false);
    const destExists = await fs.access(dest).then(() => true).catch(() => false);
    if (srcExists && !destExists) {
      await fs.copyFile(src, dest);
      ctx.log("debug", `Copied asset: ${file}`, "03-transform");
    }
  }

  ctx.log("info", "Copied src/ assets and config files", "03-transform");
}
