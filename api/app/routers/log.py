"""The log: thin REST adapter over TrainingCore."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.container import get_container
from app.db import get_db
from app.schemas import SessionCreate, SessionRead, SessionSplitRequest, SessionSplitResponse
from app.training import InvalidSplitError, TrainingNotFoundError

router = APIRouter(prefix="/sessions", tags=["log"])


@router.get("", response_model=list[SessionRead])
def list_sessions(
    request: Request,
    limit: int = Query(default=50, ge=1, le=500),
    routine_id: uuid.UUID | None = None,
    include_deleted: bool = False,
    db: Session = Depends(get_db),
) -> Any:
    return get_container(request).training.list_sessions(
        db,
        limit=limit,
        routine_id=routine_id,
        include_deleted=include_deleted,
    )


@router.put("/{session_id}", response_model=SessionRead)
def upsert_session(
    request: Request,
    session_id: uuid.UUID,
    payload: SessionCreate,
    db: Session = Depends(get_db),
) -> Any:
    """Idempotent write. The path ID wins, so a retried flush cannot duplicate."""
    return get_container(request).training.upsert_session(db, session_id, payload)


@router.get("/{session_id}", response_model=SessionRead)
def get_session(
    request: Request,
    session_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> Any:
    try:
        return get_container(request).training.get_session(db, session_id)
    except TrainingNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(
    request: Request,
    session_id: uuid.UUID,
    dismissed: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> None:
    """Tombstone. Marks dismissed tombstones so Eir sync will not resurrect them."""
    try:
        get_container(request).training.delete_session(db, session_id, dismissed=dismissed)
    except TrainingNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/{session_id}/split", response_model=SessionSplitResponse)
def split_session(
    request: Request,
    session_id: uuid.UUID,
    payload: SessionSplitRequest,
    db: Session = Depends(get_db),
) -> SessionSplitResponse:
    """Atomically splits a session into 2-4 confirmed segments with per-window Eir metrics."""
    try:
        parent_id, created = get_container(request).training.split_session(
            db, session_id, payload
        )
    except TrainingNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except InvalidSplitError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return SessionSplitResponse(
        parent_id=parent_id,
        sessions=[SessionRead.model_validate(item) for item in created],
    )
