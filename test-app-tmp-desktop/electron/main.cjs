const { app, BrowserWindow, shell, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// BUG FIX #1 — Register app:// as a privileged scheme BEFORE app is ready.
// Without this, the renderer is served from file://, which Electron treats as
// an opaque (non-http) origin. fetch() calls to http://127.0.0.1 are then
// blocked as mixed content — the renderer silently receives no data and
// renders a blank white screen.
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
let backendProcess;

function startBackend() {
  const serverPath = isDev
    ? path.join(__dirname, '../backend/server.cjs')
    : path.join(process.resourcesPath, 'backend/server.cjs');

  // BUG FIX #2 — Use process.execPath (Electron's bundled Node) instead of
  // the external 'node' binary. On end-user machines Node.js is often NOT
  // installed, so spawn('node', ...) fails silently, the backend never starts,
  // and every API call from the renderer returns a network error — blank screen.
  // ELECTRON_RUN_AS_NODE=1 switches the Electron binary into plain Node mode.
  backendProcess = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      PORT: '3001',
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

// BUG FIX #3 — Replace the blind 500ms setTimeout with a health-check poll.
// The blind delay is a race condition: on slow machines (especially HDD-based
// Windows PCs) Express + SQLite take much longer than 500ms to start.
// The window opens before the backend is ready, all API calls fail, and the
// React app has no data to render — blank white screen.
async function waitForBackend(maxWaitMs = 10000, intervalMs = 200) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch('http://127.0.0.1:3001/api/health');
      if (res.ok) return; // backend is ready
    } catch (_) { /* still starting up */ }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  // Timed out — open window anyway so the user sees an error, not a frozen splash
  console.error('[WebToApp] Backend did not become ready within', maxWaitMs, 'ms');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Pharmacy Tracker',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    // Hide window until content is ready — prevents white flash on slow loads
    show: false,
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // BUG FIX #1 (continued) — Load via app:// not file://
    // file:// is an opaque origin; fetch() to http://127.0.0.1 is blocked as
    // mixed content. app:// is registered above as a secure standard scheme,
    // so the renderer can freely call the local Express backend.
    mainWindow.loadURL('app://./index.html');
  }

  // Show window only when the page has actually painted — no blank flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Log load failures to help debug any remaining blank-screen issues
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[WebToApp] Page failed to load: ${code} ${desc} — ${url}`);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: u }) => {
    if (u.startsWith('http')) shell.openExternal(u);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  // Serve dist/ via app:// — must be registered before any window loads
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;

    // SPA fallback: React Router routes have no file extension — serve index.html
    const hasExtension = /\.\w+$/.test(pathname);
    let filePath = path.join(__dirname, '../dist', pathname);
    if (!hasExtension || !fs.existsSync(filePath)) {
      filePath = path.join(__dirname, '../dist/index.html');
    }

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
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill('SIGTERM');
  }
});
