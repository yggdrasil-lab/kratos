"""The plan: thin REST adapter over TrainingCore."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.container import get_container
from app.db import get_db
from app.schemas import (
    RoutineCreate,
    RoutineItemRead,
    RoutineRead,
    RoutineUpdate,
    WeeklyPlanCreate,
    WeeklyPlanRead,
)
from app.training import TrainingNotFoundError

router = APIRouter(prefix="/routines", tags=["plan"])
weekly_plan_router = APIRouter(prefix="/plans", tags=["weekly_plan"])


@router.get("", response_model=list[RoutineRead])
def list_routines(request: Request, db: Session = Depends(get_db)) -> Any:
    return get_container(request).training.list_routines(db)


@router.post("", response_model=RoutineRead, status_code=status.HTTP_201_CREATED)
def create_routine(
    request: Request,
    payload: RoutineCreate,
    db: Session = Depends(get_db),
) -> Any:
    return get_container(request).training.create_routine(db, payload)


@router.get("/{routine_id}", response_model=RoutineRead)
def get_routine(
    request: Request,
    routine_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> Any:
    try:
        return get_container(request).training.get_routine(db, routine_id)
    except TrainingNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.patch("/{routine_id}", response_model=RoutineRead)
def update_routine(
    request: Request,
    routine_id: uuid.UUID,
    payload: RoutineUpdate,
    db: Session = Depends(get_db),
) -> Any:
    try:
        return get_container(request).training.update_routine(db, routine_id, payload)
    except TrainingNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.delete("/{routine_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_routine(
    request: Request,
    routine_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> None:
    try:
        get_container(request).training.delete_routine(db, routine_id)
    except TrainingNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post(
    "/{routine_id}/items",
    response_model=RoutineItemRead,
    status_code=status.HTTP_201_CREATED,
)
def add_item(
    request: Request,
    routine_id: uuid.UUID,
    payload: dict,
    db: Session = Depends(get_db),
) -> Any:
    """Append or replace one slot in a routine."""
    try:
        return get_container(request).training.add_routine_item(db, routine_id, payload)
    except TrainingNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.delete("/{routine_id}/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_item(
    request: Request,
    routine_id: uuid.UUID,
    item_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> None:
    try:
        get_container(request).training.remove_routine_item(db, routine_id, item_id)
    except TrainingNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@weekly_plan_router.get("/week/{iso_week}", response_model=WeeklyPlanRead)
def get_weekly_plan(
    request: Request,
    iso_week: str,
    db: Session = Depends(get_db),
) -> Any:
    """Fetch the weekly plan for an ISO week (e.g. '2026-W43')."""
    plan = get_container(request).training.get_weekly_plan(db, iso_week)
    if plan is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail=f"Weekly plan for {iso_week} not found"
        )
    return plan


@weekly_plan_router.put("/week/{iso_week}", response_model=WeeklyPlanRead)
def upsert_weekly_plan(
    request: Request,
    iso_week: str,
    payload: WeeklyPlanCreate,
    db: Session = Depends(get_db),
) -> Any:
    """Create or replace the weekly schedule plan for an ISO week."""
    return get_container(request).training.upsert_weekly_plan(db, iso_week, payload)
