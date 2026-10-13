// History modal: all 10 columns and the "Clear history" button must be visible/usable
// at the real modal window sizes (default 880x580, minimum 760x480).
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { pathToFileURL } = require('node:url');

const CHROME = [
  process.env.LEXUS_CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find(p => p && fs.existsSync(p));
const COLUMNS = ['ID', 'Ticket Name', 'User ID', 'From', 'To', 'Jrny Date', 'Bank/VPA', 'PNR', 'Fare', 'Date'];
const SIZES = [{ width: 880, height: 580, name: 'default' }, { width: 760, height: 480, name: 'minimum' }];

const makeRows = n => Array.from({ length: n }, (_, i) => ({
  ticketName: 'DDU_BSB_RAHULS_LONG_TICKET_NAME_' + i,
  userId: 'longusername' + i,
  fromStn: 'DDU', toStn: 'BSB', journeyDate: '2026-10-13',
  bankName: 'IRCUPIID · 8376012345@ybl',
  pnr: '4' + String(i).padStart(9, '2'),
  fare: '1149.1', bookingDate: '2026-10-12',
}));

async function openHistory(browser, size, rows) {
  const page = await browser.newPage();
  await page.setViewport({ width: size.width, height: size.height });
  await page.evaluateOnNewDocument((items) => {
    const noop = () => Promise.resolve({});
    window.lexus = new Proxy({ listHistory: () => Promise.resolve({ items }), onHistoryUpdated: () => () => {} }, {
      get: (t, k) => (k in t ? t[k] : noop),
    });
  }, rows);
  await page.goto(pathToFileURL(path.join(__dirname, 'app/index.html')).href + '?view=modal&modal=history');
  await page.waitForSelector('.modal-history .history-table-head');
  await new Promise(r => setTimeout(r, 400));
  return page;
}

// Scroll the modal like a user would and report whether the button can be clicked.
async function buttonState(page) {
  return page.evaluate(() => {
    const btn = document.querySelector('[data-action="history-clear"]');
    const panel = document.querySelector('.modal-history');
    btn.scrollIntoView({ block: 'nearest' });
    const r = btn.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      inViewport: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
      clickable: hit === btn || btn.contains(hit),
      display: getComputedStyle(btn).display, visibility: getComputedStyle(btn).visibility,
      panelScrolls: panel.scrollHeight > panel.clientHeight,
    };
  });
}

// Button must be visible WITHOUT having to scroll the whole modal.
async function buttonVisibleWithoutScrolling(page) {
  return page.evaluate(() => {
    const r = document.querySelector('[data-action="history-clear"]').getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), viewportH: innerHeight, visible: r.top >= 0 && r.bottom <= innerHeight };
  });
}

test('history table shows all 10 column headers inside the modal at default and minimum size', { skip: !CHROME && 'Chrome not found' }, async () => {
  const puppeteer = require('./app/node_modules/puppeteer-core');
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  try {
    for (const size of SIZES) {
      const page = await openHistory(browser, size, makeRows(3));
      const res = await page.evaluate(() => {
        const panel = document.querySelector('.modal-history');
        const heads = [...document.querySelectorAll('.history-table-head span')];
        const pr = panel.getBoundingClientRect();
        return {
          labels: heads.map(h => h.textContent.trim()),
          hidden: heads.filter(h => { const r = h.getBoundingClientRect(); return r.width < 8 || r.right > pr.right + 0.5 || r.left < pr.left - 0.5; }).map(h => h.textContent.trim()),
          horizontalScroll: panel.scrollWidth > panel.clientWidth + 1,
        };
      });
      assert.deepEqual(res.labels, COLUMNS, size.name);
      assert.deepEqual(res.hidden, [], `${size.name}: columns clipped by the modal edge`);
      assert.equal(res.horizontalScroll, false, `${size.name}: history table needs sideways scrolling`);
      await page.close();
    }
  } finally { await browser.close(); }
});

test('Clear history button is visible and clickable for 0, 1, 12 and 50 bookings', { skip: !CHROME && 'Chrome not found' }, async () => {
  const puppeteer = require('./app/node_modules/puppeteer-core');
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  try {
    for (const size of SIZES) {
      for (const n of [0, 1, 12, 50]) {
        const page = await openHistory(browser, size, makeRows(n));
        const state = await buttonState(page);
        const label = `${size.name} ${size.width}x${size.height}, ${n} rows`;
        assert.equal(state.display === 'none' || state.visibility === 'hidden', false, label + ': button hidden by CSS');
        assert.equal(state.inViewport, true, label + ': button outside the window');
        assert.equal(state.clickable, true, label + ': button covered by another element');
        await page.close();
      }
    }
  } finally { await browser.close(); }
});

test('Clear history button is on screen without scrolling the modal (no hidden footer)', { skip: !CHROME && 'Chrome not found' }, async () => {
  const puppeteer = require('./app/node_modules/puppeteer-core');
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  try {
    for (const size of SIZES) {
      for (const n of [1, 12, 50]) {
        const page = await openHistory(browser, size, makeRows(n));
        const v = await buttonVisibleWithoutScrolling(page);
        assert.equal(v.visible, true, `${size.name} ${size.width}x${size.height}, ${n} rows: button at y=${v.top}-${v.bottom} but window is ${v.viewportH}px high`);
        await page.close();
      }
    }
  } finally { await browser.close(); }
});

test('history rows render all ten cells for a booking', { skip: !CHROME && 'Chrome not found' }, async () => {
  const puppeteer = require('./app/node_modules/puppeteer-core');
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  try {
    const page = await openHistory(browser, SIZES[0], makeRows(1));
    const cells = await page.evaluate(() => [...document.querySelectorAll('#historyList .history-row:first-child span')].map(s => s.className + '=' + s.textContent.trim()));
    assert.equal(cells.length, 10);
    assert.deepEqual(cells.map(c => c.split('=')[0]), ['col-id', 'col-ticket', 'col-user', 'col-from', 'col-to', 'col-jrny', 'col-bank', 'col-pnr', 'col-fare', 'col-date']);
    assert.match(cells.find(c => c.startsWith('col-pnr=')), /=\d{10}$/);
    await page.close();
  } finally { await browser.close(); }
});

// Regression: lexus-theme.css forces modal spans to dark navy (!important), which made the dark
// history header and rows unreadable (dark text on dark background).
test('history header and row text have readable contrast (WCAG AA 4.5:1)', { skip: !CHROME && 'Chrome not found' }, async () => {
  const puppeteer = require('./app/node_modules/puppeteer-core');
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  try {
    const page = await openHistory(browser, SIZES[0], makeRows(2));
    const res = await page.evaluate(() => {
      const parse = c => (c.match(/[\d.]+/g) || []).slice(0, 4).map(Number);
      const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const bgOf = el => { for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c.length === 3 || (c.length === 4 && c[3] > 0.5)) return c; } return [255, 255, 255]; };
      const ratio = el => { const a = lum(parse(getComputedStyle(el).color)), b = lum(bgOf(el)); const [hi, lo] = a > b ? [a, b] : [b, a]; return (hi + 0.05) / (lo + 0.05); };
      const pick = sel => [...document.querySelectorAll(sel)].map(el => ({ text: el.textContent.trim(), ratio: Math.round(ratio(el) * 10) / 10 }));
      return { head: pick('.history-table-head span'), cells: pick('#historyList .history-row span') };
    });
    const bad = [...res.head, ...res.cells].filter(x => x.ratio < 4.5);
    assert.deepEqual(bad, [], 'unreadable history text: ' + JSON.stringify(bad));
    await page.close();
  } finally { await browser.close(); }
});
