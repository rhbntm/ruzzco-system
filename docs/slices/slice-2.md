# Slice 2 — Device binding, GCash, shift log and end-of-day cash reconciliation

Repo: `ruzzco-system`, branch `main`. Shipped 2026-09-22 (`2c759af`), hardened the same day (`12dbf0e`).
**Documentation of shipped work, not a build instruction.** Written on 2026-10-11 from the commit history, `prisma/schema.prisma` and the current code. It records what was built and what has changed since. Nothing was re-run for it beyond reading the code.
What it delivers: a sale is tied to the phone that recorded it, GCash sales can be recorded, and the owner can count the drawer at the end of the day and see the difference from what the system expected.

## 1. Scope boundary

- Built: first-boot device binding, `cashierId` stamping, GCash as a payment method, `/shift-log`, `/reconciliation` and its report route, a durable log of attribution overrides, a responsive layout.
- Not in this slice: Maya, tips, discounts, petty cash (slices 3 and 4); owner PIN and payouts (slice 3); attribution by assignment id (slice 4, step 4.5); any payment gateway (slice 5).
- GCash here is recording only: a method and an optional reference. Money goes to the barber's personal account (CLAUDE.md Business facts).

## 2. Decisions

1. **Bind a phone to one barber.** The first time `/pos` opens, a full-screen gate asks for a barber; the choice is shown in a header badge and can be changed from a settings dialog. The phone holds a `deviceKey` (UUID in localStorage and Dexie, not a secret). The server resolves the barber from the binding and sets `cashierId`; a claimed `barberId` that differs is overridden (`../ruzzco-barbers/20_Decisions/2026-09-20-device-binding-and-cashier-attribution.md`). *Reason:* the Slice 1 dropdown let anyone log a sale under another barber's name.
2. **Log every override durably.** Overrides are written to `SyncMismatchLog` inside the request (`12dbf0e`), not to the console, so tamper evidence survives a restart. A small insert per mismatch was judged cheaper than losing the trail.
3. **Count the drawer at close.** The owner enters counted cash; the system stores expected cash, counted cash and the variance (`../ruzzco-barbers/20_Decisions/2026-09-20-eod-reconciliation-schema-as-ml-gate.md`). The original reason was to give the forecast clean days only; that idea no longer applies (§4).
4. **Server checks on the reconciliation route** (`12dbf0e`): a sanity cap on counted cash and no future business date (Manila time), because the UI's `max` date is trivially bypassed.
5. **`deviceKey` is an operational identifier, not a credential.** An offline phone cannot hold a server session; the server's reconciliation is the authority.

## 3. What shipped

- **Data:** `DeviceAssignment` (`deviceKey`, `barberId`, `assignedAt`, `revokedAt`), `ShiftReconciliation`, `SyncMismatchLog`; payment method `GCASH`; Dexie version 2 with a `deviceBindings` table.
- **API:** `POST /api/v1/devices/bind`, `GET /api/v1/devices/binding`, `GET/POST /api/v1/reports/reconciliation`, and a shift-summary route (deleted later, `61b6973`); the sync route stamps `cashierId`.
- **UI:** the bind gate and badge on `/pos`; GCash checkout with a reference modal; `/shift-log` (live Dexie feed, daily cards, payment badges, manual and automatic sync); `/reconciliation`; a responsive grid; peso symbols throughout.

## 4. Changed since

- The model is named `ShiftReconciliation`, not `DailyReconciliation`, and it has **no `reconciled` flag**. The planned rule "the forecast trains only on reconciled days" was dropped: the forecast now trains on the paper logbook only and never reads transactions (CLAUDE.md, slice 7).
- Attribution moved from the device's current binding to the sale's own `assignmentId` (slice 4, step 4.5).
- Reconciliation is append-only by revision, uses Manila business dates, and shows the expected-drawer-cash formula of CLAUDE.md (`409a5b5`, then slice 3 and 4 additions). Flagged sale timestamps are held out of daily figures until reviewed (L5, `1ab3889`).
- The shift log is provisional: it includes unsynced sales and sales the server is holding for a date review.

## 5. Tests that cover this slice today

`npm run test:attribution` (bind and attribution cases, including a fresh-database migration check), `test:reconciliation`, `test:sync-rejections`, `test:sync-clock`, `test:time-review`. Plus lint and `tsc`.

## 6. How to verify

1. On a new phone or after clearing site data, open `/pos`: the gate asks for a barber; choose one: the badge shows the name.
2. Record a GCash sale offline, reconnect: `/shift-log` shows it synced, with a GCash badge.
3. Open `/reconciliation`, enter counted cash for today: expected, counted and the variance show; a future date is refused.

## 7. Sources

- Decision records in `../ruzzco-barbers/20_Decisions/`: 2026-09-20 device binding and cashier attribution; 2026-09-20 end-of-day reconciliation; 2026-09-21 payment gateway (cashless is a must-have; GCash in this slice).
- Commits `2c759af`, `12dbf0e`.

<!-- END OF SPEC -->
