import { formatDate } from "./backend";
import { liftName, statusOf } from "./station-card";

// Its own module rather than a corner of station-card.js: that one is imported
// by all three routes and Next code-splits per route, so the strip, the outage
// table and four formatters would ride into the overview's bundle — the page
// people actually arrive on — to be used by none of it.

// The four things a day can be, keyed by the character the backend packs the
// strip into. The first three are the upstream `open` values the rest of the
// site already names; "-" is the fourth, and a different fact from "Onbekend" —
// the cron did not run, or the lift did not exist yet, versus the NS saying it
// does not know. Our ignorance and theirs are not the same answer.
const DAY_STATE = {
  Y: { label: "In bedrijf", className: "day-up" },
  N: { label: "Buiten dienst", className: "day-down" },
  U: { label: "Onbekend", className: "day-unknown" },
  "-": { label: "Niet gemeten", className: "day-none" },
};

const nl = (value) => value.toLocaleString("nl-NL");

// "1 dag", "3 dagen", "1,5 dagen". Singular only on exactly one — Dutch keeps
// the plural for a decimal. One decimal at most: the data underneath is whole
// days, so a mean of 1,5 is meaningful and 1,53 is not.
function formatDays(days) {
  const value = days.toLocaleString("nl-NL", { maximumFractionDigits: 1 });

  return `${value} ${days === 1 ? "dag" : "dagen"}`;
}

function plural(count, one, many) {
  return `${nl(count)} ${count === 1 ? one : many}`;
}

// Whole percent, no decimals: the resolution underneath is one observation a
// day, so over 30 days a single day is 3,3 points and a tenth of a percent is
// noise dressed as precision.
//
// But never rounded *up* to 100 over a window that had a bad day, and never
// down to 0 over one that had a good day. "100% in bedrijf" above a table
// listing a storing is the one number on this page that would be an outright
// lie, and the clamp — not the rounding — is the point of this function.
function formatUptime(win) {
  if (win?.uptimePct == null) return null;

  let shown = Math.round(win.uptimePct);
  if (shown === 100 && win.upDays < win.decidedDays) shown = 99;
  if (shown === 0 && win.upDays > 0) shown = 1;

  return `${nl(shown)}%`;
}

function isoOf(stamp) {
  const month = String(stamp.getMonth() + 1).padStart(2, "0");
  const day = String(stamp.getDate()).padStart(2, "0");

  return `${stamp.getFullYear()}-${month}-${day}`;
}

// The backend packs the strip as one character per day plus the date the first
// of them falls on — ninety bytes instead of ninety objects. Expanded back out
// here, which is the only thing the page does with it.
function stripDays(strip) {
  if (!strip?.days || !strip.from) return [];

  const first = new Date(`${strip.from}T00:00:00`);

  return [...strip.days].map((symbol, index) => {
    const on = new Date(first);
    on.setDate(on.getDate() + index);

    return {
      iso: isoOf(on),
      state: DAY_STATE[symbol] || DAY_STATE["-"],
    };
  });
}

function countDays(days) {
  const counts = { up: 0, down: 0, unknown: 0, none: 0 };
  const key = { "day-up": "up", "day-down": "down", "day-unknown": "unknown" };

  for (const day of days) {
    counts[key[day.state.className] || "none"] += 1;
  }

  return counts;
}

// The line under the status on the detail band: how long this lift has been out
// right now. Not a ticking clock — the answer only changes when the cron runs
// again — so no timer and no state.
//
// The backend only fills these in for a lift the live sync also reports as out,
// so a lift repaired since this morning's measurement has no note rather than a
// stale one.
export function currentOutageNote(lift, history) {
  if (!history || lift.open !== "No" || !history.downSince) return null;

  // The start date is a lower bound too when the outage runs off the back of
  // what we have measured, so naming the day would claim more than we know.
  if (history.downSinceAtLeast) {
    return `Al minstens ${formatDays(history.downDays)} buiten dienst`;
  }

  return `Sinds ${formatDate(history.downSince, { year: true })}, ${formatDays(
    history.downDays,
  )}`;
}

// The one sentence everything below adds up to, for the page's live region: read
// out once the fetch resolves, so the status and the availability arrive on
// their own rather than having to be gone looking for.
export function statsSummary(lift, history) {
  const status = lift.statusLabel || statusOf(lift.open).label;

  if (!history || !history.measuredDays) {
    return `${status}. Er is nog geen geschiedenis van deze lift.`;
  }

  const win = history.windows?.["30"];
  if (!win || win.uptimePct == null) {
    return `${status}. We meten deze lift ${formatDays(
      history.measuredDays,
    )} — nog te weinig voor een percentage.`;
  }

  return `${status}. Over de laatste 30 dagen ${formatUptime(
    win,
  )} van de gemeten dagen in bedrijf, met ${plural(
    win.outageCount,
    "storing",
    "storingen",
  )}.`;
}

// One window's two figures, in the label-over-number pairs the design system
// uses for every figure. The group's own label is pointed at rather than
// repeated in an aria-label: "Laatste 30 dagen" only stands over these two
// visually, so it has to say so out loud as well — and once, not twice.
function WindowStats({ id, label, window: win }) {
  return (
    <div className="stat-group" role="group" aria-labelledby={id}>
      <span className="kicker stat-group-label" id={id}>
        {label}
      </span>
      <dl className="stats">
        <div className="stat">
          {/* "In bedrijf", not "Beschikbaar": it is the site's own word for this
              state, and — the reason it matters at 200% text — it breaks at a
              space, where "Beschikbaar" is eleven characters that cannot. */}
          <dt className="stat-label">In bedrijf</dt>
          <dd className="stat-value">{formatUptime(win)}</dd>
        </div>
        <div className="stat">
          <dt className="stat-label">Storingen</dt>
          {/* Red only when there is something to report, like the overview's
              counts: an emphatic red nought draws the eye to the one figure
              with nothing to say. At 30px/800 this is large-scale text, so the
              full accent clears its 3:1. */}
          <dd className={`stat-value${win.outageCount > 0 ? " down" : ""}`}>
            {nl(win.outageCount)}
          </dd>
        </div>
      </dl>
      <p className="stat-group-note">
        {win.unmeasuredDays === 0
          ? `${nl(win.windowDays)} dagen gemeten`
          : `${nl(win.measuredDays)} van ${nl(win.windowDays)} dagen gemeten`}
        {win.unknownDays > 0 &&
          `, waarvan ${plural(win.unknownDays, "dag onbekend", "dagen onbekend")}`}
      </p>
    </div>
  );
}

// An absent figure, in the form .lift-detail already uses for an absent
// platform: the dash is punctuation and stays out of the reading order, and the
// absence is stated in words that only a screen reader gets — a <dd> holding
// nothing but a dash is a value most of them pass over in silence.
function NoFigure({ children }) {
  return (
    <>
      <span className="detail-empty" aria-hidden="true">
        —
      </span>
      <span className="sr-only">{children}</span>
    </>
  );
}

// A number of days with its unit. .stat-of for the unit rather than a class of
// its own: visually it is exactly what that class is for — a smaller qualifier
// on a big figure — and "3" with "dagen" beside it is the same shape as "2"
// with "/ 14".
//
// `atLeast` is for a run that reaches the back of what we have measured: it may
// have started earlier, so the number is a floor and the unit says so instead
// of putting "minstens" in front of a 30px figure.
function DayFigure({ days, atLeast = false }) {
  return (
    <>
      {days.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}
      <span className="stat-of">
        {days === 1 ? " dag" : " dagen"}
        {atLeast && " of meer"}
      </span>
    </>
  );
}

export function LiftStats({ lift, history }) {
  // An older backend, or a lift the sync met for the first time today: the page
  // is complete without any of this, so it says so once and stops.
  if (!history || !history.measuredDays) {
    return (
      <section className="band" aria-labelledby="stats-empty">
        <div className="band-head">
          <h2 id="stats-empty">Beschikbaarheid</h2>
          <p className="band-note">
            We houden nog niet bij hoe vaak deze lift buiten dienst is. Zodra dat
            begint, zie je hier hoeveel van de gemeten dagen hij het deed.
          </p>
        </div>
      </section>
    );
  }

  const since = formatDate(history.measuringSince, { year: true });
  const win30 = history.windows?.["30"];
  const win90 = history.windows?.["90"];

  // Both windows hold the same numbers until there is more than 30 days of
  // history, and a "laatste 90 dagen" column repeating the 30-day one implies
  // history that is not there.
  const showLong = Boolean(win90 && win30 && win90.measuredDays > win30.measuredDays);
  const long = showLong ? win90 : win30;

  // The percentage is what too little history withholds — not the outages and
  // not the strip, which are honest at any length and are the whole reason
  // someone opened this page in the first week.
  const hasUptime = win30?.uptimePct != null;

  const days = stripDays(history.strip);
  const counts = countDays(days);
  const outages = history.outages || [];

  // The caveat that has to sit over every figure here: one observation a day is
  // the resolution, and a storing inside one interval is invisible. No clock
  // time — the cron fires at a fixed UTC hour, which is a different Dutch hour
  // in summer than in winter, and naming one of them is wrong half the year.
  const cadence =
    "De actuele status van een lift is nooit ouder dan 15 minuten. Statistieken worden echter per dag in de avond berekend. Een storing die binnen een dag is opgelost, zien we niet.";

  return (
    <>
      <section className="band" aria-labelledby="stats-uptime">
        <div className="band-head">
          <h2 id="stats-uptime">Beschikbaarheid</h2>
          <p className="band-note">
            {cadence} Gemeten sinds {since}, {formatDays(history.measuredDays)}.
            {hasUptime
              ? !showLong && " Er is nog geen 90 dagen geschiedenis."
              : win30 && win30.unknownDays >= win30.decidedDays
                ? " De NS wist het op de meeste van die dagen zelf niet, dus we kunnen er nog geen percentage van maken."
                : ` Dat is te weinig om er een percentage van te maken — vanaf ${formatDays(
                    history.minDecidedDays,
                  )} zie je hier hoe vaak deze lift het deed.`}
          </p>
        </div>

        {hasUptime && (
          <div className="stat-groups">
            <WindowStats
              id="stats-window-30"
              label="Laatste 30 dagen"
              window={win30}
            />
            {showLong && (
              <WindowStats
                id="stats-window-90"
                label="Laatste 90 dagen"
                window={win90}
              />
            )}
          </div>
        )}
      </section>

      {hasUptime && long && (
        <section className="band" aria-labelledby="stats-duration">
          <div className="band-head">
            <h2 id="stats-duration">Storingsduur</h2>
            <p className="band-note">
              Over de laatste {nl(long.windowDays)} dagen. Een storing duurt hier
              altijd een heel aantal dagen: korter dan één meting kunnen we niet
              zien.
              {long.mttrDays == null &&
                " Er is nog geen storing die weer voorbij is, dus ook nog geen gemiddelde hersteltijd."}
            </p>
          </div>

          <dl className="stats">
            <div className="stat">
              <dt className="stat-label">Langste storing</dt>
              <dd className="stat-value">
                {long.longestOutageDays ? (
                  <DayFigure
                    days={long.longestOutageDays}
                    atLeast={long.longestOutageAtLeast}
                  />
                ) : (
                  <NoFigure>Geen storing gemeten</NoFigure>
                )}
              </dd>
            </div>
            <div className="stat">
              {/* "Gemiddeld hersteld na", not "Gemiddelde hersteltijd": every
                  word in it breaks at a space, and "hersteltijd" on its own is
                  eleven characters that cannot. */}
              <dt className="stat-label">Gemiddeld hersteld na</dt>
              <dd className="stat-value">
                {long.mttrDays != null ? (
                  <DayFigure days={long.mttrDays} />
                ) : (
                  <NoFigure>Nog geen storing die voorbij is</NoFigure>
                )}
              </dd>
            </div>
          </dl>
        </section>
      )}

      <section className="band" aria-labelledby="stats-history">
        <div className="band-head">
          <h2 id="stats-history">Storingsgeschiedenis</h2>
          <p className="band-note">
            {outages.length === 0
              ? `Sinds ${since} zagen we geen enkele dag dat deze lift buiten dienst was.`
              : `${
                  outages.length >= 10
                    ? "De tien meest recente storingen"
                    : "Elke storing die we zagen"
                }, nieuwste eerst.`}
          </p>
        </div>

        {outages.length > 0 && (
          <table className="lift-table outage-table">
            {/* Named for the same reason .lift-table is: a table with no name of
                its own says nothing about which lift it belongs to once it is
                read out of its place on the page. */}
            <caption className="sr-only">
              Storingen van lift {liftName(lift.name, lift.stationCode)} op{" "}
              {lift.stationName || lift.stationCode}, nieuwste eerst
            </caption>
            <thead>
              <tr>
                <th className="col-start" scope="col">
                  Begindatum
                </th>
                <th className="col-days" scope="col">
                  Duur
                </th>
                {/* "Melding" rather than "Reden": the NS statusLabel is a status
                    string, and a column called Reden promises an explanation the
                    data does not contain. */}
                <th className="col-reason" scope="col">
                  Melding
                </th>
              </tr>
            </thead>
            <tbody>
              {outages.map((outage) => (
                <tr
                  className={`outage-row${outage.ongoing ? " open" : ""}`}
                  key={outage.startedOn}
                >
                  <td className="col-start">
                    {outage.atLeast ? (
                      <>
                        {/* The run reaches the back of what we measured, so the
                            date is a floor rather than the day it broke. */}
                        <span aria-hidden="true">≤ </span>
                        <span className="sr-only">Op of voor </span>
                        <time dateTime={outage.startedOn}>
                          {formatDate(outage.startedOn, { year: true })}
                        </time>
                      </>
                    ) : (
                      <time dateTime={outage.startedOn}>
                        {formatDate(outage.startedOn, { year: true })}
                      </time>
                    )}
                  </td>
                  {/* The tint says "this one is not over" at a glance; the words
                      say it to everyone else. Every row keeps all three cells,
                      which is what the narrow layout depends on. */}
                  <td className="col-days outage-days">
                    {outage.atLeast ? "minstens " : ""}
                    {formatDays(outage.days)}
                    {outage.ongoing && (
                      <>
                        {", "}
                        <span className="outage-open">loopt nog</span>
                      </>
                    )}
                  </td>
                  <td className="col-reason">
                    {outage.statusLabel || "Onbekend"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {days.length > 0 && (
        <section className="band" aria-labelledby="stats-days">
          <div className="band-head">
            <h2 id="stats-days">Dag voor dag</h2>
            <p className="band-note">
              Eén blok per dag, de oudste links.
            </p>
          </div>

          {/* Not an aria-hidden strip with a sentence under it: the strip *is*
              the data, and collapsing ninety facts to one throws away which
              days. This summary is what the list adds up to, so that hearing
              all ninety is a choice rather than the only way in. */}
          <p className="sr-only">
            {plural(counts.up, "dag in bedrijf", "dagen in bedrijf")},{" "}
            {plural(counts.down, "dag buiten dienst", "dagen buiten dienst")},{" "}
            {plural(counts.unknown, "dag onbekend", "dagen onbekend")} en{" "}
            {plural(counts.none, "dag niet gemeten", "dagen niet gemeten")}.
            {outages.length > 0 &&
              " Elke storing staat ook in de tabel hierboven."}
          </p>

          {/* role="list" is restated deliberately: WebKit drops the list role
              from a list with list-style:none, and without it the ninety day
              labels below run together as one block of text with no way to step
              over them. Real .sr-only text per item rather than an aria-label on
              an empty <li>, which is the kind of thing that works in three of
              four screen readers.

              No focusable elements and no title tooltips: a title reaches
              neither keyboard nor touch, ninety tab stops in front of the rest
              of the page is worse than none, and 9px targets would fail 2.5.8
              outright. What a tooltip would say is in the table above, in a form
              that works for everyone. */}
          <ol className="daystrip" role="list">
            {days.map((day) => (
              <li className={`day ${day.state.className}`} key={day.iso}>
                {/* No year: it is ninety strings, and the range is stated once,
                    visibly, under the strip. */}
                <span className="sr-only">
                  {formatDate(day.iso)}: {day.state.label}
                </span>
              </li>
            ))}
          </ol>

          {/* Hidden from the accessibility tree in one piece, and this is the
              case aria-hidden is for: a legend maps a visual encoding onto words
              that every day above already carries. */}
          <ul className="daystrip-legend" aria-hidden="true">
            <li>
              <span className="day day-up" />
              In bedrijf
            </li>
            <li>
              <span className="day day-down" />
              Buiten dienst
            </li>
            <li>
              <span className="day day-unknown" />
              Onbekend
            </li>
            <li>
              <span className="day day-none" />
              Niet gemeten
            </li>
          </ul>

          <p className="daystrip-foot">
            Gemeten sinds {since}.
            {counts.none > 0 &&
              ` ${nl(counts.none)} van deze ${nl(
                days.length,
              )} dagen zijn niet gemeten.`}
          </p>
        </section>
      )}
    </>
  );
}
