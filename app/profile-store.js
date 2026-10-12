/**
 * SQLite profile store (sql.js WASM — no native rebuild).
 * DB file: userData/lexus-data/lexus.sqlite
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const initSqlJs = require('sql.js');

let db = null;
let dbPath = '';
let keyPath = '';
let readyPromise = null;
let workspaceDataRoot=null;
let workspaceTransition=Promise.resolve();

function ensureDirs() {
  const root = workspaceDataRoot||app.getPath('userData');
  const dir = path.join(root, 'lexus-data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  dbPath = path.join(dir, 'lexus.sqlite');
  keyPath = path.join(dir, '.lexus-key');
  migrateLegacyStore(root);
}

/** One-time copy from the pre-rename store (ocean-data/ocean.sqlite + .ocean-key). Legacy files are kept as a backup. */
function migrateLegacyStore(root) {
  try {
    if (fs.existsSync(dbPath)) return;
    const legacyDir = path.join(root, 'ocean-data');
    const legacyDb = path.join(legacyDir, 'ocean.sqlite');
    if (!fs.existsSync(legacyDb)) return;
    // Key and database must move together or encrypted fields become unreadable.
    const legacyKey = path.join(legacyDir, '.ocean-key');
    if (fs.existsSync(legacyKey)) fs.copyFileSync(legacyKey, keyPath);
    fs.copyFileSync(legacyDb, dbPath);
  } catch (e) {
    console.warn('[LEXUS] legacy data migration failed:', e && e.message ? e.message : e);
  }
}

function getOrCreateKey() {
  ensureDirs();
  if (fs.existsSync(keyPath)) {
    return Buffer.from(fs.readFileSync(keyPath, 'utf8').trim(), 'hex');
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyPath, key.toString('hex'), { encoding: 'utf8', mode: 0o600 });
  return key;
}

function encrypt(plain) {
  if (plain == null || plain === '') return '';
  const key = getOrCreateKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decrypt(payload) {
  if (!payload || typeof payload !== 'string') return '';
  if (!payload.startsWith('v1:')) return payload;
  try {
    const [, ivHex, tagHex, dataHex] = payload.split(':');
    const key = getOrCreateKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return '';
  }
}

function uid() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

function persist() {
  if (!db || !dbPath) return;
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

function migrate() {
  db.run(`
    CREATE TABLE IF NOT EXISTS journeys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT,
      from_station TEXT,
      to_station TEXT,
      date TEXT,
      train_no TEXT,
      class TEXT,
      quota TEXT,
      boarding TEXT,
      availability_check TEXT,
      slbooktime TEXT,
      acbooktime TEXT,
      gnbooktime TEXT,
      passengers_json TEXT,
      infants_json TEXT,
      contact_mobile TEXT,
      contact_email TEXT,
      options_json TEXT
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS credentials (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT,
      password_enc TEXT,
      status TEXT DEFAULT 'ACTIVE',
      created_at TEXT,
      updated_at TEXT
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      payment_method TEXT,
      backup_payment_method TEXT,
      vpa_enc TEXT,
      cardnumber_enc TEXT,
      cardexpiry_enc TEXT,
      cardcvv_enc TEXT,
      cardholder_enc TEXT,
      created_at TEXT,
      updated_at TEXT
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS ui_state (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS booking_history (
      id TEXT PRIMARY KEY,
      created_at TEXT,
      pnr TEXT,
      train_no TEXT,
      train_name TEXT,
      from_station TEXT,
      to_station TEXT,
      journey_date TEXT,
      class TEXT,
      quota TEXT,
      credential_name TEXT,
      engine TEXT,
      mode TEXT,
      journey_name TEXT,
      notes TEXT,
      ticket_name TEXT,
      user_id TEXT,
      bank_name TEXT,
      fare TEXT,
      booking_date TEXT
    );
  `);
  const historyAlters = [
    'ALTER TABLE booking_history ADD COLUMN ticket_name TEXT',
    'ALTER TABLE booking_history ADD COLUMN user_id TEXT',
    'ALTER TABLE booking_history ADD COLUMN bank_name TEXT',
    'ALTER TABLE booking_history ADD COLUMN fare TEXT',
    'ALTER TABLE booking_history ADD COLUMN booking_date TEXT',
  ];
  for (const sql of historyAlters) {
    try {
      db.run(sql);
    } catch {
      /* already exists */
    }
  }
  try {
    db.run(`ALTER TABLE journeys ADD COLUMN options_json TEXT`);
  } catch {
    /* already exists */
  }
  try {
    db.run(`ALTER TABLE credentials ADD COLUMN status TEXT DEFAULT 'ACTIVE'`);
  } catch {
    /* already exists */
  }
  try {
    db.run(
      `UPDATE credentials SET status = 'ACTIVE' WHERE status IS NULL OR TRIM(status) = ''`
    );
  } catch {
    /* ignore */
  }
}

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params && params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows[0] || null;
}

function run(sql, params = []) {
  db.run(sql, params);
  persist();
}

function sqlWasmLocate(file) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist', file);
  }
  return path.join(__dirname, 'node_modules', 'sql.js', 'dist', file);
}

async function init() {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    ensureDirs();
    const SQL = await initSqlJs({
      locateFile: sqlWasmLocate,
    });
    if (fs.existsSync(dbPath)) {
      const fileBuffer = fs.readFileSync(dbPath);
      db = new SQL.Database(fileBuffer);
    } else {
      db = new SQL.Database();
    }
    migrate();
    persist();
    return true;
  })();
  return readyPromise;
}

function assertReady() {
  if (!db) throw new Error('Profile store not initialized. Call init() first.');
}

function mapJourney(row) {
  if (!row) return null;
  let passengers = [];
  let infants = [];
  let options = {};
  try {
    passengers = JSON.parse(row.passengers_json || '[]');
  } catch {
    passengers = [];
  }
  try {
    infants = JSON.parse(row.infants_json || '[]');
  } catch {
    infants = [];
  }
  try {
    options = JSON.parse(row.options_json || '{}') || {};
  } catch {
    options = {};
  }
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    from: row.from_station || '',
    to: row.to_station || '',
    date: row.date || '',
    trainNo: row.train_no || '',
    class: row.class || '',
    quota: row.quota || 'GN',
    boarding: row.boarding || '',
    availabilityCheck: row.availability_check || '',
    slbooktime: row.slbooktime || '10:59:59',
    acbooktime: row.acbooktime || '09:59:59',
    gnbooktime: row.gnbooktime || '07:59:59',
    passengers,
    infants,
    options,
    contact: {
      mobile: row.contact_mobile || '',
      email: row.contact_email || '',
    },
  };
}

function listSummaries(kind) {
  assertReady();
  if (kind === 'credentials') {
    return queryAll(
      `SELECT id, name, username, status, updated_at AS updatedAt, created_at AS createdAt
       FROM credentials ORDER BY datetime(updated_at) DESC`
    ).map((r) => ({
      id: r.id,
      name: r.name,
      username: r.username || '',
      status: normalizeCredentialStatus(r.status),
      updatedAt: r.updatedAt || r.createdAt,
    }));
  }
  if (kind === 'payments') {
    return queryAll(
      `SELECT id, name, payment_method AS paymentMethod, vpa_enc AS vpaEnc,
              updated_at AS updatedAt, created_at AS createdAt
       FROM payments ORDER BY datetime(updated_at) DESC`
    ).map((r) => {
      const vpa = decrypt(r.vpaEnc || '').trim();
      return {
        id: r.id,
        name: r.name,
        paymentMethod: r.paymentMethod || '',
        vpa,
        updatedAt: r.updatedAt || r.createdAt,
      };
    });
  }
  return queryAll(
    `SELECT id, name, from_station AS "from", to_station AS "to", date, train_no AS trainNo,
            class, quota, options_json, updated_at AS updatedAt, created_at AS createdAt
     FROM journeys ORDER BY datetime(updated_at) DESC`
  ).map((r) => {
    let options = {};
    try {
      options = JSON.parse(r.options_json || '{}') || {};
    } catch {
      options = {};
    }
    return {
      id: r.id,
      name: r.name,
      from: r.from || '',
      to: r.to || '',
      date: r.date || '',
      trainNo: r.trainNo || '',
      class: r.class || '',
      quota: r.quota || 'GN',
      options,
      updatedAt: r.updatedAt || r.createdAt,
    };
  });
}

function getJourney(id) {
  assertReady();
  return mapJourney(queryOne(`SELECT * FROM journeys WHERE id = ?`, [id]));
}

function normalizeCredentialStatus(status) {
  const s = String(status || 'ACTIVE').trim().toUpperCase();
  return s || 'ACTIVE';
}

function isCredentialActive(cred) {
  return normalizeCredentialStatus(cred?.status) === 'ACTIVE';
}

function listActiveCredentials() {
  return listSummaries('credentials').filter(isCredentialActive);
}

function getCredential(id, { includeSecrets = false } = {}) {
  assertReady();
  const row = queryOne(`SELECT * FROM credentials WHERE id = ?`, [id]);
  if (!row) return null;
  const out = {
    id: row.id,
    name: row.name,
    username: row.username || '',
    status: normalizeCredentialStatus(row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (includeSecrets) out.password = decrypt(row.password_enc || '');
  return out;
}

function getPayment(id, { includeSecrets = false } = {}) {
  assertReady();
  const row = queryOne(`SELECT * FROM payments WHERE id = ?`, [id]);
  if (!row) return null;
  const out = {
    id: row.id,
    name: row.name,
    paymentMethod: row.payment_method || '',
    backupPaymentMethod: row.backup_payment_method || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (includeSecrets) {
    out.vpa = decrypt(row.vpa_enc || '');
    out.cardnumber = decrypt(row.cardnumber_enc || '');
    out.cardexpiry = decrypt(row.cardexpiry_enc || '');
    out.cardcvv = decrypt(row.cardcvv_enc || '');
    out.cardholder = decrypt(row.cardholder_enc || '');
  } else {
    out.vpaMasked = row.vpa_enc ? '••••' : '';
    out.hasCard = Boolean(row.cardnumber_enc);
  }
  return out;
}

function getUiState() {
  assertReady();
  const rows = queryAll(`SELECT key, value FROM ui_state`);
  const ui = {
    selectedJourneyId: null,
    selectedCredentialId: null,
    selectedPaymentId: null,
    trueCaptchaEnabled: '1',
    trueCaptchaUserId: '',
    trueCaptchaApiKey: '',
    manualLoginEnabled: '0',
    proxyEnabled: '0',
    proxyType: 'http',
    proxyHost: '',
    proxyPort: '',
    proxyUsername: '',
    proxyPassword: '',
    /** JSON array of { id, type, host, port, username, passwordEnc } */
    proxiesJson: '[]',
    // License gate (persist across launches)
    licenceKey: '',
    licenceName: '',
    licenceMachine: '',
    licenceOkAt: '',
    licenceLeftDays: '',
    licenceNews: '',
    licenceShortMessage: '',
  };
  for (const r of rows) {
    if (Object.prototype.hasOwnProperty.call(ui, r.key)) {
      ui[r.key] = r.value == null ? '' : r.value;
    }
  }
  // Normalize selection ids (empty string → null)
  for (const k of ['selectedJourneyId', 'selectedCredentialId', 'selectedPaymentId']) {
    if (!ui[k]) ui[k] = null;
  }
  return ui;
}

/** TrueCaptcha for login/booking when IRCTC actually sends a captcha image. */
function getTrueCaptchaCredentials() {
  const ui = getUiState();
  const userId = String(ui.trueCaptchaUserId || (process.env.LEXUS_TRUECAPTCHA_USER || process.env.OCEAN_TRUECAPTCHA_USER) || '').trim();
  const apiKeyRaw = String(ui.trueCaptchaApiKey || (process.env.LEXUS_TRUECAPTCHA_KEY || process.env.OCEAN_TRUECAPTCHA_KEY) || '').trim();
  const apiKey = apiKeyRaw.startsWith('v1:') ? decrypt(apiKeyRaw) : apiKeyRaw;
  const enabledFlag = String(ui.trueCaptchaEnabled ?? '1') !== '0';
  const enabled = enabledFlag && Boolean(userId && apiKey);
  return { enabled, userId, apiKey };
}

function setTrueCaptchaCredentials({ enabled, userId, apiKey } = {}) {
  assertReady();
  const current = getTrueCaptchaCredentials();
  const patch = {};
  if (enabled !== undefined) patch.trueCaptchaEnabled = enabled ? '1' : '0';
  if (userId !== undefined) patch.trueCaptchaUserId = String(userId || '').trim();
  if (apiKey !== undefined) {
    const raw = String(apiKey || '').trim();
    if (!raw) {
      // Keep existing key if UI cleared/placeholder
      patch.trueCaptchaApiKey = current.apiKey ? encrypt(current.apiKey) : '';
    } else if (raw.startsWith('v1:')) {
      patch.trueCaptchaApiKey = raw;
    } else {
      patch.trueCaptchaApiKey = encrypt(raw);
    }
  }
  setUiState(patch);
  return getTrueCaptchaCredentials();
}

/** Booking proxy (HTTP / SOCKS5). Password encrypted at rest. Settings = save only; panel picks IP mode. */
function getProxyConfig(opts = {}) {
  const wantId = opts?.proxyId ? String(opts.proxyId).trim() : '';
  const list = listProxies();
  if (list.length) {
    let p = wantId ? list.find((e) => e.id === wantId) : null;
    if (!p) p = list[0];
    const { parseStoredProxy, hasStoredProxyData } = require('./proxy-util');
    const stored = parseStoredProxy({
      type: p.type || 'http',
      host: p.host || '',
      port: p.port || '',
      username: p.username || '',
      password: p.password || '',
    });
    const configured = hasStoredProxyData(stored);
    return { ...stored, configured, enabled: configured };
  }
  const ui = getUiState();
  const passwordRaw = String(ui.proxyPassword || '').trim();
  const password = passwordRaw.startsWith('v1:') ? decrypt(passwordRaw) : passwordRaw;
  const { parseStoredProxy, hasStoredProxyData } = require('./proxy-util');
  const stored = parseStoredProxy({
    type: ui.proxyType || 'http',
    host: ui.proxyHost || '',
    port: ui.proxyPort || '',
    username: ui.proxyUsername || '',
    password,
  });
  const configured = hasStoredProxyData(stored);
  return { ...stored, configured, enabled: configured };
}

function proxyEntryKey(p) {
  return `${String(p.host || '').toLowerCase()}|${p.port}|${String(p.username || '').toLowerCase()}`;
}

function readProxiesJson() {
  const ui = getUiState();
  let list = [];
  try {
    list = JSON.parse(ui.proxiesJson || '[]');
  } catch {
    list = [];
  }
  return Array.isArray(list) ? list : [];
}

function writeProxiesJson(rawList) {
  setUiState({ proxiesJson: JSON.stringify(rawList || []) });
  syncLegacyProxyFromList(rawList || []);
}

function syncLegacyProxyFromList(rawList) {
  const first = rawList[0];
  if (!first || !first.host) {
    setUiState({
      proxyType: 'http',
      proxyHost: '',
      proxyPort: '',
      proxyUsername: '',
      proxyPassword: '',
    });
    return;
  }
  setUiState({
    proxyType: String(first.type || 'http').trim().toLowerCase() || 'http',
    proxyHost: String(first.host || ''),
    proxyPort: first.port != null ? String(first.port) : '',
    proxyUsername: String(first.username || ''),
    proxyPassword: first.passwordEnc || '',
  });
}

function migrateLegacyProxyIntoList() {
  let raw = readProxiesJson();
  if (raw.length) return raw;
  const ui = getUiState();
  if (!String(ui.proxyHost || '').trim() || !String(ui.proxyPort || '').trim()) return raw;
  const passwordRaw = String(ui.proxyPassword || '').trim();
  const passwordEnc = passwordRaw
    ? passwordRaw.startsWith('v1:')
      ? passwordRaw
      : encrypt(passwordRaw)
    : '';
  raw = [
    {
      id: uid(),
      type: String(ui.proxyType || 'http').trim().toLowerCase() || 'http',
      host: String(ui.proxyHost || '').trim(),
      port: String(ui.proxyPort || '').trim(),
      username: String(ui.proxyUsername || '').trim(),
      passwordEnc,
    },
  ];
  writeProxiesJson(raw);
  return raw;
}

/** Decrypted list for UI / test / booking primary. */
function listProxies() {
  assertReady();
  const raw = migrateLegacyProxyIntoList();
  return raw.map((e) => ({
    id: e.id,
    type: e.type || 'http',
    host: e.host || '',
    port: e.port || '',
    username: e.username || '',
    password: e.passwordEnc ? decrypt(e.passwordEnc) : '',
  }));
}

/** Panel label: Proxy1, Proxy2, … */
function getProxyLabel(proxyId) {
  const list = listProxies();
  if (!list.length) return 'Proxy';
  const idx = list.findIndex((p) => p.id === proxyId);
  if (idx >= 0) return `Proxy${idx + 1}`;
  return `Proxy${list.length}`;
}

function listProxiesForPanel() {
  return listProxies().map((p, i) => ({
    id: p.id,
    label: `Proxy${i + 1}`,
    host: p.host || '',
    port: p.port || '',
    type: p.type || 'http',
  }));
}

function updateJourneyIpChoice(journeyId, { ipMode, proxyId } = {}) {
  assertReady();
  const journey = getJourney(journeyId);
  if (!journey) return null;
  const mode = ipMode === 'proxy' ? 'proxy' : 'auto';
  const options = {
    ...(journey.options || {}),
    ipMode: mode,
    proxyId: mode === 'proxy' && proxyId ? String(proxyId) : null,
  };
  return saveJourney({ id: journeyId, options });
}

function addProxyFromString(hostString) {
  assertReady();
  const { parseStoredProxy, validateProxyHost, expandStarProxyPaste } = require('./proxy-util');
  const hostRaw = String(hostString || '').trim();
  if (!hostRaw) {
    const err = new Error('Proxy string paste karo');
    err.code = 'PROXY_INVALID';
    throw err;
  }
  const preview = parseStoredProxy(expandStarProxyPaste({ type: 'http', host: hostRaw }));
  if (!preview.host || !preview.port) {
    const err = new Error('Proxy string: host:port ya host:port:user:pass');
    err.code = 'PROXY_INVALID';
    throw err;
  }
  const v = validateProxyHost(preview.host);
  if (!v.ok) {
    const err = new Error(v.error);
    err.code = 'PROXY_INVALID';
    throw err;
  }
  const raw = migrateLegacyProxyIntoList();
  const entry = {
    id: uid(),
    type: preview.type || 'http',
    host: preview.host,
    port: String(preview.port),
    username: preview.username || '',
    passwordEnc: preview.password ? encrypt(preview.password) : '',
  };
  const key = proxyEntryKey(entry);
  if (raw.some((e) => proxyEntryKey(e) === key)) {
    const err = new Error('Ye proxy pehle se saved hai');
    err.code = 'PROXY_DUP';
    throw err;
  }
  raw.push(entry);
  writeProxiesJson(raw);
  return listProxies();
}

function deleteProxiesByIds(ids) {
  assertReady();
  const idSet = new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean));
  if (!idSet.size) {
    return listProxies();
  }
  const raw = migrateLegacyProxyIntoList().filter((e) => !idSet.has(String(e.id)));
  writeProxiesJson(raw);
  return listProxies();
}

function clearAllProxies() {
  assertReady();
  writeProxiesJson([]);
  return [];
}

function setProxyConfig({ enabled: _enabled, type, host, port, username, password } = {}) {
  assertReady();
  // Explicit clear → wipe list (legacy callers)
  if (host !== undefined && !String(host || '').trim()) {
    return clearAllProxies(), getProxyConfig();
  }

  // Prefer append API for string paste
  if (host !== undefined && String(host || '').includes(':')) {
    addProxyFromString(host);
    return getProxyConfig();
  }

  const current = getProxyConfig();
  const { parseStoredProxy, validateProxyHost, expandStarProxyPaste } = require('./proxy-util');
  const hostRaw = host !== undefined ? String(host || '').trim() : '';
  const fromStringOnly = host !== undefined && hostRaw.includes(':');
  const preview = parseStoredProxy(
    expandStarProxyPaste(
      fromStringOnly
        ? {
            type: type !== undefined ? type : current.type || 'http',
            host: hostRaw,
          }
        : {
            type: type !== undefined ? type : current.type,
            host: host !== undefined ? host : current.host,
            port: port !== undefined ? port : current.port,
            username: username !== undefined ? username : current.username,
            password: password !== undefined ? password : current.password,
          }
    )
  );
  if (preview.host) {
    const v = validateProxyHost(preview.host);
    if (!v.ok) {
      const err = new Error(v.error);
      err.code = 'PROXY_INVALID';
      throw err;
    }
  }
  if (preview.host && preview.port) {
    addProxyFromString(
      preview.username
        ? `${preview.host}:${preview.port}:${preview.username}:${preview.password || ''}`
        : `${preview.host}:${preview.port}`
    );
  }
  return getProxyConfig();
}

function setUiState(partial) {
  assertReady();
  const current = getUiState();
  const changes = Object.entries(partial || {}).filter(([key, value]) =>
    String(current[key] ?? '') !== String(value ?? '')
  );
  if (!changes.length) return current;
  db.run('BEGIN TRANSACTION');
  try {
  for (const [key, value] of changes) {
    db.run(
      `INSERT INTO ui_state(key, value) VALUES(?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value == null ? '' : String(value)]
    );
  }
  db.run('COMMIT');
  } catch (error) { db.run('ROLLBACK'); throw error; }
  persist();
  return getUiState();
}

function saveJourney(payload) {
  assertReady();
  const id = payload.id || uid();
  const existing = getJourney(id);
  const name = (payload.name || existing?.name || 'Journey').trim() || 'Journey';
  const createdAt = existing?.createdAt || nowIso();
  const updatedAt = nowIso();
  const passengers = Array.isArray(payload.passengers) ? payload.passengers : existing?.passengers || [];
  const infants = Array.isArray(payload.infants) ? payload.infants : existing?.infants || [];
  const contact = payload.contact || existing?.contact || { mobile: '', email: '' };
  const options = { ...(existing?.options || {}), ...(payload.options || {}) };

  run(
    `INSERT INTO journeys (
      id, name, created_at, updated_at, from_station, to_station, date, train_no, class, quota,
      boarding, availability_check, slbooktime, acbooktime, gnbooktime,
      passengers_json, infants_json, contact_mobile, contact_email, options_json
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, updated_at=excluded.updated_at, from_station=excluded.from_station,
      to_station=excluded.to_station, date=excluded.date, train_no=excluded.train_no,
      class=excluded.class, quota=excluded.quota, boarding=excluded.boarding,
      availability_check=excluded.availability_check, slbooktime=excluded.slbooktime,
      acbooktime=excluded.acbooktime, gnbooktime=excluded.gnbooktime,
      passengers_json=excluded.passengers_json, infants_json=excluded.infants_json,
      contact_mobile=excluded.contact_mobile, contact_email=excluded.contact_email,
      options_json=excluded.options_json`,
    [
      id,
      name,
      createdAt,
      updatedAt,
      payload.from ?? existing?.from ?? '',
      payload.to ?? existing?.to ?? '',
      payload.date ?? existing?.date ?? '',
      payload.trainNo ?? existing?.trainNo ?? '',
      payload.class ?? existing?.class ?? '',
      payload.quota ?? existing?.quota ?? 'GN',
      payload.boarding ?? existing?.boarding ?? '',
      payload.availabilityCheck ?? existing?.availabilityCheck ?? '',
      payload.slbooktime ?? existing?.slbooktime ?? '10:59:59',
      payload.acbooktime ?? existing?.acbooktime ?? '09:59:59',
      payload.gnbooktime ?? existing?.gnbooktime ?? '07:59:59',
      JSON.stringify(passengers),
      JSON.stringify(infants),
      contact.mobile || '',
      contact.email || '',
      JSON.stringify(options || {}),
    ]
  );
  setUiState({ selectedJourneyId: id });
  return getJourney(id);
}

function saveCredential(payload) {
  assertReady();
  const id = payload.id || uid();
  const existing = queryOne(`SELECT * FROM credentials WHERE id = ?`, [id]);
  const name =
    (payload.name || existing?.name || payload.username || 'Login').trim() || 'Login';
  let passwordEnc = existing?.password_enc || '';
  if (payload.password != null && payload.password !== '') {
    passwordEnc = encrypt(payload.password);
  }
  const status = normalizeCredentialStatus(
    payload.status != null ? payload.status : existing?.status
  );
  const createdAt = existing?.created_at || nowIso();
  const updatedAt = nowIso();

  run(
    `INSERT INTO credentials (id, name, username, password_enc, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, username=excluded.username, password_enc=excluded.password_enc,
       status=excluded.status, updated_at=excluded.updated_at`,
    [
      id,
      name,
      payload.username ?? existing?.username ?? '',
      passwordEnc,
      status,
      createdAt,
      updatedAt,
    ]
  );
  setUiState({ selectedCredentialId: id });
  return getCredential(id, { includeSecrets: true });
}

/** STAR-style: ACTIVE | BOOKED | DEACTIVE | … */
function setCredentialStatus(id, status) {
  assertReady();
  const credId = String(id || '').trim();
  if (!credId) return null;
  const s = normalizeCredentialStatus(status);
  const existing = queryOne(`SELECT id FROM credentials WHERE id = ?`, [credId]);
  if (!existing) return null;
  run(`UPDATE credentials SET status = ?, updated_at = ? WHERE id = ?`, [
    s,
    nowIso(),
    credId,
  ]);
  return getCredential(credId);
}

/** Mark IRCTC ID BOOKED after PNR (by id, else username/name match). */
function markCredentialBooked({ id, username } = {}) {
  assertReady();
  const credId = String(id || '').trim();
  if (credId) {
    const updated = setCredentialStatus(credId, 'BOOKED');
    if (updated) return updated;
  }
  const user = String(username || '').trim();
  if (!user) return null;
  const row = queryOne(
    `SELECT id FROM credentials
     WHERE lower(trim(username)) = lower(trim(?))
        OR lower(trim(name)) = lower(trim(?))
     LIMIT 1`,
    [user, user]
  );
  if (!row?.id) return null;
  return setCredentialStatus(row.id, 'BOOKED');
}

function savePayment(payload) {
  assertReady();
  const id = payload.id || uid();
  const existing = queryOne(`SELECT * FROM payments WHERE id = ?`, [id]);
  const name =
    (payload.name || existing?.name || payload.paymentMethod || 'Payment').trim() || 'Payment';

  const encOrKeep = (field, encCol) => {
    if (payload[field] != null && payload[field] !== '') return encrypt(payload[field]);
    return existing?.[encCol] || '';
  };

  const createdAt = existing?.created_at || nowIso();
  const updatedAt = nowIso();

  run(
    `INSERT INTO payments (
      id, name, payment_method, backup_payment_method, vpa_enc, cardnumber_enc,
      cardexpiry_enc, cardcvv_enc, cardholder_enc, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, payment_method=excluded.payment_method,
      backup_payment_method=excluded.backup_payment_method, vpa_enc=excluded.vpa_enc,
      cardnumber_enc=excluded.cardnumber_enc, cardexpiry_enc=excluded.cardexpiry_enc,
      cardcvv_enc=excluded.cardcvv_enc, cardholder_enc=excluded.cardholder_enc,
      updated_at=excluded.updated_at`,
    [
      id,
      name,
      payload.paymentMethod ?? existing?.payment_method ?? '',
      payload.backupPaymentMethod ?? existing?.backup_payment_method ?? '',
      encOrKeep('vpa', 'vpa_enc'),
      encOrKeep('cardnumber', 'cardnumber_enc'),
      encOrKeep('cardexpiry', 'cardexpiry_enc'),
      encOrKeep('cardcvv', 'cardcvv_enc'),
      encOrKeep('cardholder', 'cardholder_enc'),
      createdAt,
      updatedAt,
    ]
  );
  setUiState({ selectedPaymentId: id });
  return getPayment(id, { includeSecrets: true });
}

function deleteProfile(kind, id) {
  assertReady();
  const table =
    kind === 'journey' || kind === 'journeys'
      ? 'journeys'
      : kind === 'credential' || kind === 'credentials'
        ? 'credentials'
        : kind === 'payment' || kind === 'payments'
          ? 'payments'
          : null;
  if (!table) return { ok: false, error: 'invalid kind' };

  const before = queryOne(`SELECT COUNT(*) AS c FROM ${table} WHERE id = ?`, [id]);
  run(`DELETE FROM ${table} WHERE id = ?`, [id]);

  const ui = getUiState();
  const patch = {};
  if (table === 'journeys' && ui.selectedJourneyId === id) patch.selectedJourneyId = null;
  if (table === 'credentials' && ui.selectedCredentialId === id) patch.selectedCredentialId = null;
  if (table === 'payments' && ui.selectedPaymentId === id) patch.selectedPaymentId = null;
  if (Object.keys(patch).length) setUiState(patch);

  return { ok: true, removed: Boolean(before && before.c) };
}

function renameProfile(kind, id, name) {
  assertReady();
  const table =
    kind === 'journey' || kind === 'journeys'
      ? 'journeys'
      : kind === 'credential' || kind === 'credentials'
        ? 'credentials'
        : 'payments';
  const existing =
    table === 'journeys'
      ? getJourney(id)
      : table === 'credentials'
        ? getCredential(id)
        : getPayment(id);
  if (!existing) return null;
  const nextName = (name || existing.name).trim() || existing.name;
  run(`UPDATE ${table} SET name = ?, updated_at = ? WHERE id = ?`, [nextName, nowIso(), id]);
  if (table === 'journeys') return getJourney(id);
  if (table === 'credentials') return getCredential(id, { includeSecrets: true });
  return getPayment(id, { includeSecrets: true });
}

function getBundleForRun({ journeyId, credentialId, paymentId }) {
  return {
    journey: journeyId ? getJourney(journeyId) : null,
    credential: credentialId ? getCredential(credentialId, { includeSecrets: true }) : null,
    payment: paymentId ? getPayment(paymentId, { includeSecrets: true }) : null,
  };
}

function getDbPath() {
  return dbPath;
}

function addBookingHistory(entry = {}) {
  assertReady();
  const id = uid();
  const createdAt = nowIso();
  const fromStn = String(entry.fromStn || entry.from || entry.from_station || '').trim();
  const toStn = String(entry.toStn || entry.to || entry.to_station || '').trim();
  const ticketName =
    String(entry.ticketName || entry.ticket_name || '').trim() ||
    (fromStn && toStn ? `${fromStn}_${toStn}` : '');
  const userId = String(entry.userId || entry.user_id || entry.credentialName || '').trim();
  const bankName = String(entry.bankName || entry.bank_name || '').trim();
  const fare = String(entry.fare ?? '').trim();
  const bookingDate =
    String(entry.bookingDate || entry.booking_date || '').trim() ||
    createdAt.replace('T', ' ').slice(0, 19);
  const journeyDate = String(entry.journeyDate || entry.date || entry.journey_date || '').trim();
  run(
    `INSERT INTO booking_history (
      id, created_at, pnr, train_no, train_name, from_station, to_station,
      journey_date, class, quota, credential_name, engine, mode, journey_name, notes,
      ticket_name, user_id, bank_name, fare, booking_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      createdAt,
      String(entry.pnr || '').trim(),
      String(entry.trainNo || entry.train_no || '').trim(),
      String(entry.trainName || entry.train_name || '').trim(),
      fromStn,
      toStn,
      journeyDate,
      String(entry.class || '').trim(),
      String(entry.quota || '').trim(),
      userId,
      String(entry.engine || '').trim(),
      String(entry.mode || '').trim(),
      String(entry.journeyName || entry.journey_name || ticketName || '').trim(),
      String(entry.notes || '').trim(),
      ticketName,
      userId,
      bankName,
      fare,
      bookingDate,
    ]
  );
  return {
    id,
    createdAt,
    pnr: String(entry.pnr || '').trim(),
    ticketName,
    userId,
    fromStn,
    toStn,
    journeyDate,
    bankName,
    fare,
    bookingDate,
    trainNo: String(entry.trainNo || entry.train_no || '').trim(),
    trainName: String(entry.trainName || entry.train_name || '').trim(),
    from: fromStn,
    to: toStn,
    date: journeyDate,
    class: String(entry.class || '').trim(),
    quota: String(entry.quota || '').trim(),
    credentialName: userId,
    engine: String(entry.engine || '').trim(),
    mode: String(entry.mode || '').trim(),
    journeyName: String(entry.journeyName || entry.journey_name || ticketName || '').trim(),
    notes: String(entry.notes || '').trim(),
  };
}

function listBookingHistory({ limit = 100 } = {}) {
  assertReady();
  const lim = Math.max(1, Math.min(500, Number(limit) || 100));
  const rows = queryAll(
    `SELECT * FROM booking_history ORDER BY created_at DESC LIMIT ?`,
    [lim]
  );
  return rows.map((r) => {
    const fromStn = r.from_station || '';
    const toStn = r.to_station || '';
    const userId = r.user_id || r.credential_name || '';
    const ticketName =
      r.ticket_name || (fromStn && toStn ? `${fromStn}_${toStn}` : r.journey_name || '');
    return {
      id: r.id,
      createdAt: r.created_at,
      pnr: r.pnr || '',
      ticketName,
      userId,
      fromStn,
      toStn,
      journeyDate: r.journey_date || '',
      bankName: r.bank_name || '',
      fare: r.fare || '',
      bookingDate: r.booking_date || (r.created_at || '').slice(0, 10),
      trainNo: r.train_no || '',
      trainName: r.train_name || '',
      from: fromStn,
      to: toStn,
      date: r.journey_date || '',
      class: r.class || '',
      quota: r.quota || '',
      credentialName: userId,
      engine: r.engine || '',
      mode: r.mode || '',
      journeyName: r.journey_name || ticketName,
      notes: r.notes || '',
    };
  });
}

function clearBookingHistory() {
  assertReady();
  run(`DELETE FROM booking_history`);
  return { ok: true };
}

async function useWorkspace(directory){
 const target=path.resolve(directory);
 workspaceTransition=workspaceTransition.catch(()=>{}).then(async()=>{
  if(workspaceDataRoot===target){await init();return;}
  if(readyPromise)await readyPromise;
  if(db){persist();db.close();}
  db=null;readyPromise=null;workspaceDataRoot=target;
  await init();
 });
 return workspaceTransition;
}
module.exports = {
  useWorkspace,
  init,
  listSummaries,
  getJourney,
  getCredential,
  getPayment,
  saveJourney,
  saveCredential,
  setCredentialStatus,
  markCredentialBooked,
  listActiveCredentials,
  isCredentialActive,
  savePayment,
  deleteProfile,
  renameProfile,
  getUiState,
  setUiState,
  getTrueCaptchaCredentials,
  setTrueCaptchaCredentials,
  getProxyConfig,
  setProxyConfig,
  listProxies,
  listProxiesForPanel,
  getProxyLabel,
  updateJourneyIpChoice,
  addProxyFromString,
  deleteProxiesByIds,
  clearAllProxies,
  getBundleForRun,
  getDbPath,
  addBookingHistory,
  listBookingHistory,
  clearBookingHistory,
};
