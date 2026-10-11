/**
 * Per-pair APP session: mock mup/uid + cookie jar + tokens + sensor.
 * One pair = one device fingerprint for the whole run.
 */
const { createMockAppDevice } = require('./app-device');
const sensorClient = require('./sensor-client');

/** @type {Map<string, object>} sessionId → app session */
const sessions = new Map();

function pairKey(journeyId, pairIndex) {
  return `${journeyId || ''}::${pairIndex || 1}`;
}

/** @type {Map<string, string>} journey::pair → sessionId */
const pairToSession = new Map();

function createCookieJar() {
  /** @type {Map<string, string>} */
  const map = new Map();
  return {
    /** @param {string|string[]} setCookie */
    absorb(setCookie) {
      const list = Array.isArray(setCookie)
        ? setCookie
        : setCookie
          ? [setCookie]
          : [];
      for (const line of list) {
        const part = String(line || '').split(';')[0];
        const eq = part.indexOf('=');
        if (eq <= 0) continue;
        const name = part.slice(0, eq).trim();
        const value = part.slice(eq + 1).trim();
        if (name) map.set(name, value);
      }
    },
    header() {
      if (!map.size) return '';
      return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    clear() {
      map.clear();
    },
    toJSON() {
      return Object.fromEntries(map);
    },
  };
}

/**
 * Create / replace APP session for a run.
 */
function createAppSession({ sessionId, journeyId, pairIndex, userId } = {}) {
  if (!sessionId) throw new Error('sessionId required');
  const device = createMockAppDevice();
  const jar = createCookieJar();
  const sess = {
    sessionId,
    journeyId: journeyId || '',
    pairIndex: Math.max(1, Number(pairIndex) || 1),
    mup: device.mup,
    /** greq header + webmtoken uid (same af… id for whole run) */
    uid: device.uid,
    jar,
    tokens: null,
    spaCsrf: '',
    profile: null,
    sensor: null,
    sensorUserId: userId || sensorClient.resolveUserId(),
    createdAt: Date.now(),
  };
  sessions.set(sessionId, sess);
  if (journeyId) {
    pairToSession.set(pairKey(journeyId, sess.pairIndex), sessionId);
  }
  console.log(
    `[Ocean APP] session ${sessionId.slice(0, 8)}… pair=${sess.pairIndex} mup=${sess.mup} uid=${sess.uid.slice(0, 18)}…`
  );
  return sess;
}

function getAppSession(sessionId) {
  return sessionId ? sessions.get(sessionId) || null : null;
}

function getAppSessionForPair(journeyId, pairIndex) {
  const sid = pairToSession.get(pairKey(journeyId, pairIndex));
  return sid ? getAppSession(sid) : null;
}

function destroyAppSession(sessionId) {
  const sess = sessions.get(sessionId);
  if (!sess) return;
  try {
    const { detachAppProxy } = require('./app-proxy');
    detachAppProxy(sess).catch(() => {});
  } catch (_) {}
  sessions.delete(sessionId);
  if (sess.journeyId) {
    const pk = pairKey(sess.journeyId, sess.pairIndex);
    if (pairToSession.get(pk) === sessionId) pairToSession.delete(pk);
  }
}

/**
 * Base APP headers (HAR-matched). Sensor optional until consumed.
 */
function buildAppHeaders(sess, { withSensor = false, extra = {} } = {}) {
  if (!sess) throw new Error('APP session missing');
  const headers = {
    'User-Agent': 'IRCTC Rail Connect/4.3.12Android',
    Accept: 'application/json',
    'Content-Type': 'application/json ; charset=UTF-8',
    'Accept-Encoding': 'gzip',
    bmirak: 'androidbm',
    'Content-Language': 'en',
    greq: sess.uid,
    mup: sess.mup,
    ...extra,
  };
  const cookie = sess.jar.header();
  if (cookie) headers.Cookie = cookie;
  if (withSensor && sess.sensor) {
    headers['X-acf-sensor-data'] = sess.sensor;
  }
  if (sess.spaCsrf) {
    headers['spa-csrf-token'] = sess.spaCsrf;
  }
  if (sess.tokens?.access_token) {
    headers.Authorization = `bearer ${sess.tokens.access_token}`;
  }
  if (sess.tokens?.refresh_token) {
    headers.bmiyek = sess.tokens.refresh_token;
  }
  return headers;
}

/** Tokens shape for browser Direct inject (webbm path). */
function getBrowserAuthBag(sessionId) {
  const sess = getAppSession(sessionId);
  if (!sess?.tokens?.access_token) return null;
  return {
    access_token: sess.tokens.access_token,
    refresh_token: sess.tokens.refresh_token || '',
    greq: sess.uid,
    csrf: sess.spaCsrf || '',
  };
}

/**
 * Fresh newconsume → replace sess.sensor cache.
 * Use on: APP login start, and any retry/fail path.
 */
async function refreshSessionSensor(sessOrId) {
  const sess =
    typeof sessOrId === 'string' ? getAppSession(sessOrId) : sessOrId;
  if (!sess) return { ok: false, reason: 'No APP session' };
  const got = await sensorClient.consumeSensor(sess.sensorUserId);
  if (!got.ok) return got;
  sess.sensor = got.sensor;
  console.log('[Ocean Sensor] cache SET (newconsume)');
  return { ok: true, sensor: got.sensor, reused: false };
}

/**
 * Reuse sess.sensor if present; otherwise newconsume once and cache.
 * Use on: success-path / first attempt of a mapps call.
 */
async function ensureCachedSensor(sessOrId) {
  const sess =
    typeof sessOrId === 'string' ? getAppSession(sessOrId) : sessOrId;
  if (!sess) return { ok: false, reason: 'No APP session' };
  if (sess.sensor && String(sess.sensor).trim()) {
    console.log(
      `[Ocean Sensor] cache REUSE len=${String(sess.sensor).length}`
    );
    return { ok: true, sensor: sess.sensor, reused: true };
  }
  return refreshSessionSensor(sess);
}

/**
 * @param {string} sessionId
 * @param {{ forceFresh?: boolean }} [opts] forceFresh=true → newconsume (retry)
 */
async function takeSensorForSession(sessionId, { forceFresh = false } = {}) {
  const sess = getAppSession(sessionId);
  if (!sess) return { ok: false, reason: 'No APP session' };
  if (forceFresh) return refreshSessionSensor(sess);
  return ensureCachedSensor(sess);
}

/** @deprecated use takeSensorForSession / ensureCachedSensor */
async function takeFreshSensorForSession(sessionId) {
  return refreshSessionSensor(sessionId);
}

/** @deprecated */
async function ensureSessionSensor(sessionId, { force = false } = {}) {
  return takeSensorForSession(sessionId, { forceFresh: force });
}

function setSessionTokens(sessionId, tokens) {
  const sess = getAppSession(sessionId);
  if (!sess) return;
  sess.tokens = tokens || null;
}

module.exports = {
  createAppSession,
  getAppSession,
  getAppSessionForPair,
  destroyAppSession,
  buildAppHeaders,
  ensureSessionSensor,
  takeFreshSensorForSession,
  takeSensorForSession,
  ensureCachedSensor,
  refreshSessionSensor,
  setSessionTokens,
  getBrowserAuthBag,
  createCookieJar,
};
