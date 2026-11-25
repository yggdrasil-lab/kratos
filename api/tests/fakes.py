"""In-memory fake adapters implementing Kratos peer ports for deterministic tests."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from app.ports.muninn import JevDecisionResult
from app.schemas import WorkoutMetricsRead, WorkoutTimelineRead


@dataclass
class FakeClock:
    """Mutable deterministic clock implementing ClockPort."""

    current_utc: datetime = field(
        default_factory=lambda: datetime(2026, 11, 25, 0, 0, tzinfo=timezone.utc)
    )
    timezone_name: str = "Pacific/Auckland"
    day_boundary_hour: int = 4

    def set_utc(self, value: datetime) -> None:
        if value.tzinfo is None:
            raise ValueError("FakeClock timestamps must be timezone-aware")
        self.current_utc = value.astimezone(timezone.utc)

    def advance(self, delta: timedelta) -> None:
        self.current_utc = self.current_utc + delta

    def now_utc(self) -> datetime:
        return self.current_utc

    def now_local(self) -> datetime:
        return self.current_utc.astimezone(ZoneInfo(self.timezone_name))

    def today_circadian(self) -> date:
        return (self.now_local() - timedelta(hours=self.day_boundary_hour)).date()

    def today_str(self) -> str:
        return self.today_circadian().isoformat()


@dataclass
class InMemoryEirAdapter:
    """In-memory fake implementing EirPort."""

    daily_by_date: dict[str, dict[str, Any]] = field(default_factory=dict)
    latest: dict[str, Any] | None = None
    metrics_response: WorkoutMetricsRead | None = None
    timeline_response: WorkoutTimelineRead | None = None
    raise_on_metrics: Exception | None = None
    raise_on_timeline: Exception | None = None
    fasting_feedback: list[dict[str, Any]] = field(default_factory=list)
    workout_feedback: list[dict[str, Any]] = field(default_factory=list)
    daily_requests: list[str] = field(default_factory=list)
    metrics_requests: list[dict[str, Any]] = field(default_factory=list)
    timeline_requests: list[tuple[datetime, datetime]] = field(default_factory=list)

    def get_daily_biometrics(self, target_date: str) -> dict[str, Any] | None:
        self.daily_requests.append(target_date)
        return self.daily_by_date.get(target_date)

    def get_latest_biometrics(self) -> dict[str, Any] | None:
        return self.latest

    def get_workout_metrics(
        self,
        started_at: datetime,
        ended_at: datetime,
        *,
        classification: str | None = None,
        activity_type: str | None = None,
        routine_name: str | None = None,
    ) -> WorkoutMetricsRead:
        self.metrics_requests.append(
            {
                "started_at": started_at,
                "ended_at": ended_at,
                "classification": classification,
                "activity_type": activity_type,
                "routine_name": routine_name,
            }
        )
        if self.raise_on_metrics is not None:
            raise self.raise_on_metrics
        if self.metrics_response is not None:
            return self.metrics_response
        return WorkoutMetricsRead(
            started_at=started_at,
            ended_at=ended_at,
            duration_minutes=45,
            active_energy_kcal=350,
            avg_hr_bpm=138,
            peak_hr_bpm=164,
            activity_type=activity_type,
            classification=classification,
            routine_name=routine_name,
        )

    def get_workout_timeline(
        self, started_at: datetime, ended_at: datetime
    ) -> WorkoutTimelineRead:
        self.timeline_requests.append((started_at, ended_at))
        if self.raise_on_timeline is not None:
            raise self.raise_on_timeline
        if self.timeline_response is not None:
            return self.timeline_response
        return WorkoutTimelineRead(started_at=started_at, ended_at=ended_at)

    def submit_fasting_feedback(self, payload: dict[str, Any]) -> bool:
        self.fasting_feedback.append(dict(payload))
        return True

    def submit_workout_feedback(self, payload: dict[str, Any]) -> bool:
        self.workout_feedback.append(dict(payload))
        return True


@dataclass
class InMemoryMuninnAdapter:
    """In-memory fake implementing MuninnPort."""

    json_responses: list[dict[str, Any]] = field(default_factory=list)
    jev_verdicts: list[str] = field(default_factory=list)
    raise_on_synthesize: Exception | None = None
    raise_on_decide: Exception | None = None
    synthesize_calls: list[dict[str, Any]] = field(default_factory=list)
    decide_calls: list[dict[str, Any]] = field(default_factory=list)

    def synthesize_json(
        self,
        system_prompt: str,
        user_content: str,
        *,
        temperature: float = 0.2,
        model: str | None = None,
        timeout: float | None = None,
    ) -> dict[str, Any]:
        self.synthesize_calls.append(
            {
                "system_prompt": system_prompt,
                "user_content": user_content,
                "temperature": temperature,
                "model": model,
            }
        )
        if self.raise_on_synthesize is not None:
            raise self.raise_on_synthesize
        if self.json_responses:
            return self.json_responses.pop(0)
        return {}

    def decide(
        self,
        system_prompt: str,
        user_content: str,
        *,
        response_format: dict[str, Any] | None = None,
        model: str | None = None,
        timeout: float | None = None,
    ) -> JevDecisionResult:
        self.decide_calls.append(
            {
                "system_prompt": system_prompt,
                "user_content": user_content,
                "response_format": response_format,
                "model": model,
            }
        )
        if self.raise_on_decide is not None:
            raise self.raise_on_decide
        verdict = self.jev_verdicts.pop(0) if self.jev_verdicts else "MAINTENANCE"
        return JevDecisionResult(
            verdict=verdict,
            model=model or "jev-decision",
            latency_seconds=0.001,
        )


@dataclass
class InMemoryDiscordAdapter:
    """In-memory fake implementing DiscordPort."""

    user_id: str | None = "1001"
    enabled: bool = True
    created_threads: list[dict[str, Any]] = field(default_factory=list)
    replies: list[dict[str, Any]] = field(default_factory=list)
    _counter: int = 1

    def create_forum_thread(
        self,
        title: str,
        content: str,
        *,
        channel_id: str | None = None,
    ) -> str | None:
        if not self.enabled:
            return None
        normalized = title[:100].strip()
        for existing in self.created_threads:
            if existing["title"] == normalized:
                return existing["id"]
        thread_id = f"fake-thread-{self._counter}"
        self._counter += 1
        self.created_threads.append(
            {
                "id": thread_id,
                "title": normalized,
                "content": content,
                "channel_id": channel_id,
            }
        )
        return thread_id

    def post_thread_reply(self, thread_id: str, content: str) -> bool:
        if not self.enabled or not thread_id:
            return False
        self.replies.append({"thread_id": thread_id, "content": content})
        return True
