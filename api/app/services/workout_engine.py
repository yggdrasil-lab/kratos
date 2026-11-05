"""Deterministic baseline workout recommendation engine for Kratos.

Calculates default routine volume, RIR (Reps in Reserve), and readiness adaptation
based on Eir biometrics and scheduled WeeklyPlan. Acts as Tier 1 instant fallback.
"""

from datetime import date
from typing import Literal

from app.models import WeeklyPlan
from app.schemas import RecommendedExerciseItem, WorkoutRecommendationRead
from app.services.jev_client import classify_recovery_state_jev


def generate_workout_recommendation(
    target_date: date,
    weekly_plan: WeeklyPlan | None,
    biometrics: dict | None,
) -> WorkoutRecommendationRead:
    """Generates a baseline workout recommendation scaled by recovery telemetry."""
    weekday_name = target_date.strftime("%a")

    # 1. Evaluate recovery state (Jev System One classifier with fallback to biometric thresholds)
    sleep_h = biometrics.get("sleep_duration_hours") if biometrics else None
    hrv = biometrics.get("hrv_ms") if biometrics else None

    jev_verdict = classify_recovery_state_jev(biometrics)
    recovery_status: Literal["optimal", "moderate", "fatigued"] = "optimal"
    if jev_verdict in ("MEV_DELOAD", "ACTIVE_RECOVERY"):
        recovery_status = "fatigued"
    elif jev_verdict == "MAINTENANCE":
        recovery_status = "moderate"
    elif jev_verdict == "MAV_OVERLOAD":
        recovery_status = "optimal"
    else:
        if (sleep_h is not None and sleep_h < 5.5) or (hrv is not None and hrv < 35.0):
            recovery_status = "fatigued"
        elif (sleep_h is not None and sleep_h < 6.8) or (hrv is not None and hrv < 45.0):
            recovery_status = "moderate"

    # 2. Resolve scheduled activity from weekly plan
    activity_name = "Rest Day"
    activity_type = "rest"
    routine_name = "Rest & Mobility"

    if weekly_plan and weekly_plan.days:
        for day in weekly_plan.days:
            if day.get("day") == weekday_name:
                activity_name = day.get("activity", "Rest Day")
                activity_type = day.get("type", "rest")
                break
    else:
        # Default athletic schedule when no custom weekly plan is saved
        if weekday_name == "Mon":
            activity_name = "Upper Body A"
            activity_type = "lift"
        elif weekday_name in ("Tue", "Thu"):
            activity_name = "Badminton Match Play"
            activity_type = "sport"
        elif weekday_name == "Wed":
            activity_name = "Lower Body A"
            activity_type = "lift"
        elif weekday_name == "Sat":
            activity_name = "Upper Body B"
            activity_type = "lift"
        else:
            activity_name = "Rest & Active Recovery"
            activity_type = "rest"

    if activity_type == "sport":
        routine_name = "Badminton Court Session"
        readiness_adaptation = "Court match play prioritized. Preserve lower body freshness and focus on dynamic mobility."
        target_rir = "RIR 2-3"
        volume_landmark = "Sport Fueling"
        rationale = "Anaerobic court intervals require glycogen and central nervous system sharpness."
        exercises = [
            RecommendedExerciseItem(
                exercise_name="Dynamic Ankle & Hip Mobility",
                target_sets=2,
                target_reps="10 reps per side",
                suggested_weight_kg=None,
                notes="Light active mobility before court play.",
            ),
            RecommendedExerciseItem(
                exercise_name="Rotator Cuff & Shoulder Band Work",
                target_sets=2,
                target_reps="15 reps",
                suggested_weight_kg=None,
                notes="Activate external rotators to stabilize overhead smashes.",
            ),
        ]
    elif activity_type == "rest" or weekday_name in ("Fri", "Sun"):
        routine_name = "Rest & Active Recovery"
        readiness_adaptation = "Full systemic recovery day. Prioritize walking, hydration, and parasympathetic down-regulation."
        target_rir = "N/A"
        volume_landmark = "Deload"
        rationale = "Scheduled recovery day to allow tissue remodeling and glycogen replenishment."
        exercises = [
            RecommendedExerciseItem(
                exercise_name="Outdoor Parasympathetic Walk",
                target_sets=1,
                target_reps="30-45 minutes",
                suggested_weight_kg=None,
                notes="Low heart rate zone 1 walk to encourage lymphatic drainage and HRV recovery.",
            )
        ]
    else:
        # Default resistance training split (Upper or Lower)
        is_upper = weekday_name in ("Mon", "Thu", "Sat")
        routine_name = "Upper Body A" if is_upper else "Lower Body A"

        if recovery_status == "fatigued":
            readiness_adaptation = "Volume scaled to Minimum Effective Volume (MEV). Deload 1 set per exercise, RIR 3-4."
            target_rir = "RIR 3-4"
            volume_landmark = "MEV"
            rationale = "Low recovery telemetry detected. Backing off working volume prevents accumulated central fatigue."
            exercises = [
                RecommendedExerciseItem(
                    exercise_name="Dumbbell Bench Press" if is_upper else "Leg Press",
                    target_sets=2,
                    target_reps="8-10 reps",
                    suggested_weight_kg=30.0 if is_upper else 140.0,
                    notes="Control 3s eccentric, keep 3 reps in reserve.",
                ),
                RecommendedExerciseItem(
                    exercise_name="Overhead Press" if is_upper else "Romanian Deadlift",
                    target_sets=2,
                    target_reps="8-10 reps",
                    suggested_weight_kg=None,
                    notes="Pristine posture without axial strain.",
                ),
                RecommendedExerciseItem(
                    exercise_name="Chest-Supported Row" if is_upper else "Calf Raises",
                    target_sets=2,
                    target_reps="10-12 reps",
                    suggested_weight_kg=None,
                    notes="Squeeze upper back, avoid lower back rocking.",
                ),
            ]
        elif recovery_status == "moderate":
            readiness_adaptation = "Moderate recovery. Maintain working weight, cap intensity around RPE 8 (RIR 2)."
            target_rir = "RIR 2"
            volume_landmark = "MAV"
            rationale = "Solid recovery foundation. Maintain stimulus without overshooting failure."
            exercises = [
                RecommendedExerciseItem(
                    exercise_name="Dumbbell Bench Press" if is_upper else "Leg Press",
                    target_sets=2,
                    target_reps="8-10 reps",
                    suggested_weight_kg=30.0 if is_upper else 140.0,
                    notes="Standard working weight, stop 2 reps shy of failure.",
                ),
                RecommendedExerciseItem(
                    exercise_name="Overhead Press" if is_upper else "Romanian Deadlift",
                    target_sets=2,
                    target_reps="8-10 reps",
                    suggested_weight_kg=None,
                    notes="Controlled tempo on eccentric.",
                ),
                RecommendedExerciseItem(
                    exercise_name="Chest-Supported Row" if is_upper else "Calf Raises",
                    target_sets=2,
                    target_reps="10-12 reps",
                    suggested_weight_kg=None,
                    notes="Full scapular retraction at top.",
                ),
            ]
        else:
            readiness_adaptation = "High recovery state. Prime day for progressive overload; push first working set to RIR 1."
            target_rir = "RIR 1"
            volume_landmark = "MAV"
            rationale = "Optimal sleep and HRV dip. Push for +1 rep or micro-overload (+1.25kg)."
            exercises = [
                RecommendedExerciseItem(
                    exercise_name="Dumbbell Bench Press" if is_upper else "Leg Press",
                    target_sets=2,
                    target_reps="8-10 reps",
                    suggested_weight_kg=30.0 if is_upper else 140.0,
                    notes="Attempt +1 rep on first set if feeling strong.",
                ),
                RecommendedExerciseItem(
                    exercise_name="Overhead Press" if is_upper else "Romanian Deadlift",
                    target_sets=2,
                    target_reps="8-10 reps",
                    suggested_weight_kg=None,
                    notes="Explosive concentric drive.",
                ),
                RecommendedExerciseItem(
                    exercise_name="Chest-Supported Row" if is_upper else "Calf Raises",
                    target_sets=2,
                    target_reps="10-12 reps",
                    suggested_weight_kg=None,
                    notes="Full range of motion stretch.",
                ),
            ]

    return WorkoutRecommendationRead(
        date=target_date.isoformat(),
        routine_name=routine_name,
        readiness_adaptation=readiness_adaptation,
        target_rir=target_rir,
        volume_landmark=volume_landmark,
        rationale=rationale,
        exercises=exercises,
        recovery_status=recovery_status,
        research_citation="Israetel (Volume Landmarks) & Helms (RIR Autoregulation)",
        is_llm_generated=False,
    )
