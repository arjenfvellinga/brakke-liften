from datetime import UTC, datetime
from typing import Annotated

from db import get_session
from fastapi import Depends, FastAPI, HTTPException
from models import Lift
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


@app.get("/svc/api/lifts/{lift_id}")
async def get_lift(lift_id: int, session: SessionDep):
    lift = await session.get(Lift, lift_id)
    if lift is None:
        raise HTTPException(status_code=404, detail="Lift not found")

    return {"lift": lift.as_dict()}


@app.get("/svc/api/cron")
def cron():
    return {"ok": "true"}
