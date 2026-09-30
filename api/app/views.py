"""Read-only projections of the four derived views.

Derived values are computed in the database, never stored: the vault keeps
`volume:` in frontmatter and hand-types e1RM into PR tables, and both have already
drifted. These map the views the migration creates so the API can query them
without writing the SQL by hand.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, Integer, Numeric, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class ViewBase(DeclarativeBase):
    """Separate base: these are views, so never create or drop them from metadata."""


class VSet(ViewBase):
    """Every live set, joined up to its exercise and session."""

    __tablename__ = "v_set"

    set_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    set_number: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(Text)
    reps: Mapped[int | None] = mapped_column(Integer)
    weight_kg: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    duration_s: Mapped[int | None] = mapped_column(Integer)
    distance_m: Mapped[int | None] = mapped_column(Integer)
    rpe: Mapped[Decimal | None] = mapped_column(Numeric(3, 1))
    notes: Mapped[str | None] = mapped_column(Text)
    extra: Mapped[dict] = mapped_column(JSONB)
    session_item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    exercise_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    exercise_name: Mapped[str] = mapped_column(Text)
    tracking: Mapped[str] = mapped_column(Text)
    weight_basis: Mapped[str] = mapped_column(Text)
    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    session_date: Mapped[date] = mapped_column(Date)


class VE1rm(ViewBase):
    """Estimated 1RM, Epley: weight * (1 + reps/30)."""

    __tablename__ = "v_e1rm"

    set_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    exercise_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    exercise_name: Mapped[str] = mapped_column(Text)
    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    session_date: Mapped[date] = mapped_column(Date)
    reps: Mapped[int] = mapped_column(Integer)
    weight_kg: Mapped[Decimal] = mapped_column(Numeric(6, 2))
    e1rm_kg: Mapped[Decimal] = mapped_column(Numeric(6, 2))


class VSessionVolume(ViewBase):
    """Volume per session, doubling `per_hand` loads."""

    __tablename__ = "v_session_volume"

    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    session_date: Mapped[date] = mapped_column(Date, primary_key=True)
    volume_kg: Mapped[Decimal | None] = mapped_column(Numeric)
    sets_done: Mapped[int] = mapped_column(Integer)
    sets_missed: Mapped[int] = mapped_column(Integer)


class VExerciseLast(ViewBase):
    """Last performance per exercise."""

    __tablename__ = "v_exercise_last"

    exercise_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    exercise_name: Mapped[str] = mapped_column(Text)
    last_date: Mapped[date] = mapped_column(Date)
    reps: Mapped[int | None] = mapped_column(Integer)
    weight_kg: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    duration_s: Mapped[int | None] = mapped_column(Integer)
    set_number: Mapped[int] = mapped_column(Integer)
