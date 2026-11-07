"""Deterministic database-backed workout recommendation engine for Kratos.

Calculates routine volume, RIR (Reps in Reserve), and readiness adaptation
based on Eir biometrics and scheduled WeeklyPlan or active Routines in PostgreSQL.
Eliminates static exercise lists, hardcoded weekday splits, and dummy weights.
"""

from datetime import date
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import Exercise, Routine, RoutineItem, Session as WorkoutSession, SessionItem, SetEntry, WeeklyPlan
from app.schemas import RecommendedExerciseItem, WeightBasis, WorkoutRecommendationRead
from app.services.jev_client import classify_recovery_state_jev


def resolve_exercise_weight_basis(
    exercise_name: str,
    explicit_basis: str | None = None,
) -> WeightBasis:
    """Determines whether an exercise's weight is specified per hand (per dumbbell) or total load."""
    if explicit_basis == "per_hand":
        return "per_hand"
    lower_name = (exercise_name or "").lower()
    if "dumbbell" in lower_name or "db " in lower_name or "per hand" in lower_name or "per dumbbell" in lower_name:
        return "per_hand"
    if explicit_basis == "total":
        return "total"
    return "total"


def get_last_lift_for_exercise(db: Session, exercise_id) -> dict | None:
    """Queries user's last recorded lift for an exercise from completed workout sets."""
    try:
        stmt = (
            select(SetEntry.weight_kg, SetEntry.reps, SetEntry.rpe)
            .join(SessionItem, SessionItem.id == SetEntry.session_item_id)
            .join(WorkoutSession, WorkoutSession.id == SessionItem.session_id)
            .where(
                SessionItem.exercise_id == exercise_id,
                WorkoutSession.deleted_at.is_(None),
                SetEntry.deleted_at.is_(None),
                SetEntry.status == "done",
                SetEntry.weight_kg.is_not(None),
            )
            .order_by(WorkoutSession.started_at.desc(), SetEntry.set_number.asc())
            .limit(1)
        )
        row = db.execute(stmt).first()
        if row and row.weight_kg is not None:
            return {
                "weight_kg": float(row.weight_kg),
                "reps": row.reps,
                "rpe": float(row.rpe) if row.rpe is not None else None,
            }
    except Exception:
        pass
    return None


def generate_workout_recommendation(
    target_date: date,
    weekly_plan: WeeklyPlan | None = None,
    biometrics: dict | None = None,
    db: Session | None = None,
) -> WorkoutRecommendationRead:
    """Generates a database-backed workout recommendation scaled by recovery telemetry."""
    weekday_name = target_date.strftime("%a")
    day_of_week = target_date.weekday()

    # 1. Evaluate recovery state (Jev System One classifier with fallback to biometric thresholds)
    sleep_h_raw = biometrics.get("sleep_duration_hours") if biometrics else None
    hrv_raw = biometrics.get("hrv_ms") if biometrics else None

    sleep_h: float | None = None
    if sleep_h_raw is not None:
        try:
            sleep_h = float(sleep_h_raw)
        except (ValueError, TypeError):
            sleep_h = None

    hrv: float | None = None
    if hrv_raw is not None:
        try:
            hrv = float(hrv_raw)
        except (ValueError, TypeError):
            hrv = None

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

    # 2. Resolve scheduled activity from weekly plan or database routines
    activity_name: str | None = None
    activity_type: str = "rest"
    target_routine: Routine | None = None

    if weekly_plan and weekly_plan.days:
        for day in weekly_plan.days:
            if day.get("day") == weekday_name or day.get("dayIndex") == day_of_week:
                activity_name = day.get("activity") or day.get("sessionName")
                activity_type = day.get("type", "lift")
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
                for day in wp.days:
                    if day.get("day") == weekday_name or day.get("dayIndex") == day_of_week:
                        activity_name = day.get("activity") or day.get("sessionName")
                        activity_type = day.get("type", "lift")
                        break

            if not activity_name:
                routines = list(
                    db.scalars(
                        select(Routine)
                        .where(Routine.deleted_at.is_(None))
                        .options(selectinload(Routine.items).selectinload(RoutineItem.exercise))
                        .order_by(Routine.name)
                    )
                )
                if routines:
                    target_routine = routines[day_of_week % len(routines)]
                    activity_name = target_routine.name
                    activity_type = "lift"
        except Exception:
            pass

    if not activity_name:
        activity_name = "Rest & Active Recovery"
        activity_type = "rest"

    # 3. If lift and target_routine not yet resolved, query DB for routine matching activity_name
    if activity_type == "lift" and target_routine is None and db is not None:
        try:
            target_routine = db.scalar(
                select(Routine)
                .where(Routine.name.ilike(activity_name), Routine.deleted_at.is_(None))
                .options(selectinload(Routine.items).selectinload(RoutineItem.exercise))
            )
            if not target_routine:
                target_routine = db.scalar(
                    select(Routine)
                    .where(Routine.deleted_at.is_(None))
                    .options(selectinload(Routine.items).selectinload(RoutineItem.exercise))
                    .order_by(Routine.name)
                )
        except Exception:
            target_routine = None

    # 4. Set adaptation metadata according to autonomic recovery state
    if recovery_status == "fatigued":
        readiness_adaptation = "Volume scaled to Minimum Effective Volume (MEV). Deload 1 set per exercise, RIR 3-4."
        target_rir = "RIR 3-4"
        volume_landmark = "MEV"
        rationale = "Low recovery telemetry detected. Backing off working volume prevents accumulated central fatigue."
    elif recovery_status == "moderate":
        readiness_adaptation = "Moderate recovery. Maintain working weight, cap intensity around RPE 8 (RIR 2)."
        target_rir = "RIR 2"
        volume_landmark = "MAV"
        rationale = "Solid recovery foundation. Maintain stimulus without overshooting failure."
    else:
        readiness_adaptation = "High recovery state. Prime day for progressive overload; push first working set to RIR 1."
        target_rir = "RIR 1"
        volume_landmark = "MAV"
        rationale = "Optimal sleep and HRV dip. Push for +1 rep or micro-overload (+1.25kg)."

    # 5. Build dynamic exercise list from database routine (zero dummy weights or static exercises)
    exercises: list[RecommendedExerciseItem] = []

    if activity_type == "sport":
        routine_name = activity_name
        readiness_adaptation = "Sport activity scheduled. Preserve musculoskeletal freshness and prioritize mobility."
        target_rir = "RIR 2-3"
        volume_landmark = "Sport Fueling"
        rationale = f"High-intensity intervals require glycogen and central nervous sharpness for {activity_name}."
    elif activity_type == "rest":
        routine_name = activity_name
        if recovery_status != "fatigued":
            target_rir = "N/A"
            volume_landmark = "Deload"
        has_any_routines = False
        if db is not None:
            try:
                has_any_routines = db.scalar(select(Routine.id).where(Routine.deleted_at.is_(None)).limit(1)) is not None
            except Exception:
                has_any_routines = False
        if not has_any_routines and weekly_plan is None:
            readiness_adaptation = "No routines configured in database. Please configure a routine in Plan or tap Adapt to synthesize."
            rationale = "Database contains no scheduled routines or exercises. Configure your workout routines in the Plan tab to enable autoregulation."
        else:
            readiness_adaptation = "Full systemic recovery day. Prioritize walking, hydration, and parasympathetic down-regulation."
            rationale = "Scheduled recovery day to allow tissue remodeling and glycogen replenishment."
    else:
        routine_name = target_routine.name if target_routine else activity_name
        if target_routine and target_routine.items:
            for item in target_routine.items:
                if item.deleted_at is not None or not item.exercise:
                    continue
                target_sets = item.target_sets or 2
                if recovery_status == "fatigued":
                    target_sets = max(1, target_sets - 1)

                suggested_weight: float | None = (
                    float(item.target_weight_kg) if item.target_weight_kg is not None else None
                )
                if suggested_weight is None and db is not None:
                    last_lift = get_last_lift_for_exercise(db, item.exercise_id)
                    if last_lift and last_lift.get("weight_kg") is not None:
                        suggested_weight = last_lift["weight_kg"]

                basis = resolve_exercise_weight_basis(
                    item.exercise.name,
                    item.exercise.weight_basis,
                )
                notes = item.notes or (
                    "Control eccentric, stop 3 reps shy of failure."
                    if recovery_status == "fatigued"
                    else "Standard working weight, stop 2 reps shy of failure."
                    if recovery_status == "moderate"
                    else "Attempt +1 rep or micro-overload on first set if feeling strong."
                )

                exercises.append(
                    RecommendedExerciseItem(
                        exercise_name=item.exercise.name,
                        target_sets=target_sets,
                        target_reps=f"{item.target_reps} reps" if item.target_reps else "8-10 reps",
                        suggested_weight_kg=suggested_weight,
                        weight_basis=basis,
                        notes=notes,
                    )
                )

        if not exercises:
            readiness_adaptation = (
                f"Routine '{routine_name}' has no active exercises configured in database. "
                "Add exercises in Plan tab or tap Adapt to synthesize."
            )
            rationale = f"No active exercise entries found for {routine_name} in PostgreSQL."

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
