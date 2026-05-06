import path from "node:path";
import fs from "node:fs/promises";
import Handlebars from "handlebars";

import type { PipelineContext } from "../PipelineContext.js";
import type { FileGeneratePlan } from "../../types/MigrationPlan.js";

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

    for (const filePlan of filesToGenerate) {
      const outputPath = path.join(ctx.outputDir, filePlan.outputPath);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });

      const content = await generateFile(filePlan, ctx);
      await fs.writeFile(outputPath, content, "utf-8");

      ctx.log("info", `Generated: ${filePlan.outputPath}`, STAGE);
      generated++;
    }

    // Ensure syncEngine.ts is deleted if not in hybrid mode
    if (ctx.config.mode !== "hybrid") {
      try {
        await fs.rm(path.join(ctx.outputDir, "src/lib/syncEngine.ts"), { force: true });
        await fs.rm(path.join(ctx.outputDir, "src/hooks/useOnlineStatus.ts"), { force: true });
      } catch {}
    }

    // ── Patch package.json ─────────────────────────────────────────
    await patchPackageJson(ctx);

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
 */
async function patchPackageJson(ctx: PipelineContext): Promise<void> {
  const pkgPath = path.join(ctx.outputDir, "package.json");
  let pkg: any = {};

  try {
    const raw = await fs.readFile(pkgPath, "utf-8");
    pkg = JSON.parse(raw);
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

  // Set main to electron entry point
  pkg.main = "electron/main.js";

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

  // Resolve template from packages/templates — built in Session 3
  const templatesRoot = path.resolve(ctx.workDir, "../../packages/templates");
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
    default:
      return `// Generated by WebToApp — ${plan.generatorType}\n`;
  }
}

function generateElectronMain(vars: Record<string, unknown>): string {
  const appName = vars["appName"] as string ?? "App";
  const devPort = vars["devPort"] as number ?? 5173;
  const backendPort = vars["backendPort"] as number ?? 3001;

  return `const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
let mainWindow;
let backendProcess;

function startBackend() {
  const serverPath = isDev
    ? path.join(__dirname, '../backend/server.js')
    : path.join(process.resourcesPath, 'backend/server.js');

  backendProcess = spawn('node', [serverPath], {
    env: { ...process.env, PORT: '${backendPort}' },
    stdio: isDev ? 'inherit' : 'ignore',
  });

  backendProcess.on('error', (err) => console.error('Backend error:', err));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: '${appName}',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const url = isDev
    ? 'http://localhost:${devPort}'
    : \`file://\${path.join(__dirname, '../dist/index.html')}\`;

  mainWindow.loadURL(url);

  // Open external links in the browser, not Electron
  mainWindow.webContents.setWindowOpenHandler(({ url: u }) => {
    shell.openExternal(u);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  startBackend();

  // Give backend a moment to start before loading the window
  setTimeout(createWindow, 500);

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
  const icon = vars["icon"] as string ?? "assets/icon.png";

  const winSection = targets.includes("windows") ? `
  win:
    target:
      - target: nsis
        arch: [x64]
    icon: ${icon}
  nsis:
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
    icon: ${icon}
    category: Utility` : "";

  const macSection = targets.includes("mac") ? `
  mac:
    target:
      - target: dmg
        arch: [x64, arm64]
    icon: ${icon}
    hardenedRuntime: true
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
    .map((t) => `const ${t}Router = require('./routes/${t}');`)
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
const { initDatabase } = require('./database');
const authRouter = require('./auth');
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

  const createTables = tables.map((t) => `
  db.exec(\`
    CREATE TABLE IF NOT EXISTS ${t} (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  \`);`).join("\n");

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
const { getDb } = require('./database');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'webtoapp-local-secret-change-in-production';
const TOKEN_EXPIRY = '7d';

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
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare(
      'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)'
    ).run('${defaultAdmin}', hash, 'admin');
    console.log('[WebToApp] Default admin created: ${defaultAdmin} / admin123');
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

  return `/**
 * CRUD routes for '${table}' — generated by WebToApp
 * Mirrors the Supabase PostgREST interface so the frontend localApi client
 * can call these routes the same way it called Supabase.
 */
const express = require('express');
const { getDb } = require('../database');

const router = express.Router();

// GET /api/${table} — list all rows (supports ?column=value filters)
router.get('/', (req, res) => {
  const db = getDb();
  const { limit = 1000, offset = 0, order, ...filters } = req.query;

  let query = \`SELECT * FROM ${table}\`;
  const params = [];
  const conditions = Object.entries(filters).map(([col, val]) => {
    params.push(val);
    return \`\${col} = ?\`;
  });

  if (conditions.length) query += \` WHERE \${conditions.join(' AND ')}\`;
  if (order) query += \` ORDER BY \${order.replace(/[^a-zA-Z0-9_,.]/g, '')}\`;
  query += \` LIMIT ? OFFSET ?\`;
  params.push(limit, offset);

  const rows = db.prepare(query).all(...params);
  res.json({ data: rows, error: null });
});

// GET /api/${table}/:id — get one row
router.get('/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM ${table} WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ data: null, error: 'Not found' });
  res.json({ data: row, error: null });
});

// POST /api/${table} — insert row(s)
router.post('/', (req, res) => {
  const db = getDb();
  const rows = Array.isArray(req.body) ? req.body : [req.body];
  const inserted = [];

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
router.put('/:id', (req, res) => {
  const db = getDb();
  const cols = Object.keys(req.body);
  if (!cols.length) return res.status(400).json({ error: 'No fields to update' });

  const setClauses = cols.map((c) => \`\${c} = ?\`).join(', ');
  const vals = cols.map((c) => req.body[c]);

  db.prepare(
    \`UPDATE ${table} SET \${setClauses}, updated_at = datetime('now') WHERE id = ?\`
  ).run(...vals, req.params.id);

  const updated = db.prepare('SELECT * FROM ${table} WHERE id = ?').get(req.params.id);
  res.json({ data: updated, error: null });
});

// DELETE /api/${table}/:id — delete row
router.delete('/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM ${table} WHERE id = ?').run(req.params.id);
  res.json({ data: null, error: null });
});

// POST /api/${table}/upsert — upsert row(s)
router.post('/upsert', (req, res) => {
  const db = getDb();
  const rows = Array.isArray(req.body) ? req.body : [req.body];
  const upserted = [];

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
