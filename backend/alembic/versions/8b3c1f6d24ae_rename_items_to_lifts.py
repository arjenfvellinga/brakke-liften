"""rename items table to lifts

Revision ID: 8b3c1f6d24ae
Revises: 0a5f4960c11b
Create Date: 2026-08-25 00:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "8b3c1f6d24ae"
down_revision: str | Sequence[str] | None = "0a5f4960c11b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.rename_table("items", "lifts")
    # Postgres leaves the pk constraint and identity sequence under their old
    # names after a table rename; rename them too so the schema stays readable.
    op.execute("ALTER INDEX items_pkey RENAME TO lifts_pkey")
    op.execute("ALTER SEQUENCE items_id_seq RENAME TO lifts_id_seq")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("ALTER SEQUENCE lifts_id_seq RENAME TO items_id_seq")
    op.execute("ALTER INDEX lifts_pkey RENAME TO items_pkey")
    op.rename_table("lifts", "items")
