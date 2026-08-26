"""NS Places API client and the lift sync that feeds the `lifts` table."""

import os

import httpx
from db import load_local_env
from models import Lift, LiftOpen
from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from stations import station_name

LIFTS_URL = "https://gateway.apiportal.ns.nl/places-api/v1/stationfacility/lifts"
# The endpoint rejects anything above 500 and offers no offset/cursor, so 500 is
# also the hard ceiling on what one request can return.
LIFTS_LIMIT = 500
TIMEOUT = 30.0

# Everything except the primary key and created_at: on conflict these are what
# gets refreshed from upstream.
UPDATABLE_COLUMNS = (
    "type",
    "identifier",
    "name",
    "station_code",
    "station_name",
    "lat",
    "lng",
    "open",
    "status_label",
    "platform",
)


def get_api_key() -> str:
    """Return the NS API subscription key."""
    load_local_env()

    key = os.environ.get("NS_API_PRIMARY_KEY")
    if not key:
        raise RuntimeError(
            "NS_API_PRIMARY_KEY is not set. Add it to .env.local at the repo "
            "root (or export it) before syncing lifts."
        )

    return key


async def fetch_lifts() -> list[dict]:
    """Fetch every station lift from the Places API.

    Requested one `status` at a time: the endpoint has no offset or cursor, so a
    single unfiltered call would silently stop at LIFTS_LIMIT rows. Splitting by
    status is the only partitioning it offers, and each subset is far enough
    under the ceiling to leave room to grow.
    """
    headers = {
        "Ocp-Apim-Subscription-Key": get_api_key(),
        # statusLabel is localised; pin it so stored labels stay consistent
        # regardless of who triggers the sync.
        "Accept-Language": "nl",
    }

    lifts: list[dict] = []
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        for status in LiftOpen:
            response = await client.get(
                LIFTS_URL,
                params={"limit": LIFTS_LIMIT, "status": status.value},
                headers=headers,
            )
            response.raise_for_status()
            batch = response.json()

            if len(batch) >= LIFTS_LIMIT:
                # Truncated: proceeding would delete every lift that fell off
                # the end of the page. Better to fail the sync loudly.
                raise RuntimeError(
                    f"status={status.value} returned {len(batch)} lifts, hitting "
                    f"the API's {LIFTS_LIMIT}-row ceiling; the result is "
                    "truncated and cannot be synced safely."
                )

            lifts.extend(batch)

    return lifts


def _as_row(payload: dict) -> dict:
    """Map one StationFacilityLocationResponseV1 object onto Lift columns."""
    try:
        # Upstream declares `open` required, but a value outside the enum would
        # fail the column's CHECK constraint, so fall back rather than break the
        # whole sync over one row.
        status = LiftOpen(payload.get("open"))
    except ValueError:
        status = LiftOpen.UNKNOWN

    return {
        "id": payload["id"],
        "type": payload.get("type") or "stationfacility",
        "identifier": payload.get("identifier") or "lift",
        "name": payload["name"],
        "station_code": payload["stationCode"],
        "station_name": station_name(payload["stationCode"]),
        "lat": payload.get("lat"),
        "lng": payload.get("lng"),
        "open": status,
        "status_label": payload["statusLabel"],
        "platform": payload.get("platform"),
    }


async def sync_lifts(session: AsyncSession) -> dict:
    """Replace the stored lifts with what the Places API currently reports."""
    payload = await fetch_lifts()

    # Dedupe by id: ON CONFLICT cannot touch the same row twice in one statement.
    rows = {row["id"]: row for row in (_as_row(item) for item in payload)}
    if not rows:
        # An empty response is far more likely to be an upstream problem than
        # every NS lift disappearing, so keep what we have.
        return {"fetched": 0, "stored": 0, "removed": 0, "note": "empty response"}

    statement = insert(Lift).values(list(rows.values()))
    await session.execute(
        statement.on_conflict_do_update(
            index_elements=[Lift.id],
            set_={column: statement.excluded[column] for column in UPDATABLE_COLUMNS},
        )
    )
    # Lifts that vanished upstream (decommissioned, re-identified) should not
    # linger as permanently stale rows.
    removed = await session.execute(delete(Lift).where(Lift.id.notin_(rows)))
    await session.commit()

    return {
        "fetched": len(payload),
        "stored": len(rows),
        "removed": removed.rowcount,
    }
