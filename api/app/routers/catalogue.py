"""The catalogue: thin REST adapter over TrainingCore."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.container import get_container
from app.db import get_db
from app.schemas import ExerciseCreate, ExerciseRead, ExerciseUpdate
from app.training import TrainingConflictError, TrainingNotFoundError

router = APIRouter(prefix="/exercises", tags=["catalogue"])


@router.get("", response_model=list[ExerciseRead])
def list_exercises(
    request: Request,
    muscle: str | None = None,
    tracking: str | None = None,
    db: Session = Depends(get_db),
) -> Any:
    return get_container(request).training.list_exercises(
        db, muscle=muscle, tracking=tracking
    )


@router.post("", response_model=ExerciseRead, status_code=status.HTTP_201_CREATED)
def create_exercise(
    request: Request,
    payload: ExerciseCreate,
    db: Session = Depends(get_db),
) -> Any:
    try:
        return get_container(request).training.create_exercise(db, payload)
    except TrainingConflictError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.get("/{exercise_id}", response_model=ExerciseRead)
def get_exercise(
    request: Request,
    exercise_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> Any:
    try:
        return get_container(request).training.get_exercise(db, exercise_id)
    except TrainingNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.patch("/{exercise_id}", response_model=ExerciseRead)
def update_exercise(
    request: Request,
    exercise_id: uuid.UUID,
    payload: ExerciseUpdate,
    db: Session = Depends(get_db),
) -> Any:
    try:
        return get_container(request).training.update_exercise(db, exercise_id, payload)
    except TrainingNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except TrainingConflictError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.delete("/{exercise_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_exercise(
    request: Request,
    exercise_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> None:
    """Tombstone, not a hard delete: a second device never saw the row."""
    try:
        get_container(request).training.delete_exercise(db, exercise_id)
    except TrainingNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
