const { app, BrowserWindow, ipcMain, session, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const {
  getChromeUserAgent,
  SPOOF_CHROME_MAJOR,
  syncChromeVersionFromSystem,
  getStealthInjectSource,
  applyCommandLineStealth,
} = require('./stealth');
const profileStore = require('./profile-store');
const sessionManager = require('./session-manager');
const trainService = require('./train-service');
const inputEngine = require('./input-engine');
const chromeRunner = require('./chrome-runner');
const directBookingHost = require('./direct-booking-host');
const licenseGate = require('./license-gate');
const supportLinks = require('./support-links');
const lexusSuccess = require('./ocean-success');
const lexusUpdater = require('./ocean-updater');
const {
  LAYOUT,
  MAX_PAIRS_PER_JOURNEY,
  positionToolbarShell,
  multiPanelBounds,
  ticketRowBounds,
  getWorkArea,
  centerBounds,
  clampSize,
  getModalBounds,
} = require('./window-layout');

/** App / shortcut / taskbar icon (build/icon.ico preferred). */
function getAppIconPath() {
  const candidates = [
    path.join(__dirname, 'assets', 'lexus.ico'),
    path.join(__dirname, 'build', 'icon.ico'),
    path.join(__dirname, 'icon.ico'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (_) {}
  }
  return undefined;
}
const APP_ICON = getAppIconPath();

let controlWindow = null;
let modalWindow = null;
let requestedModalName = 'tickets';
let trainResultsWindow = null;
let pendingTrainQuery = null;
let pendingTrainSelection = null;
let pendingNewBookDraft = false;
let chromeUA = '';
let web2BrowserInfo = null;
/** @type {import('electron').BrowserWindow | null} */
let phonePeTestWindow = null;
/** @type {import('electron').BrowserWindow | null} */
let licenseWindow = null;
/** @type {import('electron').BrowserWindow | null} */
let newsWindow = null;
let licenseUnlocked = false;
let mainAppOpened = false;
/** @type {null | { news: object, leftDays: number|null, appVersion: string }} */
let pendingNewsPayload = null;

const TEST_PHONEPE_START = process.argv.includes('--test-phonepe-start');
const SKIP_LICENSE =
  process.argv.includes('--skip-license') ||
  process.env.OCEAN_SKIP_LICENSE === '1' ||
  TEST_PHONEPE_START;

/** @type {Map<string, import('electron').BrowserWindow>} */
const ticketPanelWindows = new Map();
const bookingScheduler = require('./booking-scheduler.cjs').createScheduler({
  launch: opts => {
    if (sessionManager.listRuns().some(run => run.journeyId === opts.journeyId && Number(run.pairIndex) === Number(opts.pairIndex || 1))) {
      return { ok: false, error: 'A run is already active for this pair' };
    }
    return sessionManager.createRun(opts);
  },
  notify: (id, data) => {
    const target = require('electron').webContents.fromId(id);
    if (target && !target.isDestroyed()) target.send('panel:schedule', data);
  },
});
/** journeyId → Map(pairIndex → credentialId) — one IRCTC ID per pair, list order */
/** @type {Map<string, Map<number, string>>} */
const pairCredentialAssign = new Map();
/** Floating Scan&Pay QR — separate window on top of panel (panel size unchanged) */
/** @type {Map<string, import('electron').BrowserWindow>} */
const panelQrWindows = new Map();

function getPairCredMap(journeyId) {
  if (!pairCredentialAssign.has(journeyId)) {
    pairCredentialAssign.set(journeyId, new Map());
  }
  return pairCredentialAssign.get(journeyId);
}

function clearPairCredentials(journeyId) {
  pairCredentialAssign.delete(journeyId);
}

function releasePairCredential(journeyId, pairIndex) {
  getPairCredMap(journeyId).delete(Number(pairIndex) || 1);
}

/**
 * IRCTC IDs in use across ALL open ticket panels (global lock).
 * Optional except = this panel's own current slot (not counted as used).
 */
function collectUsedCredentialIds(exceptJourneyId, exceptPairIndex) {
  const used = new Set();
  const exceptPi =
    exceptPairIndex != null ? Math.max(1, Number(exceptPairIndex) || 1) : null;
  for (const [jid, map] of pairCredentialAssign.entries()) {
    for (const [pi, id] of map.entries()) {
      if (!id) continue;
      if (
        exceptJourneyId != null &&
        jid === exceptJourneyId &&
        exceptPi != null &&
        Number(pi) === exceptPi
      ) {
        continue;
      }
      used.add(id);
    }
  }
  return used;
}

function refreshAllTicketPanels() {
  for (const jid of listOpenJourneyIdsInOrder()) {
    refreshTicketPanels(jid);
  }
}

/**
 * Assign IRCTC IDs from list start. Already-taken IDs skipped (global — all panels).
 * No reuse fallback — free ID na mile to empty (pair/ticket open blocked separately).
 * Returns credentialId for this pair.
 */
function assignCredentialForPair(journeyId, pairIndex, credentials) {
  const list = Array.isArray(credentials) ? credentials : [];
  const pi = Math.max(1, Number(pairIndex) || 1);
  const map = getPairCredMap(journeyId);
  const cur = map.get(pi);
  if (cur && list.some((c) => c.id === cur)) {
    return cur;
  }
  const used = collectUsedCredentialIds(journeyId, pi);
  for (const c of list) {
    if (c?.id && !used.has(c.id)) {
      map.set(pi, c.id);
      return c.id;
    }
  }
  map.delete(pi);
  return '';
}

/** True if at least one ACTIVE IRCTC ID is still free (global — all open panels). */
function hasFreeCredentialForNextPair(_journeyId) {
  const list = profileStore.listActiveCredentials();
  const used = collectUsedCredentialIds();
  return list.some((c) => c?.id && !used.has(c.id));
}

/** User picked an ID on a pair — steal from any other panel if needed, then refill. */
function setPairCredential(journeyId, pairIndex, credentialId, credentials) {
  const pi = Math.max(1, Number(pairIndex) || 1);
  const id = String(credentialId || '');
  const map = getPairCredMap(journeyId);
  if (!id) {
    map.delete(pi);
    return;
  }
  for (const [jid, otherMap] of pairCredentialAssign.entries()) {
    for (const [otherPi, otherId] of [...otherMap.entries()]) {
      if (jid === journeyId && Number(otherPi) === pi) continue;
      if (otherId === id) otherMap.delete(otherPi);
    }
  }
  map.set(pi, id);
  // Re-fill any open pair that lost its ID (all tickets)
  for (const jid of listOpenJourneyIdsInOrder()) {
    for (const openPi of listOpenPairIndexes(jid)) {
      if (!getPairCredMap(jid).has(openPi)) {
        assignCredentialForPair(jid, openPi, credentials);
      }
    }
  }
}

function panelKey(journeyId, pairIndex) {
  return `${journeyId}-${pairIndex || 1}`;
}

function closePanelQrPopup(key) {
  const w = panelQrWindows.get(key);
  if (w && !w.isDestroyed()) {
    try {
      w.close();
    } catch (_) {}
  }
  panelQrWindows.delete(key);
}

function emitPanelStatus(journeyId, pairIndex, message) {
  if (!journeyId || message == null) return;
  const key = panelKey(journeyId, pairIndex);
  const win = ticketPanelWindows.get(key);
  if (win && !win.isDestroyed()) {
    win.webContents.send('panel:status', {
      message: String(message),
      ts: Date.now(),
    });
  }
}

/** Direct API: pair screenshot + success report (local history + optional LEXUS_SUCCESS_URL) (no Classic animation). */
async function handleLexusApiBookingSuccess(sessionId, pnr, fullData) {
  const entry = sessionManager.getRun(sessionId);
  if (!entry?.meta) return;
  if (entry.meta.lexusSuccessUploadDone) return;
  entry.meta.lexusSuccessUploadDone = true;

  const journeyId = entry.meta.journeyId;
  const pairIndex = entry.meta.pairIndex || 1;
  const win = ticketPanelWindows.get(panelKey(journeyId, pairIndex));

  // STAR-style: mark IRCTC ID BOOKED so only ACTIVE IDs stay in panel dropdowns
  try {
    const cred = entry.bundle?.credential || {};
    const marked = profileStore.markCredentialBooked({
      id: cred.id,
      username: cred.username || cred.name || '',
    });
    if (marked) {
      console.log('[LEXUS Cred] marked BOOKED', marked.username || marked.name || marked.id);
      entry.meta.credentialBooked = true;
      // Other open panels: drop BOOKED id from assign map + refresh dropdowns
      // (skip this success panel so Success UI stays)
      try {
        const bookedId = marked.id;
        const exceptKey = panelKey(journeyId, pairIndex);
        for (const map of pairCredentialAssign.values()) {
          for (const [pi, cid] of [...map.entries()]) {
            if (cid === bookedId) map.delete(pi);
          }
        }
        const activeCreds = profileStore.listActiveCredentials();
        for (const jid of listOpenJourneyIdsInOrder()) {
          for (const pi of listOpenPairIndexes(jid)) {
            const key = `${jid}-${pi}`;
            if (key === exceptKey) continue;
            if (!getPairCredMap(jid).has(pi)) {
              assignCredentialForPair(jid, pi, activeCreds);
            }
            const w = ticketPanelWindows.get(key);
            if (w && !w.isDestroyed()) {
              sendPanelInit(w, buildPanelInitPayload(jid, pi));
            }
          }
        }
      } catch (e) {
        console.warn('[LEXUS Cred] panel refresh after BOOKED failed:', e?.message || e);
      }
    } else {
      console.warn('[LEXUS Cred] BOOKED mark skipped — credential not found');
    }
  } catch (e) {
    console.warn('[LEXUS Cred] BOOKED mark failed:', e?.message || e);
  }

  // Let Success status + frozen clock paint before capture
  await new Promise((r) => setTimeout(r, 400));

  let base64image = '';
  // STAR: screenshot pe clock thoda peeche (Lexus: −7s)
  const pnrTime = new Date(Date.now() - 7000).toLocaleTimeString('en-GB', {
    hour12: false,
  });
  if (win && !win.isDestroyed()) {
    try {
      // Mask IRCTC ID + rewind clock for screenshot only (PNR already masked on panel)
      win.webContents.send('panel:privacy-mask');
      await new Promise((r) => setTimeout(r, 120));
      const img = await win.webContents.capturePage();
      base64image = img.toPNG().toString('base64');
    } catch (e) {
      console.warn('[LEXUS Success] capturePage failed:', e?.message || e);
    } finally {
      try {
        if (!win.isDestroyed()) win.webContents.send('panel:privacy-restore');
      } catch (_) {}
    }
  }

  const licence = licenseGate.getSavedLicense();
  const payload = lexusSuccess.buildSuccessPayload({
    journey: entry.bundle?.journey,
    payment: entry.bundle?.payment,
    pnr,
    licenceKey: licence.key,
    base64image,
    uiEngine: entry.meta.uiEngine,
    pnrTime,
  });

  try {
    console.log('[LEXUS Success] POST /api/app/success', {
      ...payload,
      base64image: base64image ? `[${base64image.length} chars]` : '(empty)',
    });
    const result = await lexusSuccess.postSuccessPayload(payload);
    console.log('[LEXUS Success] upload', result.status, String(result.text || '').slice(0, 240));
  } catch (e) {
    console.warn('[LEXUS Success] upload failed:', e?.message || e);
  }

  try {
    const bookingHistory = require('./booking-history');
    const journey = entry.bundle?.journey || {};
    const cred = entry.bundle?.credential || {};
    const pay = entry.bundle?.payment || {};
    const dtoData = fullData || entry.meta.bookingFullData || null;
    const star = bookingHistory.mapStarHistoryFields(dtoData, {
      pnr,
      userId: cred.username || cred.name || '',
      bankFallback: pay.name || pay.paymentMethod || pay.vpa || '',
      journey,
    });
    const row = profileStore.addBookingHistory({
      ...star,
      engine: entry.meta.uiEngine || entry.meta.engine || '',
      mode: entry.meta.mode || '',
      journeyName: journey.name || star.ticketName || '',
    });
    broadcastBookingHistory(row);
    console.log('[LEXUS History] saved', row.pnr, row.ticketName, row.fare);

    // STAR-style ERS PDF (Direct full_data only)
    if (dtoData && dtoData.bookingResponseDTO) {
      setImmediate(() => {
        try {
          const ticketPrinter = require('./ticket-printer');
          Promise.resolve(ticketPrinter.printTicket(dtoData))
            .then((r) => {
              if (r?.ok) console.log('[LEXUS Print] OK', r.path);
              else console.warn('[LEXUS Print]', r?.error || 'failed');
            })
            .catch((e) => console.warn('[LEXUS Print]', e?.message || e));
        } catch (e) {
          console.warn('[LEXUS Print] load failed', e?.message || e);
        }
      });
    }
  } catch (e) {
    console.warn('[LEXUS History] save failed:', e?.message || e);
  }
}

function broadcastBookingHistory(latest) {
  const payload = {
    items: profileStore.listBookingHistory({ limit: 100 }),
    latest: latest || null,
  };
  try {
    if (controlWindow && !controlWindow.isDestroyed()) {
      controlWindow.webContents.send('history:updated', payload);
    }
  } catch (_) {}
  try {
    if (modalWindow && !modalWindow.isDestroyed()) {
      modalWindow.webContents.send('history:updated', payload);
    }
  } catch (_) {}
}

function emitPanelPtFare(journeyId, pairIndex, payload) {
  if (!journeyId) return;
  const key = panelKey(journeyId, pairIndex);
  const win = ticketPanelWindows.get(key);
  if (win && !win.isDestroyed()) {
    win.webContents.send('panel:pt-fare', {
      ...(payload || {}),
      ts: Date.now(),
    });
  }
}

function stationCodeShort(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const parts = s.split(' - ');
  if (parts.length > 1) return parts[parts.length - 1].trim().toUpperCase();
  if (/^[A-Z]{2,5}$/i.test(s)) return s.toUpperCase();
  if (s.length <= 5) return s.toUpperCase();
  return s.slice(0, 4).toUpperCase();
}

function formatMoneyAmt(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return '';
  return n.toFixed(2);
}

/** Caption under QR: Pay Using QR :- BWN_KAN Amt= ₹ 31.80 */
function buildQrPayCaption(journeyId, pairIndex, opts = {}) {
  let from = '';
  let to = '';
  try {
    const journey = journeyId ? profileStore.getJourney(journeyId) : null;
    from = stationCodeShort(journey?.from);
    to = stationCodeShort(journey?.to);
  } catch (_) {}
  const route = from && to ? `${from}_${to}` : from || to || '';

  let amount = formatMoneyAmt(opts.amount);
  if (!amount) {
    try {
      const runs = sessionManager.listRuns() || [];
      const pi = Math.max(1, Number(pairIndex) || 1);
      const hit = runs.find(
        (r) =>
          r.journeyId === journeyId && Math.max(1, Number(r.pairIndex) || 1) === pi
      );
      amount = formatMoneyAmt(hit?.lastFare);
      if (!amount && hit?.statusMessage) {
        const m = String(hit.statusMessage).match(
          /(?:Available|AVL|RAC|WL)-\d+\s*\|\s*([\d.]+)/i
        );
        if (m) amount = formatMoneyAmt(m[1]);
      }
      // fallback: any run on this journey with lastFare
      if (!amount) {
        const any = runs.find((r) => r.journeyId === journeyId && r.lastFare);
        amount = formatMoneyAmt(any?.lastFare);
      }
    } catch (_) {}
  }

  // Internal run meta (listRuns may omit lastFare)
  if (!amount && journeyId) {
    try {
      for (const r of sessionManager.listRuns() || []) {
        if (r.journeyId !== journeyId) continue;
        const entry = sessionManager.getRun(r.sessionId);
        const fare = entry?.meta?.lastFare;
        amount = formatMoneyAmt(fare);
        if (amount) break;
      }
    } catch (_) {}
  }

  const parts = ['Pay Using QR :-'];
  if (route) parts.push(route);
  if (amount) parts.push(`Amt= ₹ ${amount}`);
  return parts.join(' ');
}

ipcMain.on('panel:qr-closed', (e) => {
  try { shrinkPanelAfterQr(BrowserWindow.fromWebContents(e.sender)); } catch (_) {}
});

function emitPanelQr(journeyId, pairIndex, qrBase64, opts = {}) {
  if (!journeyId || !qrBase64) return;
  const key = panelKey(journeyId, pairIndex);
  const panel = ticketPanelWindows.get(key);
  if (!panel || panel.isDestroyed()) return;
  let src = String(qrBase64).trim();
  if (!src) return;
  if (!src.startsWith('data:')) src = 'data:image/png;base64,' + src;
  closePanelQrPopup(key);
  growPanelForQr(panel);
  panel.webContents.send('panel:qr', {qrBase64:src, caption:buildQrPayCaption(journeyId,pairIndex,opts)});
  panel.show();
}

/** QR sits in an extra strip below the ticket panel (window grows downward, panel stays visible). */
const PANEL_QR_EXTRA_HEIGHT = 300;
function growPanelForQr(panel) {
  try {
    if (!panel || typeof panel.getBounds !== 'function' || panel.__qrBaseHeight) return;
    const b = panel.getBounds();
    const wa = typeof screen !== 'undefined' && screen.getDisplayMatching
      ? screen.getDisplayMatching(b).workArea
      : null;
    let y = b.y;
    if (wa && y + b.height + PANEL_QR_EXTRA_HEIGHT > wa.y + wa.height) {
      y = Math.max(wa.y, wa.y + wa.height - b.height - PANEL_QR_EXTRA_HEIGHT);
    }
    panel.__qrBaseHeight = b.height;
    if (typeof panel.setMinimumSize === 'function') panel.setMinimumSize(0, 0);
    panel.setBounds({ x: b.x, y, width: b.width, height: b.height + PANEL_QR_EXTRA_HEIGHT });
  } catch (_) {}
}

function shrinkPanelAfterQr(panel) {
  try {
    if (!panel || panel.isDestroyed() || !panel.__qrBaseHeight) return;
    const b = panel.getBounds();
    const h = panel.__qrBaseHeight;
    panel.__qrBaseHeight = 0;
    panel.setBounds({ x: b.x, y: b.y, width: b.width, height: h });
  } catch (_) {}
}

function emitPanelQrHide(journeyId, pairIndex) {
  if (!journeyId) return;
  const key = panelKey(journeyId,pairIndex);
  closePanelQrPopup(key);
  const panel = ticketPanelWindows.get(key);
  if (panel && !panel.isDestroyed()) {
    panel.webContents.send('panel:qr-hide', {});
    shrinkPanelAfterQr(panel);
  }
}

function resolvePanelFromRunSession(sessionId) {
  if (!sessionId) return null;
  const base = String(sessionId).replace(/-(phonepe|paytm)$/i, '');
  const entry = sessionManager.getRun(base);
  if (!entry || !entry.meta) return null;
  return {
    journeyId: entry.meta.journeyId,
    pairIndex: entry.meta.pairIndex || 1,
  };
}

applyCommandLineStealth();

function positionControlShellForUi(win, opts) {
  positionToolbarShell(win, opts);
}

function flushPendingTrainSelection() {
  if (!pendingTrainSelection || !modalWindow || modalWindow.isDestroyed()) return;
  modalWindow.webContents.send('train:selected', pendingTrainSelection);
  pendingTrainSelection = null;
}

function flushPendingNewBookDraft() {
  if (!pendingNewBookDraft || !modalWindow || modalWindow.isDestroyed()) return;
  const send = () => {
    if (!modalWindow || modalWindow.isDestroyed()) return;
    modalWindow.webContents.send('book:new-draft');
  };
  send();
  // Retry — renderer may still be wiring listeners on first paint
  setTimeout(send, 80);
  setTimeout(send, 250);
  pendingNewBookDraft = false;
}

function deliverTrainSelection(payload) {
  const data = payload || {};
  if (modalWindow && !modalWindow.isDestroyed()) {
    modalWindow.webContents.send('train:selected', data);
    modalWindow.focus();
    return;
  }
  pendingTrainSelection = data;
  openModalShell('book');
}

function openModalShell(modalName) {
  const name = String(modalName || 'tickets').trim() || 'tickets';
  requestedModalName = name;
  if (name === 'book') trainService.warmAvailability().catch(error => console.warn('[LEXUS Train] warmup:', error.message));
  const modalKind = name === 'book' ? 'book' : 'default';
  const { bounds, minWidth, minHeight } = getModalBounds(modalKind);

  if (modalWindow && !modalWindow.isDestroyed()) {
    try {
      modalWindow.setBackgroundColor('#071426');
    } catch (_) {}
    try {
      // Tickets→Edit Book: same window reused — resize so book layout matches New Ticket
      modalWindow.setMinimumSize(minWidth, minHeight);
      modalWindow.setBounds(bounds, false);
    } catch (_) {}
    modalWindow.webContents.send('shell:open-modal', name);
    if (modalWindow.isMinimized()) modalWindow.restore();
    modalWindow.show();
    modalWindow.focus();
    flushPendingTrainSelection();
    flushPendingNewBookDraft();
    return { ok: true, reused: true };
  }

  modalWindow = new BrowserWindow({
    ...bounds,
    minWidth,
    minHeight,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#071426',
    hasShadow: true,
    resizable: true,
    autoHideMenuBar: true,
    title: 'LEXUS',
    ...(APP_ICON ? { icon: APP_ICON } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload-ui.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  modalWindow.once('ready-to-show', () => modalWindow.show());
  modalWindow.webContents.on('did-finish-load', () => {
    if (modalWindow && !modalWindow.isDestroyed()) {
      modalWindow.webContents.send('shell:open-modal', requestedModalName);
      flushPendingTrainSelection();
      flushPendingNewBookDraft();
    }
  });
  modalWindow.on('closed', () => {
    modalWindow = null;
  });
  modalWindow.loadFile(path.join(__dirname, 'index.html'), {
    query: { view: 'modal', modal: name },
  });
  return { ok: true };
}

function closeModalShell() {
  if (modalWindow && !modalWindow.isDestroyed()) {
    modalWindow.hide();
  }
  return { ok: true };
}

function openPhonePeTestWindow() {
  if (phonePeTestWindow && !phonePeTestWindow.isDestroyed()) {
    phonePeTestWindow.focus();
    return;
  }
  phonePeTestWindow = new BrowserWindow({
    width: 520,
    height: 720,
    show: false,
    title: 'LEXUS — Test PhonePe start_process',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-test-phonepe.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  phonePeTestWindow.once('ready-to-show', () => phonePeTestWindow.show());
  phonePeTestWindow.on('closed', () => {
    phonePeTestWindow = null;
  });
  phonePeTestWindow.loadFile(path.join(__dirname, 'test-phonepe-start.html'));
}

function openMainApp() {
  if (!SKIP_LICENSE && !licenseUnlocked) {
    console.warn('[LEXUS] Main app blocked — license not valid');
    return;
  }
  if (TEST_PHONEPE_START) {
    openPhonePeTestWindow();
    return;
  }
  mainAppOpened = true;
  if (!controlWindow || controlWindow.isDestroyed()) {
    createControlWindow();
  } else {
    try {
      controlWindow.show();
      controlWindow.focus();
    } catch (_) {}
  }
}

function hasNewsContent(payload) {
  if (!payload) return false;
  return (payload.news?.items || []).length > 0;
}

function openNewsOrMain(raw) {
  if (!licenseUnlocked && !SKIP_LICENSE) return;
  pendingNewsPayload = licenseGate.buildNewsPayload(raw);
  if (!hasNewsContent(pendingNewsPayload)) {
    pendingNewsPayload = null;
    openMainApp();
    return;
  }
  createNewsWindow();
}

function closeNewsWindow() {
  if (newsWindow && !newsWindow.isDestroyed()) {
    try {
      newsWindow.close();
    } catch (_) {}
  }
  newsWindow = null;
}

function createNewsWindow() {
  if (newsWindow && !newsWindow.isDestroyed()) {
    newsWindow.focus();
    return newsWindow;
  }

  const wa = getWorkArea(screen.getPrimaryDisplay());
  const size = LAYOUT.news || { width: 984, height: 680 };
  const { width, height } = clampSize(size.width, size.height, wa, 0.92);
  const bounds = centerBounds(wa, width, height);

  newsWindow = new BrowserWindow({
    width,
    height,
    x: bounds.x,
    y: bounds.y,
    useContentSize: true,
    minWidth: size.minWidth || 680,
    minHeight: size.minHeight || 520,
    resizable: true,
    maximizable: false,
    show: false,
    autoHideMenuBar: true,
    title: 'LEXUS',
    backgroundColor: '#071426',
    ...(APP_ICON ? { icon: APP_ICON } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload-news.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  newsWindow.once('ready-to-show', () => {
    try {
      newsWindow.show();
      newsWindow.focus();
    } catch (_) {}
  });
  newsWindow.on('closed', () => {
    newsWindow = null;
    pendingNewsPayload = null;
    if (licenseUnlocked && !mainAppOpened && !SKIP_LICENSE) {
      openMainApp();
    }
  });
  newsWindow.loadFile(path.join(__dirname, 'news.html')).catch((err) => {
    console.error('[LEXUS] news UI load failed', err);
    if (licenseUnlocked) openMainApp();
  });
  return newsWindow;
}

function closeLicenseWindow() {
  if (licenseWindow && !licenseWindow.isDestroyed()) {
    try {
      licenseWindow.close();
    } catch (_) {}
  }
  licenseWindow = null;
}

function createLicenseWindow() {
  if (licenseWindow && !licenseWindow.isDestroyed()) {
    licenseWindow.focus();
    return licenseWindow;
  }

  const wa = getWorkArea(screen.getPrimaryDisplay());
  const size = LAYOUT.license || { width: 460, height: 420 };
  const { width, height } = clampSize(size.width, size.height, wa, 0.9);
  const bounds = centerBounds(wa, width, height);

  licenseWindow = new BrowserWindow({
    width,
    height,
    x: bounds.x,
    y: bounds.y,
    useContentSize: true,
    minWidth: size.minWidth || 260,
    minHeight: size.minHeight || 168,
    resizable: false,
    maximizable: false,
    minimizable: false,
    show: false,
    autoHideMenuBar: true,
    title: 'LEXUS',
    backgroundColor: '#E4F0FC',
    ...(APP_ICON ? { icon: APP_ICON } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload-license.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  licenseWindow.once('ready-to-show', () => {
    try {
      licenseWindow.show();
      licenseWindow.focus();
    } catch (_) {}
  });
  licenseWindow.on('closed', () => {
    licenseWindow = null;
    if (!licenseUnlocked && !SKIP_LICENSE) {
      // User closed license without unlock → quit
      app.quit();
    }
  });
  licenseWindow.loadFile(path.join(__dirname, 'license.html')).catch((err) => {
    console.error('[LEXUS] license UI load failed', err);
  });
  return licenseWindow;
}

async function runLicenseGate() {
  if (SKIP_LICENSE) {
    licenseUnlocked = true;
    console.log('[LEXUS] License gate skipped');
    openMainApp();
    return;
  }

  // Hamesha license box — saved key sirf pre-fill hoti hai, Activate user karega
  createLicenseWindow();
}

ipcMain.handle('license:bootstrap', async () => {
  try {
    const info = await licenseGate.getMachineId();
    const saved = licenseGate.getSavedLicense();
    return {
      ok: true,
      machine: info.mac,
      uuid: info.uuid,
      name: saved.name || '',
      key: saved.key || '',
    };
  } catch (e) {
    return { ok: false, machine: '', error: e.message || String(e) };
  }
});

ipcMain.handle('license:activate', async (_e, payload) => {
  const result = await licenseGate.verifyLicense({
    key: payload?.key,
    name: payload?.name,
  });
  if (result.ok) {
    licenseUnlocked = true;
    closeLicenseWindow();
    openNewsOrMain(result.raw);
  } else {
    licenseUnlocked = false;
    mainAppOpened = false;
  }
  return {
    ok: result.ok,
    code: result.code,
    reason: result.reason,
    machine: result.machine,
    leftDays: result.raw?.leftDays,
    appVersion: result.raw?.appVersion,
    hasNews: hasNewsContent(licenseGate.buildNewsPayload(result.raw)),
  };
});

ipcMain.handle('news:get', () => pendingNewsPayload || licenseGate.buildNewsPayload({
  News: profileStore.getUiState()?.licenceNews,
  leftDays: profileStore.getUiState()?.licenceLeftDays,
}));

ipcMain.handle('news:ack', () => {
  if (!licenseUnlocked && !SKIP_LICENSE) {
    return { ok: false, reason: 'license_required' };
  }
  pendingNewsPayload = null;
  mainAppOpened = true;
  closeNewsWindow();
  openMainApp();
  return { ok: true };
});

ipcMain.handle('license:quit', () => {
  app.quit();
  return { ok: true };
});

function createControlWindow() {
  controlWindow = new BrowserWindow({
    width: 1060,
    height: LAYOUT.shell.toolbar.height,
    minWidth: LAYOUT.shell.toolbar.minWidth,
    minHeight: LAYOUT.shell.toolbar.minHeight,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    hasShadow: true,
    resizable: true,
    backgroundColor: '#00000000',
    title: 'LEXUS',
    ...(APP_ICON ? { icon: APP_ICON } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload-ui.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const reveal = () => {
    if (!controlWindow || controlWindow.isDestroyed()) return;
    try {
      positionControlShellForUi(controlWindow);
    } catch (err) {
      console.error('[LEXUS] position toolbar failed', err);
    }
    if (!controlWindow.isVisible()) controlWindow.show();
    controlWindow.focus();
    console.log('[LEXUS] Control window shown', controlWindow.getBounds());
  };

  controlWindow.once('ready-to-show', reveal);
  controlWindow.webContents.once('did-finish-load', () => {
    console.log('[LEXUS] Control UI loaded');
    reveal();
  });
  controlWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[LEXUS] Control UI failed to load', code, desc, url);
    reveal();
  });
  // Failsafe: never stay invisible
  setTimeout(reveal, 2500);

  controlWindow.loadFile(path.join(__dirname, 'index.html'), {
    query: { view: 'toolbar' },
  }).catch((err) => {
    console.error('[LEXUS] loadFile failed', err);
    reveal();
  });

  controlWindow.on('closed', () => {
    controlWindow = null;
    closeModalShell();
    sessionManager.stopAll();
  });
}



app.whenReady().then(async () => {
  app.setName('LEXUS');
  // MUST run before preload generate — UA/sec-ch-ua must match installed Chrome
  const ver = syncChromeVersionFromSystem();
  web2BrowserInfo = {version:ver.detected?ver.full:'Not detected',path:ver.path||'',source:ver.path&&/[\\/]browsers[\\/]chrome[\\/]/i.test(ver.path)?'Bundled Chrome':(process.env.LEXUS_CHROME_PATH || process.env.OCEAN_CHROME_PATH)?'Custom Chrome':'Installed Chrome'};
  try {
    require('./stealth-preload-build').writeStealthPreload();
    console.log('[LEXUS Stealth] frame preload generated for Chrome', ver.full || SPOOF_CHROME_MAJOR);
  } catch (e) {
    console.warn('[LEXUS Stealth] preload generate failed', e.message);
  }

  chromeUA = getChromeUserAgent();
  app.userAgentFallback = chromeUA;
  // Control UI uses defaultSession — only set UA, do NOT attach webRequest
  // (header rewriting on file:// can hang the Lexus window on Electron 43).
  session.defaultSession.setUserAgent(chromeUA);

  await profileStore.init();
  console.log('[LEXUS] SQLite DB:', profileStore.getDbPath());
  console.log(
    '[LEXUS] Spoof Chrome UA:',
    chromeUA,
    `| engine Chromium ${process.versions.chrome} → public v${require('./stealth').SPOOF_CHROME_MAJOR}`
  );
  console.log('[LEXUS] System Chrome path:', sessionManager.findChromePath() || '(not found — Electron fallback)');
  console.log('[LEXUS] Brave path:', sessionManager.findBravePath() || '(not found)');

  sessionManager.configure({
    getControlWindow: () => controlWindow,
    userAgent: chromeUA,
    emitPanelStatus,
    emitPanelPtFare,
    emitPanelQr,
    emitPanelQrHide,
    onLexusApiSuccess: handleLexusApiBookingSuccess,
  });

  lexusUpdater.registerUpdaterIpc({canUpdate:()=>bookingScheduler.pendingCount()===0});

  // Updates never delay opening the app or a booking window.

  console.log('[LEXUS] License gate…');
  await runLicenseGate();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (licenseUnlocked || SKIP_LICENSE) openMainApp();
      else createLicenseWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('license:get-about', () => {
  const saved = licenseGate.getSavedLicense();
  return {
    key: saved.key || '',
    leftDays: saved.leftDays,
    version: app.getVersion(),
    web2Browser:web2BrowserInfo, runtimeChrome:process.versions.chrome,
  };
});

ipcMain.handle('license:refresh-about', async () => {
  const saved = licenseGate.getSavedLicense();
  if (!saved.key) {
    return { ok: false, key: '', leftDays: null, version: app.getVersion() };
  }
  const result = await licenseGate.verifyLicense({ key: saved.key });
  const leftDays = result.raw?.leftDays ?? licenseGate.getSavedLicense().leftDays ?? null;
  if (leftDays != null && !Number.isNaN(Number(leftDays))) {
    profileStore.setUiState({ licenceLeftDays: String(leftDays) });
  }
  const refreshed = licenseGate.getSavedLicense();
  return {
    ok: result.ok,
    key: refreshed.key || saved.key,
    leftDays,
    version: app.getVersion(),
    web2Browser:web2BrowserInfo, runtimeChrome:process.versions.chrome,
    reason: result.reason || null,
  };
});

ipcMain.handle('app:open-support-link', async (_e, kind) => {
  const key = String(kind || '').toLowerCase();
  const url =
    key === 'telegram'
      ? supportLinks.TELEGRAM
      : key === 'whatsapp'
        ? supportLinks.WHATSAPP_CHANNEL
        : '';
  if (!url) return { ok: false, reason: 'unknown' };
  try {
    await shell.openExternal(url);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message || String(err) };
  }
});

ipcMain.handle('app:get-info', () => ({
  name: app.getName(),
  version: app.getVersion(),
    web2Browser:web2BrowserInfo, runtimeChrome:process.versions.chrome,
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  chromeSpoof: require('./stealth').SPOOF_CHROME_MAJOR,
  node: process.versions.node,
  platform: process.platform,
  userAgent: chromeUA || getChromeUserAgent(),
  dbPath: profileStore.getDbPath(),
  maxParallelRuns: sessionManager.MAX_PARALLEL_RUNS,
}));

ipcMain.handle('app:quit', () => {
  app.quit();
  return { ok: true };
});

ipcMain.handle('ui:set-shell-mode', () => {
  if (!controlWindow || controlWindow.isDestroyed()) return { ok: false };
  positionControlShellForUi(controlWindow);
  return { ok: true, mode: 'toolbar' };
});

ipcMain.handle('ui:toolbar-menu', (_e, opts) => {
  const open = Boolean(opts && opts.open);
  if (!controlWindow || controlWindow.isDestroyed()) return { ok: false };
  positionControlShellForUi(controlWindow, { menuOpen: open });
  return { ok: true, menuOpen: open };
});

ipcMain.handle('ui:open-modal', (_e, modalName) => openModalShell(modalName));

ipcMain.handle('ui:new-book-draft', () => {
  pendingNewBookDraft = true;
  profileStore.setUiState({ selectedJourneyId: null });
  return openModalShell('book');
});
ipcMain.handle('ui:close-modal', () => closeModalShell());

function closeTicketPanelsFor(journeyId) {
  for (const [key, win] of ticketPanelWindows.entries()) {
    if (!key.startsWith(`${journeyId}-`)) continue;
    closePanelQrPopup(key);
    if (win && !win.isDestroyed()) win.close();
    ticketPanelWindows.delete(key);
  }
  clearPairCredentials(journeyId);
}

function getTicketPanelSize() {
  const workArea = getWorkArea(screen.getPrimaryDisplay());
  const panel = LAYOUT.ticketPanel;
  return {
    workArea,
    ...clampSize(panel.width, panel.height, workArea, 0.85),
    panel,
  };
}

function listOpenPairIndexes(journeyId) {
  const out = [];
  const max = MAX_PAIRS_PER_JOURNEY || 4;
  for (let i = 1; i <= max; i++) {
    const w = ticketPanelWindows.get(`${journeyId}-${i}`);
    if (w && !w.isDestroyed()) out.push(i);
  }
  return out;
}

function nextFreePairIndex(journeyId) {
  const open = new Set(listOpenPairIndexes(journeyId));
  const max = MAX_PAIRS_PER_JOURNEY || 4;
  for (let i = 1; i <= max; i++) {
    if (!open.has(i)) return i;
  }
  return null;
}

function refreshTicketPanels(journeyId) {
  for (const pi of listOpenPairIndexes(journeyId)) {
    const w = ticketPanelWindows.get(`${journeyId}-${pi}`);
    if (w && !w.isDestroyed()) {
      sendPanelInit(w, buildPanelInitPayload(journeyId, pi));
    }
  }
}

function listOpenJourneyIdsInOrder() {
  const out = [];
  const seen = new Set();
  for (const key of ticketPanelWindows.keys()) {
    const dash = key.lastIndexOf('-');
    if (dash <= 0) continue;
    const jid = key.slice(0, dash);
    const pi = key.slice(dash + 1);
    if (!/^\d+$/.test(pi)) continue;
    if (seen.has(jid)) continue;
    if (listOpenPairIndexes(jid).length === 0) continue;
    seen.add(jid);
    out.push(jid);
  }
  return out;
}

/** All tickets: each ticket = one horizontal row; next ticket = row below. */
function positionAllTicketPanels() {
  const { workArea, width, height, panel } = getTicketPanelSize();
  const gap = panel.gap;
  const journeys = listOpenJourneyIdsInOrder();
  journeys.forEach((jid, rowIndex) => {
    const pairs = listOpenPairIndexes(jid);
    if (!pairs.length) return;
    const bounds = ticketRowBounds(
      workArea,
      width,
      height,
      pairs.length,
      rowIndex,
      gap
    );
    pairs.forEach((pi, col) => {
      const w = ticketPanelWindows.get(`${jid}-${pi}`);
      if (w && !w.isDestroyed() && bounds[col]) {
        w.setBounds(bounds[col], false);
      }
    });
  });
}

function positionTicketPanels(_journeyId) {
  positionAllTicketPanels();
}

function sendPanelInit(win, payload) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('panel:init', payload);
}

function buildPanelInitPayload(journeyId, pairIndex) {
  const journey = profileStore.getJourney(journeyId);
  // Panel / auto-assign: ACTIVE only (BOOKED IDs hidden like STAR)
  const credentials = profileStore.listActiveCredentials();
  const payments = profileStore.listSummaries('payments');
  const ui = profileStore.getUiState();
  const openPairs = listOpenPairIndexes(journeyId);
  const maxPairs = MAX_PAIRS_PER_JOURNEY || 4;
  const nextPair = nextFreePairIndex(journeyId);
  const pi = Math.max(1, Number(pairIndex) || 1);
  const assignedCredId = assignCredentialForPair(journeyId, pi, credentials);
  const usedByOthers = collectUsedCredentialIds(journeyId, pi);
  // Dropdown: own assigned ID + still-free IDs (global — no double-assign in UI)
  const credentialsForPair = credentials.filter(
    (c) => c.id === assignedCredId || !usedByOthers.has(c.id)
  );
  return {
    journeyId,
    pairIndex: pi,
    journey,
    credentials: credentialsForPair,
    allCredentials: credentials,
    payments,
    proxies: profileStore.listProxiesForPanel(),
    selectedCredentialId: assignedCredId,
    selectedPaymentId: ui.selectedPaymentId,
    maxPairs,
    openPairs,
    openPairCount: openPairs.length,
    nextPairIndex: nextPair,
    canOpenNextPair: pi === 1 && nextPair != null,
    pair2Open: openPairs.includes(2),
  };
}

function createTicketPanelWindow(journeyId, pairIndex) {
  const journey = profileStore.getJourney(journeyId);
  if (!journey) return { ok: false, error: 'Ticket not found' };

  const max = MAX_PAIRS_PER_JOURNEY || 4;
  const pi = Math.max(1, Math.min(max, Number(pairIndex) || 1));
  const key = `${journeyId}-${pi}`;
  const existing = ticketPanelWindows.get(key);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return { ok: true, reused: true, pairIndex: pi };
  }

  const { width, height, panel } = getTicketPanelSize();
  const win = new BrowserWindow({
    width,
    height,
    minWidth: panel.minWidth,
    minHeight: panel.minHeight,
    title: `${journey.name} - ${pi}`,
    frame: false,
    transparent: true,
    hasShadow: true,
    alwaysOnTop: true,
    show: false,
    autoHideMenuBar: true,
    ...(APP_ICON ? { icon: APP_ICON } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload-ticket-panel.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  ticketPanelWindows.set(key, win);
  // Reserve ID now (global lock) before other panels refresh / async load
  assignCredentialForPair(
    journeyId,
    pi,
    profileStore.listActiveCredentials()
  );
  win.once('ready-to-show', () => {
    positionTicketPanels(journeyId);
    win.show();
  });
  win.webContents.on('did-finish-load', () => {
    sendPanelInit(win, buildPanelInitPayload(journeyId, pi));
  });
  win.on('closed', () => {
    closePanelQrPopup(key);
    ticketPanelWindows.delete(key);
    releasePairCredential(journeyId, pi);
    Promise.resolve(sessionManager.stopRunsForPair(journeyId, pi)).catch((e) => {
      console.warn('[LEXUS] stop on panel close failed', e.message || e);
    });
    positionTicketPanels(journeyId);
    refreshAllTicketPanels();
  });
  win.loadFile(path.join(__dirname, 'ticket-panel.html')).catch((err) => {
    console.error('[LEXUS] ticket panel load failed', err);
  });

  return { ok: true, pairIndex: pi };
}

function openTicketPanelPair(journeyId) {
  closeTicketPanelsFor(journeyId);
  if (!hasFreeCredentialForNextPair(journeyId)) {
    return { ok: false, error: 'IRCTC ID not available' };
  }
  const result = createTicketPanelWindow(journeyId, 1);
  if (result.ok) refreshAllTicketPanels();
  return result;
}

/** Open next free pair (2…4) for this ticket — PAIR 1 badge click ×3 = 4 panels. */
function openTicketPanelNextPair(journeyId) {
  if (!journeyId) return { ok: false, error: 'journeyId required' };
  const win1 = ticketPanelWindows.get(`${journeyId}-1`);
  if (!win1 || win1.isDestroyed()) {
    return { ok: false, error: 'PAIR 1 not open' };
  }
  if (!hasFreeCredentialForNextPair(journeyId)) {
    return {
      ok: false,
      error: 'IRCTC ID not available',
      openPairCount: listOpenPairIndexes(journeyId).length,
      maxPairs: MAX_PAIRS_PER_JOURNEY || 4,
    };
  }
  const next = nextFreePairIndex(journeyId);
  if (next == null) {
    refreshTicketPanels(journeyId);
    return {
      ok: false,
      error: `Max ${MAX_PAIRS_PER_JOURNEY || 4} pairs for this ticket`,
      openPairCount: listOpenPairIndexes(journeyId).length,
      maxPairs: MAX_PAIRS_PER_JOURNEY || 4,
    };
  }
  const result = createTicketPanelWindow(journeyId, next);
  if (result.ok) {
    positionTicketPanels(journeyId);
    refreshAllTicketPanels();
  }
  return {
    ...result,
    openPairCount: listOpenPairIndexes(journeyId).length,
    maxPairs: MAX_PAIRS_PER_JOURNEY || 4,
    nextPairIndex: nextFreePairIndex(journeyId),
  };
}

ipcMain.handle('panels:open-ticket', (_e, { journeyId }) => {
  if (!journeyId) return { ok: false, error: 'journeyId required' };
  return openTicketPanelPair(journeyId);
});

ipcMain.handle('panels:open-pair-2', (_e, { journeyId }) =>
  openTicketPanelNextPair(journeyId)
);
ipcMain.handle('panels:open-next-pair', (_e, { journeyId }) =>
  openTicketPanelNextPair(journeyId)
);

ipcMain.handle(
  'panels:set-pair-credential',
  (_e, { journeyId, pairIndex, credentialId }) => {
    if (!journeyId) return { ok: false, error: 'journeyId required' };
    const credentials = profileStore.listActiveCredentials();
    setPairCredential(journeyId, pairIndex || 1, credentialId, credentials);
    refreshAllTicketPanels();
    return {
      ok: true,
      selectedCredentialId: getPairCredMap(journeyId).get(
        Math.max(1, Number(pairIndex) || 1)
      ),
    };
  }
);

ipcMain.handle('panels:set-ip-choice', (_e, { journeyId, ipMode, proxyId } = {}) => {
  if (!journeyId) return { ok: false, error: 'journeyId required' };
  try {
    const journey = profileStore.updateJourneyIpChoice(journeyId, { ipMode, proxyId });
    if (!journey) return { ok: false, error: 'Journey not found' };
    refreshTicketPanels(journeyId);
    return { ok: true, journey };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('panels:schedule-run', (event, { hour, opts } = {}) => {
  const sender = event.sender;
  const owner = Array.from(ticketPanelWindows.entries()).find(([, win]) => !win.isDestroyed() && win.webContents === sender);
  if (!owner || owner[0] !== `${opts?.journeyId}-${opts?.pairIndex || 1}`) return { ok: false, error: 'Ticket panel does not match this schedule' };
  if (sessionManager.listRuns().some(run => run.journeyId === opts.journeyId && Number(run.pairIndex) === Number(opts.pairIndex || 1))) return { ok: false, error: 'Stop the current run before scheduling' };
  try {
    const result = bookingScheduler.arm(sender.id, hour, opts);
    const senderId = sender.id;
    sender.once('destroyed', () => bookingScheduler.cancel(senderId));
    return result;
  } catch (error) { return { ok: false, error: error.message }; }
});
ipcMain.handle('panels:cancel-schedule', event => { bookingScheduler.cancel(event.sender.id); return { ok: true }; });
ipcMain.handle('panels:launch-run', async (_e, opts) => {
  bookingScheduler.cancel(_e.sender.id);
  return (
  sessionManager.createRun({
    journeyId: opts?.journeyId,
    credentialId: opts?.credentialId,
    paymentId: opts?.paymentId,
    mode: opts?.mode || 'nget',
    engine: opts?.engine || 'system-chrome',
    pairIndex: opts?.pairIndex || 1,
    ipMode: opts?.ipMode || null,
    proxyId: opts?.proxyId || null,
    quota: opts?.quota || null,
    uiEngine: opts?.uiEngine || null,
  })
  );
});

ipcMain.handle('panels:pt-fare-proceed', (_e, { sessionId, proceed } = {}) =>
  sessionManager.resolvePtFareProceed(sessionId, proceed !== false)
);

ipcMain.handle('panels:pt-fare-wait', async (_e, { sessionId, amount, maxFare } = {}) => {
  if (!sessionId) return false;
  return sessionManager.waitForPtFareProceed(sessionId, { amount, maxFare });
});

ipcMain.handle('panels:sibling-init-wait', async (_e, { sessionId } = {}) => {
  if (!sessionId) return true;
  return sessionManager.waitIfSiblingInitPayment(sessionId);
});

ipcMain.handle('panels:mark-init-payment', (_e, { sessionId } = {}) => {
  if (!sessionId) return { ok: false };
  const entry = sessionManager.getRun(sessionId);
  if (!entry?.meta) return { ok: false };
  return sessionManager.markInitPaymentSuccess(
    entry.meta.journeyId,
    entry.meta.pairIndex || 1,
    sessionId
  );
});

ipcMain.on('run:panel-status', (_e, { sessionId, message }) => {
  if (sessionId && message != null) {
    sessionManager.pushRunStatus(sessionId, message);
  }
});

ipcMain.handle('panels:close-self', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) win.close();
  return { ok: true };
});

function openTrainResultsWindow(query) {
  trainService.warmAvailability().catch(error => console.warn('[LEXUS Train] warmup:', error.message));
  pendingTrainQuery = query || null;

  if (trainResultsWindow && !trainResultsWindow.isDestroyed()) {
    trainResultsWindow.focus();
    trainResultsWindow.reload();
    return { ok: true };
  }

  const wa = getWorkArea(screen.getPrimaryDisplay());
  const { width, height } = clampSize(
    LAYOUT.trainResults.width,
    LAYOUT.trainResults.height,
    wa,
    0.88
  );

  trainResultsWindow = new BrowserWindow({
    ...centerBounds(wa, width, height),
    minWidth: LAYOUT.trainResults.minWidth,
    minHeight: LAYOUT.trainResults.minHeight,
    show: false,
    title: 'Find trains · Availability',
    backgroundColor: '#071426',
    autoHideMenuBar: true,
    ...(APP_ICON ? { icon: APP_ICON } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload-results.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  trainResultsWindow.once('ready-to-show', () => trainResultsWindow.show());
  trainResultsWindow.loadFile(path.join(__dirname, 'results.html'));
  trainResultsWindow.on('closed', () => {
    trainResultsWindow = null;
  });
  return { ok: true };
}

ipcMain.handle('train:open-search', (_e, query) => openTrainResultsWindow(query || {}));
ipcMain.handle('train:get-query', () => pendingTrainQuery);

ipcMain.handle('train:fetch-list', async (_e, query) => {
  try {
    const { from, to, date } = query || {};
    const result = await trainService.fetchTrainList(from, to, date);
    return {
      ok: true,
      trains: result.trains,
      url: result.url,
      from: result.from,
      to: result.to,
      date: result.date,
    };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('train:fetch-availability', async (_e, payload) => {
  try {
    const data = await trainService.solveCaptchaAndFetchAvailability(payload || {});
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('train:apply-selection', async (_e, payload) => {
  const closeResults = payload?.closeResults !== false;
  const data = { ...(payload || {}) };
  delete data.closeResults;
  deliverTrainSelection(data);
  if (closeResults && trainResultsWindow && !trainResultsWindow.isDestroyed()) {
    trainResultsWindow.close();
  }
  return { ok: true };
});

// ── Profiles ──────────────────────────────────────────────
ipcMain.handle('profiles:list', (_e, kind) => profileStore.listSummaries(kind));

ipcMain.handle('profiles:get', (_e, { kind, id, includeSecrets }) => {
  if (kind === 'journeys' || kind === 'journey') return profileStore.getJourney(id);
  if (kind === 'credentials' || kind === 'credential') {
    return profileStore.getCredential(id, { includeSecrets: !!includeSecrets });
  }
  if (kind === 'payments' || kind === 'payment') {
    return profileStore.getPayment(id, { includeSecrets: !!includeSecrets });
  }
  return null;
});

ipcMain.handle('profiles:saveJourney', (_e, payload) => profileStore.saveJourney(payload || {}));
ipcMain.handle('profiles:saveCredential', (_e, payload) => profileStore.saveCredential(payload || {}));
ipcMain.handle('profiles:setCredentialStatus', (_e, { id, status }) =>
  profileStore.setCredentialStatus(id, status)
);
ipcMain.handle('profiles:savePayment', (_e, payload) => profileStore.savePayment(payload || {}));

ipcMain.handle('profiles:delete', (_e, { kind, id }) => profileStore.deleteProfile(kind, id));
ipcMain.handle('profiles:rename', (_e, { kind, id, name }) =>
  profileStore.renameProfile(kind, id, name)
);

ipcMain.handle('profiles:getUiState', () => profileStore.getUiState());
ipcMain.handle('profiles:setUiState', (_e, partial) => profileStore.setUiState(partial || {}));
ipcMain.handle('profiles:getTrueCaptcha', () => profileStore.getTrueCaptchaCredentials());
ipcMain.handle('profiles:setTrueCaptcha', (_e, payload) =>
  profileStore.setTrueCaptchaCredentials(payload || {})
);
ipcMain.handle('profiles:getProxy', () => profileStore.getProxyConfig());
ipcMain.handle('profiles:listProxies', () => ({
  proxies: profileStore.listProxies(),
}));
ipcMain.handle('profiles:setProxy', (_e, payload) => {
  try {
    return profileStore.setProxyConfig(payload || {});
  } catch (err) {
    throw new Error(err && err.message ? err.message : String(err));
  }
});
ipcMain.handle('profiles:addProxy', (_e, payload) => {
  try {
    const host = payload?.host != null ? payload.host : payload;
    const proxies = profileStore.addProxyFromString(host);
    try {
      refreshAllTicketPanels();
    } catch (_) {}
    return { ok: true, proxies, count: proxies.length };
  } catch (err) {
    throw new Error(err && err.message ? err.message : String(err));
  }
});
ipcMain.handle('profiles:deleteProxies', (_e, payload) => {
  try {
    const ids = payload?.ids || payload || [];
    const proxies = profileStore.deleteProxiesByIds(ids);
    try {
      refreshAllTicketPanels();
    } catch (_) {}
    return { ok: true, proxies, count: proxies.length };
  } catch (err) {
    throw new Error(err && err.message ? err.message : String(err));
  }
});
ipcMain.handle('profiles:testProxy', async (_e, payload) => {
  const { testProxyConnectivity } = require('./proxy-util');
  const raw = payload && typeof payload === 'object' ? payload : {};
  // Empty host → test by id, else first saved
  if (!String(raw.host || '').trim()) {
    const list = profileStore.listProxies();
    let target = null;
    if (raw.id) target = list.find((p) => p.id === raw.id) || null;
    if (!target) target = list[0] || null;
    if (!target?.host) {
      return { ok: false, error: 'No proxy to test — paste string or Save first' };
    }
    return testProxyConnectivity({
      type: target.type,
      host: target.host,
      port: target.port,
      username: target.username,
      password: target.password,
    });
  }
  return testProxyConnectivity(raw);
});

// ── Runs ──────────────────────────────────────────────────
ipcMain.handle('runs:start', (_e, opts) => sessionManager.createRun(opts || {}));
ipcMain.handle('chrome:find-path', () => ({
  path: sessionManager.findChromePath(),
  bravePath: sessionManager.findBravePath(),
}));
ipcMain.handle('runs:focus', (_e, sessionId) => sessionManager.focusRun(sessionId));
ipcMain.handle('runs:stop', (_e, sessionId) => sessionManager.stopRun(sessionId));
ipcMain.handle('runs:list', () => ({ runs: sessionManager.listRuns() }));

ipcMain.handle('history:list', () => ({
  items: profileStore.listBookingHistory({ limit: 100 }),
}));
ipcMain.handle('history:clear', () => {
  const result = profileStore.clearBookingHistory();
  broadcastBookingHistory(null);
  return result;
});
ipcMain.handle('history:booking-full', (_e, { sessionId, fullData } = {}) => {
  if (!sessionId || !fullData) return false;
  return sessionManager.setBookingFullData(sessionId, fullData);
});

// Legacy quick-open → starts a run only if profiles selected via opts.session shortcut
ipcMain.handle('irctc:open', async (_e, opts) => {
  const ui = profileStore.getUiState();
  const journeyId = opts?.journeyId || ui.selectedJourneyId;
  const credentialId = opts?.credentialId || ui.selectedCredentialId;
  const paymentId = opts?.paymentId || ui.selectedPaymentId;
  if (!journeyId || !credentialId || !paymentId) {
    return {
      ok: false,
      error: 'Select Journey + IRCTC Login + Payment, then Start Run',
    };
  }
  const eng =
    opts?.engine === 'brave' || opts?.engine === 'system-brave'
      ? 'brave'
      : opts?.engine === 'electron'
        ? 'electron'
        : 'system-chrome';
  const mode =
    opts?.mode === 'direct' ? 'direct' : opts?.mode === 'eticket' ? 'eticket' : 'nget';
  return sessionManager.createRun({
    journeyId,
    credentialId,
    paymentId,
    mode,
    engine: eng,
    ipMode: opts?.ipMode || null,
  });
});

ipcMain.handle('irctc:focus', async (_e, sessionId) => {
  if (sessionId) return sessionManager.focusRun(sessionId);
  const runs = sessionManager.listRuns();
  if (!runs.length) return { ok: false, open: false };
  return sessionManager.focusRun(runs[0].sessionId);
});

ipcMain.handle('irctc:close', async (_e, sessionId) => {
  if (sessionId) return sessionManager.stopRun(sessionId);
  sessionManager.stopAll();
  return { ok: true, open: false };
});

ipcMain.handle('irctc:get-status', async () => {
  const runs = sessionManager.listRuns();
  return {
    open: runs.length > 0,
    url: runs[0]?.url || '',
    runs,
  };
});

ipcMain.on('lexus:get-stealth-source', (event) => {
  event.returnValue = getStealthInjectSource();
});

ipcMain.on('irctc:preload-ready', (_event, payload) => {
  const sessionId = payload && payload.sessionId;
  console.log(
    '[LEXUS] IRCTC preload ready:',
    sessionId || '(no sessionId)',
    payload && payload.href ? payload.href : ''
  );
});

function requireSessionWindow(sessionId) {
  if (!sessionId) return null;
  return sessionManager.getWindow(sessionId);
}

function requireChromePage(sessionId) {
  const h = sessionManager.getChromeHandle(sessionId);
  return h && h.page && !h.closed ? h.page : null;
}

ipcMain.handle('native:click', async (_e, payload) => {
  const page = requireChromePage(payload?.sessionId);
  if (page) {
    try {
      return await chromeRunner.cdpClickSelector(
        page,
        payload.selector,
        payload.offsetXPercent ?? 50,
        payload.offsetYPercent ?? 50
      );
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  }
  const win = requireSessionWindow(payload?.sessionId);
  if (!win) return { success: false, error: 'session window missing' };
  try {
    return await inputEngine.clickSelector(
      win.webContents,
      payload.selector,
      payload.offsetXPercent ?? 50,
      payload.offsetYPercent ?? 50
    );
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
});

ipcMain.handle('native:type', async (_e, payload) => {
  const page = requireChromePage(payload?.sessionId);
  if (page) {
    try {
      return await chromeRunner.cdpTypeSelector(page, payload.selector, payload.text ?? '');
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  }
  const win = requireSessionWindow(payload?.sessionId);
  if (!win) return { success: false, error: 'session window missing' };
  try {
    return await inputEngine.typeSelector(
      win.webContents,
      payload.selector,
      payload.text ?? ''
    );
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
});

ipcMain.handle('native:key', async (_e, payload) => {
  const page = requireChromePage(payload?.sessionId);
  if (page) {
    try {
      return await chromeRunner.cdpKey(page, payload.key || 'Enter');
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  }
  const win = requireSessionWindow(payload?.sessionId);
  if (!win) return { success: false, error: 'session window missing' };
  try {
    await inputEngine.keyPress(win.webContents, payload.key || 'Enter');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
});

/** Direct Host: PhonePe (PaymentRedirect) off IRCTC browser — pehle jaisa. */
ipcMain.handle('direct-book:run', async (_e, payload) => {
  const sessionId = payload && payload.sessionId;
  if (!sessionId) throw new Error('sessionId required');

  const mode = (payload && payload.mode) || 'phonepe';
  let cookies = [];
  try {
    const page = requireChromePage(sessionId);
    if (page) {
      cookies = await page.cookies();
    } else {
      const win = requireSessionWindow(sessionId);
      if (win && !win.isDestroyed()) {
        cookies = await win.webContents.session.cookies.get({});
      }
    }
  } catch (e) {
    console.warn('[LEXUS] cookie harvest for Direct Host:', e.message || e);
  }

  const onStatus = (msg) => {
    try {
      sessionManager.pushRunStatus(sessionId, msg);
    } catch (_) {}
  };

  const runEntry = sessionManager.getRun(sessionId);
  const panelJourneyId = runEntry?.meta?.journeyId || '';
  const panelPairIndex = runEntry?.meta?.pairIndex || 1;

  const hostMode =
    mode === 'paytm' ? 'paytm' : mode === 'razorpay' ? 'razorpay' : 'phonepe';
  const out = await directBookingHost.runDirectBookingHost({
    sessionId: `${sessionId}-${hostMode}`,
    runSessionId: sessionId,
    panelJourneyId,
    panelPairIndex,
    ipMode: runEntry?.meta?.ipMode || 'auto',
    proxyId: runEntry?.meta?.proxyId || null,
    mode: hostMode,
    tokens: (payload && payload.tokens) || {},
    details: (payload && payload.details) || {},
    captchaCreds: (payload && payload.captchaCreds) || {},
    wsUser: (payload && payload.wsUser) || '',
    clientTxnId: (payload && payload.clientTxnId) || '',
    vpa: (payload && payload.vpa) || (payload && payload.details && payload.details.vpa) || '',
    cookies,
    onStatus,
    showHost: false,
  });
  try {
    const full =
      (out && out.result && out.result.full_data) ||
      (out && out.full_data) ||
      null;
    if (full) sessionManager.setBookingFullData(sessionId, full);
  } catch (_) {}
  return out;
});

ipcMain.on('direct-host:qr-show', (_e, { sessionId, qr, journeyId, pairIndex }) => {
  if (journeyId && qr) {
    emitPanelQr(journeyId, pairIndex || 1, qr);
    return;
  }
  const panel = resolvePanelFromRunSession(sessionId);
  if (panel && qr) {
    emitPanelQr(panel.journeyId, panel.pairIndex, qr);
    return;
  }
  // fallback: test window or first open ticket panel → floating QR
  if (!qr) return;
  if (phonePeTestWindow && !phonePeTestWindow.isDestroyed()) {
    phonePeTestWindow.webContents.send('test-phonepe:qr', { qr: String(qr), ts: Date.now() });
    try {
      phonePeTestWindow.show();
      phonePeTestWindow.focus();
    } catch (_) {}
    return;
  }
  for (const [key] of ticketPanelWindows.entries()) {
    const m = /^(.+)-(\d+)$/.exec(key);
    if (m) {
      emitPanelQr(m[1], Number(m[2]) || 1, qr);
      break;
    }
  }
});

ipcMain.on('direct-host:qr-hide', (_e, { sessionId, journeyId, pairIndex }) => {
  if (journeyId) {
    emitPanelQrHide(journeyId, pairIndex || 1);
    return;
  }
  const panel = resolvePanelFromRunSession(sessionId);
  if (panel) emitPanelQrHide(panel.journeyId, panel.pairIndex);
  if (phonePeTestWindow && !phonePeTestWindow.isDestroyed()) {
    phonePeTestWindow.webContents.send('test-phonepe:qr-hide', { ts: Date.now() });
  }
});

/** Isolated PhonePe test — skip mapps1 / IRCTC inject (normal browser se tokens lao). */
ipcMain.handle('test-phonepe:run', async (_e, payload) => {
  const tokens = (payload && payload.tokens) || {};
  const wsUser = (payload && payload.wsUser) || '';
  const clientTxnId = (payload && payload.clientTxnId) || '';
  if (!tokens.access_token) throw new Error('access_token required');
  if (!wsUser) throw new Error('wsUser required');
  if (!clientTxnId) throw new Error('clientTxnId required');

  const sendLog = (msg) => {
    if (phonePeTestWindow && !phonePeTestWindow.isDestroyed()) {
      phonePeTestWindow.webContents.send('test-phonepe:log', String(msg || ''));
    }
  };

  sendLog('Hidden Direct Host → start_process…');
  return directBookingHost.runDirectBookingHost({
    sessionId: `test-phonepe-${Date.now()}`,
    runSessionId: 'test',
    panelJourneyId: '',
    panelPairIndex: 1,
    mode: 'phonepe',
    tokens,
    wsUser,
    clientTxnId,
    cookies: [],
    onStatus: sendLog,
    showHost: false,
  });
});

ipcMain.on('action-click', async (_event, payload) => {
  if (!payload?.sessionId || payload.x == null || payload.y == null) {
    console.warn('[LEXUS] action-click rejected: sessionId/x/y required');
    return;
  }
  const page = requireChromePage(payload.sessionId);
  if (page) {
    try {
      const client = await page.createCDPSession();
      const x = Math.round(payload.x);
      const y = Math.round(payload.y);
      await client.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x,
        y,
        button: 'left',
        clickCount: 1,
      });
      await client.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x,
        y,
        button: 'left',
        clickCount: 1,
      });
    } catch (e) {
      console.warn('[LEXUS] action-click chrome failed', e.message);
    }
    return;
  }
  const win = requireSessionWindow(payload.sessionId);
  if (!win) return;
  try {
    await inputEngine.clickAt(win.webContents, payload.x, payload.y);
  } catch (e) {
    console.warn('[LEXUS] action-click failed', e.message);
  }
});

ipcMain.on('action-type', async (_event, payload) => {
  if (!payload?.sessionId) {
    console.warn('[LEXUS] action-type rejected: sessionId required');
    return;
  }
  const win = requireSessionWindow(payload.sessionId);
  if (!win) return;
  try {
    await inputEngine.typeText(win.webContents, payload.text ?? '');
  } catch (e) {
    console.warn('[LEXUS] action-type failed', e.message);
  }
});
