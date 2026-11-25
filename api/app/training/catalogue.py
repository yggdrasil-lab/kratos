"""Exercise catalogue domain operations."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Exercise
from app.schemas import ExerciseCreate, ExerciseUpdate
from app.training.errors import TrainingConflictError, TrainingNotFoundError


def _merge_source(extra: dict[str, Any] | None, source: str | None) -> dict[str, Any]:
    if source is None:
        return dict(extra or {})
    return {**(extra or {}), "source": source}


def _commit_or_conflict(db: Session, name: str) -> None:
    """Commit, mapping duplicate exercise.name onto TrainingConflictError."""
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if "exercise_name_key" not in str(exc.orig):
            raise
        existing = db.execute(
            select(Exercise).where(Exercise.name == name)
        ).scalar_one_or_none()
        detail = f"An exercise named {name!r} already exists"
        if existing is not None and existing.deleted_at is not None:
            detail += " (soft-deleted, so it is hidden from the catalogue)"
        raise TrainingConflictError(detail) from exc


def list_exercises(
    db: Session,
    *,
    muscle: str | None = None,
    tracking: str | None = None,
) -> list[Exercise]:
    """Return active exercises ordered by name, filtered by muscle and/or tracking."""
    stmt = select(Exercise).where(Exercise.deleted_at.is_(None)).order_by(Exercise.name)
    if muscle is not None:
        stmt = stmt.where(Exercise.primary_muscles.contains([muscle]))
    if tracking is not None:
        stmt = stmt.where(Exercise.tracking == tracking)
    return list(db.scalars(stmt))


def search_exercises(
    db: Session,
    *,
    muscle: str | None = None,
    tracking: str | None = None,
) -> list[Exercise]:
    """Search active exercises by primary muscle and/or tracking mode."""
    return list_exercises(db, muscle=muscle, tracking=tracking)


def get_exercise(db: Session, exercise_id: uuid.UUID) -> Exercise:
    """Fetch one active exercise by ID or raise TrainingNotFoundError."""
    exercise = db.get(Exercise, exercise_id)
    if exercise is None or exercise.deleted_at is not None:
        raise TrainingNotFoundError("Exercise not found")
    return exercise


def create_exercise(
    db: Session,
    payload: ExerciseCreate,
    *,
    source: str | None = None,
) -> Exercise:
    """Create a catalogue exercise, optionally stamping provenance into extra."""
    data = payload.model_dump(exclude_none=True)
    if source is not None:
        data["extra"] = _merge_source(data.get("extra"), source)
    exercise = Exercise(**data)
    db.add(exercise)
    _commit_or_conflict(db, exercise.name)
    db.refresh(exercise)
    return exercise


def update_exercise(
    db: Session,
    exercise_id: uuid.UUID,
    payload: ExerciseUpdate,
    *,
    source: str | None = None,
) -> Exercise:
    """Patch an active exercise, preserving or stamping extra['source'] when supplied."""
    exercise = get_exercise(db, exercise_id)
    updates = payload.model_dump(exclude_unset=True)
    extra_update = updates.pop("extra", None)
    for field, value in updates.items():
        setattr(exercise, field, value)
    if extra_update is not None:
        exercise.extra = _merge_source(extra_update, source)
    elif source is not None:
        exercise.extra = _merge_source(exercise.extra, source)
    _commit_or_conflict(db, exercise.name)
    db.refresh(exercise)
    return exercise


def add_exercise_note(
    db: Session,
    exercise_id: uuid.UUID,
    note: str,
    *,
    source: str | None = None,
) -> Exercise:
    """Append a line note to an active exercise."""
    exercise = get_exercise(db, exercise_id)
    exercise.notes = f"{exercise.notes}\n{note}" if exercise.notes else note
    if source is not None:
        exercise.extra = _merge_source(exercise.extra, source)
    db.commit()
    db.refresh(exercise)
    return exercise


def delete_exercise(
    db: Session,
    exercise_id: uuid.UUID,
    *,
    source: str | None = None,
) -> None:
    """Soft-delete an active exercise by setting deleted_at."""
    exercise = get_exercise(db, exercise_id)
    if source is not None:
        exercise.extra = _merge_source(exercise.extra, source)
    exercise.deleted_at = datetime.now(timezone.utc)
    db.commit()
