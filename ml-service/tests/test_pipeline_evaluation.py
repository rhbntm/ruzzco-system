"""Step 3 tests: baselines and walk-forward evaluation. Synthetic data only."""

import pandas as pd
import pytest

import pipeline
from helpers import make_daily


def test_blocks_are_seven_consecutive_dates_ending_on_data_to():
    daily = make_daily("2026-07-13", "2026-09-25")
    result = pipeline.walk_forward(daily)
    assert result["weeks_tested"] == 4
    assert result["weeks"][-1]["end"] == pd.Timestamp("2026-09-25")
    for week in result["weeks"]:
        assert week["end"] - week["start"] == pd.Timedelta(days=6)
    for earlier, later in zip(result["weeks"], result["weeks"][1:]):
        assert later["start"] == earlier["end"] + pd.Timedelta(days=1)


def test_training_ends_before_each_block():
    result = pipeline.walk_forward(make_daily("2026-07-13", "2026-09-25"))
    for week in result["weeks"]:
        assert week["train_to"] < week["start"]


def test_closed_and_unknown_days_are_never_scored():
    closed, unknown = ["2026-09-20", "2026-09-07"], ["2026-09-24"]
    result = pipeline.walk_forward(make_daily("2026-07-13", "2026-09-25", closed=closed, unknown=unknown))
    scored = {d for week in result["weeks"] for d in week["scored_dates"]}
    assert not scored & {pd.Timestamp(d) for d in closed + unknown}
    assert sum(week["days"] for week in result["weeks"]) == 28 - 3


def test_constant_series_gives_zero_error_for_every_baseline():
    result = pipeline.walk_forward(make_daily("2026-07-13", "2026-09-25", customers=lambda d: 6))
    for week in result["weeks"]:
        for method in pipeline.BASELINES:
            assert week["mae"][method] == pytest.approx(0)


def test_weekday_average_falls_back_to_overall_average():
    train = make_daily("2026-10-12", "2026-10-13", customers=lambda d: 4 if d.dayofweek == 0 else 8)  # Mon, Tue only
    guesses = baseline_predictions_for(train, ["2026-10-19", "2026-10-21"])  # Mon, Wed
    assert guesses["weekday"].tolist() == [4, 6]
    assert guesses["average"].tolist() == [6, 6]


def test_last7_uses_the_last_seven_training_days():
    train = make_daily("2026-10-01", "2026-10-10", customers=lambda d: d.day)
    guesses = baseline_predictions_for(train, ["2026-10-11"])
    assert guesses["last7"].iloc[0] == pytest.approx(sum(range(4, 11)) / 7)


def test_best_baseline_and_weeks_won_are_consistent():
    result = pipeline.walk_forward(make_daily("2026-07-13", "2026-09-25", customers=lambda d: 3 + d.dayofweek))
    best = result["best_baseline"]
    assert result["mean"][best] == min(result["mean"][m] for m in pipeline.BASELINES)
    assert result["weeks_rf_won"] == sum(w["mae"]["random_forest"] < w["mae"][best] for w in result["weeks"])


def baseline_predictions_for(train, dates):
    return pipeline.baseline_predictions(train, [pd.Timestamp(d) for d in dates])
