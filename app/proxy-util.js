/**
 * Proxy config helpers for System Chrome / Electron sessions.
 * Credentials never go on the Chrome command line (STAR parity: local tunnel).
 */

function normalizeProxyType(type) {
  const t = String(type || 'http').trim().toLowerCase();
  if (t === 'socks5' || t === 'socks' || t === 'socks5h') return 'socks5';
  if (t === 'https') return 'https';
  return 'http';
}

/** Reject IPs like 13.2067.253.131 (octet > 255) — Chrome → ERR_NO_SUPPORTED_PROXIES */
function validateProxyHost(host) {
  const h = String(host || '').trim();
  if (!h) return { ok: false, error: 'Proxy host empty' };
  if (/[\/\s]/.test(h) || h.includes('@')) {
    return { ok: false, error: 'Host me URL/user mat likho — sirf IP ya domain' };
  }
  // Any dotted-quad that looks like IPv4 (even with fat octets)
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const parts = h.split('.').map((x) => Number(x));
    if (parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) {
      return {
        ok: false,
        error: `Invalid IPv4 "${h}" (har number 0–255 hona chahiye). Example: 13.206.7.253`,
      };
    }
  }
  return { ok: true };
}

/**
 * Accept pasted STAR format in host field: host:port:user:password
 * Always expands when host looks like a multi-part proxy string.
 */
function expandStarProxyPaste(raw = {}) {
  let hostField = String(raw.host || '').trim();
  if (!hostField) return raw;

  // Strip scheme: http:// / https:// / socks5://
  let typeHint = '';
  const scheme = hostField.match(/^(socks5h?|https?):\/\//i);
  if (scheme) {
    typeHint = scheme[1].toLowerCase().startsWith('socks') ? 'socks5' : scheme[1].toLowerCase();
    hostField = hostField.replace(/^(socks5h?|https?):\/\//i, '');
  }

  // user:pass@host:port
  if (hostField.includes('@')) {
    const at = hostField.lastIndexOf('@');
    const cred = hostField.slice(0, at);
    const rest = hostField.slice(at + 1);
    const ci = cred.indexOf(':');
    const user = ci >= 0 ? cred.slice(0, ci) : cred;
    const pass = ci >= 0 ? cred.slice(ci + 1) : '';
    const colon = rest.lastIndexOf(':');
    if (colon > 0 && /^\d+$/.test(rest.slice(colon + 1))) {
      return {
        ...raw,
        type: typeHint || raw.type || 'http',
        host: rest.slice(0, colon),
        port: rest.slice(colon + 1),
        username: user,
        password: pass,
      };
    }
  }

  const parts = hostField.split(':');
  // host:port:user:password(+optional : in password)
  if (parts.length >= 4 && /^\d+$/.test(parts[1])) {
    return {
      ...raw,
      type: typeHint || raw.type || 'http',
      host: parts[0],
      port: parts[1],
      username: parts[2],
      password: parts.slice(3).join(':'),
    };
  }
  // host:port:user
  if (parts.length === 3 && /^\d+$/.test(parts[1])) {
    return {
      ...raw,
      type: typeHint || raw.type || 'http',
      host: parts[0],
      port: parts[1],
      username: parts[2],
      password: raw.password != null ? raw.password : '',
    };
  }
  // host:port
  if (parts.length === 2 && /^\d+$/.test(parts[1])) {
    return {
      ...raw,
      type: typeHint || raw.type || 'http',
      host: parts[0],
      port: parts[1],
      username: '',
      password: '',
    };
  }
  return raw;
}

/**
 * Parse stored proxy fields (Settings) — no global enable flag.
 */
function parseStoredProxy(raw = {}) {
  const expanded = expandStarProxyPaste(raw);
  const host = String(expanded.host || '').trim();
  const portNum = Number(expanded.port);
  const port =
    Number.isFinite(portNum) && portNum > 0 && portNum <= 65535 ? Math.floor(portNum) : 0;
  return {
    type: normalizeProxyType(expanded.type),
    host,
    port,
    username: String(expanded.username || '').trim(),
    password: String(expanded.password || ''),
  };
}

function hasStoredProxyData(stored) {
  const s = parseStoredProxy(stored);
  if (!s.host || !s.port) return false;
  const v = validateProxyHost(s.host);
  return v.ok;
}

/**
 * @param {object} raw
 * @returns {{ enabled:boolean, type:string, host:string, port:number, username:string, password:string, error?:string }}
 */
function normalizeProxyConfig(raw = {}) {
  const stored = parseStoredProxy(raw);
  const want =
    raw.enabled === true || raw.enabled === '1' || raw.enabled === 1;
  let error = '';
  if (want) {
    if (!stored.host || !stored.port) error = 'Proxy host + port required';
    else {
      const v = validateProxyHost(stored.host);
      if (!v.ok) error = v.error;
    }
  }
  const enabled = Boolean(want && stored.host && stored.port && !error);
  return { ...stored, enabled, error };
}

/**
 * Chrome --proxy-server value (no credentials).
 * Prefer host:port for HTTP (STAR / Chromium-friendly). Auth → local tunnel instead.
 */
function chromeProxyServerArg(cfg) {
  const c = normalizeProxyConfig(cfg);
  if (!c.enabled) return null;
  if (c.type === 'socks5') return `socks5://${c.host}:${c.port}`;
  // HTTP(S) proxy: host:port without credentials (scheme optional; host:port most reliable)
  return `${c.host}:${c.port}`;
}

/** Electron session.setProxy({ proxyRules }). */
function electronProxyRules(cfg) {
  const c = normalizeProxyConfig(cfg);
  if (!c.enabled) return null;
  if (c.type === 'socks5') return `socks5://${c.host}:${c.port}`;
  return `http=${c.host}:${c.port};https=${c.host}:${c.port}`;
}

function hasProxyAuth(cfg) {
  const c = normalizeProxyConfig(cfg);
  return Boolean(c.enabled && c.username);
}

/**
 * Journey / panel IP mode:
 * - auto  → Home IP (no proxy for this run)
 * - proxy → use saved Settings proxy (host/port must be saved; no global enable toggle)
 */
function resolveProxyForIpMode(ipMode, proxyCfg) {
  const mode = String(ipMode || 'auto').trim().toLowerCase() === 'proxy' ? 'proxy' : 'auto';
  const stored = parseStoredProxy(proxyCfg || {});

  if (mode === 'auto') {
    return {
      ...stored,
      enabled: false,
      ipMode: 'auto',
    };
  }

  if (!hasStoredProxyData(stored)) {
    const v = stored.host ? validateProxyHost(stored.host) : { ok: false };
    return {
      ...stored,
      enabled: false,
      ipMode: 'proxy',
      error:
        v.error ||
        'Panel me Proxy select hai — Settings me proxy host/port save karo.',
    };
  }

  return { ...stored, enabled: true, ipMode: 'proxy' };
}

/**
 * Live proxy check — GET IRCTC train-search via proxy (browser-like headers).
 * ipify is not enough: IRCTC/Akamai may block proxies that still pass generic IP APIs.
 * HAR (HTTP Toolkit): real nav uses Chrome UA + Sec-Fetch-* on www.irctc.co.in/nget(/train-search).
 *
 * @param {object} rawCfg — { host, port, username, password, type } or string paste in host
 * @returns {Promise<{ ok:boolean, ip?:string, ms?:number, status?:number, error?:string, url?:string }>}
 */
async function testProxyConnectivity(rawCfg = {}) {
  const expanded = expandStarProxyPaste(rawCfg);
  const stored = parseStoredProxy(expanded);
  if (!stored.host || !stored.port) {
    return { ok: false, error: 'Proxy string: host:port ya host:port:user:pass' };
  }
  const v = validateProxyHost(stored.host);
  if (!v.ok) return { ok: false, error: v.error };

  if (stored.type === 'socks5') {
    return { ok: false, error: 'SOCKS5 test baad me — HTTP proxy string use karo' };
  }

  const auth =
    stored.username
      ? `${encodeURIComponent(stored.username)}:${encodeURIComponent(stored.password || '')}@`
      : '';
  const proxyUrl = `http://${auth}${stored.host}:${stored.port}`;
  const checkUrl = 'https://www.irctc.co.in/nget/train-search';
  // Headers from successful Chrome → IRCTC document request (HAR), without session cookies
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    'Upgrade-Insecure-Requests': '1',
    'sec-ch-ua': '"Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-User': '?1',
    'Sec-Fetch-Dest': 'document',
  };

  const t0 = Date.now();
  try {
    const { ProxyAgent, fetch: undiciFetch } = require('undici');
    const agent = new ProxyAgent(proxyUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    let res;
    try {
      res = await undiciFetch(checkUrl, {
        dispatcher: agent,
        signal: controller.signal,
        headers,
        redirect: 'follow',
      });
    } finally {
      clearTimeout(timer);
      try {
        await agent.close();
      } catch (_) {}
    }
    const ms = Date.now() - t0;
    const status = res.status;
    const text = await res.text();
    const body = String(text || '');
    const looksIrctc =
      /irctc/i.test(body) ||
      /train-search/i.test(body) ||
      /Indian Railway Catering/i.test(body) ||
      /nget/i.test(body);
    if (status >= 200 && status < 400 && looksIrctc) {
      return {
        ok: true,
        status,
        ms,
        host: stored.host,
        port: stored.port,
        url: checkUrl,
        ip: `${stored.host}:${stored.port}`,
      };
    }
    if (status >= 200 && status < 400 && !looksIrctc) {
      return {
        ok: false,
        status,
        ms,
        url: checkUrl,
        error: `Proxy reached host but IRCTC HTML nahi mila (HTTP ${status})`,
      };
    }
    return {
      ok: false,
      status,
      ms,
      url: checkUrl,
      error: `IRCTC Check fail — HTTP ${status}`,
    };
  } catch (e) {
    const msg = e && e.name === 'AbortError' ? 'Proxy timeout (25s)' : e?.message || String(e);
    return { ok: false, error: msg, ms: Date.now() - t0, url: checkUrl };
  }
}

module.exports = {
  normalizeProxyConfig,
  chromeProxyServerArg,
  electronProxyRules,
  hasProxyAuth,
  resolveProxyForIpMode,
  parseStoredProxy,
  hasStoredProxyData,
  normalizeProxyType,
  validateProxyHost,
  expandStarProxyPaste,
  testProxyConnectivity,
};
