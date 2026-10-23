# Slice 12 — Pipeline guard, RMSE and a decision tree in the comparison, a forecast chart, remove test.txt

Repo: `ruzzco-system`. Status: **SPEC, not built (written 2026-10-23).** Items tagged [AI proposal] are not confirmed by Brent; everything marked (Brent) is.
Goal: close four small gaps before the Oct 25 retrain and the Oct 26 consult, without changing how the served forecast is chosen or computed.
Origin: the 2026-10-23 status review. Brent chose this scope on 2026-10-23: the pipeline guard, the future forecast chart, removing `test.txt`, RMSE added to the code (not cut from the paper), and the decision tree comparator added (not explained away). Security items H2, H3, M4 and H4 are not in this slice.

## 1. Scope boundary (read first)

- Part A (ml-service): one new data check, one new comparison method, one new error measure. The served model stays Random Forest on the four calendar inputs; `best_baseline`, `weeks_rf_won`, `rf_mae` and `best_baseline_mae` stay MAE-based and keep their current meaning.
- Part B (web): one chart added above the existing next-7-days table. Read-only. No schema change, no migration, no Dexie change; the table stays.
- Part C: delete `test.txt`; update `CLAUDE.md`.
- No retrain on new data in this slice. Do not copy `Ruzzco-OCT2025TOSOCTOBER162026.xlsx` (the Part B workbook) into `ml-service/data/`: its Day_Check sheet is being fixed by the Trio.
- No client sales figures in this spec, tests, fixtures, commit messages or screenshots committed to the repo. Tests use invented numbers.
- Not in this slice: retraining on Part B, the ₱250 price (waiting for the client), the loyalty discount, security items H2/H3/M4/H4, confidence intervals, forecasts longer than 7 days, per-barber or per-service forecasts.

## 2. Decisions ([AI proposal] unless marked Brent)

1. **Pipeline guard (Brent: in scope).** The logbook check must fail loudly when Entries has a date on or after `POST_GAP_START` that has no Day_Check row, whether or not the date is after `data_to`. Today the check stops at `data_to`, so Entries rows after the last "Has entries" day are dropped silently (found 2026-10-23: Oct 1–16 had Entries rows and no Day_Check rows). The existing "'Closed (written)' but has Entries rows" and "'No page found' but has Entries rows" checks also cover dates after `data_to`. Entries rows after `data_to` on a date marked "Not yet encoded" are allowed (example: a day photographed only until 6 PM); `train.py` prints one line saying how many such rows and dates were left out. [AI proposal] the wording of that line.
2. **RMSE next to MAE (Brent: add RMSE to the code).** For every method and every test week, compute RMSE = the square root of the mean of the squared errors, in customers per day, from the same guesses and the same scored days as MAE. MAE stays the main measure: it alone picks `best_baseline` and counts `weeks_rf_won`.
   - [AI proposal] The method's RMSE over the test is the mean of its weekly RMSEs, the same way its MAE is the mean of its weekly MAEs, so the two columns are read alike. Chapter 3 must say so in one sentence.
   - Saved in `comparison` as `rmse` (mean per method, 2 decimals) and per week as `weeks[].rmse`, next to the existing `mean`, `spread` and `weeks[].mae`. Also in `evaluation.json`. `metadata.evaluation` gains `rf_rmse` [AI proposal].
3. **Decision tree comparator (Brent: add it).** Method key `tree`: scikit-learn `DecisionTreeRegressor(random_state=42)` with default settings, on the same four calendar inputs, trained in `baseline_predictions` like `linear` and `gboost`. It joins `EVIDENCE_METHODS`: never `best_baseline`, never counted in `weeks_rf_won`, shown on `/forecast` under "Other models". This keeps the 2026-09-21 algorithm-lock promise of a single decision tree comparator.
   - Web label [AI proposal]: "Single decision tree". Description: "One decision tree on the same calendar features. Random Forest averages many of these. Shown for comparison only." Added to `COMPARISON_ONLY` and to the "Other models" group in `src/lib/forecast-comparison.ts`.
4. **RMSE on `/forecast` [AI proposal].** The method comparison shows RMSE as a second figure next to each method's MAE, labelled in plain words: "Typical miss (MAE)" and "Penalises big misses (RMSE)". A short line explains: "RMSE is larger when a method sometimes misses by a lot." The home panel is unchanged (Random Forest's MAE only). Runs saved before this slice have no RMSE or tree: show "—" for those cells and never fail.
5. **Future forecast chart (Brent: in scope; advisor's 2026-10-19 request to see the forecast into the future).** Above every existing next-7-days table (the home `ForecastPanel`; `/forecast` too if it lists the next days — confirm in the audit), a column chart of expected customers per day, one column per forecast day, oldest first. Reuse `src/components/ColumnChart.tsx` as it is (`unit: "count"`). [AI proposal] Column fields: `axisLabel` = short weekday ("Tue"); `label` = "Tue, Oct 27"; `value` = expected customers; `valueText` = one decimal ("11.4 customers"); `detail` = expected revenue in ₱ with two decimals. `summary` names the range and the busiest day. No `reference`, `callout` or `delay`. The table stays below, unchanged. The chart uses the same saved run as the table, so it also shows the saved forecast when the forecast service is offline. A day with `customers: null` is a zero-height column with valueText "—".
6. **Horizon stays 7 days** [AI proposal]. A longer horizon is out of scope.
7. **Remove `test.txt` (Brent, 2026-10-14: it should not stay on main).** Delete it after checking nothing references it.

## 3. What exists today (audit to repeat before building)

- `ml-service/pipeline.py`: `load_workbook` drops Day_Check rows without a valid date. `build_daily_table` sets `data_to` = the last "Has entries" date on or after `POST_GAP_START`; its "Entries date missing from Day_Check" check only sees Entries rows up to `data_to`. `SIMPLE_METHODS = ["average", "weekday", "last7", "naive"]`, `EVIDENCE_METHODS = ["linear", "gboost"]`, `METHODS` adds `random_forest` and `random_forest_last7`. `walk_forward` scores MAE per method per week, then `mean`, `spread` (stdev of weekly MAEs), `best_baseline` (simple methods only) and `weeks_rf_won`.
- `ml-service/train.py`: `comparison_summary` saves `basis`, `test_from`, `served`, `mean`, `spread` and `weeks[].mae` into `metadata.json`; `write_artifacts` also writes `evaluation.json` and `model.joblib`; `print_comparison` prints the weekly table with labels such as `Linear*` and `GBoost*`.
- `ml-service/tests/`: `test_pipeline_data.py`, `test_pipeline_evaluation.py`, `test_pipeline_forecast.py`, `test_pipeline_last7.py`, `test_app.py`, `helpers.py`.
- `web/src/lib/forecast-comparison.ts`: method labels and descriptions, the "Other models" group (`linear`, `gboost`), `COMPARISON_ONLY`.
- `web/src/components/MethodComparison.tsx` and `web/src/app/forecast/page.tsx`: the comparison and the "Week by week" table.
- `web/src/components/ForecastPanel.tsx`: "Next 7 days" as a table (Day, Customers, Revenue), offline notice with the saved run.
- `web/src/components/ColumnChart.tsx`: one value per column, tooltip, keyboard, "Show as table", screen-reader summary; used by `/insights`.
- `ForecastRun.comparison` is `Json?` in `prisma/schema.prisma`, so new fields need no migration.
- `test.txt` at the repo root.

## 4. Build: Part A (ml-service)

1. Guard (§2.1) in `build_daily_table`, with the problem messages naming the dates like the existing checks. The "Not yet encoded after `data_to`" count is returned or computed so `train.py` can print it.
2. `tree` in `baseline_predictions` and `EVIDENCE_METHODS` (§2.3).
3. RMSE in `walk_forward`: `weeks[].rmse` per method, top-level `rmse` (mean of weekly RMSEs) (§2.2). Nothing that reads `mean`, `spread`, `best_baseline` or `weeks_rf_won` changes.
4. `comparison_summary`, `evaluation_summary`/`weeks_summary` and `metadata.evaluation` carry the new fields; `print_comparison` prints an RMSE table after the MAE table, and `Tree*` beside `Linear*` and `GBoost*`.
5. `app.py`: whatever passes `comparison` through to Next passes the new fields unchanged.

## 5. Build: Part B (web)

1. `forecast-comparison.ts`: the `tree` label, description, group and `COMPARISON_ONLY` entry (§2.3).
2. `MethodComparison.tsx` and `/forecast`: RMSE beside MAE, "—" when absent (§2.4). The "Week by week" table stays MAE-only [AI proposal].
3. `ForecastPanel.tsx` (and `/forecast` if it lists the next days): the chart above the table (§2.5).

## 6. Build: Part C

1. Delete `test.txt` (§2.7).
2. `CLAUDE.md`: in the forecast rule, add that the comparison includes `tree` as an evidence method and reports RMSE next to MAE, with MAE alone choosing `best_baseline`; mention the guard in one clause. Keep it short.

## 7. Tests

- Guard: an Entries date after `data_to` with no Day_Check row fails, naming the date; an Entries date after `data_to` marked "Not yet encoded" passes and is not counted; "Closed (written)" with rows after `data_to` fails.
- RMSE: on a hand-made week with known errors (for example errors 1, 1, 4 → RMSE = sqrt(6) ≈ 2.45, MAE = 2), the weekly RMSE matches; RMSE ≥ MAE for every method and week.
- Tree: present in `METHODS` and in each week's `mae` and `rmse`; never `best_baseline`; not counted in `weeks_rf_won`.
- Existing evaluation tests still pass with `best_baseline` and `weeks_rf_won` unchanged on their fixtures.
- Web: the comparison renders a run without `rmse` or `tree` (old run) and a run with them; the chart renders 7 columns and a `null` day.

## 8. Done when

- `pytest` in `ml-service` passes; all web test suites, `npm run lint` and `npx tsc --noEmit` pass.
- `python train.py` runs on the current master workbook (`ml-service/data/Ruzzco-OCT2025TOSEPTEMBER2026.xlsx`) and prints the MAE table, the RMSE table and `Tree*`. Brent reads the output; no numbers from it go into tracked files.
- `/forecast` shows RMSE and the decision tree; the home panel shows the chart above the table; an old run still renders.
- `test.txt` is gone; `CLAUDE.md` is updated.
- Nothing committed: Brent reads `git diff`, then commits and pushes.

<!-- END OF SPEC -->
