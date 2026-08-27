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
