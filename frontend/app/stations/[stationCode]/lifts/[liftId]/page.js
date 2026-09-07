"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { BACKEND } from "../../../../backend";
import {
  currentOutageNote,
  LiftStats,
  statsSummary,
} from "../../../../lift-stats";
import { SiteHeader } from "../../../../site-header";
import { LiftDetail, liftIdFromParam, liftName } from "../../../../station-card";

export default function LiftPage() {
  // useParams rather than the `params` prop, for the same reason as the station
  // page: that prop is a promise in the App Router, and this is a client
  // component anyway. It hands back the raw path segment though, so the id has
  // to be decoded before it can be encoded again for the request.
  const { stationCode, liftId: liftIdParam } = useParams();
  const liftId = liftIdFromParam(liftIdParam);
  const [lift, setLift] = useState(null);
  const [history, setHistory] = useState(null);
  const [syncedAt, setSyncedAt] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(
          `${BACKEND}/lifts/${encodeURIComponent(liftId)}`,
          { cache: "no-store" },
        );
        if (res.status === 404)
          throw new Error("Deze lift is niet bekend of een brakke url?");
        if (!res.ok) throw new Error(`Backend returned ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setLift(data.lift);
          // Absent on a backend from before the history existed; the section
          // handles that, but only if it is told which.
          setHistory(data.history || null);
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
  }, [liftId]);

  // The station is in the URL, so the way back out is there from the first
  // paint; the payload only refines the code into the name.
  const station = lift?.stationName || String(stationCode).toUpperCase();

  return (
    <>
      <SiteHeader syncedAt={syncedAt} />

      <main id="main" aria-busy={!lift && !error}>
        <p className="back">
          {/* The station rather than the overview: that is the list this lift
              was found in, and the one the URL nests it under. The wordmark
              above still goes to the overview from every page. */}
          <Link href={`/stations/${stationCode}`}>← {station}</Link>
        </p>

        <div className="page-head">
          <div className="page-title">
            <p className="kicker">Lift</p>
            {/* The upstream name is stripped of its "Lift " prefix for the
                table, where the column header carries it. Here the kicker
                carries it visually, but a kicker is not part of the heading —
                so the heading says it too, for anyone navigating by headings
                and hearing a bare "2". */}
            <h1>
              <span className="sr-only">Lift </span>
              {lift ? liftName(lift.name, lift.stationCode) : ""}
            </h1>
            {lift && (
              /* The upstream id, where a station page puts the station code.
                 Labelled, unlike that one: "AH" under "Arnhem Centraal" needs
                 no introduction, but a 32-character URN read out letter by
                 letter does. From the payload rather than the URL so a page
                 that 404s does not caption itself with the id that failed. */
              <span className="lift-id">
                <span className="sr-only">NS-id: </span>
                {lift.id}
              </span>
            )}
          </div>
        </div>

        {/* Mounted unconditionally, like the overview's result count: a live
            region that arrives together with its first message is not announced
            by most screen readers. This one carries the one sentence the whole
            page adds up to, so the status and the availability turn up on their
            own once the fetch resolves (SC 4.1.3). */}
        <p className="sr-only" role="status">
          {lift ? statsSummary(lift, history) : ""}
        </p>

        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {!lift && !error && (
          <p className="notice" role="status">
            Laden…
          </p>
        )}

        {lift && (
          <>
            <LiftDetail lift={lift} note={currentOutageNote(lift, history)} />
            <LiftStats lift={lift} history={history} />
          </>
        )}
      </main>
    </>
  );
}
