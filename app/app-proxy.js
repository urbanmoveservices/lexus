/**
 * APP HTTP proxy — panel IP mode=proxy → undici ProxyAgent for mapps/iPay fetch.
 * Auth HTTP: STAR-style local tunnel (proxy-chain), then agent → 127.0.0.1.
 * Sensor API stays direct (not routed here).
 */
const { ProxyAgent, Socks5ProxyAgent } = require('undici');
const {
  normalizeProxyConfig,
  hasProxyAuth,
  resolveProxyForIpMode,
} = require('./proxy-util');
const { startAuthProxyTunnel, upstreamUrl } = require('./proxy-tunnel');

/**
 * @param {object} sess app-pair session
 */
async function detachAppProxy(sess) {
  if (!sess) return;
  const tunnel = sess.proxyTunnel;
  sess.proxyTunnel = null;
  const agent = sess.dispatcher;
  sess.dispatcher = null;
  sess.proxyCfg = null;

  if (tunnel && typeof tunnel.stop === 'function') {
    try {
      await tunnel.stop();
    } catch (_) {}
  }
  if (agent && typeof agent.close === 'function') {
    try {
      await agent.close();
    } catch (_) {}
  }
}

/**
 * Attach proxy dispatcher to APP session (or clear if Home IP).
 * @param {object} sess
 * @param {object} proxyCfg from resolveProxyForIpMode
 */
async function attachAppProxy(sess, proxyCfg) {
  if (!sess) return { ok: false, reason: 'No APP session' };
  await detachAppProxy(sess);

  const cfg = normalizeProxyConfig(proxyCfg || {});
  if (proxyCfg?.ipMode) cfg.ipMode = proxyCfg.ipMode;
  if (proxyCfg?.error) {
    return { ok: false, reason: proxyCfg.error };
  }
  if (!cfg.enabled) {
    sess.proxyCfg = { enabled: false, ipMode: cfg.ipMode || 'auto' };
    console.log('[Ocean APP] proxy off (Home IP)');
    return { ok: true, enabled: false };
  }

  let tunnel = null;
  let agent = null;
  let via = `${cfg.type}://${cfg.host}:${cfg.port}`;

  try {
    if (cfg.type === 'socks5') {
      const url = upstreamUrl({ ...cfg, enabled: true });
      agent = new Socks5ProxyAgent(url);
      via = `socks5://${cfg.host}:${cfg.port}`;
    } else if (hasProxyAuth(cfg)) {
      tunnel = await startAuthProxyTunnel({ ...cfg, enabled: true });
      if (tunnel?.proxyServerArg) {
        agent = new ProxyAgent(tunnel.proxyServerArg);
        via = `tunnel→${cfg.host}:${cfg.port}`;
      } else {
        agent = new ProxyAgent(upstreamUrl({ ...cfg, enabled: true }));
        via = `http-auth://${cfg.host}:${cfg.port}`;
      }
    } else {
      agent = new ProxyAgent(`http://${cfg.host}:${cfg.port}`);
    }
  } catch (e) {
    await detachAppProxy(sess);
    return { ok: false, reason: e.message || 'APP proxy attach failed' };
  }

  sess.dispatcher = agent;
  sess.proxyTunnel = tunnel;
  sess.proxyCfg = { ...cfg, enabled: true, via };
  console.log(`[Ocean APP] proxy on ${via}`);
  return { ok: true, enabled: true, via };
}

/**
 * Resolve panel ipMode + saved Settings proxy, attach to session.
 */
async function attachAppProxyForRun(sess, ipMode, storedProxy) {
  const proxyCfg = resolveProxyForIpMode(ipMode, storedProxy || {});
  if (proxyCfg.error) {
    return { ok: false, reason: proxyCfg.error, proxyCfg };
  }
  const attached = await attachAppProxy(sess, proxyCfg);
  return { ...attached, proxyCfg };
}

/** Fetch options fragment — only when sess has dispatcher. */
function appFetchDispatcherOpts(sess) {
  if (sess?.dispatcher) return { dispatcher: sess.dispatcher };
  return {};
}

module.exports = {
  attachAppProxy,
  detachAppProxy,
  attachAppProxyForRun,
  appFetchDispatcherOpts,
};
