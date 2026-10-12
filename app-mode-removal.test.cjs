const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { createScheduler } = require('./app/booking-scheduler.cjs');

test('removed APP engine cannot launch or arm a scheduled booking', async () => {
  const file = path.join(__dirname, 'app/session-manager.js');
  const fixture = new Module(file, module);
  fixture.filename = file;
  fixture.require = name => name.startsWith('.') || name === 'electron' ? {} : require(name);
  fixture._compile(fs.readFileSync(file, 'utf8'), file);
  const result = await fixture.exports.createRun({ uiEngine: 'app' });
  assert.equal(result.ok, false);
  assert.match(result.error, /APP mode has been removed/);
  assert.deepEqual(fixture.exports.listRuns(), []);
  const scheduler = createScheduler({ launch: () => assert.fail('must not launch'), notify() {} });
  assert.throws(() => scheduler.arm('panel', 8, { uiEngine: 'app' }), /APP mode has been removed/);
  assert.equal(scheduler.pendingCount(), 0);
});
