/**
 * IRCTC APP2 webmtoken crypto (STAR / SpaceX 4.3.12).
 * plaintext = userId#UP#base64(pwd)#UP#timestamp_ms
 * AES-128-CBC key = IV = (captcha + uid + 'A'*16)[:16]
 * Basic = b64(userId + ':' + b64(password))
 */
const crypto = require('crypto');

function encryptPasswordData(userId, password, captcha, uid) {
  const uidStr = String(uid || '');
  const captchaStr = captcha == null || captcha === '' ? '' : String(captcha);
  const encodedPwd = Buffer.from(String(password || ''), 'utf8').toString('base64');
  const tsMs = String(Date.now());
  const plaintext = `${String(userId || '')}#UP#${encodedPwd}#UP#${tsMs}`;
  const keySeed = (captchaStr + uidStr + 'AAAAAAAAAAAAAAAA').slice(0, 16);
  const key = Buffer.from(keySeed, 'utf8');
  const cipher = crypto.createCipheriv('aes-128-cbc', key, key);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  return {
    data: encrypted.toString('base64'),
    plaintext,
    keySeed,
  };
}

/** HAR 4.3.12: Authorization Basic = b64(userId + ':' + b64(password)) */
function buildWebmtokenBasicAuth(userId, password) {
  const pwdB64 = Buffer.from(String(password || ''), 'utf8').toString('base64');
  const raw = `${String(userId || '')}:${pwdB64}`;
  return 'Basic ' + Buffer.from(raw, 'utf8').toString('base64');
}

module.exports = { encryptPasswordData, buildWebmtokenBasicAuth };
