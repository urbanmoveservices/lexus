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
 * IRCTC Beta (/eticket) autofill — separate from nget content_script.js
 * Login → silent success check → journey fill (From / To / Date / Quota / Search)
 */

(function () {
    if (window !== window.top) return;
    if (!location.href.includes("/eticket")) return;

    const HEADER_LOGIN = "button.btn-login:not(.btn-action)";
    const SUBMIT_LOGIN = "button.btn-action.btn-login.active";
    const HEADER_USER = "button.nav-link-1";
    const USERNAME = "#username, input[formcontrolname='userid']";
    const PASSWORD = "#password, input[formcontrolname='password']";

    const FROM_BOX = "div[aria-label='From station']";
    const TO_BOX = "div[aria-label='To station']";
    const DATE_BOX = "div[aria-label='Select travel date']";
    const QUOTA_BOX = "div[aria-label='Quota']";
    const SEARCH_BTN = "button.search-btn";

    const LOADER_SELECTORS = [
        "#loaderP",
        ".loader",
        ".ui-progress-spinner",
        ".ngx-spinner",
        "[class*='loader']",
        "[class*='spinner']",
        "div.blockUI",
        ".loading-shade"
    ];
    const MAX_WAIT_MS = 45000;
    const POLL_MS = 250;
    const STABLE_MS = 800;

    const QUOTA_MAP = {
        GN: "GENERAL",
        TQ: "TATKAL",
        PT: "PREMIUM TATKAL",
        LD: "LADIES",
        SR: "LOWER BERTH"
    };

    function log() {
        /* silenced — stealth (console fingerprint) */
    }

    function panelStatus(msg) {
        const line = String(msg || "").trim();
        if (!line) return;
        try {
            if (typeof window.__oceanPushPanelStatus === "function") {
                window.__oceanPushPanelStatus(line);
                return;
            }
        } catch (_) { /* */ }
        try {
            if (typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.sendMessage === "function") {
                chrome.runtime.sendMessage(
                    {
                        id: "irctc",
                        msg: { type: "panel_status", data: { text: line } },
                        sender: "content_script"
                    },
                    () => {}
                );
            }
        } catch (_) { /* */ }
    }

    function sleep(ms) {
        return new Promise((r) => setTimeout(r, ms));
    }

    function waitForWindowLoad() {
        if (document.readyState === "complete") return Promise.resolve();
        return new Promise((resolve) => {
            window.addEventListener("load", () => resolve(), { once: true });
        });
    }

    function isVisible(el) {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function waitForElVisible(selector, timeoutMs = MAX_WAIT_MS) {
        return new Promise((resolve) => {
            const start = Date.now();
            const tick = () => {
                const el = document.querySelector(selector);
                if (el && isVisible(el)) {
                    resolve(el);
                    return;
                }
                if (Date.now() - start > timeoutMs) {
                    resolve(null);
                    return;
                }
                setTimeout(tick, POLL_MS);
            };
            tick();
        });
    }

    function resolveSelector(candidates) {
        for (const sel of candidates) {
            const el = document.querySelector(sel);
            if (el && isVisible(el)) return sel;
        }
        return null;
    }

    function debuggerClick(selector, offsetXPercent = 50, offsetYPercent = 50) {
        return new Promise((resolve, reject) => {
            try {
                const el = document.querySelector(selector);
                if (el && isLogoutish(el)) {
                    console.warn("[OCEAN Beta] Blocked click on LOGOUT-ish element:", selector);
                    reject(new Error("Refusing to click LOGOUT"));
                    return;
                }
            } catch (_) { /* */ }
            chrome.runtime.sendMessage({
                id: "irctc",
                msg: { type: "IGNORE" },
                type: "DEBUGGER_CLICK",
                selector,
                offsetXPercent,
                offsetYPercent
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

    function debuggerType(selector, text) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                id: "irctc",
                msg: { type: "IGNORE" },
                type: "DEBUGGER_TYPE",
                selector,
                text: String(text ?? "")
            }, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                if (response && response.success) resolve(response);
                else reject(new Error(response?.error || "DEBUGGER_TYPE failed"));
            });
        });
    }

    function debuggerKeyPress(keyStr) {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({
                id: "irctc",
                msg: { type: "IGNORE" },
                type: "DEBUGGER_KEY_PRESS",
                key: keyStr
            }, () => resolve());
        });
    }

    function getStorage(keys) {
        return new Promise((resolve) => {
            chrome.storage.local.get(keys, (data) => resolve(data || {}));
        });
    }

    async function getIrctcCredentials() {
        const data = await getStorage(["irctc_credentials"]);
        const creds = data?.irctc_credentials || {};
        return {
            userName: creds.user_name ?? "",
            password: creds.password ?? ""
        };
    }

    async function isManualLoginEnabled() {
        const data = await getStorage(["other_preferences"]);
        const v = data?.other_preferences?.manualLogin;
        return v === true || v === 'true' || v === 1 || v === '1';
    }

    async function getJourneyDetails() {
        const data = await getStorage(["journey_details"]);
        return data?.journey_details || {};
    }

    function extractStationCode(stationString) {
        if (!stationString) return "";
        const s = String(stationString).trim();
        if (!s) return "";
        // Prefer trailing code: "SURAT - ST" → ST
        let m = s.match(/\s*[-–—]\s*([A-Z0-9]{2,5})\s*$/i);
        if (m) return m[1].toUpperCase();
        m = s.match(/\(([A-Z0-9]{2,5})\)\s*$/i);
        if (m) return m[1].toUpperCase();
        const parts = s.split(/[-–—]/).map((p) => p.trim()).filter(Boolean);
        if (parts.length > 1) {
            const last = parts[parts.length - 1];
            if (/^[A-Z0-9]{2,5}$/i.test(last)) return last.toUpperCase();
        }
        if (/^[A-Z0-9]{2,5}$/i.test(s)) return s.toUpperCase();
        return s;
    }

    function quotaLabel(code) {
        return QUOTA_MAP[code] || String(code || "GENERAL");
    }

    function hasLogoutInDom() {
        const nodes = document.querySelectorAll("a, span, button, div.ndp-item-row");
        return Array.from(nodes).some((el) => {
            const t = (el.textContent || "").trim().toUpperCase();
            return t === "LOGOUT" || t.includes("LOGOUT");
        });
    }

    function isLoggedInHeader() {
        const userBtn = document.querySelector(HEADER_USER);
        return !!(userBtn && isVisible(userBtn));
    }

    function isLoginSuccess() {
        return isLoggedInHeader() || hasLogoutInDom();
    }

    function isAnyLoaderVisible() {
        for (const sel of LOADER_SELECTORS) {
            try {
                const nodes = document.querySelectorAll(sel);
                for (const el of nodes) {
                    if (isVisible(el)) return true;
                }
            } catch (_) { /* skip */ }
        }
        return false;
    }

    async function waitForLoaderClear(timeoutMs = 30000) {
        const start = Date.now();
        let sawLoader = false;

        while (Date.now() - start < 1200) {
            if (isAnyLoaderVisible()) {
                sawLoader = true;
                break;
            }
            await sleep(100);
        }

        if (!sawLoader && !isAnyLoaderVisible()) {
            log("No loader on screen — proceeding.");
            return true;
        }

        log("Loader visible — waiting until clear…");
        while (Date.now() - start < timeoutMs) {
            if (!isAnyLoaderVisible()) {
                await sleep(200);
                if (!isAnyLoaderVisible()) {
                    log("Loader cleared.");
                    return true;
                }
            }
            await sleep(150);
        }
        console.warn("[OCEAN Beta] Loader still visible after timeout — proceeding anyway.");
        return false;
    }

    async function waitForLoginSuccess(timeoutMs = MAX_WAIT_MS) {
        log("Waiting for login success (header username / LOGOUT in DOM)…");
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (isLoginSuccess()) {
                const name = (document.querySelector(HEADER_USER)?.innerText || "").trim();
                log("✅ Login confirmed (silent check).", name ? `User: ${name}` : "LOGOUT in DOM");
                return true;
            }
            await sleep(500);
        }
        console.warn("[OCEAN Beta] Login success not detected within timeout.");
        return false;
    }

    async function waitUntilIrctcReady() {
        log("Waiting for full page load…");
        await waitForWindowLoad();

        if (isLoginSuccess()) {
            log("Already logged in — skip waiting for Header LOGIN.");
            return null;
        }

        log("Waiting for Header LOGIN…", HEADER_LOGIN);
        const start = Date.now();
        while (Date.now() - start < MAX_WAIT_MS) {
            if (isLoginSuccess()) return null;
            const btn = findHeaderLoginButton();
            if (btn) {
                log(`Header LOGIN visible — settling ${STABLE_MS}ms…`);
                await sleep(STABLE_MS);
                return findHeaderLoginButton();
            }
            await sleep(POLL_MS);
        }
        return null;
    }

    async function clickHeaderLogin() {
        if (isLoginSuccess()) {
            log("Already logged in — skip Header LOGIN click.");
            return false;
        }

        const btn = await waitUntilIrctcReady();
        if (!btn) {
            if (isLoginSuccess()) {
                log("Login success while waiting — skip Header LOGIN.");
                return false;
            }
            console.warn("[OCEAN Beta] Header LOGIN not found within timeout.");
            return false;
        }

        if (isLogoutish(btn)) {
            log("Header is LOGOUT — already logged in, not clicking.");
            return false;
        }

        const text = (btn.innerText || btn.textContent || "").trim().toUpperCase();
        if (!text.includes("LOGIN") || text.includes("LOGOUT")) {
            log("Header button is not LOGIN — skip click:", text);
            return false;
        }

        const sel = markTempId(btn, "ocean-header-login");
        log("Debugger-click Header LOGIN…");
        btn.scrollIntoView({ block: "center", inline: "center" });
        await sleep(100);
        await debuggerClick(sel, 50, 50);
        log("Header LOGIN click done.");
        return true;
    }

    async function fillLoginCredentials() {
        log("Waiting for login username field…");
        const userEl = await waitForElVisible(USERNAME);
        if (!userEl) {
            console.warn("[OCEAN Beta] Username field not found.");
            return false;
        }
        await sleep(300);

        const userSel = resolveSelector(["#username", "input[formcontrolname='userid']"]);
        const passSel = resolveSelector(["#password", "input[formcontrolname='password']"]);
        const manualLogin = await isManualLoginEnabled();
        if (!userSel || (!manualLogin && !passSel)) {
            console.warn("[OCEAN Beta] Could not resolve username/password selectors.");
            return false;
        }

        const { userName, password } = await getIrctcCredentials();
        if (!userName) {
            console.warn("[OCEAN Beta] irctc_credentials username missing. Save login in popup first.");
            return false;
        }
        if (!manualLogin && !password) {
            console.warn("[OCEAN Beta] irctc_credentials missing in storage. Save login in popup first.");
            return false;
        }

        log("Clear + fill username via debugger…", userSel);
        if (!await lexusDirectFill(userSel, userName)) await debuggerType(userSel, userName);
        await sleep(200);

        if (manualLogin) {
            panelStatus("Fill pass aur SIGN IN dabao  -  Pass: " + password);
            return true;
        }

        log("Clear + fill password via debugger…", passSel);
        await debuggerType(passSel, password);
        log("Username/password fill done.");
        return true;
    }

    async function submitLoginAndConfirm() {
        log("Waiting for active Submit LOGIN…", SUBMIT_LOGIN);
        const submitBtn = await waitForElVisible(SUBMIT_LOGIN, 15000);
        if (!submitBtn) {
            console.warn("[OCEAN Beta] Active Submit LOGIN not found.");
            return false;
        }

        await sleep(200);
        log("Debugger-click Submit LOGIN…");
        await debuggerClick(SUBMIT_LOGIN, 50, 50);
        log("Submit LOGIN clicked.");

        await waitForLoaderClear();
        return waitForLoginSuccess();
    }

    // ─── Journey helpers ───────────────────────────────────────

    function markTempId(el, prefix) {
        if (!el) return null;
        const id = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
        el.setAttribute("id", id);
        el.setAttribute("data-ocean-click", id);
        return `[data-ocean-click="${id}"]`;
    }

    /** Never click LOGOUT / header account menu items */
    function isLogoutish(el) {
        if (!el) return true;
        const t = ((el.innerText || el.textContent || "") + "").replace(/\s+/g, " ").trim().toUpperCase();
        if (t === "LOGOUT" || t === "SIGN OUT" || t === "LOG OUT") return true;
        if (/\bLOG\s*OUT\b/.test(t) && t.length < 24) return true;
        try {
            if (el.closest && el.closest("[class*='logout' i], [aria-label*='logout' i], a[href*='logout' i]")) {
                return true;
            }
        } catch (_) { /* */ }
        return false;
    }

    function findHeaderLoginButton() {
        const buttons = Array.from(
            document.querySelectorAll("button.btn-login:not(.btn-action), button.btn-login")
        );
        return (
            buttons.find((b) => {
                if (!isVisible(b) || isLogoutish(b)) return false;
                const t = ((b.innerText || b.textContent || "") + "").replace(/\s+/g, " ").trim().toUpperCase();
                return t === "LOGIN" || (t.includes("LOGIN") && !t.includes("LOGOUT"));
            }) || null
        );
    }

    /**
     * Real mouse only (CDP / sendInputEvent via debuggerClick).
     * JS element.click() / synthetic MouseEvent = isTrusted:false → Akamai leak.
     */
    async function mouseClickEl(element, offsetYPercent = 50) {
        if (!element) {
            console.warn("[OCEAN Beta] mouseClick: invalid element");
            return false;
        }
        if (element.disabled || element.classList?.contains("disable-book")) {
            console.warn("[OCEAN Beta] mouseClick: disabled element");
            return false;
        }
        if (isLogoutish(element)) {
            console.warn("[OCEAN Beta] mouseClick: blocked logout-ish");
            return false;
        }
        const sel = markTempId(element, "ocean-mouse");
        try {
            await debuggerClick(sel, 50, offsetYPercent);
            return true;
        } catch (e) {
            console.warn("[OCEAN Beta] mouseClick failed:", e && e.message ? e.message : e);
            return false;
        }
    }

    /** @deprecated name kept — now mouse-only */
    async function fastClick(element) {
        return mouseClickEl(element, 50);
    }

    /** @deprecated name kept — now mouse-only (slightly lower hit) */
    async function slowClick(element) {
        return mouseClickEl(element, 58);
    }

    async function journeyClick(element, useSlowMode) {
        await mouseClickEl(element, useSlowMode ? 58 : 50);
    }

    /** content.js style: loader gayab → turant resolve (no long sleep) */
    function waitUntilLoaderGoneThen(getReadyEl, timeoutMs = 20000) {
        return new Promise((resolve) => {
            const start = Date.now();
            let finished = false;

            const tryReady = () => {
                if (finished) return null;
                if (isAnyLoaderVisible()) return null;
                // null → still waiting for target; true → loader-only wait done
                const el = typeof getReadyEl === "function" ? getReadyEl() : null;
                if (el === true) return true;
                if (el && isVisible(el) && !el.disabled) return el;
                return null;
            };

            const done = (el) => {
                if (finished) return;
                finished = true;
                try { observer.disconnect(); } catch (_) { /* */ }
                clearInterval(pollId);
                resolve(el || null);
            };

            const tick = () => {
                if (Date.now() - start > timeoutMs) {
                    done(tryReady());
                    return;
                }
                const el = tryReady();
                if (el) done(el);
            };

            const observer = new MutationObserver(tick);
            observer.observe(document.body, { childList: true, subtree: true, attributes: true });
            const pollId = setInterval(tick, 50);
            tick();
        });
    }

    async function waitForVisibleOptions(timeoutMs = 8000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const opts = Array.from(
                document.querySelectorAll(
                    "div.custom-option, div[role='option'], li[role='option'], .ui-dropdown-item, .p-dropdown-item, .ap-option, .dropdown-item"
                )
            ).filter(isVisible);
            if (opts.length) return opts;
            await sleep(120);
        }
        return [];
    }

    /** Exact/includes text option — gender (short) + station (long) dono */
    function findOptionByText(matchText, { allowLong = false } = {}) {
        const needle = String(matchText || "").trim().toUpperCase();
        if (!needle) return null;

        const selectors = [
            "div.custom-option",
            "div[role='option']",
            "li[role='option']",
            ".ui-dropdown-item",
            ".p-dropdown-item",
            ".ap-option",
            ".dropdown-item",
            "div.ap-container div",
            "ul li",
            "div[class*='option']"
        ];
        const seen = new Set();
        const candidates = [];
        for (const sel of selectors) {
            document.querySelectorAll(sel).forEach((el) => {
                if (seen.has(el) || !isVisible(el)) return;
                if (isLogoutish(el)) return;
                // Never treat header / account menu as a form option
                try {
                    if (el.closest("header, app-header, .navbar, nav.navbar, .user-profile, .ndp-header")) {
                        return;
                    }
                } catch (_) { /* */ }
                seen.add(el);
                candidates.push(el);
            });
        }

        let hit = candidates.find((el) => (el.innerText || "").trim().toUpperCase() === needle);
        if (hit) return hit;

        hit = candidates.find((el) => {
            const t = (el.innerText || "").replace(/\s+/g, " ").trim().toUpperCase();
            if (!t) return false;
            if (isLogoutish(el)) return false;
            // Gender etc: short options; stations: long multi-line ok
            if (!allowLong && t.length > 48) return false;
            return t === needle || t.includes(needle);
        });
        return hit || null;
    }

    /** Station list: "BARDDHAMAN JN … BWN" — code end / word match */
    function findStationOption(code) {
        const needle = String(code || "").trim().toUpperCase();
        if (!needle) return null;

        const opts = Array.from(document.querySelectorAll(
            "div[role='option'], div.custom-option, li[role='option'], [class*='station-option'], [class*='suggest'] li, [class*='suggest'] div, .ui-autocomplete-list-item"
        )).filter(isVisible);

        if (!opts.length) {
            // broader: any visible option-like node containing code
            return findOptionByText(needle, { allowLong: true });
        }

        const reWord = new RegExp(`(?:^|[\\s\\-\\(])${needle}(?:$|[\\s\\)\\-])`);

        // 1) code as last token (common IRCTC layout)
        let hit = opts.find((el) => {
            const t = (el.innerText || "").replace(/\s+/g, " ").trim().toUpperCase();
            const parts = t.split(/[\s\-]+/).filter(Boolean);
            return parts[parts.length - 1] === needle || t.endsWith(" " + needle) || t.endsWith("- " + needle) || t.endsWith("-" + needle);
        });
        if (hit) return hit;

        // 2) word-boundary code
        hit = opts.find((el) => reWord.test((el.innerText || "").replace(/\s+/g, " ").trim().toUpperCase()));
        if (hit) return hit;

        // 3) includes
        return opts.find((el) => (el.innerText || "").toUpperCase().includes(needle)) || null;
    }

    async function clickMatchingOption(matchText, timeoutMs = 6000) {
        const needle = String(matchText || "").trim();
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const hit = findOptionByText(needle);
            if (hit) {
                const sel = markTempId(hit, "ocean-beta-opt");
                log("Option click:", needle, "→", (hit.innerText || "").trim().replace(/\s+/g, " "));
                await debuggerClick(sel);
                return true;
            }
            await sleep(120);
        }
        console.warn("[OCEAN Beta] Option not found:", needle);
        return false;
    }

    async function clickStationOption(code, timeoutMs = 8000) {
        const needle = String(code || "").trim().toUpperCase();
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const hit = findStationOption(needle);
            if (hit) {
                const preview = (hit.innerText || "").trim().replace(/\s+/g, " ").slice(0, 80);
                log("Station option click:", needle, "→", preview);
                await debuggerClick(markTempId(hit, "ocean-station-opt"));
                return true;
            }
            await sleep(150);
        }
        console.warn("[OCEAN Beta] Station option not found:", needle);
        return false;
    }

    function stationBoxShowsCode(boxSelector, code) {
        const box = document.querySelector(boxSelector);
        if (!box) return false;
        const ph = box.querySelector(".select-placeholder, .has-value, .field-inner");
        const t = ((ph && ph.innerText) || box.innerText || "").toUpperCase();
        return t.includes(String(code || "").toUpperCase());
    }

    async function resolveOpenInputSelector(boxSelector, tempId) {
        const box = document.querySelector(boxSelector);
        let input = box?.querySelector("input");
        if (!input || !isVisible(input)) {
            input = document.querySelector(`${boxSelector} input`);
        }
        if (!input || !isVisible(input)) {
            // open dropdown / panel input
            input = Array.from(document.querySelectorAll("input")).find((el) => {
                if (!isVisible(el)) return false;
                const ph = (el.getAttribute("placeholder") || "").toLowerCase();
                const type = (el.getAttribute("type") || "").toLowerCase();
                if (type === "password" || type === "hidden") return false;
                return ph.includes("station") || ph.includes("from") || ph.includes("to") || ph.includes("search") || el === document.activeElement;
            });
        }
        if (!input) return null;
        return markTempId(input, tempId);
    }

    async function fillStationCombobox(boxSelector, stationRaw, tempId) {
        const code = extractStationCode(stationRaw);
        if (!code) {
            console.warn("[OCEAN Beta] Empty station code for", boxSelector);
            return false;
        }

        log(`Station fill → ${code}`, boxSelector);
        const box = await waitForElVisible(boxSelector, 15000);
        if (!box) {
            console.warn("[OCEAN Beta] Station box not found:", boxSelector);
            return false;
        }

        // Already selected (e.g. previous successful fill)
        if (stationBoxShowsCode(boxSelector, code)) {
            log("Station already set:", code);
            return true;
        }

        await debuggerClick(boxSelector);
        await sleep(450);

        let inputSel = await resolveOpenInputSelector(boxSelector, tempId);
        if (!inputSel) {
            // listbox input kabhi late aata hai
            await sleep(400);
            inputSel = await resolveOpenInputSelector(boxSelector, tempId);
        }
        if (!inputSel) {
            console.warn("[OCEAN Beta] Station input not found after opening", boxSelector);
            return false;
        }

        await debuggerType(inputSel, code);
        await sleep(500);

        // Wait station suggestions (long names jaise BARDDHAMAN JN … BWN)
        const picked = await clickStationOption(code, 9000);
        if (!picked) {
            log("Station option miss — Enter fallback…");
            await debuggerKeyPress("\r");
            await sleep(400);
        } else {
            await sleep(350);
        }

        if (stationBoxShowsCode(boxSelector, code)) {
            log("Station confirmed in field:", code);
            return true;
        }

        // Retry once: reopen + type + first option / Enter
        console.warn("[OCEAN Beta] Station not confirmed, retry once:", code);
        await debuggerClick(boxSelector);
        await sleep(400);
        inputSel = await resolveOpenInputSelector(boxSelector, tempId + "-r");
        if (inputSel) {
            await debuggerType(inputSel, code);
            await sleep(600);
            if (!(await clickStationOption(code, 5000))) {
                await debuggerKeyPress("\r");
            }
            await sleep(400);
        }
        return stationBoxShowsCode(boxSelector, code);
    }

    function parseJourneyDate(dateStr) {
        // popup type=date → YYYY-MM-DD
        const d = new Date(dateStr);
        if (Number.isNaN(d.getTime())) return null;
        return {
            day: d.getDate(),
            monthIndex: d.getMonth(),
            year: d.getFullYear(),
            date: d
        };
    }

    const MONTH_NAMES_FULL = [
        "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
        "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"
    ];

    /** Beta IRCTC = PrimeNG: .ui-datepicker-month + .ui-datepicker-year (alag spans) */
    function readOpenCalendarMonthYear() {
        const monthEl = document.querySelector(".ui-datepicker:not([style*='display: none']) .ui-datepicker-month, .ui-datepicker-inline .ui-datepicker-month, .ui-datepicker-month");
        const yearEl = document.querySelector(".ui-datepicker:not([style*='display: none']) .ui-datepicker-year, .ui-datepicker-inline .ui-datepicker-year, .ui-datepicker-year");

        if (monthEl && yearEl && isVisible(monthEl)) {
            const mTxt = (monthEl.innerText || "").trim().toUpperCase();
            const yTxt = (yearEl.innerText || "").trim();
            const monthIndex = MONTH_NAMES_FULL.findIndex((m) => m === mTxt || m.startsWith(mTxt.slice(0, 3)));
            const year = parseInt(yTxt, 10);
            if (monthIndex >= 0 && year > 2000) {
                return { monthIndex, year };
            }
        }

        // Fallback: title block "September2026" / "September 2026"
        const title = document.querySelector(".ui-datepicker-title");
        if (title && isVisible(title)) {
            const t = (title.innerText || "").replace(/\s+/g, " ").trim().toUpperCase().replace(/\s+/g, "");
            for (let i = 0; i < MONTH_NAMES_FULL.length; i++) {
                const m = MONTH_NAMES_FULL[i];
                if (t.startsWith(m)) {
                    const year = parseInt(t.slice(m.length), 10);
                    if (year > 2000) return { monthIndex: i, year };
                }
            }
        }
        return null;
    }

    async function clickCalendarNav(direction) {
        // direction: "next" | "prev" — exact IRCTC / PrimeNG anchors
        const sel = direction === "prev"
            ? "a.ui-datepicker-prev"
            : "a.ui-datepicker-next";
        const el = Array.from(document.querySelectorAll(sel)).find(isVisible);
        if (!el) {
            console.warn("[OCEAN Beta] Calendar", direction, "not found");
            return false;
        }
        await debuggerClick(markTempId(el, direction === "prev" ? "ocean-cal-prev" : "ocean-cal-next"));
        return true;
    }

    async function clickCalendarDay(day) {
        const dayNum = String(day);

        // Only current-month enabled days: td (not other-month) > a.ui-state-default
        const links = Array.from(document.querySelectorAll(
            ".ui-datepicker-calendar tbody td:not(.ui-datepicker-other-month) a.ui-state-default"
        )).filter((el) => {
            if (!isVisible(el)) return false;
            if (el.classList.contains("ui-state-disabled")) return false;
            return (el.innerText || "").trim() === dayNum;
        });

        let hit = links[0] || null;

        if (!hit) {
            // fallback: any a in calendar with day text, skip other-month / disabled
            hit = Array.from(document.querySelectorAll(".ui-datepicker-calendar a.ui-state-default"))
                .filter(isVisible)
                .find((a) => {
                    const td = a.closest("td");
                    if (td?.classList.contains("ui-datepicker-other-month")) return false;
                    if (a.classList.contains("ui-state-disabled")) return false;
                    return (a.innerText || "").trim() === dayNum;
                }) || null;
        }

        if (!hit) {
            console.warn("[OCEAN Beta] Calendar day not found / disabled:", day);
            return false;
        }

        log("Click calendar day:", dayNum);
        await debuggerClick(markTempId(hit, "ocean-cal-day"));
        return true;
    }

    async function fillJourneyDate(dateStr) {
        const parsed = parseJourneyDate(dateStr);
        if (!parsed) {
            console.warn("[OCEAN Beta] Invalid journey date:", dateStr);
            return false;
        }

        const targetKey = parsed.year * 12 + parsed.monthIndex;
        log(`Selecting date ${parsed.day}/${parsed.monthIndex + 1}/${parsed.year}`);

        const box = await waitForElVisible(DATE_BOX, 15000);
        if (!box) {
            console.warn("[OCEAN Beta] Date box not found");
            return false;
        }

        await debuggerClick(DATE_BOX);
        await sleep(700);

        // Wait calendar header
        let cur = null;
        for (let i = 0; i < 20 && !cur; i++) {
            cur = readOpenCalendarMonthYear();
            if (!cur) await sleep(150);
        }
        if (!cur) {
            console.warn("[OCEAN Beta] Calendar month/year header not readable");
            return false;
        }

        // Go forward OR back — pehle sirf next tha isliye 2027 tak chala gaya
        let guard = 24;
        while (guard-- > 0) {
            cur = readOpenCalendarMonthYear();
            if (!cur) {
                await sleep(200);
                continue;
            }
            log("Calendar showing:", MONTH_NAMES_FULL[cur.monthIndex], cur.year);

            const curKey = cur.year * 12 + cur.monthIndex;
            if (curKey === targetKey) break;

            if (curKey < targetKey) {
                if (!(await clickCalendarNav("next"))) break;
            } else {
                if (!(await clickCalendarNav("prev"))) break;
            }
            await sleep(350);
        }

        cur = readOpenCalendarMonthYear();
        if (!cur || cur.year !== parsed.year || cur.monthIndex !== parsed.monthIndex) {
            console.warn("[OCEAN Beta] Could not reach target month", parsed.monthIndex + 1, parsed.year,
                "— now at", cur);
            return false;
        }

        const ok = await clickCalendarDay(parsed.day);
        await sleep(400);
        return ok;
    }

    async function fillQuota(quotaCode) {
        const label = quotaLabel(quotaCode);
        log("Selecting quota…", quotaCode, "→", label);

        const box = await waitForElVisible(QUOTA_BOX, 15000);
        if (!box) {
            console.warn("[OCEAN Beta] Quota box not found");
            return false;
        }

        // Already selected?
        const shown = (box.innerText || "").toUpperCase();
        if (shown.includes(label) || shown.includes(String(quotaCode || "").toUpperCase())) {
            log("Quota already set:", label);
            return true;
        }

        await debuggerClick(QUOTA_BOX);
        await sleep(450);

        // Custom options: GENERAL / TATKAL (allow long=false; short labels)
        let ok = await clickMatchingOption(label, 5000);
        if (!ok) {
            // listbox role=option (pickup used div.custom-option)
            const hit = Array.from(document.querySelectorAll("div.custom-option, div[role='option']"))
                .filter(isVisible)
                .find((el) => (el.innerText || "").toUpperCase().includes(label));
            if (hit) {
                await debuggerClick(markTempId(hit, "ocean-quota-opt"));
                ok = true;
            }
        }
        if (!ok && quotaCode) {
            ok = await clickMatchingOption(String(quotaCode), 3000);
        }
        await sleep(300);
        return ok;
    }

    async function clickSearchTrains() {
        const sel = resolveSelector([SEARCH_BTN, "button[type='submit'].search-btn", "form button[type='submit']"]);
        if (!sel) {
            console.warn("[OCEAN Beta] Search Trains button not found");
            return false;
        }
        log("Clicking Search Trains…", sel);
        await debuggerClick(sel);
        return true;
    }

    async function loadJourneyDetails() {
        log("Journey fill started…");
        const journey = await getJourneyDetails();
        if (!journey?.from || !journey?.destination || !journey?.date) {
            console.warn("[OCEAN Beta] journey_details incomplete in storage. Save Journey section in popup.", journey);
            return false;
        }

        // Search form ready
        const fromReady = await waitForElVisible(FROM_BOX, 20000);
        if (!fromReady) {
            console.warn("[OCEAN Beta] From station field not on page — are we on train-search?");
            return false;
        }
        await sleep(300);

        try {
            await fillStationCombobox(FROM_BOX, journey.from, "ocean-beta-from-inp");
            await fillStationCombobox(TO_BOX, journey.destination, "ocean-beta-to-inp");
            await fillJourneyDate(journey.date);
            await fillQuota(journey.quota || "GN");
            await clickSearchTrains();
            log("✅ Journey details filled + Search clicked.");
            return true;
        } catch (e) {
            console.error("[OCEAN Beta] Journey fill failed:", e);
            return false;
        }
    }

    async function afterLoginContinue() {
        // Train-list pe ho to BG message wait (ya seedha selectJourney)
        if (location.href.includes("booking/train-list")) {
            log("Already on train-list — running selectJourney.");
            await selectJourney();
            return;
        }
        log("Next: journey fill.");
        await sleep(500);
        await loadJourneyDetails();
        // Search ke baad URL change → background → selectJourney message
    }

    // ─── selectJourney (BG URL router se call) ─────────────────

    let selectJourneyRunning = false;

    async function waitForTrainCards(timeoutMs = 20000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const cards = Array.from(document.querySelectorAll("div.train-card__main, app-train-avl-enq, app-train-list .ng-star-inserted"))
                .filter(isVisible);
            if (cards.length) return cards;
            await sleep(300);
        }
        return [];
    }

    function findTrainCard(trainNoRaw) {
        const trainNo = String(trainNoRaw || "").split("-")[0].trim();
        if (!trainNo) return null;

        const cards = Array.from(document.querySelectorAll("div.train-card__main")).filter(isVisible);
        let hit = cards.find((c) => (c.innerText || "").includes(trainNo));
        if (hit) return hit.closest("app-train-avl-enq") || hit.parentElement || hit;

        // Fallback: any block containing train number + availability button
        const blocks = Array.from(document.querySelectorAll("app-train-avl-enq, app-train-list > div > div > div")).filter(isVisible);
        hit = blocks.find((b) => (b.innerText || "").includes(trainNo));
        return hit || null;
    }

    /** True if text is this IRCTC class code (SL / 3A / 2A / 1A / CC …), not a loose substring */
    function textMatchesClassCode(text, classCode) {
        const t = String(text || "").replace(/\s+/g, " ").trim().toUpperCase();
        const code = String(classCode || "").trim().toUpperCase();
        if (!t || !code) return false;
        if (t === code) return true;
        // e.g. "Sleeper (SL)" / "AC 3 Tier (3A)"
        if (t.includes(`(${code})`)) return true;
        // trailing code: "SLEEPER SL" but not "SLEEPER" endsWith "SL" false-positives via word boundary
        const re = new RegExp(`(?:^|[\\s(/])${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[\\s)/])`);
        return re.test(t);
    }

    function findClassChip(trainBlock, classCode) {
        if (!trainBlock || !classCode) return null;
        const candidates = Array.from(
            trainBlock.querySelectorAll(
                ".class-chip, .avl-class, button.class-btn, [class*='class'] button, [class*='class'] span, button, span"
            )
        ).filter(isVisible);

        // Prefer short chip labels (exact "SL") over huge containers
        const exact = candidates.find((el) => {
            const t = (el.innerText || "").replace(/\s+/g, " ").trim().toUpperCase();
            return t === classCode || t === `(${classCode})`;
        });
        if (exact) return exact;

        return candidates.find((el) => {
            const t = (el.innerText || "").replace(/\s+/g, " ").trim();
            // Avoid giant wrappers that contain every class
            if (t.length > 40) return false;
            return textMatchesClassCode(t, classCode);
        }) || null;
    }

    /** After Check Availability: pick .class-card for selected class (not the first AC card) */
    function findClassCard(trainBlock, classCode) {
        if (!trainBlock || !classCode) return null;
        const root = trainBlock.querySelector(".available-classes__box") || trainBlock;
        const cards = Array.from(root.querySelectorAll(".class-card")).filter(isVisible);
        if (!cards.length) return null;

        let hit = cards.find((card) => {
            const codeEl = card.querySelector(".class-code");
            const label = codeEl ? codeEl.textContent : card.textContent;
            return textMatchesClassCode(label, classCode);
        });
        if (hit) return hit;

        // Fallback: card whose class-code alt/text tightly matches
        hit = cards.find((card) => textMatchesClassCode(card.textContent, classCode));
        return hit || null;
    }

    function findBookBtnInClassCard(classCard) {
        if (!classCard) return null;
        const btn = classCard.querySelector("button.btn-book");
        if (btn && isVisible(btn)) return btn;
        return Array.from(classCard.querySelectorAll("button")).find(
            (b) => /^book$/i.test((b.innerText || "").trim()) && isVisible(b)
        ) || null;
    }

    function findCheckAvailabilityBtn(trainBlock) {
        if (!trainBlock) return null;
        let btn = trainBlock.querySelector("button.btn-availability");
        if (btn && isVisible(btn)) return btn;
        return Array.from(trainBlock.querySelectorAll("button")).find(
            (b) => /check\s*availability/i.test(b.innerText || "") && isVisible(b)
        ) || null;
    }

    function findTargetBookBtn(trainBlock, classCode) {
        if (!trainBlock) return null;
        if (classCode) {
            const card = findClassCard(trainBlock, classCode);
            return findBookBtnInClassCard(card);
        }
        return Array.from(trainBlock.querySelectorAll("button.btn-book")).find(isVisible) || null;
    }

    /** Refresh icon on matching class-card (BOOK se pehle sirf ye dikhta hai) */
    function findClassSyncIcon(trainBlock, classCode) {
        const card = classCode
            ? findClassCard(trainBlock, classCode)
            : trainBlock?.querySelector(".class-card");
        if (!card) return null;
        const sync = card.querySelector(
            "span.sync-icon, .sync-icon.fa-repeat, span.fa-repeat, .fa.fa-repeat"
        );
        return sync && isVisible(sync) ? sync : null;
    }

    /**
     * Book-wait phase: only real page loaders (#loaderP / ngx-spinner).
     * Broad [class*='loader'] false-positive se BOOK wait stuck na ho.
     */
    function isJourneyLoaderVisible() {
        const loader = document.querySelector("#loaderP");
        if (loader && window.getComputedStyle(loader).display !== "none" && isVisible(loader)) {
            return true;
        }
        const spinners = document.querySelectorAll(
            ".ngx-spinner, .ui-progress-spinner, div.blockUI, .loading-shade"
        );
        for (const el of spinners) {
            if (isVisible(el)) return true;
        }
        return false;
    }

    function isHighLoadToast() {
        const toast = document.querySelector(
            ".ui-toast-detail, .ui-toast-message-text-content, .p-toast-detail, .toast-message, .ui-toast-message"
        );
        if (!toast) return false;
        const errText = (toast.innerText || "").toLowerCase();
        return (
            errText.includes("high load") ||
            errText.includes("please retry") ||
            errText.includes("unable to process request") ||
            errText.includes("unable to perform this transaction") ||
            errText.includes("please try again") ||
            errText.includes("client ip")
        );
    }

    function closeHighLoadToast() {
        const closeBtn = document.querySelector(
            ".ui-toast-close-icon, .p-toast-icon-close, button.ui-toast-close-icon, .toast-close"
        );
        if (closeBtn) {
            // Real mouse — JS .click() leak avoid
            mouseClickEl(closeBtn, 50).catch(() => {});
        }
    }

    // ─── Same booking clock as content_script.js (ac/sl/gn book time) ───
    const AC_BOOK_CLASSES = ["1A", "2A", "3A", "CC", "EC", "3E", "EV", "EA"];

    function currentClockHms() {
        // Same as nget: Date → "HH:MM:SS"
        return new Date().toString().split(" ")[4] || "00:00:00";
    }

    function resolveRequiredBookingTime(journey, otherPrefs) {
        const journeyClass = String(journey.class || "").trim().toUpperCase();
        const quota = String(journey.quota || "").trim().toUpperCase();
        let required = "00:00:00";
        if (AC_BOOK_CLASSES.includes(journeyClass)) {
            required = otherPrefs.acbooktime || "09:59:59";
        } else {
            required = otherPrefs.slbooktime || "10:59:59";
        }
        if (quota === "GN") required = otherPrefs.gnbooktime || "07:59:59";
        return String(required || "00:00:00").trim();
    }

    function findHeaderClockEl() {
        return (
            document.querySelector("div.row.col-sm-12.h_head1 > span > strong") ||
            document.querySelector("app-header header strong") ||
            document.querySelector("header strong") ||
            Array.from(document.querySelectorAll("header span, header strong, .h_head1 strong, app-header *"))
                .find((el) => /^\d{2}:\d{2}:\d{2}$/.test((el.textContent || "").trim())) ||
            null
        );
    }

    function showBookingWaitBanner(requiredBookingTime) {
        let banner = document.getElementById("ocean-wait-banner");
        if (!banner) {
            banner = document.createElement("div");
            banner.id = "ocean-wait-banner";
            Object.assign(banner.style, {
                position: "fixed",
                top: "0px",
                left: "50%",
                transform: "translateX(-50%)",
                width: "100%",
                textAlign: "center",
                color: "white",
                fontSize: "22px",
                fontWeight: "bold",
                padding: "15px 0",
                zIndex: "9999999",
                boxShadow: "0 4px 10px rgba(0,0,0,0.5)",
                backgroundColor: "green",
            });
            document.body.appendChild(banner);
        }
        banner.textContent = `Please wait... Booking will start at ${requiredBookingTime}`;
        return banner;
    }

    function removeOceanBanner() {
        const banner = document.getElementById("ocean-wait-banner");
        if (banner) banner.remove();
    }

    /**
     * AvailabilityCheck=A + TQ/PT/GN → wait until popup clock time (same as nget).
     * AvailabilityCheck=I → immediate. M handled by caller.
     */
    function waitForBookingClock(journey, travelPrefs, otherPrefs) {
        return new Promise((resolve) => {
            const mode = String(travelPrefs?.AvailabilityCheck || "").trim().toUpperCase();
            if (mode !== "A") {
                log("Booking clock skipped (AvailabilityCheck=" + (mode || "?") + ").");
                resolve(true);
                return;
            }

            const quota = String(journey.quota || "").trim().toUpperCase();
            if (!["TQ", "PT", "GN"].includes(quota)) {
                log("Booking clock skipped (quota=" + quota + ").");
                resolve(true);
                return;
            }

            const requiredBookingTime = resolveRequiredBookingTime(journey, otherPrefs || {});
            log("Verify tatkal/general time → Required Booking Time:", requiredBookingTime);

            const now = currentClockHms();
            if (now >= requiredBookingTime) {
                log("Clock already past required time:", now, "≥", requiredBookingTime);
                removeOceanBanner();
                resolve(true);
                return;
            }

            let waitCounter = 0;
            let done = false;
            let observer = null;
            let intervalId = null;

            const finish = () => {
                if (done) return;
                done = true;
                if (observer) try { observer.disconnect(); } catch (_) { /* */ }
                if (intervalId) clearInterval(intervalId);
                removeOceanBanner();
                log("Clock reached", requiredBookingTime, "— starting booking clicks.");
                resolve(true);
            };

            const tick = () => {
                const currentTimeString = currentClockHms();
                if (waitCounter % 5 === 0) {
                    log("Current Time for booking:", currentTimeString, "(need ≥", requiredBookingTime + ")");
                }
                if (currentTimeString >= requiredBookingTime) {
                    finish();
                    return;
                }
                try {
                    if (waitCounter === 0) showBookingWaitBanner(requiredBookingTime);
                    const banner = document.getElementById("ocean-wait-banner");
                    if (banner) {
                        banner.style.backgroundColor = waitCounter % 2 === 0 ? "green" : "red";
                        banner.textContent = `Please wait... Booking will start at ${requiredBookingTime} (now ${currentTimeString})`;
                    }
                } catch (_) { /* */ }
                waitCounter++;
            };

            showBookingWaitBanner(requiredBookingTime);
            tick();

            // Same as nget: observe IRCTC header clock mutations
            const headerStrongElement = findHeaderClockEl();
            if (headerStrongElement) {
                observer = new MutationObserver(() => tick());
                observer.observe(headerStrongElement, {
                    childList: true,
                    subtree: true,
                    characterData: true,
                    characterDataOldValue: true,
                });
                log("Booking clock watching header element.");
            } else {
                log("Header clock not found — using interval (same HH:MM:SS compare).");
            }
            // Beta fallback / nget also effectively ticks on header updates ≈1s
            intervalId = setInterval(tick, 200);
        });
    }

    // Active observers for this selectJourney run (disconnect on retry)
    let sjHighLoadCatcher = null;
    let sjMainObserver = null;
    let sjLoaderObserver = null;
    let sjRefreshTimer = null;
    let sjBookAttempted = false;
    let sjLastSyncAt = 0;

    function disconnectSjObservers() {
        for (const obs of [sjHighLoadCatcher, sjMainObserver, sjLoaderObserver]) {
            if (obs) try { obs.disconnect(); } catch (_) { /* */ }
        }
        if (sjRefreshTimer) {
            clearInterval(sjRefreshTimer);
            sjRefreshTimer = null;
        }
        sjHighLoadCatcher = null;
        sjMainObserver = null;
        sjLoaderObserver = null;
    }

    /** Same as content_script.js retrySelectJourney */
    function retrySelectJourney() {
        log("🔄 Kuch gadbad / High Load — 300ms me phir se try…");
        disconnectSjObservers();
        sjBookAttempted = false;
        selectJourneyRunning = false;
        setTimeout(() => {
            selectJourney();
        }, 300);
    }

    /**
     * content.js waitForLoaderAndBook + 300ms retry jab BOOK / seat open nahi:
     * beta pe matching class-card ka sync-icon (fa-repeat) har ~300ms click
     */
    function waitForLoaderAndBook(trainBlock, classCode, useSlowMode) {
        log("'BOOK' wait — loader clear / sync refresh / BOOK click…");

        if (sjLoaderObserver) try { sjLoaderObserver.disconnect(); } catch (_) { /* */ }
        if (sjRefreshTimer) {
            clearInterval(sjRefreshTimer);
            sjRefreshTimer = null;
        }

        const tryBook = () => {
            if (sjBookAttempted) return;

            if (isHighLoadToast()) {
                log("🚨 High Load (Availability/BOOK wait pe)! Retry…");
                disconnectSjObservers();
                closeHighLoadToast();
                retrySelectJourney();
                return;
            }

            // Page loader chal raha ho to wait (sync spam mat karo)
            if (isJourneyLoaderVisible()) return;

            const bookButton = findTargetBookBtn(trainBlock, classCode);
            if (
                bookButton &&
                isVisible(bookButton) &&
                !bookButton.disabled &&
                !bookButton.classList.contains("disable-book")
            ) {
                log("Signal: BOOK ready — attemptClickBook");
                disconnectSjObservers();
                attemptClickBook(trainBlock, classCode, useSlowMode);
                return;
            }

            // BOOK abhi nahi (sirf AVAILABLE + sync) — har 300ms sync refresh
            // content.js jahan book ready nahi → retrySelectJourney(300)
            const now = Date.now();
            if (now - sjLastSyncAt < 280) return;
            sjLastSyncAt = now;

            const sync = findClassSyncIcon(trainBlock, classCode);
            if (sync) {
                log("BOOK nahi / seat refresh — sync-icon mouse click (300ms)…");
                mouseClickEl(sync, useSlowMode ? 58 : 50).catch(() => {});
                return;
            }

            // Class card / sync bhi nahi — pura flow dubara
            log("Class card/sync nahi mila — full retry…");
            retrySelectJourney();
        };

        sjLoaderObserver = new MutationObserver(tryBook);
        sjLoaderObserver.observe(document.body, { childList: true, subtree: true, attributes: true });
        // content.js style: 300ms clock — seat na khuli to sync dabate raho
        sjRefreshTimer = setInterval(tryBook, 300);
        tryBook();
    }

    /** Passenger page after BOOK (URL ya DOM) */
    function isPassengerPageReady() {
        if (location.href.includes("booking/psgninput")) return true;
        return !!(
            document.querySelector("app-passenger-input") ||
            document.querySelector("button.btn.btn-new-passenger") ||
            document.querySelector("div.row.psgn-main-grid")
        );
    }

    /**
     * BOOK click ke baad loader gayab hone ka wait — phir hi aage badho.
     * IRCTC slow ho sakta hai (50s–1min+), isliye long timeout, no fixed 20s cut.
     */
    function waitAfterBookLoaderClear(timeoutMs = 120000) {
        return new Promise((resolve) => {
            const start = Date.now();
            let settled = false;
            const done = (ok) => {
                if (settled) return;
                settled = true;
                try { observer.disconnect(); } catch (_) { /* */ }
                clearInterval(iv);
                resolve(!!ok);
            };

            const tick = () => {
                if (isHighLoadToast()) {
                    log("🚨 BOOK ke baad High Load — full retry…");
                    done(false);
                    closeHighLoadToast();
                    retrySelectJourney();
                    return;
                }

                if (isPassengerPageReady()) {
                    log("BOOK ke baad passenger page ready.");
                    done(true);
                    return;
                }

                // Loader ab bhi chal raha → wait
                if (isJourneyLoaderVisible()) return;

                // Loader gayab — navigation settle
                log("BOOK ke baad loader clear.");
                done(true);
            };

            const observer = new MutationObserver(tick);
            observer.observe(document.body, { childList: true, subtree: true, attributes: true });
            const iv = setInterval(tick, 100);
            tick();

            setTimeout(() => {
                if (!settled) {
                    log("BOOK ke baad loader wait timeout — proceeding.");
                    done(false);
                }
            }, timeoutMs);
        });
    }

    /** Same as content_script.js attemptClickBook — beta BOOK selector */
    async function attemptClickBook(trainBlock, classCode, useSlowMode) {
        if (sjBookAttempted) return;
        sjBookAttempted = true;

        const bookButton = findTargetBookBtn(trainBlock, classCode);

        if (
            isJourneyLoaderVisible() ||
            !bookButton ||
            bookButton.disabled ||
            bookButton.classList.contains("disable-book")
        ) {
            log("❌ BOOK abhi ready nahi — sync loop continue…");
            sjBookAttempted = false;
            waitForLoaderAndBook(trainBlock, classCode, useSlowMode);
            return;
        }

        const label = (
            bookButton.closest(".class-card")?.querySelector(".class-code")?.textContent ||
            classCode ||
            ""
        ).trim();
        log("✅ BOOK pe mouse click:", label);
        await mouseClickEl(bookButton, useSlowMode ? 58 : 50);

        // BOOK ke baad loader clear / passenger page — tab hi script aage
        await sleep(150);
        const loaderOk = await waitAfterBookLoaderClear(120000);
        if (!loaderOk) {
            log("BOOK ke baad loader wait incomplete.");
        }

        selectJourneyRunning = false;
        log("✅ selectJourney done (BOOK + loader clear).");
    }

    /**
     * Same architecture as content_script.js selectJourney:
     * fastClick → MutationObserver (loader) → next click → high-load retry
     * Beta elements: class chip → Check Availability → class-card BOOK
     */
    async function selectJourney() {
        if (selectJourneyRunning) {
            log("selectJourney already running — skip.");
            return false;
        }
        selectJourneyRunning = true;
        sjBookAttempted = false;
        disconnectSjObservers();
        removeOceanBanner();
        log("selectJourney shuru…", location.href);

        try {
            const data = await getStorage(["journey_details", "travel_preferences", "other_preferences"]);
            const journey = data.journey_details || {};
            const prefs = data.travel_preferences || {};
            const otherPrefs = data.other_preferences || journey.other_preferences || {};
            const trainNoRaw = journey["train-no"];
            if (!trainNoRaw) {
                console.warn("[OCEAN Beta] train-no missing in journey_details");
                selectJourneyRunning = false;
                return false;
            }

            await waitForTrainCards();

            const trainBlock = findTrainCard(trainNoRaw);
            if (!trainBlock) {
                console.warn("[OCEAN Beta] Train list me nahi mili — retry:", trainNoRaw);
                retrySelectJourney();
                return false;
            }

            trainBlock.scrollIntoView({ behavior: "smooth", block: "center" });
            log("Train found:", String(trainNoRaw).split("-")[0]);

            if (prefs.AvailabilityCheck === "M") {
                log("AvailabilityCheck=M — manual.");
                selectJourneyRunning = false;
                return true;
            }

            await waitForBookingClock(journey, prefs, otherPrefs);
            removeOceanBanner();

            const useSlowMode = !!(otherPrefs.useSlowMode === true || otherPrefs.useSlowMode === "true");
            const classCode = (journey.class || "").trim().toUpperCase();
            log("Target class:", classCode || "(none)", "| mouse clicks only");

            // Agar Available Classes pehle se open + BOOK ready → seedha book (skip re-fetch)
            const alreadyBook = findTargetBookBtn(trainBlock, classCode);
            if (alreadyBook && !isJourneyLoaderVisible()) {
                await attemptClickBook(trainBlock, classCode, useSlowMode);
                return true;
            }

            // ─── HIGH LOAD CATCHER (content.js jaisa, pehle click ke turant baad) ───
            sjHighLoadCatcher = new MutationObserver((_mutations, obs) => {
                if (!isHighLoadToast()) return;
                log("🚨 Error toast (click ke baad)! Retry…");
                obs.disconnect();
                disconnectSjObservers();
                closeHighLoadToast();
                retrySelectJourney();
            });
            sjHighLoadCatcher.observe(document.body, { childList: true, subtree: true });

            // Step A (like nget class tab): class chip if present
            const classChip = classCode ? findClassChip(trainBlock, classCode) : null;
            if (classChip) {
                log("✅ Class chip mouse click:", classCode);
                await mouseClickEl(classChip, useSlowMode ? 58 : 50);
            }

            // Step B (like nget date): Check Availability — observer se loader clear hote hi
            let availClicked = false;
            let classLoaderFinished = false;

            const clickAvailabilityThenWaitBook = async () => {
                if (availClicked) return;
                const availBtn = findCheckAvailabilityBtn(trainBlock);
                // Classes already expanded (BOOK dikh raha) → seedha book wait
                if (!availBtn && findTargetBookBtn(trainBlock, classCode)) {
                    availClicked = true;
                    if (sjHighLoadCatcher) try { sjHighLoadCatcher.disconnect(); } catch (_) { /* */ }
                    waitForLoaderAndBook(trainBlock, classCode, useSlowMode);
                    return;
                }
                if (!availBtn) return;

                availClicked = true;
                if (sjMainObserver) try { sjMainObserver.disconnect(); } catch (_) { /* */ }
                sjMainObserver = null;
                if (sjHighLoadCatcher) try { sjHighLoadCatcher.disconnect(); } catch (_) { /* */ }

                log("✅ Check Availability mouse click…");
                await mouseClickEl(availBtn, useSlowMode ? 58 : 50);

                waitForLoaderAndBook(trainBlock, classCode, useSlowMode);
            };

            sjMainObserver = new MutationObserver(async () => {
                if (isHighLoadToast()) {
                    log("🚨 High Load (main observer)! Retry…");
                    disconnectSjObservers();
                    closeHighLoadToast();
                    retrySelectJourney();
                    return;
                }

                const loaderVisible = isJourneyLoaderVisible();
                if (!loaderVisible && !classLoaderFinished) {
                    classLoaderFinished = true;
                }

                if (classLoaderFinished && !availClicked) {
                    // Class chip ke baad loader clear → Availability; ya chip nahi to pehle tick pe
                    await clickAvailabilityThenWaitBook();
                }
            });
            sjMainObserver.observe(trainBlock, {
                childList: true,
                subtree: true,
                attributes: true,
                characterData: true,
            });

            // Chip nahi mila → turant Check Availability (date-step jaisa seedha)
            if (!classChip) {
                classLoaderFinished = true;
                await clickAvailabilityThenWaitBook();
            } else if (!isJourneyLoaderVisible()) {
                // Chip click ke baad loader kabhi nahi aaya
                classLoaderFinished = true;
                await clickAvailabilityThenWaitBook();
            }

            // Observers async finish karenge — yahan true = flow arm ho gaya
            return true;
        } catch (e) {
            console.error("[OCEAN Beta] selectJourney failed:", e);
            disconnectSjObservers();
            selectJourneyRunning = false;
            return false;
        }
    }

    // ─── fillPassengerDetails (BG: booking/psgninput) ─────────

    // Exact UI text (screenshots): Male / Female / Transgender
    const GENDER_LABEL = {
        M: "Male", F: "Female", T: "Transgender",
        Male: "Male", Female: "Female", Transgender: "Transgender"
    };
    const BERTH_LABEL = {
        LB: "Lower", MB: "Middle", UB: "Upper",
        SL: "Side Lower", SU: "Side Upper",
        WS: "Window Side", NP: "No Preference",
        Lower: "Lower", Middle: "Middle", Upper: "Upper"
    };

    let fillPassengerRunning = false;

    async function waitForPassengerPage(timeoutMs = 25000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (
                document.querySelector("app-passenger-input") ||
                document.querySelector("div.row.psgn-main-grid") ||
                document.querySelector("button.btn.btn-new-passenger")
            ) {
                return true;
            }
            await sleep(250);
        }
        return false;
    }

    async function waitForAddPassengerModal(timeoutMs = 10000) {
        const modal = await waitForElVisible("div.ap-container", timeoutMs);
        if (modal) return modal;
        return waitForElVisible("input[formcontrolname='passengerAge']", Math.min(4000, timeoutMs));
    }

    async function openNewPassengerModal() {
        const btn = await waitForElVisible("button.btn.btn-new-passenger", 12000);
        if (!btn) {
            console.warn("[OCEAN Beta] + New Passenger button not found");
            return false;
        }
        await debuggerClick("button.btn.btn-new-passenger");
        await sleep(500);
        const modal = await waitForAddPassengerModal();
        return !!modal;
    }

    async function selectDropdownOptionByLabel(fieldHintRegex, optionLabel) {
        const label = String(optionLabel || "").trim();
        const boxes = Array.from(document.querySelectorAll(
            "div.ap-field-box, div.ap-field-box--dropdown, div[role='combobox'], select"
        )).filter(isVisible);

        let box = boxes.find((el) => fieldHintRegex.test((el.innerText || el.textContent || "").toUpperCase()));
        if (!box) {
            box = boxes.find((el) => fieldHintRegex.test((el.getAttribute("aria-label") || "").toUpperCase()));
        }

        if (!box) {
            return clickMatchingOption(label);
        }

        const sel = markTempId(box, "ocean-psg-dd");
        await debuggerClick(sel);
        await sleep(350);
        const ok = await clickMatchingOption(label, 5000);
        if (ok) return true;

        // Fallback: first letter + Enter (slow path — avoid when option click works)
        log("Option click miss, key fallback for", label);
        await debuggerKeyPress(label.charAt(0).toUpperCase());
        await sleep(150);
        await debuggerKeyPress("\r");
        await sleep(200);
        return true;
    }

    async function selectGenderFast(genderCode) {
        const label = GENDER_LABEL[genderCode] ||
            GENDER_LABEL[String(genderCode || "").toUpperCase()] ||
            "Male";

        // Gender field inside Add Passenger modal
        const boxes = Array.from(document.querySelectorAll(
            "div.ap-container div.ap-field-box, div.ap-container div.ap-field-box--dropdown"
        )).filter(isVisible);
        const genderBox = boxes.find((el) => /GENDER/i.test(el.innerText || ""));
        if (!genderBox) {
            console.warn("[OCEAN Beta] Gender field not found");
            return false;
        }

        log("Open Gender → select", label);
        await debuggerClick(markTempId(genderBox, "ocean-psg-gender"));
        await sleep(300);

        // Wait until Male/Female/Transgender list visible, then debugger-click exact label
        const ok = await clickMatchingOption(label, 4000);
        if (ok) {
            await sleep(150);
            return true;
        }

        // Direct exact-node scan (screenshot list)
        const hit = Array.from(document.querySelectorAll("div, li, span, button"))
            .filter(isVisible)
            .find((el) => (el.innerText || "").trim() === label && el.getBoundingClientRect().height < 48);
        if (hit) {
            await debuggerClick(markTempId(hit, "ocean-psg-gender-opt"));
            await sleep(150);
            return true;
        }

        console.warn("[OCEAN Beta] Gender option click failed:", label);
        return false;
    }

    /** BHIM/UPI = radio value="2" → click ui-radiobutton-box (debugger) */
    async function selectBhimUpi() {
        log("Selecting BHIM/UPI (paymentType value=2)…");

        let radioBox = null;
        const radios = document.querySelectorAll(
            "app-booking-payment-preferences p-radiobutton, .payment-options-group p-radiobutton"
        );
        for (const pr of radios) {
            const inp = pr.querySelector('input[type="radio"]');
            if (inp && String(inp.value) === "2") {
                radioBox = pr.querySelector("div[role='radio'], .ui-radiobutton-box");
                break;
            }
        }

        if (!radioBox) {
            const upiOpt = Array.from(document.querySelectorAll("div.payment-option")).find((el) =>
                /BHIM\s*\/\s*UPI|Pay through BHIM/i.test(el.innerText || "")
            );
            radioBox = upiOpt?.querySelector("div[role='radio'], .ui-radiobutton-box") || upiOpt || null;
        }

        if (!radioBox) {
            console.warn("[OCEAN Beta] BHIM/UPI radio not found");
            return false;
        }

        // Already selected?
        if (radioBox.getAttribute("aria-checked") === "true" ||
            radioBox.classList.contains("ui-state-active")) {
            log("BHIM/UPI already selected.");
            return true;
        }

        radioBox.scrollIntoView({ block: "center", inline: "center" });
        await sleep(200);
        await debuggerClick(markTempId(radioBox, "ocean-bhim-upi-radio"));
        await sleep(300);

        const ok = radioBox.getAttribute("aria-checked") === "true" ||
            radioBox.classList.contains("ui-state-active");
        log(ok ? "BHIM/UPI selected." : "BHIM/UPI click sent (verify UI).");
        return true;
    }

    async function addOnePassenger(psgn, index) {
        log(`Passenger ${index + 1}:`, psgn.name);

        const opened = await openNewPassengerModal();
        if (!opened) return false;

        // Name
        let nameSel = resolveSelector([
            "div.ap-container input[placeholder*='Full Name']",
            "p-autocomplete[formcontrolname='passengerName'] input",
            "div.ap-container input[role='searchbox']",
            "input[placeholder='Full Name as per Govt. ID']"
        ]);
        if (!nameSel) {
            const nameEl = document.querySelector("div.ap-container input[type='text']") ||
                document.querySelector("p-autocomplete[formcontrolname='passengerName'] input");
            if (nameEl) nameSel = markTempId(nameEl, "ocean-psg-name");
        }
        if (!nameSel) {
            console.warn("[OCEAN Beta] Name input not found");
            return false;
        }
        if (!await lexusDirectFill(nameSel, psgn.name)) await debuggerType(nameSel, psgn.name);
        await sleep(250);

        // Age
        let ageSel = resolveSelector([
            "div.ap-container input[formcontrolname='passengerAge']",
            "input[formcontrolname='passengerAge']",
            "input[placeholder='Enter your age']"
        ]);
        if (!ageSel) {
            const ageEl = document.querySelector("input[formcontrolname='passengerAge']");
            if (ageEl) ageSel = markTempId(ageEl, "ocean-psg-age");
        }
        if (ageSel) {
            if (!await lexusDirectFill(ageSel, String(psgn.age))) await debuggerType(ageSel, String(psgn.age));
            await sleep(350); // validateChildBerth settle
        }

        // Gender — exact Male/Female (debugger), no slow MALE mismatch
        await selectGenderFast(psgn.gender);
        await sleep(200);

        // Preferences = berth preference in modal
        if (psgn.berth) {
            const berthLabel = BERTH_LABEL[psgn.berth] ||
                BERTH_LABEL[String(psgn.berth || "").toUpperCase()] ||
                psgn.berth;
            await selectDropdownOptionByLabel(/PREFERENCES|BERTH/, berthLabel);
            await sleep(200);
        }

        // Add
        const addBtn = await waitForElVisible("button.btn.ap-add-btn.w-100, button.ap-add-btn", 8000);
        if (!addBtn) {
            console.warn("[OCEAN Beta] Add button not found in passenger modal");
            return false;
        }
        const addSel = resolveSelector(["button.btn.ap-add-btn.w-100", "button.ap-add-btn"]) ||
            markTempId(addBtn, "ocean-psg-add");
        log("Clicking Add…");
        await debuggerClick(addSel);
        await sleep(600);
        // Strict loader only — broad [class*='loader'] false timeout avoid
        await waitLoaderIfPresent(90000);
        return true;
    }

    async function setPassengerPreferences(prefs) {
        // Confirm berths
        if (prefs.confirmberths === true || prefs.confirmberths === "true") {
            const box = document.querySelector("p-checkbox[formcontrolname='bookOnlyIfCnf'] div[role='checkbox']");
            if (box && isVisible(box) && box.getAttribute("aria-checked") !== "true" && !box.classList.contains("ui-state-active")) {
                const sel = markTempId(box, "ocean-cnf-berth");
                log("Enable confirm berths…");
                await debuggerClick(sel);
                await sleep(200);
            }
        }

        // Auto upgradation
        if (prefs.autoUpgradation === true || prefs.autoUpgradation === "true") {
            const box = document.querySelector("p-checkbox[formcontrolname='autoUpgradationSelected'] div[role='checkbox']");
            if (box && isVisible(box) && box.getAttribute("aria-checked") !== "true" && !box.classList.contains("ui-state-active")) {
                const sel = markTempId(box, "ocean-auto-upg");
                log("Enable auto upgradation…");
                await debuggerClick(sel);
                await sleep(200);
            }
        }

        // Mobile (best-effort)
        const mobile = prefs.mobileNumber;
        if (mobile) {
            const mobSel = resolveSelector([
                "input#mobileNumber",
                "input[formcontrolname='mobileNumber']",
                "input[type='tel']"
            ]);
            if (mobSel) {
                log("Fill mobile…");
                await debuggerType(mobSel, String(mobile));
                await sleep(200);
            }
        }

        // BHIM/UPI — radio value=2 (HTML: paymentType)
        const pay = String(prefs.paymentmethod || "");
        if (/upi/i.test(pay)) {
            await selectBhimUpi();
        }
    }

    /** Beta review page reached after Calculate Fare (content.js app-review-booking jaisa) */
    function isReviewPageReady() {
        if (location.href.includes("booking/reviewBooking")) return true;
        if (document.querySelector("app-review-booking, app-boarding-station")) return true;
        for (const b of document.querySelectorAll(".cta-row button.btn-payment, button.btn.btn-payment")) {
            const t = (b.textContent || "").replace(/\s+/g, " ").trim();
            if (/continue\s*to\s*payment/i.test(t) && isVisible(b)) return true;
        }
        return false;
    }

    function getCalculateFareBtn() {
        const bySel = resolveSelector([
            "button.btn.btn-calc-fare",
            "button.btn-calc-fare"
        ]);
        if (bySel) return document.querySelector(bySel);
        return Array.from(document.querySelectorAll("button")).find(
            (b) => /calculate\s*fare/i.test(b.innerText || "") && isVisible(b) && !b.disabled
        ) || null;
    }

    async function clickCalculateFareBtn() {
        const calc = getCalculateFareBtn();
        if (!calc) {
            console.warn("[OCEAN Beta] Calculate Fare button not found — fail (no bottom scroll)");
            return false;
        }
        try {
            calc.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
        } catch (_) {
            try {
                calc.scrollIntoView({ block: "center", inline: "nearest" });
            } catch (_) {}
        }
        await sleep(150);
        const sel = markTempId(calc, "ocean-calc-fare");
        log("Debugger click: Calculate Fare (into view)…");
        await debuggerClick(sel);
        return true;
    }

    /**
     * content_script.js attemptPassengerSubmit jaisa:
     * - Fixed 20s loader timeout NAHI
     * - Loader jitna bhi der chale (50s–1min+) — observer chalta rahega
     * - High Load toast → toast band → dubara Calculate Fare click
     * - Review page aayi → success
     */
    async function attemptCalculateFareSubmit() {
        const clicked = await clickCalculateFareBtn();
        if (!clicked) return false;

        return new Promise((resolve) => {
            let settled = false;
            const finish = (ok) => {
                if (settled) return;
                settled = true;
                try { observer.disconnect(); } catch (_) { /* */ }
                resolve(!!ok);
            };

            const tick = async () => {
                if (settled) return;

                if (isHighLoadToast()) {
                    log("🚨 Calculate Fare — High Load / retry error! Dubara click…");
                    settled = true;
                    try { observer.disconnect(); } catch (_) { /* */ }
                    closeHighLoadToast();
                    await sleep(400);
                    const retryOk = await attemptCalculateFareSubmit();
                    resolve(retryOk);
                    return;
                }

                if (isReviewPageReady()) {
                    log("✅ Review page reached — Calculate Fare success.");
                    finish(true);
                }
            };

            const observer = new MutationObserver(() => {
                tick();
            });
            observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                characterData: true,
            });

            // Turant check — kabhi review pehle se load ho
            tick();
        });
    }

    async function fillPassengerDetails() {
        if (fillPassengerRunning) {
            log("fillPassengerDetails already running — skip.");
            return false;
        }
        fillPassengerRunning = true;
        log("fillPassengerDetails() started…", location.href);

        try {
            const ready = await waitForPassengerPage();
            if (!ready) {
                console.warn("[OCEAN Beta] Passenger page not found");
                return false;
            }
            await sleep(500);

            const data = await getStorage(["passenger_details", "other_preferences"]);
            const passengers = (data.passenger_details || []).filter((p) => p && p.name && p.age);
            const prefs = data.other_preferences || {};

            if (!passengers.length) {
                console.warn("[OCEAN Beta] No passenger_details in storage. Save Passenger section in popup.");
                return false;
            }

            for (let i = 0; i < passengers.length; i++) {
                const ok = await addOnePassenger(passengers[i], i);
                if (!ok) {
                    console.warn("[OCEAN Beta] Failed adding passenger", i + 1);
                    // continue others
                }
                await sleep(400);
            }

            await setPassengerPreferences(prefs);

            if (prefs.psgManual === true || prefs.psgManual === "true") {
                log("psgManual ON — skip Calculate Fare / submit.");
                return true;
            }

            // content.js jaisa: observer + high-load retry, NO 20s loader timeout
            const submitted = await attemptCalculateFareSubmit();
            if (!submitted) {
                console.warn("[OCEAN Beta] Calculate Fare submit nahi hua.");
                return false;
            }

            log("✅ fillPassengerDetails done.");
            return true;
        } catch (e) {
            console.error("[OCEAN Beta] fillPassengerDetails failed:", e);
            return false;
        } finally {
            fillPassengerRunning = false;
        }
    }

    // ─── reviewBooking / bkgPaymentOptions (URL detect → turant, debugger click) ───
    let reviewBookingRunning = false;
    let bkgPaymentRunning = false;

    /** Element milte hi resolve — fixed 500/600ms sleep nahi */
    function waitForElInstant(finder, timeoutMs = 20000) {
        return new Promise((resolve) => {
            const t0 = Date.now();
            let done = false;
            const finish = (el) => {
                if (done) return;
                done = true;
                try { observer.disconnect(); } catch (_) { /* */ }
                clearInterval(pollId);
                resolve(el || null);
            };
            const tick = () => {
                if (Date.now() - t0 > timeoutMs) {
                    finish(finder());
                    return;
                }
                try {
                    const el = finder();
                    if (el) finish(el);
                } catch (_) { /* */ }
            };
            const observer = new MutationObserver(tick);
            observer.observe(document.body, { childList: true, subtree: true, attributes: true });
            const pollId = setInterval(tick, 40);
            tick();
        });
    }

    /** Loader hai tab hi wait — warna 0 delay (pehle se 1.2s loader hunt nahi) */
    async function waitLoaderIfPresent(timeoutMs = 12000) {
        if (!isJourneyLoaderVisible()) return;
        const t0 = Date.now();
        while (Date.now() - t0 < timeoutMs) {
            if (!isJourneyLoaderVisible()) return;
            await sleep(40);
        }
    }

    function findContinueToPaymentBtn() {
        const inCta = document.querySelectorAll(".cta-row button.btn-payment, .cta-row button.btn.btn-payment");
        for (const b of inCta) {
            const t = (b.textContent || "").replace(/\s+/g, " ").trim();
            if (/continue\s*to\s*payment/i.test(t) && isVisible(b) && !b.disabled) return b;
        }
        for (const b of document.querySelectorAll("button.btn.btn-payment, button.btn-payment")) {
            const t = (b.textContent || "").replace(/\s+/g, " ").trim();
            if (/continue\s*to\s*payment/i.test(t) && isVisible(b) && !b.disabled) return b;
        }
        return null;
    }

    async function reviewBooking() {
        if (reviewBookingRunning) {
            log("reviewBooking already running — skip.");
            return true;
        }
        reviewBookingRunning = true;
        log("reviewBooking()…", location.href);
        try {
            await waitLoaderIfPresent(15000);
            await sleep(600);

            for (let attempt = 1; attempt <= 4; attempt++) {
                if (!location.href.includes("reviewBooking")) {
                    log("Left reviewBooking — ok.");
                    return true;
                }

                const btn = await waitForElInstant(findContinueToPaymentBtn, 20000);
                if (!btn) {
                    log("❌ Continue To Payment button not found.");
                    return false;
                }

                // Fresh mark each attempt (Angular may re-render)
                const sel = markTempId(btn, "ocean-continue-payment");
                log(`Debugger click: Continue To Payment (try ${attempt}/4)…`, sel);
                try {
                    // Slightly lower hit — sticky headers / overlays
                    await debuggerClick(sel, 50, 60);
                } catch (e) {
                    console.warn("[OCEAN Beta] Continue click error:", e && e.message ? e.message : e);
                }

                await sleep(900);
                if (!location.href.includes("reviewBooking")) {
                    log("✅ reviewBooking — navigated after Continue.");
                    return true;
                }
                // Still here — maybe captcha / validation; retry
                log("Still on reviewBooking after click — retry…");
                await sleep(500);
            }

            log("⚠️ Continue To Payment — retries exhausted, still on review.");
            return false;
        } catch (e) {
            console.error("[OCEAN Beta] reviewBooking failed:", e);
            return false;
        } finally {
            reviewBookingRunning = false;
        }
    }

    function normalizePaymentKey(raw) {
        return String(raw || "").trim().toUpperCase();
    }

    /** Read popup payment choice from storage (same keys as content.js) */
    function readPaymentPrefs(data) {
        const journey = data?.journey_details || {};
        const op = data?.other_preferences || journey.other_preferences || {};
        return {
            primary: op.paymentmethod || op.paymentMethod || "",
            backup: op.backup_payment_method || op.backupPaymentMethod || "",
            paymentManual: op.paymentManual === true || op.paymentManual === "true",
            secSelectionDelay: parseInt(op.secSelectionDelay || "0", 10) || 0,
            raw: op,
        };
    }

    /**
     * Same keys as content_script.js / popup paymentMethod —
     * mapped to beta: .payment-section + .bank-cell / .payment-card
     */
    function resolveBetaPaymentMapping(methodKey) {
        const key = normalizePaymentKey(methodKey);

        // Paytm QR / Paytm UPI ID — ONLY "Paytm UPI" under UPI / BHIM (hardcoded jo kaam karta tha)
        if (key.includes("PAYTMUPI") || key === "PAYTM" || key === "PAYTMUPIQR" || key === "PAYTMUPIID") {
            return {
                key,
                sectionHint: /upi\s*\/\s*bhim|bhim\s*upi|ussd/i,
                optionLabels: ["Paytm UPI"],
                sectionStrict: true,
                neverIpay: true,
            };
        }
        if (key.includes("PHONEPE")) {
            return {
                key,
                sectionHint: /multiple\s*payment/i,
                optionLabels: ["PhonePe"],
                sectionStrict: true,
                neverIpay: true,
            };
        }
        if (key.includes("RAZORPAY")) {
            return {
                key,
                sectionHint: /multiple\s*payment/i,
                optionLabels: ["Razorpay"],
                sectionStrict: true,
                neverIpay: true,
            };
        }
        if (key.includes("PAYUUPI") || key === "PAYU" || key === "PAYUUPIID") {
            return {
                key,
                sectionHint: /multiple\s*payment/i,
                optionLabels: ["PayU", "Payu"],
                sectionStrict: true,
                neverIpay: true,
            };
        }
        if (key.includes("AMZPAY") || key.includes("AMAZON")) {
            return {
                key,
                sectionHint: /upi\s*\/\s*bhim|bhim\s*upi|ussd|wallet/i,
                optionLabels: ["Amazon Pay", "Amazonpay"],
                sectionStrict: true,
                neverIpay: true,
            };
        }
        if (key.includes("MOBIKWIK")) {
            return {
                key,
                sectionHint: /wallet|multiple\s*payment|upi/i,
                optionLabels: ["Mobikwik", "Mobikwik Wallet"],
                neverIpay: true,
            };
        }
        if (key.includes("HDFCDB") || key.includes("KOTAK") || key === "ICICI_DC" || key.includes("IRCTC_DC") || key === "IRCTC_DC") {
            return {
                key,
                sectionHint: /irctc\s*ipay/i,
                optionLabels: ["IRCTC iPay", "IRCTC"],
                preferIpayCard: true,
            };
        }
        if (key.includes("SBINET") || key.includes("HDFCNET") || key.includes("NETBANKING")) {
            return {
                key,
                sectionHint: /irctc\s*ipay|net\s*bank/i,
                optionLabels: ["IRCTC iPay", "State Bank of India", "SBI", "ICICI"],
                preferIpayCard: true,
            };
        }
        if (key.includes("IRCWA") || key.includes("EWALLET")) {
            return {
                key,
                sectionHint: /wallet|e-?wallet|irctc/i,
                optionLabels: ["IRCTC eWallet", "IRCTC e-Wallet", "eWallet", "IRCTC iPay"],
                preferIpayCard: true,
            };
        }
        // IRCUPIQR — iPay card + "Click to pay" (QR inline); Pay & Book skip
        if (key === "IRCUPIQR" || key.includes("IRCUPIQR")) {
            return {
                key,
                sectionHint: /irctc\s*ipay/i,
                optionLabels: ["IRCTC iPay", "IRCTC"],
                preferIpayCard: true,
                useIpayQrFlow: true,
            };
        }
        // IRCUPIID / irctc_dc — IRCTC iPay + Pay & Book
        if (key.includes("IRCUPI") || key === "IRCTC_DC" || key.includes("IRCTC_DC") || key === "IRCUPIID") {
            return {
                key,
                sectionHint: /irctc\s*ipay/i,
                optionLabels: ["IRCTC iPay", "IRCTC"],
                preferIpayCard: true,
            };
        }

        // Unknown — null map (caller must not invent iPay for Paytm users)
        return {
            key,
            sectionHint: null,
            optionLabels: [],
            preferIpayCard: false,
            neverIpay: true,
        };
    }

    function findIpayCard() {
        const ipayDirect = document.querySelector(".payment-card.ipay-card, .ipay-card");
        if (ipayDirect && isVisible(ipayDirect)) return ipayDirect;
        const cards = document.querySelectorAll(
            ".payment-card, .irctc-col-right .payment-card, .payment-wrapper .payment-card"
        );
        for (const card of cards) {
            const t = (card.textContent || "").replace(/\s+/g, " ");
            if (/irctc\s*ipay/i.test(t) && isVisible(card)) return card;
        }
        const img = document.querySelector('img.payment-logo[alt*="iPay" i], img[alt*="IRCTC iPay" i]');
        if (img) {
            const card = img.closest(".payment-card, .bank-cell, .irctc-col-right");
            if (card && isVisible(card)) return card;
        }
        return null;
    }

    /**
     * Hardcoded-style find: alt / text exact on .bank-cell inside matching section.
     * Paytm QR → only "Paytm UPI" in UPI / BHIM — kabhi iPay nahi.
     */
    function findBetaPaymentOption(mapping) {
        if (!mapping) return null;

        if (mapping.preferIpayCard && !mapping.neverIpay) {
            const ipay = findIpayCard();
            if (ipay) return { el: ipay, label: "IRCTC iPay", section: "IRCTC iPay" };
        }

        const sections = Array.from(document.querySelectorAll(".payment-section")).filter(isVisible);
        const preferred = mapping.sectionHint
            ? sections.filter((s) => {
                const heading = (s.querySelector(".section-heading")?.textContent || "").trim();
                // Prefer heading only (not full section text — avoids false section match)
                return heading && mapping.sectionHint.test(heading);
            })
            : [];

        const roots = mapping.sectionStrict
            ? (preferred.length ? preferred : [])
            : [...preferred, ...sections.filter((s) => !preferred.includes(s))];

        // sectionStrict + preferred empty → not ready yet (null → waitForElInstant retry)
        if (mapping.sectionStrict && !roots.length) return null;

        for (const label of mapping.optionLabels || []) {
            const want = label.trim().toLowerCase();
            if (!want) continue;

            for (const root of roots) {
                if (/irctc\s*ipay/i.test(label) && !mapping.neverIpay) {
                    const cards = root.querySelectorAll(".payment-card");
                    for (const card of cards) {
                        if (/irctc\s*ipay/i.test(card.textContent || "") && isVisible(card)) {
                            return { el: card, label: "IRCTC iPay", section: "IRCTC iPay" };
                        }
                    }
                }

                for (const cell of root.querySelectorAll(".bank-cell")) {
                    if (!isVisible(cell)) continue;
                    const alt = (cell.querySelector("img.bank-logo, .bank-card img")?.getAttribute("alt") || "")
                        .trim()
                        .toLowerCase();
                    const text = (cell.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
                    // Exact first (Paytm UPI ≠ Paytm)
                    if (alt === want || text === want) {
                        const secName = (root.querySelector(".section-heading")?.textContent || "").trim();
                        return { el: cell, label, section: secName || "?" };
                    }
                }
            }

            // Loose match only if label has space (e.g. "Paytm UPI") — still same section
            if (want.includes(" ")) {
                for (const root of roots) {
                    for (const cell of root.querySelectorAll(".bank-cell")) {
                        if (!isVisible(cell)) continue;
                        const alt = (cell.querySelector("img.bank-logo, .bank-card img")?.getAttribute("alt") || "")
                            .trim()
                            .toLowerCase();
                        const text = (cell.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
                        if (alt.includes(want) || text.includes(want)) {
                            const secName = (root.querySelector(".section-heading")?.textContent || "").trim();
                            return { el: cell, label, section: secName || "?" };
                        }
                    }
                }
            }
        }

        // Non-strict: last resort body search (still skip iPay if neverIpay)
        if (!mapping.sectionStrict) {
            for (const label of mapping.optionLabels || []) {
                const want = label.trim().toLowerCase();
                for (const cell of document.querySelectorAll(".bank-cell")) {
                    if (!isVisible(cell)) continue;
                    const alt = (cell.querySelector("img.bank-logo, .bank-card img")?.getAttribute("alt") || "")
                        .trim()
                        .toLowerCase();
                    const text = (cell.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
                    if (alt === want || text === want) {
                        return { el: cell, label, section: "body" };
                    }
                }
            }
            if (mapping.preferIpayCard && !mapping.neverIpay) {
                const ipay = findIpayCard();
                if (ipay) return { el: ipay, label: "IRCTC iPay", section: "IRCTC iPay" };
            }
        }

        return null;
    }

    function isIpayQrFlowMethod(methodKey) {
        const key = normalizePaymentKey(methodKey);
        return key === "IRCUPIQR" || key.includes("IRCUPIQR");
    }

    /** Beta iPay QR — "Click to pay" opens QR on same page (no Pay & Book). */
    function findIpayQrPayButton() {
        for (const b of document.querySelectorAll("button.ipay-qr-button, .ipay-qr button[type='button']")) {
            const t = (b.textContent || "").replace(/\s+/g, " ").trim();
            if (/click\s*to\s*pay/i.test(t) && isVisible(b) && !b.disabled) return b;
        }
        const qrWrap = document.querySelector(".ipay-card .ipay-qr, .payment-card.ipay-card .ipay-qr");
        if (qrWrap && isVisible(qrWrap)) {
            const btn = qrWrap.querySelector("button.ipay-qr-button, button");
            if (btn && isVisible(btn) && !btn.disabled) return btn;
        }
        return null;
    }

    function findPayAndBookBtn() {
        for (const b of document.querySelectorAll("button.btn.btn-payment, button.btn-payment, button[type='button'].btn-payment")) {
            const t = (b.textContent || "").replace(/\s+/g, " ").trim();
            if (/pay\s*&\s*book|pay\s*and\s*book/i.test(t) && isVisible(b) && !b.disabled) return b;
        }
        return null;
    }

    /** content.js handlePaymentFlow — select gateway by user key, then Pay & Book */
    async function executeBetaPayment(methodKey) {
        if (!methodKey) {
            log("❌ executeBetaPayment: empty method key");
            return false;
        }
        const mapping = resolveBetaPaymentMapping(methodKey);
        if (!(mapping.optionLabels || []).length && !mapping.preferIpayCard) {
            log("❌ Unknown payment method key:", methodKey);
            return false;
        }
        log(
            "Payment map:",
            mapping.key,
            "| labels:",
            (mapping.optionLabels || []).join(", "),
            mapping.sectionStrict ? "(sectionStrict)" : "",
            mapping.neverIpay ? "(never iPay)" : ""
        );

        const found = await waitForElInstant(() => {
            const hit = findBetaPaymentOption(mapping);
            return hit ? hit.el : null;
        }, 20000);

        if (!found) {
            log("❌ Payment option nahi mila:", methodKey, mapping.optionLabels);
            return false;
        }

        const hit = findBetaPaymentOption(mapping);
        const el = hit?.el || found;
        const clickTarget = el.querySelector?.(".bank-card") || el;
        const bankSel = markTempId(clickTarget, "ocean-pay-bank");
        log("Debugger click payment:", hit?.label || mapping.optionLabels[0], "| section:", hit?.section || "?");
        await debuggerClick(bankSel);
        return true;
    }

    function showCustomConfirm(message, onYes, onNo) {
        const existing = document.getElementById("ocean-custom-confirm");
        if (existing) existing.remove();

        const confirmDiv = document.createElement("div");
        confirmDiv.id = "ocean-custom-confirm";
        confirmDiv.style.cssText = `
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            background-color: #fff; border: 1px solid #ccc; border-radius: 8px;
            box-shadow: 0 4px 8px rgba(0,0,0,0.25); padding: 22px; z-index: 9999999;
            text-align: center; font-family: sans-serif; max-width: 92%; width: 360px;
        `;
        confirmDiv.innerHTML = `
            <p style="font-size:16px;font-weight:600;margin:0 0 16px;line-height:1.4;">${message}</p>
            <button id="ocean-confirm-yes" style="padding:8px 18px;background:#16a34a;color:#fff;border:none;border-radius:6px;margin-right:10px;cursor:pointer;font-weight:600;">Yes</button>
            <button id="ocean-confirm-no" style="padding:8px 18px;background:#dc2626;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;">No</button>
        `;
        document.body.appendChild(confirmDiv);
        document.getElementById("ocean-confirm-yes").onclick = () => {
            confirmDiv.remove();
            if (onYes) onYes();
        };
        document.getElementById("ocean-confirm-no").onclick = () => {
            confirmDiv.remove();
            if (onNo) onNo();
        };
    }

    /** Beta payment page fare from Payable Amount (₹4,319.05) */
    function readPayableAmount() {
        const sels = [
            ".payable-amount",
            ".payable-total",
            ".payment-wrapper .payable-amount",
            "app-journey-details .payable-total",
        ];
        for (const sel of sels) {
            const el = document.querySelector(sel);
            if (!el) continue;
            const m = (el.textContent || "").replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
            if (m) {
                const n = parseFloat(m[1]);
                if (!isNaN(n) && n > 0) return n;
            }
        }
        return 0;
    }

    /**
     * fare_limit ON + payable > max → Yes/No dialog (content.js jaisa).
     * ONLY Premium Tatkal (PT) — TQ / GN / baaki quotas pe skip.
     * Yes → true (aage badho), No → false (payment proceed mat karo).
     */
    async function checkFareLimitOrConfirm() {
        const data = await getStorage(["fare_limit", "journey_details"]);
        const journey = data.journey_details || {};
        const quota = String(journey.quota || "").trim().toUpperCase();

        // Sirf Premium Tatkal (PT)
        if (quota !== "PT") {
            log("PT fare check skip — quota:", quota || "(none)", "(only PT pe chalta hai)");
            return true;
        }

        const fl = data.fare_limit || {};
        if (!(fl.enableFareLimit === true || fl.enableFareLimit === "true")) {
            log("PT quota but fare_limit OFF — skip.");
            return true;
        }

        const maxFare = parseFloat(String(fl.maxFareAmount || "").replace(/,/g, ""));
        if (isNaN(maxFare) || maxFare <= 0) {
            log("fare_limit ON but maxFareAmount invalid — skip check.");
            return true;
        }

        // Payable amount page pe aane do
        const totalFare = await waitForElInstant(() => {
            const amt = readPayableAmount();
            return amt > 0 ? amt : null;
        }, 12000);

        const fare = typeof totalFare === "number" ? totalFare : readPayableAmount();
        if (!fare || fare <= 0) {
            log("Payable amount nahi mila — fare limit skip.");
            return true;
        }

        log("PT fare check: payable ₹" + fare + " | limit ₹" + maxFare);

        if (fare <= maxFare) {
            log("PT fare within limit — continue.");
            return true;
        }

        // Exceeded — Yes / No
        return new Promise((resolve) => {
            showCustomConfirm(
                `Premium Tatkal fare (₹${fare.toLocaleString("en-IN")}) exceeds limit (₹${maxFare.toLocaleString("en-IN")}). Proceed?`,
                () => {
                    log("PT fare limit: user Yes — continue payment.");
                    resolve(true);
                },
                () => {
                    log("PT fare limit: user No — payment stopped.");
                    resolve(false);
                }
            );
        });
    }

    async function bkgPaymentOptions() {
        if (bkgPaymentRunning) {
            log("bkgPaymentOptions already running — skip.");
            return true;
        }
        bkgPaymentRunning = true;
        log("bkgPaymentOptions() — turant (no delay)…", location.href);
        try {
            const storageP = getStorage(["journey_details", "other_preferences", "fare_limit"]);
            await waitLoaderIfPresent(10000);

            // PT fare limit — pehle rukao, phir gateway
            const fareOk = await checkFareLimitOrConfirm();
            if (!fareOk) {
                log("Stopped at payment page (fare limit No).");
                return false;
            }

            const data = await storageP;
            const payPrefs = readPaymentPrefs(data);
            let primaryMethod = payPrefs.primary;
            const backupMethod = payPrefs.backup;

            log("Stored paymentmethod:", primaryMethod || "(empty)", "| backup:", backupMethod || "(none)");

            // Empty → only then IRCTC iPay (content.js default). Paytm QR selected hoga to empty nahi hona chahiye.
            if (!primaryMethod) {
                log("⚠️ paymentmethod empty — default IRCUPIQR (Save Journey / Payment Mode check karo)");
                primaryMethod = "IRCUPIQR";
            }

            let ok = await executeBetaPayment(primaryMethod);
            let usedMethod = primaryMethod;
            // Backup ONLY if primary really failed — aur backup empty na ho
            // Paytm fail pe bina backup IRCTC mat dabao
            if (!ok && backupMethod) {
                log("Primary fail — backup try:", backupMethod);
                usedMethod = backupMethod;
                ok = await executeBetaPayment(backupMethod);
            }
            if (!ok) {
                log("❌ Payment select fail (primary/backup). iPay auto-fallback nahi.");
                return false;
            }

            if (payPrefs.paymentManual) {
                log("paymentManual ON — Pay & Book skip.");
                return true;
            }

            if (payPrefs.secSelectionDelay > 0) {
                log("secSelectionDelay:", payPrefs.secSelectionDelay, "s");
                await sleep(payPrefs.secSelectionDelay * 1000);
            }

            await waitLoaderIfPresent(10000);

            // IRCTC iPay QR — scan / "Click to pay" opens QR inline; Pay & Book not needed
            if (isIpayQrFlowMethod(usedMethod)) {
                const qrBtn = await waitForElInstant(findIpayQrPayButton, 15000);
                if (!qrBtn) {
                    log("❌ iPay QR — 'Click to pay' button not found.");
                    return false;
                }
                const qrSel = markTempId(qrBtn, "ocean-ipay-qr-pay");
                log("Debugger click: iPay QR — Click to pay (Pay & Book skip)…");
                await debuggerClick(qrSel);
                log("✅ bkgPaymentOptions done (iPay QR).");
                return true;
            }

            const payBtn = await waitForElInstant(findPayAndBookBtn, 15000);
            if (!payBtn) {
                log("❌ Pay & Book button not found.");
                return false;
            }

            const paySel = markTempId(payBtn, "ocean-pay-book");
            log("Debugger click: Pay & Book…");
            await debuggerClick(paySel);
            log("✅ bkgPaymentOptions done.");
            return true;
        } catch (e) {
            console.error("[OCEAN Beta] bkgPaymentOptions failed:", e);
            return false;
        } finally {
            bkgPaymentRunning = false;
        }
    }

    // ─── booking-confirm: URL + PNR + CNF → success animation + server ───
    let pnrAnimRunning = false;

    function isBookingConfirmUrl(href) {
        const u = href || location.href;
        return u.includes("/eticket/booking-confirm") || u.includes("booking-confirm");
    }

    /** Best: app-ticket-display .pnr-num */
    function getBetaPnr() {
        const selectors = [
            "app-ticket-display .pnr-num",
            "app-booking-confirmation .pnr-num",
            ".pnr-row .pnr-num",
            ".pnr-num",
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (!el) continue;
            const digits = String(el.textContent || "").replace(/\D/g, "");
            if (digits.length >= 10) return digits;
        }
        return "";
    }

    /** CNF in passenger Booking/Current Status (e.g. CNF/D1/47/NC) */
    function hasBetaCnfStatus() {
        const statuses = document.querySelectorAll(
            "app-journey-details .passenger-status, .passenger-card .passenger-status, .passenger-status"
        );
        for (const el of statuses) {
            const t = String(el.textContent || "").trim().toUpperCase();
            if (!t || t === "BOOKING STATUS" || t === "CURRENT STATUS") continue;
            // CNF/... or standalone CNF — not RAC/WL only
            if (/\bCNF\b/.test(t) || /^CNF\//.test(t)) return true;
        }
        return false;
    }

    /** Optional UI confirm (pill) — CNF still required separately */
    function hasBetaConfirmedPill() {
        const pill = document.querySelector(
            "app-ticket-display .status-pill.confirmed, .status-pill.confirmed, .status-row .status-pill"
        );
        if (!pill) return false;
        const t = String(pill.textContent || "").trim().toLowerCase();
        return t.includes("confirm");
    }

    /**
     * All 3 must be true:
     * 1) booking-confirm URL
     * 2) PNR number visible (.pnr-num)
     * 3) passenger status contains CNF
     */
    function isBetaBookingSuccessReady() {
        if (!isBookingConfirmUrl()) return false;
        const pnr = getBetaPnr();
        if (!pnr) return false;
        if (!hasBetaCnfStatus()) return false;
        return true;
    }

    async function waitForBetaBookingSuccess(timeoutMs = 120000) {
        const startAt = Date.now();
        while (Date.now() - startAt < timeoutMs) {
            if (!isBookingConfirmUrl()) {
                await sleep(400);
                continue;
            }
            const pnr = getBetaPnr();
            const cnf = hasBetaCnfStatus();
            if (pnr && cnf) {
                log("✅ Beta success ready — PNR:", pnr, "| CNF:", cnf, "| pill:", hasBetaConfirmedPill());
                return { pnr, cnf: true };
            }
            await sleep(350);
        }
        log("⏳ Timeout waiting for PNR+CNF on booking-confirm.");
        return null;
    }

    function getBetaFareAmount() {
        const selectors = [
            "app-journey-details .payable-total",
            ".payable-total",
            ".fare-val",
            ".payable-row .payable-total",
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (!el) continue;
            const cleaned = String(el.textContent || "").replace(/[^0-9.]/g, "");
            if (cleaned) return cleaned;
        }
        return "N/A";
    }

    async function showPnrAnimation() {
        if (pnrAnimRunning) {
            log("showPnrAnimation already running — skip.");
            return false;
        }
        pnrAnimRunning = true;
        log("showPnrAnimation() — wait URL+PNR+CNF…", location.href);

        try {
            if (!isBookingConfirmUrl()) {
                log("Not on booking-confirm — abort animation.");
                return false;
            }

            const ready = await waitForBetaBookingSuccess(120000);
            if (!ready) return false;

            // Double-check all 3 conditions
            if (!isBetaBookingSuccessReady()) {
                log("Final check failed (URL/PNR/CNF).");
                return false;
            }

            const storedData = await chrome.storage.local.get(["journey_details", "other_preferences"]);
            const jd = storedData.journey_details || {};
            const op = storedData.other_preferences || {};

            const timeObject = new Date();
            timeObject.setSeconds(timeObject.getSeconds() - 15);
            const pnrTime = timeObject.toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: true,
            });

            const fromParts = jd.from ? jd.from.split("-") : [];
            const toParts = jd.destination ? jd.destination.split("-") : [];
            const dateParts = jd.date ? jd.date.split("-") : [];
            const fromCode = fromParts.length > 1 ? fromParts[1].trim() : jd.from || "";
            const toCode = toParts.length > 1 ? toParts[1].trim() : jd.destination || "";
            const formattedDate =
                dateParts.length === 3 ? `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}` : "";
            const journeyClass = jd.class || "";
            const journeyQuota = jd.quota || "";
            const trainDetails = jd["train-no"] || "Train N/A";
            const journeyDetailsString =
                `${fromCode}-${toCode} ${formattedDate} ${journeyClass} ${journeyQuota}`.trim();

            let paymentMethod = "N/A";
            const paymentKey = op.paymentmethod || "";
            switch (paymentKey) {
                case "PAYTMUPI":
                case "PAYTMUPIID":
                case "PAYTMUPIQR":
                    paymentMethod = "Paytm UPI";
                    break;
                case "PHONEPEUPIQR":
                    paymentMethod = "PhonePe QR";
                    break;
                case "RAZORPAYUPI":
                    paymentMethod = "Razorpay UPI";
                    break;
                case "PAYUUPI":
                    paymentMethod = "PayU UPI";
                    break;
                case "AMZPAYWAL":
                    paymentMethod = "Amazon Pay";
                    break;
                case "HDFCDB":
                    paymentMethod = "HDFC DC";
                    break;
                case "kotak_dc":
                    paymentMethod = "KOTAK DC";
                    break;
                case "icici_dc":
                    paymentMethod = "ICICI DC";
                    break;
                case "MOBIKWIKWAL":
                    paymentMethod = "MOBIKWIK";
                    break;
                case "SBINETBANKING":
                    paymentMethod = "SBI_NB";
                    break;
                case "HDFCNETBANKING":
                    paymentMethod = "HDFC_NB";
                    break;
                case "IRCWA":
                    paymentMethod = "IRCTC eWallet";
                    break;
                case "irctc_dc":
                case "IRCUPIID":
                case "IRCUPIQR":
                    paymentMethod = "IRCTC iPay";
                    break;
                default:
                    paymentMethod = paymentKey || "N/A";
            }

            const fare = getBetaFareAmount();
            const fareString = `FARE,${fare}`;
            const pnrNum = ready.pnr || getBetaPnr();

            log("Success data — PNR:", pnrNum, "Fare:", fare, "Pay:", paymentMethod);

            const newCss = `
            .ocean-tatkal-success-message {
                position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2); z-index: 99999;
                border-radius: 12px; overflow: hidden; text-align: center;
                width: 90%; max-width: 380px; border: 1px solid #ddd;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                animation: slideUp 0.5s ease-out forwards;
            }
            @keyframes slideUp { from { bottom: -100px; opacity: 0; } to { bottom: 20px; opacity: 1; } }
            .ocean-header { background-color: #005A9C; color: #fff; padding: 12px 15px; font-size: 18px; font-weight: bold; }
            .ocean-body {
                background-color: #2E8B57; color: #fff; padding: 20px;
                font-size: 16px; line-height: 1.8; font-weight: bold;
            }
            #ocean-welcome-message {
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
                #ocean-welcome-message {
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

            if (!document.getElementById("ocean-tatkal-style-v2")) {
                const styleElement = document.createElement("style");
                styleElement.id = "ocean-tatkal-style-v2";
                styleElement.textContent = newCss;
                document.head.appendChild(styleElement);
            }

            document.querySelector(".ocean-tatkal-success-message")?.remove();

            const successMessageDiv = document.createElement("div");
            successMessageDiv.className = "ocean-tatkal-success-message ocean-ignore";
            successMessageDiv.innerHTML = `
            <div class="ocean-header">🌊 Success By Ocean Beta 🌊</div>
            <div class="ocean-body">
                <span>${fareString}</span><br>
                <span>PNRTIME: ${pnrTime}</span><br>
                <span>PAYMENT: ${paymentMethod}</span><br>
                <span>${journeyDetailsString}</span><br>
                <span>TRAIN: ${trainDetails}</span>
            </div>
                
        `;
            document.body.appendChild(successMessageDiv);
            log("✅ Success popup shown.");

            try {
                const targetEl = document.querySelector(".ocean-tatkal-success-message");
                if (targetEl && typeof html2canvas === "function") {
                    try {
                        targetEl.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
                        window.scrollBy(0, -40);
                    } catch (_) {}
                    await sleep(500);

                    const prevAnimation = targetEl.style.animation;
                    const prevTransition = targetEl.style.transition;
                    const prevTransform = targetEl.style.transform;
                    targetEl.style.animation = "none";
                    targetEl.style.transition = "none";
                    targetEl.style.transform = "none";

                    const canvas = await html2canvas(targetEl, {
                        backgroundColor: null,
                        useCORS: true,
                        scale: 2,
                    });

                    targetEl.style.animation = prevAnimation;
                    targetEl.style.transition = prevTransition;
                    targetEl.style.transform = prevTransform;

                    const dataUrl = canvas.toDataURL("image/png");
                    const base64Img = dataUrl.replace(/^data:image\/png;base64,/, "");
                    const { licencekey } = await chrome.storage.local.get("licencekey");

                    const successData = {
                        PNR_Time: pnrTime,
                        Gateway: paymentMethod,
                        Src_Dest: journeyDetailsString,
                        TrainNo: trainDetails,
                        UserID: licencekey,
                        base64image: base64Img,
                        PNR: pnrNum,
                    };

                    log("POST /api/app/success", { ...successData, base64image: "[omitted]" });
                    const resp = await fetch("https://oceanxsoft.com/api/app/success", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(successData),
                    });
                    const text = await resp.text();
                    log("Server response:", resp.status, text);
                } else {
                    log("html2canvas missing — skip screenshot upload.");
                }
            } catch (e) {
                console.error("[OCEAN Beta] Screenshot upload error:", e);
            }

            setTimeout(() => {
                document.querySelector("#ocean-welcome-message")?.remove();
                const welcomeMessageDiv = document.createElement("div");
                welcomeMessageDiv.id = "ocean-welcome-message";
                welcomeMessageDiv.className = "ocean-ignore";
                welcomeMessageDiv.textContent = "Thank you for using Ocean Tatkal";
                document.body.appendChild(welcomeMessageDiv);
                log("Welcome animation started.");
            }, 1000);

            return true;
        } catch (e) {
            console.error("[OCEAN Beta] showPnrAnimation failed:", e);
            return false;
        } finally {
            // Keep running flag true so we don't re-fire on same page
            // (reset only if failed before show — allow retry on timeout)
            if (!document.querySelector(".ocean-tatkal-success-message")) {
                pnrAnimRunning = false;
            }
        }
    }

    // Background URL router → same msg shape as nget
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.id !== "irctc") return;
        const type = message?.msg?.type;
        if (!type) return;

        log("BG message received:", type, message.beta ? "(beta)" : "");

        if (type === "selectJourney") {
            selectJourney()
                .then((ok) => sendResponse({ ok: !!ok }))
                .catch((e) => sendResponse({ ok: false, error: String(e) }));
            return true;
        }

        if (type === "fillPassengerDetails") {
            fillPassengerDetails()
                .then((ok) => sendResponse({ ok: !!ok }))
                .catch((e) => sendResponse({ ok: false, error: String(e) }));
            return true;
        }

        if (type === "reviewBooking") {
            reviewBooking()
                .then((ok) => sendResponse({ ok: !!ok }))
                .catch((e) => sendResponse({ ok: false, error: String(e) }));
            return true;
        }

        if (type === "bkgPaymentOptions") {
            bkgPaymentOptions()
                .then((ok) => sendResponse({ ok: !!ok }))
                .catch((e) => sendResponse({ ok: false, error: String(e) }));
            return true;
        }

        if (type === "showPnrAnimation") {
            showPnrAnimation()
                .then((ok) => sendResponse({ ok: !!ok }))
                .catch((e) => sendResponse({ ok: false, error: String(e) }));
            return true;
        }
    });

    async function start() {
        log("Beta content script started:", location.href);
        await waitForWindowLoad();

        if (isBookingConfirmUrl()) {
            log("On booking-confirm at start — wait PNR+CNF then success animation.");
            showPnrAnimation().catch((e) => console.error("[OCEAN Beta] PNR anim", e));
            return;
        }

        if (location.href.includes("booking/reviewBooking")) {
            log("On reviewBooking at start — turant action.");
            if (!reviewBookingRunning) await reviewBooking();
            return;
        }

        if (location.href.includes("payment/bkgPaymentOptions")) {
            log("On bkgPaymentOptions at start — turant action.");
            if (!bkgPaymentRunning) await bkgPaymentOptions();
            return;
        }

        if (location.href.includes("booking/psgninput")) {
            log("On passenger page at start — fillPassengerDetails.");
            await sleep(600);
            if (!fillPassengerRunning) await fillPassengerDetails();
            return;
        }

        // Agar reload pe already train-list hai — BG bhi message bhejega
        if (location.href.includes("booking/train-list")) {
            log("On train-list at start — wait briefly for BG, else run selectJourney.");
            await sleep(800);
            if (!selectJourneyRunning) await selectJourney();
            return;
        }

        if (isLoginSuccess()) {
            log("✅ Already logged in (silent).");
            await afterLoginContinue();
            return;
        }

        const opened = await clickHeaderLogin();
        if (!opened) {
            if (await waitForLoginSuccess(5000)) {
                await afterLoginContinue();
            }
            return;
        }

        const filled = await fillLoginCredentials();
        if (!filled) return;

        const manualLogin = await isManualLoginEnabled();
        if (manualLogin) {
            log("Manual login — waiting for user Sign In...");
            const ok = await waitForLoginSuccess(120000);
            if (ok) await afterLoginContinue();
            return;
        }

        const ok = await submitLoginAndConfirm();
        if (ok) await afterLoginContinue();
    }

    start().catch((e) => console.error("[OCEAN Beta] start failed", e));
})();
