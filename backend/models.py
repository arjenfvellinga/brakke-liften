"""SQLAlchemy models. `Base.metadata` is what alembic autogenerates against."""

from datetime import datetime
from enum import StrEnum

from sqlalchemy import DateTime, Enum, String, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class LiftOpen(StrEnum):
    """`open` upstream: the current availability of the lift."""

    YES = "Yes"
    NO = "No"
    UNKNOWN = "Unknown"


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
            "lat": self.lat,
            "lng": self.lng,
            "open": self.open.value,
            "statusLabel": self.status_label,
            "platform": self.platform,
            "createdAt": self.created_at.isoformat(),
        }
