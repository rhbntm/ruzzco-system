# Slice 10 — Ledger summary, and the forecast split into a simple home panel and a /forecast report

Repo: `ruzzco-system`. Status: **BUILT 2026-10-14 (Brent said go ahead; the consult was not waited for), uncommitted. Not yet checked in a browser: the owner PIN was not read. Brent answered the open questions on 2026-10-14 (§7); what the advisor meant is still not confirmed by Quiza (next consult 2026-10-19).** Items tagged [AI proposal] are not confirmed.
Goal: on `/ledger`, above the per-barber payout cards, the owner sees a summary for a day, a week or a month: what came in (by payment method and by service), what goes out (barber commissions, tips, petty cash) and what is left for the shop. Read-only; it never changes how a sale or payout is recorded.
Goal (Part B): the home page shows a simple forecast, the Random Forest prediction only; a separate owner-only page, `/forecast`, holds the detailed forecast and the method comparison. Part B takes over the on-hold amendment of slice 9 (see §10).
The sections below are Part A (ledger summary) unless headed Part B.
Origin: the 2026-10-12 advisor consult asked to "add a summary of the breakdown of the cost to the ledger" (record: `../ruzzco-barbers/30_Decisions/2026-10-12-advisor-consult-ch3-and-system-requests.md`, request 3). Brent reads this as the ledger staying and confirmed on 2026-10-14 that it stays (still to be confirmed with Quiza 2026-10-19). It reverses the 2026-09-28 "remove the ledger" request (CLAUDE.md Client rules).

## 1. Scope boundary (read first)

- Display only: one new read-only route and one new section on `/ledger`. No schema change, no change to payouts, reconciliation, commission or attribution logic.
- Every figure reuses an existing definition (`computeExpected` in `src/lib/reconciliation.ts`, the payout snapshots, `countsOnDay()`); the summary never recomputes commission from current rates.
- Owner PIN rules unchanged: same cookie, same lock, same `401` as the other `/api/v1/reports/*` routes.
- Not in this slice (Part A): custom date ranges, exports, charts, an expenses table (see §2.5), entering petty cash on the ledger, changing the ledger's remove-or-keep status in the home page or CLAUDE.md, deciding who owes whom for GCash and Maya (still no rule encoded).
- No client sales figures in this spec, tests, fixtures or commit messages. Tests use invented amounts.

## 2. Decisions ([AI proposal] unless marked Brent)

1. **Reading of "cost breakdown" (Brent, 2026-10-14: "a combination of all"):** the summary covers money in and money out, **by payment method and by service**, for **a day, a week or a month**. Not confirmed by Quiza; if she meant something narrower, drop the parts she did not.
2. **Period picker:** Day (default, the page's date), Week (Monday to Sunday containing the date) or Month (the calendar month containing the date), all Manila business dates. The summary header names the exact range, for example "Mon 12 Oct to Sun 18 Oct". The per-barber payout cards below stay per day and are unchanged. [AI proposal] Monday-start weeks.
3. **Sections, in order, for the chosen period:**
   - **Sales (money in):** revenue by payment method: Cash, GCash, Maya, QR Ph (only when it has paid sales), then **Total revenue** and the number of paid sales. Revenue is `amountPaid`, tips excluded, PAID sales only (invariant).
   - **Shared out (money out):** **Barber commissions** (sum of the snapshotted commissions, under the base picked on the page), **Tips** (100% to barbers, shown separately and not in revenue), **Petty cash** (§2.5).
   - **Left for the shop:** total revenue minus barber commissions minus petty cash. Tips are not in revenue, so they are not subtracted. Labelled "before the owner's own costs"; it is not a profit figure.
   - **Payout status:** total owed to barbers, recorded as paid (cash plus GCash), still to pay.
4. **Follows the page's date and commission base.** The summary changes with the date picker, the period picker and the LIST_PRICE / AMOUNT_PAID toggle. Under AMOUNT_PAID only the commission line (and so "Left for the shop") changes.
5. **Same exclusions as the cards:** a sale held for date review (`countsOnDay`) is not in the summary. For Week and Month the banner counts held sales across the whole period. PENDING, EXPIRED and FAILED gateway sales count nowhere.
6. **Petty cash is read from End-of-Day Cash (Brent, 2026-10-14: enough for now).** There is no expenses table: petty cash is one amount (`pettyCashAmount`, with a note) on the latest `ShiftReconciliation` revision of each date; a period sums the latest revision of each of its days. If a day has no saved reconciliation it counts as 0; for a Day the line reads "Not recorded yet (End-of-Day Cash)" and counts as 0 in "Left for the shop", with the same note beside the total. For a Week or Month the line says how many days have no saved record. The owner's own costs (rent, supplies) are not tracked (Brent, 2026-10-14). Expense sharing stays `SHOP_ONLY` as the page already says (unconfirmed client rule, kept as a setting).
7. **Plain words, ₱ with two decimals, no jargon.** Labels as above. Digital sales (GCash, Maya, QR Ph) are marked "not in the drawer" so the owner does not mistake the summary for the cash count.
8. **Read-only route, not the payouts `GET`.** `GET /api/v1/reports/payouts` writes ledger rows (known gap), so the summary gets its own route and does not extend it.

## 3. What exists today (audit to repeat before building)

- `web/src/app/ledger/page.tsx`: one client component. Owner PIN form, date and commission-base pickers, "held for review" banner, one payout card per active barber (commission, tips, total earned, cash and GCash paid, remaining, Paid confirmation, Save payout).
- `GET/POST /api/v1/reports/payouts`: per-barber totals from the sale snapshots.
- `src/lib/reconciliation.ts` `computeExpected(day, pettyCash)`: cash, GCash, Maya, QR Ph totals, total revenue and PAID count, all via `countsOnDay`.
- `TransactionItem` (`serviceId`, `priceAtSale`) holds the services of each sale; `Transaction.listPrice`, `discountAmount` and `customAmount` mean item prices need not add up to `amountPaid`.
- `ShiftReconciliation` holds `pettyCashAmount` and `pettyCashNote`, versioned by `revision`; no expenses table.
- Nothing today shows total revenue, shop share or the money-in/out view on `/ledger`.

## 4. API

`GET /api/v1/reports/ledger-summary?date=YYYY-MM-DD&period=day|week|month&commissionBase=LIST_PRICE|AMOUNT_PAID`

- Owner cookie required (`hasOwnerAccess`, else `ownerRequiredResponse()`), same query schema and date validation as `payouts`.
- Response: `{ success: true, date, period, from, to, commissionBase, sales: { cash, gcash, maya, qrph, total, count }, shared: { commissions, tips, pettyCash, pettyCashRecorded }, leftForShop, payouts: { owed, paid, remaining }, services: [{ name, count, listSales }], serviceGap, days: [{ date, revenue, commissions }] (week and month only), pettyCashMissingDays, heldForReview }`. Amounts are decimal strings.
- Reads `computeExpected` for the sales block, the payout snapshots for commissions and tips (same query as `payouts`, extracted into a shared helper rather than copied), the latest `ShiftReconciliation` revision of each date in the range for petty cash, `TransactionItem` grouped by service for the service block (PAID, `countsOnDay` sales only), and `DailyPayoutLedger` rows for paid amounts. It must not create or update any row.
- Errors follow the existing `api.ts` helpers (`serverError`, no stack or Prisma message in the body).

## 5. Next.js changes

- `src/lib/ledger-summary.ts`: the pure arithmetic (left for the shop, remaining, service gap) and the period-to-range function (Monday weeks, calendar months, Manila dates), so they can be tested with invented numbers.
- `src/app/api/v1/reports/ledger-summary/route.ts`: the route above.
- `src/app/ledger/page.tsx`: fetch the summary with the cards (same `load`), add a Day / Week / Month picker and render one "Summary" section above the cards; the existing styling (dark cards, `text-red-300` totals); a loading and error state that does not hide the cards.
- Schema: none. Migration: none. Dexie: none.

## 6. Tests

- New `npm run test:ledger-summary` (add to `package.json`, then to the CLAUDE.md command list at wrap-up):
  - pure arithmetic with invented amounts (zero day, week and month ranges (month lengths, a week crossing a month end), tips never subtracted, service gap with a discount and a custom amount, petty cash absent counts as 0, AMOUNT_PAID changes only commissions);
  - route (needs the dev server): refused without the cookie; with it, totals match `test:reconciliation` and `payouts` for the same seeded day; PENDING and flagged sales excluded; week and month totals equal the sum of their days; calling it twice creates no rows (count `daily_payout_ledgers` before and after).
- Existing suites unchanged and still pass: `test:commission`, `test:reconciliation`, `test:time-review`. Plus `npm run lint` and `npx tsc --noEmit`.

## 7. Open questions

Answered by Brent, 2026-10-14 (not yet confirmed with Quiza, 2026-10-19):
1. "Breakdown of the cost" = a combination of all: money in and out for a day, by payment method and by service, over a day, week or month (§2.1).
2. The ledger stays, so the plan's Oct 25 "hide the ledger" block is dropped. Update CLAUDE.md (Client rules, "Conflicts to resolve") and the home page at build or wrap-up, not before.
3. Petty cash stays read from End-of-Day Cash (§2.6).
4. No owner-expense entry (rent, supplies).

Still open: is "Left for the shop" the right bottom line label? Should the Week and Month views cut the services by barber? [AI proposal] Not now.

## 8. Manual test (after build)

1. Open `/ledger` without unlocking: refused. Unlock: the Summary (Day) appears above the barber cards for today.
2. Pick a day with sales across cash and GCash: the payment-method lines add up to Total revenue; digital lines say "not in the drawer".
3. Switch the commission base to Amount paid: only the commissions and "Left for the shop" change.
4. Pick a day with no saved End-of-Day Cash: petty cash reads "Not recorded yet". Save one with petty cash, reload: the line shows it.
5. Pick a day with a sale held for date review: it is not in the summary and the amber banner still shows.
6. Save a payout for one barber: "recorded as paid" and "still to pay" move; revenue and commissions do not.
7. Switch to Week, then Month: the header names the range, the per-day list adds up to the totals, the service rows show counts, and the discounts and custom amounts line explains any gap from Total revenue.

## 9. Also at build time

- `docs/sessions/` log per CLAUDE.md. A decision record in `../ruzzco-barbers/30_Decisions/` only if Brent wants one.
- If the consult changes the meaning in §2.1, rewrite §2 to §4 before building.

## 10. Part B — Forecast: simple home panel and a `/forecast` report page

Added 2026-10-14 at Brent's request. This takes over, and supersedes where they differ, slice 9's on-hold amendment (slice 9 §2.10 to §2.15, §4 and §6): when slice 10 is built, that amendment is not run separately. Brent chose not to wait for the 2026-10-19 consult.

**Decisions**
1. **Home panel (simple):** the owner-only forecast panel on `/` shows only the **Random Forest prediction**: the next 7 days, customers per day and the revenue derived from it (customers x the average amount paid per customer from training; never the list price), as today. It no longer shows the method lists, the "How the methods compare" section or any other method's name. Brent's decision, 2026-10-14.
2. **What stays on the home panel:** the day rows, the Refresh forecast button, the locked card and PIN form, the offline/service-down message, the "typically off by about N customers a day" sentence (Random Forest's own error only, no other method named), and one link: "See the detailed forecast". [AI proposal] Keeping the N sentence so the owner can judge the numbers; drop it if Brent wants predictions only.
3. **`/forecast` (detailed):** owner PIN only, same cookie and locked card as the panel; without the cookie it shows the lock and no numbers. It reads the saved forecast run from the database only and never calls the ml-service, so it works while the service is down. Sections, top to bottom, are those of slice 9 §2.13: verdict and basis line (named test or reference weeks), ranked bars of all eight methods with the served one marked "Used for this forecast", the full table by week with Mean and Week-to-week swing (other models marked "for comparison only"), one plain line per method, and "The model behind the forecast" (version, logbook date range, open days; no sales figures). Plain CSS, no chart library.
4. **Per-week errors:** `ml-service` adds `weeks` to the saved comparison as in slice 9 §4 (oldest first, `{ start, end, mae }`, 2 decimals, no day counts), then one normal `train.py` run rewrites `metadata.json`. The check is that `model_version` and the model file hash are unchanged. Brent runs or approves it. Runs saved earlier have no `weeks`; `/forecast` then draws the bars from `mean` and says "Weekly detail was not saved with this forecast."
5. **Navigation:** the home panel links to `/forecast`; `/forecast` links back to Home. [AI proposal] `/forecast` is listed on the home page next to `/ledger`. The route does not clash with `/api/v1/forecast`.
6. **Owner-only list:** add `/forecast` to the owner-only invariant in CLAUDE.md at wrap-up.
7. **Unchanged:** training, testing and serving; the served model; `best_baseline` and `weeks_rf_won` rules (`linear` and `gboost` still never count); the `/api/v1/forecast` response shape (new fields optional); the rule that no client sales figures go in tracked files, specs or fixtures.

**Next.js:** `src/components/ForecastPanel.tsx` (remove the comparison section, add the link), new `src/app/forecast/page.tsx` and a view-model in `src/lib/forecast-comparison.ts` (extend; reuse the existing grouping), `src/lib/forecast.ts` (`comparisonSchema` gains optional `weeks`). No schema change: `ForecastRun.comparison` already holds JSON.

**Tests:** extend `test:forecast-comparison` for the ranked order and the missing-`weeks` case with invented numbers; route check that `/forecast` data is refused without the cookie; pytest for `weeks` in `comparison_summary`. Existing forecast suites still pass.

**Manual test:** (1) `/` while unlocked shows only the 7-day Random Forest forecast and a link, no comparison lists. (2) The link opens `/forecast`: bars, table, method notes. (3) Stop the forecast service: both pages still show the last saved run. (4) `/forecast` in a private window: locked.

<!-- END OF SPEC -->
