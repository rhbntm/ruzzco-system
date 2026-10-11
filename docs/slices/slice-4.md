# Slice 4 — Sale money fields, petty cash, and the attribution lock (4.5)

Repo: `ruzzco-system`, branch `main`. Shipped 2026-09-24 (`cece9e2`, `3738056`, `6230bef`, `1b4cf1e`); step 4.5 on 2026-09-25 (`9a686d1`, `63e5e77`, `cbd3cda`, `54593ac`, `409a5b5`).
**Documentation of shipped work, not a build instruction.** Written on 2026-10-11 from the commit history, `prisma/schema.prisma` and the current code. It records what was built and what has changed since. Nothing was re-run for it beyond reading the code.
What it delivers: a sale records what the customer paid, any discount and tip, and the list price used for commission; petty cash is part of the drawer count; and a sale stays with the barber who made it even if the phone is rebound before it syncs.

## 1. Scope boundary

- The number "slice 4" was first planned as a dynamic catalog and staff sync (the original six-slice plan of 2026-09-19). That was **not built**; the number was used for this demo scope. `GET /api/v1/catalog` from slice 1 is still the only catalog route, and managing services or barbers from the app is open.
- Built: money fields, tips, discounts, custom amounts, petty cash, the demo seed, and the attribution lock.
- Not in this slice: loyalty-card discounts (not built), the gateway (slice 5), pricing extraction into `lib/pricing` (later refactor, `8ac738a`).

## 2. Decisions

1. **A sale carries its money breakdown:** `listPrice`, discount type (NONE, PERCENT, FIXED) and amount, `amountPaid`, `tipAmount`, `customAmount` and note, and a commission base. `totalAmount` is the amount paid excluding tip. New fields are optional or defaulted so old queued payloads still validate.
2. **The shop absorbs discounts:** commission base defaults to `LIST_PRICE`; the ledger can recompute with `AMOUNT_PAID`. Tips go 100% to the barber, ride on the sale's payment method, and are outside revenue and the commission base.
3. **A custom amount is its own list price** (`6230bef`): with a custom ₱300 cut, commission is on ₱300, discount forced to NONE. The sync route does the same, which also corrects payloads already queued.
4. **Expected drawer cash = cash sales + cash tips − cash payouts − petty cash.** A petty-cash entry needs an amount and a note.
5. **Attribution is fixed at sale time (4.5).** The phone generates an `assignmentId` when it binds; every sale stores it and the `deviceKey`; the server credits the assignment's barber, not the device's current binding. Rejected options: a server-issued id (impossible offline), matching by timestamp (clock drift), forcing a sync before a rebind (strands shared phones). See `../ruzzco-barbers/20_Decisions/2026-09-24-offline-transaction-attribution-via-client-assignment-id.md`; the rules are in CLAUDE.md Invariants.
6. **Rejected sales stay on the phone** (`cbd3cda`): sync answers per sale; a bad sale never blocks the batch and is never rewritten.
7. **No double submit:** a checkout lock stops a second tap creating a second sale (`63e5e77`).
8. **Custom commission-base policy:** `../ruzzco-barbers/20_Decisions/2026-09-24-custom-amount-commission-base-policy.md`.

## 3. What shipped

- **Data:** discount, tip, paid-amount, custom-amount and commission-base columns; `ShiftReconciliation.pettyCashAmount` and note; additive migrations `0_init` (baseline), `20260924115447_transaction_assignment_id`, `20260925050000_transaction_commission_rate`, `20260925120000_reconciliation_revisions`.
- **API and libraries:** the sync route (per-sale results, assignment-based attribution, registers an unknown assignment only as revoked), `POST /api/v1/devices/bind` (idempotent by assignment id, revoke-and-create in one transaction), `src/lib/sync.ts` (binds before syncing that assignment's sales), `src/lib/commission.ts`, `src/lib/business-date.ts`, `src/lib/reconciliation.ts`, `src/lib/submit-lock.ts`.
- **UI:** quick tip buttons, custom tip and custom amount on `/pos`; a "needs attention" list for rejected sales on `/pos` and `/shift-log`; petty cash on `/reconciliation`.
- **Seed:** `npm run seed:demo` adds placeholder sales for today, removable with `--clean`. It is demo data only.

## 4. Changed since

- The Senior/PWD discount button and its demo row were part of this slice; the shop gives no PWD, senior or student discounts, so the button was removed (`61b6973`, 2026-10-02). The `demo-senior-pwd` demo row still conflicts with the rule (CLAUDE.md Client rules). Loyalty discounts are not built.
- The haircut fallback price changed from ₱150 to ₱200 once the shop's price was confirmed (2026-09-25) (`3b75ad8`).
- Rejected sales and their reasons were extended, then a timestamp check was added (L5), and a QRPH refusal (L4); both are in CLAUDE.md Invariants.
- Commission is still computed from the `listPrice` the phone sends and is not checked on the server (open item H2).

## 5. Tests that cover this slice today

`npm run test:attribution`, `test:sync-rejections`, `test:commission`, `test:reconciliation`, `test:pricing`, `test:submit-lock`, `test:payload-compat`, `test:sync-queue`. Plus lint and `tsc`.

## 6. How to verify

1. Record a cash haircut with a tip and a custom amount: `/shift-log` shows the amount paid and tip separately; commission is half of the list price.
2. Bind the phone to barber A, record a sale offline, rebind to barber B, reconnect: the sale still belongs to A.
3. On `/reconciliation`, add petty cash with a note: expected drawer cash drops by that amount.
4. Send a sale with an unknown service: it appears under "needs attention"; the other sales in the batch sync.

## 7. Sources

- Decision records in `../ruzzco-barbers/20_Decisions/`: 2026-09-24 slices 3-4 implementation, 2026-09-24 offline attribution via client assignment id, 2026-09-24 custom amount commission base.
- Commits listed above; migrations under `web/prisma/migrations/`.

<!-- END OF SPEC -->
