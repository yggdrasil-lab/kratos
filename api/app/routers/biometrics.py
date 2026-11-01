"""Biometrics proxy router for Kratos.

Fetches live morning biometrics (sleep, HRV, resting HR, weigh-in) from the internal
Eir service over the aether-net Swarm overlay network. Fails gracefully if Eir is offline.
"""

from datetime import datetime, timezone, timedelta
import json
import logging
import urllib.error
import urllib.request
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/biometrics", tags=["biometrics"])

EIR_INTERNAL_URL = "http://eir-api:8000"


class FastingCheckInPayload(BaseModel):
    id: str
    date: str
    target_window: str
    adherence: str
    energy: str
    headache: str
    notes: str | None = None
    logged_at: str


class WorkoutFeedbackPayload(BaseModel):
    date: str
    routine_name: str | None = None
    duration_minutes: int | None = None
    total_volume_kg: float | None = None
    completed_sets: int | None = None
    effort_rating: str  # 'too_easy', 'optimal', 'hard', 'too_hard'
    tags: list[str] = []
    notes: str | None = None
    logged_at: str | None = None


def _get_auckland_today() -> str:
    # Pacific/Auckland is UTC+12 or UTC+13 (NZDT). Use +13 as conservative local or circadian
    now_utc = datetime.now(timezone.utc)
    # 4-hour circadian shift: a 1 AM session belongs to previous day
    circadian = now_utc + timedelta(hours=13) - timedelta(hours=4)
    return circadian.strftime("%Y-%m-%d")


@router.get("/today")
def get_today_biometrics() -> dict[str, Any] | None:
    """Proxies today's Eir daily biometrics summary for the Kratos dashboard."""
    today = _get_auckland_today()
    url = f"{EIR_INTERNAL_URL}/biometrics/daily/{today}"
    req = urllib.request.Request(url, headers={"User-Agent": "Kratos-Bridge/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=2.0) as resp:
            if resp.status == 200:
                return json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        logger.debug("Eir biometrics probe failed: %s", exc)
    return None


@router.get("/latest")
def get_latest_biometrics() -> dict[str, Any] | None:
    """Proxies the most recent scale measurement from Eir."""
    url = f"{EIR_INTERNAL_URL}/biometrics/latest"
    req = urllib.request.Request(url, headers={"User-Agent": "Kratos-Bridge/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=2.0) as resp:
            if resp.status == 200:
                return json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        logger.debug("Eir latest biometrics probe failed: %s", exc)
    return None


@router.post("/fasting")
def save_fasting_checkin(payload: FastingCheckInPayload) -> dict[str, str]:
    """Records fasting feedback and forwards to Eir when available."""
    try:
        data = json.dumps(payload.model_dump()).encode("utf-8")
        req = urllib.request.Request(
            f"{EIR_INTERNAL_URL}/feedback/fasting",
            data=data,
            headers={"Content-Type": "application/json", "User-Agent": "Kratos-Bridge/1.0"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=2.0):
            pass
    except Exception as exc:
        logger.debug("Failed forwarding fasting feedback to Eir: %s", exc)
    return {"status": "ok"}


@router.post("/workout-feedback")
def save_workout_feedback(payload: WorkoutFeedbackPayload) -> dict[str, str]:
    """Records workout feedback and forwards to Eir when available."""
    try:
        data = json.dumps(payload.model_dump()).encode("utf-8")
        req = urllib.request.Request(
            f"{EIR_INTERNAL_URL}/feedback/workout",
            data=data,
            headers={"Content-Type": "application/json", "User-Agent": "Kratos-Bridge/1.0"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=2.0):
            pass
    except Exception as exc:
        logger.debug("Failed forwarding workout feedback to Eir: %s", exc)
    return {"status": "ok"}
