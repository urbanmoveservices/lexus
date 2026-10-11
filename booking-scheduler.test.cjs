const test = require('node:test');
const assert = require('node:assert/strict');
const { nextStart, createScheduler } = require('./app/booking-scheduler.cjs');
const options = { journeyId: 'j', credentialId: 'c', paymentId: 'p', pairIndex: 1, uiEngine: 'web2' };
test('all three times use IST and passed times roll to tomorrow', () => {
  const now = Date.parse('2026-10-11T01:00:00Z');
  for (const [hour, utc] of [[8,'02:30'],[10,'04:30'],[11,'05:30']]) {
    assert.equal(new Date(nextStart(hour, now)).toISOString(), `2026-10-11T${utc}:00.000Z`);
    assert.equal(nextStart(hour, nextStart(hour, now)), nextStart(hour, now) + 86400000);
  }
  assert.throws(() => nextStart(9, now));
});
function fixture() {
  let now = Date.parse('2026-10-11T01:00:00Z');
  const timers = [], launches = [], notices = [];
  const scheduler = createScheduler({ now: () => now, timer: fn => { timers.push(fn); return fn; }, clear: () => {},
    launch: async opts => { launches.push(opts); return { ok: true }; }, notify: (id, data) => notices.push({ id, ...data }) });
  return { scheduler, timers, launches, notices, setNow: value => { now = value; } };
}
test('launches once with saved settings and fresh start time', async () => {
  const f = fixture(), opts = { ...options };
  const { due } = f.scheduler.arm(1, 8, opts); opts.credentialId = 'changed';
  f.setNow(due); await f.timers[0](); await f.timers[0]();
  assert.equal(f.launches.length, 1); assert.equal(f.launches[0].credentialId, 'c');
  assert.equal(f.launches[0].runStartedAt, due);
  assert.equal(f.notices[0].state, 'starting'); assert.equal(f.notices[1].state, 'finished');
});
test('cancel and replacement prevent old timer launching', async () => {
  const f = fixture(); f.scheduler.arm(1, 8, options); f.scheduler.arm(1, 10, options);
  await f.timers[0](); assert.equal(f.launches.length, 0);
  f.scheduler.cancel(1); await f.timers[1](); assert.equal(f.launches.length, 0);
});
test('sleep delay over one minute expires instead of booking late', async () => {
  const f = fixture(); const { due } = f.scheduler.arm(1, 8, options);
  f.setNow(due + 60001); await f.timers[0]();
  assert.equal(f.launches.length, 0); assert.equal(f.notices[0].state, 'missed');
});
test('missing profiles cannot arm', () => {
  assert.throws(() => fixture().scheduler.arm(1, 8, { journeyId: 'j' }));
});
