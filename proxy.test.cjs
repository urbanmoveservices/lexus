// Proxy checks: string parsing/validation, the "Check" connectivity test (testProxyConnectivity)
// and the local auth tunnel used for Chrome. A local authenticated CONNECT proxy is used, so no
// real proxy credentials are needed. The CONNECT target (www.irctc.co.in:443) is reached for real.
const test = require('node:test'), assert = require('node:assert/strict');
const http = require('node:http'), net = require('node:net'), dns = require('node:dns').promises;
const util = require('./app/proxy-util');
const tunnel = require('./app/proxy-tunnel');

const USER = 'proxy-user', PASS = 'p@ss:w/rd';
const expectedAuth = 'Basic ' + Buffer.from(USER + ':' + PASS).toString('base64');

function startFakeProxy({ requireAuth = true } = {}) {
  const log = { connects: [], rejected: 0 };
  const server = http.createServer((req, res) => { res.writeHead(405); res.end(); });
  server.on('connect', (req, clientSocket, head) => {
    const auth = req.headers['proxy-authorization'];
    if (requireAuth && auth !== expectedAuth) {
      log.rejected++;
      clientSocket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="test"\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    log.connects.push({ target: req.url, auth });
    const [host, port] = req.url.split(':');
    const upstream = net.connect(Number(port), host, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) upstream.write(head);
      upstream.pipe(clientSocket); clientSocket.pipe(upstream);
    });
    upstream.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upstream.destroy());
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, log, port: server.address().port })));
}

async function online() {
  try { await dns.lookup('www.irctc.co.in'); return true; } catch { return false; }
}

test('proxy string formats are expanded to host/port/user/password', () => {
  const cases = [
    ['13.206.7.253:3128:user:pa55', { host: '13.206.7.253', port: 3128, username: 'user', password: 'pa55' }],
    ['user:pa55@13.206.7.253:3128', { host: '13.206.7.253', port: 3128, username: 'user', password: 'pa55' }],
    ['http://user:pa55@13.206.7.253:3128', { host: '13.206.7.253', port: 3128, username: 'user', password: 'pa55', type: 'http' }],
    ['socks5://13.206.7.253:1080', { host: '13.206.7.253', port: 1080, type: 'socks5' }],
    ['13.206.7.253:8080', { host: '13.206.7.253', port: 8080 }],
  ];
  for (const [raw, want] of cases) {
    const got = util.parseStoredProxy({ host: raw });
    for (const [k, v] of Object.entries(want)) assert.equal(got[k], v, raw + ' -> ' + k);
  }
});

test('invalid hosts are rejected before any network call', async () => {
  assert.equal(util.validateProxyHost('13.2067.253.131').ok, false);
  assert.equal(util.validateProxyHost('').ok, false);
  assert.equal(util.validateProxyHost('http://x').ok, false);
  assert.equal(util.validateProxyHost('13.206.7.253').ok, true);
  const t0 = Date.now();
  const r = await util.testProxyConnectivity({ host: '13.2067.253.131', port: 3128 });
  assert.equal(r.ok, false);
  assert(Date.now() - t0 < 500, 'validation must not touch the network');
  const s = await util.testProxyConnectivity({ type: 'socks5', host: '127.0.0.1', port: 1080 });
  assert.equal(s.ok, false);
  const e = await util.testProxyConnectivity({});
  assert.equal(e.ok, false);
});

test('wrong proxy credentials fail with a clear error and never reach IRCTC', async () => {
  const p = await startFakeProxy();
  try {
    const r = await util.testProxyConnectivity({ type: 'http', host: '127.0.0.1', port: p.port, username: USER, password: 'wrong' });
    assert.equal(r.ok, false);
    assert.match(String(r.error), /407|authenticat|proxy/i);
    assert.equal(p.log.connects.length, 0);
    assert(p.log.rejected >= 1);
  } finally { p.server.close(); }
});

test('dead proxy port fails fast instead of waiting for the 25s timeout', async () => {
  const probe = net.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port; await new Promise(r => probe.close(r));
  const t0 = Date.now();
  const r = await util.testProxyConnectivity({ type: 'http', host: '127.0.0.1', port });
  assert.equal(r.ok, false);
  assert(Date.now() - t0 < 8000, 'took ' + (Date.now() - t0) + 'ms');
});

test('correct credentials: proxy receives CONNECT www.irctc.co.in:443 with Basic auth and IRCTC loads', async (t) => {
  if (!(await online())) return t.skip('offline');
  const p = await startFakeProxy();
  try {
    const r = await util.testProxyConnectivity({ type: 'http', host: '127.0.0.1', port: p.port, username: USER, password: PASS });
    assert.equal(p.log.connects.length >= 1, true, 'proxy never saw a CONNECT: ' + JSON.stringify(r));
    assert.equal(p.log.connects[0].target, 'www.irctc.co.in:443');
    assert.equal(p.log.connects[0].auth, expectedAuth, 'credentials must arrive URL-decoded and Basic-encoded');
    assert.equal(r.ok, true, 'IRCTC check failed: ' + JSON.stringify(r));
    assert.equal(r.url, 'https://www.irctc.co.in/nget/train-search');
    assert(r.status >= 200 && r.status < 400);
  } finally { p.server.close(); }
});

test('local auth tunnel injects credentials so Chrome can use the proxy without a login prompt', async (t) => {
  const p = await startFakeProxy();
  let t1 = null;
  try {
    t1 = await tunnel.startAuthProxyTunnel({ enabled: true, type: 'http', host: '127.0.0.1', port: p.port, username: USER, password: PASS });
    assert(t1 && t1.localPort > 0 && /^http:\/\/127\.0\.0\.1:\d+/.test(t1.proxyServerArg), 'tunnel did not start');
    // Client (like Chrome) speaks to the local tunnel with NO credentials.
    const status = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: t1.localPort, method: 'CONNECT', path: 'www.irctc.co.in:443', timeout: 8000 });
      req.on('connect', (res, socket) => { socket.destroy(); resolve(res.statusCode); });
      req.on('error', reject); req.on('timeout', () => { req.destroy(); reject(new Error('tunnel timeout')); });
      req.end();
    });
    if (!(await online()) && status !== 200) return t.skip('offline');
    assert.equal(status, 200);
    assert.equal(p.log.connects[0].auth, expectedAuth);
    assert.equal(p.log.rejected, 0);
  } finally {
    try { if (t1) await t1.stop(); } catch (_) {}
    p.server.close();
  }
});
