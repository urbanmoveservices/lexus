class PhonePeQRHandlerJS {
    constructor(userId, clientTxnId, TOK, onLog) {
        this.userId = userId;
        this.clientTxnId = clientTxnId;
        this.TOK = TOK;
        this.onLog = typeof onLog === 'function' ? onLog : null;
        this.gatewayEntryTime = 0;
        this.port = "JS-Direct";
        this._flowLog =
            typeof OceanQrFileLog !== 'undefined' ? OceanQrFileLog.create('PhonePe QR') : null;
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
            const langs = navigator.languages && navigator.languages.length
                ? [...navigator.languages]
                : [navigator.language || 'en-US'];
            return langs.map((lang, i) => {
                const code = String(lang || '').trim();
                if (!code) return null;
                if (i === 0) return code;
                const q = Math.max(0.1, 1 - i * 0.1).toFixed(1);
                return `${code};q=${q}`;
            }).filter(Boolean).join(',');
        } catch (_) {
            return 'en-US,en;q=0.9';
        }
    }

   log(msg) {
        const line = String(msg);
        console.log(`[${this.port}] [PhonePe-Direct] ${line}`);
        if (this._flowLog) this._flowLog.logUi(line);
        if (this.onLog) {
            this.onLog('PhonePe: ' + line);
            return;
        }
        try {
            if (typeof window.__oceanPushPanelStatus === 'function') {
                window.__oceanPushPanelStatus('PhonePe: ' + line);
            }
        } catch (_) {}
    }

    /** Panel status without PhonePe: prefix (IRCTC error / Final Hit). */
    panelStatus(msg) {
        const line = String(msg || '').trim();
        if (!line) return;
        console.log(`[${this.port}] [PhonePe-Direct] ${line}`);
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

    _extractWpsToken(html) {
        const text = String(html || '');
        let match = text.match(/name=["']token["'][^>]+value=["']([^"']*)["']/i);
        if (match && match[1]) return match[1];
        match = text.match(/value=["']([^"']+)["'][^>]+name=["']token["']/i);
        if (match && match[1]) return match[1];
        match = text.match(/token=([A-Za-z0-9._\-+/=%]+)/i);
        if (match && match[1]) return decodeURIComponent(match[1]);
        return null;
    }

    // ======================================================
   async fetch_wps_token() {
        try {
            const ua = navigator.userAgent;
            const rand_val = Math.random() || 0.5;
            const ts = Date.now();
            const p1 = String(ts / (100000 * rand_val));
            const p2 = String(ts / (1000000 * rand_val));
            
            // ✅ POPUP se mila hua naya CSRF (jo aapne engine constructor mein pass kiya hai)
            const csrf = this.TOK.csrf || ''; 
            const access_token = this.TOK.access_token || '';
            const txn_key = `${this.userId}:${this.clientTxnId}`;
            
            // Payload tayyar
            const payload = new URLSearchParams();
            payload.append("token", access_token);
            payload.append("txn", txn_key);
            payload.append(txn_key, `${p1}${csrf}${p2}`);

            // 🎯 [FULL HEADERS]
            const headers = {
                "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
                "content-type": "application/x-www-form-urlencoded",
                "origin": "https://www.irctc.co.in",
                "referer": "https://www.irctc.co.in/",
                "user-agent": ua,
                "sec-ch-ua": this._secChUa(),
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": '"Windows"',
                "sec-fetch-dest": "document",
                "sec-fetch-mode": "navigate",
                "sec-fetch-site": "same-site",
                "sec-fetch-user": "?1",
                "upgrade-insecure-requests": "1",
                "accept-language": this._acceptLanguage()
            };

            this.gatewayEntryTime = Date.now();
            this.log("WPS: Direct Handshake...");

            const t0 = Date.now();
            let resp = await fetch("https://www.wps.irctc.co.in/eticketing/PaymentRedirect", {
                method: 'POST',
                headers: headers,
                body: payload.toString(),
                credentials: 'include',
                redirect: 'follow'
            });

            let text = await resp.text();
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

            let token = this._extractWpsToken(text);
            if (token) {
                this.log("✅ WPS Direct Token Captured.");
                return token;
            }

            // Some gateways return 302 with token only on Location / next hop
            resp = await fetch("https://www.wps.irctc.co.in/eticketing/PaymentRedirect", {
                method: 'POST',
                headers: headers,
                body: payload.toString(),
                credentials: 'include',
                redirect: 'manual'
            });

            if (resp.status >= 300 && resp.status < 400) {
                const loc = resp.headers.get('location') || resp.headers.get('Location');
                if (loc) {
                    this.log('WPS redirect → follow Location…');
                    const hop = await fetch(loc, {
                        method: 'GET',
                        credentials: 'include',
                        redirect: 'follow',
                        headers: {
                            accept: headers.accept,
                            'user-agent': ua,
                            referer: 'https://www.wps.irctc.co.in/',
                        },
                    });
                    text = await hop.text();
                    token = this._extractWpsToken(text);
                    if (token) {
                        this.log('✅ WPS Token from redirect hop.');
                        return token;
                    }
                }
            }

            this.log(`⚠️ WPS Token not found. Status: ${resp.status}`);
            return null;
        } catch (e) {
            this.log(`❌ WPS Direct Error: ${e.message}`);
            return null;
        }
    }
    // ======================================================
    // 🚀 STEP 2: PhonePe Transact (Direct Handshake)
    // ======================================================
    async post_to_mercury(pp_token) {
        if (!pp_token) return false;
        const url = "https://mercury-t2.phonepe.com/transact/sltv3";
        const ua = navigator.userAgent;

        const headers = {
            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "content-type": "application/x-www-form-urlencoded",
            "origin": "https://www.wps.irctc.co.in",
            "referer": "https://www.wps.irctc.co.in/",
            "user-agent": ua
        };

        const payload = new URLSearchParams();
        payload.append("token", pp_token);

        this.log("Handshaking with PhonePe...");
        try {
            const t0 = Date.now();
            const resp = await fetch(url, {
                method: 'POST',
                headers: headers,
                body: payload.toString(),
                credentials: 'include',
                redirect: 'manual'
            });
            if (this._flowLog) {
                this._flowLog.logHttp(
                    'POST',
                    url,
                    headers,
                    payload.toString(),
                    resp.status,
                    `[redirect type=${resp.type}]`,
                    t0
                );
            }
            
            // Browser mein manual redirect ka status 0 ya opaqueredirect aata hai
            if (resp.type === 'opaqueredirect' || resp.status === 0 || resp.status === 302 || resp.status === 200) {
                this.log("🤝 Mercury Direct Handshake Success.");
                return true;
            } else {
                this.log(`⚠️ Mercury Status: ${resp.status}`);
                return false;
            }
        } catch (e) {
            this.log(`❌ Mercury Handshake Error: ${e.message}`);
            return false;
        }
    }

    // ======================================================
    // 🚀 STEP 3 & 4: V2 API (Exchange & QR - Direct)
    // ======================================================
    async get_qr_direct(original_token) {
        try {
            const ua = navigator.userAgent;
            const exchange_url = "https://api.phonepe.com/apis/pg/checkout/ui/v2/token/exchange";
            
            const headers_exchange = {
                "x-auth-token": original_token, 
                "x-routing-key": "W",
                "User-Agent": ua, 
                "Origin": "https://mercury-t2.phonepe.com", 
                "Referer": "https://mercury-t2.phonepe.com/",
                "Accept": "application/json, text/plain, */*"
            };

            this.log("Exchanging V2 Token...");
            const ex_t0 = Date.now();
            const ex_resp = await fetch(exchange_url, {
                method: 'GET',
                headers: headers_exchange,
                credentials: 'omit'
            });
            
            const ex_text = ex_resp.status === 200 ? await ex_resp.text() : '';
            if (this._flowLog) {
                this._flowLog.logHttp('GET', exchange_url, headers_exchange, null, ex_resp.status, ex_text, ex_t0);
            }
            
            if (ex_resp.status !== 200) {
                this.log(`❌ Exchange Failed (${ex_resp.status})`);
                return null;
            }
            
            const ex_data = JSON.parse(ex_text);
            const ex_token = ex_data.token;
            this.log("💎 V2 Token Exchanged successfully.");

            const pay_url = "https://api.phonepe.com/apis/pg/checkout/ui/v2/pay";
            const headers_pay = {
                "x-auth-token": ex_token, 
                "Authorization": `Bearer ${ex_token}`,
                "x-routing-key": "W", 
                "User-Agent": ua, 
                "Content-Type": "application/json",
                "x-browser-fingerprint": "377224ab1e2e94d01efd35f7389b3e00", 
                "Origin": "https://mercury-t2.phonepe.com",
                "Referer": "https://mercury-t2.phonepe.com/",
                "Accept": "application/json, text/plain, */*"
            };
            
            const payload = { type: "UPI_QR" };
            this.log("Fetching Final QR...");
            
            const pay_t0 = Date.now();
            const pay_resp = await fetch(pay_url, {
                method: 'POST',
                headers: headers_pay,
                body: JSON.stringify(payload)
            });
            const pay_text = pay_resp.status === 200 ? await pay_resp.text() : '';
            if (this._flowLog) {
                this._flowLog.logHttp('POST', pay_url, headers_pay, payload, pay_resp.status, pay_text, pay_t0);
            }

            if (pay_resp.status === 200) {
                const pay_data = JSON.parse(pay_text);
                this.log("🖼️ QR Data Received.");
                return { qr: pay_data.qrData, token: ex_token };
            } else {
                this.log(`❌ Pay API Failed (${pay_resp.status})`);
                return null;
            }
        } catch (e) {
            this.log(`❌ QR Direct Error: ${e.message}`);
            return null;
        }
    }

    // ======================================================
    // 🚀 STEP 6 & 7: Polling & 9C Capture 
    // ======================================================
    async poll_and_capture_9c(ex_token) {
        const ua = navigator.userAgent;
        
        const headers_status = {
            "x-auth-token": ex_token, 
            "Authorization": `Bearer ${ex_token}`,
            "x-routing-key": "W", 
            "User-Agent": ua, 
            "x-browser-fingerprint": "377224ab1e2e94d01efd35f7389b3e00",
            "Origin": "https://mercury-t2.phonepe.com", 
            "Referer": "https://mercury-t2.phonepe.com/"
        };

        const headers_redirect = {
            "x-auth-token": ex_token, 
            "Authorization": `Bearer ${ex_token}`,
            "x-routing-key": "W", 
            "User-Agent": ua, 
            "Origin": "https://mercury-t2.phonepe.com",
            "Referer": "https://mercury-t2.phonepe.com/"
        };

        const start = Date.now();
        this.log("⏳ Status Polling started...");

        while ((Date.now() - start) < 360000) { // 180 sec (3 min) limit
            try {
                const resp = await fetch("https://api.phonepe.com/apis/pg/checkout/ui/v2/status", {
                    headers: headers_status
                });
                
                if (resp.status === 200) {
                    const data = await resp.json();
                    const state = data.state || "UNKNOWN";
                    this.log(`PhonePe: ${state}`);
                    
                    if (state === "COMPLETED") {
                        this.log("💎 Payment Success! Switching headers for 9C Capture...");
                        const r_resp = await fetch("https://api.phonepe.com/apis/pg/checkout/ui/v2/redirect-url", {
                            headers: headers_redirect
                        });
                        
                        if (r_resp.status === 200) {
                            const r_data = await r_resp.json();
                            const token_9c = r_data.notificationResponse?.response;
                            if (token_9c) {
                                this.log(`🔑 9C Token Secured (Len: ${token_9c.length})`);
                                return token_9c;
                            }
                        }
                        this.log("❌ Failed to fetch 9C even after COMPLETED.");
                        return null;
                    } else if (state === "FAILED") {
                        this.log("🛑 Payment FAILED at PhonePe.");
                        return null;
                    }
                }
                await new Promise(r => setTimeout(r, 1500)); // 1.5s delay
            } catch (e) {
                this.log(`⚠️ Polling Error: ${e.message}`);
                await new Promise(r => setTimeout(r, 1000));
            }
        }
        return null;
    }

    // ======================================================
    // 🚀 STEP 8: BankResponse (Direct Post with Time-Gate)
    // ======================================================
    async submit_bank_response_direct(token_9c) {
        // TIME-GATE: start = PaymentRedirect; BankResponse se pehle 10.5s complete hua ya nahi
        const GATE_SEC = 10.5;
        const startAt = this.gatewayEntryTime || Date.now();
        const elapsed = (Date.now() - startAt) / 1000;
        if (elapsed < GATE_SEC) {
            const wait_needed = GATE_SEC - elapsed;
            this.log(`✋ [TIME-GATE]: ${elapsed.toFixed(2)}s elapsed since PaymentRedirect. Waiting remaining ${wait_needed.toFixed(2)}s...`);
            await new Promise(r => setTimeout(r, wait_needed * 1000));
        } else {
            this.log(`✅ [TIME-GATE]: ${elapsed.toFixed(2)}s already elapsed since PaymentRedirect. No extra wait.`);
        }

        const url = "https://www.wps.irctc.co.in/eticketing/BankResponse";
        const ua = navigator.userAgent;

        const headers = {
            "sec-ch-ua": this._secChUa(),
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "Origin": "https://mercury-t2.phonepe.com",
            "Content-Type": "application/x-www-form-urlencoded",
            "Upgrade-Insecure-Requests": "1",
            "User-Agent": ua,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            "Sec-Fetch-Site": "cross-site",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Dest": "document",
            "Referer": "https://mercury-t2.phonepe.com/",
            "Accept-Language": this._acceptLanguage()
        };
        
        const payload = new URLSearchParams();
        payload.append("response", token_9c);

        this.log("🏁 Firing BankResponse Aggressive POST...");

        try {
            const t0 = Date.now();
            const resp = await fetch(url, {
                method: 'POST',
                headers: headers,
                body: payload.toString(),
                credentials: 'include',
                redirect: 'manual'
            });
            if (this._flowLog) {
                this._flowLog.logHttp(
                    'POST',
                    url,
                    headers,
                    payload.toString(),
                    resp.status,
                    `[redirect type=${resp.type}]`,
                    t0
                );
            }
            
            if (resp.type === 'opaqueredirect' || resp.status === 0 || resp.status === 302) {
                this.log(`💎 SUCCESS! IRCTC Accepted Payment.`);
                return true;
            } else if (resp.status === 200) {
                this.log("⏳ Status 200: Server processing... Waiting for final link.");
                return true; 
            } else {
                this.log(`⚠️ Unexpected Status ${resp.status}.`);
                return false;
            }
        } catch (e) {
            this.log(`❌ BankResponse Critical Error: ${e.message}`);
            return false;
        }
    }

    async verify_booking_confirm_page() {
        const url = "https://www.irctc.co.in/nget/booking-confirm";
        const ua = navigator.userAgent;

        const headers = {
            "sec-ch-ua-platform": '"Windows"',
            "User-Agent": ua,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            "sec-ch-ua": this._secChUa(),
            "Upgrade-Insecure-Requests": "1",
            "sec-ch-ua-mobile": "?0",
            "Sec-Fetch-Site": "cross-site",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Dest": "empty",
            "Referer": "https://mercury-t2.phonepe.com/",
            "Accept-Language": this._acceptLanguage()
        };
        
        this.log("Final Verification...");
        try {
            for (let attempt = 1; attempt <= 5; attempt++) {
                const resp = await fetch(url, { headers, credentials: 'include' });
                if (resp.status === 200) {
                    this.log("✅ Confirmation Page Verified (200 OK).");
                    return true;
                }
                await new Promise(r => setTimeout(r, 1000));
            }
            return false;
        } catch (e) {
            this.log(`❌ Confirm Page Error: ${e.message}`);
            return false;
        }
    }

    // ======================================================
    // 🚀 STEP 9 & 10: Final PNR (STAR-style — stop on IRCTC errorMessage)
    // ======================================================
    async fetch_pnr_direct() {
        try {
            const api_url = `https://www.wps.irctc.co.in/eticketing/protected/mapps1/bookingData/${this.clientTxnId}`;
            const ua = navigator.userAgent;

            const headers = {
                "greq": this.TOK.greq || '',
                "Authorization": `Bearer ${this.TOK.access_token || ''}`,
                "bmirak": "webbm",
                "spa-csrf-token": this.TOK.csrf || '',
                "bmiyek": this.TOK.refresh_token || '',
                "User-Agent": ua,
                "Accept": "application/json, text/plain, */*",
                "Content-Type": "application/x-www-form-urlencoded",
                "Origin": "https://www.irctc.co.in",
                "Referer": "https://www.irctc.co.in/",
                "sec-ch-ua-platform": '"Windows"',
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "same-site"
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
                            return { pnr: pnr, status: "BOOKED", full_data: data };
                        }

                        // IRCTC fail (No seats / No Transaction / berth not met / …) → status + stop
                        if (err) {
                            this.panelStatus(err);
                            this.log(`🛑 BOOKING FAILED: ${err}`);
                            return { ok: false, error: err, note: err };
                        }
                        
                        this.log(`⚠️ Attempt ${attempt}: No PNR yet.`);
                    } else {
                        this.log(`⚠️ API Status: ${resp.status} on attempt ${attempt}`);
                    }
                    await new Promise(r => setTimeout(r, 2000));
                } catch (e) {
                    this.log(`⚠️ PNR Request Error: ${e.message}`);
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
            this.panelStatus('PNR Fetch Timeout');
            this.log("❌ PNR Fetch Timeout (All attempts exhausted).");
            return { ok: false, error: 'PNR Fetch Timeout', note: 'PNR Fetch Timeout' };
        } catch (e) {
            const msg = e.message || String(e);
            this.panelStatus(msg);
            this.log(`❌ PNR Fetch Critical Error: ${msg}`);
            return { ok: false, error: msg, note: msg };
        }
    }

    // ======================================================
    // 🖥️ UI - Pop up QR in Browser 
    // ======================================================
    show_qr(qr_b64) {
        try {
            if (window.oceanDirectHost && typeof window.oceanDirectHost.showQr === 'function') {
                window.oceanDirectHost.showQr(qr_b64);
                this.log('🖼️ QR on ticket panel.');
                return;
            }

            const overlayId = "phonepe_qr_overlay";
            let overlay = document.getElementById(overlayId);
            if (overlay) overlay.remove();

            overlay = document.createElement('div');
            overlay.id = overlayId;
            Object.assign(overlay.style, {
                position: "fixed", top: "50%", left: "50%",
                transform: "translate(-50%, -50%)", zIndex: "999999",
                backgroundColor: "white", padding: "20px",
                boxShadow: "0 0 20px rgba(0,0,0,0.5)", borderRadius: "10px",
                textAlign: "center", fontFamily: "Arial, sans-serif"
            });

            const closeBtn = document.createElement('button');
            closeBtn.innerText = "X";
            Object.assign(closeBtn.style, {
                position: "absolute", top: "5px", right: "10px",
                background: "none", border: "none", fontSize: "16px", cursor: "pointer"
            });
            closeBtn.onclick = () => overlay.remove();

            // Base64 QR Image
            const img = document.createElement('img');
            img.src = qr_b64.startsWith('data:') ? qr_b64 : `data:image/png;base64,${qr_b64}`;
            Object.assign(img.style, { width: "200px", height: "200px", display: "block", margin: "10px auto" });

            const label = document.createElement('div');
            label.innerText = "SCAN & PAY WITH PHONEPE";
            Object.assign(label.style, { fontWeight: "bold", color: "#5f259f", marginTop: "10px" });

            overlay.appendChild(closeBtn);
            overlay.appendChild(img);
            overlay.appendChild(label);
            document.body.appendChild(overlay);

            this.log("🖼️ QR Displayed on screen.");
        } catch (e) {
            this.log(`❌ Error showing QR: ${e.message}`);
        }
    }

    hide_qr() {
        try {
            if (window.oceanDirectHost && typeof window.oceanDirectHost.hideQr === 'function') {
                window.oceanDirectHost.hideQr();
            }
        } catch (_) {}
        try {
            const overlay = document.getElementById('phonepe_qr_overlay');
            if (overlay) overlay.remove();
        } catch (_) {}
    }

    // ======================================================
    // 🏁 MASTER START (ASYNC)
    // ======================================================
    async start_process() {
        this.log(`🚀 Launching Direct Engine`);
        
        try {
            const orig = await this.fetch_wps_token();
            if (!orig) return false;
            
            if (!await this.post_to_mercury(orig)) return false;
            
            const bundle = await this.get_qr_direct(orig);
            if (!bundle) return false;
            
            this.show_qr(bundle.qr);
            
            const f_9c = await this.poll_and_capture_9c(bundle.token);
            if (f_9c) {
                this.hide_qr();
                
                if (await this.submit_bank_response_direct(f_9c)) {
                    if (await this.verify_booking_confirm_page()) {
                        return await this.fetch_pnr_direct();
                    } else {
                        this.log("⚠️ Confirmation page didn't return 200, trying PNR fetch anyway...");
                        return await this.fetch_pnr_direct();
                    }
                }
            }
            return false;
        } finally {
            this.hide_qr();
        }
    }
}