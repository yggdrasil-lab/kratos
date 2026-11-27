"""Autoregulated workout prescription engine and LLM synthesizer."""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.autoregulation.jev import (
    classify_workout_decision_gates,
    compute_effective_sleep,
    resolve_effective_hrv,
    safe_float,
    safe_int,
)
from app.autoregulation.readiness import ReadinessAssessment, ReadinessTier, assess_readiness
from app.models import (
    Exercise,
    Routine,
    RoutineItem,
    Session as WorkoutSession,
    SessionItem,
    SetEntry,
    WeeklyPlan,
)
from app.ports.muninn import MuninnPort
from app.schemas import (
    RecommendedExerciseItem,
    WorkoutRecommendationRead,
    infer_weight_basis_from_name,
)
from app.training.plan import _match_day_entry, resolve_scheduled_day

logger = logging.getLogger(__name__)

WORKOUT_SYSTEM_PROMPT = """You are an expert strength & conditioning coach and hypertrophy scientist advising an athletic lifter.
Your recommendations are grounded in four scientific pillars:
1. Volume Landmarks (Israetel / RP): Scale sets between MEV (Minimum Effective Volume) and MRV (Maximum Recoverable Volume) based on readiness and recent muscle group volume. When fatigued, dial back to MEV.
2. Autoregulation & RIR (Helms / Schoenfeld): Dictate exact Reps-in-Reserve (RIR 1-2 on high recovery, RIR 2-3 on moderate, RIR 3-4 on low recovery).
3. Joint Sparing Biomechanics (McGill / Starrett): If user notes joint discomfort (e.g. shoulder pinching, tight lower back), recommend neutral-grip or chest-supported variations from the exercise catalog and provide specific tempo/form cues.
4. Concurrent Interference Avoidance (Hickson / Hawley): Near sports match play (e.g. badminton), spare the knee extensors and Achilles from heavy eccentric strain.

CRITICAL INSTRUCTIONS:
- You must strictly prescribe exercises that exist in the provided 'active_exercises' catalog or 'active_routines'. Never invent exercises not present in the user's database.
- Base 'suggested_weight_kg' on the athlete's actual past lifts in 'recent_lift_history'. For progressive overload when recovery is optimal, suggest +1.25kg to +2.5kg, or +1 rep.
- For dumbbell exercises, set "weight_basis" to "per_hand" and specify "suggested_weight_kg" as the single-dumbbell weight per hand (e.g. 15.0 for 15kg per dumbbell, never the combined pair load). For barbell, machine, or cable total loads, set "weight_basis" to "total".
- In 'recent_lift_history', if an exercise has "weight_basis": "per_hand" (or is a dumbbell exercise), the logged "weight_kg" is ALREADY the per-hand weight. NEVER divide it by 2. For example, if recent_lift_history shows Dumbbell Deadlift at 22kg, the athlete lifted 22kg per hand (44kg total), so maintain or progress from 22kg per hand, NEVER 11kg.
- When 'jev_decision_gates' indicates SHOULDER_SPARING, LUMBAR_SPARING, or KNEE_SPARING, strictly prioritize neutral-grip, chest-supported, or deloaded variations. When TIME_CRUNCH_30M is indicated, limit prescription to 2-3 high-impact exercises.
- For isometric or duration-based exercises (e.g. Plank), specify 'target_reps' as a timed hold (e.g. '45-60s hold') instead of dynamic reps. If the athlete is in an MEV deload or fatigued (RIR 3-4), never instruct to hold to failure; specify stopping shy of failure before form breaks down.
- If the database catalog has no exercises, return an empty array for "exercises".

You must respond ONLY with a valid JSON object matching this exact structure:
{
  "routine_name": "string (name of routine or scheduled focus)",
  "readiness_adaptation": "string (1-2 sentences on how today's volume and RIR were scaled for biometrics)",
  "target_rir": "string (e.g. 'RIR 1-2', 'RIR 3-4')",
  "volume_landmark": "string (e.g. 'MEV', 'MAV', 'Deload')",
  "rationale": "string (concise explanation synthesizing biometrics, past lifts, and scheduled split)",
  "exercises": [
    {
      "exercise_name": "string (must match a name from active_exercises or active_routines)",
      "target_sets": 2,
      "target_reps": "string (e.g. '8-10 reps')",
      "suggested_weight_kg": 15.0,
      "weight_basis": "per_hand" | "total",
      "notes": "string (specific form, tempo, or joint-sparing cue, e.g. 'Controlled 3s eccentric, neutral grip to spare shoulder')"
    }
  ],
  "recovery_status": "optimal" | "moderate" | "fatigued",
  "research_citation": "string (e.g. 'Israetel (Volume Landmarks) & Helms (RIR Autoregulation)')"
}
"""

_RESEARCH_CITATION = "Israetel (Volume Landmarks) & Helms (RIR Autoregulation)"
_LONG_NAP_MIN_HOURS = 0.75
_SLEEP_INERTIA_WINDOW_SECONDS = 3600


def _parse_nap_end_at(raw_end_at: object) -> datetime | None:
    if isinstance(raw_end_at, datetime):
        return raw_end_at
    if isinstance(raw_end_at, str) and raw_end_at.strip():
        try:
            return datetime.fromisoformat(raw_end_at.strip())
        except ValueError:
            return None
    return None


def _normalize_dt_pair(ref_dt: datetime, end_dt: datetime) -> tuple[datetime, datetime]:
    if ref_dt.tzinfo is None and end_dt.tzinfo is not None:
        ref_aware = ref_dt.replace(tzinfo=end_dt.tzinfo)
        return ref_aware.astimezone(timezone.utc), end_dt.astimezone(timezone.utc)
    if ref_dt.tzinfo is not None and end_dt.tzinfo is None:
        end_aware = end_dt.replace(tzinfo=ref_dt.tzinfo)
        return ref_dt.astimezone(timezone.utc), end_aware.astimezone(timezone.utc)
    if ref_dt.tzinfo is None and end_dt.tzinfo is None:
        return ref_dt.replace(tzinfo=timezone.utc), end_dt.replace(tzinfo=timezone.utc)
    return ref_dt.astimezone(timezone.utc), end_dt.astimezone(timezone.utc)


def _recent_long_nap_minutes(
    biometrics: dict[str, Any] | None,
    now_dt: datetime | None = None,
) -> int | None:
    """Return minutes since wake if a >=45m nap ended within the last 60 minutes."""
    if not biometrics:
        return None
    naps = biometrics.get("naps")
    if not isinstance(naps, list) or not naps:
        return None
    ref_dt = now_dt if now_dt is not None else datetime.now(timezone.utc)
    best_elapsed_s: float | None = None
    for nap in naps:
        if not isinstance(nap, dict):
            continue
        duration_h = safe_float(nap.get("duration_hours"))
        if duration_h is None or duration_h < _LONG_NAP_MIN_HOURS:
            continue
        end_dt = _parse_nap_end_at(nap.get("end_at"))
        if end_dt is None:
            continue
        ref_utc, end_utc = _normalize_dt_pair(ref_dt, end_dt)
        elapsed_s = (ref_utc - end_utc).total_seconds()
        if 0 <= elapsed_s < _SLEEP_INERTIA_WINDOW_SECONDS:
            if best_elapsed_s is None or elapsed_s < best_elapsed_s:
                best_elapsed_s = elapsed_s
    return int(best_elapsed_s // 60) if best_elapsed_s is not None else None


def _sleep_inertia_cue(
    activity_type: str,
    biometrics: dict[str, Any] | None,
    now_dt: datetime | None,
) -> str | None:
    if activity_type == "rest":
        return None
    minutes = _recent_long_nap_minutes(biometrics, now_dt)
    if minutes is None:
        return None
    return (
        f"Recent long nap ended {minutes}m ago: "
        "extend dynamic warmup 5-10 min for sleep inertia before heavy sets."
    )


def get_last_lift_for_exercise(db: Session, exercise_id) -> dict[str, Any] | None:
    """Query the user's most recent completed working set for one exercise."""
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
    if row is None or row.weight_kg is None:
        return None
    return {
        "weight_kg": float(row.weight_kg),
        "reps": row.reps,
        "rpe": float(row.rpe) if row.rpe is not None else None,
    }


def get_recent_lift_history(db: Session, limit: int = 15) -> list[dict[str, Any]]:
    """Query recent completed lift sets across sessions for LLM overload context."""
    stmt = (
        select(
            Exercise.name.label("exercise_name"),
            Exercise.weight_basis,
            SetEntry.reps,
            SetEntry.weight_kg,
            SetEntry.rpe,
            WorkoutSession.started_at,
        )
        .join(SessionItem, SessionItem.id == SetEntry.session_item_id)
        .join(WorkoutSession, WorkoutSession.id == SessionItem.session_id)
        .join(Exercise, Exercise.id == SessionItem.exercise_id)
        .where(
            WorkoutSession.deleted_at.is_(None),
            SetEntry.deleted_at.is_(None),
            SetEntry.status == "done",
            SetEntry.weight_kg.is_not(None),
        )
        .order_by(WorkoutSession.started_at.desc(), SetEntry.set_number.asc())
        .limit(limit)
    )
    rows = db.execute(stmt).all()
    return [
        {
            "exercise_name": row.exercise_name,
            "weight_basis": infer_weight_basis_from_name(row.exercise_name, row.weight_basis),
            "weight_kg": float(row.weight_kg) if row.weight_kg is not None else None,
            "reps": row.reps,
            "rpe": float(row.rpe) if row.rpe is not None else None,
            "date": row.started_at.strftime("%Y-%m-%d") if row.started_at else None,
        }
        for row in rows
    ]


def get_active_exercises(db: Session) -> list[dict[str, Any]]:
    """Query all non-deleted catalogue exercises."""
    stmt = (
        select(Exercise)
        .where(Exercise.deleted_at.is_(None))
        .order_by(Exercise.name)
    )
    return [
        {
            "id": str(ex.id),
            "name": ex.name,
            "tracking": ex.tracking,
            "weight_basis": infer_weight_basis_from_name(ex.name, ex.weight_basis),
            "primary_muscles": ex.primary_muscles or [],
            "secondary_muscles": ex.secondary_muscles or [],
            "equipment": ex.equipment,
            "progression_scheme": ex.progression_scheme,
        }
        for ex in db.scalars(stmt).all()
    ]


def get_recent_muscle_volume(db: Session, days: int = 7) -> dict[str, int]:
    """Compute completed set count per primary muscle group over the last N days."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    stmt = (
        select(Exercise.primary_muscles, func.count(SetEntry.id))
        .join(SessionItem, SessionItem.exercise_id == Exercise.id)
        .join(WorkoutSession, WorkoutSession.id == SessionItem.session_id)
        .join(SetEntry, SetEntry.session_item_id == SessionItem.id)
        .where(
            WorkoutSession.deleted_at.is_(None),
            SetEntry.deleted_at.is_(None),
            SetEntry.status == "done",
            WorkoutSession.started_at >= cutoff,
        )
        .group_by(Exercise.primary_muscles)
    )
    volume_by_muscle: dict[str, int] = {}
    for muscles, count in db.execute(stmt).all():
        if muscles:
            for muscle in muscles:
                volume_by_muscle[muscle] = volume_by_muscle.get(muscle, 0) + count
    return volume_by_muscle


def get_active_routines(db: Session) -> list[dict[str, Any]]:
    """Query all active routines and their ordered exercise slots."""
    stmt = (
        select(Routine)
        .where(Routine.deleted_at.is_(None))
        .options(selectinload(Routine.items).selectinload(RoutineItem.exercise))
        .order_by(Routine.name)
    )
    return [
        {
            "id": str(routine.id),
            "name": routine.name,
            "notes": routine.notes,
            "items": [
                {
                    "exercise_name": item.exercise.name if item.exercise else "Unknown",
                    "exercise_id": str(item.exercise_id),
                    "position": item.position,
                    "target_sets": item.target_sets,
                    "target_reps": item.target_reps,
                    "target_weight_kg": (
                        float(item.target_weight_kg)
                        if item.target_weight_kg is not None
                        else None
                    ),
                    "weight_basis": (
                        infer_weight_basis_from_name(
                            item.exercise.name, item.exercise.weight_basis
                        )
                        if item.exercise
                        else "total"
                    ),
                    "notes": item.notes,
                }
                for item in routine.items
                if item.deleted_at is None
            ],
        }
        for routine in db.scalars(stmt).all()
    ]


def _resolve_workout_schedule(
    target_date: date,
    weekly_plan: WeeklyPlan | None,
    db: Session | None,
) -> tuple[str, str, Routine | None, bool]:
    if db is not None:
        scheduled = resolve_scheduled_day(db, target_date, weekly_plan=weekly_plan)
        activity_name = scheduled.activity_name or "Rest & Active Recovery"
        has_routines = (
            db.scalar(select(Routine.id).where(Routine.deleted_at.is_(None)).limit(1))
            is not None
        )
        return (
            scheduled.activity_type,
            activity_name,
            scheduled.routine,
            has_routines or scheduled.weekly_plan is not None,
        )

    if weekly_plan and weekly_plan.days:
        entry = _match_day_entry(weekly_plan.days, target_date)
        if entry is not None:
            return (
                entry.get("type", "lift"),
                entry.get("sessionName") or entry.get("activity") or "Training",
                None,
                True,
            )
    return "rest", "Rest & Active Recovery", None, weekly_plan is not None


def _adaptation_metadata(tier: ReadinessTier) -> tuple[str, str, str, str]:
    if tier == "fatigued":
        return (
            "Volume scaled to Minimum Effective Volume (MEV). Deload 1 set per exercise, RIR 3-4.",
            "RIR 3-4",
            "MEV",
            "Low recovery telemetry detected. Backing off working volume prevents accumulated central fatigue.",
        )
    if tier == "moderate":
        return (
            "Moderate recovery. Maintain working weight, cap intensity around RPE 8 (RIR 2).",
            "RIR 2",
            "MAV",
            "Solid recovery foundation. Maintain stimulus without overshooting failure.",
        )
    return (
        "High recovery state. Prime day for progressive overload; push first working set to RIR 1.",
        "RIR 1",
        "MAV",
        "Optimal sleep and HRV dip. Push for +1 rep or micro-overload (+1.25kg).",
    )


def _default_exercise_note(tier: ReadinessTier) -> str:
    if tier == "fatigued":
        return "Control eccentric, stop 3 reps shy of failure."
    if tier == "moderate":
        return "Standard working weight, stop 2 reps shy of failure."
    return "Attempt +1 rep or micro-overload on first set if feeling strong."


def _build_routine_exercises(
    db: Session | None,
    routine: Routine | None,
    tier: ReadinessTier,
) -> list[RecommendedExerciseItem]:
    if routine is None or not routine.items:
        return []
    exercises: list[RecommendedExerciseItem] = []
    for item in routine.items:
        if item.deleted_at is not None or not item.exercise:
            continue
        target_sets = item.target_sets or 2
        if tier == "fatigued":
            target_sets = max(1, target_sets - 1)

        suggested_weight = (
            float(item.target_weight_kg) if item.target_weight_kg is not None else None
        )
        if suggested_weight is None and db is not None:
            last_lift = get_last_lift_for_exercise(db, item.exercise_id)
            if last_lift and last_lift.get("weight_kg") is not None:
                suggested_weight = last_lift["weight_kg"]

        notes = item.notes or _default_exercise_note(tier)
        if tier == "fatigued" and "hold to failure" in notes.lower():
            notes = "Hold with RIR 3-4, stopping before form breaks down."

        target_reps = (
            f"{item.target_duration_s}s hold"
            if item.target_duration_s
            else (f"{item.target_reps} reps" if item.target_reps else "8-10 reps")
        )
        exercises.append(
            RecommendedExerciseItem(
                exercise_name=item.exercise.name,
                target_sets=target_sets,
                target_reps=target_reps,
                suggested_weight_kg=suggested_weight,
                weight_basis=infer_weight_basis_from_name(
                    item.exercise.name, item.exercise.weight_basis
                ),
                notes=notes,
            )
        )
    return exercises


def generate_workout_recommendation(
    target_date: date,
    weekly_plan: WeeklyPlan | None = None,
    biometrics: dict[str, Any] | None = None,
    db: Session | None = None,
    *,
    muninn: MuninnPort | None = None,
    readiness: ReadinessAssessment | None = None,
    now: datetime | None = None,
) -> WorkoutRecommendationRead:
    """Generate a deterministic database-backed workout recommendation scaled by readiness."""
    assessment = readiness or assess_readiness(biometrics, muninn=muninn)
    tier = assessment.tier
    activity_type, activity_name, routine, has_plan_or_routines = _resolve_workout_schedule(
        target_date, weekly_plan, db
    )
    readiness_adaptation, target_rir, volume_landmark, rationale = _adaptation_metadata(tier)
    exercises: list[RecommendedExerciseItem] = []

    if activity_type == "sport":
        routine_name = activity_name
        readiness_adaptation = (
            "Sport activity scheduled. Preserve musculoskeletal freshness and prioritize mobility."
        )
        target_rir = "RIR 2-3"
        volume_landmark = "Sport Fueling"
        rationale = f"High-intensity intervals require glycogen and central nervous sharpness for {activity_name}."
    elif activity_type == "rest":
        routine_name = activity_name
        if tier != "fatigued":
            target_rir = "N/A"
            volume_landmark = "Deload"
        if not has_plan_or_routines:
            readiness_adaptation = (
                "No routines configured in database. Please configure a routine in Plan or tap Adapt to synthesize."
            )
            rationale = (
                "Database contains no scheduled routines or exercises. "
                "Configure your workout routines in the Plan tab to enable autoregulation."
            )
        else:
            readiness_adaptation = (
                "Full systemic recovery day. Prioritize walking, hydration, and parasympathetic down-regulation."
            )
            rationale = "Scheduled recovery day to allow tissue remodeling and glycogen replenishment."
    else:
        routine_name = routine.name if routine else activity_name
        exercises = _build_routine_exercises(db, routine, tier)
        if not exercises:
            readiness_adaptation = (
                f"Routine '{routine_name}' has no active exercises configured in database. "
                "Add exercises in Plan tab or tap Adapt to synthesize."
            )
            rationale = f"No active exercise entries found for {routine_name} in PostgreSQL."

    inertia_cue = _sleep_inertia_cue(activity_type, biometrics, now)
    if inertia_cue is not None:
        readiness_adaptation = f"{readiness_adaptation} {inertia_cue}"

    return WorkoutRecommendationRead(
        date=target_date.isoformat(),
        routine_name=routine_name,
        readiness_adaptation=readiness_adaptation,
        target_rir=target_rir,
        volume_landmark=volume_landmark,
        rationale=rationale,
        exercises=exercises,
        recovery_status=tier,
        research_citation=_RESEARCH_CITATION,
        is_llm_generated=False,
    )


def _build_workout_llm_context(
    target_date: date,
    activity_name: str,
    activity_type: str,
    biometrics: dict[str, Any] | None,
    recent_feedback: list[dict[str, Any]] | None,
    custom_context: str | None,
    db: Session | None,
    jev_gates: dict[str, str],
    inertia_cue: str | None = None,
) -> dict[str, Any]:
    bio = biometrics or {}
    overnight_h = safe_float(bio.get("sleep_duration_hours"))
    nap_h = safe_float(bio.get("nap_duration_hours"))
    payload: dict[str, Any] = {
        "date": target_date.isoformat(),
        "day_of_week": target_date.strftime("%A"),
        "scheduled_activity": {"name": activity_name, "type": activity_type},
        "biometrics": {
            "hrv_ms": resolve_effective_hrv(bio),
            "overnight_hrv_ms": safe_float(bio.get("overnight_hrv_ms")),
            "sleep_duration_hours": overnight_h,
            "nap_duration_hours": nap_h,
            "effective_sleep_hours": compute_effective_sleep(overnight_h, nap_h),
            "sleep_deep_hours": safe_float(bio.get("sleep_deep_hours")),
            "resting_hr_bpm": safe_int(bio.get("resting_hr_bpm")),
            "weight_kg": safe_float(bio.get("latest_weight_kg")),
        },
        "recent_lift_history": get_recent_lift_history(db) if db is not None else [],
        "active_exercises": get_active_exercises(db) if db is not None else [],
        "recent_muscle_volume_7d": get_recent_muscle_volume(db) if db is not None else {},
        "active_routines": get_active_routines(db) if db is not None else [],
        "recent_feedback": recent_feedback or [],
        "user_custom_instructions": custom_context
        or "None provided. Synthesize optimal training session.",
        "jev_decision_gates": {
            "recovery_tier": jev_gates.get("recovery_tier") or "AUTOMATIC",
            "joint_focus": jev_gates.get("joint_focus", "NOMINAL"),
            "time_budget": jev_gates.get("time_budget", "TIME_STANDARD_45M"),
        },
    }
    if inertia_cue is not None:
        payload["sleep_inertia_cue"] = inertia_cue
    return payload


def _parse_workout_llm_response(
    data: dict[str, Any],
    target_date: date,
    activity_name: str,
    fallback_tier: ReadinessTier,
) -> WorkoutRecommendationRead | None:
    if not data or not any(key in data for key in ("routine_name", "exercises", "rationale")):
        return None
    raw_status = data.get("recovery_status")
    recovery_status: ReadinessTier = (
        raw_status if raw_status in ("optimal", "moderate", "fatigued") else fallback_tier
    )
    exercises = [
        RecommendedExerciseItem(
            exercise_name=str(ex.get("exercise_name", "Exercise")),
            target_sets=int(ex.get("target_sets", 2)),
            target_reps=str(ex.get("target_reps", "8-10 reps")),
            suggested_weight_kg=(
                float(ex["suggested_weight_kg"])
                if ex.get("suggested_weight_kg") is not None
                else None
            ),
            weight_basis=infer_weight_basis_from_name(
                str(ex.get("exercise_name", "Exercise")),
                ex.get("weight_basis"),
            ),
            notes=ex.get("notes"),
        )
        for ex in (data.get("exercises") or [])
    ]
    return WorkoutRecommendationRead(
        date=target_date.isoformat(),
        routine_name=str(data.get("routine_name") or activity_name),
        readiness_adaptation=str(
            data.get("readiness_adaptation")
            or "Autoregulated according to current recovery status."
        ),
        target_rir=str(data.get("target_rir") or "RIR 2"),
        volume_landmark=str(data.get("volume_landmark") or "MAV"),
        rationale=str(
            data.get("rationale")
            or "Synthesized from recovery telemetry and database context."
        ),
        exercises=exercises,
        recovery_status=recovery_status,
        research_citation=str(data.get("research_citation") or _RESEARCH_CITATION),
        is_llm_generated=True,
    )


def synthesize_workout_recommendation(
    target_date: date,
    weekly_plan: WeeklyPlan | None = None,
    biometrics: dict[str, Any] | None = None,
    recent_feedback: list[dict[str, Any]] | None = None,
    custom_context: str | None = None,
    db: Session | None = None,
    *,
    muninn: MuninnPort | None = None,
    now: datetime | None = None,
) -> WorkoutRecommendationRead:
    """Synthesize workout prescription via MuninnPort, falling back cleanly to deterministic engine."""
    activity_type, activity_name, _, _ = _resolve_workout_schedule(
        target_date, weekly_plan, db
    )
    readiness = assess_readiness(biometrics, muninn=muninn, custom_context=custom_context)
    inertia_cue = _sleep_inertia_cue(activity_type, biometrics, now)

    if muninn is not None:
        jev_gates = classify_workout_decision_gates(muninn, biometrics, custom_context)
        context_payload = _build_workout_llm_context(
            target_date,
            activity_name,
            activity_type,
            biometrics,
            recent_feedback,
            custom_context,
            db,
            jev_gates,
            inertia_cue=inertia_cue,
        )
        user_prompt = (
            "Synthesize today's workout prescription and exercise cues based on athlete context:\n"
            f"{json.dumps(context_payload, indent=2)}"
        )
        try:
            content_data = muninn.synthesize_json(WORKOUT_SYSTEM_PROMPT, user_prompt)
            parsed = _parse_workout_llm_response(
                content_data, target_date, activity_name, readiness.tier
            )
            if parsed is not None:
                if (
                    inertia_cue is not None
                    and "sleep inertia" not in parsed.readiness_adaptation.lower()
                ):
                    parsed.readiness_adaptation = f"{parsed.readiness_adaptation} {inertia_cue}"
                return parsed
        except Exception as exc:
            logger.warning(
                "LLM workout synthesis failed (%s); falling back to deterministic engine", exc
            )

    baseline = generate_workout_recommendation(
        target_date,
        weekly_plan,
        biometrics,
        db=db,
        readiness=readiness,
        now=now,
    )
    baseline.is_llm_generated = False
    return baseline
