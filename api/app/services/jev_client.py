"""TypeSafe Jev System One decision client for Kratos.

Routes fast, low-latency categorical choices and binary gates via Muninn's
`jev-decision` model on the Docker Swarm overlay network (http://muninn:4000/v1).
"""

from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.request
from typing import Dict, Optional, Tuple

from app.config import settings

logger = logging.getLogger(__name__)

USER_AGENT = "Yggdrasil-Kratos/1.0 (KratosApi)"


def call_jev(
    system_prompt: str,
    user_content: str,
    model: str | None = None,
    timeout: float = 4.0,
) -> Tuple[Optional[str], float]:
    """Invokes Jev System One via Muninn LiteLLM router.

    Returns:
        (verdict_text, duration_seconds)
    """
    model_name = model or settings.jev_model
    endpoint = f"{settings.llm_base_url.rstrip('/')}/chat/completions"
    api_key = settings.llm_api_key

    payload = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        "temperature": 0.0,
    }

    req = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        },
        method="POST",
    )

    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            elapsed = time.time() - t0
            if resp.status == 200:
                body = json.loads(resp.read().decode("utf-8"))
                choices = body.get("choices", [])
                if choices:
                    content = choices[0].get("message", {}).get("content", "").strip()
                    return content, elapsed
    except Exception as exc:
        elapsed = time.time() - t0
        logger.warning("Jev invocation failed (%s) in %.3fs; falling back to deterministic heuristics.", exc, elapsed)
        return None, elapsed

    return None, time.time() - t0


def classify_recovery_state_jev(biometrics: dict | None) -> Optional[str]:
    """Classifies recovery telemetry into an autoregulated volume tier.

    Returns:
        'MAV_OVERLOAD', 'MAINTENANCE', 'MEV_DELOAD', 'ACTIVE_RECOVERY', or None
    """
    if not biometrics:
        return None

    sleep_h = biometrics.get("sleep_duration_hours")
    deep_sleep_h = biometrics.get("sleep_deep_hours")
    hrv = biometrics.get("hrv_ms")
    rhr = biometrics.get("resting_hr_bpm")

    if sleep_h is None and hrv is None and rhr is None:
        return None

    system_prompt = (
        "Classify recovery state into exactly one category: "
        "[MAV_OVERLOAD, MAINTENANCE, MEV_DELOAD, ACTIVE_RECOVERY]. "
        "MAV_OVERLOAD: Optimal sleep >7.5h and high/normal HRV (>45ms). High readiness for volume overload. "
        "MAINTENANCE: Normal baseline sleep (6.5-7.5h) and normal vitals. "
        "MEV_DELOAD: Poor sleep (<6.0h), elevated resting HR, or low HRV (<35ms). Needs fatigue deload. "
        "ACTIVE_RECOVERY: Severe exhaustion (<5.0h sleep), extreme soreness, or rest day."
    )
    user_content = (
        f"Sleep: {sleep_h:.1f}h" if sleep_h is not None else "Sleep: unknown"
    ) + (
        f" ({deep_sleep_h:.1f}h deep)" if deep_sleep_h is not None else ""
    ) + (
        f", HRV: {hrv:.1f}ms" if hrv is not None else ", HRV: unknown"
    ) + (
        f", Resting HR: {rhr}bpm" if rhr is not None else ""
    )

    verdict, _ = call_jev(system_prompt, user_content)
    if verdict in ("MAV_OVERLOAD", "MAINTENANCE", "MEV_DELOAD", "ACTIVE_RECOVERY"):
        return verdict
    return None


def classify_constraints_jev(user_text: str | None) -> Dict[str, str]:
    """Extracts biomechanical joint sparing and time budget constraints from user text.

    Returns:
        {'joint_focus': '...', 'time_budget': '...'}
    """
    if not user_text or not user_text.strip():
        return {"joint_focus": "NOMINAL", "time_budget": "TIME_STANDARD_45M"}

    # 1. Joint sparing
    joint_prompt = (
        "Classify joint sparing need into exactly one category: "
        "[SHOULDER_SPARING, LUMBAR_SPARING, KNEE_SPARING, NOMINAL]. "
        "SHOULDER_SPARING: User mentions shoulder pinch, rotator cuff, or anterior impingement. "
        "LUMBAR_SPARING: User mentions lower back pain, spinal tightness, or deadlift fatigue. "
        "KNEE_SPARING: User mentions knee soreness, patellar friction, or quad tendon tightness. "
        "NOMINAL: No acute joint pain or tendon friction reported."
    )
    joint_verdict, _ = call_jev(joint_prompt, user_text.strip())
    joint_focus = joint_verdict if joint_verdict in ("SHOULDER_SPARING", "LUMBAR_SPARING", "KNEE_SPARING", "NOMINAL") else "NOMINAL"

    # 2. Time budget
    time_prompt = (
        "Classify session time constraint into exactly one category: "
        "[TIME_CRUNCH_30M, TIME_STANDARD_45M, TIME_EXTENDED_60M]. "
        "TIME_CRUNCH_30M: User mentions having only 30-35 mins, rushing, or quick session. "
        "TIME_STANDARD_45M: Standard training session (~45 mins). "
        "TIME_EXTENDED_60M: Full unrestricted training session (>60 mins)."
    )
    time_verdict, _ = call_jev(time_prompt, user_text.strip())
    time_budget = time_verdict if time_verdict in ("TIME_CRUNCH_30M", "TIME_STANDARD_45M", "TIME_EXTENDED_60M") else "TIME_STANDARD_45M"

    return {
        "joint_focus": joint_focus,
        "time_budget": time_budget,
    }


def classify_fasting_window_jev(activity_context: str, biometrics: dict | None) -> Optional[str]:
    """Classifies optimal circadian intermittent fasting window.

    Returns:
        'EVENING_SPORT_16_8', 'STANDARD_16_8', 'GENTLE_14_10', 'DEEP_FAST_18_6', or None
    """
    system_prompt = (
        "Classify daily intermittent fasting window into exactly one category: "
        "[EVENING_SPORT_16_8, STANDARD_16_8, GENTLE_14_10, DEEP_FAST_18_6]. "
        "EVENING_SPORT_16_8: Badminton match play (7-9 PM) scheduled. Shift window later for fueling. "
        "STANDARD_16_8: Lifting or standard athletic day (12:00 PM - 8:00 PM). "
        "GENTLE_14_10: High fatigue, sleep deficit, or elevated cortisol. Gentler window. "
        "DEEP_FAST_18_6: Friday reset or non-axial recovery day."
    )
    sleep_h = biometrics.get("sleep_duration_hours") if biometrics else None
    hrv = biometrics.get("hrv_ms") if biometrics else None

    user_content = f"Activity: {activity_context}. Recovery: Sleep={sleep_h}h, HRV={hrv}ms"
    verdict, _ = call_jev(system_prompt, user_content)
    if verdict in ("EVENING_SPORT_16_8", "STANDARD_16_8", "GENTLE_14_10", "DEEP_FAST_18_6"):
        return verdict
    return None
