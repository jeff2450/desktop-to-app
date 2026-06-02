import path from "node:path";
import fs from "node:fs/promises";
import Handlebars from "handlebars";
import { fileURLToPath } from "node:url";

import type { PipelineContext } from "../PipelineContext.js";
import type { FileGeneratePlan } from "../../types/MigrationPlan.js";

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
      await patchPackageJson(ctx);
      await generateCleanEnv(ctx);
      await copyAppIcon(ctx, icon);
    } else {
      ctx.log("info", "[DRY-RUN] Would patch package.json", STAGE);
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

  pkg.main = "electron/main.cjs";
  pkg.author ??= ctx.config.author ?? "WebToApp Conversion";

  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2), "utf-8");
  ctx.log("info", "Patched package.json using migration plan", STAGE);
}

function isElectronDevDependency(name: string): boolean {
  return name === "electron" || name === "electron-builder" || name === "concurrently" || name === "wait-on";
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
  };

  const relativePath = templateMap[generatorType];
  if (!relativePath) throw new Error(`No template mapping for ${generatorType}`);

  const templatesRoot = path.resolve(__dirname, "../../../../packages/templates");
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
    default:
      return `// Generated by WebToApp - ${plan.generatorType}\n`;
  }
}

function generateElectronMain(vars: Record<string, unknown>): string {
  const appName = String(vars["appName"] ?? "App");
  const devPort = Number(vars["devPort"] ?? 5173);

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
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: '${appName}',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f0f0f' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
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
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    const hasExtension = /\\.\\w+$/.test(pathname);
    let filePath = path.join(__dirname, '../dist', pathname);

    if (!hasExtension || !fs.existsSync(filePath)) {
      filePath = path.join(__dirname, '../dist/index.html');
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
  icon: ${icon}
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

  const destination = path.join(ctx.outputDir, icon.validDest);
  try {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(icon.sourcePath, destination);
    ctx.log("info", `Copied app icon: ${icon.validDest}`, STAGE);
  } catch {
    ctx.log("warn", "Could not copy app icon", STAGE);
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
