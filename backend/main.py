from datetime import UTC, datetime
from typing import Annotated

from db import get_session
from fastapi import Depends, FastAPI, HTTPException
from models import Item
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

SessionDep = Annotated[AsyncSession, Depends(get_session)]

app = FastAPI(
    title="Next.js + FastAPI Services Demo",
    description="Minimal backend service mounted under /svc/api on Vercel Services",
    version="1.0.0",
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


@app.get("/svc/api/items")
async def get_items(session: SessionDep):
    items = (await session.scalars(select(Item).order_by(Item.id))).all()

    return {
        "items": [item.as_dict() for item in items],
        "count": len(items),
    }


@app.get("/svc/api/items/{item_id}")
async def get_item(item_id: int, session: SessionDep):
    item = await session.get(Item, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")

    return {"item": item.as_dict()}


@app.get("/svc/api/cron")
def cron():
    return {"ok": "true"}
