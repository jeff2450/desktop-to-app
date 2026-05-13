const { contextBridge, ipcRenderer } = require('electron');

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
