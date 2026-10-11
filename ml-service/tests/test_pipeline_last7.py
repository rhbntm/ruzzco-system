"""Slice 8 step 1 tests: the last-7 input, the extra methods and the test window. Synthetic data only."""

import pandas as pd
import pytest

import pipeline
from helpers import make_daily


def test_last7_at_is_the_mean_of_the_last_seven_open_days_before_the_date():
    daily = make_daily("2026-10-01", "2026-10-14", customers=lambda d: d.day)
    assert pipeline.last7_at(daily, "2026-10-12") == pytest.approx(sum(range(5, 12)) / 7)


def test_last7_at_skips_closed_and_unknown_days():
    daily = make_daily("2026-10-01", "2026-10-14", customers=lambda d: d.day, closed=["2026-10-10"], unknown=["2026-10-11"])
    # Open days before Oct 12: ... 6, 7, 8, 9, 12 is excluded (not before), so 4..9 plus 3.
    assert pipeline.last7_at(daily, "2026-10-12") == pytest.approx((3 + 4 + 5 + 6 + 7 + 8 + 9) / 7)


def test_last7_at_needs_seven_open_days():
    daily = make_daily("2026-10-01", "2026-10-10")
    with pytest.raises(ValueError):
        pipeline.last7_at(daily, "2026-10-06")


def test_add_last7_mean_gives_each_block_one_value_from_before_it():
    daily = make_daily("2026-09-01", "2026-10-04", customers=lambda d: d.day)
    rows = pipeline.add_last7_mean(daily)
    range_end = pd.Timestamp("2026-10-04")
    for _, row in rows.iterrows():
        block_number = (range_end - row["date"]).days // 7
        block_first = range_end - pd.Timedelta(days=block_number * 7 + 6)
        assert row["date"] >= block_first
        assert row["last7_mean"] == pytest.approx(pipeline.last7_at(daily, block_first))
        # Only dates before the block's first date feed the value.
        assert row["last7_mean"] <= max(range(1, 32)) and block_first > pd.Timestamp("2026-09-07")
    last_block = rows[rows["date"] >= pd.Timestamp("2026-09-28")]
    assert last_block["last7_mean"].nunique() == 1


def test_add_last7_mean_drops_rows_without_seven_prior_open_days():
    daily = make_daily("2026-09-01", "2026-10-04")
    rows = pipeline.add_last7_mean(daily)
    assert rows["date"].min() == pd.Timestamp("2026-09-14")
    assert len(rows) == 21


def test_flat_series_gives_zero_error_for_every_method():
    result = pipeline.walk_forward(make_daily("2026-07-13", "2026-09-25", customers=lambda d: 6))
    for week in result["weeks"]:
        for method in pipeline.METHODS:
            assert week["mae"][method] == pytest.approx(0, abs=1e-9)


def test_last_value_helps_when_each_week_has_its_own_level():
    # Each Monday-Sunday week has a level that is the previous week's level plus a step.
    def level(date):
        week = (date - pd.Timestamp("2026-07-13")).days // 7
        return 4 + (week % 5) * 3

    daily = make_daily("2026-07-13", "2026-11-01", customers=level)
    result = pipeline.walk_forward(daily, test_from=pd.Timestamp("2026-10-05"))
    assert result["weeks_tested"] == 4
    assert result["mean"]["random_forest_last7"] < result["mean"]["random_forest"] or result["mean"]["random_forest"] == pytest.approx(0, abs=1e-9)


def test_naive_is_the_last_open_day_even_after_a_closed_day():
    train = make_daily("2026-10-01", "2026-10-10", customers=lambda d: d.day, closed=["2026-10-10"])
    train = train[train["use_for_training"]]
    guesses = pipeline.baseline_predictions(train, [pd.Timestamp("2026-10-11"), pd.Timestamp("2026-10-12")])
    assert guesses["naive"].tolist() == [9, 9]


def test_test_from_keeps_only_blocks_starting_on_or_after_it():
    daily = make_daily("2026-07-13", "2026-10-18")
    test_from = pd.Timestamp("2026-09-26")
    result = pipeline.walk_forward(daily, test_from=test_from)
    assert 1 <= result["weeks_tested"] <= 4
    assert result["weeks"][-1]["end"] == pd.Timestamp("2026-10-18")
    for week in result["weeks"]:
        assert week["start"] >= test_from


def test_test_from_is_capped_at_four_blocks():
    result = pipeline.walk_forward(make_daily("2026-07-13", "2026-12-31"), test_from=pd.Timestamp("2026-09-26"))
    assert result["weeks_tested"] == 4


def test_no_block_after_test_from_gives_an_empty_result():
    result = pipeline.walk_forward(make_daily("2026-07-13", "2026-09-25"), test_from=pd.Timestamp("2026-09-26"))
    assert result["weeks"] == [] and result["weeks_tested"] == 0 and result["best_baseline"] is None


def test_without_test_from_the_result_is_the_reference():
    daily = make_daily("2026-07-13", "2026-09-25", customers=lambda d: 3 + d.dayofweek)
    assert pipeline.walk_forward(daily)["weeks_tested"] == 4


def test_best_baseline_is_always_a_simple_method():
    # A strictly weekly pattern: linear and gboost on the calendar inputs can beat the plain averages.
    daily = make_daily("2026-07-13", "2026-10-18", customers=lambda d: 2 + 2 * (d.dayofweek >= 5) + d.dayofweek % 3)
    result = pipeline.walk_forward(daily)
    assert result["best_baseline"] in pipeline.SIMPLE_METHODS
    best_simple = min(result["mean"][m] for m in pipeline.SIMPLE_METHODS)
    assert result["mean"][result["best_baseline"]] == best_simple
    best = result["best_baseline"]
    assert result["weeks_rf_won"] == sum(w["mae"]["random_forest"] < w["mae"][best] for w in result["weeks"])
    for week in result["weeks"]:
        assert "linear" in week["mae"] and "gboost" in week["mae"]


def test_evaluation_json_has_reference_and_test_sections(tmp_path):
    import json

    import train

    daily = make_daily("2026-07-13", "2026-10-18", customers=lambda d: 3 + d.dayofweek)
    reference = pipeline.walk_forward(daily)
    test = pipeline.walk_forward(daily, test_from=pipeline.TEST_FROM)
    chosen, basis = train.choose_evaluation(reference, test)
    assert basis == "test" and chosen is test
    ticket = {"avg_ticket": 100.0, "rows_with_amount": 10, "amount_total": 1000.0}
    train.write_artifacts(pipeline.train_final_model(daily), daily, ticket, chosen, tmp_path, reference, test, basis)
    saved = json.loads((tmp_path / "evaluation.json").read_text(encoding="utf-8"))
    assert saved["basis"] == "test" and saved["weeks_tested"] == test["weeks_tested"]
    assert set(saved["reference"]["mean"]) == set(pipeline.METHODS)
    assert saved["test"]["best_baseline"] in pipeline.SIMPLE_METHODS
    assert json.loads((tmp_path / "metadata.json").read_text(encoding="utf-8"))["evaluation"]["basis"] == "test"


def test_choose_evaluation_falls_back_to_the_reference():
    import train

    daily = make_daily("2026-07-13", "2026-09-25")
    reference = pipeline.walk_forward(daily)
    test = pipeline.walk_forward(daily, test_from=pipeline.TEST_FROM)
    assert train.choose_evaluation(reference, test) == (reference, "reference")
