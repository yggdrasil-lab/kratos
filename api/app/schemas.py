"""Pydantic schemas — the request and response shapes, and the OpenAPI contract."""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Tracking = Literal["reps_weight", "reps_only", "duration", "completion", "distance_duration"]
WeightBasis = Literal["total", "per_hand"]
SetStatus = Literal["done", "missed", "skipped"]


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ------------------------------------------------------------------- catalogue
class ExerciseBase(BaseModel):
    name: str
    tracking: Tracking = "reps_weight"
    equipment: str | None = None
    mechanics: str | None = None
    weight_basis: WeightBasis = "total"
    primary_muscles: list[str] = Field(default_factory=list)
    secondary_muscles: list[str] = Field(default_factory=list)
    progression_scheme: str | None = None
    video_url: str | None = None
    notes: str | None = None
    extra: dict = Field(default_factory=dict)


class ExerciseCreate(ExerciseBase):
    id: uuid.UUID | None = None


class ExerciseUpdate(BaseModel):
    name: str | None = None
    tracking: Tracking | None = None
    equipment: str | None = None
    mechanics: str | None = None
    weight_basis: WeightBasis | None = None
    primary_muscles: list[str] | None = None
    secondary_muscles: list[str] | None = None
    progression_scheme: str | None = None
    video_url: str | None = None
    notes: str | None = None
    extra: dict | None = None


class ExerciseRead(ORMModel):
    id: uuid.UUID
    name: str
    tracking: Tracking
    equipment: str | None
    mechanics: str | None
    weight_basis: WeightBasis
    primary_muscles: list[str]
    secondary_muscles: list[str]
    progression_scheme: str | None
    video_url: str | None
    notes: str | None
    extra: dict
    created_at: datetime
    updated_at: datetime


# ------------------------------------------------------------------------ plan
class RoutineItemBase(BaseModel):
    exercise_id: uuid.UUID
    position: int
    target_sets: int | None = None
    target_reps: int | None = None
    target_weight_kg: Decimal | None = None
    target_duration_s: int | None = None
    notes: str | None = None


class RoutineItemCreate(RoutineItemBase):
    id: uuid.UUID | None = None


class RoutineItemRead(ORMModel):
    id: uuid.UUID
    routine_id: uuid.UUID
    exercise_id: uuid.UUID
    position: int
    target_sets: int | None
    target_reps: int | None
    target_weight_kg: Decimal | None
    target_duration_s: int | None
    notes: str | None


class RoutineCreate(BaseModel):
    id: uuid.UUID | None = None
    name: str
    notes: str | None = None
    extra: dict = Field(default_factory=dict)
    items: list[RoutineItemCreate] = Field(default_factory=list)


class RoutineUpdate(BaseModel):
    name: str | None = None
    notes: str | None = None
    extra: dict | None = None


class RoutineRead(ORMModel):
    id: uuid.UUID
    name: str
    notes: str | None
    extra: dict
    created_at: datetime
    updated_at: datetime
    items: list[RoutineItemRead] = Field(default_factory=list)


# ------------------------------------------------------------------------- log
class SetEntryBase(BaseModel):
    status: SetStatus = "done"
    reps: int | None = None
    weight_kg: Decimal | None = None
    duration_s: int | None = None
    distance_m: int | None = None
    rpe: Decimal | None = Field(default=None, ge=1, le=10)
    notes: str | None = None
    extra: dict = Field(default_factory=dict)


class SetEntryCreate(SetEntryBase):
    """`set_number` is optional on the way in: the server numbers the sets in order
    when the client does not, which is what a mid-workout sync usually wants."""

    id: uuid.UUID | None = None
    set_number: int | None = None


class SetEntryRead(SetEntryBase, ORMModel):
    id: uuid.UUID
    session_item_id: uuid.UUID
    set_number: int


class SessionItemCreate(BaseModel):
    id: uuid.UUID | None = None
    exercise_id: uuid.UUID
    position: int | None = None
    notes: str | None = None
    sets: list[SetEntryCreate] = Field(default_factory=list)


class SessionItemRead(ORMModel):
    id: uuid.UUID
    session_id: uuid.UUID
    exercise_id: uuid.UUID
    position: int
    notes: str | None
    sets: list[SetEntryRead] = Field(default_factory=list)


class SessionCreate(BaseModel):
    """The offline-first write: the client supplies the ID and the whole tree.

    Sending a session that already exists upserts it, which is what makes the
    outbox flush idempotent.
    """

    id: uuid.UUID
    routine_id: uuid.UUID | None = None
    started_at: datetime
    ended_at: datetime | None = None
    notes: str | None = None
    extra: dict = Field(default_factory=dict)
    items: list[SessionItemCreate] = Field(default_factory=list)


class SessionRead(ORMModel):
    id: uuid.UUID
    routine_id: uuid.UUID | None
    started_at: datetime
    ended_at: datetime | None
    notes: str | None
    extra: dict
    created_at: datetime
    updated_at: datetime
    items: list[SessionItemRead] = Field(default_factory=list)


# --------------------------------------------------------------------- derived
class SetRead(ORMModel):
    set_id: uuid.UUID
    set_number: int
    status: SetStatus
    reps: int | None
    weight_kg: Decimal | None
    duration_s: int | None
    distance_m: int | None
    rpe: Decimal | None
    session_item_id: uuid.UUID
    exercise_id: uuid.UUID
    exercise_name: str
    tracking: Tracking
    weight_basis: WeightBasis
    session_id: uuid.UUID
    started_at: datetime
    session_date: date


class E1rmRead(ORMModel):
    set_id: uuid.UUID
    exercise_id: uuid.UUID
    exercise_name: str
    session_id: uuid.UUID
    session_date: date
    reps: int
    weight_kg: Decimal
    e1rm_kg: Decimal


class SessionVolumeRead(ORMModel):
    session_id: uuid.UUID
    session_date: date
    volume_kg: Decimal | None
    sets_done: int
    sets_missed: int


class ExerciseLastRead(ORMModel):
    exercise_id: uuid.UUID
    exercise_name: str
    last_date: date
    reps: int | None
    weight_kg: Decimal | None
    duration_s: int | None
    set_number: int


class HealthRead(BaseModel):
    status: Literal["ok"] = "ok"
    database: Literal["ok", "unreachable"] = "ok"
