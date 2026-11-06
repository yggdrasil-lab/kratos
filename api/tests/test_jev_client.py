"""Unit tests for TypeSafe Jev System One client and integrations."""

import datetime as dt
import json
import unittest
from unittest.mock import MagicMock, patch
import urllib.error

from app.services.jev_client import (
    call_jev,
    classify_constraints_jev,
    classify_fasting_window_jev,
    classify_recovery_state_jev,
    classify_workout_decision_gates,
)
from app.services.workout_engine import generate_workout_recommendation


class TestJevClient(unittest.TestCase):
    @patch("urllib.request.urlopen")
    def test_call_jev_success(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.read.return_value = json.dumps({
            "choices": [{"message": {"content": "MAV_OVERLOAD"}}]
        }).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        verdict, latency = call_jev("Classify recovery", "Sleep: 8.5h")
        self.assertEqual(verdict, "MAV_OVERLOAD")
        self.assertGreaterEqual(latency, 0.0)

    @patch("urllib.request.urlopen")
    def test_call_jev_urllib_error_fallback(self, mock_urlopen):
        mock_urlopen.side_effect = urllib.error.URLError("Connection refused")
        verdict, latency = call_jev("Classify recovery", "Sleep: 8.5h")
        self.assertIsNone(verdict)

    @patch("app.services.jev_client.call_jev")
    def test_classify_recovery_state_jev(self, mock_call_jev):
        mock_call_jev.return_value = ("MEV_DELOAD", 0.02)
        biometrics = {"sleep_duration_hours": 5.2, "hrv_ms": 28.0}
        result = classify_recovery_state_jev(biometrics)
        self.assertEqual(result, "MEV_DELOAD")

    @patch("app.services.jev_client.call_jev")
    def test_classify_constraints_jev(self, mock_call_jev):
        # 1st call for joint, 2nd call for time
        mock_call_jev.side_effect = [
            ("SHOULDER_SPARING", 0.02),
            ("TIME_CRUNCH_30M", 0.02),
        ]
        result = classify_constraints_jev("Left shoulder is pinching, only have 35 mins")
        self.assertEqual(result["joint_focus"], "SHOULDER_SPARING")
        self.assertEqual(result["time_budget"], "TIME_CRUNCH_30M")

    @patch("app.services.jev_client.call_jev")
    def test_classify_fasting_window_jev(self, mock_call_jev):
        mock_call_jev.return_value = ("EVENING_SPORT_16_8", 0.02)
        result = classify_fasting_window_jev("Badminton Match Play", {"sleep_duration_hours": 7.5})
        self.assertEqual(result, "EVENING_SPORT_16_8")

    @patch("app.services.workout_engine.classify_recovery_state_jev")
    def test_workout_engine_integration_with_jev(self, mock_jev):
        mock_jev.return_value = "MEV_DELOAD"
        target_d = dt.date(2026, 11, 2)  # Monday
        biometrics = {"sleep_duration_hours": 7.0, "hrv_ms": 50.0}

        rec = generate_workout_recommendation(target_d, None, biometrics)
        self.assertEqual(rec.recovery_status, "fatigued")
        self.assertEqual(rec.volume_landmark, "MEV")
        self.assertEqual(rec.target_rir, "RIR 3-4")
        for ex in rec.exercises:
            self.assertEqual(ex.target_sets, 2)

    @patch("app.services.jev_client.call_jev")
    def test_classify_recovery_state_jev_string_biometrics(self, mock_call_jev):
        mock_call_jev.return_value = ("MAV_OVERLOAD", 0.015)
        # Verify strings from PostgreSQL / Eir do not raise ValueError in string formatting
        biometrics = {
            "sleep_duration_hours": "7.8",
            "sleep_deep_hours": "1.9",
            "hrv_ms": "50.26",
            "resting_hr_bpm": "56"
        }
        result = classify_recovery_state_jev(biometrics)
        self.assertEqual(result, "MAV_OVERLOAD")
        # Ensure call_jev received properly formatted user_prompt with floats
        user_prompt = mock_call_jev.call_args[0][1]
        self.assertIn("Sleep: 7.8h", user_prompt)
        self.assertIn("HRV: 50.3ms", user_prompt)
        self.assertIn("Resting HR: 56bpm", user_prompt)

    @patch("app.services.jev_client.call_jev")
    def test_classify_workout_decision_gates_batched(self, mock_call_jev):
        mock_call_jev.return_value = (
            json.dumps({
                "recovery_tier": "MAV_OVERLOAD",
                "joint_focus": "SHOULDER_SPARING",
                "time_budget": "TIME_CRUNCH_30M",
            }),
            0.025,
        )
        biometrics = {"sleep_duration_hours": 8.0, "hrv_ms": 52.0}
        user_notes = "Shoulder is slightly tender, need a quick 30 min session"
        gates = classify_workout_decision_gates(biometrics, user_notes)
        self.assertEqual(mock_call_jev.call_count, 1)
        self.assertEqual(gates["recovery_tier"], "MAV_OVERLOAD")
        self.assertEqual(gates["joint_focus"], "SHOULDER_SPARING")
        self.assertEqual(gates["time_budget"], "TIME_CRUNCH_30M")
