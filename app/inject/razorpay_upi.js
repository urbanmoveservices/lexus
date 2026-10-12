/**
 * Razorpay UPI Collect — Direct Host (PaymentRedirect off IRCTC browser).
 * STAR razorpayupi.py: bankId 105 → PaymentRedirect encdata → hosted checkout
 *   → UPI collect(VPA) → poll signature → complete → BankResponse → bookingData
 *
 * End-flow (BankResponse / booking-confirm / bookingData) matches PhonePe/Paytm:
 * time-gate 10.5s, panelStatus('Final Hit For Pnr'), SUCCESS! PNR animation.
 */
class RazorpayUPIHandlerJS {
  constructor(userId, clientTxnId, TOK, onLog, opts) {
    this.userId = userId;
    this.clientTxnId = clientTxnId;
    this.TOK = TOK || {};
    this.onLog = typeof onLog === 'function' ? onLog : null;
    this.vpa = String((opts && opts.vpa) || '').trim();
    this.gatewayEntryTime = 0;
    this.port = 'JS-Direct';
    this.order_id = null;
    this.rzp_key = null;
    this.url_order_id = null;
    this.x_ranid = null;
    this.exact_amount = null;
    this.session_token = null;
    this.razorpay_payment_id = null;
    this.razorpay_signature = null;
    this.final_order_id = null;
    this._flowLog =
      typeof LexusQrFileLog !== 'undefined' ? LexusQrFileLog.create('Razorpay UPI') : null;
  }

  getFileLogLines() {
    return this._flowLog ? this._flowLog.getLines() : [];
  }

  _secChUa() {
    try {
      const uad = navigator.userAgentData;
      if (uad && Array.isArray(uad.brands) && uad.brands.length) {
        return uad.brands.map((b) => `"${b.brand}";v="${b.version}"`).join(', ');
      }
    } catch (_) {}
    const m = String(navigator.userAgent || '').match(/Chrome\/(\d+)/);
    const v = m ? m[1] : '120';
    return `"Not=A?Brand";v="99", "Google Chrome";v="${v}", "Chromium";v="${v}"`;
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

  log(msg) {
    const line = String(msg);
    console.log(`[${this.port}] [Razorpay-Direct] ${line}`);
    if (this._flowLog) this._flowLog.logUi(line);
    if (this.onLog) {
      this.onLog('Razorpay: ' + line);
      return;
    }
    try {
      if (typeof window.__lexusPushPanelStatus === 'function') {
        window.__lexusPushPanelStatus('Razorpay: ' + line);
      }
    } catch (_) {}
  }

  /** Panel status without Razorpay: prefix (Final Hit / wait / IRCTC error). */
  panelStatus(msg) {
    const line = String(msg || '').trim();
    if (!line) return;
    console.log(`[${this.port}] [Razorpay-Direct] ${line}`);
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
      err = String((data && (data.errorMessage || data.errorMsg || data.error)) || '').trim();
    }
    const okPnr = Boolean(pnr && pnr !== '0' && pnr.toLowerCase() !== 'null');
    return { pnr: okPnr ? pnr : '', error: err };
  }

  _extractEncdata(html) {
    const text = String(html || '');
    let m = text.match(/name=["']encdata["']\s+value=["']([^"']+)["']/i);
    if (m && m[1]) return m[1];
    m = text.match(/value=["']([^"']+)["']\s+name=["']encdata["']/i);
    if (m && m[1]) return m[1];
    return null;
  }

  _deviceId() {
    let hex = '';
    try {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        hex = crypto.randomUUID().replace(/-/g, '');
      }
    } catch (_) {}
    if (!hex || hex.length < 32) {
      hex = Array.from({ length: 32 }, () =>
        Math.floor(Math.random() * 16).toString(16)
      ).join('');
    }
    return `1.${hex}.${Date.now()}.83038617`;
  }

  // ======================================================
  // STEP 1: PaymentRedirect → encdata
  // ======================================================
  async fetch_irctc_encdata() {
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

      const enc = this._extractEncdata(text);
      if (enc) {
        this.log('✅ IRCTC encdata captured.');
        return enc;
      }
      this.log(`⚠️ encdata missing. Status: ${resp.status}`);
      return null;
    } catch (e) {
      this.log(`❌ PaymentRedirect Error: ${e.message}`);
      return null;
    }
  }

  // ======================================================
  // STEP 2: Razorpay IRCTC integration handshake
  // ======================================================
  async razorpay_handshake(encdata) {
    if (!encdata) return false;
    const url = 'https://checkout.razorpay.com/integration/irctc';
    const ua = navigator.userAgent;
    const payload = new URLSearchParams();
    payload.append('encdata', encdata);

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: 'https://www.irctc.co.in',
      Referer: 'https://www.wps.irctc.co.in/',
      'User-Agent': ua,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': this._acceptLanguage(),
    };

    try {
      this.log('Razorpay handshake…');
      const t0 = Date.now();
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: payload.toString(),
        credentials: 'include',
        redirect: 'follow',
      });
      const html = await resp.text();
      if (this._flowLog) {
        this._flowLog.logHttp('POST', url, headers, '[encdata]', resp.status, html.slice(0, 4000), t0);
      }

      const orderM = html.match(/(order_[A-Za-z0-9]{14,})/);
      this.order_id = orderM ? orderM[1] : null;

      const keyM = html.match(/["']key["']\s*:\s*["'](rzp_live_[^"']+)["']/);
      this.rzp_key = keyM ? keyM[1] : null;

      const urlIdM = html.match(/["']url_order_id["']\s*:\s*["']([^"']+)["']/);
      this.url_order_id = urlIdM ? urlIdM[1] : null;

      try {
        const u = new URL(resp.url || '');
        this.x_ranid = u.searchParams.get('x_ranid') || this.x_ranid;
      } catch (_) {}
      if (!this.x_ranid) {
        const ranM = html.match(/x_ranid=([A-Za-z0-9_-]+)/);
        if (ranM) this.x_ranid = ranM[1];
      }

      if (this.rzp_key && this.order_id) {
        this.log(`✅ Handshake OK · order=${this.order_id}`);
        return true;
      }
      this.log('❌ Handshake: key/order missing');
      return false;
    } catch (e) {
      this.log(`❌ Handshake Error: ${e.message}`);
      return false;
    }
  }

  // ======================================================
  // STEP 3: Hosted checkout JSON
  // ======================================================
  async load_checkout_page() {
    const url = `https://checkout-hosted.razorpay.com/orders/${this.order_id}?x_ranid=${this.x_ranid || ''}`;
    const headers = {
      'Upgrade-Insecure-Requests': '1',
      'User-Agent': navigator.userAgent,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Sec-Fetch-Site': 'cross-site',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Dest': 'document',
      Referer: 'https://www.wps.irctc.co.in/',
      'Accept-Language': this._acceptLanguage(),
    };

    try {
      this.log('Loading checkout page…');
      const t0 = Date.now();
      const resp = await fetch(url, { method: 'GET', headers, credentials: 'include' });
      const html = await resp.text();
      if (this._flowLog) {
        this._flowLog.logHttp('GET', url, headers, null, resp.status, html.slice(0, 4000), t0);
      }
      if (resp.status !== 200) {
        this.log(`❌ Checkout HTTP ${resp.status}`);
        return false;
      }

      const match = html.match(/\/\*\*JSON_DATA_START\*\*\/(.*?)\/\*\*JSON_DATA_END\*\*\//s);
      if (!match) {
        this.log('⚠️ Checkout JSON block missing');
        return false;
      }
      const jsonStr = match[1].trim().replace(/;+\s*$/, '');
      const data = JSON.parse(jsonStr);
      this.rzp_key = data.key || this.rzp_key;
      this.order_id = data.order_id || this.order_id;
      this.exact_amount = data.amount;
      this.log(`🎯 Checkout · key=${this.rzp_key} amount=${this.exact_amount}`);
      return true;
    } catch (e) {
      this.log(`❌ Checkout Error: ${e.message}`);
      return false;
    }
  }

  // ======================================================
  // STEP 3.5: session_token
  // ======================================================
  async fetch_session_token() {
    const params = new URLSearchParams({
      traffic_env: 'production',
      build: '9cf4993fdffdadb33a1edf72f44535ce55b5ad44',
      build_v1: '7ae2bf3201f49a50df87a0f84ead68058d5a97ac',
      checkout_v2: '1',
      new_session: '1',
      rzp_device_id: this._deviceId(),
      unified_session_id: this.x_ranid || '',
    });
    const url = `https://api.razorpay.com/v1/checkout/public?${params.toString()}`;
    const headers = {
      'User-Agent': navigator.userAgent,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Sec-Fetch-Site': 'same-site',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Dest': 'iframe',
      Referer: 'https://checkout-hosted.razorpay.com/',
      'sec-ch-ua': this._secChUa(),
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'Accept-Language': this._acceptLanguage(),
    };

    try {
      this.log('Fetching session token…');
      const t0 = Date.now();
      const resp = await fetch(url, { method: 'GET', headers, credentials: 'include' });
      const html = await resp.text();
      if (this._flowLog) {
        this._flowLog.logHttp('GET', url, headers, null, resp.status, html.slice(0, 2000), t0);
      }
      if (resp.status !== 200) {
        this.log(`❌ Session token HTTP ${resp.status}`);
        return false;
      }
      const m = html.match(/window\.session_token\s*=\s*["']([^"']+)["']/);
      if (!m) {
        this.log('⚠️ session_token not found');
        return false;
      }
      this.session_token = m[1];
      this.log('✅ Session token OK');
      return true;
    } catch (e) {
      this.log(`❌ Session token Error: ${e.message}`);
      return false;
    }
  }

  // ======================================================
  // STEP 4: UPI collect
  // ======================================================
  async trigger_collect_request(vpa) {
    const url = 'https://api.razorpay.com/v1/payments/create/ajax';
    const payload = new URLSearchParams();
    payload.append('key_id', this.rzp_key);
    payload.append('amount', String(this.exact_amount));
    payload.append('currency', 'INR');
    payload.append('order_id', this.order_id);
    payload.append('method', 'upi');
    payload.append('vpa', vpa);
    payload.append('upi[flow]', 'collect');
    payload.append('_[flow]', 'directpay');
    payload.append('_[platform]', 'browser');
    payload.append('_[library]', 'hosted');

    let referer = `https://checkout-hosted.razorpay.com/orders/${this.order_id}`;
    if (this.x_ranid) referer += `?x_ranid=${this.x_ranid}`;

    const headers = {
      accept: 'application/json, text/plain, */*',
      'accept-language': this._acceptLanguage(),
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'https://checkout-hosted.razorpay.com',
      referer,
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'cross-site',
      'x-session-token': this.session_token || '',
      'user-agent': navigator.userAgent,
    };

    try {
      this.log(`UPI collect → ${vpa} · amount=${this.exact_amount}`);
      const t0 = Date.now();
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: payload.toString(),
        credentials: 'include',
      });
      const text = await resp.text();
      if (this._flowLog) {
        this._flowLog.logHttp('POST', url, headers, payload.toString(), resp.status, text, t0);
      }
      if (resp.status !== 200) {
        this.log(`❌ Collect HTTP ${resp.status}: ${text.slice(0, 200)}`);
        return false;
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch (_) {
        this.log('⚠️ Collect JSON parse fail');
        return false;
      }
      const paymentId = data.payment_id || data.razorpay_payment_id;
      if (!paymentId) {
        this.log(`⚠️ payment_id missing: ${text.slice(0, 200)}`);
        return false;
      }
      this.razorpay_payment_id = paymentId;
      this.log(`📲 UPI request sent · ${paymentId}`);
      return true;
    } catch (e) {
      this.log(`❌ Collect Error: ${e.message}`);
      return false;
    }
  }

  // ======================================================
  // STEP 5: Poll approval
  // ======================================================
  async poll_status() {
    const url = `https://api.razorpay.com/pg_router/v1/payments/${this.razorpay_payment_id}/status?key_id=${encodeURIComponent(this.rzp_key || '')}`;
    const headers = {
      accept: '*/*',
      'accept-language': this._acceptLanguage(),
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'https://checkout-hosted.razorpay.com',
      referer: 'https://api.razorpay.com/v1/checkout/public',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'x-session-token': this.session_token || '',
      'user-agent': navigator.userAgent,
    };

    this.panelStatus('UPI collect: approve in your UPI app (no QR)');
    const start = Date.now();
    const timeoutMs = 5 * 60 * 1000;

    while (Date.now() - start < timeoutMs) {
      try {
        const resp = await fetch(url, { method: 'GET', headers, credentials: 'include' });
        if (resp.status === 200) {
          const data = await resp.json();
          if (data && data.razorpay_signature) {
            this.razorpay_signature = data.razorpay_signature;
            this.final_order_id = data.razorpay_order_id || this.order_id;
            this.panelStatus('Payment Successful');
            this.log('✅ Payment authorized (signature)');
            return true;
          }
          const st = String(data && data.status || '').toLowerCase();
          if (st === 'failed' || st === 'rejected') {
            this.log(`❌ Payment ${st}`);
            this.panelStatus('UPI payment failed');
            return false;
          }
        }
        this.panelStatus('UPI collect: approve in your UPI app (no QR)');
        await new Promise((r) => setTimeout(r, 2000));
      } catch (e) {
        this.log(`⚠️ Poll Error: ${e.message}`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    this.panelStatus('UPI collect timed out — check your UPI app');
    this.log('❌ Poll timeout (5 min)');
    return false;
  }

  // ======================================================
  // STEP 6: Hosted complete → final encdata
  // ======================================================
  async complete_irctc_handover() {
    const url = `https://checkout-hosted.razorpay.com/irctc/complete/${this.url_order_id}?x_ranid=${this.x_ranid || ''}`;
    const payload = new URLSearchParams();
    payload.append('razorpay_hosted_id', this.order_id);
    payload.append('razorpay_order_id', this.final_order_id || this.order_id);
    payload.append('razorpay_payment_id', this.razorpay_payment_id);
    payload.append('razorpay_signature', this.razorpay_signature);

    const headers = {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'https://checkout-hosted.razorpay.com',
      referer: `https://checkout-hosted.razorpay.com/orders/${this.order_id}?x_ranid=${this.x_ranid || ''}`,
      'upgrade-insecure-requests': '1',
      'user-agent': navigator.userAgent,
      'Accept-Language': this._acceptLanguage(),
    };

    try {
      this.log('Razorpay complete callback…');
      const t0 = Date.now();
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: payload.toString(),
        credentials: 'include',
      });
      const html = await resp.text();
      if (this._flowLog) {
        this._flowLog.logHttp('POST', url, headers, '[signature]', resp.status, html.slice(0, 3000), t0);
      }
      if (resp.status !== 200) {
        this.log(`❌ Complete HTTP ${resp.status}`);
        return null;
      }
      const enc = this._extractEncdata(html);
      if (!enc) {
        this.log('❌ Final encdata missing');
        return null;
      }
      this.log('🎉 Final encdata OK');
      return enc;
    } catch (e) {
      this.log(`❌ Complete Error: ${e.message}`);
      return null;
    }
  }

  // ======================================================
  // STEP 7: BankResponse (Lexus PhonePe/Paytm parity)
  // ======================================================
  async submit_bank_response_direct(finalEncdata) {
    const GATE_SEC = 10.5;
    const startAt = this.gatewayEntryTime || Date.now();
    const elapsed = (Date.now() - startAt) / 1000;
    if (elapsed < GATE_SEC) {
      const wait_needed = GATE_SEC - elapsed;
      this.log(
        `✋ [TIME-GATE]: ${elapsed.toFixed(2)}s elapsed since PaymentRedirect. Waiting remaining ${wait_needed.toFixed(2)}s...`
      );
      await new Promise((r) => setTimeout(r, wait_needed * 1000));
    } else {
      this.log(`✅ [TIME-GATE]: ${elapsed.toFixed(2)}s already elapsed since PaymentRedirect. No extra wait.`);
    }

    const url = 'https://www.wps.irctc.co.in/eticketing/BankResponse';
    const ua = navigator.userAgent;
    const payload = new URLSearchParams();
    payload.append('encdata', finalEncdata);

    const headers = {
      'sec-ch-ua': this._secChUa(),
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      Origin: 'https://checkout-hosted.razorpay.com',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Upgrade-Insecure-Requests': '1',
      'User-Agent': ua,
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Sec-Fetch-Site': 'cross-site',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Dest': 'document',
      Referer: 'https://checkout-hosted.razorpay.com/',
      'Accept-Language': this._acceptLanguage(),
    };

    this.log('🏁 Firing BankResponse POST…');
    try {
      const t0 = Date.now();
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: payload.toString(),
        credentials: 'include',
        redirect: 'manual',
      });
      if (this._flowLog) {
        this._flowLog.logHttp(
          'POST',
          url,
          headers,
          '[encdata]',
          resp.status,
          `[redirect type=${resp.type}]`,
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
      this.log(`⚠️ Unexpected Status ${resp.status}.`);
      return false;
    } catch (e) {
      this.log(`❌ BankResponse Critical Error: ${e.message}`);
      return false;
    }
  }

  async verify_booking_confirm_page() {
    const url = 'https://www.irctc.co.in/nget/booking-confirm';
    const headers = {
      'sec-ch-ua-platform': '"Windows"',
      'User-Agent': navigator.userAgent,
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'sec-ch-ua': this._secChUa(),
      'Upgrade-Insecure-Requests': '1',
      'sec-ch-ua-mobile': '?0',
      'Sec-Fetch-Site': 'cross-site',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Dest': 'empty',
      Referer: 'https://checkout-hosted.razorpay.com/',
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

  // ======================================================
  // STEP 8: bookingData (Lexus Final Hit animation)
  // ======================================================
  async fetch_pnr_direct() {
    try {
      const api_url = `https://www.wps.irctc.co.in/eticketing/protected/mapps1/bookingData/${this.clientTxnId}`;
      const ua = navigator.userAgent;
      const headers = {
        greq: this.TOK.greq || '',
        Authorization: `Bearer ${this.TOK.access_token || ''}`,
        bmirak: 'webbm',
        'spa-csrf-token': this.TOK.csrf || '',
        bmiyek: this.TOK.refresh_token || '',
        'User-Agent': ua,
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
              resp.headers.get('spa-csrf-token') || resp.headers.get('csrf-token') || '';
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
              this.panelStatus(err);
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
      this.panelStatus(msg);
      this.log(`❌ PNR Fetch Critical Error: ${msg}`);
      return { ok: false, error: msg, note: msg };
    }
  }

  // ======================================================
  // MASTER
  // ======================================================
  async start_process() {
    this.log('🚀 Launching Razorpay UPI Collect');
    const vpa = this.vpa;
    if (!vpa || !vpa.includes('@')) {
      this.panelStatus('VPA missing — set UPI ID in Payment');
      this.log('❌ VPA required (e.g. 9xxxxxxxxx@paytm)');
      return { ok: false, error: 'VPA missing', note: 'VPA missing' };
    }

    const enc = await this.fetch_irctc_encdata();
    if (!enc) return false;

    if (!(await this.razorpay_handshake(enc))) return false;
    if (!(await this.load_checkout_page())) return false;
    if (!(await this.fetch_session_token())) return false;

    if (!(await this.trigger_collect_request(vpa))) return false;
    if (!(await this.poll_status())) return false;

    const finalEnc = await this.complete_irctc_handover();
    if (!finalEnc) return false;

    if (await this.submit_bank_response_direct(finalEnc)) {
      if (await this.verify_booking_confirm_page()) {
        return await this.fetch_pnr_direct();
      }
      this.log("⚠️ Confirmation page didn't return 200, trying PNR fetch anyway...");
      return await this.fetch_pnr_direct();
    }
    return false;
  }
}
