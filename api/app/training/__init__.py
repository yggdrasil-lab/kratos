"""Deep training core: exercise catalogue, routines, weekly plans, and logged sessions."""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from app.models import Exercise, Routine, RoutineItem, WeeklyPlan
from app.models import Session as WorkoutSession
from app.ports.eir import EirPort
from app.schemas import (
    ExerciseCreate,
    ExerciseUpdate,
    RoutineCreate,
    RoutineItemCreate,
    RoutineUpdate,
    SessionCreate,
    SessionSplitRequest,
    WeeklyPlanCreate,
    WeeklyPlanUpdate,
)
from app.training import catalogue, plan, session_split, sessions
from app.training.errors import (
    InvalidSplitError,
    TrainingConflictError,
    TrainingError,
    TrainingNotFoundError,
)
from app.training.plan import ScheduledDay
from app.training.session_split import build_split_child_extra


class TrainingCore:
    """Cohesive domain core shared by REST routers, MCP tools, and downstream engines."""

    def __init__(self, *, eir: EirPort) -> None:
        self._eir = eir

    def list_exercises(
        self,
        db: Session,
        *,
        muscle: str | None = None,
        tracking: str | None = None,
    ) -> list[Exercise]:
        return catalogue.list_exercises(db, muscle=muscle, tracking=tracking)

    def search_exercises(
        self,
        db: Session,
        *,
        muscle: str | None = None,
        tracking: str | None = None,
    ) -> list[Exercise]:
        return catalogue.search_exercises(db, muscle=muscle, tracking=tracking)

    def get_exercise(self, db: Session, exercise_id: uuid.UUID) -> Exercise:
        return catalogue.get_exercise(db, exercise_id)

    def create_exercise(
        self,
        db: Session,
        payload: ExerciseCreate,
        *,
        source: str | None = None,
    ) -> Exercise:
        return catalogue.create_exercise(db, payload, source=source)

    def update_exercise(
        self,
        db: Session,
        exercise_id: uuid.UUID,
        payload: ExerciseUpdate,
        *,
        source: str | None = None,
    ) -> Exercise:
        return catalogue.update_exercise(db, exercise_id, payload, source=source)

    def add_exercise_note(
        self,
        db: Session,
        exercise_id: uuid.UUID,
        note: str,
        *,
        source: str | None = None,
    ) -> Exercise:
        return catalogue.add_exercise_note(db, exercise_id, note, source=source)

    def delete_exercise(
        self,
        db: Session,
        exercise_id: uuid.UUID,
        *,
        source: str | None = None,
    ) -> None:
        catalogue.delete_exercise(db, exercise_id, source=source)

    def list_routines(self, db: Session) -> list[Routine]:
        return plan.list_routines(db)

    def get_routine(self, db: Session, routine_id: uuid.UUID) -> Routine:
        return plan.get_routine(db, routine_id)

    def create_routine(
        self,
        db: Session,
        payload: RoutineCreate,
        *,
        source: str | None = None,
    ) -> Routine:
        return plan.create_routine(db, payload, source=source)

    def update_routine(
        self,
        db: Session,
        routine_id: uuid.UUID,
        payload: RoutineUpdate,
        *,
        source: str | None = None,
    ) -> Routine:
        return plan.update_routine(db, routine_id, payload, source=source)

    def delete_routine(
        self,
        db: Session,
        routine_id: uuid.UUID,
        *,
        source: str | None = None,
    ) -> None:
        plan.delete_routine(db, routine_id, source=source)

    def add_routine_item(
        self,
        db: Session,
        routine_id: uuid.UUID,
        payload: RoutineItemCreate | dict[str, Any],
        *,
        source: str | None = None,
    ) -> RoutineItem:
        return plan.add_routine_item(db, routine_id, payload, source=source)

    def remove_routine_item(
        self,
        db: Session,
        routine_id: uuid.UUID,
        item_id: uuid.UUID,
    ) -> None:
        plan.remove_routine_item(db, routine_id, item_id)

    def get_weekly_plan(self, db: Session, iso_week: str) -> WeeklyPlan | None:
        return plan.get_weekly_plan(db, iso_week)

    def upsert_weekly_plan(
        self,
        db: Session,
        iso_week: str,
        payload: WeeklyPlanCreate | WeeklyPlanUpdate,
        *,
        source: str | None = None,
    ) -> WeeklyPlan:
        return plan.upsert_weekly_plan(db, iso_week, payload, source=source)

    def resolve_scheduled_day(
        self,
        db: Session,
        target_date: date,
        *,
        weekly_plan: WeeklyPlan | None = None,
    ) -> ScheduledDay:
        return plan.resolve_scheduled_day(db, target_date, weekly_plan=weekly_plan)

    def list_sessions(
        self,
        db: Session,
        *,
        limit: int = 50,
        routine_id: uuid.UUID | None = None,
        include_deleted: bool = False,
    ) -> list[WorkoutSession]:
        return sessions.list_sessions(
            db,
            limit=limit,
            routine_id=routine_id,
            include_deleted=include_deleted,
        )

    def get_session(self, db: Session, session_id: uuid.UUID) -> WorkoutSession:
        return sessions.get_session(db, session_id)

    def upsert_session(
        self,
        db: Session,
        session_id: uuid.UUID,
        payload: SessionCreate,
        *,
        source: str | None = None,
    ) -> WorkoutSession:
        return sessions.upsert_session(db, session_id, payload, source=source)

    def delete_session(
        self,
        db: Session,
        session_id: uuid.UUID,
        *,
        dismissed: bool = False,
    ) -> None:
        sessions.delete_session(db, session_id, dismissed=dismissed)

    def split_session(
        self,
        db: Session,
        session_id: uuid.UUID,
        payload: SessionSplitRequest,
    ) -> tuple[uuid.UUID, list[WorkoutSession]]:
        return session_split.split_session_atomically(
            db,
            session_id,
            payload,
            eir=self._eir,
        )


__all__ = [
    "InvalidSplitError",
    "ScheduledDay",
    "TrainingConflictError",
    "TrainingCore",
    "TrainingError",
    "TrainingNotFoundError",
    "build_split_child_extra",
]
