const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
let mainWindow;
let backendProcess;

function startBackend() {
  const serverPath = isDev
    ? path.join(__dirname, '../backend/server.cjs')
    : path.join(process.resourcesPath, 'backend/server.cjs');

  backendProcess = spawn('node', [serverPath], {
    env: { ...process.env, PORT: '3001' },
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
    title: 'Pharmacy Tracker',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

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
