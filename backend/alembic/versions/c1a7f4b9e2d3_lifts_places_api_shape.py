"""reshape lifts to the NS Places API stationfacility lift definition

Revision ID: c1a7f4b9e2d3
Revises: 8b3c1f6d24ae
Create Date: 2026-08-26 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c1a7f4b9e2d3"
down_revision: str | Sequence[str] | None = "8b3c1f6d24ae"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# `open` in StationFacilityLocationResponseV1. Declared with create_constraint so
# the CHECK lands in the database, not just in the SQLAlchemy layer.
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
    # The primary key changes from an integer identity to the upstream lift id
    # (e.g. "NL:CHB:LiftEquipment:8400280_001") and every column of the starter
    # shape is gone, so recreate the table rather than alter it. The old rows
    # carry no upstream identity and cannot be migrated forward.
    op.drop_table("lifts")
    op.create_table(
        "lifts",
        sa.Column("id", sa.String(length=255), nullable=False),
        sa.Column("type", sa.String(length=64), nullable=False),
        sa.Column("identifier", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("station_code", sa.String(length=16), nullable=False),
        sa.Column("lat", sa.Float(), nullable=True),
        sa.Column("lng", sa.Float(), nullable=True),
        sa.Column("open", OPEN_ENUM, nullable=False),
        sa.Column("status_label", sa.String(length=64), nullable=False),
        sa.Column("platform", sa.String(length=32), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="lifts_pkey"),
    )
    op.create_index("ix_lifts_station_code", "lifts", ["station_code"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_lifts_station_code", table_name="lifts")
    op.drop_table("lifts")
    # Back to the pre-reshape shape (the renamed starter table).
    op.create_table(
        "lifts",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("value", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="lifts_pkey"),
    )
