"""Export the backtest into Alphalens format, for an independent check.

    python scripts/export_for_alphalens.py
    python scripts/alphalens_check.py

## Why bother

Every number in this project — the information coefficient, the sector
decomposition, the quantile buckets — comes from code I wrote. If that code has
a bug, every conclusion drawn from it is wrong in the same direction, and no
amount of internal testing will reveal it, because the tests were written by
the same hand as the thing they test.

Alphalens is the standard open-source library for exactly this analysis. It has
been used and audited by a large number of people since 2016. Running the same
factor through it answers a question the test suite cannot: **is the
measurement layer itself correct?**

Three outcomes:

* **Numbers agree** — the measurement layer is validated externally. The null
  result stands on more than my own arithmetic.
* **Numbers disagree** — one implementation has a bug, and finding out which is
  far more valuable than any new feature.
* **Alphalens will not run** — its conventions differ slightly (it shifts
  prices positionally, not by calendar date), which is itself worth knowing
  before comparing anything.

## What gets written

`alphalens_export/factor.csv`   date, asset, factor, sector — one row per
                                stock per rebalance date
`alphalens_export/prices.csv`   wide daily price panel, dates as rows and
                                tickers as columns, extending past the last
                                factor date by at least the horizon
"""
import argparse
import os
import sys
from datetime import date, timedelta

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.backtest import universe as bt_universe  # noqa: E402
from app.backtest.replay import Replay            # noqa: E402

OUT_DIR = "alphalens_export"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--universe", default="diversified_60")
    ap.add_argument("--horizon-days", type=int, default=63)
    ap.add_argument("--every-days", type=int, default=21)
    ap.add_argument("--years", type=int, default=3)
    ap.add_argument("--factor", default="score",
                    help="score | valuation | technical | money_flow ...")
    args = ap.parse_args()

    sectors = bt_universe.get(args.universe)
    end = date.today() - timedelta(days=int(args.horizon_days * 1.5))
    start = end - timedelta(days=365 * args.years)

    print(f"Replaying {len(sectors)} tickers, {start} to {end}...")
    replay = Replay(list(sectors), horizon_days=args.horizon_days,
                    every_days=args.every_days, start=start, end=end)
    replay.set_sectors(sectors)
    raw = replay.run()
    records = raw["records"]
    if not records:
        print("No records produced. Check price availability.")
        return 1

    rows = []
    for r in records:
        value = r.get(args.factor)
        if value is None:
            value = (r.get("components") or {}).get(args.factor)
        if value is None or not r.get("sector"):
            continue
        rows.append({"date": r["as_of"], "asset": r["ticker"],
                     "factor": value, "sector": r["sector"]})

    if not rows:
        print(f"No values for factor {args.factor!r}.")
        return 1

    factor_df = pd.DataFrame(rows).drop_duplicates(["date", "asset"])
    factor_df["date"] = pd.to_datetime(factor_df["date"]).dt.normalize()
    os.makedirs(OUT_DIR, exist_ok=True)

    # Alphalens shifts prices POSITIONALLY, so the panel must be a clean daily
    # grid covering every factor date plus at least `horizon` rows beyond the
    # last one, with the same columns throughout.
    assets = sorted(factor_df.asset.unique())
    series = {}
    for t in assets:
        df = replay._prices.get(t)
        if df is None:
            continue
        s = df.set_index("date")["close"]
        series[t] = s[~s.index.duplicated(keep="last")]

    prices = pd.DataFrame(series).sort_index()
    prices.index = pd.DatetimeIndex(prices.index).normalize()
    prices = prices[~prices.index.duplicated(keep="last")]
    first = pd.Timestamp(factor_df.date.min())
    prices = prices.loc[prices.index >= first - pd.Timedelta("10D")]
    prices = prices.ffill().dropna(axis=1, how="all")
    prices.index.name = "date"

    # Alphalens requires every factor date to exist in the price index — it
    # intersects the two and raises if the result is empty. Snap each decision
    # date onto the last trading day at or before it, which is also the day you
    # could actually have traded on.
    trading = prices.index
    wanted = pd.DatetimeIndex(pd.to_datetime(factor_df["date"])).normalize()
    positions = trading.searchsorted(wanted, side="right") - 1
    snapped = pd.Series(
        [trading[i] if i >= 0 else pd.NaT for i in positions], index=factor_df.index)
    moved = int((snapped.dt.normalize() != wanted).sum())
    factor_df["date"] = snapped
    factor_df = factor_df.dropna(subset=["date"]).drop_duplicates(["date", "asset"])

    prices.to_csv(f"{OUT_DIR}/prices.csv")
    factor_df.to_csv(f"{OUT_DIR}/factor.csv", index=False)

    overlap = len(pd.DatetimeIndex(factor_df["date"].unique()).intersection(trading))
    n_dates = factor_df["date"].nunique()
    print(f"\nFactor dates aligned to trading days: {overlap}/{n_dates}"
          + (f"  ({moved} snapped back to the prior close)" if moved else ""))
    if overlap != n_dates:
        print("  WARNING: some factor dates are still not in the price index. "
              "Alphalens will reject the pair.")

    last_factor = pd.Timestamp(factor_df.date.max())
    trailing = int((prices.index > last_factor).sum())

    print(f"\nWrote {OUT_DIR}/factor.csv   "
          f"{len(factor_df)} rows, {factor_df.date.nunique()} dates, "
          f"{len(assets)} assets")
    print(f"Wrote {OUT_DIR}/prices.csv   "
          f"{prices.shape[0]} days x {prices.shape[1]} assets")
    print(f"\nTrading days after the last factor date: {trailing}")
    if trailing < args.horizon_days:
        print(f"  WARNING: fewer than the {args.horizon_days}-day horizon. "
              "Alphalens will drop the final dates. Lower --years or --horizon-days.")
    else:
        print("  Enough to compute the forward return on every factor date.")

    print(f"\nNext:  python scripts/alphalens_check.py --factor {args.factor}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
