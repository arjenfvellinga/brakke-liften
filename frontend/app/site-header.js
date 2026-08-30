"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { formatAge, formatSynced } from "./backend";

// How often the age is recomputed. The string only ever changes in whole
// minutes, so half a minute is close enough that it is never visibly wrong, and
// rare enough to be free.
const TICK = 30_000;

// The bar every page opens with: wordmark, what the site is, and how old the
// data is. `syncedAt` is null until the first fetch resolves, so the timestamp
// simply is not there yet rather than showing a placeholder — which is also
// what keeps the clock out of the server render and the hydration honest.
export function SiteHeader({ syncedAt }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!syncedAt) return undefined;

    // Re-read the clock straight away: `now` was captured at mount, and the
    // stamp it has to be measured against only arrived with the fetch.
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK);

    return () => clearInterval(timer);
  }, [syncedAt]);

  const age = formatAge(syncedAt, now);

  return (
    <header className="nav">
      <div className="nav-inner">
        <Link className="nav-brand" href="/">
          Brakke liften
        </Link>
        <span className="nav-note">Liftstoringen op treinstations in Nederland</span>
        {age && (
          <span className="nav-synced">
            Bijgewerkt{" "}
            {/* The exact moment is still one hover away, and still machine
                readable, for anyone the duration does not satisfy. */}
            <time dateTime={syncedAt} title={formatSynced(syncedAt)}>
              {age}
            </time>
          </span>
        )}
      </div>
    </header>
  );
}
