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
// are already established by the card the name sits in, so neither carries
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

function words(value) {
  return String(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// Plenty of names already spell the platform out ("Lift perron 2a"), and the
// badge next to it would then say the same thing twice. Both sides are compared
// per word: that keeps a platform "1" from being swallowed by a name mentioning
// "12", while a platform written "10/11" still matches a name saying "10-11".
function nameMentionsPlatform(name, platform) {
  const found = words(name);
  const needles = words(platform);
  return needles.length > 0 && needles.every((word) => found.includes(word));
}

// Sorted on the *displayed* name, not the upstream one: the backend's ordering
// is by the raw name, so a card mixing "Lift 2" with "ASD Lift 1" comes out in
// an order the stripped names no longer explain. `numeric` so lift 10 follows
// lift 9 instead of lift 1.
function byName(a, b) {
  return liftName(a.name, a.stationCode).localeCompare(
    liftName(b.name, b.stationCode),
    "nl",
    { numeric: true, sensitivity: "base" },
  );
}

// `linked` is off on the station's own page: the heading would link to the page
// it is already on.
export function StationCard({ station, linked = false }) {
  // No name known for this code: the code is the heading, so showing it again
  // as a subtitle would just repeat it.
  const heading = station.stationName || station.stationCode;
  // Copied first — sort mutates, and the array belongs to the caller's state.
  const lifts = [...station.lifts].sort(byName);

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
        {lifts.map((lift) => {
          const status = statusOf(lift.open);
          return (
            <li className={`lift ${status.className}`} key={lift.id}>
              <span className="dot" aria-hidden="true" />
              <span className="lift-name">
                {liftName(lift.name, lift.stationCode)}
              </span>
              {lift.platform &&
                !nameMentionsPlatform(lift.name, lift.platform) && (
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
  );
}
