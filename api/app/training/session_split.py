"""Domain service for atomically splitting a workout session into locked segments."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import Routine, SessionItem
from app.models import Session as WorkoutSession
from app.ports.eir import EirPort
from app.schemas import SessionSplitRequest, SplitSegmentInput, WorkoutMetricsRead
from app.training.errors import InvalidSplitError, TrainingNotFoundError


def _resolve_segment_routine(
    db: Session,
    segment: SplitSegmentInput,
) -> tuple[uuid.UUID | None, str | None]:
    if segment.routine_id is None:
        return None, segment.routine_name
    routine = db.get(Routine, segment.routine_id)
    if routine is None or routine.deleted_at is not None:
        raise InvalidSplitError(f"Routine {segment.routine_id} not found")
    return routine.id, segment.routine_name or routine.name


def _extract_optional_telemetry(
    segment: SplitSegmentInput,
    metrics: WorkoutMetricsRead,
) -> dict[str, Any]:
    candidates: dict[str, Any] = {
        "avg_hr": metrics.avg_hr_bpm,
        "peak_hr": metrics.peak_hr_bpm,
        "step_count": metrics.step_count,
        "confidence": metrics.confidence,
        "effort_rating": segment.effort_rating or metrics.effort_rating,
        "rpe": metrics.rpe,
        "trimp": metrics.trimp,
        "hr_zones": metrics.hr_zones,
        "hr_recovery_60s": metrics.hr_recovery_60s,
    }
    return {key: value for key, value in candidates.items() if value is not None}


def build_split_child_extra(
    segment: SplitSegmentInput,
    metrics: WorkoutMetricsRead,
    parent_id: uuid.UUID,
    resolved_routine_name: str | None,
) -> dict[str, Any]:
    """Build child session extra payload locking Eir telemetry and split lineage."""
    activity_type = segment.activity_type or metrics.activity_type or "gym"
    default_classification = "class" if activity_type == "class" else metrics.classification
    classification = segment.classification or default_classification or activity_type
    routine_name = resolved_routine_name or metrics.routine_name or "Workout"

    extra: dict[str, Any] = {
        "inferred": False,
        "confirmed": True,
        "telemetry_locked": True,
        "manual_split": True,
        "split_from_id": str(parent_id),
        "telemetry_reconciled": True,
        "telemetry_source": "eir_split",
        "routine_name": routine_name,
        "activity_type": activity_type,
        "classification": classification,
        "duration_minutes": metrics.duration_minutes,
        "active_energy_kcal": metrics.active_energy_kcal,
    }
    extra.update(_extract_optional_telemetry(segment, metrics))
    return extra


def _fetch_segment_plans(
    db: Session,
    payload: SessionSplitRequest,
    eir: EirPort,
) -> list[tuple[SplitSegmentInput, uuid.UUID | None, str | None, WorkoutMetricsRead]]:
    resolved_routines = [_resolve_segment_routine(db, segment) for segment in payload.segments]
    plans: list[tuple[SplitSegmentInput, uuid.UUID | None, str | None, WorkoutMetricsRead]] = []
    for segment, (routine_id, routine_name) in zip(payload.segments, resolved_routines):
        metrics = eir.get_workout_metrics(
            segment.started_at,
            segment.ended_at,
            classification=segment.classification,
            activity_type=segment.activity_type,
            routine_name=routine_name,
        )
        plans.append((segment, routine_id, routine_name, metrics))
    return plans


def _load_ordered_sessions(db: Session, session_ids: list[uuid.UUID]) -> list[WorkoutSession]:
    stmt = (
        select(WorkoutSession)
        .where(WorkoutSession.id.in_(session_ids))
        .options(selectinload(WorkoutSession.items).selectinload(SessionItem.sets))
    )
    by_id = {row.id: row for row in db.scalars(stmt)}
    return [by_id[sid] for sid in session_ids]


def split_session_atomically(
    db: Session,
    session_id: uuid.UUID,
    payload: SessionSplitRequest,
    *,
    eir: EirPort,
) -> tuple[uuid.UUID, list[WorkoutSession]]:
    """Fetch per-segment Eir biometrics and atomically replace parent with split sessions."""
    parent = db.get(WorkoutSession, session_id)
    if parent is None or parent.deleted_at is not None:
        raise TrainingNotFoundError("Session not found")

    plans = _fetch_segment_plans(db, payload, eir)
    children: list[WorkoutSession] = []
    for segment, routine_id, routine_name, metrics in plans:
        child = WorkoutSession(
            id=uuid.uuid4(),
            routine_id=routine_id,
            started_at=segment.started_at,
            ended_at=segment.ended_at,
            notes=segment.notes,
            extra=build_split_child_extra(segment, metrics, parent.id, routine_name),
        )
        db.add(child)
        children.append(child)

    parent.extra = {
        **(parent.extra or {}),
        "dismissed": True,
        "split_into_ids": [str(child.id) for child in children],
    }
    parent.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return parent.id, _load_ordered_sessions(db, [child.id for child in children])
