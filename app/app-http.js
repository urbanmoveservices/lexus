/**
 * APP mapps1 HTTP helper — contents.irctc.co.in + androidbm + spa-csrf + optional sensor.
 * High-load / 510 Client IP / unable-to-process retries (STAR-aligned).
 * Optional sess.dispatcher (panel proxy) via undici.
 */
const APP_UA = 'IRCTC Rail Connect/4.3.12Android';
const AUTH_BASE = 'https://www.contents.irctc.co.in';

const IP510_RETRY_MAX = 3;
const IP510_RETRY_DELAY_MS = 12000;
const HIGH_LOAD_DELAY_MIN_MS = 1000;
const HIGH_LOAD_DELAY_MAX_MS = 4000;

const { appFetchDispatcherOpts } = require('./app-proxy');
const undiciFetch = require('undici').fetch;

/** Node/Electron fetch with optional sess.dispatcher (panel proxy). */
function appFetch(url, opts = {}, sess = null) {
  const extra = appFetchDispatcherOpts(sess);
  const merged = { ...opts, ...extra };
  if (merged.dispatcher) return undiciFetch(url, merged);
  return fetch(url, merged);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randBetween(min, max) {
  const a = Math.min(min, max);
  const b = Math.max(min, max);
  return a + Math.floor(Math.random() * (b - a + 1));
}

function isValidCsrf(csrf) {
  const s = String(csrf || '').trim();
  if (!s || s.length < 8) return false;
  const low = s.toLowerCase();
  if (low === 'mismatch' || low.includes('mismatch') || low === 'null') return false;
  return [...s].some((c) => c >= '0' && c <= '9');
}

function absorbCookies(jar, res) {
  if (!jar || !res) return;
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
  if (list.length) jar.absorb(list);
}

function captureCsrf(sess, res) {
  if (!sess || !res || res.status !== 200) return null;
  const raw =
    res.headers.get('csrf-token') ||
    res.headers.get('spa-csrf-token') ||
    '';
  if (!isValidCsrf(raw)) return null;
  sess.spaCsrf = String(raw).trim();
  return sess.spaCsrf;
}

function buildHeaders(sess, { sensor = null, json = true } = {}) {
  const headers = {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip',
    'Accept-Language': 'en-US,en;q=0.0',
    bmirak: 'androidbm',
    'Content-Language': 'en',
    greq: sess.uid,
    mup: sess.mup,
    'User-Agent': APP_UA,
  };
  if (json) headers['Content-Type'] = 'application/json ; charset=UTF-8';
  const cookie = sess.jar.header();
  if (cookie) headers.Cookie = cookie;
  if (sess.spaCsrf) headers['spa-csrf-token'] = sess.spaCsrf;
  if (sess.tokens?.access_token) {
    headers.Authorization = `bearer ${sess.tokens.access_token}`;
  }
  if (sess.tokens?.refresh_token) {
    headers.bmiyek = sess.tokens.refresh_token;
  }
  if (sensor) headers['X-acf-sensor-data'] = sensor;
  return headers;
}

function parseJsonSafe(text) {
  if (!text || !String(text).trim()) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function mappsErrorLower(text) {
  const j = parseJsonSafe(text);
  if (j && typeof j === 'object') {
    const err =
      j.errorMessage ||
      j.error_description ||
      j.error ||
      j.message ||
      j.errorMsg ||
      '';
    if (err) return String(err).toLowerCase();
  }
  return String(text || '').toLowerCase();
}

/** Akamai 510 / "Client IP" block. */
function isIp510Block(status, text) {
  if (status === 510) return true;
  return mappsErrorLower(text).includes('client ip');
}

/** 200 JSON with high-load / service unavailable message. */
function isMappsHighLoadBody(text) {
  const low = mappsErrorLower(text);
  return low.includes('high load') || low.includes('service unavailable');
}

/** Unable to process/perform — capped 12s retries (not endless high-load poll). */
function isMappsUnableBody(text) {
  const low = mappsErrorLower(text);
  if (!low) return false;
  if (isMappsHighLoadBody(text)) return false;
  return (
    low.includes('unable to process') ||
    low.includes('unable to perform') ||
    low.includes('an error occurred while processing')
  );
}

function hasBookingSuccessShape(j) {
  if (!j || typeof j !== 'object') return false;
  return Boolean(
    j.transationId ||
      j.transactionId ||
      j.juspayLoadDTO ||
      j.paramList ||
      j.avlFareResponseDTO ||
      j.boardingStationList ||
      j.trainBtwnStnsList ||
      j.avlDayList ||
      j.access_token
  );
}

/** Invalid From/To/boarding station — never soft-retry. */
function isFatalStationError(textOrJson) {
  const low =
    typeof textOrJson === 'string'
      ? mappsErrorLower(textOrJson)
      : mappsErrorLower(
          textOrJson?.errorMessage ||
            textOrJson?.errorMsg ||
            textOrJson?.error ||
            JSON.stringify(textOrJson || {})
        );
  return (
    low.includes('invalid to station') ||
    low.includes('invalid from station') ||
    low.includes('invalid boarding') ||
    low.includes('invalid station code') ||
    /invalid\s+(from|to|boarding)?\s*station/.test(low)
  );
}

/** Panel-facing text for no-seat / fatal mapps payloads (prefer availablityStatus). */
function userFacingMappsFatal(data, label) {
  const err = String(data?.errorMessage || data?.errorMsg || '').trim();
  if (err) {
    if (/no seats?\s*available/i.test(err)) return 'No seats available';
    if (/not available|not avl/i.test(err)) return 'NOT AVAILABLE';
    if (/regret/i.test(err)) return 'REGRET';
    if (/train departed/i.test(err)) return 'TRAIN DEPARTED';
    if (/cancelled/i.test(err)) return 'CANCELLED';
    return err.slice(0, 48);
  }
  const st = String(
    data?.avlDayList?.[0]?.availablityStatus ||
      data?.avlFareResponseDTO?.[0]?.avlDayList?.[0]?.availablityStatus ||
      ''
  ).trim();
  if (!st) return `Fatal mapps error on ${label || 'request'}`;
  if (/REGRET/i.test(st)) return 'REGRET';
  if (/TRAIN DEPARTED/i.test(st)) return 'TRAIN DEPARTED';
  if (/CANCELLED/i.test(st)) return 'CANCELLED';
  if (/NOT AVAILABLE|NOT AVL/i.test(st)) return 'NOT AVAILABLE';
  return st.slice(0, 48);
}

function maskHeaderValue(key, value) {
  const k = String(key || '').toLowerCase();
  const v = String(value ?? '');
  if (!v) return v;
  if (
    k === 'authorization' ||
    k === 'bmiyek' ||
    k === 'greq' ||
    k === 'spa-csrf-token' ||
    k === 'bmirak' ||
    k.includes('sensor') ||
    k.includes('cookie')
  ) {
    if (v.length <= 12) return `${v.slice(0, 4)}…(len=${v.length})`;
    return `${v.slice(0, 8)}…${v.slice(-4)} (len=${v.length})`;
  }
  return v;
}

function headersForLog(headers) {
  const out = {};
  if (!headers || typeof headers !== 'object') return out;
  for (const [k, v] of Object.entries(headers)) {
    out[k] = maskHeaderValue(k, v);
  }
  return out;
}

function bodyForLog(body, max = 4000) {
  let s =
    body == null
      ? '(none)'
      : typeof body === 'string'
        ? body
        : JSON.stringify(body, null, 2);
  if (s.length > max) s = `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]`;
  return s;
}

function logAppExchange({ method, label, url, headers, reqBody, status, resText, json }) {
  console.log('============================================================');
  console.log(`[Ocean APP] ${method} ${label}`);
  console.log(`URL ${url}`);
  console.log('--- request headers ---');
  console.log(JSON.stringify(headersForLog(headers), null, 2));
  console.log('--- request body ---');
  console.log(bodyForLog(reqBody));
  console.log(`--- response status=${status} ---`);
  if (json != null) {
    console.log(bodyForLog(json));
  } else {
    console.log(bodyForLog(resText));
  }
  console.log('============================================================');
}

/**
 * Retryable overload / IP / Akamai — true = do not treat as success.
 */
function isHighLoad(status, text) {
  if (isIp510Block(status, text)) return true;
  if (status === 511 || status === 503 || status === 403) return true;

  if (status === 200 && text && String(text).trim().startsWith('{')) {
    const j = parseJsonSafe(text);
    if (hasBookingSuccessShape(j)) return false;
    if (isMappsHighLoadBody(text) || isMappsUnableBody(text)) return true;
    if (j?.errorMessage && /please retry|try again|temporarily/i.test(String(j.errorMessage))) {
      return true;
    }
  }

  const body = String(text || '');
  const low = body.toLowerCase();
  if (!body.trim()) return status !== 200;
  if (body.trim().startsWith('<') || low.includes('<html')) return true;
  return (
    body.includes('High Load') ||
    low.includes('high load') ||
    low.includes('client ip') ||
    low.includes('service unavailable') ||
    low.includes('unable to process') ||
    low.includes('unable to perform') ||
    (low.includes('please retry') && !low.includes('transationid')) ||
    low.includes('akamai')
  );
}

/**
 * @returns {'ok'|'ip510'|'unable'|'high_load'|'auth'|'other'}
 */
function classifyMappsResult(status, text, highLoadFlag) {
  if (status === 401 || status === 406) return 'auth';
  // Some gateways return 200 JSON with invalid_token
  const low = String(text || '').toLowerCase();
  if (
    low.includes('invalid_token') ||
    low.includes('invalid access token')
  ) {
    return 'auth';
  }
  if (isIp510Block(status, text)) return 'ip510';
  if (status === 200 && isMappsUnableBody(text)) return 'unable';
  if (
    highLoadFlag ||
    isMappsHighLoadBody(text) ||
    status === 511 ||
    status === 503 ||
    status === 403
  ) {
    return 'high_load';
  }
  if (status !== 200) return 'other';
  return 'ok';
}

function invalidTokenUserMessage(text) {
  try {
    const j = JSON.parse(text || '');
    const desc = String(
      j?.error_description || j?.errorMessage || j?.error || ''
    ).trim();
    if (desc) return desc.length > 100 ? `${desc.slice(0, 97)}…` : desc;
  } catch (_) {}
  const low = String(text || '').toLowerCase();
  if (low.includes('invalid_token') || low.includes('invalid access token')) {
    return 'Invalid access token';
  }
  return '';
}

/**
 * @param {object} sess app-pair session
 * @param {string} path absolute path or full URL
 * @param {{ method?: string, body?: any, sensor?: string|null, label?: string }} opts
 */
async function appRequest(sess, path, opts = {}) {
  const method = opts.method || 'GET';
  const url = path.startsWith('http') ? path : `${AUTH_BASE}${path}`;
  const headers = buildHeaders(sess, {
    sensor: opts.sensor || null,
    json: method !== 'GET',
  });
  const body =
    opts.body == null
      ? null
      : typeof opts.body === 'string'
        ? opts.body
        : JSON.stringify(opts.body);

  const label = opts.label || path;
  console.log(`[Ocean APP] → ${method} ${label}`);

  const res = await appFetch(
    url,
    {
      method,
      headers,
      body: body == null ? undefined : body,
      redirect: 'manual',
    },
    sess
  );
  const text = await res.text();
  const json = parseJsonSafe(text);
  absorbCookies(sess.jar, res);
  captureCsrf(sess, res);

  const highLoad = isHighLoad(res.status, text);
  console.log(
    `[Ocean APP] ← ${res.status} ${label}` +
      (json?.errorMessage ? ` err=${json.errorMessage}` : '') +
      (highLoad ? ' [retryable]' : '')
  );

  // Full exchange log (headers masked; body + response plain)
  try {
    logAppExchange({
      method,
      label,
      url,
      headers,
      reqBody: opts.body,
      status: res.status,
      resText: text,
      json,
    });
  } catch (_) {}

  return {
    status: res.status,
    text,
    data: json,
    ok: res.status === 200,
    highLoad,
  };
}

/**
 * Retry wrapper — STAR-style:
 *  - High Load / 511 / 403 → keep polling (1–4s), newconsume sensor on retry
 *  - 510 Client IP / unable-to-process → 12s gap, max 3 then stop
 *  - 401/406 → stop (auth)
 *  - Sensor: first attempt reuse session cache; each retry → newconsume
 *
 * @param {object} retry
 * @param {number} [retry.maxRetries]
 * @param {number} [retry.delayMs] soft miss delay (seat not open etc.)
 * @param {number} [retry.highLoadDelayMinMs]
 * @param {number} [retry.highLoadDelayMaxMs]
 * @param {number} [retry.ip510Max]
 * @param {number} [retry.ip510DelayMs]
 * @param {number} [retry.unableMax]
 * @param {boolean} [retry.freshSensorEach] use sensor on each attempt
 * @param {Function} [retry.takeSensor] async ({ forceFresh }) => sensorString
 * @param {Function} [retry.extraOk]
 * @param {Function} [retry.fatalIf]
 * @param {Function} [retry.onRetry] ({ kind, attempt, delayMs, status, label, message })
 * @param {boolean} [retry.stopOnAuth=true]
 */
async function appRequestRetry(sess, path, opts = {}, retry = {}) {
  const max = retry.maxRetries ?? 40;
  const delayMs = retry.delayMs ?? 800;
  const hlMin = retry.highLoadDelayMinMs ?? HIGH_LOAD_DELAY_MIN_MS;
  const hlMax = retry.highLoadDelayMaxMs ?? HIGH_LOAD_DELAY_MAX_MS;
  const ip510Max = retry.ip510Max ?? IP510_RETRY_MAX;
  const ip510DelayMs = retry.ip510DelayMs ?? IP510_RETRY_DELAY_MS;
  const unableMax = retry.unableMax ?? IP510_RETRY_MAX;
  const unableDelayMs = retry.unableDelayMs ?? IP510_RETRY_DELAY_MS;
  const needSensorEach = retry.freshSensorEach === true;
  const takeSensor = retry.takeSensor;
  const stopOnAuth = retry.stopOnAuth !== false;
  const onRetry = typeof retry.onRetry === 'function' ? retry.onRetry : null;
  const label = opts.label || path;

  let last = null;
  let ip510Count = 0;
  let unableCount = 0;
  /** Next attempt: true after fail/retryable error; false after soft seat-wait */
  let needFreshNext = false;

  for (let i = 0; i < max; i++) {
    let sensor = opts.sensor;
    if (needSensorEach && typeof takeSensor === 'function') {
      // first attempt / soft continue → cache reuse; fail retry → newconsume
      const forceFresh = i > 0 && needFreshNext;
      sensor = await takeSensor({ forceFresh });
      if (!sensor) {
        return {
          ok: false,
          status: 0,
          text: '',
          data: null,
          reason: 'No sensor',
        };
      }
    }
    last = await appRequest(sess, path, { ...opts, sensor });
    const kind = classifyMappsResult(last.status, last.text, last.highLoad);

    if (kind === 'auth' && stopOnAuth) {
      const tokMsg = invalidTokenUserMessage(last.text);
      const reason = tokMsg
        ? `TOKEN EXPIRED · ${tokMsg}`
        : `Auth fail HTTP ${last.status} — re-login`;
      console.log(`[Ocean APP] ${label} STOP — ${reason}`);
      return {
        ...last,
        ok: false,
        reason,
      };
    }

    // Success path
    if (last.ok && !last.highLoad && kind === 'ok') {
      if (typeof retry.fatalIf === 'function' && retry.fatalIf(last)) {
        const msg = userFacingMappsFatal(last.data, label);
        console.log(`[Ocean APP] ${label} fatal — ${msg}`);
        return {
          ...last,
          ok: false,
          reason: String(msg),
        };
      }
      // Invalid station / no seats — never soft-retry
      if (
        isFatalStationError(last.data || last.text) ||
        /no seats?\s*available|not available|regret/i.test(
          String(last.data?.errorMessage || last.data?.errorMsg || '')
        )
      ) {
        const msg = isFatalStationError(last.data || last.text)
          ? String(
              last.data?.errorMessage ||
                last.data?.errorMsg ||
                'Invalid station code'
            ).slice(0, 48)
          : userFacingMappsFatal(last.data, label);
        console.log(`[Ocean APP] ${label} fatal — ${msg}`);
        return {
          ...last,
          ok: false,
          reason: String(msg),
        };
      }
      if (typeof retry.extraOk === 'function' && !retry.extraOk(last)) {
        // Soft miss (seat not open etc.) — reuse same sensor, no newconsume
        needFreshNext = false;
        const wait = delayMs + Math.floor(Math.random() * 400);
        if (onRetry) {
          onRetry({
            kind: 'soft',
            attempt: i + 1,
            delayMs: wait,
            status: last.status,
            label,
            message: 'waiting',
          });
        }
        console.log(`[Ocean APP] retry ${label} soft (${i + 1}/${max})`);
        await sleep(wait);
        continue;
      }
      return last;
    }

    // Fail / high-load / 510 / unable → next attempt gets newconsume
    needFreshNext = true;

    // 510 / Client IP — 12s × 3
    if (kind === 'ip510') {
      ip510Count += 1;
      console.log(
        `[Ocean APP] ${label} 510/Client IP ${ip510Count}/${ip510Max} — wait ${ip510DelayMs}ms`
      );
      if (onRetry) {
        onRetry({
          kind: 'ip510',
          attempt: ip510Count,
          delayMs: ip510DelayMs,
          status: last.status,
          label,
          message: 'Client IP / 510',
        });
      }
      if (ip510Count > ip510Max) {
        return {
          ...last,
          ok: false,
          reason: 'IP blocked by IRCTC (510)',
        };
      }
      await sleep(ip510DelayMs);
      continue;
    }

    // Unable to process — same cap as 510
    if (kind === 'unable') {
      unableCount += 1;
      console.log(
        `[Ocean APP] ${label} unable-to-process ${unableCount}/${unableMax} — wait ${unableDelayMs}ms`
      );
      if (onRetry) {
        onRetry({
          kind: 'unable',
          attempt: unableCount,
          delayMs: unableDelayMs,
          status: last.status,
          label,
          message: 'Unable to process',
        });
      }
      if (unableCount > unableMax) {
        return {
          ...last,
          ok: false,
          reason: 'Unable to process — stop after retries',
        };
      }
      await sleep(unableDelayMs);
      continue;
    }

    // High load / 511 / 403 / blocked HTML — keep polling
    const wait = randBetween(hlMin, hlMax);
    if (onRetry) {
      onRetry({
        kind: 'high_load',
        attempt: i + 1,
        delayMs: wait,
        status: last.status,
        label,
        message:
          last.data?.errorMessage ||
          (last.status === 511 ? '511 High Load' : 'High Load'),
      });
    }
    console.log(
      `[Ocean APP] retry ${label} high-load (${i + 1}/${max}) wait=${wait}ms`
    );
    await sleep(wait);
  }
  return last;
}

module.exports = {
  AUTH_BASE,
  APP_UA,
  sleep,
  appRequest,
  appRequestRetry,
  isHighLoad,
  isIp510Block,
  isMappsHighLoadBody,
  isMappsUnableBody,
  isFatalStationError,
  userFacingMappsFatal,
  classifyMappsResult,
  buildHeaders,
  IP510_RETRY_MAX,
  IP510_RETRY_DELAY_MS,
};
