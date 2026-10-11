/**
 * Train list (erail.in) + seat availability (indianrail.gov.in + local Erail OCR)
 */

const { getChromeUserAgent } = require('./stealth');
const { solveCaptchaImage, ensureOcrReady } = require('./erail-ocr-bridge');
const { createRequestCache } = require('./request-cache.cjs');
const { message: availabilityMessage } = require('./availability-format');
const routeRequests = createRequestCache(5 * 60000);
const availabilityRequests = createRequestCache(0);
let availabilityQueue = Promise.resolve();

const INDIAN_RAIL_HOME =
  'https://www.indianrail.gov.in/enquiry/StaticPages/StaticEnquiry.jsp?lang=en';
const INDIAN_RAIL_API_URL = 'https://www.indianrail.gov.in/enquiry/CommonCaptcha';
const ERAIL_TRAIN_LIST_URL = 'https://erail.in/rail/getTrains.aspx';

let irSessionReady = false;
let irSessionPromise = null;

function irFetch(url, init = {}) {
  const { net } = require('electron');
  const ua = getChromeUserAgent();
  const headers = {
    'User-Agent': ua,
    Referer: INDIAN_RAIL_HOME,
    'Accept-Language': 'en-US,en;q=0.9',
    ...(init.headers || {}),
  };
  return net.fetch(url, { ...init, headers, signal: init.signal || AbortSignal.timeout(12000) });
}

async function ensureIndianRailSession() {
  if (irSessionReady) return;
  if (irSessionPromise) return irSessionPromise;
  irSessionPromise = (async () => {
  const res = await irFetch(INDIAN_RAIL_HOME, {
    headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
  });
  if (!res.ok) throw new Error(`IndianRail session bootstrap HTTP ${res.status}`);
  await res.text();
  irSessionReady = true;
  })().finally(() => { irSessionPromise = null; });
  return irSessionPromise;
}

function warmAvailability() {
  return Promise.all([ensureIndianRailSession(), ensureOcrReady()]);
}

function mapTrainType(trainDataOrType) {
  const rawInput =
    typeof trainDataOrType === 'string'
      ? trainDataOrType
      : String(trainDataOrType?.typ || trainDataOrType?.type || 'exp');
  const raw = rawInput.trim().toLowerCase();
  const up = rawInput.trim().toUpperCase();
  if (up === 'EXP' || up === 'PASS' || up === 'DMU' || up === 'EMU') return up;
  if (raw.includes('passenger') || raw.includes('ordinary') || raw === 'pass' || raw === 'pas') {
    return 'PASS';
  }
  if (raw.includes('dmu') || raw.includes('emu') || raw.includes('memu') || raw === 'mem') {
    return 'DMU';
  }
  const shortMap = {
    exp: 'EXP',
    pass: 'PASS',
    pas: 'PASS',
    mem: 'DMU',
    memu: 'DMU',
    dmu: 'DMU',
    emu: 'EMU',
    loc: 'DMU',
    sf: 'EXP',
  };
  if (shortMap[raw]) return shortMap[raw];
  return 'EXP';
}

function getStationNameAndCode(input) {
  const raw = String(input || '').trim();
  if (!raw) return { name: '', code: '' };

  // Legacy UI: "LOKMANYATILAK T - LTT"
  const m = raw.match(/^(.*)\s+-\s+([A-Z0-9]{2,5})$/i);
  if (m) return { name: m[1].trim(), code: m[2].toUpperCase() };

  // New UI: bare code "LTT" / "BSB"
  if (/^[A-Z0-9]{2,5}$/i.test(raw)) {
    const code = raw.toUpperCase();
    return { name: code, code };
  }

  // Fallback via stationlist (name or CODE - Name)
  try {
    const { extractStationCode } = require('./profile-bridge');
    const code = extractStationCode(raw);
    if (code) return { name: raw, code };
  } catch (_) {}

  return { name: raw, code: '' };
}

const CLASS_SORT = ['1A', '2A', '3A', 'CC', 'FC', 'SL', '2S', '3E'];

function classSortKey(cls) {
  const i = CLASS_SORT.indexOf(cls);
  return i === -1 ? 999 : i;
}

function cleanErailTime(t) {
  const s = String(t || '').trim();
  return s.includes('.') ? s.replace(/\./g, ':') : s;
}

function findClassesFromRaw(raw) {
  const found = new Set();
  const chunk = String(raw || '');
  const re = /(^|[|:,~])([123]A|2S|SL|CC|3E|FC)(?=[:|,|~])/g;
  let m;
  while ((m = re.exec(chunk)) !== null) {
    found.add(m[2]);
  }
  const re2 = /(?<![A-Z])(1A|2A|3A|3E|SL|2S|CC|FC)(?=[:,\s|])/g;
  while ((m = re2.exec(chunk)) !== null) {
    found.add(m[0]);
  }
  return [...found].sort((a, b) => classSortKey(a) - classSortKey(b));
}

function guessErailTrainType(chunk) {
  const up = String(chunk || '')
    .toUpperCase()
    .replace(/\s+/g, '_');
  const cats = [
    'SUPERFAST',
    'MAIL_&_EXPRESS',
    'MAIL_EXPRESS',
    'HUMSAFAR',
    'ANTYODAYA',
    'RAJDHANI',
    'SHATABDI',
    'DURONTO',
    'JAN_SHATABDI',
    'SPECIAL',
    'PASSENGER',
    'ORDINARY',
  ];
  for (const c of cats) {
    if (up.includes(c)) return c.replace(/_/g, ' ');
  }
  return '';
}

function runsOnDate(daysBits, isoDate) {
  if (!daysBits || daysBits.length !== 7 || !/^[01]{7}$/.test(daysBits)) return true;
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return true;
  const dow = (d.getDay() + 6) % 7;
  return daysBits[dow] === '1';
}

function parseErailTrainRecords(text) {
  const parts = String(text || '')
    .trim()
    .split('^');
  const trains = [];

  for (const rec of parts.slice(1)) {
    const row = rec.trim();
    if (!row) continue;
    const fields = row.split('~');
    if (fields.length < 13) continue;
    try {
      const trainNo = fields[0].trim();
      const name = fields[1].trim();
      const boardCode = fields[7].trim();
      const alightCode = fields[9].trim();
      let daysBits = '';
      if (fields.length > 13 && /^[01]{7}$/.test(fields[13] || '')) {
        daysBits = fields[13];
      }
      const listed = findClassesFromRaw(row);
      trains.push({
        train_no: trainNo,
        name,
        board_code: boardCode,
        alight_code: alightCode,
        depart: cleanErailTime(fields[10]),
        arrive: cleanErailTime(fields[11]),
        duration: fields[12].trim(),
        days_bits: daysBits,
        type: guessErailTrainType(row),
        classes: listed,
        raw: row,
      });
    } catch (_) {
      /* skip bad row */
    }
  }

  return trains;
}

function buildErailTrainListUrl(fromCode, toCode) {
  const params = new URLSearchParams({
    Station_From: fromCode,
    Station_To: toCode,
    DataSource: '0',
    Language: '0',
    Cache: 'true',
  });
  return `${ERAIL_TRAIN_LIST_URL}?${params.toString()}`;
}

async function fetchTrainList(from, to, date) {
  const fromObj = getStationNameAndCode(from);
  const toObj = getStationNameAndCode(to);
  if (!fromObj.code || !toObj.code) {
    throw new Error('Invalid station. Use code e.g. LTT / BSB (or NAME - CODE)');
  }

  const url = buildErailTrainListUrl(fromObj.code, toObj.code);
  const allTrains = await routeRequests(url, async () => {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(12000),
    headers: {
      'User-Agent': getChromeUserAgent(),
      Accept: '*/*',
      Referer: `https://erail.in/trains-between-stations/${fromObj.code}/${toObj.code}`,
      'X-Requested-With': 'XMLHttpRequest',
    },
  });
  if (!res.ok) throw new Error(`Erail train list HTTP ${res.status}`);
  const text = await res.text();
  return parseErailTrainRecords(text);
  });
  const isoDate = String(date || '').trim();
  const trains = allTrains.filter((tr) => runsOnDate(tr.days_bits, isoDate));

  return {
    url,
    from: fromObj.code,
    to: toObj.code,
    date: isoDate,
    trains,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseIrError(bodyText) {
  try {
    const j = JSON.parse(bodyText);
    if (j && j.errorMessage) return availabilityMessage(j.errorMessage, 'Availability service returned an unreadable error. Try again.');
  } catch (_) {}
  return bodyText.slice(0, 200);
}

function isDefinitiveAvailabilityMessage(msg) {
  const low = String(msg || '').toLowerCase();
  return (
    low.includes('booking not allowed') ||
    low.includes('not available') ||
    low.includes('not permitted') ||
    low.includes('no seats') ||
    low.includes('train not') ||
    low.includes('chart prepared') ||
    low.includes('regret')
  );
}

function isCaptchaOrSessionError(errMsg) {
  const low = String(errMsg || '').toLowerCase();
  return (
    low.includes('invalid captcha') ||
    low.includes('wrong captcha') ||
    low.includes('captcha mismatch') ||
    low.includes('session out') ||
    low.includes('session expired') ||
    (low.includes('captcha') &&
      (low.includes('invalid') || low.includes('wrong') || low.includes('incorrect')))
  );
}

function parseAvailabilityResponse(bodyText) {
  const trimmed = String(bodyText || '').trim();
  if (!trimmed.startsWith('{')) {
    const errMsg = parseIrError(bodyText);
    return {
      ok: false,
      retry: isCaptchaOrSessionError(errMsg),
      error: errMsg || 'Unexpected availability response',
    };
  }

  let data;
  try {
    data = JSON.parse(trimmed);
  } catch (_) {
    const errMsg = parseIrError(bodyText);
    return {
      ok: false,
      retry: isCaptchaOrSessionError(errMsg),
      error: errMsg || 'Unexpected availability response',
    };
  }

  if (Array.isArray(data.avlDayList) && data.avlDayList.length > 0) {
    return { ok: true, data, retry: false };
  }

  if (data.errorMessage) {
    const msg = availabilityMessage(data.errorMessage, 'Availability service returned an unreadable error. Try again.');
    if (isDefinitiveAvailabilityMessage(msg) || !isCaptchaOrSessionError(msg)) {
      return { ok: false, retry: false, error: msg };
    }
    return { ok: false, retry: true, error: msg };
  }

  if ('avlDayList' in data) {
    return { ok: true, data, retry: false };
  }

  return { ok: true, data, retry: false };
}

async function fetchAvailabilityOnce({ trainNo, classCode, fromCode, toCode, date, quota, trainType, solution }) {
  const params = new URLSearchParams({
    inputCaptcha: String(solution).trim(),
    inputPage: 'TBIS_CALL_FOR_FARE',
    trainNo: String(trainNo),
    dt: String(date),
    sourceStation: String(fromCode),
    destinationStation: String(toCode),
    classc: String(classCode),
    quota: String(quota),
    traintype: trainType || 'EXP',
    language: 'en',
    _: String(Date.now()),
  });

  const availabilityResponse = await irFetch(`${INDIAN_RAIL_API_URL}?${params.toString()}`, {
    headers: {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
    },
  });
  if (!availabilityResponse.ok) {
    throw new Error(`Availability fetch failed HTTP ${availabilityResponse.status}`);
  }
  const bodyText = await availabilityResponse.text();
  return parseAvailabilityResponse(bodyText);
}

/** Local Erail OCR + indianrail.gov.in (Chromium cookie session like extension). */
async function fetchAvailabilityWithRetries(payload) {
  const { trainNo, classCode, fromCode, toCode, date, quota, trainType } = payload;
  await warmAvailability();

  let lastErr = '';

  const startedAt = Date.now();
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (Date.now() - startedAt > 30000) break;
    try {
      const captchaUrl = `https://www.indianrail.gov.in/enquiry/captchaDraw.png?${Date.now()}_${attempt}`;
      const captchaResponse = await irFetch(captchaUrl, {
        headers: { Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' },
      });
      if (!captchaResponse.ok) throw new Error('Captcha download failed');

      const captchaBuf = Buffer.from(await captchaResponse.arrayBuffer());
      let solution;
      try {
        solution = await solveCaptchaImage(captchaBuf);
      } catch (ocrErr) {
        lastErr = ocrErr.message || String(ocrErr);
        console.warn('[Ocean Train] OCR attempt failed:', lastErr);
        await sleep(300);
        continue;
      }

      console.log(`[Ocean Train] Avail try ${attempt}/3 train=${trainNo} ${classCode}`);

      const result = await fetchAvailabilityOnce({
        trainNo,
        classCode,
        fromCode,
        toCode,
        date,
        quota,
        trainType: mapTrainType(trainType),
        solution,
      });

      if (result.ok) return result.data;

      lastErr = result.error || 'Availability failed';
      if (!result.retry) break;
      if (/session/i.test(lastErr)) { irSessionReady = false; await ensureIndianRailSession(); }
      await sleep(400);
    } catch (e) {
      lastErr = e.message || String(e);
      if (isDefinitiveAvailabilityMessage(lastErr)) break;
      // Network/service failures are not fixed by downloading another captcha.
      break;
    }
  }

  throw new Error(lastErr || 'Seat availability failed after captcha retries');
}

function solveCaptchaAndFetchAvailability(payload) {
  const key = JSON.stringify(['trainNo','classCode','fromCode','toCode','date','quota','trainType'].map(k => payload[k] || ''));
  return availabilityRequests(key, () => {
    // Different captcha requests share Chromium cookies; run one at a time.
    const result = availabilityQueue.then(() => fetchAvailabilityWithRetries(payload));
    availabilityQueue = result.catch(() => {});
    return result;
  });
}

module.exports = {
  getStationNameAndCode,
  buildErailTrainListUrl,
  fetchTrainList,
  solveCaptchaAndFetchAvailability,
  mapTrainType,
  warmAvailability,
};
