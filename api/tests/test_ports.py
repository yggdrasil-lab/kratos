"""Unit tests for Kratos peer ports, HTTP adapters, fakes, and composition root."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from datetime import date, datetime, timezone

import pytest

from app.config import Settings
from app.container import KratosContainer, build_container
from app.main import create_app
from app.ports import (
    AucklandClockAdapter,
    ClockPort,
    DiscordConfig,
    DiscordPort,
    EirConfig,
    EirPort,
    EirUpstreamError,
    HttpDiscordAdapter,
    HttpEirAdapter,
    HttpMuninnAdapter,
    MuninnConfig,
    MuninnPort,
    MuninnUpstreamError,
)
from tests.fakes import (
    FakeClock,
    InMemoryDiscordAdapter,
    InMemoryEirAdapter,
    InMemoryMuninnAdapter,
)


class _StubResponse:
    def __init__(self, payload: dict | list | str, status: int = 200) -> None:
        self.status = status
        raw = payload if isinstance(payload, str) else json.dumps(payload)
        self._bytes = raw.encode("utf-8")

    def read(self) -> bytes:
        return self._bytes

    def __enter__(self) -> "_StubResponse":
        return self

    def __exit__(self, *args: object) -> None:
        return None


def test_auckland_clock_handles_nzdt_and_nzst_with_0400_boundary() -> None:
    # NZDT (UTC+13) in November: 14:30 UTC is 03:30 NZDT -> belongs to previous circadian day.
    before_nzdt = AucklandClockAdapter(
        now_fn=lambda: datetime(2026, 11, 24, 14, 30, tzinfo=timezone.utc)
    )
    assert before_nzdt.now_local().utcoffset().total_seconds() == 13 * 3600
    assert before_nzdt.today_circadian() == date(2026, 11, 24)
    assert before_nzdt.today_str() == "2026-11-24"

    # 15:00 UTC is 04:00 NZDT -> rolls onto 2026-11-25.
    after_nzdt = AucklandClockAdapter(
        now_fn=lambda: datetime(2026, 11, 24, 15, 0, tzinfo=timezone.utc)
    )
    assert after_nzdt.today_circadian() == date(2026, 11, 25)

    # NZST (UTC+12) in July: 15:30 UTC is 03:30 NZST -> belongs to 2026-07-15 (old +13h hack broke here).
    before_nzst = AucklandClockAdapter(
        now_fn=lambda: datetime(2026, 7, 15, 15, 30, tzinfo=timezone.utc)
    )
    assert before_nzst.now_local().utcoffset().total_seconds() == 12 * 3600
    assert before_nzst.today_circadian() == date(2026, 7, 15)

    # 16:00 UTC is 04:00 NZST -> rolls onto 2026-07-16.
    after_nzst = AucklandClockAdapter(
        now_fn=lambda: datetime(2026, 7, 15, 16, 0, tzinfo=timezone.utc)
    )
    assert after_nzst.today_circadian() == date(2026, 7, 16)


def test_auckland_clock_rejects_naive_timestamp_and_invalid_boundary() -> None:
    with pytest.raises(ValueError, match="day_boundary_hour"):
        AucklandClockAdapter(day_boundary_hour=24)

    naive_clock = AucklandClockAdapter(now_fn=lambda: datetime(2026, 11, 25, 1, 0))
    with pytest.raises(ValueError, match="timezone-aware"):
        naive_clock.now_utc()


def test_http_eir_adapter_maps_class_and_forwards_feedback() -> None:
    seen_urls: list[str] = []

    def opener(req: urllib.request.Request, timeout: float = 5.0) -> _StubResponse:
        seen_urls.append(req.full_url)
        if "/biometrics/daily/" in req.full_url:
            return _StubResponse({"hrv_ms": 54.0, "sleep_duration_hours": 7.6})
        if "/biometrics/workout-metrics" in req.full_url:
            return _StubResponse(
                {
                    "started_at": "2026-11-23T04:30:00Z",
                    "ended_at": "2026-11-23T05:30:00Z",
                    "duration_minutes": 60,
                    "active_energy_kcal": 480,
                    "activity_type": "gym",
                    "classification": "gym",
                }
            )
        return _StubResponse({"status": "ok"})

    adapter = HttpEirAdapter(EirConfig(base_url="http://eir-api:8000"), opener=opener)
    assert adapter.get_daily_biometrics("2026-11-23") == {
        "hrv_ms": 54.0,
        "sleep_duration_hours": 7.6,
    }

    started = datetime(2026, 11, 23, 4, 30, tzinfo=timezone.utc)
    ended = datetime(2026, 11, 23, 5, 30, tzinfo=timezone.utc)
    metrics = adapter.get_workout_metrics(started, ended, activity_type="class")
    assert "activity_type=gym" in seen_urls[1]
    assert "classification=gym" in seen_urls[1]
    assert metrics.activity_type == "class"
    assert metrics.classification == "class"
    assert adapter.submit_fasting_feedback({"id": "1"}) is True


def test_http_eir_adapter_fails_loud_on_required_endpoints() -> None:
    def failing_opener(req: urllib.request.Request, timeout: float = 5.0):
        raise urllib.error.URLError("eir offline")

    started = datetime(2026, 11, 23, 4, 30, tzinfo=timezone.utc)
    ended = datetime(2026, 11, 23, 5, 30, tzinfo=timezone.utc)
    broken = HttpEirAdapter(EirConfig(base_url="http://eir-api:8000"), opener=failing_opener)
    assert broken.get_daily_biometrics("2026-11-23") is None
    assert broken.submit_workout_feedback({"effort_rating": "optimal"}) is False
    with pytest.raises(EirUpstreamError, match="unavailable"):
        broken.get_workout_metrics(started, ended)
    with pytest.raises(EirUpstreamError, match="unavailable"):
        broken.get_workout_timeline(started, ended)


def test_http_muninn_adapter_synthesizes_json_and_decides_jev() -> None:
    captured_bodies: list[dict] = []

    def opener(req: urllib.request.Request, timeout: float = 5.0) -> _StubResponse:
        body = json.loads(req.data.decode("utf-8"))
        captured_bodies.append(body)
        if body["model"] == "jev-decision":
            return _StubResponse({"choices": [{"message": {"content": "MAV_OVERLOAD"}}]})
        return _StubResponse(
            {"choices": [{"message": {"content": json.dumps({"target_window": "14:10"})}}]}
        )

    adapter = HttpMuninnAdapter(
        MuninnConfig(base_url="http://muninn:4000/v1", api_key="test-key"),
        opener=opener,
    )
    synthesized = adapter.synthesize_json("sys", "user")
    assert synthesized == {"target_window": "14:10"}
    assert captured_bodies[0]["response_format"] == {"type": "json_object"}

    decision = adapter.decide("classify", "sleep 8h")
    assert decision.verdict == "MAV_OVERLOAD"
    assert decision.model == "jev-decision"
    assert captured_bodies[1]["temperature"] == 0.0

    bad_json = HttpMuninnAdapter(
        MuninnConfig(base_url="http://muninn:4000/v1", api_key="test-key"),
        opener=lambda req, timeout=5.0: _StubResponse(
            {"choices": [{"message": {"content": "not-json"}}]}
        ),
    )
    with pytest.raises(MuninnUpstreamError, match="invalid JSON"):
        bad_json.synthesize_json("sys", "user")


def test_http_discord_adapter_sets_user_agent_and_reuses_active_thread() -> None:
    calls: list[tuple[str, str, dict]] = []

    def opener(req: urllib.request.Request, timeout: float = 4.0) -> _StubResponse:
        calls.append((req.get_method(), req.full_url, dict(req.headers)))
        if req.full_url.endswith("/threads/active"):
            return _StubResponse({"threads": []})
        if req.full_url.endswith("/threads"):
            return _StubResponse({"id": "thread-42"})
        return _StubResponse({"id": "msg-99"})

    adapter = HttpDiscordAdapter(
        DiscordConfig(bot_token="bot-tok", health_channel_id="chan-1", user_id="1001"),
        opener=opener,
    )
    long_content = ("A" * 1800) + "\n\n" + ("B" * 300)
    thread_id = adapter.create_forum_thread("Daily Fasting", long_content)
    assert thread_id == "thread-42"
    assert [c[0] for c in calls] == ["GET", "POST", "POST"]
    assert calls[1][2]["User-agent"] == "Yggdrasil-Kratos/1.0 (DiscordBot)"
    assert adapter.post_thread_reply("thread-42", "Adjusted") is True

    unconfigured = HttpDiscordAdapter(DiscordConfig())
    assert unconfigured.create_forum_thread("Daily Fasting", "hi") is None
    assert unconfigured.post_thread_reply("thread-42", "hi") is False


def test_in_memory_fakes_satisfy_protocols_and_create_app_wires_container() -> None:
    fake_clock = FakeClock()
    fake_eir = InMemoryEirAdapter()
    fake_muninn = InMemoryMuninnAdapter(
        json_responses=[{"ok": True}],
        jev_verdicts=["MEV_DELOAD"],
    )
    fake_discord = InMemoryDiscordAdapter()

    assert isinstance(fake_clock, ClockPort)
    assert isinstance(fake_eir, EirPort)
    assert isinstance(fake_muninn, MuninnPort)
    assert isinstance(fake_discord, DiscordPort)

    container = build_container(
        Settings(database_url="postgresql+psycopg://kratos:kratos@localhost:5432/kratos"),
        clock=fake_clock,
        eir=fake_eir,
        muninn=fake_muninn,
        discord=fake_discord,
    )
    assert isinstance(container, KratosContainer)
    fastapi_app = create_app(container)
    assert fastapi_app.state.container is container
    assert container.get_workout_lock("2026-11-25") is container.get_workout_lock("2026-11-25")
    assert container.get_fasting_lock("2026-11-25") is not container.get_workout_lock("2026-11-25")
