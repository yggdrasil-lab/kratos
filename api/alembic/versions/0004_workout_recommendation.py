"""Add workout_recommendation table for autoregulated training recommendations.

Revision ID: 0004_workout_recommendation
Revises: 0003_fasting_recommendation
Create Date: 2026-11-06
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0004_workout_recommendation"
down_revision: str | None = "0003_fasting_recommendation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "workout_recommendation",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("date", sa.Text, nullable=False, unique=True),
        sa.Column("routine_name", sa.Text, nullable=False),
        sa.Column("readiness_adaptation", sa.Text, nullable=False),
        sa.Column("target_rir", sa.Text, nullable=False),
        sa.Column("volume_landmark", sa.Text, nullable=False),
        sa.Column("rationale", sa.Text, nullable=False),
        sa.Column("exercises", postgresql.JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("recovery_status", sa.Text, nullable=False),
        sa.Column("research_citation", sa.Text, nullable=True),
        sa.Column("custom_context", sa.Text, nullable=True),
        sa.Column("is_llm_generated", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("extra", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    op.create_index(
        "workout_recommendation_date_alive_idx",
        "workout_recommendation",
        ["date"],
        postgresql_where=sa.text("deleted_at is null"),
    )


def downgrade() -> None:
    op.drop_index("workout_recommendation_date_alive_idx", table_name="workout_recommendation")
    op.drop_table("workout_recommendation")
