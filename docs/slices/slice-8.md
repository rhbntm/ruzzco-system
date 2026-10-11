# Slice 8 — Last-7 average as a Random Forest input, and three more comparison methods

Repo: `ruzzco-system`, branch `main`. Status: **step 1 built** (commit `cad393e`); step 2 waits for Brent's choice after the test weeks exist. Items tagged [AI proposal] are not confirmed by Brent.
Goal: test whether giving Random Forest the recent level of the shop (the last-7 average) lets it beat the simple methods, judged only on weeks the design never saw. Add the naive forecast as a simple method, and linear regression and gradient boosting as evidence for Chapter 3 and the defense (Brent, 2026-10-09 and 2026-10-11). Python only: `ml-service/` plus one label in the dashboard.

## 1. Scope boundary (read first)

- Builds on slice 7. All slice 7 decisions stand unless §2 changes them. Random Forest stays the title model; default settings, `random_state=42`, no tuning (slice 7 Decision 6).
- Same data rules: post-gap logbook only, never POS transactions, logbook and artifacts never committed. **No client sales figures** (counts, averages, MAEs, row counts) in this spec, in tests, in fixtures or in commit messages. Tests use synthetic series.
- Not in this slice: tuning, other lag or rolling inputs, one-hot or other feature engineering for the comparison methods, per-barber or per-service forecasts, confidence intervals, scheduled retraining, Chapter 3 text, any change to the Prisma schema or to what `/forecast` returns except the metadata fields in §6.
- Read by Brent line by line: same code style as slice 7 §5 (plain functions, docstrings citing the decision).

## 2. Decisions

1. **Last-7 input.** New feature `last7_mean`: the mean customers of the last 7 open days known when the forecast is made. It has the same value for every one of the 7 forecast days (Brent, 2026-10-09). It is the only lag-type input; slice 7 §1's "no lag or rolling inputs" is replaced by this one exception.
2. **How training rows get the feature (Brent, 2026-10-11).** A forecast is always made once, at an origin, for the next 7 days, and always starts the day after `data_to`. Training rows must look the same, or the model learns a feature it will never see. So the training calendar is cut into blocks of 7 calendar days, laid back from the end of the training range (the last block ends on the last training date, matching a forecast that starts the next day). Every row in a block gets the mean of the last 7 open days before that block's first date. Rows of the earliest blocks, where fewer than 7 open days precede the block, are left out of training for this model only. Closed and unknown days never count toward the 7. Rejected alternatives: Mon–Sun calendar weeks (they cut the last block short on most retrains and do not match where forecasts start); a rolling value for each day as of the day before (at forecast time day 7 would be a guess 7 days past the data, which the model never trained on).
3. **Judged only after Sep 25; cap of 4 (Brent, 2026-10-11).** The feature was chosen after seeing results on the earlier weeks, so those weeks cannot test it. Test blocks must start on or after `TEST_FROM = 2026-09-26` (Part B rows are the first clean test data). The test uses every full 7-day block that fits between `TEST_FROM` and `data_to`, at most 4, counted from the end. The cap stays at 4: there will be about 3 test weeks at most before the defense anyway. If none fits yet, the section prints "No full test week after 2026-09-25 yet" and nothing is claimed.
4. **Reference table kept.** The slice 7 evaluation (the last 4 blocks ending on `data_to`, whatever their dates) is still printed, labeled "Reference, not the test", with all the methods, so numbers stay comparable with earlier retrains. It never feeds `weeks_rf_won`, `best_baseline` or the dashboard, except as the fallback in §2.7.
5. **Methods compared.** On the test blocks, each trained or computed only from open days before the block, scored only on the block's open days, MAE in customers per day:
   - Simple methods: `average`, `weekday`, `last7` (unchanged from slice 7) and `naive`: the customers of the last open day before the block, repeated for all 7 days.
   - Evidence methods: `linear`, scikit-learn `LinearRegression` on the four calendar inputs, with `dow` as a plain number (a known weakness, left as is, Brent 2026-10-11; no feature engineering in this slice); and `gboost`, `GradientBoostingRegressor(random_state=42)`, default settings, on the four calendar inputs.
   - Random Forests: `random_forest`, the slice 7 model on the four calendar inputs; and `random_forest_last7`, the same model with `last7_mean` as a fifth input (§2.1, §2.2).
   `linear` and `gboost` use the four calendar inputs only, so the comparison with `random_forest` shows the model type, and `random_forest` against `random_forest_last7` shows the new input.
   **What each group is for.** The dashboard claim is "beats the simple methods" (`average`, `weekday`, `last7`, `naive`). `linear` and `gboost` answer "why Random Forest", which belongs in Chapter 3 and the defense, not on the dashboard. They stay in `walk_forward`, both tables in `train.py` and `evaluation.json`, but never become `best_baseline` and never count in `weeks_rf_won`.
6. **Which model is served** [AI proposal]. Slice 7's Random Forest stays served until Brent chooses. The default is `random_forest`; `train.py --serve random_forest_last7` (step 2) serves the new variant. Brent chooses after he reads the test table from step 1, and writes the reason in `../ruzzco-barbers/20_Decisions/`. No rule in code picks the winner.
7. **`best_baseline` and `weeks_rf_won`.** `best_baseline` is the simple method (`average`, `weekday`, `last7`, `naive`) with the lowest mean test MAE. `weeks_rf_won` counts test blocks where the served variant's MAE is below that method's. `weeks_tested` is the number of test blocks. When no test block exists, these fields come from the reference blocks and `evaluation.basis = "reference"` (otherwise `"test"`). This applies from step 1, using the default served variant `random_forest`.
8. **A stale `last7_value` is a limitation (Brent, 2026-10-11).** `last7_value` is fixed at training time. A forecast asked for long after `data_to` reuses it. This is stated as a limitation (Chapter 3), and nothing is built for it: no warning, no extra field.

## 3. `pipeline.py` changes

- `SIMPLE_METHODS = ["average", "weekday", "last7", "naive"]`; `EVIDENCE_METHODS = ["linear", "gboost"]`; `METHODS = SIMPLE_METHODS + EVIDENCE_METHODS + ["random_forest", "random_forest_last7"]`. `BASELINES` becomes `SIMPLE_METHODS` wherever it picked the best baseline.
- `FEATURES` unchanged (the four calendar inputs). New `FEATURES_LAST7 = FEATURES + ["last7_mean"]`.
- `calendar_features(dates)` still builds only the four calendar inputs. New `add_last7_mean(daily, block_end)`: fills `last7_mean` per §2.2 on the training rows and returns the rows that have it. One function, one place, used by training, walk-forward and (step 2) the final model.
- `last7_at(daily, before)`: the mean of the last 7 open days strictly before `before`; the single definition used for the block value in training and for the forecast value. Fails loudly if fewer than 7 open days exist.
- `baseline_predictions(train, dates)` gains `naive`, `linear`, `gboost`. `naive` needs the last open day's customers, so it comes from `train`, sorted by date.
- `walk_forward(daily, weeks=4, block_days=7, test_from=None)`: with `test_from`, uses only blocks starting on or after it (§2.3); without, behaves as in slice 7 (the reference). Returns the same shape plus the new methods. `best_baseline` and `weeks_rf_won` follow §2.7. `spread` as before, for every method.
- Step 2 only: `train_final_model(daily, variant)` with `variant` in `random_forest` or `random_forest_last7`; for the last-7 variant it also returns `last7_value` (`last7_at(daily, data_to + 1 day)`) and its as-of date `data_to`. `forecast(model, start, days, avg_ticket, last7_value=None)`: for the last-7 variant, adds the column `last7_mean = last7_value` for every day and uses `FEATURES_LAST7`; raises if the model needs the value and it is missing.

## 4. `train.py` changes

Step 1:
- Prints the summary as before, then two tables: "Reference, not the test" (`walk_forward(daily)`) and "Test: weeks starting 2026-09-26 or later" (`walk_forward(daily, test_from=TEST_FROM)`). Columns: one per method, weeks as rows, then Mean and Spread (SD of weeks). Order: simple methods, then `linear` and `gboost` (marked as evidence), then the two Random Forests. Print in two column groups if the terminal is too narrow.
- Prints "Random Forest + last-7 beats the best simple method (…) in N of M test weeks." and the same line for plain Random Forest. The typical-error line uses the default served variant, as slice 7.
- `evaluation.json` gains `reference` and `test` sections (same shape as slice 7's file, per-week MAE for every method). Top-level fields stay as slice 7 so nothing reading them breaks; they follow §2.7, and `basis` is added to them. Step 1 does not retrain the served model and does not change `model.joblib`: as built, `train.py --evaluate-only` prints both tables and writes only `evaluation.json` (a plain run still retrains and rewrites the model and metadata).

Step 2 only:
- `--serve {random_forest,random_forest_last7}`, default `random_forest`; `evaluation.json` gains `served`.

## 5. `app.py` and the dashboard

- `ForecastPanel.tsx` `BASELINE_NAMES` gains one label, in the same plain wording as the existing ones: `naive` → "the last open day's count" (not "yesterday's count", which is wrong after a closed day). No labels for `linear` or `gboost`: they can never be `best_baseline`. Unknown names already fall back to the raw name. This is a one-line change and belongs to step 1 (it must ship with `naive` entering `best_baseline`).
- Step 2 only: `app.py` reads `last7_value` from the metadata and passes it to `pipeline.forecast`. No new endpoint or parameter. A model trained without the last-7 input still loads and works (artifacts from slice 7 stay valid).
- The `/forecast` response is unchanged, so `forecast.ts` and the Prisma schema are unchanged.

## 6. Metadata (`metadata.json`)

Step 1: `evaluation.basis` (`"test"` or `"reference"`) and `test_from`; `evaluation.best_baseline` and the other evaluation fields follow §2.7. Step 2 only: `variant`, `features` (the list actually used), `last7_value` and `last7_as_of` (null for the calendar-only variant). The rest as slice 7 §7. Per §2.8, no stale warning.

## 7. Tests (pytest, synthetic series only)

- `last7_at`: with a known series, equals the mean of the last 7 open days before the date; closed and unknown days are skipped; fewer than 7 open days raises.
- `add_last7_mean`: all rows of a block share one value; the value uses only dates before the block; the earliest rows without 7 prior open days are dropped; no row's value uses a date on or after its own block; blocks end on the last training date.
- A series built so that each block's level is the previous block's level: `random_forest_last7` beats `random_forest` on the test blocks. A flat series: all methods have MAE 0, including `naive`, `linear` and `gboost`.
- `naive` equals the last open day before the block, even after a closed day.
- `walk_forward(test_from=…)`: every block starts on or after `test_from`; at most 4 blocks; zero blocks returns an empty test (no crash); without `test_from` the result equals slice 7's.
- `best_baseline` is always one of `average`, `weekday`, `last7`, `naive`: on a series where `linear` or `gboost` has the lowest mean MAE, it is still not chosen, and `weeks_rf_won` is computed against the best simple method, not against them. `linear` and `gboost` still appear with their MAE in every week of the result. `basis` is `reference` when no test block exists.
- Step 2 only: `forecast` with the last-7 variant: 7 rows, one `last7_mean` value, customers ≥ 0, revenue = customers × ticket; without `last7_value` it raises. A slice 7 model without the input still forecasts. API: artifacts of each variant load; `/forecast` answers 7 rows for both.
- All existing suites unchanged (`pytest`, `test:forecast-parse`, `test:forecast`), plus `npm run lint` and `npx tsc --noEmit`.

## 8. Steps (one per session)

1. `last7_at`, `add_last7_mean`, the new methods and `random_forest_last7` in `walk_forward`, with tests. `train.py` prints both tables and writes `evaluation.json` and the §6 step 1 fields; the `naive` label in `ForecastPanel.tsx`. **Stop and show the tables.** Do not retrain the served model.
2. **Runs only if Brent chooses to serve `random_forest_last7` after reading the step 1 tables.** `--serve`, `train_final_model`, `forecast`, the step 2 metadata fields, `app.py`, API tests. If Brent keeps plain `random_forest`, step 2 is skipped and `--serve` and those metadata changes are left unbuilt.
3. Wrap-up (§10).

Order against the data: step 1 can be built and tested on synthetic data now. The real test blocks exist only once the Part B rows (Sep 26 onward) are in the workbook (Trio, due Oct 18). Until then the test section prints "No full test week yet" and only the reference table has numbers.

## 9. Open questions

- Q5: What the paper claims if nothing beats the simple methods. Not decided in code; for the Monday consult with Quiza (Open items, "How to frame a Random Forest that does worse than the simple averages").

## 10. Wrap-up

- `CLAUDE.md`: add the `last7_mean` exception to the Forecast invariant (it says features come only from the calendar), and `--serve` to the `train.py` command only if step 2 ran; update the Known gaps bullet about Random Forest not beating the average once the test table exists.
- `../ruzzco-barbers/20_Decisions/`: one record with §2 and the test result, naming which variant is served and why (including the case where step 2 was skipped).
- `docs/slices/slice-7.md` is not edited; this spec states what it replaces.
- `docs/sessions/` log per CLAUDE.md.

<!-- END OF SPEC -->
