/**
 * SpaceX-style device "MAC" for Lexus license:
 * WMI Win32_ComputerSystemProduct.UUID → "UUID >> <uuid>" → MD5 → dashed hex
 */
const { execFile } = require('child_process');
const crypto = require('crypto');
const os = require('os');

function cleanUuid(raw) {
  return String(raw || '')
    .replace(/\u0000/g, '')
    .replace(/[\r\n\t]/g, '')
    .trim()
    .replace(/^UUID\s*[:=]?\s*/i, '')
    .toUpperCase();
}

/** MD5 bytes → A1B2-C3D4-… (dash every 2 bytes) */
function md5ToDashedHex(buf) {
  const hex = Buffer.from(buf).toString('hex').toUpperCase();
  const parts = [];
  for (let i = 0; i < hex.length; i += 4) {
    parts.push(hex.slice(i, i + 4));
  }
  return parts.join('-');
}

function macFromUuidString(uuidRaw) {
  const uuid = cleanUuid(uuidRaw);
  if (!uuid || /^FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF$/i.test(uuid)) {
    throw new Error('Invalid hardware UUID');
  }
  const payload = `UUID >> ${uuid}`;
  const digest = crypto.createHash('md5').update(payload, 'ascii').digest();
  return {
    uuid,
    payload,
    mac: md5ToDashedHex(digest),
  };
}

function runPsUuid() {
  return new Promise((resolve, reject) => {
    const ps = [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      '(Get-CimInstance -ClassName Win32_ComputerSystemProduct).UUID',
    ];
    execFile(
      'powershell.exe',
      ps,
      { windowsHide: true, timeout: 12000, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr || err.message || 'PowerShell UUID failed'));
          return;
        }
        resolve(String(stdout || '').trim());
      }
    );
  });
}

function runWmicUuid() {
  return new Promise((resolve, reject) => {
    execFile(
      'wmic',
      ['csproduct', 'get', 'uuid'],
      { windowsHide: true, timeout: 12000, encoding: 'utf8' },
      (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }
        const lines = String(stdout || '')
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        // ["UUID", "<value>"]
        const value = lines.find((l) => !/^UUID$/i.test(l)) || '';
        resolve(value);
      }
    );
  });
}

async function readHardwareUuid() {
  if (process.platform !== 'win32') {
    // Non-Windows fallback — stable per machine hostname+user (dev only)
    const fake = crypto
      .createHash('sha1')
      .update(`${os.hostname()}|${os.userInfo().username}|lexus`)
      .digest('hex')
      .slice(0, 32)
      .toUpperCase();
    return `${fake.slice(0, 8)}-${fake.slice(8, 12)}-${fake.slice(12, 16)}-${fake.slice(16, 20)}-${fake.slice(20, 32)}`;
  }
  try {
    return await runPsUuid();
  } catch (_) {
    return runWmicUuid();
  }
}

let cached = null;

async function getDeviceMac(force = false) {
  if (cached && !force) return cached;
  const uuid = await readHardwareUuid();
  cached = macFromUuidString(uuid);
  return cached;
}

module.exports = {
  cleanUuid,
  macFromUuidString,
  md5ToDashedHex,
  readHardwareUuid,
  getDeviceMac,
};
