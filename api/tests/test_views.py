"""The derived views, checked against figures the vault itself records.

The spec lists the e1RM values the vault's PR tables hold by hand; computing them
is the whole argument for views, so those exact numbers are the assertions.
"""

import datetime as dt
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models import Exercise, Routine, RoutineItem, Session as WorkoutSession
from app.models import SessionItem, SetEntry


def _session(db: Session, started_at: dt.datetime, *items) -> WorkoutSession:
    session = WorkoutSession(id=uuid.uuid4(), started_at=started_at)
    for position, (exercise, sets) in enumerate(items):
        item = SessionItem(exercise_id=exercise.id, position=position)
        for number, values in enumerate(sets, start=1):
            item.sets.append(SetEntry(set_number=number, **values))
        session.items.append(item)
    db.add(session)
    db.commit()
    return session


@pytest.fixture()
def exercises(db: Session) -> dict[str, Exercise]:
    rows = {
        "dumbbell_press": Exercise(
            name="Bench Press (Dumbbell)", weight_basis="per_hand", tracking="reps_weight"
        ),
        "barbell_press": Exercise(
            name="Bench Press (Barbell)", weight_basis="total", tracking="reps_weight"
        ),
        "plank": Exercise(name="Plank", tracking="duration"),
        "badminton": Exercise(name="Badminton", tracking="completion"),
    }
    db.add_all(rows.values())
    db.commit()
    return rows


def test_volume_doubles_per_hand_loads(db: Session, exercises) -> None:
    """The trap the spec calls out: without doubling, every tonnage is 2x wrong.

    2026-02-16 gives 5096 in the vault. Here: 22kg x 8 x 3 sets per hand
    = 22*8*3*2 = 1056, plus a total-basis 50kg x 12 x 3 = 1800.
    """
    started = dt.datetime(2026, 2, 16, 18, 0, tzinfo=dt.timezone.utc)
    _session(
        db,
        started,
        (exercises["dumbbell_press"], [{"reps": 8, "weight_kg": 22}] * 3),
        (exercises["barbell_press"], [{"reps": 12, "weight_kg": 50}] * 3),
    )
    volume = db.execute(
        text("select volume_kg, sets_done from v_session_volume")
    ).one()
    assert float(volume.volume_kg) == pytest.approx(1056 + 1800)
    assert volume.sets_done == 6


def test_missed_sets_are_counted_but_not_summed(db: Session, exercises) -> None:
    started = dt.datetime(2026, 3, 1, 7, 0, tzinfo=dt.timezone.utc)
    _session(
        db,
        started,
        (
            exercises["barbell_press"],
            [
                {"reps": 12, "weight_kg": 50},
                {"reps": 12, "weight_kg": 55},
                {"status": "missed", "reps": None, "weight_kg": None},
            ],
        ),
    )
    row = db.execute(text("select volume_kg, sets_done, sets_missed from v_session_volume")).one()
    assert row.sets_done == 2
    assert row.sets_missed == 1


@pytest.mark.parametrize(
    ("weight", "reps", "expected"),
    [
        (50, 12, 70.0),
        (55, 12, 77.0),
        (50, 8, 63.3),
        (22, 8, 27.9),
        (16, 10, 21.3),
    ],
)
def test_e1rm_matches_the_vault_pr_tables(
    db: Session, exercises, weight: float, reps: int, expected: float
) -> None:
    """Epley, against the values hand-typed into the vault's PR tables."""
    started = dt.datetime(2026, 4, 1, 9, 0, tzinfo=dt.timezone.utc)
    _session(
        db,
        started,
        (exercises["barbell_press"], [{"reps": reps, "weight_kg": weight}]),
    )
    value = db.execute(text("select e1rm_kg from v_e1rm")).scalar_one()
    assert float(value) == pytest.approx(expected, abs=0.05)


def test_e1rm_excludes_non_weight_tracking(db: Session, exercises) -> None:
    """A 40-minute plank has no 1RM — the view filters it out, not the caller."""
    started = dt.datetime(2026, 4, 2, 9, 0, tzinfo=dt.timezone.utc)
    _session(db, started, (exercises["plank"], [{"duration_s": 2400}]))
    assert db.execute(text("select count(*) from v_e1rm")).scalar_one() == 0
    assert db.execute(text("select count(*) from v_set")).scalar_one() == 1


def test_exercise_last_reports_the_most_recent_performance(db: Session, exercises) -> None:
    """The view that replaces the hand-maintained `last_performance` key.

    The spec records this drift: `Seated Row (Machine)` claimed
    `55kg x 12 x 3` when the day's sets were 55x10, 55x10, 55x12. The view
    reports what happened.
    """
    early = dt.datetime(2026, 5, 1, 9, 0, tzinfo=dt.timezone.utc)
    late = dt.datetime(2026, 5, 8, 9, 0, tzinfo=dt.timezone.utc)
    _session(db, early, (exercises["barbell_press"], [{"reps": 10, "weight_kg": 40}]))
    _session(
        db,
        late,
        (
            exercises["barbell_press"],
            [{"reps": 10, "weight_kg": 55}, {"reps": 10, "weight_kg": 55}, {"reps": 12, "weight_kg": 55}],
        ),
    )
    row = db.execute(
        text("select last_date, reps, weight_kg, set_number from v_exercise_last")
    ).one()
    assert row.last_date == dt.date(2026, 5, 8)
    assert row.reps == 12 and float(row.weight_kg) == 55 and row.set_number == 3


def test_deleted_rows_leave_the_views(db: Session, exercises) -> None:
    """Soft deletes are tombstoned for sync; the views must exclude them."""
    started = dt.datetime(2026, 6, 1, 9, 0, tzinfo=dt.timezone.utc)
    session = _session(
        db, started, (exercises["barbell_press"], [{"reps": 8, "weight_kg": 60}])
    )
    assert db.execute(text("select count(*) from v_set")).scalar_one() == 1
    session.deleted_at = dt.datetime.now(dt.timezone.utc)
    db.commit()
    assert db.execute(text("select count(*) from v_set")).scalar_one() == 0


def test_extra_jsonb_absorbs_a_new_metric_with_no_migration(db: Session, exercises) -> None:
    """Rule 2, executed rather than described: no DDL, no deploy, no backfill."""
    started = dt.datetime(2026, 6, 2, 9, 0, tzinfo=dt.timezone.utc)
    _session(
        db,
        started,
        (
            exercises["barbell_press"],
            [{"reps": 8, "weight_kg": 60, "extra": {"tempo": "3-1-1", "bar_speed": "slow"}}],
        ),
    )
    row = db.execute(text("select extra from set_entry")).one()
    assert row.extra == {"tempo": "3-1-1", "bar_speed": "slow"}


def test_routine_items_keep_their_order(db: Session, exercises) -> None:
    routine = Routine(name="Push Day")
    routine.items.append(RoutineItem(exercise_id=exercises["barbell_press"].id, position=2, target_sets=3))
    routine.items.append(RoutineItem(exercise_id=exercises["plank"].id, position=1, target_duration_s=60))
    db.add(routine)
    db.commit()
    positions = db.execute(text("select position from routine_item order by position")).scalars().all()
    assert positions == [1, 2]


def test_the_same_exercise_can_appear_twice_in_one_session(db: Session, exercises) -> None:
    """Why `session_item` exists: a warm-up block and a working block."""
    started = dt.datetime(2026, 6, 3, 9, 0, tzinfo=dt.timezone.utc)
    _session(
        db,
        started,
        (exercises["barbell_press"], [{"reps": 15, "weight_kg": 20}]),
        (exercises["barbell_press"], [{"reps": 5, "weight_kg": 60}]),
    )
    assert db.execute(text("select count(*) from session_item")).scalar_one() == 2
    assert db.execute(text("select count(*) from v_set")).scalar_one() == 2
