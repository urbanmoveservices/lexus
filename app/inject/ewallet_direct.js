/**
 * IRCTC eWallet — Direct API (STAR irctc_ewallet.py).
 * After bookingInitPayment bankId=1000 / txnType=7:
 *   wait ~11s → WPS verifyPayment/{cid} → PNR
 * No PaymentRedirect / BankResponse.
 *
 * Status (Ocean): Final Count → Final Hit For Pnr → SUCCESS! PNR
 */
class EwalletDirectHandlerJS {
  constructor(userId, clientTxnId, TOK, onLog, opts) {
    this.userId = userId;
    this.clientTxnId = clientTxnId;
    this.TOK = TOK || {};
    this.onLog = typeof onLog === 'function' ? onLog : null;
    this.initData = (opts && opts.initData) || {};
    this.csrf = String((opts && opts.csrf) || this.TOK.csrf || '').trim();
    this.waitMs = Number((opts && opts.waitMs) || 11000);
    this.port = 'JS-Direct';
  }

  log(msg) {
    const line = String(msg);
    console.log(`[${this.port}] [eWallet-Direct] ${line}`);
    if (this.onLog) {
      this.onLog('eWallet: ' + line);
      return;
    }
    try {
      if (typeof window.__oceanPushPanelStatus === 'function') {
        window.__oceanPushPanelStatus('eWallet: ' + line);
      }
    } catch (_) {}
  }

  /** Exact Ocean panel strings (Final Hit animation / success). */
  panelStatus(msg) {
    const line = String(msg || '').trim();
    if (!line) return;
    console.log(`[${this.port}] [eWallet-Direct] ${line}`);
    try {
      if (typeof window.__oceanPushPanelStatus === 'function') {
        window.__oceanPushPanelStatus(line);
        return;
      }
    } catch (_) {}
    if (this.onLog) this.onLog(line);
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

  /** Ocean iPay-style countdown (keeps Final Hit strip for exact status later). */
  async waitMinPaymentElapsed(waitMs) {
    const total = Math.max(0, Number(waitMs) || 11000);
    const start = Date.now();
    while (true) {
      const elapsed = Date.now() - start;
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

  buildVerifyPayload() {
    const full = this.initData || {};
    return {
      transationId: full.transationId != null ? full.transationId : 0,
      bankId: full.bankId != null ? full.bankId : 1000,
      txnType: full.txnType != null ? full.txnType : 7,
      txnStatus: full.txnStatus != null ? full.txnStatus : 12,
      txnDate: full.txnDate != null ? full.txnDate : null,
      amount: full.amount,
      serverId: full.serverId != null ? full.serverId : null,
      timeStamp: full.timeStamp != null ? full.timeStamp : null,
      upiModeOpted: full.upiModeOpted != null ? full.upiModeOpted : 0,
      remainingBalance: full.remainingBalance != null ? full.remainingBalance : 0.0,
      loyaltyNum: full.loyaltyNum != null ? full.loyaltyNum : 0,
      withoutOTP: true,
      paramList: [{ key: 'OTP' }, { key: 'TXN_TYPE', value: 'undefined' }],
    };
  }

  async verifyPayment() {
    const cid = String(this.clientTxnId || '').trim();
    if (!cid) {
      this.panelStatus('clientTxnId missing');
      return { ok: false, error: 'clientTxnId missing' };
    }
    const access = this.TOK.access_token || '';
    if (!access) {
      this.panelStatus('access_token missing');
      return { ok: false, error: 'access_token missing' };
    }

    const url = `https://www.wps.irctc.co.in/eticketing/protected/mapps1/verifyPayment/${cid}`;
    const payload = this.buildVerifyPayload();
    const csrf = this.csrf || this.TOK.csrf || '';
    const headers = {
      accept: 'application/json, text/plain, */*',
      authorization: `Bearer ${access}`,
      bmirak: 'webbm',
      bmiyek: this.TOK.refresh_token || '',
      'content-type': 'application/json; charset=UTF-8',
      greq: this.TOK.greq || '',
      'spa-csrf-token': csrf,
      referer: 'https://www.irctc.co.in/',
      'user-agent': navigator.userAgent,
      'sec-ch-ua': this._secChUa(),
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      origin: 'https://www.irctc.co.in',
      'sec-fetch-site': 'same-site',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
    };

    this.log(`verifyPayment/${cid}…`);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        credentials: 'include',
      });
      try {
        const newTok =
          resp.headers.get('spa-csrf-token') ||
          resp.headers.get('csrf-token') ||
          '';
        if (newTok) {
          this.TOK.csrf = newTok;
          this.csrf = newTok;
        }
      } catch (_) {}

      const text = await resp.text();
      this.log(`verifyPayment ← ${resp.status} len=${text.length}`);

      if (resp.status !== 200) {
        const msg = `verifyPayment HTTP ${resp.status}`;
        this.panelStatus(msg);
        return { ok: false, error: msg };
      }

      let data = null;
      try {
        data = JSON.parse(text);
      } catch (_) {
        this.panelStatus('verifyPayment JSON error');
        return { ok: false, error: 'verifyPayment JSON error' };
      }

      const { pnr, error: err } = this._parseBookingDataPayload(data);
      if (pnr) {
        if (typeof window.__oceanReportBookingFull === 'function') {
          try {
            await window.__oceanReportBookingFull(data);
          } catch (_) {}
        }
        this.panelStatus(`SUCCESS! PNR: ${pnr}`);
        this.log(`✅ PNR: ${pnr}`);
        return { pnr, status: 'BOOKED', full_data: data };
      }
      if (err) {
        this.panelStatus(err);
        this.log(`🛑 FAILED: ${err}`);
        return { ok: false, error: err, note: err };
      }
      this.panelStatus('PNR not found');
      return { ok: false, error: 'PNR not found' };
    } catch (e) {
      const msg = e.message || String(e);
      this.panelStatus(msg);
      this.log(`❌ verifyPayment error: ${msg}`);
      return { ok: false, error: msg };
    }
  }

  async start_process() {
    this.log('🚀 eWallet Direct — wait then verifyPayment');
    await this.waitMinPaymentElapsed(this.waitMs);
    // Exact string → Ocean panel Final Hit animation (same as PhonePe/Paytm/Razorpay)
    this.panelStatus('Final Hit For Pnr');
    return await this.verifyPayment();
  }
}
