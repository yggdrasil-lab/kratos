"""Pytest integration and unit tests for the circadian fasting engine and readiness API."""

from __future__ import annotations

import datetime as dt

import pytest
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.autoregulation.coordinator import _persist_fasting_cache
from app.autoregulation.fasting import (
    generate_fasting_recommendation,
    synthesize_fasting_recommendation,
)
from app.models import FastingRecommendation, WeeklyPlan
from app.ports.muninn import MuninnUpstreamError
from app.schemas import FastingRecommendationRead
from tests.conftest import FakeAdapters
from tests.fakes import InMemoryMuninnAdapter


def test_fasting_engine_fatigue_override(db: Session) -> None:
    target_d = dt.date(2026, 11, 5)
    plan = WeeklyPlan(
        iso_week="2026-W45",
        days=[{"dayIndex": 3, "sessionName": "Badminton Match Play", "type": "sport"}],
    )
    db.add(plan)
    db.commit()

    biometrics = {
        "sleep_duration_hours": 5.2,
        "sleep_deep_hours": 0.4,
        "hrv_ms": 22.0,
        "resting_hr_bpm": 80,
    }
    rec = generate_fasting_recommendation(target_d, plan, biometrics, db=db)
    assert rec.target_window == "14:10"
    assert "Autoregulated Recovery Split" in rec.protocol_name
    assert rec.recovery_status == "fatigued"
    assert "High fatigue detected" in rec.rationale


def test_fasting_engine_badminton_fueling(db: Session) -> None:
    target_d = dt.date(2026, 11, 3)
    plan = WeeklyPlan(
        iso_week="2026-W45",
        days=[{"dayIndex": 1, "sessionName": "Badminton Focus", "type": "sport"}],
    )
    db.add(plan)
    db.commit()

    biometrics = {
        "sleep_duration_hours": 7.5,
        "sleep_deep_hours": 1.2,
        "hrv_ms": 55.0,
        "resting_hr_bpm": 62,
    }
    rec = generate_fasting_recommendation(target_d, plan, biometrics, db=db)
    assert rec.target_window == "14:10"
    assert rec.window_hours == "10:30 AM - 8:30 PM"
    assert "Badminton Court Fueling" in rec.protocol_name
    assert rec.recovery_status == "optimal"
    assert any("Pre-court top-up" in a and "whey" in a for a in rec.fueling_anchors)


def test_fasting_engine_lifting_split(db: Session) -> None:
    target_d = dt.date(2026, 11, 4)
    plan = WeeklyPlan(
        iso_week="2026-W45",
        days=[{"dayIndex": 2, "sessionName": "Lower Body A", "type": "lift"}],
    )
    db.add(plan)
    db.commit()

    biometrics = {
        "sleep_duration_hours": 7.0,
        "sleep_deep_hours": 0.9,
        "hrv_ms": 48.0,
    }
    rec = generate_fasting_recommendation(target_d, plan, biometrics, db=db)
    assert rec.target_window == "14:10"
    assert rec.window_hours == "10:30 AM - 8:30 PM"
    assert "Strength and Hypertrophy Split" in rec.protocol_name
    assert any("Plate triage, protein first" in a for a in rec.fueling_anchors)


def test_fasting_engine_rest_metabolic_reset_and_baseline_guards(db: Session) -> None:
    plan = WeeklyPlan(
        iso_week="2026-W45",
        days=[
            {"dayIndex": 3, "sessionName": "Rest Day", "type": "rest"},
            {"dayIndex": 4, "sessionName": "Rest and Reset", "type": "rest"},
        ],
    )
    db.add(plan)
    db.commit()

    optimal_bio = {"sleep_duration_hours": 8.0, "sleep_deep_hours": 1.5, "hrv_ms": 60.0}
    friday_optimal = generate_fasting_recommendation(dt.date(2026, 11, 6), plan, optimal_bio, db=db)
    assert friday_optimal.target_window == "18:6"
    assert "Deep Metabolic Reset" in friday_optimal.protocol_name
    assert "3:30 PM - 8:30 PM" in friday_optimal.window_hours

    thursday_optimal = generate_fasting_recommendation(dt.date(2026, 11, 5), plan, optimal_bio, db=db)
    assert thursday_optimal.target_window == "14:10"
    assert thursday_optimal.window_hours == "10:30 AM - 8:30 PM"
    assert "Deep Metabolic Reset" not in thursday_optimal.protocol_name

    friday_moderate = generate_fasting_recommendation(
        dt.date(2026, 11, 6),
        plan,
        {"sleep_duration_hours": 5.5, "sleep_deep_hours": 1.2, "hrv_ms": 55.0},
        db=db,
    )
    assert friday_moderate.recovery_status == "moderate"
    assert friday_moderate.target_window == "14:10"
    assert "Deep Metabolic Reset" not in friday_moderate.protocol_name


def test_fasting_engine_weekend_and_zero_cooking_anchors(db: Session) -> None:
    weekend = generate_fasting_recommendation(dt.date(2026, 11, 8), None, None, db=db)
    assert weekend.target_window == "14:10"
    assert weekend.window_hours == "10:30 AM - 8:30 PM"
    assert "Social Baseline" in weekend.protocol_name

    scenarios = [
        (dt.date(2026, 11, 3), [{"dayIndex": 1, "sessionName": "Badminton", "type": "sport"}], {"sleep_duration_hours": 7.5, "hrv_ms": 55.0}),
        (dt.date(2026, 11, 4), [{"dayIndex": 2, "sessionName": "Lower Body A", "type": "lift"}], {"sleep_duration_hours": 7.0, "hrv_ms": 48.0}),
        (dt.date(2026, 11, 5), [{"dayIndex": 3, "sessionName": "Rest Day", "type": "rest"}], {"sleep_duration_hours": 8.0, "hrv_ms": 60.0}),
        (dt.date(2026, 11, 6), [{"dayIndex": 4, "sessionName": "Rest and Reset", "type": "rest"}], {"sleep_duration_hours": 8.0, "hrv_ms": 60.0}),
        (dt.date(2026, 11, 8), [], None),
        (dt.date(2026, 11, 5), [{"dayIndex": 3, "sessionName": "Badminton", "type": "sport"}], {"sleep_duration_hours": 5.2, "sleep_deep_hours": 0.4, "hrv_ms": 22.0, "resting_hr_bpm": 80}),
    ]
    for target_d, days, bio in scenarios:
        plan = WeeklyPlan(iso_week="2026-W45", days=days)
        rec = generate_fasting_recommendation(target_d, plan, bio)
        joined = " ".join(rec.fueling_anchors).lower()
        assert "clean fast" in joined
        assert "plate triage" in joined
        for banned in ("oats", "avocado", "cook", "recipe", "meal prep"):
            assert banned not in joined
        assert rec.target_window != "16:8"


def test_fasting_llm_synthesis_success_and_fallback(db: Session) -> None:
    muninn = InMemoryMuninnAdapter(
        json_responses=[
            {
                "protocol_name": "14:10 Pre-Court Fueling",
                "target_window": "14:10",
                "window_hours": "10:30 AM - 8:30 PM",
                "rationale": "High-intensity badminton scheduled. Keep 14:10 window with pre-court whey top-up.",
                "fueling_anchors": [
                    "Morning: Clean fast with water, black coffee, or tea until 10:30 AM",
                    "05:00 PM: Pre-court whey shake",
                ],
                "recovery_status": "optimal",
                "activity_context": "Badminton Match Play (sport)",
                "research_citation": "Panda Lab (Circadian TRE) & Schoenfeld (MPS Distribution)",
            }
        ]
    )
    rec = synthesize_fasting_recommendation(
        target_date=dt.date(2026, 11, 5),
        weekly_plan=None,
        biometrics={"hrv_ms": 55.0, "sleep_duration_hours": 7.8},
        db=db,
        muninn=muninn,
    )
    assert rec.is_llm_generated is True
    assert rec.target_window == "14:10"
    assert rec.protocol_name == "14:10 Pre-Court Fueling"
    assert rec.research_citation == "Panda Lab (Circadian TRE) & Schoenfeld (MPS Distribution)"

    failing = InMemoryMuninnAdapter(
        raise_on_synthesize=MuninnUpstreamError("Connection refused"),
        raise_on_decide=MuninnUpstreamError("Connection refused"),
    )
    fallback = synthesize_fasting_recommendation(
        target_date=dt.date(2026, 11, 6),
        weekly_plan=None,
        biometrics={"hrv_ms": 50.0, "sleep_duration_hours": 8.0},
        db=db,
        muninn=failing,
    )
    assert fallback.is_llm_generated is False
    assert fallback.target_window == "18:6"
    assert "Deep Metabolic Reset" in fallback.protocol_name


def test_fasting_recommendation_api_and_caching(client, fakes: FakeAdapters) -> None:
    api_res = client.get("/biometrics/fasting-recommendation?target_date=2026-11-06")
    assert api_res.status_code == 200
    body = api_res.json()
    assert body["date"] == "2026-11-06"
    assert body["target_window"] == "18:6"
    assert len(body["fueling_anchors"]) >= 2

    fakes.muninn.json_responses.append(
        {
            "protocol_name": "14:10 Shifted Schedule Protocol",
            "target_window": "14:10",
            "window_hours": "11:00 AM - 9:00 PM",
            "rationale": "Custom user schedule adjustment incorporated with 3h pre-bed cutoff.",
            "fueling_anchors": ["11:00 AM: Meal 1", "04:00 PM: Meal 2", "08:30 PM: Recovery"],
            "recovery_status": "optimal",
            "activity_context": "Custom Split",
            "research_citation": "Circadian Daylight Alignment",
        }
    )
    synth_res = client.post(
        "/biometrics/fasting-recommendation/synthesize",
        json={"target_date": "2026-11-07", "custom_context": "Shift workout to 11am"},
    )
    assert synth_res.status_code == 200
    assert synth_res.json()["protocol_name"] == "14:10 Shifted Schedule Protocol"
    assert synth_res.json()["is_llm_generated"] is True
    call_count_after_synth = len(fakes.muninn.synthesize_calls)

    cached_res = client.get("/biometrics/fasting-recommendation?target_date=2026-11-07")
    assert cached_res.status_code == 200
    assert cached_res.json()["protocol_name"] == "14:10 Shifted Schedule Protocol"
    assert len(fakes.muninn.synthesize_calls) == call_count_after_synth


def test_biometrics_today_attaches_unified_readiness_and_preserves_none(
    client, fakes: FakeAdapters
) -> None:
    today_str = fakes.clock.today_str()
    assert client.get("/biometrics/today").json() is None

    fakes.eir.daily_by_date[today_str] = {
        "date": today_str,
        "sleep_duration_hours": 5.3,
        "sleep_deep_hours": 0.5,
        "hrv_ms": 32.0,
        "resting_hr_bpm": 79,
        "latest_weight_kg": 74.2,
    }
    res = client.get("/biometrics/today")
    assert res.status_code == 200
    payload = res.json()
    assert payload["sleep_duration_hours"] == 5.3
    assert payload["latest_weight_kg"] == 74.2
    assert payload["readiness"]["tier"] == "fatigued"
    assert payload["readiness"]["label"] == "Low Recovery"
    assert "message" in payload["readiness"]

    checkin = client.post(
        "/biometrics/fasting",
        json={
            "id": "checkin-1",
            "date": today_str,
            "target_window": "14:10",
            "adherence": "full",
            "logged_at": "2026-11-25T20:00:00Z",
        },
    )
    assert checkin.status_code == 200
    assert len(fakes.eir.fasting_feedback) == 1

    feedback = client.post(
        "/biometrics/workout-feedback",
        json={"date": today_str, "effort_rating": "optimal"},
    )
    assert feedback.status_code == 200
    assert len(fakes.eir.workout_feedback) == 1


def test_persist_fasting_cache_handles_unique_conflict_and_fails_loud(db: Session) -> None:
    existing = FastingRecommendation(
        date="2026-11-10",
        protocol_name="Old",
        target_window="14:10",
        window_hours="10:30 AM - 8:30 PM",
        rationale="Old",
        fueling_anchors=[],
        recovery_status="optimal",
        activity_context="Rest",
        is_llm_generated=False,
        extra={},
    )
    db.add(existing)
    db.commit()

    rec = FastingRecommendationRead(
        date="2026-11-10",
        protocol_name="Updated 14:10",
        target_window="14:10",
        window_hours="10:30 AM - 8:30 PM",
        rationale="Concurrent race update",
        fueling_anchors=["Clean fast"],
        recovery_status="moderate",
        activity_context="Rest",
        is_llm_generated=True,
    )
    _persist_fasting_cache(
        db, "2026-11-10", rec, existing=None, extra_payload={"source": "llm"}
    )
    row = db.query(FastingRecommendation).filter_by(date="2026-11-10").one()
    assert row.protocol_name == "Updated 14:10"
    assert row.recovery_status == "moderate"

    class _FailingSession:
        def __init__(self) -> None:
            self.rolled_back = False

        def add(self, _obj) -> None:
            return None

        def commit(self) -> None:
            raise OperationalError("INSERT", {}, Exception("db down"))

        def rollback(self) -> None:
            self.rolled_back = True

    failing = _FailingSession()
    with pytest.raises(OperationalError):
        _persist_fasting_cache(
            failing,  # type: ignore[arg-type]
            "2026-11-11",
            rec,
            existing=None,
            extra_payload={"source": "llm"},
        )
    assert failing.rolled_back is True
