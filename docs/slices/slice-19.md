# Slice 19 — Staff login

Repo: `ruzzco-system`. Status: **PRELIMINARY, register item PR-4** (written 2026-11-14), branch `revision/preliminary`. The rule and edge cases in §2 are OK'd by Brent (2026-11-14). The decisions in §3 are OK'd by Brent (2026-11-14). Section 7 (slice 19b, follow-up to PR-4) is **APPROVED by Brent (2026-11-14)** with his clarifications incorporated: rule §7.2, matrix §7.3, Decisions §7.4 (S1 to S5, C1), S4 per-barber §7.6, handover checklist §7.7, tests §7.10. **Build authorized by Brent (2026-11-14)**, in a fresh session; no commit, push or merge until he reviews it. It changes nothing in §2 or §3.
Goal: the owner and each barber sign in with their own username and password, without changing who a sale is credited to, what lets a phone send sales, or the POS's ability to work with the shop PC off.

Before writing code, read the guides in `web/node_modules/next/dist/docs/` for route handlers, `cookies()` and server components (Next.js 16; `cookies()` is async).

## 1. Scope boundary (read first)

- In: accounts on `users` (one additive migration), password hashing, a signed account session, the auth and staff-account routes, the owner session seam (`lib/session.ts`, async `hasOwnerAccess`), the phone's offline sign-in (`lib/local-session.ts`, `components/SignInGate.tsx` on `/pos` and `/shift-log`), an owner sign-in page, a Staff accounts page, an optional `userId` on sales, a recovery script, and the tests.
- Unchanged: sale-time attribution by assignment, `cashierId`, commission snapshots, per-sale sync results, rejected-sale handling, Dexie-first writes, the client UUID as idempotency key, expected drawer cash, QR Ph. Phone approval stays the only credential for `bind` and `sync`. The owner PIN keeps approving phones (`POST /api/v1/devices/approve`, with the approval PIN as today) and authorizing a move to another barber (`pin` on `POST /api/v1/devices/bind`).
- Look: the new screens work but use today's styling and components. Their visual design comes from the redesign (slice 21); no theme or layout work here.
- Out: removing the PIN from phone approval and phone moves (considered, kept for safety, possible later slice); barbers changing their own password; an activity log; the server price check (slice 16); role-based landing and navigation (slice 21) [the server-side barber redirect and the removal of owner links from the POS came forward to §7.13 on 2026-11-14, at Brent's request; the rest stays in slice 21]; counter-station mode (several barbers on one phone) [archived 2026-11-14: no shared device, each barber uses their own phone].

## 2. Rule (OK'd by Brent, 2026-11-14)

A barber signs in with their own username and password on their phone at the start of each business day, before the POS starts a new sale. A phone accepts only the barber it is assigned to. Signing in never changes who a sale is credited to: that stays the phone's assignment, fixed at sale time. Sending sales still depends only on the phone's approval. The owner signs in with a username and password to open owner pages; once an active owner account exists, the owner PIN no longer opens them, but it still approves phones, authorizes moving a phone to another barber, and is how the first owner account is created.

| # | Edge case | What happens |
|---|---|---|
| 1 | Shop PC is off at opening | The phone checks the password itself, against a verifier it saved at its last successful online sign-in. The barber sells; sales queue as today. A phone that has never signed in online cannot (it needs the PC once, like approval) |
| 2 | The day ends, or the barber signs out, with sales still queued | Queued sales still sync. Sign-in is asked for only when the POS opens or a new ticket starts, never between Charge and Record |
| 3 | Barber B signs in on a phone assigned to A | Refused with "This phone is assigned to A". Nothing is written. Moving a phone still needs the owner PIN, as today |
| 4 | The owner resets a password or deactivates an account while the phone is offline | The old password keeps working on that phone until it next reaches the PC, then sign-in is required. Sales made meanwhile sync and stay with the assignment's barber. Revoking the phone remains the immediate stop |
| 5 | A barber forgets the password while the PC is off | They cannot start new sales on that phone until the PC is back and the owner resets it. This is the availability cost of login; it goes in the paper as a limitation |
| 6 | A phone still running the old cached POS | Its sales still sync; they carry no signed-in user |
| 7 | A phone with no assignment yet | The first online sign-in assigns it to that barber through the normal first bind (a first assignment needs no PIN). This is the only time signing in leads to a bind. The "Assign Station Barber" picker goes away |

Also OK'd: password resets are owner-only, on the Staff accounts page (until the owner says otherwise).

## 3. Decisions (OK'd by Brent, 2026-11-14)

1. **Accounts.** Roles offered are `OWNER` and `BARBER` (`CASHIER` stays in the enum, unused). A `BARBER` account is linked to exactly one barber record and a barber has at most one account; an `OWNER` account has none. Usernames are 3 to 32 characters (letters, digits, `.`, `_`, `-`), stored lower-case, unique. Passwords are at least 8 characters. Accounts are deactivated, never deleted. Existing user rows (such as the seeded owner) have no username or password and cannot sign in until the owner sets them on Staff accounts.
2. **"Active owner account"** = a user with role `OWNER`, `isActive`, a username and a password. While none exists, `POST /api/v1/owner/unlock` works as today so the owner can create the first one. Once one exists, the PIN unlock answers 409 `OWNER_ACCOUNT_EXISTS` ("Sign in with your owner account") and existing PIN sessions stop opening owner pages. The last active owner account cannot be deactivated (409 `LAST_OWNER`).
3. **One account session for both roles.** A cookie `ruzzco_session` (HttpOnly, SameSite Strict, Secure following the request protocol, as the owner cookie) = `<userId>.<expiresAt>.<HMAC(OWNER_SESSION_SECRET, userId:expiresAt:passwordChangedAt)>`. The server checks the signature, the expiry, and that the account is still active (and its barber still active) on every request. A password change or reset ends every session of that account; changing `OWNER_SESSION_SECRET` ends all of them. No new environment variable.
4. **Session length.** A barber session ends at the end of the Manila business day (midnight, `lib/business-date.ts`). An owner session lasts 12 hours, like today's PIN session, so closing the day late doesn't cut it off.
5. **Barber sign-in needs an approved phone.** `POST /api/v1/auth/login` for a `BARBER` account requires the approved-phone headers (`X-Ruzzco-Device`, `Authorization: Bearer`) and refuses with 401 `DEVICE_NOT_APPROVED` without them, so a new phone is approved first, then signed in. An `OWNER` account signs in without them (on the shop PC) and is refused on the POS sign-in ("Owner accounts don't record sales").
6. **Wrong passwords.** A new `loginLimiter` from `createPinLimiter` (`lib/pin-attempts.ts`), keyed by username: 5 wrong in 15 minutes locks that username for 15 minutes, 30 shop-wide; a lock refuses even the right password (429, as the PIN limiter). Unknown usernames count the same and get the same answer as a wrong password. Known cost: someone on the shop Wi-Fi can lock a barber's username for 15 minutes; offline sign-in on that barber's own phone still works.
7. **Server passwords:** `scrypt` from `node:crypto` (no new dependency), random 16-byte salt, stored as one string with its parameters.
8. **Phone verifier (case 1):** at each successful online sign-in the phone derives a verifier from the typed password with Web Crypto PBKDF2-SHA-256 (random salt, 600,000 iterations; if sign-in takes over 2 s on a real low-end phone, lower it, never below 210,000, and record the figure in the session log) and keeps it in `localStorage` with the account id, username, barber id and name, and the server's `passwordChangedAt`. One verifier per phone, replaced at each online sign-in. Offline back-off: after 5 wrong offline attempts the phone waits 1 minute, doubling to 15 minutes. Known cost: someone holding an unlocked phone could try to guess the password from the stored verifier; this goes in the paper with case 5. Web Crypto needs a secure context: phones use the HTTPS gateway; where `crypto.subtle` is missing, offline sign-in is unavailable and the phone says so.
9. **Online first.** The phone always tries the server first. It falls back to the verifier only when the server can't be reached (network error or timeout), never after the server answered "wrong password", "deactivated" or "assigned to another barber". When an online answer says the account is deactivated or the password changed, the phone deletes the verifier.
10. **Case 4 on the phone.** Whenever the POS opens or a new ticket starts while the PC is reachable, the phone checks `GET /api/v1/auth/session`. 401 `PASSWORD_CHANGED` or `INACTIVE` (or `SESSION_REPLACED`, added in §7.13): the local session ends and the verifier is deleted; sign-in is asked for. A network error keeps the local session.
11. **Case 3 on the phone too.** The phone refuses a sign-in whose barber differs from its local binding, offline as well, with the same message. The server checks the phone's active assignment (`DeviceAssignment` with no `revokedAt` for that device key).
12. **`userId` on sales is information only.** `LocalTransaction` gains optional `userId` (no index, so no Dexie version bump), filled from the local session. The sync payload accepts it as optional; the server stores it in `transactions.user_id` when it names an existing user and stores null otherwise. It is never a reject reason and never used for attribution, `cashierId`, commission or payouts. A `userId` whose barber differs from the assignment's is still stored as sent.
13. **Owner prompts.** The five places that ask for the owner PIN today (`/ledger`, `/devices`, `/payment-qr`, `/reconciliation`, `ForecastPanel`) and `OwnerPinDialog` become one owner sign-in dialog: username and password, or the PIN while no active owner account exists. A new `/login` page does the same for a direct visit (`?next=` accepts only a same-origin path). The drawer's Lock clears both cookies.
14. **Recovery when the owner forgets the password:** `npm run owner:reset-password` on the shop PC (needs the database; asks for the username and a new password on the terminal, never as an argument). Physical access to the PC is the recovery credential.
15. **Staff accounts page** (`/staff`, owner-only): list of accounts (name, username, role, barber, active, last sign-in); create; set or reset a password; deactivate and reactivate. The page never shows or returns a password or hash. A link to it goes in the owner drawer.

## 4. Build

### 4.1 Schema (one additive migration)

`users`: add `username` (VARCHAR(32), nullable, unique), `password_hash` (VARCHAR(255), nullable), `barber_id` (CHAR(36), nullable, unique, to `barbers`), `is_active` (BOOLEAN, default true), `password_changed_at` (DATETIME, nullable), `last_sign_in_at` (DATETIME, nullable); make `email` nullable. `transactions`: add `user_id` (CHAR(36), nullable, to `users`, on delete set null) with an index. Written with `prisma migrate diff` from Git Bash, reviewed, applied with `npx prisma migrate deploy`. The seed is unchanged.

### 4.2 Server

- `lib/passwords.ts`: `hashPassword`, `verifyPassword` (scrypt, constant-time compare), the username and password checks.
- `lib/session.ts`: create and verify the account cookie; `getSession()` for server components (`await cookies()`); `requestSession(request)` for routes; `ownerAccountExists()`. `hasOwnerAccess(request)` in `lib/owner-access.ts` becomes async and is true for an active `OWNER` account session, or for a valid PIN cookie while no active owner account exists. Every caller (`reports/payouts`, `reports/reconciliation`, `reports/ledger-summary`, `reports/time-review`, `devices`, `devices/revoke`, `forecast`, `forecast/refresh`, `payment-qrs/[barberId]/[method]`) adds `await`. `app/page.tsx`, `app/insights/page.tsx` and `app/forecast/page.tsx` read `getSession()` instead of `isOwnerCookie`.
- `POST /api/v1/auth/login` `{ username, password, deviceKey? }`: limiter, password, active account (and active barber), role rules (Decision 5), case 3 against the phone's active assignment (403 `PHONE_ASSIGNED` with the barber's name). Sets the cookie and `last_sign_in_at`; answers the account (id, username, role, barber id and name, `passwordChangedAt`, `expiresAt`). Nothing is written on a refusal.
- `POST /api/v1/auth/logout`: clears the cookie. `POST /api/v1/owner/lock` clears both cookies.
- `GET /api/v1/auth/session`: the current account, or 401 with `reason` `NONE`, `EXPIRED`, `PASSWORD_CHANGED` or `INACTIVE`.
- `POST /api/v1/owner/unlock`: 409 `OWNER_ACCOUNT_EXISTS` once an active owner account exists (checked before the PIN, and not counted as a wrong PIN).
- `GET`/`POST /api/v1/users` and `PATCH /api/v1/users/[id]` (owner-only): list, create, set or reset password, activate or deactivate, with the checks in Decisions 1 and 2. Writes use `readJson` (415 for non-JSON).
- Sync: `lib/schemas.ts` accepts optional `userId` (UUID; an invalid value is dropped, not a reject, so an odd client never loses a sale); `sync/route.ts` stores it per Decision 12.
- `scripts/owner-reset-password.ts` and `npm run owner:reset-password` (Decision 14).

### 4.3 Phone

- `lib/local-session.ts`: pure logic plus Web Crypto: derive and check the verifier, the local session (account, barber, Manila business date, online or offline), the expiry at the end of the business day, the back-off, and the decisions in 8 to 11. The pure parts take `now` and storage as arguments so `test:local-session` runs in Node.
- `components/SignInGate.tsx` wraps `/pos` and `/shift-log` on the client, so the cached pages still open offline; no server redirect in front of them. It asks for sign-in when the page opens and when a new ticket starts, never between Charge and Record (case 2). If the phone isn't approved it shows the approval step first (Decision 5). After a first online sign-in on a phone with no binding, it runs today's first bind (`createLocalAssignment`, then the pending bind) for the account's barber (case 7); the "Assign Station Barber" picker is removed. "Change the barber" (owner PIN) stays as it is.
- A Sign out action in the POS settings sheet. Signing out never touches queued sales.
- `lib/sync.ts`: each new sale carries `userId` from the local session.
- `public/sw.js`: bump `VERSION`.

### 4.4 Owner pages

- `app/login/page.tsx` and the shared owner sign-in dialog (Decision 13).
- `app/staff/page.tsx` (Decision 15), checked on the server with `getSession()`.

### 4.5 Docs

`CLAUDE.md`: the owner-only invariant (account session, PIN only before the first owner account), approved phones (barber sign-in needs approval; login is not a sync credential), the `userId` field, the new commands and suites, and Known gaps (cases 4 and 5, Decision 6's lockout, Decision 8's verifier on the phone). `CONTRIBUTING.md`: the suite table.

## 5. Tests

- New `npm run test:auth` (needs the dev server): right and wrong password; unknown username answers like a wrong one; lockout and the 429 refusing the right password; deactivated account and deactivated barber; barber sign-in without approved-phone headers (401); case 3 (403, nothing written); owner refused on the POS sign-in; a password reset ends the session (`GET /api/v1/auth/session` 401 `PASSWORD_CHANGED`); owner routes with an owner account session, refused with a barber one; PIN unlock 409 once an owner account exists; last owner can't be deactivated; a sale with a valid, unknown or malformed `userId` syncs and keeps the assignment's barber.
- New `npm run test:local-session` (Node only): verifier right and wrong; business-day rollover at Manila midnight; back-off timing; online-first fallback rules (Decisions 9 to 11).
- A shared helper in `web/scripts/lib` creates a scratch owner account (random username and password, through Prisma), signs in with `POST /api/v1/auth/login`, returns the cookie and removes the account at the end. The suites that unlock with the PIN today (`test:api-errors`, `test:commission`, `test:forecast`, `test:gateway`, `test:ledger-summary`, `test:payment-qr`, `test:payout-entries`, `test:reconciliation`, `test:time-review`, and the owner parts of `test:device-approval`) use it.
- `test:owner-unlock` covers both states: with no active owner account, the PIN session cases as today; with one (the helper's scratch account), the 409 and no cookie.
- Must pass unchanged: `test:attribution` T1 to T18, `test:sync-rejections`, `test:payload-compat`, `test:device-approval` (approval and bind PIN), `test:sync-queue`, `test:submit-lock`, `test:sheet-stack`.
- All suites, `npm run lint`, `npx tsc --noEmit`, compared with the baseline.

## 6. Manual test

1. No owner account yet: open `/ledger`, unlock with the PIN, open Staff accounts, create an owner account and a barber account for a test barber. Lock. The PIN unlock now says to sign in with the owner account; signing in opens `/ledger`.
2. On an approved phone (HTTPS gateway) bound to the test barber: open `/pos`; sign-in is asked. Sign in with the barber account; record a cash sale. Sign out; the sale still syncs.
3. Same phone, another barber's account: refused with "This phone is assigned to …"; nothing changes on the phone or the server.
4. Turn the shop PC off (or stop the server): open the installed POS, sign in with the same password, record a sale. Start the PC: the sale syncs with the test barber and the account's `userId`.
5. Reset the barber's password on Staff accounts while the phone is offline: the old password still works offline; once the phone reaches the PC, opening a new ticket asks for sign-in and only the new password works.
6. At 360 × 740 the sign-in screen and Staff accounts fit with no sideways scroll.

## 7. Slice 19b: the approval screen on every page, and an authorization audit

Follow-up to slice 19 (commit `7baf938`), asked for by Brent. Operating assumption (Brent, 2026-11-14): each barber has their own phone; no shared device and no regular phone switching. Slice 19 is about who is signed in, not about moving phones.

### 7.1 Scope boundary

- In: one approval screen in front of the app for a browser that isn't approved (§7.2, §7.4); the owner sign-in exception, with its security meaning; the authorization matrix of every API route (§7.3); fixes S1, S2, S3, S4 and S5 (§7.4 to §7.6); S6 as a required production-handover checklist (§7.7); the cross-origin and CSRF audit, the C1 fix and their tests (§7.8, Decision 9); the tests in §7.10.
- Unchanged: `PHONE_ASSIGNED` (barber B can't sign in on a phone assigned to A, online or offline: §2 case 3, Decision 11). "Change the barber" with the owner PIN stays the only way to move a bound phone, an administrative exception for a genuine transfer. A replacement phone goes through approval and the first assignment at its first online sign-in (§2 case 7), under the owner's supervision (§7.7). Sale-time attribution: synced and queued sales stay with the assignment they were made under. Also unchanged: `cashierId`, commission snapshots, per-sale sync results, rejected-sale handling, Dexie-first writes, approval as the only credential for `bind` and `sync`, owner routes requiring owner access on the server.
- Out: any phone move started by a barber's sign-in (no `move` on login, no session in place of the PIN on `bind`; in the first draft, dropped by Brent); removing the PIN fallback before the first owner account (S6 is a handover task, not code); CSRF tokens and `Origin` checks (documented as a limitation, §7.12); any other security redesign or refactoring; any visual redesign (slice 21).

### 7.2 Rule (OK'd by Brent, 2026-11-14)

A browser that isn't approved sees only the approval screen, on every app page, except `/login`. The approval screen is UI gating only: API routes never answer with it; they answer with their own authorization response (401, 403 or 404 in JSON). The server keeps checking the real credentials on every protected request, and a page never sends owner data to a browser without owner access, whatever the screen shows.

Two separate permissions, never standing in for each other:

- **Owner authentication** (an active `OWNER` account session) opens owner pages and owner routes, from any browser, approved or not. It is not device approval: it never lets a browser record or sync sales, bind, create or check a QR Ph charge, or pass the approval screen on `/pos` and `/shift-log`.
- **Device approval** (the phone's key and secret, checked by the server) opens device routes. It is not owner access. `/pos` and `/shift-log` still need approval and then the assigned barber's sign-in.

| # | Edge case | What happens |
|---|---|---|
| 1 | An unapproved browser opens `/`, `/about`, an owner page, `/pos` or `/shift-log` | Only the approval screen, with an "Owner sign-in" link (not on `/pos` and `/shift-log`, where owners don't sign in). `/pos` and `/shift-log` behave as today: approval first, then barber sign-in |
| 2 | Someone edits `localStorage` so the phone looks approved | The screen may go away; nothing else opens: `bind`, `sync`, `devices/binding`, `catalog`, `payment-qrs` and the QR Ph routes still answer 401 and write or return nothing; owner routes still answer 401 |
| 3 | An unapproved browser opens `/login` and signs in with an active owner account | It opens owner pages without approval. This is not limited to the shop PC: any browser that reaches the app can do it with the owner's username and password. The owner credentials and the server's role check are what protect owner access here |
| 4 | The owner, signed in, opens `/pos` on an unapproved browser, or a client sends sales or a bind with only the owner cookie | The approval screen on `/pos`; 401 `DEVICE_NOT_APPROVED` on `sync` and `bind`, nothing written |
| 5 | A barber on an approved phone opens an owner page or calls an owner route directly | 401 on the route: approval and a barber session are not owner access. [Changed 2026-11-14, §7.13: with a barber session the page redirects to `/pos` on the server; the owner sign-in shows only to a signed-out browser] |
| 6 | B signs in on A's phone | Refused with "This phone is assigned to A", as today; nothing is written |
| 7 | An approved phone is revoked | At the next page or ticket, the approval screen everywhere; device routes answer 401; queued sales stay queued, never rejected or deleted; a ticket between Charge and Record finishes first (as today) |
| 8 | The phone is offline and not approved | The approval screen says approval needs the shop PC (as today); queued sales are untouched |

### 7.3 Authorization matrix (audit of `web/src/app/api`, 2026-11-14; OK'd by Brent)

There is no `proxy.ts` or middleware: every check is in the route handler. "Phone" = approved-phone headers (`X-Ruzzco-Device` + `Authorization: Bearer`, `authenticateDevice`). "Owner" = `hasOwnerAccess`: an active `OWNER` account session, or the PIN cookie only while no active owner account exists (slice 19 Decision 2; ends at handover, §7.7). No route accepts a barber session as a permission; barbers act through their approved phone.

| Route (`/api/v1/…`) | Method | Today | After 19b |
|---|---|---|---|
| `transactions/sync` | POST | Phone; each sale's `deviceKey` must be the authenticated one | unchanged |
| `devices/bind` | POST | Phone, body key = header key; owner PIN to move a bound phone | unchanged |
| `devices/approve` | POST | Public: owner or approval PIN, `devicePinLimiter` | unchanged |
| `devices/binding` | GET | Public | **S2**: Phone with the same key, or Owner |
| `devices`, `devices/revoke` | GET, POST | Owner | unchanged |
| `auth/login` | POST | Public: password, `loginLimiter`; Phone for `BARBER`; `PHONE_ASSIGNED` | unchanged |
| `auth/logout`, `owner/lock` | POST | Public: clear their own cookies | unchanged |
| `auth/session` | GET | Public: the cookie; Phone for the offline-account check | unchanged |
| `owner/unlock` | POST | Public: owner PIN, `ownerPinLimiter`; 409 once an owner account exists | unchanged (S6) |
| `users`, `users/[id]` | GET, POST, PATCH | Owner | unchanged |
| `reports/payouts`, `reports/reconciliation` | GET, POST | Owner (both methods) | unchanged |
| `reports/ledger-summary` | GET | Owner | unchanged |
| `reports/time-review` | POST | Owner | unchanged |
| `forecast` | GET | Owner | unchanged |
| `forecast/refresh` | POST | Owner; no content-type check, no body | **C1**: Owner, plus `application/json` and a `{}` body (Decision 9) |
| `payment-qrs/[barberId]/[method]` | PUT, DELETE | Owner | unchanged |
| `payment-qrs/[barberId]/[method]` | GET | Public (slice 6) | **S4**: Owner, any barber; Phone, only its active assignment's barber (404 for another) |
| `payment-qrs` | GET | Public (slice 6) | **S4**: Owner, every barber; Phone, only its active assignment's barber |
| `catalog` | GET | Public | **S3**: Phone or Owner |
| `payments/qrph` | GET | Public (says only on or off) | unchanged |
| `payments/qrph` | POST | Public with a sale id; no `readJson` | **S1**: the Phone that made the sale; `readJson` |
| `payments/qrph/check` | GET, POST | Public with a sale id | **S1**: the Phone that made the sale |
| `webhooks/paymongo` | POST | PayMongo signature | unchanged |
| `health` | GET | Public (barber and service counts only) | unchanged |

Pages: `/insights`, `/forecast` and `/staff` check owner access on the server before loading data. `/ledger`, `/devices`, `/payment-qr` and `/reconciliation` are client pages: their HTML carries no data, which comes only from the owner routes above. `/pos` and `/shift-log` render nothing from the server; their data is the phone's own. `/` renders the forecast only with owner access, and today's paid-sale count to any browser (**S5**); active barber names and the price list stay public. `/about` renders one service from the price list. Hiding pages on the client was never the protection, and the approval screen doesn't change that.

### 7.4 Decisions (OK'd by Brent, 2026-11-14)

1. **The approval screen is client-side.** Approval lives in the phone's `localStorage` and a page request carries no device headers, so only the browser can decide to show the screen. The server never reads that state as proof of anything. Until the browser has read its approval state, a gated page shows the loading state, never its content.
2. **One gate decision**, a pure function in a new `lib/approval-gate.ts` (route, approved, owner access) → approval screen, owner sign-in, barber sign-in or page:
   - `/login`: never gated.
   - `/pos`, `/shift-log`: approval screen unless approved, then barber sign-in (`SignInGate`, unchanged). Owner access is ignored here.
   - Owner pages (`/ledger`, `/devices`, `/payment-qr`, `/reconciliation`, `/insights`, `/forecast`, `/staff`): with owner access, the page. Without it, the approval screen with "Owner sign-in" (to `/login?next=` that page) when the browser isn't approved, the owner sign-in form when it is.
   - `/`, `/about`: the page with owner access or an approved browser; otherwise the approval screen with "Owner sign-in". [Superseded 2026-11-14 by §7.13: approval alone no longer opens them; an approved browser without owner access gets a sign-in screen, and a barber session is redirected to `/pos`]
3. **One approval screen component**, built from `SignInGate`'s `ApprovalStep` and `DeviceApprovalBanner`, used by `SignInGate` and by the owner pages' signed-out view. The owner may approve the PC with a PIN but doesn't need to. [§7.13 adds a second screen in the same file, the sign-in choice on `/` and `/about` for an approved browser without owner access]
4. **S1.** `POST /payments/qrph` and `GET`/`POST /payments/qrph/check` check the phone first, before the gateway switch, so an unauthenticated caller always gets 401 `DEVICE_NOT_APPROVED`. The sale is looked up with its assignment; if it has no assignment or its assignment's `deviceKey` isn't the authenticated key, the answer is the same 404 as an unknown sale (`NOT_SYNCED` or `NO_CHARGE`), so another phone's sale is neither changed nor confirmed to exist, and PayMongo is not called. The owner session doesn't count. The POST goes through `readJson` (415 for non-JSON). `QrPhCheckout` sends `deviceAuthHeaders()`; without them it says the phone isn't approved and calls nothing. `GET /payments/qrph` stays public.
5. **S2.** `GET /devices/binding` answers only Phone headers whose key equals the `deviceKey` asked for, or Owner; otherwise 401 with no assignment data. The answer is unchanged when allowed. `verifyCurrentAssignment` sends the headers and skips the call when the phone has no secret; it already treats any non-200 as "can't check" and keeps its binding. Approval, the first bind and `/devices` don't call this route, so none of them changes.
6. **S3.** `GET /catalog` answers Phone or Owner; otherwise 401. The POS sends the headers and keeps its cached catalog on a refusal (it already does on any failure); the owner's `/payment-qr` page uses its cookie. Before the handover (§7.7) the PIN cookie also counts as Owner.
7. **S5.** `app/page.tsx` counts today's paid sales only when the server finds owner access; without it the count is not queried and not in the HTML, and the home page shows no count.
8. **S4**, per-barber access with a barber-bound cache (§7.6):
   - Server: `GET /payment-qrs` returns every active barber's QRs to Owner, and to a Phone only those of the barber on its active assignment (none if it has no active assignment). `GET /payment-qrs/[barberId]/[method]` serves Owner for any active barber; for a Phone only that same barber, else 404 (as for a missing QR); no credentials, a made-up secret or a revoked phone get 401. `Cache-Control: no-store` stays. Owner here means `hasOwnerAccess`; the owner page's `<img>` carries the owner cookie.
   - Phone cache: `refreshPaymentQrs` sends `deviceAuthHeaders()` (and calls nothing without them). Each cached entry keeps its `barberId` (it already does: id `"barberId:method"`). After a successful list fetch the phone records, in `localStorage`, which barber the list was for and which methods it held; the refresh plan deletes every cached entry not in that list, so another barber's QR doesn't stay on the phone.
   - Owner-PIN move: on a successful `switchBarber`, the phone deletes the old barber's cached QRs and the list record at once, then runs a refresh for the new barber.
   - What the GCash/Maya modal shows, decided by a pure function in `lib/payment-qr-plan.ts` from the current binding's barber and the cache: the cached QR only when its `barberId` is the binding's barber; "No GCash QR set up for {barber}. Ask the owner to add one." only when the last successful list for that barber had no QR for that method; otherwise "GCash QR unavailable: the phone couldn't load it from the shop PC." It never shows another barber's QR. As today, the sale can still be confirmed.
   - Limit (documented, accepted): revoking a phone, or removing a QR, stops future downloads, but cannot erase a QR already stored on a phone that stays offline. QRs are customer-facing payment destinations, not authentication credentials; holding one grants no access to the system.
9. **C1** (OK'd by Brent, 2026-11-14). Every cookie-authenticated state-changing route that today takes an empty or bodyless request requires `Content-Type: application/json` and a JSON object body; the audit (§7.8) found one, `POST /forecast/refresh`. In this order, before any database change or external call (the ml-service): owner access (401), then the content type (415 when missing or wrong, through `readJson`), then the body (400 when it isn't valid JSON, isn't an object, or has any key, since the route takes no parameters: exactly `{}`). `ForecastPanel` sends `Content-Type: application/json` and `{}`. Exceptions stay as they are: `payment-qrs` PUT (the raw image, checked by file signature) and DELETE (no body). CORS stays as it is: no `Access-Control-Allow-*` header on any app route, no wildcard origin, no credential sharing. This narrows the same-site gap; it is not complete CSRF protection (§7.12).

### 7.5 Security gaps found

| # | Gap | Decision (Brent, 2026-11-14) |
|---|---|---|
| S1 | QR Ph charge creation and status open to any caller with a sale id; POST skips `readJson` | **Fix in 19b**: the phone that made the sale; Decision 4 |
| S2 | `devices/binding` gives any caller a phone's barber, assignment and commission rate | **Fix in 19b**: that phone's credentials or Owner; Decision 5 |
| S3 | `catalog` gives any caller barber names, ids and commission rates | **Fix in 19b**: Phone or Owner; Decision 6 |
| S4 | Barbers' personal GCash and Maya QRs served to anyone on the shop Wi-Fi | **Fix in 19b**, recommended version: Owner sees all; a phone only its own barber's; Decision 8 |
| S5 | `/` sends today's paid-sale count to any browser | **Fix in 19b**: owner access, on the server; Decision 7 |
| S6 | The PIN cookie opens owner pages while no active owner account exists | **Required production-handover checklist**, §7.7; no code change in 19b |
| C1 | `forecast/refresh` is a cookie-authenticated write with no content-type check (§7.8) | **Fix in 19b**: `application/json` and a `{}` body, checked before any side effect; Decision 9 |

### 7.6 S4 investigation (basis for Decision 8)

- **Original rationale.** Slice 6 §4 (approved 2026-10-07): the list is "Public, like the catalog" and the image "Public (POS phones have no login). Same exposure as a printed QR on the counter." The vault record `2026-10-07-per-barber-gcash-maya-qr-display-record-only` doesn't discuss access. When slice 6 was approved, phones had no credential at all; phone approval came with slice 15, which didn't revisit these two routes. The stated reason, "phones have no login", no longer holds.
- **Consumers.** Backend: `GET /payment-qrs` (list: barber id, method, sha256, type) and `GET /payment-qrs/[barberId]/[method]` (image bytes, `Cache-Control: no-store`); PUT and DELETE are already owner-only. Frontend: `lib/payment-qr-cache.ts` (`refreshPaymentQrs`) fetches the list, then each changed image, and stores it as a data URL in Dexie `paymentQrs`; `/pos` calls it on load, after a bind and on reconnect. The POS GCash/Maya modal shows the stored data URL, with no network request when it is shown. The owner page `/payment-qr` fetches the list and shows each image with an ordinary `<img src="/api/v1/payment-qrs/…?v=<sha256>">`. Tests: `test:payment-qr` reads both routes without credentials; `test:qr-cache` is pure. The service worker does not cache them.
- **How they load.** The POS uses `fetch()`, which can send the approved-phone headers. The owner page uses a plain image URL, which can't send custom headers but does send the owner's cookies (same origin).
- **Customers and external pages.** None depend on these URLs. Customers scan the QR off the barber's screen, which comes from the phone's IndexedDB; no customer device requests them, and no external page links them.
- **Impact.** An unapproved or revoked phone gets 401 and keeps what it already holds for its own barber; offline display doesn't change. A new phone gets its QRs after approval, at the refresh after its first bind. A phone still running the old cached POS sends no headers: it keeps its current QRs until it updates (`sw.js` `VERSION` bump). The owner page works through its cookie. No schema or Dexie version change (the list record is in `localStorage`); a QR still never enters a sale.
- **Decision (Brent, 2026-11-14):** the recommended version, per-barber, plus the barber-bound cache and the unavailable state in Decision 8.

### 7.7 Production handover checklist (S6; required)

A required checklist, not an optional instruction: the shop does not run this version until every item is done and signed off. It lives in a new `docs/production-handover.md`, with a line per item for the date and who did it, and is referenced from `CLAUDE.md` and `README.md`.

1. **Create Mart's owner account.** On `/staff` (opened with the PIN while no owner account exists), create Mart's `OWNER` account with a username and a password he chooses.
2. **Verify on the shop PC**, each item checked:
   - the old PIN can't unlock owner pages: Lock, then the PIN unlock answers "Sign in with your owner account" (409 `OWNER_ACCOUNT_EXISTS`);
   - a PIN cookie issued before item 1 can't bypass it: a browser that unlocked with the PIN before item 1 gets the sign-in screen on `/ledger` and 401 on an owner route;
   - the owner account works: signing in with Mart's account opens `/ledger`, `/staff`, `/devices` and the forecast;
   - a barber account can't: signed in as a barber, owner pages show the sign-in and owner routes answer 401. [Changed 2026-11-14, §7.13: `/`, `/about` and every owner page land on `/pos`]
3. **Barber accounts**: create one per barber on `/staff`.
4. **Phones provisioned under the owner's supervision.** A newly approved phone with no assignment is assigned to whoever signs in on it first online (§2 case 7). So the owner (or the person he names) approves each phone, watches its barber do that first sign-in, and checks the barber's name on the POS before handing it over. A phone approved with the approval PIN and left unassigned could otherwise be claimed by another barber.
5. **Recovery**: tell Mart about `npm run owner:reset-password` on the shop PC for a forgotten password.

Also covered automatically: `test:owner-unlock` (the 409, no cookie) and `test:authz` (a PIN cookie issued before an owner account existed gets 401 on every owner route once one exists).

### 7.8 Cross-origin and CSRF audit (2026-11-14)

**What was checked.**

- **CORS:** the app sends no `Access-Control-Allow-*` header on any route (none in `src/`, no `headers()` in `next.config.ts`; `allowedDevOrigins` there is the dev server's hot-reload allowance, not CORS). The HTTPS gateway forwards the app's answers unchanged. Its setup server (`:3080`) sends `Access-Control-Allow-Origin: *` on `/found` only, which returns the shop name and certificate fingerprint and reads nothing of the app. So no other origin can read an app response, and no preflight (JSON, custom headers, PUT, DELETE) is ever granted.
- **Cookies:** the owner PIN cookie and the account session are `HttpOnly`, `SameSite=Strict`, `Path=/`, `Secure` over HTTPS.
- **Cookie-authenticated state-changing routes** and what stops a request from another page:

| Route | Method | Content type enforced | Cross-origin protection |
|---|---|---|---|
| `reports/payouts`, `reports/reconciliation`, `reports/time-review`, `users`, `devices/revoke` | POST | `readJson` (415) | SameSite + forced preflight (never granted) |
| `users/[id]` | PATCH | `readJson` (415) | SameSite + non-simple method (preflight) |
| `payment-qrs/[barberId]/[method]` | PUT, DELETE | image signature on PUT | SameSite + non-simple method (preflight) |
| `owner/lock`, `auth/logout` | POST | `readJson` (415) | SameSite + preflight; only clear cookies |
| `auth/login`, `owner/unlock` | POST | `readJson` (415) | preflight; set cookies only for valid credentials. `owner/unlock` answers 409 `OWNER_ACCOUNT_EXISTS` before it reads the body once an owner account exists, so `test:authz` accepts 409 or 415 there, with no cookie set |
| `forecast/refresh` | POST | **none today** (no body); after 19b `readJson` + `{}` (C1) | SameSite only today; after 19b SameSite + forced preflight |

Device routes (`sync`, `bind`, QR Ph after S1) are not cookie-authenticated: their secret travels in a header a page on another origin can't set without a preflight.

**Threat model for SameSite=Strict.** It stops pages on other sites from making the browser send the owner cookies: any internet site, another host on the shop Wi-Fi, and `localhost` versus `127.0.0.1` (different hosts). It does not stop a same-site page on another origin. A site ignores ports, so another web app on the same host and scheme counts as the same site: something else served on `http://127.0.0.1:<port>` on the shop PC, or on `https://<PC address>:<port>`. It also doesn't help in a browser without SameSite support, or against script running inside the app itself (XSS, out of scope). The JSON content-type rule covers the same-site gap for every JSON write, because a cross-origin `application/json` request still needs a CORS preflight, which is never granted. Non-simple methods (PUT, PATCH, DELETE) are covered the same way.

**C1 (fixed in 19b, Decision 9).** `POST /forecast/refresh` has no body and no content-type check today. A page on the same site but another origin (another app on the shop PC's `127.0.0.1`) could make the owner's browser trigger a forecast refresh while the owner is signed in. Impact is low: it saves a new forecast run and calls the ml-service; nothing is deleted and no money figure changes. After 19b it needs `application/json` and `{}`, so a cross-origin request needs a preflight, which is never granted.

**Tests (in `test:authz`):**

- every cookie-authenticated JSON write above, called with a valid owner cookie but `text/plain`, `application/x-www-form-urlencoded` or `multipart/form-data`: 415, and the state checks show nothing changed;
- `OPTIONS` preflights and ordinary requests with a foreign `Origin` on owner routes: no `Access-Control-Allow-Origin` or `Access-Control-Allow-Credentials` in any answer;
- `Set-Cookie` from `auth/login` and `owner/unlock`: `HttpOnly`, `SameSite=Strict`, `Path=/`, and `Secure` when the request came through HTTPS (`X-Forwarded-Proto: https`);
- C1, `forecast/refresh` with a valid owner cookie: no content type, `text/plain`, a form type or `multipart/form-data` → 415; malformed JSON, an array, `null`, a string or an object with a key → 400; in every case no new `forecast_runs` row. Side-effect order: with the ml-service stopped, a valid request answers 502 while every invalid one answers 415 or 400, so the checks run before the external call; with it running, only `{}` saves a run;
- no route sends `Access-Control-Allow-Origin: *` or `Access-Control-Allow-Credentials` (part of the foreign-`Origin` check above).

The suite can't run a browser's SameSite logic; that part rests on the threat model above and is listed in §7.12.

### 7.9 Build

- `lib/approval-gate.ts` (Decision 2) and the shared approval screen (Decision 3). `components/SignInGate.tsx` uses both, with unchanged behaviour. `components/OwnerSignIn.tsx` (the signed-out view of owner pages) and `/insights`, `/forecast`, `/staff` show the approval screen per Decision 2. `/` and `/about` are wrapped in the gate unless the server found owner access.
- S1: `payments/qrph/route.ts`, `payments/qrph/check/route.ts`, `components/QrPhCheckout.tsx`. S2: `devices/binding/route.ts`, `lib/sync.ts` (`verifyCurrentAssignment`). S3: `catalog/route.ts`, `app/pos/page.tsx`. S4: `payment-qrs/route.ts`, `payment-qrs/[barberId]/[method]/route.ts`, `lib/payment-qr-cache.ts`, `lib/payment-qr-plan.ts` (modal state), `lib/sync.ts` (`switchBarber` clears the old barber's QRs), the modal in `app/pos/page.tsx`. S5: `app/page.tsx`. C1: `forecast/refresh/route.ts`, `components/ForecastPanel.tsx`. Any test script that calls these routes without credentials moves to the right ones. `public/sw.js`: bump `VERSION` (cached `/pos` and `/shift-log` change).
- Docs: new `docs/production-handover.md` (§7.7). `CLAUDE.md` invariants: approved phones (`devices/binding`, `catalog`, `payment-qrs` and the QR Ph charge routes need the headers; a phone gets only its own barber's QRs); the approval screen is UI gating, never authorization; owner access and device approval never stand in for each other; the owner sign-in exception; the payment-QR rule (owner or own phone, barber-bound cache, the unavailable state). `CLAUDE.md` Known gaps: the items in §7.12. `CLAUDE.md` and `README.md` point to the handover checklist. Slice 6 §4 tagged "Superseded 2026-11-14 by slice 19 §7 (S4)". The vault register (follow-up to PR-4), a vault decision record for S4 (reversing slice 6's public access), and the manuscript sentences this makes false.

### 7.10 Tests

| # | Requirement | Where |
|---|---|---|
| 1 | B can't sign in on A's phone | `test:auth` (existing: 403 `PHONE_ASSIGNED`, nothing written) and `test:local-session` (offline refusal): must pass unchanged |
| 2 | Owner-PIN reassignment still works | `test:device-approval` (bind PIN cases), unchanged; this slice changes no bind code |
| 3 | Earlier and queued sales keep their barber | `test:attribution` T1 to T18 unchanged, plus: after a PIN move from A to B, a sale synced before and one queued before the move both stay A's (add only if no existing T case covers it; name the case in the report) |
| 4 | An unapproved browser gets the approval screen on the intended routes | New `npm run test:approval-gate` (Node only): every route × approved × owner access gives the expected screen (Decision 2), including owner access ignored on `/pos` and `/shift-log`. Browser check in §7.11 |
| 5 | An owner opens owner pages without approval | `test:approval-gate` (owner access → page on every owner route) and `test:authz` (owner account cookie, no phone headers: every owner route answers with its data) |
| 6 | A barber can't reach owner pages or routes | `test:authz`: every Owner row, every method, refused for each non-owner credential, with the data checks below; `/insights`, `/forecast`, `/staff` and `/` fetched with a barber session carry the sign-in view and no figures or count [Changed 2026-11-14, §7.13: a barber session is redirected to `/pos` from these pages, with no page markup] |
| 7 | Editing `localStorage` grants nothing | `test:authz`: device routes with no headers, a made-up secret, another phone's key, a revoked phone's secret and the owner cookie alone → 401, nothing written or returned |
| 8 | Revoking stops device routes and keeps queued sales | `test:device-approval` revoke cases and `test:sync-queue` (a 401 leaves every sale queued without `syncError`), both existing; plus the revoked phone on `devices/binding`, `catalog`, `payment-qrs` and the QR Ph routes in `test:authz` |
| 9 | S4 per-barber QRs | `test:payment-qr`: Owner gets every barber's list and images; a phone gets only its barber's list, 404 for another barber's image; no credentials, a made-up secret, a revoked phone → 401; after a PIN move the list follows the new barber. `test:qr-cache` (pure): the modal shows a QR only for the binding's barber, "not set up" only after a successful list for that barber without it, "unavailable" otherwise; a move clears the old barber's entries; the refresh plan deletes entries outside the list |
| 10 | Request restrictions (CSRF) and C1 | `test:authz`, §7.8: wrong content types and malformed bodies change no rows and make no external call |

**`test:authz`** (new, needs the dev server):

- The matrix lives in `scripts/lib/authz-matrix.ts`: each route file and exported method with who may call it. The suite reads `src/app/api` and fails when a `route.ts` or an exported method has no row, or a row names a route that doesn't exist, so a new handler can't skip the audit.
- Credentials tried, where they apply: none; a made-up device secret; a revoked phone; an approved phone; an approved phone asking about another phone's key, sale or barber; a barber session; an owner account session; a PIN cookie issued before the owner account existed.
- Data checks on refusals: the body carries no barber names, ids, commission rates, assignments, QR bytes, amounts or counts.
- State checks on refused writes: row counts and the touched rows of `transactions`, `device_assignments`, `devices`, `payout_entries`, `daily_payout_ledgers`, `shift_reconciliations`, `users`, `barber_payment_qrs`, `gateway_payments` and `forecast_runs` are unchanged.
- Allowed calls are checked for their data too (the owner gets the ledger rows; the phone gets its own binding, the catalog and its own barber's QRs; its own sale's QR Ph status when the gateway is on, in `test:gateway`).
- The request restrictions in §7.8.
- Scratch barbers, phones and accounts, removed at the end, as the other suites do.

Also: `test:gateway` and `test:qrph-charge` cover S1 with the gateway on (own phone succeeds; another phone's sale gets 404 and PayMongo is not called). Must pass unchanged: `test:attribution`, `test:sync-rejections`, `test:payload-compat`, `test:device-approval`, `test:sync-queue`, `test:submit-lock`, `test:sheet-stack`, `test:auth`, `test:local-session`, `test:owner-unlock`. All suites, `npm run lint` and `npx tsc --noEmit`, compared with `slice-19-suites-2026-11-14.txt`.

### 7.11 Manual test

1. A fresh browser profile (not approved, signed out) on `/`, `/about`, `/ledger`, `/insights`, `/pos`, `/shift-log`: only the approval screen. `/login` opens. View source of `/`: no paid-sale count.
2. From the approval screen on `/ledger`, "Owner sign-in", then sign in with the owner account: `/ledger` opens without approval and `/payment-qr` shows every barber's QR. Open `/pos` in the same profile: still the approval screen. Lock: back to the approval screen on `/ledger`.
3. In DevTools, set the phone's approval secret in `localStorage` to any text and reload `/pos`: at most the screen goes away; a sale queues, sync shows the waiting banner, and nothing reaches MySQL.
4. On an approved phone bound to test barber A, sign in as test barber B: "This phone is assigned to A"; nothing changes.
5. On that phone, tap GCash: A's test QR. Move the phone to test barber B with the owner PIN: GCash shows B's test QR, never A's. Repeat with the QR download blocked (stop the server right after the move): "GCash QR unavailable".
6. With the QR Ph test gateway on, ring a QR Ph sale on that phone: the QR shows and Check status works.
6b. Signed in as the owner on `/`, refresh the forecast from the home panel (ml-service running): a new run appears (C1 didn't break the button).
7. Revoke that phone on `/devices`: at the next ticket, the approval screen; the queued sales are still on the phone.
8. At 360 × 740 the approval screen and the QR unavailable state fit with no sideways scroll.

Test barbers and their sample QRs only (slice 6 Decision 5); no real account QR.

### 7.12 Remaining accepted security gaps after 19b

- **S6** until the handover checklist (§7.7) is signed off: the owner PIN opens owner pages while no owner account exists.
- **First sign-in claims an unassigned phone**: mitigated only by the supervised provisioning in §7.7 item 4.
- **QRs already on a phone**: revocation or removal stops future downloads, but can't erase a QR stored on a phone that stays offline. They are payment destinations, not credentials.
- **Not complete CSRF protection**: there is no CSRF token and no `Origin` check. Owner writes rely on SameSite=Strict cookies plus the preflight rule (every cookie-authenticated write needs `application/json` or a non-simple method, after C1). SameSite doesn't cover same-site pages on another origin (another app on the same host and scheme, any port) or browsers without SameSite support; the preflight rule rests on CORS staying closed. The browser's SameSite behaviour is not covered by automated tests.
- **Public by design**: active barber names and the price list on `/` and `/about` (behind the approval or sign-in screen in the UI only; a barber session is redirected before they render, §7.13); barber and service counts on `health`; whether QR Ph is on.
- **CLAUDE.md Known gaps, unchanged**: a copied owner cookie works until it expires; someone on the Wi-Fi can lock a username for 15 minutes; the offline password verifier on the phone; a barber who knows a colleague's password; sync can register an unknown assignment as revoked from a modified client.

### 7.13 Correction: role-based page access (Brent, 2026-11-14, after the 19b manual test)

**Found in the manual test.** Signed in with a `BARBER` account, `/` still opened (and `/about`): the gate decided from device approval and owner access, and approval alone opened those pages. The intended rule was always that barbers use `/pos` and `/shift-log` only. Device approval says which phone may bind and sync; it is not page authorization. This section separates the two. It supersedes Decision 2's `/`, `/about` bullet and the page half of edge case 5 (§7.2); everything else in §7 stands.

**Rule.** Which pages open is decided on the server from the account session's role. Device approval decides only the approval screen (in the browser) and the device routes (on the server).

| Who | Pages |
|---|---|
| `OWNER` (account session; the PIN cookie only while no active owner account exists) | `/`, `/about` and every owner page (`/ledger`, `/devices`, `/payment-qr`, `/reconciliation`, `/insights`, `/forecast`, `/staff`), from any browser, approved or not. Still never passes the approval screen on `/pos` and `/shift-log` and never records, syncs, binds or charges by QR Ph (Decision 2, case 4) |
| `BARBER` (account session) | `/pos` and `/shift-log` only. A barber signs in on `/pos` and stays there. Any other page (`/`, `/about`, every owner page, any page added later) answers 307 to `/pos` from the server before anything of the page renders. A barber session never gives owner access: while it is valid it alone decides, so a PIN cookie beside it counts for nothing, and a barber sign-in clears a leftover PIN cookie so it can't come back into force when the session ends at midnight |
| Signed out, browser not approved | The approval screen ("Owner sign-in" on every page except `/pos` and `/shift-log`), as in Decision 2 |
| Signed out, browser approved | `/pos`, `/shift-log`: the barber sign-in (`SignInGate`). Owner pages: the owner sign-in. `/`, `/about`: a sign-in screen with "Barber sign-in (POS)" (to `/pos`) and "Owner sign-in" (to `/login?next=` that page), never the page |
| Anyone | `/login` opens (owner sign-in) |

**How it is enforced.**

- `ownerPageAccess()` in `lib/owner-access.ts` replaces `ownerAccessFromCookies()` for pages. A valid account session whose role isn't `OWNER` → `redirect("/pos")`; an `OWNER` session → owner access; no valid session → the PIN cookie rule (Decision 2 of slice 19). Every page except `/pos`, `/shift-log` and `/login` calls it on the server: `/`, `/about`, `/insights`, `/forecast` and `/staff` in the page itself; the client owner pages (`/ledger`, `/devices`, `/payment-qr`, `/reconciliation`) through `OwnerPageGate` in their `layout.tsx`. Next.js layouts don't stop a page segment from rendering, so the server pages call it themselves too; the client pages render no data on the server.
- Route handlers keep `hasOwnerAccess` (401 JSON, never a redirect); nothing changes in the authorization matrix (§7.3). No proxy or middleware.
- `/pos` and `/shift-log` get no server redirect and no server role check, so their cached copies keep opening offline, and the service worker still sends an offline phone from the start page `/` to `/pos`. A barber signed in offline has no cookie: the server sees a signed-out browser, so `/` shows the sign-in screen, never the page.
- `lib/approval-gate.ts`: `BARBER_HOME`, `barberMayOpen(pathname)` (the rule above, for the tests) and the `sign-in-choice` screen for `/`, `/about` in an approved browser without owner access.
- Navigation (usability only; the redirect is the protection): the POS no longer links to `/` (its brand is plain text) or to End-of-Day Cash; the shift log links only to `/pos`. The owner sign-in tells a barber account "Barbers sign in on the POS".
- `public/sw.js` `VERSION` 4, because the cached `/pos` changed (the same rule as §7.9). Checked on a production build behind the HTTPS gateway: a browser running the VERSION 3 POS (old links, barber signed in) took the update on its next online visit (only the v4 caches left, `/pos`, `/shift-log` and `offline.html` stored), then with the PC unreachable opened `/pos` (still signed in, no link to `/` or End-of-Day Cash), `/shift-log` (links only to `/pos`), and `/` went straight to `/pos`.

| # | Edge case | What happens |
|---|---|---|
| 1 | A barber, signed in, types `/ledger` (or `/`, `/about`, `/forecast`, `/staff`) | 307 to `/pos`; the answer carries only Next's redirect shell, no page markup or figures |
| 2 | The owner unlocked with the PIN on a phone earlier; a barber then signs in there | The barber session decides (no owner access); the sign-in also clears the PIN cookie |
| 3 | A barber's session ended at midnight; the installed app opens on `/` | Signed out and approved: the sign-in screen; "Barber sign-in (POS)" leads to the POS sign-in |
| 4 | The owner wants owner pages on a barber's approved phone | `/login` (or "Owner sign-in"), then owner pages open; `/pos` there still needs a barber sign-in, and an owner account is refused on the POS sign-in (403 `OWNER_ON_POS`) |

**Owner and barber on the same browser** (Brent, 2026-11-14, after the final review). An owner sign-in on a barber's phone used to leave the barber's local session running beside the owner's cookie: the POS kept selling as that barber, and while the owner cookie was there the session check answered for the owner and never noticed a reset or deactivation of the barber's account. Now:

- A successful owner sign-in in the browser (owner account, or the PIN unlock while no owner account exists) ends the barber's local session and deletes its offline verifier (`endBarberSessionForOwner` in `lib/local-session.ts`, called by `components/OwnerSignIn.tsx`, which every owner sign-in uses). The next barber sign-in on that phone must be online.
- A successful PIN unlock also clears an account cookie sent with it (`owner/unlock`): the PIN unlocks only while no owner account exists, so that cookie can only be a barber's, and a valid barber session would otherwise win over the PIN session. The PIN cookie stays the first `Set-Cookie`.
- A POS open in another tab rereads the sign-in at once (`storage` event in `SignInGate`, `staffSessionChanged`).
- `GET /api/v1/auth/session` answers 401 `SESSION_REPLACED` when the POS names its account (`userId`) and the browser's valid cookie belongs to another account; the POS then ends its session and deletes the verifier (`applySessionAnswer`). This also catches an owner signed in by any other path. The answer names neither account; without `userId` (the owner sign-in form) nothing changes. An older cached POS doesn't know the reason and keeps its session, as before.
- Untouched: the device key and secret, the binding and pending assignment, IndexedDB, queued sales and attribution (a sale stays its assignment's barber's). A sale between Charge and Record still finishes first (`hold`).

**Tests.**

- `test:local-session` (Node only): through `endBarberSessionForOwner` and through `SESSION_REPLACED`, the session and verifier go, every other key stays, offline sign-in is refused (`NEEDS_PC`) until a fresh online sign-in, and then works again; no cookie, an expired cookie or no answer still keep the session; `staffSessionChanged` reacts only to the sign-in keys.
- `test:auth` (dev server): the barber's own cookie naming its own account → 200; the owner's cookie while the POS names the barber → 401 `SESSION_REPLACED` with no account data, with or without phone headers; the owner's cookie with no account named → 200; no cookie → 401 `NONE`, unchanged.
- `test:owner-unlock` (PIN cases; a database without an owner account): the correct PIN with a real barber session cookie → 200, the PIN cookie first and the barber cookie cleared; both cookies together would refuse the owner route (the barber session wins); the PIN cookie alone opens it; without an account cookie nothing else is cleared.
- `test:approval-gate` (Node only): A1 updated (`/`, `/about` approved without owner access → `sign-in-choice`); A6 the role rule (`barberMayOpen`: `/pos`, `/shift-log`, `/login` yes; `/`, `/about`, every owner page, unknown pages no); A7 reads the source: every `page.tsx` outside `/pos`, `/shift-log` and `/login` calls `ownerPageAccess` or sits under a layout with `OwnerPageGate`; `/pos`, `/shift-log` and the root layout don't; and `ownerPageAccess` redirects a non-owner session to `/pos`. A new page without the check fails the suite.
- `test:authz` (dev server): P1 a barber session (alone, on an approved phone, and with a PIN cookie beside it) gets 307 to `/pos` with no page markup on `/`, `/about` and every owner page, and 200 on `/pos` and `/shift-log`; P2 the owner session with no phone headers gets 200 on `/`, `/about` and every owner page, with owner content; P3 an owner account is refused on the POS sign-in, `/pos` and `/shift-log` answer the same shell to the owner (approval is decided on the phone), and signed-out browsers are not redirected and get no count or account form; P4 barber sign-in clears `ruzzco_owner_access`, owner sign-in doesn't.

**Manual test (adds to §7.11).**

9. On an approved phone, signed in as a test barber: type `/`, `/about`, `/ledger`, `/forecast` and `/staff` in the address bar. Each lands on `/pos`. `/pos` and `/shift-log` work; the POS has no link to the home page or End-of-Day Cash.
10. On the shop PC (not approved), sign in as the owner on `/login`: `/`, `/about` and every owner page open. `/pos` still shows the approval screen.
11. A fresh profile, not approved: `/` shows the approval screen with "Owner sign-in". On an approved phone, signed out: `/` shows "Barber sign-in (POS)" and "Owner sign-in", `/pos` the barber sign-in, `/ledger` the owner sign-in.
12. An installed phone that ran the earlier POS: open it once on the shop Wi-Fi (production server and `npm run https`), then turn Wi-Fi off and reopen it. `/pos` and `/shift-log` open, the barber is still signed in, and the POS has no link to the home page or End-of-Day Cash.
13. On an approved phone with a barber signed in on `/pos`, open `/login` in a second tab and sign in as the owner: the `/pos` tab shows the barber sign-in at once, without a reload. Turn Wi-Fi off and try the barber's password: "This account must sign in once with the shop PC on…". Back online, the barber signs in and sells as before; earlier sales keep their barber.

<!-- END OF SPEC -->
