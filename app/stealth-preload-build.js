/**
 * Writes a stealth-only preload (no Lexus globals) for session.registerPreloadScript.
 * Called once at app ready — must exist before any IRCTC window opens.
 */
const fs = require('fs');
const path = require('path');
const { getStealthInjectSource } = require('./stealth');

const OUT = path.join(__dirname, 'preload-stealth.generated.js');

function writeStealthPreload() {
  const source = getStealthInjectSource();
  const code = `/**
 * AUTO-GENERATED — stealth only. Do not edit.
 * Runs in every frame of the IRCTC partition before page scripts.
 */
(function () {
  const SOURCE = ${JSON.stringify(source)};
  function inject() {
    try {
      if (!document.documentElement) return false;
      const s = document.createElement('script');
      s.textContent = SOURCE;
      document.documentElement.appendChild(s);
      s.remove();
      return true;
    } catch (e) {
      return false;
    }
  }
  if (inject()) return;
  var n = 0;
  var id = setInterval(function () {
    n += 1;
    if (inject() || n > 500) clearInterval(id);
  }, 0);
})();
`;
  fs.writeFileSync(OUT, code, 'utf8');
  return OUT;
}

function getStealthPreloadPath() {
  if (!fs.existsSync(OUT)) writeStealthPreload();
  return OUT;
}

module.exports = {
  writeStealthPreload,
  getStealthPreloadPath,
  OUT,
};
