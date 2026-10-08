"""Synthetic fixtures shared by the tests. No real logbook data."""

import pandas as pd

import pipeline


def make_daily(start, end, customers=lambda date: 5, closed=(), unknown=()):
    """A daily table shaped like build_daily_table's output. closed/unknown: lists of date strings."""
    dates = pd.date_range(start, end, freq="D")
    closed = {pd.Timestamp(d) for d in closed}
    unknown = {pd.Timestamp(d) for d in unknown}
    status = ["closed" if d in closed else "unknown" if d in unknown else "open" for d in dates]
    counts = [0 if s == "closed" else pd.NA if s == "unknown" else customers(d) for d, s in zip(dates, status)]
    table = pd.DataFrame({
        "date": dates,
        "status": status,
        "customers": pd.array(counts, dtype="Int64"),
        "use_for_training": [s == "open" for s in status],
    })
    return pd.concat([table, pipeline.calendar_features(dates)], axis=1)
