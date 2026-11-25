"""Eir biometrics peer port and HTTP Swarm overlay adapter."""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol, runtime_checkable

from pydantic import ValidationError

from app.schemas import WorkoutMetricsRead, WorkoutTimelineRead

logger = logging.getLogger(__name__)

HttpOpener = Callable[..., Any]


class EirUpstreamError(RuntimeError):
    """Raised when a required Eir upstream request fails or returns invalid data."""


@dataclass(frozen=True)
class EirConfig:
    """Configuration for the internal Eir biometrics gateway."""

    base_url: str
    timeout_seconds: float = 5.0
    optional_timeout_seconds: float = 2.0
    user_agent: str = "Kratos-Bridge/1.0"

    def __post_init__(self) -> None:
        if not self.base_url or not self.base_url.strip():
            raise ValueError("EirConfig.base_url must be non-empty")


@runtime_checkable
class EirPort(Protocol):
    """Peer port for Eir biometrics, workout exertion metrics, and feedback forwarding."""

    def get_daily_biometrics(self, target_date: str) -> dict[str, Any] | None: ...

    def get_latest_biometrics(self) -> dict[str, Any] | None: ...

    def get_workout_metrics(
        self,
        started_at: datetime,
        ended_at: datetime,
        *,
        classification: str | None = None,
        activity_type: str | None = None,
        routine_name: str | None = None,
    ) -> WorkoutMetricsRead: ...

    def get_workout_timeline(
        self, started_at: datetime, ended_at: datetime
    ) -> WorkoutTimelineRead: ...

    def submit_fasting_feedback(self, payload: dict[str, Any]) -> bool: ...

    def submit_workout_feedback(self, payload: dict[str, Any]) -> bool: ...


def resolve_eir_activity_params(
    activity_type: str | None,
    classification: str | None,
) -> tuple[str | None, str | None]:
    """Maps Kratos 'class' workouts onto Eir's 'gym' metabolic profile."""
    eir_activity = "gym" if activity_type == "class" else activity_type
    eir_classification = "gym" if classification == "class" else classification
    if activity_type == "class" and eir_classification is None:
        eir_classification = "gym"
    return eir_activity, eir_classification


class HttpEirAdapter:
    """HTTP adapter communicating with Eir over the Swarm overlay network."""

    def __init__(
        self,
        config: EirConfig,
        *,
        opener: HttpOpener = urllib.request.urlopen,
    ) -> None:
        self._config = config
        self._opener = opener

    def _build_url(self, path: str, params: dict[str, str] | None = None) -> str:
        base = self._config.base_url.rstrip("/")
        normalized_path = path if path.startswith("/") else f"/{path}"
        url = f"{base}{normalized_path}"
        if params:
            return f"{url}?{urllib.parse.urlencode(params)}"
        return url

    def _request_json(
        self,
        path: str,
        *,
        params: dict[str, str] | None = None,
        method: str = "GET",
        payload: dict[str, Any] | None = None,
        timeout: float | None = None,
    ) -> Any:
        url = self._build_url(path, params)
        headers = {"User-Agent": self._config.user_agent}
        data: bytes | None = None
        if payload is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        effective_timeout = timeout if timeout is not None else self._config.timeout_seconds
        try:
            with self._opener(req, timeout=effective_timeout) as resp:
                if resp.status >= 400:
                    raise EirUpstreamError(f"Eir upstream returned HTTP {resp.status} for {path}")
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as exc:
            raise EirUpstreamError(f"Eir upstream HTTP {exc.code} for {path}") from exc
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            raise EirUpstreamError(f"Eir upstream unavailable for {path}: {exc}") from exc

    def _request_json_optional(
        self,
        path: str,
        *,
        method: str = "GET",
        payload: dict[str, Any] | None = None,
    ) -> Any | None:
        try:
            return self._request_json(
                path,
                method=method,
                payload=payload,
                timeout=self._config.optional_timeout_seconds,
            )
        except EirUpstreamError as exc:
            logger.warning("Optional Eir request failed (%s): %s", path, exc)
            return None

    def get_daily_biometrics(self, target_date: str) -> dict[str, Any] | None:
        result = self._request_json_optional(f"/biometrics/daily/{target_date}")
        return result if isinstance(result, dict) else None

    def get_latest_biometrics(self) -> dict[str, Any] | None:
        result = self._request_json_optional("/biometrics/latest")
        return result if isinstance(result, dict) else None

    def get_workout_metrics(
        self,
        started_at: datetime,
        ended_at: datetime,
        *,
        classification: str | None = None,
        activity_type: str | None = None,
        routine_name: str | None = None,
    ) -> WorkoutMetricsRead:
        eir_activity, eir_classification = resolve_eir_activity_params(
            activity_type, classification
        )
        params: dict[str, str] = {
            "started_at": started_at.isoformat(),
            "ended_at": ended_at.isoformat(),
        }
        if eir_classification:
            params["classification"] = eir_classification
        if eir_activity:
            params["activity_type"] = eir_activity
        if routine_name:
            params["routine_name"] = routine_name

        data = self._request_json("/biometrics/workout-metrics", params=params)
        try:
            metrics = WorkoutMetricsRead.model_validate(data)
        except ValidationError as exc:
            raise EirUpstreamError(f"Invalid Eir workout metrics payload: {exc}") from exc
        if activity_type == "class":
            metrics.activity_type = "class"
        if classification == "class" or (activity_type == "class" and classification is None):
            metrics.classification = classification or "class"
        return metrics

    def get_workout_timeline(
        self, started_at: datetime, ended_at: datetime
    ) -> WorkoutTimelineRead:
        params = {
            "started_at": started_at.isoformat(),
            "ended_at": ended_at.isoformat(),
        }
        data = self._request_json("/biometrics/workout-timeline", params=params)
        try:
            return WorkoutTimelineRead.model_validate(data)
        except ValidationError as exc:
            raise EirUpstreamError(f"Invalid Eir workout timeline payload: {exc}") from exc

    def submit_fasting_feedback(self, payload: dict[str, Any]) -> bool:
        return (
            self._request_json_optional(
                "/feedback/fasting", method="POST", payload=payload
            )
            is not None
        )

    def submit_workout_feedback(self, payload: dict[str, Any]) -> bool:
        return (
            self._request_json_optional(
                "/feedback/workout", method="POST", payload=payload
            )
            is not None
        )
