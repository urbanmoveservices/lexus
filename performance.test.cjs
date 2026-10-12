const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), Module = require('node:module');
const { createRequestCache } = require('./app/request-cache.cjs');
test('UI settings persist once per change and unchanged settings do not write', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lexus-perf-'));
  let writes = 0;
  const filename = path.join(__dirname, 'app/profile-store.js');
  const m = new Module(filename, module); m.filename = filename; m.paths = Module._nodeModulePaths(path.dirname(filename));
  const real = m.require.bind(m);
  m.require = name => name === 'electron' ? { app: { isPackaged: false, getPath: () => root } } : name === 'fs' ? {
    ...fs, writeFileSync: (...args) => { if (String(args[0]).endsWith('lexus.sqlite')) writes++; return fs.writeFileSync(...args); },
  } : real(name);
  m._compile(fs.readFileSync(filename, 'utf8'), filename);
  const store = m.exports; await store.init(); writes = 0;
  store.setUiState({ selectedJourneyId: 'ticket', manualLoginEnabled: '1' });
  assert.equal(writes, 1); assert.equal(store.getUiState().manualLoginEnabled, '1');
  store.setUiState({ selectedJourneyId: 'ticket', manualLoginEnabled: '1' }); assert.equal(writes, 1);
  store.setUiState({ selectedJourneyId: null }); assert.equal(writes, 2);
  assert.equal(store.getUiState().selectedJourneyId, null); assert.equal(store.getUiState().manualLoginEnabled, '1');
  const SQL = await real('sql.js')(); const db = new SQL.Database(fs.readFileSync(store.getDbPath()));
  assert.equal(db.exec("SELECT value FROM ui_state WHERE key='manualLoginEnabled'")[0].values[0][0], '1'); db.close();
});
test('identical concurrent train searches share request and cached response', async () => {
  const request = createRequestCache(60000); let calls = 0;
  const load = async () => { calls++; return ['train']; };
  const [a,b] = await Promise.all([request('route', load), request('route', load)]);
  assert.deepEqual(a,b); await request('route', load); assert.equal(calls,1);
});
test('availability requests coalesce only while pending and never cache old seats', async () => {
  const request = createRequestCache(0); let calls = 0;
  const load = async () => ++calls;
  assert.deepEqual(await Promise.all([request('seat',load), request('seat',load)]), [1,1]);
  assert.equal(await request('seat',load),2);
});
test('failed requests can be retried without a poisoned cache', async () => {
  const request = createRequestCache(60000);
  await assert.rejects(request('route', async () => { throw Error('offline'); }));
  assert.equal(await request('route', async () => 'online'),'online');
});
function trainFixture(response) {
  const filename = path.join(__dirname, 'app/train-service.js'); const m = new Module(filename, module);
  m.filename = filename; m.paths = Module._nodeModulePaths(path.dirname(filename)); const real = m.require.bind(m);
  let apiCalls = 0, bootstrapCalls = 0, ocrWarmups = 0;
  m.require = name => name === './stealth' ? { getChromeUserAgent: () => 'test' } : name === './erail-ocr-bridge' ? {
    ensureOcrReady: async () => { ocrWarmups++; }, solveCaptchaImage: async () => '2',
  } : name === 'electron' ? { net: { fetch: async url => {
    if (url.includes('StaticEnquiry')) { bootstrapCalls++; return {ok:true,text:async()=>''}; }
    if (url.includes('captchaDraw')) return {ok:true,arrayBuffer:async()=>new ArrayBuffer(1)};
    apiCalls++; return response();
  } } } : real(name);
  m._compile(fs.readFileSync(filename,'utf8').replace('return new Promise((r) => setTimeout(r, ms));', 'return Promise.resolve();'), filename);
  return { api: m.exports, counts: () => ({apiCalls,bootstrapCalls,ocrWarmups}) };
}
const payload = { trainNo:'12345',classCode:'SL',fromCode:'BSB',toCode:'PRYJ',date:'12-10-2026',quota:'GN' };
test('captcha rejection has three attempts; terminal network failure has one', async () => {
  const captcha = trainFixture(() => ({ok:true,text:async()=>JSON.stringify({errorMessage:'Invalid captcha'})}));
  await assert.rejects(captcha.api.solveCaptchaAndFetchAvailability(payload), /Invalid captcha/);
  assert.equal(captcha.counts().apiCalls,3);
  const offline = trainFixture(() => { throw Error('network offline'); });
  await assert.rejects(offline.api.solveCaptchaAndFetchAvailability(payload), /network offline/);
  assert.equal(offline.counts().apiCalls,1);
});
test('availability bootstraps cookie session once and returns fresh successful data', async () => {
  const f = trainFixture(() => ({ok:true,text:async()=>JSON.stringify({avlDayList:[{availablityStatus:'AVAILABLE'}]})}));
  const [a,b] = await Promise.all([f.api.solveCaptchaAndFetchAvailability(payload), f.api.solveCaptchaAndFetchAvailability(payload)]);
  assert.deepEqual(a,b); assert.equal(f.counts().apiCalls,1); assert.equal(f.counts().bootstrapCalls,1);
  await f.api.solveCaptchaAndFetchAvailability(payload); assert.equal(f.counts().apiCalls,2);
});
