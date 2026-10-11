# Slice 3 — Maya, owner PIN and the daily payout ledger

Repo: `ruzzco-system`, branch `main`. Shipped 2026-09-24 (`a304825`, `69a6780`), with the rate snapshot added 2026-09-25 (`54593ac`).
**Documentation of shipped work, not a build instruction.** Written on 2026-10-11 from the commit history, `prisma/schema.prisma` and the current code. It records what was built and what has changed since. Nothing was re-run for it beyond reading the code.
What it delivers: the owner can see what each barber earned in a day, record what was paid out, and see what is still owed, behind a PIN; digital sales through Maya are recorded and kept out of the drawer.

## 1. Scope boundary

- Built: payment method `MAYA`, the owner PIN gate (`ruzzco_owner_access` cookie), `/ledger`, `GET/POST /api/v1/reports/payouts`, reconciliation totals that split cash, GCash and Maya.
- The 50/50 commission itself was already computed in slice 1. This slice shows it per barber and per day.
- Not in this slice: tips, discounts and custom amounts (slice 4); PIN attempt limits (added later, `e10d3e6`); any rule about who owes whom for digital payments; a pending request to remove the ledger (open, CLAUDE.md Client rules).

## 2. Decisions

1. **Maya sits beside Cash and GCash** as a recording method with an optional reference. Digital totals are kept apart from the drawer; the reconciliation reports cash, GCash and Maya separately (`../ruzzco-barbers/20_Decisions/2026-09-24-ruzzco-pos-slices-3-4-implementation.md`).
2. **The ledger shows, per barber and business day:** total earned, recorded cash and GCash paid, remaining to pay. "Save payout" records the handoff; it never resets or erases the day's earnings.
3. **Later sales raise what is owed.** If a sale for an already-paid day syncs later, the ledger shows it as additional owed instead of changing the paid amount.
4. **Owner PIN, no accounts.** `POST /api/v1/owner/unlock` compares the PIN from `OWNER_PIN` and sets an HttpOnly cookie; the ledger, the payout writes and the reconciliation writes require it. Barber phones never need it (`src/lib/owner-access.ts`).
5. **Commission rate is stored on the sale** (`54593ac`, migration `20260925050000_transaction_commission_rate`), so a later change of rate never rewrites history. A barber without a rate is an error; a rate is never defaulted.

## 3. What shipped

- **Data:** `DailyPayoutLedger` (one row per barber and business date: commission total, tip total, total owed, cash and GCash paid, `paidAt`), payment method `MAYA`; later `Transaction.commissionRate`.
- **API:** `POST /api/v1/owner/unlock`; `GET` and `POST /api/v1/reports/payouts`; the reconciliation route returns Maya and per-method totals.
- **UI:** `/ledger` (owner-only), Maya checkout and badges on `/pos` and `/shift-log`, a ledger link on the home page.

## 4. Changed since

- Business dates are Manila dates and reconciliation is append-only by revision (`409a5b5`); the payouts route shares that day window.
- Payouts and totals count only PAID sales and exclude flagged timestamps until reviewed (slice 5 payment status, L5).
- The commission base can be switched between list price and amount paid on the ledger (slice 4 money fields).
- Wrong PINs are rate limited in memory: 5 per client or 30 shop-wide in 15 minutes, then a 15-minute lock (`src/lib/pin-attempts.ts`).
- Known gaps recorded in CLAUDE.md: the "Save payout" UX is unclear, and `GET` payouts writes ledger rows.

## 5. Tests that cover this slice today

`npm run test:commission` (commission snapshots and the payout ledger), `test:reconciliation`, `test:owner-unlock` (max 5 runs per 15 minutes), `test:pin-attempts`. Plus lint and `tsc`.

## 6. How to verify

1. Open `/ledger` without unlocking: refused. Unlock with the PIN: the page shows each barber's earned, paid and remaining amounts for today.
2. Record a Maya sale; it shows a Maya badge in `/shift-log` and in the Maya total on `/reconciliation`, not in expected drawer cash.
3. Save a cash payout for one barber: remaining drops and earned stays the same. Sync one more sale for that barber: the ledger shows additional owed.

## 7. Sources

- `../ruzzco-barbers/20_Decisions/2026-09-24-ruzzco-pos-slices-3-4-implementation.md` (its later update lists rules that changed after the shop confirmed them).
- Commits `a304825`, `69a6780`, `54593ac`.

<!-- END OF SPEC -->
