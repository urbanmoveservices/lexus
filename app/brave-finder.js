/**
 * Find Brave Browser executable on Windows (Lexus-style host).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

function candidates() {
  const local = process.env.LOCALAPPDATA || '';
  const pf = process.env.PROGRAMFILES || 'C:\\Program Files';
  const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  const home = os.homedir();
  return [
    path.join(pf, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    path.join(pf86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    path.join(local, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    path.join(home, 'AppData', 'Local', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    // Beta / Nightly fallbacks
    path.join(local, 'BraveSoftware', 'Brave-Browser-Beta', 'Application', 'brave.exe'),
    path.join(local, 'BraveSoftware', 'Brave-Browser-Nightly', 'Application', 'brave.exe'),
  ];
}

function findBravePath() {
  if ((process.env.LEXUS_BRAVE_PATH || process.env.OCEAN_BRAVE_PATH) && fs.existsSync((process.env.LEXUS_BRAVE_PATH || process.env.OCEAN_BRAVE_PATH))) {
    return (process.env.LEXUS_BRAVE_PATH || process.env.OCEAN_BRAVE_PATH);
  }
  for (const p of candidates()) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch (_) {}
  }
  return null;
}

/**
 * Read installed Brave full version (Chromium-based, e.g. 151.x).
 */
function detectBraveVersion(bravePath = findBravePath()) {
  if (!bravePath || !fs.existsSync(bravePath)) return null;
  try {
    const dir = path.dirname(bravePath);
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
        path: bravePath,
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
          `(Get-Item -LiteralPath '${bravePath.replace(/'/g, "''")}').VersionInfo.ProductVersion`,
        ],
        { encoding: 'utf8', timeout: 8000, windowsHide: true }
      ).trim();
      const m = out.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)/);
      if (m) {
        return { full: m[0], major: parseInt(m[1], 10), path: bravePath };
      }
    }
  } catch (_) {}

  try {
    const out = execFileSync(bravePath, ['--version'], {
      encoding: 'utf8',
      timeout: 8000,
      windowsHide: true,
    });
    const m = String(out).match(/(\d+)\.(\d+)\.(\d+)\.(\d+)/);
    if (m) return { full: m[0], major: parseInt(m[1], 10), path: bravePath };
  } catch (_) {}

  return null;
}

module.exports = {
  findBravePath,
  candidates,
  detectBraveVersion,
};
