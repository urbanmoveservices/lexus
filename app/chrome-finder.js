/**
 * Find Google Chrome / Chromium executable on Windows (and common paths).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

function candidates() {
  const local = process.env.LOCALAPPDATA || '';
  const pf = process.env.PROGRAMFILES || 'C:\\\\Program Files';
  const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\\\Program Files (x86)';
  const home = os.homedir();
  return [
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(home, 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    // Chrome Beta / Dev / Canary (fallback)
    path.join(local, 'Google', 'Chrome Beta', 'Application', 'chrome.exe'),
    path.join(local, 'Google', 'Chrome SxS', 'Application', 'chrome.exe'),
    path.join(pf, 'Chromium', 'Application', 'chrome.exe'),
    // Edge as last resort (Chromium, real TLS — better than Electron)
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];
}

function findChromePath() {
  if ((process.env.LEXUS_CHROME_PATH || process.env.OCEAN_CHROME_PATH) && fs.existsSync((process.env.LEXUS_CHROME_PATH || process.env.OCEAN_CHROME_PATH))) {
    return (process.env.LEXUS_CHROME_PATH || process.env.OCEAN_CHROME_PATH);
  }
  const paths = candidates();
  for (const p of paths.filter(p => /Google[\\/]Chrome[\\/]Application[\\/]chrome\.exe$/i.test(p))) {
    if (fs.existsSync(p)) return p;
  }
  if (process.env.LEXUS_BUNDLED_CHROME_PATH && fs.existsSync(process.env.LEXUS_BUNDLED_CHROME_PATH)) return process.env.LEXUS_BUNDLED_CHROME_PATH;
  for (const p of paths) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch (_) {}
  }
  return null;
}

/**
 * Read installed Chrome full version (e.g. 151.0.7922.76).
 * Uses versioned sibling folder, then FileVersion, then --version.
 */
function detectChromeVersion(chromePath = findChromePath()) {
  if (!chromePath || !fs.existsSync(chromePath)) return null;
  try {
    const dir = path.dirname(chromePath);
    const folders = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d+\.\d+\.\d+\.\d+$/.test(d.name))
      .map((d) => d.name)
      .sort((a, b) => {
        const pa = a.split('.').map(Number);
        const pb = b.split('.').map(Number);
        for (let i = 0; i < 4; i++) {
          if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
        }
        return 0;
      });
    if (folders[0]) {
      return {
        full: folders[0],
        major: parseInt(folders[0].split('.')[0], 10),
        path: chromePath,
      };
    }
  } catch (_) {}

  try {
    if (process.platform === 'win32') {
      const out = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `(Get-Item -LiteralPath '${chromePath.replace(/'/g, "''")}').VersionInfo.ProductVersion`,
        ],
        { encoding: 'utf8', timeout: 8000, windowsHide: true }
      ).trim();
      const m = out.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)/);
      if (m) {
        return { full: m[0], major: parseInt(m[1], 10), path: chromePath };
      }
    }
  } catch (_) {}

  try {
    const out = execFileSync(chromePath, ['--version'], {
      encoding: 'utf8',
      timeout: 8000,
      windowsHide: true,
    });
    const m = String(out).match(/(\d+)\.(\d+)\.(\d+)\.(\d+)/);
    if (m) return { full: m[0], major: parseInt(m[1], 10), path: chromePath };
  } catch (_) {}

  return null;
}

module.exports = {
  findChromePath,
  candidates,
  detectChromeVersion,
};
