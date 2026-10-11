/**
 * Direct Booking host — PhonePe (PaymentRedirect → QR) off IRCTC browser tab.
 * mapps1 APIs can run in-page; PhonePe always hand-off here (Token Manager popup-parity).
 */

const { BrowserWindow, session, screen } = require('electron');
const path = require('path');
const { attachElectronIrctcNetwork } = require('./irctc-network');
const { getChromeUserAgent } = require('./stealth');
const { applyProxyToSession } = require('./proxy-session');
const profileStore = require('./profile-store');
const { resolveProxyForIpMode } = require('./proxy-util');
const { LAYOUT, centerBounds, clampSize, getWorkArea } = require('./window-layout');

/** @type {Map<string, { win: Electron.BrowserWindow }>} */
const hosts = new Map();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function cookieUrlForDomain(domain) {
  const d = String(domain || '.irctc.co.in').replace(/^\./, '');
  if (/phonepe\.com/i.test(d)) return 'https://mercury-t2.phonepe.com/';
  if (/paytm/i.test(d)) return 'https://secure.paytmpayments.com/';
  if (/razorpay\.com/i.test(d)) return 'https://checkout.razorpay.com/';
  if (/irctcipay\.com/i.test(d)) return 'https://www.irctcipay.com/';
  if (/wps\.irctc/i.test(d)) return 'https://www.wps.irctc.co.in/';
  if (/mapps\.irctc|mapps1\.irctc/i.test(d)) return 'https://www.irctc.co.in/';
  if (/irctc\.co\.in/i.test(d)) return 'https://www.irctc.co.in/';
  return `https://${d}/`;
}

async function applyCookiesToSession(ses, cookies) {
  const list = Array.isArray(cookies) ? cookies : [];
  for (const c of list) {
    if (!c || !c.name) continue;
    const domain = c.domain || '.irctc.co.in';
    const safeUrl = cookieUrlForDomain(domain);
    const exp =
      c.expirationDate && c.expirationDate > 0
        ? c.expirationDate
        : c.expires && c.expires > 0
          ? c.expires
          : undefined;
    try {
      await ses.cookies.set({
        url: safeUrl,
        name: c.name,
        value: String(c.value || ''),
        domain: c.domain,
        path: c.path || '/',
        secure: c.secure !== false,
        httpOnly: Boolean(c.httpOnly),
        expirationDate: exp,
        sameSite:
          c.sameSite === 'Strict' || c.sameSite === 'strict'
            ? 'strict'
            : c.sameSite === 'Lax' || c.sameSite === 'lax'
              ? 'lax'
              : 'no_restriction',
      });
    } catch (_) {
      try {
        await ses.cookies.set({
          url: 'https://www.irctc.co.in/',
          name: c.name,
          value: String(c.value || ''),
          path: '/',
          secure: true,
        });
      } catch (__) {}
    }
  }
}

/**
 * @param {object} opts
 * @param {string} opts.sessionId
 * @param {object} opts.tokens
 * @param {object} opts.details
 * @param {object} [opts.captchaCreds]
 * @param {Array} opts.cookies - from Chrome page.cookies() or Electron
 * @param {(msg:string)=>void} [opts.onStatus]
 * @param {boolean} [opts.showHost]
 */
async function runDirectBookingHost(opts) {
  const sessionId = opts.sessionId || `direct-${Date.now()}`;
  const partition = `persist:ocean-direct-host-${sessionId}`;
  const ses = session.fromPartition(partition);
  try {
    const rawProxy = profileStore.getProxyConfig({ proxyId: opts.proxyId || null });
    const ipMode = opts.ipMode || 'auto';
    const proxyCfg = resolveProxyForIpMode(ipMode, rawProxy);
    if (proxyCfg.error) {
      console.warn('[Ocean DirectHost] proxy:', proxyCfg.error);
    }
    await applyProxyToSession(ses, proxyCfg);
  } catch (e) {
    console.warn('[Ocean DirectHost] proxy attach failed:', e.message || e);
  }
  try {
    attachElectronIrctcNetwork(ses);
  } catch (_) {}

  await applyCookiesToSession(ses, opts.cookies || []);

  const prev = hosts.get(sessionId);
  if (prev && prev.win && !prev.win.isDestroyed()) {
    try {
      prev.win.close();
    } catch (_) {}
  }

  const wa = getWorkArea(screen.getPrimaryDisplay());
  const { width, height } = clampSize(
    LAYOUT.directHost.width,
    LAYOUT.directHost.height,
    wa,
    0.85
  );

  const qrOnly =
    opts.mode === 'phonepe' ||
    opts.mode === 'paytm' ||
    opts.mode === 'razorpay' ||
    opts.mode === 'ipay';
  // QR/UPI host runs hidden — QR shows on ticket panel only when generated
  const showHost = qrOnly ? false : opts.showHost === true;
  const hostTitle =
    opts.mode === 'paytm'
      ? 'OCEAN Paytm (hidden)'
      : opts.mode === 'razorpay'
        ? 'OCEAN Razorpay (hidden)'
        : opts.mode === 'phonepe'
          ? 'OCEAN PhonePe (hidden)'
          : 'OCEAN Direct Booking (host)';

  const win = new BrowserWindow({
    ...centerBounds(wa, width, height, 20),
    minWidth: LAYOUT.directHost.minWidth,
    minHeight: LAYOUT.directHost.minHeight,
    show: showHost,
    title: hostTitle,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-direct-host.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: false,
      session: ses,
      spellcheck: false,
      additionalArguments: [
        `--ocean-run-session=${opts.runSessionId || sessionId.replace(/-(phonepe|paytm|razorpay)$/i, '')}`,
        `--ocean-panel-journey=${opts.panelJourneyId || ''}`,
        `--ocean-panel-pair=${opts.panelPairIndex || 1}`,
      ],
    },
  });

  hosts.set(sessionId, { win });

  const ua = getChromeUserAgent();
  try {
    win.webContents.setUserAgent(ua);
  } catch (_) {}

  win.webContents.on('console-message', (_e, _level, message) => {
    if (opts.onStatus && /\[OCEAN DirectHost\]|\[JS-Direct\]/.test(String(message))) {
      opts.onStatus(String(message).replace(/^.*\[OCEAN DirectHost\]\s*/, ''));
    }
  });

  await win.loadFile(path.join(__dirname, 'direct-host.html'));
  await sleep(400);

  // Bridge status from host page → caller
  try {
    await win.webContents.executeJavaScript(
      `window.oceanDirectHost = window.oceanDirectHost || {};
       window.oceanDirectHost.status = (msg) => {
         try { console.log('[OCEAN DirectHost]', msg); } catch (_) {}
       };
       true;`,
      true
    );
  } catch (_) {}

  const payload = {
    mode: qrOnly ? opts.mode : 'full',
    tokens: opts.tokens || {},
    details: opts.details || {},
    captchaCreds: opts.captchaCreds || {},
    wsUser: opts.wsUser || (opts.details && opts.details.wsUser) || '',
    clientTxnId: opts.clientTxnId || '',
    vpa: opts.vpa || (opts.details && opts.details.vpa) || '',
  };

  console.log(
    '[Ocean DirectHost] starting',
    opts.mode === 'paytm'
      ? 'Paytm (off IRCTC tab)…'
      : opts.mode === 'razorpay'
        ? 'Razorpay UPI (off IRCTC tab)…'
        : opts.mode === 'phonepe'
          ? 'PhonePe (off IRCTC tab)…'
          : 'full booking (off IRCTC page)…'
  );
  let expr;
  if (opts.mode === 'paytm') {
    expr = `window.__oceanRunPaytmOnly(${JSON.stringify(payload)})`;
  } else if (opts.mode === 'razorpay') {
    expr = `window.__oceanRunRazorpayOnly(${JSON.stringify(payload)})`;
  } else if (opts.mode === 'phonepe') {
    expr = `window.__oceanRunPhonePeOnly(${JSON.stringify(payload)})`;
  } else {
    expr = `window.__oceanRunDirectBooking(${JSON.stringify(payload)})`;
  }
  const result = await win.webContents.executeJavaScript(expr, true);

  return { ok: true, result, hostSessionId: sessionId };
}

function closeDirectHost(sessionId) {
  const entry = hosts.get(sessionId);
  if (!entry) return;
  try {
    if (entry.win && !entry.win.isDestroyed()) entry.win.close();
  } catch (_) {}
  hosts.delete(sessionId);
}

module.exports = {
  runDirectBookingHost,
  closeDirectHost,
};
