import path from "node:path";
import fs from "node:fs/promises";
import Handlebars from "handlebars";
import { fileURLToPath } from "node:url";

import type { PipelineContext } from "../PipelineContext.js";
import type { FileGeneratePlan } from "../../types/MigrationPlan.js";
import { generateIcons } from "../../utils/icon-generator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STAGE = "04-scaffold";

/**
 * Stage 04 - Scaffold
 *
 * Generates the Electron wrapper files for an online conversion and patches
 * the copied project so electron-builder can package it.
 */
export async function runScaffoldStage(ctx: PipelineContext): Promise<void> {
  ctx.startStage(STAGE);

  if (!ctx.plan) {
    const err = new Error("Migration plan missing - stage 02 must run first");
    ctx.failStage(STAGE, err);
    throw err;
  }

  try {
    const icon = await resolveAppIcon(ctx);
    let generated = 0;

    for (const filePlan of ctx.plan.filesToGenerate) {
      const outputPath = path.join(ctx.outputDir, filePlan.outputPath);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });

      if (ctx.dryRun) {
        ctx.log("info", `[DRY-RUN] Would generate: ${filePlan.outputPath}`, STAGE);
        generated++;
        continue;
      }

      if (filePlan.generatorType === "electron-builder-config" && icon.validDest) {
        filePlan.templateVars["icon"] = icon.validDest;
      }

      const content = await generateFile(filePlan);
      await fs.writeFile(outputPath, content, "utf-8");
      ctx.log("info", `Generated: ${filePlan.outputPath}`, STAGE);
      generated++;
    }

    if (!ctx.dryRun) {
      await generateCleanEnv(ctx);
      await copyAppIcon(ctx, icon);
      await copyElectronAssets(ctx);
    } else {
      ctx.log("info", "[DRY-RUN] Would generate .env", STAGE);
    }

    ctx.log("info", `Scaffolded ${generated} files`, STAGE);
    ctx.completeStage(STAGE);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    ctx.failStage(STAGE, error);
    throw error;
  }
}

interface PackageJson {
  name?: string;
  version?: string;
  type?: string;
  private?: boolean;
  main?: string;
  author?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

async function patchPackageJson(ctx: PipelineContext): Promise<void> {
  const pkgPath = path.join(ctx.outputDir, "package.json");
  let pkg: PackageJson;

  try {
    pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8")) as PackageJson;
  } catch {
    pkg = {
      name: ctx.config.name || "webtoapp-project",
      version: ctx.config.version || "1.0.0",
      type: "module",
      private: true,
      dependencies: {},
      devDependencies: {},
      scripts: {},
    };
  }

  pkg.dependencies ??= {};
  pkg.devDependencies ??= {};
  pkg.scripts ??= {};

  for (const [name, version] of Object.entries(ctx.plan?.dependenciesToAdd ?? {})) {
    if (isElectronDevDependency(name)) {
      pkg.devDependencies[name] = version;
    } else {
      pkg.dependencies[name] = version;
    }
  }

  for (const name of ctx.plan?.dependenciesToRemove ?? []) {
    delete pkg.dependencies[name];
    delete pkg.devDependencies[name];
  }

  for (const [name, script] of Object.entries(ctx.plan?.scriptsToInject ?? {})) {
    pkg.scripts[name] = script;
  }

  for (const name of ["electron", "electron-builder", "electron-rebuild", "@electron/rebuild"]) {
    if (pkg.dependencies[name]) {
      pkg.devDependencies[name] = pkg.dependencies[name];
      delete pkg.dependencies[name];
    }
  }

  for (const name of ["vite-plugin-pwa", "@vite-pwa/assets-generator", "workbox-window", "workbox-precaching"]) {
    delete pkg.dependencies[name];
    delete pkg.devDependencies[name];
  }

  // ── Sentry crash reporting ────────────────────────────────────────────────
  // Auto-inject @sentry/electron when a DSN is configured (config file or env vars)
  const sentinelDsn = resolveSentryDsn(ctx);
  if (sentinelDsn) {
    pkg.dependencies["@sentry/electron"] ??= "^5.0.0";
    ctx.log("info", "Added @sentry/electron dependency (Sentry DSN detected)", STAGE);
  }

  pkg.main = "electron/main.cjs";
  pkg.author ??= ctx.config.author ?? "WebToApp Conversion";

  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2), "utf-8");
  ctx.log("info", "Patched package.json using migration plan", STAGE);
}

function isElectronDevDependency(name: string): boolean {
  return name === "electron" || name === "electron-builder" || name === "concurrently" || name === "wait-on";
}

/**
 * Resolve a Sentry DSN from (in order of priority):
 * 1. webtoapp.config.json → crashReporting.dsn
 * 2. Source project .env files (SENTRY_DSN or VITE_SENTRY_DSN)
 */
function resolveSentryDsn(ctx: PipelineContext): string | undefined {
  const configDsn = (ctx.config as { crashReporting?: { provider?: string; dsn?: string } }).crashReporting?.dsn;
  if (configDsn) return configDsn;

  // Check env vars already loaded into process.env from source .env
  return process.env["SENTRY_DSN"] ?? process.env["VITE_SENTRY_DSN"];
}

async function generateFile(plan: FileGeneratePlan): Promise<string> {
  try {
    const templateContent = await loadTemplate(plan.generatorType);
    return Handlebars.compile(templateContent)(plan.templateVars);
  } catch {
    return generateInline(plan);
  }
}

async function loadTemplate(generatorType: FileGeneratePlan["generatorType"]): Promise<string> {
  const templateMap: Partial<Record<FileGeneratePlan["generatorType"], string>> = {
    "electron-main": "electron/main.js.hbs",
    "electron-preload": "electron/preload.js.hbs",
    "electron-builder-config": "electron/electron-builder.yml.hbs",
    "mac-entitlements": "electron/entitlements.mac.plist.hbs",
    "express-server": "backend/server.js.hbs",
    "sqlite-database": "backend/database.js.hbs",
    "jwt-auth": "backend/auth.js.hbs",
    "crud-routes": "backend/routes/crud.js.hbs",
    "local-api-client": "localApi/localApi.ts.hbs",
    "local-auth-client": "localApi/localAuth.ts.hbs",
    ["window-controls" as any]: "electron/window-controls.js.hbs",
  };

  const relativePath = templateMap[generatorType];
  if (!relativePath) throw new Error(`No template mapping for ${generatorType}`);

  const templatesRoot = path.resolve(__dirname, "../../../../templates");
  return fs.readFile(path.join(templatesRoot, relativePath), "utf-8");
}

function generateInline(plan: FileGeneratePlan): string {
  switch (plan.generatorType) {
    case "electron-main":
      return generateElectronMain(plan.templateVars);
    case "electron-preload":
      return generateElectronPreload();
    case "electron-builder-config":
      return generateElectronBuilderConfig(plan.templateVars);
    case "mac-entitlements":
      return generateMacEntitlements();
    case "online-iframe-index" as any:
      return generateOnlineIframeIndex(plan.templateVars);
    case "online-iframe-app" as any:
      return generateOnlineIframeApp(plan.templateVars);
    case "online-iframe-main" as any:
      return generateOnlineIframeMain();
    case "window-controls" as any:
      return generateInlineWindowControls(plan.templateVars);
    default:
      return `// Generated by WebToApp - ${plan.generatorType}\n`;
  }
}

function generateOnlineIframeIndex(vars: Record<string, unknown>): string {
  const appName = String(vars["appName"] ?? "App");
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${appName}</title>
  </head>
  <body style="margin: 0; padding: 0; overflow: hidden; background-color: #000;">
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`;
}

function generateOnlineIframeApp(vars: Record<string, unknown>): string {
  const liveUrl = String(vars["liveUrl"] ?? "https://example.com");
  return `import React from 'react';

function App() {
  return (
    <div style={{ width: '100vw', height: '100vh', margin: 0, padding: 0, overflow: 'hidden' }}>
      <iframe
        src="${liveUrl}"
        title="App Shell"
        style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
      />
    </div>
  );
}

export default App;
`;
}

function generateOnlineIframeMain(): string {
  return `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
`;
}

function generateElectronMain(vars: Record<string, unknown>): string {
  const appName = String(vars["appName"] ?? "App");
  const devPort = Number(vars["devPort"] ?? 5173);
  const titleBar = String(vars["titleBar"] ?? "native");
  // Static/plain HTML apps: disable sandbox so vanilla JS event handlers
  // (onclick attributes, addEventListener, global functions) work correctly.
  const sandboxValue = vars["disableSandbox"] ? "false" : "true";

  return `const { app, BrowserWindow, shell, ipcMain, nativeTheme, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
let mainWindow;

function createWindow() {
  const isCustomTitleBar = '${titleBar}' === 'custom';

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: '${appName}',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f0f0f' : '#ffffff',
    // Apply borderless configuration when custom title bar is active
    ...(isCustomTitleBar ? (
      process.platform === 'darwin'
        ? { titleBarStyle: 'hidden' }
        : { frame: false }
    ) : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: ${sandboxValue},
    },
    show: false,
  });

  mainWindow.loadURL(isDev ? 'http://localhost:${devPort}' : 'app://./');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('did-fail-load', (_event, code, desc, url) => {
    console.error(\`[WebToApp] Page failed to load: \${code} \${desc} - \${url}\`);
  });

  // Inject custom window controls & update banner
  const bannerPath = path.join(__dirname, 'update-banner.js');
  const controlsPath = path.join(__dirname, 'window-controls.js');

  mainWindow.webContents.on('did-finish-load', () => {
    if (isCustomTitleBar && fs.existsSync(controlsPath)) {
      const controlsCode = fs.readFileSync(controlsPath, 'utf-8');
      mainWindow?.webContents.executeJavaScript(controlsCode).catch((err) => {
        console.error('[WebToApp] Window controls injection failed:', err);
      });
    }

    if (fs.existsSync(bannerPath)) {
      const bannerCode = fs.readFileSync(bannerPath, 'utf-8');
      mainWindow?.webContents.executeJavaScript(bannerCode).catch(() => {});
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

ipcMain.handle('app:get-version', () => app.getVersion());
ipcMain.on('app:minimize', () => mainWindow?.minimize());
ipcMain.on('app:maximize', () => {
  mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize();
});
ipcMain.on('app:close', () => mainWindow?.close());

function setupAutoUpdater() {
  if (isDev) return;
  autoUpdater.checkForUpdatesAndNotify();
  autoUpdater.on('update-available', () => mainWindow?.webContents.send('app:update-available'));
}

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    let pathname = url.pathname;
    if (pathname === '/' || pathname.endsWith('/')) {
      pathname = path.posix.join(pathname, 'index.html');
    }
    const hasExtension = /\\.\\w+$/.test(pathname);
    const distDir = path.join(__dirname, '../dist');
    let filePath = path.join(distDir, pathname);

    // Security: prevent path traversal outside dist/
    if (!filePath.startsWith(distDir + path.sep) && filePath !== distDir) {
      return new Response('Forbidden', { status: 403 });
    }

    if (!fs.existsSync(filePath)) {
      if (!hasExtension) {
        const htmlFilePath = filePath + '.html';
        if (fs.existsSync(htmlFilePath)) {
          filePath = htmlFilePath;
        } else {
          filePath = path.join(distDir, 'index.html');
        }
      } else {
        filePath = path.join(distDir, 'index.html');
      }
    }

    return net.fetch('file://' + filePath);
  });

  createWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
`;
}

function generateInlineWindowControls(vars: Record<string, unknown>): string {
  const appName = String(vars["appName"] ?? "App");
  return `(function() {
    'use strict';
    if (!window.electronAPI) return;
    const isMac = window.electronAPI.platform === 'darwin';
    const style = document.createElement('style');
    style.textContent = '#_wta-titlebar { position: fixed; top: 0; left: 0; width: 100%; height: 32px; z-index: 2147483647; background: rgba(15,17,23,0.8); color: white; display: flex; align-items: center; justify-content: flex-end; } body { padding-top: 32px !important; }';
    document.head.appendChild(style);
  })();`;
}

function generateElectronPreload(): string {
  return `const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('webtoapp', {
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  minimize: () => ipcRenderer.send('app:minimize'),
  maximize: () => ipcRenderer.send('app:maximize'),
  close: () => ipcRenderer.send('app:close'),
  onUpdateAvailable: (callback) => ipcRenderer.on('app:update-available', callback),
});
`;
}

function generateElectronBuilderConfig(vars: Record<string, unknown>): string {
  const appId = String(vars["appId"] ?? "com.example.app");
  const appName = String(vars["appName"] ?? "App");
  const icon = String(vars["icon"] ?? "assets/icon.png");
  const targets = Array.isArray(vars["targets"]) ? vars["targets"] : ["windows"];

  // Use .ico for Windows if available, otherwise fallback to the base icon
  const winIcon = icon.endsWith(".ico") ? icon : "assets/icon.ico";

  return `appId: ${appId}
productName: ${appName}
directories:
  output: release
files:
  - dist/**/*
  - electron/**/*
  - package.json
extraResources:
  - from: assets
    to: assets
    filter:
      - "**/*"
${targets.includes("windows") ? `win:
  target: nsis
  icon: ${winIcon}
` : ""}${targets.includes("linux") ? `linux:
  target:
    - AppImage
  icon: ${icon}
` : ""}${targets.includes("mac") ? `mac:
  target: dmg
  icon: ${icon}
` : ""}`;
}

function generateMacEntitlements(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.debugger</key>
    <true/>
  </dict>
</plist>
`;
}

async function generateCleanEnv(ctx: PipelineContext): Promise<void> {
  const sourceEnvFiles = [".env", ".env.local", ".env.production"];
  const outputLines: string[] = [
    "# Generated by WebToApp - desktop app environment",
    "# Source environment values are preserved for the packaged app.",
    "",
  ];

  for (const file of sourceEnvFiles) {
    const content = await fs.readFile(path.join(ctx.sourceDir, file), "utf-8").catch(() => "");
    if (!content.trim()) continue;
    outputLines.push(`# From ${file}`);
    outputLines.push(content.trimEnd());
    outputLines.push("");
  }

  if (!outputLines.join("\n").includes("VITE_DESKTOP_MODE")) {
    outputLines.push("# Added by WebToApp");
    outputLines.push("VITE_DESKTOP_MODE=true");
  }

  await fs.writeFile(path.join(ctx.outputDir, ".env"), outputLines.join("\n").trimEnd() + "\n", "utf-8");
  ctx.log("info", "Generated .env with source values preserved", STAGE);
}

interface ResolvedIcon {
  sourcePath?: string;
  validDest?: string;
}

async function resolveAppIcon(ctx: PipelineContext): Promise<ResolvedIcon> {
  let sourcePath: string | undefined;
  let validDest: string | undefined;

  if (ctx.config.icon) {
    sourcePath = path.join(ctx.sourceDir, ctx.config.icon);
    validDest = path.extname(ctx.config.icon).toLowerCase() === ".ico" ? "assets/icon.ico" : "assets/icon.png";
  } else if (ctx.detection?.iconPath?.toLowerCase().endsWith(".png")) {
    sourcePath = path.join(ctx.sourceDir, ctx.detection.iconPath);
    validDest = "assets/icon.png";
  }

  if (sourcePath && validDest?.endsWith(".png")) {
    const dims = await getPngDimensions(sourcePath);
    if (dims && (dims.width < 256 || dims.height < 256)) {
      ctx.log(
        "warn",
        `App icon (${dims.width}x${dims.height}) is too small. Falling back to the default icon.`,
        STAGE,
      );
      return {};
    }
  }

  return { sourcePath, validDest };
}

async function copyAppIcon(ctx: PipelineContext, icon: ResolvedIcon): Promise<void> {
  if (!icon.sourcePath || !icon.validDest) {
    ctx.log("info", "No valid app icon found. electron-builder will use the default icon.", STAGE);
    return;
  }

  // Copy the base icon for electron-builder
  const destination = path.join(ctx.outputDir, icon.validDest);
  try {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(icon.sourcePath, destination);
    ctx.log("info", `Copied app icon: ${icon.validDest}`, STAGE);
  } catch {
    ctx.log("warn", "Could not copy app icon", STAGE);
    return;
  }

  // Generate all required icon sizes (Windows ICO, Android mipmaps, icon grid)
  const iconsOutDir = path.join(ctx.outputDir, "assets", "icons-generated");
  try {
    const result = await generateIcons(icon.sourcePath, iconsOutDir, {
      android:    ctx.config.targets.includes("android" as never),
      windowsIco: ctx.config.targets.includes("windows" as never),
      mac:        ctx.config.targets.includes("mac" as never),
      iconGrid:   true,
    });

    ctx.log(
      "info",
      `Icon generation complete (${result.files.length} files, ${result.highQuality ? "high quality" : "fallback mode"})`,
      STAGE
    );

    // Copy generated icon.ico to assets/icon.ico for Windows builds
    const generatedIco = path.join(iconsOutDir, "icon.ico");
    if (await fs.stat(generatedIco).then(s => s.isFile()).catch(() => false)) {
      await fs.copyFile(generatedIco, path.join(ctx.outputDir, "assets", "icon.ico"));
      ctx.log("info", "Copied generated icon.ico to assets/icon.ico", STAGE);
    }

    for (const warn of result.warnings) {
      ctx.log("warn", warn, STAGE);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.log("warn", `Icon generation failed (non-fatal): ${msg}`, STAGE);
  }
}

async function getPngDimensions(filePath: string): Promise<{ width: number; height: number } | null> {
  try {
    const handle = await fs.open(filePath, "r");
    const buffer = Buffer.alloc(24);
    await handle.read(buffer, 0, 24, 0);
    await handle.close();

    if (
      buffer[0] !== 0x89 ||
      buffer[1] !== 0x50 ||
      buffer[2] !== 0x4e ||
      buffer[3] !== 0x47 ||
      buffer[4] !== 0x0d ||
      buffer[5] !== 0x0a ||
      buffer[6] !== 0x1a ||
      buffer[7] !== 0x0a
    ) {
      return null;
    }

    return {
      width: buffer.readInt32BE(16),
      height: buffer.readInt32BE(20),
    };
  } catch {
    return null;
  }
}

/**
 * Copy runtime-only electron assets (update banner, offline page) from the
 * templates directory into the output electron/ folder so main.cjs can load
 * them at runtime via `path.join(__dirname, 'filename')`.
 *
 * These files are NOT part of the Handlebars generation pipeline (they don't
 * need per-app template vars) so they are copied as-is.
 */
async function copyElectronAssets(ctx: PipelineContext): Promise<void> {
  const templatesRoot = path.resolve(__dirname, "../../../../templates");
  const electronOutDir = path.join(ctx.outputDir, "electron");

  await fs.mkdir(electronOutDir, { recursive: true });

  const assets: Array<{ src: string; dest: string }> = [
    {
      src:  path.join(templatesRoot, "electron", "update-banner.js.hbs"),
      dest: path.join(electronOutDir, "update-banner.js"),
    },
    {
      src:  path.join(templatesRoot, "electron", "offline.html.hbs"),
      dest: path.join(electronOutDir, "offline.html"),
    },
  ];

  for (const { src, dest } of assets) {
    try {
      // These templates have no Handlebars vars — copy verbatim
      await fs.copyFile(src, dest);
      ctx.log("info", `Copied electron asset: ${path.basename(dest)}`, STAGE);
    } catch {
      ctx.log("warn", `Could not copy electron asset: ${path.basename(dest)}`, STAGE);
    }
  }
}

