# Next.js + FastAPI Services

Minimal example showing Vercel Services with:

- `frontend` (Next.js) mounted at `/`
- `backend` (FastAPI) mounted at `/svc/api`

It demonstrates:

1. A **Next.js API route** at `/api/hello`
2. A **FastAPI backend route** at `/svc/api/status`
3. Public routes via **rewrites** in `vercel.json`

## Project structure

```txt
nextjs-fastapi/
├── backend/
│   ├── main.py
│   └── pyproject.toml
├── frontend/
│   ├── app/
│   │   ├── api/hello/route.js
│   │   ├── globals.css
│   │   ├── layout.js
│   │   └── page.js
│   ├── next.config.js
│   └── package.json
└── vercel.json
```

## Services config

Configuration in `vercel.json`:

- routes `/(.*)` to `frontend`
- routes `/svc/api` to `backend`

## Run locally

```bash
vercel dev
```

Open `http://localhost:3000` and try:

- `/api/hello` (Next.js API route)
- `/svc/api/status` (FastAPI backend route)


## Note
```bash
uv add --dev alembic

uv run alembic revision --autogenerate -m "create lifts table"   # writes alembic/versions/<hash>_*.py
uv run alembic upgrade head                                      # apply
uv run alembic downgrade -1                                      # undo one
uv run alembic current                                           # what's applied

cd backend && uv run alembic upgrade head && cd ..
```

```bash
brew services start postgresql@18
createdb brakke_liften
```

## Lift data

`lifts` mirrors `StationFacilityLocationResponseV1` from the NS Places API
(`GET /places-api/v1/stationfacility/lifts`), keyed on the upstream lift id.

`backend/ns.py` syncs it: fetch upstream, upsert every lift, delete the ones that
no longer appear. The `/svc/api/cron` route runs it, on the daily schedule in
`vercel.json`. The endpoint caps `limit` at 500 and has no cursor, so the sync
requests one `status` at a time (~444 lifts total today) and fails loudly rather
than syncing a truncated page.

Environment, in `.env.local` at the repo root:

- `NS_API_PRIMARY_KEY` — sent as `Ocp-Apim-Subscription-Key`. Required.
- `CRON_SECRET` — optional. When set, `/svc/api/cron` requires
  `Authorization: Bearer $CRON_SECRET` (which is what Vercel sends). Without it
  the sync is triggerable by anyone.