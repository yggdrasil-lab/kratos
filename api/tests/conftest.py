"""Test fixtures.

A real PostgreSQL server, not SQLite: the value of this schema is in its views,
its `jsonb` escape hatch, and its constraints, and a substitute verifies none of
them.

`pgserver` ships its own Postgres binaries, so the suite needs no running service
and no system install. Set `KRATOS_TEST_DATABASE_URL` to use an existing instance
instead.
"""

import os
import tempfile
from collections.abc import Iterator

import pgserver
import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

API_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@pytest.fixture(scope="session")
def database_url() -> Iterator[str]:
    """A migrated Postgres, either the one in the environment or a throwaway."""
    external = os.environ.get("KRATOS_TEST_DATABASE_URL")
    if external:
        yield external
        return

    pgdata = tempfile.mkdtemp(prefix="kratos-test-pg-")
    server = pgserver.get_server(pgdata, cleanup_mode="delete")
    try:
        # pgserver speaks over a unix socket; psycopg needs the explicit driver.
        url = server.get_uri().replace("postgresql://", "postgresql+psycopg://", 1)
        os.environ["KRATOS_DATABASE_URL"] = url

        config = Config(os.path.join(API_DIR, "alembic.ini"))
        config.set_main_option("script_location", os.path.join(API_DIR, "alembic"))
        config.set_main_option("sqlalchemy.url", url)
        command.upgrade(config, "head")
        yield url
    finally:
        server.cleanup()


@pytest.fixture(scope="session")
def engine(database_url: str):
    return create_engine(database_url, future=True)


@pytest.fixture(autouse=True)
def _clean_database(engine) -> Iterator[None]:
    """Truncate before every test, so no test sees another's rows.

    Both the ORM fixtures and the HTTP fixture write to the same database.
    """
    with engine.begin() as connection:
        connection.execute(
            text(
                "truncate set_entry, session_item, session, routine_item, routine, exercise "
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
def client(engine, monkeypatch) -> Iterator[TestClient]:
    """A TestClient whose request sessions come from the test engine."""
    from app import db as db_module
    from app.main import app

    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    monkeypatch.setattr(db_module, "SessionLocal", factory)

    def override() -> Iterator[Session]:
        session = factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[db_module.get_db] = override
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
