const { BrowserWindow, session, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const {
  getChromeUserAgent,
  getStealthInjectSource,
  applyStealthToSession: applySessionStealth,
  installNewDocumentStealth,
} = require('./stealth');
const { getConsistencyStealthSource } = require('./stealth-consistency');
const profileStore = require('./profile-store');
const { attachAutomation } = require('./automation-runner');
const chromeRunner = require('./chrome-runner');
const headlessRunner = require('./headless-runner');
const braveRunner = require('./brave-runner');
const { attachElectronIrctcNetwork } = require('./irctc-network');
const { applyProxyToSession } = require('./proxy-session');
const { resolveProxyForIpMode } = require('./proxy-util');
const { LAYOUT, centerBounds, clampSize, getWorkArea } = require('./window-layout');
const oceanSuccess = require('./ocean-success');

const IRCTC_URLS = {
  nget: 'https://www.irctc.co.in/nget/train-search',
  eticket: 'https://www.irctc.co.in/eticket/train-search',
};

const MAX_PARALLEL_RUNS = 4;
const MAX_PAIRS_PER_JOURNEY = 4;
const AUTOMATION_GRACE_MS = 5000;

/** @type {Map<string, { meta: object, window?: Electron.BrowserWindow, chrome?: object }>} */
const runs = new Map();

let chromeUA = '';
let controlWindowGetter = () => null;
let panelStatusEmitter = null;
let panelPtFareEmitter = null;
let panelQrEmitter = null;
let panelQrHideEmitter = null;
/** @type {null | ((sessionId: string, pnr: string) => void | Promise<void>)} */
let onOceanApiSuccess = null;

/** @type {Map<string, { resolve: (ok: boolean) => void }>} */
const ptFareWaiters = new Map();

/** Same ticket: first pair jiska bookingInitPayment OK → dusra pair rukega */
/** @type {Map<string, { pairIndex: number, sessionId: string, at: number }>} */
const initPaymentSuccessByJourney = new Map();

function configure({
  getControlWindow,
  userAgent,
  emitPanelStatus,
  emitPanelPtFare,
  emitPanelQr,
  emitPanelQrHide,
  onOceanApiSuccess: onSuccess,
}) {
  controlWindowGetter = getControlWindow;
  chromeUA = userAgent || getChromeUserAgent();
  panelStatusEmitter = typeof emitPanelStatus === 'function' ? emitPanelStatus : null;
  panelPtFareEmitter = typeof emitPanelPtFare === 'function' ? emitPanelPtFare : null;
  panelQrEmitter = typeof emitPanelQr === 'function' ? emitPanelQr : null;
  panelQrHideEmitter = typeof emitPanelQrHide === 'function' ? emitPanelQrHide : null;
  onOceanApiSuccess = typeof onSuccess === 'function' ? onSuccess : null;
}

function pushRunStatus(sessionId, message) {
  const entry = runs.get(sessionId);
  if (!entry || message == null) return;
  let msg = String(message).trim();
  if (!msg) return;

  // After Direct PNR success: lock Success status (STAR-style) — ignore all later lines
  if (entry.meta.oceanSuccessDone) return;

  const pnr = oceanSuccess.extractPnr(msg);
  if (pnr && oceanSuccess.isDirectRun(entry.meta)) {
    entry.meta.oceanSuccessDone = true;
    entry.meta.pnr = pnr;
    entry.meta.status = 'booked';
    msg = oceanSuccess.formatSuccessStatus(entry.meta.uiEngine, {
      pnr,
    });
    if (onOceanApiSuccess) {
      const fullData = entry.meta.bookingFullData || null;
      Promise.resolve(onOceanApiSuccess(sessionId, pnr, fullData)).catch((e) => {
        console.warn('[Ocean Success] report failed', e?.message || e);
      });
    }
  }

  if (/^SCRIPT END/i.test(msg)) {
    const prev = String(entry.meta.statusMessage || '').trim();
    if (/Passenger Submit \(\d+\) \(510\/Client IP\)/i.test(prev)) return;
    if (/510 Unable to Process|Client IP — 3 retries failed/i.test(prev)) return;
  }

  entry.meta.statusMessage = msg;
  // Mirror status to desktop.stdout.log; the ms countdown is throttled to ~1/s.
  if (!/^Passenger Submit in /i.test(msg) || Date.now() - (entry.meta._lastCountdownLog || 0) > 1000) {
    if (/^Passenger Submit in /i.test(msg)) entry.meta._lastCountdownLog = Date.now();
    console.log(`[Ocean Status] ${String(sessionId).slice(0, 8)} ${msg}`);
  }
  const fareM = String(msg || '').match(
    /(?:Available|AVL|RAC|WL)-\d+\s*\|\s*([\d.]+)/i
  );
  if (fareM) entry.meta.lastFare = fareM[1];
  if (panelStatusEmitter && entry.meta.journeyId) {
    panelStatusEmitter(entry.meta.journeyId, entry.meta.pairIndex || 1, msg);
  }
}

function makeRunStatusCallback(sessionId) {
  return (message) => pushRunStatus(sessionId, message);
}

function applyStealthToSession(ses) {
  applySessionStealth(ses, chromeUA || getChromeUserAgent());
}

async function injectStealth(webContents) {
  if (!webContents || webContents.isDestroyed()) return;
  try {
    // Consistency-first for Electron too (less over-spoof)
    await webContents.executeJavaScript(getConsistencyStealthSource(), true);
    await webContents.executeJavaScript(getStealthInjectSource(), true);
  } catch (err) {
    console.warn('[Ocean] Stealth inject failed:', err && err.message ? err.message : err);
  }
}

function attachStealthHooks(win) {
  const wc = win.webContents;
  const run = () => injectStealth(wc);
  wc.on('dom-ready', run);
  wc.on('did-finish-load', run);
  wc.on('did-frame-finish-load', () => injectStealth(wc));
}

function publicMeta(meta, win, chromeHandle) {
  let url = meta.url || '';
  let title = meta.title || '';
  if (win && !win.isDestroyed()) {
    url = win.webContents.getURL();
    title = win.getTitle();
  } else if (chromeHandle && chromeHandle.page && !chromeHandle.closed) {
    try {
      url = chromeHandle.page.url();
    } catch (_) {}
  }
  return {
    sessionId: meta.sessionId,
    journeyId: meta.journeyId,
    credentialId: meta.credentialId,
    paymentId: meta.paymentId,
    mode: meta.mode,
    engine: meta.engine || 'electron',
    status: meta.status,
    partition: meta.partition,
    url,
    title,
    journeyName: meta.journeyName || '',
    credentialName: meta.credentialName || '',
    paymentName: meta.paymentName || '',
    pairIndex: meta.pairIndex || 1,
    statusMessage: meta.statusMessage || '',
    lastFare: meta.lastFare || '',
    error: meta.error || null,
    createdAt: meta.createdAt,
  };
}

function broadcast() {
  const win = controlWindowGetter();
  if (!win || win.isDestroyed()) return;
  win.webContents.send('runs:status', { runs: listRuns() });
}

function listRuns() {
  const out = [];
  for (const [, entry] of runs) {
    out.push(publicMeta(entry.meta, entry.window, entry.chrome));
  }
  return out;
}

function getRun(sessionId) {
  return runs.get(sessionId) || null;
}

/** Attach IRCTC bookingData / verifyPayment JSON before BOOKED status (Direct). */
function setBookingFullData(sessionId, fullData) {
  const entry = runs.get(sessionId);
  if (!entry || !entry.meta) return false;
  if (!fullData || typeof fullData !== 'object') return false;
  entry.meta.bookingFullData = fullData;
  return true;
}

function getWindow(sessionId) {
  const entry = runs.get(sessionId);
  if (!entry || !entry.window || entry.window.isDestroyed()) return null;
  return entry.window;
}

function getChromeHandle(sessionId) {
  const entry = runs.get(sessionId);
  if (!entry || !entry.chrome || entry.chrome.closed) return null;
  return entry.chrome;
}

/** Cookies for Direct Host (Chrome page or Electron partition). */
async function getRunCookies(sessionId) {
  const entry = runs.get(sessionId);
  if (!entry) return [];
  try {
    if(entry.chrome?.engine==='headless'&&entry.chrome.reveal){return entry.chrome.reveal();}
  if (entry.chrome && entry.chrome.page && !entry.chrome.closed) {
      return await entry.chrome.page.cookies();
    }
  } catch (e) {
    console.warn('[Ocean] getRunCookies chrome:', e.message || e);
  }
  try {
    const partition = entry.meta && entry.meta.partition;
    if (partition) {
      const ses = session.fromPartition(partition);
      return await ses.cookies.get({});
    }
  } catch (e) {
    console.warn('[Ocean] getRunCookies electron:', e.message || e);
  }
  return [];
}

function resolveUrl(mode) {
  return mode === 'eticket' ? IRCTC_URLS.eticket : IRCTC_URLS.nget;
}

function normalizeRunMode(mode) {
  if (mode === 'direct') return 'direct';
  if (mode === 'eticket') return 'eticket';
  return 'nget';
}

function waitForEvent(emitter, eventName, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout waiting for ${eventName}`));
    }, timeoutMs);
    const handler = (...args) => {
      cleanup();
      resolve(args);
    };
    const cleanup = () => {
      clearTimeout(t);
      emitter.removeListener(eventName, handler);
    };
    emitter.once(eventName, handler);
  });
}

/**
 * Best combo createRun:
 * engine: 'system-chrome' | 'brave' (Ocean host+slot CDP) | 'electron' (fallback)
 */
async function createRun({
  journeyId,
  credentialId,
  paymentId,
  mode = 'nget',
  engine = 'system-chrome',
  pairIndex = 1,
  ipMode = null,
  proxyId = null,
  quota = null,
  uiEngine = null,
}) {
  if (String(uiEngine || '').toLowerCase() === 'app') {
    return { ok: false, error: 'APP mode has been removed. Choose WEB 2, WEB 3 or HEADLESS.' };
  }
  if (runs.size >= MAX_PARALLEL_RUNS) {
    return { ok: false, error: `Max ${MAX_PARALLEL_RUNS} parallel runs` };
  }
  if (!journeyId || !credentialId || !paymentId) {
    return { ok: false, error: 'journeyId, credentialId and paymentId are required' };
  }

  const bundle = profileStore.getBundleForRun({ journeyId, credentialId, paymentId });
  if (!bundle.journey) return { ok: false, error: 'Journey profile not found' };
  if (!bundle.credential) return { ok: false, error: 'Credential profile not found' };
  if (!bundle.payment) return { ok: false, error: 'Payment profile not found' };

  // Panel quota override (PT fare check uses this)
  const q = String(quota || '').trim().toUpperCase();
  if (q) {
    bundle.journey = { ...bundle.journey, quota: q };
  }

  const sessionId = crypto.randomUUID();
  const runMode = normalizeRunMode(mode);
  const startUrl = resolveUrl(runMode === 'eticket' ? 'eticket' : 'nget');
  const eng =
    engine === 'headless' ? 'headless' :
    engine === 'brave' || engine === 'system-brave'
      ? 'brave'
      : engine === 'electron'
        ? 'electron'
        : 'system-chrome';
  const wantHost = eng !== 'electron';
  const safePair = Math.max(
    1,
    Math.min(MAX_PAIRS_PER_JOURNEY, Number(pairIndex) || 1)
  );
  const resolvedIpMode =
    ipMode === 'proxy' || ipMode === 'auto'
      ? ipMode
      : bundle.journey?.options?.ipMode === 'proxy'
        ? 'proxy'
        : 'auto';
  const resolvedProxyId =
    resolvedIpMode === 'proxy'
      ? String(proxyId || bundle.journey?.options?.proxyId || '').trim() || null
      : null;

  const resolvedUiEngine = eng === 'headless' ? 'headless'
    : String(uiEngine || '').toLowerCase() === 'web3' || eng === 'brave'
      ? 'web3' : 'web2';

  const meta = {
    sessionId,
    journeyId,
    credentialId,
    paymentId,
    mode: runMode,
    engine: eng,
    uiEngine: resolvedUiEngine,
    status: 'opening',
    partition: wantHost ? null : `persist:ocean-slot-${sessionId}`,
    url: startUrl,
    title: '',
    journeyName: bundle.journey.name,
    credentialName: bundle.credential.name || bundle.credential.username,
    paymentName: bundle.payment.name,
    pairIndex: safePair,
    ipMode: resolvedIpMode,
    proxyId: resolvedProxyId,
    statusMessage: 'LAUNCHING…',
    error: null,
    oceanSuccessDone: false,
    bookingFullData: null,
    createdAt: new Date().toISOString(),
  };

  runs.set(sessionId, { meta, chrome: null, window: null, bundle });
  const onStatusMessage = makeRunStatusCallback(sessionId);

  // --- Preferred: System Chrome or Brave host (real TLS + CDP stealth + Direct API) ---
  if (wantHost) {
    pushRunStatus(sessionId, 'LAUNCHING…');
    const launcher =
      eng === 'headless' ? headlessRunner.launchHeadlessRun : eng === 'brave' ? braveRunner.launchSystemBraveRun : chromeRunner.launchSystemChromeRun;
    const result = await launcher({
      sessionId,
      startUrl,
      bundle,
      meta,
      mode: meta.mode,
      onStatus: broadcast,
      onStatusMessage,
    });
    if (!result.ok) {
      if(eng==='headless'){runs.delete(sessionId);broadcast();return {ok:false,error:result.error||'Headless launch failed'};}
      console.warn(
        `[Ocean] ${eng === 'brave' ? 'Brave' : 'System Chrome'} failed, falling back to Electron:`,
        result.error
      );
      runs.delete(sessionId);
      // fall through to Electron
    } else {
      runs.set(sessionId, { meta, chrome: result.handle, window: null, bundle });
      result.handle.browser.on('disconnected', () => {
        const entry = runs.get(sessionId);
        const jid = entry?.meta?.journeyId;
        if (entry) {
          entry.meta.status = 'done';
          entry.chrome = null;
        }
        pushRunStatus(sessionId, 'SCRIPT END · browser closed');
        runs.delete(sessionId);
        maybeClearInitPaymentFlag(jid);
        broadcast();
      });
      broadcast();
      return { ok: true, run: publicMeta(meta, null, result.handle) };
    }
  }

  // --- Fallback / explicit: Electron Chromium window ---
  return createElectronRun({ sessionId, startUrl, bundle, meta, onStatusMessage });
}

async function createElectronRun({ sessionId, startUrl, bundle, meta, onStatusMessage }) {
  meta.engine = 'electron';
  meta.partition = `persist:ocean-slot-${sessionId}`;
  const partition = meta.partition;
  const irctcSession = session.fromPartition(partition);
  applyStealthToSession(irctcSession);
  try {
    const rawProxy = profileStore.getProxyConfig({ proxyId: meta.proxyId });
    const proxyCfg = resolveProxyForIpMode(meta.ipMode || 'auto', rawProxy);
    if (proxyCfg.error) {
      return { ok: false, error: `Proxy config: ${proxyCfg.error}` };
    }
    await applyProxyToSession(irctcSession, proxyCfg);
    console.log(
      `[Ocean] Electron IP mode=${meta.ipMode || 'auto'} proxy=${proxyCfg.enabled ? 'on' : 'off'}`
    );
  } catch (e) {
    console.warn('[Ocean] Electron proxy attach failed:', e.message || e);
  }
  try {
    attachElectronIrctcNetwork(irctcSession);
  } catch (e) {
    console.warn('[Ocean] Electron DNR attach failed:', e.message || e);
  }
  const ua = chromeUA || getChromeUserAgent();
  const wa = getWorkArea(screen.getPrimaryDisplay());
  const { width, height } = clampSize(
    LAYOUT.irctcElectron.width,
    LAYOUT.irctcElectron.height,
    wa,
    0.85
  );

  const win = new BrowserWindow({
    ...centerBounds(wa, width, height, -20),
    minWidth: LAYOUT.irctcElectron.minWidth,
    minHeight: LAYOUT.irctcElectron.minHeight,
    show: false,
    title: `IRCTC — ${bundle.credential.username || bundle.credential.name}`,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-irctc.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition,
      spellcheck: false,
      additionalArguments: [`--ocean-session-id=${sessionId}`],
    },
  });

  win.webContents.setUserAgent(ua);
  runs.set(sessionId, { meta, window: win, chrome: null, bundle });
  attachStealthHooks(win);
  if (onStatusMessage) {
    pushRunStatus(sessionId, 'LAUNCHING…');
    win.webContents.on('console-message', (_e, _level, message) => {
      const text = String(message || '');
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
      const jsDirect = text.match(/\[JS-Direct\]\s*\[(?:IRCTC-Direct|PhonePe-Direct)\]\s*(.+)/);
      if (jsDirect) {
        onStatusMessage(jsDirect[1].trim());
        return;
      }
      const irctcDirect = text.match(/\[IRCTC-Direct\]\s*(.+)/);
      if (irctcDirect) onStatusMessage(irctcDirect[1].trim());
      const phonePe = text.match(/\[PhonePe-Direct\]\s*(.+)/);
      if (phonePe) onStatusMessage(phonePe[1].trim());
    });
  }

  win.webContents.on('did-finish-load', () => {
    meta.url = win.webContents.getURL();
    meta.title = win.getTitle();
    if (meta.status === 'opening') meta.status = 'running';
    if (onStatusMessage) onStatusMessage('RUNNING');
    broadcast();
  });

  win.webContents.on('did-navigate', () => {
    meta.url = win.webContents.getURL();
    broadcast();
  });

  win.webContents.on('did-navigate-in-page', () => {
    meta.url = win.webContents.getURL();
    broadcast();
  });

  win.on('closed', () => {
    const entry = runs.get(sessionId);
    const jid = entry?.meta?.journeyId;
    if (entry) {
      entry.meta.status = 'done';
      entry.window = null;
    }
    pushRunStatus(sessionId, 'SCRIPT END · window closed');
    runs.delete(sessionId);
    maybeClearInitPaymentFlag(jid);
    broadcast();
  });

  try {
    console.log('[Ocean Stealth] Electron boot about:blank + CDP…');
    await win.loadURL('about:blank');
    try {
      await waitForEvent(win.webContents, 'did-finish-load', 10000);
    } catch (_) {}
    // Prefer consistency script via CDP
    try {
      const dbg = win.webContents.debugger;
      if (dbg.isAttached()) {
        try {
          dbg.detach();
        } catch (_) {}
      }
      dbg.attach('1.3');
      await dbg.sendCommand('Page.enable');
      await dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
        source: getConsistencyStealthSource(),
      });
      await dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
        source: getStealthInjectSource(),
      });
      // Token capture for Direct Booking (and harmless on classic)
      try {
        const tokenInjector = fs.readFileSync(
          path.join(__dirname, 'inject', 'token-injector.js'),
          'utf8'
        );
        await dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
          source: tokenInjector,
        });
      } catch (te) {
        console.warn('[Ocean Stealth] token-injector skip:', te.message);
      }
      dbg.detach();
    } catch (e) {
      await installNewDocumentStealth(win.webContents);
      console.warn('[Ocean Stealth] CDP partial:', e.message);
    }

    await win.loadURL(startUrl, { userAgent: ua });
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) win.show();
    });
    setTimeout(() => {
      if (!win.isDestroyed() && !win.isVisible()) win.show();
    }, 4000);

    if (meta.mode === 'eticket' || meta.mode === 'nget' || meta.mode === 'direct') {
      meta.status = 'stealth-boot';
      broadcast();
      setTimeout(() => {
        if (win.isDestroyed() || !runs.has(sessionId)) return;
        console.log('[Ocean Auto] grace done — attaching automation (Electron)', meta.mode);
        attachAutomation(sessionId, win, bundle, {
          graceAlreadyWaited: true,
          mode: meta.mode,
          onStatusMessage,
        });
        meta.status = 'automating';
        if (onStatusMessage) onStatusMessage('AUTOMATING');
        broadcast();
      }, AUTOMATION_GRACE_MS);
    } else {
      meta.status = 'running';
    }

    broadcast();
    return { ok: true, run: publicMeta(meta, win, null) };
  } catch (err) {
    console.error('[Ocean Stealth] Electron launch failed', err);
    meta.error = err.message || String(err);
    meta.status = 'error';
    try {
      if (!win.isDestroyed()) win.close();
    } catch (_) {}
    runs.delete(sessionId);
    broadcast();
    return { ok: false, error: meta.error };
  }
}

function focusRun(sessionId) {
  const entry = runs.get(sessionId);
  if (!entry) return { ok: false, error: 'Run not found' };
  if (entry.chrome && entry.chrome.page && !entry.chrome.closed) {
    try {
      entry.chrome.page.bringToFront();
    } catch (_) {}
    return { ok: true, run: publicMeta(entry.meta, null, entry.chrome) };
  }
  if (!entry.window || entry.window.isDestroyed()) {
    return { ok: false, error: 'Run not found' };
  }
  if (entry.window.isMinimized()) entry.window.restore();
  entry.window.focus();
  return { ok: true, run: publicMeta(entry.meta, entry.window, null) };
}

async function stopRun(sessionId) {
  const entry = runs.get(sessionId);
  if (!entry) return { ok: false, error: 'Run not found' };
  const journeyId = entry.meta?.journeyId;
  rejectPtFareWait(sessionId, false);
  pushRunStatus(sessionId, 'SCRIPT END · stopped');
  if (entry.chrome) {
    entry.meta.status = 'done';
    if(entry.chrome.engine==='headless')await headlessRunner.closeHeadlessHandle(entry.chrome);else await chromeRunner.closeChromeHandle(entry.chrome);
    runs.delete(sessionId);
    maybeClearInitPaymentFlag(journeyId);
    broadcast();
    return { ok: true };
  }
  if (entry.window && !entry.window.isDestroyed()) {
    entry.meta.status = 'done';
    entry.window.close();
  } else {
    runs.delete(sessionId);
    maybeClearInitPaymentFlag(journeyId);
    broadcast();
  }
  return { ok: true };
}

function rejectPtFareWait(sessionId, proceed = false) {
  const w = ptFareWaiters.get(sessionId);
  if (!w) return;
  ptFareWaiters.delete(sessionId);
  try {
    w.resolve(Boolean(proceed));
  } catch (_) {}
}

function maybeClearInitPaymentFlag(journeyId) {
  if (!journeyId) return;
  for (const entry of runs.values()) {
    if (entry?.meta?.journeyId === journeyId) return;
  }
  initPaymentSuccessByJourney.delete(journeyId);
}

function markInitPaymentSuccess(journeyId, pairIndex, sessionId) {
  if (!journeyId) return { ok: false };
  const pi = Math.max(1, Number(pairIndex) || 1);
  initPaymentSuccessByJourney.set(String(journeyId), {
    pairIndex: pi,
    sessionId: sessionId || '',
    at: Date.now(),
  });
  console.log(`[Ocean] initPayment flag set journey=${journeyId} pair=${pi}`);
  return { ok: true };
}

function getSiblingInitPayment(journeyId, myPairIndex) {
  if (!journeyId) return null;
  const f = initPaymentSuccessByJourney.get(String(journeyId));
  if (!f) return null;
  const mine = Math.max(1, Number(myPairIndex) || 1);
  if ((f.pairIndex || 1) === mine) return null;
  return f;
}

/**
 * Panel pe Proceed anyway wait (PT fare / sibling pair share).
 * @returns {Promise<boolean>}
 */
function waitForProceedAnyway(sessionId, { statusMessage, reason, amount, maxFare } = {}) {
  const entry = runs.get(sessionId);
  if (!entry) return Promise.resolve(false);

  const prev = ptFareWaiters.get(sessionId);
  if (prev) {
    try {
      prev.resolve(false);
    } catch (_) {}
    ptFareWaiters.delete(sessionId);
  }

  const status = String(statusMessage || 'PROCEED ANYWAY?').trim() || 'PROCEED ANYWAY?';
  pushRunStatus(sessionId, status);
  if (panelPtFareEmitter && entry.meta.journeyId) {
    panelPtFareEmitter(entry.meta.journeyId, entry.meta.pairIndex || 1, {
      sessionId,
      amount: Number(amount) || 0,
      maxFare: Number(maxFare) || 0,
      reason: reason || 'proceed',
      statusMessage: status,
      show: true,
    });
  }

  return new Promise((resolve) => {
    ptFareWaiters.set(sessionId, {
      resolve: (ok) => {
        if (panelPtFareEmitter && entry.meta.journeyId) {
          panelPtFareEmitter(entry.meta.journeyId, entry.meta.pairIndex || 1, {
            sessionId,
            show: false,
          });
        }
        resolve(Boolean(ok));
      },
    });
  });
}

/**
 * Addon totalCollectibleAmount > MAX PT FARE → panel pe wait for Proceed anyway.
 * @returns {Promise<boolean>} true = continue booking
 */
function waitForPtFareProceed(sessionId, { amount, maxFare } = {}) {
  return waitForProceedAnyway(sessionId, {
    statusMessage: 'PT FARE HIGH',
    reason: 'pt-fare',
    amount,
    maxFare,
  });
}

/**
 * Same ticket dusra pair pehle bookingInitPayment OK kar chuka → wait / stop.
 * @returns {Promise<boolean>} true = aage badho
 */
async function waitIfSiblingInitPayment(sessionId) {
  const entry = runs.get(sessionId);
  if (!entry?.meta?.journeyId) return true;
  const sibling = getSiblingInitPayment(entry.meta.journeyId, entry.meta.pairIndex || 1);
  if (!sibling) return true;
  console.log(
    `[Ocean] sibling initPayment already pair=${sibling.pairIndex} → wait journey=${entry.meta.journeyId}`
  );
  return waitForProceedAnyway(sessionId, {
    statusMessage: 'ANOTHER PAIR ALREADY PROCEED',
    reason: 'sibling-init',
  });
}

function resolvePtFareProceed(sessionId, proceed = true) {
  if (!sessionId) return { ok: false, error: 'sessionId required' };
  const w = ptFareWaiters.get(sessionId);
  if (!w) return { ok: false, error: 'No proceed wait pending' };
  ptFareWaiters.delete(sessionId);
  if (proceed) pushRunStatus(sessionId, 'PROCEEDING…');
  try {
    w.resolve(Boolean(proceed));
  } catch (_) {}
  const entry = runs.get(sessionId);
  if (entry && panelPtFareEmitter && entry.meta.journeyId) {
    panelPtFareEmitter(entry.meta.journeyId, entry.meta.pairIndex || 1, {
      sessionId,
      show: false,
    });
  }
  return { ok: true };
}

/** Panel X / pair close → stop only that journey+pair script (not other pairs) */
async function stopRunsForPair(journeyId, pairIndex) {
  if (!journeyId) return { ok: false, error: 'journeyId required' };
  const pi = Math.max(1, Number(pairIndex) || 1);
  const toStop = [];
  for (const [sessionId, entry] of runs.entries()) {
    if (!entry?.meta) continue;
    if (entry.meta.journeyId !== journeyId) continue;
    if ((entry.meta.pairIndex || 1) !== pi) continue;
    toStop.push(sessionId);
  }
  let directHost;
  try {
    directHost = require('./direct-booking-host');
  } catch (_) {
    directHost = null;
  }
  for (const sessionId of toStop) {
    try {
      await stopRun(sessionId);
    } catch (e) {
      console.warn('[Ocean] stopRunsForPair failed', sessionId, e.message || e);
    }
    if (directHost) {
      try {
        directHost.closeDirectHost(sessionId);
        directHost.closeDirectHost(`${sessionId}-phonepe`);
        directHost.closeDirectHost(`${sessionId}-paytm`);
      } catch (_) {}
    }
  }
  console.log(
    `[Ocean] panel closed → stopped ${toStop.length} run(s) for journey=${journeyId} pair=${pi}`
  );
  return { ok: true, stopped: toStop.length, sessionIds: toStop };
}

function stopAll() {
  for (const sessionId of [...runs.keys()]) {
    stopRun(sessionId);
  }
}

module.exports = {
  MAX_PARALLEL_RUNS,
  configure,
  createRun,
  focusRun,
  stopRun,
  stopRunsForPair,
  waitForPtFareProceed,
  waitIfSiblingInitPayment,
  markInitPaymentSuccess,
  resolvePtFareProceed,
  stopAll,
  listRuns,
  getRun,
  setBookingFullData,
  getWindow,
  getChromeHandle,
  getRunCookies,
  broadcast,
  pushRunStatus,
  findChromePath: chromeRunner.findChromePath,
  findBravePath: braveRunner.findBravePath,
};
