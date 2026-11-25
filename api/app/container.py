"""Kratos composition root wiring settings, peer ports, session factory, and domain cores."""

from __future__ import annotations

import threading
from collections.abc import Callable
from dataclasses import dataclass, field

from fastapi import Request
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db import SessionLocal
from app.ports.clock import AucklandClockAdapter, ClockPort
from app.ports.discord import DiscordConfig, DiscordPort, HttpDiscordAdapter
from app.ports.eir import EirConfig, EirPort, HttpEirAdapter
from app.ports.muninn import HttpMuninnAdapter, MuninnConfig, MuninnPort
from app.training import TrainingCore

SessionFactory = Callable[[], Session]


@dataclass(frozen=True)
class KratosContainer:
    """Immutable dependency container attached to FastAPI app.state."""

    settings: Settings
    clock: ClockPort
    eir: EirPort
    muninn: MuninnPort
    discord: DiscordPort
    session_factory: SessionFactory
    training: TrainingCore
    workout_date_locks: dict[str, threading.Lock] = field(default_factory=dict)
    fasting_date_locks: dict[str, threading.Lock] = field(default_factory=dict)
    _lock_mutex: threading.Lock = field(default_factory=threading.Lock)

    def get_workout_lock(self, date_key: str) -> threading.Lock:
        return self._get_or_create_lock(self.workout_date_locks, date_key)

    def get_fasting_lock(self, date_key: str) -> threading.Lock:
        return self._get_or_create_lock(self.fasting_date_locks, date_key)

    def _get_or_create_lock(
        self, store: dict[str, threading.Lock], date_key: str
    ) -> threading.Lock:
        with self._lock_mutex:
            lock = store.get(date_key)
            if lock is None:
                lock = threading.Lock()
                store[date_key] = lock
            return lock


def build_container(
    settings_obj: Settings | None = None,
    *,
    clock: ClockPort | None = None,
    eir: EirPort | None = None,
    muninn: MuninnPort | None = None,
    discord: DiscordPort | None = None,
    session_factory: SessionFactory | None = None,
    training: TrainingCore | None = None,
) -> KratosContainer:
    """Build a KratosContainer with production defaults or injected test adapters."""
    resolved_settings = settings_obj if settings_obj is not None else get_settings()
    resolved_clock = clock if clock is not None else AucklandClockAdapter()
    resolved_eir = (
        eir
        if eir is not None
        else HttpEirAdapter(EirConfig(base_url=resolved_settings.eir_internal_url))
    )
    resolved_muninn = (
        muninn
        if muninn is not None
        else HttpMuninnAdapter(
            MuninnConfig(
                base_url=resolved_settings.llm_base_url,
                api_key=resolved_settings.llm_api_key,
                llm_model=resolved_settings.llm_model,
                jev_model=resolved_settings.jev_model,
            )
        )
    )
    resolved_discord = (
        discord
        if discord is not None
        else HttpDiscordAdapter(
            DiscordConfig(
                bot_token=resolved_settings.discord_bot_token,
                health_channel_id=resolved_settings.discord_health_channel_id,
                user_id=resolved_settings.discord_user_id,
            )
        )
    )
    resolved_session_factory = session_factory if session_factory is not None else SessionLocal
    resolved_training = training if training is not None else TrainingCore(eir=resolved_eir)
    return KratosContainer(
        settings=resolved_settings,
        clock=resolved_clock,
        eir=resolved_eir,
        muninn=resolved_muninn,
        discord=resolved_discord,
        session_factory=resolved_session_factory,
        training=resolved_training,
    )


def get_container(request: Request) -> KratosContainer:
    """FastAPI dependency returning the active KratosContainer or failing loudly."""
    container = getattr(request.app.state, "container", None)
    if not isinstance(container, KratosContainer):
        raise RuntimeError("KratosContainer is not initialized on app.state.container")
    return container
