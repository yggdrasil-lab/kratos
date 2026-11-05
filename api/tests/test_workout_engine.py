"""Unit tests for the smart autoregulated workout recommendation engine."""

import datetime as dt
import json
import unittest
from unittest.mock import MagicMock, patch
import urllib.error

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import app
from app.models import WeeklyPlan, WorkoutRecommendation
from app.services.llm_workout import synthesize_workout_recommendation_llm
from app.services.workout_engine import generate_workout_recommendation


class TestWorkoutEngine(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        WeeklyPlan.__table__.create(bind=self.engine)
        WorkoutRecommendation.__table__.create(bind=self.engine)
        self.SessionLocal = sessionmaker(bind=self.engine, autoflush=False, expire_on_commit=False)
        self.db = self.SessionLocal()

        def override_get_db():
            session = self.SessionLocal()
            try:
                yield session
            finally:
                session.close()

        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app)

    def tearDown(self):
        self.db.close()
        WorkoutRecommendation.__table__.drop(bind=self.engine)
        WeeklyPlan.__table__.drop(bind=self.engine)
        app.dependency_overrides.clear()

    def test_workout_engine_fatigued_state(self):
        target_d = dt.date(2026, 11, 2)  # Monday
        plan = WeeklyPlan(
            iso_week="2026-W45",
            days=[{"day": "Mon", "activity": "Upper Body A", "type": "lift"}],
        )
        biometrics = {
            "sleep_duration_hours": 5.1,
            "hrv_ms": 28.0,
        }
        rec = generate_workout_recommendation(target_d, plan, biometrics)
        self.assertEqual(rec.recovery_status, "fatigued")
        self.assertEqual(rec.volume_landmark, "MEV")
        self.assertIn("RIR 3-4", rec.target_rir)
        self.assertGreaterEqual(len(rec.exercises), 1)

    def test_workout_engine_sport_day(self):
        target_d = dt.date(2026, 11, 3)  # Tuesday
        plan = WeeklyPlan(
            iso_week="2026-W45",
            days=[{"day": "Tue", "activity": "Badminton Focus", "type": "sport"}],
        )
        rec = generate_workout_recommendation(target_d, plan, None)
        self.assertIn("Badminton", rec.routine_name)
        self.assertIn("mobility", rec.readiness_adaptation.lower())

    def test_workout_engine_optimal_state(self):
        target_d = dt.date(2026, 11, 2)  # Monday
        plan = WeeklyPlan(
            iso_week="2026-W45",
            days=[{"day": "Mon", "activity": "Upper Body A", "type": "lift"}],
        )
        biometrics = {
            "sleep_duration_hours": 8.0,
            "hrv_ms": 55.0,
        }
        rec = generate_workout_recommendation(target_d, plan, biometrics)
        self.assertEqual(rec.recovery_status, "optimal")
        self.assertEqual(rec.volume_landmark, "MAV")
        self.assertIn("RIR 1", rec.target_rir)

    @patch("urllib.request.urlopen")
    def test_workout_llm_synthesis_success(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.status = 200
        llm_payload = {
            "choices": [
                {
                    "message": {
                        "content": json.dumps({
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
                                    "notes": "Neutral grip to eliminate rotator cuff impingement."
                                }
                            ],
                            "recovery_status": "fatigued",
                            "research_citation": "McGill (Joint Sparing) & Israetel (Volume Landmarks)",
                        })
                    }
                }
            ]
        }
        mock_response.read.return_value = json.dumps(llm_payload).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_response

        rec = synthesize_workout_recommendation_llm(
            target_date=dt.date(2026, 11, 2),
            weekly_plan=None,
            biometrics={"hrv_ms": 32.0, "sleep_duration_hours": 6.0},
            custom_context="Left shoulder pinching",
        )
        self.assertTrue(rec.is_llm_generated)
        self.assertEqual(rec.routine_name, "Upper Body A (Joint Sparing)")
        self.assertEqual(rec.exercises[0].exercise_name, "Neutral-Grip Dumbbell Bench Press")

    @patch("urllib.request.urlopen")
    def test_workout_llm_synthesis_fallback(self, mock_urlopen):
        mock_urlopen.side_effect = urllib.error.URLError("Connection refused")

        rec = synthesize_workout_recommendation_llm(
            target_date=dt.date(2026, 11, 2),  # Monday (Lift day)
            weekly_plan=None,
            biometrics={"hrv_ms": 50.0, "sleep_duration_hours": 8.0},
        )
        self.assertFalse(rec.is_llm_generated)
        self.assertEqual(rec.volume_landmark, "MAV")

    @patch("urllib.request.urlopen")
    def test_workout_caching_and_synthesize_endpoint(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.status = 200
        llm_payload = {
            "choices": [
                {
                    "message": {
                        "content": json.dumps({
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
                                    "notes": "Superset immediately with Chest-Supported Row"
                                }
                            ],
                            "recovery_status": "optimal",
                            "research_citation": "Israetel & Helms",
                        })
                    }
                }
            ]
        }
        mock_response.read.return_value = json.dumps(llm_payload).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_response

        # Call POST synthesize
        res = self.client.post(
            "/biometrics/workout-recommendation/synthesize",
            json={"target_date": "2026-11-06", "custom_context": "Only 35 minutes today"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["routine_name"], "Upper Body A (Express 35m)")
        self.assertTrue(data["is_llm_generated"])

        # Subsequent GET should return cached row
        mock_urlopen.reset_mock()
        res_get = self.client.get("/biometrics/workout-recommendation?target_date=2026-11-06")
        self.assertEqual(res_get.status_code, 200)
        cached_data = res_get.json()
        self.assertEqual(cached_data["routine_name"], "Upper Body A (Express 35m)")
        self.assertEqual(mock_urlopen.call_count, 0)


if __name__ == "__main__":
    unittest.main()
