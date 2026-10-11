const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('oceanUpdater', {
  getInfo: () => ipcRenderer.invoke('updater:get-info'),
  check: () => ipcRenderer.invoke('updater:check'),
  start: (payload) => ipcRenderer.invoke('updater:start', payload || {}),
  close: () => ipcRenderer.invoke('updater:close'),
  onState: (cb) => {
    if (typeof cb !== 'function') return;
    ipcRenderer.on('updater:state', (_e, data) => cb(data));
  },
  onProgress: (cb) => {
    if (typeof cb !== 'function') return;
    ipcRenderer.on('updater:progress', (_e, data) => cb(data));
  },
});
