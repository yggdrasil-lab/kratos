"""Discord peer port and HTTP adapter for forum thread creation and replies."""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable

logger = logging.getLogger(__name__)

HttpOpener = Callable[..., Any]
DISCORD_USER_AGENT = "Yggdrasil-Kratos/1.0 (DiscordBot)"


@dataclass(frozen=True)
class DiscordConfig:
    """Configuration for Discord #health forum thread publishing."""

    bot_token: str | None = None
    health_channel_id: str | None = None
    user_id: str | None = None
    timeout_seconds: float = 4.0
    user_agent: str = DISCORD_USER_AGENT
    api_base_url: str = "https://discord.com/api/v10"


@runtime_checkable
class DiscordPort(Protocol):
    """Peer port for best-effort Discord recommendation thread publishing."""

    @property
    def user_id(self) -> str | None: ...

    def create_forum_thread(
        self,
        title: str,
        content: str,
        *,
        channel_id: str | None = None,
    ) -> str | None: ...

    def post_thread_reply(self, thread_id: str, content: str) -> bool: ...


def chunk_discord_content(content: str, limit: int = 1900) -> list[str]:
    """Split a long Discord message along paragraph, line, or word boundaries."""
    if len(content) <= limit:
        return [content]
    chunks: list[str] = []
    remaining = content
    while len(remaining) > limit:
        split_idx = max(
            remaining.rfind("\n\n", 0, limit),
            remaining.rfind("\n", 0, limit),
            remaining.rfind(" ", 0, limit),
        )
        cut = split_idx if split_idx != -1 else limit
        chunks.append(remaining[:cut].rstrip())
        remaining = remaining[cut:].lstrip()
    if remaining:
        chunks.append(remaining)
    return chunks


class HttpDiscordAdapter:
    """Discord REST v10 adapter using custom Yggdrasil User-Agent headers."""

    def __init__(
        self,
        config: DiscordConfig,
        *,
        opener: HttpOpener = urllib.request.urlopen,
    ) -> None:
        self._config = config
        self._opener = opener

    @property
    def user_id(self) -> str | None:
        return self._config.user_id

    def _headers(self) -> dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "User-Agent": self._config.user_agent,
        }
        if self._config.bot_token:
            headers["Authorization"] = f"Bot {self._config.bot_token}"
        return headers

    def _find_existing_active_thread(self, title: str, channel_id: str) -> str | None:
        url = f"{self._config.api_base_url.rstrip('/')}/channels/{channel_id}/threads/active"
        req = urllib.request.Request(url, headers=self._headers(), method="GET")
        try:
            with self._opener(req, timeout=self._config.timeout_seconds) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except Exception as exc:
            logger.warning("Discord active threads lookup failed: %s", exc)
            return None

        target_name = title[:100].strip()
        for thread in data.get("threads", []):
            if str(thread.get("name", "")).strip() == target_name:
                thread_id = str(thread.get("id"))
                logger.info("Reusing active Discord thread %s (%s)", thread_id, target_name)
                return thread_id
        return None

    def _post_followup_chunks(self, thread_id: str, chunks: list[str]) -> None:
        url = f"{self._config.api_base_url.rstrip('/')}/channels/{thread_id}/messages"
        for chunk in chunks:
            payload = json.dumps({"content": chunk}).encode("utf-8")
            req = urllib.request.Request(
                url, data=payload, headers=self._headers(), method="POST"
            )
            try:
                with self._opener(req, timeout=self._config.timeout_seconds):
                    pass
            except Exception as exc:
                logger.warning(
                    "Failed posting follow-up chunk to thread %s: %s", thread_id, exc
                )

    def create_forum_thread(
        self,
        title: str,
        content: str,
        *,
        channel_id: str | None = None,
    ) -> str | None:
        target_channel = channel_id or self._config.health_channel_id
        if not target_channel or not self._config.bot_token:
            logger.info("Discord integration not configured; skipping thread creation")
            return None

        existing_id = self._find_existing_active_thread(title, target_channel)
        if existing_id:
            return existing_id

        chunks = chunk_discord_content(content, limit=1900)
        starter = chunks[0] if chunks else ""
        url = f"{self._config.api_base_url.rstrip('/')}/channels/{target_channel}/threads"
        payload = json.dumps(
            {"name": title[:100], "message": {"content": starter}}
        ).encode("utf-8")
        req = urllib.request.Request(
            url, data=payload, headers=self._headers(), method="POST"
        )
        try:
            with self._opener(req, timeout=self._config.timeout_seconds) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            err_body = exc.read().decode("utf-8", errors="replace") if hasattr(exc, "read") else ""
            logger.warning("Discord thread creation failed: %s (%s)", exc, err_body)
            return None
        except Exception as exc:
            logger.warning("Discord thread creation failed: %s", exc)
            return None

        thread_id = str(data.get("id"))
        self._post_followup_chunks(thread_id, chunks[1:])
        return thread_id

    def post_thread_reply(self, thread_id: str, content: str) -> bool:
        if not thread_id or not self._config.bot_token:
            logger.warning(
                "Discord bot token or thread_id missing; skipping reply to %s", thread_id
            )
            return False

        url = f"{self._config.api_base_url.rstrip('/')}/channels/{thread_id}/messages"
        payload = json.dumps({"content": content[:4000]}).encode("utf-8")
        req = urllib.request.Request(
            url, data=payload, headers=self._headers(), method="POST"
        )
        try:
            with self._opener(req, timeout=self._config.timeout_seconds):
                return True
        except Exception as exc:
            logger.warning("Discord reply failed for thread %s: %s", thread_id, exc)
            return False
