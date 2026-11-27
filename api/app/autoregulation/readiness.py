"""Unified Readiness Tier evaluator shared by biometrics and workout engines."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from app.autoregulation.jev import classify_recovery_state, safe_float, safe_int
from app.ports.muninn import MuninnPort

ReadinessTier = Literal["optimal", "moderate", "fatigued"]

_TIER_COPY: dict[ReadinessTier, tuple[str, str]] = {
    "fatigued": (
        "Low Recovery",
        "Low recovery telemetry detected. Recommend volume scaling or posture mobility.",
    ),
    "moderate": (
        "Moderate Fatigue",
        "Moderate recovery. Keep form tight and cap intensity around RPE 7-8.",
    ),
    "optimal": (
        "High Readiness",
        "Optimal state. Prime day to push progressive overload and PRs.",
    ),
}

_JEV_TO_TIER: dict[str, ReadinessTier] = {
    "MEV_DELOAD": "fatigued",
    "ACTIVE_RECOVERY": "fatigued",
    "MAINTENANCE": "moderate",
    "MAV_OVERLOAD": "optimal",
}


@dataclass(frozen=True)
class ReadinessAssessment:
    """Authoritative daily readiness summary shared across all Kratos surfaces."""

    tier: ReadinessTier
    label: str
    message: str
    fatigue_flags: tuple[str, ...] = ()

    def to_public_dict(self) -> dict[str, str]:
        """Serialize the additive readiness object for GET /biometrics/today."""
        return {
            "tier": self.tier,
            "label": self.label,
            "message": self.message,
        }


def _collect_fatigue_flags(
    sleep_h: float | None,
    deep_h: float | None,
    hrv: float | None,
    rhr: int | None,
) -> tuple[str, ...]:
    flags: list[str] = []
    if sleep_h is not None and sleep_h < 5.8:
        flags.append(f"short sleep ({sleep_h:.1f}h)")
    if deep_h is not None and deep_h < 0.6:
        flags.append(f"low deep sleep ({deep_h:.1f}h)")
    if hrv is not None and hrv < 30.0:
        flags.append(f"suppressed HRV ({round(hrv)}ms)")
    if rhr is not None and rhr >= 78:
        flags.append(f"elevated RHR ({rhr} bpm)")
    return tuple(flags)


def _deterministic_tier(
    sleep_h: float | None,
    hrv: float | None,
    fatigue_flags: tuple[str, ...],
) -> ReadinessTier:
    if (
        (sleep_h is not None and sleep_h < 5.5)
        or (hrv is not None and hrv < 35.0)
        or len(fatigue_flags) >= 2
    ):
        return "fatigued"
    if (
        (sleep_h is not None and sleep_h < 6.8)
        or (hrv is not None and hrv < 45.0)
        or len(fatigue_flags) == 1
    ):
        return "moderate"
    return "optimal"


def _build_assessment(
    tier: ReadinessTier,
    fatigue_flags: tuple[str, ...],
) -> ReadinessAssessment:
    label, message = _TIER_COPY[tier]
    return ReadinessAssessment(
        tier=tier,
        label=label,
        message=message,
        fatigue_flags=fatigue_flags,
    )


def assess_readiness(
    biometrics: dict[str, Any] | None,
    *,
    muninn: MuninnPort | None = None,
    custom_context: str | None = None,
) -> ReadinessAssessment:
    """Evaluate unified ReadinessAssessment with optional Jev classification and deterministic fallback."""
    bio = biometrics or {}
    sleep_h = safe_float(bio.get("sleep_duration_hours"))
    deep_h = safe_float(bio.get("sleep_deep_hours"))
    hrv = safe_float(bio.get("hrv_ms"))
    rhr = safe_int(bio.get("resting_hr_bpm"))

    fatigue_flags = _collect_fatigue_flags(sleep_h, deep_h, hrv, rhr)
    tier = _deterministic_tier(sleep_h, hrv, fatigue_flags)

    if muninn is not None and (biometrics or (custom_context and custom_context.strip())):
        jev_verdict = classify_recovery_state(
            muninn,
            biometrics,
            custom_context=custom_context,
        )
        if jev_verdict in _JEV_TO_TIER:
            tier = _JEV_TO_TIER[jev_verdict]

    return _build_assessment(tier, fatigue_flags)
