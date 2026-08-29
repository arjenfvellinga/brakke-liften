"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { BACKEND } from "../../backend";
import { SiteHeader } from "../../site-header";
import { LiftTable, StationStats } from "../../station-card";

export default function StationPage() {
  // useParams rather than the `params` prop: that prop is a promise in the App
  // Router, and this page is a client component anyway.
  const { stationCode } = useParams();
  const [station, setStation] = useState(null);
  const [syncedAt, setSyncedAt] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(
          `${BACKEND}/stations/${encodeURIComponent(stationCode)}`,
          { cache: "no-store" },
        );
        if (res.status === 404) throw new Error("Dit station is niet bekend of een brakke url?");
        if (!res.ok) throw new Error(`Backend returned ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setStation(data.station);
          setSyncedAt(data.syncedAt);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [stationCode]);

  return (
    <>
      <SiteHeader syncedAt={syncedAt} />

      <main>
        <p className="back">
          <Link href="/">← Alle stations</Link>
        </p>

        <div className="page-head">
          <div className="page-title">
            <p className="kicker">Station</p>
            {/* The payload carries the resolved station name; until it arrives
                the code from the URL is the only name there is. */}
            <h1>{station?.stationName || String(stationCode).toUpperCase()}</h1>
            {station?.stationName && (
              <span className="station-code">{station.stationCode}</span>
            )}
          </div>
          {station && <StationStats station={station} />}
        </div>

        {error && <p className="notice error">{error}</p>}
        {!station && !error && <p className="notice">Laden…</p>}

        {station && (
          <>
            <LiftTable station={station} />
            <p className="station-foot">
              {station.liftCount}{" "}
              {station.liftCount === 1 ? "lift" : "liften"} op dit station
            </p>
          </>
        )}
      </main>
    </>
  );
}
