"""Close out logged decisions against what actually happened.

Shared by ``POST /api/v1/calibration/resolve`` and ``scripts/calibration.py``.

Three things the earlier resolver got wrong, each of which would have biased the
forward test that the whole project now rests on:

1. **Wrong exit date.** It took the *latest* close, so a decision resolved two
   months late was scored over five months, not three. The exit is now the last
   close on or before ``due_at``.
2. **Stale prices.** ``prices.daily`` reads the local warehouse first, which is
   refreshed monthly. Resolution now always goes to the network.
3. **No benchmark.** "ACCUMULATE names rose 4%" means nothing if the market rose
   6%. Every outcome now records the benchmark's return over the same window,
   and the excess return is what the report ranks on.

Entry and exit are both read from one freshly fetched adjusted series, so a
dividend paid inside the window is counted the same way on both sides. A
decision whose window the series does not cover is reported as failed rather
than guessed.
"""
from datetime import datetime

import pandas as pd

from ..providers import prices
from . import db

BENCHMARK = "SPY"


def _naive(ts):
    ts = pd.Timestamp(ts)
    return ts.tz_convert(None) if ts.tzinfo else ts


def _close_on_or_before(df: pd.DataFrame, when: datetime):
    """Last close dated on or before the calendar day of ``when``."""
    day = _naive(when).normalize()
    dates = pd.to_datetime(df["date"])
    if dates.dt.tz is not None:
        dates = dates.dt.tz_convert(None)
    mask = (dates.dt.normalize() <= day).to_numpy()
    if not mask.any():
        return None, None
    i = mask.nonzero()[0][-1]
    return float(df["close"].iloc[i]), dates.iloc[i]


def window_return(df: pd.DataFrame, start: datetime, end: datetime):
    """Percent return from the close on/before ``start`` to the close on/before ``end``."""
    p0, d0 = _close_on_or_before(df, start)
    p1, d1 = _close_on_or_before(df, end)
    if p0 is None or p1 is None or p0 <= 0:
        return None
    return {"entry": p0, "exit": p1, "entry_date": d0, "exit_date": d1,
            "return_pct": 100.0 * (p1 / p0 - 1.0)}


def _fetch(ticker, cache):
    if ticker not in cache:
        df, _ = prices.daily(ticker, use_warehouse=False)
        cache[ticker] = df
    return cache[ticker]


def resolve_due(fetch=None):
    """Resolve every decision past its horizon. Returns (resolved, failed, due_count).

    ``fetch(ticker) -> DataFrame`` is injectable for tests.
    """
    cache = {}
    fetch = fetch or (lambda t: _fetch(t, cache))
    due = db.due_decisions()
    resolved, failed = [], []

    try:
        bench_df = fetch(BENCHMARK)
    except Exception:
        bench_df = None

    for d in due:
        try:
            start = datetime.fromisoformat(d["created_at"])
            end = datetime.fromisoformat(d["due_at"])
            df = fetch(d["ticker"])
            w = window_return(df, start, end)
            if w is None:
                raise ValueError("price series does not cover the decision window")

            entry = w["entry"]
            bench = window_return(bench_df, start, end) if bench_df is not None else None
            bench_ret = round(bench["return_pct"], 4) if bench else None

            ret = db.record_outcome(d["id"], w["exit"], entry,
                                    benchmark_return_pct=bench_ret)
            resolved.append({
                "id": d["id"], "ticker": d["ticker"], "action": d["action"],
                "entry_price": round(entry, 4), "exit_price": round(w["exit"], 4),
                "exit_date": str(w["exit_date"].date()),
                "realised_return_pct": ret,
                "benchmark_return_pct": bench_ret,
                "excess_return_pct": None if bench_ret is None else round(ret - bench_ret, 4),
            })
        except Exception as exc:
            failed.append({"id": d["id"], "ticker": d["ticker"], "error": str(exc)[:200]})

    return resolved, failed, len(due)
