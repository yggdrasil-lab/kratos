"""Tests for Withings and Apple Health integration webhooks."""

import datetime as dt


def test_apple_health_workout_ingestion(client) -> None:
    now = dt.datetime.now(dt.timezone.utc)
    started_at = (now - dt.timedelta(minutes=90)).isoformat()
    ended_at = now.isoformat()

    response = client.post(
        "/integrations/apple-health/workout",
        json={
            "workout_type": "Badminton",
            "started_at": started_at,
            "ended_at": ended_at,
            "duration_seconds": 5400,
            "active_energy_kcal": 650.5,
            "avg_heart_rate_bpm": 142,
            "max_heart_rate_bpm": 178,
            "notes": "Intense evening doubles match",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["started_at"].startswith(started_at[:19])
    assert data["extra"]["session_type"] == "sport"
    assert data["extra"]["activity_name"] == "Badminton"
    assert data["extra"]["active_energy_kcal"] == 650.5
    assert data["extra"]["avg_heart_rate_bpm"] == 142

    # Verify session is queryable in standard history
    session_id = data["id"]
    fetched = client.get(f"/sessions/{session_id}")
    assert fetched.status_code == 200
    assert fetched.json()["extra"]["activity_name"] == "Badminton"


def test_apple_health_biometrics_ingestion(client) -> None:
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    response = client.post(
        "/integrations/apple-health/biometrics",
        json={
            "measured_at": now,
            "weight_kg": 88.5,
            "resting_hr_bpm": 52,
            "hrv_ms": 62.4,
            "sleep_duration_s": 28800,
            "sleep_deep_s": 5400,
            "sleep_rem_s": 6200,
            "step_count": 8500,
            "active_energy_kcal": 520,
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["source"] == "apple_health"
    assert float(data["weight_kg"]) == 88.5
    assert data["resting_hr_bpm"] == 52
    assert float(data["hrv_ms"]) == 62.4
    assert data["sleep_duration_s"] == 28800

    # Query latest
    latest = client.get("/integrations/biometrics/latest")
    assert latest.status_code == 200
    assert latest.json()["source"] == "apple_health"
    assert float(latest.json()["weight_kg"]) == 88.5


def test_withings_measurement_ingestion(client) -> None:
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    response = client.post(
        "/integrations/withings/measurements",
        json={
            "measured_at": now,
            "weight_kg": 88.2,
            "body_fat_pct": 19.5,
            "muscle_mass_kg": 67.4,
            "water_pct": 58.2,
            "bone_mass_kg": 3.4,
            "resting_hr_bpm": 55,
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["source"] == "withings"
    assert float(data["weight_kg"]) == 88.2
    assert float(data["body_fat_pct"]) == 19.5
    assert float(data["muscle_mass_kg"]) == 67.4

    # Query biometrics list
    res = client.get("/integrations/biometrics?source=withings")
    assert res.status_code == 200
    assert len(res.json()) >= 1
    assert res.json()[0]["source"] == "withings"


def test_withings_webhook_verification(client) -> None:
    response = client.get("/integrings/withings/webhook".replace("integrings", "integrations"))
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_withings_webhook_callback(client) -> None:
    response = client.post(
        "/integrations/withings/webhook",
        json={"appli": 1, "userid": "user_12345", "startdate": 1730000000, "enddate": 1730000100},
    )
    assert response.status_code == 200
    assert response.json()["received"] is True


def test_webhook_token_protection(client, monkeypatch) -> None:
    from app.config import settings
    monkeypatch.setattr(settings, "webhook_secret", "my-secret-token")

    now = dt.datetime.now(dt.timezone.utc).isoformat()
    payload = {"measured_at": now, "weight_kg": 87.9}

    # Missing token -> 401
    unauth = client.post("/integrations/withings/measurements", json=payload)
    assert unauth.status_code == 401

    # Wrong token -> 401
    wrong = client.post(
        "/integrations/withings/measurements",
        json=payload,
        headers={"Authorization": "Bearer wrong-token"},
    )
    assert wrong.status_code == 401

    # Valid token in Bearer -> 201
    auth_header = client.post(
        "/integrations/withings/measurements",
        json=payload,
        headers={"Authorization": "Bearer my-secret-token"},
    )
    assert auth_header.status_code == 201

    # Valid token in query param -> 201
    auth_query = client.post(
        "/integrations/withings/measurements?secret=my-secret-token",
        json=payload,
    )
    assert auth_query.status_code == 201
