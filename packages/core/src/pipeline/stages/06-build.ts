import path from "node:path";
import fs from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";

import type { PipelineContext } from "../PipelineContext.js";

const execAsync = promisify(exec);
const STAGE = "06-build";

function cmd(command: string): string {
  return process.platform === "win32" ? `cmd /c ${command}` : command;
}

export async function runBuildStage(ctx: PipelineContext): Promise<void> {
  ctx.startStage(STAGE);

  try {
    // Ensure index.html exists in output dir
    await ensureIndexHtml(ctx);

    // Patch vite config for Electron
    await patchViteConfig(ctx);

    ctx.log("info", "Running vite build...", STAGE);

    const { stdout, stderr } = await execAsync(
      cmd("npx vite build"),
      {
        cwd: ctx.outputDir,
        env: {
          ...process.env,
          NODE_ENV: "production",
          VITE_LOCAL_API: "true",
          VITE_API_PORT: String(ctx.config.backend?.port ?? 3001),
        },
        maxBuffer: 200 * 1024 * 1024,
      }
    );

    if (stdout) stdout.split("\n").filter(Boolean).forEach((l) => ctx.log("info", l, STAGE));
    if (stderr) stderr.split("\n").filter(Boolean).forEach((l) => ctx.log("warn", l, STAGE));

    const distDir = path.join(ctx.outputDir, "dist");
    const distExists = await fs.stat(distDir).then((s) => s.isDirectory()).catch(() => false);

    if (!distExists) {
      throw new Error("Vite build completed but dist/ was not produced.");
    }

    ctx.log("info", "Vite build complete — dist/ ready", STAGE);
    ctx.completeStage(STAGE);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    ctx.failStage(STAGE, error);
    throw error;
  }
}

async function ensureIndexHtml(ctx: PipelineContext): Promise<void> {
  const dest = path.join(ctx.outputDir, "index.html");
  const exists = await fs.access(dest).then(() => true).catch(() => false);
  if (!exists) {
    const src = path.join(ctx.sourceDir, "index.html");
    try {
      await fs.copyFile(src, dest);
      ctx.log("info", "Copied index.html from source project", STAGE);
    } catch {
      ctx.log("warn", "index.html not found in source", STAGE);
    }
  }
}

async function patchViteConfig(ctx: PipelineContext): Promise<void> {
  const candidates = [
    path.join(ctx.outputDir, "vite.config.ts"),
    path.join(ctx.outputDir, "vite.config.js"),
    path.join(ctx.outputDir, "vite.config.mts"),
    path.join(ctx.outputDir, "vite.config.mjs"),
  ];

  let configPath: string | null = null;
  let content = "";

  for (const candidate of candidates) {
    try {
      content = await fs.readFile(candidate, "utf-8");
      configPath = candidate;
      break;
    } catch { /* try next */ }
  }

  // Copy from source if not in output
  if (!configPath) {
    const sourceCandidates = [
      path.join(ctx.sourceDir, "vite.config.ts"),
      path.join(ctx.sourceDir, "vite.config.js"),
      path.join(ctx.sourceDir, "vite.config.mts"),
    ];
    for (const src of sourceCandidates) {
      try {
        content = await fs.readFile(src, "utf-8");
        const destName = path.basename(src);
        configPath = path.join(ctx.outputDir, destName);
        await fs.copyFile(src, configPath);
        ctx.log("info", `Copied ${destName} from source`, STAGE);
        break;
      } catch { /* try next */ }
    }
  }

  if (!configPath) {
    ctx.log("warn", "No vite.config found — creating minimal one", STAGE);
    const minimal = `import { defineConfig } from 'vite';\nexport default defineConfig({ base: './', build: { outDir: 'dist' } });\n`;
    configPath = path.join(ctx.outputDir, "vite.config.js");
    await fs.writeFile(configPath, minimal, "utf-8");
    return;
  }

  let changed = false;

  // 1. Add base: './' if missing
  if (!content.includes("base:") && !content.includes("base :")) {
    content = content.replace(
      /defineConfig\s*\(\s*(\(\s*\)\s*=>)?\s*\(\s*\{/,
      (m) => m.replace("{", "{\n  base: './',"  )
    );
    changed = true;
    ctx.log("info", "Added base: './' to vite config", STAGE);
  }

  // 2. Remove lovable-tagger import and usage (Lovable.dev specific, breaks in Electron)
  if (content.includes("lovable-tagger")) {
    content = content.replace(
      /^.*import.*componentTagger.*from.*lovable-tagger.*\n?/gm,
      "// lovable-tagger removed by WebToApp\n"
    );
    content = content.replace(
      /componentTagger\s*\(\s*\)\s*,?\n?/g,
      ""
    );
    changed = true;
    ctx.log("info", "Removed lovable-tagger from vite config", STAGE);
  }

  // 3. Remove PWA import line
  if (content.includes("vite-plugin-pwa")) {
    content = content.replace(
      /^.*import.*VitePWA.*from.*vite-plugin-pwa.*\n?/gm,
      "// vite-plugin-pwa removed by WebToApp (not supported in Electron)\n"
    );
    changed = true;
  }

  // 4. Remove VitePWA(...) call from plugins — handles multi-line blocks
  if (content.includes("VitePWA(")) {
    // Remove the entire VitePWA({...}) block including nested braces
    content = removeVitePWABlock(content);
    changed = true;
    ctx.log("info", "Removed VitePWA plugin from vite config", STAGE);
  }

  if (changed) {
    await fs.writeFile(configPath, content, "utf-8");
  }
}

/**
 * Removes VitePWA({...}) from the plugins array,
 * handling arbitrarily nested braces in the config object.
 */
function removeVitePWABlock(content: string): string {
  const startMarker = "VitePWA(";
  const startIdx = content.indexOf(startMarker);
  if (startIdx === -1) return content;

  // Find the matching closing paren by counting braces/parens
  let depth = 0;
  let i = startIdx + startMarker.length - 1; // position of opening (

  for (; i < content.length; i++) {
    const ch = content[i];
    if (ch === "(" || ch === "{") depth++;
    else if (ch === ")" || ch === "}") {
      depth--;
      if (depth === 0) break;
    }
  }

  // i is now at the closing ) of VitePWA(...)
  // Remove from startIdx to i+1, plus optional comma and newline
  let endIdx = i + 1;
  // Eat trailing comma
  if (content[endIdx] === ",") endIdx++;
  // Eat trailing newline
  if (content[endIdx] === "\n") endIdx++;

  return (
    content.slice(0, startIdx) +
    "// VitePWA removed by WebToApp\n" +
    content.slice(endIdx)
  );
}

/**
 * Fix postcss.config.js ESM/CJS issue.
 * If the file uses 'export default', rename to postcss.config.cjs in output
 * or rewrite to use module.exports
 */
async function fixPostcssConfig(ctx: PipelineContext): Promise<void> {
  const candidates = [
    path.join(ctx.outputDir, "postcss.config.js"),
    path.join(ctx.outputDir, "postcss.config.ts"),
  ];

  for (const configPath of candidates) {
    try {
      let content = await fs.readFile(configPath, "utf-8");
      if (content.includes("export default")) {
        // Rewrite to CommonJS
        content = content
          .replace(/export default\s*\{/, "module.exports = {")
          .replace(/^export default/m, "module.exports =");
        await fs.writeFile(configPath, content, "utf-8");
        ctx.log("info", `Fixed ${path.basename(configPath)}: converted ESM export to module.exports`, STAGE);
      }
    } catch { /* file doesn't exist */ }
  }
}

