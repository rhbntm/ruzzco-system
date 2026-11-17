# Slice 24 — Forecast: revenue is calculated from the prediction, not predicted

Repo: `ruzzco-system`. Status: **Part 1 BUILT AND FUNCTIONALLY VERIFIED (2026-11-16)**: automated suites green; browser check §7 steps 1–4 PASS (§8). Part 2 **BLOCKED**. Uncommitted until approved. Branch `revision/preliminary`.
Provenance: Part 1 answers the formal written panel item "Clarification on Revenue Calculation vs. Direct Prediction" (Panelist 2) on the system side; the manuscript explanation is a separate checklist item. Part 2 is a team proposal, not a panel item.
History: drafted as "slice 25 (draft)" in planning; renumbered 24, the next free number (23 is several services per sale).

## 1. Scope

- In (Part 1):
  - the Forecast page explains, once, what the model predicts (customers per day) and what the system works out from it (estimated revenue = predicted customers × the training average paid per customer), with a worked example from the saved figures and why it is an estimate;
  - the Dashboard panel labels its peso column "Est. revenue", says in two sentences that the model predicts customers only, and links to that explanation;
  - Insights' forecast-revenue card is moved to the Forecast page (replaced by a one-line link);
  - "expected revenue" wording is replaced by "estimated revenue" in charts and Presentation mode;
  - the Forecast page's locked-state text is fixed.
- Unchanged: the ml-service, the model, its features, training data and evaluation; `saveForecast` and every stored forecast row; the forecast figures shown (same stored numbers); the Dashboard's layout, panel and Refresh; the schema.
- Out: a revenue model; forecast vs POS comparison (Part 2); forecast revenue vs POS revenue; the prediction-history table; confidence intervals.

## 2. Rule

No rule changes. The Random Forest model predicts customers per day. The ml-service stores, for each day, revenue = predicted customers × `avg_ticket` (the average amount paid per customer over the training logbook, recomputed on each training run). The app displays the stored values; it never recomputes or predicts revenue.

## 3. Decisions (as built)

1. `src/lib/forecast-revenue.ts` (pure): `REVENUE_LABEL` ("Est. revenue"), `revenueNote(avgTicket, peso)`, `revenueExample(forecast, today)` (the first saved day from today with customers: its customers, the run's average and the **stored** revenue), `exampleChecksOut` (stored revenue = customers × average to the centavo).
2. Forecast page (`/forecast#revenue`), after the verdict, "How the revenue estimate is worked out":
   - "What the model predicts": customers per day, the only thing the Random Forest forecasts.
   - "What the system works out": estimated revenue = predicted customers × the average paid per customer (the run's exact figure); revenue itself is not predicted.
   - A worked example: predicted customers (one decimal) × average = estimated revenue (whole pesos, the stored figure).
   - "Why it is an estimate, not a promise": the average comes from the training dates (including earlier prices) and can lag a price change until retraining; each day's real mix of services, loyalty discounts and custom amounts differs; the customer prediction's error carries into the estimate.
   - "The model behind the forecast" no longer repeats the formula and points to this section.
3. Dashboard panel: column "Est. revenue"; under the table, "The model predicts customers only. Estimated revenue is worked out from that prediction: customers × ₱(exact average), the average paid per customer in the logbook above." plus a link "How the estimate works". Chart tooltips read "estimated revenue". No layout change.
4. Insights: the "Forecast revenue" calculation card is removed and replaced by one line linking to `/forecast#revenue`; the forecast chart's text and tooltips say "predicted customers" and "estimated revenue".
5. Presentation mode (Insights story): "Estimated revenue" (note "Customers × ₱average"), tooltips "estimated revenue", footnote starts "The model predicts customers, not revenue."; the forecast headline reads "About N customers predicted over the next n days, an estimated revenue of about ₱X."; the first slide's figure note "Estimated revenue; about N customers predicted" and its highlight "… ₱X estimated revenue" (no "expected" or "worth around" for the pesos).
6. Locked text on `/forecast`: "How the forecast is checked and how its revenue estimate is worked out. Owner only."

## 4. Part 2 — forecast vs POS records (BLOCKED, not built)

May be enabled only in a later approved slice, after all gates:
1. **Count comparability** (barbers): a sale may hold several services since slice 23 and counts as one transaction; service items are never a customer count. The barbers must confirm they consistently ring up one sale per person per visit. Until then no POS figure is called a customer or visit count and no accuracy is shown.
2. **Go-live and demo data** (handover): the shop runs this version and demo or test sales are kept out of the production data.
3. **`FORECAST_COMPARE_FROM`**: an optional start date; setting it does not by itself make the counts comparable.

When enabled: only saved rows with a valid `runId`; only predictions generated before their target date (shown with generation date, lead time, model version); recorded side = PAID sales counting on that Manila date (`countsOnDay`), one per sale; today never compared; a live check kept apart from the logbook evaluation; never described as a complete prediction history; no revenue comparison until monetary comparability is verified (whether the logbook amount is what the customer paid, loyalty included, is unconfirmed).

Not in this slice: an append-only `forecast_predictions` table (fixed-horizon evaluation; additive migration; no backfill). Needs its own spec.

## 5. Build (Part 1, as built)

`src/lib/forecast-revenue.ts` (new); `src/app/forecast/page.tsx`; `src/components/ForecastPanel.tsx`; `src/app/insights/page.tsx`; `src/lib/forecast-chart.ts`; `src/lib/insights-story.ts`; `scripts/test-forecast-revenue.ts` (new); `scripts/test-forecast-comparison.ts` and `scripts/test-insights-story.ts` (expected wording); `package.json` (`test:forecast-revenue`).

## 6. Tests

- New `npm run test:forecast-revenue` (needs nothing), 20/20: the worked example takes the first saved day from today with customers and the stored revenue; stored revenue checks out as customers × average; no run, no day or no forecast gives no example; the note says the model predicts customers only, with the exact average; the column label; no screen file calls revenue "expected", "predicted" or "forecast"; the panel links to `/forecast#revenue`; the Forecast page holds the one explanation; the locked text is fixed; Insights no longer has its own card.
- `test:insights-story` 121/121, including three slice 24 checks: no slide calls the forecast's pesos expected, worth, predicted or a revenue forecast; the forecast figure is labelled "Estimated revenue"; the first slide says "estimated revenue".
- `test:forecast` 20/20, `test:forecast-comparison` 50/50, `test:theme` 87/87, `test:nav` 42/42, `test:approval-gate` 135/135; `npm run lint` and `tsc --noEmit` clean.
- No forecast calculation, stored row, ml-service file or route changed (see the diff: only wording, one pure helper and screens).

## 7. Manual test

1. As the owner, `/`: the forecast table's peso column reads "Est. revenue"; under it the two sentences with the exact average and "How the estimate works", which opens `/forecast` at the explanation.
2. `/forecast`: "How the revenue estimate is worked out" shows both sides, the worked example (its figures match the Dashboard's first day) and the three reasons.
3. `/insights`: the Calculations section has the link line instead of the forecast revenue card; Presentation mode's forecast slide says "Estimated revenue".
4. Signed out, `/forecast` shows the new locked text.

## 8. Implementation record (2026-11-16)

- Part 1 built as §3; automated tests as §6.
- Browser check of §7 (2026-11-16, the developer's Chrome with an owner session, nothing recorded or changed):
  - Step 1 Dashboard: **PASS**. Column "Est. revenue"; the two-sentence note with the exact average (₱220.49) and "How the estimate works", which opens `/forecast#revenue`; first day Mon Nov 16, 9.5 customers, ₱2,095.
  - Step 2 Forecast page: **PASS**. Both sides shown; worked example 9.5 × ₱220.49 = ₱2,095, matching the Dashboard's first day; the three reasons.
  - Step 3 Insights: **PASS**. The link line replaces the forecast revenue card; tooltips "estimated revenue"; Presentation mode slide 6 "Estimated revenue ₱16,052, Customers × ₱220.49". The slide 1 and slide 6 headline wording seen then ("₱16,052 expected", "worth around") was changed afterwards to "estimated revenue" (§3.5) and covered by `test:insights-story`; not re-checked in the browser.
  - Step 4 signed-out `/forecast`: **BLOCKED**. A fresh unapproved browser (headless Edge, empty profile) correctly shows the device approval screen (slice 19 §7), so the locked text is in the page sent but not displayed. Seeing it needs an approved browser without an owner session (Lock on an approved browser), which was not done to keep the developer's session.
- Final manual checks by the developer (2026-11-16, after the wording change):
  - Presentation mode shows the updated "estimated revenue" wording (§3.5): **PASS**.
  - Step 4, re-run on an approved browser after Lock (no owner session): `/forecast` shows the owner-only screen with "How the forecast is checked and how its revenue estimate is worked out. Owner only.": **PASS**. The earlier BLOCKED result (an unapproved profile shows the approval screen, as designed) is superseded.
- Part 1 functionally verified: §7 steps 1–4 PASS.
- Part 2 not built (blocked, §4).
- Limitations kept: revenue is calculated, not predicted; the average lags price changes until retraining; it does not reflect each day's service mix or discounts; no confidence intervals; no POS-based accuracy check.

<!-- END OF SPEC -->
