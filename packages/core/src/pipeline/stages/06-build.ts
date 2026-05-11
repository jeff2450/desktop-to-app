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
    const minimal = buildMinimalViteConfig();
    configPath = path.join(ctx.outputDir, "vite.config.js");
    await fs.writeFile(configPath, minimal, "utf-8");
    return;
  }

  let changed = false;

  // ── Fix #1: Add base: './' if missing ────────────────────────────────────
  if (!content.includes("base:") && !content.includes("base :")) {
    content = content.replace(
      /(defineConfig\s*\(\s*\{|=>\s*\(\s*\{)/,
      (m) => m.replace("{", "{\n  base: './',")
    );
    changed = true;
    ctx.log("info", "Added base: './' to vite config", STAGE);
  }

  // ── Fix #12: Ensure build.outDir: 'dist' is set ──────────────────────────
  if (!content.includes("outDir:") && !content.includes("outDir :")) {
    // Inject inside existing build: {} block if present
    if (content.includes("build:")) {
      content = content.replace(
        /build\s*:\s*\{/,
        "build: {\n    outDir: 'dist',"
      );
    } else {
      // Inject a build block
      content = content.replace(
        /(defineConfig\s*\(\s*\{|=>\s*\(\s*\{)/,
        (m) => m.replace("{", "{\n  build: { outDir: 'dist' },")
      );
    }
    changed = true;
    ctx.log("info", "Set build.outDir: 'dist' in vite config", STAGE);
  }

  // ── Fix #2: Remove lovable-tagger ────────────────────────────────────────
  if (content.includes("lovable-tagger")) {
    content = content.replace(
      /^.*import[^'"]*from\s*['"]lovable-tagger['"]\s*;?\s*\n?/gm,
      "// lovable-tagger removed by WebToApp\n"
    );

    // Single-line: mode === 'development' && componentTagger()
    content = content.replace(
      /\bmode\s*===?\s*['"]development['"]\s*&&\s*(?:componentTagger|lovableTagger)\s*\(\s*\)\s*,?[\t ]*\n?/g,
      ""
    );

    // Multi-line: mode === 'development' &&\n    componentTagger()
    content = content.replace(
      /[\t ]*\bmode\s*===?\s*['"]development['"]\s*&&[\t ]*\n[\t ]*(?:componentTagger|lovableTagger)\s*\(\s*\)\s*,?[\t ]*\n?/g,
      ""
    );

    // Bare tagger() call
    content = content.replace(/[\t ]*(?:componentTagger|lovableTagger)\s*\(\s*\)\s*,?[\t ]*\n?/g, "");

    // Remove now-redundant .filter(Boolean)
    content = content.replace(/\]\.filter\(Boolean\)/g, "]");

    changed = true;
    ctx.log("info", "Removed lovable-tagger from vite config", STAGE);
  }

  // ── Fix #3: Remove vite-plugin-pwa import ────────────────────────────────
  if (content.includes("vite-plugin-pwa")) {
    content = content.replace(
      /^.*import.*VitePWA.*from.*vite-plugin-pwa.*\n?/gm,
      "// vite-plugin-pwa removed by WebToApp (not supported in Electron)\n"
    );
    changed = true;
    ctx.log("info", "Removed vite-plugin-pwa import from vite config", STAGE);
  }

  // ── Fix #3b: Remove VitePWA(...) plugin call ─────────────────────────────
  if (content.includes("VitePWA(")) {
    content = removePluginBlock(content, "VitePWA");
    changed = true;
    ctx.log("info", "Removed VitePWA plugin from vite config", STAGE);
  }

  // ── Fix #8 & #9: Remove vite-plugin-checker (causes TS errors at build) ──
  if (content.includes("vite-plugin-checker")) {
    content = content.replace(
      /^.*import[^'"]*from\s*['"]vite-plugin-checker['"]\s*;?\s*\n?/gm,
      "// vite-plugin-checker removed by WebToApp\n"
    );
    // Remove checker({...}) plugin call
    content = removePluginBlock(content, "checker");
    changed = true;
    ctx.log("info", "Removed vite-plugin-checker from vite config (can block Electron builds)", STAGE);
  }

  // ── Fix #10: Clean up double/trailing commas left by plugin removals ──────
  content = cleanupPluginsArray(content);

  // ── Fix #4 & #5: Inject path aliases with proper 'path' import ───────────
  const aliases = ctx.detection?.pathAliases ?? {};
  if (Object.keys(aliases).length > 0) {
    // Fix #4: Check for 'alias:' specifically, not just 'resolve:'
    if (!content.includes("alias:") && !content.includes("alias :")) {
      // Fix #5: Ensure 'path' is imported
      content = ensurePathImport(content);

      // Fix #13: Normalise to forward slashes
      const aliasEntries = Object.entries(aliases)
        .map(([k, v]) => `      '${k}': path.resolve(__dirname, '${v.replace(/\\/g, "/")}'),`);

      if (content.includes("resolve:")) {
        // resolve block exists but no alias: — inject inside it
        content = content.replace(
          /resolve\s*:\s*\{/,
          `resolve: {\n    alias: {\n${aliasEntries.join("\n")}\n    },`
        );
      } else {
        // Inject a complete resolve.alias block
        const aliasBlock = `  resolve: {\n    alias: {\n${aliasEntries.join("\n")}\n    },\n  },`;
        content = content.replace(
          /(defineConfig\s*\(\s*\{|=>\s*\(\s*\{)/,
          (m) => m + "\n" + aliasBlock
        );
      }
      changed = true;
      ctx.log("info", `Injected path aliases: ${Object.keys(aliases).join(", ")}`, STAGE);
    } else {
      ctx.log("debug", "alias already present in vite config — skipping injection", STAGE);
    }
  }

  // ── Fix #1: Ensure __dirname is available for ESM vite configs ───────────
  //    When vite.config.ts is loaded as ESM (package.json "type":"module"),
  //    __dirname is not defined. Inject a polyfill at the top if needed.
  if (
    content.includes("__dirname") &&
    !content.includes("fileURLToPath") &&
    !content.includes("const __dirname")
  ) {
    const isESM =
      content.includes("import ") || // has ES import statements
      (await isESMProject(ctx.outputDir));

    if (isESM) {
      const polyfill =
        `import { fileURLToPath } from 'node:url';\n` +
        `const __filename = fileURLToPath(import.meta.url);\n` +
        `const __dirname = path.dirname(__filename);\n`;

      // Insert after the last top-level import line
      content = content.replace(
        /^((?:import[^\n]*\n)+)/m,
        (m) => m + polyfill
      );
      changed = true;
      ctx.log("info", "Injected __dirname ESM polyfill into vite config", STAGE);
    }
  }

  if (changed) {
    await fs.writeFile(configPath, content, "utf-8");
  }
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
 * Removes a plugin function call (e.g. VitePWA({...}) or checker({...}))
 * from a vite config string, handling arbitrarily nested braces/parens.
 */
function removePluginBlock(content: string, pluginName: string): string {
  const startMarker = `${pluginName}(`;
  const startIdx = content.indexOf(startMarker);
  if (startIdx === -1) return content;

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

  let endIdx = i + 1;
  if (content[endIdx] === ",") endIdx++;
  if (content[endIdx] === "\n") endIdx++;

  return (
    content.slice(0, startIdx) +
    `// ${pluginName} removed by WebToApp\n` +
    content.slice(endIdx)
  );
}

/**
 * After removing plugins, the array may have double commas (`, ,`) or
 * a trailing comma before the closing bracket (`,[whitespace]]`).
 * This cleans both up.
 */
function cleanupPluginsArray(content: string): string {
  // Collapse sequences of comma + optional whitespace/newline + comma → single comma
  let cleaned = content.replace(/,(\s*,)+/g, ",");

  // Remove trailing comma before closing bracket: ,\n  ] or , ]
  cleaned = cleaned.replace(/,(\s*)\]/g, "$1]");

  return cleaned;
}

/**
 * Ensures `import path from 'node:path'` (or `'path'`) exists in the file.
 * Only adds it when the config uses ES import syntax.
 * If the file uses require() it means it's CJS and path is available via require.
 */
function ensurePathImport(content: string): string {
  const hasPathImport =
    /import\s+path\s+from/.test(content) ||
    /const\s+path\s*=\s*require\s*\(/.test(content);

  if (hasPathImport) return content;

  // Prepend to the file, before the first import
  const pathImport = `import path from 'node:path';\n`;
  return pathImport + content;
}

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

/** Generates a safe minimal vite.config.js that always works in Electron. */
function buildMinimalViteConfig(): string {
  return `import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
  },
});
`;
}
