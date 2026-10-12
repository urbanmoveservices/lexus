/**
 * Apply saved proxy to an Electron session (IRCTC window / Direct Host).
 * Auth HTTP proxies: STAR-style local tunnel (more reliable than login event).
 */
const { electronProxyRules, hasProxyAuth, normalizeProxyConfig } = require('./proxy-util');
const { startAuthProxyTunnel } = require('./proxy-tunnel');

/**
 * @param {Electron.Session} ses
 * @param {object} [proxyCfg]
 * @returns {Promise<{ ok:boolean, enabled?:boolean, rules?:string, tunnel?:object, reason?:string }>}
 */
async function applyProxyToSession(ses, proxyCfg) {
  if (!ses) return { ok: false, reason: 'no-session' };
  const cfg = normalizeProxyConfig(proxyCfg || {});
  if (cfg.error) return { ok: false, reason: cfg.error };
  if (!cfg.enabled) {
    try {
      await ses.setProxy({ mode: 'direct' });
    } catch (_) {}
    return { ok: true, enabled: false };
  }

  let tunnel = null;
  let rules = electronProxyRules(cfg);

  if (hasProxyAuth(cfg) && cfg.type !== 'socks5') {
    try {
      tunnel = await startAuthProxyTunnel(cfg);
      if (tunnel && tunnel.localPort) {
        rules = `http=127.0.0.1:${tunnel.localPort};https=127.0.0.1:${tunnel.localPort}`;
      }
    } catch (e) {
      console.warn('[LEXUS Proxy] tunnel for Electron failed:', e.message || e);
    }
  }

  if (!rules) return { ok: false, reason: 'bad-rules' };

  await ses.setProxy({
    mode: 'fixed_servers',
    proxyRules: rules,
    proxyBypassRules: '<local>',
  });

  if (hasProxyAuth(cfg) && !tunnel && !ses.__lexusProxyLoginHooked) {
    ses.__lexusProxyLoginHooked = true;
    ses.on('login', (event, _wc, _details, authInfo, callback) => {
      if (!authInfo || !authInfo.isProxy) return;
      event.preventDefault();
      callback(cfg.username || '', cfg.password || '');
    });
  }

  console.log(
    '[LEXUS Proxy] session proxy set:',
    rules,
    tunnel ? '(tunnel auth)' : hasProxyAuth(cfg) ? '(login auth)' : ''
  );
  return { ok: true, enabled: true, rules, tunnel };
}

module.exports = { applyProxyToSession };
