export const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "/svc/api";

// The backend sends `syncedAt` as UTC ISO-8601; toLocaleString renders it in the
// viewer's own zone, which for a Dutch site is the zone the NS data belongs to.
// Only ever called after the fetch resolves, so it cannot cause a hydration
// mismatch with the server render.
export function formatSynced(iso) {
  if (!iso) return null;
  const stamp = new Date(iso);
  if (Number.isNaN(stamp.getTime())) return null;

  return stamp.toLocaleString("nl-NL", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// `numeric: "always"` so this says "1 dag geleden" rather than "gisteren": the
// whole point of the line is how stale the data is, and "gisteren" is a date
// where the reader wants a duration.
const RELATIVE = new Intl.RelativeTimeFormat("nl", { numeric: "always" });

// Largest first — the loop takes the first unit the age actually fills.
const UNITS = [
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

// How long ago the sync was, in words. A request refreshes the lifts as soon as
// it finds them older than 15 minutes, so the answer is nearly always a small
// number of minutes — which a clock time makes the reader work out for
// themselves. `now` is passed in rather than read here so the caller's timer
// controls when the string changes.
export function formatAge(iso, now = Date.now()) {
  if (!iso) return null;
  const stamp = new Date(iso);
  if (Number.isNaN(stamp.getTime())) return null;

  // Clamped at zero: a stamp a second or two in the future (the browser's clock
  // running behind the server's) would otherwise read "over 1 minuut".
  const seconds = Math.max(0, Math.round((now - stamp.getTime()) / 1000));
  if (seconds < 60) return "zojuist";

  for (const [unit, size] of UNITS) {
    if (seconds >= size) {
      return RELATIVE.format(-Math.floor(seconds / size), unit);
    }
  }
}
