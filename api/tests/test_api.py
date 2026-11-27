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
    for path in ("/exercises", "/routines", "/sessions", "/stats/volume", "/client-errors"):
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

    A client-generated ID is what makes this an upsert rather than an insert:
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


def test_duplicate_exercise_name_is_a_clean_conflict(client) -> None:
    """A second exercise with the same name is rejected, not a 500.

    The spec requires `exercise_create` to reject a duplicate by name rather
    than making a second one, and a duplicate name "must fail loudly": an
    unhandled IntegrityError is a 500, which is neither.
    """
    first = client.post("/exercises", json={"name": "Zercher Squat"})
    assert first.status_code == 201

    duplicate = client.post("/exercises", json={"name": "Zercher Squat"})
    assert duplicate.status_code == 409
    assert "already exists" in duplicate.json()["detail"]

    # The catalogue still holds exactly one row.
    assert len(client.get("/exercises").json()) == 1


def test_renaming_onto_an_existing_name_is_a_conflict(client) -> None:
    """The same guard covers PATCH, which can collide on rename."""
    client.post("/exercises", json={"name": "Overhead Press"})
    second = client.post("/exercises", json={"name": "Behind Neck Press"}).json()

    response = client.patch(f"/exercises/{second['id']}", json={"name": "Overhead Press"})
    assert response.status_code == 409
    assert "already exists" in response.json()["detail"]


def test_client_errors_endpoint(client) -> None:
    """Verifies client error telemetry captures frontend errors."""
    payload = {
        "message": "Failed to fetch catalogue",
        "source": "catalogue_fetch",
        "lineno": 145,
        "colno": 12,
        "error_type": "TypeError",
        "stack": "TypeError: Failed to fetch\n  at api.exercises (api.ts:28)",
        "url": "https://kratos.tienzo.net/",
        "user_agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
        "timestamp": "2026-11-03T03:00:00Z",
        "extra": {"component": "App"},
    }
    # Direct endpoint /client-errors
    res1 = client.post("/client-errors", json=payload)
    assert res1.status_code == 200
    assert res1.json() == {"status": "ok"}

    # Prefixed endpoint /api/client-errors
    res2 = client.post("/api/client-errors", json=payload)
    assert res2.status_code == 200
    assert res2.json() == {"status": "ok"}


def test_session_upsert_persists_item_extra_and_handles_missing_routine(client) -> None:
    """Verifies SessionItem.extra is persisted and missing routine_id falls back to None."""
    exercise_id = client.post("/exercises", json={"name": "Incline Dumbbell Press"}).json()["id"]
    routine_id = client.post("/routines", json={"name": "Push Day", "items": []}).json()["id"]
    session_id = str(uuid.uuid4())
    missing_routine_id = str(uuid.uuid4())

    payload = {
        "id": session_id,
        "routine_id": missing_routine_id,
        "started_at": dt.datetime(2026, 7, 3, 8, 0, tzinfo=dt.timezone.utc).isoformat(),
        "items": [
            {
                "exercise_id": exercise_id,
                "position": 0,
                "extra": {
                    "target_sets": 3,
                    "target_reps": "8-10",
                    "weight_basis": "per_hand",
                },
                "sets": [{"set_number": 1, "reps": 10, "weight_kg": 22.5}],
            }
        ],
    }

    resp = client.put(f"/sessions/{session_id}", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body["routine_id"] is None
    assert len(body["items"]) == 1
    assert body["items"][0]["extra"] == {
        "target_sets": 3,
        "target_reps": "8-10",
        "weight_basis": "per_hand",
    }

    fetched = client.get(f"/sessions/{session_id}")
    assert fetched.status_code == 200
    assert fetched.json()["routine_id"] is None
    assert fetched.json()["items"][0]["extra"]["weight_basis"] == "per_hand"

    # Valid existing routine_id is preserved on subsequent upsert.
    payload["routine_id"] = routine_id
    updated = client.put(f"/sessions/{session_id}", json=payload)
    assert updated.status_code == 200
    assert updated.json()["routine_id"] == routine_id


def test_cross_origin_request_omits_cors_headers(client) -> None:
    """Same-origin API behind Authentik does not emit CORS allow-origin headers."""
    response = client.get("/health", headers={"Origin": "https://evil.example"})
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers

    preflight = client.options(
        "/health",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert "access-control-allow-origin" not in preflight.headers


def test_retired_fasting_routes_return_not_found(client) -> None:
    """Retired fasting routes must return 404 and stay out of OpenAPI."""
    schema = client.get("/openapi.json").json()
    for path in (
        "/biometrics/fasting-recommendation",
        "/biometrics/fasting-recommendation/synthesize",
        "/biometrics/fasting",
    ):
        assert path not in schema["paths"]

    assert client.get("/biometrics/fasting-recommendation").status_code == 404
    assert client.post("/biometrics/fasting-recommendation/synthesize", json={}).status_code == 404
    assert client.post("/biometrics/fasting", json={}).status_code == 404


def test_biometrics_today_and_workout_include_nap_readiness_and_inertia_cue(client, fakes, db) -> None:
    from app.models import Exercise, Routine, RoutineItem, WeeklyPlan

    nzdt = dt.timezone(dt.timedelta(hours=13))
    fakes.clock.set_utc(dt.datetime(2026, 11, 27, 14, 48, 19, tzinfo=nzdt).astimezone(dt.timezone.utc))
    today_key = fakes.clock.today_str()
    fakes.eir.daily_by_date[today_key] = {
        "date": today_key,
        "hrv_ms": "50.02",
        "overnight_hrv_ms": "42.22",
        "sleep_duration_hours": 6.64,
        "sleep_deep_hours": 0.84,
        "sleep_rem_hours": 1.74,
        "nap_duration_hours": 2.51,
        "nap_count": 1,
        "total_sleep_hours": 9.15,
        "naps": [
            {
                "start_at": "2026-11-27T11:29:24+13:00",
                "end_at": "2026-11-27T14:18:19+13:00",
                "duration_hours": 2.51,
            }
        ],
    }

    resp = client.get("/biometrics/today")
    assert resp.status_code == 200
    bio = resp.json()
    assert bio["readiness"]["tier"] == "moderate"
    assert bio["nap_duration_hours"] == 2.51

    bench = Exercise(name="Incline Press", weight_basis="total", tracking="reps_weight")
    routine = Routine(name="Upper Push")
    routine.items.append(RoutineItem(exercise=bench, position=0, target_sets=3, target_reps=8))
    plan = WeeklyPlan(
        iso_week="2026-W48",
        days=[{"day": "Fri", "activity": "Upper Push", "type": "lift"}],
    )
    db.add_all([bench, routine, plan])
    db.commit()

    rec_resp = client.get(f"/biometrics/workout-recommendation?target_date={today_key}")
    assert rec_resp.status_code == 200
    assert "Recent long nap ended 30m ago" in rec_resp.json()["readiness_adaptation"]


