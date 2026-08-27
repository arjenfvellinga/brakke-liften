"use client";

import { useEffect, useMemo, useState } from "react";

import { BACKEND, formatSynced } from "./backend";
import { StationCard, liftName } from "./station-card";

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
        (station.stationName || "").toLowerCase().includes(needle) ||
        station.lifts.some((lift) =>
          liftName(lift.name, lift.stationCode).toLowerCase().includes(needle),
        ),
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

  const synced = formatSynced(syncedAt);

  return (
    <main>
      <header>
        <h1>Stations met brakke liften</h1>
        <p className="lede">
          Stations waar minstens één lift buiten dienst is of waarvan de status onbekend is.
        </p>
        {/* Null until the first sync has run; the NS data is only refreshed
            once a day, so saying how old it is matters. */}
        {synced && (
          <p className="synced">
            Bijgewerkt op <time dateTime={syncedAt}>{synced}</time>
          </p>
        )}
      </header>

      {stations && (
        <div className="toolbar">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter op station of liftnaam…"
            aria-label="Filter stations"
          />
          <div className="totals">
            <span>
              <strong>{filtered.length}</strong> stations
            </span>
            <span className="down">
              <strong>{totals.closed}</strong> liften buiten dienst
            </span>
            <span className="unknown">
              <strong>{totals.unknown}</strong> onbekend
            </span>
          </div>
        </div>
      )}

      {error && <p className="notice error">Laden mislukt: {error}</p>}
      {!stations && !error && <p className="notice">Laden…</p>}
      {stations && filtered.length === 0 && (
        <p className="notice">
          {stations.length === 0
            ? "Geen station heeft op dit moment een lift buiten dienst."
            : "Geen station komt overeen met dit filter."}
        </p>
      )}

      <div className="stations">
        {filtered.map((station) => (
          <StationCard key={station.stationCode} station={station} linked />
        ))}
      </div>
    </main>
  );
}
