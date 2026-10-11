const { contextBridge, ipcRenderer } = require('electron');

function readArg(prefix) {
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : '';
}

const runSessionId = readArg('--ocean-run-session=');
const panelJourneyId = readArg('--ocean-panel-journey=');
const panelPairIndex = Number(readArg('--ocean-panel-pair=') || '1') || 1;

contextBridge.exposeInMainWorld('oceanDirectHost', {
  status: (msg) =>
    ipcRenderer.send('direct-host:status', { sessionId: runSessionId, msg: String(msg || '') }),
  showQr: (qr) =>
    ipcRenderer.send('direct-host:qr-show', {
      sessionId: runSessionId,
      journeyId: panelJourneyId,
      pairIndex: panelPairIndex,
      qr: String(qr || ''),
    }),
  hideQr: () =>
    ipcRenderer.send('direct-host:qr-hide', {
      sessionId: runSessionId,
      journeyId: panelJourneyId,
      pairIndex: panelPairIndex,
    }),
});
