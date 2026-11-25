"""Pytest integration and unit tests for the autoregulated workout engine."""

from __future__ import annotations

import datetime as dt

import pytest
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from app.autoregulation.coordinator import _persist_workout_cache
from app.autoregulation.workout import (
    generate_workout_recommendation,
    get_active_exercises,
    get_active_routines,
    get_recent_lift_history,
    get_recent_muscle_volume,
    synthesize_workout_recommendation,
)
from app.models import (
    Exercise,
    Routine,
    RoutineItem,
    Session as WorkoutSession,
    SessionItem,
    SetEntry,
    WeeklyPlan,
    WorkoutRecommendation,
)
from app.ports.muninn import MuninnUpstreamError
from app.schemas import (
    ExerciseCreate,
    RecommendedExerciseItem,
    WorkoutRecommendationRead,
    infer_weight_basis_from_name,
)
from tests.conftest import FakeAdapters
from tests.fakes import InMemoryMuninnAdapter


def _seed_upper_routine(db: Session) -> tuple[Exercise, Routine]:
    bench = Exercise(
        name="Bench Press",
        weight_basis="total",
        tracking="reps_weight",
        primary_muscles=["chest"],
    )
    routine = Routine(name="Upper Body A")
    routine.items.append(
        RoutineItem(
            exercise=bench,
            position=0,
            target_sets=3,
            target_reps=10,
            target_weight_kg=60.0,
        )
    )
    db.add_all([bench, routine])
    db.commit()
    return bench, routine


def test_workout_engine_fatigued_state(db: Session) -> None:
    _seed_upper_routine(db)
    target_d = dt.date(2026, 11, 2)
    plan = WeeklyPlan(
        iso_week="2026-W45",
        days=[{"day": "Mon", "activity": "Upper Body A", "type": "lift"}],
    )
    biometrics = {"sleep_duration_hours": 5.1, "hrv_ms": 28.0}

    rec = generate_workout_recommendation(target_d, plan, biometrics, db=db)
    assert rec.recovery_status == "fatigued"
    assert rec.volume_landmark == "MEV"
    assert "RIR 3-4" in rec.target_rir
    assert len(rec.exercises) == 1
    assert rec.exercises[0].exercise_name == "Bench Press"
    assert rec.exercises[0].target_sets == 2
    assert rec.exercises[0].suggested_weight_kg == 60.0


def test_workout_engine_moderate_and_last_lift_fallback(db: Session) -> None:
    squat = Exercise(name="Back Squat", weight_basis="total", tracking="reps_weight")
    routine = Routine(name="Lower Body A")
    routine.items.append(
        RoutineItem(
            exercise=squat,
            position=0,
            target_sets=4,
            target_reps=8,
            target_weight_kg=None,
        )
    )
    db.add_all([squat, routine])
    db.flush()

    past_session = WorkoutSession(
        started_at=dt.datetime(2026, 11, 1, 10, 0, tzinfo=dt.timezone.utc)
    )
    db.add(past_session)
    db.flush()
    item = SessionItem(session_id=past_session.id, exercise_id=squat.id, position=0)
    db.add(item)
    db.flush()
    db.add(
        SetEntry(
            session_item_id=item.id,
            set_number=1,
            status="done",
            weight_kg=102.5,
            reps=8,
        )
    )
    db.commit()

    plan = WeeklyPlan(
        iso_week="2026-W45",
        days=[{"day": "Mon", "activity": "Lower Body A", "type": "lift"}],
    )
    rec = generate_workout_recommendation(
        dt.date(2026, 11, 2),
        plan,
        {"sleep_duration_hours": 6.2, "hrv_ms": 48.0},
        db=db,
    )
    assert rec.recovery_status == "moderate"
    assert rec.volume_landmark == "MAV"
    assert rec.target_rir == "RIR 2"
    assert rec.exercises[0].target_sets == 4
    assert rec.exercises[0].suggested_weight_kg == 102.5


def test_duration_exercise_and_fatigued_notes(db: Session) -> None:
    plank = Exercise(name="Plank", weight_basis="total", tracking="duration")
    plank_routine = Routine(name="Core Session")
    plank_routine.items.append(
        RoutineItem(
            exercise=plank,
            position=0,
            target_sets=2,
            target_duration_s=60,
            notes="Hold to failure.",
        )
    )
    db.add_all([plank, plank_routine])
    db.commit()

    plan = WeeklyPlan(
        iso_week="2026-W45",
        days=[{"day": "Mon", "activity": "Core Session", "type": "lift"}],
    )
    rec = generate_workout_recommendation(
        dt.date(2026, 11, 2),
        plan,
        {"sleep_duration_hours": 5.0, "hrv_ms": 25.0},
        db=db,
    )
    assert rec.exercises[0].target_reps == "60s hold"
    assert rec.exercises[0].notes is not None
    assert "RIR 3-4" in rec.exercises[0].notes
    assert "Hold to failure." not in rec.exercises[0].notes


def test_workout_engine_sport_day_and_rest_day(db: Session) -> None:
    _seed_upper_routine(db)
    sport_plan = WeeklyPlan(
        iso_week="2026-W45",
        days=[
            {"day": "Tue", "activity": "Badminton Focus", "type": "sport"},
            {"day": "Fri", "activity": "Rest Day", "type": "rest"},
        ],
    )
    sport_rec = generate_workout_recommendation(dt.date(2026, 11, 3), sport_plan, None, db=db)
    assert "Badminton" in sport_rec.routine_name
    assert sport_rec.target_rir == "RIR 2-3"
    assert sport_rec.volume_landmark == "Sport Fueling"
    assert "mobility" in sport_rec.readiness_adaptation.lower()

    rest_rec = generate_workout_recommendation(dt.date(2026, 11, 6), sport_plan, None, db=db)
    assert rest_rec.target_rir == "N/A"
    assert rest_rec.volume_landmark == "Deload"


def test_workout_engine_optimal_state(db: Session) -> None:
    _seed_upper_routine(db)
    plan = WeeklyPlan(
        iso_week="2026-W45",
        days=[{"day": "Mon", "activity": "Upper Body A", "type": "lift"}],
    )
    rec = generate_workout_recommendation(
        dt.date(2026, 11, 2),
        plan,
        {"sleep_duration_hours": 8.0, "hrv_ms": 55.0},
        db=db,
    )
    assert rec.recovery_status == "optimal"
    assert rec.volume_landmark == "MAV"
    assert "RIR 1" in rec.target_rir
    assert rec.exercises[0].target_sets == 3


def test_workout_engine_empty_db_prompts_user(db: Session) -> None:
    rec = generate_workout_recommendation(dt.date(2026, 11, 2), None, None, db=db)
    assert rec.exercises == []
    assert "No routines configured" in rec.readiness_adaptation


def test_workout_llm_synthesis_success_and_fallback(db: Session) -> None:
    _seed_upper_routine(db)
    muninn = InMemoryMuninnAdapter(
        json_responses=[
            {
                "routine_name": "Upper Body A (Joint Sparing)",
                "readiness_adaptation": "Volume scaled to MEV (2 sets @ RIR 3) to protect anterior shoulder.",
                "target_rir": "RIR 3",
                "volume_landmark": "MEV",
                "rationale": "Synthesized for shoulder impingement note and low HRV.",
                "exercises": [
                    {
                        "exercise_name": "Neutral-Grip Dumbbell Bench Press",
                        "target_sets": 2,
                        "target_reps": "8-10 reps",
                        "suggested_weight_kg": 28.0,
                        "notes": "Neutral grip to eliminate rotator cuff impingement.",
                    }
                ],
                "recovery_status": "fatigued",
                "research_citation": "McGill (Joint Sparing) & Israetel (Volume Landmarks)",
            }
        ],
        jev_verdicts=[
            '{"recovery_tier": "MEV_DELOAD", "joint_focus": "SHOULDER_SPARING", "time_budget": "TIME_STANDARD_45M"}'
        ],
    )
    rec = synthesize_workout_recommendation(
        target_date=dt.date(2026, 11, 2),
        weekly_plan=None,
        biometrics={"hrv_ms": 32.0, "sleep_duration_hours": 6.0},
        custom_context="Left shoulder pinching",
        db=db,
        muninn=muninn,
    )
    assert rec.is_llm_generated is True
    assert rec.routine_name == "Upper Body A (Joint Sparing)"
    assert rec.exercises[0].exercise_name == "Neutral-Grip Dumbbell Bench Press"
    assert rec.exercises[0].weight_basis == "per_hand"
    assert len(muninn.synthesize_calls) == 1

    failing_muninn = InMemoryMuninnAdapter(
        raise_on_synthesize=MuninnUpstreamError("Connection refused"),
        raise_on_decide=MuninnUpstreamError("Connection refused"),
    )
    fallback = synthesize_workout_recommendation(
        target_date=dt.date(2026, 11, 2),
        weekly_plan=None,
        biometrics={"hrv_ms": 50.0, "sleep_duration_hours": 8.0},
        db=db,
        muninn=failing_muninn,
    )
    assert fallback.is_llm_generated is False
    assert fallback.volume_landmark == "MAV"
    assert fallback.exercises[0].exercise_name == "Bench Press"


def test_workout_caching_and_synthesize_endpoint(client, fakes: FakeAdapters, db: Session) -> None:
    _seed_upper_routine(db)
    fakes.muninn.json_responses.append(
        {
            "routine_name": "Upper Body A (Express 35m)",
            "readiness_adaptation": "Antagonistic supersets prescribed for time constraint.",
            "target_rir": "RIR 2",
            "volume_landmark": "MEV",
            "rationale": "Custom 35-minute duration handled via superset sequencing.",
            "exercises": [
                {
                    "exercise_name": "Dumbbell Bench Press",
                    "target_sets": 2,
                    "target_reps": "8-10 reps",
                    "suggested_weight_kg": 30.0,
                    "notes": "Superset immediately with Chest-Supported Row",
                }
            ],
            "recovery_status": "optimal",
            "research_citation": "Israetel & Helms",
        }
    )

    res = client.post(
        "/biometrics/workout-recommendation/synthesize",
        json={"target_date": "2026-11-06", "custom_context": "Only 35 minutes today"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["routine_name"] == "Upper Body A (Express 35m)"
    assert data["is_llm_generated"] is True
    assert len(fakes.muninn.synthesize_calls) == 1

    res_get = client.get("/biometrics/workout-recommendation?target_date=2026-11-06")
    assert res_get.status_code == 200
    cached_data = res_get.json()
    assert cached_data["routine_name"] == "Upper Body A (Express 35m)"
    assert cached_data["exercises"][0]["weight_basis"] == "per_hand"
    assert len(fakes.muninn.synthesize_calls) == 1


def test_dumbbell_weight_basis_inference_and_total_preservation() -> None:
    db_deadlift = ExerciseCreate(name="Deadlift (Dumbbell)", equipment="Dumbbell")
    assert db_deadlift.weight_basis == "per_hand"

    russian_twist = ExerciseCreate(
        name="Russian Twist (Weighted)",
        equipment="Dumbbell/Plate",
        weight_basis="total",
    )
    assert russian_twist.weight_basis == "total"

    rec_item = RecommendedExerciseItem(
        exercise_name="Deadlift (Dumbbell)",
        target_sets=2,
        target_reps="8-10 reps",
        suggested_weight_kg=22.0,
    )
    assert rec_item.weight_basis == "per_hand"
    assert infer_weight_basis_from_name("Deadlift (Dumbbell)", "total") == "per_hand"


def test_workout_query_helpers_against_postgres(db: Session, fakes: FakeAdapters) -> None:
    dl = Exercise(
        name="Deadlift (Dumbbell)",
        weight_basis="total",
        tracking="reps_weight",
        primary_muscles=["hamstrings", "glutes"],
    )
    routine = Routine(name="Pull Focus")
    routine.items.append(RoutineItem(exercise=dl, position=0, target_sets=3, target_reps=10))
    db.add_all([dl, routine])
    db.flush()

    sess = WorkoutSession(
        started_at=dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1)
    )
    db.add(sess)
    db.flush()
    item = SessionItem(session_id=sess.id, exercise_id=dl.id, position=0)
    db.add(item)
    db.flush()
    db.add(
        SetEntry(
            session_item_id=item.id,
            set_number=1,
            status="done",
            weight_kg=22.0,
            reps=10,
        )
    )
    db.commit()

    history = get_recent_lift_history(db, limit=5)
    dl_rows = [row for row in history if row["exercise_name"] == "Deadlift (Dumbbell)"]
    assert len(dl_rows) == 1
    assert dl_rows[0]["weight_basis"] == "per_hand"
    assert dl_rows[0]["weight_kg"] == 22.0

    assert any(ex["name"] == "Deadlift (Dumbbell)" for ex in get_active_exercises(db))
    assert any(rt["name"] == "Pull Focus" for rt in get_active_routines(db))
    vol = get_recent_muscle_volume(db, days=7)
    assert vol["hamstrings"] == 1
    assert vol["glutes"] == 1


def test_persist_workout_cache_handles_unique_conflict_and_fails_loud(db: Session) -> None:
    existing = WorkoutRecommendation(
        date="2026-11-10",
        routine_name="Old Routine",
        readiness_adaptation="Old",
        target_rir="RIR 2",
        volume_landmark="MAV",
        rationale="Initial",
        exercises=[],
        recovery_status="optimal",
        is_llm_generated=False,
        extra={},
    )
    db.add(existing)
    db.commit()

    updated_rec = WorkoutRecommendationRead(
        date="2026-11-10",
        routine_name="Updated Routine",
        readiness_adaptation="MEV",
        target_rir="RIR 3",
        volume_landmark="MEV",
        rationale="Concurrent race update",
        exercises=[],
        recovery_status="fatigued",
        is_llm_generated=True,
    )
    _persist_workout_cache(
        db,
        "2026-11-10",
        updated_rec,
        existing=None,
        extra_payload={"source": "llm"},
    )
    row = db.query(WorkoutRecommendation).filter_by(date="2026-11-10").one()
    assert row.routine_name == "Updated Routine"
    assert row.recovery_status == "fatigued"

    class _FailingSession:
        def __init__(self, exc: Exception) -> None:
            self._exc = exc
            self.rolled_back = False

        def add(self, _obj) -> None:
            return None

        def commit(self) -> None:
            raise self._exc

        def rollback(self) -> None:
            self.rolled_back = True

        def scalar(self, _stmt):
            return None

    failing = _FailingSession(OperationalError("SELECT 1", {}, Exception("db offline")))
    with pytest.raises(OperationalError):
        _persist_workout_cache(
            failing,  # type: ignore[arg-type]
            "2026-11-11",
            updated_rec,
            existing=None,
            extra_payload={"source": "llm"},
        )
    assert failing.rolled_back is True

    integrity_without_row = _FailingSession(
        IntegrityError("INSERT", {}, Exception("other constraint"))
    )
    with pytest.raises(IntegrityError):
        _persist_workout_cache(
            integrity_without_row,  # type: ignore[arg-type]
            "2026-11-12",
            updated_rec,
            existing=None,
            extra_payload={"source": "llm"},
        )
    assert integrity_without_row.rolled_back is True
