"""The API surface: the contract the TypeScript client is generated from."""

import datetime as dt
import uuid


def test_health_reports_the_database(client) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}


def test_openapi_schema_is_served(client) -> None:
    schema = client.get("/openapi.json").json()
    assert schema["info"]["title"] == "Kratos API"
    for path in ("/exercises", "/routines", "/sessions", "/stats/volume"):
        assert path in schema["paths"], path


def test_exercise_round_trip(client) -> None:
    created = client.post(
        "/exercises",
        json={
            "name": "Bench Press (Dumbbell)",
            "weight_basis": "per_hand",
            "primary_muscles": ["Chest"],
        },
    )
    assert created.status_code == 201
    exercise = created.json()
    assert exercise["weight_basis"] == "per_hand"

    fetched = client.get(f"/exercises/{exercise['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["name"] == "Bench Press (Dumbbell)"

    assert len(client.get("/exercises", params={"muscle": "Chest"}).json()) == 1
    assert client.get("/exercises", params={"muscle": "Quads"}).json() == []


def test_exercise_delete_is_a_tombstone(client) -> None:
    """The row leaves the API but stays in the table, so a second device learns."""
    exercise_id = client.post("/exercises", json={"name": "Squat"}).json()["id"]
    assert client.delete(f"/exercises/{exercise_id}").status_code == 204
    assert client.get(f"/exercises/{exercise_id}").status_code == 404
    assert client.get("/exercises").json() == []


def test_invalid_tracking_is_rejected(client) -> None:
    response = client.post("/exercises", json={"name": "Odd", "tracking": "vibes"})
    assert response.status_code == 422


def test_routine_with_ordered_items(client) -> None:
    exercise_id = client.post("/exercises", json={"name": "Deadlift"}).json()["id"]
    created = client.post(
        "/routines",
        json={
            "name": "Pull Day",
            "items": [
                {"exercise_id": exercise_id, "position": 1, "target_sets": 3, "target_reps": 5},
                {"exercise_id": exercise_id, "position": 2, "target_duration_s": 60},
            ],
        },
    )
    assert created.status_code == 201
    routine = created.json()
    assert [item["position"] for item in routine["items"]] == [1, 2]

    listed = client.get("/routines").json()
    assert len(listed) == 1 and listed[0]["name"] == "Pull Day"


def test_session_upsert_is_idempotent(client) -> None:
    """The outbox flushes the same session twice; the second write must not duplicate.

    A client-generated ID is what makes this an upsert rather than an insert —
    that is rule 5 of the schema, and it is what the offline-first design rests on.
    """
    exercise_id = client.post("/exercises", json={"name": "Overhead Press"}).json()["id"]
    session_id = str(uuid.uuid4())
    payload = {
        "id": session_id,
        "started_at": dt.datetime(2026, 7, 1, 8, 0, tzinfo=dt.timezone.utc).isoformat(),
        "items": [
            {
                "exercise_id": exercise_id,
                "position": 0,
                "sets": [{"set_number": 1, "reps": 8, "weight_kg": 40}],
            }
        ],
    }
    first = client.put(f"/sessions/{session_id}", json=payload)
    second = client.put(f"/sessions/{session_id}", json=payload)
    assert first.status_code == 200 and second.status_code == 200
    assert client.get("/sessions").json().__len__() == 1

    # A revised flush replaces the tree rather than appending to it.
    payload["items"][0]["sets"].append({"set_number": 2, "reps": 8, "weight_kg": 40})
    client.put(f"/sessions/{session_id}", json=payload)
    body = client.get(f"/sessions/{session_id}").json()
    assert len(body["items"]) == 1
    assert len(body["items"][0]["sets"]) == 2


def test_stats_endpoints_read_the_views(client) -> None:
    exercise_id = client.post(
        "/exercises", json={"name": "Front Squat", "weight_basis": "per_hand"}
    ).json()["id"]
    session_id = str(uuid.uuid4())
    client.put(
        f"/sessions/{session_id}",
        json={
            "id": session_id,
            "started_at": dt.datetime(2026, 7, 2, 8, 0, tzinfo=dt.timezone.utc).isoformat(),
            "items": [
                {
                    "exercise_id": exercise_id,
                    "position": 0,
                    "sets": [
                        {"set_number": 1, "reps": 10, "weight_kg": 20},
                        {"set_number": 2, "reps": 10, "weight_kg": 20},
                    ],
                }
            ],
        },
    )
    volume = client.get("/stats/volume").json()
    assert len(volume) == 1
    # 20kg x 10 x 2 sets, per hand -> doubled.
    assert float(volume[0]["volume_kg"]) == 800.0

    e1rm = client.get("/stats/e1rm", params={"exercise_id": exercise_id}).json()
    assert len(e1rm) == 2 and float(e1rm[0]["e1rm_kg"]) == 26.7

    last = client.get("/stats/last").json()
    assert len(last) == 1 and last[0]["reps"] == 10
