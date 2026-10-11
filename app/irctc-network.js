/**
 * IRCTC network helpers — Token Manager DNR parity + CDP token capture.
 * Extension uses chrome.declarativeNetRequest; Electron/Chrome automation
 * mirrors that via CDP Fetch / session.webRequest.
 */

const MAPPS_REFERERS = [
  [/validateUser/i, 'https://www.irctc.co.in/nget/train-search'],
  [/altAvlEnq/i, 'https://www.irctc.co.in/nget/train-search'],
  [/avlFarenquiry/i, 'https://www.irctc.co.in/nget/booking/train-list'],
  [/boardingStationEnq/i, 'https://www.irctc.co.in/nget/booking/train-list'],
  [/allLapAvlFareEnq/i, 'https://www.irctc.co.in/nget/booking/psgninput'],
  [/addonServices/i, 'https://www.irctc.co.in/nget/booking/reviewBooking'],
  [/bookingInitPayment/i, 'https://www.irctc.co.in/nget/payment/bkgPaymentOptions'],
  [/mapps1\//i, 'https://www.irctc.co.in/nget/train-search'],
];

function refererForUrl(url) {
  const u = String(url || '');
  for (const [re, ref] of MAPPS_REFERERS) {
    if (re.test(u)) return ref;
  }
  return 'https://www.irctc.co.in/nget/train-search';
}

function acceptLanguageFromList(languages) {
  const list = Array.isArray(languages) ? languages.filter(Boolean) : [];
  if (!list.length) return 'en-US,en;q=0.9';
  return list
    .map((lang, i) => {
      const code = String(lang).trim();
      if (!code) return null;
      if (i === 0) return code;
      const q = Math.max(0.1, 1 - i * 0.1).toFixed(1);
      return `${code};q=${q}`;
    })
    .filter(Boolean)
    .join(',');
}

function browserLikeHeaders(referer, acceptLanguage) {
  return {
    'Accept-Language': acceptLanguage || 'en-US,en;q=0.9',
    'Content-Language': 'en',
    Origin: 'https://www.irctc.co.in',
    Referer: referer,
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty',
  };
}

function mergeHeaderArray(existing, extra) {
  const map = new Map();
  for (const h of existing || []) {
    if (!h || !h.name) continue;
    map.set(String(h.name).toLowerCase(), { name: h.name, value: h.value });
  }
  for (const [name, value] of Object.entries(extra || {})) {
    map.set(name.toLowerCase(), { name, value });
  }
  // Drop headers Token Manager removes
  map.delete('x-requested-with');
  map.delete('sec-fetch-storage-access');
  return [...map.values()];
}

function extractTokensFromHeaders(headers) {
  const out = {};
  if (!headers) return out;
  const norm = {};
  if (Array.isArray(headers)) {
    for (const h of headers) {
      if (h && h.name) norm[String(h.name).toLowerCase()] = h.value;
    }
  } else {
    for (const [k, v] of Object.entries(headers)) norm[String(k).toLowerCase()] = v;
  }
  const auth = norm.authorization || '';
  const m = auth.match(/^bearer\s+(.+)/i);
  if (m) out.access_token = m[1];
  if (norm.bmiyek) out.refresh_token = norm.bmiyek;
  if (norm.greq) out.greq = norm.greq;
  if (norm['spa-csrf-token']) out.csrf = norm['spa-csrf-token'];
  return out;
}

function pageSaveTokensSource(obj) {
  // unused — prefer page.evaluate(fn, obj)
  return obj;
}

/**
 * System Chrome: DNR-like header rewrite + Network token harvest.
 */
async function attachChromeIrctcNetwork(page) {
  if (!page || page.__oceanIrctcNet) return;
  page.__oceanIrctcNet = true;

  let client;
  try {
    client = await page.createCDPSession();
  } catch (e) {
    console.warn('[Ocean Net] CDP session failed:', e.message || e);
    return;
  }

  let acceptLanguage = 'en-US,en;q=0.9';
  try {
    acceptLanguage = await page.evaluate(() => {
      try {
        const langs =
          navigator.languages && navigator.languages.length
            ? [...navigator.languages]
            : [navigator.language || 'en-US'];
        return langs
          .map((lang, i) => {
            const code = String(lang || '').trim();
            if (!code) return null;
            if (i === 0) return code;
            const q = Math.max(0.1, 1 - i * 0.1).toFixed(1);
            return `${code};q=${q}`;
          })
          .filter(Boolean)
          .join(',');
      } catch (_) {
        return 'en-US,en;q=0.9';
      }
    });
  } catch (_) {}

  const pushTokens = async (partial) => {
    if (!partial || !Object.keys(partial).length) return;
    try {
      const triggered = await page.evaluate((obj) => {
        try {
          const LS = 'ir:tokens';
          const cur = JSON.parse(localStorage.getItem(LS) || '{}');
          const next = Object.assign({}, cur, obj, {
            lastUpdated: new Date().toISOString(),
            source: 'cdp',
          });
          localStorage.setItem(LS, JSON.stringify(next));

          if (!window.__OCEAN_DIRECT_BOOK__ || !next.access_token) return false;
          if (window.__OCEAN_DIRECT_PIPELINE_DONE__) return false;
          if (!window.__OCEAN_LOGIN_OK__) {
            try {
              window.__OCEAN_PENDING_DIRECT__ = true;
            } catch (_) {}
            return false;
          }
          if (typeof window.__oceanTryStartDirect === 'function') {
            window.__oceanTryStartDirect('cdp');
            return true;
          }
          if (typeof window.__oceanStartDirectBook === 'function') {
            window.__oceanStartDirectBook();
            return true;
          }
          try {
            window.__OCEAN_PENDING_DIRECT__ = true;
          } catch (_) {}
          return false;
        } catch (_) {
          return false;
        }
      }, partial);
      if (triggered) {
        console.log('[Ocean Net] Direct API trigger queued (access_token ready)');
      } else if (partial.access_token) {
        console.log('[Ocean Net] access_token saved — waiting for Direct boot hook');
      }
    } catch (e2) {
      console.warn('[Ocean Net] push tokens failed', e2.message || e2);
    }
  };

  try {
    await client.send('Network.enable');
  } catch (e) {
    console.warn('[Ocean Net] Network.enable failed', e.message || e);
  }

  client.on('Network.requestWillBeSent', (ev) => {
    try {
      const url = ev.request && ev.request.url;
      if (!url || !/irctc\.co\.in/i.test(url)) return;
      if (!/mapps1|authprovider\/webtoken/i.test(url)) return;
      const toks = extractTokensFromHeaders(ev.request.headers);
      if (Object.keys(toks).length) {
        console.log('[Ocean Net] request tokens', Object.keys(toks).join(','));
        pushTokens(toks);
      }
    } catch (_) {}
  });

  client.on('Network.responseReceived', async (ev) => {
    try {
      const url = ev.response && ev.response.url;
      if (!url || !/irctc\.co\.in/i.test(url)) return;
      const headers = ev.response.headers || {};
      const partial = {};
      const csrf = headers['csrf-token'] || headers['Csrf-Token'];
      if (csrf) partial.csrf = csrf;
      if (/authprovider\/webtoken/i.test(url)) {
        try {
          const body = await client.send('Network.getResponseBody', { requestId: ev.requestId });
          let text = body.body || '';
          if (body.base64Encoded) text = Buffer.from(text, 'base64').toString('utf8');
          const j = JSON.parse(text);
          if (j.access_token) partial.access_token = j.access_token;
          if (j.refresh_token) partial.refresh_token = j.refresh_token;
        } catch (_) {}
      }
      if (Object.keys(partial).length) {
        console.log('[Ocean Net] response tokens', Object.keys(partial).join(','));
        await pushTokens(partial);
      }
    } catch (_) {}
  });

  // Fetch interception ≈ declarativeNetRequest modifyHeaders
  try {
    await client.send('Fetch.enable', {
      patterns: [
        { urlPattern: '*://www.irctc.co.in/eticketing/protected/mapps1/*', requestStage: 'Request' },
        { urlPattern: '*://www.wps.irctc.co.in/*', requestStage: 'Request' },
        { urlPattern: '*://www.irctcipay.com/*', requestStage: 'Request' },
      ],
    });
    console.log('[Ocean Net] DNR-like Fetch rules enabled (mapps1/wps/ipay)');
  } catch (e) {
    console.warn('[Ocean Net] Fetch.enable failed', e.message || e);
    return;
  }

  client.on('Fetch.requestPaused', async (ev) => {
    const { requestId, request } = ev;
    try {
      const url = request.url || '';
      let headers = request.headers || {};
      const asArray = Object.entries(headers).map(([name, value]) => ({ name, value }));

      if (/www\.wps\.irctc\.co\.in/i.test(url)) {
        headers = mergeHeaderArray(asArray, {
          Origin: 'https://www.irctc.co.in',
          Referer: 'https://www.irctc.co.in/nget/payment/bkgPaymentOptions',
        });
      } else if (/irctcipay\.com/i.test(url)) {
        headers = mergeHeaderArray(asArray, {
          Origin: 'https://www.irctcipay.com',
          Referer: 'https://www.irctcipay.com/pgui/jsp/surchargePaymentPage.jsp',
        });
      } else if (/mapps1/i.test(url)) {
        headers = mergeHeaderArray(asArray, browserLikeHeaders(refererForUrl(url), acceptLanguage));
      } else {
        headers = asArray;
      }

      const toks = extractTokensFromHeaders(
        Array.isArray(headers)
          ? Object.fromEntries(headers.map((h) => [h.name, h.value]))
          : headers
      );
      if (Object.keys(toks).length) pushTokens(toks);

      await client.send('Fetch.continueRequest', {
        requestId,
        headers: Array.isArray(headers) ? headers : asArray,
      });
    } catch (e) {
      try {
        await client.send('Fetch.continueRequest', { requestId });
      } catch (_) {}
    }
  });
}

/**
 * Electron session: webRequest header rewrite (DNR parity).
 */
function attachElectronIrctcNetwork(ses) {
  if (!ses || ses.__oceanIrctcNet) return;
  ses.__oceanIrctcNet = true;

  let acceptLanguage = 'en-US,en;q=0.9';
  try {
    const loc = Intl.DateTimeFormat().resolvedOptions().locale;
    acceptLanguage = acceptLanguageFromList([loc, 'en']);
  } catch (_) {}

  const filter = {
    urls: [
      'https://www.irctc.co.in/eticketing/protected/mapps1/*',
      'https://www.wps.irctc.co.in/*',
      'https://www.irctcipay.com/*',
    ],
  };

  ses.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    const headers = { ...(details.requestHeaders || {}) };
    const url = details.url || '';
    if (/www\.wps\.irctc\.co\.in/i.test(url)) {
      headers.Origin = 'https://www.irctc.co.in';
      headers.Referer = 'https://www.irctc.co.in/nget/payment/bkgPaymentOptions';
    } else if (/irctcipay\.com/i.test(url)) {
      headers.Origin = 'https://www.irctcipay.com';
      headers.Referer = 'https://www.irctcipay.com/pgui/jsp/surchargePaymentPage.jsp';
    } else if (/mapps1/i.test(url)) {
      Object.assign(headers, browserLikeHeaders(refererForUrl(url), acceptLanguage));
    }
    delete headers['X-Requested-With'];
    delete headers['x-requested-with'];
    callback({ requestHeaders: headers });
  });

  console.log('[Ocean Net] Electron webRequest DNR-like rules attached');
}

module.exports = {
  attachChromeIrctcNetwork,
  attachElectronIrctcNetwork,
  refererForUrl,
  browserLikeHeaders,
  acceptLanguageFromList,
};
