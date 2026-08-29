"use client";

import { useEffect, useMemo, useState } from "react";

import { BACKEND } from "./backend";
import { SiteHeader } from "./site-header";
import { StationCard } from "./station-card";

export default function Home() {
  const [stations, setStations] = useState(null);
  const [syncedAt, setSyncedAt] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`${BACKEND}/stations`, { cache: "no-store" });
        if (!res.ok) throw new Error(`Backend returned ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setStations(data.stations);
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
  }, []);

  const filtered = useMemo(() => {
    if (!stations) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return stations;
    return stations.filter(
      (station) =>
        station.stationCode.toLowerCase().includes(needle) ||
        (station.stationName || "").toLowerCase().includes(needle),
    );
  }, [stations, query]);

  const totals = useMemo(
    () =>
      filtered.reduce(
        (acc, station) => ({
          closed: acc.closed + station.closedCount,
          unknown: acc.unknown + station.unknownCount,
        }),
        { closed: 0, unknown: 0 },
      ),
    [filtered],
  );

  return (
    <>
      <SiteHeader syncedAt={syncedAt} />

      <main>
        <h1 className="sr-only">Een overzicht van brakke listen op treinstations in Nederland</h1>

        <div className="page-head">
          <div className="page-search">
            <div className="field">
              <label htmlFor="station-filter">Zoek een station</label>
              <input
                id="station-filter"
                className="input"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Utrecht, ASD…"
              />
            </div>
            {stations && query.trim() && (
              <span className="filter-count">
                {filtered.length} van {stations.length}
              </span>
            )}
          </div>

          {stations && (
            <div className="stats">
              <div className="stat">
                <span className="stat-label">Stations</span>
                <span className="stat-value">{filtered.length}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Buiten dienst</span>
                <span className="stat-value down">{totals.closed}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Onbekend</span>
                <span className="stat-value unknown">{totals.unknown}</span>
              </div>
            </div>
          )}
        </div>

        {error && <p className="notice error">Laden mislukt: {error}</p>}
        {!stations && !error && <p className="notice">Laden…</p>}
        {stations && filtered.length === 0 && (
          <p className="notice">
            {stations.length === 0
              ? "Geen enkel station heeft op dit moment een lift buiten dienst."
              : "Geen station komt overeen met wat je zoekt."}
          </p>
        )}

        {filtered.map((station) => (
          <StationCard key={station.stationCode} station={station} linked />
        ))}
      </main>
    </>
  );
}
