"""Test fixtures.

A real PostgreSQL server, not SQLite: the value of this schema is in its views,
its `jsonb` escape hatch, and its constraints, and a substitute verifies none of
them.

`pgserver` ships its own Postgres binaries, so the suite needs no running service
and no system install. Set `KRATOS_TEST_DATABASE_URL` to use an existing instance
instead (such as the Postgres 16 service container in CI).
"""

from __future__ import annotations

import os
import tempfile
from collections.abc import Callable, Iterator
from dataclasses import dataclass

import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from tests.fakes import (
    FakeClock,
    InMemoryDiscordAdapter,
    InMemoryEirAdapter,
    InMemoryMuninnAdapter,
)

API_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@dataclass(frozen=True)
class FakeAdapters:
    """Bundle of in-memory adapters wired into a test application container."""

    clock: FakeClock
    eir: InMemoryEirAdapter
    muninn: InMemoryMuninnAdapter
    discord: InMemoryDiscordAdapter


def _run_migrations(url: str) -> None:
    os.environ["KRATOS_DATABASE_URL"] = url
    config = Config(os.path.join(API_DIR, "alembic.ini"))
    config.set_main_option("script_location", os.path.join(API_DIR, "alembic"))
    config.set_main_option("sqlalchemy.url", url)
    command.upgrade(config, "head")


@pytest.fixture(scope="session")
def database_url() -> Iterator[str]:
    """A migrated Postgres, either the one in the environment or a throwaway."""
    external = os.environ.get("KRATOS_TEST_DATABASE_URL")
    if external:
        _run_migrations(external)
        yield external
        return

    try:
        import pgserver
    except ModuleNotFoundError:
        raise SystemExit(
            "[FATAL] 'pgserver' is not installed in this environment.\n"
            "On Gaia, Kratos backend tests must run via the containerized test harness:\n"
            "  python3 /opt/atlas/vault/.agents/plugins/court-of-odin/skills/forge-pr-workflow/scripts/run_kratos_unit_tests.py [test-files...]\n"
        ) from None

    pgdata = tempfile.mkdtemp(prefix="kratos-test-pg-")
    server = pgserver.get_server(pgdata, cleanup_mode="delete")
    try:
        # pgserver speaks over a unix socket; psycopg needs the explicit driver.
        url = server.get_uri().replace("postgresql://", "postgresql+psycopg://", 1)
        _run_migrations(url)
        yield url
    finally:
        server.cleanup()


@pytest.fixture(scope="session")
def engine(database_url: str):
    return create_engine(database_url, future=True)


@pytest.fixture(autouse=True)
def _clean_database(engine) -> Iterator[None]:
    """Truncate all 9 tables before every test so no test sees another's rows."""
    with engine.begin() as connection:
        connection.execute(
            text(
                "truncate set_entry, session_item, session, routine_item, routine, "
                "exercise, weekly_plan, fasting_recommendation, workout_recommendation "
                "restart identity cascade"
            )
        )
    yield


@pytest.fixture()
def db(engine) -> Iterator[Session]:
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def fakes() -> FakeAdapters:
    """Fresh deterministic in-memory adapters per test."""
    return FakeAdapters(
        clock=FakeClock(),
        eir=InMemoryEirAdapter(),
        muninn=InMemoryMuninnAdapter(),
        discord=InMemoryDiscordAdapter(),
    )


@pytest.fixture()
def app_factory(engine, fakes: FakeAdapters) -> Callable[..., FastAPI]:
    """Construct an isolated FastAPI app backed by the test Postgres engine and fake adapters."""
    from app import db as db_module
    from app.container import build_container
    from app.main import create_app

    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    created_apps: list[FastAPI] = []

    def override_get_db() -> Iterator[Session]:
        session = factory()
        try:
            yield session
        finally:
            session.close()

    def _build(
        adapters: FakeAdapters | None = None,
        *,
        settings: Settings | None = None,
    ) -> FastAPI:
        chosen = adapters or fakes
        container = build_container(
            settings_obj=settings,
            clock=chosen.clock,
            eir=chosen.eir,
            muninn=chosen.muninn,
            discord=chosen.discord,
            session_factory=factory,
        )
        fastapi_app = create_app(container)
        fastapi_app.dependency_overrides[db_module.get_db] = override_get_db
        created_apps.append(fastapi_app)
        return fastapi_app

    yield _build

    for fastapi_app in created_apps:
        fastapi_app.dependency_overrides.clear()


@pytest.fixture()
def client(app_factory: Callable[..., FastAPI]) -> Iterator[TestClient]:
    """A TestClient whose request sessions come from the test Postgres engine."""
    with TestClient(app_factory(None)) as test_client:
        yield test_client
