const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('newsUi', {
  getPayload: () => ipcRenderer.invoke('news:get'),
  ack: () => ipcRenderer.invoke('news:ack'),
  update: () => ipcRenderer.invoke('updater:check-offer'),
  openSupportLink: (kind) => ipcRenderer.invoke('app:open-support-link', kind),
});
