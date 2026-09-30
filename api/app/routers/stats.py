"""The derived read models — volume, estimated 1RM, and last performance.

These are views in the database, not columns, because the vault's hand-kept
versions of the same numbers have already drifted.
"""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas import E1rmRead, ExerciseLastRead, SessionVolumeRead, SetRead
from app.views import VE1rm, VExerciseLast, VSessionVolume, VSet

router = APIRouter(prefix="/stats", tags=["derived"])


@router.get("/sets", response_model=list[SetRead])
def list_sets(
    exercise_id: uuid.UUID | None = None,
    session_id: uuid.UUID | None = None,
    limit: int = Query(default=200, ge=1, le=2000),
    db: Session = Depends(get_db),
) -> list[VSet]:
    stmt = select(VSet).order_by(VSet.started_at.desc(), VSet.set_number).limit(limit)
    if exercise_id is not None:
        stmt = stmt.where(VSet.exercise_id == exercise_id)
    if session_id is not None:
        stmt = stmt.where(VSet.session_id == session_id)
    return list(db.scalars(stmt))


@router.get("/e1rm", response_model=list[E1rmRead])
def list_e1rm(
    exercise_id: uuid.UUID | None = None,
    limit: int = Query(default=200, ge=1, le=2000),
    db: Session = Depends(get_db),
) -> list[VE1rm]:
    stmt = select(VE1rm).order_by(VE1rm.session_date.desc(), VE1rm.e1rm_kg.desc()).limit(limit)
    if exercise_id is not None:
        stmt = stmt.where(VE1rm.exercise_id == exercise_id)
    return list(db.scalars(stmt))


@router.get("/volume", response_model=list[SessionVolumeRead])
def list_volume(
    limit: int = Query(default=50, ge=1, le=500), db: Session = Depends(get_db)
) -> list[VSessionVolume]:
    stmt = select(VSessionVolume).order_by(VSessionVolume.session_date.desc()).limit(limit)
    return list(db.scalars(stmt))


@router.get("/last", response_model=list[ExerciseLastRead])
def list_last(db: Session = Depends(get_db)) -> list[VExerciseLast]:
    """Last performance per exercise — replaces the hand-typed frontmatter keys."""
    return list(db.scalars(select(VExerciseLast).order_by(VExerciseLast.exercise_name)))
