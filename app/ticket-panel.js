let elapsedStartedAt=null,elapsedInterval=null,elapsedStoppedMs=0;
function updateElapsedTimer(){const ms=elapsedStartedAt===null?elapsedStoppedMs:Math.max(0,performance.now()-elapsedStartedAt);const label=document.getElementById('elapsedSeconds');if(label)label.textContent=(ms/1000).toFixed(1)+' s';}
function startElapsedTimer(){if(elapsedInterval)clearInterval(elapsedInterval);elapsedStartedAt=performance.now();elapsedStoppedMs=0;updateElapsedTimer();const state=document.getElementById('elapsedState');if(state)state.textContent='RUNNING';elapsedInterval=setInterval(updateElapsedTimer,100);}
function stopElapsedTimer(){if(elapsedStartedAt===null)return;elapsedStoppedMs=Math.max(0,performance.now()-elapsedStartedAt);elapsedStartedAt=null;if(elapsedInterval)clearInterval(elapsedInterval);elapsedInterval=null;updateElapsedTimer();const state=document.getElementById('elapsedState');if(state)state.textContent='FINISHED';}
window.addEventListener('beforeunload',()=>{if(elapsedInterval)clearInterval(elapsedInterval);});
let ctx = null;
let running = false;
let pendingPtFareSessionId = null;
let clockFrozen = false;
let clockTimer = null;
/** @type {{ index: number, text: string } | null} */
let credLabelBackup = null;

function stationCode(raw) {
  const s = String(raw || '').trim();
  if (!s) return '—';
  const parts = s.split(' - ');
  if (parts.length > 1) return parts[parts.length - 1].trim().toUpperCase();
  if (s.length <= 5) return s.toUpperCase();
  return s.slice(0, 4).toUpperCase();
}

function formatDate(iso) {
  if (!iso) return '—';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}-${m[2]}`;
  return iso;
}

/** Digits-only train number from "53047- NAME" style values */
function trainNumberOnly(raw) {
  const s = String(raw || '').trim();
  return (s.match(/(\d{3,5})/) || [])[1] || s.split('-')[0].trim() || '—';
}

/** Header: only FROM_TO station codes (no passenger / ticket name) */
function formatPanelTitle(j) {
  const from = stationCode(j.from);
  const to = stationCode(j.to);
  return `${from}_${to}`;
}

/** One-line summary like reference: BWN_KAN 53047 2S:GN 30-08 */
function formatSummaryLine(j) {
  const from = stationCode(j.from);
  const to = stationCode(j.to);
  const train = trainNumberOnly(j.trainNo);
  const cls = String(j.class || '—').trim() || '—';
  const quota = String(j.quota || 'GN').trim() || 'GN';
  const date = formatDate(j.date);
  return `${from}_${to}  ${train}  ${cls}:${quota}  ${date}`;
}

function fillSelect(sel, items, valueKey, labelFn, selectedId) {
  if (!sel) return;
  sel.innerHTML = '';
  for (const item of items) {
    const opt = document.createElement('option');
    opt.value = item[valueKey];
    opt.textContent = labelFn(item);
    sel.appendChild(opt);
  }
  if (selectedId) sel.value = selectedId;
}

function pairPeopleSvg() {
  return (
    '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path fill="#14532d" d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5z"/>' +
    '</svg>'
  );
}

function updatePairButton(data) {
  const pairBtn = document.getElementById('pairBtn');
  if (!pairBtn) return;
  const pair = Math.max(1, Math.min(4, Number(data.pairIndex) || 1));
  const maxPairs = Math.max(2, Number(data.maxPairs) || 4);
  const canOpen = Boolean(data.canOpenNextPair);
  const next = data.nextPairIndex;
  const openCount = Number(data.openPairCount) || 1;

  const icons = Array.from({ length: pair }, () => pairPeopleSvg()).join('');
  pairBtn.innerHTML =
    `<span class="pair-people">${icons}</span>` +
    `<span class="pair-label">PAIR</span>` +
    `<span class="pair-num">${pair}</span>`;
  pairBtn.classList.toggle('is-pair2', pair > 1);

  if (pair !== 1) {
    pairBtn.disabled = true;
    pairBtn.title = `Pair ${pair}`;
    return;
  }

  if (!canOpen || next == null) {
    pairBtn.disabled = true;
    pairBtn.title = `Max ${maxPairs} pairs open (${openCount}/${maxPairs})`;
  } else {
    pairBtn.disabled = false;
    pairBtn.title = `Click to open PAIR ${next} (${openCount}/${maxPairs})`;
  }
}

function setRunning(on) {
  running = Boolean(on);
  document.body.classList.toggle('is-running', running);
  if (on) {
    document.body.classList.remove('is-success');
    restoreCredIdLabel();
    const statusBar = document.getElementById('statusBar');
    if (statusBar) statusBar.classList.remove('is-success-status');
  }
  // Success pe metrics mat wipe karo (STAR-style clock row rehti hai)
  if (!running && !document.body.classList.contains('is-success')) {
    setMetrics(0, 0);
  }
}

function markSuccessUi() {
  stopElapsedTimer();
  freezeRunClock();
  running = false;
  document.body.classList.remove('is-running');
  document.body.classList.add('is-success');
}

function clearSuccessUi() {
  document.body.classList.remove('is-success');
  restoreCredIdLabel();
  const statusBar = document.getElementById('statusBar');
  if (statusBar) {
    statusBar.classList.remove('is-success-status');
    statusBar.classList.remove('is-final-hit');
  }
  unfreezeRunClock();
}

function isFinalHitStatus(text) {
  return /^Final Hit For Pnr$/i.test(String(text || '').trim());
}

function setFinalHitAnimation(on) {
  const statusBar = document.getElementById('statusBar');
  if (!statusBar) return;
  statusBar.classList.toggle('is-final-hit', Boolean(on));
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** First 3 digits visible, rest X — stays masked after screenshot */
function maskPnrDigits(pnr) {
  const d = String(pnr || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length <= 3) return d;
  return d.slice(0, 3) + 'X'.repeat(d.length - 3);
}

function trophySvgHtml() {
  return (
    '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path fill="#eab308" d="M12 2.2c-1.6 0-3 .9-3.7 2.2H6.2c-.7 0-1.2.6-1.1 1.3l.5 3.2c.3 1.7 1.5 3.1 3.1 3.7.4 1.1 1.2 2 2.3 2.4v2.2H8.5c-.4 0-.7.3-.7.7v1.1c0 .4.3.7.7.7h7c.4 0 .7-.3.7-.7v-1.1c0-.4-.3-.7-.7-.7H13v-2.2c1.1-.4 1.9-1.3 2.3-2.4 1.6-.6 2.8-2 3.1-3.7l.5-3.2c.1-.7-.4-1.3-1.1-1.3h-2.1C15 3.1 13.6 2.2 12 2.2zm-4.6 3.5h1.1c0 .5.1 1 .2 1.4H7.8l-.4-1.4zm9.2 0l-.4 1.4h-1.1c.1-.4.2-.9.2-1.4h1.3zM12 4c.9 0 1.7.5 2.1 1.3H9.9C10.3 4.5 11.1 4 12 4zm0 8.2c-1.3 0-2.4-.8-2.8-1.9h5.6c-.4 1.1-1.5 1.9-2.8 1.9z"/>' +
    '<path fill="none" stroke="#ca8a04" stroke-width="1.2" stroke-linecap="round" d="M4.5 8.5c0 2.2 1.2 3.5 2.8 3.5M19.5 8.5c0 2.2-1.2 3.5-2.8 3.5"/>' +
    '</svg>'
  );
}

/** Success bar: trophy + white head + gold masked PNR */
function renderSuccessStatus(text) {
  const statusBar = document.getElementById('statusBar');
  if (!statusBar) return;
  setFinalHitAnimation(false);
  const t = String(text || '').trim();
  const m =
    t.match(/^(Success By (?:LEXUS|Lexus)\s+\S+)\s*[·\-–—]\s*PNR\s+(\d{3,})/i) ||
    t.match(/^(Success By (?:LEXUS|Lexus).+?)\s+PNR\s+(\d{3,})/i);
  let head = t;
  let pnrMasked = '';
  if (m) {
    head = m[1].trim();
    pnrMasked = maskPnrDigits(m[2]);
  } else {
    const pnrOnly = t.match(/PNR\s+(\d{3,})/i);
    if (pnrOnly) pnrMasked = maskPnrDigits(pnrOnly[1]);
  }
  statusBar.classList.add('is-success-status');
  statusBar.innerHTML =
    `<span class="status-trophy">${trophySvgHtml()}</span>` +
    `<span class="status-success-text">${escapeHtml(head)}${pnrMasked ? ' - ' : ''}</span>` +
    (pnrMasked ? `<span class="status-pnr">PNR ${escapeHtml(pnrMasked)}</span>` : '');
}

function maskCredIdLabel() {
  const sel = document.getElementById('credSelect');
  if (!sel || sel.selectedIndex < 0) return;
  const opt = sel.options[sel.selectedIndex];
  if (!opt) return;
  if (!credLabelBackup) {
    credLabelBackup = { index: sel.selectedIndex, text: opt.textContent };
  }
  const raw = String(credLabelBackup.text || '');
  if (raw.length <= 2) {
    opt.textContent = 'XX';
  } else {
    opt.textContent = raw.slice(0, 2) + 'X'.repeat(Math.max(4, raw.length - 2));
  }
}

function restoreCredIdLabel() {
  const sel = document.getElementById('credSelect');
  if (!sel || !credLabelBackup) return;
  const opt = sel.options[credLabelBackup.index];
  if (opt) opt.textContent = credLabelBackup.text;
  credLabelBackup = null;
}

/** Clock row: AVL-N|amount, RAC-N|amount, WL-N|amount */
function setMetrics(seats, amount, label = 'AVL') {
  const el = document.getElementById('runMetrics');
  if (!el) return;
  const s = Number(seats);
  const a = Number(amount);
  const seatTxt = Number.isFinite(s) ? String(Math.trunc(s)) : '0';
  let amtTxt = '0';
  if (Number.isFinite(a)) {
    amtTxt = Number.isInteger(a) ? String(a) : String(Math.round(a * 10) / 10);
  }
  const prefix = String(label || 'AVL').trim() || 'AVL';
  el.textContent = `${prefix}-${seatTxt}|${amtTxt}`;
}

function isTerminalRunStatus(text) {
  const t = String(text || '').trim();
  if (!t) return false;

  // Mid-run retry / progress labels — buttons mat restore
  if (/Passenger Submit/i.test(t)) {
    if (/3 retries failed|Script stop/i.test(t)) return true;
    return false;
  }
  if (/Checking (availability|boarding)/i.test(t)) return false;
  if (/\(\d+\)\s*\((?:Akamai|high-load|510|Client IP)/i.test(t)) return false;

  if (/^SCRIPT END/i.test(t)) return true;
  if (/^Success By (?:LEXUS|Lexus)/i.test(t)) return true;
  if (/^NOT AVAILABLE$/i.test(t) || /^REGRET$/i.test(t)) return true;
  if (/^No seats available/i.test(t) || /^Seat not open/i.test(t)) return true;
  if (/RAC · No seat|WL · No seat/i.test(t)) return true;
  if (/TRAIN DEPARTED|CANCELLED/i.test(t)) return true;
  if (/No Transaction found/i.test(t)) return true;
  if (/berth.*not met|preference.*not met|Confirm Berth/i.test(t)) return true;
  if (/unable to provide|could not be allotted|booking could not/i.test(t)) return true;
  if (/^FAILED!/i.test(t)) return true;
  if (/Direct Book Error:/i.test(t)) return true;
  if (/^BOOKED!?\s*PNR/i.test(t) || /^Done PNR/i.test(t) || /^SUCCESS!?\s*PNR/i.test(t))
    return true;
  if (/^Direct API done$/i.test(t)) return true;
  if (/PNR Fetch Timeout/i.test(t)) return true;
  if (/510 Unable to Process|Client IP — 3 retries failed/i.test(t)) return true;
  if (/\bFAILED\b/i.test(t) || /^ERROR\b/i.test(t) || /\bSTOPPED\b/i.test(t)) return true;
  if (/\bDISCONNECT/i.test(t)) return true;
  return false;
}

/** Pull seats + amount from status; show once as AVL-N|amount */
function ingestStatusMetrics(text) {
  const t = String(text || '');
  let seats = null;
  let amount = null;
  let label = 'AVL';

  const availableFmt = t.match(/(?:Available|AVL)[-\s]?(\d+)\s*\|\s*(\d+(?:\.\d+)?)/i);
  if (availableFmt) {
    seats = Number(availableFmt[1]);
    amount = Number(availableFmt[2]);
    label = 'AVL';
  }

  const racFmt = t.match(/RAC[-\s]?(\d+)\s*\|\s*(\d+(?:\.\d+)?)/i);
  if (racFmt) {
    seats = Number(racFmt[1]);
    amount = Number(racFmt[2]);
    label = 'RAC';
  }

  const wlFmt = t.match(/WL[-\s]?(\d+)\s*\|\s*(\d+(?:\.\d+)?)/i);
  if (wlFmt) {
    seats = Number(wlFmt[1]);
    amount = Number(wlFmt[2]);
    label = 'WL';
  }

  const pair = t.match(/(?:IN\s*[-–—]\s*)?(\d{1,4})\s*:\s*(\d{1,6}(?:\.\d+)?)/i);
  if (pair && seats == null) {
    seats = Number(pair[1]);
    amount = Number(pair[2]);
  }

  const availDash = t.match(/(?:AVAILABLE|AVL)[-\s]*(\d+)/i);
  if (availDash && seats == null) seats = parseInt(availDash[1], 10);

  const fare = t.match(/(?:fare|amount|₹|rs\.?)\s*[:=]?\s*(\d{2,6}(?:\.\d+)?)/i);
  if (fare && amount == null) amount = Number(fare[1]);

  if (seats != null || amount != null) {
    const cur = document.getElementById('runMetrics')?.textContent || '';
    const curM = cur.match(/(Available|AVL|RAC|WL)-(\d+)\|(\d+(?:\.\d+)?)/i);
    const curS = curM ? Number(curM[2]) : 0;
    const curA = curM ? Number(curM[3]) : 0;
    const curLabel = curM ? (curM[1].toLowerCase() === 'available' ? 'AVL' : curM[1]) : label;
    setMetrics(seats != null ? seats : curS, amount != null ? amount : curA, label !== 'AVL' ? label : curLabel);
  }
}

function parseIpSelectValue(val) {
  const v = String(val || '').trim();
  if (!v || v === 'auto') return { ipMode: 'auto', proxyId: null };
  if (v.startsWith('proxy:')) {
    const id = v.slice(6).trim();
    return { ipMode: 'proxy', proxyId: id || null };
  }
  if (v === 'proxy') return { ipMode: 'proxy', proxyId: null };
  return { ipMode: 'auto', proxyId: null };
}

function buildIpSelectValue(ipMode, proxyId, proxies) {
  const list = Array.isArray(proxies) ? proxies : [];
  if (ipMode !== 'proxy') return 'auto';
  if (proxyId && list.some((p) => p.id === proxyId)) return `proxy:${proxyId}`;
  if (list.length) return `proxy:${list[0].id}`;
  return 'auto';
}

function fillIpSelect(proxies, journey, keepCurrent = false) {
  const sel = document.getElementById('ipSelect');
  if (!sel) return;
  const list = Array.isArray(proxies) ? proxies : [];
  const prev = keepCurrent ? String(sel.value || '').trim() : '';
  sel.innerHTML = '';
  const home = document.createElement('option');
  home.value = 'auto';
  home.textContent = 'Home IP';
  sel.appendChild(home);
  list.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = `proxy:${p.id}`;
    opt.textContent = p.label || `Proxy${i + 1}`;
    opt.title = p.host && p.port ? `${p.host}:${p.port}` : '';
    sel.appendChild(opt);
  });
  if (prev && [...sel.options].some((o) => o.value === prev)) {
    sel.value = prev;
    return;
  }
  sel.value = buildIpSelectValue(
    journey?.options?.ipMode || 'auto',
    journey?.options?.proxyId || null,
    list
  );
}

function getIpChoiceFromPanel() {
  return parseIpSelectValue(document.getElementById('ipSelect')?.value);
}

function applyInit(data) {
  ctx = data;
  const j = data.journey || {};
  const pair = data.pairIndex || 1;
  document.getElementById('panelTitle').textContent = formatPanelTitle(j);
  document.getElementById('summaryLine').textContent = formatSummaryLine(j);
  updatePairButton(data);
  document.getElementById('quotaSelect').value = j.quota || 'GN';

  // Main assigns unique IDs from list start (1→first, 2→second…). Never reuse.
  const credId = data.selectedCredentialId || data.credentials?.[0]?.id || '';
  const payments = data.payments || [];
  const paySel = document.getElementById('paySelect');
  // Keep user's panel payment choice across re-init (e.g. ID change → refresh).
  // Only fall back to saved/default when empty or no longer in the list.
  const currentPay = String(paySel?.value || '').trim();
  const payStillValid = currentPay && payments.some((p) => p.id === currentPay);
  const payId = payStillValid
    ? currentPay
    : data.selectedPaymentId || payments[0]?.id || '';

  fillSelect(
    document.getElementById('credSelect'),
    data.credentials || [],
    'id',
    (c) => c.username || c.name || 'ID',
    credId
  );
  fillSelect(
    paySel,
    payments,
    'id',
    (p) => {
      const rawMethod = String(p.paymentMethod || 'PAY').trim();
      const method = rawMethod.toUpperCase() === 'RAZORPAYUPI' ? 'Razorpay UPI ID' : rawMethod;
      const extra = String(p.vpa || '').trim();
      // Only show UPI/VPA when present and different from method (avoid "IRCUPIQR · IRCUPIQR")
      if (extra && extra.toUpperCase() !== method.toUpperCase()) {
        return `${method} · ${extra.slice(0, 14)}`;
      }
      return method;
    },
    payId
  );

  fillIpSelect(data.proxies || [], j, true);
  setPanelMethod(j.options?.panelMethod || 'api');
  if (!running) {
    setRunning(false);
    setPanelStatus('Ready · STANDBY');
  }
}

const METHOD_MODES = {
  classic: 'nget',
  beta: 'eticket',
  api: 'direct',
};

function getPanelMethod() {
  const v = document.getElementById('methodSelect')?.value;
  if (v === 'beta' || v === 'api') return v;
  if (v === 'classic') return 'classic';
  return 'api';
}

function setPanelMethod(method) {
  const m = method === 'beta' || method === 'classic' ? method : 'api';
  const sel = document.getElementById('methodSelect');
  if (sel) sel.value = m;
}

function resolveRunMode(method) {
  return METHOD_MODES[method] || 'nget';
}

function showPanelToast(message) {
  const el = document.getElementById('panelToast');
  if (!el) return;
  const text = String(message || '').trim();
  if (!text) return;
  el.textContent = text;
  el.hidden = false;
  clearTimeout(showPanelToast._t);
  showPanelToast._t = setTimeout(() => {
    el.hidden = true;
  }, 2800);
}

/** Status ONLY on top bar. Metrics line → clock row only (Available-N|amount). */
function setPanelStatus(message) {
  const text = String(message || '').trim();
  if (!text) return;
  if(/^SCRIPT END|^BOOKED\b|^Success By|^FAILED\b|^HEADLESS HANDOFF FAILED/i.test(text))stopElapsedTimer();
  // SCRIPT END → idle only (keep last status); browser closed → show only that (no SCRIPT END)
  if (/^SCRIPT END/i.test(text)) {
    if (/browser closed/i.test(text)) {
      const statusBar = document.getElementById('statusBar');
      if (statusBar) {
        statusBar.classList.remove('is-success-status');
        setFinalHitAnimation(false);
        statusBar.textContent = 'browser closed';
      }
      if (running) {
        hidePtFareProceed();
        setRunning(false);
      }
      return;
    }
    if (running) {
      hidePtFareProceed();
      setRunning(false);
    }
    return;
  }
  // Countdown must show on green status bar (not metrics-only skip)
  const paxSubmit = text.match(/Passenger Submit IN\s*[-–—]\s*(\d+)/i);
  if (paxSubmit) {
    const statusBar = document.getElementById('statusBar');
    if (statusBar) {
      setFinalHitAnimation(false);
      statusBar.textContent = `Passenger Submit IN - ${paxSubmit[1]}`;
    }
    return;
  }
  const metricsOnly =
    /^(Available|AVL|RAC|WL)-\d+\s*\|/i.test(text) ||
    /^Get Availability\|/i.test(text);
  ingestStatusMetrics(text);
  if (metricsOnly) return;
  const statusBar = document.getElementById('statusBar');
  if (/^Success By (?:LEXUS|Lexus)/i.test(text)) {
    hidePtFareProceed();
    markSuccessUi();
    renderSuccessStatus(text);
    return;
  }
  if (statusBar) {
    statusBar.classList.remove('is-success-status');
    setFinalHitAnimation(isFinalHitStatus(text));
    statusBar.textContent = text;
  }
  if (running && isTerminalRunStatus(text)) {
    hidePtFareProceed();
    setRunning(false);
  }
}

function showPanelQr(data) {
  const overlay=document.getElementById('qrOverlay'),image=document.getElementById('qrImage');
  const value=String(typeof data==='string'?data:data?.qrBase64||'').trim();
  if(!overlay||!image||!value)return;
  const src=value.startsWith('data:')?value:'data:image/png;base64,'+value;
  if(!/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(src))return;
  image.src=src;
  document.body?.classList.add('has-panel-qr');
  document.getElementById('qrCaption').textContent=data?.caption||'Scan & Pay';
  overlay.classList.remove('hidden');overlay.setAttribute('aria-hidden','false');
}

function hidePanelQr() {
  const overlay=document.getElementById('qrOverlay');
  document.body?.classList.remove('has-panel-qr');
  overlay?.classList.add('hidden');overlay?.setAttribute('aria-hidden','true');
  document.getElementById('qrImage')?.removeAttribute('src');
}

function closePanelQr() {
  hidePanelQr();
  try { window.panel?.qrClosed?.(); } catch (_) {}
}

function showPtFareProceed(sessionId) {
  pendingPtFareSessionId = sessionId || pendingPtFareSessionId;
  const wrap = document.getElementById('ptFareWrap');
  if (!wrap) return;
  wrap.classList.add('is-visible');
  wrap.setAttribute('aria-hidden', 'false');
}

function hidePtFareProceed() {
  pendingPtFareSessionId = null;
  const wrap = document.getElementById('ptFareWrap');
  if (!wrap) return;
  wrap.classList.remove('is-visible');
  wrap.setAttribute('aria-hidden', 'true');
}

async function onPtFareProceedClick() {
  const sid = pendingPtFareSessionId;
  hidePtFareProceed();
  if (!sid) return;
  setPanelStatus('PROCEEDING…');
  try {
    await window.panel.proceedPtFare(sid, true);
  } catch (_) {}
}

function getRunOptions(engineKey) {
  const choice = getIpChoiceFromPanel();
  return {
    journeyId: ctx?.journey?.id, pairIndex: ctx?.pairIndex,
    credentialId: document.getElementById('credSelect').value,
    paymentId: document.getElementById('paySelect').value,
    engine: ({ web2: 'system-chrome', web3: 'brave', headless: 'headless' })[engineKey],
    mode: resolveRunMode(getPanelMethod()), ipMode: choice.ipMode, proxyId: choice.proxyId,
    quota: document.getElementById('quotaSelect')?.value || null,
    uiEngine: engineKey,
  };
}
function showSchedule(text, armed = false) {
  document.getElementById('autoStartStatus').textContent = text;
  document.getElementById('autoStartCancel').disabled = !armed;
}
async function launch(engineKey) {
  if (running) return;
  if (!ctx?.journey?.id) return;
  hidePtFareProceed();
  hidePanelQr();
  clearSuccessUi();
  const credId = document.getElementById('credSelect').value;
  const payId = document.getElementById('paySelect').value;
  if (!credId || !payId) {
    setPanelStatus('SELECT ID + BANK');
    return;
  }
  const method = getPanelMethod();
  showSchedule('One run · keep this panel open and PC awake');
  document.body.classList.toggle('is-headless',engineKey==='headless');

  startElapsedTimer();
  setRunning(true);
  setPanelStatus(`LAUNCHING · ${method.toUpperCase()}…`);

  let result;
  try { result = await window.panel.launchRun(getRunOptions(engineKey));
  } catch(error) {stopElapsedTimer();setRunning(false);setPanelStatus(error.message||'Launch failed');return;}

  if (result?.ok) {
    if (result.pnr) {
      const msg = String(result.run?.statusMessage || '').trim();
      if (/^Success By (?:LEXUS|Lexus)/i.test(msg)) {
        setPanelStatus(msg);
      } else {
        setPanelStatus(`BOOKED PNR=${result.pnr}`);
      }
    } else {
      setPanelStatus('RUNNING · waiting login…');
    }
  } else {
    stopElapsedTimer();
    setRunning(false);
    setPanelStatus(result?.error || 'FAILED');
  }
}

function tickClocks() {
  if (clockFrozen) return;
  const now = new Date().toLocaleTimeString('en-GB', { hour12: false });
  const run = document.getElementById('runClock');
  if (run) run.textContent = now;
}

function freezeRunClock() {
  const now = new Date().toLocaleTimeString('en-GB', { hour12: false });
  const run = document.getElementById('runClock');
  if (run) run.textContent = now;
  clockFrozen = true;
}

/** STAR-style: push frozen CURRENT TIME back N seconds so screenshot shows earlier time. */
function rewindFrozenClock(seconds = 7) {
  const run = document.getElementById('runClock');
  if (!run) return '';
  const cur = String(run.textContent || '').trim();
  try {
    const parts = cur.split(':').map((x) => Number(x));
    if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
      throw new Error('bad clock');
    }
    let total = parts[0] * 3600 + parts[1] * 60 + parts[2] - Math.max(0, Number(seconds) || 0);
    total = ((total % 86400) + 86400) % 86400;
    const hh = String(Math.floor(total / 3600)).padStart(2, '0');
    const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    const next = `${hh}:${mm}:${ss}`;
    run.textContent = next;
    clockFrozen = true;
    return next;
  } catch (_) {
    const d = new Date(Date.now() - Math.max(0, Number(seconds) || 0) * 1000);
    const next = d.toLocaleTimeString('en-GB', { hour12: false });
    run.textContent = next;
    clockFrozen = true;
    return next;
  }
}

function unfreezeRunClock() {
  clockFrozen = false;
  tickClocks();
}

function startClock() {
  tickClocks();
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = setInterval(tickClocks, 1000);
}

document.addEventListener('DOMContentLoaded', () => {
  startClock();
  window.panel.onInit(applyInit);
  window.panel.onPanelStatus((data) => {
    if (data?.message) setPanelStatus(data.message);
  });
  window.panel.onPanelPtFare((data) => {
    if (data?.show === false) {
      hidePtFareProceed();
      return;
    }
    if (data?.show) {
      if (data.statusMessage) setPanelStatus(data.statusMessage);
      else if (data.reason === 'sibling-init') setPanelStatus('ANOTHER PAIR ALREADY PROCEED');
      else if (data.message || data.amount) setPanelStatus('PT FARE HIGH');
      showPtFareProceed(data.sessionId);
    }
  });
  window.panel.onPanelQr(showPanelQr);
  window.panel.onPanelQrHide(hidePanelQr);
  if (typeof window.panel.onPrivacyMask === 'function') {
    window.panel.onPrivacyMask(() => {
      // Screenshot prep: clock −7s (STAR), then mask ID
      rewindFrozenClock(7);
      maskCredIdLabel();
    });
  }
  if (typeof window.panel.onPrivacyRestore === 'function') {
    window.panel.onPrivacyRestore(() => {
      restoreCredIdLabel();
    });
  }
  document.getElementById('qrClose')?.addEventListener('click', closePanelQr);
  document.getElementById('ptFareProceed')?.addEventListener('click', () => {
    onPtFareProceedClick();
  });
  document.getElementById('credSelect')?.addEventListener('change', async () => {
    if (!ctx?.journeyId) return;
    const credentialId = document.getElementById('credSelect')?.value || '';
    if (!credentialId || typeof window.panel.setPairCredential !== 'function') return;
    try {
      await window.panel.setPairCredential(
        ctx.journeyId,
        ctx.pairIndex || 1,
        credentialId
      );
    } catch (_) {}
  });
  document.getElementById('ipSelect')?.addEventListener('change', async () => {
    if (!ctx?.journeyId || typeof window.panel.setIpChoice !== 'function') return;
    const choice = getIpChoiceFromPanel();
    try {
      await window.panel.setIpChoice({
        journeyId: ctx.journeyId,
        ipMode: choice.ipMode,
        proxyId: choice.proxyId,
      });
    } catch (_) {}
  });
  document.getElementById('runSlot')?.addEventListener('click', () => {
    if (running || document.body.classList.contains('is-success')) {
      clearSuccessUi();
      setRunning(false);
    }
  });
  document.getElementById('panelPowerBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      if (typeof window.panel?.close === 'function') {
        Promise.resolve(window.panel.close()).catch(() => {});
      }
    } catch (_) {}
  });
  document.getElementById('pairBtn')?.addEventListener('click', async () => {
    if (!ctx?.journeyId || Number(ctx.pairIndex) !== 1) return;
    const maxPairs = Math.max(2, Number(ctx.maxPairs) || 4);
    const openCount = Number(ctx.openPairCount) || 1;
    if (openCount >= maxPairs && !ctx.canOpenNextPair) {
      setPanelStatus(`Max ${maxPairs} pairs`);
      return;
    }
    const pairBtn = document.getElementById('pairBtn');
    if (pairBtn) pairBtn.disabled = true;
    try {
      const openNext =
        typeof window.panel.openNextPair === 'function'
          ? window.panel.openNextPair
          : window.panel.openPair2;
      const result = await openNext(ctx.journeyId);
      if (!result?.ok) {
        if (pairBtn) pairBtn.disabled = false;
        const err = String(result?.error || 'PAIR OPEN FAILED');
        if (/IRCTC ID not available/i.test(err)) {
          showPanelToast(err);
        } else {
          setPanelStatus(err);
        }
        updatePairButton(ctx);
        return;
      }
      // main refreshTicketPanels → panel:init updates canOpenNextPair for PAIR 3/4
      // Don't force-lock the badge here (that blocked pair 3+).
    } catch (e) {
      if (pairBtn) pairBtn.disabled = false;
      setPanelStatus(e?.message || 'PAIR OPEN FAILED');
      updatePairButton(ctx);
    }
  });
  document.querySelectorAll('.eng').forEach((btn) => {
    btn.addEventListener('click', () => launch(btn.dataset.engine));
  });
  document.getElementById('autoStartArm').addEventListener('click', async () => {
    if (running) { showSchedule('A run is already active'); return; }
    const engine = document.getElementById('autoStartEngine').value;
    const opts = getRunOptions(engine);
    if (engine === 'headless' && opts.mode !== 'nget') { showSchedule('Select Classic for HEADLESS'); return; }
    const button = document.getElementById('autoStartArm');
    button.disabled = true;
    try {
      const result = await window.panel.scheduleRun(Number(document.getElementById('autoStartHour').value), opts);
      if (!result.ok) { showSchedule(result.error, !document.getElementById('autoStartCancel').disabled); return; }
      const date = new Date(result.due).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
      showSchedule(`Scheduled ${date} IST · ${engine.toUpperCase()} · ${getPanelMethod().toUpperCase()}`, true);
    } catch (error) { showSchedule(error.message); }
    finally { button.disabled = false; }
  });
  document.getElementById('autoStartCancel').addEventListener('click', async () => {
    try { await window.panel.cancelSchedule(); showSchedule('Auto-start cancelled'); }
    catch (error) { showSchedule(error.message, true); }
  });
  window.panel.onSchedule(data => {
    if (data.state === 'starting') {
      showSchedule('Scheduled run started'); hidePtFareProceed(); clearSuccessUi();
      document.body.classList.toggle('is-headless', data.engine === 'headless');
      startElapsedTimer(); setRunning(true); setPanelStatus('AUTO-START · LAUNCHING…');
    } else if (data.state === 'missed') { showSchedule(data.error); }
    else if (data.state === 'finished' && !data.result?.ok) {
      stopElapsedTimer(); setRunning(false); setPanelStatus(data.result?.error || 'Auto-start failed');
      showSchedule('Auto-start failed · schedule again');

    }
  });
});

document.getElementById('headless-view')?.addEventListener('click',async()=>{try{const all=await window.panel.listRuns();const list=Array.isArray(all)?all:all?.runs||[];const run=list.find(r=>r.engine==='headless'&&r.journeyId===ctx?.journey?.id&&Number(r.pairIndex)===Number(ctx?.pairIndex));if(!run){setPanelStatus('NO HEADLESS RUN');return;}const result=await window.panel.focusRun(run.sessionId);if(!result?.ok)setPanelStatus(result?.error||'Could not open headless view');}catch(error){setPanelStatus(error.message);}});
