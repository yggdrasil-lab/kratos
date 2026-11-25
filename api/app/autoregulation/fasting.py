"""Circadian fasting and nutrient timing engine and LLM synthesizer."""

from __future__ import annotations

import json
import logging
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from app.autoregulation.jev import safe_float, safe_int
from app.autoregulation.readiness import ReadinessAssessment, ReadinessTier, assess_readiness
from app.models import WeeklyPlan
from app.ports.muninn import MuninnPort
from app.schemas import FastingRecommendationRead
from app.training.plan import _match_day_entry, resolve_scheduled_day

logger = logging.getLogger(__name__)

_MORNING_FAST_ANCHOR = "Morning: Clean fast with water, black coffee, or tea until 10:30 AM"
_DEFAULT_LUNCH_ANCHOR = (
    "10:30 AM: Leftovers or eat-out plate triage, protein first, then carbs and sides to satiety"
)
_DINNER_ANCHOR = (
    "Family dinner (done by 8:30 PM): plate triage, protein first, then carbs and sides to satiety"
)
_WHEY_ANCHOR = "Optional: whey protein shake in water or milk as a zero-prep top-up"

FASTING_SYSTEM_PROMPT = """You are an expert circadian sports physiologist and evidence-based nutrition scientist advising an athletic lifter.
Your recommendations are grounded in four scientific pillars:
1. Circadian Time-Restricted Eating (Panda Lab, Salk Institute): Align eating with daylight. End meals 3-4 hours before bedtime to protect nocturnal HRV, deep sleep, and melatonin release.
2. Muscle Protein Synthesis & Distribution (Schoenfeld, Aragon & Phillips): On resistance days, space protein (0.4-0.5 g/kg per meal) across 3-4 meals separated by 3-5 hours. Avoid compressing feedings into <8 hours on heavy lifting days. Place a post-workout recovery feeding within 60-90 minutes.
3. High-Intensity Anaerobic Fueling (Badminton Match Play): Fasted high-intensity court play degrades speed and reaction time. Keep the 14:10 window and add a zero-prep pre-court top-up (whey shake in water or milk) plus post-court protein replenishment.
4. Hormesis & Metabolic Flexibility (Mattson & Longo): Deep fasts (18h or longer) trigger autophagy and AMPK activation; they are allowed ONLY on Friday Rest and Fast days with Green biometrics (HRV at or above personal baseline, low or normal RHR, sleep of 7h or more). Never prescribe an 18h+ fast on any other day, or on Friday when biometrics are not Green.
5. Autoregulation: If HRV is low (<40 ms) or sleep is short (<6.5h), relax the fast to a gentle 14:10 window to prevent compounding cortisol.

Mandatory baseline: the default protocol is 14:10 with a feeding window of 10:30 AM to 8:30 PM for nominal days, resistance training days, rest days and weekends. Do NOT prescribe 16:8 splits or a 12:30 PM window start.

Strict zero-cooking constraint: the athlete does not cook. Family dinner is prepared by relatives around 7:30 PM (finished by 8:30 PM) and lunch is leftovers or eating out. Fueling anchors must ONLY use: (a) morning clean fast (water, black coffee, or tea), (b) plate triage at family meals, leftovers or eat-out (protein first, then carbs and sides to satiety), and (c) optional zero-prep whey protein shakes mixed in water or milk. Never prescribe meal prep, recipes, oats, cooked breakfasts, or any kitchen work. On resistance days prioritize post-workout protein via plate triage or a whey shake.

You must respond ONLY with a valid JSON object matching this exact structure:
{
  "protocol_name": "string (e.g. '14:10 Pre-Court Fueling', '14:10 Parasympathetic Recovery', '18:6 Metabolic Reset' on Friday with Green biometrics only)",
  "target_window": "string (e.g. '14:10'; '18:6' only on Friday with Green biometrics)",
  "window_hours": "string (e.g. '10:30 AM - 8:30 PM')",
  "rationale": "string (1-2 concise sentences explaining the autoregulation rationale based on biometrics and today's schedule)",
  "fueling_anchors": [
    "string (3-4 zero-cooking recommendations, e.g. 'Morning: Clean fast with water, black coffee, or tea until 10:30 AM', '10:30 AM: Plate triage with leftovers or eat-out, protein first then carbs and sides to satiety', 'Family dinner (done by 8:30 PM): plate triage, protein first', 'Optional: whey protein shake in water or milk as a zero-prep top-up')"
  ],
  "recovery_status": "optimal" | "moderate" | "fatigued",
  "activity_context": "string (e.g. 'Badminton Match Play (sport)', 'Upper Body A (resistance)', 'Friday Rest Day')",
  "research_citation": "string (e.g. 'Panda Lab (Circadian TRE) & Schoenfeld (MPS Distribution)')"
}
"""


def _default_rest_name(target_date: date) -> str:
    day_of_week = target_date.weekday()
    if day_of_week in (5, 6):
        return "Weekend Social Baseline"
    if day_of_week == 4:
        return "Rest and Reset"
    return "Rest Day"


def _resolve_fasting_activity(
    target_date: date,
    weekly_plan: WeeklyPlan | None,
    db: Session | None,
) -> tuple[str, str]:
    if db is not None:
        scheduled = resolve_scheduled_day(db, target_date, weekly_plan=weekly_plan)
        activity_name = scheduled.activity_name or _default_rest_name(target_date)
        return scheduled.activity_type, activity_name

    if weekly_plan and weekly_plan.days:
        entry = _match_day_entry(weekly_plan.days, target_date)
        if entry is not None:
            activity_type = entry.get("type", "lift")
            activity_name = entry.get("sessionName") or entry.get("activity") or "Training"
            return activity_type, activity_name

    return "rest", _default_rest_name(target_date)


def _fatigued_fasting_protocol(
    date_str: str,
    activity_type: str,
    activity_name: str,
    readiness: ReadinessAssessment,
) -> FastingRecommendationRead:
    flag_summary = (
        ", ".join(readiness.fatigue_flags)
        if readiness.fatigue_flags
        else "autonomic recovery deficit"
    )
    return FastingRecommendationRead(
        date=date_str,
        protocol_name="14:10 Autoregulated Recovery Split",
        target_window="14:10",
        window_hours="10:30 AM - 8:30 PM",
        rationale=(
            f"High fatigue detected: {flag_summary}. Fasting duration is relaxed to blunt "
            "cortisol, protect lean tissue, and support autonomic rebound."
        ),
        fueling_anchors=[
            _MORNING_FAST_ANCHOR,
            "10:30 AM: Break fast with plate triage: protein first, then carbs and sides to satiety",
            _DINNER_ANCHOR,
            _WHEY_ANCHOR,
        ],
        recovery_status="fatigued",
        activity_context=f"{activity_name} ({activity_type})",
    )


def _sport_fasting_protocol(
    date_str: str,
    activity_name: str,
    tier: ReadinessTier,
) -> FastingRecommendationRead:
    return FastingRecommendationRead(
        date=date_str,
        protocol_name="14:10 Badminton Court Fueling",
        target_window="14:10",
        window_hours="10:30 AM - 8:30 PM",
        rationale=(
            f"Evening court session scheduled ({activity_name}). Standard 14:10 window with a "
            "zero-prep pre-court top-up and post-court protein recovery."
        ),
        fueling_anchors=[
            _MORNING_FAST_ANCHOR,
            _DEFAULT_LUNCH_ANCHOR,
            "05:00 PM: Pre-court top-up, whey protein shake in water or milk (optional)",
            "Post-court or family dinner: plate triage, protein first, then carbs and sides to satiety",
        ],
        recovery_status=tier,
        activity_context=f"{activity_name} (sport)",
    )


def _lift_fasting_protocol(
    date_str: str,
    activity_name: str,
    tier: ReadinessTier,
) -> FastingRecommendationRead:
    return FastingRecommendationRead(
        date=date_str,
        protocol_name="14:10 Strength and Hypertrophy Split",
        target_window="14:10",
        window_hours="10:30 AM - 8:30 PM",
        rationale=(
            f"Resistance training scheduled ({activity_name}). Feeding window opens at 10:30 AM "
            "so post-workout protein is prioritized to maximize muscle protein synthesis."
        ),
        fueling_anchors=[
            _MORNING_FAST_ANCHOR,
            "Post-workout: Plate triage, protein first (40-45g), then carbs and sides to satiety",
            _DINNER_ANCHOR,
            _WHEY_ANCHOR,
        ],
        recovery_status=tier,
        activity_context=f"{activity_name} (lift)",
    )


def _weekend_fasting_protocol(
    date_str: str,
    activity_name: str,
    tier: ReadinessTier,
) -> FastingRecommendationRead:
    return FastingRecommendationRead(
        date=date_str,
        protocol_name="14:10 Social Baseline",
        target_window="14:10",
        window_hours="10:30 AM - 8:30 PM",
        rationale=(
            "Weekend schedule. Flexible feeding window prioritizing mindful portions "
            "and family meals while maintaining circadian metabolic consistency."
        ),
        fueling_anchors=[
            _MORNING_FAST_ANCHOR,
            _DEFAULT_LUNCH_ANCHOR,
            _DINNER_ANCHOR,
            _WHEY_ANCHOR,
        ],
        recovery_status=tier,
        activity_context=f"{activity_name} (weekend)",
    )


def _friday_reset_protocol(
    date_str: str,
    activity_name: str,
    tier: ReadinessTier,
) -> FastingRecommendationRead:
    return FastingRecommendationRead(
        date=date_str,
        protocol_name="18:6 Deep Metabolic Reset",
        target_window="18:6",
        window_hours="3:30 PM - 8:30 PM",
        rationale=(
            f"Friday rest day with {tier} autonomic recovery. Extended fasting window "
            "promotes deep fat oxidation and cellular autophagy without training interference."
        ),
        fueling_anchors=[
            "Morning: Clean fast with water, black coffee, or tea (add electrolytes if desired)",
            "03:30 PM: Break fast with plate triage, protein first, or a whey shake in water or milk",
            _DINNER_ANCHOR,
        ],
        recovery_status=tier,
        activity_context=f"{activity_name} (rest)",
    )


def _rest_baseline_protocol(
    date_str: str,
    activity_name: str,
    tier: ReadinessTier,
) -> FastingRecommendationRead:
    return FastingRecommendationRead(
        date=date_str,
        protocol_name="14:10 Rest Day Baseline",
        target_window="14:10",
        window_hours="10:30 AM - 8:30 PM",
        rationale=(
            f"Rest day with {tier} autonomic recovery. Standard 14:10 baseline; "
            "18h+ fasts are reserved for Friday rest days with optimal recovery."
        ),
        fueling_anchors=[
            _MORNING_FAST_ANCHOR,
            _DEFAULT_LUNCH_ANCHOR,
            _DINNER_ANCHOR,
            _WHEY_ANCHOR,
        ],
        recovery_status=tier,
        activity_context=f"{activity_name} (rest)",
    )


def generate_fasting_recommendation(
    target_date: date,
    weekly_plan: WeeklyPlan | None = None,
    biometrics: dict[str, Any] | None = None,
    db: Session | None = None,
    *,
    muninn: MuninnPort | None = None,
    readiness: ReadinessAssessment | None = None,
) -> FastingRecommendationRead:
    """Compute a deterministic autoregulated fasting protocol and fueling anchors."""
    day_of_week = target_date.weekday()
    date_str = target_date.isoformat()
    activity_type, activity_name = _resolve_fasting_activity(target_date, weekly_plan, db)
    assessment = readiness or assess_readiness(biometrics, muninn=muninn)
    tier = assessment.tier

    if tier == "fatigued":
        return _fatigued_fasting_protocol(date_str, activity_type, activity_name, assessment)
    is_badminton = "badminton" in activity_name.lower() or (
        activity_type == "sport" and day_of_week in (1, 3)
    )
    if activity_type == "sport" or is_badminton:
        return _sport_fasting_protocol(date_str, activity_name, tier)
    if activity_type == "lift":
        return _lift_fasting_protocol(date_str, activity_name, tier)
    if day_of_week in (5, 6):
        return _weekend_fasting_protocol(date_str, activity_name, tier)
    if day_of_week == 4 and tier == "optimal":
        return _friday_reset_protocol(date_str, activity_name, tier)
    return _rest_baseline_protocol(date_str, activity_name, tier)


def _build_fasting_llm_context(
    target_date: date,
    activity_name: str,
    activity_type: str,
    biometrics: dict[str, Any] | None,
    recent_feedback: list[dict[str, Any]] | None,
    custom_context: str | None,
) -> dict[str, Any]:
    bio = biometrics or {}
    return {
        "date": target_date.isoformat(),
        "day_of_week": target_date.strftime("%A"),
        "scheduled_activity": {"name": activity_name, "type": activity_type},
        "biometrics": {
            "hrv_ms": safe_float(bio.get("hrv_ms")),
            "sleep_duration_hours": safe_float(bio.get("sleep_duration_hours")),
            "sleep_deep_hours": safe_float(bio.get("sleep_deep_hours")),
            "resting_hr_bpm": safe_int(bio.get("resting_hr_bpm")),
            "weight_kg": safe_float(bio.get("latest_weight_kg")),
        },
        "recent_feedback": recent_feedback or [],
        "user_custom_instructions": custom_context
        or "None provided. Synthesize optimal daily schedule.",
    }


def _parse_fasting_llm_response(
    data: dict[str, Any],
    target_date: date,
    activity_name: str,
    fallback_tier: ReadinessTier,
) -> FastingRecommendationRead | None:
    if not data or not any(key in data for key in ("protocol_name", "target_window", "rationale")):
        return None
    raw_status = data.get("recovery_status")
    recovery_status: ReadinessTier = (
        raw_status if raw_status in ("optimal", "moderate", "fatigued") else fallback_tier
    )
    return FastingRecommendationRead(
        date=target_date.isoformat(),
        protocol_name=str(data.get("protocol_name") or "14:10 Autoregulated Protocol"),
        target_window=str(data.get("target_window") or "14:10"),
        window_hours=str(data.get("window_hours") or "10:30 AM - 8:30 PM"),
        rationale=str(
            data.get("rationale") or "Autoregulated based on current biometrics and schedule."
        ),
        fueling_anchors=[str(a) for a in (data.get("fueling_anchors") or [])],
        recovery_status=recovery_status,
        activity_context=str(data.get("activity_context") or activity_name),
        is_llm_generated=True,
        research_citation=str(
            data.get("research_citation")
            or "Panda Lab (Circadian TRE) & Schoenfeld (MPS Distribution)"
        ),
    )


def synthesize_fasting_recommendation(
    target_date: date,
    weekly_plan: WeeklyPlan | None = None,
    biometrics: dict[str, Any] | None = None,
    recent_feedback: list[dict[str, Any]] | None = None,
    custom_context: str | None = None,
    db: Session | None = None,
    *,
    muninn: MuninnPort | None = None,
) -> FastingRecommendationRead:
    """Synthesize fasting protocol via MuninnPort, falling back cleanly to deterministic engine."""
    activity_type, activity_name = _resolve_fasting_activity(target_date, weekly_plan, db)
    readiness = assess_readiness(biometrics, muninn=muninn, custom_context=custom_context)

    if muninn is not None:
        context_payload = _build_fasting_llm_context(
            target_date,
            activity_name,
            activity_type,
            biometrics,
            recent_feedback,
            custom_context,
        )
        user_prompt = (
            "Synthesize today's fasting and nutrient timing protocol based on this athlete context:\n"
            f"{json.dumps(context_payload, indent=2)}"
        )
        try:
            content_data = muninn.synthesize_json(FASTING_SYSTEM_PROMPT, user_prompt)
            parsed = _parse_fasting_llm_response(
                content_data, target_date, activity_name, readiness.tier
            )
            if parsed is not None:
                return parsed
        except Exception as exc:
            logger.warning(
                "LLM fasting synthesis failed (%s); falling back to deterministic engine", exc
            )

    baseline = generate_fasting_recommendation(
        target_date,
        weekly_plan,
        biometrics,
        db=db,
        readiness=readiness,
    )
    baseline.is_llm_generated = False
    baseline.research_citation = "Deterministic Baseline Engine"
    return baseline
