/**
 * Lexus/STAR-style local proxy for Chrome.
 * Prefer proxy-chain anonymizeProxy (Lexus); fall back to CONNECT auth inject.
 */

const net = require('net');
const { normalizeProxyConfig } = require('./proxy-util');

/** @type {Map<string, { kind:'chain'|'raw', localPort?:number, anonymizedUrl?:string, server?:net.Server }>} */
const tunnels = new Map();

function freeLocalPort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = addr && addr.port;
      s.close((err) => (err ? reject(err) : resolve(port)));
    });
    s.on('error', reject);
  });
}

function upstreamUrl(cfg) {
  const c = normalizeProxyConfig(cfg);
  const auth =
    c.username
      ? `${encodeURIComponent(c.username)}:${encodeURIComponent(c.password || '')}@`
      : '';
  const scheme = c.type === 'socks5' ? 'socks5' : 'http';
  return `${scheme}://${auth}${c.host}:${c.port}`;
}

function buildAuthHeader(user, pwd) {
  return `Proxy-Authorization: Basic ${Buffer.from(`${user}:${pwd}`, 'utf8').toString('base64')}`;
}

async function startRawAuthTunnel(cfg) {
  const localPort = await freeLocalPort();
  const authLine = buildAuthHeader(cfg.username, cfg.password || '');
  const remoteHost = cfg.host;
  const remotePort = cfg.port;

  const server = net.createServer((client) => {
    let buf = Buffer.alloc(0);
    let upstream = null;
    let headed = false;
    const fail = () => {
      try {
        client.destroy();
      } catch (_) {}
      try {
        if (upstream) upstream.destroy();
      } catch (_) {}
    };
    client.on('data', (chunk) => {
      if (headed) {
        if (upstream && !upstream.destroyed) upstream.write(chunk);
        return;
      }
      buf = Buffer.concat([buf, chunk]);
      const idx = buf.indexOf('\r\n\r\n');
      if (idx < 0) {
        if (buf.length > 64 * 1024) fail();
        return;
      }
      headed = true;
      const head = buf.slice(0, idx).toString('utf8');
      const rest = buf.slice(idx + 4);
      const lines = head.split('\r\n').filter((l) => !/^proxy-authorization\s*:/i.test(l));
      const newHead =
        lines[0] +
        '\r\n' +
        authLine +
        '\r\n' +
        (lines.length > 1 ? lines.slice(1).join('\r\n') + '\r\n' : '') +
        '\r\n';
      upstream = net.connect(remotePort, remoteHost, () => {
        upstream.write(newHead);
        if (rest.length) upstream.write(rest);
      });
      upstream.on('data', (d) => {
        if (!client.destroyed) client.write(d);
      });
      upstream.on('error', fail);
      upstream.on('close', fail);
    });
    client.on('error', fail);
    client.on('close', fail);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(localPort, '127.0.0.1', () => resolve());
  });

  const key = `raw:${localPort}`;
  tunnels.set(key, { kind: 'raw', localPort, server });
  console.log(`[LEXUS Proxy] raw tunnel 127.0.0.1:${localPort} → ${remoteHost}:${remotePort}`);
  return {
    localPort,
    proxyServerArg: `http://127.0.0.1:${localPort}`,
    stop: () => stopAuthProxyTunnel(localPort),
    _key: key,
  };
}

/**
 * Start local anonymized proxy for Chrome --proxy-server.
 * Returns { localPort, proxyServerArg, stop } or null.
 */
async function startAuthProxyTunnel(proxyCfg) {
  const cfg = normalizeProxyConfig(proxyCfg);
  if (!cfg.enabled || !cfg.host || !cfg.port) return null;

  // No auth → Chrome can talk to upstream directly (caller uses host:port)
  if (!cfg.username) return null;

  // Lexus path: proxy-chain
  try {
    const ProxyChain = require('proxy-chain');
    const oldUrl = upstreamUrl(cfg);
    const anonymizedUrl = await ProxyChain.anonymizeProxy(oldUrl);
    const m = String(anonymizedUrl).match(/127\.0\.0\.1:(\d+)/);
    const localPort = m ? Number(m[1]) : 0;
    const key = `chain:${anonymizedUrl}`;
    tunnels.set(key, { kind: 'chain', localPort, anonymizedUrl });
    console.log(`[LEXUS Proxy] proxy-chain ${anonymizedUrl} → ${cfg.host}:${cfg.port}`);
    return {
      localPort,
      proxyServerArg: anonymizedUrl.replace(/\/$/, ''),
      stop: async () => {
        try {
          await ProxyChain.closeAnonymizedProxy(anonymizedUrl, true);
        } catch (_) {}
        tunnels.delete(key);
      },
      _key: key,
    };
  } catch (e) {
    console.warn('[LEXUS Proxy] proxy-chain unavailable, raw tunnel:', e.message || e);
    return startRawAuthTunnel(cfg);
  }
}

function stopAuthProxyTunnel(localPortOrKey) {
  for (const [key, entry] of tunnels.entries()) {
    if (
      key === localPortOrKey ||
      entry.localPort === localPortOrKey ||
      String(localPortOrKey) === String(entry.localPort)
    ) {
      tunnels.delete(key);
      if (entry.kind === 'chain' && entry.anonymizedUrl) {
        try {
          const ProxyChain = require('proxy-chain');
          ProxyChain.closeAnonymizedProxy(entry.anonymizedUrl, true).catch(() => {});
        } catch (_) {}
      }
      if (entry.server) {
        try {
          entry.server.close();
        } catch (_) {}
      }
      console.log(`[LEXUS Proxy] stopped ${key}`);
      return;
    }
  }
}

module.exports = {
  startAuthProxyTunnel,
  stopAuthProxyTunnel,
  upstreamUrl,
};
