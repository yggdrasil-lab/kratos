"""Smart fasting recommendation engine.

Evaluates scheduled activity (lifting, badminton, rest) and live biometric recovery
(sleep, deep sleep, HRV, RHR) to compute an autoregulated fasting window and fueling anchors.
"""

from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Routine, WeeklyPlan
from app.schemas import FastingRecommendationRead
from app.services.jev_client import classify_fasting_window_jev


def generate_fasting_recommendation(
    target_date: date,
    weekly_plan: WeeklyPlan | None = None,
    biometrics: dict[str, Any] | None = None,
    db: Session | None = None,
) -> FastingRecommendationRead:
    """Computes an autoregulated fasting protocol and fueling anchors for a calendar day."""
    day_of_week = target_date.weekday()  # 0 = Monday, ..., 6 = Sunday
    weekday_name = target_date.strftime("%a")
    date_str = target_date.isoformat()

    # 1. Resolve today's planned activity context from weekly_plan or PostgreSQL database
    activity_type: str = "rest"
    activity_name: str | None = None

    if weekly_plan and weekly_plan.days:
        for d in weekly_plan.days:
            # dayIndex can match day_of_week, day name, or list index
            if d.get("day") == weekday_name or d.get("dayIndex") == day_of_week or (d.get("dayIndex") is None and weekly_plan.days.index(d) == day_of_week):
                activity_type = d.get("type", "lift")
                activity_name = d.get("sessionName") or d.get("activity", "Training")
                break

    if not activity_name and db is not None:
        try:
            iso_year, iso_week, _ = target_date.isocalendar()
            iso_week_str = f"{iso_year}-W{iso_week:02d}"
            wp = db.scalar(
                select(WeeklyPlan).where(
                    WeeklyPlan.iso_week == iso_week_str,
                    WeeklyPlan.deleted_at.is_(None),
                )
            )
            if wp and wp.days:
                for d in wp.days:
                    if d.get("day") == weekday_name or d.get("dayIndex") == day_of_week or (d.get("dayIndex") is None and wp.days.index(d) == day_of_week):
                        activity_type = d.get("type", "lift")
                        activity_name = d.get("sessionName") or d.get("activity", "Training")
                        break

            if not activity_name:
                routines = list(
                    db.scalars(
                        select(Routine)
                        .where(Routine.deleted_at.is_(None))
                        .order_by(Routine.name)
                    )
                )
                if routines:
                    routine = routines[day_of_week % len(routines)]
                    activity_type = "lift"
                    activity_name = routine.name
        except Exception:
            pass

    if not activity_name:
        if day_of_week in (5, 6):
            activity_type = "rest"
            activity_name = "Weekend Social Baseline"
        elif day_of_week == 4:
            activity_type = "rest"
            activity_name = "Rest and Reset"
        else:
            activity_type = "rest"
            activity_name = "Rest Day"

    # 2. Evaluate autonomic recovery status from wearable telemetry
    bio = biometrics or {}
    sleep_h = bio.get("sleep_duration_hours")
    deep_h = bio.get("sleep_deep_hours")
    hrv = bio.get("hrv_ms")
    if hrv is not None:
        try:
            hrv = float(hrv)
        except (ValueError, TypeError):
            hrv = None

    rhr = bio.get("resting_hr_bpm")

    fatigue_flags: list[str] = []
    if sleep_h is not None and sleep_h < 5.8:
        fatigue_flags.append(f"short sleep ({sleep_h:.1f}h)")
    if deep_h is not None and deep_h < 0.6:
        fatigue_flags.append(f"low deep sleep ({deep_h:.1f}h)")
    if hrv is not None and hrv < 30.0:
        fatigue_flags.append(f"suppressed HRV ({round(hrv)}ms)")
    if rhr is not None and rhr >= 78:
        fatigue_flags.append(f"elevated RHR ({rhr} bpm)")

    jev_window = classify_fasting_window_jev(f"{activity_name} ({activity_type})", biometrics)
    if jev_window == "GENTLE_14_10":
        recovery_status = "fatigued"
    elif len(fatigue_flags) >= 2 or (sleep_h is not None and sleep_h < 5.0) or (hrv is not None and hrv < 20.0):
        recovery_status = "fatigued"
    elif len(fatigue_flags) == 1:
        recovery_status = "moderate"
    else:
        recovery_status = "optimal"

    # 3. Autoregulated Decision Rules

    # Rule A: High Autonomic Fatigue -> Relax fasting to protect against cortisol spikes
    if recovery_status == "fatigued":
        flag_summary = ", ".join(fatigue_flags) if fatigue_flags else "autonomic recovery deficit"
        return FastingRecommendationRead(
            date=date_str,
            protocol_name="14:10 Autoregulated Recovery Split",
            target_window="14:10",
            window_hours="11:00 AM - 9:00 PM",
            rationale=(
                f"High fatigue detected: {flag_summary}. Fasting duration is relaxed to blunt "
                f"cortisol, protect lean tissue, and support autonomic rebound."
            ),
            fueling_anchors=[
                "11:00 AM: Early break-fast with 40g whey/eggs and healthy fats",
                "02:30 PM: Balanced nutrient-dense lunch with complex carbohydrates",
                "08:00 PM: High-protein dinner with magnesium and extra hydration",
            ],
            recovery_status="fatigued",
            activity_context=f"{activity_name} ({activity_type})",
        )

    # Rule B: Evening Court Sport (Badminton) -> Shift feeding window later
    is_badminton = "badminton" in activity_name.lower() or (activity_type == "sport" and day_of_week in (1, 3))
    if activity_type == "sport" or is_badminton:
        return FastingRecommendationRead(
            date=date_str,
            protocol_name="16:8 Badminton Court Fueling",
            target_window="16:8",
            window_hours="12:30 PM - 9:30 PM",
            rationale=(
                f"Evening court session scheduled ({activity_name}). Window shifted later to allow "
                f"5:00 PM pre-court fuel and post-court protein recovery before 10:00 PM."
            ),
            fueling_anchors=[
                "12:30 PM: Clean balanced lunch with sustained carbs and 40g protein",
                "05:00 PM: Pre-court fuel (oats + whey, banana, electrolytes)",
                "09:30 PM: Post-court recovery protein shake (close window by 10:00 PM)",
            ],
            recovery_status=recovery_status,
            activity_context=f"{activity_name} (sport)",
        )

    # Rule C: Resistance Training / Lifting -> Post-workout protein timing
    if activity_type == "lift":
        return FastingRecommendationRead(
            date=date_str,
            protocol_name="16:8 Strength and Hypertrophy Split",
            target_window="16:8",
            window_hours="12:30 PM - 8:30 PM",
            rationale=(
                f"Resistance training scheduled ({activity_name}). Fasting window timed to break "
                f"fast post-workout with 45g protein to maximize muscle protein synthesis."
            ),
            fueling_anchors=[
                "12:30 PM: Break fast with 45g protein + complex carbohydrates",
                "04:30 PM: Midday protein snack + fresh fruit",
                "08:00 PM: High-protein dinner + greens (close window by 8:30 PM)",
            ],
            recovery_status=recovery_status,
            activity_context=f"{activity_name} (lift)",
        )

    # Rule D: Weekend Social Baseline
    if day_of_week in (5, 6):
        return FastingRecommendationRead(
            date=date_str,
            protocol_name="14:10 Social Baseline",
            target_window="14:10",
            window_hours="10:30 AM - 8:30 PM",
            rationale=(
                "Weekend schedule. Flexible feeding window prioritizing mindful portions "
                "and family meals while maintaining circadian metabolic consistency."
            ),
            fueling_anchors=[
                "10:30 AM: Mindful brunch with high protein and eggs",
                "07:30 PM: Dinner with family and friends; avoid high-sugar late snacking",
            ],
            recovery_status=recovery_status,
            activity_context=f"{activity_name} (weekend)",
        )

    # Rule E: Weekday Rest / Reset with Solid Recovery -> 18:6 Deep Metabolic Reset
    return FastingRecommendationRead(
        date=date_str,
        protocol_name="18:6 Deep Metabolic Reset",
        target_window="18:6",
        window_hours="3:30 PM - 8:30 PM",
        rationale=(
            f"Rest day with {recovery_status} autonomic recovery. Extended fasting window "
            f"promotes deep fat oxidation and cellular autophagy without training interference."
        ),
        fueling_anchors=[
            "Morning: High hydration + black coffee + pink salt/electrolytes",
            "03:30 PM: Break fast with dense protein, avocado, and vegetables",
            "08:00 PM: Moderate carb, high-protein dinner to prepare for tomorrow",
        ],
        recovery_status=recovery_status,
        activity_context=f"{activity_name} (rest)",
    )
