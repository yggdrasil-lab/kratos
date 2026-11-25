"""Thin biometrics and autoregulation router delegating to AutoregulationCore."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.container import get_container
from app.db import get_db
from app.schemas import (
    FastingCheckInPayload,
    FastingRecommendationRead,
    FastingSynthesizeRequest,
    WorkoutFeedbackPayload,
    WorkoutMetricsRead,
    WorkoutRecommendationRead,
    WorkoutSynthesizeRequest,
    WorkoutTimelineRead,
)

router = APIRouter(prefix="/biometrics", tags=["biometrics"])


@router.get("/today")
def get_today_biometrics(request: Request) -> dict[str, Any] | None:
    """Proxy today's Eir daily biometrics summary with unified ReadinessAssessment."""
    return get_container(request).autoregulation.get_today_biometrics()


@router.get("/latest")
def get_latest_biometrics(request: Request) -> dict[str, Any] | None:
    """Proxy the most recent scale measurement from Eir."""
    return get_container(request).autoregulation.get_latest_biometrics()


@router.get("/workout-metrics", response_model=WorkoutMetricsRead)
def get_workout_metrics(
    request: Request,
    started_at: datetime = Query(description="Window start ISO-8601 timestamp"),
    ended_at: datetime = Query(description="Window end ISO-8601 timestamp"),
    classification: str | None = Query(default=None),
    activity_type: str | None = Query(default=None),
    routine_name: str | None = Query(default=None),
) -> WorkoutMetricsRead:
    """Proxy Eir workout exertion metrics for a time window; fails with 502 on upstream failure."""
    if ended_at <= started_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ended_at must be after started_at",
        )
    return get_container(request).autoregulation.get_workout_metrics(
        started_at,
        ended_at,
        classification=classification,
        activity_type=activity_type,
        routine_name=routine_name,
    )


@router.get("/workout-timeline", response_model=WorkoutTimelineRead)
def get_workout_timeline(
    request: Request,
    started_at: datetime = Query(description="Window start ISO-8601 timestamp"),
    ended_at: datetime = Query(description="Window end ISO-8601 timestamp"),
) -> WorkoutTimelineRead:
    """Proxy Eir 5-min HR/step timeline and split hints; fails with 502 on upstream failure."""
    if ended_at <= started_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ended_at must be after started_at",
        )
    return get_container(request).autoregulation.get_workout_timeline(
        started_at, ended_at
    )


@router.get("/fasting-recommendation", response_model=FastingRecommendationRead)
def get_fasting_recommendation_endpoint(
    request: Request,
    target_date: str | None = None,
    db: Session = Depends(get_db),
) -> FastingRecommendationRead:
    return get_container(request).autoregulation.get_fasting_recommendation(
        db, target_date=target_date
    )


@router.post("/fasting-recommendation/synthesize", response_model=FastingRecommendationRead)
def trigger_fasting_synthesis_endpoint(
    request: Request,
    payload: FastingSynthesizeRequest,
    db: Session = Depends(get_db),
) -> FastingRecommendationRead:
    return get_container(request).autoregulation.synthesize_fasting_recommendation(
        db, payload
    )


@router.get("/workout-recommendation", response_model=WorkoutRecommendationRead)
def get_workout_recommendation_endpoint(
    request: Request,
    target_date: str | None = None,
    db: Session = Depends(get_db),
) -> WorkoutRecommendationRead:
    return get_container(request).autoregulation.get_workout_recommendation(
        db, target_date=target_date
    )


@router.post("/workout-recommendation/synthesize", response_model=WorkoutRecommendationRead)
def trigger_workout_synthesis_endpoint(
    request: Request,
    payload: WorkoutSynthesizeRequest,
    db: Session = Depends(get_db),
) -> WorkoutRecommendationRead:
    return get_container(request).autoregulation.synthesize_workout_recommendation(
        db, payload
    )


@router.post("/fasting")
def save_fasting_checkin(request: Request, payload: FastingCheckInPayload) -> dict[str, str]:
    """Record fasting feedback and forward to Eir when available."""
    get_container(request).autoregulation.submit_fasting_feedback(payload)
    return {"status": "ok"}


@router.post("/workout-feedback")
def save_workout_feedback(request: Request, payload: WorkoutFeedbackPayload) -> dict[str, str]:
    """Record workout feedback and forward to Eir when available."""
    get_container(request).autoregulation.submit_workout_feedback(payload)
    return {"status": "ok"}
