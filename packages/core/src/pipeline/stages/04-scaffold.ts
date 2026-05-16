import path from "node:path";
import fs from "node:fs/promises";
import Handlebars from "handlebars";

import type { PipelineContext } from "../PipelineContext.js";
import type { FileGeneratePlan } from "../../types/MigrationPlan.js";

import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STAGE = "04-scaffold";

/**
 * Stage 04 — Scaffold
 *
 * Generates all new files listed in ctx.plan.filesToGenerate using
 * Handlebars templates from the @webtoapp/templates package.
 *
 * Files generated include:
 *  - electron/main.js        (Electron main process)
 *  - electron/preload.js     (context bridge)
 *  - electron-builder.yml    (installer config)
 *  - backend/server.js       (Express server)
 *  - backend/database.js     (SQLite setup)
 *  - backend/auth.js         (JWT auth)
 *  - backend/routes/*.js     (CRUD routes per table)
 *  - src/lib/localApi.ts     (typed frontend API client)
 *
 * Templates live in packages/templates/ — generated in Session 3.
 * This stage provides fallback inline templates so the pipeline works
 * end-to-end even before Session 3 templates are built.
 */
export async function runScaffoldStage(ctx: PipelineContext): Promise<void> {
  ctx.startStage(STAGE);

  if (!ctx.plan) {
    const err = new Error("Migration plan missing — stage 02 must run first");
    ctx.failStage(STAGE, err);
    throw err;
  }

  try {
    const { filesToGenerate } = ctx.plan;
    let generated = 0;

    let validIconDest: string | undefined;
    if (ctx.config.icon) {
      const ext = path.extname(ctx.config.icon).toLowerCase();
      validIconDest = ext === ".ico" ? "assets/icon.ico" : "assets/icon.png";
    } else if (ctx.detection?.iconPath && ctx.detection.iconPath.toLowerCase().endsWith(".png")) {
      validIconDest = "assets/icon.png";
    }

    for (const filePlan of filesToGenerate) {
      const outputPath = path.join(ctx.outputDir, filePlan.outputPath);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });

      if (ctx.dryRun) {
        ctx.log("info", `[DRY-RUN] Would generate: ${filePlan.outputPath}`, STAGE);
        generated++;
        continue;
      }

      // Inject detected tableColumns into sqlite-database template vars
      if (filePlan.generatorType === "sqlite-database" && ctx.detection?.tableColumns) {
        (filePlan.templateVars as Record<string, unknown>)["tableColumns"] =
          ctx.detection.tableColumns;
      }
      
      if (filePlan.generatorType === "electron-builder-config" && validIconDest) {
        (filePlan.templateVars as Record<string, unknown>)["icon"] = validIconDest;
      }

      const content = await generateFile(filePlan, ctx);
      await fs.writeFile(outputPath, content, "utf-8");

      ctx.log("info", `Generated: ${filePlan.outputPath}`, STAGE);
      generated++;
    }

    // Ensure syncEngine.ts is deleted if not in hybrid mode
    if (ctx.config.mode !== "hybrid" && !ctx.dryRun) {
      try {
        await fs.rm(path.join(ctx.outputDir, "src/lib/syncEngine.ts"), { force: true });
        await fs.rm(path.join(ctx.outputDir, "src/hooks/useOnlineStatus.ts"), { force: true });
      } catch {}
    }

    // ── Patch package.json ─────────────────────────────────────────
    if (!ctx.dryRun) await patchPackageJson(ctx);
    else ctx.log("info", "[DRY-RUN] Would patch package.json", STAGE);

    // ── Improvement #5: Generate clean .env ───────────────────────
    if (!ctx.dryRun) await generateCleanEnv(ctx);
    else ctx.log("info", "[DRY-RUN] Would generate clean .env", STAGE);

    // ── Improvement #6: Copy auto-detected icon ───────────────────
    if (!ctx.dryRun) await copyAppIcon(ctx);

    ctx.log("info", `Scaffolded ${generated} files`, STAGE);
    ctx.completeStage(STAGE);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    ctx.failStage(STAGE, error);
    throw error;
  }
}

/**
 * Updates the output package.json with necessary scripts and dependencies
 * for Electron and the local Express backend.
 *
 * Fixes applied here:
 *  #2 — electron must live in devDependencies (electron-builder requirement)
 *  #3 — author field is required by electron-builder
 *  #4 — vite-plugin-pwa is web-only and breaks in Electron environments
 */
/** Minimal shape of a package.json we read from the output project */
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
  let pkg: PackageJson = {};

  try {
    const raw = await fs.readFile(pkgPath, "utf-8");
    pkg = JSON.parse(raw) as PackageJson;
  } catch {
    ctx.log("warn", "Could not read output package.json — creating new one", STAGE);
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

  // Ensure sections exist
  pkg.dependencies = pkg.dependencies || {};
  pkg.devDependencies = pkg.devDependencies || {};
  pkg.scripts = pkg.scripts || {};

  // ── Apply plan dependencies ──────────────────────────────────
  if (ctx.plan) {
    for (const [name, version] of Object.entries(ctx.plan.dependenciesToAdd)) {
      // Determine if it should be a devDep
      if (name === "electron" || name === "electron-builder" || name === "concurrently" || name === "wait-on") {
        pkg.devDependencies[name] = version;
      } else {
        pkg.dependencies[name] = version;
      }
    }

    for (const name of ctx.plan.dependenciesToRemove) {
      delete pkg.dependencies[name];
      delete pkg.devDependencies[name];
    }

    // ── Add scripts ───────────────────────────────────────────────
    for (const [name, script] of Object.entries(ctx.plan.scriptsToInject)) {
      pkg.scripts[name] = script;
    }
  }

  // ── Error #2 Fix: electron MUST be in devDependencies ─────────
  // electron-builder rejects builds where electron is a runtime dep.
  const electronDevOnlyPackages = ["electron", "electron-builder", "electron-rebuild", "@electron/rebuild"];
  for (const pkg_name of electronDevOnlyPackages) {
    if (pkg.dependencies[pkg_name]) {
      pkg.devDependencies[pkg_name] = pkg.dependencies[pkg_name];
      delete pkg.dependencies[pkg_name];
      ctx.log("info", `Moved ${pkg_name} from dependencies → devDependencies`, STAGE);
    }
  }

  // ── Error #3 Fix: electron-builder requires an author field ───
  if (!pkg.author) {
    pkg.author = ctx.config.author ?? "WebToApp Conversion";
    ctx.log("info", "Added missing author field to package.json", STAGE);
  }

  // ── Error #4 Fix: remove vite-plugin-pwa (web-only, breaks Electron) ──
  // Service workers are not supported in Electron. Remove the dep so that
  // the vite build does not try to import it.
  const pwaPlugins = ["vite-plugin-pwa", "@vite-pwa/assets-generator", "workbox-window", "workbox-precaching"];
  for (const p of pwaPlugins) {
    if (pkg.dependencies[p]) {
      delete pkg.dependencies[p];
      ctx.log("info", `Removed web-only package from dependencies: ${p}`, STAGE);
    }
    if (pkg.devDependencies[p]) {
      delete pkg.devDependencies[p];
      ctx.log("info", `Removed web-only package from devDependencies: ${p}`, STAGE);
    }
  }

  // Set main to electron entry point
  pkg.main = "electron/main.cjs";

  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2), "utf-8");
  ctx.log("info", "Patched package.json using migration plan", STAGE);
}

// ─── File generator ───────────────────────────────────────────────────────────

async function generateFile(plan: FileGeneratePlan, ctx: PipelineContext): Promise<string> {
  // Try to load from @webtoapp/templates first (Session 3)
  // Fall back to inline templates if the package isn't built yet
  try {
    const templateContent = await loadTemplate(plan.generatorType, ctx);
    const compiled = Handlebars.compile(templateContent);
    return compiled(plan.templateVars);
  } catch {
    // Use inline fallback templates
    return generateInline(plan);
  }
}

async function loadTemplate(
  generatorType: FileGeneratePlan["generatorType"],
  ctx: PipelineContext
): Promise<string> {
  const templateMap: Record<string, string> = {
    "electron-main": "electron/main.js.hbs",
    "electron-preload": "electron/preload.js.hbs",
    "electron-builder-config": "electron/electron-builder.yml.hbs",
    "express-server": "backend/server.js.hbs",
    "sqlite-database": "backend/database.js.hbs",
    "jwt-auth": "backend/auth.js.hbs",
    "crud-routes": "backend/routes/crud.js.hbs",
    "local-api-client": "localApi/localApi.ts.hbs",
  };

  const relativePath = templateMap[generatorType];
  if (!relativePath) throw new Error(`No template mapping for ${generatorType}`);

  // Resolve template from packages/templates relative to this compiled file
  // e.g. packages/core/dist/pipeline/stages/ → ../../../../packages/templates
  const templatesRoot = path.resolve(__dirname, "../../../../packages/templates");
  return fs.readFile(path.join(templatesRoot, relativePath), "utf-8");
}

// ─── Inline fallback templates ────────────────────────────────────────────────

function generateInline(plan: FileGeneratePlan): string {
  const vars = plan.templateVars as Record<string, unknown>;

  switch (plan.generatorType) {
    case "electron-main":
      return generateElectronMain(vars);
    case "electron-preload":
      return generateElectronPreload();
    case "electron-builder-config":
      return generateElectronBuilderConfig(vars);
    case "express-server":
      return generateExpressServer(vars);
    case "sqlite-database":
      return generateSqliteDatabase(vars);
    case "jwt-auth":
      return generateJwtAuth(vars);
    case "crud-routes":
      return generateCrudRoutes(vars);
    case "local-api-client":
      return generateLocalApiClient(vars);
    case "sync-engine":
      return generateSyncEngine(vars);
    case "online-status-hook":
      return generateOnlineStatusHook();
    default:
      return `// Generated by WebToApp — ${plan.generatorType}\n`;
  }
}

function generateElectronMain(vars: Record<string, unknown>): string {
  const appName = vars["appName"] as string ?? "App";
  const devPort = vars["devPort"] as number ?? 5173;
  const backendPort = vars["backendPort"] as number ?? 3001;
  const isOnlineMode = !backendPort || backendPort === 0;

  if (isOnlineMode) {
    // ── Online mode: no local backend — load app directly, no waitForBackend() freeze
    return `const { app, BrowserWindow, shell, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');

// Register app:// as a privileged scheme BEFORE app is ready.
// This lets the renderer make fetch() calls without mixed-content blocking.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
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
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:${devPort}');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadURL('app://./index.html');
  }

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url: u }) => {
    if (u.startsWith('http')) shell.openExternal(u);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  // Serve dist/ via app:// — enables fetch() to cloud APIs without CORS issues
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    let filePath = path.join(__dirname, '../dist', url.pathname === '/' ? 'index.html' : url.pathname);
    if (!fs.existsSync(filePath)) filePath = path.join(__dirname, '../dist/index.html');
    return net.fetch('file://' + filePath);
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
`;
  }

  // ── Offline / hybrid mode: start local Express backend, wait for it, then open window
  return `const { app, BrowserWindow, shell, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// Register app:// as a privileged scheme BEFORE app is ready.
// This lets the renderer fetch http://127.0.0.1 without being blocked
// as mixed content — the root cause of the blank white screen.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
let mainWindow;
let backendProcess;

function startBackend() {
  const serverPath = isDev
    ? path.join(__dirname, '../backend/server.cjs')
    : path.join(process.resourcesPath, 'backend/server.cjs');

  // Use process.execPath so the backend runs on machines without Node.js installed.
  // ELECTRON_RUN_AS_NODE=1 makes the Electron binary act as a plain Node process.
  backendProcess = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      PORT: '${backendPort}',
      NODE_ENV: isDev ? 'development' : 'production',
      ELECTRON_RUN_AS_NODE: '1',
    },
    stdio: isDev ? 'inherit' : 'pipe',
  });

  backendProcess.on('error', (err) => console.error('[WebToApp] Backend failed to start:', err));
  if (!isDev && backendProcess.stdout) {
    backendProcess.stdout.on('data', (d) => console.log('[backend]', d.toString().trim()));
  }
}

// Poll /api/health until Express is ready, instead of using a blind setTimeout.
async function waitForBackend(maxWaitMs = 10000, intervalMs = 200) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch('http://127.0.0.1:${backendPort}/api/health');
      if (res.ok) return;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  console.error('[WebToApp] Backend did not become ready within', maxWaitMs, 'ms');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: '${appName}',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:${devPort}');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadURL('app://./index.html'); // use app:// not file:// to allow backend fetch
  }

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Open external links in the OS browser, not Electron
  mainWindow.webContents.setWindowOpenHandler(({ url: u }) => {
    if (u.startsWith('http')) shell.openExternal(u);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  // Serve dist/ via app:// protocol — must be registered before any window loads
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    let filePath = path.join(__dirname, '../dist', url.pathname === '/' ? 'index.html' : url.pathname);
    if (!fs.existsSync(filePath)) filePath = path.join(__dirname, '../dist/index.html');
    return net.fetch('file://' + filePath);
  });

  startBackend();
  await waitForBackend(); // wait for Express before opening the window

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (backendProcess) backendProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (backendProcess) backendProcess.kill();
});
`;
}

  return `const { app, BrowserWindow, shell, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// Register app:// as a privileged scheme BEFORE app is ready.
// This lets the renderer fetch http://127.0.0.1 without being blocked
// as mixed content — the root cause of the blank white screen.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
let mainWindow;
let backendProcess;

function startBackend() {
  const serverPath = isDev
    ? path.join(__dirname, '../backend/server.cjs')
    : path.join(process.resourcesPath, 'backend/server.cjs');

  // Use process.execPath so the backend runs on machines without Node.js installed.
  // ELECTRON_RUN_AS_NODE=1 makes the Electron binary act as a plain Node process.
  backendProcess = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      PORT: '${backendPort}',
      NODE_ENV: isDev ? 'development' : 'production',
      ELECTRON_RUN_AS_NODE: '1',
    },
    stdio: isDev ? 'inherit' : 'pipe',
  });

  backendProcess.on('error', (err) => console.error('[WebToApp] Backend failed to start:', err));
  if (!isDev && backendProcess.stdout) {
    backendProcess.stdout.on('data', (d) => console.log('[backend]', d.toString().trim()));
  }
}

// Poll /api/health until Express is ready, instead of using a blind setTimeout.
async function waitForBackend(maxWaitMs = 10000, intervalMs = 200) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch('http://127.0.0.1:${backendPort}/api/health');
      if (res.ok) return;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  console.error('[WebToApp] Backend did not become ready within', maxWaitMs, 'ms');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: '${appName}',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:${devPort}');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadURL('app://./index.html'); // use app:// not file:// to allow backend fetch
  }

  // Open external links in the OS browser, not Electron
  mainWindow.webContents.setWindowOpenHandler(({ url: u }) => {
    if (u.startsWith('http')) shell.openExternal(u);
    return { action: 'deny' };
  });
}

app.whenReady().then(async () => {
  // Serve dist/ via app:// protocol — must be registered before any window loads
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    let filePath = path.join(__dirname, '../dist', url.pathname === '/' ? 'index.html' : url.pathname);
    if (!fs.existsSync(filePath)) filePath = path.join(__dirname, '../dist/index.html');
    return net.fetch('file://' + filePath);
  });

  startBackend();
  await waitForBackend(); // wait for Express before opening the window

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (backendProcess) backendProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (backendProcess) backendProcess.kill();
});
`;
}

function generateElectronPreload(): string {
  return `const { contextBridge, ipcRenderer } = require('electron');

/**
 * Expose a minimal, safe API to the renderer process.
 * The renderer accesses window.electronAPI to interact with Electron APIs.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
  // Add custom IPC channels here as needed
  send: (channel, data) => {
    const allowedChannels = ['app:minimize', 'app:maximize', 'app:close'];
    if (allowedChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  on: (channel, callback) => {
    const allowedChannels = ['app:update-available'];
    if (allowedChannels.includes(channel)) {
      ipcRenderer.on(channel, (_event, ...args) => callback(...args));
    }
  },
});
`;
}

function generateElectronBuilderConfig(vars: Record<string, unknown>): string {
  const appId = vars["appId"] as string ?? "com.webtoapp.app";
  const appName = vars["appName"] as string ?? "App";
  const targets = vars["targets"] as string[] ?? ["windows"];
  const icon = vars["icon"] as string | undefined;

  const iconLine = icon ? `  icon: ${icon}\n` : "";

  const winSection = targets.includes("windows") ? `
win:
  target:
    - target: nsis
      arch: [x64]
${iconLine}nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true` : "";

  const linuxSection = targets.includes("linux") ? `
linux:
  target:
    - target: AppImage
      arch: [x64]
    - target: deb
      arch: [x64]
${iconLine}  category: Utility` : "";

  const macSection = targets.includes("mac") ? `
mac:
  target:
    - target: dmg
      arch: [x64, arm64]
${iconLine}  hardenedRuntime: true
  entitlements: build/entitlements.mac.plist` : "";

  return `appId: ${appId}
productName: ${appName}
copyright: Copyright © 2024

directories:
  output: release
  buildResources: assets

files:
  - dist/**/*
  - electron/**/*
  - backend/**/*
  - package.json

extraResources:
  - from: backend/
    to: backend/
    filter:
      - "**/*"
${winSection}${linuxSection}${macSection}

publish:
  provider: generic
  url: https://your-update-server.com/updates/
`;
}

function generateExpressServer(vars: Record<string, unknown>): string {
  const port = vars["port"] as number ?? 3001;
  const tables = vars["tables"] as string[] ?? [];
  const appName = vars["appName"] as string ?? "App";

  const routeImports = tables
    .map((t) => `const ${t}Router = require('./routes/${t}.cjs');`)
    .join("\n");

  const routeUses = tables
    .map((t) => `app.use('/api/${t}', ${t}Router);`)
    .join("\n");

  return `/**
 * Local Express backend — generated by WebToApp
 * Replaces cloud backend (Supabase/Firebase) with local SQLite + REST API
 */
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase } = require('./database.cjs');
const authRouter = require('./auth.cjs');
${routeImports}

const app = express();
const PORT = process.env.PORT || ${port};

// Middleware
app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:3000', 'file://'] }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve local storage files
app.use('/storage', express.static(path.join(__dirname, 'storage')));

// Auth routes
app.use('/api/auth', authRouter);

// Table routes
${routeUses}

// Health check
app.get('/api/health', (_req, res) => res.json({ status: 'ok', app: '${appName}' }));

// 404 handler
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// Error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message ?? 'Internal server error' });
});

// Start
async function start() {
  await initDatabase();
  app.listen(PORT, '127.0.0.1', () => {
    console.log(\`[WebToApp backend] Listening on http://127.0.0.1:\${PORT}\`);
  });
}

start().catch((err) => {
  console.error('Failed to start backend:', err);
  process.exit(1);
});
`;
}

function generateSqliteDatabase(vars: Record<string, unknown>): string {
  const tables = vars["tables"] as string[] ?? [];
  const tableColumns = vars["tableColumns"] as Record<string, Array<{ name: string; type: string; nullable: boolean; primaryKey: boolean; defaultValue?: string }>> | undefined;

  /**
   * Improvement #3: Use detected column definitions when available.
   * Falls back to the generic data TEXT blob column only when no schema info exists.
   */
  const createTables = tables.map((t) => {
    const cols = tableColumns?.[t];

    if (cols && cols.length > 0) {
      // Build columns from the detected schema
      const colDefs = cols.map((col) => {
        let def = `      ${col.name} ${col.type}`;
        if (col.primaryKey) def += " PRIMARY KEY";
        if (!col.nullable && !col.primaryKey) def += " NOT NULL";
        if (col.defaultValue) def += ` DEFAULT ${col.defaultValue}`;
        if (col.name === "created_at") def += " DEFAULT (datetime('now'))";
        if (col.name === "updated_at") def += " DEFAULT (datetime('now'))";
        return def;
      }).join(",\n");

      return `
  db.exec(\`
    CREATE TABLE IF NOT EXISTS ${t} (
${colDefs}
    )
  \`);`;
    }

    // Generic fallback — proper base schema with id, timestamps, and auto-update trigger
    return `
  db.exec(\`
    CREATE TABLE IF NOT EXISTS ${t} (
      id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  \`);
  db.exec(\`
    CREATE TRIGGER IF NOT EXISTS ${t}_updated_at
      AFTER UPDATE ON ${t}
      BEGIN
        UPDATE ${t} SET updated_at = datetime('now') WHERE id = NEW.id;
      END
  \`);`;
  }).join("\n");

  return `/**
 * SQLite database setup — generated by WebToApp
 * Uses better-sqlite3 for synchronous, zero-config local storage.
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let db;

function getDbPath() {
  // In Electron, store in userData. In dev, use local .data/ folder.
  if (process.versions.electron) {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'database.db');
  }
  const dataDir = path.join(__dirname, '../.data');
  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, 'database.db');
}

function initDatabase() {
  const dbPath = getDbPath();
  db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create tables
  ${createTables || "// No tables detected — add your CREATE TABLE statements here"}

  console.log('[WebToApp] Database ready at', dbPath);
  return db;
}

function getDb() {
  if (!db) throw new Error('Database not initialised — call initDatabase() first');
  return db;
}

module.exports = { initDatabase, getDb };
`;
}

function generateJwtAuth(vars: Record<string, unknown>): string {
  const defaultAdmin = vars["defaultAdmin"] as string ?? "admin@app.local";

  return `/**
 * JWT authentication module — generated by WebToApp
 * Provides local sign-in, session management, and middleware for the Express backend.
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('./database.cjs');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || require('crypto').randomBytes(32).toString('hex');
const TOKEN_EXPIRY = '7d';
const GENERATED_PASSWORD = require('crypto').randomBytes(8).toString('hex');

// Ensure users table exists and seed default admin
function ensureUsersTable() {
  const db = getDb();
  db.exec(\`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      created_at TEXT DEFAULT (datetime('now'))
    )
  \`);

  const admin = db.prepare('SELECT id FROM users WHERE email = ?').get('${defaultAdmin}');
  if (!admin) {
    const hash = bcrypt.hashSync(GENERATED_PASSWORD, 10);
    db.prepare(
      'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)'
    ).run('${defaultAdmin}', hash, 'admin');
    console.log(\`[WebToApp] Default admin created: ${defaultAdmin} / \${GENERATED_PASSWORD}\`);
    console.log('[WebToApp] ⚠️  Save this password — it is shown only once.');
  }
}

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, {
    expiresIn: TOKEN_EXPIRY,
  });

  res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
});

// POST /api/auth/register
router.post('/register', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const db = getDb();
  try {
    const result = db.prepare(
      'INSERT INTO users (email, password_hash) VALUES (?, ?)'
    ).run(email, hash);
    res.status(201).json({ id: result.lastInsertRowid, email });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    throw err;
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// POST /api/auth/logout — stateless JWT, just signal the client
router.post('/logout', (_req, res) => res.json({ success: true }));

// ─── Middleware ───────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

ensureUsersTable();

module.exports = router;
module.exports.requireAuth = requireAuth;
`;
}

function generateCrudRoutes(vars: Record<string, unknown>): string {
  const table = vars["table"] as string ?? "items";
  // Extract policies from variables passed in by 02-plan.ts
  const policies = vars["policies"] as import('../../types/DetectionResult.js').RlsPolicy[] | undefined;

  let requireAuthImport = "";
  let authMiddleware = "";
  let getCondition = "";
  let getIdCondition = "";
  let getIdParams = "";
  let postInject = "";
  let putCondition = "";
  let putParams = "";
  let deleteCondition = "";
  let deleteParams = "";

  if (policies?.some((p) => p.isOwnerOnly)) {
    const policy = policies.find((p) => p.isOwnerOnly)!;
    const col = policy.ownerColumn || "user_id";

    requireAuthImport = "\nconst { requireAuth } = require('../auth.cjs');";
    authMiddleware = "requireAuth, ";

    getCondition = `\n  // RLS Enforcement: Only return rows owned by the current user
  conditions.push('${col} = ?');
  params.push(req.user.id);`;

    getIdCondition = ` AND ${col} = ?`;
    getIdParams = `, req.user.id`;

    postInject = `
  // RLS Enforcement: Force ownership of newly inserted rows
  for (const row of rows) row.${col} = req.user.id;`;

    putCondition = ` AND ${col} = ?`;
    putParams = `, req.user.id`;

    deleteCondition = ` AND ${col} = ?`;
    deleteParams = `, req.user.id`;
  }

  return `/**
 * CRUD routes for '${table}' — generated by WebToApp
 * Mirrors the Supabase PostgREST interface so the frontend localApi client
 * can call these routes the same way it called Supabase.
 */
const express = require('express');
const { getDb } = require('../database.cjs');${requireAuthImport}

const router = express.Router();

// GET /api/${table} — list all rows (supports ?column=value filters)
router.get('/', ${authMiddleware}(req, res) => {
  const db = getDb();
  const { limit = 1000, offset = 0, order, ...filters } = req.query;

  let query = \`SELECT * FROM ${table}\`;
  const params = [];
  const conditions = Object.entries(filters).map(([col, val]) => {
    params.push(val);
    return \`\${col} = ?\`;
  });${getCondition}

  if (conditions.length) query += \` WHERE \${conditions.join(' AND ')}\`;
  if (order) query += \` ORDER BY \${order.replace(/[^a-zA-Z0-9_,.]/g, '')}\`;
  query += \` LIMIT ? OFFSET ?\`;
  params.push(limit, offset);

  const rows = db.prepare(query).all(...params);
  res.json({ data: rows, error: null });
});

// GET /api/${table}/:id — get one row
router.get('/:id', ${authMiddleware}(req, res) => {
  const db = getDb();
  const row = db.prepare(\`SELECT * FROM ${table} WHERE id = ?${getIdCondition}\`).get(req.params.id${getIdParams});
  if (!row) return res.status(404).json({ data: null, error: 'Not found' });
  res.json({ data: row, error: null });
});

// POST /api/${table} — insert row(s)
router.post('/', ${authMiddleware}(req, res) => {
  const db = getDb();
  const rows = Array.isArray(req.body) ? req.body : [req.body];
  const inserted = [];${postInject}

  const insertOne = db.transaction((row) => {
    const id = row.id ?? crypto.randomUUID();
    const cols = Object.keys(row);
    const placeholders = cols.map(() => '?').join(', ');
    const vals = cols.map((c) => row[c]);

    db.prepare(
      \`INSERT INTO ${table} (id, \${cols.join(', ')}) VALUES (?, \${placeholders})\`
    ).run(id, ...vals);

    return db.prepare('SELECT * FROM ${table} WHERE id = ?').get(id);
  });

  for (const row of rows) inserted.push(insertOne(row));
  res.status(201).json({ data: inserted.length === 1 ? inserted[0] : inserted, error: null });
});

// PUT /api/${table}/:id — update row
router.put('/:id', ${authMiddleware}(req, res) => {
  const db = getDb();
  const cols = Object.keys(req.body);
  if (!cols.length) return res.status(400).json({ error: 'No fields to update' });

  const setClauses = cols.map((c) => \`\${c} = ?\`).join(', ');
  const vals = cols.map((c) => req.body[c]);

  db.prepare(
    \`UPDATE ${table} SET \${setClauses}, updated_at = datetime('now') WHERE id = ?${putCondition}\`
  ).run(...vals, req.params.id${putParams});

  const updated = db.prepare('SELECT * FROM ${table} WHERE id = ?').get(req.params.id);
  res.json({ data: updated, error: null });
});

// DELETE /api/${table}/:id — delete row
router.delete('/:id', ${authMiddleware}(req, res) => {
  const db = getDb();
  db.prepare(\`DELETE FROM ${table} WHERE id = ?${deleteCondition}\`).run(req.params.id${deleteParams});
  res.json({ data: null, error: null });
});

// POST /api/${table}/upsert — upsert row(s)
router.post('/upsert', ${authMiddleware}(req, res) => {
  const db = getDb();
  const rows = Array.isArray(req.body) ? req.body : [req.body];
  const upserted = [];${postInject}

  const upsertOne = db.transaction((row) => {
    const id = row.id ?? crypto.randomUUID();
    const cols = Object.keys(row);
    const placeholders = cols.map(() => '?').join(', ');
    const setClauses = cols.map((c) => \`\${c} = excluded.\${c}\`).join(', ');

    db.prepare(
      \`INSERT INTO ${table} (id, \${cols.join(', ')}) VALUES (?, \${placeholders})
       ON CONFLICT(id) DO UPDATE SET \${setClauses}, updated_at = datetime('now')\`
    ).run(id, ...cols.map((c) => row[c]));

    return db.prepare('SELECT * FROM ${table} WHERE id = ?').get(id);
  });

  for (const row of rows) upserted.push(upsertOne(row));
  res.json({ data: upserted.length === 1 ? upserted[0] : upserted, error: null });
});

module.exports = router;
`;
}

function generateLocalApiClient(vars: Record<string, unknown>): string {
  const port = vars["port"] as number ?? 3001;
  const tables = vars["tables"] as string[] ?? [];

  return `/**
 * localApi — generated by WebToApp
 *
 * Drop-in replacement for the Supabase client.
 * Calls the local Express backend instead of Supabase cloud.
 *
 * Usage is identical to the Supabase client:
 *   const { data, error } = await localApi.from('users').select()
 *   const { data, error } = await localApi.from('posts').insert({ title })
 *   await localApi.auth.signIn({ email, password })
 */

const BASE_URL = \`http://127.0.0.1:${port}\`;

function getToken(): string | null {
  return localStorage.getItem('webtoapp_token');
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: \`Bearer \${token}\` } : {};
}

async function apiFetch<T>(
  url: string,
  options?: RequestInit
): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await fetch(\`\${BASE_URL}\${url}\`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
        ...(options?.headers ?? {}),
      },
    });

    const json = await res.json();
    if (!res.ok) return { data: null, error: json.error ?? \`HTTP \${res.status}\` };
    return { data: json.data ?? json, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Network error' };
  }
}

// ─── Query builder ────────────────────────────────────────────────────────────

class QueryBuilder<T = unknown> {
  private _table: string;
  private _filters: Record<string, unknown> = {};
  private _single = false;
  private _method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET';
  private _body?: unknown;
  private _id?: string;
  private _upsert = false;

  constructor(table: string) {
    this._table = table;
  }

  select(_columns?: string): this {
    this._method = 'GET';
    return this;
  }

  eq(column: string, value: unknown): this {
    this._filters[column] = value;
    if (column === 'id') this._id = String(value);
    return this;
  }

  single(): this {
    this._single = true;
    return this;
  }

  insert(data: Partial<T> | Partial<T>[]): this {
    this._method = 'POST';
    this._body = data;
    return this;
  }

  update(data: Partial<T>): this {
    this._method = 'PUT';
    this._body = data;
    return this;
  }

  upsert(data: Partial<T> | Partial<T>[]): this {
    this._method = 'POST';
    this._body = data;
    this._upsert = true;
    return this;
  }

  delete(): this {
    this._method = 'DELETE';
    return this;
  }

  async then(
    resolve: (value: { data: T | T[] | null; error: string | null }) => void,
    reject?: (reason?: unknown) => void
  ): Promise<void> {
    try {
      const result = await this._execute();
      resolve(result);
    } catch (err) {
      reject?.(err);
    }
  }

  private async _execute(): Promise<{ data: T | T[] | null; error: string | null }> {
    let url = \`/api/\${this._table}\`;

    if (this._method === 'GET') {
      const params = new URLSearchParams(
        Object.fromEntries(Object.entries(this._filters).map(([k, v]) => [k, String(v)]))
      );
      if (this._id) {
        url += \`/\${this._id}\`;
      } else if (params.toString()) {
        url += \`?\${params}\`;
      }
      return apiFetch<T | T[]>(url);
    }

    if (this._method === 'DELETE' && this._id) {
      return apiFetch<T>(url + \`/\${this._id}\`, { method: 'DELETE' });
    }

    if (this._method === 'PUT' && this._id) {
      return apiFetch<T>(url + \`/\${this._id}\`, {
        method: 'PUT',
        body: JSON.stringify(this._body),
      });
    }

    if (this._method === 'POST') {
      const endpoint = this._upsert ? url + '/upsert' : url;
      return apiFetch<T | T[]>(endpoint, {
        method: 'POST',
        body: JSON.stringify(this._body),
      });
    }

    return { data: null, error: 'Unknown operation' };
  }
}

// ─── Auth API ─────────────────────────────────────────────────────────────────

const auth = {
  async signInWithPassword({ email, password }: { email: string; password: string }) {
    const result = await apiFetch<{ token: string; user: unknown }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (result.data && 'token' in (result.data as Record<string, unknown>)) {
      const d = result.data as { token: string; user: unknown };
      localStorage.setItem('webtoapp_token', d.token);
      return { data: { session: { access_token: d.token }, user: d.user }, error: null };
    }
    return { data: null, error: result.error };
  },

  async signUp({ email, password }: { email: string; password: string }) {
    return apiFetch('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  async signOut() {
    localStorage.removeItem('webtoapp_token');
    return { error: null };
  },

  async getSession() {
    const token = getToken();
    if (!token) return { data: { session: null }, error: null };
    const result = await apiFetch<unknown>('/api/auth/me');
    return result.error
      ? { data: { session: null }, error: result.error }
      : { data: { session: { access_token: token, user: result.data } }, error: null };
  },

  async getUser() {
    const result = await apiFetch<unknown>('/api/auth/me');
    return { data: { user: result.data }, error: result.error };
  },

  onAuthStateChange(callback: (event: string, session: unknown) => void) {
    // Simplified — fires once on load
    this.getSession().then(({ data }) => {
      callback(data.session ? 'SIGNED_IN' : 'SIGNED_OUT', data.session);
    });
    return { data: { subscription: { unsubscribe: () => {} } } };
  },
};

// ─── Storage API ──────────────────────────────────────────────────────────────

const storage = {
  from(bucket: string) {
    return {
      async upload(filePath: string, file: File) {
        const form = new FormData();
        form.append('file', file);
        form.append('path', filePath);
        const res = await fetch(\`\${BASE_URL}/api/storage/\${bucket}\`, {
          method: 'POST',
          headers: authHeaders(),
          body: form,
        });
        const json = await res.json();
        return { data: json, error: res.ok ? null : json.error };
      },
      async download(filePath: string) {
        const res = await fetch(\`\${BASE_URL}/api/storage/\${bucket}/\${filePath}\`, {
          headers: authHeaders(),
        });
        if (!res.ok) return { data: null, error: \`HTTP \${res.status}\` };
        return { data: await res.blob(), error: null };
      },
      getPublicUrl(filePath: string) {
        return { data: { publicUrl: \`\${BASE_URL}/storage/\${bucket}/\${filePath}\` } };
      },
      async remove(paths: string[]) {
        const results = await Promise.all(
          paths.map((p) =>
            fetch(\`\${BASE_URL}/api/storage/\${bucket}/\${p}\`, {
              method: 'DELETE',
              headers: authHeaders(),
            })
          )
        );
        const errors = results.filter((r) => !r.ok);
        return { data: paths, error: errors.length > 0 ? 'Some deletions failed' : null };
      },
      async list(folder?: string) {
        const url = folder
          ? \`\${BASE_URL}/api/storage/\${bucket}?folder=\${folder}\`
          : \`\${BASE_URL}/api/storage/\${bucket}\`;
        const res = await fetch(url, { headers: authHeaders() });
        const json = await res.json();
        return { data: json, error: res.ok ? null : json.error };
      },
    };
  },
};

// ─── Subscribe (replaces Supabase Realtime) ───────────────────────────────────

function subscribe(table: string, callback: (payload: unknown) => void) {
  const url = \`\${BASE_URL}/api/\${table}/subscribe\`;
  const es = new EventSource(url);
  es.onmessage = (e) => callback(JSON.parse(e.data));
  es.onerror = () => es.close();
  return { unsubscribe: () => es.close() };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const localApi = {
  from<T = unknown>(table: string): QueryBuilder<T> {
    return new QueryBuilder<T>(table);
  },
  auth,
  storage,
  subscribe,
};

export default localApi;

// Supported tables: ${tables.join(", ") || "none detected"}
`;
}

// ─── Hybrid mode generators ───────────────────────────────────────────────────

function generateSyncEngine(vars: Record<string, unknown>): string {
  const backend = vars["backend"] as string ?? "supabase";
  const tables  = vars["tables"]  as string[] ?? [];
  const port    = vars["port"]    as number ?? 3001;

  const tableList = tables.map((t) => `'${t}'`).join(", ");

  return `/**
 * syncEngine.ts — generated by WebToApp (hybrid mode)
 *
 * Syncs local SQLite data to the cloud backend (${backend}) when internet
 * is available. Runs automatically in the background every 30 seconds.
 *
 * Strategy:
 *  - Each local row has a \`synced_at\` timestamp (null = not yet synced)
 *  - On reconnect, all unsynced rows are pushed to the cloud
 *  - Cloud changes are pulled and merged (last-write-wins by updated_at)
 *  - Conflict resolution: cloud wins for updates, local wins for deletes
 */

import { localApi } from './localApi';

const LOCAL_API   = \`http://127.0.0.1:${port}\`;
const SYNC_INTERVAL_MS = 30_000; // 30 seconds
const TABLES = [${tableList}];

// ── Online detection ──────────────────────────────────────────────────────────

export function isOnline(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

// ── Cloud client (original SDK — kept for sync only) ──────────────────────────

${backend === "supabase" ? `
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';
const cloudClient = supabaseUrl ? createClient(supabaseUrl, supabaseKey) : null;
` : `
// Firebase cloud client — configure with your Firebase config
let cloudClient: any = null;
try {
  const { initializeApp, getApps } = await import('firebase/app');
  const { getFirestore } = await import('firebase/firestore');
  if (!getApps().length && import.meta.env.VITE_FIREBASE_CONFIG) {
    const app = initializeApp(JSON.parse(import.meta.env.VITE_FIREBASE_CONFIG));
    cloudClient = getFirestore(app);
  }
} catch {}
`}

// ── Push local → cloud ────────────────────────────────────────────────────────

async function pushTable(table: string): Promise<number> {
  // Get rows not yet synced
  const res = await fetch(\`\${LOCAL_API}/api/\${table}?synced=false\`);
  if (!res.ok) return 0;

  const { data: rows } = await res.json() as { data: any[] };
  if (!rows?.length) return 0;

  let pushed = 0;

  ${backend === "supabase" ? `
  if (!cloudClient) return 0;
  const { error } = await cloudClient.from(table).upsert(rows, { onConflict: 'id' });
  if (!error) {
    pushed = rows.length;
    // Mark as synced locally
    await Promise.all(rows.map((row: any) =>
      fetch(\`\${LOCAL_API}/api/\${table}/\${row.id}\`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ synced: true, synced_at: new Date().toISOString() }),
      })
    ));
  }
  ` : `
  // Firebase push
  if (!cloudClient) return 0;
  const { doc, setDoc } = await import('firebase/firestore');
  for (const row of rows) {
    await setDoc(doc(cloudClient, table, row.id), row, { merge: true });
    await fetch(\`\${LOCAL_API}/api/\${table}/\${row.id}\`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ synced: true, synced_at: new Date().toISOString() }),
    });
    pushed++;
  }
  `}

  return pushed;
}

// ── Pull cloud → local ────────────────────────────────────────────────────────

async function pullTable(table: string): Promise<number> {
  if (!cloudClient) return 0;
  let pulled = 0;

  ${backend === "supabase" ? `
  const lastSync = localStorage.getItem(\`sync_last_\${table}\`) ?? '1970-01-01';
  const { data: rows } = await cloudClient
    .from(table)
    .select()
    .gt('updated_at', lastSync);

  if (!rows?.length) return 0;

  for (const row of rows) {
    await fetch(\`\${LOCAL_API}/api/\${table}/upsert\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...row, synced: true }),
    });
    pulled++;
  }

  localStorage.setItem(\`sync_last_\${table}\`, new Date().toISOString());
  ` : `
  // Firebase pull — last 24h of changes
  const { collection, query, where, getDocs, Timestamp } = await import('firebase/firestore');
  const since = Timestamp.fromDate(new Date(Date.now() - 86_400_000));
  const q = query(collection(cloudClient, table), where('updated_at', '>', since));
  const snap = await getDocs(q);

  for (const docSnap of snap.docs) {
    const row = { id: docSnap.id, ...docSnap.data() };
    await fetch(\`\${LOCAL_API}/api/\${table}/upsert\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...row, synced: true }),
    });
    pulled++;
  }
  `}

  return pulled;
}

// ── Main sync cycle ───────────────────────────────────────────────────────────

export async function syncOnce(): Promise<{ pushed: number; pulled: number }> {
  if (!isOnline()) return { pushed: 0, pulled: 0 };

  let totalPushed = 0;
  let totalPulled = 0;

  for (const table of TABLES) {
    try {
      totalPushed += await pushTable(table);
      totalPulled += await pullTable(table);
    } catch (err) {
      console.warn(\`[sync] \${table} sync failed:\`, err);
    }
  }

  if (totalPushed > 0 || totalPulled > 0) {
    console.log(\`[sync] ↑ \${totalPushed} pushed · ↓ \${totalPulled} pulled\`);
    window.dispatchEvent(new CustomEvent('webtoapp:synced', {
      detail: { pushed: totalPushed, pulled: totalPulled }
    }));
  }

  return { pushed: totalPushed, pulled: totalPulled };
}

// ── Auto-sync setup ───────────────────────────────────────────────────────────

let syncTimer: ReturnType<typeof setInterval> | null = null;

export function startSync(): void {
  if (syncTimer) return;

  // Sync immediately when coming back online
  window.addEventListener('online', () => {
    console.log('[sync] Back online — syncing...');
    syncOnce();
  });

  // Periodic sync
  syncTimer = setInterval(syncOnce, SYNC_INTERVAL_MS);
  console.log(\`[sync] Auto-sync started (every \${SYNC_INTERVAL_MS / 1000}s)\`);

  // Initial sync
  syncOnce();
}

export function stopSync(): void {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
    console.log('[sync] Auto-sync stopped');
  }
}
`;
}

function generateOnlineStatusHook(): string {
  return `/**
 * useOnlineStatus.ts — generated by WebToApp (hybrid mode)
 *
 * React hook that tracks internet connectivity and shows sync status.
 * Use this to show online/offline indicators in your UI.
 *
 * Usage:
 *   const { isOnline, lastSynced, syncNow } = useOnlineStatus();
 */
import { useState, useEffect, useCallback } from 'react';
import { syncOnce } from './syncEngine';

export interface OnlineStatus {
  /** Whether the device currently has internet access */
  isOnline: boolean;
  /** Timestamp of last successful sync, or null if never synced */
  lastSynced: Date | null;
  /** Number of local changes waiting to be pushed */
  pendingChanges: number;
  /** Manually trigger a sync right now */
  syncNow: () => Promise<void>;
  /** Whether a sync is currently in progress */
  isSyncing: boolean;
}

export function useOnlineStatus(): OnlineStatus {
  const [isOnline, setIsOnline]         = useState(navigator.onLine);
  const [lastSynced, setLastSynced]     = useState<Date | null>(null);
  const [pendingChanges, setPending]    = useState(0);
  const [isSyncing, setIsSyncing]       = useState(false);

  useEffect(() => {
    function handleOnline()  { setIsOnline(true); }
    function handleOffline() { setIsOnline(false); }

    function handleSynced(e: Event) {
      const detail = (e as CustomEvent<{ pushed: number; pulled: number }>).detail;
      setLastSynced(new Date());
      setPending(0);
    }

    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('webtoapp:synced', handleSynced);

    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('webtoapp:synced', handleSynced);
    };
  }, []);

  const syncNow = useCallback(async () => {
    if (!isOnline || isSyncing) return;
    setIsSyncing(true);
    try {
      const result = await syncOnce();
      if (result.pushed > 0 || result.pulled > 0) {
        setLastSynced(new Date());
      }
    } finally {
      setIsSyncing(false);
    }
  }, [isOnline, isSyncing]);

  return { isOnline, lastSynced, pendingChanges, syncNow, isSyncing };
}

// ── Ready-to-use UI component ─────────────────────────────────────────────────

/**
 * Drop this anywhere in your app to show connectivity + sync status.
 *
 * <SyncStatusBadge />
 */
export function SyncStatusBadge() {
  const { isOnline, lastSynced, isSyncing, syncNow } = useOnlineStatus();

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        color: isOnline ? '#4ade80' : '#f87171',
        cursor: isOnline ? 'pointer' : 'default',
        userSelect: 'none',
      }}
      onClick={syncNow}
      title={isOnline ? 'Click to sync now' : 'No internet connection'}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: isOnline ? '#4ade80' : '#f87171',
          display: 'inline-block',
          animation: isSyncing ? 'pulse 1s infinite' : 'none',
        }}
      />
      {isSyncing
        ? 'Syncing...'
        : isOnline
        ? lastSynced
          ? \`Synced \${formatRelative(lastSynced)}\`
          : 'Online'
        : 'Offline — changes saved locally'}
    </div>
  );
}

function formatRelative(date: Date): string {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 60)  return 'just now';
  if (secs < 3600) return \`\${Math.floor(secs / 60)}m ago\`;
  return \`\${Math.floor(secs / 3600)}h ago\`;
}
`;
}

// ─── Improvement #5: Generate a clean .env ────────────────────────────────────

/**
 * Reads the source project's .env / .env.local and generates a sanitised
 * version for the output project. Cloud credentials (Supabase URL, Firebase
 * config, Clerk keys, etc.) are commented out so they don't accidentally
 * reach the packaged desktop app. Local API vars are injected instead.
 */
async function generateCleanEnv(ctx: PipelineContext): Promise<void> {
  const isOnline = ctx.config.mode === "online";

  const cloudKeyPatterns = [
    /SUPABASE/i, /FIREBASE/i, /CLERK/i, /AUTH0/i, /STRIPE/i,
    /SENDGRID/i, /TWILIO/i, /AWS_/i, /SENTRY/i,
  ];

  const sourceEnvFiles = [".env", ".env.local", ".env.production"];
  let sourceContent = "";

  for (const f of sourceEnvFiles) {
    try {
      sourceContent = await fs.readFile(path.join(ctx.sourceDir, f), "utf-8");
      break;
    } catch { /* try next */ }
  }

  const lines = sourceContent ? sourceContent.split("\n") : [];

  if (isOnline) {
    // ── Online mode: keep ALL credentials intact — the app connects directly to the cloud.
    // Only add the desktop-specific vars; never strip cloud keys.
    const outputLines: string[] = [
      "# Generated by WebToApp — desktop app environment (online mode)",
      "# Cloud credentials are kept intact — required for Supabase/Firebase connectivity.",
      "",
    ];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      outputLines.push(line);
    }

    // Add desktop-specific vars only if not already present
    if (!sourceContent.includes("VITE_DESKTOP_MODE")) {
      outputLines.push("");
      outputLines.push("# Added by WebToApp — desktop-specific env");
      outputLines.push("VITE_DESKTOP_MODE=true");
    }

    const destPath = path.join(ctx.outputDir, ".env");
    await fs.writeFile(destPath, outputLines.join("\n") + "\n", "utf-8");
    ctx.log("info", "Generated .env (online mode — cloud credentials preserved)", STAGE);
  } else {
    // ── Offline / hybrid mode: strip cloud credentials; inject local API vars.
    const outputLines: string[] = [
      "# Generated by WebToApp — desktop app environment",
      "# Cloud credentials have been commented out (replaced by local SQLite backend)",
      "",
      "VITE_LOCAL_API=true",
      `VITE_API_PORT=${ctx.config.backend?.port ?? 3001}`,
      "",
      "# Original cloud variables (kept for reference, commented out):",
    ];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const isCloudKey = cloudKeyPatterns.some((re) => re.test(trimmed));
      outputLines.push(isCloudKey ? `# ${line}` : line);
    }

    const destPath = path.join(ctx.outputDir, ".env");
    await fs.writeFile(destPath, outputLines.join("\n") + "\n", "utf-8");
    ctx.log("info", "Generated clean .env (cloud credentials commented out)", STAGE);
  }
}

// ─── Improvement #6: Copy auto-detected app icon ──────────────────────────────

/**
 * Copies the auto-detected app icon from the source project to
 * assets/icon.png in the output project (where electron-builder expects it).
 * If no icon was detected, a warning is logged but the pipeline continues.
 */
async function copyAppIcon(ctx: PipelineContext): Promise<void> {
  if (ctx.config.icon) {
    const ext = path.extname(ctx.config.icon).toLowerCase();
    const destName = ext === ".ico" ? "icon.ico" : "icon.png";
    const iconDest = path.join(ctx.outputDir, "assets", destName);
    try {
      await fs.mkdir(path.dirname(iconDest), { recursive: true });
      await fs.copyFile(path.join(ctx.sourceDir, ctx.config.icon), iconDest);
      ctx.log("info", `Copied config icon: ${ctx.config.icon} → assets/${destName}`, STAGE);
    } catch {
      ctx.log("warn", `Could not copy config icon: ${ctx.config.icon}`, STAGE);
    }
    return;
  }

  const iconSrc = ctx.detection?.iconPath;
  if (!iconSrc || !iconSrc.toLowerCase().endsWith(".png")) {
    ctx.log(
      "info",
      "No valid PNG app icon auto-detected. electron-builder will use the default blank icon.",
      STAGE
    );
    return;
  }

  const iconDest = path.join(ctx.outputDir, "assets", "icon.png");
  try {
    await fs.mkdir(path.dirname(iconDest), { recursive: true });
    await fs.copyFile(path.join(ctx.sourceDir, iconSrc), iconDest);
    ctx.log("info", `Copied auto-detected icon: ${iconSrc} → assets/icon.png`, STAGE);
  } catch {
    ctx.log("warn", `Could not copy icon from ${iconSrc}`, STAGE);
  }
}