"use client";

import { useEffect, useMemo, useState } from "react";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "/svc/api";

// The upstream `open` values, mapped onto the presentation used throughout.
const STATUS = {
  Yes: { label: "In bedrijf", className: "ok" },
  No: { label: "Buiten dienst", className: "down" },
  Unknown: { label: "Onbekend", className: "unknown" },
};

function statusOf(open) {
  return STATUS[open] || { label: open, className: "unknown" };
}

export default function Home() {
  const [stations, setStations] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`${BACKEND}/stations`, { cache: "no-store" });
        if (!res.ok) throw new Error(`Backend returned ${res.status}`);
        const data = await res.json();
        if (!cancelled) setStations(data.stations);
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
        station.lifts.some((lift) => lift.name.toLowerCase().includes(needle)),
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
    <main>
      <header>
        <h1>Stations met brakke liften</h1>
        <p className="lede">
          Stations waar minstens één lift buiten dienst is of waarvan de status onbekend is.
        </p>
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
          <section className="station" key={station.stationCode}>
            <div className="station-head">
              <div className="station-title">
                {/* No name known for this code: the code is the heading, so
                    showing it again as a subtitle would just repeat it. */}
                <h2>{station.stationName || station.stationCode}</h2>
                {station.stationName && (
                  <span className="station-code">{station.stationCode}</span>
                )}
              </div>
              <div className="counts">
                {station.closedCount > 0 && (
                  <span className="badge down">
                    {station.closedCount} buiten dienst
                  </span>
                )}
                {station.unknownCount > 0 && (
                  <span className="badge unknown">
                    {station.unknownCount} onbekend
                  </span>
                )}
                <span className="badge muted">
                  {station.liftCount} {station.liftCount === 1 ? "lift" : "liften"}
                </span>
              </div>
            </div>

            <ul className="lifts">
              {station.lifts.map((lift) => {
                const status = statusOf(lift.open);
                return (
                  <li className={`lift ${status.className}`} key={lift.id}>
                    <span className="dot" aria-hidden="true" />
                    <span className="lift-name">{lift.name}</span>
                    {lift.platform && (
                      <span className="platform">spoor {lift.platform}</span>
                    )}
                    <span className="lift-status">
                      {lift.statusLabel || status.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
