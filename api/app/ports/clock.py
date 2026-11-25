"""Clock port and DST-safe Pacific/Auckland circadian calendar adapter."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Protocol, runtime_checkable
from zoneinfo import ZoneInfo


@runtime_checkable
class ClockPort(Protocol):
    """Port for current UTC/local time and circadian day resolution."""

    def now_utc(self) -> datetime: ...

    def now_local(self) -> datetime: ...

    def today_circadian(self) -> date: ...

    def today_str(self) -> str: ...


@dataclass(frozen=True)
class AucklandClockAdapter:
    """DST-aware circadian clock using IANA Pacific/Auckland and a configurable day boundary."""

    timezone_name: str = "Pacific/Auckland"
    day_boundary_hour: int = 4
    now_fn: Callable[[], datetime] | None = None

    def __post_init__(self) -> None:
        if not 0 <= self.day_boundary_hour <= 23:
            raise ValueError(
                f"day_boundary_hour must be between 0 and 23, got {self.day_boundary_hour}"
            )
        ZoneInfo(self.timezone_name)

    def now_utc(self) -> datetime:
        if self.now_fn is None:
            return datetime.now(timezone.utc)
        current = self.now_fn()
        if current.tzinfo is None:
            raise ValueError("Injected clock timestamp must be timezone-aware")
        return current.astimezone(timezone.utc)

    def now_local(self) -> datetime:
        return self.now_utc().astimezone(ZoneInfo(self.timezone_name))

    def today_circadian(self) -> date:
        shifted = self.now_local() - timedelta(hours=self.day_boundary_hour)
        return shifted.date()

    def today_str(self) -> str:
        return self.today_circadian().isoformat()
