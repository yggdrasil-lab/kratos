"""Biometrics proxy router for Kratos.

Fetches live morning biometrics (sleep, HRV, resting HR, weigh-in) from the internal
Eir service over the aether-net Swarm overlay network. Fails gracefully if Eir is offline.
"""

from datetime import datetime, timezone, timedelta
import json
import logging
import urllib.error
import urllib.request
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import FastingRecommendation, WeeklyPlan, WorkoutRecommendation
from app.schemas import (
    FastingRecommendationRead,
    FastingSynthesizeRequest,
    RecommendedExerciseItem,
    WorkoutRecommendationRead,
    WorkoutSynthesizeRequest,
)
from app.services.discord import (
    post_fasting_recommendation_thread,
    post_thread_adjustment_reply,
    post_workout_recommendation_thread,
)
from app.services.fasting_engine import generate_fasting_recommendation
from app.services.llm_fasting import synthesize_fasting_recommendation_llm
from app.services.llm_workout import synthesize_workout_recommendation_llm
from app.services.workout_engine import resolve_exercise_weight_basis

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/biometrics", tags=["biometrics"])


class FastingCheckInPayload(BaseModel):
    id: str
    date: str
    target_window: str
    adherence: str
    energy: str
    headache: str
    notes: str | None = None
    logged_at: str


class WorkoutFeedbackPayload(BaseModel):
    date: str
    routine_name: str | None = None
    duration_minutes: int | None = None
    total_volume_kg: float | None = None
    completed_sets: int | None = None
    effort_rating: str  # 'too_easy', 'optimal', 'hard', 'too_hard'
    tags: list[str] = []
    notes: str | None = None
    logged_at: str | None = None


def _get_auckland_today() -> str:
    # Pacific/Auckland is UTC+12 or UTC+13 (NZDT). Use +13 as conservative local or circadian
    now_utc = datetime.now(timezone.utc)
    # 4-hour circadian shift: a 1 AM session belongs to previous day
    circadian = now_utc + timedelta(hours=13) - timedelta(hours=4)
    return circadian.strftime("%Y-%m-%d")


@router.get("/today")
def get_today_biometrics() -> dict[str, Any] | None:
    """Proxies today's Eir daily biometrics summary for the Kratos dashboard."""
    today = _get_auckland_today()
    url = f"{settings.eir_internal_url}/biometrics/daily/{today}"
    req = urllib.request.Request(url, headers={"User-Agent": "Kratos-Bridge/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=2.0) as resp:
            if resp.status == 200:
                return json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        logger.debug("Eir biometrics probe failed: %s", exc)
    return None


@router.get("/latest")
def get_latest_biometrics() -> dict[str, Any] | None:
    """Proxies the most recent scale measurement from Eir."""
    url = f"{settings.eir_internal_url}/biometrics/latest"
    req = urllib.request.Request(url, headers={"User-Agent": "Kratos-Bridge/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=2.0) as resp:
            if resp.status == 200:
                return json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        logger.debug("Eir latest biometrics probe failed: %s", exc)
    return None


@router.get("/fasting-recommendation", response_model=FastingRecommendationRead)
def get_fasting_recommendation(
    target_date: str | None = None,
    db: Session = Depends(get_db),
) -> FastingRecommendationRead:
    """Returns a smart autoregulated fasting recommendation based on scheduled plan and Eir biometrics."""
    resolved_date_str = target_date or _get_auckland_today()
    try:
        t_date = datetime.strptime(resolved_date_str, "%Y-%m-%d").date()
    except ValueError:
        t_date = datetime.now(timezone.utc).date()

    date_str = t_date.isoformat()
    cached = db.scalar(
        select(FastingRecommendation).where(
            FastingRecommendation.date == date_str,
            FastingRecommendation.deleted_at.is_(None),
        )
    )
    if cached:
        return FastingRecommendationRead(
            date=cached.date,
            protocol_name=cached.protocol_name,
            target_window=cached.target_window,
            window_hours=cached.window_hours,
            rationale=cached.rationale,
            fueling_anchors=cached.fueling_anchors,
            recovery_status=cached.recovery_status,
            activity_context=cached.activity_context,
            is_llm_generated=cached.is_llm_generated,
            research_citation=cached.research_citation,
            extra=cached.extra or {},
        )

    # Query weekly plan for this date
    iso_year, iso_week, _ = t_date.isocalendar()
    iso_week_str = f"{iso_year}-W{iso_week:02d}"
    weekly_plan = db.scalar(
        select(WeeklyPlan).where(
            WeeklyPlan.iso_week == iso_week_str,
            WeeklyPlan.deleted_at.is_(None),
        )
    )

    # Fetch biometrics for this date from Eir
    biometrics = None
    url = f"{settings.eir_internal_url}/biometrics/daily/{date_str}"
    req = urllib.request.Request(url, headers={"User-Agent": "Kratos-Bridge/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=2.0) as resp:
            if resp.status == 200:
                biometrics = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        logger.debug("Failed fetching Eir biometrics for fasting recommendation: %s", exc)

    rec = synthesize_fasting_recommendation_llm(t_date, weekly_plan, biometrics, db=db)

    # Dispatch starter thread to Discord #health forum if configured
    thread_id = None
    try:
        thread_id = post_fasting_recommendation_thread(rec, date_str)
    except Exception as exc:
        logger.warning("Failed creating Discord thread for fasting recommendation: %s", exc)

    extra_payload: dict[str, Any] = {"source": "llm"}
    if thread_id:
        extra_payload["discord_thread_id"] = str(thread_id)

    # Cache recommendation for today
    record = FastingRecommendation(
        date=date_str,
        protocol_name=rec.protocol_name,
        target_window=rec.target_window,
        window_hours=rec.window_hours,
        rationale=rec.rationale,
        fueling_anchors=rec.fueling_anchors,
        recovery_status=rec.recovery_status,
        activity_context=rec.activity_context,
        is_llm_generated=rec.is_llm_generated,
        research_citation=rec.research_citation,
        extra=extra_payload,
    )
    db.add(record)
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.debug("Failed saving fasting recommendation cache: %s", exc)

    rec.extra = extra_payload
    return rec


@router.post("/fasting-recommendation/synthesize", response_model=FastingRecommendationRead)
def trigger_fasting_synthesis(
    payload: FastingSynthesizeRequest,
    db: Session = Depends(get_db),
) -> FastingRecommendationRead:
    """Forces on-demand LLM synthesis of fasting and nutrient timing protocol with optional custom context."""
    resolved_date_str = payload.target_date or _get_auckland_today()
    try:
        t_date = datetime.strptime(resolved_date_str, "%Y-%m-%d").date()
    except ValueError:
        t_date = datetime.now(timezone.utc).date()

    date_str = t_date.isoformat()
    iso_year, iso_week, _ = t_date.isocalendar()
    iso_week_str = f"{iso_year}-W{iso_week:02d}"
    weekly_plan = db.scalar(
        select(WeeklyPlan).where(
            WeeklyPlan.iso_week == iso_week_str,
            WeeklyPlan.deleted_at.is_(None),
        )
    )

    biometrics = None
    url = f"{settings.eir_internal_url}/biometrics/daily/{date_str}"
    req = urllib.request.Request(url, headers={"User-Agent": "Kratos-Bridge/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=2.0) as resp:
            if resp.status == 200:
                biometrics = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        logger.debug("Failed fetching Eir biometrics for synthesis: %s", exc)

    rec = synthesize_fasting_recommendation_llm(
        target_date=t_date,
        weekly_plan=weekly_plan,
        biometrics=biometrics,
        custom_context=payload.custom_context,
        db=db,
    )

    existing = db.scalar(
        select(FastingRecommendation).where(
            FastingRecommendation.date == date_str,
            FastingRecommendation.deleted_at.is_(None),
        )
    )

    thread_id = None
    if existing and existing.extra and existing.extra.get("discord_thread_id"):
        thread_id = str(existing.extra.get("discord_thread_id"))
        if payload.custom_context:
            try:
                post_thread_adjustment_reply(
                    thread_id=thread_id,
                    title=f"{rec.target_window} ({rec.window_hours})",
                    summary=f"**Protocol**: {rec.protocol_name}\n**Rationale**: {rec.rationale}",
                    details=f"**Adjustment Applied**: {payload.custom_context}",
                )
            except Exception as exc:
                logger.warning("Failed posting fasting adjustment to Discord thread: %s", exc)
    else:
        try:
            thread_id = post_fasting_recommendation_thread(rec, date_str)
        except Exception as exc:
            logger.warning("Failed creating Discord thread on fasting synthesis: %s", exc)

    extra_payload = dict(existing.extra or {}) if existing else {"source": "llm"}
    if thread_id:
        extra_payload["discord_thread_id"] = str(thread_id)
    if payload.custom_context:
        extra_payload["last_adjustment"] = payload.custom_context

    if existing:
        existing.protocol_name = rec.protocol_name
        existing.target_window = rec.target_window
        existing.window_hours = rec.window_hours
        existing.rationale = rec.rationale
        existing.fueling_anchors = rec.fueling_anchors
        existing.recovery_status = rec.recovery_status
        existing.activity_context = rec.activity_context
        existing.is_llm_generated = rec.is_llm_generated
        existing.research_citation = rec.research_citation
        existing.custom_context = payload.custom_context
        existing.extra = extra_payload
    else:
        new_record = FastingRecommendation(
            date=date_str,
            protocol_name=rec.protocol_name,
            target_window=rec.target_window,
            window_hours=rec.window_hours,
            rationale=rec.rationale,
            fueling_anchors=rec.fueling_anchors,
            recovery_status=rec.recovery_status,
            activity_context=rec.activity_context,
            is_llm_generated=rec.is_llm_generated,
            research_citation=rec.research_citation,
            custom_context=payload.custom_context,
            extra=extra_payload,
        )
        db.add(new_record)
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.debug("Failed persisting synthesized fasting recommendation: %s", exc)

    rec.extra = extra_payload
    return rec


@router.get("/workout-recommendation", response_model=WorkoutRecommendationRead)
def get_workout_recommendation(
    target_date: str | None = None,
    db: Session = Depends(get_db),
) -> WorkoutRecommendationRead:
    """Returns an autoregulated workout recommendation based on scheduled plan and Eir biometrics."""
    resolved_date_str = target_date or _get_auckland_today()
    try:
        t_date = datetime.strptime(resolved_date_str, "%Y-%m-%d").date()
    except ValueError:
        t_date = datetime.now(timezone.utc).date()

    date_str = t_date.isoformat()
    cached = db.scalar(
        select(WorkoutRecommendation).where(
            WorkoutRecommendation.date == date_str,
            WorkoutRecommendation.deleted_at.is_(None),
        )
    )
    if cached:
        return WorkoutRecommendationRead(
            date=cached.date,
            routine_name=cached.routine_name,
            readiness_adaptation=cached.readiness_adaptation,
            target_rir=cached.target_rir,
            volume_landmark=cached.volume_landmark,
            rationale=cached.rationale,
            exercises=[
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
                for ex in cached.exercises
            ],
            recovery_status=cached.recovery_status,
            research_citation=cached.research_citation,
            is_llm_generated=cached.is_llm_generated,
            extra=cached.extra or {},
        )

    iso_year, iso_week, _ = t_date.isocalendar()
    iso_week_str = f"{iso_year}-W{iso_week:02d}"
    weekly_plan = db.scalar(
        select(WeeklyPlan).where(
            WeeklyPlan.iso_week == iso_week_str,
            WeeklyPlan.deleted_at.is_(None),
        )
    )

    biometrics = None
    url = f"{settings.eir_internal_url}/biometrics/daily/{date_str}"
    req = urllib.request.Request(url, headers={"User-Agent": "Kratos-Bridge/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=2.0) as resp:
            if resp.status == 200:
                biometrics = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        logger.debug("Failed fetching Eir biometrics for workout recommendation: %s", exc)

    rec = synthesize_workout_recommendation_llm(t_date, weekly_plan, biometrics, db=db)

    # Dispatch starter thread to Discord #health forum if configured
    thread_id = None
    try:
        thread_id = post_workout_recommendation_thread(rec, date_str)
    except Exception as exc:
        logger.warning("Failed creating Discord thread for workout recommendation: %s", exc)

    extra_payload: dict[str, Any] = {"source": "llm"}
    if thread_id:
        extra_payload["discord_thread_id"] = str(thread_id)

    record = WorkoutRecommendation(
        date=date_str,
        routine_name=rec.routine_name,
        readiness_adaptation=rec.readiness_adaptation,
        target_rir=rec.target_rir,
        volume_landmark=rec.volume_landmark,
        rationale=rec.rationale,
        exercises=[ex.model_dump() for ex in rec.exercises],
        recovery_status=rec.recovery_status,
        research_citation=rec.research_citation,
        is_llm_generated=rec.is_llm_generated,
        extra=extra_payload,
    )
    db.add(record)
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.debug("Failed saving workout recommendation cache: %s", exc)

    rec.extra = extra_payload
    return rec


@router.post("/workout-recommendation/synthesize", response_model=WorkoutRecommendationRead)
def trigger_workout_synthesis(
    payload: WorkoutSynthesizeRequest,
    db: Session = Depends(get_db),
) -> WorkoutRecommendationRead:
    """Forces on-demand LLM synthesis of workout prescription with optional custom user context."""
    resolved_date_str = payload.target_date or _get_auckland_today()
    try:
        t_date = datetime.strptime(resolved_date_str, "%Y-%m-%d").date()
    except ValueError:
        t_date = datetime.now(timezone.utc).date()

    date_str = t_date.isoformat()
    iso_year, iso_week, _ = t_date.isocalendar()
    iso_week_str = f"{iso_year}-W{iso_week:02d}"
    weekly_plan = db.scalar(
        select(WeeklyPlan).where(
            WeeklyPlan.iso_week == iso_week_str,
            WeeklyPlan.deleted_at.is_(None),
        )
    )

    biometrics = None
    url = f"{settings.eir_internal_url}/biometrics/daily/{date_str}"
    req = urllib.request.Request(url, headers={"User-Agent": "Kratos-Bridge/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=2.0) as resp:
            if resp.status == 200:
                biometrics = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        logger.debug("Failed fetching Eir biometrics for workout synthesis: %s", exc)

    rec = synthesize_workout_recommendation_llm(
        target_date=t_date,
        weekly_plan=weekly_plan,
        biometrics=biometrics,
        custom_context=payload.custom_context,
        db=db,
    )

    existing = db.scalar(
        select(WorkoutRecommendation).where(
            WorkoutRecommendation.date == date_str,
            WorkoutRecommendation.deleted_at.is_(None),
        )
    )

    thread_id = None
    if existing and existing.extra and existing.extra.get("discord_thread_id"):
        thread_id = str(existing.extra.get("discord_thread_id"))
        if payload.custom_context:
            try:
                post_thread_adjustment_reply(
                    thread_id=thread_id,
                    title=f"{rec.routine_name} ({rec.volume_landmark})",
                    summary=f"**Adaptation**: {rec.readiness_adaptation} | **Target**: {rec.target_rir}\n**Rationale**: {rec.rationale}",
                    details=f"**Adjustment Applied**: {payload.custom_context}",
                )
            except Exception as exc:
                logger.warning("Failed posting workout adjustment to Discord thread: %s", exc)
    else:
        try:
            thread_id = post_workout_recommendation_thread(rec, date_str)
        except Exception as exc:
            logger.warning("Failed creating Discord thread on workout synthesis: %s", exc)

    extra_payload = dict(existing.extra or {}) if existing else {"source": "llm"}
    if thread_id:
        extra_payload["discord_thread_id"] = str(thread_id)
    if payload.custom_context:
        extra_payload["last_adjustment"] = payload.custom_context

    if existing:
        existing.routine_name = rec.routine_name
        existing.readiness_adaptation = rec.readiness_adaptation
        existing.target_rir = rec.target_rir
        existing.volume_landmark = rec.volume_landmark
        existing.rationale = rec.rationale
        existing.exercises = [ex.model_dump() for ex in rec.exercises]
        existing.recovery_status = rec.recovery_status
        existing.research_citation = rec.research_citation
        existing.custom_context = payload.custom_context
        existing.is_llm_generated = rec.is_llm_generated
        existing.extra = extra_payload
    else:
        new_record = WorkoutRecommendation(
            date=date_str,
            routine_name=rec.routine_name,
            readiness_adaptation=rec.readiness_adaptation,
            target_rir=rec.target_rir,
            volume_landmark=rec.volume_landmark,
            rationale=rec.rationale,
            exercises=[ex.model_dump() for ex in rec.exercises],
            recovery_status=rec.recovery_status,
            research_citation=rec.research_citation,
            custom_context=payload.custom_context,
            is_llm_generated=rec.is_llm_generated,
            extra=extra_payload,
        )
        db.add(new_record)
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.debug("Failed persisting synthesized workout recommendation: %s", exc)

    rec.extra = extra_payload
    return rec


@router.post("/fasting")
def save_fasting_checkin(payload: FastingCheckInPayload) -> dict[str, str]:
    """Records fasting feedback and forwards to Eir when available."""
    try:
        data = json.dumps(payload.model_dump()).encode("utf-8")
        req = urllib.request.Request(
            f"{settings.eir_internal_url}/feedback/fasting",
            data=data,
            headers={"Content-Type": "application/json", "User-Agent": "Kratos-Bridge/1.0"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=2.0):
            pass
    except Exception as exc:
        logger.debug("Failed forwarding fasting feedback to Eir: %s", exc)
    return {"status": "ok"}


@router.post("/workout-feedback")
def save_workout_feedback(payload: WorkoutFeedbackPayload) -> dict[str, str]:
    """Records workout feedback and forwards to Eir when available."""
    try:
        data = json.dumps(payload.model_dump()).encode("utf-8")
        req = urllib.request.Request(
            f"{settings.eir_internal_url}/feedback/workout",
            data=data,
            headers={"Content-Type": "application/json", "User-Agent": "Kratos-Bridge/1.0"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=2.0):
            pass
    except Exception as exc:
        logger.debug("Failed forwarding workout feedback to Eir: %s", exc)
    return {"status": "ok"}
