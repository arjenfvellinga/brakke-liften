"""Station code -> station name lookup.

`stations.json` was pulled once from the Places API
(`GET /places-api/v2/places?type=stationV2`), which returns one `stationV2`
place whose `locations` each carry a `stationCode` and a `name`, and trimmed to
the codes that actually appear in the `lifts` table. The lifts endpoint itself
only reports `stationCode`, so this file is the only place the names come from;
re-run that query and regenerate the file when NS opens a station.
"""

import json
from functools import cache
from pathlib import Path

STATIONS_PATH = Path(__file__).resolve().parent / "stations.json"


@cache
def station_names() -> dict[str, str]:
    """Return the whole code -> name mapping, read from disk once."""
    with STATIONS_PATH.open(encoding="utf-8") as file:
        return json.load(file)


def station_name(station_code: str) -> str | None:
    """Return the station's name, or None for a code the file does not know."""
    return station_names().get(station_code)
