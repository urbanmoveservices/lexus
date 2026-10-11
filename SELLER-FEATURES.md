# LEXUS feature scope from seller-portal inspection

Inspected 2026-10-10, read-only, signed-in seller portal. No keys created, reset, renewed or deactivated; no payment or IP assignments submitted.

## Observed seller features
- Dashboard counts: total, active, paid, sold today, expiring soon; announcements/offers and pending payment notice.
- Create key: customer name, chosen key, monthly/yearly duration. Portal notice says new keys start unpaid and admin must mark paid.
- Key registry: customer, key, remaining days, active flag, IP count, paid flag. Expanded row exposes Deactivate, Reset ID, Add IP, Renew ID, Edit. Button effects not executed or verified.
- Search, sorting, pagination; Copy/CSV/Excel/PDF/Print and column visibility controls.
- Paid/renewal history: customer, key, added date, expiry.
- Seller payment ledger and per-key paid ledger: amount, message, date.
- IP upload: newline-separated ip:port:username:password.
- Per-key detail: IP/port/credentials/expiry/action columns; booking records with route, train, gateway, time, image. Current inspected tables empty, so population and timing semantics unverified.

## Proposed LEXUS client scope (recommendations, not an observed client portal)
- Own activation key, personal-key change following administrator-issued activation, validity and remaining days.
- Own paid/unpaid/expired/revoked status, plan and renewal request/history.
- Assigned connection status/expiry, with proxy credentials protected.
- Own booking history: route, train, gateway, stage timings, confirmed PNR when available, ticket artifact.
- Existing journey/passenger/account/payment profiles and WEB2/WEB3 controls.
- Own profile, downloads/update information and announcements.

## Proposed LEXUS admin/seller additions
- Paid state separate from activation state; monthly/yearly plans; renew/edit with audit trail.
- Device/session reset with clearly specified semantics (portal Reset ID semantics not verified).
- Client-specific IP assignments and expiry; tenant isolation.
- Payment ledger, renewal ledger, expiring-soon dashboard, registry exports.
- Existing LEXUS key issuance/revocation/device-limit and personal-key flow remain the baseline.

The portal inspected is a seller portal. It does not establish the contents of a separate client portal or prove access to an IRCTC booking API/sensor provider.
