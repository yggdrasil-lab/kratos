"""Tests for session split, tombstone dismissal flags, and Eir proxy endpoints."""

from __future__ import annotations

import datetime as dt
import uuid

from app.ports.eir import EirUpstreamError
from app.schemas import (
    SuggestedSplitPoint,
    WorkoutMetricsRead,
    WorkoutTimelineBin,
    WorkoutTimelineRead,
)


def _create_parent_session(
    client,
    *,
    inferred: bool = True,
    started_at: str = "2026-11-23T04:30:00+00:00",
    ended_at: str = "2026-11-23T06:05:00+00:00",
) -> str:
    session_id = str(uuid.uuid4())
    resp = client.put(
        f"/sessions/{session_id}",
        json={
            "id": session_id,
            "started_at": started_at,
            "ended_at": ended_at,
            "extra": {
                "inferred": inferred,
                "confirmed": not inferred,
                "routine_name": "Resistance Training",
                "active_energy_kcal": 650,
            },
            "items": [],
        },
    )
    assert resp.status_code == 200
    return session_id


def test_list_sessions_include_deleted_and_dismissed_tombstone(client) -> None:
    confirmed_id = _create_parent_session(client, inferred=False)
    inferred_id = _create_parent_session(client, inferred=True)

    assert client.delete(f"/sessions/{confirmed_id}", params={"dismissed": "true"}).status_code == 204
    assert client.delete(f"/sessions/{inferred_id}").status_code == 204

    assert client.get("/sessions").json() == []

    deleted = client.get("/sessions", params={"include_deleted": "true"}).json()
    assert len(deleted) == 2
    for row in deleted:
        assert row["deleted_at"] is not None
        assert row["extra"]["dismissed"] is True


def test_delete_regular_session_without_dismissed_does_not_mark_dismissed(client) -> None:
    session_id = _create_parent_session(client, inferred=False)
    assert client.delete(f"/sessions/{session_id}").status_code == 204

    deleted = client.get("/sessions", params={"include_deleted": "true"}).json()
    assert len(deleted) == 1
    assert deleted[0]["deleted_at"] is not None
    assert deleted[0]["extra"].get("dismissed") is None


def test_workout_metrics_and_timeline_proxies_succeed_via_eir_port(client, fakes) -> None:
    fakes.eir.metrics_response = WorkoutMetricsRead(
        started_at=dt.datetime(2026, 11, 23, 4, 30, tzinfo=dt.timezone.utc),
        ended_at=dt.datetime(2026, 11, 23, 5, 0, tzinfo=dt.timezone.utc),
        duration_minutes=30,
        active_energy_kcal=240,
        avg_hr_bpm=148,
        peak_hr_bpm=169,
        step_count=1150,
        confidence="high",
        activity_type="class",
        classification="class",
        routine_name="Group Core",
        effort_rating="hard",
        rpe=8.2,
        trimp=94.5,
        hr_zones={"z4_threshold_pct": 45.0, "z5_anaerobic_pct": 25.0},
        hr_recovery_60s=24,
    )
    fakes.eir.timeline_response = WorkoutTimelineRead(
        started_at=dt.datetime(2026, 11, 23, 4, 30, tzinfo=dt.timezone.utc),
        ended_at=dt.datetime(2026, 11, 23, 5, 30, tzinfo=dt.timezone.utc),
        bins=[
            WorkoutTimelineBin(
                started_at=dt.datetime(2026, 11, 23, 4, 30, tzinfo=dt.timezone.utc),
                ended_at=dt.datetime(2026, 11, 23, 4, 35, tzinfo=dt.timezone.utc),
                avg_hr_bpm=146,
                peak_hr_bpm=162,
                hr_sample_count=22,
                step_count=320,
                active_energy_kcal=48,
                is_active_watch_mode=True,
            )
        ],
        suggested_splits=[
            SuggestedSplitPoint(
                split_at=dt.datetime(2026, 11, 23, 5, 0, tzinfo=dt.timezone.utc),
                resume_at=dt.datetime(2026, 11, 23, 5, 5, tzinfo=dt.timezone.utc),
                reason="Active Watch transition",
                confidence="high",
            )
        ],
    )

    metrics_resp = client.get(
        "/biometrics/workout-metrics",
        params={
            "started_at": "2026-11-23T04:30:00Z",
            "ended_at": "2026-11-23T05:00:00Z",
            "activity_type": "class",
            "routine_name": "Group Core",
        },
    )
    assert metrics_resp.status_code == 200
    metrics_body = metrics_resp.json()
    assert metrics_body["activity_type"] == "class"
    assert metrics_body["classification"] == "class"
    assert metrics_body["avg_hr_bpm"] == 148
    assert fakes.eir.metrics_requests[0]["activity_type"] == "class"
    assert fakes.eir.metrics_requests[0]["routine_name"] == "Group Core"

    timeline_resp = client.get(
        "/biometrics/workout-timeline",
        params={
            "started_at": "2026-11-23T04:30:00Z",
            "ended_at": "2026-11-23T05:30:00Z",
        },
    )
    assert timeline_resp.status_code == 200
    timeline_body = timeline_resp.json()
    assert len(timeline_body["bins"]) == 1
    assert timeline_body["bins"][0]["is_active_watch_mode"] is True
    assert timeline_body["suggested_splits"][0]["split_at"] == "2026-11-23T05:00:00Z"


def test_workout_proxies_fail_loudly_with_502_and_reject_invalid_windows(client, fakes) -> None:
    bad_resp = client.get(
        "/biometrics/workout-metrics",
        params={
            "started_at": "2026-11-23T05:00:00Z",
            "ended_at": "2026-11-23T05:00:00Z",
        },
    )
    assert bad_resp.status_code == 400

    fakes.eir.raise_on_metrics = EirUpstreamError("Eir offline")
    fakes.eir.raise_on_timeline = EirUpstreamError("Eir offline")

    assert (
        client.get(
            "/biometrics/workout-metrics",
            params={
                "started_at": "2026-11-23T04:30:00Z",
                "ended_at": "2026-11-23T05:00:00Z",
            },
        ).status_code
        == 502
    )
    assert (
        client.get(
            "/biometrics/workout-timeline",
            params={
                "started_at": "2026-11-23T04:30:00Z",
                "ended_at": "2026-11-23T05:30:00Z",
            },
        ).status_code
        == 502
    )


def test_split_session_atomically_creates_locked_children_and_tombstones_parent(
    client, fakes
) -> None:
    routine_resp = client.post("/routines", json={"name": "Lower Body A", "items": []})
    assert routine_resp.status_code == 201
    routine_id = routine_resp.json()["id"]
    parent_id = _create_parent_session(client, inferred=True)

    fakes.eir.metrics_responses = [
        WorkoutMetricsRead(
            started_at=dt.datetime(2026, 11, 23, 4, 30, tzinfo=dt.timezone.utc),
            ended_at=dt.datetime(2026, 11, 23, 5, 0, tzinfo=dt.timezone.utc),
            duration_minutes=30,
            active_energy_kcal=260,
            avg_hr_bpm=152,
            peak_hr_bpm=171,
            step_count=1400,
            confidence="high",
            activity_type="class",
            classification="class",
            routine_name="Group Core",
            effort_rating="hard",
            rpe=8.4,
            trimp=102.0,
            hr_zones={"z3_tempo_pct": 40.0, "z4_threshold_pct": 35.0},
            hr_recovery_60s=22,
        ),
        WorkoutMetricsRead(
            started_at=dt.datetime(2026, 11, 23, 5, 5, tzinfo=dt.timezone.utc),
            ended_at=dt.datetime(2026, 11, 23, 5, 30, tzinfo=dt.timezone.utc),
            duration_minutes=25,
            active_energy_kcal=190,
            avg_hr_bpm=134,
            peak_hr_bpm=155,
            step_count=620,
            confidence="high",
            activity_type="gym",
            classification="gym",
            routine_name="Lower Body A",
            effort_rating="optimal",
            rpe=7.2,
            trimp=68.0,
            hr_zones={"z3_tempo_pct": 40.0, "z4_threshold_pct": 35.0},
            hr_recovery_60s=28,
        ),
    ]

    split_resp = client.post(
        f"/sessions/{parent_id}/split",
        json={
            "segments": [
                {
                    "started_at": "2026-11-23T04:30:00Z",
                    "ended_at": "2026-11-23T05:00:00Z",
                    "routine_id": None,
                    "routine_name": "Group Core",
                    "activity_type": "class",
                    "classification": "class",
                    "notes": "Studio class",
                },
                {
                    "started_at": "2026-11-23T05:05:00Z",
                    "ended_at": "2026-11-23T05:30:00Z",
                    "routine_id": routine_id,
                    "routine_name": "Lower Body A",
                    "activity_type": "gym",
                    "classification": "gym",
                },
            ]
        },
    )
    assert split_resp.status_code == 200
    body = split_resp.json()
    assert body["parent_id"] == parent_id
    assert len(body["sessions"]) == 2

    assert fakes.eir.metrics_requests[0]["activity_type"] == "class"
    assert fakes.eir.metrics_requests[0]["classification"] == "class"

    first, second = body["sessions"]
    assert first["id"] != parent_id and second["id"] != parent_id
    assert first["routine_id"] is None
    assert first["extra"]["activity_type"] == "class"
    assert first["extra"]["classification"] == "class"
    assert first["extra"]["telemetry_locked"] is True
    assert first["extra"]["manual_split"] is True
    assert first["extra"]["inferred"] is False
    assert first["extra"]["confirmed"] is True
    assert first["extra"]["split_from_id"] == parent_id
    assert first["extra"]["avg_hr"] == 152
    assert first["extra"]["peak_hr"] == 171
    assert first["notes"] == "Studio class"

    assert second["routine_id"] == routine_id
    assert second["extra"]["activity_type"] == "gym"
    assert second["extra"]["telemetry_locked"] is True
    assert second["extra"]["manual_split"] is True
    assert second["extra"]["split_from_id"] == parent_id
    assert second["extra"]["avg_hr"] == 134

    active_sessions = client.get("/sessions").json()
    assert {s["id"] for s in active_sessions} == {first["id"], second["id"]}

    all_sessions = client.get("/sessions", params={"include_deleted": "true"}).json()
    parent_row = next(s for s in all_sessions if s["id"] == parent_id)
    assert parent_row["deleted_at"] is not None
    assert parent_row["extra"]["dismissed"] is True
    assert parent_row["extra"]["split_into_ids"] == [first["id"], second["id"]]


def test_split_session_validation_and_atomic_502_rollback(client, fakes) -> None:
    parent_id = _create_parent_session(client, inferred=True)

    too_few = client.post(
        f"/sessions/{parent_id}/split",
        json={
            "segments": [
                {
                    "started_at": "2026-11-23T04:30:00Z",
                    "ended_at": "2026-11-23T05:00:00Z",
                    "routine_name": "Only One",
                }
            ]
        },
    )
    assert too_few.status_code == 422

    overlap = client.post(
        f"/sessions/{parent_id}/split",
        json={
            "segments": [
                {
                    "started_at": "2026-11-23T04:30:00Z",
                    "ended_at": "2026-11-23T05:10:00Z",
                    "routine_name": "Seg 1",
                },
                {
                    "started_at": "2026-11-23T05:00:00Z",
                    "ended_at": "2026-11-23T05:30:00Z",
                    "routine_name": "Seg 2",
                },
            ]
        },
    )
    assert overlap.status_code == 422

    missing_routine = client.post(
        f"/sessions/{parent_id}/split",
        json={
            "segments": [
                {
                    "started_at": "2026-11-23T04:30:00Z",
                    "ended_at": "2026-11-23T05:00:00Z",
                    "routine_name": "Seg 1",
                },
                {
                    "started_at": "2026-11-23T05:00:00Z",
                    "ended_at": "2026-11-23T05:30:00Z",
                    "routine_id": str(uuid.uuid4()),
                    "routine_name": "Seg 2",
                },
            ]
        },
    )
    assert missing_routine.status_code == 422

    fakes.eir.metrics_responses = [
        WorkoutMetricsRead(
            started_at=dt.datetime(2026, 11, 23, 4, 30, tzinfo=dt.timezone.utc),
            ended_at=dt.datetime(2026, 11, 23, 5, 0, tzinfo=dt.timezone.utc),
            duration_minutes=30,
            active_energy_kcal=210,
        ),
        EirUpstreamError("Eir upstream HTTP 503"),
    ]
    failed_split = client.post(
        f"/sessions/{parent_id}/split",
        json={
            "segments": [
                {
                    "started_at": "2026-11-23T04:30:00Z",
                    "ended_at": "2026-11-23T05:00:00Z",
                    "routine_name": "Seg 1",
                },
                {
                    "started_at": "2026-11-23T05:00:00Z",
                    "ended_at": "2026-11-23T05:30:00Z",
                    "routine_name": "Seg 2",
                },
            ]
        },
    )
    assert failed_split.status_code == 502

    live = client.get("/sessions").json()
    assert len(live) == 1
    assert live[0]["id"] == parent_id

    missing_parent = client.post(
        f"/sessions/{uuid.uuid4()}/split",
        json={
            "segments": [
                {
                    "started_at": "2026-11-23T04:30:00Z",
                    "ended_at": "2026-11-23T05:00:00Z",
                },
                {
                    "started_at": "2026-11-23T05:00:00Z",
                    "ended_at": "2026-11-23T05:30:00Z",
                },
            ]
        },
    )
    assert missing_parent.status_code == 404


def test_retroactive_set_upsert_preserves_split_timestamps_and_locked_telemetry(
    client, fakes
) -> None:
    exercise_id = client.post("/exercises", json={"name": "Barbell Squat"}).json()["id"]
    routine_id = client.post("/routines", json={"name": "Lower Body A", "items": []}).json()["id"]
    parent_id = _create_parent_session(client, inferred=True)

    fakes.eir.metrics_responses = [
        WorkoutMetricsRead(
            started_at=dt.datetime(2026, 11, 23, 4, 30, tzinfo=dt.timezone.utc),
            ended_at=dt.datetime(2026, 11, 23, 5, 0, tzinfo=dt.timezone.utc),
            duration_minutes=30,
            active_energy_kcal=220,
        ),
        WorkoutMetricsRead(
            started_at=dt.datetime(2026, 11, 23, 5, 5, tzinfo=dt.timezone.utc),
            ended_at=dt.datetime(2026, 11, 23, 5, 30, tzinfo=dt.timezone.utc),
            duration_minutes=25,
            active_energy_kcal=195,
            avg_hr_bpm=136,
            peak_hr_bpm=158,
            rpe=7.5,
            trimp=72.0,
        ),
    ]

    split_body = client.post(
        f"/sessions/{parent_id}/split",
        json={
            "segments": [
                {
                    "started_at": "2026-11-23T04:30:00Z",
                    "ended_at": "2026-11-23T05:00:00Z",
                    "routine_name": "Group Core",
                    "activity_type": "class",
                },
                {
                    "started_at": "2026-11-23T05:05:00Z",
                    "ended_at": "2026-11-23T05:30:00Z",
                    "routine_id": routine_id,
                    "routine_name": "Lower Body A",
                    "activity_type": "gym",
                },
            ]
        },
    ).json()

    lift_session = split_body["sessions"][1]
    updated_resp = client.put(
        f"/sessions/{lift_session['id']}",
        json={
            "id": lift_session["id"],
            "routine_id": routine_id,
            "started_at": lift_session["started_at"],
            "ended_at": lift_session["ended_at"],
            "notes": lift_session["notes"],
            "extra": lift_session["extra"],
            "items": [
                {
                    "exercise_id": exercise_id,
                    "position": 0,
                    "sets": [{"set_number": 1, "status": "done", "reps": 8, "weight_kg": 80}],
                }
            ],
        },
    )
    assert updated_resp.status_code == 200
    saved = updated_resp.json()
    assert dt.datetime.fromisoformat(saved["started_at"]) == dt.datetime.fromisoformat(
        lift_session["started_at"]
    )
    assert dt.datetime.fromisoformat(saved["ended_at"]) == dt.datetime.fromisoformat(
        lift_session["ended_at"]
    )
    assert saved["extra"]["telemetry_locked"] is True
    assert saved["extra"]["manual_split"] is True
    assert saved["extra"]["avg_hr"] == 136
    assert len(saved["items"]) == 1
    assert saved["items"][0]["sets"][0]["reps"] == 8
