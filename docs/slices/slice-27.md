# Slice 27 — Reports (Insights renamed) over a date range

Repo: `ruzzco-system`. Status: **BUILT (2026-11-16)**, automated suites green, desktop browser checks 1–6 done (§7). Uncommitted until approved. Branch `revision/preliminary`.
Provenance: **supporting improvement** (team interpretation; information architecture). Completes the recalled demo feedback PR-5's "ranges across the system" (register, verbal/recalled) for the analytics page; not a formal written panel item.
History: from the planning draft "slice 24 (draft) — Reports (Insights renamed)" (scratchpad, tentative number; 23–26 were taken).

## 1. Scope

- In: `/insights` becomes `/reports` (permanent redirect, old parameters ignored); the menu item "Reports"; the shared `DateRangeBar` (presets and Custom) with the range in the URL, default Last 7 days; one calculation path (`rangeFigures`) shared with the Dashboard, the ledger Summary, End-of-Day Cash and Sales; weekly chart columns beyond 62 dates; the Revenue and Average per sale calculations; a range-only Presentation mode.
- Removed from the page: the single-day "Dashboards" block; the drawer cash tape; the barber earnings and payout tape; the forecast chart, the forecast revenue card and the forecast evaluation (Reports links to Forecast instead).
- Unchanged: every figure's definition; the ledger Summary (advisor's request); payouts, commission, drawer and reconciliation calculations; the Dashboard's layout; slices 23–26 behaviour; the schema; every API route.
- Out: export; Sales URL filters; forecast vs POS comparison; prediction history; kept (localStorage) Reports settings.

## 2. Rule

No business rule changes. A range is slice 20's (`parseRange`, Manila business dates, both included, at most 366, `to` never after today). Only PAID sales count, each on its business day (`countsInRange`, `countedBusinessDate`); unreviewed flagged sales count nowhere and are shown as held. The previous period is the same number of dates ending the day before `from`. Revenue and paid sales are per sale; services are items (one per service in a sale) with their menu value from `serviceLines` (slice 23), not money collected.

## 3. Decisions (as built)

1. Route: `src/app/reports/{layout,page,ReportsRangeBar}.tsx`; `src/app/insights` removed; `next.config.ts` `redirects()` sends `/insights` (308) to `/reports`, query kept and ignored. `OWNER_PAGES` (`lib/approval-gate.ts`), the menu (`lib/owner-nav.ts`, Business: Sales, Reports, Forecast), the shell icon and the Dashboard's two links now name Reports.
2. Range in the URL: `?range=<preset>` or `?from&to` (Custom); none means Last 7 days. An invalid Custom range shows `parseRange`'s message and the last 7 days. Not kept in localStorage (deviation from the draft, which also kept it per browser).
3. Data: `lib/report.ts` `loadReport(range)` = `rangeFigures` for the range and for the previous period, `countHeldForReview`, barber names. `rangeFigures` gained an additive busy-hours count (`hours`, `hourExcluded`: a flagged sale's phone time is not trusted); no existing field changed. `lib/trends.ts` deleted; the Dashboard's 14-day fallback chart now reads `rangeFigures` (same figures).
4. Chart: `lib/report-chart.ts` `chartBuckets`: one column per date up to 62 dates; beyond, one per week, Monday to Sunday, the first and last weeks trimmed to the range, summed from the days. Presentation only; every total, average, change and best day uses the exact range.
5. Page sections: Summary (Revenue and Paid sales with change against the previous period, Average per sale, Average per open day, Best day, Busiest hour, Tips, Paid digitally); Trends (revenue per day or week, Busy hours, Revenue by barber with a Payouts link, Services sold (items) with menu value, Payment methods); Calculations (the Revenue tape by method and the Average per sale tape, kept on purpose); links to End-of-Day Cash, Payouts and Forecast.
6. Presentation mode: `buildReportStory` (`lib/insights-story.ts`): At a glance, the trend (weekly chart beyond 62 dates), When customers come, Barbers/services/payments, Needs attention (held sales, days without sales). No day block, no drawer or payout to-do, no forecast slide or wording. The header and dialog say "Reports". The old `buildStory` is unchanged (kept for its tests).
7. CLAUDE.md: the owner-only `/insights` clause now describes `/reports`.

## 4. Tests

- New `npm run test:report-chart` (needs nothing) **20/20**: Monday of a date (incl. month and year ends); 62 dates daily, 63 weekly; first and last weeks trimmed; full weeks Monday–Sunday; every date in one week; columns add up to the range's revenue (centavos) and sales; grouping leaves the days unchanged; 366 dates valid, 367 refused, a future `to` refused; 366 dates chart as weeks that still add up.
- New `npm run test:report-parity` (MySQL; synthetic June 1998 sales under a throwaway barber, deleted after) **23/23**: Reports = `rangeSummary` (Dashboard and Payouts) for revenue, paid sales, tips, methods and services (items and menu value); = `computeExpected` day by day (End-of-Day Cash); = `listSales` totals (Sales); revenue counts each sale once (a two-service loyalty sale once at ₱375); pending QR Ph and held sales left out, the reviewed one on its confirmed date; service items +1 each for a two-service sale, shave's menu value ₱250 not ₱500; an old loyalty haircut at its ₱250 list price; Manila boundary (23:59 vs 00:00); busy hours leave out flagged sales; the previous period equals `rangeFigures` over the 7 days before; days and chart columns add up to the total; a one-day range equals `rangeSummary`.
- `test:insights-story` **131/131** (+10: the Reports story's slides, no forecast or payout or drawer wording, date line, summary figures, same trend slide, a 90-day range charted by week with columns adding up).
- `test:nav` **54/54** (Reports in Business; `/insights` redirect in `next.config`; no `/insights` page; no owner screen links to `/insights`).
- `test:authz` **327/327** (`/reports` in the owner pages; `/insights` → 308 to `/reports`; the signed-out markers for `/reports`, and for `/forecast` corrected to its current text, which had made that check vacuous since slice 24).
- `test:forecast-revenue` 20/20 (Reports has no forecast revenue card or chart and links to `/forecast`), `test:approval-gate` 135, `test:theme` 87, `test:forecast-comparison` 50, `test:date-range` 106, `test:ledger-summary` 164, `test:sales-list` 49, `test:payout-history` 55, `test:reconciliation-history` 24; `npm run lint` and `tsc --noEmit` clean.

## 5. Changes to calculations

None. `rangeFigures` only gained the busy-hours count; every existing field and every payout, commission, drawer and reconciliation figure is unchanged (`test:ledger-summary`, `test:report-parity`).

## 6. Defect found and fixed during the build

`/reports` answered 500 for the owner: the server page called `rangeText`, exported from a client module (`DateRangeBar.tsx`). The page now has its own copy of the same format. Caught by `test:authz`.

## 7. Browser checks (desktop Chrome, owner session, read only)

1. Default: `/reports` opens on Last 7 days (Nov 10–16), compared with Nov 3–9. PASS.
2. Custom: `?from=2026-11-01&to=2026-11-12` selects Custom, 12 dates, previous Oct 20–31. PASS (via the URL the Custom button produces; the Apply button itself is the shared DateRangeBar, tested in slice 22).
3. Jul 1–Nov 16 (139 dates): "Revenue per week", columns from Jul 1, the Monday–Sunday note. PASS.
4. Presentation mode: 5 slides (At a glance, Last 139 days, When customers come, Barbers/services/payments, Needs attention), no forecast slide, figures as on the page; header "Reports · {range} · N days" (after renaming the leftover "Insights" labels). PASS.
5. Calculations: Revenue (Cash + GCash + Maya + QR Ph = ₱30,323.46) and Average per sale (₱30,323.46 ÷ 129 = ₱235.07). PASS.
6. Navigation: Reports highlighted under Business; `/insights` lands on `/reports`. PASS.

Not checked in a browser: phone width (same building blocks as before; `test:nav` covers the menu).

## 8. Limitations

- The Reports range is in the URL only, not kept per browser.
- Services are counted as items and valued at menu price; a custom amount counts under its service.
- The previous-period comparison may cover days before the POS was in use (shown as "up from nothing").
- Busy hours leave out flagged sales.
- At most 366 dates.

## 9. Manuscript impact

- Outdated: Table 1 "Insights page" row (PDF p. 33); Figure 4 process 7.0 "Insights" (p. 35); Project Development "Insights page with dashboards, trends, calculations" (p. 51); Operation and Testing "Viewing Summaries and Insights" (p. 64); Table 8 "Insights story" (p. 66).
- Update: Table 1 (Reports over a date range: trends, busy hours, services as items and menu value, Revenue and Average per sale explained); Figure 4 (rename 7.0); Table 7 (one row; reason: one calculation path and ranges across the analytics page, team decision answering recalled PR-5); Table 8 (`test:report-chart`, `test:report-parity`, `test:insights-story`).
- Evidence before writing it as implemented: the commit; the suites in §4 green; §7 done. Screenshots of the old Insights page must be retaken.
- Keep explicit: §8.

<!-- END OF SPEC -->
