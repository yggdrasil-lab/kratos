"""Pytest tests for Discord formatting, best-effort #health thread sync, and recommendation MCP tools."""

from __future__ import annotations

import json
import logging

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.autoregulation.coordinator import AutoregulationCore
from app.autoregulation.discord_formatter import (
    format_fasting_thread,
    format_workout_thread,
    sync_fasting_discord_thread,
    sync_workout_discord_thread,
)
from app.config import Settings
from app.models import FastingRecommendation, WorkoutRecommendation
from app.schemas import (
    FastingRecommendationRead,
    FastingSynthesizeRequest,
    RecommendedExerciseItem,
    WorkoutRecommendationRead,
    WorkoutSynthesizeRequest,
)
from tests.conftest import FakeAdapters
from tests.fakes import FakeClock, InMemoryDiscordAdapter, InMemoryEirAdapter, InMemoryMuninnAdapter


def _rpc(client: TestClient, method: str, params: dict | None = None) -> dict:
    body: dict = {"jsonrpc": "2.0", "id": 1, "method": method}
    if params is not None:
        body["params"] = params
    response = client.post(
        "/mcp",
        json=body,
        headers={
            "Accept": "application/json, text/event-stream",
            "Content-Type": "application/json",
            "Authorization": "Bearer test-token",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_format_fasting_and_workout_threads() -> None:
    fasting_rec = FastingRecommendationRead(
        date="2026-11-06",
        protocol_name="14:10 Strength and Hypertrophy Split",
        target_window="14:10",
        window_hours="10:30 AM - 8:30 PM",
        rationale="Optimal circadian alignment and recovery",
        fueling_anchors=["Morning: Clean fast until 10:30 AM", "Dinner by 8:30 PM"],
        recovery_status="optimal",
        activity_context="Upper Body A (lift)",
        is_llm_generated=True,
        research_citation="Panda Lab (2021)",
    )
    f_title, f_content = format_fasting_thread(fasting_rec, "2026-11-06", user_id="1001")
    assert "🌿 Fasting Protocol: 14:10 (2026-11-06)" in f_title
    assert "<@1001>" in f_content
    assert "Two-Way Adjustment Loop" in f_content

    workout_rec = WorkoutRecommendationRead(
        date="2026-11-06",
        routine_name="Upper & Lower Mix",
        readiness_adaptation="Moderate stress adaptation",
        target_rir="RIR 2",
        volume_landmark="MAV",
        rationale="Balanced session",
        exercises=[
            RecommendedExerciseItem(
                exercise_name="Dumbbell Bench Press",
                target_sets=2,
                target_reps="8-10 reps",
                suggested_weight_kg=15.0,
                weight_basis="per_hand",
            ),
            RecommendedExerciseItem(
                exercise_name="Barbell Back Squat",
                target_sets=2,
                target_reps="6-8 reps",
                suggested_weight_kg=100.0,
                weight_basis="total",
            ),
        ],
        recovery_status="moderate",
        is_llm_generated=False,
    )
    w_title, w_content = format_workout_thread(workout_rec, "2026-11-06", user_id="1001")
    assert "⚡ Workout: Upper & Lower Mix - MAV (2026-11-06)" in w_title
    assert "15.0kg/hand (15.0kg per dumbbell)" in w_content
    assert "**Barbell Back Squat**: 2 sets x 6-8 reps @ 100.0kg" in w_content


def test_sync_discord_threads_creates_reuses_and_warns_best_effort(
    caplog, monkeypatch
) -> None:
    discord_logger = logging.getLogger("app.autoregulation.discord_formatter")
    monkeypatch.setattr(discord_logger, "disabled", False)
    discord = InMemoryDiscordAdapter(user_id="1001")
    fasting_rec = FastingRecommendationRead(
        date="2026-11-06",
        protocol_name="14:10 Baseline",
        target_window="14:10",
        window_hours="10:30 AM - 8:30 PM",
        rationale="Nominal day",
        recovery_status="optimal",
        activity_context="Lift",
    )
    thread_id = sync_fasting_discord_thread(discord, fasting_rec, "2026-11-06", None, None)
    assert thread_id == "fake-thread-1"
    assert len(discord.created_threads) == 1

    existing = FastingRecommendation(
        date="2026-11-06",
        protocol_name="14:10 Baseline",
        target_window="14:10",
        window_hours="10:30 AM - 8:30 PM",
        rationale="Nominal day",
        fueling_anchors=[],
        recovery_status="optimal",
        activity_context="Lift",
        extra={"discord_thread_id": thread_id},
    )
    reused_id = sync_fasting_discord_thread(
        discord, fasting_rec, "2026-11-06", existing, "Shift dinner to 8pm"
    )
    assert reused_id == thread_id
    assert len(discord.replies) == 1
    assert "Recommendation Adjusted" in discord.replies[0]["content"]
    assert "Shift dinner to 8pm" in discord.replies[0]["content"]

    broken_discord = InMemoryDiscordAdapter(
        raise_on_create=RuntimeError("discord timeout"),
        raise_on_reply=RuntimeError("discord reply timeout"),
    )
    with caplog.at_level(logging.WARNING):
        assert sync_fasting_discord_thread(broken_discord, fasting_rec, "2026-11-07", None, None) is None
        workout_rec = WorkoutRecommendationRead(
            date="2026-11-07",
            routine_name="Upper A",
            readiness_adaptation="MAV",
            target_rir="RIR 1",
            volume_landmark="MAV",
            rationale="Ready",
            recovery_status="optimal",
        )
        existing_workout = WorkoutRecommendation(
            date="2026-11-07",
            routine_name="Upper A",
            readiness_adaptation="MAV",
            target_rir="RIR 1",
            volume_landmark="MAV",
            rationale="Ready",
            exercises=[],
            recovery_status="optimal",
            extra={"discord_thread_id": "thread-99"},
        )
        assert (
            sync_workout_discord_thread(
                broken_discord, workout_rec, "2026-11-07", existing_workout, "Swap squat"
            )
            == "thread-99"
        )
    assert "Failed creating Discord thread" in caplog.text
    assert "Failed posting workout adjustment" in caplog.text


def test_coordinator_persists_thread_id_and_adjustment_history(db: Session) -> None:
    muninn = InMemoryMuninnAdapter(
        json_responses=[
            {
                "protocol_name": "14:10 Protocol",
                "target_window": "14:10",
                "window_hours": "10:30 AM - 8:30 PM",
                "rationale": "Initial rationale",
                "fueling_anchors": ["Morning: Clean fast"],
                "recovery_status": "optimal",
                "activity_context": "Upper A",
            },
            {
                "protocol_name": "14:10 Adjusted",
                "target_window": "14:10",
                "window_hours": "11:00 AM - 9:00 PM",
                "rationale": "Adjusted for meeting",
                "fueling_anchors": ["Morning: Clean fast"],
                "recovery_status": "moderate",
                "activity_context": "Rest",
            },
            {
                "routine_name": "Upper A",
                "readiness_adaptation": "MAV",
                "target_rir": "RIR 1",
                "volume_landmark": "MAV",
                "rationale": "Initial lift",
                "exercises": [],
                "recovery_status": "optimal",
            },
            {
                "routine_name": "Upper A (Express)",
                "readiness_adaptation": "Express 30m",
                "target_rir": "RIR 2",
                "volume_landmark": "MEV",
                "rationale": "Adjusted for 30m limit",
                "exercises": [],
                "recovery_status": "moderate",
            },
        ]
    )
    discord = InMemoryDiscordAdapter()
    core = AutoregulationCore(
        clock=FakeClock(),
        eir=InMemoryEirAdapter(),
        muninn=muninn,
        discord=discord,
    )

    first_fasting = core.synthesize_fasting_recommendation(
        db, FastingSynthesizeRequest(target_date="2026-11-06"), source="llm"
    )
    thread_id = first_fasting.extra.get("discord_thread_id")
    assert thread_id == "fake-thread-1"

    adjusted_fasting = core.synthesize_fasting_recommendation(
        db,
        FastingSynthesizeRequest(
            target_date="2026-11-06", custom_context="Shift window 30m later"
        ),
        source="agent",
    )
    assert adjusted_fasting.extra["discord_thread_id"] == thread_id
    assert adjusted_fasting.extra["last_adjustment"] == "Shift window 30m later"
    assert adjusted_fasting.extra["source"] == "agent"

    first_workout = core.synthesize_workout_recommendation(
        db, WorkoutSynthesizeRequest(target_date="2026-11-06"), source="llm"
    )
    w_thread = first_workout.extra.get("discord_thread_id")
    assert w_thread == "fake-thread-2"
    adjusted_workout = core.synthesize_workout_recommendation(
        db,
        WorkoutSynthesizeRequest(target_date="2026-11-06", custom_context="Only 30m"),
        source="agent",
    )
    assert adjusted_workout.extra["discord_thread_id"] == w_thread
    assert adjusted_workout.extra["last_adjustment"] == "Only 30m"
    assert len(discord.replies) == 2


def test_mcp_recommendation_tools_round_trip_over_json_rpc(
    app_factory, fakes: FakeAdapters, db: Session
) -> None:
    fakes.muninn.json_responses.extend(
        [
            {
                "protocol_name": "14:10 Court Fueling",
                "target_window": "14:10",
                "window_hours": "10:30 AM - 8:30 PM",
                "rationale": "Initial fasting rec",
                "fueling_anchors": ["Morning: Clean fast"],
                "recovery_status": "optimal",
                "activity_context": "Badminton",
            },
            {
                "protocol_name": "14:10 Dinner Shift",
                "target_window": "14:10",
                "window_hours": "11:00 AM - 9:00 PM",
                "rationale": "Shifted for dinner",
                "fueling_anchors": ["Morning: Clean fast"],
                "recovery_status": "optimal",
                "activity_context": "Badminton",
            },
            {
                "routine_name": "Upper Body A",
                "readiness_adaptation": "Full MAV",
                "target_rir": "RIR 1",
                "volume_landmark": "MAV",
                "rationale": "High readiness",
                "exercises": [],
                "recovery_status": "optimal",
            },
            {
                "routine_name": "Upper Body A (Knee Sparing)",
                "readiness_adaptation": "Knee sparing adaptation",
                "target_rir": "RIR 2",
                "volume_landmark": "MEV",
                "rationale": "Adjusted for knee tweak",
                "exercises": [],
                "recovery_status": "moderate",
            },
        ]
    )

    with TestClient(app_factory(fakes, settings=Settings(mcp_token="test-token"))) as mcp_client:
        _rpc(
            mcp_client,
            "initialize",
            {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "kratos-tests", "version": "0.0.0"},
            },
        )

        fasting_get = json.loads(
            _rpc(
                mcp_client,
                "tools/call",
                {"name": "fasting_recommendation_get", "arguments": {"target_date": "2026-11-25"}},
            )["result"]["content"][0]["text"]
        )
        assert fasting_get["protocol_name"] == "14:10 Court Fueling"
        assert fasting_get["extra"]["discord_thread_id"] == "fake-thread-1"

        fasting_adj = json.loads(
            _rpc(
                mcp_client,
                "tools/call",
                {
                    "name": "fasting_recommendation_adjust",
                    "arguments": {
                        "target_date": "2026-11-25",
                        "user_adjustment": "Shift dinner 30m later",
                    },
                },
            )["result"]["content"][0]["text"]
        )
        assert fasting_adj["protocol_name"] == "14:10 Dinner Shift"
        assert fasting_adj["extra"]["source"] == "agent"

        workout_get = json.loads(
            _rpc(
                mcp_client,
                "tools/call",
                {"name": "workout_recommendation_get", "arguments": {"target_date": "2026-11-25"}},
            )["result"]["content"][0]["text"]
        )
        assert workout_get["routine_name"] == "Upper Body A"
        assert workout_get["extra"]["discord_thread_id"] == "fake-thread-2"

        workout_adj = json.loads(
            _rpc(
                mcp_client,
                "tools/call",
                {
                    "name": "workout_recommendation_adjust",
                    "arguments": {
                        "target_date": "2026-11-25",
                        "user_adjustment": "Knee tweak, avoid deep knee flexion",
                    },
                },
            )["result"]["content"][0]["text"]
        )
        assert workout_adj["routine_name"] == "Upper Body A (Knee Sparing)"
        assert workout_adj["extra"]["source"] == "agent"

    f_row = db.scalar(select(FastingRecommendation).where(FastingRecommendation.date == "2026-11-25"))
    w_row = db.scalar(select(WorkoutRecommendation).where(WorkoutRecommendation.date == "2026-11-25"))
    assert f_row is not None and f_row.extra["source"] == "agent"
    assert w_row is not None and w_row.extra["source"] == "agent"
