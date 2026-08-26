"""Database URL resolution, engine, and the FastAPI session dependency."""

import os
from collections.abc import AsyncIterator
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool


def load_local_env() -> None:
    """Load .env.local into the environment, if it and python-dotenv exist."""
    try:
        from dotenv import load_dotenv
    except ImportError:
        # python-dotenv is a dev-only dependency; deployments get real
        # environment variables and need no file at all.
        return

    # .env.local lives at the monorepo root, one level up from backend/.
    # override=True: `vercel dev` injects the Vercel project's Development
    # env vars (including a DATABASE_URL pointing at hosted Postgres), and
    # locally .env.local is meant to win over those. The file is gitignored,
    # so deployments have none and keep their real environment variables.
    load_dotenv(Path(__file__).resolve().parents[1] / ".env.local", override=True)


def get_database_url() -> str:
    """Return DATABASE_URL with an async driver forced onto it."""
    load_local_env()

    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError(
            "DATABASE_URL is not set. Add it to .env.local at the repo root "
            "(or export it) before starting the backend."
        )

    # Hosted Postgres hands out postgres:// / postgresql:// URLs, but the async
    # engine needs an async driver; point those at psycopg3.
    for scheme in ("postgresql://", "postgres://"):
        if url.startswith(scheme):
            return "postgresql+psycopg://" + url[len(scheme) :]

    return url


# NullPool: invocations are short-lived and the hosted pooler owns the real
# pool, so keeping SQLAlchemy-side connections open across requests buys nothing.
engine = create_async_engine(get_database_url(), poolclass=NullPool)

SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
