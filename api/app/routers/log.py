"""The log: what actually happened.

The write path is an upsert on a client-supplied UUID, so an outbox flush that
runs twice is harmless. On iOS there is no Background Sync, so this is called
while the app is open.
"""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.models import Routine, SessionItem, SetEntry
from app.models import Session as WorkoutSession
from app.schemas import SessionCreate, SessionRead, SessionSplitRequest, SessionSplitResponse
from app.services.session_split import (
    InvalidSplitError,
    SessionNotFoundError,
    split_session_atomically,
)

router = APIRouter(prefix="/sessions", tags=["log"])


def _load(db: Session, session_id: uuid.UUID) -> WorkoutSession | None:
    stmt = (
        select(WorkoutSession)
        .where(WorkoutSession.id == session_id)
        .options(selectinload(WorkoutSession.items).selectinload(SessionItem.sets))
        .execution_options(populate_existing=True)
    )
    return db.scalars(stmt).first()


def _replace_items(db: Session, session: WorkoutSession, payload: SessionCreate) -> None:
    """Replace the tree wholesale — an upsert of the whole session, not a merge.

    The client owns the session and sends its complete current state, so replacing
    is simpler and correct for a retried flush. The old rows are deleted and
    flushed *before* the new ones are inserted: `(session_id, position)` is unique,
    so an unreordered insert would collide with the row it is replacing.
    """
    db.execute(delete(SessionItem).where(SessionItem.session_id == session.id))
    db.flush()

    for position, incoming in enumerate(payload.items):
        item = SessionItem(
            id=incoming.id or uuid.uuid4(),
            session_id=session.id,
            exercise_id=incoming.exercise_id,
            position=incoming.position if incoming.position is not None else position,
            notes=incoming.notes,
            extra=incoming.extra,
        )
        for number, incoming_set in enumerate(incoming.sets, start=1):
            item.sets.append(
                SetEntry(
                    **incoming_set.model_dump(
                        exclude_none=True, exclude={"id", "set_number"}
                    ),
                    set_number=incoming_set.set_number or number,
                )
            )
        db.add(item)
    db.flush()


@router.get("", response_model=list[SessionRead])
def list_sessions(
    limit: int = Query(default=50, ge=1, le=500),
    routine_id: uuid.UUID | None = None,
    include_deleted: bool = False,
    db: Session = Depends(get_db),
) -> list[WorkoutSession]:
    stmt = (
        select(WorkoutSession)
        .options(selectinload(WorkoutSession.items).selectinload(SessionItem.sets))
        .order_by(WorkoutSession.started_at.desc())
        .limit(limit)
    )
    if not include_deleted:
        stmt = stmt.where(WorkoutSession.deleted_at.is_(None))
    if routine_id is not None:
        stmt = stmt.where(WorkoutSession.routine_id == routine_id)
    return list(db.scalars(stmt))


@router.put("/{session_id}", response_model=SessionRead)
def upsert_session(
    session_id: uuid.UUID, payload: SessionCreate, db: Session = Depends(get_db)
) -> WorkoutSession:
    """Idempotent write. The path ID wins, so a retried flush cannot duplicate."""
    routine_id = payload.routine_id
    if routine_id is not None and db.get(Routine, routine_id) is None:
        routine_id = None

    session = _load(db, session_id)
    if session is None:
        session = WorkoutSession(
            id=session_id,
            routine_id=routine_id,
            started_at=payload.started_at,
            ended_at=payload.ended_at,
            notes=payload.notes,
            extra=payload.extra,
        )
        db.add(session)
    else:
        session.routine_id = routine_id
        session.started_at = payload.started_at
        session.ended_at = payload.ended_at
        session.notes = payload.notes
        session.extra = payload.extra
    db.flush()
    _replace_items(db, session, payload)
    db.commit()
    return _load(db, session_id)


@router.get("/{session_id}", response_model=SessionRead)
def get_session(session_id: uuid.UUID, db: Session = Depends(get_db)) -> WorkoutSession:
    session = _load(db, session_id)
    if session is None or session.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Session not found")
    return session


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(
    session_id: uuid.UUID,
    dismissed: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> None:
    """Tombstone. Marks dismissed tombstones so Eir sync will not resurrect them."""
    session = db.get(WorkoutSession, session_id)
    if session is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Session not found")
    existing_extra = session.extra or {}
    if dismissed or existing_extra.get("inferred") is True:
        session.extra = {**existing_extra, "dismissed": True}
    session.deleted_at = datetime.now(timezone.utc)
    db.commit()


@router.post("/{session_id}/split", response_model=SessionSplitResponse)
def split_session(
    session_id: uuid.UUID,
    payload: SessionSplitRequest,
    db: Session = Depends(get_db),
) -> SessionSplitResponse:
    """Atomically splits a session into 2-4 confirmed segments with per-window Eir metrics."""
    try:
        parent_id, created = split_session_atomically(db, session_id, payload)
    except SessionNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except InvalidSplitError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return SessionSplitResponse(
        parent_id=parent_id,
        sessions=[SessionRead.model_validate(item) for item in created],
    )
