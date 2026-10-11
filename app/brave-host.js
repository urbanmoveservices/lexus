/**
 * Ocean-style Brave: one host CDP socket → many slot profiles (multi-pair).
 *
 * 1) ensureBraveHost() — once: dedicated user-data-dir + ocean_host + CDP port
 *    (window off-screen). Brave/Chrome 136+ ignores debugging on *system* Default
 *    User Data, so we use Ocean's brave-ocean-userdata (override via OCEAN_BRAVE_USER_DATA).
 * 2) openBraveSlot(pair) — same user-data-dir + same port + ocean_pN + --new-window
 *    → Chromium attaches to host process (no second Brave). Driver picks new target.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

process.env.REBROWSER_PATCHES_RUNTIME_FIX_MODE =
  process.env.REBROWSER_PATCHES_RUNTIME_FIX_MODE || 'addBinding';
process.env.REBROWSER_PATCHES_UTILITY_WORLD_NAME =
  process.env.REBROWSER_PATCHES_UTILITY_WORLD_NAME || 'ocean_util_brave';

const puppeteer = require('rebrowser-puppeteer-core');

const TAG = '[Ocean Brave]';
const HOST_PROFILE = process.env.OCEAN_BRAVE_HOST_PROFILE || 'ocean_host';
const HOST_MASTER_KEY = 'ocean-host';

/** @type {{
 *  port: number,
 *  chromeProc: import('child_process').ChildProcess | null,
 *  userDataRoot: string,
 *  proxyServer: string | null,
 *  refCount: number,
 *  slots: Map<number, { profileDirectory: string, targetId: string | null }>
 * } | null} */
let hostState = null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getBraveUserDataRoot() {
  if (process.env.OCEAN_BRAVE_USER_DATA && String(process.env.OCEAN_BRAVE_USER_DATA).trim()) {
    return String(process.env.OCEAN_BRAVE_USER_DATA).trim();
  }
  // Non-default dir required so --remote-debugging-port is honored (Brave/Chrome ≥136)
  try {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'brave-ocean-userdata');
  } catch (_) {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'ocean-electron',
      'brave-ocean-userdata'
    );
  }
}

function hostProfileDirectory() {
  return HOST_PROFILE;
}

/** Stable slot profile per pair — alag cookie jar, same Ocean user-data tree */
function profileForPair(pairIndex) {
  const pi = Math.max(1, Number(pairIndex) || 1);
  if (pi === 1 && process.env.OCEAN_BRAVE_PROFILE) return process.env.OCEAN_BRAVE_PROFILE;
  if (pi === 2 && process.env.OCEAN_BRAVE_PROFILE_2) return process.env.OCEAN_BRAVE_PROFILE_2;
  const envKey = `OCEAN_BRAVE_PROFILE_${pi}`;
  if (process.env[envKey]) return process.env[envKey];
  return `ocean_p${pi}`;
}

function registryPath() {
  try {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'brave-ocean-port.json');
  } catch (_) {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'ocean-electron',
      'brave-ocean-port.json'
    );
  }
}

function loadPortRegistry() {
  try {
    return JSON.parse(fs.readFileSync(registryPath(), 'utf8'));
  } catch (_) {
    return {};
  }
}

function savePortRegistry(reg) {
  try {
    fs.mkdirSync(path.dirname(registryPath()), { recursive: true });
    fs.writeFileSync(registryPath(), JSON.stringify(reg, null, 2), 'utf8');
  } catch (_) {}
}

function ensureProfileSeed(userDataRoot, profileDirectory, displayName) {
  const dir = path.join(userDataRoot, profileDirectory);
  fs.mkdirSync(dir, { recursive: true });
  const prefsPath = path.join(dir, 'Preferences');
  if (fs.existsSync(prefsPath)) return;
  // Avoid first-run "Person 1" default naming
  const prefs = {
    profile: {
      name: displayName,
      nickname: displayName,
      avatar_index: Math.min(25, Math.max(0, parseInt(String(displayName).replace(/\D/g, ''), 10) || 0)),
    },
  };
  try {
    fs.writeFileSync(prefsPath, JSON.stringify(prefs));
  } catch (_) {}
}

async function cdpAlive(port, timeoutMs = 2500) {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (Date.now() - start > timeoutMs) {
        resolve(false);
        return;
      }
      const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on('error', () => setTimeout(tick, 200));
      req.setTimeout(800, () => {
        req.destroy();
        setTimeout(tick, 200);
      });
    };
    tick();
  });
}

function fetchJson(url, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let raw = '';
      res.on('data', (c) => {
        raw += c;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

async function listTargetIds(port) {
  try {
    const list = await fetchJson(`http://127.0.0.1:${port}/json/list`);
    const ids = new Set();
    if (Array.isArray(list)) {
      for (const t of list) {
        if (t && t.id) ids.add(String(t.id));
      }
    }
    return ids;
  } catch (_) {
    return new Set();
  }
}

async function connectBrave(port) {
  return puppeteer.connect({
    browserURL: `http://127.0.0.1:${port}`,
    defaultViewport: null,
  });
}

function targetIdOf(page) {
  try {
    const t = page.target();
    return String(t._targetId || t._targetInfo?.targetId || '') || null;
  } catch (_) {
    return null;
  }
}

async function findPageByTargetId(browser, targetId) {
  if (!targetId) return null;
  const pages = await browser.pages();
  for (const p of pages) {
    if (targetIdOf(p) === targetId) return p;
  }
  return null;
}

async function waitForNewPage(browser, previousIds, timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const pages = await browser.pages();
    for (const p of pages) {
      const id = targetIdOf(p);
      if (id && !previousIds.has(id)) {
        try {
          const url = p.url() || '';
          // Prefer page targets (skip DevTools / service workers via pages() already)
          if (!url.startsWith('devtools://')) return p;
        } catch (_) {
          return p;
        }
      }
    }
    await sleep(200);
  }
  throw new Error('Brave slot window did not appear on host CDP (new target timeout)');
}

function slotWindowPosition(pairIndex) {
  const pi = Math.max(1, Number(pairIndex) || 1);
  return {
    x: 40 + (pi - 1) * 520,
    y: 40,
    width: 580,
    height: 720,
  };
}

function killHostProcess() {
  if (!hostState) return;
  try {
    if (hostState.chromeProc && !hostState.chromeProc.killed) {
      hostState.chromeProc.kill();
    }
  } catch (_) {}
  hostState = null;
}

/**
 * Step 1 — host Brave once (hidden). Returns live hostState.
 */
async function ensureBraveHost(opts) {
  const userDataRoot = getBraveUserDataRoot();
  fs.mkdirSync(userDataRoot, { recursive: true });
  const wantProxy = opts.proxyServer || null;
  const profileDirectory = hostProfileDirectory();
  ensureProfileSeed(userDataRoot, profileDirectory, 'Ocean Host');

  if (hostState && (await cdpAlive(hostState.port))) {
    if ((hostState.proxyServer || null) !== wantProxy) {
      console.warn(
        `${TAG} host proxy mismatch (have=${hostState.proxyServer || 'none'} want=${wantProxy || 'none'}) — restart host`
      );
      killHostProcess();
    } else {
      console.log(`${TAG} reuse Ocean host port=${hostState.port}`);
      return hostState;
    }
  } else if (hostState) {
    hostState = null;
  }

  // Registry: app restart but Brave still up
  const reg = loadPortRegistry();
  const savedPort = reg.hostPort;
  if (savedPort && (await cdpAlive(savedPort))) {
    if (wantProxy) {
      throw new Error(
        'Ocean Brave host already open without this proxy. Close ALL Ocean Brave windows, then launch again with IP=Proxy.'
      );
    }
    console.log(`${TAG} attach Ocean host via registry port=${savedPort}`);
    hostState = {
      port: savedPort,
      chromeProc: null,
      userDataRoot,
      proxyServer: null,
      refCount: 0,
      slots: new Map(),
    };
    return hostState;
  }

  const port = opts.port || (await opts.getFreePort());

  console.log(
    `${TAG} spawn Ocean HOST user-data-dir=${userDataRoot} profile=${profileDirectory} port=${port} proxy=${wantProxy || 'off'}`
  );

  const chromeProc = opts.spawnBrave({
    chromePath: opts.chromePath,
    userDataDir: userDataRoot,
    profileDirectory,
    port,
    proxyServer: wantProxy || undefined,
    windowPosition: { x: 7000, y: 7000 },
    windowSize: { width: 400, height: 300 },
    newWindow: false,
  });

  const ready = await opts.waitForCDP(port);
  if (!ready) {
    try {
      chromeProc.kill();
    } catch (_) {}
    throw new Error(`Brave Ocean host CDP not ready on port ${port}`);
  }

  reg.hostPort = port;
  reg.userDataRoot = userDataRoot;
  reg.hostProfile = profileDirectory;
  savePortRegistry(reg);

  hostState = {
    port,
    chromeProc,
    userDataRoot,
    proxyServer: wantProxy,
    refCount: 0,
    slots: new Map(),
  };
  return hostState;
}

/**
 * Step 2+3 — open/reuse slot profile on host CDP; return browser + page for that pair.
 */
async function openBraveSlot(opts) {
  const pairIndex = Math.max(1, Number(opts.pairIndex) || 1);
  const host = await ensureBraveHost(opts);
  const profileDirectory = profileForPair(pairIndex);
  ensureProfileSeed(host.userDataRoot, profileDirectory, `Ocean Pair ${pairIndex}`);

  host.refCount = (host.refCount || 0) + 1;

  const browser = await connectBrave(host.port);

  // Reuse existing slot target if still alive
  const existing = host.slots.get(pairIndex);
  if (existing?.targetId) {
    const page = await findPageByTargetId(browser, existing.targetId);
    if (page) {
      console.log(
        `${TAG} reuse slot pair=${pairIndex} profile=${profileDirectory} target=${existing.targetId}`
      );
      try {
        await page.bringToFront();
      } catch (_) {}
      return {
        userDataRoot: host.userDataRoot,
        profileDirectory,
        port: host.port,
        chromeProc: host.chromeProc,
        browser,
        page,
        masterKey: HOST_MASTER_KEY,
        pairIndex,
        reused: true,
        ownedSpawn: false,
        isOceanSlot: true,
      };
    }
    host.slots.delete(pairIndex);
  }

  const before = await listTargetIds(host.port);
  // Also mark current puppeteer page ids
  try {
    for (const p of await browser.pages()) {
      const id = targetIdOf(p);
      if (id) before.add(id);
    }
  } catch (_) {}

  const pos = slotWindowPosition(pairIndex);
  console.log(
    `${TAG} open SLOT pair=${pairIndex} profile=${profileDirectory} same-port=${host.port} window=${pos.x},${pos.y}`
  );

  // Same user-data + same debug port → joins host process (child often exits quickly)
  const slotProc = opts.spawnBrave({
    chromePath: opts.chromePath,
    userDataDir: host.userDataRoot,
    profileDirectory,
    port: host.port,
    // Proxy is process-level; already set on host. Do not pass again (ignored / confusing).
    proxyServer: undefined,
    windowPosition: { x: pos.x, y: pos.y },
    windowSize: { width: pos.width, height: pos.height },
    newWindow: true,
  });
  // Detached handoff — don't keep zombie handle as owner
  try {
    slotProc.unref?.();
  } catch (_) {}

  const page = await waitForNewPage(browser, before);
  const tid = targetIdOf(page);
  host.slots.set(pairIndex, { profileDirectory, targetId: tid });
  console.log(`${TAG} slot ready pair=${pairIndex} target=${tid || '?'}`);

  try {
    await page.bringToFront();
  } catch (_) {}

  return {
    userDataRoot: host.userDataRoot,
    profileDirectory,
    port: host.port,
    chromeProc: host.chromeProc,
    browser,
    page,
    masterKey: HOST_MASTER_KEY,
    pairIndex,
    reused: false,
    ownedSpawn: false,
    isOceanSlot: true,
  };
}

/** @deprecated name kept for chrome-runner — now Ocean openBraveSlot */
async function acquireBraveMaster(opts) {
  return openBraveSlot(opts);
}

function releaseBraveMaster(handle) {
  if (!handle || handle.browserKind !== 'brave') return;
  if (!hostState) return;
  hostState.refCount = Math.max(0, (hostState.refCount || 1) - 1);
  // Keep host + other slots alive (Ocean): disconnect CDP client only
}

function clearSlot(pairIndex) {
  if (!hostState || !hostState.slots) return;
  const pi = Math.max(1, Number(pairIndex) || 1);
  hostState.slots.delete(pi);
}

function closeBraveMaster(handle) {
  if (!handle || handle.browserKind !== 'brave') {
    return { killProcess: true };
  }
  releaseBraveMaster(handle);
  // Never kill shared Ocean host from a single pair close
  return { killProcess: false };
}

/** Test / manual shutdown of entire Ocean Brave process */
function shutdownOceanHost() {
  killHostProcess();
}

module.exports = {
  getBraveUserDataRoot,
  hostProfileDirectory,
  profileForPair,
  ensureBraveHost,
  openBraveSlot,
  acquireBraveMaster,
  releaseBraveMaster,
  clearSlot,
  closeBraveMaster,
  shutdownOceanHost,
  /** @deprecated use hostState via ensure — kept empty Map for old callers */
  get masters() {
    return new Map();
  },
};
