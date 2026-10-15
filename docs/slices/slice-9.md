# Slice 9 — Method comparison on the owner's forecast panel

Repo: `ruzzco-system`, branch `main`. Status: **the first version (the grouped method lists on the home panel) is approved, built, and manually tested by Brent on 2026-10-12; it is the version demoed at the 2026-10-19 consult. The amendment (a simple home panel plus a separate `/forecast` report page, §2.10 to §2.15 and the sections marked "amendment") is a DRAFT ON HOLD and was moved into slice 10 Part B on 2026-10-14 (the home panel there shows only the Random Forest prediction). It is not built until after the 2026-10-19 consult, once the advisor has answered how to frame a Random Forest that trails the simple methods and what the dashboard must show, and until Brent says "run slice 9 amendment".** Items tagged [AI proposal] are not confirmed unless noted.
Goal (first version): under the 7-day forecast, the owner sees how Random Forest compares with the simple methods and with other machine-learning models such as linear regression, in plain words. The comparison is saved with every forecast run, so it still shows when the forecast service is down. Goal (amendment, on hold): the home page gives the owner only a plain answer to "can I trust this forecast?", and a separate owner-only report page holds the full comparison for the advisor and the demo.
Origin: the 2026-10-12 advisor consult asked to see, on the forecast, how Random Forest performed against the baselines and models such as linear regression (record: `../ruzzco-barbers/20_Decisions/2026-10-12-advisor-consult-ch3-and-system-requests.md`, request 4).

## 1. Scope boundary (read first)

- Display and storage only. No change to how the model is trained, tested or served, and no change to the training data. Slice 8 step 2 (which variant is served) is not part of this slice.
- The owner PIN rules are unchanged: the comparison appears where the forecast does (the panel on `/`, the `/api/v1/forecast` routes) and nowhere else.
- The `/forecast` response of `ml-service` and the `/api/v1/forecast` responses stay compatible: new fields are optional and old clients and old saved runs keep working.
- **No client sales figures** (errors, averages, spreads, row counts) in this spec, in tests, fixtures or commit messages. Tests use synthetic series and invented numbers.
- Not in this slice: showing the comparison anywhere other than the forecast panel, confidence intervals, changing `best_baseline` or `weeks_rf_won`, and each method's own forecast for the coming 7 days (a possible later slice; it cannot be judged until those days have passed and needs every method saved in the service).

## 2. Decisions

1. **This slice amends slice 8 §2.5.** Linear regression and gradient boosting (`linear`, `gboost`) may now appear on the panel (advisor request, 2026-10-12). They still never become `best_baseline` and never count in `weeks_rf_won`. Everything else in slice 8 stands. The one-line pointer in slice 8 §2.5 is already in place.
2. **Method groups, in this order:** simple methods (`average`, `weekday`, `last7`, `naive`), other models (`linear`, `gboost`), Random Forest (`random_forest`, plus `random_forest_last7` when the saved comparison contains it). In the first version the groups title the lists on the home panel; in the amendment they label the columns of the full table on `/forecast`.
3. **What is shown per method:** its mean error in customers per day. The first version also shows its spread (standard deviation of its weekly errors, "week-to-week swing"). In the amendment the spread and each week's error move to the full table on `/forecast`.
4. **The served model is highlighted** and marked "Used for this forecast". The saved comparison records which method is served; the panel does not assume it.
5. **The weeks the numbers use are always named**, from the saved `basis`: `test`: "Test weeks from <test_from>"; `reference`: "Reference weeks: already seen when the inputs were chosen, so not evidence". Brent chose to show the table while only reference weeks exist (2026-10-12).
6. **The result uses the run's existing numbers** (`typicalErrorCustomers`, `bestBaseline`, `bestBaselineError`, `weeksRfWon`, `weeksTested`), so it matches the sentence the panel already shows. It is about the served Random Forest only.
7. **The comparison is produced once, by `train.py`, and saved inside `metadata.json`** next to the model it describes. [AI proposal, confirmed by approval] `evaluation.json` can be rewritten by `--evaluate-only` after the served model was trained, so reading it at request time could show numbers that do not belong to the model on screen.
8. **Saved with each run.** `ml-service` returns the comparison in `/forecast`; Next.js stores it on the `ForecastRun` row (`comparison`, nullable JSON, migration `20261012120000_forecast_run_comparison`, already applied). The panel reads the saved run, so offline behaviour is the same as for the forecast.
9. **Plain words, lower is better.** No MAE, baseline, walk-forward or SD in the owner's view.

**Decisions 10 to 15 belong to the amendment (draft, on hold; see the status line).**

10. **Amendment 1, layers (Brent, 2026-10-12):** a business owner must not be overwhelmed. Amendment 2 (below) puts the layers on two pages.
11. **Amendment 2, two places (Brent's idea, 2026-10-12):** the home page keeps a **simple view**; a new owner-only page at **`/forecast`** is the **detailed report** and the demoable comparison. The home panel no longer shows the method lists or table of the first version.
12. **Home panel (simple, always visible):** one plain verdict sentence built from the run's numbers, for example "The forecast is usually off by about N customers a day. Guessing <the best simple method> is off by about M. The forecast did better in K of W weeks." (N, M, K and W are placeholders filled from the run's saved numbers; this spec contains no real results), the basis line of §2.5, and one link, "See how it compares with other methods". No bars, no table, no method names beyond the best simple method.
13. **`/forecast` report page (detailed):** owner PIN only, same rules as the panel; without the owner cookie it shows the locked card and no numbers. It reads the saved run from the database only (never calls the ml-service), so it works while the service is down. Sections, top to bottom:
    - **Verdict and basis line** (same sentence as the home panel), and "Saved with the forecast on <date>".
    - **Ranked bars:** all eight methods sorted from smallest error to largest, one horizontal bar each, bar length proportional to the error, the number at the end, "A shorter bar is better." once. The served bar is highlighted and marked "Used for this forecast". Plain CSS, no chart library.
    - **Full table** (always expanded here): the table `train.py` prints: methods as columns in the §2.2 groups, one row per test week (date range only), then a **Mean** row and a **Week-to-week swing** row. The other models are marked "for comparison only". Per-week errors are saved for this (§4); the per-week day counts printed by `train.py` are not saved or shown.
    - **About the methods:** one plain line per method (what it does), so the advisor and the owner can read the table. [AI proposal] Wording in §7.
    - **The model behind the forecast:** model version, the logbook date range it was trained on, and the number of open days, from the run (already saved). No sales figures.
14. **Navigation:** the home panel links to `/forecast`; `/forecast` links back to the home page. [AI proposal] `/forecast` is also added to the home page's list of destinations (owner-only items are listed the same way as `/ledger`).
15. **Owner-only list:** `/forecast` is added to the owner-only pages in the CLAUDE.md invariant at wrap-up. The route name does not clash with `/api/v1/forecast`.

## 3. What exists today (audit, 2026-10-12, after the first build)

- `ml-service/pipeline.py`: `walk_forward` scores eight methods and returns per-week MAEs, a mean and a spread for each.
- `ml-service/train.py`: `comparison_summary(evaluation, basis, served)` builds `{basis, test_from, served, mean, spread}` and `write_artifacts` saves it as `metadata["comparison"]`. `app.py` returns it from `/forecast` when present.
- `web/src/lib/forecast.ts` validates and saves it (`ForecastRun.comparison`); `forecast-comparison.ts` builds a grouped view; `ForecastPanel.tsx` shows "How the methods compare" as three grouped lists. Per-week errors are not saved.
- The served model is unchanged (`random_forest`); the saved comparison currently uses reference weeks.

## 4. `ml-service` changes (amendment, on hold)

- `comparison_summary` adds `weeks`: a list, oldest first, of `{ "start", "end", "mae": {method: float} }` from the chosen evaluation, errors rounded to 2 decimals, no day counts. `mean`, `spread`, `basis`, `test_from` and `served` stay as they are.
- `app.py` needs no change: it passes the saved comparison through.
- After building, one normal `train.py` run on the unchanged workbook rewrites `metadata.json` with `weeks`. [AI proposal] As on the first build, the check is that `model_version` and the model file hash are identical to before, so the served model is unchanged. Brent runs or approves it.

## 5. Schema

No change. `ForecastRun.comparison` already holds JSON; `weeks` goes inside it. Runs saved before the amendment have no `weeks`, and the panel shows the bars from their `mean` and, in the details, "Weekly detail was not saved with this forecast."

## 6. Next.js changes (amendment, on hold)

- `src/lib/forecast.ts`: `comparisonSchema` gains an optional `weeks` array (`start`, `end` as dates, `mae` as a record of non-negative numbers). Everything stays optional at the response level.
- `src/lib/forecast-comparison.ts`: `buildComparisonView(run)` returns the data for the report page: the sorted bars (method, plain name, error, served flag, relative length 0 to 1), the full table (column groups, week rows, mean row, swing row) or `null` for it when no weeks were saved, the basis line, and the verdict sentence. Sorting is by error, ties by the fixed §2.2 order. Unknown method keys are ignored. The verdict is built here so both pages use one sentence and it can be tested.
- New page `src/app/forecast/page.tsx`: a server component like `src/app/page.tsx`: checks the owner cookie, loads the latest run with `latestForecast()`, and renders the report or the locked card. New client component for the report (`src/components/ForecastReport.tsx`); the unlock card is reused from `ForecastPanel.tsx`.
- No new API route. No schema change.

## 7. Screens

### 7a. First version (built, manually tested 2026-10-12)

Under the existing forecast text on the home panel, owner-only, a section "How the methods compare":
- An intro that says each method guessed the customers per day on weeks it had not seen, that the number is how far off it was on average, and that **lower is better**; "week-to-week swing" is explained once.
- The basis line (§2.5), then three groups titled "Simple guesses", "Other models" and "Random Forest". Each row has the plain method name, "Off by (customers a day)" and "Week-to-week swing". On a phone the rows stack.
- The served row is highlighted and marked "Used for this forecast".
- The result sentence (§2.6) and the caption "Saved with the forecast on <date>".
- A run with no saved comparison shows "No comparison was saved with this forecast. Press Refresh forecast once the forecast service has been retrained."

### 7b. Amendment (draft, on hold)

**Home panel (`ForecastPanel.tsx`)**: the first version's "How the methods compare" section is removed and replaced by the verdict sentence, the basis line and the link (§2.12). The rest of the panel stays.

**`/forecast` report**: heading "How good is this forecast?" and the sections of §2.13. Draft wording (final copy may change without a new spec):
- Intro under the bars: "Each method guessed how many customers came on each day of weeks it had not seen. The bar is how far off it was, on average, in customers per day."
- Table notes: "Week-to-week swing is how much a method's error changed from one week to the next; smaller means steadier." and "Other models are shown for comparison only. They never count as the best simple method."
- About the methods: Plain average: "the average of every open day in the logbook". Average for that weekday: "the average of the same weekday". Average of the last 7 open days: "how busy the last week was". Repeat the last open day's count: "yesterday's number again". Straight-line model: "a model that draws one straight line through the calendar inputs". Gradient boosting: "many small decision trees added up one after another". Random Forest: "many decision trees voting on calendar inputs: weekday, weekend, day of the month, days since payday". Random Forest + last-7 input: "the same, plus how busy the last week was".
- On a phone the full table keeps the method names fixed on the left and scrolls sideways.
- A run with no saved comparison shows "No comparison was saved with this forecast. Open the home page and press Refresh forecast once the forecast service has been retrained." A run without `weeks` shows the bars and "Weekly detail was not saved with this forecast." in place of the table.

## 8. Tests

The first version's tests are built and passing. The items about `weeks`, bars, the table, the verdict and `/forecast` belong to the amendment.

- `pytest` (synthetic data): `comparison_summary` includes `weeks` with the chosen weeks oldest first, errors rounded to 2 decimals, every method present, no day counts; the test weeks are used when any exist, otherwise the reference weeks; `/forecast` returns `weeks`; metadata without `weeks` still serves.
- `test:forecast-parse`: a comparison with valid `weeks` passes; without `weeks` passes; a negative weekly error, a non-numeric one and a bad date are rejected.
- `test:forecast-comparison` (invented numbers): bars are sorted by error with ties in the fixed order; the served bar is flagged; relative lengths are between 0 and 1 and the longest is 1; the table has one row per week plus Mean and Swing in the §2.2 column groups; `random_forest_last7` is omitted when absent; unknown keys are ignored; a run without `weeks` has bars but `table: null`; a missing or malformed comparison gives `null`; the verdict sentence uses the run's numbers and the right basis line, and is the same for both pages.
- `test:forecast` (integration): the saved run's comparison includes `weeks` after a refresh against a retrained service. Page access without the owner cookie is checked with an HTTP request: `/forecast` returns the locked page with no comparison text (no PIN is read).
- All existing suites unchanged, plus `npm run lint` and `npx tsc --noEmit`.

## 9. Steps

1. Done (first version): `comparison_summary` and `/forecast` field, migration, schema checks, grouped lists on the home panel.
2. Amendment step A (on hold): `weeks` in `comparison_summary`, the `forecast.ts` schema, `forecast-comparison.ts` (bars, table, verdict), tests. Then one normal `train.py` run on the unchanged workbook and a service restart.
3. Amendment step B (on hold): simplify the home panel; add the `/forecast` page, `ForecastReport` and the links; the integration and HTTP checks; manual check.

Steps 2 and 3 start only on Brent's "run slice 9 amendment", after the 2026-10-19 consult.

## 10. Manual check

**First version (done by Brent, 2026-10-12):**
1. Unlock the owner view on `/`. Under the forecast, "How the methods compare" lists the three groups, states that lower is better, shows the basis line, and highlights the served row.
2. The result sentence names the same best simple method and the same number of weeks as the sentence above it.
3. Stop the forecast service and reload: the section is still there with the saved date, plus the offline banner.
4. Without the owner PIN: the locked card only, no numbers.

**Amendment (when built):**
1. Unlock the owner view on `/`. The forecast panel shows the days, a one-sentence verdict, the basis line and a link "See how it compares with other methods". No bars or tables on the home page.
2. Open the link: `/forecast` shows the same verdict, eight ranked bars with Random Forest highlighted, the full table (weeks, Mean, Week-to-week swing), the method descriptions and the model details. "Back" returns to the home page.
3. Stop the forecast service and reload `/forecast`: everything is still there with the saved date.
4. Without the owner PIN: `/forecast` shows only the locked card, and the home page shows the locked forecast card.

## 11. Open questions

- **Q4:** whether `/forecast` also gets a button on the home page's destinations list, next to Ledger (the spec proposes yes, §2.14).
- **Q5:** wording of the verdict, the method descriptions and the labels is a draft; Brent may change it after seeing the pages.
- **Q6 (for the 2026-10-19 consult):** on the reference weeks, Random Forest ranks below the simple averages and linear regression. Should the full ranking show on the dashboard, or only in Chapter 4? The answer decides whether the amendment is built as drafted, built with a shorter list on the dashboard, or dropped.

## 12. Wrap-up

- `CLAUDE.md`: the forecast invariant already mentions the saved comparison; add that per-week errors are saved with it, that the detail lives on the owner-only `/forecast` page, and add `/forecast` to the owner-only list.
- `docs/slices/slice-8.md` §2.5 already points here.
- `../ruzzco-barbers/20_Decisions/`: a record of the change to slice 8 §2.5 and of the layered display, if Brent wants one.
- `docs/sessions/` log per CLAUDE.md.

<!-- END OF SPEC -->
