"""Pytest tests for Jev decision helpers and unified ReadinessAssessment."""

from __future__ import annotations

import datetime as dt
import json

from sqlalchemy.orm import Session

from app.autoregulation.jev import (
    classify_fasting_window,
    classify_recovery_state,
    classify_workout_decision_gates,
)
from app.autoregulation.readiness import assess_readiness
from app.autoregulation.workout import generate_workout_recommendation
from app.models import Exercise, Routine, RoutineItem
from app.ports.muninn import MuninnUpstreamError
from tests.fakes import InMemoryMuninnAdapter


def test_assess_readiness_unified_deterministic_thresholds() -> None:
    assert assess_readiness(None).tier == "optimal"
    assert assess_readiness({"sleep_duration_hours": 7.6, "hrv_ms": 55.0}).tier == "optimal"

    # Single fatigue flag (deep < 0.6 or rhr >= 78) or sleep < 6.8 or hrv < 45 -> moderate
    assert assess_readiness({"sleep_duration_hours": 6.4, "hrv_ms": 55.0}).tier == "moderate"
    assert assess_readiness({"sleep_duration_hours": 7.4, "hrv_ms": 40.0}).tier == "moderate"
    assert assess_readiness({"sleep_duration_hours": 7.5, "sleep_deep_hours": 0.5, "hrv_ms": 55.0}).tier == "moderate"
    assert assess_readiness({"sleep_duration_hours": 7.5, "hrv_ms": 55.0, "resting_hr_bpm": 78}).tier == "moderate"

    # Sleep < 5.5, HRV < 35, or >= 2 fatigue flags -> fatigued
    assert assess_readiness({"sleep_duration_hours": 5.4, "hrv_ms": 55.0}).tier == "fatigued"
    assert assess_readiness({"sleep_duration_hours": 7.5, "hrv_ms": 34.0}).tier == "fatigued"
    two_flags = assess_readiness(
        {"sleep_duration_hours": 7.5, "sleep_deep_hours": 0.4, "hrv_ms": 55.0, "resting_hr_bpm": 80}
    )
    assert two_flags.tier == "fatigued"
    assert len(two_flags.fatigue_flags) == 2


def test_assess_readiness_applies_jev_with_deterministic_fallback() -> None:
    muninn = InMemoryMuninnAdapter(jev_verdicts=["MEV_DELOAD", "MAINTENANCE", "MAV_OVERLOAD"])
    bio = {"sleep_duration_hours": 7.8, "hrv_ms": 55.0}

    assert assess_readiness(bio, muninn=muninn).tier == "fatigued"
    assert assess_readiness(bio, muninn=muninn).tier == "moderate"
    assert assess_readiness({"sleep_duration_hours": 5.0, "hrv_ms": 25.0}, muninn=muninn).tier == "optimal"

    broken = InMemoryMuninnAdapter(raise_on_decide=MuninnUpstreamError("offline"))
    assert assess_readiness({"sleep_duration_hours": 5.0, "hrv_ms": 25.0}, muninn=broken).tier == "fatigued"


def test_classify_recovery_state_string_biometrics_and_error_fallback() -> None:
    muninn = InMemoryMuninnAdapter(jev_verdicts=["MAV_OVERLOAD"])
    biometrics = {
        "sleep_duration_hours": "7.8",
        "sleep_deep_hours": "1.9",
        "hrv_ms": "50.26",
        "resting_hr_bpm": "56",
    }
    verdict = classify_recovery_state(muninn, biometrics)
    assert verdict == "MAV_OVERLOAD"
    prompt = muninn.decide_calls[0]["user_content"]
    assert "Sleep: 7.8h (1.9h deep)" in prompt
    assert "HRV: 50.3ms" in prompt
    assert "Resting HR: 56bpm" in prompt

    broken = InMemoryMuninnAdapter(raise_on_decide=MuninnUpstreamError("Connection refused"))
    assert classify_recovery_state(broken, biometrics) is None


def test_classify_workout_decision_gates_batched_and_fallback() -> None:
    muninn = InMemoryMuninnAdapter(
        jev_verdicts=[
            json.dumps(
                {
                    "recovery_tier": "MAV_OVERLOAD",
                    "joint_focus": "SHOULDER_SPARING",
                    "time_budget": "TIME_CRUNCH_30M",
                }
            )
        ]
    )
    gates = classify_workout_decision_gates(
        muninn,
        {"sleep_duration_hours": 8.0, "hrv_ms": 52.0},
        "Shoulder is slightly tender, need a quick 30 min session",
    )
    assert len(muninn.decide_calls) == 1
    assert gates == {
        "recovery_tier": "MAV_OVERLOAD",
        "joint_focus": "SHOULDER_SPARING",
        "time_budget": "TIME_CRUNCH_30M",
    }

    broken = InMemoryMuninnAdapter(raise_on_decide=MuninnUpstreamError("offline"))
    fallback = classify_workout_decision_gates(broken, None, None)
    assert fallback == {
        "recovery_tier": "MAINTENANCE",
        "joint_focus": "NOMINAL",
        "time_budget": "TIME_STANDARD_45M",
    }


def test_classify_fasting_window_calibrated_labels_only() -> None:
    muninn = InMemoryMuninnAdapter(
        jev_verdicts=["EVENING_SPORT_14_10", "DEEP_FAST_18_6", "EVENING_SPORT_16_8"]
    )
    assert (
        classify_fasting_window(muninn, "Badminton Match Play", {"sleep_duration_hours": 7.5})
        == "EVENING_SPORT_14_10"
    )
    assert (
        classify_fasting_window(muninn, "Friday Rest", {"sleep_duration_hours": 8.0})
        == "DEEP_FAST_18_6"
    )
    # Obsolete 16:8 labels must never be accepted.
    assert classify_fasting_window(muninn, "Badminton", {"sleep_duration_hours": 7.5}) is None


def test_workout_engine_integration_with_jev(db: Session) -> None:
    bench = Exercise(name="Bench Press", weight_basis="total", tracking="reps_weight")
    routine = Routine(name="Upper A")
    routine.items.append(RoutineItem(exercise=bench, position=0, target_sets=3, target_reps=10))
    db.add_all([bench, routine])
    db.commit()

    muninn = InMemoryMuninnAdapter(jev_verdicts=["MEV_DELOAD"])
    rec = generate_workout_recommendation(
        dt.date(2026, 11, 2),
        None,
        {"sleep_duration_hours": 7.0, "hrv_ms": 50.0},
        db=db,
        muninn=muninn,
    )
    assert rec.recovery_status == "fatigued"
    assert rec.volume_landmark == "MEV"
    assert rec.target_rir == "RIR 3-4"
    assert rec.exercises[0].target_sets == 2
