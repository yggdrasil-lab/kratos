"""TypeSafe Jev System One helpers routed through MuninnPort.decide."""

from __future__ import annotations

import json
import logging
from typing import Any

from app.ports.muninn import MuninnPort

logger = logging.getLogger(__name__)

RECOVERY_STATES = (
    "MAV_OVERLOAD",
    "MAINTENANCE",
    "MEV_DELOAD",
    "ACTIVE_RECOVERY",
)
JOINT_FOCUS_STATES = (
    "SHOULDER_SPARING",
    "LUMBAR_SPARING",
    "KNEE_SPARING",
    "NOMINAL",
)
TIME_BUDGET_STATES = (
    "TIME_CRUNCH_30M",
    "TIME_STANDARD_45M",
    "TIME_EXTENDED_60M",
)

WORKOUT_GATES_SCHEMA: dict[str, Any] = {
    "questions": {
        "recovery_tier": {
            "type": "choice",
            "criteria": {
                "MAV_OVERLOAD": "Optimal sleep >7.5h and high/normal HRV (>45ms). High readiness for volume overload.",
                "MAINTENANCE": "Normal baseline sleep (6.5-7.5h) and normal vitals.",
                "MEV_DELOAD": "Poor sleep (<6.0h), elevated resting HR, or low HRV (<35ms). Needs fatigue deload.",
                "ACTIVE_RECOVERY": "Severe exhaustion (<5.0h sleep), extreme soreness, or rest day.",
            },
        },
        "joint_focus": {
            "type": "choice",
            "criteria": {
                "SHOULDER_SPARING": "User mentions shoulder pinch, rotator cuff, or anterior impingement.",
                "LUMBAR_SPARING": "User mentions lower back pain, spinal tightness, or deadlift fatigue.",
                "KNEE_SPARING": "User mentions knee soreness, patellar friction, or quad tendon tightness.",
                "NOMINAL": "No acute joint pain or tendon friction reported.",
            },
        },
        "time_budget": {
            "type": "choice",
            "criteria": {
                "TIME_CRUNCH_30M": "User mentions having only 30-35 mins, rushing, or quick session.",
                "TIME_STANDARD_45M": "Standard training session (~45 mins).",
                "TIME_EXTENDED_60M": "Full unrestricted training session (>60 mins).",
            },
        },
    }
}

_RECOVERY_SYSTEM_PROMPT = (
    "Classify recovery state into exactly one category: "
    "[MAV_OVERLOAD, MAINTENANCE, MEV_DELOAD, ACTIVE_RECOVERY]. "
    "MAV_OVERLOAD: Optimal sleep >7.5h and high/normal HRV (>45ms). High readiness for volume overload. "
    "MAINTENANCE: Normal baseline sleep (6.5-7.5h) and normal vitals. "
    "MEV_DELOAD: Poor sleep (<6.0h), elevated resting HR, or low HRV (<35ms). Needs fatigue deload. "
    "ACTIVE_RECOVERY: Severe exhaustion (<5.0h sleep), extreme soreness, or rest day."
)

def safe_float(val: object) -> float | None:
    """Parse numeric values from mixed telemetry dicts without raising."""
    if val is None or isinstance(val, bool):
        return None
    try:
        return float(val)  # type: ignore[arg-type]
    except (ValueError, TypeError):
        return None


def safe_int(val: object) -> int | None:
    """Parse integer values from mixed telemetry dicts without raising."""
    if val is None or isinstance(val, bool):
        return None
    try:
        return int(float(val))  # type: ignore[arg-type]
    except (ValueError, TypeError):
        return None


def format_biometric_summary(biometrics: dict[str, Any] | None) -> tuple[str, bool]:
    """Render compact wearable vitals for Jev prompts and flag whether vitals exist."""
    if not biometrics:
        return "Biometrics: unavailable", False

    sleep_h = safe_float(biometrics.get("sleep_duration_hours"))
    deep_h = safe_float(biometrics.get("sleep_deep_hours"))
    hrv = safe_float(biometrics.get("hrv_ms"))
    rhr = safe_int(biometrics.get("resting_hr_bpm"))

    if sleep_h is None and hrv is None and rhr is None:
        return "Biometrics: unavailable", False

    parts: list[str] = []
    if sleep_h is not None:
        deep_part = f" ({deep_h:.1f}h deep)" if deep_h is not None else ""
        parts.append(f"Sleep: {sleep_h:.1f}h{deep_part}")
    if hrv is not None:
        parts.append(f"HRV: {hrv:.1f}ms")
    if rhr is not None:
        parts.append(f"Resting HR: {rhr}bpm")
    return ", ".join(parts), True


def classify_workout_decision_gates(
    muninn: MuninnPort,
    biometrics: dict[str, Any] | None,
    user_text: str | None = None,
) -> dict[str, str]:
    """Evaluate recovery_tier, joint_focus, and time_budget in one batched Jev call."""
    gates = {
        "recovery_tier": "MAINTENANCE",
        "joint_focus": "NOMINAL",
        "time_budget": "TIME_STANDARD_45M",
    }
    bio_summary, _ = format_biometric_summary(biometrics)
    user_summary = user_text.strip() if user_text and user_text.strip() else "User notes: None"
    system_prompt = (
        "Evaluate athlete readiness and constraints:\n"
        f"```json\n{json.dumps(WORKOUT_GATES_SCHEMA)}\n```"
    )
    user_content = f"{bio_summary}\nAthlete notes: {user_summary}"

    try:
        result = muninn.decide(
            system_prompt,
            user_content,
            response_format={"type": "json_object"},
        )
        parsed = json.loads(result.verdict) if result.verdict else {}
    except Exception as exc:
        logger.warning("Jev decision gates failed (%s); falling back to defaults", exc)
        return gates

    if isinstance(parsed, dict):
        if parsed.get("recovery_tier") in RECOVERY_STATES:
            gates["recovery_tier"] = parsed["recovery_tier"]
        if parsed.get("joint_focus") in JOINT_FOCUS_STATES:
            gates["joint_focus"] = parsed["joint_focus"]
        if parsed.get("time_budget") in TIME_BUDGET_STATES:
            gates["time_budget"] = parsed["time_budget"]
    return gates


def classify_recovery_state(
    muninn: MuninnPort,
    biometrics: dict[str, Any] | None,
    *,
    custom_context: str | None = None,
) -> str | None:
    """Classify wearable recovery telemetry into an autoregulation volume tier via Jev."""
    bio_summary, has_vitals = format_biometric_summary(biometrics)
    notes = custom_context.strip() if custom_context and custom_context.strip() else None
    if not has_vitals and notes is None:
        return None

    user_content = bio_summary if notes is None else f"{bio_summary}\nAthlete notes: {notes}"
    try:
        result = muninn.decide(_RECOVERY_SYSTEM_PROMPT, user_content)
    except Exception as exc:
        logger.warning("Jev recovery classification failed (%s); falling back", exc)
        return None

    verdict = result.verdict.strip()
    return verdict if verdict in RECOVERY_STATES else None
