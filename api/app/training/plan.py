"""Routine, routine item, weekly plan, and schedule resolution domain operations."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import Routine, RoutineItem, WeeklyPlan
from app.schemas import (
    RoutineCreate,
    RoutineItemCreate,
    RoutineUpdate,
    WeeklyPlanCreate,
    WeeklyPlanUpdate,
)
from app.training.errors import TrainingNotFoundError


@dataclass(frozen=True)
class ScheduledDay:
    """Authoritative resolved training schedule for a single calendar date."""

    target_date: date
    iso_week: str
    weekly_plan: WeeklyPlan | None
    day_entry: dict[str, Any] | None
    activity_type: str
    activity_name: str | None
    routine: Routine | None
    source: Literal["weekly_plan", "routine_rotation", "unscheduled"]


def _merge_source(extra: dict[str, Any] | None, source: str | None) -> dict[str, Any]:
    if source is None:
        return dict(extra or {})
    return {**(extra or {}), "source": source}


def _load_routine(db: Session, routine_id: uuid.UUID) -> Routine:
    stmt = (
        select(Routine)
        .where(Routine.id == routine_id, Routine.deleted_at.is_(None))
        .options(selectinload(Routine.items))
    )
    routine = db.scalar(stmt)
    if routine is None:
        raise TrainingNotFoundError("Routine not found")
    return routine


def list_routines(db: Session) -> list[Routine]:
    """List active routines with ordered items."""
    stmt = (
        select(Routine)
        .where(Routine.deleted_at.is_(None))
        .options(selectinload(Routine.items))
        .order_by(Routine.name)
    )
    return list(db.scalars(stmt))


def get_routine(db: Session, routine_id: uuid.UUID) -> Routine:
    """Fetch one active routine with items or raise TrainingNotFoundError."""
    return _load_routine(db, routine_id)


def create_routine(
    db: Session,
    payload: RoutineCreate,
    *,
    source: str | None = None,
) -> Routine:
    """Create a routine and optional child items."""
    routine = Routine(
        name=payload.name,
        notes=payload.notes,
        extra=_merge_source(payload.extra, source),
        **({"id": payload.id} if payload.id else {}),
    )
    for item in payload.items:
        item_data = item.model_dump(exclude_none=True, exclude={"id"})
        if source is not None:
            item_data["extra"] = {"source": source}
        routine.items.append(RoutineItem(**item_data))
    db.add(routine)
    db.commit()
    return _load_routine(db, routine.id)


def update_routine(
    db: Session,
    routine_id: uuid.UUID,
    payload: RoutineUpdate,
    *,
    source: str | None = None,
) -> Routine:
    """Patch an active routine."""
    routine = _load_routine(db, routine_id)
    updates = payload.model_dump(exclude_unset=True)
    extra_update = updates.pop("extra", None)
    for field, value in updates.items():
        setattr(routine, field, value)
    if extra_update is not None:
        routine.extra = _merge_source(extra_update, source)
    elif source is not None:
        routine.extra = _merge_source(routine.extra, source)
    db.commit()
    return _load_routine(db, routine.id)


def delete_routine(
    db: Session,
    routine_id: uuid.UUID,
    *,
    source: str | None = None,
) -> None:
    """Soft-delete an active routine."""
    routine = _load_routine(db, routine_id)
    if source is not None:
        routine.extra = _merge_source(routine.extra, source)
    routine.deleted_at = datetime.now(timezone.utc)
    db.commit()


def add_routine_item(
    db: Session,
    routine_id: uuid.UUID,
    payload: RoutineItemCreate | dict[str, Any],
    *,
    source: str | None = None,
) -> RoutineItem:
    """Append an exercise slot to an active routine."""
    routine = _load_routine(db, routine_id)
    if isinstance(payload, RoutineItemCreate):
        item_data = payload.model_dump(exclude_none=True, exclude={"id"})
    else:
        item_data = dict(payload)
    if source is not None:
        item_data["extra"] = _merge_source(item_data.get("extra"), source)
    item = RoutineItem(routine_id=routine.id, **item_data)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def remove_routine_item(
    db: Session,
    routine_id: uuid.UUID,
    item_id: uuid.UUID,
) -> None:
    """Soft-delete a routine item slot belonging to routine_id."""
    item = db.get(RoutineItem, item_id)
    if item is None or item.routine_id != routine_id:
        raise TrainingNotFoundError("Routine item not found")
    item.deleted_at = datetime.now(timezone.utc)
    db.commit()


def get_weekly_plan(db: Session, iso_week: str) -> WeeklyPlan | None:
    """Fetch the active weekly plan for an ISO week, or None if unscheduled."""
    stmt = select(WeeklyPlan).where(
        WeeklyPlan.iso_week == iso_week,
        WeeklyPlan.deleted_at.is_(None),
    )
    return db.scalar(stmt)


def upsert_weekly_plan(
    db: Session,
    iso_week: str,
    payload: WeeklyPlanCreate | WeeklyPlanUpdate,
    *,
    source: str | None = None,
) -> WeeklyPlan:
    """Create or replace a weekly schedule plan for an ISO week."""
    plan = get_weekly_plan(db, iso_week)
    if plan is None:
        days = payload.days if payload.days is not None else []
        plan = WeeklyPlan(
            iso_week=iso_week,
            days=days,
            notes=payload.notes,
            extra=_merge_source(payload.extra, source),
        )
        db.add(plan)
    else:
        _apply_weekly_plan_update(plan, payload, source=source)
    db.commit()
    db.refresh(plan)
    return plan


def _apply_weekly_plan_update(
    plan: WeeklyPlan,
    payload: WeeklyPlanCreate | WeeklyPlanUpdate,
    *,
    source: str | None,
) -> None:
    if isinstance(payload, WeeklyPlanCreate):
        plan.days = payload.days
        plan.notes = payload.notes
    else:
        if payload.days is not None:
            plan.days = payload.days
        if "notes" in payload.model_fields_set and payload.notes is not None:
            plan.notes = payload.notes
    merged_extra = {**(plan.extra or {}), **(payload.extra or {})}
    if source is not None:
        merged_extra["source"] = source
    if payload.extra or source is not None:
        plan.extra = merged_extra


def _match_day_entry(days: list[dict[str, Any]], target_date: date) -> dict[str, Any] | None:
    day_of_week = target_date.weekday()
    weekday_name = target_date.strftime("%a")
    for index, entry in enumerate(days):
        if (
            entry.get("day") == weekday_name
            or entry.get("dayIndex") == day_of_week
            or (entry.get("dayIndex") is None and index == day_of_week)
        ):
            return entry
    return None


def _find_matching_routine(db: Session, activity_name: str) -> Routine | None:
    options = selectinload(Routine.items).selectinload(RoutineItem.exercise)
    exact = db.scalar(
        select(Routine)
        .where(Routine.name.ilike(activity_name), Routine.deleted_at.is_(None))
        .options(options)
    )
    if exact is not None:
        return exact
    return db.scalar(
        select(Routine)
        .where(Routine.name.ilike(f"%{activity_name}%"), Routine.deleted_at.is_(None))
        .options(options)
    )


def resolve_scheduled_day(
    db: Session,
    target_date: date,
    *,
    weekly_plan: WeeklyPlan | None = None,
) -> ScheduledDay:
    """Resolve the authoritative scheduled workout or rest entry for target_date."""
    iso_year, iso_week, _ = target_date.isocalendar()
    iso_week_str = f"{iso_year}-W{iso_week:02d}"
    plan = weekly_plan if weekly_plan is not None else get_weekly_plan(db, iso_week_str)

    day_entry = _match_day_entry(plan.days, target_date) if plan and plan.days else None
    if day_entry is not None:
        activity_name = day_entry.get("sessionName") or day_entry.get("activity")
        activity_type = day_entry.get("type", "lift")
        routine = (
            _find_matching_routine(db, activity_name)
            if activity_type == "lift" and activity_name
            else None
        )
        return ScheduledDay(
            target_date=target_date,
            iso_week=iso_week_str,
            weekly_plan=plan,
            day_entry=day_entry,
            activity_type=activity_type,
            activity_name=activity_name,
            routine=routine,
            source="weekly_plan",
        )

    routines = list(
        db.scalars(
            select(Routine)
            .where(Routine.deleted_at.is_(None))
            .options(selectinload(Routine.items).selectinload(RoutineItem.exercise))
            .order_by(Routine.name)
        )
    )
    if routines:
        routine = routines[target_date.weekday() % len(routines)]
        return ScheduledDay(
            target_date=target_date,
            iso_week=iso_week_str,
            weekly_plan=plan,
            day_entry=None,
            activity_type="lift",
            activity_name=routine.name,
            routine=routine,
            source="routine_rotation",
        )

    return ScheduledDay(
        target_date=target_date,
        iso_week=iso_week_str,
        weekly_plan=plan,
        day_entry=None,
        activity_type="rest",
        activity_name=None,
        routine=None,
        source="unscheduled",
    )
