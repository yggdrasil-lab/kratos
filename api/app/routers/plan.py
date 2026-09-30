"""The plan: what you intend to do."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.models import Routine, RoutineItem
from app.schemas import RoutineCreate, RoutineItemRead, RoutineRead, RoutineUpdate

router = APIRouter(prefix="/routines", tags=["plan"])


def _get_or_404(db: Session, routine_id: uuid.UUID) -> Routine:
    routine = db.get(Routine, routine_id)
    if routine is None or routine.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Routine not found")
    return routine


@router.get("", response_model=list[RoutineRead])
def list_routines(db: Session = Depends(get_db)) -> list[Routine]:
    stmt = (
        select(Routine)
        .where(Routine.deleted_at.is_(None))
        .options(selectinload(Routine.items))
        .order_by(Routine.name)
    )
    return list(db.scalars(stmt))


@router.post("", response_model=RoutineRead, status_code=status.HTTP_201_CREATED)
def create_routine(payload: RoutineCreate, db: Session = Depends(get_db)) -> Routine:
    routine = Routine(
        name=payload.name,
        notes=payload.notes,
        extra=payload.extra,
        **({"id": payload.id} if payload.id else {}),
    )
    for item in payload.items:
        routine.items.append(
            RoutineItem(**item.model_dump(exclude_none=True, exclude={"id"}))
        )
    db.add(routine)
    db.commit()
    db.refresh(routine)
    return routine


@router.get("/{routine_id}", response_model=RoutineRead)
def get_routine(routine_id: uuid.UUID, db: Session = Depends(get_db)) -> Routine:
    return _get_or_404(db, routine_id)


@router.patch("/{routine_id}", response_model=RoutineRead)
def update_routine(
    routine_id: uuid.UUID, payload: RoutineUpdate, db: Session = Depends(get_db)
) -> Routine:
    routine = _get_or_404(db, routine_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(routine, field, value)
    db.commit()
    db.refresh(routine)
    return routine


@router.delete("/{routine_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_routine(routine_id: uuid.UUID, db: Session = Depends(get_db)) -> None:
    from datetime import datetime, timezone

    routine = _get_or_404(db, routine_id)
    routine.deleted_at = datetime.now(timezone.utc)
    db.commit()


@router.post(
    "/{routine_id}/items",
    response_model=RoutineItemRead,
    status_code=status.HTTP_201_CREATED,
)
def add_item(routine_id: uuid.UUID, payload: dict, db: Session = Depends(get_db)) -> RoutineItem:
    """Append or replace one slot in a routine."""
    routine = _get_or_404(db, routine_id)
    item = RoutineItem(routine_id=routine.id, **payload)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{routine_id}/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_item(routine_id: uuid.UUID, item_id: uuid.UUID, db: Session = Depends(get_db)) -> None:
    from datetime import datetime, timezone

    item = db.get(RoutineItem, item_id)
    if item is None or item.routine_id != routine_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Routine item not found")
    item.deleted_at = datetime.now(timezone.utc)
    db.commit()
