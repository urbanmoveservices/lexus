/**
 * Mock Android APP device fields for IRCTC mapps1 / webmtoken.
 * - mup: build fingerprint header (HAR: TKQ1.221013.002)
 * - uid: device id in webmtoken body (HAR: af000000001-…)
 * Per pair: random once, locked for whole session.
 */
const crypto = require('crypto');

const MUP_PREFIXES = ['TKQ1', 'TP1A', 'SP1A', 'RP1A', 'SQ3A', 'TQ3A'];

function hex(n) {
  return crypto.randomBytes(Math.ceil(n / 2))
    .toString('hex')
    .slice(0, n)
    .toLowerCase();
}

/** Random mup like TKQ1.221013.002 */
function generateMockMup() {
  const prefix = MUP_PREFIXES[crypto.randomBytes(1)[0] % MUP_PREFIXES.length];
  const y = String(20 + (crypto.randomBytes(1)[0] % 6)).padStart(2, '0'); // 20–25
  const m = String(1 + (crypto.randomBytes(1)[0] % 12)).padStart(2, '0');
  const d = String(1 + (crypto.randomBytes(1)[0] % 28)).padStart(2, '0');
  const build = String(crypto.randomBytes(1)[0] % 1000).padStart(3, '0');
  return `${prefix}.${y}${m}${d}.${build}`;
}

/**
 * Random uid like HAR: af000000001-06c02-95ab0-00003-0000000000014
 * af + 9 digits-ish + 4 dashed hex groups
 */
function generateMockUid() {
  const head = `af${hex(9)}`;
  return `${head}-${hex(5)}-${hex(5)}-${hex(5)}-${hex(13)}`;
}

function createMockAppDevice() {
  return {
    mup: generateMockMup(),
    uid: generateMockUid(),
    createdAt: Date.now(),
  };
}

module.exports = {
  generateMockMup,
  generateMockUid,
  createMockAppDevice,
};
