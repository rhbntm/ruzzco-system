"""Slice 7 forecasting pipeline: paper logbook -> daily table -> model -> forecast.

Each function is one step, in the order train.py calls them. Decisions are numbered as in
docs/slices/slice-7.md section 2. Nothing here reads POS transactions.
"""

import calendar
import datetime as dt
import statistics

import pandas as pd
from sklearn.ensemble import RandomForestRegressor

# Advisor guidance 2026-10-05: train only on the logbook from this date on (post-gap).
POST_GAP_START = pd.Timestamp("2026-07-13")

# Day_Check status -> what the day means for the model (Decision 1).
STATUS_MEANING = {
    "Has entries": "open",
    "Closed (written)": "closed",
    "No page found": "unknown",
}
NOT_YET_ENCODED = "Not yet encoded"

FEATURES = ["dow", "is_weekend", "day_of_month", "days_since_payday"]
PAYDAY_RULE = "Paydays are the 15th and the 30th; in February, the 15th and the last day of the month (assumption)."


def _as_date(value):
    """A cell value as a midnight Timestamp, or None when the cell is not a date (notes, blanks)."""
    if isinstance(value, (dt.datetime, dt.date)):
        return pd.Timestamp(value).normalize()
    return None


def load_workbook(path):
    """Read the Entries and Day_Check sheets of the logbook workbook, keeping only the columns we use.

    Returns (entries, day_check). entries has one row per customer: date, service, amount
    (amount may be blank). day_check has one row per date: date, status. Day_Check rows
    without a valid date (notes, blank rows) are dropped (section 4).
    """
    raw_entries = pd.read_excel(path, sheet_name="Entries")
    raw_entries = raw_entries.dropna(how="all", subset=["Date", "Service", "Amount (PHP)"])
    no_date = raw_entries["Date"].isna()
    if no_date.any():
        raise ValueError(f"Entries has {int(no_date.sum())} row(s) with a service or amount but no date.")
    entries = pd.DataFrame({
        "date": pd.to_datetime(raw_entries["Date"]).dt.normalize(),
        "service": raw_entries["Service"],
        "amount": pd.to_numeric(raw_entries["Amount (PHP)"]),
    }).reset_index(drop=True)

    raw_check = pd.read_excel(path, sheet_name="Day_Check")
    day_check = pd.DataFrame({
        "date": raw_check["Date"].map(_as_date),
        "status": raw_check["Status"],
    })
    day_check = day_check[day_check["date"].notna()].reset_index(drop=True)
    day_check["date"] = pd.to_datetime(day_check["date"])
    duplicated = day_check.loc[day_check["date"].duplicated(), "date"]
    if not duplicated.empty:
        raise ValueError(f"Day_Check lists these dates more than once: {_dates(duplicated)}")
    return entries, day_check


def build_daily_table(entries, day_check):
    """One row per calendar date from POST_GAP_START to the last "Has entries" date.

    Decision 1: open days count their Entries rows, closed days are 0, "No page found" days
    are blank (missing, never 0), and only open days are used for training. Fails loudly,
    naming the dates, when the two sheets disagree inside that range.
    """
    check = day_check[day_check["date"] >= POST_GAP_START]
    open_dates = check.loc[check["status"] == "Has entries", "date"]
    if open_dates.empty:
        raise ValueError(f"No 'Has entries' day on or after {POST_GAP_START.date()}.")
    data_to = open_dates.max()

    dates = pd.date_range(POST_GAP_START, data_to, freq="D")
    status_by_date = check.set_index("date")["status"]
    in_range = entries[(entries["date"] >= POST_GAP_START) & (entries["date"] <= data_to)]
    rows_by_date = in_range.groupby("date").size()

    problems = []

    def problem(message, bad_dates):
        if len(bad_dates):
            problems.append(f"{message}: {_dates(bad_dates)}")

    statuses = status_by_date.reindex(dates)
    rows = rows_by_date.reindex(dates, fill_value=0)
    problem("No Day_Check row", dates[statuses.isna().to_numpy()])
    problem("'Has entries' but no Entries rows", dates[((statuses == "Has entries") & (rows == 0)).to_numpy()])
    problem("'Closed (written)' but has Entries rows", dates[((statuses == "Closed (written)") & (rows > 0)).to_numpy()])
    problem("'No page found' but has Entries rows", dates[((statuses == "No page found") & (rows > 0)).to_numpy()])
    problem(f"'{NOT_YET_ENCODED}' on or before {data_to.date()}", dates[(statuses == NOT_YET_ENCODED).to_numpy()])
    known = set(STATUS_MEANING) | {NOT_YET_ENCODED}
    problem("Unrecognised Day_Check status", dates[(statuses.notna() & ~statuses.isin(known)).to_numpy()])
    problem("Entries date missing from Day_Check", rows_by_date.index.difference(status_by_date.index))
    if problems:
        raise ValueError("Logbook check failed.\n" + "\n".join(problems))

    status = statuses.map(STATUS_MEANING)
    customers = rows.astype("Int64").where(status != "unknown", pd.NA)
    table = pd.DataFrame({
        "date": dates,
        "status": status.to_numpy(),
        "customers": customers.to_numpy(),
        "use_for_training": (status == "open").to_numpy(),
    })
    return pd.concat([table, calendar_features(dates)], axis=1)


def calendar_features(dates):
    """The four model inputs for each date (Decision 4). The only place features are built.

    dow: 0 = Mon ... 6 = Sun. is_weekend: 1 on Sat and Sun. day_of_month: 1-31.
    days_since_payday: days since the latest payday on or before the date (see PAYDAY_RULE).
    """
    dates = pd.DatetimeIndex(pd.to_datetime(dates)).normalize()
    return pd.DataFrame({
        "dow": dates.dayofweek,
        "is_weekend": (dates.dayofweek >= 5).astype(int),
        "day_of_month": dates.day,
        "days_since_payday": [_days_since_payday(d) for d in dates],
    })


def _second_payday(year, month):
    """The month's second payday: the 30th, or the last day of February."""
    return calendar.monthrange(year, month)[1] if month == 2 else 30


def _days_since_payday(date):
    """Days since the latest payday on or before date (Decision 4)."""
    second = _second_payday(date.year, date.month)
    if date.day >= second:
        return date.day - second
    if date.day >= 15:
        return date.day - 15
    # Before the 15th: count from the previous month's second payday.
    year, month = (date.year, date.month - 1) if date.month > 1 else (date.year - 1, 12)
    previous_month_length = calendar.monthrange(year, month)[1]
    return date.day + (previous_month_length - _second_payday(year, month))


def average_ticket(entries, data_from, data_to):
    """Average amount paid per customer between data_from and data_to (Decision 5).

    Entries rows with a blank amount are left out of both the sum and the count.
    Returns {"avg_ticket", "rows_with_amount", "amount_total"}; avg_ticket is rounded to centavos.
    """
    in_range = entries[(entries["date"] >= data_from) & (entries["date"] <= data_to)]
    amounts = in_range["amount"].dropna()
    if amounts.empty:
        raise ValueError(f"No Entries amounts between {data_from.date()} and {data_to.date()}.")
    return {
        "avg_ticket": round(float(amounts.sum()) / len(amounts), 2),
        "rows_with_amount": int(len(amounts)),
        "amount_total": float(amounts.sum()),
    }


BASELINES = ["average", "weekday", "last7"]
METHODS = BASELINES + ["random_forest"]


def baseline_predictions(train, dates):
    """The three simple averages' guesses for each date, from open training days only (Decision 3).

    average: mean customers over all training days. weekday: mean for that weekday, falling
    back to the overall average when the weekday has no training rows. last7: mean of the
    last 7 training days. Returns a DataFrame with one column per baseline.
    """
    train = train.sort_values("date")
    overall = train["customers"].astype(float).mean()
    by_weekday = train.groupby("dow")["customers"].mean().astype(float)
    last7 = train["customers"].tail(7).astype(float).mean()
    weekdays = calendar_features(dates)["dow"]
    return pd.DataFrame({
        "average": [overall] * len(weekdays),
        "weekday": [by_weekday.get(d, overall) for d in weekdays],
        "last7": [last7] * len(weekdays),
    })


def walk_forward(daily, weeks=4, block_days=7):
    """Test every method on the last `weeks` blocks of 7 calendar days, ending on data_to (Decision 2).

    Each block trains only on open days before the block starts and is scored only on its
    open days. Score = mean absolute error (MAE) in customers per day. Returns per-week
    results (oldest first), the mean MAE per method, the best baseline (lowest mean), and
    the number of weeks Random Forest beat that baseline (Decision 6: no tuning here).
    spread is the sample standard deviation of each method's weekly MAEs: how much the
    error moves from one test week to the next.
    """
    data_to = daily["date"].max()
    training_rows = daily[daily["use_for_training"]]
    results = []
    for k in reversed(range(weeks)):
        end = data_to - pd.Timedelta(days=block_days * k)
        start = end - pd.Timedelta(days=block_days - 1)
        train = training_rows[training_rows["date"] < start]
        test = training_rows[(training_rows["date"] >= start) & (training_rows["date"] <= end)]
        if train.empty or test.empty:
            raise ValueError(f"Test week {start.date()} to {end.date()} has no open days to train on or to score.")

        guesses = baseline_predictions(train, test["date"])
        guesses["random_forest"] = _fit_random_forest(train).predict(test[FEATURES])
        actual = test["customers"].astype(float).to_numpy()
        results.append({
            "start": start,
            "end": end,
            "train_to": train["date"].max(),
            "scored_dates": list(test["date"]),
            "days": len(test),
            "mae": {m: float(abs(guesses[m].to_numpy() - actual).mean()) for m in METHODS},
        })

    mean = {m: sum(w["mae"][m] for w in results) / len(results) for m in METHODS}
    spread = {m: statistics.stdev(w["mae"][m] for w in results) if len(results) > 1 else 0.0 for m in METHODS}
    best = min(BASELINES, key=lambda m: mean[m])
    return {
        "weeks": results,
        "mean": mean,
        "spread": spread,
        "best_baseline": best,
        "weeks_rf_won": sum(w["mae"]["random_forest"] < w["mae"][best] for w in results),
        "weeks_tested": len(results),
    }


def train_final_model(daily):
    """Fit the Random Forest that will be served, on every open day in range (Decisions 1 and 6)."""
    return _fit_random_forest(daily[daily["use_for_training"]])


def forecast(model, start, days, avg_ticket):
    """Expected customers and revenue for `days` consecutive dates from `start` (Decision 5).

    customers is never negative and is rounded to one decimal; revenue is that rounded
    number times avg_ticket, to two decimals, so every row checks out by hand.
    """
    if days < 1:
        raise ValueError("days must be at least 1.")
    dates = pd.date_range(pd.Timestamp(start).normalize(), periods=days, freq="D")
    predicted = model.predict(calendar_features(dates)[FEATURES])
    customers = [round(max(0.0, float(p)), 1) for p in predicted]
    return pd.DataFrame({
        "date": dates,
        "customers": customers,
        "revenue": [round(c * avg_ticket, 2) for c in customers],
    })


def _fit_random_forest(train):
    """Random Forest on the four calendar inputs, default settings, fixed seed (Decision 6)."""
    model = RandomForestRegressor(random_state=42)
    model.fit(train[FEATURES], train["customers"].astype(float))
    return model


def _dates(values):
    return ", ".join(pd.Timestamp(v).strftime("%Y-%m-%d") for v in sorted(values))
