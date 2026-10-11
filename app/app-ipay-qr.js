/**
 * APP iPay QR after bookingInitPayment (STAR ipay.py phases 15–22).
 * encdata → bank → payUpi → QR → verifyUpi → MobileBankResponse → Akamai → verifyPayment → PNR
 */
const { sleep } = require('./app-http');

const IPAY_BASE = 'https://www.irctcipay.com';
const IPAY_REQUEST =
  'https://www.irctcipay.com/pgui/jsp/irctcRequestAction';
const IPAY_SURCHARGE =
  'https://www.irctcipay.com/pgui/jsp/surchargelocaleMobile';
const IPAY_LOADED =
  'https://www.irctcipay.com/pgui/jsp/updateIsPaymentPageLoadedFlagAction';
const IPAY_PAY_UPI = 'https://www.irctcipay.com/pgui/jsp/payUpi';
const IPAY_VERIFY_UPI =
  'https://www.irctcipay.com/pgui/jsp/verifyUpiResponse';

const MPS_BASE = 'https://www.mps.irctc.co.in';
const MPS_MOBILE_BANK =
  'https://www.mps.irctc.co.in/eticketing/mbi/MobileBankResponse';
const MPS_VERIFY_BASE =
  'https://www.mps.irctc.co.in/eticketing/protected/mapps1/verifyPayment';

const APP_UA = 'IRCTC Rail Connect/4.3.12Android';
const NAV_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const AJAX_UA = 'IRCTC Rail Connect/4.3.12Android';

const PHASE14_RESPONSE_COOKIE_NAMES = [
  'ngetAppId',
  'et_mapp',
  'TS01113614',
  'TS0185576a',
];
const PHASE14_SESSION_COOKIE_NAMES = ['et_mauthapp', 'TS01113614030'];
const VERIFY_PAYMENT_COOKIE_NAMES = [
  'et_mauthapp',
  'TS01113614030',
  'ngetAppId',
  'et_mapp',
  'TS01113614',
  'TS0185576a',
];
const DEFAULT_PAYMENT_TXN_TYPE = 13;

function log(...a) {
  console.log('[Ocean APP iPay]', ...a);
}

function paramListValue(paymentData, key) {
  const list = paymentData?.paramList || [];
  const hit = list.find((p) => p && String(p.key) === key);
  return hit?.value != null ? String(hit.value) : '';
}

function getMinPaymentWaitMs(paymentData) {
  const raw = paramListValue(paymentData, 'MIN_PAYMENT_DURATION');
  let base = parseInt(raw, 10);
  if (!Number.isFinite(base) || base <= 0) base = 10000;
  return base + 500;
}

/** Freeze cookies after bookingInitPayment for Phase 22 verifyPayment. */
function extractPhase14VerifyCookies(jarObj) {
  const src = jarObj && typeof jarObj === 'object' ? jarObj : {};
  const found = {};
  for (const name of [
    ...PHASE14_RESPONSE_COOKIE_NAMES,
    ...PHASE14_SESSION_COOKIE_NAMES,
  ]) {
    if (src[name]) found[name] = String(src[name]);
  }
  return found;
}

function buildVerifyPaymentCookieHeader(paymentData) {
  const stored = paymentData?._verify_payment_cookies || {};
  const parts = [];
  const names = [];
  for (const name of VERIFY_PAYMENT_COOKIE_NAMES) {
    if (stored[name]) {
      parts.push(`${name}=${stored[name]}`);
      names.push(name);
    }
  }
  return { cookieHeader: parts.join('; '), cookieNames: names };
}

function extractCaptureFields(verifyData) {
  if (!verifyData) return null;
  const rf = verifyData.responseFields || {};
  const encdata = rf.encdata;
  if (!encdata) return null;
  return {
    encdata: String(encdata),
    returnUrl: String(rf.RETURN_URL || MPS_MOBILE_BANK).replace(/\\\//g, '/'),
    orderId: rf.ORDER_ID,
    txnId: rf.TXN_ID,
    rrn: rf.RRN,
  };
}

function parseMobileBankResponse(html) {
  const result = {
    encdata: null,
    akamaiScriptUrl: null,
  };
  if (!html) return result;
  const m = String(html).match(/send_user_native\('([^']+)'\)/);
  if (m) {
    for (const part of m[1].split(',')) {
      if (part.startsWith('encdata=')) {
        result.encdata = part.slice('encdata='.length);
      }
    }
  }
  const scriptRe = /<script[^>]+src=["']([^"']+)["']/gi;
  let sm;
  while ((sm = scriptRe.exec(html))) {
    let path = String(sm[1] || '').trim();
    if (!path || path.startsWith('data:')) continue;
    let rel = path;
    if (path.startsWith('http')) {
      if (!path.includes('mps.irctc')) continue;
      rel = path.split('mps.irctc.co.in').pop() || '';
      rel = rel.replace(/^\//, '');
    } else {
      rel = path.replace(/^\//, '');
    }
    if (!rel || /\.(jsp|css|png|gif)$/i.test(rel)) continue;
    result.akamaiScriptUrl = `${MPS_BASE}/${rel}`;
    break;
  }
  return result;
}

function buildVerifyPaymentBody(paymentData, encdata) {
  const amount = paymentData?.amount;
  const transId =
    paymentData?.transationId || paymentData?.transactionId || 0;
  let bankId = paymentData?.bankId;
  try {
    bankId = bankId != null ? parseInt(bankId, 10) : 118;
  } catch (_) {
    bankId = 118;
  }
  const encPure = String(encdata || '').split(',')[0].trim();
  return {
    amount: amount != null ? Number(amount) : 0,
    apiName: null,
    bankId,
    bankName: null,
    captchaDto: null,
    errorMsg: null,
    juspayLoadDTO: null,
    loyaltyNum: 0,
    paramList: [{ key: 'encdata', value: encPure }],
    paymentId: null,
    paymentType: null,
    remainingBalance: 0.0,
    serialVersionUID: null,
    serverId: null,
    timeStamp: null,
    transationId: Number(transId) || 0,
    txnDate: null,
    txnStatus: 1,
    txnType: DEFAULT_PAYMENT_TXN_TYPE,
    upiModeOpted: 0,
    withoutOTP: false,
  };
}

function parseVerifyPaymentResponse(text) {
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (_) {
    return { data: null, pnr: null, userMessage: '' };
  }
  const dto = data?.bookingResponseDTO;
  let pnr = '';
  let userMessage = '';
  if (Array.isArray(dto) && dto.length > 0) {
    pnr = String(dto[0].pnrNumber || '').trim();
    userMessage = String(dto[0].errorMessage || dto[0].errorMsg || '').trim();
  } else if (dto && typeof dto === 'object') {
    pnr = String(dto.pnrNumber || '').trim();
    userMessage = String(dto.errorMessage || dto.errorMsg || '').trim();
  }
  if (!userMessage) {
    userMessage = String(
      data?.errorMessage || data?.errorMsg || data?.error || ''
    ).trim();
  }
  const okPnr = Boolean(pnr && pnr !== '0' && pnr.toLowerCase() !== 'null');
  return {
    data,
    pnr: okPnr ? pnr : null,
    userMessage,
    reservationId: (Array.isArray(dto) ? dto[0] : dto)?.reservationId,
  };
}

async function waitMinPaymentElapsed(flowStart, waitMs, status) {
  while (true) {
    const elapsed = Date.now() - flowStart;
    if (elapsed >= waitMs) return elapsed;
    const left = waitMs - elapsed;
    if (left > 10) {
      const sec = Math.floor(left / 1000);
      const msPart = left % 1000;
      status(`Final Count: ${sec}:${msPart}`);
    }
    await sleep(Math.min(50, left));
  }
}

function createCookieJar() {
  const map = new Map();
  return {
    absorb(res) {
      let list = [];
      try {
        if (typeof res.headers.getSetCookie === 'function') {
          list = res.headers.getSetCookie() || [];
        }
      } catch (_) {}
      if (!list.length) {
        const one = res.headers.get('set-cookie');
        if (one) list = [one];
      }
      for (const line of list) {
        const part = String(line || '').split(';')[0];
        const eq = part.indexOf('=');
        if (eq <= 0) continue;
        map.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
      }
    },
    header() {
      if (!map.size) return '';
      return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
  };
}

async function ipayFetch(
  jar,
  url,
  { method = 'GET', headers = {}, body = null, redirect = 'manual', dispatcher = null } = {}
) {
  const h = { ...headers };
  const cookie = jar.header();
  if (cookie) h.Cookie = cookie;
  const opts = { method, headers: h, body, redirect };
  if (dispatcher) opts.dispatcher = dispatcher;
  const undiciFetch = require('undici').fetch;
  const res = await (opts.dispatcher ? undiciFetch(url, opts) : fetch(url, opts));
  jar.absorb(res);
  const text = await res.text();
  return { res, status: res.status, text, headers: res.headers };
}

function resolveLocation(loc) {
  if (!loc) return '';
  if (loc.startsWith('http')) return loc;
  if (loc.startsWith('/')) return IPAY_BASE + loc;
  return `${IPAY_BASE}/pgui/jsp/${loc}`;
}

function extractCustomToken(html) {
  const m =
    String(html || '').match(
      /name=["']customToken["'][^>]*value=["']([^"']+)["']/i
    ) ||
    String(html || '').match(
      /value=["']([^"']+)["'][^>]*name=["']customToken["']/i
    );
  return m ? m[1] : '';
}

function extractDisplayAmount(html, fallback) {
  const m = String(html || '').match(
    /id=["']amount["'][^>]*value=["']([^"']+)["']/i
  );
  if (m) return m[1];
  return fallback != null ? String(fallback) : '';
}

function parseAjaxJson(text) {
  if (!text || !String(text).trim()) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

async function upiIntentToQrDataUrl(upiIntent) {
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(upiIntent)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`QR gen HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return `data:image/png;base64,${buf.toString('base64')}`;
}

/**
 * @param {{
 *   paymentData: object,
 *   amount: number,
 *   clientTransactionId?: string,
 *   sess?: object,
 *   onStatus?: Function,
 *   onQr?: Function,
 *   onQrHide?: Function
 * }} opts
 */
async function runAppIpayQrFlow({
  paymentData,
  amount,
  clientTransactionId,
  sess,
  onStatus,
  onQr,
  onQrHide,
} = {}) {
  const status = (msg) => {
    try {
      if (typeof onStatus === 'function') onStatus(msg);
    } catch (_) {}
    log(msg);
  };

  const encdata = paramListValue(paymentData, 'encdata');
  const bankUrl = paramListValue(paymentData, 'bankUrl') || IPAY_REQUEST;
  if (!encdata) {
    return { ok: false, reason: 'encdata missing in bookingInitPayment' };
  }

  const jar = createCookieJar();
  const minWait = getMinPaymentWaitMs(paymentData);
  const flowStart = Date.now();
  const dispatcher = sess?.dispatcher || null;
  const doFetch = (j, u, o = {}) => ipayFetch(j, u, { ...o, dispatcher });
  log(
    `iPay start transationId=${paymentData?.transationId} minWait=${minWait}ms proxy=${dispatcher ? 'on' : 'off'}`
  );

  // Phase 15
  status('APP · Redirect bank…');
  const step15 = await doFetch(jar, bankUrl, {
    method: 'POST',
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: 'null',
      'User-Agent': NAV_UA,
      'Upgrade-Insecure-Requests': '1',
    },
    body: `encdata=${encodeURIComponent(encdata)}`,
    redirect: 'manual',
  });
  if (![302, 303, 307, 308].includes(step15.status)) {
    log('Phase 15 fail', step15.status, step15.text?.slice(0, 200));
    return { ok: false, reason: `iPay redirect HTTP ${step15.status}` };
  }
  const surchargeUrl =
    resolveLocation(step15.headers.get('location') || '') || IPAY_SURCHARGE;

  // Phase 16
  status('APP · Bank page…');
  const step16 = await doFetch(jar, surchargeUrl, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'User-Agent': NAV_UA,
    },
  });
  if (step16.status !== 200) {
    return { ok: false, reason: `iPay page HTTP ${step16.status}` };
  }
  const token = extractCustomToken(step16.text);
  if (!token) {
    return { ok: false, reason: 'customToken missing on iPay page' };
  }
  const displayAmount = extractDisplayAmount(step16.text, amount);

  // Phase 17
  const fd17 = new URLSearchParams({ token });
  await doFetch(jar, IPAY_LOADED, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': AJAX_UA,
      'X-Requested-With': 'cris.org.in.prs.ima',
      Origin: IPAY_BASE,
      Referer: `${IPAY_BASE}/pgui/jsp/surchargeMobilePaymentPage.jsp`,
    },
    body: fd17.toString(),
  });

  // Phase 18 — payUpi → UPI intent
  status('APP · Creating UPI QR…');
  const fd18 = new URLSearchParams({
    token,
    serviceProvider: 'DEFAULT',
    upiCustName: 'dummy',
    paymentType: 'UP',
    mopType: 'UP',
    amount: String(displayAmount || amount || ''),
    currencyCode: '356',
    isIntent: 'Y',
    browserName: 'Chrome',
    browserVersion: '120',
  });
  const step18 = await doFetch(jar, IPAY_PAY_UPI, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': AJAX_UA,
      'X-Requested-With': 'cris.org.in.prs.ima',
      Origin: IPAY_BASE,
      Referer: `${IPAY_BASE}/pgui/jsp/surchargeMobilePaymentPage.jsp`,
    },
    body: fd18.toString(),
  });
  const payData = parseAjaxJson(step18.text);
  const imageData = String(payData?.imageData || '').replace(/\\\//g, '/');
  if (!imageData) {
    log('payUpi body', step18.text?.slice(0, 400));
    return { ok: false, reason: 'payUpi imageData missing' };
  }

  let qrDataUrl = '';
  try {
    qrDataUrl = await upiIntentToQrDataUrl(imageData);
    if (typeof onQr === 'function') onQr(qrDataUrl, { amount });
  } catch (e) {
    log('QR image fail', e.message || e);
  }
  status('Scan and pay');

  const pgRefNum = payData.pgRefNum;
  const pgRefHash = payData.pgRefHash;

  // Phase 19 — poll verifyUpiResponse (payment capture)
  const deadline = Date.now() + 5 * 60 * 1000;
  let captured = false;
  let verifyData = null;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    const fd19 = new URLSearchParams({
      token,
      pgRefNum: String(pgRefNum || ''),
      pgRefHash: String(pgRefHash || ''),
    });
    const step19 = await doFetch(jar, IPAY_VERIFY_UPI, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': AJAX_UA,
        'X-Requested-With': 'cris.org.in.prs.ima',
        Origin: IPAY_BASE,
        Referer: `${IPAY_BASE}/pgui/jsp/surchargeMobilePaymentPage.jsp`,
      },
      body: fd19.toString(),
    });
    verifyData = parseAjaxJson(step19.text);
    const st =
      String(
        verifyData?.transactionStatus ||
          verifyData?.status ||
          verifyData?.txnStatus ||
          ''
      ).toUpperCase();
    if (attempt === 1 || attempt % 5 === 0) {
      log(`verifyUpi #${attempt} status=${st || step19.status}`);
    }
    if (
      st.includes('CAPTURE') ||
      st.includes('SUCCESS') ||
      st === 'SENT_TO_BANK' ||
      verifyData?.responseCode === '000' ||
      verifyData?.captured === true
    ) {
      // STAR considers specific captured flag — be liberal
      if (
        /CAPTURED|SUCCESS|APPROVED/i.test(st) ||
        verifyData?.captured === true ||
        String(verifyData?.responseCode || '') === '000'
      ) {
        captured = true;
        break;
      }
    }
    if (/FAIL|DECLIN|CANCEL|EXPIRED/i.test(st)) {
      try {
        if (typeof onQrHide === 'function') onQrHide();
      } catch (_) {}
      return { ok: false, reason: `UPI ${st || 'failed'}`, verifyData };
    }
    status('Waiting for UPI payment…');
    await sleep(2000);
  }

  try {
    if (typeof onQrHide === 'function') onQrHide();
  } catch (_) {}

  if (!captured) {
    return { ok: false, reason: 'UPI payment timeout', verifyData };
  }

  status('Payment Successful');

  const capture = extractCaptureFields(verifyData);
  if (!capture?.encdata) {
    log('verifyUpi captured but responseFields.encdata missing');
    return {
      ok: false,
      reason: 'Capture encdata missing',
      captured: true,
      verifyData,
    };
  }

  await waitMinPaymentElapsed(flowStart, minWait, status);

  // Phase 20 — MobileBankResponse (mps)
  status('APP · MobileBankResponse…');
  const mpsJar = createCookieJar();
  const step20 = await doFetch(mpsJar, capture.returnUrl || MPS_MOBILE_BANK, {
    method: 'POST',
    headers: {
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': AJAX_UA,
      'X-Requested-With': 'cris.org.in.prs.ima',
      Origin: IPAY_BASE,
      Referer: `${IPAY_BASE}/`,
    },
    body: `encdata=${capture.encdata}`,
    redirect: 'follow',
  });
  if (step20.status !== 200) {
    return {
      ok: false,
      reason: `MobileBankResponse HTTP ${step20.status}`,
      captured: true,
      verifyData,
    };
  }
  const parsed20 = parseMobileBankResponse(step20.text);
  let verifyEnc = parsed20.encdata || capture.encdata;
  log(
    `MobileBank OK enc=${verifyEnc ? verifyEnc.length : 0} akamai=${parsed20.akamaiScriptUrl || 'none'}`
  );

  // Phase 21 — Akamai script GET (updates mps cookies; STAR requires before verify)
  if (parsed20.akamaiScriptUrl) {
    status('APP · Akamai…');
    const step21 = await doFetch(mpsJar, parsed20.akamaiScriptUrl, {
      method: 'GET',
      headers: {
        Accept: '*/*',
        'User-Agent': AJAX_UA,
        'X-Requested-With': 'cris.org.in.prs.ima',
        Referer: step20.res?.url || MPS_MOBILE_BANK,
      },
      redirect: 'follow',
    });
    log(`Akamai GET ${step21.status}`);
    if (step21.status !== 200) {
      return {
        ok: false,
        reason: `Akamai script HTTP ${step21.status}`,
        captured: true,
      };
    }
  } else {
    log('WARN phase20 HTML — Akamai script src missing; continue verifyPayment');
  }

  const cid = String(
    clientTransactionId ||
      paymentData?._clientTransactionId ||
      ''
  ).trim();
  if (!cid) {
    return { ok: false, reason: 'clientTransactionId missing for verifyPayment', captured: true };
  }
  if (!sess?.tokens?.access_token) {
    return { ok: false, reason: 'mapps access_token missing for verifyPayment', captured: true };
  }

  // Phase 22 — verifyPayment → PNR (same panel as Direct bookingData poll)
  status('Final Hit For Pnr');
  const { cookieHeader, cookieNames } = buildVerifyPaymentCookieHeader(paymentData);
  const spa =
    paymentData?._session_spa_csrf ||
    sess.spaCsrf ||
    '';
  const greq = paymentData?._session_greq || sess.uid || '';
  const mup = paymentData?._session_mup || sess.mup || '';
  const body22 = buildVerifyPaymentBody(paymentData, verifyEnc);
  const url22 = `${MPS_VERIFY_BASE}/${cid}`;
  const headers22 = {
    Accept: 'application/json',
    Authorization: `bearer ${sess.tokens.access_token}`,
    greq,
    'User-Agent': APP_UA,
    mup,
    bmirak: 'androidbm',
    'Content-Language': 'en',
    'Accept-Language': 'en-US,en;q=0.0',
    bmiyek: sess.tokens.refresh_token || '',
    'spa-csrf-token': spa,
    'Content-Type': 'application/json ; charset=UTF-8',
    'Accept-Encoding': 'gzip',
  };
  if (cookieHeader) headers22.Cookie = cookieHeader;

  log(
    `verifyPayment/${cid} cookies=${cookieNames.length}/6 spa=${spa ? spa.slice(0, 12) + '…' : 'EMPTY'}`
  );
  const undiciFetch = require('undici').fetch;
  const fetchFn = dispatcher ? undiciFetch : fetch;
  const res22 = await fetchFn(url22, {
    method: 'POST',
    headers: headers22,
    body: JSON.stringify(body22),
    ...(dispatcher ? { dispatcher } : {}),
  });
  const text22 = await res22.text();
  log(`verifyPayment ← ${res22.status} len=${text22.length}`);

  if (res22.status !== 200) {
    return {
      ok: false,
      reason: `verifyPayment HTTP ${res22.status}`,
      captured: true,
      verifyText: text22.slice(0, 400),
    };
  }

  // Refresh csrf if present
  try {
    const nextCsrf =
      res22.headers.get('csrf-token') ||
      res22.headers.get('spa-csrf-token') ||
      '';
    if (nextCsrf && sess) sess.spaCsrf = nextCsrf;
  } catch (_) {}

  const parsed22 = parseVerifyPaymentResponse(text22);
  if (!parsed22.pnr) {
    const msg = parsed22.userMessage || 'PNR missing';
    // Exact IRCTC message on panel — stop (no fake success)
    status(msg);
    return {
      ok: false,
      reason: msg,
      captured: true,
      verifyPayment: parsed22.data,
      userMessage: msg,
    };
  }

  status(`BOOKED PNR=${parsed22.pnr}`);
  return {
    ok: true,
    captured: true,
    pnr: String(parsed22.pnr),
    reservationId: parsed22.reservationId,
    imageData,
    qrDataUrl,
    verifyData,
    verifyPayment: parsed22.data,
    paymentData,
    minWait,
  };
}

module.exports = {
  runAppIpayQrFlow,
  paramListValue,
  getMinPaymentWaitMs,
  extractPhase14VerifyCookies,
  buildVerifyPaymentCookieHeader,
  parseVerifyPaymentResponse,
  waitMinPaymentElapsed,
  PHASE14_RESPONSE_COOKIE_NAMES,
  PHASE14_SESSION_COOKIE_NAMES,
};
