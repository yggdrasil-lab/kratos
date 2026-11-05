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

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import FastingRecommendation, WeeklyPlan
from app.schemas import FastingRecommendationRead, FastingSynthesizeRequest
from app.services.fasting_engine import generate_fasting_recommendation
from app.services.llm_fasting import synthesize_fasting_recommendation_llm

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


@router.get("/fasting-recommendation", response_model=FastingRecommendationRead)
def get_fasting_recommendation(
    target_date: str | None = None,
    db: Session = Depends(get_db),
) -> FastingRecommendationRead:
    """Returns a smart autoregulated fasting recommendation based on scheduled plan and Eir biometrics."""
    resolved_date_str = target_date or _get_auckland_today()
    try:
        t_date = datetime.strptime(resolved_date_str, "%Y-%m-%d").date()
    except ValueError:
        t_date = datetime.now(timezone.utc).date()

    date_str = t_date.isoformat()
    cached = db.scalar(
        select(FastingRecommendation).where(
            FastingRecommendation.date == date_str,
            FastingRecommendation.deleted_at.is_(None),
        )
    )
    if cached:
        return FastingRecommendationRead(
            date=cached.date,
            protocol_name=cached.protocol_name,
            target_window=cached.target_window,
            window_hours=cached.window_hours,
            rationale=cached.rationale,
            fueling_anchors=cached.fueling_anchors,
            recovery_status=cached.recovery_status,
            activity_context=cached.activity_context,
            is_llm_generated=cached.is_llm_generated,
            research_citation=cached.research_citation,
        )

    # Query weekly plan for this date
    iso_year, iso_week, _ = t_date.isocalendar()
    iso_week_str = f"{iso_year}-W{iso_week:02d}"
    weekly_plan = db.scalar(
        select(WeeklyPlan).where(
            WeeklyPlan.iso_week == iso_week_str,
            WeeklyPlan.deleted_at.is_(None),
        )
    )

    # Fetch biometrics for this date from Eir
    biometrics = None
    url = f"{EIR_INTERNAL_URL}/biometrics/daily/{date_str}"
    req = urllib.request.Request(url, headers={"User-Agent": "Kratos-Bridge/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=2.0) as resp:
            if resp.status == 200:
                biometrics = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        logger.debug("Failed fetching Eir biometrics for fasting recommendation: %s", exc)

    rec = synthesize_fasting_recommendation_llm(t_date, weekly_plan, biometrics)

    # Cache recommendation for today
    record = FastingRecommendation(
        date=date_str,
        protocol_name=rec.protocol_name,
        target_window=rec.target_window,
        window_hours=rec.window_hours,
        rationale=rec.rationale,
        fueling_anchors=rec.fueling_anchors,
        recovery_status=rec.recovery_status,
        activity_context=rec.activity_context,
        is_llm_generated=rec.is_llm_generated,
        research_citation=rec.research_citation,
    )
    db.add(record)
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.debug("Failed saving fasting recommendation cache: %s", exc)

    return rec


@router.post("/fasting-recommendation/synthesize", response_model=FastingRecommendationRead)
def trigger_fasting_synthesis(
    payload: FastingSynthesizeRequest,
    db: Session = Depends(get_db),
) -> FastingRecommendationRead:
    """Forces on-demand LLM synthesis of fasting and nutrient timing protocol with optional custom context."""
    resolved_date_str = payload.target_date or _get_auckland_today()
    try:
        t_date = datetime.strptime(resolved_date_str, "%Y-%m-%d").date()
    except ValueError:
        t_date = datetime.now(timezone.utc).date()

    date_str = t_date.isoformat()
    iso_year, iso_week, _ = t_date.isocalendar()
    iso_week_str = f"{iso_year}-W{iso_week:02d}"
    weekly_plan = db.scalar(
        select(WeeklyPlan).where(
            WeeklyPlan.iso_week == iso_week_str,
            WeeklyPlan.deleted_at.is_(None),
        )
    )

    biometrics = None
    url = f"{EIR_INTERNAL_URL}/biometrics/daily/{date_str}"
    req = urllib.request.Request(url, headers={"User-Agent": "Kratos-Bridge/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=2.0) as resp:
            if resp.status == 200:
                biometrics = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        logger.debug("Failed fetching Eir biometrics for synthesis: %s", exc)

    rec = synthesize_fasting_recommendation_llm(
        target_date=t_date,
        weekly_plan=weekly_plan,
        biometrics=biometrics,
        custom_context=payload.custom_context,
    )

    existing = db.scalar(
        select(FastingRecommendation).where(
            FastingRecommendation.date == date_str,
            FastingRecommendation.deleted_at.is_(None),
        )
    )
    if existing:
        existing.protocol_name = rec.protocol_name
        existing.target_window = rec.target_window
        existing.window_hours = rec.window_hours
        existing.rationale = rec.rationale
        existing.fueling_anchors = rec.fueling_anchors
        existing.recovery_status = rec.recovery_status
        existing.activity_context = rec.activity_context
        existing.is_llm_generated = rec.is_llm_generated
        existing.research_citation = rec.research_citation
        existing.custom_context = payload.custom_context
    else:
        new_record = FastingRecommendation(
            date=date_str,
            protocol_name=rec.protocol_name,
            target_window=rec.target_window,
            window_hours=rec.window_hours,
            rationale=rec.rationale,
            fueling_anchors=rec.fueling_anchors,
            recovery_status=rec.recovery_status,
            activity_context=rec.activity_context,
            is_llm_generated=rec.is_llm_generated,
            research_citation=rec.research_citation,
            custom_context=payload.custom_context,
        )
        db.add(new_record)
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.debug("Failed persisting synthesized fasting recommendation: %s", exc)

    return rec


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
