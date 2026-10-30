"""Health integrations router for Withings scales and Apple Watch telemetry.

Receives webhook payloads from Withings Cloud and iOS Shortcuts (HealthKit),
persisting biometrics and auto-logging completed workouts into Kratos.
"""

from datetime import datetime, timezone
from decimal import Decimal
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import BiometricMeasurement, Exercise, Session as WorkoutSession, SessionItem
from app.schemas import (
    AppleBiometricsPayload,
    AppleWorkoutPayload,
    BiometricRead,
    SessionRead,
    WithingsMeasurementPayload,
)

router = APIRouter(prefix="/integrations", tags=["integrations"])


def verify_webhook_token(
    authorization: str | None = Header(default=None),
    x_webhook_secret: str | None = Header(default=None),
    secret: str | None = Query(default=None),
) -> None:
    """Validate webhook secret from header or query param.

    If KRATOS_WEBHOOK_SECRET or KRATOS_MCP_TOKEN is configured, machine-to-machine
    requests must present a matching secret.
    """
    expected = settings.webhook_secret or settings.mcp_token
    if not expected:
        return

    token = None
    if authorization:
        parts = authorization.split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            token = parts[1]
        elif len(parts) == 1:
            token = parts[0]
    elif x_webhook_secret:
        token = x_webhook_secret
    elif secret:
        token = secret

    if not token or token != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing integration webhook token",
        )


# ------------------------------------------------------------------ Apple Health
@router.post(
    "/apple-health/workout",
    response_model=SessionRead,
    status_code=status.HTTP_201_CREATED,
    summary="Ingest workout completed on Apple Watch via iOS Shortcuts",
)
def ingest_apple_workout(
    payload: AppleWorkoutPayload,
    db: Session = Depends(get_db),
    _: None = Depends(verify_webhook_token),
) -> WorkoutSession:
    """Converts an Apple Watch workout into a logged Kratos session."""
    started_at = payload.started_at
    ended_at = payload.ended_at
    duration_s = payload.duration_seconds
    if duration_s is None and started_at and ended_at:
        duration_s = max(0, int((ended_at - started_at).total_seconds()))

    session_extra = {
        "source": "apple_health",
        "session_type": "sport",
        "activity_name": payload.workout_type,
        "duration_minutes": round(duration_s / 60) if duration_s else None,
        "active_energy_kcal": float(payload.active_energy_kcal) if payload.active_energy_kcal else None,
        "avg_heart_rate_bpm": payload.avg_heart_rate_bpm,
        "max_heart_rate_bpm": payload.max_heart_rate_bpm,
        "distance_meters": float(payload.distance_meters) if payload.distance_meters else None,
        "pool_length_meters": float(payload.pool_length_meters) if payload.pool_length_meters else None,
        "strokes": payload.strokes,
        **payload.extra,
    }

    session = WorkoutSession(
        id=uuid.uuid4(),
        routine_id=None,
        started_at=started_at,
        ended_at=ended_at,
        notes=payload.notes,
        extra=session_extra,
    )
    db.add(session)
    db.flush()

    # Link with catalog exercise if a match exists (e.g. 'Badminton' or 'Swimming')
    matching_ex = db.scalar(
        select(Exercise).where(
            Exercise.name.ilike(payload.workout_type),
            Exercise.deleted_at.is_(None),
        )
    )
    if matching_ex:
        item = SessionItem(
            id=uuid.uuid4(),
            session_id=session.id,
            exercise_id=matching_ex.id,
            position=0,
            notes=f"Auto-logged from Apple Watch ({payload.workout_type})",
            extra={
                "duration_seconds": duration_s,
                "distance_meters": float(payload.distance_meters) if payload.distance_meters else None,
            },
        )
        db.add(item)

    db.commit()
    db.refresh(session)
    return session


@router.post(
    "/apple-health/biometrics",
    response_model=BiometricRead,
    status_code=status.HTTP_201_CREATED,
    summary="Ingest morning or daily biometrics from Apple Health via iOS Shortcuts",
)
def ingest_apple_biometrics(
    payload: AppleBiometricsPayload,
    db: Session = Depends(get_db),
    _: None = Depends(verify_webhook_token),
) -> BiometricMeasurement:
    """Ingests Apple Health vitals: HRV, resting heart rate, sleep duration, and weight."""
    measurement = BiometricMeasurement(
        id=uuid.uuid4(),
        measured_at=payload.measured_at,
        source="apple_health",
        weight_kg=payload.weight_kg,
        body_fat_pct=payload.body_fat_pct,
        resting_hr_bpm=payload.resting_hr_bpm,
        hrv_ms=payload.hrv_ms,
        sleep_duration_s=payload.sleep_duration_s,
        sleep_deep_s=payload.sleep_deep_s,
        sleep_rem_s=payload.sleep_rem_s,
        sleep_score=payload.sleep_score,
        step_count=payload.step_count,
        active_energy_kcal=payload.active_energy_kcal,
        notes=payload.notes,
        extra=payload.extra,
    )
    db.add(measurement)
    db.commit()
    db.refresh(measurement)
    return measurement


# --------------------------------------------------------------------- Withings
@router.api_route(
    "/withings/webhook",
    methods=["GET", "HEAD"],
    summary="Withings subscription verification challenge endpoint",
)
def withings_webhook_verification():
    """Responds with 200 OK to Withings developer verification probes."""
    return {"status": "ok", "service": "kratos-withings"}


@router.post(
    "/withings/webhook",
    summary="Withings weigh-in notification callback",
)
async def withings_webhook_callback(
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(verify_webhook_token),
):
    """Receives Withings notifications when a user steps on the scale."""
    payload = {}
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        payload = await request.json()
    else:
        form = await request.form()
        payload = dict(form)

    # Store notification telemetry in biometrics extra log
    measurement = BiometricMeasurement(
        id=uuid.uuid4(),
        measured_at=datetime.now(timezone.utc),
        source="withings_webhook",
        notes=f"Notification: appli={payload.get('appli')}, userid={payload.get('userid')}",
        extra=payload,
    )
    db.add(measurement)
    db.commit()

    return {"status": "ok", "received": True}


@router.post(
    "/withings/measurements",
    response_model=BiometricRead,
    status_code=status.HTTP_201_CREATED,
    summary="Ingest body metrics from Withings Body Smart scale",
)
def ingest_withings_measurement(
    payload: WithingsMeasurementPayload,
    db: Session = Depends(get_db),
    _: None = Depends(verify_webhook_token),
) -> BiometricMeasurement:
    """Ingests scale measurements: weight, body fat %, muscle mass, hydration, bone mass."""
    measurement = BiometricMeasurement(
        id=uuid.uuid4(),
        measured_at=payload.measured_at,
        source="withings",
        weight_kg=payload.weight_kg,
        body_fat_pct=payload.body_fat_pct,
        muscle_mass_kg=payload.muscle_mass_kg,
        water_pct=payload.water_pct,
        bone_mass_kg=payload.bone_mass_kg,
        resting_hr_bpm=payload.resting_hr_bpm,
        notes=payload.notes,
        extra=payload.extra,
    )
    db.add(measurement)
    db.commit()
    db.refresh(measurement)
    return measurement


# ----------------------------------------------------------------- Query / Reads
@router.get(
    "/biometrics/latest",
    response_model=BiometricRead | None,
    summary="Fetch the latest recorded biometric measurement for briefings and habits",
)
def get_latest_biometrics(
    source: str | None = None,
    db: Session = Depends(get_db),
) -> BiometricMeasurement | None:
    """Returns the most recent biometric reading, optionally filtered by source."""
    query = (
        select(BiometricMeasurement)
        .where(BiometricMeasurement.deleted_at.is_(None))
        .order_by(BiometricMeasurement.measured_at.desc())
        .limit(1)
    )
    if source:
        query = query.where(BiometricMeasurement.source == source)

    return db.scalar(query)


@router.get(
    "/biometrics",
    response_model=list[BiometricRead],
    summary="Fetch paginated biometric measurement history",
)
def list_biometrics(
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    source: str | None = None,
    db: Session = Depends(get_db),
) -> list[BiometricMeasurement]:
    """Returns historical biometric measurements for trend tracking."""
    query = (
        select(BiometricMeasurement)
        .where(BiometricMeasurement.deleted_at.is_(None))
        .order_by(BiometricMeasurement.measured_at.desc())
        .offset(offset)
        .limit(limit)
    )
    if source:
        query = query.where(BiometricMeasurement.source == source)

    return list(db.scalars(query).all())
