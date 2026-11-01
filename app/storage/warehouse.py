"""Local historical price store.

## Why this comes before any new feature

Every backtest so far re-fetched prices over the network and recomputed
everything from scratch. That caps the research at what a single run can pull:
63 names, 3 years, 53 dates. Every question the project still has open —
does the technical family carry any information, do chart patterns work, does a
factor survive across regimes — needs the opposite shape of data: thousands of
names over fifteen years, queried repeatedly and cheaply.

A local warehouse turns "one slow network run" into "one slow download, then
unlimited fast queries". It is not a feature; it is the thing that makes the
remaining features testable.

## What it records beyond the numbers

Provenance, because a price is not just a number:

* **source** — Yahoo and Alpha Vantage disagree, because one adjusts for splits
  and the other does not. A stored bar that does not say where it came from
  cannot be audited later.
* **adjusted** — whether splits and dividends are already applied. Mixing
  adjusted and unadjusted history inside one series produces a phantom crash on
  every split.
* **ingested_at** — when the row entered the store, so a suspect result can be
  traced to a particular download.

## What it deliberately does not do

It does not fix survivorship. A warehouse built from today's ticker list
contains today's survivors, however far back it reaches. Depth of history and
completeness of universe are different problems, and only the second one costs
money.
"""
import sqlite3
from datetime import datetime, timezone

import pandas as pd

from ..config import settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS prices_daily (
    ticker TEXT NOT NULL,
    date TEXT NOT NULL,
    open REAL, high REAL, low REAL, close REAL, volume REAL,
    source TEXT,
    adjusted INTEGER,
    PRIMARY KEY (ticker, date)
);
CREATE INDEX IF NOT EXISTS idx_prices_ticker ON prices_daily(ticker, date);

CREATE TABLE IF NOT EXISTS warehouse_meta (
    ticker TEXT PRIMARY KEY,
    first_date TEXT, last_date TEXT, rows INTEGER,
    source TEXT, adjusted INTEGER,
    ingested_at TEXT, refreshed_at TEXT,
    gap_days INTEGER, note TEXT
);
"""

COLUMNS = ["date", "open", "high", "low", "close", "volume"]


def connect():
    conn = sqlite3.connect(settings.warehouse_path)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def upsert(ticker: str, df: pd.DataFrame, meta: dict | None = None):
    """Store or refresh one ticker's history.

    Rows are keyed on (ticker, date), so re-downloading is idempotent and a
    later, better source simply overwrites an earlier one.
    """
    if df is None or df.empty:
        return {"ticker": ticker, "rows": 0, "status": "empty"}

    meta = meta or {}
    source = meta.get("source", "unknown")
    adjusted = 1 if meta.get("adjusted") else 0
    now = datetime.now(timezone.utc).isoformat()

    frame = df.copy()
    frame["date"] = pd.to_datetime(frame["date"]).dt.normalize()
    frame = frame.dropna(subset=["close"]).sort_values("date")

    payload = [
        (ticker.upper(), r.date.strftime("%Y-%m-%d"),
         _f(r.open), _f(r.high), _f(r.low), _f(r.close), _f(r.volume),
         source, adjusted)
        for r in frame.itertuples()
    ]

    with connect() as conn:
        conn.executemany(
            """INSERT INTO prices_daily
               (ticker, date, open, high, low, close, volume, source, adjusted)
               VALUES (?,?,?,?,?,?,?,?,?)
               ON CONFLICT(ticker, date) DO UPDATE SET
                 open=excluded.open, high=excluded.high, low=excluded.low,
                 close=excluded.close, volume=excluded.volume,
                 source=excluded.source, adjusted=excluded.adjusted""",
            payload)

        existing = conn.execute(
            "SELECT ingested_at FROM warehouse_meta WHERE ticker = ?",
            (ticker.upper(),)).fetchone()
        conn.execute(
            """INSERT INTO warehouse_meta
               (ticker, first_date, last_date, rows, source, adjusted,
                ingested_at, refreshed_at, gap_days, note)
               VALUES (?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(ticker) DO UPDATE SET
                 first_date=excluded.first_date, last_date=excluded.last_date,
                 rows=excluded.rows, source=excluded.source,
                 adjusted=excluded.adjusted, refreshed_at=excluded.refreshed_at,
                 gap_days=excluded.gap_days, note=excluded.note""",
            (ticker.upper(), payload[0][1], payload[-1][1], len(payload),
             source, adjusted,
             existing["ingested_at"] if existing else now, now,
             None, meta.get("note")))

    return {"ticker": ticker.upper(), "rows": len(payload),
            "first": payload[0][1], "last": payload[-1][1],
            "source": source, "adjusted": bool(adjusted), "status": "ok"}


def _f(v):
    try:
        f = float(v)
        return None if f != f else f      # NaN -> NULL
    except (TypeError, ValueError):
        return None


def load(ticker: str, start=None, end=None):
    """Read one ticker back out. Returns (df, meta) or (None, None)."""
    sql = "SELECT * FROM prices_daily WHERE ticker = ?"
    params = [ticker.upper()]
    if start:
        sql += " AND date >= ?"
        params.append(str(start)[:10])
    if end:
        sql += " AND date <= ?"
        params.append(str(end)[:10])
    sql += " ORDER BY date"

    with connect() as conn:
        rows = conn.execute(sql, params).fetchall()
        info = conn.execute("SELECT * FROM warehouse_meta WHERE ticker = ?",
                            (ticker.upper(),)).fetchone()

    if not rows:
        return None, None

    df = pd.DataFrame([dict(r) for r in rows])
    df["date"] = pd.to_datetime(df["date"])
    meta = dict(info) if info else {}
    meta["from_warehouse"] = True
    meta["adjusted"] = bool(meta.get("adjusted"))
    return df[COLUMNS].reset_index(drop=True), meta


def has(ticker: str, min_rows: int = 250, max_age_days: int = 7,
        min_years: float | None = None):
    """Is this ticker present, deep enough, fresh enough, and LONG enough?

    ``min_years`` matters more than it looks. Without it, a ticker stored with
    five years of history satisfies every later request forever: the entry is
    present and fresh, so a `--years 15` rebuild skips it and the warehouse can
    never get deeper. That is exactly what happened after the v3.0 range fix —
    the fix worked, but nothing re-downloaded, so the backtest kept reading the
    same 1254 rows and returned identical numbers.
    """
    with connect() as conn:
        row = conn.execute("SELECT * FROM warehouse_meta WHERE ticker = ?",
                           (ticker.upper(),)).fetchone()
    if not row or (row["rows"] or 0) < min_rows:
        return False

    if min_years is not None:
        span = _years(row["first_date"], row["last_date"])
        # Half a year of slack: a listing that IPO'd recently cannot be deeper
        # than its own history, and re-downloading it every run is pointless.
        if span is None or span < min_years - 0.5:
            return False

    try:
        refreshed = datetime.fromisoformat(row["refreshed_at"])
    except (TypeError, ValueError):
        return False
    age = (datetime.now(timezone.utc) - refreshed).days
    return age <= max_age_days


def detect_gaps(ticker: str, calendar_ticker: str = "SPY"):
    """Trading days the benchmark has but this ticker does not.

    A missing bar is not a neutral absence: a technical measure computed over a
    series with holes silently uses a different window than it claims to. Worth
    knowing which tickers are Swiss cheese before trusting any score built on
    them.
    """
    df, _ = load(ticker)
    cal, _ = load(calendar_ticker)
    if df is None or cal is None or df.empty or cal.empty:
        return {"ticker": ticker.upper(), "status": "unavailable"}

    lo, hi = df.date.min(), df.date.max()
    expected = set(cal.loc[(cal.date >= lo) & (cal.date <= hi), "date"])
    have = set(df.date)
    missing = sorted(expected - have)

    return {
        "ticker": ticker.upper(),
        "status": "ok",
        "first": str(lo.date()), "last": str(hi.date()),
        "rows": len(df),
        "expected_trading_days": len(expected),
        "missing_days": len(missing),
        "missing_pct": round(100.0 * len(missing) / max(len(expected), 1), 2),
        "worst_run": _longest_run(missing),
        "examples": [str(d.date()) for d in missing[:8]],
    }


def _longest_run(missing_dates):
    if not missing_dates:
        return 0
    best = run = 1
    for prev, cur in zip(missing_dates, missing_dates[1:]):
        run = run + 1 if (cur - prev).days <= 4 else 1
        best = max(best, run)
    return best


def coverage():
    """What is actually in the store, and is it deep enough to be useful?"""
    with connect() as conn:
        rows = [dict(r) for r in conn.execute(
            "SELECT * FROM warehouse_meta ORDER BY ticker").fetchall()]
        total = conn.execute("SELECT COUNT(*) c FROM prices_daily").fetchone()["c"]

    if not rows:
        return {"status": "empty",
                "message": ("Warehouse is empty. Populate it with "
                            "`python scripts/build_warehouse.py`.")}

    # Cross-check the metadata against the table it describes. These come from
    # different places -- meta records what an upsert believed it wrote, the
    # count is what is actually stored -- so a mismatch means something went
    # wrong mid-build, and every figure below is describing data that is not
    # there. Worth catching loudly: 76 tickers at a claimed 41.7-year median
    # cannot hold 17,526 rows, because 41 years is roughly 10,500 trading days.
    claimed = sum(r["rows"] or 0 for r in rows)
    integrity = None
    if total < claimed * 0.95:
        integrity = {
            "consistent": False,
            "rows_claimed_by_metadata": claimed,
            "rows_actually_stored": total,
            "shortfall": claimed - total,
            "note": (
                f"Metadata claims {claimed:,} rows but the table holds {total:,}. "
                "The most likely cause is that a build was still running when "
                "this was called — each ticker commits as it lands, so a "
                "half-finished download reports full metadata against partial "
                "data. Wait for the build to finish and check again. If the gap "
                "persists, the store is corrupt: delete warehouse.db and rebuild."
            ),
        }

    years = [(_years(r["first_date"], r["last_date"])) for r in rows]
    years = [y for y in years if y is not None]
    median_years = sorted(years)[len(years) // 2] if years else 0
    sources = {}
    unadjusted = 0
    for r in rows:
        sources[r["source"]] = sources.get(r["source"], 0) + 1
        if not r["adjusted"]:
            unadjusted += 1

    per_ticker = total / max(len(rows), 1)
    out = {
        "status": "ok" if integrity is None else "inconsistent",
        "tickers": len(rows),
        "price_rows": total,
        "rows_per_ticker": round(per_ticker),
        "median_years_of_history": round(median_years, 1),
        "sources": sources,
        "unadjusted_tickers": unadjusted,
        "earliest": min(r["first_date"] for r in rows),
        "latest": max(r["last_date"] for r in rows),
        "assessment": _assess(len(rows), median_years, unadjusted),
    }
    if integrity:
        out["integrity"] = integrity
        out["assessment"].insert(0, integrity["note"])
    elif median_years > 1.5 and per_ticker < median_years * 150:
        out["status"] = "inconsistent"
        out["integrity"] = {
            "consistent": False,
            "rows_per_ticker": round(per_ticker),
            "expected_rows_per_ticker": round(median_years * 252),
            "note": (
                "Stored bars are far too sparse for the date span they cover. "
                "This is downsampled data, not daily data — indicators computed "
                "on it would be meaningless. Delete warehouse.db and rebuild."
            ),
        }
        out["assessment"].insert(0, (
            f"Only {per_ticker:.0f} rows per ticker against a claimed "
            f"{median_years:.1f}-year median. Those are inconsistent — expect "
            f"about {median_years * 252:,.0f} daily bars for that span."))
    return out


def _years(first, last):
    try:
        a = datetime.strptime(first, "%Y-%m-%d")
        b = datetime.strptime(last, "%Y-%m-%d")
        return (b - a).days / 365.25
    except (TypeError, ValueError):
        return None


def _assess(n_tickers, median_years, unadjusted):
    notes = []
    if median_years < 8:
        notes.append(
            f"Median history is {median_years:.1f} years. That covers one market "
            "regime, so any factor result is a statement about this cycle rather "
            "than about markets. Aim for 15 years to include 2008, 2020 and 2022.")
    else:
        notes.append(f"Median history {median_years:.1f} years — spans several regimes.")

    if n_tickers < 300:
        notes.append(
            f"{n_tickers} tickers gives thin sector cohorts. Around 500+ is where "
            "a within-sector percentile starts to mean something.")
    else:
        notes.append(f"{n_tickers} tickers — wide enough for sector-relative work.")

    if unadjusted:
        notes.append(
            f"{unadjusted} ticker(s) stored from an UNADJUSTED source. Splits will "
            "read as crashes in those series; refresh them from an adjusted source.")

    notes.append(
        "Depth of history does not fix survivorship. Everything here is a company "
        "that still exists today, however far back the prices reach.")
    return notes
