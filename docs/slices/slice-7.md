# Slice 7 — Forecasting layer: logbook to model to owner dashboard

Repo: `ruzzco-system`, branch `main`. Approved 2026-10-08.
Goal: a Python service trains a Random Forest on the post-gap logbook, scores it against three simple averages week by week, and serves a 7-day forecast (customers and pesos). Next.js saves each forecast to MySQL and shows it to the owner, with the model's typical error stated plainly. The saved forecast still shows when the Python service is down.

## 1. Scope boundary (read first)

- Trains only on the paper logbook from 2026-07-13 onward (post-gap; advisor guidance 2026-10-05). The pre-gap logbook and the Dec–Feb dataset are not used.
- Never reads POS transactions. The 2026-09-20 rule that the model must not train on unverified POS data still stands.
- Not in this slice: hyperparameter tuning, lag or rolling inputs, a model of which service customers buy, per-barber forecasts, confidence intervals (the existing bound columns stay null), scheduled retraining, synthetic data, the ledger, PWA work.
- Features are built in Python only. Next.js never computes a feature; it asks for a start date and a number of days.
- This code will be read line by line by Brent afterwards to understand the model. Write it for that reader (see §5).

## 2. Decisions (confirmed 2026-10-08, see `Ruzzco_ML_decisions_2026-10-08.xlsx`)

1. **Closed vs no page.** "Closed (written)" = 0 customers. "No page found" = blank (missing, never 0). Train on open days only. Closed days stay 0 in the daily table so totals are honest.
2. **How it's tested.** Walk-forward over the last 4 blocks of 7 calendar days ending on the last data date. Each block trains only on open days before the block starts. Only open days are scored. Report each block and the mean.
3. **Compared against.** Three baselines scored exactly the same way: overall average, weekday average (falls back to the overall average if a weekday has no training rows), last-7 average (mean of the last 7 open days before the block).
4. **Inputs.** `dow` (0 = Mon … 6 = Sun), `is_weekend`, `day_of_month`, `days_since_payday`. Paydays are the 15th and the 30th; in February, the 15th and the last day of the month. The payday rule is an assumption, stated in the metadata. No lag or rolling inputs: they can't be filled for future dates, and lag-1 correlation in the post-gap data is 0.0.
5. **Revenue.** Forecast revenue = forecast customers × average amount per customer. The average is computed on every training run from post-gap Entries rows that have an amount (blank amounts are excluded from both the sum and the count) and stored in the metadata. Never hardcode the list price or a past average.
6. **If Random Forest doesn't beat the averages.** Keep Random Forest. Default settings, `random_state=42`, no tuning (tuning on the test weeks would make the test meaningless). The dashboard always shows the model's error next to the best baseline's error. How the paper frames a tie is settled with the advisor, not in code.

## 3. Data location (decided) and one open item

- **O1, decided 2026-10-08: the logbook stays out of git.** Brent created `ml-service/data/` and the root `.gitignore` line `ml-service/data/` ignores it (checked with `git check-ignore`). Brent copies the latest workbook there by hand. No client sales data goes to GitHub until Mart agrees. Never commit, log or print rows from it.
- **O2, open, decide before step 7: where the owner sees the forecast.** [AI proposal] The home page `/` shows the forecast panel at the top when the owner cookie is present, and a locked "Forecast · Owner PIN" card otherwise (same pattern as Ledger). Alternative: a separate owner page `/forecast`, first card on the home page. Ask Brent before step 7; don't pick.

## 4. Data input

- Source: the only `.xlsx` file in `ml-service/data/`. `train.py --logbook PATH` overrides; with no flag it fails if there are zero or several `.xlsx` files, so a renamed workbook needs no code change. Sheets `Entries` (columns `Date`, `Service`, `Amount (PHP)`) and `Day_Check` (columns `Date`, `Status`). Read the workbook directly.
- Never read `ruzzco_daily_postgap.csv`, which also sits in `ml-service/data/`. It was built from an older workbook and disagrees with the current one.
- Range: from `POST_GAP_START = 2026-07-13` to `data_to`, the last date whose status is "Has entries".
- Status mapping: "Has entries" → open; "Closed (written)" → closed; "No page found" → unknown. Day_Check rows with no valid date (notes, blank rows) are ignored.
- Daily table, one row per calendar date in range: `date`, `status`, `customers` (count of Entries rows for open days, 0 for closed, blank for unknown), `use_for_training` (open only), the four inputs.
- Fail loudly, naming the date(s), inside the range only: "Has entries" with 0 Entries rows; "Closed (written)" or "No page found" with Entries rows; an Entries date missing from Day_Check; "Not yet encoded" on or before `data_to`.
- `Service` is not used in this slice.
- Expected summary for the current workbook (day counts, Entries rows, average ticket): kept with the workbook, outside git, because it is client sales data (O1). `train.py` prints the same line to compare against.

## 5. `ml-service/` layout and code style

- `pipeline.py`: plain functions, one per step, in this order: `load_workbook`, `build_daily_table`, `calendar_features`, `average_ticket`, `baseline_predictions`, `walk_forward`, `train_final_model`, `forecast`. No classes. Each docstring says what the step does in one or two sentences and cites the decision it implements ("Decision 1: …").
- `calendar_features(dates)` is the only place features are built. Training and forecasting both call it.
- `train.py`: a short script that calls the functions in order and prints each stage: the daily-table summary (§4), the comparison table (§6), then the artifact paths.
- `app.py`: the FastAPI service (§8).
- `tests/`: pytest, synthetic fixtures built in the tests. No real logbook data in tests.
- No notebooks in the repo. Brent can import `pipeline.py` from his own notebook.

## 6. Evaluation output

`train.py` prints and writes `artifacts/evaluation.json`:

```
Test week                Days  Average  Weekday  Last-7  Random Forest
Aug 29 – Sep 4            n     x.xx     x.xx     x.xx    x.xx
… (4 rows)
Mean                            x.xx     x.xx     x.xx    x.xx
Random Forest beats the best simple average in N of 4 weeks.
Typical error: x.xx customers a day (about ₱xxx at ₱xxx.xx per customer).
```

MAE in customers per day. `evaluation.json` holds the per-week numbers, the means, the name of the best baseline (lowest mean), `weeks_rf_won`, and `weeks_tested`.

## 7. Model artifacts

- After the evaluation, fit the final Random Forest on all open days in range.
- `artifacts/model.joblib` and `artifacts/metadata.json`: `model_version` (`rf-{data_to}-{first 8 chars of the model file's sha256}`), `trained_at` (Asia/Manila ISO), `data_from`, `data_to`, `training_days`, `features`, `payday_rule`, `avg_ticket`, `rows_with_amount`, `evaluation` (rf mean MAE, best baseline and its MAE, weeks won, weeks tested), `sklearn_version`.
- `ml-service/artifacts/` is gitignored. Train and serve in the same image so the scikit-learn version matches: `docker compose run --rm ml-service python train.py`.

## 8. FastAPI service

- Loads `model.joblib` and `metadata.json` at startup. If missing, the service still starts.
- `GET /health` → `{ "status": "ok", "model_loaded": bool, "model_version": str | null, "data_to": str | null }`.
- `GET /forecast?start=YYYY-MM-DD&days=7`: `start` defaults to today in Asia/Manila; `days` is 1–14 (422 otherwise); 503 when no model is loaded. Response (example values):

```json
{
  "model_version": "rf-2026-09-25-1a2b3c4d",
  "trained_at": "2026-10-08T21:03:00+08:00",
  "data_from": "2026-07-13",
  "data_to": "2026-09-25",
  "training_days": 70,
  "avg_ticket": 210.50,
  "evaluation": { "weeks_tested": 4, "rf_mae": 2.9, "best_baseline": "average", "best_baseline_mae": 2.8, "weeks_rf_won": 1 },
  "days": [ { "date": "2026-10-12", "customers": 6.8, "revenue": 1431.40 } ]
}
```

- `days` has exactly `days` entries, consecutive from `start`. `customers` ≥ 0, rounded to one decimal. `revenue` = that rounded `customers` × `avg_ticket`, two decimals, so the response checks out by hand.
- Docker Compose service (dev):

```yaml
  ml-service:
    build: ./ml-service
    container_name: ruzzco-ml
    ports:
      - "8001:8000"
    volumes:
      - ./ml-service:/app
```

`python:3.12-slim`, exact versions pinned in `requirements.txt` (fastapi, uvicorn, pandas, scikit-learn, joblib, openpyxl, pytest, httpx). Healthcheck on `/health`.

## 9. Next.js side

- Env: optional `ML_SERVICE_URL` (default `http://localhost:8001`). Requests time out after 5 seconds.
- Data model (additive migration). Reuse the unused `DailyRevenueForecast` table and add a run table:

```prisma
model ForecastRun {
  id                     String   @id @default(uuid())
  createdAt              DateTime @default(now()) @map("created_at")
  modelVersion           String   @map("model_version")
  dataFrom               DateTime @db.Date @map("data_from")
  dataTo                 DateTime @db.Date @map("data_to")
  trainingDays           Int      @map("training_days")
  avgTicket              Decimal  @db.Decimal(10, 2) @map("avg_ticket")
  typicalErrorCustomers  Decimal  @db.Decimal(6, 2) @map("typical_error_customers")
  bestBaseline           String   @map("best_baseline")
  bestBaselineError      Decimal  @db.Decimal(6, 2) @map("best_baseline_error")
  weeksRfWon             Int      @map("weeks_rf_won")
  weeksTested            Int      @map("weeks_tested")
  days                   DailyRevenueForecast[]
  @@map("forecast_runs")
}
```

`DailyRevenueForecast` gains `runId String? @map("run_id")` with its relation. `predictedHeadcount` = rounded customers, `predictedRevenue` = revenue. The confidence bound columns stay null.
- `src/lib/forecast.ts`: Zod schema for the service response (exact day count, consecutive dates, non-negative numbers); `fetchForecast(start, days)`; `saveForecast(response)` creates the run and upserts one `DailyRevenueForecast` per date in a single Prisma transaction. A later run overwrites the same dates (unique `forecastDate`).
- `POST /api/v1/forecast/refresh` (owner cookie, 401 otherwise): fetch for `manilaToday()` and 7 days, save, return the run and days. Service unreachable or invalid response → 502, nothing saved.
- `GET /api/v1/forecast` (owner cookie): the latest run plus stored days from `manilaToday()` for 7 days. Database only, never calls the service.

## 10. Owner dashboard

- On load, if the latest run was created before today (Asia/Manila), try one refresh. If it fails, show what's saved.
- Shows: each of the 7 days (weekday, date, expected customers as a whole number, expected revenue in whole pesos); the week's totals; and these plain sentences:
  - "On the last {weeks_tested} weeks of logbook records, this forecast was off by about {rf_mae} customers (about ₱{rf_mae × avg_ticket}) a day. Guessing the plain average was off by {best_baseline_mae}." Both numbers always show, whichever is lower.
  - "Based on the logbook from {data_from} to {data_to} ({training_days} open days). Revenue = expected customers × ₱{avg_ticket}, the average paid per customer in that period."
  - Service down: "Forecast service is offline. Showing the forecast saved on {date}." Days already past are not shown.
- A "Refresh forecast" button. Without the owner cookie, no forecast numbers are shown anywhere.
- Placement per O2.

## 11. Invariants still in force

All CLAUDE.md invariants. New rules for CLAUDE.md: features are built only in `ml-service`; the forecast never reads or writes transactions; the logbook workbook (`ml-service/data/`) and model artifacts (`ml-service/artifacts/`) are never committed; forecast revenue uses the average ticket from the training data, not the list price.

## 12. Steps (one per session, each ends reviewable; run all suites after each)

1. `ml-service` skeleton: Dockerfile, pinned requirements, `app.py` with `/health` (`model_loaded: false`), Compose service, `ml-service/artifacts/` added to the root `.gitignore` (`data/` is already there), pytest runs. Done when `docker compose up ml-service` starts and `/health` answers.
2. `load_workbook`, `build_daily_table`, `calendar_features`, `average_ticket` with their tests. `train.py` prints the §4 summary.
3. `baseline_predictions`, `walk_forward` with their tests. `train.py` prints the §6 table and writes `evaluation.json`. Stop here and show the table.
4. `train_final_model`, `forecast`, artifacts and metadata.
5. `/forecast` in `app.py`, API tests.
6. Prisma migration, `src/lib/forecast.ts`, both routes, `test:forecast-parse` and `test:forecast`.
7. Owner dashboard (§10).

## 13. Tests

- `docker compose run --rm ml-service pytest -q`, synthetic fixtures only:
  - Daily table: open, closed and unknown give count, 0 and blank; only open days have `use_for_training`.
  - Each §4 consistency check fails with the date in the message.
  - Features: 2026-10-12 is `dow` 0; `days_since_payday` is 0 on 2026-10-15, 14 on 2026-10-14, 1 on 2026-10-31, 0 on 2027-02-28, 1 on 2027-03-01.
  - Average ticket excludes blank amounts.
  - Walk-forward: every block is 7 consecutive dates; the latest training date is before the block's first date; closed and unknown days are never scored.
  - Baselines: a constant series gives MAE 0 for all three; the weekday average falls back when a weekday is missing.
  - Forecast: N rows, consecutive dates, customers ≥ 0, revenue = customers × ticket to two decimals.
  - API: no artifacts → `/health` `model_loaded` false and `/forecast` 503; with a fixture-trained model → 7 rows; `days=0` and `days=15` → 422.
- `test:forecast-parse` (no server): valid response passes; wrong day count, a skipped date, negative customers, or a missing field is rejected.
- `test:forecast` (dev server and ml-service running): 401 on both routes without the cookie; refresh saves one run and 7 days; a second refresh the same day leaves 7 rows for those dates, not 14; `GET` returns 7 days.
- All existing suites unchanged, plus `npm run lint` and `npx tsc --noEmit`.

## 14. Manual check

1. `ml-service/data/` holds exactly one workbook, the latest (per O1). `git status` does not list it.
2. `docker compose run --rm ml-service python train.py`: the summary matches the expected counts kept with the workbook (§4), the comparison table prints, the artifacts are written.
3. `docker compose up -d ml-service`; `http://localhost:8001/health` shows `model_loaded: true`; `/forecast` returns 7 rows.
4. As owner, open the dashboard: 7 days, totals, both error numbers, the data-range sentence.
5. `docker compose stop ml-service`, reload: the saved forecast shows with the offline sentence; "Refresh forecast" shows an error and the saved forecast stays.
6. On a barber phone without the owner cookie: no forecast numbers.

## 15. Wrap-up

- `CLAUDE.md`: remove "The ML service (`ml-service/`) is not in this repo yet"; add the ml-service commands and the §11 rules; replace "Forecast customer counts, then multiply by the current price" in Data caveats with the average-ticket rule (Decision 5).
- `../ruzzco-barbers/20_Decisions/`: one record for the six forecasting decisions in §2, with their reasons.
- `docs/sessions/` log per CLAUDE.md.

<!-- END OF SPEC -->
