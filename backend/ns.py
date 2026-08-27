"""NS Places API client and the lift sync that feeds the `lifts` table."""

import logging
import os
from datetime import UTC, datetime, timedelta

import httpx
from db import load_local_env
from models import Lift, LiftOpen, SyncState
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from stations import station_name

logger = logging.getLogger(__name__)

LIFTS_URL = "https://gateway.apiportal.ns.nl/places-api/v1/stationfacility/lifts"
# The endpoint rejects anything above 500 and offers no offset/cursor, so 500 is
# also the hard ceiling on what one request can return.
LIFTS_LIMIT = 500
TIMEOUT = 30.0

# How old the stored lifts may get before a request refreshes them. The Vercel
# cron can only fire once a day on the free plan, so requests carry the rest of
# the schedule (see sync_if_stale).
MAX_AGE = timedelta(minutes=15)

# How long a started sync suppresses further attempts. Covers both a sync still
# in flight and one that failed: shorter than MAX_AGE so a transient NS error
# recovers well before the data is noticeably old, long enough that a sustained
# outage is not re-attempted by every single request.
RETRY_AFTER = timedelta(minutes=2)

# Advisory lock claimed by the request that does a stale-triggered sync. The
# value is arbitrary but must be the same everywhere, otherwise two concurrent
# requests take different locks and both hit the NS API.
SYNC_LOCK_KEY = 8_400_280

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


async def record_attempt(session: AsyncSession) -> datetime:
    """Stamp `attempted_at` and commit it, before anything can go wrong.

    Committed on its own so it outlives a failed fetch — including one whose
    invocation is killed outright, which no `except` would catch. This is the
    row's first appearance when no sync has ever succeeded, hence a null
    `synced_at`: nothing has been stored yet.
    """
    attempted_at = datetime.now(UTC)

    state_insert = insert(SyncState).values(id=1, attempted_at=attempted_at)
    await session.execute(
        state_insert.on_conflict_do_update(
            index_elements=[SyncState.id],
            set_={"attempted_at": state_insert.excluded.attempted_at},
        )
    )
    await session.commit()

    return attempted_at


async def sync_lifts(session: AsyncSession) -> dict:
    """Replace the stored lifts with what the Places API currently reports."""
    await record_attempt(session)

    payload = await fetch_lifts()
    fetched_at = datetime.now(UTC)

    # Dedupe by id: ON CONFLICT cannot touch the same row twice in one statement.
    rows = {row["id"]: row for row in (_as_row(item) for item in payload)}
    if not rows:
        # An empty response is far more likely to be an upstream problem than
        # every NS lift disappearing, so keep what we have — and leave synced_at
        # alone, since the stored lifts are still as old as they were. The
        # attempt is already recorded, so this backs off like a failure.
        return {"fetched": 0, "stored": 0, "removed": 0, "note": "empty response"}

    lift_insert = insert(Lift).values(list(rows.values()))
    await session.execute(
        lift_insert.on_conflict_do_update(
            index_elements=[Lift.id],
            set_={column: lift_insert.excluded[column] for column in UPDATABLE_COLUMNS},
        )
    )
    # Lifts that vanished upstream (decommissioned, re-identified) should not
    # linger as permanently stale rows.
    removed = await session.execute(delete(Lift).where(Lift.id.notin_(rows)))

    # Same transaction as the rows it describes, so the stamp can never claim
    # data that was not stored. The row itself was created by record_attempt.
    state_insert = insert(SyncState).values(id=1, synced_at=fetched_at)
    await session.execute(
        state_insert.on_conflict_do_update(
            index_elements=[SyncState.id],
            set_={"synced_at": state_insert.excluded.synced_at},
        )
    )
    await session.commit()

    return {
        "fetched": len(payload),
        "stored": len(rows),
        "removed": removed.rowcount,
        "syncedAt": fetched_at.isoformat(),
    }


async def sync_due(session: AsyncSession) -> bool:
    """Whether a request-triggered refresh should run now.

    Due when the stored lifts have aged past MAX_AGE, unless a sync was started
    within the last RETRY_AFTER — that one is either still running or failed,
    and either way re-attempting it immediately would only repeat the work.
    """
    state = (
        await session.execute(
            select(SyncState.synced_at, SyncState.attempted_at).where(SyncState.id == 1)
        )
    ).first()
    if state is None:
        # Never even attempted, so there is nothing stored to serve.
        return True

    now = datetime.now(UTC)
    synced_at, attempted_at = state
    if synced_at is not None and now - synced_at < MAX_AGE:
        return False

    return attempted_at is None or now - attempted_at >= RETRY_AFTER


async def sync_if_stale(session: AsyncSession) -> dict | None:
    """Refresh the lifts when the stored data has aged past MAX_AGE.

    Returns the sync result, or None when nothing was synced — because the data
    was still fresh, another request had a sync under way, or the refresh failed.
    """
    if not await sync_due(session):
        return None

    # pg_try_advisory_xact_lock returns immediately instead of waiting: one
    # request does the sync while any request that arrives meanwhile serves the
    # data it already has, rather than queueing behind a multi-second NS fetch.
    # The lock only has to hold until the attempt is committed — from then on
    # attempted_at is what holds other requests off, across instances and for
    # the whole fetch.
    if not await session.scalar(select(func.pg_try_advisory_xact_lock(SYNC_LOCK_KEY))):
        return None

    # A sync may have started between the check above and the lock being
    # granted; at READ COMMITTED this re-read sees its committed attempt.
    if not await sync_due(session):
        return None

    try:
        return await sync_lifts(session)
    except Exception:
        # A failed refresh must not fail the request that triggered it: the
        # stored lifts are still worth serving, only older than we would like.
        # The attempt is recorded, so the retry waits out RETRY_AFTER.
        logger.exception("stale-triggered lift sync failed")
        await session.rollback()

        return None
