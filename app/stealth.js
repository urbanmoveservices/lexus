/**
 * Phase 2 — Stealth: Chrome-like UA, Client Hints, early fingerprint mask.
 * Version MUST match installed System Chrome (auto-detected). Hardcoding 150
 * while real Chrome is 151 → sec-ch-ua mismatch → Akamai passenger-page block.
 */

const { detectChromeVersion } = require('./chrome-finder');

/** Defaults match current Stable if detect fails — update via syncChromeVersionFromSystem(). */
let SPOOF_CHROME_MAJOR = 151;
/** Reduced UA uses major.0.0.0; full list uses real build when known. */
let SPOOF_CHROME_FULL = '151.0.0.0';
let SPOOF_CHROME_FULL_REAL = '151.0.7922.76';
/**
 * GREASE Not-A-Brand — Chrome 151 sends: "Not=A?Brand";v="99"
 * (older "Not A(Brand";v="24" is a stale spoof tell)
 */
let SPOOF_NOT_A_BRAND = 'Not=A?Brand';
let SPOOF_NOT_A_VERSION = '99';

/**
 * Sync spoof UA/Client-Hints to installed Google Chrome.
 * Call once at app ready BEFORE writeStealthPreload().
 */
function syncChromeVersionFromSystem() {
  const info = detectChromeVersion();
  if (!info || !info.major) {
    console.warn('[Ocean Stealth] Chrome version detect failed — using defaults v' + SPOOF_CHROME_MAJOR);
    return { major: SPOOF_CHROME_MAJOR, full: SPOOF_CHROME_FULL_REAL, detected: false };
  }
  SPOOF_CHROME_MAJOR = info.major;
  SPOOF_CHROME_FULL = `${info.major}.0.0.0`;
  SPOOF_CHROME_FULL_REAL = info.full;
  // Chrome 120+ GREASE pattern used by Stable 151
  if (info.major >= 120) {
    SPOOF_NOT_A_BRAND = 'Not=A?Brand';
    SPOOF_NOT_A_VERSION = '99';
  }
  console.log(
    `[Ocean Stealth] Synced to System Chrome ${info.full} (UA ${SPOOF_CHROME_FULL}, sec-ch-ua v${SPOOF_CHROME_MAJOR})`
  );
  return { major: info.major, full: info.full, detected: true, path: info.path };
}

function getChromeUserAgent() {
  return (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    `Chrome/${SPOOF_CHROME_FULL} Safari/537.36`
  );
}

/** Match real Chrome 151 order: Not=A?Brand, Google Chrome, Chromium */
function getSecChUa() {
  return (
    `"${SPOOF_NOT_A_BRAND}";v="${SPOOF_NOT_A_VERSION}", ` +
    `"Google Chrome";v="${SPOOF_CHROME_MAJOR}", ` +
    `"Chromium";v="${SPOOF_CHROME_MAJOR}"`
  );
}

function getSecChUaFullVersionList() {
  const greaseFull = `${SPOOF_NOT_A_VERSION}.0.0.0`;
  return (
    `"${SPOOF_NOT_A_BRAND}";v="${greaseFull}", ` +
    `"Google Chrome";v="${SPOOF_CHROME_FULL_REAL}", ` +
    `"Chromium";v="${SPOOF_CHROME_FULL_REAL}"`
  );
}

function getClientHintHeaders() {
  return {
    'User-Agent': getChromeUserAgent(),
    'sec-ch-ua': getSecChUa(),
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-ch-ua-platform-version': '"15.0.0"',
    'sec-ch-ua-arch': '"x86"',
    'sec-ch-ua-bitness': '"64"',
    'sec-ch-ua-full-version': `"${SPOOF_CHROME_FULL_REAL}"`,
    'sec-ch-ua-full-version-list': getSecChUaFullVersionList(),
    'sec-ch-ua-model': '""',
  };
}

const LEAKY_HEADER_KEYS = [
  'electron',
  'x-electron',
  'x-devtools',
  'x-puppeteer',
  'x-playwright',
];

/**
 * Apply UA + Client Hint headers on IRCTC (http/https) sessions only.
 * Also registers stealth-only frame preload (before page scripts).
 */
function applyStealthToSession(ses, userAgent) {
  if (!ses || ses.__oceanStealthApplied) return;
  ses.__oceanStealthApplied = true;

  const ua = userAgent || getChromeUserAgent();
  ses.setUserAgent(ua);

  try {
    const { getStealthPreloadPath, writeStealthPreload } = require('./stealth-preload-build');
    writeStealthPreload();
    const filePath = getStealthPreloadPath();
    if (typeof ses.registerPreloadScript === 'function') {
      ses.registerPreloadScript({ type: 'frame', filePath });
    } else if (typeof ses.setPreloads === 'function') {
      const prev = typeof ses.getPreloads === 'function' ? ses.getPreloads() : [];
      ses.setPreloads([...prev, filePath]);
    }
  } catch (e) {
    console.warn('[Ocean Stealth] preload register failed:', e && e.message ? e.message : e);
  }

  const hints = getClientHintHeaders();
  hints['User-Agent'] = ua;

  ses.webRequest.onBeforeSendHeaders(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {
      const headers = { ...details.requestHeaders };
      for (const [k, v] of Object.entries(hints)) {
        headers[k] = v;
        const lower = k.toLowerCase();
        for (const existing of Object.keys(headers)) {
          if (existing !== k && existing.toLowerCase() === lower) {
            delete headers[existing];
            headers[k] = v;
          }
        }
      }
      for (const key of Object.keys(headers)) {
        const lk = key.toLowerCase();
        if (LEAKY_HEADER_KEYS.some((x) => lk === x || lk.includes(x))) {
          delete headers[key];
        }
        if (/electron/i.test(String(headers[key] || ''))) {
          if (lk === 'user-agent') headers[key] = ua;
        }
      }
      callback({ requestHeaders: headers });
    }
  );
}

/**
 * CDP: run stealth on every new document BEFORE any page JS (launch-critical).
 * Call on about:blank, then navigate to IRCTC.
 */
async function installNewDocumentStealth(webContents) {
  if (!webContents || webContents.isDestroyed()) return false;
  const source = getStealthInjectSource();
  try {
    const dbg = webContents.debugger;
    if (dbg.isAttached()) {
      try {
        dbg.detach();
      } catch (_) {}
    }
    dbg.attach('1.3');
    await dbg.sendCommand('Page.enable');
    await dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source });
    try {
      dbg.detach();
    } catch (_) {}
    return true;
  } catch (err) {
    console.warn(
      '[Ocean Stealth] new-document CDP skipped:',
      err && err.message ? err.message : err
    );
    try {
      if (webContents.debugger.isAttached()) webContents.debugger.detach();
    } catch (_) {}
    return false;
  }
}

/**
 * Main-world stealth patch. No Ocean-named globals. webdriver === false (Chrome-like).
 * Idempotent via non-enumerable mark on Navigator.prototype.
 */
function getStealthInjectSource() {
  const major = SPOOF_CHROME_MAJOR;
  const full = SPOOF_CHROME_FULL;
  const fullReal = SPOOF_CHROME_FULL_REAL;
  const notABrand = SPOOF_NOT_A_BRAND;
  const notAVer = SPOOF_NOT_A_VERSION;
  const ua = getChromeUserAgent();

  return `(() => {
  try {
    const proto = Navigator.prototype;
    const mark = Object.getOwnPropertyDescriptor(proto, 'webdriver');
    if (mark && mark.get && mark.configurable === false) return;
  } catch (_) {}

  const SPOOF_UA = ${JSON.stringify(ua)};
  const MAJOR = ${JSON.stringify(String(major))};
  const FULL = ${JSON.stringify(full)};
  const FULL_REAL = ${JSON.stringify(fullReal)};
  const NOT_A_BRAND = ${JSON.stringify(notABrand)};
  const NOT_A = ${JSON.stringify(notAVer)};

  // Match Chrome 151 header order: Not=A?Brand, Google Chrome, Chromium
  const brands = [
    { brand: NOT_A_BRAND, version: NOT_A },
    { brand: 'Google Chrome', version: MAJOR },
    { brand: 'Chromium', version: MAJOR },
  ];
  const fullVersionList = [
    { brand: NOT_A_BRAND, version: NOT_A + '.0.0.0' },
    { brand: 'Google Chrome', version: FULL_REAL },
    { brand: 'Chromium', version: FULL_REAL },
  ];

  function hideGetter(obj, key, getter) {
    try {
      Object.defineProperty(obj, key, {
        get: getter,
        set() {},
        configurable: true,
        enumerable: true,
      });
    } catch (_) {}
  }

  // Chrome returns false (not undefined) when not automated
  try {
    Object.defineProperty(Navigator.prototype, 'webdriver', {
      get: () => false,
      set() {},
      configurable: true,
      enumerable: true,
    });
  } catch (_) {}

  hideGetter(Navigator.prototype, 'userAgent', () => SPOOF_UA);
  hideGetter(Navigator.prototype, 'appVersion', () => SPOOF_UA.replace(/^Mozilla\\//, ''));
  hideGetter(Navigator.prototype, 'platform', () => 'Win32');
  hideGetter(Navigator.prototype, 'vendor', () => 'Google Inc.');
  hideGetter(Navigator.prototype, 'vendorSub', () => '');
  hideGetter(Navigator.prototype, 'productSub', () => '20030107');
  hideGetter(Navigator.prototype, 'maxTouchPoints', () => 0);
  hideGetter(Navigator.prototype, 'hardwareConcurrency', () => 8);
  hideGetter(Navigator.prototype, 'deviceMemory', () => 8);
  hideGetter(Navigator.prototype, 'cookieEnabled', () => true);
  hideGetter(Navigator.prototype, 'doNotTrack', () => null);

  try {
    hideGetter(Navigator.prototype, 'plugins', () => {
      const data = [
        { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      ];
      const arr = Object.create(PluginArray.prototype);
      data.forEach((p, i) => {
        const plugin = Object.create(Plugin.prototype);
        Object.defineProperties(plugin, {
          name: { get: () => p.name, enumerable: true },
          filename: { get: () => p.filename, enumerable: true },
          description: { get: () => p.description, enumerable: true },
          length: { get: () => 1, enumerable: true },
        });
        arr[i] = plugin;
      });
      Object.defineProperty(arr, 'length', { get: () => data.length });
      arr.item = (i) => arr[i] || null;
      arr.namedItem = (n) => data.map((_, i) => arr[i]).find((p) => p && p.name === n) || null;
      arr.refresh = () => {};
      return arr;
    });
  } catch (_) {
    hideGetter(Navigator.prototype, 'plugins', () => ({ length: 5 }));
  }

  try {
    hideGetter(Navigator.prototype, 'mimeTypes', () => {
      const mt = Object.create(MimeTypeArray.prototype);
      Object.defineProperty(mt, 'length', { get: () => 2 });
      mt.item = () => null;
      mt.namedItem = () => null;
      return mt;
    });
  } catch (_) {}

  try {
    const uaData = {
      brands,
      mobile: false,
      platform: 'Windows',
      getHighEntropyValues(hints) {
        const want = Array.isArray(hints) ? hints : [];
        const all = {
          brands,
          mobile: false,
          platform: 'Windows',
          platformVersion: '15.0.0',
          architecture: 'x86',
          bitness: '64',
          model: '',
          uaFullVersion: FULL_REAL,
          fullVersionList,
          wow64: false,
        };
        const out = { brands, mobile: false, platform: 'Windows' };
        for (const h of want) {
          if (h in all) out[h] = all[h];
        }
        return Promise.resolve(out);
      },
      toJSON() {
        return { brands, mobile: false, platform: 'Windows' };
      },
    };
    Object.defineProperty(Navigator.prototype, 'userAgentData', {
      get: () => uaData,
      configurable: true,
      enumerable: true,
    });
  } catch (_) {}

  // Real Chrome has window.chrome; avoid empty {} that looks scripted
  try {
    if (!window.chrome || typeof window.chrome !== 'object') {
      window.chrome = {};
    }
    const c = window.chrome;
    if (!('app' in c)) {
      c.app = {
        isInstalled: false,
        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
        getDetails: () => null,
        getIsInstalled: () => false,
      };
    }
    if (!('csi' in c)) c.csi = function () { return {}; };
    if (!('loadTimes' in c)) c.loadTimes = function () { return {}; };
  } catch (_) {}

  // permissions.notifications quirk (headless/automation tell)
  try {
    const originalQuery = window.Permissions && window.Permissions.prototype
      ? window.Permissions.prototype.query
      : null;
    const perms = navigator.permissions;
    if (perms && typeof perms.query === 'function') {
      const bound = perms.query.bind(perms);
      navigator.permissions.query = (parameters) => {
        if (parameters && parameters.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission, onchange: null });
        }
        return bound(parameters);
      };
    } else if (typeof originalQuery === 'function') {
      window.Permissions.prototype.query = function (parameters) {
        if (parameters && parameters.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission, onchange: null });
        }
        return originalQuery.call(this, parameters);
      };
    }
  } catch (_) {}

  // Hide common automation / Electron globals if present
  try {
    const kill = [
      'electron', '_electron', '__electron',
      'Buffer', 'process', 'GLOBAL', 'global',
      'emit', 'spawn',
    ];
    for (const k of kill) {
      if (k in window) {
        try { delete window[k]; } catch (_) {}
      }
    }
  } catch (_) {}

  // Make bridge globals non-enumerable if automation already attached
  try {
    for (const k of Object.getOwnPropertyNames(window)) {
      if (!k) continue;
      if (
        k.indexOf('__ocean') === 0 ||
        k.indexOf('__OCEAN') === 0 ||
        k === 'oceanBridge'
      ) {
        try {
          const v = window[k];
          Object.defineProperty(window, k, {
            value: v,
            writable: true,
            configurable: true,
            enumerable: false,
          });
        } catch (_) {}
      }
    }
  } catch (_) {}

  // iframe / new documents: patch child windows lightly
  try {
    const desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
    // leave default — frame inject handled from main process
  } catch (_) {}
})();`;
}

/**
 * Extra Chromium flags — call before app ready.
 * Do NOT set disable-blink-features=AutomationControlled (yellow unsupported-flag bar = Akamai tell).
 * webdriver is patched in getStealthInjectSource / consistency stealth instead.
 */
function applyCommandLineStealth() {
  const { app } = require('electron');
  try {
    app.commandLine.appendSwitch('no-first-run');
    app.commandLine.appendSwitch('no-default-browser-check');
    // Background panel / Direct Host: timers + renderer throttle off
    app.commandLine.appendSwitch('disable-background-timer-throttling');
    app.commandLine.appendSwitch('disable-renderer-backgrounding');
    app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
    // Electron fallback engine: same WebRTC IP policy as host Chrome/Brave
    app.commandLine.appendSwitch(
      'force-webrtc-ip-handling-policy',
      'disable_non_proxied_udp'
    );
    app.commandLine.appendSwitch('enforce-webrtc-ip-permission-check');
  } catch (_) {}
}

module.exports = {
  get SPOOF_CHROME_MAJOR() {
    return SPOOF_CHROME_MAJOR;
  },
  get SPOOF_CHROME_FULL() {
    return SPOOF_CHROME_FULL;
  },
  get SPOOF_CHROME_FULL_REAL() {
    return SPOOF_CHROME_FULL_REAL;
  },
  syncChromeVersionFromSystem,
  getChromeUserAgent,
  getSecChUa,
  getSecChUaFullVersionList,
  getClientHintHeaders,
  getStealthInjectSource,
  applyStealthToSession,
  applyCommandLineStealth,
  installNewDocumentStealth,
};
