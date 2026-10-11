/**
 * Ocean-style Brave host engine.
 * One host CDP → many slot profiles (ocean_p1 / ocean_p2 / …) for multi-pair.
 * Chrome runner unchanged for system-chrome engine.
 */
const chromeRunner = require('./chrome-runner');
const braveHost = require('./brave-host');
const { findBravePath, detectBraveVersion, candidates } = require('./brave-finder');

async function launchSystemBraveRun(opts = {}) {
  return chromeRunner.launchSystemChromeRun({
    ...opts,
    browserKind: 'brave',
  });
}

module.exports = {
  findBravePath,
  detectBraveVersion,
  candidates,
  launchSystemBraveRun,
  closeBraveHandle: chromeRunner.closeChromeHandle,
  cdpClickSelector: chromeRunner.cdpClickSelector,
  cdpTypeSelector: chromeRunner.cdpTypeSelector,
  cdpKey: chromeRunner.cdpKey,
  injectAutomationOnPage: chromeRunner.injectAutomationOnPage,
  AUTOMATION_GRACE_MS: chromeRunner.AUTOMATION_GRACE_MS,
  getBraveUserDataRoot: braveHost.getBraveUserDataRoot,
  profileForPair: braveHost.profileForPair,
  ensureBraveHost: braveHost.ensureBraveHost,
  openBraveSlot: braveHost.openBraveSlot,
  shutdownOceanHost: braveHost.shutdownOceanHost,
};
