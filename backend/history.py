"""The daily lift history: its one writer, and the figures derived from it.

`lift_day` is written once a day by the cron and read by the per-lift page. The
per-lift figures are *derived on read*, not stored in a rollup table, and that is
a deliberate choice rather than a shortcut: one lift's window is at most a couple
of hundred rows on the primary key, which is cheaper than the staleness check the
same route already runs, and a rollup written at 17:00 would still be claiming
"in bedrijf" the next morning for a lift that broke overnight — which is the one
thing this site exists to get right. Adding a year-long window is also a change
to WINDOWS and nothing else, with no backfill job.

If the overview ever needs uptime for a thousand lifts in one request, that is
when a rollup table earns its place. The single-lift route should keep deriving.
"""

from collections.abc import Sequence
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from models import Lift, LiftDay, LiftOpen, SyncState
from sqlalchemy import Date, case, func, literal, null, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

# Windows the lift page reports. Rolling, both derived from one fetch, so adding
# a year window later is a change to this tuple and nothing else.
WINDOWS = (30, 90)

# The day-by-day strip on the lift page.
STRIP_DAYS = 90

# How much history is read *before* the longest window, so an outage that started
# before the window can be reported at its real length instead of clipped at the
# window edge — a lift that has been broken for four months is a four-month
# outage on the 30-day panel too.
CONTEXT_DAYS = 90

FETCH_DAYS = max(*WINDOWS, STRIP_DAYS) + CONTEXT_DAYS

# Below this many *decided* days (worked or was broken — see window_stats), no
# uptime percentage is reported at all. Three days of "Yes" is not 100% uptime,
# it is three days of data, and a number is read as a number no matter what is
# printed next to it. A week is the shortest base a reader would accept and the
# shortest that spans a full weekday cycle.
MIN_DECIDED_DAYS = 7

# An outage is not broken by up to this many consecutive days we have no answer
# for — one missed cron plus its retry. A lift reading "No" on both sides of a
# single blank day was not repaired and re-broken in between. Past that the gap
# is real ignorance (a deploy before this table existed, a lift that dropped out
# of the NS feed for a month) and the run is cut rather than invented.
MAX_BRIDGE_DAYS = 2

# How many outages the payload carries. The page shows a table of them, not a
# complete archive; the strip is what says "and it goes back further".
MAX_OUTAGES = 10

# The lift data must be at most this old for a day to be recorded from it. The
# cron syncs first, but ns.sync_if_stale swallows a failed fetch, so without this
# guard a week of NS downtime would be written into permanent history as a week
# of working lifts. Well past ns.MAX_AGE, so an ordinary quiet day still records.
MAX_RECORD_AGE = timedelta(hours=6)

# Its own advisory lock, distinct from ns.SYNC_LOCK_KEY: a retried cron
# invocation should skip the write rather than repeat a thousand-row upsert
# alongside the first one. Note that sync_if_stale's lock is already gone by the
# time recording starts — record_attempt commits mid-transaction, which ends the
# transaction the lock was held for. The upsert is idempotent either way, so this
# is about not doing the work twice, not about correctness.
RECORD_LOCK_KEY = 8_400_281

# Strip legend, one character per day: worked, out of service, upstream said
# Unknown, nobody looked.
STRIP_SYMBOLS = {LiftOpen.YES: "Y", LiftOpen.NO: "N", LiftOpen.UNKNOWN: "U"}
UNMEASURED = "-"

AMSTERDAM = ZoneInfo("Europe/Amsterdam")


def today_in_amsterdam() -> date:
    """The calendar day a Dutch reader would name.

    Not UTC, and not the database's `current_date`: the cron fires at 17:00 UTC,
    which is the same Dutch day either way, but "buiten dienst sinds
    4 september" has to mean the day it says regardless of where this runs or
    what the Postgres session's TimeZone happens to be.
    """
    return datetime.now(AMSTERDAM).date()


# ── Recording ──────────────────────────────────────────────────────────────────


async def record_day(session: AsyncSession, observed_on: date) -> dict:
    """Write the current state of every lift into `lift_day` for one day.

    Idempotent by construction: the primary key is (lift_id, observed_on) and a
    second run of the same day overwrites it, so last write wins. That makes the
    day's row mean "the state the last time we looked on that day", which is the
    only thing a daily sample can honestly mean — an outage that started and was
    fixed between two runs is invisible, and at daily resolution that is correct.

    "Worst state wins for the day" is defensible — an outage seen at any point in
    the day was real — but it makes the row disagree with a plain reading of the
    current state, biases uptime pessimistic, and with one scheduled run a day it
    would never fire. Please do not "fix" this to that.
    """
    # sync_if_stale swallows failures, so "the cron ran" is not "the data is
    # fresh". Recording a stale fetch would put a fabricated Yes into permanent
    # history; leaving the day unrecorded reports it as unmeasured, which is
    # exactly why the table is dense.
    synced_at = await session.scalar(
        select(SyncState.synced_at).where(SyncState.id == 1)
    )
    if synced_at is None or datetime.now(UTC) - synced_at > MAX_RECORD_AGE:
        return {
            "observedOn": observed_on.isoformat(),
            "recorded": 0,
            "note": "lift data too stale to record",
        }

    if not await session.scalar(
        select(func.pg_try_advisory_xact_lock(RECORD_LOCK_KEY))
    ):
        return {
            "observedOn": observed_on.isoformat(),
            "recorded": 0,
            "note": "already recording",
        }

    # INSERT ... SELECT rather than reading the lifts into Python and sending
    # them back: the states being recorded are already in the database, and one
    # statement also means a sync committing halfway through cannot record a mix
    # of two fetches.
    day_select = select(
        Lift.id,
        literal(observed_on, Date),
        Lift.open,
        # Only for a lift that is not working; see LiftDay.status_label.
        case((Lift.open == LiftOpen.YES, null()), else_=Lift.status_label),
    )
    day_insert = insert(LiftDay).from_select(
        ["lift_id", "observed_on", "open", "status_label"], day_select
    )
    await session.execute(
        day_insert.on_conflict_do_update(
            index_elements=[LiftDay.lift_id, LiftDay.observed_on],
            set_={
                "open": day_insert.excluded.open,
                "status_label": day_insert.excluded.status_label,
                # Not excluded.recorded_at: that would be the server_default as
                # evaluated for the insert. now() is the transaction clock, so a
                # rewritten day carries the time it was rewritten.
                "recorded_at": func.now(),
            },
        )
    )
    # Counted rather than taken from rowcount, which INSERT ... SELECT reports as
    # -1 here. This number is the daily signal in the cron log that the day
    # landed, so it has to be a number.
    recorded = await session.scalar(
        select(func.count()).where(LiftDay.observed_on == observed_on)
    )
    await session.commit()

    return {"observedOn": observed_on.isoformat(), "recorded": recorded}


async def day_summary(session: AsyncSession, observed_on: date) -> dict:
    """The network-level aggregate the cron reports for the day it recorded.

    This is the cron's statistics step. Deliberately not a per-lift rollup: the
    per-lift figures are derived on read (see the module docstring), and a
    thousand-lift pass in Python is work a serverless invocation that has just
    spent its budget on the NS API cannot promise. It rolls the same window up
    one level, and it doubles as the line in the cron log that says the day
    landed.
    """
    by_state = dict(
        (
            await session.execute(
                select(LiftDay.open, func.count())
                .where(LiftDay.observed_on == observed_on)
                .group_by(LiftDay.open)
            )
        ).all()
    )

    # The one query that uses ix_lift_day_observed_on, and the reason it exists.
    up, down = (
        await session.execute(
            select(
                func.count().filter(LiftDay.open == LiftOpen.YES),
                func.count().filter(LiftDay.open == LiftOpen.NO),
            ).where(LiftDay.observed_on > observed_on - timedelta(days=STRIP_DAYS))
        )
    ).one()

    return {
        "open": by_state.get(LiftOpen.YES, 0),
        "closed": by_state.get(LiftOpen.NO, 0),
        "unknown": by_state.get(LiftOpen.UNKNOWN, 0),
        "uptimePct": round(100 * up / (up + down), 1) if up + down else None,
    }


# ── Derivation ─────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Day:
    """One calendar day, measured or not.

    `open` is None for a day with no row at all: the cron did not run, or the
    lift did not exist yet. That is a different fact from LiftOpen.UNKNOWN, which
    is the NS saying it does not know, and the two must not be collapsed — one is
    our ignorance, the other is theirs.
    """

    on: date
    open: LiftOpen | None
    status_label: str | None


@dataclass(frozen=True)
class Outage:
    """A run of days on which the lift was observed out of service."""

    started_on: date
    # The last day it was *observed* down, not the day it was fixed: a daily
    # sample cannot see the repair, only the first day after it.
    ended_on: date
    # The first day it was observed working again, or None while it is still down
    # or while the run was cut by a gap rather than by a repair.
    repaired_by: date | None
    # The upstream label from the most recent observed down day of the run, so an
    # ongoing outage carries the current wording rather than a stale one.
    status_label: str | None
    # The run reaches the oldest day we have data for, so it may have started
    # earlier and its length is a lower bound.
    truncated: bool

    @property
    def days(self) -> int:
        return (self.ended_on - self.started_on).days + 1

    @property
    def closed(self) -> bool:
        return self.repaired_by is not None


async def fetch_history(
    session: AsyncSession, lift_id: str, today: date
) -> tuple[Sequence, date | None, int]:
    """Every observation for one lift that any reported figure needs.

    One range scan on the primary key for the longest window plus its context,
    and one aggregate over the lift's whole history for the two figures that must
    not be limited to that window: when measuring started, and how many days have
    actually been measured.
    """
    rows = (
        await session.execute(
            select(LiftDay.observed_on, LiftDay.open, LiftDay.status_label)
            .where(
                LiftDay.lift_id == lift_id,
                LiftDay.observed_on > today - timedelta(days=FETCH_DAYS),
            )
            .order_by(LiftDay.observed_on)
        )
    ).all()

    measuring_since, measured_days = (
        await session.execute(
            select(func.min(LiftDay.observed_on), func.count()).where(
                LiftDay.lift_id == lift_id
            )
        )
    ).one()

    return rows, measuring_since, measured_days


def day_series(rows: Sequence, first_day: date, last_day: date) -> list[Day]:
    """One entry per calendar day in the span, with the gaps spelled out.

    The gaps are the point: every figure below distinguishes "the lift worked"
    from "nobody looked", and that is only possible on a series with a slot for
    each day rather than on the rows that happen to exist.
    """
    by_day = {row.observed_on: row for row in rows}
    span = (last_day - first_day).days + 1
    series = []

    for offset in range(span):
        on = first_day + timedelta(days=offset)
        row = by_day.get(on)
        series.append(
            Day(on, row.open if row else None, row.status_label if row else None)
        )

    return series


def find_outages(
    series: list[Day], measuring_since: date | None = None
) -> list[Outage]:
    """Every outage in the series, oldest first.

    An outage is a maximal run of consecutive calendar days that begins and ends
    on a day the lift was observed out of service, contains no day it was
    observed working, and contains no run of more than MAX_BRIDGE_DAYS days we
    have no answer for.

    So a working day is the only thing that ends a run — it is the only positive
    evidence of a repair. One or two undecided days in the middle bridge a run and
    count toward its length, because the lift was demonstrably broken on both
    sides of them. Three or more cut it, which can split one real outage into two
    and inflate the count; that is the honest report, because we genuinely stopped
    knowing.
    """
    if not series:
        return []

    outages: list[Outage] = []
    started_on: date | None = None
    last_down: date | None = None
    label: str | None = None
    undecided = 0

    for day in series:
        if day.open is LiftOpen.NO:
            if started_on is None:
                started_on = day.on
            # Overwritten every down day, so the label is the most recent one.
            label = day.status_label
            last_down = day.on
            undecided = 0
        elif day.open is LiftOpen.YES:
            if started_on is not None:
                outages.append(Outage(started_on, last_down, day.on, label, False))
                started_on = None
            undecided = 0
        else:
            # Unknown upstream, or no observation at all: not evidence of a
            # repair, so it bridges a short gap and cuts a long one.
            undecided += 1
            if started_on is not None and undecided > MAX_BRIDGE_DAYS:
                outages.append(Outage(started_on, last_down, None, label, False))
                started_on = None

    if started_on is not None:
        outages.append(Outage(started_on, last_down, None, label, False))

    # An outage that reaches the oldest day in the series may have begun before
    # it — unless measuring itself began on that day or later, in which case
    # there is nothing earlier to have missed.
    oldest = series[0].on
    clipped = measuring_since is None or measuring_since < oldest

    return [replace(o, truncated=clipped and o.started_on == oldest) for o in outages]


def window_stats(
    series: list[Day], outages: list[Outage], window_days: int, today: date
) -> dict:
    """The figures for one rolling window, ending today."""
    first = today - timedelta(days=window_days - 1)
    in_window = [day for day in series if day.on >= first]

    up = sum(1 for day in in_window if day.open is LiftOpen.YES)
    down = sum(1 for day in in_window if day.open is LiftOpen.NO)
    unknown = sum(1 for day in in_window if day.open is LiftOpen.UNKNOWN)
    measured = up + down + unknown
    decided = up + down

    # Outages counted here are the ones with at least one observed down day
    # inside the window, reported at their real length rather than the part that
    # fell inside it. Clipping a 120-day outage to 30 would understate exactly
    # the lift a reader most needs to see.
    window_outages = [o for o in outages if o.ended_on >= first]
    longest = max(window_outages, key=lambda o: o.days, default=None)

    # Mean time to repair over closed outages only, and only those whose start we
    # actually saw. An ongoing outage has not been repaired yet; folding it in
    # would move the mean every day for a reason that has nothing to do with how
    # fast anything gets fixed, dragging it down at the start of a long outage
    # and up at the end.
    repaired = [o for o in window_outages if o.closed and not o.truncated]

    return {
        "windowDays": window_days,
        "from": first.isoformat(),
        "to": today.isoformat(),
        # The base every figure below rests on, always reported, so the page can
        # phrase "over 40 gemeten dagen" instead of "over 90 dagen".
        "measuredDays": measured,
        "decidedDays": decided,
        "upDays": up,
        "downDays": down,
        "unknownDays": unknown,
        "unmeasuredDays": window_days - measured,
        # Unknown and unmeasured days are in neither the numerator nor the
        # denominator: uptime is "of the days we know the answer, how often was
        # the lift usable". Counting Unknown as working flatters, as broken
        # slanders, and there is no third honest option. None below
        # MIN_DECIDED_DAYS, so a two-day-old lift cannot report 100%.
        "uptimePct": (
            round(100 * up / decided, 1) if decided >= MIN_DECIDED_DAYS else None
        ),
        "outageCount": len(window_outages),
        "longestOutageDays": longest.days if longest else None,
        "longestOutageOngoing": bool(longest and not longest.closed),
        # The longest outage runs off the start of what we have, so its length is
        # "minstens N dagen".
        "longestOutageAtLeast": bool(longest and longest.truncated),
        "mttrDays": (
            round(sum(o.days for o in repaired) / len(repaired), 1)
            if repaired
            else None
        ),
        # A mean over one outage is a single measurement; say so, rather than let
        # it read as a rate.
        "mttrSampleSize": len(repaired),
    }


def day_strip(series: list[Day], today: date) -> str:
    """The last STRIP_DAYS days as one character per day, oldest first.

    A string rather than ninety objects: it is ninety bytes instead of some five
    kilobytes, and the page indexes it by day offset from `from`, which is the
    only thing it does with it. See STRIP_SYMBOLS for the legend.
    """
    first = today - timedelta(days=STRIP_DAYS - 1)

    return "".join(
        STRIP_SYMBOLS[day.open] if day.open else UNMEASURED
        for day in series
        if day.on >= first
    )


def _outage_dict(outage: Outage, ongoing: bool) -> dict:
    return {
        "startedOn": outage.started_on.isoformat(),
        "endedOn": outage.ended_on.isoformat(),
        "repairedBy": outage.repaired_by.isoformat() if outage.repaired_by else None,
        "days": outage.days,
        "statusLabel": outage.status_label,
        "ongoing": ongoing,
        "atLeast": outage.truncated,
    }


def summarize(
    rows: Sequence,
    measuring_since: date | None,
    measured_days: int,
    current_open: LiftOpen,
    today: date,
) -> dict:
    """Everything the lift page reports about one lift's history.

    `current_open` comes from the lifts table, not from the history: the daily
    sample is up to a day behind the 15-minute sync, and "buiten dienst sinds"
    must not survive a repair the sync has already seen.
    """
    series = day_series(rows, today - timedelta(days=FETCH_DAYS - 1), today)
    outages = find_outages(series, measuring_since)

    # Ongoing means the run reaches the most recent days *and* the lift is out
    # right now. A run left open by the bridge rule ended long ago and is
    # history; a lift the sync has since seen working is not out at all, however
    # this morning's row reads.
    last = outages[-1] if outages else None
    ongoing = (
        last
        if last
        and not last.closed
        and last.ended_on >= today - timedelta(days=MAX_BRIDGE_DAYS)
        and current_open is LiftOpen.NO
        else None
    )

    return {
        "measuringSince": measuring_since.isoformat() if measuring_since else None,
        "measuredDays": measured_days,
        "recordedThrough": rows[-1].observed_on.isoformat() if rows else None,
        # The threshold below which no percentage is reported, so the page can
        # name it in its "too little history yet" copy without keeping a second
        # copy of the number.
        "minDecidedDays": MIN_DECIDED_DAYS,
        # Null when the lift is working, and also when it is broken but the
        # history has not caught up: it broke after today's cron, or the history
        # is younger than the outage. The page then says "buiten dienst" without
        # a date rather than guessing one.
        "downSince": ongoing.started_on.isoformat() if ongoing else None,
        "downDays": ongoing.days if ongoing else None,
        "downSinceAtLeast": bool(ongoing and ongoing.truncated),
        "windows": {
            str(days): window_stats(series, outages, days, today) for days in WINDOWS
        },
        # Newest first, so the ongoing one — always the last chronologically — is
        # the first row of the page's table.
        "outages": [
            _outage_dict(outage, outage is ongoing)
            for outage in outages[::-1][:MAX_OUTAGES]
        ],
        "strip": {
            "from": (today - timedelta(days=STRIP_DAYS - 1)).isoformat(),
            "to": today.isoformat(),
            "days": day_strip(series, today),
        },
    }
