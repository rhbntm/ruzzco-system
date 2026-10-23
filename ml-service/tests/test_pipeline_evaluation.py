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
        for method in pipeline.SIMPLE_METHODS:
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
    assert result["mean"][best] == min(result["mean"][m] for m in pipeline.SIMPLE_METHODS)
    assert result["weeks_rf_won"] == sum(w["mae"]["random_forest"] < w["mae"][best] for w in result["weeks"])


def baseline_predictions_for(train, dates):
    return pipeline.baseline_predictions(train, [pd.Timestamp(d) for d in dates])


def test_spread_is_the_standard_deviation_of_the_weekly_errors():
    import statistics

    result = pipeline.walk_forward(make_daily("2026-07-13", "2026-09-25", customers=lambda d: 3 + d.dayofweek + d.day % 4))
    for method in pipeline.METHODS:
        weekly = [w["mae"][method] for w in result["weeks"]]
        assert result["spread"][method] == pytest.approx(statistics.stdev(weekly))


# Slice 12 Decision 2: RMSE next to MAE, from the same guesses and the same scored days.
def test_weekly_rmse_on_known_errors():
    # Train on a flat 5; then three open test days at 6, 6 and 9: the average guesses 5 every
    # day, so its errors are 1, 1 and 4. MAE = 2, RMSE = sqrt((1 + 1 + 16) / 3) = sqrt(6).
    test_days = {pd.Timestamp("2026-09-19"): 6, pd.Timestamp("2026-09-20"): 6, pd.Timestamp("2026-09-21"): 9}
    daily = make_daily(
        "2026-07-13", "2026-09-25",
        customers=lambda d: test_days.get(d, 5),
        closed=["2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"],
    )
    result = pipeline.walk_forward(daily, weeks=1)
    week = result["weeks"][0]
    assert week["days"] == 3
    assert week["mae"]["average"] == pytest.approx(2)
    assert week["rmse"]["average"] == pytest.approx(6 ** 0.5)
    assert result["rmse"]["average"] == pytest.approx(6 ** 0.5)


def test_rmse_is_never_below_mae_and_its_mean_is_the_mean_of_the_weeks():
    result = pipeline.walk_forward(make_daily("2026-07-13", "2026-09-25", customers=lambda d: 3 + d.dayofweek + d.day % 4))
    for method in pipeline.METHODS:
        for week in result["weeks"]:
            assert week["rmse"][method] >= week["mae"][method] - 1e-12
        weekly = [w["rmse"][method] for w in result["weeks"]]
        assert result["rmse"][method] == pytest.approx(sum(weekly) / len(weekly))


def test_rmse_does_not_change_best_baseline_or_weeks_won():
    result = pipeline.walk_forward(make_daily("2026-07-13", "2026-09-25", customers=lambda d: 3 + d.dayofweek + d.day % 4))
    best = min(pipeline.SIMPLE_METHODS, key=lambda m: result["mean"][m])
    assert result["best_baseline"] == best
    assert result["weeks_rf_won"] == sum(w["mae"]["random_forest"] < w["mae"][best] for w in result["weeks"])


# Slice 12 Decision 3: the single decision tree is an evidence method.
def test_tree_is_an_evidence_method_in_every_week():
    assert "tree" in pipeline.METHODS and "tree" in pipeline.EVIDENCE_METHODS
    assert "tree" not in pipeline.SIMPLE_METHODS
    result = pipeline.walk_forward(make_daily("2026-07-13", "2026-09-25", customers=lambda d: 3 + d.dayofweek))
    assert all("tree" in w["mae"] and "tree" in w["rmse"] for w in result["weeks"])


def test_tree_never_becomes_best_baseline_nor_counts_in_weeks_won():
    # A day-of-month pattern: a tree on the calendar inputs learns it exactly; no simple method can.
    result = pipeline.walk_forward(make_daily("2026-07-13", "2026-09-25", customers=lambda d: 2 + d.day % 5))
    best = result["best_baseline"]
    assert result["mean"]["tree"] < result["mean"][best]
    assert best in pipeline.SIMPLE_METHODS
    assert result["weeks_rf_won"] == sum(w["mae"]["random_forest"] < w["mae"][best] for w in result["weeks"])


def test_constant_series_has_no_spread():
    result = pipeline.walk_forward(make_daily("2026-07-13", "2026-09-25", customers=lambda d: 6))
    for method in pipeline.SIMPLE_METHODS:
        assert result["spread"][method] == pytest.approx(0)
