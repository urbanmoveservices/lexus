/** Shared file-log helper for Paytm / PhonePe QR flows (merged into IRCTC direct run .txt). */
(function (global) {
  function maskSecret(v, keep = 8) {
    const s = String(v || '');
    if (!s) return '';
    if (s.length <= keep * 2) return `${s.slice(0, 2)}…(${s.length})`;
    return `${s.slice(0, keep)}…${s.slice(-4)} (len=${s.length})`;
  }

  function headersForLog(headers) {
    const h = { ...(headers || {}) };
    if (h.authorization) {
      h.authorization = `Bearer ${maskSecret(String(h.authorization).replace(/^Bearer\s+/i, ''))}`;
    }
    if (h.Authorization) {
      h.Authorization = `Bearer ${maskSecret(String(h.Authorization).replace(/^Bearer\s+/i, ''))}`;
    }
    if (h.bmiyek) h.bmiyek = maskSecret(h.bmiyek);
    if (h['spa-csrf-token']) h['spa-csrf-token'] = maskSecret(h['spa-csrf-token'], 6);
    return h;
  }

  function bodyForLog(body) {
    if (body == null) return '(none)';
    let text = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
    text = text.replace(/data:image\/[a-zA-Z+]+;base64,[A-Za-z0-9+/=]{80,}/g, 'data:image…;[BASE64_REDACTED]');
    if (text.length > 12000) {
      return text.slice(0, 12000) + `\n… [TRUNCATED total=${text.length}]`;
    }
    return text;
  }

  function createFlowLogger(gatewayLabel) {
    const state = { seq: 0, lines: [] };
    state.lines.push(`=== ${gatewayLabel} FLOW ===`);
    state.lines.push(`started: ${new Date().toISOString()}`);
    state.lines.push('');

    return {
      fileLog(line) {
        state.lines.push(String(line));
      },
      logUi(msg) {
        state.lines.push(`[UI] ${msg}`);
      },
      logHttp(method, url, headers, body, status, responseText, t0) {
        const seq = ++state.seq;
        state.lines.push('============================================================');
        state.lines.push(`#${seq} REQUEST  ${new Date().toISOString()}`);
        state.lines.push(`${method} ${url}`);
        state.lines.push('--- headers ---');
        state.lines.push(JSON.stringify(headersForLog(headers), null, 2));
        state.lines.push('--- body ---');
        state.lines.push(bodyForLog(body));
        state.lines.push(`--- RESPONSE  status=${status}  ${Date.now() - (t0 || Date.now())}ms ---`);
        state.lines.push(bodyForLog(responseText));
        state.lines.push('');
      },
      getLines() {
        return state.lines.slice();
      },
    };
  }

  global.LexusQrFileLog = { create: createFlowLogger };
})(typeof window !== 'undefined' ? window : global);
