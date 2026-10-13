// "Update LEXUS" feedback: the toast must be fully on screen in the narrow 220px toolbar window,
// stay visible while the check is running, and show "LEXUS is up to date" long enough to read.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { pathToFileURL } = require('node:url');

const CHROME = [process.env.LEXUS_CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']
  .find(p => p && fs.existsSync(p));
const wait = ms => new Promise(r => setTimeout(r, ms));

async function toolbarPage(browser, checkImpl) {
  const page = await browser.newPage();
  await page.setViewport({ width: 220, height: 660 });
  await page.evaluateOnNewDocument((impl) => {
    const fn = new Function('return ' + impl)();
    window.lexus = new Proxy({ checkForUpdates: fn }, { get: (t, k) => (k in t ? t[k] : () => Promise.resolve({})) });
  }, checkImpl);
  await page.goto(pathToFileURL(path.join(__dirname, 'app/index.html')).href + '?view=toolbar');
  await page.waitForSelector('[data-action="check-updates"]');
  await wait(300);
  return page;
}
const toastState = page => page.evaluate(() => {
  const el = document.getElementById('toast'); const r = el.getBoundingClientRect();
  return { text: el.textContent.trim(), shown: !el.hidden && getComputedStyle(el).display !== 'none', fullyInView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, left: Math.round(r.left), right: Math.round(r.right), vw: innerWidth };
});

test('up-to-date message is fully visible in the 220px toolbar and readable for a few seconds', { skip: !CHROME && 'Chrome not found' }, async () => {
  const puppeteer = require('./app/node_modules/puppeteer-core');
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  try {
    const page = await toolbarPage(browser, '() => new Promise(r => setTimeout(() => r({ update: false, current: "0.1.9", latest: "0.1.9" }), 2500))');
    await page.click('[data-action="check-updates"]');
    await wait(300);
    let s = await toastState(page);
    assert.equal(s.shown, true); assert.match(s.text, /Checking for updates/); assert.equal(s.fullyInView, true, 'checking toast clipped: ' + JSON.stringify(s));
    await wait(2100); // 2.4s: past the old 1.8s hide timer, check still running
    s = await toastState(page);
    assert.equal(s.shown, true, 'feedback vanished while the check was still running');
    await wait(900); // result arrives at ~2.5s
    s = await toastState(page);
    assert.match(s.text, /LEXUS is up to date/);
    assert.equal(s.shown, true);
    assert.equal(s.fullyInView, true, 'result toast clipped: ' + JSON.stringify(s));
    await wait(2500);
    s = await toastState(page);
    assert.equal(s.shown, true, 'result disappeared too quickly');
    await page.close();
  } finally { await browser.close(); }
});

test('error and update-available messages are fully visible in the toolbar', { skip: !CHROME && 'Chrome not found' }, async () => {
  const puppeteer = require('./app/node_modules/puppeteer-core');
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  try {
    for (const [impl, re] of [
      ['() => Promise.resolve({ error: "Update check failed: network unreachable" })', /network unreachable/],
      ['() => Promise.resolve({ update: true, version: "0.2.0" })', /Update available/],
    ]) {
      const page = await toolbarPage(browser, impl);
      await page.click('[data-action="check-updates"]');
      await wait(700);
      const s = await toastState(page);
      assert.match(s.text, re);
      assert.equal(s.fullyInView, true, 'clipped: ' + JSON.stringify(s));
      await page.close();
    }
  } finally { await browser.close(); }
});
