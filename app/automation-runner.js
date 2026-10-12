const fs = require('fs');
const path = require('path');
const { buildStorageFromBundle } = require('./profile-bridge');

const lastFired = new Map();

function irctcActionFromUrl(url) {
  if (!url || !url.includes('irctc.co.in')) return null;
  if (!url.includes('/nget') && !url.includes('/eticket')) return null;
  if (url.includes('booking-confirm')) return 'showPnrAnimation';
  if (url.includes('booking/train-list')) return 'selectJourney';
  if (url.includes('booking/psgninput')) return 'fillPassengerDetails';
  if (url.includes('booking/reviewBooking')) return 'reviewBooking';
  if (url.includes('payment/bkgPaymentOptions')) return 'bkgPaymentOptions';
  return null;
}

function siteFromUrl(url) {
  if (!url) return null;
  if (url.includes('/nget')) return 'nget';
  if (url.includes('/eticket')) return 'eticket';
  return null;
}

function wrapPageScript(source) {
  return `(function (chrome) {\n${source}\n})(window.__ocRt);`;
}

function readInject(name) {
  return fs.readFileSync(path.join(__dirname, 'inject', name), 'utf8');
}

async function injectScriptSource(webContents, source) {
  // executeJavaScript bypasses page CSP; <script> tag inject often blocked on IRCTC
  await webContents.executeJavaScript(`${source}\n;void 0;`, true);
}

async function installElectronDirectBookBridge(webContents) {
  await webContents.executeJavaScript(
    `(() => {
      if (
        typeof window.__lexusNativeDirectBook === 'function' &&
        typeof window.__lexusWaitPtFareProceed === 'function' &&
        typeof window.__lexusWaitIfSiblingInit === 'function' &&
        typeof window.__lexusMarkInitPaymentSuccess === 'function' &&
        typeof window.__lexusReportBookingFull === 'function'
      ) {
        return true;
      }
      let reqId = 0;
      const pending = new Map();
      window.addEventListener('message', (ev) => {
        try {
          const d = ev.data;
          if (!d || d.source !== 'oc-nw-reply' || d.id == null) return;
          const p = pending.get(d.id);
          if (!p) return;
          pending.delete(d.id);
          if (d.ok) p.resolve(d.result);
          else p.reject(new Error(d.error || 'bridge failed'));
        } catch (_) {}
      });
      if (typeof window.__lexusNativeDirectBook !== 'function') {
      try {
        Object.defineProperty(window, '__lexusNativeDirectBook', {
          value: (payload) =>
            new Promise((resolve, reject) => {
              const id = ++reqId;
              const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error('direct-book timeout'));
              }, 600000);
              pending.set(id, {
                resolve: (v) => {
                  clearTimeout(timer);
                  resolve(v);
                },
                reject: (e) => {
                  clearTimeout(timer);
                  reject(e);
                },
              });
              window.postMessage(
                {
                  source: 'oc-nw',
                  id,
                  action: 'direct-book',
                  mode: (payload && payload.mode) || 'full',
                  tokens: (payload && payload.tokens) || {},
                  details: (payload && payload.details) || {},
                  captchaCreds: (payload && payload.captchaCreds) || {},
                  wsUser: (payload && payload.wsUser) || '',
                  clientTxnId: (payload && payload.clientTxnId) || '',
                },
                '*'
              );
            }),
          writable: true,
          configurable: true,
          enumerable: false,
        });
      } catch (_) {
        window.__lexusNativeDirectBook = async (payload) => {
          throw new Error('direct host bridge install failed');
        };
      }
      }
      if (typeof window.__lexusWaitPtFareProceed !== 'function') {
      try {
        Object.defineProperty(window, '__lexusWaitPtFareProceed', {
          value: (payload) =>
            new Promise((resolve, reject) => {
              const id = ++reqId;
              const timer = setTimeout(() => {
                pending.delete(id);
                resolve(false);
              }, 600000);
              pending.set(id, {
                resolve: (v) => {
                  clearTimeout(timer);
                  resolve(Boolean(v));
                },
                reject: (e) => {
                  clearTimeout(timer);
                  reject(e);
                },
              });
              window.postMessage(
                {
                  source: 'oc-nw',
                  id,
                  action: 'pt-fare-wait',
                  amount: (payload && payload.amount) || 0,
                  maxFare: (payload && payload.maxFare) || 0,
                },
                '*'
              );
            }),
          writable: true,
          configurable: true,
          enumerable: false,
        });
      } catch (_) {}
      }
      if (typeof window.__lexusWaitIfSiblingInit !== 'function') {
      try {
        Object.defineProperty(window, '__lexusWaitIfSiblingInit', {
          value: () =>
            new Promise((resolve, reject) => {
              const id = ++reqId;
              const timer = setTimeout(() => {
                pending.delete(id);
                resolve(true);
              }, 600000);
              pending.set(id, {
                resolve: (v) => {
                  clearTimeout(timer);
                  resolve(v !== false);
                },
                reject: (e) => {
                  clearTimeout(timer);
                  reject(e);
                },
              });
              window.postMessage({ source: 'oc-nw', id, action: 'sibling-init-wait' }, '*');
            }),
          writable: true,
          configurable: true,
          enumerable: false,
        });
      } catch (_) {}
      }
      if (typeof window.__lexusMarkInitPaymentSuccess !== 'function') {
      try {
        Object.defineProperty(window, '__lexusMarkInitPaymentSuccess', {
          value: () =>
            new Promise((resolve, reject) => {
              const id = ++reqId;
              const timer = setTimeout(() => {
                pending.delete(id);
                resolve({ ok: false });
              }, 30000);
              pending.set(id, {
                resolve: (v) => {
                  clearTimeout(timer);
                  resolve(v);
                },
                reject: (e) => {
                  clearTimeout(timer);
                  reject(e);
                },
              });
              window.postMessage({ source: 'oc-nw', id, action: 'mark-init-payment' }, '*');
            }),
          writable: true,
          configurable: true,
          enumerable: false,
        });
      } catch (_) {}
      }
      if (typeof window.__lexusReportBookingFull !== 'function') {
      try {
        Object.defineProperty(window, '__lexusReportBookingFull', {
          value: (fullData) =>
            new Promise((resolve, reject) => {
              const id = ++reqId;
              const timer = setTimeout(() => {
                pending.delete(id);
                resolve(false);
              }, 15000);
              pending.set(id, {
                resolve: (v) => {
                  clearTimeout(timer);
                  resolve(v);
                },
                reject: (e) => {
                  clearTimeout(timer);
                  reject(e);
                },
              });
              window.postMessage(
                {
                  source: 'oc-nw',
                  id,
                  action: 'booking-full',
                  fullData: fullData || null,
                },
                '*'
              );
            }),
          writable: true,
          configurable: true,
          enumerable: false,
        });
      } catch (_) {
        window.__lexusReportBookingFull = async () => false;
      }
      }
      return true;
    })();`,
    true
  );
}

async function injectAutomation(webContents, bundle, mode = 'nget') {
  if (!webContents || webContents.isDestroyed()) return false;
  const isDirect = mode === 'direct';
  const site = isDirect ? 'nget' : siteFromUrl(webContents.getURL()) || 'nget';
  const storage = buildStorageFromBundle(bundle);
  const storageJson = JSON.stringify(storage);

  // Non-enumerable storage — less visible to page fingerprint scans
  await webContents.executeJavaScript(
    `(() => {
      const data = ${storageJson};
      try {
        Object.defineProperty(window, '__LEXUS_STORAGE__', {
          value: data, writable: true, configurable: true, enumerable: false
        });
      } catch (_) {
        window.__LEXUS_STORAGE__ = data;
      }
      ${
        isDirect
          ? `try {
        Object.defineProperty(window, '__LEXUS_DIRECT_BOOK__', {
          value: true, writable: false, configurable: true, enumerable: false
        });
      } catch (_) { window.__LEXUS_DIRECT_BOOK__ = true; }`
          : ''
      }
      return true;
    })();`,
    true
  );

  await injectScriptSource(webContents, readInject('chrome-shim.js'));

  if (isDirect) {
    await installElectronDirectBookBridge(webContents);
  }

  await webContents.executeJavaScript(
    `(() => {
      function pushPanelStatus(text) {
        const line = String(text || '').trim();
        if (!line) return;
        try {
          window.postMessage({ source: 'oc-nw', id: -1, action: 'status', text: line }, '*');
        } catch (_) {}
      }
      try {
        Object.defineProperty(window, '__lexusPushPanelStatus', {
          value: pushPanelStatus,
          writable: true,
          configurable: true,
          enumerable: false,
        });
      } catch (_) {
        window.__lexusPushPanelStatus = pushPanelStatus;
      }
      return true;
    })();`,
    true
  );

  const bridgeOk = await webContents.executeJavaScript(
    `Boolean(window.chrome && window.chrome.runtime && typeof window.chrome.runtime.sendMessage === 'function')`,
    true
  );
  if (!bridgeOk) {
    console.error('[LEXUS Auto] chrome.runtime bridge missing after shim');
  }

  const injectFlag = isDirect
    ? '__LEXUS_DIRECT_INJECTED__'
    : site === 'nget'
      ? '__LEXUS_NGET_INJECTED__'
      : '__LEXUS_BETA_INJECTED__';

  const already = await webContents.executeJavaScript(
    `(() => {
      try {
        const d = Object.getOwnPropertyDescriptor(window, ${JSON.stringify(injectFlag)});
        return Boolean(d && d.value);
      } catch (_) {
        return Boolean(window[${JSON.stringify(injectFlag)}]);
      }
    })();`,
    true
  );

    if (isDirect) {
      await injectScriptSource(webContents, readInject('booking_direct.js'));
      await injectScriptSource(webContents, readInject('ewallet_direct.js'));
      // phonepe_qr.js stays on Direct Host only (PaymentRedirect off IRCTC tab)
      const needBoot = await webContents.executeJavaScript(
        `(() => typeof window.__lexusTryStartDirect !== 'function')();`,
        true
      );
      if (needBoot) {
        await injectScriptSource(webContents, readInject('direct_book_boot.js'));
      } else {
        await webContents.executeJavaScript(
          `(() => {
            try {
              if (!window.__LEXUS_LOGIN_OK__) return true;
              if (window.__LEXUS_DIRECT_PIPELINE_DONE__) return true;
              if (window.__LEXUS_PENDING_DIRECT__ || (JSON.parse(localStorage.getItem('ir:tokens')||'{}').access_token)) {
                if (typeof window.__lexusTryStartDirect === 'function') {
                  window.__lexusTryStartDirect('reinject');
                }
              }
            } catch (_) {}
            return true;
          })();`,
          true
        );
      }
    }

  if (!already) {
    const scriptName = site === 'nget' ? 'content_script.js' : 'content_script_beta.js';
    await webContents.executeJavaScript(
      `(() => {
        try {
          Object.defineProperty(window, ${JSON.stringify(injectFlag)}, {
            value: true, writable: false, configurable: true, enumerable: false
          });
        } catch (_) {
          window[${JSON.stringify(injectFlag)}] = true;
        }
        return true;
      })();`,
      true
    );
    await injectScriptSource(webContents, wrapPageScript(readInject(scriptName)));
    await webContents.executeJavaScript(`(() => { try { delete window.__ocRt; } catch (_) {} })();`, true);
    console.log('[LEXUS Auto]', isDirect ? 'direct' : site, 'injected, bridge=', bridgeOk);
  } else {
    console.log('[LEXUS Auto] already injected — storage refreshed, bridge=', bridgeOk);
  }

  // Re-hide bridge / lexus keys after inject
  await webContents.executeJavaScript(
    `(() => {
      for (const k of Object.getOwnPropertyNames(window)) {
        if (k.indexOf('__lexus') === 0 || k.indexOf('__LEXUS') === 0 || k === 'lexusBridge') {
          try {
            const v = window[k];
            Object.defineProperty(window, k, {
              value: v, writable: true, configurable: true, enumerable: false
            });
          } catch (_) {}
        }
      }
      return true;
    })();`,
    true
  );

  return true;
}

async function dispatchBetaAction(webContents, action) {
  if (!webContents || webContents.isDestroyed() || !action) return;
  try {
    await webContents.executeJavaScript(
      `(() => {
        if (typeof window.__lexusDispatchMessage === 'function') {
          window.__lexusDispatchMessage({
            id: 'irctc',
            sender: 'electron',
            beta: false,
            msg: { type: ${JSON.stringify(action)}, data: null }
          });
          return true;
        }
        return false;
      })();`,
      true
    );
  } catch (e) {
    console.warn('[LEXUS Auto] dispatch failed', action, e.message);
  }
}

function routeUrl(sessionId, webContents, url) {
  const action = irctcActionFromUrl(url);
  if (!action) return;

  const key = `${sessionId}:${action}`;
  const now = Date.now();
  let debounceMs = 2500;
  if (action === 'reviewBooking' || action === 'bkgPaymentOptions') debounceMs = 800;
  if (action === 'showPnrAnimation') debounceMs = 8000;
  if (lastFired.has(key) && now - lastFired.get(key) < debounceMs) return;
  lastFired.set(key, now);

  console.log('[LEXUS Auto] URL →', action, url);
  setTimeout(() => {
    dispatchBetaAction(webContents, action);
  }, action === 'reviewBooking' ? 1200 : action === 'bkgPaymentOptions' ? 800 : 600);
}

function attachAutomation(sessionId, win, bundle, opts = {}) {
  const wc = win.webContents;
  let injected = false;
  let injecting = false;
  const runMode = opts.mode || 'nget';
  // Extra settle after grace (first paint already waited in session-manager)
  const firstDelayMs = opts.graceAlreadyWaited ? 800 : 5000;

  const tryInject = async (reason) => {
    if (wc.isDestroyed() || injecting) return;
    const url = wc.getURL();
    const site = siteFromUrl(url);
    if (!site) {
      console.log('[LEXUS Auto] skip inject (not nget/eticket):', url);
      return;
    }
    // Never inject on about:blank
    if (url === 'about:blank' || url.startsWith('about:')) return;

    injecting = true;
    try {
      console.log('[LEXUS Auto] inject', reason, runMode, url);
      await injectAutomation(wc, bundle, runMode);
      injected = true;
      // Direct mode: no beta URL router (API books after login)
      if (runMode !== 'direct') routeUrl(sessionId, wc, url);
    } catch (e) {
      console.error('[LEXUS Auto] inject failed', e);
    } finally {
      injecting = false;
    }
  };

  wc.on('did-finish-load', () => {
    if (!injected) {
      setTimeout(() => tryInject('did-finish-load'), firstDelayMs);
    } else {
      tryInject('did-finish-load-refresh');
    }
  });

  wc.on('did-navigate', (_e, url) => {
    if (injected && runMode !== 'direct') routeUrl(sessionId, wc, url);
  });

  wc.on('did-navigate-in-page', (_e, url) => {
    if (injected && runMode !== 'direct') routeUrl(sessionId, wc, url);
  });

  // Kick once if page already loaded when we attach after grace
  setTimeout(() => tryInject('attach-kick'), firstDelayMs);
}

module.exports = {
  irctcActionFromUrl,
  betaActionFromUrl: irctcActionFromUrl,
  injectAutomation,
  dispatchBetaAction,
  attachAutomation,
};
