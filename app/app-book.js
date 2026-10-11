/**
 * APP booking chain after login (HTTP only, no browser):
 *   altAvlEnq/TC → avlFarenquiry → boardingStationEnq
 *   → allLapAvlFareEnq → addonServices → bookingInitPayment
 *
 * Headers: androidbm + spa-csrf + bearer.
 * Sensor: session cache reuse on success; newconsume only on retry/fail.
 */
const crypto = require('crypto');
const appPair = require('./app-pair-session');
const { extractStationCode } = require('./profile-bridge');
const profileStore = require('./profile-store');
const { appRequestRetry, sleep } = require('./app-http');
const { runAppIpayQrFlow, extractPhase14VerifyCookies } = require('./app-ipay-qr');
const { runAppRazorpayUpiFlow } = require('./app-razorpay-upi');
const { runAppEwalletFlow } = require('./app-ewallet');

const APP_PAYMENT_TYPE = 1; // APP2 lap paymentType

const AC_BOOK_CLASSES = ['1A', '2A', '3A', '3E', 'CC', 'EC'];
const QUOTA_WITH_TIME_GATE = new Set(['GN', 'TQ', 'PT']);

function log(...a) {
  console.log('[Ocean APP]', ...a);
}

/** Ticket book times → HH:MM:SS (content_script_beta / STAR parity). */
function resolveRequiredBookingTime(quota, cls, times = {}) {
  const q = String(quota || 'GN').trim().toUpperCase();
  const c = String(cls || '').trim().toUpperCase();
  let required = '00:00:00';
  if (AC_BOOK_CLASSES.includes(c)) {
    required = times.acbooktime || '09:59:59';
  } else {
    required = times.slbooktime || '10:59:59';
  }
  if (q === 'GN') required = times.gnbooktime || '07:59:59';
  return String(required || '00:00:00').trim();
}

function parseHms(timeStr) {
  const m = String(timeStr || '')
    .trim()
    .match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const sec = parseInt(m[3], 10);
  if (!Number.isFinite(h) || h > 23 || min > 59 || sec > 59) return null;
  return { h, min, s: sec };
}

/** Wait until quota/class open time (local PC clock) before avlFarenquiry. */
async function waitForQuotaOpening(details, status) {
  const q = String(details.quota || '').trim().toUpperCase();
  if (!QUOTA_WITH_TIME_GATE.has(q)) {
    log(`time gate skip — quota ${q || '?'} (no open wait)`);
    return;
  }

  const required = resolveRequiredBookingTime(q, details.cls, {
    slbooktime: details.slbooktime,
    acbooktime: details.acbooktime,
    gnbooktime: details.gnbooktime,
  });
  const parts = parseHms(required);
  if (!parts) {
    log(`time gate skip — bad book time "${required}"`);
    return;
  }

  const now = new Date();
  const target = new Date(now);
  target.setHours(parts.h, parts.min, parts.s, 0);

  const label = `${required} (${q}/${details.cls})`;
  if (now >= target) {
    log(`time gate — open time passed ${label}`);
    return;
  }

  status(`wait for open booking · ${label}`);
  log(`TIME GATE — wait until ${label}`);

  while (Date.now() < target.getTime()) {
    const leftMs = target.getTime() - Date.now();
    const leftSec = Math.ceil(leftMs / 1000);
    const h = Math.floor(leftSec / 3600);
    const m = Math.floor((leftSec % 3600) / 60);
    const s = leftSec % 60;
    const clock =
      h > 0
        ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    status(`APP · Wait ${q} · opens ${clock} (${required})`);
    const tick = leftMs <= 10000 ? 50 : leftMs <= 60000 ? 200 : 1000;
    await sleep(tick);
  }

  status(`APP · OPEN @ ${required}`);
  log(`TIME GATE — OPEN @ ${required}`);
}

/** STAR APP: PhonePe 111 / Razorpay 141 / eWallet 1000 / else iPay 118 */
function resolveAppPayment(payment) {
  const key = String(
    payment?.paymentMethod || payment?.method || payment?.name || ''
  ).toUpperCase();
  if (key.includes('PHONEPE') && key.includes('QR')) {
    return {
      kind: 'phonepe_qr',
      bankId: 111,
      txnType: 13,
      paymentType: 1,
      paramList: [
        { key: 'gatewayId', value: '39' },
        { key: 'JUSPAY_FLOW', value: '1' },
      ],
    };
  }
  if (
    key.includes('IRCWA') ||
    key.includes('EWALLET') ||
    key.includes('IRCTC-EWALLET')
  ) {
    return {
      kind: 'ewallet',
      bankId: 1000,
      txnType: 7,
      paymentType: 3,
      paramList: [{ key: 'TXN_PASSWORD', value: '' }],
    };
  }
  if (key.includes('RAZORPAY')) {
    return {
      kind: 'razorpay_upi',
      bankId: 141,
      txnType: 13,
      paymentType: 1,
      paramList: [{ key: 'gatewayId', value: '23' }],
    };
  }
  // Default APP QR / PaytmUPIQR / iPay → bank 118 + PAYMENT_MODE=UPI (STAR ipay_qr)
  return {
    kind: 'ipay_qr',
    bankId: 118,
    txnType: 13,
    paymentType: 1,
    paramList: [
      { key: 'PAYMENT_MODE', serialVersionUID: null, value: 'UPI' },
    ],
  };
}

function resolveBankId(payment) {
  return resolveAppPayment(payment).bankId;
}

function dateCompact(raw) {
  const s = String(raw || '').trim();
  if (/^\d{8}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    return `${m[3]}${m[2].padStart(2, '0')}${m[1].padStart(2, '0')}`;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}${iso[2]}${iso[3]}`;
  return s.replace(/\D/g, '').slice(0, 8);
}

function trainNo(raw) {
  return String(raw || '').replace(/\D/g, '').padStart(5, '0').slice(-5);
}

function genClientTxnId(len = 8) {
  const c = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const b = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += c[b[i] % c.length];
  return s;
}

function mapPassenger(p, i) {
  return {
    passengerName: String(p.name || '').trim().slice(0, 16),
    passengerAge: Number(p.age),
    passengerGender: String(p.gender || '').toUpperCase() === 'F' ? 'F' : 'M',
    passengerBerthChoice: p.berth || '',
    passengerFoodChoice: null,
    passengerFoodChoiceBackUp: 'D',
    passengerBedrollChoice: null,
    passengerNationality: 'IN',
    passengerCardTypeMaster: null,
    passengerCardNumberMaster: null,
    psgnConcType: null,
    psgnConcCardId: null,
    psgnConcDOB: null,
    psgnConcCardExpiryDate: null,
    psgnConcDOBP: null,
    softMemberId: null,
    softMemberFlag: null,
    psgnConcCardExpiryDateP: null,
    passengerVerified: false,
    masterPsgnId: null,
    mpMemberFlag: null,
    passengerForceNumber: null,
    passConcessionType: '0',
    passUPN: null,
    passBookingCode: null,
    passengerSerialNumber: i + 1,
    childBerthFlag: true,
    passengerCardType: 'NULL_IDCARD',
    passengerIcardFlag: false,
    passengerCardNumber: null,
  };
}

function buildDetails(bundle) {
  const j = bundle.journey || {};
  const cred = bundle.credential || {};
  const payment = bundle.payment || {};
  const pay = resolveAppPayment(payment);
  const passengers = (Array.isArray(j.passengers) ? j.passengers : [])
    .filter((p) => p && p.name && p.age && p.gender)
    .map((p) => ({
      name: String(p.name).trim(),
      age: Number(p.age),
      gender: String(p.gender).trim().toUpperCase(),
      berth: p.berth || '',
      food: p.food || '',
    }));
  if (!passengers.length) throw new Error('Kam se kam 1 passenger chahiye');

  const from = extractStationCode(j.from);
  const to = extractStationCode(j.to);
  const boarding = j.boarding
    ? extractStationCode(j.boarding)
    : from;
  const date = dateCompact(j.date);
  const cls = String(j.class || '').trim().toUpperCase();
  const quota = String(j.quota || 'GN').trim().toUpperCase();
  const tn = trainNo(j.trainNo);
  const mobile = String(j.contact?.mobile || '').trim();
  const wsUser = String(cred.username || '').trim();

  if (!from || !to) throw new Error('From / To missing');
  if (!/^[A-Z0-9]{2,5}$/.test(from) || !/^[A-Z0-9]{2,5}$/.test(to)) {
    throw new Error(`Invalid station code from=${from || '?'} to=${to || '?'}`);
  }
  if (boarding && !/^[A-Z0-9]{2,5}$/.test(boarding)) {
    throw new Error(`Invalid boarding code: ${boarding}`);
  }
  if (!tn || tn === '00000') throw new Error('Train number missing');
  if (!cls || cls === 'ALL') throw new Error('Class select karo');
  if (!date || date.length !== 8) throw new Error('Journey date missing');
  if (!wsUser) throw new Error('IRCTC username missing');
  if (!mobile) throw new Error('Mobile missing');

  return {
    from,
    to,
    boarding,
    date,
    cls,
    quota,
    trainNo: tn,
    mobile,
    wsUser,
    passengers,
    bookOnlyIfCnf: j.options?.confirmBerths !== false,
    paymentType: pay.paymentType != null ? pay.paymentType : APP_PAYMENT_TYPE,
    bankId: pay.bankId,
    txnType: pay.txnType,
    paramList: pay.paramList,
    payKind: pay.kind,
    vpa: String(payment.vpa || '').trim(),
    maxPtFare: (() => {
      const raw = String(j.options?.maxPtFare ?? j.maxPtFare ?? '')
        .replace(/,/g, '')
        .trim();
      const n = parseFloat(raw);
      return Number.isFinite(n) && n > 0 ? n : 0;
    })(),
    slbooktime: j.slbooktime || '10:59:59',
    acbooktime: j.acbooktime || '09:59:59',
    gnbooktime: j.gnbooktime || '07:59:59',
  };
}

async function takeSensor(sess, { forceFresh = false } = {}) {
  const got = forceFresh
    ? await appPair.refreshSessionSensor(sess)
    : await appPair.ensureCachedSensor(sess);
  if (!got.ok) throw new Error(got.reason || 'No sensor');
  return got.sensor;
}

async function solveCaptchaIfNeeded(b64) {
  if (!b64) return null;
  const creds = profileStore.getTrueCaptchaCredentials();
  if (!creds?.enabled || !creds.userId || !creds.apiKey) {
    throw new Error('Captcha aayi — TrueCaptcha save karo (Tokens/Settings)');
  }
  const response = await fetch('https://api.apitruecaptcha.org/one/gettext', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userid: creds.userId,
      apikey: creds.apiKey,
      data: b64.includes(',') ? b64.split(',')[1] : b64,
    }),
  });
  const json = await response.json();
  if (!json?.result) throw new Error('TrueCaptcha empty');
  return String(json.result).trim();
}

function parseMinPsgnWaitMs(raw) {
  if (!raw) return 0;
  const first = String(raw).split('#')[0].trim();
  const n = parseInt(first, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Panel clock: "Passenger Submit IN - 45000" (ms countdown) */
async function countdownPassengerSubmit(waitMs, status) {
  let ms = parseMinPsgnWaitMs(waitMs);
  if (ms <= 0) ms = 35000;
  log(`minPsgnInputTime wait ${ms}ms`);
  const endAt = Date.now() + ms;
  let lastShown = -1;
  while (true) {
    const left = Math.max(0, endAt - Date.now());
    // panel thrash kam — ~50ms pe update
    if (left !== lastShown && (lastShown < 0 || lastShown - left >= 50 || left === 0)) {
      status(`Passenger Submit IN - ${left}`);
      lastShown = left;
    }
    if (left <= 0) break;
    await sleep(Math.min(50, left));
  }
  status('Passenger Submit IN - 0');
}

/**
 * boardingStationList se boarding code ONLY (never "NDLS - NEW DELHI").
 * Prefer journey boarding if listed, else first station.
 */
function resolveBoardingFromEnq(boardData, preferred, fallbackFrom) {
  const list = Array.isArray(boardData?.boardingStationList)
    ? boardData.boardingStationList
    : [];
  const pref = extractStationCode(preferred);
  const from = extractStationCode(fallbackFrom);

  const codeOf = (st) =>
    extractStationCode(
      st?.stationCode || st?.stnCode || st?.stnNameCode || st?.code || ''
    );

  if (pref && list.length) {
    const hit = list.find((st) => {
      const c = codeOf(st);
      const raw = String(st?.stnNameCode || '').toUpperCase();
      return c === pref || raw.startsWith(`${pref} `) || raw.includes(` ${pref}`) || raw === pref;
    });
    if (hit) return codeOf(hit) || pref;
  }
  if (list.length) {
    const first = codeOf(list[0]);
    if (first) return first;
  }
  return pref || from;
}

/** Force every station field on details to code-only. */
function normalizeDetailsStations(details) {
  if (!details) return details;
  details.from = extractStationCode(details.from);
  details.to = extractStationCode(details.to);
  details.boarding = extractStationCode(details.boarding || details.from);
  return details;
}

function isFatalStationError(dataOrText) {
  const msg = String(
    (dataOrText && dataOrText.errorMessage) || dataOrText || ''
  );
  return /station code is not valid|88021|invalid\s+(from|to|boarding)?\s*station/i.test(
    msg
  );
}

/** Parse IRCTC availablityStatus string. */
function parseAvailKind(statusStr) {
  const raw = String(statusStr || '').trim();
  const s = raw.toUpperCase().replace(/\s+/g, ' ');
  // `#` = not open yet. Empty ≠ closed (addon payload has no avlDayList).
  if (!s) return { kind: 'unknown', raw };
  if (s.includes('#')) return { kind: 'closed', raw };
  if (/^AVAILABLE/i.test(s)) return { kind: 'available', raw };
  if (/\bRAC\b/.test(s)) return { kind: 'rac', raw };
  if (/\bWL\b/.test(s) || /WAITLIST|GNWL|TQWL|PQWL|RLWL|CKWL/.test(s)) {
    return { kind: 'wl', raw };
  }
  if (/NOT AVAILABLE|REGRET|TRAIN DEPARTED|CANCELLED|NOT AVL/.test(s)) {
    return { kind: 'unavailable', raw };
  }
  return { kind: 'unknown', raw };
}

/** Panel + stop decision from avail status / errorMessage. */
function seatStopDecision({ availStatus, errorMessage, bookOnlyIfCnf } = {}) {
  const err = String(errorMessage || '').trim();
  if (err) {
    if (/no seats?\s*available/i.test(err)) {
      return { stop: true, status: 'No seats available', reason: err };
    }
    if (/not available/i.test(err)) {
      return { stop: true, status: 'NOT AVAILABLE', reason: err };
    }
    if (/regret/i.test(err)) {
      return { stop: true, status: 'REGRET', reason: err };
    }
  }

  const p = parseAvailKind(availStatus);
  if (p.kind === 'unavailable') {
    let statusMsg = 'NOT AVAILABLE';
    if (/REGRET/i.test(p.raw)) statusMsg = 'REGRET';
    else if (/TRAIN DEPARTED/i.test(p.raw)) statusMsg = 'TRAIN DEPARTED';
    else if (/CANCELLED/i.test(p.raw)) statusMsg = 'CANCELLED';
    else if (/NOT AVAILABLE|NOT AVL/i.test(p.raw)) statusMsg = 'NOT AVAILABLE';
    else statusMsg = String(p.raw || 'No seat available').slice(0, 40);
    return {
      stop: true,
      status: statusMsg,
      reason: `${statusMsg} (got: ${p.raw || 'N/A'})`,
    };
  }
  if (p.kind === 'closed') {
    return {
      stop: true,
      status: 'Seat not open',
      reason: `Seat not open (got: ${p.raw || 'N/A'})`,
    };
  }
  const cnfOnly = bookOnlyIfCnf !== false;
  if (cnfOnly && p.kind === 'rac') {
    return {
      stop: true,
      status: 'RAC · No seat available',
      reason: `RAC · No seat available (Confirm Berth ON) · ${p.raw}`,
    };
  }
  if (cnfOnly && p.kind === 'wl') {
    return {
      stop: true,
      status: 'WL · No seat available',
      reason: `WL · No seat available (Confirm Berth ON) · ${p.raw}`,
    };
  }
  return { stop: false, kind: p.kind, raw: p.raw };
}

function isFatalNoSeatPayload(data) {
  if (!data || typeof data !== 'object') return false;
  const err = String(data.errorMessage || data.errorMsg || '');
  if (/no seats?\s*available|not available|regret/i.test(err)) return true;
  const st =
    data?.avlDayList?.[0]?.availablityStatus ||
    data?.avlFareResponseDTO?.[0]?.avlDayList?.[0]?.availablityStatus ||
    '';
  return parseAvailKind(st).kind === 'unavailable';
}

function seatsFromStatus(st) {
  const s = String(st || '');
  const m = s.match(/AVAILABLE[- ]?(\d+)/i) || s.match(/RAC[- ]?(\d+)/i);
  if (m) return parseInt(m[1], 10);
  if (/WL/i.test(s)) {
    const w = s.match(/WL[- ]?(\d+)/i);
    return w ? -parseInt(w[1], 10) : -1;
  }
  return 0;
}

function pickAmount(...vals) {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

/**
 * Full APP book after login.
 */
async function performAppBook({
  sessionId,
  bundle,
  onStatus,
  waitForPtFareProceed,
  waitIfSiblingInitPayment,
  markInitPaymentSuccess,
  onQr,
  onQrHide,
} = {}) {
  const status = (msg) => {
    try {
      if (typeof onStatus === 'function') onStatus(msg);
    } catch (_) {}
    log(msg);
  };

  const sess = appPair.getAppSession(sessionId);
  if (!sess?.tokens?.access_token) {
    return { ok: false, reason: 'No APP tokens — login first' };
  }

  let details;
  try {
    details = normalizeDetailsStations(buildDetails(bundle));
  } catch (e) {
    return { ok: false, reason: e.message || String(e) };
  }
  log(
    `stations code-only from=${details.from} to=${details.to} board=${details.boarding}` +
      ` (raw journey from=${bundle?.journey?.from || '?'} to=${bundle?.journey?.to || '?'})`
  );

  const take = (opts) => takeSensor(sess, opts || {});

  const makeRetryStatus = (prefix) => (info) => {
    const n = info.attempt || 1;
    if (info.kind === 'ip510') {
      status(
        `${prefix} · 510 Client IP — ${(info.delayMs / 1000) | 0}s (${n}/3)`
      );
    } else if (info.kind === 'unable') {
      status(
        `${prefix} · Unable — ${(info.delayMs / 1000) | 0}s (${n}/3)`
      );
    } else if (info.kind === 'high_load') {
      const msg = String(info.message || 'High Load').slice(0, 36);
      status(`${prefix} · High Load (${n}) ${msg}`);
    } else {
      status(`${prefix} (${n})…`);
    }
  };

  // --- 1) altAvlEnq/TC ---
  status('APP · Find trains…');
  const tcBody = {
    concessionBooking: false,
    srcStn: extractStationCode(details.from),
    destStn: extractStationCode(details.to),
    jrnyClass: details.cls,
    jrnyDate: details.date,
    quotaCode: details.quota,
    ticketType: 'E',
    currentBooking: 'false',
    flexiFlag: false,
    ftBooking: false,
    handicapFlag: false,
    loyaltyRedemptionBooking: false,
  };
  let tc;
  try {
    tc = await appRequestRetry(
      sess,
      '/eticketing/protected/mapps1/altAvlEnq/TC',
      { method: 'POST', body: tcBody, label: 'altAvlEnq/TC' },
      {
        maxRetries: 40,
        delayMs: 800,
        highLoadDelayMinMs: 1000,
        highLoadDelayMaxMs: 4000,
        freshSensorEach: true,
        takeSensor: take,
        onRetry: makeRetryStatus('APP · Find trains'),
        fatalIf: (r) =>
          Boolean(r?.data?.errorMessage) &&
          /invalid\s+(from|to|boarding)?\s*station|invalid station/i.test(
            String(r.data.errorMessage)
          ),
        extraOk: (r) => Array.isArray(r?.data?.trainBtwnStnsList),
      }
    );
  } catch (e) {
    return { ok: false, reason: e.message || 'altAvlEnq fail' };
  }
  if (!tc?.ok) {
    return {
      ok: false,
      reason: tc?.reason || `altAvlEnq HTTP ${tc?.status || 0}`,
    };
  }
  status('APP · Train list OK');

  // --- 2) avlFarenquiry — quota/class time gate (ticket gn/ac/sl book times) ---
  await waitForQuotaOpening(details, status);

  status('APP · Availability…');
  const avlFrom = extractStationCode(details.from);
  const avlTo = extractStationCode(details.to);
  const avlPath = `/eticketing/protected/mapps1/avlFarenquiry/${details.trainNo}/${details.date}/${avlFrom}/${avlTo}/${details.cls}/${details.quota}/N`;
  const avlBody = {
    paymentFlag: 'N',
    concessionBooking: false,
    ftBooking: false,
    loyaltyRedemptionBooking: false,
    ticketType: 'E',
    classCode: details.cls,
    fromStnCode: avlFrom,
    toStnCode: avlTo,
    quotaCode: details.quota,
    trainNumber: String(details.trainNo),
    journeyDate: details.date,
    isLogedinReq: true,
    moreThanOneDay: true,
  };
  let avl;
  try {
    avl = await appRequestRetry(
      sess,
      avlPath,
      { method: 'POST', body: avlBody, label: 'avlFarenquiry' },
      {
        maxRetries: 100,
        delayMs: 800,
        highLoadDelayMinMs: 1000,
        highLoadDelayMaxMs: 4000,
        freshSensorEach: true,
        takeSensor: take,
        onRetry: makeRetryStatus('APP · Availability'),
        fatalIf: (r) => isFatalNoSeatPayload(r?.data),
        extraOk: (r) => {
          if (isFatalNoSeatPayload(r?.data)) return false;
          const st = r?.data?.avlDayList?.[0]?.availablityStatus;
          // `#` = seat not open yet → keep waiting
          return Boolean(st) && !String(st).includes('#');
        },
      }
    );
  } catch (e) {
    return { ok: false, reason: e.message || 'avlFarenquiry fail' };
  }
  if (!avl?.ok) {
    const earlyStop = seatStopDecision({
      availStatus: avl?.data?.avlDayList?.[0]?.availablityStatus,
      errorMessage: avl?.data?.errorMessage || avl?.data?.errorMsg,
      bookOnlyIfCnf: details.bookOnlyIfCnf,
    });
    if (earlyStop.stop) {
      status(earlyStop.status);
      return { ok: false, reason: earlyStop.status };
    }
    const failMsg = avl?.reason || `avlFarenquiry HTTP ${avl?.status || 0}`;
    status(String(failMsg).slice(0, 48));
    return {
      ok: false,
      reason: failMsg,
    };
  }
  const avlSt = avl.data?.avlDayList?.[0]?.availablityStatus || '';
  const avlAmt = pickAmount(
    avl.data?.totalCollectibleAmount,
    avl.data?.totalFare,
    avl.data?.avlDayList?.[0]?.totalCollectibleAmount
  );
  const avlStop = seatStopDecision({
    availStatus: avlSt,
    bookOnlyIfCnf: details.bookOnlyIfCnf,
  });
  if (avlStop.stop) {
    status(avlStop.status);
    return { ok: false, reason: avlStop.status };
  }
  status(`Available-${seatsFromStatus(avlSt)}|${avlAmt || 0}`);

  // --- 3) boardingStationEnq ---
  status('APP · Boarding…');
  const boardFrom = extractStationCode(details.from);
  const boardTo = extractStationCode(details.to);
  const boardBody = {
    alternateAvlInputDTO: [
      {
        trainNo: String(details.trainNo),
        destStn: boardTo,
        srcStn: boardFrom,
        jrnyDate: details.date,
        quotaCode: details.quota,
        jrnyClass: details.cls,
      },
    ],
    concessionPassengers: false,
    destStn: boardTo,
    jrnyClass: details.cls,
    jrnyDate: details.date,
    quotaCode: details.quota,
    srcStn: boardFrom,
    trainNo: String(details.trainNo),
    autoUpgradationSelected: false,
    captureAddress: 0,
    clusterFlag: 'N',
    cod: 'false',
    gnToCkOpted: false,
    journalistBooking: false,
    onwardFlag: 'N',
    passBooking: false,
    paymentType: APP_PAYMENT_TYPE,
    reservationMode: 'WS_TA_B2C',
    twoPhaseAuthRequired: false,
  };
  let board;
  try {
    board = await appRequestRetry(
      sess,
      '/eticketing/protected/mapps1/boardingStationEnq',
      { method: 'POST', body: boardBody, label: 'boardingStationEnq' },
      {
        maxRetries: 80,
        delayMs: 800,
        highLoadDelayMinMs: 1000,
        highLoadDelayMaxMs: 4000,
        freshSensorEach: true,
        takeSensor: take,
        onRetry: makeRetryStatus('APP · Boarding'),
        extraOk: (r) =>
          Array.isArray(r?.data?.boardingStationList) &&
          r.data.boardingStationList.length > 0,
      }
    );
  } catch (e) {
    return { ok: false, reason: e.message || 'boarding fail' };
  }
  if (!board?.ok) {
    return {
      ok: false,
      reason: board?.reason || `boarding HTTP ${board?.status || 0}`,
    };
  }
  const boardData = board.data || {};
  const stationList = Array.isArray(boardData.boardingStationList)
    ? boardData.boardingStationList
    : [];
  if (!stationList.length) {
    return { ok: false, reason: 'boardingStationList missing' };
  }
  const boardingCode = extractStationCode(
    resolveBoardingFromEnq(boardData, details.boarding, details.from)
  );
  if (!boardingCode || !/^[A-Z0-9]{2,5}$/.test(boardingCode)) {
    return { ok: false, reason: `Invalid boarding code after enq: ${boardingCode || '?'}` };
  }
  details.boarding = boardingCode;
  details.from = extractStationCode(details.from);
  details.to = extractStationCode(details.to);
  log(
    `boarding OK stations=${stationList.length} pick=${boardingCode} from=${details.from} to=${details.to} minPsgn=${boardData.minPsgnInputTime}`
  );
  status(`APP · Boarding OK (${stationList.length}) · ${boardingCode}`);

  // IRCTC minPsgnInputTime — countdown before allLap (55001 / Booking not allowed without this)
  await countdownPassengerSubmit(boardData.minPsgnInputTime, status);

  // --- 4) allLapAvlFareEnq (APP2 body) — station fields = code only ---
  status('APP · Passenger Submit…');
  const cid = genClientTxnId(8);
  const paxList = details.passengers.slice(0, 6).map((p, i) => mapPassenger(p, i));
  const cnfOnly = details.bookOnlyIfCnf !== false;
  const fromCode = extractStationCode(details.from);
  const toCode = extractStationCode(details.to);
  const boardCode = extractStationCode(details.boarding || fromCode);
  log(`allLap stations from=${fromCode} to=${toCode} board=${boardCode}`);
  const lapLoad = {
    masterId: null,
    wsUserLogin: details.wsUser,
    wsUserPassword: null,
    wsUserTransactionPassword: null,
    agentDeviceId: null,
    alternateAvlInputDTO: null,
    atasOpted: null,
    autoUpgradationSelected: false,
    bankId: null,
    boardingStation: boardCode,
    bookNowPressTimeDiff: 0,
    bookingChoice: 0,
    bookingConfirmChoice: 0,
    bookingInitTime: 0,
    bookingOTP: null,
    captcha: null,
    captureAddress: 0,
    clientTransactionId: cid,
    clusterFlag: 'N',
    clusterJourneyClass: null,
    cod: null,
    connectedPnrDataDTO: null,
    connectingJourney: false,
    covid19: false,
    enrouteStation: null,
    ftBooking: false,
    generalistChildConfirm: false,
    gnToCkOpted: false,
    gstDetails: {
      gstInOpted: false,
      gstInNumber: '',
      name: '',
      address: '',
      state: '',
      city: '',
      pin: '',
      stateCode: null,
    },
    hrmsTxnId: 0,
    iTicketDetailsDTO: null,
    journalistBooking: false,
    lapAvlRequestDTO: [
      {
        addMealDetail: null,
        agentOtpBooking: false,
        coachId: '',
        concessionBooking: false,
        fromStation: fromCode,
        ignoreChoiceIfWl: false,
        infantList: [],
        jd: null,
        journeyClass: details.cls,
        journeyDate: details.date,
        passengerList: paxList,
        quota: details.quota,
        reservationChoice: 4,
        ssQuotaSplitCoach: 'N',
        ticketChoiceLowerBerth: null,
        ticketChoiceSameCoach: false,
        toStation: toCode,
        trainNo: String(details.trainNo),
        trainOwner: null,
        travelInsuranceOpted: true,
      },
    ],
    loyaltyAccuralBooking: false,
    loyaltyBankId: null,
    loyaltyNumber: null,
    loyaltyRedemptionBooking: false,
    mainJourneyPnr: '',
    mainJourneyTktId: null,
    mainJourneyTxnId: null,
    mobileNumber: details.mobile,
    moreThanOneDay: false,
    mpBooking: false,
    mpSecType: null,
    name: null,
    nget_transaction_id: 0,
    nosbBooking: false,
    onwardFlag: null,
    otpBooking: false,
    passBooking: false,
    paymentType: APP_PAYMENT_TYPE,
    reservationMode: null,
    reservationUptoStation: toCode,
    returnJourney: false,
    ticketConcessionType: 0,
    ticketType: 'E',
    tktAddress: null,
    twoPhaseAuthRequired: false,
    viaPointStation: null,
    warrentType: null,
  };

  let lapRes = null;
  try {
    lapRes = await appRequestRetry(
      sess,
      '/eticketing/protected/mapps1/allLapAvlFareEnq/Y',
      { method: 'POST', body: lapLoad, label: 'allLapAvlFareEnq' },
      {
        maxRetries: 100,
        delayMs: 1000,
        highLoadDelayMinMs: 1000,
        highLoadDelayMaxMs: 4000,
        ip510Max: 3,
        ip510DelayMs: 12000,
        unableMax: 3,
        unableDelayMs: 12000,
        freshSensorEach: true,
        takeSensor: take,
        stopOnAuth: true,
        onRetry: makeRetryStatus('Passenger Submit'),
        fatalIf: (r) =>
          isFatalStationError(r?.data) || isFatalNoSeatPayload(r?.data),
        extraOk: (r) => {
          if (isFatalStationError(r?.data) || isFatalNoSeatPayload(r?.data)) {
            return false;
          }
          const dto0 = r?.data?.avlFareResponseDTO?.[0];
          const capQ = r?.data?.captchaDto?.captchaQuestion;
          return Boolean(dto0 || capQ);
        },
      }
    );
  } catch (e) {
    return { ok: false, reason: e.message || 'allLap fail' };
  }
  if (isFatalStationError(lapRes?.data)) {
    const msg = String(lapRes.data.errorMessage || 'Station code is not valid');
    status(msg.slice(0, 48));
    return {
      ok: false,
      reason: msg,
    };
  }
  if (!lapRes?.ok) {
    const earlyLap = seatStopDecision({
      availStatus:
        lapRes?.data?.avlFareResponseDTO?.[0]?.avlDayList?.[0]
          ?.availablityStatus,
      errorMessage: lapRes?.data?.errorMessage || lapRes?.data?.errorMsg,
      bookOnlyIfCnf: cnfOnly,
    });
    if (earlyLap.stop) {
      status(earlyLap.status);
      return { ok: false, reason: earlyLap.status };
    }
    const failMsg = lapRes?.reason || `allLap HTTP ${lapRes?.status || 0}`;
    status(String(failMsg).slice(0, 48));
    return {
      ok: false,
      reason: failMsg,
    };
  }

  const lapSt =
    lapRes.data?.avlFareResponseDTO?.[0]?.avlDayList?.[0]?.availablityStatus ||
    '';
  const lapAmt = pickAmount(
    lapRes.data?.totalCollectibleAmount,
    lapRes.data?.avlFareResponseDTO?.[0]?.totalCollectibleAmount,
    lapRes.data?.avlFareResponseDTO?.[0]?.totalFare
  );
  const lapStop = seatStopDecision({
    availStatus: lapSt,
    errorMessage: lapRes.data?.errorMessage,
    bookOnlyIfCnf: cnfOnly,
  });
  if (lapStop.stop) {
    status(lapStop.status);
    return { ok: false, reason: lapStop.status };
  }
  if (lapAmt || lapSt) {
    status(`Available-${seatsFromStatus(lapSt)}|${lapAmt || 0}`);
  }

  // PT fare gate
  if (
    details.quota === 'PT' &&
    details.maxPtFare > 0 &&
    lapAmt > details.maxPtFare &&
    typeof waitForPtFareProceed === 'function'
  ) {
    status('PT FARE HIGH');
    const go = await waitForPtFareProceed({
      amount: lapAmt,
      maxFare: details.maxPtFare,
    });
    if (!go) return { ok: false, reason: 'PT fare rejected' };
  }

  // --- 5) addonServices ---
  status('APP · Review…');
  let captchaAns = null;
  const capB64 = lapRes.data?.captchaDto?.captchaQuestion;
  if (capB64) {
    status('APP · Captcha…');
    try {
      captchaAns = await solveCaptchaIfNeeded(capB64);
    } catch (e) {
      return { ok: false, reason: e.message || 'Captcha fail' };
    }
  }

  const addonBody = {
    captchaAns,
    captchaType: 'BOOKINGWS',
    clientTxnId: cid,
    paymentType: details.paymentType,
    addonLapServices: [{ travelInsuranceOpted: true }],
  };
  let addon;
  try {
    addon = await appRequestRetry(
      sess,
      '/eticketing/protected/mapps1/addonServices',
      { method: 'POST', body: addonBody, label: 'addonServices' },
      {
        maxRetries: 40,
        delayMs: 800,
        highLoadDelayMinMs: 1000,
        highLoadDelayMaxMs: 4000,
        freshSensorEach: true,
        takeSensor: take,
        onRetry: makeRetryStatus('APP · Addon'),
        fatalIf: (r) => isFatalNoSeatPayload(r?.data),
      }
    );
  } catch (e) {
    return { ok: false, reason: e.message || 'addonServices fail' };
  }
  const addonStop = seatStopDecision({
    errorMessage: addon?.data?.errorMessage || addon?.data?.errorMsg,
  });
  if (addonStop.stop) {
    status(addonStop.status);
    return { ok: false, reason: addonStop.status };
  }
  if (!addon?.ok && addon?.status !== 400) {
    const failMsg = addon?.reason || `addonServices HTTP ${addon?.status || 0}`;
    status(String(failMsg).slice(0, 48));
    return {
      ok: false,
      reason: failMsg,
    };
  }
  if (addon?.data?.errorMessage) {
    const msg = String(addon.data.errorMessage);
    const again = seatStopDecision({ errorMessage: msg });
    if (again.stop) {
      status(again.status);
      return { ok: false, reason: again.status };
    }
    status(msg.slice(0, 48));
    return { ok: false, reason: msg };
  }

  const amount = pickAmount(
    addon?.data?.totalCollectibleAmount,
    lapAmt,
    avlAmt
  );
  if (!amount) {
    return { ok: false, reason: 'Amount missing after addon' };
  }

  // Sibling init gate
  if (typeof waitIfSiblingInitPayment === 'function') {
    const allow = await waitIfSiblingInitPayment();
    if (!allow) return { ok: false, reason: 'Sibling already proceed' };
  }

  // --- 6) bookingInitPayment (APP2 body) ---
  status('APP · Init payment…');
  const initBody = {
    amount: Number(amount),
    apiName: null,
    bankId: Number(details.bankId),
    captchaDto: null,
    errorMsg: null,
    juspayLoadDTO: null,
    loyaltyNum: 0,
    paramList: details.paramList || [],
    remainingBalance: 0.0,
    serverId: null,
    timeStamp: null,
    transationId: 0,
    txnDate: null,
    txnStatus: 1,
    txnType: Number(details.txnType) || 13,
    upiModeOpted: 0,
    withoutOTP: false,
  };
  // iPay 118 / Razorpay 141 / eWallet 1000 full shape
  if (
    String(details.bankId) === '118' ||
    String(details.bankId) === '141' ||
    String(details.bankId) === '1000'
  ) {
    initBody.bankName = null;
    initBody.paymentId = null;
    initBody.paymentType = null;
  }
  const initPath = `/eticketing/protected/mapps1/bookingInitPayment/${cid}?insurenceApplicable=`;
  let initPay;
  try {
    initPay = await appRequestRetry(
      sess,
      initPath,
      { method: 'POST', body: initBody, label: 'bookingInitPayment' },
      {
        maxRetries: 40,
        delayMs: 2000,
        highLoadDelayMinMs: 1500,
        highLoadDelayMaxMs: 4000,
        freshSensorEach: true,
        takeSensor: take,
        onRetry: makeRetryStatus('APP · Init payment'),
        fatalIf: (r) =>
          Boolean(r?.data?.errorMsg) &&
          !r?.data?.paramList?.some?.((p) => p?.key === 'encdata' && p?.value),
        extraOk: (r) => {
          if (r?.data?.errorMsg) return false;
          return Boolean(
            r?.data?.transationId ||
              r?.data?.transactionId ||
              r?.data?.juspayLoadDTO ||
              (Array.isArray(r?.data?.paramList) &&
                r.data.paramList.some((p) => p?.key === 'encdata'))
          );
        },
      }
    );
  } catch (e) {
    return { ok: false, reason: e.message || 'bookingInitPayment fail' };
  }
  if (!initPay?.ok) {
    const failMsg =
      initPay?.reason ||
      initPay?.data?.errorMsg ||
      `bookingInitPayment HTTP ${initPay?.status || 0}`;
    status(String(failMsg).slice(0, 48));
    return {
      ok: false,
      reason: failMsg,
    };
  }
  if (initPay.data?.errorMsg) {
    const msg = String(initPay.data.errorMsg);
    status(msg.slice(0, 48));
    return { ok: false, reason: msg };
  }

  const hasEncEarly =
    Array.isArray(initPay.data?.paramList) &&
    initPay.data.paramList.some((p) => p && p.key === 'encdata' && p.value);
  const hasTxn =
    Number(initPay.data?.transationId) > 0 ||
    Number(initPay.data?.transactionId) > 0 ||
    hasEncEarly ||
    Boolean(initPay.data?.juspayLoadDTO);
  if (!hasTxn) {
    status('Init payment failed');
    return { ok: false, reason: 'bookingInitPayment incomplete (no txn/encdata)' };
  }

  if (typeof markInitPaymentSuccess === 'function') {
    try {
      markInitPaymentSuccess();
    } catch (_) {}
  }

  status('APP · INIT PAYMENT OK');
  sess.lastClientTxnId = cid;
  sess.lastInitPayment = initPay.data;

  // --- 7) APP iPay QR (STAR ipay.py) when encdata present ---
  const payData = initPay.data || {};
  // Freeze Phase 14 cookies + spa-csrf for verifyPayment (STAR)
  payData._verify_payment_cookies = extractPhase14VerifyCookies(
    sess.jar.toJSON()
  );
  payData._session_greq = sess.uid;
  payData._session_mup = sess.mup;
  payData._session_spa_csrf = sess.spaCsrf || '';
  payData._clientTransactionId = cid;
  log(
    `Phase14 verify cookies: ${Object.keys(payData._verify_payment_cookies || {}).join(',')}`
  );

  const hasEnc =
    Array.isArray(payData.paramList) &&
    payData.paramList.some((p) => p && p.key === 'encdata' && p.value);

  // --- 7a) APP eWallet (bankId 1000) ---
  if (details.payKind === 'ewallet') {
    status('APP · eWallet…');
    const ew = await runAppEwalletFlow({
      paymentData: payData,
      amount,
      clientTransactionId: cid,
      sess,
      onStatus: status,
    });
    if (!ew.ok) {
      return {
        ok: false,
        reason: ew.reason || 'eWallet / verifyPayment fail',
        clientTxnId: cid,
        amount,
        bankId: details.bankId,
        initPayment: payData,
        captured: Boolean(ew.captured),
        userMessage: ew.userMessage || '',
      };
    }
    status(`BOOKED PNR=${ew.pnr}`);
    return {
      ok: true,
      pnr: ew.pnr,
      reservationId: ew.reservationId,
      clientTxnId: cid,
      amount,
      bankId: details.bankId,
      initPayment: payData,
      ewallet: ew,
      details,
      captured: true,
    };
  }

  // --- 7b) APP Razorpay UPI Collect (bankId 141 / Juspay) ---
  if (details.payKind === 'razorpay_upi') {
    status('APP · Razorpay UPI…');
    const rzp = await runAppRazorpayUpiFlow({
      paymentData: payData,
      amount,
      clientTransactionId: cid,
      sess,
      vpa: details.vpa || '',
      onStatus: status,
    });
    if (!rzp.ok) {
      return {
        ok: false,
        reason: rzp.reason || 'Razorpay UPI / verifyPayment fail',
        clientTxnId: cid,
        amount,
        bankId: details.bankId,
        initPayment: payData,
        captured: Boolean(rzp.captured),
        userMessage: rzp.userMessage || '',
      };
    }
    status(`BOOKED PNR=${rzp.pnr}`);
    return {
      ok: true,
      pnr: rzp.pnr,
      reservationId: rzp.reservationId,
      clientTxnId: cid,
      amount,
      bankId: details.bankId,
      initPayment: payData,
      razorpay: rzp,
      details,
      captured: true,
    };
  }

  // --- 7c) APP iPay QR (STAR ipay.py) when encdata present ---
  if (details.payKind === 'ipay_qr' || hasEnc) {
    status('APP · iPay QR…');
    const ipay = await runAppIpayQrFlow({
      paymentData: payData,
      amount,
      clientTransactionId: cid,
      sess,
      onStatus: status,
      onQr,
      onQrHide,
    });
    if (!ipay.ok) {
      return {
        ok: false,
        reason: ipay.reason || 'iPay / verifyPayment fail',
        clientTxnId: cid,
        amount,
        bankId: details.bankId,
        initPayment: payData,
        captured: Boolean(ipay.captured),
        userMessage: ipay.userMessage || '',
      };
    }
    status(`BOOKED PNR=${ipay.pnr}`);
    return {
      ok: true,
      pnr: ipay.pnr,
      reservationId: ipay.reservationId,
      clientTxnId: cid,
      amount,
      bankId: details.bankId,
      initPayment: payData,
      ipay,
      details,
      captured: true,
    };
  }

  if (details.payKind === 'phonepe_qr') {
    status('APP · PhonePe Juspay — next (use PhonePe QR payment profile)');
    // Juspay path can be added next; init already OK with bank 111
  }

  return {
    ok: true,
    clientTxnId: cid,
    amount,
    bankId: details.bankId,
    initPayment: payData,
    details,
  };
}

module.exports = { performAppBook, buildDetails };
