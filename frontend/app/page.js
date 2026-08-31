"use client";

import { useEffect, useMemo, useState } from "react";

import { BACKEND } from "./backend";
import { SiteHeader } from "./site-header";
import { isAffected, StationCard } from "./station-card";

// The two lists the overview can show, default first. Everything, up front:
// the question someone arrives with is "how is the lift at my station?", and
// a station missing from an opening list of storingen answers that only if you
// already know that is what you are looking at.
const SCOPES = [
  { id: "all", label: "Alle stations" },
  { id: "affected", label: "Met storing" },
];

function matches(station, needle) {
  return (
    station.stationCode.toLowerCase().includes(needle) ||
    (station.stationName || "").toLowerCase().includes(needle)
  );
}

// On the name that is actually shown, not the station code the backend orders
// by — with every station in the list, alphabetical by name is the only order
// in which someone can find theirs. `ignorePunctuation` so "'s-Hertogenbosch"
// files under the S rather than ahead of the whole alphabet.
function byStationName(a, b) {
  return (a.stationName || a.stationCode).localeCompare(
    b.stationName || b.stationCode,
    "nl",
    { sensitivity: "base", ignorePunctuation: true },
  );
}

export default function Home() {
  const [stations, setStations] = useState(null);
  const [syncedAt, setSyncedAt] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState(SCOPES[0].id);

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

  // Sorted once; both scopes and the search are slices of this, so the order on
  // screen never changes as the list narrows.
  const sorted = useMemo(
    () => (stations ? [...stations].sort(byStationName) : []),
    [stations],
  );
  const affected = useMemo(() => sorted.filter(isAffected), [sorted]);

  const needle = query.trim().toLowerCase();
  const scoped = scope === "all" ? sorted : affected;
  const filtered = useMemo(
    () =>
      needle ? scoped.filter((station) => matches(station, needle)) : scoped,
    [scoped, needle],
  );

  // A search that finds nothing among the storingen but does match stations
  // that are simply working: that is an answer, not an empty result, so the
  // notice below offers it rather than leaving the page blank.
  const elsewhere = useMemo(
    () =>
      scope === "affected" && needle && filtered.length === 0
        ? sorted.filter((station) => matches(station, needle)).length
        : 0,
    [scope, needle, filtered, sorted],
  );

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
        <h1 className="sr-only">Een overzicht van brakke liften op treinstations in Nederland</h1>

        <div className="page-head">
          <div className="page-search">
            <div className="field">
              <label htmlFor="station-filter">Zoek een station met lift</label>
              <input
                id="station-filter"
                className="input"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Utrecht, ASD…"
              />
            </div>
          </div>

          {stations && (
            <div className="scope" role="group" aria-label="Welke stations">
              {SCOPES.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  className={`scope-option${scope === id ? " active" : ""}`}
                  aria-pressed={scope === id}
                  onClick={() => setScope(id)}
                >
                  {label}
                  <span className="scope-count">
                    {id === "all" ? sorted.length : affected.length}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {stations && (
          <div className="stat-bar">
            <div className="stat-groups">
              {/* The heading only stands over these two visually, so the group
                  has to say so out loud as well. */}
              <div className="stat-group" role="group" aria-label="Liften">
                <span className="kicker stat-group-label">Liften</span>
                <div className="stats">
                  <div className="stat">
                    <span className="stat-label">Buiten dienst</span>
                    <span className="stat-value down">{totals.closed}</span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Onbekend</span>
                    <span className="stat-value unknown">{totals.unknown}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {error && <p className="notice error">Laden mislukt: {error}</p>}
        {!stations && !error && <p className="notice">Laden…</p>}
        {stations && filtered.length === 0 && (
          <p className="notice">
            {sorted.length === 0 ? (
              "Er zijn nog geen liftgegevens."
            ) : scoped.length === 0 ? (
              "Geen enkel station heeft op dit moment een lift buiten dienst."
            ) : elsewhere > 0 ? (
              <>
                Geen station met een storing komt overeen met wat je zoekt.{" "}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setScope("all")}
                >
                  Zoek in alle stations ({elsewhere})
                </button>
              </>
            ) : (
              "Geen station komt overeen met wat je zoekt of heeft geen lift."
            )}
          </p>
        )}

        {filtered.map((station) => (
          <StationCard key={station.stationCode} station={station} linked />
        ))}
      </main>
    </>
  );
}
