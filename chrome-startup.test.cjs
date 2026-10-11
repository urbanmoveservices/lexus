const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync('app/chrome-runner.js', 'utf8');
const policy = source.slice(source.indexOf('const configuredChromeGrace'), source.indexOf('/** Blank page settle'));
function delays(env = {}) {
  return vm.runInNewContext(policy + ';({chrome:AUTOMATION_GRACE_MS,brave:AUTOMATION_GRACE_BRAVE_MS})', {process:{env},Number,Math});
}
test('Chrome default settle is one second; Brave remains twelve seconds', () => {
  const result = delays(); assert.equal(result.chrome,1000); assert.equal(result.brave,12000);
});
test('valid explicit Chrome delay including zero is honored', () => {
  assert.equal(delays({OCEAN_AUTOMATION_GRACE_MS:'0'}).chrome,0);
  assert.equal(delays({OCEAN_AUTOMATION_GRACE_MS:'8000'}).chrome,8000);
});
test('invalid and out-of-range values use the bounded default', () => {
  for (const value of ['invalid','-1','60001','Infinity']) assert.equal(delays({OCEAN_AUTOMATION_GRACE_MS:value}).chrome,1000);
});
