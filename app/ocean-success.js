/**
 * Direct API booking success — panel status, server upload payload.
 * Classic / Beta WEB use their own inject flow (not this module).
 */
const SUCCESS_URL =
  process.env.OCEAN_SUCCESS_URL || 'https://oceanxsoft.com/api/app/success';

function stationCode(raw) {
  const s = String(raw || '').trim();
  if (!s) return '—';
  const parts = s.split(' - ');
  if (parts.length > 1) return parts[parts.length - 1].trim().toUpperCase();
  if (s.length <= 5) return s.toUpperCase();
  return s.slice(0, 4).toUpperCase();
}

function trainNumberOnly(raw) {
  const s = String(raw || '').trim();
  return (s.match(/(\d{3,5})/) || [])[1] || s.split('-')[0].trim() || '—';
}

function formatJourneyDate(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}-${m[2]}`;
  return String(iso);
}

function uiEngineLabel(uiEngine) {
  const e = String(uiEngine || '').toLowerCase();
  if (e === 'web3' || e === 'brave' || e === 'system-brave') return 'WEB-3';
  return 'WEB-2';
}

function formatSuccessStatus(uiEngine, opts = {}) {
  const mode = uiEngineLabel(uiEngine, opts);
  const pnr = String(opts.pnr || '').trim();
  if (pnr) return `Success By Ocean ${mode} · PNR ${pnr}`;
  return `Success By Ocean ${mode}`;
}

function isDirectRun(meta) {
  if (!meta) return false;
  return meta.mode === 'direct';
}

function extractPnr(message) {
  const t = String(message || '');
  const m =
    t.match(/BOOKED!?\s*PNR[=:\s]+(\d{10})/i) ||
    t.match(/BOOKED PNR=(\d{10})/i) ||
    t.match(/Done PNR\s+(\d{10})/i) ||
    t.match(/\bPNR[=:\s]+(\d{10})\b/i);
  return m ? m[1] : null;
}

function buildSrcDest(journey) {
  const j = journey || {};
  const from = stationCode(j.from);
  const to = stationCode(j.to);
  const cls = String(j.class || '').trim();
  const quota = String(j.quota || '').trim();
  const date = formatJourneyDate(j.date);
  const mid = [cls, quota].filter(Boolean).join(':');
  return [from + (to !== '—' ? `-${to}` : ''), mid, date].filter(Boolean).join(' ').trim();
}

function buildSuccessPayload({
  journey,
  payment,
  pnr,
  licenceKey,
  base64image,
  uiEngine,
  pnrTime,
}) {
  const pay = payment || {};
  const mode = uiEngineLabel(uiEngine);
  return {
    PNR_Time: pnrTime || new Date().toLocaleTimeString('en-GB', { hour12: false }),
    Gateway: String(pay.name || pay.paymentMethod || '').trim(),
    Src_Dest: buildSrcDest(journey),
    TrainNo: trainNumberOnly(journey?.trainNo),
    UserID: String(licenceKey || '').trim(),
    PNR: String(pnr || '').trim(),
    Mode: mode,
    base64image: String(base64image || ''),
  };
}

async function postSuccessPayload(payload) {
  const res = await fetch(SUCCESS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

module.exports = {
  SUCCESS_URL,
  stationCode,
  trainNumberOnly,
  uiEngineLabel,
  formatSuccessStatus,
  isDirectRun,
  extractPnr,
  buildSrcDest,
  buildSuccessPayload,
  postSuccessPayload,
};
