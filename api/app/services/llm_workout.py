"""LLM Autoregulated Workout & Exercise Science Synthesizer for Kratos.

Grounded in peer-reviewed exercise physiology and hypertrophy literature:
1. Volume Landmarks & Fatigue Titration (Dr. Mike Israetel, Renaissance Periodization):
   Scale working sets between MEV (Minimum Effective Volume) and MRV (Maximum Recoverable Volume).
2. Autoregulation & Reps-in-Reserve (Dr. Eric Helms, Brad Schoenfeld, Zourdos):
   Determine target RIR based on sleep debt, HRV deviation, and past lift history.
3. Biomechanics & Joint Sparing (Dr. Stuart McGill, Kelly Starrett):
   Neutral grips, chest support, or joint-sparing substitutions if user reports joint friction or soreness.
4. Concurrent Interference Avoidance (Hickson, Coffey & Hawley):
   Mitigate lower-body damage near sports match play to preserve court explosiveness.
"""

from datetime import date, datetime, timedelta, timezone
import json
import logging
import urllib.error
import urllib.request

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.config import settings
from app.models import (
    Exercise,
    Routine,
    RoutineItem,
    Session as WorkoutSession,
    SessionItem,
    SetEntry,
    WeeklyPlan,
)
from app.schemas import RecommendedExerciseItem, WorkoutRecommendationRead
from app.services.jev_client import (
    classify_constraints_jev,
    classify_recovery_state_jev,
    classify_workout_decision_gates,
)
from app.services.workout_engine import (
    generate_workout_recommendation,
    resolve_exercise_weight_basis,
)

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are an expert strength & conditioning coach and hypertrophy scientist advising an athletic lifter.
Your recommendations are grounded in four scientific pillars:
1. Volume Landmarks (Israetel / RP): Scale sets between MEV (Minimum Effective Volume) and MRV (Maximum Recoverable Volume) based on readiness and recent muscle group volume. When fatigued, dial back to MEV.
2. Autoregulation & RIR (Helms / Schoenfeld): Dictate exact Reps-in-Reserve (RIR 1-2 on high recovery, RIR 2-3 on moderate, RIR 3-4 on low recovery).
3. Joint Sparing Biomechanics (McGill / Starrett): If user notes joint discomfort (e.g. shoulder pinching, tight lower back), recommend neutral-grip or chest-supported variations from the exercise catalog and provide specific tempo/form cues.
4. Concurrent Interference Avoidance (Hickson / Hawley): Near sports match play (e.g. badminton), spare the knee extensors and Achilles from heavy eccentric strain.

CRITICAL INSTRUCTIONS:
- You must strictly prescribe exercises that exist in the provided 'active_exercises' catalog or 'active_routines'. Never invent exercises not present in the user's database.
- Base 'suggested_weight_kg' on the athlete's actual past lifts in 'recent_lift_history'. For progressive overload when recovery is optimal, suggest +1.25kg to +2.5kg, or +1 rep.
- For dumbbell exercises, set "weight_basis" to "per_hand" and specify "suggested_weight_kg" as the single-dumbbell weight per hand (e.g. 15.0 for 15kg per dumbbell, never the combined pair load). For barbell, machine, or cable total loads, set "weight_basis" to "total".
- When 'jev_decision_gates' indicates SHOULDER_SPARING, LUMBAR_SPARING, or KNEE_SPARING, strictly prioritize neutral-grip, chest-supported, or deloaded variations. When TIME_CRUNCH_30M is indicated, limit prescription to 2-3 high-impact exercises.
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


def get_recent_lift_history(db: Session, limit: int = 15) -> list[dict]:
    """Queries user's recent lift history from completed workout sessions."""
    try:
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
                "weight_basis": row.weight_basis,
                "weight_kg": float(row.weight_kg) if row.weight_kg is not None else None,
                "reps": row.reps,
                "rpe": float(row.rpe) if row.rpe is not None else None,
                "date": row.started_at.strftime("%Y-%m-%d") if row.started_at else None,
            }
            for row in rows
        ]
    except Exception as exc:
        logger.warning("Failed querying recent lift history: %s", exc)
        return []


def get_active_exercises(db: Session) -> list[dict]:
    """Queries active exercises from the catalogue."""
    try:
        stmt = (
            select(Exercise)
            .where(Exercise.deleted_at.is_(None))
            .order_by(Exercise.name)
        )
        exercises = db.scalars(stmt).all()
        return [
            {
                "id": str(ex.id),
                "name": ex.name,
                "tracking": ex.tracking,
                "weight_basis": ex.weight_basis,
                "primary_muscles": ex.primary_muscles or [],
                "secondary_muscles": ex.secondary_muscles or [],
                "equipment": ex.equipment,
                "progression_scheme": ex.progression_scheme,
            }
            for ex in exercises
        ]
    except Exception as exc:
        logger.warning("Failed querying active exercises: %s", exc)
        return []


def get_recent_muscle_volume(db: Session, days: int = 7) -> dict[str, int]:
    """Computes completed set count per primary muscle group over the last N days."""
    try:
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
                for m in muscles:
                    volume_by_muscle[m] = volume_by_muscle.get(m, 0) + count
        return volume_by_muscle
    except Exception as exc:
        logger.warning("Failed computing recent muscle volume: %s", exc)
        return {}


def get_active_routines(db: Session) -> list[dict]:
    """Queries active routines and routine items from PostgreSQL."""
    try:
        stmt = (
            select(Routine)
            .where(Routine.deleted_at.is_(None))
            .options(selectinload(Routine.items).selectinload(RoutineItem.exercise))
            .order_by(Routine.name)
        )
        routines = db.scalars(stmt).all()
        return [
            {
                "id": str(r.id),
                "name": r.name,
                "notes": r.notes,
                "items": [
                    {
                        "exercise_name": it.exercise.name if it.exercise else "Unknown",
                        "exercise_id": str(it.exercise_id),
                        "position": it.position,
                        "target_sets": it.target_sets,
                        "target_reps": it.target_reps,
                        "target_weight_kg": float(it.target_weight_kg) if it.target_weight_kg is not None else None,
                        "weight_basis": it.exercise.weight_basis if it.exercise else "total",
                        "notes": it.notes,
                    }
                    for it in r.items
                    if it.deleted_at is None
                ],
            }
            for r in routines
        ]
    except Exception as exc:
        logger.warning("Failed querying active routines: %s", exc)
        return []


def synthesize_workout_recommendation_llm(
    target_date: date,
    weekly_plan: WeeklyPlan | None = None,
    biometrics: dict | None = None,
    recent_feedback: list[dict] | None = None,
    custom_context: str | None = None,
    db: Session | None = None,
) -> WorkoutRecommendationRead:
    """Synthesizes an adaptive, research-grounded workout recommendation via LLM, falling back to deterministic baseline if unavailable."""
    try:
        weekday_name = target_date.strftime("%a")
        day_of_week = target_date.weekday()
        activity_name = "Rest Day"
        activity_type = "rest"

        if weekly_plan and weekly_plan.days:
            for day in weekly_plan.days:
                if day.get("day") == weekday_name or day.get("dayIndex") == day_of_week:
                    activity_name = day.get("activity") or day.get("sessionName", "Rest Day")
                    activity_type = day.get("type", "rest")
                    break
        elif db is not None:
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
                        activity_name = day.get("activity") or day.get("sessionName", "Rest Day")
                        activity_type = day.get("type", "rest")
                        break
            else:
                routines = list(
                    db.scalars(
                        select(Routine)
                        .where(Routine.deleted_at.is_(None))
                        .order_by(Routine.name)
                    )
                )
                if routines:
                    routine = routines[day_of_week % len(routines)]
                    activity_name = routine.name
                    activity_type = "lift"

        try:
            hrv = float(biometrics["hrv_ms"]) if biometrics and biometrics.get("hrv_ms") is not None else None
        except (ValueError, TypeError):
            hrv = None
        try:
            sleep_h = float(biometrics["sleep_duration_hours"]) if biometrics and biometrics.get("sleep_duration_hours") is not None else None
        except (ValueError, TypeError):
            sleep_h = None
        try:
            deep_sleep_h = float(biometrics["sleep_deep_hours"]) if biometrics and biometrics.get("sleep_deep_hours") is not None else None
        except (ValueError, TypeError):
            deep_sleep_h = None
        try:
            rhr = int(float(biometrics["resting_hr_bpm"])) if biometrics and biometrics.get("resting_hr_bpm") is not None else None
        except (ValueError, TypeError):
            rhr = None
        try:
            weight_kg = float(biometrics["latest_weight_kg"]) if biometrics and biometrics.get("latest_weight_kg") is not None else None
        except (ValueError, TypeError):
            weight_kg = None

        # Fast Jev System One gates for joint sparing, time budget, and recovery tier (batched single call)
        jev_gates = classify_workout_decision_gates(biometrics, custom_context)
        jev_recovery = jev_gates.get("recovery_tier")

        recent_lifts = get_recent_lift_history(db) if db else []
        active_catalog = get_active_exercises(db) if db else []
        muscle_vol = get_recent_muscle_volume(db) if db else {}
        active_rts = get_active_routines(db) if db else []

        context_payload = {
            "date": target_date.isoformat(),
            "day_of_week": target_date.strftime("%A"),
            "scheduled_activity": {
                "name": activity_name,
                "type": activity_type,
            },
            "biometrics": {
                "hrv_ms": hrv,
                "sleep_duration_hours": sleep_h,
                "sleep_deep_hours": deep_sleep_h,
                "resting_hr_bpm": rhr,
                "weight_kg": weight_kg,
            },
            "recent_lift_history": recent_lifts,
            "active_exercises": active_catalog,
            "recent_muscle_volume_7d": muscle_vol,
            "active_routines": active_rts,
            "recent_feedback": recent_feedback or [],
            "user_custom_instructions": custom_context or "None provided. Synthesize optimal training session.",
            "jev_decision_gates": {
                "recovery_tier": jev_recovery or "AUTOMATIC",
                "joint_focus": jev_gates.get("joint_focus", "NOMINAL"),
                "time_budget": jev_gates.get("time_budget", "TIME_STANDARD_45M"),
            },
        }

        url = f"{settings.llm_base_url.rstrip('/')}/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {settings.llm_api_key}",
            "User-Agent": "Kratos-Workout-Synthesizer/1.0",
        }
        body = {
            "model": settings.llm_model,
            "response_format": {"type": "json_object"},
            "temperature": 0.2,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": f"Synthesize today's workout prescription and exercise cues based on athlete context:\n{json.dumps(context_payload, indent=2)}",
                },
            ],
        }

        req = urllib.request.Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=12.0) as resp:
            if resp.status == 200:
                resp_json = json.loads(resp.read().decode("utf-8"))
                choices = resp_json.get("choices", [])
                if choices:
                    content_str = choices[0].get("message", {}).get("content", "")
                    content_data = json.loads(content_str)
                    raw_exercises = content_data.get("exercises", [])
                    exercises = [
                        RecommendedExerciseItem(
                            exercise_name=ex.get("exercise_name", "Exercise"),
                            target_sets=int(ex.get("target_sets", 2)),
                            target_reps=str(ex.get("target_reps", "8-10 reps")),
                            suggested_weight_kg=float(ex["suggested_weight_kg"]) if ex.get("suggested_weight_kg") is not None else None,
                            weight_basis=resolve_exercise_weight_basis(
                                ex.get("exercise_name", "Exercise"),
                                ex.get("weight_basis"),
                            ),
                            notes=ex.get("notes"),
                        )
                        for ex in raw_exercises
                    ]

                    return WorkoutRecommendationRead(
                        date=target_date.isoformat(),
                        routine_name=content_data.get("routine_name", activity_name),
                        readiness_adaptation=content_data.get("readiness_adaptation", "Autoregulated according to current recovery status."),
                        target_rir=content_data.get("target_rir", "RIR 2"),
                        volume_landmark=content_data.get("volume_landmark", "MAV"),
                        rationale=content_data.get("rationale", "Synthesized from recovery telemetry and database context."),
                        exercises=exercises,
                        recovery_status=content_data.get("recovery_status", "optimal"),
                        research_citation=content_data.get("research_citation", "Israetel (Volume Landmarks) & Helms (RIR Autoregulation)"),
                        is_llm_generated=True,
                    )
    except Exception as exc:
        logger.warning("LLM workout synthesis failed or timed out (%s); falling back to deterministic engine", exc)

    baseline = generate_workout_recommendation(target_date, weekly_plan, biometrics, db=db)
    baseline.is_llm_generated = False
    return baseline
