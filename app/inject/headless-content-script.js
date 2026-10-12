// LEXUS_FAST_FILL_BEGIN
async function lexusDirectFill(selector, value) {
    const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!el || el.disabled || el.readOnly) return false;
    const expected = String(value ?? '');
    try {
        el.focus();
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (!setter) return false;
        setter.call(el, expected);
        el.dispatchEvent(new Event('input', {bubbles:true}));
        el.dispatchEvent(new Event('change', {bubbles:true}));
        el.blur();
        await new Promise(resolve => setTimeout(resolve, 0));
        return el.value === expected && el.validity?.valid !== false;
    } catch (_) { return false; }
}
async function lexusSelectGender(el, value) {
    if (!el || el.disabled) return false;
    const normalize = v => String(v ?? '').toLowerCase().replace(/[^a-z]/g, '');
    const aliases = {m:'male',male:'male',f:'female',female:'female',t:'transgender',transgender:'transgender',trans:'transgender'};
    const wanted = aliases[normalize(value)];
    if (!wanted) return false;
    const option = Array.from(el.options).find(o => !o.disabled && o.value && (aliases[normalize(o.value)] === wanted || aliases[normalize(o.textContent)] === wanted));
    if (!option) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    if (!setter) return false;
    el.focus(); setter.call(el, option.value);
    el.dispatchEvent(new Event('input', {bubbles:true}));
    el.dispatchEvent(new Event('change', {bubbles:true}));
    el.blur();
    await new Promise(resolve => setTimeout(resolve, 0));
    return el.value === option.value;
}
// LEXUS_FAST_FILL_END

/**
 * IRCTC Classic (/nget) autofill  -  Electron inject of extension content_script.js
 */
if (!location.href.includes("/nget")) {
  console.log("[LEXUS nget] skip  -  not classic site");
} else {

// à¤‡à¤¨ à¤µà¥‡à¤°à¤¿à¤à¤¬à¤²à¥à¤¸ à¤•à¥‹ à¤¸à¥à¤•à¥à¤°à¤¿à¤ªà¥à¤Ÿ à¤®à¥‡à¤‚ à¤¸à¤¬à¤¸à¥‡ à¤Šà¤ªà¤° à¤°à¤–à¥‡à¤‚
try {
  // Electron: no chrome.runtime.getURL / injector.js  -  skip token injector
  if (typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.getURL === "function") {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('injector.js');
    script.onload = function() { this.remove(); };
    (document.head || document.documentElement).appendChild(script);
  }
} catch (e) {
  /* ignore */
}

// 2. Create a message bridge to listen for tokens from the page
// and forward them to the background script.
window.addEventListener("message", (event) => {
  // We only accept messages from the page itself, not from other extensions or iframes
  if (event.source !== window) {
    return;
  }

  // Check if the message is the one we are looking for from injector.js
  if (event.data && event.data.type === "FROM_IRCTC_PAGE" && event.data.tokenPart) {
    
    console.log('LEXUS Content Script: Received tokens from page ->', event.data.tokenPart);
    
    // Forward the captured token data to the background script
    chrome.runtime.sendMessage(event.data, (response) => {
      if (chrome.runtime.lastError) {
        // This error can happen if the popup is not open, which is normal.
        // console.error('LEXUS Content Script: Error sending message to background.', chrome.runtime.lastError.message);
      } else {
        // console.log('LEXUS Content Script: Message sent to background successfully.');
      }
    });
  }
});











// =======================================================================
// === START: TOKEN CAPTURE LOGIC (ADD THIS TO THE TOP) ===
// =======================================================================

// 1. Inject the injector.js script into the main page
// This gives the injector script access to the page's `window` object and network requests.
// Electron: skip second injector.js inject (no getURL)

// 2. Create a message bridge to listen for tokens from the page
// and forward them to the background script.
window.addEventListener("message", (event) => {
  // We only accept messages from the page itself, not from other extensions or iframes
  if (event.source !== window) {
    return;
  }

  // Check if the message is the one we are looking for from injector.js
  if (event.data && event.data.type === "FROM_IRCTC_PAGE" && event.data.tokenPart) {
    
    console.log('LEXUS Content Script: Received tokens from page ->', event.data.tokenPart);
    
    // Forward the captured token data to the background script
    chrome.runtime.sendMessage(event.data, (response) => {
      if (chrome.runtime.lastError) {
        // This error can happen if the popup is not open, which is normal.
        // console.error('LEXUS Content Script: Error sending message to background.', chrome.runtime.lastError.message);
      } else {
        // console.log('LEXUS Content Script: Message sent to background successfully.');
      }
    });
  }
});







// === LOGIC TO HANDLE LANGUAGE PREFERENCE POP-UP ===
function lexusLangBtnText(el) {
    return ((el && (el.innerText || el.textContent)) || '').replace(/\s+/g, ' ').trim();
}

function findLanguagePreferenceEnglishBtn() {
    // Match Welcome / preferred-language alert (IRCTC DOM changes often)
    const dialogs = [
        ...document.querySelectorAll(
            'div.ui-dialog[role="dialog"], div[role="dialog"], .ui-dialog, p-dialog, .p-dialog, .modal, .ui-confirmdialog'
        ),
    ];

    const looksLikeLangDialog = (root) => {
        const t = lexusLangBtnText(root).toLowerCase();
        return (
            t.includes('preferred language') ||
            t.includes('welcome to irctc') ||
            (t.includes('english') && (t.includes('à¤¹à¤¿à¤‚à¤¦à¥€') || t.includes('hindi')))
        );
    };

    const pickEnglish = (root) => {
        const nodes = [...root.querySelectorAll('button, a, span.ui-button-text, .ui-button, input[type="submit"]')];
        for (const btn of nodes) {
            const label = lexusLangBtnText(btn);
            if (/^english$/i.test(label)) return btn.closest('button, a, .ui-button') || btn;
        }
        for (const btn of nodes) {
            const label = lexusLangBtnText(btn);
            if (/english/i.test(label) && !/hindi|à¤¹à¤¿à¤‚à¤¦à¥€/i.test(label)) {
                return btn.closest('button, a, .ui-button') || btn;
            }
        }
        return null;
    };

    for (const dialog of dialogs) {
        if (!looksLikeLangDialog(dialog)) continue;
        const eng = pickEnglish(dialog);
        if (eng) return eng;
    }

    // Fallback: page-level English button next to Hindi (no dialog match)
    const allBtns = [...document.querySelectorAll('button, a.btn, .ui-button')];
    for (const btn of allBtns) {
        if (!/^english$/i.test(lexusLangBtnText(btn))) continue;
        const parent = btn.closest('div, section, form, [role="dialog"]') || btn.parentElement;
        if (!parent) continue;
        const pt = lexusLangBtnText(parent).toLowerCase();
        if (
            pt.includes('preferred language') ||
            pt.includes('welcome to irctc') ||
            /à¤¹à¤¿à¤‚à¤¦à¥€|hindi/i.test(pt)
        ) {
            return btn;
        }
    }
    return null;
}

async function clickLanguagePreferencePopup() {
    const btn = findLanguagePreferenceEnglishBtn();
    if (!btn) return false;

    console.log('[LEXUS nget] Language popup  -  clicking English...');
    try {
        const sel = typeof markTempId === 'function' ? markTempId(btn, 'lexus-lang-en') : null;
        if (sel && typeof debuggerClick === 'function') {
            await debuggerClick(sel);
        } else {
            btn.click();
        }
        return true;
    } catch (e) {
        console.warn('[LEXUS nget] Language click failed:', e && e.message ? e.message : e);
        try {
            btn.click();
            return true;
        } catch (_) {
            return false;
        }
    }
}

/** Keep dismissing language alert whenever IRCTC shows it (classic + direct). */
function startLanguagePreferenceWatcher() {
    if (window.__LEXUS_LANG_WATCH__) return;
    window.__LEXUS_LANG_WATCH__ = true;

    let clicking = false;
    const tryClick = async (reason) => {
        if (clicking) return;
        // Login form / fill ke dauran kuch mat chhedo
        if (typeof lexusLoginUiBusy === 'function' && lexusLoginUiBusy()) return;
        if (!findLanguagePreferenceEnglishBtn()) return;
        clicking = true;
        try {
            lexusLog('lang watcher: ' + reason);
            await clickLanguagePreferencePopup();
            await new Promise((r) => setTimeout(r, 300));
        } catch (_) {
        } finally {
            clicking = false;
        }
    };

    tryClick('boot');
    const iv = setInterval(() => tryClick('poll'), 800);
    setTimeout(() => clearInterval(iv), 120000);

    try {
        const obs = new MutationObserver(() => tryClick('dom'));
        obs.observe(document.documentElement, { childList: true, subtree: true });
        setTimeout(() => obs.disconnect(), 120000);
    } catch (_) {}
}







// à¤¯à¤¹ à¤...à¤ªà¤¡à¥‡à¤Ÿ à¤•à¤¿à¤¯à¤¾ à¤¹à¥à¤† à¤«à¤‚à¤•à¥à¤¶à¤¨ à¤¹à¥ˆ
// à¤¯à¤¹ à¤...à¤‚à¤¤à¤¿à¤® à¤”à¤° à¤¸à¤¬à¤¸à¥‡ à¤¬à¥‡à¤¹à¤¤à¤° à¤«à¤‚à¤•à¥à¤¶à¤¨ à¤¹à¥ˆà¥¤ à¤‡à¤¸à¥‡ content_script.js à¤®à¥‡à¤‚ à¤¡à¤¾à¤²à¥‡à¤‚à¥¤

// ==================================================================
// --- à¤¸à¤¿à¤¸à¥à¤Ÿà¤® à¤Ÿà¤¾à¤‡à¤® à¤ªà¥à¤°à¥‹à¤µà¤¾à¤‡à¤¡à¤° (à¤¨à¤¯à¤¾ à¤”à¤° à¤µà¤¿à¤¶à¥à¤µà¤¸à¤¨à¥€à¤¯) ---
// ==================================================================
/**
 * à¤¯à¤¹ à¤«à¤‚à¤•à¥à¤¶à¤¨ IRCTC à¤µà¥‡à¤¬à¤¸à¤¾à¤‡à¤Ÿ à¤•à¥‡ à¤¬à¤œà¤¾à¤¯ à¤¸à¥€à¤§à¥‡ à¤¸à¤¿à¤¸à¥à¤Ÿà¤® à¤•à¤¾ à¤¸à¤®à¤¯ à¤²à¥‡à¤¤à¤¾ à¤¹à¥ˆ à¤”à¤° à¤¹à¤° à¤¸à¥‡à¤•à¤‚à¤¡ à¤­à¥‡à¤œà¤¤à¤¾ à¤¹à¥ˆà¥¤
 * à¤¯à¤¹ à¤œà¥à¤¯à¤¾à¤¦à¤¾ à¤µà¤¿à¤¶à¥à¤µà¤¸à¤¨à¥€à¤¯ à¤¹à¥ˆ à¤•à¥à¤¯à¥‹à¤‚à¤•à¤¿ à¤¯à¤¹ à¤µà¥‡à¤¬à¤¸à¤¾à¤‡à¤Ÿ à¤•à¥‡ à¤¬à¤¦à¤²à¤¾à¤µà¥‹à¤‚ à¤ªà¤° à¤¨à¤¿à¤°à¥à¤­à¤° à¤¨à¤¹à¥€à¤‚ à¤•à¤°à¤¤à¤¾à¥¤
 */
// ==================================================================
// --- à¤¸à¤¿à¤¸à¥à¤Ÿà¤® à¤Ÿà¤¾à¤‡à¤® à¤ªà¥à¤°à¥‹à¤µà¤¾à¤‡à¤¡à¤° (à¤®à¤¿à¤²à¥€à¤¸à¥‡à¤•à¤‚à¤¡ à¤•à¥‡ à¤¸à¤¾à¤¥) ---
// ==================================================================
/**
 * à¤¯à¤¹ à¤«à¤‚à¤•à¥à¤¶à¤¨ à¤¸à¤¿à¤¸à¥à¤Ÿà¤® à¤•à¤¾ à¤¸à¤®à¤¯ à¤®à¤¿à¤²à¥€à¤¸à¥‡à¤•à¤‚à¤¡ à¤•à¥‡ à¤¸à¤¾à¤¥ à¤²à¥‡à¤¤à¤¾ à¤¹à¥ˆ à¤”à¤° à¤¤à¥‡à¤œà¥€ à¤¸à¥‡ à¤...à¤ªà¤¡à¥‡à¤Ÿ à¤•à¤°à¤¤à¤¾ à¤¹à¥ˆà¥¤
 */
function startSystemTimeEmitter() {
    setInterval(() => {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
        const timeString = `${hours}:${minutes}:${seconds}:${milliseconds}`;
        document.dispatchEvent(new CustomEvent('lexus-time-update', {
            detail: { timeString: timeString }
        }));
    }, 100);
    console.log("LEXUS: system time emitter started (100ms)");
}

function showOnScreenNotification(message, duration = 4000) {
    const oldNotification = document.getElementById('lexus-fallback-notification');
    if (oldNotification) {
        oldNotification.remove();
    }
    const notificationDiv = document.createElement('div');
    notificationDiv.id = 'lexus-fallback-notification';
    notificationDiv.textContent = `[LEXUS]: ${message}`;
    Object.assign(notificationDiv.style, {
        position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
        backgroundColor: 'rgba(217, 30, 24, 0.9)', color: 'white', padding: '12px 25px',
        borderRadius: '8px', zIndex: '99999', fontSize: '16px', fontWeight: 'bold',
        boxShadow: '0 4px 15px rgba(0,0,0,0.3)'
    });
    document.body.appendChild(notificationDiv);
    setTimeout(() => {
        const currentNotification = document.getElementById('lexus-fallback-notification');
        if (currentNotification) {
            currentNotification.remove();
        }
    }, duration);
}














/**
 * Injects the animation CSS and JS files into the host page.
 * The files must be declared in manifest.json's "web_accessible_resources".
 */
function injectAnimationAssets() {
    return;
}

/**
 * Dispatches the initial data to the injected animation script.
 * This creates the UI for the first time.
 * @param {object} userData - The complete user data from storage.
 */
function dispatchInitialData(userData) {
    const url = window.location.href;
    let initialStatusKey = 'loadLoginDetails'; // Default status
    if (url.includes('booking/psgninput')) {
        initialStatusKey = 'fillPassengerDetails';
    } else if (url.includes('booking/reviewBooking')) {
        initialStatusKey = 'reviewBooking';
    } else if (url.includes('payment/bkgPaymentOptions')) {
        initialStatusKey = 'bkgPaymentOptions';
    } else if (url.includes('booking/train-list')) {
        initialStatusKey = 'selectJourney';
    } else if (url.includes('nget/train-search')) {
        const loginLogoutLink = document.querySelector("a.loginText.ng-star-inserted");
        if (loginLogoutLink && loginLogoutLink.innerText.trim().toUpperCase() === 'LOGOUT') {
            initialStatusKey = 'loadJourneyDetails';
        }
    }

    // --- à¤¬à¤¦à¤²à¤¾ à¤¹à¥à¤† à¤²à¥‰à¤œà¤¿à¤• ---
    // 1. journey_details à¤‘à¤¬à¥à¤œà¥‡à¤•à¥à¤Ÿ à¤•à¥‹ à¤¨à¤¿à¤•à¤¾à¤²à¥‡à¤‚
    const journeyDetails = userData.journey_details || {};

    // 2. irctc_credentials à¤¸à¥‡ à¤¯à¥‚à¤œà¤°à¤¨à¥‡à¤® à¤¨à¤¿à¤•à¤¾à¤² à¤•à¤° journey_details à¤®à¥‡à¤‚ à¤œà¥‹à¤¡à¤¼à¥‡à¤‚
    if (userData.irctc_credentials && userData.irctc_credentials.user_name) {
        journeyDetails.username = userData.irctc_credentials.user_name;
    }
    // ----------------------

    const initPayload = {
        journeyDetails: journeyDetails, // à¤¯à¤¹à¤¾à¤ à¤...à¤ªà¤¡à¥‡à¤Ÿà¥‡à¤¡ journeyDetails à¤•à¥‹ à¤­à¥‡à¤œà¤¾ à¤ - à¤¯à¤¾ à¤¹à¥ˆ
        initialStatus: initialStatusKey
    };

    console.log("LEXUS: Dispatching 'lexus-init-data' with payload:", initPayload);
    setTimeout(() => {
        document.dispatchEvent(new CustomEvent('lexus-init-data', { detail: initPayload }));
    }, 500);
}

/**
 * Sends status updates to the background script and the in-page animation script.
 /**
 * à¤¯à¤¹ à¤«à¤‚à¤•à¥à¤¶à¤¨ à¤¬à¥ˆà¤•à¤ - à¥à¤°à¤¾à¤‰à¤‚à¤¡ à¤¸à¥à¤•à¥à¤°à¤¿à¤ªà¥à¤Ÿ à¤”à¤° à¤‡à¤¨-à¤ªà¥‡à¤œ à¤à¤¨à¥€à¤®à¥‡à¤¶à¤¨ à¤¦à¥‹à¤¨à¥‹à¤‚ à¤•à¥‹ à¤¸à¥à¤Ÿà¥‡à¤Ÿà¤¸ à¤...à¤ªà¤¡à¥‡à¤Ÿ à¤­à¥‡à¤œà¤¤à¤¾ à¤¹à¥ˆà¥¤
 * @param {string} statusKey - à¤¬à¥à¤•à¤¿à¤‚à¤ -  à¤•à¥‡ à¤µà¤°à¥à¤¤à¤®à¤¾à¤¨ à¤¸à¥à¤Ÿà¥‡à¤ª à¤•à¥‹ à¤¦à¤°à¥à¤¶à¤¾à¤¨à¥‡ à¤µà¤¾à¤²à¥€ à¤à¤• à¤•à¥€ (key)à¥¤
 */
function statusUpdate(statusKey) {
    // =================================================================
    // STEP 1: FIX - à¤¬à¥ˆà¤•à¤ - à¥à¤°à¤¾à¤‰à¤‚à¤¡ à¤¸à¥à¤•à¥à¤°à¤¿à¤ªà¥à¤Ÿ à¤•à¥‹ à¤®à¥ˆà¤¸à¥‡à¤œ à¤­à¥‡à¤œà¥‡à¤‚ (à¤¯à¤¹ à¤¸à¤¬à¤¸à¥‡ à¤œà¤¼à¤°à¥‚à¤°à¥€ à¤¹à¥ˆ)
    // =================================================================
    // à¤‡à¤¸ à¤²à¤¾à¤‡à¤¨ à¤•à¥‹ à¤à¤•à¥à¤Ÿà¤¿à¤µà¥‡à¤Ÿ à¤•à¤° à¤¦à¤¿à¤¯à¤¾ à¤ - à¤¯à¤¾ à¤¹à¥ˆ à¤¤à¤¾à¤•à¤¿ à¤¬à¥ˆà¤•à¤ - à¥à¤°à¤¾à¤‰à¤‚à¤¡ à¤¸à¥à¤•à¥à¤°à¤¿à¤ªà¥à¤Ÿ à¤•à¥‹ à¤ªà¤¤à¤¾ à¤šà¤²à¥‡ à¤•à¤¿ à¤¸à¥à¤•à¥à¤°à¤¿à¤ªà¥à¤Ÿ à¤•à¤¿à¤¸ à¤¸à¥à¤Ÿà¥‡à¤œ à¤ªà¤° à¤¹à¥ˆà¥¤
    // à¤†à¤ªà¤•à¥‡ getMsg à¤«à¤‚à¤•à¥à¤¶à¤¨ à¤•à¥‡ à¤...à¤¨à¥à¤¸à¤¾à¤°, à¤ªà¤¹à¤²à¤¾ à¤ªà¥ˆà¤°à¤¾à¤®à¥€à¤Ÿà¤° à¤¡à¥‡à¤Ÿà¤¾ à¤¹à¥‹à¤¤à¤¾ à¤¹à¥ˆ à¤”à¤° à¤¦à¥‚à¤¸à¤°à¤¾ à¤Ÿà¤¾à¤‡à¤ªà¥¤
    const dataForBackground = { 
        status: statusKey, 
        time: new Date().toString().split(" ")[4] 
    };
    chrome.runtime.sendMessage(getMsg(dataForBackground, "status_update"));

    
    // =================================================================
    // STEP 2: KEEP - à¤†à¤ªà¤•à¥‡ à¤¨à¤ à¤à¤¨à¥€à¤®à¥‡à¤¶à¤¨ à¤²à¥‰à¤œà¤¿à¤• à¤•à¥‡ à¤²à¤¿à¤ à¤¡à¥‡à¤Ÿà¤¾ à¤¤à¥ˆà¤¯à¤¾à¤° à¤•à¤°à¥‡à¤‚
    // =================================================================
    console.log(`LEXUS: Dispatching 'lexus-status-update' for [${statusKey}]`);

    // à¤¯à¤¹ user_data à¤ - à¥à¤²à¥‹à¤¬à¤² à¤µà¥ˆà¤°à¤¿à¤à¤¬à¤² à¤¸à¥‡ journey_details à¤‘à¤¬à¥à¤œà¥‡à¤•à¥à¤Ÿ à¤•à¥‹ à¤¨à¤¿à¤•à¤¾à¤²à¤¤à¤¾ à¤¹à¥ˆ
    const journeyDetailsForAnimation = user_data.journey_details || {};

    // irctc_credentials à¤¸à¥‡ à¤¯à¥‚à¤œà¤°à¤¨à¥‡à¤® à¤¨à¤¿à¤•à¤¾à¤²à¤•à¤° journey_details à¤®à¥‡à¤‚ à¤œà¥‹à¤¡à¤¼à¤¤à¤¾ à¤¹à¥ˆ
    if (user_data.irctc_credentials && user_data.irctc_credentials.user_name) {
        journeyDetailsForAnimation.username = user_data.irctc_credentials.user_name;
    }
    
    // à¤à¤¨à¥€à¤®à¥‡à¤¶à¤¨ à¤•à¥‡ à¤²à¤¿à¤ à¤ªà¥‡à¤²à¥‹à¤¡ à¤¤à¥ˆà¤¯à¤¾à¤° à¤•à¤°à¤¤à¤¾ à¤¹à¥ˆ
    const updatePayloadForAnimation = {
        statusKey: statusKey,
        journeyDetails: journeyDetailsForAnimation // à¤¯à¤¹à¤¾à¤ à¤...à¤ªà¤¡à¥‡à¤Ÿà¥‡à¤¡ journeyDetails à¤•à¥‹ à¤­à¥‡à¤œà¤¾ à¤ - à¤¯à¤¾ à¤¹à¥ˆ
    };

    // =================================================================
    // STEP 3: KEEP - à¤‡à¤¨-à¤ªà¥‡à¤œ à¤à¤¨à¥€à¤®à¥‡à¤¶à¤¨ à¤¸à¥à¤•à¥à¤°à¤¿à¤ªà¥à¤Ÿ à¤•à¥‹ à¤‡à¤µà¥‡à¤‚à¤Ÿ à¤­à¥‡à¤œà¥‡à¤‚
    // =================================================================
    document.dispatchEvent(new CustomEvent('lexus-status-update', { detail: updatePayloadForAnimation }));
}
// ==============================================================================
// === CORE HELPER FUNCTIONS (Optimized for Speed) ===
// ==============================================================================


// content.js à¤®à¥‡à¤‚

// à¤•à¥à¤²à¤¿à¤• à¤•à¤°à¤¨à¥‡ à¤•à¥‡ à¤²à¤¿à¤ à¤¹à¥‡à¤²à¥à¤ªà¤°

// --- HELPER FUNCTIONS (Debugger API Bridge) ---

function debuggerClick(selector, offsetXPercent = 50, offsetYPercent = 50) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
            id: "irctc",           // âœ... Obfuscated script à¤•à¥‹ à¤¶à¤¾à¤‚à¤¤ à¤°à¤–à¤¨à¥‡ à¤•à¥‡ à¤²à¤¿à¤
            msg: { type: "IGNORE" }, // âœ... Crash à¤¸à¥‡ à¤¬à¤šà¤¾à¤¨à¥‡ à¤•à¥‡ à¤²à¤¿à¤
            type: "DEBUGGER_CLICK", // âœ... à¤¹à¤®à¤¾à¤°à¤¾ à¤...à¤¸à¤²à¥€ à¤Ÿà¤¾à¤‡à¤ª
            selector: selector,
            offsetXPercent: offsetXPercent,
            offsetYPercent: offsetYPercent
        }, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            if (response && response.success) resolve(response);
            else reject(new Error(response?.error || "DEBUGGER_CLICK failed"));
        });
    });
}

/** Passenger Continue: random horizontal offset (25/30/45/70/80%) */
var PASSENGER_CONTINUE_OFFSETS = [25, 30, 45, 70, 80];

function randomPassengerContinueOffset() {
    const ox = PASSENGER_CONTINUE_OFFSETS[Math.floor(Math.random() * PASSENGER_CONTINUE_OFFSETS.length)];
    const oy = 40 + Math.floor(Math.random() * 21); // 40â€“60% vertical
    return { ox, oy };
}

/** Visible Continue  -  desktop (btnDefault) ya mobile (mob-bot-btn) */
function getVisiblePassengerContinueBtn() {
    const buttons = [
        ...document.querySelectorAll("app-passenger-input button.train_Search.btnDefault[type='submit']"),
        ...document.querySelectorAll("app-passenger-input button.mob-bot-btn.search_btn[type='submit']")
    ].filter((b) => (b.innerText || "").trim().toUpperCase().includes("CONTINUE"));

    for (const b of buttons) {
        const r = b.getBoundingClientRect();
        const style = window.getComputedStyle(b);
        if (r.width > 2 && r.height > 2 && style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0") {
            return b;
        }
    }
    return buttons[0] || null;
}

function debuggerType(selector, text) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
            id: "irctc",           // âœ... Obfuscated script à¤•à¥‹ à¤¶à¤¾à¤‚à¤¤ à¤°à¤–à¤¨à¥‡ à¤•à¥‡ à¤²à¤¿à¤
            msg: { type: "IGNORE" }, // âœ... Crash à¤¸à¥‡ à¤¬à¤šà¤¾à¤¨à¥‡ à¤•à¥‡ à¤²à¤¿à¤
            type: "DEBUGGER_TYPE",  // âœ... à¤¹à¤®à¤¾à¤°à¤¾ à¤...à¤¸à¤²à¥€ à¤Ÿà¤¾à¤‡à¤ª
            selector: selector,
            text: text
        }, (response) => {
            if (response && response.success) resolve();
            else {
                console.warn("Debugger type failed/ignored, falling back to DOM fill", response);
                try { 
                    const el = document.querySelector(selector);
                    if(el) { el.value = text; el.dispatchEvent(new Event('input')); }
                } catch(e){}
                resolve();
            }
        });
    });
}


function debuggerEnter1() {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({
            id: "irctc", 
            msg: { type: "IGNORE" },
            type: "DEBUGGER_ENTER" // à¤¹à¤®à¤¨à¥‡ à¤œà¥‹ à¤¨à¤¯à¤¾ à¤¹à¥ˆà¤‚à¤¡à¤²à¤° à¤¬à¤¨à¤¾à¤¯à¤¾ à¤¹à¥ˆ
        }, (response) => {
            if (response && response.success) resolve();
            else {
                console.warn("Debugger Enter failed, falling back to JS");
                // Fallback: JS Enter
                const event = new KeyboardEvent('keydown', {
                    bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13
                });
                document.activeElement.dispatchEvent(event);
                resolve();
            }
        });
    });
}
// ==============================================================================
// === CORE HELPER FUNCTIONS (Optimized for Speed) ===
// ==============================================================================

// ... à¤†à¤ªà¤•à¤¾ à¤®à¥Œà¤œà¥‚à¤¦à¤¾ fastFill à¤”à¤° fastClick à¤«à¤‚à¤•à¥à¤¶à¤¨ à¤¯à¤¹à¤¾à¤ à¤°à¤¹à¥‡à¤ - à¤¾ ...

/**
 * à¤¸à¥à¤²à¥‹ à¤®à¥‹à¤¡: à¤•à¥€à¤¬à¥‹à¤°à¥à¤¡ à¤‡à¤µà¥‡à¤‚à¤Ÿà¥à¤¸ à¤•à¤¾ à¤‰à¤ªà¤¯à¥‹à¤ -  à¤•à¤°à¤•à¥‡ à¤Ÿà¥‡à¤•à¥à¤¸à¥à¤Ÿ à¤­à¤°à¤¤à¤¾ à¤¹à¥ˆà¥¤
 */
async function slowFill(element, text) {
    if (!element) return;
    element.focus();
    element.value = ''; // à¤ªà¤¹à¤²à¥‡ à¤¸à¥‡ à¤®à¥Œà¤œà¥‚à¤¦ à¤Ÿà¥‡à¤•à¥à¤¸à¥à¤Ÿ à¤•à¥‹ à¤¸à¤¾à¤«à¤¼ à¤•à¤°à¥‡à¤‚
    for (const char of text) {
        element.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
        element.value += char;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
        await new Promise(res => setTimeout(res, 50)); // à¤Ÿà¤¾à¤‡à¤ªà¤¿à¤‚à¤ -  à¤®à¥‡à¤‚ à¤¥à¥‹à¤¡à¤¼à¤¾ à¤ - à¥ˆà¤ª
    }
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.blur();
}

/**
 * à¤¸à¥à¤²à¥‹ à¤®à¥‹à¤¡: à¤®à¤¾à¤‰à¤¸ à¤‡à¤µà¥‡à¤‚à¤Ÿà¥à¤¸ à¤•à¤¾ à¤‰à¤ªà¤¯à¥‹à¤ -  à¤•à¤°à¤•à¥‡ à¤¬à¤Ÿà¤¨ à¤ªà¤° à¤•à¥à¤²à¤¿à¤• à¤•à¤°à¤¤à¤¾ à¤¹à¥ˆà¥¤
 */
function markTempId(el, prefix) {
    if (!el) return null;
    const id = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    el.setAttribute("id", id);
    el.setAttribute("data-lexus-click", id);
    return `[data-lexus-click="${id}"]`;
}

async function slowClick(element) {
    if (!element) return;
    const sel = markTempId(element, "lexus-nget");
    if (sel) await debuggerClick(sel, 50, 58);
}





/**
 * à¤¯à¤¹ à¤à¤• à¤ªà¥à¤¨: à¤ªà¥à¤°à¤¯à¥‹à¤œà¥à¤¯ (reusable) à¤¸à¥‡à¤¶à¤¨ à¤µà¥ˆà¤²à¤¿à¤¡à¥‡à¤Ÿà¤° à¤¹à¥ˆà¥¤
 * à¤¯à¤¹ à¤•à¤¿à¤¸à¥€ à¤­à¥€ à¤®à¤¹à¤¤à¥à¤µà¤ªà¥‚à¤°à¥à¤£ à¤à¤•à¥à¤¶à¤¨ à¤¸à¥‡ à¤ªà¤¹à¤²à¥‡ IRCTC à¤¸à¤°à¥à¤µà¤° à¤•à¥‹ à¤ªà¤¿à¤‚à¤ -  à¤•à¤°à¤•à¥‡ à¤¸à¥‡à¤¶à¤¨ à¤•à¥€ à¤µà¥ˆà¤§à¤¤à¤¾ à¤•à¥€ à¤œà¤¾à¤‚à¤š à¤•à¤°à¤¤à¤¾ à¤¹à¥ˆà¥¤
 * @returns {Promise<boolean>} - à¤¯à¤¦à¤¿ à¤¸à¥‡à¤¶à¤¨ à¤®à¤¾à¤¨à¥à¤¯ à¤¹à¥ˆ à¤¤à¥‹ 'true' à¤²à¥Œà¤Ÿà¤¤à¤¾ à¤¹à¥ˆ, à¤...à¤¨à¥à¤¯à¤¥à¤¾ 'false'à¥¤
 */
async function ensureValidSession() {
    console.log("LEXUS: IRCTC à¤¸à¥‡à¤¶à¤¨ à¤•à¥€ à¤µà¥ˆà¤§à¤¤à¤¾ à¤•à¥€ à¤œà¤¾à¤‚à¤š à¤•à¥€ à¤œà¤¾ à¤°à¤¹à¥€ à¤¹à¥ˆ...");
    try {
        // â˜...â˜...â˜... à¤¸à¤¹à¥€ à¤”à¤° à¤Ÿà¥‡à¤¸à¥à¤Ÿ à¤•à¤¿à¤¯à¤¾ à¤¹à¥à¤† URL â˜...â˜...â˜...
        const response = await fetch('https://www.irctc.co.in/eticketing/protected/mapps1/validateUser?source=3');

        if (response.status === 200) {
            console.log("LEXUS: à¤¸à¥‡à¤¶à¤¨ à¤®à¤¾à¤¨à¥à¤¯ à¤”à¤° à¤¸à¤•à¥à¤°à¤¿à¤¯ à¤¹à¥ˆà¥¤");
            return true; // à¤¸à¥‡à¤¶à¤¨ à¤ à¥€à¤• à¤¹à¥ˆà¥¤
        } 
        
        if (response.status === 401) {
            console.error("LEXUS: à¤¸à¥‡à¤¶à¤¨ à¤¸à¤®à¤¾à¤ªà¥à¤¤ à¤¹à¥‹ à¤ - à¤¯à¤¾ à¤¹à¥ˆ (401 Unauthorized)!");
            return false; // à¤¸à¥‡à¤¶à¤¨ à¤à¤•à¥à¤¸à¤ªà¤¾à¤¯à¤° à¤¹à¥‹ à¤ - à¤¯à¤¾ à¤¹à¥ˆà¥¤
        }
        
        // à¤•à¤¿à¤¸à¥€ à¤­à¥€ à¤...à¤¨à¥à¤¯ à¤à¤°à¤° à¤•à¥‡ à¤²à¤¿à¤
        console.warn(`LEXUS: à¤¸à¥‡à¤¶à¤¨ à¤œà¤¾à¤‚à¤š à¤®à¥‡à¤‚ à¤à¤• à¤...à¤ªà¥à¤°à¤¤à¥à¤¯à¤¾à¤¶à¤¿à¤¤ à¤¸à¥à¤Ÿà¥‡à¤Ÿà¤¸ à¤†à¤¯à¤¾: ${response.status}`);
        return false;

    } catch (error) {
        console.error("LEXUS: à¤¸à¥‡à¤¶à¤¨ à¤œà¤¾à¤‚à¤š à¤•à¥‡ à¤¦à¥Œà¤°à¤¾à¤¨ à¤¨à¥‡à¤Ÿà¤µà¤°à¥à¤• à¤à¤°à¤°à¥¤", error);
        return false; // à¤¨à¥‡à¤Ÿà¤µà¤°à¥à¤• à¤¸à¤®à¤¸à¥à¤¯à¤¾, à¤®à¤¾à¤¨ à¤²à¥‡à¤‚ à¤•à¤¿ à¤¸à¥‡à¤¶à¤¨ à¤...à¤®à¤¾à¤¨à¥à¤¯ à¤¹à¥ˆà¥¤
    }
}








// content_script.js
async function getStoredDeviceId() {
  try {
    console.groupCollapsed("[LEXUS] getStoredDeviceId()");
    const obj = await chrome.storage.local.get(["deviceId", "Machine"]);
    console.log("storage:", obj);
    const id = (obj.deviceId || obj.Machine || "").trim();
    console.log("resolved deviceId:", id || "(empty)");
    console.groupEnd();
    return id || "UNKNOWN-DEVICE";
  } catch (e) {
    console.warn("[LEXUS] getStoredDeviceId() error:", e);
    return "UNKNOWN-DEVICE";
  }
}










// LEXUS: removed unused external licence check











/**
 * Helper function to directly set input value and dispatch events.
 * This is much faster than simulating human typing.
 * @param {HTMLElement} element - The input element.
 * @param {string} text - The text to fill.
 */
function fastFill(element, text) {
    if (!element || typeof text !== 'string') {
        console.warn("Element not provided or text is not a string for fastFill.");
        return;
    }
    element.focus();
    element.value = text;
    element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    element.blur();
}

/**
 * Helper function for a simple, direct click.
 * @param {HTMLElement} element - The element to click.
 */
async function fastClick(element) {
    if (!element || element.disabled) {
        console.warn("Attempted to click on an invalid/disabled element:", element);
        return;
    }
    const sel = markTempId(element, "lexus-nget");
    if (sel) await debuggerClick(sel, 50, 50);
}

function addDelay(e) {
    const t = Date.now();
    let o = null;
    do {
        o = Date.now();
    } while (o - t < e);
}


// Function to show a custom alert message
function showCustomAlert(message) {
    const alertDiv = document.createElement('div');
    alertDiv.id = 'custom-alert';
    alertDiv.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        background-color: #fff; border: 1px solid #ccc; border-radius: 8px;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2); padding: 20px; z-index: 10000;
        text-align: center; font-family: 'Inter', sans-serif; max-width: 90%; width: 300px;
    `;
    alertDiv.innerHTML = `
        <p class="text-lg font-semibold mb-4">${message}</p>
        <button id="custom-alert-ok" class="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600">OK</button>
    `;
    document.body.appendChild(alertDiv);
    document.getElementById('custom-alert-ok').onclick = () => alertDiv.remove();
}

// Function to show a custom confirmation dialog
function showCustomConfirm(message, onYes, onNo) {
    const confirmDiv = document.createElement('div');
    confirmDiv.id = 'custom-confirm';
    confirmDiv.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        background-color: #fff; border: 1px solid #ccc; border-radius: 8px;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2); padding: 20px; z-index: 10000;
        text-align: center; font-family: 'Inter', sans-serif; max-width: 90%; width: 350px;
    `;
    confirmDiv.innerHTML = `
        <p class="text-lg font-semibold mb-4">${message}</p>
        <button id="custom-confirm-yes" class="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 mr-2">Yes</button>
        <button id="custom-confirm-no" class="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600">No</button>
    `;
    document.body.appendChild(confirmDiv);
    document.getElementById('custom-confirm-yes').onclick = () => { confirmDiv.remove(); if (onYes) onYes(); };
    document.getElementById('custom-confirm-no').onclick = () => { confirmDiv.remove(); if (onNo) onNo(); };
}

const isElementVisibleAndInteractable = el => {
    return el && getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden" && parseFloat(getComputedStyle(el).opacity) > 0 && !el.disabled;
};

let user_data = {};

function isManualLoginEnabled() {
    const v = user_data?.other_preferences?.manualLogin;
    return v === true || v === 'true' || v === 1 || v === '1';
}

function startLoginSuccessWatcher() {
    lexusSetLoginPhase('signed_in_wait', isManualLoginEnabled() ? 'manual login wait' : 'after SIGN IN');
    if (!isManualLoginEnabled()) {
        lexusLog('waiting for panel Logout (no fa-user while form open)...');
    }
    if (window.__LEXUS_DIRECT_BOOK__) {
        try {
            localStorage.removeItem('ir:tokens');
        } catch (_) {}
        window.__LEXUS_LOGIN_TOKEN_BASELINE__ = Date.now();
    }
    let checkCount = 0;
    let panelNudge = 0;
    const loginSuccessWatcher = setInterval(async () => {
        if (window.__LEXUS_DIRECT_BOOK__ && lexusHasIrTokens()) {
            clearInterval(loginSuccessWatcher);
            window.__LEXUS_LOGIN_FILLING__ = false;
            lexusLog('login ok  -  fresh tokens after SIGN IN');
            lexusFirePostLoginOnce('ir_tokens');
            return;
        }
        if (isLoginFormOpen()) {
            checkCount++;
            if (checkCount % 6 === 0) lexusLog('still on login form... captcha/error? #' + checkCount, 'warn');
            if (checkCount > 60) {
                clearInterval(loginSuccessWatcher);
                window.__LEXUS_LOGIN_FILLING__ = false;
                lexusLog('login form still open after wait  -  stop', 'error');
            }
            return;
        }
        if (lexusIsLoggedIn()) {
            clearInterval(loginSuccessWatcher);
            window.__LEXUS_LOGIN_FILLING__ = false;
            lexusLog('login ok  -  panel Logout');
            lexusFirePostLoginOnce('signed_in_wait');
            return;
        }
        checkCount++;
        if (panelNudge < 3 && checkCount % 10 === 0) {
            panelNudge++;
            lexusLog('nudge panel for Logout #' + panelNudge);
            try {
                await openUserSidePanel({ force: true });
            } catch (_) {}
        }
        if (checkCount > 50) {
            clearInterval(loginSuccessWatcher);
            window.__LEXUS_LOGIN_FILLING__ = false;
            lexusLog('login not confirmed (no panel Logout)', 'error');
        }
    }, 500);
    window.__LEXUS_LOGIN_WATCH_IV__ = loginSuccessWatcher;
}
function getMsg(e, t) { return { msg: { type: t, data: e }, sender: "content_script", id: "irctc" }; }
function classTranslator(e) {
    return "1A"===e?"AC First Class (1A)":"EV"===e?"Vistadome AC (EV)":"EC"===e?"Exec. Chair Car (EC)":"2A"===e?"AC 2 Tier (2A)":"3A"===e?"AC 3 Tier (3A)":"3E"===e?"AC 3 Economy (3E)":"CC"===e?"AC Chair car (CC)":"SL"===e?"Sleeper (SL)":"2S"===e?"Second Sitting (2S)":"None";
}
function quotaTranslator(e) {
    return "GN"===e?"GENERAL":"TQ"===e?"TATKAL":"PT"===e?"PREMIUM TATKAL":"LD"===e?"LADIES":"SR"===e?"LOWER BERTH/SR.CITIZEN":"";
}





















// ==============================================================================
// === PNR SUCCESS MESSAGE LOGIC (Final and Most Reliable Version) ===
// ==============================================================================



console.log("[LEXUS Log] Step 1: content_script.js loaded successfully.");

// à¤à¤• à¤ - à¥à¤²à¥‹à¤¬à¤² à¤µà¥ˆà¤°à¤¿à¤à¤¬à¤² à¤¤à¤¾à¤•à¤¿ à¤à¤¨à¥€à¤®à¥‡à¤¶à¤¨ à¤¸à¤¿à¤°à¥à¤« à¤à¤• à¤¬à¤¾à¤° à¤šà¤²à¥‡
let animationHasRun = false;

/**
 * à¤¯à¤¹ à¤«à¤¼à¤‚à¤•à¥à¤¶à¤¨ à¤ªà¥‡à¤œ à¤ªà¤° "PNR" à¤”à¤° "CNF" à¤¦à¥‹à¤¨à¥‹à¤‚ à¤Ÿà¥‡à¤•à¥à¤¸à¥à¤Ÿ à¤•à¥‡ à¤¦à¤¿à¤–à¤¾à¤ˆ à¤¦à¥‡à¤¨à¥‡ à¤•à¥€ à¤ªà¥à¤°à¤¤à¥€à¤•à¥à¤·à¤¾ à¤•à¤°à¤¤à¤¾ à¤¹à¥ˆ
 * à¤”à¤° à¤«à¤¿à¤° à¤¸à¤«à¤²à¤¤à¤¾ à¤à¤¨à¤¿à¤®à¥‡à¤¶à¤¨ à¤šà¤²à¤¾à¤¤à¤¾ à¤¹à¥ˆà¥¤
 */
function waitForPnrAndShowAnimation() {
    if (animationHasRun) {
        console.log("[LEXUS Log] Step 4a: Animation has already run. Skipping.");
        return;
    }
    
    console.log("[LEXUS Log] Step 4: Waiting for EXACT 3 conditions (Congratulations, PNR, CNF)...");

    const checkInterval = setInterval(() => {
        if (animationHasRun) {
            clearInterval(checkInterval);
            return;
        }

        const pageText = document.body.innerText || "";
        const hasCongrats = pageText.includes("Congratulations!, You have successfully booked a ticket");
        const hasPnr = pageText.includes("PNR");
        const hasCnf = pageText.includes("CNF");

        if (hasCongrats && hasPnr && hasCnf) {
            console.log("[LEXUS Log] Lexus! Teeno elements mil gaye. Animation fire.");
            clearInterval(checkInterval);
            animationHasRun = true;
            showPnrAnimation();
        }
    }, 100);
}



/**
 * à¤¯à¤¹ à¤«à¤¼à¤‚à¤•à¥à¤¶à¤¨ à¤œà¤¾à¤¨à¤•à¤¾à¤°à¥€ à¤‡à¤•à¤Ÿà¥à¤ à¤¾ à¤•à¤°à¤¤à¤¾ à¤¹à¥ˆ à¤”à¤° à¤ªà¥‰à¤ª-à¤...à¤ª à¤¦à¤¿à¤–à¤¾à¤¤à¤¾ à¤¹à¥ˆà¥¤
 * à¤“à¤°à¤¿à¤œà¤¿à¤¨à¤² à¤ªà¥‰à¤ª-à¤...à¤ª à¤•à¥‡ 1 à¤¸à¥‡à¤•à¤‚à¤¡ à¤¬à¤¾à¤¦ à¤µà¥‡à¤²à¤•à¤® à¤à¤¨à¥€à¤®à¥‡à¤¶à¤¨ à¤¶à¥à¤°à¥‚ à¤¹à¥‹à¤ - à¤¾à¥¤
 */
async function showPnrAnimation() {
    console.log("[LEXUS Log] Step 6: showPnrAnimation() function called.");

    try {
        console.log("[LEXUS Log] Step 6.1: Attempting to get data from chrome.storage.");
        const storedData = await chrome.storage.local.get(['journey_details', 'other_preferences']);
        
        const jd = storedData.journey_details || {};
        const op = storedData.other_preferences || {};
        
        console.log("[LEXUS Log] Step 6.2: Journey details from storage:", jd);
        console.log("[LEXUS Log] Step 6.2a: Other preferences from storage:", op);

        const timeObject = new Date();
        timeObject.setSeconds(timeObject.getSeconds() - 15);
        const pnrTime = timeObject.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

        const fromParts = jd.from ? jd.from.split('-') : [];
        const toParts = jd.destination ? jd.destination.split('-') : [];
        const dateParts = jd.date ? jd.date.split('-') : [];
        const fromCode = fromParts.length > 1 ? fromParts[1].trim() : (jd.from || '');
        const toCode = toParts.length > 1 ? toParts[1].trim() : (jd.destination || '');
        const formattedDate = dateParts.length === 3 ? `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}` : '';
        const journeyClass = jd.class || '';
        const journeyQuota = jd.quota || '';
        const trainDetails = jd['train-no'] || 'Train N/A';
        const journeyDetailsString = `${fromCode}-${toCode} ${formattedDate} ${journeyClass} ${journeyQuota}`.trim();

        let paymentMethod = "N/A";
        const paymentKey = op.paymentmethod || '';
        switch(paymentKey) {
            case "PAYTMUPI": case "PAYTMUPIID": case "PAYTMUPIQR": paymentMethod = "Paytm UPI"; break;
            case "PHONEPEUPIQR": paymentMethod = "PhonePe QR"; break;
            case "RAZORPAYUPI": paymentMethod = "Razorpay UPI"; break;
            case "PAYUUPI": paymentMethod = "PayU UPI"; break;
            case "AMZPAYWAL": paymentMethod = "Amazon Pay"; break;
            case "HDFCDB": paymentMethod = "HDFC DC"; break;
            case "kotak_dc": paymentMethod = "KOTAK DC"; break;
            case "icici_dc": paymentMethod = "ICICI DC"; break;
            case "MOBIKWIKWAL": paymentMethod = "MOBIKWIK"; break;
            case "SBINETBANKING": paymentMethod = "SBI_NB"; break;
            case "HDFCNETBANKING": paymentMethod = "HDFC_NB"; break; 
            case "IRCWA": paymentMethod = "IRCTC eWallet"; break;
            case "irctc_dc": case "IRCUPIID": case "IRCUPIQR":
                paymentMethod = "IRCTC iPay"; break;
            default: paymentMethod = paymentKey;
        }
        console.log(`[LEXUS Log] Payment method determined as: ${paymentMethod}`);
        
        let fare = "N/A";
        const fareSelectors = ['.line-def .orange-text strong', 'span.pull-right.orange-text strong', 'span.font-bold.pull-right', '.fare-summary .amount'];
        for (const selector of fareSelectors) {
            const fareElement = document.querySelector(selector);
            if (fareElement) {
                const cleanedFare = fareElement.innerText.replace(/[^0-9.]/g, '');
                if (cleanedFare) {
                    fare = cleanedFare;
                    console.log(`[LEXUS Log] Fare found with selector '${selector}': ${fare}`);
                    break;
                }
            }
        }
        const fareString = `FARE,${fare}`;

        // â­â­ à¤¨à¤¯à¤¾ code block à¤¯à¤¹à¤¾à¤ â­â­




        console.log("[LEXUS Log] Step 6.3: All data processed. Creating CSS and pop-ups now.");
        
        const newCss = `
            .lexus-tatkal-success-message {
                position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2); z-index: 99999;
                border-radius: 12px; overflow: hidden; text-align: center;
                width: 90%; max-width: 380px; border: 1px solid #ddd;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                animation: slideUp 0.5s ease-out forwards;
            }
            @keyframes slideUp { from { bottom: -100px; opacity: 0; } to { bottom: 20px; opacity: 1; } }
            .lexus-header { background-color: #005A9C; color: #fff; padding: 12px 15px; font-size: 18px; font-weight: bold; }
            .lexus-body {
                background-color: #2E8B57; color: #fff; padding: 20px;
                font-size: 16px; line-height: 1.8; font-weight: bold;
            }
            #lexus-welcome-message {
                position: fixed; top: 50%; left: 50%;
                transform: translate(-50%, -50%) scale(0);
                z-index: 9999999;
                background: linear-gradient(135deg, #0f2027, #203a43, #2c5364);
                color: white; padding: 25px 50px; border-radius: 15px;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4); border: 2px solid #5f9ea0;
                font-family: 'Segoe UI', Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif;
                font-size: 32px; font-weight: bold; text-align: center; white-space: nowrap;
                animation: finalRollAndStay 8s ease-in-out forwards;
            }
            @media (max-width: 600px) {
                #lexus-welcome-message {
                    font-size: 22px; padding: 20px 25px; white-space: normal;
                }
            }
            @keyframes finalRollAndStay {
                0% { opacity: 0; transform: translate(-50%, -50%) scale(2.5); }
                15% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
                40% { transform: translate(-50%, -50%) scale(1) rotate(0deg); }
                50% { transform: translate(-50%, -50%) scale(1.1) rotate(360deg); }
                65% { transform: translate(-50%, -50%) scale(1.1) rotate(720deg); }
                75%, 100% {
                    opacity: 1;
                    transform: translate(-50%, -50%) scale(1) rotate(1080deg);
                }
            }
        `;

        const styleElement = document.createElement('style');
        styleElement.id = 'lexus-tatkal-style-v2';
        styleElement.textContent = newCss;
        document.head.appendChild(styleElement);

        // à¤ªà¤¹à¤²à¤¾ à¤ªà¥‰à¤ª-à¤...à¤ª: à¤“à¤°à¤¿à¤œà¤¿à¤¨à¤² à¤¸à¤•à¥à¤¸à¥‡à¤¸ à¤®à¥ˆà¤¸à¥‡à¤œ
        const existingMessage = document.querySelector('.lexus-tatkal-success-message');
        if (existingMessage) existingMessage.remove();

        const successMessageDiv = document.createElement('div');
        successMessageDiv.className = 'lexus-tatkal-success-message lexus-ignore'; // à¤•à¥à¤²à¤¾à¤¸ à¤œà¥‹à¤¡à¤¼à¥€ à¤ - à¤ˆ
        successMessageDiv.innerHTML = `
            <div class="lexus-header">ðŸŒŠ Success By LEXUS ðŸŒŠ</div>
            <div class="lexus-body">
                <span>${fareString}</span><br>
                <span>PNRTIME: ${pnrTime}</span><br>
                <span>PAYMENT: ${paymentMethod}</span><br>
                <span>${journeyDetailsString}</span><br>
                <span>TRAIN: ${trainDetails}</span>
            </div>
        `;
        document.body.appendChild(successMessageDiv);
        console.log("[LEXUS Log] Step 7: Original success message displayed.");




  // === PATCH: Step 7.1  -  capture & send successData + screenshot (base64) ===
try {
  const targetEl = document.querySelector('.lexus-tatkal-success-message');

  if (targetEl && typeof html2canvas === 'function') {
    console.log("[LEXUS Log] Step 7.1: Capturing screenshot of success popup (base64)...");

    // 1) popup à¤•à¥‹ viewport à¤•à¥‡ à¤¬à¥€à¤š à¤®à¥‡à¤‚ à¤²à¤¾à¤“ (smooth à¤¨à¤¹à¥€à¤‚, à¤¤à¥à¤°à¤‚à¤¤)
    try {
      targetEl.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      // à¤¥à¥‹à¤¡à¤¼à¥€ à¤Šà¤ªà¤° à¤–à¤¿à¤¸à¤•à¤¾ à¤¦à¥‡à¤‚ à¤¤à¤¾à¤•à¤¿ header overlaps à¤¨ à¤•à¤°à¥‡
      window.scrollBy(0, -40);
    } catch (e) {
      /* ignore */
    }

    // 2) à¤›à¥‹à¤Ÿà¤¾ delay à¤¤à¤¾à¤•à¤¿ layout/animation settle à¤¹à¥‹ à¤œà¤¾à¤
    await new Promise(r => setTimeout(r, 500));

    // 3) capture à¤•à¥‡ à¤µà¤•à¥à¤¤ animation/transform disable (à¤¬à¤¾à¤¦ à¤®à¥‡à¤‚ restore)
    const prevAnimation = targetEl.style.animation;
    const prevTransition = targetEl.style.transition;
    const prevTransform = targetEl.style.transform;
    targetEl.style.animation = 'none';
    targetEl.style.transition = 'none';
    targetEl.style.transform = 'none';

    // 4) html2canvas à¤¸à¥‡ render
    const canvas = await html2canvas(targetEl, {
      backgroundColor: null,
      useCORS: true,
      scale: 2
    });

    // 5) styles restore
    targetEl.style.animation = prevAnimation;
    targetEl.style.transition = prevTransition;
    targetEl.style.transform = prevTransform;

    // Base64 à¤¨à¤¿à¤•à¤¾à¤²à¤¨à¤¾
    const dataUrl = canvas.toDataURL('image/png');
    const base64Img = dataUrl.replace(/^data:image\/png;base64,/, "");

    // Storage à¤¸à¥‡ licence key à¤ªà¤¢à¤¼à¤¨à¤¾
    const { licencekey } = await chrome.storage.local.get('licencekey');

    // Final Data object
    const successData = {
      PNR_Time: pnrTime,
      Gateway: paymentMethod,
      Src_Dest: journeyDetailsString,
      TrainNo: trainDetails,
      UserID: licencekey,
      base64image: base64Img
    };

    // Console à¤®à¥‡à¤‚ print
    console.log("=== Lexus PNR Data (with base64 image) ===", successData);

    // API call (JSON)
    // LEXUS: external success upload removed (no third-party server).
    console.log("[LEXUS] success upload disabled");
  } else {
    console.warn("[LEXUS Log] Screenshot: target or html2canvas missing.");
  }
} catch (e) {
  console.error("[LEXUS Log] Screenshot(base64) upload error:", e);
}
// === PATCH END ===





        // --- à¤¬à¤¦à¤²à¤¾à¤µ à¤¯à¤¹à¤¾à¤ à¤¹à¥ˆ: 1 à¤¸à¥‡à¤•à¤‚à¤¡ à¤•à¤¾ à¤¡à¤¿à¤²à¥‡ ---
        setTimeout(() => {
            // à¤¦à¥‚à¤¸à¤°à¤¾ à¤ªà¥‰à¤ª-à¤...à¤ª: à¤µà¥‡à¤²à¤•à¤® à¤®à¥ˆà¤¸à¥‡à¤œ
            const existingWelcomeMessage = document.querySelector('#lexus-welcome-message');
            if (existingWelcomeMessage) existingWelcomeMessage.remove();

            const welcomeMessageDiv = document.createElement('div');
            welcomeMessageDiv.id = 'lexus-welcome-message';
            welcomeMessageDiv.className = 'lexus-ignore'; // à¤•à¥à¤²à¤¾à¤¸ à¤œà¥‹à¤¡à¤¼à¥€ à¤ - à¤ˆ
            welcomeMessageDiv.textContent = 'Thank you for using LEXUS';
            document.body.appendChild(welcomeMessageDiv);

            console.log("[LEXUS Log] Step 8: Welcome animation started after 1-second delay.");
        }, 1000); // 1000ms = 1 à¤¸à¥‡à¤•à¤‚à¤¡
        
    } catch (error) {
        console.error("[LEXUS Log] Critical Error in showPnrAnimation:", error);
    }
}

/**
 * ==============================================================================
 * MAIN TRIGGER LOGIC
 * ==============================================================================
 */

/*console.log("[LEXUS Log] Step 2: Setting up message listener.");
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const messageType = (message && message.type) || (message && message.msg && message.msg.type);

    if (messageType === "showPnrAnimation") {
        console.log("[LEXUS Log] Step 3: Message 'showPnrAnimation' received. Triggering animation check.");
        waitForPnrAndShowAnimation();
        sendResponse({ status: "PNR check initiated." });
    }
});*/


/**
 * à¤¯à¤¹ à¤«à¤¼à¤‚à¤•à¥à¤¶à¤¨ PNR à¤¤à¤¤à¥à¤µ à¤•à¥‡ à¤¦à¤¿à¤–à¤¾à¤ˆ à¤¦à¥‡à¤¨à¥‡ à¤•à¥€ à¤ªà¥à¤°à¤¤à¥€à¤•à¥à¤·à¤¾ à¤•à¤°à¤¤à¤¾ à¤¹à¥ˆ à¤”à¤° à¤«à¤¿à¤° à¤¸à¤«à¤²à¤¤à¤¾ à¤à¤¨à¤¿à¤®à¥‡à¤¶à¤¨ à¤šà¤²à¤¾à¤¤à¤¾ à¤¹à¥ˆà¥¤
 */


// ==============================================================================
// === MAIN MESSAGE LISTENER & BOOKING FLOW LOGIC ===
// ==============================================================================



// ==============================================================================
// === MAIN MESSAGE LISTENER & BOOKING FLOW LOGIC ===
// ==============================================================================

chrome.runtime.onMessage.addListener(async (messageEvent, sender, sendResponse) => {
    if ("irctc" !== messageEvent.id) return void sendResponse("Invalid ID");
    const messageType = messageEvent.msg.type;

    if ("selectJourney" === messageType) {
        console.log("selectJourney action received");
        statusUpdate('selectJourney');
        let popupbtnArray = document.querySelectorAll(".btn.btn-primary");
        if (popupbtnArray.length > 1 && popupbtnArray[1]) {
            fastClick(popupbtnArray[1]);
            console.log("Close last trxn popup");
        }
        const trainListElementsQuery = document.querySelector("#divMain > div > app-train-list");
        if (!trainListElementsQuery) { console.error("Train list container not found for selectJourney."); return; }
        const trainListElements = [...trainListElementsQuery.querySelectorAll(".tbis-div app-train-avl-enq")];
        const trainNumber = user_data.journey_details["train-no"];
        if (!trainNumber) { console.error("Train number missing in user_data for selectJourney."); return; }
        const filteredTrainElement = trainListElements.find((el) => el.querySelector("div.train-heading")?.innerText.trim().includes(trainNumber.split("-")[0]));

        if ("M" === user_data.travel_preferences.AvailabilityCheck) return void showCustomAlert("Please manually select train and click Book");
        if ("A" === user_data.travel_preferences.AvailabilityCheck || "I" === user_data.travel_preferences.AvailabilityCheck) {
            if (!filteredTrainElement) return void showCustomAlert(`Precheck - Train (${trainNumber}) not found. Proceed manually or correct data.`);
            // ðŸ”´ NAYI LINE: Train milne ke baad screen ko smoothly scroll karke train ko center mein le aao
            filteredTrainElement.scrollIntoView({ behavior: "smooth", block: "center" });
            console.log("ðŸš‚ Screen scrolled to target train!");
            const translatedClass = classTranslator(user_data.journey_details.class);
            if (![...filteredTrainElement.querySelectorAll("table tr td div.pre-avl")].find((el_td) => el_td.querySelector("div")?.innerText === translatedClass))
                return void showCustomAlert("Precheck - Selected Class not available. Proceed manually or correct data.");
        }
        const headerStrongElement = document.querySelector("div.row.col-sm-12.h_head1 > span > strong");
        if ("A" === user_data.travel_preferences.AvailabilityCheck) {
            if (["TQ", "PT", "GN"].includes(user_data.journey_details.quota)) {
                console.log("Verify tatkal/general time");
                const journeyClass = user_data.journey_details.class;
                let requiredBookingTime = "00:00:00";
                if (["1A", "2A", "3A", "CC", "EC", "3E"].includes(journeyClass.toUpperCase())) {
                    requiredBookingTime = user_data.other_preferences.acbooktime;
                } else {
                    requiredBookingTime = user_data.other_preferences.slbooktime;
                }
                if ("GN" === user_data.journey_details.quota) requiredBookingTime = user_data.other_preferences.gnbooktime;
                console.log("Required Booking Time:", requiredBookingTime);
                var waitCounter = 0;
                let timeObserver = new MutationObserver(() => {
                    let currentTimeString = new Date().toString().split(" ")[4];
                    console.log("Current Time for booking:", currentTimeString);
                    if (currentTimeString >= requiredBookingTime) {
                        timeObserver.disconnect();
                        selectJourney();
                    } else {
                        if (waitCounter === 0) {
    try {
        // 1. Ek nayi div banayein
        const waitMessageDiv = document.createElement("div");
        waitMessageDiv.id = "lexus-wait-banner";
        waitMessageDiv.textContent = `Please wait... Booking will start at ${requiredBookingTime}`;
        
        // 2. Fixed positioning (Hamesha screen ke top par)
        Object.assign(waitMessageDiv.style, {
            position: "fixed",      // Screen ke relative fixed rahega
            top: "0px",             // Sabse upar
            left: "50%",
            transform: "translateX(-50%)", // Perfect center mein
            width: "100%",
            textAlign: "center", 
            color: "white", 
            fontSize: "22px", 
            fontWeight: "bold",
            padding: "15px 0",
            zIndex: "9999999",      // Ad-blocker aur ads se bhi upar
            boxShadow: "0 4px 10px rgba(0,0,0,0.5)"
        });
        
        // 3. Body mein append karein (na ki kisi child div mein)
        document.body.appendChild(waitMessageDiv);
        
    } catch (e) { console.log("Wait message display failed", e); }
}

try {
    // 4. Ab direct ID se pakdo (Selector path ki jhanjhat khatam)
    const waitIndicatorDiv = document.getElementById("lexus-wait-banner");
    if (waitIndicatorDiv) {
        waitIndicatorDiv.style.backgroundColor = waitCounter % 2 === 0 ? "green" : "red";
    }
} catch (e) { console.log("Wait indicator style failed", e); }

waitCounter++;
                    }
                });
                if (headerStrongElement) timeObserver.observe(headerStrongElement, { childList: true, subtree: true, characterDataOldValue: true });
                else console.warn("Header element for time observer not found.");
            } else {
                selectJourney();
            }
        } else if ("I" === user_data.travel_preferences.AvailabilityCheck) {
            selectJourney();
        }
    } else if ("fillPassengerDetails" === messageType) {
        statusUpdate('fillPassengerDetails');
        await fillPassengerDetails();
    } else if ("reviewBooking" === messageType) {
        statusUpdate('reviewBooking');
        if (user_data.fare_limit?.enableFareLimit) {
            let totalFare = 0;
            const possibleFareSelectors = ["#fare-summary .col-xs-12.line-def.top-header span.pull-right strong",".total-fare","#totalAmount",".fare-summary span.amount","span.fare-value",".fare-breakup-summary .fare-amount","div.fare-detail-item:has(span.fare-label:contains('Total Fare')) span.fare-value","div.col-sm-12.fare-summary div.col-sm-6.text-right.font-small-bold","div.fare-breakup-summary div.fare-amount","div.fare-detail-item:nth-child(5) > div:nth-child(2)","div.col-sm-6.text-right.font-small-bold"];
            for (const selector of possibleFareSelectors) {
                const element = document.querySelector(selector);
                if (element?.innerText.match(/(\d[\d,]*\.?\d*)/)) {
                    totalFare = parseFloat(element.innerText.replace(/[^0-9.]/g, ''));
                    if (!isNaN(totalFare)) { console.log(`Found total fare ${totalFare} using "${selector}"`); break; }
                }
            }
            if (!isNaN(totalFare) && totalFare > 0) {
                const maxFare = parseFloat(user_data.fare_limit.maxFareAmount);
                if (!isNaN(maxFare) && totalFare > maxFare) {
                    return showCustomConfirm(`Total fare (${totalFare}) exceeds limit (${maxFare}). Proceed?`,
                        () => proceedAfterFareCheck(),
                        () => { showCustomAlert("Booking cancelled due to high fare."); window.location.href = "https://www.irctc.co.in/nget/train-search"; }
                    );
                }
            } else { console.warn("Could not determine total fare for limit check."); }
        }
        await proceedAfterFareCheck();
   // REPLACE THE ENTIRE "bkgPaymentOptions" BLOCK WITH THIS FINAL CODE



} else if ("bkgPaymentOptions" === messageType) {

    // --- à¤¯à¤¹à¤¾à¤ à¤¸à¥‡ à¤¹à¤®à¤¾à¤°à¥‡ à¤¨à¤ 'à¤œà¤¾à¤¸à¥‚à¤¸' à¤¹à¥‡à¤²à¥à¤ªà¤° à¤«à¤‚à¤•à¥à¤¶à¤¨à¥à¤¸ à¤¶à¥à¤°à¥‚ à¤¹à¥‹à¤¤à¥‡ à¤¹à¥ˆà¤‚ ---
    // à¤‡à¤¨à¥à¤¹à¥‡à¤‚ à¤‡à¤¸à¥€ à¤¬à¥à¤²à¥‰à¤• à¤•à¥‡ à¤...à¤‚à¤¦à¤° à¤°à¤–à¤¨à¥‡ à¤¸à¥‡ à¤¯à¥‡ à¤¸à¤¿à¤°à¥à¤« à¤‡à¤¸à¥€ à¤•à¤¾à¤® à¤•à¥‡ à¤²à¤¿à¤ à¤‰à¤ªà¤²à¤¬à¥à¤§ à¤°à¤¹à¥‡à¤‚à¤ - à¥‡à¥¤

 /**
 * à¤¯à¤¹ à¤œà¤¾à¤‚à¤šà¤¤à¤¾ à¤¹à¥ˆ à¤•à¤¿ à¤•à¥‹à¤ˆ à¤¤à¤¤à¥à¤µ à¤¦à¤¿à¤–à¤¾à¤ˆ à¤¦à¥‡ à¤°à¤¹à¤¾ à¤¹à¥ˆ à¤”à¤° à¤‡à¤‚à¤Ÿà¤°à¥ˆà¤•à¥à¤Ÿ à¤•à¤°à¤¨à¥‡ à¤¯à¥‹à¤ - à¥à¤¯ à¤¹à¥ˆ à¤¯à¤¾ à¤¨à¤¹à¥€à¤‚à¥¤
 * @param {Element} el - à¤µà¤¹ à¤¤à¤¤à¥à¤µ à¤œà¤¿à¤¸à¤•à¥€ à¤œà¤¾à¤‚à¤š à¤•à¤°à¤¨à¥€ à¤¹à¥ˆà¥¤
 * @returns {boolean} - à¤¯à¤¦à¤¿ à¤¤à¤¤à¥à¤µ à¤¦à¤¿à¤–à¤¾à¤ˆ à¤¦à¥‡ à¤°à¤¹à¤¾ à¤¹à¥ˆ à¤”à¤° à¤‡à¤‚à¤Ÿà¤°à¥ˆà¤•à¥à¤Ÿ à¤•à¤°à¤¨à¥‡ à¤¯à¥‹à¤ - à¥à¤¯ à¤¹à¥ˆ à¤¤à¥‹ 'true' à¤²à¥Œà¤Ÿà¤¤à¤¾ à¤¹à¥ˆà¥¤
 */
const isElementVisibleAndInteractable = (el) => {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && !el.disabled;
};

/**
 * à¤•à¤¿à¤¸à¥€ à¤¤à¤¤à¥à¤µ à¤•à¥‡ à¤¦à¤¿à¤–à¤¨à¥‡ à¤¯à¤¾ à¤à¤• à¦¨à¦¿à¦°à§à¦¦à¦¿à¦·à§à¦Ÿ à¦¸à¦®à¦¯à¦¼ à¤¬à¥€à¤¤à¤¨à¥‡ à¤¤à¤• à¤ªà¥à¤°à¤¤à¥€à¤•à¥à¤·à¤¾ à¤•à¤°à¤¤à¤¾ à¤¹à¥ˆà¥¤
 * à¤¯à¤¦à¤¿ à¤¤à¤¤à¥à¤µ 2 à¤¸à¥‡à¤•à¤‚à¤¡ à¤•à¥‡ à¤­à¥€à¤¤à¤° à¤¦à¤¿à¤–à¤¾à¤ˆ à¤¦à¥‡à¤¤à¤¾ à¤¹à¥ˆ, à¤¤à¥‹ à¤¯à¤¹ à¤¤à¥à¤°à¤‚à¤¤ à¤‰à¤¸à¥‡ à¤²à¥Œà¤Ÿà¤¾ à¤¦à¥‡à¤¤à¤¾ à¤¹à¥ˆà¥¤
 * à¤...à¤¨à¥à¤¯à¤¥à¤¾, 2 à¤¸à¥‡à¤•à¤‚à¤¡ à¤•à¥‡ à¤¬à¤¾à¤¦, à¤¯à¤¹ à¤¤à¤¤à¥à¤µ à¤•à¥‹ à¤‰à¤¸à¤•à¥€ à¤¦à¥ƒà¤¶à¥à¤¯à¤¤à¤¾ à¤•à¥€ à¤ªà¤°à¤µà¤¾à¤¹ à¤•à¤¿à¤ à¤¬à¤¿à¤¨à¤¾ à¤²à¥Œà¤Ÿà¤¾à¤¤à¤¾ à¤¹à¥ˆà¥¤
 * @param {string} selector - à¤‰à¤¸ à¤¤à¤¤à¥à¤µ à¤•à¤¾ CSS à¤šà¤¯à¤¨à¤•à¤°à¥à¤¤à¤¾ à¤œà¤¿à¤¸à¤•à¤¾ à¤‡à¤‚à¤¤à¤œà¤¾à¤° à¤•à¤°à¤¨à¤¾ à¤¹à¥ˆà¥¤
 * @returns {Promise<Element|null>} - à¤à¤• à¤ªà¥à¤°à¥‰à¤®à¤¿à¤¸ à¤œà¥‹ à¤®à¤¿à¤²à¥‡ à¤¹à¥à¤ à¤¤à¤¤à¥à¤µ (à¤¯à¤¾ null) à¤•à¥‡ à¤¸à¤¾à¤¥ à¤¹à¤² à¤¹à¥‹à¤¤à¤¾ à¤¹à¥ˆà¥¤
 */
const waitForElement = (selector) => {
    return new Promise(resolve => {
        // à¤¤à¥à¤°à¤‚à¤¤ à¤œà¤¾à¤‚à¤šà¥‡à¤‚ à¤•à¤¿ à¤•à¥à¤¯à¤¾ à¤¤à¤¤à¥à¤µ à¤ªà¤¹à¤²à¥‡ à¤¸à¥‡ à¤®à¥Œà¤œà¥‚à¤¦ à¤¹à¥ˆ à¤”à¤° à¤¦à¤¿à¤–à¤¾à¤ˆ à¤¦à¥‡ à¤°à¤¹à¤¾ à¤¹à¥ˆ
        const element = document.querySelector(selector);
        if (element && isElementVisibleAndInteractable(element)) {
            console.log(`à¤¤à¤¤à¥à¤µ à¤¤à¥à¤°à¤‚à¤¤ à¤®à¤¿à¤²à¤¾ à¤”à¤° à¤¦à¥ƒà¤¶à¥à¤¯à¤®à¤¾à¤¨ à¤¹à¥ˆ: ${selector}`);
            return resolve(element);
        }

        let observer;
        
        // à¤à¤• 2-à¤¸à¥‡à¤•à¤‚à¤¡ à¤•à¤¾ à¤Ÿà¤¾à¤‡à¤®à¤†à¤‰à¤Ÿ à¤¸à¥‡à¤Ÿ à¤•à¤°à¥‡à¤‚
        const timeoutId = setTimeout(() => {
            console.log(`2 à¤¸à¥‡à¤•à¤‚à¤¡ à¤•à¤¾ à¤Ÿà¤¾à¤‡à¤®à¤†à¤‰à¤Ÿ à¤¸à¤®à¤¾à¤ªà¥à¤¤à¥¤ ${selector} à¤•à¥€ à¤¦à¥ƒà¤¶à¥à¤¯à¤¤à¤¾ à¤•à¥€ à¤ªà¤°à¤µà¤¾à¤¹ à¤•à¤¿à¤ à¤¬à¤¿à¤¨à¤¾ à¤•à¥à¤²à¤¿à¤• à¤•à¤°à¤¨à¥‡ à¤•à¤¾ à¤ªà¥à¤°à¤¯à¤¾à¤¸ à¤•à¤¿à¤¯à¤¾ à¤œà¤¾ à¤°à¤¹à¤¾ à¤¹à¥ˆà¥¤`);
            if (observer) {
                observer.disconnect(); // à¤‘à¤¬à¥à¤œà¤°à¥à¤µà¤° à¤•à¥‹ à¤°à¥‹à¤•à¥‡à¤‚
            }
            const elAfterTimeout = document.querySelector(selector);
            resolve(elAfterTimeout); // à¤®à¤¿à¤²à¥‡ à¤¹à¥à¤ à¤¤à¤¤à¥à¤µ à¤•à¥‡ à¤¸à¤¾à¤¥ à¤ªà¥à¤°à¥‰à¤®à¤¿à¤¸ à¤•à¥‹ à¤¹à¤² à¤•à¤°à¥‡à¤‚, à¤šà¤¾à¤¹à¥‡ à¤µà¤¹ à¤¦à¤¿à¤–à¥‡ à¤¯à¤¾ à¤¨ à¤¦à¤¿à¤–à¥‡
        }, 200);

        // DOM à¤ªà¤°à¤¿à¤µà¤°à¥à¤¤à¤¨à¥‹à¤‚ à¤•à¥€ à¤¨à¤¿à¤ - à¤°à¤¾à¤¨à¥€ à¤•à¥‡ à¤²à¤¿à¤ à¤à¤• MutationObserver à¤¸à¥‡à¤Ÿ à¤•à¤°à¥‡à¤‚
        observer = new MutationObserver(() => {
            const el = document.querySelector(selector);
            if (el && isElementVisibleAndInteractable(el)) {
                console.log(`à¤¤à¤¤à¥à¤µ DOM à¤®à¥‡à¤‚ à¤¬à¤¦à¤²à¤¾à¤µ à¤•à¥‡ à¤®à¤¾à¤§à¥à¤¯à¤® à¤¸à¥‡ à¤®à¤¿à¤²à¤¾: ${selector}`);
                clearTimeout(timeoutId); // à¤Ÿà¤¾à¤‡à¤®à¤†à¤‰à¤Ÿ à¤°à¤¦à¥à¤¦ à¤•à¤°à¥‡à¤‚ à¤•à¥à¤¯à¥‹à¤‚à¤•à¤¿ à¤¤à¤¤à¥à¤µ à¤®à¤¿à¤² à¤ - à¤¯à¤¾ à¤¹à¥ˆ
                observer.disconnect();
                resolve(el);
            }
        });

        // à¤ªà¥‚à¤°à¥‡ à¤¦à¤¸à¥à¤¤à¤¾à¤µà¥‡à¤œà¤¼ à¤•à¥‡ à¤¬à¥‰à¤¡à¥€ à¤ªà¤° à¤‘à¤¬à¥à¤œà¤°à¥à¤µà¤° à¤¸à¤•à¥à¤°à¤¿à¤¯ à¤•à¤°à¥‡à¤‚
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true // à¤µà¤¿à¤¶à¥‡à¤·à¤¤à¤¾à¤“à¤‚ (à¤œà¥ˆà¤¸à¥‡ style) à¤®à¥‡à¤‚ à¤¬à¤¦à¤²à¤¾à¤µ à¤¦à¥‡à¤–à¤¨à¥‡ à¤•à¥‡ à¤²à¤¿à¤
        });
    });
};

/**
 * à¤•à¥à¤²à¤¿à¤• à¤¸à¥à¤¨à¤¿à¤¶à¥à¤šà¤¿à¤¤ à¤•à¤°à¤¨à¥‡ à¤•à¥‡ à¤²à¤¿à¤ à¤à¤• à¤¤à¥‡à¤œà¤¼ à¤•à¥à¤²à¤¿à¤• à¤•à¤°à¤¤à¤¾ à¤¹à¥ˆà¥¤
 * @param {Element} el - à¤µà¤¹ à¤¤à¤¤à¥à¤µ à¤œà¤¿à¤¸ à¤ªà¤° à¤•à¥à¤²à¤¿à¤• à¤•à¤°à¤¨à¤¾ à¤¹à¥ˆà¥¤
 */
const fastClick = (el) => {
    if (el) {
        el.click();
    }
};

/**
 * à¤à¤• à¤¬à¤Ÿà¤¨ à¤ªà¤° à¤•à¥à¤²à¤¿à¤• à¤•à¤°à¤¤à¤¾ à¤¹à¥ˆ à¤”à¤° à¤à¤• à¤²à¥‹à¤¡à¤° à¤•à¥‡ à¤¦à¤¿à¤–à¤¨à¥‡ à¤”à¤° à¤«à¤¿à¤° à¤ - à¤¾à¤¯à¤¬ à¤¹à¥‹à¤¨à¥‡ à¤¤à¤• à¤‡à¤‚à¤¤à¤œà¤¾à¤° à¤•à¤°à¤¤à¤¾ à¤¹à¥ˆà¥¤
 * @param {string} buttonSelector - à¤‰à¤¸ à¤¬à¤Ÿà¤¨ à¤•à¤¾ CSS à¤šà¤¯à¤¨à¤•à¤°à¥à¤¤à¤¾ à¤œà¤¿à¤¸ à¤ªà¤° à¤•à¥à¤²à¤¿à¤• à¤•à¤°à¤¨à¤¾ à¤¹à¥ˆà¥¤
 * @param {string} loaderSelector - à¤‰à¤¸ à¤²à¥‹à¤¡à¤° à¤•à¤¾ CSS à¤šà¤¯à¤¨à¤•à¤°à¥à¤¤à¤¾ à¤œà¤¿à¤¸à¤•à¤¾ à¤‡à¤‚à¤¤à¤œà¤¾à¤° à¤•à¤°à¤¨à¤¾ à¤¹à¥ˆà¥¤
 * @returns {Promise<void>} - à¤à¤• à¤ªà¥à¤°à¥‰à¤®à¤¿à¤¸ à¤œà¥‹ à¤ªà¥à¤°à¥‹à¤¸à¥‡à¤¸à¤¿à¤‚à¤ -  à¤ªà¥‚à¤°à¥€ à¤¹à¥‹à¤¨à¥‡ à¤ªà¤° à¤¹à¤² à¤¹à¥‹à¤¤à¤¾ à¤¹à¥ˆà¥¤
 */
const smartClickAndProcess = async (buttonSelector, loaderSelector) => {
    console.log(`à¤œà¤¾à¤¸à¥‚à¤¸ à¤¤à¥ˆà¤¨à¤¾à¤¤: ${buttonSelector} à¤ªà¤° à¤•à¥à¤²à¤¿à¤• à¤•à¤°à¤¨à¥‡ à¤”à¤° à¤ªà¥à¤°à¥‹à¤¸à¥‡à¤¸à¤¿à¤‚à¤ -  à¤•à¤¾ à¤‡à¤‚à¤¤à¤œà¤¼à¤¾à¤° à¤•à¤°à¤¨à¥‡ à¤•à¥‡ à¤²à¤¿à¤à¥¤`);
    const buttonToClick = await waitForElement(buttonSelector);

    // à¤¯à¤¦à¤¿ 2 à¤¸à¥‡à¤•à¤‚à¤¡ à¤•à¥‡ à¤¬à¤¾à¤¦ à¤­à¥€ à¤¬à¤Ÿà¤¨ à¤¨à¤¹à¥€à¤‚ à¤®à¤¿à¤²à¤¤à¤¾ à¤¹à¥ˆ, à¤¤à¥‹ à¤¤à¥à¤°à¥à¤Ÿà¤¿ à¤²à¥‰à¤ -  à¤•à¤°à¥‡à¤‚ à¤”à¤° à¤¬à¤¾à¤¹à¤° à¤¨à¤¿à¤•à¤²à¥‡à¤‚
    if (!buttonToClick) {
        console.error(`à¤¤à¥à¤°à¥à¤Ÿà¤¿: 2 à¤¸à¥‡à¤•à¤‚à¤¡ à¤•à¥‡ à¤¬à¤¾à¤¦ à¤­à¥€ à¤¤à¤¤à¥à¤µ à¤¨à¤¹à¥€à¤‚ à¤®à¤¿à¤²à¤¾: ${buttonSelector}`);
        return;
    }
    
    fastClick(buttonToClick);
    console.log(`à¤•à¥à¤²à¤¿à¤• à¤•à¤¿à¤¯à¤¾: ${buttonSelector}à¥¤ à¤...à¤¬ à¤¸à¤°à¥à¤µà¤° à¤ªà¥à¤°à¥‹à¤¸à¥‡à¤¸à¤¿à¤‚à¤ -  à¤•à¤¾ à¤‡à¤‚à¤¤à¤œà¤¼à¤¾à¤°...`);
    
    return new Promise(resolve => {
        let loaderHasAppeared = false;
        const observer = new MutationObserver(() => {
            const loader = document.querySelector(loaderSelector);
            const isVisible = (el) => el && window.getComputedStyle(el).display !== 'none';
            
            if (!loaderHasAppeared && isVisible(loader)) {
                console.log("à¤ªà¥à¤°à¥‹à¤¸à¥‡à¤¸à¤¿à¤‚à¤ -  à¤¶à¥à¤°à¥‚! à¤²à¥‹à¤¡à¤° à¤¦à¤¿à¤–à¤¾à¥¤");
                loaderHasAppeared = true;
            }
            
            if (loaderHasAppeared && !isVisible(loader)) {
                console.log("à¤¸à¤¿à¤ - à¥à¤¨à¤² à¤®à¤¿à¤²à¤¾! à¤ªà¥à¤°à¥‹à¤¸à¥‡à¤¸à¤¿à¤‚à¤ -  à¤ªà¥‚à¤°à¥€à¥¤");
                observer.disconnect();
                resolve();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    });
};
    // --- à¤¹à¥‡à¤²à¥à¤ªà¤° à¤«à¤‚à¤•à¥à¤¶à¤¨à¥à¤¸ à¤¯à¤¹à¤¾à¤ à¤–à¤¤à¥à¤® à¤¹à¥‹à¤¤à¥‡ à¤¹à¥ˆà¤‚ ---

// === eWallet CONFIRM Auto Clicker ===
const autoClickConfirm = async (methodKey) => {
  if (!String(methodKey).toUpperCase().includes("IRCWA")) return; // à¤¸à¤¿à¤°à¥à¤« eWallet à¤•à¥‡à¤¸

  console.log("LEXUS: eWallet à¤šà¥à¤¨à¤¾ à¤ - à¤¯à¤¾  -  à¤...à¤¬ CONFIRM à¤¬à¤Ÿà¤¨ à¤ªà¤° à¤¬à¤¾à¤°-à¤¬à¤¾à¤° à¤•à¥à¤²à¤¿à¤• à¤•à¤°à¥‡à¤‚à¤ - à¥‡ à¤œà¤¬ à¤¤à¤• à¤¹à¥‹ à¤¨ à¤œà¤¾à¤à¥¤");

  const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toUpperCase();

  let intervalId = setInterval(() => {
    const btn = [...document.querySelectorAll('button.mob-bot-btn.search_btn, button[type="button"], button')]
      .find(b => norm(b.textContent).includes("CONFIRM"));

    if (btn) {
      try { btn.scrollIntoView({ block: "center", inline: "center" }); } catch(_) {}
      btn.click();
      console.log("LEXUS: CONFIRM à¤ªà¤° à¤•à¥à¤²à¤¿à¤• à¤•à¤° à¤¦à¤¿à¤¯à¤¾à¥¤");

      clearInterval(intervalId); // à¤à¤• à¤¬à¤¾à¤° à¤•à¥à¤²à¤¿à¤• à¤•à¥‡ à¤¬à¤¾à¤¦ à¤°à¥à¤• à¤œà¤¾à¤
    }
  }, 1000); // à¤¹à¤° 1 à¤¸à¥‡à¤•à¤‚à¤¡ à¤ªà¤° à¤Ÿà¥à¤°à¤¾à¤¯
};






    statusUpdate('bkgPaymentOptions');
    console.log("LEXUS: bkgPaymentOptions à¤à¤•à¥à¤¶à¤¨ à¤®à¤¿à¤²à¤¾à¥¤");
    const isSlowMode = user_data.other_preferences.useSlowMode;

    const executePayment = async (methodKey) => {
        if (!methodKey) return { success: false };
        let paymentCategory, paymentOptionText;
        console.log(`LEXUS: à¤ªà¥‡à¤®à¥‡à¤‚à¤Ÿ à¤•à¤¾ à¤ªà¥à¤°à¤¯à¤¾à¤¸: ${methodKey}`);
        
        // --- à¤ªà¥‡à¤®à¥‡à¤‚à¤Ÿ à¤®à¥ˆà¤ªà¤¿à¤‚à¤ -  à¤•à¤¾ à¤ªà¥‚à¤°à¤¾ à¤²à¥‰à¤œà¤¿à¤• ---
        if (methodKey.includes("PAYTMUPI")) { paymentCategory = "BHIM/ UPI/ USSD"; paymentOptionText = "Paytm UPI"; }
        else if (methodKey.includes("PHONEPEUPIQR")) { paymentCategory = "Multiple Payment Service"; paymentOptionText = "PhonePe"; }
        else if (methodKey.includes("RAZORPAYUPI")) { paymentCategory = "Multiple Payment Service"; paymentOptionText = "Razorpay"; }
        else if (methodKey.includes("PAYUUPI")) { paymentCategory = "Multiple Payment Service"; paymentOptionText = "Payu"; }
        else if (methodKey.includes("AMZPAYWAL")) { paymentCategory = "Wallets / Cash Card"; paymentOptionText = "Amazonpay"; }
        else if (methodKey.includes("MOBIKWIKWAL")) { paymentCategory = "Wallets / Cash Card"; paymentOptionText = "Mobikwik Wallet"; }
        else if (methodKey.includes("HDFCDB")) { paymentCategory = "Payment Gateway / Credit Card / Debit Card"; paymentOptionText = "Powered By HDFC BANK"; }
        else if (methodKey.includes("kotak_dc")) { paymentCategory = "Payment Gateway / Credit Card / Debit Card"; paymentOptionText = "Powered by KOTAK BANK"; }
        else if (methodKey.includes("icici_dc")) { paymentCategory = "Payment Gateway / Credit Card / Debit Card"; paymentOptionText = "Powered by ICICI BANK"; }
        else if (methodKey.includes("SBINETBANKING")) { paymentCategory = "Netbanking"; paymentOptionText = "State Bank of India"; }
        else if (methodKey.includes("HDFCNETBANKING")) { paymentCategory = "Netbanking"; paymentOptionText = "ICICI Bank"; }
        else if (methodKey.includes("IRCWA")) { paymentCategory = "E-Wallet"; paymentOptionText = "IRCTC eWallet"; }
        else if (["IRCUPIID", "IRCUPIQR", "irctc_dc"].includes(methodKey)) {
            paymentCategory = "IRCTC iPay (Credit Card/Debit Card/UPI)";
            paymentOptionText = "IRCTC ipay";
        } else {
            return { success: false, reason: "Unsupported payment gateway" };
        }
        const normalizePaymentText = value => String(value || "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");

        // 1. à¤ªà¥‡à¤®à¥‡à¤‚à¤Ÿ à¤•à¥€ à¤•à¥‡à¤Ÿà¥‡à¤ - à¤°à¥€ à¤ªà¤° à¤•à¥à¤²à¤¿à¤• à¤•à¤°à¥‡à¤‚
        const categoryKey = normalizePaymentText(paymentCategory).replace(/services$/, "service");
        let categoryElement = Array.from(document.querySelectorAll("#pay-type span.bank-type-heading, #pay-type div.bank-type")).find(cat => {
            if (!cat || cat.getClientRects().length === 0) return false;
            const text = normalizePaymentText(cat.innerText || cat.textContent).replace(/services$/, "service");
            return text.includes(categoryKey) || (categoryKey.startsWith("irctcipay") && text.startsWith("irctcipay"));
        });
        if (!categoryElement) {
            console.error(`LEXUS: à¤•à¥ˆà¤Ÿà¥‡à¤ - à¤°à¥€ '${paymentCategory}' à¤¨à¤¹à¥€à¤‚ à¤®à¤¿à¤²à¥€à¥¤`);
            return { success: false };
        }
        console.log(`LEXUS: à¤•à¥ˆà¤Ÿà¥‡à¤ - à¤°à¥€ à¤ªà¤° à¤•à¥à¤²à¤¿à¤• à¤•à¤° à¤°à¤¹à¥‡ à¤¹à¥ˆà¤‚: '${paymentCategory}'`);
        isSlowMode ? await slowClick(categoryElement) : fastClick(categoryElement);
        
        // à¤®à¥‹à¤¬à¤¾à¤‡à¤² à¤µà¥à¤¯à¥‚ à¤•à¥‡ à¤²à¤¿à¤ 'Continue' à¤¬à¤Ÿà¤¨ à¤ªà¤° à¤•à¥à¤²à¤¿à¤•
        // Some layouts reveal gateway choices only after category Continue.
        // Match Continue exactly, never Pay & Book or a payment authorization.
        let categoryContinued = false;

        
        // 2. à¤ªà¥‡à¤®à¥‡à¤‚à¤Ÿ à¤•à¥‡ à¤‘à¤ªà¥à¤¶à¤¨ à¤ªà¤° à¤•à¥à¤²à¤¿à¤• à¤•à¤°à¥‡à¤‚
        const gatewayIds = {IRCUPIID: "167", IRCUPIQR: "167", PAYTMUPIID: "117", PAYTMUPIQR: "117", RAZORPAYUPI: "105", PAYUUPIID: "98", PHONEPEUPIQR: "116"};
        const gatewayId = gatewayIds[methodKey];
        let optionElement;
        for (let attempt = 0; attempt < 20 && !optionElement; attempt++) {
            await new Promise(res => setTimeout(res, 250));
            optionElement = Array.from(document.getElementsByClassName("border-all no-pad")).find(opt => {
                if (opt.getClientRects().length === 0) return false;
                const icon = opt.querySelector('img[src*="/payment/"]');
                const bankId = icon?.getAttribute("src")?.match(/\/payment\/(\d+)\.png(?:[?#]|$)/)?.[1];
                if (gatewayId && bankId) return bankId === gatewayId;
                return normalizePaymentText(opt.innerText || opt.textContent).includes(normalizePaymentText(paymentOptionText));
            });
            if (!optionElement && !categoryContinued) {
                const continueButton = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"]')).find(button =>
                    !button.disabled && button.getAttribute("aria-disabled") !== "true" && button.getClientRects().length > 0 &&
                    normalizePaymentText(button.innerText || button.textContent || button.value) === "continue"
                );
                if (continueButton) {
                    isSlowMode ? await slowClick(continueButton) : fastClick(continueButton);
                    categoryContinued = true;
                }
            }
        }

        if (optionElement) {
            console.log(`LEXUS: à¤‘à¤ªà¥à¤¶à¤¨ '${paymentOptionText}' à¤®à¤¿à¤²à¤¾à¥¤ à¤•à¥à¤²à¤¿à¤• à¤•à¤° à¤°à¤¹à¥‡ à¤¹à¥ˆà¤‚à¥¤`);
            isSlowMode ? await slowClick(optionElement) : fastClick(optionElement);
            return { success: true };
        } else {
            console.warn(`LEXUS: à¤‘à¤ªà¥à¤¶à¤¨ '${paymentOptionText}' à¤¨à¤¹à¥€à¤‚ à¤®à¤¿à¤²à¤¾à¥¤`);
            return { success: false };
        }
    };

    // --- à¤®à¥à¤–à¥à¤¯ à¤«à¥à¤²à¥‹ ---
    const primaryMethod = user_data.other_preferences.paymentmethod;
    const backupMethod = user_data.other_preferences.backup_payment_method;

    const handlePaymentFlow = async (method) => {
        const result = await executePayment(method);
        if (result.success && !user_data.other_preferences.paymentManual) {





         
            // STEP 2: à¤...à¤ - à¤° à¤¸à¥‡à¤¶à¤¨ à¤®à¤¾à¤¨à¥à¤¯ à¤¹à¥ˆ, à¤¤à¤­à¥€ à¤•à¥à¤²à¤¿à¤• à¤•à¤°à¥‡à¤‚
            console.log("LEXUS: à¤¸à¥‡à¤¶à¤¨ à¤®à¤¾à¤¨à¥à¤¯ à¤¹à¥ˆà¥¤ à¤...à¤¬ 'Pay & Book' à¤ªà¤° à¤•à¥à¤²à¤¿à¤• à¤•à¤¿à¤¯à¤¾ à¤œà¤¾ à¤°à¤¹à¤¾ à¤¹à¥ˆà¥¤");




            statusUpdate('redirectToBank');
            
            // --- à¤¯à¥‚à¤œà¤¼à¤° à¤¦à¥à¤µà¤¾à¤°à¤¾ à¤¸à¥‡à¤Ÿ à¤•à¥€ à¤ - à¤ˆ à¤¦à¥‡à¤°à¥€ à¤•à¤¾ à¤ªà¥‚à¤°à¤¾ à¤²à¥‰à¤œà¤¿à¤• ---
            const delayInSeconds = parseInt(user_data.other_preferences.secSelectionDelay || "0", 10);
            if (delayInSeconds > 0) {
                const delayInMilliseconds = delayInSeconds * 1000;
                console.log(`LEXUS: à¤‰à¤ªà¤¯à¥‹à¤ - à¤•à¤°à¥à¤¤à¤¾ à¤¦à¥à¤µà¤¾à¤°à¤¾ à¤šà¥à¤¨à¥€ à¤ - à¤ˆ ${delayInSeconds} à¤¸à¥‡à¤•à¤‚à¤¡ à¤•à¥€ à¤¦à¥‡à¤°à¥€ à¤¶à¥à¤°à¥‚à¥¤`);
                showOnScreenNotification(`Waiting for ${delayInSeconds} sec before clicking Pay & Book...`, delayInMilliseconds);
                await new Promise(resolve => setTimeout(resolve, delayInMilliseconds));
                console.log(`LEXUS: ${delayInSeconds} à¤¸à¥‡à¤•à¤‚à¤¡ à¤•à¥€ à¤¦à¥‡à¤°à¥€ à¤¸à¤®à¤¾à¤ªà¥à¤¤à¥¤ à¤...à¤¬ Pay & Book à¤ªà¤° à¤•à¥à¤²à¤¿à¤• à¤•à¤¿à¤¯à¤¾ à¤œà¤¾ à¤°à¤¹à¤¾ à¤¹à¥ˆà¥¤`);
            }
            
            // 3. "Pay & Book" à¤¬à¤Ÿà¤¨ à¤ªà¤° à¤•à¥à¤²à¤¿à¤• à¤•à¤°à¥‡à¤‚
            const payButton = document.querySelector("button.btn-primary");
            if (payButton) {
                console.log("LEXUS: 'Pay & Book' à¤¬à¤Ÿà¤¨ à¤ªà¤° à¤•à¥à¤²à¤¿à¤• à¤•à¤° à¤°à¤¹à¥‡ à¤¹à¥ˆà¤‚à¥¤");
                isSlowMode ? await slowClick(payButton) : fastClick(payButton);

                 await autoClickConfirm(method);
            }
        }
        return result.success;
    };

    const primarySuccess = await handlePaymentFlow(primaryMethod);

    if (!primarySuccess) {
        console.warn(`LEXUS: à¤ªà¥à¤°à¤¾à¤‡à¤®à¤°à¥€ à¤®à¥‡à¤¥à¤¡ à¤«à¥‡à¤²à¥¤ à¤¬à¥ˆà¤•à¤...à¤ª à¤•à¤¾ à¤ªà¥à¤°à¤¯à¤¾à¤¸ à¤•à¤° à¤°à¤¹à¥‡ à¤¹à¥ˆà¤‚: ${backupMethod}`);
        if (backupMethod) {
            showOnScreenNotification(`Primary method failed. Switching to backup: ${backupMethod}`, 5000);
            await handlePaymentFlow(backupMethod);
        } else {
            showOnScreenNotification(`Primary method failed and no backup is set.`, 6000);
        }
    }
}  else if ("showPnrAnimation" === messageType) {
    console.log("LEXUS: showPnrAnimation message received. Waiting for DOM to render PNR...");
    
    // ðŸ”´ ONE-TIME CHECK HATA DIYA HAI. 
    // Apna setInterval wala wait function call karo jo 100% kaam karega.
    waitForPnrAndShowAnimation();
    
} else {
    sendResponse("Something went wrong: Unknown message type");
}
});

// ==============================================================================
// === PAGE-SPECIFIC AUTOMATION FUNCTIONS (SPEED OPTIMIZED) ===
// ==============================================================================


/**
 * Seat Availability Checker - Isse Review Booking se pehle check karenge
 */
async function checkSeatAvailability() {
    console.log("ðŸ” LEXUS: Checking seat availability status...");

    // IRCTC ke CSS classes (HTML ke hisaab se adapt karna)
    // IRCTC mein availability status aksar span ya div mein hoti hai
    const avlStatus = document.querySelector(".avl-status")?.innerText.toUpperCase() || "";
    
    // Agar seat AVAILABLE nahi hai
    if (avlStatus.includes("NOT AVAILABLE") || avlStatus.includes("WAITING") || avlStatus.includes("WL")) {
        console.warn("âš ï¸ Seat not available. Status:", avlStatus);
        
        return new Promise((resolve) => {
            showCustomConfirm(
                `Seat status is: ${avlStatus}. Do you still want to proceed with booking?`,
                () => { 
                    console.log("âœ... User wants to proceed anyway.");
                    resolve(true); // YES: Proceed
                },
                () => { 
                    console.log("âŒ User cancelled.");
                    showCustomAlert("Booking cancelled by user.");
                    window.location.href = "https://www.irctc.co.in/nget/train-search"; 
                    resolve(false); // NO: Cancel
                }
            );
        });
    }
    return true; // Seat available hai, proceed karo
}



async function proceedAfterFareCheck() {
    const lexusReview = document.querySelector("app-review-booking");
    if (lexusReview) {
        const captcha = lexusReview.querySelector("#captcha");
        if (getCaptchaBase64Content() || (captcha && captcha.getClientRects().length > 0)) {
            captcha?.focus();
            console.log("LEXUS: Review CAPTCHA requires manual completion.");
            return;
        }
        await submitContinueWithoutCaptcha();
        return;
    }
    document.querySelector("#captcha")?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (user_data.other_preferences.autoCaptcha) {
        captchaRetry = 0;
        setTimeout(getCaptchaTC, 200);
    } else {
        const captchaInput = document.querySelector("#captcha");
        // Manual: captcha dikha to focus; nahi dikha aur auto-submit ON ho to Continue
        if (getCaptchaBase64Content()) {
            if (captchaInput) {
                // Headless mode leaves CAPTCHA entry to the user.
                captchaInput.focus();
            }
        } else if (user_data?.other_preferences?.CaptchaSubmitMode === "A") {
            setTimeout(() => submitContinueWithoutCaptcha(), 400);
        } else if (captchaInput) {
            captchaInput.focus();
        }
    }
}



function removeLexusBanner() {
    const banner = document.getElementById("lexus-wait-banner");
    if (banner) {
        banner.remove();
        console.log("LEXUS: Banner removed successfully.");
    }
}

// à¤¯à¤¹ à¤†à¤ªà¤•à¥‡ content_script.js à¤®à¥‡à¤‚ à¤ - à¥à¤²à¥‹à¤¬à¤² à¤µà¥‡à¤°à¤¿à¤à¤¬à¤²à¥à¤¸ à¤•à¥‡ à¤¸à¤¾à¤¥ à¤¹à¥‹à¤¨à¤¾ à¤šà¤¾à¤¹à¤¿à¤
// à¤¯à¤¹ à¤†à¤ªà¤•à¥‡ content_script.js à¤®à¥‡à¤‚ à¤ - à¥à¤²à¥‹à¤¬à¤² à¤µà¥‡à¤°à¤¿à¤à¤¬à¤²à¥à¤¸ à¤•à¥‡ à¤¸à¤¾à¤¥ à¤¹à¥‹à¤¨à¤¾ à¤šà¤¾à¤¹à¤¿à¤
// === SLOW-MODE ENABLED getCaptchaTC (drop-in replacement) ===
// ============================================================
// 1. HELPER: Debugger Enter Key (No Text Clearing)
// ============================================================
function debuggerEnter() {
    return new Promise((resolve) => {
        // Send message to background.js to trigger Input.dispatchKeyEvent
        chrome.runtime.sendMessage({
            type: "DEBUGGER_ENTER"
        }, (response) => {
            if (response && response.success) {
                console.log("LEXUS: Debugger Enter Success");
                resolve();
            } else {
                console.warn("Debugger Enter failed, using JS Fallback");
                // Fallback: JS Dispatch Event
                const event = new KeyboardEvent('keydown', {
                    bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13
                });
                document.activeElement.dispatchEvent(event);
                resolve();
            }
        });
    });
}

// ============================================================
// 2. MAIN CAPTCHA FUNCTION (Updated  -  optional captcha support)
// IRCTC kabhi captcha dikhata hai, kabhi nahi.
// Base64 mila (1 check) -> server solve -> fill -> submit
// Base64 nahi mila -> turant Continue / Submit
// ============================================================
let captchaRetry = 0;

/** Valid captcha base64 extract  -  nahi mila to null */
function getCaptchaBase64Content() {
    const captchaImgEl = document.querySelector(".captcha-img");
    if (!captchaImgEl?.src) return null;

    const src = captchaImgEl.src.trim();
    // IRCTC captcha = data:image/...;base64,XXXX
    if (!src.startsWith("data:image") || src.length < 100) return null;

    const commaIdx = src.indexOf(",");
    if (commaIdx === -1) return null;

    const b64 = src.slice(commaIdx + 1);
    return b64.length > 20 ? b64 : null;
}

/** Captcha ke bina Continue / Sign-in submit */
async function submitContinueWithoutCaptcha() {
    console.log("ðŸš€ LEXUS: Captcha base64 nahi mila  -  direct Continue/Submit...");

    if (!document.querySelector("app-review-booking") && user_data?.other_preferences?.CaptchaSubmitMode !== "A") {
        console.log("LEXUS: Auto Submit OFF  -  user khud Continue karega.");
        return;
    }

    // --- LOGIN PAGE ---
    const loginApp = document.querySelector("#divMain > app-login") || document.querySelector("app-login");
    if (loginApp) {
        if (isManualLoginEnabled()) {
            console.log("LEXUS: Manual login ON — Sign In user karega.");
            return;
        }
        const userIn = loginApp.querySelector("input[formcontrolname='userid']");
        const passIn = loginApp.querySelector("input[formcontrolname='password']");
        if (userIn?.value && passIn?.value) {
            const signInBtn =
                loginApp.querySelector('button[class="search_btn train_Search train_Search_custom_hover"]') ||
                [...loginApp.querySelectorAll("button")].find((b) =>
                    /sign\s*in|login|submit/i.test(b.innerText || "")
                );
            if (signInBtn) {
                signInBtn.removeAttribute("disabled");
                signInBtn.classList.remove("disable-book");
                const btnId = "lexus-no-captcha-signin";
                signInBtn.setAttribute("id", btnId);
                console.log("LEXUS: Login  -  Sign In click (no captcha)...");
                await debuggerClick(`#${btnId}`);
                return;
            }
            console.log("LEXUS: Login  -  Enter press (no captcha)...");
            (userIn || passIn).focus();
            await debuggerEnter();
            return;
        }
    }

    // --- REVIEW PAGE ---
    const reviewPage =
        document.querySelector("#divMain > div > app-review-booking") ||
        document.querySelector("app-review-booking");

    if (reviewPage) {
        const seatsAvailable = document.querySelector(".AVAILABLE");
        if (user_data?.other_preferences?.confirmberths && !seatsAvailable) {
            console.warn("âš ï¸ Seats not available, showing confirmation...");
            return showCustomConfirm(
                "Seat  NOT AVAILABLE. Do you still want to proceed with booking?",
                async () => {
                    console.log("LEXUS: User opted to proceed despite seat status.");
                    await clickReviewContinue(reviewPage);
                },
                () => {
                    console.log("LEXUS: User cancelled booking.");
                    showCustomAlert("Booking cancelled by user.");
                }
            );
        }
        await clickReviewContinue(reviewPage);
        return;
    }

    console.warn("LEXUS: Login/Review page nahi mili  -  Continue skip.");
}

async function clickReviewContinue(reviewPage) {
    if (reviewPage.dataset.lexusContinueSent === "1") return;
    for (let attempt = 0; attempt < 60; attempt++) {
        if (!reviewPage.isConnected) return;
        const captcha = reviewPage.querySelector("#captcha");
        if (getCaptchaBase64Content() || (captcha && captcha.getClientRects().length > 0)) {
            captcha?.focus();
            return;
        }
        const continueBtn = Array.from(reviewPage.querySelectorAll("button")).find(button =>
            (button.innerText || button.textContent || "").trim().toUpperCase() === "CONTINUE" &&
            !button.disabled && button.getAttribute("aria-disabled") !== "true" && button.getClientRects().length > 0
        );
        if (continueBtn) {
            if (reviewPage.dataset.lexusContinueSent === "1") return;
            reviewPage.dataset.lexusContinueSent = "1";
            continueBtn.id = "lexus-review-continue";
            continueBtn.focus();
            try {
                await debuggerClick("#lexus-review-continue");
            } catch (error) {
                delete reviewPage.dataset.lexusContinueSent;
                console.warn("LEXUS: Review Continue click failed", error.message);
            }
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    console.warn("LEXUS: Review Continue not ready; manual action required.");
}


async function getCaptchaTC() {
    // A. Retry Limit Check (solve-loop ke liye)
    if (captchaRetry >= 100) {
        console.error("ðŸš¨ LEXUS: Captcha retry limit reached (100). Stopping loop.");
        return;
    }
    captchaRetry++;

    // ðŸ”´ 1. LOADER CHECK
    const irctcLoader = document.querySelector("#loaderP");
    const isLoaderVisible = irctcLoader && window.getComputedStyle(irctcLoader).display !== "none";

    if (isLoaderVisible) {
        console.log("â³ LEXUS: IRCTC Loader chal raha hai... 400ms wait.");
        setTimeout(getCaptchaTC, 400);
        return;
    }

    // B. Base64 check (1 baar)  -  mila to solve, nahi to turant Continue
    const imgContent = getCaptchaBase64Content();

    if (!imgContent) {
        console.log("LEXUS: Captcha base64 nahi mila  -  direct Continue...");
        captchaRetry = 0;
        await submitContinueWithoutCaptcha();
        return;
    }

    // â­ Base64 mil gaya -> solve flow
    captchaRetry = 0;
    console.log("âœ... LEXUS: Captcha base64 mil gayi! Server ko bhej rahe hain...");

    try {
        // C. API Call (Custom or Default)
        const useCustomApi =
            user_data?.true_captcha_credentials?.enabled &&
            user_data?.true_captcha_credentials?.userId &&
            user_data?.true_captcha_credentials?.apiKey;

        let response;

        if (useCustomApi) {
            console.log("LEXUS: Using Custom True Captcha API.");
            response = await fetch("https://api.apitruecaptcha.org/one/gettext", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    userid: user_data.true_captcha_credentials.userId,
                    apikey: user_data.true_captcha_credentials.apiKey,
                    data: imgContent
                })
            });
        } else {
            // No TrueCaptcha saved  -  don't call dead verifytool; manual / save settings
            console.warn("LEXUS: Captcha aayi lekin TrueCaptcha nahi  -  manual fill.");
            showOnScreenNotification(
                "Captcha aayi  -  Login tab me TrueCaptcha save karo, ya khud type karo",
                5000
            );
            const captchaIn = document.querySelector("#captcha");
            if (captchaIn) captchaIn.focus();
            return;
        }

        // D. Handle API Errors
        if (!response.ok) {
            if (response.status === 500) {
                console.error("Server Error. Refreshing...");
                showOnScreenNotification("Refreshing captcha...", 3000);
                const refreshBtn = document.querySelector("a > .glyphicon-repeat")?.parentElement;
                if (refreshBtn) await debuggerClick("a > .glyphicon-repeat");
                setTimeout(getCaptchaTC, 1000);
            } else if (response.status === 401) {
                showCustomAlert("Token Expired. Please restart booking.");
            } else if (response.status === 429) {
                showCustomAlert("Daily Limit Reached.");
            }
            return;
        }

        // E. Parse Result
        const data = await response.json();
        let captchaText = data?.result || "";

        if (!captchaText) {
            console.warn("Empty Result. Retrying...");
            const refreshBtn = document.querySelector("a > .glyphicon-repeat")?.parentElement;
            if (refreshBtn) await debuggerClick("a > .glyphicon-repeat");
            setTimeout(getCaptchaTC, 500);
            return;
        }

        // F. Sanitize Text
        let filteredText = "";
        const allowed = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789=@";
        for (const ch of String(captchaText).replace(/\s/g, "").replace(")", "J").replace("]", "J")) {
            if (allowed.includes(ch)) filteredText += ch;
        }

        if (!filteredText) {
            const refreshBtn = document.querySelector(".glyphicon.glyphicon-repeat")?.parentElement;
            if (refreshBtn) await debuggerClick(".glyphicon.glyphicon-repeat");
            setTimeout(getCaptchaTC, 500);
            return;
        }

        // G. FILL CAPTCHA
        const captchaSelector = "#captcha";
        const captchaIn = document.querySelector(captchaSelector);

        if (captchaIn) {
            console.log(`LEXUS: Filling Captcha '${filteredText}'...`);
            captchaIn.focus();
            await debuggerType(captchaSelector, filteredText);
        }

        // H. Error Observer (Valid Captcha check)
        const loginForm = document.querySelector("app-login");
        const reviewToast = document.querySelector("#divMain > div > app-review-booking > p-toast");

        const obsCallback = (_type, observer) => {
            console.log("Invalid Captcha detected. Retrying...");
            setTimeout(getCaptchaTC, 500);
            observer.disconnect();
        };

        const captchaErrObsTC = new MutationObserver((m, o) => {
            if (loginForm?.innerText.toLowerCase().includes("valid captcha")) obsCallback("login", o);
            if (reviewToast?.innerText.toLowerCase().includes("valid captcha")) obsCallback("review", o);
        });

        if (loginForm) captchaErrObsTC.observe(loginForm, { childList: true, subtree: true });
        if (reviewToast) captchaErrObsTC.observe(reviewToast, { childList: true, subtree: true });

        // I. AUTO SUBMIT (captcha filled)
        if (user_data?.other_preferences?.CaptchaSubmitMode === "A") {
            const loginApp = document.querySelector("#divMain > app-login");
            if (loginApp && !isManualLoginEnabled()) {
                const userIn = loginApp.querySelector("input[formcontrolname='userid']");
                const passIn = loginApp.querySelector("input[formcontrolname='password']");

                if (userIn?.value && passIn?.value && captchaIn?.value) {
                    setTimeout(async () => {
                        console.log("LEXUS: Submitting Login (Enter)...");
                        captchaIn.focus();
                        await debuggerEnter();
                    }, 200);
                }
            }

            const reviewPage = document.querySelector("#divMain > div > app-review-booking");
            if (reviewPage && captchaIn?.value) {
                const seatsAvailable = document.querySelector(".AVAILABLE");

                if (user_data?.other_preferences?.confirmberths && !seatsAvailable) {
                    console.warn("âš ï¸ Seats not available, showing confirmation to user...");
                    return showCustomConfirm(
                        "Seat  NOT AVAILABLE. Do you still want to proceed with booking?",
                        async () => {
                            console.log("LEXUS: User opted to proceed despite seat status.");
                            setTimeout(async () => {
                                captchaIn.focus();
                                await debuggerEnter();
                            }, 200);
                        },
                        () => {
                            console.log("LEXUS: User cancelled booking.");
                            showCustomAlert("Booking cancelled by user.");
                        }
                    );
                }
                setTimeout(async () => {
                    console.log("LEXUS: Submitting Review (Enter)...");
                    captchaIn.focus();
                    await debuggerEnter();
                }, 200);
            }
        }
    } catch (error) {
        console.error("Captcha Error:", error);
        showCustomAlert("Network Error in Captcha. Check internet.");
    }
}





async function loadLoginDetails() {
    if (window.__LEXUS_LOGIN_FILLING__) {
        lexusLog('loadLoginDetails already running  -  skip');
        return;
    }
    window.__LEXUS_LOGIN_FILLING__ = true;
    lexusSetLoginPhase('filling', 'loadLoginDetails');
    statusUpdate('loadLoginDetails');
    lexusLog('Filling login (verify click/fill)...');

    const userIdSelector = "app-login input[formcontrolname='userid'], input[formcontrolname='userid'], #userid, input[formcontrolname='userId']";
    const passwordSelector = "app-login input[formcontrolname='password'], input[formcontrolname='password'], #password";

    try {
        if (!isLoginFormOpen()) {
            lexusLog('login form not open  -  abort fill', 'error');
            window.__LEXUS_LOGIN_FILLING__ = false;
            lexusSetLoginPhase('idle', 'form missing');
            return;
        }

        const userName = (user_data.irctc_credentials && user_data.irctc_credentials.user_name) || "";
        const password = (user_data.irctc_credentials && user_data.irctc_credentials.password) || "";
        const manualLogin = isManualLoginEnabled();
        if (!userName || (!manualLogin && !password)) {
            lexusLog(manualLogin ? 'username empty  -  save Login profile' : 'credentials empty  -  save Login profile', 'error');
            window.__LEXUS_LOGIN_FILLING__ = false;
            return;
        }

        const userEl = document.querySelector(userIdSelector);
        const passEl = document.querySelector(passwordSelector);
        if (!userEl || (!manualLogin && !passEl)) {
            lexusLog('userid/password inputs not found', 'error');
            window.__LEXUS_LOGIN_FILLING__ = false;
            return;
        }
        const userSel = markTempId(userEl, "lexus-nget-user");

        const userOk = await lexusVerifyFill(userSel, userName, 'username');
        if (!userOk) {
            lexusLog('username fill verify failed', 'error');
            window.__LEXUS_LOGIN_FILLING__ = false;
            return;
        }

        if (manualLogin) {
            lexusSetLoginPhase('manual_wait', 'manual login');
            lexusPanelStatus('Fill pass aur SIGN IN dabao  -  Pass: ' + password);
            startLoginSuccessWatcher();
            return;
        }

        const passSel = markTempId(passEl, "lexus-nget-pass");
        await new Promise((r) => setTimeout(r, 200));
        const passOk = await lexusVerifyFill(passSel, password, 'password');
        if (!passOk) {
            lexusLog('fill verify failed  -  not clicking SIGN IN', 'error');
            window.__LEXUS_LOGIN_FILLING__ = false;
            return;
        }
        await new Promise((r) => setTimeout(r, 300));

        if (!isLoginFormOpen()) {
            lexusLog('form closed during fill  -  abort SIGN IN', 'error');
            window.__LEXUS_LOGIN_FILLING__ = false;
            lexusSetLoginPhase('idle', 'form closed mid-fill');
            return;
        }

        const signInBtn = findClassicSignInBtn();
        if (!signInBtn) {
            lexusLog('SIGN IN button not found', 'error');
            window.__LEXUS_LOGIN_FILLING__ = false;
            return;
        }
        signInBtn.removeAttribute("disabled");
        signInBtn.classList.remove("disable-book");
        const signed = await lexusVerifyClick(signInBtn, 'SIGN IN');
        if (!signed) {
            window.__LEXUS_LOGIN_FILLING__ = false;
            return;
        }

        startLoginSuccessWatcher();

    } catch (error) {
        window.__LEXUS_LOGIN_FILLING__ = false;
        lexusLog('loadLoginDetails error: ' + (error && error.message ? error.message : error), 'error');
        console.error("[LEXUS nget] loadLoginDetails error:", error);
    }
}

async function loadJourneyDetails() {
    statusUpdate('loadJourneyDetails');
    console.log("LEXUS: Filling journey details via Debugger API (Date First Priority)...");

    // --- Selectors ---
    const dateInputSelector = "app-jp-input form p-calendar[id='jDate'] input"; // à¤¤à¤¾à¤°à¥€à¤–
    const nextMonthBtnSelector = "a.ui-datepicker-next"; // à¤...à¤ - à¤²à¤¾ à¤®à¤¹à¥€à¤¨à¤¾
    
    const fromInputSelector = "app-jp-input form p-autocomplete[id='origin'] input";
    const toInputSelector = "app-jp-input form p-autocomplete[id='destination'] input";
    
    const classDropdownSelector = "#journeyClass div[role='button']";
    const quotaDropdownSelector = "#journeyQuota div[role='button']";
    const searchBtnSelector = "app-jp-input form button.search_btn.train_Search[type='submit']";

    try {
        // ============================================================
        

        // ============================================================
        // STEP 2: STATIONS (à¤‰à¤¸à¤•à¥‡ à¤¬à¤¾à¤¦ à¤¸à¥à¤Ÿà¥‡à¤¶à¤¨ à¤­à¤°à¥‡à¤‚)
        // ============================================================
        
        // STEP 2: STATIONS (From aur To Station fill karna)
        // ============================================================
        
        // Yeh chhota sa function full name se sirf code nikalega (e.g. "BARDDHAMAN JN - BWN" -> "BWN")
        const extractStationCode = (stationString) => {
            if (!stationString) return "";
            const s = String(stationString).trim();
            if (!s) return "";
            // Prefer trailing code: "SURAT - ST" → ST (not SURAT)
            let m = s.match(/\s*[-–—]\s*([A-Z0-9]{2,5})\s*$/i);
            if (m) return m[1].toUpperCase();
            m = s.match(/\(([A-Z0-9]{2,5})\)\s*$/i);
            if (m) return m[1].toUpperCase();
            const parts = s.split(/[-–—]/);
            if (parts.length > 1) {
                const last = parts[parts.length - 1].trim();
                if (/^[A-Z0-9]{2,5}$/i.test(last)) return last.toUpperCase();
                return last;
            }
            return s;
        };

        // --- From Station ---
        console.log("Filling From Station Code...");
        const fromCodeOnly = extractStationCode(user_data.journey_details.from); // Sirf code nikala
        await debuggerType(fromInputSelector, fromCodeOnly);
        
        // Dropdown list khulne ka thoda intezaar karein
        await new Promise(r => setTimeout(r, 800)); 
        
        // Enter press karein taaki list se station proper select ho jaye
        await debuggerKeyPress("\r"); 
        
        // Agle step pe jaane se pehle UI ko settle hone dein
        await new Promise(r => setTimeout(r, 400));
        
       // --- To Station ---
        console.log("Filling To Station Code...");
        const toCodeOnly = extractStationCode(user_data.journey_details.destination); // Sirf code nikala
        await debuggerType(toInputSelector, toCodeOnly);
        
        // Dropdown list khulne ka thoda intezaar karein
        await new Promise(r => setTimeout(r, 600)); 
        
        // Enter press karein taaki list se station proper select ho jaye
        await debuggerKeyPress("\r"); 
        
        // Date par focus jaane se pehle thoda intezaar karein
        await new Promise(r => setTimeout(r, 600));

        // STEP 1: DATE SELECTION (à¤¸à¤¬à¤¸à¥‡ à¤ªà¤¹à¤²à¥‡ à¤¤à¤¾à¤°à¥€à¤– à¤šà¥à¤¨à¥‡à¤‚)
        // ============================================================
        console.log("LEXUS: Priority Step - Selecting Date via Calendar Click...");
        
        // A. Parse Target Date
        const targetDate = new Date(user_data.journey_details.date);
        const targetDay = targetDate.getDate(); 
        const targetMonthIndex = targetDate.getMonth(); 
        const targetYear = targetDate.getFullYear();
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        
        // B. Open Calendar
        await debuggerClick(dateInputSelector);
        await new Promise(r => setTimeout(r, 600)); // à¤•à¥ˆà¤²à¥‡à¤‚à¤¡à¤° à¤–à¥à¤²à¤¨à¥‡ à¤•à¤¾ à¤‡à¤‚à¤¤à¤œà¤¾à¤°

        // C. Navigate Month/Year
        let maxRetries = 12; 
        let monthMatched = false;

        while (maxRetries > 0) {
            const displayedMonthStr = document.querySelector('.ui-datepicker-month')?.innerText?.trim();
            const displayedYearStr = document.querySelector('.ui-datepicker-year')?.innerText?.trim();
            
            if (!displayedMonthStr || !displayedYearStr) break;

            const displayedMonthIndex = monthNames.findIndex(m => m.toUpperCase() === displayedMonthStr.toUpperCase());
            const displayedYear = parseInt(displayedYearStr);

            if (displayedYear === targetYear && displayedMonthIndex === targetMonthIndex) {
                monthMatched = true;
                break; 
            }

            // Next Click
            await debuggerClick(nextMonthBtnSelector);
            await new Promise(r => setTimeout(r, 300));
            maxRetries--;
        }

        if (monthMatched) {
            // D. Click Specific Day
            let daySelector = null;
            const rows = document.querySelectorAll('.ui-datepicker-calendar tbody tr');
            
            rows.forEach((tr, rIndex) => {
                const cells = tr.querySelectorAll('td');
                cells.forEach((td, cIndex) => {
                    const aTag = td.querySelector('a');
                    if (aTag && parseInt(aTag.innerText) === targetDay) {
                        daySelector = `.ui-datepicker-calendar tbody tr:nth-child(${rIndex + 1}) td:nth-child(${cIndex + 1}) a`;
                    }
                });
            });

            if (daySelector) {
                console.log(`Day found! Clicking selector: ${daySelector}`);
                await debuggerClick(daySelector);
            } else {
                console.error("LEXUS: Day not found in calendar!");
            }
        }
        
        await new Promise(r => setTimeout(r, 500)); // à¤¤à¤¾à¤°à¥€à¤– à¤šà¥à¤¨à¤¨à¥‡ à¤•à¥‡ à¤¬à¤¾à¤¦ à¤¥à¥‹à¤¡à¤¼à¤¾ à¤°à¥à¤•à¥‡à¤‚

        // ============================================================
        // STEP 3: DROPDOWNS (à¤«à¤¿à¤° à¤•à¥à¤²à¤¾à¤¸ à¤”à¤° à¤•à¥‹à¤Ÿà¤¾)
        // ============================================================

        // --- 1. Class Selection ---
        await debuggerClick(classDropdownSelector);
        await new Promise(r => setTimeout(r, 500)); // à¤¡à¥à¤°à¥‰à¤ªà¤¡à¤¾à¤‰à¤¨ à¤–à¥à¤²à¤¨à¥‡ à¤•à¤¾ à¤‡à¤‚à¤¤à¤œà¤¾à¤°
        
        const className = classTranslator(user_data.journey_details.class);
        
        // à¤¸à¤­à¥€ à¤–à¥à¤²à¥‡ à¤¹à¥à¤ à¤‘à¤ªà¥à¤¶à¤¨à¥à¤¸ à¤®à¥‡à¤‚ à¤¸à¥‡ à¤...à¤ªà¤¨à¤¾ à¤•à¥à¤²à¤¾à¤¸ à¤¢à¥‚à¤‚à¤¢à¥‡à¤‚
        const classElements = Array.from(document.querySelectorAll("p-dropdownitem li[role='option'], li[role='option']"));
        const targetClassEl = classElements.find(el => el.innerText.trim().includes(className));
        
        if (targetClassEl) {
            // à¤‰à¤¸ à¤à¤²à¤¿à¤®à¥‡à¤‚à¤Ÿ à¤•à¥‹ à¤à¤• à¤¯à¥‚à¤¨à¤¿à¤• ID à¤¦à¥‡à¤‚ à¤”à¤° à¤‰à¤¸ à¤ªà¤° à¤•à¥à¤²à¤¿à¤• à¤•à¤°à¥‡à¤‚
            const classBtnId = "lexus-class-opt-final";
            targetClassEl.setAttribute("id", classBtnId);
            await debuggerClick(`#${classBtnId}`);
        } else {
            console.error(`LEXUS: Class '${className}' à¤²à¤¿à¤¸à¥à¤Ÿ à¤®à¥‡à¤‚ à¤¨à¤¹à¥€à¤‚ à¤®à¤¿à¤²à¥€!`);
        }
        await new Promise(r => setTimeout(r, 300));

        // --- 2. Quota Selection ---
        await debuggerClick(quotaDropdownSelector);
        await new Promise(r => setTimeout(r, 500)); // à¤¡à¥à¤°à¥‰à¤ªà¤¡à¤¾à¤‰à¤¨ à¤–à¥à¤²à¤¨à¥‡ à¤•à¤¾ à¤‡à¤‚à¤¤à¤œà¤¾à¤°

        const quotaName = quotaTranslator(user_data.journey_details.quota);
        
        // à¤¸à¤­à¥€ à¤–à¥à¤²à¥‡ à¤¹à¥à¤ à¤‘à¤ªà¥à¤¶à¤¨à¥à¤¸ à¤®à¥‡à¤‚ à¤¸à¥‡ à¤...à¤ªà¤¨à¤¾ à¤•à¥‹à¤Ÿà¤¾ à¤¢à¥‚à¤‚à¤¢à¥‡à¤‚
        const quotaElements = Array.from(document.querySelectorAll("p-dropdownitem li[role='option'], li[role='option']"));
        const targetQuotaEl = quotaElements.find(el => el.innerText.trim().includes(quotaName));
        
        if (targetQuotaEl) {
            // à¤‰à¤¸ à¤à¤²à¤¿à¤®à¥‡à¤‚à¤Ÿ à¤•à¥‹ à¤à¤• à¤¯à¥‚à¤¨à¤¿à¤• ID à¤¦à¥‡à¤‚ à¤”à¤° à¤‰à¤¸ à¤ªà¤° à¤•à¥à¤²à¤¿à¤• à¤•à¤°à¥‡à¤‚
            const quotaBtnId = "lexus-quota-opt-final";
            targetQuotaEl.setAttribute("id", quotaBtnId);
            await debuggerClick(`#${quotaBtnId}`);
        } else {
            console.error(`LEXUS: Quota '${quotaName}' à¤²à¤¿à¤¸à¥à¤Ÿ à¤®à¥‡à¤‚ à¤¨à¤¹à¥€à¤‚ à¤®à¤¿à¤²à¤¾!`);
        }
        await new Promise(r => setTimeout(r, 300));

        // ============================================================
        // STEP 4: SEARCH (à¤...à¤‚à¤¤ à¤®à¥‡à¤‚ à¤¸à¤°à¥à¤š)
        // ============================================================
        console.log("LEXUS: Clicking Search Button...");
        await debuggerClick(searchBtnSelector);

        console.log("LEXUS: Journey details filled and search initiated.");

    } catch (error) {
        console.error("LEXUS: Error in loadJourneyDetails via Debugger:", error);
    }
}
// retrySelectJourney à¤«à¤‚à¤•à¥à¤¶à¤¨ à¤®à¥‡à¤‚ à¤•à¥‹à¤ˆ à¤¬à¤¦à¤²à¤¾à¤µ à¤¨à¤¹à¥€à¤‚ à¤¹à¥ˆ
function retrySelectJourney() {
    console.log("ðŸ”„ à¤•à¥à¤› à¤ - à¤¡à¤¼à¤¬à¤¡à¤¼ à¤¹à¥à¤ˆ (High Load/Error), 400ms à¤®à¥‡à¤‚ à¤«à¤¿à¤° à¤¸à¥‡ à¤•à¥‹à¤¶à¤¿à¤¶ à¤•à¤° à¤°à¤¹à¥‡ à¤¹à¥ˆà¤‚...");
    setTimeout(selectJourney, 300); // Thoda time badha diya taki popup aaram se close ho jaye
}

// selectJourney à¤«à¤‚à¤•à¥à¤¶à¤¨ à¤...à¤¬ async à¤¹à¥ˆ
async function selectJourney() {
    removeLexusBanner();
    statusUpdate('train-list');
    console.log("selectJourney à¤¶à¥à¤°à¥‚ à¤¹à¥à¤†...");
    const isSlowMode = user_data.other_preferences.useSlowMode;

    // --- à¤¸à¥à¤Ÿà¥‡à¤ª 1: à¤œà¤¾à¤¨à¤•à¤¾à¤°à¥€ à¤¤à¥ˆà¤¯à¤¾à¤° à¤•à¤°à¤¨à¤¾ ---
    if (!user_data?.journey_details?.["train-no"]) return console.error("à¤Ÿà¥à¤°à¥‡à¤¨ à¤¨à¤‚à¤¬à¤° à¤‰à¤ªà¤²à¤¬à¥à¤§ à¤¨à¤¹à¥€à¤‚ à¤¹à¥ˆà¥¤");
    const parentList = document.querySelector("#divMain > div > app-train-list");
    if (!parentList) return retrySelectJourney();
    
    const allTrains = Array.from(parentList.querySelectorAll(".tbis-div app-train-avl-enq"));
    const trainNo = user_data.journey_details["train-no"];
    const className = classTranslator(user_data.journey_details.class);
    const matchingTrain = allTrains.find(el => el.querySelector("div.train-heading")?.innerText.trim().includes(trainNo.split("-")[0]));
    
    if (!matchingTrain) return console.error("à¤¦à¥€ à¤ - à¤ˆ à¤Ÿà¥à¤°à¥‡à¤¨ à¤¨à¤‚à¤¬à¤° à¤²à¤¿à¤¸à¥à¤Ÿ à¤®à¥‡à¤‚ à¤¨à¤¹à¥€à¤‚ à¤®à¤¿à¤²à¥€à¥¤");

    // --- à¤¸à¥à¤Ÿà¥‡à¤ª 2: à¤•à¥à¤²à¤¾à¤¸ à¤Ÿà¥ˆà¤¬ à¤¢à¥‚à¤‚à¤¢à¤¨à¤¾ ---
    const classTabAsDiv = Array.from(matchingTrain.querySelectorAll("table tr td div.pre-avl")).find(el => el.querySelector("div").innerText.trim() === className);
    const classTabAsSpan = Array.from(matchingTrain.querySelectorAll("span")).find(el => el.innerText.trim() === className);
    const classTab = classTabAsDiv || classTabAsSpan;
    if (!classTab) return retrySelectJourney();

    // --- à¤¸à¥à¤Ÿà¥‡à¤ª 3: à¤•à¥à¤²à¤¾à¤¸ à¤ªà¤° à¤•à¥à¤²à¤¿à¤• à¤•à¤°à¥‡à¤‚ ---
    console.log(`âœ... à¤•à¥à¤²à¤¾à¤¸ à¤ªà¤° à¤•à¥à¤²à¤¿à¤• à¤•à¤¿à¤¯à¤¾: ${className}.`);
    isSlowMode ? await slowClick(classTab) : fastClick(classTab);

    // ====================================================================
    // ðŸ”´ NAYA CODE: HIGH LOAD CATCHER (Class Click ke theek baad) ðŸ”´
    // ====================================================================
    const highLoadCatcher = new MutationObserver((mutations, obs) => {
        const toast = document.querySelector('.ui-toast-detail, .ui-toast-message-text-content');
        if (toast) {
            const errText = toast.innerText.toLowerCase();
            
            // YAHAN NAYE TEXT ADD KIYE GAYE HAIN ðŸ‘‡
            if (errText.includes("high load") || 
                errText.includes("please retry") || 
                errText.includes("unable to process request") ||
                errText.includes("Unable to perform this transaction. Please try again") ||
                errText.includes("Please try again") || 
                errText.includes("client ip")) {
                
                console.warn("ðŸš¨ LEXUS: Error pakda gaya (Class Click ke baad)! Retry kar rahe hain...");
                
                obs.disconnect(); // Is catcher ko band karein
                mainObserver.disconnect(); // Niche wale Date observer ko bhi rokein taki wo wait na kare
                
                // Popup clear karein
                const closeBtn = document.querySelector('.ui-toast-close-icon');
                if (closeBtn) closeBtn.click();
                
                retrySelectJourney(); // Wapas retry marein
            }
        }
    });
    // Isko poore body par chalayein taki toast pakad sake
    highLoadCatcher.observe(document.body, { childList: true, subtree: true });
    // ====================================================================

    // --- à¤¸à¥à¤Ÿà¥‡à¤ª 4: à¤¤à¤¾à¤°à¥€à¤– à¤¢à¥‚à¤‚à¤¢à¤¨à¤¾ à¤”à¤° à¤•à¥à¤²à¤¿à¤• à¤•à¤°à¤¨à¤¾ ---
    let classLoaderFinished = false;
    const mainObserver = new MutationObserver(async (mutations, observer) => {
        const loader = document.querySelector("#loaderP");
        const isLoaderVisible = loader && window.getComputedStyle(loader).display !== "none";

        if (!isLoaderVisible && !classLoaderFinished) {
            classLoaderFinished = true;
        }

        if (classLoaderFinished) {
            const journeyDate = new Date(user_data.journey_details.date);
            const dateString = journeyDate.toDateString().split(" ")[0] + ", " + journeyDate.toDateString().split(" ")[2] + " " + journeyDate.toDateString().split(" ")[1];
            const targetDateCell = Array.from(matchingTrain.querySelectorAll("div div table td div.pre-avl")).find(el => el.querySelector("div").innerText.trim() === dateString);

            if (targetDateCell) {
                observer.disconnect(); // Date observer band kiya
                
                // ðŸ”´ NAYA CODE: Date mil gayi, yani High Load nahi aaya. Catcher ko band kardo. ðŸ”´
                highLoadCatcher.disconnect(); 

                // --- à¤¤à¤¾à¤°à¥€à¤– à¤ªà¤° à¤•à¥à¤²à¤¿à¤• ---
                console.log(`à¤¤à¤¾à¤°à¥€à¤– à¤®à¤¿à¤² à¤ - à¤ˆ: ${dateString}. à¤...à¤¬ à¤‡à¤¸ à¤ªà¤° à¤•à¥à¤²à¤¿à¤• à¤•à¤° à¤°à¤¹à¥‡ à¤¹à¥ˆà¤‚à¥¤`);
                isSlowMode ? await slowClick(targetDateCell) : fastClick(targetDateCell);
                
                // à¤...à¤ - à¤²à¥‡ à¤«à¤‚à¤•à¥à¤¶à¤¨ à¤•à¥‹ à¤•à¥‰à¤² à¤•à¤°à¥‡à¤‚
                await waitForLoaderAndBook(matchingTrain);
            }
        }
    });
    mainObserver.observe(matchingTrain, { childList: true, subtree: true, attributes: true, characterData: true });
}

// waitForLoaderAndBook à¤«à¤‚à¤•à¥à¤¶à¤¨ à¤...à¤¬ async à¤¹à¥ˆ
async function waitForLoaderAndBook(trainElement) {
    console.log("'à¤¬à¥à¤• à¤¨à¤¾à¤‰' à¤¬à¤Ÿà¤¨ à¤•à¥‡ à¤²à¤¿à¤ à¤²à¥‹à¤¡à¤° à¤¹à¤Ÿà¤¨à¥‡ à¤•à¤¾ à¤‡à¤‚à¤¤à¤œà¤¼à¤¾à¤°...");
    
    // Yahan loaderObserver pehle se hi document.body par hai, isliye isme sidha toast check daal diya hai.
    const loaderObserver = new MutationObserver(async (mutations, observer) => {
        
        // ====================================================================
        // ðŸ”´ NAYA CODE: Date click karne ke baad High Load check ðŸ”´
        // ====================================================================
        const toast = document.querySelector('.ui-toast-detail, .ui-toast-message-text-content');
        if (toast) {
            const errText = toast.innerText.toLowerCase();
            if (errText.includes("high load") || 
                errText.includes("please retry") || 
                errText.includes("unable to process request") ||
                errText.includes("Unable to perform this transaction. Please try again") ||
                errText.includes("Please try again") || 
                errText.includes("client ip")) {
                console.warn("ðŸš¨ LEXUS: High Load pakda gaya (Date Click ke baad)! Retry kar rahe hain...");
                
                observer.disconnect(); // Is observer ko cancel karein
                
                const closeBtn = document.querySelector('.ui-toast-close-icon');
                if (closeBtn) closeBtn.click();
                
                retrySelectJourney(); // Shuru se wapas class click karein
                return; // Aage ka loader code run na ho
            }
        }
        // ====================================================================

        const loader = document.querySelector("#loaderP");
        const isVisible = (el) => el && window.getComputedStyle(el).display !== "none";
        
        if (!isVisible(loader)) {
            console.log("à¤¸à¤¿à¤ - à¥à¤¨à¤² à¤®à¤¿à¤²à¤¾! à¤...à¤¬ 'à¤¬à¥à¤• à¤¨à¤¾à¤‰' à¤ªà¤° à¤•à¥à¤²à¤¿à¤• à¤•à¤°à¤¨à¤¾ à¤¸à¥à¤°à¤•à¥à¤·à¤¿à¤¤ à¤¹à¥ˆà¥¤");
            observer.disconnect();
            await attemptClickBook(trainElement);
        }
    });
    loaderObserver.observe(document.body, { childList: true, subtree: true });
}

// attemptClickBook à¤«à¤‚à¤•à¥à¤¶à¤¨ (No changes needed here)
async function attemptClickBook(trainElement) {
    const bookButton = trainElement.querySelector("button.btnDefault.train_Search.ng-star-inserted");
    const isLoaderVisible = document.querySelector("#loaderP") && window.getComputedStyle(document.querySelector("#loaderP")).display !== "none";
    const isSlowMode = user_data.other_preferences.useSlowMode;

    if (isLoaderVisible || !bookButton || bookButton.disabled || bookButton.classList.contains('disable-book')) {
        console.error("âŒ 'à¤¬à¥à¤• à¤¨à¤¾à¤‰' à¤¬à¤Ÿà¤¨ à¤•à¥à¤²à¤¿à¤• à¤•à¥‡ à¤²à¤¿à¤ à¤¤à¥ˆà¤¯à¤¾à¤° à¤¨à¤¹à¥€à¤‚ à¤¹à¥ˆà¥¤ retry à¤¹à¥‹à¤ - à¤¾...");
        retrySelectJourney(); 
        return;
    }

    console.log("âœ... 'à¤¬à¥à¤• à¤¨à¤¾à¤‰' à¤¬à¤Ÿà¤¨ à¤ªà¤° à¤•à¥à¤²à¤¿à¤• à¤•à¤° à¤°à¤¹à¥‡ à¤¹à¥ˆà¤‚!");
    isSlowMode ? await slowClick(bookButton) : fastClick(bookButton);
}

// --- HELPER: Wait using JS Collection (Robust) ---
// ============================================================
// HELPER: Send Specific Key via Debugger
// ============================================================
// ============================================================
// HELPER: Send Specific Key via Debugger
// ============================================================
function debuggerKeyPress(keyStr) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({
            type: "DEBUGGER_KEY_PRESS",
            key: keyStr
        }, () => resolve());
    });
}

// ============================================================
// HELPER: Human Wait (Thinking Time)
// ============================================================
function humanThinkTime(min = 800, max = 1500) {
    const ms = Math.floor(Math.random() * (max - min + 1) + min);
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// HELPER: Wait for Element using JS
// ============================================================
function waitForInputReady(index) {
    return new Promise((resolve) => {
        let attempts = 0;
        const check = setInterval(() => {
            attempts++;
            const inputs = document.querySelectorAll("app-passenger p-autocomplete input");
            if (inputs[index] && inputs[index].offsetParent !== null) {
                clearInterval(check);
                resolve(inputs[index]);
            }
            if (attempts > 50) { clearInterval(check); resolve(null); }
        }, 200);
    });
}

async function fillPassengerDetails() {
    statusUpdate('fillPassengerDetails');
    console.log("LEXUS: Filling Passenger Details (Verified Direct Fill)...");

    const passengerApp = document.querySelector("app-passenger-input");
    if (!passengerApp) return console.error("âŒ Passenger app not found.");

    const addPassBtnSelector = "app-passenger-input .prenext"; 
    const passengers = user_data.passenger_details;

    // ============================================================
    // STEP 1: FILL SAVED PASSENGERS DIRECTLY
    // ============================================================
    for (let i = 0; i < passengers.length; i++) {
        const psgn = passengers[i];
        console.log(`\nðŸ‘¤ Passenger ${i + 1}: ${psgn.name}`);

        // --- A. ADD NEW FORM (If needed) ---
        if (i > 0) {
            console.log("  -> Adding new form...");
            const addBtn = document.querySelector(addPassBtnSelector);
            if (addBtn) {
                addBtn.scrollIntoView({ behavior: "smooth", block: "center" });
                await humanThinkTime(300, 600); 
                await debuggerClick(addPassBtnSelector);
            }
            
            // Wait for DOM to render input
            await waitForInputReady(i);
            // waitForInputReady already waits for the rendered passenger row.
        }

        // Fill saved passenger values in one operation, then verify website values.
        const nameIn = document.querySelectorAll("app-passenger p-autocomplete input")[i];
        const ageIn = document.querySelectorAll("app-passenger input[formcontrolname='passengerAge']")[i];
        const genderIn = document.querySelectorAll("app-passenger select[formcontrolname='passengerGender']")[i];
        if (!nameIn || !ageIn || !genderIn) { lexusLog('Passenger fields not ready', 'error'); return; }
        nameIn.id = `lexus-name-${i}`; ageIn.id = `lexus-age-${i}`;
        if (!await lexusDirectFill(nameIn, psgn.name)) {
            if (!await lexusVerifyFill(`#${nameIn.id}`, psgn.name, 'passenger name')) return;
        }
        if (!await lexusDirectFill(ageIn, String(psgn.age))) {
            if (!await lexusVerifyFill(`#${ageIn.id}`, String(psgn.age), 'passenger age')) return;
        }
        if (!await lexusSelectGender(genderIn, psgn.gender)) {
            lexusLog('Passenger gender selection did not match saved profile', 'error'); showOnScreenNotification('Check passenger gender: saved option was not found.', 8000); return;
        }

        // --- E. BERTH (Dropdown: Click -> Key -> Enter) ---
        const allBerths = document.querySelectorAll("app-passenger select[formcontrolname='passengerBerthChoice']");
        const berthIn = allBerths[i];
        
        if (berthIn && psgn.berth) {
            const berthId = `lexus-berth-${i}`;
            berthIn.setAttribute("id", berthId);
            
            await debuggerClick(`#${berthId}`);
            await humanThinkTime(400, 600);
            
            const berthKey = psgn.berth.charAt(0).toUpperCase();
            await debuggerKeyPress(berthKey);
            await debuggerKeyPress("\r");
        }

        // --- F. FOOD (Optional) ---
        try {
            const allFoods = document.querySelectorAll("app-passenger select[formcontrolname='passengerFoodChoice']");
            const foodIn = allFoods[i];
            if (foodIn && psgn.food) {
                const foodId = `lexus-food-${i}`;
                foodIn.setAttribute("id", foodId);
                await debuggerClick(`#${foodId}`);
                await humanThinkTime(200, 500);
                // "V" for Veg, "N" for Non-Veg usually work if text matches
                // Or just use JS fallback for this one specific if tricky
                foodIn.value = psgn.food;
                foodIn.dispatchEvent(new Event("change"));
            }
        } catch(e) {}

        // Next passenger waits for its own input readiness.
    }

    // ============================================================
    // STEP 2: PREFERENCES
    // ============================================================
    console.log("\nâš™ï¸ Filling Preferences...");

    // Mobile
    const mobileEl = document.querySelector("input#mobileNumber");
    if (mobileEl && user_data.other_preferences.mobileNumber) {
        if (!await lexusDirectFill(mobileEl, user_data.other_preferences.mobileNumber)) {
            if (!await lexusVerifyFill("input#mobileNumber", user_data.other_preferences.mobileNumber, 'mobile')) return;
        }
    }

    // Checkboxes
    const upgradeEl = document.querySelector("input#autoUpgradation");
    if (upgradeEl && user_data.other_preferences.autoUpgradation !== upgradeEl.checked) {
        await humanThinkTime(300, 600);
        await debuggerClick("input#autoUpgradation");
    }

    // CHECKBOX FIX: 'input' à¤•à¥‡ à¤¬à¤œà¤¾à¤¯ 'label' à¤ªà¤° à¤•à¥à¤²à¤¿à¤• à¤•à¤°à¥‡à¤‚
    const confirmEl = document.querySelector("input#confirmberths");
    // label à¤•à¥‹ à¤¢à¥‚à¤‚à¤¢à¥‡à¤‚ à¤œà¥‹ for="confirmberths" à¤•à¥‡ à¤¸à¤¾à¤¥ à¤œà¥à¤¡à¤¼à¤¾ à¤¹à¥ˆ
    const confirmLabel = document.querySelector("label[for='confirmberths']");

    if (confirmEl && user_data.other_preferences.confirmberths !== confirmEl.checked) {
        await humanThinkTime(300, 600);
        
        // à¤...à¤¬ input à¤•à¥‡ à¤¬à¤œà¤¾à¤¯ label à¤ªà¤° à¤•à¥à¤²à¤¿à¤• à¤•à¤°à¤µà¤¾à¤à¤‚
        console.log("ðŸ”´ [DEBUG] Clicking 'Confirm Berths' label...");
        await debuggerClick("label[for='confirmberths']");
    }

    // Payment Mode check
const payModeVal = user_data.other_preferences.paymentmethod.includes("UPI") ? "2" : "1";

// ðŸ”´ NAYA OPTIMIZATION: Agar sirf UPI ("2") chunenge tabhi click logic chalega, warna skip ho jayega
if (payModeVal === "2") {
    console.log("âš¡ UPI Mode detected. Selecting 2nd Radio button...");
    
    const radioWrappers = document.querySelectorAll("app-passenger-input p-radiobutton");
    let targetRadioIndex = -1;
    
    radioWrappers.forEach((el, idx) => {
        const inp = el.querySelector("input");
        if (inp && inp.value === "2") targetRadioIndex = idx;
    });

    if (targetRadioIndex !== -1) {
        const radioBox = document.querySelectorAll("app-passenger-input p-radiobutton .ui-radiobutton-box")[targetRadioIndex];
        if (radioBox) {
            radioBox.scrollIntoView({ behavior: "smooth", block: "center" });
            const radioId = "lexus-pay-radio";
            radioBox.setAttribute("id", radioId);
            await humanThinkTime(400, 800);
            await debuggerClick(`#${radioId}`);
        }
    }
} else {
    // Agar Card/Netbanking chunenge toh code seedha yahan aayega aur bina time gawaye aage badh jayega
    console.log("â© Card/Netbanking mode detected. IRCTC default is already '1'. Skipping click logic for speed!");
}

    
    
    
    
   
    
    


    
    
    // à¤¯à¤¹à¤¾à¤ à¤¹à¤®à¤¨à¥‡ à¤šà¥‡à¤• à¤•à¤¿à¤¯à¤¾: à¤•à¥à¤¯à¤¾ à¤¯à¥‚à¤œà¤¼à¤° à¤¨à¥‡ 'Submit Passenger page manually' à¤šà¥‡à¤• à¤•à¤¿à¤¯à¤¾ à¤¹à¥ˆ?
    const isManualSubmit = user_data.other_preferences.psgManual === true || user_data.other_preferences.psgManual === "true";

    if (isManualSubmit) {
        console.log("ðŸ”´ [DEBUG] Manual mode ON à¤¹à¥ˆà¥¤ à¤‘à¤Ÿà¥‹-à¤¸à¤¬à¤®à¤¿à¤Ÿ à¤•à¥‹ à¤°à¥‹à¤• à¤¦à¤¿à¤¯à¤¾ à¤ - à¤¯à¤¾ à¤¹à¥ˆà¥¤ à¤¯à¥‚à¤œà¤¼à¤° à¤–à¥à¤¦ à¤•à¥à¤²à¤¿à¤• à¤•à¤°à¥‡à¤ - à¤¾à¥¤");
        return; 
    }

    // LEXUS: verify rendered values, submit once and never retry server/IP errors.
    if (window.__lexusPassengerSubmitting || window.__lexusPassengerSubmitBlocked) return;
    const names = document.querySelectorAll("app-passenger p-autocomplete input");
    const ages = document.querySelectorAll("app-passenger input[formcontrolname='passengerAge']");
    const genders = document.querySelectorAll("app-passenger select[formcontrolname='passengerGender']");
    const normalizeGender = value => ({m:'male',male:'male',f:'female',female:'female',t:'transgender',transgender:'transgender',trans:'transgender'})[String(value || '').toLowerCase()];
    const valuesReady = passengers.every((p,i) => names[i]?.value === String(p.name) && ages[i]?.value === String(p.age) &&
        normalizeGender(p.gender) && (normalizeGender(genders[i]?.value) === normalizeGender(p.gender) || normalizeGender(genders[i]?.selectedOptions[0]?.textContent.trim()) === normalizeGender(p.gender)));
    if (!valuesReady) { showOnScreenNotification('Passenger values changed or are incomplete. Check the form before Continue.', 8000); return; }
    const invalid = Array.from(passengerApp.querySelectorAll('input[required],select[required]')).some(el => !el.disabled && isLexusVisible(el) && el.validity && !el.validity.valid);
    if (invalid) { showOnScreenNotification('Complete the required passenger fields before Continue.', 8000); return; }
    const continueBtn = getVisiblePassengerContinueBtn();
    if (!continueBtn || continueBtn.disabled || continueBtn.getAttribute('aria-disabled') === 'true') { showOnScreenNotification('Passenger Continue is not ready.', 8000); return; }
    window.__lexusPassengerSubmitting = true;
    continueBtn.id = 'lexus-psg-continue-btn';
    await new Promise(resolve => {
        let finished = false, timer;
        const finish = (reason, blocked = false) => {
            if (finished) return;
            finished = true; observer.disconnect(); clearTimeout(timer);
            window.__lexusPassengerSubmitting = false;
            if (blocked) window.__lexusPassengerSubmitBlocked = true;
            if (reason) { lexusLog(reason, blocked ? 'error' : 'info'); showOnScreenNotification(reason, 10000); }
            resolve();
        };
        const inspect = () => {
            const errors = Array.from(document.querySelectorAll('.ui-toast-detail,.ui-toast-message-text-content,.p-toast-detail,.p-toast-message-text-content,[role="alert"]'));
            if (errors.some(el => isLexusVisible(el) && /unable to process request|unable to perform this transaction|client ip|high load|please retry|please try again/i.test(el.innerText || el.textContent || ''))) {
                finish('IRCTC rejected Passenger Continue. Automatic retries stopped; check the site message.', true); return;
            }
            const review = document.querySelector('app-review-booking');
            if (review && isLexusVisible(review)) finish('Passenger Continue succeeded. Review page reached.');
        };
        const observer = new MutationObserver(inspect);
        observer.observe(document.body, {childList:true,subtree:true,characterData:true,attributes:true});
        timer = setTimeout(() => finish('Passenger Continue response was not confirmed. No automatic retry was sent.', true), 45000);
        inspect();
        if (!finished) debuggerClick('#lexus-psg-continue-btn',50,50).then(inspect).catch(() => finish('Passenger Continue click failed. Check the page manually.', true));
    });
}
// ==============================================================================
// === SCRIPT INITIALIZATION ===
// ==============================================================================

// ==================================================================
// --- Login phase + verify helpers (stops form open/close loop) ---
// ==================================================================
function lexusGetLoginPhase() {
    return window.__LEXUS_LOGIN_PHASE__ || 'idle';
}
function lexusSetLoginPhase(phase, why) {
    window.__LEXUS_LOGIN_PHASE__ = phase;
    lexusLog('phase=' + phase + (why ? ' (' + why + ')' : ''));
}
function isLoginFormOpen() {
    return Boolean(
        document.querySelector(
            "app-login input[formcontrolname='userid'], app-login input[formcontrolname='password'], app-login #userid, input[formcontrolname='userid']"
        )
    );
}
function lexusLoginUiBusy() {
    const p = lexusGetLoginPhase();
    return p === 'form_open' || p === 'filling' || p === 'signed_in_wait' || p === 'done' || isLoginFormOpen();
}
function lexusPanelStatus(msg) {
    const text = String(msg || '').trim();
    if (!text) return;
    try {
        if (typeof window.__lexusPushPanelStatus === 'function') {
            window.__lexusPushPanelStatus(text);
            return;
        }
    } catch (_) {}
    try {
        if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
            chrome.runtime.sendMessage(
                { id: 'irctc', msg: { type: 'panel_status', data: { text } }, sender: 'content_script' },
                () => {}
            );
        }
    } catch (_) {}
}
function lexusLog(msg, level) {
    const line = '[LEXUS nget] ' + msg;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
    lexusPanelStatus(msg);
}
async function lexusVerifyClick(el, label) {
    if (!el) {
        lexusLog('VERIFY click FAIL  -  missing: ' + label, 'error');
        return false;
    }
    const sel = markTempId(el, 'lexus-v-' + String(label || 'btn').replace(/\W+/g, '').slice(0, 12));
    lexusLog('VERIFY click -> ' + label + ' sel=' + sel);
    try {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        await debuggerClick(sel, 50, 55);
        try {
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        } catch (_) {}
        lexusLog('VERIFY click OK  -  ' + label);
        return true;
    } catch (e) {
        lexusLog('VERIFY click ERR  -  ' + label + ': ' + (e && e.message ? e.message : e), 'error');
        try {
            el.click();
            lexusLog('VERIFY click fallback DOM OK  -  ' + label, 'warn');
            return true;
        } catch (_) {
            lexusLog('VERIFY click FAIL  -  ' + label, 'error');
            return false;
        }
    }
}
async function lexusVerifyFill(selector, expected, label) {
    lexusLog('VERIFY fill -> ' + label);
    if (label === 'username' && await lexusDirectFill(selector, expected)) return true;
    await debuggerType(selector, expected);
    await new Promise((r) => setTimeout(r, 150));
    const el = document.querySelector(selector);
    const got = el ? String(el.value || '') : '';
    if (got === String(expected)) {
        lexusLog('VERIFY fill OK  -  ' + label + ' len=' + got.length);
        return true;
    }
    lexusLog('VERIFY fill mismatch  -  ' + label + ' gotLen=' + got.length + ' retry', 'warn');
    if (el) {
        try {
            el.focus();
            el.value = '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.value = expected;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
        } catch (_) {}
    }
    await debuggerType(selector, expected);
    await new Promise((r) => setTimeout(r, 200));
    const el2 = document.querySelector(selector);
    const got2 = el2 ? String(el2.value || '') : '';
    if (got2 === String(expected)) {
        lexusLog('VERIFY fill OK after retry  -  ' + label);
        return true;
    }
    lexusLog('VERIFY fill FAIL  -  ' + label, 'error');
    return false;
}
function lexusReadIrTokens() {
    try {
        return JSON.parse(localStorage.getItem('ir:tokens') || '{}');
    } catch (_) {
        return {};
    }
}

function lexusHasIrTokens() {
    const t = lexusReadIrTokens();
    return Boolean(t && t.access_token);
}

function lexusFirePostLoginOnce(reason) {
    if (window.__LEXUS_POST_LOGIN_FIRED__) {
        lexusLog('post-login already fired  -  skip (' + reason + ')');
        return;
    }
    try {
        Object.defineProperty(window, '__LEXUS_LOGIN_OK__', {
            value: true,
            writable: true,
            configurable: true,
            enumerable: false,
        });
    } catch (_) {
        window.__LEXUS_LOGIN_OK__ = true;
    }
    const startDirect = () => {
        if (!window.__LEXUS_DIRECT_BOOK__) return 'classic';
        if (window.__LEXUS_DIRECT_PIPELINE_DONE__) return 'done';
        if (typeof window.__lexusTryStartDirect === 'function') {
            window.__lexusTryStartDirect('post-login');
            return 'ok';
        }
        if (typeof window.__lexusStartDirectBook === 'function') {
            window.__lexusStartDirectBook();
            return 'ok';
        }
        return 'wait';
    };
    const finish = () => {
        window.__LEXUS_POST_LOGIN_FIRED__ = true;
        lexusSetLoginPhase('done', reason);
        lexusLog('post-login -> ' + reason);
        try {
            statusUpdate('directApiStart');
        } catch (_) {}
    };
    const mode = startDirect();
    if (mode === 'ok') {
        finish();
        return;
    }
    if (mode === 'classic') {
        finish();
        setTimeout(() => {
            if (typeof loadJourneyDetails === 'function') loadJourneyDetails();
        }, 400);
        return;
    }
    lexusLog('post-login waiting for Direct boot… (' + reason + ')');
    let tries = 0;
    const iv = setInterval(() => {
        tries++;
        const m = startDirect();
        if (m === 'ok') {
            clearInterval(iv);
            finish();
        } else if (m === 'classic' || tries > 40) {
            clearInterval(iv);
            if (tries > 40) lexusLog('Direct boot timeout', 'error');
        }
    }, 250);
}

function isLexusVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return r.width > 2 && r.height > 2 && style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
}

/** Dismiss IRCTC overlays that block LOGIN (beta banner, OK alerts, etc.). */
async function dismissIrctcBlockingOverlays() {
    if (lexusLoginUiBusy()) {
        lexusLog('skip overlays  -  login UI busy (' + lexusGetLoginPhase() + ')');
        return false;
    }
    let acted = false;

    // Beta explore strip / banner  -  close (X), never "Explore beta"
    const betaCloseCandidates = [
        ...document.querySelectorAll(
            'a, button, span, i, .fa-times, .glyphicon-remove, [aria-label="Close"], [aria-label="close"]'
        ),
    ];
    for (const el of betaCloseCandidates) {
        const root = el.closest('div, section, aside') || el.parentElement;
        const blob = (((root && root.innerText) || '') + ' ' + ((el.getAttribute && el.getAttribute('aria-label')) || '')).toLowerCase();
        if (!blob.includes('beta') && !blob.includes('explore the beta') && !blob.includes('new website')) {
            continue;
        }
        const isClose =
            /^(Ã - |x|âœ•|close)$/i.test(((el.innerText || el.textContent) || '').trim()) ||
            (el.className && /close|times|remove/i.test(String(el.className))) ||
            /close/i.test(el.getAttribute?.('aria-label') || '');
        if (!isClose && el.tagName !== 'I' && !/fa-times|glyphicon-remove/i.test(String(el.className || ''))) {
            continue;
        }
        try {
            const clickable = el.closest('a, button') || el;
            lexusLog('closing beta banner');
            clickable.click();
            acted = true;
            await new Promise((r) => setTimeout(r, 200));
            break;
        } catch (_) {}
    }

    // Generic alert OK (not language English, not login dialog)
    for (const dialog of document.querySelectorAll('div.ui-dialog[role="dialog"], div[role="dialog"], .ui-dialog')) {
        if (dialog.querySelector('app-login, input[formcontrolname="userid"]')) continue;
        const t = ((dialog.innerText || '') + '').toLowerCase();
        if (t.includes('preferred language') || t.includes('welcome to irctc')) continue;
        if (t.includes('user id') || t.includes('password') || t.includes('sign in')) continue;
        const ok = [...dialog.querySelectorAll('button')].find((b) =>
            /^(ok|okay|continue|close)$/i.test(((b.innerText || '') + '').trim())
        );
        if (ok && isLexusVisible(ok)) {
            try {
                await lexusVerifyClick(ok, 'alert-ok');
                acted = true;
                await new Promise((r) => setTimeout(r, 200));
            } catch (_) {
                try { ok.click(); acted = true; } catch (__) {}
            }
        }
    }

    try {
        if (await clickLanguagePreferencePopup()) acted = true;
    } catch (_) {}

    return acted;
}

/** Compact IRCTC UI: side panel has Logout (logged in) or LOGIN / REGISTER (logged out). */
function lexusNormText(el) {
    return ((el && (el.innerText || el.textContent)) || '').replace(/\s+/g, ' ').trim();
}

function findUserIconBtn() {
    const icon = document.querySelector('i.fa.fa-user, i.fa-user, .fa-user');
    if (icon) {
        const clickable = icon.closest('a, button, span, div') || icon;
        if (isLexusVisible(clickable) || clickable.offsetParent !== null) return clickable;
    }
    // Header right user affordance
    const header = document.querySelector('app-header, .h_head1, .navbar');
    if (header) {
        const cand = [...header.querySelectorAll('a, button, span')].find((el) =>
            el.querySelector?.('i.fa-user, .fa-user')
        );
        if (cand) return cand;
    }
    return null;
}

function findSidePanelRoot() {
    // Panel block with Welcome... or LOGIN / REGISTER (user HTML)
    const labels = [...document.querySelectorAll('label, button.search_btn, a.search_btn.loginText')];
    for (const el of labels) {
        const t = lexusNormText(el).toUpperCase();
        if (
            t.includes('WELCOME,') ||
            t.includes('LOGIN / REGISTER') ||
            t === 'LOGOUT' ||
            (t.includes('LOGOUT') && el.closest('a.search_btn'))
        ) {
            const root =
                el.closest('div.ng-star-inserted') ||
                el.closest('[style*="235, 238, 247"]') ||
                el.closest('div') ||
                el.parentElement;
            if (root) return root;
        }
    }
    return null;
}

function findPanelLogoutBtn() {
    // a.search_btn.loginText > ... > Logout  (panel)
    const links = [...document.querySelectorAll('a.search_btn.loginText, a.loginText, a.search_btn')];
    for (const a of links) {
        const t = lexusNormText(a).toUpperCase();
        if (t === 'LOGOUT' || t === 'LOG OUT' || /^LOGOUT\b/.test(t)) {
            if (isLexusVisible(a) || a.offsetParent !== null) return a;
        }
    }
    // nested <b>Logout</b>
    for (const b of document.querySelectorAll('a.search_btn b, a.loginText b, label b')) {
        if (lexusNormText(b).toUpperCase() === 'LOGOUT') {
            const a = b.closest('a');
            if (a && (isLexusVisible(a) || a.offsetParent !== null)) return a;
        }
    }
    return null;
}

function findPanelLoginRegisterBtn() {
    const buttons = [...document.querySelectorAll('button.search_btn, button')];
    for (const btn of buttons) {
        const t = lexusNormText(btn).toUpperCase();
        if (t === 'LOGIN / REGISTER' || t.includes('LOGIN / REGISTER') || t.replace(/\s/g, '') === 'LOGIN/REGISTER') {
            if (isLexusVisible(btn) || btn.offsetParent !== null) return btn;
        }
    }
    return null;
}

function lexusIsLoggedIn() {
    if (findPanelLogoutBtn()) return true;
    // Welcome, Name (user) in panel even if Logout momentarily not matched
    const welcome = [...document.querySelectorAll('label')].some((el) =>
        /^WELCOME,/i.test(lexusNormText(el))
    );
    if (welcome && findSidePanelRoot()) return true;
    return Array.from(
        document.querySelectorAll('app-header a, .h_head1 a, .h_head1 span, a.loginText, a.search_btn')
    ).some((el) => {
        const t = lexusNormText(el).toUpperCase();
        return t === 'LOGOUT' || t === 'LOG OUT';
    });
}

async function openUserSidePanel(opts) {
    const force = opts && opts.force;
    if (isLoginFormOpen()) {
        lexusLog('skip fa-user  -  login form open');
        return false;
    }
    const p = lexusGetLoginPhase();
    if (!force && (p === 'filling' || p === 'form_open' || p === 'done')) {
        lexusLog('skip fa-user  -  phase=' + p);
        return false;
    }
    // Already open with Login/Logout controls
    if (findPanelLogoutBtn() || findPanelLoginRegisterBtn()) {
        lexusLog('side panel already open');
        return true;
    }

    const userBtn = findUserIconBtn();
    if (userBtn) {
        if (!force) lexusSetLoginPhase('panel', 'fa-user');
        const ok = await lexusVerifyClick(userBtn, 'fa-user');
        if (!ok) return false;
        await new Promise((r) => setTimeout(r, 500));
        if (findPanelLogoutBtn() || findPanelLoginRegisterBtn()) return true;
        lexusLog('panel controls not found after fa-user', 'warn');
    } else {
        lexusLog('fa-user icon not found', 'warn');
    }

    // Fallback: hamburger
    const toggles = [
        ...document.querySelectorAll(
            'button.navbar-toggle, .navbar-toggle, .fa-bars, .glyphicon-menu-hamburger'
        ),
    ];
    for (const t of toggles) {
        if (!isLexusVisible(t) && t.offsetParent === null) continue;
        await lexusVerifyClick(t.closest('button, a') || t, 'hamburger');
        await new Promise((r) => setTimeout(r, 400));
        if (findPanelLogoutBtn() || findPanelLoginRegisterBtn()) return true;
    }
    return Boolean(findPanelLogoutBtn() || findPanelLoginRegisterBtn());
}

async function openMobileNavIfNeeded() {
    return openUserSidePanel();
}

function findClassicLoginBtnLegacy() {
    const nodes = [
        ...document.querySelectorAll(
            'a.search_btn.loginText, a.loginText, a.search_btn, button.search_btn, app-header a, .h_head1 a, .h_head1 button'
        ),
    ];
    for (const el of nodes) {
        const t = lexusNormText(el).toUpperCase();
        if (!t.includes('LOGIN') || t.includes('LOGOUT')) continue;
        if (isLexusVisible(el) || el.offsetParent !== null) return el;
    }
    for (const el of document.querySelectorAll('a, button')) {
        const t = lexusNormText(el).toUpperCase();
        if (t === 'LOGIN' || t === 'LOGIN | REGISTER' || t.startsWith('LOGIN |') || t === 'LOG IN') {
            if (isLexusVisible(el) || el.offsetParent !== null) return el;
        }
    }
    return null;
}

function findClassicLoginBtn() {
    return findPanelLoginRegisterBtn() || findClassicLoginBtnLegacy();
}

function findClassicSignInBtn() {
    const inLogin = document.querySelector("app-login");
    const scope = inLogin || document;
    const buttons = [...scope.querySelectorAll("button")];
    for (const b of buttons) {
        const t = ((b.innerText || "") + "").replace(/\s+/g, " ").trim().toUpperCase();
        if ((t === "SIGN IN" || t.includes("SIGN IN")) && isLexusVisible(b) && !b.disabled) {
            return b;
        }
    }
    return document.querySelector("app-login button.search_btn.train_Search") || null;
}

async function continueScript() {
    if (window !== window.top) return;
    // API/Direct: never skip login just because Brave Default still has old ir:tokens
    if (window.__LEXUS_DIRECT_BOOK__ && !lexusIsLoggedIn()) {
        try {
            localStorage.removeItem('ir:tokens');
            lexusLog('API mode — cleared stale tokens; login first');
        } catch (_) {}
    }
    if (window.__LEXUS_CONTINUE_LOCK__) {
        lexusLog("continueScript already running  -  skip lock");
        return;
    }
    if (lexusGetLoginPhase() === "done" || window.__LEXUS_POST_LOGIN_FIRED__) {
        lexusLog("continueScript skip  -  already done");
        return;
    }
    if (lexusGetLoginPhase() === "filling" || window.__LEXUS_LOGIN_FILLING__) {
        lexusLog("continueScript skip  -  filling");
        return;
    }
    if (isLoginFormOpen()) {
        lexusLog("continueScript  -  form already open -> fill only");
        window.__LEXUS_CONTINUE_LOCK__ = true;
        lexusSetLoginPhase("form_open", "pre-existing");
        await loadLoginDetails();
        return;
    }

    window.__LEXUS_CONTINUE_LOCK__ = true;
    lexusLog("continueScript start");
    if (typeof startLanguagePreferenceWatcher === "function") startLanguagePreferenceWatcher();

    try {
        let urlWaitCount = 0;
        while (!window.location.href.includes("train-search")) {
            await new Promise((r) => setTimeout(r, 400));
            urlWaitCount++;
            if (urlWaitCount > 40) {
                lexusLog("train-search URL timeout", "error");
                return;
            }
        }

        for (let i = 0; i < 10; i++) {
            if (lexusLoginUiBusy()) break;
            try {
                const did = await dismissIrctcBlockingOverlays();
                if (!did && i > 1) break;
            } catch (_) {}
            await new Promise((r) => setTimeout(r, 250));
        }

        lexusSetLoginPhase("panel", "open once");
        let loginBtn = null;
        for (let i = 0; i < 8; i++) {
            if (isLoginFormOpen()) break;
            if (lexusIsLoggedIn()) break;
            try { await openUserSidePanel(); } catch (_) {}
            loginBtn = findPanelLoginRegisterBtn() || findClassicLoginBtnLegacy();
            if (loginBtn) break;
            await new Promise((r) => setTimeout(r, 400));
        }

        if (lexusIsLoggedIn()) {
            lexusLog("already logged in (panel Logout)");
            if (typeof startKeepAlivePing === "function") startKeepAlivePing();
            lexusFirePostLoginOnce("already-logged-in");
            return;
        }

        if (isLoginFormOpen()) {
            lexusSetLoginPhase("form_open", "appeared during panel");
            await loadLoginDetails();
            return;
        }

        if (!loginBtn) {
            lexusLog("LOGIN / REGISTER not found", "error");
            window.__LEXUS_CONTINUE_LOCK__ = false;
            lexusSetLoginPhase("idle", "no login btn");
            return;
        }

        lexusLog("LOGIN / REGISTER once: " + lexusNormText(loginBtn));
        const clicked = await lexusVerifyClick(loginBtn, "LOGIN-REGISTER");
        if (!clicked) {
            window.__LEXUS_CONTINUE_LOCK__ = false;
            return;
        }
        lexusSetLoginPhase("form_open", "after LOGIN click");

        let loginWait = 25;
        while (loginWait > 0 && !isLoginFormOpen()) {
            await new Promise((r) => setTimeout(r, 400));
            loginWait--;
        }

        if (isLoginFormOpen()) {
            lexusLog("login form open  -  fill once");
            await loadLoginDetails();
        } else {
            lexusLog("login form did not open after LOGIN / REGISTER", "error");
            window.__LEXUS_CONTINUE_LOCK__ = false;
            lexusSetLoginPhase("idle", "form not opened");
        }
    } catch (e) {
        lexusLog("continueScript error: " + (e && e.message ? e.message : e), "error");
        window.__LEXUS_CONTINUE_LOCK__ = false;
    }
}

function lexusNgetBoot() {
    if (window.__LEXUS_NGET_BOOTED__) {
        lexusLog("boot skip  -  already booted");
        return;
    }
    window.__LEXUS_NGET_BOOTED__ = true;
    lexusLog("boot");
    if (typeof injectAnimationAssets === "function") injectAnimationAssets();
    if (typeof startLanguagePreferenceWatcher === "function") startLanguagePreferenceWatcher();

    try {
        const obs = new MutationObserver(() => {
            if (window.__LEXUS_POST_LOGIN_FIRED__) {
                obs.disconnect();
                return;
            }
            if (isLoginFormOpen()) return;
            if (typeof lexusIsLoggedIn === "function" && lexusIsLoggedIn()) {
                obs.disconnect();
                if (typeof startKeepAlivePing === "function") startKeepAlivePing();
                lexusFirePostLoginOnce("mutation-Logout");
            }
        });
        obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
        setTimeout(() => obs.disconnect(), 180000);
    } catch (_) {}

    if (typeof startSystemTimeEmitter === "function" && !window.__LEXUS_DIRECT_BOOK__) startSystemTimeEmitter();

    chrome.storage.local.get(null, (data) => {
        user_data = data;
        if (typeof dispatchInitialData === "function") dispatchInitialData(user_data);
        const href = String(location.href || "");
        if (href.includes("nget/train-search") && !href.includes("/booking/")) {
            lexusLog("boot -> continueScript");
            continueScript();
        } else {
            lexusLog("boot skip continueScript URL=" + href);
        }
    });
}

if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(lexusNgetBoot, 300);
} else {
    window.addEventListener("load", lexusNgetBoot);
}

} // /nget guard
