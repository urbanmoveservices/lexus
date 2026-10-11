const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ocean', {
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
  openSupportLink: (kind) => ipcRenderer.invoke('app:open-support-link', kind),
  getLicenseAbout: () => ipcRenderer.invoke('license:get-about'),
  refreshLicenseAbout: () => ipcRenderer.invoke('license:refresh-about'),
  quitApp: () => ipcRenderer.invoke('app:quit'),
  setShellMode: () => ipcRenderer.invoke('ui:set-shell-mode'),
  openModalShell: (modalName) => ipcRenderer.invoke('ui:open-modal', modalName),
  openNewBookDraft: () => ipcRenderer.invoke('ui:new-book-draft'),
  closeModalShell: () => ipcRenderer.invoke('ui:close-modal'),
  setToolbarMenuOpen: (open) => ipcRenderer.invoke('ui:toolbar-menu', { open: Boolean(open) }),
  onModalNavigate: (callback) => {
    const handler = (_e, name) => callback(name);
    ipcRenderer.on('shell:open-modal', handler);
    return () => ipcRenderer.removeListener('shell:open-modal', handler);
  },

  // Profiles
  listProfiles: (kind) => ipcRenderer.invoke('profiles:list', kind),
  getProfile: (opts) => ipcRenderer.invoke('profiles:get', opts),
  saveJourney: (payload) => ipcRenderer.invoke('profiles:saveJourney', payload),
  saveCredential: (payload) => ipcRenderer.invoke('profiles:saveCredential', payload),
  setCredentialStatus: (id, status) =>
    ipcRenderer.invoke('profiles:setCredentialStatus', { id, status }),
  savePayment: (payload) => ipcRenderer.invoke('profiles:savePayment', payload),
  deleteProfile: (kind, id) => ipcRenderer.invoke('profiles:delete', { kind, id }),
  renameProfile: (kind, id, name) =>
    ipcRenderer.invoke('profiles:rename', { kind, id, name }),
  getUiState: () => ipcRenderer.invoke('profiles:getUiState'),
  setUiState: (partial) => ipcRenderer.invoke('profiles:setUiState', partial),
  getTrueCaptcha: () => ipcRenderer.invoke('profiles:getTrueCaptcha'),
  setTrueCaptcha: (payload) => ipcRenderer.invoke('profiles:setTrueCaptcha', payload),
  getProxy: () => ipcRenderer.invoke('profiles:getProxy'),
  listProxies: () => ipcRenderer.invoke('profiles:listProxies'),
  setProxy: (payload) => ipcRenderer.invoke('profiles:setProxy', payload),
  addProxy: (payload) => ipcRenderer.invoke('profiles:addProxy', payload || {}),
  deleteProxies: (payload) => ipcRenderer.invoke('profiles:deleteProxies', payload || {}),
  testProxy: (payload) => ipcRenderer.invoke('profiles:testProxy', payload || {}),

  // Ticket pair panels (Ocean-style)
  openTicketPanel: (journeyId) => ipcRenderer.invoke('panels:open-ticket', { journeyId }),

  // Runs
  startRun: (opts) => ipcRenderer.invoke('runs:start', opts),
  focusRun: (sessionId) => ipcRenderer.invoke('runs:focus', sessionId),
  stopRun: (sessionId) => ipcRenderer.invoke('runs:stop', sessionId),
  listRuns: () => ipcRenderer.invoke('runs:list'),
  onRunsStatus: (callback) => {
    const handler = (_e, data) => callback(data);
    ipcRenderer.on('runs:status', handler);
    return () => ipcRenderer.removeListener('runs:status', handler);
  },

  listHistory: () => ipcRenderer.invoke('history:list'),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  onHistoryUpdated: (callback) => {
    const handler = (_e, data) => callback(data);
    ipcRenderer.on('history:updated', handler);
    return () => ipcRenderer.removeListener('history:updated', handler);
  },

  // Convenience (uses selected profiles)
  openIrctc: (opts) => ipcRenderer.invoke('irctc:open', opts || {}),
  focusIrctc: (sessionId) => ipcRenderer.invoke('irctc:focus', sessionId),
  closeIrctc: (sessionId) => ipcRenderer.invoke('irctc:close', sessionId),
  getIrctcStatus: () => ipcRenderer.invoke('irctc:get-status'),
  onIrctcStatus: (callback) => {
    // Map runs:status → legacy-ish status for header
    const handler = (_e, data) => {
      const runs = (data && data.runs) || [];
      callback({
        open: runs.length > 0,
        url: runs[0]?.url || '',
        runs,
      });
    };
    ipcRenderer.on('runs:status', handler);
    return () => ipcRenderer.removeListener('runs:status', handler);
  },

  // Find trains / availability
  openTrainSearch: (query) => ipcRenderer.invoke('train:open-search', query),
  checkSensorTokens: () => ipcRenderer.invoke('sensors:check'),
  clearSensorTokens: () => ipcRenderer.invoke('sensors:clear'),
  onTrainSelected: (callback) => {
    const handler = (_e, payload) => callback(payload);
    ipcRenderer.on('train:selected', handler);
    return () => ipcRenderer.removeListener('train:selected', handler);
  },
  onNewBookDraft: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('book:new-draft', handler);
    return () => ipcRenderer.removeListener('book:new-draft', handler);
  },
});
