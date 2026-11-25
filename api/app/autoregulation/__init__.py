"""Deep autoregulation package: readiness, Jev gates, fasting, workout, Discord sync, and coordinator."""

from app.autoregulation.coordinator import AutoregulationCore
from app.autoregulation.discord_formatter import (
    format_adjustment_reply,
    format_fasting_thread,
    format_workout_thread,
    sync_fasting_discord_thread,
    sync_workout_discord_thread,
)
from app.autoregulation.fasting import (
    generate_fasting_recommendation,
    synthesize_fasting_recommendation,
)
from app.autoregulation.jev import (
    classify_fasting_window,
    classify_recovery_state,
    classify_workout_decision_gates,
    safe_float,
    safe_int,
)
from app.autoregulation.readiness import ReadinessAssessment, ReadinessTier, assess_readiness
from app.autoregulation.workout import (
    generate_workout_recommendation,
    get_active_exercises,
    get_active_routines,
    get_last_lift_for_exercise,
    get_recent_lift_history,
    get_recent_muscle_volume,
    synthesize_workout_recommendation,
)

__all__ = [
    "AutoregulationCore",
    "ReadinessAssessment",
    "ReadinessTier",
    "assess_readiness",
    "classify_fasting_window",
    "classify_recovery_state",
    "classify_workout_decision_gates",
    "format_adjustment_reply",
    "format_fasting_thread",
    "format_workout_thread",
    "generate_fasting_recommendation",
    "generate_workout_recommendation",
    "get_active_exercises",
    "get_active_routines",
    "get_last_lift_for_exercise",
    "get_recent_lift_history",
    "get_recent_muscle_volume",
    "safe_float",
    "safe_int",
    "sync_fasting_discord_thread",
    "sync_workout_discord_thread",
    "synthesize_fasting_recommendation",
    "synthesize_workout_recommendation",
]
