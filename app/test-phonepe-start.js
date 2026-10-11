const logEl = document.getElementById('log');
const runBtn = document.getElementById('runBtn');
const qrBox = document.getElementById('qrBox');
const qrImg = document.getElementById('qrImg');

function appendLog(line) {
  const t = new Date().toLocaleTimeString();
  logEl.textContent = `[${t}] ${line}\n` + logEl.textContent.slice(0, 8000);
}

function readPayload() {
  let tokens = {};
  const raw = document.getElementById('tokensJson').value.trim();
  if (raw) {
    try {
      tokens = JSON.parse(raw);
    } catch (e) {
      throw new Error('Tokens JSON invalid: ' + e.message);
    }
  }
  const access = document.getElementById('access').value.trim();
  const refresh = document.getElementById('refresh').value.trim();
  const csrf = document.getElementById('csrf').value.trim();
  const greq = document.getElementById('greq').value.trim();
  if (access) tokens.access_token = access;
  if (refresh) tokens.refresh_token = refresh;
  if (csrf) tokens.csrf = csrf;
  if (greq) tokens.greq = greq;

  const wsUser = document.getElementById('wsUser').value.trim();
  const clientTxnId = document.getElementById('clientTxnId').value.trim();
  if (!tokens.access_token) throw new Error('access_token required');
  if (!wsUser) throw new Error('wsUser required');
  if (!clientTxnId) throw new Error('clientTxnId required (bookingInitPayment ke baad)');

  return { tokens, wsUser, clientTxnId };
}

function showQr(qr) {
  if (!qr) return;
  let src = String(qr);
  if (!src.startsWith('data:')) {
    src = src.replace(/^data:image\/[a-zA-Z+]+;base64,/, '');
    src = `data:image/png;base64,${src}`;
  }
  qrImg.src = src;
  qrBox.style.display = 'block';
}

function hideQr() {
  qrBox.style.display = 'none';
  qrImg.removeAttribute('src');
}

runBtn.addEventListener('click', async () => {
  runBtn.disabled = true;
  hideQr();
  try {
    const payload = readPayload();
    appendLog('Starting PhonePe start_process (hidden host)…');
    const result = await window.testPhonePe.run(payload);
    appendLog('Done: ' + JSON.stringify(result?.result || result));
  } catch (e) {
    appendLog('ERROR: ' + (e.message || e));
  } finally {
    runBtn.disabled = false;
  }
});

window.testPhonePe.onLog((msg) => appendLog(msg));
window.testPhonePe.onQr((data) => showQr(data?.qr));
window.testPhonePe.onQrHide(() => hideQr());
