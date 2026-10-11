/**
 * Map SQLite profiles → extension chrome.storage shape for content_script_beta.js
 */

const fs = require('fs');
const path = require('path');
const profileStore = require('./profile-store');

/** @type {{ byCode: Map<string, string>, byName: Map<string, string> } | null} */
let stationIndex = null;

function loadStationIndex() {
  if (stationIndex) return stationIndex;
  const byCode = new Map();
  const byName = new Map();
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'stationlist.json'), 'utf8');
    const list = JSON.parse(raw);
    for (const item of list || []) {
      const code = String(item.code || '')
        .trim()
        .toUpperCase();
      const name = String(item.name || '')
        .trim()
        .toUpperCase();
      if (!code) continue;
      byCode.set(code, code);
      if (name) {
        // First exact name wins (SURAT → ST)
        if (!byName.has(name)) byName.set(name, code);
      }
    }
  } catch (e) {
    console.warn('[Ocean] stationlist.json load failed:', e.message || e);
  }
  stationIndex = { byCode, byName };
  return stationIndex;
}

/**
 * Resolve bare token via stationlist: exact CODE, or exact NAME → code.
 */
function resolveBareStationToken(token) {
  const t = String(token || '')
    .trim()
    .toUpperCase();
  if (!t) return '';
  const idx = loadStationIndex();
  if (idx.byCode.has(t)) return t;
  if (idx.byName.has(t)) return idx.byName.get(t);
  // "SURAT JN" / "SURAT JUNCTION"
  const stripped = t
    .replace(/\b(JUNCTION|JN|CITY|CANTT|CNTL|CENTRAL|TERM|TERMINAL|STN)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (stripped && stripped !== t) {
    if (idx.byName.has(stripped)) return idx.byName.get(stripped);
    if (idx.byCode.has(stripped)) return stripped;
  }
  return '';
}

/**
 * UI: "NEW DELHI - NDLS" | IRCTC: "NDLS - NEW DELHI" | bare: "NDLS" | bare name: "SURAT"
 * Always returns 2–5 char IRCTC station code only (never city/name).
 *
 * Prefer trailing CODE after dash (Ocean UI = "NAME - CODE").
 * Do NOT treat leading "SURAT" in "SURAT - ST" as the code.
 */
function extractStationCode(stationString) {
  if (!stationString) return '';
  const s = String(stationString).trim();
  if (!s) return '';

  // 1) "Anything - CODE" at end (UI: SURAT - ST → ST)
  let m = s.match(/\s*[-–—]\s*([A-Z0-9]{2,5})\s*$/i);
  if (m) {
    const code = m[1].toUpperCase();
    return resolveBareStationToken(code) || code;
  }

  // 2) Parentheses: "Surat (ST)"
  m = s.match(/\(([A-Z0-9]{2,5})\)\s*$/i);
  if (m) {
    const code = m[1].toUpperCase();
    return resolveBareStationToken(code) || code;
  }

  // 3) "CODE - Name" only when CODE is a known station code
  m = s.match(/^([A-Z0-9]{2,5})\s*[-–—]\s+.+/i);
  if (m) {
    const maybe = m[1].toUpperCase();
    if (loadStationIndex().byCode.has(maybe)) return maybe;
  }

  // 4) Bare token — code or name via stationlist
  if (!/[-–—]/.test(s)) {
    const resolved = resolveBareStationToken(s);
    if (resolved) return resolved;
    if (/^[A-Z0-9]{2,5}$/i.test(s)) return s.toUpperCase();
    return '';
  }

  // 5) Multi-dash fallback
  const parts = s
    .split(/[-–—]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length) {
    const last = parts[parts.length - 1];
    const lastResolved = resolveBareStationToken(last);
    if (lastResolved) return lastResolved;
    if (/^[A-Z0-9]{2,5}$/i.test(last)) return last.toUpperCase();
    const first = parts[0];
    if (loadStationIndex().byCode.has(first.toUpperCase())) return first.toUpperCase();
  }

  return '';
}

function resolveTrueCaptchaCredentials() {
  try {
    return profileStore.getTrueCaptchaCredentials();
  } catch (_) {
    const userId = process.env.OCEAN_TRUECAPTCHA_USER || '';
    const apiKey = process.env.OCEAN_TRUECAPTCHA_KEY || '';
    return { enabled: Boolean(userId && apiKey), userId, apiKey };
  }
}

function resolveManualLogin() {
  try {
    const ui = profileStore.getUiState();
    return String(ui.manualLoginEnabled ?? '0') === '1';
  } catch (_) {
    return false;
  }
}

function buildStorageFromBundle(bundle) {
  const journey = bundle.journey || {};
  const credential = bundle.credential || {};
  const payment = bundle.payment || {};
  const passengers = Array.isArray(journey.passengers) ? journey.passengers : [];
  const infants = Array.isArray(journey.infants) ? journey.infants : [];

  const passenger_details = passengers.map((p) => ({
    name: p.name || '',
    age: p.age || '',
    gender: p.gender || '',
    berth: p.berth || '',
    food: p.food || '',
    childBerth: Boolean(p.childBerth),
  }));

  const infant_details = infants.map((inf) => ({
    name: inf.name || '',
    age: inf.age ?? '0',
    gender: inf.gender || '',
  }));

  // Always short IRCTC codes for WEB Direct / Classic / Beta inject
  const fromCode = extractStationCode(journey.from) || String(journey.from || '').trim();
  const toCode = extractStationCode(journey.to) || String(journey.to || '').trim();
  const boardCode =
    extractStationCode(journey.boarding) || fromCode || String(journey.boarding || '').trim();

  return {
    irctc_credentials: {
      user_name: credential.username || '',
      password: credential.password || '',
    },
    journey_details: {
      from: fromCode,
      destination: toCode,
      boarding: boardCode,
      date: journey.date || '',
      class: journey.class || '',
      quota: journey.quota || 'GN',
      'train-no': journey.trainNo || '',
    },
    passenger_details,
    infant_details,
    travel_preferences: {
      AvailabilityCheck: journey.availabilityCheck || 'A',
      bookOnlyIfCnf: journey.options?.confirmBerths !== false,
    },
    other_preferences: {
      paymentmethod: payment.paymentMethod || '',
      backup_payment_method: payment.backupPaymentMethod || '',
      acbooktime: journey.acbooktime || '09:59:59',
      slbooktime: journey.slbooktime || '10:59:59',
      gnbooktime: journey.gnbooktime || '07:59:59',
      CaptchaSubmitMode: 'A',
      manualLogin: resolveManualLogin(),
      mobileNumber: (journey.contact && journey.contact.mobile) || '',
      email: (journey.contact && journey.contact.email) || '',
      cardnumber: payment.cardnumber || '',
      cardexpiry: payment.cardexpiry || '',
      cardcvv: payment.cardcvv || '',
      cardholder: payment.cardholder || '',
    },
    vpa: payment.vpa || '',
    fare_limit: (() => {
      const raw = String(journey.options?.maxPtFare ?? journey.maxPtFare ?? '')
        .replace(/,/g, '')
        .trim();
      const max = parseFloat(raw);
      const ok = Number.isFinite(max) && max > 0;
      return {
        enableFareLimit: ok,
        maxFareAmount: ok ? String(Math.round(max * 100) / 100) : '',
        bookInPopup: false,
      };
    })(),
    true_captcha_credentials: resolveTrueCaptchaCredentials(),
  };
}

module.exports = {
  extractStationCode,
  resolveBareStationToken,
  buildStorageFromBundle,
};
