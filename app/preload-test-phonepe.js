const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('testPhonePe', {
  run: (payload) => ipcRenderer.invoke('test-phonepe:run', payload || {}),
  onLog: (cb) => {
    const h = (_e, msg) => cb(msg);
    ipcRenderer.on('test-phonepe:log', h);
    return () => ipcRenderer.removeListener('test-phonepe:log', h);
  },
  onQr: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('test-phonepe:qr', h);
    return () => ipcRenderer.removeListener('test-phonepe:qr', h);
  },
  onQrHide: (cb) => {
    const h = () => cb();
    ipcRenderer.on('test-phonepe:qr-hide', h);
    return () => ipcRenderer.removeListener('test-phonepe:qr-hide', h);
  },
});
