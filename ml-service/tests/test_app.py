"""Step 5 tests: /health and /forecast, with and without artifacts. Synthetic data only."""

import datetime as dt

import pandas as pd
import pytest
from fastapi.testclient import TestClient

import app as service
import pipeline
import train
from helpers import make_daily

TICKET = 210.50


@pytest.fixture
def empty_client(tmp_path):
    return TestClient(service.create_app(tmp_path))


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    out_dir = tmp_path_factory.mktemp("artifacts")
    daily = make_daily("2026-07-13", "2026-09-25", customers=lambda d: 3 + d.dayofweek)
    ticket = {"avg_ticket": TICKET, "rows_with_amount": 10, "amount_total": 2105.0}
    train.write_artifacts(pipeline.train_final_model(daily), daily, ticket, pipeline.walk_forward(daily), out_dir)
    return TestClient(service.create_app(out_dir))


def test_health_without_model(empty_client):
    response = empty_client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "model_loaded": False, "model_version": None, "data_to": None}


def test_forecast_without_model_is_503(empty_client):
    assert empty_client.get("/forecast").status_code == 503


def test_health_with_model(client):
    body = client.get("/health").json()
    assert body["model_loaded"] is True
    assert body["model_version"].startswith("rf-2026-09-25-")
    assert body["data_to"] == "2026-09-25"


def test_forecast_seven_days(client):
    response = client.get("/forecast", params={"start": "2026-10-12", "days": 7})
    assert response.status_code == 200
    body = response.json()
    assert [d["date"] for d in body["days"]] == [f"2026-10-{n}" for n in range(12, 19)]
    for day in body["days"]:
        assert day["customers"] >= 0
        assert day["revenue"] == round(day["customers"] * body["avg_ticket"], 2)
    assert body["avg_ticket"] == TICKET
    assert body["training_days"] == 75
    assert set(body["evaluation"]) == {"weeks_tested", "rf_mae", "best_baseline", "best_baseline_mae", "weeks_rf_won"}


def test_forecast_defaults_to_today_in_manila_and_seven_days(client):
    body = client.get("/forecast").json()
    today = dt.datetime.now(service.MANILA).date()
    assert len(body["days"]) == 7
    assert body["days"][0]["date"] == today.isoformat()


@pytest.mark.parametrize("params", [{"days": 0}, {"days": 15}, {"start": "2026-13-01"}, {"start": "next week"}])
def test_forecast_rejects_bad_input(client, params):
    assert client.get("/forecast", params=params).status_code == 422


def test_forecast_fourteen_days(client):
    body = client.get("/forecast", params={"start": "2026-10-12", "days": 14}).json()
    assert len(body["days"]) == 14
    assert pd.Timestamp(body["days"][-1]["date"]) == pd.Timestamp("2026-10-25")
