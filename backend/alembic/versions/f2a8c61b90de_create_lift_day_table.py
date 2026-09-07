"""create the lift_day daily observation table

Revision ID: f2a8c61b90de
Revises: e9d3c7a5b214
Create Date: 2026-09-07 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f2a8c61b90de"
down_revision: str | Sequence[str] | None = "e9d3c7a5b214"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Spelled out rather than imported from models, the way c1a7f4b9e2d3 does it, so
# this revision keeps describing the schema it created even after the model moves
# on. Same CHECK-constraint-in-a-VARCHAR treatment as `lifts.open`; the shared
# constraint name is fine, since it only has to be unique within its table.
OPEN_ENUM = sa.Enum(
    "Yes",
    "No",
    "Unknown",
    name="lift_open",
    native_enum=False,
    length=7,
    create_constraint=True,
)


def upgrade() -> None:
    """Upgrade schema."""
    # No foreign key to `lifts`, on purpose: sync_lifts deletes rows for lifts
    # that vanish upstream, that delete has to keep working, and the history has
    # to survive it. See the note on LiftDay.lift_id.
    op.create_table(
        "lift_day",
        sa.Column("lift_id", sa.String(length=255), nullable=False),
        sa.Column("observed_on", sa.Date(), nullable=False),
        sa.Column("open", OPEN_ENUM, nullable=False),
        # Null for a working lift; see LiftDay.status_label.
        sa.Column("status_label", sa.String(length=64), nullable=True),
        sa.Column(
            "recorded_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        # (lift_id, observed_on) in this order: the lift page reads one lift over
        # a date range, which is a single range scan under this key, and the
        # daily write upserts on it.
        sa.PrimaryKeyConstraint("lift_id", "observed_on", name="lift_day_pkey"),
    )
    # The other direction: "every lift, one day", which the cron's aggregate runs
    # once a day and any future station rollup would run per request. Without it
    # that query sequentially scans a table which grows by a thousand rows a day
    # and is never pruned.
    op.create_index("ix_lift_day_observed_on", "lift_day", ["observed_on"])

    # No backfill. The Places API has no history, and `lifts.created_at` records
    # when a row was first inserted, not that anyone looked at the lift — filling
    # days in from it would invent measurements nobody took, which is precisely
    # what the dense table exists to prevent. The history starts on the first
    # cron run after this deploys.


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_lift_day_observed_on", table_name="lift_day")
    op.drop_table("lift_day")
