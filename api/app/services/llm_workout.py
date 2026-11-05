"""LLM Autoregulated Workout & Exercise Science Synthesizer for Kratos.

Grounded in peer-reviewed exercise physiology and hypertrophy literature:
1. Volume Landmarks & Fatigue Titration (Dr. Mike Israetel, Renaissance Periodization):
   Scale working sets between MEV (Minimum Effective Volume) and MRV (Maximum Recoverable Volume).
2. Autoregulation & Reps-in-Reserve (Dr. Eric Helms, Brad Schoenfeld, Zourdos):
   Determine target RIR based on sleep debt and HRV deviation.
3. Biomechanics & Joint Sparing (Dr. Stuart McGill, Kelly Starrett):
   Neutral grips, chest support, or joint-sparing substitutions if user reports joint friction or soreness.
4. Concurrent Interference Avoidance (Hickson, Coffey & Hawley):
   Mitigate lower-body damage near badminton match play to preserve court explosiveness.
"""

from datetime import date
import json
import logging
import urllib.error
import urllib.request

from app.config import settings
from app.models import WeeklyPlan
from app.schemas import RecommendedExerciseItem, WorkoutRecommendationRead
from app.services.jev_client import classify_constraints_jev, classify_recovery_state_jev
from app.services.workout_engine import generate_workout_recommendation

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are an expert strength & conditioning coach and hypertrophy scientist advising an athletic lifter.
Your recommendations are grounded in four scientific pillars:
1. Volume Landmarks (Israetel / RP): Scale sets between MEV (Minimum Effective Volume) and MRV (Maximum Recoverable Volume) based on readiness. When fatigued, dial back to MEV.
2. Autoregulation & RIR (Helms / Schoenfeld): Dictate exact Reps-in-Reserve (RIR 1-2 on high recovery, RIR 2-3 on moderate, RIR 3-4 on low recovery).
3. Joint Sparing Biomechanics (McGill / Starrett): If user notes joint discomfort (e.g. shoulder pinching, tight lower back), recommend neutral-grip or chest-supported variations and provide specific tempo/form cues.
4. Concurrent Interference Avoidance (Hickson / Hawley): Near badminton match play, spare the knee extensors and Achilles from heavy eccentric strain.

When 'jev_decision_gates' indicates SHOULDER_SPARING, LUMBAR_SPARING, or KNEE_SPARING, strictly prioritize neutral-grip, chest-supported, or deloaded variations. When TIME_CRUNCH_30M is indicated, limit prescription to 2-3 high-impact exercises.

You must respond ONLY with a valid JSON object matching this exact structure:
{
  "routine_name": "string (e.g. 'Upper Body A (Autoregulated)', 'Rest & Active Mobility', 'Lower Body B')",
  "readiness_adaptation": "string (1-2 sentences on how today's volume and RIR were scaled for biometrics)",
  "target_rir": "string (e.g. 'RIR 1-2', 'RIR 3-4')",
  "volume_landmark": "string (e.g. 'MEV', 'MAV', 'Deload')",
  "rationale": "string (concise explanation synthesizing biometrics, scheduled split, and user input)",
  "exercises": [
    {
      "exercise_name": "string (e.g. 'Dumbbell Bench Press')",
      "target_sets": 2,
      "target_reps": "string (e.g. '8-10 reps')",
      "suggested_weight_kg": 30.0,
      "notes": "string (specific form, tempo, or joint-sparing cue, e.g. 'Controlled 3s eccentric, neutral grip to spare shoulder')"
    }
  ],
  "recovery_status": "optimal" | "moderate" | "fatigued",
  "research_citation": "string (e.g. 'Israetel (Volume Landmarks) & Helms (RIR Autoregulation)')"
}
"""


def synthesize_workout_recommendation_llm(
    target_date: date,
    weekly_plan: WeeklyPlan | None,
    biometrics: dict | None,
    recent_feedback: list[dict] | None = None,
    custom_context: str | None = None,
) -> WorkoutRecommendationRead:
    """Synthesizes an adaptive, research-grounded workout recommendation via LLM, falling back to deterministic baseline if unavailable."""
    weekday_name = target_date.strftime("%a")
    activity_name = "Rest Day"
    activity_type = "rest"

    if weekly_plan and weekly_plan.days:
        for day in weekly_plan.days:
            if day.get("day") == weekday_name:
                activity_name = day.get("activity", "Rest Day")
                activity_type = day.get("type", "rest")
                break

    hrv = biometrics.get("hrv_ms") if biometrics else None
    sleep_h = biometrics.get("sleep_duration_hours") if biometrics else None
    deep_sleep_h = biometrics.get("sleep_deep_hours") if biometrics else None
    rhr = biometrics.get("resting_hr_bpm") if biometrics else None
    weight_kg = biometrics.get("latest_weight_kg") if biometrics else None

    # Fast Jev System One gates for joint sparing, time budget, and recovery tier
    jev_recovery = classify_recovery_state_jev(biometrics)
    jev_gates = classify_constraints_jev(custom_context)

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
        "user_custom_instructions": custom_context or "None provided. Synthesize optimal training session.",
        "jev_decision_gates": {
            "recovery_tier": jev_recovery or "AUTOMATIC",
            "joint_focus": jev_gates.get("joint_focus", "NOMINAL"),
            "time_budget": jev_gates.get("time_budget", "TIME_STANDARD_45M"),
        },
    }

    url = f"{settings.llm_base_url.rstrip('/')}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {settings.llm_api_key}",
        "User-Agent": "Kratos-Workout-Synthesizer/1.0",
    }
    body = {
        "model": settings.llm_model,
        "response_format": {"type": "json_object"},
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"Synthesize today's workout prescription and exercise cues based on athlete context:\n{json.dumps(context_payload, indent=2)}",
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
                    raw_exercises = content_data.get("exercises", [])
                    exercises = [
                        RecommendedExerciseItem(
                            exercise_name=ex.get("exercise_name", "Exercise"),
                            target_sets=int(ex.get("target_sets", 2)),
                            target_reps=str(ex.get("target_reps", "8-10 reps")),
                            suggested_weight_kg=float(ex["suggested_weight_kg"]) if ex.get("suggested_weight_kg") is not None else None,
                            notes=ex.get("notes"),
                        )
                        for ex in raw_exercises
                    ]

                    return WorkoutRecommendationRead(
                        date=target_date.isoformat(),
                        routine_name=content_data.get("routine_name", "Autoregulated Training"),
                        readiness_adaptation=content_data.get("readiness_adaptation", "Autoregulated according to current recovery status."),
                        target_rir=content_data.get("target_rir", "RIR 2"),
                        volume_landmark=content_data.get("volume_landmark", "MAV"),
                        rationale=content_data.get("rationale", "Synthesized from recovery telemetry and scheduled split."),
                        exercises=exercises,
                        recovery_status=content_data.get("recovery_status", "optimal"),
                        research_citation=content_data.get("research_citation", "Israetel (Volume Landmarks) & Helms (RIR Autoregulation)"),
                        is_llm_generated=True,
                    )
    except Exception as exc:
        logger.warning("LLM workout synthesis failed or timed out (%s); falling back to deterministic engine", exc)

    baseline = generate_workout_recommendation(target_date, weekly_plan, biometrics)
    baseline.is_llm_generated = False
    return baseline
