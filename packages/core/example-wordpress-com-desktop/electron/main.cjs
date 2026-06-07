const { app, BrowserWindow, shell, ipcMain, nativeTheme, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

// ---------------------------------------------------------------------------
// Crash Reporting — Sentry (only in production, only when DSN is configured)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// MIME type map for serving static assets correctly
// ---------------------------------------------------------------------------
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.cjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.eot':  'application/vnd.ms-fontobject',
  '.mp4':  'video/mp4',
  '.webm': 'video/webm',
  '.mp3':  'audio/mpeg',
  '.wav':  'audio/wav',
  '.pdf':  'application/pdf',
  '.txt':  'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

// Vite hashes asset filenames — cache them for 1 year. HTML is never hashed.
const HASHED_ASSET_RE = /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[a-z]+$/;

function getMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function getCacheControl(urlPath) {
  if (HASHED_ASSET_RE.test(urlPath)) return 'public, max-age=31536000, immutable';
  return 'no-cache';
}

function serveFile(filePath, urlPath) {
  try {
    const data = fs.readFileSync(filePath);
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type':  getMime(filePath),
        'Cache-Control': getCacheControl(urlPath),
        'Content-Length': String(data.byteLength),
      },
    });
  } catch {
    return new Response('Not Found', { status: 404 });
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Test App',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f0f0f' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
  });

  mainWindow.loadURL(isDev ? 'http://localhost:5173' : 'app://./');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools();
  });

  // ---------------------------------------------------------------------------
  // Update banner — inject a self-contained UI overlay into the renderer after
  // each page load so the user sees a "Restart & Install" prompt when a new
  // version is ready. The banner script lives next to main.cjs so it works in
  // both dev (CSP is relaxed) and production (bundled in the app directory).
  // ---------------------------------------------------------------------------
  const bannerPath = path.join(__dirname, 'update-banner.js');
  mainWindow.webContents.on('did-finish-load', () => {
    if (fs.existsSync(bannerPath)) {
      const bannerCode = fs.readFileSync(bannerPath, 'utf-8');
      mainWindow?.webContents.executeJavaScript(bannerCode).catch(() => {
        // Banner injection failed silently — the update still works via IPC,
        // the app just won't show the visual toast.
      });
    }
  });

  // Notify renderer when window maximize state changes
  mainWindow.on('maximize',   () => mainWindow?.webContents.send('app:window-state-changed', { maximized: true }));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('app:window-state-changed', { maximized: false }));

  // ---------------------------------------------------------------------------
  // SPA navigation guard — prevents React-Router / Vue-Router link clicks from
  // triggering a full renderer reload. Only external URLs open in the browser.
  // ---------------------------------------------------------------------------
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const parsed = new URL(url);
      const isInternal = isDev
        ? parsed.origin === `http://localhost:5173`
        : parsed.protocol === 'app:';
      if (!isInternal) {
        event.preventDefault();
        shell.openExternal(url);
      }
    } catch {
      event.preventDefault();
    }
  });

  // Open target=_blank links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  // If load fails in production — serve the offline fallback page
  mainWindow.webContents.on('did-fail-load', (_event, code, _desc, url) => {
    console.error(`[WebToApp] Page failed to load: ${code} - ${url}`);
    if (!isDev) {
      const offlinePage = path.join(__dirname, 'offline.html');
      if (fs.existsSync(offlinePage)) {
        mainWindow?.loadFile(offlinePage);
      } else {
        mainWindow?.loadURL('app://./');
      }
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------
ipcMain.handle('app:get-version',   () => app.getVersion());
ipcMain.handle('app:is-maximized',  () => mainWindow?.isMaximized() ?? false);
ipcMain.on('app:minimize',          () => mainWindow?.minimize());
ipcMain.on('app:maximize',          () => {
  mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize();
});
ipcMain.on('app:close',             () => mainWindow?.close());
// Manual update trigger — the renderer can call window.electronAPI.invoke('app:check-update')
ipcMain.handle('app:check-update',  () => {
  if (!isDev) autoUpdater.checkForUpdates().catch(console.error);
  return null;
});
ipcMain.on('app:install-update', () => {
  autoUpdater.quitAndInstall(false, true);
});

// ---------------------------------------------------------------------------
// Auto-Updater
// ---------------------------------------------------------------------------
function setupAutoUpdater() {
  if (isDev) return;

}

// ---------------------------------------------------------------------------
// App startup
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  // Serve the built dist/ folder for the app:// scheme with proper MIME types
  // and long-lived cache headers for Vite-hashed assets.
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    const hasExtension = /\.\w+$/.test(pathname);
    const distDir = path.join(__dirname, '../dist');
    let filePath = path.join(distDir, pathname);

    // Security: prevent path traversal outside dist/
    if (!filePath.startsWith(distDir + path.sep) && filePath !== distDir) {
      return new Response('Forbidden', { status: 403 });
    }

    // SPA fallback: any path without a file extension → index.html
    if (!hasExtension || !fs.existsSync(filePath)) {
      filePath = path.join(distDir, 'index.html');
    }

    return serveFile(filePath, pathname);
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
