// The page itself is a client component, so it cannot export metadata — and
// without this every station would share the root layout's title, leaving a
// stack of browser tabs and history entries all reading "Brakke Liften".
//
// The code rather than the station name: the name only exists once the client
// fetch resolves, and a title that rewrites itself after load is worse than one
// that is right from the first paint.
export async function generateMetadata({ params }) {
  const { stationCode } = await params;

  return {
    title: `${String(stationCode).toUpperCase()} — Brakke Liften`,
  };
}

export default function StationLayout({ children }) {
  return children;
}
