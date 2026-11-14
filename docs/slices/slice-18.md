# Slice 18 — Payout entries on the ledger

Repo: `ruzzco-system`. Status: **PRELIMINARY, register item PR-6** (written 2026-11-14), branch `revision/preliminary`. The rule and edge cases in §2 are OK'd by Brent (2026-11-14). Decisions 2 to 7 in §3 are OK'd by Brent (2026-11-14).
Goal: every payout the owner records on `/ledger` is kept as its own entry, so paying a barber in parts leaves a record of each part and the owner never has to type a running total.

## 1. Scope boundary (read first)

- In: a `payout_entries` table and one additive migration (with a backfill), `GET`/`POST /api/v1/reports/payouts`, `lib/payout-entries.ts`, the barber cards on `/ledger`, the drawer formula's payout term (`lib/reconciliation.ts`), the payout figures and wording on `/insights`, and the tests.
- Unchanged: what a sale records, sync, attribution, commission snapshots, tips (100% to the barber, outside revenue), the ledger summary route and its figures, End-of-Day Cash apart from the payout term, the owner cookie. `DailyPayoutLedger` keeps `cashPaid` and `gcashPaid`; they become the sums of the day's entries, so every reader of those columns keeps working.
- Out: advances (paying more than is owed), editing or deleting an entry, who else may record a payout, a payout history across dates (slice 21). These are open questions for Mart or later slices.

## 2. Rule (OK'd by Brent, 2026-11-14)

Every payout the owner records is saved as its own entry: barber, business date, amount, cash or GCash, and the time. Entries are never edited or deleted. The amount box starts empty after each save. Remaining to pay is what the barber earned that day minus the sum of the entries, and the entries are listed under the barber.

| # | Edge case | Behaviour |
|---|---|---|
| 1 | ₱500 at midday, ₱500 at night | Two entries; the box is empty both times; Remaining goes 500, then 0 |
| 2 | Save tapped twice | One entry: the page generates the entry id (the idempotency key) and guards the button with `lib/submit-lock.ts` |
| 3 | An amount above what is still owed | Refused (409), showing the amount remaining |
| 4 | A wrong amount was saved | A correcting entry with a reason is added; both stay visible; a cash correction returns to expected drawer cash |
| 5 | A late sale syncs after the barber was paid in full | Remaining becomes positive again and shows as "additional owed"; earlier entries are unchanged |
| 6 | A payout recorded after the cash count was saved | That day's count is marked out of date (`EXPECTED_CASH_CHANGED`, as today) |
| 7 | Amounts already saved the old way | Each non-zero `cashPaid` or `gcashPaid` becomes one opening entry, so totals do not change |

Drawer (OK'd with the rule): every cash entry is subtracted from expected drawer cash as soon as it is saved. The "Paid confirmation" tick box goes away; a day is fully paid when Remaining is 0.

## 3. Decisions

1. **The amount owed is the canonical one.** Overpayment is checked against the list-price total (commission at list price + tips), whatever commission base the page is viewing. Same as the stored `totalOwed`.
2. **A correction undoes part or all of one entry.** It names the entry it corrects, has that entry's method, needs a reason, and cannot take back more than is left of that entry after earlier corrections. It is stored with a negative amount, so a sum of entries is the amount paid. A correction is never itself corrected. (Brent, 2026-11-14)
3. **Additional owed** = the day has entries, Remaining is above 0, and the day was fully paid when its last entry was saved. Each entry stores the amount owed at the moment it was saved (`owedAtEntry`) for this. An ordinary part payment (₱500 of ₱1,000) is therefore just Remaining, not "additional owed". `lib/payout-entries.ts` holds the rule; the ledger and Insights both use it. (Brent, 2026-11-14)
4. **The old request body still works** (`cashPaid`, `gcashPaid`, `paid`): the amounts are read as the new totals, and each increase is saved as an entry with a server-made id; a decrease is refused (409, use a correction); the same totals again change nothing. `paid` is ignored. Only older test suites send it; the page no longer does. (Brent, 2026-11-14)
5. **Opening entries** (the backfill) have kind `OPENING`, the row's `paid_at` (or its last update) as their time, and can be corrected like a payout. For a row that was ticked paid, `owedAtEntry` is the smaller of its stored total owed and its paid amount, so a ticked row that showed "additional owed" still does. (Brent, 2026-11-14)
6. **Future dates are refused** (422) by `GET` and `POST`, so opening a future day no longer writes ledger rows. (Brent, 2026-11-14)
7. **Entry belongs to its day's ledger row** (`ledger_id`, deleted with it). The app never deletes ledger rows; the test suites do, and this keeps their clean-up working. (Brent, 2026-11-14)

## 4. Build

### 4.1 Schema (one additive migration)

`payout_entries`: `id` (CHAR(36), from the client), `ledger_id` (to `daily_payout_ledgers`, cascade), `barber_id` (to `barbers`), `business_date` (DATE), `method` (`CASH` | `GCASH`), `kind` (`PAYOUT` | `CORRECTION` | `OPENING`), `amount` (DECIMAL(10,2), negative for a correction), `corrects_id` (nullable, no foreign key; checked by the server), `note` (nullable, up to 200), `owed_at_entry` (DECIMAL(10,2)), `recorded_at`. Indexes on (`ledger_id`, `recorded_at`), (`business_date`), (`corrects_id`).

The same migration:
- inserts one `OPENING` entry for each non-zero `cash_paid` and each non-zero `gcash_paid`;
- sets `paid_at` on rows that got an opening entry and had none.

Consequence, to state in the paper: an old row with an amount but no paid tick now counts against that day's drawer; a saved count for such a day shows as out of date.

### 4.2 Server

- `lib/payout-entries.ts` (pure): `remainingToPay`, `isAdditionalOwed`, `correctableLeft`, and the entry serializer.
- `GET /api/v1/reports/payouts?date=`: as today, plus per row `paidTotal`, `remaining`, `additionalOwed` (new rule) and `entries` (oldest first, each with what is left to correct). Future date → 422.
- `POST /api/v1/reports/payouts` with `{ id, date, barberId, method, amount, kind?, correctsId?, note?, commissionBase? }`. In one database transaction, holding the day's ledger row lock: an id already saved with the same content answers 200 with `replay: true`, with different content 409 `ID_CONFLICT`; a payout above what is owed 409 `OVERPAYMENT` with `remaining`; a correction checked per Decision 2 (`CORRECTION_INVALID` 400, `CORRECTION_TOO_LARGE` 409 with `left`); then insert the entry and set the row's `cashPaid`, `gcashPaid` to the sums and `paidAt` once. Future date → 422.
- `lib/reconciliation.ts`: cash payouts = the sum of every day row's `cashPaid` (no `paidAt` filter).

### 4.3 Page (`/ledger`)

Each barber card: "Total earned on <date>" (or "today"), paid so far, Remaining; an empty amount box, a Cash / GCash choice and **Record payout**; the entries under it with their time and method; a **Correct** action on each payout that opens a small form (amount up to what is left of that entry, reason required). No tick box, no editable totals. A refusal shows the server's message with the amount remaining.

### 4.4 Insights

The barber earnings card and the story use the same additional-owed rule; "Cash payouts marked paid" becomes "Cash payouts".

## 5. Tests

- New `npm run test:payout-entries` (needs the dev server): cases 1 to 6, replay and id conflict, correction limits and reason, future date, the old body (Decision 4), and case 7 as a check across the whole database: every ledger row's `cashPaid` and `gcashPaid` equal the sums of its entries.
- `test:commission`, `test:reconciliation`: moved to the entry flow; S6 becomes "every cash entry leaves the drawer, GCash never does".
- `test:insights-story`: the additional-owed sentence.
- `test:ledger-summary`, `test:time-review`: unchanged and green.

## 6. Manual test

1. `/ledger`, today, a barber with ₱1,000 earned: record ₱500 cash. The box is empty, the entry shows with its time, Remaining ₱500.00. Record ₱500 cash again: two entries, Remaining ₱0.00.
2. Type ₱1 more: refused, "₱0.00 is still owed".
3. Correct the second entry by ₱200 with a reason: three lines, Remaining ₱200.00. End-of-Day Cash's cash payouts went from ₱1,000.00 to ₱800.00.
4. Save End-of-Day Cash, then record ₱100 GCash: the count is not out of date. Record ₱100 cash: the count is out of date.
5. At 360 × 740 the card fits with no sideways scroll; the label says "Total earned today" for today and the date for another day.

<!-- END OF SPEC -->
