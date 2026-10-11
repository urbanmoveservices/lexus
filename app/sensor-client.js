/**
 * Sensor queue — api.startstoken.com
 * userId = license key (e.g. OCEAN1).
 *
 * APP session policy (see app-pair-session):
 *  - login start → newconsume once → cache on sess.sensor
 *  - success path → reuse cache (no newconsume)
 *  - retry / fail (high load, unable, 510, …) → newconsume → replace cache
 */
const LICENSE_URL_USER = process.env.OCEAN_SENSOR_USER || null;
const BASE = process.env.OCEAN_SENSOR_BASE || 'https://api.startstoken.com';

function resolveUserId(explicit) {
  if (explicit) return String(explicit).trim();
  if (LICENSE_URL_USER) return String(LICENSE_URL_USER).trim();
  try {
    const licenseGate = require('./license-gate');
    const saved = licenseGate.getSavedLicense();
    if (saved.key) return saved.key;
  } catch (_) {}
  return 'OCEAN1';
}

async function getJson(url) {
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch (_) {
    body = { raw: text };
  }
  return { status: res.status, ok: res.ok, body };
}

/** Queue count — does not delete */
async function checkSensors(userId) {
  const uid = resolveUserId(userId);
  const { status, ok, body } = await getJson(
    `${BASE}/check?userId=${encodeURIComponent(uid)}`
  );
  return {
    httpOk: ok,
    status,
    userId: uid,
    count: Number(body?.count) || 0,
    has_sensors: Boolean(body?.has_sensors),
    raw: body,
  };
}

/** Consume 1 sensor from queue (newconsume) */
async function consumeSensor(userId) {
  const uid = resolveUserId(userId);
  const url = `${BASE}/newconsume?userId=${encodeURIComponent(uid)}`;
  console.log(`[Ocean Sensor] newconsume userId=${uid}`);
  const { status, ok, body } = await getJson(url);
  const sensor = body?.sensor != null ? String(body.sensor) : '';
  if (!ok || !body?.ok || !sensor) {
    console.warn('[Ocean Sensor] newconsume FAIL', status, body);
    return {
      ok: false,
      userId: uid,
      status,
      reason: body?.message || body?.error || 'No sensor returned',
      raw: body,
    };
  }
  console.log(
    `[Ocean Sensor] newconsume OK len=${sensor.length} preview=${sensor.slice(0, 40)}…`
  );
  return {
    ok: true,
    userId: uid,
    sensor,
    status,
    raw: body,
  };
}

/** Clear entire sensor queue for userId (server) */
async function clearTokens(userId) {
  const uid = resolveUserId(userId);
  const url = `${BASE}/cleartoken?userId=${encodeURIComponent(uid)}`;
  console.log(`[Ocean Sensor] cleartoken userId=${uid}`);
  const { status, ok, body } = await getJson(url);
  if (!ok || body?.ok === false) {
    return {
      ok: false,
      userId: uid,
      status,
      reason: body?.message || body?.error || 'Clear failed',
      raw: body,
    };
  }
  return {
    ok: true,
    userId: uid,
    status,
    cleared: Number(body?.cleared) || 0,
    remaining: Number(body?.remaining) || 0,
    message: body?.message || 'tokens cleared',
    raw: body,
  };
}

/** Always newconsume (session cache is managed by app-pair-session). */
async function takeFreshSensor(userId) {
  return consumeSensor(userId);
}

/** @deprecated prefer session cache helpers in app-pair-session */
async function takeSensor({ userId, cached } = {}) {
  if (cached && String(cached).trim()) {
    return { ok: true, sensor: String(cached).trim(), reused: true };
  }
  return takeFreshSensor(userId);
}

module.exports = {
  checkSensors,
  consumeSensor,
  clearTokens,
  takeFreshSensor,
  takeSensor,
  resolveUserId,
};
