"""LLM Circadian Fasting & Fueling Synthesizer for Kratos.

Grounded in peer-reviewed exercise physiology and circadian biology:
1. Circadian Time-Restricted Eating (Dr. Satchin Panda, Salk Institute):
   Synchronize feeding with daylight hours. Finish food intake 3-4 hours prior to bedtime
   to permit core body temperature drop, gastrointestinal rest, and nocturnal parasympathetic tone (HRV).
2. Muscle Protein Synthesis (MPS) & Nutrient Timing (Dr. Brad Schoenfeld, Alan Aragon, Stuart Phillips):
   Target refractory MPS stimulation with 0.4-0.5 g/kg protein per meal across 3-4 feedings separated by 3-5h.
   Avoid extreme fasting windows (>16h) that compress protein feedings on heavy lifting days. Include a post-workout
   protein anchor within 60-90 minutes.
3. Anaerobic Sport Fueling Kinetics (Badminton Match Play):
   High-intensity explosive rallies rely on glycogen stores. Shift the feeding window to ensure a sustained
   carbohydrate and electrolyte feeding 2-3 hours pre-match and immediate post-match amino acid recovery.
4. Metabolic Flexibility & Autophagy (Dr. Mark Mattson, Valter Longo):
   Confine extended fasting (18:6 or 20:4) to low-strain rest/reset days (e.g. Friday rest).
5. Biometric Recovery Autoregulation:
   If sleep is compromised (<6.5h) or HRV is depressed (<40 ms), systemic physiological stress is already high;
   relax protocol to a gentle 14:10 recovery window.
"""

from datetime import date
import json
import logging
import urllib.error
import urllib.request

from app.config import settings
from app.models import WeeklyPlan
from app.schemas import FastingRecommendationRead
from app.services.fasting_engine import generate_fasting_recommendation

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are an expert circadian sports physiologist and evidence-based nutrition scientist advising an athletic lifter.
Your recommendations are grounded in four scientific pillars:
1. Circadian Time-Restricted Eating (Panda Lab, Salk Institute): Align eating with daylight. End meals 3-4 hours before bedtime to protect nocturnal HRV, deep sleep, and melatonin release.
2. Muscle Protein Synthesis & Distribution (Schoenfeld, Aragon & Phillips): On resistance days, space protein (0.4-0.5 g/kg per meal) across 3-4 meals separated by 3-5 hours. Avoid compressing feedings into <8 hours on heavy lifting days. Place a post-workout recovery feeding within 60-90 minutes.
3. High-Intensity Anaerobic Fueling (Badminton Match Play): Fasted high-intensity court play degrades speed and reaction time. Shift eating window later to provide pre-court fuel (complex carbs + electrolytes 2-3h prior) and post-court amino acid replenishment.
4. Hormesis & Metabolic Flexibility (Mattson & Longo): Deep fasts (18:6) trigger autophagy and AMPK activation; restrict them strictly to low-strain recovery days (e.g. Friday reset).
5. Autoregulation: If HRV is low (<40 ms) or sleep is short (<6.5h), relax the fast to a gentle 14:10 window to prevent compounding cortisol.

You must respond ONLY with a valid JSON object matching this exact structure:
{
  "protocol_name": "string (e.g. '16:8 Pre-Court Fueling', '14:10 Parasympathetic Recovery', '18:6 Metabolic Reset')",
  "target_window": "string (e.g. '16:8', '14:10', '18:6')",
  "window_hours": "string (e.g. '12:30 PM - 8:30 PM')",
  "rationale": "string (1-2 concise sentences explaining the autoregulation rationale based on biometrics and today's schedule)",
  "fueling_anchors": [
    "string (3 specific timed recommendations with macros/electrolytes, e.g. '12:30 PM: Balanced lunch with 40g protein and complex carbs', '05:00 PM: Pre-court fuel (banana, oats, electrolytes)', '09:00 PM: Post-court recovery shake (close window by 9:30 PM)')"
  ],
  "recovery_status": "optimal" | "moderate" | "fatigued",
  "activity_context": "string (e.g. 'Badminton Match Play (sport)', 'Upper Body A (resistance)', 'Friday Rest Day')",
  "research_citation": "string (e.g. 'Panda Lab (Circadian TRE) & Schoenfeld (MPS Distribution)')"
}
"""


def synthesize_fasting_recommendation_llm(
    target_date: date,
    weekly_plan: WeeklyPlan | None,
    biometrics: dict | None,
    recent_feedback: list[dict] | None = None,
    custom_context: str | None = None,
) -> FastingRecommendationRead:
    """Synthesizes a research-grounded, adaptive fasting recommendation via LLM, falling back to deterministic baseline if unavailable."""
    # 1. Determine scheduled workout from plan
    weekday_name = target_date.strftime("%a")
    activity_name = "Rest Day"
    activity_type = "rest"

    if weekly_plan and weekly_plan.days:
        for day in weekly_plan.days:
            if day.get("day") == weekday_name:
                activity_name = day.get("activity", "Rest Day")
                activity_type = day.get("type", "rest")
                break

    # 2. Extract biometrics summary
    hrv = biometrics.get("hrv_ms") if biometrics else None
    sleep_h = biometrics.get("sleep_duration_hours") if biometrics else None
    deep_sleep_h = biometrics.get("sleep_deep_hours") if biometrics else None
    rhr = biometrics.get("resting_hr_bpm") if biometrics else None
    weight_kg = biometrics.get("latest_weight_kg") if biometrics else None

    # Construct user context payload
    context_payload = {
        "date": target_date.isoformat(),
        "day_of_week": target_date.strftime("%A"),
        "scheduled_activity": {
            "name": activity_name,
            "type": activity_type,
        },
        "biometrics": {
            "hrv_ms": hrv,
            "sleep_duration_hours": sleep_h,
            "sleep_deep_hours": deep_sleep_h,
            "resting_hr_bpm": rhr,
            "weight_kg": weight_kg,
        },
        "recent_feedback": recent_feedback or [],
        "user_custom_instructions": custom_context or "None provided. Synthesize optimal daily schedule.",
    }

    # 3. Call LiteLLM endpoint
    url = f"{settings.llm_base_url.rstrip('/')}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {settings.llm_api_key}",
        "User-Agent": "Kratos-Fasting-Synthesizer/1.0",
    }
    body = {
        "model": settings.llm_model,
        "response_format": {"type": "json_object"},
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"Synthesize today's fasting and nutrient timing protocol based on this athlete context:\n{json.dumps(context_payload, indent=2)}",
            },
        ],
    }

    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=12.0) as resp:
            if resp.status == 200:
                resp_json = json.loads(resp.read().decode("utf-8"))
                choices = resp_json.get("choices", [])
                if choices:
                    content_str = choices[0].get("message", {}).get("content", "")
                    content_data = json.loads(content_str)
                    return FastingRecommendationRead(
                        date=target_date.isoformat(),
                        protocol_name=content_data.get("protocol_name", "16:8 Autoregulated Protocol"),
                        target_window=content_data.get("target_window", "16:8"),
                        window_hours=content_data.get("window_hours", "12:00 PM - 8:00 PM"),
                        rationale=content_data.get("rationale", "Autoregulated based on current biometrics and schedule."),
                        fueling_anchors=content_data.get("fueling_anchors", []),
                        recovery_status=content_data.get("recovery_status", "optimal"),
                        activity_context=content_data.get("activity_context", activity_name),
                        is_llm_generated=True,
                        research_citation=content_data.get(
                            "research_citation",
                            "Panda Lab (Circadian TRE) & Schoenfeld (MPS Distribution)",
                        ),
                    )
    except Exception as exc:
        logger.warning("LLM fasting synthesis failed or timed out (%s); falling back to deterministic engine", exc)

    # Fallback to Tier 1 deterministic engine
    baseline = generate_fasting_recommendation(target_date, weekly_plan, biometrics)
    baseline.is_llm_generated = False
    baseline.research_citation = "Deterministic Baseline Engine"
    return baseline
