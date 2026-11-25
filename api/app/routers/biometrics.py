"""Biometrics proxy router for Kratos.

Fetches live morning biometrics (sleep, HRV, resting HR, weigh-in) from the internal
Eir service over the Swarm overlay network via the injected EirPort.
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.container import get_container
from app.db import get_db
from app.models import FastingRecommendation, WeeklyPlan, WorkoutRecommendation
from app.ports.eir import EirConfig, EirPort, HttpEirAdapter
from app.schemas import (
    FastingRecommendationRead,
    FastingSynthesizeRequest,
    RecommendedExerciseItem,
    WorkoutMetricsRead,
    WorkoutRecommendationRead,
    WorkoutSynthesizeRequest,
    WorkoutTimelineRead,
)
from app.services.discord import (
    post_fasting_recommendation_thread,
    post_thread_adjustment_reply,
    post_workout_recommendation_thread,
)
from app.services.llm_fasting import synthesize_fasting_recommendation_llm
from app.services.llm_workout import synthesize_workout_recommendation_llm
from app.services.workout_engine import resolve_exercise_weight_basis

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/biometrics", tags=["biometrics"])

_RECOMMENDATION_LOCKS_MUTEX = threading.Lock()
_WORKOUT_DATE_LOCKS: dict[str, threading.Lock] = {}
_FASTING_DATE_LOCKS: dict[str, threading.Lock] = {}


def _default_eir() -> EirPort:
    return HttpEirAdapter(EirConfig(base_url=get_settings().eir_internal_url))


def _get_lock_for_date(store: dict[str, threading.Lock], date_key: str) -> threading.Lock:
    with _RECOMMENDATION_LOCKS_MUTEX:
        if date_key not in store:
            store[date_key] = threading.Lock()
        return store[date_key]


def _format_fasting_cached(cached: FastingRecommendation) -> FastingRecommendationRead:
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


def _format_workout_cached(cached: WorkoutRecommendation) -> WorkoutRecommendationRead:
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
                suggested_weight_kg=(
                    float(ex["suggested_weight_kg"])
                    if ex.get("suggested_weight_kg") is not None
                    else None
                ),
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


class FastingCheckInPayload(BaseModel):
    id: str
    date: str
    target_window: str
    adherence: str
    energy: str = "normal"
    headache: str = "none"
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
    now_utc = datetime.now(timezone.utc)
    circadian = now_utc + timedelta(hours=13) - timedelta(hours=4)
    return circadian.strftime("%Y-%m-%d")


@router.get("/today")
def get_today_biometrics(request: Request) -> dict[str, Any] | None:
    """Proxies today's Eir daily biometrics summary for the Kratos dashboard."""
    today = _get_auckland_today()
    return get_container(request).eir.get_daily_biometrics(today)


@router.get("/latest")
def get_latest_biometrics(request: Request) -> dict[str, Any] | None:
    """Proxies the most recent scale measurement from Eir."""
    return get_container(request).eir.get_latest_biometrics()


@router.get("/workout-metrics", response_model=WorkoutMetricsRead)
def get_workout_metrics(
    request: Request,
    started_at: datetime = Query(description="Window start ISO-8601 timestamp"),
    ended_at: datetime = Query(description="Window end ISO-8601 timestamp"),
    classification: str | None = Query(default=None),
    activity_type: str | None = Query(default=None),
    routine_name: str | None = Query(default=None),
) -> WorkoutMetricsRead:
    """Proxies Eir workout exertion metrics for a time window; fails with 502 on upstream failure."""
    if ended_at <= started_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ended_at must be after started_at",
        )
    return get_container(request).eir.get_workout_metrics(
        started_at,
        ended_at,
        classification=classification,
        activity_type=activity_type,
        routine_name=routine_name,
    )


@router.get("/workout-timeline", response_model=WorkoutTimelineRead)
def get_workout_timeline(
    request: Request,
    started_at: datetime = Query(description="Window start ISO-8601 timestamp"),
    ended_at: datetime = Query(description="Window end ISO-8601 timestamp"),
) -> WorkoutTimelineRead:
    """Proxies Eir 5-min HR/step timeline and split hints; fails with 502 on upstream failure."""
    if ended_at <= started_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ended_at must be after started_at",
        )
    return get_container(request).eir.get_workout_timeline(started_at, ended_at)


def _resolve_target_date_and_plan(
    target_date: str | None, db: Session
) -> tuple[Any, str, WeeklyPlan | None]:
    resolved_date_str = target_date or _get_auckland_today()
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
    return t_date, date_str, weekly_plan


def _sync_fasting_discord_thread(
    rec: FastingRecommendationRead,
    date_str: str,
    existing: FastingRecommendation | None,
    custom_context: str | None,
) -> str | None:
    if existing and existing.extra and existing.extra.get("discord_thread_id"):
        thread_id = str(existing.extra.get("discord_thread_id"))
        if custom_context:
            try:
                post_thread_adjustment_reply(
                    thread_id=thread_id,
                    title=f"{rec.target_window} ({rec.window_hours})",
                    summary=f"**Protocol**: {rec.protocol_name}\n**Rationale**: {rec.rationale}",
                    details=f"**Adjustment Applied**: {custom_context}",
                )
            except Exception as exc:
                logger.warning("Failed posting fasting adjustment to Discord thread: %s", exc)
        return thread_id
    try:
        return post_fasting_recommendation_thread(rec, date_str)
    except Exception as exc:
        logger.warning("Failed creating Discord thread for fasting recommendation: %s", exc)
        return None


def _persist_fasting_cache(
    db: Session,
    date_str: str,
    rec: FastingRecommendationRead,
    existing: FastingRecommendation | None,
    extra_payload: dict[str, Any],
    custom_context: str | None = None,
) -> None:
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
        existing.custom_context = custom_context
        existing.extra = extra_payload
    else:
        db.add(
            FastingRecommendation(
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
                custom_context=custom_context,
                extra=extra_payload,
            )
        )
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.debug("Failed persisting fasting recommendation cache: %s", exc)


def _sync_workout_discord_thread(
    rec: WorkoutRecommendationRead,
    date_str: str,
    existing: WorkoutRecommendation | None,
    custom_context: str | None,
) -> str | None:
    if existing and existing.extra and existing.extra.get("discord_thread_id"):
        thread_id = str(existing.extra.get("discord_thread_id"))
        if custom_context:
            try:
                post_thread_adjustment_reply(
                    thread_id=thread_id,
                    title=f"{rec.routine_name} ({rec.volume_landmark})",
                    summary=(
                        f"**Adaptation**: {rec.readiness_adaptation} | "
                        f"**Target**: {rec.target_rir}\n**Rationale**: {rec.rationale}"
                    ),
                    details=f"**Adjustment Applied**: {custom_context}",
                )
            except Exception as exc:
                logger.warning("Failed posting workout adjustment to Discord thread: %s", exc)
        return thread_id
    try:
        return post_workout_recommendation_thread(rec, date_str)
    except Exception as exc:
        logger.warning("Failed creating Discord thread for workout recommendation: %s", exc)
        return None


def _persist_workout_cache(
    db: Session,
    date_str: str,
    rec: WorkoutRecommendationRead,
    existing: WorkoutRecommendation | None,
    extra_payload: dict[str, Any],
    custom_context: str | None = None,
) -> None:
    serialized_exercises = [ex.model_dump() for ex in rec.exercises]
    if existing:
        existing.routine_name = rec.routine_name
        existing.readiness_adaptation = rec.readiness_adaptation
        existing.target_rir = rec.target_rir
        existing.volume_landmark = rec.volume_landmark
        existing.rationale = rec.rationale
        existing.exercises = serialized_exercises
        existing.recovery_status = rec.recovery_status
        existing.research_citation = rec.research_citation
        existing.custom_context = custom_context
        existing.is_llm_generated = rec.is_llm_generated
        existing.extra = extra_payload
    else:
        db.add(
            WorkoutRecommendation(
                date=date_str,
                routine_name=rec.routine_name,
                readiness_adaptation=rec.readiness_adaptation,
                target_rir=rec.target_rir,
                volume_landmark=rec.volume_landmark,
                rationale=rec.rationale,
                exercises=serialized_exercises,
                recovery_status=rec.recovery_status,
                research_citation=rec.research_citation,
                custom_context=custom_context,
                is_llm_generated=rec.is_llm_generated,
                extra=extra_payload,
            )
        )
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.debug("Failed persisting workout recommendation cache: %s", exc)


def get_fasting_recommendation(
    target_date: str | None = None,
    db: Session = Depends(get_db),
    *,
    eir: EirPort | None = None,
) -> FastingRecommendationRead:
    """Return an autoregulated fasting recommendation from cache or Eir biometrics."""
    t_date, date_str, weekly_plan = _resolve_target_date_and_plan(target_date, db)
    stmt = select(FastingRecommendation).where(
        FastingRecommendation.date == date_str,
        FastingRecommendation.deleted_at.is_(None),
    )
    if cached := db.scalar(stmt):
        return _format_fasting_cached(cached)

    resolved_eir = eir if eir is not None else _default_eir()
    with _get_lock_for_date(_FASTING_DATE_LOCKS, date_str):
        db.expire_all()
        if cached := db.scalar(stmt):
            return _format_fasting_cached(cached)
        biometrics = resolved_eir.get_daily_biometrics(date_str)
        rec = synthesize_fasting_recommendation_llm(t_date, weekly_plan, biometrics, db=db)
        thread_id = _sync_fasting_discord_thread(rec, date_str, None, None)
        extra_payload: dict[str, Any] = {"source": "llm"}
        if thread_id:
            extra_payload["discord_thread_id"] = str(thread_id)
        _persist_fasting_cache(db, date_str, rec, None, extra_payload)
        rec.extra = extra_payload
        return rec


@router.get("/fasting-recommendation", response_model=FastingRecommendationRead)
def get_fasting_recommendation_endpoint(
    request: Request,
    target_date: str | None = None,
    db: Session = Depends(get_db),
) -> FastingRecommendationRead:
    return get_fasting_recommendation(
        target_date=target_date, db=db, eir=get_container(request).eir
    )


def trigger_fasting_synthesis(
    payload: FastingSynthesizeRequest,
    db: Session = Depends(get_db),
    *,
    eir: EirPort | None = None,
    source: str | None = None,
) -> FastingRecommendationRead:
    """Force on-demand LLM synthesis of fasting and nutrient timing protocol."""
    t_date, date_str, weekly_plan = _resolve_target_date_and_plan(payload.target_date, db)
    resolved_eir = eir if eir is not None else _default_eir()
    biometrics = resolved_eir.get_daily_biometrics(date_str)
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
    thread_id = _sync_fasting_discord_thread(rec, date_str, existing, payload.custom_context)
    extra_payload = dict(existing.extra or {}) if existing else {"source": "llm"}
    if source is not None:
        extra_payload["source"] = source
    if thread_id:
        extra_payload["discord_thread_id"] = str(thread_id)
    if payload.custom_context:
        extra_payload["last_adjustment"] = payload.custom_context
    _persist_fasting_cache(db, date_str, rec, existing, extra_payload, payload.custom_context)
    rec.extra = extra_payload
    return rec


@router.post("/fasting-recommendation/synthesize", response_model=FastingRecommendationRead)
def trigger_fasting_synthesis_endpoint(
    request: Request,
    payload: FastingSynthesizeRequest,
    db: Session = Depends(get_db),
) -> FastingRecommendationRead:
    return trigger_fasting_synthesis(
        payload=payload, db=db, eir=get_container(request).eir
    )


def get_workout_recommendation(
    target_date: str | None = None,
    db: Session = Depends(get_db),
    *,
    eir: EirPort | None = None,
) -> WorkoutRecommendationRead:
    """Return an autoregulated workout recommendation from cache or Eir biometrics."""
    t_date, date_str, weekly_plan = _resolve_target_date_and_plan(target_date, db)
    stmt = select(WorkoutRecommendation).where(
        WorkoutRecommendation.date == date_str,
        WorkoutRecommendation.deleted_at.is_(None),
    )
    if cached := db.scalar(stmt):
        return _format_workout_cached(cached)

    resolved_eir = eir if eir is not None else _default_eir()
    with _get_lock_for_date(_WORKOUT_DATE_LOCKS, date_str):
        db.expire_all()
        if cached := db.scalar(stmt):
            return _format_workout_cached(cached)
        biometrics = resolved_eir.get_daily_biometrics(date_str)
        rec = synthesize_workout_recommendation_llm(t_date, weekly_plan, biometrics, db=db)
        thread_id = _sync_workout_discord_thread(rec, date_str, None, None)
        extra_payload: dict[str, Any] = {"source": "llm"}
        if thread_id:
            extra_payload["discord_thread_id"] = str(thread_id)
        _persist_workout_cache(db, date_str, rec, None, extra_payload)
        rec.extra = extra_payload
        return rec


@router.get("/workout-recommendation", response_model=WorkoutRecommendationRead)
def get_workout_recommendation_endpoint(
    request: Request,
    target_date: str | None = None,
    db: Session = Depends(get_db),
) -> WorkoutRecommendationRead:
    return get_workout_recommendation(
        target_date=target_date, db=db, eir=get_container(request).eir
    )


def trigger_workout_synthesis(
    payload: WorkoutSynthesizeRequest,
    db: Session = Depends(get_db),
    *,
    eir: EirPort | None = None,
    source: str | None = None,
) -> WorkoutRecommendationRead:
    """Force on-demand LLM synthesis of workout prescription with optional custom context."""
    t_date, date_str, weekly_plan = _resolve_target_date_and_plan(payload.target_date, db)
    resolved_eir = eir if eir is not None else _default_eir()
    biometrics = resolved_eir.get_daily_biometrics(date_str)
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
    thread_id = _sync_workout_discord_thread(rec, date_str, existing, payload.custom_context)
    extra_payload = dict(existing.extra or {}) if existing else {"source": "llm"}
    if source is not None:
        extra_payload["source"] = source
    if thread_id:
        extra_payload["discord_thread_id"] = str(thread_id)
    if payload.custom_context:
        extra_payload["last_adjustment"] = payload.custom_context
    _persist_workout_cache(db, date_str, rec, existing, extra_payload, payload.custom_context)
    rec.extra = extra_payload
    return rec


@router.post("/workout-recommendation/synthesize", response_model=WorkoutRecommendationRead)
def trigger_workout_synthesis_endpoint(
    request: Request,
    payload: WorkoutSynthesizeRequest,
    db: Session = Depends(get_db),
) -> WorkoutRecommendationRead:
    return trigger_workout_synthesis(
        payload=payload, db=db, eir=get_container(request).eir
    )


@router.post("/fasting")
def save_fasting_checkin(request: Request, payload: FastingCheckInPayload) -> dict[str, str]:
    """Records fasting feedback and forwards to Eir when available."""
    get_container(request).eir.submit_fasting_feedback(payload.model_dump())
    return {"status": "ok"}


@router.post("/workout-feedback")
def save_workout_feedback(request: Request, payload: WorkoutFeedbackPayload) -> dict[str, str]:
    """Records workout feedback and forwards to Eir when available."""
    get_container(request).eir.submit_workout_feedback(payload.model_dump())
    return {"status": "ok"}
