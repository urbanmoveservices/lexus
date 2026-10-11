/**
 * Consistency-first stealth (gstack / Veil style).
 * Host Chrome/Brave: use getHostBrowserStealthSource() only — or nothing on Brave.
 * Electron fallback: getConsistencyStealthSource() (heavier spoof).
 *
 * Do NOT rely on --disable-blink-features=AutomationControlled (yellow bar leak).
 */

/** Ocean-style: real browser — strip driver leftovers + block WebRTC IP leak. No UA spoof. */
function getHostBrowserStealthSource() {
  return `(() => {
  try {
    if (navigator.webdriver === true) {
      try {
        Object.defineProperty(Navigator.prototype, 'webdriver', {
          get: () => false,
          set() {},
          configurable: true,
          enumerable: true,
        });
      } catch (_) {
        try {
          Object.defineProperty(navigator, 'webdriver', {
            get: () => false,
            configurable: true,
          });
        } catch (_) {}
      }
    }
  } catch (_) {}

  try {
    const kill = [
      'cdc_adoQpoasnfa76pfcZLmcfl_Array',
      'cdc_adoQpoasnfa76pfcZLmcfl_Promise',
      'cdc_adoQpoasnfa76pfcZLmcfl_Symbol',
      'cdc_adoQpoasnfa76pfcZLmcfl_Object',
      'cdc_adoQpoasnfa76pfcZLmcfl_Proxy',
      '$cdc_asdjflasutopfhvcZLmcfl_',
      '$chrome_asyncScriptInfo',
      '__webdriver_script_fn',
      '__driver_evaluate',
      '__webdriver_evaluate',
      '__selenium_evaluate',
      '__fxdriver_evaluate',
      '__driver_unwrapped',
      '__webdriver_unwrapped',
      '__selenium_unwrapped',
      '_Selenium_IDE_Recorder',
      '_selenium',
      'calledSelenium',
      'domAutomation',
      'domAutomationController',
      '__webdriverFunc',
      '__webdriver_script_func',
      '__webdriver_script_function',
      '__lastWatirAlert',
      '__lastWatirConfirm',
      '__lastWatirPrompt',
      '__nightmare',
      '_phantom',
      'callPhantom',
      '__playwright',
      '__pwInitScripts',
    ];
    for (const k of kill) {
      try {
        if (k in window) delete window[k];
      } catch (_) {}
      try {
        if (document && k in document) delete document[k];
      } catch (_) {}
    }
  } catch (_) {}

  // Hide accidental Ocean / CDP bridge keys from simple enumerations
  try {
    for (const k of Object.getOwnPropertyNames(window)) {
      if (
        k.indexOf('__ocean') === 0 ||
        k.indexOf('__OCEAN') === 0 ||
        k === 'oceanBridge' ||
        k.indexOf('__oc') === 0
      ) {
        try {
          const v = window[k];
          Object.defineProperty(window, k, {
            value: v, writable: true, configurable: true, enumerable: false,
          });
        } catch (_) {}
      }
    }
  } catch (_) {}

  // WebRTC: drop host/srflx candidates that expose real client / LAN IP
  try {
    const Orig = window.RTCPeerConnection || window.webkitRTCPeerConnection;
    if (typeof Orig === 'function' && !Orig.__oceanRtcPatched) {
      const wrap = function (config, constraints) {
        const pc = arguments.length >= 2
          ? new Orig(config, constraints)
          : new Orig(config);
        try {
          const filter = (ev) => {
            try {
              const c = ev && ev.candidate && ev.candidate.candidate;
              if (!c) return;
              if (/\\btyp (host|srflx)\\b/i.test(c)) {
                Object.defineProperty(ev, 'candidate', {
                  get: () => null,
                  configurable: true,
                });
              }
            } catch (_) {}
          };
          pc.addEventListener('icecandidate', filter);
        } catch (_) {}
        return pc;
      };
      wrap.prototype = Orig.prototype;
      try {
        Object.keys(Orig).forEach((k) => {
          try { wrap[k] = Orig[k]; } catch (_) {}
        });
      } catch (_) {}
      wrap.__oceanRtcPatched = true;
      try { wrap.toString = () => Orig.toString(); } catch (_) {}
      try {
        window.RTCPeerConnection = wrap;
        if ('webkitRTCPeerConnection' in window) {
          window.webkitRTCPeerConnection = wrap;
        }
      } catch (_) {}
    }
  } catch (_) {}
})();`;
}

function getConsistencyStealthSource() {
  return `(() => {
  try {
    const proto = Navigator.prototype;
    // Real Chrome (no --enable-automation): webdriver === false.
    // Only rewrite when automation left it true — avoid undefined spoof tell.
    const cur = (() => {
      try { return navigator.webdriver; } catch (_) { return undefined; }
    })();
    if (cur === true) {
      try {
        Object.defineProperty(proto, 'webdriver', {
          get: () => false,
          set() {},
          configurable: true,
          enumerable: true,
        });
      } catch (_) {
        try {
          Object.defineProperty(navigator, 'webdriver', {
            get: () => false,
            configurable: true,
          });
        } catch (_) {}
      }
    }
  } catch (_) {}

  // Strip common driver leftovers (Selenium / CDP / older puppeteer)
  try {
    const kill = [
      'cdc_adoQpoasnfa76pfcZLmcfl_Array',
      'cdc_adoQpoasnfa76pfcZLmcfl_Promise',
      'cdc_adoQpoasnfa76pfcZLmcfl_Symbol',
      '$cdc_asdjflasutopfhvcZLmcfl_',
      '$chrome_asyncScriptInfo',
      '__webdriver_script_fn',
      '__driver_evaluate',
      '__webdriver_evaluate',
      '__selenium_evaluate',
      '__fxdriver_evaluate',
      '__driver_unwrapped',
      '__webdriver_unwrapped',
      '__selenium_unwrapped',
      '_Selenium_IDE_Recorder',
      '_selenium',
      'calledSelenium',
      'domAutomation',
      'domAutomationController',
      '__webdriverFunc',
      '__lastWatirAlert',
      '__lastWatirConfirm',
      '__lastWatirPrompt',
      '__webdriver_script_func',
      '__webdriver_script_function',
    ];
    for (const k of kill) {
      try {
        if (k in window) delete window[k];
      } catch (_) {}
      try {
        if (document && k in document) delete document[k];
      } catch (_) {}
    }
  } catch (_) {}

  // window.chrome — if real Chrome already has it, do not invent app/csi/runtime
  try {
    if (!window.chrome || typeof window.chrome !== 'object') {
      window.chrome = { app: { isInstalled: false } };
    }
  } catch (_) {}

  // permissions.notifications quirk only (Electron only — skipped on host browsers)
  try {
    const perms = navigator.permissions;
    if (perms && typeof perms.query === 'function') {
      const orig = perms.query.bind(perms);
      perms.query = function (parameters) {
        if (parameters && parameters.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission, onchange: null });
        }
        return orig(parameters);
      };
    }
  } catch (_) {}

  // Hide obvious Electron / automation leftovers if any leaked into page
  try {
    for (const k of ['electron', '__electron', 'Buffer', 'process']) {
      if (k in window) {
        try { delete window[k]; } catch (_) {}
      }
    }
  } catch (_) {}

  // Make any accidental Ocean keys non-enumerable
  try {
    for (const k of Object.getOwnPropertyNames(window)) {
      if (k.indexOf('__ocean') === 0 || k.indexOf('__OCEAN') === 0 || k === 'oceanBridge' || k.indexOf('__oc') === 0) {
        try {
          const v = window[k];
          Object.defineProperty(window, k, {
            value: v, writable: true, configurable: true, enumerable: false,
          });
        } catch (_) {}
      }
    }
  } catch (_) {}
})();`;
}

module.exports = {
  getHostBrowserStealthSource,
  getConsistencyStealthSource,
};
