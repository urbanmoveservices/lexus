/**
 * Injected ONLY after launch grace period (not at first paint).
 * Bridges chrome.runtime → postMessage → isolated preload → sendInputEvent.
 * Does not expose __lexusNative on window.
 */
(function () {
  function hideProp(obj, key, value) {
    try {
      Object.defineProperty(obj, key, {
        value,
        writable: true,
        configurable: true,
        enumerable: false,
      });
    } catch (_) {
      try {
        obj[key] = value;
      } catch (_) {}
    }
  }

  try {
    const already = Object.getOwnPropertyDescriptor(window, '__ocShim');
    if (already && already.value) return;
  } catch (_) {}
  hideProp(window, '__ocShim', true);

  // Snapshot System Chrome bridge names once (Node deletes bag after inject)
  let brSnap = null;
  try {
    const bag = window.__ocBr;
    if (bag && typeof bag === 'object') brSnap = { c: bag.c, t: bag.t, k: bag.k, s: bag.s };
  } catch (_) {}
  try {
    delete window.__ocBr;
  } catch (_) {}

  const msgListeners = [];
  let lastError = null;
  let storage = {};
  let reqId = 0;
  const pending = new Map();

  try {
    const prev = Object.getOwnPropertyDescriptor(window, '__LEXUS_STORAGE__');
    if (prev && prev.value && typeof prev.value === 'object') storage = prev.value;
  } catch (_) {}

  function setLastError(err) {
    lastError = err ? { message: err.message || String(err) } : null;
  }

  function nativeCall(action, payload) {
    const clickFn =
      (brSnap && typeof window[brSnap.c] === 'function' && window[brSnap.c]) ||
      (typeof window.__ocNativeClick === 'function' && window.__ocNativeClick) ||
      null;
    const typeFn =
      (brSnap && typeof window[brSnap.t] === 'function' && window[brSnap.t]) ||
      (typeof window.__ocNativeType === 'function' && window.__ocNativeType) ||
      null;
    const keyFn =
      (brSnap && typeof window[brSnap.k] === 'function' && window[brSnap.k]) ||
      (typeof window.__ocNativeKey === 'function' && window.__ocNativeKey) ||
      null;
    const statusFn =
      (brSnap && typeof window[brSnap.s] === 'function' && window[brSnap.s]) || null;

    if (action === 'click' && clickFn) {
      return clickFn(
        payload.selector,
        payload.offsetXPercent ?? 50,
        payload.offsetYPercent ?? 50
      );
    }
    if (action === 'type' && typeFn) {
      return typeFn(payload.selector, payload.text ?? '');
    }
    if (action === 'key' && keyFn) {
      return keyFn(payload.key);
    }
    if (action === 'status' && statusFn) {
      statusFn(payload.text ?? '');
      return Promise.resolve({ success: true });
    }

    // Electron: postMessage → isolated preload
    return new Promise((resolve, reject) => {
      const id = ++reqId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('native timeout'));
      }, 60000);
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
      window.postMessage({ source: 'oc-nw', id, action, ...payload }, '*');
    });
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.source !== 'oc-nw-reply') return;
    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);
    if (data.ok) p.resolve(data.result || { success: true });
    else p.reject(new Error(data.error || 'native failed'));
  });

  const runtimeApi = {};
  Object.defineProperty(runtimeApi, 'lastError', {
    get() {
      return lastError;
    },
    configurable: true,
  });

  const STATUS_LABELS = {
    loadLoginDetails: 'Filling login…',
    directApiStart: 'Starting Direct API…',
    loadJourneyDetails: 'Filling journey…',
    selectJourney: 'Selecting train…',
    fillPassengerDetails: 'Passengers…',
    reviewBooking: 'Review booking…',
    bkgPaymentOptions: 'Payment…',
  };

  runtimeApi.sendMessage = function (msg, callback) {
    const cb = typeof callback === 'function' ? callback : () => {};
    setLastError(null);
    const type = msg && msg.type;
    const innerType = (msg && msg.msg && msg.msg.type) || type;

    if (innerType === 'status_update' || innerType === 'panel_status') {
      const data = (msg && msg.msg && msg.msg.data) || (msg && msg.data) || {};
      let text = data.status || data.text || '';
      if (text && STATUS_LABELS[text]) text = STATUS_LABELS[text];
      if (text) {
        nativeCall('status', { text: String(text) })
          .catch(() => {})
          .finally(() => cb({ success: true }));
        return;
      }
    }

    if (type === 'DEBUGGER_CLICK') {
      try {
        const el = document.querySelector(msg.selector);
        if (el) {
          const t = ((el.innerText || el.textContent || '') + '')
            .replace(/\s+/g, ' ')
            .trim()
            .toUpperCase();
          if (
            t === 'LOGOUT' ||
            t === 'SIGN OUT' ||
            t === 'LOG OUT' ||
            (/\bLOG\s*OUT\b/.test(t) && t.length < 24)
          ) {
            setLastError(new Error('Refusing to click LOGOUT'));
            cb({ success: false, error: 'Refusing to click LOGOUT' });
            return;
          }
        }
      } catch (_) {}

      nativeCall('click', {
        selector: msg.selector,
        offsetXPercent: msg.offsetXPercent ?? 50,
        offsetYPercent: msg.offsetYPercent ?? 50,
      })
        .then((r) => cb(r || { success: true }))
        .catch((e) => {
          setLastError(e);
          cb({ success: false, error: e.message || String(e) });
        });
      return;
    }

    if (type === 'DEBUGGER_TYPE') {
      nativeCall('type', { selector: msg.selector, text: msg.text ?? '' })
        .then((r) => cb(r || { success: true }))
        .catch((e) => {
          setLastError(e);
          cb({ success: false, error: e.message || String(e) });
        });
      return;
    }

    if (type === 'DEBUGGER_KEY_PRESS') {
      nativeCall('key', { key: msg.key })
        .then(() => cb({ success: true }))
        .catch(() => cb({ success: true }));
      return;
    }

    cb({ success: true });
  };

  runtimeApi.onMessage = {
    addListener(fn) {
      if (typeof fn === 'function') msgListeners.push(fn);
    },
    removeListener(fn) {
      const i = msgListeners.indexOf(fn);
      if (i >= 0) msgListeners.splice(i, 1);
    },
  };

  const storageLocal = {
    get(keys, callback) {
      const cb = typeof callback === 'function' ? callback : () => {};
      const store = storage;
      if (keys == null) {
        cb({ ...store });
        return;
      }
      if (typeof keys === 'string') {
        cb({ [keys]: store[keys] });
        return;
      }
      if (Array.isArray(keys)) {
        const out = {};
        for (const k of keys) out[k] = store[k];
        cb(out);
        return;
      }
      if (typeof keys === 'object') {
        const out = { ...keys };
        for (const k of Object.keys(keys)) {
          if (Object.prototype.hasOwnProperty.call(store, k)) out[k] = store[k];
        }
        cb(out);
        return;
      }
      cb({});
    },
    set(items, callback) {
      storage = { ...storage, ...(items || {}) };
      hideProp(window, '__LEXUS_STORAGE__', storage);
      if (typeof callback === 'function') callback();
    },
  };

  // Hidden bag for content scripts — do NOT put runtime on window.chrome
  // (real Chrome pages usually have chrome.runtime === undefined; fake runtime is an Akamai tell)
  hideProp(window, '__ocRt', {
    runtime: runtimeApi,
    storage: { local: storageLocal },
  });

  hideProp(window, '__lexusDispatchMessage', function (message) {
    for (const fn of msgListeners.slice()) {
      try {
        fn(message, { id: 'extension' }, () => {});
      } catch (_) {}
    }
  });

  hideProp(window, '__LEXUS_STORAGE__', storage);
})();
