"""Direct interface tests for the deep TrainingCore domain package."""

from __future__ import annotations

import datetime as dt
import uuid

import pytest

from app.schemas import (
    ExerciseCreate,
    ExerciseUpdate,
    RoutineCreate,
    RoutineItemCreate,
    RoutineUpdate,
    SessionCreate,
    SessionItemCreate,
    SessionSplitRequest,
    SetEntryCreate,
    SplitSegmentInput,
    WeeklyPlanCreate,
    WeeklyPlanUpdate,
    WorkoutMetricsRead,
)
from app.training import (
    InvalidSplitError,
    TrainingConflictError,
    TrainingCore,
    TrainingNotFoundError,
)
from tests.fakes import InMemoryEirAdapter


def test_training_core_catalogue_crud_conflict_and_provenance(db) -> None:
    core = TrainingCore(eir=InMemoryEirAdapter())

    created = core.create_exercise(
        db,
        ExerciseCreate(name="Romanian Deadlift", primary_muscles=["hamstrings"]),
        source="agent",
    )
    assert created.extra["source"] == "agent"

    assert [ex.id for ex in core.search_exercises(db, muscle="hamstrings")] == [created.id]

    updated = core.update_exercise(
        db,
        created.id,
        ExerciseUpdate(notes="Hinge at hips"),
        source="app",
    )
    assert updated.notes == "Hinge at hips"
    assert updated.extra["source"] == "app"

    noted = core.add_exercise_note(db, created.id, "Control eccentric", source="agent")
    assert noted.notes == "Hinge at hips\nControl eccentric"
    assert noted.extra["source"] == "agent"

    with pytest.raises(TrainingConflictError, match="already exists"):
        core.create_exercise(db, ExerciseCreate(name="Romanian Deadlift"))

    core.delete_exercise(db, created.id)
    with pytest.raises(TrainingNotFoundError, match="Exercise not found"):
        core.get_exercise(db, created.id)

    with pytest.raises(TrainingConflictError, match="soft-deleted"):
        core.create_exercise(db, ExerciseCreate(name="Romanian Deadlift"))


def test_training_core_plan_routines_and_resolve_scheduled_day(db) -> None:
    core = TrainingCore(eir=InMemoryEirAdapter())
    target_monday = dt.date(2026, 11, 23)  # 2026-W48 Monday

    unscheduled = core.resolve_scheduled_day(db, target_monday)
    assert unscheduled.source == "unscheduled"
    assert unscheduled.activity_type == "rest"
    assert unscheduled.routine is None

    squat = core.create_exercise(db, ExerciseCreate(name="Safety Bar Squat"))
    lower = core.create_routine(
        db,
        RoutineCreate(
            name="Lower Body A",
            items=[RoutineItemCreate(exercise_id=squat.id, position=0, target_sets=3)],
        ),
        source="agent",
    )
    assert lower.extra["source"] == "agent"
    assert len(lower.items) == 1

    core.update_routine(db, lower.id, RoutineUpdate(notes="Heavy focus"), source="app")
    added = core.add_routine_item(
        db,
        lower.id,
        RoutineItemCreate(exercise_id=squat.id, position=1, target_sets=2),
        source="agent",
    )
    assert added.extra["source"] == "agent"

    rotated = core.resolve_scheduled_day(db, target_monday)
    assert rotated.source == "routine_rotation"
    assert rotated.routine is not None and rotated.routine.id == lower.id

    core.upsert_weekly_plan(
        db,
        "2026-W48",
        WeeklyPlanCreate(
            iso_week="2026-W48",
            days=[{"dayIndex": 0, "sessionName": "Lower Body A", "type": "lift"}],
            notes="Primary block",
        ),
        source="app",
    )
    core.upsert_weekly_plan(
        db,
        "2026-W48",
        WeeklyPlanUpdate(
            days=[{"dayIndex": 0, "sessionName": "Lower Body A", "type": "lift"}],
        ),
        source="agent",
    )
    loaded_plan = core.get_weekly_plan(db, "2026-W48")
    assert loaded_plan is not None
    assert loaded_plan.notes == "Primary block"
    assert loaded_plan.extra["source"] == "agent"

    planned = core.resolve_scheduled_day(db, target_monday)
    assert planned.source == "weekly_plan"
    assert planned.activity_type == "lift"
    assert planned.activity_name == "Lower Body A"
    assert planned.routine is not None and planned.routine.id == lower.id

    core.remove_routine_item(db, lower.id, added.id)
    core.delete_routine(db, lower.id)
    with pytest.raises(TrainingNotFoundError, match="Routine not found"):
        core.get_routine(db, lower.id)


def test_training_core_sessions_and_atomic_split(db) -> None:
    eir = InMemoryEirAdapter(
        metrics_responses=[
            WorkoutMetricsRead(
                started_at=dt.datetime(2026, 11, 23, 4, 30, tzinfo=dt.timezone.utc),
                ended_at=dt.datetime(2026, 11, 23, 5, 0, tzinfo=dt.timezone.utc),
                duration_minutes=30,
                active_energy_kcal=250,
                avg_hr_bpm=148,
                peak_hr_bpm=168,
            ),
            WorkoutMetricsRead(
                started_at=dt.datetime(2026, 11, 23, 5, 5, tzinfo=dt.timezone.utc),
                ended_at=dt.datetime(2026, 11, 23, 5, 35, tzinfo=dt.timezone.utc),
                duration_minutes=30,
                active_energy_kcal=210,
                avg_hr_bpm=132,
                peak_hr_bpm=150,
            ),
        ]
    )
    core = TrainingCore(eir=eir)
    ex = core.create_exercise(db, ExerciseCreate(name="Pull-Up"))
    routine = core.create_routine(db, RoutineCreate(name="Upper Pull", items=[]))

    sid = uuid.uuid4()
    saved = core.upsert_session(
        db,
        sid,
        SessionCreate(
            id=sid,
            routine_id=uuid.uuid4(),  # unknown routine_id resolves to None
            started_at=dt.datetime(2026, 11, 23, 4, 30, tzinfo=dt.timezone.utc),
            ended_at=dt.datetime(2026, 11, 23, 5, 35, tzinfo=dt.timezone.utc),
            extra={"inferred": True},
            items=[
                SessionItemCreate(
                    exercise_id=ex.id,
                    position=0,
                    sets=[SetEntryCreate(reps=10)],
                )
            ],
        ),
        source="app",
    )
    assert saved.routine_id is None
    assert saved.extra["source"] == "app"

    with pytest.raises(InvalidSplitError, match="not found"):
        core.split_session(
            db,
            sid,
            SessionSplitRequest(
                segments=[
                    SplitSegmentInput(
                        started_at=dt.datetime(2026, 11, 23, 4, 30, tzinfo=dt.timezone.utc),
                        ended_at=dt.datetime(2026, 11, 23, 5, 0, tzinfo=dt.timezone.utc),
                    ),
                    SplitSegmentInput(
                        started_at=dt.datetime(2026, 11, 23, 5, 5, tzinfo=dt.timezone.utc),
                        ended_at=dt.datetime(2026, 11, 23, 5, 35, tzinfo=dt.timezone.utc),
                        routine_id=uuid.uuid4(),
                    ),
                ]
            ),
        )

    parent_id, children = core.split_session(
        db,
        sid,
        SessionSplitRequest(
            segments=[
                SplitSegmentInput(
                    started_at=dt.datetime(2026, 11, 23, 4, 30, tzinfo=dt.timezone.utc),
                    ended_at=dt.datetime(2026, 11, 23, 5, 0, tzinfo=dt.timezone.utc),
                    activity_type="class",
                    routine_name="Metcon",
                ),
                SplitSegmentInput(
                    started_at=dt.datetime(2026, 11, 23, 5, 5, tzinfo=dt.timezone.utc),
                    ended_at=dt.datetime(2026, 11, 23, 5, 35, tzinfo=dt.timezone.utc),
                    routine_id=routine.id,
                ),
            ]
        ),
    )
    assert parent_id == sid
    assert len(children) == 2
    assert children[0].extra["telemetry_source"] == "eir_split"
    assert children[0].extra["split_from_id"] == str(sid)
    assert children[1].routine_id == routine.id
    assert children[1].extra["routine_name"] == "Upper Pull"

    with pytest.raises(TrainingNotFoundError, match="Session not found"):
        core.get_session(db, sid)

    core.delete_session(db, children[0].id, dismissed=True)
    deleted_list = core.list_sessions(db, include_deleted=True)
    tombstone = next(item for item in deleted_list if item.id == children[0].id)
    assert tombstone.extra["dismissed"] is True
