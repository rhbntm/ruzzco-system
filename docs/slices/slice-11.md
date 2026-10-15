# Slice 11 — Trends on the ledger summary: daily revenue chart, busy hours, previous-period comparison

Repo: `ruzzco-system`. Status: **SPEC, not built (written 2026-10-15).** Builder: the groupmate, on the fork `Raven063031/ruzzco-system-redesign`, through a pull request that Brent reviews. **Start only after the visual-redesign pull request (PR 1, branch `feat/visual-redesign`) is merged into `main`**: both change `web/src/app/ledger/page.tsx`. Items tagged [AI proposal] are not confirmed by Brent.
Goal: on `/ledger`, when the owner picks Week or Month in the Summary, the page also shows how the period went: revenue per day as a column chart, the busy hours of the day, and how the period compares with the one before. Read-only; it never changes how a sale or payout is recorded.
Origin: Brent's 2026-10-15 review of the `redesign` branch. Its `/insights` page mostly repeated `/forecast` (slice 10 Part B), End-of-Day Cash and the slice 10 ledger summary; its one new idea was the Trends section. Brent chose to keep that idea as this slice and not merge `/insights`, its presentation mode or its auto-written story text.

## 1. Scope boundary (read first)

- Display only: new optional fields on one existing read-only route (`GET /api/v1/reports/ledger-summary`) and new parts inside the existing Summary on `/ledger`. No schema change, no migration, no Dexie change, no change to sales, sync, attribution, commission, payouts, reconciliation or pricing.
- Every money figure reuses an existing definition: revenue is `amountPaid` (falling back to `totalAmount` as `computeExpected` does), PAID sales only, counted with `countsOnDay()`. Busy hours are counts of sales, never money.
- Owner PIN rules unchanged: same cookie, same lock, same `401` as the rest of `/api/v1/reports/*`. `/ledger` is already owner-only.
- No chart library. The chart is a small React component (§2.6).
- Not in this slice: the `/insights` page, presentation mode, generated sentences beyond the one comparison line in §2.4, "at this pace" projections of today, any forecast figure on `/ledger`, trends per barber or per service, 7/14/30-day ranges (the Summary's Day/Week/Month periods are used instead), exports.
- No client sales figures in this spec, tests, fixtures, screenshots committed to the repo, or commit messages. Tests use invented amounts.

## 2. Decisions ([AI proposal] unless marked Brent)

1. **Where (Brent, 2026-10-15: Trends become a slice on the ledger, not `/insights`):** the new parts sit inside the Summary on `/ledger`, under the money sections and above "Day by day", and only when the period is **Week or Month**. The Day view is unchanged.
2. **Revenue per day:** a column chart with one column per business date in the period, oldest first, using the same per-day revenue as the existing "Day by day" list (so the two always agree). Dates after today (Manila business date, `manilaToday()`) are left out of the chart; the "Day by day" list keeps its current behaviour. A day with no paid sales is a zero column, not a gap. Each column's tooltip shows the date, the revenue and the number of paid sales.
3. **Busy hours:** a column chart of how many PAID sales were rung up in each Manila hour over the period, from the sale's `transactionTime` converted with the `Asia/Manila` time zone (never the server's or UTC hour). Hours 10 AM to 9 PM (the shop is open 10 AM to 10 PM) are always shown; an hour outside them shows only if a sale was rung up then. Sales whose date the owner corrected on End-of-Day Cash (flagged, then reviewed) count on their confirmed day everywhere else, but their phone time is not trusted, so they are left out of this chart and counted in a note under it: "N date-corrected sales are not in this chart." Flagged sales not yet reviewed count nowhere (existing rule).
4. **Compared with the period before:** one line under the charts comparing revenue and paid sales with the previous period: the week before (Monday to Sunday) or the calendar month before.
   - When the chosen period contains today, the comparison is like for like: the same number of days from the start of each period (for example Monday to Wednesday against the previous Monday to Wednesday; 1 to 15 October against 1 to 15 September). For a month the count is capped at the previous month's length (31 March so far against all of February). The line then says "so far".
   - Wording: "Revenue ₱X, up 12% on the same days last week (₱Y). Paid sales 40, up 5." For a complete period: "on the week before" / "on the month before". Percentages are whole numbers.
   - When the previous period has no paid sales: "No paid sales in the same days last week" (no percentage, never divide by zero).
5. **Same exclusions as slice 10:** PAID sales only; PENDING, EXPIRED and FAILED gateway sales count nowhere; a sale held for date review is in no figure and the existing amber banner still counts it.
6. **The chart component:** reuse `ColumnChart` from the `redesign` branch (`web/src/components/ColumnChart.tsx`): one value per column, hover or tap or arrow keys for the tooltip, and a "Show as table" switch so nothing depends on hovering. Keep its accessibility (screen-reader summary, keyboard). Drop the props only presentation mode used (`delay`, `callout`) and anything else nothing calls. Colours come from the theme PR 1 merged; no hard-coded colours that clash with it.
7. **Plain words.** Headings: "Revenue per day", "Busy hours", "Compared with the week before" / "Compared with the month before". ₱ with two decimals in tooltips and the comparison line. Hours read "10 AM", "2 PM".

## 3. What exists today (audit to repeat before building, after PR 1 is merged)

- `web/src/app/api/v1/reports/ledger-summary/route.ts`: read-only; loops over the period's days and, per day, calls `computeExpected`, `totalsForDate` (`src/lib/payout-totals.ts`) and the service items; returns `days: [{ date, revenue, commissions }]` for Week and Month, `[]` for Day.
- `web/src/lib/ledger-summary.ts`: pure helpers, including `periodDates(date, period)` (Monday weeks, calendar months, Manila dates).
- `web/src/app/ledger/page.tsx`: `SummarySection` renders Money in, Shared out, Barber payouts, By service and Day by day. After PR 1 its styling will differ; build on the merged version.
- `web/scripts/test-ledger-summary.ts`: pure checks (`pure()`) plus route checks against the dev server.
- On the groupmate's backup branch `redesign-backup` (not on `main`): `web/src/lib/trends.ts` (`loadTrends`: the Manila-hour logic and the "date-corrected sales left out of hours" rule this slice reuses), `web/src/components/ColumnChart.tsx`, and `countsInRange` / `countedBusinessDate` in `web/src/lib/time-review.ts`. Copy only what §5 lists; do not bring `/insights`, `InsightsPresentation`, `insights-story`, `BarList` or `trends.ts` itself.

## 4. API

`GET /api/v1/reports/ledger-summary?date=YYYY-MM-DD&period=day|week|month&commissionBase=LIST_PRICE|AMOUNT_PAID`, unchanged request. New fields in the response; every existing field keeps its name, type and meaning:

- `days[]` entries gain `sales` (number of paid sales that day).
- `hours: [{ hour, sales }]` (hour 0 to 23, Manila; filled as in §2.3). `[]` for Day.
- `hourExcluded`: number of date-corrected sales left out of `hours`. `0` for Day.
- `previous: { from, to, revenue, count, partial }`: the comparison period of §2.4 (`partial` = true when it was cut to the same number of days). `null` for Day.
- `asOf`: today's Manila business date, so the page can leave future dates out of the chart without trusting the phone's clock.

Rules: still never creates or updates a row. Busy hours come from one query over the period: PAID sales with `countsInRange(first, last)` selecting `transactionTime`, `timeFlag`. The previous period's revenue and count come from one query with `countsInRange` over its dates. Amounts are decimal strings as elsewhere in this response. Errors use the existing `serverError` helper.

## 5. Next.js changes

- `src/lib/time-review.ts`: add `countsInRange(first, last)` from `redesign-backup` (same rule as `countsOnDay`, over a range of business days). Leave `countsOnDay` and everything else in the file as it is.
- `src/lib/ledger-summary.ts`: add pure functions (no database):
  - `previousPeriod(date, period, today)` returns `{ from, to, partial }` per §2.4.
  - `fillHours(counts: Map<number, number>)` returns the `hours` list per §2.3 (10 to 21 always, wider only when a sale exists).
  - `percentChange(current, previous)` returns a whole number, or `null` when `previous` is zero.
- `src/app/api/v1/reports/ledger-summary/route.ts`: add the fields in §4 for Week and Month only.
- `src/components/ColumnChart.tsx`: from `redesign-backup`, trimmed per §2.6.
- `src/app/ledger/page.tsx`: extend the `Summary` type with the optional new fields and render §2.2 to §2.4 inside `SummarySection` for Week and Month. If the new fields are missing (an older server), show the Summary as today.
- `package.json`: no new dependency, no new script (the tests extend `test:ledger-summary`).
- Schema: none. Migration: none. Dexie: none.

## 6. Tests

Extend `npm run test:ledger-summary` (invented amounts only):

- Pure (`pure()`):
  - `previousPeriod`: a full past week gives the Monday to Sunday before; a full past month gives the whole month before; today on a Wednesday gives the previous Monday to Wednesday with `partial` true; 15 October gives 1 to 15 September; 31 March 2026 gives all of February (28 days); 30 March 2028 gives all of February 2028 (29 days); a January date gives December of the year before.
  - `fillHours`: no sales gives hours 10 to 21 at zero; a sale at 8 AM starts the list at 8; a sale at 11 PM ends it at 23.
  - `percentChange`: 120 on 100 is 20; 80 on 100 is -20; anything on 0 is `null`.
- Route (needs the dev server):
  - Refused without the owner cookie (`401`).
  - For a seeded week: the sum of `hours[].sales` plus `hourExcluded` equals `sales.count`; a sale seeded at 14:30 Manila time lands in hour 14.
  - A flagged sale reviewed onto a date in the week is counted in `sales.count` and `hourExcluded`, not in `hours`.
  - `previous.revenue` equals `sales.total` of a direct call for that previous period (complete-period case).
  - `countsInRange` over the week returns the same sales as the seven `countsOnDay` days together.
  - Day period: `hours` is `[]` and `previous` is `null`.
  - Calling the route twice creates no rows (count `daily_payout_ledgers` before and after, as the existing test does).
- Existing suites still pass: `test:ledger-summary` (old checks), `test:commission`, `test:reconciliation`, `test:time-review`. Plus `npm run lint` and `npx tsc --noEmit`.

## 7. Open questions

1. The 2026-10-19 advisor consult may change what slice 10's summary covers (slice 10 §2.1, §9). Brent checks before this slice is built; if §2 there changes, this spec is updated first.
2. Trends per barber (revenue by barber over the week or month)? [AI proposal] Not now; the per-day barber cards already show it day by day.
3. Should the Day view get busy hours for that single day? [AI proposal] Not now.

## 8. Manual test (after build)

1. Open `/ledger` in a private window: locked, no figures. Unlock with the owner PIN.
2. Day view: the Summary looks exactly as before; no charts.
3. Week view for a past week with sales: "Revenue per day" has 7 columns whose values match "Day by day"; "Busy hours" shows 10 AM to 9 PM; the comparison line says "on the week before".
4. Week view for the current week: future days are not in the chart; the comparison line says "so far" and names the same weekdays.
5. Month view mid-month: the chart stops at today; the comparison uses the same number of days of last month and says "so far".
6. Turn on "Show as table" on each chart: every value is listed. Use the arrow keys on a chart: the tooltip moves.
7. At phone width (about 390 px): both charts fit without sideways scrolling and their labels are readable.

## 9. For the contributor's Claude (build checklist)

The builder is a groupmate working on a fork, not the repo owner: follow `CONTRIBUTING.md` "For Claude". This slice is built as a normal contributor task (not the owner's "run slice N" routine, no session log).

1. Confirm PR 1 (`feat/visual-redesign`) is merged into `rhbntm/ruzzco-system` `main`. If not, stop and say so.
2. `git fetch upstream`, update the fork's `main` from `upstream/main`, then create `feat/ledger-trends` from it.
3. Read this spec in full, confirm the last section is §9 and the `END OF SPEC` marker is present, and repeat the §3 audit. Tell the contributor what you found before editing.
4. Copy from `redesign-backup` only `ColumnChart.tsx` and the `countsInRange` function; reuse the hour logic from `trends.ts` by reading it, not by copying the file.
5. **Stop and ask before any change** to sales, sync, attribution, commission, payouts, reconciliation, pricing, the Prisma schema, or `CLAUDE.md`. If something seems to need one, it is out of scope; explain why in plain words. Suggested `CLAUDE.md` changes go in the pull request description, not the file.
6. Run the §6 tests, `npm run lint` and `npx tsc --noEmit`; report the results honestly, failures included. Ask the contributor to do the §8 manual test in the browser.
7. Before committing, show `git status` and `git diff --stat upstream/main...HEAD`; flag binary files, deleted files or anything not listed in §5. Add files by name. Commit and push to the fork only when the contributor says so, then open the pull request with the `CONTRIBUTING.md` template, including the test results and which manual-test steps were done.

<!-- END OF SPEC -->
