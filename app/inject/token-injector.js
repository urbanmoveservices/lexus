// === IRCTC TOKEN COLLECTOR (Electron fallback only) ===
// System Chrome/Brave use CDP harvest (irctc-network.js) — no fetch/XHR hooks there.
(() => {
  if (window.__IR_INJECTOR_READY__) return;
  try {
    Object.defineProperty(window, '__IR_INJECTOR_READY__', {
      value: true,
      writable: false,
      configurable: true,
      enumerable: false,
    });
  } catch (_) {
    window.__IR_INJECTOR_READY__ = true;
  }

  const LS_KEY = 'ir:tokens';
  const debug = Boolean(window.__OCEAN_DEBUG__);

  const loadLS = () => {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    } catch {
      return {};
    }
  };
  const mirrorToLocalStorage = (obj) => {
    try {
      const cur = loadLS();
      const merged = { ...cur, ...obj, lastUpdated: new Date().toISOString() };
      localStorage.setItem(LS_KEY, JSON.stringify(merged));
      try {
        window.dispatchEvent(
          new CustomEvent('ocean-tokens-updated', { detail: { keys: Object.keys(obj || {}) } })
        );
      } catch (_) {}
      if (window.__OCEAN_DIRECT_BOOK__ && merged.access_token) {
        if (window.__OCEAN_DIRECT_PIPELINE_DONE__) return;
        if (!window.__OCEAN_LOGIN_OK__) {
          try {
            window.__OCEAN_PENDING_DIRECT__ = true;
          } catch (_) {}
        } else if (typeof window.__oceanTryStartDirect === 'function') {
          window.__oceanTryStartDirect('injector');
        } else if (typeof window.__oceanStartDirectBook === 'function') {
          window.__oceanStartDirectBook();
        }
      }
    } catch (_) {}
  };
  const postToExt = (obj) => {
    try {
      window.postMessage({ type: 'FROM_IRCTC_PAGE', tokenPart: obj }, '*');
    } catch (_) {}
  };
  const save = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    postToExt(obj);
    mirrorToLocalStorage(obj);
  };

  const norm = (headers) => {
    const out = {};
    if (!headers) return out;
    try {
      if (headers instanceof Headers) {
        for (const [k, v] of headers.entries()) out[k.toLowerCase()] = v;
      } else if (Array.isArray(headers)) {
        headers.forEach((h) => {
          if (h && h.name) out[String(h.name).toLowerCase()] = h.value;
        });
      } else {
        Object.entries(headers).forEach(([k, v]) => (out[String(k).toLowerCase()] = v));
      }
    } catch (_) {}
    return out;
  };

  const parseUrl = (u) => {
    try {
      return new URL(u, location.origin);
    } catch {
      return null;
    }
  };
  const isIR = (U) =>
    !!U &&
    (U.hostname === 'www.irctc.co.in' ||
      U.hostname.endsWith('.irctc.co.in') ||
      U.hostname === 'irctc.co.in');
  const isWebToken = (U) => isIR(U) && U.pathname.includes('/authprovider/webtoken');
  const isMapps = (U) => isIR(U) && U.pathname.includes('/eticketing/protected/mapps1/');

  function extractWsUserLoginFromBody(body) {
    try {
      if (!body) return;
      if (typeof body === 'string' && body.trim().startsWith('{') && body.length < 200000) {
        const j = JSON.parse(body);
        if (j && typeof j === 'object' && j.wsUserLogin && String(j.wsUserLogin).length > 0) {
          save({ wsUserLogin: String(j.wsUserLogin) });
        }
      }
    } catch (_) {}
  }

  function upsertFromRequest(url, method, reqHeaders, bodyOpt) {
    const U = parseUrl(url);
    const h = norm(reqHeaders);
    const next = {};
    if (isMapps(U) && h['authorization'] && /^bearer\s+(.+)/i.test(h['authorization']))
      next.access_token = RegExp.$1;
    if (h['bmiyek']) next.refresh_token = h['bmiyek'];
    if (h['greq']) next.greq = h['greq'];
    if (h['spa-csrf-token']) next.csrf = h['spa-csrf-token'];
    if (Object.keys(next).length) save(next);
    if (bodyOpt) extractWsUserLoginFromBody(bodyOpt);
  }

  function upsertFromResponse(url, resHeaders, bodyText) {
    const U = parseUrl(url);
    const h = norm(resHeaders);
    const next = {};
    if (isMapps(U) && h['csrf-token']) next.csrf = h['csrf-token'];
    if (h['akamai-grn']) next.akamai_grn = h['akamai-grn'];
    if (isWebToken(U) && bodyText && /application\/json/i.test(h['content-type'] || '')) {
      try {
        const j = JSON.parse(bodyText);
        if (j.access_token) next.access_token = j.access_token;
        if (j.refresh_token) next.refresh_token = j.refresh_token;
      } catch (_) {}
    }
    if (Object.keys(next).length) save(next);
  }

  if (!window.__IR_FETCH_HOOKED__) {
    const _fetch = window.fetch;
    window.fetch = async function (...args) {
      const [input, init = {}] = args;
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const method =
        (init && init.method) || (typeof input !== 'string' ? input.method : 'GET') || 'GET';
      try {
        const hdrs =
          init && init.headers ? init.headers : typeof input !== 'string' ? input.headers : undefined;
        const body = init && init.body ? init.body : undefined;
        upsertFromRequest(url, method, hdrs, body);
      } catch (_) {}
      const res = await _fetch.apply(this, args);
      const clone = res.clone();
      let bodyText = '';
      try {
        const U = parseUrl(url);
        const ct = clone.headers.get('content-type') || '';
        if (isWebToken(U) || /application\/json/i.test(ct)) {
          bodyText = await clone.text();
        }
      } catch (_) {}
      try {
        upsertFromResponse(url, clone.headers, bodyText);
      } catch (_) {}
      return res;
    };
    try {
      Object.defineProperty(window, '__IR_FETCH_HOOKED__', {
        value: true,
        writable: false,
        configurable: true,
        enumerable: false,
      });
    } catch (_) {
      window.__IR_FETCH_HOOKED__ = true;
    }
    if (debug) console.log('[IR] fetch hook installed');
  }

  if (!window.__IR_XHR_HOOKED__) {
    const _open = XMLHttpRequest.prototype.open;
    const _send = XMLHttpRequest.prototype.send;
    const _set = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.___ir = { url, method, reqHeaders: {}, body: null };
      return _open.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
      try {
        this.___ir = this.___ir || { reqHeaders: {} };
        this.___ir.reqHeaders[String(k)] = v;
      } catch (_) {}
      return _set.call(this, k, v);
    };
    XMLHttpRequest.prototype.send = function (body) {
      try {
        this.___ir.body = body;
        upsertFromRequest(this.___ir.url, this.___ir.method, this.___ir.reqHeaders, body);
      } catch (_) {}
      this.addEventListener('load', function () {
        try {
          const raw = this.getAllResponseHeaders() || '';
          const headersObj = {};
          raw.trim().split(/\r?\n/).forEach((l) => {
            const i = l.indexOf(':');
            if (i > 0) headersObj[l.slice(0, i).trim()] = l.slice(i + 1).trim();
          });
          const bodyText =
            this.responseType === '' || this.responseType === 'text' ? this.responseText : '';
          upsertFromResponse((this.___ir && this.___ir.url) || '', headersObj, bodyText);
        } catch (_) {}
      });
      return _send.call(this, body);
    };
    try {
      Object.defineProperty(window, '__IR_XHR_HOOKED__', {
        value: true,
        writable: false,
        configurable: true,
        enumerable: false,
      });
    } catch (_) {
      window.__IR_XHR_HOOKED__ = true;
    }
    if (debug) console.log('[IR] XHR hook installed');
  }

  try {
    const digOnce = () => {
      try {
        const cur = loadLS();
        if (cur.access_token) return;
        for (const store of [localStorage, sessionStorage]) {
          for (let i = 0; i < store.length; i++) {
            const k = store.key(i);
            const v = store.getItem(k);
            if (!v || v.length < 20) continue;
            try {
              const j = JSON.parse(v);
              if (j && j.access_token) {
                save({
                  access_token: j.access_token,
                  refresh_token: j.refresh_token || j.bmiyek,
                  greq: j.greq,
                  csrf: j.csrf,
                });
                return;
              }
            } catch (_) {
              if (/^eyJ/.test(v) && /token|atk|auth/i.test(k || '')) save({ access_token: v });
            }
          }
        }
      } catch (_) {}
    };
    digOnce();
    setInterval(digOnce, 2000);
  } catch (_) {}
})();
