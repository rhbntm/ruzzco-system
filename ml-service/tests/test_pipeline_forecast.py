"""Step 4 tests: final model, forecast and artifacts. Synthetic data only."""

import json
import re

import joblib
import pandas as pd
import pytest

import pipeline
import train
from helpers import make_daily

TICKET = 210.50


@pytest.fixture(scope="module")
def daily():
    return make_daily("2026-07-13", "2026-09-25", customers=lambda d: 3 + d.dayofweek, closed=["2026-08-10"])


@pytest.fixture(scope="module")
def model(daily):
    return pipeline.train_final_model(daily)


def test_forecast_rows_dates_and_revenue(model):
    result = pipeline.forecast(model, pd.Timestamp("2026-10-12"), 7, TICKET)
    assert len(result) == 7
    assert list(result["date"]) == list(pd.date_range("2026-10-12", periods=7, freq="D"))
    assert (result["customers"] >= 0).all()
    for customers, revenue in zip(result["customers"], result["revenue"]):
        assert customers == round(customers, 1)
        assert revenue == round(customers * TICKET, 2)


def test_forecast_follows_the_weekday_pattern(model):
    result = pipeline.forecast(model, pd.Timestamp("2026-10-12"), 7, TICKET)  # Mon..Sun
    assert result["customers"].iloc[0] < result["customers"].iloc[6]


def test_forecast_rejects_zero_days(model):
    with pytest.raises(ValueError):
        pipeline.forecast(model, pd.Timestamp("2026-10-12"), 0, TICKET)


def test_final_model_trains_on_open_days_only(daily):
    # The closed day is 0 customers on a Monday; if it were used, Mondays would be pulled below 3.
    model = pipeline.train_final_model(daily)
    monday = pipeline.forecast(model, pd.Timestamp("2026-10-12"), 1, TICKET)
    assert monday["customers"].iloc[0] == 3.0


def test_write_artifacts(tmp_path, daily, model):
    evaluation = pipeline.walk_forward(daily)
    ticket = {"avg_ticket": TICKET, "rows_with_amount": 10, "amount_total": 2105.0}
    paths = train.write_artifacts(model, daily, ticket, evaluation, tmp_path)
    assert [p.name for p in paths] == ["evaluation.json", "model.joblib", "metadata.json"]

    metadata = json.loads((tmp_path / "metadata.json").read_text(encoding="utf-8"))
    assert re.fullmatch(r"rf-2026-09-25-[0-9a-f]{8}", metadata["model_version"])
    assert metadata["trained_at"].endswith("+08:00")
    assert metadata["data_from"] == "2026-07-13" and metadata["data_to"] == "2026-09-25"
    assert metadata["training_days"] == 74
    assert metadata["features"] == pipeline.FEATURES
    assert metadata["avg_ticket"] == TICKET
    assert set(metadata["evaluation"]) == {"weeks_tested", "rf_mae", "best_baseline", "best_baseline_mae", "weeks_rf_won"}

    reloaded = joblib.load(tmp_path / "model.joblib")
    assert list(pipeline.forecast(reloaded, pd.Timestamp("2026-10-12"), 7, TICKET)["customers"]) == \
        list(pipeline.forecast(model, pd.Timestamp("2026-10-12"), 7, TICKET)["customers"])
