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

// A lift's own page, under the station it belongs to: the station code is the
// one readable part of the URL — the id is the upstream one
// ("NL:CHB:LiftEquipment:8400280_001") — and having it there is also what lets
// the page title and its way back out be right before the fetch resolves.
export function liftHref(lift) {
  return `/stations/${lift.stationCode}/lifts/${encodeURIComponent(lift.id)}`;
}

// The inverse, and not optional: useParams hands back the raw path segment, so
// the colons the id is full of are still percent-encoded. Encoding that again
// for the API call sends `%253A` and gets a 404 for a lift that exists.
//
// Written to be idempotent rather than assuming the encoding: a segment that
// arrives already decoded has nothing to decode, and the catch covers an id
// holding a literal `%`, which would make decodeURIComponent throw.
export function liftIdFromParam(segment) {
  try {
    return decodeURIComponent(String(segment));
  } catch {
    return String(segment);
  }
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
                {/* Underlined rather than only recoloured on hover: at body
                    size the accent would have to be the 700, which turns every
                    name red, and a bold word that is a link only while the
                    pointer is on it is no link at all to anyone else. */}
                <Link href={liftHref(lift)}>
                  {liftName(lift.name, lift.stationCode)}
                  {/* The displayed names are "1", "2", "perron 2a" — unique
                      within a station and meaningless outside it, and the
                      overview stacks twenty of these tables. Appended so the
                      visible text stays part of the accessible name. */}
                  <span className="sr-only">
                    {" "}
                    op {station.stationName || station.stationCode}
                  </span>
                </Link>
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

// One lift, on its own page. The table's four columns have nothing to line up
// against here, so the same values become label-over-value pairs — the form the
// system already uses for every figure — and a <dl>, so each value stays tied
// to its label when the band wraps.
//
// Status is still carried more than one way: the bar, the word, and the weight.
// The row tint is dropped rather than blown up to a whole band, which would put
// every muted label on this page over a second surface to be checked.
export function LiftDetail({ lift }) {
  const status = statusOf(lift.open);

  return (
    <dl className="lift-detail">
      <div className="detail">
        <dt className="kicker">Status</dt>
        <dd className={`detail-value ${status.className}`}>
          <span className="mark" aria-hidden="true" />
          {lift.statusLabel || status.label}
        </dd>
      </div>

      <div className="detail">
        <dt className="kicker">Perron</dt>
        <dd className="detail-value">
          {/* The same em dash the table uses, and hidden the same way: it is
              punctuation, not a value. But a <dd> holding only that is a value
              most screen readers pass over in silence, which leaves "Perron"
              paired with nothing at all — so the absence is stated in words
              that only they get. */}
          {lift.platform || (
            <>
              <span className="detail-empty" aria-hidden="true">
                —
              </span>
              <span className="sr-only">Niet opgegeven</span>
            </>
          )}
        </dd>
      </div>

      <div className="detail">
        <dt className="kicker">Station</dt>
        <dd className="detail-value">
          <Link href={`/stations/${lift.stationCode}`}>
            {lift.stationName || lift.stationCode}
          </Link>
        </dd>
      </div>
    </dl>
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
