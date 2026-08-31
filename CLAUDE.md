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

## Accessibility

**The frontend conforms to WCAG 2.2 level AA, and must stay that way.** This is a
public transport-information site: the people most likely to need it are the ones
a broken lift strands. Treat a new AA failure as a bug, not a nice-to-have.

The visual design comes from a Claude Design "Modernist" project, and `globals.css`
deliberately diverges from it in the places where the system fails AA. Do not
"restore" these from the design source:

- **The accent `#ec3013` is only 3.76:1 on the `#f3f2f2` ground.** It is a
  *large-text and non-text* colour only: the 30px stat numbers, the status marks,
  the header pip, the focus ring. Anything accent-coloured at body size uses
  `--color-accent-700` (`#ae1800`, 6.4:1) — that includes every `:hover` colour.
- **Muted text is `--ink-strong` (5.8:1) or `--ink-muted` (4.95:1).** Never
  introduce a lighter ink mix for text; the old 55%/45% mixes failed at 3.66:1
  and 2.74:1. Remember `color-mix(… , transparent)` composites over whatever is
  behind it, so check the tinted `.lift-row.down` background too, not just the ground.
- **Interactive borders use `--color-border-control`** (~3.9:1, for SC 1.4.11).
  The decorative section rules keep the lighter `--color-divider` — that token is
  below 3:1 and must not be used on a control.
- **Every `font-size` is rem**, so text follows the reader's browser setting.
  Padding, gaps and widths stay in px; the layout grid is deliberate.
- **Interactive targets are 44px** (`.input`, `.scope-option`).
- Every hover-only colour change needs a `:focus-visible` twin.

Two traps specific to this codebase:

1. **The mobile lift table.** The `@media (max-width: 640px)` block re-lays each
   row out as a grid. `thead` there is visually hidden with `position: absolute`,
   **never `display: none`** — the latter deletes the column headers from the
   accessibility tree, leaving four unlabelled values per row. Likewise the empty
   platform cell keeps its `<td>` and hides only the inner `<span>`, so every row
   keeps four cells. (Current Chrome, Gecko and WebKit all preserve table roles
   through the `display` override, so no compensating ARIA is needed.)
2. **Status messages (SC 4.1.3).** Both pages fetch client-side, so anything that
   appears, changes or fails after load needs announcing: `role="status"` for
   loading and empty states, `role="alert"` for errors. The search-result count
   lives in a `.sr-only` `role="status"` region in `page.js` that is **mounted
   unconditionally** — a live region that appears together with its first message
   is not announced by most screen readers.

Station pages get their title from `frontend/app/stations/[stationCode]/layout.js`;
the page itself is a client component and cannot export `metadata`. Without that
layout every station shares one title (SC 2.4.2).

### Verifying

There is no a11y linter wired up. Check changes with axe-core in a real browser —
scan both routes at a desktop and a mobile width, since the overview renders one
table and one region per station:

```bash
# from a scratch dir, against a running `vercel dev`
npm i playwright axe-core && npx playwright install firefox webkit
# launch a page, page.addScriptTag({path: require.resolve('axe-core')}),
# then axe.run(document, {runOnly: {type: 'tag', values:
#   ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}})
```

Use `locator.ariaSnapshot()` to inspect the accessibility tree directly — it is
the only way to catch the `thead` and cell-count regressions above, which axe
cannot see. Note that hand-rolled contrast maths must composite `color-mix()`
alpha; axe's own `color-contrast` node data is the reliable source.
