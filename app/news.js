function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function highlightText(text) {
  let html = escapeHtml(text);
  html = html.replace(/\b([A-Z][A-Z0-9_\- ]{2,})\b/g, '<strong>$1</strong>');
  html = html.replace(/\b(\d+(?:\.\d+)?|\d+:\d+)\b/g, '<em>$1</em>');
  return html;
}

function formatClock(now = new Date()) {
  const day = String(now.getDate()).padStart(2, '0');
  const month = now.toLocaleDateString('en-GB', { month: 'short' });
  const year = now.getFullYear();
  const date = `${day}-${month}-${year}`;
  const time = now
    .toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
    .replace(/\s/g, ' ')
    .toLowerCase();
  return { date, time };
}

function normalizeNewsDate(raw, fallback) {
  const text = String(raw || '').trim();
  if (!text) return fallback;
  return text;
}

function isGatewayLine(text) {
  const t = String(text || '').toUpperCase();
  return (
    (t.includes('PAY') && (t.includes('QR') || t.includes('UPI'))) ||
    t.includes('E-WALLET') ||
    t.includes('EWALLET') ||
    (t.includes('_QR') && t.split(/\s+/).length >= 3)
  );
}

function isPaymentGatewayHeading(text) {
  return /working payment gateway/i.test(String(text || ''));
}

function appendParagraph(bodyWrap, line, { welcome = false, gateways = false, sectionHead = false } = {}) {
  const p = document.createElement('p');
  if (welcome) p.className = 'news-welcome';
  if (gateways) p.className = 'news-gateways';
  if (sectionHead) p.className = 'news-section-head';
  p.innerHTML = highlightText(line);
  bodyWrap.appendChild(p);
}

function renderBodyLines(bodyWrap, items) {
  const lines = (items || []).map((x) => String(x || '').trim()).filter(Boolean);
  let welcomeDone = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (isPaymentGatewayHeading(line)) {
      appendParagraph(bodyWrap, line, { sectionHead: true });
      const next = lines[i + 1];
      if (next && isGatewayLine(next)) {
        const rule = document.createElement('hr');
        rule.className = 'news-rule';
        bodyWrap.appendChild(rule);
        appendParagraph(bodyWrap, next, { gateways: true });
        i += 1;
      }
      continue;
    }

    if (isGatewayLine(line)) {
      appendParagraph(bodyWrap, line, { gateways: true });
      continue;
    }

    const isWelcome = !welcomeDone && /welcome/i.test(line);
    appendParagraph(bodyWrap, line, { welcome: isWelcome });
    if (isWelcome) welcomeDone = true;
  }
}

function renderPayload(payload) {
  const news = payload?.news || { date: '', items: [] };
  const clock = formatClock();
  const headerDate = normalizeNewsDate(news.date, clock.date);

  const dateEl = document.getElementById('newsDate');
  const timeEl = document.getElementById('newsTime');
  const listEl = document.getElementById('newsList');
  const emptyEl = document.getElementById('newsEmpty');

  if (dateEl) dateEl.textContent = headerDate;
  if (timeEl) timeEl.textContent = clock.time;

  if (!listEl) return;

  listEl.innerHTML = '';
  if (!news.items?.length) {
    listEl.hidden = true;
    if (emptyEl) emptyEl.hidden = false;
    return;
  }

  if (emptyEl) emptyEl.hidden = true;
  listEl.hidden = false;

  const dateLine = document.createElement('p');
  dateLine.className = 'news-doc-date';
  dateLine.textContent = headerDate;

  const bodyWrap = document.createElement('div');
  bodyWrap.className = 'news-doc-body';
  renderBodyLines(bodyWrap, news.items);

  listEl.append(dateLine, bodyWrap);
}

async function boot() {
  document.getElementById('btnUpdate')?.addEventListener('click', async event => { const button=event.currentTarget; button.disabled=true; try {const result=await window.newsUi.update(); if(result?.error) document.getElementById('newsEmpty').textContent=result.error;} finally {button.disabled=false;} });
  const btn = document.getElementById('btnOk');
  btn?.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      await window.newsUi.ack();
    } catch (_) {
      btn.disabled = false;
    }
  });

  document.getElementById('btnWhatsApp')?.addEventListener('click', () => {
    window.newsUi.openSupportLink?.('whatsapp');
  });
  document.getElementById('btnTelegram')?.addEventListener('click', () => {
    window.newsUi.openSupportLink?.('telegram');
  });

  try {
    const payload = await window.newsUi.getPayload();
    renderPayload(payload);
  } catch (err) {
    const emptyEl = document.getElementById('newsEmpty');
    const listEl = document.getElementById('newsList');
    if (listEl) listEl.hidden = true;
    if (emptyEl) {
      emptyEl.hidden = false;
      emptyEl.textContent = err.message || 'News load failed';
    }
  }

  setInterval(() => {
    const { time } = formatClock();
    const timeEl = document.getElementById('newsTime');
    if (timeEl) timeEl.textContent = time;
  }, 30000);
}

document.addEventListener('DOMContentLoaded', () => {
  boot();
});
