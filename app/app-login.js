/**
 * APP2 HTTP login (STAR / SpaceX 4.3.12):
 *   appVersion → webmtoken → validateUser
 *
 * Sensor: login start pe newconsume → cache; success pe reuse;
 * webmtoken retry pe naya newconsume.
 */
const {
  encryptPasswordData,
  buildWebmtokenBasicAuth,
} = require('./app-crypto');
const appPair = require('./app-pair-session');

const AUTH_BASE = 'https://www.contents.irctc.co.in';
const APP_UA = 'IRCTC Rail Connect/4.3.12Android';
const APP_VERSION_PATH = 'Android/4.3.12';
const MAX_WEBM_RETRIES = 4;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(...args) {
  console.log('[Ocean APP]', ...args);
}

function logBlock(title, obj) {
  console.log(`\n========== ${title} ==========`);
  if (typeof obj === 'string') console.log(obj);
  else console.log(JSON.stringify(obj, null, 2));
  console.log('================================\n');
}

function redactHeaders(headers) {
  const out = { ...headers };
  if (out['X-acf-sensor-data']) {
    const s = String(out['X-acf-sensor-data']);
    out['X-acf-sensor-data'] = `[${s.length} chars] ${s.slice(0, 48)}…`;
  }
  if (out.Authorization) {
    const a = String(out.Authorization);
    if (a.toLowerCase().startsWith('bearer ')) {
      out.Authorization = `bearer ${a.slice(7, 27)}…`;
    } else if (a.toLowerCase().startsWith('basic ')) {
      out.Authorization = `Basic [${a.length - 6} chars]`;
    }
  }
  return out;
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
  const csrf = String(raw || '').trim();
  if (!csrf || csrf.length < 8) return null;
  const low = csrf.toLowerCase();
  if (
    low === 'mismatch' ||
    low.includes('mismatch') ||
    low === 'null' ||
    low === 'undefined'
  ) {
    return null;
  }
  if (![...csrf].some((c) => c >= '0' && c <= '9')) return null;
  sess.spaCsrf = csrf;
  log(`csrf-token → spa-csrf ${csrf.slice(0, 40)}…`);
  return csrf;
}

async function fetchJson(url, { method = 'GET', headers = {}, body = null, sess = null } = {}) {
  const undiciFetch = require('undici').fetch;
  const { appFetchDispatcherOpts } = require('./app-proxy');
  const extra = appFetchDispatcherOpts(sess);
  const opts = {
    method,
    headers,
    body,
    redirect: 'manual',
    ...extra,
  };
  const res = await (opts.dispatcher ? undiciFetch(url, opts) : fetch(url, opts));
  const text = await res.text();
  let json = null;
  if (text && text.trim()) {
    try {
      json = JSON.parse(text);
    } catch (_) {
      json = null;
    }
  }
  return { res, status: res.status, text, json };
}

/** Phase 1 — handshake (no sensor) */
async function callAppVersion(sess) {
  const url = `${AUTH_BASE}/eticketing/protected/mapps1/appVersion/${APP_VERSION_PATH}`;
  const headers = {
    Accept: 'application/json',
    greq: sess.uid,
    bmirak: 'androidbm',
    mup: sess.mup,
    'User-Agent': APP_UA,
    'Content-Type': 'application/json ; charset=UTF-8',
    'Content-Language': 'en',
  };
  const cookie = sess.jar.header();
  if (cookie) headers.Cookie = cookie;

  logBlock('APP VERSION REQUEST', {
    method: 'GET',
    url,
    headers: redactHeaders(headers),
    mup: sess.mup,
    greq: sess.uid,
  });

  const { res, status, text, json } = await fetchJson(url, { headers, sess });
  absorbCookies(sess.jar, res);
  captureCsrf(sess, res);

  logBlock('APP VERSION RESPONSE', {
    status,
    body: json || text?.slice?.(0, 400) || '(empty)',
    cookies: sess.jar.toJSON(),
  });

  return status === 200;
}

function formatLoginError(loginJson) {
  if (!loginJson) return 'APP LOGIN FAIL';
  const desc = String(
    loginJson.error_description || loginJson.error || loginJson.message || ''
  ).trim();
  if (!desc) return 'APP LOGIN FAIL';
  const low = desc.toLowerCase();
  if (low.includes('incorrect username') || low.includes('incorrect password')) {
    return 'WRONG ID/PASSWORD';
  }
  if (low.includes('captcha')) return 'INVALID CAPTCHA';
  if (desc.length > 80) return desc.slice(0, 77) + '…';
  return desc;
}

/**
 * Phase 2 — webmtoken
 * @param {string} sensorData fresh from newconsume — used only on this request
 */
async function callWebmtoken(sess, userId, password, sensorData) {
  const captcha = 'NA';
  const enc = encryptPasswordData(userId, password, captcha, sess.uid);

  // STAR HAR body order
  const body = new URLSearchParams();
  body.set('grant_type', 'password');
  body.set('data', enc.data);
  body.set('captcha', captcha);
  body.set('uid', sess.uid);
  body.set('otpLogin', 'false');
  body.set('lso', '');
  body.set('encodedPwd', 'true');

  // STAR 4.3.12 HAR: Basic auth, NO greq header
  const headers = {
    'Accept-Encoding': 'gzip',
    Authorization: buildWebmtokenBasicAuth(userId, password),
    bmirak: 'androidbm',
    'Content-Language': 'en',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    mup: sess.mup,
    'User-Agent': APP_UA,
    'X-acf-sensor-data': sensorData,
  };
  const cookie = sess.jar.header();
  if (cookie) headers.Cookie = cookie;

  const url = `${AUTH_BASE}/authprovider/webmtoken`;

  logBlock('WEBMTOKEN REQUEST', {
    url,
    headers: redactHeaders(headers),
    body: {
      grant_type: 'password',
      data: `[${enc.data.length} chars] ${enc.data.slice(0, 40)}…`,
      captcha,
      uid: sess.uid,
      otpLogin: 'false',
      lso: '',
      encodedPwd: 'true',
    },
    crypto: {
      keySeed: enc.keySeed,
      plaintext: enc.plaintext.replace(
        /#UP#[^#]+#UP#/,
        '#UP#<b64pwd>#UP#'
      ),
    },
  });

  const { res, status, json, text } = await fetchJson(url, {
    method: 'POST',
    headers,
    body: body.toString(),
    sess,
  });
  absorbCookies(sess.jar, res);
  captureCsrf(sess, res);

  const bodyPreview =
    json ||
    (text && text.trim() ? text.slice(0, 600) : '(empty)');

  logBlock('WEBMTOKEN RESPONSE', {
    status,
    hasAccessToken: Boolean(json?.access_token),
    body: bodyPreview,
    cookies: sess.jar.toJSON(),
    spaCsrf: sess.spaCsrf || '',
  });

  if (status === 200 && json?.access_token) {
    return { ok: true, tokens: json };
  }
  return {
    ok: false,
    status,
    reason: formatLoginError(json) || `HTTP ${status}`,
    raw: json || text?.slice?.(0, 400),
  };
}

/**
 * Phase 3 — validateUser source=8
 * @param {string} sensorData fresh from newconsume
 */
async function callValidateUser(sess, sensorData) {
  const token = sess.tokens?.access_token;
  if (!token) return { ok: false, reason: 'No access_token' };

  const url = `${AUTH_BASE}/eticketing/protected/mapps1/validateUser?source=8`;
  const headers = {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip',
    Authorization: `bearer ${token}`,
    bmirak: 'androidbm',
    'Content-Language': 'en',
    'Content-Type': 'application/json ; charset=UTF-8',
    'spa-csrf-token': sess.spaCsrf || '',
    greq: sess.uid,
    mup: sess.mup,
    'User-Agent': APP_UA,
    'X-acf-sensor-data': sensorData,
  };
  const cookie = sess.jar.header();
  if (cookie) headers.Cookie = cookie;

  logBlock('VALIDATEUSER REQUEST', {
    url,
    headers: redactHeaders(headers),
  });

  const { res, status, json, text } = await fetchJson(url, { headers, sess });
  absorbCookies(sess.jar, res);
  captureCsrf(sess, res);

  logBlock('VALIDATEUSER RESPONSE', {
    status,
    body: json || text?.slice?.(0, 400) || '(empty)',
  });

  if (status !== 200 || !json) {
    return {
      ok: false,
      status,
      reason: `validateUser HTTP ${status}`,
      raw: json || text?.slice?.(0, 400),
    };
  }
  return { ok: true, profile: json };
}

async function performAppLogin({ sessionId, username, password, onStatus } = {}) {
  const status = (msg) => {
    try {
      if (typeof onStatus === 'function') onStatus(msg);
    } catch (_) {}
    log(msg);
  };

  const sess = appPair.getAppSession(sessionId);
  if (!sess) return { ok: false, reason: 'No APP session' };
  const user = String(username || '').trim();
  const pass = String(password || '');
  if (!user || !pass) return { ok: false, reason: 'Missing IRCTC credentials' };

  log(
    `login start user=${user} mup=${sess.mup} uid=${sess.uid} sensorUser=${sess.sensorUserId}`
  );

  status('APP · appVersion…');
  let connected = false;
  try {
    connected = await callAppVersion(sess);
  } catch (e) {
    log('appVersion EXCEPTION', e.message || e);
    return { ok: false, reason: `appVersion: ${e.message || e}` };
  }
  if (!connected) {
    return { ok: false, reason: 'appVersion fail' };
  }

  // Seed sensor cache once for this APP run
  status('APP · sensor cache…');
  const seed = await appPair.refreshSessionSensor(sess);
  if (!seed.ok) {
    return { ok: false, reason: seed.reason || 'No sensor' };
  }

  let loginResult = null;
  for (let attempt = 1; attempt <= MAX_WEBM_RETRIES; attempt++) {
    status(
      attempt === 1
        ? 'APP · webmtoken…'
        : `APP · webmtoken retry ${attempt}/${MAX_WEBM_RETRIES}`
    );

    // attempt 1 → reuse cache; retry → newconsume + replace cache
    let sens;
    if (attempt === 1) {
      sens = await appPair.ensureCachedSensor(sess);
    } else {
      status('APP · newconsume (retry)…');
      sens = await appPair.refreshSessionSensor(sess);
    }
    if (!sens.ok) {
      log('sensor fail for webmtoken', sens.reason);
      return { ok: false, reason: sens.reason || 'No sensor' };
    }

    try {
      loginResult = await callWebmtoken(sess, user, pass, sens.sensor);
    } catch (e) {
      log('webmtoken EXCEPTION', e.message || e);
      loginResult = { ok: false, reason: e.message || 'webmtoken exception' };
    }
    if (loginResult.ok) break;
    log(`webmtoken attempt ${attempt} fail:`, loginResult.reason, loginResult.raw);
    await sleep(800);
  }

  if (!loginResult?.ok) {
    return {
      ok: false,
      reason: loginResult?.reason || 'webmtoken fail',
      raw: loginResult?.raw,
    };
  }

  appPair.setSessionTokens(sessionId, loginResult.tokens);
  status('APP · validateUser…');

  // Success path — reuse same cached sensor (no newconsume)
  const sens2 = await appPair.ensureCachedSensor(sess);
  if (!sens2.ok) {
    log('validateUser sensor missing:', sens2.reason);
    return {
      ok: false,
      reason: sens2.reason || 'No sensor for validateUser',
      tokens: loginResult.tokens,
      validated: false,
    };
  }

  let vu;
  try {
    vu = await callValidateUser(sess, sens2.sensor);
  } catch (e) {
    log('validateUser EXCEPTION', e.message || e);
    return {
      ok: false,
      reason: e.message || 'validateUser exception',
      tokens: loginResult.tokens,
      validated: false,
    };
  }

  // validateUser fail → one refresh + single retry
  if (!vu.ok) {
    log('validateUser fail — refresh sensor + retry once:', vu.reason);
    status('APP · newconsume (validateUser retry)…');
    const sens3 = await appPair.refreshSessionSensor(sess);
    if (sens3.ok) {
      try {
        vu = await callValidateUser(sess, sens3.sensor);
      } catch (e) {
        return {
          ok: false,
          reason: e.message || 'validateUser exception',
          tokens: loginResult.tokens,
          validated: false,
        };
      }
    }
  }

  if (!vu.ok) {
    log('validateUser fail:', vu.reason, vu.raw);
    return {
      ok: false,
      reason: vu.reason || 'validateUser fail',
      raw: vu.raw,
      tokens: loginResult.tokens,
      validated: false,
    };
  }

  sess.profile = vu.profile;
  status('APP LOGIN OK');
  return {
    ok: true,
    tokens: loginResult.tokens,
    validated: true,
    profile: vu.profile,
  };
}

module.exports = {
  performAppLogin,
  callAppVersion,
  callWebmtoken,
  callValidateUser,
  APP_UA,
};
