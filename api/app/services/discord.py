"""Discord notification service for Kratos recommendations and thread lifecycle."""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from typing import Any

from app.config import settings
from app.schemas import FastingRecommendationRead, WorkoutRecommendationRead

logger = logging.getLogger(__name__)

USER_AGENT = "Yggdrasil-Kratos/1.0 (DiscordBot)"
HTTP_TIMEOUT_SECONDS = 4.0


def _get_auth_headers(bot_token: str | None = None) -> dict[str, str]:
    headers = {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
    }
    token = bot_token or settings.discord_bot_token
    if token:
        headers["Authorization"] = f"Bot {token}"
    return headers


def post_fasting_recommendation_thread(
    rec: FastingRecommendationRead,
    target_date: str,
    channel_id: str | None = None,
    webhook_url: str | None = None,
    user_id: str | None = None,
) -> str | None:
    """Publishes a fasting recommendation thread to the Discord #health forum channel."""
    resolved_channel = channel_id or settings.discord_health_channel_id
    resolved_webhook = webhook_url or settings.discord_webhook_url
    resolved_user = user_id or settings.discord_user_id

    if not resolved_channel and not resolved_webhook:
        logger.info("Discord integration not configured; skipping fasting thread creation")
        return None

    title = f"🌿 Fasting Protocol: {rec.target_window} ({target_date})"[:100]

    anchors_text = "\n".join(f"- {anchor}" for anchor in rec.fueling_anchors) if rec.fueling_anchors else "- Standard feeding window"
    citation_text = f"\n*Citation*: {rec.research_citation}" if rec.research_citation else ""
    mention = f"<@{resolved_user}>\n\n" if resolved_user else ""

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

    return _create_forum_thread(
        title=title,
        content=content,
        channel_id=resolved_channel,
        webhook_url=resolved_webhook,
    )


def post_workout_recommendation_thread(
    rec: WorkoutRecommendationRead,
    target_date: str,
    channel_id: str | None = None,
    webhook_url: str | None = None,
    user_id: str | None = None,
) -> str | None:
    """Publishes an autoregulated workout recommendation thread to the Discord #health forum channel."""
    resolved_channel = channel_id or settings.discord_health_channel_id
    resolved_webhook = webhook_url or settings.discord_webhook_url
    resolved_user = user_id or settings.discord_user_id

    if not resolved_channel and not resolved_webhook:
        logger.info("Discord integration not configured; skipping workout thread creation")
        return None

    title = f"⚡ Workout: {rec.routine_name} - {rec.volume_landmark} ({target_date})"[:100]

    exercises_lines: list[str] = []
    for ex in rec.exercises:
        weight_str = f" @ {ex.suggested_weight_kg}kg" if ex.suggested_weight_kg is not None else ""
        notes_str = f" ({ex.notes})" if ex.notes else ""
        exercises_lines.append(f"- **{ex.exercise_name}**: {ex.target_sets} sets x {ex.target_reps}{weight_str}{notes_str}")
    exercises_text = "\n".join(exercises_lines) if exercises_lines else "- Rest or active recovery"

    citation_text = f"\n*Citation*: {rec.research_citation}" if rec.research_citation else ""
    mention = f"<@{resolved_user}>\n\n" if resolved_user else ""

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

    return _create_forum_thread(
        title=title,
        content=content,
        channel_id=resolved_channel,
        webhook_url=resolved_webhook,
    )


def post_thread_adjustment_reply(
    thread_id: str,
    title: str,
    summary: str,
    details: str = "",
    webhook_url: str | None = None,
) -> bool:
    """Posts an adjustment confirmation reply into an existing Discord recommendation thread."""
    if not thread_id:
        return False

    content = f"## ✅ Recommendation Adjusted: {title}\n\n{summary}"
    if details:
        content += f"\n\n{details}"

    resolved_webhook = webhook_url or settings.discord_webhook_url
    bot_token = settings.discord_bot_token

    payload = json.dumps({"content": content[:4000]}).encode("utf-8")

    # Prefer bot token if present
    if bot_token:
        url = f"https://discord.com/api/v10/channels/{thread_id}/messages"
        headers = _get_auth_headers(bot_token)
        req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_SECONDS):
                logger.info("Successfully posted adjustment reply to thread %s via bot token", thread_id)
                return True
        except Exception as exc:
            logger.warning("Failed posting adjustment reply to thread %s via bot token: %s", thread_id, exc)

    # Fallback to webhook if available
    if resolved_webhook:
        url = f"{resolved_webhook}?thread_id={thread_id}&wait=true"
        headers = {"Content-Type": "application/json", "User-Agent": USER_AGENT}
        req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_SECONDS):
                logger.info("Successfully posted adjustment reply to thread %s via webhook", thread_id)
                return True
        except Exception as exc:
            logger.warning("Failed posting adjustment reply to thread %s via webhook: %s", thread_id, exc)

    return False


def _create_forum_thread(
    title: str,
    content: str,
    channel_id: str | None,
    webhook_url: str | None,
) -> str | None:
    bot_token = settings.discord_bot_token

    # 1. Bot token channel thread creation (Discord Forum Channel type 15)
    if bot_token and channel_id:
        url = f"https://discord.com/api/v10/channels/{channel_id}/threads"
        headers = _get_auth_headers(bot_token)
        payload = json.dumps({
            "name": title[:100],
            "message": {"content": content[:4000]},
        }).encode("utf-8")

        req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_SECONDS) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                thread_id = str(data.get("id"))
                logger.info("Successfully created Discord forum thread %s ('%s')", thread_id, title)
                return thread_id
        except Exception as exc:
            logger.warning("Discord API bot token thread creation failed: %s", exc)

    # 2. Webhook forum thread creation
    if webhook_url:
        url = f"{webhook_url}?wait=true"
        headers = {"Content-Type": "application/json", "User-Agent": USER_AGENT}
        payload = json.dumps({
            "thread_name": title[:100],
            "content": content[:4000],
        }).encode("utf-8")

        req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_SECONDS) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                # Discord returns channel_id for threads created via forum channel webhooks
                thread_id = str(data.get("channel_id") or data.get("id"))
                logger.info("Successfully created Discord thread %s via webhook ('%s')", thread_id, title)
                return thread_id
        except Exception as exc:
            logger.warning("Discord webhook thread creation failed: %s", exc)

    return None
