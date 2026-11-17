# Slice 29 — Activity Log (owner-facing audit history)

Repo: `ruzzco-system`. Status: **DEFERRED — NOT PART OF CURRENT REVISION (Brent, 2026-11-17).** Kept as a future-work specification only. Nothing in it is built: no schema, migration, route, service, page or test exists. Do not hand it to an implementation session, and do not cite it as implemented. Reason for deferral: it adds backend, schema, migration and instrumentation scope, while the remaining revision work is UI/UX driven by actual usage. The manuscript states the exclusion (Scope and Limitations, Excluded Features; manuscript Increment 7). The panel item stays "not implemented" in the revision matrix until the adviser decides.
History: written as a PLAN on 2026-11-17 by the auditor and planner session after a read-only audit; deferred the same day before any build.
Branch: `revision/preliminary` (do not change branches). Uncommitted until Brent approves.
Number: **29, confirmed by Brent (2026-11-17).** Slice 28 is the Forecast page presentation (`slice-28.md`). The Sales URL filters and the ledger Custom amounts cleanup (the leftovers of the old "slice 23 draft", see slice-25.md line 5) are unnumbered deferred work, not slice 28. Q1 in §16 is answered.

Legend used below: **[F]** confirmed fact from the code as audited at HEAD `95a8945` plus the uncommitted slices 23–27; **[R]** recommendation; **[Q]** unresolved, see §16.

## 1. Requirement and provenance

- [F] Source: a panel member's verbal request at the preliminary defense, recalled by the team (register **V-2**, "Activity logs", `80_Preliminary_Revisions/2026-11-16-stage2-D-internal-revision-to-evidence-matrix.md`). It is not a written panel recommendation. Brent clarified (2026-11-17) that it is a required panel revision.
- [F] The request did not define its scope. This spec is the team's interpretation: **an operational audit trail for the owner** (who did an important thing, what, to what, when, with what result). It is not a developer log and not clickstream or staff monitoring. The pre-mortem's P5 is answered this way. O5 (who may read it) and D5 (retention and backup) are open; see §16.
- Do not quote the panel. Do not name or identify the panel member in this spec or in code comments (slices are public).
- [F] Earlier specs excluded an activity log on purpose (slice 19 §1, slice 20 §1). This slice reverses that exclusion for the scope below only.
- [F] No activity table, model or route exists today (`prisma/schema.prisma`; confirmed by Stage 2-C).

## 2. Scope

**In**
- A new table `activity_logs`, append-only.
- A typed event catalog and one server-side logging service.
- Instrumentation of the events in §4.
- A read-only owner route `GET /api/v1/activity` with server-side filters and pages.
- A read-only owner page `/activity` ("Activity log"), listed in the owner menu.
- Tests (§13) and the documentation updates (§12).

**Out (explicit)**
- Excel or CSV export.
- Page views, navigation, filter changes and clicks.
- Read-only routes of any kind.
- Attendance, employee monitoring, customers, inventory, payroll, notifications.
- New roles or permissions.
- Any browser-submitted event.
- Backfilling events from before this slice.
- Editing or deleting activity rows.
- Replacing any existing specialized record (§6).
- Events for these, which stay **not instrumented in v1** (listed so nobody claims full coverage): payment-QR upload and removal (`PUT`/`DELETE /api/v1/payment-qrs/[barberId]/[method]`); forecast refresh (`POST /api/v1/forecast/refresh`); QR Ph charge creation and status changes (`POST /api/v1/payments/qrph`, `.../check`, the PayMongo webhook); wrong PINs on unlock, approve and bind; sign-in refusals other than a wrong password; a barber's offline (local-verifier) sign-in; session expiry; seeds and scripts (`prisma db seed`, `seed:demo`, `owner:reset-password`). [R] Payment-QR changes and the owner-password reset script are the strongest candidates for a later increment.

## 3. Architecture facts that shape the design [F]

- Owner access: `hasOwnerAccess(request)` (`src/lib/owner-access.ts:93`). It accepts an active OWNER account session (`ruzzco_session`, `src/lib/session.ts`), or the PIN cookie while no active owner account exists. The PIN cookie carries **no identity**, only "whoever knows the owner PIN".
- Server pages use `ownerPageAccess()` (owner-access.ts:107), which redirects a barber session to `/pos`. Owner pages sit behind `OwnerPageGate` in their `layout.tsx`.
- Accounts: `users`. Deactivated, never deleted. `name`, `username` and `role` are available to snapshot. `lastSignInAt` is already written at sign-in (login route line 77).
- Phones are identified by `deviceKey` (the phone's localStorage UUID, "not a secret"; schema comment) plus a hashed secret. `devices.label` is optional. `/devices` already shows the raw key to the owner.
- Phone approval is done by a **PIN**, not by a signed-in person: `OWNER_PIN` or `DEVICE_APPROVAL_PIN` (`approvedWith` = OWNER | APPROVER).
- Sync: each sale is idempotent by its client UUID. Duplicates are skipped before any write (`sync/route.ts`, `existingIdSet`). The insert and its mismatch log are one `$transaction` in `recordSale` (`src/lib/record-sale.ts:52`). A concurrent duplicate fails on the primary key and its transaction rolls back. Refusals write **nothing** today; they exist only in the response and in `console.warn`.
- Sync may register an unknown assignment as already revoked (`sync/route.ts:144`, `createMany … skipDuplicates`). This is the documented path that bypasses the PIN (CLAUDE.md Known gaps).
- Bind (`devices/bind/route.ts:159`): revoke and create in one interactive `$transaction`, retried on P2002/P2034. A retry of an existing id goes through `respondToExisting` and writes nothing. An inactive barber gets a historical (revoked) row and a 409.
- Payouts: `withLockedRow` (`reports/payouts/route.ts:165`) locks the ledger row `FOR UPDATE` and writes the entries and the ledger sums in one interactive transaction. A replay of an existing entry id creates nothing (`replay: true`). The legacy body (`cashPaid`/`gcashPaid`) can create up to two entries.
- End-of-Day Cash: each save is a new `shift_reconciliations` revision (`reconciliation/route.ts:137`). A unique `(date, revision)` collision retries with the next number.
- Time review: `reviewSaleDate` (`src/lib/time-review.ts`) does a conditional `updateMany … timeReviewedAt: null`. Its outcomes are `reviewed`, `unchanged` (same choice again), `already_reviewed`, `future_date`, `not_found` and `not_flagged`.
- Wrong passwords and PINs are limited in memory (`src/lib/pin-attempts.ts`): 5 per key, or 30 shop-wide, in 15 minutes, then a 15-minute lock during which attempts are not even checked.
- Date ranges: `parseRange` (`src/lib/date-range.ts`): Manila dates, both ends included, at most 366, `to` not after today. Queried with `gte` the start of `from` and `lt` the start of the day after `to`.
- List conventions (slice 22): `Pager`, `PAGE_SIZE_PRESETS` 10/25/50/100, `DateRangeBar` + `presetOptions`, `ShowingLine` with Reset to default, kept settings through `lib/list-settings.ts`, a table on `md+` and cards below it. `SalesList.tsx` is the closest template.
- Every route must have a row in `scripts/lib/authz-matrix.ts`, or `test:authz` M1 fails. `test:authz` also counts rows in ten tables to prove that a 401 writes nothing (test-authz.ts:324).
- Test suites create scratch users, barbers, phones and sales on the dev database, then delete them directly with Prisma at the end.

## 4. Event catalog

Every event has a fixed `category`, an `action` key, an outcome, an actor rule, a target and an **allowlist of details**. Anything not on the allowlist is dropped by the service (§7). Descriptions are generated on the server from the catalog. They are never stored, so wording can change without a migration.

Categories: `AUTH` (Sign-in), `STAFF` (Staff accounts), `PHONES` (Phones), `SALES` (Sales), `PAYOUTS` (Payouts), `CASH` (End-of-Day Cash).

| # | action | Category | Outcome | Source (exact) | When it is written | Target | Details allowlist |
|---|---|---|---|---|---|---|---|
| A1 | `auth.signed_in` | AUTH | SUCCESS | `POST /api/v1/auth/login`, after `accountUsable` and the device checks, where `user.update({lastSignInAt})` runs (line 77) | Successful account sign-in, owner or barber | `USER` / user id | `where`: `"pos"` \| `"browser"` |
| A2 | `auth.sign_in_failed` | AUTH | REFUSED | same route, the `!passwordOk` branch (line 50), **only when `user` exists** | Wrong password for an existing username | `USER` / user id | none |
| A3 | `auth.owner_pin_unlocked` | AUTH | SUCCESS | `POST /api/v1/owner/unlock`, after `recordSuccess` (line 42) | PIN unlock (only possible while no owner account exists) | none | none |
| A4 | `auth.signed_out` | AUTH | SUCCESS | `POST /api/v1/auth/logout` and `POST /api/v1/owner/lock` | Only when the request carried a **valid** session (or a valid PIN cookie on lock). No cookie, or an expired one, writes nothing. | none | `how`: `"sign_out"` \| `"lock"` |
| S1 | `staff.account_created` | STAFF | SUCCESS | `POST /api/v1/users` (`user.create`, line 72) | Account created | `USER` / new id | `username`, `role`, `barberName` |
| S2 | `staff.account_deactivated` | STAFF | SUCCESS | `PATCH /api/v1/users/:id` (tx at line 47) | `isActive` changes from true to false | `USER` / id | `username` |
| S3 | `staff.account_reactivated` | STAFF | SUCCESS | same | `isActive` changes from false to true | `USER` / id | `username` |
| S4 | `staff.password_set` | STAFF | SUCCESS | same | `password` present in the body (set or reset) | `USER` / id | `username` |
| S5 | `staff.username_set` | STAFF | SUCCESS | same | `username` present and different from the stored one | `USER` / id | `previousUsername`, `username` |
| P1 | `phone.approved` | PHONES | SUCCESS | `POST /api/v1/devices/approve` (`device.upsert`, line 62) | Every successful approval, including a re-approval | `DEVICE` / deviceKey | `label`, `reapproved` (bool) |
| P2 | `phone.revoked` | PHONES | SUCCESS | `POST /api/v1/devices/revoke` (`updateMany`, line 27) | Only when `count === 1` (revoking again is a no-op and writes nothing) | `DEVICE` / deviceKey | `label` |
| P3 | `phone.assigned` | PHONES | SUCCESS | `POST /api/v1/devices/bind`, inside the `$transaction` at line 159 | A **new** active assignment was created. Not on `respondToExisting`, not for the inactive-barber historical row. | `DEVICE` / deviceKey | `barberName`, `previousBarberName`, `ownerPinUsed` (bool) |
| P4 | `phone.assignment_registered` | PHONES | SUCCESS | `POST /api/v1/transactions/sync`, the `createMany` of unknown assignments (line 144) | An assignment first known through its sales, recorded as already ended | `DEVICE` / deviceKey | `barberName` |
| L1 | `sale.accepted` | SALES | SUCCESS | `recordSale` (`record-sale.ts:52`), same `$transaction` | The sale was newly inserted (never on a duplicate) | `SALE` / sale id | `barberName`, `statedTime` (the phone's `transactionTime`, ISO), `timeFlag`, `account` (username of the sale's `userId`, information only) |
| L2 | `sale.refused` | SALES | REFUSED | `sync/route.ts`, the `reject(...)` calls | Each refused item **whose id is a UUID** | `SALE` / sale id | `reason` (`SyncRejectReason`) |
| L3 | `sale.date_reviewed` | SALES | SUCCESS | `POST /api/v1/reports/time-review` → `reviewSaleDate` | Status `reviewed` only (not `unchanged` or any refusal) | `SALE` / sale id | `choice`, `businessDate` |
| Y1 | `payout.recorded` | PAYOUTS | SUCCESS | `withLockedRow` (`payouts/route.ts:165`), per created entry of kind `PAYOUT` | Entry created (not on `replay`) | `PAYOUT_ENTRY` / entry id | `barberName`, `businessDate`, `method`, `amount` |
| Y2 | `payout.corrected` | PAYOUTS | SUCCESS | same, per created entry of kind `CORRECTION` | Correction entry created; a **separate negative entry**, never an edit | `PAYOUT_ENTRY` / entry id | `barberName`, `businessDate`, `method`, `amount` (positive as typed), `correctsId` |
| C1 | `cash.reconciled` | CASH | SUCCESS | `POST /api/v1/reports/reconciliation` (`shiftReconciliation.create`, line 137) | Revision 1 saved for a date | `RECONCILIATION` / row id | `businessDate`, `revision`, `variance` |
| C2 | `cash.reconciliation_revised` | CASH | SUCCESS | same | Revision ≥ 2 saved; append-only as today | `RECONCILIATION` / row id | `businessDate`, `revision`, `variance` |

Notes
- [R] A2 is included because the limiter bounds it: at most 5 rows per username, and 30 shop-wide, per 15 minutes, since attempts during a lock are refused before they are checked. An unknown username writes **nothing**, so no attacker-typed text is ever stored. This is the only failed-authentication event. **Q3** confirms.
- [R] A4: `OwnerSignIn.tsx:51` and `sign-in-client.ts:89` call logout as part of their own flows. The event is honest: a valid session was ended. Session expiry is never an event.
- [F] Account-to-barber linkage cannot change: `PATCH /api/v1/users/:id` accepts only `username`, `password` and `isActive`. So there is no linkage event; the link is shown in S1.
- [F] Payout amounts are already visible to the owner on Payouts. Sale amounts are deliberately **not** copied into L1: Sales is authoritative for money (§6).

## 5. Actor attribution matrix

Actor types (MySQL enum `ActivityActorType`):
- `USER`: an account; id, username and role snapshotted.
- `OWNER_PIN`: the owner PIN, no person.
- `APPROVAL_PIN`: the approval PIN, no person.
- `PHONE`: an approved phone, identified by its key.
- `UNKNOWN`: not signed in.

There is no `SYSTEM` type in v1, because no v1 event is system-initiated. [R] Add `SYSTEM` together with the first webhook or scheduled event, as an additive enum value.

| Event | Actor | Resolved from (server) | Shown as |
|---|---|---|---|
| A1 | USER (the account that signed in) | the `user` row just verified | name · Owner/Barber |
| A2 | UNKNOWN | nobody proved their identity; the **target** is the account | "Not signed in" |
| A3 | OWNER_PIN | the PIN check | "Owner PIN" |
| A4 | USER, or OWNER_PIN for a PIN cookie on lock | `requestSession(request)` / `isOwnerCookie` **before** the cookies are cleared | name · role / "Owner PIN" |
| S1–S5, P2, L3, Y1, Y2, C1, C2 | the owner: USER if the account session is valid, else OWNER_PIN | `ownerActor(request)` (new, §7) | name · Owner / "Owner PIN" |
| P1 | OWNER_PIN or APPROVAL_PIN (`approvalPinRole`) | the PIN that approved | "Owner PIN" / "Approval PIN" |
| P3, P4, L1, L2 | PHONE (the authenticated device key) | `authenticateDevice` | its label, or "Phone ·" plus the key's last 4 characters |

Rules
- [R] A person is never inferred from a PIN. "Approval PIN" is not written as a barber's name, even though the business knows whose PIN it is.
- [R] A sale's `userId` (slice 19) is information only (invariant). It goes in L1's `account` detail, never into the actor.
- [R] The actor's name, username and role are **snapshotted** in the row, so a deactivated or renamed account still reads correctly. `actor_user_id` has **no foreign key**: test cleanups delete scratch users, and a Restrict FK would block them; there is no SetNull need either, because accounts are never deleted by the app.
- [F] For the owner, the PIN cookie means "someone with the owner PIN". The UI must not show it as a named owner.

## 6. Existing records that stay authoritative [F]

The Activity Log points at these records and never replaces them. **No figure on any page may be computed from `activity_logs`.**

| Record | Remains the source of truth for |
|---|---|
| `transactions` (+ items, commission logs) | every sale, its money, `transactionTime` (phone) and `syncedAt` (server receipt) |
| `sync_mismatch_logs` | barber overrides at sync (L1 does not repeat them) |
| `payout_entries`, `daily_payout_ledgers` | what was paid and corrected |
| `shift_reconciliations` | every counted-cash revision and its figures |
| `devices`, `device_assignments` | approval state and the binding history |
| `users.lastSignInAt` | the last sign-in |
| `gateway_payments`, `gateway_webhook_events` | QR Ph state |

## 7. Data model

[R] New Prisma model (additive; a new table; no change to existing tables):

```prisma
enum ActivityActorType { USER OWNER_PIN APPROVAL_PIN PHONE UNKNOWN }
enum ActivityOutcome   { SUCCESS REFUSED }

/// Slice 29: append-only owner audit trail. Written only by server code through
/// src/lib/activity-log.ts; never updated or deleted by the app; no figure reads it.
model ActivityLog {
  id           BigInt            @id @default(autoincrement())
  occurredAt   DateTime          @default(now()) @map("occurred_at")      // server clock, DATETIME(3)
  category     String            @db.VarChar(16)                          // AUTH|STAFF|PHONES|SALES|PAYOUTS|CASH (catalog)
  action       String            @db.VarChar(48)                          // catalog key, e.g. "payout.recorded"
  outcome      ActivityOutcome   @default(SUCCESS)
  actorType    ActivityActorType @map("actor_type")
  actorUserId  String?           @map("actor_user_id")                    // USER only; no FK (see §5)
  actorName    String            @db.VarChar(100) @map("actor_name")      // snapshot
  actorRole    String?           @db.VarChar(16) @map("actor_role")       // snapshot: OWNER|BARBER
  targetType   String?           @db.VarChar(24) @map("target_type")      // USER|DEVICE|SALE|PAYOUT_ENTRY|RECONCILIATION
  targetId     String?           @db.VarChar(64) @map("target_id")
  details      Json?                                                        // allowlisted, ≤ 1 KB serialized
  dedupeKey    String?           @unique @db.VarChar(100) @map("dedupe_key") // sync events only

  @@index([occurredAt, id])
  @@index([actorUserId, occurredAt])
  @@index([actorType, occurredAt])
  @@index([category, occurredAt])
  @@index([action, occurredAt])
  @@index([targetType, targetId])
  @@map("activity_logs")
}
```

- [R] `category` and `action` are strings checked against the TypeScript catalog, so a new event needs no migration. `outcome` and `actorType` are small fixed sets, so they are enums.
- [R] `targetId` stores the device key for PHONE targets. The API never returns it raw (§8). A target id is up to 64 characters, enough for UUIDs and BigInt ids; anything longer is refused by the service.
- [R] `dedupe_key` is NULL except on sync events (`sale.accepted:<uuid>`, `sale.refused:<uuid>:<REASON>`, `assignment.registered:<uuid>`). MySQL allows many NULLs in a unique index.
- [R] `occurred_at` uses Prisma's default `now()`. Never pass a client time into it.
- [R] **The service** (`src/lib/activity-log.ts`) exposes only:
  - `activityRow(event: CatalogEvent, actor: ActivityActor)` → `Prisma.ActivityLogCreateManyInput`. It is pure and testable. It checks the action is in the catalog, keeps only the action's allowlisted detail keys, coerces types (strings trimmed and cut to 100 characters, numbers finite, booleans), drops `null`/`undefined`, and caps the JSON at 1 KB.
  - `logActivity(db: Prisma.TransactionClient | PrismaClient, event, actor)`: one insert, for use inside the caller's transaction.
  - `logActivityMany(db, rows, { skipDuplicates })`: for sync.
  - `ownerActor(request): Promise<ActivityActor | null>`: the same logic as `hasOwnerAccess`, returning who. [R] Re-implement `hasOwnerAccess` as `(await ownerActor(request)) !== null`, so the two can never drift, and add an equivalence check to `test:authz`.
  - `phoneActor(deviceKey)`: reads `devices.label` once per request, and only when the request has something to log.
  - Catalog types: `CatalogEvent` is a discriminated union keyed by `action`, so a call with an unknown action or a wrong detail is a **compile error**, not a runtime surprise.
- [R] Migration: write it with `prisma migrate diff --from-schema-datasource … --to-schema-datamodel … --script` from Git Bash (CLAUDE.md), into `prisma/migrations/2026111712xxxx_activity_logs/`. Review that it contains only `CREATE TABLE activity_logs` plus its indexes. Apply with `npx prisma migrate deploy` after `scripts/dev-reset.ps1`. **Before applying**, the implementer must read the datasource line that Prisma prints (`MySQL database "ruzzco_db" at "localhost:3307"`) and stop if it names anything else. Never print the URL. The live shop database is on the shop PC and is never touched.
- Retention [Q, D5]: keep everything in v1, and add no purge job. Volume estimate: about one L1 row per sale plus a few dozen owner actions per day, so roughly 15–25k rows a year. That is small for MySQL with these indexes.

## 8. Read API and authorization

`GET /api/v1/activity?from&to[&actor][&category][&action][&outcome][&page][&pageSize]`. This is the **only** handler in `src/app/api/v1/activity/route.ts`. There is no POST, PUT, PATCH or DELETE, so Next.js answers 405 to them, and nothing in the app writes an activity row from a request body.

- Access: `hasOwnerAccess` → otherwise 401 `OWNER_REQUIRED` (`ownerRequiredResponse`). A barber session therefore gets 401, like every owner route. There are no phone credentials.
- Params, validated on the server:
  - `from`/`to` are required: `parseRange(from, to, manilaToday())`, giving 400/422 with its message. Query `occurredAt gte first.start, lt last.end`.
  - `actor` ∈ `all` | `user:<id>` | `owner-pin` | `approval-pin` | `phones` | `unknown`.
  - `category` must be a catalog category; `action` a catalog action, consistent with `category` when both are given.
  - `outcome` ∈ `all` | `SUCCESS` | `REFUSED`.
  - `page` ≥ 1; `pageSize` ∈ `PAGE_SIZE_PRESETS`, default 25.
  - Anything else gets a 400.
- Query: `count` + `findMany({ orderBy: [{occurredAt:"desc"},{id:"desc"}], skip, take })`, two queries. Clamp `page` to `pageCount`, as the Sales route does.
- Response:
  ```
  { success, from, to, page, pageCount, pageSize, total,
    events: [{ id (string), occurredAt (ISO), category, action, outcome,
               actor: { type, name, role|null },
               description, module (category label),
               target: { type, label } | null,
               details: [label, value][] }] }
  ```
  - `description` and the detail labels come from the catalog.
  - The target label for DEVICE is the phone's label, or "Phone ·" plus the last 4 characters of the key; the raw key is never returned. For SALE, `PAYOUT_ENTRY` and `RECONCILIATION` it is the short id (first 8 characters; full id in details). For USER it is the username snapshot.
- Authz matrix row: `{ route: "v1/activity", method: "GET", access: "owner", note: "slice 29: activity log over from/to, read-only" }`.
- [R] Pages: `/activity` is added to `OWNER_PAGES` (`lib/approval-gate.ts:37`). `src/app/activity/layout.tsx` = `OwnerPageGate pathname="/activity" title="Activity log"`. `page.tsx` calls `ownerPageAccess()` itself (layouts don't stop pages; CLAUDE.md role-based pages). Without access it renders the sign-in screen and **queries nothing**. With access it loads the actor filter options: all `users` (name, username, role, active), inactive included, ordered by role then name.

## 9. Owner page UI

- Menu: `OWNER_NAV_GROUPS` → "Team and administration" → `{ href: "/activity", label: "Activity log" }` (after Phones). Icon `History` (lucide) in `OwnerShell` `ICONS`.
- The layout follows `SalesList.tsx`:
  1. Header "Activity log", with the subtitle "Important actions in the system, newest first. Times are Philippine time."
  2. A Dates and filters panel. `DateRangeBar` (presets + Custom; default **Last 7 days**) [R], then Actor (All, each account "Name (username)" with "(inactive)" where it applies, Owner PIN, Approval PIN, Phones, Not signed in), Module (All + the six categories), Activity (All + that module's actions; disabled until a module is chosen), Result (All, Successful, Refused).
  3. A `ShowingLine` with Reset to default.
  4. The list.
  5. `Pager`.
- Kept settings: [R] follow the slice 22 convention. `lib/list-settings.ts` key `"activity"` keeps the range, filters and page size, never the page number. Reset clears them.
- The list on `md+` is a table with the brief's columns:

  | Date and time | Actor | Activity | Module | Target | Result |
  |---|---|---|---|---|---|

  - Date and time: `toLocaleString("en-PH", { timeZone: "Asia/Manila" })` with seconds.
  - Actor: the name, with a role pill or a "PIN"/"Phone" pill.
  - Result: a pill, `rz-pill-ok` Successful or `rz-pill-danger` Refused.
  - Each row expands to "Details": the allowlisted details. For L1 this includes "Time on the phone" (the stated time) next to "Received by the PC" (the row's time), so the sync time is never presented as the sale time.
- Below `md`: one card per event (activity text, actor · time, module and result pills, an expandable details panel), as on Sales.
- States:
  - loading: busy on the range bar, and the previous results kept while a new page loads;
  - error: `rz-notice rz-notice-danger` with the message;
  - 401: "Owner sign-in required.";
  - empty: "No activity matches these dates and filters.";
  - first-run note under the header: "The log starts on the day this feature was installed; earlier actions were not recorded."
- Read-only: no edit or delete control, and no export button.
- Colours: tokens only (`test:theme`).

## 10. Transaction and idempotency rules

| Event | Write mode | Idempotency |
|---|---|---|
| A1 | `$transaction([user.update(lastSignInAt), activity])`. If the log fails, the sign-in answers 500 and sets no cookie. | each sign-in is a new event |
| A2, A3, A4 | No business write exists, so one standalone insert, awaited **before** responding. If it fails, `console.error` and the response stays as it would have been (a log failure must not change an auth answer). [R] | each attempt or event is new; A2 bounded by the limiter |
| S1 | Interactive `$transaction`: `user.create` + log. P2002 still maps to 409 `TAKEN`. | — |
| S2–S5 | Inside the existing transaction (`users/[id]`, line 47). Compare the row read there with `data`, and write one row per change. | — |
| P1 | `$transaction([device.upsert, log])`; `reapproved` = the row existed before (read inside the transaction). | each approval is new |
| P2 | Interactive `$transaction`: `updateMany`; log only if `count === 1`. | a second revoke writes nothing |
| P3 | Inside the existing bind transaction, after `create`. Read the previous active assignment's barber in the same transaction, before the `updateMany`. A P2002/P2034 retry rolls the log back with it. | `respondToExisting` writes nothing |
| P4 | `$transaction([assignment createMany skipDuplicates, activity createMany skipDuplicates])` with `dedupeKey assignment.registered:<id>`. | dedupe key |
| L1 | Added to `recordSale`'s `$transaction` array. `SaleToRecord` gains a **required** `activity: { actor, details }`, so no caller can skip it (`test-sync-rejections` T12 passes one). | (1) duplicates never reach `recordSale`; (2) a racing duplicate's primary-key failure rolls the event back; (3) `dedupeKey sale.accepted:<id>` unique as a backstop |
| L2 | Collected in the sync loop. After the loop, **one** `createMany({ skipDuplicates: true })` with `dedupeKey sale.refused:<id>:<reason>`, wrapped in try/catch: a failure is `console.error`'d and the sync answer is unchanged. Items whose id isn't a UUID are not logged. | a Retry refused again for the **same** reason adds no row; a different reason adds one |
| L3 | `reviewSaleDate` gains an `actor` parameter (required). The conditional `updateMany` and the log run in one interactive transaction, and the log is written only when `count === 1`. | `unchanged`, `already_reviewed` and the losing racer write nothing |
| Y1, Y2 | Inside `withLockedRow`, one row per created entry. `withLockedRow` gains `actor` and `barberName` (read once before the call, from `row` or `barber.findUnique`). | `replay: true` creates nothing, so no event |
| C1, C2 | `$transaction([shiftReconciliation.create, log])` inside the existing retry loop. A revision collision rolls both back and retries. | each saved revision is one event |

- [F→R] Invariant clarification for CLAUDE.md: "The server never inserts a rejected sale (nor an orphan mismatch log)" stays true. L2 writes only an `activity_logs` row, never a sale, item, commission or mismatch row. A 401 (`DEVICE_NOT_APPROVED`, `OWNER_REQUIRED`) writes **no** activity row.
- [R] Sync performance: L1 adds one INSERT per new sale inside its existing transaction (at most 50 per request from phones). L2 is at most one batch INSERT per request. `phoneActor` adds one indexed read, only when something is logged. Duplicates add nothing. Measure (§13 L-P5) before and after on a 50-sale batch; acceptance is under 20% more total time.

## 11. Privacy rules (never in `activity_logs`)

These must never be stored:
- passwords, password hashes, PINs (owner or approval), the device secret or its hash, session or PIN cookie values, `OWNER_SESSION_SECRET`
- PayMongo keys and ids, webhook payloads
- QR images, or their sha256
- raw request bodies, whole sale payloads, custom-amount notes, petty-cash notes, reconciliation notes, payout notes
- IP addresses and `x-forwarded-for`, User-Agent strings
- usernames typed at a failed sign-in for an account that does not exist

Enforced three ways: (1) the catalog's detail allowlist, which makes everything else a compile error and also a runtime drop; (2) a test that feeds each forbidden key and checks it is dropped; (3) the API returns details only through the catalog's labels. Device keys are stored as the target, but never returned raw.

## 12. File-level implementation plan

Order: schema → service → instrumentation → API → page → tests → docs. Run `scripts/dev-reset.ps1` before `prisma generate` and `migrate`.

| File | Change |
|---|---|
| `web/prisma/schema.prisma` | add the two enums and `ActivityLog` (§7) |
| `web/prisma/migrations/<ts>_activity_logs/migration.sql` | new, from `migrate diff` (§7) |
| `web/src/lib/activity-catalog.ts` | new, pure: categories, actions, labels, detail allowlists, `describeActivity`, `targetLabel` |
| `web/src/lib/activity-log.ts` | new: `activityRow`, `logActivity`, `logActivityMany`, `phoneActor`, `ActivityActor` |
| `web/src/lib/owner-access.ts` | add `ownerActor`; `hasOwnerAccess` delegates to it |
| `web/src/lib/activity-list.ts` | new: `parseActivityQuery`, `listActivity(range, query)` (count + page), the serializer |
| `web/src/app/api/v1/auth/login/route.ts` | A1 (transaction with `lastSignInAt`), A2 |
| `web/src/app/api/v1/auth/logout/route.ts` | A4 (`requestSession` first) |
| `web/src/app/api/v1/owner/unlock/route.ts`, `owner/lock/route.ts` | A3; A4 with `how: "lock"` |
| `web/src/app/api/v1/users/route.ts`, `users/[id]/route.ts` | S1; S2–S5 |
| `web/src/app/api/v1/devices/approve/route.ts`, `revoke/route.ts`, `bind/route.ts` | P1, P2, P3 |
| `web/src/app/api/v1/transactions/sync/route.ts` | P4, L2, and passing `activity` to `recordSale` |
| `web/src/lib/record-sale.ts` | L1 in the transaction array; the `activity` field |
| `web/src/lib/time-review.ts`, `api/v1/reports/time-review/route.ts` | L3; the `actor` parameter |
| `web/src/app/api/v1/reports/payouts/route.ts` | Y1, Y2 in `withLockedRow` |
| `web/src/app/api/v1/reports/reconciliation/route.ts` | C1, C2 |
| `web/src/app/api/v1/activity/route.ts` | new, GET only |
| `web/src/app/activity/{layout,page,ActivityList}.tsx` | new (§8, §9) |
| `web/src/lib/approval-gate.ts`, `lib/owner-nav.ts`, `components/OwnerShell.tsx` | `/activity` in `OWNER_PAGES`, the menu and the icon |
| `web/scripts/lib/authz-matrix.ts`, `scripts/test-authz.ts` | matrix row; `/activity` in `OWNER_PAGE_PATHS` and the signed-out markers; `prisma.activityLog.count()` added to the "nothing written" counts (line 324); the `ownerActor`/`hasOwnerAccess` equivalence |
| `web/scripts/test-sync-rejections.ts` | T12 passes `activity`; asserts that a rolled-back sale leaves no activity row |
| `web/scripts/lib/test-activity.ts` | new: `deleteTestActivity({ userIds, targetIds, deviceKeys })` for suite cleanups (dev DB only; scripts already delete scratch rows the app never deletes) |
| suites that write through instrumented routes (at least `test-authz`, `test-auth`, `test-sync-rejections`, `test-attribution`, `test-payout-entries`, `test-reconciliation`, `test-time-review`, `test-device-approval`, `test-owner-unlock`, `test-gateway`) | call `deleteTestActivity` in their existing cleanup, so the dev log isn't filled with scratch events [R] |
| `web/scripts/test-activity-catalog.ts` (needs nothing), `test-activity-log.ts` (MySQL), `test-activity-live.ts` (dev server + MySQL) | new (§13) |
| `web/package.json` | `test:activity-catalog`, `test:activity-log`, `test:activity-live` |
| `CLAUDE.md` | Owner-only list: `/activity` and `GET /api/v1/activity`. A new invariant: activity log append-only, server-written, never read for figures, never in a 401, L2 the only write for a refused sale. Test commands. "Current plan". Known gaps: the uninstrumented list (§2) and §14. |
| `docs/slices/slice-29.md` | this file; add an "As built" section and actual test counts after the build |

Do not touch: `sw.js`, Dexie, the POS client, the sync payload schema (no client change is needed), any calculation, `ml-service/`.

## 13. Tests and acceptance criteria

**`test:activity-catalog` (pure, needs nothing)**
- C1 Every catalog action has a category, a label, a description for every detail combination, and an allowlist.
- C2 `activityRow` drops unknown keys and each forbidden key (`password`, `passwordHash`, `pin`, `secret`, `secretHash`, `cookie`, `token`, `note`, `image`, `ip`, `userAgent`, `body`).
- C3 It cuts strings to 100 characters and the JSON to 1 KB, and refuses a non-finite number.
- C4 An unknown action throws.
- C5 `targetLabel` never returns a full device key; it returns the label, or "Phone ·" + 4 characters.
- C6 `parseActivityQuery`: valid and invalid `actor`, `category`, `action`, `outcome`, `page` and `pageSize`; an action that doesn't match its category gets 400.
- C7 `describeActivity` covers every action, including L1's "time on the phone" wording.

**`test:activity-log` (MySQL; synthetic rows, deleted after)**
- D1 `logActivity` writes one row with the actor snapshot. `occurredAt` is between the server times taken before and after the call; a client time is never used.
- D2 Transaction coupling: a `$transaction` whose business write throws after `logActivity` leaves no activity row; and the reverse, a failed log fails the business write.
- D3 `recordSale` twice with the same id gives exactly one `sale.accepted` row (the second fails P2002 and rolls back). A `recordSale` with an unknown service (P2003) leaves no sale and no activity row.
- D4 `logActivityMany` with `skipDuplicates` and the same `dedupeKey` twice gives one row.
- D5 `reviewSaleDate`: `reviewed` gives one row; `unchanged`, `already_reviewed` and `future_date` give none.
- D6 `listActivity`: newest first with an id tie-break for the same millisecond; Manila day boundaries (23:59:59.999 vs 00:00 the next day); each filter alone and combined; `total` and `pageCount` correct; a page beyond the end is clamped.
- D7 A deactivated actor's rows still show the snapshot name.

**`test:activity-live` (dev server + MySQL; scratch owner, barber account, phone, barber; cleaned up)**
- **Authorization**
  - L-A1 Owner session: `GET /api/v1/activity` returns 200 with `events`.
  - L-A2 Barber session: 401, no events in the body.
  - L-A3 No credential: 401.
  - L-A4 An approved phone's headers only: 401.
  - L-A5 `POST`, `PUT`, `PATCH` and `DELETE /api/v1/activity` with a JSON body as the owner: 405, and the row count is unchanged.
  - L-A6 `/activity` page: the owner gets 200 with the "Activity log" heading; a barber session is redirected to `/pos`; signed out, the sign-in screen with no rows in the HTML.
- **Coverage** (for each: assert exactly one row with the right action, actor type and name, target and outcome; and for the refusals, no row):
  - L-E1 Owner sign-in → A1, actor is that owner.
  - L-E2 Barber sign-in on an approved phone → A1 with `where: "pos"`.
  - L-E3 Wrong password for an existing account → A2, actor UNKNOWN, target that account. An unknown username → no row.
  - L-E4 Sign out with a session → A4. Sign out without one → no row.
  - L-E5 Create a barber account → S1. Deactivate → S2. Reactivate → S3. Reset the password → S4. And the response body or the row never contains the password.
  - L-E6 Approve a phone with the owner PIN → P1, actor OWNER_PIN.
  - L-E7 Revoke → P2. Revoke again → no new row.
  - L-E8 First bind → P3 with `ownerPinUsed: false`. Moving to another barber with the PIN → P3 with `ownerPinUsed: true` and `previousBarberName`. Retrying the same assignment id → no new row.
  - L-E9 Sync 2 valid sales + 1 `PRICE_MISMATCH` + 1 `UNKNOWN_BARBER` gives 2 L1 rows and 2 L2 rows. Re-sending the same batch adds none. The L1 detail `statedTime` equals the sale's `transactionTime`, and `occurredAt` ≥ the server time before the request.
  - L-E10 A sync whose sale references an unknown assignment → P4 once.
  - L-E11 Payout → Y1. Correction → Y2 with `correctsId`. Replaying the same entry id → no new row.
  - L-E12 End-of-Day Cash saved twice → C1 then C2 (revision 2).
  - L-E13 Time review → L3. The same choice again → no new row.
- **Privacy**
  - L-P1 After the run, no activity row's JSON contains the scratch password, `OWNER_PIN`, the device secret or the session cookie value.
- **Matrix**
  - L-M1 A 401 on each owner, phone and phone-or-owner route writes no activity row (via the `test:authz` count list).
- **Performance**
  - L-P5 A 50-sale sync batch is timed before and after instrumentation (recorded, not a hard gate): under 20% more, or a note explaining why.

**Existing suites that must stay green:** `test:authz`, `test:approval-gate`, `test:nav`, `test:theme`, `test:sync-rejections`, `test:attribution`, `test:payout-entries`, `test:reconciliation`, `test:time-review`, `test:auth`, `test:device-approval`, `test:owner-unlock`, `test:payload-compat`, `test:sync-queue`, `test:sales-list`; plus `npm run lint` and `npx tsc --noEmit`.

**Browser checks (manual, recorded in "As built")**
1. Desktop: the page opens on Last 7 days, newest first.
2. Each filter narrows the list; Reset restores the defaults.
3. Pages of 10/25/50/100.
4. Empty state with a future-only filter combination.
5. Error state (stop the DB container; reload) shows the notice.
6. 390 px width: cards, no horizontal scroll, controls at least 44 px.
7. Times read in Manila on a browser set to UTC.
8. A sale synced late shows "Time on the phone" earlier than the row time.

**Acceptance:** all new suites and the existing suites green; lint and tsc clean; browser checks 1–8 pass; no route other than `GET /api/v1/activity` reads the table; no figure reads it; §2's uninstrumented list is copied into CLAUDE.md Known gaps.

Report only results that were actually run. A suite that cannot run (for example `test:auth`'s 3-per-15-minutes limit, or `TEST_ADMIN_DATABASE_URL` for attribution T17) is reported as skipped, with the reason.

## 14. Risks

- **Coupling risk (biggest):** a failing activity insert now fails the business write it is coupled to (sign-in, sale insert, payout, count). That is the requested guarantee, but a schema mistake would block sales sync. Mitigations: the migration is applied and D2/D3 are green **before** any route is changed; L2 and the auth-only events are not coupled.
- Sync regressions: `recordSale` is shared with T12. A missing `activity` argument is a compile error by design. The per-sale independence must hold, so a rolled-back L1 can only reject that one sale (it is in the same transaction as its own sale only).
- Payouts lock: the extra INSERT happens while `FOR UPDATE` is held, which is slightly longer lock time. This is negligible at shop volume.
- `ownerActor` refactor: owner access is now derived from it, a change to the security path. Covered by `test:authz` (327 checks) plus the equivalence check.
- Test pollution: every existing suite that drives instrumented routes will leave scratch activity rows on the dev DB unless its cleanup calls `deleteTestActivity`.
- Migration: additive only. The risk is running it against the wrong database (mitigated in §7). The shop PC gets it through `start-ruzzco.cmd`'s `migrate deploy` at handover, not now.
- Flooding: the bounds are A2 by the limiter; L2 by phone approval (an approved phone can send at most 500 items per request, and could equally flood valid sales); A4 by valid sessions only. An approved, modified client can still create many L2 rows with fresh UUIDs (Known gap).
- Clock: `occurred_at` is the PC's clock. A wrong PC clock mislabels every event (as it does `syncedAt` today).
- Wording risk in the paper: "who" means an account, a PIN or a phone, not always a person (§5). The PIN-cookie period before an owner account existed is anonymous.

## 15. Manuscript impact (do not edit the manuscript in this slice)

After the build is verified and committed:
- Scope and Limitations: remove the general "no activity log" exclusion. State the v1 coverage (§4) and the uninstrumented list (§2); state that PIN and phone actors are not persons; state that the log starts at installation.
- Owner functions (Table 1 and the owner feature descriptions): add Activity log (filters by date, actor, module, activity, result; read-only).
- Table 2 (data dictionary): add `activity_logs`. The ERD gets one new entity with no foreign keys (the actor and target are snapshots and ids). The table count goes up by 1 (17 → 18 by the Stage 2-B count; recount from the migrations).
- Figures 2 and 4: an "Activity log" store written by the auth, staff, phone, sync, payout, cash and time-review processes, and read by the owner. Update only if the drawn architecture shows data stores at that level.
- Table 6 / Table 7: provenance V-2 (verbal/recalled, clarified by Brent 2026-11-17); the implementation is this slice's commit.
- Testing (Table 8): `test:activity-catalog`, `test:activity-log`, `test:activity-live` with their actual counts; the browser checks.
- Revision tracking: the internal register and the official matrix entry for V-2 move from "Not implemented" to implemented only after the commit, with the evidence above.
- Do not describe the feature as implemented, verified or comprehensive before then.

## 16. Open questions and assumptions

- **Q1 Slice number.** Answered (Brent, 2026-11-17): 29. Slice 28 is the Forecast page presentation; the Sales cleanup is unnumbered deferred work.
- **Q2 Who may read (pre-mortem O5).** Assumed: the owner only (every OWNER account), as written in the brief. Barbers get nothing. If a barber should later see their own events, that is a separate slice.
- **Q3 Failed sign-ins.** Assumed in (A2, wrong password for an existing account only, bounded by the limiter). Brent may drop it.
- **Q4 Retention and backup (pre-mortem D5).** Assumed: keep forever, and include the table in whatever backup the shop uses. There is no purge in v1.
- **Q5 Accepted sales in the log.** The brief asks for them. They duplicate the existence (not the money) of every sale already on Sales, and they are the bulk of the rows. Alternative: log only refusals and keep accepted sales on Sales. Assumed: in, with no money details.
- **Q6 Default range and kept settings.** Assumed: Last 7 days, with settings kept per browser as on Sales.
- **Q7 Panel member identity.** A session log (2026-11-16) records Brent naming the panel member. The brief says not to assume it. This spec names nobody; the manuscript wording is Brent's.
- Assumption: the dev database is the Docker `ruzzco-mysql` on 127.0.0.1:3307 (container healthy at audit time). The implementer re-verifies it from Prisma's datasource line before migrating.
- Assumption: no CLAUDE.md "Business rules before code" OK is needed, because no attribution, commission, payout or reconciliation rule changes; the writes are added beside them. If Brent wants the rule stated anyway, use §10 as the statement.

<!-- END OF SPEC -->
