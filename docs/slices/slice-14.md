# Slice 14 — 7, 14 and 30-day forecast filter on the home page

Repo: `ruzzco-system`. Status: **SPEC (written 2026-10-28).** Items tagged [AI proposal] are not confirmed by Brent; everything marked (Brent) is.
Goal: the owner chooses how far ahead the home forecast panel looks: 7, 14 or 30 days. Nothing else about the forecast changes.
Origin: the adviser asked for a 14- and 30-day view on the home page at the 2026-10-26 consult (Brent, 2026-10-28). Development was frozen for the defense; Brent lifted the freeze for this one change (2026-10-28).

## 1. Scope boundary (read first)

- Home page panel only (Brent). `/forecast`, `/insights` and `GET /api/v1/forecast` keep showing 7 days.
- The model, its four calendar inputs, training, the method comparison and how accuracy is measured do not change. No retrain is needed.
- No schema change. `daily_revenue_forecasts` already has one row per date (`@@unique([forecastDate])`), so a 30-day run simply covers more dates.
- Same data rules as slice 7: no client sales figures in this spec, tests, fixtures or commit messages.

## 2. Decisions

1. **Horizons: 7, 14 and 30 days; 7 is the default** (Brent, 2026-10-28; adviser, 2026-10-26).
2. **One refresh saves 30 days.** `POST /api/v1/forecast/refresh` asks the ml-service for 30 days from today (Manila) and saves them as one run. The 7- and 14-day views are the first 7 and 14 of those days. One request, and every view still works while the service is down. [AI proposal]
3. **The filter is client-side.** The home page loads the saved days from today for 30 days; the panel shows the first 7, 14 or 30. Switching never calls the server. [AI proposal]
4. **Accuracy note** (Brent, 2026-10-28). The error sentence stays the 7-day test-week error. On 14 and 30 days the panel adds: "Accuracy was measured on 7-day test weeks; 14- and 30-day forecasts have not been tested yet."
5. **ml-service accepts 1 to 30 days** (was 1 to 14). The model has no lag inputs, so every date is predicted from its own calendar values; a longer horizon needs no other change.
6. **Short saved runs.** Runs saved before this slice cover 7 days. If the saved days don't reach the chosen horizon, the panel shows the days it has and says "The saved forecast covers N days. Press Refresh forecast for the full 30." The daily automatic refresh fills it on the first visit of a new day anyway. [AI proposal]
7. **Chart labels.** 7 days keeps the weekday under each column. 14 and 30 days show the day of the month, with every 2nd (14) or 5th (30) label shown, so the axis stays readable. Tooltips keep the full "Tue, Oct 27". [AI proposal]

## 3. What exists today (audit before building)

- `ml-service/app.py`: `days: int = Query(7, ge=1, le=14)`. `ml-service/tests/test_app.py` checks 7 and 14 days and rejects `days=15`.
- `web/src/app/api/v1/forecast/refresh/route.ts`: `FORECAST_DAYS = 7`.
- `web/src/lib/forecast.ts`: `latestForecast(today)` reads 7 days from today; used by `/`, `/forecast`, `/insights` and `GET /api/v1/forecast`.
- `web/src/components/ForecastPanel.tsx`: title "Next 7 days", table, `ColumnChart` from `forecastChart(days)`, error sentence. `ColumnChart` already has `labelEvery`.
- `web/scripts/test-forecast.ts`: expects refresh to return and store 7 days. `web/scripts/test-forecast-comparison.ts`: checks `forecastChart` on 7 days (weekday axis labels).

## 4. Build: ml-service

- `app.py`: `le=30`. Docstring unchanged otherwise.
- `tests/test_app.py`: the invalid case `days=15` becomes `days=31`; add a 30-day test (30 consecutive dates from `start`).

## 5. Build: web

- `lib/forecast.ts`: `FORECAST_HORIZONS = [7, 14, 30] as const`, `MAX_FORECAST_DAYS = 30`. `latestForecast(today = manilaToday(), days = 7)`: the default keeps every existing caller at 7.
- `refresh/route.ts`: ask for and save `MAX_FORECAST_DAYS`. The response returns all 30 days (the home panel slices them).
- `app/page.tsx` (`loadForecast`): `latestForecast(manilaToday(), MAX_FORECAST_DAYS)`.
- `ForecastPanel.tsx`: a three-button segmented control ("7 days", "14 days", "30 days", `aria-pressed`) next to the title; title "Next N days"; table footer "Week total" for 7, else "N-day total"; the note from Decision 4 on 14 and 30; the short-run note from Decision 6. The chart and table use the same sliced days.
- `lib/forecast-chart.ts`: `forecastChart(days)` keeps weekday axis labels up to 7 days; above 7, the day of the month. Return a `labelEvery` (1, 2 or 5) that the panel passes to `ColumnChart`.
- `ForecastLocked` description and `OwnerDrawer` card text: "next 7 days" → "next 7, 14 or 30 days" where it describes the home panel.

## 6. Tests

- `ml-service` pytest: as in §4.
- `test-forecast-comparison.ts` (no server): 7 days keep weekday labels and `labelEvery` 1; 14 days give day-of-month labels and `labelEvery` 2; 30 days give `labelEvery` 5 and 30 columns.
- `test-forecast.ts` (dev server + ml-service): refresh returns and stores 30 days from today; a second refresh the same day still leaves 30 rows for those dates, not 60; `GET /api/v1/forecast` still returns 7 days.
- `npm run lint`, `npx tsc --noEmit`, and every other suite as usual.

## 7. Paper and defense follow-ups (not code)

- Ch3 Table 3 "Forecast horizon: The next 7 days", the Revenue Forecasting definition and "Each test window is seven days long, to match the forecast horizon" need the 7/14/30 wording and the untested-horizon limitation.
- Claim map: the horizon claims (CH and ML sections) and a new claim for "Why show 30 days if you only tested 7?".
- Decision record in `../ruzzco-barbers/20_Decisions/` for the adviser's request and the freeze exception.

## 8. Done when

- The home panel switches between 7, 14 and 30 days without a network call, in the browser, with the right title, totals, chart and note.
- All suites, lint and tsc pass.
- `/forecast`, `/insights` and `GET /api/v1/forecast` still show 7 days.

<!-- END OF SPEC -->
