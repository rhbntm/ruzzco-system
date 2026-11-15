# Slice 20 — Date ranges, backend half

Repo: `ruzzco-system`. Status: **PRELIMINARY, register item PR-5** (written 2026-11-15, revised 2026-11-15 after Brent's conditional approval), branch `revision/preliminary`. Approved by Brent (2026-11-15): the Manila business-date rule in §2 and Decisions 2, 4, 5 and 6. Revised at his request: Decision 1, edge case 4, the maximum range, Decision 3, the tests, and the date queries (Decision 7). The revised spec and the assumptions in §7 are approved for implementation (Brent, 2026-11-15).
First candidate for deferral if the manuscript revisions, security corrections or slice 21 (redesign and integration) are at risk.
Goal: the owner's reports can be asked for any span of business days, with the same figures a single day shows, so slice 21 only has to add the range picker on screen.

## 1. Scope boundary (read first)

- In: a pure range helper `src/lib/date-range.ts`; `from`/`to` on `GET /api/v1/reports/ledger-summary`; one range loader for `from`/`to` requests (`src/lib/range-figures.ts`); a new read-only owner route `GET /api/v1/reports/payout-history` with its authorization-matrix row; the Insights day loader moved unchanged from `src/app/insights/page.tsx` to `src/lib/day-figures.ts` (the owner dashboard of slice 21 reads it); tests (§5); CLAUDE.md.
- Unchanged: the legacy `date`/`period` request and its answer, field for field (including the future days a current week or month contains); how a sale counts on a day (`countsOnDay`, `countsInRange`, time review); daily accounting (End-of-Day Cash, `computeExpected`, `totalsForDate`); commission rules and snapshots; the commission base toggle; payout-entry semantics (slice 18); the payout cards on `/ledger` (one day, by rule); the payouts GET (it still refreshes that day's stored rows when the page opens it, pre-mortem C4); Insights' 7/14/30-day trends; every page's look. No schema change, no migration, no new page, no new business rule or financial feature, no unrelated refactoring.
- Out (slice 21): the range picker (`DateRangeBar`) on the Barber Ledger summary, Insights and a payout history screen; Insights trends over any range. Out entirely: ranges on End-of-Day Cash or the payout cards, an activity log, exports.

## 2. Rule (approved by Brent, 2026-11-15)

A range is a `from` and a `to` date, both Manila business dates, **both included**. A sale counts in a range exactly when it counts on one of the range's days by today's day rule: an unflagged sale by its Manila timestamp, a flagged sale only after the owner's date review, on its confirmed date. So a range's figures are always the sum of its days' figures, and the same sale is never in two days or in two pages' ranges differently. `to` may not be after today (Manila). A range holds at most 366 calendar dates, counting both `from` and `to`. Payouts stay per day: a range only adds up days, it never moves a payout or a sale to another day.

| # | Edge case | Behaviour |
|---|---|---|
| 1 | A sale at 23:59:59.999 Manila on the range's last day, another at 00:00:00.000 the next day; likewise 23:59:59.999 the day before `from` and 00:00:00.000 on `from` | The sales on `from` 00:00:00.000 and on `to` 23:59:59.999 are in; the other two are out, on the summary and the payout history alike |
| 2 | A flagged sale stamped inside the range, waiting for date review | Counted on no day, so in no total; reported as held for review. After review it counts on its confirmed date, inside the range or not |
| 3 | A one-day range (`from` = `to`) | Exactly the figures the legacy `date=…&period=day` answer gives for that date |
| 4 | A **completed past week** asked as `from`/`to` (Monday to Sunday, the Sunday before today) | Exactly the figures of the legacy `period=week` for a day in that week. The current week is not comparable: its `from`/`to` (and the "This week" preset) ends at today, while the legacy week still runs to Sunday |
| 5 | A barber paid ₱100 too much on Monday and owed ₱100 on Tuesday | Remaining to pay for the range is ₱100 (Decision 3): each day's remaining is clamped at zero before the days are added, so an overpaid day cannot hide another day's balance |
| 6 | A payout entered on Wednesday for Monday's earnings | Listed under Monday: an entry belongs to the business date it pays for, whenever it was recorded |
| 7 | `from` after `to`; 367 dates or more; `to` after today | 400, 400, 422 ("That date has not happened yet", as the payouts GET answers) |
| 8 | An inactive barber with sales in the range | Included, as on the ledger: being inactive limits the roster, never past earnings |

## 3. Decisions

1. **(Revised.) The legacy request is preserved; `from`/`to` never reaches the future.** `date`/`period` keeps its current code path and answer, untouched (its week and month may include future days, as today). `from`/`to` with `to` after today answers 422; presets end at today ("This week" = Monday to today, "This month" = the 1st to today). Equivalence with `period=week` is claimed and tested for completed past weeks only (edge case 4).
2. **(Approved.) One loader for `from`/`to`, proven equal to the existing daily calculations.** `rangeFigures(first, last, commissionBase)` reads each table once over the range and buckets rows by business date, instead of three queries per day (pre-mortem F10). Equivalence is demonstrated against the code the shop already relies on, not only by new isolated checks: day by day against `computeExpected` and `totalsForDate`, and whole answers against the legacy `date`/`period` answer (§5). End-of-Day Cash, the payout cards, Insights and the legacy summary keep calling the day functions.
3. **(Revised.) Payout history: owed from sales, aggregation spelled out.** For each barber *b* and business date *d* in the range:
   - `owed(b,d)` = canonical commission (sum of the stored list-price snapshots, `barberCommissionAmount`) + tips, of *b*'s PAID sales counting on *d*. Computed from sales, never from stored `daily_payout_ledgers` rows (they refresh only when a day is opened on `/ledger`). List-price owed only, the amount every payout was checked against; no commission base toggle on the history.
   - `paid(b,d)` = the signed sum of *b*'s payout entries for *d* as stored: payouts and openings positive, corrections negative (slice 18). Entries are never netted, merged or re-signed; each is listed as `serializeEntry` gives it.
   - `remaining(b,d)` = `remainingToPay(owed, paid)` from `lib/payout-entries.ts`: `owed − paid`, never below zero.
   - `additionalOwed(b,d)` = `isAdditionalOwed(owed(b,d), paid(b,d), lastEntry(entries(b,d)).owedAtEntry)` from `lib/payout-entries.ts`, exactly slice 18's rule, per barber-day. It is a flag only: the amount it points at is already inside `remaining(b,d)`, so nothing is added for it. There is no range-level additional-owed amount; the answer gives the number of flagged barber-days.
   - Range totals: `owed` = Σ owed(b,d); `paid` = Σ paid(b,d) (signed); `remaining` = **Σ remaining(b,d)**, the sum of the clamped daily balances, **not** `owed − paid` (edge case 5). The two differ only when a day is overpaid; `owed − paid` is never reported as remaining.
4. **(Approved.) Only barber-days with something in them.** A barber is listed on a day when the barber has a paid sale counting that day or a payout entry for it. Days newest first; barbers by name within a day.
5. **(Approved.) Presets live in the helper, the picker in slice 21.** `presetRange(name, today)` for Today, Yesterday, This week (Monday to today), This month (the 1st to today) and Last 7 days (today and the 6 days before). Pure; `today` is passed in.
6. **(Approved.) Held for review over a range** uses `countHeldForReview(first, last)` as the summary does today: flagged, unreviewed sales stamped inside the range.
7. **(New, from the conditions.) Dates and queries.** Business dates are Asia/Manila dates only: `today` is `manilaToday()`, a range's dates come from `parseBusinessDate`, and a sale's day from `countedBusinessDate` (Manila); never a UTC date default. Every database query over a range uses `gte` the start of `from` (00:00:00.000 +08:00) and `lt` the start of the day after `to` (an exclusive next-day boundary), never `lte`; reviewed flagged sales match on `timeReviewedBusinessDate` between the two `@db.Date` values (`countsInRange`, unchanged).

## 4. Build

### 4.1 `src/lib/date-range.ts` (pure)

`parseRange(from, to, today)` → `{ ok: true, first: BusinessDay, last: BusinessDay, dates: string[] }` or `{ ok: false, status: 400 | 422, error }`; `MAX_RANGE_DATES = 366` (inclusive dates, §2); `presetRange(name, today)` (Decision 5). Built on `parseBusinessDate`; no Prisma, no I/O. `periodDates` in `lib/ledger-summary.ts` stays as it is for the legacy parameters.

### 4.2 `src/lib/range-figures.ts`

`rangeFigures(first, last, commissionBase)`: one transaction query (`countsInRange`, `paymentStatus: PAID`, with the item's service name), bucketed per date by `countedBusinessDate`. Returns per date and in total: cash, GCash, Maya, QR Ph, revenue, count, commissions in the requested base (the stored snapshot for `LIST_PRICE`, `commissionFor(amountPaid ?? totalAmount, rate)` for `AMOUNT_PAID`, as `totalsForDate`), canonical commission, tips, services (count and list-price sales via `listPriceOf`), and per barber. Decisions 2 and 7.

### 4.3 Routes

- `GET /api/v1/reports/ledger-summary`: accepts `from`+`to` (with `commissionBase`), or the legacy `date`+`period` (untouched path); both forms together → 400. A `from`/`to` answer has the legacy response's shape; `from`/`to` echo the range; `days` lists every day when the range is longer than one day. Petty cash and payout totals read once over the range; remaining is the sum of clamped daily balances, as the legacy path computes it. Read-only.
- New `GET /api/v1/reports/payout-history?from&to`: owner access (`hasOwnerAccess`; 401 for anyone else, a barber session included), §2 rule, Decisions 3, 4 and 7. Answers `{ success, from, to, heldForReview, totals: { owed, paid, remaining, additionalOwedDays }, days: [{ date, barbers: [{ barberId, barberName, active, commission, tips, owed, paid, remaining, additionalOwed, entries }] }] }`, money as 2-decimal strings. Strictly read-only: no create, update or upsert.
- `scripts/lib/authz-matrix.ts`: a row for `GET v1/reports/payout-history`, access `owner`.

### 4.4 `src/lib/day-figures.ts`

`loadDay` and `loadDaySafely` moved out of `src/app/insights/page.tsx` unchanged (with the `BarberRow` type); the page imports them. Nothing else changes on Insights.

### 4.5 CLAUDE.md

Owner-only: add `GET /api/v1/reports/payout-history`. Invariants: one sentence that a range is from/to Manila business dates, both included, a sale counting in a range exactly as on its day, at most 366 dates, never after today, queried with an exclusive next-day boundary. Commands: `test:date-range` (needs nothing), `test:payout-history` (dev server).

## 5. Tests

Each item is its own check, so one passing can't hide another failing. Existing suites keep their assertions unchanged.

- New `npm run test:date-range` (pure): valid ranges; `from` after `to`; 366 inclusive dates accepted, 367 refused (including across 29 Feb); `to` today and tomorrow against a fixed Manila `today`, including a `today` derived from an instant at 23:59 and 00:00 Manila that is the previous/same UTC date; impossible dates; every preset on a Monday, a Sunday, the 1st and the last day of a month, 29 Feb; a range crossing a month and a year end; each range's query bounds are 00:00:00.000 +08:00 on `from` and 00:00:00.000 +08:00 on the day after `to`.
- `test:ledger-summary` (dev server):
  - **Equivalence with the existing calculations:** `rangeFigures` equals `computeExpected` + `totalsForDate` (+ the legacy item query) day by day, both bases, on fixtures with every payment method, PAID/PENDING/EXPIRED/FAILED, tips, a reviewed and an unreviewed flagged sale, and the four midnight sales of edge case 1. A `from`/`to` answer equals the legacy answer field for field for a one-day range, a completed past week and a completed past month. The suite's existing legacy assertions are kept unchanged and still pass.
  - Manila midnight boundaries (edge case 1) at both ends of a range.
  - A held flagged sale: counted nowhere and in `heldForReview`; after review, on its confirmed date only.
  - Daily versus range-level remaining: a day overpaid and the next underpaid; the range remaining is the sum of the clamped days, not owed − paid.
  - 400 (from after to, 367 dates, `date` with `from`), 422 (`to` after today); 401 without owner access and with a barber session.
  - A 366-date range answers in under 10 seconds; the measured time is printed and reported.
- New `npm run test:payout-history` (dev server):
  - Authorization: 401 signed out; 401 with an authenticated `BARBER` session (with and without approved-phone headers); 200 for the owner.
  - Owed from sales: a sale synced after the day was opened on `/ledger` (stored row stale) is in owed.
  - A fully paid day followed by a later sale: `additionalOwed` true, `remaining` = the new sale's commission + tip, the paid amount unchanged; the flag counted once in `additionalOwedDays`, nothing added for it.
  - Payout corrections: a payout and a partial correction; `paid` is the signed sum, both entries listed as stored (the correction negative); remaining follows.
  - Daily versus range-level remaining (edge case 5): per-day remaining clamped; range remaining = Σ daily remaining; differs from owed − paid when a day is overpaid.
  - Edge cases 6 (entry under the date it pays for) and 8 (inactive barber); only barber-days with something listed; newest day first.
  - Agreement with the existing payout cards: for each fixture day, owed, paid, remaining and `additionalOwed` per barber equal the payouts GET's list-price row for that day.
  - Manila midnight boundaries (edge case 1).
  - Read-only: a GET writes nothing (transaction, ledger row and entry counts unchanged); 400/422 as the rule.
- `test:authz`: the matrix row, refusal probes (signed out, phone, barber session, PIN cookie) and the owner's allowed read.
- All suites, `npm run lint`, `npx tsc --noEmit`.

## 6. Manual test

1. Signed in as the owner, open `/api/v1/reports/ledger-summary?from=<Monday>&to=<Sunday>` for a completed past week and `…?date=<a day in it>&period=week`: the figures are identical.
2. `…?from=<today>&to=<tomorrow>`: 422.
3. `/api/v1/reports/payout-history?from=<7 days ago>&to=<today>`: each day lists only barbers with sales or payouts; a day paid in two entries shows both; owed matches that day's card on `/ledger`.
4. Record a payout on `/ledger` for yesterday, then reload the history: it is under yesterday.
5. In a signed-out browser, and signed in as a barber, the payout-history URL answers 401.

## 7. Assumptions for final approval

1. The legacy `date`/`period` path keeps its current code (no switch to `rangeFigures`), so its behaviour can't change; only `from`/`to` uses the new loader, and its equivalence is proven against the legacy answers and the day functions (Decision 2).
2. The payout history's `owed` uses the list-price snapshot only (no Amount-paid view), and the range answer reports a count of additional-owed barber-days, not an amount (Decision 3).
3. Moving the Insights day loader to `src/lib/day-figures.ts` is kept in this slice as planned for the slice 21 dashboard; it is a move with no behaviour change. If you count it as unrelated refactoring, it moves to slice 21.
4. "Last 7 days" ends at today and "This week" starts on Monday; the 366-date cap applies to `from`/`to` only (the legacy month is at most 31 dates).
5. The 10-second bound for a 366-date range is a smoke check on the dev machine, not a performance requirement.

<!-- END OF SPEC -->
