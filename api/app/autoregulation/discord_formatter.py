"""Discord #health forum thread formatting and best-effort sync via DiscordPort."""

from __future__ import annotations

import logging

from app.models import FastingRecommendation, WorkoutRecommendation
from app.ports.discord import DiscordPort
from app.schemas import FastingRecommendationRead, WorkoutRecommendationRead

logger = logging.getLogger(__name__)


def format_fasting_thread(
    rec: FastingRecommendationRead,
    target_date: str,
    *,
    user_id: str | None = None,
) -> tuple[str, str]:
    """Build the forum thread title and markdown body for a fasting recommendation."""
    title = f"🌿 Fasting Protocol: {rec.target_window} ({target_date})"[:100]
    anchors_text = (
        "\n".join(f"- {anchor}" for anchor in rec.fueling_anchors)
        if rec.fueling_anchors
        else "- Standard feeding window"
    )
    citation_text = f"\n*Citation*: {rec.research_citation}" if rec.research_citation else ""
    mention = f"<@{user_id}>\n\n" if user_id else ""

    content = (
        f"{mention}"
        f"## 🌿 Circadian Fasting Recommendation ({target_date})\n"
        f"**Target Window**: {rec.target_window} ({rec.window_hours})\n"
        f"**Protocol**: {rec.protocol_name}\n"
        f"**Recovery Status**: {rec.recovery_status.capitalize()}\n"
        f"**Rationale**: {rec.rationale}\n\n"
        f"**Fueling Anchors**:\n{anchors_text}"
        f"{citation_text}\n\n"
        f"---\n"
        f"💬 **Two-Way Adjustment Loop**:\n"
        f"Reply to this thread with adjustments (e.g. \"Shorten fast to 14h due to dinner\"), "
        f"and Saga will autoregulate your protocol via Kratos MCP."
    )
    return title, content


def _format_exercise_line(exercise_name: str, target_sets: int, target_reps: str, suggested_weight_kg: float | None, weight_basis: str, notes: str | None) -> str:
    if suggested_weight_kg is None:
        weight_str = ""
    elif weight_basis == "per_hand":
        weight_str = f" @ {suggested_weight_kg}kg/hand ({suggested_weight_kg}kg per dumbbell)"
    else:
        weight_str = f" @ {suggested_weight_kg}kg"
    notes_str = f" ({notes})" if notes else ""
    return f"- **{exercise_name}**: {target_sets} sets x {target_reps}{weight_str}{notes_str}"


def format_workout_thread(
    rec: WorkoutRecommendationRead,
    target_date: str,
    *,
    user_id: str | None = None,
) -> tuple[str, str]:
    """Build the forum thread title and markdown body for a workout prescription."""
    title = f"⚡ Workout: {rec.routine_name} - {rec.volume_landmark} ({target_date})"[:100]
    exercises_lines = [
        _format_exercise_line(
            ex.exercise_name,
            ex.target_sets,
            ex.target_reps,
            ex.suggested_weight_kg,
            ex.weight_basis,
            ex.notes,
        )
        for ex in rec.exercises
    ]
    exercises_text = (
        "\n".join(exercises_lines) if exercises_lines else "- Rest or active recovery"
    )
    citation_text = f"\n*Citation*: {rec.research_citation}" if rec.research_citation else ""
    mention = f"<@{user_id}>\n\n" if user_id else ""

    content = (
        f"{mention}"
        f"## ⚡ Autoregulated Workout Prescription ({target_date})\n"
        f"**Routine**: {rec.routine_name}\n"
        f"**Volume Landmark**: {rec.volume_landmark} | **Target**: {rec.target_rir}\n"
        f"**Readiness Adaptation**: {rec.readiness_adaptation} (Recovery: {rec.recovery_status.capitalize()})\n"
        f"**Rationale**: {rec.rationale}\n\n"
        f"**Prescribed Exercises**:\n{exercises_text}"
        f"{citation_text}\n\n"
        f"---\n"
        f"💬 **Two-Way Adjustment Loop**:\n"
        f"Reply to this thread with adjustments (e.g. \"Swap Hack Squats for Leg Press due to knee tweak\"), "
        f"and Saga will autoregulate your workout via Kratos MCP."
    )
    return title, content


def format_adjustment_reply(title: str, summary: str, details: str = "") -> str:
    """Format an adjustment confirmation reply for an existing recommendation thread."""
    content = f"## ✅ Recommendation Adjusted: {title}\n\n{summary}"
    if details:
        content += f"\n\n{details}"
    return content


def sync_fasting_discord_thread(
    discord: DiscordPort,
    rec: FastingRecommendationRead,
    date_str: str,
    existing: FastingRecommendation | None,
    custom_context: str | None,
    *,
    channel_id: str | None = None,
) -> str | None:
    """Create or reply to the #health forum thread for a fasting recommendation."""
    if existing and existing.extra and existing.extra.get("discord_thread_id"):
        thread_id = str(existing.extra["discord_thread_id"])
        if custom_context:
            reply = format_adjustment_reply(
                title=f"{rec.target_window} ({rec.window_hours})",
                summary=f"**Protocol**: {rec.protocol_name}\n**Rationale**: {rec.rationale}",
                details=f"**Adjustment Applied**: {custom_context}",
            )
            try:
                if not discord.post_thread_reply(thread_id, reply):
                    logger.warning("Discord fasting adjustment reply was not delivered for thread %s", thread_id)
            except Exception as exc:
                logger.warning("Failed posting fasting adjustment to Discord thread %s: %s", thread_id, exc)
        return thread_id

    try:
        title, content = format_fasting_thread(rec, date_str, user_id=discord.user_id)
        return discord.create_forum_thread(title, content, channel_id=channel_id)
    except Exception as exc:
        logger.warning("Failed creating Discord thread for fasting recommendation: %s", exc)
        return None


def sync_workout_discord_thread(
    discord: DiscordPort,
    rec: WorkoutRecommendationRead,
    date_str: str,
    existing: WorkoutRecommendation | None,
    custom_context: str | None,
    *,
    channel_id: str | None = None,
) -> str | None:
    """Create or reply to the #health forum thread for a workout recommendation."""
    if existing and existing.extra and existing.extra.get("discord_thread_id"):
        thread_id = str(existing.extra["discord_thread_id"])
        if custom_context:
            reply = format_adjustment_reply(
                title=f"{rec.routine_name} ({rec.volume_landmark})",
                summary=(
                    f"**Adaptation**: {rec.readiness_adaptation} | "
                    f"**Target**: {rec.target_rir}\n**Rationale**: {rec.rationale}"
                ),
                details=f"**Adjustment Applied**: {custom_context}",
            )
            try:
                if not discord.post_thread_reply(thread_id, reply):
                    logger.warning("Discord workout adjustment reply was not delivered for thread %s", thread_id)
            except Exception as exc:
                logger.warning("Failed posting workout adjustment to Discord thread %s: %s", thread_id, exc)
        return thread_id

    try:
        title, content = format_workout_thread(rec, date_str, user_id=discord.user_id)
        return discord.create_forum_thread(title, content, channel_id=channel_id)
    except Exception as exc:
        logger.warning("Failed creating Discord thread for workout recommendation: %s", exc)
        return None
