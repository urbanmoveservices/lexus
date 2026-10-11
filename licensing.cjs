const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const safeEqual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

function createLicensing({ directory = path.join(__dirname, 'license-data'), adminPassword, port = 8081 } = {}) {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'registry.json');
  let registry;
  if (fs.existsSync(file)) registry = JSON.parse(fs.readFileSync(file, 'utf8'));
  else {
    const password = adminPassword || crypto.randomBytes(18).toString('base64url');
    const salt = crypto.randomBytes(16).toString('hex');
    registry = { salt, passwordHash: crypto.scryptSync(password, salt, 64).toString('hex'), signingKey: crypto.randomBytes(32).toString('hex'), keys: [] };
    fs.writeFileSync(file, JSON.stringify(registry, null, 2), { mode: 0o600 });
    if (!adminPassword) fs.writeFileSync(path.join(directory, 'admin-access.txt'), `LEXUS administrator\nURL: ${process.env.LEXUS_PUBLIC_URL || `http://127.0.0.1:${port}`}/admin\nPassword: ${password}\nKeep this file private.\n`, { mode: 0o600 });
  }
  const sessions = new Map(), attempts = new Map(), activationAttempts = new Map(), requestAttempts = new Map();
  function persist() { fs.writeFileSync(file + '.tmp', JSON.stringify(registry, null, 2), { mode: 0o600 }); fs.renameSync(file + '.tmp', file); }
  const publicKey = item => { const { keyHash, devices, ...rest } = item; return { ...rest, hint:String(item.hint||'').slice(-3), devicesUsed: devices.length, status: item.revoked ? 'REVOKED' : item.pending ? 'PENDING' : item.paid===false ? 'UNPAID' : !hierarchy.activeOwner(item) ? 'SELLER_DISABLED' : Date.parse(item.expiresAt) <= Date.now() ? 'EXPIRED' : 'ACTIVE' }; };
  function login(password, remote = 'local', username = '') {
    const attempt = attempts.get(remote);
    if (attempt?.count >= 8 && Date.now() - attempt.since < 15 * 60 * 1000) throw Error('Too many attempts. Try again in 15 minutes.');
    if ((registry.adminUsername && !safeEqual(String(username || '').trim(), registry.adminUsername)) || !safeEqual(crypto.scryptSync(String(password || ''), registry.salt, 64).toString('hex'), registry.passwordHash)) {
      const current = !attempt || Date.now() - attempt.since >= 15 * 60 * 1000 ? { count: 0, since: Date.now() } : attempt;
      current.count++; attempts.set(remote, current); throw Error('Invalid administrator credentials');
    }
    attempts.delete(remote);
    const token = crypto.randomBytes(32).toString('base64url'); sessions.set(token, Date.now() + 8 * 60 * 60 * 1000); return token;
  }
  function authenticated(token) { const expiry = sessions.get(token); if (!expiry || expiry <= Date.now()) { sessions.delete(token); return false; } return true; }
  function limitedLicenseCheck(remote,operation){
    const previous=activationAttempts.get(remote);const current=!previous||Date.now()-previous.since>=15*60*1000?{count:0,since:Date.now()}:previous;
    if(current.count>=8)throw Error('Too many activation attempts. Try again in 15 minutes.');
    try{const result=operation();activationAttempts.delete(remote);return result;}catch(error){current.count++;activationAttempts.set(remote,current);throw error;}
  }
  function issue({ customer, days = 30, maxDevices = 2, preferredKey = '', sellerId = null, paid = true, plan = 'custom' } = {}) {
    customer = String(customer || '').trim(); days = Number(days); maxDevices = Number(maxDevices);
    if (!customer || customer.length > 100) throw Error('Enter a customer name (maximum 100 characters)');
    if (!Number.isInteger(days) || days < 1 || days > 3650) throw Error('Validity must be 1–3650 days');
    if (!Number.isInteger(maxDevices) || maxDevices < 1 || maxDevices > 10) throw Error('Device limit must be 1–10');
    const value = String(preferredKey||'').trim() || 'LEXUS-' + crypto.randomBytes(16).toString('hex').toUpperCase().match(/.{8}/g).join('-');
    if(value.length<6||value.length>64||/\s/.test(value))throw Error('Key must contain 6–64 characters without spaces');
    if(registry.keys.some(item=>safeEqual(item.keyHash,hash(value))))throw Error('That key is already in use');
    const key = { id: crypto.randomUUID(), customer, sellerId, paid, plan, keyHash: hash(value), hint: value.slice(-3), issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + days * 86400000).toISOString(), maxDevices, devices: [], revoked: false };
    registry.keys.unshift(key); persist(); return { key: value, license: publicKey(key) };
  }
  function revoke(id) { const item = registry.keys.find(x => x.id === id); if (!item) throw Error('License not found'); item.revoked = true; persist(); return publicKey(item); }
  function changeKey({currentKey,newKey}={},token){
    const license=sessionLicense(token);if(!license)throw Error('Activate your administrator-issued key first');
    const session=JSON.parse(Buffer.from(String(token).split('.')[0],'base64url').toString());
    const item=check(currentKey,session.device,false);if(item.id!==license.id)throw Error('The current key does not match your activated license');
    newKey=String(newKey||'').trim();if(newKey.length<6||newKey.length>64||/\s/.test(newKey))throw Error('Personal key must contain 6–64 characters without spaces');
    if(safeEqual(item.keyHash,hash(newKey)))throw Error('Choose a different personal key');
    if(registry.keys.some(other=>safeEqual(other.keyHash,hash(newKey))))throw Error('That key is unavailable. Choose another.');
    item.keyHash=hash(newKey);item.hint=newKey.slice(-3);item.keyVersion=(item.keyVersion||0)+1;item.personalizedAt=new Date().toISOString();persist();
    return {...activate(newKey,session.device),key:newKey};
  }
  function check(value, device, bind = false) {
    const keyHash = hash(String(value || '').trim()); const item = registry.keys.find(x => safeEqual(x.keyHash, keyHash));
    if (!item) throw Error('Activation key not found');
    if (!hierarchy.activeOwner(item)) throw Error('Your seller account is disabled');
    if (item.paid===false) throw Error('This key is unpaid; contact your seller or administrator');
    if (item.revoked) throw Error('This key has been revoked');
    if (item.pending) throw Error('Your key is waiting for administrator approval');
    if (Date.parse(item.expiresAt) <= Date.now()) throw Error('This key has expired');
    if (!device || String(device).length > 128) throw Error('Device identifier is required');
    if (!item.devices.includes(device)) {
      if (!bind) throw Error('Device is not activated');
      if (item.devices.length >= item.maxDevices) throw Error('Device limit reached');
      item.devices.push(device); persist();
    }
    return item;
  }
  function activate(value, device) {
    const item = check(value, device, true);
    const payload = Buffer.from(JSON.stringify({ id: item.id, device, expiresAt: item.expiresAt,version:item.keyVersion||0 })).toString('base64url');
    const signature = crypto.createHmac('sha256', registry.signingKey).update(payload).digest('base64url');
    return { token: payload + '.' + signature, license: publicKey(item) };
  }
  function sessionLicense(token) {
    try {
      const [payload, signature, extra] = String(token || '').split('.'); if (!payload || !signature || extra) return null;
      if (!safeEqual(signature, crypto.createHmac('sha256', registry.signingKey).update(payload).digest('base64url'))) return null;
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString()); const item = registry.keys.find(x => x.id === data.id);
      if (!item || item.paid===false || !hierarchy.activeOwner(item) || item.revoked || item.pending || Date.parse(item.expiresAt) <= Date.now() || !item.devices.includes(data.device)) return null;
      if((item.keyVersion||0)!==(data.version||0))return null;
      return publicKey(item);
    } catch { return null; }
  }
  const hierarchy=require('./hierarchy.cjs').createHierarchy({registry,persist,issue,publicKey,authenticated,sessionLicense});
  const cookies = req => Object.fromEntries(String(req.headers.cookie || '').split(';').map(x => x.trim().split('=')).filter(x => x.length === 2));
  async function handle(req, res, url) {
    if (await hierarchy.handle(req,res,url)) return true;
    if (!url.pathname.startsWith('/api/admin/') && !url.pathname.startsWith('/api/license/')) return false;
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      const auth = cookies(req).lexus_admin;
      if (url.pathname.startsWith('/api/admin/') && url.pathname !== '/api/admin/login' && !authenticated(auth)) { json(401, { error: 'Administrator login required' }); return true; }
      if (req.method === 'GET' && url.pathname === '/api/admin/keys') { json(200, { keys: registry.keys.map(publicKey) }); return true; }
      if (req.method === 'GET' && url.pathname === '/api/admin/session') { json(200, { authenticated: true }); return true; }
      if (req.method === 'GET' && url.pathname === '/api/license/state') { const license = sessionLicense(cookies(req).lexus_license); json(200, { activated: !!license, license, details:license?hierarchy.clientSummary(license.id):null }); return true; }
      if (req.method !== 'POST') { json(405, { error: 'Method not allowed' }); return true; }
      let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 16384) { json(413, { error: 'Request too large' }); return true; } }
      const body = text ? JSON.parse(text) : {};
      switch (url.pathname) {
        case '/api/admin/login': { const token = login(body.password, req.socket.remoteAddress, body.username); res.setHeader('Set-Cookie', `lexus_admin=${token}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=28800`); json(200, { ok: true }); break; }
        case '/api/admin/logout': sessions.delete(auth); res.setHeader('Set-Cookie', 'lexus_admin=; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=0'); json(200, { ok: true }); break;
        case '/api/admin/issue': json(200, issue({customer:body.customer,days:body.days,maxDevices:body.maxDevices,preferredKey:body.preferredKey})); break;
        case '/api/admin/revoke': json(200, revoke(body.id)); break;
        case '/api/license/renew-request': json(200,hierarchy.requestRenewal(cookies(req).lexus_license));break;
        case '/api/license/request': json(403,{error:'An administrator must issue your first key. Activate it, then personalize your key.'}); break;
        case '/api/license/change': {const result=limitedLicenseCheck(req.socket.remoteAddress,()=>changeKey(body,cookies(req).lexus_license));res.setHeader('Set-Cookie',`lexus_license=${result.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`);json(200,{ok:true,key:result.key,license:result.license});break;}
        case '/api/license/activate': {
          const result=limitedLicenseCheck(req.socket.remoteAddress,()=>activate(body.key,String(body.device||'')));
          res.setHeader('Set-Cookie', `lexus_license=${result.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`); json(200, { ok: true, license: result.license }); break;
        }
        case '/api/license/verify': { const item = limitedLicenseCheck(req.socket.remoteAddress,()=>check(body.key, String(body.device || ''), false)); json(200, { ok: true, license: publicKey(item) }); break; }
        default: json(404, { error: 'Unknown endpoint' });
      }
    } catch (error) { json(400, { error: error.message }); }
    return true;
  }
  return { handle, login, authenticated, issue, changeKey, revoke, activate, sessionLicense, pollPayments:hierarchy.pollPayments, list: () => registry.keys.map(publicKey), requestLicense:req=>sessionLicense(cookies(req).lexus_license), licensedRequest: req => !!sessionLicense(cookies(req).lexus_license) };
}
module.exports = { createLicensing };
