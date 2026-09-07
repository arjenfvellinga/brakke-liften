import os
import secrets
from datetime import UTC, datetime
from typing import Annotated

from db import get_session
from fastapi import Depends, FastAPI, Header, HTTPException
from history import (
    day_summary,
    fetch_history,
    record_day,
    summarize,
    today_in_amsterdam,
)
from models import Lift, LiftOpen, SyncState
from ns import sync_if_stale
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

SessionDep = Annotated[AsyncSession, Depends(get_session)]


async def get_fresh_session(session: SessionDep) -> AsyncSession:
    """A session whose lift data has been refreshed if it had gone stale.

    The Vercel cron only runs once a day on the free plan, so the lift routes
    top the data up themselves: every request checks the age of the last sync
    and one of them re-syncs once it passes `ns.MAX_AGE`.
    """
    await sync_if_stale(session)

    return session


FreshSessionDep = Annotated[AsyncSession, Depends(get_fresh_session)]

app = FastAPI(
    title="Brakke Liften",
    description="Minimal backend service mounted under /svc/api on Vercel Services",
    version="1.0.0",
    docs_url="/svc/api/docs",
    redoc_url="/svc/api/redoc",
    openapi_url="/svc/api/openapi.json",
)


@app.get("/svc/api")
def read_root():
    return {
        "message": "FastAPI service is running",
        "mountedAt": "/svc/api",
        "docs": "/svc/api/docs",
    }


@app.get("/svc/api/status")
def get_status():
    return {
        "service": "backend",
        "framework": "fastapi",
        "mountedAt": "/svc/api",
        "timestamp": datetime.now(UTC).isoformat(),
    }


async def synced_at(session: AsyncSession) -> str | None:
    """When the lift data was last synced, ISO-8601, or None before any sync."""
    stamp = await session.scalar(select(SyncState.synced_at).where(SyncState.id == 1))

    return stamp.isoformat() if stamp else None


@app.get("/svc/api/lifts")
async def get_lifts(session: FreshSessionDep):
    lifts = (await session.scalars(select(Lift).order_by(Lift.id))).all()

    return {
        "lifts": [lift.as_dict() for lift in lifts],
        "count": len(lifts),
        "syncedAt": await synced_at(session),
    }


def station_payload(station_code: str, station_lifts: list[Lift]) -> dict:
    """One station and all of its lifts, as the station routes return it."""
    return {
        "stationCode": station_code,
        "stationName": station_lifts[0].station_name,
        "liftCount": len(station_lifts),
        "closedCount": sum(1 for lift in station_lifts if lift.open is LiftOpen.NO),
        "unknownCount": sum(
            1 for lift in station_lifts if lift.open is LiftOpen.UNKNOWN
        ),
        "lifts": [lift.as_dict() for lift in station_lifts],
    }


@app.get("/svc/api/stations")
async def get_stations(session: FreshSessionDep):
    """Every station that has lifts, each with all of its lifts.

    Deliberately unfiltered: the overview leads with the stations that have a
    lift reporting `No` or `Unknown`, but it also has to be able to answer
    "is the lift at my station working?", which needs the ones where nothing is
    wrong — and needs them in the same detail, so that a station reads the same
    whichever list it was found in.
    """
    lifts = (
        await session.scalars(
            select(Lift).order_by(Lift.station_code, Lift.name, Lift.id)
        )
    ).all()

    stations: dict[str, list[Lift]] = {}
    for lift in lifts:
        stations.setdefault(lift.station_code, []).append(lift)

    return {
        "stations": [
            station_payload(station_code, station_lifts)
            for station_code, station_lifts in stations.items()
        ],
        "count": len(stations),
        "syncedAt": await synced_at(session),
    }


@app.get("/svc/api/stations/{station_code}")
async def get_station(station_code: str, session: FreshSessionDep):
    """A single station with all of its lifts.

    Its own URL, so a station that has since been repaired still answers here
    rather than 404.
    """
    # Upstream codes are uppercase ("ASD"); a hand-typed or shared URL may not be.
    station_code = station_code.upper()
    lifts = (
        await session.scalars(
            select(Lift)
            .where(Lift.station_code == station_code)
            .order_by(Lift.name, Lift.id)
        )
    ).all()
    if not lifts:
        raise HTTPException(status_code=404, detail="Station not found")

    return {
        "station": station_payload(station_code, list(lifts)),
        "syncedAt": await synced_at(session),
    }


@app.get("/svc/api/lifts/{lift_id}")
async def get_lift(lift_id: str, session: FreshSessionDep):
    """A single lift, its current state, and its long-term history.

    The history rides along on this response rather than getting its own route:
    the lift page needs both on first paint, and a second request would pay a
    second cold start and a second staleness check for about a kilobyte of JSON.
    It stays out of `lift` itself, which mirrors the upstream Places API record
    field for field and has to keep doing so.

    `syncedAt` like the station routes: the lift has its own page, and the age
    of the data is the one thing every page of this site has to be able to state
    for itself.
    """
    lift = await session.get(Lift, lift_id)
    if lift is None:
        raise HTTPException(status_code=404, detail="Lift not found")

    today = today_in_amsterdam()
    rows, measuring_since, measured_days = await fetch_history(session, lift.id, today)

    return {
        "lift": lift.as_dict(),
        # Always an object, with honest nulls before there is any history — one
        # code path on the frontend rather than two.
        "history": summarize(rows, measuring_since, measured_days, lift.open, today),
        "syncedAt": await synced_at(session),
    }


def authorize_cron(authorization: str | None) -> None:
    """Reject unauthorized callers when a CRON_SECRET is configured.

    Vercel sends `Authorization: Bearer $CRON_SECRET` when the project has that
    variable set. With no secret configured there is nothing to compare against
    and the endpoint stays open — set CRON_SECRET so the sync (which hits the NS
    API and writes to the database) cannot be triggered by anyone.

    Worth more now than it was: an open endpoint can overwrite today's recorded
    history for every lift, not just trigger a sync.
    """
    secret = os.environ.get("CRON_SECRET")
    if secret and not secrets.compare_digest(
        authorization or "", f"Bearer {secret}"
    ):
        raise HTTPException(status_code=401, detail="Unauthorized")


# Runs once a day, and is the only writer of the daily history: the
# request-triggered sync deliberately records nothing, so a busy day and a quiet
# day produce the same one row per lift.
#
# SessionDep rather than FreshSessionDep: the sync is part of what this route
# reports, and the order of the two steps is the point, so neither belongs in a
# dependency that hides them.
@app.get("/svc/api/cron")
async def cron(
    session: SessionDep,
    authorization: Annotated[str | None, Header()] = None,
):
    authorize_cron(authorization)

    # One day for the whole invocation, so the recording and the summary cannot
    # straddle midnight in Amsterdam.
    observed_on = today_in_amsterdam()

    # sync_if_stale, not sync_lifts: by the time this fires the read routes have
    # very likely already refreshed within ns.MAX_AGE, and an unconditional sync
    # would spend three NS requests and a full rewrite of the lifts table to
    # learn nothing. It also takes the advisory lock and swallows a failed fetch,
    # so the cron cannot collide with a request-triggered sync or fail the whole
    # run over an NS blip — record_day's own staleness guard is what stops a
    # failed sync from being recorded as fact. A null result here is the normal
    # case, not an error.
    sync = await sync_if_stale(session)
    recorded = await record_day(session, observed_on)

    # Still 200 on a skipped sync or a skipped recording: the `note` carries the
    # reason, and a non-2xx would make Vercel retry something that will skip
    # again for the same reason.
    return {
        "ok": True,
        "sync": sync,
        "syncedAt": await synced_at(session),
        "recorded": recorded,
        "stats": await day_summary(session, observed_on),
    }
