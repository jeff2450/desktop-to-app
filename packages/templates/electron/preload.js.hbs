const { contextBridge, ipcRenderer } = require('electron');

/**
 * Secure context bridge — exposes a minimal, typed API to the renderer.
 * Never expose ipcRenderer directly. Only allow specific channels.
 */

const SEND_CHANNELS    = ['app:minimize', 'app:maximize', 'app:close', 'app:install-update'];
const INVOKE_CHANNELS  = ['app:get-version', 'app:get-path', 'app:is-maximized', 'app:check-update'];
const RECEIVE_CHANNELS = ['app:update-available', 'app:update-downloaded', 'app:window-state-changed'];

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  arch: process.arch,

  versions: {
    node:     process.versions.node,
    electron: process.versions.electron,
    chrome:   process.versions.chrome,
    app: null, // populated after invoke below
  },

  // Fire-and-forget IPC
  send(channel, ...args) {
    if (SEND_CHANNELS.includes(channel)) {
      ipcRenderer.send(channel, ...args);
    }
  },

  // Request-response IPC
  async invoke(channel, ...args) {
    if (INVOKE_CHANNELS.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
    throw new Error(`Channel '${channel}' not allowed`);
  },

  // Subscribe to events from main process
  on(channel, callback) {
    if (RECEIVE_CHANNELS.includes(channel)) {
      const handler = (_event, ...args) => callback(...args);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    }
    return () => {};
  },

  // Convenience: get the app data path for local storage paths
  async getAppDataPath() {
    return ipcRenderer.invoke('app:get-path', 'userData');
  },

  // ---------------------------------------------------------------------------
  // Window controls — for use in the custom title bar
  // ---------------------------------------------------------------------------
  minimize()        { ipcRenderer.send('app:minimize'); },
  maximize()        { ipcRenderer.send('app:maximize'); },
  closeWindow()     { ipcRenderer.send('app:close'); },
  isMaximized()     { return ipcRenderer.invoke('app:is-maximized'); },

  // ---------------------------------------------------------------------------
  // Auto-update helpers
  // ---------------------------------------------------------------------------
  /** Manually trigger an update check. Resolves immediately (check runs async). */
  checkForUpdate()  { return ipcRenderer.invoke('app:check-update'); },
  /** Quit and install a previously downloaded update. */
  installUpdate()   { ipcRenderer.send('app:install-update'); },

  /** Called when a new version is available. cb({ version, releaseNotes }) */
  onUpdateAvailable(cb) {
    const handler = (_e, info) => cb(info);
    ipcRenderer.on('app:update-available', handler);
    return () => ipcRenderer.removeListener('app:update-available', handler);
  },

  /** Called when the update has been fully downloaded and is ready to install. cb({ version }) */
  onUpdateDownloaded(cb) {
    const handler = (_e, info) => cb(info);
    ipcRenderer.on('app:update-downloaded', handler);
    return () => ipcRenderer.removeListener('app:update-downloaded', handler);
  },

  /** Called when the window maximize/restore state changes. cb({ maximized: boolean }) */
  onWindowStateChanged(cb) {
    const handler = (_e, state) => cb(state);
    ipcRenderer.on('app:window-state-changed', handler);
    return () => ipcRenderer.removeListener('app:window-state-changed', handler);
  },
});
