/**
 * IRCTC iPay UPI QR — Direct Host (WEB-2 / WEB-3).
 * HAR 2026-09-01: bankId=113 → PaymentRedirect → irctcRequestAction →
 *   surchargelocale → payUpi(IsQr=Y) → verifyUpiResponse → BankResponse → bookingData
 *
 * Panel: Final Count → Final Hit For Pnr → SUCCESS! PNR
 */
class IpayQRHandlerJS {
  constructor(userId, clientTxnId, TOK, onLog, opts) {
    this.userId = userId;
    this.clientTxnId = clientTxnId;
    this.TOK = TOK || {};
    this.onLog = typeof onLog === 'function' ? onLog : null;
    this.amount = String((opts && opts.amount) || '').trim();
    this.gatewayEntryTime = 0;
    this.minWaitMs = 10500;
    this.port = 'JS-Direct';
    this._flowLog =
      typeof LexusQrFileLog !== 'undefined' ? LexusQrFileLog.create('iPay QR') : null;
  }

  _secChUa() {
    const m = String(navigator.userAgent || '').match(/Chrome\/(\d+)/);
    const v = m ? m[1] : '120';
    return `"Chromium";v="${v}", "Not?A_Brand";v="24", "Google Chrome";v="${v}"`;
  }

  _chromeMajor() {
    const m = String(navigator.userAgent || '').match(/Chrome\/(\d+)/);
    return m ? m[1] : '120';
  }

  _acceptLanguage() {
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
  }

  getFileLogLines() {
    return this._flowLog ? this._flowLog.getLines() : [];
  }

  log(msg) {
    const line = String(msg);
    console.log(`[${this.port}] [iPay-Direct] ${line}`);
    if (this._flowLog) this._flowLog.logUi(line);
    if (this.onLog) {
      this.onLog('iPay: ' + line);
      return;
    }
    try {
      if (typeof window.__lexusPushPanelStatus === 'function') {
        window.__lexusPushPanelStatus('iPay: ' + line);
      }
    } catch (_) {}
  }

  /** Panel status without prefix (Final Count / Final Hit / SUCCESS). */
  panelStatus(msg) {
    const line = String(msg || '').trim();
    if (!line) return;
    console.log(`[${this.port}] [iPay-Direct] ${line}`);
    if (this._flowLog) this._flowLog.logUi(line);
    try {
      if (typeof window.__lexusPushPanelStatus === 'function') {
        window.__lexusPushPanelStatus(line);
        return;
      }
    } catch (_) {}
    if (this.onLog) this.onLog(line);
  }

  _parseBookingDataPayload(data) {
    const dto = data && data.bookingResponseDTO;
    let pnr = '';
    let err = '';
    if (Array.isArray(dto) && dto.length > 0) {
      pnr = String(dto[0].pnrNumber || '').trim();
      err = String(dto[0].errorMessage || dto[0].errorMsg || '').trim();
    } else if (dto && typeof dto === 'object') {
      pnr = String(dto.pnrNumber || '').trim();
      err = String(dto.errorMessage || dto.errorMsg || '').trim();
    }
    if (!err) {
      err = String(
        (data && (data.errorMessage || data.errorMsg || data.error)) || ''
      ).trim();
    }
    const okPnr = Boolean(pnr && pnr !== '0' && pnr.toLowerCase() !== 'null');
    return { pnr: okPnr ? pnr : '', error: err };
  }

  _extractHidden(html, name) {
    const text = String(html || '');
    let m = text.match(
      new RegExp(`name=["']${name}["'][^>]*value=["']([^"']*)["']`, 'i')
    );
    if (m && m[1]) return m[1];
    m = text.match(
      new RegExp(`value=["']([^"']*)["'][^>]*name=["']${name}["']`, 'i')
    );
    return m && m[1] ? m[1] : '';
  }

  /** iPay surcharge customToken (HAR: name then value, self-closing). */
  _extractCustomToken(html) {
    const text = String(html || '');
    const patterns = [
      /name=["']customToken["'][^>]*\bvalue=["']([^"']+)["']/i,
      /\bvalue=["']([^"']+)["'][^>]*name=["']customToken["']/i,
      /id=["']customToken\d*["'][^>]*\bvalue=["']([^"']+)["']/i,
      /\bvalue=["']([^"']+)["'][^>]*id=["']customToken\d*["']/i,
      /name=["']customToken["'][^>]*\bvalue=([A-Za-z0-9_-]+)/i,
      /customToken\s*[=:]\s*["']([A-Za-z0-9_-]{20,})["']/i,
      /["']customToken["']\s*:\s*["']([A-Za-z0-9_-]{20,})["']/i,
    ];
    for (const re of patterns) {
      const m = text.match(re);
      if (m && m[1] && String(m[1]).trim()) return String(m[1]).trim();
    }
    const hidden = this._extractHidden(text, 'customToken') || this._extractHidden(text, 'token');
    if (hidden && String(hidden).trim()) return String(hidden).trim();
    return '';
  }

  /** HAR: #amountPayablePhoneNew → "₹ 32.25" */
  _extractPayAmount(html) {
    const text = String(html || '');
    const m =
      text.match(/id=["']amountPayablePhoneNew["'][^>]*>\s*₹\s*([\d,.]+)/i) ||
      text.match(/class=["'][^"']*main-amount[^"']*["'][^>]*>\s*₹\s*([\d,.]+)/i);
    if (m && m[1]) return `₹ ${String(m[1]).trim()}`;
    return '';
  }

  _ipayAjaxHeaders() {
    return {
      Origin: 'https://www.irctcipay.com',
      Referer: 'https://www.irctcipay.com/pgui/jsp/surchargePaymentPage.jsp',
      'User-Agent': navigator.userAgent,
      Accept: 'application/json, text/plain, */*',
      'sec-ch-ua': this._secChUa(),
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'Accept-Language': this._acceptLanguage(),
    };
  }

  _resolveIpayUrl(loc) {
    const s = String(loc || '').trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s;
    if (s.startsWith('/')) return 'https://www.irctcipay.com' + s;
    return 'https://www.irctcipay.com/pgui/jsp/' + s.replace(/^\.\//, '');
  }

  _extractFormAction(html) {
    const m = String(html || '').match(/<form[^>]*action=["']([^"']+)["']/i);
    return m && m[1] ? m[1] : '';
  }

  _formatAmountRupee(raw) {
    let s = String(raw || '').trim();
    if (!s) return '₹ 0.00';
    s = s.replace(/[₹,\s]/g, '');
    const n = Number(s);
    if (!Number.isFinite(n)) return `₹ ${String(raw).replace(/^₹\s*/, '')}`;
    return `₹ ${n.toFixed(2)}`;
  }

  async waitFinalCount(gateMs) {
    const total = Math.max(0, Number(gateMs) || this.minWaitMs);
    const startAt = this.gatewayEntryTime || Date.now();
    while (true) {
      const elapsed = Date.now() - startAt;
      if (elapsed >= total) return elapsed;
      const left = total - elapsed;
      if (left > 10) {
        const sec = Math.floor(left / 1000);
        const msPart = left % 1000;
        this.panelStatus(`Final Count: ${sec}:${msPart}`);
      }
      await new Promise((r) => setTimeout(r, Math.min(50, left)));
    }
  }

  // ======================================================
  // STEP 1: WPS PaymentRedirect → encdata form
  // ======================================================
  async fetch_ipay_redirect_form() {
    try {
      const ua = navigator.userAgent;
      const rand_val = Math.random() || 0.5;
      const ts = Date.now();
      const p1 = String(ts / (100000 * rand_val));
      const p2 = String(ts / (1000000 * rand_val));
      const csrf = this.TOK.csrf || '';
      const access_token = this.TOK.access_token || '';
      const txn_key = `${this.userId}:${this.clientTxnId}`;

      const payload = new URLSearchParams();
      payload.append('token', access_token);
      payload.append('txn', txn_key);
      payload.append(txn_key, `${p1}${csrf}${p2}`);

      const headers = {
        accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://www.irctc.co.in',
        referer: 'https://www.irctc.co.in/',
        'user-agent': ua,
        'sec-ch-ua': this._secChUa(),
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'same-site',
        'sec-fetch-user': '?1',
        'upgrade-insecure-requests': '1',
        'accept-language': this._acceptLanguage(),
      };

      this.gatewayEntryTime = Date.now();
      this.log('WPS: PaymentRedirect…');

      const t0 = Date.now();
      const resp = await fetch('https://www.wps.irctc.co.in/eticketing/PaymentRedirect', {
        method: 'POST',
        headers,
        body: payload.toString(),
        credentials: 'include',
        redirect: 'follow',
      });
      const text = await resp.text();
      if (this._flowLog) {
        this._flowLog.logHttp(
          'POST',
          'https://www.wps.irctc.co.in/eticketing/PaymentRedirect',
          headers,
          payload.toString(),
          resp.status,
          text,
          t0
        );
      }

      const encdata = this._extractHidden(text, 'encdata');
      let action = this._extractFormAction(text);
      if (!action) {
        action = 'https://www.irctcipay.com/pgui/jsp/irctcRequestAction';
      }
      if (!encdata) {
        this.log(`⚠️ iPay encdata missing. Status: ${resp.status}`);
        return null;
      }
      this.log('✅ PaymentRedirect encdata captured.');
      return { encdata, action, gatewayEntryTime: this.gatewayEntryTime };
    } catch (e) {
      this.log(`❌ PaymentRedirect Error: ${e.message}`);
      return null;
    }
  }

  // ======================================================
  // STEP 2–3: irctcRequestAction → surcharge HTML (customToken)
  // HAR: POST → 302 Location=/pgui/jsp/surchargelocale… + Set-Cookie JSESSIONID
  // APP uses redirect:manual then GET. Browser follow often loses session → no token.
  // ======================================================
  async _getSurchargePage(url, referer) {
    const ua = navigator.userAgent;
    const headers = {
      accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'user-agent': ua,
      'sec-ch-ua': this._secChUa(),
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      referer: referer || 'https://www.irctcipay.com/pgui/jsp/irctcRequestAction',
      'upgrade-insecure-requests': '1',
      'accept-language': this._acceptLanguage(),
    };
    const t0 = Date.now();
    const resp = await fetch(url, {
      method: 'GET',
      headers,
      credentials: 'include',
      redirect: 'follow',
    });
    const html = await resp.text();
    if (this._flowLog) {
      this._flowLog.logHttp('GET', url, headers, null, resp.status, html, t0);
    }
    return { status: resp.status, html };
  }

  async open_ipay_surcharge(form) {
    const action =
      form.action || 'https://www.irctcipay.com/pgui/jsp/irctcRequestAction';
    const encdata = String(form.encdata || '').trim();
    const defaultSurcharge =
      'https://www.irctcipay.com/pgui/jsp/surchargelocale?request_localeA=&defaultLanguageA=';
    if (!encdata) {
      this.log('❌ encdata missing');
      return null;
    }

    const ua = navigator.userAgent;
    const body = new URLSearchParams();
    body.append('encdata', encdata);

    // Paytm-style POST headers (cross-site from WPS PaymentRedirect)
    const postHeaders = {
      accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'https://www.wps.irctc.co.in',
      referer: 'https://www.wps.irctc.co.in/',
      'user-agent': ua,
      'sec-ch-ua': this._secChUa(),
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'upgrade-insecure-requests': '1',
      'accept-language': this._acceptLanguage(),
    };

    try {
      // encdata is single-use — exactly ONE POST to irctcRequestAction
      this.log('iPay: irctcRequestAction (follow)…');
      let t0 = Date.now();
      const resp = await fetch(action, {
        method: 'POST',
        headers: postHeaders,
        body: body.toString(),
        credentials: 'include',
        redirect: 'follow',
      });
      let html = await resp.text();
      if (this._flowLog) {
        this._flowLog.logHttp(
          'POST',
          action,
          postHeaders,
          'encdata=***',
          resp.status,
          html,
          t0
        );
      }

      let customToken = this._extractCustomToken(html);
      if (customToken) {
        const payAmt = this._extractPayAmount(html);
        this.log(`✅ customToken OK (follow, html=${html.length}).`);
        return { customToken, html, amount: payAmt };
      }

      // Session cookie from POST above → full surcharge page (~105KB)
      this.log(`iPay: no token yet (html=${html.length}) → GET surchargelocale…`);
      const page = await this._getSurchargePage(defaultSurcharge, action);
      html = page.html || '';
      customToken = this._extractCustomToken(html);
      if (customToken) {
        const payAmt = this._extractPayAmount(html);
        this.log(`✅ customToken OK (surchargelocale, html=${html.length}).`);
        return { customToken, html, amount: payAmt };
      }

      const hasStr = /customToken/i.test(html);
      this.log(
        `❌ customToken missing (html=${html.length}, hasTokenAttr=${hasStr})`
      );
      return null;
    } catch (e) {
      this.log(`❌ irctcRequestAction Error: ${e.message}`);
      return null;
    }
  }

  // ======================================================
  // STEP 4: updateIsPaymentPageLoadedFlagAction
  // ======================================================
  async mark_payment_page_loaded(token) {
    const url =
      'https://www.irctcipay.com/pgui/jsp/updateIsPaymentPageLoadedFlagAction';
    const fd = new FormData();
    fd.append('token', token);
    const headers = this._ipayAjaxHeaders();
    this.log('iPay: pageLoaded flag…');
    try {
      const t0 = Date.now();
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: fd,
        credentials: 'include',
      });
      const text = await resp.text();
      if (this._flowLog) {
        this._flowLog.logHttp('POST', url, headers, 'token=***', resp.status, text, t0);
      }
      let data = null;
      try {
        data = JSON.parse(text);
      } catch (_) {}
      const code = data && data.responseCode != null ? String(data.responseCode) : '';
      if (code && code !== '000') {
        this.log(`⚠️ pageLoaded responseCode=${code}`);
        return false;
      }
      return resp.status === 200;
    } catch (e) {
      this.log(`⚠️ pageLoaded: ${e.message}`);
      return false;
    }
  }

  // ======================================================
  // STEP 5: payUpi → QR imageData
  // ======================================================
  async pay_upi_qr(token, amountOverride) {
    const url = 'https://www.irctcipay.com/pgui/jsp/payUpi';
    const amountStr = this._formatAmountRupee(amountOverride || this.amount);
    const fd = new FormData();
    fd.append('token', token);
    fd.append('upiCustName', 'dummy');
    fd.append('paymentType', 'UP');
    fd.append('mopType', 'UP');
    fd.append('amount', amountStr);
    fd.append('currencyCode', '356');
    fd.append('IsQr', 'Y');
    fd.append('browserName', 'Chrome');
    fd.append('browserVersion', this._chromeMajor());

    const headers = this._ipayAjaxHeaders();

    this.log(`iPay: payUpi QR (${amountStr})…`);
    try {
      const t0 = Date.now();
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: fd,
        credentials: 'include',
      });
      const text = await resp.text();
      if (this._flowLog) {
        this._flowLog.logHttp('POST', url, headers, 'payUpi multipart', resp.status, text, t0);
      }
      let data = null;
      try {
        data = JSON.parse(text);
      } catch (_) {}
      if (!data || !data.imageData) {
        const rc = data && data.responseCode != null ? String(data.responseCode) : '?';
        this.log(`❌ payUpi failed HTTP ${resp.status} responseCode=${rc} (session cookie?)`);
        return null;
      }
      const pgRefNum = String(data.pgRefNum || '').trim();
      const pgRefHash = String(data.pgRefHash || '').trim();
      if (!pgRefNum || !pgRefHash) {
        this.log('❌ payUpi pgRefNum/Hash missing');
        return null;
      }
      this.log('✅ QR image received.');
      return {
        imageData: data.imageData,
        pgRefNum,
        pgRefHash,
        token,
      };
    } catch (e) {
      this.log(`❌ payUpi Error: ${e.message}`);
      return null;
    }
  }

  // ======================================================
  // STEP 6: poll verifyUpiResponse until Captured + encdata
  // ======================================================
  async poll_verify_upi(session) {
    const url = 'https://www.irctcipay.com/pgui/jsp/verifyUpiResponse';
    const headers = this._ipayAjaxHeaders();

    this.log('⏳ Waiting UPI capture (scan QR)…');
    const maxAttempts = 90;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const fd = new FormData();
        fd.append('token', session.token);
        fd.append('pgRefNum', session.pgRefNum);
        fd.append('pgRefHash', session.pgRefHash);

        const t0 = Date.now();
        const resp = await fetch(url, {
          method: 'POST',
          headers,
          body: fd,
          credentials: 'include',
        });
        const text = await resp.text();
        if (this._flowLog && (attempt === 1 || attempt % 5 === 0 || text.length > 20)) {
          this._flowLog.logHttp(
            'POST',
            url,
            headers,
            'verifyUpi',
            resp.status,
            text.slice(0, 2000),
            t0
          );
        }

        if (text && text.trim()) {
          let data = null;
          try {
            data = JSON.parse(text);
          } catch (_) {}
          const fields = (data && data.responseFields) || {};
          const status = String(fields.STATUS || data.transactionStatus || '').trim();
          const encdata = String(fields.encdata || '').trim();
          const code = String(fields.RESPONSE_CODE || '').trim();
          this.log(`verifyUpi #${attempt} status=${status || resp.status}`);
          if (encdata && (/captured/i.test(status) || code === '000')) {
            this.log('💎 UPI Captured — encdata ready.');
            return { encdata, status, fields };
          }
          if (/fail|declin|cancel|expire/i.test(status)) {
            this.panelStatus(status || 'UPI failed');
            return null;
          }
        }
      } catch (e) {
        this.log(`⚠️ verifyUpi #${attempt}: ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    this.log('❌ verifyUpi timeout');
    return null;
  }

  // ======================================================
  // STEP 7: BankResponse
  // ======================================================
  async submit_bank_response(encdata) {
    await this.waitFinalCount(this.minWaitMs);

    const url = 'https://www.wps.irctc.co.in/eticketing/BankResponse';
    const payload = new URLSearchParams();
    payload.append('encdata', encdata);
    const ua = navigator.userAgent;
    const reqHeaders = {
      'sec-ch-ua': this._secChUa(),
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      Origin: 'https://www.irctcipay.com',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Upgrade-Insecure-Requests': '1',
      'User-Agent': ua,
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Sec-Fetch-Site': 'cross-site',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Dest': 'document',
      Referer: 'https://www.irctcipay.com/',
      'Accept-Language': this._acceptLanguage(),
    };

    this.log('🏁 Firing BankResponse POST…');
    try {
      const t0 = Date.now();
      const resp = await fetch(url, {
        method: 'POST',
        headers: reqHeaders,
        body: payload.toString(),
        credentials: 'include',
        redirect: 'manual',
      });
      const bankText = `[redirect type=${resp.type} status=${resp.status}]`;
      if (this._flowLog) {
        this._flowLog.logHttp(
          'POST',
          url,
          reqHeaders,
          'encdata=***',
          resp.status,
          bankText,
          t0
        );
      }
      if (resp.type === 'opaqueredirect' || resp.status === 0 || resp.status === 302) {
        this.log('💎 SUCCESS! IRCTC Accepted Payment.');
        return true;
      }
      if (resp.status === 200) {
        this.log('⏳ Status 200: Server processing…');
        return true;
      }
      this.log(`⚠️ Unexpected BankResponse ${resp.status}`);
      return false;
    } catch (e) {
      this.log(`❌ BankResponse Critical Error: ${e.message}`);
      return false;
    }
  }

  async verify_booking_confirm_page() {
    const url = 'https://www.irctc.co.in/nget/booking-confirm';
    const headers = {
      'User-Agent': navigator.userAgent,
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'sec-ch-ua': this._secChUa(),
      'Upgrade-Insecure-Requests': '1',
      'sec-ch-ua-mobile': '?0',
      Referer: 'https://www.irctcipay.com/',
      'Accept-Language': this._acceptLanguage(),
    };
    this.log('Final Verification…');
    try {
      for (let attempt = 1; attempt <= 5; attempt++) {
        const resp = await fetch(url, { headers, credentials: 'include' });
        if (resp.status === 200) {
          this.log('✅ Confirmation Page Verified (200 OK).');
          return true;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      return false;
    } catch (e) {
      this.log(`❌ Confirm Page Error: ${e.message}`);
      return false;
    }
  }

  async fetch_pnr_direct() {
    try {
      const api_url = `https://www.wps.irctc.co.in/eticketing/protected/mapps1/bookingData/${this.clientTxnId}`;
      const headers = {
        greq: this.TOK.greq || '',
        Authorization: `Bearer ${this.TOK.access_token || ''}`,
        bmirak: 'webbm',
        'spa-csrf-token': this.TOK.csrf || '',
        bmiyek: this.TOK.refresh_token || '',
        'User-Agent': navigator.userAgent,
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'https://www.irctc.co.in',
        Referer: 'https://www.irctc.co.in/',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
      };

      this.panelStatus('Final Hit For Pnr');
      let attempt = 0;
      while (attempt < 15) {
        attempt++;
        try {
          const resp = await fetch(api_url, { headers, credentials: 'include' });
          try {
            const newTok =
              resp.headers.get('spa-csrf-token') ||
              resp.headers.get('csrf-token') ||
              '';
            if (newTok) {
              headers['spa-csrf-token'] = newTok;
              this.TOK.csrf = newTok;
            }
          } catch (_) {}
          if (resp.status === 200) {
            const data = await resp.json();
            if (this._flowLog) {
              this._flowLog.logHttp(
                'GET',
                api_url,
                headers,
                null,
                resp.status,
                JSON.stringify(data, null, 2),
                Date.now()
              );
            }
            const { pnr, error: err } = this._parseBookingDataPayload(data);
            if (pnr) {
              if (typeof window.__lexusReportBookingFull === 'function') {
                try {
                  await window.__lexusReportBookingFull(data);
                } catch (_) {}
              }
              this.panelStatus(`SUCCESS! PNR: ${pnr}`);
              this.log(`✅ 💎 PNR GENERATED: ${pnr}`);
              return { pnr, status: 'BOOKED', full_data: data };
            }
            if (err) {
              this.panelStatus('Booking Data API failed: ' + err);
              this.log(`🛑 BOOKING FAILED: ${err}`);
              return { ok: false, error: err, note: err };
            }
            this.log(`⚠️ Attempt ${attempt}: No PNR yet.`);
          } else {
            this.log(`⚠️ API Status: ${resp.status} on attempt ${attempt}`);
          }
          await new Promise((r) => setTimeout(r, 2000));
        } catch (e) {
          this.log(`⚠️ PNR Request Error: ${e.message}`);
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      this.panelStatus('PNR Fetch Timeout');
      this.log('❌ PNR Fetch Timeout (All attempts exhausted).');
      return { ok: false, error: 'PNR Fetch Timeout', note: 'PNR Fetch Timeout' };
    } catch (e) {
      const msg = e.message || String(e);
      this.panelStatus('Booking Data API failed: ' + msg);
      this.log(`❌ PNR Fetch Critical Error: ${msg}`);
      return { ok: false, error: msg, note: msg };
    }
  }

  show_qr(qr_b64) {
    try {
      if (window.lexusDirectHost && typeof window.lexusDirectHost.showQr === 'function') {
        window.lexusDirectHost.showQr(qr_b64);
        this.log('🖼️ QR on ticket panel.');
        return;
      }
      const overlayId = 'ipay_qr_overlay';
      let overlay = document.getElementById(overlayId);
      if (overlay) overlay.remove();
      overlay = document.createElement('div');
      overlay.id = overlayId;
      Object.assign(overlay.style, {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: '999999',
        backgroundColor: 'white',
        padding: '20px',
        boxShadow: '0 0 20px rgba(0,0,0,0.5)',
        borderRadius: '10px',
        textAlign: 'center',
        fontFamily: 'Arial, sans-serif',
      });
      const closeBtn = document.createElement('button');
      closeBtn.innerText = 'X';
      Object.assign(closeBtn.style, {
        position: 'absolute',
        top: '5px',
        right: '10px',
        background: 'none',
        border: 'none',
        fontSize: '16px',
        cursor: 'pointer',
      });
      closeBtn.onclick = () => overlay.remove();
      const label = document.createElement('div');
      label.innerText = 'SCAN & PAY — IRCTC iPay QR';
      Object.assign(label.style, {
        marginBottom: '10px',
        fontWeight: 'bold',
        color: '#213d77',
      });
      const img = document.createElement('img');
      img.src = qr_b64.startsWith('data:') ? qr_b64 : `data:image/png;base64,${qr_b64}`;
      img.style.maxWidth = '280px';
      overlay.appendChild(closeBtn);
      overlay.appendChild(label);
      overlay.appendChild(img);
      document.body.appendChild(overlay);
    } catch (e) {
      this.log('QR UI error: ' + (e.message || e));
    }
  }

  hide_qr() {
    try {
      if (window.lexusDirectHost && typeof window.lexusDirectHost.hideQr === 'function') {
        window.lexusDirectHost.hideQr();
      }
    } catch (_) {}
    try {
      const overlay = document.getElementById('ipay_qr_overlay');
      if (overlay) overlay.remove();
    } catch (_) {}
  }

  async continue_after_encdata(encdata) {
    const bankEnc = String(encdata || '').trim();
    if (!bankEnc) {
      this.log('❌ Bank encdata missing');
      return false;
    }
    try {
      if (await this.submit_bank_response(bankEnc)) {
        if (await this.verify_booking_confirm_page()) {
          return await this.fetch_pnr_direct();
        }
        this.log("⚠️ Confirmation page didn't return 200, trying PNR fetch anyway...");
        return await this.fetch_pnr_direct();
      }
      return false;
    } finally {
      this.hide_qr();
    }
  }

  async continue_after_surcharge(page) {
    const customToken = String((page && page.customToken) || '').trim();
    if (!customToken) {
      this.log('❌ customToken missing (continue)');
      return false;
    }
    const payAmount = (page && page.amount) || this.amount;
    if (page && page.amount) {
      this.amount = page.amount;
      this.log(`iPay amount from surcharge: ${page.amount}`);
    }
    this.log(`✅ customToken OK (navigate, html=${(page && page.htmlLen) || 0}).`);

    try {
      await new Promise((r) => setTimeout(r, 200));

      const pageOk = await this.mark_payment_page_loaded(customToken);
      if (!pageOk) {
        this.log('⚠️ pageLoaded not OK — retrying payUpi anyway…');
      }

      const qrSession = await this.pay_upi_qr(customToken, payAmount);
      if (!qrSession) return false;

      this.show_qr(qrSession.imageData);

      const verified = await this.poll_verify_upi(qrSession);
      if (!verified) return false;

      this.hide_qr();

      if (await this.submit_bank_response(verified.encdata)) {
        if (await this.verify_booking_confirm_page()) {
          return await this.fetch_pnr_direct();
        }
        this.log("⚠️ Confirmation page didn't return 200, trying PNR fetch anyway...");
        return await this.fetch_pnr_direct();
      }
      return false;
    } finally {
      this.hide_qr();
    }
  }

  async start_process() {
    this.log('🚀 Launching iPay QR Direct Engine (bank 113)');
    try {
      const form = await this.fetch_ipay_redirect_form();
      if (!form) return false;

      const page = await this.open_ipay_surcharge(form);
      if (!page) return false;

      // Let Electron session persist JSESSIONID from Phase 15 Set-Cookie
      await new Promise((r) => setTimeout(r, 200));

      const payAmount = page.amount || this.amount;
      if (page.amount) {
        this.amount = page.amount;
        this.log(`iPay amount from surcharge: ${page.amount}`);
      }

      const pageOk = await this.mark_payment_page_loaded(page.customToken);
      if (!pageOk) {
        this.log('⚠️ pageLoaded not OK — retrying payUpi anyway…');
      }

      const qrSession = await this.pay_upi_qr(page.customToken, payAmount);
      if (!qrSession) return false;

      this.show_qr(qrSession.imageData);

      const verified = await this.poll_verify_upi(qrSession);
      if (!verified) return false;

      this.hide_qr();

      if (await this.submit_bank_response(verified.encdata)) {
        if (await this.verify_booking_confirm_page()) {
          return await this.fetch_pnr_direct();
        }
        this.log("⚠️ Confirmation page didn't return 200, trying PNR fetch anyway...");
        return await this.fetch_pnr_direct();
      }
      return false;
    } finally {
      this.hide_qr();
    }
  }
}
