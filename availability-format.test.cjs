const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const format = require('./app/availability-format');
test('nested server errors and seat statuses become readable text', () => {
  assert.equal(format.message({ message: 'Session expired' }), 'Session expired');
  assert.equal(format.message({ error: { errorMessage: 'Invalid captcha' } }), 'Invalid captcha');
  assert.equal(format.message({ availablityStatus: 'AVAILABLE-42' }), 'AVAILABLE-42');
  assert.equal(format.message({}, 'Try again'), 'Try again');
  assert.equal(format.message('[object Object]', 'Try again'), 'Try again');
});
test('railway and ISO date formats match the same booking date', () => {
  assert.equal(format.dateKey('2026-10-12'), format.dateKey('12-10-2026'));
  assert.equal(format.dateKey('12/10/2026'), '2026-10-12');
  assert.equal(format.dateKey(null), '');
});
function renderer(data) {
  const button = { textContent:'', style:{}, children:[], appendChild(node){this.children.push(node);} };
  const context = { window: { LexusAvailabilityFormat: format, oceanTrains: { fetchAvailability: async () => data } },
    document: { addEventListener(){}, getElementById: () => button, createElement: tag => ({tag}), createTextNode: text => ({text}) }, console };
  vm.createContext(context); vm.runInContext(fs.readFileSync('app/train-results.js','utf8'),context);
  return { context, button };
}
test('object errors are rendered as text rather than object or HTML', () => {
  const {context,button} = renderer(); context.input = {message:'<b>Session expired</b>'};
  vm.runInContext('showAvailabilityOnButton(document.getElementById(), input, 0)', context);
  assert.equal(button.textContent,'<b>Session expired</b>'); assert.equal(button.children[1].text,'Rs. 0');
  assert.equal(button.innerHTML,undefined);
});
test('empty error object does not hide valid availability on a railway-format date', async () => {
  const {context,button} = renderer({ok:true,data:{errorMessage:{},avlDayList:[{availablityDate:'12-10-2026',availablityStatus:{message:'AVAILABLE-42'}}]}});
  await vm.runInContext("fetchSeatAvailability('13037','SL','DDU','BSB','2026-10-12','GN','EXP')",context);
  assert.equal(button.textContent,'AVAILABLE-42');
});
