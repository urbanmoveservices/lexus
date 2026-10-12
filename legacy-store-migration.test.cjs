const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), Module = require('node:module');

function load(root, transform = (s) => s) {
  const filename = path.join(__dirname, 'app/profile-store.js');
  const m = new Module(filename, module);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  const real = m.require.bind(m);
  m.require = (name) => (name === 'electron' ? { app: { isPackaged: false, getPath: () => root } } : real(name));
  m._compile(transform(fs.readFileSync(filename, 'utf8')), filename);
  return m.exports;
}

test('pre-rename ocean-data store is copied to lexus-data with its key; credentials still decrypt', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lexus-legacy-migration-'));
  // Old build: same code but with the legacy file names.
  const legacy = load(root, (s) => s.replace(/lexus-data/g, 'ocean-data').replace(/lexus\.sqlite/g, 'ocean.sqlite').replace(/\.lexus-key/g, '.ocean-key'));
  await legacy.init();
  legacy.saveJourney({ name: 'Old journey', from: 'BSB', to: 'PRYJ' });
  const cred = legacy.saveCredential({ name: 'Old account', username: 'old-user', password: 'legacy-secret-123' });
  assert(fs.existsSync(path.join(root, 'ocean-data', 'ocean.sqlite')));
  assert(fs.existsSync(path.join(root, 'ocean-data', '.ocean-key')));
  assert(!fs.existsSync(path.join(root, 'lexus-data')));

  const current = load(root);
  await current.init();
  assert(fs.existsSync(path.join(root, 'lexus-data', 'lexus.sqlite')));
  assert(fs.existsSync(path.join(root, 'lexus-data', '.lexus-key')));
  assert.equal(current.listSummaries('journeys').length, 1);
  assert.equal(current.getCredential(cred.id, { includeSecrets: true }).password, 'legacy-secret-123');
  // Legacy files are left untouched as a backup.
  assert(fs.existsSync(path.join(root, 'ocean-data', 'ocean.sqlite')));
});

test('fresh install creates only lexus-data and never touches a legacy folder', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lexus-fresh-'));
  const store = load(root);
  await store.init();
  store.saveJourney({ name: 'New', from: 'BSB', to: 'PRYJ' });
  assert(fs.existsSync(path.join(root, 'lexus-data', 'lexus.sqlite')));
  assert(!fs.existsSync(path.join(root, 'ocean-data')));
});
