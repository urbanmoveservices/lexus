/**
 * System Chrome engine — anti-detect launch:
 * 1) Spawn real Chrome (NOT puppeteer.launch — that sets automation tells)
 * 2) Connect via rebrowser-puppeteer-core (patches Runtime.enable leak)
 * 3) Persistent profile + delayed page inject
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');

// Runtime.enable leak fix — must set before require
process.env.REBROWSER_PATCHES_RUNTIME_FIX_MODE =
  process.env.REBROWSER_PATCHES_RUNTIME_FIX_MODE || 'addBinding';
process.env.REBROWSER_PATCHES_UTILITY_WORLD_NAME =
  process.env.REBROWSER_PATCHES_UTILITY_WORLD_NAME || 'ocean_util_' + crypto.randomBytes(3).toString('hex');

const puppeteer = require('rebrowser-puppeteer-core');
const { findChromePath } = require('./chrome-finder');
const { findBravePath } = require('./brave-finder');
const { getStealthChromeArgs } = require('./stealth-launch-args');
const { getHostBrowserStealthSource, getConsistencyStealthSource } = require('./stealth-consistency');
const { buildStorageFromBundle } = require('./profile-bridge');
const { attachChromeIrctcNetwork } = require('./irctc-network');
const directBookingHost = require('./direct-booking-host');
const { chromeProxyServerArg, hasProxyAuth, normalizeProxyConfig, resolveProxyForIpMode } = require('./proxy-util');
const { startAuthProxyTunnel } = require('./proxy-tunnel');
const profileStore = require('./profile-store');
const braveHost = require('./brave-host');

const AUTOMATION_GRACE_MS = Number(process.env.OCEAN_AUTOMATION_GRACE_MS) || 8000;
const AUTOMATION_GRACE_BRAVE_MS =
  Number(process.env.OCEAN_BRAVE_GRACE_MS) || Math.max(AUTOMATION_GRACE_MS, 12000);
/** Blank page settle before IRCTC navigation (stealth CDP scripts register first). */
const STEALTH_BLANK_SETTLE_MS = 900;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function logTag(browserKind) {
  return '[LEXUS Headless]';
}

function profileDirFor(sessionId, browserKind = 'chrome') {
  // Persistent under AppData — tmp cold profiles look like bots
  const folder = 'lexus-headless-profiles';
  let base;
  try {
    const { app } = require('electron');
    base = path.join(app.getPath('userData'), folder);
  } catch (_) {
    base = path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'ocean-electron',
      folder
    );
  }
  fs.mkdirSync(base, { recursive: true });
  return path.join(base, `slot-${sessionId}`);
}

function randomBridgeName(prefix) {
  return `${prefix}${crypto.randomBytes(8).toString('hex')}`;
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function waitForCDP(port, timeoutMs = 45000) {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (Date.now() - start > timeoutMs) {
        resolve(false);
        return;
      }
      const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve(true);
        else setTimeout(tick, 250);
      });
      req.on('error', () => setTimeout(tick, 250));
      req.setTimeout(1000, () => {
        req.destroy();
        setTimeout(tick, 250);
      });
    };
    tick();
  });
}

function spawnSystemChrome({
  chromePath,
  userDataDir,
  profileDirectory,
  port,
  proxyServer,
  browserKind = 'chrome',
  windowSize,
  windowPosition,
  newWindow = false,
  headless = true,
}) {
  const tag = logTag(browserKind);
  const args = getStealthChromeArgs({
    userDataDir,
    profileDirectory,
    remoteDebuggingPort: port,
    browserKind,
    windowSize,
    windowPosition,
    newWindow,
  });
  if (proxyServer) {
    args.push(`--proxy-server=${proxyServer}`);
    // Avoid falling back to direct when proxy fails (clearer failures)
    args.push('--proxy-bypass-list=<-loopback>');
  }
  if (headless) args.push('--headless=new');
  // Always blank first — stealth patches register via CDP, then we navigate to IRCTC
  args.push('about:blank');
  console.log(`${tag} spawn args:`, args.join(' '));
  const child = spawn(chromePath, args, {
    detached: false,
    stdio: 'ignore',
    windowsHide: headless,
  });
  child.on('error', (err) => {
    console.error(`${tag} spawn error:`, err.message || err);
  });
  return child;
}

async function installStealthOnPage(page, { browserKind = 'chrome' } = {}) {
  // Chrome + Brave: driver cleanup + WebRTC IP leak shield (no UA / Client-Hints spoof).
  const scripts = [getHostBrowserStealthSource()];
  const tag = logTag(browserKind);
  try {
    const client = await page.createCDPSession();
    for (const source of scripts) {
      await client.send('Page.addScriptToEvaluateOnNewDocument', { source });
    }
  } catch (e) {
    console.warn(`${tag} stealth new-document failed:`, e.message || e);
  }
}

async function evaluateSource(page, source) {
  try {
    await page.evaluate(source);
    return;
  } catch (_) {}
  const client = await page.createCDPSession();
  await client.send('Runtime.evaluate', {
    expression: `${source}\n;void 0;`,
    returnByValue: true,
    awaitPromise: false,
  });
}

function wrapPageScript(source) {
  return `(function (chrome) {\n${source}\n})(window.__ocRt);`;
}

function readInject(name) {
  return fs.readFileSync(path.join(__dirname, 'inject', name), 'utf8');
}

async function hideWindowProps(page, keys) {
  await page.evaluate((ks) => {
    for (const k of ks) {
      try {
        if (!(k in window)) continue;
        const v = window[k];
        Object.defineProperty(window, k, {
          value: v,
          writable: true,
          configurable: true,
          enumerable: false,
        });
      } catch (_) {}
    }
  }, keys);
}

async function injectAutomationOnPage(page, bundle, mode = 'nget', runCtx = {}) {
  const isDirect = mode === 'direct';
  const site = mode === 'eticket' ? 'eticket' : 'nget';
  const injectFlag = isDirect
    ? '__OCEAN_DIRECT_INJECTED__'
    : site === 'nget'
      ? '__OCEAN_NGET_INJECTED__'
      : '__OCEAN_BETA_INJECTED__';
  const scriptName = site === 'nget' ? 'headless-content-script.js' : 'content_script_beta.js';

  // CDP Fetch/Network AFTER Akamai first paint — not before IRCTC load.
  try {
    await attachChromeIrctcNetwork(page);
  } catch (e) {
    console.warn('[Ocean] network attach at inject failed:', e.message || e);
  }
  // Obfuscated bridge names — avoid __ocNative* scans by Akamai sensors
  const clickName = randomBridgeName('_n');
  const typeName = randomBridgeName('_n');
  const keyName = randomBridgeName('_n');
  const statusName = randomBridgeName('_n');

  try {
    await page.exposeFunction(clickName, (selector, ox, oy) =>
      cdpClickSelector(page, selector, ox, oy)
    );
    await page.exposeFunction(typeName, (selector, text) =>
      cdpTypeSelector(page, selector, text)
    );
    await page.exposeFunction(keyName, (key) => cdpKey(page, key));
    if (runCtx.onStatusMessage) {
      await page.exposeFunction(statusName, (text) => {
        runCtx.onStatusMessage(String(text || ''));
      });
    }
  } catch (e) {
    if (!String(e.message || e).includes('already')) {
      console.warn('[Ocean Chrome] exposeFunction', e.message || e);
    }
  }

  // Persistent panel status — survives __ocRt delete after content_script inject
  if (runCtx.onStatusMessage) {
    await evaluateSource(
      page,
      `(() => {
        const statusFn = window[${JSON.stringify(statusName)}];
        if (typeof statusFn !== 'function') return;
        function pushPanelStatus(text) {
          const line = String(text || '').trim();
          if (!line) return;
          try {
            statusFn(line);
          } catch (_) {}
        }
        try {
          Object.defineProperty(window, '__oceanPushPanelStatus', {
            value: pushPanelStatus,
            writable: true,
            configurable: true,
            enumerable: false,
          });
        } catch (_) {
          window.__oceanPushPanelStatus = pushPanelStatus;
        }
      })();`
    );
  }

  // PhonePe Direct Host bridge (PaymentRedirect NOT in IRCTC tab)
  if (isDirect) {
    const hostFn = '__oceanNodePhonePeHost';
    try {
      await page.exposeFunction(hostFn, async (payload) => {
        let cookies = [];
        try {
          cookies = await page.cookies();
        } catch (_) {}
        const onStatus = (msg) => {
          if (runCtx.onStatusMessage) runCtx.onStatusMessage(String(msg || ''));
        };
        const out = await directBookingHost.runDirectBookingHost({
          sessionId: `${runCtx.sessionId || 'chrome'}-${(payload && payload.mode) || 'phonepe'}`,
          runSessionId: runCtx.sessionId,
          panelJourneyId: runCtx.journeyId || '',
          panelPairIndex: runCtx.pairIndex || 1,
          ipMode: runCtx.ipMode || 'auto',
          proxyId: runCtx.proxyId || null,
          mode: (payload && payload.mode) || 'phonepe',
          tokens: (payload && payload.tokens) || {},
          details: (payload && payload.details) || {},
          captchaCreds: (payload && payload.captchaCreds) || {},
          wsUser: (payload && payload.wsUser) || '',
          clientTxnId: (payload && payload.clientTxnId) || '',
          cookies,
          onStatus,
          showHost: false,
        });
        try {
          const full =
            (out && out.result && out.result.full_data) ||
            (out && out.full_data) ||
            null;
          if (full && runCtx.sessionId) {
            const sessionManager = require('./session-manager');
            sessionManager.setBookingFullData(runCtx.sessionId, full);
          }
        } catch (_) {}
        return out;
      });
    } catch (e) {
      if (!String(e.message || e).includes('already')) {
        console.warn('[Ocean Chrome] expose Direct Host', e.message || e);
      }
    }
    await evaluateSource(
      page,
      `(() => {
        const fn = window[${JSON.stringify(hostFn)}];
        if (typeof fn !== 'function') return;
        try {
          Object.defineProperty(window, '__oceanNativeDirectBook', {
            value: (payload) => fn(payload || {}),
            writable: true,
            configurable: true,
            enumerable: false,
          });
        } catch (_) {
          window.__oceanNativeDirectBook = (payload) => fn(payload || {});
        }
      })();`
    );

    // STAR history: report bookingData / verifyPayment JSON before BOOKED status
    const fullFn = '__oceanNodeBookingFull';
    try {
      await page.exposeFunction(fullFn, async (fullData) => {
        try {
          const sessionManager = require('./session-manager');
          const sid = runCtx.sessionId;
          if (!sid || !fullData) return false;
          return sessionManager.setBookingFullData(sid, fullData);
        } catch (_) {
          return false;
        }
      });
    } catch (e) {
      if (!String(e.message || e).includes('already')) {
        console.warn('[Ocean Chrome] expose booking full', e.message || e);
      }
    }
    await evaluateSource(
      page,
      `(() => {
        const fn = window[${JSON.stringify(fullFn)}];
        if (typeof fn !== 'function') return;
        try {
          Object.defineProperty(window, '__oceanReportBookingFull', {
            value: (data) => fn(data || {}),
            writable: true,
            configurable: true,
            enumerable: false,
          });
        } catch (_) {
          window.__oceanReportBookingFull = (data) => fn(data || {});
        }
      })();`
    );

    // PT fare high → wait for panel "Proceed anyway"
    const ptWaitFn = '__oceanNodePtFareWait';
    try {
      await page.exposeFunction(ptWaitFn, async (payload) => {
        const sessionManager = require('./session-manager');
        const sid = runCtx.sessionId;
        if (!sid) return false;
        return sessionManager.waitForPtFareProceed(sid, {
          amount: payload && payload.amount,
          maxFare: payload && payload.maxFare,
        });
      });
    } catch (e) {
      if (!String(e.message || e).includes('already')) {
        console.warn('[Ocean Chrome] expose PT fare wait', e.message || e);
      }
    }
    await evaluateSource(
      page,
      `(() => {
        const fn = window[${JSON.stringify(ptWaitFn)}];
        if (typeof fn !== 'function') return;
        try {
          Object.defineProperty(window, '__oceanWaitPtFareProceed', {
            value: (payload) => fn(payload || {}),
            writable: true,
            configurable: true,
            enumerable: false,
          });
        } catch (_) {
          window.__oceanWaitPtFareProceed = (payload) => fn(payload || {});
        }
      })();`
    );

    // Same-ticket pair: sibling bookingInitPayment OK → wait Proceed anyway
    const siblingFn = '__oceanNodeSiblingInitWait';
    const markInitFn = '__oceanNodeMarkInitPay';
    try {
      await page.exposeFunction(siblingFn, async () => {
        const sessionManager = require('./session-manager');
        const sid = runCtx.sessionId;
        if (!sid) return true;
        return sessionManager.waitIfSiblingInitPayment(sid);
      });
    } catch (e) {
      if (!String(e.message || e).includes('already')) {
        console.warn('[Ocean Chrome] expose sibling init wait', e.message || e);
      }
    }
    try {
      await page.exposeFunction(markInitFn, async () => {
        const sessionManager = require('./session-manager');
        return sessionManager.markInitPaymentSuccess(
          runCtx.journeyId,
          runCtx.pairIndex || 1,
          runCtx.sessionId
        );
      });
    } catch (e) {
      if (!String(e.message || e).includes('already')) {
        console.warn('[Ocean Chrome] expose mark init pay', e.message || e);
      }
    }
    await evaluateSource(
      page,
      `(() => {
        const sib = window[${JSON.stringify(siblingFn)}];
        const mark = window[${JSON.stringify(markInitFn)}];
        if (typeof sib === 'function') {
          try {
            Object.defineProperty(window, '__oceanWaitIfSiblingInit', {
              value: () => sib(),
              writable: true,
              configurable: true,
              enumerable: false,
            });
          } catch (_) {
            window.__oceanWaitIfSiblingInit = () => sib();
          }
        }
        if (typeof mark === 'function') {
          try {
            Object.defineProperty(window, '__oceanMarkInitPaymentSuccess', {
              value: () => mark(),
              writable: true,
              configurable: true,
              enumerable: false,
            });
          } catch (_) {
            window.__oceanMarkInitPaymentSuccess = () => mark();
          }
        }
      })();`
    );
  }

  // Hand bridge names to shim via a one-shot non-enumerable bag
  await evaluateSource(
    page,
    `(() => {
      try {
        Object.defineProperty(window, '__ocBr', {
          value: ${JSON.stringify({ c: clickName, t: typeName, k: keyName, s: statusName })},
          writable: true,
          configurable: true,
          enumerable: false,
        });
      } catch (_) {}
    })();`
  );

  const storage = buildStorageFromBundle(bundle);
  storage.other_preferences={...storage.other_preferences,manualLogin:true,autoCaptcha:false,paymentManual:true,CaptchaSubmitMode:'M'};
  storage.true_captcha_credentials={enabled:false,userId:'',apiKey:''};
  const storageJson = JSON.stringify(storage);

  await evaluateSource(
    page,
    `(() => {
      const data = ${storageJson};
      try {
        Object.defineProperty(window, '__OCEAN_STORAGE__', {
          value: data, writable: true, configurable: true, enumerable: false
        });
      } catch (_) { window.__OCEAN_STORAGE__ = data; }
      ${
        isDirect
          ? `try {
        Object.defineProperty(window, '__OCEAN_DIRECT_BOOK__', {
          value: true, writable: false, configurable: true, enumerable: false
        });
      } catch (_) { window.__OCEAN_DIRECT_BOOK__ = true; }`
          : ''
      }
    })();`
  );

  await evaluateSource(page, readInject('chrome-shim.js'));

  // Drop bridge bag after shim consumed it
  await evaluateSource(
    page,
    `(() => { try { delete window.__ocBr; } catch (_) {} })();`
  );

  const already = await page.evaluate((flag) => {
    try {
      const d = Object.getOwnPropertyDescriptor(window, flag);
      return Boolean(d && d.value);
    } catch (_) {
      return Boolean(window[flag]);
    }
  }, injectFlag);

  // Direct/API: mapps1 in IRCTC tab; PhonePe on Direct Host (not in browser)
  if (isDirect) {
    // Warm Brave Default often has stale ir:tokens — wipe unless UI already logged in
    await evaluateSource(
      page,
      `(() => {
        try {
          const loggedIn = Array.from(
            document.querySelectorAll('a.search_btn.loginText, a.loginText, a.search_btn, app-header a, label b')
          ).some((el) => {
            const t = ((el.innerText || el.textContent || '') + '').replace(/\\s+/g, ' ').trim().toUpperCase();
            return t === 'LOGOUT' || t === 'LOG OUT' || /^LOGOUT\\b/.test(t);
          });
          if (!loggedIn) {
            localStorage.removeItem('ir:tokens');
            try { delete window.__OCEAN_LOGIN_OK__; } catch (_) { window.__OCEAN_LOGIN_OK__ = false; }
          } else {
            try {
              Object.defineProperty(window, '__OCEAN_LOGIN_OK__', {
                value: true, writable: true, configurable: true, enumerable: false
              });
            } catch (_) { window.__OCEAN_LOGIN_OK__ = true; }
          }
        } catch (_) {}
      })();`
    );
    await evaluateSource(page, readInject('booking_direct.js'));
    await evaluateSource(page, readInject('ewallet_direct.js'));
    const needBoot = await page.evaluate(
      () => typeof window.__oceanTryStartDirect !== 'function'
    );
    if (needBoot) {
      await evaluateSource(page, readInject('direct_book_boot.js'));
    } else {
      await evaluateSource(
        page,
        `(() => {
          try {
            if (!window.__OCEAN_LOGIN_OK__) return;
            if (window.__OCEAN_DIRECT_PIPELINE_DONE__) return;
            if (window.__OCEAN_PENDING_DIRECT__ || (JSON.parse(localStorage.getItem('ir:tokens')||'{}').access_token)) {
              if (typeof window.__oceanTryStartDirect === 'function') {
                window.__oceanTryStartDirect('reinject');
              }
            }
          } catch (_) {}
        })();`
      );
    }
  }

  if (!already) {
    await evaluateSource(
      page,
      `(() => {
        try {
          Object.defineProperty(window, ${JSON.stringify(injectFlag)}, {
            value: true, writable: false, configurable: true, enumerable: false
          });
        } catch (_) { window[${JSON.stringify(injectFlag)}] = true; }
      })();`
    );

    // Login UI fill (direct mode: login only, then in-page API via __oceanStartDirectBook)
    await evaluateSource(page, wrapPageScript(readInject(scriptName)));
    await evaluateSource(
      page,
      `(() => { try { delete window.__ocRt; } catch (_) {} })();`
    );
  }

  await evaluateSource(
    page,
    `(() => {
      for (const k of Object.getOwnPropertyNames(window)) {
        if (k.indexOf('__ocean') === 0 || k.indexOf('__OCEAN') === 0 || k === 'oceanBridge' || k.indexOf('__oc') === 0) {
          try {
            const v = window[k];
            Object.defineProperty(window, k, {
              value: v, writable: true, configurable: true, enumerable: false
            });
          } catch (_) {}
        }
      }
    })();`
  );
}

/**
 * Humanized mouse click/type for System Chrome pages.
 * page.mouse → CDP Input only (never JS el.click / synthetic MouseEvent).
 */
async function cdpClickSelector(page, selector, offsetXPercent = 50, offsetYPercent = 50) {
  const prepared = await page.evaluate(
    (sel) => {
      const el = document.querySelector(sel);
      if (!el) return { ok: false };
      const raw = ((el.innerText || el.textContent || '') + '').replace(/\s+/g, ' ').trim().toUpperCase();
      if (
        raw === 'LOGOUT' ||
        raw === 'SIGN OUT' ||
        raw === 'LOG OUT' ||
        (/\bLOG\s*OUT\b/.test(raw) && raw.length < 24)
      ) {
        return { ok: false, blocked: true };
      }
      try {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } catch (_) {}
      const r = el.getBoundingClientRect();
      // Only scroll if the target is actually off-screen.
      // Header LOGIN sits at y<90 — old "top < 90" scroll shoved it away and missed the click.
      if (r.bottom > window.innerHeight - 8) {
        window.scrollBy(0, Math.ceil(r.bottom - window.innerHeight + 80));
      } else if (r.bottom < 8) {
        window.scrollBy(0, Math.floor(r.top - 80));
      }
      const r2 = el.getBoundingClientRect();
      if (!r2.width || !r2.height) return { ok: false };
      return {
        ok: true,
        x: r2.left + r2.width * (sel ? 0.5 : 0.5),
        y: r2.top + r2.height * 0.55,
        w: r2.width,
        h: r2.height,
      };
    },
    selector
  );

  if (!prepared || prepared.blocked) {
    return { success: false, error: 'blocked logout' };
  }
  if (!prepared.ok) {
    return { success: false, error: `not found: ${selector}` };
  }

  await sleep(120 + Math.random() * 80);

  const ox = Math.max(0, Math.min(100, Number(offsetXPercent) || 50));
  const oy = Math.max(0, Math.min(100, Number(offsetYPercent) || 55));

  // 1) Real mouse move + down/up (isTrusted: true) — never JS el.click()
  try {
    const handle = await page.$(selector);
    if (handle) {
      const box = await handle.boundingBox();
      if (box) {
        const x = box.x + (box.width * ox) / 100;
        const y = box.y + (box.height * oy) / 100;
        await page.mouse.move(x, y, { steps: 8 });
        await sleep(40 + Math.random() * 40);
        await page.mouse.down();
        await sleep(35 + Math.random() * 40);
        await page.mouse.up();
        await handle.dispose().catch(() => {});
        await sleep(80);
        return { success: true, method: 'mouse' };
      }
      await handle.dispose().catch(() => {});
    }
  } catch (e1) {
    console.warn('[Ocean Chrome] page.mouse failed:', e1.message);
  }

  // 2) CDP Input with buttons bitmask
  try {
    const client = await page.createCDPSession();
    const box = await page.evaluate(
      (sel, oxp, oyp) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          x: r.left + r.width * (oxp / 100),
          y: r.top + r.height * (oyp / 100),
        };
      },
      selector,
      ox,
      oy
    );
    if (box) {
      const x = Math.round(box.x);
      const y = Math.round(box.y);
      await client.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x,
        y,
      });
      await sleep(40);
      await client.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x,
        y,
        button: 'left',
        buttons: 1,
        clickCount: 1,
        pointerType: 'mouse',
      });
      await sleep(50 + Math.random() * 40);
      await client.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x,
        y,
        button: 'left',
        buttons: 0,
        clickCount: 1,
        pointerType: 'mouse',
      });
      await sleep(120);
      return { success: true, method: 'cdp' };
    }
  } catch (e2) {
    console.warn('[Ocean Chrome] CDP click failed:', e2.message);
  }

  return { success: false, error: `mouse click failed: ${selector}` };
}

async function cdpTypeSelector(page, selector, text) {
  const click = await cdpClickSelector(page, selector, 50, 50);
  if (!click.success) return click;
  await sleep(100 + Math.random() * 100);
  // select-all + type
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await sleep(50);
  await page.keyboard.press('Backspace');
  await sleep(60);
  for (const ch of String(text ?? '')) {
    await page.keyboard.type(ch, { delay: 80 + Math.random() * 120 });
  }
  return { success: true };
}

async function cdpKey(page, key) {
  await page.keyboard.press(key === '\r' ? 'Enter' : key);
  return { success: true };
}

/**
 * Launch Chromium host — System Chrome (default) or Brave (Ocean-style).
 * Spawn real browser, then rebrowser connect. Direct mode → Direct Host API.
 * @returns {{ ok, run?, error?, handle? }}
 */
async function launchSystemChromeRun({
  sessionId,
  startUrl,
  bundle,
  meta,
  onStatus,
  onStatusMessage,
  mode = 'eticket',
  browserKind = 'chrome',
  headless = true,
}) {
  const kind = browserKind === 'brave' ? 'brave' : 'chrome';
  const tag = logTag(kind);
  const engineLabel = 'headless';

  const chromePath = kind === 'brave' ? findBravePath() : findChromePath();
  if (!chromePath) {
    return {
      ok: false,
      error:
        kind === 'brave'
          ? 'Brave Browser not found. Install Brave, or set OCEAN_BRAVE_PATH.'
          : 'Google Chrome not found. Install Chrome, or set OCEAN_CHROME_PATH, or use Electron / Brave engine.',
    };
  }

  const userDataDir = profileDirFor(sessionId, kind);
  const port = await getFreePort();
  let proxyCfg = normalizeProxyConfig({});
  try {
    proxyCfg = profileStore.getProxyConfig({
      proxyId: meta?.proxyId || bundle?.journey?.options?.proxyId || null,
    });
  } catch (_) {}

  // Journey / panel IP select: Home IP vs Proxy1..N
  const ipMode =
    meta?.ipMode ||
    bundle?.journey?.options?.ipMode ||
    'auto';
  proxyCfg = resolveProxyForIpMode(ipMode, proxyCfg);
  console.log(
    `${tag} IP mode=${proxyCfg.ipMode || ipMode} proxy=${proxyCfg.enabled ? `${proxyCfg.host}:${proxyCfg.port}` : 'off (Home IP)'}`
  );

  if (proxyCfg.error) {
    return { ok: false, error: `Proxy config: ${proxyCfg.error}` };
  }

  let proxyServer = chromeProxyServerArg(proxyCfg);
  let proxyTunnel = null;

  // STAR parity: auth proxy → local 127.0.0.1 tunnel (browser cannot auth in --proxy-server)
  if (hasProxyAuth(proxyCfg) && proxyCfg.type !== 'socks5') {
    try {
      proxyTunnel = await startAuthProxyTunnel(proxyCfg);
      if (proxyTunnel && proxyTunnel.proxyServerArg) {
        proxyServer = proxyTunnel.proxyServerArg;
        console.log(`${tag} STAR-style auth tunnel:`, proxyServer);
      }
    } catch (e) {
      console.warn(`${tag} proxy tunnel failed:`, e.message || e);
      return {
        ok: false,
        error: `Proxy tunnel failed: ${e.message || e}`,
      };
    }
  }

  let chromeProc;
  let browser;
  let profileDirectory = null;
  let braveMasterKey = null;
  let braveReused = false;
  let ownedSpawn = true;
  let effectiveUserDataDir = userDataDir;
  let effectivePort = port;
  /** Ocean slot page (brave only — not host / other pairs) */
  let braveSlotPage = null;

  if (kind === 'brave') {
    try {
      const acquired = await braveHost.openBraveSlot({
        chromePath,
        pairIndex: meta?.pairIndex || 1,
        getFreePort,
        waitForCDP,
        proxyServer,
        spawnBrave: (spawnOpts) =>
          spawnSystemChrome({
            ...spawnOpts,
            browserKind: 'brave',
          }),
      });
      effectiveUserDataDir = acquired.userDataRoot;
      profileDirectory = acquired.profileDirectory;
      effectivePort = acquired.port;
      chromeProc = acquired.chromeProc;
      browser = acquired.browser;
      braveSlotPage = acquired.page || null;
      braveMasterKey = acquired.masterKey;
      braveReused = acquired.reused;
      // Shared Ocean host process — never kill from one pair
      ownedSpawn = false;
      console.log(
        `${tag} Ocean slot profile=${profileDirectory} port=${effectivePort} pair=${meta?.pairIndex || 1} reused=${braveReused}`
      );
    } catch (e) {
      try {
        if (proxyTunnel) proxyTunnel.stop();
      } catch (_) {}
      return { ok: false, error: e.message || String(e) };
    }
  } else {
    console.log(`${tag} executable:`, chromePath);
    console.log(`${tag} profile:`, userDataDir);
    console.log(`${tag} debug port:`, port);
    if (proxyServer) {
      console.log(
        `${tag} proxy:`,
        proxyServer,
        hasProxyAuth(proxyCfg) && !proxyTunnel ? '(page.authenticate)' : proxyTunnel ? '(tunnel auth)' : ''
      );
    }

    chromeProc = spawnSystemChrome({
      chromePath,
      userDataDir,
      port,
      proxyServer,
      browserKind: kind,
      headless,
    });

    const ready = await waitForCDP(port);
    if (!ready) {
      try {
        chromeProc.kill();
      } catch (_) {}
      try {
        if (proxyTunnel) proxyTunnel.stop();
      } catch (_) {}
      return {
        ok: false,
        error: `${kind === 'brave' ? 'Brave' : 'Chrome'} CDP not ready on port ${port}`,
      };
    }

    try {
      browser = await puppeteer.connect({
        browserURL: `http://127.0.0.1:${port}`,
        defaultViewport: null,
      });
    } catch (e) {
      try {
        chromeProc.kill();
      } catch (_) {}
      try {
        if (proxyTunnel) proxyTunnel.stop();
      } catch (_) {}
      return {
        ok: false,
        error: `${kind === 'brave' ? 'Brave' : 'Chrome'} connect failed: ${e.message || e}`,
      };
    }
  }

  if (kind === 'brave') {
    console.log(`${tag} executable:`, chromePath);
    console.log(`${tag} user-data-dir:`, effectiveUserDataDir);
    console.log(`${tag} profile-directory:`, profileDirectory);
    console.log(`${tag} debug port:`, effectivePort);
  }

  // Brave Ocean: use THIS pair's slot page (not host / other pairs)
  const page =
    braveSlotPage ||
    (await browser.pages())[0] ||
    (await browser.newPage());

  // Only if NOT using local tunnel (tunnel already injects Proxy-Authorization)
  if (hasProxyAuth(proxyCfg) && !proxyTunnel) {
    try {
      await page.authenticate({
        username: proxyCfg.username,
        password: proxyCfg.password || '',
      });
      console.log(`${tag} proxy authenticate set`);
    } catch (e) {
      console.warn(`${tag} proxy auth failed:`, e.message || e);
    }
  }

  // 1) Navigate to IRCTC — both hosts: driver cleanup + WebRTC IP shield before first paint
  console.log(`${tag} blank page — host stealth (driver cleanup + WebRTC IP shield)…`);
  meta.status = 'stealth-boot';
  await installStealthOnPage(page, { browserKind: kind });
  await sleep(STEALTH_BLANK_SETTLE_MS);
  meta.engine = engineLabel;
  meta.url = page.url();
  if (onStatus) onStatus();
  if (onStatusMessage) onStatusMessage('STEALTH BOOT');

  // CDP token/DNR attach deferred until automation inject (after grace) — keeps first paint clean

  console.log(`${tag} navigating →`, startUrl);
  try {
    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
  } catch (e) {
    console.warn(`${tag} goto slow/partial:`, e.message || e);
  }
  meta.url = page.url();
  if (onStatus) onStatus();
  if (onStatusMessage) onStatusMessage('LOADING IRCTC…');

  const handle = {
    engine: engineLabel,
    browserKind: kind,
    browser,
    page,
    sessionId,
    bundle,
    meta,
    chromeProc,
    debugPort: effectivePort,
    profileDirectory,
    braveMasterKey,
    braveReused,
    ownedSpawn,
    pairIndex: meta?.pairIndex || 1,
    mode: mode === 'eticket' ? 'eticket' : mode === 'direct' ? 'direct' : 'nget',
    closed: false,
    proxyTunnel,
    onStatusMessage,
  };

  const stopTunnel = () => {
    try {
      if (handle.proxyTunnel) {
        handle.proxyTunnel.stop();
        handle.proxyTunnel = null;
      }
    } catch (_) {}
  };

  browser.on('disconnected', () => {
    handle.closed = true;
    stopTunnel();
  });
  if (chromeProc) {
    chromeProc.on('exit', () => {
      handle.closed = true;
      stopTunnel();
    });
  }

  if (onStatusMessage) {
    page.on('console', (msg) => {
      const text = msg.text();
      const nget = text.match(/\[OCEAN nget\]\s*(.+)/);
      if (nget) {
        onStatusMessage(nget[1].trim());
        return;
      }
      const directPage = text.match(/\[OCEAN Direct\]\s*(.+)/);
      if (directPage) {
        onStatusMessage(directPage[1].trim());
        return;
      }
      const jsDirect = text.match(/\[JS-Direct\]\s*\[(?:IRCTC-Direct|PhonePe-Direct|Paytm-Direct)\]\s*(.+)/);
      if (jsDirect) {
        onStatusMessage(jsDirect[1].trim());
        return;
      }
      const direct = text.match(/\[OCEAN DirectHost\]\s*(.+)/);
      if (direct) onStatusMessage(direct[1].trim());
      const irctcDirect = text.match(/\[IRCTC-Direct\]\s*(.+)/);
      if (irctcDirect) onStatusMessage(irctcDirect[1].trim());
      const phonePe = text.match(/\[PhonePe-Direct\]\s*(.+)/);
      if (phonePe) onStatusMessage(phonePe[1].trim());
      const paytm = text.match(/\[Paytm-Direct\]\s*(.+)/);
      if (paytm) onStatusMessage(paytm[1].trim());
    });
  }

  // 3) Automation inject after grace — Akamai first paint stays clean until then
  const graceMs = kind === 'brave' ? AUTOMATION_GRACE_BRAVE_MS : AUTOMATION_GRACE_MS;
  setTimeout(async () => {
    if (handle.closed) return;
    try {
      console.log(`${tag} grace done — automation inject`, handle.mode);
      await injectAutomationOnPage(page, bundle, handle.mode, {
        sessionId: handle.sessionId,
        journeyId: meta.journeyId,
        pairIndex: meta.pairIndex || 1,
        ipMode: meta.ipMode || bundle?.journey?.options?.ipMode || 'auto',
        proxyId: meta.proxyId || bundle?.journey?.options?.proxyId || null,
        onStatusMessage,
      });
      meta.status = 'automating';
      if (onStatus) onStatus();
      if (onStatusMessage) onStatusMessage('AUTOMATING');
      wireChromeUrlRouter(handle, meta, onStatus, onStatusMessage);
      try {
        const u = page.url();
        meta.url = u;
        if (onStatus) onStatus();
        if (handle.mode === 'direct') return;
        const action = irctcActionFromUrl(u);
        if (action) {
          await sleep(400);
          await page.evaluate((type) => {
            if (typeof window.__oceanDispatchMessage === 'function') {
              window.__oceanDispatchMessage({
                id: 'irctc',
                sender: 'electron',
                beta: false,
                msg: { type, data: null },
              });
            }
          }, action);
        }
      } catch (_) {}
    } catch (e) {
      console.error(`${tag} automation inject failed`, e);
      meta.error = e.message || String(e);
      if (onStatus) onStatus();
    }
  }, graceMs);

  return { ok: true, handle };
}

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

function wireChromeUrlRouter(handle, meta, onStatus, onStatusMessage) {
  const { page } = handle;
  const lastFired = new Map();
  const statusMsg = onStatusMessage || handle.onStatusMessage;

  const route = async (url) => {
    meta.url = url;
    if (onStatus) onStatus();
    try {
      const has = await page.evaluate(
        () =>
          Boolean(
            window.__OCEAN_NGET_INJECTED__ ||
              window.__OCEAN_BETA_INJECTED__ ||
              window.__OCEAN_DIRECT_INJECTED__
          )
      );
      if (!has && handle.bundle) {
        await injectAutomationOnPage(page, handle.bundle, handle.mode || 'nget', {
          sessionId: handle.sessionId,
          onStatusMessage: statusMsg,
        });
      }
    } catch (_) {}
    // Direct Booking = API only after login; no UI journey clicks
    if (handle.mode === 'direct') return;
    const action = irctcActionFromUrl(url);
    if (!action) return;
    const key = action;
    const now = Date.now();
    let debounceMs = 2500;
    if (action === 'reviewBooking' || action === 'bkgPaymentOptions') debounceMs = 800;
    if (lastFired.has(key) && now - lastFired.get(key) < debounceMs) return;
    lastFired.set(key, now);
    console.log('[Ocean Chrome] URL →', action);
    // review/payment CTAs need Angular settle — 200ms too early (markTempId lagta, click miss)
    const delay =
      action === 'reviewBooking' ? 1200 : action === 'bkgPaymentOptions' ? 800 : 600;
    await sleep(delay);
    try {
      await page.evaluate((type) => {
        if (typeof window.__oceanDispatchMessage === 'function') {
          window.__oceanDispatchMessage({
            id: 'irctc',
            sender: 'electron',
            beta: true,
            msg: { type, data: null },
          });
        }
      }, action);
    } catch (e) {
      console.warn('[Ocean Chrome] dispatch failed', e.message);
    }
  };

  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) route(frame.url());
  });
}

async function closeChromeHandle(handle) {
  if (!handle || handle.closed) return;
  handle.closed = true;
  try {
    if (handle.proxyTunnel) {
      handle.proxyTunnel.stop();
      handle.proxyTunnel = null;
    }
  } catch (_) {}

  // Stop page JS / automation for this pair (Ocean: close slot window only)
  try {
    if (handle.page && !handle.page.isClosed?.()) {
      await handle.page.close({ runBeforeUnload: false });
    }
  } catch (_) {
    try {
      if (handle.page) await handle.page.close();
    } catch (_) {}
  }

  if (handle.browserKind === 'brave') {
    try {
      braveHost.clearSlot(handle.pairIndex || 1);
    } catch (_) {}
  }

  try {
    if (handle.browser) {
      try {
        handle.browser.disconnect();
      } catch (_) {
        try {
          await handle.browser.close();
        } catch (_) {}
      }
    }
  } catch (_) {}

  if (handle.browserKind === 'brave') {
    const { killProcess } = braveHost.closeBraveMaster(handle);
    if (killProcess) {
      try {
        if (handle.chromeProc && !handle.chromeProc.killed) {
          handle.chromeProc.kill();
        }
      } catch (_) {}
    }
    return;
  }

  try {
    if (handle.chromeProc && !handle.chromeProc.killed) {
      handle.chromeProc.kill();
    }
  } catch (_) {}
}

module.exports = {
  findChromePath,
  findBravePath,
  launchSystemChromeRun,
  closeChromeHandle,
  cdpClickSelector,
  cdpTypeSelector,
  cdpKey,
  injectAutomationOnPage,
  AUTOMATION_GRACE_MS,
};
