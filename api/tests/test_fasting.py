"""Unit tests for the smart autoregulated fasting recommendation engine."""

import datetime as dt
import io
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
from app.models import FastingRecommendation, Routine, WeeklyPlan
from app.services.fasting_engine import generate_fasting_recommendation
from app.services.llm_fasting import synthesize_fasting_recommendation_llm


class TestFastingRecommendation(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        WeeklyPlan.__table__.create(bind=self.engine)
        Routine.__table__.create(bind=self.engine)
        FastingRecommendation.__table__.create(bind=self.engine)
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
        FastingRecommendation.__table__.drop(bind=self.engine)
        Routine.__table__.drop(bind=self.engine)
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

    @patch("urllib.request.urlopen")
    def test_llm_synthesis_success(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.status = 200
        llm_payload = {
            "choices": [
                {
                    "message": {
                        "content": json.dumps({
                            "protocol_name": "16:8 Pre-Court Fueling",
                            "target_window": "16:8",
                            "window_hours": "12:30 PM - 8:30 PM",
                            "rationale": "High-intensity badminton scheduled. Window shifted to allow sustained pre-court glycogen.",
                            "fueling_anchors": [
                                "12:30 PM: Lunch with 40g protein and complex carbs",
                                "05:00 PM: Pre-court fuel (banana + electrolyte drink)",
                                "08:30 PM: Post-court protein shake"
                            ],
                            "recovery_status": "optimal",
                            "activity_context": "Badminton Match Play (sport)",
                            "research_citation": "Panda Lab (Circadian TRE) & Schoenfeld (MPS Distribution)",
                        })
                    }
                }
            ]
        }
        mock_response.read.return_value = json.dumps(llm_payload).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_response

        rec = synthesize_fasting_recommendation_llm(
            target_date=dt.date(2026, 11, 5),
            weekly_plan=None,
            biometrics={"hrv_ms": 55.0, "sleep_duration_hours": 7.8},
        )
        self.assertTrue(rec.is_llm_generated)
        self.assertEqual(rec.target_window, "16:8")
        self.assertEqual(rec.protocol_name, "16:8 Pre-Court Fueling")
        self.assertEqual(rec.research_citation, "Panda Lab (Circadian TRE) & Schoenfeld (MPS Distribution)")

    @patch("urllib.request.urlopen")
    def test_llm_synthesis_fallback(self, mock_urlopen):
        mock_urlopen.side_effect = urllib.error.URLError("Connection refused")

        rec = synthesize_fasting_recommendation_llm(
            target_date=dt.date(2026, 11, 6),  # Friday
            weekly_plan=None,
            biometrics={"hrv_ms": 50.0, "sleep_duration_hours": 8.0},
        )
        self.assertFalse(rec.is_llm_generated)
        self.assertEqual(rec.target_window, "18:6")
        self.assertIn("Deep Metabolic Reset", rec.protocol_name)

    @patch("urllib.request.urlopen")
    def test_fasting_caching_and_synthesize_endpoint(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.status = 200
        llm_payload = {
            "choices": [
                {
                    "message": {
                        "content": json.dumps({
                            "protocol_name": "14:10 Shifted Schedule Protocol",
                            "target_window": "14:10",
                            "window_hours": "11:00 AM - 9:00 PM",
                            "rationale": "Custom user schedule adjustment incorporated with 3h pre-bed cutoff.",
                            "fueling_anchors": ["11:00 AM: Meal 1", "04:00 PM: Meal 2", "08:30 PM: Recovery"],
                            "recovery_status": "optimal",
                            "activity_context": "Custom Split",
                            "research_citation": "Circadian Daylight Alignment",
                        })
                    }
                }
            ]
        }
        mock_response.read.return_value = json.dumps(llm_payload).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_response

        # Call synthesize POST
        res = self.client.post(
            "/biometrics/fasting-recommendation/synthesize",
            json={"target_date": "2026-11-06", "custom_context": "Shift workout to 11am"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["protocol_name"], "14:10 Shifted Schedule Protocol")
        self.assertTrue(data["is_llm_generated"])

        # Subsequent GET should return cached row without re-calling synthesis
        mock_urlopen.reset_mock()
        res_get = self.client.get("/biometrics/fasting-recommendation?target_date=2026-11-06")
        self.assertEqual(res_get.status_code, 200)
        cached_data = res_get.json()
        self.assertEqual(cached_data["protocol_name"], "14:10 Shifted Schedule Protocol")
        # Urlopen was not called for synthesis because DB cache hit
        self.assertEqual(mock_urlopen.call_count, 0)


if __name__ == "__main__":
    unittest.main()
