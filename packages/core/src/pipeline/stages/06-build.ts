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

  if (ctx.dryRun) {
    ctx.log("info", "[DRY-RUN] Would run: vite build", STAGE);
    ctx.completeStage(STAGE);
    return;
  }

  try {
    // ── Pre-flight: ensure node_modules and vite exist ────────────
    await ensureNodeModules(ctx);

    // ── Ensure index.html exists in output dir ────────────────────
    await ensureIndexHtml(ctx);

    // ── Patch vite config for Electron ────────────────────────────
    await patchViteConfig(ctx);

    // ── Fix PostCSS ESM/CJS mismatch ──────────────────────────────
    await fixPostcssConfig(ctx);

    // ── Fix Tailwind config ESM/CJS mismatch ─────────────────────
    await fixTailwindConfig(ctx);

    // ── Fix CSS @import ordering (must precede @tailwind) ─────
    await fixCssImportOrder(ctx);

    ctx.log("info", "Running vite build...", STAGE);

    const buildCommand = await resolveBuildCommand(ctx.outputDir);
    ctx.log("info", `Running: ${buildCommand}`, STAGE);

    const { stdout, stderr } = await execAsync(
      cmd(buildCommand),
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

// ─── Fix #7 & #8: Ensure node_modules and vite are installed ─────────────────

async function ensureNodeModules(ctx: PipelineContext): Promise<void> {
  const nmDir = path.join(ctx.outputDir, "node_modules");
  const nmExists = await fs.stat(nmDir).then((s) => s.isDirectory()).catch(() => false);

  if (!nmExists) {
    ctx.log("warn", "node_modules missing — running npm install before build", STAGE);
    await execAsync(cmd("npm install --legacy-peer-deps --ignore-scripts"), {
      cwd: ctx.outputDir,
      env: { ...process.env, NODE_ENV: "development" },
      maxBuffer: 200 * 1024 * 1024,
    });
    ctx.log("info", "npm install complete", STAGE);
    return;
  }

  // Vite specifically must be present or npx vite build will fail
  const viteDir = path.join(ctx.outputDir, "node_modules", "vite");
  const viteExists = await fs.stat(viteDir).then((s) => s.isDirectory()).catch(() => false);

  if (!viteExists) {
    ctx.log("warn", "vite not found in node_modules — installing it", STAGE);
    await execAsync(cmd("npm install --save-dev vite --legacy-peer-deps"), {
      cwd: ctx.outputDir,
      env: { ...process.env, NODE_ENV: "development" },
      maxBuffer: 50 * 1024 * 1024,
    });
    ctx.log("info", "vite installed", STAGE);
  }

  // ── Fix: ensure the framework plugin for the generated vite.config.ts ─────
  // The pipeline generates a vite.config.ts that imports a framework plugin
  // (e.g. @vitejs/plugin-react). If that plugin isn't in node_modules the
  // build fails with ERR_MODULE_NOT_FOUND. Detect which one is needed and install.
  const framework = ctx.detection?.framework ?? "react";
  const pluginMap: Record<string, string> = {
    react:  "@vitejs/plugin-react",
    vue:    "@vitejs/plugin-vue",
    svelte: "@sveltejs/vite-plugin-svelte",
  };
  const pluginPkg = pluginMap[framework];

  if (pluginPkg) {
    const pluginDir = path.join(ctx.outputDir, "node_modules", pluginPkg);
    const pluginExists = await fs.stat(pluginDir).then((s) => s.isDirectory()).catch(() => false);

    if (!pluginExists) {
      ctx.log("warn", `${pluginPkg} not found in node_modules — installing it`, STAGE);
      await execAsync(cmd(`npm install --save-dev ${pluginPkg} --legacy-peer-deps`), {
        cwd: ctx.outputDir,
        env: { ...process.env, NODE_ENV: "development" },
        maxBuffer: 100 * 1024 * 1024,
      });
      ctx.log("info", `${pluginPkg} installed`, STAGE);
    }
  }
}

// ─── Ensure index.html ────────────────────────────────────────────────────────

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

// ─── Main vite config patcher ─────────────────────────────────────────────────

async function patchViteConfig(ctx: PipelineContext): Promise<void> {
  // We completely overwrite the vite config with a clean, generated one.
  const isESM = await isESMProject(ctx.outputDir);
  const configName = isESM ? "vite.config.ts" : "vite.config.ts"; // Always use .ts
  const configPath = path.join(ctx.outputDir, configName);

  // Clean up any old config files
  const candidates = [
    path.join(ctx.outputDir, "vite.config.js"),
    path.join(ctx.outputDir, "vite.config.mts"),
    path.join(ctx.outputDir, "vite.config.mjs"),
    path.join(ctx.outputDir, "vite.config.cjs"),
    path.join(ctx.outputDir, "vite.config.ts"),
  ];
  for (const candidate of candidates) {
    try { await fs.unlink(candidate); } catch {}
  }

  const aliases = ctx.detection?.pathAliases ?? {};
  const aliasEntries = Object.entries(aliases)
    .map(([k, v]) => `      '${k}': path.resolve(__dirname, '${v.replace(/\\/g, "/")}')`)
    .join(",\n");

  const framework = ctx.detection?.framework ?? "react";
  let pluginImport = "";
  let pluginUse = "";

  if (framework === "react") {
    pluginImport = "import react from '@vitejs/plugin-react';";
    pluginUse = "react()";
  } else if (framework === "vue") {
    pluginImport = "import vue from '@vitejs/plugin-vue';";
    pluginUse = "vue()";
  } else if (framework === "svelte") {
    pluginImport = "import { svelte } from '@sveltejs/vite-plugin-svelte';";
    pluginUse = "svelte()";
  }

  const dirnamePolyfill = isESM 
    ? `import { fileURLToPath } from 'node:url';\nconst __filename = fileURLToPath(import.meta.url);\nconst __dirname = path.dirname(__filename);\n`
    : ``;

  const content = `import { defineConfig } from 'vite';
import path from 'node:path';
${pluginImport}
${dirnamePolyfill}
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
  },
  plugins: [
    ${pluginUse}
  ],
  resolve: {
    alias: {
${aliasEntries}
    }
  }
});
`;

  await fs.writeFile(configPath, content, "utf-8");
  ctx.log("info", "Generated clean vite.config.ts from scratch", STAGE);
}

// ─── Fix #2: PostCSS ESM/CJS fix (now actually called) ───────────────────────

async function fixPostcssConfig(ctx: PipelineContext): Promise<void> {
  const isESM = await isESMProject(ctx.outputDir);
  const candidates = [
    path.join(ctx.outputDir, "postcss.config.js"),
    path.join(ctx.outputDir, "postcss.config.ts"),
  ];

  for (const configPath of candidates) {
    try {
      let content = await fs.readFile(configPath, "utf-8");
      
      if (isESM && content.includes("module.exports") && configPath.endsWith(".js")) {
        // CJS file in ESM project -> rename to .cjs
        const cjsPath = configPath.replace(/\.js$/, ".cjs");
        await fs.rename(configPath, cjsPath);
        ctx.log("info", `Fixed ${path.basename(configPath)}: renamed to .cjs for ESM project`, STAGE);
      } else if (!isESM && content.includes("export default")) {
        // ESM file in CJS project -> rewrite to CJS
        content = content
          .replace(/export default\s*\{/, "module.exports = {")
          .replace(/^export default/m, "module.exports =");
        await fs.writeFile(configPath, content, "utf-8");
        ctx.log("info", `Fixed ${path.basename(configPath)}: converted ESM export to module.exports`, STAGE);
      }
    } catch { /* file doesn't exist */ }
  }
}

// ─── Fix #CSS: Move @import above @tailwind directives ─────────────────────
/**
 * CSS spec requires @import to precede all other rules (except @charset).
 * Tailwind's @tailwind directives count as "other rules", so any @import
 * that appears after them triggers a Vite error:
 *   "@import must precede all other statements (besides @charset or empty @layer)"
 *
 * This function scans all .css / .scss files in src/ and moves any @import
 * url() or @import '...' lines that appear after @tailwind to the top.
 */
async function fixCssImportOrder(ctx: PipelineContext): Promise<void> {
  const srcDir = path.join(ctx.outputDir, "src");
  if (!(await fs.stat(srcDir).then((s) => s.isDirectory()).catch(() => false))) return;

  const cssExts = /\.(css|scss|sass|less)$/i;

  async function walkCss(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walkCss(fullPath);
      } else if (cssExts.test(entry.name)) {
        await reorderCssImports(fullPath, ctx);
      }
    }
  }

  await walkCss(srcDir);

  // Also check root-level CSS files (e.g. index.css at project root)
  const rootEntries = await fs.readdir(ctx.outputDir, { withFileTypes: true }).catch(() => []);
  for (const entry of rootEntries) {
    if (!entry.isDirectory() && cssExts.test(entry.name)) {
      await reorderCssImports(path.join(ctx.outputDir, entry.name), ctx);
    }
  }
}

async function reorderCssImports(filePath: string, ctx: PipelineContext): Promise<void> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch {
    return;
  }

  // Only act if both @tailwind and @import are present
  if (!content.includes("@tailwind") || !content.includes("@import")) return;

  const lines = content.split("\n");

  const importLines: string[] = [];
  const otherLines: string[] = [];
  let foundNonImport = false;
  let needsReorder = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const isImport = /^@import\s/.test(trimmed);
    const isCharset = /^@charset\s/.test(trimmed);
    const isLayer = /^@layer\s*;/.test(trimmed); // empty @layer
    const isBlank = trimmed === "";

    if (!foundNonImport && (isImport || isCharset || isLayer || isBlank)) {
      if (isImport || isCharset) importLines.push(line);
      else otherLines.push(line); // blank/empty-layer goes to body
    } else {
      if (isImport) {
        // @import found AFTER non-import content — needs reorder
        importLines.push(line);
        needsReorder = true;
      } else {
        if (!isBlank || foundNonImport) foundNonImport = true;
        otherLines.push(line);
      }
    }
  }

  if (!needsReorder) return;

  const reordered = [...importLines, "", ...otherLines].join("\n");
  await fs.writeFile(filePath, reordered, "utf-8");
  const rel = path.relative(ctx.outputDir, filePath);
  ctx.log("info", `Fixed CSS @import order in: ${rel}`, STAGE);
}

// ─── Fix #3: Tailwind config ESM/CJS fix ────────────────────────────────────

async function fixTailwindConfig(ctx: PipelineContext): Promise<void> {
  const isESM = await isESMProject(ctx.outputDir);
  const candidates = [
    path.join(ctx.outputDir, "tailwind.config.js"),
    path.join(ctx.outputDir, "tailwind.config.ts"),
    path.join(ctx.outputDir, "tailwind.config.cjs"),
  ];

  for (const configPath of candidates) {
    if (configPath.endsWith(".cjs")) continue; // already CJS
    try {
      let content = await fs.readFile(configPath, "utf-8");

      if (isESM && content.includes("module.exports") && configPath.endsWith(".js")) {
        // CJS file in ESM project -> rename to .cjs
        const cjsPath = configPath.replace(/\.js$/, ".cjs");
        await fs.rename(configPath, cjsPath);
        ctx.log("info", `Fixed ${path.basename(configPath)}: renamed to .cjs for ESM project`, STAGE);
      } else if (!isESM && !content.includes("module.exports") && content.includes("export default")) {
        // ESM file in CJS project -> rewrite to CJS
        content = content
          .replace(/export default\s*\{/, "module.exports = {")
          .replace(/^export default/m, "module.exports =");
        await fs.writeFile(configPath, content, "utf-8");
        ctx.log("info", `Fixed ${path.basename(configPath)}: converted ESM export to module.exports`, STAGE);
      }
    } catch { /* file doesn't exist */ }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────



/**
 * Returns true if the output project has `"type": "module"` in package.json,
 * meaning vite.config.ts will be loaded as ESM.
 */
async function isESMProject(outputDir: string): Promise<boolean> {
  try {
    const pkg = JSON.parse(
      await fs.readFile(path.join(outputDir, "package.json"), "utf-8")
    ) as { type?: string };
    return pkg.type === "module";
  } catch {
    return false;
  }
}

/**
 * Resolve the best build command to use:
 * 1. Use ./node_modules/.bin/vite if it exists (avoids npx downloading a fresh vite
 *    that can't find the project-local vite in its config file).
 * 2. Fall back to `npm run build` if a build script is defined in package.json.
 * 3. Last resort: `npx --no vite build` (--no prevents installing, forces local).
 */
async function resolveBuildCommand(outputDir: string): Promise<string> {
  // 1. Prefer local binary
  const localVite = path.join(outputDir, "node_modules", ".bin", "vite");
  const localViteExists = await fs.stat(localVite).then(() => true).catch(() => false);
  if (localViteExists) {
    // On Windows the binary is node_modules/.bin/vite.cmd
    const isWin = process.platform === "win32";
    return isWin
      ? `"${path.join(outputDir, "node_modules", ".bin", "vite.cmd")}" build`
      : `"${localVite}" build`;
  }

  // 2. npm run build if package.json has it
  try {
    const pkg = JSON.parse(
      await fs.readFile(path.join(outputDir, "package.json"), "utf-8")
    ) as { scripts?: Record<string, string> };
    if (pkg.scripts?.build) {
      return "npm run build";
    }
  } catch {}

  // 3. Fallback — use npx but prevent it from auto-installing a mismatched version
  return "npx --no vite build";
}
