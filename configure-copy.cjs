// Mechanical copy configuration; no function analysis or deobfuscation.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const appRoot = path.join(__dirname, 'app');
const modifications = [];
function transform(file, replacements) {
  const before = fs.readFileSync(file, 'utf8');
  let after = before;
  for (const [from, to] of replacements) after = after.split(from).join(to);
  if (after !== before) { fs.writeFileSync(file, after); modifications.push(path.relative(__dirname, file)); }
}
for (const entry of fs.readdirSync(appRoot, { withFileTypes: true })) {
  if (entry.isFile() && path.extname(entry.name) === '.html') transform(path.join(appRoot, entry.name), [
    ['>OCEAN<', '>LEXUS<'], ['About OCEAN', 'About LEXUS'], ['Ocean toolbar', 'LEXUS toolbar'], ['Brave (Ocean host)', 'Brave (LEXUS host)'], ['<title>OCEAN ', '<title>LEXUS ']
  ]);
}
transform(path.join(appRoot, 'main.js'), [["app.setName('OCEAN')", "app.setName('LEXUS')"], ["title: 'OCEAN'", "title: 'LEXUS'"], ["title: 'OCEAN —", "title: 'LEXUS —"]]);
transform(path.join(__dirname, 'server.cjs'), [
  ["path.resolve(__dirname, '../recovered-source-1791613372701')", "path.resolve(__dirname, 'app')"],
  ['OCEAN_WEB_PORT', 'LEXUS_WEB_PORT'], ['OCEAN_WEB_DATA', 'LEXUS_WEB_DATA'],
  ['|| 8080', '|| 8081'], ["path.join(__dirname, 'data')", "path.join(__dirname, 'web-data')"],
  ["name:'OCEAN Local'", "name:'LEXUS'"], ['OCEAN web ready', 'LEXUS web ready'], ['Invalid OCEAN backup', 'Invalid LEXUS backup']
]);
transform(path.join(__dirname, 'bridge.js'), [['ocean-profiles.json', 'lexus-profiles.json']]);
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
let count = 0, identical = 0, differences = [];
function verify(folder, relative = '') {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const rel = path.join(relative, entry.name), copied = path.join(appRoot, rel);
    if (entry.isDirectory()) verify(path.join(folder, entry.name), rel);
    else {
      count++;
      if (hash(path.join(folder, entry.name)) === hash(copied)) identical++;
      else differences.push(rel);
    }
  }
}
verify(path.resolve(__dirname, '../recovered-source-1791613372701'));
const report = { files: count, byteIdentical: identical, modifiedForBranding: differences, adapterChanges: modifications.filter(p => !p.startsWith('app' + path.sep)), sourceLogicInspected: false, note: 'Copied source and dependencies. Mechanical visible branding and adapter-path changes only. Existing IPC namespaces and external services preserved for compatibility. Web workspace and desktop use separate new data directories.' };
fs.writeFileSync(path.join(__dirname, 'COPY-REPORT.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({files:count,byteIdentical:identical,brandingChanges:differences.length,sourceLogicInspected:false}, null, 2));
