"""Gateway client for internal Swarm HTTP communication with the Eir biometrics service."""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from typing import Any

from app.config import settings
from app.schemas import WorkoutMetricsRead, WorkoutTimelineRead

logger = logging.getLogger(__name__)

_USER_AGENT = "Kratos-Bridge/1.0"


class EirUpstreamError(RuntimeError):
    """Raised when a required Eir upstream request fails or returns invalid JSON."""


def _build_url(path: str, params: dict[str, str] | None = None) -> str:
    base = settings.eir_internal_url.rstrip("/")
    normalized_path = path if path.startswith("/") else f"/{path}"
    url = f"{base}{normalized_path}"
    if params:
        return f"{url}?{urllib.parse.urlencode(params)}"
    return url


def request_eir_json(
    path: str,
    *,
    params: dict[str, str] | None = None,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
    timeout: float = 5.0,
) -> Any:
    """Executes an HTTP request against Eir and fails loudly with EirUpstreamError."""
    url = _build_url(path, params)
    headers = {"User-Agent": _USER_AGENT}
    data: bytes | None = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode("utf-8")

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status >= 400:
                raise EirUpstreamError(f"Eir upstream returned HTTP {resp.status} for {path}")
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raise EirUpstreamError(f"Eir upstream HTTP {exc.code} for {path}") from exc
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        raise EirUpstreamError(f"Eir upstream unavailable for {path}: {exc}") from exc


def request_eir_json_optional(
    path: str,
    *,
    params: dict[str, str] | None = None,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
    timeout: float = 2.0,
) -> Any | None:
    """Best-effort Eir request for optional dashboard telemetry and feedback forwarding."""
    try:
        return request_eir_json(
            path,
            params=params,
            method=method,
            payload=payload,
            timeout=timeout,
        )
    except EirUpstreamError as exc:
        logger.debug("Optional Eir request failed (%s): %s", path, exc)
        return None


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


def fetch_workout_metrics(
    started_at: datetime,
    ended_at: datetime,
    *,
    classification: str | None = None,
    activity_type: str | None = None,
    routine_name: str | None = None,
) -> WorkoutMetricsRead:
    """Fetches Eir workout exertion metrics for a time window, failing loudly on upstream error."""
    eir_activity, eir_classification = resolve_eir_activity_params(activity_type, classification)
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

    data = request_eir_json("/biometrics/workout-metrics", params=params, timeout=5.0)
    metrics = WorkoutMetricsRead.model_validate(data)
    if activity_type == "class":
        metrics.activity_type = "class"
    if classification == "class" or (activity_type == "class" and classification is None):
        metrics.classification = classification or "class"
    return metrics


def fetch_workout_timeline(started_at: datetime, ended_at: datetime) -> WorkoutTimelineRead:
    """Fetches 5-minute HR/step timeline bins and suggested splits from Eir."""
    params = {
        "started_at": started_at.isoformat(),
        "ended_at": ended_at.isoformat(),
    }
    data = request_eir_json("/biometrics/workout-timeline", params=params, timeout=5.0)
    return WorkoutTimelineRead.model_validate(data)
