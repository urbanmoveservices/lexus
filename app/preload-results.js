const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('oceanTrains', {
  getQuery: () => ipcRenderer.invoke('train:get-query'),
  fetchList: (query) => ipcRenderer.invoke('train:fetch-list', query),
  fetchAvailability: (payload) => ipcRenderer.invoke('train:fetch-availability', payload),
  applySelection: (payload) => ipcRenderer.invoke('train:apply-selection', payload),
});
