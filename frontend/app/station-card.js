import Link from "next/link";

// The upstream `open` values, mapped onto the presentation used throughout.
const STATUS = {
  Yes: { label: "In bedrijf", className: "ok" },
  No: { label: "Buiten dienst", className: "down" },
  Unknown: { label: "Onbekend", className: "unknown" },
};

function statusOf(open) {
  return STATUS[open] || { label: open, className: "unknown" };
}

// Upstream names are all of the form "Lift 1", "Lift perron 2a", and some are
// prefixed with the station code ("ASD Lift 1"). Both the code and the "Lift"
// are already established by the table the name sits in, so neither carries
// anything. Stripping the code first: it comes before the prefix.
export function liftName(name, stationCode) {
  let stripped = name;

  stripped = stripped.replace(/^Lift\s+/i, "");

  if (stationCode && stripped.toLowerCase().startsWith(stationCode.toLowerCase())) {
    stripped = stripped.slice(stationCode.length).replace(/^[\s:_-]+/, "");
  }

  // A name that was nothing but the code and the prefix would strip to nothing;
  // showing the untouched name beats showing an empty row.
  return stripped || name;
}

// Sorted on the *displayed* name, not the upstream one: the backend's ordering
// is by the raw name, so a table mixing "Lift 2" with "ASD Lift 1" comes out in
// an order the stripped names no longer explain. `numeric` so lift 10 follows
// lift 9 instead of lift 1.
function byName(a, b) {
  return liftName(a.name, a.stationCode).localeCompare(
    liftName(b.name, b.stationCode),
    "nl",
    { numeric: true, sensitivity: "base" },
  );
}

// Whether anything at this station is worth reporting — what the overview's
// two lists are split on.
export function isAffected(station) {
  return station.closedCount + station.unknownCount > 0;
}

// The counts, in the label-over-number pairs the design system uses for every
// figure. "Onbekend" is dropped when there is none: an emphatic zero would
// draw the eye to the one column that has nothing to say.
export function StationStats({ station }) {
  // Nothing out of order: the one figure left is how many lifts are running,
  // and it stays in the neutral ink — red means a problem everywhere else on
  // the page, so a working station must not borrow it.
  if (!isAffected(station)) {
    return (
      <div className="stats">
        <div className="stat">
          <span className="stat-label">In bedrijf</span>
          <span className="stat-value">
            {station.liftCount}
            <span className="stat-of"> / {station.liftCount}</span>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="stats">
      <div className="stat">
        <span className="stat-label">Buiten dienst</span>
        <span className="stat-value down">
          {station.closedCount}
          <span className="stat-of"> / {station.liftCount}</span>
        </span>
      </div>
      {station.unknownCount > 0 && (
        <div className="stat">
          <span className="stat-label">Onbekend</span>
          <span className="stat-value unknown">{station.unknownCount}</span>
        </div>
      )}
    </div>
  );
}

// The lifts themselves. Split out from the card because the station's own page
// leads with its heading and counts already, and only wants the table.
export function LiftTable({ station }) {
  // Copied first — sort mutates, and the array belongs to the caller's state.
  const lifts = [...station.lifts].sort(byName);

  return (
    <table className="lift-table">
      <thead>
        <tr>
          <th className="col-mark">
            <span className="sr-only">Status</span>
          </th>
          <th>Lift</th>
          <th className="lift-platform">Perron</th>
          <th className="col-status">Status</th>
        </tr>
      </thead>
      <tbody>
        {lifts.map((lift) => {
          const status = statusOf(lift.open);
          return (
            <tr className={`lift-row ${status.className}`} key={lift.id}>
              <td className="col-mark">
                {/* The bar repeats what the status column says in words; it is
                    there so a row can be placed at a glance, not read. */}
                <span className="mark" aria-hidden="true" />
              </td>
              <td className="lift-name">
                {liftName(lift.name, lift.stationCode)}
              </td>
              <td className={`lift-platform${lift.platform ? "" : " empty"}`}>
                {lift.platform || "—"}
              </td>
              <td className="col-status lift-status">
                {lift.statusLabel || status.label}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// `linked` is off on the station's own page: the heading would link to the page
// it is already on.
export function StationCard({ station, linked = false }) {
  // No name known for this code: the code is the heading, so showing it again
  // underneath would just repeat it.
  const heading = station.stationName || station.stationCode;

  return (
    <section className="station">
      <div className="station-head">
        <div className="station-title">
          <h2>
            {linked ? (
              <Link href={`/stations/${station.stationCode}`}>{heading}</Link>
            ) : (
              heading
            )}
          </h2>
          {station.stationName && (
            <span className="station-code">{station.stationCode}</span>
          )}
        </div>
        <StationStats station={station} />
      </div>

      <LiftTable station={station} />

      <p className="station-foot">
        {linked && (
          <>
            {" · "}
            <Link className="station-foot-link" href={`/stations/${station.stationCode}`}>
              Alleen dit station
            </Link>
          </>
        )}
      </p>
    </section>
  );
}
