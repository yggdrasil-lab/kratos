"""Unit tests for Discord thread creation, two-way adjustments, and recommendation MCP tools."""

from __future__ import annotations

import datetime as dt
import json
import unittest
from unittest.mock import MagicMock, patch
import urllib.error

from app.models import FastingRecommendation, WorkoutRecommendation
from app.routers.biometrics import (
    trigger_fasting_synthesis,
    trigger_workout_synthesis,
)
from app.routers.mcp import build_mcp_server
from app.schemas import (
    FastingRecommendationRead,
    FastingSynthesizeRequest,
    RecommendedExerciseItem,
    WorkoutRecommendationRead,
    WorkoutSynthesizeRequest,
)
from app.services.discord import (
    post_fasting_recommendation_thread,
    post_thread_adjustment_reply,
    post_workout_recommendation_thread,
)


class TestDiscordService(unittest.TestCase):
    @patch("urllib.request.urlopen")
    def test_post_fasting_recommendation_thread_bot_token(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.read.return_value = json.dumps({"id": "1122334455"}).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        rec = FastingRecommendationRead(
            date="2026-11-06",
            protocol_name="16:8 Circadian Leangains",
            target_window="12:00 - 20:00",
            window_hours="16:8",
            rationale="Optimal circadian alignment and recovery",
            fueling_anchors=["12:00 PM Break fast", "19:30 PM Final meal"],
            recovery_status="optimal",
            activity_context="Upper body hyper-trophy",
            is_llm_generated=True,
            research_citation="Panda Lab (2021)",
        )

        with patch("app.config.settings.discord_bot_token", "test-bot-token"):
            thread_id = post_fasting_recommendation_thread(
                rec=rec,
                target_date="2026-11-06",
                channel_id="99887766",
                user_id="12345",
            )

        self.assertEqual(thread_id, "1122334455")
        req = mock_urlopen.call_args[0][0]
        self.assertIn("https://discord.com/api/v10/channels/99887766/threads", req.full_url)
        self.assertEqual(req.headers.get("User-agent"), "Yggdrasil-Kratos/1.0 (DiscordBot)")
        payload = json.loads(req.data.decode("utf-8"))
        self.assertIn("🌿 Fasting Protocol", payload["name"])
        self.assertIn("<@12345>", payload["message"]["content"])
        self.assertIn("Two-Way Adjustment Loop", payload["message"]["content"])

    @patch("urllib.request.urlopen")
    def test_post_fasting_recommendation_thread_webhook(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.read.return_value = json.dumps({"channel_id": "55667788"}).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        rec = FastingRecommendationRead(
            date="2026-11-06",
            protocol_name="14:10 Circadian Maintenance",
            target_window="10:00 - 20:00",
            window_hours="14:10",
            rationale="Moderate stress adaptation",
            fueling_anchors=[],
            recovery_status="moderate",
            activity_context="Recovery day",
            is_llm_generated=False,
        )

        with patch("app.config.settings.discord_bot_token", None):
            thread_id = post_fasting_recommendation_thread(
                rec=rec,
                target_date="2026-11-06",
                webhook_url="https://discord.com/api/webhooks/mock/test",
            )

        self.assertEqual(thread_id, "55667788")
        req = mock_urlopen.call_args[0][0]
        self.assertIn("wait=true", req.full_url)
        payload = json.loads(req.data.decode("utf-8"))
        self.assertIn("thread_name", payload)

    @patch("urllib.request.urlopen")
    def test_post_workout_recommendation_thread_bot_token(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.read.return_value = json.dumps({"id": "99112233"}).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        rec = WorkoutRecommendationRead(
            date="2026-11-06",
            routine_name="Upper Body A",
            readiness_adaptation="Full Volume Overload",
            target_rir="RIR 1-2",
            volume_landmark="MAV",
            rationale="High HRV and restorative sleep",
            exercises=[
                RecommendedExerciseItem(
                    exercise_name="Incline Dumbbell Press",
                    target_sets=2,
                    target_reps="8-10 reps",
                    suggested_weight_kg=32.0,
                    notes="RIR 1 on final set",
                )
            ],
            recovery_status="optimal",
            research_citation="Israetel (2020) RP Volume Landmarks",
            is_llm_generated=True,
        )

        with patch("app.config.settings.discord_bot_token", "test-bot-token"):
            thread_id = post_workout_recommendation_thread(
                rec=rec,
                target_date="2026-11-06",
                channel_id="99887766",
                user_id="12345",
            )

        self.assertEqual(thread_id, "99112233")
        req = mock_urlopen.call_args[0][0]
        payload = json.loads(req.data.decode("utf-8"))
        self.assertIn("⚡ Workout: Upper Body A", payload["name"])
        self.assertIn("Incline Dumbbell Press", payload["message"]["content"])
        self.assertIn("32.0kg", payload["message"]["content"])

    @patch("urllib.request.urlopen")
    def test_post_thread_adjustment_reply(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        with patch("app.config.settings.discord_bot_token", "test-bot-token"):
            success = post_thread_adjustment_reply(
                thread_id="11223344",
                title="14:10 Fasting Window",
                summary="Shifted feeding window 10:00 - 20:00",
                details="Adjusted due to early morning meeting",
            )

        self.assertTrue(success)
        req = mock_urlopen.call_args[0][0]
        self.assertIn("channels/11223344/messages", req.full_url)
        payload = json.loads(req.data.decode("utf-8"))
        self.assertIn("Recommendation Adjusted: 14:10 Fasting Window", payload["content"])

    def test_discord_disabled_returns_none(self):
        rec = FastingRecommendationRead(
            date="2026-11-06",
            protocol_name="16:8",
            target_window="12:00 - 20:00",
            window_hours="16:8",
            rationale="Test",
            recovery_status="optimal",
            activity_context="Rest",
        )
        with patch("app.config.settings.discord_health_channel_id", None), patch(
            "app.config.settings.discord_webhook_url", None
        ):
            thread_id = post_fasting_recommendation_thread(rec, "2026-11-06")
            self.assertIsNone(thread_id)

    @patch("urllib.request.urlopen")
    def test_discord_http_error_fail_safe(self, mock_urlopen):
        mock_urlopen.side_effect = urllib.error.URLError("Connection refused")
        rec = FastingRecommendationRead(
            date="2026-11-06",
            protocol_name="16:8",
            target_window="12:00 - 20:00",
            window_hours="16:8",
            rationale="Test",
            recovery_status="optimal",
            activity_context="Rest",
        )
        with patch("app.config.settings.discord_bot_token", "test-token"):
            thread_id = post_fasting_recommendation_thread(
                rec, "2026-11-06", channel_id="12345"
            )
            self.assertIsNone(thread_id)


class TestRecommendationSynthesisDiscordPersistence(unittest.TestCase):
    @patch("app.routers.biometrics.post_fasting_recommendation_thread")
    @patch("app.routers.biometrics.synthesize_fasting_recommendation_llm")
    def test_trigger_fasting_synthesis_creates_thread_and_persists_extra(
        self, mock_synthesize, mock_post_thread
    ):
        mock_synthesize.return_value = FastingRecommendationRead(
            date="2026-11-06",
            protocol_name="16:8 Circadian Leangains",
            target_window="12:00 - 20:00",
            window_hours="16:8",
            rationale="Circadian rationale",
            fueling_anchors=["12:00 PM Break fast"],
            recovery_status="optimal",
            activity_context="Upper A",
            is_llm_generated=True,
        )
        mock_post_thread.return_value = "thread_rec_123"

        mock_db = MagicMock()
        mock_db.scalar.return_value = None  # No existing recommendation

        payload = FastingSynthesizeRequest(target_date="2026-11-06")
        res = trigger_fasting_synthesis(payload=payload, db=mock_db)

        self.assertEqual(res.extra.get("discord_thread_id"), "thread_rec_123")
        self.assertEqual(mock_db.add.call_count, 1)
        added_record = mock_db.add.call_args[0][0]
        self.assertEqual(added_record.extra.get("discord_thread_id"), "thread_rec_123")

    @patch("app.routers.biometrics.post_thread_adjustment_reply")
    @patch("app.routers.biometrics.synthesize_fasting_recommendation_llm")
    def test_trigger_fasting_synthesis_adjusts_existing_thread(
        self, mock_synthesize, mock_post_reply
    ):
        mock_synthesize.return_value = FastingRecommendationRead(
            date="2026-11-06",
            protocol_name="14:10 Adjusted",
            target_window="10:00 - 20:00",
            window_hours="14:10",
            rationale="Adjusted for meeting",
            fueling_anchors=[],
            recovery_status="moderate",
            activity_context="Rest",
            is_llm_generated=True,
        )

        mock_existing = MagicMock(spec=FastingRecommendation)
        mock_existing.extra = {"source": "llm", "discord_thread_id": "thread_rec_existing_999"}

        mock_db = MagicMock()
        # First call is for weekly plan (None), second call is for existing recommendation
        mock_db.scalar.side_effect = [None, mock_existing]

        payload = FastingSynthesizeRequest(
            target_date="2026-11-06", custom_context="Shorten fast to 14h"
        )
        res = trigger_fasting_synthesis(payload=payload, db=mock_db)

        self.assertEqual(res.extra.get("discord_thread_id"), "thread_rec_existing_999")
        self.assertEqual(res.extra.get("last_adjustment"), "Shorten fast to 14h")
        mock_post_reply.assert_called_once()
        self.assertEqual(mock_post_reply.call_args[1]["thread_id"], "thread_rec_existing_999")


class TestMcpTools(unittest.TestCase):
    def setUp(self):
        self.server = build_mcp_server()

    def test_mcp_server_registers_all_new_recommendation_tools(self):
        tool_names = [tool.name for tool in self.server._tool_manager.list_tools()]
        self.assertIn("fasting_recommendation_get", tool_names)
        self.assertIn("fasting_recommendation_adjust", tool_names)
        self.assertIn("workout_recommendation_get", tool_names)
        self.assertIn("workout_recommendation_adjust", tool_names)


if __name__ == "__main__":
    unittest.main()
