"""Muninn LiteLLM peer port for structured LLM synthesis and Jev System One decisions."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable

HttpOpener = Callable[..., Any]


class MuninnUpstreamError(RuntimeError):
    """Raised when a Muninn chat completion or Jev decision request fails."""


@dataclass(frozen=True)
class MuninnConfig:
    """Configuration for the internal Muninn LiteLLM gateway."""

    base_url: str
    api_key: str
    llm_model: str = "app-synthesize"
    jev_model: str = "jev-decision"
    timeout_seconds: float = 12.0
    jev_timeout_seconds: float = 4.0
    user_agent: str = "Yggdrasil-Kratos/1.0 (KratosApi)"

    def __post_init__(self) -> None:
        if not self.base_url or not self.base_url.strip():
            raise ValueError("MuninnConfig.base_url must be non-empty")


@dataclass(frozen=True)
class JevDecisionResult:
    """Typed verdict returned by a Jev decision call."""

    verdict: str
    model: str
    latency_seconds: float


@runtime_checkable
class MuninnPort(Protocol):
    """Peer port for LLM JSON synthesis and Jev System One decision calls."""

    def synthesize_json(
        self,
        system_prompt: str,
        user_content: str,
        *,
        temperature: float = 0.2,
        model: str | None = None,
        timeout: float | None = None,
    ) -> dict[str, Any]: ...

    def decide(
        self,
        system_prompt: str,
        user_content: str,
        *,
        response_format: dict[str, Any] | None = None,
        model: str | None = None,
        timeout: float | None = None,
    ) -> JevDecisionResult: ...


class HttpMuninnAdapter:
    """HTTP adapter calling Muninn's OpenAI-compatible chat completions endpoint."""

    def __init__(
        self,
        config: MuninnConfig,
        *,
        opener: HttpOpener = urllib.request.urlopen,
    ) -> None:
        self._config = config
        self._opener = opener

    def _build_request(
        self,
        *,
        model_name: str,
        system_prompt: str,
        user_content: str,
        temperature: float,
        response_format: dict[str, Any] | None,
    ) -> urllib.request.Request:
        endpoint = f"{self._config.base_url.rstrip('/')}/chat/completions"
        payload: dict[str, Any] = {
            "model": model_name,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            "temperature": temperature,
        }
        if response_format is not None:
            payload["response_format"] = response_format
        return urllib.request.Request(
            endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self._config.api_key}",
                "Content-Type": "application/json",
                "User-Agent": self._config.user_agent,
            },
            method="POST",
        )

    def _extract_choice_content(self, body: dict[str, Any], model_name: str) -> str:
        choices = body.get("choices") or []
        if not choices:
            raise MuninnUpstreamError(f"Muninn returned empty choices for model {model_name}")
        content = choices[0].get("message", {}).get("content", "")
        if not isinstance(content, str) or not content.strip():
            raise MuninnUpstreamError(f"Muninn returned empty content for model {model_name}")
        return content.strip()

    def _post_chat_completion(
        self,
        *,
        model_name: str,
        system_prompt: str,
        user_content: str,
        temperature: float,
        timeout: float,
        response_format: dict[str, Any] | None = None,
    ) -> tuple[str, float]:
        req = self._build_request(
            model_name=model_name,
            system_prompt=system_prompt,
            user_content=user_content,
            temperature=temperature,
            response_format=response_format,
        )
        started = time.monotonic()
        try:
            with self._opener(req, timeout=timeout) as resp:
                elapsed = time.monotonic() - started
                if resp.status != 200:
                    raise MuninnUpstreamError(
                        f"Muninn returned HTTP {resp.status} for model {model_name}"
                    )
                body = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            raise MuninnUpstreamError(f"Muninn HTTP {exc.code} for model {model_name}") from exc
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            raise MuninnUpstreamError(
                f"Muninn request failed for model {model_name}: {exc}"
            ) from exc
        return self._extract_choice_content(body, model_name), elapsed

    def synthesize_json(
        self,
        system_prompt: str,
        user_content: str,
        *,
        temperature: float = 0.2,
        model: str | None = None,
        timeout: float | None = None,
    ) -> dict[str, Any]:
        resolved_model = model or self._config.llm_model
        resolved_timeout = timeout if timeout is not None else self._config.timeout_seconds
        content, _ = self._post_chat_completion(
            model_name=resolved_model,
            system_prompt=system_prompt,
            user_content=user_content,
            temperature=temperature,
            timeout=resolved_timeout,
            response_format={"type": "json_object"},
        )
        try:
            parsed = json.loads(content)
        except json.JSONDecodeError as exc:
            raise MuninnUpstreamError(
                f"Muninn synthesis returned invalid JSON for model {resolved_model}: {exc}"
            ) from exc
        if not isinstance(parsed, dict):
            raise MuninnUpstreamError(
                f"Muninn synthesis expected JSON object, got {type(parsed).__name__}"
            )
        return parsed

    def decide(
        self,
        system_prompt: str,
        user_content: str,
        *,
        response_format: dict[str, Any] | None = None,
        model: str | None = None,
        timeout: float | None = None,
    ) -> JevDecisionResult:
        resolved_model = model or self._config.jev_model
        resolved_timeout = timeout if timeout is not None else self._config.jev_timeout_seconds
        content, elapsed = self._post_chat_completion(
            model_name=resolved_model,
            system_prompt=system_prompt,
            user_content=user_content,
            temperature=0.0,
            timeout=resolved_timeout,
            response_format=response_format,
        )
        return JevDecisionResult(
            verdict=content,
            model=resolved_model,
            latency_seconds=elapsed,
        )
