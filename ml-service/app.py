"""Forecast service (slice 7 section 8).

Loads the model and metadata written by train.py once, at startup. After retraining,
restart the service to serve the new model. Without artifacts it still starts:
/health says model_loaded false and /forecast answers 503.
"""

import datetime as dt
import json
from pathlib import Path

import joblib
from fastapi import FastAPI, HTTPException, Query

import pipeline

ARTIFACTS_DIR = Path(__file__).parent / "artifacts"
MANILA = dt.timezone(dt.timedelta(hours=8), "Asia/Manila")


def load_artifacts(artifacts_dir):
    """(model, metadata), or (None, None) when train.py has not written them yet."""
    model_path, metadata_path = artifacts_dir / "model.joblib", artifacts_dir / "metadata.json"
    if not (model_path.exists() and metadata_path.exists()):
        return None, None
    return joblib.load(model_path), json.loads(metadata_path.read_text(encoding="utf-8"))


def create_app(artifacts_dir=ARTIFACTS_DIR):
    model, metadata = load_artifacts(artifacts_dir)
    app = FastAPI(title="Ruzzco forecast service")

    @app.get("/health")
    def health():
        """Says whether the service is up and which model, if any, it serves."""
        return {
            "status": "ok",
            "model_loaded": model is not None,
            "model_version": metadata["model_version"] if metadata else None,
            "data_to": metadata["data_to"] if metadata else None,
        }

    @app.get("/forecast")
    def forecast(start: dt.date | None = None, days: int = Query(7, ge=1, le=14)):
        """Expected customers and revenue for `days` dates from `start` (default: today in Manila)."""
        if model is None:
            raise HTTPException(status_code=503, detail="No model loaded. Run train.py, then restart the service.")
        start = start or dt.datetime.now(MANILA).date()
        rows = pipeline.forecast(model, start, days, metadata["avg_ticket"])
        return {
            "model_version": metadata["model_version"],
            "trained_at": metadata["trained_at"],
            "data_from": metadata["data_from"],
            "data_to": metadata["data_to"],
            "training_days": metadata["training_days"],
            "avg_ticket": metadata["avg_ticket"],
            "evaluation": metadata["evaluation"],
            "days": [
                {"date": row.date.date().isoformat(), "customers": row.customers, "revenue": row.revenue}
                for row in rows.itertuples()
            ],
        }

    return app


app = create_app()
