/**
 * Paytm UPI QR — Direct Host (PaymentRedirect off IRCTC browser), PhonePe parity.
 * HAR: bookingInitPayment bankId=117 → PaymentRedirect → processTransaction (embedded QR)
 *      → WebSocket DYNAMIC_QR SUCCESS → transactionStatus → BankResponse → bookingData
 */
class PaytmQRHandlerJS {
  constructor(userId, clientTxnId, TOK, onLog) {
    this.userId = userId;
    this.clientTxnId = clientTxnId;
    this.TOK = TOK || {};
    this.onLog = typeof onLog === 'function' ? onLog : null;
    this.gatewayEntryTime = 0;
    this.port = 'JS-Direct';
    this._ws = null;
    this._flowLog =
      typeof OceanQrFileLog !== 'undefined' ? OceanQrFileLog.create('Paytm QR') : null;
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

  getFileLogLines() {
    return this._flowLog ? this._flowLog.getLines() : [];
  }

  log(msg) {
    const line = String(msg);
    console.log(`[${this.port}] [Paytm-Direct] ${line}`);
    if (this._flowLog) this._flowLog.logUi(line);
    if (this.onLog) {
      this.onLog('Paytm: ' + line);
      return;
    }
    try {
      if (typeof window.__oceanPushPanelStatus === 'function') {
        window.__oceanPushPanelStatus('Paytm: ' + line);
      }
    } catch (_) {}
  }

  /** Panel status without Paytm: prefix (IRCTC error / Final Hit). */
  panelStatus(msg) {
    const line = String(msg || '').trim();
    if (!line) return;
    console.log(`[${this.port}] [Paytm-Direct] ${line}`);
    if (this._flowLog) this._flowLog.logUi(line);
    try {
      if (typeof window.__oceanPushPanelStatus === 'function') {
        window.__oceanPushPanelStatus(line);
        return;
      }
    } catch (_) {}
    if (this.onLog) this.onLog(line);
  }

  /** bookingData JSON → { pnr, error } (list/dict DTO + root errorMessage). */
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

  _extractFormAction(html) {
    const m = String(html || '').match(/<form[^>]*action=["']([^"']+)["']/i);
    return m && m[1] ? m[1] : '';
  }

  _decodePushAppData(html) {
    const m = String(html || '').match(/var\s+pushAppData\s*=\s*"([^"]+)"/);
    if (!m || !m[1]) return null;
    try {
      const raw = atob(m[1]);
      // unicode-safe decode (Paytm page uses %XX form)
      try {
        const decoded = decodeURIComponent(
          raw
            .split('')
            .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
            .join('')
        );
        return JSON.parse(decoded);
      } catch (_) {
        return JSON.parse(raw);
      }
    } catch (e) {
      this.log('pushAppData decode failed: ' + (e.message || e));
      return null;
    }
  }

  // ======================================================
  // STEP 1: WPS PaymentRedirect → Paytm form fields
  // ======================================================
  async fetch_paytm_redirect_form() {
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

      const mid = this._extractHidden(text, 'MID');
      const enc = this._extractHidden(text, 'ENC_DATA');
      const checksum = this._extractHidden(text, 'CHECKSUMHASH');
      let action = this._extractFormAction(text);
      if (!action && mid) {
        action = 'https://secure.paytmpayments.com/theia/processTransaction';
      }
      if (!mid || !enc || !checksum) {
        this.log(`⚠️ Paytm form incomplete. Status: ${resp.status}`);
        return null;
      }
      this.log('✅ Paytm redirect form captured (MID/ENC/CHECKSUM).');
      return { mid, enc, checksum, action };
    } catch (e) {
      this.log(`❌ WPS Direct Error: ${e.message}`);
      return null;
    }
  }

  // ======================================================
  // STEP 2: processTransaction → embedded QR (pushAppData)
  // ======================================================
  async process_transaction(form) {
    if (!form) return null;
    const ua = navigator.userAgent;
    const body = new URLSearchParams();
    body.append('MID', form.mid);
    body.append('ENC_DATA', form.enc);
    body.append('CHECKSUMHASH', form.checksum);

    let url = form.action || 'https://secure.paytmpayments.com/theia/processTransaction';
    if (!/orderid=/i.test(url)) {
      // order id often only known after init; action from WPS usually has it
    }

    this.log('Paytm processTransaction…');
    try {
      const t0 = Date.now();
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'content-type': 'application/x-www-form-urlencoded',
          origin: 'https://www.wps.irctc.co.in',
          referer: 'https://www.wps.irctc.co.in/',
          'user-agent': ua,
          'upgrade-insecure-requests': '1',
        },
        body: body.toString(),
        credentials: 'include',
        redirect: 'follow',
      });
      const html = await resp.text();
      if (this._flowLog) {
        this._flowLog.logHttp('POST', url, { 'content-type': 'application/x-www-form-urlencoded' }, body.toString(), resp.status, html, t0);
      }
      const app = this._decodePushAppData(html);
      if (!app) {
        this.log('❌ pushAppData missing in processTransaction HTML');
        return null;
      }
      const mid = (app.merchant && app.merchant.mid) || form.mid;
      const orderId = (app.txn && app.txn.id) || '';
      const txnToken = app.txnToken || '';
      const qrRaw = (app.qr && app.qr.dataurl) || '';
      if (!orderId || !qrRaw) {
        this.log('❌ orderId / QR missing in APP_DATA');
        return null;
      }
      this.log(`💎 Paytm QR ready (order ${orderId}).`);
      return {
        mid,
        orderId,
        txnToken,
        qr: qrRaw,
        processUrl: resp.url || url,
      };
    } catch (e) {
      this.log(`❌ processTransaction Error: ${e.message}`);
      return null;
    }
  }

  // ======================================================
  // STEP 3: WebSocket wait DYNAMIC_QR SUCCESS
  // ======================================================
  wait_ws_success(mid, orderId, timeoutMs = 360000) {
    const room = `${mid}_${orderId}`;
    const wsUrl = `wss://secure.paytmpayments.com/websocket/?DEVICE=web&ID=${encodeURIComponent(room)}`;
    this.log('WS: waiting DYNAMIC_QR…');

    return new Promise((resolve) => {
      let settled = false;
      let pingTimer = null;
      let cid = 1;
      const done = (val) => {
        if (settled) return;
        settled = true;
        try {
          if (pingTimer) clearInterval(pingTimer);
        } catch (_) {}
        try {
          if (this._ws) this._ws.close();
        } catch (_) {}
        this._ws = null;
        resolve(val);
      };

      const timer = setTimeout(() => {
        this.log('❌ WS timeout');
        done(null);
      }, timeoutMs);

      let ws;
      try {
        ws = new WebSocket(wsUrl);
        this._ws = ws;
      } catch (e) {
        clearTimeout(timer);
        this.log('❌ WS open failed: ' + (e.message || e));
        done(null);
        return;
      }

      ws.onopen = () => {
        try {
          ws.send(JSON.stringify({ event: '#handshake', data: { authToken: null }, cid: cid++ }));
        } catch (_) {}
      };

      ws.onmessage = (ev) => {
        const raw = String(ev.data || '');
        if (raw === '#1') {
          try {
            ws.send('#2');
          } catch (_) {}
          return;
        }
        let msg = null;
        try {
          msg = JSON.parse(raw);
        } catch (_) {
          return;
        }
        if (msg && msg.rid === 1) {
          try {
            ws.send(JSON.stringify({ event: 'JOIN_ROOMS', data: room }));
            pingTimer = setInterval(() => {
              try {
                if (ws.readyState === 1) ws.send('#2');
              } catch (_) {}
            }, 15000);
          } catch (_) {}
          return;
        }
        const data = msg && msg.data;
        if (data && typeof data === 'object') {
          const status = String(data.status || '').toUpperCase();
          const topic = String(data.topicName || '');
          if (status === 'SUCCESS' || topic === 'DYNAMIC_QR') {
            if (status === 'SUCCESS') {
              this.log('💎 WS SUCCESS (DYNAMIC_QR)');
              clearTimeout(timer);
              done(data);
            }
          } else if (status === 'FAILED' || status === 'FAILURE') {
            this.log('🛑 WS payment FAILED');
            clearTimeout(timer);
            done(null);
          }
        }
      };

      ws.onerror = () => {
        this.log('⚠️ WS error');
      };
      ws.onclose = () => {
        if (!settled) {
          clearTimeout(timer);
          this.log('⚠️ WS closed before SUCCESS');
          done(null);
        }
      };
    });
  }

  // ======================================================
  // STEP 4: transactionStatus → BankResponse form
  // ======================================================
  async fetch_bank_response_form(session, wsData) {
    const mid = session.mid;
    const orderId = session.orderId;
    const url = `https://secure.paytmpayments.com/theia/transactionStatus?MID=${encodeURIComponent(
      mid
    )}&ORDER_ID=${encodeURIComponent(orderId)}`;

    const body = new URLSearchParams();
    body.append('merchantId', wsData.merchantId || mid);
    body.append('acquirementId', wsData.acquirementId || '');
    body.append('cashierRequestId', wsData.cashierRequestId || '');
    body.append('paymentMode', wsData.paymentMode || 'UPI');
    body.append('orderId', wsData.orderId || orderId);
    body.append('topicName', wsData.topicName || 'DYNAMIC_QR');
    body.append('status', wsData.status || 'SUCCESS');
    body.append('_id', wsData._id || `${mid}_${orderId}`);
    body.append('transId', wsData.acquirementId || wsData.transId || '');

    this.log('transactionStatus…');
    try {
      const reqHeaders = {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://secure.paytmpayments.com',
        referer: session.processUrl || `https://secure.paytmpayments.com/theia/processTransaction?orderid=${orderId}`,
        'user-agent': navigator.userAgent,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'upgrade-insecure-requests': '1',
      };
      const t0 = Date.now();
      const resp = await fetch(url, {
        method: 'POST',
        headers: reqHeaders,
        body: body.toString(),
        credentials: 'include',
        redirect: 'follow',
      });
      const html = await resp.text();
      if (this._flowLog) {
        this._flowLog.logHttp('POST', url, reqHeaders, body.toString(), resp.status, html, t0);
      }
      const encMid = this._extractHidden(html, 'MID') || mid;
      const enc = this._extractHidden(html, 'ENC_DATA');
      const checksum = this._extractHidden(html, 'CHECKSUMHASH');
      if (!enc || !checksum) {
        this.log('❌ BankResponse fields missing in transactionStatus HTML');
        return null;
      }
      this.log('✅ BankResponse ENC_DATA captured.');
      return { mid: encMid, enc, checksum };
    } catch (e) {
      this.log(`❌ transactionStatus Error: ${e.message}`);
      return null;
    }
  }

  // ======================================================
  // STEP 5: BankResponse (time-gate 10.5s like PhonePe / MIN_PAYMENT_DURATION)
  // ======================================================
  async submit_bank_response_direct(bankForm) {
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
    payload.append('MID', bankForm.mid);
    payload.append('ENC_DATA', bankForm.enc);
    payload.append('CHECKSUMHASH', bankForm.checksum);

    this.log('🏁 Firing BankResponse POST…');
    try {
      const reqHeaders = {
        'sec-ch-ua': this._secChUa(),
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        Origin: 'https://secure.paytmpayments.com',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Upgrade-Insecure-Requests': '1',
        'User-Agent': ua,
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Dest': 'document',
        Referer: 'https://secure.paytmpayments.com/',
        'Accept-Language': this._acceptLanguage(),
      };
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
        this._flowLog.logHttp('POST', url, reqHeaders, payload.toString(), resp.status, bankText, t0);
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
      'User-Agent': navigator.userAgent,
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'sec-ch-ua': this._secChUa(),
      'Upgrade-Insecure-Requests': '1',
      'sec-ch-ua-mobile': '?0',
      Referer: 'https://secure.paytmpayments.com/',
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
              if (typeof window.__oceanReportBookingFull === 'function') {
                try {
                  await window.__oceanReportBookingFull(data);
                } catch (_) {}
              }
              this.panelStatus(`SUCCESS! PNR: ${pnr}`);
              this.log(`✅ 💎 PNR GENERATED: ${pnr}`);
              return { pnr, status: 'BOOKED', full_data: data };
            }
            // IRCTC fail → exact msg on panel + stop (no more retries)
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

  show_qr(qr_b64) {
    try {
      if (window.oceanDirectHost && typeof window.oceanDirectHost.showQr === 'function') {
        window.oceanDirectHost.showQr(qr_b64);
        this.log('🖼️ QR on ticket panel.');
        return;
      }
      const overlayId = 'paytm_qr_overlay';
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
      label.innerText = 'SCAN & PAY WITH PAYTM / UPI';
      Object.assign(label.style, { marginBottom: '10px', fontWeight: 'bold', color: '#002e6e' });
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
      if (window.oceanDirectHost && typeof window.oceanDirectHost.hideQr === 'function') {
        window.oceanDirectHost.hideQr();
      }
    } catch (_) {}
    try {
      const overlay = document.getElementById('paytm_qr_overlay');
      if (overlay) overlay.remove();
    } catch (_) {}
  }

  async start_process() {
    this.log('🚀 Launching Paytm Direct Engine');
    try {
      const form = await this.fetch_paytm_redirect_form();
      if (!form) return false;

      const session = await this.process_transaction(form);
      if (!session) return false;

      this.show_qr(session.qr);

      const wsData = await this.wait_ws_success(session.mid, session.orderId);
      if (!wsData) return false;

      const bankForm = await this.fetch_bank_response_form(session, wsData);
      if (!bankForm) return false;

      this.hide_qr();

      if (await this.submit_bank_response_direct(bankForm)) {
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
