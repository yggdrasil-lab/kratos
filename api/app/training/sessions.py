"""Logged workout session domain operations."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, selectinload

from app.models import Routine, SessionItem, SetEntry
from app.models import Session as WorkoutSession
from app.schemas import SessionCreate
from app.training.errors import TrainingNotFoundError


def _load_session(db: Session, session_id: uuid.UUID) -> WorkoutSession | None:
    stmt = (
        select(WorkoutSession)
        .where(WorkoutSession.id == session_id)
        .options(selectinload(WorkoutSession.items).selectinload(SessionItem.sets))
        .execution_options(populate_existing=True)
    )
    return db.scalars(stmt).first()


def _replace_items(db: Session, session: WorkoutSession, payload: SessionCreate) -> None:
    """Replace the session item and set tree atomically for idempotent upserts."""
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


def _merge_source(extra: dict[str, Any] | None, source: str | None) -> dict[str, Any]:
    if source is None:
        return dict(extra or {})
    return {**(extra or {}), "source": source}


def list_sessions(
    db: Session,
    *,
    limit: int = 50,
    routine_id: uuid.UUID | None = None,
    include_deleted: bool = False,
) -> list[WorkoutSession]:
    """List workout sessions ordered newest-first."""
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


def get_session(db: Session, session_id: uuid.UUID) -> WorkoutSession:
    """Fetch one active session with items and sets or raise TrainingNotFoundError."""
    session = _load_session(db, session_id)
    if session is None or session.deleted_at is not None:
        raise TrainingNotFoundError("Session not found")
    return session


def upsert_session(
    db: Session,
    session_id: uuid.UUID,
    payload: SessionCreate,
    *,
    source: str | None = None,
) -> WorkoutSession:
    """Idempotently upsert a session and its full item/set tree."""
    routine_id = payload.routine_id
    if routine_id is not None and db.get(Routine, routine_id) is None:
        routine_id = None

    merged_extra = _merge_source(payload.extra, source)
    session = _load_session(db, session_id)
    if session is None:
        session = WorkoutSession(
            id=session_id,
            routine_id=routine_id,
            started_at=payload.started_at,
            ended_at=payload.ended_at,
            notes=payload.notes,
            extra=merged_extra,
        )
        db.add(session)
    else:
        session.routine_id = routine_id
        session.started_at = payload.started_at
        session.ended_at = payload.ended_at
        session.notes = payload.notes
        session.extra = merged_extra
    db.flush()
    _replace_items(db, session, payload)
    db.commit()
    loaded = _load_session(db, session_id)
    if loaded is None:
        raise TrainingNotFoundError("Session not found after upsert")
    return loaded


def delete_session(
    db: Session,
    session_id: uuid.UUID,
    *,
    dismissed: bool = False,
) -> None:
    """Soft-delete a session, marking dismissed tombstones to block Eir resurrection."""
    session = db.get(WorkoutSession, session_id)
    if session is None:
        raise TrainingNotFoundError("Session not found")
    existing_extra = session.extra or {}
    if dismissed or existing_extra.get("inferred") is True:
        session.extra = {**existing_extra, "dismissed": True}
    session.deleted_at = datetime.now(timezone.utc)
    db.commit()
