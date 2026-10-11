/**
 * Direct Booking — login on IRCTC UI, tokens from page, mapps1 APIs in same browser tab.
 * Flow (HAR-matched): validateUser → altAvlEnq/TC → avlFarenquiry → boardingStationEnq → …
 */
(function () {
  if (window.__OCEAN_DIRECT_BOOT__) return;
  try {
    Object.defineProperty(window, '__OCEAN_DIRECT_BOOT__', {
      value: true,
      writable: false,
      configurable: true,
      enumerable: false,
    });
  } catch (_) {
    window.__OCEAN_DIRECT_BOOT__ = true;
  }

  function log(msg) {
    const line = String(msg);
    console.log('[OCEAN Direct]', line);
    try {
      if (typeof window.__oceanPushPanelStatus === 'function') {
        window.__oceanPushPanelStatus(line);
        return;
      }
      const rt = window.__ocRt && window.__ocRt.runtime;
      if (rt && typeof rt.sendMessage === 'function') {
        rt.sendMessage(
          {
            id: 'irctc',
            msg: { type: 'panel_status', data: { text: line } },
            sender: 'content_script',
          },
          () => {}
        );
      }
    } catch (_) {}
  }

  function markSeatStop(statusMsg) {
    const msg = String(statusMsg || '').trim();
    if (!msg) return;
    try {
      window.__OCEAN_DIRECT_SEAT_STOP__ = msg;
    } catch (_) {}
    log(msg);
  }

  function seatStopFromMessage(errOrMsg) {
    const e = String(errOrMsg || '');
    const ipMatch = e.match(/Passenger Submit \(\d+\) \(510\/Client IP\)/i);
    if (ipMatch) return ipMatch[0];
    if (/510.*Client IP|Client IP.*510|510\/Client IP/i.test(e)) {
      return 'Passenger Submit (510/Client IP)';
    }
    if (/no seats?\s*available/i.test(e)) return 'No seats available';
    if (/^NOT AVAILABLE$/i.test(e.trim()) || /not available|not avl/i.test(e)) {
      return 'NOT AVAILABLE';
    }
    if (/regret/i.test(e)) return 'REGRET';
    if (/seat not open/i.test(e)) return 'Seat not open';
    if (/RAC · No seat/i.test(e)) return 'RAC · No seat available';
    if (/WL · No seat/i.test(e)) return 'WL · No seat available';
    if (/train departed/i.test(e)) return 'TRAIN DEPARTED';
    if (/cancelled/i.test(e)) return 'CANCELLED';
    return null;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** 5-digit ms countdown — har ms update (45000→44999→44998…) */
  async function countdownPassengerSubmit(waitMs) {
    const endAt = Date.now() + waitMs;
    let lastShown = -1;
    while (true) {
      const left = Math.max(0, endAt - Date.now());
      if (left !== lastShown) {
        const ms = String(left).padStart(5, '0');
        log('Passenger Submit in ' + ms + 'ms');
        lastShown = left;
      }
      if (left <= 0) break;
      await sleep(1);
    }
  }

  function stationCode(v) {
    const s = String(v || '').trim();
    if (!s) return '';
    // Prefer trailing code: "SURAT - ST" → ST (not SURAT)
    let m = s.match(/\s*[-–—]\s*([A-Z0-9]{2,5})\s*$/i);
    if (m) return m[1].toUpperCase();
    m = s.match(/\(([A-Z0-9]{2,5})\)\s*$/i);
    if (m) return m[1].toUpperCase();
    m = s.match(/^([A-Z0-9]{2,5})\s*[-–—]\s+/i);
    if (m) return m[1].toUpperCase();
    if (/^[A-Z0-9]{2,5}$/i.test(s)) return s.toUpperCase();
    return s;
  }

  function trainNo(v) {
    const s = String(v || '').trim();
    const m = s.match(/(\d{5})/);
    return m ? m[1] : s.replace(/\D/g, '').slice(0, 5);
  }

  function dateCompact(v) {
    const s = String(v || '').trim();
    if (/^\d{8}$/.test(s)) return s;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.replace(/-/g, '');
    return s.replace(/\D/g, '').slice(0, 8);
  }

  function readStorage() {
    try {
      const d = Object.getOwnPropertyDescriptor(window, '__OCEAN_STORAGE__');
      if (d && d.value) return d.value;
    } catch (_) {}
    return window.__OCEAN_STORAGE__ || {};
  }

  function readTokens() {
    try {
      return JSON.parse(localStorage.getItem('ir:tokens') || '{}');
    } catch (_) {
      return {};
    }
  }

  function hasAuthTokens() {
    const t = readTokens();
    return Boolean(t && t.access_token);
  }

  /** Set by content_script after real UI login — never start mapps1 from stale profile tokens. */
  function loginGateOk() {
    try {
      if (window.__OCEAN_LOGIN_OK__) return true;
    } catch (_) {}
    return false;
  }

  function isLoggedInUi() {
    const hasLogout = Array.from(
      document.querySelectorAll(
        'a.search_btn.loginText, a.loginText, a.search_btn, app-header a, .h_head1 a, label b'
      )
    ).some((el) => {
      const t = ((el.innerText || el.textContent || '') + '').replace(/\s+/g, ' ').trim().toUpperCase();
      return t === 'LOGOUT' || t === 'LOG OUT' || /^LOGOUT\b/.test(t);
    });
    if (hasLogout) return true;
    return [...document.querySelectorAll('label')].some((el) =>
      /^WELCOME,/i.test(((el.innerText || '') + '').trim())
    );
  }

  function isLoggedIn() {
    return loginGateOk() || isLoggedInUi();
  }

  function buildAllDetails(store) {
    const j = store.journey_details || {};
    const op = store.other_preferences || {};
    const cred = store.irctc_credentials || {};
    const passengers = Array.isArray(store.passenger_details) ? store.passenger_details : [];
    const list = passengers
      .filter((p) => p && p.name && p.age && p.gender)
      .map((p) => ({
        name: String(p.name).trim(),
        age: Number(p.age),
        gender: String(p.gender).trim().toUpperCase(),
        berth: p.berth || '',
        food: p.food || '',
      }));
    if (!list.length) throw new Error('Kam se kam 1 passenger (name/age/gender) chahiye');

    const from = stationCode(j.from);
    const to = stationCode(j.destination || j.to);
    const boardingRaw = j.boarding;
    const boarding = boardingRaw ? stationCode(boardingRaw) : from;
    const tn = trainNo(j['train-no'] || j.trainNo);
    const cls = String(j.class || '').trim().toUpperCase();
    const quota = String(j.quota || 'GN').trim().toUpperCase();
    const date = dateCompact(j.date);
    const mobile = String(op.mobileNumber || '').trim();
    const wsUser = String(cred.user_name || '').trim();

    if (!from || !to) throw new Error('From / To missing');
    if (!tn) throw new Error('Train number missing');
    if (!cls || cls === 'ALL') throw new Error('Class select karo (All Classes nahi)');
    if (!date || date.length !== 8) throw new Error('Journey date missing');
    if (!wsUser) throw new Error('IRCTC username missing');
    if (!mobile) throw new Error('Mobile number missing (Contact)');

    const fl = store.fare_limit || {};
    const fareLimit =
      fl.enableFareLimit === true || fl.enableFareLimit === 'true'
        ? String(fl.maxFareAmount || '').trim()
        : '';

    const travel = store.travel_preferences || {};
    const bookOnlyIfCnf = travel.bookOnlyIfCnf !== false;

    const payMethod = String(op.paymentmethod || op.paymentMethod || '').trim();
    const payKey = payMethod.toUpperCase();
    const isEwallet =
      payKey.includes('IRCWA') ||
      payKey.includes('EWALLET') ||
      payKey.includes('IRCTC-EWALLET');

    return {
      from,
      to,
      trainNo: tn,
      date,
      cls,
      quota,
      boarding,
      paymentType: isEwallet ? 3 : 2,
      fare_limit: fareLimit,
      bookOnlyIfCnf,
      passenger: list[0],
      passengers: list,
      wsUser,
      mobile,
      paymentmethod: payMethod,
      vpa: String(store.vpa || op.vpa || '').trim(),
    };
  }

  /** Direct gateways: PhonePe 116 / Paytm 117 / Razorpay 105 / iPay 113 / eWallet 1000 */
  function resolveDirectQrPayment(method) {
    const key = String(method || '').toUpperCase();
    if (
      key.includes('IRCWA') ||
      key.includes('EWALLET') ||
      key.includes('IRCTC-EWALLET')
    ) {
      return {
        bankId: '1000',
        mode: 'ewallet',
        label: 'IRCTC eWallet',
        txnType: 7,
        paramList: [{ key: 'TXN_PASSWORD', value: '' }],
        paymentType: 3,
      };
    }
    if (key.includes('RAZORPAY')) {
      return { bankId: '105', mode: 'razorpay', label: 'Razorpay UPI', txnType: 1, paramList: [] };
    }
    if (key.includes('PAYTM')) {
      return { bankId: '117', mode: 'paytm', label: 'Paytm QR', txnType: 1, paramList: [] };
    }
    return { bankId: '116', mode: 'phonepe', label: 'PhonePe QR', txnType: 1, paramList: [] };
  }

  function bankListHasId(bankDetailDTO, bankId) {
    const want = String(bankId || '').trim();
    if (!want || !Array.isArray(bankDetailDTO)) return false;
    return bankDetailDTO.some((b) => {
      if (!b) return false;
      if (String(b.bankId || '').trim() !== want) return false;
      const en = String(b.enableFlag != null ? b.enableFlag : 'true').toLowerCase();
      return en === 'true' || en === '1' || en === 'y' || en === 'yes';
    });
  }

  /**
   * addonServices bankDetailDTO pe Paytm/PhonePe availability:
   * Paytm → 117, else 78, else PhonePe 116
   * PhonePe → 116, else Paytm 117, else 78
   */
  function applyAddonBankFallback(payGate, bankDetailDTO) {
    const chosen = payGate || resolveDirectQrPayment('PHONEPEUPIQR');
    const mode = String(chosen.mode || '');
    if (mode !== 'paytm' && mode !== 'phonepe') return chosen;

    const paytm117 = {
      bankId: '117',
      mode: 'paytm',
      label: 'Paytm QR',
      txnType: 1,
      paramList: [],
    };
    const paytm78 = {
      bankId: '78',
      mode: 'paytm',
      label: 'Paytm',
      txnType: 1,
      paramList: [],
    };
    const phonepe116 = {
      bankId: '116',
      mode: 'phonepe',
      label: 'PhonePe QR',
      txnType: 1,
      paramList: [],
    };

    if (mode === 'paytm') {
      if (bankListHasId(bankDetailDTO, '117')) return paytm117;
      if (bankListHasId(bankDetailDTO, '78')) {
        log('⚠️ Paytm UPI (117) not in addon list — init bankId 78 (Paytm)');
        return paytm78;
      }
      if (bankListHasId(bankDetailDTO, '116')) {
        log('⚠️ Paytm 117/78 missing — fallback PhonePe (116)');
        return phonepe116;
      }
      log('⚠️ Paytm/PhonePe banks missing in addon — keeping ' + chosen.label);
      return chosen;
    }

    // phonepe
    if (bankListHasId(bankDetailDTO, '116')) return phonepe116;
    if (bankListHasId(bankDetailDTO, '117')) {
      log('⚠️ PhonePe (116) not in addon list — fallback Paytm UPI (117)');
      return paytm117;
    }
    if (bankListHasId(bankDetailDTO, '78')) {
      log('⚠️ PhonePe (116) not in addon list — fallback Paytm (78)');
      return paytm78;
    }
    log('⚠️ PhonePe/Paytm banks missing in addon — keeping ' + chosen.label);
    return chosen;
  }

  async function waitForTokens(timeoutMs) {
    const start = Date.now();
    let tick = 0;
    while (Date.now() - start < timeoutMs) {
      const t = readTokens();
      if (t && t.access_token) {
        log('Tokens OK — starting in-page API (TC → mapps1)…');
        return t;
      }
      tick++;
      if (tick % 5 === 1) {
        log('Waiting tokens… ' + Math.round((Date.now() - start) / 1000) + 's');
      }
      await sleep(400);
    }
    return null;
  }

  async function solveCaptcha(b64, captchaCreds) {
    const userId = captchaCreds.userId || '';
    const apiKey = captchaCreds.apiKey || '';
    if (!userId || !apiKey) {
      throw new Error('TrueCaptcha missing (save in Tokens tab)');
    }
    let data = String(b64 || '');
    const comma = data.indexOf(',');
    if (data.startsWith('data:') && comma !== -1) data = data.slice(comma + 1);
    const response = await fetch('https://api.apitruecaptcha.org/one/gettext', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userid: userId, apikey: apiKey, data }),
    });
    if (!response.ok) throw new Error('TrueCaptcha HTTP ' + response.status);
    const json = await response.json();
    if (!json || !json.result) throw new Error('TrueCaptcha empty');
    return String(json.result).replace(/\s/g, '').replace(')', 'J').replace(']', 'J');
  }

  /** HAR-matched pipeline — fetch from this IRCTC tab (same cookies / Akamai session). */
  async function runDirectBookingPipeline(TOK, allDetails, captchaCreds) {
    if (!TOK || !TOK.access_token) throw new Error('access_token missing');
    if (typeof IrctcDirectBookingJS === 'undefined') {
      throw new Error('booking_direct.js missing — restart Direct run');
    }

    log('Direct API start (same browser tab, altAvlEnq/TC first)…');
    const api = new IrctcDirectBookingJS(TOK, log);
    let runNote = 'ok';
    let qrFlowLogLines = [];
    let clientTxnId = null;
    let responseData = null;

    try {
      let T = await api.ensureFreshTokens();
      await api.fetchTrainList(allDetails);
      await api.fetchAvailabilityFare(allDetails);
      const inj3 = await api.fetchBoardingEnq(allDetails);

      const waitTimeStr = ((inj3 && inj3.data && inj3.data.minPsgnInputTime) || '35000').split('#')[0];
      let waitMs = parseInt(waitTimeStr, 10);
      if (isNaN(waitMs) || waitMs <= 0) waitMs = 35000;
      await countdownPassengerSubmit(waitMs);

      const inj6 = await api.allLapAvlFareEnq(allDetails);
      const captchaBase64 = inj6 && inj6.captchaBase64;
      clientTxnId = inj6 && inj6.usedClientTxnId;
      const lapData = inj6 && inj6.data;
      const avlStatus =
        (inj6 && inj6.availabilityStatus) ||
        (lapData &&
          lapData.avlFareResponseDTO &&
          lapData.avlFareResponseDTO[0] &&
          lapData.avlFareResponseDTO[0].avlDayList &&
          lapData.avlFareResponseDTO[0].avlDayList[0] &&
          lapData.avlFareResponseDTO[0].avlDayList[0].availablityStatus) ||
        '';

      const proceed =
        (inj6 && inj6.proceedCheck) ||
        api.checkProceedAfterAllLap(avlStatus, allDetails.bookOnlyIfCnf !== false);
      if (!proceed.ok) {
        const msg = proceed.panelStatus || seatStopFromMessage(proceed.error) || 'NOT AVAILABLE';
        markSeatStop(msg);
        throw new Error(msg);
      }
      if (proceed.panelStatus) log(proceed.panelStatus);

      if (!clientTxnId) throw new Error('clientTxnId missing');

      let captchaText = null;
      if (captchaBase64) {
        log('[6/8] Captcha solve…');
        captchaText = await solveCaptcha(captchaBase64, captchaCreds);
      } else {
        log('[6/8] No captcha — captchaAns=null');
      }

      const maxRetries = captchaText ? 5 : 3;
      let attempt = 0;
      let isAddonOk = false;
      const addonDetails = {
        captcha: captchaText,
        clientTxnId: clientTxnId,
        paymentType: allDetails.paymentType || 2,
      };

      while (!isAddonOk && attempt < maxRetries) {
        attempt++;
        log('[7/8] addonServices attempt ' + attempt);
        const injAddon = await api.addonServices(addonDetails);
        responseData = injAddon && injAddon.data;
        const errorMsg = String((responseData && responseData.errorMessage) || '').toLowerCase();
        if (errorMsg.includes('invalid captcha')) {
          const neu = responseData && responseData.captchaDto && responseData.captchaDto.captchaQuestion;
          if (!neu) throw new Error('No new captcha');
          addonDetails.captcha = await solveCaptcha(neu, captchaCreds);
          captchaText = addonDetails.captcha;
          await sleep(1000);
          continue;
        }
        const rawErr = String((responseData && responseData.errorMessage) || '');
        const seatStop = seatStopFromMessage(rawErr);
        if (seatStop) {
          markSeatStop(seatStop);
          throw new Error(seatStop);
        }
        if (responseData && responseData.bankDetailDTO) {
          isAddonOk = true;
          break;
        }
        throw new Error('addonServices: ' + (rawErr || 'Unknown'));
      }
      if (!isAddonOk) throw new Error('addonServices failed');

      const payAmountNum = Number(responseData.totalCollectibleAmount || 0);
      const payAmount = String(payAmountNum || 0);

      // PT only: addon amount vs saved MAX PT FARE
      const quotaNow = String(allDetails.quota || '').toUpperCase().trim();
      const maxPt = parseFloat(String(allDetails.fare_limit || '').replace(/,/g, ''));
      if (quotaNow === 'PT' && Number.isFinite(maxPt) && maxPt > 0 && payAmountNum > maxPt) {
        log('PT FARE HIGH: addon ₹' + payAmountNum + ' > max ₹' + maxPt);
        if (typeof window.__oceanPushPanelStatus === 'function') {
          try {
            window.__oceanPushPanelStatus('PT FARE HIGH');
          } catch (_) {}
        }
        if (typeof window.__oceanWaitPtFareProceed === 'function') {
          const go = await window.__oceanWaitPtFareProceed({
            amount: payAmountNum,
            maxFare: maxPt,
          });
          if (!go) throw new Error('PT fare high — stopped');
          log('PT FARE · user Proceed anyway');
        } else {
          throw new Error('PT fare high ₹' + payAmountNum + ' > ₹' + maxPt);
        }
      }

      const payGate = applyAddonBankFallback(
        resolveDirectQrPayment(allDetails.paymentmethod),
        responseData && responseData.bankDetailDTO
      );

      // Same ticket: dusra pair pehle init payment OK → rukao + Proceed anyway
      if (typeof window.__oceanWaitIfSiblingInit === 'function') {
        const goSib = await window.__oceanWaitIfSiblingInit();
        if (!goSib) throw new Error('Another pair already proceed — stopped');
      }

      const injPayment = await api.bookingInitPayment({
        clientTxnId: clientTxnId,
        amount: payAmount,
        bankId: payGate.bankId,
        txnType: payGate.txnType != null ? payGate.txnType : 1,
        paramList: payGate.paramList || [],
      });
      if (!injPayment || injPayment.status !== 200) throw new Error('Payment init failed');

      if (typeof window.__oceanMarkInitPaymentSuccess === 'function') {
        try {
          await window.__oceanMarkInitPaymentSuccess();
        } catch (_) {}
      }

      T = api.TOK;

      // --- eWallet: in-tab verifyPayment (no Direct Host / BankResponse) ---
      if (payGate.mode === 'ewallet') {
        log('Payment init OK — IRCTC eWallet verifyPayment…');
        if (typeof EwalletDirectHandlerJS === 'undefined') {
          throw new Error('ewallet_direct.js missing — restart API run');
        }
        const ew = new EwalletDirectHandlerJS(
          allDetails.wsUser,
          clientTxnId,
          T,
          log,
          {
            initData: injPayment.data || {},
            csrf: T.csrf || '',
            waitMs: 11000,
          }
        );
        const finalResult = await ew.start_process();
        if (finalResult && finalResult.status === 'BOOKED') {
          runNote = 'BOOKED PNR=' + finalResult.pnr;
          try {
            window.__OCEAN_DIRECT_BOOKED_PNR__ = String(finalResult.pnr || '');
          } catch (_) {}
          if (finalResult.full_data && typeof window.__oceanReportBookingFull === 'function') {
            try {
              await window.__oceanReportBookingFull(finalResult.full_data);
            } catch (_) {}
          }
          log('BOOKED! PNR: ' + finalResult.pnr);
          try {
            if (typeof window.__oceanPushPanelStatus === 'function') {
              window.__oceanPushPanelStatus(runNote);
            }
          } catch (_) {}
          return {
            ok: true,
            pnr: finalResult.pnr,
            note: runNote,
            full_data: finalResult.full_data || null,
          };
        }
        if (finalResult && finalResult.ok === false) {
          const msg = String(finalResult.error || finalResult.note || 'eWallet failed').trim();
          runNote = msg;
          log(msg);
          throw new Error(msg);
        }
        runNote = 'eWallet payment ok, PNR not fetched';
        log(runNote);
        return { ok: true, pnr: null, note: runNote };
      }

      // Gateway = Direct Host (PaymentRedirect off IRCTC browser)
      log(`Payment init OK — handing off ${payGate.label} to Direct Host…`);
      if (typeof window.__oceanNativeDirectBook !== 'function') {
        throw new Error('Direct Host bridge missing — restart API run');
      }
      const hostResult = await window.__oceanNativeDirectBook({
        mode: payGate.mode,
        tokens: T,
        wsUser: allDetails.wsUser,
        clientTxnId: clientTxnId,
        vpa: allDetails.vpa || '',
        details: {
          wsUser: allDetails.wsUser,
          paymentmethod: allDetails.paymentmethod,
          vpa: allDetails.vpa || '',
        },
      });
      const finalResult =
        hostResult && hostResult.result ? hostResult.result : hostResult;
      qrFlowLogLines =
        (finalResult && Array.isArray(finalResult.fileLogLines) && finalResult.fileLogLines) ||
        [];
      if (finalResult && finalResult.status === 'BOOKED') {
        runNote = 'BOOKED PNR=' + finalResult.pnr;
        try {
          window.__OCEAN_DIRECT_BOOKED_PNR__ = String(finalResult.pnr || '');
        } catch (_) {}
        if (finalResult.full_data && typeof window.__oceanReportBookingFull === 'function') {
          try {
            await window.__oceanReportBookingFull(finalResult.full_data);
          } catch (_) {}
        }
        log('BOOKED! PNR: ' + finalResult.pnr);
        try {
          if (typeof window.__oceanPushPanelStatus === 'function') {
            window.__oceanPushPanelStatus(runNote);
          }
        } catch (_) {}
        return {
          ok: true,
          pnr: finalResult.pnr,
          note: runNote,
          full_data: finalResult.full_data || null,
        };
      }
      if (finalResult && finalResult.pnr) {
        runNote = 'BOOKED PNR=' + finalResult.pnr;
        try {
          window.__OCEAN_DIRECT_BOOKED_PNR__ = String(finalResult.pnr || '');
        } catch (_) {}
        if (finalResult.full_data && typeof window.__oceanReportBookingFull === 'function') {
          try {
            await window.__oceanReportBookingFull(finalResult.full_data);
          } catch (_) {}
        }
        log('BOOKED! PNR: ' + finalResult.pnr);
        try {
          if (typeof window.__oceanPushPanelStatus === 'function') {
            window.__oceanPushPanelStatus(runNote);
          }
        } catch (_) {}
        return {
          ok: true,
          pnr: finalResult.pnr,
          note: runNote,
          full_data: finalResult.full_data || null,
        };
      }
      if (finalResult && finalResult.ok === false) {
        const failMsg = String(
          finalResult.error || finalResult.note || `${payGate.label} failed`
        ).trim();
        runNote = failMsg;
        try {
          window.__OCEAN_DIRECT_SEAT_STOP__ = failMsg;
        } catch (_) {}
        markSeatStop(failMsg);
        return { ok: false, pnr: null, note: failMsg, error: failMsg };
      }
      if (finalResult === false) {
        runNote = 'Payment / PNR failed';
        log(runNote);
        return { ok: false, pnr: null, note: runNote };
      }
      runNote = (finalResult && finalResult.note) || 'payment ok, PNR not fetched';
      log(runNote);
      return { ok: true, pnr: (finalResult && finalResult.pnr) || null, note: runNote };
    } catch (e) {
      const raw = e && e.message ? e.message : String(e);
      const seat =
        (e && e.panelStatus) ||
        (e && e.code === 'NO_SEAT' && raw) ||
        (e && e.code === 'CLIENT_IP_510' && (e.panelStatus || raw)) ||
        seatStopFromMessage(raw);
      if (seat) {
        runNote = seat;
        markSeatStop(seat);
      } else {
        runNote = 'error: ' + raw;
        log(runNote);
      }
      throw e;
    } finally {
      try {
        if (qrFlowLogLines.length && api && api.fileLog) {
          api.fileLog('');
          for (const line of qrFlowLogLines) api.fileLog(line);
        }
        api && api.downloadRunLog && api.downloadRunLog(runNote);
      } catch (_) {}
    }
  }

  let running = false;
  let pipelineDone = false;

  function isDirectPipelineFinished() {
    try {
      if (window.__OCEAN_DIRECT_PIPELINE_DONE__) return true;
    } catch (_) {}
    return pipelineDone;
  }

  function markDirectPipelineFinished() {
    pipelineDone = true;
    try {
      window.__OCEAN_DIRECT_PIPELINE_DONE__ = true;
    } catch (_) {}
    try {
      clearTimeout(window.__OCEAN_DIRECT_START_T);
    } catch (_) {}
    if (window.__OCEAN_DIRECT_TOKEN_WATCH_ID__) {
      clearInterval(window.__OCEAN_DIRECT_TOKEN_WATCH_ID__);
      window.__OCEAN_DIRECT_TOKEN_WATCH_ID__ = null;
    }
  }

  async function runDirectAfterLogin() {
    if (running || isDirectPipelineFinished()) return;
    if (!loginGateOk()) {
      log('Waiting for login… (API after SIGN IN only)');
      return;
    }
    if (!hasAuthTokens()) {
      log('Waiting for access_token…');
      return;
    }
    running = true;
    try {
      try {
        window.__OCEAN_DIRECT_SEAT_STOP__ = '';
        window.__OCEAN_DIRECT_BOOKED_PNR__ = '';
      } catch (_) {}
      log('Login OK + tokens — starting in-page API (TC → mapps1)…');
      const TOK = await waitForTokens(30000);
      if (!TOK || !TOK.access_token) {
        throw new Error('Token nahi mila (30s). Network / login check karo.');
      }

      const store = readStorage();
      const allDetails = buildAllDetails(store);
      const captchaCreds = store.true_captcha_credentials || {};

      const result = await runDirectBookingPipeline(TOK, allDetails, captchaCreds);
      if (result && result.pnr) {
        log('Done PNR ' + result.pnr);
      } else {
        log(result?.note || 'Direct API done');
      }
      return result;
    } catch (e) {
      const raw = e && e.message ? e.message : String(e);
      const seat =
        (e && e.panelStatus) ||
        (e && e.code === 'NO_SEAT' && raw) ||
        (e && e.code === 'CLIENT_IP_510' && (e.panelStatus || raw)) ||
        seatStopFromMessage(raw) ||
        (typeof window !== 'undefined' && window.__OCEAN_DIRECT_SEAT_STOP__);
      if (seat) {
        markSeatStop(seat);
      } else {
        log('Direct Book Error: ' + raw);
        console.error('[OCEAN Direct]', e);
      }
    } finally {
      running = false;
      markDirectPipelineFinished();
      // PNR / no-seat → keep panel status; don't overwrite with SCRIPT END
      try {
        if (
          !window.__OCEAN_DIRECT_BOOKED_PNR__ &&
          !window.__OCEAN_DIRECT_SEAT_STOP__
        ) {
          log('SCRIPT END');
        }
      } catch (_) {
        if (!window.__OCEAN_DIRECT_SEAT_STOP__) log('SCRIPT END');
      }
    }
  }

  function scheduleDirectStart(reason) {
    if (isDirectPipelineFinished() || running) return;
    if (!loginGateOk()) return;
    if (!hasAuthTokens()) return;
    log('Token signal (' + (reason || 'watch') + ')…');
    runDirectAfterLogin();
  }

  function debouncedDirectStart(reason) {
    try {
      clearTimeout(window.__OCEAN_DIRECT_START_T);
    } catch (_) {}
    window.__OCEAN_DIRECT_START_T = setTimeout(
      () => scheduleDirectStart(reason || 'debounced'),
      400
    );
  }

  try {
    Object.defineProperty(window, '__oceanTryStartDirect', {
      value: debouncedDirectStart,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  } catch (_) {
    window.__oceanTryStartDirect = debouncedDirectStart;
  }

  function startTokenWatcher() {
    if (window.__OCEAN_DIRECT_TOKEN_WATCH__) return;
    window.__OCEAN_DIRECT_TOKEN_WATCH__ = true;
    log('API mode — login first, then watch tokens…');
    const tick = () => {
      if (!window.__OCEAN_DIRECT_BOOK__ || isDirectPipelineFinished() || running) return;
      if (!loginGateOk()) return;
      if (hasAuthTokens()) debouncedDirectStart('poll');
    };
    window.__OCEAN_DIRECT_TOKEN_WATCH_ID__ = setInterval(tick, 500);
    window.addEventListener('ocean-tokens-updated', () => tick());
    try {
      window.addEventListener('storage', (ev) => {
        if (ev && ev.key === 'ir:tokens') tick();
      });
    } catch (_) {}
  }

  try {
    Object.defineProperty(window, '__oceanStartDirectBook', {
      value: runDirectAfterLogin,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  } catch (_) {
    window.__oceanStartDirectBook = runDirectAfterLogin;
  }

  setTimeout(() => {
    startTokenWatcher();
    // Never auto-start from stale Brave/Default localStorage tokens alone.
    // content_script sets __OCEAN_LOGIN_OK__ after real login (or already-logged-in UI).
    try {
      if (window.__OCEAN_PENDING_DIRECT__ && loginGateOk()) {
        window.__OCEAN_PENDING_DIRECT__ = false;
        debouncedDirectStart('pending-cdp');
      }
    } catch (_) {}
  }, 800);
})();
