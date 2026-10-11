// IRCTC booking APIs — direct fetch (PhonePe jaisa), IRCTC tab inject nahi
class IrctcDirectBookingJS {
    constructor(TOK, onLog) {
        this.TOK = TOK || {};
        this.BASE = 'https://www.irctc.co.in';
        this.port = 'JS-Direct';
        this.onLog = typeof onLog === 'function' ? onLog : null;
        this.lastClientTxnId = null;
        this._callSeq = 0;
        this._runStartedAt = new Date();
        this._fileLogLines = [];
        this._logDownloaded = false;
        this.fileLog(`=== IRCTC Direct Booking RUN LOG ===`);
        this.fileLog(`started: ${this._runStartedAt.toISOString()}`);
        this.fileLog('');
    }

    fileLog(line) {
        this._fileLogLines.push(String(line));
    }

    _maskSecret(v, keep = 8) {
        const s = String(v || '');
        if (!s) return '';
        if (s.length <= keep * 2) return `${s.slice(0, 2)}…(${s.length})`;
        return `${s.slice(0, keep)}…${s.slice(-4)} (len=${s.length})`;
    }

    _headersForLog(headers) {
        const h = { ...(headers || {}) };
        if (h.authorization) h.authorization = `Bearer ${this._maskSecret(String(h.authorization).replace(/^Bearer\s+/i, ''))}`;
        if (h.bmiyek) h.bmiyek = this._maskSecret(h.bmiyek);
        if (h['spa-csrf-token']) h['spa-csrf-token'] = this._maskSecret(h['spa-csrf-token'], 6);
        return h;
    }

    _bodyForLog(body) {
        if (body == null) return '(none)';
        let text = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
        // huge base64 (captcha) redact
        text = text.replace(/"captchaQuestion"\s*:\s*"[^"]{80,}"/g,
            '"captchaQuestion":"[BASE64_REDACTED]"');
        text = text.replace(/data:image\/[a-zA-Z+]+;base64,[A-Za-z0-9+/=]{80,}/g,
            'data:image…;[BASE64_REDACTED]');
        if (text.length > 50000) {
            return text.slice(0, 50000) + `\n… [TRUNCATED total=${text.length}]`;
        }
        return text;
    }

    /** Har run end pe .txt download (Downloads folder) */
    downloadRunLog(note = '') {
        if (this._logDownloaded) return null;
        this._logDownloaded = true;
        const ended = new Date();
        this.fileLog('');
        this.fileLog(`=== END ===`);
        this.fileLog(`ended: ${ended.toISOString()}`);
        if (note) this.fileLog(`note: ${note}`);
        this.fileLog(`calls: ${this._callSeq}`);

        const stamp = ended.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
        const filename = `irctc-direct-run_${stamp}.txt`;
        const blob = new Blob([this._fileLogLines.join('\n')], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            URL.revokeObjectURL(url);
            a.remove();
        }, 1500);
        // File-only note — panel status pe mat bhejo (Success overwrite ho jata tha)
        this.fileLog(`📄 Run log saved: ${filename}`);
        console.log(`[${this.port}] [IRCTC-Direct] 📄 Run log saved: ${filename}`);
        return filename;
    }

    log(msg) {
        console.log(`[${this.port}] [IRCTC-Direct] ${msg}`);
        this.fileLog(`[UI] ${msg}`);
        if (this.onLog) this.onLog(msg);
    }

    /** AVAILABLE-0073 → 73; RAC/WL → 0 from this helper */
    seatsFromAvailStatus(statusStr) {
        const raw = String(statusStr || '').trim();
        const m = raw.match(/AVAILABLE[-\s]*(\d+)/i);
        if (!m) return 0;
        const n = parseInt(m[1], 10);
        return Number.isFinite(n) ? n : 0;
    }

    parseAvailKind(statusStr) {
        const raw = String(statusStr || '').trim();
        const s = raw.toUpperCase().replace(/\s+/g, ' ');
        // `#` = quota/class not open yet. Empty ≠ closed (addon has no avlDayList).
        if (!s) return { kind: 'unknown', raw };
        if (s.includes('#')) return { kind: 'closed', raw };
        if (/^AVAILABLE/i.test(s)) return { kind: 'available', raw };
        if (/\bRAC\b/.test(s)) return { kind: 'rac', raw };
        if (/\bWL\b/.test(s) || /WAITLIST/.test(s) || /GNWL|TQWL|PQWL|RLWL|CKWL/.test(s)) return { kind: 'wl', raw };
        if (/NOT AVAILABLE|REGRET|TRAIN DEPARTED|CANCELLED|NOT AVL/.test(s)) return { kind: 'unavailable', raw };
        return { kind: 'unknown', raw };
    }

    /** User-facing status for REGRET / NOT AVAILABLE / etc. */
    seatStopPanelStatus(statusStr, errorMessage) {
        const err = String(errorMessage || '').trim();
        if (err) {
            if (/no seats?\s*available/i.test(err)) return 'No seats available';
            if (/not available|not avl/i.test(err)) return 'NOT AVAILABLE';
            if (/regret/i.test(err)) return 'REGRET';
            if (/train departed/i.test(err)) return 'TRAIN DEPARTED';
            if (/cancelled/i.test(err)) return 'CANCELLED';
        }
        const st = String(statusStr || '').trim();
        if (!st) return null;
        const p = this.parseAvailKind(st);
        if (p.kind === 'closed') return 'Seat not open';
        if (p.kind === 'unavailable') {
            if (/REGRET/i.test(p.raw)) return 'REGRET';
            if (/TRAIN DEPARTED/i.test(p.raw)) return 'TRAIN DEPARTED';
            if (/CANCELLED/i.test(p.raw)) return 'CANCELLED';
            if (/NOT AVAILABLE|NOT AVL/i.test(p.raw)) return 'NOT AVAILABLE';
            return String(p.raw || 'NOT AVAILABLE').slice(0, 40);
        }
        return null;
    }

    /** Confirm-berth ON → RAC/WL block; OFF → RAC/WL proceed; NOT AVAILABLE always block */
    checkProceedAfterAllLap(avlStatus, bookOnlyIfCnf = true) {
        const p = this.parseAvailKind(avlStatus);
        const cnfOnly = bookOnlyIfCnf !== false;
        if (p.kind === 'available') return { ok: true, panelStatus: null, kind: p.kind };
        if (p.kind === 'rac') {
            if (cnfOnly) {
                return {
                    ok: false,
                    kind: p.kind,
                    panelStatus: 'RAC · No seat available',
                    error: 'RAC · No seat available',
                };
            }
            return { ok: true, kind: p.kind, panelStatus: 'RAC · Proceeding booking', proceedAs: 'rac' };
        }
        if (p.kind === 'wl') {
            if (cnfOnly) {
                return {
                    ok: false,
                    kind: p.kind,
                    panelStatus: 'WL · No seat available',
                    error: 'WL · No seat available',
                };
            }
            return { ok: true, kind: p.kind, panelStatus: 'WL · Proceeding booking', proceedAs: 'wl' };
        }
        if (p.kind === 'closed') {
            return {
                ok: false,
                kind: p.kind,
                panelStatus: 'Seat not open',
                error: 'Seat not open',
            };
        }
        const msg = this.seatStopPanelStatus(avlStatus) || 'NOT AVAILABLE';
        return {
            ok: false,
            kind: p.kind === 'unavailable' ? p.kind : 'unavailable',
            panelStatus: msg,
            error: msg,
        };
    }

    pushPanelAvailFromStatus(statusStr, amount, phase) {
        const p = this.parseAvailKind(statusStr);
        const a = Number(amount);
        let amtTxt = 0;
        if (Number.isFinite(a) && a > 0) {
            amtTxt = Number.isInteger(a) ? a : Math.round(a * 10) / 10;
        }
        let label = 'Available';
        let seats = 0;
        if (p.kind === 'available') {
            seats = this.seatsFromAvailStatus(statusStr);
        } else if (p.kind === 'rac') {
            label = 'RAC';
            const m = String(statusStr).match(/RAC\s*(\d+)/i);
            seats = m ? parseInt(m[1], 10) : 0;
        } else if (p.kind === 'wl') {
            label = 'WL';
            const m = String(statusStr).match(/(?:GNWL|TQWL|PQWL|RLWL|CKWL|WL)\s*(\d+)/i);
            seats = m ? parseInt(m[1], 10) : 0;
        }
        this.log(`${label}-${seats}|${amtTxt}`);
        if (phase) this.fileLog(`[panel:${phase}] ${label}-${seats}|${amtTxt}`);
    }

    /** HAR: totalCollectibleAmount preferred; totalFare fallback */
    pickCollectibleAmount(...candidates) {
        for (const v of candidates) {
            if (v == null || v === '') continue;
            const n = Number(v);
            if (Number.isFinite(n) && n > 0) return n;
        }
        return 0;
    }

    /** Panel clock row: Available-seats|amount (phase: avl | lap) */
    pushPanelAvailable(seats, amount, phase) {
        const s = Number(seats);
        const a = Number(amount);
        const seatTxt = Number.isFinite(s) && s >= 0 ? Math.trunc(s) : 0;
        let amtTxt = 0;
        if (Number.isFinite(a) && a > 0) {
            amtTxt = Number.isInteger(a) ? a : Math.round(a * 10) / 10;
        }
        this.log(`Available-${seatTxt}|${amtTxt}`);
        if (phase) this.fileLog(`[panel:${phase}] Available-${seatTxt}|${amtTxt}`);
    }

    metricsFromAvlFareResponse(data) {
        const root = data || {};
        const day0 = root.avlDayList?.[0] || {};
        const seats = this.seatsFromAvailStatus(day0.availablityStatus);
        const amount = this.pickCollectibleAmount(
            root.totalCollectibleAmount,
            root.totalFare,
            root.totalFareAmount,
            day0.totalCollectibleAmount,
            day0.totalFare,
            day0.fare
        );
        return { seats, amount };
    }

    metricsFromLapResponse(data) {
        const root = data || {};
        const dto0 = root.avlFareResponseDTO?.[0] || {};
        const day0 = dto0.avlDayList?.[0] || {};
        const seats = this.seatsFromAvailStatus(
            day0.availablityStatus || dto0.availabilityStatus || root.availabilityStatus
        );
        const amount = this.pickCollectibleAmount(
            root.totalCollectibleAmount,
            dto0.totalCollectibleAmount,
            dto0.totalFare,
            dto0.totalCollectibleAmt,
            day0.totalCollectibleAmount,
            day0.totalFare,
            day0.fare
        );
        return { seats, amount };
    }

    // REAL browser HAR-matched headers (direct fetch; no IRCTC-tab inject)
    makeHeaders(referer, csrf) {
        const ua = navigator.userAgent;
        const tokenCsrf = csrf || this.TOK.csrf || '';
        // sec-ch-ua Chrome se auto; DNR sec-fetch-site + Referer force karega
        return {
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'en-US,en;q=0.0',
            'content-type': 'application/json; charset=UTF-8',
            'content-language': 'en',
            'authorization': `Bearer ${this.TOK.access_token || ''}`,
            'bmiyek': this.TOK.refresh_token || '',
            'greq': this.TOK.greq || '',
            'bmirak': 'webbm',
            'origin': 'https://www.irctc.co.in',
            'referer': referer || 'https://www.irctc.co.in/nget/train-search',
            'user-agent': ua,
            ...(tokenCsrf ? { 'spa-csrf-token': String(tokenCsrf) } : {})
        };
    }

    /**
     * 510 + Unable to Process / Client IP — alag case (high-load nahi).
     * allLap pe: 10s gap, max 3 retries, phir script stop.
     */
    isClientIpBlock(status, text) {
        if (Number(status) !== 510) return false;
        const body = String(text || '');
        return (
            /Unable to Process Request/i.test(body) ||
            /Client IP\s*:/i.test(body)
        );
    }

    isAkamaiBlock(status, text) {
        // Client-IP 510 alag handler me jata hai — yahan high-load / generic block
        if (this.isClientIpBlock(status, text)) return false;
        const body = String(text || '');
        const low = body.toLowerCase();
        return status === 510 || status === 503 || status === 403 ||
            body.includes('Akamai HTML Blocked') ||
            body.includes('We are experiencing High Load - Please retry') ||
            body.includes('An error occurred while processing your request') ||
            low.includes('high load') ||
            low.includes('please retry') ||
            low.includes('too many requests') ||
            (low.includes('<html') && (low.includes('reference #') || low.includes('access denied') || low.includes('blocked')));
    }

    /**
     * 401 invalid_token / Invalid access token — hard stop, no retry.
     * @returns {string|null} user-facing status message, or null if not this error
     */
    isInvalidAccessToken(status, data, text) {
        const body = String(text || '');
        const err = String(
            (data && (data.error || data.error_description || data.errorMessage || data.message)) ||
                ''
        );
        const blob = `${err}\n${body}`.toLowerCase();
        const hit =
            blob.includes('invalid_token') ||
            blob.includes('invalid access token') ||
            (Number(status) === 401 && blob.includes('access token'));
        if (!hit) return null;
        const desc = String(
            (data && (data.error_description || data.errorMessage || data.error)) ||
                'Invalid access token'
        ).trim();
        return desc.length > 120 ? `${desc.slice(0, 117)}…` : desc || 'Invalid access token';
    }

    /** Throw after showing panel status — never retry this error. */
    stopOnInvalidToken(res) {
        const msg = this.isInvalidAccessToken(res?.status, res?.data, res?.text);
        if (!msg) return false;
        this.log(`TOKEN EXPIRED · ${msg}`);
        const err = new Error(`TOKEN EXPIRED · ${msg}`);
        err.code = 'INVALID_TOKEN';
        err.fatal = true;
        throw err;
    }

    /** allLap success ke liye avlFareResponseDTO[0] chahiye; warna high-load/incomplete → retry */
    isAllLapIncomplete(res) {
        if (!res) return true;
        // invalid_token must NOT be treated as incomplete/retryable
        if (this.isInvalidAccessToken(res.status, res.data, res.text)) return false;
        if (this.isClientIpBlock(res.status, res.text)) return true;
        if (this.isAkamaiBlock(res.status, res.text)) return true;
        const dto0 = res?.data?.avlFareResponseDTO?.[0];
        if (!dto0) return true;
        // captcha path OK even without avlDayList status sometimes
        if (res?.data?.captchaDto?.captchaQuestion) return false;
        const st = dto0?.avlDayList?.[0]?.availablityStatus;
        // dto0 mila but status missing → incomplete / load issue → retry
        if (!st) return true;
        return false;
    }

    /**
     * allLapAvlFareEnq retry policy:
     * - 510 Unable to Process / Client IP → wait 10s, max 3 tries, then stop
     * - high-load / incomplete → existing longDelay retry (up to 100)
     */
    async requestAllLapWithPolicy(load) {
        const path = '/eticketing/protected/mapps1/allLapAvlFareEnq/Y';
        const opts = {
            method: 'POST',
            body: load,
            referer: 'https://www.irctc.co.in/nget/booking/psgninput',
        };
        const statusLabel = 'Passenger Submit';
        const maxHighLoad = 100;
        let clientIpFails = 0;
        let highLoadAttempt = 0;
        let res = null;

        this.log(statusLabel);

        while (true) {
            res = await this.request(path, opts);

            // 401 invalid_token → status + stop (no retry)
            this.stopOnInvalidToken(res);

            if (this.isClientIpBlock(res.status, res.text)) {
                clientIpFails += 1;
                this.log(`${statusLabel} (${clientIpFails}) (510/Client IP)`);
                if (clientIpFails >= 3) {
                    const panelMsg = `${statusLabel} (${clientIpFails}) (510/Client IP)`;
                    const err = new Error(
                        '510 Unable to Process / Client IP — 3 retries failed. Script stop.'
                    );
                    err.panelStatus = panelMsg;
                    err.code = 'CLIENT_IP_510';
                    throw err;
                }
                await new Promise((r) => setTimeout(r, 10000));
                continue;
            }

            const blocked = this.isAkamaiBlock(res.status, res.text);
            const incomplete = this.isAllLapIncomplete(res);
            const ok = res.status === 200 && !blocked && !incomplete;

            if (ok || res?.data?.captchaDto?.captchaQuestion) {
                return res;
            }

            highLoadAttempt += 1;
            const why = blocked ? ' (Akamai/high-load)' : ' (seat not open)';
            this.log(`${statusLabel} (${highLoadAttempt})${why}`);
            if (highLoadAttempt >= maxHighLoad) {
                return res;
            }
            const wait = Math.floor(Math.random() * (3000 - 1000 + 1)) + 1000;
            await new Promise((r) => setTimeout(r, wait));
        }
    }

    async request(path, { method = 'GET', body = null, referer = null } = {}) {
        const url = path.startsWith('http') ? path : `${this.BASE}${path}`;
        const headers = this.makeHeaders(referer, this.TOK.csrf);
        const seq = ++this._callSeq;
        const t0 = Date.now();

        console.log('--------------------------------------------------');
        console.log(`🚀 [DEBUG] Direct ${method} ${url}`);
        console.table(headers);
        if (body != null) console.log('📦 [DEBUG] Body:', typeof body === 'string' ? body : JSON.stringify(body).slice(0, 800));
        console.log('--------------------------------------------------');

        this.fileLog('============================================================');
        this.fileLog(`#${seq} REQUEST  ${new Date().toISOString()}`);
        this.fileLog(`${method} ${url}`);
        this.fileLog('--- headers ---');
        this.fileLog(JSON.stringify(this._headersForLog(headers), null, 2));
        this.fileLog('--- body ---');
        this.fileLog(this._bodyForLog(body));

        let resp;
        try {
            resp = await fetch(url, {
                method,
                headers,
                body: body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
                credentials: 'include'
            });
        } catch (netErr) {
            this.fileLog(`--- RESPONSE (network error after ${Date.now() - t0}ms) ---`);
            this.fileLog(String(netErr?.message || netErr));
            this.fileLog('');
            throw netErr;
        }

        const newCsrf =
          resp.headers.get('csrf-token') ||
          resp.headers.get('spa-csrf-token') ||
          '';
        if (newCsrf) this.TOK.csrf = newCsrf;

        const text = await resp.text();
        let data = null;
        try { data = JSON.parse(text); } catch {}

        this.fileLog(`--- RESPONSE  status=${resp.status}  ${Date.now() - t0}ms ---`);
        if (newCsrf) this.fileLog(`csrf-token(header): ${this._maskSecret(newCsrf, 6)}`);
        this.fileLog(this._bodyForLog(text));
        this.fileLog('');

        return {
            status: resp.status,
            data,
            text,
            csrf: newCsrf || this.TOK.csrf
        };
    }

    async requestWithRetry(path, opts = {}, {
        maxRetries = 100,
        delayMs = 300,
        longDelay = false,
        acceptStatus = null,
        extraRetry = null,
        statusLabel = null,
    } = {}) {
        let res;
        let clientIpFails = 0;
        if (statusLabel) this.log(statusLabel);
        for (let i = 0; i < maxRetries; i++) {
            res = await this.request(path, opts);
            // 401 invalid_token → status + stop immediately (no retry)
            this.stopOnInvalidToken(res);
            const clientIp = this.isClientIpBlock(res.status, res.text);
            const blocked = this.isAkamaiBlock(res.status, res.text);
            const ok = res.status === 200 && !blocked && !clientIp;
            const accept = acceptStatus && acceptStatus(res);
            const needExtra = extraRetry && extraRetry(res);

            if ((ok && !needExtra) || accept) return res;

            if (clientIp) {
                clientIpFails += 1;
                const why = ' (510/Client IP)';
                const attempt = clientIpFails;
                if (statusLabel) this.log(`${statusLabel} (${attempt})${why}`);
                else this.log(`⚠️ Retry ${attempt}/3 status=${res.status}${why}`);
                if (clientIpFails >= 3) return res;
                await new Promise((r) => setTimeout(r, 10000));
                continue;
            }

            const why = blocked
                ? ' (Akamai/high-load)'
                : needExtra
                  ? ' (seat not open)'
                  : '';
            const attempt = i + 1;
            if (statusLabel) {
                this.log(`${statusLabel} (${attempt})${why}`);
            } else {
                this.log(`⚠️ Retry ${attempt}/${maxRetries} status=${res.status}${why}`);
            }
            if (i < maxRetries - 1) {
                const wait = longDelay
                    ? Math.floor(Math.random() * (3000 - 1000 + 1)) + 1000
                    : delayMs;
                await new Promise((r) => setTimeout(r, wait));
            }
        }
        return res;
    }

    genClientTxnId(len = 8) {
        const c = 'abcdefghijklmnopqrstuvwxyz0123456789';
        const b = new Uint8Array(len);
        crypto.getRandomValues(b);
        let s = '';
        for (let i = 0; i < len; i++) s += c[b[i] % c.length];
        return s;
    }

    mapPassenger(p, i) {
        return {
            passengerName: String(p.name).trim().slice(0, 16),
            passengerAge: Number(p.age),
            passengerGender: (String(p.gender || '').toUpperCase() === 'F' ? 'F' : 'M'),
            passengerBerthChoice: '',
            passengerFoodChoice: null,
            passengerFoodChoiceBackUp: 'D',
            passengerBedrollChoice: null,
            passengerNationality: 'IN',
            passengerCardTypeMaster: null,
            passengerCardNumberMaster: null,
            psgnConcType: null,
            psgnConcCardId: null,
            psgnConcDOB: null,
            psgnConcCardExpiryDate: null,
            psgnConcDOBP: null,
            softMemberId: null,
            softMemberFlag: null,
            psgnConcCardExpiryDateP: null,
            passengerVerified: false,
            masterPsgnId: null,
            mpMemberFlag: null,
            passengerForceNumber: null,
            passConcessionType: '0',
            passUPN: null,
            passBookingCode: null,
            passengerSerialNumber: i + 1,
            childBerthFlag: true,
            passengerCardType: 'NULL_IDCARD',
            passengerIcardFlag: false,
            passengerCardNumber: null
        };
    }

    // -------- Step 0: validateUser / CSRF --------
    async ensureFreshTokens() {
        this.log('Refreshing session (validateUser)...');
        const path = '/eticketing/protected/mapps1/validateUser?source=3';
        const referer = 'https://www.irctc.co.in/nget/train-search';

        let r = await this.request(path, { method: 'GET', referer });
        // invalid_token → stop 1st hit (no retry)
        this.stopOnInvalidToken(r);
        if (r.status === 401) {
            // other 401 (not invalid_token body) — one soft retry only
            r = await this.request(path, { method: 'GET', referer });
            this.stopOnInvalidToken(r);
            if (r.status === 200 && r.csrf) {
                await this.request(path, { method: 'GET', referer });
            }
        }
        if (!this.TOK.csrf) throw new Error('Token refresh failed (no CSRF). Re-login.');
        this.log('Session OK');
        return this.TOK;
    }

    // -------- Step 1: altAvlEnq --------
    async fetchTrainList(details) {
        this.log('Direct: altAvlEnq...');
        const body = {
            concessionBooking: false,
            srcStn: details.from,
            destStn: details.to,
            jrnyClass: details.cls,
            jrnyDate: details.date,
            quotaCode: details.quota,
            ticketType: 'E',
            currentBooking: 'false',
            flexiFlag: false,
            ftBooking: false,
            handicapFlag: false,
            loyaltyRedemptionBooking: false
        };
        const res = await this.requestWithRetry(
            '/eticketing/protected/mapps1/altAvlEnq/TC',
            {
                method: 'POST',
                body,
                referer: 'https://www.irctc.co.in/nget/train-search'
            },
            { maxRetries: 20, delayMs: 400 }
        );
        if (res.status >= 400) throw new Error(`Train list failed: ${JSON.stringify(res.data)}`);
        this.log('altAvlEnq OK');
        return res;
    }

    // -------- Step 2: avlFarenquiry (+ quota wait) --------
    async fetchAvailabilityFare(details) {
        const q = String(details.quota || '').toUpperCase().trim();
        const c = String(details.cls || '').toUpperCase().trim();
        let targetH = 0;
        if (q === 'GN') targetH = 7;
        else if (q === 'TQ' || q === 'PT') targetH = ['1A', '2A', '3A', '3E', 'CC', 'EC'].includes(c) ? 9 : 10;

        if (targetH > 0) {
            const target = new Date();
            target.setHours(targetH, 59, 59, 0);
            while (true) {
                const left = target.getTime() - Date.now();
                if (left <= 0) break;
                this.log(`⏳ Waiting for ${q} booking... ${Math.ceil(left / 1000)}s`);
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        const path = `/eticketing/protected/mapps1/avlFarenquiry/${details.trainNo}/${details.date}/${details.from}/${details.to}/${details.cls}/${details.quota}/N`;
        const body = {
            paymentFlag: 'N',
            concessionBooking: false,
            ftBooking: false,
            loyaltyRedemptionBooking: false,
            ticketType: 'E',
            classCode: details.cls,
            fromStnCode: details.from,
            toStnCode: details.to,
            quotaCode: details.quota,
            trainNumber: String(details.trainNo),
            journeyDate: details.date,
            isLogedinReq: true,
            moreThanOneDay: true
        };

        const res = await this.requestWithRetry(
            path,
            { method: 'POST', body, referer: 'https://www.irctc.co.in/nget/booking/train-list' },
            {
                maxRetries: 100,
                delayMs: 300,
                statusLabel: 'Checking availability',
                extraRetry: (o) => {
                    const st = o?.data?.avlDayList?.[0]?.availablityStatus;
                    return String(st || '').includes('#');
                }
            }
        );
        if (res.status >= 400) throw new Error(`Avl fare failed: ${JSON.stringify(res.data)}`);
        const avlSt = res?.data?.avlDayList?.[0]?.availablityStatus || '';
        const avlStop = this.checkProceedAfterAllLap(
            avlSt,
            details.bookOnlyIfCnf !== false
        );
        if (!avlStop.ok) {
            const msg = avlStop.panelStatus || 'NOT AVAILABLE';
            this.log(msg);
            const err = new Error(msg);
            err.code = 'NO_SEAT';
            err.panelStatus = msg;
            throw err;
        }
        const avlMetrics = this.metricsFromAvlFareResponse(res.data);
        this.pushPanelAvailFromStatus(avlSt, avlMetrics.amount, 'avl');
        this.log('avlFarenquiry OK');
        return res;
    }

    // -------- Step 3: boardingStationEnq --------
    async fetchBoardingEnq(details) {
        const body = {
            alternateAvlInputDTO: [{
                trainNo: String(details.trainNo),
                destStn: details.to,
                srcStn: details.from,
                jrnyDate: details.date,
                quotaCode: details.quota,
                jrnyClass: details.cls
            }],
            concessionPassengers: false,
            destStn: details.to,
            jrnyClass: details.cls,
            jrnyDate: details.date,
            quotaCode: details.quota,
            srcStn: details.from,
            trainNo: String(details.trainNo),
            autoUpgradationSelected: false,
            captureAddress: 0,
            clusterFlag: 'N',
            cod: 'false',
            gnToCkOpted: false,
            journalistBooking: false,
            onwardFlag: 'N',
            passBooking: false,
            paymentType: 1,
            reservationMode: 'WS_TA_B2C',
            twoPhaseAuthRequired: false
        };
        const res = await this.requestWithRetry(
            '/eticketing/protected/mapps1/boardingStationEnq',
            {
                method: 'POST',
                body,
                referer: 'https://www.irctc.co.in/nget/booking/train-list'
            },
            { maxRetries: 100, delayMs: 300, statusLabel: 'Checking boarding' }
        );
        if (res.status >= 400) throw new Error(`Boarding enq failed: ${JSON.stringify(res.data)}`);
        this.log('boardingStationEnq OK');
        return res;
    }

    // -------- Step 6: allLapAvlFareEnq/Y --------
    async allLapAvlFareEnq(details) {
        const wsUser = this.TOK.wsUserLogin || details.wsUser;
        if (!wsUser) throw new Error('wsUserLogin missing');

        const cid = this.genClientTxnId(8);
        this.lastClientTxnId = cid;
        this.TOK.lastClientTxnId = cid;
        this.TOK.wsUserLogin = wsUser;

        const passengers = (details.passengers && details.passengers.length)
            ? details.passengers.slice(0, 6)
            : [details.passenger];
        const paxList = passengers.map((p, i) => this.mapPassenger(p, i));

        const cnfOnly = details.bookOnlyIfCnf !== false;

        const lap = {
            trainNo: String(details.trainNo),
            journeyDate: details.date,
            fromStation: details.from,
            toStation: details.to,
            journeyClass: details.cls,
            quota: details.quota,
            coachId: null,
            reservationChoice: 4,
            ignoreChoiceIfWl: false,
            travelInsuranceOpted: 'true',
            warrentType: 0,
            coachPreferred: false,
            autoUpgradation: false,
            bookOnlyIfCnf: cnfOnly,
            addMealInput: null,
            concessionBooking: false,
            passengerList: paxList,
            ssQuotaSplitCoach: 'Y'
        };

        const load = {
            clusterFlag: 'N',
            onwardFlag: 'N',
            cod: 'false',
            reservationMode: 'WS_TA_B2C',
            autoUpgradationSelected: true,
            gnToCkOpted: false,
            paymentType: String(details.paymentType),
            twoPhaseAuthRequired: false,
            captureAddress: 0,
            wsUserLogin: wsUser,
            moreThanOneDay: false,
            clientTransactionId: cid,
            boardingStation: details.boarding,
            reservationUptoStation: details.to,
            mobileNumber: details.mobile,
            ticketType: 'E',
            mainJourneyTxnId: null,
            mainJourneyPnr: '',
            captcha: '',
            generalistChildConfirm: false,
            ftBooking: false,
            loyaltyRedemptionBooking: false,
            loyaltyBankId: null,
            loyaltyNumber: null,
            nosbBooking: false,
            warrentType: 0,
            ftTnCAgree: false,
            bookingChoice: 1,
            bookingConfirmChoice: 1,
            bookOnlyIfCnf: cnfOnly,
            returnJourney: false,
            connectingJourney: false,
            noFood: false,
            lapAvlRequestDTO: [lap],
            gstDetails: { gstIn: '', error: null },
            tktAddress: null
        };

        const res = await this.requestAllLapWithPolicy(load);

        // fallback — requestAllLapWithPolicy normally throws before return
        if (this.isClientIpBlock(res?.status, res?.text)) {
            const err = new Error(
                '510 Unable to Process / Client IP — 3 retries failed. Script stop.'
            );
            err.panelStatus = 'Passenger Submit (510/Client IP)';
            err.code = 'CLIENT_IP_510';
            throw err;
        }
        if (this.isAllLapIncomplete(res) && !res?.data?.captchaDto?.captchaQuestion) {
            const snippet = String(res?.text || '').slice(0, 180);
            throw new Error(
                `allLap incomplete / high-load (no avlFareResponseDTO[0]). status=${res?.status} body=${snippet}`
            );
        }

        const cap = res?.data?.captchaDto?.captchaQuestion;
        const avlStatus = res?.data?.avlFareResponseDTO?.[0]?.avlDayList?.[0]?.availablityStatus || '';
        const hasBanks = Array.isArray(res?.data?.bankDetailDTO) && res.data.bankDetailDTO.length > 0;
        const captchaRequired = !!cap;
        const proceed = this.checkProceedAfterAllLap(avlStatus, cnfOnly);
        const noCaptchaPath = !captchaRequired && hasBanks && proceed.ok;

        this.log(`allLap done | avl=${avlStatus} | captcha=${captchaRequired ? 'yes' : 'no'}`);
        const lapMetrics = this.metricsFromLapResponse(res.data);
        if (proceed.ok && (lapMetrics.amount > 0 || avlStatus)) {
            this.pushPanelAvailFromStatus(avlStatus, lapMetrics.amount, 'lap');
        }
        if (!proceed.ok) {
            const msg = proceed.panelStatus || 'NOT AVAILABLE';
            this.log(msg);
            const err = new Error(msg);
            err.code = 'NO_SEAT';
            err.panelStatus = msg;
            throw err;
        }
        return {
            ...res,
            usedClientTxnId: cid,
            captchaBase64: cap,
            captchaRequired,
            noCaptchaPath,
            availabilityStatus: avlStatus,
            proceedCheck: proceed,
            bookOnlyIfCnf: cnfOnly,
        };
    }

    // -------- Step 7: addonServices (captchaAns null OR solved) --------
    async addonServices({ captcha, clientTxnId, paymentType }) {
        this.log(`Direct: addonServices (captchaAns=${captcha == null || captcha === '' ? 'null' : 'set'})...`);
        const captchaAns = (captcha === null || captcha === undefined || String(captcha).trim() === '')
            ? null
            : String(captcha).trim();

        const body = {
            captchaAns,
            captchaType: 'BOOKINGWS',
            clientTxnId,
            paymentType,
            addonLapServices: [{ travelInsuranceOpted: true }]
        };

        const res = await this.requestWithRetry(
            '/eticketing/protected/mapps1/addonServices',
            {
                method: 'POST',
                body,
                referer: 'https://www.irctc.co.in/nget/booking/reviewBooking'
            },
            {
                maxRetries: 100,
                delayMs: 300,
                acceptStatus: (r) => r.status === 400
            }
        );
        const errMsg = String(res?.data?.errorMessage || res?.data?.errorMsg || '').trim();
        // Only stop on real seat errors — addon OK has no availablityStatus (don't treat empty as closed)
        if (errMsg) {
            const seatMsg = this.seatStopPanelStatus('', errMsg);
            if (seatMsg) {
                this.log(seatMsg);
                const err = new Error(seatMsg);
                err.code = 'NO_SEAT';
                err.panelStatus = seatMsg;
                throw err;
            }
        }
        return res;
    }

    // -------- Step 8: bookingInitPayment --------
    async bookingInitPayment({
      clientTxnId,
      amount,
      bankId = '116',
      txnType = 1,
      paramList = [],
    }) {
        this.log('Direct: bookingInitPayment...');
        const body = {
            bankId: String(bankId),
            transationId: 0,
            txnType: Number(txnType) || 1,
            txnStatus: 1,
            amount: String(amount),
            paramList: Array.isArray(paramList) ? paramList : [],
        };
        const path = `/eticketing/protected/mapps1/bookingInitPayment/${clientTxnId}?insurenceApplicable=`;
        const res = await this.requestWithRetry(
            path,
            {
                method: 'POST',
                body,
                referer: 'https://www.irctc.co.in/nget/payment/bkgPaymentOptions'
            },
            { maxRetries: 100, delayMs: 5000 }
        );
        if (res.status !== 200 || this.isAkamaiBlock(res.status, res.text)) {
            throw new Error(`bookingInitPayment failed: ${res.status}`);
        }
        this.log('bookingInitPayment OK');
        return res;
    }
}
