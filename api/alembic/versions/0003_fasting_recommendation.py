"""Add fasting_recommendation table for autoregulated nutrition recommendations.

Revision ID: 0003_fasting_recommendation
Revises: 0002_weekly_plan
Create Date: 2026-11-06
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0003_fasting_recommendation"
down_revision: str | None = "0002_weekly_plan"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "fasting_recommendation",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("date", sa.Text, nullable=False, unique=True),
        sa.Column("protocol_name", sa.Text, nullable=False),
        sa.Column("target_window", sa.Text, nullable=False),
        sa.Column("window_hours", sa.Text, nullable=False),
        sa.Column("rationale", sa.Text, nullable=False),
        sa.Column("fueling_anchors", postgresql.JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("recovery_status", sa.Text, nullable=False),
        sa.Column("activity_context", sa.Text, nullable=False),
        sa.Column("is_llm_generated", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("research_citation", sa.Text, nullable=True),
        sa.Column("custom_context", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("extra", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    op.create_index(
        "fasting_recommendation_date_alive_idx",
        "fasting_recommendation",
        ["date"],
        postgresql_where=sa.text("deleted_at is null"),
    )


def downgrade() -> None:
    op.drop_index("fasting_recommendation_date_alive_idx", table_name="fasting_recommendation")
    op.drop_table("fasting_recommendation")
