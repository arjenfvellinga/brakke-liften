"""create the single-row sync_state table

Revision ID: b7c2e5a91d38
Revises: d4e2b8a71f05
Create Date: 2026-08-27 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7c2e5a91d38"
down_revision: str | Sequence[str] | None = "d4e2b8a71f05"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # No row is seeded: the first sync inserts it, and until then the API
    # correctly reports that the lift data has never been synced.
    op.create_table(
        "sync_state",
        sa.Column("id", sa.Integer(), autoincrement=False, nullable=False),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("id = 1", name="sync_state_single_row"),
        sa.PrimaryKeyConstraint("id", name="sync_state_pkey"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("sync_state")
