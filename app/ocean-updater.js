/**
 * OCEAN UPDATER — R2-hosted Setup updates (installed NSIS only).
 * Portable builds are skipped.
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

const R2_BASE = (
  process.env.OCEAN_UPDATE_BASE ||
  'https://pub-7b076185109e49bd9ada1ae4250141fd.r2.dev'
).replace(/\/+$/, '');

const LATEST_URL =
  process.env.OCEAN_UPDATE_LATEST_URL || `${R2_BASE}/latest.json`;

/** @type {import('electron').BrowserWindow | null} */
let updaterWindow = null;
let updateBusy = false;

function getAppIconPath() {
  const candidates = [
    path.join(__dirname, 'build', 'icon.ico'),
    path.join(__dirname, 'icon.ico'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (_) {}
  }
  return undefined;
}

/** electron-builder portable sets these */
function isPortableBuild() {
  if (process.env.PORTABLE_EXECUTABLE_DIR || process.env.PORTABLE_EXECUTABLE_FILE) {
    return true;
  }
  try {
    const exe = process.execPath || '';
    if (/portable/i.test(exe)) return true;
  } catch (_) {}
  return false;
}

function isInstalledBuild() {
  if (!app.isPackaged) return false;
  if (isPortableBuild()) return false;
  return true;
}

function parseVersion(v) {
  const s = String(v || '0')
    .trim()
    .replace(/^v/i, '');
  const parts = s.split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  while (parts.length < 3) parts.push(0);
  return parts.slice(0, 4);
}

/** @returns {number} 1 if a>b, -1 if a<b, 0 equal */
function compareVersions(a, b) {
  const aa = parseVersion(a);
  const bb = parseVersion(b);
  const n = Math.max(aa.length, bb.length);
  for (let i = 0; i < n; i++) {
    const x = aa[i] || 0;
    const y = bb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function fetchText(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const lib = String(url).startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        fetchText(res.headers.location, timeoutMs).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const lib = String(url).startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      try {
        file.close();
      } catch (_) {}
      try {
        fs.unlinkSync(destPath);
      } catch (_) {}
      reject(err);
    };

    const req = lib.get(url, { timeout: 120000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        try {
          fs.unlinkSync(destPath);
        } catch (_) {}
        downloadFile(res.headers.location, destPath, onProgress).then(resolve, reject);
        res.resume();
        return;
      }
      if (res.statusCode !== 200) {
        fail(new Error(`Download HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      const total = parseInt(res.headers['content-length'] || '0', 10) || 0;
      let received = 0;
      res.on('data', (chunk) => {
        received += chunk.length;
        if (typeof onProgress === 'function') {
          const pct = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
          onProgress({ received, total, percent: pct });
        }
      });
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          if (settled) return;
          settled = true;
          resolve({ path: destPath, bytes: received });
        });
      });
    });
    req.on('error', fail);
    req.on('timeout', () => fail(new Error('download timeout')));
    file.on('error', fail);
  });
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (d) => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function sendToUpdater(channel, payload) {
  try {
    if (updaterWindow && !updaterWindow.isDestroyed()) {
      updaterWindow.webContents.send(channel, payload);
    }
  } catch (_) {}
}

function createUpdaterWindow() {
  if (updaterWindow && !updaterWindow.isDestroyed()) {
    updaterWindow.focus();
    return updaterWindow;
  }
  const icon = getAppIconPath();
  updaterWindow = new BrowserWindow({
    width: 420,
    height: 280,
    resizable: false,
    maximizable: false,
    minimizable: false,
    show: false,
    autoHideMenuBar: true,
    title: 'OCEAN',
    backgroundColor: '#0b1220',
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload-updater.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  updaterWindow.once('ready-to-show', () => {
    if (updaterWindow && !updaterWindow.isDestroyed()) updaterWindow.show();
  });
  updaterWindow.on('closed', () => {
    updaterWindow = null;
  });
  updaterWindow.loadFile(path.join(__dirname, 'ocean-updater.html'));
  return updaterWindow;
}

async function fetchLatestManifest() {
  const raw = await fetchText(LATEST_URL);
  const data = JSON.parse(raw);
  if (!data || !data.version) throw new Error('latest.json invalid');
  let url = String(data.url || '').trim();
  if (!url && data.file) {
    const file = String(data.file).replace(/^\/+/, '');
    url = `${R2_BASE}/${file.split('/').map(encodeURIComponent).join('/')}`;
  }
  if (!url) throw new Error('latest.json missing url/file');
  return {
    version: String(data.version).trim(),
    url,
    sha256: String(data.sha256 || '').trim().toLowerCase(),
    notes: String(data.notes || '').trim(),
  };
}

function resolveInstalledExePath() {
  // After NSIS install — same folder as current packaged exe, or sibling OCEAN.exe
  const dir = path.dirname(process.execPath);
  const candidates = [
    path.join(dir, 'OCEAN.exe'),
    process.execPath,
    path.join(dir, 'OCEAN Form Fill.exe'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (_) {}
  }
  return process.execPath;
}

function writeAndRunInstaller(setupPath) {
  const tmpDir = app.getPath('temp');
  const batPath = path.join(tmpDir, `ocean-update-run-${Date.now()}.cmd`);
  const exePath = resolveInstalledExePath();
  const setupEsc = setupPath.replace(/"/g, '');
  const exeEsc = exePath.replace(/"/g, '');
  // Wait for app exit, silent install, then relaunch
  const bat = [
    '@echo off',
    'setlocal',
    'timeout /t 2 /nobreak >nul',
    `"${setupEsc}" /S`,
    'timeout /t 2 /nobreak >nul',
    `start "" "${exeEsc}"`,
    `del "%~f0"`,
    '',
  ].join('\r\n');
  fs.writeFileSync(batPath, bat, 'utf8');
  spawn('cmd.exe', ['/c', batPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

/**
 * Check R2 for newer Setup. Returns { update: boolean, ... }
 */
async function checkForUpdate() {
  if (!isInstalledBuild()) {
    return {
      update: false,
      skipped: true,
      reason: isPortableBuild() ? 'portable' : 'dev',
      current: app.getVersion(),
    };
  }
  const latest = await fetchLatestManifest();
  const current = app.getVersion();
  const newer = compareVersions(latest.version, current) > 0;
  return {
    update: newer,
    current,
    latest: latest.version,
    url: latest.url,
    sha256: latest.sha256,
    notes: latest.notes,
    skipped: false,
  };
}

async function runUpdateFlow(manifest) {
  if (updateBusy) return { ok: false, error: 'busy' };
  updateBusy = true;
  try {
    createUpdaterWindow();
    // wait for window load briefly
    await new Promise((r) => setTimeout(r, 400));

    sendToUpdater('updater:state', {
      phase: 'download',
      current: app.getVersion(),
      latest: manifest.version,
      notes: manifest.notes || '',
      percent: 0,
      message: 'Downloading update…',
    });

    const tmpDir = path.join(app.getPath('temp'), 'ocean-updater');
    fs.mkdirSync(tmpDir, { recursive: true });
    const dest = path.join(tmpDir, `OCEAN-Setup-${manifest.version}.exe`);

    await downloadFile(manifest.url, dest, ({ percent, received, total }) => {
      sendToUpdater('updater:progress', {
        percent,
        received,
        total,
        message: total
          ? `Downloading… ${percent}%`
          : `Downloading… ${(received / (1024 * 1024)).toFixed(1)} MB`,
      });
    });

    if (manifest.sha256) {
      sendToUpdater('updater:state', {
        phase: 'verify',
        percent: 100,
        message: 'Verifying file…',
      });
      const hash = await sha256File(dest);
      if (hash !== manifest.sha256) {
        throw new Error('SHA256 mismatch — update aborted');
      }
    }

    sendToUpdater('updater:state', {
      phase: 'install',
      percent: 100,
      message: 'Installing… app will restart',
    });

    await new Promise((r) => setTimeout(r, 600));
    writeAndRunInstaller(dest);

    sendToUpdater('updater:state', {
      phase: 'done',
      percent: 100,
      message: 'Restarting…',
    });

    setTimeout(() => {
      app.quit();
    }, 800);

    return { ok: true };
  } catch (e) {
    const msg = e?.message || String(e);
    sendToUpdater('updater:state', {
      phase: 'error',
      percent: 0,
      message: msg,
    });
    updateBusy = false;
    return { ok: false, error: msg };
  }
}

/**
 * Call at app startup — before license / main UI.
 * Opens OCEAN UPDATER and installs if newer Setup on R2.
 * Returns { started: true } only when install+restart was triggered.
 */
async function checkAndOfferUpdate() {
  try {
    if (!isInstalledBuild()) {
      console.log('[OCEAN UPDATER] skip —', isPortableBuild() ? 'portable' : 'not packaged');
      return { update: false, skipped: true };
    }
    const info = await checkForUpdate();
    console.log('[OCEAN UPDATER]', info);
    if (!info.update) return info;

    const manifest = {
      version: info.latest,
      url: info.url,
      sha256: info.sha256,
      notes: info.notes,
    };
    // Auto-download + replace + restart (no ask)
    const flow = await runUpdateFlow(manifest);
    return { ...info, started: !!flow.ok };
  } catch (e) {
    console.warn('[OCEAN UPDATER] check failed', e?.message || e);
    return { update: false, error: e?.message || String(e) };
  }
}

function registerUpdaterIpc() {
  ipcMain.handle('updater:get-info', () => ({
    current: app.getVersion(),
    r2Base: R2_BASE,
    latestUrl: LATEST_URL,
    portable: isPortableBuild(),
    installed: isInstalledBuild(),
  }));

  ipcMain.handle('updater:check', async () => {
    try {
      return await checkForUpdate();
    } catch (e) {
      return { update: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle('updater:start', async (_e, payload) => {
    const version = payload?.version;
    const url = payload?.url;
    if (!version || !url) return { ok: false, error: 'missing version/url' };
    return runUpdateFlow({
      version,
      url,
      sha256: payload?.sha256 || '',
      notes: payload?.notes || '',
    });
  });

  ipcMain.handle('updater:close', () => {
    if (updaterWindow && !updaterWindow.isDestroyed()) updaterWindow.close();
    return { ok: true };
  });
}

module.exports = {
  R2_BASE,
  LATEST_URL,
  isPortableBuild,
  isInstalledBuild,
  checkForUpdate,
  checkAndOfferUpdate,
  registerUpdaterIpc,
  createUpdaterWindow,
};
