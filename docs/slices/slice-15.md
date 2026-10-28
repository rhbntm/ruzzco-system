# Slice 15 — Approved phones, a signed owner session, HTTPS-only access

Repo: `ruzzco-system`. Status: **SPEC (written 2026-10-28).** Items tagged [AI proposal] are not confirmed by Brent; everything marked (Brent) is.
Goal: only phones that Mart or Bayani approved can put sales into the records, the owner session can't be forged or recovered into the PIN, and nothing secret crosses the shop Wi-Fi unencrypted.
Origin: read-only security review of 2026-10-28 (findings #2, #3, #4, #5, #6, #7). Threat: someone who gets onto the shop Wi-Fi. A daily login was considered and dropped: it breaks offline-first (no login while the shop PC is down), doesn't stop a Wi-Fi sniffer without HTTPS anyway, and costs the barbers time (Brent, 2026-10-28).
Freeze: development is frozen for the defense (Nov 11–13). Brent granted this slice a freeze exception: build it before the defense (2026-10-28).

## 1. Scope boundary (read first)

- In: device approval (§3), signed owner session and End-of-Day Cash figures behind the owner PIN (§4), HTTPS-only LAN access (§5), JSON-only writes (§6).
- Out: the server-side price check (finding #1). It becomes slice 16. Rule direction (Brent, 2026-10-28): a non-custom sale whose price doesn't match the service price is recorded but held out of payouts and daily figures until the owner confirms it, like the time review. The full rule and its edge cases get their own OK before slice 16 is written.
- Out: personal barber logins, roles beyond owner/approver, quarantine of sales on the server. Future work.
- Unchanged: offline-first recording, attribution by assignment, the sync result shape, every money rule. Queued payloads from older POS versions must still sync once their phone is approved (the device secret travels in a request header, never in the sale).

## 2. Decisions

1. **Device approval instead of a daily login** (Brent, 2026-10-28). A phone is approved once; afterwards barbers never enter anything to record sales.
2. **Two PINs** (Brent, 2026-10-28). `OWNER_PIN` (Mart) unlocks the owner pages and can approve phones. A new `DEVICE_APPROVAL_PIN` (Bayani; Mart trusts him) can only approve phones: it opens no owner page or route. Bayani is a payee, so he never gets the owner PIN.
3. **An unapproved phone still records sales; they wait** (Brent, 2026-10-28). They stay queued on the phone and sync once the phone is approved, like today's sales held for a pending bind.
4. **No reject button** (Brent, 2026-10-28). A phone is either approved or still waiting; an intruder's phone is simply never approved. Rejecting could be pressed by mistake and is irreversible.
5. **Switching barber on an approved phone needs no PIN.** Approval is the boundary; every switch stays in `device_assignments`. (Brent, 2026-10-28)
6. **Approval happens on the phone itself.** Bayani (or Mart) types the approval PIN on that phone; there is no list of waiting phones on the server, so an unapproved phone writes nothing to the database. (Brent, 2026-10-28)
7. **Mart can revoke an approved phone** (lost or replaced phone) from an owner page. Its secret stops working at once; sales it still holds wait until it is approved again. (Brent, 2026-10-28)
8. **PINs are at least 6 digits** (both). With the shop-wide limit of 30 wrong PINs per 15 minutes, 6 digits take about a year to guess; 4 digits about 3.5 days. (Brent, 2026-10-28)
9. **Port 3000 is closed to the network; phones use HTTPS only** (Brent, 2026-10-28; Option A in §5).

## 3. Build: device approval

Schema (additive, one migration):
- `devices`: `device_key` (PK, the phone's existing key), `secret_hash` (sha256 hex of the secret), `approved_at`, `approved_with` (`OWNER` | `APPROVER`), `label` (optional, e.g. "Vince's phone", max 60), `revoked_at` (null = active), `last_seen_at`.

Routes:
- `POST /api/v1/devices/approve` `{ deviceKey, pin, label? }`: accepts `OWNER_PIN` or `DEVICE_APPROVAL_PIN`, behind its own `createPinLimiter()` (same limits as unlock, separate counters). Generates 32 random bytes, stores the hash, returns the secret once. A device that is already approved gets a new secret (the old one stops working): this is the path after browser data was cleared. Logged as `[devices] approved <deviceKey> with OWNER|APPROVER`, never the PIN or secret.
- `GET /api/v1/devices` (owner) and `POST /api/v1/devices/revoke` `{ deviceKey }` (owner): list and revoke.
- `lib/device-auth.ts`: `authenticateDevice(request)` reads `X-Ruzzco-Device` (device key) and `Authorization: Bearer <secret>`, timing-safe compares against an active `devices` row, updates `last_seen_at`. Returns the device key or null.

Changes:
- `POST /api/v1/devices/bind`: requires `authenticateDevice`; the body's `deviceKey` must equal the authenticated key. 401 `DEVICE_NOT_APPROVED` otherwise.
- `POST /api/v1/transactions/sync`: requires `authenticateDevice` for the whole request (401 `DEVICE_NOT_APPROVED`, nothing processed). Each sale's `deviceKey` must equal the authenticated key, or that sale is rejected `DEVICE_MISMATCH`. Registering an unknown assignment from its sales stays, but only for the authenticated device. Legacy sales without `assignmentId` are accepted only from an authenticated device and keep their stamped `barberId` (invariant unchanged).
- `GET /api/v1/devices/binding`: unchanged (reads only).
- Client (`lib/sync.ts`, `lib/db.ts`): store the secret in localStorage next to `ruzzco_device_key` (`ruzzco_device_secret`); send both headers on bind and sync. A 401 `DEVICE_NOT_APPROVED` is not a per-sale rejection: sales stay in the automatic queue untouched (no `syncError`), and the outcome reports them as waiting for approval. No Dexie version bump.
- POS and shift log: while unapproved, a banner "This phone isn't approved yet. Sales are saved on this phone and will be sent once Bayani or Mart approves it." with an "Approve this phone" button that asks for the PIN (and an optional label).
- Owner page `/devices` (owner PIN): approved phones with label, approved with, last seen, Revoke (Brent, 2026-10-28).

## 4. Build: signed owner session

- Replace `sha256("ruzzco-owner:"+PIN)` with `<expiresAt>.<HMAC-SHA256(OWNER_SESSION_SECRET, expiresAt + ":" + sha256(OWNER_PIN))>`. The server checks the signature and that `expiresAt` (12 h) has not passed. Changing the PIN or the secret ends every session. The cookie value no longer reveals the PIN.
- `OWNER_SESSION_SECRET` (32 random bytes, hex) in `web/.env`. Missing → owner unlock answers 503 like a missing `OWNER_PIN`. `start-ruzzco.ps1` fills it with `New-Secret` when empty. (Brent, 2026-10-28)
- `POST /api/v1/owner/lock`: clears the cookie. A "Lock" button where the drawer says "Unlocked on this device".
- `validOwnerPin` uses a timing-safe compare.
- `GET /api/v1/reports/reconciliation` requires owner access (finding #5): the day's revenue, e-wallet totals, counted cash and notes are no longer readable without the PIN. `/reconciliation` asks for the PIN before it shows any figure, not only on Save (Brent, 2026-10-28).
- `Read-OwnerPin` and a new `Read-ApprovalPin` in `start-ruzzco.ps1`: `^\d{6,8}$`. A PIN already in `.env` that is shorter is warned about, not changed.

## 5. Build: HTTPS-only access (Option A, Brent 2026-10-28)

Problem: on `http://<IP>:3000` the owner PIN, the approval PIN, the owner cookie and the device secret all cross the Wi-Fi unencrypted, so a Wi-Fi intruder can capture them.

- Option A (chosen, Brent 2026-10-28): the app listens on `127.0.0.1:3000` only (`next start -H 127.0.0.1`, same for `next dev`); phones reach it only through the HTTPS gateway (`:3443`). `phone-firewall.ps1` stops opening 3000. Every phone installs the shop certificate once (already in the setup page). The plain-address mode in the paper goes away.
- Option B (not chosen): keep 3000 open for the POS, refuse the PINs over plain HTTP. Partial: the device secret still crosses unencrypted on every sync, so a sniffer can still pose as an approved phone.
- Known leftover either way: the setup page (`:3080`) serves the certificate over plain HTTP; install it at the shop and compare the fingerprint shown in the terminal.

## 6. Build: JSON-only writes

- `readJson` refuses a body whose `Content-Type` is not `application/json` (415). With the custom device headers this forces a CORS preflight, so a web page opened on a shop phone can't post sales or binds cross-site.

## 7. Tests

- New `npm run test:device-approval` (dev server): approve with each PIN; wrong PIN counts toward the limit; approval PIN opens no owner route; re-approval replaces the secret; revoke stops bind and sync at once; an unapproved sync is 401 and inserts nothing; a sale whose `deviceKey` differs from the authenticated one is `DEVICE_MISMATCH`; old queued payloads sync after approval.
- `test-owner-unlock`: signed cookie, expiry, lock, a forged or pre-slice cookie is refused, PIN change ends sessions.
- `test-reconciliation` and `test-time-review`: the reconciliation GET answers 401 without the owner cookie and works with it.
- Every suite that calls sync or bind (`api-errors`, `assignment-attribution`, `commission`, `gateway`, `ledger-summary`, `payment-qr`, `reconciliation`, `sync-clock`, `sync-rejections`, `time-review`; `sync-queue` for the client) approves a scratch device first through a shared helper and deletes it at the end.
- `test-sync-queue`: a 401 `DEVICE_NOT_APPROVED` leaves sales queued without `syncError`.
- `npm run lint`, `npx tsc --noEmit`, all suites.

## 8. Paper and defense follow-ups (not code)

- Ch3 Security: replace "Barbers do not log in" with the approved-phone rule and the two PINs; correct the cookie sentence (signed, expires on the server).
- Ch3 System Architecture: "the expected figures can be viewed without it" becomes: End-of-Day Cash needs the owner PIN to view and to save.
- Ch1 objectives and Table 10: "records protected from unauthorized change" now holds for new sales too: only approved phones can submit.
- Operation Procedure: "Setting up" gains "approve each phone with the approval PIN".
- If Option A: Offline Operation limitation and Known gaps lose the plain-address mode.
- Decision record in `../ruzzco-barbers/20_Decisions/` (device approval over daily login, Bayani as approver, no reject button).

## 9. Done when

- An unapproved phone records sales offline and online, shows the waiting banner, and its sales sync after approval with nothing rejected.
- The approval PIN approves phones and opens nothing else; revoke stops a phone at once.
- End-of-Day Cash shows no figure without the owner PIN.
- A copied owner cookie stops working after 12 h and after a PIN change; Lock clears it on the device it was pressed on.
- With Option A, `http://<IP>:3000` no longer answers from a phone.
- All suites, lint and tsc pass.

<!-- END OF SPEC -->
