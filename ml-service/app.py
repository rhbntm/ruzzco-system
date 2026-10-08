"""Forecast service. Step 1 of slice 7: only /health, no model yet."""

from fastapi import FastAPI

app = FastAPI(title="Ruzzco forecast service")


@app.get("/health")
def health():
    """Says whether the service is up and which model, if any, it serves."""
    return {"status": "ok", "model_loaded": False, "model_version": None, "data_to": None}
