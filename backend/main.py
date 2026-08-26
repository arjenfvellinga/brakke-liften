import os
import secrets
from datetime import UTC, datetime
from typing import Annotated

from db import get_session
from fastapi import Depends, FastAPI, Header, HTTPException
from models import Lift, LiftOpen
from ns import sync_lifts
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

SessionDep = Annotated[AsyncSession, Depends(get_session)]

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


@app.get("/svc/api/lifts")
async def get_lifts(session: SessionDep):
    lifts = (await session.scalars(select(Lift).order_by(Lift.id))).all()

    return {
        "lifts": [lift.as_dict() for lift in lifts],
        "count": len(lifts),
    }


@app.get("/svc/api/stations")
async def get_stations(session: SessionDep):
    """Stations that have at least one lift not confirmed open.

    A station is included when any of its lifts reports `No` or `Unknown`; the
    station then carries *all* of its lifts, so the working ones next to a
    broken one stay visible.
    """
    affected = (
        select(Lift.station_code)
        .where(Lift.open.in_((LiftOpen.NO, LiftOpen.UNKNOWN)))
        .distinct()
    )
    lifts = (
        await session.scalars(
            select(Lift)
            .where(Lift.station_code.in_(affected))
            .order_by(Lift.station_code, Lift.name, Lift.id)
        )
    ).all()

    stations: dict[str, list[Lift]] = {}
    for lift in lifts:
        stations.setdefault(lift.station_code, []).append(lift)

    return {
        "stations": [
            {
                "stationCode": station_code,
                "stationName": station_lifts[0].station_name,
                "liftCount": len(station_lifts),
                "closedCount": sum(
                    1 for lift in station_lifts if lift.open is LiftOpen.NO
                ),
                "unknownCount": sum(
                    1 for lift in station_lifts if lift.open is LiftOpen.UNKNOWN
                ),
                "lifts": [lift.as_dict() for lift in station_lifts],
            }
            for station_code, station_lifts in stations.items()
        ],
        "count": len(stations),
    }


@app.get("/svc/api/lifts/{lift_id}")
async def get_lift(lift_id: str, session: SessionDep):
    lift = await session.get(Lift, lift_id)
    if lift is None:
        raise HTTPException(status_code=404, detail="Lift not found")

    return {"lift": lift.as_dict()}


def authorize_cron(authorization: str | None) -> None:
    """Reject unauthorized callers when a CRON_SECRET is configured.

    Vercel sends `Authorization: Bearer $CRON_SECRET` when the project has that
    variable set. With no secret configured there is nothing to compare against
    and the endpoint stays open — set CRON_SECRET so the sync (which hits the NS
    API and writes to the database) cannot be triggered by anyone.
    """
    secret = os.environ.get("CRON_SECRET")
    if secret and not secrets.compare_digest(
        authorization or "", f"Bearer {secret}"
    ):
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.get("/svc/api/cron")
async def cron(
    session: SessionDep,
    authorization: Annotated[str | None, Header()] = None,
):
    authorize_cron(authorization)

    return {"ok": True, "lifts": await sync_lifts(session)}
