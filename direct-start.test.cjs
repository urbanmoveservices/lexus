const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
test('frequent token signals cannot postpone the pending Direct start', () => {
  const source = fs.readFileSync('app/inject/direct_book_boot.js', 'utf8');
  const start = source.indexOf('  function debouncedDirectStart(reason)');
  const end = source.indexOf('\n  try {', start);
  let callback, timers = 0, starts = 0;
  const context = { window: {}, running: false, isDirectPipelineFinished: () => false,
    setTimeout: fn => { callback = fn; return ++timers; }, scheduleDirectStart: () => starts++ };
  vm.runInNewContext(source.slice(start, end) + ';this.start=debouncedDirectStart;', context);
  for (let i = 0; i < 100; i++) context.start('token');
  assert.equal(timers, 1);
  callback();
  assert.equal(starts, 1);
  assert.equal(context.window.__LEXUS_DIRECT_START_T, null);
});
