/**
 * IRCTC preload — isolated-world bridge ONLY.
 * No window.__oceanNative / oceanBridge at launch (Akamai fingerprint).
 * Main-world automation talks via window.postMessage({ source: 'oc-nw', ... }).
 */
const { ipcRenderer } = require('electron');

function readSessionId() {
  const arg = process.argv.find((a) => a.startsWith('--ocean-session-id='));
  if (arg) return arg.slice('--ocean-session-id='.length);
  return '';
}

const sessionId = readSessionId();

window.addEventListener(
  'message',
  (event) => {
    try {
      const data = event.data;
      if (!data || data.source !== 'oc-nw') return;
      if (event.source !== window) return;

      const id = data.id;
      const reply = (payload) => {
        window.postMessage({ source: 'oc-nw-reply', id, ...payload }, '*');
      };

      if (data.action === 'click') {
        ipcRenderer
          .invoke('native:click', {
            sessionId,
            selector: data.selector,
            offsetXPercent: data.offsetXPercent ?? 50,
            offsetYPercent: data.offsetYPercent ?? 50,
          })
          .then((r) => reply({ ok: true, result: r }))
          .catch((e) => reply({ ok: false, error: e.message || String(e) }));
        return;
      }

      if (data.action === 'type') {
        ipcRenderer
          .invoke('native:type', {
            sessionId,
            selector: data.selector,
            text: data.text ?? '',
          })
          .then((r) => reply({ ok: true, result: r }))
          .catch((e) => reply({ ok: false, error: e.message || String(e) }));
        return;
      }

      if (data.action === 'key') {
        ipcRenderer
          .invoke('native:key', { sessionId, key: data.key })
          .then((r) => reply({ ok: true, result: r }))
          .catch((e) => reply({ ok: false, error: e.message || String(e) }));
        return;
      }

      if (data.action === 'status') {
        ipcRenderer.send('run:panel-status', {
          sessionId,
          message: data.text ?? '',
        });
        reply({ ok: true });
        return;
      }

      if (data.action === 'coords-click') {
        ipcRenderer.send('action-click', {
          sessionId,
          x: data.x,
          y: data.y,
        });
        reply({ ok: true });
        return;
      }

      // Direct Booking hand-off (Token Manager popup-parity — off IRCTC page)
      if (data.action === 'direct-book') {
        ipcRenderer
          .invoke('direct-book:run', {
            sessionId,
            mode: data.mode || (data.payload && data.payload.mode) || 'phonepe',
            tokens: data.tokens || (data.payload && data.payload.tokens) || {},
            details: data.details || (data.payload && data.payload.details) || {},
            captchaCreds:
              data.captchaCreds || (data.payload && data.payload.captchaCreds) || {},
            wsUser: data.wsUser || (data.payload && data.payload.wsUser) || '',
            clientTxnId:
              data.clientTxnId || (data.payload && data.payload.clientTxnId) || '',
          })
          .then((r) => reply({ ok: true, result: r }))
          .catch((e) => reply({ ok: false, error: e.message || String(e) }));
        return;
      }

      // PT fare high — wait for panel Proceed anyway
      if (data.action === 'pt-fare-wait') {
        ipcRenderer
          .invoke('panels:pt-fare-wait', {
            sessionId,
            amount: data.amount ?? (data.payload && data.payload.amount),
            maxFare: data.maxFare ?? (data.payload && data.payload.maxFare),
          })
          .then((r) => reply({ ok: true, result: r }))
          .catch((e) => reply({ ok: false, error: e.message || String(e) }));
        return;
      }

      if (data.action === 'sibling-init-wait') {
        ipcRenderer
          .invoke('panels:sibling-init-wait', { sessionId })
          .then((r) => reply({ ok: true, result: r }))
          .catch((e) => reply({ ok: false, error: e.message || String(e) }));
        return;
      }

      if (data.action === 'mark-init-payment') {
        ipcRenderer
          .invoke('panels:mark-init-payment', { sessionId })
          .then((r) => reply({ ok: true, result: r }))
          .catch((e) => reply({ ok: false, error: e.message || String(e) }));
        return;
      }

      if (data.action === 'booking-full') {
        ipcRenderer
          .invoke('history:booking-full', {
            sessionId,
            fullData: data.fullData || data.payload || null,
          })
          .then((r) => reply({ ok: true, result: r }))
          .catch((e) => reply({ ok: false, error: e.message || String(e) }));
        return;
      }
    } catch (_) {}
  },
  false
);

window.addEventListener('DOMContentLoaded', () => {
  try {
    ipcRenderer.send('irctc:preload-ready', {
      sessionId,
      href: location.href,
      title: document.title || '',
    });
  } catch (_) {}
});
