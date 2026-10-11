# LEXUS

LEXUS has its own application copy in `app/`. Application JavaScript, renderer assets, and runtime dependencies were copied from the supplied recovered source. The desktop entry point requires only that local copy. Source function logic was not inspected or deobfuscated for this copy workflow.

The visible application name and native window titles are LEXUS. Internal IPC names and module names are retained to preserve compatibility. Licensing is replaced with the new LEXUS service; other original external integrations are retained. This is a derived application, not a new independently written booking engine.

- Local browser workspace: `npm start`, then http://127.0.0.1:8081.
- Desktop application: `npm run desktop` or `start-desktop.ps1`.
- WEB-2 Chrome starts automation after a one-second post-DOMContentLoaded settle (formerly eight seconds). Dialog and login readiness checks still run. `OCEAN_AUTOMATION_GRACE_MS` can override the settle with 0–60000 ms. Brave retains its twelve-second default.
- API verification: `npm run verify`.

Book Ticket panels offer one-shot auto-start at 8:00, 10:00 or 11:00 AM IST. Select ID, Bank, method, IP, quota and the auto-start engine, then click Schedule. The displayed date is today if the time is still ahead, otherwise tomorrow. Settings are captured when scheduling; click Schedule again to replace them. Cancel removes the pending start; a manual engine launch also cancels it. Keep LEXUS and the ticket panel open, with the PC awake. Closing the panel or restarting LEXUS cancels the schedule. A start missed by more than one minute expires instead of launching late. Captcha and manual submission preferences still apply.

WEB-2 Classic automatically clicks Passenger Continue as soon as the completed form passes validation, unless manual passenger submission is selected. Review-page arrival and final confirmation depend on the site response. Scheduling tests: `runtime\node.exe --test booking-scheduler.test.cjs`.

Browser profiles, forms, gateway settings, history, export/import, and journey details use the copied application store through the local browser bridge. Native booking sessions require the desktop runtime and original external service access. Browser mode does not simulate successful live bookings.

Browser data is stored in `web-data/`; desktop data in `desktop-data/`. Existing OCEAN data was not imported. Enter any required activation key in the LEXUS desktop window yourself.

`COPY-REPORT.json` records the initial byte-for-byte copy verification and mechanical branding changes, before the licensing replacement. The shared executable used to launch the desktop is the previously checksum-verified official Electron runtime; it does not load the original application's source directory.

## LEXUS administrator

UI performance: unchanged settings skip disk writes; changed UI settings commit and save once. Closing the editor hides its window for reuse. Initial profile hydration runs once without blocking the form on About/history. Train routes are cached for five minutes and concurrent identical searches share a request. Availability responses remain fresh; identical pending requests share their work, while different captcha requests use the session sequentially. OCR and IndianRail session warm up when Book or train search opens. Network requests time out after 12 seconds; captcha rejection retries at most three times. Checks: `runtime\node.exe --test performance.test.cjs workspace.test.cjs`, and `runtime\node.exe qa/renderer-performance-smoke.cjs` (mocked desktop bridge).

Hosted administrator: https://lexus.vaidya-gpt.com/admin. For local development, open http://127.0.0.1:8081/admin. The randomly generated administrator password is in `license-data/admin-access.txt`; keep this file private. Sign in, enter the customer name, validity in days, and device allowance, then Generate key. The plaintext key is shown once. The registry stores its hash. The key can activate the browser workspace or the desktop app; each counts as a separate device.

Keys can be revoked in the registry. Expired or revoked keys fail subsequent server checks. Admin sessions use HttpOnly cookies and expire after eight hours. Browser activation is checked on each workspace API request. Desktop activation is checked through the replacement licensing client and its saved key is encrypted locally.

Both administrator and client interfaces use a right-side navigation rail with a white, blue and teal theme. The desktop toolbar also anchors to the right screen edge.

The first key must be issued by the administrator. An optional initial key can be entered during issuance, or a random key can be generated. After activation, the client can choose a personal key containing 6–64 characters, including letters, numbers or symbols. The client must provide the current key. Personalization preserves the same license, expiry and device allowance. It invalidates the old key and old activation sessions; the current browser receives a replacement session. Activation and verification share failed-attempt throttling. Clients cannot issue an initial license themselves.

This local service issues LEXUS keys only; those keys do not grant access to third-party APIs. Desktop licensing defaults to https://lexus.vaidya-gpt.com. Local development can override LEXUS_LICENSE_URL after starting npm start. The VPS service is deployed with HTTPS; internal container health checks and browser debugging still use loopback addresses.
