# Slice 19 — Staff login

Repo: `ruzzco-system`. Status: **PRELIMINARY, register item PR-4** (written 2026-11-14), branch `revision/preliminary`. The rule and edge cases in §2 are OK'd by Brent (2026-11-14). The decisions in §3 are OK'd by Brent (2026-11-14).
Goal: the owner and each barber sign in with their own username and password, without changing who a sale is credited to, what lets a phone send sales, or the POS's ability to work with the shop PC off.

Before writing code, read the guides in `web/node_modules/next/dist/docs/` for route handlers, `cookies()` and server components (Next.js 16; `cookies()` is async).

## 1. Scope boundary (read first)

- In: accounts on `users` (one additive migration), password hashing, a signed account session, the auth and staff-account routes, the owner session seam (`lib/session.ts`, async `hasOwnerAccess`), the phone's offline sign-in (`lib/local-session.ts`, `components/SignInGate.tsx` on `/pos` and `/shift-log`), an owner sign-in page, a Staff accounts page, an optional `userId` on sales, a recovery script, and the tests.
- Unchanged: sale-time attribution by assignment, `cashierId`, commission snapshots, per-sale sync results, rejected-sale handling, Dexie-first writes, the client UUID as idempotency key, expected drawer cash, QR Ph. Phone approval stays the only credential for `bind` and `sync`. The owner PIN keeps approving phones (`POST /api/v1/devices/approve`, with the approval PIN as today) and authorizing a move to another barber (`pin` on `POST /api/v1/devices/bind`).
- Look: the new screens work but use today's styling and components. Their visual design comes from the redesign (slice 21); no theme or layout work here.
- Out: removing the PIN from phone approval and phone moves (considered, kept for safety, possible later slice); barbers changing their own password; an activity log; the server price check (slice 16); role-based landing and navigation (slice 21); counter-station mode (several barbers on one phone).

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
10. **Case 4 on the phone.** Whenever the POS opens or a new ticket starts while the PC is reachable, the phone checks `GET /api/v1/auth/session`. 401 `PASSWORD_CHANGED` or `INACTIVE`: the local session ends and the verifier is deleted; sign-in is asked for. A network error keeps the local session.
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

<!-- END OF SPEC -->
