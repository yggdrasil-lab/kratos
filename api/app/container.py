"""Kratos composition root wiring settings, peer ports, session factory, and domain cores."""

from __future__ import annotations

import threading
from collections.abc import Callable
from dataclasses import dataclass, field

from fastapi import Request
from sqlalchemy.orm import Session

from app.autoregulation import AutoregulationCore
from app.config import Settings, get_settings
from app.db import SessionLocal
from app.ports.clock import AucklandClockAdapter, ClockPort
from app.ports.discord import DiscordConfig, DiscordPort, HttpDiscordAdapter
from app.ports.eir import EirConfig, EirPort, HttpEirAdapter
from app.ports.muninn import HttpMuninnAdapter, MuninnConfig, MuninnPort
from app.training import TrainingCore

SessionFactory = Callable[[], Session]


def _get_or_create_lock(
    mutex: threading.Lock, store: dict[str, threading.Lock], date_key: str
) -> threading.Lock:
    with mutex:
        lock = store.get(date_key)
        if lock is None:
            lock = threading.Lock()
            store[date_key] = lock
        return lock


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
    autoregulation: AutoregulationCore
    workout_date_locks: dict[str, threading.Lock] = field(default_factory=dict)
    fasting_date_locks: dict[str, threading.Lock] = field(default_factory=dict)
    _lock_mutex: threading.Lock = field(default_factory=threading.Lock)

    def get_workout_lock(self, date_key: str) -> threading.Lock:
        return _get_or_create_lock(self._lock_mutex, self.workout_date_locks, date_key)

    def get_fasting_lock(self, date_key: str) -> threading.Lock:
        return _get_or_create_lock(self._lock_mutex, self.fasting_date_locks, date_key)


def _default_muninn(settings_obj: Settings) -> MuninnPort:
    return HttpMuninnAdapter(
        MuninnConfig(
            base_url=settings_obj.llm_base_url,
            api_key=settings_obj.llm_api_key,
            llm_model=settings_obj.llm_model,
            jev_model=settings_obj.jev_model,
        )
    )


def _default_discord(settings_obj: Settings) -> DiscordPort:
    return HttpDiscordAdapter(
        DiscordConfig(
            bot_token=settings_obj.discord_bot_token,
            health_channel_id=settings_obj.discord_health_channel_id,
            user_id=settings_obj.discord_user_id,
        )
    )


def _default_autoregulation(
    clock: ClockPort,
    eir: EirPort,
    muninn: MuninnPort,
    discord: DiscordPort,
    lock_mutex: threading.Lock,
    workout_locks: dict[str, threading.Lock],
    fasting_locks: dict[str, threading.Lock],
) -> AutoregulationCore:
    return AutoregulationCore(
        clock=clock,
        eir=eir,
        muninn=muninn,
        discord=discord,
        get_workout_lock=lambda key: _get_or_create_lock(lock_mutex, workout_locks, key),
        get_fasting_lock=lambda key: _get_or_create_lock(lock_mutex, fasting_locks, key),
    )


def build_container(
    settings_obj: Settings | None = None,
    *,
    clock: ClockPort | None = None,
    eir: EirPort | None = None,
    muninn: MuninnPort | None = None,
    discord: DiscordPort | None = None,
    session_factory: SessionFactory | None = None,
    training: TrainingCore | None = None,
    autoregulation: AutoregulationCore | None = None,
) -> KratosContainer:
    """Build a KratosContainer with production defaults or injected test adapters."""
    resolved_settings = settings_obj if settings_obj is not None else get_settings()
    resolved_clock = clock if clock is not None else AucklandClockAdapter()
    resolved_eir = (
        eir
        if eir is not None
        else HttpEirAdapter(EirConfig(base_url=resolved_settings.eir_internal_url))
    )
    resolved_muninn = muninn if muninn is not None else _default_muninn(resolved_settings)
    resolved_discord = discord if discord is not None else _default_discord(resolved_settings)
    workout_locks: dict[str, threading.Lock] = {}
    fasting_locks: dict[str, threading.Lock] = {}
    lock_mutex = threading.Lock()
    return KratosContainer(
        settings=resolved_settings,
        clock=resolved_clock,
        eir=resolved_eir,
        muninn=resolved_muninn,
        discord=resolved_discord,
        session_factory=session_factory if session_factory is not None else SessionLocal,
        training=training if training is not None else TrainingCore(eir=resolved_eir),
        autoregulation=autoregulation
        or _default_autoregulation(
            resolved_clock,
            resolved_eir,
            resolved_muninn,
            resolved_discord,
            lock_mutex,
            workout_locks,
            fasting_locks,
        ),
        workout_date_locks=workout_locks,
        fasting_date_locks=fasting_locks,
        _lock_mutex=lock_mutex,
    )


def get_container(request: Request) -> KratosContainer:
    """FastAPI dependency returning the active KratosContainer or failing loudly."""
    container = getattr(request.app.state, "container", None)
    if not isinstance(container, KratosContainer):
        raise RuntimeError("KratosContainer is not initialized on app.state.container")
    return container
