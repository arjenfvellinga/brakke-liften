"""SQLAlchemy models. `Base.metadata` is what alembic autogenerates against."""

from datetime import date, datetime
from enum import StrEnum

from sqlalchemy import CheckConstraint, Date, DateTime, Enum, String, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class LiftOpen(StrEnum):
    """`open` upstream: the current availability of the lift."""

    YES = "Yes"
    NO = "No"
    UNKNOWN = "Unknown"


class SyncState(Base):
    """When the stored lift data was last synced. Exactly one row.

    Kept as its own table rather than derived from the `lifts` rows: `created_at`
    only reflects an insert, and the sync deliberately leaves it alone when
    refreshing an existing lift, so a stable table would report a months-old
    sync.
    """

    __tablename__ = "sync_state"

    # Pinned to 1 by a CHECK constraint: with a known primary key the sync can
    # upsert the row without first checking whether it exists, and the table
    # cannot accumulate a second, contradictory answer. autoincrement=False so
    # this is a plain integer column and no sequence is created for it.
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=False, default=1)
    # When the stored lifts were read from the NS API, stamped by the sync right
    # after the fetch returns — that is the age a consumer cares about, not when
    # the write happened to commit. Null until a sync has actually stored data:
    # the row is created by the first *attempt*, which may fail.
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # When a sync was last started, committed before the fetch so it survives a
    # failure — or a serverless invocation that is killed mid-fetch. That is
    # what lets the request-triggered sync back off instead of re-attempting a
    # broken upstream on every request. Within one successful sync it sits just
    # before synced_at, by however long the fetch took.
    attempted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (CheckConstraint("id = 1", name="sync_state_single_row"),)


class Lift(Base):
    """A lift at an NS station.

    Mirrors `StationFacilityLocationResponseV1` from the NS Places API
    (`GET /places-api/v1/stationfacility/lifts`), so a row and an upstream
    record hold the same fields under the same names.
    """

    __tablename__ = "lifts"

    # The upstream lift id (from the Epiap XML), e.g.
    # "NL:CHB:LiftEquipment:8400280_001". Used as the primary key so rows can be
    # matched back to the API without keeping a second identifier around.
    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    # Constant upstream ("stationfacility" / "lift"), but stored so a row
    # round-trips to the same payload the API returns.
    type: Mapped[str] = mapped_column(String(64), default="stationfacility")
    identifier: Mapped[str] = mapped_column(String(64), default="lift")
    name: Mapped[str] = mapped_column(String(255))
    station_code: Mapped[str] = mapped_column(String(16), index=True)
    # Not upstream: the human-readable station name, resolved from
    # `stations.json` at sync time so the API can label a lift without every
    # consumer having to carry its own station_code lookup. Nullable because a
    # code the file does not know about (a new or foreign station) still yields
    # a perfectly valid lift row.
    station_name: Mapped[str | None] = mapped_column(String(255))
    # Optional upstream: lat/lng, and platform where the lift has no platform.
    lat: Mapped[float | None]
    lng: Mapped[float | None]
    # native_enum=False + values_callable stores the API's own casing ("Yes") in
    # a VARCHAR with a CHECK constraint, rather than a Postgres ENUM type — so
    # adding a value later is an ordinary migration.
    open: Mapped[LiftOpen] = mapped_column(
        Enum(
            LiftOpen,
            name="lift_open",
            native_enum=False,
            length=7,
            create_constraint=True,
            values_callable=lambda enum: [member.value for member in enum],
        )
    )
    # Language-dependent upstream (nl/en), so a free-form string, not an enum.
    status_label: Mapped[str] = mapped_column(String(64))
    platform: Mapped[str | None] = mapped_column(String(32))
    # Set by the database, not the app, so rows inserted outside a session
    # (migrations, manual SQL) still get a timestamp.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    def as_dict(self) -> dict:
        # camelCase keys to match the upstream Places API payload.
        return {
            "id": self.id,
            "type": self.type,
            "identifier": self.identifier,
            "name": self.name,
            "stationCode": self.station_code,
            "stationName": self.station_name,
            "lat": self.lat,
            "lng": self.lng,
            "open": self.open.value,
            "statusLabel": self.status_label,
            "platform": self.platform,
            "createdAt": self.created_at.isoformat(),
        }


class LiftDay(Base):
    """One lift's state on one calendar day, as recorded by the daily cron.

    Dense on purpose: a row is written for every lift on every day the cron
    manages to record, so the *absence* of a row means "nobody looked", which is
    a different answer from "the lift was fine". That distinction cannot be
    recovered afterwards — `ns.sync_lifts` deletes rows for lifts that vanish
    from the NS feed and re-inserts them if they come back, so a table holding
    only the days something was wrong would read a lift's six-week absence as
    six weeks of perfect uptime. At ~1000 lifts that costs ~60 MB a year, which
    buys the one property every figure on the lift page rests on.

    Written by the cron and nothing else. `ns.sync_lifts` deliberately does not
    touch this table: it runs on demand, many times a day on a busy day and once
    on a quiet one, and a history whose resolution depends on traffic is not a
    history. One row per lift per day, whoever happened to be looking.
    """

    __tablename__ = "lift_day"

    # Matches Lift.id in type and length, but deliberately *not* by foreign key.
    # sync_lifts deletes lifts that disappear upstream: an FK would either block
    # that delete — killing every sync, and every request that triggers one — or,
    # with ON DELETE CASCADE, silently destroy the whole history of a lift that
    # blinked out of the feed for a single day. The history is an independent
    # append-only log keyed by the upstream id, and it outlives the lift.
    lift_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    # The Europe/Amsterdam calendar day, not UTC and not the database's
    # current_date: "buiten dienst sinds 4 september" has to mean the day a Dutch
    # reader would name, wherever this runs. Second half of the primary key, so
    # "this lift, the last 90 days" is one index range scan and the daily write
    # is an idempotent upsert on the pair.
    #
    # Indexed on its own as well, for the other direction — "every lift, one
    # day", which the cron's aggregate runs. The primary key cannot serve that
    # one, since observed_on is its second column.
    observed_on: Mapped[date] = mapped_column(Date, primary_key=True, index=True)
    # Configured exactly like Lift.open, for the same reason: the API's own
    # casing in a VARCHAR with a CHECK rather than a Postgres ENUM, so a new
    # upstream value stays an ordinary migration. Sharing the `lift_open` name
    # with the lifts table is fine — a CHECK constraint name only has to be
    # unique within its table.
    open: Mapped[LiftOpen] = mapped_column(
        Enum(
            LiftOpen,
            name="lift_open",
            native_enum=False,
            length=7,
            create_constraint=True,
            values_callable=lambda enum: [member.value for member in enum],
        )
    )
    # Only stored when `open` is not Yes. The available label is the same string
    # for every working lift on every day, and at a thousand rows a day that one
    # column would be a quarter of the table; the labels that ever get read back
    # are the ones describing an outage. Null therefore means "the ordinary
    # available label", not "unknown".
    status_label: Mapped[str | None] = mapped_column(String(64))
    # When the row was last written, which is not the day it describes: a retried
    # or hand-triggered cron overwrites the day, and this is the only way to see
    # that afterwards. Server-side default so a row inserted by hand still
    # carries one.
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
