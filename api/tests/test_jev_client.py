"""Pytest tests for Jev decision helpers and unified ReadinessAssessment."""

from __future__ import annotations

import datetime as dt
import json

from sqlalchemy.orm import Session

from app.autoregulation.jev import (
    classify_recovery_state,
    classify_workout_decision_gates,
    format_biometric_summary,
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


def test_assess_readiness_nap_credit_overnight_hrv_and_clamping() -> None:
    # 2026-11-27 scenario: 6.64h overnight + 2.51h nap (effective 7.64h), overnight HRV 42.22 < 45 -> stays moderate
    nov_27 = assess_readiness(
        {
            "sleep_duration_hours": 6.64,
            "sleep_deep_hours": 0.84,
            "nap_duration_hours": 2.51,
            "overnight_hrv_ms": "42.22",
            "hrv_ms": "50.02",
        }
    )
    assert nov_27.tier == "moderate"
    assert nov_27.fatigue_flags == ()

    # Moderate overnight sleep (6.5h) + 1.5h nap (effective 7.25h) + 48ms overnight HRV -> lifts 1 tier to optimal
    lifted = assess_readiness(
        {
            "sleep_duration_hours": 6.5,
            "nap_duration_hours": 1.5,
            "overnight_hrv_ms": 48.0,
            "hrv_ms": 55.0,
        }
    )
    assert lifted.tier == "optimal"

    # Short overnight sleep (5.0h) + 2.5h nap (effective 6.0h) -> keeps short sleep fatigue flag & clamps to moderate
    clamped = assess_readiness(
        {
            "sleep_duration_hours": 5.0,
            "nap_duration_hours": 2.5,
            "overnight_hrv_ms": 48.0,
        }
    )
    assert clamped.tier == "moderate"
    assert clamped.fatigue_flags == ("short sleep (5.0h)",)


def test_format_biometric_summary_prefers_overnight_hrv_and_formats_nap() -> None:
    summary, has_vitals = format_biometric_summary(
        {
            "sleep_duration_hours": 6.64,
            "sleep_deep_hours": 0.84,
            "nap_duration_hours": 2.51,
            "overnight_hrv_ms": "42.22",
            "hrv_ms": "50.02",
        }
    )
    assert has_vitals is True
    assert "Sleep: 6.6h (0.8h deep)" in summary
    assert "Nap: 2.5h (Effective sleep: 7.6h)" in summary
    assert "HRV: 42.2ms" in summary
    assert "50.0ms" not in summary
