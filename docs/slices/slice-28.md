# Slice 28 — Forecast page presentation (`/forecast`)

Repo: `ruzzco-system`. Status: **Built 2026-11-17 (see §15); uncommitted until approved.** Branch `revision/preliminary` (do not change branches).
Provenance: **supporting improvement** (UI/UX backlog item U-2, Brent's choice, 17 Nov 2026). Brent asked for the forecast information to be easier to understand. No usage observation about this page has been recorded yet. Related to the written panel item on revenue calculated versus predicted (register R2-1), which slice 24 answered. This slice keeps that answer intact; it does not re-answer it.
Numbering: slice 28 was earlier proposed for the Sales URL filters and the ledger Custom amounts cleanup. That work is now **unnumbered deferred work** and is not part of this slice. Slice 29 (Activity Log) stays deferred.
Written by the planning session after a read-only audit of the code and of the local development database (the shape of the saved forecast only; no figures were copied here).

## 1. Objective and rationale

The owner should understand, in this order:
1. What the forecast says: predicted customers for the coming days.
2. What the peso figure is: estimated revenue, calculated from that count.
3. How far to trust it: the typical error, in plain words.

The evaluation and technical detail come only after that. Today `/forecast` opens with evaluation and never shows the forecast itself. Its title area also differs from the other report pages, and two messages point to a "home page" that is now called the Dashboard.

This is a **presentation-only** change: same data, same calculations, same saved run.

## 2. Current behaviour [as audited at HEAD `95a8945` plus the uncommitted slices 23–27]

**Files**
- `web/src/app/forecast/page.tsx` (275 lines, a server component): the page.
- `web/src/app/forecast/layout.tsx`: `OwnerPageGate pathname="/forecast" title="Forecast report"`.

**Data:** `latestForecast()` (`web/src/lib/forecast.ts:145`) is called with its default of **7 days from today (Manila)**. Then come `serializeForecast`, `buildReportView(run.comparison, formatDate)` (`lib/forecast-comparison.ts:87`) and `revenueExample(forecast, manilaToday())` (`lib/forecast-revenue.ts`). The page never calls the ml-service.

**Rendered, in order**
1. An inner banner `<header className="rz-banner">` with the h1 "Detailed forecast", a barber-pole icon and an empty spacer whose comment says it "balances the Home link" (no Home link exists). It sits inside `OwnerShell`, whose top bar already shows "Forecast" (`navTitle`).
2. `Verdict`, "Can I trust this forecast?": typical error (`typicalErrorCustomers`), the best simple guess's error (`bestBaselineError`), `weeksRfWon` of `weeksTested`, `view.basisLine`, and "Saved with the forecast on {createdOn}".
3. `RevenueExplained`, `id="revenue"`, "How the revenue estimate is worked out": "What the model predicts" / "What the system works out" (with `avgTicket`); a worked example (customers × average = the stored revenue, `pesoWhole`); three bullets "Why it is an estimate, not a promise".
4. `RankedBars`, "How the methods compare": every method by mean error (MAE) and RMSE, with the served one marked.
5. `WeekTable`, "Week by week": MAE per test week and method, plus the mean and the week-to-week swing.
6. `MethodNotes`, "About the methods".
7. `ModelBehind`, "The model behind the forecast": version, training range, open days, and "Its revenue estimate is explained above."

**Empty and error states**
- No owner access: `ForecastLocked` with the description "How the forecast is checked and how its revenue estimate is worked out. Owner only." (**pinned by `test:authz` line 499**).
- Database unreachable: a danger notice.
- No run: "No forecast has been saved yet. **Open the home page** and press Refresh forecast."
- No comparison: "No comparison was saved with this forecast. Press Refresh forecast **on the home page** once the forecast service has been retrained."

**Dashboard (unchanged by this slice):** `components/dashboard/Dashboard.tsx:78` loads `latestForecast(today, MAX_FORECAST_DAYS)` (30 days) into `components/ForecastPanel.tsx`. The panel has:
- the 7/14/30 switch;
- a Refresh button;
- the `ColumnChart` from `forecastChart(days)`;
- a table of Day / Customers / `REVENUE_LABEL` with a total;
- the typical-error sentence, the training range and `revenueNote`;
- links to `/forecast#revenue` and `/forecast`.

**Saved data (local dev database, read-only, 17 Nov 2026):**
- 118 runs. The latest was saved on 16 Nov (Manila), so on 17 Nov it is not from today.
- Its comparison has `basis`, `test_from`, `served`, `mean`, `spread`, `rmse` and 4 `weeks`.
- 29 saved days from 17 Nov onward; no saved day lacks `predictedCustomers`.
- No figures are recorded here (CLAUDE.md: no client figures in specs).

**Heading pattern on other owner pages:** Sales and Reports use a plain `<header>` with `<h1 className="rz-title text-3xl">` (Reports adds `sm:text-4xl`) inside `rz-page`. The Ledger (Payouts) and Reconciliation (End-of-Day Cash) pages still use an `rz-banner`. They are **out of scope** here; see §12.

## 3. Scope

**In**
1. Replace the inner banner with the standard heading pattern (Sales/Reports).
2. Replace every user-visible "home page" on `/forecast` with "Dashboard", as a link to `/`.
3. Reorder the page so the forecast comes first, then what its numbers mean, then the evaluation.
4. Show the next days' **predicted customers** on `/forecast` from the saved run already loaded (chart + table). The Dashboard keeps its full panel unchanged.
5. Distinguish clearly: predicted customers; estimated revenue (customers × the average paid per customer in the training logbook); the typical error in plain words.
6. Better labels, units, dates, spacing and responsive layout for the page's chart and tables.
7. Keep every evaluation section, grouped under one heading in a clearer order, each with a one-line takeaway built only from saved fields.

**Out (explicit)**
- Any change to the model, the ml-service, training data, evaluation methodology, saved values or the revenue calculation.
- Actual versus predicted (slice 24 Part 2 stays BLOCKED).
- Confidence intervals or any range the system does not calculate.
- New API routes, tables, migrations or Prisma queries, and any change to `latestForecast`.
- A Refresh button or any ml-service call on `/forecast`.
- Any change to `ForecastPanel.tsx`, `Dashboard.tsx`, `forecast-chart.ts`, `forecast-comparison.ts`, `forecast-revenue.ts` or `forecast.ts`, except where §8 explicitly allows.
- The `rz-banner` on Payouts and End-of-Day Cash.
- The 14/30-day horizons on `/forecast` (decision D1).
- Dark mode.

## 4. Decisions

Defaults, to be confirmed in §13.

- **D1 Horizon on `/forecast`: the next 7 saved days only.** Reason: accuracy was measured on 7-day test weeks, and this keeps the existing `latestForecast()` call (default 7) exactly as it is. The page says "Longer views (14 and 30 days) are on the Dashboard", linking to `/`.
- **D2 The typical error is stated in customers only.** No peso equivalent is added on `/forecast`: the Dashboard's "(about ₱…)" is its own derived figure and is not copied here.
- **D3 The page title is "Forecast"**, the menu label. `layout.tsx`'s gate title changes from "Forecast report" to "Forecast" (shown on the sign-in and approval screens). The `ForecastLocked` description stays word for word (`test:authz`).
- **D4 Takeaways use saved fields only.** Allowed:
  - the served method (`comparison.served`, `run.typicalErrorCustomers`);
  - the lowest-error method (`view.ranked[0]`, already sorted by `buildReportView`);
  - `bestBaseline` / `bestBaselineError`, and `weeksRfWon` of `weeksTested`;
  - the number of test weeks (`view.weeks.length`).

  No new statistic, average, percentage or rounding beyond the formats already used (`toFixed(2)` for errors, `toFixed(1)` for customers, `pesoWhole` for estimated revenue). A takeaway never says Random Forest is the best unless `view.ranked[0].method === comparison.served`; the wording is chosen from the data, never hard-coded as a claim.
- **D5 Shared chart helper unchanged.** The forecast chart reuses `forecastChart(days)` and `ColumnChart` exactly as the Dashboard does. Its tooltip shows the estimated revenue with two decimals while the tables use whole pesos. That difference is shared with the Dashboard and pinned by `test:forecast-comparison` (line 131), so it is **not** changed here (§13 Q4).

## 5. UI behaviour and information hierarchy

Inside `<main className="flex-1"><div className="rz-page max-w-4xl mx-auto p-4 sm:p-6 space-y-6">`. Keep `max-w-4xl`.

**0. Header** (Sales/Reports pattern)
- `<header className="space-y-1">` with `<h1 className="rz-title text-3xl">Forecast</h1>` and a subtitle (`text-sm text-dust`): "Customers the model expects in the next days, how the peso estimate is worked out, and how the forecast was checked."
- A meta line (`text-xs text-dust`): "Saved on {formatDate(run.createdOn)} · model {run.modelVersion}".
- If `run.createdOn < today`, also: "This forecast was saved on {date}. Refresh it on the [Dashboard](/)." The page itself never refreshes.
- Removed: the `rz-banner`, `BarberPoleIcon`, the spacer and its comment.

**1. Section "Next {n} days"** (`<h2>`; `n` = the saved days shown, at most 7, from today, Manila)
- Plain lead: "Predicted customers per day. The forecast predicts customers only; the peso column is an estimate worked out from it."
- `ColumnChart` with `{...forecastChart(days)}`, `unit="count"`, `labelHeading="Day"`, `valueHeading="Predicted customers"`. The chart's `summary` comes from `forecastChart`, unchanged.
- A table with a `<caption className="sr-only">` naming the range. Columns:
  - **Day**: weekday plus "Mon d", as on the Dashboard.
  - **Predicted customers**: `toFixed(1)`, or "—" for null.
  - **`{REVENUE_LABEL}`** ("Est. revenue"): `pesoWhole(Number(day.revenue))`.
  - Footer "{n}-day total" (or "Week total" for 7): customers summed to one decimal, and the estimated revenue summed and shown with `pesoWhole`. Computed exactly as `ForecastPanel` does (§7).
- A typical-error line: "On the {weeksTested} test weeks, this forecast missed by about {typicalErrorCustomers} customers a day on average. A single day can be further off."
- "Longer views (14 and 30 days) are on the [Dashboard](/)."
- **No saved days from today** (old run): "No saved forecast covers today. Refresh it on the [Dashboard](/)." The section stays and the rest of the page still shows.

**2. Section "What these numbers mean"** (`<h2>`, keeps `id="revenue"` and `scroll-mt-20`, so the Dashboard's `/forecast#revenue` link still lands here)
- Three plain items (a `dl`, `rz-well` cards, `sm:grid-cols-3`):
  - **Predicted customers.** "How many customers the model expects each day. This is the only thing the Random Forest predicts." The `dt` text "What the model predicts" stays, because `test:forecast-revenue` pins it; the plain label can be a visible sub-line.
  - **Estimated revenue.** "What the system works out: predicted customers × {peso(avgTicket)}, the average paid per customer in the logbook from {dataFrom} to {dataTo}. Revenue itself is not predicted." The `dt` "What the system works out" stays (pinned).
  - **Typical error.** "How far off the customer prediction was on the test weeks, on average: about {typicalErrorCustomers} customers a day. The revenue estimate carries the same error."
- The worked example and the three "Why it is an estimate, not a promise" bullets are unchanged in content.

**3. Group "How the forecast was checked"** (`<h2>`, then each former section as `<h3>`, in this order, each starting with a one-sentence takeaway, D4)
1. **"Can I trust this forecast?"** (former Verdict, same sentences and `basisLine`). Takeaway: "Random Forest did better than the best simple guess in {weeksRfWon} of {weeksTested} test weeks."
2. **"How the methods compare"** (former RankedBars, unchanged figures). Takeaway: "Lowest typical miss: {view.ranked[0].name} ({mean.toFixed(2)} customers a day). The forecast uses {served name}." When the two are the same: "The forecast uses the method with the lowest typical miss."
3. **"Week by week"** (former WeekTable, unchanged figures). Takeaway: "{view.weeks.length} test weeks; lower is better. The swing shows how much each method's miss changed from week to week." Keep `overflow-x-auto`, and make the Week column's cells sticky on the left on narrow screens (`sticky left-0 bg-panel`) so method columns scroll under it.
4. **"About the methods"** (former MethodNotes, unchanged).
5. **"The model behind the forecast"** (former ModelBehind). "Its revenue estimate is explained above." becomes "The revenue estimate is explained under What these numbers mean."

**State matrix** (all of these must render without errors)

| State | Header | Next days | What it means | Checked group |
|---|---|---|---|---|
| no owner access | `ForecastLocked` only, description unchanged; no figure on the page | — | — | — |
| DB unreachable | header; the existing danger notice | — | — | — |
| no run | header (no meta line) | "No forecast has been saved yet. Refresh it on the [Dashboard](/)." | — | — |
| run, comparison null | full | full | full | Verdict and Model only, plus "No comparison was saved with this forecast. Refresh it on the [Dashboard](/) once the forecast service has been retrained." |
| run, comparison without `weeks` (runs before slice 10) | full | full | full | as now: "Weekly detail was not saved with this forecast." |
| run, `rmse` absent (runs before slice 12) | full | full | full | RMSE shows "—", as now |
| run older than today | stale line | the saved days from today, possibly fewer than 7, or the empty message | full | full |
| forecast service down | no effect: the page reads MySQL only | | | |

## 6. Wording rules

- "Predicted" goes only with **customers**. Revenue is "estimated", or "worked out" or "calculated". `test:forecast-revenue`'s `PREDICTED` check stays green: no line in `forecast/page.tsx` may match `/(expected|predicted|forecast) revenue|revenue forecast/i`.
- The page must not contain "for the next 7 days" (pinned by `test:forecast-revenue`). The section heading is "Next {n} days".
- No mention of a "home page" in user-visible text on `/forecast`.
- No wording that implies a range, an interval or a guarantee.
- The wording stays consistent with the manuscript's forecast terms (Increments 1–6): "recorded customers", "estimated revenue", "typical error"/MAE. Where the page says "customers", it means the predicted count, never POS sales.

## 7. Data-source and calculation invariants

1. Data comes only from the existing server calls on the page: `latestForecast()` (default arguments, unchanged), `serializeForecast`, `buildReportView`, `revenueExample`, `manilaToday`. No new Prisma call, route or fetch.
2. Every figure is a saved value, formatted as before:
   - customers: `toFixed(1)`;
   - errors: `toFixed(2)`;
   - estimated revenue per day: `pesoWhole(Number(day.revenue))`, the stored value, never recomputed as customers × average;
   - `avgTicket`: `peso`.
3. The only new arithmetic is the two table totals, done exactly as `ForecastPanel` (lines 59–60):
   - `days.reduce((s, d) => s + (d.customers ?? 0), 0)` shown with `toFixed(1)`;
   - `days.reduce((s, d) => s + Number(d.revenue), 0)` shown with `pesoWhole`.

   For the same days, both totals equal the Dashboard's at the 7-day horizon.
4. Days shown: `forecast.days.filter((d) => d.date >= today).slice(0, 7)`, the same filter as `ForecastPanel`.
5. Takeaways (D4) use only the fields listed there.
6. Nothing writes. The page stays `force-dynamic` and owner-only through `ownerPageAccess()`.

[R] Put items 3–5 in one pure helper, `web/src/lib/forecast-page.ts`: `forecastPageDays(forecast, today)` returns `{ days, totalCustomers, totalRevenue, stale }`, and `forecastTakeaways(run, view)` returns the strings. They are pure, without React or Prisma, so the regression suites can check them. `ForecastPanel` is **not** refactored to use it (Dashboard regression risk); the test checks both agree on invented data instead (§10).

## 8. Implementation file list

| File | Change |
|---|---|
| `web/src/app/forecast/page.tsx` | Header (§5.0); new Next-days section; "What these numbers mean"; "How the forecast was checked" group with `h3`s and takeaways; state matrix; wording (§6). `RankedBars`, `WeekTable` and `MethodNotes` keep their figures and markup apart from heading levels, takeaways and the sticky week column. |
| `web/src/app/forecast/layout.tsx` | Gate title "Forecast report" → "Forecast" (D3) |
| `web/src/lib/forecast-page.ts` | New, pure (§7 [R]) |
| `web/scripts/test-forecast-comparison.ts` | Add checks (§10.1) |
| `web/scripts/test-forecast-revenue.ts` | Add source checks (§10.2) |
| `CLAUDE.md` | (a) In the Forecast invariant, "(the home panel shows only the Random Forest prediction, as a chart and a table, and its own error)" becomes: the Dashboard panel shows the Random Forest prediction for 7, 14 or 30 days with a refresh; `/forecast` shows the next 7 saved days read-only, never refreshing. (b) Owner-only list, "`/forecast` (the detailed report)" becomes "`/forecast` (the next 7 saved days, the revenue explanation and the evaluation)". (c) "Current plan" line. No other section. |
| `docs/slices/slice-28.md` | Add "As built", the actual test counts and the browser results after the build |

Not touched: `ForecastPanel.tsx`, `Dashboard.tsx`, `ColumnChart.tsx`, `forecast-chart.ts`, `forecast-comparison.ts`, `forecast-revenue.ts`, `forecast.ts`, `ml-service/`, `prisma/`, `public/sw.js` (owner pages are not cached), every API route.

## 9. Responsive and accessibility requirements

- One `h1` ("Forecast"). `h2` for the three main parts; `h3` inside "How the forecast was checked". No skipped levels.
- 360 px:
  - no horizontal page scroll;
  - the day table fits (three columns, figures `tabular-nums`, right-aligned);
  - the week table scrolls inside its card with the Week column sticky;
  - the ranked list keeps its existing stacked phone layout;
  - the three "What these numbers mean" cards stack.
- Desktop: the cards sit in three columns from `sm`; prose is capped at `max-w-prose`.
- Tables have a caption (visible or `sr-only`) and `th` headers. The chart keeps `ColumnChart`'s accessible summary and keyboard reading.
- Links to the Dashboard are real links to `/`, at least 44 px tall on touch (`pointer-coarse:` padding, as in `ForecastPanel`).
- Colours are tokens only (`test:theme`); no new colour. The served method stays marked by text ("Used for this forecast"), not by colour alone.
- Dates: business dates through the page's `formatDate` (UTC on a `YYYY-MM-DD`); "Saved on" uses `run.createdOn` (the Manila date). No time zone conversion of business dates.

## 10. Tests

**Justified additions only**

**10.1 `test:forecast-comparison`** (pure, needs nothing), for `lib/forecast-page.ts`:
- `forecastPageDays`:
  - keeps only days ≥ today, at most 7, in date order;
  - totals equal the `ForecastPanel` formula for the same invented days;
  - a null customer counts as 0 in the total and shows "—";
  - `stale` is true when `run.createdOn < today`;
  - no days from today gives an empty list.
- `forecastTakeaways`:
  - names `view.ranked[0]` as the lowest typical miss;
  - when the served method is not the lowest, says so and never calls it the best;
  - when it is the lowest, says so;
  - `weeksRfWon` of `weeksTested` is quoted from the run;
  - `view.weeks` null gives no week takeaway;
  - no takeaway contains a number absent from the inputs.

**10.2 `test:forecast-revenue`** (source checks on `src/app/forecast/page.tsx`):
- Keep every current check.
- Add:
  - no "Detailed forecast" and no `rz-banner`;
  - no user-visible "home page";
  - an `h1` "Forecast";
  - the Next-days table uses `{REVENUE_LABEL}` and `pesoWhole`;
  - the page has a link to `/`;
  - the page still has `id="revenue"`;
  - `layout.tsx` gate title is "Forecast".

**10.3 Regression, unchanged suites that must stay green:** `test:forecast-comparison`, `test:forecast-revenue`, `test:insights-story`, `test:authz` (needs the dev server: the `/forecast` owner, barber and signed-out checks, and the signed-out marker at line 499), `test:approval-gate`, `test:nav`, `test:theme`; `npm run lint`; `npx tsc --noEmit`.

Not added: no new suite; no browser automation suite. Report actual counts only. A suite that can't run (for example the dev server is down for `test:authz`) is reported as not run, with the reason.

## 11. Acceptance criteria

1. The page shows one title, "Forecast", in the Sales/Reports pattern; no inner banner.
2. No user-visible "home page" on `/forecast`; every refresh instruction names and links the Dashboard.
3. Order: the header (with saved date and the stale line when it applies) → Next days → What these numbers mean → How the forecast was checked (Verdict, methods, weeks, method notes, model).
4. The Next-days chart and table show the same days, customers and estimated revenue as the Dashboard's panel at its 7-day horizon, on the same day and run (checked side by side in the browser).
5. Every figure on the page equals the saved value (§7). The suites in §10 are green.
6. "Predicted" only goes with customers; the `PREDICTED` check is green; no interval or range is shown.
7. All states in the §5 matrix render (checked in the browser where they can be produced, otherwise by the pure tests).
8. The Dashboard's panel, its links (`/forecast`, `/forecast#revenue`) and its 7/14/30 switch work exactly as before.
9. At 360 px: no horizontal page scroll; touch targets at least 44 px; headings in order.
10. No file outside §8 changed; no route, query, schema or ml-service change.

## 12. Manual browser checks

Use the dev server (`scripts/dev-reset.ps1 -Start`) with an owner session; hard-reload each page.
1. Desktop `/forecast`: one title; saved date; the stale line on a run from an earlier day (the current local run is from 16 Nov); Next 7 days chart and table.
2. Side by side with the Dashboard at 7 days: same days, customers and estimated revenue, same totals.
3. `/forecast#revenue` from the Dashboard's "How the estimate works" link lands on "What these numbers mean".
4. The "How the forecast was checked" group: the takeaways match the figures under them; the served method is marked.
5. 360 px (device toolbar): no sideways scroll; the week table scrolls inside its card with the Week column fixed; the cards stack.
6. Signed out: the `ForecastLocked` card only, no figures. As a barber session: redirected to `/pos`.
7. With the ml-service stopped: the page still renders the saved run.
8. Keyboard only: Tab through the links and the chart; focus is visible.

Not reproducible locally without changing data (do not change it): "no run" and "comparison null". These are covered by the pure tests and code review.

## 13. Risks, dependencies and open decisions

**Risks**
- Server rendering `ColumnChart` (a client component) from the server page: the props must be plain and serializable (`forecastChart` returns plain objects). Check for no hydration warning in the console.
- Wording drift between the page, the Dashboard and the manuscript. Mitigated by §6 and the pinned checks.
- Takeaways that read as claims ("best"). Mitigated by D4 and the 10.1 checks.
- `test:authz` depends on the `ForecastLocked` description; it must not change.

**Dependencies**
- Slice 24 (built, uncommitted; the revenue explanation).
- Slice 27 (Reports links to `/forecast`).
- Both are on the same branch.

**Open decisions for Brent** (defaults apply if not changed)
- **Q1 (D1):** 7 days only on `/forecast`, with 14/30 left on the Dashboard? Default yes.
- **Q2 (D2):** typical error in customers only, with no peso equivalent? Default yes.
- **Q3 (D3):** rename the gate title "Forecast report" to "Forecast"? Default yes.
- **Q4 (D5):** leave the chart tooltip's two-decimal peso as it is (shared with the Dashboard)? Default yes. Changing it touches the Dashboard and `test:forecast-comparison` and needs its own approval.

## 14. Manuscript and revision-matrix implications (after build and verification only)

- **Table 1, "Forecast page" row** (manuscript Increment 7): add that the page shows the next 7 saved days of predicted customers with their estimated revenue, read from the saved forecast, before the explanation and the method comparison.
- **The Chapter 3 paragraph describing the Dashboard forecast panel and "the link See the detailed forecast"**: add the same sentence for the Forecast page. The Dashboard sentence stays true.
- **Table 6:** one row, slice 28, its date, "not yet committed" until it is committed.
- **Table 7:** one row. Reason: clearer presentation of the forecast for the owner, a team improvement (UI/UX backlog U-2). It supports, but does not replace, the slice 24 answer to the written revenue item (R2-1).
- Screenshots of `/forecast` in the paper or the video must be retaken.
- **Revision matrix:** no panel item changes status. R2-1 keeps its slice 24 evidence and may cite this page as additional evidence. U-2 is not a panel item and is never listed as one.
- Not before: the commit, the suites in §10 green, and §12 done.

## 15. As built (2026-11-17, implementation session)

Built as specified, with Brent's amendments (they win over §5.2, §5.3 and the unchanged-content rule):
- **A1** the "Typical error" card reads: "How far off the customer prediction was on the test weeks, on average: about {n} customers a day. Because estimated revenue is worked out from the predicted count, a miss in the count also moves the revenue estimate." (replaces §5.2's last sentence).
- **A2** the third "Why it is an estimate" bullet reads: "The customer prediction itself has an error (see Typical error), and the revenue estimate moves with it."
- **A3** "How the methods compare" takeaway: lowest method same as served → "The forecast uses the method with the lowest typical miss."; a `COMPARISON_ONLY` method → "…, for comparison only (x.xx customers a day). The forecast uses {served}."; `random_forest_last7` → "…, an experimental variant that is not used for the forecast (…)"; any other method → the §5.3 sentence. The experimental set is a local constant in `lib/forecast-page.ts`.

Also: Next.js 16.4.2 → 16.4.6 (`next`, `eslint-config-next`, lockfile: `@next/env`, `@next/eslint-plugin-next`, `@next/swc-*` only).
Files: `app/forecast/page.tsx`, `app/forecast/layout.tsx` (gate title "Forecast"), `lib/forecast-page.ts` (new), `scripts/test-forecast-comparison.ts` (67 checks), `scripts/test-forecast-revenue.ts` (31), `CLAUDE.md`, `package.json`/`package-lock.json` (Next only).

Verification: `npm run lint` and `npx tsc --noEmit` clean; `npm run build` exit 0. Pure suites all pass (forecast-comparison 67, forecast-revenue 31, insights-story 131, approval-gate 135, nav 54, theme 87, pricing 81, price-check 105, payload-compat 31, report-chart 20, date-range 106, list-settings 32, local-session 74, qr-cache 35, pin-attempts 14, sync-queue 36, qrph-policy 17, shift-log-pages 21, submit-lock 23, sheet-stack 41). With the dev server and local MySQL: authz 327, sales-list 49, ledger-summary 164, report-parity 23, reconciliation-history 24, sync-rejections 108, api-errors 11, sync-clock 21, time-review 37, payout-entries 46, payout-history 55, auth 59, owner-unlock 17, all passing. Not run: gateway, payment-qr, attribution (T17 needs `TEST_ADMIN_DATABASE_URL`), device-approval, and the ml-service forecast suites (prerequisites not set up in this session).

Browser: signed out, `/forecast` shows the title and the locked card only, no figures (checked). Not verified in a browser: the signed-in page (the owner password can't be entered by the assistant), the 7-day side-by-side with the Dashboard, `/forecast#revenue`, 360 px, the barber redirect, keyboard. Brent to do §12 items 1–8 before the slice counts as done.

Outstanding, not in this slice (Dashboard, `ForecastPanel`, recorded only):
1. The panel's "Customers" column vs "Predicted customers" on `/forecast`.
2. `ForecastLocked`'s default "Expected customers and revenue" (wording rule).
3. The empty state "Start the forecast service and press Refresh forecast" (can't work on Vercel).
4. "See the detailed forecast" no longer matches the page title "Forecast".

<!-- END OF SPEC -->
