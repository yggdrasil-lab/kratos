"""Unit tests for the smart autoregulated fasting recommendation engine."""

import datetime as dt
import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import app
from app.models import WeeklyPlan
from app.services.fasting_engine import generate_fasting_recommendation


class TestFastingRecommendation(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        WeeklyPlan.__table__.create(bind=self.engine)
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
        WeeklyPlan.__table__.drop(bind=self.engine)
        app.dependency_overrides.clear()

    def test_fasting_engine_fatigue_override(self):
        # Thursday with severe fatigue
        target_d = dt.date(2026, 11, 5)  # Thursday
        plan = WeeklyPlan(
            iso_week="2026-W45",
            days=[{"dayIndex": 3, "sessionName": "Badminton Match Play", "type": "sport"}],
        )
        biometrics = {
            "sleep_duration_hours": 5.2,
            "sleep_deep_hours": 0.4,
            "hrv_ms": 22.0,
            "resting_hr_bpm": 80,
        }
        rec = generate_fasting_recommendation(target_d, plan, biometrics)
        self.assertEqual(rec.target_window, "14:10")
        self.assertIn("Autoregulated Recovery Split", rec.protocol_name)
        self.assertEqual(rec.recovery_status, "fatigued")
        self.assertIn("High fatigue detected", rec.rationale)

    def test_fasting_engine_badminton_fueling(self):
        # Tuesday with optimal recovery and Badminton
        target_d = dt.date(2026, 11, 3)  # Tuesday
        plan = WeeklyPlan(
            iso_week="2026-W45",
            days=[{"dayIndex": 1, "sessionName": "Badminton Focus", "type": "sport"}],
        )
        biometrics = {
            "sleep_duration_hours": 7.5,
            "sleep_deep_hours": 1.2,
            "hrv_ms": 55.0,
            "resting_hr_bpm": 62,
        }
        rec = generate_fasting_recommendation(target_d, plan, biometrics)
        self.assertEqual(rec.target_window, "16:8")
        self.assertIn("Badminton Court Fueling", rec.protocol_name)
        self.assertEqual(rec.recovery_status, "optimal")
        self.assertTrue(any("Pre-court fuel" in a for a in rec.fueling_anchors))

    def test_fasting_engine_lifting_split(self):
        # Wednesday with lifting
        target_d = dt.date(2026, 11, 4)  # Wednesday
        plan = WeeklyPlan(
            iso_week="2026-W45",
            days=[{"dayIndex": 2, "sessionName": "Lower Body A", "type": "lift"}],
        )
        biometrics = {
            "sleep_duration_hours": 7.0,
            "sleep_deep_hours": 0.9,
            "hrv_ms": 48.0,
        }
        rec = generate_fasting_recommendation(target_d, plan, biometrics)
        self.assertEqual(rec.target_window, "16:8")
        self.assertIn("Strength and Hypertrophy Split", rec.protocol_name)
        self.assertTrue(any("Break fast with 45g protein" in a for a in rec.fueling_anchors))

    def test_fasting_engine_rest_metabolic_reset(self):
        # Friday rest day with optimal recovery
        target_d = dt.date(2026, 11, 6)  # Friday
        plan = WeeklyPlan(
            iso_week="2026-W45",
            days=[{"dayIndex": 4, "sessionName": "Rest and Reset", "type": "rest"}],
        )
        biometrics = {
            "sleep_duration_hours": 8.0,
            "sleep_deep_hours": 1.5,
            "hrv_ms": 60.0,
        }
        rec = generate_fasting_recommendation(target_d, plan, biometrics)
        self.assertEqual(rec.target_window, "18:6")
        self.assertIn("Deep Metabolic Reset", rec.protocol_name)
        self.assertIn("3:30 PM - 8:30 PM", rec.window_hours)

    def test_fasting_engine_weekend_baseline(self):
        # Sunday with optimal recovery
        target_d = dt.date(2026, 11, 8)  # Sunday
        rec = generate_fasting_recommendation(target_d, None, None)
        self.assertEqual(rec.target_window, "14:10")
        self.assertIn("Social Baseline", rec.protocol_name)

    def test_fasting_recommendation_api(self):
        res = self.client.get("/biometrics/fasting-recommendation?target_date=2026-11-06")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["date"], "2026-11-06")
        self.assertIn("target_window", data)
        self.assertIn("protocol_name", data)
        self.assertIn("window_hours", data)
        self.assertIn("rationale", data)
        self.assertGreaterEqual(len(data["fueling_anchors"]), 2)


if __name__ == "__main__":
    unittest.main()
