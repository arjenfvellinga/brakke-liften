"""add attempted_at to sync_state

Revision ID: e9d3c7a5b214
Revises: b7c2e5a91d38
Create Date: 2026-08-27 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e9d3c7a5b214"
down_revision: str | Sequence[str] | None = "b7c2e5a91d38"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "sync_state",
        sa.Column("attempted_at", sa.DateTime(timezone=True), nullable=True),
    )
    # The row now appears as soon as a sync is *attempted*, so it can exist
    # without a successful sync behind it.
    op.alter_column(
        "sync_state",
        "synced_at",
        existing_type=sa.DateTime(timezone=True),
        nullable=True,
    )
    # Every sync that got as far as writing synced_at was also an attempt;
    # without this the first request after deploy would read "never attempted"
    # and re-sync data that is in fact fresh.
    op.get_bind().execute(
        sa.text(
            "UPDATE sync_state SET attempted_at = synced_at WHERE synced_at IS NOT NULL"
        )
    )


def downgrade() -> None:
    """Downgrade schema."""
    # A row recording only a failed attempt has no synced_at to keep, and the
    # pre-migration schema cannot represent it.
    op.get_bind().execute(sa.text("DELETE FROM sync_state WHERE synced_at IS NULL"))
    op.alter_column(
        "sync_state",
        "synced_at",
        existing_type=sa.DateTime(timezone=True),
        nullable=False,
    )
    op.drop_column("sync_state", "attempted_at")
