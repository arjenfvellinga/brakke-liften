import { liftIdFromParam } from "../../../../station-card";

// Like the station page, the lift page is a client component and cannot export
// metadata — and without a title of its own every lift would share the station
// layout's, which is the same failure one level down (SC 2.4.2).
//
// Built from the URL rather than the payload: the lift's own name only exists
// once the client fetch resolves, and a title that rewrites itself after load is
// worse than one that is right from the first paint. The upstream id is all
// there is, so this takes its last segment — "NL:CHB:LiftEquipment:8400280_001"
// gives "8400280_001", the part that actually distinguishes one lift from
// another. Not pretty, but it is stable, unique, and the station code beside it
// says where the page belongs.
export async function generateMetadata({ params }) {
  const { stationCode, liftId } = await params;
  // Decoded here where useParams' segment is not — the two disagree, so both
  // go through the helper rather than either one trusting what it is handed.
  const ref = liftIdFromParam(liftId).split(":").pop();

  return {
    title: `Lift ${ref} — ${String(stationCode).toUpperCase()} — Brakke Liften`,
  };
}

export default function LiftLayout({ children }) {
  return children;
}
