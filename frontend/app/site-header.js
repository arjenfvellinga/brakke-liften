import Link from "next/link";

import { formatSynced } from "./backend";

// The bar every page opens with: wordmark, what the site is, and how old the
// data is. `syncedAt` is null until the first fetch resolves, so the timestamp
// simply is not there yet rather than showing a placeholder.
export function SiteHeader({ syncedAt }) {
  const synced = formatSynced(syncedAt);

  return (
    <header className="nav">
      <div className="nav-inner">
        <Link className="nav-brand" href="/">
          Brakke liften
        </Link>
        <span className="nav-note">Liftstoringen op NS-stations</span>
        {synced && (
          <span className="nav-synced">
            Bijgewerkt <time dateTime={syncedAt}>{synced}</time>
          </span>
        )}
      </div>
    </header>
  );
}
