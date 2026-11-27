"""Autoregulation domain coordinator: biometrics proxy, recommendation lifecycle, cache, and Discord sync."""

from __future__ import annotations

import threading
from collections.abc import Callable
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.autoregulation.discord_formatter import sync_workout_discord_thread
from app.autoregulation.readiness import assess_readiness
from app.autoregulation.workout import synthesize_workout_recommendation
from app.models import WorkoutRecommendation
from app.ports.clock import ClockPort
from app.ports.discord import DiscordPort
from app.ports.eir import EirPort
from app.ports.muninn import MuninnPort
from app.schemas import (
    RecommendedExerciseItem,
    WorkoutFeedbackPayload,
    WorkoutMetricsRead,
    WorkoutRecommendationRead,
    WorkoutSynthesizeRequest,
    WorkoutTimelineRead,
    infer_weight_basis_from_name,
)
from app.training.plan import get_weekly_plan

LockGetter = Callable[[str], threading.Lock]


def _default_lock_getter() -> LockGetter:
    mutex = threading.Lock()
    store: dict[str, threading.Lock] = {}

    def _get(date_key: str) -> threading.Lock:
        with mutex:
            lock = store.get(date_key)
            if lock is None:
                lock = threading.Lock()
                store[date_key] = lock
            return lock

    return _get


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
                weight_basis=infer_weight_basis_from_name(
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


def _apply_workout_fields(
    row: WorkoutRecommendation,
    rec: WorkoutRecommendationRead,
    serialized_exercises: list[dict[str, Any]],
    extra_payload: dict[str, Any],
    custom_context: str | None,
) -> None:
    row.routine_name = rec.routine_name
    row.readiness_adaptation = rec.readiness_adaptation
    row.target_rir = rec.target_rir
    row.volume_landmark = rec.volume_landmark
    row.rationale = rec.rationale
    row.exercises = serialized_exercises
    row.recovery_status = rec.recovery_status
    row.research_citation = rec.research_citation
    row.custom_context = custom_context
    row.is_llm_generated = rec.is_llm_generated
    row.extra = extra_payload


def _persist_workout_cache(
    db: Session,
    date_str: str,
    rec: WorkoutRecommendationRead,
    existing: WorkoutRecommendation | None,
    extra_payload: dict[str, Any],
    custom_context: str | None = None,
) -> None:
    serialized_exercises = [ex.model_dump() for ex in rec.exercises]
    if existing is not None:
        _apply_workout_fields(
            existing, rec, serialized_exercises, extra_payload, custom_context
        )
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
    except IntegrityError:
        db.rollback()
        concurrent_row = db.scalar(
            select(WorkoutRecommendation).where(
                WorkoutRecommendation.date == date_str,
                WorkoutRecommendation.deleted_at.is_(None),
            )
        )
        if concurrent_row is None:
            raise
        _apply_workout_fields(
            concurrent_row, rec, serialized_exercises, extra_payload, custom_context
        )
        db.commit()
    except Exception:
        db.rollback()
        raise


class AutoregulationCore:
    """Cohesive domain coordinator for biometrics, readiness, and workout synthesis."""

    def __init__(
        self,
        *,
        clock: ClockPort,
        eir: EirPort,
        muninn: MuninnPort,
        discord: DiscordPort,
        get_workout_lock: LockGetter | None = None,
    ) -> None:
        self._clock = clock
        self._eir = eir
        self._muninn = muninn
        self._discord = discord
        self._get_workout_lock = get_workout_lock or _default_lock_getter()

    def _resolve_target_date(self, target_date: str | None) -> tuple[date, str]:
        if target_date is None:
            t_date = self._clock.today_circadian()
            return t_date, t_date.isoformat()
        try:
            t_date = datetime.strptime(target_date, "%Y-%m-%d").date()
        except ValueError:
            t_date = self._clock.today_circadian()
        return t_date, t_date.isoformat()

    def _weekly_plan_for_date(self, db: Session, target_date: date):
        iso_year, iso_week, _ = target_date.isocalendar()
        return get_weekly_plan(db, f"{iso_year}-W{iso_week:02d}")

    def get_today_biometrics(self) -> dict[str, Any] | None:
        """Fetch today's Eir biometrics and attach unified ReadinessAssessment."""
        biometrics = self._eir.get_daily_biometrics(self._clock.today_str())
        if biometrics is None:
            return None
        assessment = assess_readiness(biometrics)
        return {**biometrics, "readiness": assessment.to_public_dict()}

    def get_latest_biometrics(self) -> dict[str, Any] | None:
        """Fetch latest scale measurement from Eir."""
        return self._eir.get_latest_biometrics()

    def get_workout_metrics(
        self,
        started_at: datetime,
        ended_at: datetime,
        *,
        classification: str | None = None,
        activity_type: str | None = None,
        routine_name: str | None = None,
    ) -> WorkoutMetricsRead:
        return self._eir.get_workout_metrics(
            started_at,
            ended_at,
            classification=classification,
            activity_type=activity_type,
            routine_name=routine_name,
        )

    def get_workout_timeline(
        self,
        started_at: datetime,
        ended_at: datetime,
    ) -> WorkoutTimelineRead:
        return self._eir.get_workout_timeline(started_at, ended_at)

    def submit_workout_feedback(
        self, payload: WorkoutFeedbackPayload | dict[str, Any]
    ) -> bool:
        data = payload.model_dump() if isinstance(payload, BaseModel) else dict(payload)
        return self._eir.submit_workout_feedback(data)

    def get_workout_recommendation(
        self,
        db: Session,
        target_date: str | None = None,
    ) -> WorkoutRecommendationRead:
        """Return cached workout recommendation or synthesize, sync Discord, and cache."""
        t_date, date_str = self._resolve_target_date(target_date)
        stmt = select(WorkoutRecommendation).where(
            WorkoutRecommendation.date == date_str,
            WorkoutRecommendation.deleted_at.is_(None),
        )
        if cached := db.scalar(stmt):
            return _format_workout_cached(cached)

        with self._get_workout_lock(date_str):
            db.expire_all()
            if cached := db.scalar(stmt):
                return _format_workout_cached(cached)
            weekly_plan = self._weekly_plan_for_date(db, t_date)
            biometrics = self._eir.get_daily_biometrics(date_str)
            rec = synthesize_workout_recommendation(
                t_date,
                weekly_plan,
                biometrics,
                db=db,
                muninn=self._muninn,
            )
            thread_id = sync_workout_discord_thread(
                self._discord, rec, date_str, None, None
            )
            extra_payload: dict[str, Any] = {"source": "llm"}
            if thread_id:
                extra_payload["discord_thread_id"] = str(thread_id)
            _persist_workout_cache(db, date_str, rec, None, extra_payload)
            rec.extra = extra_payload
            return rec

    def synthesize_workout_recommendation(
        self,
        db: Session,
        payload: WorkoutSynthesizeRequest,
        *,
        source: str | None = None,
    ) -> WorkoutRecommendationRead:
        """Force on-demand workout synthesis, update cache, and sync Discord thread."""
        t_date, date_str = self._resolve_target_date(payload.target_date)
        with self._get_workout_lock(date_str):
            weekly_plan = self._weekly_plan_for_date(db, t_date)
            biometrics = self._eir.get_daily_biometrics(date_str)
            rec = synthesize_workout_recommendation(
                t_date,
                weekly_plan,
                biometrics,
                custom_context=payload.custom_context,
                db=db,
                muninn=self._muninn,
            )
            existing = db.scalar(
                select(WorkoutRecommendation).where(
                    WorkoutRecommendation.date == date_str,
                    WorkoutRecommendation.deleted_at.is_(None),
                )
            )
            thread_id = sync_workout_discord_thread(
                self._discord, rec, date_str, existing, payload.custom_context
            )
            extra_payload = dict(existing.extra or {}) if existing else {"source": "llm"}
            if source is not None:
                extra_payload["source"] = source
            if thread_id:
                extra_payload["discord_thread_id"] = str(thread_id)
            if payload.custom_context:
                extra_payload["last_adjustment"] = payload.custom_context
            _persist_workout_cache(
                db, date_str, rec, existing, extra_payload, payload.custom_context
            )
            rec.extra = extra_payload
            return rec
