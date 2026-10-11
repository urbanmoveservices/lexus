/**
 * Clean System Chrome launch — look like a normal user Chrome.
 *
 * NEVER use --disable-blink-features=AutomationControlled:
 * modern Chrome shows a yellow unsupported-flag bar that Akamai / IRCTC
 * sensors treat as a hard automation tell (login may pass; psgninput fails).
 *
 * webdriver is patched via consistency stealth (JS), not via blink flags.
 */

function getStealthChromeArgs({
  userDataDir,
  profileDirectory,
  remoteDebuggingPort,
  browserKind,
  windowSize,
  windowPosition,
  newWindow,
} = {}) {
  // Minimal args only — puppeteer's default bag is stripped via ignoreDefaultArgs:true
  // Do NOT force --lang: Windows display language (en-GB etc.) must stay native
  // or language vs Accept-Language mismatch tanks fingerprint authenticity.
  const args = [
    '--no-first-run',
    '--no-default-browser-check',
    // Background window pe timers / API waits throttle na hon (Passenger Submit, Direct Host)
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    // Stop WebRTC from leaking real/LAN IP past HTTP(S)/SOCKS proxy (Akamai client-IP tell)
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--enforce-webrtc-ip-permission-check',
  ];

  if (windowSize && windowSize.width && windowSize.height) {
    args.push(`--window-size=${windowSize.width},${windowSize.height}`);
  } else if (browserKind !== 'brave') {
    // Fixed compact window only for isolated Chrome slots
    args.push('--window-size=580,720');
  }

  if (windowPosition && Number.isFinite(windowPosition.x) && Number.isFinite(windowPosition.y)) {
    args.push(`--window-position=${windowPosition.x},${windowPosition.y}`);
  }

  if (newWindow) args.push('--new-window');

  if (userDataDir) args.push(`--user-data-dir=${userDataDir}`);
  if (profileDirectory) args.push(`--profile-directory=${profileDirectory}`);
  if (remoteDebuggingPort) args.push(`--remote-debugging-port=${remoteDebuggingPort}`);
  return args;
}

/**
 * Ignore ALL puppeteer default args (enable-automation, disable-infobars,
 * metrics-recording-only, password-store=basic, etc.) — those fingerprint automation.
 * @returns {true}
 */
function getIgnoredDefaultArgs() {
  return true;
}

module.exports = {
  getStealthChromeArgs,
  getIgnoredDefaultArgs,
};
