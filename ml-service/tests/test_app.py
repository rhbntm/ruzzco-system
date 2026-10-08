from fastapi.testclient import TestClient

from app import app


def test_health_without_model():
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "model_loaded": False, "model_version": None, "data_to": None}
