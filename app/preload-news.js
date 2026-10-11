const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('newsUi', {
  getPayload: () => ipcRenderer.invoke('news:get'),
  ack: () => ipcRenderer.invoke('news:ack'),
  openSupportLink: (kind) => ipcRenderer.invoke('app:open-support-link', kind),
});
