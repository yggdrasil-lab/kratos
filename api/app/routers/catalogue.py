"""The catalogue: what can be performed."""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Exercise
from app.schemas import ExerciseCreate, ExerciseRead, ExerciseUpdate

router = APIRouter(prefix="/exercises", tags=["catalogue"])


def _get_or_404(db: Session, exercise_id: uuid.UUID) -> Exercise:
    exercise = db.get(Exercise, exercise_id)
    if exercise is None or exercise.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Exercise not found")
    return exercise


@router.get("", response_model=list[ExerciseRead])
def list_exercises(
    muscle: str | None = None,
    tracking: str | None = None,
    db: Session = Depends(get_db),
) -> list[Exercise]:
    stmt = select(Exercise).where(Exercise.deleted_at.is_(None)).order_by(Exercise.name)
    if muscle is not None:
        # `@>` containment, which is what the GIN index on the column serves.
        stmt = stmt.where(Exercise.primary_muscles.contains([muscle]))
    if tracking is not None:
        stmt = stmt.where(Exercise.tracking == tracking)
    return list(db.scalars(stmt))


@router.post("", response_model=ExerciseRead, status_code=status.HTTP_201_CREATED)
def create_exercise(payload: ExerciseCreate, db: Session = Depends(get_db)) -> Exercise:
    exercise = Exercise(**payload.model_dump(exclude_none=True))
    db.add(exercise)
    db.commit()
    db.refresh(exercise)
    return exercise


@router.get("/{exercise_id}", response_model=ExerciseRead)
def get_exercise(exercise_id: uuid.UUID, db: Session = Depends(get_db)) -> Exercise:
    return _get_or_404(db, exercise_id)


@router.patch("/{exercise_id}", response_model=ExerciseRead)
def update_exercise(
    exercise_id: uuid.UUID, payload: ExerciseUpdate, db: Session = Depends(get_db)
) -> Exercise:
    exercise = _get_or_404(db, exercise_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(exercise, field, value)
    db.commit()
    db.refresh(exercise)
    return exercise


@router.delete("/{exercise_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_exercise(exercise_id: uuid.UUID, db: Session = Depends(get_db)) -> None:
    """Tombstone, not a hard delete — a second device never saw the row.

    Hard deletes are invisible to sync; the spec is explicit that `deleted_at`
    exists for this reason.
    """
    exercise = _get_or_404(db, exercise_id)
    exercise.deleted_at = datetime.now(timezone.utc)
    db.commit()
