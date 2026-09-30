"""The migration must produce exactly the specified schema.

This is the spec as an executable check: six tables, four views, no more.
"""

from sqlalchemy import inspect, text

EXPECTED_TABLES = {"exercise", "routine", "routine_item", "session", "session_item", "set_entry"}
EXPECTED_VIEWS = {"v_set", "v_e1rm", "v_session_volume", "v_exercise_last"}


def test_tables_match_spec(engine) -> None:
    inspector = inspect(engine)
    business_tables = set(inspector.get_table_names()) - {"alembic_version"}
    assert business_tables == EXPECTED_TABLES


def test_views_match_spec(engine) -> None:
    with engine.connect() as connection:
        rows = connection.execute(
            text(
                "select table_name from information_schema.views "
                "where table_schema = 'public'"
            )
        )
    assert {row[0] for row in rows} == EXPECTED_VIEWS


def test_every_table_carries_the_standard_tail(engine) -> None:
    """Rule 2: every table has `extra jsonb`, and the timestamp tail."""
    inspector = inspect(engine)
    for table in EXPECTED_TABLES:
        columns = {column["name"] for column in inspector.get_columns(table)}
        assert {"created_at", "updated_at", "deleted_at", "extra"} <= columns, table


def test_keys_are_uuids(engine) -> None:
    """Rule 5: client-generated UUID keys, so an offline row has its ID already."""
    inspector = inspect(engine)
    for table in EXPECTED_TABLES:
        id_column = next(c for c in inspector.get_columns(table) if c["name"] == "id")
        assert id_column["type"].__class__.__name__ == "UUID", table


def test_forward_migration_can_insert_with_no_client_side_defaults(engine) -> None:
    """A row with only its required columns must be insertable."""
    with engine.begin() as connection:
        connection.execute(text("insert into exercise (name) values ('Squat')"))
        row = connection.execute(
            text("select tracking, weight_basis, primary_muscles, extra from exercise")
        ).one()
    assert row.tracking == "reps_weight"
    assert row.weight_basis == "total"
    assert row.primary_muscles == []
    assert row.extra == {}


def test_downgrade_drops_everything(database_url: str) -> None:
    """The migration must reverse cleanly — verified on its own database."""
    import os
    import tempfile

    import pgserver
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import create_engine as make_engine

    api_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    pgdata = tempfile.mkdtemp(prefix="kratos-down-pg-")
    server = pgserver.get_server(pgdata, cleanup_mode="delete")
    try:
        url = server.get_uri().replace("postgresql://", "postgresql+psycopg://", 1)
        config = Config(os.path.join(api_dir, "alembic.ini"))
        config.set_main_option("script_location", os.path.join(api_dir, "alembic"))
        config.set_main_option("sqlalchemy.url", url)
        os.environ["KRATOS_DATABASE_URL"] = url
        command.upgrade(config, "head")
        command.downgrade(config, "base")

        engine = make_engine(url)
        inspector = inspect(engine)
        remaining = set(inspector.get_table_names()) - {"alembic_version"}
    finally:
        server.cleanup()
    assert remaining == set(), remaining
