# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Vercel Services monorepo: a Next.js frontend and a FastAPI backend deployed as two
independent services behind one domain. Currently the upstream Vercel starter
template, unmodified apart from the repo name.

## Commands

Run the whole stack (both services, with the `vercel.json` rewrites applied) from
the repo root — this is the only way to exercise cross-service routing locally:

```bash
vercel dev          # http://localhost:3000
```

Per-service work:

```bash
# frontend/ — pnpm (pnpm-lock.yaml)
pnpm install
pnpm dev            # Next.js alone; /svc/api calls will 404
pnpm build

# backend/ — uv (uv.lock)
uv sync
uv run uvicorn main:app --reload
```

There is no test suite, linter, or formatter configured.

## Architecture

`vercel.json` is the contract between the two services. It declares both service
roots and the rewrites that map URL space onto them:

- `/svc/api/:path*` → `backend` service
- `/(.*)` → `frontend` service (catch-all, must stay last)

**The rewrite does not strip the `/svc/api` prefix.** FastAPI receives the full
path, so every route in `backend/main.py` declares it explicitly
(`@app.get("/svc/api/status")`, not `@app.get("/status")`). New backend routes
must follow this or they will be unreachable in deployment. FastAPI's own docs
land at `/svc/api/docs`.

The frontend reaches the backend over the same public origin, not a service
binding: `frontend/app/page.js` uses `process.env.NEXT_PUBLIC_BACKEND_URL` with
`/svc/api` as the fallback, so requests go through the Vercel rewrite.

Two kinds of API route coexist and are easy to confuse:

- `frontend/app/api/*/route.js` — Next.js route handlers, run on the frontend
  service, reached at `/api/*`
- `backend/main.py` — FastAPI, separate runtime and deploy unit, reached at
  `/svc/api/*`

Frontend is Next.js App Router with plain JavaScript (no TypeScript) and a single
global stylesheet, `frontend/app/globals.css`. Turbopack `root` is pinned to
`frontend/` in `next.config.js` so the monorepo root is not inferred as the
workspace root.
