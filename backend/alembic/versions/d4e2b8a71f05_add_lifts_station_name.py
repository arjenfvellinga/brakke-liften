"""add station_name to lifts

Revision ID: d4e2b8a71f05
Revises: c1a7f4b9e2d3
Create Date: 2026-08-26 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from stations import station_names

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4e2b8a71f05"
down_revision: str | Sequence[str] | None = "c1a7f4b9e2d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "lifts", sa.Column("station_name", sa.String(length=255), nullable=True)
    )
    # Backfill from the same mapping the sync uses, so existing rows carry a
    # name immediately instead of staying null until the next cron run.
    op.get_bind().execute(
        sa.text("UPDATE lifts SET station_name = :name WHERE station_code = :code"),
        [{"code": code, "name": name} for code, name in station_names().items()],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("lifts", "station_name")
