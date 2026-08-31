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
//
// A <dl> rather than spans: the pairing is the whole point of the component, so
// it has to hold up when the layout that expresses it visually is gone.
export function StationStats({ station }) {
  // Nothing out of order: the one figure left is how many lifts are running,
  // and it stays in the neutral ink — red means a problem everywhere else on
  // the page, so a working station must not borrow it.
  if (!isAffected(station)) {
    return (
      <dl className="stats">
        <div className="stat">
          <dt className="stat-label">In bedrijf</dt>
          <dd className="stat-value">
            {station.liftCount}
            <span className="stat-of"> / {station.liftCount}</span>
          </dd>
        </div>
      </dl>
    );
  }

  return (
    <dl className="stats">
      <div className="stat">
        <dt className="stat-label">Buiten dienst</dt>
        <dd className="stat-value down">
          {station.closedCount}
          <span className="stat-of"> / {station.liftCount}</span>
        </dd>
      </div>
      {station.unknownCount > 0 && (
        <div className="stat">
          <dt className="stat-label">Onbekend</dt>
          <dd className="stat-value unknown">{station.unknownCount}</dd>
        </div>
      )}
    </dl>
  );
}

// The lifts themselves. Split out from the card because the station's own page
// leads with its heading and counts already, and only wants the table.
//
// Under 640px the stylesheet lays each row out as a block, which used to cost a
// table its roles in the accessibility tree. Chrome, Gecko and WebKit all keep
// them now, so no ARIA is restated here — but see the note on `thead` in the
// responsive block, which is a live problem rather than a historical one.
export function LiftTable({ station }) {
  // Copied first — sort mutates, and the array belongs to the caller's state.
  const lifts = [...station.lifts].sort(byName);

  return (
    <table className="lift-table">
      {/* The overview stacks one of these per station, so a table with no name
          of its own is indistinguishable from the twenty above it. */}
      <caption className="sr-only">
        Liften op {station.stationName || station.stationCode}
      </caption>
      <thead>
        <tr>
          <th className="col-mark" scope="col">
            {/* Not "Status": that is the last column's name, and two columns
                answering to it makes both ambiguous. */}
            <span className="sr-only">Statusmarkering</span>
          </th>
          <th scope="col">Lift</th>
          <th className="lift-platform" scope="col">
            Perron
          </th>
          <th className="col-status" scope="col">
            Status
          </th>
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
                {/* The placeholder is punctuation, not a value: kept out of the
                    reading order, and hidden outright once the narrow layout
                    drops the column header that gave it its sense. The cell
                    itself stays, so every row keeps all four. */}
                {lift.platform || <span aria-hidden="true">—</span>}
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
  const headingId = `station-${station.stationCode}`;

  return (
    // Named after its own heading, so the list of stations is navigable as a
    // list of regions rather than one undifferentiated run of sections.
    <section className="station" aria-labelledby={headingId}>
      <div className="station-head">
        <div className="station-title">
          <h2 id={headingId}>
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

      {linked && (
        <p className="station-foot">
          <Link
            className="station-foot-link"
            href={`/stations/${station.stationCode}`}
          >
            {/* Appended rather than an aria-label: the visible text has to stay
                part of the accessible name, and "Alleen dit station" on its own
                says nothing when it is the twentieth one in the list. */}
            Alleen dit station
            <span className="sr-only">: {heading}</span>
          </Link>
        </p>
      )}
    </section>
  );
}
